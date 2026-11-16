import * as THREE from 'three';
import { TAU, rand } from '../../core/math';
import type { FxCore } from '../core';
import { SmokeMode } from '../layers/smoke';
import { hot, type Rgb } from '../layers/shared';
import { tangents } from './bursts';

/**
 * The Sabot's wake: a little dart far past the speed of sound leaves a fine thread of torn air. All of it is laid at once, so the
 * round reads as instant: a white needle from muzzle to impact (lines, 0.16 s) in a thin glow (lines, 0.25 s), a hair-thin vapor
 * thread that narrows away over 0.9 s (lines), and a sparse string of tiny smoke wisps that hang 0.6 to 1.2 s. At the muzzle
 * (`wakeMuzzle`) one small crisp shock ring; where it stops a small air puff.
 * Enemy Snipers fire the same round in their laser's crimson, so the shape is learned once and the colour says whose it is.
 */
interface WakeFx {
  needle: Rgb;
  needleCore: number;
  sheath: Rgb;
  vapor: Rgb;
  ring: Rgb;
}

export type WakeKind = 'sabot' | 'snipe' | 'scout';

export const WAKE_PROFILES = {
  sabot: { width: 1, life: 1, opacity: 1, particles: 1, shock: 1 },
  snipe: { width: 1, life: 1, opacity: 1, particles: 1, shock: 1 },
  scout: { width: 0.28, life: 0.65, opacity: 0.5, particles: 0.4, shock: 0 },
} as const;

const WAKES: Record<WakeKind, WakeFx> = {
  scout: { needle: hot(0xd6e1eb, 1.5), needleCore: 3, sheath: hot(0xa1b6cb, 0.15), vapor: hot(0xdfe6ee, 0.75), ring: hot(0xd8ecff, 1) },
  sabot: { needle: hot(0xbfe0ff, 4), needleCore: 12, sheath: hot(0x6fa8ff, 0.4), vapor: hot(0xdfe6ee, 0.95), ring: hot(0xd8ecff, 2.6) },
  // The enemy Sniper's laser is 0xff1040: the round that follows it is the same crimson, and its vapor has a rose cast.
  snipe: { needle: hot(0xff1040, 4), needleCore: 7, sheath: hot(0xff1040, 0.4), vapor: hot(0xf0c4cc, 0.95), ring: hot(0xff5070, 2.6) },
};

/** Live vapor sprites across every wake. A five-dart mag dump is about 200 (36 to 40 a dart). */
const VAPOR_CAP = 240;
/** At most this many per segment, however long. */
const PER_SEGMENT = 40;
const LIFE_MAX = 1.3;

/**
 * Counts live sprites per wake so a mag dump, or three Snipers at once, thins the newest trail and never evicts the rest of the
 * smoke ring. `ends` older than `life` ahead of now are from before an fx clear, when the clock went back to zero.
 */
export class VaporBudget {
  private readonly ends = new Float64Array(32);
  private readonly counts = new Int32Array(32);
  private next = 0;

  constructor(readonly cap: number, readonly life: number) {}

  /** Grants up to `want` sprites living `life` from `now`. */
  take(now: number, want: number): number {
    let live = 0;
    for (let i = 0; i < this.ends.length; i++) {
      const left = this.ends[i]! - now;
      if (left > 0 && left <= this.life) live += this.counts[i]!;
    }
    const n = Math.max(0, Math.min(want, this.cap - live));
    if (n > 0) {
      // shortcut: 32 slots, so a 33rd live wake forgets the oldest; fine while the cap allows about ten full trails.
      this.ends[this.next] = now + this.life;
      this.counts[this.next] = n;
      this.next = (this.next + 1) % this.ends.length;
    }
    return n;
  }
}

const budget = new VaporBudget(VAPOR_CAP, LIFE_MAX);

const _dir = new THREE.Vector3();
const _t = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = new THREE.Vector3();

/** Spacing grows with distance from the eye, so the trail is equally dense on screen near and far. */
function spacing(eye: THREE.Vector3, from: THREE.Vector3, d: number): number {
  _p.copy(from).addScaledVector(_dir, d);
  return Math.min(0.6 + 0.05 * _p.distanceTo(eye), 5);
}

/** One segment of the round's flight: from the muzzle or a wall's far face, to what stopped it or the next wall. */
export function wake(core: FxCore, from: THREE.Vector3, to: THREE.Vector3, kind: WakeKind): void {
  const f = WAKES[kind];
  const profile = WAKE_PROFILES[kind];
  core.lines.beam(from, to, f.needle, 0.016 * profile.width, core.now, 0.16 * profile.life, f.needleCore, 1.6 * profile.width);
  core.lines.beam(from, to, f.sheath, 0.03 * profile.width, core.now, 0.25 * profile.life, 1, 2 * profile.width);
  // The condensation thread: a hair of vapor that narrows to nothing. No pixel floor, so it fades rather than holding a line.
  core.lines.beam(from, to, f.vapor, 0.012 * profile.width, core.now, 0.9 * profile.life, 0.3, 0);

  _dir.subVectors(to, from);
  const dist = _dir.length();
  if (dist < 0.05) return;
  _dir.multiplyScalar(1 / dist);
  tangents(_dir, _t, _b);
  const eye = core.ctx.render.camera.position;

  let want = 0;
  for (let d = 0; d < dist && want < PER_SEGMENT; d += spacing(eye, from, d)) want++;
  const n = budget.take(core.now, Math.ceil(want * profile.particles));
  if (n === 0) return;
  const stretch = want / n;

  const s = core.smoke;
  // One wind for the whole trail, so it drifts off as a body and does not fray.
  const wind = rand(0, TAU);
  const wx = Math.cos(wind) * 0.05;
  const wz = Math.sin(wind) * 0.05;
  const phase = rand(0, TAU);
  let d = rand(0, 0.1);
  for (let i = 0; i < n && d < dist; i++, d += spacing(eye, from, d) * stretch) {
    // 1 at the muzzle, falling off over the first 30 m: a touch fuller where the round left.
    const near = Math.exp(-d / 30);
    const a = rand(0, TAU);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // Out from the line (u) and round it (w): the wisps spread a few centimeters and the thread twists one way.
    const ux = _t.x * ca + _b.x * sa, uy = _t.y * ca + _b.y * sa, uz = _t.z * ca + _b.z * sa;
    const vx = _b.x * ca - _t.x * sa, vy = _b.y * ca - _t.y * sa, vz = _b.z * ca - _t.z * sa;
    const out = rand(0.02, 0.06) * (0.6 + near) * profile.width;
    const curl = rand(0.02, 0.05) * profile.width;
    // A slow kink along the length, a few meters long, so the hanging trail bends like a real one instead of staying ruled.
    const kink = Math.sin(phase + d * 0.22) * 0.03 * profile.width;
    const drag = rand(0.05, 0.15) * near;
    // The shooter must still see: near the eye the vapor is thinner and clears in under a second, or a mag of darts is two
    // seconds of haze on the crosshair. Past 15 m it hangs at full size.
    const e = Math.min(Math.max((eye.distanceTo(_p.copy(from).addScaledVector(_dir, d)) - 3) / 12, 0), 1);
    const clear = 0.3 + 0.7 * e;
    const life = (0.65 + 0.45 * near) * rand(0.9, 1.1) * (0.6 + 0.4 * e) * profile.life;
    const size = (0.07 + 0.07 * near) * rand(0.8, 1.25) * clear * profile.width;
    const px = from.x + _dir.x * d + ux * 0.01, py = from.y + _dir.y * d + uy * 0.01, pz = from.z + _dir.z * d + uz * 0.01;
    const qx = ux * out + vx * curl + _dir.x * drag + _t.x * kink + wx;
    const qy = uy * out + vy * curl + _dir.y * drag + _t.y * kink;
    const qz = uz * out + vz * curl + _dir.z * drag + _t.z * kink + wz;
    // Lit wisps, premultiplied: down the line from the shooter's eye they stack to a grey body. Additive glows stacked to a white ball.
    s.begin(f.vapor, 0.35 * (0.6 + 0.4 * e) * profile.opacity, core.birth, life, 0.025 * clear * profile.width, size, 1.1, 0.03, 0.55, SmokeMode.Lit);
    s.add(px, py, pz, qx, qy, qz, rand(-0.8, 0.8));
  }
  if (profile.shock > 0) airBurst(core, to, f);
}

/** Where the round stops or leaves a wall: the air it pushed ahead of it, let go. */
function airBurst(core: FxCore, at: THREE.Vector3, f: WakeFx): void {
  core.waves.add(at.x, at.y, at.z, _dir.x, _dir.y, _dir.z, f.ring, 0.45, core.now, 0.12, 0.22, 0.05, 1, 0.5);
  const s = core.smoke;
  s.begin(f.vapor, 0.3, core.birth, 0.7, 0.04, 0.18, 3, 0.05, 0.3, SmokeMode.Lit);
  for (let i = 0; i < 2; i++) {
    const a = rand(0, TAU);
    const v = rand(0.4, 0.8);
    s.add(at.x, at.y, at.z, (_t.x * Math.cos(a) + _b.x * Math.sin(a)) * v - _dir.x * 0.3, (_t.y * Math.cos(a) + _b.y * Math.sin(a)) * v - _dir.y * 0.3,
      (_t.z * Math.cos(a) + _b.z * Math.sin(a)) * v - _dir.z * 0.3, rand(-1, 1));
  }
}

/** The muzzle's share: one small crisp shock ring. Called with the flash. */
export function wakeMuzzle(core: FxCore, at: THREE.Vector3, dir: THREE.Vector3, kind: WakeKind): void {
  const f = WAKES[kind];
  _dir.copy(dir).normalize();
  // From the player's own gun a ring at the muzzle covers the sight, so his goes out a couple of meters down the line.
  const own = core.ctx.render.camera.position.distanceToSquared(at) < 9;
  const o = own ? 2 : 0;
  core.waves.add(at.x + _dir.x * o, at.y + _dir.y * o, at.z + _dir.z * o, _dir.x, _dir.y, _dir.z, f.ring, 0.6, core.now, 0.12,
    own ? 0.22 : 0.3, 0.04, 1, 0.6);
}
