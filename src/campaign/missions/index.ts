/** Every mission, by the id `?mission=` and a contract's `mission` field use. */
import type { Mission } from '../types';
import { STUB } from './stub';

export const MISSIONS: Readonly<Record<string, Mission>> = {
  stub: STUB,
};
