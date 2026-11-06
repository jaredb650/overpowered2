/** Socket helpers: where props sit on a character, in bone-local space. */
import type { Socket } from '../../../src/characters/format';
import { add, cross, norm, scale, sub, type V3 } from '../sdf';
import { handFrame } from './body';
import { B, type Side, type Sk } from './skeleton';

/** Rotation taking prop axes onto the given orthonormal basis. Columns are the images of X, Y, Z. */
export function quatFromBasis(x: V3, y: V3, z: V3): [number, number, number, number] {
  const m00 = x[0], m01 = y[0], m02 = z[0];
  const m10 = x[1], m11 = y[1], m12 = z[1];
  const m20 = x[2], m21 = y[2], m22 = z[2];
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

/** A weapon in a fist: barrel continues the forearm, the top of the gun faces the thumb. */
export function handSocket(sk: Sk, side: Side): Socket {
  const fr = handFrame(sk, side);
  const bone = sk.armBones(side).hand;
  const pos = add(add(scale(fr.x, 0.022), scale(fr.y, 0.09)), [0, 0, 0]);
  const barrel = fr.y;
  const up = fr.z;
  const right = norm(cross(up, barrel));
  return { bone, pos, rot: quatFromBasis(right, up, barrel) };
}

export function standardSockets(sk: Sk): Record<string, Socket> {
  const chest = sk.pos[B.chest]!;
  return {
    handR: handSocket(sk, -1),
    handL: handSocket(sk, 1),
    back: { bone: B.chest, pos: sub([0, 1.35, -0.2], chest), rot: [0, 0, 0, 1] },
    hip: { bone: B.hips, pos: [0.2, -0.05, 0], rot: [0, 0, 0, 1] },
  };
}
