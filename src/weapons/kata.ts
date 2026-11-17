/**
 * The Gun Kata brain chip (contracts/chips.ts): with two guns in hand, T puts a round into the head of every man in reach, all the
 * way round, one after the other with the hands in turn. The camera stays where it is: each gun snaps toward its man and the
 * tracers do the rest (Weapons.ts `updateKata`). This is the pure part: who is in it, and in what order.
 */
import * as THREE from 'three';

export const KATA = {
  /** Metres from the eye a man may be, in any direction. */
  radius: 22,
  /** Seconds between two shots. 14 men are 1.2 s. */
  step: 0.085,
  /** Men in one kata at most. */
  most: 14,
  /** Seconds before the brain chip works again, from the tap (the burst is about one of them). */
  cooldown: 18,
  /**
   * Co-op: seconds the host lets this player's shots come faster than the gun's rate, from the guest's word that a kata began
   * (net/authority.ts `kata`): the burst's longest with room for lag.
   */
  window: 2.5,
} as const;

const _d = new THREE.Vector3();

/** Radians clockwise (seen from above) from `forward` round to `to - from`, 0 to 2 pi: a sweep that starts straight ahead. */
export function bearing(from: THREE.Vector3, forward: THREE.Vector3, to: THREE.Vector3): number {
  _d.subVectors(to, from);
  const a = Math.atan2(forward.x * _d.z - forward.z * _d.x, forward.x * _d.x + forward.z * _d.z);
  return a < 0 ? a + Math.PI * 2 : a;
}

/**
 * Every one of `bodies` whose `at` point is within `radius` of `eye` and in plain sight (`seen`), in one clockwise sweep from
 * straight ahead, at most `most` of them (the nearest kept when there are more).
 */
export function kataTargets<T>(
  eye: THREE.Vector3, forward: THREE.Vector3, bodies: readonly T[], at: (body: T) => THREE.Vector3,
  seen: (from: THREE.Vector3, to: THREE.Vector3) => boolean, radius: number = KATA.radius, most: number = KATA.most,
): T[] {
  const r2 = radius * radius;
  const found: { body: T; d2: number; turn: number }[] = [];
  for (const body of bodies) {
    const p = at(body);
    const d2 = p.distanceToSquared(eye);
    if (d2 > r2 || !seen(eye, p)) continue;
    found.push({ body, d2, turn: bearing(eye, forward, p) });
  }
  if (found.length > most) found.sort((a, b) => a.d2 - b.d2).length = most;
  return found.sort((a, b) => a.turn - b.turn).map(f => f.body);
}
