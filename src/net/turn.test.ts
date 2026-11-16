import { describe, expect, it, vi } from 'vitest';
import { fetchTurn, parseIce } from './turn';

const cloudflare = { iceServers: [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
  { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' },
] };

describe('TURN credentials', () => {
  it("reads Cloudflare's answer and drops port 53, which hangs browsers", () => {
    expect(parseIce(cloudflare)).toEqual([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' },
    ]);
  });
  it('refuses junk, scripts and TURN without credentials', () => {
    expect(parseIce(null)).toEqual([]);
    expect(parseIce({ iceServers: [{ urls: 'javascript:alert(1)' }, { urls: 'turn:x:3478' }, 7] })).toEqual([]);
  });
  it('never hangs or throws: no URL, a failing Worker, a slow one', async () => {
    expect(await fetchTurn('')).toEqual([]);
    expect(await fetchTurn('https://w', vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toEqual([]);
    expect(await fetchTurn('https://w', vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch)).toEqual([]);
    vi.useFakeTimers();
    const slow = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))));
    const pending = fetchTurn('https://w', slow as unknown as typeof fetch);
    vi.advanceTimersByTime(5000);
    expect(await pending).toEqual([]);
    vi.useRealTimers();
  });
  it('uses the servers it was given', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify(cloudflare), { status: 201 }));
    expect((await fetchTurn('https://w', ok as unknown as typeof fetch)).length).toBe(2);
  });
});
