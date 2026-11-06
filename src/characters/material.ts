/**
 * Character surface. One MeshStandardMaterial per model, shared by every instance: all per-instance state
 * (wounds, blood, burn, frost, hit flash) rides in spare texels at the end of the instance's bone texture,
 * which is already bound and uploaded per skeleton. That keeps a crowd on one program and one material with
 * no per-object uniform traffic.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import { mulberry32 } from '../core/math';

/** Extra texels after the bone matrices. */
export const EXTRA_PARAMS = 0;
export const EXTRA_INFO = 1;
export const EXTRA_WOUNDS = 2;
export const MAX_WOUNDS = 16;
export const EXTRA_TEXELS = EXTRA_WOUNDS + MAX_WOUNDS;

const VERT_PARS = /* glsl */ `
attribute vec4 aColor;
attribute vec4 aMat;
attribute vec4 aSkinQuat;
varying vec4 vColorAO;
varying vec4 vMatV;
varying vec4 vDetailW;
varying vec3 vBind;
varying vec3 vBindN;
varying vec3 vSk0;
varying vec3 vSk1;
varying vec3 vSk2;
#ifdef OP2_ATLAS
varying vec2 vAtlasUv;
#endif
`;

const VERT_MAIN = /* glsl */ `
{
  vColorAO = vec4(pow(aColor.rgb, vec3(2.2)), aColor.a);
  float code = floor(aMat.a * 255.0 + 0.5);
  float kind = mod(code, 4.0);
  vMatV = vec4(aMat.rgb, step(3.5, code));
  vDetailW = vec4(kind < 0.5, kind > 0.5 && kind < 1.5, kind > 1.5 && kind < 2.5, kind > 2.5);
  vBind = position;
  vBindN = normal;
  #ifdef OP2_ATLAS
  vAtlasUv = uv;
  #endif
  #ifdef USE_SKINNING
  vSk0 = skinMatrix[0].xyz; vSk1 = skinMatrix[1].xyz; vSk2 = skinMatrix[2].xyz;
  #else
  vec4 q = aSkinQuat;
  vSk0 = vec3(1.0 - 2.0 * (q.y * q.y + q.z * q.z), 2.0 * (q.x * q.y + q.z * q.w), 2.0 * (q.x * q.z - q.y * q.w));
  vSk1 = vec3(2.0 * (q.x * q.y - q.z * q.w), 1.0 - 2.0 * (q.x * q.x + q.z * q.z), 2.0 * (q.y * q.z + q.x * q.w));
  vSk2 = vec3(2.0 * (q.x * q.z + q.y * q.w), 2.0 * (q.y * q.z - q.x * q.w), 1.0 - 2.0 * (q.x * q.x + q.y * q.y));
  #endif
}
`;

const FRAG_PARS = /* glsl */ `
varying vec4 vColorAO;
varying vec4 vMatV;
varying vec4 vDetailW;
varying vec3 vBind;
varying vec3 vBindN;
varying vec3 vSk0;
varying vec3 vSk1;
varying vec3 vSk2;
uniform mat3 normalMatrix;
uniform sampler2D tDetail;
uniform float uEmissive;
uniform float uRim;
uniform float uFill;
#ifdef OP2_ATLAS
varying vec2 vAtlasUv;
uniform sampler2D tAtlasA;
uniform sampler2D tAtlasB;
#endif
#ifdef OP2_SKINNED
uniform highp sampler2D boneTexture;
uniform int uExtraBase;
vec4 op2Extra(int i) {
  int size = textureSize(boneTexture, 0).x;
  int t = uExtraBase + i;
  return texelFetch(boneTexture, ivec2(t % size, t / size), 0);
}
#endif
vec4 op2Tri(vec3 p, vec3 w) {
  return texture2D(tDetail, p.zy) * w.x + texture2D(tDetail, p.xz) * w.y + texture2D(tDetail, p.xy) * w.z;
}
// Height in meters to a bent normal. Unnormalized screen derivatives keep the strength independent of distance.
vec3 op2Bump(vec3 pos, vec3 n, float h, float face) {
  vec3 sx = dFdx(pos), sy = dFdy(pos);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * face;
  vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - g);
}
`;

const FRAG_SURFACE = /* glsl */ `
vec3 sAlb = vColorAO.rgb;
float sRough = vMatV.x;
float sMetal = vMatV.y;
float sEmis = vMatV.z;
vec3 sN = normalize(vBindN);
#ifdef OP2_ATLAS
if (vMatV.w > 0.5) {
  vec4 ta = texture2D(tAtlasA, vAtlasUv);
  vec4 tb = texture2D(tAtlasB, vAtlasUv);
  sAlb = ta.rgb;
  sMetal = clamp(ta.a * 2.0, 0.0, 1.0);
  sEmis = clamp(ta.a * 2.0 - 1.0, 0.0, 1.0);
  if (sEmis > 0.0) sMetal = 0.0;
  sN = normalize(tb.xyz * 2.0 - 1.0);
  sRough = tb.a;
}
#endif

// Authored albedo is true to the materials, which is too dark for a world this dim. This curve lifts the
// darks about 2.8x and leaves the brights alone, so gear keeps its detail in a shadowed underpass.
// It scales by peak channel, so hue survives and flesh stays saturated red. Bare metal keeps more of its true
// value, because albedo is its reflectance and a lift reads as chrome.
sAlb *= mix(3.0 / (1.0 + max(sAlb.r, max(sAlb.g, sAlb.b)) * 2.4), 1.0, sMetal * 0.6);

#ifdef OP2_FAR
vec4 micro = vec4(0.5);
vec4 macro = vec4(0.5);
float sH = 0.0;
#else
vec3 tw = pow(abs(sN), vec3(4.0));
tw /= tw.x + tw.y + tw.z;
vec4 micro = op2Tri(vBind * 7.0, tw);
vec4 macro = op2Tri(vBind * 0.9 + 0.37, tw);
float sH = dot(micro, vDetailW) - 0.5;
sAlb *= 1.0 + sH * 0.22;
sRough = clamp(sRough + sH * 0.26, 0.05, 1.0);
#endif
float sBumpScale = dot(vDetailW, vec4(0.00035, 0.0005, 0.00011, 0.0004));
float sAddEmis = 0.0;
vec3 sGlow = vec3(0.0);

#ifdef OP2_SKINNED
{
  vec4 ex = op2Extra(${EXTRA_PARAMS});
  vec4 info = op2Extra(${EXTRA_INFO});
  float blood = ex.x, flash = ex.y, burn = ex.z, frost = ex.w;
  float seed = info.y;
  float grain = macro.r * 0.6 + macro.a * 0.4;

  if (burn > 0.001) {
    float n = grain * 0.7 + micro.b * 0.3;
    float edge = burn * 1.45 - 0.2;
    float charred = smoothstep(edge + 0.1, edge - 0.08, n);
    float ember = smoothstep(0.035, 0.0, abs(n - edge)) * step(burn, 0.995);
    float crack = smoothstep(0.42, 0.5, micro.g * 0.5 + macro.b * 0.5) * charred;
    sAlb = mix(sAlb, vec3(0.012, 0.009, 0.008), charred);
    sRough = mix(sRough, 0.92, charred);
    sMetal *= 1.0 - charred;
    sGlow += vec3(1.0, 0.24, 0.03) * (ember * 3.5 + crack * burn * (1.0 - burn) * 3.0);
  }

  if (blood > 0.001) {
    // Coverage grows out of the creases: the threshold walks down through the noise as blood rises.
    float t = mix(0.8, 0.22, blood);
    float m = smoothstep(t, t + 0.11, grain * 0.6 + macro.g * 0.24 + micro.r * 0.16 + (1.0 - vColorAO.a) * 0.22);
    sAlb = mix(sAlb, vec3(0.34, 0.0, 0.004), m * 0.92);
    sRough = mix(sRough, 0.2, m);
    sMetal *= 1.0 - m;
  }

  int wounds = int(info.x);
  if (wounds > 0) {
    float hole = 0.0, stain = 0.0;
    for (int i = 0; i < ${MAX_WOUNDS}; i++) {
      if (i >= wounds) break;
      vec4 w = op2Extra(${EXTRA_WOUNDS} + i);
      vec3 d = vBind - w.xyz;
      float rr = length(d) / w.w;
      // Blood runs down the body, so the stain stretches below the wound.
      float dripY = d.y < 0.0 ? d.y * 0.32 : d.y;
      float wob = (macro.a - 0.5) * 1.1 + (micro.r - 0.5) * 0.5;
      float rs = length(vec3(d.x, dripY, d.z)) / (w.w * 1.0);
      hole = max(hole, smoothstep(0.42, 0.26, rr + wob * 0.25));
      stain = max(stain, smoothstep(1.45, 0.62, rs + wob * 0.6));
    }
    sAlb = mix(sAlb, vec3(0.36, 0.0, 0.004), stain * 0.94);
    sRough = mix(sRough, 0.16, stain);
    sMetal *= 1.0 - stain;
    sAlb = mix(sAlb, vec3(0.03, 0.0, 0.0), hole);
    sH -= hole * 3.0;
  }

  if (frost > 0.001) {
    float f = smoothstep(1.0 - frost * 1.1, 1.05 - frost * 0.9, grain + 0.25);
    sAlb = mix(sAlb, vec3(0.62, 0.8, 0.95), f * 0.85);
    sRough = mix(sRough, 0.14, f);
    sMetal *= 1.0 - f;
    sGlow += vec3(0.1, 0.3, 0.55) * f * 0.25;
  }

  // A dull red pulse: a bright full-body flash read as cartoonish. Hit markers carry the confirmation.
  sGlow += vec3(0.5, 0.05, 0.03) * flash * 0.45;
}
#endif
diffuseColor.rgb = sAlb;
`;

const FRAG_NORMAL = /* glsl */ `
{
  vec3 op2Obj = mat3(vSk0, vSk1, vSk2) * sN;
  normal = normalize(normalMatrix * op2Obj);
  #ifndef OP2_FAR
  normal = op2Bump(-vViewPosition, normal, sH * sBumpScale, faceDirection);
  #endif
}
`;

// The rim is a readability cheat: the world is dark on purpose, and a body has to separate from it at 40 m.
const FRAG_EMISSIVE = /* glsl */ `
{
  float op2Rim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
  totalEmissiveRadiance += sAlb * sEmis * uEmissive + sGlow + vec3(0.32, 0.48, 0.72) * (op2Rim * uRim * vColorAO.a);
}
`;

const FRAG_AO = /* glsl */ `
{
  float op2Ao = vColorAO.a;
  op2Ao = mix(1.0, op2Ao, 0.85);
  reflectedLight.indirectDiffuse *= op2Ao;
  reflectedLight.indirectSpecular *= op2Ao;
  // A floor under the baked light. Enemies must stay legible where the map itself goes black.
  reflectedLight.indirectDiffuse += material.diffuseColor * vec3(0.5, 0.62, 0.8) * (uFill * RECIPROCAL_PI * op2Ao);
}
`;

/** Tileable noise, one kind per channel: skin pores, cloth weave, metal scratches, rubber pebbling. */
export function createDetailTexture(): THREE.DataTexture {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const rnd = mulberry32(0x0f2ce);
  const lattice = (size: number) => {
    const g = new Float32Array(size * size);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    return (x: number, y: number) => {
      const fx = x * size, fy = y * size;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy;
      const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty);
      const a = g[(ix % size) + (iy % size) * size]!, b = g[((ix + 1) % size) + (iy % size) * size]!;
      const c = g[(ix % size) + ((iy + 1) % size) * size]!, d = g[((ix + 1) % size) + ((iy + 1) % size) * size]!;
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  };
  const l8 = lattice(8), l16 = lattice(16), l32 = lattice(32), l64 = lattice(64), l128 = lattice(128);
  const scratches = new Float32Array(N * N);
  for (let i = 0; i < 900; i++) {
    let x = rnd() * N, y = rnd() * N;
    const a = rnd() * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    const len = 8 + rnd() * 70;
    const depth = 0.25 + rnd() * 0.75;
    for (let s = 0; s < len; s++) {
      const px = ((x | 0) + N) % N, py = ((y | 0) + N) % N;
      scratches[px + py * N] = Math.max(scratches[px + py * N]!, depth);
      x += dx; y += dy;
    }
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = i / N, v = j / N;
      const o = (i + j * N) * 4;
      const pores = l32(u, v) * 0.4 + l64(u, v) * 0.34 + l128(u, v) * 0.26;
      const wrinkle = Math.abs(l16(u, v) - 0.5) * 2;
      data[o] = 255 * clampB(pores * 1.1 - (1 - wrinkle) * 0.16 + 0.05);
      const weave = (Math.sin(u * Math.PI * 2 * 64) * 0.5 + 0.5) * (Math.sin(v * Math.PI * 2 * 64) * 0.5 + 0.5);
      const warp = (Math.sin((u + v) * Math.PI * 2 * 32) * 0.5 + 0.5);
      data[o + 1] = 255 * clampB(weave * 0.6 + warp * 0.1 + l32(u, v) * 0.3);
      data[o + 2] = 255 * clampB(0.56 - scratches[i + j * N]! * 0.5 + (l64(u, v) - 0.5) * 0.2 + (l8(u, v) - 0.5) * 0.12);
      data[o + 3] = 255 * clampB(l64(u, v) * 0.7 + l16(u, v) * 0.3);
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

const clampB = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export interface SurfaceOptions {
  detail: THREE.Texture;
  atlasA: THREE.Texture | null;
  atlasB: THREE.Texture | null;
  /** First texel after the bone matrices. */
  extraBase: number;
  emissive?: number;
  /** Distant variant: vertex colours only, no micro detail. */
  far?: boolean;
}

export function createCharacterMaterial(ctx: Ctx, o: SurfaceOptions): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1 });
  const atlas = o.atlasA !== null && !o.far;
  if (atlas) material.defines = { ...material.defines, OP2_ATLAS: 1 };
  if (o.far) material.defines = { ...material.defines, OP2_FAR: 1 };
  material.onBeforeCompile = shader => {
    shader.uniforms.tDetail = { value: o.detail };
    shader.uniforms.uExtraBase = { value: o.extraBase };
    shader.uniforms.uEmissive = { value: o.emissive ?? 7 };
    shader.uniforms.uRim = { value: 0.3 };
    shader.uniforms.uFill = { value: 0.75 };
    if (atlas) {
      shader.uniforms.tAtlasA = { value: o.atlasA };
      shader.uniforms.tAtlasB = { value: o.atlasB };
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
    // three only defines USE_SKINNING for the vertex stage.
    const skinned = (shader as unknown as { skinning: boolean }).skinning;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${skinned ? '#define OP2_SKINNED\n' : ''}${FRAG_PARS}`)
      .replace('#include <color_fragment>', FRAG_SURFACE)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = sRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = sMetal;')
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <emissivemap_fragment>', FRAG_EMISSIVE)
      .replace('#include <aomap_fragment>', FRAG_AO);
  };
  // The bone count is a uniform, so every archetype shares these few programs.
  material.customProgramCacheKey = () => `op2char:${atlas ? 1 : 0}:${o.far ? 1 : 0}`;
  // A stub render system returns undefined here, and the sandbox then lights the material itself.
  const patched = ctx.render.materials?.patch?.(material);
  return patched ?? material;
}
