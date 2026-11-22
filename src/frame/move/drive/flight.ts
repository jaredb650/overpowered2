/** Jump-Jet Engine drive plug-in — Phase 0 baseline (Lane J replaces with true free flight & 32 m/s 3D jet blast). */
import { FRAME } from '../../data';
import type { DrivePlugin } from './types';

export const FLIGHT_DRIVE: DrivePlugin = {
  kind: 'flight',
  hudLabel: 'FLIGHT',
  maxFuel: s => FRAME.jet.fuel * s.fuelScale,
  maxCharges: () => FRAME.charge.count,
  chargeRefill: () => FRAME.charge.refill,
};
