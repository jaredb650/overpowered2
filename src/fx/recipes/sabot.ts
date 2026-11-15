import * as THREE from 'three';
import { TAU, rand } from '../../core/math';
import type { FxCore } from '../core';
import { SmokeMode } from '../layers/smoke';
import { hot, type Rgb } from '../layers/shared';
import { tangents } from './bursts';

/**
 * The Sabot's wake: a round far past the speed of sound leaves the air torn behind it. Three things, on layers that already exist:
 * an instant white needle from muzzle to impact (lines, 0.16 s), a soft glow sheath round it (lines, 0.4 s) and a vapor cone of
 * smoke sprites that hangs, swells, curls round the line and drifts for 1.6 to 3 s, thick at the muzzle and thinning along the
 * length. At the muzzle (`wakeMuzzle`) a shock ring, Mach diamonds and a shock-front ripple; where it stops a small air burst.
 * Enemy Snipers fire the same round in their laser's crimson, so the shape is learned once and the colour says whose it is.
 */
interface WakeFx {
  needle: Rgb;
  needleCore: number;
  sheath: Rgb;
  vapor: Rgb;
  ring: Rgb;
}

export type WakeKind = 'sabot' | 'snipe';

const WAKES: Record<WakeKind, WakeFx> = {
  sabot: { needle: hot(0xbfe0ff, 4), needleCore: 12, sheath: hot(0x6fa8ff, 0.5), vapor: hot(0xdfe6ee, 0.95), ring: hot(0xd8ecff, 2.6) },
  // The enemy Sniper's laser is 0xff1040: the round that follows it is the same crimson, and its vapor has a rose cast.
  snipe: { needle: hot(0xff1040, 4), needleCore: 7, sheath: hot(0xff1040, 0.5), vapor: hot(0xf0c4cc, 0.95), ring: hot(0xff5070, 2.6) },
};

/** Live vapor sprites across every wake. A five-dart mag dump is about 400; this is a fifth of the shared smoke ring. */
const VAPOR_CAP = 480;
/** At most this many per segment, however long. */
const PER_SEGMENT = 110;
const LIFE_MAX = 3.3;

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
  return Math.min(Math.max(0.16 + 0.02 * _p.distanceTo(eye), 0.16), 3);
}

/** One segment of the round's flight: from the muzzle or a wall's far face, to what stopped it or the next wall. */
export function wake(core: FxCore, from: THREE.Vector3, to: THREE.Vector3, kind: WakeKind): void {
  const f = WAKES[kind];
  core.lines.beam(from, to, f.needle, 0.016, core.now, 0.16, f.needleCore, 1.6);
  core.lines.beam(from, to, f.sheath, 0.06, core.now, 0.4, 1, 3);

  _dir.subVectors(to, from);
  const dist = _dir.length();
  if (dist < 0.05) return;
  _dir.multiplyScalar(1 / dist);
  tangents(_dir, _t, _b);
  const eye = core.ctx.render.camera.position;

  let want = 0;
  for (let d = 0; d < dist && want < PER_SEGMENT; d += spacing(eye, from, d)) want++;
  const n = budget.take(core.now, want);
  if (n === 0) return;
  const stretch = want / n;

  const s = core.smoke;
  // One wind for the whole trail, so it drifts off as a body and does not fray.
  const wind = rand(0, TAU);
  const wx = Math.cos(wind) * 0.18;
  const wz = Math.sin(wind) * 0.18;
  const phase = rand(0, TAU);
  let d = rand(0, 0.1);
  for (let i = 0; i < n && d < dist; i++, d += spacing(eye, from, d) * stretch) {
    // 1 at the muzzle, falling off over the first 30 m: the cone is thick where the round left and thin where it went.
    const near = Math.exp(-d / 30);
    const a = rand(0, TAU);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // Out from the line (u) and round it (w): the vapor swells and the whole tube twists one way.
    const ux = _t.x * ca + _b.x * sa, uy = _t.y * ca + _b.y * sa, uz = _t.z * ca + _b.z * sa;
    const vx = _b.x * ca - _t.x * sa, vy = _b.y * ca - _t.y * sa, vz = _b.z * ca - _t.z * sa;
    const out = rand(0.12, 0.38) * (0.6 + near);
    const curl = rand(0.15, 0.3);
    // A slow kink along the length, a few meters long, so the hanging trail bends like a real one instead of staying ruled.
    const kink = Math.sin(phase + d * 0.22) * 0.14;
    const drag = rand(0.6, 1.4) * near;
    // The shooter must still see: near the eye the vapor is thinner and clears in under a second, or a mag of darts is two
    // seconds of fog on the crosshair. Past 15 m it hangs at full size.
    const e = Math.min(Math.max((eye.distanceTo(_p.copy(from).addScaledVector(_dir, d)) - 3) / 12, 0), 1);
    const clear = 0.3 + 0.7 * e;
    const life = (1.6 + 1.4 * near) * rand(0.85, 1.1) * clear;
    const size = (0.5 + 0.9 * near) * rand(0.8, 1.25) * clear;
    const px = from.x + _dir.x * d + ux * 0.03, py = from.y + _dir.y * d + uy * 0.03, pz = from.z + _dir.z * d + uz * 0.03;
    const qx = ux * out + vx * curl + _dir.x * drag + _t.x * kink + wx;
    const qy = uy * out + vy * curl + _dir.y * drag + _t.y * kink;
    const qz = uz * out + vz * curl + _dir.z * drag + _t.z * kink + wz;
    // Lit billows, premultiplied: down the line from the shooter's eye they stack to a grey body. Additive glows stacked to a white ball.
    s.begin(f.vapor, 0.3 * (0.6 + 0.4 * e), core.birth, life, (0.12 + 0.1 * near) * clear, size, 1.1, 0.1, 0.55, SmokeMode.Lit);
    s.add(px, py, pz, qx, qy, qz, rand(-0.8, 0.8));
  }
  airBurst(core, to, f);
}

/** Where the round stops or leaves a wall: the air it pushed ahead of it, let go. */
function airBurst(core: FxCore, at: THREE.Vector3, f: WakeFx): void {
  core.waves.add(at.x, at.y, at.z, _dir.x, _dir.y, _dir.z, f.ring, 0.55, core.now, 0.16, 0.55, 0.08, 1, 0.5);
  const s = core.smoke;
  s.begin(f.vapor, 0.32, core.birth, 1.1, 0.1, 0.55, 3, 0.15, 0.3, SmokeMode.Lit);
  for (let i = 0; i < 4; i++) {
    const a = rand(0, TAU);
    const v = rand(1.2, 2.2);
    s.add(at.x, at.y, at.z, (_t.x * Math.cos(a) + _b.x * Math.sin(a)) * v - _dir.x, (_t.y * Math.cos(a) + _b.y * Math.sin(a)) * v - _dir.y,
      (_t.z * Math.cos(a) + _b.z * Math.sin(a)) * v - _dir.z, rand(-1, 1));
  }
}

/** The muzzle's share: a hard shock ring, four Mach diamonds down the line, and a ripple in the air. Called with the flash. */
export function wakeMuzzle(core: FxCore, at: THREE.Vector3, dir: THREE.Vector3, kind: WakeKind): void {
  const f = WAKES[kind];
  _dir.copy(dir).normalize();
  const { x, y, z } = at;
  // From the player's own gun a ring at the muzzle fills the screen, so his goes out a few meters down the line.
  const own = core.ctx.render.camera.position.distanceToSquared(at) < 9;
  const o = own ? 2.5 : 0;
  core.waves.add(x + _dir.x * o, y + _dir.y * o, z + _dir.z * o, _dir.x, _dir.y, _dir.z, f.ring, own ? 0.5 : 0.8, core.now, 0.2, own ? 0.7 : 1.1, 0.05, 1, 0.6);
  for (let i = 0; i < 4; i++) {
    const d = 0.45 + i * 0.6;
    core.trailRings.add(x + _dir.x * d, y + _dir.y * d, z + _dir.z * d, _dir.x, _dir.y, _dir.z, f.ring, 0.7 - i * 0.12,
      core.now + i * 0.012, 0.14, 0.16 - i * 0.025, 0.3, 1, 0.4);
  }
  core.shimmer.add(x + _dir.x * (o + 0.8), y + _dir.y * (o + 0.8), z + _dir.z * (o + 0.8), 1.3, core.now, 0.22, 1.2, 1);
}
