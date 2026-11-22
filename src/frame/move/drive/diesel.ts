/** Long-Haul Engine drive plug-in — Phase 0 baseline (Lane J replaces with 12 s sustained 11 m/s trample run). */
import { FRAME } from '../../data';
import type { DrivePlugin } from './types';

export const DIESEL_DRIVE: DrivePlugin = {
  kind: 'diesel',
  hudLabel: 'LONG-HAUL',
  maxFuel: s => FRAME.jet.fuel * s.fuelScale,
  maxCharges: () => FRAME.charge.count,
  chargeRefill: () => 4,
};
