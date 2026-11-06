/**
 * Automatic skin weights. A vertex belongs to the bone whose primitives made its surface, then blends with
 * neighbours in the hierarchy by its position along the joint axis, gated by distance from the joint.
 * Blending by position along the axis gives clean rings around a limb; blending by raw proximity would
 * weld the inner arm to the ribs, because they sit close together in the A-pose.
 */
import type { RigDef } from '../../src/characters/rig';
import { Field } from './model';
import { dot, len, norm, sstep, sub, type V3 } from './sdf';
import type { Sk } from './parts/skeleton';

/** Half-width of the blend zone per bone, in meters at modelling scale. */
const BLEND: Record<string, number> = {
  spine: 0.075, chest: 0.1, neck: 0.03, head: 0.035,
  upperArmL: 0.058, upperArmR: 0.058, foreArmL: 0.042, foreArmR: 0.042, handL: 0.028, handR: 0.028,
  thighL: 0.08, thighR: 0.08, shinL: 0.05, shinR: 0.05, footL: 0.03, footR: 0.03,
};

export interface SkinResult {
  index: Uint8Array;
  weight: Uint8Array;
}

function boneAxis(rig: RigDef, sk: Sk, b: number): V3 {
  const kids = rig.bones.map((x, i) => (x.parent === b ? i : -1)).filter(i => i >= 0);
  if (kids.length) {
    const c = kids.reduce<[number, number, number]>((a, k) => [a[0] + sk.pos[k]![0], a[1] + sk.pos[k]![1], a[2] + sk.pos[k]![2]], [0, 0, 0]);
    return norm(sub([c[0] / kids.length, c[1] / kids.length, c[2] / kids.length], sk.pos[b]!));
  }
  return norm(rig.bones[b]!.offset);
}

export function computeSkin(field: Field, rig: RigDef, sk: Sk, positions: Float32Array, indices: Uint32Array): SkinResult {
  const nb = rig.bones.length;
  const nv = positions.length / 3;
  const W = new Float32Array(nv * nb);
  const rigid = new Uint8Array(nv);
  const dist = new Float32Array(nb);
  const axes = rig.bones.map((_, i) => boneAxis(rig, sk, i));
  const children = rig.bones.map((_, i) => rig.bones.map((b, j) => (b.parent === i ? j : -1)).filter(j => j >= 0));

  for (let v = 0; v < nv; v++) {
    const x = positions[v * 3]!, y = positions[v * 3 + 1]!, z = positions[v * 3 + 2]!;
    const p: V3 = [x, y, z];
    const owner = field.ownerAt(x, y, z);
    if (owner?.rigid && owner.bone >= 0) {
      W[v * nb + owner.bone] = 1;
      rigid[v] = 1;
      continue;
    }
    field.boneDistances(x, y, z, dist);
    let primary = 0, best = 1e9;
    for (let b = 0; b < nb; b++) if (dist[b]! < best) { best = dist[b]!; primary = b; }
    const o = v * nb;
    W[o + primary] = 1;
    const blendTo = (from: number, to: number, joint: number) => {
      // `joint` is the child of the pair. S runs 0 on the parent side to 1 on the child side.
      const name = rig.bones[joint]!.name;
      const R = BLEND[name] ?? 0;
      if (R <= 0) return;
      const J = sk.pos[joint]!;
      const t = dot(sub(p, J), axes[joint]!);
      const S = sstep(-R, R, t);
      const gate = 1 - sstep(R * 1.6, R * 3, len(sub(p, J)));
      const toChild = to === joint;
      const w = (toChild ? S : 1 - S) * gate;
      W[o + to] = W[o + to]! + w;
      W[o + from] = W[o + from]! - w;
    };
    const parent = rig.bones[primary]!.parent;
    if (parent >= 0) blendTo(primary, parent, primary);
    for (const c of children[primary]!) blendTo(primary, c, c);
  }

  // Primary-bone flips along a limb leave small steps in the weights. Relaxing over the mesh removes them.
  const adj: number[][] = Array.from({ length: nv }, () => []);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]!, b = indices[i + 1]!, c = indices[i + 2]!;
    adj[a]!.push(b, c); adj[b]!.push(a, c); adj[c]!.push(a, b);
  }
  const next = new Float32Array(W.length);
  for (let it = 0; it < 3; it++) {
    next.set(W);
    for (let v = 0; v < nv; v++) {
      if (rigid[v]) continue;
      const nbrs = adj[v]!;
      if (!nbrs.length) continue;
      for (let b = 0; b < nb; b++) {
        let s = 0, n = 0;
        for (const u of nbrs) { if (!rigid[u]) { s += W[u * nb + b]!; n++; } }
        if (n) next[v * nb + b] = W[v * nb + b]! * 0.5 + (s / n) * 0.5;
      }
    }
    W.set(next);
  }

  const index = new Uint8Array(nv * 4);
  const weight = new Uint8Array(nv * 4);
  const top = [0, 0, 0, 0], topW = [0, 0, 0, 0];
  for (let v = 0; v < nv; v++) {
    topW.fill(0); top.fill(0);
    for (let b = 0; b < nb; b++) {
      const w = W[v * nb + b]!;
      if (w <= 0.004) continue;
      for (let k = 0; k < 4; k++) {
        if (w > topW[k]!) {
          for (let m = 3; m > k; m--) { topW[m] = topW[m - 1]!; top[m] = top[m - 1]!; }
          topW[k] = w; top[k] = b;
          break;
        }
      }
    }
    const sum = topW[0]! + topW[1]! + topW[2]! + topW[3]! || 1;
    // Rounding must sum to exactly 255 or skinned vertices drift.
    let left = 255;
    for (let k = 3; k >= 1; k--) {
      const q = Math.round((topW[k]! / sum) * 255);
      weight[v * 4 + k] = q;
      left -= q;
      index[v * 4 + k] = top[k]!;
    }
    weight[v * 4] = left;
    index[v * 4] = top[0]!;
  }
  return { index, weight };
}
