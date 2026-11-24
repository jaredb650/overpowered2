import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../../core/contracts';
import type { MissileTarget, VehicleRadarTarget } from '../../core/gameplay';
import { pickContract } from '../../contracts/select';
import { ModelMaterials } from '../../progression/modelkit';
import {
  CARRIER_AIRCRAFT_TERMINAL,
  CARRIER_CATAPULT_PAD,
  CARRIER_CIWS_MOUNTS,
  CARRIER_DECK_RECT,
  CARRIER_DECK_Y,
  CARRIER_DEFENSE_TERMINAL,
  CARRIER_SAM_MOUNTS,
  DOGFIGHT_BOUNDS,
  DOGFIGHT_ESCORTS,
  DOGFIGHT_LIGHT_BOUNDS,
  DOGFIGHT_LIGHT_CELL,
  DOGFIGHT_NAV_BOUNDS,
  DOGFIGHT_PLAYER_SPAWN,
  DOGFIGHT_SEA_STACKS,
  DOGFIGHT_SKY_SPAWNS,
} from '../../world/map/dogfight/plan';
import { SURVIVAL_MAPS, modesOn } from '../../ui/screens/mainmenu';
import { AiCombatJet } from './aiJet';
import { CARRIER_BASE_HP, CARRIER_START_CREDITS, CarrierDefenseSystem } from './carrier';
import { HANGAR_AIRCRAFT } from './terminalUi';
import { DogfightWaves, dogfightWaveRoster, dogfightWaveSkill } from './waves';
import { DogfightWreckageSystem, choosePilotFate } from './wreckage';

function mockCtx(): { ctx: Ctx; emitEvent: (ev: string, payload?: unknown) => void } {
  const scene = new THREE.Scene();
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const ctx = {
    time: { dt: 1 / 30, elapsed: 0 },
    player: {
      alive: true,
      parked: true,
      position: new THREE.Vector3(0, 95, -80),
      velocity: new THREE.Vector3(0, 0, 0),
      teleport: vi.fn(),
      takeDamage: vi.fn(),
    },
    input: {
      pressed: vi.fn(() => false),
      labelFor: vi.fn(() => 'E'),
    },
    events: {
      on: vi.fn((ev: string, fn: (...args: unknown[]) => void) => {
        const arr = listeners.get(ev) ?? [];
        arr.push(fn);
        listeners.set(ev, arr);
        return () => {};
      }),
      emit: vi.fn((ev: string, payload?: unknown) => {
        for (const fn of listeners.get(ev) ?? []) fn(payload);
      }),
    },
    render: { scene, materials: { patch: (m: unknown) => m } },
    audio: { play: vi.fn() },
    fx: { sparks: vi.fn(), explosion: vi.fn() },
    hud: {
      feed: vi.fn(),
      hitMarker: vi.fn(),
      follow: vi.fn(() => vi.fn()),
    },
    physics: {
      addStaticBox: vi.fn(() => ({
        handle: Math.floor(Math.random() * 100_000) + 1,
        setTranslation: vi.fn(),
        setRotation: vi.fn(),
      })),
      world: { removeCollider: vi.fn() },
    },
  } as unknown as Ctx;
  return {
    ctx,
    emitEvent: (ev: string, payload?: unknown) => {
      for (const fn of listeners.get(ev) ?? []) fn(payload);
    },
  };
}

describe('Dogfight Map Plan & Registration', () => {
  it('expands ocean airspace to >=10x Badlands while keeping navBounds compact over the carrier', () => {
    const width = DOGFIGHT_BOUNDS.x1 - DOGFIGHT_BOUNDS.x0;
    const depth = DOGFIGHT_BOUNDS.z1 - DOGFIGHT_BOUNDS.z0;
    const height = DOGFIGHT_BOUNDS.y1 - DOGFIGHT_BOUNDS.y0;
    // Badlands is ~124,000 m^2; Dogfight must be >= 10x that area!
    expect(width * depth).toBeGreaterThanOrEqual(1_240_000);
    expect(height).toBeGreaterThanOrEqual(300);

    // NavGraph bounds stay tight around USS Sovereign (< 25k 1m cells) for fast loading.
    const navArea = (DOGFIGHT_NAV_BOUNDS.x1 - DOGFIGHT_NAV_BOUNDS.x0) * (DOGFIGHT_NAV_BOUNDS.z1 - DOGFIGHT_NAV_BOUNDS.z0);
    expect(navArea).toBeLessThan(25_000);
    expect(DOGFIGHT_NAV_BOUNDS.x0).toBeLessThanOrEqual(CARRIER_DECK_RECT.x0);
    expect(DOGFIGHT_NAV_BOUNDS.x1).toBeGreaterThanOrEqual(CARRIER_DECK_RECT.x1);
    expect(DOGFIGHT_NAV_BOUNDS.z0).toBeLessThanOrEqual(CARRIER_DECK_RECT.z0);
    expect(DOGFIGHT_NAV_BOUNDS.z1).toBeGreaterThanOrEqual(CARRIER_DECK_RECT.z1);

    expect(DOGFIGHT_ESCORTS.length).toBeGreaterThanOrEqual(2);
    expect(DOGFIGHT_SEA_STACKS.length).toBeGreaterThanOrEqual(6);
  });

  it('keeps LightVolume voxel dimensions strictly inside the 200x48 cell budget', () => {
    const nx = Math.ceil((DOGFIGHT_LIGHT_BOUNDS.x1 - DOGFIGHT_LIGHT_BOUNDS.x0) / DOGFIGHT_LIGHT_CELL);
    const ny = Math.ceil((DOGFIGHT_LIGHT_BOUNDS.y1 - DOGFIGHT_LIGHT_BOUNDS.y0) / DOGFIGHT_LIGHT_CELL);
    const nz = Math.ceil((DOGFIGHT_LIGHT_BOUNDS.z1 - DOGFIGHT_LIGHT_BOUNDS.z0) / DOGFIGHT_LIGHT_CELL);
    expect(nx).toBeLessThanOrEqual(200);
    expect(nz).toBeLessThanOrEqual(200);
    expect(ny).toBeLessThanOrEqual(48);
  });

  it('places player spawn, catapult pad, and deck terminals cleanly on the flight deck', () => {
    for (const pt of [DOGFIGHT_PLAYER_SPAWN, CARRIER_CATAPULT_PAD, CARRIER_AIRCRAFT_TERMINAL, CARRIER_DEFENSE_TERMINAL]) {
      expect(pt[1]).toBe(CARRIER_DECK_Y);
      expect(pt[0]).toBeGreaterThanOrEqual(CARRIER_DECK_RECT.x0);
      expect(pt[0]).toBeLessThanOrEqual(CARRIER_DECK_RECT.x1);
      expect(pt[2]).toBeGreaterThanOrEqual(CARRIER_DECK_RECT.z0);
      expect(pt[2]).toBeLessThanOrEqual(CARRIER_DECK_RECT.z1);
    }
    expect(CARRIER_CIWS_MOUNTS.length).toBe(4);
    expect(CARRIER_SAM_MOUNTS.length).toBe(3);
  });

  it('places all sky spawns inside Dogfight airspace bounds', () => {
    for (const [x, y, z] of DOGFIGHT_SKY_SPAWNS) {
      expect(x).toBeGreaterThan(DOGFIGHT_BOUNDS.x0);
      expect(x).toBeLessThan(DOGFIGHT_BOUNDS.x1);
      expect(y).toBeGreaterThan(CARRIER_DECK_Y + 20);
      expect(y).toBeLessThan(DOGFIGHT_BOUNDS.y1);
      expect(z).toBeGreaterThan(DOGFIGHT_BOUNDS.z0);
      expect(z).toBeLessThan(DOGFIGHT_BOUNDS.z1);
    }
  });

  it('registers Dogfight in contracts, Survival menu, and hangar roster', () => {
    const picked = pickContract('dogfight', null);
    expect(picked.def.id).toBe('dogfight');
    expect(picked.map).toBe('dogfight');
    expect(picked.ranked).toBe(true);
    expect(SURVIVAL_MAPS.some(m => m.map === 'dogfight' && m.name === 'Dogfight')).toBe(true);
    expect(modesOn('dogfight').map(c => c.id)).toContain('dogfight');
    expect(HANGAR_AIRCRAFT.map(a => a.id)).toEqual(['hornet', 'raptor', 'lancer', 'harrier', 'warthog', 'kestrel']);
  });
});

describe('Dogfight Wave Scaling & Pilot Skill', () => {
  it('starts gentle on Wave 1 and escalates through Lancer bombers and Raptor Aces', () => {
    expect(dogfightWaveRoster(1)).toEqual(['hornet', 'hornet']);
    expect(dogfightWaveRoster(2)).toContain('harrier');
    expect(dogfightWaveRoster(3)).toContain('warthog');
    expect(dogfightWaveRoster(4)).toContain('lancer');
    expect(dogfightWaveRoster(5)).toContain('raptor');
    expect(dogfightWaveRoster(10).filter(k => k === 'raptor').length).toBeGreaterThanOrEqual(2);
  });

  it('smoothly scales pilot skill from rookie to elite ace', () => {
    expect(dogfightWaveSkill(1)).toBeCloseTo(0.35, 2);
    expect(dogfightWaveSkill(5)).toBeGreaterThan(dogfightWaveSkill(1));
    expect(dogfightWaveSkill(10)).toBe(1.0);
  });
});

describe('CarrierDefenseSystem', () => {
  it('handles credit upgrades for CIWS, SAM, Hull Armor, Wingmen, and Emergency Repair', () => {
    const { ctx } = mockCtx();
    const onCiwsShot = vi.fn();
    const onSamLaunch = vi.fn();
    const onSpawnWingman = vi.fn();
    const onCarrierDestroyed = vi.fn();

    const carrier = new CarrierDefenseSystem(ctx, {
      onCiwsShot,
      onSamLaunch,
      onSpawnWingman,
      onCarrierDestroyed,
    });

    expect(carrier.hp).toBe(CARRIER_BASE_HP);
    expect(carrier.credits).toBe(CARRIER_START_CREDITS);

    // Buy CIWS Lv 1 with starting credits (250 CR)
    expect(carrier.purchase('ciws').ok).toBe(true);
    expect(carrier.ciwsLevel).toBe(1);
    expect(carrier.credits).toBe(CARRIER_START_CREDITS - 250);

    // Insufficient credits for SAM Lv 1 (300 CR)
    expect(carrier.purchase('sam').ok).toBe(false);

    // Add credits and buy SAM Lv 1, Hull Armor Lv 1, and Wingman Lv 1
    carrier.addCredits(2000);
    expect(carrier.purchase('sam').ok).toBe(true);
    expect(carrier.samLevel).toBe(1);

    expect(carrier.purchase('armor').ok).toBe(true);
    expect(carrier.armorLevel).toBe(1);
    expect(carrier.maxHp).toBe(CARRIER_BASE_HP + 1000);

    expect(carrier.purchase('wingman').ok).toBe(true);
    expect(carrier.wingmanLevel).toBe(1);
    expect(onSpawnWingman).toHaveBeenCalledWith('hornet');

    // Damage hull & verify auto-repair + emergency repair
    carrier.damageHull(600, new THREE.Vector3(0, 10, 0), 'B-1 LANCER');
    const hpAfterHit = carrier.hp;
    carrier.update(1.0, []);
    expect(carrier.hp).toBeGreaterThan(hpAfterHit);

    expect(carrier.purchase('repair').ok).toBe(true);
    expect(carrier.hp).toBe(carrier.maxHp);

    // Fatal hull damage triggers carrier destruction callback
    carrier.damageHull(99_999, new THREE.Vector3(0, 10, 0), 'B-1 LANCER');
    expect(carrier.destroyed).toBe(true);
    expect(onCarrierDestroyed).toHaveBeenCalledTimes(1);
  });
});

describe('AiCombatJet Combat & ExtraTarget Integration', () => {
  it('flies smoothly, exposes paintable & radarTargets for AA Lead Pips, takes damage, and triggers kill callback', () => {
    const { ctx } = mockCtx();
    const materials = new ModelMaterials(ctx);
    const onKilled = vi.fn();
    const onCarrierStrike = vi.fn();

    const jet = new AiCombatJet(
      ctx,
      materials,
      'raptor',
      'enemy',
      new THREE.Vector3(0, 75, -140),
      0,
      0.85,
      {
        onGunShot: vi.fn(),
        onMissileLaunch: vi.fn(),
        onCarrierStrike,
        onKilled,
      },
      undefined,
      'hunter',
    );

    const paintList: MissileTarget[] = [];
    jet.paintable(paintList);
    expect(paintList).toHaveLength(1);
    expect(paintList[0]).toBe(jet);

    const radarList: VehicleRadarTarget[] = [];
    jet.radarTargets(radarList);
    expect(radarList).toHaveLength(1);
    expect(radarList[0]!.airborne).toBe(true);

    // Step flight forward and verify movement + dogfight state acquisition when player is airborne
    const startZ = jet.position.z;
    for (let i = 0; i < 30; i++) {
      jet.update(1 / 30, new THREE.Vector3(20, 65, -40), new THREE.Vector3(0, 0, -45), true, []);
    }
    expect(jet.position.z).toBeGreaterThan(startZ);
    expect(['dogfight', 'extend', 'evade']).toContain(jet.state);

    // Deal lethal blast damage and confirm death spiral + kill callback
    const caught = jet.blast(jet.position.clone(), {
      radius: 15,
      damage: 2500,
      kind: 'rocket',
      source: 'aim9x',
      team: 'player',
      scale: 1,
    });
    expect(caught).toBe(1);
    expect(jet.alive).toBe(false);
    expect(jet.state).toBe('dying');
    expect(onKilled).toHaveBeenCalledTimes(1);

    // Dead jet must no longer expose paintable or radar target
    paintList.length = 0;
    radarList.length = 0;
    jet.paintable(paintList);
    jet.radarTargets(radarList);
    expect(paintList).toHaveLength(0);
    expect(radarList).toHaveLength(0);

    jet.dispose();
  });

  it('hunts an airborne player from long range, ramps radar lock, fires Fox-2, and breaks lock on flares', () => {
    const { ctx } = mockCtx();
    const materials = new ModelMaterials(ctx);
    const onMissileLaunch = vi.fn();

    // Place enemy hunter Hornet 320 m behind an airborne player flying straight ahead (+Z)
    const jet = new AiCombatJet(
      ctx,
      materials,
      'hornet',
      'enemy',
      new THREE.Vector3(0, 100, -220),
      0, // facing +Z straight at player!
      0.9,
      {
        onGunShot: vi.fn(),
        onMissileLaunch,
        onCarrierStrike: vi.fn(),
        onKilled: vi.fn(),
      },
      undefined,
      'hunter',
    );

    const playerPos = new THREE.Vector3(0, 100, 120);
    const playerVel = new THREE.Vector3(0, 0, 58);

    // First step transitions from approach -> dogfight immediately (even at 340 m range!)
    jet.update(1 / 30, playerPos, playerVel, true, []);
    expect(jet.state).toBe('dogfight');

    // Advance until radar lock builds and Fox-2 missile launches
    let sawLock = false;
    for (let i = 0; i < 360; i++) {
      playerPos.addScaledVector(playerVel, 1 / 30);
      jet.update(1 / 30, playerPos, playerVel, true, []);
      if (jet.isLockingPlayer) sawLock = true;
      if (onMissileLaunch.mock.calls.length > 0) break;
    }
    expect(sawLock).toBe(true);
    expect(onMissileLaunch).toHaveBeenCalledTimes(1);

    // Break lock with player IR flares
    jet.playerLockProgress = 0.75;
    jet.breakPlayerLock(4.0);
    expect(jet.playerLockProgress).toBe(0);
    expect(jet.isLockingPlayer).toBe(false);

    jet.dispose();
  });

  it('emits cockpit RWR lock/missile warnings and decoys inbound enemy Fox-2 missiles on player IR flares', () => {
    const { ctx, emitEvent } = mockCtx();
    const waves = new DogfightWaves(
      ctx,
      {} as never,
      { vehicles: { addExtra: vi.fn(), removeExtra: vi.fn() } } as never,
    );

    waves.start();
    // Skip intermission so Wave 1 spawns enemy hunters
    waves.nextWaveIn = 0.01;
    waves.update();
    // Advance spawn timer so first Hornet spawns
    for (let i = 0; i < 15; i++) waves.update();
    expect(waves.enemies.length).toBeGreaterThanOrEqual(1);

    const hunter = waves.enemies[0]!;
    expect(hunter.tacticalRole).toBe('hunter');

    // Simulate active radar lock + inbound Fox-2 missile on player
    hunter.position.set(0, 100, -240);
    hunter.yaw = 0;
    hunter.playerLockProgress = 0.65;
    (ctx.player.position as THREE.Vector3).set(0, 100, -40);
    waves.update();

    const emitSpy = ctx.events.emit as unknown as ReturnType<typeof vi.fn>;
    const rwrCalls = emitSpy.mock.calls.filter(c => c[0] === 'dogfight:rwr');
    expect(rwrCalls.length).toBeGreaterThan(0);
    expect(rwrCalls[rwrCalls.length - 1]![1]).toMatchObject({ locking: true });

    // Trigger player IR flares -> breaks lock and clears RWR!
    emitEvent('dogfight:player_flares', { position: ctx.player.position });
    expect(hunter.playerLockProgress).toBe(0);

    const finalRwr = emitSpy.mock.calls.filter(c => c[0] === 'dogfight:rwr').pop()?.[1] as {
      locking: boolean;
      missileInbound: boolean;
    };
    expect(finalRwr.locking).toBe(false);
    expect(finalRwr.missileInbound).toBe(false);

    waves.dispose();
  });
});

describe('Distinct AI Aircraft Doctrines & Ordnance Preferences', () => {
  it('enforces B-1 Lancer as a pure strategic carrier bomber (no guns, no missiles, drops real bomb sticks)', () => {
    const { ctx } = mockCtx();
    const materials = new ModelMaterials(ctx);
    const onGunShot = vi.fn();
    const onMissileLaunch = vi.fn();
    const onBombDrop = vi.fn();

    const lancer = new AiCombatJet(
      ctx,
      materials,
      'lancer',
      'enemy',
      new THREE.Vector3(0, 96, -210),
      0, // heading +Z straight over USS Sovereign
      0.85,
      {
        onGunShot,
        onMissileLaunch,
        onBombDrop,
        onCarrierStrike: vi.fn(),
        onKilled: vi.fn(),
      },
      undefined,
      'striker',
    );

    expect(lancer.profile.doctrine).toBe('heavy_bomber');
    expect(lancer.profile.hasGun).toBe(false);
    expect(lancer.profile.hasMissiles).toBe(false);

    // Even when taking damage with an airborne player right nearby, Lancer never enters dogfight or shoots guns
    lancer.applyDamage(80, lancer.position.clone(), 'player_gun', true);
    const playerPos = new THREE.Vector3(25, 96, -120);
    const playerVel = new THREE.Vector3(0, 0, 50);

    for (let i = 0; i < 480; i++) {
      lancer.update(1 / 30, playerPos, playerVel, true, []);
      expect(lancer.state).not.toBe('dogfight');
      if (onBombDrop.mock.calls.length >= 5) break;
    }

    expect(onGunShot).not.toHaveBeenCalled();
    expect(onMissileLaunch).not.toHaveBeenCalled();
    expect(onBombDrop.mock.calls.length).toBeGreaterThanOrEqual(5);
    // Confirm bombs dropped are Lancer heavy/parachute ordnance
    for (const call of onBombDrop.mock.calls) {
      expect(['mk84', 'para']).toContain(call[2]);
    }

    lancer.dispose();
  });

  it('flies A-10 Warthog with CAS doctrine alternating heavy 30mm GAU-8 strafe bursts and dive-bomb drops', () => {
    const { ctx } = mockCtx();
    const materials = new ModelMaterials(ctx);
    const onCarrierGunStrafe = vi.fn();
    const onBombDrop = vi.fn();

    const warthog = new AiCombatJet(
      ctx,
      materials,
      'warthog',
      'enemy',
      new THREE.Vector3(0, 62, -230),
      0,
      0.85,
      {
        onGunShot: vi.fn(),
        onMissileLaunch: vi.fn(),
        onBombDrop,
        onCarrierGunStrafe,
        onCarrierStrike: vi.fn(),
        onKilled: vi.fn(),
      },
      undefined,
      'striker',
    );

    expect(warthog.profile.doctrine).toBe('cas_attacker');

    // Run two full carrier attack runs so both GAU-8 strafe and dive-bomb passes execute
    const playerOnDeck = new THREE.Vector3(0, CARRIER_DECK_Y, 0);
    const zeroVel = new THREE.Vector3();
    for (let i = 0; i < 900; i++) {
      warthog.update(1 / 30, playerOnDeck, zeroVel, false, []);
      if (onCarrierGunStrafe.mock.calls.length > 0 && onBombDrop.mock.calls.length > 0) break;
    }

    expect(onCarrierGunStrafe.mock.calls.length).toBeGreaterThan(0);
    // All Warthog strafe rounds must be marked heavy (30mm GAU-8)
    expect(onCarrierGunStrafe.mock.calls.every(c => c[4] === true)).toBe(true);
    expect(onBombDrop.mock.calls.length).toBeGreaterThan(0);
    for (const call of onBombDrop.mock.calls) {
      expect(['mk82', 'cluster']).toContain(call[2]);
    }

    warthog.dispose();
  });

  it('flies striker AV-8B Harrier firing Hydra rocket salvos onto the carrier', () => {
    const { ctx } = mockCtx();
    const materials = new ModelMaterials(ctx);
    const onCarrierRocket = vi.fn();

    const harrier = new AiCombatJet(
      ctx,
      materials,
      'harrier',
      'enemy',
      new THREE.Vector3(0, 68, -220),
      0,
      0.8,
      {
        onGunShot: vi.fn(),
        onMissileLaunch: vi.fn(),
        onCarrierRocket,
        onCarrierStrike: vi.fn(),
        onKilled: vi.fn(),
      },
      undefined,
      'striker',
    );

    expect(harrier.profile.doctrine).toBe('rocket_striker');
    const playerOnDeck = new THREE.Vector3(0, CARRIER_DECK_Y, 0);
    const zeroVel = new THREE.Vector3();
    for (let i = 0; i < 360; i++) {
      harrier.update(1 / 30, playerOnDeck, zeroVel, false, []);
      if (onCarrierRocket.mock.calls.length >= 3) break;
    }

    expect(onCarrierRocket.mock.calls.length).toBeGreaterThanOrEqual(3);
    harrier.dispose();
  });
});

describe('Explosive Jet Breakup, Ejected Pilot Fates & Real Falling Bombs', () => {
  function mockWreckageHarness() {
    const { ctx } = mockCtx();
    const gore = {
      burnOn: vi.fn(),
      sever: vi.fn(),
      ragdoll: vi.fn(),
      gib: vi.fn(),
    };
    const characters = {
      spawn: vi.fn(() => ({
        root: new THREE.Group(),
        bones: Array.from({ length: 17 }, () => new THREE.Group()),
        setBurn: vi.fn(),
        setBloodiness: vi.fn(),
      })),
    };
    const progression = { award: vi.fn() };
    Object.assign(ctx, { gore, characters, progression });

    const spawnedEnemies: Array<{
      alive: boolean;
      scriptedNpc: boolean;
      pinned: boolean;
      mode: string;
      face: string;
      attacks: unknown[];
      behaviours: unknown[];
      maxHealth: number;
      health: number;
      score: number;
      groundY: number;
      position: THREE.Vector3;
      velocity: THREE.Vector3;
      char: { root: THREE.Group; bones: THREE.Group[] };
    }> = [];

    const despawn = vi.fn((e: { alive: boolean }) => {
      e.alive = false;
    });
    const manager = {
      spawn: vi.fn((_kind: string, pos: THREE.Vector3) => {
        const handR = new THREE.Group();
        const smg = new THREE.Mesh();
        smg.name = 'smg';
        handR.add(smg);
        const bones = Array.from({ length: 17 }, (_, idx) => (idx === 10 ? handR : new THREE.Group()));
        const e = {
          alive: true,
          scriptedNpc: false,
          pinned: false,
          mode: 'advance',
          face: 'player',
          attacks: [{ id: 'smg' }],
          behaviours: [{ id: 'chase' }],
          maxHealth: 100,
          health: 100,
          score: 100,
          groundY: 0,
          position: pos.clone(),
          velocity: new THREE.Vector3(),
          char: { root: new THREE.Group(), bones },
        };
        spawnedEnemies.push(e);
        return e;
      }),
      despawn,
    };

    const onBombHitCarrier = vi.fn();
    const wreckage = new DogfightWreckageSystem(ctx, manager as never, { onBombHitCarrier });
    return { ctx, gore, characters, progression, manager, spawnedEnemies, despawn, onBombHitCarrier, wreckage };
  }

  it('shatters killed jets into 7 tumbling physical wreckage chunks instead of keeping an intact plane', () => {
    const { ctx, wreckage } = mockWreckageHarness();
    wreckage.shatterJet(
      'hornet',
      new THREE.Vector3(0, 90, 0),
      new THREE.Vector3(0, 0, 60),
      0,
      0,
      0.2,
    );

    expect(wreckage.shatteredJets).toBe(1);
    expect(wreckage.activeChunkCount).toBe(7);
    expect(ctx.audio.play).toHaveBeenCalledWith('veh_destroyed', expect.objectContaining({ position: expect.any(THREE.Vector3) }));

    // Advance physics until chunks fall & splash into the ocean or expire
    for (let i = 0; i < 360; i++) wreckage.update(1 / 30);
    expect(wreckage.activeChunkCount).toBe(0);
    wreckage.dispose();
  });

  it('covers all 4 pilot fates deterministically: unarmed shootable parachuter, burning ragdoll, mangled ragdoll, and gibbed', () => {
    expect(choosePilotFate('hornet', false, 0.1)).toBe('eject_chute');
    expect(choosePilotFate('hornet', false, 0.55)).toBe('burning_ragdoll');
    expect(choosePilotFate('hornet', false, 0.75)).toBe('mangled_ragdoll');
    expect(choosePilotFate('hornet', false, 0.95)).toBe('gibbed');
    expect(choosePilotFate('lancer', true, 0.4)).toBe('gibbed');

    const { wreckage, gore, progression, spawnedEnemies, despawn } = mockWreckageHarness();
    const cockpit = new THREE.Vector3(0, 85, 0);
    const vel = new THREE.Vector3(0, 0, 50);

    // 1. Ejected shootable parachuting pilot
    const fate1 = wreckage.spawnPilotFate('hornet', cockpit, vel, 'vulcan', false, 'eject_chute');
    expect(fate1).toBe('eject_chute');
    expect(wreckage.activePilotCount).toBe(1);
    const pilot = spawnedEnemies[0]!;
    expect(pilot.scriptedNpc).toBe(true);
    expect(pilot.pinned).toBe(true);
    expect(pilot.attacks).toEqual([]);
    expect(pilot.face).toBe('move');
    expect(pilot.char.bones[10]!.getObjectByName('smg')?.visible).toBe(false);

    // Step past rocket boost so canopy opens, then simulate player shooting the pilot mid-air!
    for (let i = 0; i < 30; i++) wreckage.update(1 / 30);
    pilot.alive = false;
    wreckage.update(1 / 30);
    expect(wreckage.ejectedPilotsShot).toBe(1);
    expect(wreckage.activePilotCount).toBe(0);
    expect(progression.award).toHaveBeenCalledWith(150, 'EJECTED PILOT SPLASHED', expect.any(THREE.Vector3));

    // 2. Unshot parachuter splashing into sea despawns silently without bonus score
    progression.award.mockClear();
    wreckage.spawnPilotFate('hornet', new THREE.Vector3(0, 12, 0), new THREE.Vector3(), 'vulcan', false, 'eject_chute');
    for (let i = 0; i < 180; i++) wreckage.update(1 / 30);
    expect(wreckage.activePilotCount).toBe(0);
    expect(despawn).toHaveBeenCalled();
    expect(progression.award).not.toHaveBeenCalled();

    // 3. Burning ragdoll
    wreckage.spawnPilotFate('hornet', cockpit, vel, 'vulcan', false, 'burning_ragdoll');
    expect(gore.burnOn).toHaveBeenCalled();
    expect(gore.ragdoll).toHaveBeenCalledTimes(1);

    // 4. Mangled ragdoll (severs 1-2 limbs + ragdoll)
    wreckage.spawnPilotFate('warthog', cockpit, vel, 'vulcan', false, 'mangled_ragdoll');
    expect(gore.sever).toHaveBeenCalled();
    expect(gore.ragdoll).toHaveBeenCalledTimes(2);

    // 5. Mid-air gore gib explosion
    wreckage.spawnPilotFate('raptor', cockpit, vel, 'aim9x', true, 'gibbed');
    expect(gore.gib).toHaveBeenCalledTimes(1);
    expect(wreckage.gibbedPilotsSpawned).toBe(1);

    wreckage.dispose();
  });

  it('drops real 3D gravity-driven bombs that damage USS Sovereign on deck hits and splash harmlessly in the open ocean', () => {
    const { wreckage, onBombHitCarrier } = mockWreckageHarness();

    // Bomb 1: directly over USS Sovereign flight deck -> must hit carrier!
    wreckage.spawnBomb(new THREE.Vector3(0, 65, 0), new THREE.Vector3(0, -10, 0), 'mk84', 95, 'B-1 LANCER');
    // Bomb 2: parachute bomb far out over open ocean -> must splash with zero carrier damage!
    wreckage.spawnBomb(new THREE.Vector3(240, 55, 240), new THREE.Vector3(0, -6, 0), 'para', 95, 'B-1 LANCER');
    expect(wreckage.activeBombCount).toBe(2);

    for (let i = 0; i < 300; i++) wreckage.update(1 / 30);

    expect(wreckage.activeBombCount).toBe(0);
    expect(onBombHitCarrier).toHaveBeenCalledTimes(1);
    expect(onBombHitCarrier).toHaveBeenCalledWith(expect.any(THREE.Vector3), 95, 'B-1 LANCER', true);

    wreckage.dispose();
  });
});

