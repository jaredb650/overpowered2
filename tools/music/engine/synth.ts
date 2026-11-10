/**
 * Pitched voices. One renderer (`line`) plays a patch over a list of notes as a single continuous voice, so slides,
 * accents and retriggers behave as they do on a mono synth. `tone` is one note and `chordOf` is several stacked.
 * `fmLine` and `fmTone` are the same thing for two-operator FM pairs.
 *
 * Times are seconds from the start of the returned buffer. Notes are MIDI numbers and may be fractional.
 */
import { SR, mtof, Rng, panGains, hash, type Buf, type Mono, type Stereo } from './core';
import { CR, svf, Svf, ladder, Ladder, shaper, type ShapeName } from './dsp';

export type Wave = 'saw' | 'square' | 'pulse' | 'tri' | 'sine' | 'noise';

export interface Osc {
  wave: Wave;
  /** Linear level, 1 by default. Unison voices share it, so more voices are not louder. */
  level?: number;
  semi?: number;
  cents?: number;
  /** Unison voices spread evenly over +-`detune` cents. */
  voices?: number;
  detune?: number;
  /** 0 keeps every voice in the centre, 1 pans the outer voices hard left and right. */
  spread?: number;
  /** Pulse width for `pulse`, 0..1. */
  pw?: number;
  pwm?: { rate: number; depth: number };
  /** Start every voice at phase 0, for a hard, repeatable attack. Free-running otherwise. */
  reset?: boolean;
}

/** Seconds, with `s` the sustain level 0..1. `d` and `r` are the time to fall within 1% of the target. */
export interface Env {
  a: number;
  d: number;
  s: number;
  r: number;
}

export interface Filter {
  type: 'lp' | 'hp' | 'bp' | 'notch' | 'ladder';
  /** Hz with the envelope at rest. */
  cutoff: number;
  /** Q for the state variable types (0.707 is flat). Resonance 0..1 for the ladder. */
  q?: number;
  /** Octaves the envelope adds at its peak. Negative closes the filter instead. */
  env?: number;
  /** The filter's own envelope. The amp envelope is used when this is missing. */
  shape?: Env;
  /** Key tracking: 1 moves the cutoff an octave for every octave the note is from C4. */
  key?: number;
  /** Depth in octaves. */
  lfo?: { rate: number; depth: number; phase?: number };
  /** Ladder only: gain into its saturating input. */
  drive?: number;
  /** How much a soft note closes the envelope: 0 not at all, 1 fully. */
  vel?: number;
}

export interface Patch {
  osc: Osc[];
  amp: Env;
  filter?: Filter;
  /** A fixed high-pass after the filter, Hz. */
  hp?: number;
  /** Starts `semi` semitones off and returns to pitch with time constant `time`. Retriggers with the envelopes. */
  pitchEnv?: { semi: number; time: number };
  vibrato?: { rate: number; cents: number; delay?: number };
  /** Seconds for a slide to cover most of the interval. Applies to notes marked `slide`, or to every note with `glideAll`. */
  glide?: number;
  glideAll?: boolean;
  /** Saturation after the filter and before the amp envelope, so a decaying note keeps its tone. */
  drive?: number;
  shape?: ShapeName;
  gain?: number;
  /** 0 ignores velocity, 1 (default) scales level with it. */
  velAmp?: number;
  /** Extra level and filter envelope on accented notes. */
  accent?: number;
}

export interface Note {
  /** Seconds from the start of the line. */
  t: number;
  dur: number;
  note: number;
  vel?: number;
  /** Tie into this note from the previous one: no retrigger, and the pitch glides. The previous note must end within 60 ms of this one's start. */
  slide?: boolean;
  accent?: boolean;
}

export interface LineOpts {
  seed?: number | string;
  /** Per-block modulation by time in seconds from the start of the line. */
  mod?: {
    /** Semitones added to the pitch. */
    pitch?: (t: number) => number;
    /** Multiplies the filter cutoff. */
    cutoff?: (t: number) => number;
    /** Multiplies the level. */
    amp?: (t: number) => number;
  };
  /** Seconds added after the last release. */
  tail?: number;
}

// ---------------------------------------------------------------------------------------------
// Sine table
// ---------------------------------------------------------------------------------------------

const SINE_N = 8192;
const SINE = new Float32Array(SINE_N + 1);
for (let i = 0; i <= SINE_N; i++) SINE[i] = Math.sin((i / SINE_N) * Math.PI * 2);

/** sin(2 pi x) for any x, from a table. */
export function sin1(x: number): number {
  const p = (x - Math.floor(x)) * SINE_N;
  const i = p | 0;
  return SINE[i] + (SINE[i + 1] - SINE[i]) * (p - i);
}

// ---------------------------------------------------------------------------------------------
// Controls shared by every voice type
// ---------------------------------------------------------------------------------------------

interface Seg {
  start: number;
  end: number;
  level: number;
  accent: boolean;
}

interface Controls {
  n: number;
  blocks: number;
  /** MIDI pitch per block. */
  pitch: Float32Array;
  /** Phase step of the unshifted note per block: Hz / SR. */
  inc: Float32Array;
  /** Amp envelope per sample, with velocity and accents in it. */
  amp: Float32Array;
  /** Seconds since the last retrigger, per block. */
  age: Float32Array;
  /** Velocity of the sounding note per block, 0..1. */
  vel: Float32Array;
  /** 1 on blocks of an accented note. */
  acc: Float32Array;
  segs: Seg[];
}

interface ControlSpec {
  amp: Env;
  pitchEnv?: { semi: number; time: number };
  vibrato?: { rate: number; cents: number; delay?: number };
  glide?: number;
  glideAll?: boolean;
  velAmp?: number;
  accent?: number;
}

const TIE_GAP = Math.round(0.06 * SR);

function sortNotes(notes: readonly Note[]): Note[] {
  if (notes.length === 0) throw new Error('A line needs at least one note');
  return [...notes].sort((a, b) => a.t - b.t);
}

function controls(sorted: Note[], spec: ControlSpec, opts: LineOpts): Controls {
  const { amp: env } = spec;
  const velAmp = spec.velAmp ?? 1;
  const accentAmp = 1 + (spec.accent ?? 0.4);
  const segs: Seg[] = [];
  const legato: boolean[] = [];
  let lastEnd = 0;
  let prevEnd = -1;
  for (let k = 0; k < sorted.length; k++) {
    const nt = sorted[k];
    const start = Math.max(0, Math.round(nt.t * SR));
    const end = start + Math.max(1, Math.round(nt.dur * SR));
    // A slide ties over a gap of up to 60 ms, so a line written with a little air between its notes still glides.
    const tie = k > 0 && nt.slide === true && start <= prevEnd + TIE_GAP;
    legato.push(tie);
    if (tie) {
      const seg = segs[segs.length - 1];
      seg.end = Math.max(seg.end, end);
    } else {
      const vel = nt.vel ?? 1;
      segs.push({ start, end, level: (1 - velAmp + velAmp * vel) * (nt.accent ? accentAmp : 1), accent: nt.accent === true });
    }
    prevEnd = Math.max(prevEnd, end);
    lastEnd = Math.max(lastEnd, end);
  }
  const n = lastEnd + Math.round((env.r * 1.15 + 0.012 + (opts.tail ?? 0)) * SR);
  const blocks = Math.ceil(n / CR);

  // Amp envelope, per sample.
  const amp = new Float32Array(n);
  const aInc = 1 / Math.max(1, env.a * SR);
  const dk = Math.exp(-4.6 / Math.max(1, env.d * SR));
  const rk = Math.exp(-4.6 / Math.max(1, env.r * SR));
  let v = 0;
  let lv = segs[0].level;
  for (let j = 0; j < segs.length; j++) {
    const seg = segs[j];
    const stop = j + 1 < segs.length ? Math.min(n, segs[j + 1].start) : n;
    const gateEnd = Math.min(seg.end, stop);
    const target = seg.level;
    let attacking = true;
    for (let i = seg.start; i < gateEnd; i++) {
      if (attacking) {
        v += aInc;
        if (v >= 1) {
          v = 1;
          attacking = false;
        }
      } else v = env.s + (v - env.s) * dk;
      lv += (target - lv) * 0.02;
      amp[i] = v * lv;
    }
    for (let i = gateEnd; i < stop; i++) {
      v *= rk;
      amp[i] = v * lv;
    }
  }
  const fade = Math.min(96, n);
  for (let i = 0; i < fade; i++) amp[n - 1 - i] *= i / fade;
  const ampMod = opts.mod?.amp;
  if (ampMod) {
    // Interpolated across each block so a fast curve does not step.
    let g0 = ampMod(0);
    for (let b = 0, i = 0; b < blocks; b++) {
      const g1 = ampMod(((b + 1) * CR) / SR);
      const end = Math.min(n, i + CR);
      const step = (g1 - g0) / CR;
      for (let g = g0; i < end; i++, g += step) amp[i] *= g;
      g0 = g1;
    }
  }

  // Pitch, age and velocity, per block.
  const pitch = new Float32Array(blocks);
  const inc = new Float32Array(blocks);
  const age = new Float32Array(blocks);
  const velB = new Float32Array(blocks);
  const acc = new Float32Array(blocks);
  const glide = spec.glide ?? 0;
  const gk = glide > 0 ? 1 - Math.exp(-CR / (glide * 0.33 * SR)) : 1;
  const pe = spec.pitchEnv;
  const vib = spec.vibrato;
  const pitchMod = opts.mod?.pitch;
  let k = 0;
  let cur = sorted[0].note;
  let trig = sorted[0].t;
  for (let b = 0; b < blocks; b++) {
    const t = (b * CR) / SR;
    while (k + 1 < sorted.length && sorted[k + 1].t <= t) {
      k++;
      if (!legato[k]) trig = sorted[k].t;
    }
    const nt = sorted[k];
    if (glide > 0 && (legato[k] || (spec.glideAll && k > 0))) cur += (nt.note - cur) * gk;
    else cur = nt.note;
    const since = Math.max(0, t - trig);
    let p = cur;
    if (pe) p += pe.semi * Math.exp(-since / pe.time);
    if (vib) {
      const ramp = vib.delay ? Math.min(1, Math.max(0, (since - vib.delay) / Math.max(0.01, vib.delay))) : 1;
      p += (vib.cents / 100) * ramp * sin1(vib.rate * t);
    }
    if (pitchMod) p += pitchMod(t);
    pitch[b] = p;
    inc[b] = mtof(p) / SR;
    age[b] = since;
    velB[b] = nt.vel ?? 1;
    acc[b] = nt.accent ? 1 : 0;
  }
  return { n, blocks, pitch, inc, amp, age, vel: velB, acc, segs };
}

/** An envelope per block that retriggers with the segments. */
function blockEnv(c: Controls, env: Env): Float32Array {
  const out = new Float32Array(c.blocks);
  const rate = SR / CR;
  const aInc = 1 / Math.max(1, env.a * rate);
  const dk = Math.exp(-4.6 / Math.max(1, env.d * rate));
  const rk = Math.exp(-4.6 / Math.max(1, env.r * rate));
  let v = 0;
  for (let j = 0; j < c.segs.length; j++) {
    const seg = c.segs[j];
    const from = Math.floor(seg.start / CR);
    const stop = j + 1 < c.segs.length ? Math.min(c.blocks, Math.floor(c.segs[j + 1].start / CR)) : c.blocks;
    const gateEnd = Math.min(stop, Math.ceil(seg.end / CR));
    let attacking = true;
    // A very short attack still has to reach the top within the first block.
    if (aInc >= 1) {
      v = 1;
      attacking = false;
    }
    for (let b = from; b < gateEnd; b++) {
      out[b] = v;
      if (attacking) {
        v += aInc;
        if (v >= 1) {
          v = 1;
          attacking = false;
        }
      } else v = env.s + (v - env.s) * dk;
    }
    for (let b = gateEnd; b < stop; b++) {
      out[b] = v;
      v *= rk;
    }
  }
  return out;
}

function cutoffCurve(f: Filter, c: Controls, patchEnv: Env, accent: number, opts: LineOpts): Float32Array {
  const out = new Float32Array(c.blocks);
  const envAmt = f.env ?? 0;
  const fenv = envAmt !== 0 ? blockEnv(c, f.shape ?? patchEnv) : null;
  const key = f.key ?? 0;
  const velAmt = f.vel ?? 0;
  const lfo = f.lfo;
  const mod = opts.mod?.cutoff;
  for (let b = 0; b < c.blocks; b++) {
    let oct = 0;
    if (fenv) oct += envAmt * fenv[b] * (1 - velAmt * (1 - c.vel[b])) * (1 + accent * c.acc[b]);
    if (key) oct += (key * (c.pitch[b] - 60)) / 12;
    const t = (b * CR) / SR;
    if (lfo) oct += lfo.depth * sin1(lfo.rate * t + (lfo.phase ?? 0));
    let hz = f.cutoff * Math.pow(2, oct);
    if (mod) hz *= mod(t);
    out[b] = hz;
  }
  return out;
}

function seedOf(opts: LineOpts, sorted: Note[]): number {
  const s = opts.seed;
  if (typeof s === 'number') return s;
  if (typeof s === 'string') return hash(s);
  return hash(`line:${sorted[0].note}:${sorted.length}`);
}

function applyFilter(ch: Float32Array, f: Filter, fc: Float32Array): void {
  if (f.type === 'ladder') ladder(ch, fc, f.q ?? 0.3, f.drive ?? 1, SR, new Ladder());
  else svf(ch, f.type, fc, f.q ?? 0.707, SR, new Svf());
}

function finish(L: Float32Array, R: Float32Array, stereo: boolean, p: { filter?: Filter; hp?: number; drive?: number; shape?: ShapeName; gain?: number; amp: Env; accent?: number }, c: Controls, opts: LineOpts): Buf {
  const chans = stereo ? [L, R] : [L];
  if (p.filter) {
    const fc = cutoffCurve(p.filter, c, p.amp, p.accent ?? 0.4, opts);
    for (const ch of chans) applyFilter(ch, p.filter, fc);
  }
  if (p.hp) for (const ch of chans) svf(ch, 'hp', p.hp, 0.707);
  const gain = p.gain ?? 1;
  const drive = p.drive ?? 0;
  const amp = c.amp;
  for (const ch of chans) {
    if (drive > 0) {
      const sh = shaper(p.shape ?? 'tanh');
      const pre = 1 + drive;
      for (let i = 0; i < c.n; i++) ch[i] = sh(ch[i] * pre) * amp[i] * gain;
    } else {
      for (let i = 0; i < c.n; i++) ch[i] = ch[i] * amp[i] * gain;
    }
  }
  return stereo ? ([L, R] as Stereo) : (L as Mono);
}

// ---------------------------------------------------------------------------------------------
// Subtractive voice
// ---------------------------------------------------------------------------------------------

/** Plays `notes` as one voice of `p`. Mono unless an oscillator has `spread`. */
export function line(p: Patch, notes: readonly Note[], opts: LineOpts = {}): Buf {
  const sorted = sortNotes(notes);
  const c = controls(sorted, p, opts);
  const { n, blocks, inc } = c;
  const rng = new Rng(seedOf(opts, sorted));
  const stereo = p.osc.some(o => (o.spread ?? 0) > 0 && (o.voices ?? 1) > 1);
  const L = new Float32Array(n);
  const R = stereo ? new Float32Array(n) : L;

  for (const o of p.osc) {
    const voices = Math.max(1, o.voices ?? 1);
    const level = (o.level ?? 1) / Math.sqrt(voices);
    const base = (o.semi ?? 0) + (o.cents ?? 0) / 100;
    for (let u = 0; u < voices; u++) {
      const pos = voices > 1 ? (2 * u) / (voices - 1) - 1 : 0;
      const mult = Math.pow(2, (base + ((o.detune ?? 0) * pos) / 100) / 12);
      let gl = level;
      let gr = 0;
      if (stereo) {
        // Outer voices sit widest, and neighbours alternate sides so the image stays balanced.
        const side = u % 2 === 0 ? -1 : 1;
        const [a, b] = panGains((o.spread ?? 0) * Math.abs(pos) * side * (voices > 1 ? 1 : 0));
        gl = level * a * Math.SQRT2;
        gr = level * b * Math.SQRT2;
      }
      let ph = o.reset ? 0 : rng.next();
      switch (o.wave) {
        case 'saw':
          for (let b = 0, i = 0; b < blocks; b++) {
            const dt = inc[b] * mult;
            const end = i + CR < n ? i + CR : n;
            for (; i < end; i++) {
              ph += dt;
              if (ph >= 1) ph -= 1;
              let v = ph + ph - 1;
              if (ph < dt) {
                const x = ph / dt;
                v -= x + x - x * x - 1;
              } else if (ph > 1 - dt) {
                const x = (ph - 1) / dt;
                v -= x * x + x + x + 1;
              }
              L[i] += v * gl;
              R[i] += v * gr;
            }
          }
          break;
        case 'square':
        case 'pulse': {
          const pw0 = o.wave === 'square' ? 0.5 : (o.pw ?? 0.5);
          const pwm = o.pwm;
          const pwmPhase = rng.next();
          for (let b = 0, i = 0; b < blocks; b++) {
            const dt = inc[b] * mult;
            let pw = pw0;
            if (pwm) pw += pwm.depth * sin1((pwm.rate * b * CR) / SR + pwmPhase);
            pw = pw < 0.05 ? 0.05 : pw > 0.95 ? 0.95 : pw;
            const dc = pw + pw - 1;
            const end = i + CR < n ? i + CR : n;
            for (; i < end; i++) {
              ph += dt;
              if (ph >= 1) ph -= 1;
              let v = ph < pw ? 1 : -1;
              // Rising edge at 0, falling edge at pw.
              if (ph < dt) {
                const x = ph / dt;
                v += x + x - x * x - 1;
              } else if (ph > 1 - dt) {
                const x = (ph - 1) / dt;
                v += x * x + x + x + 1;
              }
              let q = ph - pw;
              if (q < 0) q += 1;
              if (q < dt) {
                const x = q / dt;
                v -= x + x - x * x - 1;
              } else if (q > 1 - dt) {
                const x = (q - 1) / dt;
                v -= x * x + x + x + 1;
              }
              v -= dc;
              L[i] += v * gl;
              R[i] += v * gr;
            }
          }
          break;
        }
        case 'tri':
          for (let b = 0, i = 0; b < blocks; b++) {
            const dt = inc[b] * mult;
            const end = i + CR < n ? i + CR : n;
            for (; i < end; i++) {
              ph += dt;
              if (ph >= 1) ph -= 1;
              const v = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
              L[i] += v * gl;
              R[i] += v * gr;
            }
          }
          break;
        case 'sine':
          for (let b = 0, i = 0; b < blocks; b++) {
            const dt = inc[b] * mult;
            const end = i + CR < n ? i + CR : n;
            for (; i < end; i++) {
              ph += dt;
              if (ph >= 1) ph -= 1;
              const x = ph * SINE_N;
              const j = x | 0;
              const v = SINE[j] + (SINE[j + 1] - SINE[j]) * (x - j);
              L[i] += v * gl;
              R[i] += v * gr;
            }
          }
          break;
        case 'noise':
          for (let i = 0; i < n; i++) {
            const v = rng.next() * 2 - 1;
            L[i] += v * gl;
            R[i] += v * gr;
          }
          break;
      }
    }
  }
  return finish(L, R, stereo, p, c, opts);
}

/** One note. */
export function tone(p: Patch, note: number, dur: number, vel = 1, opts: LineOpts = {}): Buf {
  return line(p, [{ t: 0, dur, note, vel }], { seed: `tone:${note}:${dur.toFixed(4)}`, ...opts });
}

/**
 * Several notes at once, each its own voice. `strum` delays each successive note by that many seconds.
 * Always stereo, so a chord can be dropped straight onto a track.
 */
export function chordOf(p: Patch | FmPatch, notes: readonly number[], dur: number, vel = 1, opts: LineOpts & { strum?: number; velSpread?: number } = {}): Stereo {
  const strum = opts.strum ?? 0;
  const parts = notes.map((note, i) => {
    const v = vel * (1 - (opts.velSpread ?? 0) * ((i * 7) % 3) * 0.5);
    const o = { ...opts, seed: `${opts.seed ?? 'chord'}:${i}:${note}` };
    return 'ops' in p ? fmTone(p, note, dur, v, o) : tone(p, note, dur, v, o);
  });
  let n = 0;
  parts.forEach((b, i) => {
    const len = (Array.isArray(b) ? b[0].length : b.length) + Math.round(i * strum * SR);
    if (len > n) n = len;
  });
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  parts.forEach((b, i) => {
    const at = Math.round(i * strum * SR);
    const l = Array.isArray(b) ? b[0] : b;
    const r = Array.isArray(b) ? b[1] : b;
    for (let k = 0; k < l.length; k++) {
      L[at + k] += l[k];
      R[at + k] += r[k];
    }
  });
  return [L, R];
}

// ---------------------------------------------------------------------------------------------
// FM
// ---------------------------------------------------------------------------------------------

/** One modulator into one carrier. A patch sums several of these. */
export interface FmOp {
  /** Modulator frequency as a multiple of the note. */
  ratio: number;
  /** Carrier frequency as a multiple of the note. 1 by default. */
  carrier?: number;
  /** Modulation depth in radians at the start of the note. */
  index: number;
  /** Seconds for the index to fall to its sustain. Missing means it holds. */
  decay?: number;
  /** Share of `index` that remains after the decay, 0..1. */
  sustain?: number;
  /** Modulator feedback, 0 to about 1.2. Turns the modulator from a sine towards a saw. */
  fb?: number;
  level?: number;
  cents?: number;
  pan?: number;
}

export interface FmPatch {
  ops: FmOp[];
  amp: Env;
  /** How much a soft note lowers the index: 0 not at all, 1 fully. */
  velIndex?: number;
  filter?: Filter;
  hp?: number;
  pitchEnv?: { semi: number; time: number };
  vibrato?: { rate: number; cents: number; delay?: number };
  glide?: number;
  glideAll?: boolean;
  drive?: number;
  shape?: ShapeName;
  gain?: number;
  velAmp?: number;
  accent?: number;
}

export function fmLine(p: FmPatch, notes: readonly Note[], opts: LineOpts = {}): Buf {
  const sorted = sortNotes(notes);
  const c = controls(sorted, p, opts);
  const { n, blocks, inc, age, vel } = c;
  const stereo = p.ops.some(o => (o.pan ?? 0) !== 0);
  const L = new Float32Array(n);
  const R = stereo ? new Float32Array(n) : L;
  const velIndex = p.velIndex ?? 0.5;
  const TWO_PI_INV = 1 / (Math.PI * 2);
  for (const o of p.ops) {
    const mult = Math.pow(2, (o.cents ?? 0) / 1200);
    const level = o.level ?? 1;
    let gl = level;
    let gr = 0;
    if (stereo) {
      const [a, b] = panGains(o.pan ?? 0);
      gl = level * a * Math.SQRT2;
      gr = level * b * Math.SQRT2;
    }
    const sus = o.sustain ?? (o.decay ? 0 : 1);
    const fb = (o.fb ?? 0) * TWO_PI_INV;
    const carrier = o.carrier ?? 1;
    let pm = 0;
    let pc = 0;
    let prev = 0;
    for (let b = 0, i = 0; b < blocks; b++) {
      const f = inc[b] * mult;
      const dm = f * o.ratio;
      const dc = f * carrier;
      const shapeNow = o.decay ? sus + (1 - sus) * Math.exp((-4.6 * age[b]) / o.decay) : 1;
      // Past half the sample rate a modulator only adds noise, so it fades out there.
      const guard = dm > 0.45 ? 0 : dm > 0.3 ? (0.45 - dm) / 0.15 : 1;
      const idx = o.index * shapeNow * (1 - velIndex * (1 - vel[b])) * guard * TWO_PI_INV;
      const end = i + CR < n ? i + CR : n;
      for (; i < end; i++) {
        pm += dm;
        if (pm >= 1) pm -= 1;
        let x = pm + fb * prev;
        x = (x - Math.floor(x)) * SINE_N;
        let j = x | 0;
        const m = SINE[j] + (SINE[j + 1] - SINE[j]) * (x - j);
        prev = m;
        pc += dc;
        if (pc >= 1) pc -= 1;
        x = pc + idx * m;
        x = (x - Math.floor(x)) * SINE_N;
        j = x | 0;
        const v = SINE[j] + (SINE[j + 1] - SINE[j]) * (x - j);
        L[i] += v * gl;
        R[i] += v * gr;
      }
    }
  }
  return finish(L, R, stereo, p, c, opts);
}

export function fmTone(p: FmPatch, note: number, dur: number, vel = 1, opts: LineOpts = {}): Buf {
  return fmLine(p, [{ t: 0, dur, note, vel }], opts);
}
