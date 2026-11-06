import { hot } from './layers/shared';

/**
 * Every colour here but blood is a spec hex from the first game, in linear space.
 *
 * Khronos Neutral mixes toward white as peak rises, and after the sRGB curve even a 10% mix turns a
 * saturated red into salmon. So flat bodies stay near 1.1, which lands on screen as the original hex,
 * and heat comes from a small fraction of hot pixels: the chip shader lights the facet facing the
 * eye, and fire carries a white-hot heart. Those pixels drive the bloom, whose hue stays clean because
 * it is added on top rather than pushed through the body.
 */
export const CHIP = {
  yellow: hot(0xffff00, 1.15),
  amber: hot(0xffaa00, 1.15),
  orange: hot(0xff6600, 1.15),
  red: hot(0xff0000, 1.15),
  grey: hot(0x8a96a6, 0.7),
  greyLight: hot(0xcccccc, 0.9),
  white: hot(0xffffff, 1.4),
  debris: hot(0x20262e, 0.5),
  cyan: hot(0x33ddff, 1.15),
  blueWhite: hot(0xbfe8ff, 1.3),
  magenta: hot(0xff2288, 1.15),
  violet: hot(0x9933ff, 1.15),
  brass: hot(0xd4a23a, 0.9),
  brassDark: hot(0xa87a22, 0.8),
  steel: hot(0x8fa2b4, 0.8),
  glass: hot(0xbfeaff, 1.1),
  dirt: hot(0x3a3026, 0.75),
  ice: hot(0x9fe6ff, 1.1),
  iceWhite: hot(0xe6f8ff, 1.3),
};

export const SPARK = {
  yellow: hot(0xffee55, 5),
  amber: hot(0xffaa22, 4),
  orange: hot(0xff6a10, 3),
  white: hot(0xffffff, 6),
  cyan: hot(0x44ddff, 4),
  red: hot(0xff2010, 3),
  magenta: hot(0xff2299, 3),
  ember: hot(0xff5a10, 2.6),
};

/**
 * Albedo, not light: the blood layer is lit by the scene, so these are what the surface reflects and what
 * reaches the screen depends on where it is. Deep and dark, and a long way under the bloom. Arterial is
 * oxygenated and brighter, venous nearly black.
 */
export const BLOOD = {
  venous: { r: 0.06, g: 0.0014, b: 0.002 },
  arterial: { r: 0.2, g: 0.0042, b: 0.0052 },
};

/** Where a burst sits between the two. */
export const BLOOD_TONE = { venous: 0.1, wound: 0.55, arterial: 1 };

/** Flat layers of a fireball, coolest outside. Only the heart and the core may clip to white. */
export const FIRE = {
  red: hot(0xff1a00, 1.12),
  orange: hot(0xff5a00, 1.15),
  amber: hot(0xffa000, 1.25),
  yellow: hot(0xffe040, 2.6),
  core: hot(0xffffff, 30),
  /** Additive halo, hand-made bloom that stays saturated. */
  glow: hot(0xff4a10, 0.34),
};

/** Cool and dark: smoke is the cold half of "hot on cold" and must never compete with the fire. */
export const SMOKE = {
  dark: hot(0x38445a, 0.8),
  mid: hot(0x56647a, 0.8),
  light: hot(0x808c98, 0.7),
  dust: hot(0x66788e, 0.6),
  /** Footfall dust. Small and low, so it can be bright enough to show on a cold floor. Blasts must not use it. */
  kick: hot(0x8fa0b4, 0.95),
  trail: hot(0xcccccc, 0.8),
  shell: hot(0xaaaaaa, 0.7),
  frost: hot(0xbfe8ff, 1.0),
};
