/** The shops' order (order.ts): ready, then short of credits, then the rest; by name inside; a gun's mods together. */
import { describe, expect, it } from 'vitest';
import { chipOffers, implantOffers, modOffers, supplyOffers, weaponOffers, type ShopOffer, type ShopView } from '../../contracts/shop/rules';
import { STARTING_WEAPONS } from '../../weapons/data';
import { MODS } from '../../weapons/mods';
import { WEAPONS as INFO } from '../data';
import { byStanding, offerKey, offerName, orderOffers, standing } from './order';

const view = (over: Partial<ShopView> = {}): ShopView => ({
  credits: 2_000, inBreak: true, cleared: 4, owned: new Set(STARTING_WEAPONS), mods: new Set(), fitted: new Set(),
  implants: new Set(['bloodthirst']), implantsFitted: new Set(['bloodthirst']), slots: 1,
  chips: new Set(['sonar']), chipsFitted: ['sonar'], chipSlots: 1, ...over,
});

const groups = (list: readonly ShopOffer[]): number[] => list.map(o => standing(o.why));
const sortedBy = (names: readonly string[]): boolean => names.every((n, i) => i === 0 || names[i - 1]!.localeCompare(n, 'en', { sensitivity: 'base', numeric: true }) <= 0);

describe('the shops\' order', () => {
  it('reads a row\'s group from why it cannot be had', () => {
    expect(standing(null)).toBe(0);
    expect(standing('Need 300 more')).toBe(1);
    expect(standing('Released after wave 6')).toBe(2);
    expect(standing('Needs its gun')).toBe(2);
    expect(standing('Need 1 more')).toBe(1);
    expect(standing('Owned')).toBe(2);
  });

  it('puts every page in three groups, never out of order, for any purse and wave', () => {
    for (const credits of [0, 900, 4_000, 100_000]) {
      for (const cleared of [0, 3, 9, 20]) {
        const v = view({ credits, cleared });
        for (const page of [[...supplyOffers(v), ...weaponOffers(v)], modOffers(v), [...implantOffers(v), ...chipOffers(v)]]) {
          const g = groups(orderOffers(page));
          expect(g).toEqual([...g].sort((a, b) => a - b));
          expect(orderOffers(page)).toHaveLength(page.length);
        }
      }
    }
  });

  it('sorts each group by name, kinds kept together', () => {
    const v = view({ credits: 3_000, cleared: 6 });
    const list = orderOffers([...supplyOffers(v), ...weaponOffers(v)]);
    for (const g of [0, 1, 2]) {
      const rows = list.filter(o => standing(o.why) === g);
      const supply = rows.filter(o => o.act.kind === 'supply');
      const guns = rows.filter(o => o.act.kind === 'weapon');
      // Resupply first in its group, then the guns.
      expect(rows).toEqual([...supply, ...guns]);
      expect(sortedBy(guns.map(offerName))).toBe(true);
    }
  });

  it('keeps one gun\'s mods side by side in each group, guns by name, then mods by name', () => {
    const v = view({ credits: 2_500, cleared: 9, owned: new Set([...STARTING_WEAPONS, 'flail', 'harrow', 'sabot']) });
    const list = orderOffers(modOffers(v));
    for (const g of [0, 1, 2]) {
      const rows = list.filter(o => standing(o.why) === g);
      const keys = rows.map(offerKey);
      expect(sortedBy(keys.map(k => k.group))).toBe(true);
      for (const gun of new Set(keys.map(k => k.group))) {
        const mine = rows.filter(o => offerKey(o).group === gun);
        const first = rows.indexOf(mine[0]!);
        // Contiguous: nothing else between the first and the last of one gun's mods.
        expect(rows.slice(first, first + mine.length)).toEqual(mine);
        expect(sortedBy(mine.map(offerName))).toBe(true);
      }
    }
    // A mod for a gun not owned is in the bottom group.
    const orphan = list.find(o => o.act.kind === 'mod' && !v.owned.has(MODS[o.act.id].weapon))!;
    expect(standing(orphan.why)).toBe(2);
    expect(offerKey(orphan).group).toBe(INFO[MODS[orphan.act.kind === 'mod' ? orphan.act.id : 'reddot'].weapon].name);
  });

  it('puts what can be bought first, what costs too much next, and locked or owned rows last', () => {
    const v = view({ credits: 1_000, cleared: 6 });
    const list = orderOffers(weaponOffers(v));
    const first = list[0]!;
    const last = list[list.length - 1]!;
    expect(first.why).toBeNull();
    expect(first.ware.price).toBeLessThanOrEqual(1_000);
    expect(last.locked || last.owned).toBe(true);
    const short = list.filter(o => o.why?.startsWith('Need'));
    expect(short.length).toBeGreaterThan(0);
    for (const o of short) expect(o.ware.price).toBeGreaterThan(1_000);
  });

  it('breaks ties by the order rows came in', () => {
    const rows = ['b', 'a', 'a2', 'a'].map((name, i) => ({ name, i }));
    expect(byStanding(rows, r => ({ standing: 0, kind: 0, group: '', name: r.name })).map(r => r.i)).toEqual([1, 3, 2, 0]);
  });
});
