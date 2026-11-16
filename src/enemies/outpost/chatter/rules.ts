/**
 * The rule table's matcher (docs/proposals/squad-chatter.md, section 5.1). Facts in, the most specific row out, memory written
 * back. No three.js, so a test can feed facts and read the line.
 *
 * A row passes when every `who` and `when` criterion holds and its own gap has run. The rows with the most criteria win, then a
 * row not yet said this run (weighted at random), then the one said longest ago. Rows that are all on their gaps are silence, and
 * a few concepts that come round every few seconds are sometimes left unsaid (`NOTHING`).
 */
import type { CommsKind } from '../events';
import type { Role } from '../doctrine';
import type { MoraleState } from '../morale';
import type { Rank } from '../rank';
import { NOTHING, RULES } from './lines';

export type Faction = 'garrison' | 'holdfast' | 'bureau';
/** 'confident' arrives with stage 5. Until then nobody is in it, and the professional rows cover it. */
export type ChatterState = MoraleState | 'confident';
/** For phase 2's voices (section 5.4). */
export type ChatterEmotion = 'calm' | 'urgent' | 'cocky' | 'afraid' | 'panic' | 'pain' | 'pleading' | 'defiant' | 'hushed' | 'grief';
export type ChatterChannel = 'shout' | 'radio' | 'scream';

export interface ChatterRule {
  /** Stable: 'ch.garrison.lost.pro.2'. The file name in phase 2. */
  id: string;
  concept: CommsKind;
  faction: Faction;
  /** Slots: {dead}, the man who just died. */
  text: string;
  emotion: ChatterEmotion;
  channel: ChatterChannel;
  /** Boolean facts of the moment that must hold: `dead` (a named casualty). Stage 3 adds the read's facts here. */
  when?: Readonly<Record<string, boolean>>;
  who?: {
    roles?: readonly Role[]; ranks?: readonly Rank[]; states?: readonly ChatterState[]; leader?: boolean;
    /** The speaker was the dead man's pair (4.7). */
    buddy?: boolean;
  };
  /** Ties among the most specific rows. Default 1. */
  weight?: number;
  /** Seconds before this row again. Default ROW_GAP. */
  gap?: number;
  /** Once a run. */
  once?: boolean;
}

export interface ChatterFacts {
  faction: Faction;
  state: ChatterState;
  role: Role | null;
  rank: Rank | null;
  leader: boolean;
  buddy: boolean;
  /** The moment's boolean facts, read by `when`. */
  flags: Record<string, boolean>;
}

export const ROW_GAP = 40;

/** Kinds that cut in over the side-wide line gap. A bubble of one of these is not the one a fourth line replaces. */
export const URGENT: ReadonlySet<CommsKind> = new Set<CommsKind>(['manDown', 'leaderDown', 'takingCommand', 'squadGone', 'frag', 'flash', 'surrender', 'lastStand', 'spring', 'refused', 'hostage']);

/** Rows by `faction/concept`, in table order. */
const INDEX = new Map<string, number[]>();
RULES.forEach((r, i) => {
  const key = `${r.faction}/${r.concept}`;
  let list = INDEX.get(key);
  if (!list) INDEX.set(key, list = []);
  list.push(i);
});

/** A faction with no rows of its own for a concept borrows the garrison's, until its own set is written (stage 7). */
export const rowsFor = (concept: CommsKind, faction: Faction): readonly number[] =>
  INDEX.get(`${faction}/${concept}`) ?? INDEX.get(`garrison/${concept}`) ?? [];

/** How many criteria the row has, or -1 if one fails. */
export function score(r: ChatterRule, f: ChatterFacts): number {
  let n = 0;
  const who = r.who;
  if (who) {
    if (who.states) { if (!who.states.includes(f.state)) return -1; n++; }
    if (who.roles) { if (!f.role || !who.roles.includes(f.role)) return -1; n++; }
    if (who.ranks) { if (!f.rank || !who.ranks.includes(f.rank)) return -1; n++; }
    if (who.leader !== undefined) { if (who.leader !== f.leader) return -1; n++; }
    if (who.buddy !== undefined) { if (who.buddy !== f.buddy) return -1; n++; }
  }
  if (r.when) {
    for (const key in r.when) {
      if ((f.flags[key] ?? false) !== r.when[key]) return -1;
      n++;
    }
  }
  return n;
}

/** What has been said this run. Cleared by `reset`. */
export class ChatterMemory {
  readonly lastAt = new Float64Array(RULES.length).fill(-Infinity);
  readonly said = new Uint16Array(RULES.length);

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
    for (const i of rows) {
      if (!this.open(i, now) || score(RULES[i]!, f) !== best) continue;
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
    return chosen;
  }

  private open(i: number, now: number): boolean {
    const r = RULES[i]!;
    if (r.once && this.said[i]! > 0) return false;
    return now - this.lastAt[i]! >= (r.gap ?? ROW_GAP);
  }
}

/** The row's words with its slots filled. */
export const lineText = (row: number, dead: string | null): string => RULES[row]!.text.replaceAll('{dead}', dead ?? 'him');
