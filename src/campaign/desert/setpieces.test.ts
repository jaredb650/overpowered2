/**
 * Unit tests for Mission 5 (Desert Raid) runtime setpieces & Hadrek Quist 5-outcome finale (`setpieces.ts`).
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx, PlayerDamage, WorldObjects } from '../../core/contracts';
import type { Enemy } from '../../enemies/Enemy';
import {
  CARGO_PLANE,
  LOUDSPEAKER_POLES,
  MAIN_GATE,
  PUMP_YARD,
} from '../../world/map/desert/plan';
import type { CampaignHud } from '../hud';
import type { MissionRunner } from '../runner';
import {
  DesertSetpieces,
  QUIST_CAPTURE_BONUS,
  QUIST_CAPTURE_HOLD,
  QUIST_GRENADE_WINDOW,
  QUIST_SPEECH_DURATION,
  QUIST_SUICIDE_DRAW,
  QUIST_SUICIDE_TEMPLE,
  TOWER_FALL_DURATION,
  TOWER_FLOOD_DURATION,
} from './setpieces';
import type { QuistHooks, QuistOutcome } from './types';

function makeSetpiecesEnv() {
  let interactDown = false;
  let interactPressed = false;
  let interactReleased = false;
  let elapsed = 0;
  let nextHandle = 100;

  const signals: string[] = [];
  const sounds: string[] = [];
  const feeds: string[] = [];
  const banners: string[] = [];
  const holds: number[] = [];
  const awards: { points: number; reason: string }[] = [];
  const removedColliders: RAPIER.Collider[] = [];
  const createdColliders: { collider: RAPIER.Collider; center: THREE.Vector3; half: THREE.Vector3; surface: string }[] = [];
  const playerLaunches: THREE.Vector3[] = [];
  const playerDamages: PlayerDamage[] = [];
  const lightFlashes: { pos: THREE.Vector3; color: THREE.ColorRepresentation; intensity: number }[] = [];
  const aliveEnemies: Enemy[] = [];
  const eventHandlers = new Map<string, ((payload: unknown) => void)[]>();

  const player = {
    alive: true,
    parked: false,
    health: 100,
    maxHealth: 100,
    position: new THREE.Vector3(0, 0, 80),
    velocity: new THREE.Vector3(),
    launch: vi.fn((v: THREE.Vector3) => {
      playerLaunches.push(v.clone());
      player.velocity.copy(v);
    }),
    push: vi.fn((v: THREE.Vector3) => {
      playerLaunches.push(v.clone());
      player.velocity.add(v);
    }),
    takeDamage: vi.fn((dmg: PlayerDamage) => {
      playerDamages.push(dmg);
      player.health = Math.max(0, player.health - dmg.amount);
      if (player.health <= 0) player.alive = false;
    }),
  };

  const objects: Partial<WorldObjects> = {
    colliderHitHandler: null,
    blastHandler: null,
  };

  const hush = vi.fn();

  const ctx = {
    time: {
      get elapsed() {
        return elapsed;
      },
    },
    events: {
      on: vi.fn((type: string, fn: (payload: unknown) => void) => {
        const list = eventHandlers.get(type) ?? [];
        list.push(fn);
        eventHandlers.set(type, list);
        return () => {
          const cur = eventHandlers.get(type);
          if (cur) {
            const idx = cur.indexOf(fn);
            if (idx >= 0) cur.splice(idx, 1);
          }
        };
      }),
    },
    render: {
      scene: new THREE.Scene(),
      materials: { patch: <T>(m: T) => m },
      lights: {
        flash: vi.fn((pos: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number) => {
          lightFlashes.push({ pos: pos.clone(), color, intensity });
        }),
      },
      decals: { add: vi.fn() },
      post: { chromatic: vi.fn(), radialBlur: vi.fn() },
    },
    physics: {
      addStaticBox: vi.fn((center: THREE.Vector3, half: THREE.Vector3, _rot: THREE.Quaternion | null, surface: string) => {
        const stub = {
          handle: nextHandle++,
          translation: { x: center.x, y: center.y, z: center.z },
          setTranslation(t: { x: number; y: number; z: number }) {
            stub.translation = { ...t };
          },
        };
        const collider = stub as unknown as RAPIER.Collider;
        createdColliders.push({ collider, center: center.clone(), half: half.clone(), surface });
        return collider;
      }),
      markNoClimb: vi.fn(),
      radialImpulse: vi.fn(),
      world: {
        removeCollider: vi.fn((col: RAPIER.Collider) => {
          removedColliders.push(col);
        }),
      },
    },
    world: { objects },
    input: {
      isDown: (action: string) => action === 'interact' && interactDown,
      pressed: (action: string) => action === 'interact' && interactPressed,
      released: (action: string) => action === 'interact' && interactReleased,
      labelFor: (action: string) => (action === 'interact' ? 'E' : ''),
    },
    audio: {
      play: vi.fn((id: string) => {
        sounds.push(id);
      }),
    },
    fx: {
      explosion: vi.fn(),
      sparks: vi.fn(),
      smoke: vi.fn(),
      embers: vi.fn(),
      dust: vi.fn(),
      chips: vi.fn(),
      ring: vi.fn(),
      muzzleFlash: vi.fn(),
      bloodHit: vi.fn(),
      bloodMist: vi.fn(),
    },
    hud: {
      marker: vi.fn(() => vi.fn()),
      follow: vi.fn(() => vi.fn()),
      hold: vi.fn((fill: number) => {
        holds.push(fill);
      }),
      feed: vi.fn((text: string) => {
        feeds.push(text);
      }),
      banner: vi.fn((text: string) => {
        banners.push(text);
      }),
      hitMarker: vi.fn(),
    },
    progression: {
      award: vi.fn((points: number, reason: string) => {
        awards.push({ points, reason });
      }),
    },
    camera: {
      addTrauma: vi.fn(),
      kick: vi.fn(),
    },
    enemies: {
      alive: aliveEnemies,
    },
    player,
  } as unknown as Ctx;

  const runner = {
    signal: vi.fn((sig: string) => {
      signals.push(sig);
    }),
  } as unknown as MissionRunner;

  const ui = {
    el: null,
    hush,
  } as unknown as CampaignHud;

  const setpieces = new DesertSetpieces(ctx, runner, ui);

  const lines: { key: string; now?: boolean }[] = [];
  const outcomes: QuistOutcome[] = [];
  const doorSlams: ('plane.door1' | 'plane.door2')[] = [];
  const hooks: QuistHooks = {
    onLine: (key, opts) => lines.push({ key, now: opts?.now }),
    onOutcome: outcome => outcomes.push(outcome),
    onDoorSlam: doorId => doorSlams.push(doorId),
  };

  const step = (seconds: number, dt = 0.05) => {
    let left = seconds;
    while (left > 1e-9) {
      const slice = Math.min(dt, left);
      elapsed += slice;
      setpieces.update(slice);
      interactPressed = false;
      interactReleased = false;
      left -= slice;
    }
  };

  return {
    ctx,
    runner,
    ui,
    hush,
    setpieces,
    player,
    objects,
    hooks,
    signals,
    sounds,
    feeds,
    banners,
    holds,
    awards,
    lines,
    outcomes,
    doorSlams,
    createdColliders,
    removedColliders,
    playerLaunches,
    playerDamages,
    lightFlashes,
    aliveEnemies,
    step,
    setInteractDown: (v: boolean) => {
      interactDown = v;
    },
    pressInteract: () => {
      interactPressed = true;
      interactDown = true;
    },
    releaseInteract: () => {
      interactDown = false;
      interactReleased = true;
    },
    singleFrameTapInteract: () => {
      interactPressed = true;
      interactDown = false;
    },
  };
}

describe('DesertSetpieces (Mission 5 — Desert Raid)', () => {
  // -----------------------------------------------------------------------------------------------
  // 1. Loudspeaker Poles
  // -----------------------------------------------------------------------------------------------

  it('builds all loudspeaker poles and pulses the nearest pole with expanding audio-wave rings', () => {
    const env = makeSetpiecesEnv();
    env.setpieces.ensureBuilt();

    expect(env.setpieces.loudspeakerCount).toBe(LOUDSPEAKER_POLES.length);
    expect(env.setpieces.activeWaveRingCount).toBe(0);

    // Place player right beside pole index 5 ([18, 0, -28])
    env.player.position.set(17, 0, -27);
    env.setpieces.pulseLoudspeaker();

    expect(env.setpieces.lastPulsedPoleIndex).toBe(5);
    expect(env.setpieces.activeWaveRingCount).toBe(3);
    expect(env.lightFlashes.length).toBeGreaterThan(0);

    // Advance past ring lifetime (0.44 delay + 0.95 duration = 1.39 s)
    env.step(1.6, 0.1);
    expect(env.setpieces.activeWaveRingCount).toBe(0);

    // Move player beside pole index 0 ([-22, 0, 56]) and pulse again
    env.player.position.set(-21, 0, 55);
    env.setpieces.pulseLoudspeaker();
    expect(env.setpieces.lastPulsedPoleIndex).toBe(0);
    expect(env.setpieces.activeWaveRingCount).toBe(3);
  });

  // -----------------------------------------------------------------------------------------------
  // 2. Solid Bulldozer-Blade Main Gate
  // -----------------------------------------------------------------------------------------------

  it('sparks metallic ricochets on gunshots and shatters Main Gate cleanly on Warthog strike', () => {
    const env = makeSetpiecesEnv();
    env.setpieces.ensureBuilt();

    const gateCol = env.setpieces.mainGateCollider;
    expect(gateCol).not.toBeNull();
    expect(env.setpieces.gateBreached).toBe(false);

    // Verify collider sits at MAIN_GATE with 'metal' surface
    const gateEntry = env.createdColliders.find(c => c.collider === gateCol)!;
    expect(gateEntry.surface).toBe('metal');
    expect(gateEntry.center.x).toBe(MAIN_GATE.x);
    expect(gateEntry.center.z).toBe(MAIN_GATE.z);

    // Shooting the main gate sparks ricochets and does NOT breach it
    const handled = env.objects.colliderHitHandler?.(gateCol!, 45, 'smg');
    expect(handled).toBe(true);
    expect(env.setpieces.gateBreached).toBe(false);
    expect(env.setpieces.gateRicochetCount).toBe(1);
    expect(env.sounds).toContain('ricochet');
    expect(env.ctx.fx.sparks).toHaveBeenCalled();

    // Warthog strike shatters the gate & removes physics collider
    env.setpieces.shatterMainGate();
    expect(env.setpieces.gateBreached).toBe(true);
    expect(env.setpieces.mainGateCollider).toBeNull();
    expect(env.removedColliders).toContain(gateCol);
    expect(env.sounds).toContain('explosion_tank');
    expect(env.ctx.camera.addTrauma).toHaveBeenCalled();

    // Debris settles cleanly over time
    env.step(2.0, 0.1);

    // Reset restores intact gate + fresh collider
    env.setpieces.reset();
    expect(env.setpieces.gateBreached).toBe(false);
    expect(env.setpieces.mainGateCollider).not.toBeNull();
  });

  // -----------------------------------------------------------------------------------------------
  // 3. Pump Yard Water Tower Collapse, Street Rubble Blocker, Flood & Sewer Beacon
  // -----------------------------------------------------------------------------------------------

  it('drops Water Tower when player crosses z = -28, seals z = -52, surges flood knockback & signals dr:tower_dropped', () => {
    const env = makeSetpiecesEnv();
    env.setpieces.ensureBuilt();
    env.setpieces.armWaterTower();

    // Add a Saltblood enemy in the Pump Yard to verify enemy flood knockback
    const saltblood = {
      uid: 77,
      alive: true,
      position: new THREE.Vector3(2, 0, -34),
      velocity: new THREE.Vector3(),
    } as unknown as Enemy;
    env.aliveEnemies.push(saltblood);

    // South of trigger line (z = -24): tower stays standing
    env.player.position.set(0, 0, -24);
    env.step(0.2);
    expect(env.setpieces.towerDropped).toBe(false);
    expect(env.signals).not.toContain('dr:tower_dropped');

    // Cross north of z = -28: triggers explosive squibs & 1.8 s collapse
    env.player.position.set(0, 0, -30);
    env.step(0.1);
    expect(env.setpieces.towerDropped).toBe(true);
    expect(env.setpieces.isTowerImpacted).toBe(false);
    expect(env.sounds).toContain('explosion_small');
    expect(env.sounds).toContain('metal_groan');
    expect(env.setpieces.rubbleColliderCount).toBe(0);

    // Advance through the 1.8 s fall to impact
    env.step(TOWER_FALL_DURATION, 0.05);
    expect(env.setpieces.isTowerImpacted).toBe(true);
    expect(env.setpieces.rubbleColliderCount).toBeGreaterThanOrEqual(3);
    expect(env.setpieces.isFloodActive).toBe(true);
    expect(env.setpieces.isSewerBeaconOn).toBe(true);
    expect(env.signals).toContain('dr:tower_dropped');
    expect(env.sounds).toContain('crusher_slam');
    expect(env.sounds).toContain('steam_burst');

    // Verify permanent rubble blocker colliders sit across PUMP_YARD.blockedStreetCenter (z = -52)
    const rubbleAtStreet = env.createdColliders.filter(
      c => Math.abs(c.center.z - PUMP_YARD.blockedStreetCenter[2]) < 1.0,
    );
    expect(rubbleAtStreet.length).toBeGreaterThanOrEqual(3);

    // Advance flood wave south past player (z = -30) and enemy (z = -34) -> both get knocked back!
    env.step(TOWER_FLOOD_DURATION, 0.05);
    expect(env.playerLaunches.length).toBeGreaterThan(0);
    expect(env.playerLaunches[0]!.z).toBeGreaterThan(5);
    expect(saltblood.velocity.z).toBeGreaterThan(5);
    expect(env.setpieces.isFloodActive).toBe(false);
  });

  // -----------------------------------------------------------------------------------------------
  // 4. Hadrek Quist Phase A — Cowardly Retreat Inside Cargo Plane
  // -----------------------------------------------------------------------------------------------

  it('runs Quist Phase A bulkhead retreat: ramp -> door1 slam -> mid -> door2 slam -> tail speech', () => {
    const env = makeSetpiecesEnv();
    env.setpieces.startPlaneChase(env.hooks);

    expect(env.setpieces.quistState).toBe('wait_ramp');
    expect(env.setpieces.quistPosition.z).toBeCloseTo(CARGO_PLANE.quistWaitPos[2], 2);

    // Player enters cargo ramp (z < -88)
    env.player.position.set(0, CARGO_PLANE.floorY, -89);
    env.step(0.05);
    expect(env.doorSlams).toEqual(['plane.door1']);
    expect(env.setpieces.quistState).toBe('sprint_mid');

    // Let Quist finish sprinting to mid hold position
    env.step(3.0, 0.1);
    expect(env.setpieces.quistState).toBe('wait_mid');
    expect(env.setpieces.quistPosition.z).toBeCloseTo(CARGO_PLANE.quistMidPos[2], 1);

    // Player breaches door 1 and pushes past z < -108
    env.player.position.set(0, CARGO_PLANE.floorY, -109);
    env.step(0.05);
    expect(env.doorSlams).toEqual(['plane.door1', 'plane.door2']);
    expect(env.setpieces.quistState).toBe('sprint_tail');

    // Let Quist reach the tail corner
    env.step(2.0, 0.1);
    expect(env.setpieces.quistState).toBe('wait_tail');
    expect(env.setpieces.quistPosition.z).toBeCloseTo(CARGO_PLANE.quistCornerPos[2], 1);

    // Player enters tail section (z < -117) -> starts 17.5 s speech & fires beat 1
    env.player.position.set(0, CARGO_PLANE.floorY, -118);
    env.step(0.05);
    expect(env.setpieces.quistState).toBe('speech');
    expect(env.lines.some(l => l.key === 'quist.speech.1')).toBe(true);
  });

  // -----------------------------------------------------------------------------------------------
  // 5A. Quist Outcome 1 — Hold [E] for 1.5 s (within 3.8 m) -> Captured (+$2,500)
  // -----------------------------------------------------------------------------------------------

  it('Outcome 1: Hold [E] for 1.5 s within 3.8 m captures Quist alive for +$2,500 bonus', () => {
    const env = makeSetpiecesEnv();
    env.setpieces.startPlaneChase(env.hooks);
    env.setpieces.advanceQuistToTail();
    expect(env.setpieces.quistState).toBe('speech');

    // Outside capture range (5.5 m away): holding [E] does NOT capture
    env.player.position.set(0, CARGO_PLANE.floorY, CARGO_PLANE.quistCornerPos[2] + 5.5);
    env.pressInteract();
    env.step(2.0, 0.1);
    expect(env.setpieces.quistOutcome).toBeNull();
    expect(env.setpieces.captureProgress).toBe(0);
    env.releaseInteract();

    // Move within 3.8 m (2.5 m away) and hold [E] for 1.5 s
    env.player.position.set(0, CARGO_PLANE.floorY, CARGO_PLANE.quistCornerPos[2] + 2.5);
    env.pressInteract();
    env.step(QUIST_CAPTURE_HOLD * 0.5, 0.05);
    expect(env.setpieces.quistOutcome).toBeNull();
    expect(env.setpieces.captureProgress).toBeGreaterThan(0.4);

    env.step(QUIST_CAPTURE_HOLD * 0.6, 0.05);
    expect(env.setpieces.quistOutcome).toBe('captured');
    expect(env.setpieces.quistState).toBe('captured');
    expect(env.outcomes).toEqual(['captured']);
    expect(env.signals).toContain('dr:quist_done');
    expect(env.lines.some(l => l.key === 'quist.captured' && l.now === true)).toBe(true);
    expect(env.awards).toContainEqual({ points: QUIST_CAPTURE_BONUS, reason: 'HADREK QUIST CAPTURED' });
    expect(env.sounds).toContain('cuff_click');
  });

  // -----------------------------------------------------------------------------------------------
  // 5B. Quist Outcome 2 — Tap [E] (< 0.4 s, within 14 m) -> Cycles Replies Without Aborting Speech
  // -----------------------------------------------------------------------------------------------

  it('Outcome 2: Tap [E] (< 0.4 s, within 14 m) cycles interactive draft replies without aborting speech clock', () => {
    const env = makeSetpiecesEnv();
    env.setpieces.startPlaneChase(env.hooks);
    env.setpieces.advanceQuistToTail();

    // Stand 6 m away (within 14 m talk range, outside 3.8 m capture range)
    env.player.position.set(0, CARGO_PLANE.floorY, CARGO_PLANE.quistCornerPos[2] + 6.0);

    // Tap 1: press for 0.15 s (< 0.4 s) then release
    env.pressInteract();
    env.step(0.15, 0.05);
    env.releaseInteract();
    env.step(0.05, 0.05);

    expect(env.lines.filter(l => l.key === 'quist.reply.1' && l.now === true)).toHaveLength(1);
    expect(env.setpieces.quistState).toBe('speech');
    expect(env.setpieces.quistOutcome).toBeNull();

    // Tap 2: single-frame tap
    env.singleFrameTapInteract();
    env.step(0.05, 0.05);
    expect(env.lines.filter(l => l.key === 'quist.reply.2' && l.now === true)).toHaveLength(1);

    // Speech clock kept running uninterrupted and still delivers all 4 beats
    env.step(13.5, 0.1);
    expect(env.setpieces.speechElapsed).toBeGreaterThan(13.5);
    expect(env.lines.some(l => l.key === 'quist.speech.2')).toBe(true);
    expect(env.lines.some(l => l.key === 'quist.speech.3')).toBe(true);
    expect(env.lines.some(l => l.key === 'quist.speech.4')).toBe(true);
  });

  // -----------------------------------------------------------------------------------------------
  // 5C. Quist Outcome 3 — Shoot / Damage Mid-Speech -> Killed Immediately
  // -----------------------------------------------------------------------------------------------

  it('Outcome 3: shooting Quist mid-speech cuts off speech and kills him immediately', () => {
    const env = makeSetpiecesEnv();
    env.setpieces.startPlaneChase(env.hooks);
    env.setpieces.advanceQuistToTail();
    env.player.position.set(0, CARGO_PLANE.floorY, CARGO_PLANE.quistCornerPos[2] + 5.0);
    env.step(2.0, 0.1);

    const quistCol = env.setpieces.quistHitCollider;
    expect(quistCol).not.toBeNull();

    // Shoot Quist's tracked collider through WorldObjects colliderHitHandler
    const handled = env.objects.colliderHitHandler?.(quistCol!, 35, 'ultramag');
    expect(handled).toBe(true);

    expect(env.setpieces.quistOutcome).toBe('killed');
    expect(env.setpieces.quistState).toBe('dead');
    expect(env.hush).toHaveBeenCalled();
    expect(env.outcomes).toEqual(['killed']);
    expect(env.signals).toContain('dr:quist_done');
    expect(env.ctx.fx.bloodHit).toHaveBeenCalled();
    expect(env.setpieces.quistHitCollider).toBeNull();
  });

  it('Outcome 3 (blast): explosion near cornered Quist kills him cleanly via blastHandler', () => {
    const env = makeSetpiecesEnv();
    env.setpieces.startPlaneChase(env.hooks);
    env.setpieces.advanceQuistToTail();

    env.objects.blastHandler?.(
      new THREE.Vector3(CARGO_PLANE.quistCornerPos[0], CARGO_PLANE.floorY + 0.5, CARGO_PLANE.quistCornerPos[2] + 1.5),
      5.0,
      140,
      'satchel',
    );

    expect(env.setpieces.quistOutcome).toBe('killed');
    expect(env.outcomes).toEqual(['killed']);
    expect(env.signals).toContain('dr:quist_done');
  });

  // -----------------------------------------------------------------------------------------------
  // 5D. Quist Outcome 4 — Speech Ends & Player Within 8 m -> 1.5 s Grenade Warning + Blast / Interrupt
  // -----------------------------------------------------------------------------------------------

  it('Outcome 4a: speech finishes within 8 m -> 1.5 s red-glint GRENADE warning -> lethal close detonation (grenade_killed)', () => {
    const env = makeSetpiecesEnv();
    env.setpieces.startPlaneChase(env.hooks);
    env.setpieces.advanceQuistToTail();

    // Stand 2.2 m away (within 8 m trigger & lethal close blast radius)
    env.player.position.set(0, CARGO_PLANE.floorY, CARGO_PLANE.quistCornerPos[2] + 2.2);

    // Run speech to completion (17.5 s)
    env.step(QUIST_SPEECH_DURATION, 0.1);
    expect(env.setpieces.quistState).toBe('grenade_warning');
    expect(env.setpieces.quistOutcome).toBeNull();
    expect(env.lines.some(l => l.key === 'quist.end.grenade' && l.now === true)).toBe(true);
    expect(env.sounds).toContain('grenade_pin');
    expect(env.banners).toContain('WARNING: GRENADE!');

    // Wait 1.5 s without shooting or running -> detonates lethally
    env.step(QUIST_GRENADE_WINDOW + 0.05, 0.05);
    expect(env.setpieces.quistOutcome).toBe('grenade_killed');
    expect(env.setpieces.quistState).toBe('dead');
    expect(env.player.alive).toBe(false);
    expect(env.playerDamages.length).toBe(1);
    expect(env.playerLaunches.length).toBeGreaterThan(0);
    expect(env.outcomes).toEqual(['grenade_killed']);
    expect(env.signals).toContain('dr:quist_done');
  });

  it('Outcome 4b: player sprints out of blast range during 1.5 s grenade window -> grenade_survived', () => {
    const env = makeSetpiecesEnv();
    env.setpieces.startPlaneChase(env.hooks);
    env.setpieces.advanceQuistToTail();

    // Stand 5.5 m away when speech ends -> triggers grenade warning
    env.player.position.set(0, CARGO_PLANE.floorY, CARGO_PLANE.quistCornerPos[2] + 5.5);
    env.step(QUIST_SPEECH_DURATION, 0.1);
    expect(env.setpieces.quistState).toBe('grenade_warning');

    // Player dives back to 9 m (beyond 7.5 m blast radius) during the 1.5 s warning
    env.player.position.set(0, CARGO_PLANE.floorY, CARGO_PLANE.quistCornerPos[2] + 9.0);
    env.step(QUIST_GRENADE_WINDOW + 0.05, 0.05);

    expect(env.setpieces.quistOutcome).toBe('grenade_survived');
    expect(env.player.alive).toBe(true);
    expect(env.playerDamages.length).toBe(0);
    expect(env.outcomes).toEqual(['grenade_survived']);
    expect(env.signals).toContain('dr:quist_done');
  });

  it('Outcome 4c: shooting Quist during the 1.5 s grenade warning window interrupts detonation -> killed', () => {
    const env = makeSetpiecesEnv();
    env.setpieces.startPlaneChase(env.hooks);
    env.setpieces.advanceQuistToTail();

    env.player.position.set(0, CARGO_PLANE.floorY, CARGO_PLANE.quistCornerPos[2] + 3.0);
    env.step(QUIST_SPEECH_DURATION, 0.1);
    expect(env.setpieces.quistState).toBe('grenade_warning');

    // Halfway through the 1.5 s escape/shoot window, player shoots Quist!
    env.step(0.6, 0.1);
    env.objects.colliderHitHandler?.(env.setpieces.quistHitCollider!, 50, 'smg');

    expect(env.setpieces.quistOutcome).toBe('killed');
    expect(env.outcomes).toEqual(['killed']);

    // Even advancing further never detonates the grenade
    env.step(2.0, 0.1);
    expect(env.playerDamages.length).toBe(0);
    expect(env.player.alive).toBe(true);
  });

  // -----------------------------------------------------------------------------------------------
  // 5E. Quist Outcome 5 — Speech Ends & Player > 8 m Away -> Pistol Suicide ('temple' sequence)
  // -----------------------------------------------------------------------------------------------

  it('Outcome 5: speech finishes > 8 m away -> 0.55 s draw -> 0.85 s temple pose -> gunshot & suicide', () => {
    const env = makeSetpiecesEnv();
    env.setpieces.startPlaneChase(env.hooks);
    env.setpieces.advanceQuistToTail();

    // Stand 10.5 m away (> 8 m threshold)
    env.player.position.set(0, CARGO_PLANE.floorY, CARGO_PLANE.quistCornerPos[2] + 10.5);

    // Speech finishes at 17.5 s -> draws sidearm
    env.step(QUIST_SPEECH_DURATION, 0.1);
    expect(env.setpieces.quistState).toBe('suicide_draw');
    expect(env.setpieces.quistOutcome).toBeNull();
    expect(env.lines.some(l => l.key === 'quist.end.pistol' && l.now === true)).toBe(true);
    expect(env.sounds).toContain('weapon_draw');

    // After 0.55 s draw -> enters 'temple' pose
    env.step(QUIST_SUICIDE_DRAW + 0.05, 0.05);
    expect(env.setpieces.quistState).toBe('suicide_temple');
    expect(env.setpieces.quistOutcome).toBeNull();

    // After 0.85 s in 'temple' pose -> fires pistol, muzzle flash + blood puff, collapses dead!
    env.step(QUIST_SUICIDE_TEMPLE + 0.05, 0.05);
    expect(env.setpieces.quistOutcome).toBe('suicide');
    expect(env.setpieces.quistState).toBe('dead');
    expect(env.sounds).toContain('enemy_pistol');
    expect(env.ctx.fx.muzzleFlash).toHaveBeenCalled();
    expect(env.ctx.fx.bloodHit).toHaveBeenCalled();
    expect(env.outcomes).toEqual(['suicide']);
    expect(env.signals).toContain('dr:quist_done');
  });

  it('Outcome 5b: shooting Quist during his pistol suicide draw/temple window kills him before he pulls the trigger', () => {
    const env = makeSetpiecesEnv();
    env.setpieces.startPlaneChase(env.hooks);
    env.setpieces.advanceQuistToTail();

    env.player.position.set(0, CARGO_PLANE.floorY, CARGO_PLANE.quistCornerPos[2] + 10.5);
    env.step(QUIST_SPEECH_DURATION, 0.1);
    env.step(QUIST_SUICIDE_DRAW + 0.1, 0.05);
    expect(env.setpieces.quistState).toBe('suicide_temple');

    // Player shoots him while pistol is at his temple
    env.objects.colliderHitHandler?.(env.setpieces.quistHitCollider!, 60, 'ultramag');
    expect(env.setpieces.quistOutcome).toBe('killed');
    expect(env.outcomes).toEqual(['killed']);

    // Advancing past remaining temple window never fires enemy_pistol or double-signals
    env.step(1.5, 0.1);
    expect(env.sounds).not.toContain('enemy_pistol');
    expect(env.outcomes).toEqual(['killed']);
  });

  // -----------------------------------------------------------------------------------------------
  // 6. Reset & Clear Hygiene
  // -----------------------------------------------------------------------------------------------

  it('resets all setpieces cleanly for checkpoint/mission restart', () => {
    const env = makeSetpiecesEnv();
    env.setpieces.ensureBuilt();
    env.setpieces.shatterMainGate();
    env.setpieces.triggerWaterTowerDrop();
    env.step(TOWER_FALL_DURATION + 0.1, 0.1);
    env.setpieces.startPlaneChase(env.hooks);
    env.setpieces.advanceQuistToTail();
    env.setpieces.damageQuist(100, 'ultramag');

    expect(env.setpieces.gateBreached).toBe(true);
    expect(env.setpieces.towerDropped).toBe(true);
    expect(env.setpieces.quistOutcome).toBe('killed');

    env.setpieces.reset();
    expect(env.setpieces.gateBreached).toBe(false);
    expect(env.setpieces.towerDropped).toBe(false);
    expect(env.setpieces.isTowerImpacted).toBe(false);
    expect(env.setpieces.rubbleColliderCount).toBe(0);
    expect(env.setpieces.isSewerBeaconOn).toBe(false);
    expect(env.setpieces.quistOutcome).toBeNull();
    expect(env.setpieces.quistState).toBe('inactive');
    expect(env.setpieces.mainGateCollider).not.toBeNull();
  });
});
