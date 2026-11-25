/**
 * Assault-Ram Drive plug-in (`kind: 'assault'`).
 * - Holding Shift engages sustained **Assault Boost** (`s.assaultBoosting = true`): locks onto a relentless 28 m/s
 *   forward jet-ram with lateral WASD weave steering, burning 24%/s of fuel (`0.24 * maxFuel / s`).
 * - Grants 30% frontal damage reduction in `seat.ts` and unlocks the 480+ dmg Boost Kick on `F` mid-rush.
 * - Supports normal Space jump-jets and fuel refill when not Assault Boosting.
 */
import { clamp, wrapAngle } from '../../../core/math';
import { FRAME } from '../../data';
import type { WalkerIntent } from '../../controller';
import type { MoveState } from '../gait/types';
import type { DrivePlugin } from './types';

export const ASSAULT_SPEED = 28;
export const ASSAULT_STEER_SPEED = 7.5;
/** Fuel burn rate: 24% of max fuel per second (matches 24/s on the 0..100 HUD gauge). */
export const ASSAULT_FUEL_BURN_FRACTION = 0.24;
const ASSAULT_MIN_ENGAGE_FRACTION = 0.04;
const ASSAULT_ACCEL = 95;

export const ASSAULT_DRIVE: DrivePlugin = {
  kind: 'assault',
  hudLabel: 'ASSAULT',
  maxFuel: m => FRAME.jet.fuel * m.fuelScale,
  maxCharges: () => 0,
  chargeRefill: () => 0,

  charge(s: MoveState, h: number, intent: WalkerIntent): boolean {
    s.charges = 0;
    const shiftDown = Boolean(intent.chargeHeld || intent.charge);

    if (s.assaultBoosting) {
      if (!shiftDown || s.fuel <= 0 || s.stomping || s.recover > 0) {
        s.assaultBoosting = false;
        s.charging = 0;
        s.dashDirX = 0;
        s.dashDirZ = 0;
      } else {
        s.fuel = Math.max(0, s.fuel - ASSAULT_FUEL_BURN_FRACTION * s.maxFuel * h);
        // Keep `charging` positive so wall-impact and charge-shove checks remain active.
        s.charging = s.fuel > 0 ? 0.1 : 0;
        if (s.fuel <= 0) {
          s.assaultBoosting = false;
          s.charging = 0;
          s.dashDirX = 0;
          s.dashDirZ = 0;
        }
      }
    } else if (shiftDown && s.fuel > s.maxFuel * ASSAULT_MIN_ENGAGE_FRACTION && !s.stomping && s.recover <= 0) {
      s.assaultBoosting = true;
      s.charging = 0.1;
      s.recover = 0;
      s.said.charged = true;
    }

    return true;
  },

  jets(s: MoveState, h: number, intent: WalkerIntent): boolean {
    if (!s.assaultBoosting) return false;

    const v = s.velocity;
    s.onGround = 0;

    // Allow hopping into an aerial assault-ram if Space is tapped while boosting on the ground.
    if (intent.jet && s.grounded && s.jumpScale > 0 && s.fuel > 0) {
      v.y = FRAME.jet.launch * 0.85 * s.jumpScale;
      s.grounded = false;
      s.said.lifted = true;
    } else if (!s.grounded) {
      const targetVy = clamp((intent.viewPitch ?? 0) * 14, -8, 8);
      v.y += (targetVy - v.y) * (1 - Math.exp(-8 * h));
    }

    s.jetting = !s.grounded;
    return true;
  },

  airMove(s: MoveState, h: number, intent: WalkerIntent): boolean {
    if (!s.assaultBoosting) return false;

    const sy = Math.sin(s.viewYaw);
    const cy = Math.cos(s.viewYaw);
    const fx = -sy;
    const fz = -cy;
    const rx = cy;
    const rz = -sy;

    // Smoothly align legs forward under the assault heading.
    const yawDiff = wrapAngle(s.viewYaw - s.legYaw);
    s.legYaw = wrapAngle(s.legYaw + Math.sign(yawDiff) * Math.min(Math.abs(yawDiff), FRAME.turn.rate * 1.6 * h));

    const steer = clamp(intent.moveX, -1, 1);
    const tx = fx * ASSAULT_SPEED + rx * steer * ASSAULT_STEER_SPEED;
    const tz = fz * ASSAULT_SPEED + rz * steer * ASSAULT_STEER_SPEED;

    s.chargeDir.set(fx, 0, fz).normalize();
    s.dashDirX = steer * 0.35;
    s.dashDirZ = -1;

    const v = s.velocity;
    const dx = tx - v.x;
    const dz = tz - v.z;
    const d = Math.hypot(dx, dz);
    const step = ASSAULT_ACCEL * h;
    if (d <= step) {
      v.x = tx;
      v.z = tz;
    } else {
      v.x += (dx / d) * step;
      v.z += (dz / d) * step;
    }
    return true;
  },
};
