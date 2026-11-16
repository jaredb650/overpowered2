/** The lab's weapon mod rows: grant, fit and remove, anywhere, with no shop. */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeRange, type Range } from '../weapons/testkit';
import { modCheat } from './mods';

let r: Range;
beforeEach(async () => {
  r = await makeRange();
  r.reset();
});

describe('mod cheat rows', () => {
  it('grants a mod unfitted, fits it, and takes it off', () => {
    const w = r.weapons;
    modCheat(w, 'reddot', 'grant');
    expect(w.mods.has('reddot')).toBe(true);
    expect(w.fitted.has('reddot')).toBe(false);
    modCheat(w, 'reddot', 'fit');
    expect(w.fitted.has('reddot')).toBe(true);
    modCheat(w, 'reddot', 'fit');
    expect(w.fitted.has('reddot')).toBe(false);
    expect(w.mods.has('reddot')).toBe(true);
  });

  it('fits one not held by granting it first, and the gun fires it', () => {
    const w = r.weapons;
    modCheat(w, 'raufoss', 'fit');
    expect(w.mods.has('raufoss')).toBe(true);
    expect(w.fitted.has('raufoss')).toBe(true);
    w.switchTo('sabot');
    r.run(0.6);
    expect(w.ammoMode).toBe('RAUFOSS');
  });

  it('fits an ammo mod, and fitting HP takes AP off its gun', () => {
    const w = r.weapons;
    modCheat(w, 'harrowAp', 'fit');
    modCheat(w, 'harrowHp', 'fit');
    expect(w.fitted.has('harrowHp')).toBe(true);
    expect(w.fitted.has('harrowAp')).toBe(false);
    expect(w.mods.has('harrowAp')).toBe(true);
  });

  it('fits the Autoraffica\'s extended magazine from its row: 30 rounds a magazine, and off again', () => {
    const w = r.weapons;
    modCheat(w, 'autorafficaMag', 'fit');
    expect(w.fitted.has('autorafficaMag')).toBe(true);
    expect(w.ammo('autoraffica').magSize).toBe(30);
    modCheat(w, 'autorafficaMag', 'fit');
    expect(w.ammo('autoraffica').magSize).toBe(21);
  });
});
