import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => clamp((v - a) / (b - a));
export const remap = (v: number, a: number, b: number, c: number, d: number) => lerp(c, d, invLerp(a, b, v));
export const smoothstep = (a: number, b: number, v: number) => {
  const t = invLerp(a, b, v);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential approach. `rate` is 1/seconds. */
export const damp = (a: number, b: number, rate: number, dt: number) => lerp(a, b, 1 - Math.exp(-rate * dt));
export const wrapAngle = (a: number) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
export const dampAngle = (a: number, b: number, rate: number, dt: number) =>
  a + wrapAngle(b - a) * (1 - Math.exp(-rate * dt));

/** Mulberry32. Deterministic RNG for map generation and tests. */
export function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = (lo = 0, hi = 1) => lo + Math.random() * (hi - lo);
export const randInt = (lo: number, hi: number) => Math.floor(rand(lo, hi + 1));
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
export const chance = (p: number) => Math.random() < p;

const _v = new THREE.Vector3();
/** Uniform random unit vector written into `out`. `random`: where the numbers come from, when not `Math.random`. */
export function randomUnit(out: THREE.Vector3, random: () => number = Math.random): THREE.Vector3 {
  const z = -1 + random() * 2;
  const a = random() * TAU;
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(a), z, r * Math.sin(a));
}
/**
 * Random direction within `angle` radians of `dir`, written into `out`. `random`: a seeded source, so two machines given the
 * same seed draw the same spread (co-op: a friend's pellets, weapons/watch.ts).
 */
export function randomInCone(dir: THREE.Vector3, angle: number, out: THREE.Vector3, random: () => number = Math.random): THREE.Vector3 {
  randomUnit(_v, random);
  out.copy(dir).addScaledVector(_v, Math.tan(angle) * Math.sqrt(random()));
  return out.normalize();
}

/**
 * Mulberry32 as one reusable object: `seed` it, then `next` is a `() => number` to hand to `randomInCone`. Nothing is
 * allocated a shot.
 */
export class SeededRandom {
  private s = 0;
  readonly next = (): number => {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  seed(seed: number): () => number {
    this.s = seed >>> 0;
    return this.next;
  }
}
