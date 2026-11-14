/**
 * Outpost Defense's rules as plain functions over a snapshot of the run (`ShopView`): what each shop offers, what it costs
 * and why it cannot be bought, the loadout's limits, and a shop's health. No three.js and no ctx, so the tests read it
 * as the screens do. The prices are in data.ts; index.ts takes a snapshot, asks here, and carries the purchase out.
 */
import { ALLY_TYPES, type AllyType } from '../../allies/data';
import type { StructureStage } from '../../core/contracts';
import type { CallInId, WeaponId } from '../../core/gameplay';
import { CALLINS, CALLIN_ORDER } from '../../progression/data';
import { WEAPONS, WEAPON_ORDER } from '../../weapons/data';
import { membersOf } from '../../weapons/families';
import {
  ALLY_PRICES, ALLY_ROLES, BARRACKS_ORDER, BASIC_REFILL_PRICE, CALLIN_PRICES, ECONOMY, GRENADE_PRICE, MOUNT_PRICES, REPAIR_PRICES,
  SHOPS, STIM_PRICE, WEAPON_PRICES, type ShopId,
} from './data';

/** One purchase, as the runtime carries it out. */
export type Act =
  | { kind: 'weapon'; id: WeaponId }
  | { kind: 'ammo'; id: WeaponId }
  | { kind: 'grenade' }
  | { kind: 'refill' }
  | { kind: 'ally'; type: AllyType }
  | { kind: 'mortar' }
  | { kind: 'callin'; id: CallInId }
  | { kind: 'mount'; index: number }
  | { kind: 'repair'; index: number }
  | { kind: 'stim' }
  | { kind: 'rebuild'; shop: ShopId };

export interface Offer {
  section: string;
  label: string;
  detail: string;
  price: number;
  /** Why it cannot be bought now, or null. */
  why: string | null;
  act: Act;
}

export interface PieceView {
  kind: 'wall' | 'gate' | 'shack';
  stage: StructureStage;
  health: number;
  maxHealth: number;
  repairing: number;
}

/** Everything the shops ask about the run, at one moment. */
export interface ShopView {
  credits: number;
  inBreak: boolean;
  owned: ReadonlySet<WeaponId>;
  ammo(id: WeaponId): { reserve: number; maxReserve: number };
  grenades: number;
  grenadesMax: number;
  stims: number;
  stimsMax: number;
  /** Hired allies alive, up or down. */
  squad: number;
  held: ReadonlySet<CallInId>;
  cooldown(id: CallInId): number;
  /** Each mounted gun: its level (1-based) and the ladder's names. */
  mounts: readonly { level: number; names: readonly string[] }[];
  pieces: readonly PieceView[];
  lost(shop: ShopId): boolean;
  /** The player's mortar teams posted, and the posts there are for them (none off the fort). */
  mortars: number;
  mortarsMax: number;
}

// ---------------------------------------------------------------------------------------------
// Shops' health
// ---------------------------------------------------------------------------------------------

/** A shop as a building with health (Q1). Lost at 0, until rebuilt (Q7). */
export class ShopState {
  health: number;
  readonly max: number;

  constructor(readonly id: ShopId) {
    this.max = this.health = SHOPS[id].health;
  }

  get lost(): boolean {
    return this.health <= 0;
  }

  /** True on the hit that loses it. A lost shop takes no more. */
  damage(amount: number): boolean {
    if (this.lost || amount <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    return this.lost;
  }

  restore(): void {
    this.health = this.max;
  }
}

// ---------------------------------------------------------------------------------------------
// Loadout
// ---------------------------------------------------------------------------------------------

export interface LoadoutCheck {
  cost: number;
  /** Budget left, which becomes credits. Negative when over. */
  left: number;
  why: string | null;
}

/** Why `id` cannot go in the loadout's `slot`, or null. */
export function loadoutRefusal(id: WeaponId, slot: 'primary' | 'secondary'): string | null {
  const p = WEAPON_PRICES[id];
  if (!p) return 'Not sold';
  if (p.explosive) return 'No explosives: Armoury, in a break';
  if (p.loadout !== slot) return slot === 'primary' ? 'A secondary' : 'A primary';
  return null;
}

/** One primary and one secondary, no explosives, inside the budget. */
export function checkLoadout(primary: WeaponId | null, secondary: WeaponId | null, budget: number = ECONOMY.budget): LoadoutCheck {
  const cost = (primary ? WEAPON_PRICES[primary]?.price ?? 0 : 0) + (secondary ? WEAPON_PRICES[secondary]?.price ?? 0 : 0);
  const left = budget - cost;
  const why = !primary ? 'Pick a primary'
    : !secondary ? 'Pick a secondary'
      : loadoutRefusal(primary, 'primary') ?? loadoutRefusal(secondary, 'secondary') ?? (left < 0 ? `Over budget by ${-left}` : null);
  return { cost, left, why };
}

// ---------------------------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------------------------

const need = (price: number, v: ShopView): string | null => (price > v.credits ? `Need ${price - v.credits} more` : null);
const half = (max: number): number => Math.ceil(max / 2);

function weapons(v: ShopView): Offer[] {
  const out: Offer[] = [];
  for (const id of WEAPON_ORDER) {
    const p = WEAPON_PRICES[id];
    if (!p) continue;
    const members = membersOf(id).filter(m => !v.owned.has(m));
    const detail = members.length > 0 ? `With the ${members.map(m => WEAPONS[m].name).join(', ')}` : `${p.ammo} ammo`;
    const why = v.owned.has(id) ? 'Owned' : !v.inBreak ? 'Only in a break' : need(p.price, v);
    out.push({ section: 'Weapons', label: WEAPONS[id].name, detail, price: p.price, why, act: { kind: 'weapon', id } });
  }
  return out;
}

function ammo(v: ShopView, basicOnly: boolean): Offer[] {
  const out: Offer[] = [];
  for (const id of WEAPON_ORDER) {
    const p = WEAPON_PRICES[id];
    if (!p || !v.owned.has(id) || (basicOnly && p.ammo !== 'basic')) continue;
    const a = v.ammo(id);
    const why = a.reserve >= a.maxReserve ? 'Full' : need(p.box, v);
    out.push({
      section: 'Ammunition', label: `${WEAPONS[id].name} ammo`, detail: `${p.ammo}, +${half(a.maxReserve)}. ${a.reserve} of ${a.maxReserve}`,
      price: p.box, why, act: { kind: 'ammo', id },
    });
  }
  return out;
}

function armoury(v: ShopView): Offer[] {
  const out = [...weapons(v), ...ammo(v, false)];
  out.push({
    section: 'Ammunition', label: 'Grenade', detail: `explosive. ${v.grenades} of ${v.grenadesMax}`, price: GRENADE_PRICE,
    why: v.grenades >= v.grenadesMax ? 'Full' : need(GRENADE_PRICE, v), act: { kind: 'grenade' },
  });
  v.mounts.forEach((m, index) => {
    const price = MOUNT_PRICES[m.level - 1];
    const next = m.names[m.level];
    out.push({
      section: 'Mounted guns', label: `Gun ${index + 1}`, detail: next ? `${m.names[m.level - 1]} to ${next}` : m.names[m.level - 1] ?? '',
      price: price ?? 0, why: price === undefined || !next ? 'Top of the ladder' : need(price, v), act: { kind: 'mount', index },
    });
  });
  for (const id of CALLIN_ORDER) {
    const price = CALLIN_PRICES[id];
    const wait = v.cooldown(id);
    const why = v.held.has(id) ? `Ready: key ${CALLINS[id].key}` : wait > 0 ? `Rearming, ${Math.ceil(wait)} s` : need(price, v);
    out.push({ section: 'Call-ins', label: CALLINS[id].name, detail: 'Any time', price, why, act: { kind: 'callin', id } });
  }
  return out;
}

function barracks(v: ShopView): Offer[] {
  const out: Offer[] = [];
  const full = v.squad >= ECONOMY.squadMax;
  for (const type of BARRACKS_ORDER) {
    const price = ALLY_PRICES[type];
    if (type === 'mortar') {
      const why = v.mortarsMax === 0 ? 'No mortar posts here' : v.mortars >= v.mortarsMax ? `All ${v.mortarsMax} posts manned` : need(price, v);
      out.push({ section: 'Troops', label: 'Mortar team', detail: ALLY_ROLES.mortar, price, why, act: { kind: 'mortar' } });
      continue;
    }
    const why = full ? `Squad full, ${ECONOMY.squadMax}` : need(price, v);
    out.push({ section: 'Troops', label: ALLY_TYPES[type].label, detail: ALLY_ROLES[type], price, why, act: { kind: 'ally', type } });
  }
  const counts = { wall: 0, gate: 0 };
  v.pieces.forEach((piece, index) => {
    if (piece.kind === 'shack') return;
    const n = ++counts[piece.kind];
    const whole = piece.stage === 'intact' && piece.health >= piece.maxHealth;
    if (whole) return;
    const price = REPAIR_PRICES[piece.kind] * (piece.stage === 'intact' ? 0.5 : 1);
    const label = `${piece.kind === 'wall' ? 'Wall' : 'Gate'} ${n}`;
    const why = piece.repairing >= 0 ? 'Under repair' : need(price, v);
    out.push({ section: 'Repairs', label, detail: piece.stage === 'intact' ? 'chipped' : piece.stage, price, why, act: { kind: 'repair', index } });
  });
  if (!out.some(o => o.section === 'Repairs')) {
    out.push({ section: 'Repairs', label: 'Walls and gates', detail: 'Nothing to repair', price: 0, why: 'All whole', act: { kind: 'repair', index: -1 } });
  }
  return out;
}

function infirmary(v: ShopView): Offer[] {
  const out: Offer[] = [{
    section: 'Infirmary', label: 'Stim', detail: `${v.stims} of ${v.stimsMax}`, price: STIM_PRICE,
    why: v.stims >= v.stimsMax ? `Carrying ${v.stimsMax}` : need(STIM_PRICE, v), act: { kind: 'stim' },
  }];
  const basics = ammo(v, true);
  const room = basics.some(o => o.why !== 'Full');
  out.push({
    section: 'Magazine', label: 'Basic ammo, every gun', detail: 'Half a reserve for each basic gun', price: BASIC_REFILL_PRICE,
    why: basics.length === 0 ? 'No basic guns' : !room ? 'Full' : need(BASIC_REFILL_PRICE, v), act: { kind: 'refill' },
  });
  return out;
}

/** Everything `shop` sells, in menu order, each with why it cannot be bought now. A lost shop offers only its rebuild. */
export function offers(shop: ShopId, v: ShopView): Offer[] {
  if (v.lost(shop)) {
    const price = SHOPS[shop].rebuild;
    return [{
      section: 'Lost', label: `Rebuild the ${SHOPS[shop].name}`, detail: 'Everything it sold comes back', price,
      why: !v.inBreak ? 'Only in a break' : need(price, v), act: { kind: 'rebuild', shop },
    }];
  }
  return shop === 'armoury' ? armoury(v) : shop === 'barracks' ? barracks(v) : infirmary(v);
}

export const sameAct = (a: Act, b: Act): boolean => JSON.stringify(a) === JSON.stringify(b);
