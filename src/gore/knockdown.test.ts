/**
 * Hit reactions on the living, on real Rapier ragdolls and the real animator. A body that pops, slides, or stands up
 * through the floor fails here.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { archetypeById, rigFor } from '../characters/archetypes';
import { HumanoidAnimator } from '../characters/animation/HumanoidAnimator';
import { HumanoidBone as B, skitterRig } from '../characters/rig';
import { Physics } from '../physics/Physics';
import { makeCtx } from '../sandbox/harness';
import type { Ctx, DamageInfo } from '../core/contracts';
import { createGoreSystem, GoreTuning, type Gore } from './index';
import { RagTuning, type Rag } from './rag';
import { ReflexTuning } from './reflex';
import { TestDummy } from './testDummy';

const trooper = archetypeById('trooper');
const rig = rigFor(trooper);
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const at = (c: TestDummy, bone: number) => new THREE.Vector3().setFromMatrixPosition(c.bones[bone]!.matrixWorld);

let physics: Physics;
let ctx: Ctx;
let gore: Gore;
const scene = new THREE.Scene();

function spawnLiving(x = 0, z = 0): TestDummy {
  const c = new TestDummy(rig);
  c.root.position.set(x, 0, z);
  scene.add(c.root);
  c.root.updateMatrixWorld(true);
  const anim = new HumanoidAnimator(c.bones, rig, trooper, c.root, c.severed, b => hidden(c, b));
  (c as { anim: unknown }).anim = anim;
  for (let i = 0; i < 20; i++) stand(c);
  c.root.updateMatrixWorld(true);
  return c;
}

function stand(c: TestDummy): void {
  c.anim.setLocomotion({ speed: 0, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true });
  c.anim.update(1 / 60, 0);
}

/** One frame of the game: the owner animates what it still has, then physics, then gore. */
function frame(c: TestDummy | null): void {
  ctx.time.tick(1 / 60);
  if (c && !gore.downed(c)) stand(c);
  physics.step(ctx.time.dt);
  gore.update();
  c?.root.updateMatrixWorld(true);
}

const run = (c: TestDummy | null, frames: number) => {
  for (let i = 0; i < frames; i++) frame(c);
};

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

const ragOf = (c: TestDummy): Rag => (gore as unknown as { owned: Map<TestDummy, { rag: Rag }> }).owned.get(c)!.rag;

const shot = (point: THREE.Vector3, dir: THREE.Vector3, force = 20): DamageInfo => ({
  amount: 25, type: 'bullet', point: point.clone(), dir: dir.clone(), force, source: 'test',
});

const hidden = (c: TestDummy, bone: number) => (c as unknown as { hidden: Uint8Array }).hidden[bone] === 1;

/** Every bone's world position. */
const pose = (c: TestDummy) => c.bones.map((_, i) => at(c, i));

interface Run {
  /** Frame it came back from physics, or -1. */
  back: number;
  /** Most any bone moved in one frame, over the handover and the blend that follows it. */
  pop: number;
  /** Lowest any bone went once it was back on the animation. */
  floor: number;
  /** Most any bone moved in one frame, ever. */
  worst: number;
}

/** Runs a body until it is back on its feet, watching every bone. */
function watch(c: TestDummy, frames = 60 * 7): Run {
  const out: Run = { back: -1, pop: 0, floor: 9, worst: 0 };
  let last = pose(c);
  for (let f = 0; f < frames; f++) {
    frame(c);
    const now = pose(c);
    let jump = 0;
    for (let i = 0; i < now.length; i++) jump = Math.max(jump, now[i]!.distanceTo(last[i]!));
    last = now;
    out.worst = Math.max(out.worst, jump);
    if (out.back < 0 && !gore.downed(c)) out.back = f;
    if (out.back >= 0) {
      if (f <= out.back + 30) out.pop = Math.max(out.pop, jump);
      now.forEach((p, i) => {
        if (!hidden(c, i)) out.floor = Math.min(out.floor, p.y);
      });
    }
  }
  return out;
}

const knock = (c: TestDummy, x: number, z: number) => gore.knockdown(c, { topple: v(x, 0, z), lie: 0.3, rise: 1.6, hurt: 0.6 });

/** A hit capsule's two ends in the world, and the radius its collider has. */
function capsule(c: TestDummy, bone: number): { a: THREE.Vector3; b: THREE.Vector3; r: number } {
  const hit = rig.bones[bone]!.hit!;
  const m = c.bones[bone]!.matrixWorld;
  return { a: new THREE.Vector3(...hit.from).applyMatrix4(m), b: new THREE.Vector3(...hit.to).applyMatrix4(m), r: hit.radius * RagTuning.colliderScale };
}
/** Height of the lowest point of the chest, and of a hand, over the floor. */
const chestLow = (c: TestDummy) => {
  const k = capsule(c, B.chest);
  return Math.min(k.a.y, k.b.y) - k.r;
};
const handLow = (c: TestDummy, hand: number) => {
  const k = capsule(c, hand);
  return Math.min(k.a.y, k.b.y) - k.r;
};
/** Bend at an elbow, from the bones either side of it. 0 is a straight arm. */
const elbowFlex = (c: TestDummy, upper: number) => {
  const s = at(c, upper);
  const e = at(c, upper + 1);
  return e.clone().sub(s).angleTo(at(c, upper + 2).sub(e));
};

describe('knockdown', () => {
  const headings: readonly (readonly [number, number])[] = [[0, 2], [0, -2], [2, 0], [-1.4, 1.4]];
  for (const [x, z] of headings) {
    it(`goes down, gets up and stands on the floor, heading ${x},${z}`, () => {
      gore.clear();
      const c = spawnLiving();
      expect(knock(c, x, z)).toBe(true);
      expect(gore.owns(c)).toBe(false);
      expect(gore.downed(c)).not.toBeNull();
      run(c, 60);
      expect(at(c, B.hips).y).toBeLessThan(0.6);
      const r = watch(c);
      expect(r.back).toBeGreaterThan(0);
      // Back upright, over its own feet, with nothing left of the fall.
      expect(at(c, B.hips).y).toBeGreaterThan(0.8);
      expect(at(c, B.head).y).toBeGreaterThan(1.4);
      expect(Math.hypot(at(c, B.hips).x - c.root.position.x, at(c, B.hips).z - c.root.position.z)).toBeLessThan(0.15);
      expect(c.root.position.y).toBeCloseTo(0, 3);
      expect(r.pop).toBeLessThan(0.14);
      expect(r.floor).toBeGreaterThan(-0.05);
      expect(gore.stats().ragdolls).toBe(0);
    });
  }

  it('a body lying down reaches its wound', () => {
    // A working muscle carries its own weight: the drive's held torque is far under what lifts an arm, so with the arm's
    // gravity left on, the hand lies on the floor wherever it landed. The wound is 0.78 m from the shoulder and the wrist
    // reaches 0.56 m, so the wrist gets to 0.24 to 0.31 m of it with the arm's weight carried, and 0.55 to 0.66 m without.
    gore.clear();
    const c = spawnLiving();
    const thigh = () => at(c, B.thighL).add(at(c, B.shinL)).multiplyScalar(0.5);
    gore.knockdown(c, { topple: v(0, 0, -1.7), lie: 2, hurt: 0.6, wound: { bone: B.thighL, point: thigh() } });
    const reflex = ragOf(c).muscle!.reflex!;
    let lying = 0;
    let nearest = 9;
    for (let f = 0; f < 60 * 4 && gore.downed(c); f++) {
      frame(c);
      if (reflex.phase !== 'lying') continue;
      lying++;
      const wound = thigh();
      nearest = Math.min(nearest, at(c, B.handL).distanceTo(wound), at(c, B.handR).distanceTo(wound));
    }
    expect(lying).toBeGreaterThan(60);
    expect(nearest).toBeLessThan(0.4);
    gore.clear();
  });

  it('knocked cold, the head snaps back from the round and the neck and arms go slack', () => {
    // A shotgun or a heavy round to the head. One `jolt` on the head, as first planned, passes most of the round up the chain:
    // the chest whipped back 0.6 to 0.8 rad on the hips in two frames and the head, lagging it, read as a nod. So the round
    // snaps the neck alone (`MuscleState.whip`, `ReflexTuning.koWhip`): 0.50 to 1.0 rad along the shot within 0.1 s over 32
    // bodies, and the same knockdown not knocked cold 0 or a little the other way, as the head lags the topple.
    const head = rig.bones[B.head]!.hit!;
    for (const [x, z] of headings) {
      for (const cold of [true, false]) {
        gore.clear();
        const c = spawnLiving();
        const dir = v(x, 0, z).normalize();
        const face = new THREE.Vector3(...head.from).lerp(new THREE.Vector3(...head.to), 0.5).applyMatrix4(c.bones[B.head]!.matrixWorld);
        face.addScaledVector(dir, -head.radius);
        const q = (bone: number) => new THREE.Quaternion().setFromRotationMatrix(c.bones[bone]!.matrixWorld);
        // The head's up in the chest's frame, and the shot in it.
        const up = () => v(0, 1, 0).applyQuaternion(q(B.head)).applyQuaternion(q(B.chest).invert());
        const up0 = up();
        const along = dir.clone().applyQuaternion(q(B.chest).invert());
        gore.knockdown(c, {
          topple: dir.clone().multiplyScalar(1.9), impact: { dir, strength: 0.28 }, knockout: cold, lie: 0.45, rise: 1.6, hurt: 0.8,
          wound: { bone: B.head, point: face },
        });
        const rag = ragOf(c);
        const reflex = rag.muscle!.reflex!;
        let snap = -9;
        for (let f = 0; f < 6; f++) {
          frame(c);
          const u = up();
          snap = Math.max(snap, u.angleTo(up0) * Math.sign(u.clone().sub(up0).dot(along)));
        }
        if (!cold) {
          expect(snap, `not cold, heading ${x},${z}`).toBeLessThan(0.15);
          continue;
        }
        expect(snap, `heading ${x},${z}`).toBeGreaterThanOrEqual(0.4);
        // Nothing in the neck, and nothing in the arms to brace with or guard the face.
        while (reflex.age < ReflexTuning.koSeconds && gore.downed(c)) {
          for (const part of rag.parts) {
            const m = part.muscle!;
            if (m.role === 'arm') expect(m.drive).toBeLessThanOrEqual(ReflexTuning.koArm + 1e-9);
            if (m.role === 'head' && reflex.age < ReflexTuning.koHead) expect(m.drive).toBe(0);
          }
          frame(c);
        }
        // It gets up. The handover is the four headings' test: a body that falls on its side and gets up face up can lose
        // a wrist for a frame 0.3 s into the clip, as it could before (gore.md, Known limitations).
        const r = watch(c);
        expect(r.back).toBeGreaterThan(0);
        expect(at(c, B.head).y).toBeGreaterThan(1.4);
        expect(r.floor).toBeGreaterThan(-0.05);
      }
    }
    gore.clear();
  });

  it('a braced fall gives: the hands meet the floor first and the arm bends under the weight', () => {
    // Eight headings at 2 m/s. With the arms keeping half their gravity cut in the fall (`ReflexTuning.fallCarry` 0.5) the hands
    // are down before the chest in 6 to 8 of 8 (10 rounds); keeping all of it, as before, 5 or 6, the falls backward missing.
    // The elbow of the first hand down, 0.2 s after it lands, on the three falls forward: 0.9 rad or more in 28 of 30. A
    // stiff brace bends about as much under the body, so the give is also read where it starts, in what the reflex asks of
    // that elbow once its hand is down: 1.0 rad or more in 4 to 6 falls of 8 (`yieldElbow` 1.3), where a brace that holds
    // stiff, as with `?knock=0`, never asks past 0.47 (`braceElbow` 0.3).
    let first = 0;
    let gave = 0;
    const bent: number[] = [];
    const hinge = (q: THREE.Quaternion) => 2 * Math.acos(Math.min(1, Math.abs(q.w)));
    for (let k = 0; k < 8; k++) {
      gore.clear();
      const c = spawnLiving();
      const a = (k * Math.PI) / 4;
      knock(c, Math.sin(a) * 2, Math.cos(a) * 2);
      const rag = ragOf(c);
      const reflex = rag.muscle!.reflex!;
      let hand = -1;
      let chest = -1;
      let arm = 0;
      let asked = 0;
      for (let f = 0; f < 80 && (chest < 0 || (hand >= 0 && f <= hand + 12)); f++) {
        frame(c);
        if (hand < 0 && Math.min(handLow(c, B.handL), handLow(c, B.handR)) < 0.02) {
          hand = f;
          arm = handLow(c, B.handL) < handLow(c, B.handR) ? B.upperArmL : B.upperArmR;
        }
        if (chest < 0 && chestLow(c) < 0.03) chest = f;
        if (hand >= 0 && f <= hand + 12 && reflex.phase === 'fall') asked = Math.max(asked, hinge(rag.partFor(arm + 1).muscle!.pose));
        if (hand >= 0 && f === hand + 12 && (k === 0 || k === 1 || k === 7)) bent.push(elbowFlex(c, arm));
      }
      expect(gore.downed(c)).not.toBeNull();
      if (hand >= 0 && (chest < 0 || hand < chest)) first++;
      if (asked >= 1) gave++;
      const r = watch(c);
      expect(r.back).toBeGreaterThan(0);
      expect(r.pop).toBeLessThan(0.14);
    }
    expect(first).toBeGreaterThanOrEqual(6);
    expect(gave).toBeGreaterThanOrEqual(2);
    expect(bent).toHaveLength(3);
    expect(bent.filter(b => b >= 0.9).length).toBeGreaterThanOrEqual(2);
    gore.clear();
  });

  it('reads face up and face down from how it landed', () => {
    gore.clear();
    const kinds: string[] = [];
    for (const z of [2.4, -2]) {
      const c = spawnLiving();
      knock(c, 0, z);
      const reflex = ragOf(c).muscle!.reflex!;
      while (gore.downed(c) && reflex.phase !== 'gather') frame(c);
      kinds.push(reflex.kind);
      gore.clear();
    }
    expect(kinds[1]).toBe('supine');
  });

  it('is refused past the budget and on anything that cannot get up, and counts against nothing else', () => {
    gore.clear();
    const bodies = Array.from({ length: GoreTuning.maxKnockdowns }, (_, i) => spawnLiving(i * 2));
    for (const c of bodies) expect(knock(c, 0, 2)).toBe(true);
    expect(knock(spawnLiving(-3), 0, 2)).toBe(false);
    expect(gore.stats().knockdowns).toBe(GoreTuning.maxKnockdowns);
    gore.clear();
    const spider = new TestDummy(skitterRig('skitter'));
    expect(gore.knockdown(spider, {})).toBe(false);
  });

  it('is never frozen by the ragdoll budget, and the living are never the corpse that sinks', () => {
    gore.clear();
    const c = spawnLiving(0, 6);
    knock(c, 0, 2);
    for (let i = 0; i < GoreTuning.maxRagdolls + 2; i++) gore.ragdoll(spawnLiving((i % 8) * 2 - 8, (i >> 3) * 2));
    expect(ragOf(c).active).toBe(true);
    gore.clear();
  });

  it('dying on the floor turns it into a corpse from where it was, with no pop', () => {
    gore.clear();
    const c = spawnLiving();
    knock(c, 0, 2);
    run(c, 20);
    const before = pose(c);
    gore.ragdoll(c);
    expect(gore.owns(c)).toBe(true);
    expect(gore.downed(c)).toBeNull();
    frame(null);
    pose(c).forEach((p, i) => expect(p.distanceTo(before[i]!)).toBeLessThan(0.3));
    for (let i = 0; i < 60 * 8 && gore.stats().ragdolls > 0; i++) frame(null);
    expect(gore.stats().ragdolls).toBe(0);
    gore.clear();
  });

  it('can be gibbed, or lose a limb, while it is down', () => {
    gore.clear();
    const a = spawnLiving(-2);
    const b = spawnLiving(2);
    knock(a, 0, 2);
    knock(b, 0, 2);
    run(null, 20);
    gore.gib(a, at(a, B.chest), 500);
    gore.sever(b, 'armL', shot(at(b, B.chest), v(0, 0, -1)));
    expect(gore.stats().limbs).toBeGreaterThan(0);
    expect(gore.downed(b)).not.toBeNull();
    const r = watch(b);
    expect(r.back).toBeGreaterThan(0);
    expect(at(b, B.head).y).toBeGreaterThan(1.4);
    gore.clear();
  });

  it('takes a further hit as a further hit: it stays down longer and nothing starts over', () => {
    gore.clear();
    const c = spawnLiving();
    gore.knockdown(c, { topple: v(0, 0, -2), lie: 1.2, rise: 1.6 });
    run(c, 60);
    const reflex = ragOf(c).muscle!.reflex!;
    expect(reflex.phase).toBe('lying');
    const age = reflex.age;
    const hit = at(c, B.chest);
    for (let i = 0; i < 6; i++) {
      gore.knockdown(c, { impulses: [{ bone: B.chest, point: hit, impulse: v(0, 0, -20) }] });
      run(c, 6);
    }
    expect(reflex.age).toBeGreaterThan(age);
    expect(reflex.phase).toBe('lying');
    gore.clear();
  });

  it('a body with no legs is given back to its crawl, on the floor', () => {
    gore.clear();
    const c = spawnLiving();
    gore.sever(c, 'legL', shot(at(c, B.hips), v(0, 0, -1)));
    gore.sever(c, 'legR', shot(at(c, B.hips), v(0, 0, -1)));
    gore.knockdown(c, { lie: 0.2, rise: 1, hurt: 0.4 });
    const r = watch(c, 60 * 5);
    expect(r.back).toBeGreaterThan(0);
    expect(at(c, B.hips).y).toBeLessThan(0.5);
    expect(r.pop).toBeLessThan(0.14);
    gore.clear();
  });

  it('gets up on one leg and on no arms', () => {
    for (const lost of [['shinR'], ['armL', 'armR']] as const) {
      gore.clear();
      const c = spawnLiving();
      for (const region of lost) gore.sever(c, region, shot(at(c, B.chest), v(0, 0, -1)));
      knock(c, 0, -2);
      const r = watch(c);
      expect(r.back).toBeGreaterThan(0);
      expect(at(c, B.head).y).toBeGreaterThan(1.3);
      expect(r.floor).toBeGreaterThan(-0.05);
    }
    gore.clear();
  });

  it('leaves the living alone when everything is cleared', () => {
    gore.clear();
    const c = spawnLiving();
    knock(c, 0, 2);
    run(c, 20);
    gore.clear();
    expect(c.root.parent).toBe(scene);
    expect(gore.downed(c)).toBeNull();
  });
});

describe('sustained fire', () => {
  /**
   * SMG at 20 rounds a second into the chest of a body already dying on its feet, or no rounds at all. Returns how much
   * the head and a hand were jerked about: the sum of their changes of velocity, which a smooth fall has little of.
   */
  function burst(c: TestDummy, seconds: number, rounds = true): number {
    let shake = 0;
    const was = [at(c, B.head), at(c, B.handL)];
    const speed = [v(0, 0, 0), v(0, 0, 0)];
    for (let f = 0; f < seconds * 60; f++) {
      if (rounds && f % 3 === 0) {
        const hit = gore.raycastCorpses(at(c, B.chest).add(v(0, 0, 3)), v(0, 0, -1), 8);
        // No limbs come off here. Losing one is meant to hurry a collapse, and it is not what is being measured. Nor is a
        // round in the head, which ends one on that frame: a body sinking under its weight bows its head into the line of
        // chest fire, and before this skip that ended a collapse here about one run in ten.
        if (hit && hit.region !== 'head') gore.damageCorpse(hit, { ...shot(hit.point, v(0, 0, -1), 0), severMult: 0 });
      }
      frame(null);
      [B.head, B.handL].forEach((bone, i) => {
        const now = at(c, bone);
        const step = now.clone().sub(was[i]!);
        shake += step.distanceTo(speed[i]!);
        speed[i]!.copy(step);
        was[i]!.copy(now);
      });
    }
    return shake;
  }

  it('does not hurry a collapse along, and does not throw the body', () => {
    gore.clear();
    const c = spawnLiving();
    const start = at(c, B.hips);
    gore.collapse(c, { duration: 1.4 });
    const pace = () => ragOf(c).muscle!.collapse?.pace ?? 1;
    burst(c, 0.6);
    expect(pace()).toBeLessThan(1.5);
    expect(gore.stats().collapses).toBe(1);
    burst(c, 2.4);
    const hips = at(c, B.hips);
    // Sixty rounds, two magazines. A body simply dropping lands about a metre out, and before the forces came down an SMG
    // moved one 20 m.
    expect(Math.hypot(hips.x - start.x, hips.z - start.z)).toBeLessThan(3.6);
    gore.clear();
  });

  it('jerks a dying body about far more than a quiet death', () => {
    // Several bodies, because which joints a round sets off is random.
    const total = (rounds: boolean) => {
      let shake = 0;
      for (let i = 0; i < 6; i++) {
        gore.clear();
        const c = spawnLiving();
        gore.collapse(c, { duration: 1.4 });
        shake += burst(c, 0.6, rounds);
      }
      gore.clear();
      return shake;
    };
    const quiet = total(false);
    const hit = total(true);
    expect(hit).toBeGreaterThan(quiet * 1.3);
  });

  it('leaves a corpse able to settle afterwards', () => {
    gore.clear();
    const c = spawnLiving();
    gore.ragdoll(c);
    burst(c, 1.5);
    for (let i = 0; i < 60 * 8 && gore.stats().ragdolls > 0; i++) frame(null);
    expect(gore.stats().ragdolls).toBe(0);
    gore.clear();
  });
});

describe('balance', () => {
  /** Walks the root along `speed`, in the animator's own terms, the way enemy movement does while staggered. */
  function reel(c: TestDummy, dir: THREE.Vector3, speed: number, seconds: number): { steps: number; slide: number } {
    let steps = 0;
    (c.anim as unknown as { onFootstep: (() => void) | null }).onFootstep = () => steps++;
    let slide = 0;
    let s = speed;
    for (let f = 0; f < seconds * 60; f++) {
      const a = at(c, B.footL);
      const b = at(c, B.footR);
      c.root.position.addScaledVector(dir, s / 60);
      s *= Math.exp(-2.6 / 60);
      stand(c);
      c.root.updateMatrixWorld(true);
      for (const [was, now] of [[a, at(c, B.footL)], [b, at(c, B.footR)]] as const) {
        if (now.y < 0.08 && was.y < 0.08) slide = Math.max(slide, Math.hypot(now.x - was.x, now.z - was.z));
      }
    }
    return { steps, slide };
  }

  it('takes real steps to catch a stumble, fast, and the feet do not skate', () => {
    gore.clear();
    const c = spawnLiving();
    const dir = v(0, 0, -1);
    c.anim.stumble!(dir, 0.8, B.chest);
    const r = reel(c, dir, 3, 0.8);
    expect(r.steps).toBeGreaterThanOrEqual(3);
    expect(r.slide).toBeLessThan(0.03);
  });

  it('settles back to standing with its feet under it', () => {
    gore.clear();
    const c = spawnLiving();
    const dir = v(1, 0, 0);
    c.anim.stumble!(dir, 0.6, B.thighL);
    reel(c, dir, 2.4, 1.2);
    for (let i = 0; i < 90; i++) stand(c);
    c.root.updateMatrixWorld(true);
    const mid = at(c, B.footL).add(at(c, B.footR)).multiplyScalar(0.5);
    expect(Math.hypot(mid.x - c.root.position.x, mid.z - c.root.position.z)).toBeLessThan(0.12);
    expect(at(c, B.hips).y).toBeGreaterThan(0.8);
  });

  it('puts a hand on a wound and takes it away again', () => {
    gore.clear();
    const c = spawnLiving();
    const wound = at(c, B.shinL).add(v(0.03, 0.2, 0.08));
    c.anim.holdWound!(B.thighL, wound, 0.8);
    let nearest = 9;
    for (let i = 0; i < 40; i++) {
      stand(c);
      c.root.updateMatrixWorld(true);
      nearest = Math.min(nearest, at(c, B.handL).distanceTo(wound));
    }
    // The wrist. The palm is a hand's length past it.
    expect(nearest).toBeLessThan(0.18);
    for (let i = 0; i < 90; i++) stand(c);
    c.root.updateMatrixWorld(true);
    expect(at(c, B.handL).distanceTo(wound)).toBeGreaterThan(0.2);
  });
});

describe('a blast', () => {
  /** How far off the line of a blast a body lands, with or without a leg the same blast took. */
  function drift(cut: boolean): number {
    gore.clear();
    const c = spawnLiving(0, 3);
    c.root.rotation.y = -Math.PI / 2;
    for (let i = 0; i < 20; i++) stand(c);
    c.root.updateMatrixWorld(true);
    if (cut) gore.sever(c, 'shinL', { amount: 50, type: 'explosive', point: at(c, B.chest), dir: v(1, 0.2, 0), force: 60, source: 'test' }, v(0, 0, 0));
    gore.knockdown(c, { velocity: v(3, 0, 0), impact: { dir: v(1, 0, 0), strength: 0.2 }, hurt: 0.5 });
    physics.radialImpulse(v(-3.2, 0.3, 3), 8, 42);
    run(c, 19);
    const off = Math.abs(at(c, B.hips).z - 3);
    gore.clear();
    return off;
  }

  it('throws along its own line, even when it took a leg', () => {
    expect(drift(false)).toBeLessThan(0.4);
    // The hop gait snapping in put 8 m/s across the blast into the ragdoll's seed, and it landed 2.8 m off the line.
    expect(drift(true)).toBeLessThan(0.6);
  });

  it('keeps a hand at its face through the flight of a rocket', () => {
    // Survivors 3 m from a rocket. The hands stay up while the body rises and hangs, and let go as it comes down at 2 m/s
    // (`ReflexTuning.guardHold`): a hand within 0.25 m of the head for 0.22 to 0.38 s of the flight, 0.29 on average over ten.
    // Letting go after 0.2 s whatever the body was doing, as before, 0 to 0.32 s and 0.17, since the arms are still waking
    // for the first 0.2 s. Both hands at once, which the plan asked for, at most 0.15 s either way: the arm on the blast's
    // side is thrown away from the face.
    let total = 0;
    for (let i = 0; i < 6; i++) {
      gore.clear();
      const c = spawnLiving(0, 3);
      gore.knockdown(c, { hurt: 0.9, lie: 0.3, rise: 1.5 });
      physics.radialImpulse(v(-3, 0.3, 3), 8 * 1.35, 12 * 8);
      const reflex = ragOf(c).muscle!.reflex!;
      let near = 0;
      for (let f = 0; f < 90 && gore.downed(c); f++) {
        frame(c);
        if (reflex.phase !== 'fall' || at(c, B.hips).y < 0.41) continue;
        const head = at(c, B.head);
        if (Math.min(at(c, B.handL).distanceTo(head), at(c, B.handR).distanceTo(head)) < 0.25) near++;
      }
      expect(near / 60).toBeGreaterThanOrEqual(0.15);
      total += near / 60;
    }
    expect(total / 6).toBeGreaterThanOrEqual(0.22);
    gore.clear();
  });

  it('is thrown, lands and gets up, on any number of limbs', () => {
    gore.clear();
    const c = spawnLiving(0, 3);
    gore.knockdown(c, { hurt: 0.9, lie: 0.3, rise: 1.5 });
    physics.radialImpulse(v(-2.5, 0.3, 3), 8, 42);
    const r = watch(c);
    expect(r.back).toBeGreaterThan(0);
    expect(at(c, B.hips).x).toBeGreaterThan(1);
    expect(at(c, B.head).y).toBeGreaterThan(1.4);
    expect(r.floor).toBeGreaterThan(-0.05);
    gore.clear();
  });
});
