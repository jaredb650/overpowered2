/** The heavy guns' mods: the Trommel's 12 mm rechamber and the Sabot's muzzle brake (mods.ts). */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ModId, WeaponId } from '../core/gameplay';
import { WEAPONS } from './data';
import { moddedDef } from './mods';
import { makeRange, type Range } from './testkit';

const rotary = WEAPONS.buzzsaw;
const hmg = WEAPONS.piledriver;

let r: Range;
beforeEach(async () => {
  r = await makeRange();
  r.reset();
});

function drawWith(id: WeaponId, mod?: ModId): void {
  r.weapons.give(id);
  if (mod) {
    r.weapons.grantMod(mod);
    expect(r.weapons.fitMod(mod, true)).toBe(true);
  }
  r.weapons.switchTo(id);
  r.run(0.6);
  expect(r.weapons.current).toBe(id);
}

describe('the Trommel\'s 12 mm rechamber', () => {
  it('is the Piledriver\'s round at the Trommel\'s rate and spin', () => {
    const d = moddedDef('buzzsaw', new Set(['trommel12']));
    expect(d.interval).toBe(rotary.interval);
    expect(d.mode).toBe('spin');
    expect(d.damage).toBe(hmg.damage);
    expect(d.penetration).toBe(hmg.penetration);
    expect(d.severMult).toBe(hmg.severMult);
    expect(d.burst).toBeUndefined();
    expect(d.loopPitch).toBeLessThan(1);
  });

  it('goes on through the first man into the one behind him, and nothing bursts', () => {
    const front = r.enemies.add(0, -10);
    const behind = r.enemies.add(0, -12);
    drawWith('buzzsaw', 'trommel12');
    r.weapons.modifiers.bottomlessMag = true;
    let fired = 0;
    const off = r.ctx.events.on('weapon:fired', () => { fired++; });
    r.input.simulate('fire', true);
    r.run(1);
    fired = 0;
    r.run(1);
    r.input.simulate('fire', false);
    off();
    // The Trommel's rate.
    expect(fired).toBeGreaterThan(1 / rotary.interval - 2);
    expect(behind.hits.length).toBeGreaterThan(0);
    expect(Math.max(...front.hits.map(h => h.amount))).toBeGreaterThanOrEqual(hmg.damage * 0.99);
    expect(r.combat.bursts.stats.bursts).toBe(0);
  });

  it('taken off, the cannon round stops in the first man again', () => {
    r.enemies.add(0, -10);
    const behind = r.enemies.add(0, -12);
    drawWith('buzzsaw', 'trommel12');
    r.weapons.fitMod('trommel12', false);
    r.input.simulate('fire', true);
    r.run(1.5);
    r.input.simulate('fire', false);
    expect(behind.hits.length).toBe(0);
  });
});

describe('the Sabot\'s muzzle brake', () => {
  /** The shortest gap between two darts with the trigger worked as fast as it goes. */
  function quickest(): number {
    r.weapons.modifiers.bottomlessMag = true;
    const at: number[] = [];
    const off = r.ctx.events.on('weapon:fired', () => { at.push(r.ctx.time.elapsed); });
    for (let i = 0; i < 60; i++) r.tap('fire');
    off();
    expect(at.length).toBeGreaterThan(3);
    return Math.min(...at.slice(1).map((t, i) => t - at[i]!));
  }

  it('fires a quarter faster, and nothing else about the dart changes', () => {
    const d = moddedDef('sabot', new Set(['sabotBrake']));
    expect(1 / d.interval).toBeCloseTo(1.25 / WEAPONS.sabot.interval, 5);
    expect({ ...d, interval: 0 }).toEqual({ ...WEAPONS.sabot, interval: 0 });
    drawWith('sabot');
    const bare = quickest();
    r.reset();
    drawWith('sabot', 'sabotBrake');
    const braked = quickest();
    expect(bare).toBeCloseTo(WEAPONS.sabot.interval, 1);
    expect(braked).toBeCloseTo(d.interval, 1);
    expect(braked).toBeLessThan(bare - 0.05);
  });

  it('stacks with the Raufoss rounds', () => {
    r.weapons.grantMod('raufoss');
    r.weapons.grantMod('sabotBrake');
    r.weapons.fitMod('raufoss', true);
    r.weapons.fitMod('sabotBrake', true);
    expect(r.weapons.fitted.has('raufoss') && r.weapons.fitted.has('sabotBrake')).toBe(true);
    const d = moddedDef('sabot', r.weapons.fitted);
    expect(d.raufoss).toBe(true);
    expect(d.interval).toBeCloseTo(WEAPONS.sabot.interval / 1.25, 5);
  });
});
