/** The autocannon's flak shells (flak.ts, the `autocannonFlak` mod): the proximity fuze, the cone, and the shop's row. */
import { beforeEach, describe, expect, it } from 'vitest';
import { MOD_WARES, modWares } from '../contracts/shop/data';
import { FINAL_WAVE } from '../enemies/commander/adaptations';
import { FLAK, flakFired, flakFuze } from './flak';
import { MODS, MOD_ORDER, moddedDef } from './mods';
import { makeRange, type Range } from './testkit';

describe('the flak fuze', () => {
  it('bursts `fuze` short of a man on the line, and further back off one beside it so the cone still takes him in', () => {
    expect(flakFuze(5, Infinity, 4, 0)).toBeCloseTo(4 - FLAK.fuze);
    const beside = flakFuze(8, Infinity, 7, 1.8);
    expect(beside).toBeLessThan(7 - FLAK.fuze);
    // Where it bursts, he stands inside the cone.
    expect(Math.atan2(1.8, 7 - beside)).toBeLessThan(FLAK.cone);
  });

  it('flies on past a man too far off the line, and through a step that has nobody in reach', () => {
    expect(flakFuze(5, Infinity, 4, FLAK.prox + 0.1)).toBe(-1);
    expect(flakFuze(3, Infinity, 9, 0)).toBe(-1);
    expect(flakFuze(3, Infinity, Infinity, 0)).toBe(-1);
  });

  it('goes off `wall` short of a surface, at once when already that close', () => {
    expect(flakFuze(4, 3.5, Infinity, 0)).toBeCloseTo(3.5 - FLAK.wall);
    expect(flakFuze(4, 0.5, Infinity, 0)).toBe(0);
  });
});

describe('flak shells in the autocannon', () => {
  let r: Range;
  beforeEach(async () => {
    r = await makeRange();
    r.reset();
  });

  function fire(flak = true): void {
    r.weapons.give('autocannon');
    if (flak) {
      r.weapons.grantMod('autocannonFlak');
      expect(r.weapons.fitMod('autocannonFlak', true)).toBe(true);
    }
    r.weapons.switchTo('autocannon');
    r.run(0.6);
    r.tap('fire');
    r.run(0.4);
  }

  it('bursts in the air in front of the man it was fired at and shreds him with pellets, no instakill', () => {
    // Tough enough to count every fragment: a real man is dead by the third.
    const man = r.enemies.add(0, -15, 1e5);
    fire();
    expect(r.record.blasts.length).toBe(1);
    const burst = r.record.blasts[0]!;
    // Short of him, in the air on the line, not on him.
    expect(burst.z).toBeGreaterThan(-15 + FLAK.fuze - 0.5);
    expect(burst.z).toBeLessThan(-15 + FLAK.fuze + 3.5);
    const pellets = man.hits.filter(h => h.type === 'pellet');
    expect(pellets.length).toBeGreaterThan(4);
    expect(pellets.reduce((sum, h) => sum + h.amount, 0)).toBeGreaterThan(700);
    expect(man.hits.every(h => h.amount < 1000)).toBe(true);
    expect(flakFired.aimed).toBeGreaterThan(0);
    expect(flakFired.cone).toBe(FLAK.pellets);
  });

  it('clears the cone behind the burst and leaves a man well off to the side alone', () => {
    const lead = r.enemies.add(0, -10, 1e5);
    const cone = [r.enemies.add(-1.5, -15, 1e5), r.enemies.add(1.5, -16, 1e5), r.enemies.add(0, -18, 1e5), r.enemies.add(-2, -20, 1e5)];
    const aside = r.enemies.add(12, -10, 1e5);
    fire();
    expect(lead.hits.some(h => h.type === 'pellet')).toBe(true);
    for (const m of cone) expect(m.hits.some(h => h.type === 'pellet')).toBe(true);
    expect(aside.hits.length).toBe(0);
  });

  it('goes off a metre short of a wall', () => {
    r.wall(-12, 1);
    fire();
    expect(r.record.blasts.length).toBe(1);
    // The wall's near face is at -12.
    expect(r.record.blasts[0]!.z).toBeCloseTo(-12 + FLAK.wall, 0);
  });

  it('taken off, the shell is the instakill one again', () => {
    const man = r.enemies.add(0, -15, 400);
    fire(false);
    expect(man.hits.some(h => h.amount >= 99999)).toBe(true);
    expect(man.hits.some(h => h.type === 'pellet')).toBe(false);
  });
});

describe('the flak mod in the shop and the lab', () => {
  it('is the autocannon\'s, and fitted it makes every shell flak', () => {
    expect(MODS.autocannonFlak.weapon).toBe('autocannon');
    expect(moddedDef('autocannon', new Set(['autocannonFlak'])).flak).toBe(true);
    expect(moddedDef('autocannon', new Set()).flak).toBeUndefined();
    // The lab's cheat rows are MOD_ORDER's.
    expect(MOD_ORDER).toContain('autocannonFlak');
  });

  it('is sold with a lock that lands by the ninth break in Endless Humans', () => {
    expect(MOD_WARES.autocannonFlak.price).toBeGreaterThan(0);
    expect(modWares('outpost').autocannonFlak.wave).toBeLessThanOrEqual(FINAL_WAVE - 1);
  });
});
