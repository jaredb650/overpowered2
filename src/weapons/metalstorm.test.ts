/**
 * Metal Storm (Slot 8 stacked-projectile electronic volley gun) and its 40mm FireStorm shop mod.
 * Covers slot 8 switching, Hold-R 4-tier RPM cycling vs tap-R reload, 1M RPM hyper-volley (including bottomlessMag),
 * 40mm FireStorm grenade conversion (capped simultaneous projectiles + spread fan), and unequip restoration.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProjectileSpec } from '../core/gameplay';
import { WEAPONS } from './data';
import { familyOfSlot } from './families';
import { makeRange, type Range } from './testkit';

describe('Metal Storm & 40mm FireStorm', () => {
  let r: Range;
  let callouts: string[];
  let charges: number[];
  let spawned: ProjectileSpec[];

  beforeEach(async () => {
    r = await makeRange();
    callouts = [];
    charges = [];
    spawned = [];
    r.ctx.hud = {
      hitMarker() {},
      feed() {},
      callout: (text: string) => callouts.push(text),
    } as unknown as typeof r.ctx.hud;
    const origSetCharge = r.ctx.viewmodel.setCharge.bind(r.ctx.viewmodel);
    r.ctx.viewmodel.setCharge = (v: number) => {
      charges.push(v);
      origSetCharge(v);
    };
    const origSpawn = r.combat.spawnProjectile.bind(r.combat);
    r.combat.spawnProjectile = (spec: ProjectileSpec) => {
      spawned.push({ ...spec, origin: spec.origin.clone(), velocity: spec.velocity.clone() });
      origSpawn(spec);
    };
    r.weapons.give('metalstorm');
    r.weapons.switchTo('metalstorm');
    r.run(0.5);
    callouts.length = 0;
    charges.length = 0;
    r.record.sounds.length = 0;
    r.record.tracers.length = 0;
    spawned.length = 0;
  });

  function holdR(seconds = 0.35): void {
    r.input.simulate('reload', true);
    r.run(seconds);
    r.input.simulate('reload', false);
    r.run(1 / 60);
  }

  function tapR(): void {
    r.input.simulate('reload', true);
    r.run(0.05);
    r.input.simulate('reload', false);
    r.run(1 / 60);
  }

  it('lives on Slot 8 with 180 stacked rounds and defaults to 600 RPM', () => {
    expect(familyOfSlot(8)).toContain('metalstorm');
    expect(WEAPONS.metalstorm.slot).toBe(8);
    expect(WEAPONS.metalstorm.magSize).toBe(180);
    expect(r.weapons.current).toBe('metalstorm');
    expect(r.weapons.ammo('metalstorm').mag).toBe(180);
    expect(r.weapons.ammoMode).toBe('600 RPM');
  });

  it('cycles all 4 electronic RPM rates on hold R and plays selector click + callout + LED charge', () => {
    expect(r.weapons.ammoMode).toBe('600 RPM');

    holdR();
    expect(r.weapons.ammoMode).toBe('3.6K RPM');
    expect(callouts.at(-1)).toBe('3.6K RPM');
    expect(r.record.sounds).toContain('fire_select');
    expect(charges.at(-1)).toBeCloseTo(1 / 3, 2);

    holdR();
    expect(r.weapons.ammoMode).toBe('60K RPM');
    expect(callouts.at(-1)).toBe('60K RPM');
    expect(charges.at(-1)).toBeCloseTo(2 / 3, 2);

    holdR();
    expect(r.weapons.ammoMode).toBe('1M RPM');
    expect(callouts.at(-1)).toBe('1M RPM');
    expect(charges.at(-1)).toBeCloseTo(1, 2);

    holdR();
    expect(r.weapons.ammoMode).toBe('600 RPM');
    expect(callouts.at(-1)).toBe('600 RPM');
    expect(charges.at(-1)).toBeCloseTo(0, 2);
  });

  it('distinguishes tap R (reload) from hold R (rate select)', () => {
    // Fire a couple of rounds at 600 RPM.
    r.input.simulate('fire', true);
    r.run(0.25);
    r.input.simulate('fire', false);
    const afterFire = r.weapons.ammo('metalstorm').mag;
    expect(afterFire).toBeLessThan(180);

    // Tap R (< 0.3s) reloads without changing RPM mode.
    tapR();
    expect(r.weapons.reloading).toBe(true);
    expect(r.weapons.ammoMode).toBe('600 RPM');
    r.run(WEAPONS.metalstorm.reloadTime + 0.1);
    expect(r.weapons.reloading).toBe(false);
    expect(r.weapons.ammo('metalstorm').mag).toBe(180);

    // Hold R (>= 0.3s) switches rate without starting a reload.
    holdR();
    expect(r.weapons.reloading).toBe(false);
    expect(r.weapons.ammoMode).toBe('3.6K RPM');
  });

  it('escalates fire rate from 600 RPM to 3.6K RPM to 60K RPM', () => {
    r.wall(-30, 1);

    // 600 RPM = 10 rps (~2–3 rounds in 0.2s)
    r.input.simulate('fire', true);
    r.run(0.2);
    r.input.simulate('fire', false);
    const spent600 = 180 - r.weapons.ammo('metalstorm').mag;
    expect(spent600).toBeGreaterThanOrEqual(2);
    expect(spent600).toBeLessThanOrEqual(4);

    // 3.6K RPM = 60 rps (~12 rounds in 0.2s)
    holdR();
    const before3600 = r.weapons.ammo('metalstorm').mag;
    r.run(0.15);
    r.input.simulate('fire', true);
    r.run(0.2);
    r.input.simulate('fire', false);
    const spent3600 = before3600 - r.weapons.ammo('metalstorm').mag;
    expect(spent3600).toBeGreaterThan(spent600 * 2);

    // 60K RPM = 1,000 rps (multi-round salvo per frame, far faster than 3.6K RPM)
    holdR();
    const before60k = r.weapons.ammo('metalstorm').mag;
    r.run(0.1);
    r.input.simulate('fire', true);
    r.run(0.1);
    r.input.simulate('fire', false);
    const spent60k = before60k - r.weapons.ammo('metalstorm').mag;
    expect(spent60k).toBeGreaterThan(spent3600 * 2);
  });

  it('fires an instantaneous 36-round hyper-volley at 1M RPM and stays safe under bottomlessMag', () => {
    r.wall(-20, 1);
    const dummy = r.enemies.add(0, -10, 100000);
    // Cycle to 1M RPM (3 holds).
    holdR();
    holdR();
    holdR();
    expect(r.weapons.ammoMode).toBe('1M RPM');

    r.record.sounds.length = 0;
    r.record.tracers.length = 0;
    r.tap('fire');

    expect(r.weapons.ammo('metalstorm').mag).toBe(180 - 36);
    expect(r.record.tracers.length).toBe(36);
    expect(r.record.sounds).toContain('metalstorm_volley');
    expect(dummy.hits.length).toBeGreaterThan(10);

    // bottomlessMag must not infinite-loop and still dumps a clean 36-round salvo.
    r.weapons.modifiers.bottomlessMag = true;
    r.run(0.5);
    r.record.tracers.length = 0;
    r.tap('fire');
    expect(r.record.tracers.length).toBe(36);
    expect(r.weapons.ammo('metalstorm').mag).toBe(180 - 36);
  });

  it('converts to 40mm FireStorm stacked HE grenades and caps simultaneous hyper-volley projectiles with spread fan', () => {
    r.weapons.grantMod('metalstorm40mm');
    expect(r.weapons.fitMod('metalstorm40mm', true)).toBe(true);

    const a = r.weapons.ammo('metalstorm');
    expect(a.magSize).toBe(36);
    expect(a.mag).toBe(36);
    expect(a.maxReserve).toBe(108);
    expect(a.reserve).toBeLessThanOrEqual(108);
    expect(r.weapons.ammoMode).toBe('40MM · 600 RPM');

    // Single shot at 600 RPM spawns a 40mm HE grenade projectile.
    r.tap('fire');
    expect(spawned.length).toBe(1);
    expect(spawned[0]!.explosion?.kind).toBe('grenade');
    expect(r.weapons.ammo('metalstorm').mag).toBe(35);

    // Cycle to 1M RPM carpet-bomb volley: spawns a sensible capped fan (14 grenades), not 36!
    holdR();
    holdR();
    holdR();
    expect(r.weapons.ammoMode).toBe('40MM · 1M RPM');

    spawned.length = 0;
    r.run(0.2);
    r.tap('fire');
    expect(spawned.length).toBe(14);
    expect(r.weapons.ammo('metalstorm').mag).toBe(35 - 14);

    // Verify spread fan: grenades are not stacked identically on one velocity vector.
    const v0 = spawned[0]!.velocity;
    const distinctDirs = spawned.some(p => p.velocity.distanceTo(v0) > 0.5);
    expect(distinctDirs).toBe(true);

    // Unequipping restores standard 180-round bullet configuration.
    expect(r.weapons.fitMod('metalstorm40mm', false)).toBe(false);
    expect(r.weapons.ammo('metalstorm').magSize).toBe(180);
    expect(r.weapons.ammo('metalstorm').maxReserve).toBe(540);
    expect(r.weapons.ammoMode).toBe('1M RPM');
  });
});
