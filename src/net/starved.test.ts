/** A guest whose world has stopped being fed says so on its own screen (starved.ts), and not for any other silence. */
import { describe, expect, it } from 'vitest';
import { FRAME_MOST_MS, STARVED_MS, Starved } from './starved';

/** Frames at 60 a second from `from` for `ms`, the host's data arriving every `every` ms until `fedUntil`. Returns each frame's answer. */
function run(s: Starved, from: number, ms: number, fedUntil: number, every = 50, fedAt = 0): { out: boolean[]; fedAt: number } {
  const out: boolean[] = [];
  for (let t = from; t < from + ms; t += 1000 / 60) {
    if (t <= fedUntil && t - fedAt >= every) fedAt = t;
    out.push(s.update(t, fedAt));
  }
  return { out, fedAt };
}

describe('a guest whose world has stopped being fed', () => {
  it('is not starved while the host\'s data keeps arriving, however the frames fall', () => {
    const s = new Starved();
    expect(run(s, 1000, 10_000, Infinity).out.some(Boolean)).toBe(false);
    // The slowest healthy feed there is: a roster twice a second with every other one lost.
    expect(run(new Starved(), 1000, 10_000, Infinity, 900).out.some(Boolean)).toBe(false);
  });

  it('says so a second after the data stops, and stops saying so on the first packet back', () => {
    const s = new Starved();
    const fed = run(s, 1000, 3000, Infinity);
    // The host cuts this guest at 4 s: nothing more arrives for 13 s.
    const cut = run(s, 4000, 13_000, 0, 50, fed.fedAt);
    const first = cut.out.indexOf(true);
    expect(first * (1000 / 60)).toBeGreaterThan(STARVED_MS - 80);
    expect(first * (1000 / 60)).toBeLessThan(STARVED_MS + 80);
    expect(cut.out.slice(first).every(Boolean)).toBe(true);
    // The catch-up lands.
    expect(s.update(17_000, 17_000)).toBe(false);
    expect(run(s, 17_016, 2000, Infinity, 50, 17_000).out.some(Boolean)).toBe(false);
  });

  it('a page that stood still itself was not starved: a long frame counts for a tenth of a second', () => {
    const s = new Starved();
    const fed = run(s, 1000, 2000, Infinity);
    // The tab was hidden for a minute; it wakes with nothing new read yet.
    expect(s.update(63_000, fed.fedAt)).toBe(false);
    // And a hidden tab's one frame a second gets fresh data between frames.
    let at = fed.fedAt;
    for (let t = 64_000; t < 80_000; t += 1000) { at = t - 20; expect(s.update(t, at)).toBe(false); }
    // Truly starved in a hidden tab, it still gets there: ten frames of nothing.
    let said = false;
    for (let i = 0; i < Math.ceil(STARVED_MS / FRAME_MOST_MS) + 1; i++) said = s.update(80_000 + i * 1000, at);
    expect(said).toBe(true);
  });

  it('nothing has stopped before the first packet ever arrives, and a reset starts the count again', () => {
    const s = new Starved();
    expect(run(s, 1000, 5000, 0, 50, 0).out.some(Boolean)).toBe(false);
    const fed = run(s, 6000, 500, Infinity);
    const dry = run(s, 6500, 900, 0, 50, fed.fedAt);
    expect(dry.out.some(Boolean)).toBe(false);
    s.reset();
    expect(run(s, 7400, 900, 0, 50, fed.fedAt).out.some(Boolean)).toBe(false);
    expect(run(s, 8300, 200, 0, 50, fed.fedAt).out.some(Boolean)).toBe(true);
  });
});
