/**
 * The timeline. A song is tracks of clips placed on beats, effect chains on those tracks, send buses, automation lanes
 * and a master chain. Clips are usually functions, called only when their track is mixed, so a three-minute song never
 * holds more than a few full-length buffers in memory and a part of it can be rendered without the rest.
 *
 * Units: positions on the timeline are beats (bar 0, beat 0 is the start). Lengths handed to instruments are seconds:
 * use `song.s(beats)`.
 */
import { SR, Rng, dB, toDb, hash, type Buf, type Stereo } from './core';
import { CR, type FilterMode } from './dsp';
import { applyCurve, compress, duckCurve, eq, filt, gateCurve, limit, mixInto, monoBelow, softClip, widen, type CompOpts, type DuckOpts, type EqBand } from './fx';
import { loudness, samplePeak } from './meter';

export type Curve = 'lin' | 'exp' | 'hold' | 'ease';
/** `[beat, value, curve]`. The curve says how the value arrives at this point from the one before. */
export type Point = [number, number, Curve?];

/** A value that changes over the song: breakpoints on beats, read at any beat. */
export class Lane {
  private readonly pts: Point[];
  constructor(points: readonly Point[]) {
    if (!points.length) throw new Error('A lane needs at least one point');
    this.pts = [...points].sort((a, b) => a[0] - b[0]);
  }
  at(beat: number): number {
    const p = this.pts;
    if (beat <= p[0][0]) return p[0][1];
    const last = p[p.length - 1];
    if (beat >= last[0]) return last[1];
    let lo = 0;
    let hi = p.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (p[mid][0] <= beat) lo = mid;
      else hi = mid;
    }
    const [b0, v0] = p[lo];
    const [b1, v1, curve] = p[hi];
    const x = (beat - b0) / (b1 - b0);
    switch (curve) {
      case 'hold':
        return v0;
      case 'exp':
        return v0 > 0 && v1 > 0 ? v0 * Math.pow(v1 / v0, x) : v0 + (v1 - v0) * x;
      case 'ease':
        return v0 + (v1 - v0) * (x * x * (3 - 2 * x));
      default:
        return v0 + (v1 - v0) * x;
    }
  }
}

export interface FxCtx {
  song: Song;
  /** Song time in seconds of the buffer's first sample. Not zero when only part of the song is rendered. */
  t0: number;
  n: number;
  /** A lane as one value per CR samples, lined up with the buffer. */
  curve(lane: Lane): Float32Array;
}
export type Fx = (buf: Stereo, c: FxCtx) => Stereo | void;

type Clip = Buf | (() => Buf);
interface Ev {
  beat: number;
  clip: Clip;
  gain: number;
  pan: number;
  key?: string;
}

export interface AddOpts {
  /** Linear level, 1 by default. */
  gain?: number;
  pan?: number;
  /** Clips added with the same key are rendered once and reused. Only for clip functions. */
  key?: string;
}

export interface TrackOpts {
  /** Fader in dB. */
  gain?: number;
  pan?: number;
  /** Another track (a group) to play into instead of the master. */
  out?: Track;
  mute?: boolean;
}

export class Track {
  readonly events: Ev[] = [];
  readonly chain: Fx[] = [];
  readonly sends: { bus: Bus; amount: number | Lane }[] = [];
  gain: number;
  pan: number;
  out: Track | null;
  mute: boolean;
  constructor(readonly name: string, o: TrackOpts = {}) {
    this.gain = o.gain ?? 0;
    this.pan = o.pan ?? 0;
    this.out = o.out ?? null;
    this.mute = o.mute ?? false;
  }
  /** Places a clip at `beat`. Pass a function for anything synthesized per note, so it is only made when needed. */
  add(beat: number, clip: Clip, o: AddOpts = {}): this {
    this.events.push({ beat, clip, gain: o.gain ?? 1, pan: o.pan ?? 0, key: o.key });
    return this;
  }
  /** Appends insert effects, run in order over the whole track before its fader. */
  fx(...fns: Fx[]): this {
    this.chain.push(...fns);
    return this;
  }
  /** Sends the track, after its fader, to a bus. `amount` is dB, or a lane of linear gain. */
  send(bus: Bus, amount: number | Lane): this {
    this.sends.push({ bus, amount });
    return this;
  }
}

export class Bus {
  readonly chain: Fx[];
  gain: number;
  constructor(readonly name: string, chain: Fx[], gainDb: number) {
    this.chain = chain;
    this.gain = gainDb;
  }
}

export interface MasterOpts {
  /** Integrated loudness to land on, LUFS. */
  target: number;
  /** Sample ceiling in dB. MP3 encoding overshoots by up to a dB, so leave room. */
  ceiling: number;
  /** High-pass, Hz. */
  hp: number;
  /** The side signal is removed below this, Hz. */
  monoBelow: number;
  eq: EqBand[];
  /** A slow compressor over the mix, or null for none. */
  glue: CompOpts | null;
  /** dB below the ceiling where the clipper starts to round peaks off. 0 turns the clipper off. */
  clipKnee: number;
  /** Stereo width of the whole mix. 1 leaves it alone. */
  width: number;
  limiter: { lookahead: number; release: number };
}

export interface SongOpts {
  title: string;
  /** File name without extension. */
  slug: string;
  list: 'menu' | 'easy' | 'hard';
  bpm: number;
  bars: number;
  beatsPerBar?: number;
  seed?: string | number;
  /** Seconds after the last bar for tails to ring out. */
  tail?: number;
  /** For the notes only. */
  key?: string;
  master?: Partial<MasterOpts>;
}

export interface TrackStat {
  name: string;
  peakDb: number;
  rmsDb: number;
  /** Seconds of CPU spent on its clips and effects. */
  cpu: number;
  clips: number;
}

export interface RenderResult {
  buf: Stereo;
  tracks: TrackStat[];
  master: {
    lufs: number;
    shortTermMax: number;
    range: number;
    peakDb: number;
    /** dB of gain the master added before the clipper to reach the target. */
    pushDb: number;
    limiterMaxDb: number;
    limiterMeanDb: number;
    limiterShare: number;
    glueMaxDb: number;
    preLufs: number;
  };
  seconds: number;
  cpu: number;
  fromBar: number;
  toBar: number;
}

export interface RenderOpts {
  /** Bars to render, `to` exclusive. The whole song by default. */
  from?: number;
  to?: number;
  /** Only these tracks (by name), for hearing or measuring a part alone. Buses still run. */
  solo?: string[];
  log?: (line: string) => void;
}

const DEFAULT_MASTER: MasterOpts = {
  target: -9,
  ceiling: -1,
  hp: 26,
  monoBelow: 120,
  eq: [],
  glue: { threshold: -9, ratio: 2, attack: 0.03, release: 0.25, knee: 8, makeup: 0 },
  clipKnee: 3,
  width: 1,
  limiter: { lookahead: 0.004, release: 0.08 },
};

export class Song {
  readonly title: string;
  readonly slug: string;
  readonly list: 'menu' | 'easy' | 'hard';
  readonly bpm: number;
  readonly bars: number;
  readonly beatsPerBar: number;
  readonly tail: number;
  readonly key: string;
  readonly tracks: Track[] = [];
  readonly buses: Bus[] = [];
  readonly sections: { name: string; from: number; to: number }[] = [];
  readonly master: MasterOpts;
  private readonly seed: number;

  constructor(o: SongOpts) {
    this.title = o.title;
    this.slug = o.slug;
    this.list = o.list;
    this.bpm = o.bpm;
    this.bars = o.bars;
    this.beatsPerBar = o.beatsPerBar ?? 4;
    this.tail = o.tail ?? 2;
    this.key = o.key ?? '';
    this.seed = typeof o.seed === 'number' ? o.seed : hash(o.seed ?? o.slug);
    this.master = { ...DEFAULT_MASTER, ...o.master };
  }

  /** Seconds in `beats`. */
  s = (beats: number): number => (beats * 60) / this.bpm;
  /** The beat at which `bar` starts, plus `beat` beats. Bars count from 0. */
  bar = (bar: number, beat = 0): number => bar * this.beatsPerBar + beat;
  get totalBeats(): number {
    return this.bars * this.beatsPerBar;
  }
  /** Seconds of music, without the tail. */
  get seconds(): number {
    return this.s(this.totalBeats);
  }
  /** A random stream that depends only on the song's seed and this label. */
  rng(label: string | number): Rng {
    return new Rng(hash(`${this.seed}:${label}`));
  }

  track(name: string, o: TrackOpts = {}): Track {
    if (this.tracks.some(t => t.name === name)) throw new Error(`Two tracks are called "${name}"`);
    const t = new Track(name, o);
    this.tracks.push(t);
    return t;
  }
  /** A send bus: `chain` runs over everything sent to it, and the result joins the master. Use effects at mix 1. */
  bus(name: string, chain: Fx | Fx[], gainDb = 0): Bus {
    const b = new Bus(name, Array.isArray(chain) ? chain : [chain], gainDb);
    this.buses.push(b);
    return b;
  }
  lane(points: readonly Point[]): Lane {
    return new Lane(points);
  }
  /** Names a stretch of bars. Used by the render report, which gives the level of each section. */
  section(name: string, from: number, to: number): void {
    this.sections.push({ name, from, to });
  }

  // Effects that need the timeline.

  /** Sidechain pump: the level dips at each of `beats` and comes back. */
  duck(beats: readonly number[], o: DuckOpts = {}): Fx {
    const times = beats.map(this.s);
    return (buf, c) => {
      const curve = duckCurve(c.n, c.t0, times, o);
      applyCurve(buf[0], curve);
      applyCurve(buf[1], curve);
    };
  }
  /** A filter whose cutoff is a number or follows a lane (Hz). */
  filter(mode: FilterMode, cutoff: number | Lane, q = 0.707, poles: 2 | 4 = 2): Fx {
    return (buf, c) => {
      filt(buf, mode, typeof cutoff === 'number' ? cutoff : c.curve(cutoff), q, poles);
    };
  }
  /** Level automation: the lane is linear gain. */
  vol(lane: Lane): Fx {
    return (buf, c) => {
      const curve = c.curve(lane);
      applyCurve(buf[0], curve);
      applyCurve(buf[1], curve);
    };
  }
  /** A rhythmic gate. One character of `pattern` per `stepBeats`: `x` open, `.` closed. Locked to the song's grid. */
  gate(pattern: string, stepBeats = 0.25, o: { floor?: number; smooth?: number; duty?: number; mix?: Lane } = {}): Fx {
    return (buf, c) => {
      const curve = gateCurve(c.n, c.t0, this.s(stepBeats), pattern, o);
      if (o.mix) {
        const mix = c.curve(o.mix);
        for (let b = 0; b < curve.length; b++) curve[b] = 1 - mix[b] + curve[b] * mix[b];
      }
      applyCurve(buf[0], curve);
      applyCurve(buf[1], curve);
    };
  }

  render(o: RenderOpts = {}): RenderResult {
    const started = process.cpuUsage();
    const log = o.log ?? (() => {});
    const fromBar = Math.max(0, o.from ?? 0);
    const toBar = Math.min(this.bars, o.to ?? this.bars);
    const fromBeat = this.bar(fromBar);
    const toBeat = this.bar(toBar);
    const t0 = this.s(fromBeat);
    const n = Math.round((this.s(toBeat - fromBeat) + this.tail) * SR);
    // Clips that start this long before the range may still be ringing in it.
    const lookback = this.beatsPerBar * 8;
    const blocks = Math.ceil(n / CR) + 1;
    const ctx: FxCtx = {
      song: this,
      t0,
      n,
      curve: lane => {
        const out = new Float32Array(blocks);
        const beatsPerBlock = ((CR / SR) * this.bpm) / 60;
        for (let b = 0; b < blocks; b++) out[b] = lane.at(fromBeat + b * beatsPerBlock);
        return out;
      },
    };

    const pool: Stereo[] = [];
    const take = (): Stereo => {
      const b = pool.pop();
      if (b) {
        b[0].fill(0);
        b[1].fill(0);
        return b;
      }
      return [new Float32Array(n), new Float32Array(n)];
    };
    const give = (b: Stereo): void => {
      pool.push(b);
    };

    const master = take();
    const busIn = new Map<Bus, Stereo>();
    const stats: TrackStat[] = [];
    const solo = o.solo;
    const audible = (t: Track): boolean => {
      if (t.mute) return false;
      if (!solo) return true;
      return solo.includes(t.name) || this.tracks.some(c => c.out === t && audible(c));
    };

    const renderTrack = (t: Track): Stereo => {
      const cpu0 = process.cpuUsage();
      const buf = take();
      let childCpu = 0;
      for (const child of this.tracks) {
        if (child.out !== t || !audible(child)) continue;
        const c0 = process.cpuUsage();
        const cb = renderTrack(child);
        mixInto(buf, cb, 0);
        give(cb);
        childCpu += process.cpuUsage(c0).user / 1e6;
      }
      const cache = new Map<string, Buf>();
      let clips = 0;
      if (!solo || solo.includes(t.name)) {
        for (const ev of t.events) {
          if (ev.beat >= toBeat || ev.beat < fromBeat - lookback) continue;
          let clip: Buf;
          if (typeof ev.clip === 'function') {
            const cached = ev.key ? cache.get(ev.key) : undefined;
            clip = cached ?? ev.clip();
            if (ev.key && !cached) cache.set(ev.key, clip);
          } else clip = ev.clip;
          mixInto(buf, clip, Math.round((this.s(ev.beat) - t0) * SR), ev.gain, ev.pan);
          clips++;
        }
      }
      for (const f of t.chain) f(buf, ctx);
      const gain = dB(t.gain);
      const gl = gain * (t.pan > 0 ? 1 - t.pan : 1);
      const gr = gain * (t.pan < 0 ? 1 + t.pan : 1);
      let peak = 0;
      let sum = 0;
      let active = 0;
      const [L, R] = buf;
      for (let i = 0; i < n; i++) {
        const l = (L[i] *= gl);
        const r = (R[i] *= gr);
        const a = l < 0 ? -l : l;
        const b = r < 0 ? -r : r;
        const m = a > b ? a : b;
        if (m > peak) peak = m;
        if (m > 1e-4) {
          sum += l * l + r * r;
          active++;
        }
      }
      for (const send of t.sends) {
        let input = busIn.get(send.bus);
        if (!input) {
          input = take();
          busIn.set(send.bus, input);
        }
        if (typeof send.amount === 'number') mixInto(input, buf, 0, dB(send.amount));
        else {
          const curve = ctx.curve(send.amount);
          const tmp: Stereo = [L.slice(), R.slice()];
          applyCurve(tmp[0], curve);
          applyCurve(tmp[1], curve);
          mixInto(input, tmp, 0);
        }
      }
      const cpu = process.cpuUsage(cpu0).user / 1e6 - childCpu;
      stats.push({ name: t.name, peakDb: toDb(peak), rmsDb: active ? toDb(Math.sqrt(sum / (2 * active))) : -Infinity, cpu, clips });
      log(`  ${t.name.padEnd(14)} ${clips.toString().padStart(5)} clips  peak ${toDb(peak).toFixed(1).padStart(6)}  rms ${(active ? toDb(Math.sqrt(sum / (2 * active))) : -99).toFixed(1).padStart(6)}  ${cpu.toFixed(2)} s`);
      return buf;
    };

    for (const t of this.tracks) {
      if (t.out || !audible(t)) continue;
      const b = renderTrack(t);
      mixInto(master, b, 0);
      give(b);
    }
    for (const bus of this.buses) {
      const input = busIn.get(bus);
      if (!input) continue;
      const cpu0 = process.cpuUsage();
      for (const f of bus.chain) f(input, ctx);
      mixInto(master, input, 0, dB(bus.gain));
      const cpu = process.cpuUsage(cpu0).user / 1e6;
      const peak = samplePeak(input) * dB(bus.gain);
      stats.push({ name: `bus:${bus.name}`, peakDb: toDb(peak), rmsDb: NaN, cpu, clips: 0 });
      log(`  bus:${bus.name.padEnd(10)}              peak ${toDb(peak).toFixed(1).padStart(6)}              ${cpu.toFixed(2)} s`);
      give(input);
    }
    pool.length = 0;

    // Master.
    const m = this.master;
    if (m.monoBelow > 0) monoBelow(master, m.monoBelow);
    if (m.width !== 1) widen(master, m.width);
    if (m.hp > 0) filt(master, 'hp', m.hp);
    if (m.eq.length) eq(master, m.eq);
    const glueStats = { maxReduction: 0 };
    if (m.glue) compress(master, m.glue, glueStats);
    const pre = loudness(master).integrated;
    const ceiling = dB(m.ceiling);
    const knee = m.clipKnee > 0 ? ceiling * dB(-m.clipKnee) : 0;
    // The limiter gives back less loudness than the gain put in, so the push is found by trial on a cheap copy.
    let push = Number.isFinite(pre) ? m.target - pre : 0;
    const limStats = { maxReduction: 0, share: 0, meanReduction: 0 };
    if (Number.isFinite(pre)) {
      const probe: Stereo = [new Float32Array(n), new Float32Array(n)];
      for (let pass = 0; pass < 5; pass++) {
        const g = dB(push);
        for (let c = 0; c < 2; c++) {
          const src = master[c];
          const dst = probe[c];
          if (knee > 0) {
            const span = ceiling * 1.12 - knee;
            for (let i = 0; i < n; i++) {
              const x = src[i] * g;
              const a = x < 0 ? -x : x;
              dst[i] = a <= knee ? x : (x < 0 ? -1 : 1) * (knee + span * Math.tanh((a - knee) / span));
            }
          } else for (let i = 0; i < n; i++) dst[i] = src[i] * g;
        }
        limit(probe, { ceiling, ...m.limiter });
        const got = loudness(probe).integrated;
        const miss = m.target - got;
        if (Math.abs(miss) < 0.12) break;
        push += miss * 1.15;
      }
      // Then for real, with the oversampled clipper, which shaves a little more than the cheap one. Corrected twice at most.
      for (let attempt = 0; attempt < 3; attempt++) {
        const g = dB(push);
        for (let c = 0; c < 2; c++) {
          const src = master[c];
          const dst = probe[c];
          for (let i = 0; i < n; i++) dst[i] = src[i] * g;
        }
        // The clipper may pass a little over the ceiling. The limiter after it has the last word.
        if (knee > 0) softClip(probe, knee, ceiling * 1.12);
        limit(probe, { ceiling, ...m.limiter }, limStats);
        const miss = m.target - loudness(probe).integrated;
        if (Math.abs(miss) < 0.08 || attempt === 2) break;
        push += miss * 1.1;
      }
      master[0].set(probe[0]);
      master[1].set(probe[1]);
    }
    // The end of the tail fades to nothing, so a reverb that outlasts it is not cut off.
    if (toBar === this.bars) {
      const fade = Math.min(n, Math.round(Math.min(this.tail * 0.6, 2) * SR));
      for (const ch of master) for (let i = 0; i < fade; i++) ch[n - 1 - i] *= i / fade;
    }
    const final = loudness(master);
    const used = process.cpuUsage(started);
    return {
      buf: master,
      tracks: stats,
      master: {
        lufs: final.integrated,
        shortTermMax: final.shortTermMax,
        range: final.range,
        peakDb: toDb(samplePeak(master)),
        pushDb: push,
        limiterMaxDb: limStats.maxReduction,
        limiterMeanDb: limStats.meanReduction,
        limiterShare: limStats.share,
        glueMaxDb: glueStats.maxReduction,
        preLufs: pre,
      },
      seconds: n / SR,
      cpu: (used.user + used.system) / 1e6,
      fromBar,
      toBar,
    };
  }
}
