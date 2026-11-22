import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTRACTS } from '../../contracts/data';
import { ACTIVE } from '../../contracts/select';
import { SHOP_CONTRACTS } from '../../contracts/shop/data';
import { hasStarter } from '../../contracts/starter';
import type { Ctx } from '../../core/contracts';
import type { EnemyId } from '../../core/gameplay';
import { mulberry32 } from '../../core/math';
import { ModelMaterials } from '../../progression/modelkit';
import { modesOn, SURVIVAL_MAPS } from '../../ui/screens/mainmenu';
import { BOSS_DROP_ZONES, HOVER_DROP_ZONES, PARATROOPER_ZONES, ROOFTOP_KILL_Y } from '../../world/map/rooftop/plan';
import { Commander } from '../commander';
import type { Enemy } from '../Enemy';
import type { EnemyManager } from '../EnemyManager';
import type { Outpost } from '../outpost';
import { ROLE_OF } from '../outpost/doctrine';
import { bulletDamage } from '../vehicles/armour';
import { DOOR_GUNNER, TRANSPORT, VEHICLES } from '../vehicles/data';
import type { VehicleSystem } from '../vehicles/index';
import { FastRopeHeli } from '../vehicles/transport';
import { ParatrooperSystem } from './paratroopers';
import {
  chooseReinforcementVector,
  composeRooftopWave,
  ROOFTOP_BOSS_CYCLE,
  rooftopAirSupportForWave,
  rooftopBossForWave,
  RooftopWaves,
} from './waves';

/** Minimal mocked Ctx/EnemyManager/Outpost/VehicleSystem harness for Rooftop Mode unit tests. */
function makeHarness() {
  const scene = new THREE.Scene();
  const audioPlays: string[] = [];
  const feeds: string[] = [];
  const awards: { score: number; label: string }[] = [];
  const events: { name: string; payload: unknown }[] = [];
  const killedMen: { enemy: Enemy; source: string }[] = [];
  const spawnedBosses: { id: EnemyId; at: THREE.Vector3 }[] = [];
  const spawnedChoppers: { from: THREE.Vector3; marks: readonly THREE.Vector3[]; tag: string | null }[] = [];
  const spawnedDoorGunners: { from: THREE.Vector3; focus: THREE.Vector3; tag: string | null }[] = [];
  const spawnedTransports: { from: THREE.Vector3; lz: THREE.Vector3; hoverY: number; squad: readonly EnemyId[] }[] = [];

  let nextHandle = 1;
  const colliders = new Map<number, unknown>();

  const makeEnemy = (id: EnemyId, at: THREE.Vector3): Enemy => {
    const animPlays: string[] = [];
    const e = {
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
      char: {
        anim: {
          play(name: string) {
            animPlays.push(name);
          },
          plays: animPlays,
        },
      },
    } as unknown as Enemy;
    return e;
  };

  const ctx = {
    time: { dt: 0.05, elapsed: 0 },
    render: {
      scene,
      materials: { patch: <T>(m: T) => m },
      lights: { flash: vi.fn() },
      decals: { add: vi.fn() },
    },
    audio: {
      play: (name: string) => { audioPlays.push(name); },
      music: vi.fn(),
      startLoop: () => ({ stop: vi.fn(), setPosition: vi.fn(), setPitch: vi.fn(), setVolume: vi.fn() }),
    },
    hud: {
      feed: (text: string) => { feeds.push(text); },
      floatText: vi.fn(),
      follow: () => vi.fn(),
    },
    fx: {
      explosion: vi.fn(),
      chips: vi.fn(),
      embers: vi.fn(),
      heatShimmer: vi.fn(),
      sparks: vi.fn(),
      smoke: vi.fn(),
      attachEmitter: () => ({ stop: vi.fn() }),
    },
    progression: {
      award: (score: number, label: string) => { awards.push({ score, label }); },
    },
    events: {
      emit: (name: string, payload: unknown) => { events.push({ name, payload }); },
      on: vi.fn(),
    },
    campaign: {
      unitGone: vi.fn(),
    },
    combat: {
      explode: vi.fn(),
    },
    player: {
      alive: true,
      parked: false,
      position: new THREE.Vector3(0, 28, 10),
      eye: new THREE.Vector3(0, 29.6, 10),
    },
    world: {
      bounds: new THREE.Box3(new THREE.Vector3(-84, -12, -84), new THREE.Vector3(84, 76, 84)),
      objects: { killY: ROOFTOP_KILL_Y },
      nav: {
        nearest: (src: THREE.Vector3, _r: number, out: THREE.Vector3) => {
          out.copy(src);
          return true;
        },
        groundHeight: () => 28,
      },
    },
    physics: {
      addStaticBox: () => {
        const handle = nextHandle++;
        return {
          handle,
          setTranslation: vi.fn(),
          setRotation: vi.fn(),
        };
      },
      world: {
        removeCollider: vi.fn(),
      },
    },
  } as unknown as Ctx;

  const alive: Enemy[] = [];
  const manager = {
    alive,
    queued: 0,
    bossDying: false,
    fieldCleared: false,
    outpost: null as Outpost | null,
    vehicles: null as VehicleSystem | null,
    setWave: vi.fn(),
    spawn: (id: EnemyId, at: THREE.Vector3) => {
      const e = makeEnemy(id, at);
      alive.push(e);
      return e;
    },
    spawnBoss: (id: EnemyId, at?: THREE.Vector3) => {
      const pos = at ? at.clone() : new THREE.Vector3(0, 28, 0);
      spawnedBosses.push({ id, at: pos });
      const e = makeEnemy(id, pos);
      alive.push(e);
      return e;
    },
  } as unknown as EnemyManager;

  const outpost = {
    hostile: 0,
    dread: { hesitation: 1 },
    onWaveStart: vi.fn(),
    formSquad: vi.fn(),
    sendIn: (id: EnemyId) => {
      const e = manager.spawn(id, new THREE.Vector3(0, 28, 0));
      if (e) (outpost as unknown as { hostile: number }).hostile++;
    },
    muster: (_size: number, _at: THREE.Vector3) => ({ id: 1, name: 'Alpha', directed: false }),
    enlistInto: (_squad: unknown, id: EnemyId, at: THREE.Vector3) => {
      const e = manager.spawn(id, at);
      if (e) (outpost as unknown as { hostile: number }).hostile++;
      return e;
    },
  } as unknown as Outpost;
  (manager as unknown as { outpost: Outpost }).outpost = outpost;

  const vehicles = {
    ctx,
    manager,
    colliders,
    live: [] as unknown[],
    wrecks: [] as unknown[],
    target: vi.fn(),
    groundUnder: () => 28,
    airburst: vi.fn(),
    callout: vi.fn(),
    wreckUtility: () => ({ dispose: vi.fn(), update: vi.fn() }),
    bury: vi.fn(),
    killMan: (e: Enemy, source: string) => {
      e.alive = false;
      killedMen.push({ enemy: e, source });
      (outpost as unknown as { hostile: number }).hostile = Math.max(0, outpost.hostile - 1);
    },
    spawnChopper: (from: THREE.Vector3, marks: readonly THREE.Vector3[], tag: string | null) => {
      spawnedChoppers.push({ from: from.clone(), marks, tag });
      return {};
    },
    spawnDoorGunner: (from: THREE.Vector3, focus: THREE.Vector3, tag: string | null) => {
      spawnedDoorGunners.push({ from: from.clone(), focus: focus.clone(), tag });
      return {};
    },
    spawnTransport: (from: THREE.Vector3, lz: THREE.Vector3, hoverY: number, squad: readonly EnemyId[]) => {
      spawnedTransports.push({ from: from.clone(), lz: lz.clone(), hoverY, squad: [...squad] });
      return {};
    },
  } as unknown as VehicleSystem;
  (manager as unknown as { vehicles: VehicleSystem }).vehicles = vehicles;

  return {
    ctx,
    scene,
    manager,
    outpost,
    vehicles,
    audioPlays,
    feeds,
    awards,
    events,
    killedMen,
    spawnedBosses,
    spawnedChoppers,
    spawnedDoorGunners,
    spawnedTransports,
  };
}

describe('Rooftop Mode contract & Commander disabling', () => {
  const originalDef = ACTIVE.def;

  afterEach(() => {
    (ACTIVE as { def: typeof ACTIVE.def }).def = originalDef;
  });

  it('registers the rooftop contract with noCommander, humans/outpost AI, shop, starter, and menu entry', () => {
    const def = CONTRACTS.find(c => c.id === 'rooftop');
    expect(def).toBeDefined();
    expect(def!.map).toBe('rooftop');
    expect(def!.faction).toBe('humans');
    expect(def!.waves).toBe('squads');
    expect(def!.ai).toBe('outpost');
    expect(def!.wounds).toBe('anatomy');
    expect(def!.noCommander).toBe(true);
    expect(def!.locked).toBeUndefined();

    expect(SHOP_CONTRACTS).toContain('rooftop');
    expect(hasStarter('rooftop')).toBe(true);
    expect(SURVIVAL_MAPS.some(m => m.map === 'rooftop')).toBe(true);
    expect(modesOn('rooftop').map(c => c.id)).toContain('rooftop');
  });

  it('cleanly disables The Commander when ACTIVE.def.noCommander is true', () => {
    const rooftopDef = CONTRACTS.find(c => c.id === 'rooftop')!;
    (ACTIVE as { def: typeof ACTIVE.def }).def = rooftopDef;

    const h = makeHarness();
    const aiWorld = {
      ctx: h.ctx,
      now: 0,
      player: h.ctx.player,
      enemies: h.manager,
      director: { clearLine: () => true },
      telegraphs: { zone: vi.fn() },
    };
    const cmd = new Commander(aiWorld as never, h.outpost, h.manager);
    expect(cmd.disabled).toBe(true);
    cmd.status('aaLock', true);
    expect(h.events.some(e => e.name === 'commander:status')).toBe(false);
    expect(cmd.intermission(5, 8)).toBe(8);

    const squads: EnemyId[][] = [['trooper', 'gunner', 'trooper']];
    expect(cmd.compose(6, squads)).toBe(squads);

    cmd.person.arm();
    expect(cmd.person.pending).toBe(false);
    cmd.person.summon();
    expect(h.manager.alive).toHaveLength(0);
  });
});

describe('Rooftop Mode endless wave & boss rotation', () => {
  it('cycles bosses every 5 waves: Chopper -> Juggernaut -> Titan indefinitely', () => {
    expect(ROOFTOP_BOSS_CYCLE).toEqual(['chopper', 'juggernaut', 'titan']);
    for (let w = 1; w <= 60; w++) {
      const boss = rooftopBossForWave(w);
      if (w % 5 !== 0) {
        expect(boss).toBeNull();
      } else {
        const expected = ROOFTOP_BOSS_CYCLE[((w / 5) - 1) % 3];
        expect(boss).toBe(expected);
      }
    }
    expect(rooftopBossForWave(5)).toBe('chopper');
    expect(rooftopBossForWave(10)).toBe('juggernaut');
    expect(rooftopBossForWave(15)).toBe('titan');
    expect(rooftopBossForWave(20)).toBe('chopper');
    expect(rooftopBossForWave(25)).toBe('juggernaut');
    expect(rooftopBossForWave(30)).toBe('titan');
  });

  it('never selects an enemy AC-130 for air support on any wave 1..60', () => {
    const seen = new Set<string>();
    for (let w = 1; w <= 60; w++) {
      const air = rooftopAirSupportForWave(w);
      if (air !== null) {
        expect(['doorGunner', 'chopper']).toContain(air);
        expect(air).not.toBe('ac130');
        seen.add(air);
      }
    }
    expect(seen.has('doorGunner')).toBe(true);
    expect(seen.has('chopper')).toBe(true);
  });

  it('composes human SWAT squads indefinitely past wave 10 and uses all 3 reinforcement vectors', () => {
    const roll = mulberry32(42);
    for (let w = 1; w <= 35; w++) {
      const squads = composeRooftopWave(w, roll);
      expect(squads.length).toBeGreaterThanOrEqual(2);
      for (const s of squads) {
        for (const id of s) expect(ROLE_OF[id]).toBeDefined();
      }
    }
    const vectors = new Set<string>();
    for (let w = 1; w <= 6; w++) {
      for (let i = 0; i < 3; i++) vectors.add(chooseReinforcementVector(w, i, true));
    }
    expect(vectors).toEqual(new Set(['stairwell', 'heli', 'paratrooper']));
  });

  it('makes FastRopeHeli and EnemyDoorGunner shootable soft-skins via regular firearms', () => {
    expect(VEHICLES.transport).toBe(TRANSPORT);
    expect(VEHICLES.doorGunner).toBe(DOOR_GUNNER);
    expect(TRANSPORT.armoured).toBe(false);
    expect(DOOR_GUNNER.armoured).toBe(false);
    expect(bulletDamage(TRANSPORT, TRANSPORT.parts[0]!, 25, 'harrow')).toBeGreaterThan(0);
    expect(bulletDamage(DOOR_GUNNER, DOOR_GUNNER.parts[0]!, 25, 'harrow')).toBeGreaterThan(0);
  });
});

describe('FastRopeHeli shoot-down payoff', () => {
  it('immediately kills remaining onboard AND currently rappelling SWAT troops with kill credit on shoot-down', () => {
    const h = makeHarness();
    const materials = new ModelMaterials(h.ctx);
    const zone = HOVER_DROP_ZONES[0]!;
    const lz = new THREE.Vector3(zone.x, zone.y, zone.z);
    // Spawn close to the hover point so approach finishes quickly in test steps.
    const from = new THREE.Vector3(zone.x + 2, zone.hoverY, zone.z);
    const squad: EnemyId[] = ['trooper', 'gunner', 'trooper', 'trooper'];
    h.manager.queued = squad.length;

    const heli = new FastRopeHeli(h.vehicles, materials, from, lz, zone.hoverY, squad, null);
    expect(heli.phase).toBe('approach');
    expect(heli.onboardCount).toBe(4);

    // Step until heli reaches deploy, extends ropes, and launches 2 rappellers while 2 stay onboard.
    for (let i = 0; i < 60 && heli.rappellingCount < 2; i++) {
      heli.update(0.08);
    }
    expect(heli.phase).toBe('deploy');
    expect(heli.rappellingCount).toBeGreaterThanOrEqual(1);
    expect(heli.onboardCount).toBeGreaterThanOrEqual(1);
    const onboardBefore = heli.onboardCount;
    const rappellingBefore = heli.rappellingCount;

    // Shoot down the transport helicopter mid-deployment!
    heli.take(TRANSPORT.health + 100, null, 'harrow', heli.position);

    expect(heli.phase).toBe('crashing');
    expect(heli.onboardCount).toBe(0);
    expect(heli.rappellingCount).toBe(0);
    expect(heli.hasActivePayload).toBe(false);
    expect(heli.wipedOnboard).toBe(onboardBefore);
    expect(heli.wipedRappelling).toBe(rappellingBefore);
    expect(h.killedMen).toHaveLength(rappellingBefore);
    for (const k of h.killedMen) {
      expect(k.enemy.alive).toBe(false);
      expect(k.enemy.pinned).toBe(false);
    }
    expect(h.manager.queued).toBe(0);
    expect(h.awards.some(a => a.label === 'SQUAD WIPED' && a.score >= TRANSPORT.squadWipeBonus)).toBe(true);
    expect(h.feeds.some(f => f.includes('SWAT TRANSPORT DOWN'))).toBe(true);

    // Let the crashing hull hit the rooftop deck and retire cleanly.
    for (let i = 0; i < 80 && !heli.retired; i++) {
      heli.update(0.1);
    }
    expect(heli.retired).toBe(true);
    expect(heli.alive).toBe(false);
  });
});

describe('ParatrooperSystem jet drop, mid-air shootability & landing', () => {
  it('deploys shootable mid-air paratroopers under canopies, collapses canopy on mid-air kill, and lands survivors cleanly', () => {
    const h = makeHarness();
    const para = new ParatrooperSystem(h.ctx, h.outpost, h.manager);
    const zone = PARATROOPER_ZONES[0]!;
    const squad: EnemyId[] = ['trooper', 'gunner', 'trooper', 'trooper'];
    h.manager.queued = squad.length;

    para.launchDrop(zone, squad, 0);
    expect(para.activeJets).toBe(1);
    expect(para.pendingCount).toBe(4);
    expect(h.audioPlays).toContain('warthog_flyby');
    expect(h.feeds).toContain('PARATROOPERS INBOUND');

    // Fly jet over zone until all 4 paratroopers jump.
    for (let i = 0; i < 80 && para.pendingCount > 0; i++) {
      para.update(0.05);
    }
    expect(para.pendingCount).toBe(0);
    expect(para.descendingCount).toBe(4);
    expect(h.manager.queued).toBe(0);
    expect(h.manager.alive).toHaveLength(4);
    for (const e of h.manager.alive) {
      expect(e.pinned).toBe(true);
      expect(e.position.y).toBeGreaterThan(zone.y + 10);
    }

    // Shoot down 1 paratrooper mid-air!
    const victim = h.manager.alive[0]!;
    victim.alive = false;
    para.update(0.05);
    expect(para.shotMidAirCount).toBe(1);
    expect(para.descendingCount).toBe(3);
    expect(victim.pinned).toBe(false);

    // Advance until remaining 3 paratroopers touch down on the rooftop deck.
    for (let i = 0; i < 250 && para.descendingCount > 0; i++) {
      para.update(0.05);
    }
    expect(para.descendingCount).toBe(0);
    expect(para.landedCount).toBe(3);

    const survivors = h.manager.alive.slice(1);
    for (const s of survivors) {
      expect(s.pinned).toBe(false);
      expect(s.position.y).toBeCloseTo(zone.y, 1);
      expect(s.groundY).toBeCloseTo(zone.y, 1);
      expect((s.char.anim as unknown as { plays: string[] }).plays).toContain('land');
    }
  });
});

describe('RooftopWaves boss & air-support dispatch integration', () => {
  it('dispatches Door Gunner air support on Wave 3, bosses on Waves 5/10/15/20, and NEVER spawns an enemy AC-130', () => {
    const h = makeHarness();
    const waves = new RooftopWaves(h.ctx, h.outpost, h.manager);
    waves.start();

    const stepFor = (seconds: number) => {
      const steps = Math.ceil(seconds / 0.1);
      for (let i = 0; i < steps; i++) {
        (h.ctx.time as { dt: number; elapsed: number }).dt = 0.1;
        (h.ctx.time as { dt: number; elapsed: number }).elapsed += 0.1;
        waves.update();
      }
    };

    // Wave 3: non-boss wave triggers Door Gunner support
    waves.jumpTo(3);
    stepFor(8);
    expect(h.spawnedDoorGunners.length).toBeGreaterThanOrEqual(1);

    // Wave 5: Attack Helicopter boss
    waves.jumpTo(5);
    stepFor(4);
    expect(h.spawnedChoppers.length).toBe(1);
    expect(h.audioPlays).toContain('boss_alarm');

    // Wave 10: Juggernaut dropped onto a BOSS_DROP_ZONES pad
    waves.jumpTo(10);
    stepFor(4);
    expect(h.spawnedBosses.some(b => b.id === 'juggernaut')).toBe(true);
    const jugg = h.spawnedBosses.find(b => b.id === 'juggernaut')!;
    expect(BOSS_DROP_ZONES.some(z => Math.hypot(z.x - jugg.at.x, z.z - jugg.at.z) < 0.1)).toBe(true);

    // Wave 15: Titan dropped onto a BOSS_DROP_ZONES pad
    waves.jumpTo(15);
    stepFor(4);
    expect(h.spawnedBosses.some(b => b.id === 'titan')).toBe(true);

    // Wave 20: Loops back to Attack Helicopter boss
    waves.jumpTo(20);
    stepFor(4);
    expect(h.spawnedChoppers.length).toBe(2);

    // Never an enemy AC-130 anywhere in spawnedAircraft telemetry
    for (const kind of waves.spawnedAircraft) {
      expect(kind.toLowerCase()).not.toContain('ac130');
    }
  });
});
