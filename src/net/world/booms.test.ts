/** The blast mirror's budget: a storm of small far blasts is thinned, and the large and the near still go out. */
import { describe, expect, it } from 'vitest';
import { BOOMS_PER_SECOND, BoomBudget, boomMatters, LARGE_RADIUS, NEAR_FLOOR, PRIORITY_PER_SECOND } from './booms';

describe('the boom budget', () => {
  it('lets a second of blasts through and then keeps only the ones that matter', () => {
    const budget = new BoomBudget();
    let small = 0;
    for (let i = 0; i < 60; i++) if (budget.spend(1000, false)) small++;
    expect(small).toBe(BOOMS_PER_SECOND);
    // The general bucket is empty: a small far blast is dropped, a large or near one still goes, from the reserve.
    expect(budget.spend(1000, false)).toBe(false);
    let kept = 0;
    for (let i = 0; i < 40; i++) if (budget.spend(1000, true)) kept++;
    expect(kept).toBe(PRIORITY_PER_SECOND);
    expect(budget.spend(1000, true)).toBe(false);
  });

  it('refills with the clock, and never past a second of blasts', () => {
    const budget = new BoomBudget();
    for (let i = 0; i < 100; i++) budget.spend(0, true);
    expect(budget.spend(0, true)).toBe(false);
    // Half a second later: half of each bucket is back.
    let through = 0;
    for (let i = 0; i < 100; i++) if (budget.spend(500, true)) through++;
    expect(through).toBe(BOOMS_PER_SECOND / 2 + PRIORITY_PER_SECOND / 2);
    // A long quiet does not save up more than a second's worth.
    through = 0;
    for (let i = 0; i < 100; i++) if (budget.spend(60_000, true)) through++;
    expect(through).toBe(BOOMS_PER_SECOND + PRIORITY_PER_SECOND);
  });

  it('a gunship run is not thinned into silence: thirty small blasts a second and four big ones, the big ones all arrive', () => {
    const budget = new BoomBudget();
    let big = 0, small = 0;
    for (let ms = 0; ms < 5000; ms += 1000 / 34) {
      const isBig = Math.round(ms / (1000 / 34)) % 8 === 0;
      if (budget.spend(ms, isBig)) isBig ? big++ : small++;
    }
    const sentBig = Math.ceil(5000 / (1000 / 34) / 8);
    expect(big).toBe(sentBig);
    expect(small).toBeGreaterThan(BOOMS_PER_SECOND * 4);
  });

  it('counts a blast as mattering when it is large or close to another player', () => {
    expect(boomMatters(LARGE_RADIUS, 500)).toBe(true);
    expect(boomMatters(1, NEAR_FLOOR)).toBe(true);
    expect(boomMatters(1, NEAR_FLOOR + 1)).toBe(false);
    // A small blast's own reach grows what counts as near.
    expect(boomMatters(4, 15.9)).toBe(true);
    expect(boomMatters(4, Infinity)).toBe(false);
  });
});
