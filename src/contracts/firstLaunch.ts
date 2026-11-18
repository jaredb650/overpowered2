/**
 * Has this browser ever played? A bare link's first Play goes to Retraining (docs/design/tutorial.md, section 1.4); an invite link
 * never does. No three.js, no DOM beyond localStorage, so the menu and tests can ask.
 */

/** Written when Retraining is seen at all: started, left by the door, or finished. */
export const SEEN_KEY = 'op2.retraining.v1';
/** Written the first time any run starts, in any mode. */
export const PLAYED_KEY = 'op2.played.v1';

/**
 * Keys that only a player writes. Telemetry, the lab, cheats, the chunk-reload flag and the co-op name (made up on load) are written
 * without playing and do not count.
 * `op2_highscore` also matches every per-contract high score.
 */
const PROGRESS = [
  SEEN_KEY, PLAYED_KEY, 'op2_highscore', 'op2_campaign_beaten', 'op2_starter', 'op2.implants.worn', 'op2.crucible.rules.v1',
  'op2_coop_match', 'op2.settings.v1', 'op2.bindings.v2', 'op2.bindings.v1', 'op2_adsZoom',
] as const;

type Store = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem'>;

const store = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** True only when storage works and holds nothing a player writes. Broken storage reads as a returning player, never a trap. */
export function isFirstLaunch(s: Store | null = store()): boolean {
  if (!s) return false;
  try {
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (key && PROGRESS.some(p => key === p || key.startsWith(`${p}.`))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function write(key: string, value: string, s: Store | null = store()): void {
  try {
    s?.setItem(key, value);
  } catch {
    // shortcut: a private window that throws keeps no record, so the next visit may offer Retraining again; harmless.
  }
}

export const markPlayed = (s?: Store | null): void => write(PLAYED_KEY, '1', s);

/** `left` is the beat the door was walked through at, or null once finished. */
export const markRetrainingSeen = (left: string | null, s?: Store | null): void =>
  write(SEEN_KEY, JSON.stringify({ seen: true, finished: left === null, left }), s);
