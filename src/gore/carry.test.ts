/**
 * Dying carries the shots (the gore update's R4), on real Rapier ragdolls and the real animator: a kill that lands on a body
 * gore has on its feet goes on from the reaction it was in, and more bodies die on their feet at once. `LOG=1` prints numbers.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { archetypeById, rigFor } from '../characters/archetypes';
import { HumanoidAnimator } from '../characters/animation/HumanoidAnimator';
import { HumanoidBone as B } from '../characters/rig';
import { DevFlags } from '../core/devflags';
import { Physics } from '../physics/Physics';
import { makeCtx } from '../sandbox/harness';
import type { Ctx } from '../core/contracts';
import { createGoreSystem, GoreTuning, type Gore } from './index';
import { StandTuning } from './stand';
import { TestDummy } from './testDummy';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const at = (c: TestDummy, bone: number) => new THREE.Vector3().setFromMatrixPosition(c.bones[bone]!.matrixWorld);
const log = (...a: unknown[]) => {
  if (process.env.LOG) console.log(...a);
};

let physics: Physics;
let ctx: Ctx;
let gore: Gore;
const scene = new THREE.Scene();
const hidden = (c: TestDummy, bone: number) => (c as unknown as { hidden: Uint8Array }).hidden[bone] === 1;

function stand(c: TestDummy): void {
  c.anim.setLocomotion({ speed: 0, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true });
  c.anim.update(1 / 60, 0);
}

function spawnLiving(x = 0, z = 0): TestDummy {
  const def = archetypeById('trooper');
  const rig = rigFor(def);
  const c = new TestDummy(rig);
  c.root.position.set(x, 0, z);
  scene.add(c.root);
  c.root.updateMatrixWorld(true);
  (c as { anim: unknown }).anim = new HumanoidAnimator(c.bones, rig, def, c.root, c.severed, b => hidden(c, b));
  for (let i = 0; i < 20; i++) stand(c);
  c.root.updateMatrixWorld(true);
  return c;
}

function frame(c: TestDummy | null): void {
  ctx.time.tick(1 / 60);
  if (c && !gore.downed(c) && !gore.owns(c)) stand(c);
  physics.step(ctx.time.dt);
  gore.update();
  c?.root.updateMatrixWorld(true);
}

beforeAll(async () => {
  physics = await Physics.create();
  ctx = makeCtx({ physics, render: { scene, decals: { add() {}, splat() {}, clear() {} } } as unknown as Ctx['render'] });
  gore = createGoreSystem(ctx);
  gore.init();
  physics.addStaticBox(v(0, -0.5, 0), v(80, 0.5, 80), null, 'concrete');
  physics.flushQueries();
});

afterEach(() => {
  DevFlags.carry = true;
  gore.clear();
});

/** A body staggered hard enough to go onto its muscles, as `damage.ts` does it, then killed by an SMG round `after` frames on. */
function killStanding(x: number, after: number): { c: TestDummy; hips: number[]; pop: number; standing: number } {
  const c = spawnLiving(x, 0);
  const dir = v(0, 0, -1);
  const standing = at(c, B.hips).y;
  c.anim.stumble!(dir, 0.6, B.chest);
  expect(gore.knockdown(c, {
    velocity: dir.clone().multiplyScalar(2.4), stumble: { seconds: StandTuning.maxSeconds, budget: 0.75 }, hurt: 0.6, lie: 0.6, rise: 1.6,
    wound: { bone: B.chest, point: at(c, B.chest) },
  })).toBe(true);
  for (let i = 0; i < after; i++) frame(c);
  expect(gore.downed(c)?.standing).toBe(true);
  let last = c.bones.map((_, i) => at(c, i));
  let step = last.map(() => 0);
  frame(c);
  let now = c.bones.map((_, i) => at(c, i));
  step = now.map((p, i) => p.distanceTo(last[i]!));
  last = now;
  gore.collapse(c, { duration: 1.1, velocity: v(0, 0, -0.4), hit: { bone: B.chest, point: at(c, B.chest), dir, force: 20 } });
  const hips: number[] = [];
  let pop = 0;
  for (let f = 0; f < 200; f++) {
    frame(c);
    now = c.bones.map((_, i) => at(c, i));
    const moved = now.map((p, i) => p.distanceTo(last[i]!));
    // How much any bone's movement changed from one frame to the next, over the kill and the ten frames after it.
    if (f < 10) for (let i = 0; i < moved.length; i++) pop = Math.max(pop, Math.abs(moved[i]! - step[i]!));
    step = moved;
    last = now;
    hips.push(at(c, B.hips).y);
  }
  return { c, hips, pop, standing };
}

describe('dying carries the shots', () => {
  it('a kill on a body catching its balance dies on its feet from where it was, with no jump', () => {
    const { c, hips, pop, standing } = killStanding(0, 12);
    expect(gore.owns(c)).toBe(true);
    expect(gore.downed(c)).toBeNull();
    const down = hips.findIndex(y => y < standing * 0.45);
    log({ pop, down, standing, hips: [0, 5, 10, 15, 20, 30, 40, 60, 90, 199].map(f => +hips[f]!.toFixed(2)).join(' ') });
    // No bone's speed changes by more than 3 m/s over a frame at the hand-over (0.05 m a frame).
    expect(pop).toBeLessThan(0.05);
    // Still on its feet a third of a second after the kill, and on the floor in the end.
    expect(hips[20]!).toBeGreaterThan(standing * 0.6);
    expect(hips[199]!).toBeLessThan(standing * 0.45);
    expect(down).toBeGreaterThan(24);
  });

  it('counts as a death on its feet while it lasts', () => {
    const c = spawnLiving(6, 0);
    c.anim.stumble!(v(1, 0, 0), 0.5, B.chest);
    gore.knockdown(c, { velocity: v(2, 0, 0), stumble: { seconds: StandTuning.maxSeconds, budget: 0.8 }, hurt: 0.6, lie: 0.6, rise: 1.6, wound: { bone: B.chest, point: at(c, B.chest) } });
    for (let i = 0; i < 8; i++) frame(c);
    expect(gore.stats().collapses).toBe(0);
    expect(gore.stats().standing).toBe(1);
    gore.collapse(c, { duration: 1 });
    expect(gore.stats().collapses).toBe(1);
    expect(gore.stats().standing).toBe(0);
    expect(gore.stats().knockdowns).toBe(0);
    for (let i = 0; i < 120; i++) frame(c);
    expect(gore.stats().collapses).toBe(0);
  });

  it('drops on the frame with the switch off, as before', () => {
    const on = killStanding(12, 12);
    DevFlags.carry = false;
    const off = killStanding(18, 12);
    const down = (r: { hips: number[]; standing: number }) => r.hips.findIndex(y => y < r.standing * 0.45);
    log({ on: down(on), off: down(off) });
    expect(down(off)).toBeGreaterThan(0);
    expect(down(on)).toBeGreaterThan(down(off) + 6);
  });

  it('lets eight die on their feet at once, where it was four', () => {
    for (let i = 0; i < GoreTuning.maxCollapses + 2; i++) gore.collapse(spawnLiving(-30 + i * 2, 8), { duration: 1.2 });
    expect(GoreTuning.maxCollapses).toBe(8);
    expect(gore.stats().collapses).toBe(8);
    gore.clear();
    DevFlags.carry = false;
    for (let i = 0; i < GoreTuning.maxCollapses + 2; i++) gore.collapse(spawnLiving(-30 + i * 2, 14), { duration: 1.2 });
    expect(gore.stats().collapses).toBe(GoreTuning.maxCollapsesBefore);
  });

  it('takes a body whose struck part was on physics from the pose and speed it shows, with no jump', () => {
    // R3: a part on physics in the animator (`sway.ts`), then the whole body taken onto its muscles, or killed, mid-swing.
    for (const how of ['stagger', 'death'] as const) {
      const c = spawnLiving(how === 'stagger' ? 24 : 30, 0);
      const dir = v(0, 0, -1);
      const frames: THREE.Vector3[][] = [];
      const snap = () => frames.push(c.bones.map((_, i) => at(c, i)));
      c.anim.flinch(B.upperArmL, dir, 1.05, at(c, B.foreArmL));
      c.anim.sway!('armL', dir, 1.05, B.upperArmL);
      c.anim.sway!('trunk', dir, 1.05, B.chest);
      for (let i = 0; i < 6; i++) { frame(c); snap(); }
      expect(c.anim.swaying).toBe(true);
      // Mid-swing: the hand is moving, and not where the animation alone would have it.
      const handSpeed = frames[5]![B.handL]!.distanceTo(frames[4]![B.handL]!) * 60;
      expect(handSpeed).toBeGreaterThan(0.3);
      if (how === 'stagger') {
        c.anim.stumble!(dir, 0.6, B.chest);
        expect(gore.knockdown(c, { velocity: dir.clone().multiplyScalar(2), stumble: { seconds: StandTuning.maxSeconds, budget: 0.8 }, hurt: 0.6, lie: 0.6, rise: 1.6, wound: { bone: B.chest, point: at(c, B.chest) } })).toBe(true);
      } else gore.ragdoll(c, { velocity: v(0, 0, 0) });
      for (let i = 0; i < 8; i++) { frame(c); snap(); }
      // The change in each bone's movement from one frame to the next, across the take-over and the frames after it.
      let pop = 0, before = 0;
      for (let f = 2; f < frames.length; f++) {
        for (let i = 0; i < c.bones.length; i++) {
          const d = Math.abs(frames[f]![i]!.distanceTo(frames[f - 1]![i]!) - frames[f - 1]![i]!.distanceTo(frames[f - 2]![i]!));
          if (f >= 6) pop = Math.max(pop, d);
          else before = Math.max(before, d);
        }
      }
      log(how, { handSpeed, pop, before });
      // No sharper than the swing itself was before anything took it over, and under 3.6 m/s in a frame at the worst.
      expect(pop, how).toBeLessThan(Math.max(before * 1.5, 0.03));
      expect(pop, how).toBeLessThan(0.06);
    }
  });
});
