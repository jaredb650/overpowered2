/**
 * Afterburner drive plug-in (`kind: 'afterburner'`).
 * - Normal walk (×1.0) and normal hop on Space (cannot hover).
 * - Fighter-jet mode: holding Shift while airborne (or jumping + holding Shift) locks arms forward and flies at 48 m/s
 *   with turn rate capped at 70°/s, climbing/diving with `intent.viewPitch`, on a 7.0 s fuel tank.
 * - Pressing crouch/stomp from jet mode executes a ×1.5 dive-bomb stomp.
 * - Releasing Shift or running out of fuel exits jet mode smoothly into a controlled hover-fall.
 */
import * as THREE from 'three';
import { clamp, wrapAngle } from '../../../core/math';
import { FRAME } from '../../data';
import type { WalkerIntent } from '../../controller';
import type { MoveState } from '../gait/types';
import type { DrivePlugin } from './types';

const MAX_FUEL = 7.0;
const JET_SPEED = 48;
const MAX_TURN_RATE = (70 * Math.PI) / 180;
const MAX_PITCH_RATE = (95 * Math.PI) / 180;
const REFILL_GROUND_TIME = 3.5;
const REFILL_GROUND_DELAY = 0.25;
const REFILL_AIR_TIME = 5.0;
const REFILL_AIR_DELAY = 0.6;
const HOVER_FALL_SECONDS = 1.6;
const DIVE_STOMP_MULT = 1.5;

const _wish = new THREE.Vector3();

interface AfterburnerState {
  headingYaw: number;
  headingPitch: number;
  sinceJet: number;
  hoverFall: number;
  diveBomb: boolean;
  prevJetKey: boolean;
}

let states = new WeakMap<MoveState, AfterburnerState>();

function stateOf(s: MoveState): AfterburnerState {
  let st = states.get(s);
  if (!st) {
    st = {
      headingYaw: s.viewYaw,
      headingPitch: 0,
      sinceJet: REFILL_AIR_DELAY,
      hoverFall: 0,
      diveBomb: false,
      prevJetKey: false,
    };
    states.set(s, st);
  }
  return st;
}

function enterJetMode(s: MoveState, st: AfterburnerState, intent: WalkerIntent): void {
  st.headingYaw = s.viewYaw;
  const rawPitch = clamp(intent.viewPitch ?? 0, -0.95, 0.7);
  // Give a brief positive climb angle when igniting right off the deck so ground rays do not re-snap on tick 0.
  st.headingPitch = s.clearance() < 1.5 && rawPitch >= -0.05 ? Math.max(rawPitch, 0.25) : rawPitch;
  st.sinceJet = 0;
  st.hoverFall = 0;
  st.diveBomb = false;
  s.jetMode = true;
  s.armsLockedForward = true;
  s.flying = true;
  s.jetting = true;
  s.charging = 0;
  s.boost = 0;
  s.said.charged = true;
}

function exitJetMode(s: MoveState, st: AfterburnerState, hoverFall: boolean): void {
  s.jetMode = false;
  s.armsLockedForward = false;
  s.flying = false;
  s.jetting = false;
  st.hoverFall = hoverFall && !s.grounded && !s.stomping ? HOVER_FALL_SECONDS : 0;
}

export const AFTERBURNER_DRIVE: DrivePlugin = {
  kind: 'afterburner',
  hudLabel: 'AFTERBURNER',
  maxFuel: () => MAX_FUEL,
  maxCharges: () => 0,
  chargeRefill: () => 0,

  reset(): void {
    states = new WeakMap<MoveState, AfterburnerState>();
  },

  charge(s: MoveState, h: number, intent: WalkerIntent): boolean {
    const st = stateOf(s);
    s.charges = 0;
    s.charging = 0;

    // Keep ×1.5 dive-bomb multiplier active across every tick until landing resolves the stomp.
    if (st.diveBomb) {
      if (s.stomping) {
        s.said.stompMult = DIVE_STOMP_MULT;
      } else {
        st.diveBomb = false;
      }
    }

    // Dive-bomb stomp directly out of jet mode (runs before Walker's standard startStomp).
    if (s.jetMode && intent.stomp) {
      const clear = s.clearance();
      if (clear >= FRAME.stomp.minHeight) {
        exitJetMode(s, st, false);
        st.diveBomb = true;
        s.stomping = true;
        // Elevate stompTop so a jet dive-bomb always registers at least a full big-stomp drop.
        s.stompTop = Math.max(s.feet.y, s.feet.y - clear + Math.max(clear, FRAME.stomp.big));
        s.velocity.x *= 0.25;
        s.velocity.z *= 0.25;
        s.velocity.y = -FRAME.stomp.speed * 1.25;
        s.said.stompMult = DIVE_STOMP_MULT;
        return true;
      }
    }

    const shiftDown = Boolean(intent.chargeHeld || intent.charge);

    if (s.jetMode) {
      if (!shiftDown || s.fuel <= 0 || s.grounded || s.stomping) {
        exitJetMode(s, st, !s.grounded && !s.stomping);
      } else {
        s.fuel = Math.max(0, s.fuel - h);
        st.sinceJet = 0;
        if (s.fuel <= 0) {
          exitJetMode(s, st, true);
        }
      }
    } else if (shiftDown && !s.grounded && s.fuel > 0 && !s.stomping && s.recover <= 0) {
      enterJetMode(s, st, intent);
    }

    return true;
  },

  jets(s: MoveState, h: number, intent: WalkerIntent): boolean {
    const st = stateOf(s);
    const J = FRAME.jet;
    const v = s.velocity;

    if (s.jetMode) {
      s.flying = true;
      s.jetting = true;
      st.prevJetKey = intent.jet;
      return true;
    }

    // Normal hop on Space (cannot hover!).
    const hopScale = s.jumpScale > 0 ? s.jumpScale : 0.85;
    const launch = intent.jet && !st.prevJetKey && s.grounded && s.recover <= 0 && !s.stomping;
    if (launch) {
      v.y = J.launch * hopScale;
      s.boost = J.boostSeconds;
      s.grounded = false;
      s.said.lifted = true;
      s.wish(intent, _wish);
      const want = Math.hypot(_wish.x, _wish.z);
      if (want > 0.1) {
        const k = Math.min(J.kick, Math.max(0, FRAME.walk.forward - (v.x * _wish.x + v.z * _wish.z) / want)) / want;
        v.x += _wish.x * k;
        v.z += _wish.z * k;
      }
      // Jumping + holding Shift enters jet mode immediately off the hop.
      if ((intent.chargeHeld || intent.charge) && s.fuel > 0) {
        enterJetMode(s, st, intent);
        st.prevJetKey = intent.jet;
        return true;
      }
    }

    // Refill 7 s jet fuel on ground or after releasing jet mode.
    if (s.grounded) {
      s.onGround += h;
      st.sinceJet += h;
      st.hoverFall = 0;
      if (s.onGround > REFILL_GROUND_DELAY) {
        s.fuel = Math.min(MAX_FUEL, s.fuel + (MAX_FUEL / REFILL_GROUND_TIME) * h);
      }
    } else {
      s.onGround = 0;
      st.sinceJet += h;
      if (st.sinceJet >= REFILL_AIR_DELAY && !(intent.chargeHeld || intent.charge)) {
        s.fuel = Math.min(MAX_FUEL, s.fuel + (MAX_FUEL / REFILL_AIR_TIME) * h);
      }
    }

    if (s.stomping) {
      s.boost = 0;
      st.hoverFall = 0;
      v.y = st.diveBomb ? -FRAME.stomp.speed * 1.25 : -FRAME.stomp.speed;
      s.jetting = false;
      s.flying = false;
    } else if (intent.jet && !s.grounded && s.boost > 0) {
      // Complete the standard hop arc ONLY — never hover once boost finishes.
      s.boost = Math.max(0, s.boost - h);
      v.y += J.boost * h;
      s.jetting = true;
      s.flying = false;
    } else {
      s.boost = 0;
      s.jetting = false;
      s.flying = false;
      if (!s.grounded) {
        if (st.hoverFall > 0) {
          st.hoverFall = Math.max(0, st.hoverFall - h);
          v.y += (-6.5 - v.y) * (1 - Math.exp(-5 * h));
        } else {
          v.y -= FRAME.gravity * h;
        }
      }
    }

    st.prevJetKey = intent.jet;
    return true;
  },

  airMove(s: MoveState, h: number, intent: WalkerIntent): boolean {
    const st = stateOf(s);
    const v = s.velocity;

    if (s.jetMode) {
      // Smooth fighter-jet steering capped strictly at 70°/s.
      const yawDiff = wrapAngle(intent.viewYaw - st.headingYaw);
      const yawStep = Math.sign(yawDiff) * Math.min(Math.abs(yawDiff), MAX_TURN_RATE * h);
      st.headingYaw = wrapAngle(st.headingYaw + yawStep);
      s.legYaw = st.headingYaw;
      s.viewYaw = st.headingYaw;

      const targetPitch = clamp(intent.viewPitch ?? 0, -0.95, 0.7);
      const pitchDiff = targetPitch - st.headingPitch;
      st.headingPitch += Math.sign(pitchDiff) * Math.min(Math.abs(pitchDiff), MAX_PITCH_RATE * h);

      const cp = Math.cos(st.headingPitch);
      const sp = Math.sin(st.headingPitch);
      v.set(
        -Math.sin(st.headingYaw) * cp * JET_SPEED,
        sp * JET_SPEED,
        -Math.cos(st.headingYaw) * cp * JET_SPEED,
      );
      return true;
    }

    // Controlled hover-fall transition after leaving jet mode: smoothly bleed horizontal speed from 48 m/s.
    if (!s.grounded && !s.stomping && st.hoverFall > 0) {
      const damp = Math.exp(-3.8 * h);
      v.x *= damp;
      v.z *= damp;
      s.wish(intent, _wish);
      v.x += _wish.x * 2.2 * h;
      v.z += _wish.z * 2.2 * h;
      return true;
    }

    return false;
  },
};
