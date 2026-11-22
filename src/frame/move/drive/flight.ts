/**
 * Jump-Jet Engine drive plug-in (`kind: 'flight'`).
 * - 4.0 s fuel tank; refills fully in 3.0 s starting 1.2 s after the last jet or blast use.
 * - Holding Space: true free-flight climb (no altitude ceiling) with 14 m/s air horizontal speed.
 * - Pressing Shift: 32 m/s omnidirectional jet blast for 0.6 s (including upward when pitching up or holding Space),
 *   costing 1.0 s of fuel (requires >= 1.0 s fuel).
 */
import * as THREE from 'three';
import { clamp } from '../../../core/math';
import { FRAME } from '../../data';
import type { WalkerIntent } from '../../controller';
import type { MoveState } from '../gait/types';
import type { DrivePlugin } from './types';

const MAX_FUEL = 4.0;
const REFILL_DELAY = 1.2;
const REFILL_TIME = 3.0;
const AIR_SPEED = 14;
const CLIMB_SPEED = 11.5;
const LAUNCH_SPEED = 9.5;
const BLAST_SPEED = 32;
const BLAST_SECONDS = 0.6;
const BLAST_COST = 1.0;

interface FlightState {
  sinceUse: number;
  blastLeft: number;
  readonly blastDir: THREE.Vector3;
}

let states = new WeakMap<MoveState, FlightState>();

function stateOf(s: MoveState): FlightState {
  let st = states.get(s);
  if (!st) {
    st = { sinceUse: REFILL_DELAY, blastLeft: 0, blastDir: new THREE.Vector3(0, 0, -1) };
    states.set(s, st);
  }
  return st;
}

export const FLIGHT_DRIVE: DrivePlugin = {
  kind: 'flight',
  hudLabel: 'FLIGHT',
  maxFuel: () => MAX_FUEL,
  maxCharges: () => Math.floor(MAX_FUEL),
  chargeRefill: () => 0,

  reset(): void {
    states = new WeakMap<MoveState, FlightState>();
  },

  charge(s: MoveState, _h: number, intent: WalkerIntent): boolean {
    const st = stateOf(s);
    if (st.blastLeft > 0 && (s.charging <= 0 || s.stomping)) {
      st.blastLeft = 0;
      s.charging = 0;
    }
    if (intent.charge && st.blastLeft <= 0 && !s.stomping && s.fuel >= BLAST_COST) {
      s.fuel = Math.max(0, s.fuel - BLAST_COST);
      st.sinceUse = 0;
      st.blastLeft = BLAST_SECONDS;
      s.charging = BLAST_SECONDS;
      s.recover = 0;
      s.legYaw = s.viewYaw;

      const sy = Math.sin(s.viewYaw);
      const cy = Math.cos(s.viewYaw);
      const pitch = clamp(intent.viewPitch ?? 0, -Math.PI * 0.48, Math.PI * 0.48);
      const hasMove = Math.abs(intent.moveX) > 1e-3 || Math.abs(intent.moveZ) > 1e-3;

      let dx = 0;
      let dy = 0;
      let dz = 0;
      if (!hasMove) {
        const cp = Math.cos(pitch);
        dx = -sy * cp;
        dy = Math.sin(pitch);
        dz = -cy * cp;
        if (intent.jet) dy = Math.max(dy, 0) + 0.85;
      } else {
        const mlen = Math.hypot(intent.moveX, intent.moveZ);
        const nx = intent.moveX / mlen;
        const nz = intent.moveZ / mlen;
        const cp = nz > 0 ? Math.cos(pitch) : 1;
        dx = -sy * nz * cp + cy * nx;
        dz = -cy * nz * cp - sy * nx;
        if (nz > 0) dy = Math.sin(pitch) * nz;
        if (intent.jet) dy = Math.max(dy, 0) + 0.75;
      }

      if (s.grounded && dy < 0) dy = 0;
      const len = Math.hypot(dx, dy, dz);
      if (len > 1e-5) {
        st.blastDir.set(dx / len, dy / len, dz / len);
      } else {
        st.blastDir.set(-sy, 0, -cy);
      }

      if (st.blastDir.y > 0.05) {
        s.grounded = false;
        s.said.lifted = true;
      }
      s.velocity.copy(st.blastDir).multiplyScalar(BLAST_SPEED);
      s.flying = true;
      s.jetting = true;
      s.said.charged = true;
    }
    s.charges = Math.floor(s.fuel);
    return true;
  },

  jets(s: MoveState, h: number, intent: WalkerIntent): boolean {
    const st = stateOf(s);
    const v = s.velocity;

    if (s.stomping) {
      st.blastLeft = 0;
      s.charging = 0;
      v.y = -FRAME.stomp.speed;
      s.jetting = false;
      s.flying = false;
      st.sinceUse += h;
      if (st.sinceUse >= REFILL_DELAY) {
        s.fuel = Math.min(MAX_FUEL, s.fuel + (MAX_FUEL / REFILL_TIME) * h);
      }
      s.charges = Math.floor(s.fuel);
      return true;
    }

    if (st.blastLeft > 0) {
      st.sinceUse = 0;
      s.flying = true;
      s.jetting = true;
      if (st.blastDir.y > 0.05) s.grounded = false;
      s.charges = Math.floor(s.fuel);
      return true;
    }

    const thrusting = intent.jet && s.fuel > 0 && s.recover <= 0;
    if (thrusting) {
      if (s.grounded) {
        s.grounded = false;
        s.said.lifted = true;
        v.y = Math.max(v.y, LAUNCH_SPEED);
      }
      s.fuel = Math.max(0, s.fuel - h);
      st.sinceUse = 0;
      v.y += (CLIMB_SPEED - v.y) * (1 - Math.exp(-8 * h));
      s.flying = true;
      s.jetting = true;
    } else {
      s.jetting = false;
      s.flying = false;
      if (!s.grounded) v.y -= FRAME.gravity * h;
      st.sinceUse += h;
      if (st.sinceUse >= REFILL_DELAY) {
        s.fuel = Math.min(MAX_FUEL, s.fuel + (MAX_FUEL / REFILL_TIME) * h);
      }
    }
    s.charges = Math.floor(s.fuel);
    return true;
  },

  airMove(s: MoveState, h: number, intent: WalkerIntent): boolean {
    const st = stateOf(s);
    const v = s.velocity;

    if (st.blastLeft > 0) {
      st.blastLeft = Math.max(0, st.blastLeft - h);
      s.charging = st.blastLeft;
      v.copy(st.blastDir).multiplyScalar(BLAST_SPEED);
      return true;
    }

    if (s.grounded || s.stomping) return false;

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

    const active = s.jetting || s.flying;
    const now = Math.hypot(v.x, v.z);
    const want = Math.hypot(wx, wz);
    const gaining = want > now && v.x * wx + v.z * wz >= 0;
    const rate = active ? (gaining ? 34 : 28) : (gaining ? 14 : 10);
    const step = rate * h;
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
