/**
 * Aero-Quad Legs gait plug-in (`kind: 'aeroQuad'`).
 * - Brisk, stable 4-legged tetrapod walk on the ground (`ACCEL_MULT = 1.45`, agile strafing & turning).
 * - Mid-air Flat Hover-Glide (`airGlide`): holding Space in mid-air splays all 4 sleek wing-legs flat horizontally
 *   (`s.aeroHovering = true`), locking altitude at half normal fuel drain (`0.5×`) while gliding smoothly at `14 m/s`
 *   in any WASD direction!
 */
import * as THREE from 'three';
import { clamp, wrapAngle } from '../../../core/math';
import { FRAME } from '../../data';
import type { WalkerIntent } from '../../controller';
import type { GaitPlugin, MoveState } from './types';

const _wish = new THREE.Vector3();

const GROUND_ACCEL_MULT = 1.45;
const GROUND_DECEL_MULT = 1.4;
const TURN_MULT = 1.25;
const AERO_GLIDE_SPEED = 14;
const AERO_GLIDE_ACCEL = 42;
const AERO_GLIDE_DECEL = 20;
const AERO_FUEL_DRAIN_SCALE = 0.5;
const AERO_ALTITUDE_LOCK = 14;
const AIR_CONTROL = 0.72;

export const AERO_QUAD_GAIT: GaitPlugin = {
  kind: 'aeroQuad',
  stepHeight: FRAME.body.step,
  minWalkY: FRAME.body.minWalkY,

  turn(s: MoveState, h: number, intent: WalkerIntent): boolean {
    const T = FRAME.turn;
    const off = wrapAngle(intent.viewYaw - s.legYaw);
    if (s.free || s.aeroHovering) {
      s.legYaw = wrapAngle(s.legYaw + off * (1 - Math.exp(-T.free * TURN_MULT * s.turnScale * h)));
      s.viewYaw = intent.viewYaw;
    } else {
      const over = Math.abs(off) - T.arc;
      const moving = s.grounded && (intent.moveX !== 0 || intent.moveZ !== 0);
      const rate = over > 0
        ? Math.min(over, T.rate * TURN_MULT * s.turnScale * h)
        : moving ? Math.min(Math.abs(off), T.walking * 1.4 * s.turnScale * h) : 0;
      s.legYaw = wrapAngle(s.legYaw + Math.sign(off) * rate);
      s.viewYaw = wrapAngle(s.legYaw + clamp(wrapAngle(intent.viewYaw - s.legYaw), -T.arc, T.arc));
    }
    return true;
  },

  airGlide(s: MoveState, h: number, intent: WalkerIntent): boolean {
    // Only engage flat hover-glide in mid-air when holding Space after initial launch climb completes.
    if (s.grounded || s.stomping || s.jetMode || s.assaultBoosting || !intent.jet || s.fuel <= 0) {
      return false;
    }
    if (s.boost > 0 && s.velocity.y > 2.2) {
      return false;
    }

    s.aeroHovering = true;
    s.jetting = true;
    s.boost = 0;
    s.onGround = 0;

    // Half normal fuel drain while hovering flat on splayed wing-limbs.
    s.fuel = Math.max(0, s.fuel - h * AERO_FUEL_DRAIN_SCALE);

    // Lock vertical velocity smoothly to level altitude.
    s.velocity.y += (0 - s.velocity.y) * (1 - Math.exp(-AERO_ALTITUDE_LOCK * h));
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

    if (s.aeroHovering) {
      // Sustained 14 m/s omnidirectional level air-glide while splayed horizontally.
      let mx = intent.moveX;
      let mz = intent.moveZ;
      const len = Math.hypot(mx, mz);
      if (len > 1e-3) {
        if (len > 1) {
          mx /= len;
          mz /= len;
        }
        const sy = Math.sin(s.viewYaw);
        const cy = Math.cos(s.viewYaw);
        const glideSpeed = AERO_GLIDE_SPEED * Math.max(1, s.speedScale / 1.15);
        _wish.set((-sy * mz + cy * mx) * glideSpeed, 0, (-cy * mz - sy * mx) * glideSpeed);
      } else {
        _wish.set(0, 0, 0);
      }
      const dx = _wish.x - v.x;
      const dz = _wish.z - v.z;
      const d = Math.hypot(dx, dz);
      const step = (len > 1e-3 ? AERO_GLIDE_ACCEL : AERO_GLIDE_DECEL) * h;
      if (d <= step) {
        v.x = _wish.x;
        v.z = _wish.z;
      } else {
        v.x += (dx / d) * step;
        v.z += (dz / d) * step;
      }
      return true;
    }

    // Standard brisk tetrapod walk on ground (or controlled fall in air).
    if (s.recover > 0) _wish.set(0, 0, 0);
    else s.wish(intent, _wish);
    const control = s.grounded || s.jetting ? 1 : AIR_CONTROL;
    const now = Math.hypot(v.x, v.z);
    const want = Math.hypot(_wish.x, _wish.z);
    const gaining = want > now && v.x * _wish.x + v.z * _wish.z >= 0;
    const step = (gaining ? W.accel * GROUND_ACCEL_MULT : W.decel * GROUND_DECEL_MULT) * control * h;
    const dx = _wish.x - v.x;
    const dz = _wish.z - v.z;
    const d = Math.hypot(dx, dz);
    if (d <= step) {
      v.x = _wish.x;
      v.z = _wish.z;
    } else {
      v.x += (dx / d) * step;
      v.z += (dz / d) * step;
    }
    return true;
  },
};
