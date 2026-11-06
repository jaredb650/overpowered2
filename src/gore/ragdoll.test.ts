/**
 * Physics behaviour of real ragdolls, headless. These are the failures the brief names: joints that come
 * apart, bodies through the floor, pinwheels, jitter that never settles, and a pop at the moment of death.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { humanoidRig, HumanoidBone as B } from '../characters/rig';
import { Physics } from '../physics/Physics';
import { makeCtx } from '../sandbox/harness';
import type { Ctx, DamageInfo } from '../core/contracts';
import { createGoreSystem, GoreTuning, type Gore } from './index';
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

beforeAll(async () => {
  physics = await Physics.create();
  ctx = makeCtx({
    physics,
    render: { scene, decals: { add() {}, clear() {} } } as unknown as Ctx['render'],
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
    for (let i = 0; i < 20; i++) gore.ragdoll(spawn((i % 5) * 2 - 4, Math.floor(i / 5) * 2));
    expect(gore.stats().ragdolls).toBe(GoreTuning.maxRagdolls);
    expect(gore.stats().corpses).toBe(20);
    for (let i = 0; i < 30; i++) gore.ragdoll(spawn((i % 6) * 2 - 5, 10 + Math.floor(i / 6) * 2));
    expect(gore.stats().ragdolls).toBeLessThanOrEqual(GoreTuning.maxRagdolls);
    expect(gore.stats().corpses).toBe(GoreTuning.maxCorpses);
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

  it('a burst headshot holds the body up for a beat, then drops it by itself', () => {
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
    expect(gore.stats().ragdolls).toBe(0);
    run(4);
    expect(gore.stats().ragdolls).toBe(0);
    run(40);
    expect(gore.stats().ragdolls).toBe(1);
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
    const from = at.clone().add(v(0.3, 3, 0.2));
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
    // Freezing it again here would leave the shot pushing a body Rapier no longer has, which panics the whole world.
    gore.damageCorpse(hit, { ...damage(hit.point), dir, amount: 5 });
    run(2);
    expect(gore.stats().ragdolls).toBe(GoreTuning.maxRagdolls);
    const y0 = old.bones[B.hips]!.matrixWorld.elements[13]!;
    run(1);
    expect(old.bones[B.hips]!.matrixWorld.elements[13]!).not.toBe(y0);
  });

  it('a blast at the ragdoll budget leaves frozen corpses frozen', () => {
    const old = atTheCap();
    const y0 = old.bones[B.hips]!.matrixWorld.elements[13]!;
    physics.radialImpulse(v(0, 0.5, 1), 12, 160);
    run(5);
    expect(gore.stats().ragdolls).toBe(GoreTuning.maxRagdolls);
    expect(old.bones[B.hips]!.matrixWorld.elements[13]!).toBe(y0);
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
