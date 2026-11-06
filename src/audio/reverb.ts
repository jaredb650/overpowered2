/**
 * Zone reverbs. Impulse responses are generated rather than sampled, so each room is a set of numbers
 * that can be tuned: how long it rings, how fast the highs die, where its first walls are.
 */
import { mulberry32 } from '../core/math';

export interface RoomSpec {
  /** Decay to -60 dB at low, mid and high frequencies, in seconds. */
  t60: readonly [low: number, mid: number, high: number];
  /** Silence before the first wall answers. Big rooms have long ones. */
  preDelay: number;
  /** First reflections as [seconds, gain]. These are what place you in a shape. */
  early: readonly (readonly [number, number])[];
  /** Return level. Halls return more. */
  wet: number;
  /** Repeating slap for long parallel walls, as [period, feedback]. */
  flutter?: readonly [number, number];
}

/**
 * The longest impulse, in seconds. Convolution work grows with length, and 8 s of Foundry cost about three times
 * what this does. Past here the tail is 30 dB down or more, under a game that never stops making noise.
 */
const MAX_IMPULSE = 4;
/** The tail is faded over this long, so the cut is not heard as a cut. */
const IMPULSE_FADE = 0.4;

/** Keyed by zone id. Missing or unknown zones use `core`. */
export const ROOMS = {
  /** Sunken concrete drum around the reactor: long, round, a slap from the far wall. */
  core: { t60: [4.2, 3.4, 1.6], preDelay: 0.045, wet: 0.9, early: [[0.06, 0.5], [0.11, 0.42], [0.19, 0.34], [0.31, 0.25]] },
  /** The huge hall. Long pre-delay, six seconds of tail, dark. It should sound like a cathedral. */
  foundry: { t60: [7.5, 5.8, 2.2], preDelay: 0.11, wet: 1.2, early: [[0.14, 0.42], [0.23, 0.36], [0.37, 0.3], [0.52, 0.24], [0.71, 0.18]] },
  /** Tanks and pipes: short, bright, metallic. */
  refinery: { t60: [1.6, 1.9, 1.4], preDelay: 0.014, wet: 0.65, early: [[0.018, 0.6], [0.031, 0.5], [0.047, 0.42], [0.066, 0.3]], flutter: [0.023, 0.5] },
  /** Open ground: almost no tail, one distant slap off the container stacks. */
  scrapyard: { t60: [0.9, 0.7, 0.35], preDelay: 0.02, wet: 0.3, early: [[0.09, 0.32], [0.22, 0.22], [0.42, 0.12]] },
  /** Tunnel: a long throat with a fluttering standing echo. */
  transit: { t60: [3, 2.6, 1], preDelay: 0.022, wet: 0.85, early: [[0.03, 0.55], [0.06, 0.48], [0.09, 0.4], [0.12, 0.34]], flutter: [0.058, 0.62] },
  /** Elevated road in open air. */
  ring: { t60: [1.1, 0.8, 0.4], preDelay: 0.03, wet: 0.22, early: [[0.14, 0.2], [0.35, 0.12]] },
} as const satisfies Record<string, RoomSpec>;

export type RoomId = keyof typeof ROOMS;
export const ROOM_IDS = Object.keys(ROOMS) as RoomId[];

/** Maps whatever a world names its zones to a room. */
export function roomForZone(zoneId: string | null | undefined): RoomId {
  if (!zoneId) return 'core';
  const key = zoneId.toLowerCase();
  for (const id of ROOM_IDS) if (key.includes(id)) return id;
  return 'core';
}

/**
 * Builds one stereo impulse response. Late energy is three bands of decorrelated noise, each with its
 * own decay, which is the cheap way to get real rooms' darkening tail.
 */
export function generateImpulse(spec: RoomSpec, sampleRate: number, seed: number): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const longest = Math.max(...spec.t60);
  const length = Math.floor(Math.min(longest * 1.05 + spec.preDelay, MAX_IMPULSE) * sampleRate);
  const start = Math.floor(spec.preDelay * sampleRate);
  const channels: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(length), new Float32Array(length)];
  const lowCoef = 1 - Math.exp((-2 * Math.PI * 350) / sampleRate);
  const highCoef = 1 - Math.exp((-2 * Math.PI * 3000) / sampleRate);
  const k = (t60: number) => Math.exp(-6.9078 / (t60 * sampleRate));
  const kLow = k(spec.t60[0]);
  const kMid = k(spec.t60[1]);
  const kHigh = k(spec.t60[2]);

  channels.forEach((data, c) => {
    const rnd = mulberry32(seed * 2 + c + 1);
    let lowState = 0;
    let midState = 0;
    let gLow = 1;
    let gMid = 1;
    let gHigh = 1;
    // Late energy builds in over the first stretch: a diffuse tail never starts at full density.
    const build = Math.floor(0.03 * sampleRate);
    for (let i = start; i < length; i++) {
      const w = rnd() * 2 - 1;
      lowState += (w - lowState) * lowCoef;
      midState += (w - midState) * highCoef;
      const low = lowState;
      const mid = midState - lowState;
      const high = w - midState;
      const onset = i - start < build ? (i - start) / build : 1;
      data[i] = (low * 1.8 * gLow + mid * gMid + high * 0.5 * gHigh) * onset;
      gLow *= kLow;
      gMid *= kMid;
      gHigh *= kHigh;
    }
    for (const [t, gain] of spec.early) {
      const at = Math.floor((t * (1 + (c ? 0.03 : -0.03))) * sampleRate);
      const wobble = c ? 1 : 0.85;
      if (at < length) data[at] = data[at]! + gain * 2.4 * wobble;
    }
    if (spec.flutter) {
      const [period, feedback] = spec.flutter;
      let gain = 1.2;
      for (let t = start + period * sampleRate; t < length && gain > 0.01; t += period * sampleRate) {
        const at = Math.floor(t);
        data[at] = data[at]! + gain * (rnd() < 0.5 ? -1 : 1);
        gain *= feedback;
      }
    }
  });

  const fade = Math.floor(IMPULSE_FADE * sampleRate);
  for (const data of channels) {
    for (let i = 0; i < fade; i++) data[length - 1 - i] = data[length - 1 - i]! * (i / fade);
  }

  // Equal energy across rooms: the `wet` value then says how loud a room is, not how long.
  let energy = 0;
  for (const data of channels) for (let i = 0; i < length; i++) energy += data[i]! * data[i]!;
  const scale = 1 / Math.sqrt(Math.max(energy / 2, 1e-9));
  for (const data of channels) for (let i = 0; i < length; i++) data[i] = data[i]! * scale;
  return channels;
}

/** Schroeder backward integration: the measured time from -5 dB to -35 dB, extrapolated to -60. */
export function measureT60(data: Float32Array, sampleRate: number): number {
  const energy = new Float64Array(data.length);
  let sum = 0;
  for (let i = data.length - 1; i >= 0; i--) {
    sum += data[i]! * data[i]!;
    energy[i] = sum;
  }
  const total = energy[0]!;
  let t5 = 0;
  let t35 = 0;
  for (let i = 0; i < data.length; i++) {
    const db = 10 * Math.log10(energy[i]! / total);
    if (!t5 && db <= -5) t5 = i;
    if (db <= -35) { t35 = i; break; }
  }
  return t35 > t5 ? ((t35 - t5) / sampleRate) * 2 : 0;
}
