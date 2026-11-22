/**
 * Overcharge Engine drive plug-in (`kind: 'overcharge'`).
 * - Fast ground dash build: 3 Shift charges, each refilling in 2.5 s, bursting at 26 m/s for 0.7 s.
 * - Weak hop: half standard jet fuel (`FRAME.jet.fuel * 0.5`).
 */
import * as THREE from 'three';
import { FRAME } from '../../data';
import type { WalkerIntent } from '../../controller';
import type { MoveState } from '../gait/types';
import type { DrivePlugin } from './types';

const CHARGE_SPEED = 26;
const CHARGE_SECONDS = 0.7;
const CHARGE_COUNT = 3;
const CHARGE_REFILL = 2.5;

const _wish = new THREE.Vector3();

export const OVERCHARGE_DRIVE: DrivePlugin = {
  kind: 'overcharge',
  hudLabel: 'OVERCHARGE',
  maxFuel: () => FRAME.jet.fuel * 0.5,
  maxCharges: () => CHARGE_COUNT,
  chargeRefill: () => CHARGE_REFILL,

  charge(s: MoveState, _h: number, intent: WalkerIntent): boolean {
    if (!intent.charge) return true;
    if (s.charges <= 0 || s.charging > 0 || s.stomping) return true;
    s.charges--;
    if (s.chargeIn <= 0) s.chargeIn = CHARGE_REFILL;
    s.charging = CHARGE_SECONDS;
    s.recover = 0;
    s.legYaw = s.viewYaw;
    s.wish(intent, _wish);
    if (_wish.lengthSq() > 0.01) {
      s.chargeDir.copy(_wish).normalize();
    } else {
      s.chargeDir.set(-Math.sin(s.viewYaw), 0, -Math.cos(s.viewYaw));
    }
    s.said.charged = true;
    return true;
  },

  airMove(s: MoveState, h: number): boolean {
    if (s.charging <= 0) return false;
    s.charging = Math.max(0, s.charging - h);
    const speed = s.charging > 0 ? CHARGE_SPEED : FRAME.walk.forward * s.speedScale;
    s.velocity.x = s.chargeDir.x * speed;
    s.velocity.z = s.chargeDir.z * speed;
    return true;
  },
};
