// Blue Hour Briefing. Menu music: liquid drum and bass, 172 BPM, F minor.
//
//   nice npx tsx tools/music/render.ts blue-hour-briefing
//
// Form (bars from 0): intro 0-16, drop one 16-48, breakdown 48-64, drop two 64-96, outro 96-128.
// Harmony: Dbmaj9, Eb6/9, Fm9, Cm11 two bars each (A). The breakdown and the first half of drop two move to
// Bbm9, Eb9, Abmaj9, Dbmaj9 (B), which is the "change". The outro ends on the pad and piano the intro starts with.
import {
  Song, midi, line, tone, fmLine, chordOf, kick, snare, hat, ride, crash, shaker, noiseSweep, impact, subDrop, reversed, repitch,
  breakKit, breakLoop, chop, hits,
  reverb, delay, chorus, drive, compress, eq, filt, autopan, widen,
  type Patch, type FmPatch, type Note,
} from '../engine';

// ---------------------------------------------------------------------------------------------
// Sounds
// ---------------------------------------------------------------------------------------------

const SUB: Patch = { osc: [{ wave: 'sine', reset: true }], amp: { a: 0.012, d: 0.4, s: 0.9, r: 0.09 }, drive: 0.5, glide: 0.06, gain: 0.5 };
const MID: Patch = {
  osc: [{ wave: 'saw', cents: -11 }, { wave: 'saw', cents: 11 }, { wave: 'square', semi: -12, level: 0.35 }],
  amp: { a: 0.012, d: 0.3, s: 0.85, r: 0.1 },
  filter: { type: 'lp', cutoff: 420, q: 0.9, env: 1.4, shape: { a: 0.01, d: 0.22, s: 0.25, r: 0.1 }, lfo: { rate: 0.31, depth: 0.45 } },
  hp: 95, drive: 0.7, glide: 0.06, gain: 0.3,
};
const KEYS: FmPatch = {
  ops: [
    { ratio: 1, index: 1.25, decay: 0.7, sustain: 0.22, pan: -0.45, cents: -4 },
    { ratio: 1, index: 1.05, decay: 0.9, sustain: 0.2, pan: 0.45, cents: 4 },
    { ratio: 14, index: 0.55, decay: 0.07, level: 0.3 },
  ],
  amp: { a: 0.003, d: 1.7, s: 0.22, r: 0.35 }, velIndex: 0.7, hp: 170, gain: 0.2,
};
const PAD: Patch = {
  osc: [{ wave: 'saw', voices: 7, detune: 17, spread: 0.9 }, { wave: 'tri', semi: -12, level: 0.2 }],
  amp: { a: 0.4, d: 1.2, s: 0.85, r: 1.1 },
  filter: { type: 'lp', cutoff: 4200, q: 0.6, key: 0.3, lfo: { rate: 0.11, depth: 0.25 } },
  hp: 250, gain: 0.16,
};
const STRINGS: Patch = {
  osc: [{ wave: 'saw', voices: 5, detune: 13, spread: 1 }],
  amp: { a: 0.7, d: 1, s: 0.9, r: 1.4 },
  filter: { type: 'lp', cutoff: 9500, q: 0.5 },
  hp: 900, vibrato: { rate: 5.1, cents: 7, delay: 0.5 }, gain: 0.14,
};
const LEAD: Patch = {
  osc: [{ wave: 'tri' }, { wave: 'saw', level: 0.32, cents: 5 }, { wave: 'sine', semi: 12, level: 0.25 }],
  amp: { a: 0.012, d: 0.5, s: 0.75, r: 0.22 },
  filter: { type: 'lp', cutoff: 2900, q: 0.8, env: 1.1, shape: { a: 0.01, d: 0.3, s: 0.3, r: 0.2 }, key: 0.4 },
  vibrato: { rate: 5.4, cents: 9, delay: 0.22 }, glide: 0.05, gain: 0.3,
};
const BELL: FmPatch = {
  ops: [{ ratio: 3.5, index: 1.5, decay: 0.25, sustain: 0.05, pan: -0.3 }, { ratio: 1, index: 0.7, decay: 0.6, sustain: 0.1, pan: 0.3, cents: 6 }],
  amp: { a: 0.002, d: 0.9, s: 0, r: 0.5 }, hp: 300, gain: 0.2,
};
const PLUCK: Patch = {
  osc: [{ wave: 'saw' }, { wave: 'square', level: 0.5, cents: 7 }],
  amp: { a: 0.002, d: 0.16, s: 0, r: 0.12 },
  filter: { type: 'lp', cutoff: 520, q: 1.6, env: 3.6, shape: { a: 0.002, d: 0.11, s: 0, r: 0.1 }, vel: 0.6 },
  hp: 250, gain: 0.3,
};

// ---------------------------------------------------------------------------------------------
// Harmony and melody
// ---------------------------------------------------------------------------------------------

interface Chord { bass: string; pad: string[]; keys: string[] }
const A: Chord[] = [
  { bass: 'Db2', pad: ['Db3', 'Ab3', 'C4', 'Eb4', 'F4'], keys: ['F3', 'Ab3', 'C4', 'Eb4'] },
  { bass: 'Eb2', pad: ['Eb3', 'Bb3', 'C4', 'F4', 'G4'], keys: ['G3', 'Bb3', 'C4', 'F4'] },
  { bass: 'F1', pad: ['F3', 'Ab3', 'C4', 'Eb4', 'G4'], keys: ['Ab3', 'C4', 'Eb4', 'G4'] },
  { bass: 'C2', pad: ['C3', 'G3', 'Bb3', 'Eb4', 'F4'], keys: ['G3', 'Bb3', 'Eb4', 'F4'] },
];
const B: Chord[] = [
  { bass: 'Bb1', pad: ['Bb2', 'F3', 'Ab3', 'C4', 'Db4'], keys: ['Ab3', 'C4', 'Db4', 'F4'] },
  { bass: 'Eb2', pad: ['Eb3', 'Bb3', 'Db4', 'F4', 'G4'], keys: ['G3', 'Bb3', 'Db4', 'F4'] },
  { bass: 'Ab1', pad: ['Ab2', 'G3', 'Bb3', 'C4', 'Eb4'], keys: ['G3', 'Bb3', 'C4', 'Eb4'] },
  { bass: 'Db2', pad: ['Db3', 'Ab3', 'C4', 'Eb4', 'F4'], keys: ['F3', 'Ab3', 'C4', 'Eb4'] },
];

/** Pitch classes of F minor (F G Ab Bb C Db Eb), with C as 0. */
const F_MINOR = new Set([5, 7, 8, 10, 0, 1, 3]);

/** `[beat within the phrase, length in beats, note]`. Each phrase is eight bars. */
type Tune = [number, number, string][];
const HOOK_A: Tune = [
  [0, 1.5, 'C5'], [1.5, 1.5, 'Eb5'], [3, 1, 'F5'], [4, 2.5, 'Eb5'], [6.5, 0.5, 'C5'], [7, 1, 'Ab4'],
  [8, 1.5, 'Bb4'], [9.5, 1.5, 'C5'], [11, 1, 'Eb5'], [12, 3, 'G4'], [15, 0.5, 'Ab4'], [15.5, 0.5, 'Bb4'],
  [16, 1.5, 'C5'], [17.5, 1.5, 'Ab5'], [19, 1, 'G5'], [20, 2, 'F5'], [22, 1, 'Eb5'], [23, 1, 'C5'],
  [24, 1.5, 'Eb5'], [25.5, 1.5, 'Bb4'], [27, 1, 'G4'], [28, 1, 'Bb4'], [29, 3, 'C5'],
];
const HOOK_B: Tune = [
  [0, 1.5, 'C5'], [1.5, 1.5, 'Eb5'], [3, 1, 'Ab5'], [4, 2.5, 'G5'], [6.5, 0.5, 'F5'], [7, 1, 'Eb5'],
  [8, 1.5, 'G5'], [9.5, 1.5, 'F5'], [11, 1, 'Eb5'], [12, 3, 'Bb4'], [15, 0.5, 'C5'], [15.5, 0.5, 'Eb5'],
  [16, 1.5, 'F5'], [17.5, 1.5, 'Ab5'], [19, 1, 'Bb5'], [20, 2, 'Ab5'], [22, 1, 'G5'], [23, 1, 'Eb5'],
  [24, 1.5, 'G5'], [25.5, 1.5, 'Eb5'], [27, 1, 'C5'], [28, 1, 'Eb5'], [29, 3, 'F5'],
];
const HOOK_C: Tune = [
  [0, 2, 'F5'], [2, 1, 'Db5'], [3, 1, 'C5'], [4, 1.5, 'Db5'], [5.5, 1.5, 'F5'], [7, 1, 'Ab5'],
  [8, 2, 'G5'], [10, 1, 'F5'], [11, 1, 'Eb5'], [12, 1.5, 'Db5'], [13.5, 1.5, 'Eb5'], [15, 1, 'F5'],
  [16, 2, 'Eb5'], [18, 1, 'C5'], [19, 1, 'Bb4'], [20, 1.5, 'C5'], [21.5, 1.5, 'Eb5'], [23, 1, 'G5'],
  [24, 2, 'F5'], [26, 1, 'Eb5'], [27, 1, 'C5'], [28, 1, 'Ab4'], [29, 1, 'C5'], [30, 2, 'Eb5'],
];

export default function build(): Song {
  const song = new Song({
    title: 'Blue Hour Briefing', slug: 'blue-hour-briefing', list: 'menu', bpm: 172, bars: 128, key: 'F minor', tail: 2.5,
    master: { target: -8.3, ceiling: -1.4, clipKnee: 2.5, width: 1.2, eq: [{ type: 'highshelf', freq: 7000, gain: 2.5 }, { type: 'peak', freq: 260, q: 0.9, gain: -1.2 }, { type: 'peak', freq: 2800, q: 0.7, gain: 1 }] },
  });
  const { s, bar } = song;
  song.section('intro', 0, 16);
  song.section('drop 1', 16, 48);
  song.section('breakdown', 48, 64);
  song.section('drop 2', 64, 96);
  song.section('outro', 96, 128);
  const rng = song.rng('mix');

  const hall = song.bus('hall', b => reverb(b, { decay: 3.2, size: 1.6, damp: 6500, predelay: 0.025, hp: 260 }), -1.5);
  const room = song.bus('room', b => reverb(b, { decay: 0.7, size: 0.7, damp: 6500, predelay: 0.006, hp: 320 }), -6);
  const echo = song.bus('echo', b => delay(b, { time: s(0.75), feedback: 0.42, lp: 3600, hp: 420, pingpong: true }), -7);

  /** Half a bar of near silence before drop two, so the drop lands. */
  const gap = song.vol(song.lane([[bar(63.5) - 0.05, 1], [bar(63.5), 0.12], [bar(64) - 0.06, 0.12], [bar(64), 1]]));

  /** The progression in force at a bar, and which of its four chords. Each chord lasts two bars. */
  const isB = (b: number): boolean => (b >= 48 && b < 80);
  const chordAt = (b: number): Chord => (isB(b) ? B : A)[Math.floor(b / 2) % 4];

  // -------------------------------------------------------------------------------------------
  // Drums
  // -------------------------------------------------------------------------------------------

  const kit = breakKit({ seed: 11 });
  const roller = breakLoop(kit, {
    bpm: 140, seed: 3, swing: 0.1, room: 0.22, drive: 5, squash: 0.65,
    kick: 'x.........x.....|x.........x..o..', snare: '....X.......X...|....X.......X...', ghost: '.......o.o.....o|..o....o.o....o.',
    hat: 'x.o.x.o.x.o.x.o.', open: '..............o.|................', ride: '',
  });
  const tumble = breakLoop(breakKit({ seed: 23, hatDecay: 0.05 }), {
    bpm: 140, seed: 5, swing: 0.12, room: 0.26, drive: 6, squash: 0.7,
    kick: 'x..o......x.....|..x...o...x.....', snare: '....X.......X..o|....X.....o.X...', ghost: '.......o.o......|.o.....o.......o',
    hat: 'x.x.x.x.x.x.x.x.', ride: 'x...x...x...x...',
  });
  const PAT = {
    plain: '0 1 2 3 4 5 6 7 | 8 9 10 11 12 13 14 15',
    turn: '0 1 2 3 4 5 6 7 | 8 9 10 11 12 5 6 7x2',
    edit: '0 1 2 3 4 5 2 3 | 8 9 10 5 6 13 14 15',
    skip: '0 1 2 3 8 5 6 7 | 0 9 10 3 12 13 6 15x2',
    fill: '0 1 2 3 4 5 6 7 | 8 9 2x2 2x2 6 6x2 6x3 6x4u5',
    fill2: '0 1 2 3 4 5 6 7 | 8 9 10 11 14r 14 2x4d7 6x4u7',
  };
  const drums = song.track('drums', { gain: -1.5 }).fx(b => {
    compress(b, { threshold: -12, ratio: 3, attack: 0.012, release: 0.11, knee: 6, makeup: 2.5, mix: 0.6 });
    drive(b, { amount: 3, shape: 'soft', out: -1 });
  });
  const brk = song.track('break', { out: drums, gain: -3.5 }).send(room, -13);
  const hpLane = song.lane([
    [bar(0), 900], [bar(8), 900], [bar(15), 250, 'exp'], [bar(16), 110], [bar(48), 110], [bar(48.01), 700], [bar(60), 700], [bar(63.5), 260, 'exp'], [bar(64), 110],
    [bar(96), 110], [bar(104), 380, 'exp'], [bar(112), 900, 'exp'],
  ]);
  brk.fx(song.filter('hp', hpLane, 0.8), b => {
    eq(b, [{ type: 'peak', freq: 3200, q: 0.8, gain: 3.5 }, { type: 'highshelf', freq: 8000, gain: 2.5 }]);
  });
  const brkVol = song.lane([[bar(8), 0.35], [bar(16), 0.8], [bar(16.01), 1], [bar(48), 1], [bar(56), 0], [bar(56.01), 0.3], [bar(64), 0.6], [bar(64.01), 1], [bar(104), 1], [bar(112), 0.45], [bar(120), 0.0]]);
  brk.fx(song.vol(brkVol), gap);
  const placeBreak = (b: number, loop: typeof roller, pat: string, key: string): void => {
    brk.add(bar(b), () => chop(loop, pat, { bpm: song.bpm }), { key });
  };
  // Two bars at a time. Which pattern depends on where the two bars sit in their eight.
  for (let b = 8; b < 120; b += 2) {
    if (b >= 48 && b < 56) continue;
    const pos = (b % 8) / 2;
    const second = b >= 64 && b < 96;
    const loop = second && b < 80 ? tumble : roller;
    let pat = pos === 0 ? 'plain' : pos === 1 ? 'turn' : pos === 2 ? (second ? 'skip' : 'edit') : (Math.floor(b / 8) % 2 === 0 ? 'fill' : 'fill2');
    if (b < 16 || (b >= 56 && b < 64) || b >= 104) pat = pos === 3 ? 'turn' : 'plain';
    if (b === 62) pat = 'fill';
    placeBreak(b, loop, PAT[pat as keyof typeof PAT], `${loop === roller ? 'r' : 't'}:${pat}`);
  }

  const K = kick({ freq: 52, punch: 190, sweep: 0.014, punch2: 25, sweep2: 0.05, hold: 0.03, decay: 0.21, click: 0.45, drive: 1.7 });
  const S = snare({ tone: 196, tone2: 340, bend: 80, toneDecay: 0.11, body: 0.9, noise: 0.8, noiseDecay: 0.2, noiseHp: 1500, snap: 0.5, drive: 1.6, seed: 31 });
  const one = song.track('kick+snare', { out: drums, gain: -3.5 }).send(room, -16);
  const kickBeats: number[] = [];
  const snareBeats: number[] = [];
  const full = (b: number): boolean => (b >= 16 && b < 48) || (b >= 64 && b < 104);
  for (let b = 0; b < song.bars; b++) {
    if (!full(b)) continue;
    const last = b % 8 === 7;
    const tumbling = b >= 64 && b < 80;
    const kp = tumbling ? (b % 2 === 0 ? 'x.........x.....' : '..x.......x.....') : b % 2 === 0 ? 'x.........x.....' : 'x.........x..o..';
    for (const { step, level } of hits(kp)) {
      if (last && step >= 8) continue;
      one.add(bar(b, step / 4), K, { gain: level });
      kickBeats.push(bar(b, step / 4));
    }
    for (const { step, level } of hits('....x.......x...')) {
      if (last && step >= 8) continue;
      one.add(bar(b, step / 4), S, { gain: level * 0.9 });
      snareBeats.push(bar(b, step / 4));
    }
  }
  // The build into drop two: kicks on the beat, then on the half beat.
  for (let b = 60; b < 64; b++) {
    const step = b < 62 ? 1 : 0.5;
    for (let q = 0; q < 4; q += step) {
      if (b === 63 && q >= 2) break;
      one.add(bar(b, q), K, { gain: 0.45 + 0.1 * (b - 60) });
      kickBeats.push(bar(b, q));
    }
  }
  // Snare rolls into both drops, getting louder and higher.
  const rollInto = (endBar: number, bars: number): void => {
    const start = bar(endBar - bars);
    const total = bars * 4;
    for (let q = 0; q < total; ) {
      const x = q / total;
      const step = x < 0.5 ? 0.5 : x < 0.8 ? 0.25 : 0.125;
      if (!(endBar === 64 && q >= total - 2)) one.add(start + q, repitch(S, x * 3, 1), { gain: 0.22 + 0.5 * x });
      q += step;
    }
  };
  rollInto(16, 2);
  rollInto(64, 2);

  const hats = song.track('hats', { out: drums, gain: -6.5 }).send(room, -12).fx(b => filt(b, 'hp', 5000));
  const H = hat({ decay: 0.035, metal: 0.4, seed: 41 });
  const HO = hat({ decay: 0.2, metal: 0.45, seed: 42 });
  const SH = shaker({ decay: 0.045 });
  const RD = ride({ decay: 0.5, ping: 0.4 });
  for (let b = 4; b < 124; b++) {
    if (b >= 48 && b < 52) continue;
    const quiet = b < 16 || (b >= 48 && b < 64) || b >= 104;
    const level = quiet ? 0.55 : 1;
    for (let st = 0; st < 16; st++) {
      const accent = st % 4 === 2 ? 1 : st % 2 === 0 ? 0.6 : 0.38;
      hats.add(bar(b, st / 4) + (st % 2 ? 0.02 : 0), SH, { gain: accent * level * (0.85 + rng.next() * 0.3), pan: 0.25 });
      if (st % 4 === 2 && !quiet) hats.add(bar(b, st / 4), H, { gain: 0.7, pan: -0.2 });
    }
    if (!quiet && b % 2 === 1) hats.add(bar(b, 3.5), HO, { gain: 0.55, pan: -0.2 });
    // The ride carries drop two and the second half of drop one.
    if ((b >= 32 && b < 48) || (b >= 64 && b < 96)) for (let q = 0; q < 4; q += b >= 80 ? 0.5 : 1) hats.add(bar(b, q), RD, { gain: q % 1 === 0 ? 0.5 : 0.3, pan: 0.3 });
  }
  const cym = song.track('cymbals', { out: drums, gain: -9 }).send(hall, -9);
  const CR = crash({ decay: 2.2 });
  for (const b of [16, 32, 64, 80, 96]) cym.add(bar(b), CR, { gain: b === 16 || b === 64 ? 1 : 0.7 });
  for (const b of [16, 64]) cym.add(bar(b) - 4, () => reversed(crash({ decay: 1.35, seed: 9 })), { gain: 0.6 });

  const pump = [...kickBeats, ...snareBeats];

  // -------------------------------------------------------------------------------------------
  // Bass
  // -------------------------------------------------------------------------------------------

  const sub = song.track('sub', { gain: -4.5 }).fx(song.duck(kickBeats, { depth: 0.75, attack: 0.002, hold: 0.045, release: 0.11, curve: 1.5 }), gap);
  const mid = song.track('midbass', { gain: -3.5 })
    .fx(song.duck(pump, { depth: 0.5, hold: 0.03, release: 0.14 }), b => {
      chorus(b, { rate: 0.4, depth: 0.0018, delay: 0.009, mix: 0.3 });
    });
  /** One chord's two bars of bass, as beats from its start. */
  const bassLine = (b: number, c: Chord, next: Chord): Note[] => {
    const root = midi(c.bass);
    const busy = b >= 64 && b < 96;
    // A whole step towards the next root, pulled back by a semitone where that would leave F minor: C up gives Db, not D, and
    // Db down gives C, not B.
    const dir = midi(next.bass) > root ? 1 : -1;
    const approach = F_MINOR.has((((root + 2 * dir) % 12) + 12) % 12) ? root + 2 * dir : root + dir;
    const shape: [number, number, number, boolean?][] = busy
      ? [[0, 1.4, 0], [1.5, 0.9, 0], [2.5, 0.75, 12], [3.25, 0.7, 0, true], [4, 2.4, 0], [6.5, 0.45, 7], [7, 0.9, approach - root]]
      : [[0, 1.4, 0], [1.5, 0.9, 0], [2.5, 1.4, 0], [4, 2.4, 0], [6.5, 0.45, 7], [7, 0.9, 0]];
    return shape.map(([beat, len, semi, slide]) => ({ t: s(beat), dur: s(len), note: root + semi, slide: slide === true, vel: beat % 4 === 0 ? 1 : 0.85 }));
  };
  for (let b = 8; b < 112; b += 2) {
    if (b >= 48 && b < 56) continue;
    const c = chordAt(b);
    const next = chordAt(b + 2);
    const soft = b < 16 || (b >= 56 && b < 64) || b >= 104;
    const notes = soft ? [{ t: 0, dur: s(7.6), note: midi(c.bass) }] : bassLine(b, c, next);
    sub.add(bar(b), () => line(SUB, notes), { gain: soft ? 0.6 : 1 });
    if (!soft) mid.add(bar(b), () => line(MID, notes.map(n => ({ ...n, note: n.note + 12 })), { seed: `mid${b}` }));
  }

  // -------------------------------------------------------------------------------------------
  // Chords
  // -------------------------------------------------------------------------------------------

  const padCut = song.lane([[bar(0), 700], [bar(14), 2600, 'exp'], [bar(16), 5200], [bar(48), 4500], [bar(52), 2200], [bar(62), 7000, 'exp'], [bar(64), 6000], [bar(96), 5000], [bar(112), 2600], [bar(128), 800, 'exp']]);
  const pad = song.track('pad', { gain: -3 }).send(hall, -7)
    .fx(song.filter('lp', padCut, 0.7), b => {
      chorus(b, { rate: 0.23, depth: 0.004, delay: 0.017, mix: 0.4 });
      widen(b, 1.7);
    }, song.duck(pump, { depth: 0.45, hold: 0.03, release: 0.2 }), gap);
  pad.fx(song.vol(song.lane([[bar(0), 0.6], [bar(12), 0.75], [bar(16), 1], [bar(48), 1], [bar(48.01), 0.8], [bar(60), 1], [bar(104), 1], [bar(112), 0.7], [bar(128), 0.5]])));
  const strings = song.track('strings', { gain: -5 }).send(hall, -5).fx(song.duck(pump, { depth: 0.3, release: 0.2 }), b => widen(b, 1.5));
  for (let b = 0; b < song.bars; b += 2) {
    const c = chordAt(b);
    pad.add(bar(b), () => chordOf(PAD, c.pad.map(midi), s(8.2), 0.9, { seed: `pad${b}` }));
    const high = (b >= 32 && b < 96) || (b >= 100 && b < 112);
    if (high) strings.add(bar(b), () => chordOf(STRINGS, [midi(c.pad[4]) + 12, midi(c.pad[2]) + 12], s(8.2), b >= 48 && b < 64 ? 1 : 0.75, { seed: `str${b}` }));
  }

  const keys = song.track('keys', { gain: -3.5 }).send(hall, -10).send(echo, -16)
    .fx(b => {
      chorus(b, { rate: 0.6, depth: 0.0022, delay: 0.011, mix: 0.3 });
      autopan(b, 0.9, 0.22);
    }, song.duck(pump, { depth: 0.3, hold: 0.02, release: 0.15 }), gap);
  for (let b = 0; b < song.bars; b += 2) {
    const c = chordAt(b);
    const notes = c.keys.map(midi);
    const sparse = b < 16 || (b >= 48 && b < 64) || b >= 112;
    if (sparse) {
      keys.add(bar(b), () => chordOf(KEYS, notes, s(6), 0.75, { strum: 0.022 }), { key: `ks${c.bass}${isB(b)}` });
      if (b % 4 === 2) keys.add(bar(b, 6.5), () => chordOf(KEYS, notes.slice(1), s(1.2), 0.55, { strum: 0.015 }), { key: `kt${c.bass}${isB(b)}` });
      continue;
    }
    // Comping: on the one, the and of two, the and of three, then a long chord and two pushes.
    const comp: [number, number, number][] = [[0, 1.3, 0.9], [1.5, 0.8, 0.65], [2.5, 1.3, 0.8], [4, 2.2, 0.85], [6.5, 0.4, 0.55], [7, 0.8, 0.7]];
    for (const [beat, len, vel] of comp) keys.add(bar(b, beat), () => chordOf(KEYS, notes, s(len), vel, { strum: 0.012 }), { key: `kc${c.bass}${isB(b)}${len}${vel}` });
  }

  // -------------------------------------------------------------------------------------------
  // Melody
  // -------------------------------------------------------------------------------------------

  const lead = song.track('lead', { gain: -3.5 }).send(hall, -8).send(echo, -9)
    .fx(b => {
      chorus(b, { rate: 0.35, depth: 0.002, delay: 0.012, mix: 0.25 });
    });
  const bell = song.track('bell', { gain: -5 }).send(hall, -6).send(echo, -7);
  const toNotes = (tune: Tune, up = 0): Note[] => tune.map(([beat, len, name], i) => ({ t: s(beat), dur: s(len * 0.94), note: midi(name) + up, slide: i > 0 && len < 1, vel: beat % 4 === 0 ? 1 : 0.85 }));
  const playTune = (startBar: number, tune: Tune, o: { lead?: number; bell?: number; up?: number } = {}): void => {
    const leadGain = o.lead ?? 1;
    const bellGain = o.bell ?? 1;
    if (leadGain > 0) lead.add(bar(startBar), () => line(LEAD, toNotes(tune, o.up ?? 0), { seed: `lead${startBar}` }), { gain: leadGain });
    if (bellGain > 0) for (const [beat, len, name] of tune) bell.add(bar(startBar, beat), () => fmLine(BELL, [{ t: 0, dur: s(Math.min(len, 1.5)), note: midi(name) + 12 + (o.up ?? 0) }]), { gain: bellGain, key: `bell${name}${len}${o.up ?? 0}` });
  };
  playTune(8, HOOK_A, { lead: 0, bell: 0.8 });
  playTune(16, HOOK_A);
  playTune(24, HOOK_B);
  playTune(32, HOOK_A, { bell: 0.7 });
  playTune(40, HOOK_B, { bell: 0.7 });
  playTune(48, HOOK_C, { lead: 0, bell: 0.9 });
  playTune(56, HOOK_C, { lead: 0.7, bell: 0.9 });
  playTune(64, HOOK_C);
  playTune(72, HOOK_C, { up: 0 });
  playTune(80, HOOK_A);
  playTune(88, HOOK_B);
  playTune(96, HOOK_A, { lead: 0.6, bell: 0.8 });
  playTune(104, HOOK_A, { lead: 0, bell: 0.7 });
  playTune(112, HOOK_A, { lead: 0, bell: 0.45 });
  // A harmony above the tune in the last sixteen bars of drop two.
  const harmony = song.track('harmony', { gain: -11 }).send(hall, -6).send(echo, -10);
  const third = (name: string): number => {
    // A diatonic third above, in F minor.
    const scale = [5, 7, 8, 10, 0, 1, 3];
    const m = midi(name);
    const pc = ((m % 12) + 12) % 12;
    const at = scale.indexOf(pc);
    const up = scale[(at + 2) % 7];
    return m + ((up - pc + 12) % 12);
  };
  for (const [startBar, tune] of [[80, HOOK_A], [88, HOOK_B], [40, HOOK_B]] as const) {
    harmony.add(bar(startBar), () => line(LEAD, tune.map(([beat, len, name], i) => ({ t: s(beat), dur: s(len * 0.94), note: third(name), slide: i > 0 && len < 1 })), { seed: `har${startBar}` }));
  }

  const arp = song.track('arp', { gain: -8 }).send(echo, -6).send(hall, -10).fx(b => widen(b, 1.6));
  const arpVol = song.lane([[bar(8), 0.5], [bar(16), 0.8], [bar(32), 0.75], [bar(32.01), 1], [bar(48), 1], [bar(64), 0.9], [bar(96), 1], [bar(112), 0.8], [bar(126), 0.3]]);
  arp.fx(song.vol(arpVol));
  const ORDER = [0, 2, 1, 3, 2, 4, 3, 1, 0, 3, 2, 4, 1, 3, 2, 4];
  for (let b = 8; b < 126; b++) {
    if ((b >= 16 && b < 32) || (b >= 64 && b < 72)) continue;
    const c = chordAt(b);
    const tones = c.pad.map(n => midi(n) + 12);
    const every = b >= 48 && b < 64 ? 2 : 1;
    for (let st = 0; st < 16; st += every) {
      const note = tones[ORDER[(st + (b % 2) * 5) % 16]];
      arp.add(bar(b, st / 4), () => tone(PLUCK, note, s(0.2), st % 4 === 0 ? 1 : 0.6), { key: `arp${note}${st % 4 === 0}`, pan: st % 2 ? 0.35 : -0.35 });
    }
  }

  // -------------------------------------------------------------------------------------------
  // Transitions
  // -------------------------------------------------------------------------------------------

  const fx = song.track('fx', { gain: -9 }).send(hall, -6);
  for (const b of [16, 64]) {
    fx.add(bar(b - 4), () => noiseSweep({ dur: s(16), from: 500, to: 11000, q: 1.6, curve: 2.2, tremFrom: 0, tremTo: b === 64 ? 11.5 : 0 }), { gain: 0.8 });
    fx.add(bar(b), () => impact({ dur: 2.6, freq: 44 }), { gain: 1 });
    fx.add(bar(b), () => noiseSweep({ dur: s(8), from: 9000, to: 400, levelFrom: 1, levelTo: 0, curve: 2.4, seed: 5 }), { gain: 0.5 });
  }
  for (const b of [32, 80]) fx.add(bar(b - 2), () => noiseSweep({ dur: s(8), from: 800, to: 9000, q: 1.4, curve: 2 }), { gain: 0.45 });
  for (const b of [48, 96]) {
    fx.add(bar(b), () => noiseSweep({ dur: s(12), from: 10000, to: 300, levelFrom: 1, levelTo: 0, curve: 2.2, seed: 8 }), { gain: 0.6 });
    fx.add(bar(b), () => subDrop({ dur: s(4), from: 95, to: 36 }), { gain: 0.5 });
    fx.add(bar(b), () => impact({ dur: 3, freq: 40, noise: 0.4 }), { gain: 0.6 });
  }
  return song;
}
