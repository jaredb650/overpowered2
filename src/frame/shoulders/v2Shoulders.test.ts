/**
 * Unit tests for Distraint Frame Overhaul v2 Shoulder Weapons & 3D Models (Lane 4):
 *   - Twin Shoulder Grenade Cannon (`twinGrenade.ts` + `shoulder-twingrenade.ts`)
 *   - Autonomous Laser Orbit Drones (`laserOrbit.ts` + `shoulder-orbit.ts`)
 *   - Shock-Needle Launcher (`arcNeedle.ts` + `shoulder-arcneedle.ts`)
 *   - Vertical Plasma Missile Rack (`plasmaMissiles.ts` + `shoulder-plasmamissiles.ts`)
 *   - 4-Barrel Shoulder Minigun (`shoulderGatling.ts` + `shoulder-gatling.ts`)
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx, DamageInfo, LoopHandle, PlayOptions, RayHit } from '../../core/contracts';
import type { EnemyInstance, ExplosionSpec, MissileTarget, ShotSpec } from '../../core/gameplay';
import type { Ac130Rounds } from '../../progression/callins/ac130Rounds';
import type { MechKind } from '../../progression/callins/link';
import { ModelBuilder } from '../../progression/modelkit';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { PaintCandidate } from '../../weapons/swarm';
import type { Sight } from '../arms/types';
import { createFrameBuilder, FRAME_PALETTES } from '../models/palette';
import { buildArcNeedle } from '../models/shoulder-arcneedle';
import { buildShoulderGatling } from '../models/shoulder-gatling';
import { buildLaserOrbit } from '../models/shoulder-orbit';
import { buildPlasmaMissiles } from '../models/shoulder-plasmamissiles';
import { buildTwinGrenade } from '../models/shoulder-twingrenade';
import { SHOULDER_MODELS } from '../models/shoulders';
import { ARC_NEEDLE, ARC_NEEDLE_PLUGIN, ARC_NEEDLE_SHOULDER, ArcNeedleShoulder } from './arcNeedle';
import { LASER_ORBIT, LASER_ORBIT_PLUGIN, LASER_ORBIT_SHOULDER, LaserOrbitShoulder } from './laserOrbit';
import { PLASMA_MISSILES, PLASMA_MISSILES_PLUGIN, PLASMA_MISSILES_SHOULDER, PlasmaMissilesShoulder } from './plasmaMissiles';
import { dispatchShoulderRemoteNews, SHOULDER_REGISTRY } from './registry';
import { SHOULDER_GATLING, SHOULDER_GATLING_PLUGIN, SHOULDER_GATLING_SHOULDER, ShoulderGatlingShoulder } from './shoulderGatling';
import { TWIN_GRENADE, TWIN_GRENADE_PLUGIN, TWIN_GRENADE_SHOULDER, TwinGrenadeShoulder } from './twinGrenade';
import type { ShoulderUpdateContext } from './types';

const DT = 1 / 60;

interface MockEnemy extends EnemyInstance {
  alive: boolean;
  health: number;
  damageTaken: DamageInfo[];
  afflictions: { kind: string; seconds: number }[];
  staggerCalls: number;
}

function makeEnemy(uid: number, x: number, y: number, z: number, hp = 500): MockEnemy {
  const pos = new THREE.Vector3(x, y, z);
  const center = new THREE.Vector3(x, y + 1.0, z);
  const velocity = new THREE.Vector3();
  const enemy: MockEnemy = {
    uid,
    id: 'trooper',
    char: {
      anim: {
        play: (action: string) => {
          if (action === 'stagger') enemy.staggerCalls++;
          return 0.4;
        },
      },
    } as unknown as EnemyInstance['char'],
    position: pos,
    velocity,
    yaw: 0,
    health: hp,
    maxHealth: hp,
    armor: 0,
    alive: true,
    score: 100,
    center,
    isBoss: false,
    frozen: 0,
    burning: 0,
    machine: false,
    damageTaken: [],
    afflictions: [],
    staggerCalls: 0,
  };
  return enemy;
}

interface RecordedExplode {
  pos: THREE.Vector3;
  spec: ExplosionSpec;
}

interface RecordedNapalm {
  hit: THREE.Vector3;
  vel: THREE.Vector3;
  source: string;
  radius: number;
}

interface RecordedRay {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  spec: ShotSpec;
}

interface RecordedTracer {
  from: THREE.Vector3;
  to: THREE.Vector3;
  kind: string;
}

function makeHarness(opts: {
  enemies?: MockEnemy[];
  withScene?: boolean;
  wallHit?: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => RayHit | null;
  enemyRayHit?: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => { enemy: MockEnemy; point: THREE.Vector3; distance: number } | null;
} = {}) {
  const enemies = opts.enemies ?? [];
  const explosions: RecordedExplode[] = [];
  const napalms: RecordedNapalm[] = [];
  const rays: RecordedRay[] = [];
  const tracers: RecordedTracer[] = [];
  const arcs: { from: THREE.Vector3; to: THREE.Vector3 }[] = [];
  const sparks: { pos: THREE.Vector3; count: number }[] = [];
  const sounds: { id: string; options?: PlayOptions }[] = [];
  const loops: { id: string; stopped: boolean }[] = [];
  const news: { kind: MechKind; values: number[] }[] = [];
  const scene = opts.withScene === false ? undefined : new THREE.Scene();

  const ctx = {
    audio: {
      play: (id: string, options?: PlayOptions) => { sounds.push({ id, options }); },
      startLoop: (id: string): LoopHandle => {
        const rec = { id, stopped: false };
        loops.push(rec);
        return {
          get alive() { return !rec.stopped; },
          setVolume() {},
          setPitch() {},
          setPosition() {},
          stop() { rec.stopped = true; },
        };
      },
    },
    combat: {
      explode: (pos: THREE.Vector3, spec: ExplosionSpec) => {
        explosions.push({ pos: pos.clone(), spec: { ...spec } });
      },
      napalmBurst: (hit: THREE.Vector3, vel: THREE.Vector3, source: string, radius: number) => {
        napalms.push({ hit: hit.clone(), vel: vel.clone(), source, radius });
      },
      fireRay: (origin: THREE.Vector3, dir: THREE.Vector3, spec: ShotSpec) => {
        rays.push({ origin: origin.clone(), dir: dir.clone(), spec: { ...spec } });
        if (spec.struck && enemies.length > 0 && enemies[0]!.alive) {
          spec.struck.count = 1;
          spec.struck.enemies[0] = enemies[0]!;
          spec.struck.points[0]!.copy(enemies[0]!.center);
        }
        return {
          hitEnemy: enemies.length > 0,
          headshot: false,
          killed: false,
          kills: 0,
          end: origin.clone().addScaledVector(dir, 30),
        };
      },
      spawnProjectile: vi.fn(),
    },
    enemies: {
      alive: enemies,
      query: (center: THREE.Vector3, radius: number, out: EnemyInstance[]) => {
        out.length = 0;
        const r2 = radius * radius;
        for (const e of enemies) {
          if (e.alive && e.center.distanceToSquared(center) <= r2) out.push(e);
        }
        return out.length;
      },
      raycast: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => {
        if (opts.enemyRayHit) {
          const h = opts.enemyRayHit(origin, dir, maxDist);
          return h
            ? { enemy: h.enemy, point: h.point, distance: h.distance, normal: new THREE.Vector3(0, 0, 1), bone: 0, region: 'torso' as const }
            : null;
        }
        // Simple sphere test against mock enemies along ray.
        let best: { enemy: MockEnemy; dist: number; point: THREE.Vector3 } | null = null;
        for (const e of enemies) {
          if (!e.alive) continue;
          const toE = e.center.clone().sub(origin);
          const t = toE.dot(dir);
          if (t < 0 || t > maxDist) continue;
          const perp2 = toE.lengthSq() - t * t;
          if (perp2 <= 1.2 * 1.2 && (!best || t < best.dist)) {
            best = { enemy: e, dist: t, point: origin.clone().addScaledVector(dir, t) };
          }
        }
        return best
          ? { enemy: best.enemy, point: best.point, distance: best.dist, normal: new THREE.Vector3(0, 0, 1), bone: 0, region: 'torso' as const }
          : null;
      },
      applyDamage: (enemy: EnemyInstance, damage: DamageInfo) => {
        const m = enemy as MockEnemy;
        m.damageTaken.push({ ...damage, point: damage.point.clone(), dir: damage.dir.clone() });
        m.health = Math.max(0, m.health - damage.amount);
        if (m.health <= 0) m.alive = false;
        return { dealt: damage.amount, killed: !m.alive, headshot: false, severed: [], blocked: false };
      },
      afflict: (enemy: EnemyInstance, kind: string, seconds: number) => {
        (enemy as MockEnemy).afflictions.push({ kind, seconds });
        if (kind === 'burn') enemy.burning = Math.max(enemy.burning, seconds);
      },
    },
    fx: {
      tracer: (from: THREE.Vector3, to: THREE.Vector3, kind: string) => {
        tracers.push({ from: from.clone(), to: to.clone(), kind });
      },
      arc: (from: THREE.Vector3, to: THREE.Vector3) => {
        arcs.push({ from: from.clone(), to: to.clone() });
      },
      beam: vi.fn(),
      muzzleFlash: vi.fn(),
      explosion: vi.fn(),
      ring: vi.fn(),
      smoke: vi.fn(),
      sparks: (pos: THREE.Vector3, _dir: THREE.Vector3, count: number) => {
        sparks.push({ pos: pos.clone(), count });
      },
    },
    physics: {
      raycast: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) =>
        opts.wallHit ? opts.wallHit(origin, dir, maxDist) : null,
    },
    camera: {
      addTrauma: vi.fn(),
    },
    render: {
      scene,
      lights: { flash: vi.fn() },
    },
  } as unknown as Ctx;

  const sight: Sight = {
    view: { position: new THREE.Vector3(0, 4.5, 0) } as Sight['view'],
    aim: new THREE.Vector3(0, 0, -1),
    point: new THREE.Vector3(0, 1.0, -35),
    range: 35,
  };
  const mount = new THREE.Vector3(1.5, 5.2, -0.4);
  const feet = new THREE.Vector3(0, 0, 0);

  const makeUpdateCtx = (overrides: Partial<ShoulderUpdateContext> = {}): ShoulderUpdateContext => ({
    ctx,
    rounds: {} as Ac130Rounds,
    slot: 0,
    keyLabel: 'G',
    cycleKeyLabel: '3',
    sight,
    mountPos: out => out.copy(mount),
    feet,
    torsoYaw: 0,
    held: false,
    pressed: false,
    cyclePressed: false,
    online: true,
    gatherTargets: () => [],
    onMissile: null,
    onNews: (kind, values) => { news.push({ kind, values: [...values] }); },
    popFreeFlares: vi.fn(),
    ...overrides,
  });

  const makeRow = (): GunnerWeapon => ({ name: '', ammo: 0, max: 0, reload: -1, selected: false });

  return {
    ctx,
    scene,
    sight,
    mount,
    feet,
    explosions,
    napalms,
    rays,
    tracers,
    arcs,
    sparks,
    sounds,
    loops,
    news,
    makeUpdateCtx,
    makeRow,
  };
}

describe('Distraint Frame v2 Shoulder Weapons', () => {
  it('registers all 5 v2 shoulder plugins and exports both *_PLUGIN and *_SHOULDER aliases', () => {
    expect(SHOULDER_REGISTRY.twinGrenade).toBe(TWIN_GRENADE_PLUGIN);
    expect(SHOULDER_REGISTRY.laserOrbit).toBe(LASER_ORBIT_PLUGIN);
    expect(SHOULDER_REGISTRY.arcNeedle).toBe(ARC_NEEDLE_PLUGIN);
    expect(SHOULDER_REGISTRY.plasmaMissiles).toBe(PLASMA_MISSILES_PLUGIN);
    expect(SHOULDER_REGISTRY.shoulderGatling).toBe(SHOULDER_GATLING_PLUGIN);

    expect(TWIN_GRENADE_SHOULDER).toBe(TWIN_GRENADE_PLUGIN);
    expect(LASER_ORBIT_SHOULDER).toBe(LASER_ORBIT_PLUGIN);
    expect(ARC_NEEDLE_SHOULDER).toBe(ARC_NEEDLE_PLUGIN);
    expect(PLASMA_MISSILES_SHOULDER).toBe(PLASMA_MISSILES_PLUGIN);
    expect(SHOULDER_GATLING_SHOULDER).toBe(SHOULDER_GATLING_PLUGIN);
  });

  // ---------------------------------------------------------------------------
  // 1. Twin Shoulder Grenade Cannon
  // ---------------------------------------------------------------------------
  describe('twinGrenade (Twin Shoulder Grenade Cannon)', () => {
    it('fires simultaneous 2-shell HE salvos (280 dmg, 8 m radius), toggles NAPALM via cyclePressed, calls napalmBurst (140 dmg, 7.5 m), and reloads after 4 salvos', () => {
      const h = makeHarness();
      const weapon = TWIN_GRENADE_PLUGIN.create(h.ctx) as TwinGrenadeShoulder;

      expect(weapon.hasCycle).toBe(true);
      expect(weapon.mode).toBe('HE');
      expect(weapon.salvos).toBe(4);
      expect(weapon.shells).toBe(8);

      // Fire 1st HE salvo -> 2 airborne shells simultaneously.
      weapon.update(DT, h.makeUpdateCtx({ pressed: true, held: true }));
      expect(weapon.salvos).toBe(3);
      expect(weapon.shells).toBe(6);
      expect(weapon.activeShellCount).toBe(2);

      // Cannot fire again before 0.85 s cadence elapses.
      weapon.update(0.3, h.makeUpdateCtx({ pressed: true }));
      expect(weapon.salvos).toBe(3);

      // Step flight until both HE shells impact and detonate.
      for (let i = 0; i < 240 && weapon.activeShellCount > 0; i++) {
        weapon.update(DT, h.makeUpdateCtx());
      }
      expect(weapon.activeShellCount).toBe(0);
      expect(h.explosions.length).toBe(2);
      for (const ex of h.explosions) {
        expect(ex.spec.damage).toBe(280);
        expect(ex.spec.radius).toBe(8);
      }

      // Toggle to NAPALM via cyclePressed (`3`/`4`/`5`).
      weapon.update(DT, h.makeUpdateCtx({ cyclePressed: true }));
      expect(weapon.mode).toBe('NAPALM');

      const row = h.makeRow();
      weapon.fillRow(row, 'G', '3', true);
      expect(row.name).toContain('NAPALM');
      expect(row.ammo).toBe(6);
      expect(row.max).toBe(8);

      // Ensure 0.85 s salvo cadence has fully elapsed before firing NAPALM salvo.
      if (weapon.cooldown > 0) weapon.update(weapon.cooldown + DT, h.makeUpdateCtx());
      h.explosions.length = 0;
      weapon.update(DT, h.makeUpdateCtx({ pressed: true }));
      expect(weapon.salvos).toBe(2);
      expect(weapon.activeShellCount).toBe(2);

      for (let i = 0; i < 240 && weapon.activeShellCount > 0; i++) {
        weapon.update(DT, h.makeUpdateCtx());
      }
      expect(h.explosions.length).toBe(2);
      expect(h.napalms.length).toBe(2);
      for (const ex of h.explosions) {
        expect(ex.spec.damage).toBe(140);
      }
      for (const np of h.napalms) {
        expect(np.source).toBe('frame_twin_napalm');
        expect(np.radius).toBe(7.5);
      }

      // Fire remaining 2 salvos -> enters 4.5 s reload.
      weapon.update(TWIN_GRENADE.cadence, h.makeUpdateCtx());
      weapon.update(DT, h.makeUpdateCtx({ pressed: true }));
      expect(weapon.salvos).toBe(1);
      weapon.update(TWIN_GRENADE.cadence, h.makeUpdateCtx());
      weapon.update(DT, h.makeUpdateCtx({ pressed: true }));
      expect(weapon.salvos).toBe(0);
      expect(weapon.reloading).toBeCloseTo(TWIN_GRENADE.reload, 2);

      // Complete 4.5 s reload -> back to 4 salvos (8 shells).
      weapon.update(TWIN_GRENADE.reload + 0.05, h.makeUpdateCtx());
      expect(weapon.salvos).toBe(4);
      expect(weapon.reloading).toBe(-1);

      expect(dispatchShoulderRemoteNews(h.ctx, 'twinGrenade', [1, 0, 5, 0, 0, 2, -50])).toBe(true);
      weapon.reset();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Autonomous Laser Orbit Drones
  // ---------------------------------------------------------------------------
  describe('laserOrbit (Autonomous Laser Orbit Drones)', () => {
    it('deploys 2 physical 3D drone meshes, autonomously targets & fires 75 dmg pulses every 0.42 s, expires at 14 s into 16 s cooldown, and saves cooldown on early recall', () => {
      const e1 = makeEnemy(1, -2, 0, -24, 600);
      const e2 = makeEnemy(2, 3, 0, -28, 600);
      const farEnemy = makeEnemy(3, 0, 0, -90, 600); // outside 48 m range
      const h = makeHarness({ enemies: [e1, e2, farEnemy], withScene: true });
      const weapon = LASER_ORBIT_PLUGIN.create(h.ctx) as LaserOrbitShoulder;

      // Press G to deploy 2 drones.
      weapon.update(DT, h.makeUpdateCtx({ pressed: true }));
      expect(weapon.active).toBe(true);
      expect(weapon.activeDroneCount).toBe(2);
      expect(weapon.remaining).toBeCloseTo(LASER_ORBIT.duration - DT, 2);

      // Physical 3D drone meshes added to scene!
      const droneGroups = h.scene!.children.filter(c => c.name.startsWith('laser_orbit_drone_'));
      expect(droneGroups.length).toBe(2);
      expect(droneGroups.every(g => g.visible)).toBe(true);

      // Run for 1.5 s: both drones should acquire near enemies and fire multiple 75 dmg laser pulses.
      for (let i = 0; i < 90; i++) {
        weapon.update(DT, h.makeUpdateCtx());
      }
      const totalHits = e1.damageTaken.length + e2.damageTaken.length;
      expect(totalHits).toBeGreaterThanOrEqual(4);
      expect(e1.damageTaken.every(d => d.amount === 75)).toBe(true);
      expect(e2.damageTaken.every(d => d.amount === 75)).toBe(true);
      expect(farEnemy.damageTaken.length).toBe(0);
      expect(h.tracers.length).toBe(totalHits);

      // Press again to recall early after ~1.5 s -> saves partial cooldown (< 16 s) and detaches meshes!
      weapon.update(DT, h.makeUpdateCtx({ pressed: true }));
      expect(weapon.active).toBe(false);
      expect(weapon.cooldown).toBeGreaterThan(0);
      expect(weapon.cooldown).toBeLessThan(LASER_ORBIT.cooldown * 0.5);
      expect(h.scene!.children.filter(c => c.name.startsWith('laser_orbit_drone_')).length).toBe(0);

      // Wait out partial cooldown, redeploy, and let full 14 s expire -> full 16 s cooldown.
      weapon.update(weapon.cooldown + 0.1, h.makeUpdateCtx());
      expect(weapon.cooldown).toBe(0);
      weapon.update(DT, h.makeUpdateCtx({ pressed: true }));
      expect(weapon.active).toBe(true);

      // Advance past 14 s expiry.
      for (let i = 0; i < 15; i++) {
        weapon.update(1.0, h.makeUpdateCtx());
      }
      expect(weapon.active).toBe(false);
      expect(weapon.cooldown).toBeGreaterThan(14.5);
      expect(weapon.cooldown).toBeLessThanOrEqual(LASER_ORBIT.cooldown);
      expect(h.scene!.children.filter(c => c.name.startsWith('laser_orbit_drone_')).length).toBe(0);

      // Headless safety check (no render.scene.add).
      const headless = makeHarness({ enemies: [e1], withScene: false });
      const headlessWeapon = LASER_ORBIT_PLUGIN.create(headless.ctx) as LaserOrbitShoulder;
      expect(() => {
        headlessWeapon.update(DT, headless.makeUpdateCtx({ pressed: true }));
        headlessWeapon.update(0.5, headless.makeUpdateCtx());
        headlessWeapon.silence();
        headlessWeapon.reset();
      }).not.toThrow();

      expect(dispatchShoulderRemoteNews(h.ctx, 'orbit', [1, 4, 0, 0, 1, -20, 0])).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Shock-Needle Launcher
  // ---------------------------------------------------------------------------
  describe('arcNeedle (Shock-Needle Launcher)', () => {
    it('deals 240 direct hitscan dmg, embeds for 0.9 s, then detonates an 11 m shockwave (260 dmg) chaining cyan arcs to up to 4 nearby enemies (160 dmg each + stun/knockback)', () => {
      const primary = makeEnemy(10, 0, 0, -35, 1000);
      const near1 = makeEnemy(11, 4, 0, -35, 500);
      const near2 = makeEnemy(12, -5, 0, -34, 500);
      const near3 = makeEnemy(13, 0, 0, -29, 500);
      const near4 = makeEnemy(14, 2, 0, -42, 500);
      const near5 = makeEnemy(15, -7, 0, -40, 500); // 5th nearby enemy should NOT be chained (max 4)

      const h = makeHarness({
        enemies: [primary, near1, near2, near3, near4, near5],
        enemyRayHit: () => ({ enemy: primary, point: primary.center.clone(), distance: 35 }),
      });
      const weapon = ARC_NEEDLE_PLUGIN.create(h.ctx) as ArcNeedleShoulder;

      expect(weapon.charges).toBe(3);

      // Fire needle -> instant 240 direct damage & needle embedded.
      weapon.update(DT, h.makeUpdateCtx({ pressed: true }));
      expect(weapon.charges).toBe(2);
      expect(weapon.embeddedCount).toBe(1);
      expect(primary.damageTaken.length).toBe(1);
      expect(primary.damageTaken[0]!.amount).toBe(ARC_NEEDLE.directDamage);

      // Before 0.9 s elapses, shockwave has not detonated yet, but warning sparks pulse.
      weapon.update(0.5, h.makeUpdateCtx());
      expect(weapon.embeddedCount).toBe(1);
      expect(h.explosions.length).toBe(0);
      expect(h.sparks.length).toBeGreaterThan(1);

      // Step past 0.9 s embed timer -> 11 m shockwave (260 dmg) + 4 chained lightning arcs (160 dmg each).
      const tracersBeforeDet = h.tracers.length;
      weapon.update(0.45, h.makeUpdateCtx());
      expect(weapon.embeddedCount).toBe(0);
      expect(h.explosions.length).toBe(1);
      expect(h.explosions[0]!.spec.radius).toBe(11);
      expect(h.explosions[0]!.spec.damage).toBe(260);

      const chainedEnemies = [near1, near2, near3, near4, near5].filter(e => e.damageTaken.length > 0);
      expect(chainedEnemies.length).toBe(4);
      for (const ce of chainedEnemies) {
        expect(ce.damageTaken[0]!.amount).toBe(160);
        expect(ce.velocity.length()).toBeGreaterThan(0);
        expect(ce.staggerCalls).toBe(1);
      }
      // Cyan lightning tracers emitted for each of the 4 chain hops.
      expect(h.tracers.length - tracersBeforeDet).toBe(4);
      expect(h.arcs.length).toBe(4);

      // Charge refills after 4.2 s.
      weapon.update(ARC_NEEDLE.refillSeconds, h.makeUpdateCtx());
      expect(weapon.charges).toBe(3);

      expect(dispatchShoulderRemoteNews(h.ctx, 'arcNeedle', [1, 0, 1, -35, 0, 0, 0])).toBe(true);
      weapon.reset();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Vertical Plasma Missile Rack
  // ---------------------------------------------------------------------------
  describe('plasmaMissiles (Vertical Plasma Missile Rack)', () => {
    it('paints up to 6 targets while held, launches 6 vertical-climb missiles on release that detonate into lingering 5.0 m plasma domes (150 impact + 90 DPS for 2.4 s), and reloads in 5.5 s', () => {
      const e1 = makeEnemy(21, -3, 0, -30, 1500);
      const e2 = makeEnemy(22, 3, 0, -30, 1500);
      const candidates: PaintCandidate[] = [
        { target: e1, angle: 0.05 },
        { target: e2, angle: 0.12 },
      ];
      const gatherSpy = vi.fn(() => candidates);
      const h = makeHarness({ enemies: [e1, e2] });
      const weapon = PLASMA_MISSILES_PLUGIN.create(h.ctx) as PlasmaMissilesShoulder;

      // Hold trigger to paint targets.
      weapon.update(DT, h.makeUpdateCtx({ held: true, pressed: true, gatherTargets: gatherSpy }));
      for (let i = 0; i < 40; i++) {
        weapon.update(DT, h.makeUpdateCtx({ held: true, gatherTargets: gatherSpy }));
      }
      expect(gatherSpy).toHaveBeenCalledWith(110, Math.cos(0.42));
      expect(weapon.marks.length).toBeGreaterThanOrEqual(2);

      // Release trigger -> starts 6-missile vertical salvo!
      weapon.update(DT, h.makeUpdateCtx({ held: false, gatherTargets: gatherSpy }));
      expect(weapon.ammo).toBe(0);
      expect(weapon.activeMissileCount).toBeGreaterThanOrEqual(1);

      // Drain remaining 5 staggered cells (~0.5 s).
      for (let i = 0; i < 35; i++) {
        weapon.update(DT, h.makeUpdateCtx({ held: false, gatherTargets: gatherSpy }));
      }
      expect(weapon.reloading).toBeGreaterThan(0);

      // Step flight until all 6 missiles impact and spawn lingering plasma domes.
      let sawDome = false;
      let maxDomes = 0;
      for (let i = 0; i < 180; i++) {
        weapon.update(DT, h.makeUpdateCtx());
        if (weapon.activeDomeCount > 0) {
          sawDome = true;
          maxDomes = Math.max(maxDomes, weapon.activeDomeCount);
        }
      }
      expect(h.explosions.length).toBe(6);
      expect(h.explosions.every(ex => ex.spec.damage === 150 && ex.spec.radius === 5.0)).toBe(true);
      expect(sawDome).toBe(true);
      expect(maxDomes).toBeGreaterThanOrEqual(2);

      // Enemies inside the plasma domes take ongoing 90 DPS tick damage.
      const totalDomeDmg =
        e1.damageTaken.reduce((s, d) => s + d.amount, 0) +
        e2.damageTaken.reduce((s, d) => s + d.amount, 0);
      expect(totalDomeDmg).toBeGreaterThan(200);

      // After 2.5 s more, all lingering 2.4 s domes expire cleanly, and 5.5 s reload finishes.
      for (let i = 0; i < 200; i++) {
        weapon.update(DT, h.makeUpdateCtx());
      }
      expect(weapon.activeDomeCount).toBe(0);
      expect(weapon.ammo).toBe(6);
      expect(weapon.reloading).toBe(-1);

      // Tap without hold (no painted marks) -> launches 6 blind vertical missiles onto crosshair point.
      h.explosions.length = 0;
      weapon.update(DT, h.makeUpdateCtx({ held: true, pressed: true, gatherTargets: () => [] }));
      weapon.update(DT, h.makeUpdateCtx({ held: false, gatherTargets: () => [] }));
      expect(weapon.ammo).toBe(0);
      for (let i = 0; i < 200; i++) {
        weapon.update(DT, h.makeUpdateCtx());
      }
      expect(h.explosions.length).toBe(6);

      expect(dispatchShoulderRemoteNews(h.ctx, 'plasmaMissiles', [1, 0, 1, -30])).toBe(true);
      weapon.reset();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. 4-Barrel Shoulder Minigun
  // ---------------------------------------------------------------------------
  describe('shoulderGatling (4-Barrel Shoulder Minigun)', () => {
    it('fires continuously at 28 rds/s (26 dmg), builds heat at 22/s to 100% overheat lockout (2.6 s), cools at 30/s, and toggles AP vs INCENDIARY rounds', () => {
      const target = makeEnemy(30, 0, 0, -25, 1000);
      const h = makeHarness({ enemies: [target] });
      const weapon = SHOULDER_GATLING_PLUGIN.create(h.ctx) as ShoulderGatlingShoulder;

      expect(weapon.hasCycle).toBe(true);
      expect(weapon.mode).toBe('AP');
      expect(weapon.heat).toBe(0);

      // Hold trigger for 1.0 s -> ~28 rounds fired, ~22% heat.
      weapon.update(DT, h.makeUpdateCtx({ held: true, pressed: true }));
      for (let i = 1; i < 60; i++) {
        weapon.update(DT, h.makeUpdateCtx({ held: true }));
      }
      expect(h.rays.length).toBeGreaterThanOrEqual(27);
      expect(h.rays.length).toBeLessThanOrEqual(30);
      expect(h.rays[0]!.spec.damage).toBe(26);
      expect(h.rays[0]!.spec.maxDistance).toBe(120);
      expect(h.rays[0]!.spec.armorPiercing).toBe(true);
      expect(weapon.heat).toBeCloseTo(22, 0);

      // Release trigger for 0.5 s -> cools at 30/s (22 -> 7).
      for (let i = 0; i < 30; i++) {
        weapon.update(DT, h.makeUpdateCtx({ held: false }));
      }
      expect(weapon.heat).toBeCloseTo(7, 0);

      // Cycle to INCENDIARY and verify burn affliction on hit.
      weapon.update(DT, h.makeUpdateCtx({ cyclePressed: true }));
      expect(weapon.mode).toBe('INCENDIARY');
      weapon.update(DT, h.makeUpdateCtx({ held: true, pressed: true }));
      expect(target.afflictions.some(a => a.kind === 'burn')).toBe(true);

      // Hold continuously until overheat (~4.3 s more at 22/s).
      for (let i = 0; i < 300 && !weapon.overheated; i++) {
        weapon.update(DT, h.makeUpdateCtx({ held: true }));
      }
      expect(weapon.overheated).toBe(true);
      expect(weapon.overheatRemaining).toBeCloseTo(SHOULDER_GATLING.overheatLockout, 1);

      // Cannot fire during 2.6 s overheat vent lockout.
      const raysAtOverheat = h.rays.length;
      weapon.update(1.0, h.makeUpdateCtx({ held: true, pressed: true }));
      expect(h.rays.length).toBe(raysAtOverheat);
      expect(weapon.overheated).toBe(true);

      // After remaining 1.65 s, overheat clears cleanly and heat resets to 0.
      weapon.update(1.65, h.makeUpdateCtx({ held: false }));
      expect(weapon.overheated).toBe(false);
      expect(weapon.heat).toBe(0);

      expect(dispatchShoulderRemoteNews(h.ctx, 'shoulderGatling', [0, 1, 5, 0, 0, 1, -25])).toBe(true);
      weapon.reset();
    });
  });

  // ---------------------------------------------------------------------------
  // 6. All 5 Sculpted 3D Shoulder Model Builders
  // ---------------------------------------------------------------------------
  describe('v2 Shoulder 3D Model Builders', () => {
    const models: readonly (readonly [string, (b: ModelBuilder) => void])[] = [
      ['twinGrenade', buildTwinGrenade],
      ['laserOrbit', buildLaserOrbit],
      ['arcNeedle', buildArcNeedle],
      ['plasmaMissiles', buildPlasmaMissiles],
      ['shoulderGatling', buildShoulderGatling],
    ];

    for (const [name, build] of models) {
      it(`builds finite non-empty solid and glow geometry for ${name} and remaps palettes cleanly`, () => {
        expect(SHOULDER_MODELS[name as keyof typeof SHOULDER_MODELS]).toBe(build);

        const b = new ModelBuilder();
        build(b);
        const solid = b.solidGeometry();
        const glow = b.glowGeometry();

        expect(solid).not.toBeNull();
        expect(glow).not.toBeNull();

        const solidPos = solid!.getAttribute('position');
        const glowPos = glow!.getAttribute('position');
        expect(solidPos.count).toBeGreaterThan(100);
        expect(glowPos.count).toBeGreaterThan(12);

        for (let i = 0; i < solidPos.array.length; i++) {
          expect(Number.isFinite(solidPos.array[i])).toBe(true);
        }
        for (let i = 0; i < glowPos.array.length; i++) {
          expect(Number.isFinite(glowPos.array[i])).toBe(true);
        }

        // Verify palette remapping works cleanly via PaletteModelBuilder.
        const pb = createFrameBuilder(FRAME_PALETTES.arctic);
        build(pb);
        const pSolid = pb.solidGeometry();
        expect(pSolid).not.toBeNull();
        const colA = solid!.getAttribute('color');
        const colB = pSolid!.getAttribute('color');
        let diffs = 0;
        for (let i = 0; i < Math.min(colA.array.length, colB.array.length); i++) {
          if (Math.abs(colA.array[i]! - colB.array[i]!) > 1e-3) diffs++;
        }
        expect(diffs).toBeGreaterThan(0);

        solid!.dispose();
        glow!.dispose();
        pSolid!.dispose();
      });
    }
  });
});
