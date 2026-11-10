/**
 * The Crucible's rules: the player's own, kept in localStorage, and the ones this page's run is playing. The model, its
 * limits and its repairs are in enemies/rules.ts.
 *
 * They apply only to The Crucible's swarm game, never to a mission, Endless Humans, the Test Range or a sandbox, and
 * `?rules=0` plays the standard rules on a page without touching what is stored. Any rule off its default makes the run
 * unranked: its score never beats or writes the record (progression/score.ts), and the HUD and the screens say so.
 *
 * A run takes its rules when it starts (Hud.startRun calls refreshRules), so every reader agrees from the reset to the end.
 */
import { MISSION_ID } from '../campaign/select';
import { ON_RANGE } from '../core/devflags';
import { DEFAULT_RULES, diffRules, isCustom, sanitizeRules, type CrucibleRules } from '../enemies/rules';
import { ACTIVE } from './select';

/** The version is in the key. A field added later needs no new one, because a missing field takes its default. */
export const RULES_KEY = 'op2.crucible.rules.v1';

const query = typeof location === 'undefined' ? null : new URLSearchParams(location.search);

/** `?rules=0`: this page plays the standard rules whatever is stored. */
export const RULES_SKIPPED = query?.get('rules') === '0';

/** This page's run is The Crucible's own game, so the player's rules are its rules. */
export const RULES_APPLY: boolean =
  query !== null && ACTIVE.def.id === 'crucible' && MISSION_ID === null && !ON_RANGE && !query.has('sandbox') && !RULES_SKIPPED;

/** Set only when a save failed, as in a private window: the rules then last for this page. */
let unsaved: CrucibleRules | null = null;

export function loadRules(): CrucibleRules {
  if (unsaved) return unsaved;
  try {
    const raw = localStorage.getItem(RULES_KEY);
    return raw === null ? DEFAULT_RULES : sanitizeRules(JSON.parse(raw));
  } catch {
    return DEFAULT_RULES;
  }
}

/** Stores only what differs from the defaults, and nothing at all for the standard rules. Returns what was kept. */
export function saveRules(rules: CrucibleRules): CrucibleRules {
  const clean = sanitizeRules(rules);
  const diff = diffRules(clean);
  try {
    if (diff) localStorage.setItem(RULES_KEY, JSON.stringify(diff));
    else localStorage.removeItem(RULES_KEY);
    unsaved = null;
  } catch {
    unsaved = clean === DEFAULT_RULES ? null : clean;
  }
  return clean;
}

export function resetRules(): void {
  saveRules(DEFAULT_RULES);
}

/** What the menu shows for the Crucible's next run. */
export const storedRulesCustom = (): boolean => !RULES_SKIPPED && isCustom(loadRules());

let current: CrucibleRules = RULES_APPLY ? loadRules() : DEFAULT_RULES;

/** Before each run. `apply` is for the tests; a page always passes its own answer. */
export function refreshRules(apply: boolean = RULES_APPLY): CrucibleRules {
  current = apply ? loadRules() : DEFAULT_RULES;
  return current;
}

/** The rules of the run in play. The standard ones on any page they do not apply to. */
export const crucibleRules = (): CrucibleRules => current;

/** The run in play is on custom rules, so it is unranked. Sanitizing hands back DEFAULT_RULES itself for the standard set. */
export const rulesCustom = (): boolean => current !== DEFAULT_RULES;
