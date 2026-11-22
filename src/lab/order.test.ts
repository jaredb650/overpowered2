/** The cheat panel's lists: alphabetical by what the buttons say, a gun's mods together. */
import { describe, expect, it } from 'vitest';
import { WEAPONS } from '../weapons/data';
import { MODS, MOD_ORDER } from '../weapons/mods';
import { byLabel } from './order';

describe('cheat panel order', () => {
  it('sorts by each part of a label in turn, ignoring case, ties by the order they came in', () => {
    expect(byLabel(['b', 'A', 'a', 'c'], s => s)).toEqual(['A', 'a', 'b', 'c']);
    expect(byLabel([['x', '2'], ['x', '10'], ['w', '9']], p => p)).toEqual([['w', '9'], ['x', '2'], ['x', '10']]);
  });

  it('puts every mod next to the other mods for its gun, guns by name, mods by name', () => {
    const list = byLabel(MOD_ORDER, id => [WEAPONS[MODS[id].weapon].name, MODS[id].name]);
    expect(list).toHaveLength(MOD_ORDER.length);
    const guns = list.map(id => WEAPONS[MODS[id].weapon].name);
    // Each gun's run of mods is one block.
    const seen = new Set<string>();
    guns.forEach((g, i) => {
      if (i > 0 && guns[i - 1] !== g) {
        expect(seen.has(g)).toBe(false);
      }
      seen.add(g);
    });
    for (let i = 1; i < list.length; i++) {
      const a = [guns[i - 1]!, MODS[list[i - 1]!].name];
      const b = [guns[i]!, MODS[list[i]!].name];
      const c = a[0]!.localeCompare(b[0]!, 'en', { sensitivity: 'base' }) || a[1]!.localeCompare(b[1]!, 'en', { sensitivity: 'base', numeric: true });
      expect(c).toBeLessThanOrEqual(0);
    }
  });
});
