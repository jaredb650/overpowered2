/** Unit tests for the Payday-style Bureau Thermal Lance Vault Drill & Planetary Vault Door (`drill.ts`). */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../../core/contracts';
import type { Enemy } from '../../enemies/Enemy';
import { DRILL_FLOOR_POS } from '../../world/map/bank/plan';
import {
  DRILL_C4_DAMAGE,
  DRILL_C4_DEFUSE_REWARD,
  DRILL_C4_FUSE,
  DRILL_DEFUSE_HOLD,
  DRILL_DURATION,
  DRILL_JAM_1,
  DRILL_JAM_2,
  DRILL_REBOOT_HOLD,
  DRILL_REBUILD_HOLD,
  DRILL_REBUILD_SURCHARGE,
  VAULT_OPEN_ANGLE,
  VAULT_OPEN_DURATION,
  VaultDrill,
} from './drill';

function makeDrillEnv() {
  let interactDown = false;
  let interactPressed = false;
  const signals: string[] = [];
  const feeds: string[] = [];
  const banners: string[] = [];
  const sounds: string[] = [];
  const awards: { points: number; reason: string }[] = [];
  const holds: number[] = [];
  const removedColliders: unknown[] = [];
  const loopStops: ReturnType<typeof vi.fn>[] = [];
  let nextColliderHandle = 1;

  const player = {
    alive: true,
    parked: false,
    position: new THREE.Vector3(DRILL_FLOOR_POS[0], DRILL_FLOOR_POS[1], DRILL_FLOOR_POS[2] + 1.5),
  };

  const ctx = {
    render: {
      scene: new THREE.Scene(),
      materials: { patch: <T>(m: T) => m },
      lights: { flash: vi.fn() },
    },
    physics: {
      addStaticBox: vi.fn(() => ({ handle: nextColliderHandle++ })),
      markNoClimb: vi.fn(),
      world: {
        removeCollider: vi.fn((c: unknown) => {
          removedColliders.push(c);
        }),
      },
    },
    input: {
      isDown: (action: string) => action === 'interact' && interactDown,
      pressed: (action: string) => action === 'interact' && interactPressed,
      labelFor: (action: string) => (action === 'interact' ? 'E' : ''),
    },
    audio: {
      has: () => true,
      play: (id: string) => {
        sounds.push(id);
      },
      startLoop: vi.fn(() => {
        const stop = vi.fn();
        loopStops.push(stop);
        return { alive: true, stop, setVolume: vi.fn(), setPitch: vi.fn(), setPosition: vi.fn() };
      }),
    },
    fx: {
      sparks: vi.fn(),
      smoke: vi.fn(),
      explosion: vi.fn(),
    },
    hud: {
      marker: vi.fn(() => vi.fn()),
      follow: vi.fn(() => vi.fn()),
      hold: (fill: number) => {
        holds.push(fill);
      },
      feed: (text: string) => {
        feeds.push(text);
      },
      banner: (text: string) => {
        banners.push(text);
      },
    },
    progression: {
      award: (points: number, reason: string) => {
        awards.push({ points, reason });
      },
    },
    camera: {
      addTrauma: vi.fn(),
    },
    player,
  } as unknown as Ctx;

  return {
    ctx,
    player,
    signals,
    feeds,
    banners,
    sounds,
    awards,
    holds,
    removedColliders,
    loopStops,
    onSignal: (sig: string) => signals.push(sig),
    setInteractDown: (v: boolean) => {
      interactDown = v;
    },
    tapInteract: () => {
      interactPressed = true;
    },
    clearFrameInput: () => {
      interactPressed = false;
    },
  };
}

function makeSaboteur(uid: number, x: number, y: number, z: number): Enemy {
  return {
    uid,
    alive: true,
    health: 100,
    position: new THREE.Vector3(x, y, z),
    moveTarget: new THREE.Vector3(),
    mode: 'flow',
    face: 'player',
    pace: 1,
    flowUntil: 5,
  } as unknown as Enemy;
}

describe('VaultDrill (Mission 4 Bank Run)', () => {
  it('runs full drill state machine: idle -> ready -> drilling -> jam1(35%) -> reboot -> jam2(72%) -> reboot -> opening -> open', () => {
    const env = makeDrillEnv();
    const drill = new VaultDrill(env.ctx, env.onSignal);

    expect(drill.state).toBe('idle');
    expect(drill.hasCollider).toBe(true);
    expect(drill.doorAngle).toBe(0);

    // Arm the vault door drill point
    drill.arm();
    expect(drill.state).toBe('ready');

    // Too far away to plant (10 m away)
    env.player.position.set(0, DRILL_FLOOR_POS[1], DRILL_FLOOR_POS[2] + 10);
    env.tapInteract();
    drill.update(0.1);
    env.clearFrameInput();
    expect(drill.state).toBe('ready');

    // Step within 3.2 m and press [E] to plant
    env.player.position.set(0, DRILL_FLOOR_POS[1], DRILL_FLOOR_POS[2] + 2.0);
    env.tapInteract();
    drill.update(0.1);
    env.clearFrameInput();
    expect(drill.state).toBe('drilling');
    expect(env.signals).toContain('bk:drill_planted');

    // Drill past 25% milestone -> triggers bk:drill_25
    for (let i = 0; i < 26; i++) drill.update(1.0);
    expect(env.signals).toContain('bk:drill_25');
    expect(drill.state).toBe('drilling');

    // Advance to 35% -> automatic Thermal Jam 1
    for (let i = 0; i < 12; i++) drill.update(1.0);
    expect(drill.state).toBe('jammed');
    expect(drill.progress).toBeCloseTo(DRILL_JAM_1, 3);
    expect(env.signals).toContain('bk:drill_jam1');

    // Progress stays stalled while jammed
    drill.update(5.0);
    expect(drill.progress).toBeCloseTo(DRILL_JAM_1, 3);

    // Partial hold then release resets hold progress
    env.setInteractDown(true);
    drill.update(1.0);
    expect(drill.holdProgress).toBeGreaterThan(0.4);
    env.setInteractDown(false);
    drill.update(0.1);
    expect(drill.holdProgress).toBe(0);

    // Hold [E] for full 2.2 s to reboot back into drilling
    env.setInteractDown(true);
    const rebootSteps = Math.ceil((DRILL_REBOOT_HOLD + 0.1) / 0.1);
    for (let i = 0; i < rebootSteps; i++) drill.update(0.1);
    env.setInteractDown(false);
    expect(drill.state).toBe('drilling');

    // Advance past 50% milestone to 72% -> automatic Thermal Jam 2
    for (let i = 0; i < 40; i++) drill.update(1.0);
    expect(env.signals).toContain('bk:drill_50');
    expect(drill.state).toBe('jammed');
    expect(drill.progress).toBeCloseTo(DRILL_JAM_2, 3);
    expect(env.signals).toContain('bk:drill_jam2');

    // Reboot Jam 2
    env.setInteractDown(true);
    for (let i = 0; i < rebootSteps; i++) drill.update(0.1);
    env.setInteractDown(false);
    expect(drill.state).toBe('drilling');

    // Advance through 75% milestone to 100% (28% of 95 s = 26.6 s) -> opening & collider removal
    for (let i = 0; i < 27; i++) drill.update(1.0);
    expect(env.signals).toContain('bk:drill_75');
    expect(env.signals).toContain('bk:drill_done');
    expect(drill.state).toBe('opening');
    expect(drill.hasCollider).toBe(false);
    expect(env.removedColliders.length).toBe(1);
    expect(Math.abs(drill.doorAngle)).toBeLessThan(Math.abs(VAULT_OPEN_ANGLE));

    // Animate 3.2 s vault door swing to -108° -> open
    const openSteps = Math.ceil((VAULT_OPEN_DURATION + 0.2) / 0.1);
    for (let i = 0; i < openSteps; i++) drill.update(0.1);
    expect(drill.state).toBe('open');
    expect(drill.doorAngle).toBeCloseTo(VAULT_OPEN_ANGLE, 3);

    drill.dispose();
  });

  it('tracks SWAT saboteurs, plants 6s C4, and awards +$500 on 1.4s player defusal', () => {
    const env = makeDrillEnv();
    const drill = new VaultDrill(env.ctx, env.onSignal);
    drill.startImmediate();

    // Register saboteur far away -> steered directly toward DRILL_FLOOR_POS
    const sapper = makeSaboteur(101, 6, DRILL_FLOOR_POS[1], DRILL_FLOOR_POS[2] + 8);
    drill.registerSaboteur(sapper);
    expect(drill.saboteurCount).toBe(1);

    drill.update(0.1);
    expect(sapper.mode).toBe('point');
    expect(sapper.moveTarget.x).toBeCloseTo(DRILL_FLOOR_POS[0], 3);
    expect(sapper.moveTarget.z).toBeCloseTo(DRILL_FLOOR_POS[2], 3);
    expect(drill.bombTimer).toBe(0);

    // Move saboteur within 2.5 m -> plants 6 s C4 and emits bk:saboteur_c4
    sapper.position.set(DRILL_FLOOR_POS[0] + 1.0, DRILL_FLOOR_POS[1], DRILL_FLOOR_POS[2] + 1.0);
    drill.update(0.1);
    expect(env.signals).toContain('bk:saboteur_c4');
    expect(drill.bombTimer).toBeCloseTo(DRILL_C4_FUSE - 0.1, 2);

    // Kill the saboteur so they stop chipping while player defuses
    sapper.alive = false;
    sapper.health = 0;

    // Hold [E] within 3.2 m for 1.4 s to defuse C4
    env.player.position.set(DRILL_FLOOR_POS[0], DRILL_FLOOR_POS[1], DRILL_FLOOR_POS[2] + 1.8);
    env.setInteractDown(true);
    const defuseSteps = Math.ceil((DRILL_DEFUSE_HOLD + 0.1) / 0.1);
    for (let i = 0; i < defuseSteps; i++) drill.update(0.1);
    env.setInteractDown(false);

    expect(drill.bombTimer).toBe(0);
    expect(drill.saboteurCount).toBe(0);
    expect(drill.state).toBe('drilling');
    expect(env.awards.some(a => a.points === DRILL_C4_DEFUSE_REWARD)).toBe(true);
    expect(env.feeds.some(f => f.includes('C4 DEFUSED'))).toBe(true);

    drill.dispose();
  });

  it('detonates undefused C4 for 55% integrity damage + jam, then handles broken rebuild with $2,500 surcharge and preserved progress', () => {
    const env = makeDrillEnv();
    const drill = new VaultDrill(env.ctx, env.onSignal);
    drill.startImmediate();

    // Advance drill to ~20% progress
    for (let i = 0; i < 19; i++) drill.update(1.0);
    const progressBeforeBlast = drill.progress;
    expect(progressBeforeBlast).toBeGreaterThan(0.18);

    // Saboteur plants C4 and dies so only C4 damage applies
    const sapper = makeSaboteur(202, DRILL_FLOOR_POS[0], DRILL_FLOOR_POS[1], DRILL_FLOOR_POS[2] + 1.2);
    drill.registerSaboteur(sapper);
    drill.update(0.05);
    sapper.alive = false;
    sapper.health = 0;
    expect(drill.bombTimer).toBeGreaterThan(5.8);

    // Let the 6 s fuse burn down without defusing
    for (let i = 0; i < 62; i++) drill.update(0.1);
    expect(drill.bombTimer).toBe(0);
    expect(drill.integrity).toBeCloseTo(100 - DRILL_C4_DAMAGE, 2);
    expect(drill.state).toBe('jammed');
    expect(env.ctx.fx.explosion).toHaveBeenCalled();
    expect(env.ctx.camera.addTrauma).toHaveBeenCalled();

    // Second C4/heavy blast drops integrity to 0% -> broken + $2,500 surcharge
    drill.damageDrill(DRILL_C4_DAMAGE, true);
    expect(drill.integrity).toBe(0);
    expect(drill.state).toBe('broken');
    expect(drill.surchargeTotal).toBe(DRILL_REBUILD_SURCHARGE);
    expect(env.feeds.some(f => f.includes('$2,500 BUREAU EQUIPMENT SURCHARGE'))).toBe(true);

    const savedProgress = drill.progress;
    expect(savedProgress).toBeGreaterThanOrEqual(progressBeforeBlast);

    // Hold [E] for 4.5 s to deploy spare Bureau drill -> resumes from saved progress!
    env.player.position.set(DRILL_FLOOR_POS[0], DRILL_FLOOR_POS[1], DRILL_FLOOR_POS[2] + 1.5);
    env.setInteractDown(true);
    const rebuildSteps = Math.ceil((DRILL_REBUILD_HOLD + 0.1) / 0.1);
    for (let i = 0; i < rebuildSteps; i++) drill.update(0.1);
    env.setInteractDown(false);

    expect(drill.state).toBe('drilling');
    expect(drill.integrity).toBe(100);
    expect(drill.progress).toBeGreaterThanOrEqual(savedProgress);

    drill.dispose();
  });

  it('supports forceOpen() for checkpoints and clean clear()/reset()', () => {
    const env = makeDrillEnv();
    const drill = new VaultDrill(env.ctx, env.onSignal);

    drill.startImmediate();
    drill.update(DRILL_DURATION * 0.1);
    expect(drill.progress).toBeGreaterThan(0.05);

    drill.forceOpen();
    expect(drill.state).toBe('open');
    expect(drill.hasCollider).toBe(false);
    expect(drill.doorAngle).toBeCloseTo(VAULT_OPEN_ANGLE, 3);

    drill.reset();
    expect(drill.state).toBe('idle');
    expect(drill.progress).toBe(0);
    expect(drill.integrity).toBe(100);
    expect(drill.bombTimer).toBe(0);
    expect(drill.doorAngle).toBe(0);
    expect(drill.hasCollider).toBe(true);

    drill.clear();
    expect(drill.hasCollider).toBe(false);

    drill.dispose();
  });

  it('prioritizes C4 defusal over jam reboot and applies passive saboteur chipping', () => {
    const env = makeDrillEnv();
    const drill = new VaultDrill(env.ctx, env.onSignal);
    drill.startImmediate();

    // Advance straight into Jam 1 (35%)
    for (let i = 0; i < 36; i++) drill.update(1.0);
    expect(drill.state).toBe('jammed');

    // Saboteur within plant reach plants C4, then stays within chip reach
    const sapper = makeSaboteur(303, DRILL_FLOOR_POS[0] + 0.5, DRILL_FLOOR_POS[1], DRILL_FLOOR_POS[2] + 0.5);
    drill.registerSaboteur(sapper);
    drill.update(0.1);
    expect(drill.bombTimer).toBeGreaterThan(5.5);

    // Next update chips drill integrity slowly while sapper stays close
    const intBefore = drill.integrity;
    drill.update(0.5);
    expect(drill.integrity).toBeLessThan(intBefore);

    // Kill sapper and hold [E] for 1.4 s -> defuses C4 first while staying jammed until rebooted
    sapper.alive = false;
    sapper.health = 0;
    env.player.position.set(DRILL_FLOOR_POS[0], DRILL_FLOOR_POS[1], DRILL_FLOOR_POS[2] + 1.5);
    env.setInteractDown(true);
    for (let i = 0; i < 15; i++) drill.update(0.1);
    env.setInteractDown(false);

    expect(drill.bombTimer).toBe(0);
    expect(drill.state).toBe('jammed');
    expect(env.awards.some(a => a.points === DRILL_C4_DEFUSE_REWARD)).toBe(true);

    drill.dispose();
  });
});
