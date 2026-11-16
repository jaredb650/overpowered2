import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModId } from '../core/gameplay';
import { CACHE_ORDER } from '../progression/data';
import { MOD_WARES, WEAPON_WARES } from '../contracts/shop/data';
import { AMMO, TUNING, WEAPONS } from './data';
import { AMMO_GUNS, MOD_ORDER, moddedDef } from './mods';
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
    expect(WEAPONS.awl.scopeFov).toBeGreaterThan(TUNING.autocannon.scopeFov);
  });

  it('lifts, draws back, goes forward and locks; the case flies on pull-back, not lift', () => {
    const eject = vi.fn();
    range.ctx.fx = new Proxy(range.ctx.fx, { get: (target, key) => key === 'shellCasing' ? eject : Reflect.get(target, key) });
    expect(boltPose(0).lift).toBe(0);
    expect(boltPose(0.164)).toMatchObject({ lift: 1, back: 0 });
    expect(boltPose(0.3)).toMatchObject({ lift: 1, back: 1 });
    expect(boltPose(0.52)).toMatchObject({ lift: 1, back: 0 });
    expect(boltPose(0.66)).toEqual({ lift: 0, back: 0, hand: 0 });
    // The model's bolt and the row's cues are one clock: the case flies mid-pull, the hand is back by the refire.
    const [lift, pull, push, lock] = WEAPONS.awl.cycleFoley!.map(([at]) => at);
    expect(WEAPONS.awl.cycleTime).toBe(0.65);
    expect(boltPose(lift!).lift).toBeGreaterThan(0);
    expect(boltPose(pull!).back).toBeGreaterThan(0.2);
    expect(boltPose(pull!).back).toBeLessThan(0.8);
    expect(boltPose(push!).back).toBeLessThan(1);
    expect(boltPose(lock!).lift).toBeLessThan(1);
    expect(boltPose(WEAPONS.awl.cycleTime!).hand).toBe(0);
    range.tap('fire');
    range.run(0.15);
    expect(range.record.sounds).toContain('reload_bolt');
    expect(eject).not.toHaveBeenCalled();
    range.run(0.15);
    expect(eject).toHaveBeenCalledOnce();
    expect(eject.mock.calls[0]![2]).toBe('rifle');
    range.run(0.6);
    expect(eject).toHaveBeenCalledOnce();
    expect(range.record.sounds).toContain('pump_rack_forward');
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

  it('scopes at its own FOV, drops out for the visible bolt, and swaps to the shared ACOG and back', () => {
    const zoom = vi.fn();
    range.ctx.camera.setZoom = zoom;
    range.tap('aim');
    range.run(0.4);
    expect(range.weapons.scoped).toBe(true);
    expect(zoom).toHaveBeenCalledWith(32);
    range.tap('fire');
    expect(range.weapons.scoped).toBe(false);
    range.run(1);
    fit('awlAcog');
    range.tap('aim');
    range.run(0.4);
    expect(range.weapons.aim).toBeGreaterThan(0.99);
    expect(range.weapons.scoped).toBe(false);
    fit('awlAcog', false);
    range.tap('aim');
    range.run(0.4);
    expect(range.weapons.scoped).toBe(true);
  });

  it('goes back into the scope as the bolt locks, unless aim was pressed or let go during the cycle', () => {
    const scopeUp = () => {
      range.tap('aim');
      range.run(0.4);
      expect(range.weapons.scoped).toBe(true);
    };
    // Toggled: in, shot, out for the bolt, back in on its own once it locks.
    scopeUp();
    range.tap('fire');
    expect(range.weapons.scoped).toBe(false);
    range.run(0.5);
    expect(range.weapons.scoped).toBe(false);
    range.run(0.4);
    expect(range.weapons.scoped).toBe(true);
    // Aim pressed during the cycle: it stays out.
    range.tap('fire');
    range.run(0.2);
    range.tap('aim');
    range.run(1);
    expect(range.weapons.scoped).toBe(false);
    // Hold to aim: held through the cycle it comes back; let go during it, it stays out.
    range.weapons.aimHold = true;
    range.input.simulate('aim', true);
    range.run(0.4);
    expect(range.weapons.scoped).toBe(true);
    range.tap('fire');
    range.input.simulate('aim', true);
    range.run(1);
    expect(range.weapons.scoped).toBe(true);
    range.tap('fire');
    range.input.simulate('aim', false);
    range.run(1);
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
