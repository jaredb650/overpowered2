import * as THREE from 'three';
import { FullscreenPass, readArea } from '../fullscreen';
import type { EngineUniforms } from '../engine';
import { MAX_LIVE_LIGHTS } from '../DynamicLightPool';

const MARCH = /* glsl */ `
#define PI 3.14159265
uniform sampler2D tDepth;
uniform highp sampler3D opVol0;
uniform highp sampler3D tNoise;
uniform highp sampler2DShadow opShadowS;
uniform mat4 opShadowMatS;
uniform vec3 opVolOrigin;
uniform vec3 opVolInvSize;
uniform vec3 opMoonDir;
uniform vec3 opMoonColor;
uniform mat4 uCamToWorld;
uniform vec2 uTanHalf;
uniform float uTime;
uniform float uFrame;
uniform float uMaxDist;
uniform vec4 uMedium; // density, height falloff, base height, noise amount
uniform vec3 uScatter; // baked gain, moon gain, phase g
uniform vec2 uScale;
uniform vec4 uLightPos[${MAX_LIVE_LIGHTS}];
uniform vec3 uLightCol[${MAX_LIVE_LIGHTS}];
in vec2 vUv;
out vec4 outColor;

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

float density(vec3 p) {
  float h = max(p.y - uMedium.z, 0.0);
  float d = uMedium.x * exp(-h * uMedium.y);
  float n = texture(tNoise, p * 0.06 + vec3(uTime * 0.014, uTime * 0.005, -uTime * 0.01)).r;
  return d * max(1.0 + (n * 2.0 - 1.0) * uMedium.w * 1.6, 0.04);
}

void main() {
  float z = texture(tDepth, vUv * uScale).r;
  vec3 eye = normalize(vec3((vUv * 2.0 - 1.0) * uTanHalf, -1.0));
  // The sky has no surface to stop at. Past this distance the dome's own horizon haze takes over.
  float dist = min(z / -eye.z, z > 2e4 ? uMaxDist * 0.45 : uMaxDist);
  vec3 ro = uCamToWorld[3].xyz;
  vec3 rd = mat3(uCamToWorld) * eye;
  // Volume and shadow coordinates are linear along the ray, so they step instead of transforming.
  vec3 volA = (ro - opVolOrigin) * opVolInvSize;
  vec3 volD = rd * opVolInvSize;
  vec3 shA = (opShadowMatS * vec4(ro, 1.0)).xyz;
  vec3 shD = mat3(opShadowMatS) * rd;

  float cosT = dot(rd, opMoonDir);
  float g = uScatter.z;
  float hg = (1.0 - g * g) / (4.0 * PI * pow(max(1.0 + g * g - 2.0 * g * cosT, 1e-4), 1.5));
  vec3 moon = opMoonColor * (hg * uScatter.y);

  // Frame-varying jitter. The temporal pass turns it into extra steps for free.
  float jitter = fract(ign(gl_FragCoord.xy) + uFrame * 0.61803399);
  vec3 scatter = vec3(0.0);
  float T = 1.0;
  float tPrev = 0.0;
  // A nearby wall ends the ray early. Short rays need fewer steps, and indoors most rays are short.
  int steps = clamp(int(dist * 0.4) + 5, 5, STEPS);
  float invSteps = 1.0 / float(steps);
  for (int i = 0; i < STEPS; i++) {
    if (i >= steps) break;
    float f0 = (float(i) + jitter) * invSteps;
    float t = dist * f0 * f0;
    float dt = t - tPrev;
    tPrev = t;
    vec3 p = ro + rd * t;
    float sigma = density(p);
    vec4 vol = texture(opVol0, volA + volD * t);
    vec3 sm = shA + shD * t;
    float shadow = (sm.x > 0.0 && sm.x < 1.0 && sm.y > 0.0 && sm.y < 1.0 && sm.z < 1.0) ? texture(opShadowS, sm) : 1.0;
    // vol.rgb is c0 = fluence / 4, so fluence / 4pi = c0 / pi: exactly isotropic in-scatter.
    // Moonlit air outdoors would be one flat veil. Indoors the same light is a shaft, so the gain goes
    // where the contrast is.
    float enclosed = 1.0 - smoothstep(0.4, 0.95, vol.a);
    vec3 L = vol.rgb * (uScatter.x / PI) + moon * (shadow * (0.22 + 0.78 * enclosed));
    // Energy-conserving integration over the segment (Hillaire 2015).
    float e = exp(-sigma * dt);
    scatter += T * L * (1.0 - e);
    T *= e;
  }

  // Flashes light the air analytically. A closed form instead of per-step sampling means no noise and
  // no extra steps, which is what lets every muzzle flash light the fog at almost no cost.
  float local = density(ro + rd * min(dist, 12.0) * 0.5);
  for (int i = 0; i < ${MAX_LIVE_LIGHTS}; i++) {
    vec3 c = uLightCol[i];
    if (c.r + c.g + c.b <= 0.0) continue;
    vec3 q = uLightPos[i].xyz - ro;
    float b = dot(q, rd);
    float h2 = max(dot(q, q) - b * b, 0.04);
    float s = inversesqrt(h2);
    float I = (atan((dist - b) * s) + atan(b * s)) * s;
    float r = uLightPos[i].w;
    float win = clamp(1.0 - h2 / (r * r), 0.0, 1.0);
    scatter += c * (I * local * win * T * 0.5 / (4.0 * PI));
  }
  outColor = vec4(scatter, T);
}`;

const RESOLVE = /* glsl */ `
uniform sampler2D tCurrent;
uniform sampler2D tHistory;
uniform sampler2D tDepth;
uniform mat4 uPrevViewProj;
uniform mat4 uCamToWorld;
uniform vec2 uTanHalf;
uniform float uBlend;
uniform vec2 uLast;
uniform vec2 uHistoryScale;
uniform vec2 uHistoryEdge;
in vec2 vUv;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 last = ivec2(uLast);
  vec4 cur = texelFetch(tCurrent, p, 0);
  float z = min(texelFetch(tDepth, p, 0).r, 400.0);
  vec3 eye = vec3((vUv * 2.0 - 1.0) * uTanHalf * z, -z);
  vec4 world = uCamToWorld * vec4(eye, 1.0);
  vec4 prev = uPrevViewProj * world;
  vec2 uv = prev.xy / prev.w * 0.5 + 0.5;

  // Clamp history to the local range of this frame. That rejects stale fog after fast motion
  // while keeping the temporal average in smooth areas.
  vec4 a = texelFetch(tCurrent, min(p + ivec2(1, 0), last), 0), b = texelFetch(tCurrent, max(p - ivec2(1, 0), ivec2(0)), 0);
  vec4 c = texelFetch(tCurrent, min(p + ivec2(0, 1), last), 0), d = texelFetch(tCurrent, max(p - ivec2(0, 1), ivec2(0)), 0);
  vec4 lo = min(min(min(a, b), min(c, d)), cur);
  vec4 hi = max(max(max(a, b), max(c, d)), cur);
  vec4 pad = (hi - lo) * 0.3 + 1e-4;
  vec4 hist = clamp(texture(tHistory, min(uv * uHistoryScale, uHistoryEdge)), lo - pad, hi + pad);
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  outColor = mix(cur, hist, uBlend * inside);
}`;

function noiseVolume(): THREE.Data3DTexture {
  const size = 32;
  const data = new Uint8Array(size * size * size);
  const lattice = (freq: number, seed: number) => {
    const values = new Float32Array(freq * freq * freq);
    let s = seed;
    for (let i = 0; i < values.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      values[i] = s / 4294967296;
    }
    return (x: number, y: number, z: number) => {
      const fx = x * freq, fy = y * freq, fz = z * freq;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
      const tx = fx - x0, ty = fy - y0, tz = fz - z0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), sz = tz * tz * (3 - 2 * tz);
      const at = (a: number, b: number, c: number) =>
        values[((a + freq) % freq) + ((b + freq) % freq) * freq + ((c + freq) % freq) * freq * freq]!;
      const l = (a: number, b: number, t: number) => a + (b - a) * t;
      return l(
        l(l(at(x0, y0, z0), at(x0 + 1, y0, z0), sx), l(at(x0, y0 + 1, z0), at(x0 + 1, y0 + 1, z0), sx), sy),
        l(l(at(x0, y0, z0 + 1), at(x0 + 1, y0, z0 + 1), sx), l(at(x0, y0 + 1, z0 + 1), at(x0 + 1, y0 + 1, z0 + 1), sx), sy),
        sz,
      );
    };
  };
  const a = lattice(4, 11), b = lattice(8, 23), c = lattice(16, 37);
  for (let z = 0, i = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++, i++) {
        const u = x / size, v = y / size, w = z / size;
        data[i] = Math.round((a(u, v, w) * 0.55 + b(u, v, w) * 0.3 + c(u, v, w) * 0.15) * 255);
      }
    }
  }
  const t = new THREE.Data3DTexture(data, size, size, size);
  t.format = THREE.RedFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

/** Tuning for the medium. Density is extinction per meter at the base height. */
export interface FogSettings {
  density: number;
  heightFalloff: number;
  baseHeight: number;
  noise: number;
  bakedGain: number;
  moonGain: number;
  anisotropy: number;
  maxDistance: number;
}

/**
 * Half-resolution ray march through the light volume, then temporal accumulation. The volume is
 * sampled once per step no matter how many lights the map has.
 */
export class Fog {
  readonly settings: FogSettings = {
    density: 0.007, heightFalloff: 0.05, baseHeight: 0, noise: 0.6, bakedGain: 1.6, moonGain: 3.5, anisotropy: 0.5, maxDistance: 240,
  };
  private march: FullscreenPass | null = null;
  private readonly resolve = new FullscreenPass(RESOLVE, {
    tCurrent: { value: null }, tHistory: { value: null }, tDepth: { value: null }, uPrevViewProj: { value: new THREE.Matrix4() },
    uCamToWorld: { value: new THREE.Matrix4() }, uTanHalf: { value: new THREE.Vector2() }, uBlend: { value: 0.9 },
    uLast: { value: new THREE.Vector2() }, uHistoryScale: { value: new THREE.Vector2(1, 1) }, uHistoryEdge: { value: new THREE.Vector2(1, 1) },
  });
  private raw!: THREE.WebGLRenderTarget;
  private history: THREE.WebGLRenderTarget[] = [];
  private flip = 0;
  private frame = 0;
  private readonly noise = noiseVolume();
  private readonly prevViewProj = new THREE.Matrix4();
  private hasHistory = false;
  private readonly scale = new THREE.Vector2(1, 1);
  private readonly edge = new THREE.Vector2(1, 1);

  constructor(private readonly engine: EngineUniforms) {}

  get texture(): THREE.Texture {
    return this.history[this.flip]!.texture;
  }

  configure(steps: number, lightPositions: THREE.Vector4[], lightColors: THREE.Vector3[]): void {
    this.march?.dispose();
    const e = this.engine;
    this.march = new FullscreenPass(MARCH, {
      tDepth: { value: null },
      opVol0: e.opVol0,
      tNoise: { value: this.noise },
      opShadowS: e.opShadowS,
      opShadowMatS: e.opShadowMatS,
      opVolOrigin: e.opVolOrigin,
      opVolInvSize: e.opVolInvSize,
      opMoonDir: e.opMoonDir,
      opMoonColor: e.opMoonColor,
      uCamToWorld: { value: new THREE.Matrix4() },
      uTanHalf: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uFrame: { value: 0 },
      uMaxDist: { value: 200 },
      uMedium: { value: new THREE.Vector4() },
      uScatter: { value: new THREE.Vector3() },
      uScale: { value: this.scale },
      uLightPos: { value: lightPositions },
      uLightCol: { value: lightColors },
    }, { STEPS: steps });
  }

  resize(fullWidth: number, fullHeight: number): void {
    this.raw?.dispose();
    for (const t of this.history) t.dispose();
    const w = fullWidth / 2;
    const h = fullHeight / 2;
    const options = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.raw = new THREE.WebGLRenderTarget(w, h, { ...options, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.history = [new THREE.WebGLRenderTarget(w, h, options), new THREE.WebGLRenderTarget(w, h, options)];
    this.hasHistory = false;
  }

  /**
   * `width` and `height` are the full-resolution area, always even. History survives a change: it is read with
   * the area it was written at, which the render below carries forward, so a step does not restart the average.
   */
  setArea(width: number, height: number): void {
    const w = width / 2;
    const h = height / 2;
    for (const t of [this.raw, ...this.history]) t.viewport.set(0, 0, w, h);
    readArea(this.raw, this.scale, this.edge);
    (this.resolve.uniforms.uLast!.value as THREE.Vector2).set(w - 1, h - 1);
  }

  render(renderer: THREE.WebGLRenderer, depth: THREE.Texture, camera: THREE.PerspectiveCamera, tanHalf: THREE.Vector2, time: number): void {
    const s = this.settings;
    const u = this.march!.uniforms;
    u.tDepth!.value = depth;
    (u.uCamToWorld!.value as THREE.Matrix4).copy(camera.matrixWorld);
    (u.uTanHalf!.value as THREE.Vector2).copy(tanHalf);
    u.uTime!.value = time;
    u.uFrame!.value = this.frame++ % 1024;
    u.uMaxDist!.value = s.maxDistance;
    (u.uMedium!.value as THREE.Vector4).set(s.density, s.heightFalloff, s.baseHeight, s.noise);
    (u.uScatter!.value as THREE.Vector3).set(s.bakedGain, s.moonGain, s.anisotropy);
    this.march!.render(renderer, this.raw);

    const r = this.resolve.uniforms;
    const prev = this.flip;
    this.flip = 1 - this.flip;
    r.tCurrent!.value = this.raw.texture;
    r.tHistory!.value = this.history[prev]!.texture;
    r.tDepth!.value = depth;
    (r.uCamToWorld!.value as THREE.Matrix4).copy(camera.matrixWorld);
    (r.uTanHalf!.value as THREE.Vector2).copy(tanHalf);
    (r.uPrevViewProj!.value as THREE.Matrix4).copy(this.prevViewProj);
    r.uBlend!.value = this.hasHistory ? 0.9 : 0;
    this.resolve.render(renderer, this.history[this.flip]!);
    (r.uHistoryScale!.value as THREE.Vector2).copy(this.scale);
    (r.uHistoryEdge!.value as THREE.Vector2).copy(this.edge);
    this.hasHistory = true;
    this.prevViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  }

  dispose(): void {
    this.march?.dispose();
    this.resolve.dispose();
    this.raw?.dispose();
    for (const t of this.history) t.dispose();
    this.noise.dispose();
  }
}
