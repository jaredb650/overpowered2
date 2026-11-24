import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import type { ModelMaterials } from '../../progression/modelkit';
import { BLAST, OUTCOME_COUNT, rollBlast } from '../../enemies/blast';
import { EXPLOSION_RECIPES, hasExplosionRecipe } from '../../fx/recipes/explosions';
import { MAX_BOMBLETS, activeBombletCount, clearBomblets, updateBomblets } from '../../frame/bomblets';
import { AERIAL_CLUSTER, AERIAL_CLUSTER_SPEC } from '../../weapons/cluster';
import { EXPLOSIONS, TUNING } from '../../weapons/data';
import { Projectiles } from '../../weapons/Projectiles';
import type { Combat } from '../../weapons/Combat';
import { DRIVE_VEHICLES } from './data';
import { buildVehicleModel } from './models';
import { DriveableVehicle } from './vehicle';

function makeMaterials(): ModelMaterials {
  return {
    solid: new THREE.MeshStandardMaterial({ color: 0xffffff }),
    glow: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    glass: new THREE.MeshStandardMaterial({ color: 0x336699, transparent: true, opacity: 0.45 }),
  } as unknown as ModelMaterials;
}

function makeDriveHarness() {
  const held = new Set<string>();
  const justPressed = new Set<string>();
  const spawnProjectile = vi.fn();
  const explode = vi.fn();
  const feed = vi.fn();
  const audioPlay = vi.fn();
  const interceptEnemyProjectiles = vi.fn(() => 2);
  const seatsState: { seat: unknown } = { seat: null };

  const seats = {
    get seat() { return seatsState.seat; },
    set seat(v: unknown) { seatsState.seat = v; },
    get occupied() { return seatsState.seat !== null; },
    prisoners: new Set<number>(),
    shell: { show: vi.fn(), hide: vi.fn(), update: vi.fn() },
    hud: { open: vi.fn() },
    enter(spec: unknown) { seatsState.seat = spec; },
    leave() { seatsState.seat = null; },
  };

  const ctx = {
    time: { elapsed: 0, realDt: 1 / 30 },
    render: {
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000),
      renderer: { domElement: { style: { filter: '' } } },
      highlight: vi.fn(),
      lights: { flash: vi.fn() },
      post: { flash: vi.fn() },
    },
    input: {
      frameLook: { x: 0, y: 0 },
      isDown: (a: string) => held.has(a),
      down: (a: string) => held.has(a),
      pressed: (a: string) => justPressed.has(a),
      consumeWheel: () => 0,
      labelFor: () => 'E',
    },
    camera: {
      setSeat: vi.fn(),
      setZoom: vi.fn(),
      syncSeat: vi.fn(),
      addTrauma: vi.fn(),
      fovPunch: vi.fn(),
    },
    audio: {
      play: audioPlay,
      startLoop: () => ({ alive: true, setPosition: vi.fn(), setPitch: vi.fn(), setVolume: vi.fn(), stop: vi.fn() }),
    },
    fx: {
      muzzleFlash: vi.fn(),
      smoke: vi.fn(),
      sparks: vi.fn(),
      ring: vi.fn(),
      impact: vi.fn(),
      explosion: vi.fn(),
    },
    hud: {
      seat: vi.fn(),
      feed,
      callout: vi.fn(),
      floatText: vi.fn(),
      follow: vi.fn(),
      hold: vi.fn(),
      hitMarker: vi.fn(),
      setVehiclePrompt: vi.fn(),
    },
    events: { emit: vi.fn(), on: vi.fn(() => () => {}) },
    world: {
      bounds: new THREE.Box3(new THREE.Vector3(-400, -10, -400), new THREE.Vector3(400, 300, 400)),
      playerSpawns: [{ position: new THREE.Vector3(0, 0, 0), yaw: 0 }],
      nav: { groundHeight: () => 0, nearest: () => false },
      objects: { hazardAt: () => null, damageExplosivesInRadius: vi.fn() },
    },
    physics: {
      addStaticBox: () => ({ handle: 42, setTranslation: vi.fn(), setRotation: vi.fn() }),
      world: { removeCollider: vi.fn() },
      raycast: () => null,
      raycastInto: () => false,
      radialImpulse: vi.fn(),
    },
    player: {
      position: new THREE.Vector3(0, 1.7, 0),
      eye: new THREE.Vector3(0, 1.7, 0),
      forward: new THREE.Vector3(0, 0, -1),
      velocity: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      sensitivity: 0.002,
      lookScale: 1,
      invertY: false,
      grounded: true,
      alive: true,
      health: 100,
      maxHealth: 100,
      parked: false,
      interceptor: null,
      park: vi.fn(),
      unpark: vi.fn(),
      carry(p: THREE.Vector3) { this.position.copy(p); },
      heal: vi.fn(),
      push: vi.fn(),
      damage: vi.fn(),
    },
    combat: {
      spawnProjectile,
      explode,
      fireRay: vi.fn(() => ({ end: new THREE.Vector3(0, 0, 50) })),
      interceptEnemyProjectiles,
      napalmBurst: vi.fn(),
    },
    enemies: {
      list: [],
      nearby: () => [],
      query: () => 0,
      raycast: () => null,
      vehicles: { paintable: () => 0, frameBlow: vi.fn(), blast: vi.fn(), direct: vi.fn(), listTargets: () => 0, pushWrecks: vi.fn(), vehicleRam: vi.fn() },
      radarTargets: () => [],
    },
  } as unknown as Ctx;

  return { ctx, materials: makeMaterials(), seats, held, justPressed, spawnProjectile, explode, feed, audioPlay, interceptEnemyProjectiles };
}

function visibleAirframeSize(root: THREE.Object3D): THREE.Vector3 {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  root.traverse(o => {
    if (!o.visible) return;
    let p = o.parent;
    while (p) {
      if (!p.visible) return;
      p = p.parent;
    }
    if ((o as THREE.Mesh).isMesh) {
      tmp.setFromObject(o);
      box.union(tmp);
    }
  });
  return box.getSize(new THREE.Vector3());
}

describe('Phase 1: B-1B Lancer Overhaul & Juiced-Up Thermobaric FX', () => {
  it('scales B-1B Lancer to ~28.2m L x ~26.8m W unswept (~16.4m swept) x ~6.8m H flush at y = 0 with animated bomb-bay doors', () => {
    const mats = makeMaterials();
    const lancer = buildVehicleModel('lancer', mats);
    const raptor = buildVehicleModel('raptor', mats);

    lancer.root.updateMatrixWorld(true);
    raptor.root.updateMatrixWorld(true);

    const unsweptBox = new THREE.Box3().setFromObject(lancer.root);
    const unsweptSize = unsweptBox.getSize(new THREE.Vector3());

    // Exact strategic bomber dimensions & grounded landing gear
    expect(unsweptBox.min.y).toBeGreaterThan(-0.08);
    expect(unsweptBox.min.y).toBeLessThan(0.08);
    expect(unsweptSize.z).toBeGreaterThan(27.4);
    expect(unsweptSize.z).toBeLessThan(29.0);
    expect(unsweptSize.x).toBeGreaterThan(26.0);
    expect(unsweptSize.x).toBeLessThan(27.6);
    expect(unsweptSize.y).toBeGreaterThan(6.4);
    expect(unsweptSize.y).toBeLessThan(7.2);

    // Realistic strategic bomber size ratio vs F-22 Raptor visible airframe (~2.35x length, ~2.8x wingspan)
    const raptorAirframe = visibleAirframeSize(raptor.root);
    expect(unsweptSize.z / raptorAirframe.z).toBeGreaterThan(2.2);
    expect(unsweptSize.x / raptorAirframe.x).toBeGreaterThan(2.6);

    // Variable-sweep wings fold to ~16.4m swept span at Mach sweep (rotation.y = ±0.78 rad)
    expect(lancer.wingsLeft).toBeDefined();
    expect(lancer.wingsRight).toBeDefined();
    lancer.wingsLeft!.rotation.y = 0.78;
    lancer.wingsRight!.rotation.y = -0.78;
    lancer.root.updateMatrixWorld(true);
    const sweptSize = new THREE.Box3().expandByObject(lancer.root, true).getSize(new THREE.Vector3());
    expect(sweptSize.x).toBeGreaterThan(15.6);
    expect(sweptSize.x).toBeLessThan(17.2);

    // 4 turbofan afterburners, dump-and-burn torch, landing gear, and 6 hinged bomb-bay doors (3 tandem bays)
    expect(lancer.boostGlow).toHaveLength(4);
    expect(lancer.dumpBurnGlow).toHaveLength(2);
    expect(lancer.landingGear).toBeDefined();
    expect(lancer.bombBayDoors).toBeDefined();
    expect(lancer.bombBayDoors!.length).toBe(6);
    const leftDoors = lancer.bombBayDoors!.filter(d => d.userData.side === 1);
    const rightDoors = lancer.bombBayDoors!.filter(d => d.userData.side === -1);
    expect(leftDoors).toHaveLength(3);
    expect(rightDoors).toHaveLength(3);
  });

  it('animates B-1B belly bomb-bay doors open on bomb release and closes them smoothly ~2.2s later', () => {
    const h = makeDriveHarness();
    const lancer = new DriveableVehicle(h.ctx, h.materials, h.seats as never, vi.fn(), 'lancer', new THREE.Vector3(0, 60, 0), 0);
    expect(lancer.board(0)).toBe(true);
    lancer.phys.position.set(0, 60, 0);
    lancer.phys.velocity.set(0, 0, 50);

    const doors = lancer.model.bombBayDoors!;
    expect(doors.every(d => d.rotation.z === 0)).toBe(true);

    // Drop a bomb -> doors immediately begin swinging open symmetrically
    h.held.add('aim');
    lancer.update(1 / 30);
    h.held.delete('aim');
    for (let i = 0; i < 6; i++) lancer.update(1 / 30);

    for (const d of doors) {
      const side = d.userData.side as number;
      expect(d.rotation.z * side).toBeGreaterThan(0.8);
    }

    // Still open ~1.5s after release (within 2.2s hold window)
    for (let i = 0; i < 45; i++) lancer.update(1 / 30);
    for (const d of doors) {
      const side = d.userData.side as number;
      expect(d.rotation.z * side).toBeGreaterThan(1.0);
    }

    // After 2.2s hold expires + smooth close damping (~2.0s more), doors close cleanly back to ~0
    for (let i = 0; i < 90; i++) lancer.update(1 / 30);
    for (const d of doors) {
      expect(Math.abs(d.rotation.z)).toBeLessThan(0.05);
    }
    lancer.dispose();
  });

  it('configures B-1B Lancer 4800 HP, heavy armor, 240m ceiling (260m Raptor/Hornet), 5.5s flare cooldown, and all 4 strategic bomb modes', () => {
    const def = DRIVE_VEHICLES.lancer;
    expect(def.maxHealth).toBe(4800);
    expect(def.mass).toBe(14.0);
    expect(def.armor).toEqual({ front: 0.45, side: 0.55, rear: 0.68 });
    expect(def.kamikazeDamage).toBe(3600);
    expect(def.halfWidth).toBe(9.2);
    expect(def.halfHeight).toBe(2.4);
    expect(def.halfLength).toBe(13.5);
    expect(def.maxAltitude).toBe(240);
    expect(DRIVE_VEHICLES.raptor.maxAltitude).toBe(260);
    expect(DRIVE_VEHICLES.hornet.maxAltitude).toBe(260);

    const pilot = def.seats[0]!;
    expect(pilot.chaseDist).toBe(31.0);
    expect(pilot.fpEye[1]).toBeGreaterThan(3.5);
    expect(pilot.fpEye[2]).toBeGreaterThan(8.0);

    const sec = pilot.secondary!;
    // 1. Mk-82 Snake-Eye Carpet
    expect(sec.magSize).toBe(36);
    expect(sec.interval).toBe(0.12);
    expect(sec.reloadSeconds).toBe(5.5);
    expect(sec.damage).toBe(1200);
    expect(sec.blastRadius).toBe(20.0);
    expect(sec.blastDamage).toBe(1100);
    expect(sec.chute).toBe(true);
    expect(sec.explosionKind).toBe('howitzer');

    // 2. CBU-105 Heavy Aerial Cluster
    expect(sec.altMode!.magSize).toBe(16);
    expect(sec.altMode!.interval).toBe(0.28);
    expect(sec.altMode!.reloadSeconds).toBe(6.0);
    expect(sec.altMode!.damage).toBe(450);
    expect(sec.altMode!.blastRadius).toBe(22.0);
    expect(sec.altMode!.blastDamage).toBe(450);
    expect(sec.altMode!.aerialCluster).toBe(true);

    // 3. BLU-27 Napalm Carpet
    expect(sec.thirdMode!.magSize).toBe(18);
    expect(sec.thirdMode!.interval).toBe(0.22);
    expect(sec.thirdMode!.reloadSeconds).toBe(5.8);
    expect(sec.thirdMode!.damage).toBe(560);
    expect(sec.thirdMode!.blastRadius).toBe(22.0);
    expect(sec.thirdMode!.blastDamage).toBe(520);
    expect(sec.thirdMode!.napalm).toBe(true);

    // 4. BLU-121/B Thermobaric
    expect(sec.fourthMode!.magSize).toBe(6);
    expect(sec.fourthMode!.interval).toBe(0.75);
    expect(sec.fourthMode!.reloadSeconds).toBe(7.0);
    expect(sec.fourthMode!.damage).toBe(2800);
    expect(sec.fourthMode!.blastRadius).toBe(48.0);
    expect(sec.fourthMode!.blastDamage).toBe(2600);
    expect(sec.fourthMode!.thermobaric).toBe(true);
    expect(sec.fourthMode!.explosionKind).toBe('thermobaric');

    // Cycle [R] through all 4 modes and verify CCIP labels & projectile payloads
    const h = makeDriveHarness();
    const lancer = new DriveableVehicle(h.ctx, h.materials, h.seats as never, vi.fn(), 'lancer', new THREE.Vector3(0, 90, 0), 0);
    expect(lancer.board(0)).toBe(true);
    lancer.phys.position.set(0, 90, 0);
    lancer.phys.velocity.set(0, 0, 62);
    const seat = h.seats.seat as { vehicleHud?: { ccipLabel?: string } };

    // Mode 0: Snake-Eye
    lancer.update(1 / 30);
    expect(seat.vehicleHud?.ccipLabel).toBe('CCIP SNAKE-EYE');
    h.held.add('aim');
    lancer.update(1 / 30);
    h.held.delete('aim');
    expect(h.spawnProjectile).toHaveBeenLastCalledWith(expect.objectContaining({
      bomb: true,
      chute: true,
      explosion: expect.objectContaining({ kind: 'howitzer', radius: 20.0, damage: 1100 }),
    }));

    // Mode 1: CBU-105 Aerial Cluster
    for (let i = 0; i < 10; i++) lancer.update(1 / 30);
    h.justPressed.add('reload');
    lancer.update(1 / 30);
    h.justPressed.clear();
    expect(seat.vehicleHud?.ccipLabel).toBe('CCIP CBU-105');
    h.held.add('aim');
    lancer.update(1 / 30);
    h.held.delete('aim');
    expect(h.spawnProjectile).toHaveBeenLastCalledWith(expect.objectContaining({
      bomb: true,
      aerialCluster: true,
      cluster: true,
      source: 'lancer_cluster',
    }));

    // Mode 2: BLU-27 Napalm Carpet
    for (let i = 0; i < 12; i++) lancer.update(1 / 30);
    h.justPressed.add('reload');
    lancer.update(1 / 30);
    h.justPressed.clear();
    expect(seat.vehicleHud?.ccipLabel).toBe('CCIP NAPALM');
    h.held.add('aim');
    lancer.update(1 / 30);
    h.held.delete('aim');
    expect(h.spawnProjectile).toHaveBeenLastCalledWith(expect.objectContaining({
      bomb: true,
      napalm: true,
      source: 'lancer_napalm',
    }));

    // Mode 3: BLU-121/B Thermobaric
    for (let i = 0; i < 12; i++) lancer.update(1 / 30);
    h.justPressed.add('reload');
    lancer.update(1 / 30);
    h.justPressed.clear();
    expect(seat.vehicleHud?.ccipLabel).toBe('CCIP THERMOBARIC');
    h.held.add('aim');
    lancer.update(1 / 30);
    h.held.delete('aim');
    expect(h.spawnProjectile).toHaveBeenLastCalledWith(expect.objectContaining({
      bomb: true,
      thermobaric: true,
      source: 'lancer_thermobaric',
      explosion: expect.objectContaining({ kind: 'thermobaric', radius: 48.0, damage: 2600 }),
    }));

    // Lancer flare cooldown is 5.5s (faster than standard 9.5s)
    lancer.setExternalRwr(true, 1, true, 'MISSILE');
    lancer.update(1 / 30);
    h.justPressed.add('stim');
    lancer.update(1 / 30);
    h.justPressed.clear();
    const afterFirstPop = h.interceptEnemyProjectiles.mock.calls.length;
    expect(afterFirstPop).toBeGreaterThan(0);

    // At 4.5s later (still inside 5.5s flare cooldown), flares are not ready yet
    for (let i = 0; i < 135; i++) lancer.update(1 / 30);
    lancer.setExternalRwr(true, 1, true, 'MISSILE');
    lancer.update(1 / 30);
    h.justPressed.add('stim');
    lancer.update(1 / 30);
    h.justPressed.clear();
    expect(h.interceptEnemyProjectiles.mock.calls.length).toBe(afterFirstPop);

    // At 5.7s total (past 5.5s flare cooldown, well under old 9.5s cooldown & 10s Dump-and-Burn cooldown), IR flares pop!
    for (let i = 0; i < 36; i++) lancer.update(1 / 30);
    lancer.setExternalRwr(true, 1, true, 'MISSILE');
    lancer.update(1 / 30);
    h.justPressed.add('stim');
    lancer.update(1 / 30);
    h.justPressed.clear();
    expect(h.interceptEnemyProjectiles.mock.calls.length).toBeGreaterThan(afterFirstPop);

    lancer.dispose();
  });

  it('CBU-105 aerialCluster airbursts at ~28m into 52 heavy AP bomblets across a 44m x 28m carpet and lifts bomblet/napalm caps', () => {
    expect(MAX_BOMBLETS).toBe(384);
    expect(TUNING.napalm.patch.max).toBe(64);
    expect(AERIAL_CLUSTER.airburstHeight).toBe(28);
    expect(AERIAL_CLUSTER.count).toBe(52);
    expect(AERIAL_CLUSTER.length).toBe(44);
    expect(AERIAL_CLUSTER.width).toBe(28);
    expect(AERIAL_CLUSTER.damage).toBe(190);
    expect(AERIAL_CLUSTER.blastRadius).toBe(5.5);
    expect(AERIAL_CLUSTER_SPEC.armorPiercing).toBe(true);

    clearBomblets();
    const blastPoints: THREE.Vector3[] = [];
    const blastSpecs: { radius: number; damage: number }[] = [];
    const frameBlow = vi.fn();

    const combat = {
      watching: 0,
      explode: vi.fn((pos: THREE.Vector3, spec: { radius: number; damage: number }) => {
        blastPoints.push(pos.clone());
        blastSpecs.push({ radius: spec.radius, damage: spec.damage });
      }),
      napalmBurst: vi.fn(),
    } as unknown as Combat;

    const projCtx = {
      render: { scene: new THREE.Scene(), lights: { flash: vi.fn() }, post: { flash: vi.fn() } },
      time: { elapsed: 0, realDt: 0.05 },
      world: { nav: { groundHeight: () => 0 } },
      physics: { raycast: () => null, radialImpulse: vi.fn() },
      enemies: { raycast: () => null, nearby: () => [], vehicles: { frameBlow } },
      fx: { smoke: vi.fn(), ring: vi.fn(), sparks: vi.fn(), impact: vi.fn(), explosion: vi.fn() },
      audio: {
        play: vi.fn(),
        startLoop: () => ({ alive: true, setPosition: vi.fn(), setPitch: vi.fn(), setVolume: vi.fn(), stop: vi.fn() }),
      },
      combat,
    } as unknown as Ctx;

    const projectiles = new Projectiles(projCtx, combat);
    projectiles.init();

    // Release CBU-105 from 70m altitude moving forward along +Z
    projectiles.spawn({
      origin: new THREE.Vector3(0, 70, 0),
      velocity: new THREE.Vector3(0, -3.5, 55),
      kind: 'shell',
      team: 'player',
      damage: 450,
      source: 'lancer_cluster',
      gravity: 28,
      lifetime: 14,
      trail: 'none',
      size: 1.12,
      armorPiercing: true,
      bomb: true,
      cluster: true,
      aerialCluster: true,
    });

    // Step projectile until it descends through the 28m airburst plane
    let burstDetected = false;
    for (let i = 0; i < 60; i++) {
      projectiles.update(0.05);
      if (activeBombletCount() > 0) {
        burstDetected = true;
        break;
      }
    }
    expect(burstDetected).toBe(true);
    expect(activeBombletCount()).toBe(52);

    // Step all 52 bomblets until full carpet detonation completes
    for (let i = 0; i < 120 && activeBombletCount() > 0; i++) {
      updateBomblets(0.05);
    }
    expect(activeBombletCount()).toBe(0);
    expect(blastPoints).toHaveLength(52);
    expect(blastSpecs.every(s => s.damage === 190 && s.radius === 5.5)).toBe(true);
    expect(frameBlow).toHaveBeenCalledTimes(52);

    // Verify wide elliptical carpet spread (44m x 28m spec)
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const pt of blastPoints) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.z < minZ) minZ = pt.z;
      if (pt.z > maxZ) maxZ = pt.z;
    }
    expect(maxZ - minZ).toBeGreaterThan(26);
    expect(maxX - minX).toBeGreaterThan(15);

    projectiles.clear();
    clearBomblets();
  });

  it('delivers juiced-up howitzer thermobaric FX recipe (not megaBlast), blast rings, visual warhead, and Tier-3 destruction', () => {
    expect(hasExplosionRecipe('thermobaric')).toBe(true);
    const thermo = EXPLOSION_RECIPES.thermobaric;
    const howitzer = EXPLOSION_RECIPES.howitzer;

    // Juiced-up howitzer, NEVER megaBlast (hellfire: false)
    expect(thermo.hellfire).toBe(false);
    expect(thermo.base).toBeGreaterThan(howitzer.base);
    expect(thermo.fireScale).toBeGreaterThan(howitzer.fireScale);
    expect(thermo.fireLife ?? 0).toBeGreaterThan(howitzer.fireLife ?? 0);
    expect(thermo.lingerFlames ?? 0).toBeGreaterThan(howitzer.lingerFlames ?? 0);
    expect(thermo.smoke).toBeGreaterThan(howitzer.smoke);
    expect(thermo.debris).toBeGreaterThan(howitzer.debris);
    expect(thermo.embers).toBeGreaterThan(howitzer.embers);
    expect(thermo.scorch).toBeGreaterThan(howitzer.scorch);
    expect(thermo.lightGain).toBeGreaterThan(howitzer.lightGain);
    expect(EXPLOSIONS.thermobaric).toBeDefined();

    // Generous fuel-air gore/vaporize blast rings in src/enemies/blast.ts
    expect(BLAST.rings.thermobaric).toEqual([0.55, 1.0]);
    const seen = new Uint8Array(OUTCOME_COUNT);
    const out = { outcome: 'thrown' as const, amount: 0, fatal: false };
    rollBlast({ health: 100, maxHealth: 100, machine: false, fireproof: false }, 'thermobaric', 0.45, 2600, seen, out, () => 0.5);
    expect(out.outcome).toBe('gib');
    expect(out.fatal).toBe(true);

    // Visual BLU-121/B thermobaric warhead layers & Tier-3 structural impact detonation
    const fxExplosion = vi.fn();
    const damageExplosivesInRadius = vi.fn();
    const frameBlow = vi.fn();
    const radialImpulse = vi.fn();
    const combatExplode = vi.fn();

    const combat = {
      watching: 0,
      explode: combatExplode,
      feel: { shake: vi.fn() },
      napalmBurst: vi.fn(),
    } as unknown as Combat;

    const projCtx = {
      render: {
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000),
        lights: { flash: vi.fn() },
        post: { flash: vi.fn() },
      },
      time: { elapsed: 0, realDt: 0.05 },
      world: {
        nav: { groundHeight: () => 0 },
        objects: { damageExplosivesInRadius },
      },
      physics: {
        raycast: (origin: THREE.Vector3, dir: THREE.Vector3, len: number) => {
          if (origin.y + dir.y * len <= 0) {
            const dist = Math.max(0.01, -origin.y / dir.y);
            return {
              distance: dist,
              point: origin.clone().addScaledVector(dir, dist),
              normal: new THREE.Vector3(0, 1, 0),
              collider: null,
            };
          }
          return null;
        },
        radialImpulse,
      },
      enemies: { raycast: () => null, nearby: () => [], vehicles: { frameBlow, direct: vi.fn() } },
      fx: { smoke: vi.fn(), ring: vi.fn(), sparks: vi.fn(), impact: vi.fn(), explosion: fxExplosion },
      audio: {
        play: vi.fn(),
        startLoop: () => ({ alive: true, setPosition: vi.fn(), setPitch: vi.fn(), setVolume: vi.fn(), stop: vi.fn() }),
      },
      combat,
    } as unknown as Ctx;

    const projectiles = new Projectiles(projCtx, combat);
    projectiles.init();

    projectiles.spawn({
      origin: new THREE.Vector3(0, 30, 0),
      velocity: new THREE.Vector3(0, -10, 40),
      kind: 'shell',
      team: 'player',
      damage: 2800,
      source: 'lancer_thermobaric',
      gravity: 28,
      lifetime: 14,
      trail: 'none',
      size: 1.65,
      armorPiercing: true,
      bomb: true,
      thermobaric: true,
      explosion: {
        radius: 48.0,
        damage: 2600,
        kind: 'thermobaric',
        selfDamage: 0,
        scale: 1.45,
        shake: 2.4,
      },
    });

    // Mid-flight: renders dedicated BLU-121/B thermobaric hull + orange hazard bands
    projectiles.update(0.05);
    const layers = (projectiles.visuals as unknown as { layers: Record<string, { count: number }> }).layers;
    expect(layers.bombThermoBody!.count).toBe(1);
    expect(layers.bombThermoBand!.count).toBe(1);

    // Step to ground impact
    for (let i = 0; i < 60 && fxExplosion.mock.calls.length === 0; i++) {
      projectiles.update(0.05);
    }

    expect(fxExplosion).toHaveBeenCalledWith(expect.any(THREE.Vector3), expect.objectContaining({ kind: 'thermobaric', radius: 48.0 }));
    expect(damageExplosivesInRadius).toHaveBeenCalledWith(expect.any(THREE.Vector3), 48.0, 2600, 'ac130_bomb');
    expect(frameBlow).toHaveBeenCalledWith(expect.any(THREE.Vector3), 48.0, 2600 * 0.55, null, 'frame_howitzer');
    expect(combatExplode).toHaveBeenCalledWith(expect.any(THREE.Vector3), expect.objectContaining({ kind: 'thermobaric', radius: 48.0, damage: 2600 }));
    expect(radialImpulse).toHaveBeenCalledWith(expect.any(THREE.Vector3), 48.0 * 1.5, EXPLOSIONS.thermobaric.impulse * 48.0);
    projectiles.clear();
  });
});
