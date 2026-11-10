// Runs the weight probe under vitest, which gives the source the module environment it expects. Off unless PROBE names
// its sections, so a full test run never starts it. See ragweight.probe.ts.
import { it } from 'vitest';

it.skipIf(!process.env.PROBE)('ragweight probe', () => import('./ragweight.probe'), 1_800_000);
