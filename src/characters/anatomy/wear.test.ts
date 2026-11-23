/** Wear you can see: the record a body keeps of how far through its skin each region is. */
import { describe, expect, it } from 'vitest';
import { HumanoidBone, humanoidRig } from '../rig';
import { EXTRA_TEXELS, EXTRA_WEAR, BONE_TEXTURE_SIZE, WEAR_VERTEX } from './glsl';
import { packWear, WEAR_REGIONS, WEAR_TEXELS, wearAmount, WearBook, wearKind, WearKind, wearKindOf } from './wear';

function book() {
  const data = new Float32Array(64);
  const seen: number[] = [];
  return { data, seen, worn: new WearBook(data, 8, most => seen.push(most)) };
}

describe('a region in one float', () => {
  it('keeps the amount and the kind apart', () => {
    for (const kind of [0, 1, 2, 3]) for (const amount of [0, 0.25, 0.5, 0.9]) {
      const v = packWear(amount, kind);
      expect(wearAmount(v)).toBeCloseTo(amount, 5);
      expect(wearKind(v)).toBe(kind);
    }
    // All the way spent stays under the next kind's number.
    expect(wearKind(packWear(1, 1))).toBe(1);
    expect(wearAmount(packWear(1, 1))).toBeGreaterThan(0.99);
  });

  it('wears by what the damage is', () => {
    expect(wearKindOf('bullet')).toBe(WearKind.tear);
    expect(wearKindOf('pellet')).toBe(WearKind.tear);
    expect(wearKindOf('melee')).toBe(WearKind.tear);
    expect(wearKindOf('slash')).toBe(WearKind.cut);
    expect(wearKindOf('explosive')).toBe(WearKind.strip);
    expect(wearKindOf('fire')).toBe(WearKind.burn);
  });
});

describe('a body\'s wear', () => {
  it('writes each region where the shader reads it, and says how worn the worst is', () => {
    const { data, seen, worn } = book();
    worn.set('armL', 0.4, WearKind.tear);
    worn.set('shinR', 0.7, WearKind.tear);
    expect(wearAmount(data[8 + WEAR_REGIONS.indexOf('armL')]!)).toBeCloseTo(0.4);
    expect(worn.amount('shinR')).toBeCloseTo(0.7);
    expect(worn.amount('legL')).toBe(0);
    expect(worn.most).toBeCloseTo(0.7);
    expect(seen).toEqual([0.4, 0.7].map(v => expect.closeTo(v, 5)));
  });

  it('never heals: a pool put back leaves the skin as torn as it was', () => {
    const { worn } = book();
    worn.set('legL', 0.6, WearKind.tear);
    worn.set('legL', 0.2, WearKind.tear);
    expect(worn.amount('legL')).toBeCloseTo(0.6);
    worn.set('legL', 3, WearKind.tear);
    expect(worn.amount('legL')).toBeGreaterThan(0.99);
    expect(worn.amount('legL')).toBeLessThan(1);
  });

  it('takes its look from whatever did most of the damage', () => {
    const { worn } = book();
    worn.set('armR', 0.2, WearKind.tear);
    expect(worn.kind('armR')).toBe(WearKind.tear);
    worn.set('armR', 0.7, WearKind.cut);
    expect(worn.kind('armR')).toBe(WearKind.cut);
    worn.set('armR', 0.8, WearKind.strip);
    expect(worn.kind('armR')).toBe(WearKind.cut);
  });

  it('goes with a limb that leaves the body, and is gone when the body is reused', () => {
    const a = book(), b = book();
    a.worn.set('forearmL', 0.8, WearKind.cut);
    b.data.set(a.data);
    b.worn.adopt(a.worn);
    expect(b.worn.amount('forearmL')).toBeCloseTo(0.8);
    expect(b.worn.most).toBeCloseTo(0.8);
    b.worn.set('forearmL', 0.9, WearKind.tear);
    expect(b.worn.kind('forearmL')).toBe(WearKind.cut);
    a.worn.clear();
    expect(a.worn.most).toBe(0);
    expect(a.worn.amount('forearmL')).toBe(0);
    expect(a.seen.at(-1)).toBe(0);
  });

  it('ignores a region it has no place for', () => {
    const { worn } = book();
    worn.set('tail' as never, 0.5, WearKind.tear);
    expect(worn.most).toBe(0);
  });
});

describe('where it lives', () => {
  it('fits every region in its texels, and the texels in the bone texture', () => {
    expect(WEAR_REGIONS).toHaveLength(11);
    expect(WEAR_REGIONS.length).toBeLessThanOrEqual(WEAR_TEXELS * 4);
    expect(EXTRA_TEXELS - EXTRA_WEAR).toBeGreaterThanOrEqual(WEAR_TEXELS);
    // 37 bones is the largest rig (model.ts): its matrices, the wounds and the wear have to fit.
    expect(37 * 4 + EXTRA_TEXELS).toBeLessThanOrEqual(BONE_TEXTURE_SIZE * BONE_TEXTURE_SIZE);
  });

  it('gives the shader each humanoid bone\'s region in the rig\'s own order', () => {
    const rig = humanoidRig('t');
    const table = /int\[\d+\]\(([^)]*)\)/.exec(WEAR_VERTEX)![1]!.split(',').map(Number);
    expect(table).toHaveLength(Object.keys(HumanoidBone).length);
    table.forEach((r, bone) => expect(WEAR_REGIONS[r], rig.bones[bone]!.name).toBe(rig.bones[bone]!.region));
  });
});
