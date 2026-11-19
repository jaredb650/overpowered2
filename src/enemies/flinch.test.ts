/** How big a hit's flinch is (the gore update's R1): by the weapon as well as the health it took, with a floor. */
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_FORCE } from '../core/contracts';
import { DevFlags } from '../core/devflags';
import { WEAPONS } from '../weapons/data';
import { FLINCH_FLOOR, flinchSize } from './damage';
import { ENEMIES } from './data';

afterEach(() => {
  DevFlags.flinch = true;
});

const round = (weapon: keyof typeof WEAPONS, enemy: keyof typeof ENEMIES) => {
  const w = WEAPONS[weapon];
  const type = w.pellets > 1 ? 'pellet' as const : 'bullet' as const;
  return flinchSize(w.damage / ENEMIES[enemy].hp, false, w.force || DEFAULT_FORCE[type], type);
};

describe('the size of a flinch', () => {
  it('has a floor by how hard the weapon pushes, so a big body cannot shrink it to nothing', () => {
    // An SMG round takes a tenth of a Brute: 0.41 before, a 3 degree nod.
    expect(round('smg', 'brute')).toBeGreaterThanOrEqual(FLINCH_FLOOR.mid);
    expect(round('rivet', 'brute')).toBeGreaterThanOrEqual(FLINCH_FLOOR.light);
    expect(round('judge', 'brute')).toBeGreaterThanOrEqual(FLINCH_FLOOR.heavy);
    expect(round('rivet', 'brute')).toBeLessThan(round('smg', 'brute'));
    expect(round('smg', 'brute')).toBeLessThan(round('judge', 'brute'));
    // Every gun in the game is at or over the lightest floor on every body, the Juggernaut included.
    for (const id of Object.keys(WEAPONS) as (keyof typeof WEAPONS)[]) {
      const w = WEAPONS[id];
      if (w.mode === 'stream' || w.mode === 'melee') continue;
      expect(round(id, 'juggernaut'), id).toBeGreaterThanOrEqual(w.pellets > 1 ? FLINCH_FLOOR.pellet : FLINCH_FLOOR.light);
    }
  });

  it('still grows with the share of health a round took, up to a ceiling', () => {
    expect(round('smg', 'husk')).toBeGreaterThan(round('smg', 'trooper'));
    expect(flinchSize(1, false, 300, 'bullet')).toBe(FLINCH_FLOOR.max);
  });

  it('gives each pellet of a shell a small floor, since they land together', () => {
    expect(round('shotgun', 'brute')).toBeGreaterThanOrEqual(FLINCH_FLOOR.pellet);
    expect(round('shotgun', 'brute') * WEAPONS.shotgun.pellets).toBeGreaterThan(round('judge', 'brute'));
    expect(round('shotgun', 'brute')).toBeLessThan(FLINCH_FLOOR.light);
  });

  it('leaves fire, shock, bleeding and machines as they were', () => {
    // The flamethrower bites thirty times a second: a floor on each would hold a burning man bent double.
    expect(flinchSize(9 / 70, false, 1, 'fire')).toBeCloseTo(0.2 + 2.2 * (9 / 70), 5);
    expect(flinchSize(0.05, false, 15, 'shock')).toBeCloseTo(0.31, 5);
    expect(flinchSize(0.05, false, 10, 'true')).toBeCloseTo(0.31, 5);
    expect(flinchSize(0.1, true, 20, 'bullet')).toBeCloseTo(0.65, 5);
  });

  it('is the size from before the update with the switch off', () => {
    DevFlags.flinch = false;
    expect(round('smg', 'brute')).toBeCloseTo(0.2 + 2.2 * (25 / 260), 5);
    expect(round('smg', 'trooper')).toBeCloseTo(0.2 + 2.2 * (25 / 70), 5);
  });
});
