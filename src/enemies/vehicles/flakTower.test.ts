/** Unit tests for the physics-enabled destructible Flak Tower (`flakTower.ts`). */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Ctx } from '../../core/contracts';
import { EventBus } from '../../core/events';
import {
  FLAK_BLOCK_HP,
  FLAK_COLLAPSE_SECONDS,
  FLAK_HINT_TEXT,
  FLAK_LIQUIDATION_VALUE,
  FlakTower,
  isTier3Piercing,
} from './flakTower';

interface MockEnv {
  ctx: Ctx;
  removedColliders: number[];
  createdBodies: number;
  removedBodies: number;
  signals: string[];
  feeds: string[];
  sounds: string[];
  hitMarkers: string[];
  liquidated: Array<{ label: string; value: number; kind: string }>;
  staticBoxes: Array<{ handle: number; center: THREE.Vector3; half: THREE.Vector3 }>;
}

function makeEnv(): MockEnv {
  let nextHandle = 1;
  const removedColliders: number[] = [];
  const staticBoxes: Array<{ handle: number; center: THREE.Vector3; half: THREE.Vector3 }> = [];
  const signals: string[] = [];
  const feeds: string[] = [];
  const sounds: string[] = [];
  const hitMarkers: string[] = [];
  const liquidated: Array<{ label: string; value: number; kind: string }> = [];
  const events = new EventBus<Record<string, unknown>>();
  events.on('world:liquidated', payload => {
    liquidated.push(payload as { label: string; value: number; kind: string });
  });

  const env: MockEnv = {
    ctx: null as unknown as Ctx,
    removedColliders,
    createdBodies: 0,
    removedBodies: 0,
    signals,
    feeds,
    sounds,
    hitMarkers,
    liquidated,
    staticBoxes,
  };

  const makeChain = () => {
    const obj: Record<string, unknown> = {};
    for (const m of [
      'setTranslation', 'setRotation', 'setLinvel', 'setAngvel',
      'setLinearDamping', 'setAngularDamping', 'setDensity',
      'setFriction', 'setRestitution', 'setCollisionGroups',
    ]) {
      obj[m] = () => obj;
    }
    return obj;
  };

  const ctx = {
    events,
    render: {
      scene: new THREE.Scene(),
      materials: { patch: <T>(m: T) => m },
      lights: { flash: vi.fn() },
      decals: { add: vi.fn(), clear: vi.fn() },
    },
    physics: {
      R: {
        RigidBodyDesc: { dynamic: () => makeChain() },
        ColliderDesc: { cuboid: () => makeChain() },
      },
      world: {
        removeCollider: (c: RAPIER.Collider) => {
          removedColliders.push(c.handle);
        },
        createRigidBody: () => {
          env.createdBodies++;
          return {
            translation: () => ({ x: 20, y: 2, z: -105 }),
            rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
            linvel: () => ({ x: 0, y: -5, z: 0 }),
          };
        },
        createCollider: () => ({ handle: nextHandle++ }),
        removeRigidBody: () => {
          env.removedBodies++;
        },
      },
      addStaticBox: (center: THREE.Vector3, half: THREE.Vector3) => {
        const handle = nextHandle++;
        staticBoxes.push({ handle, center: center.clone(), half: half.clone() });
        return { handle } as unknown as RAPIER.Collider;
      },
    },
    audio: {
      play: (id: string) => { sounds.push(id); },
    },
    fx: {
      muzzleFlash: vi.fn(),
      tracer: vi.fn(),
      explosion: vi.fn(),
      smoke: vi.fn(),
      chips: vi.fn(),
      embers: vi.fn(),
      ring: vi.fn(),
      sparks: vi.fn(),
      dust: vi.fn(),
      slam: vi.fn(),
    },
    hud: {
      follow: vi.fn(() => vi.fn()),
      hitMarker: (kind: string) => { hitMarkers.push(kind); },
      feed: (text: string) => { feeds.push(text); },
      callout: vi.fn(),
    },
    player: {
      alive: true,
      position: new THREE.Vector3(20, 0, -70),
      eye: new THREE.Vector3(20, 1.6, -70),
      takeDamage: vi.fn(),
    },
    camera: {
      addTrauma: vi.fn(),
    },
    progression: {
      award: vi.fn(),
    },
    campaign: {
      signal: (name: string) => { signals.push(name); },
    },
  } as unknown as Ctx;

  env.ctx = ctx;
  return env;
}

describe('FlakTower (destructible Tier-3 reinforced concrete)', () => {
  it('builds 20+ modular concrete structural blocks and 4 roof AA guns', () => {
    const env = makeEnv();
    const tower = new FlakTower(env.ctx, null);

    expect(tower.blocks.length).toBeGreaterThanOrEqual(20);
    expect(tower.guns).toHaveLength(4);
    expect(tower.aliveCount).toBe(4);
    expect(tower.towerIntegrity).toBeCloseTo(1);
    expect(tower.flattened).toBe(false);
    expect(tower.barFraction()).toBeCloseTo(1);
    expect(tower.barLabel()).toContain('DESTROY GUNS & FLATTEN CORE');
    expect(isTier3Piercing('frame_howitzer')).toBe(true);
    expect(isTier3Piercing('nuke')).toBe(true);
    expect(isTier3Piercing('frame_40mm')).toBe(false);
    expect(isTier3Piercing('rocket')).toBe(false);

    tower.dispose();
  });

  it('rejects non-howitzer damage on concrete blocks with ricochet feedback and throttled hint', () => {
    const env = makeEnv();
    const tower = new FlakTower(env.ctx, null);
    const pier = tower.blocks.find(b => b.id === 'pier_foundation_0')!;
    const hitPoint = pier.worldCenter.clone();

    expect(tower.shot(pier.collider!, hitPoint, 200, 'smg')).toBe(true);
    expect(tower.direct(pier.collider!, hitPoint, 300, 'rocket', 'rocket')).toBe(true);
    expect(tower.direct(pier.collider!, hitPoint, 400, 'shell', 'frame_40mm')).toBe(true);
    tower.blast(hitPoint, { radius: 8, damage: 500, kind: 'rocket', source: 'frame_40mm', team: 'player' });

    expect(pier.hp).toBe(FLAK_BLOCK_HP);
    expect(pier.alive).toBe(true);
    expect(tower.towerIntegrity).toBeCloseTo(1);
    expect(env.sounds).toContain('ricochet');
    expect(env.hitMarkers).toContain('armor');
    // Hint is throttled to a single emission within the cooldown window.
    expect(env.feeds.filter(f => f === FLAK_HINT_TEXT)).toHaveLength(1);

    tower.dispose();
  });

  it('accepts 105mm howitzer hits, rips out dynamic physics chunks, and drops unsupported corner AA guns', () => {
    const env = makeEnv();
    const tower = new FlakTower(env.ctx, null);
    const pier0 = tower.blocks.find(b => b.id === 'pier_foundation_0')!;
    const handle0 = pier0.collider!.handle;

    // Partial hit reduces HP without destroying block.
    expect(tower.shot(pier0.collider!, pier0.worldCenter, 200, 'frame_howitzer')).toBe(true);
    expect(pier0.hp).toBe(FLAK_BLOCK_HP - 200);
    expect(pier0.alive).toBe(true);

    // Lethal 105mm hit destroys the foundation pier, spawns dynamic chunks, and drops corner 0's AA gun!
    expect(tower.direct(pier0.collider!, pier0.worldCenter, 300, 'shell', 'frame_howitzer')).toBe(true);
    expect(pier0.alive).toBe(false);
    expect(pier0.collider).toBeNull();
    expect(env.removedColliders).toContain(handle0);
    expect(env.createdBodies).toBeGreaterThanOrEqual(2);
    expect(env.sounds).toContain('explosion_debris');
    expect(tower.towerIntegrity).toBeLessThan(1);

    // Corner 0 AA gun lost its supporting foundation pier and detonated automatically.
    expect(tower.guns[0]!.alive).toBe(false);
    expect(tower.aliveCount).toBe(3);
    expect(env.signals).toContain('flak:gun');

    tower.dispose();
  });

  it('collapses into walkable rubble after 3 foundation piers fall, emitting world:liquidated and flak:flattened', () => {
    const env = makeEnv();
    const tower = new FlakTower(env.ctx, null);

    // Blow out 3 of 4 corner foundation piers with the 105mm Howitzer.
    for (const idx of [0, 1, 2]) {
      const pier = tower.blocks.find(b => b.id === `pier_foundation_${idx}`)!;
      tower.direct(pier.collider!, pier.worldCenter, FLAK_BLOCK_HP, 'shell', 'frame_howitzer');
    }

    expect(tower.collapsing).toBe(true);
    expect(tower.flattened).toBe(false);
    expect(env.sounds).toContain('metal_groan');

    // Step through the 2.4-second twisting/shearing pancake collapse.
    const steps = Math.ceil((FLAK_COLLAPSE_SECONDS + 0.2) / 0.1);
    for (let i = 0; i < steps; i++) {
      tower.update(0.1);
    }

    expect(tower.collapsing).toBe(false);
    expect(tower.flattened).toBe(true);
    expect(tower.aliveCount).toBe(0);
    expect(tower.towerIntegrity).toBe(0);
    expect(tower.barFraction()).toBe(0);
    expect(tower.barLabel()).toContain('RAZED');

    expect(env.signals).toContain('flak:cleared');
    expect(env.signals).toContain('flak:flattened');
    expect(env.liquidated).toHaveLength(1);
    expect(env.liquidated[0]).toMatchObject({
      label: 'FLAK TOWER RAZED',
      value: FLAK_LIQUIDATION_VALUE,
      kind: 'flakTower',
    });

    // Low walkable rubble collider (y <= 1.2 m) placed on the tower footprint.
    const rubbleBox = env.staticBoxes[env.staticBoxes.length - 1]!;
    expect(rubbleBox.center.y + rubbleBox.half.y).toBeLessThanOrEqual(1.2);

    // Reset restores everything cleanly.
    tower.reset();
    expect(tower.flattened).toBe(false);
    expect(tower.collapsing).toBe(false);
    expect(tower.aliveCount).toBe(4);
    expect(tower.towerIntegrity).toBeCloseTo(1);

    tower.dispose();
  });

  it('supports instant nukeFlatten() when caught in a tactical nuke', () => {
    const env = makeEnv();
    const tower = new FlakTower(env.ctx, null);

    tower.nukeFlatten();

    expect(tower.flattened).toBe(true);
    expect(tower.aliveCount).toBe(0);
    expect(tower.towerIntegrity).toBe(0);
    expect(env.signals).toContain('flak:cleared');
    expect(env.signals).toContain('flak:flattened');
    expect(env.liquidated).toHaveLength(1);
    expect(env.liquidated[0]!.value).toBe(FLAK_LIQUIDATION_VALUE);

    tower.dispose();
  });
});
