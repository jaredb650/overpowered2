/**
 * Numeric analysis of rendered audio. Nobody on this project can listen to a build, so a sound's
 * intent has to be something a test can read: level, envelope, spectrum, seam.
 */
import type { Expect } from './synth/recipe';

export interface AudioStats {
  seconds: number;
  channels: number;
  peak: number;
  rms: number;
  /** Peak to RMS in dB. */
  crest: number;
  /** See `loudness`. */
  loud: number;
  /** Mean sample value, as a share of full scale. */
  dc: number;
  nan: number;
  /** Samples at or above full scale. */
  clipped: number;
  /** Milliseconds from the start until the envelope first reaches 90% of its peak. */
  attackMs: number;
  /** Seconds from the peak until the envelope stays below -40 dB of it. */
  decaySeconds: number;
  /** Loudest point of the last tenth, against the peak. High on a one-shot means it gets cut off, not finished. */
  tail: number;
  /** Energy-weighted mean spectral centroid in Hz. */
  centroid: number;
  centroidFirst: number;
  centroidLast: number;
  /** Share of spectral energy below 120 Hz. */
  sub: number;
  /** Share of spectral energy above 4 kHz. */
  air: number;
  /**
   * Jump between the last and first sample, against the sound's typical sample-to-sample step. Near 1
   * for a clean loop whatever its content, and large for a click. Only meaningful for loops.
   */
  seam: number;
}

const FFT_SIZE = 2048;

/** In-place radix-2 FFT on real and imaginary arrays. */
function fft(re: Float64Array, im: Float64Array): void {
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
    const ang = (-2 * Math.PI) / len;
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
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** Power spectra of overlapping Hann windows. Callback gets each frame's bins and time. */
export function spectra(
  mono: Float32Array, sampleRate: number, hop: number,
  frame: (bins: Float64Array, seconds: number) => void,
): void {
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const bins = new Float64Array(FFT_SIZE / 2);
  for (let start = 0; start < mono.length; start += hop) {
    for (let i = 0; i < FFT_SIZE; i++) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
      re[i] = (mono[start + i] ?? 0) * hann;
      im[i] = 0;
    }
    fft(re, im);
    for (let i = 0; i < bins.length; i++) bins[i] = re[i]! * re[i]! + im[i]! * im[i]!;
    frame(bins, start / sampleRate);
  }
}

export function mixdown(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const out = new Float32Array(channels[0]!.length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] = out[i]! + ch[i]! / channels.length;
  return out;
}

/**
 * Perceived level: the loudest 50 ms after a filter shaped like hearing (and like laptop speakers),
 * which discounts sub bass and lifts the presence band. Peak level says nothing about loudness: a
 * sustained scream and a gunshot can share a peak and be 15 dB apart to the ear.
 */
export function loudness(channels: readonly Float32Array[], sampleRate: number): number {
  const window = Math.max(1, Math.floor(sampleRate * 0.05));
  const hpCoef = Math.exp((-2 * Math.PI * 90) / sampleRate);
  const shelfCoef = 1 - Math.exp((-2 * Math.PI * 1800) / sampleRate);
  let loudest = 0;
  for (const data of channels) {
    let lp1 = 0, lp2 = 0, shelf = 0, sum = 0;
    const squares = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      lp1 = lp1 * hpCoef + data[i]! * (1 - hpCoef);
      const a = data[i]! - lp1;
      lp2 = lp2 * hpCoef + a * (1 - hpCoef);
      const b = a - lp2;
      shelf += (b - shelf) * shelfCoef;
      const v = b + (b - shelf) * 0.6;
      const sq = v * v;
      squares[i] = sq;
      sum += sq;
      if (i >= window) sum -= squares[i - window]!;
      if (sum > loudest) loudest = sum;
    }
  }
  return Math.sqrt(loudest / Math.min(window, channels[0]!.length));
}

export function analyze(channels: readonly Float32Array[], sampleRate: number): AudioStats {
  const length = channels[0]!.length;
  let peak = 0;
  let sumSq = 0;
  let sum = 0;
  let nan = 0;
  let clipped = 0;
  for (const ch of channels) {
    for (let i = 0; i < length; i++) {
      const v = ch[i]!;
      if (!Number.isFinite(v)) { nan++; continue; }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      if (a >= 1) clipped++;
      sumSq += v * v;
      sum += v;
    }
  }
  const count = Math.max(1, length * channels.length);
  const rms = Math.sqrt(sumSq / count);

  // Envelope at 1 ms resolution.
  const mono = mixdown(channels);
  const block = Math.max(1, Math.floor(sampleRate / 1000));
  const blocks = Math.ceil(length / block);
  const env = new Float32Array(blocks);
  let envPeak = 0;
  let peakBlock = 0;
  for (let b = 0; b < blocks; b++) {
    let m = 0;
    for (let i = b * block; i < Math.min(length, (b + 1) * block); i++) m = Math.max(m, Math.abs(mono[i]!));
    env[b] = m;
    if (m > envPeak) { envPeak = m; peakBlock = b; }
  }
  let attackMs = 0;
  for (let b = 0; b < blocks; b++) {
    if (env[b]! >= envPeak * 0.9) { attackMs = b; break; }
  }
  let lastLoud = peakBlock;
  for (let b = blocks - 1; b >= peakBlock; b--) {
    if (env[b]! >= envPeak * 0.01) { lastLoud = b; break; }
  }

  let tail = 0;
  for (let b = Math.floor(blocks * 0.9); b < blocks; b++) tail = Math.max(tail, env[b]!);

  let weighted = 0;
  let energy = 0;
  let subEnergy = 0;
  let airEnergy = 0;
  const seconds = length / sampleRate;
  let firstW = 0, firstE = 0, lastW = 0, lastE = 0;
  const binHz = sampleRate / FFT_SIZE;
  spectra(mono, sampleRate, FFT_SIZE / 2, (bins, t) => {
    let e = 0;
    let w = 0;
    for (let i = 1; i < bins.length; i++) {
      const f = i * binHz;
      const p = bins[i]!;
      e += p;
      w += p * f;
      if (f < 120) subEnergy += p;
      else if (f > 4000) airEnergy += p;
    }
    energy += e;
    weighted += w;
    if (t < seconds / 3) { firstE += e; firstW += w; }
    if (t > (seconds * 2) / 3) { lastE += e; lastW += w; }
  });
  const safeEnergy = Math.max(energy, 1e-20);

  let seam = 0;
  for (const ch of channels) {
    let step = 0;
    for (let i = 1; i < length; i++) {
      const d = ch[i]! - ch[i - 1]!;
      step += d * d;
    }
    const typical = Math.sqrt(step / Math.max(1, length - 1));
    if (typical > 0) seam = Math.max(seam, Math.abs(ch[length - 1]! - ch[0]!) / typical);
  }

  return {
    seconds,
    channels: channels.length,
    peak,
    rms,
    crest: rms > 0 ? 20 * Math.log10(peak / rms) : 0,
    loud: loudness(channels, sampleRate),
    dc: sum / count,
    nan,
    clipped,
    attackMs,
    decaySeconds: (lastLoud - peakBlock) / 1000,
    tail: envPeak > 0 ? tail / envPeak : 0,
    centroid: weighted / safeEnergy,
    centroidFirst: firstE > 0 ? firstW / firstE : 0,
    centroidLast: lastE > 0 ? lastW / lastE : 0,
    sub: subEnergy / safeEnergy,
    air: airEnergy / safeEnergy,
    seam,
  };
}


/** Rules every synthesized sound must pass, plus whatever its recipe asks for. */
export function checkStats(stats: AudioStats, expect: Expect | undefined, loop: boolean, targetPeak: number): string[] {
  const failures: string[] = [];
  if (stats.nan > 0) failures.push(`${stats.nan} non-finite samples`);
  if (stats.clipped > 0) failures.push(`${stats.clipped} clipped samples`);
  if (stats.peak < targetPeak * 0.9) failures.push(`peak ${stats.peak.toFixed(3)} below target ${targetPeak}`);
  if (stats.peak > 0.999) failures.push(`peak ${stats.peak.toFixed(3)} leaves no headroom`);
  if (stats.rms < 0.002) failures.push(`rms ${stats.rms.toFixed(4)}: effectively silent`);
  if (Math.abs(stats.dc) > 0.01) failures.push(`dc offset ${stats.dc.toFixed(4)}`);
  if (loop && stats.seam > 6) failures.push(`loop seam jump ${stats.seam.toFixed(1)}x a typical step`);
  if (!expect) return failures;
  const { centroid, attackMs, minSub, trend } = expect;
  if (centroid && (stats.centroid < centroid[0] || stats.centroid > centroid[1])) {
    failures.push(`centroid ${stats.centroid.toFixed(0)} Hz outside ${centroid[0]}-${centroid[1]}`);
  }
  if (attackMs && (stats.attackMs < attackMs[0] || stats.attackMs > attackMs[1])) {
    failures.push(`attack ${stats.attackMs} ms outside ${attackMs[0]}-${attackMs[1]}`);
  }
  if (minSub !== undefined && stats.sub < minSub) failures.push(`sub ${stats.sub.toFixed(3)} below ${minSub}`);
  if (trend === 1 && stats.centroidLast <= stats.centroidFirst) {
    failures.push(`centroid should rise: ${stats.centroidFirst.toFixed(0)} to ${stats.centroidLast.toFixed(0)}`);
  }
  if (trend === -1 && stats.centroidLast >= stats.centroidFirst) {
    failures.push(`centroid should fall: ${stats.centroidFirst.toFixed(0)} to ${stats.centroidLast.toFixed(0)}`);
  }
  return failures;
}
