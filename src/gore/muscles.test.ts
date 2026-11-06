/**
 * The muscle layer, on real Rapier ragdolls. Each test here is either something the talk asks for, or a way this
 * layer has actually gone wrong: pumping energy into a joint, flinging limbs the wrong way, or never coming to rest.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { archetypeById, rigFor } from '../characters/archetypes';
import { HumanoidAnimator } from '../characters/animation/HumanoidAnimator';
import { droneRig, humanoidRig, HumanoidBone as B, skitterRig, type RigDef } from '../characters/rig';
import { GRAVITY, Physics } from '../physics/Physics';
import { makeCtx } from '../sandbox/harness';
import type { Ctx, DamageInfo } from '../core/contracts';
import { createGoreSystem, GoreTuning, type Gore } from './index';
import { impactStrength, MuscleTuning } from './muscles';
import { BodyFilter, Rag } from './rag';
import { markSubtree, rigInfo } from './rigInfo';
import { TestDummy } from './testDummy';

const rig = humanoidRig('test');
const trooper = archetypeById('trooper');
const trooperRig = rigFor(trooper);
/** Measured limits, with room over a healthy run and under the bug each one guards against. See the tests. */
const ARM_STOP = 2.7;
const HIP_SPIN = 9;
const HIP_ERROR = 1;

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const at = (c: TestDummy, bone: number) => new THREE.Vector3().setFromMatrixPosition(c.bones[bone]!.matrixWorld);

let physics: Physics;
let ctx: Ctx;
let gore: Gore;
const scene = new THREE.Scene();

function spawn(x = 0, z = 0, y = 0, source: RigDef = rig): TestDummy {
  const c = new TestDummy(source);
  c.root.position.set(x, y, z);
  scene.add(c.root);
  c.root.updateMatrixWorld(true);
  return c;
}

/** A body on the real animator, which is what a collapse follows. */
function spawnLiving(x = 0, z = 0): TestDummy {
  const c = spawn(x, z, 0, trooperRig);
  const anim = new HumanoidAnimator(c.bones, trooperRig, trooper, c.root, c.severed, () => false);
  (c as { anim: unknown }).anim = anim;
  for (let i = 0; i < 20; i++) {
    anim.setLocomotion({ speed: 0, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true });
    anim.update(1 / 60, 0);
  }
  c.root.updateMatrixWorld(true);
  return c;
}

function frame(): void {
  ctx.time.tick(1 / 60);
  physics.step(ctx.time.dt);
  gore.update();
}

const run = (frames: number) => {
  for (let i = 0; i < frames; i++) frame();
};

/** Frames until nothing is simulating, or `limit`. */
function settle(limit = 60 * 9): number {
  let f = 0;
  while (gore.stats().ragdolls > 0 && f < limit) {
    frame();
    f++;
  }
  return f;
}

const ragOf = (c: TestDummy): Rag => (gore as unknown as { owned: Map<TestDummy, { rag: Rag }> }).owned.get(c)!.rag;

const damage = (point: THREE.Vector3): DamageInfo => ({
  amount: 60, type: 'pellet', point: point.clone(), dir: v(0, 0, -1), force: 0, source: 'test',
});

const weightless = (body: () => void) => {
  physics.world.gravity = { x: 0, y: 0, z: 0 };
  try {
    body();
  } finally {
    physics.world.gravity = { x: 0, y: GRAVITY, z: 0 };
  }
};

/** Thigh and shin alone, weightless, with the shin whipped straight. Returns how the knee moved. */
function whipKnee(muscles: boolean, dt: number): { peak: number; deepest: number; rebound: number; thigh: number } {
  const c = spawn(0, 3, 3);
  const info = rigInfo(c.rig);
  const mask = new Uint8Array(64);
  markSubtree(info, B.thighL, mask);
  c.bones[B.shinL]!.quaternion.setFromAxisAngle(v(1, 0, 0), 0.9);
  c.root.updateMatrixWorld(true);
  const rag = new Rag(physics, c, {
    chainRoot: B.thighL, mask, seeds: null, membership: BodyFilter.membership, collidesWith: 0, restitution: 0, friction: 0, muscles,
  });
  const hook = (h: number) => rag.preStep(h);
  physics.preStep.add(hook);
  rag.age = 1;
  rag.muscle?.advance(0, c.bones);
  const [thigh, shin] = rag.parts as [Rag['parts'][0], Rag['parts'][0]];
  shin.body.setAngvel({ x: -30, y: 0, z: 0 }, true);
  const axis = v(1, 0, 0);
  const q = new THREE.Quaternion();
  const wThigh = new THREE.Vector3();
  const wShin = new THREE.Vector3();
  let last = NaN;
  const out = { peak: 0, deepest: 9, rebound: 0, thigh: 0 };
  for (let i = 0, n = Math.round(0.5 / dt); i < n; i++) {
    physics.step(dt);
    rag.drive();
    rag.age += dt;
    thigh.body.rotation(thigh.q);
    shin.body.rotation(shin.q);
    thigh.body.angvel(wThigh);
    shin.body.angvel(wShin);
    q.copy(thigh.q).conjugate().multiply(shin.q);
    const hinge = axis.clone().applyQuaternion(thigh.q);
    const speed = wShin.clone().sub(wThigh).dot(hinge);
    if (Number.isFinite(last)) out.peak = Math.max(out.peak, Math.abs(speed - last) / dt);
    last = speed;
    out.deepest = Math.min(out.deepest, 2 * Math.atan2(q.x, q.w));
    out.rebound = Math.max(out.rebound, speed);
    out.thigh = Math.max(out.thigh, Math.abs(wThigh.dot(hinge)));
  }
  physics.preStep.delete(hook);
  rag.destroy();
  c.release();
  return out;
}

/** Total angular momentum of a chain about its centre of mass, from Rapier's own inertia. */
function angularMomentum(rag: Rag): number {
  const centre = new THREE.Vector3();
  let mass = 0;
  for (const p of rag.parts) {
    const c = p.body.worldCom();
    centre.x += c.x * p.body.mass();
    centre.y += c.y * p.body.mass();
    centre.z += c.z * p.body.mass();
    mass += p.body.mass();
  }
  centre.divideScalar(mass);
  const total = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const frame = new THREE.Quaternion();
  for (const p of rag.parts) {
    const c = p.body.worldCom();
    const l = p.body.linvel();
    const a = p.body.angvel();
    const r = p.body.rotation();
    const f = p.body.principalInertiaLocalFrame();
    const inertia = p.body.principalInertia();
    q.set(r.x, r.y, r.z, r.w).multiply(frame.set(f.x, f.y, f.z, f.w));
    const spin = v(a.x, a.y, a.z).applyQuaternion(q.clone().conjugate());
    total.add(v(spin.x * inertia.x, spin.y * inertia.y, spin.z * inertia.z).applyQuaternion(q));
    total.add(v(c.x, c.y, c.z).sub(centre).cross(v(l.x, l.y, l.z)).multiplyScalar(p.body.mass()));
  }
  return total.length();
}

/** Angle of a limb away from straight down its parent, forward positive, in the parent's frame. */
function swingForward(c: TestDummy, parent: number, from: number, to: number): number {
  const q = new THREE.Quaternion().setFromRotationMatrix(c.bones[parent]!.matrixWorld).conjugate();
  const d = at(c, to).sub(at(c, from)).applyQuaternion(q);
  return Math.atan2(d.z, -d.y);
}

beforeAll(async () => {
  physics = await Physics.create();
  ctx = makeCtx({
    physics,
    render: { scene, decals: { add() {}, splat() {}, clear() {} } } as unknown as Ctx['render'],
  });
  gore = createGoreSystem(ctx);
  gore.init();
  physics.addStaticBox(v(0, -0.5, 0), v(60, 0.5, 60), null, 'concrete');
  physics.flushQueries();
});

describe('soft limits', () => {
  it('slows a joint into its limit instead of stopping it dead', () => {
    const hard = whipKnee(false, 1 / 240);
    const soft = whipKnee(true, 1 / 240);
    expect(soft.peak).toBeLessThan(hard.peak / 4);
    expect(soft.rebound).toBeLessThan(2);
  });

  it('feels the same at any step length, so slow motion does not change it', () => {
    const fast = whipKnee(true, 1 / 60);
    const slow = whipKnee(true, 1 / 240);
    expect(Math.abs(fast.deepest - slow.deepest)).toBeLessThan(0.08);
  });

  it('never reaches the hard stop that is left behind it, in an ordinary whip', () => {
    const soft = whipKnee(true, 1 / 60);
    expect(soft.deepest).toBeGreaterThan(-MuscleTuning.hardMarginStraight + 0.02);
  });

  it('hands what it stops on to the rest of the limb', () => {
    expect(whipKnee(true, 1 / 60).thigh).toBeGreaterThan(1);
  });
});

describe('neutral posture', () => {
  it('a weightless body drifts into its resting pose', () => {
    gore.clear();
    weightless(() => {
      const c = spawn(0, 0, 2.5);
      gore.ragdoll(c);
      const rag = ragOf(c);
      const q = new THREE.Quaternion();
      const error = () => {
        const joints = rag.parts.filter(p => p.parent && p.muscle!.hasRelax);
        let sum = 0;
        for (const p of joints) {
          q.copy(p.parent!.q).conjugate().multiply(p.q);
          sum += 2 * Math.acos(Math.min(1, Math.abs(q.dot(p.muscle!.relax))));
        }
        return sum / joints.length;
      };
      run(2);
      const start = error();
      run(60 * 6.5);
      expect(start).toBeGreaterThan(0.6);
      expect(error()).toBeLessThan(0.12);
    });
    gore.clear();
  }, 30000);

  it('reshapes a body without spinning it up', () => {
    // Against hard limits, not zero: a body starts with what its bones were doing. Ligaments add a little, through
    // the linear half of `resist`, which has nothing to push against. About 5% is what they measure.
    const peak = (muscles: boolean): number => {
      gore.clear();
      const c = spawn(0, 0, 2.5);
      gore.ragdoll(c, { muscles });
      const rag = ragOf(c);
      let most = 0;
      for (let i = 0; i < 60 * 6.5 && rag.active; i++) {
        frame();
        most = Math.max(most, angularMomentum(rag));
      }
      gore.clear();
      return most;
    };
    weightless(() => {
      expect(peak(true)).toBeLessThan(peak(false) * 1.15);
    });
  }, 30000);

  it('gives every torque its reaction, so a body cannot turn itself', () => {
    // Ligaments are the exception, through the linear half of `resist`, so they are off here. Total momentum cannot
    // show this: a body starts with more than a lost reaction would add.
    gore.clear();
    const { limitDamping, limitSpring } = MuscleTuning;
    MuscleTuning.limitDamping = 0;
    MuscleTuning.limitSpring = 0;
    try {
      const c = spawn();
      gore.ragdoll(c, { twitch: 1 });
      const rag = ragOf(c);
      const sum = new THREE.Vector3();
      let worst = 0;
      let most = 0;
      for (let i = 0; i < 150; i++) {
        frame();
        for (const p of rag.parts) p.tau.set(0, 0, 0);
        rag.muscle!.step(1 / 60);
        sum.set(0, 0, 0);
        for (const p of rag.parts) {
          sum.add(p.tau);
          most = Math.max(most, p.tau.length());
        }
        worst = Math.max(worst, sum.length());
      }
      expect(most).toBeGreaterThan(0.01);
      expect(worst).toBeLessThan(most * 1e-6);
    } finally {
      MuscleTuning.limitDamping = limitDamping;
      MuscleTuning.limitSpring = limitSpring;
      gore.clear();
    }
  });

  it('no two bodies rest alike', () => {
    gore.clear();
    const a = spawn(-1);
    const b = spawn(1);
    gore.ragdoll(a);
    gore.ragdoll(b);
    const angle = (r: Rag) => r.parts.find(p => p.bone === B.shinL)!.muscle!.relaxAngle;
    expect(Math.abs(angle(ragOf(a)) - angle(ragOf(b)))).toBeGreaterThan(1e-3);
    gore.clear();
  });

  it('never lifts a limb against gravity', () => {
    gore.clear();
    // A leg on its back, whose knee wants to bend up by far more than this allows.
    const c = spawn(0, 0, 0.1);
    c.root.rotation.x = Math.PI / 2;
    c.root.updateMatrixWorld(true);
    const info = rigInfo(c.rig);
    const mask = new Uint8Array(64);
    markSubtree(info, B.thighL, mask);
    const rag = new Rag(physics, c, {
      chainRoot: B.thighL, mask, seeds: null, membership: BodyFilter.membership, collidesWith: BodyFilter.collidesWith, restitution: 0, friction: 0.7, muscles: true,
    });
    const hook = (h: number) => rag.preStep(h);
    physics.preStep.add(hook);
    let highest = 0;
    for (let i = 0; i < 80; i++) {
      physics.step(1 / 60);
      rag.drive();
      rag.measure(1 / 60, 0, 0);
      highest = Math.max(highest, at(c, B.footL).y);
    }
    physics.preStep.delete(hook);
    rag.destroy();
    c.release();
    expect(highest).toBeLessThan(0.22);
  });

  it('runs out, so that a corpse is left with nothing pulling on it', () => {
    gore.clear();
    const c = spawn();
    gore.ragdoll(c);
    expect(settle()).toBeLessThan(60 * 5);
    expect(gore.stats().corpses).toBe(1);
    gore.clear();
  });
});

describe('rotational impact', () => {
  it('a blast from the front throws the arms back and the legs forward', () => {
    let arms = 0;
    let legs = 0;
    for (let i = 0; i < 4; i++) {
      gore.clear();
      const c = spawn();
      gore.ragdoll(c);
      physics.radialImpulse(v(0, 1, 1.3), 7, 140);
      run(14);
      arms -= swingForward(c, B.chest, B.upperArmL, B.foreArmL) + swingForward(c, B.chest, B.upperArmR, B.foreArmR);
      legs += swingForward(c, B.hips, B.thighL, B.shinL) + swingForward(c, B.hips, B.thighR, B.shinR);
    }
    gore.clear();
    expect(arms / 8).toBeGreaterThan(0.5);
    expect(legs / 8).toBeGreaterThan(0.1);
  });

  it('a blast throws a body with muscles off as well', () => {
    gore.clear();
    const c = spawn();
    gore.ragdoll(c, { muscles: false });
    run(4);
    const before = at(c, B.hips);
    physics.radialImpulse(v(0, 1, 1.3), 7, 140);
    run(14);
    const moved = at(c, B.hips).distanceTo(before);
    gore.clear();
    expect(moved).toBeGreaterThan(0.2);
  });

  it('reaches a body already in the air', () => {
    // Through `throwFromBlast`, which throws muscle bodies along one line.
    gore.clear();
    const c = spawn();
    gore.ragdoll(c);
    run(6);
    const hips = at(c, B.hips);
    physics.radialImpulse(v(0, 1, 1.3), 7, 140);
    run(60);
    const moved = at(c, B.hips).distanceTo(hips);
    gore.clear();
    // Hard limits, which Physics throws alone, moved 0.96 m from here. This is held to RagTuning.maxBlastSpeed.
    expect(moved).toBeGreaterThan(3);
  });

  it('no two limbs move alike', () => {
    gore.clear();
    const c = spawn();
    gore.ragdoll(c, { impact: { dir: v(0, 0, -1), strength: 1 } });
    run(8);
    const left = swingForward(c, B.chest, B.upperArmL, B.foreArmL);
    const right = swingForward(c, B.chest, B.upperArmR, B.foreArmR);
    gore.clear();
    expect(Math.abs(left - right)).toBeGreaterThan(0.01);
  });

  it('is small for a bullet and full for a blast', () => {
    expect(impactStrength(170, 85)).toBeLessThan(0.2);
    expect(impactStrength(560, 85)).toBeGreaterThan(0.95);
  });

  it('turns an arm about its shoulder, so a blast does not fling it sideways overhead', () => {
    gore.clear();
    const c = spawn();
    gore.ragdoll(c);
    physics.radialImpulse(v(0, 1, 1.3), 7, 140);
    run(8);
    const q = new THREE.Quaternion().setFromRotationMatrix(c.bones[B.chest]!.matrixWorld).conjugate();
    const arm = at(c, B.foreArmL).sub(at(c, B.upperArmL)).applyQuaternion(q);
    gore.clear();
    // Out to the side would be most of its length here, and it was, before a body was thrown along one line.
    expect(Math.abs(arm.x)).toBeLessThan(0.2);
  });

  it('throws a body already moving, as one mass, which Physics on its own would not', () => {
    gore.clear();
    const c = spawn();
    gore.ragdoll(c);
    run(3);
    physics.radialImpulse(v(0, 1, 1.3), 7, 140);
    run(1);
    const rag = ragOf(c);
    const forearm = rag.partFor(B.foreArmL).v.length();
    const hips = rag.partFor(B.hips).v.length();
    gore.clear();
    // Left to Physics.radialImpulse the hips stay where they are: see Known limitations in docs/notes/gore.md.
    expect(hips).toBeGreaterThan(5);
    expect(forearm).toBeLessThan(hips * 2.5);
  });

  it('a ligament stops a swinging arm before it comes right round', () => {
    gore.clear();
    weightless(() => {
      const c = spawn(0, 0, 2.5);
      gore.ragdoll(c, { impact: { dir: v(0, 0, -1), strength: 1 } });
      const rag = ragOf(c);
      const arm = rag.partFor(B.upperArmL);
      const q = new THREE.Quaternion();
      let deepest = 0;
      for (let i = 0; i < 30; i++) {
        frame();
        q.copy(arm.parent!.q).conjugate().multiply(arm.q);
        deepest = Math.max(deepest, 2 * Math.acos(Math.min(1, Math.abs(q.w))));
      }
      expect(deepest).toBeLessThan(ARM_STOP);
    });
    gore.clear();
  });

  it('ignores garbage', () => {
    gore.clear();
    const c = spawn();
    gore.ragdoll(c, { impact: { dir: v(NaN, 0, 0), strength: 1 } });
    run(10);
    for (const b of c.bones) expect(Number.isFinite(b.matrixWorld.elements[13]!)).toBe(true);
    gore.clear();
  });
});

describe('collapse', () => {
  it('holds the pose at first, lets the upper body go, then folds, then settles', () => {
    gore.clear();
    const c = spawnLiving();
    const hips0 = at(c, B.hips).y;
    const before = c.bones.map((_, i) => at(c, i));
    gore.collapse(c, { duration: 1.7 });
    expect(gore.owns(c)).toBe(true);
    expect(gore.stats().collapses).toBe(1);
    frame();
    c.bones.forEach((_, i) => expect(at(c, i).distanceTo(before[i]!)).toBeLessThan(0.2));
    run(36);
    // A third of the way in the head has gone, while the legs are at full strength and still holding the hips up.
    const rag = ragOf(c);
    const drive = (bone: number) => rag.partFor(bone).muscle!.drive;
    expect(drive(B.head)).toBe(0);
    expect(drive(B.shinL)).toBe(1);
    expect(drive(B.shinR)).toBeGreaterThan(0.9);
    expect(at(c, B.head).y).toBeLessThan(before[B.head]!.y - 0.05);
    expect(at(c, B.hips).y).toBeGreaterThan(hips0 * 0.75);
    const frames = settle();
    expect(frames).toBeLessThan(60 * 5);
    expect(at(c, B.hips).y).toBeLessThan(0.45);
    expect(gore.stats().collapses).toBe(0);
    gore.clear();
  });

  it('tracks the animation steadily: no thrashing hips, and feet that stay planted', () => {
    gore.clear();
    const c = spawnLiving();
    const foot = at(c, B.footL);
    gore.collapse(c, { duration: 1.7 });
    const rag = ragOf(c);
    const hips = rag.parts[0]!;
    const q = new THREE.Quaternion();
    let spin = 0;
    let error = 0;
    let slide = 0;
    for (let i = 0; i < 30; i++) {
      frame();
      spin = Math.max(spin, hips.w.length());
      q.copy(rag.muscle!.collapse!.hipsRot);
      error = Math.max(error, 2 * Math.acos(Math.min(1, Math.abs(q.dot(hips.q)))));
      const now = at(c, B.footL);
      slide = Math.max(slide, Math.hypot(now.x - foot.x, now.z - foot.z));
    }
    gore.clear();
    // Reactions landing on the hips give 11 rad/s here, and torques sized for a whole limb give 39.
    expect(spin).toBeLessThan(HIP_SPIN);
    expect(error).toBeLessThan(HIP_ERROR);
    expect(slide).toBeLessThan(0.25);
  });

  it('stops at the cap and drops the rest as plain ragdolls', () => {
    gore.clear();
    for (let i = 0; i < GoreTuning.maxCollapses + 2; i++) gore.collapse(spawnLiving(i * 2));
    expect(gore.stats().collapses).toBe(GoreTuning.maxCollapses);
    expect(gore.stats().ragdolls).toBe(GoreTuning.maxCollapses + 2);
    gore.clear();
  });

  it('a body with no legs just drops', () => {
    gore.clear();
    const c = spawnLiving();
    gore.sever(c, 'legL', damage(at(c, B.hips)));
    gore.sever(c, 'legR', damage(at(c, B.hips)));
    gore.collapse(c);
    expect(gore.stats().collapses).toBe(0);
    expect(settle()).toBeLessThan(60 * 5);
    gore.clear();
  });

  it('a hit while going down ends it early, and a limb can come off on the way', () => {
    gore.clear();
    const slow = spawnLiving();
    gore.collapse(slow, { duration: 4 });
    run(20);
    gore.sever(slow, 'armL', damage(at(slow, B.chest)));
    expect(gore.stats().limbs).toBe(1);
    gore.ragdoll(slow, { impulses: [{ bone: B.chest, point: at(slow, B.chest), impulse: v(0, 0, -300) }] });
    run(60);
    expect(gore.stats().collapses).toBe(0);
    gore.clear();
  });

  it('survives being gibbed or thrown mid-collapse', () => {
    gore.clear();
    const a = spawnLiving(-2);
    const b = spawnLiving(2);
    gore.collapse(a);
    gore.collapse(b);
    run(15);
    gore.gib(a, at(a, B.chest), 500);
    physics.radialImpulse(at(b, B.chest).add(v(0, 0, 0.6)), 4, 200);
    run(120);
    expect(gore.stats().collapses).toBe(0);
    gore.clear();
  });

  it('is never frozen by the ragdoll budget, or it would stand there for good', () => {
    gore.clear();
    const c = spawnLiving(0, 6);
    gore.collapse(c);
    for (let i = 0; i < GoreTuning.maxRagdolls + 2; i++) gore.ragdoll(spawn((i % 8) * 2 - 8, (i >> 3) * 2));
    expect(ragOf(c).active).toBe(true);
    gore.clear();
  });

  it('is absorbed on a character gore already owns', () => {
    gore.clear();
    const c = spawnLiving();
    gore.ragdoll(c);
    gore.collapse(c);
    expect(gore.stats().collapses).toBe(0);
    expect(gore.stats().corpses).toBe(1);
    gore.clear();
  });
});

describe('twitching', () => {
  it('keeps a limb moving after the body has landed, then fades out and settles', () => {
    gore.clear();
    const c = spawn();
    gore.ragdoll(c, { twitch: 1 });
    run(110);
    expect(gore.stats().ragdolls).toBe(1);
    // Path, not distance: which limb fires and when depends on the body, and a pinned hand may not move at all.
    const points = [B.handL, B.handR, B.footL, B.footR];
    let last = points.map(b => at(c, b));
    let path = 0;
    for (let i = 0; i < 150; i++) {
      frame();
      const now = points.map(b => at(c, b));
      path += Math.max(...now.map((p, k) => p.distanceTo(last[k]!)));
      last = now;
    }
    expect(path).toBeGreaterThan(0.02);
    expect(settle()).toBeLessThan(60 * 4.5);
    gore.clear();
  }, 20000);

  it('is off unless asked for, and on by itself for a body with no head', () => {
    gore.clear();
    const plain = spawn(-1);
    gore.ragdoll(plain);
    expect(ragOf(plain).muscle!.twitch).toBe(0);
    const headless = spawn(1);
    gore.sever(headless, 'head', damage(at(headless, B.head)));
    gore.ragdoll(headless);
    expect(ragOf(headless).muscle!.twitch).toBeGreaterThan(0);
    gore.clear();
  });

  it('never leaves a stale speed on a sleeping body, which would keep it from settling', () => {
    // Rapier reports a velocity given to a sleeping body for good. Legs cut off at the waist sleep early, and 2 in 14
    // of them used to sit there reading 0.49 m/s until the time limit.
    for (let i = 0; i < 14; i++) {
      gore.clear();
      const c = spawn();
      gore.sever(c, 'abdomen', damage(at(c, B.spine)))!.torso!.kill();
      gore.ragdoll(c);
      const rag = ragOf(c);
      let frames = 0;
      while (rag.active && frames < 60 * 8) {
        frame();
        frames++;
      }
      expect(frames, `trial ${i}`).toBeLessThan(60 * 6);
    }
    gore.clear();
  }, 90000);
});

describe('every chain', () => {
  const dropped = (make: () => TestDummy): number => {
    gore.clear();
    gore.ragdoll(make(), { impact: { dir: v(1, 0, 0), strength: 1 } });
    const frames = settle();
    gore.clear();
    return frames;
  };

  it('settles on a skitter, whose light legs would bounce on a spring for as long as they were allowed', () => {
    expect(dropped(() => spawn(0, 0, 0.6, skitterRig('skitter')))).toBeLessThan(60 * 5);
  });

  it('freezes on a drone', () => {
    // Usually in about 2.3 s, sometimes at the time limit. On hard limits it is always the time limit.
    expect(dropped(() => spawn(0, 0, 2, droneRig('drone')))).toBeLessThan(60 * (GoreTuning.maxSimTime + 0.5));
  });

  it('settles on a body missing an arm, and on one missing its legs', () => {
    gore.clear();
    const arm = spawn(-2);
    gore.sever(arm, 'armL', damage(at(arm, B.chest)));
    gore.ragdoll(arm);
    const legs = spawn(2);
    gore.sever(legs, 'legL', damage(at(legs, B.hips)));
    gore.sever(legs, 'legR', damage(at(legs, B.hips)));
    gore.ragdoll(legs);
    expect(settle()).toBeLessThan(60 * 5);
    gore.clear();
  });

  it('a severed limb tumbles, and comes to rest', () => {
    gore.clear();
    const c = spawn();
    gore.sever(c, 'armL', damage(at(c, B.upperArmL)));
    expect(gore.stats().liveLimbs).toBe(1);
    run(60 * 6);
    expect(gore.stats().liveLimbs).toBe(0);
    gore.clear();
  });

  it('a corpse shot awake has no tone left, and goes back to sleep', () => {
    gore.clear();
    const c = spawn();
    gore.ragdoll(c);
    settle();
    physics.radialImpulse(v(0, 0.2, 0.5), 5, 200);
    expect(gore.stats().ragdolls).toBe(1);
    expect(settle()).toBeLessThan(60 * 5);
    gore.clear();
  });

  it('can be turned off per body for comparison', () => {
    gore.clear();
    const c = spawn();
    gore.ragdoll(c, { muscles: false });
    expect(ragOf(c).muscle).toBeNull();
    gore.clear();
  });
});
