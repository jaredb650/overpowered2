/** Unit tests for Gold Bullion Pallets, Carry/Throw Duffels & Getaway Humvee (`bags.ts`). */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../../core/contracts';
import {
  BANK_HUB,
  BONUS_BAG_VALUE,
  GOLD_PALLETS,
  HUMVEE_BED_POS,
  HUMVEE_TURRET_POS,
  MANDATORY_BAGS,
} from '../../world/map/bank/plan';
import {
  BAG_CARRY_SPEED,
  BAG_PACK_HOLD,
  BAG_THROW_SPEED,
  BAG_THROW_UP,
  BAG_VOID_Y,
  LootBags,
  MANDATORY_BAG_SCORE,
} from './bags';

function makeBagsEnv() {
  let interactDown = false;
  let interactPressed = false;
  let dropPressed = false;
  const signals: string[] = [];
  const feeds: string[] = [];
  const awards: { points: number; reason: string }[] = [];
  const holds: number[] = [];

  const player = {
    alive: true,
    parked: false,
    position: new THREE.Vector3(0, -1.5, -35),
    eye: new THREE.Vector3(0, 0.05, -35),
    forward: new THREE.Vector3(0, 0, 1),
    yaw: Math.PI,
    modifiers: {
      speed: 1,
      jump: 1,
      damageTaken: 1,
      invulnerable: false,
      infiniteDash: false,
    },
  };

  const ctx = {
    render: {
      scene: new THREE.Scene(),
      materials: { patch: <T>(m: T) => m },
      lights: { flash: vi.fn() },
    },
    physics: {
      // Headless unit tests use deterministic ballistic fallback when Rapier WASM is absent
      R: {},
      world: {},
    },
    world: {
      nav: {
        groundHeight: (_x: number, _y: number, z: number) => (z < -20 ? -1.5 : 0),
      },
    },
    input: {
      isDown: (action: string) => action === 'interact' && interactDown,
      pressed: (action: string) =>
        (action === 'interact' && interactPressed) || (action === 'dropWeapon' && dropPressed),
      labelFor: (action: string) => (action === 'interact' ? 'E' : ''),
    },
    audio: {
      has: () => true,
      play: vi.fn(),
    },
    fx: {
      sparks: vi.fn(),
      pickupSparkle: vi.fn(),
    },
    hud: {
      marker: vi.fn(() => vi.fn()),
      follow: vi.fn(() => vi.fn()),
      hold: (fill: number) => {
        holds.push(fill);
      },
      feed: (text: string) => {
        feeds.push(text);
      },
    },
    progression: {
      award: (points: number, reason: string) => {
        awards.push({ points, reason });
      },
    },
    player,
  } as unknown as Ctx;

  function movePlayer(x: number, y: number, z: number): void {
    player.position.set(x, y, z);
    player.eye.set(x, y + 1.55, z);
  }

  return {
    ctx,
    player,
    signals,
    feeds,
    awards,
    holds,
    movePlayer,
    onSignal: (sig: string) => signals.push(sig),
    setInteractDown: (v: boolean) => {
      interactDown = v;
    },
    tapInteract: () => {
      interactPressed = true;
    },
    tapDrop: () => {
      dropPressed = true;
    },
    clearFrameInput: () => {
      interactPressed = false;
      dropPressed = false;
    },
  };
}

function packPallet(env: ReturnType<typeof makeBagsEnv>, bags: LootBags, index: number): void {
  const pallet = GOLD_PALLETS[index]!;
  env.movePlayer(pallet.pos[0], pallet.pos[1], pallet.pos[2] + 1.2);
  env.setInteractDown(true);
  const steps = Math.ceil((BAG_PACK_HOLD + 0.1) / 0.1);
  for (let i = 0; i < steps; i++) bags.update(0.1);
  env.setInteractDown(false);
}

describe('LootBags (Mission 4 Bank Run)', () => {
  it('packs a gold pallet via 1.0s held [E], emits bk:bag_packed, and applies 0.76x encumbrance cleanly', () => {
    const env = makeBagsEnv();
    const bags = new LootBags(env.ctx, env.onSignal);

    expect(bags.active).toBe(false);
    expect(bags.humveeVisible).toBe(false);
    expect(bags.humveeYaw).toBeCloseTo(Math.PI, 4);

    bags.activate();
    expect(bags.active).toBe(true);
    expect(bags.humveeVisible).toBe(true);

    // Pre-existing perk speed modifier should be preserved across carry/restore cycles
    env.player.modifiers.speed = 1.2;

    packPallet(env, bags, 0);
    expect(bags.carrying).toBe(true);
    expect(bags.packedCount).toBe(1);
    expect(env.signals).toEqual(['bk:bag_packed']);
    expect(env.player.modifiers.speed).toBeCloseTo(BAG_CARRY_SPEED, 4);
    expect(env.holds[env.holds.length - 1]).toBe(1);

    // Throw restores saved pre-carry speed modifier immediately
    env.tapDrop();
    bags.update(0.05);
    env.clearFrameInput();
    expect(bags.carrying).toBe(false);
    expect(env.player.modifiers.speed).toBeCloseTo(1.2, 4);

    bags.dispose();
  });

  it('heaves duffel in a ballistic physics arc, supports floor pickup, and recovers bags from the void', () => {
    const env = makeBagsEnv();
    const bags = new LootBags(env.ctx, env.onSignal);
    bags.activate();

    packPallet(env, bags, 0);
    expect(env.player.modifiers.speed).toBeCloseTo(BAG_CARRY_SPEED, 4);

    // Aim south (+Z) and press dropWeapon / [G]
    env.movePlayer(0, 0, 5);
    env.player.forward.set(0, 0, 1);
    env.tapDrop();
    bags.update(0.016);
    env.clearFrameInput();

    expect(bags.carrying).toBe(false);
    expect(env.player.modifiers.speed).toBe(1);
    expect(bags.dropped.length).toBe(1);

    const bag = bags.dropped[0]!;
    expect(bag.velocity.z).toBeCloseTo(BAG_THROW_SPEED, 1);
    expect(bag.velocity.y).toBeCloseTo(BAG_THROW_UP, 1);

    // Simulate flight until it lands on the hall floor
    for (let i = 0; i < 40; i++) bags.update(0.05);
    expect(bag.position.z).toBeGreaterThan(8);
    expect(bag.position.y).toBeGreaterThanOrEqual(0);

    // Walk up to the dropped duffel and pick it back up with [E]
    env.movePlayer(bag.position.x, 0, bag.position.z - 1.0);
    env.tapInteract();
    bags.update(0.05);
    env.clearFrameInput();
    expect(bags.carrying).toBe(true);
    expect(bags.dropped.length).toBe(0);
    expect(env.player.modifiers.speed).toBeCloseTo(BAG_CARRY_SPEED, 4);

    // Throw again and force below void threshold (y < -6) -> teleports safely to BANK_HUB
    const thrown = bags.throwBag()!;
    thrown.position.set(50, BAG_VOID_Y - 2, 50);
    bags.update(0.05);
    expect(thrown.position.x).toBeCloseTo(BANK_HUB.x, 2);
    expect(thrown.position.z).toBeCloseTo(BANK_HUB.z, 2);
    expect(thrown.position.y).toBeGreaterThan(0);

    bags.dispose();
  });

  it('deposits thrown & carried bags into Humvee bed, emits bk:bags_quota at 4/4, awards +$2,500 bonus bags, and triggers bk:mount_turret', () => {
    const env = makeBagsEnv();
    const bags = new LootBags(env.ctx, env.onSignal);
    bags.activate();

    // Bag 1: thrown straight into the Humvee cargo bed (within 2.5 m catch radius!)
    packPallet(env, bags, 0);
    env.movePlayer(HUMVEE_BED_POS[0], 0, HUMVEE_BED_POS[2] - 4.0);
    env.player.forward.set(0, 0, 1);
    bags.throwBag();
    for (let i = 0; i < 20; i++) bags.update(0.05);
    expect(bags.secured).toBe(1);
    expect(bags.dropped.length).toBe(0);
    expect(env.awards[0]?.points).toBe(MANDATORY_BAG_SCORE);

    // Bags 2, 3, 4: walk right up to the lowered tailgate (< 2.4 m auto-deposit)
    for (let i = 1; i < MANDATORY_BAGS; i++) {
      packPallet(env, bags, i);
      env.movePlayer(HUMVEE_BED_POS[0], 0, HUMVEE_BED_POS[2] - 1.5);
      bags.update(0.05);
    }

    expect(bags.secured).toBe(MANDATORY_BAGS);
    expect(bags.bonusSecured).toBe(0);
    expect(bags.quotaMet).toBe(true);
    expect(env.signals).toContain('bk:bags_quota');
    expect(env.player.modifiers.speed).toBe(1);

    // Bonus bags 5 & 6: pack and deposit -> +$2,500 each
    packPallet(env, bags, 4);
    env.movePlayer(HUMVEE_BED_POS[0], 0, HUMVEE_BED_POS[2] - 1.5);
    bags.update(0.05);

    packPallet(env, bags, 5);
    env.movePlayer(HUMVEE_BED_POS[0], 0, HUMVEE_BED_POS[2] - 1.5);
    bags.update(0.05);

    expect(bags.secured).toBe(6);
    expect(bags.bonusSecured).toBe(2);
    expect(env.awards.filter(a => a.points === BONUS_BAG_VALUE).length).toBe(2);

    // Bag 7: carry it straight to the roof turret side and press [E] -> auto-deposits 7th bag & mounts .50 cal!
    packPallet(env, bags, 6);
    expect(bags.carrying).toBe(true);
    env.movePlayer(HUMVEE_TURRET_POS[0] + 2.2, 0, HUMVEE_TURRET_POS[2] + 0.5);
    env.tapInteract();
    bags.update(0.05);
    env.clearFrameInput();

    expect(bags.secured).toBe(7);
    expect(bags.bonusSecured).toBe(3);
    expect(bags.carrying).toBe(false);
    expect(bags.turretMounted).toBe(true);
    expect(env.signals).toContain('bk:mount_turret');
    expect(env.player.modifiers.speed).toBe(1);

    bags.dispose();
  });

  it('cleanly resets dynamic bags, counters, pallets, and player speed modifier on clear()/reset()', () => {
    const env = makeBagsEnv();
    const bags = new LootBags(env.ctx, env.onSignal);
    bags.activate();

    packPallet(env, bags, 0);
    bags.throwBag();
    packPallet(env, bags, 1);
    expect(bags.carrying).toBe(true);
    expect(bags.dropped.length).toBe(1);
    expect(env.player.modifiers.speed).toBeCloseTo(BAG_CARRY_SPEED, 4);

    bags.reset();
    expect(bags.active).toBe(false);
    expect(bags.carrying).toBe(false);
    expect(bags.dropped.length).toBe(0);
    expect(bags.secured).toBe(0);
    expect(bags.bonusSecured).toBe(0);
    expect(bags.packedCount).toBe(0);
    expect(bags.humveeVisible).toBe(false);
    expect(env.player.modifiers.speed).toBe(1);

    bags.dispose();
  });

  it('spawns, syncs, void-recovers, and removes Rapier dynamic rigid bodies for thrown duffels', () => {
    const env = makeBagsEnv();
    const removedBodies: unknown[] = [];
    const createdBodies: { pos: { x: number; y: number; z: number }; setTranslation: ReturnType<typeof vi.fn> }[] = [];

    const mockDesc = () => ({
      setTranslation: vi.fn().mockReturnThis(),
      setLinvel: vi.fn().mockReturnThis(),
      setAngvel: vi.fn().mockReturnThis(),
      setLinearDamping: vi.fn().mockReturnThis(),
      setAngularDamping: vi.fn().mockReturnThis(),
      setCollisionGroups: vi.fn().mockReturnThis(),
      setRestitution: vi.fn().mockReturnThis(),
      setFriction: vi.fn().mockReturnThis(),
      setDensity: vi.fn().mockReturnThis(),
    });

    (env.ctx as unknown as { physics: unknown }).physics = {
      R: {
        RigidBodyDesc: { dynamic: vi.fn(() => mockDesc()) },
        ColliderDesc: { cuboid: vi.fn(() => mockDesc()) },
      },
      world: {
        createRigidBody: vi.fn(() => {
          const b = {
            pos: { x: 0, y: 1.5, z: 6 },
            translation() {
              return this.pos;
            },
            rotation() {
              return { x: 0, y: 0, z: 0, w: 1 };
            },
            setTranslation: vi.fn(function (this: { pos: { x: number; y: number; z: number } }, p: { x: number; y: number; z: number }) {
              this.pos = { ...p };
            }),
            setLinvel: vi.fn(),
            setAngvel: vi.fn(),
          };
          createdBodies.push(b);
          return b;
        }),
        createCollider: vi.fn(() => ({ handle: 42 })),
        removeRigidBody: vi.fn((b: unknown) => removedBodies.push(b)),
      },
    };

    const bags = new LootBags(env.ctx, env.onSignal);
    bags.activate();
    packPallet(env, bags, 0);

    const dropped = bags.throwBag()!;
    expect(createdBodies.length).toBe(1);
    expect(dropped.body).toBe(createdBodies[0]);

    // Simulate body falling into void (y < -6) -> teleported back to BANK_HUB via setTranslation
    createdBodies[0]!.pos = { x: 10, y: BAG_VOID_Y - 1, z: 10 };
    bags.update(0.05);
    expect(createdBodies[0]!.setTranslation).toHaveBeenCalled();
    expect(dropped.position.x).toBeCloseTo(BANK_HUB.x, 2);
    expect(dropped.position.z).toBeCloseTo(BANK_HUB.z, 2);

    // Clear removes the dynamic Rapier rigid body cleanly
    bags.clear();
    expect(removedBodies.length).toBe(1);
    expect(removedBodies[0]).toBe(createdBodies[0]);

    bags.dispose();
  });
});
