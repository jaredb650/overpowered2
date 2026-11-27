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
import { CutscenePlayer } from '../cutscene';
import type { CampaignHud } from '../hud';
import { MissionRunner } from '../runner';
import { FakeHost } from '../testkit';
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
  exitLocked: boolean;
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
  refillCount: number;
  board: (seat?: number) => void;
  setExitLocked: (locked: boolean) => void;
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
  const spawnedEnemyInfantry: string[] = [];
  const adoptedSquadGoals: THREE.Vector3[] = [];
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
    spawn: vi.fn((id: string, pos: THREE.Vector3, _yaw: number, opts?: { exitLocked?: boolean }) => {
      const veh: MockDriveable = {
        def: { id, maxHealth: id === 'lancer' ? 2800 : 1400 },
        health: id === 'lancer' ? 2800 : 1400,
        alive: true,
        occupied: false,
        exitLocked: Boolean(opts?.exitLocked),
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
        refillCount: 0,
        board: vi.fn(() => {
          veh.occupied = true;
          driveables.active = veh;
        }),
        setExitLocked: vi.fn((locked: boolean) => {
          veh.exitLocked = locked;
        }),
        refillOrdnance: (mode?: number) => {
          veh.refillCount++;
          veh.refilledMode = mode ?? null;
        },
      };
      spawnedDriveables.push(veh);
      return veh;
    }),
  };

  const mockStructures: { stage: string }[] = Array.from({ length: 40 }, () => ({ stage: 'intact' }));
  const mockClusters = new Map<string, { collapsed: boolean; destroyedFraction: number }>();
  const mockAlliesList: Array<{
    alive: boolean;
    state: string;
    essential: boolean;
    expendable: boolean;
    detached: boolean;
    order: string;
    post: THREE.Vector3;
    postRadius: number;
    thinkAt: number;
    scriptedGoal: THREE.Vector3 | null;
    body: { position: THREE.Vector3; center: THREE.Vector3; velocity: THREE.Vector3 };
  }> = [];
  const mockEnemiesAlive: Array<{ alive: boolean; id: string; position: THREE.Vector3 }> = [];

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
          blast: vi.fn(),
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
      ring: vi.fn(),
      chips: vi.fn(),
      embers: vi.fn(),
      flame: vi.fn(),
      napalm: vi.fn(),
      napalmSplash: vi.fn(),
      heatShimmer: vi.fn(),
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
      allies: mockAlliesList,
      extraFoeProvider: null as unknown,
      spawn: vi.fn((type: string, at?: THREE.Vector3, post?: THREE.Vector3) => {
        spawnedAllies.push(type);
        const pos = at ? at.clone() : new THREE.Vector3();
        const ally = {
          alive: true,
          state: 'up',
          essential: false,
          expendable: false,
          detached: false,
          order: 'post',
          post: post ? post.clone() : pos.clone(),
          postRadius: 6,
          thinkAt: 0,
          scriptedGoal: null as THREE.Vector3 | null,
          body: { position: pos, center: pos.clone().setY(pos.y + 1.2), velocity: new THREE.Vector3() },
        };
        mockAlliesList.push(ally);
        return ally;
      }),
      dismiss: vi.fn(),
    },
    enemies: {
      alive: mockEnemiesAlive,
      query: vi.fn(() => 0),
      applyDamage: vi.fn(),
      spawn: vi.fn((id: string, at: THREE.Vector3) => {
        spawnedEnemyInfantry.push(id);
        const enemy = {
          alive: true,
          id,
          position: at.clone(),
          velocity: new THREE.Vector3(),
          groundY: 0,
          char: { root: new THREE.Group(), limbs: {} },
        };
        mockEnemiesAlive.push(enemy);
        return enemy;
      }),
      outpost: {
        w: { now: 1 },
        muster: vi.fn(() => ({
          members: [] as Array<{ e: { alive: boolean; id: string; position: THREE.Vector3 } }>,
          adopt: vi.fn((goal: THREE.Vector3) => {
            adoptedSquadGoals.push(goal.clone());
          }),
        })),
        enlistInto: vi.fn((squad: { members: Array<{ e: { alive: boolean; id: string; position: THREE.Vector3 } }> }, id: string, at: THREE.Vector3) => {
          spawnedEnemyInfantry.push(id);
          const e = { alive: true, id, position: at.clone() };
          mockEnemiesAlive.push(e);
          squad.members.push({ e });
          return e;
        }),
      },
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
    spawnedEnemyInfantry,
    adoptedSquadGoals,
    mockAlliesList,
    mockEnemiesAlive,
    extraTargets,
    mockStructures,
    mockClusters,
    getFriendlyVehiclesProvider: () => friendlyVehiclesProvider,
    setInteractPressed: (v: boolean) => { interactPressed = v; },
    setPlayerPos: (x: number, y: number, z: number) => { playerPos.set(x, y, z); },
  };
}

describe('CrossfireDirector & all 25 cf.* calls', () => {
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

    expect(CROSSFIRE_CALLS.size).toBe(25);
    for (const callName of CROSSFIRE_CALLS) {
      const handled = h.director.call(callName, callArgs[callName]);
      expect(handled, `Expected ${callName} to be handled`).toBe(true);
    }

    const unhandledWarns = warnSpy.mock.calls.filter(args => String(args[0]).includes('unhandled call'));
    expect(unhandledWarns).toEqual([]);

    h.director.reset();
    warnSpy.mockRestore();
  });

  it('Part 1 (Valken Airbase): invasion staging, south gate breach, JP-8 pipeline chain breach of apron gate, ATC override, Viper boarding, Lancer takeoff, escape cutscene & Strait handoff', () => {
    const h = makeHarness('crossfire_airbase');
    h.director.ensureBuilt();

    // 1. Init stages locked Lancer + 2 parked Raptors + 3 friendly vehicles held behind closed south_gate & apron_gate + Viper-2/3 + 8 expendables
    expect(h.director.call('cf.airbaseInit')).toBe(true);
    expect(loadChainState()?.part).toBe(1);
    expect(loadChainState()?.contractor).toBe('A');
    expect(h.director.airbase.state.parkedRaptorCount).toBe(2);
    expect(h.director.airbase.state.friendlyVehicleCount).toBe(3);
    expect(h.director.airbase.state.viperWingmenCount).toBe(2);
    expect(h.director.airbase.state.assaultTroopCount).toBe(8);
    expect(h.director.airbase.vehicleFleet!.isGateOpen('south_gate')).toBe(false);
    expect(h.director.airbase.vehicleFleet!.isGateOpen('apron_gate')).toBe(false);
    expect(h.getFriendlyVehiclesProvider()).toBeTypeOf('function');

    // 1b. Breach detonates satchel charge and opens south_gate while apron_gate stays locked until JP-8 blows
    expect(h.director.call('cf.airbaseBreach')).toBe(true);
    expect(h.director.airbase.state.gateBreached).toBe(true);
    expect(h.director.airbase.vehicleFleet!.isGateOpen('south_gate')).toBe(true);
    expect(h.director.airbase.vehicleFleet!.isGateOpen('apron_gate')).toBe(false);

    // 2. Blast at South Fuel Depot (combat hazard) does NOT breach apron_gate; deep North JP-8 Main Manifold DOES
    h.director.call('cf.apronFuelWatch');
    const southDepot = AIRBASE_DESTRUCTIBLES.find(d => d.id === 'airbase.fuel.south')!;
    const northDepot = AIRBASE_DESTRUCTIBLES.find(d => d.id === 'airbase.fuel.north')!;
    h.events.emit('combat:explosion', {
      position: new THREE.Vector3(southDepot.x, 1, southDepot.z),
      radius: 10,
      damage: 400,
    });
    expect(h.signals).not.toContain(CROSSFIRE_SIGNALS.fuelBlown);
    expect(h.director.airbase.state.apronGateBreached).toBe(false);

    h.events.emit('combat:explosion', {
      position: new THREE.Vector3(northDepot.x, 1, northDepot.z),
      radius: 10,
      damage: 400,
    });
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.fuelBlown);
    expect(h.director.airbase.state.apronGateBreached).toBe(false);
    h.director.update(0.4);
    h.director.update(0.4);
    expect(h.director.airbase.state.apronGateBreached).toBe(true);
    expect(h.director.airbase.vehicleFleet!.isGateOpen('apron_gate')).toBe(true);

    // 3. ATC Override console reacts to [E] interact when player stands at Level 3 console
    h.director.call('cf.atcConsole');
    h.setPlayerPos(AIRBASE_ATC_CONSOLE.at[0], AIRBASE_ATC_CONSOLE.at[1], AIRBASE_ATC_CONSOLE.at[2]);
    h.setInteractPressed(true);
    h.director.update(0.1);
    h.setInteractPressed(false);
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.atcOverrideDone);

    // 4. Viper-2 & Viper-3 sprint to F-22 Raptors, board, and spool up -> cf:raptors_spooled
    h.director.call('cf.buddyRaptorsBoard');
    h.director.update(3.2);
    expect(h.director.airbase.state.viperBoardedCount).toBe(2);
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.raptorsSpooled);

    // 5. Unlock Lancer -> board -> buddy Raptors launch -> climb past takeoff gate -> escape formation cutscene
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

    // 5b. Escape formation cutscene stages 3-ship B-1B + F-22 climb-out and clears live driveables
    expect(h.director.call('cf.airbaseEscapeCutscene')).toBe(true);
    expect(h.director.airbase.state.escapeCutsceneActive).toBe(true);
    h.director.update(1.2);

    // 6. Handoff persists Part 2 Contractor B chain state with preserved Lancer HP
    h.director.call('cf.handoffToStrait');
    const saved = loadChainState();
    expect(saved?.part).toBe(2);
    expect(saved?.contractor).toBe('B');
    expect(saved?.lancerHp).toBe(CROSSFIRE_DEFAULT_LANCER_MAX_HP);

    h.director.reset();
    expect(h.getFriendlyVehiclesProvider()).toBeNull();
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

    // 6. Citadel Siege: refills Lancer bomb bays (without forcing mode switch) -> Thermobaric cracks HQ -> Napalm burns Halvorsen out
    h.director.call('cf.halcyonCitadelSiege');
    expect(h.spawnedDriveables[0]?.refillCount).toBeGreaterThanOrEqual(1);
    expect(h.spawnedDriveables[0]?.refilledMode).toBeNull();

    h.events.emit('combat:explosion', {
      position: new THREE.Vector3(HALCYON_CITADEL_HQ_POS[0], 4, HALCYON_CITADEL_HQ_POS[2]),
      radius: 48,
      damage: 2600,
      source: 'ac130_bomb',
      kind: 'thermobaric',
    });
    h.director.update(0.1);
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.halcyonHqCracked);
    expect(h.signals).not.toContain(CROSSFIRE_SIGNALS.halcyonHqDestroyed);

    h.events.emit('combat:explosion', {
      position: new THREE.Vector3(HALCYON_CITADEL_HQ_POS[0], 4, HALCYON_CITADEL_HQ_POS[2]),
      radius: 22,
      damage: 520,
      source: 'lancer_napalm',
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
    expect(strait.spawnedDriveables[0]?.exitLocked).toBe(true);
    expect(strait.spawnedDriveables[0]?.phys.grounded).toBe(false);
    expect(strait.director.strait.lancer?.alive).toBe(true);

    // 2. Part 2 Beat 3 (Coastal Aces) redeploy after clear()
    strait.director.clear();
    strait.director.call('cf.straitWave', 'coastal_aces');
    expect(strait.spawnedDriveables).toHaveLength(1);
    expect(strait.spawnedDriveables[0]?.def.id).toBe('raptor');
    expect(strait.spawnedDriveables[0]?.occupied).toBe(true);
    expect(strait.spawnedDriveables[0]?.exitLocked).toBe(true);
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
    expect(ret.spawnedDriveables[0]?.exitLocked).toBe(true);
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
      expect(halcyon.spawnedDriveables[0]?.exitLocked).toBe(true);
      expect(halcyon.spawnedDriveables[0]?.phys.grounded).toBe(false);
      expect(halcyon.director.halcyon.state.active).toBe(true);
      expect(halcyon.director.halcyon.vehicleFleet?.isGateOpen('lane_center_breach')).toBe(true);
    }
    halcyon.director.reset();

    // 5. Part 1 Beat 5 (Valken Airbase escape Lancer) locks exit once unlocked/boarded
    const airbase = makeHarness('crossfire_airbase');
    airbase.director.ensureBuilt();
    airbase.director.call('cf.lancerReady');
    expect(airbase.spawnedDriveables).toHaveLength(1);
    expect(airbase.spawnedDriveables[0]?.def.id).toBe('lancer');
    expect(airbase.spawnedDriveables[0]?.exitLocked).toBe(true);
    airbase.director.reset();
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

  it('CutscenePlayer hides viewScene and keeps weapons holstered throughout endsBlack cutscenes until reset()', () => {
    const viewScene = new THREE.Scene();
    viewScene.visible = true;
    let holstered = false;
    let parked = false;

    const ctx = {
      render: { scene: new THREE.Scene(), viewScene },
      camera: { setSeat: vi.fn(), setZoom: vi.fn(), syncSeat: vi.fn() },
      hud: { seat: vi.fn() },
      input: { pressed: () => false },
      player: {
        position: new THREE.Vector3(0, 0, 0),
        park: vi.fn(() => { parked = true; }),
        unpark: vi.fn(() => { parked = false; }),
      },
      weapons: {
        setHolstered: vi.fn((h: boolean) => { holstered = h; }),
      },
    } as unknown as Ctx;

    const ui = {
      cinema: {} as HTMLElement,
      caption: vi.fn(),
      votes: vi.fn(),
      curtain: vi.fn(),
      lift: vi.fn(),
    } as unknown as CampaignHud;

    const player = new CutscenePlayer(ctx, ui);
    const done = vi.fn();
    player.play(
      {
        endsBlack: true,
        shots: [
          { from: [0, 5, 10], to: [0, 5, 0], lookFrom: [0, 5, -10], lookTo: [0, 5, -20], seconds: 1.0 },
        ],
      },
      done,
    );

    expect(parked).toBe(true);
    expect(holstered).toBe(true);
    expect(viewScene.visible).toBe(false);

    // Even if an external system tries to unholster mid-cutscene, update() re-enforces holster & hidden viewScene
    holstered = false;
    viewScene.visible = true;
    player.update(0.4);
    expect(holstered).toBe(true);
    expect(viewScene.visible).toBe(false);

    // Finishing an endsBlack cutscene keeps player parked, weapon holstered, and viewScene hidden
    player.update(0.7);
    expect(done).toHaveBeenCalledWith(false);
    expect(parked).toBe(true);
    expect(holstered).toBe(true);
    expect(viewScene.visible).toBe(false);

    // Calling reset() restores on-foot controls and viewScene cleanly
    player.reset();
    expect(parked).toBe(false);
    expect(holstered).toBe(false);
    expect(viewScene.visible).toBe(true);
  });

  it('sinks Southern Missile Destroyers at 0 hull HP, instantly kills & hides surviving deck turrets, and animates listing/sinking', () => {
    const h = makeHarness('crossfire_strait');
    h.director.ensureBuilt();
    h.director.call('cf.straitOutboundInit');
    h.director.call('cf.straitDestroyersHot');

    const fleet = h.director.strait.destroyerFleet!;
    const def = h.director.strait.defenseSystem!;
    expect(fleet.totalCount).toBe(2);
    expect(fleet.aliveCount).toBe(2);

    // Both warships are paintable for AMRAAM/AGM lock-on
    const paintTargets: { alive: boolean; center: THREE.Vector3 }[] = [];
    fleet.paintable(paintTargets as never);
    expect(paintTargets).toHaveLength(2);

    const ironclad = fleet.getShip('destroyer_west')!;
    const bastion = fleet.getShip('destroyer_east')!;
    expect(ironclad.maxHealth).toBe(4200);
    expect(bastion.maxHealth).toBe(4200);

    // Destroying a deck SAM on Ironclad also chunks Ironclad's global hull HP
    const ironcladSam = def.sites.find(s => s.shipId === 'destroyer_west' && s.kind === 'destroyer_sam')!;
    def.damageSite(ironcladSam.id, 9999);
    expect(ironclad.health).toBeLessThan(4200);

    // Finish sinking Ironclad directly via hull damage -> surviving CIWS & aft SAM on Ironclad immediately die & hide!
    fleet.damageShip('destroyer_west', 9999);
    expect(ironclad.alive).toBe(false);
    expect(ironclad.sinking).toBe(true);
    const ironcladSites = def.sites.filter(s => s.shipId === 'destroyer_west');
    expect(ironcladSites.every(s => !s.alive && s.rig.root.visible === false)).toBe(true);
    // Bastion's turrets remain alive until Bastion sinks — sinking Ironclad alone shifts marker east and does NOT suppress both
    expect(def.sites.filter(s => s.shipId === 'destroyer_east' && s.alive).length).toBe(4);
    expect(h.signals).not.toContain(CROSSFIRE_SIGNALS.destroyersSuppressed);
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.destroyersShiftEast);

    // Tick sinking animation -> hull lists & plunges beneath the waves
    for (let i = 0; i < 65; i++) h.director.update(0.1);
    expect(Math.abs(ironclad.rig.hullGroup.rotation.z)).toBeGreaterThan(0.5);
    expect(ironclad.rig.hullGroup.position.y).toBeLessThan(-20);
    expect(ironclad.sunk).toBe(true);
    expect(ironclad.rig.root.visible).toBe(false);

    // Sink Bastion -> all turrets gone and cf:destroyers_suppressed fires!
    fleet.damageShip('destroyer_east', 9999);
    expect(fleet.aliveCount).toBe(0);
    expect(def.aliveCount).toBe(0);
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.destroyersSuppressed);

    h.director.reset();
  });

  it('holds the B-1B Lancer in a full-speed defensive racetrack orbit while Strait threats remain and leashes enemy fighters inside playable bounds', () => {
    const h = makeHarness('crossfire_strait');
    h.director.ensureBuilt();
    h.director.call('cf.straitOutboundInit');
    h.director.call('cf.straitDestroyersHot');
    h.director.call('cf.straitWave', 'destroyer_strike');

    const lancer = h.director.strait.lancer!;
    // Move Lancer into the mid-strait hold threshold and tick 10 seconds while destroyers + strike wing are still alive
    lancer.position.set(0, 118, 150);
    for (let i = 0; i < 120; i++) {
      h.director.update(1 / 12);
    }

    expect(lancer.isHoldingOrbit).toBe(true);
    expect(h.director.strait.state.activeOrbitTag).toBe('destroyers');
    // Lancer stays south of the destroyer SAM umbrella & never flies past STRAIT_FEET_DRY_Z while threats remain!
    expect(lancer.position.z).toBeGreaterThan(-40);
    expect(lancer.speed).toBeGreaterThan(35);

    // Enemy fighters pushed toward the ±820 m invisible wall stay strictly leashed inside ±690 m!
    const enemies = h.director.strait.airWingInstance!.enemies;
    expect(enemies.length).toBeGreaterThan(0);
    for (const e of enemies) {
      e.position.set(780, 120, -790);
      e.yaw = Math.PI * 0.75; // pointed straight toward the NE corner wall
    }
    for (let i = 0; i < 30; i++) {
      h.director.update(1 / 15);
    }
    for (const e of enemies) {
      if (!e.alive) continue;
      expect(Math.abs(e.position.x)).toBeLessThanOrEqual(690.01);
      expect(Math.abs(e.position.z)).toBeLessThanOrEqual(690.01);
    }

    // Sink both destroyers + clear strike wing -> Lancer immediately releases defensive orbit and resumes north transit!
    h.director.strait.destroyerFleet!.damageShip('destroyer_west', 9999);
    h.director.strait.destroyerFleet!.damageShip('destroyer_east', 9999);
    h.director.strait.airWingInstance!.shredWave('destroyer_strike');
    h.director.update(0.1);
    expect(lancer.isHoldingOrbit).toBe(false);
    expect(h.director.strait.state.activeOrbitTag).toBeNull();

    h.director.reset();
  });

  it('never softlocks Beat 2 or leaves a dead destroyer indicator when both destroyers are sunk before Beat 1 planes even spawn', () => {
    const h = makeHarness('crossfire_strait');
    const host = new FakeHost();
    const runner = new MissionRunner(CROSSFIRE_STRAIT, host);
    const director = new CrossfireDirector(h.ctx, runner);
    host.call = (name, arg) => {
      director.call(name, arg);
    };

    runner.start();
    // Finish Beat 1 intro cutscene
    expect(host.cutsceneDone).not.toBeNull();
    host.cutsceneDone!(false);
    runner.update(0.05);
    expect(runner.beat?.id).toBe('outbound_probe');
    // First wave of planes (`outbound_probe`) has NOT spawned yet (3s wait still ticking)!
    expect(director.strait.state.spawnedWaves).not.toContain('outbound_probe');

    // Player flies ahead and sinks BOTH destroyers before the first wave of planes even spawns
    const fleet = director.strait.destroyerFleet!;
    expect(fleet.aliveCount).toBe(2);
    fleet.damageShip('destroyer_west', 9999);
    fleet.damageShip('destroyer_east', 9999);
    expect(fleet.aliveCount).toBe(0);

    // Wait 3.2s so `outbound_probe` spawns, then clear the probe wave -> Beat 2 (`destroyer_gauntlet`) opens
    for (let i = 0; i < 35; i++) {
      runner.update(0.1);
      director.update(0.1);
    }
    expect(director.strait.state.spawnedWaves).toContain('outbound_probe');
    director.strait.airWingInstance!.shredWave('outbound_probe');
    runner.update(0.05);
    expect(runner.beat?.id).toBe('destroyer_gauntlet');

    // First frame of Beat 2: `sink_destroyers` is IMMEDIATELY checked off (no stuck destroyerWest marker!),
    // stale destroyer SAM dialogue is sidestepped, and only `clear_gauntlet_wing` remains active.
    runner.update(0.05);
    expect(runner.objectives.map(o => o.id)).toEqual(['clear_gauntlet_wing']);
    expect(host.said).not.toContain('mission.crossfire.strait.halvorsen.gauntlet.fire');
    expect(host.said).not.toContain('mission.crossfire.strait.wingman.gauntlet.sams');

    // Clearing the strike wing immediately completes Beat 2 and advances to Beat 3 (`coastal_aces`)!
    director.strait.airWingInstance!.shredWave('destroyer_strike');
    runner.update(0.05);
    expect(runner.beat?.id).toBe('coastal_aces');

    director.reset();
  });

  it('shifts the Beat 2 destroyer objective marker onto SNS Bastion when SNS Ironclad was already sunk early', () => {
    const h = makeHarness('crossfire_strait');
    const host = new FakeHost();
    const runner = new MissionRunner(CROSSFIRE_STRAIT, host);
    const director = new CrossfireDirector(h.ctx, runner);
    host.call = (name, arg) => {
      director.call(name, arg);
    };

    runner.start();
    host.cutsceneDone!(false);
    runner.update(0.05);

    // Sink ONLY SNS Ironclad (`destroyer_west`) during Beat 1, leaving SNS Bastion (`destroyer_east`) alive
    const fleet = director.strait.destroyerFleet!;
    fleet.damageShip('destroyer_west', 9999);
    expect(fleet.aliveCount).toBe(1);

    // Advance into Beat 2
    for (let i = 0; i < 35; i++) {
      runner.update(0.1);
      director.update(0.1);
    }
    director.strait.airWingInstance!.shredWave('outbound_probe');
    runner.update(0.05);
    expect(runner.beat?.id).toBe('destroyer_gauntlet');

    // First frame of Beat 2: `sink_destroyers` shifts straight to `destroyerEast` (never sitting on empty water at destroyerWest)
    runner.update(0.05);
    const sinkObj = runner.objectives.find(o => o.id === 'sink_destroyers');
    expect(sinkObj).toBeDefined();
    expect(sinkObj!.at).toEqual(CROSSFIRE_STRAIT.marks.destroyerEast);

    // Sinking SNS Bastion checks off `sink_destroyers`, and clearing the strike wing advances to Beat 3
    fleet.damageShip('destroyer_east', 9999);
    runner.update(0.05);
    expect(runner.objectives.map(o => o.id)).toEqual(['clear_gauntlet_wing']);

    director.strait.airWingInstance!.shredWave('destroyer_strike');
    runner.update(0.05);
    expect(runner.beat?.id).toBe('coastal_aces');

    director.reset();
  });

  it('Part 3 Citadel HQ enforces 2-stage ordnance lock: BLU-121 Thermobaric cracks concrete, then BLU-27 Napalm burns Halvorsen out', () => {
    const h = makeHarness('crossfire_halcyon');
    h.director.ensureBuilt();
    h.director.call('cf.halcyonCitadelSiege');

    const hqPos = new THREE.Vector3(HALCYON_CITADEL_HQ_POS[0], 4, HALCYON_CITADEL_HQ_POS[2]);
    // Even if DestructionManager reports the HQ cluster collapsed, Stage 2 Napalm is still required
    h.mockClusters.set('halcyon.citadel.hq', { collapsed: true, destroyedFraction: 1 });

    // Stage 1 rejects Snake-Eyes, CBU-105 Cluster, and Napalm before concrete is cracked
    for (const src of ['lancer_chute', 'lancer_bomb', 'lancer_cluster', 'lancer_napalm']) {
      h.ctx.world.objects.blastHandler?.(hqPos, 24, 3000, src);
    }
    h.director.update(0.1);
    expect(h.director.halcyon.state.hqCracked).toBe(false);
    expect(h.signals).not.toContain(CROSSFIRE_SIGNALS.halcyonHqCracked);
    expect(h.signals).not.toContain(CROSSFIRE_SIGNALS.halcyonHqDestroyed);

    // BLU-121 Thermobaric (`ac130_bomb` via world.objects.blastHandler) cracks the reinforced concrete!
    h.ctx.world.objects.blastHandler?.(hqPos, 48, 2600, 'ac130_bomb');
    h.director.update(0.1);
    expect(h.director.halcyon.state.hqCracked).toBe(true);
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.halcyonHqCracked);
    expect(h.signals).not.toContain(CROSSFIRE_SIGNALS.halcyonHqDestroyed);

    // Stage 2 rejects Snake-Eyes, Cluster, and additional Thermobaric — ONLY Napalm burns Halvorsen out!
    for (const src of ['lancer_chute', 'lancer_cluster', 'ac130_bomb', 'lancer_thermobaric']) {
      h.ctx.world.objects.blastHandler?.(hqPos, 48, 2600, src);
    }
    h.director.update(0.1);
    expect(h.director.halcyon.state.hqBurned).toBe(false);
    expect(h.signals).not.toContain(CROSSFIRE_SIGNALS.halcyonHqDestroyed);

    // BLU-27 Napalm (`lancer_napalm`) torches the cracked vault and kills Halvorsen!
    h.ctx.world.objects.blastHandler?.(hqPos, 22, 520, 'lancer_napalm');
    h.director.update(0.1);
    expect(h.director.halcyon.state.hqBurned).toBe(true);
    expect(h.signals).toContain(CROSSFIRE_SIGNALS.halcyonHqDestroyed);

    h.director.reset();
  });

  it('Part 3 free-flow carpet-bombing skips stale dialogue, never resurrects pre-bombed defenses, and flows cleanly into 2-stage Citadel finale', () => {
    const h = makeHarness('crossfire_halcyon');
    const host = new FakeHost();
    const runner = new MissionRunner(CROSSFIRE_HALCYON, host);
    const director = new CrossfireDirector(h.ctx, runner);
    host.call = (name, arg) => {
      director.call(name, arg);
    };

    runner.start();
    expect(host.cutsceneDone).not.toBeNull();
    host.cutsceneDone!(false);
    runner.update(0.05);
    expect(runner.beat?.id).toBe('breach');

    // Player ignores dialogue pacing and carpet-bombs the entire fortress in Beat 1!
    const earlyTargets = [
      'wall_section_b',
      'flak_west',
      'flak_east',
      'mortar_west',
      'mortar_center',
      'mortar_east',
      'sam_sw',
      'sam_se',
      'tank_armory_depot',
      'hangar_north',
      'hangar_south',
      'fuel_tank_farm',
      'radar_west',
      'radar_east',
    ] as const;

    for (const tid of earlyTargets) {
      const def = HALCYON_TARGETS.find(t => t.id === tid)!;
      h.ctx.world.objects.blastHandler?.(new THREE.Vector3(def.pos[0], 2, def.pos[2]), 34, 4500, 'lancer_bomb');
    }

    // Pump mission ticks so runner catches up through Beat 1 -> Beat 2 -> Beat 3 -> Beat 4 (`citadel_hq`)
    for (let i = 0; i < 20; i++) {
      runner.update(0.1);
      director.update(0.1);
    }

    // Runner caught straight up to Beat 4 (`citadel_hq`) without softlocking or resurrecting pre-bombed mortars/SAMs!
    expect(runner.beat?.id).toBe('citadel_hq');
    expect(director.halcyon.defenseSystem!.getSite('site_mortar_west')).toBeUndefined();
    expect(director.halcyon.defenseSystem!.getSite('site_sam_sw')).toBeUndefined();
    // Stale Beat 2 & Beat 3 radio lines were skipped via `unless`
    expect(host.said).not.toContain('mission.crossfire.halcyon.halvorsen.ridge.traps');
    expect(host.said).not.toContain('mission.crossfire.halcyon.mercer.ridge.pinned');
    expect(host.said).not.toContain('mission.crossfire.halcyon.halvorsen.warmachine.unleash');
    expect(host.said).not.toContain('mission.crossfire.halcyon.mercer.warmachine.hunt');

    // Beat 4 Stage 1: Crack Citadel HQ concrete with BLU-121 Thermobaric
    expect(runner.objectives.map(o => o.id)).toContain('crack_citadel');
    const hqPos = new THREE.Vector3(HALCYON_CITADEL_HQ_POS[0], 4, HALCYON_CITADEL_HQ_POS[2]);
    h.ctx.world.objects.blastHandler?.(hqPos, 48, 2600, 'ac130_bomb');
    for (let i = 0; i < 6; i++) {
      runner.update(0.1);
      director.update(0.1);
    }

    // Halvorsen taunts -> Mercer demands Napalm -> `burn_citadel` objective opens!
    expect(host.said).toContain('mission.crossfire.halcyon.halvorsen.citadel.taunt');
    expect(host.said).toContain('mission.crossfire.halcyon.mercer.citadel.napalm');
    expect(runner.objectives.map(o => o.id)).toEqual(['burn_citadel']);

    // Beat 4 Stage 2: Drop BLU-27 Napalm -> Halvorsen burns to death screaming on radio!
    h.ctx.world.objects.blastHandler?.(hqPos, 22, 520, 'lancer_napalm');
    runner.update(0.05);
    expect(host.said).toContain('mission.crossfire.halcyon.halvorsen.citadel.final');
    // Finish Halvorsen's screaming radio line (`wait: true`) -> cf.halcyonLeveled triggers!
    host.speaking?.();
    runner.update(0.05);
    expect(director.halcyon.state.leveledActive).toBe(true);

    director.reset();
  });

  it('Part 3 deploys and continuously reinforces an Endless-War-style Mercer vs Halcyon combined-arms ground war', () => {
    const h = makeHarness('crossfire_halcyon');
    h.director.ensureBuilt();
    h.director.call('cf.halcyonInit');

    // Initial ground battle deployment: 14 Mercer infantry, 21 Halcyon garrison soldiers across 5 squads, 3 patrol vehicles, and extraFoeProvider
    expect(h.spawnedAllies.length).toBe(14);
    expect(h.mockAlliesList.every(a => a.expendable && a.detached)).toBe(true);
    expect(h.spawnedEnemyInfantry.length).toBeGreaterThanOrEqual(20);
    expect(h.director.halcyon.state.enemyGroundSquads).toBe(5);
    expect(h.adoptedSquadGoals.length).toBeGreaterThanOrEqual(5);
    expect(h.spawnedEnemyOrders.filter(o => o.kind === 'humvee').length).toBe(2);
    expect(h.spawnedEnemyOrders.filter(o => o.kind === 'tank').length).toBe(1);

    const provider = (h.ctx.allies as unknown as { extraFoeProvider?: (s: unknown) => unknown }).extraFoeProvider;
    expect(provider).toBeTypeOf('function');
    // Enemy AT rocketeer near Mercer's Aegis tank locks onto the friendly tank as a valid Foe
    const aegisPos = h.director.halcyon.vehicleFleet!.units[0]!.position.clone();
    const foe = provider!({ e: { id: 'rocketeer', position: aegisPos.clone().add(new THREE.Vector3(20, 0, 0)) } });
    expect(foe).not.toBeNull();

    // Simulate 17 seconds of live battle -> continuous infantry & armor reinforcements deploy for both armies
    const initialSpawns = h.director.halcyon.state.groundWarSpawns;
    const initialOrders = h.spawnedEnemyOrders.length;
    for (let i = 0; i < 34; i++) {
      h.director.update(0.5);
    }
    expect(h.director.halcyon.state.groundWarSpawns).toBeGreaterThan(initialSpawns);
    expect(h.spawnedEnemyOrders.length).toBeGreaterThan(initialOrders);

    // Cleanup clears extraFoeProvider cleanly
    h.director.clear();
    expect((h.ctx.allies as unknown as { extraFoeProvider?: unknown }).extraFoeProvider).toBeNull();

    h.director.reset();
  });

  it('Part 2 Strait destroyers resist a single F-22 20mm Vulcan cannon burst and require heavy missile volleys or sustained runs to sink', () => {
    const h = makeHarness('crossfire_strait');
    h.director.ensureBuilt();
    h.director.call('cf.straitOutboundInit');

    const fleet = h.director.strait.destroyerFleet!;
    const ironclad = fleet.getShip('destroyer_west')!;
    const hullCol = ironclad.colliders[0]!;
    expect(ironclad.maxHealth).toBeGreaterThanOrEqual(4000);

    // Simulate a full 1.0-second F-22 20mm M61A2 Vulcan cannon burst (35 rounds: 58 direct + 24 shell splash @ 0.9 m)
    for (let i = 0; i < 35; i++) {
      fleet.direct(hullCol, ironclad.center, 58, 'shell', 'raptor_cannon');
      fleet.blast(ironclad.center, {
        radius: 0.9,
        damage: 24,
        kind: 'shell',
        source: 'raptor_cannon',
        team: 'player',
      });
    }
    // Warship stays afloat with >75% hull integrity after a single cannon burst!
    expect(ironclad.alive).toBe(true);
    expect(ironclad.healthRatio).toBeGreaterThan(0.75);

    // A dedicated anti-ship AIM-120D AMRAAM volley (4 hits: 660 direct + 420 rocket splash @ 7.5 m) sinks it cleanly!
    for (let i = 0; i < 4; i++) {
      fleet.direct(hullCol, ironclad.center, 660, 'rocket', 'raptor_atgm');
      fleet.blast(ironclad.center, {
        radius: 7.5,
        damage: 420,
        kind: 'rocket',
        source: 'raptor_atgm',
        team: 'player',
      });
    }
    expect(ironclad.alive).toBe(false);
    expect(ironclad.sinking).toBe(true);

    h.director.reset();
  });

  it('Part 3 Citadel HQ erupts in a violent whole-HQ 3D flame inferno with staggered cook-offs on Stage 2 Napalm kill', () => {
    const h = makeHarness('crossfire_halcyon');
    h.director.ensureBuilt();
    h.director.call('cf.halcyonCitadelSiege');

    const hqPos = new THREE.Vector3(HALCYON_CITADEL_HQ_POS[0], 4, HALCYON_CITADEL_HQ_POS[2]);
    // Stage 1: Thermobaric cracks reinforced concrete
    h.ctx.world.objects.blastHandler?.(hqPos, 48, 2600, 'ac130_bomb');
    h.director.update(0.1);
    expect(h.director.halcyon.state.hqInfernoActive).toBe(false);

    // Stage 2: BLU-27 Napalm ignites the unique whole-HQ volcanic flame eruption!
    h.ctx.world.objects.blastHandler?.(hqPos, 22, 520, 'lancer_napalm');
    expect(h.director.halcyon.state.hqInfernoActive).toBe(true);
    expect(h.ctx.render.scene.getObjectByName('halcyon.citadel.inferno')).toBeDefined();
    expect(h.ctx.world.objects.destruction?.blast).toHaveBeenCalled();
    expect(h.ctx.fx.ring).toHaveBeenCalled();
    expect(h.ctx.fx.chips).toHaveBeenCalled();

    // Ticking 4 seconds fires staggered secondary vault/buttress cook-offs, skyward flames, embers & smoke
    for (let i = 0; i < 40; i++) {
      h.director.update(0.1);
    }
    expect(h.director.halcyon.state.hqInfernoCookoffs).toBeGreaterThanOrEqual(8);
    expect(h.ctx.fx.flame).toHaveBeenCalled();
    expect(h.ctx.fx.embers).toHaveBeenCalled();
    expect(h.ctx.fx.napalm).toHaveBeenCalled();

    // Cleanup removes the volumetric inferno rig from the scene cleanly
    h.director.clear();
    expect(h.director.halcyon.state.hqInfernoActive).toBe(false);
    expect(h.ctx.render.scene.getObjectByName('halcyon.citadel.inferno')).toBeUndefined();

    h.director.reset();
  });
});




