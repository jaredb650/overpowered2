import * as THREE from 'three';
import type { EngineUniforms } from './engine';

/** Radiance of the sky in a world direction. Shared by the dome and the environment bake. */
export const SKY_GLSL = /* glsl */ `
uniform vec3 opMoonDir;
uniform float uSkyTime;
uniform sampler2D opNoise;

#define SKY_PI 3.14159265

float skyHash(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float skyHash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float skyHash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

vec3 skyGradient(vec3 d) {
  float h = max(d.y, 0.0);
  vec3 zenith = vec3(0.0085, 0.0145, 0.036);
  vec3 mid = vec3(0.028, 0.054, 0.102);
  vec3 horizon = vec3(0.115, 0.17, 0.225);
  vec3 c = mix(horizon, mid, 1.0 - exp(-h * 9.0));
  c = mix(c, zenith, 1.0 - exp(-h * 2.2));
  // The last of the day, low on the far side from the moon. A cold rose, not a sunset.
  float away = max(dot(normalize(vec3(d.x, 0.0, d.z)), -normalize(vec3(opMoonDir.x, 0.0, opMoonDir.z))), 0.0);
  c += vec3(0.052, 0.036, 0.058) * exp(-h * 16.0) * away * away;
  return c;
}

vec3 stars(vec3 d) {
  vec3 sum = vec3(0.0);
  for (int layer = 0; layer < 2; layer++) {
    float scale = layer == 0 ? 170.0 : 380.0;
    vec3 p = d * scale;
    vec3 cell = floor(p);
    float h = skyHash3(cell + float(layer) * 19.0);
    if (h < 0.9) continue;
    vec3 o = vec3(skyHash3(cell + 3.1), skyHash3(cell + 5.7), skyHash3(cell + 9.3)) * 0.8 + 0.1;
    float r = length(p - cell - o);
    // Magnitudes follow a steep power law: a handful of bright stars over a dust of faint ones.
    float mag = pow((h - 0.9) / 0.1, 14.0) * (layer == 0 ? 3.2 : 0.8) + 0.035;
    float twinkle = 0.8 + 0.2 * sin(uSkyTime * (1.5 + h * 5.0) + h * 91.0);
    vec3 tint = mix(vec3(0.7, 0.82, 1.0), vec3(1.0, 0.93, 0.86), skyHash3(cell + 12.0));
    sum += tint * mag * twinkle * exp(-r * r * 46.0);
  }
  return sum;
}

// Moon. Maria and rays come from the noise texture, on a sphere so they curve toward the limb.
vec3 moonDisc(vec3 d, out float cover) {
  const float radius = 0.082;
  vec3 m = opMoonDir;
  vec3 up = abs(m.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 ax = normalize(cross(up, m));
  vec3 ay = cross(m, ax);
  vec2 q = vec2(dot(d, ax), dot(d, ay)) / radius;
  float r2 = dot(q, q);
  float facing = dot(d, m);
  cover = facing > 0.0 ? 1.0 - smoothstep(0.985, 1.015, sqrt(r2)) : 0.0;
  if (cover <= 0.0) return vec3(0.0);
  float z = sqrt(max(1.0 - r2, 0.0));
  vec2 s = q / (1.0 + z * 0.8);
  float maria = texture2D(opNoise, s * 0.19 + 0.31).r * 0.6 + texture2D(opNoise, s * 0.41 + 0.07).g * 0.4;
  float albedo = 0.62 + smoothstep(0.5, 0.42, maria) * -0.34 + smoothstep(0.54, 0.7, texture2D(opNoise, s * 0.9).b) * 0.2;
  float craters = texture2D(opNoise, s * 1.7 + 0.5).b;
  albedo *= 0.88 + craters * 0.24;
  float limb = pow(z, 0.45);
  // Bright enough to bloom, dim enough that the tone curve keeps the maria.
  return vec3(0.86, 0.91, 1.0) * albedo * limb * 2.3;
}

float cloudField(vec2 p, float t) {
  float n = texture2D(opNoise, p * 0.11 + vec2(t, t * 0.3)).r;
  n += texture2D(opNoise, p * 0.27 + vec2(-t * 1.3, t * 0.5)).g * 0.5;
  n += texture2D(opNoise, p * 0.72 + vec2(t * 2.1, -t)).b * 0.25;
  n += texture2D(opNoise, p * 1.9 + vec2(-t * 3.0, t * 1.7)).g * 0.125;
  n += texture2D(opNoise, p * 4.3 + vec2(t * 4.0, t * 2.1)).b * 0.0625;
  return n / 1.9375;
}

// Thin cirrus lit from behind by the moon, then a lower broken deck that shows dark against the glow.
vec3 clouds(vec3 d, vec3 base, float moonAmount) {
  if (d.y < 0.015) return base;
  float t = uSkyTime * 0.0009;
  // The moon is the map's landmark, so the deck parts around it.
  float clear = 1.0 - smoothstep(0.962, 0.992, dot(d, opMoonDir)) * 0.94;
  float fade = smoothstep(0.015, 0.14, d.y) * clear;
  vec2 high = d.xz / (d.y + 0.09) * vec2(0.7, 1.9);
  float hc = cloudField(high + 3.0, t);
  float cirrus = smoothstep(0.5, 0.74, hc) * fade;
  vec3 lit = vec3(0.075, 0.105, 0.155) + vec3(0.5, 0.58, 0.72) * moonAmount;
  vec3 c = mix(base, lit, cirrus * 0.42);

  vec2 low = d.xz / (d.y + 0.2) * 1.7;
  float lc = cloudField(low + 9.0, t * 2.2);
  float deck = smoothstep(0.5, 0.7, lc) * fade;
  float rim = smoothstep(0.52, 0.6, lc) * (1.0 - smoothstep(0.6, 0.72, lc));
  vec3 under = mix(vec3(0.012, 0.02, 0.038), vec3(0.03, 0.045, 0.07), smoothstep(0.1, 0.5, d.y));
  return mix(c, under + vec3(0.42, 0.5, 0.64) * moonAmount * rim * 2.2, deck * 0.9);
}

// One row of the distant skyline. Returns the silhouette's top at azimuth a, in sine-of-elevation units.
float skylineRow(float a, float cells, float tall, float seed, out float id, out float across) {
  float x = a * cells;
  float i = floor(x);
  float f = x - i;
  id = i + seed;
  across = f;
  float h = skyHash(id * 1.37);
  h = h * h * h;
  float fill = 0.55 + 0.45 * skyHash(id * 2.11 + 3.0);
  float inside = step(abs(f - 0.5), fill * 0.5);
  float setback = step(abs(f - 0.5), fill * 0.3);
  float top = tall * (0.16 + h) * (0.62 + 0.38 * setback);
  // A mast on some of the taller blocks.
  float mast = step(abs(f - 0.5), 0.022) * step(0.55, skyHash(id * 3.7)) * tall * 0.34;
  return (top + mast) * inside;
}

// Reactor-scale forms on the horizon: hyperboloid stacks with a city climbing their sides, far
// enough away to go blue. Ribs and service rings keep them from reading as smooth cones.
float colossus(float a, float e, out float glow, out float ribs) {
  float s = 0.0;
  glow = 0.0;
  ribs = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float centre = -2.9 + fi * 1.07 + 0.34 * sin(fi * 2.1);
    float da = a - centre;
    da = da - 6.2831853 * floor(da / 6.2831853 + 0.5);
    float h = 0.15 + 0.24 * skyHash(fi + 4.0);
    float w = 0.05 + 0.06 * skyHash(fi + 9.0);
    float t = clamp(e / h, 0.0, 1.0);
    float width = w * (0.58 + 0.62 * pow(abs(t - 0.74) * 1.35, 2.0));
    float wall = (1.0 - smoothstep(width * 0.97, width * 1.03, abs(da))) * step(e, h);
    // Mast clusters on the rim.
    float mast = step(abs(fract(da / width * 2.5) - 0.5), 0.05) * step(abs(da), width) * step(h, e) * step(e, h + 0.018 + 0.02 * skyHash(floor(da / width * 2.5) + fi));
    s = max(s, max(wall, mast));
    float band = step(0.82, fract(t * 9.0 + fi * 0.3)) * wall;
    float strut = step(0.9, fract(da / width * 7.0 + t * 1.5)) * wall;
    ribs = max(ribs, max(band, strut * 0.6));
    glow = max(glow, (1.0 - smoothstep(0.0, width * 1.6, abs(da))) * exp(-abs(e - h) * 70.0));
  }
  return s;
}

vec3 skyline(vec3 d, vec3 c) {
  if (d.y > 0.5 || d.y < -0.04) return c;
  float a = atan(d.x, d.z);
  float e = d.y;
  vec3 haze = skyGradient(vec3(d.x, 0.012, d.z));
  // Far to near, each row less hazy than the last.
  float id, across;
  float top = skylineRow(a, 30.0, 0.075, 11.0, id, across);
  c = mix(c, mix(haze, vec3(0.032, 0.058, 0.094), 0.22), step(e, top));
  float glow, ribs;
  float big = colossus(a, e, glow, ribs);
  c = mix(c, mix(haze, vec3(0.016, 0.03, 0.054), 0.55 + ribs * 0.2), big);
  c += vec3(0.1, 0.34, 0.44) * glow * 0.5;
  float top2 = skylineRow(a, 62.0, 0.05, 37.0, id, across);
  float row2 = step(e, top2);
  vec3 near = vec3(0.0105, 0.018, 0.032);
  c = mix(c, near, row2 * 0.9);
  // Sparse window lights, and red beacons on the masts.
  vec2 win = vec2(across * 7.0 + id, e * 600.0);
  float lit = step(0.975, skyHash2(floor(win))) * row2;
  c += vec3(0.52, 0.72, 0.9) * lit * 0.28;
  float beacon = 1.0 - smoothstep(0.0, 0.0022, length(vec2((across - 0.5) / 62.0, e - top2)));
  float blink = step(0.5, fract(uSkyTime * 0.5 + skyHash(id) * 3.0));
  c += vec3(2.4, 0.08, 0.05) * beacon * blink * step(0.55, skyHash(id * 3.7));
  return c;
}

vec3 skyRadiance(vec3 d) {
  vec3 c = skyGradient(d);
  float moonCos = max(dot(d, opMoonDir), 0.0);
  float halo = pow(moonCos, 180.0) * 0.32 + pow(moonCos, 28.0) * 0.05 + pow(moonCos, 6.0) * 0.012;
  c += vec3(0.5, 0.64, 0.92) * halo;
  c += stars(d) * smoothstep(0.03, 0.3, d.y) * (1.0 - min(pow(moonCos, 12.0) * 3.0, 1.0));
  float cover;
  vec3 disc = moonDisc(d, cover);
  c = mix(c, disc, cover);
  c = clouds(d, c, pow(moonCos, 10.0) * 0.5 + pow(moonCos, 80.0) * 0.5);
  c = skyline(d, c);
  // Below the horizon is a dark ground haze the map hides.
  if (d.y < 0.0) c = mix(c, vec3(0.02, 0.032, 0.05), clamp(-d.y * 8.0, 0.0, 1.0));
  return c;
}
`;

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}`;

const FRAG = /* glsl */ `
varying vec3 vDir;
${SKY_GLSL}
void main() {
  gl_FragColor = vec4(skyRadiance(normalize(vDir)), 1.0);
}`;

/** Procedural blue-hour dome plus the PMREM environment baked from it. */
export class Sky {
  readonly mesh: THREE.Mesh;
  readonly environment: THREE.Texture;
  private readonly material: THREE.ShaderMaterial;

  constructor(renderer: THREE.WebGLRenderer, engine: EngineUniforms) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        opMoonDir: engine.opMoonDir,
        opNoise: engine.opNoise,
        uSkyTime: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    // Last among opaques: the tiler's hidden-surface pass then skips every pixel the world covers.
    this.mesh.renderOrder = 1e6;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envMesh = new THREE.Mesh(this.mesh.geometry, this.material);
    envMesh.frustumCulled = false;
    envScene.add(envMesh);
    this.environment = pmrem.fromScene(envScene, 0, 0.1, 100, { size: 256 }).texture;
    pmrem.dispose();
  }

  update(time: number): void {
    this.material.uniforms.uSkyTime!.value = time;
  }
}
