import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

async function make() {
  vi.stubGlobal('location', { search: '?drs=1' });
  vi.stubGlobal('navigator', { webdriver: true });
  const { DynamicResolution } = await import('./DynamicResolution');
  return new DynamicResolution();
}
const run = (d: { update(dt: number): boolean }, seconds: number, ms: number): number => {
  let steps = 0;
  for (let t = 0; t < seconds; t += ms / 1000) if (d.update(ms / 1000)) steps++;
  return steps;
};

describe('dynamic resolution says when resolution was not the cause', () => {
  it('holds full size and is not starved at 60', async () => {
    const d = await make();
    expect(run(d, 30, 16.7)).toBe(0);
    expect(d.scale).toBe(1);
    expect(d.starved).toBe(false);
  });

  it('a frame that stays slow at every size: it goes back to full size and says it is starved, for half a minute', async () => {
    const d = await make();
    run(d, 8, 22);
    expect(d.scale).toBe(1);
    expect(d.starved).toBe(true);
    run(d, 20, 22);
    expect(d.starved).toBe(true);
    // It tries again after its rest (30 s): on the way down it is not starved, it is trying.
    let tried = false;
    for (let t = 0; t < 8 && !tried; t += 0.022) {
      d.update(0.022);
      tried = !d.starved && d.scale < 1;
    }
    expect(tried).toBe(true);
    // And finds the same, so a processor-bound page is starved nearly all the time.
    run(d, 6, 22);
    expect(d.starved).toBe(true);
    expect(d.scale).toBe(1);
  });
});
