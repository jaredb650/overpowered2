/** Sprinter Legs gait plug-in — Phase 0 baseline (Lane I refines gait feel & stride). */
import { FRAME } from '../../data';
import type { GaitPlugin } from './types';

export const SPRINTER_GAIT: GaitPlugin = {
  kind: 'sprinter',
  stepHeight: FRAME.body.step,
  minWalkY: FRAME.body.minWalkY,
};
