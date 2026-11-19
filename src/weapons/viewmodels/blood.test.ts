/** Blood on the weapon and the hands: what throws it, how a coat keeps it, and the field its drops come from. */
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../core/math';
import { BLOOD_LAYERS, BloodCoat, clearByte, closeness, coverage, killBlood, makeSpatter, reachByte, sleeveByte, VmBloodTuning as T } from './blood';

const rows = () => Array.from({ length: BLOOD_LAYERS }, () => {
  const v = { x: 0, y: 0, z: 0, w: 0, set(x: number, y: number, z: number, w: number) { v.x = x; v.y = y; v.z = z; v.w = w; } };
  return v;
});

describe('what a kill throws', () => {
  it('is nothing for fire, shock and a vaporized body, and everything for a gib', () => {
    expect(killBlood('fire', false, false, false, false)).toBe(0);
    expect(killBlood('shock', false, true, false, false)).toBe(0);
    expect(killBlood('bullet', true, false, false, true)).toBe(0);
    expect(killBlood('explosive', true, false, false, false)).toBe(1);
  });

  it('is more for a shotgun than a bullet, and more again for a head', () => {
    const bullet = killBlood('bullet', false, false, false, false);
    expect(killBlood('pellet', false, false, false, false)).toBeGreaterThan(bullet);
    expect(killBlood('bullet', false, true, false, false)).toBeGreaterThan(bullet);
    expect(killBlood('slash', false, false, true, false)).toBeGreaterThan(killBlood('pellet', false, false, false, false));
  });

  it('reaches the gun only from a few metres', () => {
    expect(closeness(0.5)).toBe(1);
    expect(closeness(T.near)).toBe(1);
    expect(closeness(T.reach)).toBe(0);
    expect(closeness(20)).toBe(0);
    let last = 1;
    for (let d = T.near; d <= T.reach; d += 0.25) {
      expect(closeness(d)).toBeLessThanOrEqual(last);
      last = closeness(d);
    }
  });
});

describe('a coat of blood', () => {
  const rng = mulberry32(7);

  it('starts clean, and a first spatter is one wet layer', () => {
    const c = new BloodCoat();
    expect(c.most(0)).toBe(0);
    c.add(0, 0, -1, 0.6, 10, 0.3, rng);
    expect(c.most(10)).toBeCloseTo(0.6);
    expect(c.wet(0, 10)).toBe(1);
  });

  it('takes blood that comes in the same burst as one spatter from between the two directions', () => {
    const c = new BloodCoat();
    c.add(1, 0, 0, 0.5, 10, 0.3, rng);
    c.add(0, 0, -1, 0.5, 10.4, 0.3, rng);
    expect([...c.amount].filter(a => a > 0)).toHaveLength(1);
    expect(c.amount[0]).toBeCloseTo(0.75);
    expect(c.dir[0]).toBeCloseTo(Math.SQRT1_2);
    expect(c.dir[2]).toBeCloseTo(-Math.SQRT1_2);
    // Still as wet as when the first of it landed.
    expect(c.born[0]).toBe(10);
  });

  it('keeps later blood as its own layer, so fresh lies over dry', () => {
    const c = new BloodCoat();
    c.add(1, 0, 0, 0.5, 10, 0.3, rng);
    c.add(0, 0, -1, 0.4, 80, 0.3, rng);
    expect([...c.amount].filter(a => a > 0)).toHaveLength(2);
    const a = rows(), b = rows();
    c.write(80, a, b);
    // Oldest first: the empty slot, the dry layer, then the wet one on top.
    expect(b[2]!.x).toBeCloseTo(0.4);
    expect(b[2]!.y).toBe(1);
    expect(b[1]!.x).toBeCloseTo(0.5);
    expect(b[1]!.y).toBeLessThan(0.05);
  });

  it('always lands a new spatter: when all three are in use the two oldest become one', () => {
    const c = new BloodCoat();
    for (let k = 0; k < 6; k++) c.add(0, 0, -1, 0.7, 10 + k * 20, 0.3, rng);
    const now = 10 + 5 * 20;
    expect([...c.amount].filter(a => a > 0)).toHaveLength(3);
    const a = rows(), b = rows();
    expect(c.write(now, a, b)).toBeLessThanOrEqual(1);
    expect(b[2]!.x).toBeCloseTo(0.7);
    expect(b[2]!.y).toBe(1);
    expect(b[0]!.x).toBeLessThanOrEqual(T.foldCap + 1e-6);
  });

  it('dries over a minute and wears off after a few more', () => {
    const c = new BloodCoat();
    c.add(0, 0, -1, 0.8, 0, 0.3, rng);
    expect(c.wet(0, T.dryFrom)).toBe(1);
    expect(c.wet(0, (T.dryFrom + T.dryTo) / 2)).toBeCloseTo(0.5);
    expect(c.wet(0, T.dryTo)).toBe(0);
    expect(c.shown(0, T.hold)).toBeCloseTo(0.8);
    expect(c.shown(0, T.hold + T.wear)).toBe(0);
    expect(c.most(T.hold + T.wear + 1)).toBe(0);
  });

  it('remembers a blade went through the body, and a clear takes everything off', () => {
    const c = new BloodCoat();
    c.add(0, 0, -1, 0.8, 5, 0.45, rng, 1);
    const a = rows(), b = rows();
    c.write(5, a, b);
    expect(b[2]!.w).toBe(1);
    expect(b[2]!.z).toBeCloseTo(0.45);
    c.clear();
    expect(c.most(5)).toBe(0);
  });
});

describe('the field of drops', () => {
  const field = makeSpatter();

  it('is the same every time', () => {
    expect(makeSpatter(32)).toEqual(makeSpatter(32));
  });

  it('shows more blood for a larger amount, and never fills in to a coat of paint', () => {
    let last = 0;
    for (const amount of [0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
      const c = coverage(field, amount);
      expect(c, `at ${amount}`).toBeGreaterThan(last);
      last = c;
    }
    expect(coverage(field, 0)).toBe(0);
    expect(coverage(field, 0.5)).toBeGreaterThan(0.03);
    expect(coverage(field, 0.5)).toBeLessThan(0.15);
    expect(coverage(field, 1)).toBeLessThan(0.45);
  });
});

describe('where on the weapon', () => {
  it('counts from the butt to the muzzle, and never writes the zero that means no blood here', () => {
    expect(reachByte(0.3, 0.3, -0.7)).toBe(1);
    expect(reachByte(-0.7, 0.3, -0.7)).toBe(255);
    expect(reachByte(5, 0.3, -0.7)).toBe(1);
    expect(reachByte(-0.2, 0.3, -0.7)).toBe(128);
  });

  it('covers the whole glove and thins out up the sleeve', () => {
    expect(sleeveByte(-0.1, 0.27)).toBe(255);
    expect(sleeveByte(0, 0.27)).toBe(255);
    expect(sleeveByte(0.15, 0.27)).toBeLessThan(sleeveByte(0.05, 0.27));
    expect(sleeveByte(0.6, 0.27)).toBeGreaterThan(0);
  });

  it('keeps a sight clean', () => {
    expect(clearByte(0)).toBe(0);
    expect(clearByte(T.sightClear)).toBe(0);
    expect(clearByte(T.sightClear + T.sightFade)).toBe(255);
    expect(clearByte(0.5)).toBe(255);
  });
});
