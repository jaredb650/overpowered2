import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ctx, GameEvents } from '../../core/contracts';
import { EventBus } from '../../core/events';
import { AIRBASE_ATC_CONSOLE, AIRBASE_DESTRUCTIBLES, AIRBASE_TAKEOFF_GATE } from '../../world/map/airbase/plan';
import { HALCYON_CITADEL_HQ_POS, HALCYON_TARGETS } from '../../world/map/halcyon/targets';
import { STRAIT_CARRIER_RECOVERY_Z, STRAIT_FEET_DRY_Z } from '../../world/map/strait/plan';
import { CROSSFIRE_AIRBASE } from '../missions/crossfireAirbase';
import { CROSSFIRE_HALCYON } from '../missions/crossfireHalcyon';
import { CROSSFIRE_RETURN } from '../missions/crossfireReturn';
import { CROSSFIRE_STRAIT } from '../missions/crossfireStrait';
import type { MissionRunner } from '../runner';
import {
  CROSSFIRE_CALLS,
  CROSSFIRE_CHAIN_KEY,
  CROSSFIRE_DEFAULT_LANCER_MAX_HP,
  CROSSFIRE_SIGNALS,
  clearChainState,
  loadChainState,
} from './chain';
import { CrossfireDirector } from './director';

function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
}

interface MockDriveable {
  def: { id: string; maxHealth: number };
  health: number;
  alive: boolean;
  occupied: boolean;
  phys: {
    grounded: boolean;
    groundY: number;
    altitude: number;
    vtolMode: boolean;
    airThrottle: number;
    speed: number;
    position: THREE.Vector3;
    velocity: THREE.Vector3;
  };
  refilledMode: number | null;
  board: (seat?: number) => void;
  refillOrdnance: (mode?: number) => void;
}

function makeHarness(missionId: string) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x88aacc);
  scene.fog = new THREE.FogExp2(0x99bbdd, 0.001);

  const events = new EventBus<GameEvents>();
  const signals: string[] = [];
  const downSpy = vi.fn();
  const spawnedDriveables: MockDriveable[] = [];
  const spawnedEnemyOrders: { kind: string; tag: string }[] = [];
  const spawnedAllies: string[] = [];
  const extraTargets = new Set<unknown>();
  let friendlyVehiclesProvider: unknown = null;
  let interactPressed = false;
  const playerPos = new THREE.Vector3(0, 0, 142);

  const driveables = {
    active: null as MockDriveable | null,
    clear: vi.fn(() => {
      spawnedDriveables.length = 0;
      driveables.active = null;
    }),
    spawn: vi.fn((id: string, pos: THREE.Vector3, _yaw: number) => {
      const veh: MockDriveable = {
        def: { id, maxHealth: id === 'lancer' ? 2800 : 1400 },
        health: id === 'lancer' ? 2800 : 1400,
        alive: true,
        occupied: false,
        phys: {
          grounded: true,
          groundY: 0,
          altitude: pos.y,
          vtolMode: true,
          airThrottle: 0,
          speed: 0,
          position: pos.clone(),
          velocity: new THREE.Vector3(),
        },
        refilledMode: null,
        board: vi.fn(() => {
          veh.occupied = true;
          driveables.active = veh;
        }),
        refillOrdnance: (mode?: number) => {
          veh.refilledMode = mode ?? null;
        },
      };
      spawnedDriveables.push(veh);
      return veh;
    }),
  };

  const mockStructures: { stage: string }[] = Array.from({ length: 40 }, () => ({ stage: 'intact' }));
  const mockClusters = new Map<string, { collapsed: boolean; destroyedFraction: number }>();

  const ctx = {
    events,
    render: {
      scene,
      materials: {
        patch: <T extends THREE.Material>(m: T) => m,
      },
    },
    physics: {
      addStaticBox: vi.fn(() => ({
        handle: Math.floor(Math.random() * 100_000),
        setTranslation: vi.fn(),
        setRotation: vi.fn(),
      })),
      world: { removeCollider: vi.fn() },
    },
    world: {
      nav: { groundHeight: () => 0 },
      objects: {
        structures: mockStructures,
        destruction: {
          getCluster: (id: string) => mockClusters.get(id),
        },
        blastHandler: null as ((at: THREE.Vector3, radius: number, damage: number, source: string) => void) | null,
      },
    },
    player: {
      alive: true,
      parked: false,
      position: playerPos,
      velocity: new THREE.Vector3(),
      teleport: vi.fn((pos: THREE.Vector3) => { playerPos.copy(pos); }),
    },
    input: {
      labelFor: () => 'E',
      pressed: (action: string) => action === 'interact' && interactPressed,
    },
    hud: {
      feed: vi.fn(),
      callout: vi.fn(),
      follow: vi.fn(() => vi.fn()),
      marker: vi.fn(() => vi.fn()),
      hitMarker: vi.fn(),
    },
    fx: {
      explosion: vi.fn(),
      smoke: vi.fn(),
      sparks: vi.fn(),
      tracer: vi.fn(),
      muzzleFlash: vi.fn(),
      attachEmitter: vi.fn(() => ({ stop: vi.fn() })),
    },
    audio: {
      play: vi.fn(),
    },
    progression: {
      score: 4200,
      kills: 19,
      award: vi.fn(),
      driveables,
    },
    allies: {
      allies: [],
      spawn: vi.fn((type: string) => {
        spawnedAllies.push(type);
        return { alive: true, body: { position: new THREE.Vector3(), velocity: new THREE.Vector3() } };
      }),
    },
    enemies: {
      alive: [],
      query: vi.fn(() => 0),
      applyDamage: vi.fn(),
      vehicles: {
        live: [],
        addExtra: vi.fn((e: unknown) => { extraTargets.add(e); }),
        removeExtra: vi.fn((e: unknown) => { extraTargets.delete(e); }),
        setFriendlyVehicles: vi.fn((p: unknown) => { friendlyVehiclesProvider = p; }),
        order: vi.fn((order: { kind: string; tag: string }) => {
          spawnedEnemyOrders.push({ kind: order.kind, tag: order.tag });
        }),
        blast: vi.fn(),
      },
    },
  } as unknown as Ctx;

  const missionsById = {
    crossfire_airbase: CROSSFIRE_AIRBASE,
    crossfire_strait: CROSSFIRE_STRAIT,
    crossfire_halcyon: CROSSFIRE_HALCYON,
    crossfire_return: CROSSFIRE_RETURN,
  } as const;
  const mission = missionsById[missionId as keyof typeof missionsById] ?? CROSSFIRE_AIRBASE;

  const runner = {
    mission,
    elapsed: 120,
    deaths: 0,
    signal: vi.fn((name: string) => { signals.push(name); }),
    down: downSpy,
  } as unknown as MissionRunner;

  const director = new CrossfireDirector(ctx, runner);

  return {
    ctx,
    events,
    runner,
    director,
    signals,
    downSpy,
    driveables,
    spawnedDriveables,
    spawnedEnemyOrders,
    spawnedAllies,
    extraTargets,
    mockStructures,
    mockClusters,
    getFriendlyVehiclesProvider: () => friendlyVehiclesProvider,
    setInteractPressed: (v: boolean) => { interactPressed = v; },
    setPlayerPos: (x: number, y: number, z: number) => { playerPos.set(x, y, z); },
  };
}

describe('CrossfireDirector & all 23 cf.* calls', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', createMemoryStorage());
    vi.stubGlobal('localStorage', createMemoryStorage());
    clearChainState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('handles every single documented cf.* call in CROSSFIRE_CALLS with zero unhandled warnings', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = makeHarness('crossfire_airbase');

    const callArgs: Record<string, string | undefined> = {
      'cf.straitWave': 'outbound_probe',
    };

    expect(CROSSFIRE_CALLS.size).toBe(23);
    for (const callName of CROSSFIRE_CALLS) {
      const handled = h.director.call(callName, callArgs[callName]);
      expect(handled, `Expected ${callName} to be handled`).toBe(true);
    }

    const unhandledWarns = warnSpy.mock.calls.filter(args => String(args[0]).includes('unhandled call'));
    expect(unhandledWarns).toEqual([]);

    h.director.reset();
    warnSpy.mockRestore();
  });

  it('Part 1 (Valken Airbase): fuel watch, ATC override, buddy Raptors, Lancer unlock/takeoff & Strait handoff', () => {
    const h = makeHarness('crossfire_airbase');
    h.director.ensureBuilt();

    // 1. Init stages locked Lancer + 2 parked Raptors + Part 1 chain state
    expect(h.director.call('cf.airbaseInit')).toBe(true);
    expect(loadChainState()?.part).toBe(1);
    expect(loadChainState()?.contractor).toBe('A');
    expect(h.director.airbase.state.parkedRaptorCount).toBe(2);

    // 2. Fuel apron blast signals cf:fuel_blown
    h.director.call('cf.apronFuelWatch');
    const fuelDepot = AIRBASE_DESTRUCTIBLES.find(d => d.kind === 'fuelDepot')!;
    h.events.emit('combat:explosion', {
      position: new THREE.Vector3(fuelDepot.x, 1, fuelDepot.z),
      radius: 10,
      damage: 400,
    });
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.fuelBlown);

    // 3. ATC Override console reacts to [E] interact when player stands at Level 3 console
    h.director.call('cf.atcConsole');
    h.setPlayerPos(AIRBASE_ATC_CONSOLE.at[0], AIRBASE_ATC_CONSOLE.at[1], AIRBASE_ATC_CONSOLE.at[2]);
    h.setInteractPressed(true);
    h.director.update(0.1);
    h.setInteractPressed(false);
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.atcOverrideDone);

    // 4. Buddy Raptors spool up -> cf:raptors_spooled
    h.director.call('cf.buddyRaptorsBoard');
    h.director.update(3.2);
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.raptorsSpooled);

    // 5. Unlock Lancer -> board -> buddy Raptors launch -> climb past takeoff gate
    h.director.call('cf.lancerReady');
    expect(h.spawnedDriveables.length).toBe(1);
    const lancer = h.spawnedDriveables[0]!;
    expect(lancer.def.id).toBe('lancer');
    lancer.board(0);
    h.director.update(0.1);
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.lancerBoarded);

    h.director.call('cf.buddyRaptorsTakeoff');
    expect(h.director.airbase.state.parkedRaptorCount).toBe(0);
    expect(h.director.airbase.state.alliedAirborneCount).toBe(2);

    lancer.phys.position.set(40, AIRBASE_TAKEOFF_GATE.minAltitudeY + 12, AIRBASE_TAKEOFF_GATE.northZ - 15);
    h.director.update(0.1);
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.lancerAirborne);

    // 6. Handoff persists Part 2 Contractor B chain state
    h.director.call('cf.handoffToStrait');
    const saved = loadChainState();
    expect(saved?.part).toBe(2);
    expect(saved?.contractor).toBe('B');
    expect(saved?.lancerHp).toBe(CROSSFIRE_DEFAULT_LANCER_MAX_HP);

    h.director.reset();
  });

  it('Part 2 (The Strait Outbound): escort spawn, waves, destroyers suppression, feet-dry & Halcyon handoff', () => {
    const h = makeHarness('crossfire_strait');
    h.director.ensureBuilt();

    // 1. Outbound init spawns airborne Raptor, 7,500 HP Lancer & 2 wingmen
    h.director.call('cf.straitOutboundInit');
    expect(h.spawnedDriveables[0]?.def.id).toBe('raptor');
    expect(h.spawnedDriveables[0]?.phys.grounded).toBe(false);
    expect(h.spawnedDriveables[0]?.occupied).toBe(true);
    expect(h.director.strait.lancer?.maxHealth).toBe(CROSSFIRE_DEFAULT_LANCER_MAX_HP);
    expect(h.director.strait.state.allyCount).toBe(3); // 1 Lancer + 2 F-22 wingmen

    // 2. Spawn outbound_probe (3 Hornets) and shred -> signals cf:wave_cleared_outbound_probe
    h.director.call('cf.straitWave', 'outbound_probe');
    expect(h.director.strait.state.enemyCount).toBe(3);
    h.director.strait.airWingInstance!.shredWave('outbound_probe');
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.waveClearedOutboundProbe);

    // 3. Destroyers hot (8 turrets) + destroyer_strike (3 Harriers + 2 Warthogs = 5)
    h.director.call('cf.straitDestroyersHot');
    h.director.call('cf.straitWave', 'destroyer_strike');
    expect(h.director.strait.defenseSystem!.totalCount).toBe(8);
    expect(h.director.strait.state.enemyCount).toBe(5);

    // Knock out all 4 destroyer SAM mounts -> cf:destroyers_suppressed
    for (const sam of h.director.strait.defenseSystem!.getSitesByKind('destroyer_sam')) {
      h.director.strait.defenseSystem!.damageSite(sam.id, 9999);
    }
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.destroyersSuppressed);

    h.director.strait.airWingInstance!.shredWave('destroyer_strike');
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.waveClearedDestroyerStrike);

    // 4. Coastal Aces (1 Ace Raptor + 3 Hornets) + feet-dry crossing -> cf:strait_feet_dry
    h.director.call('cf.straitWave', 'coastal_aces');
    expect(h.director.strait.state.enemyCount).toBe(4);
    h.director.call('cf.straitFeetDryWatch');
    h.director.strait.airWingInstance!.shredWave('coastal_aces');
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.waveClearedCoastalAces);

    // Move Lancer across STRAIT_FEET_DRY_Z
    h.director.strait.lancer!.position.set(0, 120, STRAIT_FEET_DRY_Z - 5);
    h.director.update(0.1);
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.straitFeetDry);

    // 5. Handoff to Halcyon saves Part 3 Contractor A state
    h.director.call('cf.handoffToHalcyon');
    const chain = loadChainState();
    expect(chain?.part).toBe(3);
    expect(chain?.contractor).toBe('A');

    h.director.reset();
  });

  it('Part 3 (Fortress Halcyon): breach gates, ridge mortars/SAMs, Valkyrie drop, war machine, thermobaric HQ & leveled', () => {
    const h = makeHarness('crossfire_halcyon');
    h.director.ensureBuilt();

    // 1. Halcyon init spawns airborne Lancer, Mercer armor (gates closed) + Kestrel, 2 escorts & 2 initial flak towers
    h.director.call('cf.halcyonInit');
    expect(h.spawnedDriveables[0]?.def.id).toBe('lancer');
    expect(h.spawnedDriveables[0]?.phys.grounded).toBe(false);
    expect(h.director.halcyon.vehicleFleet!.units.length).toBe(7); // 2 Aegis + 2 Bastion + 2 Jackal + 1 Kestrel
    expect(h.director.halcyon.vehicleFleet!.isGateOpen('lane_center_breach')).toBe(false);
    expect(h.getFriendlyVehiclesProvider()).toBeTypeOf('function');
    expect(h.director.halcyon.defenseSystem!.totalCount).toBe(2); // site_flak_west, site_flak_east

    // 2. Breach watch: breach Section B + destroy both outer flak towers -> gates open & cf:halcyon_breached
    h.director.call('cf.halcyonBreachWatch');
    h.mockStructures[0]!.stage = 'breached';
    h.director.halcyon.defenseSystem!.damageSite('site_flak_west', 9999);
    h.director.halcyon.defenseSystem!.damageSite('site_flak_east', 9999);
    h.director.update(0.1);
    expect(h.director.halcyon.vehicleFleet!.isGateOpen('lane_center_breach')).toBe(true);
    expect(h.director.halcyon.vehicleFleet!.isGateOpen('lane_west_breach')).toBe(true);
    expect(h.director.halcyon.vehicleFleet!.isGateOpen('lane_east_breach')).toBe(true);
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.halcyonBreached);

    // 3. Armor push: mounts 3 mortars + 2 outer SAMs -> wiping all 5 signals cf:halcyon_ridge_clear
    h.director.call('cf.halcyonArmorPush');
    for (const id of ['site_mortar_west', 'site_mortar_center', 'site_mortar_east', 'site_sam_sw', 'site_sam_se']) {
      h.director.halcyon.defenseSystem!.damageSite(id, 9999);
    }
    h.director.update(0.1);
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.halcyonRidgeClear);

    // 4. Valkyrie fast-rope drops launch 2 inner-courtyard choppers
    h.director.call('cf.halcyonValkyrieDrop');
    expect(h.director.halcyon.vehicleFleet!.units.filter(u => u.kind === 'valkyrie').length).toBe(2);

    // 5. War machine: mounts remaining defenses, spawns enemy armor & gunship, tracks sector collapse
    h.director.call('cf.halcyonWarMachine');
    expect(h.spawnedEnemyOrders.some(o => o.kind === 'tank')).toBe(true);
    expect(h.spawnedEnemyOrders.some(o => o.kind === 'chopper')).toBe(true);

    // Collapse Armory, Airfield, Fuel Farm & Radar Domes via blasts/defense kills
    for (const tid of ['tank_armory_depot', 'hangar_north', 'hangar_south', 'fuel_tank_farm']) {
      const def = HALCYON_TARGETS.find(t => t.id === tid)!;
      h.events.emit('combat:explosion', {
        position: new THREE.Vector3(def.pos[0], 2, def.pos[2]),
        radius: 35,
        damage: 4500,
      });
    }
    h.director.halcyon.defenseSystem!.damageSite('site_radar_west', 9999);
    h.director.halcyon.defenseSystem!.damageSite('site_radar_east', 9999);
    h.director.update(0.1);
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.halcyonArmoryDown);
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.halcyonAirfieldDown);
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.halcyonFuelDown);
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.halcyonRadarDown);
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.halcyonWarBroken);

    // 6. Citadel Siege: refills Lancer into Mode 3 (BLU-121 Thermobaric) and destroys HQ
    h.director.call('cf.halcyonCitadelSiege');
    expect(h.spawnedDriveables[0]?.refilledMode).toBe(3);

    h.events.emit('combat:explosion', {
      position: new THREE.Vector3(HALCYON_CITADEL_HQ_POS[0], 4, HALCYON_CITADEL_HQ_POS[2]),
      radius: 40,
      damage: 6000,
    });
    h.director.update(0.1);
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.halcyonHqDestroyed);

    // 7. Halcyon leveled -> cf:halcyon_egress_ready -> handoff to Part 4 Return
    h.director.call('cf.halcyonLeveled');
    h.director.update(2.4);
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.halcyonEgressReady);

    h.director.call('cf.handoffToReturn');
    const chain = loadChainState();
    expect(chain?.part).toBe(4);
    expect(chain?.contractor).toBe('B');
    expect(chain!.lancerHp).toBeLessThanOrEqual(Math.round(CROSSFIRE_DEFAULT_LANCER_MAX_HP * 0.72));

    h.director.reset();
  });

  it('Part 4 (Strait Dusk Egress): ambush, carrier umbrella recovery, debrief cleanup & Lancer-death fail check', () => {
    const h = makeHarness('crossfire_return');
    h.director.ensureBuilt();

    h.director.call('cf.straitReturnInit');
    h.director.call('cf.straitWave', 'return_ambush');
    expect(h.director.strait.state.enemyCount).toBe(6); // 2 Ace Raptors + 4 Hornets

    h.director.strait.airWingInstance!.shredWave('return_ambush');
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.waveClearedReturnAmbush);

    h.director.call('cf.straitCarrierUmbrella');
    h.director.call('cf.straitWave', 'return_final');
    expect(h.director.strait.state.enemyCount).toBe(4);

    // Move wounded Lancer across STRAIT_CARRIER_RECOVERY_Z -> cf:lancer_recovered
    h.director.strait.lancer!.position.set(0, 82, STRAIT_CARRIER_RECOVERY_Z + 10);
    h.director.update(0.6);
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.lancerRecovered);

    // Debrief clears sessionStorage chain state
    sessionStorage.setItem(CROSSFIRE_CHAIN_KEY, JSON.stringify({ active: true }));
    h.director.call('cf.crossfireDebrief');
    expect(loadChainState()).toBeNull();
    expect(h.director.strait.state.debriefComplete).toBe(true);

    // Verify Lancer death triggers runner.down() when escort fails
    h.director.call('cf.straitReturnInit');
    const lancer = h.director.strait.lancer!;
    lancer.applyDamage(lancer.health + 9999, lancer.position, 'enemy_aam', false, true);
    expect(h.downSpy).toHaveBeenCalledTimes(1);

    h.director.reset();
  });

  it('respawns and seats player in airborne aircraft on mid-mission checkpoint redeploys across Strait, Return & Halcyon', () => {
    // 1. Part 2 Beat 2 (Destroyer Gauntlet) redeploy after clear()
    const strait = makeHarness('crossfire_strait');
    strait.director.ensureBuilt();
    strait.director.clear();
    strait.director.call('cf.straitDestroyersHot');
    strait.director.call('cf.straitWave', 'destroyer_strike');
    expect(strait.spawnedDriveables).toHaveLength(1);
    expect(strait.spawnedDriveables[0]?.def.id).toBe('raptor');
    expect(strait.spawnedDriveables[0]?.occupied).toBe(true);
    expect(strait.spawnedDriveables[0]?.phys.grounded).toBe(false);
    expect(strait.director.strait.lancer?.alive).toBe(true);

    // 2. Part 2 Beat 3 (Coastal Aces) redeploy after clear()
    strait.director.clear();
    strait.director.call('cf.straitWave', 'coastal_aces');
    expect(strait.spawnedDriveables).toHaveLength(1);
    expect(strait.spawnedDriveables[0]?.def.id).toBe('raptor');
    expect(strait.spawnedDriveables[0]?.occupied).toBe(true);
    expect(strait.director.strait.lancer?.alive).toBe(true);
    strait.director.reset();

    // 3. Part 4 Beat 2 (Carrier Umbrella) redeploy after clear()
    const ret = makeHarness('crossfire_return');
    ret.director.ensureBuilt();
    ret.director.clear();
    ret.director.call('cf.straitCarrierUmbrella');
    expect(ret.spawnedDriveables).toHaveLength(1);
    expect(ret.spawnedDriveables[0]?.def.id).toBe('raptor');
    expect(ret.spawnedDriveables[0]?.occupied).toBe(true);
    expect(ret.director.strait.lancer?.alive).toBe(true);
    ret.director.reset();

    // 4. Part 3 Beat 2/3/4 (Halcyon Ridge / War Machine / Citadel) redeploy after clear()
    const halcyon = makeHarness('crossfire_halcyon');
    halcyon.director.ensureBuilt();
    for (const beatCall of ['cf.halcyonArmorPush', 'cf.halcyonWarMachine', 'cf.halcyonCitadelSiege'] as const) {
      halcyon.director.clear();
      halcyon.director.call(beatCall);
      expect(halcyon.spawnedDriveables).toHaveLength(1);
      expect(halcyon.spawnedDriveables[0]?.def.id).toBe('lancer');
      expect(halcyon.spawnedDriveables[0]?.occupied).toBe(true);
      expect(halcyon.spawnedDriveables[0]?.phys.grounded).toBe(false);
      expect(halcyon.director.halcyon.state.active).toBe(true);
      expect(halcyon.director.halcyon.vehicleFleet?.isGateOpen('lane_center_breach')).toBe(true);
    }
    halcyon.director.reset();
  });

  it('repairs player F-22 hull when flying alongside the B-1B Lancer and cleanly downs player when jet is shot down', () => {
    const h = makeHarness('crossfire_strait');
    h.director.ensureBuilt();
    h.director.call('cf.straitOutboundInit');

    const raptor = h.spawnedDriveables[0]!;
    const lancer = h.director.strait.lancer!;
    raptor.health = 500;

    // Far away (> 135 m) -> does NOT repair
    raptor.phys.position.set(lancer.position.x + 280, lancer.position.y, lancer.position.z);
    h.director.update(0.5);
    expect(raptor.health).toBe(500);
    expect(h.director.strait.state.formationRepairActive).toBe(false);

    // Form up alongside the Lancer (within 135 m) -> smoothly repairs F-22 hull
    raptor.phys.position.set(lancer.position.x + 35, lancer.position.y, lancer.position.z + 20);
    h.director.update(1.0);
    expect(raptor.health).toBeGreaterThan(600);
    expect(h.director.strait.state.formationRepairActive).toBe(true);

    // Shot down jet cleanly triggers mission down after brief crash beat (no stuck ocean fall)
    raptor.alive = false;
    raptor.occupied = false;
    h.director.update(0.4);
    h.director.update(0.5);
    expect(h.downSpy).toHaveBeenCalled();

    h.director.reset();
  });

  it('staggers destroyer SeaRAM launches and caps simultaneous inbound player SAMs', () => {
    const h = makeHarness('crossfire_strait');
    h.director.ensureBuilt();
    h.director.call('cf.straitOutboundInit');
    h.director.call('cf.straitDestroyersHot');

    const def = h.director.strait.defenseSystem!;
    const sams = def.getSitesByKind('destroyer_sam');
    expect(sams).toHaveLength(4);
    // Initial cooldowns are staggered across the 4 launchers (not all firing on frame 1)
    const cooldowns = sams.map(s => s.fireCooldown);
    expect(new Set(cooldowns.map(c => Math.round(c * 10))).size).toBe(4);

    // Place airborne player right in destroyer range and tick with 0 initial cooldowns -> never exceeds 2 active SAMs on player
    h.setPlayerPos(-140, 105, -60);
    for (const s of sams) s.fireCooldown = 0;
    for (let i = 0; i < 150; i++) {
      def.update(1 / 30, {
        playerAirborne: true,
        playerVelocity: new THREE.Vector3(0, 0, -72),
      });
      expect(def.activeSamCount).toBeLessThanOrEqual(2);
    }

    h.director.reset();
  });
});

