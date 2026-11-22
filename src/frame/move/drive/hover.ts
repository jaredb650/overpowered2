/**
 * Rotor Engine drive plug-in (`kind: 'hover'`).
 * - Holding Space climbs smoothly up to 14 m over the ground (`s.clearance()`) and hovers indefinitely at zero fuel cost.
 * - Full omnidirectional airborne strafing at 9 m/s (`s.hovering = !s.grounded`).
 * - No Shift charge (`maxCharges: 0`). Pairs with `airborneDamageMult: 1.25` in `loadout.ts`.
 */
import { FRAME } from '../../data';
import type { WalkerIntent } from '../../controller';
import type { MoveState } from '../gait/types';
import type { DrivePlugin } from './types';

const CEILING = 14;
const CLIMB_SPEED = 7.5;
const LAUNCH_SPEED = 6.0;
const AIR_SPEED = 9;

export const HOVER_DRIVE: DrivePlugin = {
  kind: 'hover',
  hudLabel: 'ROTOR',
  maxFuel: () => FRAME.jet.fuel,
  maxCharges: () => 0,
  chargeRefill: () => 0,

  charge(s: MoveState): boolean {
    s.charges = 0;
    s.charging = 0;
    return true;
  },

  jets(s: MoveState, h: number, intent: WalkerIntent): boolean {
    const v = s.velocity;
    // Zero fuel cost: tank stays full indefinitely.
    s.fuel = s.maxFuel;

    if (s.stomping) {
      v.y = -FRAME.stomp.speed;
      s.jetting = false;
      s.hovering = false;
      s.flying = false;
      return true;
    }

    if (intent.jet && s.recover <= 0) {
      if (s.grounded) {
        s.grounded = false;
        s.said.lifted = true;
        v.y = Math.max(v.y, LAUNCH_SPEED);
      }
      const alt = s.clearance();
      const headroom = CEILING - alt;
      let targetVy: number;
      if (headroom > 0.05) {
        targetVy = Math.min(CLIMB_SPEED, headroom * 3.5);
      } else {
        targetVy = Math.max(-4.5, headroom * 3.0);
      }
      v.y += (targetVy - v.y) * (1 - Math.exp(-8 * h));
      if (alt >= CEILING && v.y > 0) v.y = 0;
      s.jetting = true;
      s.hovering = !s.grounded;
      s.flying = false;
    } else {
      s.jetting = false;
      s.flying = false;
      if (!s.grounded) v.y -= FRAME.gravity * h;
      s.hovering = !s.grounded;
    }
    return true;
  },

  airMove(s: MoveState, h: number, intent: WalkerIntent): boolean {
    if (s.grounded || s.stomping) return false;
    const v = s.velocity;
    let wx = 0;
    let wz = 0;
    if (s.recover <= 0) {
      let mx = intent.moveX;
      let mz = intent.moveZ;
      const len = Math.hypot(mx, mz);
      if (len > 1) {
        mx /= len;
        mz /= len;
      }
      const sy = Math.sin(s.viewYaw);
      const cy = Math.cos(s.viewYaw);
      wx = (-sy * mz + cy * mx) * AIR_SPEED;
      wz = (-cy * mz - sy * mx) * AIR_SPEED;
    }

    const step = 22 * h;
    const dx = wx - v.x;
    const dz = wz - v.z;
    const d = Math.hypot(dx, dz);
    if (d <= step) {
      v.x = wx;
      v.z = wz;
    } else {
      v.x += (dx / d) * step;
      v.z += (dz / d) * step;
    }
    return true;
  },
};
