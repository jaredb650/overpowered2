/**
 * Targeted audit tests for Batch A (Active Ragdolls & Character Core):
 * 1. Character `anim.update` probing passthrough, `measureAnimVelocity` state isolation, & `SeveredPart.pose` inverse isolation.
 * 2. DynamicBalancer `onFootstep` finite `(x, y, z, strength)` arguments.
 * 3. Ball-joint twist axis at 90° swing in both `Rag.limit` and `MuscleState.ball`.
 * 4. `Crawler.step` left/right arm lateral sign, arrival `planted` reset, and large/invalid `dt` safety.
 * 5. `Reflex` aborting `struggle` + zeroing `lift.force` on limb sever via `bind()`, and `gather` respecting `dying >= 0`.
 * 6. `FarBatch.warm()` followed by `clear()` and baking a real corpse into slot 0 surviving delayed `onAfterRender`.
 * 7. `HumanoidAnimator` advancing and completing an active get-up clip at `lod >= 3`.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { archetypeById, rigFor } from '../characters/archetypes';
import { Character, SeveredPart, type ArchetypeData } from '../characters/Character';
import { HumanoidAnimator } from '../characters/animation/HumanoidAnimator';
import { HumanoidBone as B, type RigDef } from '../characters/rig';
import type { Ctx } from '../core/contracts';
import { Physics } from '../physics/Physics';
import { makeCtx } from '../sandbox/harness';
import { Crawler } from './crawl';
import { FarBatch, type FarBakeable, type FarBuffers } from './far';
import { createGoreSystem } from './index';
import { MuscleTuning, splitSwing, swingTwist } from './muscles';
import { BodyFilter, Rag, RagTuning } from './rag';
import { Reflex } from './reflex';
import { StandTuning } from './stand';
import { TestDummy } from './testDummy';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Builds minimal synthetic ArchetypeData sufficient to instantiate real Character & SeveredPart objects in Node. */
function makeArchetypeData(kind = 'trooper'): ArchetypeData {
  const def = archetypeById(kind);
  const rig: RigDef = rigFor(def);
  const rigCount = rig.bones.length;
  const bindPositions: THREE.Vector3[] = [];
  for (let i = 0; i < rigCount; i++) {
    const b = rig.bones[i]!;
    const p = new THREE.Vector3(b.offset[0], b.offset[1], b.offset[2]);
    if (b.parent >= 0) p.add(bindPositions[b.parent]!);
    bindPositions.push(p);
  }
  const bindInverses = bindPositions.map(p => new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
  const children: number[][] = Array.from({ length: rigCount }, () => []);
  for (let i = 0; i < rigCount; i++) {
    const p = rig.bones[i]!.parent;
    if (p >= 0) children[p]!.push(i);
  }
  const geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  const vertCount = geo.attributes.position!.count;
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(vertCount * 4), 4));
  const weights = new Float32Array(vertCount * 4);
  for (let i = 0; i < vertCount; i++) weights[i * 4] = 1;
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const mat = new THREE.MeshBasicMaterial();
  const skeleton = rig.bones.map(b => ({ name: b.name, parent: b.parent }));
  let data!: ArchetypeData;
  data = {
    id: kind,
    def,
    rig,
    model: {
      meta: { skeleton, rigBoneCount: rigCount },
      lods: [geo, geo, geo],
      far: null,
      capByBone: new Map(),
      chains: new Map(),
    } as unknown as ArchetypeData['model'],
    material: mat,
    woundMaterial: mat,
    woundDiscardMaterial: mat,
    farMaterial: mat,
    interior: null,
    interiorMaterial: null,
    backingMaterial: null,
    time: { elapsed: 0 },
    boneCount: rigCount,
    bindInverses,
    bindPositions,
    children,
    acquireLimb: () => new SeveredPart(data),
  };
  return data;
}

let physics: Physics;

function makeRag(dummy: TestDummy, muscles: boolean): Rag {
  const mask = new Uint8Array(dummy.rig.bones.length).fill(1);
  return new Rag(physics, dummy, {
    chainRoot: 0,
    mask,
    seeds: null,
    ...BodyFilter,
    restitution: 0.05,
    friction: 0.7,
    muscles,
  });
}

function makeDummyAnimator(dummy: TestDummy, kind = 'trooper'): HumanoidAnimator {
  const def = archetypeById(kind);
  const hidden = (dummy as unknown as { hidden: Uint8Array }).hidden;
  const anim = new HumanoidAnimator(dummy.bones, dummy.rig, def, dummy.root, dummy.severed, b => hidden[b] === 1);
  (dummy as { anim: unknown }).anim = anim;
  return anim;
}

beforeAll(async () => {
  physics = await Physics.create();
  physics.addStaticBox(v(0, -0.5, 0), v(80, 0.5, 80), null, 'concrete');
  physics.flushQueries();
});

describe('1. Character probing passthrough & SeveredPart isolation', () => {
  it('forwards probing=true through Character.anim.update, skips breaks.apply during probe, and preserves HumanoidAnimator.lastRoot', () => {
    const data = makeArchetypeData('trooper');
    const char = new Character(data);
    const anim = char.anim as HumanoidAnimator;
    const breaks = (char as unknown as { breaks: { apply: (dt: number) => void } }).breaks;
    const applySpy = vi.spyOn(breaks, 'apply');

    // Step several walking frames so lastRoot and locomotion state are active.
    char.root.position.set(1, 0, 2);
    anim.setLocomotion({ speed: 3.5, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true });
    for (let i = 0; i < 6; i++) {
      char.root.position.z += 3.5 / 60;
      char.root.updateMatrixWorld(true);
      char.anim.update(1 / 60, 0);
    }
    expect(applySpy).toHaveBeenCalledTimes(6);

    const lastRoot = (anim as unknown as { lastRoot: THREE.Vector3 }).lastRoot;
    const beforeRoot = lastRoot.clone();
    const beforeTime = (anim as unknown as { time: number }).time;
    const footstepSpy = vi.fn();
    anim.onFootstep = footstepSpy;

    // Move root slightly as measureAnimVelocity(walk=true) does and probe via Character's wrapped anim.update.
    const savedPos = char.root.position.clone();
    char.root.position.z += 3.5 / 90;
    char.root.updateMatrixWorld(true);
    char.anim.update(1 / 90, 0, true);
    char.root.position.copy(savedPos);
    char.root.updateMatrixWorld(true);

    // breaks.apply must NOT run during probing, onFootstep must not fire, and lastRoot/time must be restored.
    expect(applySpy).toHaveBeenCalledTimes(6);
    expect(footstepSpy).not.toHaveBeenCalled();
    expect(lastRoot.distanceTo(beforeRoot)).toBeLessThan(1e-7);
    expect((anim as unknown as { time: number }).time).toBe(beforeTime);
  });

  it('SeveredPart.pose clones boneInverses so subsequent Character.standIn does not mutate severed limbs', () => {
    const data = makeArchetypeData('trooper');
    const char = new Character(data);
    // Detach char.skeleton.boneInverses from shared bindInverses via an initial stand-in so later standIn mutates in-place.
    expect(char.standIn(B.chest, new THREE.Object3D())).toBe(true);
    const limb = new SeveredPart(data);
    limb.pose(char, B.upperArmL);

    expect(limb.skeleton.boneInverses).not.toBe(char.skeleton.boneInverses);
    const originalHeadInverse = limb.skeleton.boneInverses[B.head];

    // Mount a second stand-in on the character's head, mutating char.skeleton.boneInverses in-place.
    expect(char.standIn(B.head, new THREE.Object3D())).toBe(true);
    expect(char.skeleton.boneInverses[B.head]).not.toBe(originalHeadInverse);
    expect(limb.skeleton.boneInverses[B.head]).toBe(originalHeadInverse);

    // Releasing the limb restores shared bindInverses.
    limb.release();
    expect(limb.skeleton.boneInverses).toBe(data.bindInverses);
  });
});

describe('2. DynamicBalancer onFootstep finite coordinates', () => {
  it('invokes anim.onFootstep with finite (x, y, z, strength) on catch-step landings', () => {
    const scene = new THREE.Scene();
    const ctx = makeCtx({ physics, render: { scene } as unknown as Ctx['render'] });
    const gore = createGoreSystem(ctx);
    gore.init();

    const def = archetypeById('trooper');
    const rig = rigFor(def);
    const c = new TestDummy(rig);
    scene.add(c.root);
    c.root.updateMatrixWorld(true);
    const anim = makeDummyAnimator(c, 'trooper');

    const calls: [number, number, number, number][] = [];
    anim.onFootstep = (x, y, z, strength) => calls.push([x, y, z, strength]);

    for (let i = 0; i < 15; i++) {
      anim.setLocomotion({ speed: 0, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true });
      anim.update(1 / 60, 0);
    }
    calls.length = 0;

    const dir = v(0, 0, 1);
    anim.stumble(dir, 0.5, B.chest);
    const ok = gore.knockdown(c, {
      velocity: dir.clone().multiplyScalar(2.5),
      stumble: { seconds: StandTuning.maxSeconds, budget: 0.8 },
      hurt: 0.6,
      lie: 0.6,
      rise: 1.6,
      wound: { bone: B.chest, point: new THREE.Vector3().setFromMatrixPosition(c.bones[B.chest]!.matrixWorld) },
    });
    expect(ok).toBe(true);

    for (let f = 0; f < 90; f++) {
      ctx.time.tick(1 / 60);
      if (!gore.downed(c)) anim.update(1 / 60, 0);
      physics.step(ctx.time.dt);
      gore.update();
      c.root.updateMatrixWorld(true);
    }

    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const [x, y, z, strength] of calls) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(Number.isFinite(z)).toBe(true);
      expect(Number.isFinite(strength)).toBe(true);
      expect(strength).toBeGreaterThanOrEqual(0.35);
      expect(strength).toBeLessThanOrEqual(1);
    }
    gore.clear();
  });
});

describe('3. Ball-joint twist axis at 90° swing', () => {
  /** Builds a real trooper ragdoll, isolates a ball joint at 90° swing + excess twist, and checks twist torque axis. */
  function testBallTwistAxis(withMuscle: boolean): { alongChild: number; alongParent: number } {
    const def = archetypeById('trooper');
    const rig = rigFor(def);
    const dummy = new TestDummy(rig);
    dummy.root.position.set(20, 3, 20);
    dummy.root.updateMatrixWorld(true);

    const rag = makeRag(dummy, withMuscle);
    // Pick a leaf ball joint (e.g. head) so no grandchild joints add unrelated reaction torques onto child.tau.
    const child = rag.parts.find(
      p => p.parent && !p.hinge && !p.fixed && p.twist > 0 && !rag.parts.some(o => o.parent === p),
    )!;
    const parent = child.parent!;
    // Ensure swing cone does not trigger at 90° so ONLY twist correction fires.
    child.shape = null;
    child.cone = Math.PI;
    child.twist = 0.2;

    if (withMuscle) {
      const m = rag.muscle!;
      for (const p of rag.parts) {
        if (p.muscle) {
          p.muscle.drive = 0;
          p.muscle.hasRelax = false;
        }
      }
      // Ensure ligament hold is fully active and tone is zero so only twist ligament torque acts.
      (m as unknown as { hold: number; elastic: number }).hold = 1;
      (m as unknown as { elastic: number }).elastic = 1;
      (rag as unknown as { age: number }).age = 1;
    } else {
      (rag as unknown as { age: number }).age = RagTuning.limitRise + 1;
    }

    // Zero all velocities and orient parent = identity, child = swing(90° perp to c.axis) * twist(+0.8 rad about c.axis).
    const localAxis = child.axis.clone().normalize();
    const swingAxis = Math.abs(localAxis.y) < 0.9 ? v(0, 1, 0) : v(1, 0, 0);
    swingAxis.cross(localAxis).normalize();
    const qSwing = new THREE.Quaternion().setFromAxisAngle(swingAxis, Math.PI / 2);
    const qTwist = new THREE.Quaternion().setFromAxisAngle(localAxis, 0.8);
    const qChild = qSwing.clone().multiply(qTwist);

    // Sanity check splitSwing decomposition on this exact pose.
    splitSwing(qChild, localAxis);
    expect(Math.abs(swingTwist.angle - Math.PI / 2)).toBeLessThan(1e-4);
    expect(swingTwist.twist).toBeCloseTo(0.8, 4);

    for (const p of rag.parts) {
      p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    parent.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    child.body.setRotation({ x: qChild.x, y: qChild.y, z: qChild.z, w: qChild.w }, true);

    const worldParentAxis = localAxis.clone().applyQuaternion(new THREE.Quaternion());
    const worldChildAxis = localAxis.clone().applyQuaternion(qChild);
    // At 90° swing, child axis and parent axis are orthogonal.
    expect(Math.abs(worldChildAxis.dot(worldParentAxis))).toBeLessThan(1e-5);
    expect(Math.PI / 2).toBeLessThan(withMuscle ? MuscleTuning.twistFadeEnd : RagTuning.twistFadeEnd);

    rag.preStep(1 / 60);
    const alongChild = child.tau.dot(worldChildAxis);
    const alongParent = child.tau.dot(worldParentAxis);

    rag.destroy();
    return { alongChild, alongParent };
  }

  it('Rag.limit applies twist correction along c.q * c.axis (perpendicular to p.q * c.axis)', () => {
    const { alongChild, alongParent } = testBallTwistAxis(false);
    // Twist is +0.8, so restoring torque must oppose +worldChildAxis (negative dot), with ~0 component along parent axis.
    expect(alongChild).toBeLessThan(-1e-3);
    expect(Math.abs(alongParent)).toBeLessThan(1e-5);
  });

  it('MuscleState.ball applies twist ligament torque along c.q * c.axis (perpendicular to p.q * c.axis)', () => {
    const { alongChild, alongParent } = testBallTwistAxis(true);
    expect(alongChild).toBeLessThan(-1e-3);
    expect(Math.abs(alongParent)).toBeLessThan(1e-5);
  });
});

describe('4. Crawler lateral reach sign, arrival reset, and dt stability', () => {
  it('reaches left arm toward +left and right arm toward -left, resets planted on arrival, and handles large/invalid dt safely', () => {
    const def = archetypeById('trooper');
    const rig = rigFor(def);
    const dummy = new TestDummy(rig);
    dummy.root.position.set(0, 0.25, 0);
    dummy.root.rotation.x = Math.PI / 2;
    dummy.root.updateMatrixWorld(true);

    const rag = makeRag(dummy, false);
    const chest = rag.partFor(B.chest);
    const armL = rag.partFor(B.foreArmL);
    const armR = rag.partFor(B.foreArmR);

    // Position chest and both forearms at ground height, symmetric on X = 0 so reach lateral offset is unambiguous.
    const placeProne = () => {
      for (const p of rag.parts) {
        p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
      chest.body.setTranslation({ x: 0, y: 0.2, z: 0 }, true);
      armL.body.setTranslation({ x: 0, y: 0.15, z: 0.3 }, true);
      armR.body.setTranslation({ x: 0, y: 0.15, z: 0.3 }, true);
    };

    placeProne();
    // Target straight ahead along +Z => toTarget = (0, 0, 1), left = up × toTarget = (+1, 0, 0).
    const crawler = new Crawler(rag, v(0, 0, 5), 100);

    // Side 0 = left arm (sideSign = +1): must accelerate toward +X (+left).
    (crawler as unknown as { side: number; clock: number; planted: boolean }).side = 0;
    (crawler as unknown as { clock: number }).clock = 0;
    crawler.step(1 / 60);
    const vL = new THREE.Vector3();
    armL.body.linvel(vL);
    expect(vL.x).toBeGreaterThan(0.05);

    // Side 1 = right arm (sideSign = -1): must accelerate toward -X (-left).
    placeProne();
    (crawler as unknown as { side: number; clock: number; planted: boolean }).side = 1;
    (crawler as unknown as { clock: number }).clock = 0;
    (crawler as unknown as { planted: boolean }).planted = false;
    crawler.step(1 / 60);
    const vR = new THREE.Vector3();
    armR.body.linvel(vR);
    expect(vR.x).toBeLessThan(-0.05);

    // Planted flag must reset when target is within arrive distance or < 1e-3.
    (crawler as unknown as { planted: boolean }).planted = true;
    crawler.setTarget(v(0, 0, 0.2)); // within arrive (0.65)
    crawler.step(1 / 60);
    expect((crawler as unknown as { planted: boolean }).planted).toBe(false);

    (crawler as unknown as { planted: boolean }).planted = true;
    crawler.setTarget(v(0, 0, 0)); // dist < 1e-3
    crawler.step(1 / 60);
    expect((crawler as unknown as { planted: boolean }).planted).toBe(false);

    // Non-positive, NaN, and large dt must never produce NaN or unbounded velocities.
    crawler.setTarget(v(0, 0, 5));
    crawler.step(0);
    crawler.step(-0.1);
    crawler.step(Number.NaN);
    crawler.step(0.5);
    for (const p of [chest, armL, armR]) {
      const lv = new THREE.Vector3();
      const av = new THREE.Vector3();
      p.body.linvel(lv);
      p.body.angvel(av);
      expect(Number.isFinite(lv.x + lv.y + lv.z)).toBe(true);
      expect(Number.isFinite(av.x + av.y + av.z)).toBe(true);
      expect(lv.length()).toBeLessThan(20);
      expect(av.length()).toBeLessThan(20);
    }

    rag.destroy();
  });
});

describe('5. Reflex struggle abort on sever & dying guard in gather', () => {
  it('aborts struggle and zeroes lift.force when arms are lost and bind() is called, and never sets ready while dying', () => {
    const def = archetypeById('trooper');
    const rig = rigFor(def);
    const dummy = new TestDummy(rig);
    dummy.root.position.set(10, 0.3, 10);
    dummy.root.updateMatrixWorld(true);
    const anim = makeDummyAnimator(dummy, 'trooper');

    const rag = makeRag(dummy, true);
    const muscle = rag.muscle!;

    const reflex = new Reflex(rag, muscle, anim, {
      lie: 0.05,
      hurt: 0.4,
      groundY: 0,
      dir: v(0, 0, 1),
      plank: false,
    });

    // Force reflex into active 'struggle' phase with active lift force.
    (reflex as unknown as { phase: string }).phase = 'struggle';
    reflex.lift.force = 420;
    (reflex as unknown as { startU: number }).startU = 0.25;
    reflex.ready = true;

    // Sever all arm parts from the chain so canPush() becomes false, then invoke bind().
    for (let i = rag.parts.length - 1; i >= 0; i--) {
      if (rag.parts[i]!.muscle?.role === 'arm') rag.parts.splice(i, 1);
    }
    reflex.bind();

    expect((reflex as unknown as { phase: string }).phase).toBe('lying');
    expect(reflex.lift.force).toBe(0);
    expect(reflex.ready).toBe(false);
    expect((reflex as unknown as { startU: number }).startU).toBe(0);

    // Enter gather while dying >= 0: die() clears ready and advance() must never set ready = true.
    (reflex as unknown as { phase: string }).phase = 'gather';
    (reflex as unknown as { time: number }).time = 10;
    reflex.ready = true;
    reflex.die();
    expect(reflex.ready).toBe(false);
    expect(reflex.lift.force).toBe(0);

    reflex.sample(1 / 60);
    expect(reflex.ready).toBe(false);

    rag.destroy();
  });
});

describe('6. FarBatch warm() + clear() generation guard', () => {
  it('does not delete a real corpse baked into slot 0 when a stale warm() onAfterRender fires after clear()', () => {
    const scene = new THREE.Scene();
    const ctx = makeCtx({ render: { scene } as unknown as Ctx['render'] });
    const batch = new FarBatch(ctx, 8, { slotVerts: 16, slotIndices: 24, step: 4 });
    const mat = new THREE.MeshBasicMaterial();

    const makeBakeable = (x: number): FarBakeable => ({
      farMaterial: mat,
      bakeFar(out: FarBuffers, vertex: number, index: number) {
        out.position.set([x, 0, 0, x + 0.1, 0, 0, x, 0, 0.1], vertex * 3);
        out.index.set([vertex, vertex + 1, vertex + 2], index);
        return { verts: 3, indices: 3 };
      },
    });

    // Warm installs an onAfterRender hook targeting slot 0.
    batch.warm(makeBakeable(0));
    const mesh = (batch as unknown as { mesh: THREE.Mesh }).mesh;
    expect(batch.count).toBe(1);
    const staleHook = mesh.onAfterRender;

    // Clear resets slot 0 before the warm draw ever ran, unhooking onAfterRender and bumping generation.
    batch.clear();
    expect(batch.count).toBe(0);
    expect(mesh.onAfterRender).not.toBe(staleHook);

    // Bake a real corpse into slot 0.
    const realSlot = batch.add(makeBakeable(5));
    expect(realSlot).toBe(0);
    expect(batch.count).toBe(1);

    // Even if both the stale captured warm callback and the current mesh.onAfterRender fire, slot 0 survives.
    const dummyArgs = [null, null, null, null, null, null] as unknown as Parameters<THREE.Mesh['onAfterRender']>;
    staleHook.apply(mesh, dummyArgs);
    mesh.onAfterRender.apply(mesh, dummyArgs);

    expect(batch.count).toBe(1);
    expect(batch.triangles).toBe(1);
    batch.clear();
  });
});

describe('7. HumanoidAnimator get-up clip completion at LOD >= 3', () => {
  it('advances and completes an active get-up clip at lod=3 and lifts bones off the floor', () => {
    const def = archetypeById('trooper');
    const rig = rigFor(def);
    const dummy = new TestDummy(rig);
    const anim = makeDummyAnimator(dummy, 'trooper');

    // Prime standing pose, then drop hips & bones onto the floor (simulating ragdoll hand-back).
    anim.setLocomotion({ speed: 0, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true });
    anim.update(1 / 60, 0);
    dummy.bones[B.hips]!.position.set(0, 0.12, 0);
    dummy.bones[B.hips]!.quaternion.setFromAxisAngle(v(1, 0, 0), Math.PI / 2);
    dummy.root.updateMatrixWorld(true);

    const floorY = new THREE.Vector3().setFromMatrixPosition(dummy.bones[B.hips]!.matrixWorld).y;
    expect(floorY).toBeLessThan(0.25);

    anim.getUp('prone', 0.8, 0.5);
    expect((anim as unknown as { clipKind: string | null }).clipKind).toBe('prone');

    // Advance strictly at lod = 3 until well past clip duration.
    for (let i = 0; i < 90; i++) {
      anim.update(1 / 60, 3);
    }
    dummy.root.updateMatrixWorld(true);

    expect((anim as unknown as { clipKind: string | null }).clipKind).toBeNull();
    expect((anim as unknown as { snapLeft: number }).snapLeft).toBe(0);
    const risenY = new THREE.Vector3().setFromMatrixPosition(dummy.bones[B.hips]!.matrixWorld).y;
    expect(risenY).toBeGreaterThan(0.6);
  });
});
