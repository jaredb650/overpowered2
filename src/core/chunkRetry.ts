import type { ErrorCode } from './errors';
import { report } from './report';
/**
 * Lazily loaded code chunks on a flaky host (a GitHub Pages 503 on assets/lance-*.js, once, then 200). `importRetry` tries
 * a boot-time import twice; if both fail the page reloads once (a guard in sessionStorage stops a loop); a second failure
 * inside the guard window throws ChunkError, which the boot path shows as CODE_CHUNK_FAILED. After boot (chunkBootDone) it
 * never reloads: that would throw the run away.
 */
export class ChunkError extends Error {
  constructor(readonly original: unknown) {
    super(`A code chunk could not be loaded: ${original instanceof Error ? original.message : String(original)}`);
    this.name = 'ChunkError';
  }
}

const KEY = 'op2_chunk_reload';
/** A second failure this soon after a reload is the same outage, so the page does not reload again. */
const GUARD_MS = 60_000;
const hooks: (() => void)[] = [];
let inFlight = 0;
let booted = false;

/** The page is up. A reload from here would throw the run away, so a failed import only fails (main.ts calls this). */
export const chunkBootDone = (): void => { booted = true; };

/** Runs just before the guarded reload: the co-op hand-off puts itself back in sessionStorage here (net/session.ts). */
export const onBeforeChunkReload = (hook: () => void): void => { hooks.push(hook); };

/** True once per guard window; blocked storage can't hold the guard, so it never allows a reload. */
export function takeReload(now = Date.now(), store: Pick<Storage, 'getItem' | 'setItem'> | null = sessionStorage): boolean {
  try {
    const last = Number(store?.getItem(KEY));
    if (!store || (last > 0 && now - last < GUARD_MS)) return false;
    store.setItem(KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/** Reload once (the promise never settles, so nothing downstream runs on a missing module), else fail with ChunkError. */
export function recoverChunk(error: unknown, reload: () => void = () => location.reload(), allow: () => boolean = () => !booted && takeReload()): Promise<never> {
  report('ASSET_FETCH_FAILED', { error, stage: 'chunk' });
  if (!allow()) return Promise.reject(new ChunkError(error));
  for (const hook of hooks) try { hook(); } catch { /* the reload still goes ahead */ }
  reload();
  return new Promise<never>(() => {});
}

export async function importRetry<T>(load: () => Promise<T>, pause: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
  recover: (error: unknown) => Promise<never> = recoverChunk): Promise<T> {
  inFlight++;
  try {
    try {
      return await load();
    } catch (first) {
      console.warn('[chunks] import failed, trying once more', first);
      await pause(800);
      return await load();
    }
  } catch (error) {
    return recover(error);
  } finally {
    inFlight--;
  }
}

/**
 * Vite's `vite:preloadError`, for an import() nothing wraps: reload once, or show the error screen. While importRetry has
 * an import in flight the event is its own to handle, so it is left alone and the import rejects into the retry.
 */
export function installChunkRecovery(fatal: (code: ErrorCode, error: unknown) => void, target: Pick<Window, 'addEventListener'> = window): void {
  target.addEventListener('vite:preloadError', event => {
    if (inFlight > 0 || booted) return;
    event.preventDefault();
    recoverChunk((event as Event & { payload?: unknown }).payload).catch(error => fatal('CODE_CHUNK_FAILED', error));
  });
}
