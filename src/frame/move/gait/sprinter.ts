/**
 * Sprinter Legs gait plug-in: light, snappy reverse-jointed stride with rapid acceleration,
 * crisp braking, elevated air control, and quick leg turning.
 * Pairs with `legsSprinter` stats in `loadout.ts` (walk ×1.30, jet launch ×1.6, stomp ×0.6, leg armour ×0.7).
 */
import * as THREE from 'three';
import { clamp, wrapAngle } from '../../../core/math';
import { FRAME } from '../../data';
import type { WalkerIntent } from '../../controller';
import type { GaitPlugin, MoveState } from './types';

const _wish = new THREE.Vector3();

const ACCEL_MULT = 1.55;
const DECEL_MULT = 1.35;
const AIR_CONTROL = 0.68;
const TURN_RATE_MULT = 1.35;
const TURN_WALK_MULT = 1.5;

export const SPRINTER_GAIT: GaitPlugin = {
  kind: 'sprinter',
  stepHeight: FRAME.body.step,
  minWalkY: FRAME.body.minWalkY,

  turn(s: MoveState, h: number, intent: WalkerIntent): boolean {
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
    const control = s.grounded || s.jetting ? 1 : AIR_CONTROL;
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
};
