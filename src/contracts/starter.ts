/** Key-1 deployment choice. No world or UI dependencies; URL overrides the saved preference. */
import type { WeaponId } from '../core/gameplay';
import type { ContractId } from './data';

export const STARTERS = ['smg', 'gimlet', 'harrow'] as const;
export type StarterGun = typeof STARTERS[number];
export const STARTER_KEY = 'op2_starter';
export const hasStarter = (mode: ContractId): boolean => ['crucible', 'outpost', 'rooftop', 'campaign', 'foreclosure', 'bank_run'].includes(mode);
export const isStarter = (value: unknown): value is StarterGun => STARTERS.includes(value as StarterGun);
export const defaultStarter = (mode: ContractId): StarterGun => mode === 'outpost' || mode === 'rooftop' ? 'harrow' : 'smg';

export function starterPreference(): StarterGun | undefined {
  const value = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('starter');
  if (isStarter(value)) return value;
  try {
    const saved = localStorage.getItem(STARTER_KEY);
    if (isStarter(saved)) return saved;
  } catch { /* Storage may be blocked. The URL still works. */ }
  return undefined;
}

export const selectedStarter = (mode: ContractId): StarterGun => starterPreference() ?? defaultStarter(mode);

export function saveStarter(gun: StarterGun): void {
  try { localStorage.setItem(STARTER_KEY, gun); } catch { /* Keep the choice in the deployment URL. */ }
}

/** Replace only the issued key-1 gun; scripted pickups and all other keys retain their order. */
export function starterLoadout(weapons: readonly WeaponId[], gun: StarterGun): readonly WeaponId[] {
  return weapons.map(id => isStarter(id) ? gun : id);
}
