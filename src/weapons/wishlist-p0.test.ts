/** Phase 0 wishlist contracts: new weapon rows, stat-only mods, stacking rules, boss damage, and mission win counters. */
import { describe, expect, it } from 'vitest';
import type { ModId, WeaponId } from '../core/gameplay';
import { lockWave, MOD_WARES, WEAPON_WARES } from '../contracts/shop/data';
import { ignites } from '../enemies/damage';
import { AMMO, bossHit, WEAPONS } from './data';
import { DRAGON_GUNS, MAGWELL_GUNS, MODS, MOD_ORDER, SHIELD_GUNS, dragonOf, magwellOf, moddedDef, shieldOf } from './mods';
import { ADS_ZOOM } from './adsZoom';

describe('wishlist Phase 0 data and mods', () => {
  it('unlocks every wishlist weapon and mod before round 10 in Endless Humans', () => {
    for (const id of ['bodkin', 'billhook', 'autoclave', 'gaff'] as WeaponId[]) {
      const w = WEAPON_WARES[id]!;
      expect(w, id).toBeDefined();
      expect(lockWave('outpost', w.wave), id).toBeLessThanOrEqual(9);
      expect(w.lore.length, id).toBeGreaterThan(40);
    }
    for (const id of MOD_ORDER) {
      const w = MOD_WARES[id];
      expect(lockWave('outpost', w.wave), id).toBeLessThanOrEqual(9);
    }
  });

  it('patches rifle wishlist mods accurately and stacks across slots', () => {
    const gLong = moddedDef('gimlet', new Set<ModId>(['gimletLong']));
    expect(gLong.interval).toBeCloseTo(60 / 760, 5);
    expect(gLong.damage).toBeCloseTo(48, 4);
    expect(gLong.armour).toBe('medium');
    expect(gLong.penetration).toBeCloseTo(WEAPONS.gimlet.penetration + 0.4, 5);
    expect(gLong.falloff!.from).toBe(90);
    const gLongAp = moddedDef('gimlet', new Set<ModId>(['gimletLong', 'gimletAp']));
    expect(gLongAp.armorPiercing).toBe(true);
    expect(MODS.gimletLong.slot).toBe('barrel');
    expect(MODS.gimletShort.slot).toBe('barrel');

    const hShort = moddedDef('harrow', new Set<ModId>(['harrowShort']));
    expect(hShort.interval).toBeCloseTo(WEAPONS.harrow.interval / 1.15, 5);
    const hBrake = moddedDef('harrow', new Set<ModId>(['harrowBrake']));
    expect(hBrake.interval).toBeCloseTo(WEAPONS.harrow.interval / 1.05, 5);
    const hBoth = moddedDef('harrow', new Set<ModId>(['harrowShort', 'harrowBrake', 'harrowMag']));
    expect(hBoth.interval).toBeCloseTo(WEAPONS.harrow.interval / (1.15 * 1.05), 5);
    expect(hBoth.magSize).toBe(40);

    const flailHeavy = moddedDef('flail', new Set<ModId>(['flailHeavy', 'flailStock']));
    expect(flailHeavy.interval).toBeCloseTo(60 / 880, 5);
    expect(flailHeavy.damage).toBeCloseTo(44, 4);
    expect(flailHeavy.armour).toBe('medium');
    expect(flailHeavy.penetration).toBeCloseTo(0.5, 5);
    expect(flailHeavy.breath).toEqual({ hold: ADS_ZOOM.hold * 1.6, cooldown: ADS_ZOOM.cooldown * 0.7 });
  });

  it('applies flared magwell 15% faster reload last, stacking with mags and akimbo', () => {
    expect(MAGWELL_GUNS).toEqual(['harrow', 'gimlet', 'ultramag', 'rivet', 'bodkin']);
    for (const gun of MAGWELL_GUNS) {
      const id = magwellOf(gun);
      expect(MODS[id].slot).toBe('loader');
      const def = moddedDef(gun, new Set([id]));
      expect(def.reloadTime, gun).toBeCloseTo(WEAPONS[gun].reloadTime * 0.85, 5);
    }
    const akMag = moddedDef('ultramag', new Set<ModId>(['ultramagAkimbo', 'ultramagMagwell']));
    expect(akMag.reloadTime).toBeCloseTo(WEAPONS.ultramag.reloadTime * 2 * 0.85, 5);
  });

  it('patches shotgun, launcher, autocannon, and pistol wishlist mods accurately', () => {
    // Pump sawed-off excludes choke (both barrel) and stacks with greased bolt.
    expect(MODS.shotgunSawedOff.slot).toBe('barrel');
    expect(MODS.shotgunChoke.slot).toBe('barrel');
    const sawed = moddedDef('shotgun', new Set<ModId>(['shotgunSawedOff', 'shotgunBolt']));
    expect(sawed.magSize).toBe(4);
    expect(sawed.spread).toBe(0.085);
    expect(sawed.damage).toBe(34);
    expect(sawed.falloff).toEqual({ from: 9, to: 26, floor: 0.3 });
    expect(sawed.interval).toBeCloseTo(WEAPONS.shotgun.interval * 0.75, 5);
    expect(sawed.interval).toBeGreaterThanOrEqual(0.4);

    // Deuce long barrel stacks with quad barrels.
    const deuceQuadLong = moddedDef('deuce', new Set<ModId>(['deuceQuad', 'deuceLong']));
    expect(deuceQuadLong.magSize).toBe(4);
    expect(deuceQuadLong.spread).toBe(0.05);
    expect(deuceQuadLong.falloff!.from).toBe(14);

    // Dragon's breath ignites reliably and sits in ammo slot.
    expect(DRAGON_GUNS).toEqual(['thresher', 'billhook']);
    for (const gun of DRAGON_GUNS) {
      const d = moddedDef(gun, new Set([dragonOf(gun)]));
      expect(d.load).toBe('dragon');
      expect(d.tracer).toBe('dragon');
    }
    expect(ignites('dragon', 0.5)).toBe(true);
    expect(ignites('dragon', AMMO.dragon.ignite + 0.01)).toBe(false);

    // Rocket tube + WP, MGL long + trigger, Howitzer cluster.
    const rTube = moddedDef('rocket', new Set<ModId>(['rocketTube', 'rocketWp']));
    expect(rTube.rocket!.speed).toBe(56);
    expect(rTube.damage).toBe(130);
    expect(rTube.rocket!.laserTurn).toBeGreaterThan(2.5);
    expect(rTube.wp).toBe(true);
    expect(rTube.altAmmo?.label).toBe('WP');

    const mgl = moddedDef('mgl', new Set<ModId>(['mglLong', 'mglTrigger']));
    expect(mgl.grenade!.speed).toBe(70);
    expect(mgl.damage).toBe(105);
    expect(mgl.interval).toBe(0.27);

    const how = moddedDef('howitzer', new Set<ModId>(['howitzerCluster']));
    expect(how.cluster).toBe(true);
    expect(how.altAmmo?.label).toBe('CLUSTER');

    // Autocannon longer barrel: faster shell and higher bossDamage only.
    const ac = moddedDef('autocannon', new Set<ModId>(['autocannonBarrel']));
    expect(ac.shell!.speed).toBe(280);
    expect(ac.damage).toBe(99999);
    expect(ac.shell!.bossDamage).toBe(1150);
    expect(bossHit(true, 99999, ac.shell!.bossDamage)).toBe(1150);
    expect(bossHit(false, 99999, ac.shell!.bossDamage)).toBe(99999);

    // Judge extended barrel & compensator stack with hammer.
    const judge = moddedDef('judge', new Set<ModId>(['judgeLong', 'judgeHammer', 'judgeComp']));
    expect(judge.damage).toBe(150);
    expect(judge.altFan!.perBar).toBeCloseTo(0.28 * 0.8, 5);
    // Guarded when akimbo removes altFan.
    expect(() => moddedDef('judge', new Set<ModId>(['judgeAkimbo', 'judgeComp', 'judgeHammer']))).not.toThrow();

    // Rivet new mods & shields.
    const rivetMod = moddedDef('rivet', new Set<ModId>(['rivetComp', 'rivetLam']));
    expect(rivetMod.interval).toBeCloseTo(WEAPONS.rivet.interval / (1.15 * 1.25), 5);
    const rivetCan = moddedDef('rivet', new Set<ModId>(['rivetCan']));
    expect(rivetCan.muzzle).toBe('suppressed');
    expect(rivetCan.sounds[0]!.id).toBe('rivet_suppressed_shot');
    for (const gun of SHIELD_GUNS) {
      const sh = moddedDef(gun, new Set([shieldOf(gun)]));
      expect(sh.shield, gun).toBe(true);
      expect(sh.ads, gun).toBeUndefined();
      expect(MODS[shieldOf(gun)].slot).toBe('sight');
    }
  });

  it('sets up Billhook, Bodkin, Autoclave, and Gaff base defs and mods cleanly', () => {
    expect(WEAPONS.billhook.pellets).toBe(6);
    expect(WEAPONS.billhook.damage).toBe(26);
    expect(WEAPONS.billhook.magSize).toBe(8);
    expect(WEAPONS.billhook.spread).toBe(WEAPONS.shotgun.spread);
    const slug = moddedDef('billhook', new Set<ModId>(['billhookSlug', 'billhookTube']));
    expect(slug.pellets).toBe(1);
    expect(slug.spread).toBe(0);
    expect(slug.damage).toBe(200);
    expect(slug.magSize).toBe(11);

    expect(WEAPONS.bodkin.magSize).toBe(24);
    expect(WEAPONS.bodkin.interval).toBeCloseTo(60 / 1200, 5);
    expect(WEAPONS.bodkin.load).toBe('flechette');
    expect(WEAPONS.bodkin.armorPiercing).toBe(true);
    expect(WEAPONS.bodkin.select?.burst?.rounds).toBe(3);
    const bodMod = moddedDef('bodkin', new Set<ModId>(['bodkinMag', 'bodkinBurst5', 'bodkinTungsten']));
    expect(bodMod.magSize).toBe(36);
    expect(bodMod.select?.burst?.rounds).toBe(5);
    expect(bodMod.penetration).toBe(3.2);
    expect(bodMod.bossDamage).toBe(65);

    expect(WEAPONS.autoclave.slot).toBe(7);
    expect(WEAPONS.autoclave.microwave).toBe(true);
    expect(WEAPONS.gaff.slot).toBe(0);
    expect(WEAPONS.gaff.harpoon).toBe(true);
    expect(WEAPONS.gaff.damage).toBe(550);
  });
});
