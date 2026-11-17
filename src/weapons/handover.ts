/**
 * A gun leaving one arsenal for another: sold back at the shop, or dropped on the ground (dropped.ts) for anyone to take. The
 * kit is the gun with every mod held for it (fitted or not) and its rounds. Pure: no three.js, no ctx, so the shop and the net
 * can share it.
 */
import type { ModId, WeaponId } from '../core/gameplay';
import { WEAPONS } from './data';
import { MODS } from './mods';

export interface GunKit {
  weapon: WeaponId;
  /** Every mod held for this gun, and the ones of them fitted. */
  mods: ModId[];
  fitted: ModId[];
  mag: number;
  reserve: number;
}

/** A kit lying on the ground, as the host numbers it: where, and the name of who dropped it. */
export interface WireGun extends GunKit {
  id: number;
  at: [number, number, number];
  by: string;
}

/** True when giving up `id` still leaves a gun (not a blade) in hand: nobody is ever left unarmed. */
export const keepsAGun = (owned: ReadonlySet<WeaponId>, id: WeaponId): boolean =>
  owned.has(id) && [...owned].some(o => o !== id && WEAPONS[o]?.mode !== 'melee');

const count = (v: unknown, max: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0);

/** A kit off the wire, or null: a real gun, only its own mods, fitted ones held, and rounds it could carry. */
export function cleanKit(raw: unknown): GunKit | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const weapon = r.weapon as WeaponId;
  const def = typeof weapon === 'string' && Object.hasOwn(WEAPONS, weapon) ? WEAPONS[weapon] : null;
  if (!def || !Array.isArray(r.mods) || !Array.isArray(r.fitted)) return null;
  const mods = [...new Set(r.mods)].filter((m): m is ModId => typeof m === 'string' && Object.hasOwn(MODS, m) && MODS[m as ModId].weapon === weapon);
  const fitted = [...new Set(r.fitted)].filter((m): m is ModId => mods.includes(m as ModId));
  // A mag mod can hold more than the stock magazine: twice the stock size is the most any is let through.
  return { weapon, mods, fitted, mag: count(r.mag, Math.max(1, def.magSize) * 2), reserve: count(r.reserve, def.maxReserve) };
}

/** A dropped gun off the wire, or null. */
export function cleanWire(raw: unknown): WireGun | null {
  const kit = cleanKit(raw);
  if (!kit) return null;
  const r = raw as Record<string, unknown>;
  const at = r.at;
  if (!Number.isInteger(r.id) || !Array.isArray(at) || at.length !== 3 || !at.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e5)) return null;
  return { ...kit, id: r.id as number, at: at as [number, number, number], by: String(r.by ?? '').slice(0, 24) };
}
