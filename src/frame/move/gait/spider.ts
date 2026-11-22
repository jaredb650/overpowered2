/** Spider Legs gait plug-in — Phase 0 baseline (Lane I replaces with 45° slope climbing, 2.2 m ledge climb, and leg sweep). */
import { FRAME } from '../../data';
import type { GaitPlugin } from './types';

export const SPIDER_GAIT: GaitPlugin = {
  kind: 'spider',
  stepHeight: FRAME.body.step,
  minWalkY: FRAME.body.minWalkY,
  legSweepOnStomp: true,
};
