import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../core/contracts';
import { Combat } from './Combat';
import { THROWBACK, isThrowbackSource, safeThrowbackFuse, throwbackPriority, type IncomingGrenade } from './throwback';

function makeThrowbackCtx() {
  const scene = new THREE.Scene();
  const award = vi.fn();
  const callout = vi.fn();
  const feed = vi.fn();
  const hitMarker = vi.fn();
  const applyDamage = vi.fn(() => ({ killed: true, headshot: false, gibbed: false, damage: 180 }));
  const aliveEnemy = {
    uid: 77,
    id: 'trooper',
    alive: true,
    health: 100,
    maxHealth: 100,
    position: new THREE.Vector3(0, 0, -10),
    center: new THREE.Vector3(0, 1, -10),
    velocity: new THREE.Vector3(),
    yaw: 0,
    armor: 0,
    score: 100,
    isBoss: false,
    frozen: 0,
    burning: 0,
    machine: false,
    char: { rig: { height: 1.8 } },
  };

  const ctx = {
    render: {
      scene,
      post: { flash: vi.fn() },
    },
    physics: {
      raycast: (o: THREE.Vector3, d: THREE.Vector3, max: number) => {
        if (d.y >= -1e-4 || o.y < 0) return null;
        const t = -o.y / d.y;
        if (t > max) return null;
        return {
          point: o.clone().addScaledVector(d, t),
          normal: new THREE.Vector3(0, 1, 0),
          distance: t,
          surface: 'concrete',
          collider: null,
        };
      },
      raycastInto: (o: THREE.Vector3, d: THREE.Vector3, max: number, _mask: number, out: { point: THREE.Vector3; normal: THREE.Vector3; distance: number; surface: string; collider: null }) => {
        if (d.y >= -1e-4 || o.y < 0) return false;
        const t = -o.y / d.y;
        if (t > max) return false;
        out.point.copy(o).addScaledVector(d, t);
        out.normal.set(0, 1, 0);
        out.distance = t;
        out.surface = 'concrete';
        out.collider = null;
        return true;
      },
      radialImpulse: vi.fn(),
    },
    world: {
      objects: {
        damage: vi.fn(),
        damageBarrelsInSphere: vi.fn(),
        damageStructuresInSphere: vi.fn(),
        damageExplosivesInRadius: vi.fn(),
      },
      bounds: new THREE.Box3(new THREE.Vector3(-100, -10, -100), new THREE.Vector3(100, 100, 100)),
    },
    player: {
      alive: true,
      parked: false,
      position: new THREE.Vector3(0, 0, 0),
      eye: new THREE.Vector3(0, 1.65, 0),
      velocity: new THREE.Vector3(0, 0, 0),
      forward: new THREE.Vector3(0, 0, -1),
      damage: vi.fn(),
      push: vi.fn(),
    },
    camera: {
      fovPunch: vi.fn(),
      addTrauma: vi.fn(),
    },
    audio: {
      play: vi.fn(),
      playOneOf: vi.fn(),
    },
    fx: {
      explosion: vi.fn(),
      ring: vi.fn(),
      sparks: vi.fn(),
      smoke: vi.fn(),
      impact: vi.fn(),
      tracer: vi.fn(),
      bloodHit: vi.fn(),
    },
    hud: {
      callout,
      feed,
      hitMarker,
      floatText: vi.fn(),
    },
    progression: {
      award,
    },
    enemies: {
      alive: [aliveEnemy],
      raycast: () => null,
      query: (_center: THREE.Vector3, _radius: number, out: unknown[]) => {
        out.length = 0;
        out.push(aliveEnemy);
        return 1;
      },
      applyDamage,
      vehicles: {
        blast: vi.fn(),
        damageInSphere: vi.fn(),
        hit: vi.fn(),
      },
    },
    weapons: {
      modifiers: { damage: 1 },
    },
    gore: {
      blast: vi.fn(),
      blastStain: vi.fn(),
    },
    events: {
      emit: vi.fn(),
      on: vi.fn(),
    },
    time: {
      dt: 0.1,
      realDt: 0.1,
      slowmo: vi.fn(),
      hitStop: vi.fn(),
      realElapsed: 10,
    },
  } as unknown as Ctx;

  const combat = new Combat(ctx);
  combat.init(ctx);
  return { ctx, combat, award, callout, feed, hitMarker, applyDamage, aliveEnemy };
}

function makeThreatPool(n = 4): IncomingGrenade[] {
  return Array.from({ length: n }, () => ({
    position: new THREE.Vector3(),
    fuse: 0,
    maxFuse: 1,
    distance: 0,
    flash: false,
    inReach: false,
  }));
}

describe('Grenade Throwback & Deflection', () => {
  it('enforces safe fuse floor, source classification, and priority ordering', () => {
    expect(safeThrowbackFuse(0.2)).toBe(THROWBACK.minFuse);
    expect(safeThrowbackFuse(1.8)).toBe(1.8);
    expect(isThrowbackSource(THROWBACK.fragSource)).toBe(true);
    expect(isThrowbackSource(THROWBACK.flashSource)).toBe(true);
    expect(isThrowbackSource('grenade')).toBe(false);
    // Closer grenade in front of crosshair beats farther grenade behind player.
    expect(throwbackPriority(2.0, 0.95)).toBeLessThan(throwbackPriority(4.5, -0.5));
  });

  it('detects live enemy frag & flashbang threats and ignores player grenades', () => {
    const { combat } = makeThrowbackCtx();

    // Spawn a friendly grenade — must NOT appear as an enemy threat.
    combat.spawnProjectile({
      origin: new THREE.Vector3(0, 1, -2),
      velocity: new THREE.Vector3(0, 0, -5),
      kind: 'grenade',
      team: 'player',
      damage: 100,
      source: 'grenade',
      fuse: 2.0,
    });
    const threats = makeThreatPool();
    expect(combat.listIncomingGrenades(new THREE.Vector3(0, 1.6, 0), THROWBACK.warnRange, threats)).toBe(0);

    // Spawn a live enemy frag grenade within grab reach.
    combat.spawnProjectile({
      origin: new THREE.Vector3(0, 1.2, -3),
      velocity: new THREE.Vector3(0, 0, 2),
      kind: 'grenade',
      team: 'enemy',
      damage: 90,
      source: 'enemy_grenade',
      fuse: 1.4,
    });
    expect(combat.listIncomingGrenades(new THREE.Vector3(0, 1.6, 0), THROWBACK.warnRange, threats)).toBe(1);
    expect(threats[0]!.flash).toBe(false);
    expect(threats[0]!.inReach).toBe(true);
    expect(threats[0]!.distance).toBeLessThan(THROWBACK.grabReach);
  });

  it('snatches and hurls back live enemy frag grenades with safe fuse floor >= 0.95s', () => {
    const { combat } = makeThrowbackCtx();

    // Enemy frag with only 0.25 s left on fuse!
    combat.spawnProjectile({
      origin: new THREE.Vector3(0.2, 1.2, -2.8),
      velocity: new THREE.Vector3(0, 0, 1),
      kind: 'grenade',
      team: 'enemy',
      damage: 85,
      source: 'enemy_grenade',
      fuse: 0.25,
      explosion: { radius: 5.5, damage: 85, kind: 'grenade' },
    });

    const eye = new THREE.Vector3(0, 1.65, 0);
    const forward = new THREE.Vector3(0, 0, -1);
    const res = combat.throwBackGrenade(eye, forward, new THREE.Vector3(), 1.2);
    expect(res).not.toBeNull();
    expect(res!.flash).toBe(false);
    expect(res!.fuse).toBeGreaterThanOrEqual(THROWBACK.minFuse);

    // Should no longer be listed as an enemy threat!
    const threats = makeThreatPool();
    expect(combat.listIncomingGrenades(eye, THROWBACK.warnRange, threats)).toBe(0);
  });

  it('converts returned enemy flashbangs into concussive player blasts that trigger Return to Sender', () => {
    const { ctx, combat, callout, award, aliveEnemy } = makeThrowbackCtx();
    // Place enemy right along the thrown flashbang's landing zone (within 7.5 m blast radius).
    aliveEnemy.position.set(0, 0, -24);
    aliveEnemy.center.set(0, 1, -24);

    combat.spawnProjectile({
      origin: new THREE.Vector3(0, 1.2, -2.5),
      velocity: new THREE.Vector3(0, 0, 0),
      kind: 'grenade',
      team: 'enemy',
      damage: 0,
      source: 'flashbang',
      fuse: 0.3,
    });

    const res = combat.throwBackGrenade(new THREE.Vector3(0, 1.65, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 1);
    expect(res).not.toBeNull();
    expect(res!.flash).toBe(true);
    expect(res!.fuse).toBeGreaterThanOrEqual(THROWBACK.minFuse);

    // Advance until fuse detonates and verify player-team explosion triggers RETURN TO SENDER!
    for (let i = 0; i < 15; i++) combat.update();
    const expCalls = (ctx.fx.explosion as ReturnType<typeof vi.fn>).mock.calls;
    expect(expCalls.length).toBe(1);
    const detAt = expCalls[0]![0] as THREE.Vector3;
    expect(detAt.y).toBeLessThan(3);
    expect(detAt.z).toBeLessThan(-12);
    expect(callout).toHaveBeenCalledWith('RETURN TO SENDER');
    expect(award).toHaveBeenCalledWith(THROWBACK.bonusScore, 'RETURN TO SENDER', expect.any(THREE.Vector3));
  });

  it('baseball-bats live enemy grenades with melee swings and punts multiple grenades with Frame stomp', () => {
    const { combat } = makeThrowbackCtx();

    combat.spawnProjectile({
      origin: new THREE.Vector3(0, 1.5, -2.1),
      velocity: new THREE.Vector3(0, 0, 5),
      kind: 'grenade',
      team: 'enemy',
      damage: 80,
      source: 'enemy_grenade',
      fuse: 0.4,
    });

    const impact = combat.batGrenade(new THREE.Vector3(0, 1.65, 0), new THREE.Vector3(0, 0, -1));
    expect(impact).not.toBeNull();

    // Now spawn two more enemy grenades around a Distraint Frame stomp center and punt both!
    combat.spawnProjectile({
      origin: new THREE.Vector3(2, 0.5, 0),
      velocity: new THREE.Vector3(),
      kind: 'grenade',
      team: 'enemy',
      damage: 80,
      source: 'enemy_grenade',
      fuse: 0.6,
    });
    combat.spawnProjectile({
      origin: new THREE.Vector3(-3, 0.5, 1),
      velocity: new THREE.Vector3(),
      kind: 'grenade',
      team: 'enemy',
      damage: 80,
      source: 'enemy_grenade',
      fuse: 0.6,
    });

    const punted = combat.puntEnemyGrenades(new THREE.Vector3(0, 0, 0), 6, new THREE.Vector3(0, 0, 0));
    expect(punted).toBe(2);
  });

  it('awards RETURN TO SENDER callout, feed line, and +150 bonus score on throwback kill', () => {
    const { combat, award, callout, feed } = makeThrowbackCtx();

    combat.explode(new THREE.Vector3(0, 1, -10), {
      radius: 7,
      damage: 200,
      kind: 'grenade',
      source: THROWBACK.fragSource,
      team: 'player',
      selfDamage: 0,
    });

    expect(callout).toHaveBeenCalledWith('RETURN TO SENDER');
    expect(feed).toHaveBeenCalledWith(`RETURN TO SENDER (+${THROWBACK.bonusScore})`, '#ffb347');
    expect(award).toHaveBeenCalledWith(THROWBACK.bonusScore, 'RETURN TO SENDER', expect.any(THREE.Vector3));
  });
});
