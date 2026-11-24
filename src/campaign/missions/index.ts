/** Every mission, by the id `?mission=` and a contract's `mission` field use. */
import type { Mission } from '../types';
import { BANK_RUN } from './bankRun';
import { CROSSFIRE_AIRBASE } from './crossfireAirbase';
import { CROSSFIRE_HALCYON } from './crossfireHalcyon';
import { CROSSFIRE_RETURN } from './crossfireReturn';
import { CROSSFIRE_STRAIT } from './crossfireStrait';
import { DESERT_RAID } from './desertRaid';
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
  bank_run: BANK_RUN,
  desert_raid: DESERT_RAID,
  crossfire_airbase: CROSSFIRE_AIRBASE,
  crossfire_strait: CROSSFIRE_STRAIT,
  crossfire_halcyon: CROSSFIRE_HALCYON,
  crossfire_return: CROSSFIRE_RETURN,
  retraining: RETRAINING,
};
