/**
 * The Crucible's shop as plain functions over a snapshot of the run (`ShopView`), as Outpost Defense's economy.ts is: what is
 * sold, at what price, and why a row cannot be had now. No three.js and no ctx. index.ts takes the snapshot and carries out.
 */
import type { ModId, WeaponId } from '../../core/gameplay';
import { CACHE_ORDER } from '../../progression/data';
import { MODS, MOD_ORDER } from '../../weapons/mods';
import { MOD_WARES, WEAPON_WARES, WEAPON_WARE_ORDER, type Ware } from './data';

export type ShopAct = { kind: 'weapon'; id: WeaponId } | { kind: 'mod'; id: ModId };

export interface ShopView {
  credits: number;
  /** Between waves. Nothing is bought or fitted during one. */
  inBreak: boolean;
  /** The last wave cleared. */
  cleared: number;
  owned: ReadonlySet<WeaponId>;
  mods: ReadonlySet<ModId>;
  fitted: ReadonlySet<ModId>;
}

export interface ShopOffer {
  act: ShopAct;
  ware: Ware;
  /** Owned already: a weapon in hand, or a mod bought (then the row fits or takes it off). */
  owned: boolean;
  /** A mod, fitted now. */
  fitted: boolean;
  /** Shut until this wave has been cleared: the lock the menu shows. */
  locked: boolean;
  /** Why the row does nothing now, or null. */
  why: string | null;
}

const between = (v: ShopView): string | null => (v.inBreak ? null : 'Between waves only');
const afford = (price: number, v: ShopView): string | null => (price > v.credits ? `Need ${price - v.credits} more` : null);
const lockOf = (w: Ware, v: ShopView): boolean => w.wave > v.cleared;
const lockLine = (w: Ware): string => `Released after wave ${w.wave}`;

/** The guns the caches used to bring, in the menu's order. A gun no cache brings on this page (`?slot8=old`) is not sold. */
export const soldWeapons = (): WeaponId[] => WEAPON_WARE_ORDER.filter(id => CACHE_ORDER.includes(id));

export function weaponOffers(v: ShopView): ShopOffer[] {
  return soldWeapons().map(id => {
    const ware = WEAPON_WARES[id]!;
    const owned = v.owned.has(id);
    const locked = lockOf(ware, v);
    const why = owned ? 'Owned' : locked ? lockLine(ware) : between(v) ?? afford(ware.price, v);
    return { act: { kind: 'weapon', id }, ware, owned, fitted: false, locked, why };
  });
}

/** A mod bought is fitted or taken off with the same row, free. Either needs the gun, and a break. */
export function modOffers(v: ShopView): ShopOffer[] {
  return MOD_ORDER.map(id => {
    const ware = MOD_WARES[id];
    const owned = v.mods.has(id);
    const locked = !owned && lockOf(ware, v);
    const gun = v.owned.has(MODS[id].weapon);
    const why = !gun ? 'Needs its gun' : locked ? lockLine(ware) : between(v) ?? (owned ? null : afford(ware.price, v));
    return { act: { kind: 'mod', id }, ware, owned, fitted: v.fitted.has(id), locked, why };
  });
}

/** The row for `act`, as the menu shows it. */
export function offerFor(act: ShopAct, v: ShopView): ShopOffer | undefined {
  const list = act.kind === 'weapon' ? weaponOffers(v) : modOffers(v);
  return list.find(o => o.act.id === act.id);
}
