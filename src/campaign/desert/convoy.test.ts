import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { lookup } from '../../audio/catalog';
import type { Ctx, DamageInfo, PlayerDamage, SeatView } from '../../core/contracts';
import type { EnemyInstance, ExplosionSpec } from '../../core/gameplay';
import type { ExtraTarget } from '../../enemies/vehicles';
import { CARGO_PLANE, CONVOY_PATHS, DESERT_Z, SIDE_GATES } from '../../world/map/desert/plan';
import type { CampaignHud } from '../hud';
import type { MissionRunner } from '../runner';
import { DESERT_CONVOY_CONSTANTS, DesertConvoy, MK19, SplinePath } from './convoy';

interface FakeCollider {
  handle: number;
  translation: THREE.Vector3;
  setTranslation(t: { x: number; y: number; z: number }): void;
  setRotation(r: { x: number; y: number; z: number; w: number }): void;
}

interface MockEnemy {
  id: string;
  alive: boolean;
  hp: number;
  position: THREE.Vector3;
  center: THREE.Vector3;
}

function createMockEnv(opts?: {
  guest?: boolean;
  worldHitPoint?: THREE.Vector3 | null;
  worldHitCollider?: FakeCollider | null;
}) {
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
  const explosions: { pos: THREE.Vector3; radius: number; kind?: string }[] = [];
  const tracers: { from: THREE.Vector3; to: THREE.Vector3; kind: string }[] = [];
  const dustCalls: THREE.Vector3[] = [];
  const smokeCalls: THREE.Vector3[] = [];
  const gibBursts: THREE.Vector3[] = [];
  const bloodHits: THREE.Vector3[] = [];
  const bloodMists: THREE.Vector3[] = [];
  const explodeCalls: { pos: THREE.Vector3; spec: ExplosionSpec }[] = [];
  const blastCalls: { center: THREE.Vector3; radius: number; amount: number; source: string }[] = [];
  const damageColliderCalls: { collider: unknown; amount: number; source: string }[] = [];
  const ramCalls: { collider: unknown; ramClass: string; speed: number }[] = [];
  const progressionAwards: { points: number; label: string }[] = [];
  const emittedEvents: { event: string; payload: unknown }[] = [];
  const promptsShown: { text: string; key: string }[] = [];
  const mockEnemies: MockEnemy[] = [];
  const enemyDamages: { enemy: MockEnemy; info: DamageInfo }[] = [];
  let promptCleared = 0;
  let hintCleared = 0;

  let seat: SeatView | null = null;
  const setSeatCalls: (SeatView | null)[] = [];
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
    position: new THREE.Vector3(0, 0, DESERT_Z.approachStart),
    eye: new THREE.Vector3(0, 1.65, DESERT_Z.approachStart),
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
    get parked() {
      return parked;
    },
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
      setSeat(v: SeatView | null) {
        seat = v;
        setSeatCalls.push(v);
      },
      syncSeat: vi.fn(),
      setZoom(fov: number | null) {
        zoomFov = fov;
      },
      kick: vi.fn(),
      addTrauma: vi.fn(),
    },
    input: {
      isDown: (a: string) => downActions.has(a),
      pressed: (a: string) => pressedActions.has(a),
      released: () => false,
      labelFor: () => 'E',
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
      setHolstered(h: boolean) {
        holstered = h;
      },
    },
    combat: {
      explode(pos: THREE.Vector3, spec: ExplosionSpec) {
        explodeCalls.push({ pos: pos.clone(), spec: { ...spec } });
        for (const t of registeredExtraTargets) {
          t.blast(pos, spec);
        }
        for (const e of mockEnemies) {
          if (!e.alive) continue;
          const d = e.center.distanceTo(pos);
          if (d <= spec.radius) {
            const info: DamageInfo = {
              amount: spec.damage,
              type: 'explosive',
              source: spec.source,
              point: e.center.clone(),
              dir: e.center.clone().sub(pos).normalize(),
              force: 24,
              gib: true,
            };
            enemyDamages.push({ enemy: e, info });
            e.hp = Math.max(0, e.hp - spec.damage);
            if (e.hp <= 0) e.alive = false;
          }
        }
      },
    },
    world: {
      objects: {
        damageExplosive: vi.fn(),
        tryVehicleRam(collider: unknown, ramClass: string, speed: number) {
          ramCalls.push({ collider, ramClass, speed });
          return { hit: true, breached: true, speedRetain: 0.92 };
        },
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
      raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) {
        if (!worldHitPoint) return null;
        // Treat worldHitPoint as a vertical wall plane at z = worldHitPoint.z when firing toward it
        if (Math.abs(dir.z) > 1e-5) {
          const t = (worldHitPoint.z - origin.z) / dir.z;
          if (t >= 0 && t <= maxDist) {
            return {
              point: new THREE.Vector3(
                origin.x + dir.x * t,
                origin.y + dir.y * t,
                worldHitPoint.z,
              ),
              normal: new THREE.Vector3(0, 0, dir.z < 0 ? 1 : -1),
              distance: t,
              collider: worldHitCollider ?? undefined,
            };
          }
        }
        const dist = origin.distanceTo(worldHitPoint);
        if (dist <= maxDist) {
          return {
            point: worldHitPoint.clone(),
            normal: new THREE.Vector3(0, 0, 1),
            distance: dist,
            collider: worldHitCollider ?? undefined,
          };
        }
        return null;
      },
      addStaticBox(pos: THREE.Vector3) {
        const handle = nextColliderHandle++;
        liveColliders.add(handle);
        const col: FakeCollider = {
          handle,
          translation: pos.clone(),
          setTranslation(t) {
            col.translation.set(t.x, t.y, t.z);
          },
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
      get alive() {
        return mockEnemies as unknown as EnemyInstance[];
      },
      applyDamage(enemy: EnemyInstance, info: DamageInfo) {
        const me = enemy as unknown as MockEnemy;
        enemyDamages.push({ enemy: me, info });
        me.hp = Math.max(0, me.hp - info.amount);
        if (me.hp <= 0) me.alive = false;
        return { dealt: info.amount, killed: !me.alive, headshot: false, severed: [], blocked: false };
      },
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
      explosion: (pos: THREE.Vector3, eOpts: { radius: number; kind?: string }) => {
        explosions.push({ pos: pos.clone(), radius: eOpts.radius, kind: eOpts.kind });
      },
      sparks: vi.fn(),
      smoke: (pos: THREE.Vector3) => {
        smokeCalls.push(pos.clone());
      },
      dust: (pos: THREE.Vector3) => {
        dustCalls.push(pos.clone());
      },
      gibBurst: (pos: THREE.Vector3) => {
        gibBursts.push(pos.clone());
      },
      bloodHit: (pos: THREE.Vector3) => {
        bloodHits.push(pos.clone());
      },
      bloodMist: (pos: THREE.Vector3) => {
        bloodMists.push(pos.clone());
      },
      chips: vi.fn(),
      embers: vi.fn(),
    },
    audio: {
      play: (id: string) => {
        playedSounds.push(id);
      },
      startLoop: (id: string) => {
        startedLoops.push(id);
        let alive = true;
        return {
          get alive() {
            return alive;
          },
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
      feed: (text: string) => {
        feeds.push(text);
      },
      hitMarker: (kind: string) => {
        hitMarkers.push(kind);
      },
      follow: (_pos: THREE.Vector3, text: string) => {
        promptsShown.push({ text, key: 'E' });
        return () => {
          promptCleared++;
        };
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
    signal: (name: string) => {
      signals.push(name);
    },
  } as unknown as MissionRunner;

  const ui = {
    hint: (text: string) => {
      promptsShown.push({ text, key: 'E' });
    },
    clearHint: () => {
      hintCleared++;
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
    gibBursts,
    bloodHits,
    bloodMists,
    explodeCalls,
    blastCalls,
    damageColliderCalls,
    ramCalls,
    progressionAwards,
    emittedEvents,
    promptsShown,
    mockEnemies,
    enemyDamages,
    liveColliders,
    registeredExtraTargets,
    teleportCalls,
    playerDamageTaken,
    setSeatCalls,
    step,
    setWorldHit(pt: THREE.Vector3 | null, col: FakeCollider | null = null) {
      worldHitPoint = pt;
      worldHitCollider = col;
    },
    get seat() {
      return seat;
    },
    get zoomFov() {
      return zoomFov;
    },
    get holstered() {
      return holstered;
    },
    get parked() {
      return parked;
    },
    get unparkCalls() {
      return unparkCalls;
    },
    get promptCleared() {
      return promptCleared;
    },
    get hintCleared() {
      return hintCleared;
    },
  };
}

describe('SplinePath helper', () => {
  it('samples open and closed splines smoothly without NaN', () => {
    const open = new SplinePath(CONVOY_PATHS.approach, false);
    expect(open.length).toBeGreaterThan(120);
    const pStart = new THREE.Vector3();
    const tStart = new THREE.Vector3();
    open.sample(0, pStart, tStart);
    expect(pStart.z).toBeCloseTo(DESERT_Z.approachStart, 1);
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

    const exfil = new SplinePath(CONVOY_PATHS.exfil, false);
    expect(exfil.length).toBeGreaterThan(300);
    const exStart = new THREE.Vector3();
    const exEnd = new THREE.Vector3();
    exfil.sample(0, exStart, tStart);
    exfil.sample(exfil.length, exEnd, tStart);
    expect(exStart.z).toBeCloseTo(-204, 1);
    expect(exEnd.z).toBeCloseTo(168, 1);
  });
});

describe('DesertConvoy — 3-truck formation & Approach', () => {
  it('spawns 3 ally trucks in formation, mounts Mk 19 turret, drives Approach from z=222 to z=84 at ~15.2 m/s, and signals dr:approach_done', () => {
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
    expect(MK19.name).toBe('mk19-40mm');

    // Check 3-truck formation offsets around middle truck at z = 222
    const midPos = convoy.getTruckPosition(new THREE.Vector3());
    expect(midPos.z).toBeCloseTo(DESERT_Z.approachStart, 1);

    const lead = convoy.trucks.find(t => t.role === 'lead')!;
    const rear = convoy.trucks.find(t => t.role === 'rear')!;
    expect(lead.position.x).toBeLessThan(midPos.x - 5);
    expect(lead.position.z).toBeLessThan(midPos.z - 5);
    expect(rear.position.x).toBeGreaterThan(midPos.x + 5);
    expect(rear.position.z).toBeGreaterThan(midPos.z + 5);

    const initialWheelRot = convoy.trucks[1]!.wheels[0]!.rotation.x;

    // Advance along Approach spline (~155m at 15.2 m/s -> ~10.2s)
    env.step(convoy, 12.5);

    const endPos = convoy.getTruckPosition(new THREE.Vector3());
    expect(endPos.z).toBeLessThanOrEqual(86);
    expect(env.signals).toContain('dr:approach_done');
    expect(env.signals.filter(s => s === 'dr:approach_done')).toHaveLength(1);
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

    expect(env.tracers.some(t => t.kind === 'heavy')).toBe(true);
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

    const posSamples: THREE.Vector3[] = [];
    for (let i = 0; i < 9; i++) {
      env.step(convoy, 5);
      posSamples.push(convoy.getTruckPosition(new THREE.Vector3()));
    }

    expect(env.signals).toContain('dr:wall_loop_ready');
    expect(env.signals.filter(s => s === 'dr:wall_loop_ready')).toHaveLength(1);
    expect(convoy.wallLoopPasses).toBeGreaterThanOrEqual(1);
    expect(convoy.phase).toBe('wallLoop');
    expect(posSamples[7]!.distanceTo(posSamples[8]!)).toBeGreaterThan(2);

    convoy.clear();
  });

  it('signals dr:wall_loop_ready early when player pounds the outer wall with RMB 40mm AGL grenades (source: mgl) and LMB .50 HMG (source: jackal_hmg)', () => {
    const fakeWallCol: FakeCollider = {
      handle: 777,
      translation: new THREE.Vector3(0, 2, DESERT_Z.wallLine),
      setTranslation() {},
      setRotation() {},
    };
    const env = createMockEnv({
      worldHitPoint: new THREE.Vector3(0, 2.5, DESERT_Z.wallLine),
      worldHitCollider: fakeWallCol,
    });
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    convoy.startWallLoop();

    // Hold RMB (`aim` = 40mm AGL) + LMB (`fire` = .50 HMG) for 2.2s to hammer the wall plane at z=62
    env.downActions.add('aim');
    env.downActions.add('fire');
    env.step(convoy, 2.2);
    env.downActions.delete('aim');
    env.downActions.delete('fire');
    // Allow final in-flight grenades to reach the wall
    env.step(convoy, 0.5);

    expect(env.signals).toContain('dr:wall_loop_ready');
    expect(convoy.wallLoopHitScore).toBeGreaterThanOrEqual(DESERT_CONVOY_CONSTANTS.wallLoopReadyHits);
    expect(env.explodeCalls.length).toBeGreaterThan(0);
    expect(env.explodeCalls[0]!.spec.source).toBe('mgl');
    expect(env.explodeCalls[0]!.spec.kind).toBe('grenade');
    expect(env.explodeCalls[0]!.spec.damage).toBe(DESERT_CONVOY_CONSTANTS.turretDamage);
    expect(env.explodeCalls[0]!.spec.radius).toBe(DESERT_CONVOY_CONSTANTS.grenadeBlastRadius);
    expect(env.blastCalls.some(c => c.source === 'mgl' && c.amount === DESERT_CONVOY_CONSTANTS.grenadeStructDamage)).toBe(true);
    expect(env.damageColliderCalls.some(c => c.source === 'mgl')).toBe(true);
    expect(env.damageColliderCalls.some(c => c.source === 'jackal_hmg')).toBe(true);

    convoy.clear();
  });

  it('dismountAtGate parks trucks at z≈74, teleports player to (0,0,68) yaw 0, and cleanly releases all overrides', () => {
    const env = createMockEnv();
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    expect(env.zoomFov).toBe(DESERT_CONVOY_CONSTANTS.turretFov);

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

describe('DesertConvoy — Exfil Pickup, Quist Bed Tracking, Chase & Ending Cruise', () => {
  it('arriveForExfil(true) sweeps into forecourt (z=-206), shows zip-tied Quist, clears boarding hint on [E] -> dr:exfil_boarded', () => {
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
    const parkedPos = convoy.getTruckPosition(new THREE.Vector3());
    expect(parkedPos.z).toBeCloseTo(CARGO_PLANE.forecourtExfilPos[2], 0);
    expect(env.promptsShown.some(p => p.text.toUpperCase().includes('BOARD EXFIL TRUCK'))).toBe(true);

    // Press [E] (`interact`) to board
    const clearedHintsBefore = env.hintCleared;
    env.pressedActions.add('interact');
    env.step(convoy, 1 / 60);

    expect(convoy.isPlayerBoarded()).toBe(true);
    expect(env.signals).toContain('dr:exfil_boarded');
    expect(env.promptCleared).toBeGreaterThanOrEqual(1);
    expect(env.hintCleared).toBeGreaterThan(clearedHintsBefore);
    expect(env.seat).not.toBeNull();
    expect(env.holstered).toBe(true);

    convoy.clear();
  });

  it('arriveForExfil(false) hides Quist mesh and auto-boards player within 4.5m', () => {
    const env = createMockEnv();
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    convoy.dismountAtGate();

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

  it('setQuistCaptured toggles visibility and getQuistBedPosition transforms local bed coordinates across positions & yaws', () => {
    const env = createMockEnv();
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    expect(convoy.quistVisible).toBe(false);

    convoy.setQuistCaptured(true);
    expect(convoy.quistCaptured).toBe(true);
    expect(convoy.quistVisible).toBe(true);

    // Northbound (yaw = 0): world = truckPos + (lx, ly, lz)
    const pt = convoy.trucks.find(t => t.role === 'player')!;
    pt.position.set(10, 0, 140);
    pt.root.position.set(10, 0, 140);
    pt.yaw = 0;

    const [lx, ly, lz] = DESERT_CONVOY_CONSTANTS.quistBedLocal;
    const northPos = convoy.getQuistBedPosition(new THREE.Vector3());
    expect(northPos.x).toBeCloseTo(10 + lx, 3);
    expect(northPos.y).toBeCloseTo(ly, 3);
    expect(northPos.z).toBeCloseTo(140 + lz, 3);

    // Southbound (yaw = Math.PI): world = truckPos + (-lx, ly, -lz)
    pt.position.set(-4, 0, 155);
    pt.root.position.set(-4, 0, 155);
    pt.yaw = Math.PI;
    const southPos = convoy.getQuistBedPosition(new THREE.Vector3());
    expect(southPos.x).toBeCloseTo(-4 - lx, 3);
    expect(southPos.y).toBeCloseTo(ly, 3);
    expect(southPos.z).toBeCloseTo(155 - lz, 3);

    convoy.setQuistCaptured(false);
    expect(convoy.quistCaptured).toBe(false);
    expect(convoy.quistVisible).toBe(false);

    convoy.clear();
  });

  it('startExfilChase runs south along the eastern bypass road, signals dr:exfil_clear at z>=108, and caps cleanly at z<=185', () => {
    const env = createMockEnv();
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    convoy.dismountAtGate();
    convoy.startExfilChase(true);

    expect(convoy.phase).toBe('exfilChase');
    expect(convoy.isPlayerBoarded()).toBe(true);
    expect(convoy.quistVisible).toBe(true);

    let maxX = -Infinity;
    for (let i = 0; i < 20; i++) {
      env.step(convoy, 1.0);
      const p = convoy.getTruckPosition(new THREE.Vector3());
      if (p.x > maxX) maxX = p.x;
    }

    // Confirmed eastern bypass route sweep (x reaches ~+48..+50)
    expect(maxX).toBeGreaterThan(40);

    // Step another 4 seconds to reach past exfilClearZ (108)
    env.step(convoy, 4.0);
    const midRun = convoy.getTruckPosition(new THREE.Vector3());
    expect(midRun.z).toBeGreaterThanOrEqual(DESERT_CONVOY_CONSTANTS.exfilClearZ);
    expect(env.signals).toContain('dr:exfil_clear');
    expect(env.signals.filter(s => s === 'dr:exfil_clear')).toHaveLength(1);

    // Continue well past path end — truck stays smoothly capped at endingCruiseMaxZ (185)
    env.step(convoy, 15.0);
    const lateRun = convoy.getTruckPosition(new THREE.Vector3());
    expect(lateRun.z).toBeGreaterThanOrEqual(168);
    expect(lateRun.z).toBeLessThanOrEqual(DESERT_CONVOY_CONSTANTS.endingCruiseMaxZ + 0.05);

    convoy.clear();
  });

  it('enterEndingCruise unmounts turret without calling camera.setSeat(null) or unparking player, and cruises south capped at z<=185', () => {
    const env = createMockEnv();
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    convoy.spawnBanditWave('approach', 2);
    convoy.fireSingleShot();
    expect(convoy.bandits.length).toBe(2);
    expect(convoy.projectiles.length).toBe(1);

    // Simulate truck arriving near z = 120 during exfil before ending handoff
    const pt = convoy.trucks.find(t => t.role === 'player')!;
    pt.position.set(14, 0, 120);
    pt.yaw = Math.PI;

    const setSeatCountBefore = env.setSeatCalls.length;
    const unparkBefore = env.unparkCalls;
    const teleportsBefore = env.teleportCalls.length;

    convoy.enterEndingCruise();

    expect(convoy.phase).toBe('endingCruise');
    expect(convoy.isPlayerBoarded()).toBe(false);
    expect(env.player.interceptor).toBeNull();
    expect(convoy.bandits).toHaveLength(0);
    expect(convoy.projectiles).toHaveLength(0);

    // CRITICAL: ending cutscene owns the camera uninterruptedly — no setSeat(null), unpark, or teleport!
    expect(env.setSeatCalls.length).toBe(setSeatCountBefore);
    expect(env.seat).not.toBeNull();
    expect(env.unparkCalls).toBe(unparkBefore);
    expect(env.teleportCalls.length).toBe(teleportsBefore);

    // Cruise south smoothly from z = 120 -> capped at z <= 185, centering x -> 0
    env.step(convoy, 4.0);
    const midCruise = convoy.getTruckPosition(new THREE.Vector3());
    expect(midCruise.z).toBeGreaterThan(135);
    expect(Math.abs(midCruise.x)).toBeLessThan(5);

    env.step(convoy, 25.0);
    const endCruise = convoy.getTruckPosition(new THREE.Vector3());
    expect(endCruise.z).toBeLessThanOrEqual(DESERT_CONVOY_CONSTANTS.endingCruiseMaxZ + 0.05);
    expect(endCruise.z).toBeGreaterThanOrEqual(175);

    convoy.clear();
  });
});

describe('DesertConvoy — Jackal Combination .50-Cal HMG (LMB) + 40mm Smart-AGL (RMB)', () => {
  it('supports 360° yaw rotation, clamps pitch to [-25°, +45°], and fires 40mm AGL on RMB', () => {
    const env = createMockEnv();
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();

    const fullTurnMouseDx = (Math.PI * 2.2) / env.player.sensitivity;
    env.ctx.input.simulateLook(fullTurnMouseDx, 0);
    env.step(convoy, 1 / 60);
    expect(Number.isFinite(convoy.yaw)).toBe(true);
    expect(Math.abs(convoy.yaw)).toBeLessThanOrEqual(Math.PI + 1e-4);

    env.ctx.input.simulateLook(0, 10000);
    env.step(convoy, 1 / 60);
    expect(convoy.pitch).toBeCloseTo(DESERT_CONVOY_CONSTANTS.pitchMin, 4);

    env.ctx.input.simulateLook(0, -10000);
    env.step(convoy, 1 / 60);
    expect(convoy.pitch).toBeCloseTo(DESERT_CONVOY_CONSTANTS.pitchMax, 4);

    // RMB (`aim`) fires coaxial 40mm AGL grenades at ~2.8 rps
    env.downActions.add('aim');
    env.step(convoy, 1.0);
    env.downActions.delete('aim');
    const mglCount1s = env.playedSounds.filter(s => s === 'mgl_shot').length;
    expect(mglCount1s).toBeGreaterThanOrEqual(2);
    expect(mglCount1s).toBeLessThanOrEqual(4);
    expect(env.playedSounds).toContain('autocannon_fire');

    convoy.clear();
  });

  it('fires rapid .50-cal HMG on LMB (~10.5 rps, ~52 rounds to overheat), vents steam, locks out HMG while RMB AGL stays ready, then resumes', () => {
    const env = createMockEnv();
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    env.downActions.add('fire');

    // Fire 1.0s at 10.5 rps -> ~10-11 rounds
    env.step(convoy, 1.0);
    const hmgCount1s = env.playedSounds.filter(s => s === 'hmg_shot').length;
    expect(hmgCount1s).toBeGreaterThanOrEqual(9);
    expect(hmgCount1s).toBeLessThanOrEqual(12);
    expect(env.playedSounds).toContain('hmg_shot');

    // Keep firing until ~52-round heat triggers overheat (~4.5s more)
    env.step(convoy, 5.0);
    expect(convoy.heat.overheated).toBe(true);
    expect(env.playedSounds).toContain('steam_burst');

    // Clicking fire while overheated should NOT fire HMG and plays weapon_dry
    const shotsBeforeLockout = env.playedSounds.filter(s => s === 'hmg_shot').length;
    env.pressedActions.add('fire');
    env.step(convoy, 0.25);
    expect(env.playedSounds.filter(s => s === 'hmg_shot').length).toBe(shotsBeforeLockout);
    expect(env.playedSounds).toContain('weapon_dry');

    // Secondary RMB 40mm AGL can still fire independently while HMG is venting!
    env.downActions.add('aim');
    env.step(convoy, 0.1);
    env.downActions.delete('aim');
    expect(env.playedSounds).toContain('mgl_shot');

    // Release fire and vent back down to cool
    env.downActions.delete('fire');
    env.step(convoy, 3.0);
    expect(convoy.heat.overheated).toBe(false);
    expect(convoy.heat.value).toBeLessThan(0.15);

    // Firing resumes cleanly after vent
    env.downActions.add('fire');
    env.step(convoy, 0.25);
    expect(env.playedSounds.filter(s => s === 'hmg_shot').length).toBeGreaterThan(shotsBeforeLockout);

    convoy.clear();
  });

  it('simulates ballistic gravity drop on 40mm projectiles and detonates with 210 explosive damage (4.8m) + 95 structural damage (3.4m)', () => {
    const env = createMockEnv();
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    // Place a human Saltblood enemy 28m straight ahead of the launcher muzzle
    const muzzle = new THREE.Vector3(0, 2.5, 180);
    const enemy: MockEnemy = {
      id: 'saltblood_raider',
      alive: true,
      hp: 100,
      position: new THREE.Vector3(0, 0, 152),
      center: new THREE.Vector3(0, 1.8, 152),
    };
    env.mockEnemies.push(enemy);

    convoy.fireSingleShot(muzzle, new THREE.Vector3(0, 0, -1));
    expect(convoy.projectiles).toHaveLength(1);
    const p = convoy.projectiles[0]!;
    const startY = p.position.y;

    // Step 0.1s (~11m flown): projectile must have arced downward under gravity (-14 m/s²)
    env.step(convoy, 0.1);
    expect(convoy.projectiles).toHaveLength(1);
    expect(p.position.z).toBeLessThan(172);
    expect(p.position.y).toBeLessThan(startY - 0.05);
    expect(p.velocity.y).toBeLessThan(-1.0);

    // Step another 0.35s so it reaches and detonates on/near the enemy at z = 152
    env.step(convoy, 0.35);
    expect(convoy.projectiles).toHaveLength(0);
    expect(env.explodeCalls.length).toBeGreaterThanOrEqual(1);
    const blast = env.explodeCalls[0]!;
    expect(blast.spec.source).toBe('mgl');
    expect(blast.spec.kind).toBe('grenade');
    expect(blast.spec.damage).toBe(210);
    expect(blast.spec.radius).toBe(4.8);
    expect(blast.spec.worldObject).toBe(true);

    // Human enemy blasted & killed with gore FX
    expect(enemy.alive).toBe(false);
    expect(env.enemyDamages.length).toBeGreaterThanOrEqual(1);
    expect(env.playedSounds).toContain('grenade_explode');

    // Controlled structural destruction blast applied with source: 'mgl'
    expect(env.blastCalls.length).toBeGreaterThanOrEqual(1);
    expect(env.blastCalls[0]!.source).toBe('mgl');
    expect(env.blastCalls[0]!.radius).toBe(DESERT_CONVOY_CONSTANTS.grenadeStructRadius);
    expect(env.blastCalls[0]!.amount).toBe(DESERT_CONVOY_CONSTANTS.grenadeStructDamage);

    convoy.clear();
  });

  it('smashes weak destructible structures along the path when convoy Jackals are rolling', () => {
    const fakeShackCol: FakeCollider = {
      handle: 888,
      translation: new THREE.Vector3(0, 1, DESERT_Z.approachStart - 2),
      setTranslation() {},
      setRotation() {},
    };
    const env = createMockEnv({
      worldHitPoint: new THREE.Vector3(0, 1.05, DESERT_Z.approachStart - 2),
      worldHitCollider: fakeShackCol,
    });
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    env.step(convoy, 0.15);

    expect(env.ramCalls.length).toBeGreaterThan(0);
    expect(env.ramCalls[0]!.ramClass).toBe('medium');
    expect(env.ramCalls[0]!.speed).toBeGreaterThanOrEqual(12);

    convoy.clear();
  });
});

describe('DesertConvoy — Saltblood 2-Up Motos, 2-Up Quads, Colored Technicals & ExtraTarget Integration', () => {
  it('spawns 2-up motos (75 HP), 2-up quads (115 HP) & colored technicals (240 HP), silences rear pillion gunners when sniped, and blows them up', () => {
    const env = createMockEnv();
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    convoy.spawnBanditWave('approach', 4);
    expect(convoy.bandits).toHaveLength(4);

    const bikes = convoy.bandits.filter(b => b.kind === 'bike');
    const quads = convoy.bandits.filter(b => b.kind === 'quad');
    const trucks = convoy.bandits.filter(b => b.kind === 'truck');
    expect(bikes.length).toBeGreaterThanOrEqual(2);
    expect(quads.length).toBeGreaterThanOrEqual(1);
    expect(trucks.length).toBeGreaterThanOrEqual(1);
    expect(bikes[0]!.maxHp).toBe(DESERT_CONVOY_CONSTANTS.bikeMaxHp);
    expect(quads[0]!.maxHp).toBe(DESERT_CONVOY_CONSTANTS.quadMaxHp);
    expect(trucks[0]!.maxHp).toBe(DESERT_CONVOY_CONSTANTS.truckMaxHp);

    // 2-up motos and quads have BOTH driverRider and rear pillion gunnerRider visible & armed
    const targetQuad = quads[0]!;
    expect(targetQuad.driverRider).not.toBeNull();
    expect(targetQuad.gunnerRider).not.toBeNull();
    expect(targetQuad.gunnerAlive).toBe(true);
    expect(targetQuad.gunnerRider!.root.visible).toBe(true);

    // Sniping the rear pillion shooter on a quad kills & hides the gunner without destroying the quad yet!
    const quadGunnerZone = targetQuad.zones.find(z => z.kind === 'gunner')!;
    const quadDestroyedByGunnerHit = convoy.damageBanditZone(targetQuad, quadGunnerZone, 60, targetQuad.center, 'jackal_hmg');
    expect(quadDestroyedByGunnerHit).toBe(false);
    expect(targetQuad.alive).toBe(true);
    expect(targetQuad.gunnerAlive).toBe(false);
    expect(targetQuad.gunnerRider!.root.visible).toBe(false);
    expect(env.feeds).toContain('REAR GUNNER DOWN!');

    // Blowing up the quad destroys it cleanly and awards quadScore
    const quadDestroyed = convoy.damageBandit(targetQuad, 200, 'mgl');
    expect(quadDestroyed).toBe(true);
    expect(targetQuad.alive).toBe(false);
    expect(env.feeds).toContain('SALTBLOOD QUAD DESTROYED!');

    // Direct rider kill on a 2-up motorcycle triggers gore burst + bike flip
    const targetBike = bikes[0]!;
    expect(targetBike.driverRider).not.toBeNull();
    expect(targetBike.gunnerRider).not.toBeNull();
    const riderZone = targetBike.zones.find(z => z.kind === 'rider')!;
    const riderKilled = convoy.damageBanditZone(targetBike, riderZone, 125, targetBike.center, 'mgl');
    expect(riderKilled).toBe(true);
    expect(targetBike.alive).toBe(false);
    expect(env.gibBursts.length).toBeGreaterThanOrEqual(1);
    expect(env.bloodMists.length).toBeGreaterThanOrEqual(1);
    expect(env.playedSounds).toContain('gore_splat');

    // Spawn side-gate technicals from west and east gates — verify distinct Saltblood warband liveries!
    convoy.spawnSideGateTruck('west');
    convoy.spawnSideGateTruck('east');
    const westGate = SIDE_GATES.find(g => g.id === 'west')!;
    const eastGate = SIDE_GATES.find(g => g.id === 'east')!;
    const westTruck = convoy.bandits[convoy.bandits.length - 2]!;
    const eastTruck = convoy.bandits[convoy.bandits.length - 1]!;
    expect(westTruck.position.x).toBeCloseTo(westGate.x, 0);
    expect(eastTruck.position.x).toBeCloseTo(eastGate.x, 0);
    expect(westTruck.liveryColor).not.toBe(eastTruck.liveryColor);

    // Position a technical directly ahead of the player Jackal turret
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

    // Aim straight north toward truck and shred with LMB .50 HMG + RMB 40mm AGL
    const curMid = convoy.getTruckPosition(new THREE.Vector3());
    targetTruck.position.set(curMid.x, 0, curMid.z - 20);
    targetTruck.root.position.copy(targetTruck.position);
    convoy.setAim(0, -0.05);
    env.downActions.add('fire');
    env.downActions.add('aim');
    env.step(convoy, 1.4);
    env.downActions.delete('fire');
    env.downActions.delete('aim');
    env.step(convoy, 0.4);

    expect(targetTruck.alive).toBe(false);
    expect(convoy.banditVehiclesDestroyed).toBeGreaterThanOrEqual(3);
    expect(env.explosions.length).toBeGreaterThanOrEqual(3);
    expect(convoy.wrecks.length).toBeGreaterThanOrEqual(1);
    expect(env.progressionAwards.length).toBeGreaterThanOrEqual(3);
    expect(env.emittedEvents.some(e => e.event === 'vehicle:destroyed')).toBe(true);
    expect(env.feeds.length).toBeGreaterThanOrEqual(3);

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

    const handled = extraTarget.shot(
      truck.collider!,
      new THREE.Vector3(truck.position.x, 1.5, truck.position.z),
      100,
      'rifle',
    );
    expect(handled).toBe(true);
    expect(truck.hp).toBeLessThan(truck.maxHp);

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
  it('clear() and reset() release all overrides, colliders, projectiles, loops, ExtraTargets, and scene roots cleanly', () => {
    const env = createMockEnv();
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    convoy.startApproach();
    convoy.spawnBanditWave('approach', 3);
    convoy.fireSingleShot();
    env.downActions.add('aim');
    env.step(convoy, 0.05);

    expect(env.liveColliders.size).toBe(3);
    expect(env.registeredExtraTargets.size).toBe(1);
    expect(convoy.projectiles.length).toBeGreaterThanOrEqual(1);

    convoy.reset();

    expect(convoy.phase).toBe('idle');
    expect(convoy.isPlayerBoarded()).toBe(false);
    expect(convoy.bandits).toHaveLength(0);
    expect(convoy.wrecks).toHaveLength(0);
    expect(convoy.projectiles).toHaveLength(0);
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
      worldHitPoint: new THREE.Vector3(0, 2, DESERT_Z.wallLine),
    });
    const convoy = new DesertConvoy(env.ctx, env.runner, env.ui);

    // Exercise every major Mk 19, gore, bandit, exfil & endingCruise code path
    convoy.startApproach();
    convoy.spawnBanditWave('approach', 4);
    env.downActions.add('aim');
    env.downActions.add('fire');
    env.step(convoy, 7.5); // fires 40mm grenades, detonates on wall/ground, overheats
    env.pressedActions.add('fire');
    env.step(convoy, 0.1); // dry click
    env.downActions.delete('fire');
    env.downActions.delete('aim');

    // Kill a rider directly to trigger rider gore_splat + gib_rain
    const bike = convoy.bandits.find(b => b.kind === 'bike');
    if (bike) {
      const rider = bike.zones.find(z => z.kind === 'rider')!;
      convoy.damageBanditZone(bike, rider, 200, bike.center, 'mgl');
    }

    // Destroy remaining bandits via blast to trigger explosion & wreck audio
    const extra = [...env.registeredExtraTargets][0]!;
    for (const b of [...convoy.bandits]) {
      extra.blast(b.position.clone(), {
        radius: 12,
        damage: 500,
        kind: 'barrel',
        source: 'mgl',
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
    convoy.enterEndingCruise();
    env.step(convoy, 1.0);
    convoy.clear();

    const allIds = new Set([...env.playedSounds, ...env.startedLoops]);
    expect(allIds.size).toBeGreaterThan(0);
    expect(allIds.has('mgl_shot')).toBe(true);
    expect(allIds.has('grenade_explode')).toBe(true);
    expect(allIds.has('gore_splat')).toBe(true);
    for (const id of allIds) {
      expect(lookup(id), `Audio catalog missing sound ID "${id}"`).toBeDefined();
    }
  });
});
