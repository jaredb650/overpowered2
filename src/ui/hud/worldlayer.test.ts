/** Co-op: friends' name tags that would be printed over each other are stacked (worldlayer.ts `stackTags`). */
import { describe, expect, it } from 'vitest';
import { TAG_ROW, stackTags, tagHalfWidth } from './worldlayer';

const REM = 16, ROW = TAG_ROW * REM;
const rows = (tags: [x: number, y: number, chars: number][]): number[] => {
  const row: number[] = [];
  stackTags(tags.length, tags.map(t => t[0]), tags.map(t => t[1]), tags.map(t => tagHalfWidth(t[2]) * REM), ROW, row);
  return row;
};
/** No two tags' text boxes touch once each is on its line. */
const clear = (tags: [number, number, number][], row: number[]): boolean => tags.every((a, i) => tags.every((b, j) => j <= i
  || Math.abs(a[0] - b[0]) >= (tagHalfWidth(a[2]) + tagHalfWidth(b[2])) * REM
  || Math.abs(a[1] + row[i]! * ROW - (b[1] + row[j]! * ROW)) >= ROW - 1e-6));

describe('friends\' name tags', () => {
  it('stay where they are when they are apart, side by side or one well above the other', () => {
    expect(rows([[-200, 0, 8], [200, 0, 11]])).toEqual([0, 0]);
    expect(rows([[0, 0, 8], [10, 80, 11]])).toEqual([0, 0]);
    expect(rows([[0, 0, 8]])).toEqual([0]);
    expect(rows([])).toEqual([]);
  });

  it('two friends in the same direction read as two lines: the second goes under the first', () => {
    // The case in the picture: "HOST-ONE 38m" printed over "GUEST-THREE".
    const tags: [number, number, number][] = [[0, 0, 8], [6, 3, 11]];
    const row = rows(tags);
    expect(row).toEqual([0, 1]);
    expect(clear(tags, row)).toBe(true);
    // The other way up on screen, the second still clears the first by a whole line.
    expect(clear([[0, 0, 8], [6, -9, 11]], rows([[0, 0, 8], [6, -9, 11]]))).toBe(true);
  });

  it('three on one spot (all pinned to the same point of the ring) are three lines', () => {
    const tags: [number, number, number][] = [[300, -120, 8], [300, -120, 9], [300, -120, 11]];
    const row = rows(tags);
    expect(row).toEqual([0, 1, 2]);
    expect(clear(tags, row)).toBe(true);
  });

  it('a tag moved down a line does not land on a third tag that was already there', () => {
    const tags: [number, number, number][] = [[0, 0, 8], [0, ROW, 8], [4, 2, 8]];
    const row = rows(tags);
    expect(row[0]).toBe(0); expect(row[1]).toBe(0);
    expect(clear(tags, row)).toBe(true);
  });

  it('a long tag ("NAME DOWN 12s") is wider than a short one', () => {
    expect(tagHalfWidth(20)).toBeGreaterThan(tagHalfWidth(8) * 1.5);
    // Two short tags 9 rem apart are clear; a short one and a downed one at the same distance are not.
    expect(rows([[0, 0, 5], [9 * REM, 0, 5]])).toEqual([0, 0]);
    expect(rows([[0, 0, 5], [9 * REM, 0, 24]])).toEqual([0, 1]);
  });
});
