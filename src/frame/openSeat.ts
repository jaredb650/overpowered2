/**
 * Open Frame exposed pilot seat hit routing (`cockpitOpen`).
 *
 * The Open Frame strips the armoured canopy for three shoulder hardpoints, leaving the pilot exposed from the front
 * and top while keeping the lower torso, legs, and rear reactor backrest armoured.
 *
 * When `openSeat` is true and an incoming hit strikes the exposed front/top seat envelope (or an explosive/fire airburst
 * detonates right in the unenclosed cockpit well), returns `true` so `Frame.hit()` returns `false` and `Player.takeDamage`
 * applies the damage directly to the pilot as on foot. Hits to the legs, lower torso, rear armour, sappers, and crushes
 * return `false` so the Distraint Frame's armoured hull absorbs them.
 */
import type * as THREE from 'three';
import type { PlayerDamage } from '../core/contracts';
import { FRAME } from './data';

/** Geometric envelope of the Open Frame's exposed pilot seat in torso-local coordinates over `feet`. */
export const OPEN_SEAT = {
  /** Forward offset of the pilot seat from the hips (metres, along torso forward). */
  ahead: FRAME.podAhead,
  /** Center height of the pilot torso/head in the seat over `feet.y` (metres). */
  seatY: FRAME.eye - 0.35,
  /** Vertical band of direct frontal fire that clears the lower glacis and enters the open cockpit well. */
  minFrontY: 3.2,
  maxFrontY: 5.6,
  /** Minimum forward cosine (`dot(dir, forward)`) for frontal hits to clear the armoured backrest & shoulder guards. */
  frontDot: 0.2,
  /** Height above which an overhead/top-down attack drops straight through the missing roof into the seat. */
  topMinY: 5.2,
  /** Horizontal radius directly above the open cockpit tub where any high drop-in hit reaches the pilot. */
  topDirectRadius: 3.5,
  /** Minimum downward slope (`dy / horiz`) from elevated front/side fire to drop over the rim into the seat. */
  topSlope: 0.35,
  /** Minimum forward cosine for elevated angled fire (rear carapace still shields from behind). */
  topAheadDot: -0.15,
  /** Blast/splash proximity radius around the open seat center (metres) that bypasses the missing windscreen. */
  splashRadius: 3.2,
  /** Minimum height of a nearby blast/fire to enter the open seat rather than being shielded by the waist/legs. */
  splashMinY: 3.0,
  /** Minimum forward cosine for nearby blasts (blasts behind the armoured backrest still hit the rear hull). */
  splashAheadDot: -0.25,
} as const;

const SPLASH_TYPES = new Set<PlayerDamage['type']>(['explosive', 'shock', 'fire']);

export function routeOpenSeatHit(
  damage: PlayerDamage,
  feet: THREE.Vector3,
  viewYaw: number,
  openSeat: boolean,
): boolean {
  if (!openSeat || !damage.from) return false;

  // Ground rams, stomps, and leg-planted sappers always strike the mech chassis/legs.
  if (damage.type === 'crush') return false;
  if (damage.source && damage.source.includes('sapper')) return false;

  const dx = damage.from.x - feet.x;
  const dz = damage.from.z - feet.z;
  const horiz = Math.hypot(dx, dz);
  const localY = damage.from.y - feet.y;

  // Torso forward vector: camera convention yaw = 0 looks along -Z.
  const fx = -Math.sin(viewYaw);
  const fz = -Math.cos(viewYaw);
  const localAhead = horiz > 1e-4 ? (dx * fx + dz * fz) / horiz : 1;

  // 1. Overhead / top-down fire dropping straight through the open roll-cage roof.
  if (localY >= OPEN_SEAT.topMinY) {
    if (horiz <= OPEN_SEAT.topDirectRadius) return true;
    const slope = (localY - OPEN_SEAT.seatY) / horiz;
    if (localAhead > OPEN_SEAT.topAheadDot && slope >= OPEN_SEAT.topSlope) return true;
  }

  // 2. Direct frontal / upper-seat hits clearing the lower glacis and striking the exposed seat.
  if (localAhead > OPEN_SEAT.frontDot && localY >= OPEN_SEAT.minFrontY && localY <= OPEN_SEAT.maxFrontY) {
    return true;
  }

  // 3. Close-in explosive / shock / fire airbursts right at the unenclosed front/top cockpit well.
  if (SPLASH_TYPES.has(damage.type) && localY >= OPEN_SEAT.splashMinY && localAhead > OPEN_SEAT.splashAheadDot) {
    const seatX = feet.x + fx * OPEN_SEAT.ahead;
    const seatY = feet.y + OPEN_SEAT.seatY;
    const seatZ = feet.z + fz * OPEN_SEAT.ahead;
    const dist = Math.hypot(damage.from.x - seatX, damage.from.y - seatY, damage.from.z - seatZ);
    if (dist <= OPEN_SEAT.splashRadius) return true;
  }

  return false;
}
