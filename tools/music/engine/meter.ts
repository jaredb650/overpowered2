/**
 * Measurement: loudness to ITU-R BS.1770 (the same numbers ffmpeg's ebur128 prints), band balance, energy over time,
 * stereo checks, and rough tempo and key estimates for reading a reference track. Nothing here changes a buffer.
 */
import { SR, TAU, toDb, type Stereo } from './core';
import { biquad, fft, type Biquad } from './dsp';

function kCoefs(sr: number): [Biquad, Biquad] {
  // The two K-weighting stages, derived for any sample rate (the standard only tabulates 48 kHz).
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sr);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = { b0: (Vh + (Vb * K) / Q + K * K) / a0, b1: (2 * (K * K - Vh)) / a0, b2: (Vh - (Vb * K) / Q + K * K) / a0, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  const f1 = 38.13547087602444;
  const Q1 = 0.5003270373238773;
  K = Math.tan((Math.PI * f1) / sr);
  a0 = 1 + K / Q1 + K * K;
  const hp: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q1 + K * K) / a0 };
  return [shelf, hp];
}

export interface Loudness {
  /** LUFS, gated. */
  integrated: number;
  /** Loudest 400 ms and loudest 3 s, LUFS. */
  momentaryMax: number;
  shortTermMax: number;
  /** Loudness range in LU: the spread between the quiet and loud parts. */
  range: number;
}

export function loudness(buf: Stereo, sr = SR): Loudness {
  const [shelf, hp] = kCoefs(sr);
  const n = buf[0].length;
  const block = Math.round(0.4 * sr);
  const hop = Math.round(0.1 * sr);
  const count = Math.max(0, Math.floor((n - block) / hop) + 1);
  if (count === 0) return { integrated: -Infinity, momentaryMax: -Infinity, shortTermMax: -Infinity, range: 0 };
  // Energy per 100 ms hop, summed over channels, then blocks are sums of four hops.
  const hops = Math.floor(n / hop);
  const hopEnergy = new Float64Array(hops);
  for (const ch of buf) {
    const w = ch.slice();
    biquad(w, shelf);
    biquad(w, hp);
    for (let h = 0; h < hops; h++) {
      let sum = 0;
      const from = h * hop;
      for (let i = from; i < from + hop; i++) sum += w[i] * w[i];
      hopEnergy[h] += sum;
    }
  }
  const lk = (meanSquare: number): number => -0.691 + 10 * Math.log10(Math.max(1e-12, meanSquare));
  const blocks: number[] = [];
  for (let b = 0; b + 4 <= hops; b++) blocks.push((hopEnergy[b] + hopEnergy[b + 1] + hopEnergy[b + 2] + hopEnergy[b + 3]) / (4 * hop));
  const gated = blocks.filter(z => lk(z) > -70);
  const mean = (list: number[]): number => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
  const rel = lk(mean(gated)) - 10;
  const kept = gated.filter(z => lk(z) > rel);
  const integrated = kept.length ? lk(mean(kept)) : -Infinity;
  let momentaryMax = -Infinity;
  for (const z of blocks) momentaryMax = Math.max(momentaryMax, lk(z));
  // Short-term: 3 s windows every 100 ms.
  const st: number[] = [];
  let run = 0;
  for (let h = 0; h < hops; h++) {
    run += hopEnergy[h];
    if (h >= 30) run -= hopEnergy[h - 30];
    if (h >= 29) st.push(run / (30 * hop));
  }
  let shortTermMax = -Infinity;
  for (const z of st) shortTermMax = Math.max(shortTermMax, lk(z));
  // Range (EBU Tech 3342): 10th to 95th percentile of short-term loudness above a gate 20 LU under the mean.
  const stAbs = st.filter(z => lk(z) > -70);
  const stRel = lk(mean(stAbs)) - 20;
  const stKept = stAbs.map(lk).filter(v => v > stRel).sort((a, b) => a - b);
  const pct = (p: number): number => stKept[Math.min(stKept.length - 1, Math.max(0, Math.round(p * (stKept.length - 1))))] ?? 0;
  const range = stKept.length > 1 ? pct(0.95) - pct(0.1) : 0;
  return { integrated, momentaryMax, shortTermMax, range };
}

export function samplePeak(buf: Stereo): number {
  let p = 0;
  for (const ch of buf) for (let i = 0; i < ch.length; i++) p = Math.max(p, Math.abs(ch[i]));
  return p;
}

/** Averaged power spectrum of the mid signal: `size / 2` bins of `sr / size` Hz. */
export function spectrum(buf: Stereo, size = 8192, from = 0, to = buf[0].length): Float64Array {
  const acc = new Float64Array(size / 2);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const win = new Float64Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((TAU * i) / size);
  const span = to - from;
  const frames = Math.max(1, Math.min(600, Math.floor(span / size)));
  const hop = Math.max(1, Math.floor((span - size) / Math.max(1, frames - 1)));
  let used = 0;
  for (let f = 0; f < frames; f++) {
    const at = from + f * hop;
    if (at + size > to) break;
    for (let i = 0; i < size; i++) {
      re[i] = (buf[0][at + i] + buf[1][at + i]) * 0.5 * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < size / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
    used++;
  }
  if (used > 0) for (let k = 0; k < acc.length; k++) acc[k] /= used;
  return acc;
}

export const BANDS: readonly [string, number, number][] = [
  ['sub <60', 20, 60],
  ['bass 60-150', 60, 150],
  ['lowmid 150-400', 150, 400],
  ['mid 400-1.5k', 400, 1500],
  ['himid 1.5-5k', 1500, 5000],
  ['high 5-10k', 5000, 10000],
  ['air 10k+', 10000, 20000],
];

/** Level of each band in dB relative to the whole. A full, modern mix slopes down from the bass to the air. */
export function bandBalance(buf: Stereo, sr = SR, from = 0, to = buf[0].length): { name: string; db: number }[] {
  const size = 8192;
  const spec = spectrum(buf, size, from, to);
  let total = 0;
  for (let k = 1; k < spec.length; k++) total += spec[k];
  return BANDS.map(([name, lo, hi]) => {
    let sum = 0;
    const a = Math.max(1, Math.round((lo * size) / sr));
    const b = Math.min(spec.length - 1, Math.round((hi * size) / sr));
    for (let k = a; k < b; k++) sum += spec[k];
    return { name, db: 10 * Math.log10(Math.max(1e-20, sum) / Math.max(1e-20, total)) };
  });
}

/** RMS in dB of each `seconds`-long window. */
export function energyOverTime(buf: Stereo, seconds: number, sr = SR): number[] {
  const win = Math.max(1, Math.round(seconds * sr));
  const out: number[] = [];
  for (let at = 0; at + win <= buf[0].length; at += win) {
    let sum = 0;
    for (let i = at; i < at + win; i++) sum += buf[0][i] * buf[0][i] + buf[1][i] * buf[1][i];
    out.push(toDb(Math.sqrt(sum / (2 * win))));
  }
  return out;
}

export interface StereoStats {
  /** 1 is mono, 0 is unrelated left and right, below 0 cancels when summed. */
  correlation: number;
  /** Side level relative to mid, dB. */
  sideDb: number;
  /** Level lost when the mix is summed to mono, dB. */
  monoLossDb: number;
  /** DC offset as a share of full scale. */
  dc: number;
}

export function stereoStats(buf: Stereo): StereoStats {
  const [L, R] = buf;
  let ll = 0, rr = 0, lr = 0, mm = 0, ss = 0, dc = 0;
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    const r = R[i];
    ll += l * l;
    rr += r * r;
    lr += l * r;
    const m = (l + r) * 0.5;
    const s = (l - r) * 0.5;
    mm += m * m;
    ss += s * s;
    dc += m;
  }
  return {
    correlation: lr / Math.max(1e-20, Math.sqrt(ll * rr)),
    sideDb: 10 * Math.log10(Math.max(1e-20, ss) / Math.max(1e-20, mm)),
    monoLossDb: 10 * Math.log10(Math.max(1e-20, mm) / Math.max(1e-20, (ll + rr) / 4)) - 3.0103,
    dc: dc / Math.max(1, L.length),
  };
}

/** Crest factor: peak over RMS, dB. Around 8 to 10 is a loud electronic master, 14 and up is dynamic. */
export function crest(buf: Stereo): number {
  let sum = 0;
  for (const ch of buf) for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
  const rms = Math.sqrt(sum / (2 * buf[0].length));
  return toDb(samplePeak(buf)) - toDb(rms);
}

/** Tempo from the periodicity of the onset envelope. Good to about a BPM on music with drums. */
export function estimateTempo(buf: Stereo, sr = SR, lo = 110, hi = 200): { bpm: number; strength: number } {
  const hop = 256;
  const n = Math.floor(buf[0].length / hop);
  const env = new Float32Array(n);
  // Two envelopes, low and high, so both kicks and hats count as onsets.
  let lpState = 0;
  const a = 1 - Math.exp((-TAU * 150) / sr);
  let prevLow = 0;
  let prevHigh = 0;
  for (let h = 0; h < n; h++) {
    let low = 0;
    let high = 0;
    for (let i = h * hop; i < (h + 1) * hop; i++) {
      const m = (buf[0][i] + buf[1][i]) * 0.5;
      lpState += a * (m - lpState);
      low += lpState * lpState;
      const hi2 = m - lpState;
      high += hi2 * hi2;
    }
    const l = Math.log(1e-9 + low);
    const g = Math.log(1e-9 + high);
    env[h] = Math.max(0, l - prevLow) + Math.max(0, g - prevHigh);
    prevLow = l;
    prevHigh = g;
  }
  let best = 0;
  let bestBpm = 0;
  let total = 0;
  let count = 0;
  for (let bpm = lo; bpm <= hi; bpm += 0.1) {
    const lag = (60 / bpm) * (sr / hop);
    let score = 0;
    // The beat and its bar-level multiples should all line up.
    for (const mult of [1, 2, 4]) {
      const L = lag * mult;
      const Li = Math.floor(L);
      const f = L - Li;
      let acc = 0;
      for (let h = 0; h + Li + 1 < n; h += 2) acc += env[h] * (env[h + Li] * (1 - f) + env[h + Li + 1] * f);
      score += acc;
    }
    total += score;
    count++;
    if (score > best) {
      best = score;
      bestBpm = bpm;
    }
  }
  return { bpm: Math.round(bestBpm * 10) / 10, strength: best / Math.max(1e-9, total / count) };
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Key by matching the pitch-class energy between 55 Hz and 2 kHz against major and minor profiles. A guess, not a fact. */
export function estimateKey(buf: Stereo, sr = SR): { key: string; confidence: number; chroma: number[] } {
  const size = 16384;
  const spec = spectrum(buf, size);
  const chroma = new Array<number>(12).fill(0);
  for (let k = 1; k < spec.length; k++) {
    const f = (k * sr) / size;
    if (f < 55 || f > 2000) continue;
    const note = 69 + 12 * Math.log2(f / 440);
    const pc = ((Math.round(note) % 12) + 12) % 12;
    chroma[pc] += Math.sqrt(spec[k]);
  }
  const norm = Math.max(...chroma) || 1;
  const c = chroma.map(v => v / norm);
  const corr = (profile: number[], shift: number): number => {
    const mp = profile.reduce((a, b) => a + b, 0) / 12;
    const mc = c.reduce((a, b) => a + b, 0) / 12;
    let num = 0, dp = 0, dc = 0;
    for (let i = 0; i < 12; i++) {
      const p = profile[i] - mp;
      const v = c[(i + shift) % 12] - mc;
      num += p * v;
      dp += p * p;
      dc += v * v;
    }
    return num / Math.sqrt(dp * dc || 1);
  };
  const scores: { key: string; r: number }[] = [];
  for (let s = 0; s < 12; s++) {
    scores.push({ key: `${NAMES[s]} major`, r: corr(MAJOR, s) });
    scores.push({ key: `${NAMES[s]} minor`, r: corr(MINOR, s) });
  }
  scores.sort((a, b) => b.r - a.r);
  return { key: scores[0].key, confidence: scores[0].r - scores[1].r, chroma: c.map(v => Math.round(v * 100) / 100) };
}
