import * as THREE from 'three';
import type { ShaderHook } from './patch';

export interface WorldSurfaceParams {
  albedo: THREE.Texture;
  surface: THREE.Texture;
  /** Meters covered by one tile of the texture set. */
  tile: number;
  normalScale: number;
  /** 0 dry, 1 very wet. Only surfaces facing up pool water. */
  wetness: number;
  /** Strength of low-frequency variation, which hides the tiling at a distance. */
  macro: number;
  /** Lava: `surface.a` is heat rather than metalness. */
  lava?: boolean;
  masked?: boolean;
}

const PARS = /* glsl */ `
uniform sampler2D opT0;
uniform sampler2D opT1;
uniform sampler2D opNoise;
uniform vec4 opSurf;
#ifdef OPAQUE
uniform float opViewPass;
#endif
uniform float opTime;
`;

/**
 * Projects textures from world position instead of mesh UVs: geometry needs no UVs at all, scaled boxes
 * tile at true size, and neighbouring meshes line up. Faces of a box hit one axis, so the
 * branches skip the other two projections and it costs one lookup per texture.
 */
const SURFACE = /* glsl */ `
vec3 opPos = (opCamToWorld * vec4(-vViewPosition, 1.0)).xyz;
vec3 opGeoN = normalize(mat3(opCamToWorld) * vNormal);
#ifdef DOUBLE_SIDED
  opGeoN *= gl_FrontFacing ? 1.0 : -1.0;
#endif
// World-space projection would swim on a viewmodel, which is rigid in eye space instead.
vec3 opTexP = opViewPass > 0.5 ? -vViewPosition : opPos;
vec3 opTexN = opViewPass > 0.5 ? normalize(vNormal) : opGeoN;
vec3 opW = pow(abs(opTexN), vec3(12.0));
opW /= opW.x + opW.y + opW.z;
opW = max(opW - 0.02, 0.0);
opW /= opW.x + opW.y + opW.z;
float opTile = opSurf.x;
vec3 opP = opTexP * opTile;
vec3 opDx = dFdx(opTexP) * opTile;
vec3 opDy = dFdy(opTexP) * opTile;
vec4 opA = vec4(0.0);
vec4 opS = vec4(0.0);
vec3 opNrm = vec3(0.0);
if (opW.x > 0.0) {
  vec4 a = textureGrad(opT0, opP.zy, opDx.zy, opDy.zy);
  vec4 s = textureGrad(opT1, opP.zy, opDx.zy, opDy.zy);
  vec2 t = (s.xy * 2.0 - 1.0) * opSurf.y;
  float tz = sqrt(max(1.0 - dot(t, t), 0.0));
  opA += a * opW.x;
  opS += s * opW.x;
  opNrm += vec3(tz * opTexN.x, t.y + opTexN.y, t.x + opTexN.z) * opW.x;
}
if (opW.y > 0.0) {
  vec4 a = textureGrad(opT0, opP.xz, opDx.xz, opDy.xz);
  vec4 s = textureGrad(opT1, opP.xz, opDx.xz, opDy.xz);
  vec2 t = (s.xy * 2.0 - 1.0) * opSurf.y;
  float tz = sqrt(max(1.0 - dot(t, t), 0.0));
  opA += a * opW.y;
  opS += s * opW.y;
  opNrm += vec3(t.x + opTexN.x, tz * opTexN.y, t.y + opTexN.z) * opW.y;
}
if (opW.z > 0.0) {
  vec4 a = textureGrad(opT0, opP.xy, opDx.xy, opDy.xy);
  vec4 s = textureGrad(opT1, opP.xy, opDx.xy, opDy.xy);
  vec2 t = (s.xy * 2.0 - 1.0) * opSurf.y;
  float tz = sqrt(max(1.0 - dot(t, t), 0.0));
  opA += a * opW.z;
  opS += s * opW.z;
  opNrm += vec3(t.x + opTexN.x, t.y + opTexN.y, tz * opTexN.z) * opW.z;
}
opNrm = normalize(opNrm);
float opRough = opS.z;
float opMetal = opS.w;
float opHeight = opA.w;
vec3 opAlbedo = opA.rgb;

// Macro variation at scales the tile cannot repeat: broad stains, plus vertical runs on walls.
vec4 opMacro = texture(opNoise, opPos.xz * 0.019 + opPos.y * 0.011);
float opWall = 1.0 - abs(opGeoN.y);
float opRun = texture(opNoise, vec2(dot(opPos.xz, vec2(0.13, 0.11)), opPos.y * 0.008)).g;
float opVar = (opMacro.r - 0.5) * opSurf.w;
opAlbedo *= 1.0 + opVar - opWall * smoothstep(0.42, 0.7, opRun) * opSurf.w * 0.8;
opRough = clamp(opRough * (1.0 - opVar * 0.55), 0.04, 1.0);

#ifdef OP_WET
{
  // Water collects in dips at three scales. The broad term makes whole areas dry or wet, so puddles
  // cluster like they do on a real slab instead of covering it in an even camouflage.
  float up = smoothstep(0.82, 0.97, opGeoN.y);
  float wide = texture(opNoise, opPos.xz * 0.0067 + 0.17).r;
  float mid = texture(opNoise, opPos.xz * 0.029).r;
  float fine = texture(opNoise, opPos.xz * 0.13 + 0.3).g;
  float depth = mid * 0.5 + wide * 0.32 + fine * 0.18 + (0.5 - opHeight) * 0.07 + (opWetness - 0.5) * 0.16;
  float puddle = up * smoothstep(0.545, 0.6, depth);
  float damp = up * smoothstep(0.42, 0.56, depth);
  opAlbedo *= mix(1.0, 0.6, damp);
  opRough = mix(opRough, opRough * 0.5, damp);
  opRough = mix(opRough, 0.05, puddle);
  opMetal *= 1.0 - puddle;
  // A faint, slow ripple keeps a puddle from being a perfect mirror of the sky.
  vec2 ripple = (texture(opNoise, opPos.xz * 0.9 + opTime * 0.013).gb - 0.5) * 0.03;
  vec3 still = normalize(opGeoN + vec3(ripple.x, 0.0, ripple.y));
  opNrm = normalize(mix(opNrm, still, puddle * 0.95));
}
#endif

diffuseColor.rgb *= opAlbedo;
#ifdef OP_MASKED
  // Mips average the bars away until nothing passes the 0.5 test but stray dots. Lowering the
  // threshold with distance turns a far grating solid instead of breaking it into a moire.
  float opLod = 0.5 * log2(max(max(dot(opDx, opDx), dot(opDy, opDy)) * 1048576.0, 1e-6));
  diffuseColor.a *= opA.a * mix(1.0, 3.0, smoothstep(0.5, 3.5, opLod));
#endif
`;

const NORMAL = /* glsl */ `
// Eye-space normal. opCamToWorld is a pure rotation here, so transposing it inverts it.
normal = opViewPass > 0.5 ? normalize(opNrm) : normalize(opNrm * mat3(opCamToWorld));
`;

const LAVA = /* glsl */ `
{
  // Heat flows: the crack mask is resampled through a slowly scrolling distortion.
  vec2 flow = opPos.xz * 0.05 + vec2(opTime * 0.006, -opTime * 0.0045);
  float pulse = 0.72 + 0.28 * sin(opTime * 0.7 + texture(opNoise, flow).r * 12.0);
  float heat = pow(clamp(opS.w, 0.0, 1.0), 1.5) * pulse;
  vec3 ramp = mix(vec3(1.0, 0.12, 0.012), vec3(1.0, 0.55, 0.08), smoothstep(0.35, 0.8, heat));
  ramp = mix(ramp, vec3(1.0, 0.86, 0.46), smoothstep(0.82, 1.0, heat));
  totalEmissiveRadiance = ramp * heat * (0.6 + heat * 34.0) + vec3(0.34, 0.03, 0.0) * smoothstep(0.0, 0.3, heat);
}
`;

export function worldSurfaceHook(p: WorldSurfaceParams, shared: { opNoise: THREE.IUniform; opViewPass: THREE.IUniform; opTime: THREE.IUniform }): ShaderHook {
  const own = {
    opT0: { value: p.albedo },
    opT1: { value: p.surface },
    opSurf: { value: new THREE.Vector4(1 / p.tile, p.normalScale, 0, p.macro) },
  };
  return shader => {
    Object.assign(shader.uniforms, own, shared);
    let f = shader.fragmentShader;
    const defines = `${p.wetness > 0 ? `#define OP_WET\n#define opWetness ${p.wetness.toFixed(3)}\n` : ''}${p.masked ? '#define OP_MASKED\n' : ''}`;
    f = f.replace('#include <map_pars_fragment>', `#include <map_pars_fragment>\n${defines}${PARS}`);
    f = f.replace('#include <map_fragment>', SURFACE);
    f = f.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * opRough;');
    f = f.replace('#include <metalnessmap_fragment>', `float metalnessFactor = ${p.lava ? '0.0' : 'metalness * opMetal'};`);
    f = f.replace('#include <normal_fragment_maps>', NORMAL);
    if (p.lava) f = f.replace('#include <emissivemap_fragment>', LAVA);
    shader.fragmentShader = f;
  };
}
