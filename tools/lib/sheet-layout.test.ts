import { describe, expect, it } from 'vitest';
// @ts-expect-error standalone Node JavaScript tool
import { label, layout, pick, sheetHtml } from './sheet-layout.mjs';
// @ts-expect-error standalone Node JavaScript tool
import { mulberry32 } from '../scripts/lib/steady.mjs';

describe('contact sheet layout (tools/sheet.mjs)', () => {
  it('lays 24 frames of a 16:10 page on 6 columns of 480 px tiles with a caption under each', () => {
    const g = layout({ count: 24, cols: 6, tile: 480, frameW: 1440, frameH: 900 });
    expect(g).toMatchObject({ cols: 6, rows: 4, tileW: 480, tileH: 300, width: 6 + 6 * 486, height: 30 + 4 * (300 + 24 + 6) });
    expect(g.cells).toHaveLength(24);
    expect(g.cells[0]).toEqual({ x: 6, y: 30, w: 480, h: 300 });
    expect(g.cells[7]).toEqual({ x: 6 + 486, y: 30 + 330, w: 480, h: 300 });
    // Nothing overlaps and everything is inside the sheet.
    for (const [i, c] of g.cells.entries()) {
      expect(c.x + c.w).toBeLessThanOrEqual(g.width);
      expect(c.y + c.h + g.caption).toBeLessThanOrEqual(g.height);
      for (const d of g.cells.slice(i + 1)) expect(c.x + c.w <= d.x || d.x + d.w <= c.x || c.y + c.h + g.caption <= d.y).toBe(true);
    }
  });
  it('handles a last row that is not full, fewer frames than columns, and a cropped shape', () => {
    expect(layout({ count: 7, cols: 6, frameW: 4, frameH: 3 })).toMatchObject({ cols: 6, rows: 2 });
    expect(layout({ count: 3, cols: 6, frameW: 4, frameH: 3 })).toMatchObject({ cols: 3, rows: 1, width: 6 + 3 * 486 });
    expect(layout({ count: 1, cols: 6, tile: 200, frameW: 100, frameH: 300 })).toMatchObject({ cols: 1, rows: 1, tileH: 600 });
  });
  it('picks evenly spaced frames, first and last included', () => {
    expect(pick(24, 0)).toHaveLength(24);
    expect(pick(5, 9)).toEqual([0, 1, 2, 3, 4]);
    expect(pick(90, 4)).toEqual([0, 30, 59, 89]);
    expect(pick(10, 1)).toEqual([0]);
    expect(pick(0, 4)).toEqual([]);
    const some = pick(100, 24);
    expect(some).toHaveLength(24);
    expect(new Set(some).size).toBe(24);
    expect([...some].sort((a, b) => a - b)).toEqual(some);
  });
  it('labels a tile with its number and time, and escapes what goes into the page', () => {
    expect(label(0, 0)).toBe('#01  +0 ms');
    expect(label(11, 703.6)).toBe('#12  +704 ms');
    const g = layout({ count: 2, cols: 6, frameW: 16, frameH: 9 });
    const html = sheetHtml({ grid: g, tiles: [{ src: 'f-0000.png', text: label(0, 0) }, { src: 'f-0001.png', text: label(1, 48) }], title: '/?a=1&b=<x>' });
    expect(html).toContain('/?a=1&amp;b=&lt;x&gt;');
    expect(html.match(/<img /g)).toHaveLength(2);
    expect(html).toContain('#02  +48 ms');
  });
});

describe('the seeded Math.random of the frozen-clock helper', () => {
  it('gives the same numbers for the same seed, different ones for another, all in [0, 1)', () => {
    const a = mulberry32(7), b = mulberry32(7), c = mulberry32(8);
    const run = (f: () => number) => Array.from({ length: 2000 }, f);
    const first = run(a);
    expect(run(b)).toEqual(first);
    expect(run(c)).not.toEqual(first);
    expect(first.every(n => n >= 0 && n < 1)).toBe(true);
    // Spread: not stuck, and the mean is near a half.
    expect(new Set(first).size).toBeGreaterThan(1990);
    expect(Math.abs(first.reduce((s, n) => s + n, 0) / first.length - 0.5)).toBeLessThan(0.03);
  });
});
