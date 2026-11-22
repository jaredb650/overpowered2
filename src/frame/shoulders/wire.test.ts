/** Guided Heavy Missile shoulder plug-in & model tests. */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx, RayHit } from '../../core/contracts';
import type { EnemyInstance, EnemyRayHit, ExplosionSpec, ProjectileSpec } from '../../core/gameplay';
import type { Ac130Rounds } from '../../progression/callins/ac130Rounds';
import type { MechKind } from '../../progression/callins/link';
import { ModelBuilder } from '../../progression/modelkit';
import type { GunnerWeapon } from '../../vehicles/hud';
import { activeMegaBlastCount } from '../../fx/recipes/megaBlast';
import { buildWireBomb, SHOULDER_WIRE } from '../models/shoulder-wire';
import type { ShoulderUpdateContext } from './types';
import { steerWireMissile, WIRE, WIRE_PLUGIN, WireShoulder } from './wire';

const DT = 1 / 60;

interface MockWireEnv {
  ctx: Ctx;
  explosions: { at: THREE.Vector3; spec: ExplosionSpec }[];
  rings: { at: THREE.Vector3; size: number }[];
  spawned: ProjectileSpec[];
  news: { kind: MechKind; values: number[] }[];
  setWorldRay: (fn: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => RayHit | null) => void;
  setEnemyRay: (fn: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => EnemyRayHit | null) => void;
}

function makeEnv(): MockWireEnv {
  const explosions: { at: THREE.Vector3; spec: ExplosionSpec }[] = [];
  const rings: { at: THREE.Vector3; size: number }[] = [];
  const spawned: ProjectileSpec[] = [];
  const news: { kind: MechKind; values: number[] }[] = [];
  let worldRay: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => RayHit | null = () => null;
  let enemyRay: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => EnemyRayHit | null = () => null;

  const ctx = {
    audio: {
      play: vi.fn(),
      startLoop: () => ({
        alive: true,
        setVolume: vi.fn(),
        setPitch: vi.fn(),
        setPosition: vi.fn(),
        stop: vi.fn(),
      }),
    },
    camera: {
      addTrauma: vi.fn(),
    },
    fx: {
      smoke: vi.fn(),
      sparks: vi.fn(),
      ring: (at: THREE.Vector3, _dir: THREE.Vector3, _color: THREE.ColorRepresentation, size = 1) => {
        rings.push({ at: at.clone(), size });
      },
    },
    render: {
      lights: { flash: vi.fn() },
    },
    physics: {
      raycast: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => worldRay(origin, dir, maxDist),
    },
    enemies: {
      alive: [] as EnemyInstance[],
      query: () => 0,
      raycast: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => enemyRay(origin, dir, maxDist),
      vehicles: null,
    },
    combat: {
      spawnProjectile: (spec: ProjectileSpec) => {
        spawned.push({
          ...spec,
          origin: spec.origin.clone(),
          velocity: spec.velocity.clone(),
        });
      },
      explode: (at: THREE.Vector3, spec: ExplosionSpec) => {
        explosions.push({ at: at.clone(), spec: { ...spec } });
      },
    },
  } as unknown as Ctx;

  return {
    ctx,
    explosions,
    rings,
    spawned,
    news,
    setWorldRay: fn => { worldRay = fn; },
    setEnemyRay: fn => { enemyRay = fn; },
  };
}

function makeUpdateCtx(
  env: MockWireEnv,
  sightPoint: THREE.Vector3,
  overrides: Partial<ShoulderUpdateContext> = {},
): ShoulderUpdateContext {
  const aim = sightPoint.clone().sub(new THREE.Vector3(0, 6, 0)).normalize();
  return {
    ctx: env.ctx,
    rounds: {} as Ac130Rounds,
    slot: 0,
    keyLabel: 'G',
    cycleKeyLabel: '3',
    sight: {
      view: { position: new THREE.Vector3(0, 6, 0) } as ShoulderUpdateContext['sight']['view'],
      aim,
      point: sightPoint,
      range: sightPoint.length(),
    },
    mountPos: out => out.set(1.5, 6.2, 0.2),
    feet: new THREE.Vector3(0, 0, 0),
    torsoYaw: 0,
    held: false,
    pressed: false,
    cyclePressed: false,
    online: true,
    gatherTargets: () => [],
    onMissile: null,
    onNews: (kind, values) => env.news.push({ kind, values: [...values] }),
    popFreeFlares: () => undefined,
    ...overrides,
  };
}

describe('Guided Heavy Missile', () => {
  it('flies at 16 m/s, steers continuously toward live sight.point, and turns cleanly around a 90° street corner', () => {
    const env = makeEnv();
    const wire = WIRE_PLUGIN.create(env.ctx) as WireShoulder;
    const sightPoint = new THREE.Vector3(1.5, 6.2, -100);

    // Launch straight down -Z.
    wire.update(DT, makeUpdateCtx(env, sightPoint, { pressed: true }));
    expect(wire.missile.live).toBe(true);
    expect(wire.missile.vel.length()).toBeCloseTo(16, 4);
    expect(wire.missile.vel.z).toBeCloseTo(-16, 3);

    // Fly forward for 1.0 s -> advances ~16 m along -Z while mech walks elsewhere.
    for (let i = 0; i < 60; i++) {
      wire.update(DT, makeUpdateCtx(env, sightPoint, { feet: new THREE.Vector3(i * 0.1, 0, -i * 0.05) }));
    }
    expect(wire.missile.pos.z).toBeCloseTo(0.2 - 16, 1);
    expect(wire.missile.vel.length()).toBeCloseTo(16, 4);

    // Swing crosshair 90° left around a street corner (-X corridor).
    const cornerAim = new THREE.Vector3(-80, 6.2, wire.missile.pos.z);
    const zAtCorner = wire.missile.pos.z;
    for (let i = 0; i < 30; i++) {
      // 0.5 s of steering.
      wire.update(DT, makeUpdateCtx(env, cornerAim));
    }
    // Velocity has cleanly rounded the 90° corner to point down -X at exact 16 m/s, with tight turning radius (< 5 m overshoot).
    expect(wire.missile.vel.length()).toBeCloseTo(16, 4);
    expect(wire.missile.vel.x).toBeLessThan(-15.5);
    expect(Math.abs(wire.missile.vel.z)).toBeLessThan(1.5);
    expect(Math.abs(wire.missile.pos.z - zAtCorner)).toBeLessThan(4.5);

    // Pure helper preserves 16 m/s speed as well.
    const pos = new THREE.Vector3(0, 5, 0);
    const vel = new THREE.Vector3(0, 0, -16);
    steerWireMissile(pos, vel, new THREE.Vector3(30, 5, 0), 0.5);
    expect(vel.length()).toBeCloseTo(WIRE.speed, 4);
    expect(vel.x).toBeGreaterThan(15);
  });

  it('calls megaBlast on world impact, enemy impact, and 18 s timeout', () => {
    // 1. World wall impact at z = -20.
    const envWall = makeEnv();
    envWall.setWorldRay((origin, dir, maxDist) => {
      if (dir.z >= 0) return null;
      const t = (-20 - origin.z) / dir.z;
      if (t < 0 || t > maxDist) return null;
      return {
        point: origin.clone().addScaledVector(dir, t),
        normal: new THREE.Vector3(0, 0, 1),
        distance: t,
        surface: 'concrete',
        collider: null,
      };
    });
    const wireWall = WIRE_PLUGIN.create(envWall.ctx) as WireShoulder;
    const aimWall = new THREE.Vector3(1.5, 6.2, -50);
    wireWall.update(DT, makeUpdateCtx(envWall, aimWall, { pressed: true }));
    for (let i = 0; i < 120 && wireWall.missile.live; i++) {
      wireWall.update(DT, makeUpdateCtx(envWall, aimWall));
    }
    expect(wireWall.missile.live).toBe(false);
    expect(envWall.explosions).toHaveLength(1);
    expect(envWall.explosions[0]!.spec.source).toBe('wireBomb');
    expect(envWall.explosions[0]!.spec.radius).toBe(26);
    expect(envWall.explosions[0]!.spec.cosmetic).toBe(false);
    // Real megaBlast activates its wave-timed 70 m pressure-wave slot.
    expect(activeMegaBlastCount(envWall.ctx)).toBe(1);

    // 2. Enemy hit detonates with megaBlast.
    const envEnemy = makeEnv();
    envEnemy.setEnemyRay((origin, dir, maxDist) => {
      if (origin.z > -12 && origin.z + dir.z * maxDist <= -12) {
        return {
          enemy: { uid: 7, alive: true } as EnemyInstance,
          distance: Math.abs(-12 - origin.z),
          point: new THREE.Vector3(origin.x, origin.y, -12),
          normal: new THREE.Vector3(0, 0, 1),
          bone: 0,
          region: 'chest',
        };
      }
      return null;
    });
    const wireEnemy = WIRE_PLUGIN.create(envEnemy.ctx) as WireShoulder;
    wireEnemy.update(DT, makeUpdateCtx(envEnemy, aimWall, { pressed: true }));
    for (let i = 0; i < 90 && wireEnemy.missile.live; i++) {
      wireEnemy.update(DT, makeUpdateCtx(envEnemy, aimWall));
    }
    expect(wireEnemy.missile.live).toBe(false);
    expect(envEnemy.explosions).toHaveLength(1);
    expect(envEnemy.explosions[0]!.at.z).toBeCloseTo(-12, 1);

    // 3. Max flight timeout (~18 s) detonates with megaBlast.
    const envTimeout = makeEnv();
    const wireTimeout = WIRE_PLUGIN.create(envTimeout.ctx) as WireShoulder;
    const farAim = new THREE.Vector3(1.5, 6.2, -500);
    wireTimeout.update(DT, makeUpdateCtx(envTimeout, farAim, { pressed: true }));
    let t = 0;
    for (; t < 20 && wireTimeout.missile.live; t += DT) {
      wireTimeout.update(DT, makeUpdateCtx(envTimeout, farAim));
    }
    expect(wireTimeout.missile.live).toBe(false);
    expect(t).toBeGreaterThanOrEqual(17.9);
    expect(t).toBeLessThanOrEqual(18.2);
    expect(envTimeout.explosions).toHaveLength(1);
    expect(envTimeout.explosions[0]!.spec.source).toBe('wireBomb');
  });

  it('enforces 28 s reload, prevents double-firing while live, and updates HUD rows', () => {
    const env = makeEnv();
    const wire = WIRE_PLUGIN.create(env.ctx) as WireShoulder;
    const aim = new THREE.Vector3(1.5, 6.2, -200);
    const row: GunnerWeapon = { name: '', ammo: 0, max: 1, reload: -1 };

    wire.fillRow(row, 'V', '4', true);
    expect(row.name).toContain('READY');
    expect(row.ammo).toBe(1);

    // Launch.
    wire.update(DT, makeUpdateCtx(env, aim, { pressed: true }));
    expect(wire.missile.live).toBe(true);
    expect(wire.reloadLeft).toBeCloseTo(28, 2);

    // HUD shows GUIDING while missile is live, and pressing trigger again cannot fire a second missile.
    wire.fillRow(row, 'V', '4', true);
    expect(row.name).toContain('GUIDING');
    expect(row.ammo).toBe(0);
    const launchNewsCount = env.news.length;
    wire.update(DT, makeUpdateCtx(env, aim, { pressed: true }));
    expect(env.news.length).toBe(launchNewsCount);

    // Let missile time out at 18 s -> still reloading for ~10 s more.
    for (let i = 0; i < 18.2 * 60; i++) wire.update(DT, makeUpdateCtx(env, aim));
    expect(wire.missile.live).toBe(false);
    expect(wire.reloadLeft).toBeGreaterThan(9.5);
    wire.fillRow(row, 'V', '4', true);
    expect(row.name).toContain('RELOADING');
    expect(row.reload).toBeGreaterThan(0.5);

    // Finish remaining reload -> reaches READY at 28 s total.
    for (let i = 0; i < 10.2 * 60; i++) wire.idleUpdate(DT);
    expect(wire.reloadLeft).toBe(0);
    wire.fillRow(row, 'V', '4', true);
    expect(row.name).toContain('READY');
    expect(row.ammo).toBe(1);
    expect(row.reload).toBe(-1);
  });

  it('emits co-op launch/detonation news and plays cosmetic missile flight + cosmetic megaBlast in remoteNews', () => {
    const env = makeEnv();
    env.setWorldRay((origin, dir, maxDist) => {
      if (dir.z >= 0) return null;
      const t = (-16 - origin.z) / dir.z;
      if (t < 0 || t > maxDist) return null;
      return {
        point: origin.clone().addScaledVector(dir, t),
        normal: new THREE.Vector3(0, 0, 1),
        distance: t,
        surface: 'concrete',
        collider: null,
      };
    });

    const wire = WIRE_PLUGIN.create(env.ctx) as WireShoulder;
    const aim = new THREE.Vector3(1.5, 6.2, -50);
    wire.update(DT, makeUpdateCtx(env, aim, { pressed: true }));
    for (let i = 0; i < 120 && wire.missile.live; i++) wire.update(DT, makeUpdateCtx(env, aim));

    // Verify local emitted phase 0 (launch) and phase 1 (detonation).
    expect(env.news).toHaveLength(2);
    expect(env.news[0]!.kind).toBe('wire');
    expect(env.news[0]!.values[0]).toBe(0);
    expect(env.news[0]!.values).toHaveLength(7);
    expect(env.news[1]!.kind).toBe('wire');
    expect(env.news[1]!.values[0]).toBe(1);
    expect(env.news[1]!.values).toHaveLength(4);

    // Replay on a teammate's screen via remoteNews.
    const peerEnv = makeEnv();
    WIRE_PLUGIN.remoteNews?.(peerEnv.ctx, 'wire', env.news[0]!.values);
    expect(peerEnv.spawned).toHaveLength(1);
    expect(peerEnv.spawned[0]!.cosmetic).toBe(true);
    expect(peerEnv.spawned[0]!.ghost).toBe(true);
    expect(peerEnv.spawned[0]!.velocity.length()).toBeCloseTo(16, 3);
    expect(peerEnv.spawned[0]!.size).toBeGreaterThan(2);

    WIRE_PLUGIN.remoteNews?.(peerEnv.ctx, 'wire', env.news[1]!.values);
    expect(activeMegaBlastCount(peerEnv.ctx)).toBe(1);
    expect(peerEnv.explosions).toHaveLength(0);
  });

  it('builds the Guided Heavy Missile 3D shoulder model with solid and glow geometry', () => {
    expect(SHOULDER_WIRE).toBe(buildWireBomb);
    const b = new ModelBuilder();
    buildWireBomb(b);
    const solid = b.solidGeometry();
    const glow = b.glowGeometry();
    expect(solid).not.toBeNull();
    expect(glow).not.toBeNull();
    expect(solid!.getAttribute('position').count).toBeGreaterThan(200);
    expect(glow!.getAttribute('position').count).toBeGreaterThan(40);
  });
});
