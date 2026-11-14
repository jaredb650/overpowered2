/**
 * Catching balance (`stand.ts`): a living body on its muscles and on its feet, on real Rapier ragdolls and the real animator,
 * on the harness `knockdown.test.ts` uses. It catches itself and is handed back standing, or it goes over on the same ragdoll.
 * `LOG=1` prints what each test measured.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { archetypeById, rigFor } from '../characters/archetypes';
import { HumanoidAnimator } from '../characters/animation/HumanoidAnimator';
import { HumanoidBone as B } from '../characters/rig';
import { Physics } from '../physics/Physics';
import { makeCtx } from '../sandbox/harness';
import type { Ctx } from '../core/contracts';
import { createGoreSystem, GoreTuning, type Gore } from './index';
import type { Rag } from './rag';
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

function spawnLiving(x = 0, z = 0, kind = 'trooper', y = 0): TestDummy {
  const def = archetypeById(kind);
  const rig = rigFor(def);
  const c = new TestDummy(rig);
  c.root.position.set(x, y, z);
  scene.add(c.root);
  c.root.updateMatrixWorld(true);
  (c as { anim: unknown }).anim = new HumanoidAnimator(c.bones, rig, def, c.root, c.severed, b => hidden(c, b));
  for (let i = 0; i < 20; i++) stand(c);
  c.root.updateMatrixWorld(true);
  return c;
}

/** One frame of the game: the owner animates what it still has, then physics, then gore. */
function frame(c: TestDummy | null): void {
  ctx.time.tick(1 / 60);
  if (c && !gore.downed(c)) stand(c);
  physics.step(ctx.time.dt);
  gore.update();
  c?.root.updateMatrixWorld(true);
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
  // A step 0.3 m up, out of the way of everything else, for the body that is refused on it.
  physics.addStaticBox(v(40, 0.15, 40.5), v(2, 0.15, 0.5), null, 'concrete');
  physics.flushQueries();
});

const ragOf = (c: TestDummy): Rag => (gore as unknown as { owned: Map<TestDummy, { rag: Rag }> }).owned.get(c)!.rag;
const pose = (c: TestDummy) => c.bones.map((_, i) => at(c, i));

/** As `damage.ts` does it: the animator is told to stumble, then gore takes the body at the speed it reels, with a budget. */
function catchIt(c: TestDummy, dir: THREE.Vector3, reel: number, strength: number, budget: number): boolean {
  if (reel > 0) c.anim.stumble!(dir, strength, B.chest);
  return gore.knockdown(c, {
    velocity: dir.clone().multiplyScalar(reel), stumble: { seconds: StandTuning.maxSeconds, budget }, hurt: 0.6, lie: 0.6, rise: 1.6,
    wound: { bone: B.chest, point: at(c, B.chest) },
  });
}

const hit = (c: TestDummy, bone: number, dir: THREE.Vector3, force: number, cost = 0) =>
  gore.knockdown(c, { impulses: [{ bone, point: at(c, bone), impulse: dir.clone().multiplyScalar(force) }], cost });

interface Stood {
  /** Frame gore gave it back standing, or -1; frame it lost its feet, or -1, and why. */
  back: number;
  lost: number;
  why: string | null;
  steps: number;
  /** Metres the hips went over the floor. */
  travel: number;
  /** Most a foot the animation had planted moved over the floor in a frame while it was held; and most any foot under 0.12 m did, which takes in one that is slow to lift into its step. */
  slide: number;
  skim: number;
  /** Most any bone's movement changed from one frame to the next, over the hand-back and the 15 frames after it. */
  pop: number;
  /** Change in the hips' velocity over the frame it lost its feet, m/s. */
  dv: number;
  /** Most the chest was off the chest its animation asked for, radians. */
  tilt: number;
  same: boolean;
}

/** Follows a body catching its balance until `frames` are up, or `after` frames past the end of its stand. */
function follow(c: TestDummy, frames: number, after = 15, each?: (f: number) => void): Stood {
  const rag = ragOf(c);
  const muscle = rag.muscle!;
  const drive = muscle.collapse!;
  const out: Stood = { back: -1, lost: -1, why: null, steps: 0, travel: 0, slide: 0, skim: 0, pop: 0, dv: 0, tilt: 0, same: true };
  const from = at(c, B.hips);
  let last = pose(c);
  let move: THREE.Vector3[] | null = null;
  const hipsV: THREE.Vector3[] = [];
  const planted = [0, 0];
  for (let f = 0; f < frames; f++) {
    each?.(f);
    const held = muscle.collapse !== null;
    // Planted: the animation has had it down for three frames, which is as long as the foot itself takes to land after it.
    for (let i = 0; i < 2; i++) planted[i] = drive.swing[i] ? 0 : planted[i]! + 1;
    frame(c);
    const down = gore.downed(c);
    out.same &&= down === null || ragOf(c) === rag;
    const now = pose(c);
    const step = now.map((p, i) => p.clone().sub(last[i]!));
    if (held && muscle.collapse) {
      out.tilt = Math.max(out.tilt, muscle.balance.tilt);
      [B.footL, B.footR].forEach((foot, i) => {
        if (now[foot]!.y >= 0.12 || last[foot]!.y >= 0.12) return;
        const moved = Math.hypot(step[foot]!.x, step[foot]!.z);
        out.skim = Math.max(out.skim, moved);
        if (planted[i]! > 3 && !drive.swing[i]) out.slide = Math.max(out.slide, moved);
      });
    }
    hipsV.push(step[B.hips]!.clone().multiplyScalar(60));
    if (out.back < 0 && out.lost < 0) {
      out.steps = drive.stand!.steps;
      if (!down) out.back = f;
      else if (muscle.balance.lost) {
        out.lost = f;
        out.why = muscle.balance.lost;
      }
    }
    if (move && out.back >= 0 && f <= out.back + 15) {
      for (let i = 0; i < step.length; i++) out.pop = Math.max(out.pop, step[i]!.distanceTo(move[i]!));
    }
    if (out.lost >= 0 && f === out.lost + 1) out.dv = Math.max(hipsV[f]!.distanceTo(hipsV[f - 1]!), hipsV[f - 1]!.distanceTo(hipsV[f - 2] ?? hipsV[f - 1]!));
    move = step;
    last = now;
    const ended = out.back >= 0 ? out.back : out.lost;
    if (ended >= 0 && f >= ended + after) break;
  }
  const hips = at(c, B.hips);
  out.travel = Math.hypot(hips.x - from.x, hips.z - from.z);
  return out;
}

const headings: readonly (readonly [number, number])[] = [[0, 1], [0, -1], [1, 0], [-0.7, 0.7]];

describe('catching balance', () => {
  for (const [x, z] of headings) {
    it(`catches itself and is handed back standing, heading ${x},${z}`, () => {
      // Strength 0.5 reeling at 2.5 m/s with a budget of 0.8: the animated reel of the same hit carries the hips 0.98 m.
      gore.clear();
      const c = spawnLiving();
      expect(catchIt(c, v(x, 0, z).normalize(), 2.5, 0.5, 0.8)).toBe(true);
      expect(gore.stats().standing).toBe(1);
      expect(gore.downed(c)?.standing).toBe(true);
      const r = follow(c, 60 * 2.5 + 16);
      log('catches', x, z, JSON.stringify(r));
      expect(r.same).toBe(true);
      expect(r.lost).toBe(-1);
      expect(r.back).toBeGreaterThan(StandTuning.minStand * 60);
      expect(r.back).toBeLessThanOrEqual(60 * 2.5);
      expect(r.steps).toBeGreaterThanOrEqual(2);
      expect(r.steps).toBeLessThanOrEqual(5);
      expect(r.travel).toBeGreaterThanOrEqual(0.7);
      expect(r.travel).toBeLessThanOrEqual(1.3);
      expect(r.slide).toBeLessThanOrEqual(0.05);
      expect(r.pop).toBeLessThanOrEqual(0.06);
      expect(gore.handedBack(c)).toBe('stand');
      expect(gore.downed(c)).toBeNull();
      expect(gore.owns(c)).toBe(false);
      expect(gore.stats().ragdolls).toBe(0);
      expect(at(c, B.hips).y).toBeGreaterThanOrEqual(0.8);
      expect(Math.abs(c.root.position.y)).toBeLessThanOrEqual(0.001);
      gore.clear();
    });
  }

  it('loses it, on the same ragdoll, and gets up', () => {
    // Strength 0.9 reeling at 3.5 m/s with a budget of 0.25: more than its feet can catch with what it has left.
    for (const [x, z] of headings) {
      gore.clear();
      const c = spawnLiving();
      expect(catchIt(c, v(x, 0, z).normalize(), 3.5, 0.9, 0.25)).toBe(true);
      let hips = 9;
      const r = follow(c, 72, 72, f => {
        if (f === 71) hips = at(c, B.hips).y;
      });
      log('loses', x, z, JSON.stringify(r), 'hips at 1.2 s', hips.toFixed(2));
      expect(r.same).toBe(true);
      expect(r.back).toBe(-1);
      expect(r.lost).toBeGreaterThan(0);
      expect(r.lost).toBeLessThanOrEqual(0.8 * 60);
      expect(r.dv).toBeLessThanOrEqual(1);
      expect(hips).toBeLessThan(0.6);
      expect(gore.stats().standing).toBe(0);
      // Then it gets up, as from any knockdown.
      let last = pose(c);
      let back = -1;
      let pop = 0;
      for (let f = 0; f < 60 * 7 && (back < 0 || f <= back + 30); f++) {
        frame(c);
        const now = pose(c);
        if (back < 0 && !gore.downed(c)) back = f;
        if (back >= 0) for (let i = 0; i < now.length; i++) pop = Math.max(pop, now[i]!.distanceTo(last[i]!));
        last = now;
      }
      expect(back).toBeGreaterThan(0);
      expect(pop).toBeLessThan(0.14);
      expect(gore.handedBack(c)).toBe('clip');
      for (let i = 0; i < 60 * 3; i++) frame(c);
      expect(at(c, B.head).y).toBeGreaterThan(1.4);
    }
    gore.clear();
  });

  it('every round lands: held under fire, it goes down', () => {
    // 20 N·s in the chest every 0.1 s, each a tenth of its health.
    gore.clear();
    const c = spawnLiving();
    const dir = v(0, 0, -1);
    expect(catchIt(c, dir, 2.5, 0.5, 0.8)).toBe(true);
    const r = follow(c, 60 * 2.5, 0, f => {
      if (f % 6 === 5 && gore.downed(c)?.standing) hit(c, B.chest, dir, 20, 0.1);
    });
    log('rounds', JSON.stringify(r));
    expect(r.back).toBe(-1);
    expect(r.lost).toBeGreaterThan(0);
    expect(r.same).toBe(true);
    expect(r.travel).toBeLessThanOrEqual(3);
    gore.clear();
  });
});

describe('out of time', () => {
  const timed = (reel: number, seconds: number) => {
    gore.clear();
    const c = spawnLiving();
    const dir = v(0, 0, -1);
    if (reel > 0) c.anim.stumble!(dir, 0.5, B.chest);
    expect(gore.knockdown(c, { velocity: dir.clone().multiplyScalar(reel), stumble: { seconds, budget: 0.9 }, hurt: 0.6, lie: 0.6, rise: 1.6 })).toBe(true);
    const r = follow(c, 40, 0);
    gore.clear();
    return r;
  };

  it('at rest it has caught itself, and still moving it goes over', () => {
    // Before `minStand`, so only the clock can end either.
    const still = timed(0, 0.25);
    expect(still.lost).toBe(-1);
    expect(still.back).toBeGreaterThanOrEqual(14);
    expect(still.back).toBeLessThanOrEqual(17);
    const moving = timed(2.5, 0.3);
    expect(moving.back).toBe(-1);
    expect(moving.why).toBe('clock');
  });
});

describe('mass', () => {
  /** A body standing on its muscles with nothing reeling it, hit once in the chest once it has stopped being loose from the start. */
  function struck(kind: string, force: number, frames: number): Stood & { moved: number; gaveUp: number; lean: number } {
    gore.clear();
    const c = spawnLiving(0, 0, kind);
    expect(catchIt(c, v(0, 0, -1), 0, 0.5, 0.9)).toBe(true);
    for (let i = 0; i < 18; i++) frame(c);
    expect(gore.downed(c)?.standing).toBe(true);
    const from = at(c, B.hips);
    const up = () => v(0, 1, 0).transformDirection(c.bones[B.chest]!.matrixWorld);
    const was = up();
    hit(c, B.chest, v(0, 0, -1), force);
    let moved = 0;
    let lean = 0;
    const r = follow(c, frames, 0, () => {
      const p = at(c, B.hips);
      if (!gore.downed(c)) return;
      moved = Math.max(moved, Math.hypot(p.x - from.x, p.z - from.z));
      lean = Math.max(lean, up().angleTo(was));
    });
    gore.clear();
    return { ...r, moved, lean, gaveUp: r.lost };
  }

  it('a Brute barely leans where a Trooper lurches', () => {
    // The same 60 N·s round in the chest, over four bodies each: which joints a round jolts is random. How far the chest
    // turns from where it was, and how far the hips are carried.
    const mean = (kind: string) => {
      const out = { lean: 0, moved: 0, steps: 0 };
      for (let i = 0; i < 4; i++) {
        const r = struck(kind, 60, 40);
        out.lean += r.lean / 4;
        out.moved += r.moved / 4;
        out.steps += r.steps / 4;
      }
      return out;
    };
    const trooper = mean('trooper');
    const brute = mean('brute');
    log('mass: trooper', JSON.stringify(trooper), 'brute', JSON.stringify(brute));
    expect(trooper.lean).toBeGreaterThan(0.2);
    expect(brute.lean).toBeLessThanOrEqual(trooper.lean * 0.45);
    expect(brute.moved).toBeLessThanOrEqual(trooper.moved * 0.6);
    expect(brute.steps).toBe(0);
  });

  it('a light round does not move the hips, a hard one takes steps, a harder one takes its feet', () => {
    for (const f of (process.env.SWEEP ?? '').split(',').filter(Boolean)) {
      const r = struck('trooper', Number(f), 90);
      log(f, 'N·s:', r.lost >= 0 ? `lost ${r.why} at ${r.lost}` : `back at ${r.back}`, 'steps', r.steps, 'moved', r.moved.toFixed(2), 'tilt', r.tilt.toFixed(2), 'lean', r.lean.toFixed(2));
    }
    const light = struck('trooper', 20, 60);
    log('20 N·s', JSON.stringify(light));
    expect(light.moved).toBeLessThanOrEqual(0.08);
    expect(light.lost).toBe(-1);
    const hard = struck('trooper', 60, 90);
    log('60 N·s', JSON.stringify(hard));
    expect(hard.lost).toBe(-1);
    expect(hard.steps).toBeGreaterThanOrEqual(1);
    expect(hard.steps).toBeLessThanOrEqual(3);
    const harder = struck('trooper', 150, 60);
    log('150 N·s', JSON.stringify(harder));
    expect(harder.gaveUp).toBeGreaterThanOrEqual(0.15 * 60 - 2);
    expect(harder.gaveUp).toBeLessThanOrEqual(0.6 * 60);
  });
});

describe('room for it', () => {
  it('the seventh at once is refused, and none of them is ever frozen', () => {
    gore.clear();
    const n = GoreTuning.maxStanding;
    const bodies = Array.from({ length: n + 1 }, (_, i) => spawnLiving(i * 2 - 6, 6));
    // Corpses up to the ragdoll budget first, so the budget has something to want to freeze.
    const dead = Array.from({ length: GoreTuning.maxRagdolls }, (_, i) => spawnLiving(i * 1.5 - 10, -6));
    for (const d of dead) gore.ragdoll(d);
    for (let i = 0; i < n; i++) expect(catchIt(bodies[i]!, v(0, 0, 1), 2.5, 0.5, 0.8)).toBe(true);
    const seventh = bodies[n]!;
    expect(catchIt(seventh, v(0, 0, 1), 2.5, 0.5, 0.8)).toBe(false);
    expect(gore.downed(seventh)).toBeNull();
    // Refused, it can still be knocked down the old way, and still lose its balance the stage 6 way.
    expect(gore.stats().standing).toBe(n);
    for (let f = 0; f < 20; f++) {
      frame(null);
      const s = gore.stats();
      expect(s.knockdowns).toBeLessThanOrEqual(GoreTuning.maxKnockdowns);
      for (let i = 0; i < n; i++) {
        const c = bodies[i]!;
        if (gore.downed(c)) expect(ragOf(c).active).toBe(true);
      }
    }
    gore.clear();
  });

  it('is refused with a foot on a 0.3 m step', () => {
    gore.clear();
    // Feet either side of the step's edge at z = 40: one on the floor, one 0.3 m up.
    const c = spawnLiving(40, 40);
    c.root.rotation.y = Math.PI / 2;
    for (let i = 0; i < 20; i++) stand(c);
    c.root.updateMatrixWorld(true);
    expect(Math.abs(at(c, B.footL).z - at(c, B.footR).z)).toBeGreaterThan(0.1);
    expect(catchIt(c, v(1, 0, 0), 2.5, 0.5, 0.8)).toBe(false);
    expect(gore.downed(c)).toBeNull();
    // The same hit on level ground beside it is taken.
    const d = spawnLiving(44, 44);
    expect(catchIt(d, v(1, 0, 0), 2.5, 0.5, 0.8)).toBe(true);
    gore.clear();
  });

  it('with ?stand=0 behind it, a plain stumble is as it was: no budget, no pins, and it falls', () => {
    gore.clear();
    const c = spawnLiving();
    c.anim.stumble!(v(0, 0, -1), 0.9, B.chest);
    expect(gore.knockdown(c, { velocity: v(0, 0, -3), stumble: { seconds: 0.64 }, hurt: 0.6, lie: 0.6, rise: 1.6 })).toBe(true);
    expect(gore.stats().standing).toBe(0);
    expect(gore.stats().stumbles).toBe(1);
    expect(ragOf(c).muscle!.collapse!.stand).toBeNull();
    for (let f = 0; f < 96 && ragOf(c).muscle!.reflex?.phase !== 'lying'; f++) frame(c);
    expect(ragOf(c).muscle!.reflex?.phase).toBe('lying');
    gore.clear();
  });
});
