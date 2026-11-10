/**
 * What the player has earned. One flag: beating the campaign opens Endless Humans, and `?unlock=1` opens it for a test. A storage that
 * is blocked keeps the flag for this session only, and a player who cannot save simply plays the campaign again.
 *
 * On the dev server it is always open, so the owner never has to beat the campaign to play the Kill House. `?unlock=0` shuts it there
 * again, to test the lock. A production build, such as the public site, keeps the lock.
 */
import type { ContractDef } from './data';

const KEY = 'op2_campaign_beaten';

const flag = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('unlock') : null;
// The location check first, so a script run by tsx, which has no `import.meta.env`, can still import this file.
const forced = flag === '1' || (typeof location !== 'undefined' && import.meta.env.DEV && flag !== '0');
let beatenThisSession = false;

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

export const isLocked = (contract: ContractDef): boolean => contract.locked === true && !campaignBeaten();
