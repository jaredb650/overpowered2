import { describe, expect, it } from 'vitest';
import type { WeaponId } from '../../core/gameplay';
import { survivalLoadout } from '../loadouts';
import { weaponWares } from './data';

describe('Kill House weapon locks', () => {
  it('releases every Endless Humans weapon before wave 10, preserving prices and progression order', () => {
    const humans = weaponWares('outpost');
    // Defense uses the same catalogue without Kill House's compression or the Crucible's different starting primary.
    const original = weaponWares('defense');
    const starting = new Set(survivalLoadout('outpost'));
    expect(Object.keys(humans)).toEqual(Object.keys(original));
    for (const id of Object.keys(humans) as WeaponId[]) {
      const ware = humans[id]!;
      expect(ware.wave, id).toBeGreaterThanOrEqual(0);
      expect(ware.wave, id).toBeLessThanOrEqual(9);
      expect(Number.isInteger(ware.wave), id).toBe(true);
      if (starting.has(id)) expect(ware, id).toEqual({ ...original[id]!, price: 0, wave: 0 });
      else if (original[id]!.price > 0) {
        expect(ware, id).toEqual({ ...original[id]!, wave: Math.min(9, Math.ceil(original[id]!.wave / 2)) });
      }
    }
    const sold = (Object.keys(humans) as WeaponId[]).filter(id => !starting.has(id) && original[id]!.price > 0)
      .sort((a, b) => original[a]!.wave - original[b]!.wave);
    const locks = sold.map(id => humans[id]!.wave);
    expect(locks).toEqual([...locks].sort((a, b) => a - b));
    expect(humans.lance!.wave).toBe(9);
    // The SMG is issued in Defense but sold in Endless Humans, whose starting primary is the Harrow.
    expect(humans.smg).toMatchObject({ price: 350, wave: 1 });
  });

  it('keeps the Crucible weapon locks unchanged, including after resolving Endless Humans', () => {
    const before = weaponWares('crucible');
    weaponWares('outpost');
    const after = weaponWares('crucible');
    expect(after).toEqual(before);
    // Existing catalogue locks: new rows are covered by the all-rows test above without maintaining a weapon list.
    const locks = {
      knife: 1, gimlet: 1, rivet: 2, judge: 2, baton: 3, autocannon: 4, crowbar: 5,
      deuce: 6, shovel: 7, buzzsaw: 8, kiln: 10, stakegun: 12, autoraffica: 12,
      ultramag: 4, piledriver: 16, lance: 18, smg: 1, harrow: 2, shotgun: 1,
      thresher: 3, rocket: 4, quiver: 8, awl: 2, sabot: 6, sword: 0,
    };
    const starting = new Set(survivalLoadout('crucible'));
    for (const [id, wave] of Object.entries(locks)) {
      expect(after[id as WeaponId]!.wave, id).toBe(starting.has(id as WeaponId) ? 0 : wave);
    }
  });
});
