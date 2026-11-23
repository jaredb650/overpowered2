/**
 * Unit tests for DesertAirAndSquads (Mission 5: DESERT RAID — Lane 3):
 *   - Twin escort gunships formation & strict zero-unscripted-attacks invariant
 *   - Scripted Warthog Main Gate breach timing, onBreached callback & camera restoration
 *   - Fast-rope friendly assault squad deployment across 3 lanes, advancing, casualties & cleanup
 *   - 11-second scenic town-flattening ending cutscene, destruction sweep & completion signal
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Ally, AllyType } from '../../allies';
import type { Ctx, SeatView } from '../../core/contracts';
import type { CampaignHud } from '../hud';
import type { MissionRunner } from '../runner';
import { CARGO_PLANE, DESERT_Z, HIGH_TERRACES, MAIN_GATE } from '../../world/map/desert/plan';
import {
  DesertAirAndSquads,
  DROP_ZONE,
  ENDING_CUTSCENE,
  GATE_STRIKE,
  SQUAD_POST_RADIUS,
} from './airAndSquads';

interface FakeAlly {
  type: AllyType;
  state: 'up' | 'down' | 'dead';
  detached: boolean;
  order: 'post' | 'follow';
  post: THREE.Vector3;
  postRadius: number;
  postYaw: number;
  health: number;
  maxHealth: number;
  thinkAt: number;
  patrolAt: number;
  body: {
    position: THREE.Vector3;
    center: THREE.Vector3;
    alive: boolean;
  };
}

function makeFakeEnv(opts: { playerParked?: boolean } = {}) {
  const scene = new THREE.Scene();
  const signals: string[] = [];
  const sounds: { id: string; opts?: unknown }[] = [];
  const tracers: { from: THREE.Vector3; to: THREE.Vector3; kind: string }[] = [];
  const explosions: { pos: THREE.Vector3; kind?: string }[] = [];
  const dustCalls: THREE.Vector3[] = [];
  const smokeCalls: THREE.Vector3[] = [];
  const emberCalls: THREE.Vector3[] = [];
  const napalmCalls: THREE.Vector3[] = [];
  const damageBlasts: { center: THREE.Vector3; radius: number; amount: number; source: string }[] = [];
  const nukeSweeps: { center: THREE.Vector3; maxRadius: number }[] = [];
  const spawnedProjectiles: unknown[] = [];
  const combatExplodes: unknown[] = [];

  let activeSeat: SeatView | null = null;
  let activeZoom: number | null = null;
  let activeHudSeat: unknown = null;
  let lastCaption = '';
  let parkCount = 0;
  let unparkCount = 0;
  let holstered = false;
  let traumaTotal = 0;
  const seatHistory: (SeatView | null)[] = [];
  const hudSeatHistory: unknown[] = [];
  const loopStops: number[] = [];
  const emitterStops: number[] = [];

  const spawnedAllies: FakeAlly[] = [];
  const dismissedAllies: FakeAlly[] = [];
  const orderCalls: { ally: FakeAlly; order: string }[] = [];
  let preloadCalls = 0;

  const player = {
    position: new THREE.Vector3(0, 0, DESERT_Z.approachStart),
    eye: new THREE.Vector3(0, 1.7, DESERT_Z.approachStart),
    yaw: Math.PI,
    alive: true,
    parked: opts.playerParked ?? false,
    park: vi.fn(() => {
      player.parked = true;
      parkCount++;
    }),
    unpark: vi.fn(() => {
      player.parked = false;
      unparkCount++;
    }),
    push: vi.fn(),
    launch: vi.fn(),
  };

  const ctx = {
    time: { elapsed: 10, dt: 0.05 },
    events: { on: vi.fn(() => () => {}), emit: vi.fn() },
    render: {
      scene,
      camera: new THREE.PerspectiveCamera(),
      materials: {
        patch: <T extends THREE.MeshStandardMaterial>(m: T): T => m,
      },
      lights: { flash: vi.fn() },
      decals: { add: vi.fn() },
      post: {
        flash: vi.fn(),
        chromatic: vi.fn(),
        radialBlur: vi.fn(),
      },
      sweep: vi.fn(),
    },
    physics: {
      preStep: new Set<(dt: number) => void>(),
      raycastInto: vi.fn(() => false),
      radialImpulse: vi.fn(),
    },
    player,
    camera: {
      setSeat: vi.fn((view: SeatView | null) => {
        activeSeat = view;
        seatHistory.push(view);
      }),
      syncSeat: vi.fn(),
      setZoom: vi.fn((fov: number | null) => {
        activeZoom = fov;
      }),
      addTrauma: vi.fn((amount: number) => {
        traumaTotal += amount;
      }),
      kick: vi.fn(),
      fovPunch: vi.fn(),
    },
    weapons: {
      setHolstered: vi.fn((h: boolean) => {
        holstered = h;
      }),
    },
    hud: {
      seat: vi.fn((panel: unknown) => {
        activeHudSeat = panel;
        hudSeatHistory.push(panel);
      }),
    },
    audio: {
      has: vi.fn(() => true),
      play: vi.fn((id: string, o?: unknown) => {
        sounds.push({ id, opts: o });
      }),
      startLoop: vi.fn(() => ({
        alive: true,
        setVolume: vi.fn(),
        setPitch: vi.fn(),
        setPosition: vi.fn(),
        stop: vi.fn(() => {
          loopStops.push(1);
        }),
      })),
    },
    fx: {
      muzzleFlash: vi.fn(),
      tracer: vi.fn((from: THREE.Vector3, to: THREE.Vector3, kind: string) => {
        tracers.push({ from: from.clone(), to: to.clone(), kind });
      }),
      sparks: vi.fn(),
      burst: vi.fn(),
      explosion: vi.fn((pos: THREE.Vector3, o: { kind?: string }) => {
        explosions.push({ pos: pos.clone(), kind: o?.kind });
      }),
      ring: vi.fn(),
      smoke: vi.fn((pos: THREE.Vector3) => {
        smokeCalls.push(pos.clone());
      }),
      embers: vi.fn((pos: THREE.Vector3) => {
        emberCalls.push(pos.clone());
      }),
      dust: vi.fn((pos: THREE.Vector3) => {
        dustCalls.push(pos.clone());
      }),
      chips: vi.fn(),
      heatShimmer: vi.fn(),
      napalm: vi.fn((pos: THREE.Vector3) => {
        napalmCalls.push(pos.clone());
      }),
      flameLick: vi.fn(),
      attachEmitter: vi.fn(() => ({
        alive: true,
        stop: vi.fn(() => {
          emitterStops.push(1);
        }),
      })),
    },
    combat: {
      spawnProjectile: vi.fn((spec: unknown) => {
        spawnedProjectiles.push(spec);
      }),
      explode: vi.fn((pos: THREE.Vector3, spec: unknown) => {
        combatExplodes.push({ pos: pos.clone(), spec });
      }),
    },
    world: {
      nav: {
        nearest: vi.fn((pt: THREE.Vector3, _maxDist: number, out: THREE.Vector3) => {
          out.copy(pt);
          return true;
        }),
      },
      objects: {
        damageExplosivesInRadius: vi.fn((center: THREE.Vector3, radius: number, amount: number, source: string) => {
          damageBlasts.push({ center: center.clone(), radius, amount, source });
        }),
        nukeSweep: vi.fn((center: THREE.Vector3, maxRadius = 340) => {
          nukeSweeps.push({ center: center.clone(), maxRadius });
        }),
        destruction: {
          blast: vi.fn(),
          nukeSweep: vi.fn(),
        },
      },
    },
    allies: {
      preload: vi.fn(() => {
        preloadCalls++;
        return Promise.resolve();
      }),
      spawn: vi.fn((type: AllyType, at: THREE.Vector3, post?: THREE.Vector3, radius = 6, yaw = Math.PI) => {
        const ally: FakeAlly = {
          type,
          state: 'up',
          detached: false,
          order: 'post',
          post: (post ?? at).clone(),
          postRadius: radius,
          postYaw: yaw,
          health: 150,
          maxHealth: 150,
          thinkAt: 1,
          patrolAt: 1,
          body: {
            position: at.clone(),
            center: at.clone().add(new THREE.Vector3(0, 1, 0)),
            alive: true,
          },
        };
        spawnedAllies.push(ally);
        return ally as unknown as Ally;
      }),
      setOrder: vi.fn((ally: Ally, order: 'post' | 'follow') => {
        const fa = ally as unknown as FakeAlly;
        fa.order = order;
        orderCalls.push({ ally: fa, order });
      }),
      dismiss: vi.fn((ally: Ally) => {
        const fa = ally as unknown as FakeAlly;
        fa.body.alive = false;
        dismissedAllies.push(fa);
      }),
    },
  } as unknown as Ctx;

  const runner = {
    signal: vi.fn((name: string) => {
      signals.push(name);
    }),
  } as unknown as MissionRunner;

  const cinemaPanel = { el: {} as HTMLElement, update: vi.fn() };
  const ui = {
    cinema: cinemaPanel,
    caption: vi.fn((text: string) => {
      lastCaption = text;
    }),
  } as unknown as CampaignHud;

  const step = (ctrl: DesertAirAndSquads, seconds: number, dt = 0.05) => {
    const steps = Math.ceil(seconds / dt);
    for (let i = 0; i < steps; i++) {
      const h = i === steps - 1 ? seconds - dt * (steps - 1) : dt;
      if (h > 1e-6) {
        (ctx.time as { elapsed: number }).elapsed += h;
        ctrl.update(h);
      }
    }
  };

  return {
    ctx,
    scene,
    runner,
    ui,
    cinemaPanel,
    signals,
    sounds,
    tracers,
    explosions,
    dustCalls,
    smokeCalls,
    emberCalls,
    napalmCalls,
    damageBlasts,
    nukeSweeps,
    spawnedProjectiles,
    combatExplodes,
    spawnedAllies,
    dismissedAllies,
    orderCalls,
    seatHistory,
    hudSeatHistory,
    loopStops,
    emitterStops,
    player,
    step,
    getState: () => ({
      activeSeat,
      activeZoom,
      activeHudSeat,
      lastCaption,
      parkCount,
      unparkCount,
      holstered,
      traumaTotal,
      preloadCalls,
    }),
  };
}

describe('DesertAirAndSquads', () => {
  describe('Escort gunships (startEscort)', () => {
    it('builds twin desert gunships in low escort formation and NEVER fires unscripted attacks', () => {
      const env = makeFakeEnv();
      const air = new DesertAirAndSquads(env.ctx, env.runner, env.ui);

      air.startEscort();
      expect(air.gunshipMode).toBe('escort');
      expect(env.getState().preloadCalls).toBe(1);

      const gunshipRoots = env.scene.children.filter(c => c.name === 'desert_gunship');
      expect(gunshipRoots).toHaveLength(2);
      expect(gunshipRoots.every(g => g.visible)).toBe(true);

      // Advance through Approach & Wall Loop while player moves northward along convoy corridor.
      for (let i = 0; i < 40; i++) {
        env.player.position.z = Math.max(DESERT_Z.convoyLoop, DESERT_Z.approachStart - i * 3.5);
        env.step(air, 0.5, 0.05);

        // Both gunships stay in low escort altitude band (18..24 m) flanking the raid column.
        for (const g of gunshipRoots) {
          expect(g.position.y).toBeGreaterThanOrEqual(17.5);
          expect(g.position.y).toBeLessThanOrEqual(24.8);
        }
      }

      // Port and starboard gunships remain on opposite flanks of the column.
      const xs = gunshipRoots.map(g => g.position.x).sort((a, b) => a - b);
      expect(xs[0]!).toBeLessThan(-10);
      expect(xs[1]!).toBeGreaterThan(10);

      // CRITICAL INVARIANT: zero unscripted attacks during Approach / Wall Loop.
      expect(env.tracers).toHaveLength(0);
      expect(env.explosions).toHaveLength(0);
      expect(env.spawnedProjectiles).toHaveLength(0);
      expect(env.combatExplodes).toHaveLength(0);
      expect(env.damageBlasts).toHaveLength(0);
      expect(env.nukeSweeps).toHaveLength(0);
    });
  });

  describe('Scripted Warthog Main Gate breach (strikeMainGate)', () => {
    it('cuts camera, fires GAU-8 30mm tracers, triggers onBreached once at ~2.1s, restores camera & signals dr:gate_breached', () => {
      const env = makeFakeEnv({ playerParked: false });
      const air = new DesertAirAndSquads(env.ctx, env.runner, env.ui);
      const onBreached = vi.fn();

      air.strikeMainGate(onBreached);
      expect(air.isGateStrikeActive).toBe(true);
      expect(air.hasCameraOverride).toBe(true);
      expect(env.getState().activeSeat).not.toBeNull();
      expect(env.getState().activeHudSeat).toBe(env.cinemaPanel);
      expect(env.getState().activeZoom).toBe(GATE_STRIKE.fov);
      expect(env.getState().holstered).toBe(true);
      expect(env.getState().parkCount).toBe(1);

      // At 1.8 s: tracer stream has begun raking the gate, but gate has NOT breached yet.
      env.step(air, 1.8, 0.05);
      expect(env.tracers.length).toBeGreaterThanOrEqual(8);
      expect(env.tracers.every(t => t.kind === 'heavy')).toBe(true);
      expect(onBreached).not.toHaveBeenCalled();
      expect(env.signals).toEqual([]);

      // Advance past impact (t = 2.25 s): onBreached fires ONCE + massive blast FX + Warthog roar.
      env.step(air, 0.45, 0.05);
      expect(onBreached).toHaveBeenCalledTimes(1);
      expect(env.explosions.length).toBeGreaterThanOrEqual(1);
      expect(env.explosions[0]!.pos.distanceTo(new THREE.Vector3(MAIN_GATE.x, 3, MAIN_GATE.z))).toBeLessThan(2);
      expect(env.sounds.some(s => s.id === 'warthog_flyby')).toBe(true);
      expect(env.getState().traumaTotal).toBeGreaterThan(0.8);
      expect(air.isGateStrikeActive).toBe(true);

      // Finish the 3.8 s cut: camera restored, weapons unholstered, signal emitted, onBreached still 1.
      env.step(air, 1.7, 0.05);
      expect(air.isGateStrikeActive).toBe(false);
      expect(air.hasCameraOverride).toBe(false);
      expect(onBreached).toHaveBeenCalledTimes(1);
      expect(env.getState().activeSeat).toBeNull();
      expect(env.getState().activeZoom).toBeNull();
      expect(env.getState().activeHudSeat).toBeNull();
      expect(env.getState().holstered).toBe(false);
      expect(env.getState().unparkCount).toBe(1);
      expect(env.signals).toEqual(['dr:gate_breached']);
    });

    it('preserves convoy parking if player was already parked and restores camera on mid-cut clear()', () => {
      const env = makeFakeEnv({ playerParked: true });
      const air = new DesertAirAndSquads(env.ctx, env.runner, env.ui);
      const onBreached = vi.fn();

      air.strikeMainGate(onBreached);
      expect(env.getState().parkCount).toBe(0);

      env.step(air, 1.0, 0.05);
      expect(air.hasCameraOverride).toBe(true);

      // Clearing mid-cut must immediately restore camera & never fire stale callback/signal.
      air.clear();
      expect(air.isGateStrikeActive).toBe(false);
      expect(air.hasCameraOverride).toBe(false);
      expect(env.getState().activeSeat).toBeNull();
      expect(env.getState().activeZoom).toBeNull();
      expect(env.getState().activeHudSeat).toBeNull();
      expect(env.getState().unparkCount).toBe(0);
      expect(env.player.parked).toBe(true);

      env.step(air, 4.0, 0.05);
      expect(onBreached).not.toHaveBeenCalled();
      expect(env.signals).toEqual([]);
    });
  });

  describe('Balanced 4-man friendly fireteam (dropWarrenSquads & advanceSquads)', () => {
    it('hovers gunships low with dust & fast-ropes, spawns 4 balanced soldiers (2 Alpha + 2 Bravo), paces behind player, advances through 4 stages & cleans up', () => {
      const env = makeFakeEnv();
      const air = new DesertAirAndSquads(env.ctx, env.runner, env.ui);

      air.startEscort();
      air.dropWarrenSquads();

      expect(air.gunshipMode).toBe('drop');
      expect(env.spawnedAllies).toHaveLength(4);
      expect(air.aliveFriendlies).toBe(4);

      // Verify 2 Alpha (west drop) + 2 Bravo (east drop), detached, postRadius = 8, lean HP.
      const westDrops = env.spawnedAllies.filter(a => a.body.position.x < 0);
      const eastDrops = env.spawnedAllies.filter(a => a.body.position.x > 0);
      expect(westDrops).toHaveLength(2);
      expect(eastDrops).toHaveLength(2);
      expect(env.spawnedAllies.map(a => a.type)).toEqual(['rifleman', 'shotgunner', 'medic', 'rifleman']);
      expect(env.spawnedAllies.every(a => a.detached)).toBe(true);
      expect(env.spawnedAllies.every(a => a.postRadius === SQUAD_POST_RADIUS)).toBe(true);
      expect(env.spawnedAllies.every(a => a.maxHealth === Math.round(150 * 0.85))).toBe(true);
      expect(env.spawnedAllies.every(a => Math.abs(a.body.position.z - DROP_ZONE.west[2]) < 5)).toBe(true);

      // Step into fast-rope hover window: gunships descend near y = 9 m, deploy ropes & kick up dust wash, still zero attacks.
      env.step(air, 1.8, 0.05);
      const gunshipRoots = env.scene.children.filter(c => c.name === 'desert_gunship');
      for (const g of gunshipRoots) {
        expect(g.position.y).toBeLessThan(10.5);
      }
      const ropeMeshes = env.scene.children.filter(
        c => c instanceof THREE.Mesh && c.geometry instanceof THREE.CylinderGeometry,
      );
      expect(ropeMeshes).toHaveLength(4);
      expect(ropeMeshes.every(r => r.visible)).toBe(true);
      expect(env.dustCalls.length).toBeGreaterThan(10);
      expect(env.tracers).toHaveLength(0);
      expect(env.damageBlasts).toHaveLength(0);

      // After hover window finishes, fast-ropes retract and gunships transition to high passive overwatch.
      env.step(air, 2.5, 0.05);
      expect(air.gunshipMode).toBe('overwatch');
      expect(ropeMeshes.every(r => !r.visible)).toBe(true);

      // Advance squads into Warren across west/center/east flank posts.
      air.advanceSquads('warren');
      expect(env.spawnedAllies.every(a => a.postRadius === SQUAD_POST_RADIUS)).toBe(true);
      expect(env.spawnedAllies.every(a => a.post.z >= 28 && a.post.z <= 38)).toBe(true);

      // Player pushes north to z = 10 -> Warren pacing holds fireteam ~10 m BEHIND player (+Z south), never outpacing.
      env.player.position.set(0, 0, 10);
      env.step(air, 2.0, 0.1);
      expect(env.spawnedAllies.every(a => a.post.z > env.player.position.z)).toBe(true);
      expect(env.spawnedAllies.every(a => a.post.z >= 16 && a.post.z <= 24)).toBe(true);

      // Simulate authentic casualty: aliveFriendlies tracks living count accurately.
      env.spawnedAllies[0]!.state = 'dead';
      expect(air.aliveFriendlies).toBe(3);

      // Stage 2: Pump Yard southern entrance.
      air.advanceSquads('pumpyard');
      const alive = env.spawnedAllies.filter(a => a.state !== 'dead' && a.body.alive);
      expect(alive).toHaveLength(3);
      for (const a of alive) {
        expect(a.post.z).toBeLessThanOrEqual(-10);
        expect(a.post.z).toBeGreaterThanOrEqual(-20);
        expect(a.postRadius).toBe(SQUAD_POST_RADIUS);
      }

      // Stage 3: High Terraces south flank posts (z = -80..-96).
      air.advanceSquads('terraces');
      for (const a of alive) {
        expect(a.post.z).toBeLessThanOrEqual(-80);
        expect(a.post.z).toBeGreaterThanOrEqual(-96);
      }

      // Stage 4: Salt Cave perimeter overwatch — strictly south of Salt Cave entrance (z = -148) & Cargo Plane (-208).
      air.advanceSquads('cave');
      for (const a of alive) {
        expect(a.post.z).toBeGreaterThan(HIGH_TERRACES.caveEntrancePos[2] + 8);
        expect(a.post.z).toBeLessThanOrEqual(-124);
      }

      // Calling dropWarrenSquads again does not duplicate squads.
      air.dropWarrenSquads();
      expect(env.spawnedAllies).toHaveLength(4);

      // Cleanup dismisses every squad member and zeroes aliveFriendlies.
      air.reset();
      expect(env.dismissedAllies).toHaveLength(4);
      expect(air.aliveFriendlies).toBe(0);
    });
  });

  describe('Scenic ending cutscene (startEndingCutscene)', () => {
    it('captured ending (11.8s): frames cuffed Quist < 6m in Phase 1, enforces setSeat every frame, cranes out in Phase 2, flattens Wall/Warren/PumpYard/HighTerraces while sparing Cargo Plane', () => {
      const env = makeFakeEnv({ playerParked: true });
      const air = new DesertAirAndSquads(env.ctx, env.runner, env.ui);
      const onDone = vi.fn();

      let convoyZ = 88;
      const getConvoyPos = vi.fn((out: THREE.Vector3) => out.set(0, 0, convoyZ));
      const getQuistBedPos = vi.fn((out: THREE.Vector3) => out.set(-0.56, 1.55, convoyZ - 2.22));
      const getTruckYaw = vi.fn(() => Math.PI);

      air.startEscort();
      air.startEndingCutscene(getConvoyPos, true, onDone, getQuistBedPos, getTruckYaw);

      expect(air.isEndingCutsceneActive).toBe(true);
      expect(air.hasCameraOverride).toBe(true);
      expect(env.getState().activeHudSeat).toBe(env.cinemaPanel);
      expect(env.getState().lastCaption).toContain('QUIST SECURED');

      // Phase 1 (0 .. 4.8 s): Close-up over the open truck bed framed tightly on cuffed Quist (< 6 m) looking north (-Z).
      const fillLights = env.scene.children.filter((c): c is THREE.PointLight => c instanceof THREE.PointLight);
      expect(fillLights).toHaveLength(1);

      const bedNow = new THREE.Vector3();
      const seatStart = env.getState().activeSeat!;
      getQuistBedPos(bedNow);
      expect(seatStart.position.distanceTo(bedNow)).toBeLessThan(6);
      expect(Number.isFinite(seatStart.position.x)).toBe(true);
      expect(Number.isFinite(seatStart.yaw)).toBe(true);
      expect(Number.isFinite(seatStart.pitch)).toBe(true);
      expect(Math.abs(seatStart.yaw)).toBeLessThan(0.75);
      expect(env.getState().activeZoom).toBeLessThanOrEqual(46);
      expect(fillLights[0]!.visible).toBe(true);
      expect(fillLights[0]!.intensity).toBeGreaterThan(1.5);

      const seatsBeforeWave1 = env.seatHistory.length;

      // Step through Wave 1 & Phase 1 (t = 0 -> 4.6 s): Warthogs strafe while camera stays tightly on Quist & re-asserts setSeat.
      for (let i = 0; i < 92; i++) {
        convoyZ += 0.55;
        env.step(air, 0.05, 0.05);
        const s = env.getState().activeSeat!;
        getQuistBedPos(bedNow);
        expect(s.position.distanceTo(bedNow)).toBeLessThan(6);
        expect(Number.isFinite(s.yaw)).toBe(true);
        expect(Number.isFinite(s.pitch)).toBe(true);
      }

      // setSeat was re-enforced every single frame (zero seat fighting).
      expect(env.seatHistory.length - seatsBeforeWave1).toBeGreaterThanOrEqual(92);
      expect(env.tracers.some(t => t.kind === 'heavy')).toBe(true);
      expect(env.sounds.some(s => s.id === 'warthog_flyby')).toBe(true);
      expect(env.damageBlasts.some(b => b.source === 'airstrike')).toBe(true);
      expect(onDone).not.toHaveBeenCalled();

      // Step through Wave 2 & Phase 2 crane-out (t = 4.6 -> 8.2 s): camera cranes smoothly back/up & bombs sweep High Terraces.
      for (let i = 0; i < 72; i++) {
        convoyZ += 0.55;
        env.step(air, 0.05, 0.05);
      }
      const seatMidPhase2 = env.getState().activeSeat!;
      expect(seatMidPhase2.position.y).toBeGreaterThan(7);
      expect(seatMidPhase2.position.z).toBeGreaterThan(convoyZ + 6);
      expect(fillLights[0]!.intensity).toBe(0);

      expect(env.tracers.some(t => t.kind === 'hellfire')).toBe(true);
      expect(env.napalmCalls.length).toBeGreaterThanOrEqual(6);
      expect(env.damageBlasts.some(b => b.source === 'nuke' && b.radius >= 50)).toBe(true);
      expect(env.nukeSweeps).toHaveLength(1);
      expect(env.nukeSweeps[0]!.center.z).toBe(ENDING_CUTSCENE.nukeSweepCenter[2]);
      expect(env.nukeSweeps[0]!.maxRadius).toBe(ENDING_CUTSCENE.nukeSweepRadius);

      // Verify destruction sweep hits Wall (z >= 50), Warren (0..45), Pump Yard (-20..-50) AND High Terraces (z <= -90).
      expect(env.damageBlasts.some(b => b.center.z >= 50)).toBe(true);
      expect(env.damageBlasts.some(b => b.center.z >= 0 && b.center.z <= 45)).toBe(true);
      expect(env.damageBlasts.some(b => b.center.z <= -20 && b.center.z >= -50)).toBe(true);
      expect(env.damageBlasts.some(b => b.center.z <= -90)).toBe(true);

      // CRITICAL INVARIANT: Cargo Plane (z = -208..-266) remains 100% clear of nukeSweep and every bomb radius!
      const nukeNorthEdge = env.nukeSweeps[0]!.center.z - env.nukeSweeps[0]!.maxRadius;
      expect(nukeNorthEdge).toBeGreaterThan(DESERT_Z.planeForecourt);
      for (const b of env.damageBlasts) {
        expect(b.center.z - b.radius).toBeGreaterThan(CARGO_PLANE.rampZ);
      }

      // Still active at t = 11.2 s (capturedDuration is 11.8 s), smoke & embers rising across ruins.
      const smokeBeforeWave3 = env.smokeCalls.length;
      const embersBeforeWave3 = env.emberCalls.length;
      for (let i = 0; i < 60; i++) {
        convoyZ += 0.4;
        env.step(air, 0.05, 0.05);
      }
      expect(air.isEndingCutsceneActive).toBe(true);
      expect(env.smokeCalls.length).toBeGreaterThan(smokeBeforeWave3 + 10);
      expect(env.emberCalls.length).toBeGreaterThan(embersBeforeWave3 + 10);

      // Complete remaining 0.8 s to pass 11.8 s -> finishes cleanly.
      for (let i = 0; i < 16; i++) {
        convoyZ += 0.4;
        env.step(air, 0.05, 0.05);
      }
      expect(air.isEndingCutsceneActive).toBe(false);
      expect(air.hasCameraOverride).toBe(false);
      expect(env.getState().activeSeat).toBeNull();
      expect(env.getState().activeZoom).toBeNull();
      expect(env.getState().activeHudSeat).toBeNull();
      expect(env.getState().lastCaption).toBe('');
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(env.signals).toEqual(['dr:ending_done']);
    });

    it('uncaptured ending (10.5s): starts in aerial chase camera behind convoy and completes at 10.5s', () => {
      const env = makeFakeEnv({ playerParked: true });
      const air = new DesertAirAndSquads(env.ctx, env.runner, env.ui);
      const onDone = vi.fn();

      let convoyZ = 92;
      air.startEscort();
      air.startEndingCutscene(out => out.set(0, 0, convoyZ), false, onDone);

      expect(env.getState().lastCaption).toContain('TARGET NEUTRALIZED');
      const seat = env.getState().activeSeat!;
      expect(seat.position.z).toBeGreaterThan(convoyZ + 15);
      expect(seat.position.y).toBeGreaterThan(7);
      expect(Math.abs(seat.yaw)).toBeLessThan(0.5);

      // Still active at 10.2 s
      for (let i = 0; i < 204; i++) {
        convoyZ += 0.35;
        env.step(air, 0.05, 0.05);
      }
      expect(air.isEndingCutsceneActive).toBe(true);

      // Completes by 10.6 s (> 10.5 s duration)
      for (let i = 0; i < 8; i++) {
        convoyZ += 0.35;
        env.step(air, 0.05, 0.05);
      }
      expect(air.isEndingCutsceneActive).toBe(false);
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(env.signals).toEqual(['dr:ending_done']);
    });

    it('restores camera, turns off fill light, stops loops/trails & cancels callback if clear() is called mid-ending', () => {
      const env = makeFakeEnv({ playerParked: false });
      const air = new DesertAirAndSquads(env.ctx, env.runner, env.ui);
      const onDone = vi.fn();

      air.startEndingCutscene(out => out.set(0, 0, 100), true, onDone);
      expect(env.getState().lastCaption).toContain('QUIST SECURED');
      env.step(air, 2.0, 0.05);
      expect(air.isEndingCutsceneActive).toBe(true);

      air.clear();
      expect(air.isEndingCutsceneActive).toBe(false);
      expect(air.hasCameraOverride).toBe(false);
      expect(env.getState().activeSeat).toBeNull();
      expect(env.getState().activeHudSeat).toBeNull();
      expect(env.getState().unparkCount).toBe(1);
      expect(env.loopStops.length).toBeGreaterThanOrEqual(1);
      expect(env.emitterStops.length).toBeGreaterThanOrEqual(1);

      const fillLights = env.scene.children.filter((c): c is THREE.PointLight => c instanceof THREE.PointLight);
      expect(fillLights.every(l => !l.visible && l.intensity === 0)).toBe(true);

      env.step(air, 10.0, 0.05);
      expect(onDone).not.toHaveBeenCalled();
      expect(env.signals).toEqual([]);
    });
  });
});
