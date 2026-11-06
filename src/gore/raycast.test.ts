import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { humanoidRig, HumanoidBone } from '../characters/rig';
import { mulberry32 } from '../core/math';
import { boneRay, boneRayContact, nextCapsuleHit, rayBones, rayCapsule, rayNearSphere } from './raycast';
import { CAP_STRIDE, markSevered, rigInfo } from './rigInfo';
import { TestDummy } from './testDummy';

/** Reference answer by marching the ray against the exact capsule distance function. */
function marchCapsule(o: THREE.Vector3, d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, r: number, maxDist: number): number {
  const ab = b.clone().sub(a);
  const dist = (t: number) => {
    const p = o.clone().addScaledVector(d, t);
    const s = ab.lengthSq() > 0 ? THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1) : 0;
    return p.distanceTo(a.clone().addScaledVector(ab, s)) - r;
  };
  let t = 0;
  for (let i = 0; i < 4000 && t <= maxDist; i++) {
    const s = dist(t);
    if (s < 1e-6) return t;
    t += s;
  }
  return -1;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const cap = (o: THREE.Vector3, d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, r: number) =>
  rayCapsule(o.x, o.y, o.z, d.x, d.y, d.z, a.x, a.y, a.z, b.x, b.y, b.z, r);

describe('rayCapsule', () => {
  it('hits the side wall at the expected distance', () => {
    expect(cap(v(-5, 1, 0), v(1, 0, 0), v(0, 0, 0), v(0, 2, 0), 0.5)).toBeCloseTo(4.5, 6);
  });

  it('hits an end cap, not the infinite cylinder', () => {
    expect(cap(v(0, 5, 0), v(0, -1, 0), v(0, 0, 0), v(0, 2, 0), 0.5)).toBeCloseTo(2.5, 6);
    expect(cap(v(-5, 2.3, 0), v(1, 0, 0), v(0, 0, 0), v(0, 2, 0), 0.5)).toBeCloseTo(5 - Math.sqrt(0.25 - 0.09), 6);
  });

  it('misses above the cap', () => {
    expect(cap(v(-5, 2.6, 0), v(1, 0, 0), v(0, 0, 0), v(0, 2, 0), 0.5)).toBe(-1);
  });

  it('ignores a capsule behind the ray', () => {
    expect(cap(v(5, 1, 0), v(1, 0, 0), v(0, 0, 0), v(0, 2, 0), 0.5)).toBe(-1);
  });

  it('returns 0 from inside, including inside the rounded ends', () => {
    expect(cap(v(0, 1, 0), v(1, 0, 0), v(0, 0, 0), v(0, 2, 0), 0.5)).toBe(0);
    expect(cap(v(0, 2.4, 0), v(0, 1, 0), v(0, 0, 0), v(0, 2, 0), 0.5)).toBe(0);
  });

  it('handles a zero length capsule as a sphere', () => {
    expect(cap(v(-3, 0, 0), v(1, 0, 0), v(0, 0, 0), v(0, 0, 0), 1)).toBeCloseTo(2, 6);
  });

  it('agrees with sphere tracing on random rays', () => {
    const rnd = mulberry32(7);
    const r = (lo: number, hi: number) => lo + (hi - lo) * rnd();
    let hits = 0;
    for (let i = 0; i < 4000; i++) {
      const a = v(r(-1, 1), r(-1, 1), r(-1, 1));
      const b = v(r(-1, 1), r(-1, 1), r(-1, 1));
      const radius = r(0.05, 0.4);
      const o = v(r(-4, 4), r(-4, 4), r(-4, 4));
      const target = v(r(-1, 1), r(-1, 1), r(-1, 1));
      const d = target.sub(o).normalize();
      const got = cap(o, d, a, b, radius);
      const want = marchCapsule(o, d, a, b, radius, 50);
      if (want < 0) {
        // Grazing rays can land either side of the marcher's tolerance.
        if (got >= 0) expect(marchCapsule(o, d, a, b, radius + 1e-4, 50)).toBeGreaterThanOrEqual(0);
      } else {
        hits++;
        expect(got).toBeGreaterThanOrEqual(0);
        expect(got).toBeCloseTo(want, 3);
      }
    }
    expect(hits).toBeGreaterThan(300);
  });
});

describe('rayNearSphere', () => {
  it('rejects past maxDist and behind the origin, and accepts from inside', () => {
    expect(rayNearSphere(0, 0, 0, 1, 0, 0, 10, 0, 0, 1, 5)).toBe(false);
    expect(rayNearSphere(0, 0, 0, 1, 0, 0, 10, 0, 0, 1, 9.5)).toBe(true);
    expect(rayNearSphere(0, 0, 0, 1, 0, 0, -10, 0, 0, 1, 50)).toBe(false);
    expect(rayNearSphere(0, 0, 0, 1, 0, 0, 0.2, 0, 0, 1, 0.01)).toBe(true);
  });
});

describe('rig ray tests', () => {
  const rig = humanoidRig('test');
  const info = rigInfo(rig);

  const placed = (x: number, yaw: number) => {
    const d = new TestDummy(rig);
    d.root.position.set(x, 0, 0);
    d.root.rotation.y = yaw;
    d.root.updateMatrixWorld(true);
    return d;
  };
  const headPos = (d: TestDummy) => {
    const c = new THREE.Vector3(0, 0.09, 0.015);
    return c.applyMatrix4(d.bones[HumanoidBone.head]!.matrixWorld);
  };
  const shoot = (d: TestDummy, o: THREE.Vector3, dir: THREE.Vector3, skip: Uint8Array | null = null, max = 100) =>
    rayBones(info, d.bones, skip, o.x, o.y, o.z, dir.x, dir.y, dir.z, max);

  it('every reach radius encloses every capsule of that subtree, in any pose', () => {
    const d = placed(0, 0);
    const rnd = mulberry32(3);
    const q = new THREE.Quaternion();
    for (let pose = 0; pose < 50; pose++) {
      for (const b of d.bones) {
        q.setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6));
        b.quaternion.copy(q);
      }
      d.root.updateMatrixWorld(true);
      const hips = new THREE.Vector3().setFromMatrixPosition(d.bones[0]!.matrixWorld);
      for (let c = 0; c < info.capCount; c++) {
        const m = d.bones[info.capBone[c]!]!.matrixWorld;
        const o = c * CAP_STRIDE;
        const r = info.caps[o + 6]!;
        for (const k of [0, 3]) {
          const p = v(info.caps[o + k]!, info.caps[o + k + 1]!, info.caps[o + k + 2]!).applyMatrix4(m);
          expect(p.distanceTo(hips) + r).toBeLessThanOrEqual(info.reach[0]! + 1e-4);
        }
      }
    }
  });

  it('a shot at the head centre hits the head from every side', () => {
    for (let yaw = 0; yaw < 6.28; yaw += 0.7) {
      const d = placed(3, yaw);
      const target = headPos(d);
      for (let a = 0; a < 6.28; a += 0.5) {
        const o = target.clone().add(v(Math.cos(a) * 15, 0.2, Math.sin(a) * 15));
        const dir = target.clone().sub(o).normalize();
        expect(shoot(d, o, dir)).toBe(true);
        expect(rig.bones[boneRay.bone]!.region).toBe('head');
      }
    }
  });

  it('a shot over the shoulder misses, and maxDist is respected', () => {
    const d = placed(0, 0);
    expect(shoot(d, v(0, 2.2, 10), v(0, 0, -1))).toBe(false);
    expect(shoot(d, v(0, 1.3, 10), v(0, 0, -1), null, 5)).toBe(false);
    expect(shoot(d, v(0, 1.3, 10), v(0, 0, -1), null, 12)).toBe(true);
  });

  it('returns the nearest capsule when a ray crosses two', () => {
    const d = placed(0, 0);
    expect(shoot(d, v(5, 0.6, 0), v(-1, 0, 0))).toBe(true);
    const near = boneRay.bone;
    expect(rig.bones[near]!.name).toBe('thighL');
    expect(shoot(d, v(-5, 0.6, 0), v(1, 0, 0))).toBe(true);
    expect(rig.bones[boneRay.bone]!.name).toBe('thighR');
  });

  it('follows animated bones', () => {
    const d = placed(0, 0);
    const arm = d.bones[HumanoidBone.upperArmL]!;
    const before = shoot(d, v(10, 1.5, 0.45), v(-1, 0, 0));
    arm.quaternion.setFromAxisAngle(v(1, 0, 0), -Math.PI / 2);
    d.root.updateMatrixWorld(true);
    const after = shoot(d, v(10, 1.45, 0.3), v(-1, 0, 0));
    expect(before).toBe(false);
    expect(after).toBe(true);
    expect(rig.bones[boneRay.bone]!.region).toMatch(/armL|forearmL/);
  });

  it('skips severed bones and everything below them', () => {
    const d = placed(0, 0);
    const skip = new Uint8Array(64);
    expect(shoot(d, v(5, 0.6, 0), v(-1, 0, 0))).toBe(true);
    markSevered(info, new Set(['legL'] as const), skip);
    expect(shoot(d, v(5, 0.6, 0), v(-1, 0, 0), skip)).toBe(true);
    expect(rig.bones[boneRay.bone]!.name).toBe('thighR');
    expect(skip[HumanoidBone.shinL]).toBe(1);
    expect(skip[HumanoidBone.footL]).toBe(1);
    expect(skip[HumanoidBone.hips]).toBe(0);
  });

  it('a waist cut removes the top half from the skip mask, not the hips', () => {
    const skip = new Uint8Array(64);
    markSevered(info, new Set(['abdomen'] as const), skip);
    expect(skip[HumanoidBone.hips]).toBe(0);
    expect(skip[HumanoidBone.thighL]).toBe(0);
    for (const b of [HumanoidBone.spine, HumanoidBone.chest, HumanoidBone.head, HumanoidBone.handR]) expect(skip[b]).toBe(1);
  });

  it('reports a surface point and an outward normal', () => {
    const d = placed(0, 0);
    const o = v(0, 1.35, 10);
    const dir = v(0, 0, -1);
    expect(shoot(d, o, dir)).toBe(true);
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    boneRayContact(o.x, o.y, o.z, dir.x, dir.y, dir.z, p, n);
    expect(n.dot(dir)).toBeLessThan(0);
    expect(n.length()).toBeCloseTo(1, 5);
    expect(p.z).toBeGreaterThan(0.05);
  });

  it('hit slots do not alias across a whole shot', () => {
    const seen = new Set<unknown>();
    for (let i = 0; i < 48; i++) seen.add(nextCapsuleHit());
    expect(seen.size).toBe(48);
  });
});
