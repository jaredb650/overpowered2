/**
 * Open Frame exposed pilot seat hit routing — Phase 0 hook (Lane K refines exact seat geometry / feedback).
 *
 * When `openSeat` is true and an incoming hit strikes the exposed front-upper cockpit seat area, returns `true` so
 * `Frame.hit()` returns `false` and `Player.takeDamage` applies the damage directly to the pilot as on foot.
 */
import type * as THREE from 'three';
import type { PlayerDamage } from '../core/contracts';

export function routeOpenSeatHit(
  damage: PlayerDamage,
  feet: THREE.Vector3,
  viewYaw: number,
  openSeat: boolean,
): boolean {
  if (!openSeat || !damage.from) return false;
  const dx = damage.from.x - feet.x;
  const dz = damage.from.z - feet.z;
  const horiz = Math.hypot(dx, dz) || 1;
  const fx = -Math.sin(viewYaw);
  const fz = -Math.cos(viewYaw);
  const localAhead = (dx * fx + dz * fz) / horiz;
  const localY = damage.from.y - feet.y;
  return localAhead > 0.2 && localY >= 3.2 && localY <= 5.4;
}
