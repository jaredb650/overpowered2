import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CG, type Ctx, type GameEvents } from '../../core/contracts';
import { EventBus } from '../../core/events';
import { Physics } from '../../physics/Physics';
import { HARPOON } from '../../weapons/harpoon';
import type { ExtraTarget } from '../../enemies/vehicles';
import {
  ZIPLINE_DEFAULTS,
  ZiplineManager,
  sampleZipline,
  stepZiplineRide,
} from './zipline';
import { ELEVATOR_DEFAULTS, ServiceElevator, type ElevatorState } from './elevator';
import {
  GRAPPLE_MARK_DEFAULTS,
  GrappleMarkManager,
  evaluateGrappleAnchor,
} from './grappleMarks';
import { CIVILIAN_DEFAULTS, CivilianCrowd, MAX_CIVILIANS } from './civilians';

interface MockInput {
  down: Set<string>;
  justPressed: Set<string>;
  isDown(action: string): boolean;
  pressed(action: string): boolean;
  labelFor(action: string): string;
}

interface MockTestEnv {
  ctx: Ctx;
  events: EventBus<GameEvents>;
  input: MockInput;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  launchCalls: THREE.Vector3[];
  explosions: GameEvents['world:explosion'][];
  hudFollowCalls: { label: string; removed: boolean }[];
  extras: Set<ExtraTarget>;
  audioPlayed: string[];
  traumaAdded: number[];
}

function makeTestEnv(physics?: Physics): MockTestEnv {
  const events = new EventBus<GameEvents>();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
  camera.position.set(0, 2, 0);
  camera.lookAt(0, 2, -10);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();

  const launchCalls: THREE.Vector3[] = [];
  const explosions: GameEvents['world:explosion'][] = [];
  const hudFollowCalls: { label: string; removed: boolean }[] = [];
  const extras = new Set<ExtraTarget>();
  const audioPlayed: string[] = [];
  const traumaAdded: number[] = [];

  events.on('world:explosion', ev => explosions.push(ev));

  const input: MockInput = {
    down: new Set<string>(),
    justPressed: new Set<string>(),
    isDown(action: string) {
      return this.down.has(action);
    },
    pressed(action: string) {
      return this.justPressed.has(action);
    },
    labelFor(action: string) {
      return action === 'interact' ? 'E' : action.toUpperCase();
    },
  };

  const player = {
    position: new THREE.Vector3(0, 0, 0),
    eye: new THREE.Vector3(0, 1.7, 0),
    velocity: new THREE.Vector3(0, 0, 0),
    forward: new THREE.Vector3(0, 0, -1),
    yaw: 0,
    pitch: 0,
    health: 100,
    maxHealth: 100,
    armor: 0,
    grounded: true,
    sliding: false,
    wallRunning: false,
    dashing: false,
    alive: true,
    parked: false,
    interceptor: null,
    teleport(pos: THREE.Vector3, yaw?: number) {
      this.position.copy(pos);
      this.eye.set(pos.x, pos.y + 1.7, pos.z);
      this.velocity.set(0, 0, 0);
      if (yaw !== undefined) this.yaw = yaw;
      // Mirrors Player.ts: teleport resets pitch to 0 so zipline/elevator must preserve it.
      this.pitch = 0;
    },
    launch(vel: THREE.Vector3) {
      launchCalls.push(vel.clone());
      this.velocity.x += vel.x;
      this.velocity.z += vel.z;
      this.velocity.y = vel.y;
      this.grounded = false;
    },
    push(vel: THREE.Vector3) {
      this.velocity.add(vel);
      this.grounded = false;
    },
    park() {
      this.parked = true;
    },
    unpark() {
      this.parked = false;
    },
  };

  const ctx = {
    events,
    input,
    player,
    physics,
    render: {
      scene,
      camera,
    },
    audio: {
      play(id: string) {
        audioPlayed.push(id);
      },
    },
    fx: {
      sparks: vi.fn(),
      explosion: vi.fn(),
      dust: vi.fn(),
    },
    camera: {
      addTrauma(amount: number) {
        traumaAdded.push(amount);
      },
    },
    hud: {
      follow(_target: THREE.Vector3, label: string) {
        const rec = { label, removed: false };
        hudFollowCalls.push(rec);
        return () => {
          rec.removed = true;
        };
      },
      hitMarker: vi.fn(),
      feed: vi.fn(),
    },
    enemies: {
      alive: [],
      vehicles: {
        addExtra(t: ExtraTarget) {
          extras.add(t);
        },
        removeExtra(t: ExtraTarget) {
          extras.delete(t);
        },
      },
    },
    progression: {
      kills: 0,
      score: 0,
    },
  } as unknown as Ctx;

  return {
    ctx,
    events,
    input,
    scene,
    camera,
    launchCalls,
    explosions,
    hudFollowCalls,
    extras,
    audioPlayed,
    traumaAdded,
  };
}

// ---------------------------------------------------------------------------------------------
// 1. Zipline System
// ---------------------------------------------------------------------------------------------

describe('ZiplineManager & pure math helpers', () => {
  it('sampleZipline and stepZiplineRide compute steep speed ramp, snapAt, and completion headlessly', () => {
    const start: readonly [number, number, number] = [-68, 53.5, -136];
    const end: readonly [number, number, number] = [-8, 39.5, -112];

    const s0 = sampleZipline(start, end, 0);
    const s1 = sampleZipline(start, end, 1);
    expect(s0.position.x).toBeCloseTo(-68, 4);
    expect(s1.position.x).toBeCloseTo(-8, 4);
    expect(s0.downwardSin).toBeGreaterThan(0.18);
    expect(s0.length).toBeGreaterThan(60);

    // Ride down a steep cable accelerates from 28 m/s toward 34 m/s.
    let t = 0;
    let speed: number = ZIPLINE_DEFAULTS.baseSpeed;
    let elapsed = 0;
    let snapped = false;
    for (let i = 0; i < 60; i++) {
      const out = stepZiplineRide(
        { start, end, t, speed, elapsed, snapAt: 0.65, snapped },
        0.05,
      );
      t = out.t;
      speed = out.speed;
      elapsed = out.elapsed;
      if (out.snappedNow) {
        snapped = true;
        expect(out.t).toBeCloseTo(0.65, 5);
        expect(out.completed).toBe(false);
        break;
      }
    }
    expect(snapped).toBe(true);
    expect(speed).toBeGreaterThan(ZIPLINE_DEFAULTS.baseSpeed + 2);
    expect(speed).toBeLessThanOrEqual(ZIPLINE_DEFAULTS.maxSpeed + 1e-4);

    // Without snapAt, completes cleanly at t = 1.
    let done = false;
    t = 0;
    speed = 28;
    elapsed = 0;
    for (let i = 0; i < 120; i++) {
      const out = stepZiplineRide({ start, end, t, speed, elapsed, snapAt: null }, 0.05);
      t = out.t;
      speed = out.speed;
      elapsed = out.elapsed;
      if (out.completed) {
        done = true;
        break;
      }
    }
    expect(done).toBe(true);
    expect(t).toBe(1);
  });

  it('shows [E] ZIPLINE prompt within 3.5 m, attaches without parking, preserves look, and launches on Space', () => {
    const env = makeTestEnv();
    const onDetach = vi.fn();
    const mgr = new ZiplineManager(env.ctx, { onDetach });

    mgr.add({
      id: 'canyon',
      start: [0, 50, 0],
      end: [0, 34, -64],
    });

    // Outside 3.5 m -> no prompt.
    env.ctx.player.position.set(0, 48, 8);
    mgr.update(0.016);
    expect(mgr.promptedId).toBeNull();
    expect(env.hudFollowCalls.length).toBe(0);

    // Inside 3.5 m -> shows [E] ZIPLINE prompt.
    env.ctx.player.position.set(0, 48.5, 1.5);
    mgr.update(0.016);
    expect(mgr.promptedId).toBe('canyon');
    expect(env.hudFollowCalls[0]?.label).toBe('[E] ZIPLINE');

    // Press interact while looking sideways/up -> attaches without parking & preserves yaw/pitch.
    env.ctx.player.yaw = 0.75;
    env.ctx.player.pitch = 0.35;
    env.input.justPressed.add('interact');
    mgr.update(0.016);
    env.input.justPressed.clear();

    expect(mgr.riding).toBe(true);
    expect(env.ctx.player.parked).toBe(false);
    expect(env.ctx.player.yaw).toBeCloseTo(0.75, 5);
    expect(env.ctx.player.pitch).toBeCloseTo(0.35, 5);

    // Ride for 0.6 s to build steep-descent speed past 28 m/s.
    for (let i = 0; i < 12; i++) {
      mgr.update(0.05);
    }
    expect(mgr.riding).toBe(true);
    expect(mgr.speed).toBeGreaterThan(28);
    expect(env.ctx.player.parked).toBe(false);
    expect(env.ctx.player.pitch).toBeCloseTo(0.35, 5);

    // Press Space -> early detach launching with full cable velocity.
    env.input.justPressed.add('jump');
    mgr.update(0.016);
    env.input.justPressed.clear();

    expect(mgr.riding).toBe(false);
    expect(env.launchCalls.length).toBe(1);
    const launchVel = env.launchCalls[0]!;
    expect(Math.hypot(launchVel.x, launchVel.z)).toBeGreaterThan(25);
    expect(launchVel.y).toBeGreaterThan(0);
    expect(onDetach).toHaveBeenCalledWith('canyon', 'jump', expect.any(THREE.Vector3));

    mgr.dispose();
  });

  it('detonates far anchor at scripted snapAt, launches with upward forgiveness lift, and resets cleanly', () => {
    const env = makeTestEnv();
    const onSnap = vi.fn();
    const mgr = new ZiplineManager(env.ctx);

    mgr.add({
      id: 'canyon_snap',
      start: [-68, 53.5, -136],
      end: [-8, 39.5, -112],
      snapAt: 0.65,
      onSnap,
    });

    expect(mgr.attach('canyon_snap')).toBe(true);
    expect(mgr.riding).toBe(true);

    // Step until snapAt triggers.
    for (let i = 0; i < 80 && mgr.riding; i++) {
      mgr.update(0.05);
    }

    expect(mgr.riding).toBe(false);
    expect(mgr.isSnapped('canyon_snap')).toBe(true);
    expect(onSnap).toHaveBeenCalledTimes(1);
    expect(env.explosions.length).toBe(1);
    expect(env.explosions[0]!.source).toBe('zipline_snap');
    expect(env.explosions[0]!.position.x).toBeCloseTo(-8, 3);
    expect(env.launchCalls.length).toBe(1);
    expect(env.launchCalls[0]!.y).toBeGreaterThanOrEqual(ZIPLINE_DEFAULTS.snapUpwardLift - 0.01);
    expect(Math.hypot(env.launchCalls[0]!.x, env.launchCalls[0]!.z)).toBeGreaterThan(24);

    // Cannot re-attach to a snapped cable.
    expect(mgr.attach('canyon_snap')).toBe(false);

    // Clean reset restores cable and allows re-attaching.
    mgr.reset();
    expect(mgr.isSnapped('canyon_snap')).toBe(false);
    expect(mgr.attach('canyon_snap')).toBe(true);
    mgr.dispose();
    expect(mgr.riding).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Service Elevator (Real Rapier Physics + Full State Machine)
// ---------------------------------------------------------------------------------------------

describe('ServiceElevator with real Rapier kinematic floor & 4 shootable clamps', () => {
  let activeElevator: ServiceElevator | null = null;

  afterEach(() => {
    activeElevator?.dispose();
    activeElevator = null;
  });

  it('walks the full state machine idle_top -> holding -> doors_open -> descending_1 -> jammed -> 4 clamps -> falling -> arrived_vault', async () => {
    const physics = await Physics.create();
    const env = makeTestEnv(physics);

    const states: ElevatorState[] = [];
    const holdSamples: number[] = [];
    const clampEvents: { idx: number; rem: number }[] = [];
    const onCeilingBreach = vi.fn();
    const onArrivedVault = vi.fn();

    const elevator = new ServiceElevator(env.ctx, {
      position: [10, 34, -20],
      topY: 34,
      jamY: 18,
      bottomY: -6,
      holdDuration: 25,
      clampHp: 80,
      onStateChange: s => states.push(s),
      onHoldProgress: (_e, _d, f) => holdSamples.push(f),
      onClampDestroyed: (idx, rem) => clampEvents.push({ idx, rem }),
      onCeilingBreach,
      onArrivedVault,
    });
    activeElevator = elevator;

    // Registered as ExtraTarget and kinematic floor collider exists in real Rapier world.
    expect(env.extras.has(elevator)).toBe(true);
    expect(elevator.collider).not.toBeNull();
    physics.flushQueries();

    const topHit = physics.raycast(
      new THREE.Vector3(10, 36, -20),
      new THREE.Vector3(0, -1, 0),
      5,
      CG.World,
    );
    expect(topHit).not.toBeNull();
    expect(topHit!.point.y).toBeCloseTo(34, 2);

    // 1. idle_top -> holding (25 s countdown)
    expect(elevator.state).toBe('idle_top');
    expect(elevator.startHold()).toBe(true);
    expect(elevator.state).toBe('holding');

    for (let i = 0; i < 25; i++) {
      elevator.update(1.0);
    }
    expect(holdSamples[holdSamples.length - 1]).toBeCloseTo(1, 4);
    expect(elevator.state).toBe('doors_open');

    // 2. Player steps inside cab footprint -> doors close & descending_1 begins
    env.ctx.player.position.set(10, 34, -20);
    env.ctx.player.yaw = 1.1;
    env.ctx.player.pitch = -0.2;
    elevator.update(0.1);
    expect(elevator.state).toBe('descending_1');

    // 3. Descend smoothly to jamY = 18; player rides kinematic floor without clipping through
    let steps = 0;
    while (elevator.state === 'descending_1' && steps < 300) {
      elevator.update(0.05);
      physics.step(0.05);
      // Player remains safely on or slightly above the moving floor deck.
      expect(env.ctx.player.position.y).toBeGreaterThanOrEqual(elevator.y - 0.05);
      expect(env.ctx.player.position.y).toBeLessThanOrEqual(elevator.y + 0.5);
      expect(env.ctx.player.pitch).toBeCloseTo(-0.2, 5);
      steps++;
    }
    expect(elevator.state).toBe('jammed');
    expect(elevator.y).toBeCloseTo(18, 3);
    expect(elevator.scrollOffset).toBeGreaterThan(20);
    expect(elevator.clampsRemaining).toBe(4);

    // Verify Rapier kinematic floor followed the cab down to y = 18.
    const jamFloorHit = physics.raycast(
      new THREE.Vector3(10, 20, -20),
      new THREE.Vector3(0, -1, 0),
      5,
      CG.World,
    );
    expect(jamFloorHit).not.toBeNull();
    expect(jamFloorHit!.point.y).toBeCloseTo(18, 2);

    // 4. Destroy all 4 hydraulic brake clamps (80 HP each) using mixed hit(), ExtraTarget.shot(), and blast()
    const clamps = elevator.getClamps();
    expect(clamps).toHaveLength(4);
    for (const c of clamps) {
      expect(c.hp).toBe(ELEVATOR_DEFAULTS.clampHp);
      expect(c.alive).toBe(true);
    }

    // Clamp 0: two 50-dmg ray hits via hit(pos, dir, dmg)
    const c0Pos = clamps[0]!.position;
    const shootFrom = new THREE.Vector3(10, 19.7, -20);
    const dirToC0 = new THREE.Vector3().subVectors(c0Pos, shootFrom).normalize();
    expect(elevator.hit(shootFrom, dirToC0, 50)).toBe(true);
    expect(elevator.clampsRemaining).toBe(4);
    expect(elevator.hit(shootFrom, dirToC0, 50)).toBe(true);
    expect(elevator.clampsRemaining).toBe(3);

    // Clamp 1: hit via ExtraTarget.shot(collider, ...)
    const c1Col = elevator.getClampCollider(1)!;
    expect(c1Col).not.toBeNull();
    expect(elevator.shot(c1Col, clamps[1]!.position, 80, 'smg')).toBe(true);
    expect(elevator.clampsRemaining).toBe(2);

    // Clamp 2: hit via direct blast(pos, radius, dmg)
    expect(elevator.blast(clamps[2]!.position, 2.0, 90)).toBeGreaterThanOrEqual(1);
    expect(elevator.clampsRemaining).toBe(1);

    // Clamp 3: hit via ExtraTarget.blast(center, ExplosionSpec)
    const hitCount = elevator.blast(clamps[3]!.position, {
      radius: 2.5,
      damage: 120,
      kind: 'grenade',
      source: 'frag',
      team: 'player',
    });
    expect(hitCount).toBe(1);
    expect(elevator.clampsRemaining).toBe(0);
    expect(clampEvents).toHaveLength(4);
    expect(elevator.state).toBe('falling');

    // 5. Rapid plunge smashes through ceiling grate and lands at bottomY = -6 -> arrived_vault
    let fallSteps = 0;
    while (elevator.state === 'falling' && fallSteps < 300) {
      elevator.update(0.05);
      physics.step(0.05);
      expect(env.ctx.player.position.y).toBeGreaterThanOrEqual(elevator.y - 0.05);
      fallSteps++;
    }

    expect(elevator.ceilingBreached).toBe(true);
    expect(onCeilingBreach).toHaveBeenCalledTimes(1);
    expect(env.explosions.some(e => e.source === 'elevator_breach')).toBe(true);
    expect(elevator.state).toBe('arrived_vault');
    expect(elevator.y).toBeCloseTo(-6, 3);
    expect(onArrivedVault).toHaveBeenCalledTimes(1);

    // Doors slide open into Compute Vault.
    elevator.update(1.0);
    expect(elevator.doorOpen).toBeCloseTo(1, 3);

    expect(states).toEqual([
      'holding',
      'doors_open',
      'descending_1',
      'jammed',
      'falling',
      'arrived_vault',
    ]);

    // Clean reset restores top position & 4 intact clamps.
    elevator.reset();
    expect(elevator.state).toBe('idle_top');
    expect(elevator.y).toBe(34);
    expect(elevator.clampsRemaining).toBe(4);
    expect(elevator.ceilingBreached).toBe(false);

    // Clean dispose unregisters ExtraTarget.
    elevator.dispose();
    activeElevator = null;
    expect(env.extras.has(elevator)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// 3. GrappleMarkManager
// ---------------------------------------------------------------------------------------------

describe('GrappleMarkManager range/aim filtering & lifecycle', () => {
  it('filters anchors by HARPOON.maxRange (160 m) and crosshair aim cone, selects best focus, and cleans up', () => {
    const env = makeTestEnv();
    env.ctx.player.eye.set(0, 40, 0);
    env.ctx.player.position.set(0, 38.3, 0);
    env.ctx.player.forward.set(0, 0, -1);

    // Pure helper sanity checks.
    const nearFront = evaluateGrappleAnchor(
      new THREE.Vector3(0, 40, 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 40, -50),
    );
    expect(nearFront.visible).toBe(true);
    expect(nearFront.inRange).toBe(true);
    expect(nearFront.inAimCone).toBe(true);

    const tooFar = evaluateGrappleAnchor(
      new THREE.Vector3(0, 40, 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 40, -(HARPOON.maxRange + 15)),
    );
    expect(tooFar.inRange).toBe(false);
    expect(tooFar.visible).toBe(false);

    const behind = evaluateGrappleAnchor(
      new THREE.Vector3(0, 40, 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 40, 30),
    );
    expect(behind.inAimCone).toBe(false);
    expect(behind.visible).toBe(false);

    // Manager integration with multiple anchors + dynamic boss shoulder anchor.
    const bossShoulder = new THREE.Vector3(6, 42, -45);
    const mgr = new GrappleMarkManager(env.ctx);
    mgr.add({ id: 'crane_center', position: [0, 40, -60], priority: 1 });
    mgr.add({ id: 'crane_edge', position: [12, 40, -60], priority: 0 });
    mgr.add({ id: 'too_far', position: [0, 40, -185], maxRange: GRAPPLE_MARK_DEFAULTS.maxRange });
    mgr.add({ id: 'off_axis', position: [60, 40, -20] });
    mgr.add({ id: 'boss_shoulder', position: () => bossShoulder, priority: 5, label: '[RMB] GRAPPLE ORION' });

    mgr.update(0.016);
    const active = mgr.getActiveMarks();
    const activeIds = active.map(m => m.id);
    expect(activeIds).toContain('crane_center');
    expect(activeIds).toContain('crane_edge');
    expect(activeIds).toContain('boss_shoulder');
    expect(activeIds).not.toContain('too_far');
    expect(activeIds).not.toContain('off_axis');

    // Boss shoulder has highest priority -> focused reticle target.
    expect(mgr.getFocusedMark()?.id).toBe('boss_shoulder');
    expect(mgr.getFocusedMark()?.label).toBe('[RMB] GRAPPLE ORION');

    // Disabling boss shoulder hands focus cleanly to crane_center.
    mgr.setEnabled('boss_shoulder', false);
    mgr.update(0.016);
    expect(mgr.getFocusedMark()?.id).toBe('crane_center');

    // Moving crane_center out of range removes it from active marks.
    mgr.setPosition('crane_center', [0, 40, -200]);
    mgr.update(0.016);
    expect(mgr.getActiveMarks().map(m => m.id)).toEqual(['crane_edge']);

    // Reset restores initial enabled flags & positions.
    mgr.reset();
    mgr.update(0.016);
    expect(mgr.getFocusedMark()?.id).toBe('boss_shoulder');

    // Dispose cleans everything up cleanly.
    mgr.dispose();
    expect(mgr.count).toBe(0);
    expect(mgr.getFocusedMark()).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// 4. CivilianCrowd
// ---------------------------------------------------------------------------------------------

describe('CivilianCrowd pool cap, blast panic, and safe subway recycling', () => {
  it('enforces pool cap <= 24, accelerates on blast/world:explosion, and recycles cleanly into subway exits', () => {
    const env = makeTestEnv();
    const recycledRoutes: string[] = [];

    const crowd = new CivilianCrowd(env.ctx, {
      count: 60, // Exceeds MAX_CIVILIANS to verify strict cap
      routes: [
        {
          id: 'west_sidewalk',
          waypoints: [
            [-14, 0, 20],
            [-14, 0, 50],
            [-14, 0, 80],
          ],
          subwayExit: [-14, 0, 82],
        },
        {
          id: 'east_sidewalk',
          waypoints: [
            [14, 0, 20],
            [14, 0, 50],
            [14, 0, 80],
          ],
          subwayExit: [14, 0, 82],
        },
      ],
      onRecycle: routeId => recycledRoutes.push(routeId),
    });

    // Pool strictly capped at <= 24.
    expect(crowd.maxCount).toBe(MAX_CIVILIANS);
    expect(crowd.maxCount).toBeLessThanOrEqual(24);
    expect(crowd.activeCount).toBe(24);
    expect(crowd.panickedCount).toBe(0);

    // Step calmly and capture baseline speeds & stride phases.
    crowd.update(0.1);
    const calmSnaps = crowd.getSnapshots();
    const westNear = calmSnaps.find(s => s.routeId === 'west_sidewalk' && s.position.z < 55)!;
    expect(westNear).toBeDefined();
    const calmSpeed = westNear.speed;
    const prevPhase = westNear.stridePhase;

    // Trigger blast right beside westNear via world:explosion event (auto-wired to reactToBlast).
    env.events.emit('world:explosion', {
      position: new THREE.Vector3(westNear.position.x, 0, westNear.position.z),
      radius: 10,
      damage: 150,
      kind: 'barrel',
      source: 'orion_beam',
    });

    expect(crowd.panickedCount).toBeGreaterThan(0);

    // Initially ducks/flinches briefly, then surges into panicked sprint faster than calm speed.
    crowd.update(0.1);
    const duckSnap = crowd.getSnapshots()[westNear.index]!;
    expect(duckSnap.panicked).toBe(true);
    expect(duckSnap.ducking).toBe(true);
    expect(duckSnap.stridePhase).toBeGreaterThan(prevPhase);

    // After duck duration elapses, panic speed multiplier kicks in fully.
    crowd.update(CIVILIAN_DEFAULTS.duckDuration + 0.1);
    const sprintSnap = crowd.getSnapshots()[westNear.index]!;
    expect(sprintSnap.panicked).toBe(true);
    expect(sprintSnap.ducking).toBe(false);
    expect(sprintSnap.speed).toBeGreaterThan(calmSpeed * 1.45);

    // Run long enough for civilians to reach subway exits and recycle cleanly.
    for (let i = 0; i < 160; i++) {
      crowd.update(0.1);
    }
    expect(crowd.recycledCount).toBeGreaterThan(0);
    expect(recycledRoutes.length).toBe(crowd.recycledCount);
    // Pool count stays steady and non-combatant (zero kills/score touched).
    expect(crowd.activeCount).toBe(24);
    expect(env.ctx.progression.kills).toBe(0);
    expect(env.ctx.progression.score).toBe(0);

    // Clean reset & dispose.
    crowd.reset();
    expect(crowd.recycledCount).toBe(0);
    expect(crowd.panickedCount).toBe(0);
    crowd.dispose();
    expect(crowd.activeCount).toBe(0);
  });

  it('only startles civilians within blast reach and supports stop/start cleanly', () => {
    const env = makeTestEnv();
    const crowd = new CivilianCrowd(env.ctx, {
      count: 6,
      panicRadius: 20,
      routes: [
        {
          id: 'north_block',
          waypoints: [
            [-14, 0, 10],
            [-14, 0, 20],
          ],
        },
        {
          id: 'far_south_block',
          waypoints: [
            [14, 0, 140],
            [14, 0, 160],
          ],
        },
      ],
    });

    const startled = crowd.reactToBlast(new THREE.Vector3(-14, 0, 14), 10);
    expect(startled).toBe(3);
    expect(crowd.panickedCount).toBe(3);

    crowd.stop();
    expect(crowd.activeCount).toBe(0);
    crowd.start();
    expect(crowd.activeCount).toBe(6);
    crowd.dispose();
  });
});

describe('Edge cases: zipline completion & elevator pre-jam guard', () => {
  it('completes an intact zipline cleanly and invokes onComplete', () => {
    const env = makeTestEnv();
    const onComplete = vi.fn();
    const mgr = new ZiplineManager(env.ctx);
    mgr.add({ id: 'short_flat', start: [0, 20, 0], end: [0, 20, -28], onComplete });
    expect(mgr.attach('short_flat')).toBe(true);

    for (let i = 0; i < 30 && mgr.riding; i++) {
      mgr.update(0.05);
    }
    expect(mgr.riding).toBe(false);
    expect(onComplete).toHaveBeenCalledWith('short_flat');
    expect(env.launchCalls.length).toBe(1);
    mgr.dispose();
  });

  it('ignores clamp damage before jammed state and supports direct checkpoint state jumps', () => {
    const env = makeTestEnv();
    const elevator = new ServiceElevator(env.ctx, {
      position: [0, 34, 0],
      topY: 34,
      jamY: 18,
      bottomY: -6,
    });

    // Cannot break clamps while idle_top or descending_1.
    expect(elevator.damageClamp(0, 100)).toBe(false);
    elevator.startDescent();
    expect(elevator.state).toBe('descending_1');
    expect(elevator.damageClamp(0, 100)).toBe(false);
    expect(elevator.clampsRemaining).toBe(4);

    // Checkpoint jump to jammed enables shooting clamps immediately.
    elevator.setCheckpointState('jammed');
    expect(elevator.state).toBe('jammed');
    expect(elevator.y).toBe(18);
    expect(elevator.damageClamp(0, 80)).toBe(true);
    expect(elevator.clampsRemaining).toBe(3);

    elevator.setCheckpointState('arrived_vault');
    expect(elevator.state).toBe('arrived_vault');
    expect(elevator.y).toBe(-6);
    expect(elevator.doorOpen).toBe(1);
    elevator.dispose();
  });
});

