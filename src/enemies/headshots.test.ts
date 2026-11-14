import { describe, expect, it } from 'vitest';
import { headOutcome } from './damage';

describe('what a killing round does to a head', () => {
  it('leaves a hole under 40, bursts the very damaging, and never takes it off whole', () => {
    for (const id of ['trooper', 'husk', 'stalker']) {
      expect(headOutcome(20, false, id), id).toBe('hole');
      expect(headOutcome(39.9, false, id), id).toBe('hole');
      expect(headOutcome(20, true, id), id).toBe('burst');
      expect(headOutcome(300, true, id), id).toBe('burst');
    }
  });

  it('a severe round is a partial wound on the four, a burst on everyone else', () => {
    for (const id of ['trooper', 'gunner', 'husk', 'brute']) expect(headOutcome(40, false, id), id).toBe('partial');
    expect(headOutcome(40, false, 'stalker')).toBe('burst');
  });
});
