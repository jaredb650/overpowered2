/**
 * Mag-Skiff Hover Hull gait plug-in (`kind: 'hover'`).
 * - Frictionless omnidirectional strafing hover-skirt: full speed in every WASD direction (forward, back, strafe).
 * - Smooth high-thrust acceleration (`ACCEL = 52`) paired with light drift momentum (`DECEL = 16`).
 * - Zero stride surge (`noSurge: true`) and elevated step clearance over stairs/rubble.
 * - Crouch / stomp triggers a 360° 10 m downward repulsor crush pulse (`repulsorPulseOnStomp: true`).
 */
import * as THREE from 'three';
import { wrapAngle } from '../../../core/math';
import { FRAME } from '../../data';
import type { WalkerIntent } from '../../controller';
import type { GaitPlugin, MoveState } from './types';

const _wish = new THREE.Vector3();

const HOVER_ACCEL = 52;
const HOVER_DECEL = 16;
const HOVER_AIR_CONTROL = 0.8;
const HOVER_TURN_RATE = 1.25;
const HOVER_STEP_HEIGHT = 1.45;

export const HOVER_GAIT: GaitPlugin = {
  kind: 'hover',
  stepHeight: HOVER_STEP_HEIGHT,
  minWalkY: FRAME.body.minWalkY,
  noSurge: true,
  repulsorPulseOnStomp: true,

  turn(s: MoveState, h: number, intent: WalkerIntent): boolean {
    const T = FRAME.turn;
    const off = wrapAngle(intent.viewYaw - s.legYaw);
    // Upper chassis aims freely while the hover-skirt glides smoothly underneath toward aim/travel heading.
    s.legYaw = wrapAngle(s.legYaw + off * (1 - Math.exp(-T.free * HOVER_TURN_RATE * s.turnScale * h)));
    s.viewYaw = intent.viewYaw;
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

    let hasInput = false;
    if (s.recover > 0) {
      _wish.set(0, 0, 0);
    } else {
      let mx = intent.moveX;
      let mz = intent.moveZ;
      const len = Math.hypot(mx, mz);
      if (len > 1e-3) {
        hasInput = true;
        if (len > 1) {
          mx /= len;
          mz /= len;
        }
        const sy = Math.sin(s.viewYaw);
        const cy = Math.cos(s.viewYaw);
        // Full-speed omnidirectional repulsor thrust: strafing and backpedaling match forward speed.
        const maxSpeed = W.forward * s.speedScale;
        const ahead = mz * maxSpeed;
        const side = mx * maxSpeed * Math.max(1, s.strafeScale / 1.3);
        _wish.set(-sy * ahead + cy * side, 0, -cy * ahead - sy * side);
      } else {
        _wish.set(0, 0, 0);
      }
    }

    const control = s.grounded || s.jetting ? 1 : HOVER_AIR_CONTROL;
    const dx = _wish.x - v.x;
    const dz = _wish.z - v.z;
    const d = Math.hypot(dx, dz);

    // Responsive omnidirectional thrust when steering; light frictionless drift when coasting or carving turns.
    const aligned = hasInput && v.x * _wish.x + v.z * _wish.z >= 0;
    const rate = hasInput ? (aligned ? HOVER_ACCEL : (HOVER_ACCEL + HOVER_DECEL) * 0.5) : HOVER_DECEL;
    const step = rate * control * h;

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
    // Handled via `repulsorPulseOnStomp: true` in `Walker.tick`.
    return true;
  },
};
