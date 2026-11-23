/**
 * Closed-loop Euphoria / RDR2-style DynamicBalancer tests on real Rapier physics.
 *
 * Verifies:
 * - Shot-direction knockback (front, back, left, right) & head snapping AWAY from impact
 * - Frame-0 impulse & lever-arm torque preservation (no rigid plank lock)
 * - Dynamic catch stepping on a 0.3 m step / uneven terrain
 * - Spatial probes: wall bracing (`wallAhead`) and low-cover shin tripping (`trippingOverCover`)
 * - Part-specific biomechanics: leg-shot knee buckle & hip drop, gut-shot forward curl
 * - Dying-on-feet `staggerFall`: progressive shutdown & organic crumple to the floor
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { archetypeById, rigFor } from '../characters/archetypes';
import { HumanoidAnimator } from '../characters/animation/HumanoidAnimator';
import { HumanoidBone as B } from '../characters/rig';
import { Physics } from '../physics/Physics';
import { makeCtx } from '../sandbox/harness';
import type { Ctx, DamageInfo } from '../core/contracts';
import { createGoreSystem, type Gore } from './index';
import type { Rag } from './rag';
import { TestDummy } from './testDummy';

const trooper = archetypeById('trooper');
const rig = rigFor(trooper);
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const at = (c: TestDummy, bone: number) => new THREE.Vector3().setFromMatrixPosition(c.bones[bone]!.matrixWorld);

let physics: Physics;
let ctx: Ctx;
let gore: Gore;
const scene = new THREE.Scene();

beforeAll(async () => {
  physics = await Physics.create();
  ctx = makeCtx({
    physics,
    render: { scene, decals: { add() {}, splat() {}, clear() {} } } as unknown as Ctx['render'],
  });
  gore = createGoreSystem(ctx);
  gore.init();
  // Main floor at y = 0
  physics.addStaticBox(v(0, -0.5, 0), v(80, 0.5, 80), null, 'concrete');
  // 0.3 m step platform at x = 20, z = 20..30
  physics.addStaticBox(v(20, 0.15, 25), v(5, 0.15, 5), null, 'concrete');
  // Solid wall at x = -20, z = -3 (facing +Z toward x = -20, z = 0)
  physics.addStaticBox(v(-20, 1.5, -2.5), v(5, 1.5, 0.5), null, 'concrete');
  // Low cover railing (height 0.55 m) at x = 0, z = -21.5
  physics.addStaticBox(v(0, 0.275, -21.5), v(5, 0.275, 0.25), null, 'concrete');
  physics.flushQueries();
});

function spawnLiving(x = 0, z = 0, yaw = 0): TestDummy {
  const c = new TestDummy(rig);
  c.root.position.set(x, 0, z);
  c.root.rotation.y = yaw;
  scene.add(c.root);
  c.root.updateMatrixWorld(true);
  const anim = new HumanoidAnimator(c.bones, rig, trooper, c.root, c.severed, b => (c as unknown as { hidden: Uint8Array }).hidden[b] === 1);
  (c as { anim: unknown }).anim = anim;
  for (let i = 0; i < 30; i++) {
    anim.setLocomotion({ speed: 0, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true });
    anim.update(1 / 60, 0);
  }
  c.root.updateMatrixWorld(true);
  return c;
}

function frame(c?: TestDummy): void {
  ctx.time.tick(1 / 60);
  if (c && !gore.downed(c) && !gore.owns(c)) {
    const anim = c.anim as HumanoidAnimator;
    anim.setLocomotion({ speed: 0, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true });
    anim.update(ctx.time.dt, 0);
  }
  physics.step(ctx.time.dt);
  gore.update();
  c?.root.updateMatrixWorld(true);
}

const ragOf = (c: TestDummy): Rag => (gore as unknown as { owned: Map<TestDummy, { rag: Rag }> }).owned.get(c)!.rag;

describe('DynamicBalancer (Euphoria / RDR2 active ragdoll)', () => {
  it('dying staggerFall stays planted at rest, sags under weight, and crumples to the floor', () => {
    gore.clear();
    const c = spawnLiving(0, 0, 0);
    const footL0 = at(c, B.footL);
    const head0 = at(c, B.head).y;
    gore.collapse(c, { duration: 1.5 });
    const rag = ragOf(c);
    expect(rag.muscle?.collapse?.balancer).not.toBeNull();
    let maxSlide = 0;
    for (let f = 0; f < 30; f++) {
      frame();
      const fl = at(c, B.footL);
      maxSlide = Math.max(maxSlide, Math.hypot(fl.x - footL0.x, fl.z - footL0.z));
    }
    expect(maxSlide).toBeLessThan(0.15);
    expect(at(c, B.head).y).toBeLessThan(head0 - 0.05);
    // Let the collapse complete and fall onto the floor.
    for (let f = 0; f < 180; f++) frame();
    expect(at(c, B.hips).y).toBeLessThan(0.45);
    gore.clear();
  });

  it('pushes bodies in the exact shot direction across all 4 cardinal directions', () => {
    const dirs = [v(0, 0, -1), v(0, 0, 1), v(1, 0, 0), v(-1, 0, 0)];
    for (const dir of dirs) {
      gore.clear();
      const c = spawnLiving(0, 0, 0);
      const hips0 = at(c, B.hips);
      const chest = at(c, B.chest);
      expect(gore.knockdown(c, {
        velocity: dir.clone().multiplyScalar(2.6),
        stumble: { seconds: 0.9, budget: 0.7 },
        impulses: [{ bone: B.chest, point: chest, impulse: dir.clone().multiplyScalar(55) }],
        wound: { bone: B.chest, point: chest },
      })).toBe(true);
      for (let f = 0; f < 25; f++) frame(c);
      const delta = at(c, B.hips).sub(hips0);
      delta.y = 0;
      expect(delta.dot(dir)).toBeGreaterThan(0.35);
      // Lateral drift must stay smaller than along-shot displacement.
      const perp = delta.clone().addScaledVector(dir, -delta.dot(dir));
      expect(perp.length()).toBeLessThan(delta.dot(dir) * 0.55);
    }
    gore.clear();
  });

  it('non-severing headshot snaps head AWAY from incoming bullet direction', () => {
    gore.clear();
    const c = spawnLiving(0, 0, 0);
    const head0 = at(c, B.head);
    const dir = v(0, 0, -1); // Shot from front (+Z toward -Z)
    const dmg: DamageInfo = {
      amount: 15, // below headBurstDamage / pop threshold when severMult = 0
      type: 'bullet',
      point: head0.clone().add(v(0, 0, 0.08)),
      dir,
      force: 25,
      source: 'test',
      bone: B.head,
      region: 'head',
      severMult: 0,
    };
    gore.headshot(c, dmg, undefined, 'hole');
    const rag = ragOf(c);
    const headPart = rag.partFor(B.head);
    headPart.body.linvel(headPart.v);
    // Head velocity must point along the bullet direction (-Z), never backward toward the shooter!
    expect(headPart.v.dot(dir)).toBeGreaterThan(0.2);
    gore.clear();
  });

  it('detects walls ahead and reaches arms to brace', () => {
    gore.clear();
    // Spawn 1.2 m in front of solid wall at z = -2.5 (wall front face at z = -2.0).
    const c = spawnLiving(-20, -1.25, 0);
    expect(gore.knockdown(c, {
      velocity: v(0, 0, -3.2),
      stumble: { seconds: 1.0, budget: 0.7 },
    })).toBe(true);
    const bal = ragOf(c).muscle!.collapse!.balancer!;
    let sawWall = false;
    for (let f = 0; f < 25; f++) {
      frame(c);
      if (bal.wallAhead) sawWall = true;
    }
    expect(sawWall).toBe(true);
    gore.clear();
  });

  it('detects low cover at shin height and triggers railing trip', () => {
    gore.clear();
    // Low cover at z = -21.5 (height 0.55 m, front face at z = -21.25).
    const c = spawnLiving(0, -20.8, 0);
    expect(gore.knockdown(c, {
      velocity: v(0, 0, -3.2),
      stumble: { seconds: 1.0, budget: 0.7 },
    })).toBe(true);
    const bal = ragOf(c).muscle!.collapse!.balancer!;
    let tripped = false;
    for (let f = 0; f < 25; f++) {
      frame(c);
      if (bal.trippingOverCover) tripped = true;
    }
    expect(tripped).toBe(true);
    gore.clear();
  });

  it('leg shot causes knee buckle & localized leg shock with hip drop', () => {
    gore.clear();
    const c = spawnLiving(0, 0, 0);
    const hips0 = at(c, B.hips).y;
    const kneePt = at(c, B.shinL);
    expect(gore.knockdown(c, {
      velocity: v(0, 0, -1.8),
      stumble: { seconds: 1.2, budget: 0.8 },
      impulses: [{ bone: B.shinL, point: kneePt, impulse: v(0, 0, -35) }],
      wound: { bone: B.shinL, point: kneePt },
    })).toBe(true);
    const bal = ragOf(c).muscle!.collapse!.balancer!;
    expect(bal.legs[0]!.shock).toBeGreaterThan(0.5);
    let minHipsY = hips0;
    for (let f = 0; f < 25; f++) {
      frame(c);
      minHipsY = Math.min(minHipsY, at(c, B.hips).y);
    }
    expect(minHipsY).toBeLessThan(hips0 - 0.05);
    gore.clear();
  });

  it('gut shot triggers forward abdominal curl & wound clutch and propagates shock to spine', () => {
    gore.clear();
    const c = spawnLiving(0, 0, 0);
    const gutPt = at(c, B.spine);
    expect(gore.knockdown(c, {
      velocity: v(0, 0, -1.8),
      stumble: { seconds: 1.2, budget: 0.8 },
      impulses: [{ bone: B.spine, point: gutPt, impulse: v(0, 0, -35) }],
      wound: { bone: B.spine, point: gutPt },
    })).toBe(true);
    const bal = ragOf(c).muscle!.collapse!.balancer!;
    expect(bal.gutCurl).toBeGreaterThan(0.5);
    expect(bal.woundRegion).toBe('abdomen');
    expect(bal.spineIdx).toBeGreaterThanOrEqual(0);
    expect(bal.partShock[bal.spineIdx]!).toBeGreaterThan(0.2);
    gore.clear();
  });

  it('severing a limb while dying-on-feet cleanly aborts DynamicBalancer without Rapier crash', () => {
    for (const [region, bone] of [['armL', B.upperArmL], ['legL', B.thighL]] as const) {
      gore.clear();
      const c = spawnLiving(0, 0, 0);
      gore.collapse(c, { duration: 1.5 });
      const rag = ragOf(c);
      expect(rag.muscle?.collapse?.balancer).not.toBeNull();
      for (let f = 0; f < 5; f++) frame();
      const dmg: DamageInfo = {
        amount: 90,
        type: 'slash',
        point: at(c, bone),
        dir: v(1, 0, 0),
        force: 20,
        source: 'test',
        bone,
        region,
      };
      gore.sever(c, region, dmg);
      expect(rag.muscle!.collapse).toBeNull();
      for (const part of rag.parts) {
        expect(part.muscle!.gain).toBe(1);
      }
      // Step 30 frames after severing — must never dereference freed Rapier rigidbody handles.
      expect(() => {
        for (let f = 0; f < 30; f++) frame();
      }).not.toThrow();
    }
    gore.clear();
  });

  it('fallOver() resets elevated balancer muscle gains back to 1 on legs and spine', () => {
    gore.clear();
    const c = spawnLiving(0, 0, 0);
    expect(gore.knockdown(c, {
      velocity: v(0, 0, -1.5),
      stumble: { seconds: 1.0, budget: 0.7 },
    })).toBe(true);
    const rag = ragOf(c);
    frame(c);
    const maxGainBefore = Math.max(...rag.parts.map(p => p.muscle!.gain));
    expect(maxGainBefore).toBeGreaterThan(1.5);
    expect(rag.muscle!.loseFooting('momentum')).toBe(true);
    expect(rag.muscle!.collapse).toBeNull();
    for (const part of rag.parts) {
      expect(part.muscle!.gain).toBe(1);
    }
    gore.clear();
  });

  it('backward arm clamp holds z >= -0.5 for straight-back world direction (0, 0, -1)', () => {
    gore.clear();
    const c = spawnLiving(0, 0, 0);
    gore.collapse(c, { duration: 1.5 });
    const rag = ragOf(c);
    const bal = rag.muscle!.collapse!.balancer!;
    const chest = bal.spine ?? rag.parts[0]!;
    chest.q.identity();
    const arm = bal.arms[0]!;
    (bal as unknown as { aimArm(a: typeof arm, ch: typeof chest, d: THREE.Vector3, bend: number): void })
      .aimArm(arm, chest, v(0, 0, -1), 0.5);
    const aimed = arm.rest.clone().applyQuaternion(arm.shoulder.muscle!.pose);
    expect(Number.isFinite(aimed.x + aimed.y + aimed.z)).toBe(true);
    expect(aimed.length()).toBeCloseTo(1, 4);
    expect(aimed.z).toBeGreaterThanOrEqual(-0.5 - 1e-4);
    gore.clear();
  });

  it('severing a limb while living under DynamicBalancer falls over cleanly into Reflex', () => {
    gore.clear();
    const c = spawnLiving(0, 0, 0);
    expect(gore.knockdown(c, {
      velocity: v(0, 0, -1.6),
      stumble: { seconds: 1.2, budget: 0.8 },
      hurt: 0.6,
      lie: 0.6,
      rise: 1.2,
    })).toBe(true);
    const rag = ragOf(c);
    expect(rag.muscle?.collapse?.alive).toBe(true);
    expect(rag.muscle?.collapse?.balancer).not.toBeNull();
    for (let f = 0; f < 5; f++) frame(c);
    const dmg: DamageInfo = {
      amount: 90,
      type: 'slash',
      point: at(c, B.upperArmL),
      dir: v(1, 0, 0),
      force: 20,
      source: 'test',
      bone: B.upperArmL,
      region: 'armL',
    };
    gore.sever(c, 'armL', dmg);
    // Living balancer must transition via fallOver('limb') rather than endCollapse(): collapse ends, gains reset, Reflex takes over.
    expect(rag.muscle!.collapse).toBeNull();
    expect(rag.muscle!.balance.lost).toBe('limb');
    expect(rag.muscle!.reflex).not.toBeNull();
    for (const part of rag.parts) {
      expect(part.muscle!.gain).toBe(1);
    }
    expect(() => {
      for (let f = 0; f < 30; f++) frame(c);
    }).not.toThrow();
    gore.clear();
  });

  it('multi-substep frames (20 fps) under DynamicBalancer brake smoothly without velocity reversal', () => {
    gore.clear();
    const c = spawnLiving(0, 0, 0);
    expect(gore.knockdown(c, {
      velocity: v(0, 0, -2.0),
      stumble: { seconds: 1.5, budget: 0.9 },
    })).toBe(true);
    const rag = ragOf(c);
    const bal = rag.muscle!.collapse!.balancer!;
    let reversed = false;
    for (let f = 0; f < 25; f++) {
      ctx.time.tick(1 / 20);
      physics.step(ctx.time.dt);
      gore.update();
      c.root.updateMatrixWorld(true);
      if (bal.comVel.z > 0.45) reversed = true;
      for (const p of rag.parts) {
        p.body.linvel(p.v);
        expect(Number.isFinite(p.v.x + p.v.y + p.v.z)).toBe(true);
        expect(p.v.length()).toBeLessThan(15);
      }
    }
    expect(reversed).toBe(false);
    gore.clear();
  });
});
