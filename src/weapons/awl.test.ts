import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModId } from '../core/gameplay';
import { CACHE_ORDER } from '../progression/data';
import { MOD_WARES, WEAPON_WARES, modWares } from '../contracts/shop/data';
import { armourHit } from '../enemies/damage';
import { AMMO, TUNING, WEAPONS } from './data';
import { AMMO_GUNS, AWL_BARREL, GREASE, MODS, MOD_ORDER, moddedDef } from './mods';
import { WAKE_PROFILES } from '../fx/recipes/sabot';
import { boltPose } from './viewmodels/models/awl';
import { makeRange, type Range } from './testkit';

let range: Range;
beforeEach(async () => {
  range = await makeRange();
  range.reset();
  range.weapons.give('awl');
  range.weapons.switchTo('awl');
  range.run(0.4);
});

function fit(id: ModId, on = true): void {
  range.weapons.grantMod(id);
  range.weapons.fitMod(id, on);
}

describe('the Awl scout', () => {
  it('is an independent cache and purchase, beside the Sabot but below its round', () => {
    expect(CACHE_ORDER.filter(id => id === 'awl')).toHaveLength(1);
    expect(WEAPON_WARES.awl!.price).toBeGreaterThan(0);
    expect(WEAPON_WARES.awl!.wave).toBe(2);
    expect(WEAPONS.awl.slot).toBe(WEAPONS.sabot.slot);
    range.weapons.reset();
    expect(range.weapons.owned.has('awl')).toBe(false);
    expect(WEAPONS.awl.damage).toBeGreaterThan(WEAPONS.harrow.damage);
    expect(WEAPONS.awl.damage).toBeLessThan(WEAPONS.sabot.damage);
    expect(WEAPONS.awl.damage * WEAPONS.awl.headshotMult).toBeLessThan(WEAPONS.sabot.damage * WEAPONS.sabot.headshotMult);
    expect(WEAPONS.awl.penetration).toBeLessThan(WEAPONS.sabot.penetration);
    expect(WEAPONS.awl.armorPiercing).not.toBe(true);
    expect(WEAPONS.awl.scopeFov).toBeCloseTo(14.2500327, 6);
    expect(Math.tan(Math.PI / 4) / Math.tan(WEAPONS.awl.scopeFov! * Math.PI / 360)).toBeCloseTo(8, 10);
    expect(TUNING.autocannon.scopeFov).toBe(20);
    expect(WEAPONS.awl.scopeFov).toBeLessThan(TUNING.autocannon.scopeFov);
  });

  it('lifts, draws back, goes forward and locks; the case flies on pull-back, not lift', () => {
    const eject = vi.fn();
    range.ctx.fx = new Proxy(range.ctx.fx, { get: (target, key) => key === 'shellCasing' ? eject : Reflect.get(target, key) });
    expect(boltPose(0).lift).toBe(0);
    expect(boltPose(0.164)).toMatchObject({ lift: 1, back: 0 });
    expect(boltPose(0.3)).toMatchObject({ lift: 1, back: 1 });
    expect(boltPose(0.52)).toMatchObject({ lift: 1, back: 0 });
    expect(boltPose(0.66)).toEqual({ lift: 0, back: 0, hand: 0 });
    // The model's bolt and the row's cues are one clock: open on lift, case flies mid-pull, close on push/lock, hand back by refire.
    const [open, pull, close] = WEAPONS.awl.cycleFoley!.map(([at]) => at);
    expect(WEAPONS.awl.cycleTime).toBe(0.65);
    expect(boltPose(open! + 0.01).lift).toBeGreaterThan(0);
    expect(boltPose(pull!).back).toBeGreaterThan(0.2);
    expect(boltPose(pull!).back).toBeLessThan(0.8);
    expect(boltPose(close!).back).toBeGreaterThan(0.5);
    expect(boltPose(WEAPONS.awl.cycleTime!).hand).toBe(0);
    range.tap('fire');
    range.run(0.15);
    expect(range.record.sounds).toContain('awl_bolt_open');
    expect(eject).not.toHaveBeenCalled();
    range.run(0.15);
    expect(eject).toHaveBeenCalledOnce();
    expect(eject.mock.calls[0]![2]).toBe('rifle');
    range.run(0.6);
    expect(eject).toHaveBeenCalledOnce();
    expect(range.record.sounds).toContain('awl_bolt_close');
    expect(WEAPONS.awl.reloadFoley.map(([, id]) => id)).toEqual(['awl_mag_out', 'awl_mag_in', 'awl_bolt_open', 'awl_bolt_close']);
  });

  it('cannot refire or reload before the bolt closes, even under a fire-rate boost', () => {
    range.weapons.modifiers.fireRate = 10;
    range.tap('fire');
    range.run(0.5);
    range.tap('fire');
    range.tap('reload');
    expect(range.weapons.reloading).toBe(false);
    expect(range.weapons.ammo('awl').mag).toBe(4);
    range.run(0.15);
    range.tap('fire');
    expect(range.weapons.ammo('awl').mag).toBe(3);
  });

  it('does not bypass the bolt cooldown by switching away and back', () => {
    range.tap('fire');
    range.weapons.switchTo('smg');
    range.run(0.2);
    range.weapons.switchTo('awl');
    range.run(0.25);
    range.tap('fire');
    expect(range.weapons.ammo('awl').mag).toBe(4);
    range.run(0.2);
    range.tap('fire');
    expect(range.weapons.ammo('awl').mag).toBe(3);
  });

  it('cycles its last case before automatically reloading', () => {
    range.weapons.ammo('awl').mag = 1;
    range.tap('fire');
    range.run(0.5);
    expect(range.weapons.reloading).toBe(false);
    range.run(0.5);
    expect(range.weapons.reloading).toBe(true);
  });

  it('delivers triple damage to an unarmoured head and uses a thinner, shorter Sabot wake', () => {
    const target = range.enemies.add(0, -15);
    range.player.eye.y = 1.6;
    range.tap('fire');
    expect(target.hits[0]!.headshotMult).toBe(3);
    expect(target.maxHealth - target.health).toBe(540);
    expect(range.record.tracers.some(trace => trace.kind === 'scout')).toBe(true);
    expect(WAKE_PROFILES.scout.width).toBeLessThan(WAKE_PROFILES.sabot.width / 3);
    expect(WAKE_PROFILES.scout.life).toBeLessThan(WAKE_PROFILES.sabot.life);
    expect(WAKE_PROFILES.scout.shock).toBe(0);
  });

  it('scopes at its own FOV, holds the bolt closed while scoped for follow-through, and swaps to the shared ACOG and back', () => {
    const zoom = vi.fn();
    const aim = vi.fn();
    range.ctx.camera.setZoom = zoom;
    range.ctx.camera.setAim = aim;
    range.tap('aim');
    range.run(0.4);
    expect(range.weapons.scoped).toBe(true);
    expect(zoom).toHaveBeenLastCalledWith(WEAPONS.awl.scopeFov);
    // Scoped shot stays in the scope so the player can follow through and see the hit.
    range.tap('fire');
    expect(range.weapons.scoped).toBe(true);
    expect(range.weapons.ammo('awl').mag).toBe(4);
    // Cannot fire again while still scoped with a spent chamber.
    range.tap('fire');
    expect(range.weapons.ammo('awl').mag).toBe(4);
    // Unscoping racks the bolt; once the bolt closes, the next shot can fire.
    range.tap('aim');
    range.run(0.2);
    expect(range.weapons.scoped).toBe(false);
    range.run(0.6);
    fit('awlAcog');
    range.tap('aim');
    range.run(0.4);
    expect(range.weapons.aim).toBeGreaterThan(0.99);
    expect(range.weapons.scoped).toBe(false);
    expect(moddedDef('awl', range.weapons.fitted).ads).toEqual({ zoom: 0.69, time: 0.24 });
    expect(aim).toHaveBeenLastCalledWith(expect.closeTo(0.31, 10), TUNING.ads.sensitivity, 1);
    const acogFov = 90 * (1 - moddedDef('awl', range.weapons.fitted).ads!.zoom);
    expect(acogFov).toBeCloseTo(27.9);
    expect(1 / Math.tan(acogFov * Math.PI / 360)).toBeCloseTo(4, 1);
    fit('awlAcog', false);
    range.tap('aim');
    range.run(0.4);
    expect(range.weapons.scoped).toBe(true);
    expect(zoom).toHaveBeenLastCalledWith(WEAPONS.awl.scopeFov);
  });

  it('waits to rack the bolt until unscoped in both toggle and hold scope modes, and blocks re-scoping mid-cycle', () => {
    const eject = vi.fn();
    range.ctx.fx = new Proxy(range.ctx.fx, { get: (target, key) => key === 'shellCasing' ? eject : Reflect.get(target, key) });
    const scopeUp = () => {
      range.tap('aim');
      range.run(0.4);
      expect(range.weapons.scoped).toBe(true);
    };
    // Toggle scope: stays scoped after firing with no bolt cycle or shell ejection until aim is pressed again.
    scopeUp();
    range.tap('fire');
    range.run(1);
    expect(range.weapons.scoped).toBe(true);
    expect(eject).not.toHaveBeenCalled();
    // Unscope: bolt cycles and ejects the spent brass.
    range.tap('aim');
    range.run(0.3);
    expect(range.weapons.scoped).toBe(false);
    expect(eject).toHaveBeenCalledOnce();
    // Cannot re-scope mid-bolt; once the cycle completes, scoping works again.
    range.tap('aim');
    expect(range.weapons.scoped).toBe(false);
    range.run(0.5);
    scopeUp();
    // Hold to aim: stays scoped as long as aim is held after firing, then cycles once released.
    range.weapons.aimHold = true;
    range.input.simulate('aim', true);
    range.run(0.4);
    expect(range.weapons.scoped).toBe(true);
    range.tap('fire');
    range.run(1);
    expect(range.weapons.scoped).toBe(true);
    expect(eject).toHaveBeenCalledTimes(1);
    range.input.simulate('aim', false);
    range.run(0.3);
    expect(range.weapons.scoped).toBe(false);
    expect(eject).toHaveBeenCalledTimes(2);
    range.run(0.5);
    // Holding aim again after the bolt finishes brings the scope back cleanly.
    range.input.simulate('aim', true);
    range.run(0.4);
    expect(range.weapons.scoped).toBe(true);
    range.input.simulate('aim', false);
    range.run(0.4);
    expect(range.weapons.scoped).toBe(false);
  });

  it('lists every mod for Procurement and the cheat panel; the suppressor changes only its report and muzzle', () => {
    for (const id of ['awlAcog', 'awlCan', 'awlAp', 'awlHp'] as const) {
      expect(MOD_WARES[id].price).toBeGreaterThan(0);
      expect(MOD_ORDER).toContain(id);
    }
    fit('awlCan');
    range.tap('fire');
    expect(range.record.sounds).toContain('awl_suppressed_shot');
    expect(moddedDef('awl', range.weapons.fitted).muzzle).toBe('suppressed');
    expect(moddedDef('awl', range.weapons.fitted).damage).toBe(180);
    expect(moddedDef('awl', range.weapons.fitted).tracer).toBe('scout');
  });

  it('uses the landed AP/HP API, mutually exclusive and composable with both accessories', () => {
    expect(AMMO_GUNS).toContain('awl');
    fit('awlAcog');
    fit('awlCan');
    fit('awlAp');
    const ap = moddedDef('awl', range.weapons.fitted);
    expect(ap.load).toBe('ap');
    expect(ap.damage).toBe(180 * AMMO.ap.flesh);
    expect(ap.penetration).toBeCloseTo(0.8 + AMMO.ap.penetration);
    fit('awlHp');
    expect(range.weapons.fitted.has('awlAp')).toBe(false);
    const hp = moddedDef('awl', range.weapons.fitted);
    expect(hp.load).toBe('hp');
    expect(hp.damage).toBe(180 * AMMO.hp.flesh);
    expect(hp.penetration).toBe(0);
    expect(hp.scope).toBe(false);
    expect(hp.ads).toBeDefined();
    expect(hp.muzzle).toBe('suppressed');
    fit('awlHp', false);
    expect(moddedDef('awl', range.weapons.fitted).damage).toBe(180);
  });
});

describe('the Awl\'s extended barrel and greased bolt', () => {
  const def = (...ids: ModId[]) => moddedDef('awl', new Set(ids));

  it('are sold, mid-run in the Crucible and by wave 3 in Endless Humans, and listed for the cheat panel', () => {
    for (const id of ['awlBarrel', 'awlBolt'] as const) {
      expect(MOD_ORDER.filter(m => m === id)).toHaveLength(1);
      expect(MOD_WARES[id].price).toBeGreaterThan(MOD_WARES.awlAp.price);
      expect(MOD_WARES[id].lore.length).toBeGreaterThan(40);
      expect(modWares('outpost')[id].wave).toBeLessThanOrEqual(9);
    }
    expect(MOD_WARES.awlBarrel).toMatchObject({ price: 950, wave: 6 });
    expect(MOD_WARES.awlBolt).toMatchObject({ price: 700, wave: 4 });
    expect(modWares('outpost').awlBarrel.wave).toBe(3);
    expect(MODS.awlBarrel.slot).toBe('barrel');
  });

  it('the barrel: one body further, plates met as a heavy round, the long wake; with AP it goes through plates as a dart does', () => {
    const long = def('awlBarrel');
    expect(long.penetration).toBeCloseTo(0.8 + AWL_BARREL.penetration);
    expect(long.armour).toBe('heavy');
    expect(long.tracer).toBe('scoutLong');
    expect(long.armorPiercing).toBeUndefined();
    expect(long.damage).toBe(180);
    // Ball through a plate: none of the head shot gets past it on the plain barrel, half on the long one.
    expect(armourHit('medium', 21, 180, 540).through).toBe(0);
    expect(armourHit(long.armour!, 21, 180, 540).through).toBe(270);
    const ap = def('awlAp', 'awlBarrel');
    expect(ap.load).toBe('ap');
    expect(ap.penetration).toBeCloseTo(0.8 + AMMO.ap.penetration + AWL_BARREL.penetration);
    expect(ap.armorPiercing).toBe(true);
    expect(ap.tracer).toBe('scoutLong');
    expect(def('awlAp').armorPiercing).toBeUndefined();
    // HP still stays in the first body; the can stacks and keeps its report.
    expect(def('awlHp', 'awlBarrel').penetration).toBe(0);
    const can = def('awlCan', 'awlBarrel', 'awlAcog');
    expect(can.muzzle).toBe('suppressed');
    expect(can.tracer).toBe('scoutLong');
    expect(can.ads).toEqual({ zoom: 0.69, time: 0.24 });
    expect(WAKE_PROFILES.scoutLong.life).toBeGreaterThan(WAKE_PROFILES.scout.life);
    expect(WAKE_PROFILES.scoutLong.opacity).toBeGreaterThan(WAKE_PROFILES.scout.opacity);
  });

  it('with AP, one round tears through two armoured men in line and lands in full on both; AP alone does not pierce', () => {
    range.player.eye.y = 1.2;
    const shoot = (...ids: ModId[]) => {
      range.reset();
      range.weapons.give('awl');
      range.weapons.switchTo('awl');
      range.run(0.4);
      for (const id of ids) fit(id);
      const men = [range.enemies.add(0, -10, 150), range.enemies.add(0, -14, 150)];
      for (const man of men) man.armor = 40;
      range.tap('fire');
      return men;
    };
    const [a, b] = shoot('awlAp', 'awlBarrel');
    expect(a!.hits[0]!.pierces).toBe(true);
    expect(b!.hits[0]!.pierces).toBe(true);
    expect(a!.health).toBeLessThan(150 - 100);
    expect(b!.health).toBeLessThan(150 - 100);
    expect(range.record.tracers.some(t => t.kind === 'scoutLong')).toBe(true);
    const [c, d] = shoot('awlAp');
    // The range's dummy plate stops whatever does not pierce (the real one lets AP's three quarters by): no dart rule without the barrel.
    expect(c!.hits[0]!.pierces).toBeFalsy();
    expect(c!.health).toBe(150);
    expect(d!.health).toBe(150);
    // Ball on the long barrel carries its heavy class onto the body, for the plate to take it as one.
    const [e] = shoot('awlBarrel');
    expect(e!.hits[0]!.armour).toBe('heavy');
  });

  it('the greased bolt: the whole cycle and every cue a quarter sooner, the case on the pull once unscoped', () => {
    const greased = def('awlBolt');
    expect(greased.cycleTime).toBeCloseTo(0.65 * GREASE);
    expect(greased.interval).toBeCloseTo(0.65 * GREASE);
    expect(greased.cycleFoley!.map(([at]) => at)).toEqual(WEAPONS.awl.cycleFoley!.map(([at]) => at * GREASE));
    expect(60 / greased.interval).toBeGreaterThan(120);
    // It stacks with the barrel and the rounds.
    expect(def('awlBolt', 'awlBarrel', 'awlAp').cycleTime).toBeCloseTo(0.65 * GREASE);
    const eject = vi.fn();
    range.ctx.fx = new Proxy(range.ctx.fx, { get: (target, key) => key === 'shellCasing' ? eject : Reflect.get(target, key) });
    fit('awlBolt');
    range.tap('aim');
    range.run(0.4);
    expect(range.weapons.scoped).toBe(true);
    range.tap('fire');
    // Stays scoped with bolt held until unscoped.
    range.run(0.3);
    expect(range.weapons.scoped).toBe(true);
    expect(eject).not.toHaveBeenCalled();
    // Unscoping triggers the greased bolt: ejects within 0.17 s and finishes well before plain bolt's 0.65 s.
    range.tap('aim');
    range.run(0.17);
    expect(eject).toHaveBeenCalledOnce();
    range.run(0.35);
    // 0.52 s after unscoping: bolt locked and ready to fire again, where plain bolt is still cycling (0.65 s).
    range.tap('fire');
    expect(range.weapons.ammo('awl').mag).toBe(3);
  });
});
