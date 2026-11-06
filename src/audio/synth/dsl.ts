/**
 * A small patching language over OfflineAudioContext.
 *
 * Recipes describe a sound as parallel chains of sources and processors. Rendering happens on the
 * browser's audio thread, so a hundred recipes cost the main thread almost nothing while the world
 * is building, which is why this is not plain JS sample maths.
 */
import { mulberry32 } from '../../core/math';

export type Point = readonly [t: number, v: number];
/** A constant, or breakpoints relative to the current `at` block. */
export type Curve = number | readonly Point[];
export type NoiseColor = 'white' | 'pink' | 'brown';

const NOISE_SECONDS = 6;
const noiseBanks = new Map<string, AudioBuffer>();

function fillNoise(data: Float32Array, color: NoiseColor): void {
  const rnd = mulberry32(color === 'white' ? 11 : color === 'pink' ? 23 : 37);
  if (color === 'white') {
    for (let i = 0; i < data.length; i++) data[i] = rnd() * 2 - 1;
    return;
  }
  if (color === 'pink') {
    // Kellet's economy filter: within 0.5 dB of 1/f across the audio band.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < data.length; i++) {
      const w = rnd() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      data[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    return;
  }
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    last = (last + 0.02 * (rnd() * 2 - 1)) / 1.02;
    data[i] = last * 3.5;
  }
}

function noiseBank(color: NoiseColor, sampleRate: number): AudioBuffer {
  const key = `${color}:${sampleRate}`;
  let buffer = noiseBanks.get(key);
  if (!buffer) {
    buffer = new AudioBuffer({ length: Math.floor(NOISE_SECONDS * sampleRate), numberOfChannels: 1, sampleRate });
    fillNoise(buffer.getChannelData(0), color);
    noiseBanks.set(key, buffer);
  }
  return buffer;
}

const shaperCurves = new Map<string, Float32Array<ArrayBuffer>>();

/** Transfer functions. `tanh` warms, `hard` splatters, `fold` adds metallic overtones. */
function shaperCurve(shape: 'tanh' | 'hard' | 'fold', amount: number): Float32Array<ArrayBuffer> {
  const key = `${shape}:${amount.toFixed(2)}`;
  let curve = shaperCurves.get(key);
  if (curve) return curve;
  curve = new Float32Array(2049);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    const d = x * amount;
    curve[i] = shape === 'tanh' ? Math.tanh(d) / Math.tanh(amount)
      : shape === 'hard' ? Math.max(-1, Math.min(1, d))
      : Math.sin(d * Math.PI * 0.5);
  }
  shaperCurves.set(key, curve);
  return curve;
}

/**
 * Holds a value inside what the param can take. Recipes scale pitches freely, and a glass partial can land past
 * Nyquist on a 24 kHz render. The browser would clamp it the same way, but it logs a warning for each one.
 */
const fit = (param: AudioParam, value: number) => Math.min(param.maxValue, Math.max(param.minValue, value));

/** Exponential breakpoints when both ends are positive, linear otherwise. */
function applyCurve(param: AudioParam, curve: Curve, base: number): void {
  if (typeof curve === 'number') {
    param.setValueAtTime(fit(param, curve), 0);
    return;
  }
  const first = curve[0]!;
  param.setValueAtTime(fit(param, first[1]), Math.max(0, base + first[0]));
  for (let i = 1; i < curve.length; i++) {
    const [t, raw] = curve[i]!;
    const [pt, pv] = curve[i - 1]!;
    const v = fit(param, raw);
    const time = Math.max(0, base + t);
    if (t <= pt) param.setValueAtTime(v, time);
    else if (v > 0 && pv > 0) param.exponentialRampToValueAtTime(v, time);
    else param.linearRampToValueAtTime(v, time);
  }
}

/** Instant attack, exponential decay to -60 dB. */
export const perc = (decay: number, peak = 1, attack = 0.0008): Point[] =>
  [[0, 0], [attack, peak], [attack + decay, peak * 0.001]];
/** Fade in, hold, fade out across `total` seconds. */
export const swell = (attack: number, total: number, release: number, peak = 1): Point[] =>
  [[0, 0.0001], [attack, peak], [Math.max(attack, total - release), peak], [total, 0.0001]];
/** Scales a curve's values. */
export const scaled = (curve: readonly Point[], k: number): Point[] => curve.map(([t, v]) => [t, v * k] as const);
/** Moves a curve in time. */
export const shifted = (curve: readonly Point[], dt: number): Point[] => curve.map(([t, v]) => [t + dt, v] as const);

export class Chain {
  constructor(
    readonly s: Synth,
    /** The node signals leave from. */
    public node: AudioNode,
    /** The source's oscillator or buffer player, for pitch modulation. */
    private readonly origin: OscillatorNode | AudioBufferSourceNode | null = null,
  ) {}

  private through(next: AudioNode): this {
    this.node.connect(next);
    this.node = next;
    return this;
  }

  private filter(type: BiquadFilterType, freq: Curve, q: number, db = 0): this {
    const f = this.s.ctx.createBiquadFilter();
    f.type = type;
    applyCurve(f.frequency, freq, this.s.base);
    f.Q.value = q;
    f.gain.value = db;
    return this.through(f);
  }

  lp(freq: Curve, q = 0.7): this { return this.filter('lowpass', freq, q); }
  hp(freq: Curve, q = 0.7): this { return this.filter('highpass', freq, q); }
  bp(freq: Curve, q = 1): this { return this.filter('bandpass', freq, q); }
  notch(freq: Curve, q = 1): this { return this.filter('notch', freq, q); }
  peak(freq: Curve, db: number, q = 1): this { return this.filter('peaking', freq, q, db); }
  lowShelf(freq: Curve, db: number): this { return this.filter('lowshelf', freq, 0.7, db); }
  highShelf(freq: Curve, db: number): this { return this.filter('highshelf', freq, 0.7, db); }

  /** Connects a modulator to the most recent filter's cutoff, in Hz. */
  sweep(mod: AudioNode): this {
    if (this.node instanceof BiquadFilterNode) mod.connect(this.node.frequency);
    return this;
  }

  /** Connects a modulator to the source's pitch, in cents. */
  detune(mod: AudioNode): this {
    if (this.origin) mod.connect(this.origin.detune);
    return this;
  }

  /** Gain, with breakpoints. */
  env(curve: Curve): this {
    const g = this.s.ctx.createGain();
    applyCurve(g.gain, curve, this.s.base);
    return this.through(g);
  }

  gain(level: number): this { return this.env(level); }

  /** Amplitude modulation by a signal. The signal is added to `offset`, so 1 keeps the level on average. */
  am(signal: AudioNode, offset = 1): this {
    const g = this.s.ctx.createGain();
    g.gain.value = offset;
    signal.connect(g.gain);
    return this.through(g);
  }

  drive(amount: number, shape: 'tanh' | 'hard' | 'fold' = 'tanh', makeup = 1): this {
    const w = this.s.ctx.createWaveShaper();
    w.curve = shaperCurve(shape, amount);
    w.oversample = '2x';
    this.through(w);
    return makeup === 1 ? this : this.gain(makeup);
  }

  /** Echoes. Feedback loops in Web Audio need at least 128 samples of delay. */
  echo(seconds: number, feedback: number, wet = 0.5): this {
    const c = this.s.ctx;
    const delay = c.createDelay(Math.max(1, seconds * 1.1));
    delay.delayTime.value = Math.max(seconds, 128 / c.sampleRate);
    const fb = c.createGain();
    fb.gain.value = feedback;
    const w = c.createGain();
    w.gain.value = wet;
    const sum = c.createGain();
    this.node.connect(sum);
    this.node.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(w);
    w.connect(sum);
    this.node = sum;
    return this;
  }

  /** A short synthetic room or body baked into the sound. */
  room(seconds: number, wet = 0.4, brightness = 6000): this {
    const c = this.s.ctx;
    const convolver = c.createConvolver();
    convolver.normalize = true;
    const length = Math.max(64, Math.floor(seconds * c.sampleRate));
    const ir = new AudioBuffer({ length, numberOfChannels: 2, sampleRate: c.sampleRate });
    const rnd = mulberry32(Math.floor(seconds * 9973) + brightness);
    const smooth = 1 - Math.exp((-2 * Math.PI * brightness) / c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < length; i++) {
        lp += ((rnd() * 2 - 1) - lp) * smooth;
        data[i] = lp * Math.pow(0.001, i / length);
      }
    }
    convolver.buffer = ir;
    const w = c.createGain();
    w.gain.value = wet;
    const sum = c.createGain();
    this.node.connect(sum);
    this.node.connect(convolver);
    convolver.connect(w);
    w.connect(sum);
    this.node = sum;
    return this;
  }

  /** Branches off a parallel chain that shares everything so far. */
  fork(): Chain { return new Chain(this.s, this.node); }

  /** Feeds this chain into another node, usually a `sum()`. */
  to(target: Chain): void { this.node.connect(target.node); }

  /** Sends the chain to the mix, finishing it. `pan` applies to stereo renders. */
  out(level = 1, pan: Curve = 0): void {
    const c = this.s.ctx;
    const g = c.createGain();
    g.gain.value = level;
    this.node.connect(g);
    if (this.s.channels === 2 && pan !== 0) {
      const p = c.createStereoPanner();
      applyCurve(p.pan, pan, this.s.base);
      g.connect(p);
      p.connect(this.s.bus);
    } else {
      g.connect(this.s.bus);
    }
  }
}

export class Synth {
  /** Time origin of curves and sources. Move it with `at`. */
  base = 0;
  /** The sum of everything sent with `out()`. */
  readonly bus: GainNode;

  constructor(
    readonly ctx: OfflineAudioContext,
    readonly dur: number,
    readonly rng: () => number,
    /** Which rendered variant this is, from 0. */
    readonly variant = 0,
  ) {
    this.bus = ctx.createGain();
    // Rumble and asymmetric distortion leave DC behind, which eats headroom in the final mix.
    const dcBlock = ctx.createBiquadFilter();
    dcBlock.type = 'highpass';
    dcBlock.frequency.value = 18;
    dcBlock.Q.value = 0.5;
    this.bus.connect(dcBlock);
    dcBlock.connect(ctx.destination);
  }

  get channels(): number { return this.ctx.destination.channelCount; }
  get sr(): number { return this.ctx.sampleRate; }

  /** Uniform random in [lo, hi). */
  r(lo = 0, hi = 1): number { return lo + this.rng() * (hi - lo); }

  /** Runs `fn` with curves and sources offset by `t` seconds. */
  at(t: number, fn: () => void): void {
    const previous = this.base;
    this.base = previous + t;
    fn();
    this.base = previous;
  }

  noise(color: NoiseColor = 'white', len?: number): Chain {
    const src = this.ctx.createBufferSource();
    src.buffer = noiseBank(color, this.sr);
    src.loop = true;
    src.start(this.base, this.r(0, NOISE_SECONDS - 0.01));
    if (len !== undefined) src.stop(this.base + len);
    return new Chain(this, src, src);
  }

  osc(type: OscillatorType, freq: Curve, len?: number, cents = 0): Chain {
    const o = this.ctx.createOscillator();
    o.type = type;
    applyCurve(o.frequency, freq, this.base);
    o.detune.value = cents;
    o.start(this.base);
    if (len !== undefined) o.stop(this.base + len);
    return new Chain(this, o, o);
  }

  /** An oscillator with explicit harmonic amplitudes, for organ-like or hollow timbres. */
  wave(harmonics: readonly number[], freq: Curve, len?: number): Chain {
    const real = new Float32Array(harmonics.length + 1);
    const imag = new Float32Array(harmonics.length + 1);
    harmonics.forEach((h, i) => { imag[i + 1] = h; });
    const o = this.ctx.createOscillator();
    o.setPeriodicWave(this.ctx.createPeriodicWave(real, imag));
    applyCurve(o.frequency, freq, this.base);
    o.start(this.base);
    if (len !== undefined) o.stop(this.base + len);
    return new Chain(this, o, o);
  }

  /** Two-operator FM. `ratio` is the modulator against the carrier and `index` is in Hz of deviation. */
  fm(carrier: Curve, ratio: number, index: Curve, len?: number, type: OscillatorType = 'sine'): Chain {
    const c = this.ctx.createOscillator();
    c.type = type;
    applyCurve(c.frequency, carrier, this.base);
    const m = this.ctx.createOscillator();
    applyCurve(m.frequency, typeof carrier === 'number' ? carrier * ratio : carrier.map(([t, v]) => [t, v * ratio] as const), this.base);
    const depth = this.ctx.createGain();
    applyCurve(depth.gain, index, this.base);
    m.connect(depth);
    depth.connect(c.frequency);
    c.start(this.base);
    m.start(this.base);
    if (len !== undefined) {
      c.stop(this.base + len);
      m.stop(this.base + len);
    }
    return new Chain(this, c, c);
  }

  /** A mixing point for several chains. */
  sum(): Chain { return new Chain(this, this.ctx.createGain()); }

  /** Sine modulator with output range +/-depth. */
  lfo(freq: Curve, depth: number, type: OscillatorType = 'sine'): AudioNode {
    const g = this.ctx.createGain();
    g.gain.value = depth;
    this.osc(type, freq).node.connect(g);
    return g;
  }

  /** Smooth random modulator with output range about +/-depth, varying around `rate` Hz. */
  wander(rate: number, depth: number): AudioNode {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = rate;
    f.Q.value = 0.5;
    const g = this.ctx.createGain();
    // Low-passed white noise loses level with cutoff. This keeps depth roughly what the recipe asked for.
    g.gain.value = depth * Math.min(40, Math.sqrt(this.sr / (2 * Math.max(rate, 0.5))) * 0.9);
    this.noise('white').node.connect(f);
    f.connect(g);
    return g;
  }

  /** Plays samples computed in JS, for things the graph cannot do, like sparse impulse trains. */
  samples(data: Float32Array<ArrayBuffer>): Chain {
    const buffer = new AudioBuffer({ length: Math.max(1, data.length), numberOfChannels: 1, sampleRate: this.sr });
    buffer.copyToChannel(data, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.start(this.base);
    return new Chain(this, src, src);
  }

  /**
   * Random impulses for crackle, gravel and debris. `density` gives events per second at time t, and
   * each event is a burst of `width` seconds. Run it through resonant filters to give it a material.
   */
  grains(len: number, density: (t: number) => number, width = 0.0015, level: (t: number) => number = () => 1): Chain {
    const n = Math.floor(len * this.sr);
    const data = new Float32Array(n);
    const wn = Math.max(2, Math.floor(width * this.sr));
    let t = this.r(0, 0.002);
    while (t < len) {
      const rate = Math.max(density(t), 0.01);
      const start = Math.floor(t * this.sr);
      const amp = (0.25 + 0.75 * this.rng() * this.rng()) * level(t) * (this.rng() < 0.5 ? -1 : 1);
      for (let i = 0; i < wn && start + i < n; i++) {
        data[start + i] = data[start + i]! + amp * (1 - i / wn) * (this.rng() * 2 - 1);
      }
      t += -Math.log(1 - this.rng() * 0.9999) / rate;
    }
    return this.samples(data);
  }
}
