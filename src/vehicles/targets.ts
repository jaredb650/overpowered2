/** Finding the fight for a pilot. */
import type * as THREE from 'three';
import type { EnemyInstance } from '../core/gameplay';

/**
 * Writes the middle of the thickest knot of enemies, and returns how many are in it. 0 means nobody to fly to, and `out`
 * is left alone. Men in `skip` are not a fight. Quadratic, on a list capped at 48, and it runs a couple of times a second.
 */
export function thickestKnot(enemies: readonly EnemyInstance[], radius: number, skip: ReadonlySet<number>, out: THREE.Vector3): number {
  const r2 = radius * radius;
  let best: EnemyInstance | null = null;
  let bestCount = 0;
  for (const e of enemies) {
    if (!e.alive || skip.has(e.uid)) continue;
    let count = 0;
    for (const o of enemies) if (o.alive && !skip.has(o.uid) && o.position.distanceToSquared(e.position) < r2) count++;
    if (count > bestCount) {
      bestCount = count;
      best = e;
    }
  }
  if (!best) return 0;
  let x = 0;
  let y = 0;
  let z = 0;
  let n = 0;
  for (const e of enemies) {
    if (!e.alive || skip.has(e.uid) || e.position.distanceToSquared(best.position) >= r2) continue;
    x += e.position.x;
    y += e.position.y;
    z += e.position.z;
    n++;
  }
  out.set(x / n, y / n, z / n);
  return bestCount;
}
