/** The SMG's 50-round magazine, mag tape and stock: capacity, reload against the Gimlet's, the stock's longer breath, stacking. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ModId, WeaponId } from '../core/gameplay';
import { ADS_ZOOM, AdsZoom } from './adsZoom';
import { WEAPONS } from './data';
import { MODS, moddedDef } from './mods';
import { makeRange, type Range } from './testkit';

const smg = (...mods: ModId[]) => moddedDef('smg', new Set(mods));
const gimlet = moddedDef('gimlet', new Set<ModId>(['gimletAcog', 'gimletCan']));

describe('the numbers', () => {
  it('the long magazine holds 50, and its reload is the plain one', () => {
    expect(WEAPONS.smg.magSize).toBe(30);
    expect(smg('smgMag').magSize).toBe(50);
    expect(smg('smgMag').reloadTime).toBe(WEAPONS.smg.reloadTime);
  });

  it('mag tape reloads the SMG well inside the Gimlet, with or without the long magazine', () => {
    expect(gimlet.reloadTime).toBeCloseTo(1.02, 6);
    expect(smg('smgTape').reloadTime).toBeCloseTo(0.7, 6);
    expect(smg('smgMag', 'smgTape').reloadTime).toBeCloseTo(0.7, 6);
    for (const d of [smg('smgTape'), smg('smgMag', 'smgTape'), smg('smgMag', 'smgTape', 'suppressor', 'smgHp', 'smgStock')]) {
      expect(d.reloadTime).toBeLessThan(gimlet.reloadTime * 0.8);
    }
  });

  it('the stock holds the breath 60% longer and cools 30% sooner, and only the stock', () => {
    expect(smg('smgStock').breath).toEqual({ hold: ADS_ZOOM.hold * 1.6, cooldown: ADS_ZOOM.cooldown * 0.7 });
    expect(smg('smgMag', 'smgTape').breath).toBeUndefined();
    expect({ ...smg('smgStock'), breath: undefined }).toEqual({ ...WEAPONS.smg, breath: undefined });
  });
});

describe('the held breath with a stock', () => {
  const step = (z: AdsZoom, seconds: number, key: boolean, breath?: { hold: number; cooldown: number }) => {
    for (let t = 0; t < seconds - 1e-9; t += 1 / 60) z.update(1 / 60, true, key, breath);
  };

  it('a full breath lasts the stock\'s hold and cools for its cooldown', () => {
    const breath = smg('smgStock').breath!;
    const z = new AdsZoom();
    step(z, ADS_ZOOM.hold + 0.5, true, breath);
    expect(z.on).toBe(true);
    step(z, breath.hold - ADS_ZOOM.hold - 0.5 + 0.02, true, breath);
    expect(z.on).toBe(false);
    expect(z.cool).toBeGreaterThan(breath.cooldown - 0.05);
    expect(z.cool).toBeLessThanOrEqual(breath.cooldown);
  });

  it('without it, the plain hold and cooldown', () => {
    const z = new AdsZoom();
    step(z, ADS_ZOOM.hold + 0.05, true);
    expect(z.on).toBe(false);
    expect(z.cool).toBeGreaterThan(ADS_ZOOM.cooldown - 0.1);
  });
});

describe('in the range', () => {
  let r: Range;
  beforeEach(async () => {
    r = await makeRange();
    r.reset();
  });

  function draw(id: WeaponId): void {
    r.weapons.give(id);
    r.weapons.switchTo(id);
    r.run(0.6);
    expect(r.weapons.current).toBe(id);
  }
  function fit(id: ModId): void {
    r.weapons.grantMod(id);
    r.weapons.fitMod(id, true);
  }
  /** The magazine after `seconds` of a full reload from empty. */
  function reloadFor(id: WeaponId, seconds: number): number {
    const a = r.weapons.ammo(id);
    a.mag = 0;
    r.tap('reload');
    r.run(seconds);
    return a.mag;
  }

  it('with tape, the SMG is full while the Gimlet is still changing', () => {
    draw('gimlet');
    expect(reloadFor('gimlet', 0.85)).toBe(0);
    r.reset();
    draw('smg');
    fit('smgTape');
    expect(reloadFor('smg', 0.85)).toBe(30);
    r.reset();
    draw('smg');
    fit('smgMag');
    fit('smgTape');
    expect(reloadFor('smg', 0.85)).toBe(50);
  });

  it('all three stack with the light, the can and a round, each in its own slot', () => {
    draw('smg');
    for (const m of ['suppressor', 'smgHp', 'smgMag', 'smgTape', 'smgStock'] as const) fit(m);
    expect([...r.weapons.fitted].filter(m => MODS[m].weapon === 'smg').sort())
      .toEqual(['smgHp', 'smgLight', 'smgMag', 'smgStock', 'smgTape', 'suppressor']);
    expect(new Set([MODS.smgMag.slot, MODS.smgTape.slot, MODS.smgHp.slot]).size).toBe(3);
    expect(MODS.smgStock.slot).toBeUndefined();
  });

  it('aimed with the stock, the dash key holds the zoom past the plain cap', () => {
    draw('smg');
    fit('smgStock');
    r.weapons.aimHold = true;
    r.input.simulate('aim', true);
    r.run(0.4);
    r.input.simulate('dash', true);
    r.run(ADS_ZOOM.hold + 1);
    expect(r.weapons.adsZoom.on).toBe(true);
    r.run(1.4);
    expect(r.weapons.adsZoom.on).toBe(false);
  });
});
