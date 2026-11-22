/** Every mission, by the id `?mission=` and a contract's `mission` field use. */
import type { Mission } from '../types';
import { FORECLOSURE } from './foreclosure';
import { OUTPOST } from './outpost';
import { QUIET_TITLE } from './quietTitle';
import { RETRAINING } from './retraining';
import { STUB } from './stub';

export const MISSIONS: Readonly<Record<string, Mission>> = {
  stub: STUB,
  outpost: OUTPOST,
  foreclosure: FORECLOSURE,
  quiet_title: QUIET_TITLE,
  retraining: RETRAINING,
};
