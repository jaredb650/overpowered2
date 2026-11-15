import { describe, expect, it } from 'vitest';
import { VaporBudget } from './sabot';

describe('VaporBudget', () => {
  it('grants up to the cap, then thins newer wakes until older ones die', () => {
    const b = new VaporBudget(200, 3);
    expect(b.take(0, 90)).toBe(90);
    expect(b.take(0.45, 90)).toBe(90);
    expect(b.take(0.9, 90)).toBe(20);
    expect(b.take(1.35, 90)).toBe(0);
    // The first wake has gone by 3 s.
    expect(b.take(3.1, 90)).toBe(90);
  });

  it('forgets wakes from before the fx clock went back to zero', () => {
    const b = new VaporBudget(100, 3);
    expect(b.take(500, 100)).toBe(100);
    expect(b.take(0.1, 100)).toBe(100);
  });
});
