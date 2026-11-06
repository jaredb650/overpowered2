/** Simplification and vertex compaction. */
import { MeshoptSimplifier } from 'meshoptimizer';
import { Field } from './model';
import type { RawMesh } from './polygonize';

export async function ready(): Promise<void> {
  await MeshoptSimplifier.ready;
}

/** Vertex normals from the SDF gradient. Far cleaner than face averages on a surface-nets mesh. */
export function fieldNormals(field: Field, positions: Float32Array, step: number): Float32Array {
  const n = new Float32Array(positions.length);
  const g: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < positions.length; i += 3) {
    field.gradient(positions[i]!, positions[i + 1]!, positions[i + 2]!, step, g);
    n[i] = g[0]; n[i + 1] = g[1]; n[i + 2] = g[2];
  }
  return n;
}

/** Area-weighted face normals. Plenty for the simplifier's error metric and needs no field evaluations. */
export function meshNormals(mesh: RawMesh): Float32Array {
  const P = mesh.positions, I = mesh.indices;
  const n = new Float32Array(P.length);
  for (let i = 0; i < I.length; i += 3) {
    const a = I[i]! * 3, b = I[i + 1]! * 3, c = I[i + 2]! * 3;
    const ux = P[b]! - P[a]!, uy = P[b + 1]! - P[a + 1]!, uz = P[b + 2]! - P[a + 2]!;
    const vx = P[c]! - P[a]!, vy = P[c + 1]! - P[a + 1]!, vz = P[c + 2]! - P[a + 2]!;
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    n[a] += x; n[a + 1] += y; n[a + 2] += z;
    n[b] += x; n[b + 1] += y; n[b + 2] += z;
    n[c] += x; n[c + 1] += y; n[c + 2] += z;
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = 1 / (Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!) || 1);
    n[i] *= l; n[i + 1] *= l; n[i + 2] *= l;
  }
  return n;
}

/** Drops unreferenced vertices. */
export function compact(mesh: RawMesh, extra?: Float32Array, stride = 3): { mesh: RawMesh; extra?: Float32Array; remap: Int32Array } {
  const nv = mesh.positions.length / 3;
  const remap = new Int32Array(nv).fill(-1);
  let n = 0;
  for (let i = 0; i < mesh.indices.length; i++) {
    const v = mesh.indices[i]!;
    if (remap[v] === -1) remap[v] = n++;
  }
  const positions = new Float32Array(n * 3);
  const out = extra ? new Float32Array(n * stride) : undefined;
  for (let v = 0; v < nv; v++) {
    const r = remap[v]!;
    if (r < 0) continue;
    positions[r * 3] = mesh.positions[v * 3]!;
    positions[r * 3 + 1] = mesh.positions[v * 3 + 1]!;
    positions[r * 3 + 2] = mesh.positions[v * 3 + 2]!;
    if (out) for (let k = 0; k < stride; k++) out[r * stride + k] = extra![v * stride + k]!;
  }
  const indices = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < indices.length; i++) indices[i] = remap[mesh.indices[i]!]!;
  return { mesh: { positions, indices }, extra: out, remap };
}

/**
 * Normals carry weight in the error metric so creases on armour survive longer than curvature on skin.
 * `attrWeight` of about 0.5 keeps hard panel edges with no visible cost on soft body areas.
 */
export function simplify(mesh: RawMesh, normals: Float32Array, targetTris: number, attrWeight = 0.5): Uint32Array {
  const [indices] = MeshoptSimplifier.simplifyWithAttributes(
    mesh.indices, mesh.positions, 3, normals, 3, [attrWeight, attrWeight, attrWeight], null, targetTris * 3, 1, ['Regularize'],
  );
  return indices;
}

/** A further simplified index list over the same vertices, for distance LOD. */
export function lodIndices(indices: Uint32Array, positions: Float32Array, targetTris: number): Uint32Array {
  const [out] = MeshoptSimplifier.simplify(indices, positions, 3, targetTris * 3, 1, []);
  return out;
}
