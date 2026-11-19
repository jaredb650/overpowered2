/** Which mission this page runs, if any. Nothing here imports three.js, so code that runs before the systems exist can ask. */
import { ACTIVE } from '../contracts/select';

const query = typeof location === 'undefined' ? null : new URLSearchParams(location.search);

/** `?mission=<id>`, or the contract's own on its own map. Null is an endless contract, and then nothing in this folder runs. */
export const MISSION_ID: string | null = query?.get('mission') ?? (ACTIVE.ranked ? ACTIVE.def.mission ?? null : null);

/** A dev server's proofs start a co-op mission from a section this way: the lobby builds the match page's address, so `?beat=` cannot ride on it. */
function devBeat(): string | null {
  if (typeof sessionStorage === 'undefined' || !import.meta.env.DEV) return null;
  try { return sessionStorage.getItem('op2.dev.beat'); } catch { return null; }
}

/** `?beat=<id>` starts there, with the kit that beat's checkpoint promises. */
export const START_BEAT: string | undefined = query?.get('beat') ?? devBeat() ?? undefined;
