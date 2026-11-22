import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { PhysicsSystem, RayHit } from '../../core/contracts';
import type { AiWorld } from '../aiWorld';
import {
  effectiveSoundRadius,
  isWeaponSuppressed,
  movementSoundRadius,
  SOUND_RADIUS,
  soundRadiusForShot,
  WALL_ATTENUATION,
} from './acoustics';
import { sense, STEALTH_SIGHT, stealthSightProfile } from './perception';
import { RANKS } from './rank';
import { Soldier } from './soldier';
import { STEALTH_TUNING, StealthDirector, type PatrolRoute } from './stealth';

/** Minimal physics mock with a solid wall along z = wallZ (extending in x). */
function wallPhysicsAtZ(wallZ: number): PhysicsSystem {
  const raycastInto = (o: THREE.Vector3, d: THREE.Vector3, max: number, _mask: number, out: RayHit): boolean => {
    if (Math.abs(d.z) < 1e-6) return false;
    const t = (wallZ - o.z) / d.z;
    if (t < 0 || t > max) return false;
    out.distance = t;
    return true;
  };
  return { raycastInto } as unknown as PhysicsSystem;
}

/** Open-air physics mock (no walls). */
function openPhysics(): PhysicsSystem {
  return { raycastInto: () => false } as unknown as PhysicsSystem;
}

/** Builds a minimal Soldier + AiWorld harness for pure-TS perception tests. */
function makePerceptionRig(opts: {
  guardPos: THREE.Vector3;
  guardYaw?: number;
  playerPos: THREE.Vector3;
  playerSpeed?: number;
  hasLos?: boolean;
}) {
  const s = new Soldier();
  s.rankDef = RANKS.regular;
  s.stage = 'peek';
  s.spot = null;
  s.notice = 0;
  s.sees = false;
  s.alertUntil = -99;
  s.knownAt = -99;
  const report = vi.fn();
  s.squad = { report } as unknown as Soldier['squad'];
  s.e = {
    position: opts.guardPos.clone(),
    yaw: opts.guardYaw ?? 0,
    hasLos: opts.hasLos ?? true,
  } as unknown as Soldier['e'];

  const w = {
    now: 10,
    player: {
      position: opts.playerPos.clone(),
      chest: opts.playerPos.clone().add(new THREE.Vector3(0, 1.2, 0)),
      speed: opts.playerSpeed ?? 0,
      alive: true,
    },
    enemies: {
      outpost: null,
    },
  } as unknown as AiWorld;

  return { s, w, report };
}

describe('acoustics', () => {
  it('makes crouch-walking completely silent (0 m) and scales other movement states', () => {
    expect(movementSoundRadius(5.5, true, false, false)).toBe(0);
    expect(movementSoundRadius(0, false, false, false)).toBe(0);
    expect(movementSoundRadius(4.0, false, false, false)).toBe(SOUND_RADIUS.walk);
    expect(movementSoundRadius(12.5, false, false, false)).toBe(SOUND_RADIUS.run);
    expect(movementSoundRadius(12.5, true, true, false)).toBe(SOUND_RADIUS.slide);
    expect(movementSoundRadius(18, false, false, true)).toBe(SOUND_RADIUS.dash);
  });

  it('returns tuned shot radii for suppressed light, suppressed heavy, unsuppressed, and melee', () => {
    expect(soundRadiusForShot('ultramag', true)).toBe(9);
    expect(soundRadiusForShot('gimlet', true)).toBe(9);
    expect(soundRadiusForShot('smg', true)).toBe(9);
    expect(soundRadiusForShot('rivet', true)).toBe(9);
    expect(soundRadiusForShot('autoraffica', true)).toBe(9);

    expect(soundRadiusForShot('awl', true)).toBe(14);
    expect(soundRadiusForShot('harrow', true)).toBe(14);

    expect(soundRadiusForShot('ultramag', false)).toBe(45);
    expect(soundRadiusForShot('awl', false)).toBe(45);
    expect(soundRadiusForShot('smg', false)).toBe(45);

    expect(soundRadiusForShot('knife', false)).toBe(SOUND_RADIUS.takedown);
  });

  it('detects inherently suppressed and suppressor-modded weapons', () => {
    expect(isWeaponSuppressed('autoraffica')).toBe(true);
    expect(isWeaponSuppressed('ultramag')).toBe(false);
    expect(isWeaponSuppressed('ultramag', new Set(['ultramagCan']))).toBe(true);
    expect(isWeaponSuppressed('gimlet', new Set(['gimletCan']))).toBe(true);
    expect(isWeaponSuppressed('awl', new Set(['awlCan']))).toBe(true);
    expect(isWeaponSuppressed('smg', new Set(['suppressor']))).toBe(true);
  });

  it('attenuates effective sound radius by ~0.42x when blocked by a solid wall', () => {
    const from = new THREE.Vector3(0, 0, 0);
    const to = new THREE.Vector3(0, 0, 8);

    const open = effectiveSoundRadius(openPhysics(), from, to, SOUND_RADIUS.suppressedLight);
    expect(open).toBe(9);

    const occluded = effectiveSoundRadius(wallPhysicsAtZ(4), from, to, SOUND_RADIUS.suppressedLight);
    expect(occluded).toBeCloseTo(9 * WALL_ATTENUATION, 5);
    expect(occluded).toBeCloseTo(3.78, 2);

    expect(effectiveSoundRadius(null, from, to, 14)).toBe(14);
  });
});

describe('light-aware perception', () => {
  it('computes dark, dim, bright, crouched, and flashlight sight profiles', () => {
    const dark = stealthSightProfile(0.06);
    expect(dark.range).toBeCloseTo(7.5, 4);
    expect(dark.fillScale).toBeCloseTo(0.25, 4);

    const dimMid = stealthSightProfile((0.12 + 0.5) / 2);
    expect(dimMid.range).toBeCloseTo((7.5 + 24) / 2, 3);
    expect(dimMid.fillScale).toBeCloseTo((0.25 + 0.75) / 2, 3);

    const bright = stealthSightProfile(0.9);
    expect(bright.range).toBeCloseTo(45, 4);
    expect(bright.fillScale).toBeCloseTo(1.15, 4);

    const crouchedDark = stealthSightProfile(0.06, true);
    expect(crouchedDark.range).toBeCloseTo(7.5 * STEALTH_SIGHT.crouchRangeMult, 4);
    expect(crouchedDark.fillScale).toBeCloseTo(0.25 * STEALTH_SIGHT.crouchFillMult, 4);

    // Inside narrow flashlight cone (facing = 1.0 >= cos(0.32)) extends dark range to 16 m.
    const beam = stealthSightProfile(0.06, false, 1.0, true);
    expect(beam.range).toBe(16);

    // Outside narrow flashlight cone (angle = 0.5 rad > 0.32 rad) stays at 7.5 m.
    const offBeam = stealthSightProfile(0.06, false, Math.cos(0.5), true);
    expect(offBeam.range).toBe(7.5);
  });

  it('drops dark sight range to ~7.5 m and fills 4x slower than legacy / ~4.6x slower than floodlight', () => {
    // Player 10 m ahead in darkness (lightLevel = 0.06): outside 7.5 m -> unseen!
    const darkFar = makePerceptionRig({
      guardPos: new THREE.Vector3(0, 0, 0),
      guardYaw: 0,
      playerPos: new THREE.Vector3(0, 0, 10),
    });
    sense(darkFar.s, darkFar.w, 0.2, { lightLevel: 0.06 });
    expect(darkFar.s.notice).toBe(0);

    // Same 10 m in floodlight (lightLevel = 0.9): clearly seen!
    const brightFar = makePerceptionRig({
      guardPos: new THREE.Vector3(0, 0, 0),
      guardYaw: 0,
      playerPos: new THREE.Vector3(0, 0, 10),
    });
    sense(brightFar.s, brightFar.w, 0.2, { lightLevel: 0.9 });
    expect(brightFar.s.notice).toBeGreaterThan(0.3);

    // Player 6 m ahead (within dark 7.5 m): compare fill rates between dark (0.06), legacy (omitted), and bright (0.9)
    const darkClose = makePerceptionRig({
      guardPos: new THREE.Vector3(0, 0, 0),
      guardYaw: 0,
      playerPos: new THREE.Vector3(0, 0, 6),
    });
    const legacyClose = makePerceptionRig({
      guardPos: new THREE.Vector3(0, 0, 0),
      guardYaw: 0,
      playerPos: new THREE.Vector3(0, 0, 6),
    });
    const brightClose = makePerceptionRig({
      guardPos: new THREE.Vector3(0, 0, 0),
      guardYaw: 0,
      playerPos: new THREE.Vector3(0, 0, 6),
    });

    sense(darkClose.s, darkClose.w, 0.1, { lightLevel: 0.06 });
    sense(legacyClose.s, legacyClose.w, 0.1);
    sense(brightClose.s, brightClose.w, 0.1, { lightLevel: 0.9 });

    expect(darkClose.s.notice).toBeGreaterThan(0);
    expect(legacyClose.s.notice / darkClose.s.notice).toBeCloseTo(4.0, 3);
    expect(brightClose.s.notice / darkClose.s.notice).toBeCloseTo(1.15 / 0.25, 3);
  });

  it('preserves 100% legacy behavior when lightLevel is omitted', () => {
    const rig = makePerceptionRig({
      guardPos: new THREE.Vector3(0, 0, 0),
      guardYaw: 0,
      playerPos: new THREE.Vector3(0, 0, 35),
    });
    for (let i = 0; i < 20; i++) {
      rig.w.now += 0.12;
      sense(rig.s, rig.w, 0.12);
    }
    expect(rig.s.sees).toBe(true);
    expect(rig.s.notice).toBe(1);
    expect(rig.report).toHaveBeenCalled();
  });
});

describe('StealthDirector four-state brain', () => {
  const patrol: PatrolRoute = {
    points: [
      { x: 0, y: 0, z: 0, yaw: 0, wait: 1.0 },
      { x: 10, y: 0, z: 0, yaw: Math.PI, wait: 1.0 },
    ],
    loop: true,
  };

  it('patrols -> investigates suspicious sound for 7.5 s -> returns to patrol when nothing found', () => {
    const dir = new StealthDirector();
    dir.register(1, 1, new THREE.Vector3(0, 0, 0), 0, 'Alpha-1');
    dir.register(2, 2, new THREE.Vector3(40, 0, 0), 0, 'Bravo-1');
    dir.assignPatrol(1, patrol);

    const out = new THREE.Vector3();
    expect(dir.getAgent(1)!.state).toBe('unaware');
    expect(dir.getDesiredMove(1, out)).toBe('patrol');

    // Soft impact sound 6 m away makes guard 1 suspicious without alerting squad 2.
    const lurePos = new THREE.Vector3(6, 0, 0);
    const heard = dir.hearSound(lurePos, SOUND_RADIUS.impact, false, openPhysics(), 1.0);
    expect(heard).toBe(1);
    expect(dir.getAgent(1)!.state).toBe('suspicious');
    expect(dir.getAgent(2)!.state).toBe('unaware');
    expect(dir.getDesiredMove(1, out)).toBe('investigate');
    expect(out.x).toBeCloseTo(6, 4);

    // Still investigating at 5.0 s (< 7.5 s)
    dir.update(5.0, 6.0, openPhysics());
    expect(dir.getAgent(1)!.state).toBe('suspicious');

    // Past 7.5 s with nothing found -> returns cleanly to unaware patrol!
    dir.update(3.0, 9.0, openPhysics());
    expect(dir.getAgent(1)!.state).toBe('unaware');
    expect(dir.getDesiredMove(1, out)).toBe('patrol');
  });

  it('occludes suppressed gunfire behind a wall so guard behind stone does not hear it', () => {
    const dir = new StealthDirector();
    dir.register(1, 1, new THREE.Vector3(0, 0, 6), 0);

    // Wall at z = 3 blocks 9 m suppressed shot at z = 0 -> effective radius 3.78 m < 6 m
    const blockedCount = dir.hearSound(new THREE.Vector3(0, 0, 0), SOUND_RADIUS.suppressedLight, false, wallPhysicsAtZ(3), 1);
    expect(blockedCount).toBe(0);
    expect(dir.getAgent(1)!.state).toBe('unaware');

    // Open air -> 9 m >= 6 m -> heard!
    const openCount = dir.hearSound(new THREE.Vector3(0, 0, 0), SOUND_RADIUS.suppressedLight, false, openPhysics(), 2);
    expect(openCount).toBe(1);
    expect(dir.getAgent(1)!.state).toBe('suspicious');
  });

  it('alerts only local squad, starts 3.5 s radio alarm call, aborts Lockdown on caller kill with 4 s cooldown, and triggers Lockdown if unstopped', () => {
    const dir = new StealthDirector();
    const onLockdown = vi.fn();
    const onInterrupted = vi.fn();
    dir.onLockdown = onLockdown;
    dir.onAlarmInterrupted = onInterrupted;

    // Local squad 1 (two guards) + distant squad 2 (50 m away)
    dir.register(1, 1, new THREE.Vector3(0, 0, 0), 0);
    dir.register(2, 1, new THREE.Vector3(5, 0, 0), 0);
    dir.register(3, 2, new THREE.Vector3(50, 0, 0), 0);

    // Full sight by guard 1 -> local squad 1 enters alert, squad 2 stays unaware
    dir.syncPerception(1, 1.0, true, new THREE.Vector3(0, 0, 8), 10);
    expect(dir.getAgent(1)!.state).toBe('alert');
    expect(dir.getAgent(2)!.state).toBe('alert');
    expect(dir.getAgent(3)!.state).toBe('unaware');
    expect(dir.lockdown).toBe(false);

    // One squad member designated as radio Alarm Caller (3.5 s)
    expect(dir.alarmCaller).not.toBeNull();
    expect(dir.alarmCaller!.mode).toBe('radio');
    expect(dir.alarmCaller!.duration).toBe(STEALTH_TUNING.alarmRadioSeconds);
    const firstCallerId = dir.alarmCaller!.enemyId;

    // Advance 2.0 s (< 3.5 s): still calling, no lockdown
    dir.update(2.0, 12.0, openPhysics());
    expect(dir.lockdown).toBe(false);
    expect(dir.alarmCaller).not.toBeNull();

    // Player kills the caller before 3.5 s -> Lockdown aborted, 4.0 s cooldown begins!
    dir.onGuardKilled(firstCallerId, 12.0);
    expect(dir.alarmCaller).toBeNull();
    expect(dir.lockdown).toBe(false);
    expect(onInterrupted).toHaveBeenCalledWith(firstCallerId);
    expect(onLockdown).not.toHaveBeenCalled();

    // During 4.0 s cooldown (at t = 15.0, only 3 s elapsed), survivor does NOT start calling yet
    dir.update(3.0, 15.0, openPhysics());
    expect(dir.alarmCaller).toBeNull();
    expect(dir.lockdown).toBe(false);

    // After 4.0 s cooldown (at t = 16.1), surviving squad member picks up the call
    dir.update(1.1, 16.1, openPhysics());
    expect(dir.alarmCaller).not.toBeNull();
    expect(dir.alarmCaller!.enemyId).not.toBe(firstCallerId);
    expect(dir.alarmCaller!.mode).toBe('radio');

    // Leave second caller unstopped for 3.5 s -> Lockdown triggers globally!
    dir.update(3.6, 19.7, openPhysics());
    expect(dir.lockdown).toBe(true);
    expect(dir.lockdownReason).toBe('radio');
    expect(onLockdown).toHaveBeenCalledWith('radio');
    // Distant squad 2 is now escalated to alert as well!
    expect(dir.getAgent(3)!.state).toBe('alert');
  });

  it('sends Alarm Caller to a nearby wall panel within 28 m and triggers Lockdown on arrival', () => {
    const dir = new StealthDirector();
    const onLockdown = vi.fn();
    dir.onLockdown = onLockdown;

    const panel = new THREE.Vector3(12, 0, 0);
    dir.setAlarmPanels(() => [panel]);
    dir.register(10, 1, new THREE.Vector3(0, 0, 0), 0);

    dir.onGuardDamaged(10, new THREE.Vector3(-4, 0, 0), 1.0);
    expect(dir.alarmCaller).not.toBeNull();
    expect(dir.alarmCaller!.mode).toBe('panel');
    expect(dir.alarmCaller!.targetPanel!.distanceTo(panel)).toBeLessThan(0.01);

    // Moving guard close to panel triggers Lockdown
    dir.syncBody(10, new THREE.Vector3(11.0, 0, 0), 0);
    dir.update(0.2, 1.2, openPhysics());
    expect(dir.lockdown).toBe(true);
    expect(onLockdown).toHaveBeenCalledWith('panel');
  });

  it('discovers corpses within 11 m in LOS (and ignores corpses occluded by walls)', () => {
    const dir = new StealthDirector();
    dir.register(1, 1, new THREE.Vector3(0, 0, 0), 0); // facing +Z
    dir.registerCorpse(new THREE.Vector3(0, 0, 9)); // 9 m ahead (< 11 m)

    // Wall at z = 4 blocks sight of corpse
    expect(dir.checkCorpses(wallPhysicsAtZ(4), 1.0)).toBe(0);
    expect(dir.getAgent(1)!.state).toBe('unaware');

    // Clear LOS -> discovers corpse -> local alert!
    expect(dir.checkCorpses(openPhysics(), 2.0)).toBe(1);
    expect(dir.getAgent(1)!.state).toBe('alert');
  });

  it('sends nearest guard to investigate when a light in their sector goes out without alerting distant squads', () => {
    const dir = new StealthDirector();
    dir.register(1, 1, new THREE.Vector3(0, 0, 0), 0);
    dir.register(2, 2, new THREE.Vector3(35, 0, 0), 0);

    const notified = dir.reportLightOut(new THREE.Vector3(8, 0, 0), 14, 1.0);
    expect(notified).toBe(1);
    expect(dir.getAgent(1)!.state).toBe('suspicious');
    expect(dir.getAgent(2)!.state).toBe('unaware');
  });

  it('builds a reusable HUD snapshot with relative directional awareness arcs and alarm countdown', () => {
    const dir = new StealthDirector();
    // Player at origin facing -Z (yaw = 0); guards spaced > 18 m apart so local alert stays on Guard 2.
    // Guard 1 ahead (-Z), Guard 2 to the right (+X), Guard 3 unaware with tiny notice (filtered out)
    dir.register(1, 1, new THREE.Vector3(0, 0, -10), 0);
    dir.register(2, 2, new THREE.Vector3(25, 0, 0), 0);
    dir.register(3, 3, new THREE.Vector3(-25, 0, 0), 0);

    dir.syncPerception(1, 0.5, false, new THREE.Vector3(0, 0, 0), 1.0);
    dir.syncPerception(2, 1.0, true, new THREE.Vector3(0, 0, 0), 1.0);
    dir.syncPerception(3, 0.04, false, new THREE.Vector3(0, 0, 0), 1.0);

    const playerPos = new THREE.Vector3(0, 0, 0);
    const snap1 = dir.getSnapshot(playerPos, 0, 0.2);
    expect(snap1.globalState).toBe('alert');
    expect(snap1.lightLevel).toBeCloseTo(0.2, 4);
    expect(snap1.lockdown).toBe(false);
    expect(snap1.alarmCountdown).toBeCloseTo(STEALTH_TUNING.alarmRadioSeconds, 2);
    expect(snap1.arcs).toHaveLength(2);

    const aheadArc = snap1.arcs.find(a => a.state === 'suspicious')!;
    const rightArc = snap1.arcs.find(a => a.state === 'alert')!;
    expect(aheadArc.angle).toBeCloseTo(0, 4);
    expect(aheadArc.fill).toBeCloseTo(0.5, 4);
    expect(aheadArc.callingAlarm).toBe(false);

    expect(rightArc.angle).toBeCloseTo(Math.PI / 2, 4);
    expect(rightArc.fill).toBe(1);
    expect(rightArc.callingAlarm).toBe(true);

    // Reusable snapshot object (zero per-frame alloc)
    const snap2 = dir.getSnapshot(playerPos, 0, 0.8);
    expect(snap2).toBe(snap1);
  });
});
