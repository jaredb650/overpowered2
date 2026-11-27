/**
 * Bodkin OICW 20 mm Smart Airburst Launcher (`bodkinOicw`):
 * - Hold R toggles Flechette Rifle <-> 20 mm Smart Launcher while preserving Bodkin burst/auto fire mode
 * - 5-round semi-auto magazine, fast flat-arc impact grenades by default
 * - ADS through TA/FCS optic (inheriting bodkinAcog magnification), live laser rangefinder
 * - Tap Shift while ADS locks programmed airburst distance (+1.5 m past lased wall/cover) without dashing or triggering breath-zoom
 * - Re-lasing same spot or sky clears back to impact mode
 * - Mid-air airburst detonation + downward/radial shrapnel rays hitting enemies behind cover; early-impact failsafe
 * - Viewmodel oicw parts & muzzle1 socket
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModId } from '../core/gameplay';
import { MOD_WARES, modWares } from '../contracts/shop/data';
import { OICW_LAUNCHER, TUNING } from './data';
import { MODS, MOD_ORDER } from './mods';
import { REMOTE_MODS } from './watch';
import { Kit } from './viewmodels/kit/kit';
import type { VmMaterials } from './viewmodels/kit/materials';
import { buildDefs } from './viewmodels/models';
import { dressModel } from './viewmodels/rest';
import { makeRange, type Range } from './testkit';

let r: Range;
beforeEach(async () => {
  r = await makeRange();
  r.reset();
});

function drawBodkinOicw(extra: readonly ModId[] = []): void {
  r.weapons.give('bodkin');
  r.weapons.switchTo('bodkin');
  for (const id of ['bodkinOicw', ...extra] as ModId[]) {
    r.weapons.grantMod(id);
    expect(r.weapons.fitMod(id, true), id).toBe(true);
  }
  r.weapons.refillMagazines();
  r.run(0.5);
  expect(r.weapons.current).toBe('bodkin');
}

function holdReload(seconds = 0.4): void {
  r.input.simulate('reload', true);
  r.run(seconds);
  r.input.simulate('reload', false);
  r.run(0.35);
}

function lookPitch(pitch: number): void {
  r.player.pitch = pitch;
  r.player.forward.set(0, Math.sin(pitch), -Math.cos(pitch));
}

describe('Bodkin OICW 20mm launcher data, catalogue, and viewmodel', () => {
  it('registers bodkinOicw across MODS, MOD_ORDER, shop catalogue, and REMOTE_MODS, and is faster/flatter than Gimlet 40mm', () => {
    expect(MODS.bodkinOicw.weapon).toBe('bodkin');
    expect(MOD_ORDER).toContain('bodkinOicw');
    expect(MOD_WARES.bodkinOicw.price).toBe(1500);
    expect(modWares('outpost').bodkinOicw.wave).toBeLessThan(10);
    expect(REMOTE_MODS.bodkinOicw.look).toBe('shell');

    // Faster & flatter ballistic profile than Gimlet's 40mm under-barrel launcher
    expect(OICW_LAUNCHER.magSize).toBe(5);
    expect(OICW_LAUNCHER.grenade!.speed).toBeGreaterThan(TUNING.launcher.speed);
    expect(OICW_LAUNCHER.grenade!.gravity).toBeLessThan(TUNING.launcher.gravity);
    expect(OICW_LAUNCHER.ads).toBeDefined();
  });

  it('builds the OICW over-barrel assembly and muzzle1 socket when bodkinOicw is fitted', () => {
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

    const def = defs.bodkin!;
    const built = def.model;
    dressModel(built.root, def, new Set<ModId>(['bodkinOicw']));
    expect(built.parts.oicw?.visible).toBe(true);
    expect(built.sockets.muzzle1).toBeDefined();
    expect(built.sockets.oicwBoltHold).toBeDefined();
    // Over-barrel muzzle1 sits above the flechette barrel muzzle
    expect(built.sockets.muzzle1!.position.y).toBeGreaterThan(built.sockets.muzzle!.position.y);
  });
});

describe('Bodkin OICW toggle, ADS rangefinder, Shift-to-lase, and airburst physics', () => {
  it('toggles Flechette <-> 20mm via Hold R while preserving Bodkin 3-round burst on the rifle', () => {
    drawBodkinOicw();
    expect(r.weapons.launcherUp).toBe(false);
    expect(r.weapons.ammo().mag).toBe(24);
    expect(r.weapons.ammoMode).toBe('FLECHETTE · BURST');

    // Rifle still fires 3-round burst when bodkinOicw is fitted
    const target = r.enemies.add(0, -12, 2000);
    r.tap('fire');
    r.run(0.2, 120);
    expect(target.hits.length).toBe(3);
    expect(r.weapons.ammo().mag).toBe(21);

    // Hold R switches to 20mm launcher (5-rd mag, 15 reserve)
    holdReload();
    expect(r.weapons.launcherUp).toBe(true);
    expect(r.weapons.ammo().mag).toBe(5);
    expect(r.weapons.ammo().reserve).toBe(15);
    expect(r.weapons.ammoMode).toBe('20MM IMPACT');
    expect(r.weapons.oicw.active).toBe(true);
    expect(r.weapons.oicw.locked).toBeNull();

    // Hold R switches back to Flechette rifle with its untouched 21-rd mag
    holdReload();
    expect(r.weapons.launcherUp).toBe(false);
    expect(r.weapons.ammo().mag).toBe(21);
    expect(r.weapons.oicw.active).toBe(false);
  });

  it('lases wall distance + 1.5 m on Shift while ADS without dashing or breath-zoom, and clears on re-lase or sky', () => {
    drawBodkinOicw(['bodkinAcog']);
    holdReload();
    expect(r.weapons.launcherUp).toBe(true);

    // Wall with near face at z = -14.5 from player eye at z = 0
    r.wall(-14.5, 1);

    // Hip-fire: oicw not aiming, aimHeld false (dash allowed), Shift does not lase
    expect(r.weapons.aimHeld).toBe(false);
    r.tap('dash');
    r.run(0.05);
    expect(r.weapons.oicw.locked).toBeNull();

    // Enter ADS on 20mm launcher
    r.tap('aim');
    r.run(0.35);
    expect(r.weapons.aim).toBe(1);
    expect(r.weapons.aimHeld).toBe(true); // blocks Player.ts dash!
    expect(r.weapons.oicw.aiming).toBe(true);
    expect(r.weapons.oicw.range).toBeCloseTo(14.5, 1);

    // Tap Shift while ADS -> locks programmed airburst at 14.5 + 1.5 = 16.0 m
    r.tap('dash');
    r.run(0.05);
    expect(r.weapons.oicw.locked).toBeCloseTo(14.5 + TUNING.oicw.offset, 1);
    expect(r.weapons.ammoMode).toBe(`20MM AB ${(14.5 + TUNING.oicw.offset).toFixed(1)}M`);
    // Breath-zoom stays off on 20mm launcher
    expect(r.weapons.adsZoom.on).toBe(false);

    // Re-tapping Shift on the same lased spot clears back to impact mode
    r.tap('dash');
    r.run(0.05);
    expect(r.weapons.oicw.locked).toBeNull();
    expect(r.weapons.ammoMode).toBe('20MM IMPACT');

    // Lock again, then aim up at open sky and tap Shift -> clears back to impact mode
    r.tap('dash');
    r.run(0.05);
    expect(r.weapons.oicw.locked).toBeCloseTo(16.0, 1);
    lookPitch(0.9);
    r.run(0.05);
    expect(r.weapons.oicw.range).toBeNull();
    r.tap('dash');
    r.run(0.05);
    expect(r.weapons.oicw.locked).toBeNull();
  });

  it('detonates programmed 20mm shell mid-air past a cover wall and hits enemies crouched behind it', () => {
    drawBodkinOicw();
    holdReload();

    // Low cover wall: near face at z = -14.5, thickness 1 m (z = -14.5..-15.5), height 1.6 m (top at y = 1.6)
    r.physics.addStaticBox(new THREE.Vector3(0, 0.8, -15), new THREE.Vector3(4, 0.8, 0.5), null, 'concrete');
    r.physics.flushQueries();
    // Enemy hiding behind the wall at z = -17.0
    const behindCover = r.enemies.add(0, -17.0, 200);

    // ADS straight into the cover wall (player eye at y = 1.0 hits the wall at z = -14.5) and Shift-lase -> 16.0 m
    r.tap('aim');
    r.run(0.35);
    expect(r.weapons.oicw.range).toBeCloseTo(14.5, 1);
    r.tap('dash');
    r.run(0.05);
    expect(r.weapons.oicw.locked).toBeCloseTo(16.0, 1);

    // Aim cleanly over the top edge of the wall (top at y = 1.6 at 14.5 m -> pitch +0.09 rad clears it by ~0.7 m)
    lookPitch(0.09);
    r.run(0.05);
    r.tap('fire');
    // Fly shell past 16 m at 75 m/s (~0.22 s)
    r.run(0.4, 120);

    // Enemy behind cover took blast/shrapnel damage from the overhead mid-air detonation!
    expect(behindCover.hits.length).toBeGreaterThan(0);
    expect(behindCover.health).toBeLessThan(200);
    // Mid-air blast occurred around z = -16.0 (past the wall at -15.5)
    expect(r.record.blasts.length).toBe(1);
    expect(r.record.blasts[0]!.z).toBeLessThan(-15.5);
    // Shell retired cleanly after detonating
    expect(r.combat.projectiles.active.length).toBe(0);
  });

  it('explodes immediately on impact (failsafe) when a wall is closer than the locked airburst distance', () => {
    drawBodkinOicw();
    holdReload();

    // Far wall with near face at z = -24.5 -> lase locks 26.0 m
    r.wall(-24.5, 1);
    r.tap('aim');
    r.run(0.35);
    r.tap('dash');
    r.run(0.05);
    expect(r.weapons.oicw.locked).toBeCloseTo(26.0, 1);

    // Now place a closer wall with near face at z = -7.5 and fire straight into it
    r.wall(-7.5, 1);
    r.tap('fire');
    // 7.5 m at 75 m/s = 0.10 s; by 0.16 s it must have impacted and retired (NOT flown to 26 m / 0.35 s)
    r.run(0.16, 120);
    expect(r.combat.projectiles.active.length).toBe(0);
    expect(r.record.explosions).toBe(1);
    // Explosion happened near z = -7.5, well short of 26 m
    expect(r.record.blasts[0]!.z).toBeGreaterThan(-10);
  });
});
