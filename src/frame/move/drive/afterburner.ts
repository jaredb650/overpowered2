/** Afterburner drive plug-in — Phase 0 baseline (Lane J replaces with 48 m/s airborne jet mode & dive-bomb stomp). */
import { FRAME } from '../../data';
import type { DrivePlugin } from './types';

export const AFTERBURNER_DRIVE: DrivePlugin = {
  kind: 'afterburner',
  hudLabel: 'AFTERBURNER',
  maxFuel: s => FRAME.jet.fuel * s.fuelScale,
  maxCharges: () => FRAME.charge.count,
  chargeRefill: () => FRAME.charge.refill,
};
