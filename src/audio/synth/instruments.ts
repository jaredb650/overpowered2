/**
 * Reusable sound models. Recipes combine these, so a family of sounds (every gun, every voice)
 * shares one physical idea and differs by parameters.
 */
import { perc, swell, type Chain, type Curve, type Point, type Synth } from './dsl';

// ---------------------------------------------------------------------------------------------
// Struck objects
// ---------------------------------------------------------------------------------------------

/** Inharmonic partial ratios measured from real objects. They are what makes metal read as metal. */
export const MODES = {
  plate: [1, 1.58, 2.24, 2.92, 3.71, 4.89, 6.2, 7.6],
  bar: [1, 2.76, 5.4, 8.93, 13.34],
  bell: [1, 2, 2.4, 3, 4.01, 5.33, 6.67],
  pipe: [1, 2.01, 3.03, 4.1, 5.2],
  glass: [1, 2.32, 4.25, 6.63, 9.38],
  barrel: [1, 1.41, 1.73, 2.45, 3.16],
} as const;

export interface ModalSpec {
  f0: number;
  modes?: readonly number[];
  decay: number;
  level?: number;
  /** How fast upper partials die compared to the fundamental. Lower is duller. */
  damping?: number;
  /** Level of the contact noise. */
  strike?: number;
  /** Random spread of partials, so variants differ. */
  spread?: number;
}

/** Modal synthesis: a contact click exciting a bank of decaying sine partials. */
export function modal(s: Synth, spec: ModalSpec): void {
  const modes = spec.modes ?? MODES.plate;
  const level = spec.level ?? 1;
  const damping = spec.damping ?? 0.72;
  const spread = spec.spread ?? 0.012;
  modes.forEach((ratio, i) => {
    const amp = level * Math.pow(0.68, i) * s.r(0.7, 1);
    const decay = Math.max(0.01, spec.decay * Math.pow(damping, i));
    const f = spec.f0 * ratio * (1 + s.r(-spread, spread));
    // A partial pinned at Nyquist is inaudible but still counts toward the peak the sound normalizes to.
    if (f < s.sr * 0.47) s.osc('sine', f, decay * 1.3).env(perc(decay, amp, 0.0004)).out();
  });
  const strike = spec.strike ?? 0.5;
  if (strike > 0) s.noise('white', 0.02).hp(spec.f0).env(perc(0.006, strike * level)).out();
}

/** A hard mechanical click with a little body ring, for foley. */
export function click(s: Synth, freq: number, level = 1, decay = 0.012): void {
  s.noise('white', decay * 4).bp(freq, 1.2).env(perc(decay, level)).drive(2).out();
  s.osc('triangle', freq * s.r(0.45, 0.55), decay * 5).env(perc(decay * 2.5, level * 0.5)).out();
}

/** A heavier metal-on-metal contact. */
export function clank(s: Synth, f0: number, level = 1, decay = 0.09): void {
  modal(s, { f0, modes: MODES.plate, decay, level: level * 0.7, strike: 0.9, damping: 0.65 });
  s.osc('sine', [[0, f0 * 0.4], [0.05, f0 * 0.22]], 0.1).env(perc(0.05, level * 0.5)).out();
}

/** A low body thump with a fast pitch drop. */
export function thump(s: Synth, f: number, decay: number, level = 1, drop = 2.4): void {
  s.osc('sine', [[0, f * drop], [Math.min(0.03, decay * 0.3), f], [decay, f * 0.7]], decay * 1.3)
    .env(perc(decay, level, 0.001)).drive(1.6).out();
}

// ---------------------------------------------------------------------------------------------
// Firearms and explosions
// ---------------------------------------------------------------------------------------------

export interface GunSpec {
  /** Supersonic crack. */
  crack?: number;
  crackHp?: number;
  /** Muzzle blast centre frequency and length. */
  body: number;
  bodyDecay: number;
  bodyLevel?: number;
  /** Low-frequency pressure hit. */
  sub?: number;
  subFreq?: number;
  subDecay?: number;
  /** Space around the shot. */
  tail?: number;
  tailDecay?: number;
  drive?: number;
  /** Action or receiver ring. */
  ring?: number;
  ringFreq?: number;
}

/** Crack, body, pressure, tail: the four time constants of a shot. */
export function gunshot(s: Synth, g: GunSpec): void {
  const drive = g.drive ?? 3;
  const crack = g.crack ?? 1;
  if (crack > 0) {
    s.noise('white', 0.05).hp(g.crackHp ?? 2200).env(perc(0.007, 1, 0.0002)).drive(drive).out(crack * 0.9);
  }
  const bd = g.bodyDecay;
  s.noise('pink', bd * 1.5).bp([[0, g.body * 2.4], [Math.min(0.05, bd * 0.5), g.body], [bd, g.body * 0.6]], 0.6)
    .env(perc(bd, 1, 0.0004)).drive(drive * 1.3).out(g.bodyLevel ?? 0.9);
  if ((g.sub ?? 0) > 0) {
    const f = g.subFreq ?? 80;
    const d = g.subDecay ?? 0.14;
    thump(s, f, d, g.sub!, 3);
  }
  if ((g.ring ?? 0) > 0) {
    modal(s, { f0: g.ringFreq ?? 2600, decay: 0.05, level: g.ring!, strike: 0, modes: MODES.plate, damping: 0.6 });
  }
  if ((g.tail ?? 0) > 0) {
    const d = g.tailDecay ?? 0.6;
    s.noise('pink', d * 1.4).lp([[0, 3200], [d, 500]]).env(perc(d, g.tail!, 0.012)).out();
  }
}

export interface BlastSpec {
  /** Scales every time constant. 1 is a rocket. */
  size?: number;
  crack?: number;
  fireball?: number;
  sub?: number;
  crackle?: number;
  tail?: number;
  /** Top of the fireball sweep, Hz. */
  bright?: number;
}

/** Explosion: pressure crack, sweeping fireball, sub drop, crackling debris, rolling tail. */
export function blast(s: Synth, b: BlastSpec = {}): void {
  const d = b.size ?? 1;
  const bright = b.bright ?? 7000;
  const crack = b.crack ?? 1;
  const fire = b.fireball ?? 1;
  const sub = b.sub ?? 1;

  s.noise('white', 0.08 * d).hp(1400).env(perc(0.022 * d, 1, 0.0002)).drive(6, 'hard').out(crack * 0.8);

  const ball = s.sum();
  s.noise('brown', d * 1.4).gain(1.6).to(ball);
  s.noise('pink', d * 1.2).gain(0.8).to(ball);
  ball.lp([[0, bright], [0.09 * d, bright * 0.3], [0.5 * d, 700], [1.1 * d, 160]], 0.8)
    .env(perc(1.0 * d, 1, 0.0006)).drive(5).out(fire * 0.9);

  s.osc('sine', [[0, 150], [0.05 * d, 62], [1.25 * d, 24]], 1.5 * d).env(perc(1.2 * d, 1, 0.001)).drive(2.4).out(sub);
  s.osc('triangle', [[0, 90], [0.8 * d, 30]], d).env(perc(0.7 * d, 0.5, 0.001)).out(sub * 0.7);

  const crackle = b.crackle ?? 0.5;
  if (crackle > 0) {
    s.grains(1.6 * d, t => 180 * Math.exp(-t / (0.5 * d)) + 8, 0.002, t => Math.exp(-t / (0.7 * d)))
      .bp(2100, 1.1).drive(2).out(crackle * 1.5);
  }

  const tail = b.tail ?? 0.5;
  if (tail > 0) {
    s.noise('brown', 2.6 * d).lp([[0, 700], [2.4 * d, 110]]).am(s.wander(5, 0.5))
      .env(swell(0.1 * d, 2.5 * d, 2 * d, 1)).gain(1.8).out(tail);
  }
}

// ---------------------------------------------------------------------------------------------
// Air and motion
// ---------------------------------------------------------------------------------------------

export interface WhooshSpec {
  from: number;
  to: number;
  dur: number;
  q?: number;
  level?: number;
  peakAt?: number;
  color?: 'white' | 'pink';
}

/** A resonant band of noise moving through air. Peak position sets how close the pass feels. */
export function whoosh(s: Synth, w: WhooshSpec): void {
  const peakAt = (w.peakAt ?? 0.35) * w.dur;
  s.noise(w.color ?? 'pink', w.dur).bp([[0, w.from], [w.dur, w.to]], w.q ?? 1.4)
    .env([[0, 0.0001], [peakAt, 1], [w.dur, 0.0001]]).out(w.level ?? 1);
}

/** A rich continuous wind that gusts. */
export function wind(s: Synth, f: number, q: number, level = 1): void {
  s.noise('pink').bp(f, q).sweep(s.wander(0.8, f * 0.4)).am(s.wander(1.2, 0.35)).out(level);
}

// ---------------------------------------------------------------------------------------------
// Electricity and energy
// ---------------------------------------------------------------------------------------------

/** One electric discharge: dense gated crackle, buzz and a hot high band. */
export function zap(s: Synth, len: number, level = 1, freq = 120): void {
  const arcs = s.sum();
  s.grains(len, t => 2600 * (0.4 + 0.6 * Math.abs(Math.sin(t * 90 + s.variant))), 0.0012, t => Math.exp(-t / (len * 0.5)) * (1 - t / len))
    .hp(1500).gain(1.8).to(arcs);
  s.osc('sawtooth', freq * s.r(0.9, 1.1), len).detune(s.wander(40, 180))
    .env(perc(len * 0.7, 0.7)).to(arcs);
  // Folding throws energy far up the spectrum. Rolling it off keeps the arc hot rather than hissing.
  arcs.drive(5, 'fold', 0.7).hp(240).lp(8200, 0.6).out(level);
}

/** Bright descending laser chirp. */
export function laser(s: Synth, from: number, to: number, len: number, level = 1): void {
  s.fm([[0, from], [len, to]], 1.5, [[0, from * 1.2], [len, 20]], len).env(perc(len * 0.9, 1, 0.0005)).out(level);
  s.osc('square', [[0, from * 0.5], [len, to * 0.5]], len).lp(4000).env(perc(len * 0.6, 0.28)).out(level);
}

// ---------------------------------------------------------------------------------------------
// Wet things
// ---------------------------------------------------------------------------------------------

/** A rising sine chirp with a fast decay. That is the physics of an air bubble in liquid. */
export function bubble(s: Synth, f: number, len: number, level = 1): void {
  s.osc('sine', [[0, f], [len, f * s.r(1.5, 2.3)]], len * 1.2).env(perc(len, level, 0.0015)).out();
}

/** A burst of many bubbles and droplets. */
export function wetBurst(s: Synth, count: number, spanSeconds: number, f = 500, level = 1): void {
  for (let i = 0; i < count; i++) {
    const t = Math.pow(s.r(), 1.8) * spanSeconds;
    s.at(t, () => bubble(s, f * s.r(0.5, 2.2), s.r(0.012, 0.05), level * s.r(0.25, 0.9) * (1 - t / (spanSeconds * 1.4))));
  }
}

/** Flat slap of skin or a soaked mass. */
export function slap(s: Synth, level = 1, f = 1100): void {
  s.noise('pink', 0.08).bp([[0, f * 1.8], [0.05, f * 0.7]], 1).env(perc(0.03, 1)).drive(2.5).out(level);
  s.osc('sine', [[0, 220], [0.05, 90]], 0.09).env(perc(0.05, 0.7)).out(level);
}

/** Small dry snaps, for bone and ice. */
export function snap(s: Synth, count: number, span: number, level = 1, f = 2200): void {
  // The first snap is the loudest and lands at once. Later ones scatter behind it.
  for (let i = 0; i < count; i++) {
    const t = i === 0 ? 0 : s.r(0, span) * (i / count);
    const amp = i === 0 ? level : level * s.r(0.35, 0.8);
    s.at(t, () => {
      s.noise('white', 0.02).bp(f * s.r(0.6, 1.8), 2.2).env(perc(s.r(0.003, 0.009), amp)).drive(3).out();
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------------------------

const VOWELS = {
  a: [730, 1090, 2440, 3400, 4300],
  ae: [660, 1720, 2410, 3400, 4300],
  e: [530, 1840, 2480, 3400, 4300],
  i: [270, 2290, 3010, 3400, 4300],
  o: [570, 840, 2410, 3400, 4300],
  u: [300, 870, 2240, 3400, 4300],
  uh: [640, 1190, 2390, 3400, 4300],
  er: [490, 1350, 1690, 3200, 4300],
} as const;
export type Vowel = keyof typeof VOWELS;

const FORMANT_LEVEL = [1, 0.62, 0.38, 0.22, 0.12];
const FORMANT_Q = [7, 9, 11, 13, 14];

export interface VoxSpec {
  /** Glottal pitch in Hz. */
  f0: Curve;
  /** Vowels at times, morphed between. */
  vowels: readonly (readonly [t: number, v: Vowel])[];
  /** Loudness envelope. */
  amp: Curve;
  /** Vocal tract scale. Below 1 is a bigger creature. */
  tract?: number;
  /** Amplitude flutter at growl rates. */
  rough?: number;
  breath?: number;
  /** Octave-down subharmonic, for growls. */
  sub?: number;
  drive?: number;
  /** Random pitch movement in cents. */
  jitter?: number;
  vibrato?: number;
  /** Mix into this chain instead of straight to the output. */
  into?: Chain;
}

/**
 * Source-filter speech: a rough glottal buzz through five parallel formant resonators.
 * Screams are the same model pushed: high pitch, wide flutter, driven hard.
 */
export function vox(s: Synth, v: VoxSpec): void {
  const tract = v.tract ?? 1;
  const glottis = s.sum();

  const buzz = s.osc('sawtooth', v.f0).detune(s.wander(16, v.jitter ?? 30));
  if (v.vibrato) buzz.detune(s.lfo(5.5, v.vibrato));
  buzz.lp(3800, 0.5).to(glottis);

  if ((v.sub ?? 0) > 0) {
    const half = typeof v.f0 === 'number' ? v.f0 / 2 : v.f0.map(([t, f]) => [t, f / 2] as const);
    s.osc('square', half).detune(s.wander(9, 24)).lp(1500).gain(v.sub!).to(glottis);
  }
  if ((v.breath ?? 0) > 0) s.noise('pink').hp(500).gain(v.breath! * 1.5).to(glottis);

  let source: Chain = glottis;
  if ((v.rough ?? 0) > 0) source = glottis.am(s.wander(70, v.rough!), 1);

  const tractOut = s.sum();
  for (let i = 0; i < 5; i++) {
    const curve: Point[] = v.vowels.map(([t, name]) => [t, VOWELS[name][i]! * tract] as const);
    source.fork().bp(curve.length === 1 ? curve[0]![1] : curve, FORMANT_Q[i]!).gain(FORMANT_LEVEL[i]! * 3).to(tractOut);
  }
  tractOut.env(v.amp);
  if (v.drive) tractOut.drive(v.drive);
  if (v.into) tractOut.to(v.into);
  else tractOut.out(1);
}

/** Radio band limiting, clipped the way a cheap handset clips. */
export function radioize(c: Chain): Chain {
  return c.hp(420, 1).lp(2900, 1).drive(5, 'hard', 0.6);
}

// ---------------------------------------------------------------------------------------------
// Music-like stingers
// ---------------------------------------------------------------------------------------------

/** MIDI note to Hz. */
export const hz = (note: number) => 440 * Math.pow(2, (note - 69) / 12);

/** FM bell. Clean and glassy with a long tail. */
export function bell(s: Synth, f: number, decay: number, level = 1, pan = 0): void {
  s.fm(f, 3.5, [[0, f * 2.2], [decay * 0.6, f * 0.1]], decay * 1.2).env(perc(decay, level, 0.001)).out(1, pan);
  s.osc('sine', f * 2, decay * 0.6).env(perc(decay * 0.4, level * 0.25)).out(1, pan);
}

/** Thick detuned sawtooth chord with an opening filter. */
export function brass(s: Synth, notes: readonly number[], len: number, level = 1, cutoff = 2800): void {
  for (const n of notes) {
    for (const cents of [-11, 0, 9]) {
      s.osc('sawtooth', hz(n), len + 0.1, cents)
        .lp([[0, 500], [0.04, cutoff], [len, 400]], 1.2)
        .env([[0, 0.0001], [0.012, 1], [len * 0.4, 0.6], [len, 0.0001]])
        .out((level * 0.6) / notes.length, cents === 0 ? 0 : cents > 0 ? 0.45 : -0.45);
    }
  }
}

/** A rising noise and tone that lands on `len`, for anticipation. */
export function riser(s: Synth, len: number, level = 1, from = 200, to = 5000): void {
  s.noise('pink', len).bp([[0, from], [len, to]], 2.4).env([[0, 0.0001], [len * 0.9, 1], [len, 0.0001]]).out(level * 1.4);
  s.osc('sawtooth', [[0, from * 0.5], [len, to * 0.25]], len).lp(3000).env([[0, 0.0001], [len, 0.35]]).out(level * 0.5);
}

/** Cinematic impact: sub drop, noise whack and a rising ring. */
export function boom(s: Synth, decay: number, level = 1): void {
  s.osc('sine', [[0, 110], [0.06, 50], [decay, 28]], decay * 1.2).env(perc(decay, level, 0.001)).drive(2.2).out();
  s.noise('pink', 0.4).lp([[0, 5000], [0.3, 200]]).env(perc(0.22, level * 0.9, 0.0005)).drive(3).out();
}

/** Three stepped sine notes, the first game's pickup figure. */
export function steps(s: Synth, freqs: readonly number[], stepSeconds: number, decay: number, level = 1, type: OscillatorType = 'sine'): void {
  freqs.forEach((f, i) => {
    s.at(i * stepSeconds, () => s.osc(type, f, decay * 1.2).env(perc(decay, level)).out());
  });
}
