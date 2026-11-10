/**
 * Effects. Each works in place on a stereo buffer and returns it, so they chain. Anything that changes over the song
 * takes a per-block curve (one value per CR samples), which `Song` builds from automation lanes.
 */
import { SR, TAU, clamp, dB, isStereo, panGains, type Buf, type Mono, type Stereo } from './core';
import { CR, svf, Svf, biquad, biquadCoefs, shaper, type BiquadType, type FilterMode, type ShapeName } from './dsp';

/** A stereo copy of anything. */
export function stereoOf(buf: Buf): Stereo {
  return isStereo(buf) ? [buf[0].slice(), buf[1].slice()] : [buf.slice(), buf.slice()];
}

export function lengthOf(buf: Buf): number {
  return isStereo(buf) ? buf[0].length : buf.length;
}

export function silence(n: number): Stereo {
  return [new Float32Array(n), new Float32Array(n)];
}

/**
 * Adds `src` into `dst` starting at sample `at`, which may be negative or run past the end. A mono source is panned
 * with equal power, a stereo one is balanced.
 */
export function mixInto(dst: Stereo, src: Buf, at: number, gain = 1, pan = 0): void {
  const n = dst[0].length;
  const len = lengthOf(src);
  const from = at < 0 ? -at : 0;
  const to = Math.min(len, n - at);
  if (to <= from) return;
  const [dl, dr] = dst;
  if (isStereo(src)) {
    const gl = gain * (pan > 0 ? 1 - pan : 1);
    const gr = gain * (pan < 0 ? 1 + pan : 1);
    const [sl, sr] = src;
    for (let i = from; i < to; i++) {
      dl[at + i] += sl[i] * gl;
      dr[at + i] += sr[i] * gr;
    }
  } else {
    const [a, b] = panGains(pan);
    const gl = gain * a * Math.SQRT2;
    const gr = gain * b * Math.SQRT2;
    for (let i = from; i < to; i++) {
      const v = src[i];
      dl[at + i] += v * gl;
      dr[at + i] += v * gr;
    }
  }
}

export function gainOf(buf: Stereo, gain: number | Float32Array): Stereo {
  for (const ch of buf) {
    if (typeof gain === 'number') {
      for (let i = 0; i < ch.length; i++) ch[i] *= gain;
    } else applyCurve(ch, gain);
  }
  return buf;
}

/** Multiplies by a per-block curve, interpolated so it never steps. */
export function applyCurve(ch: Float32Array, curve: Float32Array): void {
  const n = ch.length;
  let g0 = curve[0] ?? 1;
  for (let b = 0, i = 0; i < n; b++) {
    const g1 = curve[b + 1 < curve.length ? b + 1 : curve.length - 1];
    const end = i + CR < n ? i + CR : n;
    const step = (g1 - g0) / CR;
    for (let g = g0; i < end; i++, g += step) ch[i] *= g;
    g0 = g1;
  }
}

// ---------------------------------------------------------------------------------------------
// Tone
// ---------------------------------------------------------------------------------------------

export interface EqBand {
  type: BiquadType;
  freq: number;
  q?: number;
  gain?: number;
}

export function eq(buf: Stereo, bands: readonly EqBand[]): Stereo {
  for (const band of bands) {
    const c = biquadCoefs(band.type, band.freq, band.q ?? 0.707, band.gain ?? 0);
    biquad(buf[0], c);
    biquad(buf[1], c);
  }
  return buf;
}

/** A resonant filter over the whole buffer. `cutoff` is Hz or a per-block curve. `poles` 4 runs it twice. */
export function filt(buf: Stereo, mode: FilterMode, cutoff: number | Float32Array, q = 0.707, poles: 2 | 4 = 2): Stereo {
  for (const ch of buf) {
    svf(ch, mode, cutoff, q, SR, new Svf());
    if (poles === 4) svf(ch, mode, cutoff, 0.707, SR, new Svf());
  }
  return buf;
}

export interface DriveOpts {
  /** Gain into the shaper in dB. */
  amount: number;
  shape?: ShapeName;
  /** Low-pass after the shaper, Hz. */
  lp?: number;
  /** High-pass before the shaper, so the low end does not eat the headroom. */
  hpPre?: number;
  /** 0 dry, 1 all driven. */
  mix?: number;
  /** Output trim in dB. By default the level is brought back down by half the drive. */
  out?: number;
  /** Shifts the curve off centre for even harmonics. */
  bias?: number;
}

export function drive(buf: Stereo, o: DriveOpts): Stereo {
  const sh = shaper(o.shape ?? 'tanh');
  const pre = dB(o.amount);
  const post = dB(o.out ?? -o.amount * 0.5);
  const mix = o.mix ?? 1;
  const bias = o.bias ?? 0;
  const off = sh(bias);
  for (const ch of buf) {
    const dry = mix < 1 ? ch.slice() : null;
    if (o.hpPre) svf(ch, 'hp', o.hpPre, 0.707);
    for (let i = 0; i < ch.length; i++) ch[i] = (sh(ch[i] * pre + bias) - off) * post;
    if (o.lp) svf(ch, 'lp', o.lp, 0.707);
    if (dry) for (let i = 0; i < ch.length; i++) ch[i] = dry[i] * (1 - mix) + ch[i] * mix;
  }
  return buf;
}

/** Fewer bits and a lower sample rate. `rate` is the new rate in Hz. */
export function crush(buf: Stereo, o: { bits?: number; rate?: number; mix?: number }): Stereo {
  const levels = Math.pow(2, (o.bits ?? 12) - 1);
  const step = SR / (o.rate ?? SR);
  const mix = o.mix ?? 1;
  for (const ch of buf) {
    let held = 0;
    let acc = step;
    for (let i = 0; i < ch.length; i++) {
      acc += 1;
      if (acc >= step) {
        acc -= step;
        held = Math.round(ch[i] * levels) / levels;
      }
      ch[i] = ch[i] * (1 - mix) + held * mix;
    }
  }
  return buf;
}

// ---------------------------------------------------------------------------------------------
// Modulation and time
// ---------------------------------------------------------------------------------------------

export interface ChorusOpts {
  /** LFO speed in Hz. */
  rate?: number;
  /** Seconds the delay swings either way. */
  depth?: number;
  /** Centre delay in seconds. Under 5 ms with feedback it is a flanger. */
  delay?: number;
  mix?: number;
  voices?: number;
  feedback?: number;
}

export function chorus(buf: Stereo, o: ChorusOpts = {}): Stereo {
  const { rate = 0.5, depth = 0.003, delay = 0.014, mix = 0.5, voices = 2, feedback = 0 } = o;
  const size = Math.ceil((delay + depth) * SR) + 8;
  buf.forEach((ch, c) => {
    const ring = new Float32Array(size);
    let w = 0;
    const n = ch.length;
    const phases: number[] = [];
    for (let v = 0; v < voices; v++) phases.push(v / voices + c * 0.25);
    const dphi = rate / SR;
    for (let i = 0; i < n; i++) {
      const x = ch[i];
      let wet = 0;
      for (let v = 0; v < voices; v++) {
        const ph = phases[v] + dphi * i;
        const d = (delay + depth * Math.sin(TAU * ph)) * SR;
        let pos = w - d;
        if (pos < 0) pos += size;
        const j = pos | 0;
        const f = pos - j;
        const a = ring[j];
        const b = ring[j + 1 < size ? j + 1 : 0];
        wet += a + (b - a) * f;
      }
      wet /= voices;
      ring[w] = x + wet * feedback;
      if (++w >= size) w = 0;
      ch[i] = x * (1 - mix) + wet * mix;
    }
  });
  return buf;
}

export interface DelayOpts {
  /** Seconds, left line (or both). */
  time: number;
  timeR?: number;
  feedback?: number;
  /** Filters inside the loop, so each repeat is duller and thinner than the last. */
  lp?: number;
  hp?: number;
  /** 1 is echoes only, which is what a send bus wants. */
  mix?: number;
  /** Repeats cross from one side to the other. */
  pingpong?: boolean;
}

export function delay(buf: Stereo, o: DelayOpts): Stereo {
  const { time, timeR = time, feedback = 0.45, lp = 4500, hp = 300, mix = 1, pingpong = false } = o;
  const [L, R] = buf;
  const n = L.length;
  const nl = Math.max(1, Math.round(time * SR));
  const nr = Math.max(1, Math.round(timeR * SR));
  const dl = new Float32Array(nl);
  const dr = new Float32Array(nr);
  const a = 1 - Math.exp((-TAU * lp) / SR);
  const b = 1 - Math.exp((-TAU * hp) / SR);
  let il = 0, ir = 0, lpl = 0, lpr = 0, hpl = 0, hpr = 0;
  for (let i = 0; i < n; i++) {
    const rl = dl[il];
    const rr = dr[ir];
    lpl += a * (rl - lpl);
    lpr += a * (rr - lpr);
    hpl += b * (lpl - hpl);
    hpr += b * (lpr - hpr);
    const fl = (lpl - hpl) * feedback;
    const fr = (lpr - hpr) * feedback;
    if (pingpong) {
      dl[il] = (L[i] + R[i]) * 0.5 + fr;
      dr[ir] = fl;
    } else {
      dl[il] = L[i] + fl;
      dr[ir] = R[i] + fr;
    }
    if (++il >= nl) il = 0;
    if (++ir >= nr) ir = 0;
    L[i] = L[i] * (1 - mix) + rl * mix;
    R[i] = R[i] * (1 - mix) + rr * mix;
  }
  return buf;
}

export interface ReverbOpts {
  /** Seconds for the tail to fall 60 dB. */
  decay?: number;
  /** Scales the room: 0.5 is a small room, 1 a plate, 1.8 a hall. */
  size?: number;
  /** High frequencies above this die sooner, Hz. */
  damp?: number;
  /** Lows below this die sooner, Hz. Keeps a long tail from turning to mud. */
  lowCut?: number;
  predelay?: number;
  /** 1 is tail only, which is what a send bus wants. */
  mix?: number;
  /** High-pass and low-pass on the tail. */
  hp?: number;
  lp?: number;
}

const FDN_BASE = [1087, 1283, 1447, 1663, 1823, 2011, 2203, 2377];
const DIFFUSE_L = [142, 379, 107];
const DIFFUSE_R = [151, 347, 113];

/** An eight-line feedback delay network with a diffused input. The left and right tails are decorrelated. */
export function reverb(buf: Stereo, o: ReverbOpts = {}): Stereo {
  const { decay = 2.2, size = 1, damp = 6000, lowCut = 140, predelay = 0.012, mix = 1, hp = 180, lp = 0 } = o;
  const [L, R] = buf;
  const n = L.length;
  const len = FDN_BASE.map(l => Math.max(8, Math.round(l * size) | 1));
  const g = len.map(l => Math.pow(10, (-3 * l) / (SR * decay)));
  const l0 = new Float32Array(len[0]), l1 = new Float32Array(len[1]), l2 = new Float32Array(len[2]), l3 = new Float32Array(len[3]);
  const l4 = new Float32Array(len[4]), l5 = new Float32Array(len[5]), l6 = new Float32Array(len[6]), l7 = new Float32Array(len[7]);
  const [n0, n1, n2, n3, n4, n5, n6, n7] = len;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g;
  let i0 = 0, i1 = 0, i2 = 0, i3 = 0, i4 = 0, i5 = 0, i6 = 0, i7 = 0;
  let d0 = 0, d1 = 0, d2 = 0, d3 = 0, d4 = 0, d5 = 0, d6 = 0, d7 = 0;
  let c0 = 0, c1 = 0, c2 = 0, c3 = 0, c4 = 0, c5 = 0, c6 = 0, c7 = 0;
  const da = 1 - Math.exp((-TAU * damp) / SR);
  const ca = 1 - Math.exp((-TAU * lowCut) / SR);
  const pn = Math.max(1, Math.round(predelay * SR));
  const pl = new Float32Array(pn);
  const pr = new Float32Array(pn);
  let pi = 0;
  const apL = DIFFUSE_L.map(k => new Float32Array(k));
  const apR = DIFFUSE_R.map(k => new Float32Array(k));
  const apiL = [0, 0, 0];
  const apiR = [0, 0, 0];
  const AG = 0.62;
  const H = 0.35355339;
  const dryL = mix < 1 ? L.slice() : null;
  const dryR = mix < 1 ? R.slice() : null;
  for (let i = 0; i < n; i++) {
    let xl = pl[pi];
    let xr = pr[pi];
    pl[pi] = L[i];
    pr[pi] = R[i];
    if (++pi >= pn) pi = 0;
    for (let k = 0; k < 3; k++) {
      const bl = apL[k];
      const jl = apiL[k];
      const vl = bl[jl];
      const wl = xl + vl * AG;
      bl[jl] = wl;
      xl = vl - wl * AG;
      apiL[k] = jl + 1 >= bl.length ? 0 : jl + 1;
      const br = apR[k];
      const jr = apiR[k];
      const vr = br[jr];
      const wr = xr + vr * AG;
      br[jr] = wr;
      xr = vr - wr * AG;
      apiR[k] = jr + 1 >= br.length ? 0 : jr + 1;
    }
    const o0 = l0[i0], o1 = l1[i1], o2 = l2[i2], o3 = l3[i3], o4 = l4[i4], o5 = l5[i5], o6 = l6[i6], o7 = l7[i7];
    d0 += da * (o0 - d0); d1 += da * (o1 - d1); d2 += da * (o2 - d2); d3 += da * (o3 - d3);
    d4 += da * (o4 - d4); d5 += da * (o5 - d5); d6 += da * (o6 - d6); d7 += da * (o7 - d7);
    c0 += ca * (d0 - c0); c1 += ca * (d1 - c1); c2 += ca * (d2 - c2); c3 += ca * (d3 - c3);
    c4 += ca * (d4 - c4); c5 += ca * (d5 - c5); c6 += ca * (d6 - c6); c7 += ca * (d7 - c7);
    // The lows keep 60% of what they would otherwise, so they decay faster than the mids.
    const v0 = (d0 - c0 * 0.4) * g0, v1 = (d1 - c1 * 0.4) * g1, v2 = (d2 - c2 * 0.4) * g2, v3 = (d3 - c3 * 0.4) * g3;
    const v4 = (d4 - c4 * 0.4) * g4, v5 = (d5 - c5 * 0.4) * g5, v6 = (d6 - c6 * 0.4) * g6, v7 = (d7 - c7 * 0.4) * g7;
    const a0 = v0 + v1, a1 = v0 - v1, a2 = v2 + v3, a3 = v2 - v3, a4 = v4 + v5, a5 = v4 - v5, a6 = v6 + v7, a7 = v6 - v7;
    const b0 = a0 + a2, b1 = a1 + a3, b2 = a0 - a2, b3 = a1 - a3, b4 = a4 + a6, b5 = a5 + a7, b6 = a4 - a6, b7 = a5 - a7;
    l0[i0] = (b0 + b4) * H + xl;
    l1[i1] = (b1 + b5) * H + xr;
    l2[i2] = (b2 + b6) * H - xl;
    l3[i3] = (b3 + b7) * H - xr;
    l4[i4] = (b0 - b4) * H + xl;
    l5[i5] = (b1 - b5) * H + xr;
    l6[i6] = (b2 - b6) * H - xl;
    l7[i7] = (b3 - b7) * H - xr;
    if (++i0 >= n0) i0 = 0;
    if (++i1 >= n1) i1 = 0;
    if (++i2 >= n2) i2 = 0;
    if (++i3 >= n3) i3 = 0;
    if (++i4 >= n4) i4 = 0;
    if (++i5 >= n5) i5 = 0;
    if (++i6 >= n6) i6 = 0;
    if (++i7 >= n7) i7 = 0;
    L[i] = (o0 - o2 + o4 - o6) * 0.3;
    R[i] = (o1 - o3 + o5 - o7) * 0.3;
  }
  if (hp > 0) filt(buf, 'hp', hp);
  if (lp > 0) filt(buf, 'lp', lp);
  if (dryL && dryR) {
    for (let i = 0; i < n; i++) {
      L[i] = dryL[i] * (1 - mix) + L[i] * mix;
      R[i] = dryR[i] * (1 - mix) + R[i] * mix;
    }
  }
  return buf;
}

// ---------------------------------------------------------------------------------------------
// Dynamics
// ---------------------------------------------------------------------------------------------

export interface CompOpts {
  /** dB. */
  threshold: number;
  ratio: number;
  attack?: number;
  release?: number;
  /** Width of the soft knee in dB. */
  knee?: number;
  /** dB added after compression. */
  makeup?: number;
  /** Parallel compression: 1 is all compressed. */
  mix?: number;
  /** Listen to this instead of the buffer itself: a real sidechain. Must be at least as long. */
  key?: Buf;
}

/** Feed-forward compressor, stereo linked. Returns the buffer. `stats.maxReduction` is in dB. */
export function compress(buf: Stereo, o: CompOpts, stats?: { maxReduction: number }): Stereo {
  const { threshold, ratio, attack = 0.008, release = 0.12, knee = 6, makeup = 0, mix = 1 } = o;
  const [L, R] = buf;
  const n = L.length;
  const kl = o.key ? (isStereo(o.key) ? o.key[0] : o.key) : L;
  const kr = o.key ? (isStereo(o.key) ? o.key[1] : o.key) : R;
  const STEP = 8;
  const ak = Math.exp(-1 / Math.max(1, (attack * SR) / STEP));
  const rk = Math.exp(-1 / Math.max(1, (release * SR) / STEP));
  const slope = 1 - 1 / ratio;
  const out = dB(makeup);
  let env = 0;
  let gPrev = 1;
  let worst = 0;
  for (let i = 0; i < n; i += STEP) {
    const end = i + STEP < n ? i + STEP : n;
    let peak = 0;
    for (let j = i; j < end; j++) {
      const a = kl[j] < 0 ? -kl[j] : kl[j];
      const b = kr[j] < 0 ? -kr[j] : kr[j];
      if (a > peak) peak = a;
      if (b > peak) peak = b;
    }
    env = peak > env ? peak + (env - peak) * ak : peak + (env - peak) * rk;
    const level = 20 * Math.log10(env + 1e-9);
    const over = level - threshold;
    let red = 0;
    if (over > knee / 2) red = over * slope;
    else if (over > -knee / 2) red = ((over + knee / 2) * (over + knee / 2) * slope) / (2 * knee);
    if (red > worst) worst = red;
    const g = Math.pow(10, -red / 20);
    const step = (g - gPrev) / (end - i);
    let gi = gPrev;
    for (let j = i; j < end; j++) {
      gi += step;
      const m = (1 - mix + gi * mix) * out;
      L[j] *= m;
      R[j] *= m;
    }
    gPrev = g;
  }
  if (stats) stats.maxReduction = worst;
  return buf;
}

export interface DuckOpts {
  /** 0..1: how far the level drops on each trigger. */
  depth?: number;
  /** Seconds to reach the bottom. A few ms lets the kick's click through first. */
  attack?: number;
  hold?: number;
  /** Seconds to come back up. */
  release?: number;
  /** Shape of the return: 1 linear, 2 and up comes back late and fast (the pump). */
  curve?: number;
}

/**
 * The gain curve of a sidechain pump, one value per CR samples. `triggers` are in seconds on the same clock as the
 * buffer it will be applied to, whose first sample is at `t0`.
 */
export function duckCurve(n: number, t0: number, triggers: readonly number[], o: DuckOpts = {}): Float32Array {
  const { depth = 0.7, attack = 0.004, hold = 0.03, release = 0.2, curve = 2 } = o;
  const blocks = Math.ceil(n / CR) + 1;
  const out = new Float32Array(blocks).fill(1);
  const span = attack + hold + release;
  for (const trig of triggers) {
    const rel = trig - t0;
    const from = Math.max(0, Math.floor((rel * SR) / CR));
    const to = Math.min(blocks, Math.ceil(((rel + span) * SR) / CR) + 1);
    for (let b = from; b < to; b++) {
      const t = (b * CR) / SR - rel;
      if (t < 0 || t > span) continue;
      let amt: number;
      if (t < attack) amt = t / attack;
      else if (t < attack + hold) amt = 1;
      else amt = Math.pow(1 - (t - attack - hold) / release, curve);
      const g = 1 - depth * amt;
      if (g < out[b]) out[b] = g;
    }
  }
  return out;
}

/** A rhythmic gate from a per-block curve of 0..1 values, smoothed so it does not click. */
export function gateCurve(n: number, t0: number, stepSeconds: number, pattern: string, o: { floor?: number; smooth?: number; duty?: number } = {}): Float32Array {
  const { floor = 0, smooth = 0.004, duty = 0.7 } = o;
  const blocks = Math.ceil(n / CR) + 1;
  const out = new Float32Array(blocks);
  const steps = pattern.replace(/[\s|]/g, '');
  const k = 1 - Math.exp(-CR / (smooth * SR));
  let v = floor;
  for (let b = 0; b < blocks; b++) {
    const t = t0 + (b * CR) / SR;
    const pos = t / stepSeconds;
    const idx = ((Math.floor(pos) % steps.length) + steps.length) % steps.length;
    const ch = steps[idx];
    const on = ch !== '.' && ch !== '-' && pos - Math.floor(pos) < duty;
    v += ((on ? 1 : floor) - v) * k;
    out[b] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Stereo
// ---------------------------------------------------------------------------------------------

/** 0 is mono, 1 unchanged, 2 doubles the side signal. */
export function widen(buf: Stereo, amount: number): Stereo {
  const [L, R] = buf;
  for (let i = 0; i < L.length; i++) {
    const m = (L[i] + R[i]) * 0.5;
    const s = (L[i] - R[i]) * 0.5 * amount;
    L[i] = m + s;
    R[i] = m - s;
  }
  return buf;
}

/** Removes everything below `freq` from the side signal, so the low end is mono and survives any speaker. */
export function monoBelow(buf: Stereo, freq = 140): Stereo {
  const [L, R] = buf;
  const n = L.length;
  const side = new Float32Array(n);
  for (let i = 0; i < n; i++) side[i] = (L[i] - R[i]) * 0.5;
  // Twice, for 24 dB an octave: an octave under `freq` the side is 24 dB down.
  svf(side, 'hp', freq, 0.707);
  svf(side, 'hp', freq, 0.707);
  for (let i = 0; i < n; i++) {
    const m = (L[i] + R[i]) * 0.5;
    L[i] = m + side[i];
    R[i] = m - side[i];
  }
  return buf;
}

/** Sweeps the image from side to side. `depth` 1 goes hard left and right. */
export function autopan(buf: Stereo, rate: number, depth = 0.6, phase = 0): Stereo {
  const [L, R] = buf;
  for (let i = 0; i < L.length; i++) {
    const p = Math.sin(TAU * ((rate * i) / SR + phase)) * depth;
    L[i] *= p > 0 ? 1 - p : 1;
    R[i] *= p < 0 ? 1 + p : 1;
  }
  return buf;
}

// ---------------------------------------------------------------------------------------------
// Master: clipper and limiter
// ---------------------------------------------------------------------------------------------

/** Half-band low-pass, 31 taps. Only the odd taps are non-zero besides the centre. */
const HALF_TAPS = (() => {
  const taps: number[] = [];
  for (let m = 0; m < 8; m++) {
    const k = 2 * m + 1;
    const sinc = Math.sin((Math.PI * k) / 2) / (Math.PI * k);
    const w = 0.42 + 0.5 * Math.cos((Math.PI * k) / 16) + 0.08 * Math.cos((2 * Math.PI * k) / 16);
    taps.push(sinc * w);
  }
  // Unity gain at DC: 0.5 + 2 * sum(taps) = 1.
  const sum = taps.reduce((a, b) => a + b, 0);
  return taps.map(t => (t * 0.25) / sum);
})();

function softCurve(x: number, knee: number, ceiling: number): number {
  const a = x < 0 ? -x : x;
  if (a <= knee) return x;
  const span = ceiling - knee;
  const y = knee + span * Math.tanh((a - knee) / span);
  return x < 0 ? -y : y;
}

/**
 * Rounds off peaks above `knee` so that nothing passes `ceiling` (both linear). Runs at twice the sample rate, so the
 * harmonics it makes do not fold back into the audible band.
 */
export function softClip(buf: Stereo, knee: number, ceiling: number): Stereo {
  const T = HALF_TAPS;
  for (const ch of buf) {
    const n = ch.length;
    const up = new Float32Array(2 * n + 32);
    const at = (i: number): number => (i < 0 || i >= n ? 0 : ch[i]);
    for (let i = 0; i < n; i++) {
      up[2 * i + 16] = softCurve(ch[i], knee, ceiling);
      let acc = 0;
      if (i >= 8 && i < n - 9) {
        for (let m = 0; m < 8; m++) acc += T[m] * (ch[i - m] + ch[i + 1 + m]);
      } else {
        for (let m = 0; m < 8; m++) acc += T[m] * (at(i - m) + at(i + 1 + m));
      }
      up[2 * i + 17] = softCurve(acc * 2, knee, ceiling);
    }
    for (let i = 0; i < n; i++) {
      const c = 2 * i + 16;
      let acc = up[c] * 0.5;
      for (let m = 0; m < 8; m++) acc += T[m] * (up[c - (2 * m + 1)] + up[c + (2 * m + 1)]);
      ch[i] = acc;
    }
  }
  return buf;
}

export interface LimitOpts {
  /** Linear ceiling. No sample leaves louder than this. */
  ceiling: number;
  /** Seconds the limiter sees ahead. */
  lookahead?: number;
  /** Seconds for the gain to recover. */
  release?: number;
}

/**
 * Look-ahead brick-wall limiter, stereo linked. The gain is the sliding minimum of what each sample needs, released
 * slowly and then averaged over the look-ahead, which keeps the guarantee and removes the corners.
 * `stats.maxReduction` is in dB, `stats.share` the fraction of samples that were turned down by more than 0.1 dB.
 */
export function limit(buf: Stereo, o: LimitOpts, stats?: { maxReduction: number; share: number; meanReduction: number }): Stereo {
  const { ceiling, lookahead = 0.004, release = 0.09 } = o;
  const [L, R] = buf;
  const n = L.length;
  const W = Math.max(2, Math.round(lookahead * SR));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = L[i] < 0 ? -L[i] : L[i];
    const b = R[i] < 0 ? -R[i] : R[i];
    const p = a > b ? a : b;
    need[i] = p > ceiling ? ceiling / p : 1;
  }
  // Sliding minimum over [i, i + W), by a monotonic queue of indices.
  const q = new Int32Array(W + 1);
  let head = 0;
  let tail = 0;
  const cap = W + 1;
  const held = new Float32Array(n);
  let fill = 0;
  for (let i = 0; i < n + W - 1; i++) {
    if (i < n) {
      while (fill > 0) {
        const last = q[(tail - 1 + cap) % cap];
        if (need[last] >= need[i]) {
          tail = (tail - 1 + cap) % cap;
          fill--;
        } else break;
      }
      q[tail] = i;
      tail = (tail + 1) % cap;
      fill++;
    }
    const out = i - (W - 1);
    if (out >= 0) {
      while (fill > 0 && q[head] < out) {
        head = (head + 1) % cap;
        fill--;
      }
      held[out] = fill > 0 ? need[q[head]] : 1;
    }
  }
  // Release, running forwards. It may only rise slowly and never above what is needed.
  const rk = 1 - Math.exp(-1 / (release * SR));
  let g = 1;
  for (let i = 0; i < n; i++) {
    g += (1 - g) * rk;
    if (held[i] < g) g = held[i];
    held[i] = g;
  }
  // Average over the look-ahead. `held[j]` for j in (i - W, i] all cover sample i, so the mean cannot exceed need[i].
  let sum = 0;
  let worst = 1;
  let touched = 0;
  let logSum = 0;
  for (let i = 0; i < n; i++) {
    sum += held[i];
    if (i >= W) sum -= held[i - W];
    const gain = i >= W - 1 ? sum / W : Math.min(held[i], sum / (i + 1));
    const safe = gain < need[i] ? gain : need[i];
    L[i] *= safe;
    R[i] *= safe;
    if (safe < worst) worst = safe;
    if (safe < 0.9886) {
      touched++;
      logSum += -20 * Math.log10(safe);
    }
  }
  if (stats) {
    stats.maxReduction = -20 * Math.log10(worst);
    stats.share = touched / Math.max(1, n);
    stats.meanReduction = touched ? logSum / touched : 0;
  }
  return buf;
}

/** Linear fades at the two ends, in seconds. */
export function fades(buf: Stereo, fadeIn: number, fadeOut: number): Stereo {
  for (const ch of buf) {
    const n = ch.length;
    const a = Math.min(n, Math.round(fadeIn * SR));
    const b = Math.min(n, Math.round(fadeOut * SR));
    for (let i = 0; i < a; i++) ch[i] *= i / a;
    for (let i = 0; i < b; i++) ch[n - 1 - i] *= i / b;
  }
  return buf;
}

/** Pads or cuts a copy to exactly `n` samples. */
export function fitTo(buf: Mono, n: number): Mono {
  if (buf.length === n) return buf;
  const out = new Float32Array(n);
  out.set(buf.subarray(0, Math.min(n, buf.length)));
  return out;
}

export { clamp };
