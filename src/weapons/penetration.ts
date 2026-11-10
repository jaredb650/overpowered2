/**
 * Penetration: the one place that decides whether a round goes on through a wall or a body. Hitscan (Combat.playerRay) and
 * projectiles (Projectiles.step) both keep a `Budget` and ask here, so the two cannot drift apart.
 *
 * A budget is meters of concrete, from PENETRATION in data.ts. Nothing in this file runs for a round with no budget.
 */
import * as THREE from 'three';
import { CG, type PhysicsSystem, type RayHit } from '../core/contracts';

/** All this needs of the physics world, so a test can hand it one function. */
export type Raycaster = Pick<PhysicsSystem, 'raycast'>;
import { PENETRATION } from './data';

/** `?pierce=0` takes the budget away from every gun in the WEAPONS table. The Lance sets its own and keeps it. */
export const PIERCE_ON = typeof location === 'undefined' || new URLSearchParams(location.search).get('pierce') !== '0';

/** What a round has left. Kept by the caller, one per shot in flight. */
export interface Budget {
  /** What it started with, for the damage it keeps. */
  full: number;
  left: number;
  /** What one body costs it. */
  body: number;
  /** Share of its damage it keeps with the budget spent. */
  keep: number;
  /**
   * Walls a round on the per-wall rule may still pass, or -1 for a round that pays by the meter. On the per-wall rule the
   * budget is not a total: any wall up to `full` thick is passed, whatever it is made of, and costs one from this count and
   * nothing else. It is the Lance's rule from before budgets, kept here so the Lance is as it was.
   */
  walls: number;
}

export function makeBudget(): Budget {
  return { full: 0, left: 0, body: PENETRATION.body, keep: PENETRATION.keep, walls: -1 };
}

/** Loads a budget for a fresh round. `walls` puts it on the per-wall rule. Returns it for chaining. */
export function loadBudget(
  b: Budget, penetrate: number | undefined, bodyCost: number | undefined, keep?: number, walls?: number,
): Budget {
  const full = Math.max(0, penetrate ?? 0);
  b.full = b.left = full;
  b.body = bodyCost ?? PENETRATION.body;
  b.keep = keep ?? PENETRATION.keep;
  b.walls = full > 0 && walls !== undefined ? Math.max(0, walls) : -1;
  return b;
}

/** True for a round on the per-wall rule. See `Budget.walls`. */
export function perWall(b: Budget): boolean {
  return b.walls >= 0;
}

/** Share of its damage the round still carries: all of it untouched, `keep` of it when spent. */
export function damageKept(b: Budget): number {
  if (b.full <= 0) return 1;
  return b.keep + (1 - b.keep) * Math.max(0, b.left / b.full);
}

/** Spends a body from the budget. False, and nothing spent, when the round stops in it. */
export function passBody(b: Budget, blocked: boolean): boolean {
  if (b.full <= 0) return false;
  const cost = b.body * (blocked ? PENETRATION.blocked : 1);
  if (cost > b.left + 1e-6) return false;
  b.left -= cost;
  return true;
}

const _probe = new THREE.Vector3();
const _back = new THREE.Vector3();

/**
 * How thick the solid behind `entry` is along `dir`, looking no deeper than `maxDepth`. Writes the point where the round
 * comes out, and into `normal` the way the far face looks, and returns the thickness, or -1 when it stays buried.
 *
 * Probes step into the wall and each looks back the way it came. A probe still inside a box reads a hit at zero distance,
 * since the world's boxes are solid to rays; the first one in the open sees the far face behind it. Steps are
 * PENETRATION.step apart, so two walls with a gap narrower than that count as one, which nothing can stand in anyway.
 *
 * A trimesh is a hollow skin: the first probe past the skin reads open air and the round is charged the smallest
 * thickness. The few trimesh colliders in the maps are decks and ground, where that is the right answer.
 */
export function wallExit(
  physics: Raycaster, entry: THREE.Vector3, dir: THREE.Vector3, maxDepth: number, out: THREE.Vector3, normal?: THREE.Vector3,
): number {
  const step = PENETRATION.step;
  const deepest = Math.min(maxDepth, PENETRATION.maxWall);
  if (deepest <= 0.01) return -1;
  _back.copy(dir).negate();
  for (let depth = Math.min(step, deepest); ; depth = Math.min(depth + step, deepest)) {
    _probe.copy(entry).addScaledVector(dir, depth);
    const hit = physics.raycast(_probe, _back, depth - 0.005, CG.World);
    if (!hit) {
      // Open air all the way back: a skin with no far face.
      out.copy(_probe);
      normal?.copy(dir);
      return depth;
    }
    if (hit.distance > 0.002) {
      const thickness = depth - hit.distance;
      out.copy(entry).addScaledVector(dir, thickness);
      // The face the probe saw from outside. A mark laid along the shot instead would stand off a wall it left at a slant.
      if (normal && normal.copy(hit.normal).dot(dir) <= 0) normal.copy(dir);
      return thickness;
    }
    if (depth >= deepest) return -1;
  }
}

/**
 * A round with `b` left meets a wall. Spends the wall from the budget and writes where it comes out and the far face's
 * normal, or returns false with nothing spent. `wall.point` is the entry.
 */
export function passWall(
  physics: Raycaster, b: Budget, wall: RayHit, dir: THREE.Vector3, exit: THREE.Vector3, normal?: THREE.Vector3,
): boolean {
  if (b.left <= 0) return false;
  if (b.walls >= 0) {
    // The per-wall rule: thin enough or not, and one wall fewer to go. No probe once the count is spent.
    if (b.walls === 0 || wallExit(physics, wall.point, dir, b.full, exit, normal) < 0) return false;
    b.walls--;
    return true;
  }
  const factor = PENETRATION.surface[wall.surface] ?? 1;
  if (!Number.isFinite(factor)) return false;
  const thickness = wallExit(physics, wall.point, dir, b.left / factor, exit, normal);
  if (thickness < 0) return false;
  const cost = thickness * factor;
  if (cost > b.left + 1e-6) return false;
  b.left -= cost;
  return true;
}
