/**
 * Stump caps. Each severable joint gets two extra pieces of geometry, one facing each way, on cap bones that
 * sit at scale 0 until a limb comes off. They are real meshes rather than a shader trick, so they catch light,
 * cast shadows and survive the funnel the skin collapses into when a bone is scaled away.
 */
import type { RigDef } from '../../src/characters/rig';
import { DETAIL_METAL, DETAIL_SKIN, Field, Model, type Mat } from './model';
import { polygonize } from './polygonize';
import { compact, fieldNormals, simplify } from './meshops';
import {
  at, capsule, cone, cross, displace, ellipsoid, fbm, frameY, noise, norm, scale, sstep, sub, torus, add, cyl,
  type Frame, type V3,
} from './sdf';
import type { Sk } from './parts/skeleton';

const flesh: Mat = {
  albedo: [0.62, 0.035, 0.03], rough: 0.2, detail: DETAIL_SKIN,
  paint: (x, y, z, o) => {
    const n = fbm(x * 42, y * 42, z * 42, 3);
    const f = 0.7 + (n + 0.5) * 0.6;
    o.r *= f; o.g *= f; o.b *= f;
    const fat = sstep(0.12, 0.3, n);
    o.r += (0.8 - o.r) * fat * 0.5; o.g += (0.55 - o.g) * fat * 0.5; o.b += (0.4 - o.b) * fat * 0.5;
  },
};
const boneMat: Mat = { albedo: [0.86, 0.8, 0.68], rough: 0.42, detail: DETAIL_SKIN };
const marrow: Mat = { albedo: [0.32, 0.02, 0.02], rough: 0.25, detail: DETAIL_SKIN };
const fat: Mat = { albedo: [0.82, 0.62, 0.44], rough: 0.32, detail: DETAIL_SKIN };
const metalCap: Mat = { albedo: [0.09, 0.09, 0.1], rough: 0.5, metal: 1, detail: DETAIL_METAL };
const wire: Mat = { albedo: [0.5, 0.24, 0.05], rough: 0.4, metal: 1, detail: DETAIL_METAL };
const hotCap: Mat = { albedo: [1, 0.45, 0.1], rough: 0.4, emissive: 0.8, detail: DETAIL_METAL };

export interface CapMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  colors: Uint8Array;
  materials: Uint8Array;
}

/** Limb radius at a joint, measured by marching out from the bone axis. */
function measure(field: Field, joint: V3, axis: V3, fallback: number): [number, number, V3, V3] {
  // A little way down the limb, because at the joint itself the ray runs into the torso.
  const J = add(joint, scale(axis, fallback));
  let side = cross(axis, [0, 0, 1]);
  if (Math.hypot(...side) < 0.2) side = cross(axis, [1, 0, 0]);
  side = norm(side);
  const up = norm(cross(axis, side));
  const march = (d: V3) => {
    let r = 0.005;
    for (; r < fallback * 1.6; r += 0.003) {
      if (field.dist(J[0] + d[0] * r, J[1] + d[1] * r, J[2] + d[2] * r) > 0) break;
    }
    return r;
  };
  const clampR = (r: number) => Math.min(Math.max(r, fallback * 0.6), fallback * 1.15);
  const rs = clampR((march(side) + march(scale(side, -1))) / 2);
  const ru = clampR((march(up) + march(scale(up, -1))) / 2);
  return [rs, ru, side, up];
}

function buildCap(fr: Frame, rx: number, rz: number, style: 'flesh' | 'machine', seed: number, h: number): CapMesh {
  const m = new Model();
  const r = (rx + rz) / 2;
  const P = (x: number, y: number, z: number): V3 => add(fr.o, add(add(scale(fr.x, x), scale(fr.y, y)), scale(fr.z, z)));
  if (style === 'flesh') {
    const body = at(fr, ellipsoid([0, -r * 0.05, 0], [rx * 1.04, r * 0.46, rz * 1.04]));
    const ragged = displace(body, (x, y, z) => fbm(x * 26 + seed, y * 26, z * 26, 3) * r * 0.36 + noise(x * 70, y * 70 + seed, z * 70) * r * 0.08, r * 0.4);
    m.add(ragged, flesh, 0);
    // Yellow fat ring under the skin line.
    m.add(at(fr, displace(torus([0, r * 0.04, 0], [0, 1, 0], r * 0.8, r * 0.15), (x, y, z) => noise(x * 30 + seed, y * 30, z * 30) * r * 0.1, r * 0.1)), fat, 0, { k: r * 0.1 });
    // Bone end, sheared off at an angle with a dark marrow core.
    m.add(capsule(P(0, -r * 0.2, 0), P(r * 0.05, r * 0.5, r * 0.03), r * 0.3), boneMat, 0, { k: r * 0.08 });
    m.cut(ellipsoid(P(r * 0.1, r * 0.82, r * 0.05), [r * 0.3, r * 0.34, r * 0.3]));
    m.add(ellipsoid(P(r * 0.06, r * 0.44, r * 0.03), [r * 0.15, r * 0.1, r * 0.15]), marrow, 0);
  } else {
    m.add(at(fr, ellipsoid([0, 0, 0], [rx * 0.98, r * 0.28, rz * 0.98])), metalCap, 0);
    m.add(cyl(P(0, -r * 0.1, 0), P(0, r * 0.4, 0), r * 0.36), hotCap, 0);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + seed;
      m.add(cone(P(Math.cos(a) * r * 0.55, 0, Math.sin(a) * r * 0.55), P(Math.cos(a) * r * 0.8, r * 0.5, Math.sin(a) * r * 0.8), r * 0.09, r * 0.05), wire, 0);
    }
  }
  const raw = polygonize(m.edits, h);
  const field = new Field(m.edits);
  const n0 = fieldNormals(field, raw.positions, h * 0.8);
  const idx = simplify(raw, n0, 150, 0.3);
  const c = compact({ positions: raw.positions, indices: idx }, n0);
  const nv = c.mesh.positions.length / 3;
  const colors = new Uint8Array(nv * 4);
  const materials = new Uint8Array(nv * 4);
  const s = { r: 0, g: 0, b: 0, rough: 0, metal: 0, emissive: 0, detail: 0, wear: 0 };
  const b = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  for (let v = 0; v < nv; v++) {
    field.material(c.mesh.positions[v * 3]!, c.mesh.positions[v * 3 + 1]!, c.mesh.positions[v * 3 + 2]!, s);
    colors[v * 4] = b(s.r); colors[v * 4 + 1] = b(s.g); colors[v * 4 + 2] = b(s.b); colors[v * 4 + 3] = 255;
    materials[v * 4] = b(s.rough); materials[v * 4 + 1] = b(s.metal); materials[v * 4 + 2] = b(s.emissive); materials[v * 4 + 3] = s.detail;
  }
  return { positions: c.mesh.positions, normals: c.extra!, indices: c.mesh.indices, colors, materials };
}

export interface JointCaps {
  bone: number;
  /** Faces away from the body, along the bone. */
  parentSide: CapMesh;
  /** Faces back into the body. */
  childSide: CapMesh;
}

export function buildCaps(field: Field, rig: RigDef, sk: Sk, style: 'flesh' | 'machine'): JointCaps[] {
  const out: JointCaps[] = [];
  rig.bones.forEach((b, i) => {
    if (!b.severable) return;
    const J = sk.pos[i]!;
    const kid = rig.bones.findIndex(x => x.parent === i);
    const axis = norm(kid >= 0 ? sub(sk.pos[kid]!, J) : b.offset);
    const hit = b.hit?.radius ?? 0.06;
    const [rs, ru, , up] = measure(field, J, axis, hit);
    const h = Math.max(0.0035, Math.min(rs, ru) / 9);
    // frameY's x runs along `side` when the z hint is `up`, so measured radii land on the right axes.
    out.push({
      bone: i,
      parentSide: buildCap(frameY(J, axis, up), rs, ru, style, i * 7.13, h),
      childSide: buildCap(frameY(J, scale(axis, -1), up), rs, ru, style, i * 3.71 + 5, h),
    });
  });
  return out;
}

