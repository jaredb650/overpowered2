import { describe, expect, it } from 'vitest';
import {
  ACTION_COUNT, actionBit, ACTIONS, basePrices, CAMPING, CONTACT, DOOR, GOALS, HAS_FLASH, HAS_FRAG, LOCATED, makePlan, MAX_PLAN, OPENING, PINNED, RUNNING, SAFE, SHIELDED, WAITING, type ActionId,
} from './planner';
import { promoted, RANKS, RANK_ORDER, rollGrade, atLeastRegular } from './rank';

const out = new Int8Array(MAX_PLAN);
const prices = new Float32Array(ACTION_COUNT);

function plan(facts: number, goal: keyof typeof GOALS, blocked = 0, price?: Partial<Record<ActionId, number>>): ActionId[] {
  basePrices(prices);
  if (price) for (const [id, cost] of Object.entries(price)) prices[ACTIONS.findIndex(a => a.id === id)] = cost;
  const n = makePlan(facts, GOALS[goal], blocked, prices, out);
  return Array.from(out.slice(0, n), i => ACTIONS[i]!.id);
}

const noAmbush = actionBit('setAmbush') | actionBit('lieInWait') | actionBit('retreat') | actionBit('regroup');

describe('the planner', () => {
  it('goes and finds a threat it cannot see', () => {
    expect(plan(0, 'destroy', noAmbush)[0]).toBe('search');
  });

  it('pins, flanks and goes in, in that order, against a player in the open', () => {
    expect(plan(LOCATED | CONTACT, 'destroy', noAmbush)).toEqual(['baseOfFire', 'flank', 'rush']);
  });

  it('flanks straight away if the fire is already on it', () => {
    expect(plan(LOCATED | CONTACT | PINNED, 'destroy', noAmbush)).toEqual(['flank', 'rush']);
  });

  it('does not lay fire on a place nobody can see', () => {
    expect(plan(LOCATED, 'destroy', noAmbush)[0]).toBe('search');
  });

  it('flushes a player who has dug in, once the moment is priced for it', () => {
    expect(plan(LOCATED | CONTACT | CAMPING | HAS_FRAG, 'destroy', noAmbush, { frag: 1.1 })).toEqual(['frag', 'rush']);
  });

  it('will not throw a frag at one of its own in the player\'s hands', () => {
    expect(plan(LOCATED | CONTACT | CAMPING | HAS_FRAG | SHIELDED, 'destroy', noAmbush, { frag: 1.1 })).not.toContain('frag');
  });

  it('cuts off a runner', () => {
    expect(plan(LOCATED | CONTACT | RUNNING, 'destroy', noAmbush, { cutOff: 1.2 })).toEqual(['cutOff', 'rush']);
  });

  it('goes straight in on an opening', () => {
    expect(plan(LOCATED | CONTACT | OPENING, 'destroy', noAmbush)).toEqual(['rush']);
  });

  it('breaches a door the threat went through', () => {
    expect(plan(LOCATED | DOOR, 'destroy', noAmbush, { breach: 1 })[0]).toBe('breach');
  });

  it('uses a banger when the frag is gone', () => {
    expect(plan(LOCATED | CONTACT | HAS_FLASH, 'destroy', noAmbush | actionBit('flank'))).toEqual(['flash', 'rush']);
  });

  it('sets up, waits, and only then has its fight', () => {
    const others = ACTIONS.filter(a => a.id !== 'setAmbush' && a.id !== 'lieInWait').reduce((m, a) => m | actionBit(a.id), 0);
    expect(plan(LOCATED, 'waylay', others)).toEqual(['setAmbush', 'lieInWait']);
    expect(plan(LOCATED | WAITING, 'waylay', others)).toEqual(['lieInWait']);
  });

  it('runs, then forms up', () => {
    expect(plan(LOCATED | CONTACT, 'survive')).toEqual(['retreat']);
    expect(plan(LOCATED | SAFE, 'recover')).toEqual(['regroup']);
    expect(plan(LOCATED, 'recover')).toEqual(['retreat', 'regroup']);
  });

  it('takes a drill the Commander ordered over one it would have picked', () => {
    expect(plan(LOCATED | CONTACT | PINNED | HAS_FRAG, 'destroy', noAmbush, { frag: 0 })[0]).toBe('frag');
  });

  it('thinks of something else once a drill has failed', () => {
    expect(plan(LOCATED | CONTACT | PINNED | HAS_FRAG, 'destroy', noAmbush | actionBit('flank'))).toEqual(['frag', 'rush']);
  });

  it('allocates nothing and stops at four steps', () => {
    expect(plan(0, 'destroy', noAmbush).length).toBeLessThanOrEqual(MAX_PLAN);
  });
});

describe('rank', () => {
  it('runs from worst to best on every line that matters', () => {
    for (let i = 1; i < RANK_ORDER.length; i++) {
      const a = RANKS[RANK_ORDER[i - 1]!], b = RANKS[RANK_ORDER[i]!];
      expect(b.aim).toBeLessThan(a.aim);
      expect(b.lead).toBeGreaterThan(a.lead);
      expect(b.fear).toBeLessThan(a.fear);
      expect(b.signs).toBeGreaterThan(a.signs);
      expect(b.gives).toBeLessThan(a.gives);
    }
  });

  it('puts elite surrender out of reach of anything but all five signs, and then rarely', () => {
    expect(RANKS.elite.signs).toBe(5);
    expect(RANKS.elite.gives).toBeLessThan(0.1);
    expect(RANKS.conscript.gives).toBeGreaterThan(0.5);
  });

  it('sends better men later', () => {
    const seen = (level: number): Set<string> => {
      const out = new Set<string>();
      for (let i = 0; i < 200; i++) out.add(rollGrade(level, () => i / 200));
      return out;
    };
    expect(seen(1).has('elite')).toBe(false);
    expect(seen(9).has('conscript')).toBe(false);
    expect(seen(9).has('elite')).toBe(true);
  });

  it('puts a leader a step above his men and never hands a conscript a belt', () => {
    expect(promoted('regular')).toBe('veteran');
    expect(promoted('elite')).toBe('elite');
    expect(atLeastRegular('conscript')).toBe('regular');
    expect(atLeastRegular('veteran')).toBe('veteran');
  });
});
