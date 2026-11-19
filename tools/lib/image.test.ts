import { describe, expect, it } from 'vitest';
// @ts-expect-error standalone Node JavaScript tool
import { compare, crop, padBox, shrink, strip } from './image.mjs';

interface Image { width: number; height: number; data: Uint8Array }
const solid = (width: number, height: number, rgb: [number, number, number]): Image => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
  return { width, height, data };
};
const paint = (image: Image, x: number, y: number, w: number, h: number, rgb: [number, number, number]): Image => {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) image.data.set([...rgb, 255], (j * image.width + i) * 4);
  return image;
};

describe('picture difference maths (tools/diff.mjs)', () => {
  it('finds nothing between a picture and itself', () => {
    const a = solid(32, 20, [40, 60, 90]);
    const r = compare(a, solid(32, 20, [40, 60, 90]), { threshold: 0, aa: true });
    expect(r).toMatchObject({ changed: 0, exact: 0, total: 640, percent: 0, bbox: null });
    expect(r.diff.data.length).toBe(a.data.length);
  });
  it('counts a changed block, gives its percent and the box around it', () => {
    const a = solid(40, 30, [10, 10, 10]);
    const b = paint(solid(40, 30, [10, 10, 10]), 7, 5, 6, 4, [250, 250, 250]);
    const r = compare(a, b, { aa: true });
    expect(r.changed).toBe(24);
    expect(r.exact).toBe(24);
    expect(r.percent).toBe(2);
    expect(r.bbox).toEqual({ x: 7, y: 5, w: 6, h: 4 });
    // Changed pixels are red in the difference picture; the rest is grey.
    const at = (x: number, y: number) => [...r.diff.data.subarray((y * 40 + x) * 4, (y * 40 + x) * 4 + 3)];
    expect(at(8, 6)).toEqual([255, 0, 0]);
    expect(new Set(at(0, 0)).size).toBe(1);
  });
  it('spans two far-apart changes with one box, and the threshold hides a faint change that `exact` still counts', () => {
    const a = solid(50, 50, [100, 100, 100]);
    const b = paint(paint(solid(50, 50, [100, 100, 100]), 2, 3, 1, 1, [255, 0, 0]), 44, 40, 2, 2, [0, 255, 0]);
    expect(compare(a, b, { aa: true }).bbox).toEqual({ x: 2, y: 3, w: 44, h: 39 });
    const faint = paint(solid(50, 50, [100, 100, 100]), 10, 10, 5, 5, [101, 100, 100]);
    const r = compare(a, faint, { threshold: 0.1 });
    expect(r.changed).toBe(0);
    expect(r.exact).toBe(25);
    expect(r.bbox).toBeNull();
    expect(compare(a, faint, { threshold: 0, aa: true }).changed).toBe(25);
  });
  it('refuses two sizes with words that say what to do', () => {
    expect(() => compare(solid(10, 10, [0, 0, 0]), solid(12, 10, [0, 0, 0]))).toThrow(/not the same size: 10x10 against 12x10/);
  });
  it('pads a box inside the picture, crops, shrinks by averaging and lays panels side by side', () => {
    expect(padBox({ x: 2, y: 3, w: 4, h: 4 }, 5, 20, 10)).toEqual({ x: 0, y: 0, w: 11, h: 10 });
    const a = paint(solid(8, 4, [0, 0, 0]), 4, 0, 4, 4, [200, 100, 50]);
    const cut = crop(a, { x: 3, y: 1, w: 2, h: 2 });
    expect([...cut.data]).toEqual([0, 0, 0, 255, 200, 100, 50, 255, 0, 0, 0, 255, 200, 100, 50, 255]);
    // 8 wide to 2 wide: the left half is all black, the right half all colour; to 1 wide: their mean.
    const half = shrink(a, 2);
    expect([half.width, half.height]).toEqual([2, 1]);
    expect([...half.data]).toEqual([0, 0, 0, 255, 200, 100, 50, 255]);
    expect([...shrink(a, 1).data]).toEqual([100, 50, 25, 255]);
    expect(shrink(a, 99)).toBe(a);
    const row = strip([solid(2, 2, [1, 1, 1]), solid(3, 1, [9, 9, 9])], 1, [5, 5, 5, 255]);
    expect([row.width, row.height]).toEqual([6, 2]);
    const px = (x: number, y: number) => row.data[(y * 6 + x) * 4];
    expect([px(0, 0), px(1, 1), px(2, 0), px(3, 0), px(5, 0), px(3, 1)]).toEqual([1, 1, 5, 9, 9, 5]);
  });
});
