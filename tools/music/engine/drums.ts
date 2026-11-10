/**
 * Drum synthesis and one-shot effects. Every function returns a new buffer with its peak near 1 (before `gain`), so
 * hits can be rendered once and placed many times. Same options, same samples: all noise is seeded.
 */
import { SR, TAU, Rng, secs, peakOf, scaleBuf, type Mono, type Stereo } from './core';
import { CR, svf, Svf, shaper, biquad, biquadCoefs, onePoleLp, type ShapeName } from './dsp';

function normalize(buf: Mono, peak = 1): Mono {
  const p = peakOf(buf);
  if (p > 1e-9) scaleBuf(buf, peak / p);
  return buf;
}

function fadeOut(buf: Float32Array, samples = 200): void {
  const n = buf.length;
  const f = Math.min(samples, n);
  for (let i = 0; i < f; i++) buf[n - 1 - i] *= i / f;
}

function noise(n: number, rng: Rng): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rng.next() * 2 - 1;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Kick
// ---------------------------------------------------------------------------------------------

export interface KickOpts {
  /** Resting pitch of the body, Hz. */
  freq?: number;
  /** Hz above `freq` at the first sample, gone with time constant `sweep`. This is the knock. */
  punch?: number;
  sweep?: number;
  /** A second, slower fall on top, for a longer "boww". */
  punch2?: number;
  sweep2?: number;
  /** Seconds at full level before the decay starts. */
  hold?: number;
  /** Seconds for the body to fall to 1%. */
  decay?: number;
  /** Level of the beater click, 0..1. */
  click?: number;
  /** High-pass of the click's noise, Hz. */
  clickHz?: number;
  /** Gain into the shaper. 1 is clean, 4 is a hard techno kick, 10 and up squares it off. */
  drive?: number;
  shape?: ShapeName;
  /** Low-pass after the shaper, Hz. 0 leaves it open. */
  lp?: number;
  /** A fixed high-pass, to take the weight out of a layered top kick. */
  hp?: number;
  dur?: number;
  seed?: number;
}

export function kick(o: KickOpts = {}): Mono {
  const { freq = 50, punch = 230, sweep = 0.028, punch2 = 45, sweep2 = 0.11, hold = 0.03, decay = 0.3, click = 0.3, clickHz = 2800, drive = 1.3, shape = 'tanh', lp = 0, hp = 0, seed = 1 } = o;
  const n = secs(o.dur ?? hold + decay + 0.03);
  const out = new Float32Array(n);
  const k = 4.6 / decay;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = freq + punch * Math.exp(-t / sweep) + punch2 * Math.exp(-t / sweep2);
    ph += f / SR;
    const env = t < hold ? 1 : Math.exp(-(t - hold) * k);
    out[i] = Math.sin(TAU * ph) * env;
  }
  const sh = shaper(shape);
  const norm = 1 / Math.abs(sh(drive) || 1);
  for (let i = 0; i < n; i++) out[i] = sh(out[i] * drive) * norm;
  if (click > 0) {
    const cn = Math.min(n, secs(0.012));
    const c = noise(cn, new Rng(seed));
    svf(c, 'hp', clickHz, 0.8);
    for (let i = 0; i < cn; i++) out[i] += c[i] * Math.exp(-i / (0.0016 * SR)) * click;
  }
  if (lp > 0) svf(out, 'lp', lp, 0.707);
  if (hp > 0) svf(out, 'hp', hp, 0.707);
  fadeOut(out, 300);
  return normalize(out);
}

/**
 * The low rumble that follows a techno kick: the kick through a dark room, low-passed and saturated, with its own
 * start cut away. Place it on the kick's track (or its own) and duck it with the kick.
 */
export function kickRumble(source: Mono, o: { dur?: number; decay?: number; lp?: number; drive?: number; seed?: number } = {}): Mono {
  const { dur = 0.5, decay = 0.45, lp = 95, drive = 2.5, seed = 7 } = o;
  const n = secs(dur);
  const out = new Float32Array(n);
  // A handful of dense echoes stands in for a room here: it only has to smear the kick's low end.
  const rng = new Rng(seed);
  for (let e = 0; e < 28; e++) {
    const at = secs(0.02 + rng.next() * dur * 0.8);
    const g = Math.exp((-4.6 * at) / SR / decay) * (rng.next() < 0.5 ? -1 : 1) * 0.5;
    const len = Math.min(source.length, n - at);
    for (let i = 0; i < len; i++) out[at + i] += source[i] * g;
  }
  svf(out, 'lp', lp, 0.9);
  svf(out, 'lp', lp * 1.4, 0.707);
  const sh = shaper('tanh');
  for (let i = 0; i < n; i++) out[i] = sh(out[i] * drive);
  svf(out, 'lp', lp * 1.6, 0.707);
  svf(out, 'hp', 30, 0.707);
  const fin = Math.min(n, secs(0.03));
  for (let i = 0; i < fin; i++) out[i] *= i / fin;
  fadeOut(out, secs(0.05));
  return normalize(out);
}

// ---------------------------------------------------------------------------------------------
// Snare, clap, rim
// ---------------------------------------------------------------------------------------------

export interface SnareOpts {
  /** The two shell modes, Hz. */
  tone?: number;
  tone2?: number;
  /** Hz the modes start above their pitch. */
  bend?: number;
  toneDecay?: number;
  /** Level of the shell against the wires. */
  body?: number;
  noise?: number;
  noiseDecay?: number;
  /** Band of the wires. */
  noiseHp?: number;
  noiseLp?: number;
  /** A short bright burst at the start. */
  snap?: number;
  drive?: number;
  dur?: number;
  seed?: number;
}

export function snare(o: SnareOpts = {}): Mono {
  const { tone = 190, tone2 = 335, bend = 70, toneDecay = 0.1, body = 0.8, noise: noiseLevel = 0.75, noiseDecay = 0.17, noiseHp = 1400, noiseLp = 9500, snap = 0.35, drive = 1.4, seed = 2 } = o;
  const n = secs(o.dur ?? Math.max(toneDecay, noiseDecay) + 0.04);
  const out = new Float32Array(n);
  let p1 = 0;
  let p2 = 0;
  const kt = 4.6 / toneDecay;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const b = bend * Math.exp(-t / 0.012);
    p1 += (tone + b) / SR;
    p2 += (tone2 + b * 1.4) / SR;
    out[i] = (Math.sin(TAU * p1) + 0.55 * Math.sin(TAU * p2)) * Math.exp(-t * kt) * body;
  }
  const wires = noise(n, new Rng(seed));
  svf(wires, 'hp', noiseHp, 0.9);
  svf(wires, 'lp', noiseLp, 0.707);
  const kn = 4.6 / noiseDecay;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] += wires[i] * (Math.exp(-t * kn) * noiseLevel + Math.exp(-t / 0.004) * snap);
  }
  const sh = shaper('tanh');
  for (let i = 0; i < n; i++) out[i] = sh(out[i] * drive);
  fadeOut(out);
  return normalize(out);
}

export interface ClapOpts {
  bursts?: number;
  /** Seconds between the hands. */
  gap?: number;
  /** Seconds for the tail to fall to 1%. */
  decay?: number;
  /** Centre of the band, Hz. */
  bp?: number;
  q?: number;
  hp?: number;
  dur?: number;
  seed?: number;
}

export function clap(o: ClapOpts = {}): Mono {
  const { bursts = 4, gap = 0.0095, decay = 0.2, bp = 1250, q = 1.3, hp = 500, seed = 3 } = o;
  const n = secs(o.dur ?? bursts * gap + decay + 0.03);
  const out = noise(n, new Rng(seed));
  svf(out, 'bp', bp, q);
  svf(out, 'hp', hp, 0.707);
  const last = (bursts - 1) * gap;
  const k = 4.6 / decay;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let env: number;
    if (t < last) {
      const local = t % gap;
      env = Math.exp(-local / (gap * 0.32));
    } else env = Math.exp(-(t - last) * k);
    out[i] *= env;
  }
  fadeOut(out);
  return normalize(out);
}

export function rim(o: { tone?: number; decay?: number; seed?: number } = {}): Mono {
  const { tone = 1750, decay = 0.035, seed = 4 } = o;
  const n = secs(decay + 0.02);
  const out = new Float32Array(n);
  const c = noise(n, new Rng(seed));
  svf(c, 'bp', 3200, 1.2);
  const k = 4.6 / decay;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] = (Math.sin(TAU * tone * t) * 0.7 + Math.sin(TAU * tone * 0.277 * t) * 0.5) * Math.exp(-t * k) + c[i] * Math.exp(-t / 0.003) * 0.8;
  }
  fadeOut(out, 100);
  return normalize(out);
}

// ---------------------------------------------------------------------------------------------
// Cymbals
// ---------------------------------------------------------------------------------------------

const METAL = [1, 1.4826, 1.8003, 2.546, 2.6303, 3.8967];

/** Six square waves at fixed, unrelated ratios: the sound of a drum machine's cymbal before its filters. */
function metal(n: number, base: number, rng: Rng): Float32Array {
  const out = new Float32Array(n);
  for (const ratio of METAL) {
    const dt = (base * ratio * (1 + rng.bi() * 0.004)) / SR;
    let ph = rng.next();
    for (let i = 0; i < n; i++) {
      ph += dt;
      if (ph >= 1) ph -= 1;
      out[i] += ph < 0.5 ? 1 : -1;
    }
  }
  return scaleBuf(out, 1 / METAL.length);
}

export interface HatOpts {
  /** Seconds to fall to 1%. About 0.04 closed, 0.3 open. */
  decay?: number;
  /** Share of the metallic squares against plain noise, 0..1. */
  metal?: number;
  /** Pitch of the metal, Hz. */
  base?: number;
  hp?: number;
  /** Centre of the brightness peak, Hz. */
  bp?: number;
  dur?: number;
  seed?: number;
}

export function hat(o: HatOpts = {}): Mono {
  const { decay = 0.045, metal: m = 0.5, base = 410, hp = 7000, bp = 9800, seed = 5 } = o;
  const n = secs(o.dur ?? decay + 0.015);
  const rng = new Rng(seed);
  const out = metal(n, base, rng);
  const w = noise(n, rng);
  for (let i = 0; i < n; i++) out[i] = out[i] * m + w[i] * (1 - m) * 0.7;
  biquad(out, biquadCoefs('peak', bp, 1.1, 6));
  svf(out, 'hp', hp, 0.8);
  svf(out, 'hp', hp * 0.7, 0.707);
  const k = 4.6 / decay;
  const att = secs(0.0006);
  for (let i = 0; i < n; i++) out[i] *= Math.exp((-i / SR) * k) * (i < att ? i / att : 1);
  fadeOut(out, 60);
  return normalize(out);
}

export function ride(o: { decay?: number; base?: number; ping?: number; hp?: number; seed?: number } = {}): Mono {
  const { decay = 0.9, base = 330, ping = 0.5, hp = 3200, seed = 6 } = o;
  const n = secs(decay + 0.03);
  const rng = new Rng(seed);
  const out = metal(n, base, rng);
  const w = noise(n, rng);
  for (let i = 0; i < n; i++) out[i] = out[i] * 0.8 + w[i] * 0.25;
  biquad(out, biquadCoefs('peak', 6500, 0.8, 5));
  svf(out, 'hp', hp, 0.707);
  const k = 4.6 / decay;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] *= Math.exp(-t * k) * 0.6 + Math.exp(-t / 0.02) * ping;
  }
  fadeOut(out, 400);
  return normalize(out);
}

export function crash(o: { decay?: number; hp?: number; base?: number; seed?: number } = {}): Stereo {
  const { decay = 1.8, hp = 2600, base = 290, seed = 8 } = o;
  const n = secs(decay + 0.05);
  const make = (s: number): Float32Array => {
    const rng = new Rng(s);
    const out = metal(n, base, rng);
    const w = noise(n, rng);
    for (let i = 0; i < n; i++) out[i] = out[i] * 0.45 + w[i] * 0.6;
    // The top falls away faster than the body, as on a real cymbal.
    const blocks = Math.ceil(n / CR);
    const fc = new Float32Array(blocks);
    for (let b = 0; b < blocks; b++) fc[b] = 5500 + 12000 * Math.exp((-b * CR) / SR / (decay * 0.3));
    svf(out, 'lp', fc, 0.707, SR, new Svf());
    svf(out, 'hp', hp, 0.707);
    const k = 4.6 / decay;
    const att = secs(0.002);
    for (let i = 0; i < n; i++) out[i] *= Math.exp((-i / SR) * k) * (i < att ? i / att : 1);
    fadeOut(out, 600);
    return out;
  };
  const L = make(seed);
  const R = make(seed + 101);
  const p = Math.max(peakOf(L), peakOf(R)) || 1;
  scaleBuf(L, 1 / p);
  scaleBuf(R, 1 / p);
  return [L, R];
}

// ---------------------------------------------------------------------------------------------
// Toms and small percussion
// ---------------------------------------------------------------------------------------------

export function tom(o: { freq?: number; bend?: number; decay?: number; noise?: number; drive?: number; seed?: number } = {}): Mono {
  const { freq = 120, bend = 0.9, decay = 0.28, noise: nz = 0.12, drive = 1.2, seed = 9 } = o;
  const n = secs(decay + 0.03);
  const out = new Float32Array(n);
  const w = noise(n, new Rng(seed));
  svf(w, 'bp', freq * 6, 0.8);
  let ph = 0;
  const k = 4.6 / decay;
  const sh = shaper('tanh');
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (freq * (1 + bend * Math.exp(-t / 0.035))) / SR;
    out[i] = sh((Math.sin(TAU * ph) * Math.exp(-t * k) + w[i] * Math.exp(-t / 0.02) * nz) * drive);
  }
  fadeOut(out);
  return normalize(out);
}

export function shaker(o: { decay?: number; bp?: number; seed?: number } = {}): Mono {
  const { decay = 0.05, bp = 6500, seed = 10 } = o;
  const n = secs(decay + 0.02);
  const out = noise(n, new Rng(seed));
  svf(out, 'bp', bp, 1.4);
  svf(out, 'hp', 3000, 0.707);
  const k = 4.6 / decay;
  const att = secs(0.006);
  for (let i = 0; i < n; i++) out[i] *= (i < att ? i / att : Math.exp((-(i - att) / SR) * k));
  fadeOut(out, 80);
  return normalize(out);
}

/** A short pitched knock: congas, blocks, bleeps. */
export function perc(o: { freq?: number; bend?: number; decay?: number; fm?: number; seed?: number } = {}): Mono {
  const { freq = 320, bend = 0.25, decay = 0.09, fm = 0 } = o;
  const n = secs(decay + 0.02);
  const out = new Float32Array(n);
  let ph = 0;
  const k = 4.6 / decay;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (freq * (1 + bend * Math.exp(-t / 0.012))) / SR;
    out[i] = Math.sin(TAU * ph + fm * Math.sin(TAU * ph * 1.47) * Math.exp(-t / 0.03)) * Math.exp(-t * k);
  }
  fadeOut(out, 100);
  return normalize(out);
}

// ---------------------------------------------------------------------------------------------
// Sweeps and impacts
// ---------------------------------------------------------------------------------------------

export interface SweepOpts {
  dur: number;
  /** Filter frequency at the start and at the end, Hz. */
  from: number;
  to: number;
  q?: number;
  mode?: 'bp' | 'lp' | 'hp';
  /** Level at the start and at the end. A riser goes 0 to 1, a downlifter 1 to 0. */
  levelFrom?: number;
  levelTo?: number;
  /** Bends the level curve: above 1 holds back and arrives late. */
  curve?: number;
  /** Pulses per second of tremolo at the start and end. 0 for none. */
  tremFrom?: number;
  tremTo?: number;
  seed?: number;
}

/** Filtered noise moving through the spectrum, with a different noise in each ear. */
export function noiseSweep(o: SweepOpts): Stereo {
  const { dur, from, to, q = 2.2, mode = 'bp', levelFrom = 0, levelTo = 1, curve = 1.6, tremFrom = 0, tremTo = 0, seed = 11 } = o;
  const n = secs(dur);
  const blocks = Math.ceil(n / CR);
  const fc = new Float32Array(blocks);
  for (let b = 0; b < blocks; b++) fc[b] = from * Math.pow(to / from, b / Math.max(1, blocks - 1));
  const make = (s: number): Float32Array => {
    const out = noise(n, new Rng(s));
    svf(out, mode, fc, q, SR, new Svf());
    let tremPhase = 0;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      const rising = levelTo >= levelFrom;
      const shaped = rising ? Math.pow(x, curve) : 1 - Math.pow(1 - x, curve);
      let g = levelFrom + (levelTo - levelFrom) * shaped;
      if (tremFrom > 0 || tremTo > 0) {
        tremPhase += (tremFrom + (tremTo - tremFrom) * x) / SR;
        g *= 0.55 + 0.45 * Math.cos(TAU * tremPhase);
      }
      out[i] *= g;
    }
    const edge = Math.min(n, secs(0.004));
    for (let i = 0; i < edge; i++) {
      out[i] *= i / edge;
      out[n - 1 - i] *= i / edge;
    }
    return out;
  };
  const L = make(seed);
  const R = make(seed + 977);
  const p = Math.max(peakOf(L), peakOf(R)) || 1;
  scaleBuf(L, 1 / p);
  scaleBuf(R, 1 / p);
  return [L, R];
}

/** A low boom with a burst of noise over it: the downbeat of a drop. Dry. Send it to a long reverb. */
export function impact(o: { dur?: number; freq?: number; drop?: number; noise?: number; noiseLp?: number; drive?: number; seed?: number } = {}): Stereo {
  const { dur = 2.2, freq = 42, drop = 90, noise: nz = 0.6, noiseLp = 5000, drive = 1.6, seed = 12 } = o;
  const n = secs(dur);
  const sub = new Float32Array(n);
  let ph = 0;
  const sh = shaper('tanh');
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (freq + drop * Math.exp(-t / 0.09)) / SR;
    sub[i] = sh(Math.sin(TAU * ph) * Math.exp((-t * 4.6) / dur) * drive);
  }
  const make = (s: number): Float32Array => {
    const w = noise(n, new Rng(s));
    const blocks = Math.ceil(n / CR);
    const fc = new Float32Array(blocks);
    for (let b = 0; b < blocks; b++) fc[b] = 180 + noiseLp * Math.exp((-b * CR) / SR / (dur * 0.18));
    svf(w, 'lp', fc, 0.707, SR, new Svf());
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      w[i] = w[i] * Math.exp((-t * 4.6) / (dur * 0.7)) * nz + sub[i];
    }
    fadeOut(w, 800);
    return w;
  };
  const L = make(seed);
  const R = make(seed + 31);
  const p = Math.max(peakOf(L), peakOf(R)) || 1;
  scaleBuf(L, 1 / p);
  scaleBuf(R, 1 / p);
  return [L, R];
}

/** A sine falling through the low end, for the bar after a drop or the end of a fill. */
export function subDrop(o: { dur?: number; from?: number; to?: number; drive?: number } = {}): Mono {
  const { dur = 1.2, from = 110, to = 32, drive = 1.2 } = o;
  const n = secs(dur);
  const out = new Float32Array(n);
  let ph = 0;
  const sh = shaper('tanh');
  for (let i = 0; i < n; i++) {
    const x = i / n;
    ph += (from * Math.pow(to / from, x)) / SR;
    out[i] = sh(Math.sin(TAU * ph) * drive) * (1 - x) * Math.min(1, i / 200);
  }
  return normalize(out);
}

/** Reverses a copy. A reversed crash or reverb tail is the oldest lead-in there is. */
export function reversed<T extends Mono | Stereo>(buf: T): T {
  const rev = (c: Float32Array): Float32Array => {
    const out = new Float32Array(c.length);
    for (let i = 0; i < c.length; i++) out[i] = c[c.length - 1 - i];
    return out;
  };
  return (Array.isArray(buf) ? [rev(buf[0]), rev(buf[1])] : rev(buf)) as T;
}

/** A copy with a different level, pitch (by resampling) or length. Pitch above 0 is shorter and brighter. */
export function repitch(buf: Mono, semitones: number, gain = 1): Mono {
  const rate = Math.pow(2, semitones / 12);
  const n = Math.max(1, Math.floor(buf.length / rate));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * rate;
    const j = Math.floor(pos);
    const f = pos - j;
    const a = buf[j] ?? 0;
    const b = buf[j + 1] ?? 0;
    out[i] = (a + (b - a) * f) * gain;
  }
  fadeOut(out, 60);
  return out;
}

/** Darkens a copy: ghost notes, distant hits. */
export function dulled(buf: Mono, lp: number, gain = 1): Mono {
  const out = buf.slice();
  onePoleLp(out, lp);
  return scaleBuf(out, gain);
}
