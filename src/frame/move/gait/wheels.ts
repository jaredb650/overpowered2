/**
 * Drift-Wheel Rig gait plug-in (`kind: 'wheels'`).
 * - Blistering ground speed (`legsWheels` walk ×1.60 + drift-rig drive boost) with zero stride bob (`noSurge: true`).
 * - Powerslide momentum carving: sharp turns at speed preserve tangential drift momentum while carving cleanly around
 *   targets so heavy weapons stay dead-steady while circle-strafing.
 * - High-traction road hug on slopes, snappy wheel steering, and no stomp (drives through and crushes infantry).
 */
import * as THREE from 'three';
import { wrapAngle } from '../../../core/math';
import { FRAME } from '../../data';
import type { WalkerIntent } from '../../controller';
import type { GaitPlugin, MoveState } from './types';

const _wish = new THREE.Vector3();

const WHEEL_ACCEL = 36;
const WHEEL_BRAKE = 26;
const WHEEL_DRIFT_CARVE = 17;
const WHEEL_DRIFT_SPEED = 5.5;
const WHEEL_AIR_CONTROL = 0.32;
const WHEEL_TURN_MULT = 1.4;
const WHEEL_SPEED_BONUS = 1.08;

export const WHEELS_GAIT: GaitPlugin = {
  kind: 'wheels',
  stepHeight: FRAME.body.step,
  minWalkY: FRAME.body.minWalkY,
  noSurge: true,

  turn(s: MoveState, h: number, intent: WalkerIntent): boolean {
    const T = FRAME.turn;
    const v = s.velocity;
    const speed = Math.hypot(v.x, v.z);
    // Align chassis smoothly toward actual travel vector while rolling fast, or aim yaw when slow/stationary.
    const targetYaw = speed > 2.5 ? Math.atan2(-v.x, -v.z) : intent.viewYaw;
    const off = wrapAngle(targetYaw - s.legYaw);
    const maxStep = T.rate * WHEEL_TURN_MULT * s.turnScale * h;
    s.legYaw = wrapAngle(s.legYaw + Math.sign(off) * Math.min(Math.abs(off), maxStep));
    // Upper torso/turret aims freely while the wheel sled drifts around corners.
    s.viewYaw = intent.viewYaw;
    return true;
  },

  walk(s: MoveState, h: number, intent: WalkerIntent): boolean {
    const W = FRAME.walk;
    const v = s.velocity;

    if (s.charging > 0) {
      s.charging -= h;
      const speed = s.charging > 0 ? FRAME.charge.speed * s.dashScale : W.forward * s.speedScale;
      v.x = s.chargeDir.x * speed;
      v.z = s.chargeDir.z * speed;
      return true;
    }
    if (s.stomping) return true;

    let hasInput = false;
    if (s.recover > 0) {
      _wish.set(0, 0, 0);
    } else {
      let mx = intent.moveX;
      let mz = intent.moveZ;
      const len = Math.hypot(mx, mz);
      if (len > 1e-3) {
        hasInput = true;
        if (len > 1) {
          mx /= len;
          mz /= len;
        }
        const sy = Math.sin(s.viewYaw);
        const cy = Math.cos(s.viewYaw);
        const topForward = W.forward * s.speedScale * WHEEL_SPEED_BONUS;
        const ahead = mz * (mz >= 0 ? topForward : topForward * 0.78);
        const side = mx * topForward * 0.92;
        _wish.set(-sy * ahead + cy * side, 0, -cy * ahead - sy * side);
      } else {
        _wish.set(0, 0, 0);
      }
    }

    const control = s.grounded ? 1 : (s.jetting ? 0.65 : WHEEL_AIR_CONTROL);
    const now = Math.hypot(v.x, v.z);
    const want = Math.hypot(_wish.x, _wish.z);

    if (s.grounded && hasInput && now > WHEEL_DRIFT_SPEED && want > 0.1) {
      const cosTurn = (v.x * _wish.x + v.z * _wish.z) / (now * want);
      if (cosTurn < 0.78) {
        // High-speed powerslide drift: preserve tangential momentum while carving into the new direction.
        const blend = 1 - Math.exp(-WHEEL_DRIFT_CARVE * 0.28 * h);
        const carriedSpeed = Math.max(now * Math.exp(-0.55 * h), Math.min(want, now + WHEEL_ACCEL * 0.45 * h));
        const nx = v.x / now;
        const nz = v.z / now;
        const wx = _wish.x / want;
        const wz = _wish.z / want;
        let rx = nx + (wx - nx) * blend;
        let rz = nz + (wz - nz) * blend;
        const rLen = Math.hypot(rx, rz);
        if (rLen > 1e-4) {
          rx /= rLen;
          rz /= rLen;
          v.x = rx * carriedSpeed;
          v.z = rz * carriedSpeed;
          return true;
        }
      }
    }

    const dx = _wish.x - v.x;
    const dz = _wish.z - v.z;
    const d = Math.hypot(dx, dz);
    const gaining = want > now && v.x * _wish.x + v.z * _wish.z >= 0;
    const step = (gaining ? WHEEL_ACCEL : WHEEL_BRAKE) * control * h;

    if (d <= step) {
      v.x = _wish.x;
      v.z = _wish.z;
    } else {
      v.x += (dx / d) * step;
      v.z += (dz / d) * step;
    }
    return true;
  },

  startStomp(): boolean {
    // Low-slung wheel sled does not stomp; high-speed impacts crush infantry via `crushOnDrive`.
    return true;
  },
};
