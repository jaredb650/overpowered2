// Clerical Violence. Menu music: atmospheric jungle leaning towards breakcore, 184 BPM, A minor.
//
//   nice npx tsx tools/music/render.ts clerical-violence
//
// Form (bars from 0): intro 0-16, drop one 16-48 (stab riff, then the tune over it), breakdown 48-64,
// drop two 64-112 (64-80 the fast edits, 80-96 the lift to F G Am, 96-112 everything), outro 112-144.
// Harmony: Am9, Fmaj9, Dm9, Em7 two bars each. Bars 80-96 swap to Fmaj9, G6, Am9, Am9 for the lift.
import {
  Song, midi, line, fmLine, chordOf, kick, snare, hat, crash, noiseSweep, impact, subDrop, reversed, repitch,
  breakKit, breakLoop, chop, parseChop, hits,
  reverb, delay, chorus, drive, compress, eq, filt, widen,
  type Patch, type FmPatch, type Note, type ChopStep, type BreakLoop, type Rng,
} from '../engine';

// ---------------------------------------------------------------------------------------------
// Sounds
// ---------------------------------------------------------------------------------------------

const SUB: Patch = { osc: [{ wave: 'sine', reset: true }], amp: { a: 0.005, d: 1.1, s: 0.55, r: 0.1 }, pitchEnv: { semi: 4, time: 0.018 }, drive: 1, glide: 0.07, gain: 0.5 };
const REESE: Patch = {
  osc: [{ wave: 'saw', cents: -17 }, { wave: 'saw', cents: 17 }, { wave: 'saw', semi: 12, cents: 6, level: 0.35 }],
  amp: { a: 0.006, d: 0.4, s: 0.8, r: 0.1 },
  filter: { type: 'lp', cutoff: 480, q: 1.3, env: 0.9, shape: { a: 0.005, d: 0.3, s: 0.3, r: 0.1 }, lfo: { rate: 0.23, depth: 0.8 } },
  hp: 105, drive: 1.5, glide: 0.07, gain: 0.26,
};
const STAB: Patch = {
  osc: [{ wave: 'saw', voices: 3, detune: 21, spread: 0.85 }, { wave: 'square', semi: 12, level: 0.3 }],
  amp: { a: 0.002, d: 0.24, s: 0, r: 0.14 },
  filter: { type: 'lp', cutoff: 1100, q: 1.2, env: 2.4, shape: { a: 0.002, d: 0.17, s: 0.08, r: 0.12 } },
  pitchEnv: { semi: 0.5, time: 0.03 }, hp: 220, drive: 0.7, gain: 0.2,
};
const HOOVER: Patch = {
  osc: [
    { wave: 'pulse', pw: 0.32, pwm: { rate: 4.6, depth: 0.2 }, voices: 3, detune: 28, spread: 0.9 },
    { wave: 'saw', semi: -12, voices: 2, detune: 18, spread: 0.6, level: 0.8 },
    { wave: 'saw', semi: 12, level: 0.35 },
  ],
  amp: { a: 0.02, d: 0.4, s: 0.8, r: 0.3 },
  filter: { type: 'lp', cutoff: 2600, q: 0.9, key: 0.3 },
  pitchEnv: { semi: -7, time: 0.075 }, hp: 180, glide: 0.09, gain: 0.2,
};
const LEAD: Patch = {
  osc: [{ wave: 'saw', voices: 5, detune: 13, spread: 0.8 }, { wave: 'square', semi: 12, level: 0.22 }],
  amp: { a: 0.004, d: 0.4, s: 0.5, r: 0.22 },
  filter: { type: 'lp', cutoff: 1700, q: 0.9, env: 2.1, shape: { a: 0.003, d: 0.28, s: 0.3, r: 0.2 }, key: 0.35 },
  hp: 260, vibrato: { rate: 5.6, cents: 8, delay: 0.25 }, glide: 0.04, gain: 0.24,
};
const PAD: Patch = {
  osc: [{ wave: 'saw', voices: 7, detune: 19, spread: 0.95 }, { wave: 'pulse', pw: 0.4, pwm: { rate: 0.3, depth: 0.15 }, semi: 12, level: 0.2 }],
  amp: { a: 0.5, d: 1.5, s: 0.85, r: 1.3 },
  filter: { type: 'lp', cutoff: 3600, q: 0.6, key: 0.3, lfo: { rate: 0.09, depth: 0.3 } },
  hp: 260, gain: 0.16,
};
const PIANO: FmPatch = {
  ops: [
    { ratio: 1, index: 1.5, decay: 0.5, sustain: 0.18, pan: -0.4, cents: -3 },
    { ratio: 2, index: 0.9, decay: 0.35, sustain: 0.1, pan: 0.4, cents: 3, level: 0.7 },
    { ratio: 11, index: 0.5, decay: 0.05, level: 0.25 },
  ],
  amp: { a: 0.002, d: 1.5, s: 0.15, r: 0.4 }, velIndex: 0.7, hp: 180, gain: 0.2,
};
const ACID: Patch = {
  osc: [{ wave: 'saw', reset: true }],
  amp: { a: 0.002, d: 0.2, s: 0.55, r: 0.04 },
  filter: { type: 'ladder', cutoff: 320, q: 0.8, env: 3, shape: { a: 0.002, d: 0.14, s: 0, r: 0.1 }, drive: 1.8 },
  hp: 200, glide: 0.045, accent: 0.6, gain: 0.3,
};

// ---------------------------------------------------------------------------------------------
// Harmony and melody
// ---------------------------------------------------------------------------------------------

interface Chord { bass: string; pad: string[]; stab: string[] }
const AM: Chord = { bass: 'A1', pad: ['A3', 'C4', 'E4', 'G4', 'B4'], stab: ['A3', 'C4', 'E4', 'A4'] };
const FMAJ: Chord = { bass: 'F1', pad: ['F3', 'A3', 'C4', 'E4', 'G4'], stab: ['A3', 'C4', 'F4', 'A4'] };
const DM: Chord = { bass: 'D2', pad: ['D3', 'A3', 'C4', 'E4', 'F4'], stab: ['A3', 'D4', 'F4', 'A4'] };
const EM: Chord = { bass: 'E2', pad: ['E3', 'G3', 'B3', 'D4', 'G4'], stab: ['G3', 'B3', 'E4', 'G4'] };
const G6: Chord = { bass: 'G1', pad: ['G3', 'B3', 'D4', 'E4', 'A4'], stab: ['G3', 'B3', 'D4', 'G4'] };
const MAIN = [AM, FMAJ, DM, EM];
const LIFT = [FMAJ, G6, AM, AM];

/** `[beat within the phrase, length in beats, note]`. Each phrase is eight bars. */
type Tune = [number, number, string][];
const TUNE_A: Tune = [
  [0, 1.5, 'E5'], [1.5, 0.5, 'D5'], [2, 1, 'E5'], [3, 1, 'G5'], [4, 2, 'A5'], [6, 1, 'G5'], [7, 1, 'E5'],
  [8, 1.5, 'F5'], [9.5, 0.5, 'E5'], [10, 1, 'F5'], [11, 1, 'A5'], [12, 2, 'C6'], [14, 1, 'A5'], [15, 1, 'G5'],
  [16, 1.5, 'A5'], [17.5, 0.5, 'G5'], [18, 1, 'F5'], [19, 1, 'D5'], [20, 2, 'F5'], [22, 1, 'E5'], [23, 1, 'D5'],
  [24, 1.5, 'E5'], [25.5, 0.5, 'D5'], [26, 1, 'B4'], [27, 1, 'D5'], [28, 3, 'E5'], [31, 0.5, 'G5'], [31.5, 0.5, 'A5'],
];
const TUNE_B: Tune = [
  [0, 1.5, 'A5'], [1.5, 0.5, 'G5'], [2, 1, 'A5'], [3, 1, 'C6'], [4, 2, 'B5'], [6, 1, 'A5'], [7, 1, 'G5'],
  [8, 1.5, 'A5'], [9.5, 0.5, 'G5'], [10, 1, 'F5'], [11, 1, 'A5'], [12, 2, 'G5'], [14, 1, 'E5'], [15, 1, 'C5'],
  [16, 1.5, 'D5'], [17.5, 0.5, 'E5'], [18, 1, 'F5'], [19, 1, 'A5'], [20, 2, 'G5'], [22, 1, 'F5'], [23, 1, 'E5'],
  [24, 1.5, 'E5'], [25.5, 0.5, 'G5'], [26, 1, 'B5'], [27, 1, 'G5'], [28, 4, 'A5'],
];
/** Over F, G, Am, Am. */
const TUNE_LIFT: Tune = [
  [0, 1.5, 'C6'], [1.5, 0.5, 'A5'], [2, 1, 'C6'], [3, 1, 'D6'], [4, 2, 'C6'], [6, 1, 'A5'], [7, 1, 'F5'],
  [8, 1.5, 'B5'], [9.5, 0.5, 'G5'], [10, 1, 'B5'], [11, 1, 'D6'], [12, 2, 'B5'], [14, 1, 'G5'], [15, 1, 'D5'],
  [16, 1.5, 'E5'], [17.5, 0.5, 'G5'], [18, 1, 'A5'], [19, 1, 'C6'], [20, 2, 'B5'], [22, 1, 'A5'], [23, 1, 'G5'],
  [24, 1.5, 'A5'], [25.5, 0.5, 'G5'], [26, 1, 'E5'], [27, 1, 'G5'], [28, 4, 'A5'],
];
/** Slow, for the breakdown. */
const TUNE_SLOW: Tune = [
  [0, 3, 'E5'], [3, 1, 'G5'], [4, 4, 'A5'], [8, 3, 'F5'], [11, 1, 'A5'], [12, 4, 'C6'],
  [16, 3, 'A5'], [19, 1, 'F5'], [20, 4, 'D5'], [24, 3, 'E5'], [27, 1, 'B4'], [28, 4, 'E5'],
];

/** The stab riff: `[sixteenth of the two bars, which chord of the three on offer]`. 0 is the chord itself. */
const RIFF: [number, number][] = [[0, 0], [3, 0], [6, 1], [10, 0], [12, 2], [16, 0], [19, 0], [22, 1], [24, 2], [27, 1], [30, 0]];
const RIFF_BUSY: [number, number][] = [[0, 0], [2, 0], [3, 0], [6, 1], [8, 1], [10, 0], [12, 2], [14, 2], [16, 0], [19, 0], [22, 1], [24, 2], [26, 2], [27, 1], [29, 1], [30, 0]];

export default function build(): Song {
  const song = new Song({
    title: 'Clerical Violence', slug: 'clerical-violence', list: 'menu', bpm: 184, bars: 144, key: 'A minor', tail: 2.5,
    master: { target: -8.0, ceiling: -1.4, clipKnee: 3, width: 1.1, eq: [{ type: 'peak', freq: 250, q: 0.9, gain: -1 }, { type: 'highshelf', freq: 10000, gain: 1.5 }, { type: 'peak', freq: 3000, q: 0.8, gain: -1 }] },
  });
  const { s, bar } = song;
  song.section('intro', 0, 16);
  song.section('drop 1', 16, 48);
  song.section('breakdown', 48, 64);
  song.section('edits', 64, 80);
  song.section('lift', 80, 96);
  song.section('all in', 96, 112);
  song.section('outro', 112, 144);

  const hall = song.bus('hall', b => reverb(b, { decay: 3.6, size: 1.7, damp: 6000, predelay: 0.03, hp: 280 }), -2);
  const plate = song.bus('plate', b => reverb(b, { decay: 1.1, size: 0.9, damp: 7500, predelay: 0.008, hp: 350 }), -5);
  const echo = song.bus('echo', b => delay(b, { time: s(0.75), feedback: 0.45, lp: 3800, hp: 450, pingpong: true }), -6);

  const lifted = (b: number): boolean => b >= 80 && b < 96;
  const chordAt = (b: number): Chord => (lifted(b) ? LIFT : MAIN)[Math.floor(b / 2) % 4];
  const drop = (b: number): boolean => (b >= 16 && b < 48) || (b >= 64 && b < 112);
  /** Half a bar of near silence before each drop. */
  const gap = song.vol(song.lane([
    [bar(15.5) - 0.05, 1], [bar(15.5), 0.15], [bar(16) - 0.06, 0.15], [bar(16), 1],
    [bar(63.5) - 0.05, 1], [bar(63.5), 0.1], [bar(64) - 0.06, 0.1], [bar(64), 1],
  ]));

  // -------------------------------------------------------------------------------------------
  // Breaks
  // -------------------------------------------------------------------------------------------

  // The main loop: a busy two bars with the second backbeat of bar two arriving late. Slices are sixteenths.
  const ragga = breakLoop(breakKit({ seed: 51, hatDecay: 0.045, snare: { tone: 188, tone2: 345, noiseDecay: 0.17, snap: 0.6 } }), {
    bpm: 136, seed: 7, swing: 0.14, room: 0.3, roomDecay: 0.5, drive: 8, squash: 0.8, crush: { bits: 12, rate: 30000 },
    kick: 'x.x.......xx....|x.x.......x.....', snare: '....X.......X...|....X.........X.', ghost: '.......o.o.....o|.......o.o..o...',
    ride: 'x.x.x.x.x.x.x.x.', hat: '..o...o...o...o.',
  });
  // A second, lighter loop of sixteenth hats and an open snare, for under the first and for the quiet parts.
  const tamb = breakLoop(breakKit({ seed: 77, hatDecay: 0.03, hatMetal: 0.5 }), {
    bpm: 136, seed: 9, swing: 0.16, room: 0.22, drive: 5, squash: 0.6,
    kick: 'x.........x.....|x......x..x.....', snare: '....x.......x...|....x.......x..o', ghost: '..o....o.o....o.',
    hat: 'xoxoxoxoxoxoxoxo', open: '......x.......x.',
  });
  const S16 = { bpm: song.bpm, step: 0.25 };
  /** Two-bar patterns, one token a sixteenth. Kicks are slices 0, 2, 10, 11, 16, 18, 26. Snares are 4, 12, 20, 30. */
  const P = {
    straight: '0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 | 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31',
    answer: '0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 | 16 17 18 19 20 21 22 23 10 11 4 5 28 29 30 31',
    shove: '0 1 2 3 4 5 2 3 4 5 10 11 12 13 14 15 | 16 17 18 19 20 21 10 11 12 13 26 27 30 31 30 30x2',
    stutter: '0 1 0 1 4 5 6 7 10 11 10 11 12 13 12x2 12x2 | 16 17 18 19 20 21 22 23 24 25 26 27 30 31 4x2 4x3',
    roll: '0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 | 16 17 18 19 20 21 20 21 12 12 12x2 12x2 12x2 12x3 12x4u5 12x4u9',
    tumble: '0 1 2 3 4 5 6 7 10 11 4 5 12 13 14 15 | 16 17 18 19 30 31 22 23 0 1 2 3 4x2 4x2 30x2 30x4d7',
    back: '0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 | 16 17 18 19 20 21 22 23 24 25 26 27 12r _ 4r _',
  };
  type PatName = keyof typeof P;
  /** Edits a pattern at random: retriggers, a swapped-in snare, a reversed slice. `amount` is the chance per token. */
  const mutate = (pattern: string, rng: Rng, amount: number): ChopStep[] => {
    const steps = parseChop(pattern);
    return steps.map((st, i) => {
      if (st.slice === null || st.len !== 1 || st.retrig || !rng.chance(amount)) return st;
      const pos = i % 16;
      const roll = rng.next();
      // Backbeats keep their place: only the notes around them are played with.
      if (pos === 4 || pos === 12) return roll < 0.25 ? { ...st, retrig: 2 } : st;
      if (roll < 0.35) return { ...st, retrig: 2 };
      if (roll < 0.5) return { ...st, retrig: 3 };
      if (roll < 0.6) return { ...st, retrig: 4, ramp: rng.chance(0.5) ? 7 : -5 };
      if (roll < 0.75) return { ...st, slice: rng.pick([4, 12, 20, 30]), gain: 0.7 };
      if (roll < 0.87) return { ...st, reverse: true };
      return { ...st, pitch: rng.pick([-12, -5, 7]) };
    });
  };

  const drums = song.track('drums', { gain: -1 }).fx(b => {
    compress(b, { threshold: -13, ratio: 3, attack: 0.01, release: 0.1, knee: 6, makeup: 3, mix: 0.65 });
    drive(b, { amount: 3.5, shape: 'soft', out: -1.2 });
  });
  const brkHp = song.lane([[bar(0), 1400], [bar(8), 700, 'exp'], [bar(15), 180, 'exp'], [bar(16), 120], [bar(48), 120], [bar(48.01), 900], [bar(60), 500, 'exp'], [bar(64), 120], [bar(120), 120], [bar(128), 500, 'exp'], [bar(144), 1600, 'exp']]);
  const brkVol = song.lane([[bar(0), 0.3], [bar(8), 0.5], [bar(16), 0.85], [bar(16.01), 1], [bar(48), 1], [bar(48.01), 0.4], [bar(60), 0.55], [bar(64), 0.9], [bar(64.01), 1], [bar(120), 1], [bar(128), 0.5], [bar(142), 0.12]]);
  const brk = song.track('break', { out: drums, gain: -2 }).send(plate, -14)
    .fx(song.filter('hp', brkHp, 0.8), b => {
      eq(b, [{ type: 'peak', freq: 3400, q: 0.8, gain: 2 }, { type: 'highshelf', freq: 9000, gain: -1 }]);
    }, song.vol(brkVol), gap);
  const top = song.track('break top', { out: drums, gain: -11 }).send(plate, -12)
    .fx(b => {
      filt(b, 'hp', 2200, 0.707, 4);
    }, song.vol(song.lane([[bar(4), 0.5], [bar(16), 1], [bar(48), 1], [bar(48.01), 0.7], [bar(64), 1], [bar(128), 1], [bar(144), 0.3]])), gap);

  /** Which pattern each pair of bars plays, by its place in the eight. */
  const plan = (b: number): { name: PatName; edit: number } => {
    const pos = (b % 8) / 2;
    const phrase = Math.floor(b / 8);
    if (b < 16) return { name: pos === 3 ? 'answer' : 'straight', edit: 0 };
    if (b >= 48 && b < 64) return { name: b === 62 ? 'roll' : 'straight', edit: b >= 56 ? 0.08 : 0 };
    if (b >= 120) return { name: pos === 3 ? 'answer' : 'straight', edit: 0 };
    const frantic = b >= 64 && b < 80;
    const table: PatName[] = frantic
      ? ['shove', 'stutter', 'tumble', phrase % 2 ? 'roll' : 'back']
      : ['straight', 'answer', phrase % 2 ? 'shove' : 'straight', phrase % 2 ? 'roll' : 'tumble'];
    return { name: table[pos], edit: frantic ? 0.3 : b >= 96 && b < 112 ? 0.16 : 0.07 };
  };
  for (let b = 0; b < 144; b += 2) {
    const { name, edit } = plan(b);
    const steps = edit > 0 ? mutate(P[name], song.rng(`edit${b}`), edit) : parseChop(P[name]);
    const loop: BreakLoop = ragga;
    brk.add(bar(b), () => chop(loop, steps, S16), edit > 0 ? {} : { key: name });
    if (b >= 4) top.add(bar(b), () => chop(tamb, P.straight, S16), { key: 'tamb' });
  }

  const K = kick({ freq: 55, punch: 180, sweep: 0.013, punch2: 22, sweep2: 0.045, hold: 0.025, decay: 0.19, click: 0.5, drive: 1.9 });
  const SN = snare({ tone: 205, tone2: 360, bend: 90, toneDecay: 0.1, body: 0.85, noise: 0.85, noiseDecay: 0.18, noiseHp: 1600, snap: 0.6, drive: 1.8, seed: 61 });
  const HARD = kick({ freq: 58, punch: 260, sweep: 0.02, punch2: 40, sweep2: 0.07, hold: 0.06, decay: 0.16, click: 0.6, drive: 5, shape: 'tanh', lp: 4500 });
  const one = song.track('kick+snare', { out: drums, gain: -6 }).send(plate, -15).fx(gap);
  const kickBeats: number[] = [];
  const snareBeats: number[] = [];
  for (let b = 0; b < song.bars; b++) {
    if (!drop(b) && !(b >= 112 && b < 120)) continue;
    const frantic = b >= 64 && b < 80;
    const last = b % 8 === 7;
    for (const { step, level } of hits('x.x.......x.....')) {
      if (last && step >= 8) continue;
      if (frantic && step === 2) continue;
      one.add(bar(b, step / 4), K, { gain: level * (step === 2 ? 0.6 : 1) });
      kickBeats.push(bar(b, step / 4));
    }
    const sp = b % 2 === 0 ? '....x.......x...' : '....x.........x.';
    for (const { step, level } of hits(sp)) {
      if (last && step >= 8) continue;
      one.add(bar(b, step / 4), SN, { gain: level * 0.85 });
      snareBeats.push(bar(b, step / 4));
    }
  }
  // Bars 72-80: a hard kick on every beat under the edits. Kept under the break, so it drives without taking over.
  const four = song.track('hard kick', { out: drums, gain: -11.5 }).fx(b => filt(b, 'hp', 45));
  for (let b = 72; b < 80; b++) for (let q = 0; q < 4; q++) {
    if (b === 79 && q >= 2) break;
    four.add(bar(b, q), HARD);
    kickBeats.push(bar(b, q));
  }
  // The builds: snare rolls that double, then double again, rising in pitch.
  const rollInto = (endBar: number, bars: number, stopShort: number): void => {
    const start = bar(endBar - bars);
    const total = bars * 4;
    for (let q = 0; q < total - stopShort; ) {
      const x = q / total;
      const step = x < 0.4 ? 0.5 : x < 0.7 ? 0.25 : x < 0.9 ? 0.125 : 0.0625;
      one.add(start + q, repitch(SN, x * 5, 1), { gain: 0.2 + 0.55 * x });
      q += step;
    }
  };
  rollInto(16, 2, 2);
  rollInto(64, 4, 2);
  rollInto(96, 1, 0);

  const cym = song.track('cymbals', { out: drums, gain: -9 }).send(hall, -8);
  const CR = crash({ decay: 2.4, seed: 19 });
  const HO = hat({ decay: 0.25, metal: 0.5, seed: 12 });
  for (const b of [16, 32, 64, 80, 96, 112]) cym.add(bar(b), CR, { gain: b === 16 || b === 64 || b === 96 ? 1 : 0.7 });
  for (const b of [16, 64, 96]) cym.add(bar(b) - 4.6, () => reversed(crash({ decay: 1.45, seed: 29 })), { gain: 0.6 });
  for (let b = 16; b < 120; b++) if (drop(b) || b >= 112) cym.add(bar(b, 2.5), HO, { gain: 0.35, pan: 0.3 });

  const pump = [...kickBeats, ...snareBeats];

  // -------------------------------------------------------------------------------------------
  // Bass
  // -------------------------------------------------------------------------------------------

  const sub = song.track('sub', { gain: -4.5 }).fx(song.duck(kickBeats, { depth: 0.7, attack: 0.002, hold: 0.04, release: 0.1, curve: 1.5 }), gap);
  const reese = song.track('reese', { gain: -2.5 })
    .fx(song.duck(pump, { depth: 0.5, hold: 0.03, release: 0.13 }), b => {
      chorus(b, { rate: 0.33, depth: 0.002, delay: 0.01, mix: 0.35 });
      eq(b, [{ type: 'peak', freq: 900, q: 1, gain: 2 }]);
    }, gap);
  const reeseCut = song.lane([[bar(16), 0.8], [bar(32), 1.1], [bar(48), 1.3], [bar(64), 1], [bar(80), 1.6], [bar(96), 1.3], [bar(112), 1.8], [bar(128), 0.7]]);
  /**
   * Two bars of bass under one chord, as `[beat, length, semitones from the root, slide]`. The shapes are written for a minor
   * chord. Under F and G the minor third becomes the major one (A over F, B over G), and the step down becomes the sixth (D
   * under F, E under G), so every bass note stays in A natural minor and on the chord.
   */
  const inKey = (c: Chord, semi: number): number => {
    if (c !== FMAJ && c !== G6) return semi;
    return semi === 3 ? 4 : semi === -2 ? -3 : semi;
  };
  const bassShape = (b: number): [number, number, number, boolean?][] => {
    if (b >= 64 && b < 80) return [[0, 0.7, 0], [0.75, 0.7, 0], [1.5, 0.9, 12, true], [2.5, 1.4, 0], [4, 0.7, 0], [4.75, 0.7, 0], [5.5, 0.9, 7], [6.5, 0.7, 3, true], [7.25, 0.7, 0, true]];
    if (b % 4 === 2) return [[0, 2.4, 0], [2.5, 0.9, 12, true], [3.5, 0.45, 7, true], [4, 1.4, 0], [5.5, 0.9, 0], [6.5, 1.4, -2, true]];
    return [[0, 2.4, 0], [2.5, 1.4, 0], [4, 1.4, 0], [5.5, 0.9, 0], [6.5, 0.7, 3, true], [7.25, 0.7, 0, true]];
  };
  for (let b = 8; b < 128; b += 2) {
    if (b >= 48 && b < 56) continue;
    const c = chordAt(b);
    const root = midi(c.bass);
    const soft = !drop(b);
    const notes: Note[] = soft
      ? [{ t: 0, dur: s(7.7), note: root }]
      : bassShape(b).map(([beat, len, semi, slide]) => ({ t: s(beat), dur: s(len), note: root + inKey(c, semi), slide: slide === true, vel: beat % 4 === 0 ? 1 : 0.85 }));
    sub.add(bar(b), () => line(SUB, notes), { gain: soft ? 0.55 : 1 });
    if (!soft) {
      const open = reeseCut.at(bar(b));
      reese.add(bar(b), () => line(REESE, notes.map(n => ({ ...n, note: n.note + (n.note < 38 ? 24 : 12) })), { seed: `reese${b}`, mod: { cutoff: () => open } }));
    }
  }

  // -------------------------------------------------------------------------------------------
  // Chords and stabs
  // -------------------------------------------------------------------------------------------

  const padCut = song.lane([[bar(0), 600], [bar(14), 2400, 'exp'], [bar(16), 4200], [bar(48), 4200], [bar(52), 2600], [bar(63), 7000, 'exp'], [bar(64), 3600], [bar(80), 6500], [bar(112), 5200], [bar(128), 3000], [bar(144), 700, 'exp']]);
  const pad = song.track('pad', { gain: -2 }).send(hall, -6)
    .fx(song.filter('lp', padCut, 0.7), b => {
      chorus(b, { rate: 0.21, depth: 0.004, delay: 0.018, mix: 0.45 });
      widen(b, 1.7);
    }, song.duck(pump, { depth: 0.45, hold: 0.03, release: 0.18 }), gap,
    song.vol(song.lane([[bar(0), 0.7], [bar(16), 0.85], [bar(48), 0.85], [bar(48.01), 1], [bar(64), 0.7], [bar(80), 1], [bar(112), 1], [bar(144), 0.6]])));
  for (let b = 0; b < song.bars; b += 2) {
    const c = chordAt(b);
    pad.add(bar(b), () => chordOf(PAD, c.pad.map(midi), s(8.2), 0.9, { seed: `pad${b}` }));
  }

  const stabs = song.track('stabs', { gain: 0 }).send(plate, -7).send(echo, -9)
    .fx(b => {
      chorus(b, { rate: 0.5, depth: 0.0025, delay: 0.012, mix: 0.3 });
      widen(b, 1.35);
    }, song.duck(kickBeats, { depth: 0.3, release: 0.1 }), gap);
  const stabCut = song.lane([[bar(8), 0.5], [bar(16), 1], [bar(32), 0.85], [bar(48), 0.8], [bar(64), 1.25], [bar(80), 1], [bar(96), 1.4], [bar(112), 1], [bar(128), 0.5]]);
  /** The three chords a riff may land on under each harmony: itself, the one a step up, the one a third up. */
  const STEP: Record<string, string[][]> = {
    A1: [AM.stab, ['G3', 'B3', 'D4', 'G4'], ['C4', 'E4', 'G4', 'C5']],
    F1: [FMAJ.stab, ['G3', 'C4', 'E4', 'G4'], ['C4', 'F4', 'A4', 'C5']],
    D2: [DM.stab, ['C4', 'E4', 'G4', 'C5'], ['D4', 'F4', 'A4', 'D5']],
    E2: [EM.stab, ['A3', 'D4', 'F#4', 'A4'], ['B3', 'D4', 'G4', 'B4']],
    G1: [G6.stab, ['A3', 'C4', 'E4', 'A4'], ['B3', 'D4', 'G4', 'B4']],
  };
  for (let b = 8; b < 128; b += 2) {
    if (b >= 48 && b < 64) continue;
    const c = chordAt(b);
    const set = STEP[c.bass];
    const sparse = b < 16 || (b >= 32 && b < 48) || b >= 112;
    const riff = sparse ? RIFF.filter((_, i) => i % 2 === 0) : (b >= 64 && b < 80) || b >= 96 ? RIFF_BUSY : RIFF;
    const cut = stabCut.at(bar(b));
    for (const [step, which] of riff) {
      const notes = set[which].map(midi);
      const patch: Patch = { ...STAB, filter: { ...STAB.filter!, cutoff: STAB.filter!.cutoff * cut } };
      stabs.add(bar(b, step / 4), () => chordOf(patch, notes, s(0.4), step % 8 === 0 ? 1 : 0.8, { seed: `stab${which}` }), { key: `${c.bass}${which}${cut}${step % 8 === 0}`, gain: sparse ? 0.7 : 1 });
    }
  }
  // A hoover swoops into the first bar of each eight in drop two.
  const hoover = song.track('hoover', { gain: -5 }).send(hall, -7).send(echo, -12)
    .fx(b => {
      chorus(b, { rate: 0.7, depth: 0.004, delay: 0.015, mix: 0.5, feedback: 0.2 });
    }, song.duck(kickBeats, { depth: 0.3, release: 0.1 }));
  for (let b = 64; b < 112; b += 8) {
    const root = midi(chordAt(b).pad[0]) + 12;
    hoover.add(bar(b), () => line(HOOVER, [{ t: 0, dur: s(3.5), note: root + 7 }, { t: s(3.5), dur: s(2.5), note: root + 12, slide: true }, { t: s(6), dur: s(1.8), note: root + 7, slide: true }], { seed: `hv${b}` }), { gain: b >= 80 && b < 96 ? 0.7 : 1 });
  }

  // -------------------------------------------------------------------------------------------
  // Melody
  // -------------------------------------------------------------------------------------------

  const lead = song.track('lead', { gain: 0.5 }).send(hall, -8).send(echo, -8)
    .fx(b => {
      chorus(b, { rate: 0.4, depth: 0.002, delay: 0.011, mix: 0.25 });
    }, song.duck(kickBeats, { depth: 0.2, release: 0.1 }));
  const piano = song.track('piano', { gain: 1 }).send(hall, -6).send(echo, -10)
    .fx(b => {
      chorus(b, { rate: 0.55, depth: 0.002, delay: 0.011, mix: 0.25 });
    });
  const toNotes = (tune: Tune, up = 0): Note[] => tune.map(([beat, len, name], i) => ({ t: s(beat), dur: s(len * 0.92), note: midi(name) + up, slide: i > 0 && len <= 0.5, vel: beat % 4 === 0 ? 1 : 0.85 }));
  const sing = (startBar: number, tune: Tune, gain = 1, up = 0): void => {
    lead.add(bar(startBar), () => line(LEAD, toNotes(tune, up), { seed: `lead${startBar}` }), { gain });
  };
  const play = (startBar: number, tune: Tune, gain = 1, octave = 0): void => {
    for (const [beat, len, name] of tune) piano.add(bar(startBar, beat), () => fmLine(PIANO, [{ t: 0, dur: s(Math.min(len, 2)), note: midi(name) + octave }]), { gain, key: `p${name}${Math.min(len, 2)}${octave}` });
  };
  play(8, TUNE_SLOW, 0.7);
  sing(32, TUNE_A);
  sing(40, TUNE_B);
  play(32, TUNE_A, 0.5, 12);
  play(48, TUNE_SLOW, 1);
  play(56, TUNE_SLOW, 1);
  play(56, TUNE_SLOW, 0.5, 12);
  sing(56, TUNE_SLOW, 0.6);
  sing(80, TUNE_LIFT);
  sing(88, TUNE_LIFT);
  play(80, TUNE_LIFT, 0.5);
  play(88, TUNE_LIFT, 0.5);
  sing(96, TUNE_A);
  sing(104, TUNE_B);
  play(96, TUNE_A, 0.55, 12);
  play(104, TUNE_B, 0.55, 12);
  sing(112, TUNE_A, 0.6);
  play(120, TUNE_SLOW, 0.8);
  play(128, TUNE_SLOW, 0.7);
  play(136, TUNE_SLOW, 0.5);
  // Chords under the breakdown's piano.
  for (let b = 48; b < 64; b += 2) {
    const c = chordAt(b);
    piano.add(bar(b), () => chordOf(PIANO, c.pad.slice(0, 4).map(n => midi(n)), s(6), 0.6, { strum: 0.03 }), { gain: 0.7, key: `pc${c.bass}` });
  }

  // An acid line bubbles under drop two and opens as it goes.
  const acid = song.track('acid', { gain: -11 }).send(echo, -9).send(plate, -12)
    .fx(b => {
      drive(b, { amount: 6, shape: 'tanh', lp: 7000 });
      widen(b, 1.2);
    }, song.duck(kickBeats, { depth: 0.4, release: 0.1 }));
  const acidOpen = song.lane([[bar(64), 0.8], [bar(80), 1.8], [bar(80.01), 1], [bar(96), 2.2], [bar(112), 3], [bar(120), 1]]);
  // Minor pentatonic over the minor chords, major pentatonic over F and G: both sets are inside A natural minor, so the line
  // never plays Ab, Bb or Eb against the pad's A and E, or Bb against G's B.
  const MINOR_PENTA = [0, 3, 5, 7, 10];
  const MAJOR_PENTA = [0, 2, 4, 7, 9];
  for (let b = 64; b < 120; b++) {
    const c = chordAt(b);
    const PENTA = c === FMAJ || c === G6 ? MAJOR_PENTA : MINOR_PENTA;
    const root = midi(c.bass) + (midi(c.bass) < 38 ? 24 : 12);
    const rng = song.rng(`acid${b % 4}:${chordAt(b).bass}`);
    const notes: Note[] = [];
    for (let st = 0; st < 16; st++) {
      if (rng.chance(0.18)) continue;
      const oct = rng.chance(0.25) ? 12 : 0;
      notes.push({ t: s(st / 4), dur: s(0.2), note: root + rng.pick(PENTA) + oct, accent: st % 4 === 0 || rng.chance(0.15), slide: rng.chance(0.3) });
    }
    const open = acidOpen.at(bar(b));
    acid.add(bar(b), () => line(ACID, notes, { seed: `acid${b}`, mod: { cutoff: () => open } }));
  }

  // -------------------------------------------------------------------------------------------
  // Transitions
  // -------------------------------------------------------------------------------------------

  const fx = song.track('fx', { gain: -9 }).send(hall, -6);
  for (const b of [16, 64, 96]) {
    const long = b === 64;
    fx.add(bar(b - (long ? 8 : 4)), () => noiseSweep({ dur: s(long ? 32 : 16), from: 400, to: 12000, q: 1.6, curve: 2.4, tremFrom: 0, tremTo: long ? 12.3 : 0 }), { gain: 0.8 });
    fx.add(bar(b), () => impact({ dur: 2.8, freq: 46 }), { gain: 1 });
    fx.add(bar(b), () => noiseSweep({ dur: s(8), from: 10000, to: 400, levelFrom: 1, levelTo: 0, curve: 2.4, seed: 5 }), { gain: 0.5 });
  }
  for (const b of [32, 80]) fx.add(bar(b - 2), () => noiseSweep({ dur: s(8), from: 800, to: 10000, q: 1.4, curve: 2 }), { gain: 0.45 });
  for (const b of [48, 112]) {
    fx.add(bar(b), () => noiseSweep({ dur: s(12), from: 11000, to: 300, levelFrom: 1, levelTo: 0, curve: 2.2, seed: 8 }), { gain: 0.6 });
    fx.add(bar(b), () => subDrop({ dur: s(4), from: 100, to: 36 }), { gain: 0.5 });
    fx.add(bar(b), () => impact({ dur: 3, freq: 42, noise: 0.4 }), { gain: 0.6 });
  }
  // A pitch riser over the last four bars of the breakdown.
  fx.add(bar(60), () => line({ osc: [{ wave: 'saw', voices: 5, detune: 30, spread: 1 }], amp: { a: s(14), d: 0.1, s: 1, r: 0.05 }, filter: { type: 'lp', cutoff: 900, env: 2.5, shape: { a: s(15), d: 0.1, s: 1, r: 0.1 } }, hp: 300, gain: 0.2 },
    [{ t: 0, dur: s(15.5), note: midi('A3') }], { mod: { pitch: t => (12 * t) / s(15.5) }, seed: 'riser' }), { gain: 0.5 });
  return song;
}
