/**
 * Fire on a body, one piece at a time: a lick of flame at a point on it, a thread of smoke off what smoulders, and the
 * glow a fire throws on what it lies on. Gore's fire (gore/fire.ts) decides where and how often; these only draw one.
 * All of it is the smoke ring: torn fire, lit billows and the additive halo.
 */
import { rand } from '../../core/math';
import type { FxCore } from '../core';
import { SmokeMode } from '../layers/smoke';
import { hot } from '../layers/shared';
import { FIRE, SPARK } from '../palette';

/** Burnt-body smoke is dark and a little warm at the root, greying as it climbs: it is what is left of the fire. */
const SOOT = hot(0x1c1815, 0.8);
const SOOT_GREY = hot(0x4a4d55, 0.7);
const WISP = hot(0x6a7078, 0.6);
const GLOW = hot(0xff5a14, 0.5);

/**
 * One lick of flame at a point on a burning body, `size` metres across at its widest. `heat` 0..1: a dying fire is
 * shorter, redder and slower. A quarter of them throw a little soot off the top.
 */
export function flameLick(core: FxCore, x: number, y: number, z: number, size: number, heat: number): void {
  const b = core.birth;
  const s = core.smoke;
  const r = Math.random();
  // Yellow only at the heart of a strong fire: a dying one is orange and red.
  const color = r < 0.2 * heat ? FIRE.yellow : r < 0.3 + 0.3 * heat ? FIRE.amber : r < 0.85 ? FIRE.orange : FIRE.red;
  const life = rand(0.28, 0.5) * (0.7 + 0.3 * heat);
  s.begin(color, 1, b, life, size * 0.55, size * rand(0.95, 1.25), 2, 3.2 + 1.6 * heat, 0.05, SmokeMode.Fire);
  s.add(x, y, z, rand(-0.3, 0.3), rand(0.8, 1.9) * (0.6 + 0.4 * heat), rand(-0.3, 0.3), rand(-3, 3));
  if (Math.random() < 0.1) {
    const w = size * rand(0.9, 1.3);
    s.begin(Math.random() < 0.5 ? SOOT : SOOT_GREY, 0.55, b, rand(1.1, 1.8), w * 0.7, w * rand(2, 2.8), 1.1, 1.5, 0.14, SmokeMode.Lit);
    s.add(x, y + size * 0.6, z, rand(-0.25, 0.25), rand(0.9, 1.5), rand(-0.25, 0.25), rand(-1, 1));
  }
}

/** A thin thread of smoke off something that has stopped burning. `strength` 0..1 thins it as it goes cold. */
export function smokeWisp(core: FxCore, x: number, y: number, z: number, size: number, strength: number): void {
  const s = core.smoke;
  const w = size * rand(0.7, 1.1);
  // Narrow and tall: it climbs faster than it spreads, so it reads as a thread and not as a cloud.
  s.begin(Math.random() < 0.4 ? SOOT_GREY : WISP, 0.14 + 0.2 * strength, core.birth, rand(2, 3.2), w * 0.45, w * rand(1.5, 2.1), 0.5, 1.3, 0.25, SmokeMode.Lit);
  s.add(x, y, z, rand(-0.08, 0.08), rand(0.5, 0.9), rand(-0.08, 0.08), rand(-0.5, 0.5));
}

/** The warm pool of light a fire throws on the floor under it: one additive disc, about a third of a second. */
export function fireGlow(core: FxCore, x: number, y: number, z: number, radius: number, strength: number): void {
  const s = core.smoke;
  s.begin(GLOW, strength, core.birth, rand(0.3, 0.45), radius * 1.5, radius * 1.8, 1, 0, 0.2, SmokeMode.Glow);
  s.add(x, y, z, 0, 0, 0);
}

/** A spark or two spat out of a burning body: short, falling, bouncing once. */
export function fireSpit(core: FxCore, x: number, y: number, z: number, floor: number): void {
  const st = core.streaks.begin(SPARK.orange, core.birth, rand(0.4, 0.8), -9, floor, 0.03, 0.3, 0, 0, 0.25, 0.4);
  st.add(x, y, z, rand(-1.4, 1.4), rand(1, 2.6), rand(-1.4, 1.4), rand(0.012, 0.022));
}
