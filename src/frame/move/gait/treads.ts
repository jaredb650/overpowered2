/**
 * Treads gait plug-in: heavy tracked tank chassis.
 *
 *   - Smooth continuous rolling (`noSurge: true`, paired with `noSway: true` in `loadout.ts`).
 *   - Flat-ground top speed ×1.25 (`groundNormalY >= 0.96`); slows to ×0.6 up slopes and over rubble
 *     (`groundNormalY < 0.96`). Because `legsTreads.legs.walk` already sets the ×1.25 flat multiplier
 *     on `s.speedScale`, slopes scale wish speed by `0.6 / 1.25` (0.48) so flat = ×1.25 and slope = ×0.6.
 *   - Tracked hull turns slowly (×0.5 standard turn rate) while the upper torso/turret aims freely.
 *   - Cannot stomp (`startStomp` returns `true`); instead crushes enemies driven over via `treadCrush` (`seat.ts`).
 *   - Cannot hop with standard jets (`legsTreads.legs.jump = 0` sets `jumpScale = 0` in `controller.ts`).
 */
import * as THREE from 'three';
import { wrapAngle } from '../../../core/math';
import { FRAME } from '../../data';
import type { WalkerIntent } from '../../controller';
import type { GaitPlugin, MoveState } from './types';

const _wish = new THREE.Vector3();

/** Surface normal Y threshold separating flat ground from slopes / rubble (~16.3°). */
export const TREADS_FLAT_NORMAL_Y = 0.96;
/** Loadout flat top-speed multiplier (`legsTreads.legs.walk`) and slope top-speed multiplier. */
export const TREADS_FLAT_MULT = 1.25;
export const TREADS_SLOPE_MULT = 0.6;
const SLOPE_SCALE = TREADS_SLOPE_MULT / TREADS_FLAT_MULT;
const HULL_TURN_SCALE = 0.5;
const AIR_CONTROL = 0.2;

export const TREADS_GAIT: GaitPlugin = {
  kind: 'treads',
  stepHeight: FRAME.body.step,
  minWalkY: FRAME.body.minWalkY,
  noSurge: true,

  turn(s: MoveState, h: number, intent: WalkerIntent): boolean {
    const T = FRAME.turn;
    const off = wrapAngle(intent.viewYaw - s.legYaw);
    // Cap at ×0.5 standard turn rate without double-halving when `s.turnScale` is already 0.5 from loadout.
    const scale = Math.min(s.turnScale, HULL_TURN_SCALE);
    const moving = s.grounded && (intent.moveX !== 0 || intent.moveZ !== 0);
    const over = Math.abs(off) - T.arc;
    const rate = s.free || over > 0
      ? Math.min(Math.abs(off), T.rate * scale * h)
      : moving ? Math.min(Math.abs(off), T.walking * scale * h) : 0;
    s.legYaw = wrapAngle(s.legYaw + Math.sign(off) * rate);
    // Torso / turret aims freely regardless of tracked hull heading.
    s.viewYaw = intent.viewYaw;
    return true;
  },

  walk(s: MoveState, h: number, intent: WalkerIntent, groundNormalY: number): boolean {
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
    const flat = groundNormalY >= TREADS_FLAT_NORMAL_Y;
    if (s.recover > 0) {
      _wish.set(0, 0, 0);
    } else {
      s.wish(intent, _wish);
      if (!flat) _wish.multiplyScalar(SLOPE_SCALE);
    }
    const control = s.grounded || s.jetting ? 1 : AIR_CONTROL;
    const now = Math.hypot(v.x, v.z);
    const want = Math.hypot(_wish.x, _wish.z);
    const gaining = want > now && v.x * _wish.x + v.z * _wish.z >= 0;
    const accel = W.accel * (flat ? 0.95 : 0.7);
    const decel = W.decel * 1.15;
    const step = (gaining ? accel : decel) * control * h;
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

  startStomp(): boolean {
    // Tank treads cannot stomp; enemies driven over are crushed via `treadCrush` in `seat.ts`.
    return true;
  },
};
