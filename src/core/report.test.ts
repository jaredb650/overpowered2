import { describe, expect, it, vi } from 'vitest';
import { createReporter, environment, scrub } from './report';

function setup(url = 'https://example.com', max = 150) {
  const map = new Map<string, string>();
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
  const send = vi.fn((_body: string) => true); let now = 100000;
  const reporter = createReporter({ url, max, storage, send, now: () => now, session: 'session-test' });
  return { reporter, send, map, storage, advance: () => { now += 61000; } };
}
describe('anonymous reporter', () => {
  it('batches, dedupes for a minute and enforces a session cap', () => {
    const { reporter: r, send, advance } = setup(undefined, 7);
    r.report('COOP_ATTEMPT'); r.report('COOP_ATTEMPT');
    expect(send).not.toHaveBeenCalled(); expect(r.events()).toHaveLength(1);
    advance(); r.report('COOP_ATTEMPT');
    for (let i = 0; i < 10; i++) r.report('COOP_STAGE', { stage: `${i}` });
    expect(r.events()).toHaveLength(7);
    r.flush(); expect(JSON.parse(send.mock.calls[0]![0]!).events).toHaveLength(5);
    r.flush(); expect(JSON.parse(send.mock.calls[1]![0]!).events).toHaveLength(2);
    r.flush(); expect(send).toHaveBeenCalledTimes(2);
  });
  it('does nothing with no endpoint, even with inaccessible storage', () => {
    const { reporter: r, send, map } = setup('');
    r.report('UNCAUGHT_EXCEPTION'); r.flush();
    expect(send).not.toHaveBeenCalled(); expect(map.size).toBe(0);
    expect(() => createReporter({ url: '', storage: { getItem() { throw Error(); }, setItem() { throw Error(); }, removeItem() { throw Error(); } } }).report('BOOT_OK')).not.toThrow();
  });
  it('keeps 50 local events, clears history and queue on opt-out, persists the preference', () => {
    const { reporter: r, send, map, storage } = setup();
    for (let i = 0; i < 60; i++) r.report('COOP_STAGE', { stage: `${i}` });
    expect(r.events()).toHaveLength(50); expect(JSON.parse(map.get('op2.reports.history')!)).toHaveLength(50);
    expect(createReporter({ url: 'x', storage }).events()).toHaveLength(50);
    r.setEnabled(false); r.flush(); r.report('BOOT_OK');
    expect(createReporter({ url: 'x', storage }).enabled()).toBe(false);
    expect(send).not.toHaveBeenCalled(); expect(r.events()).toHaveLength(0); expect(map.get('op2.reports.disabled')).toBe('1');
  });
  it('swallows failed transports and strips addresses, secrets and exception headers', async () => {
    const r = createReporter({ url: 'x', send: () => { throw Error(); } });
    expect(() => { r.report('BOOT_OK'); r.flush(); }).not.toThrow();
    const rejected = createReporter({ url: 'x', send: () => Promise.reject(Error()) }); rejected.report('BOOT_OK'); rejected.flush();
    await Promise.resolve();
    expect(scrub('https://x.test/?join=ABC234 192.168.1.1 2001:db8::1 password=secret ABC234')).not.toMatch(/secret|ABC234|192\.168|2001:db8|join=/);
    expect(scrub('at frame (https://game.test/assets/Game.js:123:45?join=ABC234)')).toBe('at frame (assets/Game.js:123:45)');
    expect(environment('Mozilla Macintosh AppleWebKit Safari/605')).toMatchObject({ browser: 'Safari', os: 'macOS' });
  });
});
