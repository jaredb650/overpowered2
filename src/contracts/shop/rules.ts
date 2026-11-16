/**
 * The Crucible's shop as plain functions over a snapshot of the run (`ShopView`), as Outpost Defense's economy.ts is: what is
 * sold, at what price, and why a row cannot be had now. No three.js and no ctx. index.ts takes the snapshot and carries out.
 */
import type { ModId, WeaponId } from '../../core/gameplay';
import { IMPLANTS, IMPLANT_ORDER, SLOT_WARES, type ImplantId } from '../../progression/implants';
import { inPlay } from '../../weapons/families';
import { MODS, MOD_ORDER } from '../../weapons/mods';
import { MOD_WARES, WEAPON_WARES, WEAPON_WARE_ORDER, type Ware } from './data';

export type ShopAct =
  | { kind: 'weapon'; id: WeaponId } | { kind: 'mod'; id: ModId }
  /** An implant (progression/implants.ts), and an implant slot by its number, 2 or 3. */
  | { kind: 'implant'; id: ImplantId } | { kind: 'slot'; id: number };

export interface ShopView {
  credits: number;
  /** Between waves. Nothing is bought or fitted during one. */
  inBreak: boolean;
  /** The last wave cleared. */
  cleared: number;
  owned: ReadonlySet<WeaponId>;
  mods: ReadonlySet<ModId>;
  fitted: ReadonlySet<ModId>;
  /** Implants bought this run, fitted now, and the slots open. */
  implants: ReadonlySet<ImplantId>;
  implantsFitted: ReadonlySet<ImplantId>;
  slots: number;
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
  /** An implant: the one of its class fitted now, which Enter takes off to fit this one. */
  replaces?: ImplantId | null;
}

const between = (v: ShopView): string | null => (v.inBreak ? null : 'Between waves only');
const afford = (price: number, v: ShopView): string | null => (price > v.credits ? `Need ${price - v.credits} more` : null);
const lockOf = (w: Ware, v: ShopView): boolean => w.wave > v.cleared;
const lockLine = (w: Ware): string => `Released after wave ${w.wave}`;

/** Issued with every run, never sold: listed so the catalogue is the whole arsenal. */
export const issued = (w: Ware): boolean => w.price === 0;

/**
 * Every weapon a player can hold on this page, in the menu's order: the guns for sale and the issued ones. A weapon not in play
 * here (`?slot8=old`'s Piledriver, the melee four without `?melee=four`) is not listed.
 */
export const listedWeapons = (): WeaponId[] => WEAPON_WARE_ORDER.filter(inPlay);

export function weaponOffers(v: ShopView, wares = WEAPON_WARES): ShopOffer[] {
  return listedWeapons().map(id => {
    const ware = wares[id]!;
    const owned = v.owned.has(id);
    const locked = lockOf(ware, v);
    const why = owned ? (issued(ware) ? 'Issued' : 'Owned') : locked ? lockLine(ware) : between(v) ?? afford(ware.price, v);
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

/**
 * The two slots for sale, then every implant by class (docs/proposals/implants.md). A slot is bought in order. An implant bought is
 * fitted or taken off with the same row, free; one of a class already fitted takes that one's place; a new class needs a free slot.
 */
export function implantOffers(v: ShopView): ShopOffer[] {
  const slots: ShopOffer[] = [];
  for (let n = 2; n <= SLOT_WARES.length; n++) {
    const ware = SLOT_WARES[n - 1]!;
    const owned = v.slots >= n;
    const locked = !owned && lockOf(ware, v);
    const why = owned ? 'Open' : locked ? lockLine(ware) : v.slots < n - 1 ? `Open slot ${n - 1} first` : between(v) ?? afford(ware.price, v);
    slots.push({ act: { kind: 'slot', id: n }, ware, owned, fitted: false, locked, why });
  }
  const implants = IMPLANT_ORDER.map((id): ShopOffer => {
    const d = IMPLANTS[id];
    const ware: Ware = { price: d.price, wave: d.wave, lore: d.lore };
    const owned = v.implants.has(id);
    const fitted = v.implantsFitted.has(id);
    const locked = !owned && lockOf(ware, v);
    let replaces: ImplantId | null = null;
    for (const f of v.implantsFitted) if (f !== id && IMPLANTS[f].class === d.class) replaces = f;
    const full = !fitted && !replaces && v.implantsFitted.size >= v.slots;
    const why = locked ? lockLine(ware) : between(v) ?? (full ? 'No free slot' : owned ? null : afford(ware.price, v));
    return { act: { kind: 'implant', id }, ware, owned, fitted, locked, why, replaces };
  });
  return [...slots, ...implants];
}

/** The row for `act`, as the menu shows it. */
export function offerFor(act: ShopAct, v: ShopView): ShopOffer | undefined {
  const list = act.kind === 'weapon' ? weaponOffers(v) : act.kind === 'mod' ? modOffers(v) : implantOffers(v);
  return list.find(o => o.act.kind === act.kind && o.act.id === act.id);
}
