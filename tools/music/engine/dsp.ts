/**
 * DSP building blocks: band-limited oscillator step, envelopes, filters, shapers, resampling, FFT.
 * Loops live inside these functions on purpose. A per-sample callback costs more than the DSP it wraps.
 */
import { SR, TAU, clamp, type Rng } from './core';

/** Control rate. Filter cutoffs and automation are updated once per this many samples. */
export const CR = 16;

/** PolyBLEP residual for a falling step at phase 0. `t` is the phase 0..1, `dt` the phase step. */
export function blep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** tanh to within 2%, without the call. Exactly +-1 past +-3. */
export function tanh(x: number): number {
  if (x <= -3) return -1;
  if (x >= 3) return 1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

export type ShapeName = 'tanh' | 'hard' | 'soft' | 'fold' | 'asym' | 'diode';

export function shaper(name: ShapeName): (x: number) => number {
  switch (name) {
    case 'hard':
      return x => (x < -1 ? -1 : x > 1 ? 1 : x);
    case 'soft':
      // Cubic: clean below a third, flat from 1.5 up.
      return x => (x <= -1.5 ? -1 : x >= 1.5 ? 1 : x - (4 / 27) * x * x * x);
    case 'fold':
      // Triangle fold: the same as the input up to 1, then louder input wraps back down, which adds bright odd harmonics.
      return x => {
        const y = x * 0.25 + 0.25;
        return 1 - 4 * Math.abs(y - Math.floor(y) - 0.5);
      };
    case 'asym':
      // Even harmonics: the top half saturates sooner than the bottom.
      return x => (x > 0 ? tanh(x * 1.4) / 1.4 + 0.2 * tanh(x) : tanh(x * 0.8) / 0.8) * 0.9;
    case 'diode':
      return x => {
        const a = x < 0 ? -x : x;
        const y = a < 0.33 ? 2 * a : a < 0.66 ? (3 - (2 - 3 * a) * (2 - 3 * a)) / 3 : 1;
        return x < 0 ? -y : y;
      };
    default:
      return tanh;
  }
}

/**
 * Envelope of `n` samples: linear attack, exponential decay to the sustain level, exponential release once the gate
 * closes. `d` and `r` are the times to be within 1% of the target, so "decay 0.2" is gone by 200 ms.
 */
export function adsr(n: number, gate: number, a: number, d: number, s: number, r: number, sr = SR): Float32Array {
  const out = new Float32Array(n);
  const gN = Math.min(n, Math.max(1, Math.round(gate * sr)));
  const aN = Math.max(1, Math.round(a * sr));
  const dk = Math.exp(-4.6 / Math.max(1, d * sr));
  const rk = Math.exp(-4.6 / Math.max(1, r * sr));
  let v = 0;
  for (let i = 0; i < gN; i++) {
    if (i < aN) v = (i + 1) / aN;
    else v = s + (v - s) * dk;
    out[i] = v;
  }
  for (let i = gN; i < n; i++) {
    v *= rk;
    out[i] = v;
  }
  const fade = Math.min(64, n);
  for (let i = 0; i < fade; i++) out[n - 1 - i] = out[n - 1 - i]! * (i / fade);
  return out;
}

/** exp(-t / tau) sampled, where the level is 1% after `time` seconds. */
export function decay(n: number, time: number, sr = SR): Float32Array {
  const out = new Float32Array(n);
  const k = Math.exp(-4.6 / Math.max(1, time * sr));
  let v = 1;
  for (let i = 0; i < n; i++) {
    out[i] = v;
    v *= k;
  }
  return out;
}

export function whiteNoise(n: number, rng: Rng): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rng.next() * 2 - 1;
  return out;
}

/** Pink noise by Paul Kellet's filter bank, about -3 dB per octave. */
export function pinkNoise(n: number, rng: Rng): Float32Array {
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rng.next() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// State variable filter (Simper's trapezoidal form). Stable under fast modulation.
// ---------------------------------------------------------------------------------------------

export type FilterMode = 'lp' | 'hp' | 'bp' | 'notch' | 'peak';

export class Svf {
  ic1 = 0;
  ic2 = 0;
}

/**
 * Filters in place. `cutoff` is one number, or one value per CR samples. Band-pass has unity gain at its centre.
 * Pass a state to carry the filter across calls.
 */
export function svf(buf: Float32Array, mode: FilterMode, cutoff: number | Float32Array, q = 0.707, sr = SR, state: Svf = new Svf()): Float32Array {
  const n = buf.length;
  const k = 1 / Math.max(0.05, q);
  const m0 = mode === 'lp' || mode === 'bp' ? 0 : 1;
  const m1 = mode === 'lp' ? 0 : mode === 'bp' ? k : -k;
  const m2 = mode === 'lp' ? 1 : mode === 'hp' ? -1 : mode === 'peak' ? -2 : 0;
  const top = sr * 0.46;
  const piSr = Math.PI / sr;
  let ic1 = state.ic1;
  let ic2 = state.ic2;
  const fixed = typeof cutoff === 'number';
  let g = Math.tan(piSr * clamp(fixed ? cutoff : cutoff[0]!, 8, top));
  let a1 = 1 / (1 + g * (g + k));
  let a2 = g * a1;
  let a3 = g * a2;
  for (let start = 0, block = 0; start < n; start += CR, block++) {
    if (!fixed) {
      const fc = cutoff[block < cutoff.length ? block : cutoff.length - 1]!;
      g = Math.tan(piSr * (fc < 8 ? 8 : fc > top ? top : fc));
      a1 = 1 / (1 + g * (g + k));
      a2 = g * a1;
      a3 = g * a2;
    }
    const end = start + CR < n ? start + CR : n;
    for (let i = start; i < end; i++) {
      const v0 = buf[i]!;
      const v3 = v0 - ic2;
      const v1 = a1 * ic1 + a2 * v3;
      const v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1;
      ic2 = 2 * v2 - ic2;
      buf[i] = m0 * v0 + m1 * v1 + m2 * v2;
    }
  }
  state.ic1 = Math.abs(ic1) < 1e-20 ? 0 : ic1;
  state.ic2 = Math.abs(ic2) < 1e-20 ? 0 : ic2;
  return buf;
}

// ---------------------------------------------------------------------------------------------
// Four-pole ladder with a saturating input, for acid lines and screaming leads.
// ---------------------------------------------------------------------------------------------

export class Ladder {
  s1 = 0;
  s2 = 0;
  s3 = 0;
  s4 = 0;
}

/**
 * In place. `res` 0..1, where about 0.95 rings on its own. `drive` is the input gain into the tanh. Runs twice per
 * sample so the resonance stays in tune up to a few kHz.
 */
export function ladder(buf: Float32Array, cutoff: number | Float32Array, res: number, drive = 1, sr = SR, state: Ladder = new Ladder()): Float32Array {
  const n = buf.length;
  const fixed = typeof cutoff === 'number';
  const res4 = clamp(res, 0, 1.1) * 4;
  const top = sr * 0.4;
  let { s1, s2, s3, s4 } = state;
  const k = -TAU / (2 * sr);
  let g = 1 - Math.exp(k * clamp(fixed ? cutoff : cutoff[0]!, 10, top));
  const makeup = 1 + res4 * 0.6;
  for (let start = 0, block = 0; start < n; start += CR, block++) {
    if (!fixed) {
      const fc = cutoff[block < cutoff.length ? block : cutoff.length - 1]!;
      g = 1 - Math.exp(k * (fc < 10 ? 10 : fc > top ? top : fc));
    }
    const end = start + CR < n ? start + CR : n;
    for (let i = start; i < end; i++) {
      const x = buf[i]! * drive;
      let u = tanh(x - res4 * s4);
      s1 += g * (u - s1);
      s2 += g * (s1 - s2);
      s3 += g * (s2 - s3);
      s4 += g * (s3 - s4);
      u = tanh(x - res4 * s4);
      s1 += g * (u - s1);
      s2 += g * (s1 - s2);
      s3 += g * (s2 - s3);
      s4 += g * (s3 - s4);
      buf[i] = s4 * makeup;
    }
  }
  state.s1 = s1;
  state.s2 = s2;
  state.s3 = s3;
  state.s4 = s4;
  return buf;
}

// ---------------------------------------------------------------------------------------------
// Biquads (RBJ cookbook), for EQ.
// ---------------------------------------------------------------------------------------------

export type BiquadType = 'lp' | 'hp' | 'bp' | 'notch' | 'peak' | 'lowshelf' | 'highshelf' | 'allpass';
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export function biquadCoefs(type: BiquadType, freq: number, q = 0.707, gainDb = 0, sr = SR): Biquad {
  const w = (TAU * clamp(freq, 5, sr * 0.49)) / sr;
  const cos = Math.cos(w);
  const sin = Math.sin(w);
  const alpha = sin / (2 * Math.max(0.05, q));
  const A = Math.pow(10, gainDb / 40);
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  switch (type) {
    case 'lp':
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'hp':
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'bp':
      b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'notch':
      b0 = 1; b1 = -2 * cos; b2 = 1; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'allpass':
      b0 = 1 - alpha; b1 = -2 * cos; b2 = 1 + alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'peak':
      b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
      break;
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cos + s); b1 = 2 * A * (A - 1 - (A + 1) * cos); b2 = A * (A + 1 - (A - 1) * cos - s);
      a0 = A + 1 + (A - 1) * cos + s; a1 = -2 * (A - 1 + (A + 1) * cos); a2 = A + 1 + (A - 1) * cos - s;
      break;
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cos + s); b1 = -2 * A * (A - 1 + (A + 1) * cos); b2 = A * (A + 1 + (A - 1) * cos - s);
      a0 = A + 1 - (A - 1) * cos + s; a1 = 2 * (A - 1 - (A + 1) * cos); a2 = A + 1 - (A - 1) * cos - s;
      break;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** In place, transposed direct form 2. */
export function biquad(buf: Float32Array, c: Biquad): Float32Array {
  const { b0, b1, b2, a1, a2 } = c;
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!;
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    buf[i] = y;
  }
  return buf;
}

/** One-pole low-pass in place, 6 dB per octave. */
export function onePoleLp(buf: Float32Array, freq: number, sr = SR): Float32Array {
  const a = 1 - Math.exp((-TAU * freq) / sr);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y += a * (buf[i]! - y);
    buf[i] = y;
  }
  return buf;
}

/** One-pole high-pass in place. */
export function onePoleHp(buf: Float32Array, freq: number, sr = SR): Float32Array {
  const a = 1 - Math.exp((-TAU * freq) / sr);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y += a * (buf[i]! - y);
    buf[i] = buf[i]! - y;
  }
  return buf;
}

// ---------------------------------------------------------------------------------------------
// Resampling
// ---------------------------------------------------------------------------------------------

/** Reads `buf` at a fractional position with a 4-point Hermite curve. Zero outside the buffer. */
export function readHermite(buf: Float32Array, pos: number): number {
  const i = Math.floor(pos);
  const n = buf.length;
  if (i < -1 || i >= n) return 0;
  const f = pos - i;
  const xm = i > 0 ? buf[i - 1]! : 0;
  const x0 = i >= 0 ? buf[i]! : 0;
  const x1 = i + 1 < n ? buf[i + 1]! : 0;
  const x2 = i + 2 < n ? buf[i + 2]! : 0;
  const c = (x1 - xm) * 0.5;
  const v = x0 - x1;
  const w = c + v;
  const a = w + v + (x2 - x0) * 0.5;
  return ((a * f - (w + a)) * f + c) * f + x0;
}

/** `length` output samples read from `start` at `rate` input samples per output sample. A negative rate reads backwards. */
export function resample(buf: Float32Array, start: number, rate: number, length: number): Float32Array {
  const out = new Float32Array(length);
  let pos = start;
  for (let i = 0; i < length; i++) {
    out[i] = readHermite(buf, pos);
    pos += rate;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// FFT, for analysis only.
// ---------------------------------------------------------------------------------------------

/** In-place radix-2 FFT. The length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!; re[i] = re[j]!; re[j] = tr;
      const ti = im[i]!; im[i] = im[j]!; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -TAU / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}
