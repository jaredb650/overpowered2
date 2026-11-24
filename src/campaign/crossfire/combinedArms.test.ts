import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ally } from '../../allies/ally';
import type { Ctx } from '../../core/contracts';
import type { MissileTarget } from '../../core/gameplay';
import { AI_JET_PROFILES, AiCombatJet, type AiJetFireCallbacks } from '../../enemies/dogfight/aiJet';
import { jetPartProfile } from '../../enemies/dogfight/wreckage';
import { MAX_CHOPPERS, VehicleSystem } from '../../enemies/vehicles';
import { ModelMaterials } from '../../progression/modelkit';
import { AiVehicleFleet } from '../../vehicles/drive/aiDriver';
import { HALCYON_DEFENSE_SITES } from '../../world/map/halcyon/targets';
import { STRAIT_DESTROYER_MOUNTS } from '../../world/map/strait/plan';
import {
  BASE_DEFENSE_SPECS,
  BaseDefenseSystem,
  RADAR_DOME_FIRE_RATE_BONUS,
} from './baseDefense';

function createMockCtx(opts?: {
  playerPos?: THREE.Vector3;
  allies?: Ally[];
  enemyUnits?: Array<{ alive: boolean; center: THREE.Vector3; position: THREE.Vector3; health: number }>;
  enemyVehicles?: Array<{ alive: boolean; retired: boolean; center: THREE.Vector3; def: { armoured: boolean }; take: ReturnType<typeof vi.fn> }>;
}) {
  const scene = new THREE.Scene();
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const spawnedAllies: Ally[] = [...(opts?.allies ?? [])];
  const enemyUnits = opts?.enemyUnits ?? [];
  const enemyVehicles = opts?.enemyVehicles ?? [];
  const applyDamage = vi.fn((enemy: { alive: boolean; health: number }, info: { amount: number }) => {
    enemy.health -= info.amount;
    if (enemy.health <= 0) enemy.alive = false;
  });
  const vehicleBlast = vi.fn();

  const ctx = {
    time: { dt: 1 / 30, elapsed: 0 },
    player: {
      alive: true,
      parked: false,
      interceptor: null,
      position: opts?.playerPos?.clone() ?? new THREE.Vector3(0, 0, 0),
      velocity: new THREE.Vector3(0, 0, 0),
      takeDamage: vi.fn(),
    },
    events: {
      on: vi.fn((ev: string, fn: (...args: unknown[]) => void) => {
        let set = listeners.get(ev);
        if (!set) {
          set = new Set();
          listeners.set(ev, set);
        }
        set.add(fn);
        return () => set!.delete(fn);
      }),
      emit: vi.fn((ev: string, payload?: unknown) => {
        for (const fn of listeners.get(ev) ?? []) fn(payload);
      }),
    },
    render: {
      scene,
      materials: { patch: (m: unknown) => m },
      lights: { flash: vi.fn() },
      decals: { add: vi.fn() },
      highlight: vi.fn(),
    },
    audio: {
      play: vi.fn(),
      startLoop: vi.fn(() => ({ setPosition: vi.fn(), setPitch: vi.fn(), setVolume: vi.fn(), stop: vi.fn() })),
    },
    fx: {
      sparks: vi.fn(),
      explosion: vi.fn(),
      smoke: vi.fn(),
      tracer: vi.fn(),
      muzzleFlash: vi.fn(),
      chips: vi.fn(),
      ring: vi.fn(),
      dust: vi.fn(),
      attachEmitter: vi.fn(() => ({ stop: vi.fn() })),
    },
    hud: {
      feed: vi.fn(),
      hitMarker: vi.fn(),
      floatText: vi.fn(),
      follow: vi.fn(() => vi.fn()),
    },
    progression: {
      award: vi.fn(),
    },
    campaign: {
      provide: vi.fn(),
      unitGone: vi.fn(),
    },
    world: {
      bounds: { min: new THREE.Vector3(-600, 0, -600), max: new THREE.Vector3(600, 300, 600) },
      nav: {
        groundHeight: vi.fn(() => 0),
      },
    },
    physics: {
      R: {
        Ray: class {
          constructor(public origin: unknown, public dir: unknown) {}
        },
      },
      addStaticBox: vi.fn(() => ({
        handle: Math.floor(Math.random() * 1_000_000) + 1,
        setTranslation: vi.fn(),
        setRotation: vi.fn(),
      })),
      raycast: vi.fn(() => null),
      raycastInto: vi.fn(() => false),
      world: {
        removeCollider: vi.fn(),
        castRay: vi.fn(() => null),
      },
    },
    combat: {
      spawnProjectile: vi.fn(),
      enemyMuzzle: vi.fn(),
      fireRay: vi.fn(),
      explode: vi.fn(),
    },
    allies: {
      allies: spawnedAllies,
      spawn: vi.fn((type: string, at: THREE.Vector3) => {
        const fakeAlly = {
          alive: true,
          type,
          body: {
            position: at.clone(),
            velocity: new THREE.Vector3(),
            center: at.clone().setY(at.y + 1),
          },
          center: at.clone().setY(at.y + 1),
          shotAt: vi.fn(),
          blast: vi.fn(),
        } as unknown as Ally;
        spawnedAllies.push(fakeAlly);
        return fakeAlly;
      }),
    },
    enemies: {
      query: vi.fn((center: THREE.Vector3, radius: number, out: unknown[]) => {
        let count = 0;
        for (const e of enemyUnits) {
          if (!e.alive) continue;
          if (e.center.distanceTo(center) <= radius) {
            out[count++] = e;
          }
        }
        return count;
      }),
      applyDamage,
      vehicles: {
        live: enemyVehicles,
        blast: vehicleBlast,
        addExtra: vi.fn(),
        removeExtra: vi.fn(),
      },
    },
  } as unknown as Ctx;

  return {
    ctx,
    scene,
    spawnedAllies,
    applyDamage,
    vehicleBlast,
    emit: (ev: string, payload?: unknown) => (ctx.events.emit as unknown as (e: string, p?: unknown) => void)(ev, payload),
  };
}

function makeJetCallbacks(overrides?: Partial<AiJetFireCallbacks>): AiJetFireCallbacks {
  return {
    onGunShot: vi.fn(),
    onMissileLaunch: vi.fn(),
    onCarrierStrike: vi.fn(),
    onKilled: vi.fn(),
    ...overrides,
  };
}

describe('Phase 2: Scaled B-1B Lancer, Escort Bomber & Two-Way AI Dogfighting', () => {
  it('uses scaled Lancer hitbox [13.4, 3.6, 14.2] and 1.8x wreckage chunks', () => {
    expect(AI_JET_PROFILES.lancer.hitboxHalf).toEqual([13.4, 3.6, 14.2]);
    const lancerWreck = jetPartProfile('lancer');
    const hornetWreck = jetPartProfile('hornet');
    expect(lancerWreck.chunkScale).toBeCloseTo(1.8, 2);
    expect(lancerWreck.wingSpan).toBeGreaterThan(hornetWreck.wingSpan * 2.5);
    expect(lancerWreck.hullLen).toBeGreaterThan(hornetWreck.hullLen * 2.2);
  });

  it('flies an allied escort_bomber Lancer with hpOverride along waypoints, tracks 0..1 progress, and pops flares on lock', () => {
    const { ctx } = createMockCtx();
    const materials = new ModelMaterials(ctx);
    const onComplete = vi.fn();

    const wps = [
      new THREE.Vector3(0, 110, -120),
      new THREE.Vector3(0, 110, -280),
      new THREE.Vector3(0, 110, -440),
    ];

    const lancer = new AiCombatJet(
      ctx,
      materials,
      'lancer',
      'ally',
      new THREE.Vector3(0, 110, 0),
      Math.PI,
      0.85,
      makeJetCallbacks(),
      'IRONCLAD-1 (B-1B LANCER)',
      'striker',
      undefined,
      {
        hpOverride: 7500,
        doctrine: 'escort_bomber',
        waypoints: wps,
        speedOverride: 62,
        onWaypointsComplete: onComplete,
      },
    );

    expect(lancer.hp).toBe(7500);
    expect(lancer.maxHp).toBe(7500);
    expect(lancer.isEscortBomber).toBe(true);
    expect(lancer.progress).toBeCloseTo(0, 2);

    // Defensive IR flare countermeasure response on SAM/fighter lock
    expect(lancer.isCountermeasureActive).toBe(false);
    expect(lancer.notifyMissileLock()).toBe(true);
    expect(lancer.isCountermeasureActive).toBe(true);

    // Advance along the corridor and check monotonic progress up to 1.0 + completion callback
    const playerPos = new THREE.Vector3(40, 110, -50);
    const zero = new THREE.Vector3();
    let prevProgress = lancer.progress;
    for (let i = 0; i < 320; i++) {
      lancer.update(1 / 30, playerPos, zero, true, []);
      expect(lancer.progress).toBeGreaterThanOrEqual(prevProgress - 0.001);
      prevProgress = lancer.progress;
      if (lancer.waypointsCompleted) break;
    }

    expect(lancer.waypointsCompleted).toBe(true);
    expect(lancer.progress).toBe(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    lancer.dispose();
  });

  it('supports two-way AI-vs-AI dogfighting where enemy fighters hunt, damage, and destroy allied wingmen and dive on escort Lancers', () => {
    const { ctx } = createMockCtx();
    const materials = new ModelMaterials(ctx);
    const allyKilled = vi.fn();
    const enemyGunShot = vi.fn();
    const enemyMissileLaunch = vi.fn();

    const wingman = new AiCombatJet(
      ctx,
      materials,
      'hornet',
      'ally',
      new THREE.Vector3(0, 100, -140),
      Math.PI,
      0.7,
      makeJetCallbacks({ onKilled: allyKilled }),
      'VIPER-2',
      'hunter',
      undefined,
      { hpOverride: 120 },
    );

    // Spawn an enemy Raptor Ace directly on the wingman's six within cannon & Fox-2 envelope
    const bandit = new AiCombatJet(
      ctx,
      materials,
      'raptor',
      'enemy',
      new THREE.Vector3(0, 100, -25),
      Math.PI,
      1.0,
      makeJetCallbacks({
        onGunShot: enemyGunShot,
        onMissileLaunch: enemyMissileLaunch,
      }),
      'BANDIT-1',
      'hunter',
      undefined,
      { priorityTarget: wingman },
    );

    const groundedPlayer = new THREE.Vector3(0, 0, 500);
    const zero = new THREE.Vector3();

    for (let i = 0; i < 400; i++) {
      if (!wingman.alive) break;
      bandit.update(1 / 30, groundedPlayer, zero, false, [wingman], false, wingman);
      wingman.update(1 / 30, groundedPlayer, zero, false, [bandit], false);
    }

    expect(enemyGunShot.mock.calls.length + enemyMissileLaunch.mock.calls.length).toBeGreaterThan(0);
    expect(wingman.hp).toBeLessThan(wingman.maxHp);
    expect(wingman.alive).toBe(false);
    expect(allyKilled).toHaveBeenCalledTimes(1);

    // Verify enemy fighter also dives onto an allied escort_bomber Lancer when targeted
    const escortLancer = new AiCombatJet(
      ctx,
      materials,
      'lancer',
      'ally',
      new THREE.Vector3(0, 110, -220),
      Math.PI,
      0.8,
      makeJetCallbacks(),
      'ESCORT LANCER',
      'striker',
      undefined,
      {
        hpOverride: 4000,
        doctrine: 'escort_bomber',
        waypoints: [new THREE.Vector3(0, 110, -700)],
      },
    );
    const lancerHunter = new AiCombatJet(
      ctx,
      materials,
      'hornet',
      'enemy',
      new THREE.Vector3(0, 115, -80),
      Math.PI,
      0.95,
      makeJetCallbacks(),
      'INTERCEPTOR-2',
      'hunter',
    );

    for (let i = 0; i < 240; i++) {
      lancerHunter.update(1 / 30, groundedPlayer, zero, false, [escortLancer], false, escortLancer);
      escortLancer.update(1 / 30, groundedPlayer, zero, false, [lancerHunter], false);
    }

    expect(lancerHunter.lockedTarget).toBe(escortLancer);
    expect(escortLancer.hp).toBeLessThan(escortLancer.maxHp);

    bandit.dispose();
    lancerHunter.dispose();
    escortLancer.dispose();
  });
});

describe('Phase 2: Multi-Chopper VehicleSystem & Combined-Arms Ground Targeting', () => {
  function createVehicleSystem(playerPos = new THREE.Vector3(0, 0, 0)) {
    const mock = createMockCtx({ playerPos });
    const world = {
      ctx: mock.ctx,
      enemies: mock.ctx.enemies,
      now: 10,
      telegraphs: {
        acquireLaser: vi.fn(() => 1),
        aimLaser: vi.fn(),
        releaseLaser: vi.fn(),
      },
    } as never;
    const sys = new VehicleSystem(world);
    sys.init();
    return { sys, ...mock };
  }

  it('supports up to 3 simultaneous enemy attack choppers with backwards-compatible chopper getter and pooled rigs', () => {
    const { sys } = createVehicleSystem();

    const marks = [new THREE.Vector3(0, 28, 0), new THREE.Vector3(40, 28, -40)];
    const c1 = sys.spawnChopper(new THREE.Vector3(-80, 35, -80), marks, 'chopper_1');
    const c2 = sys.spawnChopper(new THREE.Vector3(80, 35, -80), marks, 'chopper_2');
    const c3 = sys.spawnChopper(new THREE.Vector3(0, 35, -120), marks, 'chopper_3');

    expect(MAX_CHOPPERS).toBe(3);
    expect(sys.choppers).toHaveLength(3);
    expect(sys.chopper).toBe(c1);

    // Removing chopper 2 keeps choppers 1 and 3 alive
    c2.remove();
    expect(sys.choppers).toHaveLength(2);
    expect(sys.choppers).toContain(c1);
    expect(sys.choppers).toContain(c3);
    expect(sys.chopper).toBe(c1);

    // Spawning 2 more caps cleanly at 3 by retiring oldest
    const c4 = sys.spawnChopper(new THREE.Vector3(40, 35, -100), marks, 'chopper_4');
    const c5 = sys.spawnChopper(new THREE.Vector3(-40, 35, -100), marks, 'chopper_5');
    expect(sys.choppers).toHaveLength(3);
    expect(sys.choppers).toContain(c4);
    expect(sys.choppers).toContain(c5);
    expect(c1.alive).toBe(false);

    sys.reset();
    expect(sys.choppers).toHaveLength(0);
    expect(sys.chopper).toBeNull();
  });

  it('targets friendly allies and AI armor instead of staring at a high-flying player (y > 25m), and targets on-foot player when low (< 22m)', () => {
    // Player flying high overhead in a jet at y = 70 m
    const { sys, ctx, spawnedAllies } = createVehicleSystem(new THREE.Vector3(0, 70, 0));

    // Add a friendly soldier on the ground at (28, 0, 0)
    const ally = {
      alive: true,
      body: { position: new THREE.Vector3(28, 0, 0), velocity: new THREE.Vector3() },
      shotAt: vi.fn(),
      blast: vi.fn(),
    } as unknown as Ally;
    spawnedAllies.push(ally);

    // Register a friendly AI tank at (35, 0, 0) via setFriendlyVehicles()
    const friendlyTankDamage = vi.fn();
    const friendlyTank = {
      id: 'aegis_1',
      alive: true,
      position: new THREE.Vector3(35, 0, 0),
      velocity: new THREE.Vector3(),
      armored: true,
      airborne: false,
      takeDamage: friendlyTankDamage,
    };
    sys.setFriendlyVehicles(() => [friendlyTank]);

    const origin = new THREE.Vector3(0, 2, 0);

    // Without preferArmor, closest ground target is the ally (28m), ignoring the jet player at y=70m!
    const tInfantry = sys.findGroundTarget(origin, 120);
    expect(tInfantry?.kind).toBe('ally');
    expect(tInfantry?.ally).toBe(ally);

    // With preferArmor (enemy tank), prioritizes the friendly tank (35 * 0.78 = 27.3 < 28)!
    const tArmor = sys.findGroundTarget(origin, 120, { preferArmor: true });
    expect(tArmor?.kind).toBe('friendly_vehicle');
    expect(tArmor?.vehicle).toBe(friendlyTank);

    // When player drops to ground level (y = 0) closer than allies/armor, ground vehicles engage the player!
    ctx.player.position.set(12, 0, 0);
    const tPlayer = sys.findGroundTarget(origin, 120);
    expect(tPlayer?.kind).toBe('player');

    // Scheduled enemy tank/chopper blast splashes both friendly infantry and friendly AI tank
    sys.scheduleFriendlyBlast(new THREE.Vector3(32, 0, 0), 8, 120, 0.25, 'tank_cannon');
    sys.update(0.15);
    expect(friendlyTankDamage).not.toHaveBeenCalled();
    sys.update(0.15);
    expect(friendlyTankDamage).toHaveBeenCalledTimes(1);
    expect(ally.blast).toHaveBeenCalledTimes(1);

    sys.reset();
  });
});

describe('Phase 2: AiVehicleFleet (Ground Armor Hold/Breach, Valkyrie Fast-Rope & Kestrel CAS)', () => {
  it('holds friendly ground armor at closed wall gates, advances after breach, fights enemies, and wrecks at 0 HP', () => {
    const enemySoldier = {
      alive: true,
      center: new THREE.Vector3(0, 1.2, 60),
      position: new THREE.Vector3(0, 0, 60),
      health: 100,
    };
    const { ctx, applyDamage } = createMockCtx({ enemyUnits: [enemySoldier] });
    const fleet = new AiVehicleFleet(ctx);
    const onDestroyed = vi.fn();

    fleet.setGateOpen('lane_center_breach', false);
    const tank = fleet.spawnGround({
      id: 'aegis_spearhead',
      kind: 'aegis',
      laneId: 'lane_center_breach',
      spawn: [0, 120],
      waypoints: [
        [0, 108],
        [0, 96], // gate staging waypoint (index 1)
        [0, 40], // inside fortress after breach
      ],
      gateWaypointIndex: 1,
      hpOverride: 400,
      onDestroyed,
    });

    // Drive up to the closed wall gate — must pause cleanly at z >= ~92 and never cross!
    for (let i = 0; i < 180; i++) fleet.update(1 / 30);
    expect(tank.waitingAtGate).toBe(true);
    expect(tank.position.z).toBeGreaterThan(90);

    // Should already be engaging enemies in range with its 120mm cannon!
    expect(tank.shotsFired).toBeGreaterThan(0);
    expect(applyDamage).toHaveBeenCalled();

    // Breach wall opens! Tank immediately rolls forward through the breach toward z = 40.
    fleet.setGateOpen('lane_center_breach', true);
    for (let i = 0; i < 220; i++) fleet.update(1 / 30);
    expect(tank.waitingAtGate).toBe(false);
    expect(tank.position.z).toBeLessThan(70);

    // Live ground targets exposes the tank while alive, and removes it once blown up into a burning wreck
    expect(fleet.getLiveGroundTargets()).toContain(tank);
    tank.takeDamage(500, new THREE.Vector3(0, 1, 50), 'enemy_tank');
    expect(tank.alive).toBe(false);
    expect(tank.wrecked).toBe(true);
    expect(onDestroyed).toHaveBeenCalledWith(tank);
    expect(fleet.getLiveGroundTargets()).not.toContain(tank);

    fleet.dispose();
  });

  it('flies friendly Valkyrie inbound to LZ, hovers, fast-ropes a squad of ctx.allies, and banks out; Kestrel orbits & strafes', () => {
    const enemyTankTake = vi.fn();
    const enemyTank = {
      alive: true,
      retired: false,
      center: new THREE.Vector3(10, 2, 10),
      def: { armoured: true },
      take: enemyTankTake,
    };
    const { ctx, spawnedAllies } = createMockCtx({ enemyVehicles: [enemyTank] });
    const fleet = new AiVehicleFleet(ctx);
    const onTroopsDeployed = vi.fn();

    const valkyrie = fleet.spawnValkyrie({
      id: 'valk_alpha',
      lzId: 'lz_beach_center',
      approachFrom: [0, 35, 90],
      lzPos: [0, 0, 20],
      egressTo: [-140, 50, 20],
      hoverHeight: 12,
      squadCount: 4,
      onTroopsDeployed,
    });

    const kestrel = fleet.spawnKestrel({
      id: 'kestrel_cas_1',
      spawn: [50, 32, 40],
      orbitCenter: [10, 0, 10],
      orbitRadius: 48,
      orbitAltitude: 30,
    });

    const seenPhases = new Set<string>();
    for (let i = 0; i < 450; i++) {
      seenPhases.add(valkyrie.valkyriePhase);
      fleet.update(1 / 30);
    }

    expect(seenPhases.has('inbound')).toBe(true);
    expect(seenPhases.has('hover')).toBe(true);
    expect(seenPhases.has('fast_rope')).toBe(true);
    expect(seenPhases.has('egress') || seenPhases.has('departed')).toBe(true);
    expect(onTroopsDeployed).toHaveBeenCalledTimes(1);
    expect(spawnedAllies).toHaveLength(4);
    expect(valkyrie.deployedTroops).toHaveLength(4);

    // Kestrel orbited & strafed the live enemy tank
    expect(kestrel.shotsFired).toBeGreaterThan(0);
    expect(enemyTankTake).toHaveBeenCalled();

    fleet.dispose();
  });
});

describe('Phase 2: BaseDefenseSystem (SAM/Flak/Radar/Mortar/Destroyers, +35% Radar Bonus & Bomb Destruction)', () => {
  it('enforces exact HP/range specs and mounts Strait Destroyer SAM & CIWS turrets onto STRAIT_DESTROYER_MOUNTS', () => {
    expect(BASE_DEFENSE_SPECS.sam_battery.maxHp).toBe(420);
    expect(BASE_DEFENSE_SPECS.sam_battery.range).toBe(580);
    expect(BASE_DEFENSE_SPECS.flak_tower.maxHp).toBe(700);
    expect(BASE_DEFENSE_SPECS.flak_tower.range).toBe(480);
    expect(BASE_DEFENSE_SPECS.radar_dome.maxHp).toBe(550);
    expect(BASE_DEFENSE_SPECS.mortar_pit.maxHp).toBe(300);
    expect(BASE_DEFENSE_SPECS.destroyer_sam.maxHp).toBe(450);
    expect(BASE_DEFENSE_SPECS.destroyer_ciws.maxHp).toBe(450);

    const { ctx } = createMockCtx();
    const defenses = new BaseDefenseSystem(ctx);
    const mounted = defenses.mountStraitDestroyers(STRAIT_DESTROYER_MOUNTS);

    expect(mounted).toHaveLength(STRAIT_DESTROYER_MOUNTS.length);
    expect(defenses.getSitesByKind('destroyer_sam').length).toBe(4);
    expect(defenses.getSitesByKind('destroyer_ciws').length).toBe(4);

    // Paintable MissileTargets include all live naval turrets for Raptor/Lancer lock-on
    const targets: MissileTarget[] = [];
    defenses.paintable(targets);
    expect(targets).toHaveLength(STRAIT_DESTROYER_MOUNTS.length);

    defenses.dispose();
  });

  it('grants +35% SAM fire-rate bonus while a nearby Radar Dome is alive and removes it upon bomb destruction via combat:explosion', () => {
    const { ctx, emit } = createMockCtx({ playerPos: new THREE.Vector3(0, 120, 140) });
    const onDestroyed = vi.fn();
    const defenses = new BaseDefenseSystem(ctx, { onDestroyed });

    const radar = defenses.addSite({
      id: 'radar_central',
      kind: 'radar_dome',
      position: [0, 0, 0],
    });
    const sam = defenses.addSite({
      id: 'sam_alpha',
      kind: 'sam_battery',
      position: [120, 0, 0],
    });
    const flak = defenses.addSite({
      id: 'flak_north',
      kind: 'flak_tower',
      position: [-60, 0, 0],
    });

    // Radar Dome alive -> SAM gets +35% fire rate (1.35x); Flak Tower stays 1.0x
    expect(defenses.getEffectiveFireRateMultiplier(sam)).toBeCloseTo(1 + RADAR_DOME_FIRE_RATE_BONUS, 4);
    expect(defenses.getEffectiveFireRateMultiplier(flak)).toBe(1);

    // Destroy Radar Dome via `combat:explosion` (simulating a B-1B Lancer Mk-84 bomb hit!)
    emit('combat:explosion', {
      position: new THREE.Vector3(2, 1, 0),
      radius: 18,
      damage: 900,
      source: 'lancer_mk84',
    });

    expect(radar.alive).toBe(false);
    expect(onDestroyed).toHaveBeenCalledTimes(1);
    expect(onDestroyed.mock.calls[0]?.[0]).toBe('radar_central');
    expect(onDestroyed.mock.calls[0]?.[1]).toBe('radar_dome');

    // Bonus immediately drops back to 1.0x once the radar dome is knocked out!
    expect(defenses.getEffectiveFireRateMultiplier(sam)).toBe(1);

    // Direct applyBlast helper destroys the Flak Tower too
    const hits = defenses.applyBlast(new THREE.Vector3(-60, 4, 0), 22, 1200, 'raptor_agm');
    expect(hits).toBeGreaterThanOrEqual(1);
    expect(flak.alive).toBe(false);
    expect(onDestroyed).toHaveBeenCalledTimes(2);

    defenses.dispose();
  });

  it('acquires SAM RWR lock on an airborne player, launches a homing SAM, decoys it on player flares, and shells ground forces from Mortar Pits', () => {
    const rwrEvents: Array<{ locking: boolean; missileInbound: boolean }> = [];
    const { ctx, emit } = createMockCtx({ playerPos: new THREE.Vector3(0, 110, 220) });
    ctx.events.on('dogfight:rwr', ev => rwrEvents.push({ locking: ev.locking, missileInbound: ev.missileInbound }));

    const defenses = new BaseDefenseSystem(ctx);
    const sam = defenses.addSite({
      id: 'sam_test',
      kind: 'sam_battery',
      position: [0, 0, 0],
    });
    const mortar = defenses.addSite({
      id: 'mortar_test',
      kind: 'mortar_pit',
      position: [0, 0, -60],
    });
    sam.fireCooldown = 0;
    mortar.fireCooldown = 0;

    // Friendly ground vehicle in mortar range
    const friendlyDamage = vi.fn();
    const friendlyArmor = {
      id: 'bastion_1',
      alive: true,
      position: new THREE.Vector3(0, 0, 20),
      velocity: new THREE.Vector3(),
      armored: true,
      airborne: false,
      takeDamage: friendlyDamage,
    };

    // Tick until SAM locks (emitting RWR) and launches, and mortar fires & lands!
    for (let i = 0; i < 120; i++) {
      defenses.update(1 / 30, {
        playerAirborne: true,
        friendlyGroundTargets: [friendlyArmor],
      });
      if (sam.samsFired > 0 && defenses.activeSamCount > 0) break;
    }

    expect(rwrEvents.some(e => e.locking)).toBe(true);
    expect(sam.samsFired).toBeGreaterThanOrEqual(1);
    expect(defenses.activeSamCount).toBeGreaterThanOrEqual(1);

    // Pop player flares -> breaks lock and decoys active SAM so player jet takes ZERO SAM damage!
    const jetDamaged = vi.fn();
    ctx.events.on('dogfight:damage_player_jet', jetDamaged);
    emit('dogfight:player_flares', { position: ctx.player.position.clone() });

    for (let i = 0; i < 180; i++) {
      defenses.update(1 / 30, {
        playerAirborne: true,
        friendlyGroundTargets: [friendlyArmor],
      });
    }

    expect(jetDamaged).not.toHaveBeenCalled();
    expect(mortar.mortarsFired).toBeGreaterThanOrEqual(1);
    expect(friendlyDamage).toHaveBeenCalled();

    // Also verify Halcyon site mounting works seamlessly
    const halcyonDefenses = new BaseDefenseSystem(ctx);
    const mounted = halcyonDefenses.mountHalcyonSites(HALCYON_DEFENSE_SITES);
    expect(mounted).toHaveLength(HALCYON_DEFENSE_SITES.length);

    halcyonDefenses.dispose();
    defenses.dispose();
  });
});
