/**
 * The offline music renderer: note and timeline arithmetic, that each generator and effect does what its name says
 * (measured, since nothing here can listen), and that a render is the same bytes every time.
 */
import { describe, expect, it } from 'vitest';
import {
  SR, Rng, chord, degree, midi, mtof, hash, peakOf, rmsOf, toDb, dB,
  line, tone, chordOf, fmTone, type Patch, type FmPatch,
  kick, snare, clap, hat, crash, noiseSweep, impact, kickRumble, reversed, repitch,
  breakKit, breakLoop, chop, parseChop, hits, euclid,
  mixInto, silence, stereoOf, filt, drive, delay, reverb, compress, duckCurve, gateCurve, limit, softClip, monoBelow, widen, chorus, lengthOf,
  Song, Lane, loudness, bandBalance, estimateTempo, estimateKey, stereoStats, svf, fft, shaper,
} from './index';

const sine = (freq: number, seconds: number, amp = 1): Float32Array => {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  return out;
};

/** Frequency of the strongest partial, Hz. */
function loudestHz(buf: Float32Array, from = 0): number {
  const size = 16384;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < size; i++) re[i] = (buf[from + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  fft(re, im);
  let best = 1;
  let top = 0;
  for (let k = 1; k < size / 2; k++) {
    const p = re[k]! * re[k]! + im[k]! * im[k]!;
    if (p > top) {
      top = p;
      best = k;
    }
  }
  return (best * SR) / size;
}

const digest = (buf: Float32Array | [Float32Array, Float32Array]): number => {
  let h = 0x811c9dc5;
  for (const ch of Array.isArray(buf) ? buf : [buf]) {
    const bytes = new Uint8Array(ch.buffer, ch.byteOffset, ch.byteLength);
    for (let i = 0; i < bytes.length; i += 7) h = Math.imul(h ^ bytes[i]!, 0x01000193);
  }
  return h >>> 0;
};

describe('notes and scales', () => {
  it('names notes', () => {
    expect(midi('A4')).toBe(69);
    expect(midi('C3')).toBe(48);
    expect(midi('F#1')).toBe(30);
    expect(midi('Gb1')).toBe(30);
    expect(midi(61.5)).toBe(61.5);
    expect(() => midi('H2')).toThrow();
    expect(mtof(69)).toBeCloseTo(440, 6);
    expect(mtof(57)).toBeCloseTo(220, 6);
  });
  it('builds chords and inversions', () => {
    expect(chord('F3', 'm9')).toEqual([53, 56, 60, 63, 67]);
    expect(chord('C4', 'maj', 1)).toEqual([64, 67, 72]);
    expect(chord(60, [0, 7])).toEqual([60, 67]);
  });
  it('walks scale degrees past the octave in both directions', () => {
    expect(degree('A3', 'minor', 0)).toBe(57);
    expect(degree('A3', 'minor', 2)).toBe(60);
    expect(degree('A3', 'minor', 7)).toBe(69);
    expect(degree('A3', 'minor', -1)).toBe(55);
  });
  it('has repeatable random streams that do not disturb each other', () => {
    const a = new Rng(5);
    const b = new Rng(5);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
    const fork1 = new Rng(9).fork('x').next();
    const used = new Rng(9);
    const fork2 = used.fork('x').next();
    expect(fork1).toBe(fork2);
    expect(hash('a')).not.toBe(hash('b'));
  });
});

describe('automation lanes', () => {
  const lane = new Lane([[0, 100], [4, 400, 'exp'], [8, 400], [12, 0, 'hold'], [16, 1, 'ease']]);
  it('interpolates by the curve of the point it is arriving at', () => {
    expect(lane.at(-3)).toBe(100);
    expect(lane.at(2)).toBeCloseTo(200, 6);
    expect(lane.at(6)).toBe(400);
    expect(lane.at(11.9)).toBe(400);
    expect(lane.at(12)).toBe(0);
    expect(lane.at(14)).toBeCloseTo(0.5, 6);
    expect(lane.at(13)).toBeLessThan(0.25);
    expect(lane.at(99)).toBe(1);
  });
});

describe('voices', () => {
  const SAW: Patch = { osc: [{ wave: 'saw' }], amp: { a: 0.005, d: 0.1, s: 1, r: 0.05 } };
  it('plays the pitch it is asked for, on every waveform', () => {
    for (const wave of ['saw', 'square', 'tri', 'sine', 'pulse'] as const) {
      const buf = tone({ ...SAW, osc: [{ wave }] }, midi('A3'), 0.6) as Float32Array;
      expect(Math.abs(loudestHz(buf, 2000) - 220), wave).toBeLessThan(3);
    }
  });
  it('is mono without spread and stereo with it', () => {
    expect(Array.isArray(tone(SAW, 60, 0.2))).toBe(false);
    const wide = tone({ ...SAW, osc: [{ wave: 'saw', voices: 7, detune: 20, spread: 1 }] }, 60, 0.4);
    expect(Array.isArray(wide)).toBe(true);
    const st = stereoStats(wide as [Float32Array, Float32Array]);
    expect(st.correlation).toBeLessThan(0.9);
    expect(Math.abs(toDb(rmsOf((wide as Float32Array[])[0]!)) - toDb(rmsOf((wide as Float32Array[])[1]!)))).toBeLessThan(2.5);
  });
  it('renders the same samples every time', () => {
    const p: Patch = { osc: [{ wave: 'saw', voices: 5, detune: 15, spread: 0.8 }, { wave: 'noise', level: 0.1 }], amp: { a: 0.01, d: 0.2, s: 0.5, r: 0.1 }, filter: { type: 'lp', cutoff: 900, env: 2, q: 2 } };
    expect(digest(tone(p, 57, 0.5) as [Float32Array, Float32Array])).toBe(digest(tone(p, 57, 0.5) as [Float32Array, Float32Array]));
  });
  it('ends in silence and lasts the note plus its release', () => {
    const buf = tone({ ...SAW, amp: { a: 0.01, d: 0.1, s: 1, r: 0.2 } }, 60, 0.5) as Float32Array;
    expect(buf.length / SR).toBeGreaterThan(0.7);
    expect(buf.length / SR).toBeLessThan(0.8);
    expect(Math.abs(buf[buf.length - 1]!)).toBeLessThan(1e-4);
  });
  it('closes its filter as the envelope falls', () => {
    const p: Patch = { osc: [{ wave: 'saw' }], amp: { a: 0.002, d: 0.5, s: 1, r: 0.05 }, filter: { type: 'lp', cutoff: 200, env: 5, shape: { a: 0.002, d: 0.15, s: 0, r: 0.1 }, q: 1 } };
    const buf = tone(p, 45, 1) as Float32Array;
    const bright = (from: number): number => {
      const part = buf.slice(from, from + 8000);
      const high = part.slice();
      svf(high, 'hp', 2500);
      return toDb(rmsOf(high)) - toDb(rmsOf(part));
    };
    expect(bright(200) - bright(30000)).toBeGreaterThan(10);
  });
  it('slides between tied notes and retriggers between separate ones', () => {
    const p: Patch = { osc: [{ wave: 'sine' }], amp: { a: 0.002, d: 0.05, s: 1, r: 0.02 }, glide: 0.2 };
    const slid = line(p, [{ t: 0, dur: 0.3, note: 57 }, { t: 0.3, dur: 0.6, note: 69, slide: true }]) as Float32Array;
    // 50 ms into the second note a slide is still between the two pitches, and the level has not dipped.
    const mid = loudestHz(slid, Math.round(0.3 * SR));
    expect(mid).toBeGreaterThan(225);
    expect(mid).toBeLessThan(436);
    expect(Math.abs(loudestHz(slid, Math.round(0.5 * SR)) - 440)).toBeLessThan(6);
    const cut = line({ ...p, amp: { a: 0.002, d: 0.05, s: 1, r: 0.005 } }, [{ t: 0, dur: 0.25, note: 57 }, { t: 0.3, dur: 0.6, note: 69 }]) as Float32Array;
    expect(Math.abs(cut[Math.round(0.29 * SR)]!)).toBeLessThan(0.02);
  });
  it('makes FM tones at the note, brighter with more index', () => {
    const soft: FmPatch = { ops: [{ ratio: 1, index: 0.3 }], amp: { a: 0.005, d: 0.2, s: 1, r: 0.05 } };
    const hard: FmPatch = { ops: [{ ratio: 1, index: 4 }], amp: soft.amp };
    const a = fmTone(soft, 57, 0.6) as Float32Array;
    const b = fmTone(hard, 57, 0.6) as Float32Array;
    expect(Math.abs(loudestHz(a, 2000) - 220)).toBeLessThan(3);
    const top = (buf: Float32Array): number => {
      const h = buf.slice();
      svf(h, 'hp', 1500);
      return toDb(rmsOf(h));
    };
    expect(top(b) - top(a)).toBeGreaterThan(15);
  });
  it('stacks a chord in stereo', () => {
    const c = chordOf(SAW, [60, 64, 67], 0.3, 1, { strum: 0.01 });
    expect(c).toHaveLength(2);
    expect(c[0].length).toBeGreaterThan(0.3 * SR);
    expect(peakOf(c)).toBeGreaterThan(1);
  });
});

describe('drums and one-shots', () => {
  it('makes hits that peak at 1, start at once and end silent', () => {
    for (const [name, buf] of Object.entries({ kick: kick(), snare: snare(), clap: clap(), hat: hat(), rumble: kickRumble(kick()) })) {
      expect(peakOf(buf), name).toBeCloseTo(1, 3);
      expect(Math.abs(buf[buf.length - 1]!), name).toBeLessThan(1e-3);
      expect(buf.every(Number.isFinite), name).toBe(true);
    }
  });
  it('tunes the kick to its resting pitch and puts its weight in the lows', () => {
    const k = kick({ freq: 50, decay: 0.6, hold: 0.2, click: 0 });
    expect(Math.abs(loudestHz(k, 6000) - 50)).toBeLessThan(6);
    const low = k.slice();
    svf(low, 'lp', 200);
    expect(toDb(rmsOf(low)) - toDb(rmsOf(k))).toBeGreaterThan(-1.5);
  });
  it('keeps hats in the highs and claps in the mids', () => {
    const h = stereoOf(hat({ decay: 0.3 }));
    const bands = bandBalance(h);
    expect(bands[5]!.db + bands[6]!.db).toBeGreaterThan(bands[2]!.db + 40);
    const c = bandBalance(stereoOf(clap({ decay: 0.4 })));
    expect(c[3]!.db).toBeGreaterThan(c[1]!.db + 15);
  });
  it('gives a different hit for a different seed and the same for the same', () => {
    expect(digest(snare({ seed: 4 }))).toBe(digest(snare({ seed: 4 })));
    expect(digest(snare({ seed: 4 }))).not.toBe(digest(snare({ seed: 5 })));
  });
  it('sweeps noise upwards, wide', () => {
    const sw = noiseSweep({ dur: 2, from: 300, to: 9000 });
    const early = bandBalance(sw, SR, 0, SR / 2);
    const late = bandBalance(sw, SR, SR * 1.5, SR * 2);
    expect(late[5]!.db).toBeGreaterThan(early[5]!.db + 15);
    expect(stereoStats(sw).correlation).toBeLessThan(0.3);
    expect(rmsOf([sw[0].slice(SR * 1.5), sw[1].slice(SR * 1.5)])).toBeGreaterThan(rmsOf([sw[0].slice(0, SR / 2), sw[1].slice(0, SR / 2)]) * 3);
  });
  it('makes stereo impacts and crashes, and reverses and repitches', () => {
    expect(peakOf(impact())).toBeCloseTo(1, 3);
    const cr = crash();
    expect(peakOf(cr)).toBeCloseTo(1, 3);
    const rev = reversed(cr);
    expect(rev[0][0]).toBe(cr[0][cr[0].length - 1]);
    const k = kick();
    expect(repitch(k, 12).length).toBe(Math.floor(k.length / 2));
  });
});

describe('breaks', () => {
  const kit = breakKit({ seed: 3 });
  const spec = { bpm: 140, kick: 'x.....x...x.....', snare: '....x.......x...', ghost: '.......o.o.....o', hat: 'x.x.x.x.x.x.x.x.' };
  const loop = breakLoop(kit, spec);
  it('makes a loop exactly as long as its bars, the same every time', () => {
    expect(loop.buf[0].length).toBe(Math.round(32 * (60 / 140 / 4) * SR));
    expect(loop.beats).toBe(8);
    expect(peakOf(loop.buf)).toBeCloseTo(1, 3);
    expect(digest(breakLoop(kit, spec).buf)).toBe(digest(loop.buf));
  });
  it('has no seam: the tail of the last hit is in the first samples', () => {
    const open = breakLoop(kit, { ...spec, kick: '................', snare: '...............x', ghost: '', hat: '', room: 0.5, roomDecay: 0.6 });
    const start = rmsOf([open.buf[0].slice(0, 2000), open.buf[1].slice(0, 2000)]);
    expect(start).toBeGreaterThan(0.01);
  });
  it('parses chop patterns', () => {
    expect(parseChop('0 _ 2 - 4x3 5r 6p-5 7x4u7 8g50h | 9x2d12')).toEqual([
      { slice: 0, len: 2 },
      { slice: 2, len: 1 },
      { slice: null, len: 1 },
      { slice: 4, len: 1, retrig: 3 },
      { slice: 5, len: 1, reverse: true },
      { slice: 6, len: 1, pitch: -5 },
      { slice: 7, len: 1, retrig: 4, ramp: 7 },
      { slice: 8, len: 1, gain: 0.5, gate: 0.5 },
      { slice: 9, len: 1, retrig: 2, ramp: -12 },
    ]);
    expect(() => parseChop('zz')).toThrow();
    expect(() => parseChop('_ 1')).toThrow();
  });
  it('chops to the length of the pattern at the song tempo, with rests silent', () => {
    const out = chop(loop, '0 1 - 3 | 4 5x2 6r 7x4u12', { bpm: 174 });
    const step = (0.5 * 60 * SR) / 174;
    expect(out[0].length).toBe(Math.round(8 * step));
    const rest = out[0].slice(Math.round(2 * step) + 10, Math.round(3 * step) - 10);
    expect(peakOf(rest)).toBe(0);
    expect(peakOf(out)).toBeGreaterThan(0.3);
  });
  it('plays the loop back unchanged in order at its own tempo', () => {
    const out = chop(loop, '0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15', { bpm: 140, fade: 0.0002 });
    let err = 0;
    let ref = 0;
    for (let i = 0; i < out[0].length; i++) {
      err += (out[0][i]! - loop.buf[0][i]!) ** 2;
      ref += loop.buf[0][i]! ** 2;
    }
    expect(err / ref).toBeLessThan(0.02);
  });
  it('reads patterns and spreads euclidean hits', () => {
    expect(hits('X.o.|..5.')).toEqual([{ step: 0, level: 1 }, { step: 2, level: 0.5 }, { step: 6, level: 5 / 9 }]);
    expect(euclid(4, 16)).toBe('...x...x...x...x');
    expect(euclid(3, 8).split('x').length - 1).toBe(3);
    expect(euclid(4, 16, 1)).toBe('x...x...x...x...');
  });
});

describe('shapers', () => {
  it('pass silence as silence, stay bounded, and leave quiet signal nearly alone', () => {
    for (const name of ['tanh', 'hard', 'soft', 'fold', 'asym', 'diode'] as const) {
      const f = shaper(name);
      expect(Math.abs(f(0)), name).toBeLessThan(1e-9);
      for (let x = -6; x <= 6; x += 0.01) expect(Math.abs(f(x)), `${name} at ${x}`).toBeLessThanOrEqual(1.25);
      expect(f(0.3), name).toBeGreaterThan(0.15);
      expect(f(-0.3), name).toBeLessThan(-0.15);
    }
    expect(shaper('fold')(1)).toBeCloseTo(1, 6);
    expect(shaper('fold')(2)).toBeCloseTo(0, 6);
    expect(shaper('fold')(0.4)).toBeCloseTo(0.4, 6);
  });
});

describe('effects', () => {
  it('mixes with negative offsets and past the end', () => {
    const dst = silence(10);
    mixInto(dst, new Float32Array([1, 1, 1, 1]), -2, 0.5);
    mixInto(dst, [new Float32Array([1, 1, 1]), new Float32Array([2, 2, 2])], 8);
    expect(Array.from(dst[0])).toEqual([0.5, 0.5, 0, 0, 0, 0, 0, 0, 1, 1].map(v => (v === 0.5 ? expect.closeTo(0.5, 5) : v)));
    expect(dst[1][9]).toBe(2);
  });
  it('filters', () => {
    const high = stereoOf(sine(5000, 0.5));
    filt(high, 'lp', 500, 0.707, 4);
    expect(toDb(rmsOf(high))).toBeLessThan(-50);
    const low = stereoOf(sine(100, 0.5));
    filt(low, 'lp', 500);
    expect(toDb(rmsOf(low))).toBeGreaterThan(-3.5);
  });
  it('saturates: louder in, more harmonics, bounded out', () => {
    const buf = stereoOf(sine(200, 0.5, 0.5));
    drive(buf, { amount: 24, out: 0 });
    expect(peakOf(buf)).toBeLessThanOrEqual(1);
    const h = buf[0].slice();
    svf(h, 'hp', 500);
    expect(toDb(rmsOf(h))).toBeGreaterThan(-20);
  });
  it('echoes at the delay time', () => {
    const buf = silence(SR);
    buf[0][0] = 1;
    buf[1][0] = 1;
    delay(buf, { time: 0.25, feedback: 0.5, lp: 20000, hp: 5 });
    expect(Math.abs(buf[0][Math.round(0.25 * SR)]!)).toBeGreaterThan(0.5);
    expect(Math.abs(buf[0][Math.round(0.5 * SR)]!)).toBeGreaterThan(0.15);
    expect(Math.abs(buf[0][Math.round(0.125 * SR)]!)).toBeLessThan(1e-6);
  });
  it('makes a reverb tail that decays over about the time asked, different in each ear', () => {
    const buf = silence(SR * 4);
    for (let i = 0; i < 200; i++) buf[0][i] = buf[1][i] = Math.sin(i * 0.3);
    reverb(buf, { decay: 1.5, hp: 0 });
    const level = (t: number): number => toDb(rmsOf([buf[0].slice(Math.round(t * SR), Math.round((t + 0.2) * SR)), buf[1].slice(Math.round(t * SR), Math.round((t + 0.2) * SR))]));
    const drop = level(0.2) - level(1.7);
    expect(drop).toBeGreaterThan(40);
    expect(drop).toBeLessThan(85);
    expect(Math.abs(stereoStats(buf).correlation)).toBeLessThan(0.5);
    expect(buf[0].every(Number.isFinite)).toBe(true);
  });
  it('compresses loud more than quiet', () => {
    const loud = stereoOf(sine(300, 1, 0.9));
    const quiet = stereoOf(sine(300, 1, 0.05));
    const stats = { maxReduction: 0 };
    compress(loud, { threshold: -20, ratio: 4, knee: 0 }, stats);
    compress(quiet, { threshold: -20, ratio: 4, knee: 0 });
    expect(stats.maxReduction).toBeGreaterThan(12);
    expect(toDb(peakOf([loud[0].slice(SR / 2), loud[1].slice(SR / 2)]))).toBeLessThan(-12);
    expect(peakOf(quiet)).toBeCloseTo(0.05, 3);
  });
  it('draws a pump curve on the song clock', () => {
    const c = duckCurve(SR, 10, [10.5], { depth: 0.8, attack: 0.005, hold: 0.02, release: 0.2 });
    const at = (t: number): number => c[Math.round(((t - 10) * SR) / 16)]!;
    expect(at(10.2)).toBe(1);
    expect(at(10.52)).toBeCloseTo(0.2, 2);
    expect(at(10.6)).toBeGreaterThan(0.2);
    expect(at(10.6)).toBeLessThan(1);
    expect(at(10.8)).toBe(1);
  });
  it('gates on the grid', () => {
    const g = gateCurve(SR, 0, 0.125, 'x.x.', { smooth: 0.001 });
    const at = (t: number): number => g[Math.round((t * SR) / 16)]!;
    expect(at(0.05)).toBeGreaterThan(0.95);
    expect(at(0.2)).toBeLessThan(0.05);
    expect(at(0.3)).toBeGreaterThan(0.95);
  });
  it('limits to the ceiling exactly, and leaves what is under it alone', () => {
    const rng = new Rng(3);
    const buf = silence(SR);
    for (let i = 0; i < SR; i++) {
      buf[0][i] = rng.bi() * (i % 5000 < 300 ? 3 : 0.4);
      buf[1][i] = rng.bi() * 0.4;
    }
    const stats = { maxReduction: 0, share: 0, meanReduction: 0 };
    limit(buf, { ceiling: 0.8 }, stats);
    expect(peakOf(buf)).toBeLessThanOrEqual(0.8 + 1e-6);
    expect(stats.maxReduction).toBeGreaterThan(8);
    const calm = stereoOf(sine(300, 0.5, 0.5));
    const before = digest(calm);
    limit(calm, { ceiling: 0.8 });
    expect(digest(calm)).toBe(before);
  });
  it('soft clips without passing the ceiling by more than the filter ripple, and passes quiet signal', () => {
    const hot = stereoOf(sine(220, 0.5, 2));
    softClip(hot, 0.6, 0.9);
    expect(peakOf(hot)).toBeLessThan(0.99);
    expect(peakOf(hot)).toBeGreaterThan(0.8);
    const calm = stereoOf(sine(220, 0.5, 0.3));
    softClip(calm, 0.6, 0.9);
    const ref = sine(220, 0.5, 0.3);
    let err = 0;
    for (let i = 100; i < ref.length - 100; i++) err = Math.max(err, Math.abs(calm[0][i]! - ref[i]!));
    expect(err).toBeLessThan(2e-3);
  });
  it('makes the lows mono and leaves the highs wide', () => {
    const buf: [Float32Array, Float32Array] = [sine(60, 1), sine(60, 1).map(v => -v)];
    const top = sine(4000, 1, 0.5);
    for (let i = 0; i < top.length; i++) {
      buf[0][i] += top[i]!;
      buf[1][i] -= top[i]!;
    }
    monoBelow(buf, 150);
    const low: [Float32Array, Float32Array] = [buf[0].slice(), buf[1].slice()];
    filt(low, 'lp', 120, 0.707, 4);
    expect(toDb(rmsOf(low))).toBeLessThan(-25);
    expect(stereoStats(buf).correlation).toBeLessThan(-0.9);
    const w = stereoOf(sine(300, 0.2));
    w[1].fill(0);
    widen(w, 0);
    expect(w[0][500]).toBeCloseTo(w[1][500]!, 6);
  });
  it('decorrelates with chorus', () => {
    const buf = stereoOf(tone({ osc: [{ wave: 'saw' }], amp: { a: 0.01, d: 0.1, s: 1, r: 0.05 } }, 57, 1) as Float32Array);
    chorus(buf, { mix: 0.5, depth: 0.004 });
    expect(stereoStats(buf).correlation).toBeLessThan(0.98);
    expect(lengthOf(buf)).toBeGreaterThan(SR);
  });
});

describe('meters', () => {
  it('reads loudness as the standard defines it', () => {
    // BS.1770: a 1 kHz sine at -20 dBFS in both channels reads -20 LUFS.
    const buf = stereoOf(sine(1000, 5, dB(-20)));
    expect(loudness(buf).integrated).toBeCloseTo(-20, 1);
    // Left only is 3.01 lower.
    const left: [Float32Array, Float32Array] = [sine(1000, 5, dB(-20)), new Float32Array(5 * SR)];
    expect(loudness(left).integrated).toBeCloseTo(-23.01, 1);
    // The weighting turns the lows down: 50 Hz at the same level reads much quieter.
    expect(loudness(stereoOf(sine(50, 5, dB(-20)))).integrated).toBeLessThan(-24);
  });
  it('gates silence out of the integrated figure', () => {
    const tone1 = sine(1000, 4, dB(-20));
    const padded = new Float32Array(12 * SR);
    padded.set(tone1, 4 * SR);
    expect(loudness([padded, padded.slice()]).integrated).toBeCloseTo(-20, 0);
  });
  it('finds the tempo of a click and the key of a scale', () => {
    const bpm = 174;
    const buf = silence(SR * 12);
    const k = kick();
    const h = hat();
    for (let beat = 0; beat * 60 / bpm < 11.5; beat += 0.5) {
      const at = Math.round((beat * 60 * SR) / bpm);
      mixInto(buf, beat % 1 === 0 ? k : h, at, beat % 1 === 0 ? 0.8 : 0.3);
    }
    expect(Math.abs(estimateTempo(buf).bpm - bpm)).toBeLessThan(1);
    const scale = silence(SR * 8);
    const p: Patch = { osc: [{ wave: 'tri' }], amp: { a: 0.01, d: 0.2, s: 0.8, r: 0.1 } };
    [57, 59, 60, 62, 64, 65, 67, 69, 57, 60, 64, 57, 64, 57, 69, 57].forEach((n, i) => mixInto(scale, tone(p, n, 0.45), Math.round(i * 0.5 * SR), 0.5));
    expect(['A minor', 'C major']).toContain(estimateKey(scale).key);
  });
});

describe('song', () => {
  const build = (): Song => {
    const song = new Song({ title: 'Test', slug: 'test', list: 'menu', bpm: 120, bars: 4, tail: 0.5, master: { target: -12 } });
    const hall = song.bus('hall', b => reverb(b, { decay: 0.6 }), -10);
    const drums = song.track('drums', { gain: -3 });
    const k = kick();
    for (let b = 0; b < 16; b++) drums.add(b, k);
    const pad = song.track('pad', { gain: -8 }).send(hall, -6).fx(song.duck([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], { depth: 0.5 }));
    pad.add(0, () => chordOf({ osc: [{ wave: 'saw', voices: 3, detune: 12, spread: 0.7 }], amp: { a: 0.05, d: 0.3, s: 0.8, r: 0.2 }, filter: { type: 'lp', cutoff: 1800 }, gain: 0.3 }, chord('A3', 'm7'), song.s(15)));
    song.section('all', 0, 4);
    return song;
  };
  it('counts in beats and bars', () => {
    const song = build();
    expect(song.s(2)).toBe(1);
    expect(song.bar(3, 1.5)).toBe(13.5);
    expect(song.seconds).toBe(8);
    expect(song.rng('a').next()).toBe(build().rng('a').next());
    expect(() => song.track('drums')).toThrow();
  });
  it('lands on the target loudness under the ceiling, the same bytes every time', () => {
    const a = build().render();
    const b = build().render();
    expect(a.buf[0].length).toBe(Math.round(8.5 * SR));
    expect(Math.abs(a.master.lufs - -12)).toBeLessThan(0.4);
    expect(a.master.peakDb).toBeLessThanOrEqual(-1 + 1e-3);
    expect(digest(a.buf)).toBe(digest(b.buf));
    expect(a.tracks.map(t => t.name)).toEqual(['drums', 'pad', 'bus:hall']);
    expect(a.tracks[0]!.clips).toBe(16);
  });
  it('renders a range of bars, with what was already ringing', () => {
    const part = build().render({ from: 2, to: 3 });
    expect(part.buf[0].length).toBe(Math.round(2.5 * SR));
    expect(part.tracks[0]!.clips).toBe(12);
    // The pad started at bar 0 and is still sounding at the first sample of bar 2.
    const solo = build().render({ from: 2, to: 3, solo: ['pad'] });
    expect(toDb(rmsOf([solo.buf[0].slice(0, 2000), solo.buf[1].slice(0, 2000)]))).toBeGreaterThan(-40);
    expect(solo.tracks.find(t => t.name === 'drums')).toBeUndefined();
  });
  it('plays a group through its own effects and caches keyed clips', () => {
    const song = new Song({ title: 'G', slug: 'g', list: 'menu', bpm: 120, bars: 1, tail: 0.1, master: { target: -14 } });
    const group = song.track('group').fx(b => {
      b[1].fill(0);
    });
    let made = 0;
    const child = song.track('child', { out: group });
    for (let b = 0; b < 4; b++) child.add(b, () => { made++; return kick(); }, { key: 'k' });
    const res = song.render();
    expect(made).toBe(1);
    expect(peakOf(res.buf[0])).toBeGreaterThan(0.1);
    expect(res.tracks.map(t => t.name)).toEqual(['child', 'group']);
  });
});
