/**
 * Lane H (Bodkin flechette bullpup rifle): firing-range behaviour (3-rd / 5-rd 1200 RPM bursts, hold-R semi-auto,
 * zero spread, flechette load, plate bypass, multi-body & wall penetration, tungsten boss damage, 36-rd mag,
 * flared magwell reload speed) and viewmodel contract (all 6 mod parts, light & handguard grip frames,
 * live clear-magazine dart countdown, and zero roll/twist reload animation).
 */
import * as THREE from 'three';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModId } from '../core/gameplay';
import { WEAPONS } from './data';
import { familyOfSlot } from './families';
import { MODS, moddedDef } from './mods';
import { makeRange, type Range } from './testkit';
import { Anim, ironsUp } from './viewmodels/def';
import { Kit } from './viewmodels/kit/kit';
import type { VmMaterials } from './viewmodels/kit/materials';
import { bodkinDef } from './viewmodels/models/bodkin';
import { HANDS } from './viewmodels/poses';
import { dressModel, restingModel } from './viewmodels/rest';

let r: Range;
let callouts: string[];

beforeEach(async () => {
  r = await makeRange();
  r.reset();
  callouts = [];
  (r.ctx.hud as { callout?: (t: string) => void }).callout = t => callouts.push(t);
});

function drawBodkin(): void {
  r.weapons.give('bodkin');
  r.weapons.switchTo('bodkin');
  r.run(0.6);
  expect(r.weapons.current).toBe('bodkin');
}

function holdR(seconds: number): void {
  r.input.simulate('reload', true);
  r.run(seconds);
  r.input.simulate('reload', false);
  r.run(1 / 60);
}

describe('Bodkin firing range behaviour', () => {
  it('fires 3-round 1200 RPM bursts (0.05 s spacing, 0.25 s recover) with zero spread, flechette load, and plate bypass', () => {
    expect(familyOfSlot(1)).toEqual(['smg', 'gimlet', 'harrow', 'shear', 'bodkin', 'flail']);
    expect(WEAPONS.bodkin.spread).toBe(0);
    expect(WEAPONS.bodkin.interval).toBeCloseTo(0.05, 6);
    expect(WEAPONS.bodkin.load).toBe('flechette');
    expect(WEAPONS.bodkin.armorPiercing).toBe(true);
    expect(WEAPONS.bodkin.canSever).toBe(false);

    drawBodkin();
    // Armoured target standing 12 m straight down the bore.
    const target = r.enemies.add(0, -12, 1000);
    target.armor = 100;

    // Track exact timestamps of each dart landing during one held trigger pull at 240 Hz.
    const hitTimes: number[] = [];
    let lastCount = 0;
    r.input.simulate('fire', true);
    for (let i = 0; i < 120; i++) {
      r.run(1 / 240, 240);
      if (target.hits.length > lastCount) {
        for (let k = lastCount; k < target.hits.length; k++) hitTimes.push(r.ctx.time.elapsed);
        lastCount = target.hits.length;
      }
    }
    r.input.simulate('fire', false);

    // One pull held 0.5 s fires exactly one 3-round burst (no full-auto).
    expect(r.weapons.ammo('bodkin').mag).toBe(21);
    expect(target.hits).toHaveLength(3);
    // 1200 RPM = 0.05 s spacing between darts within the burst.
    expect(hitTimes[1]! - hitTimes[0]!).toBeCloseTo(0.05, 2);
    expect(hitTimes[2]! - hitTimes[1]!).toBeCloseTo(0.05, 2);

    // Every dart carries flechette load, pierces armour plates, and lands at the exact same point (zero spread).
    for (const h of target.hits) {
      expect(h.load).toBe('flechette');
      expect(h.pierces).toBe(true);
      expect(h.amount).toBe(38);
      expect(h.point.distanceTo(target.hits[0]!.point)).toBeLessThan(1e-5);
    }
    expect(target.health).toBe(1000 - 38 * 3);

    // During the 0.25 s recover window after the 3rd dart (~0.10 s), a pull does not immediately fire; after recover it fires.
    r.weapons.ammo('bodkin').mag = 24;
    target.hits.length = 0;
    r.tap('fire');
    r.run(0.12); // burst finishes at ~0.10 s, now 0.02 s into 0.25 s recover
    expect(target.hits).toHaveLength(3);
    r.tap('fire'); // too early during 0.25 s recover
    r.run(0.10);
    expect(target.hits).toHaveLength(3);
    r.run(0.20); // recover expired
    r.tap('fire');
    r.run(0.20);
    expect(target.hits).toHaveLength(6);
  });

  it('switches between 3-round burst and semi-auto (1 round per pull) via hold R without triggering a reload', () => {
    drawBodkin();
    r.weapons.ammo('bodkin').mag = 12;
    expect(r.weapons.ammoMode).toBe('FLECHETTE · BURST');

    // Hold R switches from burst to semi-auto.
    holdR(WEAPONS.bodkin.select!.hold + 0.05);
    expect(r.weapons.reloading).toBe(false);
    expect(r.weapons.ammoMode).toBe('FLECHETTE · SEMI');
    expect(callouts).toEqual(['SEMI']);
    expect(r.record.sounds).toContain('fire_select');

    // Held trigger in semi-auto fires exactly 1 dart.
    r.input.simulate('fire', true);
    r.run(0.5);
    r.input.simulate('fire', false);
    r.run(0.1);
    expect(r.weapons.ammo('bodkin').mag).toBe(11);

    // Second tap fires 1 more dart.
    r.tap('fire');
    r.run(0.15);
    expect(r.weapons.ammo('bodkin').mag).toBe(10);

    // Hold R switches back to burst mode.
    holdR(WEAPONS.bodkin.select!.hold + 0.05);
    expect(r.weapons.ammoMode).toBe('FLECHETTE · BURST');
    r.tap('fire');
    r.run(0.4);
    expect(r.weapons.ammo('bodkin').mag).toBe(7);
  });

  it('fires 5-round bursts per pull with bodkinBurst5 fitted', () => {
    r.weapons.grantMod('bodkinBurst5');
    r.weapons.fitMod('bodkinBurst5', true);
    drawBodkin();

    const target = r.enemies.add(0, -10, 1000);
    r.input.simulate('fire', true);
    r.run(0.7);
    r.input.simulate('fire', false);

    expect(r.weapons.ammo('bodkin').mag).toBe(19);
    expect(target.hits).toHaveLength(5);
    expect(target.health).toBe(1000 - 38 * 5);

    // Hold R still switches cleanly to semi-auto even with 5-round burst fitted.
    holdR(WEAPONS.bodkin.select!.hold + 0.05);
    expect(r.weapons.ammoMode).toBe('FLECHETTE · SEMI');
    r.tap('fire');
    r.run(0.2);
    expect(r.weapons.ammo('bodkin').mag).toBe(18);
  });

  it('converts burst to sustained full-auto with bodkinAuto fitted, shares trigger slot with bodkinBurst5, and still toggles semi-auto', () => {
    expect(MODS.bodkinAuto.weapon).toBe('bodkin');
    expect(MODS.bodkinAuto.slot).toBe('trigger');
    expect(MODS.bodkinBurst5.slot).toBe('trigger');

    r.weapons.grantMod('bodkinBurst5');
    r.weapons.grantMod('bodkinAuto');
    r.weapons.fitMod('bodkinBurst5', true);
    r.weapons.fitMod('bodkinAuto', true);
    expect(r.weapons.fitted.has('bodkinAuto')).toBe(true);
    expect(r.weapons.fitted.has('bodkinBurst5')).toBe(false);

    drawBodkin();
    expect(r.weapons.ammoMode).toBe('FLECHETTE');
    const target = r.enemies.add(0, -10, 2000);
    r.input.simulate('fire', true);
    r.run(0.8);
    r.input.simulate('fire', false);
    // Sustained full-auto fires well past a 3-round or 5-round burst on one trigger hold.
    expect(target.hits.length).toBeGreaterThanOrEqual(8);
    expect(r.weapons.ammo('bodkin').mag).toBe(24 - target.hits.length);

    // Hold R switches full-auto to semi-auto (1 round per pull) and back.
    holdR(WEAPONS.bodkin.select!.hold + 0.05);
    expect(r.weapons.ammoMode).toBe('FLECHETTE · SEMI');
    const magBefore = r.weapons.ammo('bodkin').mag;
    r.input.simulate('fire', true);
    r.run(0.4);
    r.input.simulate('fire', false);
    expect(r.weapons.ammo('bodkin').mag).toBe(magBefore - 1);
  });


  it('applies bodkinMag (36 rounds), bodkinMagwell (-15% reload time), and bodkinTungsten (3.2 m pen & 65 bossDamage)', () => {
    // Extended magazine: 24 -> 36 rounds.
    r.weapons.grantMod('bodkinMag');
    r.weapons.fitMod('bodkinMag', true);
    expect(moddedDef('bodkin', new Set<ModId>(['bodkinMag'])).magSize).toBe(36);

    // Flared magwell: 15% faster reload (1.2 s -> 1.02 s), stacks with extended mag.
    r.weapons.grantMod('bodkinMagwell');
    r.weapons.fitMod('bodkinMagwell', true);
    const fastDef = moddedDef('bodkin', new Set<ModId>(['bodkinMag', 'bodkinMagwell']));
    expect(fastDef.magSize).toBe(36);
    expect(fastDef.reloadTime).toBeCloseTo(WEAPONS.bodkin.reloadTime * 0.85, 5);

    drawBodkin();
    expect(r.weapons.ammo('bodkin').magSize).toBe(36);
    // Empty reload finishes right after 1.02 s (before unmodded 1.2 s).
    r.weapons.ammo('bodkin').mag = 0;
    r.input.simulate('reload', true);
    r.run(0.05);
    r.input.simulate('reload', false);
    r.run(1 / 60);
    expect(r.weapons.reloading).toBe(true);
    r.run(0.95);
    expect(r.weapons.reloading).toBe(true);
    r.run(0.12);
    expect(r.weapons.reloading).toBe(false);
    expect(r.weapons.ammo('bodkin').mag).toBe(36);

    // Tactical reload (round already chambered) skips bolt rack and finishes faster (~0.80 s).
    r.weapons.ammo('bodkin').mag = 6;
    r.input.simulate('reload', true);
    r.run(0.05);
    r.input.simulate('reload', false);
    r.run(0.84);
    expect(r.weapons.reloading).toBe(false);
    expect(r.weapons.ammo('bodkin').mag).toBe(36);

    // Tungsten darts: 3.2 m wall penetration and 65 bossDamage.
    const tungDef = moddedDef('bodkin', new Set<ModId>(['bodkinTungsten']));
    expect(tungDef.penetration).toBe(3.2);
    expect(tungDef.bossDamage).toBe(65);
    expect(tungDef.tracer).toBe('sabot');

    // Place a 2.2 m thick solid concrete wall at z = -4 (stops standard 1.6 m Bodkin, pierced by 3.2 m Tungsten!).
    r.wall(-4, 2.2);
    const behindWall = r.enemies.add(0, -10, 1000);

    // Bare darts (1.6 m pen) cannot pierce a 2.2 m wall.
    r.tap('fire');
    r.run(0.3);
    expect(behindWall.hits).toHaveLength(0);

    // Fit tungsten darts (3.2 m pen) and switch to semi-auto to verify a single dart pierces the 2.2 m wall.
    r.weapons.grantMod('bodkinTungsten');
    r.weapons.fitMod('bodkinTungsten', true);
    r.run(0.3);
    holdR(WEAPONS.bodkin.select!.hold + 0.05);
    r.tap('fire');
    r.run(0.2);
    expect(behindWall.hits).toHaveLength(1);

    // Against a boss target (in front of the wall), tungsten darts deal 65 damage per dart instead of 38.
    const boss = r.enemies.add(0, -2.5, 1000);
    boss.isBoss = true;
    r.tap('fire');
    r.run(0.2);
    expect(boss.hits).toHaveLength(1);
    expect(boss.hits[0]!.amount).toBe(65);
  });
});

describe('Bodkin viewmodel, mods, hands, and zero-roll animation', () => {
  afterAll(() => vi.unstubAllGlobals());

  function buildBodkinViewDef() {
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }),
      }),
    });
    const material = new THREE.MeshStandardMaterial();
    const kit = new Kit({
      hard: material,
      glass: material,
      decal: material,
      decalRegions: new Proxy({}, { get: () => [0, 0, 1, 1] }),
      glow(color: number, intensity: number) {
        const glow = new THREE.MeshBasicMaterial({ color });
        glow.color.multiplyScalar(intensity);
        glow.userData.base = glow.color.clone();
        return glow;
      },
    } as unknown as VmMaterials);
    return bodkinDef(kit);
  }

  it('wires all 6 mod parts cleanly for first-person and the shop turntable, including weapon light and shared support hand frame', () => {
    const def = buildBodkinViewDef();
    const allBodkinMods: ModId[] = ['bodkinAcog', 'bodkinMag', 'bodkinBurst5', 'bodkinTungsten', 'bodkinLight', 'bodkinMagwell'];
    for (const id of allBodkinMods) {
      expect(MODS[id].weapon).toBe('bodkin');
      const look = def.mods?.[id];
      expect(look, id).toBeDefined();
      expect(def.model.parts[look!.part], look!.part).toBeDefined();
    }
    // light.test.ts requirement: part named 'light'.
    expect(def.mods!.bodkinLight!.part).toBe('light');
    // ACOG replaces the integrated low-power rib optic (`irons: 'ribOptic'`) and provides ADS sight alignment.
    expect(def.irons).toBe('ribOptic');
    expect(def.model.parts.ribOptic).toBeDefined();
    expect(ironsUp(def, new Set())).toBe(true);
    expect(ironsUp(def, new Set<ModId>(['bodkinAcog']))).toBe(false);
    expect(def.mods!.bodkinAcog!.sight).toBeDefined();
    expect(def.mods!.bodkinAcog!.eye).toBeDefined();
    // Extended mag hides standard mag.
    expect(def.mods!.bodkinMag!.hides).toBe('magStd');
    expect(def.model.parts.magStd).toBeDefined();
    expect(def.model.parts.magExt).toBeDefined();

    // Shared handguard support frame (exact same invariants as hands.test.ts).
    expect(def.left!.pose).toBe(HANDS.support);
    const gripL = def.model.sockets[def.left!.socket]!;
    const palm = new THREE.Vector3(0, -1, 0).applyQuaternion(gripL.quaternion);
    const fingers = new THREE.Vector3(0, 0, -1).applyQuaternion(gripL.quaternion);
    expect(palm.y).toBeGreaterThan(0.7);
    expect(fingers.x).toBeGreaterThan(0.4);
    expect(def.model.sockets.muzzle).toBeDefined();
    expect(def.model.sockets.eject).toBeDefined();

    // Resting turntable clone dresses cleanly with all 6 mods fitted.
    const rest = restingModel('bodkin', def);
    dressModel(rest.root, def, new Set<ModId>(allBodkinMods));
    expect(rest.root.getObjectByName('acog')!.visible).toBe(true);
    expect(rest.root.getObjectByName('ribOptic')!.visible).toBe(false);
    expect(rest.root.getObjectByName('magExt')!.visible).toBe(true);
    expect(rest.root.getObjectByName('magStd')!.visible).toBe(false);
    expect(rest.root.getObjectByName('burstCam')!.visible).toBe(true);
    expect(rest.root.getObjectByName('tungstenMuzzle')!.visible).toBe(true);
    expect(rest.root.getObjectByName('tungstenBreech')!.visible).toBe(true);
    expect(rest.root.getObjectByName('light')!.visible).toBe(true);
    expect(rest.root.getObjectByName('magwell')!.visible).toBe(true);
  });

  it('visibly counts down clear-magazine flechette tiers as ammo decreases and keeps ZERO roll/twist during draw and reload', () => {
    const def = buildBodkinViewDef();
    const a = new Anim();
    a.model = def.model;
    a.parts = def.model.parts;
    a.magSize = 24;

    const visibleStdTiers = (mag: number): number => {
      def.model.resetParts();
      a.mag = mag;
      a.reload = -1;
      a.draw = 1;
      a.gunP.set(0, 0, 0);
      a.gunR.set(0, 0, 0);
      def.animate(a);
      let count = 0;
      for (let i = 0; i < 8; i++) if (def.model.parts[`dartStd${i}`]!.visible) count++;
      return count;
    };

    expect(visibleStdTiers(24)).toBe(8);
    expect(visibleStdTiers(12)).toBe(4);
    expect(visibleStdTiers(3)).toBe(1);
    expect(visibleStdTiers(0)).toBe(0);

    // Follower rises as ammo drops.
    def.model.resetParts();
    a.mag = 24;
    def.animate(a);
    const fullY = def.model.parts.followerStd!.position.y;
    def.model.resetParts();
    a.mag = 6;
    def.animate(a);
    const lowY = def.model.parts.followerStd!.position.y;
    expect(lowY).toBeGreaterThan(fullY + 0.04);

    // Rising-block chamber pulses vertically right after firing.
    def.model.resetParts();
    a.sinceFire = 99;
    def.animate(a);
    const chamberRestY = def.model.parts.chamber!.position.y;
    def.model.resetParts();
    a.sinceFire = 0.022;
    def.animate(a);
    expect(def.model.parts.chamber!.position.y).toBeGreaterThan(chamberRestY + 0.004);

    // Reload animation across 50 samples: strictly ZERO roll (gunR.z === 0) and ZERO yaw twist (gunR.y === 0).
    for (let step = 0; step <= 50; step++) {
      def.model.resetParts();
      a.mag = 0;
      a.draw = 1;
      a.reload = step / 50;
      a.gunP.set(0, 0, 0);
      a.gunR.set(0, 0, 0);
      a.left.begin(def.left);
      a.right.begin(def.right);
      def.animate(a);
      expect(a.gunR.z, `reload p=${a.reload} roll`).toBe(0);
      expect(a.gunR.y, `reload p=${a.reload} yaw`).toBe(0);
    }

    // Draw animation: strictly ZERO roll/yaw too.
    for (let step = 0; step <= 20; step++) {
      def.model.resetParts();
      a.reload = -1;
      a.draw = step / 20;
      a.gunP.set(0, 0, 0);
      a.gunR.set(0, 0, 0);
      def.animate(a);
      expect(a.gunR.z, `draw d=${a.draw} roll`).toBe(0);
      expect(a.gunR.y, `draw d=${a.draw} yaw`).toBe(0);
    }
  });
});
