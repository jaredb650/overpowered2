/** Timing curves for clips. Everything takes and returns 0..1 unless noted. */
import { clamp } from '../../core/math';

/** Progress of `p` through the window a..b. */
export const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
export const inQuad = (t: number) => t * t;
export const outQuad = (t: number) => 1 - (1 - t) * (1 - t);
export const inCubic = (t: number) => t * t * t;
export const outCubic = (t: number) => 1 - (1 - t) ** 3;
export const inOut = (t: number) => t * t * (3 - 2 * t);
export const outQuart = (t: number) => 1 - (1 - t) ** 4;
/** Overshoots past 1 and settles. */
export const outBack = (t: number, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;
/** 0 at both ends, 1 in the middle of the window. */
export const bump = (p: number, a: number, b: number) => {
  const t = seg(p, a, b);
  return Math.sin(t * Math.PI);
};
/** Rises over a..b, holds, falls over c..d. */
export const hold = (p: number, a: number, b: number, c: number, d: number) => inOut(seg(p, a, b)) * (1 - inOut(seg(p, c, d)));
/** A single slam from 1 to 0 that bounces a little on the way out, for parts that stop against metal. */
export const thud = (t: number) => {
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  const decay = Math.exp(-t * 7);
  return decay * Math.cos(t * 18) * (1 - t);
};
