import { describe, expect, it } from 'vitest';
import { AssetError, fetchAsset } from './fetchAsset';

const answers = (...list: (number | Error)[]) => {
  const calls: string[] = [];
  const fetcher = (async (url: string) => {
    calls.push(url);
    const next = list.shift()!;
    if (next instanceof Error) throw next;
    return new Response(next === 200 ? 'ok' : 'no', { status: next });
  }) as typeof fetch;
  return { calls, fetcher };
};
const noPause = async () => {};
const text = (r: Response) => r.text();

describe('fetchAsset', () => {
  it('retries network errors, 5xx and 429, then succeeds', async () => {
    const { calls, fetcher } = answers(new TypeError('Failed to fetch'), 503, 200);
    expect(await fetchAsset('a.png', text, 3, fetcher, noPause)).toBe('ok');
    expect(calls).toHaveLength(3);
    expect(await fetchAsset('b.png', text, 3, answers(429, 200).fetcher, noPause)).toBe('ok');
  });

  it('gives up after the last try as a network failure', async () => {
    const error = await fetchAsset('a.png', text, 3, answers(502, 502, 502, 200).fetcher, noPause).catch(e => e);
    expect(error).toBeInstanceOf(AssetError);
    expect(error.network).toBe(true);
  });

  it('a 404 fails at once and is not a network failure', async () => {
    const { calls, fetcher } = answers(404, 200);
    const error = await fetchAsset('gone.png', text, 3, fetcher, noPause).catch(e => e);
    expect(calls).toHaveLength(1);
    expect(error.network).toBe(false);
    expect(error.message).toMatch(/Missing gone.png \(HTTP 404\)/);
  });

  it('a body that breaks off is retried', async () => {
    let reads = 0;
    const read = async (r: Response) => { if (++reads === 1) throw new TypeError('network error'); return r.text(); };
    expect(await fetchAsset('a.bin', read, 3, answers(200, 200).fetcher, noPause)).toBe('ok');
  });
});
