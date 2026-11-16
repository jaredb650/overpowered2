import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { archetypeById, rigFor } from '../characters/archetypes';
import { droneRig, humanoidRig, type RigDef } from '../characters/rig';
import type { Ctx, DamageInfo } from '../core/contracts';
import { Physics } from '../physics/Physics';
import { makeCtx } from '../sandbox/harness';
import { createGoreSystem, type Gore } from './index';
import { BodyFilter, Rag } from './rag';
import { TestDummy } from './testDummy';

let physics: Physics;
let ctx: Ctx;
let gore: Gore;
const scene = new THREE.Scene();

function spawn(rig: RigDef): TestDummy {
  const char = new TestDummy(rig);
  char.root.position.y = 3;
  scene.add(char.root);
  char.root.updateMatrixWorld(true);
  return char;
}

const damage: DamageInfo = {
  amount: 60, type: 'bullet', point: new THREE.Vector3(0, 2.83, 0.12),
  dir: new THREE.Vector3(0, 0, -1), force: 0, source: 'sentry',
};

beforeAll(async () => {
  physics = await Physics.create();
  ctx = makeCtx({
    physics,
    render: { scene, decals: { add() {}, splat() {}, clear() {} } } as unknown as Ctx['render'],
  });
  gore = createGoreSystem(ctx);
  gore.init();
});

beforeEach(() => gore.clear());
afterAll(() => gore.clear());

describe('machine and non-humanoid severing', () => {
  it('severs a drone gun without a crawl, and the remaining drone falls when killed', () => {
    // A previous human cut leaves human arm indices in the shared scratch mask.
    gore.sever(spawn(humanoidRig('human')), 'abdomen', damage);
    gore.clear();
    const char = spawn(rigFor(archetypeById('drone')));
    const result = gore.sever(char, 'abdomen', damage);
    expect(result).toMatchObject({ regions: ['abdomen'] });
    expect(result?.torso === undefined).toBe(true);
    expect(char.severed.has('abdomen')).toBe(true);
    expect(gore.stats().limbs).toBe(1);
    expect(gore.owns(char)).toBe(false);

    gore.ragdoll(char);
    expect(gore.owns(char)).toBe(true);
    for (let i = 0; i < 30; i++) {
      ctx.time.tick(1 / 60);
      physics.step(ctx.time.dt);
      gore.update();
    }
    const bodyY = new THREE.Vector3().setFromMatrixPosition(char.bones[0]!.matrixWorld).y;
    expect(bodyY).toBeLessThan(2.5);
    expect(Number.isFinite(bodyY)).toBe(true);
  });

  it.each([
    ['a humanoid machine', rigFor(archetypeById('titan'))],
    ['an unregistered non-humanoid', droneRig('swarm-test')],
    ['an incomplete human rig', { ...humanoidRig('incomplete'), bones: humanoidRig('incomplete').bones.slice(0, 6) }],
  ] as const)('never starts a human crawl for %s', (_name, rig) => {
    const char = spawn(rig);
    const result = gore.sever(char, 'abdomen', damage);
    expect(result).not.toBeNull();
    expect(result?.torso === undefined).toBe(true);
    expect(gore.owns(char)).toBe(false);
  });
});

it('partFor falls back to the first body for a bone missing from the rig', () => {
  const char = spawn(droneRig('drone'));
  const rag = new Rag(physics, char, {
    chainRoot: 0, mask: new Uint8Array(char.rig.bones.length).fill(1), seeds: null,
    membership: BodyFilter.membership, collidesWith: BodyFilter.collidesWith,
    restitution: 0.02, friction: 0.72,
  });
  try {
    for (const bone of [char.rig.bones.length, 99, -1, NaN]) {
      expect(() => rag.partFor(bone)).not.toThrow();
      expect(rag.partFor(bone)).toBe(rag.parts[0]);
    }
    // A merged sensor still resolves to its real ancestor body.
    expect(rag.partFor(6)).toBe(rag.partFor(0));
  } finally {
    rag.destroy();
  }
});
