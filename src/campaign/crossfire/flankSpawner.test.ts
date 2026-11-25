/**
 * Tests for Mission 1 ("Crossfire — Valken Airbase") upgrades:
 *  - DynamicFlankSpawner anti-spawn-camp detection, LOS/proximity avoidance, friendly avoidance, and wave rerouting
 *  - Contractor A custom RAID_LOADOUT (Gimlet / Sawed-off Flechette Shotgun / Rivet / Satchel / Katana + exact mods)
 *  - Regression guard on valkenEscape formation contrails (prevents swapped color/size arguments blacking out screen)
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../core/events';
import type { Ctx, GameEvents } from '../../core/contracts';
import type { EnemyId, EnemyInstance, ModId } from '../../core/gameplay';
import { makeRange } from '../../weapons/testkit';
import { CROSSFIRE_AIRBASE } from '../missions/crossfireAirbase';
import type { MissionRunner } from '../runner';
import { validateMission } from '../validate';
import { AirbaseDirector } from './airbaseDirector';
import { AIRBASE_FLANK_POINTS, DynamicFlankSpawner, type FlankSpawnPoint } from './flankSpawner';

function makeSpawnerHarness(options: {
  playerPos?: [number, number, number];
  playerYaw?: number;
  blockedPointIds?: Set<string>;
  allies?: Array<{ alive: boolean; x: number; z: number }>;
  points?: readonly FlankSpawnPoint[];
} = {}) {
  const events = new EventBus<GameEvents>();
  const spawned: Array<{ uid: number; kind: EnemyId; position: THREE.Vector3; alive: boolean }> = [];
  let nextUid = 100;

  const playerPos = new THREE.Vector3(...(options.playerPos ?? [0, 0, 50]));
  const blocked = options.blockedPointIds ?? new Set<string>();
  const points = options.points ?? AIRBASE_FLANK_POINTS;

  const ctx = {
    events,
    player: {
      position: playerPos,
      yaw: options.playerYaw ?? 0,
    },
    physics: {
      // Returns true when world geometry blocks LOS between player and target
      raycastInto: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => {
        const endX = origin.x + dir.x * (maxDist + 0.6);
        const endZ = origin.z + dir.z * (maxDist + 0.6);
        for (const p of points) {
          if (Math.hypot(p.at[0] - endX, p.at[2] - endZ) < 2.5) {
            return blocked.has(p.id);
          }
        }
        return false;
      },
    },
    allies: {
      allies: (options.allies ?? []).map(a => ({
        alive: a.alive,
        body: { position: new THREE.Vector3(a.x, 0, a.z) },
      })),
    },
    enemies: {
      get alive() {
        return spawned.filter(e => e.alive);
      },
      spawn: (kind: EnemyId, pos: THREE.Vector3) => {
        const inst = {
          uid: nextUid++,
          kind,
          position: pos.clone(),
          alive: true,
        };
        spawned.push(inst);
        return inst as unknown as EnemyInstance;
      },
      outpost: {
        formSquad: vi.fn(),
      },
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

  const spawner = new DynamicFlankSpawner(ctx, points);
  return { spawner, ctx, events, spawned, playerPos };
}

describe('DynamicFlankSpawner (Mission 1 anti-spawn-camp multi-angle reinforcements)', () => {
  it('defines multi-angle points for all three combat sectors within Valken Airbase bounds', () => {
    const bySector = { apron: 0, tower: 0, hangar: 0 };
    for (const p of AIRBASE_FLANK_POINTS) {
      bySector[p.sector]++;
      expect(p.at[0]).toBeGreaterThanOrEqual(-120);
      expect(p.at[0]).toBeLessThanOrEqual(120);
      expect(p.at[2]).toBeGreaterThanOrEqual(-220);
      expect(p.at[2]).toBeLessThanOrEqual(140);
    }
    expect(bySector.apron).toBeGreaterThanOrEqual(5);
    expect(bySector.tower).toBeGreaterThanOrEqual(5);
    expect(bySector.hangar).toBeGreaterThanOrEqual(5);
  });

  it('rejects spawn points inside player forward LOS cone and picks concealed flanking angles', () => {
    const customPoints: readonly FlankSpawnPoint[] = [
      // Directly ahead of player looking north (-Z) with unobstructed LOS
      { id: 'front_exposed', sector: 'apron', label: 'Front Exposed', at: [0, 0, 10] },
      // Concealed flank to the east behind a building (blocked LOS)
      { id: 'east_concealed', sector: 'apron', label: 'East Concealed', at: [48, 0, 42] },
      // Too close to player (< 26m)
      { id: 'too_close', sector: 'apron', label: 'Too Close', at: [-10, 0, 45] },
    ];

    const { spawner } = makeSpawnerHarness({
      playerPos: [0, 0, 50],
      playerYaw: 0, // facing -Z
      blockedPointIds: new Set(['east_concealed']),
      points: customPoints,
    });

    const picked = spawner.pickBestPoint('apron');
    expect(picked?.def.id).toBe('east_concealed');
    spawner.dispose();
  });

  it('avoids spawn points camped by friendly infantry or friendly AI armor', () => {
    const customPoints: readonly FlankSpawnPoint[] = [
      { id: 'west_camped_by_infantry', sector: 'apron', label: 'West', at: [-50, 0, 50] },
      { id: 'north_camped_by_tank', sector: 'apron', label: 'North', at: [0, 0, 5] },
      { id: 'east_clear', sector: 'apron', label: 'East', at: [52, 0, 46] },
    ];

    const { spawner } = makeSpawnerHarness({
      playerPos: [0, 0, 95],
      playerYaw: 0,
      blockedPointIds: new Set(['west_camped_by_infantry', 'north_camped_by_tank', 'east_clear']),
      allies: [{ alive: true, x: -46, z: 52 }],
      points: customPoints,
    });
    spawner.setFriendlyVehiclePositions(() => [new THREE.Vector3(4, 0, 8)]);

    const picked = spawner.pickBestPoint('apron');
    expect(picked?.def.id).toBe('east_clear');
    spawner.dispose();
  });

  it('detects live spawn-camping on enemy:killed, cools down the camped point, and immediately reroutes remaining wave arrivals', () => {
    const customPoints: readonly FlankSpawnPoint[] = [
      { id: 'flank_a', sector: 'apron', label: 'Flank A', at: [-52, 0, 46] },
      { id: 'flank_b', sector: 'apron', label: 'Flank B', at: [52, 0, 46] },
      { id: 'flank_c', sector: 'apron', label: 'Flank C', at: [44, 0, 82] },
    ];

    const { spawner, events, spawned } = makeSpawnerHarness({
      playerPos: [0, 0, 50],
      playerYaw: 0,
      blockedPointIds: new Set(['flank_a', 'flank_b', 'flank_c']),
      points: customPoints,
    });

    spawner.setSector('apron', 0.5);
    // Advance past initial delay -> queues wave at first best point and spawns seat 0 on the next tick
    spawner.update(0.6);
    spawner.update(0.1);
    expect(spawned.length).toBe(1);

    const firstSoldier = spawned[0]!;
    const initialPointId = spawner.state.lastPickedId!;
    expect(initialPointId).toBeTruthy();

    // Instantly spawn-camp that first soldier right at its spawn point (< 6s and < 12m)
    firstSoldier.alive = false;
    events.emit('enemy:killed', {
      enemy: firstSoldier as unknown as EnemyInstance,
    } as Parameters<typeof events.emit<'enemy:killed'>>[1]);

    // Camped point must immediately enter cooldown and remaining wave troops must reroute to another point!
    expect(spawner.state.totalCampEvents).toBe(1);
    expect(spawner.state.campedPointIds).toContain(initialPointId);
    const reroutedPointId = spawner.state.lastPickedId!;
    expect(reroutedPointId).not.toBe(initialPointId);

    // Drain next staggered arrival and verify it spawns at the NEW flanking angle, not the camped one!
    spawner.update(0.35);
    expect(spawned.length).toBe(2);
    const secondSoldier = spawned[1]!;
    const campedDef = customPoints.find(p => p.id === initialPointId)!;
    const newDef = customPoints.find(p => p.id === reroutedPointId)!;
    const distToCamped = Math.hypot(secondSoldier.position.x - campedDef.at[0], secondSoldier.position.z - campedDef.at[2]);
    const distToNew = Math.hypot(secondSoldier.position.x - newDef.at[0], secondSoldier.position.z - newDef.at[2]);
    expect(distToNew).toBeLessThan(5);
    expect(distToCamped).toBeGreaterThan(20);

    spawner.dispose();
  });

  it('rotates consecutive waves across multiple distinct flanking angles', () => {
    const customPoints: readonly FlankSpawnPoint[] = [
      { id: 'angle_1', sector: 'hangar', label: 'Angle 1', at: [-50, 0, -50] },
      { id: 'angle_2', sector: 'hangar', label: 'Angle 2', at: [50, 0, -50] },
      { id: 'angle_3', sector: 'hangar', label: 'Angle 3', at: [10, 0, -105] },
    ];

    const { spawner } = makeSpawnerHarness({
      playerPos: [0, 0, -50],
      playerYaw: 0,
      blockedPointIds: new Set(['angle_1', 'angle_2', 'angle_3']),
      points: customPoints,
    });

    spawner.setSector('hangar', 0.5);
    const pickedOrder: string[] = [];
    let last = '';
    for (let step = 0; step < 90; step++) {
      spawner.update(0.5);
      const cur = spawner.state.lastPickedId ?? '';
      if (cur && cur !== last) {
        pickedOrder.push(cur);
        last = cur;
      }
    }
    expect(new Set(pickedOrder).size).toBeGreaterThanOrEqual(2);
    spawner.dispose();
  });
});

describe('Mission 1 Contractor A custom RAID_LOADOUT', () => {
  it('validates CROSSFIRE_AIRBASE with zero mission schema warnings/errors', () => {
    expect(validateMission(CROSSFIRE_AIRBASE)).toEqual([]);
  });

  it('equips Gimlet, Sawed-Off Flechette Shotgun, Satchel, Rivet, Katana, 4 grenades, and all 15 exact mods (no ACOG, no Shotgun LAM)', async () => {
    const r = await makeRange();
    r.reset();

    const loadout = CROSSFIRE_AIRBASE.loadout;
    expect(loadout.weapons).toEqual(['gimlet', 'shotgun', 'satchel', 'rivet', 'sword']);
    expect(loadout.grenades).toBe(4);
    expect(loadout.exclusiveMods).toBe(true);

    r.weapons.setLoadout(loadout.weapons, loadout.grenades, {
      mods: loadout.mods,
      exclusiveMods: loadout.exclusiveMods,
    });

    const expectedMods: readonly ModId[] = [
      'gimletShort', 'gimletCan', 'gimletMagwell', 'gimletLam', 'gimletDot',
      'shotgunSawedOff', 'shotgunFlechette', 'shotgunDot', 'shotgunLight',
      'rivetCan', 'rivetDot', 'rivetAp', 'rivetMag', 'rivetMagwell', 'rivetLam',
    ];

    for (const w of ['gimlet', 'shotgun', 'satchel', 'rivet', 'sword'] as const) {
      expect(r.weapons.owned.has(w), `weapon ${w}`).toBe(true);
    }
    expect(r.weapons.grenades).toBe(4);
    expect(r.weapons.current).toBe('gimlet');

    for (const m of expectedMods) {
      expect(r.weapons.fitted.has(m), `mod ${m}`).toBe(true);
    }
    expect(r.weapons.fitted.size).toBe(expectedMods.length);
    // Explicitly excluded defaults/extras:
    expect(r.weapons.fitted.has('gimletAcog')).toBe(false);
    expect(r.weapons.fitted.has('shotgunLam')).toBe(false);
  });
});

describe('valkenEscape cutscene contrail smoke regression', () => {
  it('passes valid RGB color and small contrail radius to fx.smoke (never swapped color/size)', () => {
    const events = new EventBus<GameEvents>();
    const smokeCalls: Array<{ color: unknown; size: unknown; seconds: unknown }> = [];
    const scene = new THREE.Scene();

    const mat = new THREE.MeshStandardMaterial();
    const ctx = {
      events,
      render: {
        scene,
        viewScene: new THREE.Scene(),
        renderer: { domElement: { style: {} } },
        materials: {
          patch: <T,>(m: T) => m,
          world: () => mat,
          trim: () => mat,
          glass: () => mat,
          metal: () => mat,
          matte: () => mat,
          emissive: () => mat,
          get: () => mat,
        },
        post: { setGrade: vi.fn(), setSpeed: vi.fn(), pulse: vi.fn() },
      },
      player: {
        position: new THREE.Vector3(62, 36, -220),
        yaw: Math.PI,
        teleport: vi.fn(),
      },
      weapons: { setHolstered: vi.fn() },
      hud: { feed: vi.fn() },
      fx: {
        smoke: (_pos: THREE.Vector3, color?: THREE.ColorRepresentation, size?: number, seconds?: number) => {
          smokeCalls.push({ color, size, seconds });
        },
      },
      progression: {},
      physics: { addStaticBox: vi.fn(), removeBody: vi.fn() },
      allies: { allies: [] },
      enemies: { alive: [] },
    } as unknown as Ctx;

    const runner = { flag: vi.fn() } as unknown as MissionRunner;
    const director = new AirbaseDirector(ctx, runner);
    director.call('cf.airbaseEscapeCutscene');
    director.update(0.12);

    expect(smokeCalls.length).toBeGreaterThanOrEqual(3);
    for (const call of smokeCalls) {
      expect(typeof call.color).toBe('number');
      expect(call.color as number).toBeGreaterThanOrEqual(0x808080);
      expect(typeof call.size).toBe('number');
      expect(call.size as number).toBeGreaterThan(0.1);
      expect(call.size as number).toBeLessThan(5);
      expect(typeof call.seconds).toBe('number');
      expect(call.seconds as number).toBeGreaterThan(0.1);
      expect(call.seconds as number).toBeLessThan(3);
    }

    director.reset();
  });
});
