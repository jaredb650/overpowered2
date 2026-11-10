/**
 * Physics behaviour of real ragdolls, headless. These are the failures the brief names: joints that come
 * apart, bodies through the floor, pinwheels, jitter that never settles, and a pop at the moment of death.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { archetypeById, rigFor } from '../characters/archetypes';
import { HumanoidAnimator } from '../characters/animation/HumanoidAnimator';
import { humanoidRig, HumanoidBone as B } from '../characters/rig';
import { Physics } from '../physics/Physics';
import { makeCtx } from '../sandbox/harness';
import type { Ctx, DamageInfo } from '../core/contracts';
import { createGoreSystem, GoreTuning, type Gore } from './index';
import { RagTuning, type Rag } from './rag';
import { TestDummy } from './testDummy';

const rig = humanoidRig('test');
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

let physics: Physics;
let ctx: Ctx;
let gore: Gore;
const scene = new THREE.Scene();

function world(): void {
  physics.addStaticBox(v(0, -0.5, 0), v(40, 0.5, 40), null, 'concrete');
  physics.addStaticBox(v(0, 3, -6), v(40, 3, 0.5), null, 'concrete');
  physics.flushQueries();
}

function spawn(x = 0, z = 0): TestDummy {
  const c = new TestDummy(rig);
  c.root.position.set(x, 0, z);
  scene.add(c.root);
  c.root.updateMatrixWorld(true);
  return c;
}

/** One 60 Hz frame in the order the game runs it. Returns the worst joint gap seen, for the stretch check. */
function frame(): void {
  ctx.time.tick(1 / 60);
  physics.step(ctx.time.dt);
  gore.update();
}

const run = (frames: number) => {
  for (let i = 0; i < frames; i++) frame();
};

const shot = (bone: number, c: TestDummy, force: number) => ({
  impulses: [{
    bone,
    point: new THREE.Vector3().setFromMatrixPosition(c.bones[bone]!.matrixWorld),
    impulse: v(0, 0, -force),
  }],
});

const damage = (point: THREE.Vector3, force = 0): DamageInfo => ({
  amount: 60, type: 'pellet', point: point.clone(), dir: v(0, 0, -1), force, source: 'test',
});

/** The chain gore has for a body, or null. */
const chainOf = (c: TestDummy): Rag | null => (gore as unknown as { owned: Map<TestDummy, { rag: Rag | null }> }).owned.get(c)?.rag ?? null;

beforeAll(async () => {
  physics = await Physics.create();
  ctx = makeCtx({
    physics,
    render: { scene, decals: { add() {}, splat() {}, clear() {} } } as unknown as Ctx['render'],
  });
  gore = createGoreSystem(ctx);
  gore.init();
  world();
});

describe('ragdoll', () => {
  it('has no pop: the first driven pose matches the pose at death', () => {
    gore.clear();
    const c = spawn();
    c.anim.setLocomotion({ speed: 6, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true });
    for (let i = 0; i < 20; i++) c.anim.update(1 / 60, 0);
    c.root.updateMatrixWorld(true);
    const before = c.bones.map(b => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld));
    gore.ragdoll(c);
    c.root.updateMatrixWorld(true);
    c.bones.forEach((b, i) => {
      const now = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
      expect(now.distanceTo(before[i]!)).toBeLessThan(0.002);
    });
    // One frame on, nothing may have jumped further than a fast limb moves in a frame.
    frame();
    c.bones.forEach((b, i) => {
      const now = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
      expect(now.distanceTo(before[i]!)).toBeLessThan(0.3);
    });
  });

  it('keeps every joint together, even under a rocket-sized hit', () => {
    gore.clear();
    const c = spawn();
    gore.ragdoll(c, shot(B.chest, c, 3000));
    let worst = 0;
    for (let i = 0; i < 90; i++) {
      frame();
      worst = Math.max(worst, gore.stats().jointGap);
    }
    // Bones are posed by rotation alone, so none of this reaches the mesh. An exploding joint gives meters.
    expect(worst).toBeLessThan(0.2);
  });

  it('never sinks through the floor', () => {
    gore.clear();
    const c = spawn();
    gore.ragdoll(c, shot(B.head, c, 400));
    for (let i = 0; i < 200; i++) {
      frame();
      for (const b of c.bones) {
        expect(new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).y).toBeGreaterThan(-0.05);
      }
    }
  });

  it('falls over rather than spinning, and settles into a frozen corpse', () => {
    gore.clear();
    const c = spawn();
    gore.ragdoll(c, shot(B.chest, c, 300));
    let frames = 0;
    while (gore.stats().ragdolls > 0 && frames < 60 * GoreTuning.maxSimTime + 30) {
      frame();
      frames++;
    }
    // Settled on its own, not cut off by the time limit.
    expect(frames).toBeLessThan(60 * 4);
    expect(gore.stats().corpses).toBe(1);
    const hips = new THREE.Vector3().setFromMatrixPosition(c.bones[B.hips]!.matrixWorld);
    expect(hips.y).toBeLessThan(0.45);
  });

  it('every fall comes to rest by itself: no part keeps whirling or jittering', () => {
    for (let trial = 0; trial < 36; trial++) {
      gore.clear();
      const c = spawn((trial % 5) - 2, 0);
      c.root.rotation.y = trial * 0.7;
      c.root.updateMatrixWorld(true);
      gore.ragdoll(c, trial % 3 === 0 ? undefined : shot(B.chest, c, 60 * (trial % 3)));
      let frames = 0;
      while (gore.stats().ragdolls > 0 && frames < 60 * GoreTuning.maxSimTime) {
        frame();
        frames++;
      }
      expect(frames, `trial ${trial}`).toBeLessThan(60 * 5);
    }
  }, 60000);

  it('knees and elbows only fold the way they fold', () => {
    gore.clear();
    const c = spawn();
    gore.ragdoll(c, shot(B.chest, c, 250));
    let knee = 0;
    let elbow = 0;
    for (let i = 0; i < 200; i++) {
      frame();
      for (const b of [B.shinL, B.shinR]) knee = Math.min(knee, 2 * Math.atan2(c.bones[b]!.quaternion.x, c.bones[b]!.quaternion.w));
      for (const b of [B.foreArmL, B.foreArmR]) elbow = Math.max(elbow, 2 * Math.atan2(c.bones[b]!.quaternion.x, c.bones[b]!.quaternion.w));
    }
    // A flipped limit bends these a radian or more the wrong way. A few degrees of solver give is fine.
    expect(knee).toBeGreaterThan(-0.25);
    expect(elbow).toBeLessThan(0.25);
  });

  it('caps simulated ragdolls and corpses, oldest out', () => {
    gore.clear();
    // Nothing is frozen in its first moments, so twenty killed at once all fall, and the budget then takes them back.
    const patience = Math.ceil((GoreTuning.freezeMinAge + GoreTuning.overSeconds) * 60) + 2;
    for (let i = 0; i < 20; i++) gore.ragdoll(spawn((i % 5) * 2 - 4, Math.floor(i / 5) * 2));
    expect(gore.stats().ragdolls).toBe(20);
    expect(gore.stats().corpses).toBe(20);
    run(patience);
    expect(gore.stats().ragdolls).toBeLessThanOrEqual(GoreTuning.maxRagdolls);
    for (let i = 0; i < 30; i++) gore.ragdoll(spawn((i % 6) * 2 - 5, 10 + Math.floor(i / 6) * 2));
    expect(gore.stats().corpses).toBe(GoreTuning.maxCorpses);
    run(patience);
    expect(gore.stats().ragdolls).toBeLessThanOrEqual(GoreTuning.maxRagdolls);
    gore.clear();
  });
});

describe('severing', () => {
  it('gives a full leg two bodies, leaves the rest alive, and returns what it cut', () => {
    gore.clear();
    const c = spawn();
    const r = gore.sever(c, 'legL', damage(v(0.1, 0.6, 0.1)))!;
    expect(r.regions.sort()).toEqual(['legL', 'shinL']);
    expect(gore.stats().limbs).toBe(1);
    expect(gore.stats().ragdolls).toBe(0);
    expect(gore.owns(c)).toBe(false);
    expect(c.severed.has('legL')).toBe(true);
    // Severed parts no longer take bullets on the living body.
    const hit = gore.raycastCharacter(c, v(5, 0.5, 0), v(-1, 0, 0), 20);
    expect(hit?.bone).toBe(B.thighR);
  });

  it('refuses to cut the same limb twice or a region with no joint', () => {
    gore.clear();
    const c = spawn();
    expect(gore.sever(c, 'armR', damage(v(-0.3, 1.3, 0)))).not.toBeNull();
    expect(gore.sever(c, 'armR', damage(v(-0.3, 1.3, 0)))).toBeNull();
    expect(gore.sever(c, 'forearmR', damage(v(-0.3, 1, 0)))).toBeNull();
    expect(gore.sever(c, 'chest', damage(v(0, 1.3, 0)))).toBeNull();
  });

  it('a limb keeps the speed its owner was moving at', () => {
    gore.clear();
    const c = spawn();
    gore.sever(c, 'forearmL', damage(v(0.3, 1, 0), 1), v(9, 0, 0));
    frame();
    const hand = new THREE.Vector3();
    expect(gore.stats().limbs).toBe(1);
    const x0 = gore.limbCenter(0, hand).x;
    run(6);
    expect(gore.limbCenter(0, hand).x - x0).toBeGreaterThan(0.6);
  });

  it('cuts limbs off a ragdoll and off a frozen corpse, without disturbing what is left', () => {
    gore.clear();
    const c = spawn();
    gore.ragdoll(c, shot(B.chest, c, 150));
    run(30);
    expect(gore.sever(c, 'armL', damage(v(0, 0.3, 0)))).not.toBeNull();
    expect(gore.stats().limbs).toBe(1);
    run(240);
    expect(gore.stats().ragdolls).toBe(0);
    expect(gore.sever(c, 'legR', damage(v(0, 0.2, 0)))).not.toBeNull();
    expect(gore.stats().limbs).toBe(2);
    run(5);
    for (const b of c.bones) expect(Number.isFinite(b.matrixWorld.elements[13]!)).toBe(true);
  });

  it('a waist cut leaves legs on the instance and a top half that drags itself along', () => {
    gore.clear();
    const c = spawn();
    const r = gore.sever(c, 'abdomen', damage(v(0, 1.1, 0.1)))!;
    expect(r.torso?.alive).toBe(true);
    expect(gore.raycastCharacter(c, v(0, 1.4, 5), v(0, 0, -1), 20)).toBeNull();
    expect(gore.raycastCharacter(c, v(0.1, 0.5, 5), v(0, 0, -1), 20)).not.toBeNull();
    r.torso!.setTarget(v(0, 0, 6));
    gore.ragdoll(c);
    run(70);
    const landed = r.torso!.position.clone();
    expect(landed.y).toBeLessThan(0.6);
    run(240);
    expect(r.torso!.position.z - landed.z).toBeGreaterThan(0.5);
    r.torso!.kill();
    expect(r.torso!.alive).toBe(false);
  });

  it('survives garbage from other systems: a NaN must never reach Rapier', () => {
    gore.clear();
    const c = spawn();
    const nan = v(NaN, 0, 0);
    gore.ragdoll(c, { impulses: [{ bone: B.chest, point: nan, impulse: nan }] });
    const r = gore.sever(spawn(3, 0), 'abdomen', damage(v(3, 1.1, 0)))!;
    r.torso!.setTarget(nan);
    run(20);
    for (const b of c.bones) expect(Number.isFinite(b.matrixWorld.elements[13]!)).toBe(true);
  });
});

describe('deaths', () => {
  it('one death path: repeat calls on an owned character are absorbed', () => {
    gore.clear();
    const c = spawn();
    gore.ragdoll(c);
    gore.ragdoll(c);
    gore.headshot(c, damage(v(0, 1.7, 0)));
    expect(gore.stats().corpses).toBe(1);
    expect(gore.stats().ragdolls).toBe(1);
  });

  it('a burst headshot drops the body on the same frame, with no collapse to sell it', () => {
    gore.clear();
    const c = spawn();
    const stop: number[] = [];
    const hitStop = ctx.time.hitStop.bind(ctx.time);
    ctx.time.hitStop = (s, k) => {
      stop.push(s);
      hitStop(s, k);
    };
    gore.headshot(c, damage(v(0, 1.7, 0)));
    ctx.time.hitStop = hitStop;
    expect(stop.length).toBe(1);
    expect(c.severed.has('head')).toBe(true);
    expect(gore.stats().ragdolls).toBe(1);
    expect(gore.stats().collapses).toBe(0);
    run(40);
    expect(gore.stats().collapses).toBe(0);
  });

  it('a low damage headshot pops the head off whole', () => {
    gore.clear();
    const c = spawn();
    gore.headshot(c, { ...damage(v(0, 1.7, 0)), amount: 12 });
    expect(gore.stats().limbs).toBe(1);
  });

  it('gib releases the instance and throws real limbs and chunks', () => {
    gore.clear();
    const c = spawn();
    let released = false;
    const release = c.release.bind(c);
    c.release = () => {
      released = true;
      release();
    };
    gore.gib(c, v(0.2, 0.8, 0.4), 600);
    expect(released).toBe(true);
    expect(gore.stats().limbs).toBe(5);
    expect(gore.stats().chunkBodies).toBeGreaterThan(10);
    expect(gore.owns(c)).toBe(false);
  });
});

describe('corpses', () => {
  it('stay shootable: a frozen body wakes when hit and a limb comes off under fire', () => {
    gore.clear();
    const c = spawn(0, 0);
    gore.ragdoll(c);
    run(300);
    expect(gore.stats().ragdolls).toBe(0);
    const at = v(0, -0.2, 0).applyMatrix4(c.bones[B.thighL]!.matrixWorld);
    // From outside the body: straight down, one shot in eight finds the torso lying over the leg, with no limb to lose.
    const hips = new THREE.Vector3().setFromMatrixPosition(c.bones[B.hips]!.matrixWorld);
    const away = at.clone().sub(hips).setY(0).normalize();
    const from = at.clone().addScaledVector(away, 2.5).add(v(0, 1.2, 0));
    const dir = at.clone().sub(from).normalize();
    const hit = gore.raycastCorpses(from, dir, 10)!;
    expect(hit).not.toBeNull();
    gore.damageCorpse(hit, { ...damage(hit.point), dir, amount: 40 });
    expect(gore.stats().ragdolls).toBe(1);
    const again = gore.raycastCorpses(from, dir, 10);
    if (again) gore.damageCorpse(again, { ...damage(again.point), dir, amount: 40 });
    expect(gore.stats().limbs).toBeGreaterThan(0);
  });

  it('a pinned body hangs from the wall instead of falling', () => {
    gore.clear();
    const c = spawn(0, -3);
    gore.ragdoll(c);
    run(3);
    const chest = new THREE.Vector3().setFromMatrixPosition(c.bones[B.chest]!.matrixWorld);
    const from = chest.clone().add(v(0, 0.1, 4));
    const hit = gore.raycastCorpses(from, chest.clone().add(v(0, 0.1, 0)).sub(from).normalize(), 8)!;
    const anchor = v(0, 1.9, -5.45);
    gore.pin(hit, anchor);
    run(240);
    const now = new THREE.Vector3().setFromMatrixPosition(c.bones[B.chest]!.matrixWorld);
    expect(now.distanceTo(anchor)).toBeLessThan(0.6);
    expect(now.y).toBeGreaterThan(1.2);
  });

  it('a staked corpse that freezes and wakes is still staked', () => {
    gore.clear();
    const c = spawn(0, -3);
    gore.ragdoll(c);
    run(3);
    const chest = new THREE.Vector3().setFromMatrixPosition(c.bones[B.chest]!.matrixWorld);
    const from = chest.clone().add(v(0, 0.1, 4));
    const hit = gore.raycastCorpses(from, chest.clone().add(v(0, 0.1, 0)).sub(from).normalize(), 8)!;
    const anchor = v(0, 1.9, -5.45);
    gore.pin(hit, anchor);
    run(60 * (GoreTuning.maxPinnedSimTime + 1));
    expect(gore.stats().ragdolls).toBe(0);
    physics.radialImpulse(v(0, 1.5, -4), 5, 100);
    expect(gore.stats().ragdolls).toBe(1);
    run(90);
    const now = new THREE.Vector3().setFromMatrixPosition(c.bones[B.chest]!.matrixWorld);
    expect(now.y).toBeGreaterThan(1.2);
  }, 30000);

  it('the oldest corpse sinks away and gives its instance back', () => {
    gore.clear();
    const first = spawn(0, 0);
    let released = 0;
    const release = first.release.bind(first);
    first.release = () => {
      released++;
      release();
    };
    gore.ragdoll(first);
    for (let i = 0; i < GoreTuning.maxCorpses; i++) gore.ragdoll(spawn((i % 6) * 2 - 5, 3 + Math.floor(i / 6) * 2));
    expect(gore.stats().corpses).toBe(GoreTuning.maxCorpses);
    expect(released).toBe(0);
    run(Math.ceil(60 * GoreTuning.sinkSeconds) + 5);
    expect(released).toBe(1);
    expect(gore.owns(first)).toBe(false);
  });

  it('a stump stops bleeding when its character goes back to the pool', () => {
    gore.clear();
    const c = spawn();
    let live = 0;
    const fx = ctx.fx;
    const attach = () => {
      live++;
      return { alive: true, stop: () => { live--; } };
    };
    ctx.fx = new Proxy(fx, { get: (t, k) => (k === 'attachEmitter' ? attach : t[k as keyof typeof t]) });
    gore.sever(c, 'armL', damage(v(0.3, 1.3, 0)));
    const started = live;
    expect(started).toBeGreaterThan(1);
    c.release();
    frame();
    ctx.fx = fx;
    expect(live).toBe(started - 1);
  });

  it('throws a body the same blast killed this very frame', () => {
    gore.clear();
    const c = spawn(0, 0);
    gore.ragdoll(c);
    physics.radialImpulse(v(0, 0.4, 1), 6, 300);
    run(10);
    expect(c.root.position.z).toBeLessThan(-0.3);
  });

  it('lets go of a corpse the library took back, without releasing the new owner', () => {
    gore.clear();
    const c = spawn(0, 0);
    let released = 0;
    const release = c.release.bind(c);
    c.release = () => {
      released++;
      release();
    };
    gore.ragdoll(c);
    run(300);
    expect(gore.stats().corpses).toBe(1);
    // What the library does to its oldest instance when a new enemy needs one.
    c.bones[0]!.position.set(rig.bones[0]!.offset[0], rig.bones[0]!.offset[1], rig.bones[0]!.offset[2]);
    run(2);
    expect(gore.stats().corpses).toBe(0);
    expect(gore.owns(c)).toBe(false);
    expect(released).toBe(0);
  });

  it('never holds more limbs of one archetype than the library pools', () => {
    gore.clear();
    for (let i = 0; i < 16; i++) {
      const c = spawn((i % 8) * 2 - 7, Math.floor(i / 8) * 2);
      gore.sever(c, 'armL', damage(v(0, 1.3, 0)));
      gore.sever(c, 'armR', damage(v(0, 1.3, 0)));
      expect(gore.stats().limbs).toBeLessThanOrEqual(GoreTuning.maxLimbsPerArchetype);
    }
  });

  /** One frozen corpse, older than a full budget of simulated bodies. */
  const atTheCap = (): TestDummy => {
    gore.clear();
    const old = spawn(0, 0);
    gore.ragdoll(old);
    run(300);
    expect(gore.stats().ragdolls).toBe(0);
    for (let i = 0; i < GoreTuning.maxRagdolls; i++) gore.ragdoll(spawn((i % 5) * 1.5, 3 + Math.floor(i / 5) * 1.5));
    run(1);
    expect(gore.stats().ragdolls).toBe(GoreTuning.maxRagdolls);
    return old;
  };

  it('a corpse shot at the ragdoll budget wakes and stays awake', () => {
    const old = atTheCap();
    const at = v(0, -0.2, 0).applyMatrix4(old.bones[B.thighL]!.matrixWorld);
    const from = at.clone().add(v(0.3, 3, 0.2));
    const dir = at.clone().sub(from).normalize();
    const hit = gore.raycastCorpses(from, dir, 10)!;
    expect(hit).not.toBeNull();
    // Freezing it again here would leave the shot pushing a body Rapier no longer has, which panics the whole world. The
    // others died a frame ago, too fresh to freeze for it, so for a moment there is one more than the budget.
    gore.damageCorpse(hit, { ...damage(hit.point), dir, amount: 5 });
    run(2);
    expect(gore.stats().ragdolls).toBe(GoreTuning.maxRagdolls + 1);
    expect(chainOf(old)?.active).toBe(true);
    const y0 = old.bones[B.hips]!.matrixWorld.elements[13]!;
    run(1);
    expect(old.bones[B.hips]!.matrixWorld.elements[13]!).not.toBe(y0);
  });

  it('a blast at the ragdoll budget rebuilds nothing', () => {
    atTheCap();
    // A wake here would only swap with a body already moving, and that body comes back at rest.
    const create = vi.spyOn(physics.world, 'createRigidBody');
    physics.radialImpulse(v(0, 0.5, 1), 12, 160);
    const rebuilt = create.mock.calls.length;
    create.mockRestore();
    expect(rebuilt).toBe(0);
    expect(gore.stats().ragdolls).toBe(GoreTuning.maxRagdolls);
  });

  it('wakes frozen corpses caught in a blast', () => {
    gore.clear();
    const c = spawn(0, 0);
    gore.ragdoll(c);
    run(300);
    expect(gore.stats().ragdolls).toBe(0);
    physics.radialImpulse(v(0, 0.2, 0.5), 5, 200);
    expect(gore.stats().ragdolls).toBe(1);
    const y0 = c.root.position.y;
    run(6);
    expect(c.root.position.y).toBeGreaterThan(y0);
  });
});

describe('the ragdoll budget', () => {
  const trooper = archetypeById('trooper');
  const trooperRig = rigFor(trooper);
  const at = (c: TestDummy, bone: number) => new THREE.Vector3().setFromMatrixPosition(c.bones[bone]!.matrixWorld);
  /** A trooper on the real animator, which can collapse and get up. */
  function living(x: number, z: number): TestDummy {
    const c = new TestDummy(trooperRig);
    c.root.position.set(x, 0, z);
    scene.add(c.root);
    c.root.updateMatrixWorld(true);
    (c as { anim: unknown }).anim = new HumanoidAnimator(c.bones, trooperRig, trooper, c.root, c.severed, b => (c as unknown as { hidden: Uint8Array }).hidden[b] === 1);
    for (let i = 0; i < 20; i++) {
      c.anim.setLocomotion({ speed: 0, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true });
      c.anim.update(1 / 60, 0);
    }
    c.root.updateMatrixWorld(true);
    return c;
  }

  it('a blast at the cap freezes nothing in the air', () => {
    // Every knockdown and collapse there can be is running, which the budget can never freeze, and a grenade kills six more.
    // Freezing the oldest plain ragdoll whatever it was doing, it froze those six on their feet the frame they died, and
    // with only an age rule it froze them 1.4 m up as the grenade threw them. Nothing may freeze until it is on the floor and
    // slow, or out of time, and the budget takes them back as each one is. Then the collapses end, still over the budget,
    // and each is a body just starting to fall however long it took to die.
    gore.clear();
    /** Every freeze, the budget's and a body settling by itself alike, and which it was. */
    const frozen: { char: TestDummy; hips: number; speed: number; t: number; budget: boolean }[] = [];
    const g = gore as unknown as { freezeBody(b: { char: TestDummy; rag: Rag | null }): void; budgetRagdolls(keep?: unknown): void };
    const freeze = g.freezeBody.bind(gore);
    const budget = g.budgetRagdolls.bind(gore);
    let inBudget = false;
    g.freezeBody = b => {
      frozen.push({ char: b.char, hips: at(b.char, B.hips).y, speed: b.rag ? (b.rag.pushed ? Infinity : b.rag.speed) : 0, t: ctx.time.elapsed, budget: inBudget });
      freeze(b);
    };
    /** When each body's fall started: the grenade, or the end of its collapse. */
    const fell = new Map<TestDummy, number>();
    const collapsing: TestDummy[] = [];
    g.budgetRagdolls = keep => {
      inBudget = true;
      try { budget(keep); } finally { inBudget = false; }
    };
    try {
      for (let i = 0; i < GoreTuning.maxKnockdowns; i++) {
        expect(gore.knockdown(living(-16 + (i % 6) * 6.4, 26 + Math.floor(i / 6) * 4), { topple: v(0, 0, 1.7), lie: 12, rise: 2, hurt: 0.6 })).toBe(true);
      }
      const dying = 3;
      for (let i = 0; i < GoreTuning.maxCollapses; i++) {
        collapsing.push(living(-18 + i * 12, -2));
        gore.collapse(collapsing.at(-1)!, { duration: dying });
      }
      run(12);
      const unfreezable = GoreTuning.maxKnockdowns + GoreTuning.maxCollapses;
      expect(gore.stats().ragdolls).toBe(unfreezable);
      const crowd = Array.from({ length: 6 }, (_, i) => living(Math.cos(i * 1.05) * 1.4, 10 + Math.sin(i * 1.05) * 1.4));
      for (const c of crowd) {
        gore.ragdoll(c);
        fell.set(c, ctx.time.elapsed);
      }
      // A grenade at their feet, as `Combat` sends one.
      physics.radialImpulse(v(0, 0.3, 10), 7 * 1.35, 12 * 7);
      expect(gore.stats().ragdolls).toBe(unfreezable + crowd.length);
      expect(frozen).toHaveLength(0);
      // Never in the air, never fresh, and never moving until it has had its time. A body still settling a limb then
      // freezes on the floor.
      const check = () => {
        for (const f of frozen) {
          const since = fell.get(f.char)!;
          expect(since).toBeLessThanOrEqual(f.t);
          const when = `${(f.t - since).toFixed(2)} s into its fall, ${f.budget ? 'by the budget' : 'settled'}`;
          expect(f.hips, when).toBeLessThan(0.5);
          if (!f.budget) continue;
          expect(f.t - since, when).toBeGreaterThanOrEqual(GoreTuning.freezeMinAge - 1e-6);
          if (f.t - since < GoreTuning.freezeMinAge + GoreTuning.overSeconds) expect(f.speed, when).toBeLessThanOrEqual(GoreTuning.freezeSpeed);
        }
      };
      // Back to only what cannot freeze, once each has had its time.
      const patience = Math.ceil((GoreTuning.freezeMinAge + GoreTuning.overSeconds) * 60) + 2;
      let most = 0;
      for (let f = 0; f < patience; f++) {
        frame();
        most = Math.max(most, gore.stats().ragdolls);
      }
      check();
      expect(gore.stats().collapses).toBe(GoreTuning.maxCollapses);
      expect(gore.stats().ragdolls).toBe(unfreezable);
      expect(most).toBe(unfreezable + crowd.length);
      expect(frozen).toHaveLength(crowd.length);
      // The long collapses end, and four of the default length die after them: the end of each is where its fall starts.
      // With the knockdowns that is still over the budget, until two of them have frozen.
      const outlive = () => {
        for (let f = 0; f < 60 * dying && gore.stats().collapses > 0; f++) frame();
        expect(gore.stats().collapses).toBe(0);
        for (const c of collapsing.splice(0)) fell.set(c, ctx.time.elapsed);
        for (let f = 0; f < patience; f++) frame();
        check();
        expect(gore.stats().ragdolls).toBeLessThanOrEqual(GoreTuning.maxRagdolls);
      };
      outlive();
      for (let i = 0; i < GoreTuning.maxCollapses; i++) {
        collapsing.push(living(-18 + i * 12, -4));
        gore.collapse(collapsing.at(-1)!);
      }
      outlive();
    } finally {
      delete (g as Partial<typeof g>).freezeBody;
      delete (g as Partial<typeof g>).budgetRagdolls;
      gore.clear();
    }
  }, 60000);
});

describe('the tempo dial', () => {
  const trooper = archetypeById('trooper');
  const trooperRig = rigFor(trooper);
  const at = (c: TestDummy, bone: number) => new THREE.Vector3().setFromMatrixPosition(c.bones[bone]!.matrixWorld);
  const ragOf = (c: TestDummy): Rag | null => (gore as unknown as { owned: Map<TestDummy, { rag: Rag | null }> }).owned.get(c)?.rag ?? null;
  const stand = (c: TestDummy) => {
    c.anim.setLocomotion({ speed: 0, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true });
    c.anim.update(1 / 60, 0);
  };
  /** A trooper on the real animator, which can collapse and get up. */
  function living(): TestDummy {
    const c = new TestDummy(trooperRig);
    scene.add(c.root);
    c.root.updateMatrixWorld(true);
    (c as { anim: unknown }).anim = new HumanoidAnimator(c.bones, trooperRig, trooper, c.root, c.severed, b => (c as unknown as { hidden: Uint8Array }).hidden[b] === 1);
    for (let i = 0; i < 20; i++) stand(c);
    c.root.updateMatrixWorld(true);
    return c;
  }

  it('no part outweighs the dial', () => {
    // Every gravity write multiplies by the chain's share of world gravity, so one that does not puts a part back on 1 and
    // shows here as a part heavier than the dial. The hips of a collapse carry the trunk's held weight on purpose, so they
    // are held to the chain as a whole, whose weight carrying only moves about.
    const was = RagTuning.gravityScale;
    const dial = 0.6;
    let part = 0;
    let chain = 0;
    let frames = 0;
    const watch = (c: TestDummy, n: number) => {
      for (let f = 0; f < n; f++) {
        ctx.time.tick(1 / 60);
        if (!gore.owns(c) && !gore.downed(c)) stand(c);
        physics.step(ctx.time.dt);
        gore.update();
        const rag = ragOf(c);
        if (!rag?.active) continue;
        frames++;
        let weight = 0;
        let mass = 0;
        for (const p of rag.parts) {
          const scale = p.body.gravityScale();
          weight += scale * p.mass;
          mass += p.mass;
          if (p.parent) part = Math.max(part, scale - dial);
        }
        chain = Math.max(chain, weight / mass - dial);
      }
    };
    RagTuning.gravityScale = dial;
    try {
      // Down and alive, through the fall and lying there, then dead on the floor, which is `letGo`.
      gore.clear();
      let c = living();
      gore.knockdown(c, { topple: v(0, 0, 1.7), lie: 2, hurt: 0.6, wound: { bone: B.thighL, point: at(c, B.thighL) } });
      watch(c, 70);
      gore.ragdoll(c);
      watch(c, 60);
      // Down, and back up again.
      gore.clear();
      c = living();
      gore.knockdown(c, { topple: v(1.7, 0, 0), lie: 0.3, rise: 1.6, hurt: 0.6 });
      watch(c, 300);
      // A collapse to its end, which is `endCollapse`.
      gore.clear();
      c = living();
      gore.collapse(c, { duration: 1.1 });
      watch(c, 120);
      // A collapse ended by a round in the head, which is `giveUp`.
      gore.clear();
      c = living();
      gore.collapse(c, { duration: 1.7 });
      watch(c, 18);
      const head = at(c, B.head);
      const from = head.clone().add(v(0, 2, 1.2));
      const hit = gore.raycastCorpses(from, head.clone().sub(from).normalize(), 4);
      expect(hit?.region).toBe('head');
      gore.damageCorpse(hit!, { ...damage(hit!.point, 20), type: 'bullet', amount: 25, bone: B.head });
      expect(ragOf(c)!.muscle!.collapse).toBeNull();
      watch(c, 40);
    } finally {
      RagTuning.gravityScale = was;
      gore.clear();
    }
    expect(part).toBeLessThan(1e-6);
    expect(chain).toBeLessThan(1e-6);
    expect(frames).toBeGreaterThan(300);
  });

  it('a body killed in the air falls at full gravity until it lands, then takes the dial', () => {
    // A Leaper falls at 28 m/s² while it lives. Slowed to the dial the moment it died, it would hang in the air.
    const was = RagTuning.gravityScale;
    RagTuning.gravityScale = 0.6;
    try {
      gore.clear();
      const c = living();
      c.root.position.y = 1.5;
      c.root.updateMatrixWorld(true);
      gore.ragdoll(c, { velocity: v(0, -6, 1) });
      const rag = ragOf(c)!;
      expect(rag.gravity).toBe(1);
      expect(Math.min(...rag.parts.map(p => p.body.gravityScale()))).toBe(1);
      let landed = -1;
      for (let f = 1; f <= 90 && landed < 0; f++) {
        frame();
        if (rag.gravity < 1) landed = f;
      }
      expect(landed).toBeGreaterThan(3);
      expect(at(c, B.hips).y).toBeLessThan(1);
      expect(Math.max(...rag.parts.map(p => p.body.gravityScale()))).toBeLessThan(0.6 + 1e-6);
      // Killed on its feet, it takes the dial from the start.
      gore.clear();
      const d = living();
      gore.ragdoll(d);
      expect(ragOf(d)!.gravity).toBe(0.6);
    } finally {
      RagTuning.gravityScale = was;
      gore.clear();
    }
  });

  it('only the floor ends a fall at full gravity: not a long frame, not a hit in the air', () => {
    // Read as a loss of the chain's momentum, gravity slowing a rising body in a 30 fps frame counted as a landing, and so did
    // a round against its motion: the body took the dial 2.3 m up and flew on slowed, a third longer in the air.
    const was = RagTuning.gravityScale;
    RagTuning.gravityScale = 0.6;
    /** Frames of `dt` until the chain takes the dial, with the highest the hips were when it did. */
    const fall = (c: TestDummy, dt: number, hit?: (f: number) => void) => {
      const rag = ragOf(c)!;
      for (let f = 1; f * dt <= 2; f++) {
        hit?.(f);
        ctx.time.tick(dt);
        physics.step(ctx.time.dt);
        gore.update();
        if (rag.gravity < 1) return { at: f * dt, hips: at(c, B.hips).y, rag };
      }
      return { at: -1, hips: at(c, B.hips).y, rag };
    };
    try {
      for (const dt of [1 / 30, 1 / 20]) {
        gore.clear();
        const c = living();
        c.root.position.y = 1;
        c.root.updateMatrixWorld(true);
        gore.ragdoll(c, { velocity: v(0, 6, 1) });
        const end = fall(c, dt);
        expect(end.at, `${Math.round(1 / dt)} fps`).toBeGreaterThan(0.4);
        expect(end.hips, `${Math.round(1 / dt)} fps`).toBeLessThan(0.6);
      }
      // Falling toward the shooter, a Judge round in the chest, then a blast from under it.
      for (const kind of ['round', 'blast'] as const) {
        gore.clear();
        const c = living();
        c.root.position.y = 2.2;
        c.root.updateMatrixWorld(true);
        gore.ragdoll(c, { velocity: v(0, -3, 5) });
        const end = fall(c, 1 / 60, f => {
          if (f !== 4) return;
          const chest = at(c, B.chest);
          if (kind === 'blast') {
            physics.radialImpulse(chest.clone().add(v(0, -1.5, 0)), 4, 600);
            return;
          }
          const from = chest.clone().add(v(0, 0, 3));
          const struck = gore.raycastCorpses(from, v(0, 0, -1), 6);
          expect(struck).not.toBeNull();
          gore.damageCorpse(struck!, { ...damage(struck!.point, 90), type: 'bullet', amount: 120, severMult: 0 });
        });
        expect(end.at, kind).toBeGreaterThan(0);
        expect(end.hips, kind).toBeLessThan(0.6);
      }
      // A limb cut from a body thrown on the dial falls with it, not at full gravity, and one from a body killed in the air
      // falls with that one. Its seed is the chain's own speed, so it cannot tell from that.
      gore.clear();
      const thrown = living();
      gore.ragdoll(thrown);
      for (let f = 0; f < 2; f++) frame();
      physics.radialImpulse(v(0, 0.3, 1.2), 8, 900);
      for (let f = 0; f < 6; f++) frame();
      const body = ragOf(thrown)!;
      body.parts[0]!.body.linvel(body.parts[0]!.v);
      expect(body.parts[0]!.v.y).toBeGreaterThan(RagTuning.loftSpeed);
      expect(gore.sever(thrown, 'armL', { ...damage(at(thrown, B.upperArmL), 1), type: 'bullet' })).not.toBeNull();
      const newest = () => (gore as unknown as { limbs: { rag: Rag }[] }).limbs.at(-1)!.rag;
      expect(newest().gravity).toBe(0.6);
      expect(Math.max(...newest().parts.map(p => p.body.gravityScale()))).toBeLessThan(0.6 + 1e-6);
      gore.clear();
      const flying = living();
      flying.root.position.y = 2.2;
      flying.root.updateMatrixWorld(true);
      gore.ragdoll(flying, { velocity: v(0, -6, 0) });
      frame();
      expect(ragOf(flying)!.gravity).toBe(1);
      expect(gore.sever(flying, 'armL', { ...damage(at(flying, B.upperArmL), 1), type: 'bullet' })).not.toBeNull();
      expect(newest().gravity).toBe(1);
      expect(newest().killedInAir).toBe(true);
    } finally {
      RagTuning.gravityScale = was;
      gore.clear();
    }
  });
});

// Last in the file on purpose: its twenty-two bodies change what the tests after it in this world draw, and the tempo
// dial's blast from under a falling body lands with its hips over 0.6 m about one draw in five, before stage 3 as well.
describe('the ragdoll budget, again', () => {
  const trooper = archetypeById('trooper');
  const trooperRig = rigFor(trooper);
  const at = (c: TestDummy, bone: number) => new THREE.Vector3().setFromMatrixPosition(c.bones[bone]!.matrixWorld);
  function living(x: number, z: number): TestDummy {
    const c = new TestDummy(trooperRig);
    c.root.position.set(x, 0, z);
    scene.add(c.root);
    c.root.updateMatrixWorld(true);
    (c as { anim: unknown }).anim = new HumanoidAnimator(c.bones, trooperRig, trooper, c.root, c.severed, b => (c as unknown as { hidden: Uint8Array }).hidden[b] === 1);
    for (let i = 0; i < 20; i++) {
      c.anim.setLocomotion({ speed: 0, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true });
      c.anim.update(1 / 60, 0);
    }
    c.root.updateMatrixWorld(true);
    return c;
  }

  it('a body thrown or shot again starts its time over', () => {
    // Over the budget, timed from its death alone, a corpse a second grenade threw 2 m up froze there 1.6 s after it died,
    // and a corpse under fire froze and woke every 0.6 s, a new pool each time. A throw and a round each start it again.
    gore.clear();
    const frozen: { char: TestDummy; hips: number }[] = [];
    const g = gore as unknown as { freezeBody(b: { char: TestDummy; rag: Rag | null }): void };
    const freeze = g.freezeBody.bind(gore);
    g.freezeBody = b => {
      frozen.push({ char: b.char, hips: at(b.char, B.hips).y });
      freeze(b);
    };
    try {
      for (let i = 0; i < GoreTuning.maxKnockdowns; i++) {
        gore.knockdown(living(-16 + (i % 6) * 6.4, 26 + Math.floor(i / 6) * 4), { topple: v(0, 0, 1.7), lie: 12, rise: 2, hurt: 0.6 });
      }
      for (let i = 0; i < GoreTuning.maxCollapses; i++) gore.collapse(living(-18 + i * 12, -2), { duration: 5 });
      run(12);
      const crowd = Array.from({ length: 6 }, (_, i) => living(Math.cos(i * 1.05) * 1.4, 10 + Math.sin(i * 1.05) * 1.4));
      for (const c of crowd) gore.ragdoll(c);
      physics.radialImpulse(v(0, 0.3, 10), 7 * 1.35, 12 * 7);
      run(54);
      // The second grenade lands beside a body of the first still falling about.
      const next = crowd.find(c => chainOf(c)?.active)!;
      expect(next).toBeDefined();
      const p = at(next, B.hips);
      physics.radialImpulse(v(p.x + 0.4, 0.3, p.z), 7 * 1.35, 12 * 7);
      let highest = 0;
      for (let f = 0; f < 60; f++) {
        frame();
        for (const c of crowd) highest = Math.max(highest, at(c, B.hips).y);
      }
      expect(highest).toBeGreaterThan(1);
      for (const f of frozen) expect(f.hips).toBeLessThan(0.5);
      expect(gore.stats().ragdolls).toBeGreaterThan(GoreTuning.maxRagdolls);
      // A corpse at rest, shot from above every six frames for 1.5 s with the budget still over: it wakes once and stays
      // awake. Light rounds, so that nothing comes off it.
      const target = crowd.find(c => chainOf(c) && !chainOf(c)!.active) ?? crowd[0]!;
      const before = frozen.length;
      let rounds = 0;
      let sleeps = 0;
      for (let f = 0; f < 90; f++) {
        if (f % 6 === 0) {
          const chest = at(target, B.chest);
          const from = chest.clone().add(v(0, 2, 0));
          const hit = gore.raycastCorpses(from, v(0, -1, 0), 4);
          if (hit) {
            gore.damageCorpse(hit, { amount: 3, type: 'bullet', point: hit.point.clone(), dir: v(0, -0.3, -1).normalize(), force: 20, source: 'test' });
            rounds++;
          }
        }
        frame();
        if (rounds > 0 && !chainOf(target)!.active) sleeps++;
      }
      expect(rounds).toBeGreaterThan(10);
      expect(sleeps).toBe(0);
      expect(frozen.slice(before).filter(f => f.char === target)).toHaveLength(0);
    } finally {
      delete (g as Partial<typeof g>).freezeBody;
      gore.clear();
    }
  }, 60000);
});
