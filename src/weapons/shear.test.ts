/**
 * SHEAR delayed-blowback hyperburst assault rifle (Key 1):
 * - 2-round 1,800 RPM zero-climb opening hyperburst seamlessly transitioning into 600 RPM full auto
 * - Trigger-release reset for chained hyperbursts
 * - Hold R fire selector (HYPER AUTO / 2-RD BURST / SEMI)
 * - All 15 Procurement mods, slot exclusivity, shop wares, remote watcher rows, and viewmodel parts/muzzle shifts
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModId } from '../core/gameplay';
import { MOD_WARES, WEAPON_WARES, modWares, weaponWares } from '../contracts/shop/data';
import { WEAPON_PRICES } from '../contracts/defense/data';
import { CACHE_ORDER } from '../progression/data';
import { WEAPONS } from './data';
import { familyOfSlot } from './families';
import { MODS, MOD_ORDER, moddedDef } from './mods';
import { REMOTE_FX, REMOTE_MODS } from './watch';
import { Kit } from './viewmodels/kit/kit';
import type { VmMaterials } from './viewmodels/kit/materials';
import { buildDefs } from './viewmodels/models';
import { dressModel } from './viewmodels/rest';
import { makeRange, type Range } from './testkit';

const SHEAR_MODS: readonly ModId[] = [
  'shearDot', 'shearAcog', 'shearBurst3', 'shearFast', 'shearMag',
  'shearLong', 'shearShort', 'shearCan', 'shearBrake',
  'shearAp', 'shearHp', 'shearPlusP',
  'shearMagwell', 'shearLight', 'shearLam',
];

let r: Range;
beforeEach(async () => {
  r = await makeRange();
  r.reset();
});

function drawShear(mods: readonly ModId[] = []): void {
  r.weapons.give('shear');
  r.weapons.switchTo('shear');
  for (const id of mods) {
    r.weapons.grantMod(id);
    expect(r.weapons.fitMod(id, true), id).toBe(true);
  }
  r.weapons.refillMagazines();
  r.run(0.5);
  expect(r.weapons.current).toBe('shear');
}

function holdReload(seconds = 0.4): void {
  r.input.simulate('reload', true);
  r.run(seconds);
  r.input.simulate('reload', false);
  r.run(1 / 60);
}

describe('SHEAR hyperburst rifle on paper & shop catalogue', () => {
  it('sits on Key 1 beside Harrow and Bodkin with zero spread, 30-rd mag, 1,800 RPM 2-rd hyperburst into 600 RPM auto', () => {
    const s = WEAPONS.shear;
    expect(familyOfSlot(1)).toEqual(['smg', 'gimlet', 'harrow', 'shear', 'bodkin', 'flail']);
    expect(s.base).toBe('smg');
    expect(s.spread).toBe(0);
    expect(s.magSize).toBe(30);
    expect(s.damage).toBe(44);
    expect(60 / s.interval).toBeCloseTo(600, 4);
    expect(s.hyperBurst).toBeDefined();
    expect(s.hyperBurst!.rounds).toBe(2);
    expect(60 / s.hyperBurst!.interval).toBeCloseTo(1800, 4);
    expect(s.select?.modes).toEqual(['auto', 'burst', 'semi']);
    expect(CACHE_ORDER).toContain('shear');
    expect(WEAPON_PRICES.shear?.loadout).toBe('primary');
    expect(REMOTE_FX.shear.kind).toBe('rounds');
  });

  it('registers all 15 mods in MODS, MOD_ORDER, shop wares, and REMOTE_MODS with unlocks before wave 10 in Endless Humans', () => {
    expect(WEAPON_WARES.shear?.price).toBe(1150);
    expect(weaponWares('outpost').shear!.wave).toBeLessThan(10);
    const ehMods = modWares('outpost');
    for (const id of SHEAR_MODS) {
      expect(MODS[id]?.weapon, id).toBe('shear');
      expect(MOD_ORDER, id).toContain(id);
      expect(MOD_WARES[id]?.price, id).toBeGreaterThan(0);
      expect(ehMods[id]!.wave, id).toBeLessThan(10);
      expect(REMOTE_MODS[id], id).toBeDefined();
    }
  });

  it('enforces slot mutual exclusions and accurate stat patches across all 15 mods', () => {
    // Optics
    expect(MODS.shearDot.slot).toBe('sight');
    expect(MODS.shearAcog.slot).toBe('sight');
    // Trigger group: 3-rd hyperburst vs 800 RPM sustained sear
    expect(MODS.shearBurst3.slot).toBe('trigger');
    expect(MODS.shearFast.slot).toBe('trigger');
    const burst3 = moddedDef('shear', new Set<ModId>(['shearBurst3']));
    expect(burst3.hyperBurst!.rounds).toBe(3);
    expect(60 / burst3.hyperBurst!.interval).toBeCloseTo(2100, 3);
    const fast = moddedDef('shear', new Set<ModId>(['shearFast']));
    expect(60 / fast.interval).toBeCloseTo(800, 3);
    expect(fast.hyperBurst!.rounds).toBe(2);
    // Magazine
    const mag = moddedDef('shear', new Set<ModId>(['shearMag']));
    expect(mag.magSize).toBe(60);
    expect(mag.reloadTime).toBeGreaterThan(WEAPONS.shear.reloadTime);
    // Barrels
    expect(MODS.shearLong.slot).toBe('barrel');
    expect(MODS.shearShort.slot).toBe('barrel');
    const longB = moddedDef('shear', new Set<ModId>(['shearLong']));
    expect(longB.damage).toBeCloseTo(52, 4);
    expect(longB.penetration).toBeGreaterThan(WEAPONS.shear.penetration);
    expect(longB.falloff).toBeUndefined();
    const shortB = moddedDef('shear', new Set<ModId>(['shearShort']));
    expect(shortB.interval).toBeCloseTo(WEAPONS.shear.interval / 1.15, 5);
    expect(shortB.drawTime).toBeLessThan(WEAPONS.shear.drawTime);
    expect(shortB.ads!.time).toBeLessThan(WEAPONS.shear.ads!.time);
    // Muzzles
    expect(MODS.shearCan.slot).toBe('muzzle');
    expect(MODS.shearBrake.slot).toBe('muzzle');
    const brake = moddedDef('shear', new Set<ModId>(['shearBrake']));
    expect(brake.climb!.pitch).toBeCloseTo(WEAPONS.shear.climb!.pitch * 0.55, 6);
    expect(brake.kick).toBeCloseTo(WEAPONS.shear.kick * 0.65, 6);
    expect(brake.hyperBurst!.recover).toBeCloseTo(WEAPONS.shear.hyperBurst!.recover * 0.85, 6);
    const can = moddedDef('shear', new Set<ModId>(['shearCan']));
    expect(can.muzzle).toBe('suppressed');
    // Ammo
    expect(MODS.shearAp.slot).toBe('ammo');
    expect(MODS.shearHp.slot).toBe('ammo');
    expect(MODS.shearPlusP.slot).toBe('ammo');
    expect(moddedDef('shear', new Set<ModId>(['shearPlusP'])).damage).toBeCloseTo(WEAPONS.shear.damage * 1.2, 4);
    // Magwell stacks with 60-rd casket mag
    const magAndWell = moddedDef('shear', new Set<ModId>(['shearMag', 'shearMagwell']));
    expect(magAndWell.reloadTime).toBeCloseTo(mag.reloadTime * 0.85, 5);
  });
});

describe('SHEAR firing range behaviour', () => {
  it('fires 2 zero-climb rounds at 1,800 RPM then seamlessly transitions to 600 RPM auto with muzzle climb', () => {
    drawShear();
    const target = r.enemies.add(0, -14, 5000);
    const hitTimes: number[] = [];
    const pitches: number[] = [];

    r.input.simulate('fire', true);
    let elapsed = 0;
    const fps = 240;
    const step = 1 / fps;
    for (let i = 0; i < 80; i++) {
      const before = target.hits.length;
      r.run(step, fps);
      elapsed += step;
      if (target.hits.length > before) {
        for (let k = before; k < target.hits.length; k++) {
          hitTimes.push(elapsed);
          pitches.push(r.player.pitch);
        }
      }
    }
    r.input.simulate('fire', false);

    // At least 4 shots in ~0.33 s: shot 0 at ~0s, shot 1 at ~0.033s, shot 2 at ~0.133s, shot 3 at ~0.233s
    expect(hitTimes.length).toBeGreaterThanOrEqual(4);
    // Hyperburst spacing: 1,800 RPM = 0.0333 s
    expect(hitTimes[1]! - hitTimes[0]!).toBeCloseTo(1 / 30, 2);
    // Transition to 600 RPM sustained auto = 0.10 s
    expect(hitTimes[2]! - hitTimes[1]!).toBeCloseTo(0.1, 2);
    expect(hitTimes[3]! - hitTimes[2]!).toBeCloseTo(0.1, 2);
    // Zero climb during the 2-round hyperburst; climb engages on round 3+
    expect(pitches[0]).toBe(0);
    expect(pitches[1]).toBe(0);
    expect(pitches[2]!).toBeGreaterThan(0);
    expect(pitches[3]!).toBeGreaterThan(pitches[2]!);
    expect(r.record.sounds).toContain('shear_shot');
  });

  it('re-arms the zero-climb hyperburst cleanly after releasing and re-pulling the trigger', () => {
    drawShear();
    const target = r.enemies.add(0, -14, 5000);

    // First brief tap fires the 2-round zero-climb hyperburst
    r.tap('fire');
    r.run(0.08, 240);
    expect(target.hits.length).toBe(2);
    expect(r.player.pitch).toBe(0);

    // Wait past resetDelay (0.14 s) so hyperburst re-arms, then tap again
    r.run(0.2, 60);
    r.tap('fire');
    r.run(0.08, 240);
    expect(target.hits.length).toBe(4);
    expect(r.player.pitch).toBe(0);
  });

  it('upgrades to a 3-round 2,100 RPM zero-climb hyperburst when shearBurst3 is fitted', () => {
    drawShear(['shearBurst3']);
    const target = r.enemies.add(0, -14, 5000);
    const hitTimes: number[] = [];
    const pitches: number[] = [];

    r.input.simulate('fire', true);
    let elapsed = 0;
    const fps = 240;
    const step = 1 / fps;
    for (let i = 0; i < 65; i++) {
      const before = target.hits.length;
      r.run(step, fps);
      elapsed += step;
      if (target.hits.length > before) {
        for (let k = before; k < target.hits.length; k++) {
          hitTimes.push(elapsed);
          pitches.push(r.player.pitch);
        }
      }
    }
    r.input.simulate('fire', false);

    expect(hitTimes.length).toBeGreaterThanOrEqual(4);
    // 3-round hyperburst at 2,100 RPM (~0.0286 s between rounds 0-1 and 1-2)
    expect(hitTimes[1]! - hitTimes[0]!).toBeCloseTo(60 / 2100, 2);
    expect(hitTimes[2]! - hitTimes[1]!).toBeCloseTo(60 / 2100, 2);
    // Round 4 enters sustained 600 RPM auto (0.10 s)
    expect(hitTimes[3]! - hitTimes[2]!).toBeCloseTo(0.1, 2);
    // All 3 hyperburst rounds have zero climb; round 4 climbs
    expect(pitches[0]).toBe(0);
    expect(pitches[1]).toBe(0);
    expect(pitches[2]).toBe(0);
    expect(pitches[3]!).toBeGreaterThan(0);
  });

  it('cycles HYPER AUTO -> 2-RD BURST -> SEMI on Hold R', () => {
    drawShear();
    expect(r.weapons.ammoMode).toBe('HYPER');

    // Hold R -> BURST
    holdReload();
    expect(r.weapons.ammoMode).toBe('BURST');
    const target = r.enemies.add(0, -14, 5000);
    r.input.simulate('fire', true);
    r.run(0.35, 120);
    r.input.simulate('fire', false);
    // Burst mode stops after the 2-round hyperburst even with trigger held
    expect(target.hits.length).toBe(2);
    expect(r.player.pitch).toBe(0);

    // Hold R -> SEMI
    holdReload();
    expect(r.weapons.ammoMode).toBe('SEMI');
    r.input.simulate('fire', true);
    r.run(0.3, 60);
    r.input.simulate('fire', false);
    expect(target.hits.length).toBe(3);

    // Hold R -> back to HYPER
    holdReload();
    expect(r.weapons.ammoMode).toBe('HYPER');
  });
});

describe('SHEAR viewmodel parts and muzzle shifts', () => {
  it('wires all 15 mod parts and shifts muzzle for long barrel, short barrel, and suppressor', () => {
    vi.stubGlobal('document', {
      createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }),
    });
    const material = new THREE.MeshStandardMaterial();
    const mats = {
      hard: material,
      decal: material,
      decalRegions: new Proxy({}, { get: () => [0, 0, 1, 1] }),
      glow: (c: number) => new THREE.MeshBasicMaterial({ color: c }),
    } as unknown as VmMaterials;
    const defs = buildDefs(new Kit(mats));
    vi.unstubAllGlobals();

    const def = defs.shear!;
    expect(def).toBeDefined();

    const muzzleZ = (mods: ModId[]): number => {
      const built = def.model;
      dressModel(built.root, def, new Set(mods));
      built.root.updateMatrixWorld(true);
      let sockName = 'muzzle';
      for (const id of mods) {
        const m = def.mods?.[id]?.muzzle;
        if (m) sockName = m;
      }
      const p = new THREE.Vector3();
      built.sockets[sockName]!.getWorldPosition(p);
      return p.z;
    };

    const baseZ = muzzleZ([]);
    const longZ = muzzleZ(['shearLong']);
    const shortZ = muzzleZ(['shearShort']);
    const brakeZ = muzzleZ(['shearBrake']);
    const canZ = muzzleZ(['shearCan']);
    const longCanZ = muzzleZ(['shearLong', 'shearCan']);

    // More negative Z = further forward toward the muzzle
    expect(longZ).toBeLessThan(baseZ - 0.05);
    expect(shortZ).toBeGreaterThan(baseZ + 0.05);
    expect(brakeZ).toBeLessThan(baseZ - 0.01);
    expect(canZ).toBeLessThan(baseZ - 0.1);
    expect(longCanZ).toBeLessThan(canZ - 0.05);
  });
});
