import * as THREE from 'three';

/**
 * Uniform objects shared by every FX material, so one write per frame reaches them all.
 * `uTime` follows the world clock, `uTimePlayer` the player clock and `uTimeBlood` the blood clock. All
 * restart from zero on every clear(), so float32 birth times keep sub-millisecond precision however long
 * the page stays open.
 */
export interface FxUniforms {
  uTime: { value: number };
  uTimePlayer: { value: number };
  uTimeBlood: { value: number };
  uRes: { value: THREE.Vector2 };
  uPixelWorld: { value: number };
  uFogDensity: { value: number };
  uFogAmount: { value: number };
  uFogColor: { value: THREE.Color };
  uDepth: { value: THREE.Texture | null };
  uDepthRes: { value: THREE.Vector2 };
  uNearFar: { value: THREE.Vector2 };
}

export function makeUniforms(): FxUniforms {
  return {
    uTime: { value: 0 },
    uTimePlayer: { value: 0 },
    uTimeBlood: { value: 0 },
    uRes: { value: new THREE.Vector2(1280, 720) },
    uPixelWorld: { value: 0.002 },
    uFogDensity: { value: 0.0045 },
    uFogAmount: { value: 0.55 },
    uFogColor: { value: new THREE.Color(0x4a6488) },
    uDepth: { value: null },
    uDepthRes: { value: new THREE.Vector2(1280, 720) },
    uNearFar: { value: new THREE.Vector2(0.1, 1000) },
  };
}

/** Draw order inside the transparent pass. Spawn order then decides layering within a class. */
export const ORDER = {
  smoke: 10,
  puffs: 11,
  chips: 15,
  blood: 16,
  rings: 20,
  shock: 21,
  beams: 22,
  arcs: 23,
  slashes: 24,
  tracers: 25,
  streaks: 26,
  shimmer: 28,
  flashes: 30,
} as const;

/** Colour triple already in linear working space, optionally pushed above 1 for bloom. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const _c = new THREE.Color();

/** `hot(0xff6600, 2.4)`: a spec hex colour as HDR linear RGB. */
export function hot(hex: THREE.ColorRepresentation, gain = 1): Rgb {
  _c.set(hex);
  return { r: _c.r * gain, g: _c.g * gain, b: _c.b * gain };
}

/** Same as `hot`, writing into `out` so per-call colour arguments do not allocate. */
export function hotInto(out: Rgb, hex: THREE.ColorRepresentation, gain = 1): Rgb {
  _c.set(hex);
  out.r = _c.r * gain;
  out.g = _c.g * gain;
  out.b = _c.b * gain;
  return out;
}
