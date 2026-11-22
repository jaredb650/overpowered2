/**
 * Lane C launcher suite:
 * - Rocket tube/WP mods + optic laser sockets, RGL (mgl) barrel/trigger mods + zero-roll shell-loading reload, Howitzer cluster fuze mod
 * - 400 m Rocket laser reach in `lam.ts`
 * - Fiery `'howitzer'` explosion recipe in `explosions.ts` (with `'finisher'` preserved) + mech 105 mm arm wiring in `frame/arms/shared.ts`
 * - 6 m / 12 s 3D airborne White Phosphorus cloud in `wp.ts`
 * - 7 m standoff fuze + 18-bomblet carpet in `cluster.ts` (reusing `frame/bomblets.ts`)
 */
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Ctx, DamageInfo, ExplosionOptions, RayHit } from '../core/contracts';
import type { EnemyInstance, ExplosionSpec, ModId } from '../core/gameplay';
import { shellImpact } from '../frame/arms/shared';
import { activeBombletCount, clearBomblets, updateBomblets } from '../frame/bomblets';
import { explosion, hasExplosionRecipe, HOWITZER_EXPLOSION_KIND } from '../fx/recipes/explosions';
import type { FxCore } from '../fx/core';
import { CLUSTER, checkClusterStandoff, detonateCluster } from './cluster';
import { WP, WpCloud } from './wp';
import { Anim } from './viewmodels/def';
import { Kit } from './viewmodels/kit/kit';
import type { VmMaterials } from './viewmodels/kit/materials';
import { LAM, LamBeams, laserEnd, ROCKET_LAM_RANGE, type LaserCast } from './viewmodels/lam';
import { howitzerDef } from './viewmodels/models/howitzer';
import { mglDef } from './viewmodels/models/mgl';
import { rocketDef } from './viewmodels/models/rocket';
import { dressModel, restingModel } from './viewmodels/rest';

function makeEnemy(id: number, pos: THREE.Vector3, height = 1.8): EnemyInstance {
  return {
    uid: id,
    alive: true,
    position: pos.clone(),
    center: pos.clone().add(new THREE.Vector3(0, height * 0.55, 0)),
    char: { rig: { height } },
  } as unknown as EnemyInstance;
}

function makeHit(): RayHit {
  return { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };
}

function wallCast(at: number): LaserCast {
  return (o, d, max, out) => {
    if (at > max) return false;
    out.point.copy(o).addScaledVector(d, at);
    out.normal.copy(d).negate();
    out.distance = at;
    return true;
  };
}

describe('Lane C viewmodels: Rocket, RGL (mgl), and Howitzer', () => {
  let kit: Kit;

  beforeAll(() => {
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 168,
        height: 76,
        getContext: () => ({
          createRadialGradient: () => ({ addColorStop() {} }),
          fillRect() {},
          fillText() {},
        }),
      }),
    });
    const material = new THREE.MeshStandardMaterial();
    kit = new Kit({
      hard: material,
      glass: material,
      decal: material,
      decalRegions: new Proxy({}, { get: () => [0, 0, 1, 1] }),
      glow(color: number, intensity: number) {
        const glow = new THREE.MeshBasicMaterial({ color });
        glow.color.multiplyScalar(intensity);
        glow.userData.base = glow.color.clone();
        return glow;
      },
    } as unknown as VmMaterials);
  });

  afterAll(() => vi.unstubAllGlobals());

  it('builds Rocket rocketTube, rocketWp, and lam/lamAim sockets cleanly', () => {
    const def = rocketDef(kit);
    const { model } = def;

    expect(model.parts.tubeLong).toBeDefined();
    expect(model.parts.muzzleStd).toBeDefined();
    expect(model.parts.wpKit).toBeDefined();
    expect(model.parts.wpNose).toBeDefined();
    expect(model.sockets.muzzle).toBeDefined();
    expect(model.sockets.muzzleLong).toBeDefined();
    expect(model.sockets.lam).toBeDefined();
    expect(model.sockets.lamAim).toBeDefined();

    // Extended tube muzzle sits cleanly ahead (-Z) of the stock muzzle.
    expect(model.sockets.muzzleLong!.position.z).toBeLessThan(model.sockets.muzzle!.position.z - 0.2);

    // Shop turntable dressing toggles parts properly.
    const { root } = restingModel('rocket', def);
    dressModel(root, def, new Set<ModId>());
    expect(root.getObjectByName('muzzleStd')?.visible).toBe(true);
    expect(root.getObjectByName('tubeLong')?.visible).toBe(false);
    expect(root.getObjectByName('wpKit')?.visible).toBe(false);
    expect(root.getObjectByName('wpNose')?.visible).toBe(false);

    dressModel(root, def, new Set<ModId>(['rocketTube', 'rocketWp']));
    expect(root.getObjectByName('muzzleStd')?.visible).toBe(false);
    expect(root.getObjectByName('tubeLong')?.visible).toBe(true);
    expect(root.getObjectByName('wpKit')?.visible).toBe(true);
    expect(root.getObjectByName('wpNose')?.visible).toBe(true);
  });

  it('builds RGL (mgl) mglLong and mglTrigger parts/sockets cleanly', () => {
    const def = mglDef(kit);
    const { model } = def;

    expect(model.parts.barrelLong).toBeDefined();
    expect(model.parts.triggerStd).toBeDefined();
    expect(model.parts.triggerMatch).toBeDefined();
    expect(model.parts.triggerHousing).toBeDefined();
    expect(model.parts.shellIn).toBeDefined();
    for (let i = 0; i < 6; i++) expect(model.parts[`round${i}`]).toBeDefined();
    expect(model.sockets.muzzleLong!.position.z).toBeLessThan(model.sockets.muzzle!.position.z - 0.18);

    const { root } = restingModel('mgl', def);
    dressModel(root, def, new Set<ModId>(['mglLong', 'mglTrigger']));
    expect(root.getObjectByName('barrelLong')?.visible).toBe(true);
    expect(root.getObjectByName('triggerMatch')?.visible).toBe(true);
    expect(root.getObjectByName('triggerStd')?.visible).toBe(false);
    expect(root.getObjectByName('triggerHousing')?.visible).toBe(true);
  });

  it('keeps ZERO gun roll (gunR.z === 0) across the entire RGL (mgl) reload curve p in [0, 1] and loads shells cleanly', () => {
    const def = mglDef(kit);
    const a = new Anim();
    a.parts = def.model.parts;
    a.model = def.model;
    a.mag = 0;
    a.magSize = 6;
    a.draw = 1;
    a.sinceFire = 10;

    let maxYokeOpen = 0;
    let sawShellCarried = false;
    let sawAllEmpty = false;
    let sawPartial2 = false;
    let sawPartial4 = false;
    let sawAll6Seated = false;

    for (let i = 0; i <= 100; i++) {
      const p = i / 100;
      def.model.resetParts();
      a.gunP.set(0, 0, 0);
      a.gunR.set(0, 0, 0);
      a.left.begin(def.left);
      a.reload = p;
      def.animate(a);

      // Strict house rule: ZERO roll/twist during reload.
      expect(a.gunR.z, `gunR.z at p=${p}`).toBe(0);

      maxYokeOpen = Math.max(maxYokeOpen, def.model.parts.yoke!.rotation.z);
      if (def.model.parts.shellIn!.visible) sawShellCarried = true;

      const visibleRounds = [0, 1, 2, 3, 4, 5].filter(k => def.model.parts[`round${k}`]!.visible).length;
      if (p >= 0.20 && p < 0.24 && visibleRounds === 0) sawAllEmpty = true;
      if (visibleRounds === 2) sawPartial2 = true;
      if (visibleRounds === 4) sawPartial4 = true;
      if (p >= 0.62 && visibleRounds === 6) sawAll6Seated = true;
    }

    expect(maxYokeOpen).toBeGreaterThan(1.1);
    expect(sawAllEmpty).toBe(true);
    expect(sawShellCarried).toBe(true);
    expect(sawPartial2).toBe(true);
    expect(sawPartial4).toBe(true);
    expect(sawAll6Seated).toBe(true);
  });

  it('builds Howitzer howitzerCluster visual mod parts cleanly', () => {
    const def = howitzerDef(kit);
    expect(def.model.parts.clusterFuze).toBeDefined();
    expect(def.model.parts.clusterBand).toBeDefined();
    expect(def.model.parts.clusterShell).toBeDefined();

    const { root } = restingModel('howitzer', def);
    dressModel(root, def, new Set<ModId>());
    expect(root.getObjectByName('clusterFuze')?.visible).toBe(false);
    expect(root.getObjectByName('clusterBand')?.visible).toBe(false);

    dressModel(root, def, new Set<ModId>(['howitzerCluster']));
    expect(root.getObjectByName('clusterFuze')?.visible).toBe(true);
    expect(root.getObjectByName('clusterBand')?.visible).toBe(true);
  });
});

describe('Rocket 400 m laser reach in lam.ts', () => {
  const eye = new THREE.Vector3(0, 1.6, 0);
  const look = new THREE.Vector3(0, 0, -1);

  it('supports 400 m reach via laserEnd and LamBeams.set without breaking 40 m pistol default', () => {
    expect(ROCKET_LAM_RANGE).toBe(400);
    const end = new THREE.Vector3();

    // Default 40 m misses a target at 250 m.
    expect(laserEnd(eye, look, wallCast(250), makeHit(), end)).toBe(false);
    expect(end.distanceTo(eye)).toBeCloseTo(LAM.range);

    // Rocket 400 m reach hits targets at 250 m and 380 m, misses at 450 m.
    expect(laserEnd(eye, look, wallCast(250), makeHit(), end, ROCKET_LAM_RANGE)).toBe(true);
    expect(end.distanceTo(eye)).toBeCloseTo(250);
    expect(laserEnd(eye, look, wallCast(380), makeHit(), end, ROCKET_LAM_RANGE)).toBe(true);
    expect(end.distanceTo(eye)).toBeCloseTo(380);
    expect(laserEnd(eye, look, wallCast(450), makeHit(), end, ROCKET_LAM_RANGE)).toBe(false);
    expect(end.distanceTo(eye)).toBeCloseTo(400);

    // LamBeams tracks 400 m on rocket slot and reverts cleanly to 40 m when slot switches back to a pistol LAM.
    const beams = new LamBeams();
    const sock = new THREE.Object3D();
    beams.set(0, sock, 1, ROCKET_LAM_RANGE);
    expect(beams.effectiveRange()).toBe(400);
    beams.target(eye, look, wallCast(320));
    expect(beams.dotOn()).toBe(true);
    expect(beams.end.distanceTo(eye)).toBeCloseTo(320);

    // Switch back to default 40 m pistol LAM.
    beams.set(0, sock, 1);
    expect(beams.effectiveRange()).toBe(40);
    beams.target(eye, look, wallCast(320));
    expect(beams.dotOn()).toBe(false);
    expect(beams.end.distanceTo(eye)).toBeCloseTo(40);
  });
});

describe('Howitzer fiery explosion recipe and mech 105 mm arm wiring', () => {
  it('adds fiery howitzer recipe while leaving finisher intact', () => {
    expect(hasExplosionRecipe(HOWITZER_EXPLOSION_KIND)).toBe(true);
    expect(hasExplosionRecipe('finisher')).toBe(true);

    const makeMockCore = () => {
      const lights: Array<{ color: THREE.ColorRepresentation; intensity: number; duration: number }> = [];
      const smokeStarts: Array<{ mode: number; life: number }> = [];
      let streakCount = 0;
      const core = {
        birth: 0,
        now: 0,
        shockColor: { r: 1, g: 1, b: 1 },
        waveColor: { r: 1, g: 1, b: 1 },
        floorAt: () => 0,
        smoke: {
          begin: (_c: unknown, _a: number, _b: number, life: number, _s0: number, _s1: number, _d: number, _r: number, _e: number, mode: number) => {
            smokeStarts.push({ mode, life });
          },
          add: () => {},
        },
        chips: { begin: () => ({ add: () => {} }) },
        streaks: {
          begin: () => ({
            setLife: () => {},
            add: () => { streakCount++; },
          }),
        },
        shock: { add: () => {} },
        flashes: { star: () => {} },
        waves: { add: () => {} },
        shimmer: { add: () => {} },
        ctx: {
          render: {
            camera: { position: new THREE.Vector3(0, 2, 30) },
            lights: {
              flash: (_p: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, _r: number, duration: number) => {
                lights.push({ color, intensity, duration });
              },
            },
            decals: { add: () => {} },
            post: { chromatic: () => {}, radialBlur: () => {} },
          },
        },
      } as unknown as FxCore;
      return { core, lights, smokeStarts, getStreaks: () => streakCount };
    };

    const fin = makeMockCore();
    explosion(fin.core, new THREE.Vector3(0, 1, 0), { kind: 'finisher', radius: 13.5, scale: 1 });
    expect(fin.lights[0]!.color).toBe(0xcfe4ff);

    const how = makeMockCore();
    explosion(how.core, new THREE.Vector3(0, 1, 0), { kind: 'howitzer', radius: 13.5, scale: 1 });
    // Warm fiery orange light, longer flash, more streaks/embers, and lingering flames.
    expect(how.lights[0]!.color).toBe(0xff7a22);
    expect(how.lights[0]!.duration).toBeGreaterThan(fin.lights[0]!.duration);
    expect(how.getStreaks()).toBeGreaterThan(fin.getStreaks());
    expect(how.smokeStarts.length).toBeGreaterThan(fin.smokeStarts.length);
  });

  it('points mech 105 mm arm shellImpact to the howitzer explosion kind', () => {
    const fxCalls: ExplosionOptions[] = [];
    const ctx = {
      combat: { explode: vi.fn() },
      fx: {
        explosion: (_p: THREE.Vector3, opts: ExplosionOptions) => fxCalls.push(opts),
        ring: vi.fn(),
        sparks: vi.fn(),
        chips: vi.fn(),
        smoke: vi.fn(),
        heatShimmer: vi.fn(),
      },
      audio: { play: vi.fn() },
      enemies: { query: () => 0, applyDamage: vi.fn(), vehicles: { frameBlow: vi.fn() } },
      physics: { radialImpulse: vi.fn() },
      world: { objects: { damageExplosivesInRadius: vi.fn() } },
      render: { lights: { flash: vi.fn() }, decals: { add: vi.fn() }, post: { radialBlur: vi.fn() } },
      camera: { addTrauma: vi.fn() },
    } as unknown as Ctx;

    shellImpact(ctx, 'g105', new THREE.Vector3(10, 0, -20), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
    expect(fxCalls.length).toBe(1);
    expect(fxCalls[0]!.kind).toBe('howitzer');
  });
});

describe('WpCloud (White Phosphorus 6 m / 12 s airborne 3D burning cloud)', () => {
  function makeWpCtx(enemiesList: EnemyInstance[]) {
    const afflicted: Array<{ uid: number; kind: string; seconds: number }> = [];
    const damaged: Array<{ uid: number; amount: number; source: string }> = [];
    const smokeCalls: THREE.Vector3[] = [];
    const ctx = {
      physics: { raycastInto: () => false },
      enemies: {
        alive: enemiesList,
        query: (_center: THREE.Vector3, _radius: number, out: EnemyInstance[]) => {
          out.length = 0;
          for (const e of enemiesList) out.push(e);
          return out.length;
        },
        afflict: (e: EnemyInstance, kind: string, seconds: number) => {
          afflicted.push({ uid: e.uid, kind, seconds });
        },
        applyDamage: (e: EnemyInstance, info: DamageInfo) => {
          damaged.push({ uid: e.uid, amount: info.amount, source: info.source });
        },
      },
      fx: {
        napalm: vi.fn(),
        ring: vi.fn(),
        sparks: vi.fn(),
        embers: vi.fn(),
        smoke: (p: THREE.Vector3) => smokeCalls.push(p.clone()),
      },
      render: { lights: { flash: vi.fn() }, decals: { add: vi.fn() } },
      audio: { play: vi.fn() },
    } as unknown as Ctx;
    return { ctx, afflicted, damaged, smokeCalls };
  }

  it('spawns a 6 m cloud lasting 12 s, catches enemies at chest height and elevated stairs, and expires after 12 s', () => {
    expect(WP.diameter).toBe(6);
    expect(WP.radius).toBe(3);
    expect(WP.duration).toBe(12);

    // Cloud centered in mid-air / stair landing at (0, 1.5, 0) with radius 3 m:
    const chestFloorEnemy = makeEnemy(1, new THREE.Vector3(1.2, 0, 0));       // floor enemy at chest height inside cloud
    const stairsEnemy = makeEnemy(2, new THREE.Vector3(-1.0, 3.2, 0.8));      // elevated stairs enemy inside 3D sphere
    const farHorizEnemy = makeEnemy(3, new THREE.Vector3(6.0, 1.5, 0));       // outside 3 m radius horizontally
    const highRoofEnemy = makeEnemy(4, new THREE.Vector3(0, 7.0, 0));         // well above the 3D cloud

    const { ctx, afflicted, damaged, smokeCalls } = makeWpCtx([
      chestFloorEnemy, stairsEnemy, farHorizEnemy, highRoofEnemy,
    ]);
    const wp = new WpCloud(ctx);

    wp.spawn(new THREE.Vector3(0, 1.5, 0), 'rocket_wp');
    expect(wp.activeCount).toBe(1);

    wp.update(0.1);
    expect(smokeCalls.length).toBeGreaterThan(0);

    // Both chest-height floor enemy AND elevated stairs enemy are ignited & burned; outside enemies are untouched.
    const hitUids = new Set(afflicted.map(a => a.uid));
    expect(hitUids.has(1)).toBe(true);
    expect(hitUids.has(2)).toBe(true);
    expect(hitUids.has(3)).toBe(false);
    expect(hitUids.has(4)).toBe(false);
    expect(afflicted.every(a => a.kind === 'burn')).toBe(true);

    const dmgUids = new Set(damaged.map(d => d.uid));
    expect(dmgUids.has(1)).toBe(true);
    expect(dmgUids.has(2)).toBe(true);
    expect(dmgUids.has(3)).toBe(false);
    expect(dmgUids.has(4)).toBe(false);

    // Still active at 11.5 s, expires cleanly past 12 s.
    wp.update(11.4);
    expect(wp.activeCount).toBe(1);
    wp.update(0.6);
    expect(wp.activeCount).toBe(0);
  });

  it('skips all damage and burn affliction in cosmetic co-op mode and clears on reset()', () => {
    const enemy = makeEnemy(10, new THREE.Vector3(0, 0, 0));
    const { ctx, afflicted, damaged } = makeWpCtx([enemy]);
    const wp = new WpCloud(ctx);

    wp.spawn(new THREE.Vector3(0, 1, 0), 'rocket_wp', true);
    expect(wp.activeCount).toBe(1);
    wp.update(0.5);
    expect(afflicted.length).toBe(0);
    expect(damaged.length).toBe(0);

    wp.reset();
    expect(wp.activeCount).toBe(0);
  });
});

describe('Howitzer Cluster Shell (cluster.ts)', () => {
  it('triggers standoff fuze ~7 m short of a wall or an enemy and ignores distant obstacles', () => {
    const pos = new THREE.Vector3(0, 2, 0);
    const dir = new THREE.Vector3(0, 0, -1);

    // Wall at 30 m ahead: far from 1-frame step (speed 195, dt 1/60 -> step 3.25 m).
    const farCtx = {
      physics: {
        raycastInto: (o: THREE.Vector3, d: THREE.Vector3, max: number, _g: number, out: RayHit) => {
          if (30 > max) return false;
          out.distance = 30;
          out.point.copy(o).addScaledVector(d, 30);
          out.normal.set(0, 0, 1);
          return true;
        },
      },
      enemies: { query: () => 0 },
    } as unknown as Ctx;
    expect(checkClusterStandoff(farCtx, pos, dir, 195, 1 / 60)).toBeNull();

    // Wall at 9 m ahead: bursts at 2 m ahead of pos (7 m short of wall).
    const nearWallCtx = {
      physics: {
        raycastInto: (o: THREE.Vector3, d: THREE.Vector3, max: number, _g: number, out: RayHit) => {
          if (9 > max) return false;
          out.distance = 9;
          out.point.copy(o).addScaledVector(d, 9);
          out.normal.set(0, 0, 1);
          return true;
        },
      },
      enemies: { query: () => 0 },
    } as unknown as Ctx;
    const wallBurst = checkClusterStandoff(nearWallCtx, pos, dir, 195, 1 / 60, new THREE.Vector3());
    expect(wallBurst).not.toBeNull();
    expect(wallBurst!.z).toBeCloseTo(-2, 4); // 9 m wall - 7 m standoff = 2 m ahead along -Z

    // Enemy at 10 m ahead along -Z: bursts at 3 m ahead of pos (7 m short of enemy).
    const enemy = makeEnemy(7, new THREE.Vector3(0.4, 1.0, -10));
    const enemyCtx = {
      physics: { raycastInto: () => false },
      enemies: {
        alive: [enemy],
        query: (_c: THREE.Vector3, _r: number, out: EnemyInstance[]) => {
          out.length = 0;
          out.push(enemy);
          return 1;
        },
      },
    } as unknown as Ctx;
    const enemyBurst = checkClusterStandoff(enemyCtx, pos, dir, 195, 0.02, new THREE.Vector3());
    expect(enemyBurst).not.toBeNull();
    expect(enemyBurst!.z).toBeCloseTo(-3, 4); // 10 m enemy - 7 m standoff = 3 m ahead along -Z
  });

  it('detonates 18 bomblets over a 10 m by 7 m carpet via bombletCarpet', () => {
    expect(CLUSTER.count).toBe(18);
    expect(CLUSTER.length).toBe(10);
    expect(CLUSTER.width).toBe(7);
    expect(CLUSTER.ripple).toBe(0.6);
    expect(CLUSTER.blastRadius).toBe(2.2);
    expect(CLUSTER.damage).toBe(65);

    const blasts: Array<{ pos: THREE.Vector3; spec: ExplosionSpec }> = [];
    const ctx = {
      combat: {
        explode: (p: THREE.Vector3, spec: ExplosionSpec) => {
          blasts.push({ pos: p.clone(), spec: { ...spec } });
        },
      },
      physics: {
        raycastInto: (o: THREE.Vector3, d: THREE.Vector3, max: number, _g: number, out: RayHit) => {
          // Flat floor at y = 0.
          if (d.y < -1e-4) {
            const t = -o.y / d.y;
            if (t >= 0 && t <= max) {
              out.point.copy(o).addScaledVector(d, t);
              out.normal.set(0, 1, 0);
              out.distance = t;
              return true;
            }
          }
          return false;
        },
        radialImpulse: vi.fn(),
      },
      fx: { ring: vi.fn(), sparks: vi.fn(), smoke: vi.fn() },
      render: { lights: { flash: vi.fn() } },
      audio: { play: vi.fn() },
    } as unknown as Ctx;

    clearBomblets(ctx);
    detonateCluster(ctx, new THREE.Vector3(0, 4, 0), new THREE.Vector3(0, 0, -1), 'howitzer_cluster', false);
    expect(activeBombletCount(ctx)).toBe(18);

    // Step 1.2 s so all 18 bomblets finish their 0.6 s ripple.
    for (let i = 0; i < 60; i++) updateBomblets(0.02, ctx);
    expect(activeBombletCount(ctx)).toBe(0);
    expect(blasts.length).toBe(18);
    for (const b of blasts) {
      expect(b.spec.radius).toBeCloseTo(2.2);
      expect(b.spec.damage).toBe(65);
      expect(b.spec.source).toBe('howitzer_cluster');
      expect(b.spec.cosmetic).toBe(false);
    }

    // Cosmetic mode passes cosmetic=true through to bombletCarpet.
    blasts.length = 0;
    detonateCluster(ctx, new THREE.Vector3(0, 4, 0), new THREE.Vector3(0, 0, -1), 'howitzer_cluster', true);
    expect(activeBombletCount(ctx)).toBe(18);
    for (let i = 0; i < 60; i++) updateBomblets(0.02, ctx);
    expect(blasts.length).toBe(18);
    expect(blasts.every(b => b.spec.cosmetic === true)).toBe(true);
    clearBomblets(ctx);
  });
});
