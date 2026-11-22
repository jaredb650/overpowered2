/**
 * Long-Haul Engine drive plug-in (`kind: 'diesel'`).
 * - Normal hop with 1.3× jet fuel (`FRAME.jet.fuel * 1.3`).
 * - Hold Shift: steady 11 m/s long-haul run for up to 12.0 s continuously, keeping `s.charging > 0` so it tramples
 *   and shoves small enemies along the way. Refills its 12.0 s stamina reservoir fully in 4.0 s when Shift is released.
 */
import { wrapAngle } from '../../../core/math';
import { FRAME } from '../../data';
import type { WalkerIntent } from '../../controller';
import type { MoveState } from '../gait/types';
import type { DrivePlugin } from './types';

const RUN_SPEED = 11;
const MAX_STAMINA = 12.0;
const REFILL_TIME = 4.0;
const RUN_ACCEL = 48;

interface DieselState {
  stamina: number;
  running: boolean;
}

let states = new WeakMap<MoveState, DieselState>();

function stateOf(s: MoveState): DieselState {
  let st = states.get(s);
  if (!st) {
    st = { stamina: MAX_STAMINA, running: false };
    states.set(s, st);
  }
  return st;
}

export const DIESEL_DRIVE: DrivePlugin = {
  kind: 'diesel',
  hudLabel: 'LONG-HAUL',
  maxFuel: () => FRAME.jet.fuel * 1.3,
  maxCharges: () => Math.round(MAX_STAMINA),
  chargeRefill: () => 0,

  reset(): void {
    states = new WeakMap<MoveState, DieselState>();
  },

  charge(s: MoveState, h: number, intent: WalkerIntent): boolean {
    const st = stateOf(s);
    const shiftDown = Boolean(intent.chargeHeld || intent.charge);

    // If a wall collision ended `s.charging` during an active run, stop until recovery completes.
    if (st.running && s.recover > 0) {
      st.running = false;
      s.charging = 0;
    }

    const canRun = shiftDown && s.grounded && !s.stomping && s.recover <= 0 && st.stamina > 0;
    if (canRun) {
      if (!st.running) {
        st.running = true;
        s.said.charged = true;
      }
      st.stamina = Math.max(0, st.stamina - h);
      s.charging = st.stamina > 0 ? Math.max(0.1, st.stamina) : 0;
      if (st.stamina <= 0) {
        st.running = false;
        s.charging = 0;
      }
    } else {
      st.running = false;
      s.charging = 0;
      if (!shiftDown) {
        st.stamina = Math.min(MAX_STAMINA, st.stamina + (MAX_STAMINA / REFILL_TIME) * h);
      }
    }

    s.charges = Math.ceil(st.stamina);
    return true;
  },

  airMove(s: MoveState, h: number, intent: WalkerIntent): boolean {
    const st = stateOf(s);
    if (!st.running || s.charging <= 0 || !s.grounded || s.stomping) return false;

    const sy = Math.sin(s.viewYaw);
    const cy = Math.cos(s.viewYaw);
    let dx = -sy;
    let dz = -cy;
    const len = Math.hypot(intent.moveX, intent.moveZ);
    if (len > 1e-3) {
      const nx = intent.moveX / len;
      const nz = intent.moveZ / len;
      dx = -sy * nz + cy * nx;
      dz = -cy * nz - sy * nx;
    }

    s.chargeDir.set(dx, 0, dz).normalize();

    // Bring legs smoothly under the view while running.
    const yawDiff = wrapAngle(s.viewYaw - s.legYaw);
    s.legYaw = wrapAngle(s.legYaw + Math.sign(yawDiff) * Math.min(Math.abs(yawDiff), FRAME.turn.rate * h));

    const tx = s.chargeDir.x * RUN_SPEED;
    const tz = s.chargeDir.z * RUN_SPEED;
    const v = s.velocity;
    const step = RUN_ACCEL * h;
    const ex = tx - v.x;
    const ez = tz - v.z;
    const d = Math.hypot(ex, ez);
    if (d <= step) {
      v.x = tx;
      v.z = tz;
    } else {
      v.x += (ex / d) * step;
      v.z += (ez / d) * step;
    }
    return true;
  },
};
