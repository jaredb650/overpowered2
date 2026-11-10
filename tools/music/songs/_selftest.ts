// Not music: one of everything the engine makes, eight bars at a time, to check the renderer by measurement.
//   nice npx tsx tools/music/render.ts _selftest --draft
import { Song, breakKit, breakLoop, chop, chordOf, chord, clap, crash, delay, hat, hits, impact, kick, line, midi, noiseSweep, reverb, snare, tone, fmTone, chorus, type Patch, type FmPatch } from '../engine';

const SUPERSAW: Patch = { osc: [{ wave: 'saw', voices: 7, detune: 22, spread: 0.9 }], amp: { a: 0.01, d: 0.3, s: 0.7, r: 0.25 }, filter: { type: 'lp', cutoff: 3500, q: 0.8, env: 1.5 }, gain: 0.25 };
const REESE: Patch = { osc: [{ wave: 'saw', cents: -14 }, { wave: 'saw', cents: 14 }], amp: { a: 0.005, d: 0.2, s: 0.9, r: 0.08 }, filter: { type: 'lp', cutoff: 380, q: 1.1, lfo: { rate: 0.4, depth: 0.8 } }, drive: 1, gain: 0.3 };
const ACID: Patch = { osc: [{ wave: 'saw', reset: true }], amp: { a: 0.002, d: 0.2, s: 0.6, r: 0.04 }, filter: { type: 'ladder', cutoff: 300, q: 0.82, env: 3.2, shape: { a: 0.002, d: 0.16, s: 0, r: 0.1 }, drive: 2 }, glide: 0.05, accent: 0.6, gain: 0.3 };
const EP: FmPatch = { ops: [{ ratio: 1, index: 1.6, decay: 0.5, sustain: 0.25, pan: -0.4, cents: -3 }, { ratio: 14, index: 0.5, decay: 0.08, pan: 0.4, cents: 3, level: 0.6 }], amp: { a: 0.003, d: 1.2, s: 0.3, r: 0.3 }, gain: 0.3 };

export default function build(): Song {
  const song = new Song({ title: 'Self test', slug: '_selftest', list: 'menu', bpm: 172, bars: 32, master: { target: -10 } });
  const { s, bar } = song;
  const hall = song.bus('hall', b => reverb(b, { decay: 2.6, size: 1.5, damp: 5000 }), -6);
  const echo = song.bus('echo', b => delay(b, { time: s(0.75), feedback: 0.4, pingpong: true }), -8);
  const kicks: number[] = [];
  const drums = song.track('drums', { gain: -4 });
  const k = kick();
  const sn = snare();
  const h = hat();
  const cl = clap();
  for (let b = 0; b < 8; b++) {
    for (const { step, level } of hits('x.....x...x.....')) { drums.add(bar(b, step / 4), k, { gain: level }); kicks.push(bar(b, step / 4)); }
    for (const { step, level } of hits('....x.......x...')) { drums.add(bar(b, step / 4), sn, { gain: level }); drums.add(bar(b, step / 4), cl, { gain: level * 0.4 }); }
    for (const { step, level } of hits('x.x.x.x.x.x.x.xo')) drums.add(bar(b, step / 4), h, { gain: level * 0.4 });
  }
  const loop = breakLoop(breakKit(), { bpm: 138, kick: 'x.....x...x.....|x..x......x.....', snare: '....x.......x...|....x..x....x...', ghost: '.......o.o.....o|.........o.....o', hat: 'x.x.x.x.x.x.x.x.', open: '..............x.', swing: 0.08 });
  const brk = song.track('break', { gain: -5 });
  for (let b = 8; b < 16; b += 2) brk.add(bar(b), () => chop(loop, b % 4 === 0 ? '0 1 2 3 4 5 6 7 | 8 9 10 11 12 13 14 15' : '0 1 2 3 4 4x2 6 7x4u7 | 8 9 2 3 12r 13 6x2 15', { bpm: song.bpm }), { key: `b${b % 4}` });
  const bass = song.track('reese', { gain: -6 }).fx(song.duck(kicks, { depth: 0.6, release: 0.15 }));
  for (let b = 8; b < 16; b += 2) bass.add(bar(b), () => line(REESE, [{ t: 0, dur: s(3), note: midi('F1') }, { t: s(3), dur: s(1), note: midi('Ab1'), slide: true }, { t: s(4), dur: s(4), note: midi('Eb1'), slide: true }]));
  const acid = song.track('acid', { gain: -8 }).send(echo, -10);
  for (let b = 16; b < 24; b++) {
    const notes = [0, 0, 12, 0, 3, 0, 10, 12, 0, 7, 0, 12, 15, 0, 10, 7].map((semi, i) => ({ t: s(i / 4), dur: s(0.2), note: midi('A1') + semi, accent: i % 5 === 0, slide: i % 3 === 2 }));
    acid.add(bar(b), () => line(ACID, notes, { mod: { cutoff: () => 1 + (b - 16) / 4 } }));
  }
  const saws = song.track('supersaw', { gain: -9 }).send(hall, -8).fx(b => chorus(b, { mix: 0.3 }));
  for (let b = 16; b < 24; b += 2) saws.add(bar(b), () => chordOf(SUPERSAW, chord('A3', 'm9'), s(7)));
  const keys = song.track('keys', { gain: -6 }).send(hall, -10);
  for (let b = 24; b < 32; b += 2) keys.add(bar(b), () => chordOf(EP, chord('F3', 'm9'), s(6), 0.8, { strum: 0.02 }));
  const lead = song.track('lead', { gain: -10 }).send(echo, -8);
  for (let b = 24; b < 32; b++) lead.add(bar(b, 1), () => tone(SUPERSAW, midi('C5') + (b % 4) * 2, s(1.5)));
  lead.add(bar(30), () => fmTone(EP, 84, s(2)));
  const fx = song.track('fx', { gain: -8 }).send(hall, -6);
  fx.add(bar(6), () => noiseSweep({ dur: s(8), from: 400, to: 9000 }));
  fx.add(bar(8), () => impact());
  fx.add(bar(8), () => crash(), { gain: 0.5 });
  song.section('drums', 0, 8);
  song.section('break+reese', 8, 16);
  song.section('acid+saws', 16, 24);
  song.section('keys+lead', 24, 32);
  return song;
}
