import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { lookup } from '../../audio/catalog';
import type { Action, Ctx, RayHit } from '../../core/contracts';
import type { HijackClaim, HijackableVehicle, VehicleRadarTarget } from '../../core/gameplay';
import { ModelMaterials } from '../../progression/modelkit';
import type { SeatRig } from '../seat';
import { DRIVE_VEHICLE_ORDER, DRIVE_VEHICLES } from './data';
import { BADLANDS_MOTOR_POOL, DriveableManager } from './manager';
import { buildVehicleModel } from './models';
import { createPhysicsState, stepVehiclePhysics } from './physics';
import type { DriveVehicleId, VehicleInput } from './types';
import { DriveableVehicle } from './vehicle';
import { Projectiles } from '../../weapons/Projectiles';
import type { Combat } from '../../weapons/Combat';

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
  const fireRay = vi.fn(() => ({ hitEnemy: false, headshot: false, killed: false, kills: 0, end: new THREE.Vector3(0, 1, 40) }));
  const spawnProjectile = vi.fn();
  const interceptEnemyProjectiles = vi.fn(() => 2);
  const hasIncomingEnemyMissile = vi.fn(() => false);
  const award = vi.fn();
  const feed = vi.fn();
  const follow = vi.fn(() => vi.fn());
  const hold = vi.fn();
  const addAmmo = vi.fn();
  const setHolstered = vi.fn();
  const heal = vi.fn();
  const push = vi.fn();
  const removeCollider = vi.fn();
  const pushWrecks = vi.fn(() => 1);
  const vehicleRam = vi.fn(() => null as { hit: boolean; armored: boolean; killed: boolean; point: THREE.Vector3 } | null);
  const radarTargets: VehicleRadarTarget[] = [];

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
    char: { mesh: new THREE.Group() },
  };
  const applyDamage = vi.fn(() => ({ killed: true, headshot: false, gibbed: false, damage: 240 }));
  const audioPlay = vi.fn();
  const startLoop = vi.fn((_id?: string, _opts?: unknown) => ({ alive: true, setVolume: vi.fn(), setPitch: vi.fn(), setPosition: vi.fn(), stop: vi.fn() }));
  const enemiesList = [mockEnemy];
  const domElement = { style: { filter: '' } };

  const ctx = {
    render: {
      scene,
      renderer: { domElement },
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
      yaw: 0,
      pitch: 0,
      position: new THREE.Vector3(0, 0, 0),
      eye: new THREE.Vector3(0, 1.7, 0),
      forward: new THREE.Vector3(0, 0, -1),
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
      play: audioPlay,
      startLoop,
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
      hasIncomingEnemyMissile,
    },
    weapons: {
      addAmmo,
      setHolstered,
    },
    progression: {
      award,
    },
    enemies: {
      alive: enemiesList,
      query: (_pos: THREE.Vector3, _r: number, out: unknown[]) => {
        out.length = 0;
        out.push(...enemiesList);
        return out.length;
      },
      applyDamage,
      vehicles: {
        findHijackable: () => hijackTarget,
        hijack: () => hijackClaim,
        paintable: () => 0,
        pushWrecks,
        vehicleRam,
        listTargets: (out: VehicleRadarTarget[]) => {
          out.length = 0;
          out.push(...radarTargets);
          return out.length;
        },
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
    hasIncomingEnemyMissile,
    award,
    feed,
    follow,
    hold,
    addAmmo,
    setHolstered,
    heal,
    push,
    applyDamage,
    mockEnemy,
    enemiesList,
    audioPlay,
    startLoop,
    removeCollider,
    pushWrecks,
    vehicleRam,
    radarTargets,
    domElement,
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
    lookX: 0,
    lookY: 0,
  };
}

describe('AAA Driveable Vehicles (10-Vehicle Fleet)', () => {
  it('builds sculptural 3D rigs with valid muzzles and bounding boxes for all 10 vehicles', () => {
    const mats = makeMaterials();
    expect(DRIVE_VEHICLE_ORDER).toHaveLength(10);
    for (const id of DRIVE_VEHICLE_ORDER) {
      const rig = buildVehicleModel(id, mats);
      expect(rig.root.children.length).toBeGreaterThan(0);
      rig.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(rig.root);
      expect(box.isEmpty()).toBe(false);
      const size = box.getSize(new THREE.Vector3());
      expect(size.x).toBeGreaterThan(0.6);
      expect(size.y).toBeGreaterThan(0.8);
      expect(size.z).toBeGreaterThan(1.8);
      expect(rig.muzzles.main).toBeInstanceOf(THREE.Object3D);
    }
  });

  it('[E] exit bug fix: pressing interact exits cleanly without re-boarding on the same frame', () => {
    const h = makeDriveHarness();
    const mgr = new DriveableManager(h.ctx, h.materials, h.seats, vi.fn());
    const jackal = mgr.spawn('jackal', new THREE.Vector3(0, 0, 0), 0);

    // Board via [E].
    h.justPressed.add('interact');
    mgr.update(1 / 30, true);
    expect(jackal.occupied).toBe(true);
    expect(mgr.active).toBe(jackal);

    // Press [E] on the next tick to exit — MUST stay exited on the same frame!
    mgr.update(1 / 30, true);
    expect(jackal.occupied).toBe(false);
    expect(mgr.active).toBeNull();
    expect(h.seats.occupied).toBe(false);

    // Even if interact is still flagged during brief cooldown, must NOT accidentally re-board.
    mgr.update(1 / 30, true);
    expect(jackal.occupied).toBe(false);

    mgr.clear();
  });

  it('boost hysteresis locks empty fuel until 22% refill (zero Shift camera chatter)', () => {
    const def = DRIVE_VEHICLES.jackal;
    const st = createPhysicsState(new THREE.Vector3(), 0);
    const inp = emptyInput();
    inp.throttle = 1;
    inp.boost = true;
    const world = { nav: { groundHeight: () => 0 } } as unknown as Ctx['world'];

    // Drain boost fuel until empty -> boostLocked MUST latch true immediately!
    for (let i = 0; i < 120 && !st.boostLocked; i++) {
      stepVehiclePhysics(def, st, inp, 1 / 30, world, undefined, true);
    }
    expect(st.boostLocked).toBe(true);
    expect(st.boosting).toBe(false);

    // While refilling from 0 -> 0.22, boost MUST remain cleanly locked off with ZERO frame-to-frame chatter!
    let toggles = 0;
    let prev = st.boosting;
    for (let i = 0; i < 20; i++) {
      stepVehiclePhysics(def, st, inp, 1 / 30, world, undefined, true);
      if (st.boosting !== prev) {
        toggles++;
        prev = st.boosting;
      }
    }
    expect(toggles).toBe(0);
    expect(st.boostFuel).toBeGreaterThan(0.1);
  });

  it('true ramp jumping launches vehicles off ramp crests while keeping flat driving grounded', () => {
    const def = DRIVE_VEHICLES.jackal;
    const st = createPhysicsState(new THREE.Vector3(0, 0, 0), 0);
    st.velocity.set(0, 0, 26);
    const inp = emptyInput();
    inp.throttle = 1;

    // Synthetic ramp: rises from z=2..14 (height 0 -> 4.2m), then drops back to flat desert y=0 after z=14!
    const rampWorld = {
      nav: {
        groundHeight: (_x: number, _y: number, z: number) => (z >= 2 && z <= 14 ? ((z - 2) / 12) * 4.2 : 0),
      },
    } as unknown as Ctx['world'];

    let launched = false;
    let maxY = 0;
    for (let i = 0; i < 45; i++) {
      stepVehiclePhysics(def, st, inp, 1 / 30, rampWorld, undefined, true);
      if (!st.grounded && st.velocity.y > 4) launched = true;
      maxY = Math.max(maxY, st.position.y);
    }
    expect(launched).toBe(true);
    expect(maxY).toBeGreaterThan(4.6);
  });

  it('Jackal accelerates, drifts, runs [Q] auto-turret, and mounts 3D Hybrid Gun in Seat 2 1P', () => {
    const h = makeDriveHarness();
    const jackal = new DriveableVehicle(h.ctx, h.materials, h.seats, vi.fn(), 'jackal', new THREE.Vector3(), 0);
    expect(jackal.board(0)).toBe(true);

    h.held.add('forward');
    h.held.add('dash');
    for (let i = 0; i < 45; i++) jackal.update(1 / 30);
    expect(jackal.speed).toBeGreaterThan(22);

    h.held.add('right');
    h.held.add('jump');
    for (let i = 0; i < 15; i++) jackal.update(1 / 30);
    expect(jackal.phys.drifting).toBe(true);

    // Toggle [Q] AI roof auto-turret.
    h.held.clear();
    h.justPressed.add('stim');
    jackal.update(1 / 30);
    h.justPressed.clear();
    for (let i = 0; i < 10; i++) jackal.update(0.05);
    expect(h.fireRay).toHaveBeenCalled();

    // Switch to Seat 2 (Roof Gunner) -> hides exterior turret so 1P 3D Hybrid Gun renders cleanly!
    jackal.switchSeat(1);
    expect(jackal.activeSeatSpec.mountGun).toBe('hybrid');
    expect(jackal.model.turret?.visible).toBe(false);
    h.held.add('aim'); // Fire 40mm Smart-AGL secondary!
    jackal.update(1 / 30);
    expect(h.spawnProjectile).toHaveBeenCalled();

    jackal.dispose();
  });

  it('Nomad Quad and Razor Moto lean-to-turn and unholster hand-held weapons in Passenger Seat 2', () => {
    const h = makeDriveHarness();
    const moto = new DriveableVehicle(h.ctx, h.materials, h.seats, vi.fn(), 'moto', new THREE.Vector3(), 0);
    expect(moto.board(0)).toBe(true);

    h.held.add('forward');
    h.held.add('right');
    for (let i = 0; i < 30; i++) moto.update(1 / 30);
    // Deep motorcycle banking roll!
    expect(Math.abs(moto.phys.roll)).toBeGreaterThan(0.25);

    // Switch to Pillion Seat 2 -> actual hand-held player weapons unholstered!
    h.held.clear();
    moto.switchSeat(1);
    expect(moto.activeSeatSpec.passengerWeapons).toBe(true);
    expect(h.setHolstered).toHaveBeenCalledWith(false);
    moto.dispose();
  });

  it('Viper hovers, dune-hops, charges & blasts Particle Lance beam, and triggers [Q] Overcharge', () => {
    const def = DRIVE_VEHICLES.viper;
    const st = createPhysicsState(new THREE.Vector3(0, 0, 0), 0);
    const inp = emptyInput();
    const world = { nav: { groundHeight: () => 0 } } as unknown as Ctx['world'];

    for (let i = 0; i < 30; i++) stepVehiclePhysics(def, st, inp, 1 / 30, world, undefined, true);
    expect(st.position.y).toBeGreaterThan(0.6);

    inp.handbrake = true;
    stepVehiclePhysics(def, st, inp, 1 / 30, world, undefined, true);
    expect(st.velocity.y).toBeGreaterThan(5);

    // Charge Particle Lance beam to full charge and fire!
    const h = makeDriveHarness();
    const viper = new DriveableVehicle(h.ctx, h.materials, h.seats, vi.fn(), 'viper', new THREE.Vector3(), 0);
    viper.board(0);
    h.held.add('fire');
    for (let i = 0; i < 30; i++) viper.update(1 / 30);
    expect(h.fireRay).toHaveBeenCalledWith(expect.any(THREE.Vector3), expect.any(THREE.Vector3), expect.objectContaining({ source: 'viper_lance', armorPiercing: true }));
    expect(h.explode).toHaveBeenCalled();

    // [Q] Overcharge refills boost fuel.
    h.held.clear();
    viper.phys.boostFuel = 0.2;
    h.justPressed.add('stim');
    viper.update(1 / 30);
    expect(viper.phys.boostFuel).toBe(1);
    viper.dispose();
  });

  it('Kestrel engages FLIR Thermal Cam in Seat 2, auto-hovers, and breaks missile lock with [Q] IR Flares', () => {
    const h = makeDriveHarness();
    const kestrel = new DriveableVehicle(h.ctx, h.materials, h.seats, vi.fn(), 'kestrel', new THREE.Vector3(), 0);
    expect(kestrel.board(0)).toBe(true);

    h.held.add('jump');
    for (let i = 0; i < 45; i++) kestrel.update(1 / 30);
    expect(kestrel.position.y).toBeGreaterThan(6);

    // Switch to Seat 2 (FLIR Chin Gunner) -> thermal CSS filter applied & auto-hover holds altitude!
    h.held.clear();
    kestrel.switchSeat(1);
    expect(kestrel.activeSeatSpec.hudMode).toBe('thermal');
    expect(h.domElement.style.filter).toContain('grayscale');

    for (let i = 0; i < 35; i++) kestrel.update(1 / 30);
    expect(kestrel.position.y).toBeGreaterThan(5);

    // Incoming enemy missile sets warning; [Q] Flares activates countermeasure & intercepts!
    h.hasIncomingEnemyMissile.mockReturnValue(true);
    kestrel.update(1 / 30);
    expect(kestrel.isCountermeasureActive).toBe(false);

    h.justPressed.add('stim');
    kestrel.update(1 / 30);
    expect(kestrel.isCountermeasureActive).toBe(true);
    expect(h.interceptEnemyProjectiles).toHaveBeenCalled();
    kestrel.dispose();
  });

  it('Harrier & Warthog toggle VTOL <-> Mach Jet, cycle ordnance on [R], compute CCIP, and drop bombs', () => {
    const h = makeDriveHarness();
    const harrier = new DriveableVehicle(h.ctx, h.materials, h.seats, vi.fn(), 'harrier', new THREE.Vector3(), 0);
    expect(harrier.board(0)).toBe(true);
    expect(harrier.phys.vtolMode).toBe(true);

    // Lift off in VTOL mode!
    h.held.add('jump');
    for (let i = 0; i < 35; i++) harrier.update(1 / 30);
    expect(harrier.position.y).toBeGreaterThan(8);
    h.held.clear();

    // Press [Q] to kick into Mach Jet flight!
    h.justPressed.add('stim');
    harrier.update(1 / 30);
    h.justPressed.clear();
    expect(harrier.phys.vtolMode).toBe(false);

    h.held.add('forward');
    h.held.add('dash');
    for (let i = 0; i < 35; i++) harrier.update(1 / 30);
    expect(harrier.speed).toBeGreaterThan(45);

    // Drop Mk-82 gravity bomb on RMB!
    h.held.add('aim');
    harrier.update(1 / 30);
    expect(h.spawnProjectile).toHaveBeenCalledWith(expect.objectContaining({ source: 'harrier_bomb' }));

    // Cycle [R] ordnance: Mk-82 HE -> BLU-27 NAPALM BOMBS -> AIM-9 / AGM LOCK MISSILES -> HYDRA-70 ROCKETS!
    h.held.clear();
    h.justPressed.add('reload');
    harrier.update(1 / 30);
    expect(h.feed).toHaveBeenCalledWith(expect.stringContaining('NAPALM'), expect.any(String));

    // Fire in Napalm mode and confirm napalm flag is passed to spawnProjectile!
    h.justPressed.clear();
    h.held.add('aim');
    for (let i = 0; i < 20; i++) harrier.update(1 / 30);
    expect(h.spawnProjectile).toHaveBeenCalledWith(expect.objectContaining({ source: 'harrier_napalm', napalm: true }));

    h.held.clear();
    h.justPressed.add('reload');
    harrier.update(1 / 30);
    expect(h.feed).toHaveBeenCalledWith(expect.stringContaining('LOCK MISSILES'), expect.any(String));
    harrier.update(1 / 30);
    expect(h.feed).toHaveBeenCalledWith(expect.stringContaining('HYDRA-70'), expect.any(String));
    harrier.dispose();
  });

  it('Bastion deploys, heals/resupplies, and computes AA Lead Pips on enemy choppers in Seat 2', () => {
    const h = makeDriveHarness();
    const bastion = new DriveableVehicle(h.ctx, h.materials, h.seats, vi.fn(), 'bastion', new THREE.Vector3(), 0);
    bastion.board(0);

    // Add a live flying enemy chopper to radar and switch to AA Vulcan Seat 2!
    h.radarTargets.push({
      id: 77,
      kind: 'chopper',
      label: 'ATTACK CHOPPER',
      position: new THREE.Vector3(0, 28, 60),
      velocity: new THREE.Vector3(14, 0, 0),
      airborne: true,
    });
    bastion.switchSeat(1);
    bastion.update(1 / 30);
    const hud = (h.seats.seat as { vehicleHud?: { leadPips: readonly (readonly [number, number, number])[] } })?.vehicleHud;
    expect(hud?.leadPips.length).toBe(1);
    // Lead pip sits ahead of the chopper's x-position along its velocity!
    expect(hud!.leadPips[0]![0]).toBeGreaterThan(1);

    // Deploy outriggers with [Q] and confirm heal & resupply aura!
    bastion.switchSeat(0);
    h.justPressed.add('stim');
    bastion.update(1 / 30);
    h.justPressed.clear();
    expect(bastion.phys.deployed).toBe(true);
    for (let i = 0; i < 30; i++) bastion.update(0.06);
    expect(h.heal).toHaveBeenCalled();
    expect(h.addAmmo).toHaveBeenCalled();

    bastion.dispose();
  });

  it('tiered GTA roadkill, pushable wrecks, and kamikaze ramming work cleanly', () => {
    const h = makeDriveHarness();
    const jackal = new DriveableVehicle(h.ctx, h.materials, h.seats, vi.fn(), 'jackal', new THREE.Vector3(), 0);
    jackal.board(0);

    // Tier 1: low-medium speed (9 m/s) -> non-gib hood vault ragdoll!
    jackal.phys.velocity.set(0, 0, 9);
    h.mockEnemy.position.set(0, 0, 1);
    h.mockEnemy.center.set(0, 1.1, 1);
    jackal.update(0.06);
    expect(h.applyDamage).toHaveBeenCalledWith(h.mockEnemy, expect.objectContaining({ gib: false }));
    expect(h.pushWrecks).toHaveBeenCalled();

    // Tier 2: high speed (18 m/s) side-clipped -> partial dismemberment (arm/leg region) without full gib!
    h.applyDamage.mockClear();
    h.held.add('forward');
    h.mockEnemy.position.set(1.0, 0, 2);
    for (let i = 0; i < 10; i++) {
      jackal.phys.velocity.set(0, 0, 18);
      jackal.update(0.06);
    }
    const lastCall = h.applyDamage.mock.calls.at(-1) as unknown[] | undefined;
    const tier2Call = lastCall?.[1] as { gib?: boolean; region?: string } | undefined;
    expect(tier2Call?.gib).toBe(false);
    expect(['armL', 'armR', 'legL', 'legR']).toContain(tier2Call?.region);

    jackal.dispose();
  });

  it('Badlands 10-vehicle Motor Pool stages all 10 distinct vehicles with clean clearance and hijack works', () => {
    const ids = new Set<DriveVehicleId>(BADLANDS_MOTOR_POOL.map(s => s.id));
    expect(ids.size).toBe(10);
    // Ensure zero overlap between any two staged vehicles.
    for (let i = 0; i < BADLANDS_MOTOR_POOL.length; i++) {
      for (let j = i + 1; j < BADLANDS_MOTOR_POOL.length; j++) {
        const a = BADLANDS_MOTOR_POOL[i]!.at;
        const b = BADLANDS_MOTOR_POOL[j]!.at;
        const dist = Math.hypot(a[0] - b[0], a[2] - b[2]);
        expect(dist).toBeGreaterThanOrEqual(4.5);
      }
    }

    const h = makeDriveHarness();
    const mgr = new DriveableManager(h.ctx, h.materials, h.seats, vi.fn());
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
    expect(mgr.active?.def.id).toBe('jackal');
    expect(h.award).toHaveBeenCalledWith(200, 'VEHICLE HIJACKED!', expect.any(THREE.Vector3));
    mgr.clear();
  });

  it('every driveable vehicle engine loop, dual-layer loop, and weapon/alt audio ID exists in CATALOG', () => {
    for (const id of DRIVE_VEHICLE_ORDER) {
      const def = DRIVE_VEHICLES[id];
      expect(lookup(def.engineLoop), `${id} engineLoop ${def.engineLoop}`).toBeDefined();
      if (def.engineLayerLoop) {
        expect(lookup(def.engineLayerLoop), `${id} engineLayerLoop ${def.engineLayerLoop}`).toBeDefined();
      }
      for (const seat of def.seats) {
        for (const w of [seat.primary, seat.secondary]) {
          if (!w) continue;
          expect(lookup(w.audio), `${id}/${seat.name}/${w.name} audio ${w.audio}`).toBeDefined();
          for (const alt of [w.altMode, w.thirdMode, w.fourthMode]) {
            if (alt?.audio) {
              expect(lookup(alt.audio), `${id}/${seat.name}/${alt.name} audio ${alt.audio}`).toBeDefined();
            }
          }
        }
      }
    }
  });

  it('player-favorable ramming caps self-damage and prevents low-speed W bounce spam via cooldown', () => {
    const h = makeDriveHarness();
    const jackal = new DriveableVehicle(h.ctx, h.materials, h.seats, vi.fn(), 'jackal', new THREE.Vector3(), 0);
    jackal.board(0);
    const startHp = jackal.health;

    // High-speed ram into an enemy vehicle while holding W.
    h.vehicleRam.mockReturnValue({ hit: true, armored: false, killed: false, point: new THREE.Vector3(0, 1, 3) });
    h.held.add('forward');
    jackal.phys.velocity.set(0, 0, 22);
    jackal.update(1 / 30);
    const hpAfterFirstHit = jackal.health;
    expect(hpAfterFirstHit).toBeLessThan(startHp);
    // Self-damage is strongly capped (<= 10% of maxHealth even at high speed).
    expect(startHp - hpAfterFirstHit).toBeLessThanOrEqual(jackal.def.maxHealth * 0.1 + 1);

    // Subsequent rapid frames holding W while bouncing must NOT apply spam damage!
    for (let i = 0; i < 15; i++) {
      jackal.phys.velocity.set(0, 0, 14);
      jackal.update(1 / 30);
    }
    expect(jackal.health).toBe(hpAfterFirstHit);
    jackal.dispose();
  });

  it('Jackal [Q] Auto-Turret dynamically switches between 40mm Smart-AGL (clusters) and .50 Cal HMG (close solo)', () => {
    const h = makeDriveHarness();
    const jackal = new DriveableVehicle(h.ctx, h.materials, h.seats, vi.fn(), 'jackal', new THREE.Vector3(), 0);
    jackal.board(0);

    // Enable Auto-Turret with [Q].
    h.justPressed.add('stim');
    jackal.update(1 / 30);
    h.justPressed.clear();

    // Cluster of 2 enemies at 28m -> auto-turret selects 40mm Smart-AGL!
    h.mockEnemy.position.set(0, 0, 28);
    h.mockEnemy.center.set(0, 1.1, 28);
    const buddy = {
      ...h.mockEnemy,
      uid: 902,
      position: new THREE.Vector3(2.5, 0, 28),
      center: new THREE.Vector3(2.5, 1.1, 28),
      char: { mesh: new THREE.Group() },
    };
    h.enemiesList.push(buddy);
    for (let i = 0; i < 12; i++) jackal.update(0.1);
    expect(h.spawnProjectile).toHaveBeenCalledWith(expect.objectContaining({ source: 'jackal_auto_agl' }));

    // Close solo enemy at 9m -> switches back to .50 Cal HMG (no self-blast)!
    h.enemiesList.length = 1;
    h.mockEnemy.position.set(0, 0, 9);
    h.mockEnemy.center.set(0, 1.1, 9);
    h.fireRay.mockClear();
    for (let i = 0; i < 12; i++) jackal.update(0.1);
    expect(h.fireRay).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ source: 'jackal_auto_turret' }),
    );

    jackal.dispose();
  });

  it('Kestrel Pilot 1P uses Attack Chopper Killstreak Cam with zero exterior clipping and Gunner uses FLIR Thermal', () => {
    const h = makeDriveHarness();
    const kestrel = new DriveableVehicle(h.ctx, h.materials, h.seats, vi.fn(), 'kestrel', new THREE.Vector3(), 0);
    kestrel.board(0);
    expect(kestrel.activeSeatSpec.hudMode).toBe('chopper');

    // Toggle to 1P via [C] -> exterior body hidden so gun/canopy never clips camera!
    (kestrel as unknown as { keyCPressed: boolean }).keyCPressed = true;
    kestrel.update(1 / 30);
    const hud1p = (h.seats.seat as { vehicleHud?: { cameraLabel: string; hudMode: string } } | null)?.vehicleHud;
    expect(hud1p?.cameraLabel).toBe('1P');
    expect(hud1p?.hudMode).toBe('chopper');
    expect(kestrel.model.body.visible).toBe(false);

    // Switch to Seat 2 (Gunner) -> thermal mode active and body still hidden cleanly in 1P.
    kestrel.switchSeat(1);
    kestrel.update(1 / 30);
    expect(kestrel.activeSeatSpec.hudMode).toBe('thermal');
    expect(kestrel.model.body.visible).toBe(false);
    kestrel.dispose();
  });

  it('Jet Mach right bank leans right with matching camera roll, populates Gun-Tracking Pipper, and Moto leans into turns', () => {
    const h = makeDriveHarness();
    const warthog = new DriveableVehicle(h.ctx, h.materials, h.seats, vi.fn(), 'warthog', new THREE.Vector3(0, 30, 0), 0);
    warthog.board(0);
    warthog.phys.vtolMode = false;
    warthog.phys.position.set(0, 30, 0);
    warthog.phys.velocity.set(0, 0, 55);

    // Hold right turn in Mach flight: right wing drops (phys.roll > 0) and camera rolls matching cockpit bank (seat.view.roll < 0).
    h.held.add('forward');
    h.held.add('right');
    for (let i = 0; i < 20; i++) warthog.update(1 / 30);
    expect(warthog.phys.roll).toBeGreaterThan(0.1);
    const seat = h.seats.seat as unknown as {
      view: { roll: number };
      vehicleHud?: { gunPipWorld?: readonly [number, number, number] | null; ccipLabel?: string } | null;
    };
    expect(seat.view.roll).toBeLessThan(-0.02);
    expect(seat.vehicleHud?.gunPipWorld).not.toBeNull();
    expect(seat.vehicleHud?.ccipLabel).toBe('CCIP HE');
    warthog.dispose();

    // Moto leans INTO a right turn (positive phys.roll = right side drops).
    const motoDef = DRIVE_VEHICLES.moto;
    const motoPhys = createPhysicsState(new THREE.Vector3(), 0);
    const world = { nav: { groundHeight: () => 0 } } as unknown as Ctx['world'];
    const inp = emptyInput();
    inp.throttle = 1;
    inp.steer = 1;
    for (let i = 0; i < 40; i++) {
      stepVehiclePhysics(motoDef, motoPhys, inp, 1 / 30, world, undefined, true);
    }
    expect(motoPhys.roll).toBeGreaterThan(0.1);
  });

  it('abandoned airborne helicopter spirals down and explodes on impact while preserving bodyBaseY on aircraft models', () => {
    const h = makeDriveHarness();
    const valkyrie = new DriveableVehicle(h.ctx, h.materials, h.seats, vi.fn(), 'valkyrie', new THREE.Vector3(), 0);
    valkyrie.update(1 / 30);
    // Aircraft bodyBaseY keeps landing gear on ground without sinking.
    expect(valkyrie.model.body.position.y).toBeGreaterThanOrEqual(1.4);

    // Take off high, then bail out while airborne -> enters abandonedFall, drops, and explodes on slam!
    valkyrie.board(0);
    valkyrie.phys.position.set(0, 18, 0);
    valkyrie.phys.velocity.set(0, 0, 10);
    valkyrie.exit(false);
    expect(valkyrie.occupied).toBe(false);

    for (let i = 0; i < 120 && valkyrie.alive; i++) {
      valkyrie.update(1 / 30);
    }
    expect(valkyrie.alive).toBe(false);
    expect(h.explode).toHaveBeenCalled();
    valkyrie.dispose();
  });

  it('aircraft bombs drop modeled 3D HE & Napalm meshes with no trail/muzzleFlash, kachunk release audio, and Doppler falling whistle', () => {
    expect(lookup('bomb_release')).toBeDefined();
    expect(lookup('bomb_whistle_loop')).toBeDefined();

    const h = makeDriveHarness();
    const muzzleFlash = vi.fn();
    (h.ctx.fx as unknown as { muzzleFlash: typeof muzzleFlash }).muzzleFlash = muzzleFlash;
    const playSpy = h.ctx.audio.play as ReturnType<typeof vi.fn>;

    const warthog = new DriveableVehicle(h.ctx, h.materials, h.seats, vi.fn(), 'warthog', new THREE.Vector3(0, 40, 0), 0);
    warthog.board(0);
    warthog.phys.velocity.set(0, 0, 52);
    playSpy.mockClear();
    muzzleFlash.mockClear();

    // Drop HE MK-84 bomb (secondary fire = 'aim').
    h.held.add('aim');
    warthog.update(1 / 30);
    h.held.delete('aim');

    expect(h.spawnProjectile).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'shell',
      source: 'warthog_bomb',
      bomb: true,
      trail: 'none',
    }));
    expect(muzzleFlash).not.toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalledWith('bomb_release', expect.any(Object));
    expect(playSpy).not.toHaveBeenCalledWith('mortar_whistle', expect.any(Object));
    warthog.dispose();

    // Verify Projectiles starts bomb_whistle_loop with Doppler, sweeps pitch down while falling, renders 3D bomb layers (zero shell/cone), and stops on clear().
    const setPosition = vi.fn();
    const setPitch = vi.fn();
    const setVolume = vi.fn();
    const stop = vi.fn();
    const startLoop = vi.fn(() => ({ alive: true, setPosition, setPitch, setVolume, stop }));
    const projCtx = {
      render: { scene: new THREE.Scene() },
      time: { elapsed: 0, realDt: 0.05 },
      physics: { raycast: () => null },
      enemies: { raycast: () => null, nearby: () => [], vehicles: undefined },
      fx: { smoke: vi.fn(), ring: vi.fn(), sparks: vi.fn(), impact: vi.fn() },
      audio: { play: vi.fn(), startLoop },
    } as unknown as Ctx;
    const combatStub = { watching: 0, explode: vi.fn(), napalmBurst: vi.fn() } as unknown as Combat;
    const projectiles = new Projectiles(projCtx, combatStub);
    projectiles.init();

    // Spawn 1 HE bomb + 1 Napalm canister bomb.
    projectiles.spawn({
      origin: new THREE.Vector3(0, 80, 0),
      velocity: new THREE.Vector3(0, -3.5, 45),
      kind: 'shell',
      team: 'player',
      damage: 1350,
      source: 'warthog_bomb',
      gravity: 28,
      lifetime: 10,
      trail: 'none',
      size: 1.22,
      bomb: true,
    });
    projectiles.spawn({
      origin: new THREE.Vector3(6, 80, 0),
      velocity: new THREE.Vector3(0, -3.5, 45),
      kind: 'shell',
      team: 'player',
      damage: 540,
      source: 'warthog_napalm',
      gravity: 28,
      lifetime: 10,
      trail: 'none',
      size: 1.08,
      bomb: true,
      napalm: true,
    });

    expect(startLoop).toHaveBeenCalledWith('bomb_whistle_loop', expect.objectContaining({ doppler: true }));
    expect(startLoop).toHaveBeenCalledTimes(2);

    projectiles.update(0.25);
    const pitchEarly = setPitch.mock.calls[0]![0] as number;
    projectiles.update(0.75);
    const pitchLate = setPitch.mock.calls[setPitch.mock.calls.length - 1]![0] as number;
    expect(pitchLate).toBeLessThan(pitchEarly);
    expect(setPosition).toHaveBeenCalled();
    expect((projCtx.fx.smoke as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();

    // Confirm ProjectileVisuals populated the dedicated 3D bomb layers and ZERO shell/cone layers!
    const layers = (projectiles.visuals as unknown as {
      layers: Record<string, { count: number }>;
    }).layers;
    expect(layers.bombHeBody!.count).toBe(1);
    expect(layers.bombHeFins!.count).toBe(1);
    expect(layers.bombHeBand!.count).toBe(1);
    expect(layers.bombNapalmBody!.count).toBe(1);
    expect(layers.bombNapalmBand!.count).toBe(1);
    expect(layers.shell!.count).toBe(0);
    expect(layers.cone!.count).toBe(0);
    expect(layers.coneHot!.count).toBe(0);

    projectiles.clear();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('registers all responsive vehicle audio recipes & auto-retries dead loop handles with spin-up/down + gear shifts + VTOL cues', () => {
    for (const id of ['jet_turbine_whine_loop', 'veh_afterburner_ignite', 'veh_vtol_shift', 'veh_gear_shift']) {
      const entry = lookup(id);
      expect(entry, `audio catalog missing ${id}`).toBeDefined();
      expect(entry!.priority).toBeGreaterThanOrEqual(6);
    }

    const h = makeDriveHarness();
    // Simulate SoundBank still rendering on initial board (returns dead handle first, then live handle!)
    let callNum = 0;
    const liveStop = vi.fn();
    const liveSetPitch = vi.fn();
    const liveSetVolume = vi.fn();
    h.startLoop.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return { alive: false, setVolume: vi.fn(), setPitch: vi.fn(), setPosition: vi.fn(), stop: vi.fn() };
      }
      return { alive: true, setVolume: liveSetVolume, setPitch: liveSetPitch, setPosition: vi.fn(), stop: liveStop };
    });

    const moto = new DriveableVehicle(h.ctx, h.materials, h.seats, vi.fn(), 'moto', new THREE.Vector3(), 0);
    expect(moto.board(0)).toBe(true);
    // First startLoop returned dead handle; next update tick must automatically retry and acquire a live loop!
    h.held.add('forward');
    for (let i = 0; i < 45; i++) moto.update(0.05);
    expect(h.startLoop.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(liveSetPitch).toHaveBeenCalled();
    expect(liveSetVolume).toHaveBeenCalled();
    expect(moto.audioTelemetry.gear).toBeGreaterThanOrEqual(2);
    expect(h.audioPlay).toHaveBeenCalledWith('veh_gear_shift', expect.any(Object));

    // Exiting on ground triggers smooth audible spin-down rather than instant zero!
    moto.exit(false);
    expect(moto.audioTelemetry.running).toBe(true);
    for (let i = 0; i < 60; i++) moto.update(0.05);
    expect(moto.audioTelemetry.running).toBe(false);
    expect(liveStop).toHaveBeenCalled();
    moto.dispose();

    // Harrier VTOL -> Mach toggle fires dedicated nozzle swivel + afterburner ignition + 3 jet audio layers!
    h.audioPlay.mockClear();
    h.startLoop.mockClear();
    const harrier = new DriveableVehicle(h.ctx, h.materials, h.seats, vi.fn(), 'harrier', new THREE.Vector3(), 0);
    expect(harrier.board(0)).toBe(true);
    const loopIds = h.startLoop.mock.calls.map(c => c[0]);
    expect(loopIds).toContain('jet_engine_loop');
    expect(loopIds).toContain('jet_turbine_whine_loop');
    expect(loopIds).toContain('jet_afterburner_loop');
    h.justPressed.add('stim');
    harrier.update(0.05);
    h.justPressed.clear();
    expect(h.audioPlay).toHaveBeenCalledWith('veh_vtol_shift', expect.any(Object));
    expect(h.audioPlay).toHaveBeenCalledWith('veh_afterburner_ignite', expect.any(Object));
    harrier.dispose();
  });

  it('mounts articulated co-op ready visible riders on Quad/Moto/Jackal/Viper/Aircraft and hides only the local rider in 1P', () => {
    const h = makeDriveHarness();
    for (const id of ['quad', 'moto', 'jackal', 'viper', 'kestrel', 'valkyrie'] as const) {
      const rig = buildVehicleModel(id, h.materials);
      expect(rig.riders.length, `${id} should have 2 visible rider sockets`).toBe(2);
      expect(rig.riders.every(r => !r.root.visible)).toBe(true);
    }

    // Quad ATV: 0 riders parked -> 1 rider on solo board -> 2 riders when co-op teammate hops on rear seat!
    const quad = new DriveableVehicle(h.ctx, h.materials, h.seats, vi.fn(), 'quad', new THREE.Vector3(), 0);
    expect(quad.occupiedSeatCount).toBe(0);
    expect(quad.openSeatCount).toBe(2);

    expect(quad.board(0)).toBe(true);
    expect(quad.occupiedSeatCount).toBe(1);
    expect(quad.openSeatCount).toBe(1);
    expect(quad.model.riders.filter(r => r.root.visible).length).toBe(1);

    // Co-op teammate boards Seat 1 (rear pillion passenger): BOTH riders are visibly seated on the Quad!
    quad.setSeatOccupant(1, 'coop-p2', '#ffaa2b');
    expect(quad.occupiedSeatCount).toBe(2);
    expect(quad.openSeatCount).toBe(0);
    expect(quad.model.riders.filter(r => r.root.visible).length).toBe(2);

    // Toggle to 1P camera: hides ONLY the local driver mesh, NEVER the co-op passenger!
    h.justPressed.add('slide');
    quad.update(0.016);
    h.justPressed.clear();
    const driverRig = quad.model.riders.find(r => r.seatIndex === 0)!;
    const passengerRig = quad.model.riders.find(r => r.seatIndex === 1)!;
    expect(driverRig.root.visible).toBe(false);
    expect(passengerRig.root.visible).toBe(true);

    quad.exit(false);
    expect(driverRig.root.visible).toBe(false);
    expect(passengerRig.root.visible).toBe(true);
    quad.dispose();
  });

  it('upgrades all 10 vehicle models to PBR textured materials with valid box-projected UVs (no flat untextured solid)', () => {
    const mats = makeMaterials();
    for (const id of DRIVE_VEHICLE_ORDER) {
      const rig = buildVehicleModel(id, mats);
      expect(rig.meshes.length, `${id} should have meshes`).toBeGreaterThan(0);
      let pbrMeshCount = 0;
      for (const obj of rig.meshes) {
        const mesh = obj as THREE.Mesh;
        expect(mesh.material, `${id} should not use untextured flat ModelMaterials.solid`).not.toBe(mats.solid);
        if (mesh.material instanceof THREE.MeshStandardMaterial) {
          pbrMeshCount++;
          expect(mesh.geometry.getAttribute('uv'), `${id} PBR mesh must have UVs`).toBeDefined();
        }
      }
      expect(pbrMeshCount, `${id} should contain PBR textured meshes`).toBeGreaterThan(0);
    }
  });
});

