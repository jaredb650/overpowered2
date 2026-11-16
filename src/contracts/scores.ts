/**
 * One high score per contract and map, in localStorage. Blocked storage leaves the record living for this session only. The contract's
 * own map keeps the bare key; a map it also plays on (`alsoOn`) gets its own.
 */
import type { MapId } from '../world/map/maps';
import type { ContractDef } from './data';

export const scoreKeyOf = (def: ContractDef, map: MapId = def.map): string => (map === def.map ? def.scoreKey : `${def.scoreKey}.${map}`);

export function readHighScore(def: ContractDef, map?: MapId): number {
  try {
    const value = Number(localStorage.getItem(scoreKeyOf(def, map)));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function writeHighScore(def: ContractDef, value: number, map?: MapId): void {
  try {
    localStorage.setItem(scoreKeyOf(def, map), String(value));
  } catch {
    // See above.
  }
}
