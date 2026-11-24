/**
 * Howitzer Cluster Shell (`howitzerCluster` alternate ammo on the 105 mm Howitzer, toggled with hold R).
 *
 * Uses a standoff proximity fuze patterned on `src/weapons/flak.ts` that bursts ~7 m short of the first wall, floor,
 * or enemy surface along the shell's line of flight, and calls `bombletCarpet` in `src/frame/bomblets.ts` directly to
 * carpet a 10 m by 7 m area with 18 wall-bouncing submunition bomblets rippling over 0.6 s (~2.2 m blast, ~65 damage).
 */
import * as THREE from 'three';
import { CG, type Ctx, type RayHit } from '../core/contracts';
import type { EnemyInstance } from '../core/gameplay';
import { bombletCarpet, type BombletSpec } from '../frame/bomblets';

export const CLUSTER = {
  /** Distance short of a wall, floor, or enemy surface where the standoff fuze bursts, metres. */
  standoff: 7,
  /** Cylinder radius off the shell's flight line within which an enemy triggers the standoff fuze, metres. */
  prox: 2.5,
  /** Number of submunition bomblets spawned into the forward carpet. */
  count: 18,
  /** Forward length of the bomblet carpet, metres. */
  length: 10,
  /** Side-to-side width of the bomblet carpet, metres. */
  width: 7,
  /** Staggered detonation ripple duration across the carpet, seconds. */
  ripple: 0.6,
  /** Blast radius per bomblet, metres. */
  blastRadius: 2.2,
  /** Blast damage per bomblet. */
  damage: 65,
  /** Visual ring scale for the airburst canister pop at the standoff point, metres. */
  airburstRadius: 3.2,
} as const;

export const HOWITZER_CLUSTER_SPEC: Readonly<BombletSpec> = {
  count: CLUSTER.count,
  length: CLUSTER.length,
  width: CLUSTER.width,
  ripple: CLUSTER.ripple,
  blastRadius: CLUSTER.blastRadius,
  damage: CLUSTER.damage,
  circular: false,
  source: 'howitzer_cluster',
};

const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _burstOut = new THREE.Vector3();
const _near: EnemyInstance[] = [];
const _hit: RayHit = {
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  distance: 0,
  surface: 'concrete',
  collider: null,
};
const _spec: BombletSpec = {
  count: CLUSTER.count,
  length: CLUSTER.length,
  width: CLUSTER.width,
  ripple: CLUSTER.ripple,
  blastRadius: CLUSTER.blastRadius,
  damage: CLUSTER.damage,
  circular: false,
  source: 'howitzer_cluster',
  cosmetic: false,
};

function raycastWorldDistance(ctx: Ctx, pos: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
  const physics = ctx.physics;
  if (!physics) return Infinity;
  if (typeof physics.raycastInto === 'function') {
    return physics.raycastInto(pos, dir, maxDist, CG.World, _hit) === true ? _hit.distance : Infinity;
  }
  if (typeof physics.raycast === 'function') {
    const h = physics.raycast(pos, dir, maxDist, CG.World);
    return h ? h.distance : Infinity;
  }
  return Infinity;
}

function nearestEnemyAlong(ctx: Ctx, pos: THREE.Vector3, dir: THREE.Vector3, lookDist: number): number {
  const enemies = ctx.enemies;
  if (!enemies) return Infinity;
  let list: readonly EnemyInstance[];
  let count: number;
  if (typeof enemies.query === 'function') {
    _mid.copy(pos).addScaledVector(dir, lookDist * 0.5);
    count = enemies.query(_mid, lookDist * 0.5 + CLUSTER.prox, _near) || 0;
    list = _near;
  } else if (Array.isArray(enemies.alive)) {
    list = enemies.alive;
    count = list.length;
  } else {
    return Infinity;
  }

  let bestAlong = Infinity;
  const prox2 = CLUSTER.prox * CLUSTER.prox;
  for (let i = 0; i < count; i++) {
    const e = list[i]!;
    if (!e.alive) continue;
    _to.subVectors(e.center ?? e.position, pos);
    const along = _to.dot(dir);
    if (along <= 0 || along > lookDist || along >= bestAlong) continue;
    _to.addScaledVector(dir, -along);
    if (_to.lengthSq() <= prox2) bestAlong = along;
  }
  _near.length = 0;
  return bestAlong;
}

/**
 * Checks whether a cluster shell at `pos` flying along `dir` at `speed` m/s over `dt` seconds reaches its standoff burst
 * distance (`CLUSTER.standoff` = 7 m short of the first wall/floor or alive enemy within `CLUSTER.prox` = 2.5 m).
 *
 * Returns the world-space burst point (written into `out` if supplied, else an internal scratch vector) when triggered,
 * or `null` if the shell should continue flying this step.
 */
export function checkClusterStandoff(
  ctx: Ctx,
  pos: THREE.Vector3,
  dir: THREE.Vector3,
  speed: number,
  dt: number,
  out?: THREE.Vector3,
): THREE.Vector3 | null {
  const step = Math.max(0, speed * dt);
  const len = dir.length();
  if (len < 1e-6) return null;
  _dir.copy(dir).divideScalar(len);

  const wallLook = step + CLUSTER.standoff;
  const wallDist = raycastWorldDistance(ctx, pos, _dir, wallLook);
  const wallBurst = wallDist === Infinity ? Infinity : wallDist - CLUSTER.standoff;

  const enemyLook = step + CLUSTER.standoff + CLUSTER.prox;
  const enemyDist = nearestEnemyAlong(ctx, pos, _dir, enemyLook);
  const enemyBurst = enemyDist === Infinity ? Infinity : enemyDist - CLUSTER.standoff;

  const first = Math.min(wallBurst, enemyBurst);
  if (first > step) return null;

  const target = out ?? _burstOut;
  return target.copy(pos).addScaledVector(_dir, Math.max(0, first));
}

/**
 * Bursts a 105 mm Howitzer cluster shell at `pos` along `dir`, emitting airburst FX and launching 18 bomblets across
 * a 10 m by 7 m carpet via `bombletCarpet` (reused directly from `src/frame/bomblets.ts`).
 */
export function detonateCluster(
  ctx: Ctx,
  pos: THREE.Vector3,
  dir: THREE.Vector3,
  source = 'howitzer_cluster',
  cosmetic = false,
): void {
  const len = dir.length();
  if (len > 1e-6) _dir.copy(dir).divideScalar(len);
  else _dir.set(0, 0, -1);

  ctx.fx?.ring?.(pos, _dir, '#ffb038', CLUSTER.airburstRadius * 2.2);
  ctx.fx?.sparks?.(pos, _dir, 32, '#ffd478');
  ctx.fx?.smoke?.(pos, 0xd4d8de, 2.6, 1.8);
  ctx.render?.lights?.flash?.(pos, 0xffaa40, 18, 18, 0.16);
  ctx.audio?.play?.('30mmshell_explode', { position: pos, volume: 1.0, pitch: 0.78 });

  _spec.source = source || 'howitzer_cluster';
  _spec.cosmetic = cosmetic;
  bombletCarpet(ctx, pos, _dir, _spec);
}

// ---------------------------------------------------------------------------------------------
// Heavy Bomber CBU-105 Aerial Cluster Dispenser (28 m airburst -> 52 heavy AP bomblets)
// ---------------------------------------------------------------------------------------------

export const AERIAL_CLUSTER = {
  /** Height above ground/target on descent where the CBU-105 canister bursts open, metres. */
  airburstHeight: 28,
  /** Minimum height above ground for mid-air dispersal (bombs released below this burst on impact). */
  minAirburstHeight: 12,
  /** Number of heavy armor-piercing submunition bomblets dispensed. */
  count: 52,
  /** Forward length of the elliptical saturation carpet, metres. */
  length: 44,
  /** Side-to-side width of the elliptical saturation carpet, metres. */
  width: 28,
  /** Staggered detonation ripple duration across the carpet, seconds. */
  ripple: 0.9,
  /** Blast radius per heavy submunition, metres. */
  blastRadius: 5.5,
  /** Blast damage per heavy submunition. */
  damage: 190,
  /** Visual ring scale for the high-altitude canister burst, metres. */
  airburstRadius: 9.5,
} as const;

export const AERIAL_CLUSTER_SPEC: Readonly<BombletSpec> = {
  count: AERIAL_CLUSTER.count,
  length: AERIAL_CLUSTER.length,
  width: AERIAL_CLUSTER.width,
  ripple: AERIAL_CLUSTER.ripple,
  blastRadius: AERIAL_CLUSTER.blastRadius,
  damage: AERIAL_CLUSTER.damage,
  aerial: true,
  dropHeight: AERIAL_CLUSTER.airburstHeight,
  armorPiercing: true,
  source: 'lancer_cluster',
};

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const _aerialSpec: BombletSpec = {
  count: AERIAL_CLUSTER.count,
  length: AERIAL_CLUSTER.length,
  width: AERIAL_CLUSTER.width,
  ripple: AERIAL_CLUSTER.ripple,
  blastRadius: AERIAL_CLUSTER.blastRadius,
  damage: AERIAL_CLUSTER.damage,
  aerial: true,
  dropHeight: AERIAL_CLUSTER.airburstHeight,
  armorPiercing: true,
  source: 'lancer_cluster',
  cosmetic: false,
};

function measureAgl(ctx: Ctx, pos: THREE.Vector3, maxLook: number): number {
  let agl = raycastWorldDistance(ctx, pos, DOWN, maxLook);
  const navY = ctx.world?.nav?.groundHeight?.(pos.x, pos.y + 4, pos.z);
  if (typeof navY === 'number' && Number.isFinite(navY)) {
    const navAgl = pos.y - navY;
    if (navAgl >= 0 && navAgl < agl) agl = navAgl;
  }
  return agl;
}

/**
 * Checks whether a descending CBU-105 heavy aerial cluster canister at `pos` moving with `vel` reaches its
 * high-altitude airburst window (`AERIAL_CLUSTER.airburstHeight` = 28 m above ground/target).
 *
 * Returns the world-space airburst point (written into `out` if supplied) when triggered, or `null` if the
 * canister should continue falling (including low-altitude drops below `minAirburstHeight`, which burst on impact).
 */
export function checkAerialClusterAirburst(
  ctx: Ctx,
  pos: THREE.Vector3,
  vel: THREE.Vector3,
  dt: number,
  out?: THREE.Vector3,
): THREE.Vector3 | null {
  if (vel.y >= -0.5) return null;
  const drop = Math.max(0, -vel.y * dt);
  const agl = measureAgl(ctx, pos, AERIAL_CLUSTER.airburstHeight + drop + 8);
  if (!Number.isFinite(agl)) return null;

  const nextAgl = agl - drop;
  const target = out ?? _burstOut;

  // Crossing cleanly down through the 28 m airburst plane this step: interpolate exact 28 m burst point.
  if (agl >= AERIAL_CLUSTER.airburstHeight && nextAgl <= AERIAL_CLUSTER.airburstHeight) {
    const frac = drop > 1e-4 ? Math.min(1, Math.max(0, (agl - AERIAL_CLUSTER.airburstHeight) / drop)) : 0;
    return target.copy(pos).addScaledVector(vel, dt * frac);
  }
  // Already inside the mid-air dispersal window [12 m .. 28 m] on descent.
  if (agl < AERIAL_CLUSTER.airburstHeight && agl >= AERIAL_CLUSTER.minAirburstHeight) {
    return target.copy(pos);
  }
  return null;
}

/**
 * Bursts a CBU-105 Heavy Aerial Cluster canister at `pos` along `dir`, emitting a high-altitude canister flash,
 * pressure rings, smoke burst, crackling detonation audio, and carpeting a 44 m × 28 m zone with 52 heavy AP
 * submunitions rippling over 0.9 s (`190` dmg / `5.5 m` blast each) via `bombletCarpet`.
 */
export function detonateAerialCluster(
  ctx: Ctx,
  pos: THREE.Vector3,
  dir: THREE.Vector3,
  source = 'lancer_cluster',
  cosmetic = false,
): void {
  const len = dir.length();
  if (len > 1e-6) _dir.copy(dir).divideScalar(len);
  else _dir.set(0, 0, -1);

  const agl = measureAgl(ctx, pos, AERIAL_CLUSTER.airburstHeight + 12);
  const dropHeight = Number.isFinite(agl)
    ? Math.max(4, Math.min(AERIAL_CLUSTER.airburstHeight, agl))
    : AERIAL_CLUSTER.airburstHeight;

  ctx.fx?.ring?.(pos, DOWN, '#ffb838', AERIAL_CLUSTER.airburstRadius * 2.4);
  ctx.fx?.ring?.(pos, UP, '#fff2cc', AERIAL_CLUSTER.airburstRadius * 1.6);
  ctx.fx?.sparks?.(pos, DOWN, 64, '#ffd978');
  ctx.fx?.smoke?.(pos, 0xd8dce2, 6.5, 2.8);
  ctx.render?.lights?.flash?.(pos, 0xffaa38, 36, 48, 0.24);
  ctx.audio?.play?.('30mmshell_explode', { position: pos, volume: 1.0, pitch: 0.68 });
  ctx.audio?.play?.('hellfirebullet_explode', { position: pos, volume: 0.9, pitch: 0.92 });

  _aerialSpec.source = source || 'lancer_cluster';
  _aerialSpec.cosmetic = cosmetic;
  _aerialSpec.dropHeight = dropHeight;
  bombletCarpet(ctx, pos, _dir, _aerialSpec);
}
