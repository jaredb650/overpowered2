/**
 * Every enemy line, as data: lines.json, one row per line, with the owner's fields (docs/design/squad-comms.md, "Build plan"):
 * id, concept, criteria, unit, personality, morale_tier, text, priority, cooldown, radio, interruptible, plus emotion, channel and
 * weight. Writers add rows there without touching code; rules.ts matches them.
 *
 * What they call you follows the tier. High and Medium: "tango", "target", "hostile", "the subject", "he", with Medium more urgent
 * and swearing a little. Low: "it", "that thing", "the freak", "that piece of shit", swearing in full. Desperate: just "him" and
 * swearing. Every line the game had before the table is a Low row, word for word.
 *
 * Ids are `ch.<faction>.<concept>.<tag>.<n>`. Append; never renumber, since the voices will be named by id.
 */
import type { CommsKind } from '../events';
import type { ChatterRule } from './rules';
import data from './lines.json';

export const RULES: readonly ChatterRule[] = data as unknown as ChatterRule[];

/**
 * How often a concept is better left unsaid: the chance a moment passes in silence. Silence still keeps the concept's gap.
 * Only the drills that come round every few seconds need it.
 */
export const NOTHING: Partial<Record<CommsKind, number>> = { moving: 0.3, fix: 0.2, contact: 0.15, plateHeld: 0.3, set: 0.5, playerHit: 0.4 };
