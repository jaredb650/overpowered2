/**
 * Blink-Step Booster drive plug-in (`kind: 'blink'`).
 * - Omnidirectional rapid Quick-Boost dodge on Shift: 3 fast charges, 1.1 s recharge each.
 * - Instantaneous 42 m/s snap-burst for 0.18 s in any WASD direction (or forward if no WASD held),
 *   working seamlessly on the ground or in mid-air while writing `dashDirX`/`dashDirZ` for chassis banking
 *   and lateral vernier nozzle flares.
 * - Provides snappy standard Jump-Jets on Space.
 */
import { FRAME } from '../../data';
import type { WalkerIntent } from '../../controller';
import type { MoveState } from '../gait/types';
import type { DrivePlugin } from './types';

export const BLINK_CHARGES = 3;
export const BLINK_REFILL = 1.1;
export const BLINK_SPEED = 42;
export const BLINK_DURATION = 0.18;

export const BLINK_DRIVE: DrivePlugin = {
  kind: 'blink',
  hudLabel: 'BLINK',
  maxFuel: m => FRAME.jet.fuel * m.fuelScale,
  maxCharges: () => BLINK_CHARGES,
  chargeRefill: () => BLINK_REFILL,

  charge(s: MoveState, h: number, intent: WalkerIntent): boolean {
    if (intent.charge && s.charges > 0 && s.charging <= 0 && !s.stomping) {
      s.charges--;
      if (s.chargeIn <= 0) s.chargeIn = BLINK_REFILL;
      s.charging = BLINK_DURATION;
      s.recover = 0;

      const sy = Math.sin(s.viewYaw);
      const cy = Math.cos(s.viewYaw);
      let mx = intent.moveX;
      let mz = intent.moveZ;
      const len = Math.hypot(mx, mz);

      if (len > 1e-3) {
        mx /= len;
        mz /= len;
        const dx = -sy * mz + cy * mx;
        const dz = -cy * mz - sy * mx;
        s.chargeDir.set(dx, 0, dz).normalize();
        // Torso-local directional vector (+X right, -Z forward) for vernier flare & bank visuals.
        s.dashDirX = mx;
        s.dashDirZ = -mz;
      } else {
        s.chargeDir.set(-sy, 0, -cy).normalize();
        s.dashDirX = 0;
        s.dashDirZ = -1;
      }

      // Instantaneous snap impulse on the trigger tick.
      s.velocity.x = s.chargeDir.x * BLINK_SPEED;
      s.velocity.z = s.chargeDir.z * BLINK_SPEED;
      if (!s.grounded && s.velocity.y < 0) {
        // Arrest steep downward fall briefly during a mid-air dodge.
        s.velocity.y *= 0.35;
      }
      s.said.charged = true;
      return true;
    }

    // Smoothly bleed dashDir visual vector back to neutral once blink finishes.
    if (s.charging <= 0 && (Math.abs(s.dashDirX) > 1e-4 || Math.abs(s.dashDirZ) > 1e-4)) {
      const decay = Math.exp(-12 * h);
      s.dashDirX *= decay;
      s.dashDirZ *= decay;
      if (Math.hypot(s.dashDirX, s.dashDirZ) < 0.01) {
        s.dashDirX = 0;
        s.dashDirZ = 0;
      }
    }
    return true;
  },

  airMove(s: MoveState, h: number): boolean {
    if (s.charging <= 0) return false;
    s.charging = Math.max(0, s.charging - h);
    const speed = s.charging > 0 ? BLINK_SPEED : FRAME.walk.forward * s.speedScale * 1.25;
    s.velocity.x = s.chargeDir.x * speed;
    s.velocity.z = s.chargeDir.z * speed;
    return true;
  },
};
