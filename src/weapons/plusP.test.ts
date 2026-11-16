/** +P: every AP/HP gun, ball rules, twenty percent more damage. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ModId, WeaponId } from '../core/gameplay';
import { MOD_WARES } from '../contracts/shop/data';
import { armourHit, classOf } from '../enemies/damage';
import { modCheat } from '../lab/mods';
import { AMMO, WEAPONS, type ArmourClass } from './data';
import { AMMO_GUNS, MODS, MOD_ORDER, moddedDef } from './mods';
import { makeRange, type Range } from './testkit';

// Derive coverage from the actual AP/HP mods, independently of AMMO_GUNS.
const guns = [...new Set(Object.values(MODS).filter(m => m.patch.load === 'ap' || m.patch.load === 'hp').map(m => m.weapon))];
const plusP = (gun: WeaponId): ModId => `${gun}PlusP` as ModId;

let r: Range;
beforeEach(async () => {
  r = await makeRange();
  r.reset();
});

function draw(gun: WeaponId): void {
  r.weapons.give(gun);
  r.weapons.switchTo(gun);
  r.run(0.6);
  expect(r.weapons.current).toBe(gun);
}

describe('+P rounds', () => {
  it('every AP/HP gun has an exclusive ammo mod, a cheaper wave-zero shop row and a generated cheat row', () => {
    expect(new Set(guns)).toEqual(new Set(AMMO_GUNS));
    for (const gun of guns) {
      const id = plusP(gun);
      expect(MODS[id]).toMatchObject({ weapon: gun, slot: 'ammo', name: '+P rounds' });
      expect(MOD_ORDER.filter(m => m === id), gun).toHaveLength(1);
      const def = moddedDef(gun, new Set([id]));
      expect(def.damage, gun).toBeCloseTo(WEAPONS[gun].damage * 1.2, 6);
      expect(def.penetration, gun).toBe(WEAPONS[gun].penetration);
      expect(def.armour, gun).toBe(WEAPONS[gun].armour);
      expect(def.armorPiercing, gun).toBe(WEAPONS[gun].armorPiercing);
      expect(classOf(gun, def.damage), gun).toBe(classOf(gun, WEAPONS[gun].damage));
      expect(MOD_WARES[id].wave, gun).toBe(0);
      expect(MOD_WARES[id].lore.length, gun).toBeGreaterThan(40);
      for (const suffix of ['Ap', 'Hp']) expect(MOD_WARES[id].price, gun).toBe(MOD_WARES[`${gun}${suffix}` as ModId].price - 50);
    }
  });

  it.each(guns)('%s sends the same 1.2x damage increase to flesh and plate, with its HUD label and tracer', gun => {
    function hit(plate: boolean, boosted: boolean) {
      r.reset();
      const body = r.enemies.add(0, -10);
      body.armor = plate ? 1000 : 0;
      draw(gun);
      if (boosted) modCheat(r.weapons, plusP(gun), 'fit');
      r.tap('fire');
      expect(body.hits.length).toBeGreaterThan(0);
      // Inspect the actual shot reaching each surface; the range dummy intentionally has simplified plate resolution.
      const shot = body.hits[0]!;
      expect(shot.pierces).toBeFalsy();
      expect(shot.armorPiercing).toBeFalsy();
      if (boosted) {
        expect(shot.load).toBe('plusP');
        expect(r.weapons.ammoMode).toMatch(/^\+P(?: · BURST)?$/);
        expect(r.record.tracers.some(t => t.kind === 'plusP')).toBe(true);
      }
      return shot.amount;
    }
    for (const plate of [false, true]) expect(hit(plate, true)).toBeCloseTo(hit(plate, false) * AMMO.plusP.flesh, 6);
  });

  it.each<ArmourClass>(['light', 'medium', 'heavy'])('keeps the production %s plate rule, with scaled damage and no specialist effect', cls => {
    // Includes heavy even though the current AP/HP guns are light or medium: half still gets through, scaled by 1.2.
    for (const plate of [21, 1000]) {
      const ball = armourHit(cls, plate, 40, 80);
      const boosted = armourHit(cls, plate, 40 * 1.2, 80 * 1.2, 1, 'plusP');
      expect(boosted).toEqual(armourHit(cls, plate, 40 * 1.2, 80 * 1.2));
      expect(boosted.through).toBeCloseTo(ball.through * 1.2, 6);
      // A medium round wrecks the plate outright, just as ball does, regardless of its damage.
      expect(boosted.wear).toBeCloseTo(cls === 'medium' ? ball.wear : ball.wear * 1.2, 6);
    }
  });

  it('all three ammo choices exclude one another on every gun and the cheat can remove +P', () => {
    for (const gun of guns) {
      const ids = [`${gun}Ap`, `${gun}Hp`, plusP(gun)] as ModId[];
      for (const from of ids) for (const to of ids.filter(id => id !== from)) {
        r.weapons.grantMod(from);
        r.weapons.grantMod(to);
        r.weapons.fitMod(from, true);
        r.weapons.fitMod(to, true);
        expect(ids.filter(id => r.weapons.fitted.has(id)), `${from} -> ${to}`).toEqual([to]);
      }
      r.weapons.fitMod(plusP(gun), true);
      modCheat(r.weapons, plusP(gun), 'fit');
      expect(r.weapons.fitted.has(plusP(gun))).toBe(false);
      expect(r.weapons.mods.has(plusP(gun))).toBe(true);
    }
    expect(r.weapons.fitted.has('gimletAcog')).toBe(true);
    expect(r.weapons.fitted.has('gimletCan')).toBe(true);
  });

  it('multiplies the suppressed SMG damage and stacks with other slots', () => {
    const def = moddedDef('smg', new Set(['suppressor', 'smgPlusP']));
    expect(def.damage).toBeCloseTo(WEAPONS.smg.damage * 1.1 * 1.2, 6);
    expect(def.interval).toBe(MODS.suppressor.patch.interval);
    expect(def.muzzle).toBe('suppressed');
  });

  it('keeps selector labels beside +P and returns to ball when removed', () => {
    draw('gimlet');
    modCheat(r.weapons, 'gimletPlusP', 'grant');
    expect(r.weapons.fitted.has('gimletPlusP')).toBe(false);
    modCheat(r.weapons, 'gimletPlusP', 'fit');
    expect(r.weapons.ammoMode).toBe('+P');
    r.input.simulate('reload', true);
    r.run(WEAPONS.gimlet.select!.hold + 0.1);
    r.input.simulate('reload', false);
    r.run(0.05);
    expect(r.weapons.ammoMode).toBe('+P · BURST');
    modCheat(r.weapons, 'gimletPlusP', 'fit');
    expect(r.weapons.ammoMode).toBe('BURST');
    const body = r.enemies.add(0, -10);
    r.tap('fire');
    expect(body.hits[0]!.load).toBeUndefined();
    expect(body.hits[0]!.amount).toBe(WEAPONS.gimlet.damage);
  });

  it('goes through the same bodies as ball on the Harrow', () => {
    function line(boosted: boolean) {
      r.reset();
      const bodies = [r.enemies.add(0, -8), r.enemies.add(0, -11), r.enemies.add(0, -14)];
      draw('harrow');
      if (boosted) modCheat(r.weapons, 'harrowPlusP', 'fit');
      r.tap('fire');
      return bodies.map(body => body.hits.map(h => h.amount));
    }
    const ball = line(false);
    const boosted = line(true);
    expect(boosted.map(hits => hits.length)).toEqual(ball.map(hits => hits.length));
    for (let i = 0; i < ball.length; i++) for (let j = 0; j < ball[i]!.length; j++) {
      expect(boosted[i]![j]).toBeCloseTo(ball[i]![j]! * 1.2, 6);
    }
  });
});
