/** Pile-Driver Legs gait plug-in — Phase 0 baseline (Lane I refines heavy gait feel). */
import { FRAME } from '../../data';
import type { GaitPlugin } from './types';

export const HEAVY_GAIT: GaitPlugin = {
  kind: 'heavy',
  stepHeight: FRAME.body.step,
  minWalkY: FRAME.body.minWalkY,
};
