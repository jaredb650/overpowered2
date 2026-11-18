/** The akimbo mod (mods.ts AKIMBO_GUNS): two guns fired in turn, two magazines, twice the reload, and a zoom for ADS. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ModId, WeaponId } from '../core/gameplay';
import { MOD_WARES, modWares } from '../contracts/shop/data';
import { FINAL_WAVE } from '../enemies/commander/adaptations';
import { WEAPONS } from './data';
import { AKIMBO_ADS, AKIMBO_GUNS, MODS, MOD_ORDER, akimboOf, moddedDef } from './mods';
import { makeRange, type Range } from './testkit';

let r: Range;
/** Each shot's hand, as the viewmodel heard it: true is the left gun. */
let hands: boolean[];
let reloadSeconds: number[];
let camAim: number[];
let vmAim: number[];
beforeEach(async () => {
  r = await makeRange();
  r.reset();
  hands = [];
  reloadSeconds = [];
  camAim = [];
  vmAim = [];
  const vm = r.ctx.viewmodel as unknown as Record<string, unknown>;
  vm.fire = (_s: number, left = false) => hands.push(left);
  vm.reload = (s: number) => reloadSeconds.push(s);
  vm.setAim = (w: number) => vmAim.push(w);
  (r.ctx.camera as unknown as Record<string, unknown>).setAim = (fov: number) => camAim.push(fov);
});

function draw(id: WeaponId, akimbo = true): void {
  r.weapons.give(id);
  r.weapons.switchTo(id);
  if (akimbo) {
    r.weapons.grantMod(akimboOf(id as (typeof AKIMBO_GUNS)[number]));
    expect(r.weapons.fitMod(akimboOf(id as (typeof AKIMBO_GUNS)[number]), true)).toBe(true);
  }
  r.run(0.6);
  r.weapons.refillMagazines();
  hands.length = 0;
}

/** Hold R past the smart aim's hold: it switches on, and the locks are taken. */
function smartOn(): void {
  r.input.simulate('reload', true);
  r.run(WEAPONS.autoraffica.smart!.hold + 0.1);
  r.input.simulate('reload', false);
  r.run(0.1);
}

describe('akimbo on paper', () => {
  it('fits the SMG and every pistol, each with a shop row that lands by the break after wave 9 in Endless Humans', () => {
    expect([...AKIMBO_GUNS].sort()).toEqual(['autoraffica', 'judge', 'rivet', 'smg', 'ultramag']);
    // Every slot-6 gun is a pistol: none left out.
    for (const id of Object.keys(WEAPONS) as WeaponId[]) if (WEAPONS[id].slot === 6) expect(AKIMBO_GUNS).toContain(id);
    const endless = modWares('outpost');
    for (const gun of AKIMBO_GUNS) {
      const id = akimboOf(gun);
      expect(MODS[id].weapon).toBe(gun);
      expect(MOD_ORDER).toContain(id);
      expect(MOD_WARES[id].price).toBeGreaterThanOrEqual(900);
      expect(MOD_WARES[id].lore.length).toBeGreaterThan(40);
      expect(endless[id].wave).toBeLessThanOrEqual(FINAL_WAVE - 1);
    }
  });

  it('doubles the magazine and the reload, after any magazine mod, and gives the zoom', () => {
    for (const gun of AKIMBO_GUNS) {
      const two = moddedDef(gun, new Set([akimboOf(gun)]));
      expect(two.akimbo).toBe(true);
      expect(two.magSize).toBe(WEAPONS[gun].magSize * 2);
      expect(two.reloadTime).toBeCloseTo(WEAPONS[gun].reloadTime * 2);
      expect(two.ads).toEqual(AKIMBO_ADS);
      // No spread is added or touched.
      expect(two.spread).toBe(WEAPONS[gun].spread);
    }
    expect(moddedDef('rivet', new Set<ModId>(['rivetMag', 'rivetAkimbo'])).magSize).toBe(44);
  });

  it('keeps the SMG\'s mag tape: 30% off the doubled reload, on the long magazine too', () => {
    const two = moddedDef('smg', new Set<ModId>(['smgAkimbo']));
    const taped = moddedDef('smg', new Set<ModId>(['smgAkimbo', 'smgTape']));
    expect(taped.reloadTime).toBeCloseTo(two.reloadTime * 0.7);
    expect(taped.reloadTime).toBeCloseTo(WEAPONS.smg.reloadTime * 2 * 0.7);
    const long = moddedDef('smg', new Set<ModId>(['smgAkimbo', 'smgMag', 'smgTape']));
    expect(long.magSize).toBe(100);
    expect(long.reloadTime).toBeCloseTo(moddedDef('smg', new Set<ModId>(['smgMag'])).reloadTime * 2 * 0.7);
  });

  it('keeps the Ultramag\'s reflex sight on, for the look: it aims nothing, and no other akimbo gun has an optic to lose', () => {
    draw('ultramag', false);
    for (const id of ['ultramagDot', 'ultramagAkimbo', 'ultramagLam', 'ultramagCan'] as ModId[]) r.weapons.grantMod(id);
    r.weapons.fitMod('ultramagDot', true);
    r.weapons.fitMod('ultramagLam', true);
    r.weapons.fitMod('ultramagAkimbo', true);
    expect(r.weapons.fitted.has('ultramagDot')).toBe(true);
    expect(r.weapons.fitted.has('ultramagLam')).toBe(true);
    r.weapons.fitMod('ultramagDot', false);
    r.weapons.fitMod('ultramagDot', true);
    expect(r.weapons.fitted.has('ultramagAkimbo')).toBe(true);
    // The dot changes nothing in the row: akimbo's zoom with the guns at the hip, with it or without.
    expect(moddedDef('ultramag', new Set<ModId>(['ultramagAkimbo', 'ultramagDot']))).toEqual(moddedDef('ultramag', new Set<ModId>(['ultramagAkimbo'])));
    // Akimbo still holds the optic slot, and on these five guns nothing else is in it.
    for (const gun of AKIMBO_GUNS) {
      const optics = MOD_ORDER.filter(m => MODS[m].weapon === gun && MODS[m].slot === 'sight');
      expect(optics, gun).toEqual([`${gun}Akimbo`]);
    }
  });
});

describe('akimbo in the hand', () => {
  it('fires the SMGs in turn at twice the rate on one held left click', () => {
    draw('smg', false);
    r.input.simulate('fire', true);
    r.run(0.3);
    r.input.simulate('fire', false);
    const one = hands.length;
    expect(hands.every(left => !left)).toBe(true);
    r.reset();
    draw('smg');
    expect(r.weapons.akimbo).toBe(true);
    r.input.simulate('fire', true);
    r.run(0.3);
    r.input.simulate('fire', false);
    expect(hands.length).toBeGreaterThanOrEqual(one * 2 - 1);
    expect(hands.length).toBeLessThanOrEqual(one * 2 + 1);
    for (let i = 1; i < hands.length; i++) expect(hands[i]).toBe(!hands[i - 1]);
  });

  it('fires a pistol\'s clicks from alternate hands, twice as fast', () => {
    draw('ultramag');
    for (let i = 0; i < 4; i++) {
      r.tap('fire');
      r.run(WEAPONS.ultramag.interval / 2);
    }
    expect(hands).toEqual([false, true, false, true]);
    expect(r.weapons.ammo('ultramag').mag).toBe(14 - 4);
  });

  it('holds two magazines, and a reload fills both in twice the time', () => {
    draw('smg');
    const a = r.weapons.ammo('smg');
    expect(a.magSize).toBe(60);
    expect(a.mag).toBe(60);
    a.mag = 10;
    r.tap('reload');
    expect(reloadSeconds.at(-1)).toBeCloseTo(WEAPONS.smg.reloadTime * 2);
    r.run(WEAPONS.smg.reloadTime * 1.5);
    expect(r.weapons.reloading).toBe(true);
    r.run(WEAPONS.smg.reloadTime * 0.6);
    expect(r.weapons.reloading).toBe(false);
    expect(a.mag).toBe(60);
  });

  it('reloads the taped pair in the taped time', () => {
    draw('smg');
    r.weapons.grantMod('smgTape');
    r.weapons.fitMod('smgTape', true);
    r.weapons.ammo('smg').mag = 5;
    r.tap('reload');
    expect(reloadSeconds.at(-1)).toBeCloseTo(WEAPONS.smg.reloadTime * 2 * 0.7);
  });

  it('aims as a zoom only: the view narrows and the guns stay at the hip, held or toggled', () => {
    draw('rivet');
    for (const hold of [true, false]) {
      r.weapons.aimHold = hold;
      camAim.length = vmAim.length = 0;
      if (hold) r.input.simulate('aim', true);
      else r.tap('aim');
      r.run(0.4);
      expect(camAim.at(-1)).toBeCloseTo(1 - AKIMBO_ADS.zoom);
      expect(Math.max(...vmAim)).toBe(0);
      if (hold) r.input.simulate('aim', false);
      else r.tap('aim');
      r.run(0.4);
      expect(camAim.at(-1)).toBeCloseTo(1);
    }
    // Without akimbo the same gun comes up to the eye.
    r.reset();
    draw('rivet', false);
    r.weapons.aimHold = true;
    r.input.simulate('aim', true);
    r.run(0.4);
    expect(vmAim.at(-1)).toBeCloseTo(1);
  });

  it('gives the Judge a zoom on right click instead of the fan', () => {
    draw('judge');
    r.weapons.aimHold = true;
    r.input.simulate('aim', true);
    r.run(0.6);
    expect(r.weapons.charge).toBe(0);
    expect(camAim.at(-1)).toBeCloseTo(1 - AKIMBO_ADS.zoom);
  });

  it('keeps the Autoraffica\'s smart aim, dual: each gun locks a head of its own and fires into it', () => {
    draw('autoraffica');
    const a = r.enemies.add(-0.6, -10);
    const b = r.enemies.add(0.6, -10);
    smartOn();
    expect(r.weapons.smartAim.on).toBe(true);
    expect(r.weapons.smartAimLeft.on).toBe(true);
    const right = (r.weapons.smartAim as unknown as { target: unknown }).target;
    const left = (r.weapons.smartAimLeft as unknown as { target: unknown }).target;
    expect(right).not.toBeNull();
    expect(left).not.toBeNull();
    expect(left).not.toBe(right);
    expect(new Set([right, left])).toEqual(new Set([a, b]));
    r.input.simulate('fire', true);
    r.run(0.2);
    r.input.simulate('fire', false);
    expect(a.hits.length).toBeGreaterThan(0);
    expect(b.hits.length).toBeGreaterThan(0);
    for (const h of [...a.hits, ...b.hits]) expect(h.region).toBe('head');
    // Twice the one-gun smart rate, a gun at a time.
    const shots = a.hits.length + b.hits.length;
    expect(shots).toBeGreaterThanOrEqual(Math.floor(0.2 / (WEAPONS.autoraffica.smart!.interval / 2)) - 1);
    for (let i = 1; i < hands.length; i++) expect(hands[i]).toBe(!hands[i - 1]);
  });

  it('puts both guns on the one head when there is only one, and splits them when a second walks in', () => {
    draw('autoraffica');
    const a = r.enemies.add(0, -10);
    smartOn();
    const target = (v: unknown) => (v as { target: unknown }).target;
    expect(target(r.weapons.smartAim)).toBe(a);
    expect(target(r.weapons.smartAimLeft)).toBe(a);
    const b = r.enemies.add(0.8, -10);
    r.run(0.1);
    expect(new Set([target(r.weapons.smartAim), target(r.weapons.smartAimLeft)])).toEqual(new Set([a, b]));
  });

  it('keeps one smart aim and the plain semi trigger without akimbo', () => {
    draw('autoraffica', false);
    r.enemies.add(-0.6, -10);
    r.enemies.add(0.6, -10);
    smartOn();
    expect(r.weapons.smartAim.on).toBe(true);
    expect(r.weapons.smartAimLeft.on).toBe(false);
  });
});
