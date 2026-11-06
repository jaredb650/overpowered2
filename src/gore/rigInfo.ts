/**
 * Tables derived once per rig, so raycasts and ragdoll builders never walk the rig definition.
 * Rigs are treated generically: nothing here assumes a humanoid, only the rig contract.
 */
import type { GoreRegion, RigDef } from '../characters/rig';

/** Floats per capsule in RigInfo.caps: from xyz, to xyz, radius. */
export const CAP_STRIDE = 7;
/** Upper bound on bones in any rig. Scratch tables are sized from it. */
export const MAX_BONES = 64;

export interface RigInfo {
  readonly rig: RigDef;
  readonly count: number;
  /** Capsules in bone space, CAP_STRIDE floats each. */
  readonly caps: Float32Array;
  readonly capBone: Int16Array;
  readonly capCount: number;
  readonly children: readonly (readonly number[])[];
  /** Region to the severable bone that cuts it. */
  readonly severBone: ReadonlyMap<GoreRegion, number>;
  /** Per bone: radius around that bone guaranteed to contain its whole subtree in any pose. */
  readonly reach: Float32Array;
  /** Per bone: capsule volume in cubic meters, the basis for mass distribution. */
  readonly volume: Float32Array;
  /** Per bone: unit axis running down the bone in bind space, the twist axis for ball limits. */
  readonly axis: Float32Array;
  /** Total body mass at this rig's size. */
  readonly mass: number;
  /** Per bone: position in the bind pose, three floats each, relative to the root. */
  readonly bind: Float32Array;
}

const cache = new WeakMap<RigDef, RigInfo>();

/** A 1.85 m human weighs about 85 kg. Mass grows with the cube of size. */
const HUMAN_HEIGHT = 1.85;
const HUMAN_MASS = 85;

export function rigInfo(rig: RigDef): RigInfo {
  let info = cache.get(rig);
  if (!info) cache.set(rig, (info = build(rig)));
  return info;
}

function build(rig: RigDef): RigInfo {
  const n = rig.bones.length;
  if (n > MAX_BONES) throw new Error(`Rig ${rig.id} has ${n} bones, the limit is ${MAX_BONES}`);
  const children: number[][] = Array.from({ length: n }, () => []);
  const severBone = new Map<GoreRegion, number>();
  const capped = rig.bones.filter(b => b.hit).length;
  const caps = new Float32Array(capped * CAP_STRIDE);
  const capBone = new Int16Array(capped);
  const volume = new Float32Array(n);
  const reach = new Float32Array(n);
  const axis = new Float32Array(n * 3);
  const bind = new Float32Array(n * 3);

  let c = 0;
  for (let i = 0; i < n; i++) {
    const b = rig.bones[i]!;
    if (b.parent >= i) throw new Error(`Rig ${rig.id}: bone ${b.name} must come after its parent`);
    for (let k = 0; k < 3; k++) bind[i * 3 + k] = b.offset[k]! + (b.parent >= 0 ? bind[b.parent * 3 + k]! : 0);
    if (b.parent >= 0) children[b.parent]!.push(i);
    if (b.severable && !severBone.has(b.region)) severBone.set(b.region, i);
    if (b.hit) {
      const { from, to, radius } = b.hit;
      caps.set([from[0], from[1], from[2], to[0], to[1], to[2], radius], c * CAP_STRIDE);
      capBone[c++] = i;
      const len = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
      volume[i] = Math.PI * radius * radius * len + (4 / 3) * Math.PI * radius ** 3;
      reach[i] = Math.max(Math.hypot(from[0], from[1], from[2]), Math.hypot(to[0], to[1], to[2])) + radius;
    }
  }

  for (let i = n - 1; i >= 0; i--) {
    const b = rig.bones[i]!;
    const kids = children[i]!;
    let dx = 0;
    let dy = 0;
    let dz = 0;
    if (kids.length > 0) {
      // Twist runs toward the first child: for a shoulder that is the elbow, for hips the spine.
      const o = rig.bones[kids[0]!]!.offset;
      dx = o[0];
      dy = o[1];
      dz = o[2];
    } else if (b.hit) {
      dx = b.hit.to[0] - b.hit.from[0];
      dy = b.hit.to[1] - b.hit.from[1];
      dz = b.hit.to[2] - b.hit.from[2];
    }
    const len = Math.hypot(dx, dy, dz) || 1;
    axis[i * 3] = dx / len;
    axis[i * 3 + 1] = (dx === 0 && dy === 0 && dz === 0) ? 1 : dy / len;
    axis[i * 3 + 2] = dz / len;
    for (const k of kids) {
      const o = rig.bones[k]!.offset;
      reach[i] = Math.max(reach[i]!, Math.hypot(o[0], o[1], o[2]) + reach[k]!);
    }
  }

  const mass = HUMAN_MASS * (rig.height / HUMAN_HEIGHT) ** 3;
  return { rig, count: n, caps, capBone, capCount: c, children, severBone, reach, volume, axis, mass, bind };
}

/**
 * Writes 1 into `out` for every bone that has been cut off, given the severed regions.
 * Works from the regions alone, so it stays right whether an instance records only the region that was
 * cut or every region below it as well.
 */
export function markSevered(info: RigInfo, severed: ReadonlySet<GoreRegion>, out: Uint8Array): void {
  const bones = info.rig.bones;
  for (let i = 0; i < info.count; i++) {
    const b = bones[i]!;
    out[i] = (b.severable && severed.has(b.region)) || (b.parent >= 0 && out[b.parent] === 1) ? 1 : 0;
  }
}

/** Writes 1 into `out` for `bone` and everything below it, 0 elsewhere. */
export function markSubtree(info: RigInfo, bone: number, out: Uint8Array): void {
  const bones = info.rig.bones;
  for (let i = 0; i < info.count; i++) {
    out[i] = i === bone || (i > bone && bones[i]!.parent >= 0 && out[bones[i]!.parent] === 1) ? 1 : 0;
  }
}
