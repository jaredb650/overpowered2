/**
 * Who a man is, as numbers. Rank drives how well he shoots, how much it takes to frighten him and what it takes to make him give up.
 * A squad has one grade and its leader sits a step above it, so a squad reads as a squad: conscripts spray and fold, elites do neither.
 *
 * No three.js and no game state, so the table can be read and tested on its own.
 */
export type Rank = 'conscript' | 'regular' | 'veteran' | 'elite';

export const RANK_ORDER: readonly Rank[] = ['conscript', 'regular', 'veteran', 'elite'];

export interface RankDef {
  /** How it reads on the feed. */
  label: string;
  /** Multiplies his miss radius. */
  aim: number;
  /** Share of the target's motion he allows for. Under 1 his rounds trail a runner. */
  lead: number;
  /** Multiplies how fast he becomes sure of what he sees. */
  eyes: number;
  /** Multiplies every morale loss. */
  fear: number;
  /** Multiplies his health. */
  toughness: number;
  /** Rounds this close keep his head down, whatever his orders. Above 1 nothing does. */
  pinnedAt: number;
  /** Multiplies how long his gun stays up. */
  exposure: number;
  /** Signs of a lost fight it takes before he will think of giving up. There are five. */
  signs: number;
  /** Chance he gives up once there are enough. */
  gives: number;
  /** Chance per look that a prisoner left alone goes for a gun. */
  rearms: number;
  /** Chance he tells the truth when questioned. */
  talks: number;
  /** Seconds a grenade of his still has to run once it lands. Better men hold it longer first. */
  cook: number;
  /** Seconds he will hold fire on a man shielded by one of his own. Infinity: he never will shoot through him. */
  hesitates: number;
}

export const RANKS: Record<Rank, RankDef> = {
  conscript: { label: 'Pvt', aim: 1.45, lead: 0.72, eyes: 0.8, fear: 1.3, toughness: 0.85, pinnedAt: 0.5, exposure: 0.75, signs: 2, gives: 0.7, rearms: 0.08, talks: 1, cook: 1.45, hesitates: Infinity },
  regular: { label: 'Cpl', aim: 1, lead: 0.88, eyes: 1, fear: 1, toughness: 1, pinnedAt: 0.68, exposure: 1, signs: 3, gives: 0.5, rearms: 0.16, talks: 0.85, cook: 1.1, hesitates: 6 },
  veteran: { label: 'Sgt', aim: 0.74, lead: 0.96, eyes: 1.3, fear: 0.62, toughness: 1.15, pinnedAt: 0.86, exposure: 1.2, signs: 4, gives: 0.3, rearms: 0.28, talks: 0.5, cook: 0.7, hesitates: 2.5 },
  elite: { label: 'Lt', aim: 0.52, lead: 1, eyes: 1.6, fear: 0.34, toughness: 1.35, pinnedAt: 1.1, exposure: 1.35, signs: 5, gives: 0.06, rearms: 0.4, talks: 0.15, cook: 0.45, hesitates: 0.6 },
};

/** Odds of each grade by threat level, worst first in the list of bands. Each row is conscript, regular, veteran, elite. */
const GRADE_ODDS: readonly (readonly [from: number, odds: readonly [number, number, number, number]])[] = [
  [9, [0, 0.25, 0.45, 0.3]],
  [7, [0, 0.35, 0.45, 0.2]],
  [5, [0.1, 0.45, 0.35, 0.1]],
  [3, [0.25, 0.5, 0.25, 0]],
  [1, [0.55, 0.4, 0.05, 0]],
];

/** A squad's grade for this threat level. */
export function rollGrade(level: number, roll: () => number = Math.random): Rank {
  const odds = (GRADE_ODDS.find(r => level >= r[0]) ?? GRADE_ODDS[GRADE_ODDS.length - 1]!)[1];
  let r = roll();
  for (let i = 0; i < odds.length; i++) {
    r -= odds[i]!;
    if (r <= 0) return RANK_ORDER[i]!;
  }
  return 'regular';
}

/** One step up, for whoever leads. */
export const promoted = (rank: Rank): Rank => RANK_ORDER[Math.min(RANK_ORDER.indexOf(rank) + 1, RANK_ORDER.length - 1)]!;

/** Men trusted with a belt or a long rifle have been through training at the least. */
export const atLeastRegular = (rank: Rank): Rank => (rank === 'conscript' ? 'regular' : rank);
