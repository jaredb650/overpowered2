/**
 * The public build's cheat lock. Settings > Enable cheats asks for a password; once it is right, the lab's panel (` or F1)
 * loads on the live site, and every run is unranked (contracts/crucible.ts `rulesCustom`). A toy lock for the owner and
 * their friends, not security: the word sits in the bundle. The choice is kept in localStorage until "Disable cheats".
 */
const KEY = 'op2.cheats.v1';
const PASSWORD = 'imalittlecheater';

/** Case, spaces and apostrophes don't count, so "I'm a little cheater" opens it too. */
export const normalizePassword = (text: string): string => text.toLowerCase().replace(/[\s'’‘`´]/g, '');

export const isCheatPassword = (text: string): boolean => normalizePassword(text) === PASSWORD;

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

let on = read();
const listeners = new Set<(on: boolean) => void>();

export const cheatsOn = (): boolean => on;

export function setCheats(next: boolean): void {
  if (next === on) return;
  on = next;
  try {
    if (next) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // A private window can refuse this; the cheats still hold for the session.
  }
  for (const fn of listeners) fn(next);
}

export function onCheats(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Tests: forget the state without touching storage. */
export function resetCheatsForTest(next = false): void {
  on = next;
  listeners.clear();
}
