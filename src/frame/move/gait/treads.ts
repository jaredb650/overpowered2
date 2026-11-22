/** Treads gait plug-in — Phase 0 baseline (Lane I replaces with tank-track steering, slope slowdown, and drive-over crush). */
import { FRAME } from '../../data';
import type { GaitPlugin } from './types';

export const TREADS_GAIT: GaitPlugin = {
  kind: 'treads',
  stepHeight: FRAME.body.step,
  minWalkY: FRAME.body.minWalkY,
  noSurge: true,
};
