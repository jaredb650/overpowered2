import { describe, expect, it, vi } from 'vitest';
import { ChunkError, importRetry, recoverChunk, takeReload } from './chunkRetry';
import { classifyError } from './errors';

const store = (initial?: string) => {
  let value = initial ?? null;
  return { getItem: () => value, setItem: (_: string, v: string) => { value = v; } };
};
const noPause = () => Promise.resolve();

describe('the reload guard', () => {
  it('allows one reload a minute and refuses blocked storage', () => {
    const s = store();
    expect(takeReload(1000, s)).toBe(true);
    expect(takeReload(30_000, s)).toBe(false);
    expect(takeReload(62_000, s)).toBe(true);
    expect(takeReload(1000, { getItem: () => { throw new Error('blocked'); }, setItem: () => {} })).toBe(false);
  });
});

describe('importRetry', () => {
  it('retries once and returns the second answer', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce('chunk');
    await expect(importRetry(load, noPause)).resolves.toBe('chunk');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('hands a second failure to recovery, which reloads once and then gives the error screen', async () => {
    const reload = vi.fn();
    const s = store();
    const recover = (error: unknown) => recoverChunk(error, reload, () => takeReload(5000, s));
    const load = vi.fn().mockRejectedValue(new Error('Failed to fetch dynamically imported module: /assets/lance-1.js'));
    let settled = false;
    void importRetry(load, noPause, recover).then(() => { settled = true; }, () => { settled = true; });
    await new Promise(r => setTimeout(r, 10));
    expect(load).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false); // nothing runs on a missing module while the page reloads
    const failure = await importRetry(load, noPause, recover).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ChunkError);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(classifyError(failure)).toBe('CODE_CHUNK_FAILED');
  });
});
