/**
 * How a hit shows on a body that stays on its feet (the gore update's R1): every hit, sideways and down, strong on the struck
 * limb, and never past rest on the way back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DevFlags } from '../../core/devflags';
import { archetypeById, rigFor } from '../archetypes';
import { HumanoidBone as H, type GoreRegion } from '../rig';
import { HitShape, HumanoidAnimator } from './HumanoidAnimator';
import { HitSpring } from './springs';

const DT = 1 / 60;
/** A shot from in front of a body facing +Z. */
const FRONT = new THREE.Vector3(0, 0, -1);

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
  const anim = new HumanoidAnimator(bones, rig, def, root, new Set<GoreRegion>(), () => false);
  const step = (frames: number) => {
    for (let i = 0; i < frames; i++) {
      anim.setLocomotion({ speed: 0, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true });
      anim.update(DT, 0);
    }
    root.updateMatrixWorld(true);
  };
  step(90);
  return { rig, root, bones, anim, step };
}

type Body = ReturnType<typeof body>;
const worldQ = (b: Body, bone: number) => b.bones[bone]!.getWorldQuaternion(new THREE.Quaternion());
const worldP = (b: Body, bone: number) => b.bones[bone]!.getWorldPosition(new THREE.Vector3());
/** A world direction carried by a bone: where its own `axis` points now. */
const axisOf = (b: Body, bone: number, axis: THREE.Vector3) => axis.clone().applyQuaternion(worldQ(b, bone));

/** Runs `frames` frames after `act` and returns, per frame, what `read` says. */
function trace<T>(b: Body, frames: number, read: () => T): T[] {
  const out: T[] = [];
  for (let i = 0; i < frames; i++) {
    b.step(1);
    out.push(read());
  }
  return out;
}

/** A point on the body's left or right shoulder, at chest height. */
const shoulder = (b: Body, side: 1 | -1) => worldP(b, H.chest).add(new THREE.Vector3(side * 0.16, 0.1, 0.1));

afterEach(() => {
  DevFlags.flinch = true;
});

describe('the spring a hit rides on', () => {
  it('reaches the peak it was asked for within five frames and never crosses rest on the way back', () => {
    for (const [out, back, ratio] of [[17, 8.5, 0.65], [20, 10, 0.6], [15, 7, 0.55], [10, 5.5, 0.6], [14, 7, 0.7]] as const) {
      const s = new HitSpring(out, back, ratio);
      s.hit(0.4, -0.3, 0, 1);
      let peak = 0, at = 0, low = Infinity, high = -Infinity;
      for (let i = 1; i <= 180; i++) {
        s.step(DT);
        if (s.x > peak) { peak = s.x; at = i; }
        low = Math.min(low, s.x);
        high = Math.max(high, s.y);
      }
      expect(peak, `${out}`).toBeGreaterThan(0.4 * 0.85);
      expect(peak, `${out}`).toBeLessThan(0.4 * 1.15);
      expect(at, `${out}`).toBeLessThanOrEqual(out >= 14 ? 6 : 9);
      // Past rest the other way: none. The plain spring at half its damping rang past by a seventh.
      expect(low, `${out}`).toBeGreaterThan(-0.002);
      expect(high, `${out}`).toBeLessThan(0.002);
      expect(Math.abs(s.x) + Math.abs(s.y), `${out}`).toBeLessThan(0.01);
    }
  });

  it('is held to its limit by one hard kick and by a stream of them', () => {
    const one = new HitSpring(17, 8.5, 0.65);
    one.hit(3, 0, 0, 0.7);
    const many = new HitSpring(17, 8.5, 0.65);
    let worst = 0, far = 0;
    for (let i = 0; i < 180; i++) {
      // 800 rounds a minute.
      if (i % 5 === 0 && i < 120) many.hit(0.5, 0, 0, 0.7);
      one.step(DT);
      many.step(DT);
      worst = Math.max(worst, one.x);
      far = Math.max(far, many.x);
    }
    expect(worst).toBeLessThan(0.7 * 1.15);
    expect(far).toBeLessThan(0.7 * 1.15);
    expect(far).toBeGreaterThan(0.4);
  });
});

describe('a hit on a body that stays on its feet', () => {
  it('moves nothing on the frame it lands', () => {
    // Gore reads a jump in the pose as speed if the same burst kills (gore.md, "Nothing a hit does to the animation may land in one frame").
    const b = body('trooper');
    const before = b.bones.map(x => x.quaternion.clone());
    const hips = b.bones[H.hips]!.position.clone();
    for (const [bone, region] of [[H.chest, 'chest'], [H.upperArmL, 'arm'], [H.thighR, 'leg'], [H.head, 'head']] as const) {
      b.anim.flinch(bone, FRONT, 1.2, shoulder(b, 1));
      void region;
    }
    b.anim.update(1e-4, 0);
    b.bones.forEach((x, i) => expect(x.quaternion.angleTo(before[i]!), b.rig.bones[i]!.name).toBeLessThan(0.02));
    expect(b.bones[H.hips]!.position.distanceTo(hips)).toBeLessThan(0.002);
  });

  it('turns the struck shoulder back with the round and drops it, from the first frames', () => {
    for (const side of [1, -1] as const) {
      const b = body('trooper');
      const rest = { fwd: axisOf(b, H.chest, new THREE.Vector3(0, 0, 1)), left: axisOf(b, H.chest, new THREE.Vector3(1, 0, 0)) };
      b.anim.flinch(H.chest, FRONT, 1.05, shoulder(b, side));
      const t = trace(b, 60, () => ({ fwd: axisOf(b, H.chest, new THREE.Vector3(0, 0, 1)), left: axisOf(b, H.chest, new THREE.Vector3(1, 0, 0)) }));
      // The chest's front turns toward the struck side (that shoulder goes back), and the line across the shoulders dips on it.
      const turn = t.map(p => (p.fwd.x - rest.fwd.x) * side);
      const dip = t.map(p => -(p.left.y - rest.left.y) * side);
      expect(Math.max(...turn), `side ${side}`).toBeGreaterThan(0.25);
      expect(Math.max(...dip), `side ${side}`).toBeGreaterThan(0.15);
      // Seen by the second frame, at its most within six, and never the other way.
      expect(turn[1]!).toBeGreaterThan(0.08);
      expect(turn.indexOf(Math.max(...turn))).toBeLessThan(6);
      expect(Math.min(...turn)).toBeGreaterThan(-0.01);
      expect(Math.min(...dip)).toBeGreaterThan(-0.01);
      // And it is over: back within a twentieth of a radian by a second.
      expect(Math.abs(turn[59]!)).toBeLessThan(0.05);
    }
  });

  it('goes to one side and then the other for rounds down the middle', () => {
    const b = body('trooper');
    const sides: number[] = [];
    for (let i = 0; i < 4; i++) {
      const rest = axisOf(b, H.chest, new THREE.Vector3(0, 0, 1)).x;
      b.anim.flinch(H.chest, FRONT, 1.05, worldP(b, H.chest));
      b.step(4);
      sides.push(Math.sign(axisOf(b, H.chest, new THREE.Vector3(0, 0, 1)).x - rest));
      b.step(120);
    }
    expect(sides).toEqual([sides[0], -sides[0]!, sides[0], -sides[0]!]);
  });

  it('sends the pellets of one shell the same way', () => {
    const lean = (pellets: number) => {
      const b = body('brute');
      const rest = worldQ(b, H.chest);
      for (let i = 0; i < pellets; i++) b.anim.flinch(H.chest, FRONT, 0.5, worldP(b, H.chest));
      return Math.max(...trace(b, 30, () => worldQ(b, H.chest).angleTo(rest)));
    };
    expect(lean(2)).toBeGreaterThan(lean(1) * 1.6);
  });

  it('throws a struck arm back 20 to 40 degrees and leaves the other alone', () => {
    // The owner's answer (plan 10a.1): the strong end, on every round. An SMG round on a Trooper is size 1.05.
    const b = body('husk');
    const rest = { l: worldQ(b, H.upperArmL), r: worldQ(b, H.upperArmR), fore: b.bones[H.foreArmL]!.quaternion.clone() };
    b.anim.flinch(H.upperArmL, FRONT, 1.05, worldP(b, H.foreArmL));
    const t = trace(b, 70, () => ({ l: worldQ(b, H.upperArmL).angleTo(rest.l), r: worldQ(b, H.upperArmR).angleTo(rest.r), elbow: b.bones[H.foreArmL]!.quaternion.angleTo(rest.fore) }));
    const swing = Math.max(...t.map(p => p.l));
    expect(swing).toBeGreaterThan((20 * Math.PI) / 180);
    expect(swing).toBeLessThan((60 * Math.PI) / 180);
    // The other arm rides on the trunk's twist and no more.
    expect(Math.max(...t.map(p => p.r))).toBeLessThan(swing * 0.75);
    // The elbow folds after the upper arm: its peak comes later.
    const elbow = t.map(p => p.elbow);
    expect(Math.max(...elbow)).toBeGreaterThan(0.12);
    expect(elbow.indexOf(Math.max(...elbow))).toBeGreaterThan(t.map(p => p.l).indexOf(swing));
    expect(t[69]!.l).toBeLessThan(0.08);
  });

  it('holds a gun hand tighter than a free one', () => {
    const armed = body('trooper');
    armed.anim.setGrip({ socketPos: new THREE.Vector3(), socketRot: new THREE.Quaternion(), foregrip: null });
    armed.step(30);
    const free = body('trooper');
    const swing = (b: Body) => {
      const rest = worldQ(b, H.upperArmR);
      b.anim.flinch(H.upperArmR, FRONT, 1.05, worldP(b, H.foreArmR));
      return Math.max(...trace(b, 30, () => worldQ(b, H.upperArmR).angleTo(rest)));
    };
    const a = swing(armed), f = swing(free);
    expect(a).toBeLessThan(f * 0.9);
    expect(a).toBeGreaterThan(f * 0.5);
  });

  it('gives at the knee of a struck leg and leans the body over it', () => {
    for (const side of [1, -1] as const) {
      const b = body('trooper');
      const rest = { hips: worldP(b, H.hips), head: worldP(b, H.head) };
      b.anim.flinch(side > 0 ? H.thighL : H.thighR, FRONT, 1.05, worldP(b, side > 0 ? H.shinL : H.shinR));
      const t = trace(b, 80, () => ({ hips: worldP(b, H.hips), head: worldP(b, H.head) }));
      // The hips sink at least 4 cm and the head goes to the struck side at least 8 cm.
      expect(Math.max(...t.map(p => rest.hips.y - p.hips.y)), `side ${side}`).toBeGreaterThan(0.04);
      expect(Math.max(...t.map(p => (p.head.x - rest.head.x) * side)), `side ${side}`).toBeGreaterThan(0.08);
      // Its feet are where they were: a knee dipping, not a body sliding.
      expect(worldP(b, side > 0 ? H.footL : H.footR).y).toBeLessThan(0.2);
    }
  });

  it('snaps the head on a hit to it and hardly moves the trunk', () => {
    const b = body('trooper');
    const rest = { head: b.bones[H.head]!.quaternion.clone(), chest: worldQ(b, H.chest) };
    const at = worldP(b, H.head).add(new THREE.Vector3(0.08, 0.05, 0.1));
    b.anim.flinch(H.head, FRONT, 1.05, at);
    const t = trace(b, 60, () => ({ head: b.bones[H.head]!.quaternion.angleTo(rest.head), chest: worldQ(b, H.chest).angleTo(rest.chest) }));
    const head = Math.max(...t.map(p => p.head));
    expect(head).toBeGreaterThan(0.2);
    expect(Math.max(...t.map(p => p.chest))).toBeLessThan(head);
  });

  it('moves a Brute less than a Trooper, and still six degrees', () => {
    const lean = (id: string) => {
      const b = body(id);
      const rest = worldQ(b, H.chest);
      b.anim.flinch(H.chest, FRONT, 1.05, shoulder(b, 1));
      return Math.max(...trace(b, 30, () => worldQ(b, H.chest).angleTo(rest)));
    };
    const brute = lean('brute'), trooper = lean('trooper');
    expect(brute).toBeLessThan(trooper * 0.85);
    expect(brute).toBeGreaterThan((6 * Math.PI) / 180);
  });

  it('is leaned to a limit and held there by held fire, and comes back when it stops', () => {
    const b = body('trooper');
    const rest = worldQ(b, H.chest);
    let worst = 0;
    for (let i = 0; i < 120; i++) {
      if (i % 5 === 0) b.anim.flinch(H.chest, FRONT, 1.2, shoulder(b, i % 10 === 0 ? 1 : -1));
      b.step(1);
      worst = Math.max(worst, worldQ(b, H.chest).angleTo(rest));
    }
    expect(worst).toBeLessThan(HitShape.trunkMax * 1.6);
    b.step(120);
    expect(worldQ(b, H.chest).angleTo(rest)).toBeLessThan(0.08);
  });

  it('is the nod from before the update with the switch off', () => {
    DevFlags.flinch = false;
    const b = body('trooper');
    const rest = { chest: worldQ(b, H.chest), arm: worldQ(b, H.upperArmL) };
    b.anim.flinch(H.upperArmL, FRONT, 1.05, worldP(b, H.foreArmL));
    const t = trace(b, 40, () => ({ chest: worldQ(b, H.chest).angleTo(rest.chest), arm: worldQ(b, H.upperArmL).angleTo(rest.arm) }));
    expect(Math.max(...t.map(p => p.arm))).toBeLessThan(0.12);
  });
});

describe('a hand to the wound, and a hurt posture', () => {
  const dist = (b: Body, bone: number, to: THREE.Vector3) => worldP(b, bone).distanceTo(to);

  it('lets the flinch go first when asked to wait, then puts a hand on the wound', () => {
    const b = body('husk');
    const wound = worldP(b, H.spine).add(new THREE.Vector3(0.05, 0.05, 0.12));
    const before = Math.min(dist(b, H.handL, wound), dist(b, H.handR, wound));
    b.anim.holdWound(H.spine, wound, 1.5, 0.2);
    b.step(10);
    // A sixth of a second in, neither hand has started for it.
    expect(Math.min(dist(b, H.handL, wound), dist(b, H.handR, wound))).toBeGreaterThan(before - 0.05);
    b.step(40);
    expect(Math.min(dist(b, H.handL, wound), dist(b, H.handR, wound))).toBeLessThan(0.2);
    // And lets go when its time is up.
    b.step(120);
    expect(Math.min(dist(b, H.handL, wound), dist(b, H.handR, wound))).toBeGreaterThan(before - 0.08);
  });

  it('stands lower and bent over when hurt, eased in, and goes back to its wound', () => {
    const b = body('trooper');
    const rest = { head: worldP(b, H.head), chest: axisOf(b, H.chest, new THREE.Vector3(0, 1, 0)) };
    const wound = worldP(b, H.chest).add(new THREE.Vector3(0.08, 0.1, 0.12));
    b.anim.holdWound(H.chest, wound, 0.3);
    b.anim.setHurt(1, 0);
    b.step(1);
    // Nothing on the first frame.
    expect(rest.head.y - worldP(b, H.head).y).toBeLessThan(0.01);
    b.step(150);
    expect(rest.head.y - worldP(b, H.head).y).toBeGreaterThan(0.06);
    expect(axisOf(b, H.chest, new THREE.Vector3(0, 1, 0)).z - rest.chest.z).toBeGreaterThan(0.15);
    // Over the next ten seconds a hand is on the wound for some of the time, and off it for some.
    const at = worldP(b, H.chest).add(new THREE.Vector3(0.08, 0.1, 0.12));
    let on = 0;
    for (let i = 0; i < 600; i++) {
      b.step(1);
      if (Math.min(dist(b, H.handL, at), dist(b, H.handR, at)) < 0.22) on++;
    }
    expect(on).toBeGreaterThan(60);
    expect(on).toBeLessThan(540);
    b.anim.setHurt(0, 0);
    b.step(200);
    expect(rest.head.y - worldP(b, H.head).y).toBeLessThan(0.015);
  });

  it('dips on a weak leg at each step, leaning over it', () => {
    const walk = (limp: number) => {
      const b = body('trooper');
      b.anim.setHurt(0, limp);
      let low = Infinity, lean = 0, high = -Infinity;
      for (let i = 0; i < 600; i++) {
        b.root.position.z += 1.6 * DT;
        b.anim.setLocomotion({ speed: 1.6, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true });
        b.anim.update(DT, 0);
        if (i < 240) continue;
        b.root.updateMatrixWorld(true);
        const hips = worldP(b, H.hips);
        high = Math.max(high, hips.y);
        if (hips.y < low) {
          low = hips.y;
          // Which way the trunk leans at the bottom of the dip: the chest against the hips, to the body's left (+X).
          lean = worldP(b, H.chest).x - hips.x;
        }
      }
      return { low, lean, high };
    };
    const even = walk(0), left = walk(1), right = walk(-1);
    // 4% of its height at the bottom of the weak leg's step, and the good leg's step as high as it was.
    expect(even.low - left.low).toBeGreaterThan(0.03);
    expect(even.low - right.low).toBeGreaterThan(0.03);
    expect(Math.abs(left.high - even.high)).toBeLessThan(0.01);
    expect(left.lean).toBeGreaterThan(0.005);
    expect(right.lean).toBeLessThan(-0.005);
  });
});
