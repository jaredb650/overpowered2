/**
 * Live enemy grenade throwback, melee baseball-bat deflection, and mech punt constants & helpers.
 *
 * Keeps tuning and pure selection math cleanly separated from Projectiles/Weapons/HUD so tests can
 * exercise every edge case deterministically without pulling in DOM or rendering.
 */
import * as THREE from 'three';

export interface IncomingGrenade {
  /** World position of the live grenade. */
  readonly position: THREE.Vector3;
  /** Remaining fuse time in seconds. */
  fuse: number;
  /** Initial / reference fuse duration for normalizing the HUD countdown ring. */
  maxFuse: number;
  /** Distance from the player eye in meters. */
  distance: number;
  /** True for flashbangs, false for lethal frag grenades. */
  flash: boolean;
  /** True when close enough for the player to grab and throw back right now. */
  inReach: boolean;
}

export interface ThrowbackResult {
  /** True when the caught grenade was a flashbang rather than a lethal frag. */
  flash: boolean;
  /** Remaining fuse after applying the safety floor (seconds). */
  fuse: number;
  /** Distance from which the grenade was snatched. */
  distance: number;
}

export const THROWBACK = {
  /** Maximum reach (m from player eye) to snatch & hurl back a live enemy grenade with [G] or [E]. */
  grabReach: 4.2,
  /** Maximum reach (m from player eye) for melee baseball-bat deflection. */
  batReach: 3.8,
  /** Minimum cos(angle) in front of crosshair for melee batting (wide ~78° swing cone). */
  batConeCos: 0.2,
  /** Outgoing throw speed (m/s) when hurled back by hand. */
  throwSpeed: 28,
  /** Upward loft boost (m/s) added on throwback. */
  throwUp: 3.4,
  /** Outgoing speed (m/s) when batted with a melee weapon or katana. */
  batSpeed: 38,
  /** Upward loft (m/s) when batted with a melee weapon. */
  batUp: 4.8,
  /** Outgoing speed (m/s) when punted by a Distraint Frame backhand or stomp. */
  framePuntSpeed: 34,
  /** Minimum fuse floor (seconds) after snatching/batting so it never explodes in your palm on frame 1. */
  minFuse: 0.95,
  /** Maximum distance (m) at which the HUD renders directional incoming-grenade warning rings. */
  warnRange: 16,
  /** Maximum simultaneous grenade indicators rendered on the HUD. */
  maxIndicators: 4,
  /** Bonus score awarded for a Return to Sender kill. */
  bonusScore: 150,
  /** Source tag for lethal thrown-back enemy grenades. */
  fragSource: 'throwback_frag',
  /** Source tag for thrown-back enemy flashbangs. */
  flashSource: 'throwback_flash',
} as const;

export function makeIncomingPool(count = THROWBACK.maxIndicators): IncomingGrenade[] {
  const out: IncomingGrenade[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      position: new THREE.Vector3(),
      fuse: 0,
      maxFuse: 2.5,
      distance: 0,
      flash: false,
      inReach: false,
    });
  }
  return out;
}

/**
 * Scores a live enemy grenade for snatch priority (lower is better).
 * Strongly prefers grenades in front of the player's crosshair while still letting you grab one at your feet.
 */
export function throwbackPriority(distance: number, forwardDot: number): number {
  const aimPenalty = (1 - Math.max(-1, Math.min(1, forwardDot))) * 1.4;
  return distance + aimPenalty;
}

/** Ensures a caught or batted grenade has enough fuse left to clear the player's hand without instant self-detonation. */
export function safeThrowbackFuse(currentFuse: number): number {
  return Math.max(currentFuse, THROWBACK.minFuse);
}

export function isThrowbackSource(source: string): boolean {
  return source === THROWBACK.fragSource || source === THROWBACK.flashSource;
}
