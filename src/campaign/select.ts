/** Which mission this page runs, if any. Nothing here imports three.js, so code that runs before the systems exist can ask. */
import { ACTIVE } from '../contracts/select';

const query = typeof location === 'undefined' ? null : new URLSearchParams(location.search);

/** `?mission=<id>`, or the contract's own. Null is an endless contract, and then nothing in this folder runs. */
export const MISSION_ID: string | null = query?.get('mission') ?? ACTIVE.def.mission ?? null;

/** `?beat=<id>` starts there, with the kit that beat's checkpoint promises. */
export const START_BEAT: string | undefined = query?.get('beat') ?? undefined;
