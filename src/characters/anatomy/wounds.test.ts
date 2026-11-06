import { describe, expect, it } from 'vitest';
import { MAX_WOUNDS, newWoundSpec, WoundBook, WoundKind, WoundRegion, WOUND_TEXELS, type WoundSpec } from './wounds';

function book() {
  const data = new Float32Array(MAX_WOUNDS * WOUND_TEXELS * 4);
  let told = 0;
  return { data, book: new WoundBook(data, 0, c => { told = c; }), told: () => told };
}

const at = (x: number, y: number, z: number, o: Partial<WoundSpec> = {}): WoundSpec => {
  const w = newWoundSpec();
  w.ax = w.bx = x;
  w.ay = w.by = y;
  w.az = w.bz = z;
  return Object.assign(w, o);
};

describe('WoundBook', () => {
  it('keeps wounds that are apart', () => {
    const { book: b, told } = book();
    b.add(at(0, 0, 0));
    b.add(at(0.3, 0, 0));
    expect(b.count).toBe(2);
    expect(b.open).toBe(2);
    expect(told()).toBe(2);
  });

  it('turns repeated hits on one spot into a growing crater', () => {
    const { book: b } = book();
    for (let i = 0; i < 20; i++) b.add(at(0.001 * i, 0, 0, { radius: 0.0125, limit: 0.2 }));
    expect(b.count).toBe(1);
    expect(b.kind(0)).toBe(WoundKind.crater);
    expect(b.radius(0)).toBeGreaterThan(0.045);
    expect(b.depth(0)).toBeGreaterThan(0.05);
  });

  it('never grows past the limit of the part it is on', () => {
    const { book: b } = book();
    for (let i = 0; i < 40; i++) b.add(at(0, 0, 0, { radius: 0.04, limit: 0.09 }));
    expect(b.radius(0)).toBeLessThan(0.0901);
  });

  it('does not merge the two sides of a limb', () => {
    const { book: b } = book();
    b.add(at(0, 0, 0.03, { nz: -1, radius: 0.03 }));
    b.add(at(0, 0, -0.03, { nz: 1, radius: 0.03 }));
    expect(b.count).toBe(2);
  });

  it('does not merge across body parts that only touch in the bind pose', () => {
    const { book: b } = book();
    b.add(at(0, 0, 0, { regions: WoundRegion.trunk }));
    b.add(at(0.01, 0, 0, { regions: WoundRegion.armL }));
    expect(b.count).toBe(2);
  });

  it('leaves a gash its own wound, and does not let paint open a body', () => {
    const { book: b } = book();
    b.add(at(0, 0, 0, { kind: WoundKind.gash, bx: 0.1, by: 0, bz: 0 }));
    b.add(at(0.01, 0, 0));
    b.add(at(0.2, 0, 0, { kind: WoundKind.graze }));
    b.add(at(0.4, 0, 0, { kind: WoundKind.burn }));
    expect(b.count).toBe(4);
    expect(b.open).toBe(2);
  });

  it('makes room when full by merging, so a new wound always lands', () => {
    const { book: b, data } = book();
    for (let i = 0; i < MAX_WOUNDS; i++) b.add(at(i * 0.2, 0, 0, { radius: 0.01 }));
    expect(b.count).toBe(MAX_WOUNDS);
    b.add(at(50, 0, 0, { radius: 0.02 }));
    expect(b.count).toBe(MAX_WOUNDS);
    const last = (MAX_WOUNDS - 1) * WOUND_TEXELS * 4;
    expect(data[last]).toBe(50);
  });

  it('gives up paint before it gives up a hole', () => {
    const { book: b } = book();
    b.add(at(0, 0, 0, { kind: WoundKind.graze, radius: 0.01 }));
    for (let i = 1; i < MAX_WOUNDS; i++) b.add(at(i * 0.2, 0, 0, { radius: 0.01 }));
    b.add(at(50, 0, 0));
    let paint = 0;
    for (let i = 0; i < b.count; i++) if (b.kind(i) === WoundKind.graze) paint++;
    expect(paint).toBe(0);
    expect(b.open).toBe(MAX_WOUNDS);
  });

  it('copies into a limb with room to go on merging', () => {
    const a = book();
    const b = book();
    a.book.add(at(0, 0, 0, { radius: 0.03, limit: 0.1 }));
    b.data.set(a.data);
    b.book.adopt(a.book);
    b.book.add(at(0, 0, 0, { radius: 0.03, limit: 0.1 }));
    expect(b.book.count).toBe(1);
    expect(b.book.radius(0)).toBeGreaterThan(0.03);
  });
});
