/**
 * Spider Legs gait plug-in: 4-legged climbing gun platform.
 *
 *   - `stepHeight: 2.2` climbs 2.2 m ledges and rubble walls effortlessly.
 *   - `minWalkY` slightly below `cos(45°)` (`Math.SQRT1_2 - 1e-3 ≈ 0.7061`) so 45° slopes are walkable
 *     even with 32-bit Rapier normal rounding.
 *   - `legSweepOnStomp: true` + `startStomp` suppresses vertical slam and triggers a 360° 5 m leg sweep
 *     knockdown via `s.said.swept` (`seat.ts`).
 *   - `noSurge: true` + responsive omnidirectional acceleration for a steady 4-leg climbing gait
 *     (pairs with `strafe: 1.4` and `noRecoil: true` in `loadout.ts`).
 */
import * as THREE from 'three';
import { clamp, wrapAngle } from '../../../core/math';
import { FRAME } from '../../data';
import type { WalkerIntent } from '../../controller';
import type { GaitPlugin, MoveState } from './types';

const _wish = new THREE.Vector3();

/** Seconds between 360° leg sweeps so crouch-stomp cannot be spammed every frame. */
const SWEEP_COOLDOWN = 0.85;
const ACCEL_MULT = 1.4;
const DECEL_MULT = 1.5;
const TURN_RATE_MULT = 1.2;
const TURN_WALK_MULT = 1.35;

let sweepCooldowns = new WeakMap<MoveState, number>();

export const SPIDER_GAIT: GaitPlugin = {
  kind: 'spider',
  stepHeight: 2.2,
  /** `cos(45°) ≈ 0.7071` minus f32 tolerance so exact 45° Rapier slopes climb cleanly. */
  minWalkY: Math.SQRT1_2 - 1e-3,
  legSweepOnStomp: true,
  noSurge: true,

  reset(): void {
    sweepCooldowns = new WeakMap<MoveState, number>();
  },

  turn(s: MoveState, h: number, intent: WalkerIntent): boolean {
    const cd = sweepCooldowns.get(s) ?? 0;
    if (cd > 0) sweepCooldowns.set(s, Math.max(0, cd - h));

    const T = FRAME.turn;
    const off = wrapAngle(intent.viewYaw - s.legYaw);
    if (s.free) {
      s.legYaw = wrapAngle(s.legYaw + off * (1 - Math.exp(-T.free * TURN_RATE_MULT * s.turnScale * h)));
      s.viewYaw = intent.viewYaw;
    } else {
      const over = Math.abs(off) - T.arc;
      const moving = s.grounded && (intent.moveX !== 0 || intent.moveZ !== 0);
      const rate = over > 0
        ? Math.min(over, T.rate * TURN_RATE_MULT * s.turnScale * h)
        : moving ? Math.min(Math.abs(off), T.walking * TURN_WALK_MULT * s.turnScale * h) : 0;
      s.legYaw = wrapAngle(s.legYaw + Math.sign(off) * rate);
      s.viewYaw = wrapAngle(s.legYaw + clamp(wrapAngle(intent.viewYaw - s.legYaw), -T.arc, T.arc));
    }
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
    if (s.recover > 0) _wish.set(0, 0, 0);
    else s.wish(intent, _wish);
    const control = s.grounded || s.jetting ? 1 : W.air;
    const now = Math.hypot(v.x, v.z);
    const want = Math.hypot(_wish.x, _wish.z);
    const gaining = want > now && v.x * _wish.x + v.z * _wish.z >= 0;
    const step = (gaining ? W.accel * ACCEL_MULT : W.decel * DECEL_MULT) * control * h;
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

  startStomp(s: MoveState): boolean {
    // Replaces vertical stomp with a 360° 5 m leg sweep knockdown handled by `seat.ts`.
    const cd = sweepCooldowns.get(s) ?? 0;
    if (cd <= 0 && s.recover <= 0) {
      s.said.swept = true;
      sweepCooldowns.set(s, SWEEP_COOLDOWN);
    }
    return true;
  },
};
