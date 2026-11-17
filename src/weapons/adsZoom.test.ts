/** Hold the dash key while aimed: a further zoom on one breath, in place of a dash. */
import * as THREE from 'three';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHeadlessGame, type HeadlessGame } from '../player/testkit/headless';
import { ADS_ZOOM, AdsZoom, adsZoomFov } from './adsZoom';
import { WEAPONS } from './data';
import { makeRange, type Range } from './testkit';

const DEG = Math.PI / 180;
const mag = (from: number, to: number) => Math.tan((from * DEG) / 2) / Math.tan((to * DEG) / 2);

describe('zoom factor and cap', () => {
  it('narrows the view 1.5x in tan terms, as a scope magnifies', () => {
    expect(ADS_ZOOM.factor).toBeGreaterThanOrEqual(1.4);
    expect(ADS_ZOOM.factor).toBeLessThanOrEqual(1.6);
    // Iron sights at 90 x 0.65, and the ACOG's 4x.
    for (const fov of [58.5, 90 * 0.31]) expect(mag(fov, adsZoomFov(fov, ADS_ZOOM.factor))).toBeCloseTo(ADS_ZOOM.factor, 6);
    expect(adsZoomFov(70, 1)).toBe(70);
  });

  it('stacks on the Awl\'s 8x scope to the 12x cap and no further', () => {
    const awl = WEAPONS.awl.scopeFov!;
    expect(mag(90, adsZoomFov(awl, ADS_ZOOM.factor))).toBeCloseTo(12, 4);
    expect(adsZoomFov(awl, 3)).toBeCloseTo(ADS_ZOOM.minFov, 6);
    // A view already past the cap is never widened.
    expect(adsZoomFov(5, ADS_ZOOM.factor)).toBe(5);
  });
});

describe('one breath', () => {
  const step = (z: AdsZoom, seconds: number, aimed: boolean, key: boolean) => {
    for (let t = 0; t < seconds - 1e-9; t += 1 / 60) z.update(1 / 60, aimed, key);
  };

  it('eases in over about 0.15 s and out again on release', () => {
    const z = new AdsZoom();
    step(z, ADS_ZOOM.ease + 0.02, true, true);
    expect(z.mag).toBeCloseTo(ADS_ZOOM.factor, 6);
    step(z, ADS_ZOOM.ease + 0.02, true, false);
    expect(z.mag).toBe(1);
  });

  it('holds for the cap, eases out by itself, then cools before the next', () => {
    const z = new AdsZoom();
    step(z, ADS_ZOOM.hold - 0.1, true, true);
    expect(z.on).toBe(true);
    step(z, 0.3, true, true);
    expect(z.on).toBe(false);
    expect(z.mag).toBeLessThan(ADS_ZOOM.factor);
    step(z, ADS_ZOOM.ease, true, true);
    expect(z.mag).toBe(1);
    expect(z.cool).toBeGreaterThan(ADS_ZOOM.cooldown - 0.5);
    // Still held through the cooldown: it waits for the key to come up.
    step(z, ADS_ZOOM.cooldown, true, true);
    expect(z.cool).toBe(0);
    expect(z.on).toBe(false);
    step(z, 0.05, true, false);
    step(z, 0.05, true, true);
    expect(z.on).toBe(true);
  });

  it('a press during the cooldown does nothing', () => {
    const z = new AdsZoom();
    step(z, ADS_ZOOM.hold + 0.1, true, true);
    step(z, 0.1, true, false);
    step(z, 0.2, true, true);
    expect(z.on).toBe(false);
    expect(z.mag).toBe(1);
  });

  it('letting go early costs the same share of the cooldown as of the breath', () => {
    const z = new AdsZoom();
    step(z, 1, true, true);
    z.update(1 / 60, true, false);
    expect(z.cool).toBeCloseTo((ADS_ZOOM.cooldown * (1 + 1 / 60)) / ADS_ZOOM.hold, 1);
    // So does losing the aim.
    const y = new AdsZoom();
    step(y, 2, true, true);
    y.update(1 / 60, false, true);
    expect(y.on).toBe(false);
    expect(y.cool).toBeCloseTo((ADS_ZOOM.cooldown * 2) / ADS_ZOOM.hold, 1);
  });
});

describe('the dash key while aimed', () => {
  let r: Range;
  beforeEach(async () => {
    r = await makeRange();
    r.reset();
  });

  for (const hold of [false, true]) {
    it.each(['smg', 'awl'] as const)(`%s (${hold ? 'hold' : 'toggle'}): zooms and holds the dash`, id => {
      r.weapons.give(id);
      r.weapons.switchTo(id);
      r.run(0.6);
      r.weapons.aimHold = hold;
      const setAim = vi.fn();
      r.ctx.camera.setAim = setAim;
      r.input.simulate('dash', true);
      r.run(0.2);
      // From the hip the key is the dash's.
      expect(r.weapons.aimHeld).toBe(false);
      expect(r.weapons.adsZoom.on).toBe(false);
      r.input.simulate('dash', false);
      r.input.simulate('aim', true);
      r.run(0.4);
      if (!hold) r.input.simulate('aim', false);
      expect(r.weapons.aimHeld).toBe(true);
      r.input.simulate('dash', true);
      r.run(0.3);
      expect(r.weapons.adsZoom.on).toBe(true);
      expect(setAim.mock.lastCall![2]).toBeCloseTo(ADS_ZOOM.factor, 6);
      r.input.simulate('dash', false);
      r.run(0.3);
      expect(setAim.mock.lastCall![2]).toBe(1);
    });
  }
});

describe('the player', () => {
  let game: HeadlessGame;
  beforeAll(async () => {
    game = await createHeadlessGame();
  });

  const dashes = (aimHeld: boolean): boolean => {
    (game.ctx as { weapons?: unknown }).weapons = { aimHeld };
    game.player.reset();
    game.player.teleport(new THREE.Vector3(0, 1, 0), 0);
    for (let i = 0; i < 10; i++) game.frame(1 / 60);
    game.input.simulate('dash', true);
    let dashed = false;
    for (let i = 0; i < 6; i++) {
      game.frame(1 / 60);
      dashed ||= game.player.dashing;
    }
    game.input.simulate('dash', false);
    return dashed;
  };

  it('dashes from the hip, unchanged', () => expect(dashes(false)).toBe(true));
  it('does not dash while the aim is held', () => expect(dashes(true)).toBe(false));
});
