/**
 * Metal Storm Pod shoulder weapon plug-in & 3D model tests (`storm.ts`, `shoulder-storm.ts`).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Ctx, LoopHandle, PlayOptions, RayHit } from '../../core/contracts';
import type { MissileTarget, ShotSpec } from '../../core/gameplay';
import type { Ac130Rounds } from '../../progression/callins/ac130Rounds';
import type { MechKind } from '../../progression/callins/link';
import { ModelBuilder } from '../../progression/modelkit';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { PaintCandidate } from '../../weapons/swarm';
import type { Sight } from '../arms/types';
import { buildStormPod, SHOULDER_STORM } from '../models/shoulder-storm';
import { SHOULDER_MODELS } from '../models/shoulders';
import { dispatchShoulderRemoteNews } from './registry';
import {
  hasLineOfSight,
  STORM,
  STORM_PLUGIN,
  StormClock,
  StormShoulder,
  targetAimPoint,
} from './storm';
import type { ShoulderUpdateContext } from './types';

const DT = 1 / 60;

interface MutableTarget extends MissileTarget {
  alive: boolean;
}

const makeTarget = (x: number, y: number, z: number, extra: Partial<MissileTarget> = {}): MutableTarget => ({
  center: new THREE.Vector3(x, y, z),
  alive: true,
  ...extra,
});

interface RecordedRay {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  damage: number;
  tracer?: string;
  source: string;
}

interface MockLoop extends LoopHandle {
  id: string;
  stopped: boolean;
  pitches: number[];
  volumes: number[];
}

function makeHarness(opts: { wallCheck?: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => RayHit | null } = {}) {
  const rays: RecordedRay[] = [];
  const tracers: { from: THREE.Vector3; to: THREE.Vector3; kind: string }[] = [];
  const flashes: { pos: THREE.Vector3; dir: THREE.Vector3; kind: string }[] = [];
  const sparks: { pos: THREE.Vector3; count: number }[] = [];
  const lights: { pos: THREE.Vector3; intensity: number }[] = [];
  const sounds: { id: string; options?: PlayOptions }[] = [];
  const loops: MockLoop[] = [];
  const news: { kind: MechKind; values: number[] }[] = [];
  let trauma = 0;

  const ctx = {
    audio: {
      play: (id: string, options?: PlayOptions) => { sounds.push({ id, options }); },
      startLoop: (id: string) => {
        const loop: MockLoop = {
          id,
          stopped: false,
          pitches: [],
          volumes: [],
          get alive() { return !this.stopped; },
          setPitch(p: number) { this.pitches.push(p); },
          setVolume(v: number) { this.volumes.push(v); },
          setPosition() {},
          stop() { this.stopped = true; },
        };
        loops.push(loop);
        return loop;
      },
    },
    combat: {
      fireRay: (origin: THREE.Vector3, dir: THREE.Vector3, spec: ShotSpec) => {
        rays.push({
          origin: origin.clone(),
          dir: dir.clone(),
          damage: spec.damage,
          tracer: spec.tracer,
          source: spec.source,
        });
        if (spec.tracer) {
          tracers.push({
            from: (spec.tracerFrom ?? origin).clone(),
            to: origin.clone().addScaledVector(dir, 30),
            kind: spec.tracer,
          });
        }
        return { hitEnemy: true, headshot: false, killed: false, kills: 0, end: origin.clone().addScaledVector(dir, 30) };
      },
    },
    fx: {
      tracer: (from: THREE.Vector3, to: THREE.Vector3, kind: string) => {
        tracers.push({ from: from.clone(), to: to.clone(), kind });
      },
      muzzleFlash: (pos: THREE.Vector3, dir: THREE.Vector3, kind: string) => {
        flashes.push({ pos: pos.clone(), dir: dir.clone(), kind });
      },
      sparks: (pos: THREE.Vector3, _dir: THREE.Vector3, count: number) => {
        sparks.push({ pos: pos.clone(), count });
      },
      inhale: () => {},
    },
    camera: {
      addTrauma: (amount: number) => { trauma += amount; },
    },
    physics: {
      raycast: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) =>
        opts.wallCheck ? opts.wallCheck(origin, dir, maxDist) : null,
    },
    render: {
      lights: {
        flash: (pos: THREE.Vector3, _color: THREE.ColorRepresentation, intensity: number) => {
          lights.push({ pos: pos.clone(), intensity });
        },
      },
    },
  } as unknown as Ctx;

  const sight: Sight = {
    view: { position: new THREE.Vector3(0, 5, 0) } as Sight['view'],
    aim: new THREE.Vector3(0, 0, -1),
    point: new THREE.Vector3(0, 1.5, -40),
    range: 40,
  };
  const mount = new THREE.Vector3(1.5, 6.2, -0.5);
  const feet = new THREE.Vector3(0, 0, 0);

  const makeCtx = (
    candidates: readonly PaintCandidate[],
    held: boolean,
    pressed = false,
    online = true,
  ): ShoulderUpdateContext => ({
    ctx,
    rounds: {} as Ac130Rounds,
    slot: 0,
    keyLabel: 'G',
    cycleKeyLabel: '3',
    sight,
    mountPos: out => out.copy(mount),
    feet,
    torsoYaw: 0,
    held,
    pressed,
    cyclePressed: false,
    online,
    gatherTargets: () => candidates,
    onMissile: null,
    onNews: (kind, values) => { news.push({ kind, values }); },
    popFreeFlares: () => {},
  });

  return { ctx, mount, rays, tracers, flashes, sparks, lights, sounds, loops, news, getTrauma: () => trauma, makeCtx };
}

describe('StormClock — lock, charge, cancel, snapping burst, LOS skip, reload', () => {
  it('paints one distinct target every 0.5 s up to 8 targets and never stacks duplicates on one enemy', () => {
    const clock = new StormClock();
    const enemies = Array.from({ length: 10 }, (_, i) => makeTarget(i * 2 - 9, 1.5, -35));
    const view: PaintCandidate[] = enemies.map((target, i) => ({ target, angle: i * 0.01 }));
    const look = () => view;
    const clear = () => true;

    // Hold for 0.45 s: still 0 locks.
    for (let t = 0; t < 0.45; t += DT) clock.update(DT, true, look, clear);
    expect(clock.marks.length).toBe(0);
    expect(clock.charge).toBe(0);

    // Cross 0.5 s: first target locks.
    for (let t = 0; t < 0.1; t += DT) clock.update(DT, true, look, clear);
    expect(clock.marks).toEqual([enemies[0]]);

    // Hold through 5.0 s total: paints up to exactly 8 distinct targets in angle order, never exceeding 8.
    for (let t = 0; t < 4.5; t += DT) clock.update(DT, true, look, clear);
    expect(clock.marks.length).toBe(STORM.maxTargets);
    expect(clock.marks).toEqual(enemies.slice(0, 8));
    expect(new Set(clock.marks).size).toBe(8);
  });

  it('winds up a 0.7 s charge after the first lock and allows continued painting while charging and once charged', () => {
    const clock = new StormClock();
    const a = makeTarget(0, 1.5, -30);
    const b = makeTarget(3, 1.5, -30);
    const c = makeTarget(-3, 1.5, -30);
    let view: PaintCandidate[] = [{ target: a, angle: 0 }];
    const look = () => view;
    const clear = () => true;

    // 0.5 s locks target A; charge starts at 0.
    clock.update(0.5, true, look, clear);
    expect(clock.marks).toEqual([a]);
    expect(clock.charge).toBeCloseTo(0, 5);
    expect(clock.charged).toBe(false);

    // Hold 0.5 s more while sweeping onto B: B locks, charge is 0.5 s (< 0.7 s).
    view = [{ target: a, angle: 0.02 }, { target: b, angle: 0.01 }];
    clock.update(0.5, true, look, clear);
    expect(clock.marks).toEqual([a, b]);
    expect(clock.charge).toBeCloseTo(0.5, 5);
    expect(clock.charged).toBe(false);

    // Hold 0.2 s more: charge hits 0.7 s and triggers chargeReadyNow.
    clock.update(0.2, true, look, clear);
    expect(clock.charged).toBe(true);
    expect(clock.chargeReadyNow).toBe(true);

    // Keep holding another 0.5 s onto C: C locks even after fully charged!
    view = [{ target: c, angle: 0 }];
    clock.update(0.5, true, look, clear);
    expect(clock.marks).toEqual([a, b, c]);
    expect(clock.charged).toBe(true);
  });

  it('cancels cleanly without triggering reload when released before first lock or before 0.7 s charge completes', () => {
    const clock = new StormClock();
    const a = makeTarget(0, 1.5, -30);
    const look = () => [{ target: a, angle: 0 }];
    const clear = () => true;

    // Release before any lock (0.2 s).
    clock.update(0.2, true, look, clear);
    expect(clock.marks.length).toBe(0);
    clock.update(DT, false, look, clear);
    expect(clock.phase).toBe('ready');
    expect(clock.reloading).toBe(-1);
    expect(clock.slices.length).toBe(0);

    // Lock A (0.5 s), charge only 0.4 s (< 0.7 s), then release early.
    clock.update(0.5, true, look, clear);
    clock.update(0.4, true, look, clear);
    expect(clock.marks).toEqual([a]);
    expect(clock.charged).toBe(false);

    clock.update(DT, false, look, clear);
    expect(clock.cancelledNow).toBe(true);
    expect(clock.phase).toBe('ready');
    expect(clock.reloading).toBe(-1);
    expect(clock.marks.length).toBe(0);
    expect(clock.charge).toBe(0);
    expect(clock.slices.length).toBe(0);
  });

  it('supports single-target lock & dump (0.25 s, 120 rounds, 3600 damage) then 7.5 s reload', () => {
    const clock = new StormClock();
    const a = makeTarget(0, 1.5, -30);
    const look = () => [{ target: a, angle: 0 }];
    const clear = () => true;

    // Hold on single target A for 0.5 s lock + 0.7 s charge -> still only 1 mark!
    clock.update(0.5, true, look, clear);
    clock.update(0.7, true, look, clear);
    expect(clock.marks).toEqual([a]);
    expect(clock.charged).toBe(true);

    // Release and step at 60 fps until burst finishes.
    let rounds = 0;
    let burstTime = 0;
    let snaps = 0;
    while (clock.reloading < 0 && burstTime < 2) {
      clock.update(DT, false, look, clear);
      burstTime += DT;
      for (const s of clock.slices) {
        expect(s.target).toBe(a);
        rounds += s.rounds;
        if (s.snapped) snaps++;
      }
    }

    expect(snaps).toBe(1);
    expect(rounds).toBe(STORM.roundsPerTarget);
    expect(rounds * STORM.damagePerRound).toBe(3600);
    expect(burstTime).toBeCloseTo(STORM.burstPerTarget, 1);
    expect(clock.phase).toBe('reloading');
    expect(clock.reloading).toBeCloseTo(STORM.reload, 3);
    expect(clock.marks.length).toBe(0);

    // Holding during reload does nothing until 7.5 s elapses.
    let reloadTime = 0;
    while (clock.reloading >= 0 && reloadTime < 10) {
      clock.update(DT, true, look, clear);
      reloadTime += DT;
    }
    expect(reloadTime).toBeCloseTo(STORM.reload, 1);
    expect(clock.phase).toBe('ready');
  });

  it('snaps sequentially through painted targets in exact order painted (0.25 s, 120 rounds each)', () => {
    const clock = new StormClock();
    const t1 = makeTarget(-6, 1.5, -30);
    const t2 = makeTarget(0, 1.5, -30);
    const t3 = makeTarget(6, 1.5, -30);
    let view: PaintCandidate[] = [{ target: t1, angle: 0 }];
    const look = () => view;
    const clear = () => true;

    // Paint in order: t1 -> t2 -> t3.
    clock.update(0.5, true, look, clear);
    view = [{ target: t2, angle: 0 }];
    clock.update(0.5, true, look, clear);
    view = [{ target: t3, angle: 0 }];
    clock.update(0.5, true, look, clear);
    expect(clock.marks).toEqual([t1, t2, t3]);
    expect(clock.charged).toBe(true);

    const snapOrder: MissileTarget[] = [];
    const roundsPerTarget = new Map<MissileTarget, number>();
    let burstTime = 0;

    while (clock.reloading < 0 && burstTime < 3) {
      clock.update(DT, false, look, clear);
      burstTime += DT;
      for (const s of clock.slices) {
        if (s.snapped) snapOrder.push(s.target);
        roundsPerTarget.set(s.target, (roundsPerTarget.get(s.target) ?? 0) + s.rounds);
      }
    }

    expect(snapOrder).toEqual([t1, t2, t3]);
    expect(roundsPerTarget.get(t1)).toBe(120);
    expect(roundsPerTarget.get(t2)).toBe(120);
    expect(roundsPerTarget.get(t3)).toBe(120);
    expect(burstTime).toBeCloseTo(STORM.burstPerTarget * 3, 1);
    expect(clock.phase).toBe('reloading');
  });

  it('skips dead targets and targets without LOS at fire time immediately', () => {
    const clock = new StormClock();
    const deadBeforeFire = makeTarget(-8, 1.5, -30);
    const behindWall = makeTarget(-2, 1.5, -30);
    const visible = makeTarget(5, 1.5, -30);
    const alsoBlocked = makeTarget(10, 1.5, -30);

    let view: PaintCandidate[] = [{ target: deadBeforeFire, angle: 0 }];
    const look = () => view;
    clock.update(0.5, true, look, () => true);
    view = [{ target: behindWall, angle: 0 }];
    clock.update(0.5, true, look, () => true);
    view = [{ target: visible, angle: 0 }];
    clock.update(0.5, true, look, () => true);
    view = [{ target: alsoBlocked, angle: 0 }];
    clock.update(0.5, true, look, () => true);
    expect(clock.marks).toEqual([deadBeforeFire, behindWall, visible, alsoBlocked]);

    // Target 1 dies right as burst fires; Target 2 & 4 are behind walls.
    deadBeforeFire.alive = false;
    const canHit = (t: MissileTarget) => t === visible;

    const snapOrder: MissileTarget[] = [];
    let totalRounds = 0;
    let burstTime = 0;
    while (clock.reloading < 0 && burstTime < 3) {
      clock.update(DT, false, look, canHit);
      burstTime += DT;
      for (const s of clock.slices) {
        if (s.snapped) snapOrder.push(s.target);
        totalRounds += s.rounds;
      }
    }

    // Only `visible` was shot; total burst time is ~0.25 s (no wasted time on skipped targets!).
    expect(snapOrder).toEqual([visible]);
    expect(totalRounds).toBe(120);
    expect(burstTime).toBeCloseTo(STORM.burstPerTarget, 1);
  });
});

describe('StormShoulder & STORM_PLUGIN — Combat.fireRay batching, HUD, audio, silence/reset, co-op', () => {
  it('delivers 3600 damage per target via batched Combat.fireRay, caps visual tracers <= 4/frame, and emits co-op storm news', () => {
    const h = makeHarness();
    const weapon = STORM_PLUGIN.create(h.ctx) as StormShoulder;
    const t1 = makeTarget(-4, 1.5, -30);
    const t2 = makeTarget(4, 1.5, -30);

    // Paint t1 (0.5 s), then t2 (0.5 s), then finish charge (0.2 s more -> 0.7 s since first lock).
    weapon.update(0.5, h.makeCtx([{ target: t1, angle: 0 }], true, true));
    expect(weapon.marks).toEqual([t1]);

    // Charge loop starts once 1st target is locked.
    weapon.update(0.5, h.makeCtx([{ target: t2, angle: 0 }], true, false));
    expect(weapon.marks).toEqual([t1, t2]);
    const chargeLoop = h.loops.find(l => l.id === 'railgun_charge_loop');
    expect(chargeLoop).toBeDefined();
    expect(chargeLoop!.stopped).toBe(false);

    // Finish charge (0.2 s).
    weapon.update(0.2, h.makeCtx([{ target: t2, angle: 0 }], true, false));
    expect(h.sounds.some(s => s.id === 'railgun_ready')).toBe(true);
    expect(chargeLoop!.pitches.at(-1)!).toBeGreaterThan(1.3);

    // Release and step at 60 fps until reload starts.
    let maxTracersInAnyFrame = 0;
    let safety = 0;
    while (weapon.clock.phase !== 'reloading' && safety++ < 120) {
      const beforeTracers = h.tracers.length;
      weapon.update(DT, h.makeCtx([], false, false));
      const drawnThisFrame = h.tracers.length - beforeTracers;
      if (drawnThisFrame > maxTracersInAnyFrame) maxTracersInAnyFrame = drawnThisFrame;
    }

    // Exact total damage: 2 targets × 120 rounds × 30 dmg = 7200.
    const totalDamage = h.rays.reduce((sum, r) => sum + r.damage, 0);
    expect(totalDamage).toBe(7200);
    expect(h.rays.every(r => r.source === 'frame_storm')).toBe(true);
    // Visual tracers strictly capped at <= 4 per frame.
    expect(maxTracersInAnyFrame).toBeGreaterThanOrEqual(3);
    expect(maxTracersInAnyFrame).toBeLessThanOrEqual(STORM.maxTracersPerFrame);
    // Co-op news emitted once per snapped target with [mx, my, mz, tx, ty, tz].
    expect(h.news.length).toBe(2);
    expect(h.news[0]!.kind).toBe('storm');
    expect(h.news[0]!.values).toEqual([h.mount.x, h.mount.y, h.mount.z, t1.center.x, t1.center.y, t1.center.z]);
    expect(h.news[1]!.kind).toBe('storm');
    expect(h.news[1]!.values).toEqual([h.mount.x, h.mount.y, h.mount.z, t2.center.x, t2.center.y, t2.center.z]);
    // Both loops stopped cleanly after burst finishes.
    expect(chargeLoop!.stopped).toBe(true);
    const fireLoop = h.loops.find(l => l.id === 'minigun_fire_loop');
    expect(fireLoop).toBeDefined();
    expect(fireLoop!.stopped).toBe(true);
    expect(h.getTrauma()).toBeGreaterThan(0);
  });

  it('skips wall-occluded targets using real physics raycast LOS from mount', () => {
    const wallAt = (xDir: number) => xDir < 0;
    const h = makeHarness({
      wallCheck: (_origin, dir) =>
        wallAt(dir.x)
          ? { point: new THREE.Vector3(-2, 3, -15), normal: new THREE.Vector3(0, 0, 1), distance: 12, surface: 'concrete', collider: null }
          : null,
    });
    const blocked = makeTarget(-8, 1.5, -30);
    const open = makeTarget(8, 1.5, -30);

    expect(hasLineOfSight(h.ctx.physics, h.mount, blocked)).toBe(false);
    expect(hasLineOfSight(h.ctx.physics, h.mount, open)).toBe(true);

    // Vehicle with paintRadius 2.5 whose own hull hits at dist - 1.0 still passes LOS.
    const vehicle = makeTarget(8, 1.5, -30, { paintRadius: 2.5, aimLift: 1.0 });
    const aim = targetAimPoint(vehicle, new THREE.Vector3());
    expect(aim.y).toBe(2.5);
    const dist = aim.distanceTo(h.mount);
    const selfHitPhysics = {
      raycast: () => ({ point: aim.clone(), normal: new THREE.Vector3(0, 0, 1), distance: dist - 1.0, surface: 'metal' as const, collider: null }),
    };
    expect(hasLineOfSight(selfHitPhysics, h.mount, vehicle)).toBe(true);

    // Full shoulder run: paint blocked then open; on release blocked is skipped and only open is fired at.
    const weapon = STORM_PLUGIN.create(h.ctx) as StormShoulder;
    weapon.update(0.5, h.makeCtx([{ target: blocked, angle: 0 }], true, true));
    weapon.update(0.7, h.makeCtx([{ target: open, angle: 0 }], true, false));
    expect(weapon.marks).toEqual([blocked, open]);

    for (let i = 0; i < 30 && weapon.clock.phase !== 'reloading'; i++) {
      weapon.update(DT, h.makeCtx([], false, false));
    }

    expect(h.news.length).toBe(1);
    expect(h.news[0]!.values.slice(3)).toEqual([open.center.x, open.center.y, open.center.z]);
    expect(h.rays.reduce((sum, r) => sum + r.damage, 0)).toBe(3600);
  });

  it('fills HUD rows accurately across ready, locking, charging, locked, sweeping, reload, and offline states', () => {
    const h = makeHarness();
    const weapon = STORM_PLUGIN.create(h.ctx) as StormShoulder;
    const row: GunnerWeapon = { name: '', ammo: 0, max: 0, reload: -1 };
    const t1 = makeTarget(0, 1.5, -30);

    // Offline
    weapon.fillRow(row, 'V', '4', false);
    expect(row.name).toBe('V IRON STORM // OFFLINE');
    expect(row.ammo).toBe(0);
    expect(row.reload).toBe(-1);

    // Ready
    weapon.fillRow(row, 'G', '3', true);
    expect(row.name).toContain('G IRON STORM');
    expect(row.ammo).toBe(8);
    expect(row.max).toBe(8);
    expect(row.reload).toBe(-1);

    // Locking (before first lock)
    weapon.update(0.2, h.makeCtx([{ target: t1, angle: 0 }], true, true));
    weapon.fillRow(row, 'G', '3', true);
    expect(row.name).toContain('G IRON STORM');
    expect(row.name).toContain('LOCKING');

    // Charging (locked 1, charging 0.35 / 0.7 s)
    weapon.update(0.35, h.makeCtx([{ target: t1, angle: 0 }], true, false));
    weapon.update(0.35, h.makeCtx([{ target: t1, angle: 0 }], true, false));
    weapon.fillRow(row, 'G', '3', true);
    expect(row.name).toContain('CHARGING 1');
    expect(row.ammo).toBe(1);
    expect(row.reload).toBeCloseTo(0.5, 1);

    // Charged & ready to release
    weapon.update(0.4, h.makeCtx([{ target: t1, angle: 0 }], true, false));
    weapon.fillRow(row, 'G', '3', true);
    expect(row.name).toContain('LOCKED 1');

    // Sweeping (firing burst)
    weapon.update(DT, h.makeCtx([], false, false));
    weapon.fillRow(row, 'G', '3', true);
    expect(row.name).toContain('SWEEPING 1');

    // Reloading
    for (let i = 0; i < 30 && weapon.clock.phase !== 'reloading'; i++) {
      weapon.update(DT, h.makeCtx([], false, false));
    }
    weapon.update(STORM.reload * 0.5, h.makeCtx([], false, false));
    weapon.fillRow(row, 'G', '3', true);
    expect(row.name).toContain('RELOAD');
    expect(row.reload).toBeCloseTo(0.5, 1);
  });

  it('silence() stops active charge/fire loops immediately and reset() restores pristine ready state', () => {
    const h = makeHarness();
    const weapon = STORM_PLUGIN.create(h.ctx) as StormShoulder;
    const t1 = makeTarget(0, 1.5, -30);

    // Start charging loop.
    weapon.update(0.5, h.makeCtx([{ target: t1, angle: 0 }], true, true));
    weapon.update(0.2, h.makeCtx([{ target: t1, angle: 0 }], true, false));
    const chargeLoop = h.loops.find(l => l.id === 'railgun_charge_loop')!;
    expect(chargeLoop.stopped).toBe(false);

    weapon.silence();
    expect(chargeLoop.stopped).toBe(true);

    // Start firing loop, then reset().
    weapon.update(0.6, h.makeCtx([{ target: t1, angle: 0 }], true, false));
    weapon.update(DT, h.makeCtx([], false, false));
    const fireLoop = h.loops.find(l => l.id === 'minigun_fire_loop')!;
    expect(fireLoop.stopped).toBe(false);

    weapon.reset();
    expect(fireLoop.stopped).toBe(true);
    expect(weapon.clock.phase).toBe('ready');
    expect(weapon.marks.length).toBe(0);
    expect(weapon.clock.reloading).toBe(-1);
    expect(weapon.clock.charge).toBe(0);
  });

  it('plays capped golden-white tracer stream, flash, sparks, and 3D volley audio on remoteNews co-op playback', () => {
    const h = makeHarness();
    expect(STORM_PLUGIN.newsKinds).toEqual(['storm']);

    expect(dispatchShoulderRemoteNews(h.ctx, 'storm', [1, 6, 0, 2, 2, -40])).toBe(true);
    expect(h.tracers.length).toBe(STORM.remoteTracers);
    expect(h.tracers.every(t => t.kind === 'raufoss' || t.kind === 'carbine')).toBe(true);
    expect(h.flashes.length).toBe(1);
    expect(h.sparks.length).toBe(1);
    expect(h.lights.length).toBe(1);
    expect(h.sounds.some(s => s.id === 'metalstorm_volley' && s.options?.position !== undefined)).toBe(true);

    // Ignores wrong kind or malformed values safely.
    const countBefore = h.tracers.length;
    STORM_PLUGIN.remoteNews!(h.ctx, 'mirv', [1, 6, 0, 2, 2, -40]);
    STORM_PLUGIN.remoteNews!(h.ctx, 'storm', [1, 2, 3]);
    expect(h.tracers.length).toBe(countBefore);
  });

  it('handles offline transitions, dry-fire feedback, and idleUpdate reload progression cleanly', () => {
    const h = makeHarness();
    const weapon = STORM_PLUGIN.create(h.ctx) as StormShoulder;
    const t1 = makeTarget(0, 1.5, -30);

    // Paint & start charging, then knock mount offline -> cancels without triggering reload and stops charge loop.
    weapon.update(0.5, h.makeCtx([{ target: t1, angle: 0 }], true, true, true));
    weapon.update(0.2, h.makeCtx([{ target: t1, angle: 0 }], true, false, true));
    const chargeLoop = h.loops.find(l => l.id === 'railgun_charge_loop')!;
    expect(chargeLoop.stopped).toBe(false);

    weapon.update(DT, h.makeCtx([{ target: t1, angle: 0 }], true, false, false));
    expect(chargeLoop.stopped).toBe(true);
    expect(weapon.clock.phase).toBe('ready');
    expect(weapon.clock.reloading).toBe(-1);
    expect(weapon.marks.length).toBe(0);

    // Press while offline plays weapon_dry.
    const dryBefore = h.sounds.filter(s => s.id === 'weapon_dry').length;
    weapon.update(DT, h.makeCtx([], true, true, false));
    expect(h.sounds.filter(s => s.id === 'weapon_dry').length).toBe(dryBefore + 1);

    // Fire a full burst to enter 7.5 s reload, then press during reload -> weapon_dry, and finish reload via idleUpdate.
    weapon.update(0.5, h.makeCtx([{ target: t1, angle: 0 }], true, true, true));
    weapon.update(0.7, h.makeCtx([{ target: t1, angle: 0 }], true, false, true));
    weapon.update(0.25, h.makeCtx([], false, false, true));
    expect(weapon.clock.phase).toBe('reloading');

    const dryBeforeReload = h.sounds.filter(s => s.id === 'weapon_dry').length;
    weapon.update(DT, h.makeCtx([], true, true, true));
    expect(h.sounds.filter(s => s.id === 'weapon_dry').length).toBe(dryBeforeReload + 1);

    weapon.idleUpdate(STORM.reload);
    expect(weapon.clock.phase).toBe('ready');
    expect(weapon.clock.reloading).toBe(-1);
  });

  it('builds the sculpted 16-barrel Metal Storm Pod 3D model with valid solid and glow geometry', () => {
    expect(SHOULDER_STORM).toBe(buildStormPod);
    expect(SHOULDER_MODELS.storm).toBe(SHOULDER_STORM);
    const b = new ModelBuilder();
    SHOULDER_STORM(b);
    const solid = b.solidGeometry();
    const glow = b.glowGeometry();
    expect(solid).not.toBeNull();
    expect(glow).not.toBeNull();
    expect(solid!.getAttribute('position').count).toBeGreaterThan(500);
    expect(glow!.getAttribute('position').count).toBeGreaterThan(100);
    for (const geo of [solid!, glow!]) {
      const arr = geo.getAttribute('position').array as Float32Array;
      for (let i = 0; i < arr.length; i++) expect(Number.isFinite(arr[i]!)).toBe(true);
    }
  });
});
