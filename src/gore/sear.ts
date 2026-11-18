/**
 * The energy blade's halves burning away (sliced.ts): the Lance's vaporize (Gore.vaporize, characters/material.ts) on a cut
 * piece. A whole body burns on spare texels of its bone texture; a half is an unskinned mesh with none, so each burning half
 * gets its own copy of the skin and the cut face, sharing one uniform, `uSear`, from 0 (as cut) to 1 (gone). The copies keep
 * the originals' hooks and program keys plus ':sear', so every burning half draws with the same two programs.
 *
 * For the first fifth or so the halves are themselves, with the cut edge molten, so the cut reads; then the piece chars and
 * lights from inside, and holes eat in, the nearer the cut the sooner, each with a hot rim, until nothing is left.
 */
import * as THREE from 'three';

const PARS = /* glsl */ `
uniform float uSear;
uniform vec4 uSearPlane;
varying vec3 vSearP;
float searHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float searNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(searHash(i), searHash(i + vec3(1, 0, 0)), f.x), mix(searHash(i + vec3(0, 1, 0)), searHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(searHash(i + vec3(0, 0, 1)), searHash(i + vec3(1, 0, 1)), f.x), mix(searHash(i + vec3(0, 1, 1)), searHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
`;

const FRAG = /* glsl */ `
{
  float n = searNoise(vSearP * 11.0) * 0.6 + searNoise(vSearP * 31.0) * 0.4;
  // Metres from the cut, in the piece's own frame.
  float d = abs(dot(vSearP, uSearPlane.xyz) - uSearPlane.w);
  float k = uSear;
  float m = n * 0.7 + min(d * 2.2, 1.0) * 0.3;
  float hole = k * 1.5 - 0.45;
  if (m < hole) discard;
  float rim = smoothstep(0.07, 0.0, m - hole) * step(0.0, hole);
  float charred = smoothstep(0.22, 0.6, k);
  float hot = 1.0 - smoothstep(0.2, 0.85, k);
  outgoingLight *= 1.0 - charred * 0.92;
  // The seam the blade left, and the whole cut face: molten, cooling as the piece burns.
  float seam = smoothstep(0.045, 0.0, d);
  outgoingLight += vec3(1.0, 0.5, 0.16) * seam * (1.2 + 3.5 * hot) * (0.8 + 0.4 * n);
  outgoingLight += vec3(0.3, 0.7, 1.0) * charred * hot * (0.5 + n);
  outgoingLight += vec3(1.0, 0.42, 0.08) * rim * 9.0;
}
`;

export interface Sear {
  readonly materials: THREE.Material[];
  readonly k: { value: number };
}

/** A burning copy of `base`, reading `u`. */
function searing(base: THREE.Material, u: { uSear: { value: number }; uSearPlane: { value: THREE.Vector4 } }): THREE.Material {
  const m = base.clone();
  // A clone has its class's defines and the default hook: the base's own come back here.
  (m as THREE.MeshStandardMaterial).defines = { ...(base as THREE.MeshStandardMaterial).defines };
  m.onBeforeCompile = (shader, renderer) => {
    base.onBeforeCompile(shader, renderer);
    shader.uniforms.uSear = u.uSear;
    shader.uniforms.uSearPlane = u.uSearPlane;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSearP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSearP = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace('#include <opaque_fragment>', `${FRAG}\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => `${base.customProgramCacheKey()}:sear`;
  return m;
}

/** The skin and the cut face of one burning half, cut on the plane through `at` (its own frame) along unit `normal`. */
export function sear(skin: THREE.Material, cap: THREE.Material, normal: THREE.Vector3, at: THREE.Vector3): Sear {
  const u = { uSear: { value: 0 }, uSearPlane: { value: new THREE.Vector4(normal.x, normal.y, normal.z, normal.dot(at)) } };
  return { materials: [searing(skin, u), searing(cap, u)], k: u.uSear };
}
