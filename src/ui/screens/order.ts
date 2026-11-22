/**
 * The order the shops list their rows in (owner, 2026-11-22). Three groups, top to bottom:
 *
 *   0  ready   Enter does something now: buy it (and the credits are there), or fit or take off one already bought.
 *   1  short   It could be bought now but the credits are not there yet ("Need 300 more").
 *   2  shut    Everything else, greyed at the bottom: locked to a later wave, a mod for a gun not owned, owned already,
 *              no free slot, full.
 *
 * Inside a group the rows keep their kind together (resupply before guns, implant slots before implants, the brain chip slot
 * before the brain chips), then sort by name; a mod sorts by its gun's name first, so one gun's mods sit side by side.
 * Pure: no DOM, tested in order.test.ts.
 */
import type { ShopOffer } from '../../contracts/shop/rules';
import { SUPPLY_WARES } from '../../contracts/shop/data';
import { CHIPS } from '../../contracts/chips';
import { implantLabel } from '../../progression/data';
import type { ImplantId } from '../../progression/implants';
import { MODS } from '../../weapons/mods';
import { WEAPONS as INFO } from '../data';

export type Standing = 0 | 1 | 2;

/** Why-not text that means only the credits are missing: rules.ts `afford`, Outpost Defense's the same ("Need 300 more"). */
const SHORT = /^Need \d/;

/** A row's group, from why it cannot be had now (null: it can). "Needs its gun" is not short of credits. */
export const standing = (why: string | null): Standing => (why === null ? 0 : SHORT.test(why) ? 1 : 2);

export interface RowKey {
  standing: Standing;
  /** Rows of one kind stay together inside a group, in this order. */
  kind: number;
  /** Then by this (a mod's gun), then by name. */
  group: string;
  name: string;
}

const cmp = (a: string, b: string): number => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });

/** `rows` sorted by group, kind, group name, name; ties keep the order they came in. */
export function byStanding<T>(rows: readonly T[], key: (row: T) => RowKey): T[] {
  const keyed = rows.map((row, i) => ({ row, k: key(row), i }));
  keyed.sort((a, b) => a.k.standing - b.k.standing || a.k.kind - b.k.kind || cmp(a.k.group, b.k.group) || cmp(a.k.name, b.k.name) || a.i - b.i);
  return keyed.map(x => x.row);
}

/** "BERSERK!" to "Berserk", "CHAIN STORM" to "Chain Storm". */
export const implantName = (id: ImplantId): string =>
  implantLabel(id).replace(/!$/, '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

/** The name a Procurement row shows for what it sells. */
export function offerName(o: ShopOffer): string {
  const a = o.act;
  switch (a.kind) {
    case 'supply': return SUPPLY_WARES[a.id].name;
    case 'weapon': return INFO[a.id].name;
    case 'mod': return MODS[a.id].name;
    case 'implant': return implantName(a.id);
    case 'slot': return `Implant slot ${a.id}`;
    case 'chip': return `${CHIPS[a.id].name} brain chip`;
    case 'chipSlot': return 'Brain chip slot 2';
  }
}

const KIND: Readonly<Record<ShopOffer['act']['kind'], number>> = { supply: 0, weapon: 1, mod: 1, slot: 0, implant: 1, chipSlot: 2, chip: 3 };

/** Procurement's key for one row. */
export function offerKey(o: ShopOffer): RowKey {
  const group = o.act.kind === 'mod' ? INFO[MODS[o.act.id].weapon].name : '';
  return { standing: standing(o.why), kind: KIND[o.act.kind], group, name: offerName(o) };
}

/** A page of Procurement in the shops' order. */
export const orderOffers = (offers: readonly ShopOffer[]): ShopOffer[] => byStanding(offers, offerKey);
