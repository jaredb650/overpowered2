/** Two-bone IK. Every limb in the game goes through this, including hands: arm swing is a moving target. */
import * as THREE from 'three';

const m = new THREE.Matrix4();
const x = new THREE.Vector3();
const y = new THREE.Vector3();
const z = new THREE.Vector3();

/** Rotation whose +Y lands on `yImage` and whose +Z lands as close to `zHint` as orthogonality allows. */
export function basisQuat(out: THREE.Quaternion, yImage: THREE.Vector3, zHint: THREE.Vector3): THREE.Quaternion {
  y.copy(yImage).normalize();
  z.copy(zHint).addScaledVector(y, -zHint.dot(y));
  if (z.lengthSq() < 1e-8) z.set(1, 0, 0).addScaledVector(y, -y.x);
  z.normalize();
  x.crossVectors(y, z);
  m.makeBasis(x, y, z);
  return out.setFromRotationMatrix(m);
}

const dir = new THREE.Vector3();
const w = new THREE.Vector3();
const elbow = new THREE.Vector3();
const seg = new THREE.Vector3();
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const qinv = new THREE.Quaternion();

export class Limb {
  readonly l1: number;
  readonly l2: number;
  private readonly invRestA = new THREE.Quaternion();
  private readonly invRestB = new THREE.Quaternion();
  /** Character-space rotation of the lower segment after the last solve. */
  readonly lowerQ = new THREE.Quaternion();
  /** Position of the end of the chain after the last solve, in character space. */
  readonly end = new THREE.Vector3();
  readonly joint = new THREE.Vector3();

  constructor(
    readonly a: THREE.Bone,
    readonly b: THREE.Bone,
    readonly c: THREE.Bone,
    /** Direction the middle joint points at rest. Knees forward, elbows back. */
    restPole: THREE.Vector3,
  ) {
    this.l1 = b.position.length();
    this.l2 = c.position.length();
    basisQuat(this.invRestA, seg.copy(b.position).negate(), restPole).invert();
    basisQuat(this.invRestB, seg.copy(c.position).negate(), restPole).invert();
  }

  /** Solves from `root` (joint position) toward `target`. `parentQ` is the parent's character-space rotation. */
  solve(root: THREE.Vector3, parentQ: THREE.Quaternion, target: THREE.Vector3, pole: THREE.Vector3): void {
    const { l1, l2 } = this;
    dir.subVectors(target, root);
    let d = dir.length();
    const max = (l1 + l2) * 0.9995;
    const min = Math.abs(l1 - l2) * 1.02 + 1e-4;
    if (d < 1e-6) dir.set(0, -1, 0), d = min;
    dir.divideScalar(d);
    if (d > max) d = max; else if (d < min) d = min;
    const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    w.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (w.lengthSq() < 1e-8) w.set(0, 0, 1).addScaledVector(dir, -dir.z);
    w.normalize();
    elbow.copy(root).addScaledVector(dir, l1 * cosA).addScaledVector(w, l1 * sinA);
    this.joint.copy(elbow);
    this.end.copy(root).addScaledVector(dir, d);

    seg.subVectors(root, elbow);
    basisQuat(qa, seg, w).multiply(this.invRestA);
    seg.subVectors(elbow, this.end);
    basisQuat(qb, seg, w).multiply(this.invRestB);
    this.lowerQ.copy(qb);
    this.a.quaternion.copy(qinv.copy(parentQ).invert()).multiply(qa);
    this.b.quaternion.copy(qinv.copy(qa).invert()).multiply(qb);
  }

  /** Points the end bone at a character-space rotation. Call after solve(). */
  setEnd(q: THREE.Quaternion): void {
    this.c.quaternion.copy(qinv.copy(this.lowerQ).invert()).multiply(q);
  }

  relaxEnd(): void {
    this.c.quaternion.identity();
  }
}
