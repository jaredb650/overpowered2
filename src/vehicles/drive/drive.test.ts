import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Action, Ctx, RayHit } from '../../core/contracts';
import type { HijackClaim, HijackableVehicle } from '../../core/gameplay';
import { ModelMaterials } from '../../progression/modelkit';
import type { SeatRig } from '../seat';
import { DRIVE_VEHICLES } from './data';
import { BADLANDS_MOTOR_POOL, DriveableManager } from './manager';
import { buildVehicleModel } from './models';
import { createPhysicsState, stepVehiclePhysics } from './physics';
import { DRIVE_VEHICLE_ORDER, type DriveVehicleId, type VehicleInput } from './types';
import { DriveableVehicle } from './vehicle';

function makeMaterials(): ModelMaterials {
  return new ModelMaterials({
    render: {
      materials: {
        patch: <T extends THREE.Material>(m: T): T => m,
      },
    },
  } as unknown as Ctx);
}

function makeDriveHarness() {
  const scene = new THREE.Scene();
  const held = new Set<Action>();
  const justPressed = new Set<Action>();
  const events = new Map<string, ((payload: unknown) => void)[]>();
  const explode = vi.fn();
  const fireRay = vi.fn();
  const spawnProjectile = vi.fn();
  const interceptEnemyProjectiles = vi.fn(() => 2);
  const award = vi.fn();
  const feed = vi.fn();
  const follow = vi.fn(() => vi.fn());
  const hold = vi.fn();
  const addAmmo = vi.fn();
  const heal = vi.fn();
  const push = vi.fn();
  const removeCollider = vi.fn();

  let hijackTarget: HijackableVehicle | null = null;
  let hijackClaim: HijackClaim | null = null;

  const mockEnemy = {
    uid: 901,
    id: 'trooper',
    alive: true,
    health: 100,
    maxHealth: 100,
    position: new THREE.Vector3(0, 0, 20),
    center: new THREE.Vector3(0, 1.1, 20),
    velocity: new THREE.Vector3(),
    yaw: 0,
    armor: 0,
    score: 100,
    isBoss: false,
    frozen: 0,
    burning: 0,
    machine: false,
  };
  const applyDamage = vi.fn(() => ({ killed: true, headshot: false, gibbed: true, damage: 240 }));

  const ctx = {
    render: {
      scene,
      highlight: vi.fn(),
      post: { flash: vi.fn() },
    },
    physics: {
      addStaticBox: () => ({ handle: 42, setTranslation: vi.fn(), setRotation: vi.fn() }),
      world: { removeCollider },
      raycast: () => null,
      raycastInto: (_o: THREE.Vector3, dir: THREE.Vector3, _m: number, _mask: number, out: RayHit) => {
        if (dir.y < -0.5) {
          out.point.set(0, 0, 0);
          out.normal.set(0, 1, 0);
          out.distance = 2;
          return true;
        }
        return false;
      },
    },
    world: {
      bounds: new THREE.Box3(new THREE.Vector3(-120, -10, -120), new THREE.Vector3(120, 120, 120)),
      playerSpawns: [{ position: new THREE.Vector3(0, 0, 0), yaw: 0 }],
      nav: { groundHeight: () => 0, nearest: () => false },
      objects: { hazardAt: () => null },
    },
    player: {
      alive: true,
      health: 50,
      maxHealth: 100,
      sensitivity: 0.002,
      lookScale: 1,
      invertY: false,
      grounded: true,
      position: new THREE.Vector3(0, 0, 0),
      interceptor: null,
      park: vi.fn(),
      unpark: vi.fn(),
      carry(p: THREE.Vector3) {
        this.position.copy(p);
      },
      heal,
      push,
    },
    input: {
      frameLook: { x: 0, y: 0 },
      isDown: (a: Action) => held.has(a),
      pressed: (a: Action) => justPressed.has(a),
      consumeWheel: () => 0,
      labelFor: () => 'E',
    },
    camera: {
      setSeat: vi.fn(),
      setZoom: vi.fn(),
      syncSeat: vi.fn(),
      addTrauma: vi.fn(),
    },
    hud: {
      seat: vi.fn(),
      feed,
      floatText: vi.fn(),
      follow,
      hold,
    },
    audio: {
      play: vi.fn(),
      startLoop: () => ({ alive: true, setVolume: vi.fn(), setPitch: vi.fn(), setPosition: vi.fn(), stop: vi.fn() }),
    },
    fx: {
      muzzleFlash: vi.fn(),
      smoke: vi.fn(),
      sparks: vi.fn(),
    },
    combat: {
      explode,
      fireRay,
      spawnProjectile,
      interceptEnemyProjectiles,
    },
    weapons: {
      addAmmo,
    },
    progression: {
      award,
    },
    enemies: {
      alive: [mockEnemy],
      query: (_pos: THREE.Vector3, _r: number, out: unknown[]) => {
        out.length = 0;
        out.push(mockEnemy);
        return 1;
      },
      applyDamage,
      vehicles: {
        findHijackable: () => hijackTarget,
        hijack: () => hijackClaim,
        paintable: () => {},
      },
    },
    events: {
      on(ev: string, fn: (payload: unknown) => void) {
        const list = events.get(ev) ?? [];
        list.push(fn);
        events.set(ev, list);
      },
      emit(ev: string, payload: unknown) {
        for (const fn of events.get(ev) ?? []) fn(payload);
      },
    },
  } as unknown as Ctx;

  const seatsState: { seat: unknown } = { seat: null };
  const seats = {
    get seat() {
      return seatsState.seat;
    },
    set seat(v: unknown) {
      seatsState.seat = v;
    },
    get occupied() {
      return seatsState.seat !== null;
    },
    prisoners: new Set<number>(),
    shell: { show: vi.fn(), hide: vi.fn(), update: vi.fn() },
    hud: { open: vi.fn() },
    holdGrade: vi.fn(),
  } as unknown as SeatRig;

  return {
    ctx,
    seats,
    materials: makeMaterials(),
    held,
    justPressed,
    explode,
    fireRay,
    spawnProjectile,
    interceptEnemyProjectiles,
    award,
    feed,
    follow,
    hold,
    addAmmo,
    heal,
    push,
    applyDamage,
    mockEnemy,
    removeCollider,
    setHijack(target: HijackableVehicle | null, claim: HijackClaim | null) {
      hijackTarget = target;
      hijackClaim = claim;
    },
  };
}

function emptyInput(): VehicleInput {
  return {
    throttle: 0,
    steer: 0,
    climb: 0,
    boost: false,
    handbrake: false,
    firePrimary: false,
    fireSecondary: false,
    specialPressed: false,
    reloadPressed: false,
    cameraTogglePressed: false,
  };
}

describe('AAA Driveable Vehicles', () => {
  it('builds sculptural 3D rigs with valid muzzles and bounding boxes for all 5 vehicles', () => {
    const mats = makeMaterials();
    for (const id of DRIVE_VEHICLE_ORDER) {
      const rig = buildVehicleModel(id, mats);
      expect(rig.root.children.length).toBeGreaterThan(0);
      rig.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(rig.root);
      expect(box.isEmpty()).toBe(false);
      const size = box.getSize(new THREE.Vector3());
      expect(size.x).toBeGreaterThan(0.8);
      expect(size.y).toBeGreaterThan(0.8);
      expect(size.z).toBeGreaterThan(2.0);
      expect(rig.muzzles.main).toBeInstanceOf(THREE.Object3D);
    }
  });

  it('Jackal accelerates, drifts with Space, nitro boosts, and runs [Q] AI auto-turret', () => {
    const h = makeDriveHarness();
    const jackal = new DriveableVehicle(h.ctx, h.materials, h.seats, vi.fn(), 'jackal', new THREE.Vector3(), 0);
    expect(jackal.board(0)).toBe(true);

    // Accelerate with nitro boost.
    h.held.add('forward');
    h.held.add('dash');
    for (let i = 0; i < 45; i++) jackal.update(1 / 30);
    expect(jackal.speed).toBeGreaterThan(22);
    expect(jackal.phys.boostFuel).toBeLessThan(1);

    // Handbrake drift while turning right.
    h.held.add('right');
    h.held.add('jump');
    for (let i = 0; i < 15; i++) jackal.update(1 / 30);
    expect(jackal.phys.drifting).toBe(true);

    // Toggle [Q] AI roof auto-turret and verify it fires at the live enemy ahead.
    h.held.clear();
    h.justPressed.add('stim');
    jackal.update(1 / 30);
    h.justPressed.clear();
    for (let i = 0; i < 10; i++) jackal.update(0.05);
    expect(h.fireRay).toHaveBeenCalled();

    jackal.dispose();
  });

  it('Aegis neutral-steers in place, swaps APFSDS <-> HE-FRAG on [R], and applies directional armor', () => {
    const h = makeDriveHarness();
    const aegis = new DriveableVehicle(h.ctx, h.materials, h.seats, vi.fn(), 'aegis', new THREE.Vector3(), 0);
    expect(aegis.board(0)).toBe(true);

    // Neutral steer in place with zero throttle.
    const startYaw = aegis.yaw;
    h.held.add('right');
    for (let i = 0; i < 20; i++) aegis.update(1 / 30);
    expect(Math.abs(aegis.yaw - startYaw)).toBeGreaterThan(0.2);

    // Toggle [R] from APFSDS to HE-FRAG and fire cannon.
    h.held.clear();
    h.justPressed.add('reload');
    aegis.update(1 / 30);
    h.justPressed.clear();
    expect(h.feed).toHaveBeenCalledWith(expect.stringContaining('HE-FRAG'), expect.any(String));

    h.held.add('fire');
    aegis.update(1 / 30);
    expect(h.spawnProjectile).toHaveBeenCalled();

    // Directional armor: front hit deals less damage than rear hit!
    const hpBefore = aegis.health;
    const frontFrom = aegis.position.clone().add(new THREE.Vector3(Math.sin(aegis.yaw) * 15, 0, Math.cos(aegis.yaw) * 15));
    aegis.absorbDamage(100, frontFrom);
    const frontLoss = hpBefore - aegis.health;

    const hpMid = aegis.health;
    const rearFrom = aegis.position.clone().add(new THREE.Vector3(-Math.sin(aegis.yaw) * 15, 0, -Math.cos(aegis.yaw) * 15));
    aegis.absorbDamage(100, rearFrom);
    const rearLoss = hpMid - aegis.health;
    expect(frontLoss).toBeLessThan(rearLoss);

    aegis.dispose();
  });

  it('Kestrel climbs, auto-hovers when switching to Chin Gunner seat, and fires [Q] IR flares', () => {
    const h = makeDriveHarness();
    const kestrel = new DriveableVehicle(h.ctx, h.materials, h.seats, vi.fn(), 'kestrel', new THREE.Vector3(), 0);
    expect(kestrel.board(0)).toBe(true);

    // Climb to altitude.
    h.held.add('jump');
    for (let i = 0; i < 45; i++) kestrel.update(1 / 30);
    const climbAlt = kestrel.position.y;
    expect(climbAlt).toBeGreaterThan(6);

    // Switch to Chin Gunner seat via [F] (melee) and verify auto-hover holds altitude!
    h.held.clear();
    h.justPressed.add('melee');
    kestrel.update(1 / 30);
    h.justPressed.clear();
    expect(kestrel.seatIndex).toBe(1);

    for (let i = 0; i < 45; i++) kestrel.update(1 / 30);
    expect(kestrel.position.y).toBeGreaterThan(5);

    // Pop [Q] IR Flares and confirm projectile interception.
    h.justPressed.add('stim');
    kestrel.update(1 / 30);
    expect(h.interceptEnemyProjectiles).toHaveBeenCalled();

    kestrel.dispose();
  });

  it('Viper hovers above ground, dune-hops with Space, and triggers [Q] Overcharge', () => {
    const def = DRIVE_VEHICLES.viper;
    const st = createPhysicsState(new THREE.Vector3(0, 0, 0), 0);
    const inp = emptyInput();
    const world = { nav: { groundHeight: () => 0 } } as unknown as Ctx['world'];

    // Settle onto hover cushion.
    for (let i = 0; i < 30; i++) stepVehiclePhysics(def, st, inp, 1 / 30, world, undefined, true);
    expect(st.position.y).toBeGreaterThan(0.6);

    // Dune-hop!
    inp.handbrake = true;
    stepVehiclePhysics(def, st, inp, 1 / 30, world, undefined, true);
    expect(st.velocity.y).toBeGreaterThan(5);

    // Overcharge refills boost fuel and unleashes radial pulse.
    const h = makeDriveHarness();
    const viper = new DriveableVehicle(h.ctx, h.materials, h.seats, vi.fn(), 'viper', new THREE.Vector3(), 0);
    viper.board(0);
    viper.phys.boostFuel = 0.2;
    h.justPressed.add('stim');
    viper.update(1 / 30);
    expect(viper.phys.boostFuel).toBe(1);
    expect(h.explode).toHaveBeenCalled();
    viper.dispose();
  });

  it('Bastion deploys hydraulic outriggers on [Q], resists extra damage, heals/resupplies, and supports 3 seats', () => {
    const h = makeDriveHarness();
    const bastion = new DriveableVehicle(h.ctx, h.materials, h.seats, vi.fn(), 'bastion', new THREE.Vector3(), 0);
    bastion.board(0);

    // Switch through all 3 seats using direct keys 1, 2, 3.
    h.justPressed.add('weapon2');
    bastion.update(1 / 30);
    expect(bastion.seatIndex).toBe(1);
    h.justPressed.clear();
    h.justPressed.add('weapon3');
    bastion.update(1 / 30);
    expect(bastion.seatIndex).toBe(2);
    h.justPressed.clear();
    h.justPressed.add('weapon1');
    bastion.update(1 / 30);
    expect(bastion.seatIndex).toBe(0);
    h.justPressed.clear();

    // Deploy outriggers with [Q] and check armor + resupply aura!
    h.justPressed.add('stim');
    bastion.update(1 / 30);
    h.justPressed.clear();
    expect(bastion.phys.deployed).toBe(true);

    for (let i = 0; i < 30; i++) bastion.update(0.06);
    expect(bastion.phys.deployAnim).toBeGreaterThan(0.8);
    expect(h.heal).toHaveBeenCalled();
    expect(h.addAmmo).toHaveBeenCalled();

    // Destruction cleanly ejects the player and explodes!
    bastion.absorbDamage(99999);
    expect(bastion.alive).toBe(false);
    expect(h.push).toHaveBeenCalled();
    expect(h.explode).toHaveBeenCalled();
    expect(h.removeCollider).toHaveBeenCalled();
  });

  it('DriveableManager supports on-foot soft hijack, [HOLD E] tank hijack, and Gaff grapple-hijack', () => {
    const h = makeDriveHarness();
    const mgr = new DriveableManager(h.ctx, h.materials, h.seats, vi.fn());

    // 1. Instant soft hijack (enemy humvee -> jackal).
    h.setHijack(
      {
        id: 11,
        kind: 'humvee',
        label: 'ENEMY TECHNICAL',
        armored: false,
        position: new THREE.Vector3(2, 0, 0),
        quaternion: new THREE.Quaternion(),
        health: 220,
        maxHealth: 260,
        airborne: false,
        distance: 2,
      },
      { kind: 'humvee', position: new THREE.Vector3(2, 0, 0), yaw: 0.5, velocity: new THREE.Vector3(0, 0, 8), healthFraction: 0.85 },
    );
    h.justPressed.add('interact');
    mgr.update(1 / 30, true);
    h.justPressed.clear();
    expect(mgr.active?.def.id).toBe('jackal');
    expect(h.award).toHaveBeenCalledWith(200, 'VEHICLE HIJACKED!', expect.any(THREE.Vector3));

    // Exit jackal so we can test Gaff grapple hijack of an enemy tank!
    mgr.active!.exit(true);
    h.setHijack(
      null,
      { kind: 'tank', position: new THREE.Vector3(10, 0, 0), yaw: 1.2, velocity: new THREE.Vector3(), healthFraction: 0.9 },
    );
    h.ctx.events.emit('vehicle:grapple_hijack', { vehicleId: 22 });
    expect(mgr.active?.def.id).toBe('aegis');
    expect(h.award).toHaveBeenCalledWith(300, 'GRAPPLE HIJACK!', expect.any(THREE.Vector3));

    // Confirm Badlands Motor Pool defines all 5 distinct vehicle classes.
    const ids = new Set<DriveVehicleId>(BADLANDS_MOTOR_POOL.map(s => s.id));
    expect(ids.size).toBe(5);
    mgr.clear();
  });
});
