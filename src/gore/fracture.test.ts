/** Broken joints on real ragdolls, headless. A snapped limb has to flop past where it could go whole, and stay broken. */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HumanoidBone as B, humanoidRig } from '../characters/rig';
import type { Ctx } from '../core/contracts';
import { Physics } from '../physics/Physics';
import { makeCtx } from '../sandbox/harness';
import { createGoreSystem, type Gore } from './index';
import { TestDummy } from './testDummy';

const rig = humanoidRig('test');
const scene = new THREE.Scene();
let physics: Physics;
let ctx: Ctx;
let gore: Gore;

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function run(frames: number): void {
  for (let i = 0; i < frames; i++) {
    ctx.time.tick(1 / 60);
    physics.step(ctx.time.dt);
    gore.update();
  }
}

function spawn(x: number): TestDummy {
  const c = new TestDummy(rig);
  c.root.position.set(x, 0, 0);
  scene.add(c.root);
  c.root.updateMatrixWorld(true);
  return c;
}

/** Angle about the hinge, in the rig's sense: positive folds an elbow, negative folds a knee. */
const hinge = (c: TestDummy, bone: number) => -2 * Math.atan2(c.bones[bone]!.quaternion.x, c.bones[bone]!.quaternion.w);

/**
 * Throws a dead body at the floor with its knee kicked backward, so the knee is forced the way it should not go. Kicked
 * forward it was forced back through the toe of the foot's capsule, and a body now stands on a ball at the heel.
 */
function fall(c: TestDummy): void {
  gore.ragdoll(c, {
    velocity: v(0, -2, 0),
    impulses: [{ bone: B.shinL, point: new THREE.Vector3().setFromMatrixPosition(c.bones[B.shinL]!.matrixWorld), impulse: v(0, 0, -60) }],
  });
}

beforeAll(async () => {
  physics = await Physics.create();
  ctx = makeCtx({ physics, render: { scene, decals: { add() {}, splat() {}, clear() {} } } as unknown as Ctx['render'] });
  gore = createGoreSystem(ctx);
  gore.init();
  physics.addStaticBox(v(0, -0.5, 0), v(40, 0.5, 40), null, 'concrete');
  physics.flushQueries();
});

describe('a broken joint on a ragdoll', () => {
  it('goes past its limit where a whole one stops', () => {
    const whole = spawn(-3);
    const broken = spawn(3);
    broken.fracture(B.shinL);
    fall(whole);
    fall(broken);
    let wholeMost = 0;
    let brokenMost = 0;
    for (let i = 0; i < 60; i++) {
      run(1);
      // A knee folds negative, so positive is hyperextended.
      wholeMost = Math.max(wholeMost, hinge(whole, B.shinL));
      brokenMost = Math.max(brokenMost, hinge(broken, B.shinL));
    }
    expect(wholeMost).toBeLessThan(0.45);
    expect(brokenMost).toBeGreaterThan(wholeMost + 0.3);
    gore.clear();
  });

  it('opens up on a body that is already down, when a shot breaks it there', () => {
    const c = spawn(0);
    gore.ragdoll(c, { velocity: v(0, -1, 0) });
    run(60);
    const before = gore.stats().ragdolls + gore.stats().corpses;
    expect(before).toBeGreaterThan(0);
    // By way of the same path a corpse hit takes.
    const fresh = c.fracture(B.foreArmL);
    expect(fresh).toBe(true);
    const body = (gore as unknown as { owned: Map<TestDummy, { rag: { breakJoint(b: number): void; partOf: { muscle: { broken: boolean } | null }[] } }> }).owned.get(c)!;
    body.rag.breakJoint(B.foreArmL);
    expect(body.rag.partOf[B.foreArmL]!.muscle!.broken).toBe(true);
    gore.clear();
  });

  it('stays calm: a body with broken joints still settles', () => {
    const c = spawn(0);
    c.fracture(B.foreArmL);
    c.fracture(B.upperArmR);
    c.fracture(B.shinR);
    c.fracture(B.thighL);
    gore.ragdoll(c, { velocity: v(0, -2, 1) });
    run(300);
    expect(gore.stats().ragdolls).toBe(0);
    gore.clear();
  });
});
