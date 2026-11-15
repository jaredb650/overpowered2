/** Vaporized bodies (Gore.vaporize): limp, up off the floor, gone in their time, and a crowd past the cap gone at once. */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { humanoidRig, HumanoidBone as B } from '../characters/rig';
import { Physics } from '../physics/Physics';
import { makeCtx } from '../sandbox/harness';
import type { Ctx } from '../core/contracts';
import { createGoreSystem, VaporTuning, type Gore } from './index';
import { TestDummy } from './testDummy';

const rig = humanoidRig('test');
let physics: Physics;
let ctx: Ctx;
let gore: Gore;
const scene = new THREE.Scene();

function spawn(x = 0, z = 0): TestDummy {
  const c = new TestDummy(rig);
  c.root.position.set(x, 0, z);
  scene.add(c.root);
  c.root.updateMatrixWorld(true);
  return c;
}

const run = (seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    ctx.time.tick(1 / 60);
    physics.step(ctx.time.dt);
    gore.update();
  }
};
const hips = (c: TestDummy) => new THREE.Vector3().setFromMatrixPosition(c.bones[B.hips]!.matrixWorld).y;

beforeAll(async () => {
  physics = await Physics.create();
  ctx = makeCtx({ physics, render: { scene, lights: { flash() {} }, decals: { add() {}, splat() {}, clear() {} } } as unknown as Ctx['render'] });
  gore = createGoreSystem(ctx);
  gore.init();
  physics.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(40, 0.5, 40), null, 'concrete');
  physics.flushQueries();
});

describe('vaporize', () => {
  it('lifts the body off the floor, and is gone by the end of its time', () => {
    gore.clear();
    const c = spawn();
    const start = hips(c);
    gore.vaporize(c);
    expect(gore.owns(c)).toBe(true);
    run(VaporTuning.seconds[0] * 0.7);
    expect(hips(c)).toBeGreaterThan(start + 0.3);
    run(VaporTuning.seconds[1]);
    expect(gore.owns(c)).toBe(false);
    expect(c.root.parent).toBe(null);
    expect(gore.stats().ragdolls).toBe(0);
  });

  it('past the cap a body is ash on the spot, and the rest still float', () => {
    gore.clear();
    const crowd = Array.from({ length: VaporTuning.max + 3 }, (_, i) => spawn(i * 1.5 - 10, 0));
    for (const c of crowd) gore.vaporize(c);
    expect(crowd.filter(c => gore.owns(c)).length).toBe(VaporTuning.max);
    expect(crowd.filter(c => c.root.parent === null).length).toBe(3);
    // None of the floating ones is frozen by the ragdoll budget on the way up.
    run(1);
    expect(gore.stats().ragdolls).toBe(VaporTuning.max);
    run(VaporTuning.seconds[1] + 0.2);
    expect(crowd.every(c => !gore.owns(c))).toBe(true);
  });
});
