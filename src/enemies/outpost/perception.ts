/**
 * What the soldiers know. Nobody gets the player's position for free: a man has to be looking the right way with a clear
 * line for long enough to be sure, or hear something and go and find out. A sighting then travels: at once within the
 * squad, and over the radio to everyone else a moment later.
 */
import * as THREE from 'three';
import { CG, type PhysicsSystem, type RayHit } from '../../core/contracts';
import { clamp, lerp, TAU, wrapAngle } from '../../core/math';
import type { AiWorld } from '../aiWorld';
import type { Exposure } from './routes';
import type { Soldier } from './soldier';

/** Cosine of the half angle of his view. Wide on purpose: he is scanning, not reading. */
const VIEW_COS = 0.2;
/** Inside this he knows, whichever way he faces. */
const TOUCH = 3.5;
/** Seconds to be sure of a target: this at point-blank, plus this much per metre. */
const NOTICE_BASE = 0.2;
const NOTICE_PER_METRE = 0.028;
/** Fast movement catches the eye, and an alert man is already looking for it. */
const MOVING_GAIN = 1.5;
const ALERT_GAIN = 2.2;
const NOTICE_DECAY = 0.45;
export const SENSE_INTERVAL = 0.12;
/** Seconds after losing sight that he still tracks where it went. */
const TRACK_MEMORY = 0.5;
/** A heard position is off by this share of the distance. */
const HEARING_ERROR = 0.18;

/** Stealth light-aware sight tuning constants. */
export const STEALTH_SIGHT = {
  darkThreshold: 0.12,
  dimThreshold: 0.5,
  brightThreshold: 0.8,
  darkRange: 7.5,
  dimRange: 24,
  brightRange: 45,
  darkFillScale: 0.25,
  dimFillScale: 0.75,
  brightFillScale: 1.15,
  flashlightRange: 16,
  flashlightHalfAngle: 0.32,
  flashlightCos: Math.cos(0.32),
  crouchRangeMult: 0.82,
  crouchFillMult: 0.78,
  crouchTouch: 1.1,
} as const;

export interface PerceptionOptions {
  /** Local light level on the player (0 = pitch dark, 1 = floodlight). Omit for legacy non-stealth perception. */
  lightLevel?: number;
  /** True while the player is crouched: scales sight range by 0.82x and notice fill rate by 0.78x. */
  crouched?: boolean;
  /** True if this guard carries an active narrow-beam flashlight (extends dark sight up to 16 m within +/-0.32 rad). */
  flashlight?: boolean;
  /** When true, updates `s.notice` and `s.sees` without auto-reporting directly to `s.squad`. */
  suppressSquadReport?: boolean;
}

export interface StealthSightProfile {
  range: number;
  fillScale: number;
}

/** One sweep of rays around the threat, so "can it see that?" costs a lookup and not a ray. */
const FAN = 72;
const FAN_RANGE = 60;
const FAN_MOVE = 2;
const FAN_INTERVAL = 0.9;

const _dir = new THREE.Vector3();
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };
const _profile: StealthSightProfile = { range: 45, fillScale: 1 };

/**
 * Computes stealth sight range and notice fill-rate multiplier for a given light level, crouch state,
 * and facing cosine. Writes into `out` when provided to avoid allocations on hot paths.
 */
export function stealthSightProfile(
  lightLevel: number,
  crouched = false,
  facing = 0,
  flashlight = false,
  out: StealthSightProfile = { range: 45, fillScale: 1 },
): StealthSightProfile {
  const L = clamp(lightLevel, 0, 1);
  let range: number;
  let fillScale: number;
  if (L <= STEALTH_SIGHT.darkThreshold) {
    range = STEALTH_SIGHT.darkRange;
    fillScale = STEALTH_SIGHT.darkFillScale;
  } else if (L < STEALTH_SIGHT.dimThreshold) {
    const t = (L - STEALTH_SIGHT.darkThreshold) / (STEALTH_SIGHT.dimThreshold - STEALTH_SIGHT.darkThreshold);
    range = lerp(STEALTH_SIGHT.darkRange, STEALTH_SIGHT.dimRange, t);
    fillScale = lerp(STEALTH_SIGHT.darkFillScale, STEALTH_SIGHT.dimFillScale, t);
  } else if (L < STEALTH_SIGHT.brightThreshold) {
    const t = (L - STEALTH_SIGHT.dimThreshold) / (STEALTH_SIGHT.brightThreshold - STEALTH_SIGHT.dimThreshold);
    range = lerp(STEALTH_SIGHT.dimRange, STEALTH_SIGHT.brightRange, t);
    fillScale = lerp(STEALTH_SIGHT.dimFillScale, STEALTH_SIGHT.brightFillScale, t);
  } else {
    range = STEALTH_SIGHT.brightRange;
    fillScale = STEALTH_SIGHT.brightFillScale;
  }
  if (flashlight && facing >= STEALTH_SIGHT.flashlightCos && range < STEALTH_SIGHT.flashlightRange) {
    range = STEALTH_SIGHT.flashlightRange;
  }
  if (crouched) {
    range *= STEALTH_SIGHT.crouchRangeMult;
    fillScale *= STEALTH_SIGHT.crouchFillMult;
  }
  out.range = range;
  out.fillScale = fillScale;
  return out;
}

/** The side's shared picture of the player. Every squad falls back on it when it has nothing fresher of its own. */
export class Intel implements Exposure {
  readonly position = new THREE.Vector3();
  /** Last time anyone had any position at all. */
  at = -99;
  /** Last real sighting. */
  seenAt = -99;
  private readonly fan = new Float32Array(FAN);
  private readonly origin = new THREE.Vector3();
  private fanAt = -99;

  constructor(private readonly physics: PhysicsSystem) {}

  reset(): void {
    this.at = this.seenAt = this.fanAt = -99;
  }

  report(p: THREE.Vector3, now: number, seen: boolean): void {
    this.position.copy(p);
    this.at = now;
    if (seen) this.seenAt = now;
  }

  /** Re-sweeps the fan if the threat has moved. A sweep is 72 rays, about once a second at most. */
  refreshFan(now: number): void {
    if (now - this.fanAt < FAN_INTERVAL) return;
    if (this.fanAt > 0 && this.origin.distanceToSquared(this.position) < FAN_MOVE * FAN_MOVE) return;
    this.fanAt = now;
    this.origin.copy(this.position);
    for (let i = 0; i < FAN; i++) {
      const a = (i / FAN) * TAU;
      _dir.set(Math.sin(a), 0, Math.cos(a));
      this.fan[i] = this.physics.raycastInto(this.origin, _dir, FAN_RANGE, CG.World, _hit) ? _hit.distance : FAN_RANGE;
    }
  }

  exposed(x: number, z: number): boolean {
    if (this.fanAt < 0) return false;
    const dx = x - this.origin.x, dz = z - this.origin.z;
    const a = Math.atan2(dx, dz);
    const i = Math.round(((a < 0 ? a + TAU : a) / TAU) * FAN) % FAN;
    return dx * dx + dz * dz < this.fan[i]! * this.fan[i]!;
  }
}

/** Sight, on his own staggered clock. */
export function sense(s: Soldier, w: AiWorld, dt: number, options?: PerceptionOptions): void {
  const e = s.e;
  const p = w.player;
  const dx = p.position.x - e.position.x, dz = p.position.z - e.position.z;
  const flat = Math.hypot(dx, dz) || 1;
  const facing = (dx * Math.sin(e.yaw) + dz * Math.cos(e.yaw)) / flat;
  // A man with his head down behind a wall sees nothing, however good his line would be. One in an ambush is doing nothing but look.
  const looking = s.stage === 'peek' || s.task === 'move' || !s.spot || s.silent;
  const smokeBlocked = w.enemies.outpost?.commander?.smoke?.blocks(e.position, p.position) ?? false;

  const lightLevel = options?.lightLevel;
  let visible: boolean;
  let fillScale = 1;
  if (lightLevel !== undefined) {
    const crouched = options?.crouched === true;
    stealthSightProfile(lightLevel, crouched, facing, options?.flashlight === true, _profile);
    fillScale = _profile.fillScale;
    const touch = crouched ? STEALTH_SIGHT.crouchTouch : TOUCH;
    visible = e.hasLos && p.alive && (flat < touch || (flat <= _profile.range && looking && facing > VIEW_COS && !smokeBlocked));
  } else {
    visible = e.hasLos && p.alive && (flat < TOUCH || (looking && facing > VIEW_COS && !smokeBlocked));
  }

  if (visible) {
    const seconds = (NOTICE_BASE + flat * NOTICE_PER_METRE) / s.rankDef.eyes;
    const gain = (p.speed > 6 ? MOVING_GAIN : 1) * (w.now < s.alertUntil ? ALERT_GAIN : 1);
    s.notice = clamp(s.notice + (dt / seconds) * gain * fillScale);
  } else {
    s.notice = clamp(s.notice - NOTICE_DECAY * dt);
  }
  if (visible && s.notice >= 1) {
    s.sees = true;
    s.knownAt = w.now;
    if (!options?.suppressSquadReport) s.squad.report(s, p.chest, true);
  } else if (s.sees && w.now - s.knownAt > TRACK_MEMORY) {
    s.sees = false;
  }
}

/** A noise reaches him. He gets a direction and a rough distance, not a position. */
export function hear(s: Soldier, w: AiWorld, at: THREE.Vector3, distance: number, out: THREE.Vector3): void {
  s.alertUntil = w.now + 4;
  if (s.sees) return;
  const err = distance * HEARING_ERROR;
  const a = wrapAngle(Math.random() * TAU);
  out.set(at.x + Math.sin(a) * err, at.y, at.z + Math.cos(a) * err);
  s.knownAt = w.now;
  s.squad.report(s, out, false);
}
