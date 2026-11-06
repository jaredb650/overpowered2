import * as THREE from 'three';
import { FullscreenPass, readArea } from '../fullscreen';

/** Half-resolution linear depth from the full-resolution hardware depth. */
const PREP = /* glsl */ `
uniform sampler2D tDepth;
uniform vec2 uProj;
uniform vec2 uFullSize;
in vec2 vUv;
out vec4 outColor;
float linear(float d) { return d >= 1.0 ? 1e5 : -uProj.y / (d * 2.0 - 1.0 + uProj.x) * -1.0; }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * 2;
  ivec2 hi = ivec2(uFullSize) - 1;
  float a = texelFetch(tDepth, min(p, hi), 0).r;
  float b = texelFetch(tDepth, min(p + ivec2(1, 0), hi), 0).r;
  float c = texelFetch(tDepth, min(p + ivec2(0, 1), hi), 0).r;
  float d = texelFetch(tDepth, min(p + ivec2(1, 1), hi), 0).r;
  // Alternating min and max in a checkerboard keeps both sides of every silhouette, so the bilateral
  // upsample always finds a sample on the right side of an edge.
  bool odd = (((p.x >> 1) ^ (p.y >> 1)) & 1) == 1;
  float m = odd ? max(max(a, b), max(c, d)) : min(min(a, b), min(c, d));
  outColor = vec4(linear(m), 0.0, 0.0, 1.0);
}`;

/** Ground-truth AO (Jimenez 2016), evaluated from linear depth. */
const AO = /* glsl */ `
#define PI 3.14159265
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform vec2 uTanHalf;
uniform float uRadius;
uniform float uViewCut;
uniform vec2 uScale;
uniform vec2 uEdge;
in vec2 vUv;
out vec4 outColor;

vec3 viewPos(vec2 uv, float z) { return vec3((uv * 2.0 - 1.0) * uTanHalf * z, -z); }
float depthAt(vec2 uv) { return textureLod(tDepth, min(uv * uScale, uEdge), 0.0).r; }
vec3 posAt(vec2 uv) { return viewPos(uv, depthAt(uv)); }

void main() {
  float z = depthAt(vUv);
  if (z > 2e4 || z < uViewCut) { outColor = vec4(1.0, z, 0.0, 1.0); return; }
  vec3 P = viewPos(vUv, z);

  // Pick the flatter neighbour on each axis, so a silhouette does not bend the normal.
  vec3 l = posAt(vUv - vec2(uTexel.x, 0.0)), r = posAt(vUv + vec2(uTexel.x, 0.0));
  vec3 d = posAt(vUv - vec2(0.0, uTexel.y)), u = posAt(vUv + vec2(0.0, uTexel.y));
  vec3 dx = abs(P.z - l.z) < abs(r.z - P.z) ? P - l : r - P;
  vec3 dy = abs(P.z - d.z) < abs(u.z - P.z) ? P - d : u - P;
  vec3 N = normalize(cross(dx, dy));
  vec3 V = normalize(-P);

  // 4x4 interleaved rotation. The blur pass averages exactly one tile, which removes the pattern.
  ivec2 c = ivec2(gl_FragCoord.xy) & 3;
  float rot = float((c.x + c.y * 4) * 7 % 16) / 16.0;
  float shift = float((c.x * 4 + c.y) * 5 % 16) / 16.0;

  float screenRadius = uRadius / (z * uTanHalf.y * 2.0);
  screenRadius = min(screenRadius, 0.22);
  float vis = 0.0;
  for (int s = 0; s < SLICES; s++) {
    float phi = (float(s) + rot) / float(SLICES) * PI;
    vec2 dir = vec2(cos(phi), sin(phi));
    vec2 step_ = dir * vec2(uTanHalf.y / uTanHalf.x, 1.0) * screenRadius;
    vec3 sliceDir = vec3(dir, 0.0);
    vec3 orthoDir = sliceDir - dot(sliceDir, V) * V;
    vec3 axis = normalize(cross(orthoDir, V));
    vec3 projN = N - axis * dot(N, axis);
    float projLen = length(projN);
    float cosN = clamp(dot(projN / max(projLen, 1e-4), V), -1.0, 1.0);
    float n = sign(dot(orthoDir, projN)) * acos(cosN);
    float h0 = -1.0, h1 = -1.0;
    for (int j = 0; j < STEPS; j++) {
      float t = (float(j) + shift + 0.15) / float(STEPS);
      t *= t;
      vec2 o = step_ * t + uTexel * sign(step_) * 1.2;
      float zs0 = depthAt(vUv + o);
      float zs1 = depthAt(vUv - o);
      vec3 a0 = viewPos(vUv + o, zs0) - P;
      vec3 a1 = viewPos(vUv - o, zs1) - P;
      float d0 = length(a0), d1 = length(a1);
      // Weight falls off with distance, so a wall far behind a thin rail casts no halo.
      float w0 = zs0 < uViewCut ? 0.0 : clamp(1.0 - d0 * d0 / (uRadius * uRadius), 0.0, 1.0);
      float w1 = zs1 < uViewCut ? 0.0 : clamp(1.0 - d1 * d1 / (uRadius * uRadius), 0.0, 1.0);
      h0 = max(h0, mix(-1.0, clamp(dot(a0, V) / max(d0, 1e-4), -1.0, 1.0), w0));
      h1 = max(h1, mix(-1.0, clamp(dot(a1, V) / max(d1, 1e-4), -1.0, 1.0), w1));
    }
    float a0 = n + clamp(-acos(h1) - n, -PI * 0.5, PI * 0.5);
    float a1 = n + clamp(acos(h0) - n, -PI * 0.5, PI * 0.5);
    float cn = cos(n), sn = sin(n);
    vis += projLen * 0.25 * ((cn + 2.0 * a0 * sn - cos(2.0 * a0 - n)) + (cn + 2.0 * a1 * sn - cos(2.0 * a1 - n)));
  }
  // Depth rides along so the blur reads one texture instead of two.
  outColor = vec4(clamp(vis / float(SLICES), 0.0, 1.0), z, 0.0, 1.0);
}`;

const BLUR = /* glsl */ `
uniform sampler2D tAo;
uniform vec2 uLast;
in vec2 vUv;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 last = ivec2(uLast);
  float z = texelFetch(tAo, p, 0).g;
  float sum = 0.0, wsum = 0.0;
  float invRange = 1.0 / max(z * 0.02, 0.02);
  for (int y = -2; y <= 1; y++) {
    for (int x = -2; x <= 1; x++) {
      vec2 s = texelFetch(tAo, clamp(p + ivec2(x, y), ivec2(0), last), 0).rg;
      float w = exp(-abs(s.y - z) * invRange);
      sum += s.x * w;
      wsum += w;
    }
  }
  outColor = vec4(sum / max(wsum, 1e-4));
}`;

export class Gtao {
  depth!: THREE.WebGLRenderTarget;
  private raw!: THREE.WebGLRenderTarget;
  private blurred!: THREE.WebGLRenderTarget;
  private readonly prep = new FullscreenPass(PREP, { tDepth: { value: null }, uProj: { value: new THREE.Vector2() }, uFullSize: { value: new THREE.Vector2() } });
  private ao: FullscreenPass | null = null;
  private readonly blur = new FullscreenPass(BLUR, { tAo: { value: null }, uLast: { value: new THREE.Vector2() } });
  radius = 1.6;
  private width = 1;
  private height = 1;
  private readonly scale = new THREE.Vector2(1, 1);
  private readonly edge = new THREE.Vector2(1, 1);

  get texture(): THREE.Texture {
    return this.blurred.texture;
  }

  configure(slices: number, steps: number): void {
    this.ao?.dispose();
    this.ao = new FullscreenPass(AO, {
      tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uTanHalf: { value: new THREE.Vector2() }, uRadius: { value: 1 }, uViewCut: { value: 0.16 },
      uScale: { value: this.scale }, uEdge: { value: this.edge },
    }, { SLICES: slices, STEPS: steps });
  }

  resize(fullWidth: number, fullHeight: number): void {
    this.depth?.dispose();
    this.raw?.dispose();
    this.blurred?.dispose();
    const w = fullWidth / 2;
    const h = fullHeight / 2;
    const base = { depthBuffer: false, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    this.depth = new THREE.WebGLRenderTarget(w, h, { ...base, type: THREE.FloatType, format: THREE.RedFormat });
    this.raw = new THREE.WebGLRenderTarget(w, h, { ...base, type: THREE.HalfFloatType, format: THREE.RGFormat });
    this.blurred = new THREE.WebGLRenderTarget(w, h, {
      ...base, type: THREE.UnsignedByteType, format: THREE.RedFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
  }

  /** `width` and `height` are the full-resolution area, always even. */
  setArea(width: number, height: number): void {
    this.width = width / 2;
    this.height = height / 2;
    for (const t of [this.depth, this.raw, this.blurred]) t.viewport.set(0, 0, this.width, this.height);
    readArea(this.depth, this.scale, this.edge);
    (this.prep.uniforms.uFullSize!.value as THREE.Vector2).set(width, height);
    (this.blur.uniforms.uLast!.value as THREE.Vector2).set(this.width - 1, this.height - 1);
  }

  renderDepth(renderer: THREE.WebGLRenderer, depth: THREE.Texture, camera: THREE.PerspectiveCamera): void {
    const e = camera.projectionMatrix.elements;
    const p = this.prep.uniforms;
    p.tDepth!.value = depth;
    (p.uProj!.value as THREE.Vector2).set(e[10]!, e[14]!);
    this.prep.render(renderer, this.depth);
  }

  renderAo(renderer: THREE.WebGLRenderer, tanHalf: THREE.Vector2): void {
    const a = this.ao!.uniforms;
    a.tDepth!.value = this.depth.texture;
    (a.uTexel!.value as THREE.Vector2).set(1 / this.width, 1 / this.height);
    (a.uTanHalf!.value as THREE.Vector2).copy(tanHalf);
    a.uRadius!.value = this.radius;
    this.ao!.render(renderer, this.raw);
    const b = this.blur.uniforms;
    b.tAo!.value = this.raw.texture;
    this.blur.render(renderer, this.blurred);
  }

  dispose(): void {
    this.depth?.dispose();
    this.raw?.dispose();
    this.blurred?.dispose();
    this.prep.dispose();
    this.ao?.dispose();
    this.blur.dispose();
  }
}
