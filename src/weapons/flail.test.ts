/** The Flail, the light machine gun last on key 1: its numbers, its boxes, its one sight, its shop rows and their locks. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ModId } from '../core/gameplay';
import { CACHE_ORDER } from '../progression/data';
import { MOD_WARES, WEAPON_WARES, modWares, weaponWares } from '../contracts/shop/data';
import { WEAPON_PRICES } from '../contracts/defense/data';
import { WEAPONS } from './data';
import { familyOfSlot } from './families';
import { AMMO_GUNS, API_GUNS, MODS, MOD_ORDER, moddedDef } from './mods';
import { makeRange, type Range } from './testkit';

const FLAIL_MODS: readonly ModId[] = ['flailDot', 'flailHolo', 'flailAcog', 'flailBox', 'flailBolt', 'flailAp', 'flailHp', 'flailPlusP', 'flailApi'];

let r: Range;
beforeEach(async () => {
  r = await makeRange();
  r.reset();
});

function draw(): void {
  r.weapons.give('flail');
  r.weapons.switchTo('flail');
  r.run(0.8);
  expect(r.weapons.current).toBe('flail');
}

function fit(id: ModId, on = true): boolean {
  r.weapons.grantMod(id);
  return r.weapons.fitMod(id, on);
}

describe('the Flail on paper', () => {
  it('is last on key 1, a primary of its own, about 800 a minute with a round between the SMG and the Harrow', () => {
    const f = WEAPONS.flail;
    expect(familyOfSlot(1)).toEqual(['smg', 'gimlet', 'harrow', 'shear', 'bodkin', 'flail']);
    expect(f.mode).toBe('auto');
    expect(60 / f.interval).toBeCloseTo(800, 6);
    expect(f.damage).toBeGreaterThan(WEAPONS.smg.damage);
    expect(f.damage).toBeLessThan(WEAPONS.harrow.damage);
    // No spread: bullets go where the crosshair is.
    expect(f.spread).toBe(0);
    expect(f.pellets).toBe(1);
    // Heavier than the rifles to bring up and to aim, and far slower to reload.
    expect(f.drawTime).toBeGreaterThan(WEAPONS.harrow.drawTime);
    expect(f.ads!.time).toBeGreaterThan(WEAPONS.harrow.ads!.time);
    expect(f.reloadTime).toBeGreaterThan(2 * WEAPONS.harrow.reloadTime);
    // Its foley is a belt-fed reload in order: cover up, box off, box on, belt laid, cover down, the handle.
    expect(f.reloadFoley.map(([, id]) => id)).toEqual(['revolver_open', 'reload_mag_out', 'reload_mag_in', 'reload_shell_in', 'revolver_close', 'reload_bolt']);
    const at = f.reloadFoley.map(([t]) => t);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('holds 100 in its box, and 200 in the large one', () => {
    expect(WEAPONS.flail.magSize).toBe(100);
    expect(moddedDef('flail', new Set(['flailBox'])).magSize).toBe(200);
    expect(moddedDef('flail', new Set(['flailBox'])).reloadTime).toBeGreaterThan(WEAPONS.flail.reloadTime);
    expect(MODS.flailBox.slot).toBe('mag');
  });

  it('takes a red dot, EOTech holo sight, or ACOG — never two optics at once — and stacks the box and rounds', () => {
    expect(MODS.flailDot.slot).toBe('sight');
    expect(MODS.flailHolo.slot).toBe('sight');
    expect(MODS.flailAcog.slot).toBe('sight');
    draw();
    expect(fit('flailDot')).toBe(true);
    expect(fit('flailHolo')).toBe(true);
    expect(r.weapons.fitted.has('flailDot')).toBe(false);
    expect(r.weapons.fitted.has('flailHolo')).toBe(true);
    expect(fit('flailAcog')).toBe(true);
    expect(r.weapons.fitted.has('flailHolo')).toBe(false);
    expect(r.weapons.fitted.has('flailAcog')).toBe(true);
    expect(fit('flailDot')).toBe(true);
    expect(r.weapons.fitted.has('flailAcog')).toBe(false);
    expect(fit('flailBox')).toBe(true);
    expect(fit('flailHp')).toBe(true);
    expect([...r.weapons.fitted].filter(m => MODS[m].weapon === 'flail').sort()).toEqual(['flailBox', 'flailDot', 'flailHp']);
    // The ACOG's view is narrower than the dot's and holo's.
    expect(MODS.flailAcog.patch.ads!.zoom).toBeGreaterThan(MODS.flailDot.patch.ads!.zoom);
    expect(MODS.flailAcog.patch.ads!.zoom).toBeGreaterThan(MODS.flailHolo.patch.ads!.zoom);
  });

  it('pushes fire rate to 1200 RPM with the Lightened bolt, including when stacked with Heavy barrel and full Desert Raid spec', () => {
    expect(MODS.flailBolt.slot).toBeUndefined();
    const boltOnly = moddedDef('flail', new Set(['flailBolt']));
    expect(60 / boltOnly.interval).toBeCloseTo(1200, 6);

    const desertSpec = moddedDef(
      'flail',
      new Set(['flailHeavy', 'flailAp', 'flailStock', 'flailHolo', 'flailLam', 'flailBox', 'flailBolt']),
    );
    expect(60 / desertSpec.interval).toBeCloseTo(1200, 6);
    expect(desertSpec.magSize).toBe(200);
    expect(desertSpec.armour).toBe('medium');
    expect(desertSpec.load).toBe('ap');
    const apOnly = moddedDef('flail', new Set(['flailAp']));
    expect(desertSpec.damage).toBeGreaterThan(apOnly.damage);
    expect(desertSpec.damage).toBeCloseTo(44 * 0.8, 4);
  });

  it('loads 200 into the large box on a reload, and a full 100 without it', () => {
    draw();
    expect(r.weapons.ammo('flail').mag).toBe(100);
    fit('flailBox');
    r.input.simulate('reload', true);
    r.run(1 / 60);
    r.input.simulate('reload', false);
    r.run(moddedDef('flail', new Set(['flailBox'])).reloadTime + 0.3);
    expect(r.weapons.ammo('flail').mag).toBe(200);
  });

  it('takes the rifles\' AP, HP and +P rounds', () => {
    expect(AMMO_GUNS).toContain('flail');
    for (const id of ['flailAp', 'flailHp', 'flailPlusP'] as const) expect(MODS[id]).toMatchObject({ weapon: 'flail', slot: 'ammo' });
    expect(moddedDef('flail', new Set(['flailHp'])).damage).toBeCloseTo(WEAPONS.flail.damage * 1.5, 6);
  });

  it('takes API rounds: its AP round traced red that sets men alight, in the ammo slot so it swaps with the others', () => {
    expect(API_GUNS).toContain('flail');
    const api = moddedDef('flail', new Set(['flailApi']));
    const ap = moddedDef('flail', new Set(['flailAp']));
    expect(api).toMatchObject({ load: 'api', tracer: 'api', damage: ap.damage, penetration: ap.penetration });
    expect(MODS.flailApi.slot).toBe('ammo');
    draw();
    fit('flailAp');
    fit('flailApi');
    expect(r.weapons.fitted.has('flailAp')).toBe(false);
    expect(r.weapons.fitted.has('flailApi')).toBe(true);
  });
});

describe('the Flail in the shops', () => {
  it('has a catalogue row with a price, a lock and a line, every mod a row and a cheat row, and a primary\'s Defense price', () => {
    const ware = WEAPON_WARES.flail!;
    expect(ware.price).toBeGreaterThan(WEAPON_WARES.harrow!.price);
    expect(ware.price).toBeLessThan(WEAPON_WARES.piledriver!.price);
    expect(ware.lore.length).toBeGreaterThan(40);
    expect(WEAPON_PRICES.flail).toMatchObject({ loadout: 'primary', ammo: 'basic' });
    expect(CACHE_ORDER.filter(id => id === 'flail')).toHaveLength(1);
    for (const id of FLAIL_MODS) {
      expect(MOD_ORDER.filter(m => m === id), id).toHaveLength(1);
      expect(MOD_WARES[id].lore.length, id).toBeGreaterThan(40);
      expect(MOD_WARES[id].price, id).toBeGreaterThan(0);
    }
  });

  it('sells the gun and every mod of it in Endless Humans by the break after wave 9', () => {
    expect(weaponWares('outpost').flail!.wave).toBeLessThanOrEqual(9);
    const humans = modWares('outpost');
    for (const id of FLAIL_MODS) expect(humans[id].wave, id).toBeLessThanOrEqual(9);
    // The Crucible keeps the catalogue's locks: the gun mid-run, the large box later.
    expect(weaponWares('crucible').flail!.wave).toBe(7);
    expect(modWares('crucible').flailBox.wave).toBeGreaterThan(weaponWares('crucible').flail!.wave);
  });
});
