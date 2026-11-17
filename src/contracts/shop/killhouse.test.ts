import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('Endless Humans ends at its final wave', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('opens every shop row by the last break before the final wave, and the Crucible keeps its locks', async () => {
    vi.resetModules(); // the static imports above already loaded the shop for the default contract
    vi.stubGlobal('location', { search: '?contract=outpost' });
    const { FINAL_WAVE } = await import('../../enemies/commander/adaptations');
    const { weaponWares, modWares, SUPPLY_WARES } = await import('./data');
    const { chipOffers, implantOffers, modOffers, supplyOffers, weaponOffers } = await import('./rules');
    const { MOD_ORDER } = await import('../../weapons/mods');
    // Wave FINAL_WAVE - 1 cleared: the last break there is. Nothing may stay shut or wait for a wave past it.
    const last = FINAL_WAVE - 1;
    const view = {
      credits: 1e9, inBreak: true, cleared: last, owned: new Set<WeaponId>(), mods: new Set(), fitted: new Set(),
      implants: new Set(), implantsFitted: new Set(), slots: 1, chips: new Set(), chipsFitted: [], chipSlots: 1,
    } as Parameters<typeof modOffers>[0];
    const rows = [
      ...weaponOffers(view), ...modOffers(view), ...implantOffers(view), ...chipOffers(view), ...supplyOffers(view),
    ];
    expect(rows.length).toBeGreaterThan(MOD_ORDER.length);
    for (const o of rows) {
      expect(o.locked, `${o.act.kind} ${o.act.id}`).toBe(false);
      expect(o.ware.wave, `${o.act.kind} ${o.act.id}`).toBeLessThanOrEqual(last);
    }
    for (const ware of [...Object.values(weaponWares('outpost')), ...Object.values(modWares('outpost')), ...Object.values(SUPPLY_WARES)]) {
      expect(ware!.wave).toBeLessThanOrEqual(last);
    }
    // The late rows are spread over the breaks, not all dumped into the last one.
    const lastBreak = rows.filter(o => o.ware.wave === last).length;
    expect(lastBreak).toBeLessThan(rows.length / 4);
    // The Crucible has no end, so its mods keep the catalogue's locks.
    expect(Math.max(...Object.values(modWares('crucible')).map(w => w.wave))).toBeGreaterThanOrEqual(FINAL_WAVE);
  });
});
