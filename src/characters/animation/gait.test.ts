import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { archetypeById, rigFor } from '../archetypes';
import { HumanoidBone as H, type GoreRegion, type RigDef } from '../rig';
import { HumanoidAnimator } from './HumanoidAnimator';

function body(id: string) {
  const def = archetypeById(id);
  const rig = rigFor(def);
  const root = new THREE.Group();
  const bones = rig.bones.map(b => {
    const bone = new THREE.Bone();
    bone.position.set(b.offset[0], b.offset[1], b.offset[2]);
    return bone;
  });
  rig.bones.forEach((b, i) => (b.parent >= 0 ? bones[b.parent]! : root).add(bones[i]!));
  const hidden = new Set<number>();
  const severed = new Set<GoreRegion>();
  const anim = new HumanoidAnimator(bones, rig, def, root, severed, b => hidden.has(b));
  return { rig, root, bones, hidden, severed, anim };
}

const cut = (b: { rig: RigDef; hidden: Set<number>; severed: Set<GoreRegion> }, bone: number) => {
  const mark = (i: number) => {
    b.hidden.add(i);
    b.severed.add(b.rig.bones[i]!.region);
    b.rig.bones.forEach((x, c) => { if (x.parent === i) mark(c); });
  };
  mark(bone);
};

const finite = (bones: readonly THREE.Bone[]) => bones.every(b => Number.isFinite(b.quaternion.x + b.quaternion.y + b.quaternion.z + b.quaternion.w + b.position.x + b.position.y + b.position.z));

/** Runs the root in a curve and reports the worst slide of a planted ankle over the first part of each stance. */
function worstSlide(id: string, speed: number, turnRate: number, dt = 1 / 60): number {
  const b = body(id);
  const p = new THREE.Vector3();
  const foot = [b.bones[H.footL]!, b.bones[H.footR]!];
  const pins: { i: number; at: THREE.Vector3; left: number }[] = [];
  let worst = 0;
  const armed = { value: false };
  b.anim.onFootstep = (x, y, z) => {
    if (!armed.value) return;
    // The planted foot is the one nearest the reported position.
    let i = 0, best = Infinity;
    foot.forEach((f, k) => {
      const d = f.getWorldPosition(p).distanceToSquared(new THREE.Vector3(x, y, z));
      if (d < best) { best = d; i = k; }
    });
    pins.push({ i, at: new THREE.Vector3(x, 0, z), left: 0.06 });
  };
  let yaw = 0;
  for (let n = 0; n < 900; n++) {
    yaw += turnRate * dt;
    b.root.rotation.y = yaw;
    b.root.position.x += Math.sin(yaw) * speed * dt;
    b.root.position.z += Math.cos(yaw) * speed * dt;
    b.anim.setLocomotion({ speed, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true });
    b.anim.update(dt, 0);
    b.root.updateMatrixWorld(true);
    if (n === 120) armed.value = true;
    for (const pin of pins) {
      if (pin.left <= 0) continue;
      pin.left -= dt;
      foot[pin.i]!.getWorldPosition(p);
      worst = Math.max(worst, Math.hypot(p.x - pin.at.x, p.z - pin.at.z));
    }
  }
  expect(finite(b.bones)).toBe(true);
  expect(pins.length).toBeGreaterThan(3);
  return worst;
}

describe('gait', () => {
  it.each([2, 4, 7, 11])('keeps planted feet planted at %d m/s', speed => {
    expect(worstSlide('trooper', speed, 0)).toBeLessThan(0.02);
  });

  it('keeps feet planted through a turn', () => {
    expect(worstSlide('husk', 5, 1.2)).toBeLessThan(0.03);
  });

  it('holds at any frame rate', () => {
    expect(worstSlide('trooper', 6, 0, 1 / 30)).toBeLessThan(0.03);
    expect(worstSlide('trooper', 6, 0, 1 / 144)).toBeLessThan(0.02);
  });

  it('stays sane through every severed combination', () => {
    const limbs = [H.thighL, H.thighR, H.upperArmL, H.upperArmR, H.neck];
    for (let mask = 1; mask < 1 << limbs.length; mask++) {
      const b = body('husk');
      limbs.forEach((bone, i) => { if (mask & (1 << i)) cut(b, bone); });
      for (let n = 0; n < 120; n++) {
        b.root.position.z += 2.5 / 60;
        b.anim.setLocomotion({ speed: 2.5, moveX: 0, moveZ: 1, aimYaw: 0.3, aimPitch: 0.1, grounded: true });
        b.anim.update(1 / 60, 0);
      }
      expect(finite(b.bones), `mask ${mask}`).toBe(true);
    }
  });

  it('lays a legless body on the ground', () => {
    const b = body('husk');
    cut(b, H.thighL);
    cut(b, H.thighR);
    for (let n = 0; n < 200; n++) {
      b.root.position.z += 2 / 60;
      b.anim.update(1 / 60, 0);
    }
    expect(b.bones[H.hips]!.position.y).toBeLessThan(b.rig.height * 0.16);
  });

  it('every action finishes and returns the body to rest', () => {
    const b = body('trooper');
    for (const a of ['attackMelee', 'attackHeavy', 'throw', 'leap', 'land', 'roar', 'stagger', 'block', 'deathStumble'] as const) {
      const d = b.anim.play(a);
      expect(d).toBeGreaterThan(0);
      for (let t = 0; t < d + 1; t += 1 / 60) b.anim.update(1 / 60, 0);
      expect(finite(b.bones)).toBe(true);
    }
  });

  it('a flinch moves the chest and then recovers', () => {
    const b = body('trooper');
    for (let n = 0; n < 60; n++) b.anim.update(1 / 60, 0);
    const rest = b.bones[H.chest]!.quaternion.clone();
    b.anim.flinch(H.chest, new THREE.Vector3(0, 0, 1), 1);
    for (let n = 0; n < 8; n++) b.anim.update(1 / 60, 0);
    expect(b.bones[H.chest]!.quaternion.angleTo(rest)).toBeGreaterThan(0.04);
    for (let n = 0; n < 150; n++) b.anim.update(1 / 60, 0);
    expect(b.bones[H.chest]!.quaternion.angleTo(rest)).toBeLessThan(0.03);
  });
});
