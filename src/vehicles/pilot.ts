/**
 * The Harrow's autopilot. It is given a point on the map and the height of whatever is below, and works out the rest:
 * run in fast, circle at a standoff with the nose on the target, turn back the other way now and then.
 *
 * It flies a helicopter's way: thrust tilts toward where it wants to go, so roll and pitch come from its speed across
 * and along its own nose. That is what makes a machine circling with its nose pointed inward lean into the circle,
 * which banking from the turn alone would not, since all of that acceleration is along the nose.
 */
import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp, rand, smoothstep } from '../core/math';

export interface PilotPlan {
  /** Metres it circles from the target. */
  standoff: number;
  /** Lowest it flies above the map's floor. */
  altitude: number;
  /** Metres it stays above whatever is under it. */
  clearance: number;
  /** m/s around the circle. */
  cruise: number;
  /** m/s running in from a long way off. */
  dash: number;
  /** How fast velocity follows what it wants, as a rate. */
  response: number;
  /** How fast height follows what it wants, as a rate. */
  climb: number;
  /** How fast the nose comes round, as a rate. */
  turn: number;
  /** Radians of lean per m/s. */
  lean: number;
  maxRoll: number;
  maxPitch: number;
  /** Seconds between reversing the circle. */
  reverse: readonly [number, number];
  /** It stays this far from the middle of the map on both axes. */
  limit: number;
}

/** Past this many standoffs it stops pointing at the target and just flies. */
const NOSE_ON_WITHIN = 1.6;
/** How much of the speed is kept along the circle at the widest error, so it never stops dead to change its mind. */
const CIRCLE_KEPT = 0.3;
const BOB = 0.7;
const BOB_RATE = 0.9;
/** A push back toward the map, as m/s per metre past the limit. */
const LIMIT_PUSH = 1.6;

const _to = new THREE.Vector3();
const _want = new THREE.Vector3();

export class Autopilot {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly forward = new THREE.Vector3(0, 0, 1);
  roll = 0;
  private pitch = 0;
  private yaw = 0;
  private side = 1;
  private reverseIn = 0;
  private clock = 0;

  constructor(private readonly plan: PilotPlan) {}

  /** Puts it in the air at `from`, already flying toward `heading` at full speed. */
  begin(from: THREE.Vector3, heading: THREE.Vector3): void {
    this.position.copy(from);
    this.velocity.copy(heading).setY(0).setLength(this.plan.dash);
    this.yaw = Math.atan2(heading.x, heading.z);
    this.reverseIn = rand(this.plan.reverse[0], this.plan.reverse[1]);
    this.aimNose();
  }

  /** `floor` is the top of whatever is below or just ahead. */
  update(dt: number, focus: THREE.Vector3, floor: number): void {
    const p = this.plan;
    this.clock += dt;
    this.reverseIn -= dt;
    if (this.reverseIn <= 0) {
      this.reverseIn = rand(p.reverse[0], p.reverse[1]);
      this.side = -this.side;
    }
    _to.subVectors(focus, this.position).setY(0);
    const far = Math.max(_to.length(), 1e-3);
    _to.divideScalar(far);
    this.steer(dt, far);
    this.hold(dt, floor);
    this.lean(dt, far);
  }

  private steer(dt: number, far: number): void {
    const p = this.plan;
    const pos = this.position;
    const gap = far - p.standoff;
    const closing = clamp(gap / (p.standoff * 0.5), -1, 1);
    const speed = lerp(p.cruise, p.dash, smoothstep(0, p.standoff * 2, gap));
    const around = p.cruise * lerp(1, CIRCLE_KEPT, Math.abs(closing)) * this.side;
    _want.set(-_to.z * around + _to.x * closing * speed, 0, _to.x * around + _to.z * closing * speed);
    if (Math.abs(pos.x) > p.limit) _want.x -= Math.sign(pos.x) * (Math.abs(pos.x) - p.limit) * LIMIT_PUSH;
    if (Math.abs(pos.z) > p.limit) _want.z -= Math.sign(pos.z) * (Math.abs(pos.z) - p.limit) * LIMIT_PUSH;
    this.velocity.x = damp(this.velocity.x, _want.x, p.response, dt);
    this.velocity.z = damp(this.velocity.z, _want.z, p.response, dt);
    pos.x += this.velocity.x * dt;
    pos.z += this.velocity.z * dt;
  }

  private hold(dt: number, floor: number): void {
    const p = this.plan;
    const target = Math.max(floor + p.clearance, p.altitude) + Math.sin(this.clock * BOB_RATE) * BOB;
    const y = damp(this.position.y, target, p.climb, dt);
    this.velocity.y = dt > 0 ? (y - this.position.y) / dt : 0;
    this.position.y = y;
  }

  private lean(dt: number, far: number): void {
    const p = this.plan;
    const v = this.velocity;
    const noseOn = 1 - smoothstep(p.standoff, p.standoff * NOSE_ON_WITHIN, far);
    // On station the nose stays on the target with the tail swung a little wide. Running in, it points the way it flies.
    const faceX = _to.x * noseOn * 2 + (v.x / p.cruise) * (1 - noseOn * 0.7);
    const faceZ = _to.z * noseOn * 2 + (v.z / p.cruise) * (1 - noseOn * 0.7);
    this.yaw = dampAngle(this.yaw, Math.atan2(faceX, faceZ), p.turn, dt);
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const ahead = v.x * sin + v.z * cos;
    const across = v.x * cos - v.z * sin;
    this.pitch = damp(this.pitch, clamp(-ahead * p.lean, -p.maxPitch, p.maxPitch), p.response, dt);
    this.roll = damp(this.roll, clamp(-across * p.lean, -p.maxRoll, p.maxRoll), p.response, dt);
    this.aimNose();
  }

  private aimNose(): void {
    const cp = Math.cos(this.pitch);
    this.forward.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
  }
}
