/**
 * What the soldiers know. Nobody gets the player's position for free: a man has to be looking the right way with a clear
 * line for long enough to be sure, or hear something and go and find out. A sighting then travels: at once within the
 * squad, and over the radio to everyone else a moment later.
 */
import * as THREE from 'three';
import { CG, type PhysicsSystem, type RayHit } from '../../core/contracts';
import { clamp, TAU, wrapAngle } from '../../core/math';
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

/** One sweep of rays around the threat, so "can it see that?" costs a lookup and not a ray. */
const FAN = 72;
const FAN_RANGE = 60;
const FAN_MOVE = 2;
const FAN_INTERVAL = 0.9;

const _dir = new THREE.Vector3();
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };

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
export function sense(s: Soldier, w: AiWorld, dt: number): void {
  const e = s.e;
  const p = w.player;
  const dx = p.position.x - e.position.x, dz = p.position.z - e.position.z;
  const flat = Math.hypot(dx, dz) || 1;
  const facing = (dx * Math.sin(e.yaw) + dz * Math.cos(e.yaw)) / flat;
  // A man with his head down behind a wall sees nothing, however good his line would be.
  const looking = s.stage === 'peek' || s.task === 'move' || !s.spot;
  const visible = e.hasLos && p.alive && (flat < TOUCH || (looking && facing > VIEW_COS && !w.enemies.outpost!.commander.smoke.blocks(e.position, p.position)));
  if (visible) {
    const seconds = NOTICE_BASE + flat * NOTICE_PER_METRE;
    const gain = (p.speed > 6 ? MOVING_GAIN : 1) * (w.now < s.alertUntil ? ALERT_GAIN : 1);
    s.notice = clamp(s.notice + (dt / seconds) * gain);
  } else {
    s.notice = clamp(s.notice - NOTICE_DECAY * dt);
  }
  if (visible && s.notice >= 1) {
    s.sees = true;
    s.knownAt = w.now;
    s.squad.report(s, p.chest, true);
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
