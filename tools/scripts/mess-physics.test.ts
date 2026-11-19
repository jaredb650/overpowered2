// Runs the mess probe under vitest. Off unless MESS_PROBE is set, so a full test run never starts it. See mess-physics.probe.ts.
import { it } from 'vitest';

it.skipIf(!process.env.MESS_PROBE)('mess physics probe', () => import('./mess-physics.probe'), 1_800_000);
