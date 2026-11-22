/** Rotor Engine drive plug-in — Phase 0 baseline (Lane J replaces with 14 m infinite helicopter hover & air strafe). */
import { FRAME } from '../../data';
import type { DrivePlugin } from './types';

export const HOVER_DRIVE: DrivePlugin = {
  kind: 'hover',
  hudLabel: 'ROTOR',
  maxFuel: s => FRAME.jet.fuel * s.fuelScale,
  maxCharges: () => 0,
  chargeRefill: () => FRAME.charge.refill,
};
