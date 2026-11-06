/**
 * Holes in a body's shadow. The moon's depth pass draws every caster with one plain material, which knows nothing of
 * wounds, and the skin's own program cannot stand in for it because it samples the very map being drawn. So an opened
 * body stops casting from its skin and casts from this: a cheap copy of itself that clips away in every other pass.
 */
import * as THREE from 'three';
import { WOUND_COMMON, WOUND_REGION, WOUND_VERTEX_LOOP } from './glsl';

const VERT_PARS = /* glsl */ `
varying vec3 vBind;
varying float vWoundNear;
flat varying int vRegion;
`;

const VERT_SKIN_PARS = /* glsl */ `
uniform int uExtraBase;
${WOUND_COMMON}
${WOUND_REGION}
`;

const VERT_MAIN = /* glsl */ `
{
  vec3 op2Push = vec3(0.0), op2Tilt = vec3(0.0);
  float op2Near = -1.0;
  ${WOUND_VERTEX_LOOP}
  vBind = position;
  vWoundNear = op2Near;
  vRegion = op2Region();
  transformed += op2Push;
}
`;

// The moon is the only orthographic camera a body ever sees. Anywhere else, all of this lands outside the clip volume.
const VERT_CLIP = /* glsl */ `
if (!isOrthographic) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vBind;
varying float vWoundNear;
flat varying int vRegion;
uniform highp sampler2D boneTexture;
uniform int uExtraBase;
${WOUND_COMMON}
`;

const FRAG_MAIN = /* glsl */ `
if (vWoundNear > 0.0) {
  int count = int(op2Extra(OP2_INFO).x);
  for (int i = 0; i < OP2_MAX_WOUNDS; i++) {
    if (i >= count) break;
    int base = OP2_WOUND_BASE + i * OP2_WOUND_TEXELS;
    vec4 t0 = op2Extra(base);
    if (op2Run(vBind - t0.xyz) > t0.w) continue;
    vec4 t2 = op2Extra(base + 2);
    int code = int(t2.w);
    int kind = code & 7;
    if (((code >> 3) & vRegion) == 0 || kind > OP2_GASH) continue;
    vec4 t1 = op2Extra(base + 1);
    float depth = length(t2.xyz);
    vec3 axis = t2.xyz / max(depth, 1e-4);
    float along, radius;
    vec3 off;
    float dist = op2Slot(vBind, t0, t1, axis, along, off, radius);
    if (dist + op2SlotEnds(along, OP2_SKIN_ABOVE, op2SkinBelow(t1.w)) * 2.0 < radius) discard;
  }
}
`;

export function createShadowMaterial(extraBase: number): THREE.MeshBasicMaterial {
  // Offset as the shared depth pass offsets, or a wounded body would shadow itself differently from a healthy one.
  const material = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2 });
  material.allowOverride = false;
  material.onBeforeCompile = shader => {
    shader.uniforms.uExtraBase = { value: extraBase };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <skinning_pars_vertex>', `#include <skinning_pars_vertex>\n${VERT_SKIN_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_CLIP}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', FRAG_MAIN);
  };
  material.customProgramCacheKey = () => 'op2woundshadow';
  return material;
}
