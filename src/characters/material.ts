/**
 * Character surface. One MeshStandardMaterial per model, shared by every instance: all per-instance state
 * (wounds, blood, burn, frost, hit flash) rides in spare texels at the end of the instance's bone texture,
 * which is already bound and uploaded per skeleton. That keeps a crowd on one program and one material with
 * no per-object uniform traffic.
 *
 * Wounded bodies swap to a second program. `discard` turns off hidden surface removal on Apple's GPUs for everything
 * in the draw, so it must not be anywhere near a healthy crowd.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import { mulberry32 } from '../core/math';
import { EXTRA_INFO, EXTRA_PARAMS, WOUND_COMMON, WOUND_REGION, WOUND_VERTEX_LOOP } from './anatomy/glsl';

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
#ifdef OP2_WOUNDS
varying vec3 vWoundTilt;
varying float vWoundNear;
flat varying int vRegion;
#endif
`;

/** Goes after three's skinning declarations, which it reads. */
const VERT_WOUND_PARS = /* glsl */ `
#ifdef OP2_WOUNDS
uniform int uExtraBase;
${WOUND_COMMON}
${WOUND_REGION}
#endif
`;

const VERT_MAIN = /* glsl */ `
#ifdef OP2_WOUNDS
{
  vec3 op2Push = vec3(0.0), op2Tilt = vec3(0.0);
  float op2Near = -1.0;
  ${WOUND_VERTEX_LOOP}
  vWoundNear = op2Near;
  vWoundTilt = op2Tilt;
  vRegion = op2Region();
  transformed += op2Push;
}
#endif
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
${WOUND_COMMON}
#endif
#ifdef OP2_WOUNDS
varying vec3 vWoundTilt;
varying float vWoundNear;
flat varying int vRegion;
#endif
vec4 op2Tri(vec3 p, vec3 w) {
  return texture2D(tDetail, p.zy) * w.x + texture2D(tDetail, p.xz) * w.y + texture2D(tDetail, p.xy) * w.z;
}
// Thin connected lines, from where noise crosses its middle value: the shape of mud drying out.
float op2Crack(vec4 macro, vec4 micro) {
  #ifdef OP2_FAR
  return 0.0;
  #endif
  float a = 1.0 - abs(macro.a * 2.0 - 1.0) * 5.0;
  float b = 1.0 - abs(macro.r * 2.0 - 1.0) * 6.0;
  return smoothstep(0.35, 0.8, max(a, b) + (micro.r - 0.5) * 0.3);
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
#ifdef OP2_WOUNDS
// The inside of the far wall, seen through a hole. It closes the body off exactly where the skin does, and nothing in
// there has any light to speak of, so none of the lighting below is worth running. The bake leaves the odd triangle
// wound backwards. Those still have normals facing out, and stay skin.
if (!gl_FrontFacing && dot(normalMatrix * (mat3(vSk0, vSk1, vSk2) * vBindN), vViewPosition) < 0.0) {
  gl_FragColor = vec4(0.012, 0.001, 0.001, 1.0);
  return;
}
#endif
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
vec3 sGlow = vec3(0.0);
float sWoundH = 0.0;

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
    float crack = op2Crack(macro, micro) * charred;
    sAlb = mix(sAlb, vec3(0.012, 0.009, 0.008), charred);
    sRough = mix(sRough, 0.92, charred);
    sMetal *= 1.0 - charred;
    // The char splits as it shrinks, and what shows in the splits is raw.
    sAlb = mix(sAlb, vec3(0.13, 0.01, 0.006), crack);
    sRough = mix(sRough, 0.34, crack);
    sGlow += vec3(1.0, 0.24, 0.03) * (ember * 3.5 + crack * burn * (1.0 - burn) * 3.0);
  }

  if (blood > 0.001) {
    // Coverage grows out of the creases: the threshold walks down through the noise as blood rises.
    // It stops well short of the whole body: past a point, a figure in blotches reads as camouflage, not as blood.
    float t = mix(0.85, 0.6, blood);
    float m = smoothstep(t, t + 0.2, grain * 0.6 + macro.g * 0.24 + micro.r * 0.16 + (1.0 - vColorAO.a) * 0.3);
    sAlb = mix(sAlb, mix(vec3(0.15, 0.004, 0.005), vec3(0.07, 0.002, 0.004), macro.a), m * 0.9);
    sRough = mix(sRough, 0.2, m);
    sMetal *= 1.0 - m;
  }

  #ifdef OP2_WOUNDS
  if (vWoundNear > 0.0) {
    int wounds = int(info.x);
    // Metres outside the nearest cut, and how much of each kind of damage this pixel is in.
    float edge = 1.0, rimWidth = 0.01, bruise = 0.0, stain = 0.0, scorch = 0.0, pit = 0.0, torn = 0.0;
    float tear = (macro.a - 0.5) * 2.2 + (macro.r - 0.5) * 1.3 + (micro.r - 0.5) * 0.9;
    for (int i = 0; i < OP2_MAX_WOUNDS; i++) {
      if (i >= wounds) break;
      int base = OP2_WOUND_BASE + i * OP2_WOUND_TEXELS;
      vec4 t0 = op2Extra(base), t1 = op2Extra(base + 1), t2 = op2Extra(base + 2);
      int code = int(t2.w);
      if (((code >> 3) & vRegion) == 0) continue;
      int kind = code & 7;
      float depth = length(t2.xyz);
      vec3 axis = t2.xyz / max(depth, 1e-4);
      float along, radius;
      vec3 off;
      float dist = op2Slot(vBind, t0, t1, axis, along, off, radius);
      float past = op2SlotEnds(along, 0.14, depth + 0.08, t0.w);
      if (past > t0.w * 3.0 + 0.06) continue;
      // Stretched below the wound, because blood runs down. Bind space keeps that on a corpse too, as a stain it had.
      float run = length(off - vec3(0.0, min(off.y, 0.0) * 0.68, 0.0)) + past * 2.0;
      float spread = t0.w * 2.6 + 0.03;
      if (kind != OP2_DENT) stain = max(stain, smoothstep(1.0, 0.25, run / spread + tear * 0.28));
      if (kind == OP2_BURN) {
        scorch = max(scorch, smoothstep(1.15, 0.55, (dist + past * 2.0) / t0.w + tear * 0.35));
      } else if (kind == OP2_GRAZE) {
        bruise = max(bruise, smoothstep(1.2, 0.3, (dist + past * 2.0) / t0.w + tear * 0.4));
      } else if (kind == OP2_DENT) {
        float m = dist + past * 2.0 - radius * (1.0 + tear * 0.3);
        pit = max(pit, smoothstep(0.003, -0.002, m));
        torn = max(torn, smoothstep(radius * 0.5, 0.0, abs(m)));
      } else {
        // Skin tears along weak lines, so a ragged wound wanders much further than a clean one.
        float m = dist + past * 2.0 - radius * (1.0 + tear * mix(0.1, 0.62, t1.w));
        if (m < edge) {
          edge = m;
          rimWidth = kind == OP2_GASH ? 0.004 : clamp(radius * 0.4, 0.0045, 0.028);
        }
      }
    }
    if (edge < 0.0) discard;

    if (scorch > 0.0) {
      float split = op2Crack(macro, micro) * scorch;
      sAlb = mix(sAlb, vec3(0.012, 0.009, 0.008), scorch);
      sRough = mix(sRough, 0.9, scorch);
      sMetal *= 1.0 - scorch;
      sAlb = mix(sAlb, vec3(0.13, 0.01, 0.006), split);
      sRough = mix(sRough, 0.34, split);
    }
    float bare = 1.0 - sMetal;
    if (stain > 0.0) {
      // Dark where it is thick. Bright paint is what made the old wounds look drawn on.
      float wet = stain * (0.8 + grain * 0.2);
      sAlb = mix(sAlb, mix(vec3(0.17, 0.006, 0.007), vec3(0.075, 0.002, 0.003), stain * stain), wet * 0.94);
      sRough = mix(sRough, 0.17, wet);
      sMetal *= 1.0 - wet;
    }
    if (bruise > 0.0) {
      sAlb = mix(sAlb, vec3(0.05, 0.012, 0.03), bruise * 0.8 * bare);
      sRough = mix(sRough, 0.3, bruise);
    }
    float ring = 1.0 - smoothstep(0.0, rimWidth * 3.0, edge);
    float rim = 1.0 - smoothstep(0.0, rimWidth, edge);
    if (ring > 0.0) {
      // Bruised, then torn. Fat shows in a thin line where the skin parted, only on bare skin.
      sAlb = mix(sAlb, vec3(0.035, 0.004, 0.008), ring * 0.8);
      vec3 raw = mix(vec3(0.19, 0.02, 0.016), vec3(0.042, 0.003, 0.003), smoothstep(0.35, 1.0, rim + (micro.g - 0.5) * 0.5));
      sAlb = mix(sAlb, raw, rim);
      sAlb = mix(sAlb, vec3(0.42, 0.28, 0.17), smoothstep(0.82, 0.98, rim) * vDetailW.x * 0.65);
      sRough = mix(sRough, 0.2, ring);
      sMetal *= 1.0 - rim;
      sWoundH -= rim * rim * rimWidth * 0.7;
    }
    if (pit > 0.0 || torn > 0.0) {
      sAlb = mix(sAlb, vec3(0.3, 0.3, 0.32), torn);
      sMetal = mix(sMetal, 1.0, torn);
      sRough = mix(sRough, 0.3, torn);
      sAlb = mix(sAlb, vec3(0.006), pit);
      sMetal *= 1.0 - pit;
      sRough = mix(sRough, 0.8, pit);
      sWoundH -= pit * 0.012;
    }
  }
  #endif

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
#ifdef OP2_WOUNDS
sN = normalize(sN + vWoundTilt);
#endif
diffuseColor.rgb = sAlb;
`;

const FRAG_NORMAL = /* glsl */ `
{
  vec3 op2Obj = mat3(vSk0, vSk1, vSk2) * sN;
  normal = normalize(normalMatrix * op2Obj);
  #ifndef OP2_FAR
  normal = op2Bump(-vViewPosition, normal, sH * sBumpScale + sWoundH, faceDirection);
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
  /** For bodies with wounds: cut-outs, craters and torn edges. Skinned meshes only. */
  wounds?: boolean;
}

export function createCharacterMaterial(ctx: Ctx, o: SurfaceOptions): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1 });
  const atlas = o.atlasA !== null && !o.far;
  if (atlas) material.defines = { ...material.defines, OP2_ATLAS: 1 };
  if (o.far) material.defines = { ...material.defines, OP2_FAR: 1 };
  if (o.wounds) {
    material.defines = { ...material.defines, OP2_WOUNDS: 1 };
    material.side = THREE.DoubleSide;
  }
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
      .replace('#include <skinning_pars_vertex>', `#include <skinning_pars_vertex>\n${VERT_WOUND_PARS}`)
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
  material.customProgramCacheKey = () => `op2char:${atlas ? 1 : 0}:${o.far ? 1 : 0}:${o.wounds ? 1 : 0}`;
  // A stub render system returns undefined here, and the sandbox then lights the material itself.
  const patched = ctx.render.materials?.patch?.(material);
  return patched ?? material;
}
