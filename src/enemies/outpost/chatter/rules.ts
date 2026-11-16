/**
 * The rule table's matcher (docs/design/squad-comms.md, "Core architecture"). Facts in, the most specific row out, memory written
 * back. No three.js, so a test can feed facts and read the line.
 *
 * A row passes when the speaker's morale tier is one of its tiers, his role is in its `unit` (if it names one), every criterion
 * holds against the moment's facts, and its own cooldown has run. The rows with the most criteria win, then a row not yet said
 * this run (weighted at random), then the one said longest ago. Rows all on their cooldowns are silence, and a few concepts that
 * come round every few seconds are sometimes left unsaid (`NOTHING`).
 */
import type { CommsKind } from '../events';
import type { Role } from '../doctrine';
import type { MoraleState } from '../morale';
import { NOTHING, RULES } from './lines';

export type Faction = 'garrison' | 'holdfast' | 'bureau';
/** 'confident' arrives with the morale outcomes. Until then nobody is in it, and the High rows cover it. */
export type ChatterState = MoraleState | 'confident';
/** The owner's four: High (confident, steady), Medium (shaken), Low (panicked), Desperate (broken). */
export type Tier = 'high' | 'medium' | 'low' | 'desperate';
/** Critical cuts tactical cuts emotional cuts idle. */
export type Priority = 'critical' | 'tactical' | 'emotional' | 'idle';
/** For the voices later (section 5.4 of the proposal). */
export type ChatterEmotion = 'calm' | 'urgent' | 'cocky' | 'afraid' | 'panic' | 'pain' | 'pleading' | 'defiant' | 'hushed' | 'grief';
export type ChatterChannel = 'shout' | 'radio' | 'scream';

/** One row of lines.json: the owner's fields, plus emotion, channel and weight. */
export interface ChatterRule {
  /** Stable: 'ch.garrison.lost.pro.2'. The file name in the voice pass. */
  id: string;
  faction: Faction;
  concept: CommsKind;
  /** Boolean facts of the moment that must hold, each one more point of specificity. */
  criteria: Readonly<Record<string, boolean>>;
  /** Roles that may say it. Null is anyone. */
  unit: readonly Role[] | null;
  /** Stage 8's temperaments. Null for now. */
  personality: string | null;
  morale_tier: readonly Tier[];
  /** Slots: {dead} the man it is about, {clock} {cardinal} {squad} {target} where a stage fills them. */
  text: string;
  priority: Priority;
  /** Seconds before this row again. */
  cooldown: number;
  radio: boolean;
  /** False: nobody else's line cuts it. Death still does. */
  interruptible: boolean;
  emotion: ChatterEmotion;
  channel: ChatterChannel;
  weight?: number;
  /** Once a run. */
  once?: boolean;
}

export interface ChatterFacts {
  faction: Faction;
  tier: Tier;
  role: Role | null;
  /** The moment's boolean facts, read by `criteria`. */
  flags: Record<string, boolean>;
}

export const TIER_OF: Record<ChatterState, Tier> = { confident: 'high', steady: 'high', shaken: 'medium', panicked: 'low', broken: 'desperate' };
export const RANK: Record<Priority, number> = { idle: 0, emotional: 1, tactical: 2, critical: 3 };

/** Seconds a character takes to say, and how long a whole line holds the air: the radio's own rule. */
export const SPEAK_RATE = 0.05;
export const airtime = (text: string): number => 0.9 + 0.06 * text.length;

/** Kinds that cut in over the side-wide line gap. A bubble of one of these is not the one a fourth line replaces. */
export const URGENT: ReadonlySet<CommsKind> = new Set<CommsKind>(['manDown', 'leaderDown', 'takingCommand', 'squadGone', 'frag', 'flash', 'surrender', 'lastStand', 'spring', 'refused', 'hostage']);

/** Rows by `faction/concept`, in table order. */
const INDEX = new Map<string, number[]>();
const PRIORITY = new Map<CommsKind, Priority>();
RULES.forEach((r, i) => {
  const key = `${r.faction}/${r.concept}`;
  let list = INDEX.get(key);
  if (!list) INDEX.set(key, list = []);
  list.push(i);
  if (!PRIORITY.has(r.concept)) PRIORITY.set(r.concept, r.priority);
});

/** A concept's tier, from its rows. Words a caller chose (orders, relays) are tactical. */
export const priorityOf = (concept: CommsKind): Priority => PRIORITY.get(concept) ?? 'tactical';

/** A faction with no rows of its own for a concept borrows the garrison's, until its own set is written. */
export const rowsFor = (concept: CommsKind, faction: Faction): readonly number[] =>
  INDEX.get(`${faction}/${concept}`) ?? INDEX.get(`garrison/${concept}`) ?? [];

/** How many criteria the row has, or -1 if one fails. */
export function score(r: ChatterRule, f: ChatterFacts): number {
  if (!r.morale_tier.includes(f.tier)) return -1;
  let n = 1;
  if (r.unit) {
    if (!f.role || !r.unit.includes(f.role)) return -1;
    n++;
  }
  for (const key in r.criteria) {
    if ((f.flags[key] ?? false) !== r.criteria[key]) return -1;
    n++;
  }
  return n;
}

/** Why the last row won, for the debug overlay. */
export interface ChatterWhy { row: number; score: number; rivals: number }

/** What has been said this run. Cleared by `reset`. */
export class ChatterMemory {
  readonly lastAt = new Float64Array(RULES.length).fill(-Infinity);
  readonly said = new Uint16Array(RULES.length);
  readonly why: ChatterWhy = { row: -1, score: 0, rivals: 0 };

  reset(): void {
    this.lastAt.fill(-Infinity);
    this.said.fill(0);
  }

  /** The row to say, or -1 for silence. Writes the choice back. */
  pick(concept: CommsKind, f: ChatterFacts, now: number, random: () => number = Math.random): number {
    const quiet = NOTHING[concept];
    if (quiet !== undefined && random() < quiet) return -1;
    const rows = rowsFor(concept, f.faction);
    let best = -1;
    for (const i of rows) best = Math.max(best, this.open(i, now) ? score(RULES[i]!, f) : -1);
    if (best < 0) return -1;
    let fresh = 0;
    let oldest = -1;
    let rivals = 0;
    for (const i of rows) {
      if (!this.open(i, now) || score(RULES[i]!, f) !== best) continue;
      rivals++;
      if (this.said[i] === 0) fresh += RULES[i]!.weight ?? 1;
      else if (oldest < 0 || this.lastAt[i]! < this.lastAt[oldest]!) oldest = i;
    }
    let chosen = oldest;
    if (fresh > 0) {
      let roll = random() * fresh;
      for (const i of rows) {
        if (this.said[i] !== 0 || !this.open(i, now) || score(RULES[i]!, f) !== best) continue;
        chosen = i;
        roll -= RULES[i]!.weight ?? 1;
        if (roll < 0) break;
      }
    }
    this.lastAt[chosen] = now;
    this.said[chosen]!++;
    this.why.row = chosen;
    this.why.score = best;
    this.why.rivals = rivals;
    return chosen;
  }

  private open(i: number, now: number): boolean {
    const r = RULES[i]!;
    if (r.once && this.said[i]! > 0) return false;
    return now - this.lastAt[i]! >= r.cooldown;
  }
}

/** The row's words with its slots filled. A slot with nothing to fill it reads as a plain word. */
export function lineText(row: number, slots: Readonly<Record<string, string>> = {}): string {
  return RULES[row]!.text.replace(/\{(\w+)\}/g, (_, k: string) => slots[k] ?? (k === 'dead' ? 'him' : ''));
}

/** What was said before a cut at `at` characters, with the dash, and on the radio the static after it. */
export const cutText = (text: string, at: number, radio = false): string => `${text.slice(0, Math.max(1, at)).trimEnd()}—${radio ? ' *kssht*' : ''}`;
