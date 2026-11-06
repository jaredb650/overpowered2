/**
 * The skin seen from inside, in one cheap draw that does two jobs for an opened body.
 *
 * In the main pass its back faces are the far wall of the body: what a hole looks onto past the flesh. The skin itself
 * cannot do that, because going double-sided costs a body a third of its shading. Drawn after the skin, this loses the
 * depth test everywhere but in the holes.
 *
 * In the moon's depth pass it is the shadow, holes and all. That pass draws every caster with one plain material, which
 * knows nothing of wounds, and the skin's own program cannot stand in because it samples the map being drawn. The moon is
 * the only orthographic camera a body ever sees, so `isOrthographic` tells the two apart.
 */
import * as THREE from 'three';
import { WOUND_COMMON, WOUND_REGION, WOUND_VERTEX_LOOP } from './glsl';

const VERT_PARS = /* glsl */ `
varying vec3 vBind;
varying float vWoundNear;
varying float vFacing;
flat varying int vRegion;
`;

const VERT_SKIN_PARS = /* glsl */ `
uniform int uExtraBase;
${WOUND_COMMON}
${WOUND_REGION}
`;

const VERT_MAIN = /* glsl */ `
vBind = position;
vWoundNear = -1.0;
vRegion = op2Region();
if (isOrthographic) {
  vec3 op2Push = vec3(0.0), op2Tilt = vec3(0.0);
  float op2Near = -1.0;
  ${WOUND_VERTEX_LOOP}
  vWoundNear = op2Near;
  transformed += op2Push;
}
`;

const VERT_FACING = /* glsl */ `
vFacing = dot(transformedNormal, -mvPosition.xyz);
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vBind;
varying float vWoundNear;
varying float vFacing;
flat varying int vRegion;
uniform highp sampler2D boneTexture;
uniform int uExtraBase;
${WOUND_COMMON}
`;

const FRAG_MAIN = /* glsl */ `
// The bake leaves the odd triangle wound backwards. It is not the far wall of anything. three flips normals on a material
// that draws back faces, so here a true far wall faces the eye and that triangle faces away.
if (!isOrthographic && vFacing < 0.0) discard;
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

export function createBackingMaterial(extraBase: number): THREE.MeshBasicMaterial {
  // Offset as the shared depth pass offsets, or a wounded body would shadow itself differently from a healthy one.
  const material = new THREE.MeshBasicMaterial({ side: THREE.BackSide, polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2 });
  // Nothing in there has any light to speak of.
  material.color.setRGB(0.012, 0.001, 0.001);
  material.allowOverride = false;
  material.onBeforeCompile = shader => {
    shader.uniforms.uExtraBase = { value: extraBase };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <skinning_pars_vertex>', `#include <skinning_pars_vertex>\n${VERT_SKIN_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_FACING}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', FRAG_MAIN);
  };
  material.customProgramCacheKey = () => 'op2backing';
  return material;
}
