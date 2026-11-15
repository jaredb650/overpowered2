/** The lab's infinite reserves: the magazine empties and reloads as normal, the reserve never goes down. */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeRange, type Range } from '../weapons/testkit';
import { holdReserves, loadSettings } from './settings';

let r: Range;
beforeEach(async () => {
  r = await makeRange();
  r.reset();
});

describe('infinite reserves', () => {
  it('lets the SMG run dry and reload, and keeps its reserve full', () => {
    const s = { ...loadSettings(), reserves: true };
    const a = r.weapons.ammo('smg');
    expect(r.weapons.current).toBe('smg');
    let emptied = false;
    let reloaded = false;
    r.input.simulate('fire', true);
    for (let i = 0; i < 4 * 60; i++) {
      r.run(1 / 60);
      holdReserves(s, r.weapons);
      if (a.mag === 0) emptied = true;
      else if (emptied) reloaded = true;
      expect(a.reserve).toBe(a.maxReserve);
    }
    r.input.simulate('fire', false);
    expect(emptied).toBe(true);
    expect(reloaded).toBe(true);
    expect(r.weapons.modifiers.bottomlessMag).toBe(false);
  });

  it('does nothing with the box off', () => {
    const a = r.weapons.ammo('smg');
    a.reserve = 10;
    holdReserves({ ...loadSettings(), reserves: false }, r.weapons);
    expect(a.reserve).toBe(10);
  });
});
