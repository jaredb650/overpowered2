/**
 * The Commander's decisions, as plain functions: which answer comes next, and what that means for who turns up. Rule-based and
 * deliberately simple. It feels like being learned because it quotes the player back at themselves, not because it is clever.
 */
import type { EnemyId } from '../../core/gameplay';
import { ADAPTATIONS, FINAL_WAVE, phaseOf, TRICKS, type AdaptationId, type HabitId, type TrickId } from './adaptations';

/** Under this a habit is noise, and the Commander falls back on standing orders. */
const HABIT_FLOOR = 0.18;
/** Each answer already given to a habit costs it this share, so a run sees variety and not five answers to one thing. */
const REPEAT_HABIT = 0.72;
const JITTER = 0.06;
const SHARPSHOOTER = 0.8;

/**
 * What a Commander with nothing to go on does. Doctrine, not a read of this player, so it is never the same as being answered, and
 * it is why a run that shows no habits at all still sees one new thing a wave.
 */
const STANDING_ORDERS: readonly AdaptationId[] = ['mortars', 'snipers', 'mines', 'helmets', 'spread', 'jammers', 'crossfire', 'smoke', 'tripwires', 'riggedPickups'];

/** The next answer. Null only when every row has been fielded, which takes longer than a run. */
export function pickAdaptation(
  habits: Record<HabitId, number>, taken: ReadonlySet<AdaptationId>, wave: number, roll: () => number = Math.random,
): AdaptationId | null {
  // The habit first, then the next answer to it in table order, so a camper meets the mortars before the sniper.
  let best: AdaptationId | null = null;
  let bestScore = -Infinity;
  for (const habit of Object.keys(habits) as HabitId[]) {
    // Killing from a long way off is camping with better aim, and it gets the same answer.
    const strength = habit === 'camping' ? Math.max(habits.camping, habits.range * SHARPSHOOTER) : habits[habit];
    if (strength < HABIT_FLOOR) continue;
    let given = 0;
    let next: AdaptationId | null = null;
    for (const a of ADAPTATIONS) {
      if (a.habit !== habit) continue;
      if (taken.has(a.id)) given++;
      else if (!next && a.from <= wave) next = a.id;
    }
    if (!next) continue;
    const score = strength * REPEAT_HABIT ** given + roll() * JITTER;
    if (score > bestScore) {
      bestScore = score;
      best = next;
    }
  }
  if (best) return best;
  for (const id of STANDING_ORDERS) {
    const row = ADAPTATIONS.find(a => a.id === id)!;
    if (!taken.has(id) && row.from <= wave) return id;
  }
  return ADAPTATIONS.find(a => !taken.has(a.id) && a.from <= wave)?.id ?? null;
}

/** Tricks that come into play on exactly this wave. They are the humans' own, so they run on the clock and not on the player. */
export function tricksFrom(wave: number): TrickId[] {
  return TRICKS.filter(t => t.from === wave).map(t => t.id);
}

export type UnitKind = 'spotter' | 'mortar' | 'sniper' | 'jammer' | 'radio' | 'manpads' | 'hider' | 'lane' | 'bait' | 'guard' | 'possum' | 'casualty' | 'feign';

/** One squad that answers to the Commander and not to its own brain. */
export interface SquadPlan {
  /** What each seat is for, in seat order. */
  jobs: readonly UnitKind[];
  members: readonly EnemyId[];
}

const MORTAR_TEAM: SquadPlan = { jobs: ['mortar', 'mortar'], members: ['trooper', 'trooper'] };
const SPOTTER: SquadPlan = { jobs: ['spotter', 'guard'], members: ['trooper', 'trooper'] };
const SNIPER: SquadPlan = { jobs: ['sniper'], members: ['sniper'] };
const JAMMER: SquadPlan = { jobs: ['jammer', 'guard'], members: ['trooper', 'gunner'] };
const RADIO_OP: SquadPlan = { jobs: ['radio', 'guard'], members: ['trooper', 'trooper'] };
const MANPADS: SquadPlan = { jobs: ['manpads', 'guard'], members: ['rocketeer', 'trooper'] };
const HIDERS: SquadPlan = { jobs: ['hider', 'hider', 'hider'], members: ['gunner', 'trooper', 'trooper'] };
const LANE: SquadPlan = { jobs: ['lane', 'lane'], members: ['trooper', 'trooper'] };
const BAIT: SquadPlan = { jobs: ['bait', 'bait', 'bait'], members: ['trooper', 'trooper', 'trooper'] };

/**
 * Who the wave needs for everything fielded so far. Men in here come out of the wave's strength, so a Commander answering a lot of
 * things has fewer men left to fight with, which is the "fewer, better" of section 14.2 and also just true of an army losing.
 */
export function plansFor(wave: number, have: ReadonlySet<AdaptationId>, tricks: ReadonlySet<TrickId>): SquadPlan[] {
  const out: SquadPlan[] = [];
  if (have.has('mortars') || tricks.has('sacrifice') || tricks.has('dangerClose')) out.push(MORTAR_TEAM, SPOTTER);
  if (have.has('jammers')) out.push(JAMMER);
  if (have.has('radioJammer')) out.push(RADIO_OP);
  if (have.has('manpads')) out.push(MANPADS);
  if (have.has('snipers')) out.push(SNIPER);
  if (have.has('smoke')) out.push(SNIPER);
  if (have.has('crossfire') || have.has('baitPickups')) out.push(LANE);
  if (have.has('hiders')) out.push(HIDERS);
  if (tricks.has('sacrifice') && wave % 2 === 0) out.push(BAIT);
  return out;
}

/** Swaps a share of the rifles in a wave for what the adaptation fields. */
export function refit(squads: EnemyId[][], have: ReadonlySet<AdaptationId>, wave: number): void {
  if (!have.has('shotguns')) return;
  // In pairs, because one shotgun is a man and two is a door you cannot go through.
  for (const squad of squads) {
    let swapped = 0;
    for (let i = 0; i < squad.length && swapped < 2; i++) {
      if (squad[i] !== 'trooper') continue;
      squad[i] = 'gunner';
      swapped++;
    }
  }
  if (wave >= 6 && squads[0]) squads[0].push('burner');
}

export const isDesperate = (wave: number): boolean => phaseOf(wave) === 'desperation' || phaseOf(wave) === 'lastStand';
export const isFinal = (wave: number): boolean => wave >= FINAL_WAVE;
