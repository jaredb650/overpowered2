/** A vaporizing cut (the energy blade, sear.ts): the pieces any cut makes, that burn away inside SliceTuning.vapor.seconds. */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { humanoidRig } from '../characters/rig';
import { Physics } from '../physics/Physics';
import { makeCtx } from '../sandbox/harness';
import type { Ctx, DamageInfo } from '../core/contracts';
import { createGoreSystem, type Gore } from './index';
import { SliceTuning } from './sliced';
import { TestDummy } from './testDummy';

const rig = humanoidRig('test');
let physics: Physics;
let ctx: Ctx;
let gore: Gore;
const scene = new THREE.Scene();

const run = (seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    ctx.time.tick(1 / 60);
    physics.step(ctx.time.dt);
    gore.update();
  }
};

function cut(vaporize: boolean): void {
  const c = new TestDummy(rig);
  scene.add(c.root);
  c.root.updateMatrixWorld(true);
  const d: DamageInfo = {
    amount: 75, type: 'slash', point: new THREE.Vector3(0, 1.1, 0), dir: new THREE.Vector3(1, 0, 0), force: 60, source: 'sword',
    vaporize: vaporize || undefined,
  };
  gore.slice(c, d.point, new THREE.Vector3(0.2, 1, 0).normalize(), d);
}

beforeAll(async () => {
  physics = await Physics.create();
  ctx = makeCtx({ physics, render: { scene, lights: { flash() {} }, decals: { add() {}, splat() {}, clear() {} } } as unknown as Ctx['render'] });
  gore = createGoreSystem(ctx);
  gore.init();
  physics.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(40, 0.5, 40), null, 'concrete');
  physics.flushQueries();
});

describe('a vaporizing cut', () => {
  it('cuts in two, the halves still there a moment after, and gone by the end of their time', () => {
    gore.clear();
    cut(true);
    // The trunk's two, and an arm's where the plane crosses one.
    const pieces = gore.stats().halves;
    expect(pieces).toBeGreaterThanOrEqual(2);
    run(SliceTuning.vapor.seconds[0] * 0.5);
    expect(gore.stats().halves).toBe(pieces);
    run(SliceTuning.vapor.seconds[1]);
    expect(gore.stats().halves).toBe(0);
  });

  it('a steel cut\'s halves stay', () => {
    gore.clear();
    cut(false);
    const pieces = gore.stats().halves;
    expect(pieces).toBeGreaterThanOrEqual(2);
    run(SliceTuning.vapor.seconds[1] + 0.2);
    expect(gore.stats().halves).toBe(pieces);
  });
});
