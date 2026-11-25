/**
 * Redline Surge Reactor drive plug-in (`kind: 'redline'`).
 * - High-output jump-jets and standard Shift charges on a large fuel reserve.
 * - Standard partial fuel regeneration is intentionally slower (`0.45×`) to reward aggressive redlining.
 * - Draining `s.fuel` completely to `<= 0` triggers a **Redline Surge**: after a brief `0.35 s` capacitor stall,
 *   fuel snaps instantly back to `75%` of `s.maxFuel` and activates `s.redlineBuff = 4.5` s (+25% energy weapon
 *   charge/cooling power + blazing crimson overdrive visuals).
 */
import * as THREE from 'three';
import { FRAME } from '../../data';
import type { WalkerIntent } from '../../controller';
import type { MoveState } from '../gait/types';
import type { DrivePlugin } from './types';

export const REDLINE_STALL_SECONDS = 0.35;
export const REDLINE_SURGE_SHARE = 0.75;
export const REDLINE_BUFF_SECONDS = 4.5;
export const REDLINE_REGEN_MULT = 0.45;

const _wish = new THREE.Vector3();

interface RedlineState {
  stallLeft: number;
  armed: boolean;
}

let states = new WeakMap<MoveState, RedlineState>();

function stateOf(s: MoveState): RedlineState {
  let st = states.get(s);
  if (!st) {
    st = { stallLeft: 0, armed: true };
    states.set(s, st);
  }
  return st;
}

export const REDLINE_DRIVE: DrivePlugin = {
  kind: 'redline',
  hudLabel: 'REDLINE',
  maxFuel: m => FRAME.jet.fuel * m.fuelScale,
  maxCharges: () => FRAME.charge.count,
  chargeRefill: () => FRAME.charge.refill,

  reset(): void {
    states = new WeakMap<MoveState, RedlineState>();
  },

  jets(s: MoveState, h: number, intent: WalkerIntent): boolean {
    const st = stateOf(s);
    const J = FRAME.jet;
    const maxFuel = s.maxFuel;
    const v = s.velocity;

    // Active 0.35 s Redline capacitor stall: wait out the stutter, then snap fuel to 75% + 4.5 s crimson buff!
    if (st.stallLeft > 0) {
      st.stallLeft = Math.max(0, st.stallLeft - h);
      s.fuel = 0;
      s.boost = 0;
      s.jetting = false;
      if (s.grounded) {
        s.onGround += h;
      } else {
        s.onGround = 0;
        if (s.stomping) v.y = -FRAME.stomp.speed;
        else v.y -= FRAME.gravity * h;
      }
      if (st.stallLeft <= 0) {
        s.fuel = maxFuel * REDLINE_SURGE_SHARE;
        s.redlineBuff = REDLINE_BUFF_SECONDS;
        st.armed = true;
        s.said.charged = true;
      }
      return true;
    }

    // Catch fuel hitting <= 0 from any consumer (including Aero-Quad airGlide).
    if (s.fuel <= 0 && st.armed) {
      st.stallLeft = REDLINE_STALL_SECONDS;
      st.armed = false;
      s.fuel = 0;
      s.boost = 0;
      s.jetting = false;
      if (!s.grounded && !s.stomping) v.y -= FRAME.gravity * h;
      return true;
    }

    if (s.fuel > 0) st.armed = true;

    // Slower standard ground regeneration (0.45×) to incentivize running the reactor dry into Redline Surge.
    if (s.grounded) {
      s.onGround += h;
      if (s.onGround > J.refillAfter && s.fuel < maxFuel) {
        const regenScale = s.fuelRegenScale >= 0.99 ? REDLINE_REGEN_MULT : s.fuelRegenScale * 0.9;
        s.fuel = Math.min(maxFuel, s.fuel + (maxFuel / J.refill) * regenScale * h);
      }
    } else {
      s.onGround = 0;
    }

    // High-output jump-jet launch off the ground.
    const launch = intent.jet && !s.jetting && s.grounded && s.jumpScale > 0 && s.fuel >= J.launchMin && s.recover <= 0 && !s.stomping;
    if (launch) {
      v.y = J.launch * 1.08 * s.jumpScale;
      s.boost = J.boostSeconds;
      s.grounded = false;
      s.said.lifted = true;
      s.wish(intent, _wish);
      const want = Math.hypot(_wish.x, _wish.z);
      if (want > 0.1) {
        const k = Math.min(J.kick * 1.1, Math.max(0, FRAME.walk.forward - (v.x * _wish.x + v.z * _wish.z) / want)) / want;
        v.x += _wish.x * k;
        v.z += _wish.z * k;
      }
    }

    const burning = intent.jet && !s.grounded && !s.stomping && s.fuel > 0;
    if (burning) {
      s.fuel = Math.max(0, s.fuel - h);
      if (s.boost > 0) {
        s.boost -= h;
        v.y += J.boost * h;
      } else {
        v.y += (0 - v.y) * (1 - Math.exp(-J.hold * h));
      }
      if (s.fuel <= 0) {
        st.stallLeft = REDLINE_STALL_SECONDS;
        st.armed = false;
        s.boost = 0;
        s.jetting = false;
        return true;
      }
    } else {
      s.boost = 0;
      if (s.stomping) v.y = -FRAME.stomp.speed;
      else if (!s.grounded) v.y -= FRAME.gravity * h;
    }

    s.jetting = intent.jet && (burning || s.grounded);
    return true;
  },
};
