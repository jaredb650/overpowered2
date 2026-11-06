/**
 * The surface of everything under the skin. Drawn after the skin, so depth testing throws away all but what shows
 * through a hole, and this shader only ever runs on those pixels.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { WOUND_COMMON, WOUND_REGION } from './glsl';
import { Part } from './build';

const VERT_PARS = /* glsl */ `
attribute vec4 aTint;
varying vec3 vBind;
varying vec3 vBindN;
varying vec3 vTint;
varying vec3 vSk0;
varying vec3 vSk1;
varying vec3 vSk2;
flat varying int vPart;
flat varying int vRegion;
`;

const VERT_SKIN_PARS = /* glsl */ `
uniform int uExtraBase;
${WOUND_COMMON}
${WOUND_REGION}
`;

const VERT_MAIN = /* glsl */ `
{
  vBind = position;
  vBindN = normal;
  vTint = aTint.rgb / 255.0;
  vSk0 = skinMatrix[0].xyz; vSk1 = skinMatrix[1].xyz; vSk2 = skinMatrix[2].xyz;
  vRegion = op2Region();
  int code = int(aTint.a + 0.5);
  vPart = code & 7;
  // Collapsed to one point until the joint it belongs to has gone.
  if (vPart == ${Part.shard} && ((int(op2Extra(OP2_INFO).z) >> (code >> 3)) & 1) == 0) transformed = vec3(0.0);
}
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vBind;
varying vec3 vBindN;
varying vec3 vTint;
varying vec3 vSk0;
varying vec3 vSk1;
varying vec3 vSk2;
flat varying int vPart;
flat varying int vRegion;
uniform mat3 normalMatrix;
uniform sampler2D tDetail;
uniform highp sampler2D boneTexture;
uniform int uExtraBase;
${WOUND_COMMON}
vec4 op2Tri(vec3 p, vec3 w) {
  return texture2D(tDetail, p.zy) * w.x + texture2D(tDetail, p.xz) * w.y + texture2D(tDetail, p.xy) * w.z;
}
vec3 op2Bump(vec3 pos, vec3 n, float h, float face) {
  vec3 sx = dFdx(pos), sy = dFdy(pos);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * face;
  vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - g);
}
`;

const FRAG_SURFACE = /* glsl */ `
vec3 sN = normalize(vBindN);
vec3 tw = pow(abs(sN), vec3(4.0));
tw /= tw.x + tw.y + tw.z;
vec4 micro = op2Tri(vBind * 9.0, tw);
vec4 macro = op2Tri(vBind * 1.6 + 0.23, tw);
// Long along the body, the way muscle and blood vessels run.
vec4 fibre = op2Tri(vBind * vec3(26.0, 5.0, 26.0), tw);
float tear = (macro.a - 0.5) * 2.0 + (micro.r - 0.5) * 1.2;
// How much light gets down here, from the open wound it has the best view of. Anything no wound opens onto is seen
// past an edge, from deep inside, and stays dark.
float sLight = 0.04;
// Nearest distance to the clean middle of a wound, which is where the layers have been taken away.
float sCore = 1.0;
float sGore = 0.0;
// Whether this is under a hole at all. Nothing here is fitted so closely that it never comes through the skin.
float sHole = 1.0;
int count = int(op2Extra(OP2_INFO).x);
for (int i = 0; i < OP2_MAX_WOUNDS; i++) {
  if (i >= count) break;
  int base = OP2_WOUND_BASE + i * OP2_WOUND_TEXELS;
  vec4 t0 = op2Extra(base), t1 = op2Extra(base + 1), t2 = op2Extra(base + 2);
  int code = int(t2.w);
  int kind = code & 7;
  if (kind == OP2_BURN || kind == OP2_GRAZE || kind == OP2_DENT) continue;
  float depth = length(t2.xyz);
  vec3 axis = t2.xyz / max(depth, 1e-4);
  float along, radius;
  vec3 off;
  float dist = op2Slot(vBind, t0, t1, axis, along, off, radius);
  float under = max(along, 0.0);
  float past = op2SlotEnds(along, OP2_SKIN_ABOVE, depth + t0.w);
  float open = smoothstep(radius * 1.15, radius * 0.45, dist);
  sLight = max(sLight, open * exp(-under / (radius * 1.5 + 0.015)));
  // Layers go by how far the wound reached. A gash only opens what it passes through.
  float reachShare = vPart == ${Part.muscle} ? 0.72 : vPart == ${Part.bone} ? 0.3 : 0.0;
  float enough = vPart == ${Part.muscle} ? step(0.03, depth) : vPart == ${Part.bone} && kind == OP2_CRATER ? step(0.075, depth) : 0.0;
  if (((code >> 3) & vRegion) != 0 && enough > 0.5) {
    float m = dist + past * 3.0 - radius * reachShare * (1.0 + tear * mix(0.15, 0.45, t1.w));
    sCore = min(sCore, m);
  }
  sGore = max(sGore, smoothstep(radius * 2.2, radius * 0.6, dist + past));
  if (((code >> 3) & vRegion) != 0) sHole = min(sHole, dist + past * 2.0 - radius * 1.5);
}
if (sCore < 0.0 || (sHole > 0.0 && vPart != ${Part.shard})) discard;

// Channel g of the detail texture is cloth weave, and shows up on anything it is used for as a bandage.
vec3 sAlb = vTint;
float sRough = 0.34;
float sHeight = 0.0;
if (vPart == ${Part.muscle}) {
  float streak = fibre.a * 0.65 + fibre.r * 0.35;
  sAlb = mix(vec3(0.3, 0.04, 0.04), vec3(0.06, 0.004, 0.009), smoothstep(0.36, 0.64, streak));
  // Fat in clumps between the fibres, thin here and thick there.
  sAlb = mix(sAlb, vec3(0.4, 0.27, 0.13), smoothstep(0.6, 0.7, macro.a * 0.7 + micro.a * 0.3) * 0.28);
  sRough = mix(0.22, 0.42, streak);
  sHeight = (streak - 0.5) * 0.005;
} else if (vPart == ${Part.bone} || vPart == ${Part.shard}) {
  // Never clean. Blood sits on it in a film, and the bone shows through where it has run off.
  float film = smoothstep(0.34, 0.62, macro.a * 0.55 + micro.a * 0.45);
  sAlb = mix(vTint * (0.5 + micro.r * 0.32), vec3(0.11, 0.011, 0.009), film * 0.82);
  sRough = mix(0.42, 0.2, film);
  sHeight = (micro.a - 0.5) * 0.0016;
} else {
  float veins = smoothstep(0.86, 0.97, 1.0 - abs(fibre.a * 2.0 - 1.0));
  sAlb = vTint * (0.5 + macro.a * 0.8);
  sAlb = mix(sAlb, sAlb * vec3(0.42, 0.2, 0.32), veins * 0.7);
  sRough = 0.15 + micro.a * 0.14;
  sHeight = (macro.a - 0.5) * 0.008 + (micro.a - 0.5) * 0.0012;
}
// Everything near a wound has blood on it.
sAlb = mix(sAlb, vec3(0.11, 0.005, 0.006), sGore * 0.4 * (vPart == ${Part.bone} ? 0.5 : 1.0));
diffuseColor.rgb = sAlb;
`;

const FRAG_NORMAL = /* glsl */ `
{
  vec3 op2Obj = mat3(vSk0, vSk1, vSk2) * sN;
  normal = normalize(normalMatrix * op2Obj) * faceDirection;
  normal = op2Bump(-vViewPosition, normal, sHeight, faceDirection);
}
`;

const FRAG_AO = /* glsl */ `
{
  reflectedLight.indirectDiffuse *= sLight;
  reflectedLight.indirectSpecular *= sLight;
  reflectedLight.directDiffuse *= sLight;
  reflectedLight.directSpecular *= sLight;
  // A warm light from the viewer's side. This map lights everything blue and dim, which turns red to black, and a wound
  // has to read as flesh wherever it is. Coming from the eye, it shapes what it falls on and gives wet things a shine.
  float op2Facing = saturate(dot(normal, normalize(vViewPosition)));
  reflectedLight.indirectDiffuse += material.diffuseColor * vec3(1.0, 0.8, 0.78) * (uFill * sLight * (0.2 + op2Facing * 0.8));
  reflectedLight.directSpecular += vec3(1.0, 0.86, 0.8) * (pow(op2Facing, 42.0) * (1.0 - sRough) * 0.3 * sLight);
}
`;

export function createInteriorMaterial(ctx: Ctx, detail: THREE.Texture, extraBase: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  material.onBeforeCompile = shader => {
    shader.uniforms.tDetail = { value: detail };
    shader.uniforms.uExtraBase = { value: extraBase };
    shader.uniforms.uFill = { value: 0.6 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <skinning_pars_vertex>', `#include <skinning_pars_vertex>\n${VERT_SKIN_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uFill;\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', FRAG_SURFACE)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = sRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <aomap_fragment>', FRAG_AO);
  };
  material.customProgramCacheKey = () => 'op2interior';
  const patched = ctx.render.materials?.patch?.(material);
  return patched ?? material;
}
