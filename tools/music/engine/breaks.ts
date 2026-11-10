/**
 * Breakbeats without samples. `breakKit` synthesizes an acoustic-sounding kit, `breakLoop` plays a one or two bar
 * pattern on it with a drummer's unevenness and glues it through a room, a compressor and some saturation, and `chop`
 * cuts that loop into slices and resequences them at the song's tempo, the way a sampler would: faster is higher.
 */
import { SR, Rng, type Mono, type Stereo } from './core';
import { readHermite } from './dsp';
import { kick, snare, hat, ride, dulled, type KickOpts, type SnareOpts } from './drums';
import { compress, drive, eq, filt, mixInto, reverb, silence, crush, type EqBand } from './fx';

export interface BreakKit {
  kick: Mono;
  snare: Mono;
  /** A soft, dull snare stroke between the backbeats. */
  ghost: Mono;
  hat: Mono;
  open: Mono;
  ride: Mono;
}

export interface KitOpts {
  seed?: number;
  /** Overrides on the kick and snare, for a deeper or tighter kit. */
  kick?: KickOpts;
  snare?: SnareOpts;
  /** Seconds. A longer closed hat is a looser, older-sounding kit. */
  hatDecay?: number;
  /** 0..1: how metallic the hats are against plain noise. */
  hatMetal?: number;
}

export function breakKit(o: KitOpts = {}): BreakKit {
  const seed = o.seed ?? 1;
  const sn = snare({ tone: 205, tone2: 372, bend: 55, toneDecay: 0.085, body: 0.75, noise: 0.9, noiseDecay: 0.15, noiseHp: 1100, noiseLp: 8800, snap: 0.5, drive: 1.8, seed: seed + 1, ...o.snare });
  return {
    kick: kick({ freq: 62, punch: 150, sweep: 0.018, punch2: 26, sweep2: 0.06, hold: 0.012, decay: 0.2, click: 0.5, clickHz: 1700, drive: 1.7, seed, ...o.kick }),
    snare: sn,
    ghost: dulled(snare({ tone: 215, tone2: 390, bend: 30, toneDecay: 0.05, body: 0.6, noise: 0.8, noiseDecay: 0.07, noiseHp: 1300, noiseLp: 6000, snap: 0.2, drive: 1.2, seed: seed + 2 }), 5200, 1),
    hat: hat({ decay: o.hatDecay ?? 0.04, metal: o.hatMetal ?? 0.28, hp: 6200, bp: 8600, seed: seed + 3 }),
    open: hat({ decay: 0.24, metal: o.hatMetal ?? 0.3, hp: 5600, bp: 8200, seed: seed + 4 }),
    ride: ride({ decay: 0.42, ping: 0.6, seed: seed + 5 }),
  };
}

export interface BreakSpec {
  /** Tempo the drummer plays at. Chopping at a faster song tempo raises the pitch by the same ratio. */
  bpm: number;
  /** Bars of 4/4. Each pattern has 16 steps a bar and repeats if it is shorter. */
  bars?: number;
  /** One character per sixteenth: `X` loud, `x` normal, `o` soft, `1`-`9` a level, `.` or `-` a rest. Spaces and `|` are ignored. */
  kick: string;
  snare: string;
  ghost?: string;
  hat?: string;
  open?: string;
  ride?: string;
  /** Share of a sixteenth that the off sixteenths arrive late, 0 to about 0.3. */
  swing?: number;
  /** Seconds of random timing error. */
  human?: number;
  /** 0..1 of random level error. */
  loose?: number;
  /** Level of the room around the kit, 0..1. */
  room?: number;
  roomDecay?: number;
  /** dB of saturation over the whole kit. */
  drive?: number;
  /** 0..1: how hard the kit is squashed. This is what makes the tails breathe. */
  squash?: number;
  /** Band limits of the "recording", Hz. */
  lp?: number;
  hp?: number;
  /** Bit depth and sample rate of an old sampler. */
  crush?: { bits?: number; rate?: number };
  eq?: EqBand[];
  seed?: number;
}

export interface BreakLoop {
  buf: Stereo;
  bpm: number;
  beats: number;
}

/** Level of a pattern character, or 0 for a rest. */
export function stepLevel(ch: string): number {
  if (ch === 'X') return 1;
  if (ch === 'x') return 0.8;
  if (ch === 'o') return 0.5;
  if (ch >= '1' && ch <= '9') return Number(ch) / 9;
  return 0;
}

const clean = (p: string): string => p.replace(/[\s|]/g, '');

export function breakLoop(kit: BreakKit, spec: BreakSpec): BreakLoop {
  const bars = spec.bars ?? 2;
  const steps = bars * 16;
  const stepSec = 60 / spec.bpm / 4;
  const n = Math.round(steps * stepSec * SR);
  const rng = new Rng(spec.seed ?? 21);
  const human = spec.human ?? 0.0035;
  const loose = spec.loose ?? 0.14;
  const swing = spec.swing ?? 0;
  // Two passes, so the tails of the first wrap into the second and the loop has no seam.
  const dry = silence(n * 2);
  const lay = (pattern: string | undefined, hitBuf: Mono, level: number, pan: number, tight: number): void => {
    if (!pattern) return;
    const p = clean(pattern);
    if (!p.length) return;
    for (let s = 0; s < steps; s++) {
      const v = stepLevel(p[s % p.length]);
      if (v <= 0) continue;
      const late = s % 2 === 1 ? swing * stepSec : 0;
      const jitter = rng.bi() * human * tight;
      const gain = level * v * (1 + rng.bi() * loose);
      for (let pass = 0; pass < 2; pass++) {
        const at = Math.round((s * stepSec + late + jitter) * SR) + pass * n;
        mixInto(dry, hitBuf, Math.max(0, at), gain, pan);
      }
    }
  };
  lay(spec.kick, kit.kick, 1, 0, 0.5);
  lay(spec.snare, kit.snare, 0.95, 0.04, 0.6);
  lay(spec.ghost, kit.ghost, 0.5, 0.06, 1.4);
  lay(spec.hat, kit.hat, 0.42, -0.12, 1);
  lay(spec.open, kit.open, 0.4, -0.12, 1);
  lay(spec.ride, kit.ride, 0.36, 0.18, 1);

  const room = spec.room ?? 0.2;
  if (room > 0) {
    const wet: Stereo = [dry[0].slice(), dry[1].slice()];
    reverb(wet, { decay: spec.roomDecay ?? 0.45, size: 0.55, damp: 5200, predelay: 0.004, hp: 220 });
    mixInto(dry, wet, 0, room * 1.6);
  }
  const squash = spec.squash ?? 0.6;
  if (squash > 0) compress(dry, { threshold: -10 - squash * 14, ratio: 2 + squash * 6, attack: 0.004, release: 0.09, knee: 6, makeup: squash * 9 });
  if ((spec.drive ?? 6) > 0) drive(dry, { amount: spec.drive ?? 6, shape: 'tanh' });
  if (spec.crush) crush(dry, spec.crush);
  eq(dry, spec.eq ?? [{ type: 'peak', freq: 210, q: 1, gain: 2.5 }, { type: 'peak', freq: 4200, q: 0.8, gain: 2 }]);
  filt(dry, 'hp', spec.hp ?? 45);
  filt(dry, 'lp', spec.lp ?? 14500);
  const buf: Stereo = [dry[0].slice(n, 2 * n), dry[1].slice(n, 2 * n)];
  let peak = 0;
  for (const ch of buf) for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(ch[i]));
  if (peak > 0) for (const ch of buf) for (let i = 0; i < n; i++) ch[i] /= peak;
  return { buf, bpm: spec.bpm, beats: bars * 4 };
}

export interface ChopStep {
  /** Slice number, or null for a rest. */
  slice: number | null;
  /** Length in steps. */
  len: number;
  reverse?: boolean;
  /** Times the slice restarts inside its length. */
  retrig?: number;
  /** Semitones on top of the tempo ratio. */
  pitch?: number;
  /** Semitones the pitch travels over the retriggers: a rising or falling roll. */
  ramp?: number;
  gain?: number;
  /** Plays only this share of each slot, leaving a gap. */
  gate?: number;
}

export interface ChopOpts {
  /** The song's tempo. */
  bpm: number;
  /** Beats per token of the pattern. 0.5 (an eighth) by default. */
  step?: number;
  /** Beats per slice of the loop. Equal to `step` by default, so slice 2 is the loop's second step. */
  slice?: number;
  /** Semitones for everything, on top of the tempo ratio. */
  pitch?: number;
  gain?: number;
  /** Seconds of fade at the end of each slice. */
  fade?: number;
}

/**
 * Pattern tokens, separated by spaces (`|` is ignored):
 *   `4`      slice 4 for one step
 *   `_`      hold the previous slice one step longer
 *   `-` `.`  rest
 *   `4r`     reversed
 *   `4x3`    restarted three times inside the step
 *   `4p-5`   five semitones down     `4x4u7` a roll rising seven semitones     `4x4d12` falling twelve
 *   `4g60`   at 60% level            `4h` only the first half of the step, then a gap
 */
export function parseChop(pattern: string): ChopStep[] {
  const out: ChopStep[] = [];
  for (const tok of pattern.split(/[\s|]+/).filter(Boolean)) {
    if (tok === '_') {
      const last = out[out.length - 1];
      if (!last) throw new Error('A chop pattern cannot start with a hold');
      last.len++;
      continue;
    }
    if (tok === '-' || tok === '.') {
      out.push({ slice: null, len: 1 });
      continue;
    }
    const m = /^(\d+)((?:r|h|x\d+|p-?\d+(?:\.\d+)?|u\d+|d\d+|g\d+)*)$/.exec(tok);
    if (!m) throw new Error(`Not a chop token: "${tok}"`);
    const step: ChopStep = { slice: Number(m[1]), len: 1 };
    for (const mod of m[2].match(/r|h|x\d+|p-?\d+(?:\.\d+)?|u\d+|d\d+|g\d+/g) ?? []) {
      const v = Number(mod.slice(1));
      if (mod === 'r') step.reverse = true;
      else if (mod === 'h') step.gate = 0.5;
      else if (mod[0] === 'x') step.retrig = Math.max(1, v);
      else if (mod[0] === 'p') step.pitch = v;
      else if (mod[0] === 'u') step.ramp = v;
      else if (mod[0] === 'd') step.ramp = -v;
      else if (mod[0] === 'g') step.gain = v / 100;
    }
    out.push(step);
  }
  return out;
}

/** Resequences a loop. The result is as long as the pattern: tokens x `step` beats at the song's tempo. */
export function chop(loop: BreakLoop, pattern: string | readonly ChopStep[], o: ChopOpts): Stereo {
  const steps = typeof pattern === 'string' ? parseChop(pattern) : pattern;
  const stepBeats = o.step ?? 0.5;
  const sliceBeats = o.slice ?? stepBeats;
  const stepSamples = (stepBeats * 60 * SR) / o.bpm;
  const total = steps.reduce((a, s) => a + s.len, 0);
  const n = Math.round(total * stepSamples);
  const out = silence(n);
  const srcLen = loop.buf[0].length;
  const sliceSamples = (sliceBeats * 60 * SR) / loop.bpm;
  const baseRate = (o.bpm / loop.bpm) * Math.pow(2, (o.pitch ?? 0) / 12);
  const fadeN = Math.max(8, Math.round((o.fade ?? 0.003) * SR));
  const fadeIn = 24;
  let pos = 0;
  for (const st of steps) {
    const slotStart = Math.round(pos * stepSamples);
    const slotEnd = Math.round((pos + st.len) * stepSamples);
    pos += st.len;
    if (st.slice === null) continue;
    const reps = st.retrig ?? 1;
    const gain = (st.gain ?? 1) * (o.gain ?? 1);
    const srcStart = (((st.slice * sliceSamples) % srcLen) + srcLen) % srcLen;
    for (let r = 0; r < reps; r++) {
      const a = slotStart + Math.round(((slotEnd - slotStart) * r) / reps);
      const b = slotStart + Math.round(((slotEnd - slotStart) * (r + 1)) / reps);
      const len = Math.max(1, Math.round((b - a) * (st.gate ?? 1)));
      const semis = (st.pitch ?? 0) + (reps > 1 ? ((st.ramp ?? 0) * r) / (reps - 1) : 0);
      const rate = baseRate * Math.pow(2, semis / 12);
      const f = Math.min(fadeN, len >> 1);
      for (let c = 0; c < 2; c++) {
        const src = loop.buf[c];
        const dst = out[c];
        for (let i = 0; i < len; i++) {
          let p = st.reverse ? srcStart + (len - 1 - i) * rate : srcStart + i * rate;
          p %= srcLen;
          let v = readHermite(src, p);
          // The last sample of the loop interpolates towards its first.
          if (p > srcLen - 1) v += (p - (srcLen - 1)) * src[0];
          let g = gain;
          if (i < fadeIn) g *= i / fadeIn;
          if (i >= len - f) g *= (len - 1 - i) / f;
          if (a + i < n) dst[a + i] += v * g;
        }
      }
    }
  }
  return out;
}

/** The steps of a pattern string as `{ step, level }`, skipping rests. For placing one-shots from the same notation. */
export function hits(pattern: string): { step: number; level: number }[] {
  const p = clean(pattern);
  const out: { step: number; level: number }[] = [];
  for (let s = 0; s < p.length; s++) {
    const level = stepLevel(p[s]);
    if (level > 0) out.push({ step: s, level });
  }
  return out;
}

/** `k` hits spread as evenly as they will go over `n` steps, rotated by `rot`, as a pattern string. */
export function euclid(k: number, n: number, rot = 0): string {
  let out = '';
  for (let i = 0; i < n; i++) {
    const j = (((i - rot) % n) + n) % n;
    out += Math.floor(((j + 1) * k) / n) !== Math.floor((j * k) / n) ? 'x' : '.';
  }
  return out;
}
