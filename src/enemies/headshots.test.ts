import { describe, expect, it } from 'vitest';
import { headOutcome } from './damage';

describe('what a killing round does to a head', () => {
  it('leaves a hole under 40 when not heavy, and never takes the head off whole', () => {
    for (const id of ['trooper', 'gunner', 'husk', 'brute', 'stalker']) {
      expect(headOutcome(20, false, id, 0), id).toBe('hole');
      expect(headOutcome(39.9, false, id, 0.99), id).toBe('hole');
    }
  });

  it('randomly splits every head burst (heavy or >= 40) 50/50 between partial and full burst on the four', () => {
    for (const id of ['trooper', 'gunner', 'husk', 'brute']) {
      expect(headOutcome(20, true, id, 0.2), id).toBe('partial');
      expect(headOutcome(20, true, id, 0.7), id).toBe('burst');
      expect(headOutcome(40, false, id, 0.49), id).toBe('partial');
      expect(headOutcome(40, false, id, 0.5), id).toBe('burst');
      expect(headOutcome(300, true, id, 0.0), id).toBe('partial');
      expect(headOutcome(300, true, id, 0.99), id).toBe('burst');
    }
  });

  it('always full-bursts enemies without baked partial head wounds', () => {
    for (const id of ['stalker', 'hound']) {
      expect(headOutcome(20, true, id, 0.0), id).toBe('burst');
      expect(headOutcome(40, false, id, 0.1), id).toBe('burst');
      expect(headOutcome(300, true, id, 0.99), id).toBe('burst');
    }
  });
});
