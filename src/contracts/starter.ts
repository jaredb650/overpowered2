/** Key-1 deployment choice. No world or UI dependencies; URL overrides the saved preference. */
import type { ModId, WeaponId } from '../core/gameplay';
import { ISSUED, MODS, MOD_ORDER } from '../weapons/mods';
import type { ContractId } from './data';

export const STARTERS = ['smg', 'gimlet', 'harrow'] as const;
export const ALL_STARTERS = ['smg', 'gimlet', 'harrow', 'flail'] as const;
export const DESERT_RAID_STARTERS = ['smg', 'gimlet', 'harrow', 'flail'] as const;
export type StarterGun = typeof ALL_STARTERS[number];
export const STARTER_KEY = 'op2_starter';
export const STARTER_DESERT_RAID_KEY = 'op2_starter.desert_raid';
export const hasStarter = (mode: ContractId): boolean => ['crucible', 'outpost', 'rooftop', 'badlands', 'endless_war', 'dogfight', 'campaign', 'foreclosure', 'bank_run', 'desert_raid', 'deprecation'].includes(mode);
export const startersFor = (mode: ContractId): readonly StarterGun[] => mode === 'desert_raid' ? DESERT_RAID_STARTERS : STARTERS;
export const isStarter = (value: unknown): value is StarterGun => ALL_STARTERS.includes(value as StarterGun);
export const isStarterFor = (mode: ContractId, value: unknown): value is StarterGun => startersFor(mode).includes(value as StarterGun);
export const defaultStarter = (mode: ContractId): StarterGun =>
  mode === 'desert_raid' ? 'flail'
  : mode === 'outpost' || mode === 'rooftop' || mode === 'badlands' || mode === 'endless_war' || mode === 'dogfight' ? 'harrow'
  : 'smg';

export function starterPreference(mode?: ContractId): StarterGun | undefined {
  const valid = (v: unknown): v is StarterGun => mode ? isStarterFor(mode, v) : STARTERS.includes(v as typeof STARTERS[number]);
  const value = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('starter');
  if (valid(value)) return value;
  try {
    const saved = localStorage.getItem(mode === 'desert_raid' ? STARTER_DESERT_RAID_KEY : STARTER_KEY);
    if (valid(saved)) return saved;
  } catch { /* Storage may be blocked. The URL still works. */ }
  return undefined;
}

export const selectedStarter = (mode: ContractId): StarterGun => starterPreference(mode) ?? defaultStarter(mode);

export function saveStarter(gun: StarterGun, mode?: ContractId): void {
  const key = mode === 'desert_raid' ? STARTER_DESERT_RAID_KEY : STARTER_KEY;
  if (mode !== 'desert_raid' && !STARTERS.includes(gun as typeof STARTERS[number])) return;
  try { localStorage.setItem(key, gun); } catch { /* Keep the choice in the deployment URL. */ }
}

/** Replace only the issued key-1 gun; scripted pickups and all other keys retain their order. */
export function starterLoadout(weapons: readonly WeaponId[], gun: StarterGun): readonly WeaponId[] {
  return weapons.map(id => isStarter(id) ? gun : id);
}

/**
 * Whether free starter mod customization is available for `gun` in `mode`.
 * Any mission unlocks free mods for all starters after 2 wins; Desert Raid always allows customizing Flail.
 */
export function starterModsAvailable(mode: ContractId, gun: StarterGun, missionUnlocked: boolean): boolean {
  return missionUnlocked || (mode === 'desert_raid' && gun === 'flail');
}

/** Per-gun starter mod configuration (JSON map of StarterGun -> ModId[]), unlocked per mission after 2 wins (always open for Flail in Desert Raid). */
export const STARTER_MODS_KEY = 'op2_starter_mods';

/** Every mod that fits `gun`, in canonical `MOD_ORDER`. */
export function starterGunMods(gun: StarterGun): ModId[] {
  return MOD_ORDER.filter(id => MODS[id].weapon === gun);
}

/** Default starter mods for `gun` when the player has not saved a custom configuration (matches `ISSUED`). */
export function defaultStarterMods(gun: StarterGun): ModId[] {
  return ISSUED.filter(id => MODS[id].weapon === gun);
}

/** Keeps only valid mods belonging to `gun`, enforcing same-slot exclusion (later wins) in canonical `MOD_ORDER`. */
export function sanitizeStarterMods(gun: StarterGun, raw: unknown): ModId[] {
  if (!Array.isArray(raw)) return [];
  const kept: ModId[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !Object.hasOwn(MODS, item)) continue;
    const id = item as ModId;
    const def = MODS[id];
    if (def.weapon !== gun) continue;
    if (def.slot) {
      for (let i = kept.length - 1; i >= 0; i--) {
        if (MODS[kept[i]!].slot === def.slot) kept.splice(i, 1);
      }
    }
    if (!kept.includes(id)) kept.push(id);
  }
  const set = new Set(kept);
  return MOD_ORDER.filter(id => set.has(id));
}

function readStarterModMap(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(STARTER_MODS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Saved custom starter mods for `gun`, or its issued defaults if none have been saved yet. */
export function selectedStarterMods(gun: StarterGun): ModId[] {
  const map = readStarterModMap();
  if (Object.hasOwn(map, gun) && Array.isArray(map[gun])) return sanitizeStarterMods(gun, map[gun]);
  return defaultStarterMods(gun);
}

/** Persists `mods` for `gun` after filtering by weapon ownership and enforcing slot exclusion. */
export function saveStarterMods(gun: StarterGun, mods: readonly ModId[]): void {
  const map = readStarterModMap();
  map[gun] = sanitizeStarterMods(gun, mods);
  try {
    localStorage.setItem(STARTER_MODS_KEY, JSON.stringify(map));
  } catch { /* Storage may be blocked. */ }
}

/**
 * Toggles `mod` on `gun` starting from `current`.
 * Fitting a mod whose `slot` is set replaces any other mod in that same slot; mods without a slot toggle freely.
 */
export function toggleStarterMod(current: readonly ModId[], gun: StarterGun, mod: ModId): ModId[] {
  const next = sanitizeStarterMods(gun, current);
  if (!Object.hasOwn(MODS, mod) || MODS[mod].weapon !== gun) return next;
  const idx = next.indexOf(mod);
  if (idx >= 0) {
    next.splice(idx, 1);
    return next;
  }
  const slot = MODS[mod].slot;
  const filtered = slot ? next.filter(id => MODS[id].slot !== slot) : next;
  const set = new Set<ModId>([...filtered, mod]);
  return MOD_ORDER.filter(id => set.has(id));
}
