/**
 * Badlands Mode unit & integration tests:
 * - Verifies contract, shop, starter, main menu, and map registration (`noCommander: true`, `atmosphere: 'dawn'`)
 * - Verifies high human-per-wave counts (26 on Wave 1, strictly between 20–30, scaling +6/wave up to 96)
 * - Verifies ALL hostile vehicle types spawn across Waves 1–5 (humvee, truck, tank, fast-rope transport,
 *   paratrooper jet, doorGunner, attack chopper) plus ground boss rotation (Juggernaut, Titan, both)
 * - Verifies accurate `manager.queued` accounting, active-vehicle wave-clear gating, and clean wave clear
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CONTRACTS } from '../../contracts/data';
import { pickContract } from '../../contracts/select';
import { SHOP_CONTRACTS } from '../../contracts/shop/data';
import { defaultStarter, hasStarter } from '../../contracts/starter';
import type { Ctx } from '../../core/contracts';
import type { EnemyId } from '../../core/gameplay';
import { mulberry32 } from '../../core/math';
import { modesOn, SURVIVAL_MAPS } from '../../ui/screens/mainmenu';
import type { Enemy } from '../Enemy';
import type { EnemyManager } from '../EnemyManager';
import type { Outpost } from '../outpost';
import { waveStrength as outpostWaveStrength } from '../outpost/doctrine';
import { EnemyChopper } from '../vehicles/chopper';
import { EnemyDoorGunner } from '../vehicles/doorGunner';
import { GroundVehicle, type GroundOrder } from '../vehicles/ground';
import type { GroundVehicleKind, VehicleSystem } from '../vehicles/index';
import { FastRopeHeli } from '../vehicles/transport';
import {
  BADLANDS_FIRST_WAVE,
  BADLANDS_MAX_HOSTILE,
  BADLANDS_MAX_STRENGTH,
  badlandsAirSupportForWave,
  badlandsBossForWave,
  badlandsTankCount,
  badlandsWaveStrength,
  BadlandsWaves,
  composeBadlandsWave,
} from './waves';

function makeHarness() {
  const scene = new THREE.Scene();
  const feeds: string[] = [];
  const events: { name: string; payload: unknown }[] = [];
  const markedTags = new Set<string>();
  const spawnedGround: { kind: GroundVehicleKind; order: GroundOrder }[] = [];
  const spawnedBosses: EnemyId[] = [];
  const liveVehicles: Array<{
    alive: boolean;
    retired: boolean;
    position: THREE.Vector3;
    def: { kind: string };
    crewAboard?: number;
    hasActivePayload?: boolean;
    onboardCount?: number;
    settled?: boolean;
    canDrive?: boolean;
    drive?: { reroute: ReturnType<typeof vi.fn> };
  }> = [];

  const makeEnemy = (id: EnemyId, at: THREE.Vector3): Enemy => ({
    id,
    alive: true,
    pinned: false,
    airborne: false,
    downed: false,
    mode: 'hold',
    face: 'player',
    yaw: 0,
    health: 100,
    maxHealth: 100,
    groundY: at.y,
    verticalSpeed: 0,
    position: at.clone(),
    center: at.clone(),
    velocity: new THREE.Vector3(),
    groundSampleAt: new THREE.Vector2(at.x, at.z),
    char: { anim: { play: vi.fn() } },
  } as unknown as Enemy);

  const ctx = {
    time: { dt: 0.2, elapsed: 0 },
    render: {
      scene,
      materials: { patch: <T>(m: T) => m },
      lights: { flash: vi.fn() },
      decals: { add: vi.fn() },
    },
    audio: {
      play: vi.fn(),
      music: vi.fn(),
      startLoop: () => ({ stop: vi.fn(), setPosition: vi.fn(), setPitch: vi.fn(), setVolume: vi.fn() }),
    },
    hud: {
      feed: (t: string) => feeds.push(t),
      floatText: vi.fn(),
      follow: () => vi.fn(),
    },
    events: {
      emit: (name: string, payload: unknown) => events.push({ name, payload }),
      on: vi.fn(),
    },
    player: {
      alive: true,
      position: new THREE.Vector3(0, 0, 10),
    },
    world: {
      nav: {
        nearest: (p: THREE.Vector3, _r: number, out: THREE.Vector3) => {
          out.copy(p);
          return true;
        },
      },
    },
  } as unknown as Ctx;

  const alive: Enemy[] = [];
  const manager = {
    alive,
    queued: 0,
    fieldCleared: false,
    bossDying: false,
    setWave: vi.fn(),
    spawn: (id: EnemyId, at: THREE.Vector3) => {
      const e = makeEnemy(id, at);
      alive.push(e);
      return e;
    },
    spawnBoss: (id: EnemyId, at: THREE.Vector3) => {
      spawnedBosses.push(id);
      const e = makeEnemy(id, at);
      alive.push(e);
      return e;
    },
    vehicles: null as unknown as VehicleSystem,
  } as unknown as EnemyManager;

  const vehicles = {
    live: liveVehicles,
    target: (tag: string) => markedTags.add(tag),
    spawnGround: (kind: GroundVehicleKind, order: GroundOrder) => {
      spawnedGround.push({ kind, order });
      const stub = Object.create(GroundVehicle.prototype) as Record<string, unknown>;
      Object.assign(stub, {
        alive: true,
        retired: false,
        position: new THREE.Vector3(order.x, order.y, order.z),
        def: { kind },
        drive: { reroute: vi.fn() },
      });
      let aboard = order.crew.length;
      Object.defineProperties(stub, {
        settled: { get: () => false, configurable: true },
        canDrive: { get: () => true, configurable: true },
        crewAboard: {
          get: () => aboard,
          set: (v: number) => { aboard = v; },
          configurable: true,
        },
      });
      liveVehicles.push(stub as unknown as typeof liveVehicles[number]);
      return stub;
    },
    spawnTransport: (_from: THREE.Vector3, lz: THREE.Vector3, _hoverY: number, squad: readonly EnemyId[]) => {
      const stub = Object.create(FastRopeHeli.prototype) as Record<string, unknown>;
      let onboard = squad.length;
      Object.assign(stub, {
        alive: true,
        retired: false,
        position: lz.clone(),
        def: { kind: 'transport' },
      });
      Object.defineProperty(stub, 'onboardCount', { get: () => onboard, set: (v: number) => { onboard = v; } });
      Object.defineProperty(stub, 'hasActivePayload', { get: () => onboard > 0 });
      liveVehicles.push(stub as unknown as typeof liveVehicles[number]);
      return stub;
    },
    spawnChopper: (from: THREE.Vector3) => {
      const stub = Object.create(EnemyChopper.prototype) as Record<string, unknown>;
      Object.assign(stub, { alive: true, retired: false, position: from.clone(), def: { kind: 'chopper' } });
      liveVehicles.push(stub as unknown as typeof liveVehicles[number]);
      return stub;
    },
    spawnDoorGunner: (from: THREE.Vector3) => {
      const stub = Object.create(EnemyDoorGunner.prototype) as Record<string, unknown>;
      Object.assign(stub, { alive: true, retired: false, position: from.clone(), def: { kind: 'doorGunner' } });
      liveVehicles.push(stub as unknown as typeof liveVehicles[number]);
      return stub;
    },
  } as unknown as VehicleSystem;
  (manager as unknown as { vehicles: VehicleSystem }).vehicles = vehicles;

  const outpost = {
    get hostile() {
      return alive.filter(e => e.alive).length;
    },
    onWaveStart: vi.fn(),
    muster: () => ({ members: [] }),
    enlistInto: (_sq: unknown, id: EnemyId, at: THREE.Vector3) => {
      const e = makeEnemy(id, at);
      alive.push(e);
      return e;
    },
  } as unknown as Outpost;

  return { ctx, manager, outpost, alive, liveVehicles, markedTags, spawnedGround, spawnedBosses, feeds, events };
}

describe('Badlands contract, shop, starter & menu registration', () => {
  it('registers badlands as an unlocked endless human survival mode with no Commander', () => {
    const def = CONTRACTS.find(c => c.id === 'badlands');
    expect(def).toBeDefined();
    expect(def!.map).toBe('badlands');
    expect(def!.faction).toBe('humans');
    expect(def!.waves).toBe('squads');
    expect(def!.ai).toBe('outpost');
    expect(def!.noCommander).toBe(true);
    expect(def!.mission).toBeUndefined();
    expect(def!.locked).toBeUndefined();

    expect(pickContract('badlands', null).map).toBe('badlands');
    expect(pickContract(null, 'badlands').def.id).toBe('badlands');
    expect(SHOP_CONTRACTS).toContain('badlands');
    expect(hasStarter('badlands')).toBe(true);
    expect(defaultStarter('badlands')).toBe('harrow');
    expect(SURVIVAL_MAPS.some(m => m.map === 'badlands')).toBe(true);
    expect(modesOn('badlands').map(c => c.id)).toEqual(['badlands']);
  });
});

describe('Badlands wave scaling and vehicle escalation', () => {
  it('starts between 20 and 30 humans on Wave 1 and scales far higher than Endless Humans', () => {
    expect(BADLANDS_FIRST_WAVE).toBeGreaterThanOrEqual(20);
    expect(BADLANDS_FIRST_WAVE).toBeLessThanOrEqual(30);
    expect(badlandsWaveStrength(1)).toBe(26);
    expect(badlandsWaveStrength(1)).toBeGreaterThan(outpostWaveStrength(1) * 3);
    expect(badlandsWaveStrength(2)).toBe(32);
    expect(badlandsWaveStrength(5)).toBe(50);
    expect(badlandsWaveStrength(10)).toBe(80);
    expect(badlandsWaveStrength(20)).toBe(BADLANDS_MAX_STRENGTH);
    expect(BADLANDS_MAX_HOSTILE).toBe(36);

    const rng = mulberry32(42);
    for (let w = 1; w <= 12; w++) {
      const deliveries = composeBadlandsWave(w, rng);
      const sum = deliveries.reduce((n, d) => n + d.men.length, 0);
      expect(sum, `Wave ${w} human count mismatch`).toBe(badlandsWaveStrength(w));
    }
  });

  it('includes technicals, trucks, fast-rope helis, tanks, paratroopers, door gunners, attack choppers, and boss rotation', () => {
    const rng = mulberry32(7);
    const w1Kinds = new Set(composeBadlandsWave(1, rng).map(d => d.kind));
    expect(w1Kinds).toEqual(new Set(['humvee', 'truck', 'heli']));

    const w2Kinds = new Set(composeBadlandsWave(2, rng).map(d => d.kind));
    expect(w2Kinds).toEqual(new Set(['humvee', 'truck', 'heli', 'paratrooper']));

    expect(badlandsTankCount(1)).toBe(0);
    expect(badlandsTankCount(2)).toBe(1);
    expect(badlandsTankCount(4)).toBe(2);
    expect(badlandsTankCount(5)).toBe(3);

    expect(badlandsAirSupportForWave(1)).toEqual([]);
    expect(badlandsAirSupportForWave(2)).toEqual(['doorGunner']);
    expect(badlandsAirSupportForWave(3)).toEqual(['chopper']);
    expect(badlandsAirSupportForWave(5)).toEqual(['chopper']);
    expect(badlandsAirSupportForWave(6)).toEqual(['doorGunner', 'chopper']);

    expect(badlandsBossForWave(4)).toEqual([]);
    expect(badlandsBossForWave(5)).toEqual(['juggernaut']);
    expect(badlandsBossForWave(10)).toEqual(['titan']);
    expect(badlandsBossForWave(15)).toEqual(['juggernaut', 'titan']);
    expect(badlandsBossForWave(20)).toEqual(['juggernaut']);
  });
});

describe('BadlandsWaves live orchestration', () => {
  it('dispatches all vehicle classes across waves 1–5, tracks queued accurately, and gates clear on live vehicles', () => {
    const h = makeHarness();
    const waves = new BadlandsWaves(h.ctx, h.outpost, h.manager);
    waves.start();

    const step = (seconds: number) => {
      const steps = Math.ceil(seconds / h.ctx.time.dt);
      for (let i = 0; i < steps; i++) {
        h.ctx.time.elapsed += h.ctx.time.dt;
        waves.update();
      }
    };

    const flushWave = () => {
      // Advance enough time for all ground deliveries, tanks, air support, and bosses to launch.
      for (let round = 0; round < 20; round++) {
        step(4);
        // Simulate vehicle crews dismounting & paratroopers landing, then player killing all ground infantry
        for (const v of h.liveVehicles) {
          if (v instanceof GroundVehicle && v.crewAboard > 0) {
            h.manager.queued = Math.max(0, h.manager.queued - v.crewAboard);
            (v as unknown as { crewAboard: number }).crewAboard = 0;
          }
          if (v instanceof FastRopeHeli && v.onboardCount > 0) {
            h.manager.queued = Math.max(0, h.manager.queued - v.onboardCount);
            (v as unknown as { onboardCount: number }).onboardCount = 0;
          }
        }
        for (const e of h.alive) e.alive = false;
        h.alive.length = 0;
        // Destroy vehicles except leave one briefly on Wave 1 to test clear gating
        if (round >= 6) {
          for (const v of h.liveVehicles) {
            v.alive = false;
            v.retired = true;
          }
          h.liveVehicles.length = 0;
        }
        if (waves.phase === 'intermission') break;
      }
    };

    // Wave 1: starts after 3 s delay, spawns humvee + truck + fast-rope heli, marks HUD tags
    step(3.4);
    expect(waves.wave).toBe(1);
    expect(h.markedTags).toEqual(new Set(['badlands_humvee', 'badlands_truck', 'badlands_tank', 'badlands_chopper', 'badlands_gunner']));
    expect(h.manager.queued).toBe(26);

    // Every ground vehicle spawned with waveQueued: true & maxHostile: 36
    step(15);
    expect(h.spawnedGround.length).toBeGreaterThanOrEqual(2);
    for (const g of h.spawnedGround) {
      expect(g.order.waveQueued).toBe(true);
      expect(g.order.maxHostile).toBe(BADLANDS_MAX_HOSTILE);
    }

    // Even when all infantry are dead, an active live vehicle prevents premature wave clear
    for (const v of h.liveVehicles) {
      if (v instanceof GroundVehicle) {
        h.manager.queued = Math.max(0, h.manager.queued - v.crewAboard);
        (v as unknown as { crewAboard: number }).crewAboard = 0;
      }
      if (v instanceof FastRopeHeli) {
        h.manager.queued = Math.max(0, h.manager.queued - v.onboardCount);
        (v as unknown as { onboardCount: number }).onboardCount = 0;
      }
    }
    for (const e of h.alive) e.alive = false;
    h.alive.length = 0;
    step(1);
    expect(waves.phase).not.toBe('intermission');

    // Finish Wave 1 through Wave 5 and verify every vehicle type in the game appeared
    flushWave();
    expect(waves.phase).toBe('intermission');
    expect(h.manager.queued).toBe(0);

    for (let targetWave = 2; targetWave <= 5; targetWave++) {
      waves.jumpTo(targetWave);
      step(0.4);
      expect(waves.wave).toBe(targetWave);
      flushWave();
      expect(waves.phase).toBe('intermission');
      expect(h.manager.queued).toBe(0);
    }

    const seen = new Set(waves.spawnedVehicles);
    expect(seen.has('humvee')).toBe(true);
    expect(seen.has('truck')).toBe(true);
    expect(seen.has('tank')).toBe(true);
    expect(seen.has('transport')).toBe(true);
    expect(seen.has('paratrooper_jet')).toBe(true);
    expect(seen.has('doorGunner')).toBe(true);
    expect(seen.has('chopper')).toBe(true);
    expect(h.spawnedBosses).toContain('juggernaut');
  });
});
