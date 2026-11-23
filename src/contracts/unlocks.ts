/**
 * What the player has earned. One flag: beating the campaign opens Endless Humans, and `?unlock=1` opens it for a test. A storage that
 * is blocked keeps the flag for this session only, and a player who cannot save simply plays the campaign again.
 *
 * On the dev server it is always open, so the owner never has to beat the campaign to play the Kill House. `?unlock=0` shuts it there
 * again, to test the lock. A production build, such as the public site, keeps the lock.
 */
import type { ContractDef } from './data';

const KEY = 'op2_campaign_beaten';
/** Per-mission win counter (JSON map of MissionId -> count). Beating a mission twice unlocks free starter mod choice. */
export const MISSION_WINS_KEY = 'op2_mission_wins';
/** Wins needed on a mission to unlock free starter mod configuration on its starter screen. */
export const MISSION_MOD_WINS = 2;

const flag = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('unlock') : null;
// The location check first, so a script run by tsx, which has no `import.meta.env`, can still import this file.
const forced = flag === '1' || (typeof location !== 'undefined' && import.meta.env.DEV && flag !== '0');
let beatenThisSession = false;
const sessionWins = new Map<string, number>();

export function campaignBeaten(): boolean {
  if (forced || beatenThisSession) return true;
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** True the first time, which is when there is something to announce. */
export function recordCampaignBeaten(): boolean {
  const first = !campaignBeaten();
  beatenThisSession = true;
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // See above.
  }
  return first;
}

function readWinMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(MISSION_WINS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = Math.floor(v);
    }
    return out;
  } catch {
    return {};
  }
}

/** Recorded wins for a specific mission id. */
export function missionWins(missionId: string): number {
  const stored = readWinMap()[missionId] ?? 0;
  return Math.max(stored, sessionWins.get(missionId) ?? 0);
}

/** Increments and persists the win count for `missionId`. Returns the new count. */
export function recordMissionWin(missionId: string): number {
  const map = readWinMap();
  const next = Math.max(map[missionId] ?? 0, sessionWins.get(missionId) ?? 0) + 1;
  sessionWins.set(missionId, next);
  map[missionId] = next;
  try {
    localStorage.setItem(MISSION_WINS_KEY, JSON.stringify(map));
  } catch {
    // Storage unavailable; kept in memory for this session.
  }
  return next;
}

/** True when `missionId` has been beaten at least `MISSION_MOD_WINS` (2) times. */
export function missionModsUnlocked(missionId: string): boolean {
  return missionWins(missionId) >= MISSION_MOD_WINS;
}

export const isLocked = (contract: ContractDef): boolean => contract.locked === true && !campaignBeaten();

/** What the menu shuts: a locked row, or the next mission while the one before it is unwon. Only the Outpost's win is recorded so far. */
export const isShut = (contract: ContractDef): boolean => isLocked(contract) || (contract.opensAfter !== undefined && !campaignBeaten());
