/** Standard reverse-jointed walker gait: exact default Frame parameters. */
import { FRAME } from '../../data';
import type { GaitPlugin } from './types';

export const WALKER_GAIT: GaitPlugin = {
  kind: 'walker',
  stepHeight: FRAME.body.step,
  minWalkY: FRAME.body.minWalkY,
};
