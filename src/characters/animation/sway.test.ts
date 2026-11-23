/**
 * The struck part on physics (the gore update's R3, `sway.ts`), on the real animator: no jump going in or coming out, a
 * struck arm that hangs, lags and whips, a gun hand held tighter, a chain that cannot stretch or fold back on itself, and
 * what gore reads when it takes the body. `LOG=1` prints the numbers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { archetypeById, rigFor } from '../archetypes';
import { HumanoidBone as H, type GoreRegion } from '../rig';
import { HumanoidAnimator } from './HumanoidAnimator';
import { SwayTuning, SwayWorld } from './sway';

const DT = 1 / 60;
const FRONT = new THREE.Vector3(0, 0, -1);
const log = (...a: unknown[]) => {
  if (process.env.LOG) console.log(...a);
};

function body(id: string, speed = 0) {
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
  const anim = new HumanoidAnimator(bones, rig, def, root, new Set<GoreRegion>(), b => hidden.has(b));
  const step = (frames: number) => {
    for (let i = 0; i < frames; i++) {
      root.position.z += speed * DT;
      anim.setLocomotion({ speed, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true });
      anim.update(DT, 0);
    }
    root.updateMatrixWorld(true);
  };
  step(90);
  return { rig, root, bones, anim, step, hidden };
}

// An animator starts at a random point of its idle. Twins have to start at the same one.
beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0.37);
});
afterEach(() => {
  vi.restoreAllMocks();
});

type Body = ReturnType<typeof body>;
const worldP = (b: Body, bone: number) => b.bones[bone]!.getWorldPosition(new THREE.Vector3());
const worldQ = (b: Body, bone: number) => b.bones[bone]!.getWorldQuaternion(new THREE.Quaternion());
const pose = (b: Body) => b.bones.map(x => x.getWorldPosition(new THREE.Vector3()));
/** Most any bone moved between two poses. */
const moved = (a: THREE.Vector3[], c: THREE.Vector3[]) => Math.max(...a.map((p, i) => p.distanceTo(c[i]!)));

/** Two bodies run side by side, one with the part on physics and one without, given the same flinch. */
function pair(id: string, part: 'armL' | 'armR' | 'head' | 'trunk', bone: number, size: number, speed = 0) {
  const on = body(id, speed), off = body(id, speed);
  const at = worldP(on, bone);
  for (const b of [on, off]) b.anim.flinch(bone, FRONT, size, at);
  on.anim.sway(part, FRONT, size, bone);
  return { on, off };
}

describe('the struck part on physics', () => {
  it('moves nothing on the frame it starts, and ends on the animation with no step', () => {
    for (const [part, bone] of [['armL', H.upperArmL], ['head', H.head], ['trunk', H.chest]] as const) {
      const { on, off } = pair('trooper', part, bone, 1.05);
      // The frame of the hit: both bodies are where the animation has them.
      on.step(1); off.step(1);
      expect(moved(pose(on), pose(off)), part).toBeLessThan(1e-6);
      expect(on.anim.swaying).toBe(true);
      // How sharply any bone's movement changes from one frame to the next (a pop is a sharp change), on the body with
      // the part on physics and on its twin without: the flinch's own kick is the sharpest thing either has.
      let last = pose(on), lastOff = pose(off), far = 0, frames = 0;
      let step = last.map(() => 0), stepOff = step.slice();
      const jolt: number[] = [];
      let joltOff = 0;
      while (on.anim.swaying && frames < 240) {
        on.step(1); off.step(1);
        const now = pose(on), nowOff = pose(off);
        const s1 = now.map((p, i) => p.distanceTo(last[i]!)), s2 = nowOff.map((p, i) => p.distanceTo(lastOff[i]!));
        jolt.push(Math.max(...s1.map((d, i) => Math.abs(d - step[i]!))));
        joltOff = Math.max(joltOff, ...s2.map((d, i) => Math.abs(d - stepOff[i]!)));
        far = Math.max(far, moved(now, nowOff));
        last = now; lastOff = nowOff; step = s1; stepOff = s2;
        frames++;
      }
      const worst = Math.max(...jolt);
      const ending = Math.max(...jolt.slice(-12));
      log(part, { frames, far: +far.toFixed(3), worst: +worst.toFixed(3), flinch: +joltOff.toFixed(3), ending: +ending.toFixed(4) });
      // It did something, it is over inside a second and a half, and the last frame leaves the animation's pose exactly.
      expect(far, part).toBeGreaterThan(0.03);
      expect(frames, part).toBeLessThan(90);
      expect(frames, part).toBeGreaterThan(18);
      on.step(1); off.step(1);
      expect(moved(pose(on), pose(off)), part).toBeLessThan(0.004);
      // Going in, nothing changes more sharply than the flinch's own kick does without it; coming out, over its last fifth
      // of a second, no bone's speed changes by more than 0.5 m/s in a frame (0.008 m).
      expect(worst, part).toBeLessThan(joltOff * 1.15 + 0.005);
      expect(ending, part).toBeLessThan(0.008);
    }
  });

  it('hangs, lags and whips a struck arm: the hand goes further and later than the springs alone take it', () => {
    const { on, off } = pair('husk', 'armL', H.upperArmL, 1.05);
    const rest = { on: worldP(on, H.handL), off: worldP(off, H.handL) };
    let peakOn = 0, peakOff = 0, atOn = 0, atOff = 0, low = Infinity;
    for (let f = 1; f <= 60; f++) {
      on.step(1); off.step(1);
      const a = worldP(on, H.handL).distanceTo(rest.on), b = worldP(off, H.handL).distanceTo(rest.off);
      if (a > peakOn) { peakOn = a; atOn = f; }
      if (b > peakOff) { peakOff = b; atOff = f; }
      low = Math.min(low, worldP(on, H.handL).y - worldP(off, H.handL).y);
    }
    log({ peakOn, peakOff, atOn, atOff, low });
    expect(peakOn).toBeGreaterThan(peakOff * 1.08);
    expect(peakOn).toBeLessThan(peakOff * 1.7);
    expect(atOn).toBeGreaterThanOrEqual(atOff);
    // Loose, it has weight: the hand hangs lower than the driven one at some point.
    expect(low).toBeLessThan(-0.01);
  });

  it('holds a hand with a gun in it tighter', () => {
    const swing = (armed: boolean) => {
      const { on, off } = pair('trooper', 'armR', H.upperArmR, 1.05);
      void off;
      if (armed) on.anim.setGrip({ socketPos: new THREE.Vector3(), socketRot: new THREE.Quaternion(), foregrip: null });
      // Hit again now the grip is known.
      const b = body('trooper');
      if (armed) b.anim.setGrip({ socketPos: new THREE.Vector3(), socketRot: new THREE.Quaternion(), foregrip: null });
      b.step(30);
      const twin = body('trooper');
      if (armed) twin.anim.setGrip({ socketPos: new THREE.Vector3(), socketRot: new THREE.Quaternion(), foregrip: null });
      twin.step(30);
      b.anim.sway('armR', FRONT, 1.05, H.upperArmR);
      let far = 0;
      for (let f = 0; f < 50; f++) {
        b.step(1); twin.step(1);
        far = Math.max(far, worldP(b, H.handR).distanceTo(worldP(twin, H.handR)));
      }
      return far;
    };
    const gun = swing(true), free = swing(false);
    log({ gun, free });
    expect(gun).toBeGreaterThan(0.02);
    expect(gun).toBeLessThan(free * 0.8);
  });

  it('never stretches a bone or points one more than the cone from its animation, under held fire on a body that runs and turns', () => {
    const on = body('trooper', 3.5), off = body('trooper', 3.5);
    const lengths = (b: Body) => [[H.upperArmL, H.foreArmL], [H.foreArmL, H.handL], [H.chest, H.neck], [H.neck, H.head], [H.spine, H.chest]].map(([p, c]) => worldP(b, p!).distanceTo(worldP(b, c!)));
    const want = lengths(off);
    let stretch = 0, cone = 0;
    for (let f = 0; f < 600; f++) {
      if (f % 5 === 0 && f < 480) {
        const part = (['trunk', 'armL', 'armR', 'head'] as const)[(f / 5) % 4 | 0]!;
        const bone = part === 'trunk' ? H.chest : part === 'head' ? H.head : part === 'armL' ? H.foreArmL : H.upperArmR;
        on.anim.sway(part, new THREE.Vector3(Math.sin(f), 0.2, -Math.cos(f)).normalize(), 1.6, bone);
      }
      for (const b of [on, off]) b.root.rotation.y = Math.sin(f * 0.05) * 1.2;
      on.step(1); off.step(1);
      const got = lengths(on);
      stretch = Math.max(stretch, ...got.map((l, i) => Math.abs(l - want[i]!)));
      for (const bone of [H.upperArmL, H.foreArmL, H.upperArmR, H.chest, H.head]) cone = Math.max(cone, worldQ(on, bone).angleTo(worldQ(off, bone)));
      expect(on.bones.every(x => Number.isFinite(x.quaternion.x + x.quaternion.w))).toBe(true);
    }
    log({ stretch, cone });
    expect(stretch).toBeLessThan(1e-4);
    // A bone's turn is its own cone and the cones of what carries it, so the bound here is the chain's, not one joint's.
    expect(cone).toBeLessThan(SwayTuning.cone * 3.2);
    on.step(120); off.step(120);
    expect(on.anim.swaying).toBe(false);
    expect(moved(pose(on), pose(off))).toBeLessThan(0.004);
  });

  it('is read by a velocity probe as the body it is: the pose as shown, moving as shown', () => {
    // What gore does when it takes a body (`measureAnimVelocity`): the pose now, the animator stepped 1/90 s as a probe, the
    // pose then, and the bones put back.
    const { on, off } = pair('husk', 'armL', H.upperArmL, 1.3);
    on.step(5); off.step(5);
    const probe = (b: Body) => {
      const before = pose(b);
      const kept = b.bones.map(x => x.quaternion.clone());
      const hips = b.bones[H.hips]!.position.clone();
      b.anim.update(1 / 90, 0, true);
      b.root.updateMatrixWorld(true);
      const after = pose(b);
      b.bones.forEach((x, i) => x.quaternion.copy(kept[i]!));
      b.bones[H.hips]!.position.copy(hips);
      b.root.updateMatrixWorld(true);
      return after[H.handL]!.distanceTo(before[H.handL]!) * 90;
    };
    const shown = worldP(on, H.handL);
    const hand = probe(on), handOff = probe(off);
    log({ hand, handOff });
    // The hand's speed is the simulated arm's, which is not the animation's.
    expect(hand).toBeGreaterThan(0.5);
    expect(Math.abs(hand - handOff)).toBeGreaterThan(0.2);
    expect(worldP(on, H.handL).distanceTo(shown)).toBeLessThan(1e-9);
  });

  it('works on what is left of a maimed body, and lets go of what it loses', () => {
    const b = body('trooper');
    b.hidden.add(H.foreArmL);
    b.hidden.add(H.handL);
    b.anim.sway('armL', FRONT, 1.2, H.upperArmL);
    b.step(10);
    expect(b.anim.swaying).toBe(true);
    b.hidden.add(H.upperArmL);
    b.step(2);
    expect(b.anim.swaying).toBe(false);
  });

  it('costs next to nothing: eight upper bodies live for a second', () => {
    const bodies = Array.from({ length: 8 }, () => body('trooper'));
    const run = (hit: boolean) => {
      const start = performance.now();
      for (let f = 0; f < 60; f++) for (const b of bodies) {
        if (hit && f % 6 === 0) b.anim.sway('trunk', FRONT, 1.2, H.chest);
        b.step(1);
      }
      return (performance.now() - start) / 60;
    };
    run(false);
    const plain = run(false), live = run(true);
    log({ plainMsPerFrame: plain, liveMsPerFrame: live });
    // Under a fifth of a millisecond a frame for all eight, on top of what animating them costs.
    expect(live - plain).toBeLessThan(0.5);
  });
});

describe('a loose arm, its own body and the wall beside it', () => {
  /** Metres from the line through the hips and the neck. */
  const fromTrunk = (b: Body, bone: number): number => {
    const hips = worldP(b, H.hips), neck = worldP(b, H.neck), p = worldP(b, bone);
    const axis = neck.clone().sub(hips);
    const u = THREE.MathUtils.clamp(p.clone().sub(hips).dot(axis) / axis.lengthSq(), 0, 1);
    return hips.addScaledVector(axis, u).distanceTo(p);
  };
  /**
   * The left arm struck hard on the forearm, the round going `dir`, with the part on physics or on the flinch's springs
   * alone: the nearest its wrist comes to the trunk's line, the furthest it gets along +X, the most any bone moves in a frame.
   */
  function swing(dir: THREE.Vector3, loose = true, frames = 40) {
    const b = body('trooper');
    const at = worldP(b, H.foreArmL);
    b.anim.flinch(H.foreArmL, dir, 1.4, at);
    if (loose) b.anim.sway('armL', dir, 1.4, H.foreArmL);
    let near = Infinity, far = -Infinity, jump = 0;
    let last = pose(b);
    for (let i = 0; i < frames; i++) {
      b.step(1);
      const now = pose(b);
      jump = Math.max(jump, moved(last, now));
      last = now;
      near = Math.min(near, fromTrunk(b, H.handL));
      far = Math.max(far, worldP(b, H.handL).x);
    }
    return { near, far, jump, b };
  }
  // As tuned, a loose arm stays within a few centimetres of where the flinch's own animation takes it (the cone and the
  // drive's floor see to that), so the wall's stop has little to do. To see it work, the arm is let off the leash: no
  // cone, the least drive, and five times the snap.
  const tuned = { cone: SwayTuning.cone, hand: SwayTuning.handCone, floor: SwayTuning.floor.arm, snap: SwayTuning.snap.arm };
  const unleash = (): void => {
    SwayTuning.cone = SwayTuning.handCone = 3.1;
    SwayTuning.floor.arm = 0;
    SwayTuning.snap.arm = tuned.snap * 5;
  };
  afterEach(() => {
    SwayWorld.ray = null;
    SwayTuning.cone = tuned.cone;
    SwayTuning.handCone = tuned.hand;
    SwayTuning.floor.arm = tuned.floor;
    SwayTuning.snap.arm = tuned.snap;
  });

  it('as tuned, it goes no nearer its own trunk than the animated flinch does (so that needs no stop), and at most a hand further out', () => {
    for (const dir of [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 1).normalize()]) {
      const flinch = swing(dir, false), loose = swing(dir, true);
      log('as tuned', dir.toArray().join(','), 'near', flinch.near.toFixed(3), loose.near.toFixed(3), 'far', flinch.far.toFixed(3), loose.far.toFixed(3));
      expect(loose.near).toBeGreaterThan(flinch.near - 0.02);
      expect(loose.far).toBeLessThan(flinch.far + 0.12);
    }
  });

  it('let off the leash and thrown out sideways, it stays in front of a wall beside the body, on one ray a frame', () => {
    const out = new THREE.Vector3(1, 0.1, 0).normalize();
    unleash();
    const flinch = swing(out, false);
    const free = swing(out);
    // A wall the animation never reaches and the loose arm goes well past: a plane across +X, facing the body.
    const wallX = flinch.far + 0.12;
    expect(free.far).toBeGreaterThan(wallX + 0.1);
    let asked = 0;
    SwayWorld.ray = (origin, dir, max, hit) => {
      asked++;
      if (dir.x <= 1e-6) return false;
      const along = (wallX - origin.x) / dir.x;
      if (along < 0 || along > max) return false;
      hit.point.copy(origin).addScaledVector(dir, along);
      hit.normal.set(-1, 0, 0);
      return true;
    };
    const kept = swing(out);
    log('wall at', wallX.toFixed(3), 'flinch', flinch.far.toFixed(3), 'free', free.far.toFixed(3), 'kept', kept.far.toFixed(3), 'rays', asked, 'jump', free.jump.toFixed(3), kept.jump.toFixed(3));
    // The wrist is held at the wall: this arm arrives at five times a real one's speed, and the stop only ever eases a
    // joint out (`outSpeed`), so a few centimetres of it show where the free arm went 31 cm through.
    expect(kept.far).toBeLessThan(wallX + 0.06);
    // One ray a frame for the one arm that is loose, and none once the arm is the animation's again.
    expect(asked).toBeGreaterThan(5);
    expect(asked).toBeLessThanOrEqual(40);
    expect(kept.jump).toBeLessThanOrEqual(free.jump + 0.01);
  });

  it('clears stale flinch and sway state when handed back via blendFrom or getUp', () => {
    const b = body('trooper');
    b.step(10);
    b.anim.flinch(H.upperArmL, FRONT, 1.4);
    b.anim.sway('armL', FRONT, 1.4, H.upperArmL);
    b.step(2);
    expect(b.anim.swaying).toBe(true);

    b.anim.blendFrom(0.25);
    expect(b.anim.swaying).toBe(false);

    b.anim.flinch(H.chest, FRONT, 1.4);
    b.anim.sway('trunk', FRONT, 1.4, H.chest);
    b.step(2);
    expect(b.anim.swaying).toBe(true);

    b.anim.getUp('supine', 0.8, 0.5);
    expect(b.anim.swaying).toBe(false);
  });
});
