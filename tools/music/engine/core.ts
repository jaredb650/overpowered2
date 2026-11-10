/**
 * Shared types and small helpers for the offline music renderer. Everything in tools/music is plain Node: no Web Audio,
 * no samples, no randomness that is not seeded.
 */
export const SR = 44100;
export const TAU = Math.PI * 2;

export type Mono = Float32Array;
export type Stereo = [Float32Array, Float32Array];
export type Buf = Mono | Stereo;

export const isStereo = (b: Buf): b is Stereo => Array.isArray(b);

export const dB = (v: number): number => Math.pow(10, v / 20);
export const toDb = (v: number): number => 20 * Math.log10(Math.max(1e-12, v));
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** MIDI note number to Hz. 69 is A4 at 440. */
export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const secs = (seconds: number, sr = SR): number => Math.max(1, Math.round(seconds * sr));

/** Seeded generator (mulberry32). Every random choice in a render comes from one of these. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = (seed >>> 0) || 0x9e3779b9;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** -1 to 1. */
  bi(): number {
    return this.next() * 2 - 1;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  pick<T>(list: readonly T[]): T {
    return list[this.int(list.length)]!;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  /** A separate stream that does not depend on how much this one has been used. */
  fork(label: string | number): Rng {
    return new Rng(hash(`${this.s}:${label}`));
  }
}

/** FNV-1a, for seeds from names. */
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const NOTE_INDEX: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** 'C3' is 48, 'A4' is 69, 'F#1' and 'Gb1' are 30. Numbers pass through, so fractional notes work. */
export function midi(name: string | number): number {
  if (typeof name === 'number') return name;
  const m = /^([a-gA-G])([#b]?)(-?\d+)$/.exec(name.trim());
  if (!m) throw new Error(`Not a note name: "${name}"`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + NOTE_INDEX[m[1]!.toLowerCase()]! + acc;
}

export const CHORDS = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  power: [0, 7, 12],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  m6: [0, 3, 7, 9],
  six: [0, 4, 7, 9],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14],
  sixnine: [0, 4, 7, 9, 14],
  m11: [0, 3, 7, 10, 14, 17],
  sus9: [0, 5, 7, 10, 14],
} as const;
export type ChordName = keyof typeof CHORDS;

/** Chord tones as MIDI numbers. `inv` moves that many of the lowest tones up an octave. */
export function chord(root: string | number, quality: ChordName | readonly number[], inv = 0): number[] {
  const base = midi(root);
  const steps = typeof quality === 'string' ? CHORDS[quality] : quality;
  const tones = steps.map(s => base + s);
  for (let i = 0; i < inv; i++) tones.push(tones.shift()! + 12);
  return tones;
}

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
  pentMinor: [0, 3, 5, 7, 10],
  pentMajor: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
} as const;
export type ScaleName = keyof typeof SCALES;

/** Degree `d` of a scale as a MIDI number. Degrees run past the octave in both directions: 7 is the root an octave up. */
export function degree(root: string | number, name: ScaleName, d: number): number {
  const steps = SCALES[name];
  const n = steps.length;
  const oct = Math.floor(d / n);
  return midi(root) + 12 * oct + steps[((d % n) + n) % n]!;
}

/** Equal-power pan gains for -1 (left) to 1 (right). */
export function panGains(pan: number): [number, number] {
  const a = (clamp(pan, -1, 1) + 1) * 0.25 * Math.PI;
  return [Math.cos(a), Math.sin(a)];
}

export function peakOf(b: Buf): number {
  let p = 0;
  for (const ch of isStereo(b) ? b : [b]) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i]! < 0 ? -ch[i]! : ch[i]!;
      if (v > p) p = v;
    }
  }
  return p;
}

export function rmsOf(b: Buf): number {
  let sum = 0;
  let n = 0;
  for (const ch of isStereo(b) ? b : [b]) {
    for (let i = 0; i < ch.length; i++) sum += ch[i]! * ch[i]!;
    n += ch.length;
  }
  return Math.sqrt(sum / Math.max(1, n));
}

/** Scales in place and returns the buffer. */
export function scaleBuf<T extends Buf>(b: T, gain: number): T {
  for (const ch of isStereo(b) ? b : [b as Mono]) for (let i = 0; i < ch.length; i++) ch[i] = ch[i]! * gain;
  return b;
}

/** Linear fades at both ends, in place. Stops clicks on anything cut by a gate. */
export function fadeEdges<T extends Buf>(b: T, inSamples: number, outSamples: number): T {
  for (const ch of isStereo(b) ? b : [b as Mono]) {
    const n = ch.length;
    const fi = Math.min(inSamples, n);
    const fo = Math.min(outSamples, n);
    for (let i = 0; i < fi; i++) ch[i] = ch[i]! * (i / fi);
    for (let i = 0; i < fo; i++) ch[n - 1 - i] = ch[n - 1 - i]! * (i / fo);
  }
  return b;
}
