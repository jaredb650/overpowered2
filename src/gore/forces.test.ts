/**
 * What a body feels like to hit. The numbers come from the weapon tables, so a retune has to stay inside these bands,
 * which are the brief: bullets rock a body, a shotgun at the muzzle knocks it down and shoves it about a metre, and a
 * rocket nearby throws it a few metres and no further.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { humanoidRig, HumanoidBone as B } from '../characters/rig';
import { DEFAULT_FORCE, type Ctx, type DamageInfo } from '../core/contracts';
import { DevFlags } from '../core/devflags';
import { Physics } from '../physics/Physics';
import { makeCtx } from '../sandbox/harness';
import { EXPLOSIONS, TUNING, WEAPONS } from '../weapons/data';
import { createGoreSystem, type Gore } from './index';
import { RagTuning } from './rag';
import { TestDummy } from './testDummy';

/**
 * Every band holds on the tempo dial too: a body that falls slower is thrown slower, so it lands as far. 1 is today, and
 * 0.75 and 0.6 are what the owner chooses between.
 */
const DIALS = [1, 0.75, 0.6];
function onDial(dial: number): void {
  beforeAll(() => {
    RagTuning.gravityScale = dial;
  });
  afterAll(() => {
    RagTuning.gravityScale = 1;
  });
}

const rig = humanoidRig('test');
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

let physics: Physics;
let ctx: Ctx;
let gore: Gore;
const scene = new THREE.Scene();

function spawn(): TestDummy {
  const c = new TestDummy(rig);
  scene.add(c.root);
  c.root.updateMatrixWorld(true);
  return c;
}

function frame(): void {
  ctx.time.tick(1 / 60);
  physics.step(ctx.time.dt);
  gore.update();
}

const run = (frames: number) => {
  for (let i = 0; i < frames; i++) frame();
};

const hips = (c: TestDummy) => new THREE.Vector3().setFromMatrixPosition(c.bones[B.hips]!.matrixWorld);
const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

/** Where a hit on a standing body lands, and which way it is going. */
const hit = (c: TestDummy, bone: number, force: number): DamageInfo => ({
  amount: 1, type: 'bullet', point: new THREE.Vector3().setFromMatrixPosition(c.bones[bone]!.matrixWorld), dir: v(0, 0, -1), force, source: 'test', bone,
});

/** Dies to the first hit and takes the rest as a corpse, which is how a kill plays out in the game. */
function shoot(c: TestDummy, force: number, hits: number, bones: readonly number[], gap = 0): void {
  const first = hit(c, bones[0]!, force);
  gore.ragdoll(c, { impulses: [{ bone: first.bone!, point: first.point, impulse: first.dir.clone().multiplyScalar(force) }] });
  for (let i = 1; i < hits; i++) {
    if (gap > 0) run(gap);
    const corpse = gore.raycastCorpses(v(0, 1.2, 2), v(0, 0, -1), 6);
    if (corpse) gore.damageCorpse(corpse, hit(c, bones[i % bones.length]!, force));
  }
}

/** Throw distance of a body killed by a blast this far behind it, and the fastest its hips went. */
function blast(kind: keyof typeof EXPLOSIONS, radius: number, distance: number): { thrown: number; speed: number } {
  gore.clear();
  const c = spawn();
  const start = hips(c);
  gore.ragdoll(c);
  physics.radialImpulse(v(0, 0.3, distance), radius * 1.35, EXPLOSIONS[kind].impulse * radius);
  let speed = 0;
  let last = start.clone();
  for (let i = 0; i < 300; i++) {
    frame();
    const now = hips(c);
    speed = Math.max(speed, now.distanceTo(last) * 60);
    last = now;
  }
  return { thrown: flat(last, start), speed };
}

function thrownBy(force: number, hits: number, bones: readonly number[]): number {
  gore.clear();
  const c = spawn();
  const start = hips(c);
  shoot(c, force, hits, bones);
  run(300);
  return flat(hips(c), start);
}

/** The rest of a shotgun's six pellets land in the same frame as the one that killed it. */
const TORSO = [B.chest, B.spine, B.chest, B.hips, B.chest, B.spine] as const;

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

describe.each(DIALS)('bullets, tempo %s', dial => {
  onDial(dial);
  it('rock a corpse under sustained fire and do not move it across the floor', () => {
    gore.clear();
    const c = spawn();
    gore.ragdoll(c);
    run(120);
    const start = hips(c);
    // 1.5 s of the SMG at its full rate, on a body lying down.
    for (let i = 0; i < 30; i++) {
      const corpse = gore.raycastCorpses(hips(c).add(v(0, 1.5, 0)), v(0, -1, 0), 4);
      if (corpse) gore.damageCorpse(corpse, { ...hit(c, B.chest, 0), point: corpse.point, dir: v(0, -0.35, -0.94) });
      run(3);
    }
    gore.clear();
    expect(flat(hips(c), start)).toBeLessThan(1.2);
  });

  it('share one table with the living, so a corpse is not hit harder than the body it was', () => {
    expect(DEFAULT_FORCE.bullet / 85).toBeLessThan(0.3);
  });
});

describe.each(DIALS)('shotgun, tempo %s', dial => {
  onDial(dial);
  it('knocks a body down and shoves it about a metre at the muzzle', () => {
    const force = WEAPONS.shotgun.force * TUNING.shotgun.pointBlankForce;
    let total = 0;
    for (let i = 0; i < 6; i++) total += thrownBy(force, 3 + (i % 3), TORSO);
    expect(total / 6).toBeGreaterThan(0.8);
    expect(total / 6).toBeLessThan(2.2);
  });
});

describe.each(DIALS)('blasts, tempo %s', dial => {
  onDial(dial);
  it('throw a body a few metres, and less the further it stood', () => {
    const close = blast('rocket', TUNING.rocket.radius, 2);
    const far = blast('rocket', TUNING.rocket.radius, 5);
    gore.clear();
    expect(close.thrown).toBeGreaterThan(2);
    expect(close.thrown).toBeLessThan(7);
    expect(far.thrown).toBeLessThan(close.thrown);
  });

  it('hold any blast, however big, to a throw that stays in the room', () => {
    const nuke = blast('nuke', 60, 2);
    gore.clear();
    expect(nuke.speed).toBeLessThan(16);
    expect(nuke.thrown).toBeLessThan(9);
  });

  it('do not fire a limb cut by the same blast off across the map', () => {
    gore.clear();
    const c = spawn();
    gore.ragdoll(c);
    const damage = { ...hit(c, B.foreArmL, 0), type: 'explosive' as const, force: 120 };
    gore.sever(c, 'armL', damage);
    const limb = gore.raycastCorpses(hips(c).add(v(-0.6, 0.4, 2)), v(0, 0, -1), 4);
    physics.radialImpulse(v(0, 0.3, 1), TUNING.rocket.radius * 1.35, EXPLOSIONS.rocket.impulse * TUNING.rocket.radius);
    let fastest = 0;
    run(1);
    for (let i = 0; i < 20; i++) {
      frame();
      fastest = Math.max(fastest, gore.stats().limbSpeed);
    }
    gore.clear();
    expect(limb).toBeDefined();
    expect(fastest).toBeLessThan(16);
  });

  it('follow the blast and not the mass of a chunk, so a footstep cannot fire one like a rocket', () => {
    gore.clear();
    const speedAfter = (strength: number): number => {
      gore.clear();
      gore.chunks.spawn('meat', 0, 0.2, 0, 0, 0, 0, 0.08);
      run(40);
      gore.chunks.spawn('meat', 0, 0.2, 0, 0, 0, 0, 0.08);
      run(2);
      physics.radialImpulse(v(1, 0, 0), 6, strength);
      run(2);
      return gore.chunks.fastest;
    };
    const step = speedAfter(8);
    const rocket = speedAfter(EXPLOSIONS.rocket.impulse * TUNING.rocket.radius);
    gore.clear();
    expect(step).toBeLessThan(3);
    expect(rocket).toBeGreaterThan(step * 3);
  });
});

describe.each(DIALS)('the master force dial, tempo %s', dial => {
  onDial(dial);
  it('scales a throw, and zero leaves a body where it falls', () => {
    const normal = blast('rocket', TUNING.rocket.radius, 2).thrown;
    DevFlags.force = 0;
    const none = blast('rocket', TUNING.rocket.radius, 2).thrown;
    DevFlags.force = 1;
    gore.clear();
    expect(none).toBeLessThan(normal);
    expect(none).toBeLessThan(1.3);
  });
});
