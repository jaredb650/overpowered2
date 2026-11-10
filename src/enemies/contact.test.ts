/** Running into a body: how hard the hit is, and whether it goes down. The rest of contact is the lab's (`lab-contact.mjs`). */
import { describe, expect, it } from 'vitest';
import { ENEMIES } from './data';
import { CHECK_MIN, checkStrength } from './contact';

const mass = (id: keyof typeof ENEMIES) => ENEMIES[id].mass;

describe('body check', () => {
  it('a sprint knocks a light body off its feet, and a run only staggers it', () => {
    expect(checkStrength(12.5, mass('husk'), false)).toBeGreaterThanOrEqual(CHECK_MIN);
    expect(checkStrength(12.5, mass('trooper'), false)).toBeGreaterThanOrEqual(CHECK_MIN);
    expect(checkStrength(9.2, mass('husk'), false)).toBeLessThan(CHECK_MIN);
  });

  it('a Riot goes down at a sprint, and a Brute never does, running or sliding', () => {
    expect(mass('riot')).toBe(0.35);
    expect(checkStrength(12.5, mass('riot'), false)).toBeGreaterThanOrEqual(CHECK_MIN);
    for (let closing = 0; closing <= 30; closing += 0.5) {
      expect(checkStrength(closing, mass('brute'), false)).toBeLessThan(CHECK_MIN);
      expect(checkStrength(closing, mass('brute'), true)).toBeLessThan(CHECK_MIN);
    }
  });

  it('a slide sweeps the legs of a light body at 10 m/s, where a run that fast does not', () => {
    expect(checkStrength(10, mass('husk'), true)).toBeGreaterThanOrEqual(CHECK_MIN);
    expect(checkStrength(10, mass('husk'), false)).toBeLessThan(CHECK_MIN);
  });

  it('a slide past a body, or one it walks into from the side, does not sweep it', () => {
    // A husk 0.7 m beside a 10 m/s slide: first touched at its reach of 0.87 m, closing at 5.9.
    const reach = (ENEMIES.husk.contactRadius ?? ENEMIES.husk.radius) + 0.45;
    const closing = 10 * Math.sqrt(1 - (0.7 / reach) ** 2);
    expect(checkStrength(closing, mass('husk'), true)).toBeLessThan(CHECK_MIN);
    expect(checkStrength(0, mass('husk'), true)).toBe(0);
    expect(checkStrength(-3, mass('husk'), true)).toBe(0);
  });

  it('grows with speed and stays inside 0..1', () => {
    let last = -1;
    for (let closing = 0; closing <= 30; closing += 0.5) {
      const s = checkStrength(closing, 0, true);
      expect(s).toBeGreaterThanOrEqual(last);
      expect(s).toBeLessThanOrEqual(1);
      last = s;
    }
  });
});
