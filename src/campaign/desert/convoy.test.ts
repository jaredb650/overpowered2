import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { lookup } from '../../audio/catalog';
import type { Ctx, PlayerDamage, SeatView } from '../../core/contracts';
import type { ShotSpec } from '../../core/gameplay';
import type { ExtraTarget } from '../../enemies/vehicles';
import { CARGO_PLANE, CONVOY_PATHS, SIDE_GATES } from '../../world/map/desert/plan';
import type { CampaignHud } from '../hud';
import type { MissionRunner } from '../runner';
import { DESERT_CONVOY_CONSTANTS, DesertConvoy, SplinePath } from './convoy';

interface FakeCollider {
  handle: number;
  translation: THREE.Vector3;
  setTranslation(t: { x: number; y: number; z: number }): void;
  setRotation(r: { x: number; y: number; z: number; w: number }): void;
}

function createMockEnv(opts?: { guest?: boolean; worldHitPoint?: THREE.Vector3 | null; worldHitCollider?: FakeCollider | null }) {
  const scene = new THREE.Scene();
  const downActions = new Set<string>();
  const pressedActions = new Set<string>();
  let lookX = 0;
  let lookY = 0;
  const frameLook = { x: 0, y: 0 };

  const signals: string[] = [];
  const playedSounds: string[] = [];
  const startedLoops: string[] = [];
  const stoppedLoops: string[] = [];
  const feeds: string[] = [];
  const hitMarkers: string[] = [];
  const explosions: { pos: THREE.Vector3; radius: number }[] = [];
  const tracers: { from: THREE.Vector3; to: THREE.Vector3; kind: string }[] = [];
  const dustCalls: THREE.Vector3[] = [];
  const smokeCalls: THREE.Vector3[] = [];
  const fireRayCalls: { origin: THREE.Vector3; dir: THREE.Vector3; spec: ShotSpec }[] = [];
  const blastCalls: { center: THREE.Vector3; radius: number; amount: number; source: string }[] = [];
  const damageColliderCalls: { collider: unknown; amount: number; source: string }[] = [];
  const progressionAwards: { points: number; label: string }[] = [];
  const emittedEvents: { event: string; payload: unknown }[] = [];
  const promptsShown: { text: string; key: string }[] = [];
  let promptCleared = 0;

  let seat: SeatView | null = null;
  let zoomFov: number | null = null;
  let holstered = false;
  let parked = false;
  let parkedExposed = false;
  let unparkCalls = 0;
  const teleportCalls: { pos: THREE.Vector3; yaw: number }[] = [];
  let playerHealth = 100;
  const playerDamageTaken: PlayerDamage[] = [];

  let nextColliderHandle = 100;
  const liveColliders = new Set<number>();
  const registeredExtraTargets = new Set<ExtraTarget>();

  const player = {
    position: new THREE.Vector3(0, 0, 208),
    eye: new THREE.Vector3(0, 1.65, 208),
    velocity: new THREE.Vector3(),
    forward: new THREE.Vector3(0, 0, -1),
    yaw: 0,
    pitch: 0,
    health: 100,
    maxHealth: 100,
    armor: 0,
    alive: true,
    sensitivity: 0.0025,
    invertY: false,
    lookScale: 1,
    get parked() { return parked; },
    interceptor: null as ((d: PlayerDamage) => boolean) | null,
    park(feet: THREE.Vector3, exposed = false) {
      parked = true;
      parkedExposed = exposed;
      player.position.copy(feet);
    },
    unpark(_grace: number) {
      parked = false;
      parkedExposed = false;
      unparkCalls++;
    },
    carry(feet: THREE.Vector3) {
      if (parked) player.position.copy(feet);
    },
    teleport(pos: THREE.Vector3, yaw?: number) {
      player.position.copy(pos);
      if (yaw !== undefined) player.yaw = yaw;
      teleportCalls.push({ pos: pos.clone(), yaw: yaw ?? 0 });
    },
    takeDamage(dmg: PlayerDamage) {
      if (parked && !parkedExposed) return;
      if (player.interceptor?.(dmg)) return;
      playerDamageTaken.push(dmg);
      playerHealth = Math.max(0, playerHealth - dmg.amount);
      player.health = playerHealth;
      if (playerHealth <= 0) player.alive = false;
    },
  };

  let worldHitPoint: THREE.Vector3 | null = opts?.worldHitPoint ?? null;
  let worldHitCollider: FakeCollider | null = opts?.worldHitCollider ?? null;

  const ctx = {
    render: {
      scene,
      materials: {
        patch: <T extends THREE.MeshStandardMaterial>(m: T) => m,
      },
      lights: {
        flash: vi.fn(),
      },
      post: {
        flash: vi.fn(),
        damageDirection: vi.fn(),
      },
    },
    camera: {
      setSeat(v: SeatView | null) { seat = v; },
      syncSeat: vi.fn(),
      setZoom(fov: number | null) { zoomFov = fov; },
      kick: vi.fn(),
      addTrauma: vi.fn(),
    },
    input: {
      isDown: (a: string) => downActions.has(a),
      pressed: (a: string) => pressedActions.has(a),
      released: () => false,
      frameLook,
      consumeLook() {
        const out = { x: lookX, y: lookY };
        frameLook.x = lookX;
        frameLook.y = lookY;
        lookX = 0;
        lookY = 0;
        return out;
      },
      simulateLook(dx: number, dy: number) {
        lookX += dx;
        lookY += dy;
      },
    },
    player,
    weapons: {
      setHolstered(h: boolean) { holstered = h; },
    },
    combat: {
      fireRay(origin: THREE.Vector3, dir: THREE.Vector3, spec: ShotSpec) {
        fireRayCalls.push({ origin: origin.clone(), dir: dir.clone(), spec: { ...spec } });
        const wh = worldHitPoint
          ? { point: worldHitPoint.clone(), normal: new THREE.Vector3(0, 0, 1), collider: worldHitCollider ?? undefined }
          : null;
        const dist = wh ? origin.distanceTo(wh.point) : (spec.maxDistance ?? 280);
        const end = wh ? wh.point.clone() : origin.clone().addScaledVector(dir, dist);
        return {
          end,
          distance: dist,
          worldHit: wh,
          hits: 0,
        };
      },
    },
    world: {
      objects: {
        destruction: {
          blast(center: THREE.Vector3, radius: number, amount: number, source: string) {
            blastCalls.push({ center: center.clone(), radius, amount, source });
          },
          damageCollider(collider: unknown, amount: number, source: string) {
            damageColliderCalls.push({ collider, amount, source });
            return true;
          },
        },
      },
    },
    physics: {
      raycast(origin: THREE.Vector3) {
        if (!worldHitPoint) return null;
        return {
          point: worldHitPoint.clone(),
          normal: new THREE.Vector3(0, 0, 1),
          distance: origin.distanceTo(worldHitPoint),
          collider: worldHitCollider ?? undefined,
        };
      },
      addStaticBox(pos: THREE.Vector3) {
        const handle = nextColliderHandle++;
        liveColliders.add(handle);
        const col: FakeCollider = {
          handle,
          translation: pos.clone(),
          setTranslation(t) { col.translation.set(t.x, t.y, t.z); },
          setRotation() {},
        };
        return col;
      },
      world: {
        removeCollider(col: FakeCollider) {
          liveColliders.delete(col.handle);
        },
      },
    },
    enemies: {
      vehicles: {
        addExtra(t: ExtraTarget) {
          registeredExtraTargets.add(t);
        },
        removeExtra(t: ExtraTarget) {
          registeredExtraTargets.delete(t);
        },
      },
    },
    fx: {
      muzzleFlash: vi.fn(),
      tracer: (from: THREE.Vector3, to: THREE.Vector3, kind: string) => {
        tracers.push({ from: from.clone(), to: to.clone(), kind });
      },
      shellCasing: vi.fn(),
      explosion: (pos: THREE.Vector3, eOpts: { radius: number }) => {
        explosions.push({ pos: pos.clone(), radius: eOpts.radius });
      },
      sparks: vi.fn(),
      smoke: (pos: THREE.Vector3) => { smokeCalls.push(pos.clone()); },
      dust: (pos: THREE.Vector3) => { dustCalls.push(pos.clone()); },
      chips: vi.fn(),
      embers: vi.fn(),
    },
    audio: {
      play: (id: string) => { playedSounds.push(id); },
      startLoop: (id: string) => {
        startedLoops.push(id);
        let alive = true;
        return {
          get alive() { return alive; },
          setVolume: vi.fn(),
          setPitch: vi.fn(),
          setPosition: vi.fn(),
          stop: () => {
            if (!alive) return;
            alive = false;
            stoppedLoops.push(id);
          },
        };
      },
    },
    hud: {
      feed: (text: string) => { feeds.push(text); },
      hitMarker: (kind: string) => { hitMarkers.push(kind); },
      follow: (_pos: THREE.Vector3, text: string) => {
        promptsShown.push({ text, key: 'E' });
        return () => { promptCleared++; };
      },
    },
    progression: {
      award: (points: number, label: string) => {
        progressionAwards.push({ points, label });
      },
    },
    events: {
      emit: (event: string, payload: unknown) => {
        emittedEvents.push({ event, payload });
      },
    },
    coop: opts?.guest ? { world: {}, hosting: false } : undefined,
  } as unknown as Ctx;

  const runner = {
    signal: (name: string) => { signals.push(name); },
  } as unknown as MissionRunner;

  const ui = {
    hint: (text: string) => {
      promptsShown.push({ text, key: 'E' });
    },
    clearHint: () => {
      promptCleared++;
    },
  } as unknown as CampaignHud;

  const step = (convoy: DesertConvoy, seconds: number, dt = 1 / 60) => {
    const steps = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < steps; i++) {
      convoy.update(dt);
      pressedActions.clear();
    }
  };

  return {
    ctx,
    runner,
    ui,
    scene,
    player,
    downActions,
    pressedActions,
    signals,
    playedSounds,
    startedLoops,
    stoppedLoops,
    feeds,
    hitMarkers,
    explosions,
    tracers,
    dustCalls,
    smokeCalls,
    fireRayCalls,
    blastCalls,
    damageColliderCalls,
    progressionAwards,
    emittedEvents,
    promptsShown,
    liveColliders,
    registeredExtraTargets,
    teleportCalls,
    playerDamageTaken,
    step,
    setWorldHit(pt: THREE.Vector3 | null, col: FakeCollider | null = null) {
      worldHitPoint = pt;
      worldHitCollider = col;
    },
    get seat() { return seat; },
    get zoomFov() { return zoomFov; },
    get holstered() { return holstered; },
    get parked() { return parked; },
    get unparkCalls() { return unparkCalls; },
    get promptCleared() { return promptCleared; },
  };
}

describe('SplinePath helper', () => {
  it('samples open and closed splines smoothly without NaN', () => {
    const open = new SplinePath(CONVOY_PATHS.approach, false);
    expect(open.length).toBeGreaterThan(100);
    const pStart = new THREE.Vector3();
    const tStart = new THREE.Vector3();
    open.sample(0, pStart, tStart);
    expect(pStart.z).toBeCloseTo(208, 1);
    expect(tStart.z).toBeLessThan(-0.5);

    const pEnd = new THREE.Vector3();
    open.sample(open.length + 50, pEnd, tStart);
    expect(pEnd.z).toBeCloseTo(84, 1);

    const closed = new SplinePath(CONVOY_PATHS.wallLoop, true);
    expect(closed.length).toBeGreaterThan(80);
    const p0 = new THREE.Vector3();
    const pWrap = new THREE.Vector3();
    closed.sample(0, p0, tStart);
    closed.sample(closed.length, pWrap, tStart);
    expect(p0.distanceTo(pWrap)).toBeLessThan(0.05);
  });
});

describe('DesertConvoy — 3-truck formation & Approach', () => {
  it('spawns 3 ally trucks in formation, mounts turret, drives Approach from z=208 to z=84, and signals dr:approach_done', () => {
    const env = createMockEnv();
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();

    expect(convoy.phase).toBe('approach');
    expect(convoy.isPlayerBoarded()).toBe(true);
    expect(convoy.trucks).toHaveLength(3);
    expect(env.seat).not.toBeNull();
    expect(env.holstered).toBe(true);
    expect(env.parked).toBe(true);
    expect(env.player.interceptor).not.toBeNull();
    expect(env.startedLoops).toContain('truck_engine_loop');
    expect(convoy.quistVisible).toBe(false);

    // Check 3-truck formation offsets around middle truck
    const midPos = convoy.getTruckPosition(new THREE.Vector3());
    expect(midPos.z).toBeCloseTo(208, 1);

    const lead = convoy.trucks.find((t) => t.role === 'lead')!;
    const rear = convoy.trucks.find((t) => t.role === 'rear')!;
    expect(lead.position.x).toBeLessThan(midPos.x - 5);
    expect(lead.position.z).toBeLessThan(midPos.z - 5);
    expect(rear.position.x).toBeGreaterThan(midPos.x + 5);
    expect(rear.position.z).toBeGreaterThan(midPos.z + 5);

    const initialWheelRot = convoy.trucks[1]!.wheels[0]!.rotation.x;

    // Advance along Approach spline (~124m at 11 m/s -> ~12s)
    env.step(convoy, 14);

    const endPos = convoy.getTruckPosition(new THREE.Vector3());
    expect(endPos.z).toBeLessThanOrEqual(86);
    expect(env.signals).toContain('dr:approach_done');
    expect(env.signals.filter((s) => s === 'dr:approach_done')).toHaveLength(1);
    expect(convoy.trucks[1]!.wheels[0]!.rotation.x).not.toBe(initialWheelRot);
    expect(env.dustCalls.length).toBeGreaterThan(0);

    convoy.clear();
  });

  it('ally flank gunners fire tracers at bandits without kill-stealing', () => {
    const env = createMockEnv();
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    convoy.spawnBanditWave('approach', 2);
    expect(convoy.bandits.length).toBe(2);

    // Drop bandit HP near death — ally gunners should chip but never steal the final kill
    const target = convoy.bandits[0]!;
    target.hp = 8;
    const mid = convoy.getTruckPosition(new THREE.Vector3());
    target.position.set(mid.x - 18, 0, mid.z - 12);

    env.step(convoy, 5);

    expect(env.tracers.some((t) => t.kind === 'heavy')).toBe(true);
    // Bandit must NOT be killed by ally fire alone (min floor > 0)
    expect(target.alive).toBe(true);
    expect(target.hp).toBeGreaterThanOrEqual(1);
    expect(convoy.banditVehiclesDestroyed).toBe(0);

    convoy.clear();
  });
});

describe('DesertConvoy — WallLoop & Gate Dismount', () => {
  it('loops smoothly along wallLoop indefinitely until dismountAtGate and signals dr:wall_loop_ready after first pass', () => {
    const env = createMockEnv();
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    convoy.startWallLoop();

    expect(convoy.phase).toBe('wallLoop');
    expect(convoy.isPlayerBoarded()).toBe(true);

    // Loop takes ~125-150m at 6.5 m/s -> ~25s per pass. Run 45s to prove continuous looping.
    const posSamples: THREE.Vector3[] = [];
    for (let i = 0; i < 9; i++) {
      env.step(convoy, 5);
      posSamples.push(convoy.getTruckPosition(new THREE.Vector3()));
    }

    expect(env.signals).toContain('dr:wall_loop_ready');
    expect(env.signals.filter((s) => s === 'dr:wall_loop_ready')).toHaveLength(1);
    expect(convoy.wallLoopPasses).toBeGreaterThanOrEqual(1);
    expect(convoy.phase).toBe('wallLoop');
    // Confirm the convoy kept moving across late samples (didn't stall)
    expect(posSamples[7]!.distanceTo(posSamples[8]!)).toBeGreaterThan(2);

    convoy.clear();
  });

  it('signals dr:wall_loop_ready early when player shreds wall panels during wallLoop', () => {
    const fakeWallCol: FakeCollider = {
      handle: 777,
      translation: new THREE.Vector3(0, 2, 62),
      setTranslation() {},
      setRotation() {},
    };
    const env = createMockEnv({
      worldHitPoint: new THREE.Vector3(0, 2.5, 62),
      worldHitCollider: fakeWallCol,
    });
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    convoy.startWallLoop();

    // Hold fire for 2 seconds -> ~22 shots hitting wall panels (> 12 threshold)
    env.downActions.add('fire');
    env.step(convoy, 2.0);
    env.downActions.delete('fire');

    expect(env.signals).toContain('dr:wall_loop_ready');
    expect(convoy.wallLoopHitScore).toBeGreaterThanOrEqual(DESERT_CONVOY_CONSTANTS.wallLoopReadyHits);
    expect(env.blastCalls.length).toBeGreaterThan(0);
    expect(env.blastCalls[0]!.source).toBe('emplacement');
    expect(env.fireRayCalls.length).toBeGreaterThan(0);
    expect(env.fireRayCalls[0]!.spec.source).toBe('emplacement');

    convoy.clear();
  });

  it('dismountAtGate parks trucks at z≈74, teleports player to (0,0,68) yaw 0, and cleanly releases all overrides', () => {
    const env = createMockEnv();
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    // Zoom in first to confirm zoom gets cleaned up too
    env.downActions.add('aim');
    env.step(convoy, 0.1);
    expect(env.zoomFov).toBe(DESERT_CONVOY_CONSTANTS.turretZoomFov);

    convoy.dismountAtGate();

    expect(convoy.phase).toBe('parkedGate');
    expect(convoy.isPlayerBoarded()).toBe(false);
    expect(env.seat).toBeNull();
    expect(env.zoomFov).toBeNull();
    expect(env.holstered).toBe(false);
    expect(env.parked).toBe(false);
    expect(env.player.interceptor).toBeNull();
    expect(env.unparkCalls).toBeGreaterThanOrEqual(1);
    expect(env.stoppedLoops).toContain('truck_engine_loop');

    const truckPos = convoy.getTruckPosition(new THREE.Vector3());
    expect(truckPos.z).toBeCloseTo(DESERT_CONVOY_CONSTANTS.gateParkZ, 1);

    expect(env.teleportCalls.length).toBeGreaterThanOrEqual(1);
    const lastTp = env.teleportCalls[env.teleportCalls.length - 1]!;
    expect(lastTp.pos.x).toBeCloseTo(0, 2);
    expect(lastTp.pos.y).toBeCloseTo(0, 2);
    expect(lastTp.pos.z).toBeCloseTo(68, 2);
    expect(lastTp.yaw).toBeCloseTo(0, 4);

    convoy.clear();
  });
});

describe('DesertConvoy — Section 6 Exfil Pickup, Quist Toggle & Chase', () => {
  it('arriveForExfil(true) shows zip-tied Quist mesh and boards via [E] prompt -> dr:exfil_boarded', () => {
    const env = createMockEnv();
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    convoy.dismountAtGate();

    // Place player 6.5m away from forecourt exfil point (inside prompt radius 8.5m, outside auto-board 4.5m)
    env.player.position.set(
      CARGO_PLANE.forecourtExfilPos[0] + 6.5,
      0,
      CARGO_PLANE.forecourtExfilPos[2],
    );

    convoy.arriveForExfil(true);
    expect(convoy.quistCaptured).toBe(true);
    expect(convoy.quistVisible).toBe(true);

    // Let trucks roll into the forecourt (~1.6s)
    env.step(convoy, 2.2);
    expect(convoy.phase).toBe('exfilWaiting');
    expect(convoy.isPlayerBoarded()).toBe(false);
    expect(env.promptsShown.some((p) => p.text.toUpperCase().includes('BOARD EXFIL TRUCK'))).toBe(true);

    // Press [E] (`interact`) to board
    env.pressedActions.add('interact');
    env.step(convoy, 1 / 60);

    expect(convoy.isPlayerBoarded()).toBe(true);
    expect(env.signals).toContain('dr:exfil_boarded');
    expect(env.seat).not.toBeNull();
    expect(env.holstered).toBe(true);

    convoy.clear();
  });

  it('arriveForExfil(false) hides Quist mesh and auto-boards player within 4.5m', () => {
    const env = createMockEnv();
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    convoy.dismountAtGate();

    // Place player 3.0m away from forecourt exfil point (within 4.5m auto-board)
    env.player.position.set(
      CARGO_PLANE.forecourtExfilPos[0] + 3.0,
      0,
      CARGO_PLANE.forecourtExfilPos[2],
    );

    convoy.arriveForExfil(false);
    expect(convoy.quistCaptured).toBe(false);
    expect(convoy.quistVisible).toBe(false);

    env.step(convoy, 2.2);

    expect(convoy.isPlayerBoarded()).toBe(true);
    expect(env.signals).toContain('dr:exfil_boarded');

    convoy.clear();
  });

  it('startExfilChase rockets south, signals dr:exfil_clear at z>=125, and keeps rolling past z>=200', () => {
    const env = createMockEnv();
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    convoy.dismountAtGate();
    convoy.startExfilChase(true);

    expect(convoy.phase).toBe('exfilChase');
    expect(convoy.isPlayerBoarded()).toBe(true);
    expect(convoy.quistVisible).toBe(true);

    // Exfil spline goes from z=-70 to z=+206 (~280m at 15 m/s -> ~19s)
    env.step(convoy, 14.5);
    const midRun = convoy.getTruckPosition(new THREE.Vector3());
    expect(midRun.z).toBeGreaterThanOrEqual(DESERT_CONVOY_CONSTANTS.exfilClearZ);
    expect(env.signals).toContain('dr:exfil_clear');
    expect(env.signals.filter((s) => s === 'dr:exfil_clear')).toHaveLength(1);

    // Continue rolling south for the ending cutscene without stopping at z=125
    env.step(convoy, 6.5);
    const lateRun = convoy.getTruckPosition(new THREE.Vector3());
    expect(lateRun.z).toBeGreaterThan(midRun.z + 30);
    expect(lateRun.z).toBeGreaterThanOrEqual(200);

    convoy.clear();
  });
});

describe('DesertConvoy — Heavy .50 Cal Turret Controls, Heat & Destruction', () => {
  it('supports 360° yaw rotation, clamps pitch to [-25°, +45°], and toggles RMB zoom', () => {
    const env = createMockEnv();
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();

    // Rotate yaw beyond a full 360° turn without clamping
    const fullTurnMouseDx = (Math.PI * 2.2) / env.player.sensitivity;
    env.ctx.input.simulateLook(fullTurnMouseDx, 0);
    env.step(convoy, 1 / 60);
    expect(Number.isFinite(convoy.yaw)).toBe(true);
    expect(Math.abs(convoy.yaw)).toBeLessThanOrEqual(Math.PI + 1e-4);

    // Push pitch way down -> clamps at -25°
    env.ctx.input.simulateLook(0, 10000);
    env.step(convoy, 1 / 60);
    expect(convoy.pitch).toBeCloseTo(DESERT_CONVOY_CONSTANTS.pitchMin, 4);

    // Push pitch way up -> clamps at +45°
    env.ctx.input.simulateLook(0, -10000);
    env.step(convoy, 1 / 60);
    expect(convoy.pitch).toBeCloseTo(DESERT_CONVOY_CONSTANTS.pitchMax, 4);

    // RMB zoom on/off
    env.downActions.add('aim');
    env.step(convoy, 1 / 60);
    expect(convoy.zoomed).toBe(true);
    expect(env.zoomFov).toBe(DESERT_CONVOY_CONSTANTS.turretZoomFov);

    env.downActions.delete('aim');
    env.step(convoy, 1 / 60);
    expect(convoy.zoomed).toBe(false);
    expect(env.zoomFov).toBe(DESERT_CONVOY_CONSTANTS.turretFov);

    convoy.clear();
  });

  it('fires heavy emplacement rounds (55 dmg, ~11 rds/s), overheats with steam vent lockout, then cools back down', () => {
    const env = createMockEnv();
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    env.downActions.add('fire');

    // Fire 1 second -> ~11 shots
    env.step(convoy, 1.0);
    expect(env.fireRayCalls.length).toBeGreaterThanOrEqual(10);
    expect(env.fireRayCalls.length).toBeLessThanOrEqual(13);
    expect(env.fireRayCalls[0]!.spec.source).toBe('emplacement');
    expect(env.fireRayCalls[0]!.spec.damage).toBe(DESERT_CONVOY_CONSTANTS.turretDamage);
    expect(env.fireRayCalls[0]!.spec.penetrate).toBeGreaterThanOrEqual(1.2);
    expect(env.playedSounds).toContain('hmg_shot');

    // Keep firing until overheat triggers (~67 remaining rounds at 11 rds/s -> ~6.1s; vents in ~2.4s)
    env.step(convoy, 6.5);
    expect(convoy.heat.overheated).toBe(true);
    expect(env.playedSounds).toContain('steam_burst');

    // Clicking fire while overheated should NOT fire new rays and plays weapon_dry
    const raysBeforeLockout = env.fireRayCalls.length;
    env.pressedActions.add('fire');
    env.step(convoy, 0.25);
    expect(env.fireRayCalls.length).toBe(raysBeforeLockout);
    expect(env.playedSounds).toContain('weapon_dry');

    // Release fire and vent back down to cool
    env.downActions.delete('fire');
    env.step(convoy, 4.0);
    expect(convoy.heat.overheated).toBe(false);
    expect(convoy.heat.value).toBeLessThan(0.15);

    // Firing resumes cleanly after vent
    env.downActions.add('fire');
    env.step(convoy, 0.2);
    expect(env.fireRayCalls.length).toBeGreaterThan(raysBeforeLockout);

    convoy.clear();
  });
});

describe('DesertConvoy — Saltblood Bandit Vehicles & ExtraTarget Integration', () => {
  it('spawns dirt-bikes (75 HP) & technicals (240 HP), side-gate trucks, smokes <50% HP, and destroys via turret fire', () => {
    const env = createMockEnv();
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    convoy.spawnBanditWave('approach', 4);
    expect(convoy.bandits).toHaveLength(4);

    const bikes = convoy.bandits.filter((b) => b.kind === 'bike');
    const trucks = convoy.bandits.filter((b) => b.kind === 'truck');
    expect(bikes.length).toBeGreaterThanOrEqual(1);
    expect(trucks.length).toBeGreaterThanOrEqual(1);
    expect(bikes[0]!.maxHp).toBe(DESERT_CONVOY_CONSTANTS.bikeMaxHp);
    expect(trucks[0]!.maxHp).toBe(DESERT_CONVOY_CONSTANTS.truckMaxHp);

    // Spawn side-gate trucks from west and east gates
    convoy.spawnSideGateTruck('west');
    convoy.spawnSideGateTruck('east');
    const westGate = SIDE_GATES.find((g) => g.id === 'west')!;
    const eastGate = SIDE_GATES.find((g) => g.id === 'east')!;
    const westTruck = convoy.bandits[convoy.bandits.length - 2]!;
    const eastTruck = convoy.bandits[convoy.bandits.length - 1]!;
    expect(westTruck.position.x).toBeCloseTo(westGate.x, 0);
    expect(eastTruck.position.x).toBeCloseTo(eastGate.x, 0);

    // Position a technical directly ahead of the player turret line-of-fire
    const targetTruck = trucks[0]!;
    const mid = convoy.getTruckPosition(new THREE.Vector3());
    targetTruck.position.set(mid.x, 0, mid.z - 22);
    targetTruck.yaw = 0;
    targetTruck.root.position.copy(targetTruck.position);
    targetTruck.root.rotation.set(0, 0, 0);

    // Damage below 50% HP and verify heavy dark smoke emits
    targetTruck.hp = targetTruck.maxHp * 0.4;
    env.step(convoy, 0.4);
    expect(env.smokeCalls.length).toBeGreaterThan(0);

    // Aim turret straight north (yaw = 0, slight downward pitch toward truck at 22m) and open fire
    targetTruck.position.set(mid.x, 0, mid.z - 22);
    env.downActions.add('fire');
    env.step(convoy, 1.5);
    env.downActions.delete('fire');

    expect(targetTruck.alive).toBe(false);
    expect(convoy.banditVehiclesDestroyed).toBeGreaterThanOrEqual(1);
    expect(env.explosions.length).toBeGreaterThanOrEqual(1);
    expect(convoy.wrecks.length).toBeGreaterThanOrEqual(1);
    expect(env.progressionAwards.length).toBeGreaterThanOrEqual(1);
    expect(env.emittedEvents.some((e) => e.event === 'vehicle:destroyed')).toBe(true);
    expect(env.feeds.length).toBeGreaterThanOrEqual(1);

    // Step wrecks to verify tumbling physics & eventual expiry cleanup
    env.step(convoy, 5.0);
    expect(convoy.wrecks).toHaveLength(0);

    convoy.clear();
  });

  it('registers ExtraTarget so on-foot shots & blasts destroy bandits when dismounted', () => {
    const env = createMockEnv();
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    convoy.dismountAtGate();
    expect(env.registeredExtraTargets.size).toBe(1);
    const extraTarget = [...env.registeredExtraTargets][0]!;

    convoy.spawnSideGateTruck('west');
    const truck = convoy.bandits[0]!;
    expect(truck.collider).not.toBeNull();

    // Shoot collider via ExtraTarget.shot
    const handled = extraTarget.shot(
      truck.collider!,
      new THREE.Vector3(truck.position.x, 1.5, truck.position.z),
      100,
      'rifle',
    );
    expect(handled).toBe(true);
    expect(truck.hp).toBeLessThan(truck.maxHp);

    // Finish off with ExtraTarget.blast
    extraTarget.blast(truck.position.clone(), {
      radius: 8,
      damage: 220,
      kind: 'grenade',
      source: 'grenade',
      team: 'player',
    });
    expect(truck.alive).toBe(false);
    expect(convoy.banditVehiclesDestroyed).toBe(1);

    convoy.clear();
  });

  it('skips duplicate local progression awards on co-op guests', () => {
    const env = createMockEnv({ guest: true });
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    convoy.spawnBanditWave('approach', 1);
    const bandit = convoy.bandits[0]!;
    const extraTarget = [...env.registeredExtraTargets][0]!;

    extraTarget.blast(bandit.position.clone(), {
      radius: 12,
      damage: 500,
      kind: 'rocket',
      source: 'rocket',
      team: 'player',
    });

    expect(bandit.alive).toBe(false);
    expect(convoy.banditVehiclesDestroyed).toBe(1);
    expect(env.progressionAwards).toHaveLength(0);

    convoy.clear();
  });
});

describe('DesertConvoy — Cleanup, Reset & Real Audio Catalog Validation', () => {
  it('clear() and reset() release all overrides, colliders, loops, ExtraTargets, and scene roots cleanly', () => {
    const env = createMockEnv();
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    convoy.spawnBanditWave('approach', 3);
    env.downActions.add('aim');
    env.step(convoy, 0.25);

    expect(env.liveColliders.size).toBe(3);
    expect(env.registeredExtraTargets.size).toBe(1);

    convoy.reset();

    expect(convoy.phase).toBe('idle');
    expect(convoy.isPlayerBoarded()).toBe(false);
    expect(convoy.bandits).toHaveLength(0);
    expect(convoy.wrecks).toHaveLength(0);
    expect(convoy.banditVehiclesDestroyed).toBe(0);
    expect(env.liveColliders.size).toBe(0);
    expect(env.registeredExtraTargets.size).toBe(0);
    expect(env.seat).toBeNull();
    expect(env.zoomFov).toBeNull();
    expect(env.holstered).toBe(false);
    expect(env.parked).toBe(false);
    expect(env.player.interceptor).toBeNull();
    expect(env.stoppedLoops).toContain('truck_engine_loop');
  });

  it('only plays sound and loop IDs that exist in the real audio catalog', () => {
    const env = createMockEnv({
      worldHitPoint: new THREE.Vector3(0, 2, 62),
    });
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    // Exercise every major code path to collect all audio IDs
    convoy.startApproach();
    convoy.spawnBanditWave('approach', 4);
    env.downActions.add('aim');
    env.downActions.add('fire');
    env.step(convoy, 10.5); // fires, hits wall, overheats
    env.pressedActions.add('fire');
    env.step(convoy, 0.1); // dry click
    env.downActions.delete('fire');
    env.downActions.delete('aim');

    // Destroy all bandits via blast to trigger explosion & wreck audio
    const extra = [...env.registeredExtraTargets][0]!;
    for (const b of [...convoy.bandits]) {
      extra.blast(b.position.clone(), {
        radius: 12,
        damage: 500,
        kind: 'barrel',
        source: 'emplacement',
        team: 'player',
      });
    }
    env.step(convoy, 2.0);

    convoy.startWallLoop();
    convoy.dismountAtGate();
    env.player.position.set(CARGO_PLANE.forecourtExfilPos[0], 0, CARGO_PLANE.forecourtExfilPos[2]);
    convoy.arriveForExfil(true);
    env.step(convoy, 2.2);
    convoy.startExfilChase(true);
    env.step(convoy, 2.0);
    convoy.clear();

    const allIds = new Set([...env.playedSounds, ...env.startedLoops]);
    expect(allIds.size).toBeGreaterThan(0);
    for (const id of allIds) {
      expect(lookup(id), `Audio catalog missing sound ID "${id}"`).toBeDefined();
    }
  });
});
