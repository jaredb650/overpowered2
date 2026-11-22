/** Overcharge Engine drive plug-in — Phase 0 baseline (Lane J replaces with 3 fast 26 m/s charges & short hop). */
import { FRAME } from '../../data';
import type { DrivePlugin } from './types';

export const OVERCHARGE_DRIVE: DrivePlugin = {
  kind: 'overcharge',
  hudLabel: 'OVERCHARGE',
  maxFuel: s => FRAME.jet.fuel * s.fuelScale,
  maxCharges: () => 3,
  chargeRefill: () => 2.5,
};
