/**
 * The squad's mind, after F.E.A.R. A squad does not follow a script. It holds a set of facts about the fight, wants a goal to become
 * true, and searches its drills for the cheapest chain that gets there. The same few drills then come out differently every time, because
 * the facts and the prices differ: a player who digs in gets a frag and a rush, one who runs gets cut off, one who fights gets pinned and
 * flanked. Nothing here knows what a soldier is, so a plan can be read and tested as arithmetic.
 *
 * A fact is one bit. An action needs some facts, cannot run under others, and gives more. Search is a depth-limited walk over the table
 * with no allocation: a dozen actions and four steps at most, about once a second per squad.
 */

export const LOCATED = 1 << 0; // We have a position that is worth something.
export const CONTACT = 1 << 1; // Someone had eyes on it a moment ago.
export const PINNED = 1 << 2; // Our rounds are going onto it now.
export const OPENING = 1 << 3; // Flanked, flushed, blinded or caught reloading: this is the moment to go in.
export const CAMPING = 1 << 4; // It has stayed in one place.
export const RUNNING = 1 << 5; // It is moving fast.
export const DOOR = 1 << 6; // It has gone through a door we are close to.
export const HAS_FRAG = 1 << 7;
export const HAS_FLASH = 1 << 8;
export const WAITING = 1 << 9; // Men are in place, quiet, with a door covered.
export const SAFE = 1 << 10; // Out of it, on ground we chose.
export const FORMED = 1 << 11; // Back together and ready to go again.
export const KILLED = 1 << 12; // Never true. It is what wanting the fight won looks like.
export const SHIELDED = 1 << 13; // It is holding one of ours in front of it.

export type ActionId = 'search' | 'baseOfFire' | 'flank' | 'cutOff' | 'frag' | 'flash' | 'breach' | 'rush' | 'setAmbush' | 'lieInWait' | 'retreat' | 'regroup';
export type GoalId = 'destroy' | 'survive' | 'recover' | 'waylay';

export interface PlanAction {
  readonly id: ActionId;
  readonly needs: number;
  readonly forbids: number;
  readonly gives: number;
  /** What it uses up or makes false. */
  readonly clears: number;
  /** Before this moment's prices. */
  readonly cost: number;
}

export const ACTIONS: readonly PlanAction[] = [
  { id: 'search', needs: 0, forbids: CONTACT, gives: LOCATED | CONTACT, clears: 0, cost: 2 },
  { id: 'baseOfFire', needs: LOCATED, forbids: PINNED, gives: PINNED, clears: 0, cost: 1 },
  { id: 'flank', needs: PINNED, forbids: 0, gives: OPENING, clears: 0, cost: 3 },
  { id: 'cutOff', needs: LOCATED | RUNNING, forbids: 0, gives: OPENING, clears: 0, cost: 2.5 },
  { id: 'frag', needs: LOCATED | HAS_FRAG, forbids: SHIELDED, gives: OPENING, clears: CAMPING, cost: 3.6 },
  { id: 'flash', needs: LOCATED | HAS_FLASH, forbids: 0, gives: OPENING, clears: 0, cost: 3.4 },
  { id: 'breach', needs: LOCATED | DOOR, forbids: CONTACT, gives: OPENING | CONTACT, clears: DOOR, cost: 2.5 },
  { id: 'rush', needs: OPENING, forbids: 0, gives: KILLED, clears: 0, cost: 1 },
  { id: 'setAmbush', needs: 0, forbids: CONTACT | WAITING, gives: WAITING, clears: 0, cost: 3 },
  { id: 'lieInWait', needs: WAITING, forbids: 0, gives: KILLED, clears: 0, cost: 1 },
  { id: 'retreat', needs: 0, forbids: SAFE, gives: SAFE, clears: 0, cost: 1 },
  { id: 'regroup', needs: SAFE, forbids: FORMED, gives: FORMED, clears: 0, cost: 1 },
];

export const ACTION_COUNT = ACTIONS.length;
const INDEX = new Map<ActionId, number>(ACTIONS.map((a, i) => [a.id, i]));
export const actionIndex = (id: ActionId): number => INDEX.get(id)!;

/** A squad wants the same thing in an ambush as in a fight. What differs is which drills it allows itself, and the squad's `blocked` says that. */
export const GOALS: Readonly<Record<GoalId, number>> = { destroy: KILLED, survive: SAFE, recover: FORMED, waylay: KILLED };

/** Bit per action, for a `blocked` mask. */
export const actionBit = (id: ActionId): number => 1 << INDEX.get(id)!;

/** Longest chain a squad will think through. Past this the facts will have changed anyway. */
const MAX_STEPS = 4;

const trail = new Int8Array(MAX_STEPS);
let bestCost = Infinity;
let bestLength = 0;
const best = new Int8Array(MAX_STEPS);

function walk(facts: number, wants: number, blocked: number, prices: Float32Array, depth: number, cost: number): void {
  if ((facts & wants) === wants) {
    if (cost < bestCost) {
      bestCost = cost;
      bestLength = depth;
      best.set(trail);
    }
    return;
  }
  if (depth === MAX_STEPS) return;
  for (let i = 0; i < ACTION_COUNT; i++) {
    if (blocked & (1 << i)) continue;
    const a = ACTIONS[i]!;
    if ((facts & a.needs) !== a.needs || (facts & a.forbids) !== 0) continue;
    const next = (facts | a.gives) & ~a.clears;
    if (next === facts) continue;
    const total = cost + prices[i]!;
    if (total >= bestCost) continue;
    trail[depth] = i;
    walk(next, wants, blocked, prices, depth + 1, total);
  }
}

/**
 * The cheapest chain of actions from `facts` to `wants`, written to `out` as action indexes. Returns its length, or 0 if there is no
 * way there. `blocked` is a bit per action that cannot be used right now, and `prices` holds what each costs at this moment.
 */
export function makePlan(facts: number, wants: number, blocked: number, prices: Float32Array, out: Int8Array): number {
  bestCost = Infinity;
  bestLength = 0;
  walk(facts, wants, blocked, prices, 0, 0);
  for (let i = 0; i < bestLength; i++) out[i] = best[i]!;
  return bestLength;
}

/** A price list with nothing unusual about the moment. */
export function basePrices(out: Float32Array): void {
  for (let i = 0; i < ACTION_COUNT; i++) out[i] = ACTIONS[i]!.cost;
}

export const MAX_PLAN = MAX_STEPS;
