import { describe, expect, it } from 'vitest';
import { crossing } from './blood';

/** Euler steps of the same motion the vertex shader evaluates in closed form. */
function simulate(h: number, hv: number, ha: number, k: number): number {
  const dt = 1e-4;
  let v = hv;
  for (let t = 0; t < 5; t += dt) {
    v += (ha - k * v) * dt;
    h += v * dt;
    if (h <= 0) return t;
  }
  return Infinity;
}

describe('crossing', () => {
  it('lands where the dragged path really lands', () => {
    expect(crossing(1.4, 3, -14, 1.5, 3)).toBeCloseTo(simulate(1.4, 3, -14, 1.5), 2);
    expect(crossing(0.6, 9, -14, 0.6, 3)).toBeCloseTo(simulate(0.6, 9, -14, 0.6), 2);
  });

  it('returns the limit when drag stops the strand short of a wall', () => {
    expect(crossing(8, -6, 0, 2, 1.6)).toBe(1.6);
  });

  it('never reports a landing for a start behind the plane', () => {
    expect(crossing(-0.1, 5, -14, 1, 1.6)).toBe(1.6);
  });
});
