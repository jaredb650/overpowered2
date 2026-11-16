/** The Ultramag's mods: a suppressor, a reflex sight, a laser module and an extended magazine, all four on at once. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ModId } from '../core/gameplay';
import { MOD_WARES } from '../contracts/shop/data';
import { WEAPONS } from './data';
import { MODS, MOD_ORDER, moddedDef } from './mods';
import { makeRange, type Range } from './testkit';

const KIT: readonly ModId[] = ['ultramagCan', 'ultramagDot', 'ultramagLam', 'ultramagMag'];

let r: Range;
beforeEach(async () => {
  r = await makeRange();
  r.reset();
});

function draw(): void {
  r.weapons.give('ultramag');
  r.weapons.switchTo('ultramag');
  r.run(0.6);
  expect(r.weapons.current).toBe('ultramag');
}

function fit(ids: readonly ModId[]): void {
  for (const id of ids) {
    r.weapons.grantMod(id);
    expect(r.weapons.fitMod(id, true), id).toBe(true);
  }
}

/** Shots the Ultramag has played, bare and suppressed. */
const shots = () => r.record.sounds.filter(s => s === 'ultramag_shot' || s === 'ultramag_suppressed_shot').length;

describe('the Ultramag mods on paper', () => {
  it('are the Ultramag\'s, sold in the shop and listed for the cheat panel', () => {
    for (const id of KIT) {
      expect(MODS[id].weapon).toBe('ultramag');
      expect(MOD_ORDER).toContain(id);
      expect(MOD_WARES[id].price).toBeGreaterThan(0);
      expect(MOD_WARES[id].lore.length).toBeGreaterThan(40);
    }
  });

  it('change what each says and nothing else: a can, a sight, a quarter faster, eleven rounds', () => {
    const bare = WEAPONS.ultramag;
    const can = moddedDef('ultramag', new Set(['ultramagCan']));
    expect(can.muzzle).toBe('suppressed');
    expect(can.sounds[0]!.id).toBe('ultramag_suppressed_shot');
    expect(can.damage).toBe(bare.damage);
    expect(moddedDef('ultramag', new Set(['ultramagDot']))).toEqual(bare);
    expect(MODS.ultramagDot.slot).toBe('sight');
    const lam = moddedDef('ultramag', new Set(['ultramagLam']));
    expect(60 / lam.interval).toBeCloseTo((60 / bare.interval) * 1.25);
    expect(lam.mode).toBe('semi');
    expect(moddedDef('ultramag', new Set(['ultramagMag'])).magSize).toBe(11);
    expect(bare.magSize).toBe(7);
  });

  it('stack: all four on together, with a kind of round in its own slot', () => {
    const all = moddedDef('ultramag', new Set([...KIT, 'ultramagAp']));
    expect(all.muzzle).toBe('suppressed');
    expect(all.interval).toBeCloseTo(WEAPONS.ultramag.interval / 1.25);
    expect(all.magSize).toBe(11);
    expect(all.load).toBe('ap');
    for (const id of KIT) expect(MODS[id].slot === undefined || MODS[id].slot === 'sight').toBe(true);
  });
});

describe('the Ultramag mods in the hand', () => {
  it('fits all four and a kind of round at once, and none takes another off', () => {
    draw();
    fit([...KIT, 'ultramagHp']);
    for (const id of [...KIT, 'ultramagHp'] as ModId[]) expect(r.weapons.fitted.has(id), id).toBe(true);
  });

  it('fires the suppressed shot through the can', () => {
    draw();
    fit(['ultramagCan']);
    r.tap('fire');
    r.run(0.05);
    expect(r.record.sounds).toContain('ultramag_suppressed_shot');
    expect(r.record.sounds).not.toContain('ultramag_shot');
  });

  it('takes a second click about 0.3 s after the first with the laser module (0.288 s), and not without it (0.36 s)', () => {
    for (const lam of [false, true]) {
      r.reset();
      draw();
      if (lam) fit(['ultramagLam']);
      const before = shots();
      // The taps' own frames make the gap 0.27 s and two frames: past 0.288, short of 0.36.
      r.tap('fire');
      r.run(0.27);
      r.tap('fire');
      r.run(1 / 60);
      expect(shots() - before, lam ? 'with the module' : 'bare').toBe(lam ? 2 : 1);
      r.run(0.5);
    }
  });
});
