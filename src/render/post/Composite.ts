import * as THREE from 'three';
import { FullscreenPass, readArea } from '../fullscreen';
import { MAX_DAMAGE_MARKS, type PostState } from './PostState';

const FRAG = /* glsl */ `
uniform sampler2D tHdr;
uniform sampler2D tBloom;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBloomStrength;
uniform float uChroma;
uniform float uRadial;
uniform float uSpeed;
uniform float uLow;
uniform vec3 uFlash;
uniform vec4 uDamage[${MAX_DAMAGE_MARKS / 2}];

uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform vec3 uLift;
uniform vec3 uGain;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uIsolate;
uniform vec3 uKeepHue;
uniform float uVignette;
uniform vec3 uVignetteTint;
uniform float uEdgeGlow;
uniform float uGrain;
uniform vec2 uHdrScale;
uniform vec2 uHdrEdge;
uniform vec2 uHdrTexel;
uniform vec2 uBloomScale;
uniform vec2 uBloomEdge;
uniform float uEdgeAa;
uniform float uSharpen;

in vec2 vUv;
out vec4 outColor;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Khronos PBR Neutral. Keeps base colour true under about 0.8 and rolls the rest off without a hue shift.
vec3 pbrNeutral(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

vec3 srgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 bloomFetch(vec2 uv) {
  return texture(tBloom, min(uv * uBloomScale, uBloomEdge)).rgb * uBloomStrength;
}

vec3 hdrFetch(vec2 uv) {
  return texture(tHdr, min(uv * uHdrScale, uHdrEdge)).rgb + bloomFetch(uv);
}

// Folds HDR into 0..1. Blended raw, the mean of a 9x emissive strip and a dark wall still tone-maps to white
// and the stairs stay, so edges blend the way they will be seen.
vec3 fold(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
vec3 unfold(vec3 c) { return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-3); }
float foldedLuma(vec3 c) { return sqrt(dot(c, LUMA)); }
vec3 foldedTap(vec2 t) { return fold(texture(tHdr, min(t, uHdrEdge)).rgb); }

// Scene colour with the two jobs that replace 4x MSAA and a full-size image, from one set of five taps. Across
// a real edge it blends along the edge (FXAA, Lottes 2009). Everywhere else it sharpens luma, which gives back the
// crispness the upscale takes. Grain lands after this, so it never counts as an edge.
vec3 sceneFetch(vec2 uv) {
  vec2 t = uv * uHdrScale;
  vec3 raw = texture(tHdr, min(t, uHdrEdge)).rgb;
  if (uEdgeAa < 0.5) return raw;
  vec3 m = fold(raw);
  float lm = foldedLuma(m);
  float nw = foldedLuma(foldedTap(t + vec2(-uHdrTexel.x, uHdrTexel.y)));
  float ne = foldedLuma(foldedTap(t + uHdrTexel));
  float sw = foldedLuma(foldedTap(t - uHdrTexel));
  float se = foldedLuma(foldedTap(t + vec2(uHdrTexel.x, -uHdrTexel.y)));
  float lo = min(lm, min(min(nw, ne), min(sw, se)));
  float hi = max(lm, max(max(nw, ne), max(sw, se)));
  if (hi - lo < max(0.045, hi * 0.16)) {
    float gain = clamp(1.0 + uSharpen * (lm - (nw + ne + sw + se) * 0.25) / max(lm, 0.03), 0.75, 1.3);
    return raw * (gain * gain);
  }
  vec2 dir = vec2((sw + se) - (nw + ne), (nw + sw) - (ne + se));
  float shrink = max((nw + ne + sw + se) * 0.03125, 0.0078125);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + shrink), -4.0, 4.0) * uHdrTexel;
  vec3 inner = 0.5 * (foldedTap(t - dir * 0.16667) + foldedTap(t + dir * 0.16667));
  vec3 outer = inner * 0.5 + 0.25 * (foldedTap(t - dir * 0.5) + foldedTap(t + dir * 0.5));
  float lb = foldedLuma(outer);
  return unfold(lb < lo || lb > hi ? inner : outer);
}

void main() {
  vec2 uv = vUv;
  vec2 fromCentre = uv - 0.5;
  float aspect = uResolution.x / uResolution.y;
  vec2 q = fromCentre * vec2(aspect, 1.0);
  float r = length(q);
  float edge = smoothstep(0.34, 0.95, r);

  // Speed smears only the edges so the crosshair stays sharp; a blast pulse smears everything.
  float blur = uRadial + uSpeed * uSpeed * edge * 0.09;
  vec3 color;
  if (blur > 0.0008) {
    float jitter = hash12(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5;
    vec3 sum = vec3(0.0);
    float total = 0.0;
    for (int i = 0; i < 9; i++) {
      float t = (float(i) + 0.5 + jitter) / 9.0;
      float w = 1.0 - t * 0.6;
      sum += hdrFetch(uv - fromCentre * blur * t) * w;
      total += w;
    }
    color = sum / total;
  } else {
    color = sceneFetch(uv) + bloomFetch(uv);
  }

  // Lens fringing grows toward the corners and the pulse adds to it.
  float ca = uChroma + 0.0005 + edge * 0.001;
  if (ca > 0.0) {
    vec2 o = fromCentre * ca;
    vec3 fringe = vec3(hdrFetch(uv + o).r, color.g, hdrFetch(uv - o).b);
    color = mix(color, fringe, clamp(uChroma * 40.0 + edge, 0.0, 1.0));
  }

  color += uFlash;
  color *= uExposure;
  color = max(color, 0.0);

  vec3 c = pbrNeutral(color);

  // Grade
  float luma = dot(c, LUMA);
  vec3 grey = vec3(luma);
  float keep = 0.0;
  if (uIsolate > 0.0) {
    vec3 n = c / max(max(c.r, max(c.g, c.b)), 1e-4);
    vec3 h = uKeepHue;
    keep = smoothstep(0.82, 0.97, dot(normalize(n + 1e-4), normalize(h + 1e-4)));
  }
  float sat = mix(uSaturation, mix(uSaturation, 1.25, keep), uIsolate);
  c = mix(grey, c, sat * (1.0 - uIsolate * (1.0 - keep) * 0.72));
  c = max(c + uLift, 0.0) * uGain;
  // Split tone around mid grey: 0.5 is neutral, values above it push that channel up.
  float shadowW = 1.0 - smoothstep(0.0, 0.42, luma);
  float highW = smoothstep(0.3, 0.95, luma);
  c *= 1.0 + (uShadowTint - 0.5) * 2.0 * shadowW * 0.5 + (uHighlightTint - 0.5) * 2.0 * highW * 0.5;
  // Contrast pivots in perceptual space around display mid-grey.
  vec3 p = pow(max(c, 0.0), vec3(1.0 / 2.2));
  p = (p - 0.46) * uContrast + 0.46;
  c = pow(max(p, 0.0), vec3(2.2));

  // Low health: colour drains from the edges in, with a heartbeat.
  if (uLow > 0.0) {
    float beat = fract(uTime * (0.9 + uLow * 0.7));
    float pulse = exp(-beat * 7.0) + 0.6 * exp(-max(beat - 0.22, 0.0) * 9.0) * step(0.22, beat);
    float drain = uLow * (0.25 + 0.75 * edge);
    c = mix(c, vec3(dot(c, LUMA)) * vec3(0.92, 0.82, 0.82), drain * 0.8);
    float redEdge = smoothstep(0.82 - uLow * 0.46, 1.14, r) * (0.55 + 0.45 * pulse);
    c = mix(c, vec3(0.62, 0.012, 0.018) * (0.55 + 0.45 * pulse), clamp(redEdge * uLow * 1.2, 0.0, 0.92));
  }

  // Directional damage: a hot red bloom that hugs the screen edge the hit came from.
  float dmg = 0.0;
  for (int i = 0; i < ${MAX_DAMAGE_MARKS / 2}; i++) {
    vec4 pair = uDamage[i];
    vec2 d0 = vec2(sin(pair.x), cos(pair.x));
    vec2 d1 = vec2(sin(pair.z), cos(pair.z));
    vec2 dir = q / max(r, 1e-4);
    float e = smoothstep(0.2, 1.05, r);
    dmg += pair.y * pow(max(dot(dir, d0), 0.0), 5.0) * e;
    dmg += pair.w * pow(max(dot(dir, d1), 0.0), 5.0) * e;
  }
  c = mix(c, vec3(1.0, 0.035, 0.02), clamp(dmg * 1.15, 0.0, 0.9));

  // Speed lines: thin bright streaks that race outward from the screen centre.
  if (uSpeed > 0.02) {
    float ang = atan(q.y, q.x);
    float ring = r * 1.4 - uTime * 3.2;
    float cell = floor(ang * 34.0);
    float seed = hash12(vec2(cell, floor(ring * 1.3)));
    float line = smoothstep(0.42, 0.5, 0.5 - abs(fract(ang * 34.0) - 0.5)) * step(0.72 - uSpeed * 0.32, seed);
    float streak = smoothstep(0.0, 0.3, fract(ring * 1.3)) * (1.0 - smoothstep(0.3, 0.9, fract(ring * 1.3)));
    float lines = line * streak * smoothstep(0.42, 0.98, r) * uSpeed * uSpeed;
    c += vec3(0.62, 0.82, 1.0) * lines * 0.5;
  }

  // Vignette and the grade's coloured edge.
  float vig = smoothstep(0.32, 1.12, r);
  c = mix(c, c * uVignetteTint * 2.0 + uVignetteTint * 0.2, vig * uVignette);
  c += uVignetteTint * pow(smoothstep(0.4, 1.15, r), 2.0) * uEdgeGlow * 2.4;

  // Grain sits on the display-referred image and is strongest in the mids, where film shows it.
  float grainMask = 1.0 - abs(dot(c, LUMA) * 2.0 - 1.0) * 0.6;
  float t = fract(uTime * 7.31);
  float n = hash12(gl_FragCoord.xy + t * 1531.0) + hash12(gl_FragCoord.yx * 1.31 + t * 977.0) - 1.0;
  c += n * uGrain * grainMask * 0.5;

  vec3 display = srgb(c);
  // Triangular dither at one 8-bit step. The blue-hour gradients band without it.
  float d0 = hash12(gl_FragCoord.xy * 0.71 + 17.0 + t);
  float d1 = hash12(gl_FragCoord.xy * 1.13 + 41.0 + t);
  display += (d0 + d1 - 1.0) / 255.0;
  outColor = vec4(display, 1.0);
}`;

export class Composite {
  private readonly pass = new FullscreenPass(FRAG, {
    tHdr: { value: null },
    tBloom: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uBloomStrength: { value: 0.1 },
    uChroma: { value: 0 },
    uRadial: { value: 0 },
    uSpeed: { value: 0 },
    uLow: { value: 0 },
    uFlash: { value: new THREE.Color(0, 0, 0) },
    uDamage: { value: Array.from({ length: MAX_DAMAGE_MARKS / 2 }, () => new THREE.Vector4()) },
    uExposure: { value: 1 },
    uContrast: { value: 1 },
    uSaturation: { value: 1 },
    uLift: { value: new THREE.Vector3() },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uShadowTint: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
    uHighlightTint: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
    uIsolate: { value: 0 },
    uKeepHue: { value: new THREE.Vector3(1, 0, 0) },
    uVignette: { value: 0 },
    uVignetteTint: { value: new THREE.Vector3() },
    uEdgeGlow: { value: 0 },
    uGrain: { value: 0 },
    uHdrScale: { value: new THREE.Vector2(1, 1) },
    uHdrEdge: { value: new THREE.Vector2(1, 1) },
    uHdrTexel: { value: new THREE.Vector2(1, 1) },
    uBloomScale: { value: new THREE.Vector2(1, 1) },
    uBloomEdge: { value: new THREE.Vector2(1, 1) },
    uEdgeAa: { value: 0 },
    uSharpen: { value: 0.3 },
  });

  /** Base scene exposure before the grade. The world's luminance targets in DESIGN.md are met at this value. */
  exposure = 1;
  /** Base bloom add. Multiplied by the grade's bloom. */
  bloomStrength = 0.1;
  grainEnabled = true;

  /** `edgeAa` is for targets without MSAA. */
  setArea(hdr: THREE.WebGLRenderTarget, bloom: THREE.WebGLRenderTarget, edgeAa: boolean): void {
    const u = this.pass.uniforms;
    readArea(hdr, u.uHdrScale!.value as THREE.Vector2, u.uHdrEdge!.value as THREE.Vector2);
    readArea(bloom, u.uBloomScale!.value as THREE.Vector2, u.uBloomEdge!.value as THREE.Vector2);
    (u.uHdrTexel!.value as THREE.Vector2).set(1 / hdr.width, 1 / hdr.height);
    u.uEdgeAa!.value = edgeAa ? 1 : 0;
  }

  render(renderer: THREE.WebGLRenderer, hdr: THREE.Texture, bloom: THREE.Texture, width: number, height: number, time: number, state: PostState): void {
    const u = this.pass.uniforms;
    const g = state.grade;
    u.tHdr!.value = hdr;
    u.tBloom!.value = bloom;
    (u.uResolution!.value as THREE.Vector2).set(width, height);
    u.uTime!.value = time;
    u.uBloomStrength!.value = this.bloomStrength * g.bloom;
    // Callers pass anything from 0.01 to over 1, so the screen offset saturates instead of tearing the image.
    u.uChroma!.value = 0.05 * (1 - Math.exp(-state.chromaNow * 6));
    u.uRadial!.value = state.radialNow;
    u.uSpeed!.value = state.speed;
    u.uLow!.value = state.lowHealth;
    (u.uFlash!.value as THREE.Color).copy(state.flashColor);
    const dmg = u.uDamage!.value as THREE.Vector4[];
    for (let i = 0; i < dmg.length; i++) {
      const a = state.damage[i * 2]!;
      const b = state.damage[i * 2 + 1]!;
      dmg[i]!.set(a.x, a.y, b.x, b.y);
    }
    u.uExposure!.value = this.exposure * g.exposure;
    u.uContrast!.value = g.contrast;
    u.uSaturation!.value = g.saturation;
    (u.uLift!.value as THREE.Vector3).fromArray(g.lift);
    (u.uGain!.value as THREE.Vector3).fromArray(g.gain);
    (u.uShadowTint!.value as THREE.Vector3).fromArray(g.shadowTint);
    (u.uHighlightTint!.value as THREE.Vector3).fromArray(g.highlightTint);
    u.uIsolate!.value = g.isolate;
    (u.uKeepHue!.value as THREE.Vector3).fromArray(g.keepHue);
    u.uVignette!.value = g.vignette;
    (u.uVignetteTint!.value as THREE.Vector3).fromArray(g.vignetteTint);
    u.uEdgeGlow!.value = g.edgeGlow;
    u.uGrain!.value = this.grainEnabled ? g.grain : 0;
    this.pass.render(renderer, null);
  }

  dispose(): void {
    this.pass.dispose();
  }
}
