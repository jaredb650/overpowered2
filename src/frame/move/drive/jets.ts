/** Standard Jump-Jets engine drive: exact default Frame parameters. */
import { FRAME } from '../../data';
import type { DrivePlugin } from './types';

export const JETS_DRIVE: DrivePlugin = {
  kind: 'jets',
  maxFuel: s => FRAME.jet.fuel * s.fuelScale,
  maxCharges: () => FRAME.charge.count,
  chargeRefill: () => FRAME.charge.refill,
};
