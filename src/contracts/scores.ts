/** One high score per contract, in localStorage. Blocked storage leaves the record living for this session only. */
import type { ContractDef } from './data';

export function readHighScore(def: ContractDef): number {
  try {
    const value = Number(localStorage.getItem(def.scoreKey));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function writeHighScore(def: ContractDef, value: number): void {
  try {
    localStorage.setItem(def.scoreKey, String(value));
  } catch {
    // See above.
  }
}
