/**
 * Which pages load the dev panel, and what it starts with. The flags are read once per page, so each case loads the
 * modules fresh behind a stand-in location.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

async function page(search: string | null, devServer: boolean, stored: Record<string, unknown> = {}) {
  vi.resetModules();
  if (search !== null) vi.stubGlobal('location', { search, pathname: '/' });
  const store = new Map(Object.entries(stored).map(([k, v]) => [k, JSON.stringify(v)]));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
  vi.stubEnv('DEV', devServer);
  const flags = await import('./devflags');
  const lab = await import('../lab/settings');
  return { ...flags, settings: lab.loadSettings() };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('the dev panel', () => {
  it('is off under the tests, where there is no page', async () => {
    expect((await page(null, true)).DEV_TOOLS).toBe(false);
  });

  it('loads on every map and contract of the dev server', async () => {
    for (const search of ['', '?contract=crucible', '?contract=outpost', '?contract=campaign', '?map=killhouse', '?contract=crucible&map=killhouse', '?map=range']) {
      expect((await page(search, true)).DEV_TOOLS, search).toBe(true);
    }
  });

  it('goes with ?dev=0 on the dev server, except on the range, which is the panel', async () => {
    expect((await page('?dev=0', true)).DEV_TOOLS).toBe(false);
    expect((await page('?contract=campaign&dev=0', true)).DEV_TOOLS).toBe(false);
    expect((await page('?map=range&dev=0', true)).DEV_TOOLS).toBe(true);
  });

  it('keeps ?dev=1 in a production build', async () => {
    expect((await page('', false)).DEV_TOOLS).toBe(false);
    expect((await page('?contract=outpost', false)).DEV_TOOLS).toBe(false);
    expect((await page('?dev=1', false)).DEV_TOOLS).toBe(true);
    expect((await page('?contract=campaign&dev=1', false)).DEV_TOOLS).toBe(true);
    expect((await page('?map=range', false)).DEV_TOOLS).toBe(true);
  });

  it('starts every cheat off on a page that did not ask for it, whatever an old session left on', async () => {
    const cheats = { god: true, arsenal: true, overlay: true, speed: 0.25, progression: false, gibbing: false, force: 3, spawn: 'brute', ai: 'on', row: 9 };
    const asked = await page('?dev=1', true, { 'op2.lab.v1.game': cheats, 'op2.lab.v1.dev': cheats });
    expect(asked.DEV_ASKED).toBe(true);
    expect(asked.settings).toMatchObject(cheats);

    const plain = await page('', true, { 'op2.lab.v1.game': cheats, 'op2.lab.v1.dev': cheats });
    expect(plain.DEV_ASKED).toBe(false);
    expect(plain.settings).toMatchObject({ god: false, arsenal: false, overlay: false, speed: 1, progression: true, gibbing: true, force: 1 });
    // The spawn picks are only a convenience, so they are kept.
    expect(plain.settings).toMatchObject({ spawn: 'brute', ai: 'on', row: 9 });

    const range = await page('?map=range', true);
    expect(range.settings).toMatchObject({ god: true, arsenal: true, overlay: true, progression: false });
  });
});
