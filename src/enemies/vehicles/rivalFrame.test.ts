/** Unit & behavioral tests for the Harbourmaster's NPC-controlled Ironclad RivalFrame mech boss. */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../../core/contracts';
import type { MissileTarget, ProjectileSpec } from '../../core/gameplay';
import { PANS } from '../../world/map/holdfast/plan';
import { RIVAL_FRAME, RivalFrame } from './rivalFrame';

function makeMockCtx() {
  let nextHandle = 1;
  const colliders = new Map<number, { handle: number; pos: THREE.Vector3; rot: THREE.Quaternion; removed: boolean }>();
  const signals: string[] = [];
  const feeds: string[] = [];
  const floatTexts: string[] = [];
  const projectiles: ProjectileSpec[] = [];
  const sounds: string[] = [];
  const beams: number[] = [];
  const playerDamage: { amount: number; source: string; type: string }[] = [];
  const scene = new THREE.Scene();

  const ctx = {
    time: { elapsed: 0, dt: 0.016 },
    render: {
      scene,
      materials: { patch: <T>(m: T) => m },
      lights: { flash: vi.fn() },
    },
    physics: {
      addStaticBox: (pos: THREE.Vector3) => {
        const handle = nextHandle++;
        const rec = { handle, pos: pos.clone(), rot: new THREE.Quaternion(), removed: false };
        colliders.set(handle, rec);
        return {
          handle,
          setTranslation: (v: THREE.Vector3) => rec.pos.copy(v),
          setRotation: (q: THREE.Quaternion) => rec.rot.copy(q),
        };
      },
      world: {
        removeCollider: (c: { handle: number }) => {
          const rec = colliders.get(c.handle);
          if (rec) rec.removed = true;
        },
      },
    },
    player: {
      position: new THREE.Vector3(-86, 0, 35),
      eye: new THREE.Vector3(-86, 4.2, 35),
      velocity: new THREE.Vector3(2, 0, 0),
      alive: true,
      takeDamage: (d: { amount: number; source: string; type: string }) => playerDamage.push(d),
      push: vi.fn(),
    },
    audio: {
      play: (id: string) => sounds.push(id),
      startLoop: vi.fn(() => ({ alive: true, setVolume: vi.fn(), setPitch: vi.fn(), setPosition: vi.fn(), stop: vi.fn() })),
    },
    fx: {
      explosion: vi.fn(),
      chips: vi.fn(),
      embers: vi.fn(),
      smoke: vi.fn(),
      dust: vi.fn(),
      slam: vi.fn(),
      ring: vi.fn(),
      beam: () => beams.push(1),
      muzzleFlash: vi.fn(),
      tracer: vi.fn(),
    },
    hud: {
      hitMarker: vi.fn(),
      feed: (text: string) => feeds.push(text),
      floatText: (_at: THREE.Vector3, text: string) => floatTexts.push(text),
      follow: () => () => {},
    },
    camera: { addTrauma: vi.fn() },
    campaign: { signal: (s: string) => signals.push(s) },
    progression: { award: vi.fn() },
    combat: {
      spawnProjectile: (spec: ProjectileSpec) => projectiles.push({ ...spec, origin: spec.origin.clone(), velocity: spec.velocity.clone() }),
    },
  } as unknown as Ctx;

  return { ctx, colliders, signals, feeds, floatTexts, projectiles, sounds, beams, playerDamage, scene };
}

describe('RivalFrame (Harbourmaster Ironclad Mech Boss)', () => {
  it('spawns cleanly with 4500 HP, HUD state, missile paintability, and hide/reset support', () => {
    const m = makeMockCtx();
    const rival = new RivalFrame(m.ctx, null);

    expect(rival.alive).toBe(false);
    expect(rival.active).toBe(false);
    expect(rival.barFraction()).toBe(0);
    expect(rival.barLabel()).toBe('HARBOURMASTER // IRONCLAD FRAME');

    rival.spawn(new THREE.Vector3(-86, 0, -5), 0);
    expect(rival.alive).toBe(true);
    expect(rival.active).toBe(true);
    expect(rival.health).toBe(RIVAL_FRAME.maxHealth);
    expect(rival.barFraction()).toBe(1);
    expect(rival.root.visible).toBe(true);

    const paintables: MissileTarget[] = [];
    rival.paintable(paintables);
    expect(paintables.length).toBe(1);
    expect(paintables[0]!.alive).toBe(true);

    const highlighted: THREE.Object3D[] = [];
    rival.highlightMeshes(highlighted);
    expect(highlighted.length).toBeGreaterThan(0);

    rival.hide();
    expect(rival.alive).toBe(false);
    expect(rival.active).toBe(false);
    expect(rival.root.visible).toBe(false);

    rival.dispose();
  });

  it('strafes inside PANS bounds, tracks player, and executes rotary, heavy cannon, missile salvo, and jump-jet leap attacks', () => {
    const m = makeMockCtx();
    const rival = new RivalFrame(m.ctx, null);
    rival.spawn(new THREE.Vector3(-86, 0, -5), Math.PI);
    const startPos = rival.position.clone();

    // Simulate 22 seconds of active Mech-vs-Mech combat
    let sawAirborne = false;
    for (let i = 0; i < 440; i++) {
      m.ctx.time.elapsed += 0.05;
      rival.update(0.05);
      if (rival.position.y > 2.5) sawAirborne = true;
      expect(rival.position.x).toBeGreaterThanOrEqual(PANS.x0);
      expect(rival.position.x).toBeLessThanOrEqual(PANS.x1);
      expect(rival.position.z).toBeGreaterThanOrEqual(PANS.z0);
      expect(rival.position.z).toBeLessThanOrEqual(PANS.z1);
    }

    // Mech actively moved/circled and aimed toward the player
    expect(rival.position.distanceTo(startPos)).toBeGreaterThan(5);

    // Fired left-arm rotary bursts, right-arm heavy cannon (with laser telegraph), and 4-missile shoulder salvo
    expect(m.projectiles.some(p => p.source === 'rival_rotary')).toBe(true);
    expect(m.projectiles.some(p => p.source === 'rival_cannon')).toBe(true);
    expect(m.beams.length).toBeGreaterThan(0);
    const missiles = m.projectiles.filter(p => p.source === 'rival_missile');
    expect(missiles.length).toBeGreaterThanOrEqual(RIVAL_FRAME.missileCount);

    // Performed jump-jet reposition leap
    expect(sawAirborne).toBe(true);
    expect(m.feeds.some(f => f.includes('JUMP-JET LEAP'))).toBe(true);

    rival.dispose();
  });

  it('takes ExtraTarget damage from shot (cockpit crit), 105mm Howitzer direct hit (with stagger), blast, and frameBlow', () => {
    const m = makeMockCtx();
    const rival = new RivalFrame(m.ctx, null);
    rival.spawn(new THREE.Vector3(-86, 0, -5), 0);

    const torsoCol = rival.colliderFor('torso')!;
    const cockpitCol = rival.colliderFor('cockpit')!;
    expect(torsoCol).not.toBeNull();
    expect(cockpitCol).not.toBeNull();

    // Cockpit hit deals 1.35x crit damage with heavy weapon
    const hp0 = rival.health;
    expect(rival.shot(cockpitCol, rival.position, 100, 'frame_rotary')).toBe(true);
    expect(rival.health).toBeCloseTo(hp0 - 135);

    // 105mm Howitzer direct hit deals 1.35x boosted damage and staggers the mech!
    const hp1 = rival.health;
    expect(rival.direct(torsoCol, rival.position, 400, 'shell', 'frame_howitzer')).toBe(true);
    expect(rival.health).toBeCloseTo(hp1 - 540);
    expect(rival.staggerLeft).toBeGreaterThan(0);
    expect(m.floatTexts).toContain('STAGGERED');

    // Blast damage from player explosion registers cleanly
    const hp2 = rival.health;
    const hitCount = rival.blast(rival.position.clone().setY(3.8), {
      radius: 10,
      damage: 300,
      kind: 'shell',
      source: 'frame_howitzer',
      team: 'player',
    });
    expect(hitCount).toBe(1);
    expect(rival.health).toBeLessThan(hp2 - 200);

    // Frame melee/stomp blow registers cleanly
    const hp3 = rival.health;
    expect(rival.frameBlow(rival.position.clone().setY(3.5), 6, 200)).toBe(1);
    expect(rival.health).toBeCloseTo(hp3 - 230);

    rival.dispose();
  });

  it('triggers emergency cockpit eject at 0 HP, rockets skyward, lands after ~1.8s, signals harbour:ejected, and invokes onEjected', () => {
    const m = makeMockCtx();
    const rival = new RivalFrame(m.ctx, null);
    const landedAt: THREE.Vector3[] = [];
    rival.onEjected = pos => landedAt.push(pos);

    rival.spawn(new THREE.Vector3(-86, 0, -5), 0.4);
    const torsoCol = rival.colliderFor('torso')!;

    // Deal lethal 105mm Howitzer damage
    rival.direct(torsoCol, rival.position, 5000, 'shell', 'frame_howitzer');
    expect(rival.alive).toBe(false);
    expect(rival.active).toBe(true);
    expect(rival.phase).toBe('ejecting');
    expect(rival.health).toBe(0);
    expect(rival.barFraction()).toBe(0);
    expect(m.signals).not.toContain('harbour:ejected');
    expect(landedAt.length).toBe(0);

    // No longer paintable by missiles during eject
    const paintables: MissileTarget[] = [];
    rival.paintable(paintables);
    expect(paintables.length).toBe(0);

    // Step halfway through eject arc (~0.9s): still ejecting
    for (let i = 0; i < 18; i++) {
      m.ctx.time.elapsed += 0.05;
      rival.update(0.05);
    }
    expect(rival.phase).toBe('ejecting');
    expect(landedAt.length).toBe(0);

    // Finish the 1.8s eject arc -> touchdown!
    for (let i = 0; i < 20; i++) {
      m.ctx.time.elapsed += 0.05;
      rival.update(0.05);
    }
    expect(rival.phase).toBe('wrecked');
    expect(m.signals).toContain('harbour:ejected');
    expect(landedAt.length).toBe(1);
    expect(landedAt[0]!.distanceTo(rival.ejectLandingPoint)).toBeLessThan(0.001);
    expect(rival.ejectLandingPoint.x).toBeGreaterThanOrEqual(PANS.x0);
    expect(rival.ejectLandingPoint.x).toBeLessThanOrEqual(PANS.x1);
    expect(rival.ejectLandingPoint.z).toBeGreaterThanOrEqual(PANS.z0);
    expect(rival.ejectLandingPoint.z).toBeLessThanOrEqual(PANS.z1);
    expect(rival.ejectLandingPoint.distanceTo(rival.position)).toBeGreaterThan(8);

    rival.dispose();
  });
});
