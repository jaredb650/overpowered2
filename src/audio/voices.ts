/**
 * Pooled voices. Node chains are built once and reused. Only AudioBufferSourceNode is created per
 * play, because the spec makes that node single-use.
 *
 * Every param a frame writes is k-rate. At the default a-rate, one automation event moves Chrome onto its
 * sample-accurate path until the event ends: the biquad works out new coefficients for each of 128 samples and the
 * panner a new azimuth for each, and a moving listener does this to every panner at once. Measured, that made 48
 * moving voices cost 6 times what the same voices cost at k-rate, and it is what ran the render thread out of time.
 */
import type * as THREE from 'three';
import type { LoopHandle } from '../core/contracts';
import { clamp, damp } from '../core/math';
import type { VoiceSlot } from './allocator';
import type { SoundDef } from './catalog';

const SPEED_OF_SOUND = 343;
/** Steals fade this fast. Short enough to keep the first game's retrigger stutter, long enough not to click. */
const STEAL_FADE = 0.004;
const AIR_FLOOR_HZ = 500;
/** Distance writes smaller than this are below hearing, and each one is work for the render thread. */
const DISTANCE_STEP = 0.03;
/** An end that has not arrived this long after its time will not arrive, so the voice is taken back. */
const END_GRACE = 0.75;

/** Firefox has no automationRate, and there the attribute is only an unused expando. */
export function kRate(...params: AudioParam[]): void {
  for (const p of params) p.automationRate = 'k-rate';
}

/** Inverse-distance falloff, shaped to reach true silence at `far`. Inside `near` it is flat. */
export function attenuation(distance: number, near: number, far: number): number {
  if (distance <= near) return 1;
  if (distance >= far) return 0;
  const t = (distance - near) / (far - near);
  return (near / distance) * (1 - t * t);
}

/** Air absorbs highs with distance. 12 kHz at 20 m, under 3 kHz at 100 m, under 1 kHz at 300 m. */
export function airCutoff(distance: number): number {
  return Math.max(AIR_FLOOR_HZ, 22000 / (1 + Math.pow(distance / 22, 1.3)));
}

/**
 * Far sounds are mostly room, which is half of what makes a distance read as a distance. The room still
 * fades with them, but slower than the direct sound, or a battle at the far end of the map would flood it.
 */
export function wetness(distance: number, near: number, attenuated: number): number {
  return (1 + 2.2 * clamp((distance - near) / 60)) * Math.sqrt(attenuated);
}

export class Voice implements VoiceSlot {
  soundId: string | null = null;
  family: string | undefined = undefined;
  priority = 0;
  critical = false;
  order = 0;
  loudness = 0;
  releasing = false;
  loop = false;

  readonly level: GainNode;
  readonly send: GainNode | null;
  readonly air: BiquadFilterNode | null;
  readonly dist: GainNode | null;
  readonly panner: PannerNode | null;
  private readonly input: AudioNode;

  source: AudioBufferSourceNode | null = null;
  def: SoundDef | null = null;
  /** Bumped on every reuse, so a stale LoopHandle can tell it lost the voice. */
  generation = 0;

  pitch = 1;
  pitchTarget = 1;
  pitchSpeed = 0;
  exempt = false;
  doppler = 1;
  useDoppler = false;
  /** Catalogue level times the caller's volume, before distance. */
  gain = 0;

  spatial = false;
  /** When a one-shot should be over on the audio clock. Infinity for loops. */
  endsAt = Infinity;
  x = 0;
  y = 0;
  z = 0;
  private px = 0;
  private py = 0;
  private pz = 0;
  /** What applyDistance last wrote, so a voice nobody moved costs no automation events. */
  private readonly wrote = { attenuated: -1, cutoff: -1 };
  private readonly maxHz: number;

  constructor(
    private readonly ac: AudioContext,
    output: AudioNode,
    reverb: AudioNode | null,
    spatial: boolean,
    /** Fixed for the voice's life. Changing a panner's model builds a new panner under the render thread's lock. */
    readonly hrtf: boolean,
    private readonly onFree: (v: Voice) => void,
  ) {
    this.maxHz = ac.sampleRate / 2;
    this.level = ac.createGain();
    this.level.gain.value = 0;
    this.send = reverb ? ac.createGain() : null;
    if (this.send) {
      this.send.gain.value = 0;
      kRate(this.send.gain);
      this.level.connect(this.send);
      this.send.connect(reverb!);
    }
    if (spatial) {
      this.air = ac.createBiquadFilter();
      this.air.type = 'lowpass';
      this.air.frequency.value = 20000;
      this.air.Q.value = 0.5;
      // A point in the world has no width, and a stereo source would run every node after this twice.
      this.air.channelCount = 1;
      this.air.channelCountMode = 'explicit';
      this.dist = ac.createGain();
      this.panner = ac.createPanner();
      // Distance is computed here, once, because the filter, the send and culling all need it too.
      this.panner.distanceModel = 'linear';
      this.panner.rolloffFactor = 0;
      this.panner.panningModel = hrtf ? 'HRTF' : 'equalpower';
      const a = this.air;
      const p = this.panner;
      kRate(a.frequency, a.Q, a.detune, a.gain, this.dist.gain, p.positionX, p.positionY, p.positionZ, p.orientationX, p.orientationY, p.orientationZ);
      this.air.connect(this.level);
      this.level.connect(this.dist);
      this.dist.connect(this.panner);
      this.panner.connect(output);
      this.input = this.air;
    } else {
      this.air = null;
      this.dist = null;
      this.panner = null;
      this.level.connect(output);
      this.input = this.level;
    }
  }

  private readonly ended = (): void => {
    if (this.source) {
      this.source.onended = null;
      this.source.disconnect();
      this.source = null;
    }
    this.release();
  };

  private release(): void {
    this.generation++;
    this.soundId = null;
    this.def = null;
    this.releasing = false;
    this.loop = false;
    this.spatial = false;
    this.endsAt = Infinity;
    this.onFree(this);
  }

  begin(
    def: SoundDef, buffer: AudioBuffer, gain: number, pitch: number, slowmo: number, exempt: boolean, order: number,
    when: number, offset: number, duration: number, fadeIn: number,
  ): void {
    const ac = this.ac;
    const source = ac.createBufferSource();
    source.buffer = buffer;
    source.loop = def.loop;
    const rate = Math.max(0.05, pitch * (exempt ? 1 : slowmo));
    source.playbackRate.value = rate;
    source.connect(this.input);
    source.onended = this.ended;

    this.source = source;
    this.def = def;
    this.soundId = def.id;
    this.family = def.family;
    this.priority = def.priority;
    this.critical = def.critical;
    this.order = order;
    this.loop = def.loop;
    this.releasing = false;
    this.pitch = pitch;
    this.pitchTarget = pitch;
    this.pitchSpeed = 0;
    this.exempt = exempt;
    this.doppler = 1;
    this.useDoppler = false;
    // Stereo at the panner's centre passes at full level, mono at -3 dB. Folding down must not move the mix.
    const level = this.panner && buffer.numberOfChannels > 1 ? gain * Math.SQRT2 : gain;
    this.gain = level;
    this.loudness = level;

    const g = this.level.gain;
    g.cancelScheduledValues(0);
    if (fadeIn > 0) {
      g.setValueAtTime(0, when);
      g.setTargetAtTime(level, when, fadeIn / 3);
    } else {
      g.setValueAtTime(level, when);
    }

    const clampedOffset = Math.min(offset, Math.max(0, buffer.duration - 0.01));
    if (duration > 0) {
      // Duration is in sample time, so slow-mo stretches the cut instead of shortening what you hear.
      const fadeStart = when + Math.max(0, duration - 0.02) / rate;
      g.setTargetAtTime(0, fadeStart, 0.005);
      source.start(when, clampedOffset);
      source.stop(fadeStart + 0.04);
      this.endsAt = fadeStart + 0.04;
    } else {
      source.start(when, clampedOffset);
      this.endsAt = def.loop ? Infinity : when + (buffer.duration - clampedOffset) / rate;
    }
  }

  /**
   * True when a one-shot's end event never came. It is delivered by the main thread, which a stall can hold up, and
   * a voice nobody gives back is a voice lost until the page reloads.
   */
  overdue(now: number): boolean {
    return now > this.endsAt + END_GRACE;
  }

  /** Takes the voice back without waiting for an event that may never fire. */
  reclaim(): void {
    this.cut();
    this.release();
  }

  /** Point sources. Moves the panner and notes the old position for Doppler. */
  place(x: number, y: number, z: number): void {
    // A body flung to NaN must not take the frame with it: the param setters throw on non-finite values.
    if (!Number.isFinite(x + y + z)) return;
    this.x = x;
    this.y = y;
    this.z = z;
    const p = this.panner;
    if (!p) return;
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
  }

  /** Sets everything that depends on distance. */
  applyDistance(attenuated: number, cutoffHz: number, wet: number, smooth: number): void {
    const now = this.ac.currentTime;
    const hz = Math.min(cutoffHz, this.maxHz);
    const w = this.wrote;
    this.loudness = this.gain * attenuated;
    if (smooth > 0) {
      if (Math.abs(attenuated - w.attenuated) <= DISTANCE_STEP * w.attenuated && Math.abs(hz - w.cutoff) <= DISTANCE_STEP * w.cutoff) return;
      this.dist!.gain.setTargetAtTime(attenuated, now, smooth);
      this.air!.frequency.setTargetAtTime(hz, now, smooth);
      this.send?.gain.setTargetAtTime(wet, now, smooth);
    } else {
      this.dist!.gain.setValueAtTime(attenuated, now);
      this.air!.frequency.setValueAtTime(hz, now);
      this.send?.gain.setValueAtTime(wet, now);
    }
    w.attenuated = attenuated;
    w.cutoff = hz;
  }

  setSend(level: number): void {
    this.send?.gain.setValueAtTime(level, this.ac.currentTime);
  }

  setRate(slowmo: number): void {
    if (!this.source) return;
    const param = this.source.playbackRate;
    const before = Math.max(0.05, param.value);
    const after = Math.max(0.05, this.pitch * this.doppler * (this.exempt ? 1 : slowmo));
    param.value = after;
    if (this.endsAt !== Infinity) {
      const now = this.ac.currentTime;
      this.endsAt = now + Math.max(0, this.endsAt - now) * (before / after);
    }
  }

  /** Advances pitch glides and Doppler for one frame. Returns true when the rate needs rewriting. */
  stepPitch(realDt: number, listenerX: number, listenerY: number, listenerZ: number): boolean {
    let dirty = false;
    if (this.pitch !== this.pitchTarget) {
      this.pitch = this.pitchSpeed > 0 ? damp(this.pitch, this.pitchTarget, this.pitchSpeed, realDt) : this.pitchTarget;
      if (Math.abs(this.pitch - this.pitchTarget) < 0.001) this.pitch = this.pitchTarget;
      dirty = true;
    }
    if (this.useDoppler && realDt > 0) {
      const dx = this.x - listenerX;
      const dy = this.y - listenerY;
      const dz = this.z - listenerZ;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const closing = ((this.px - this.x) * dx + (this.py - this.y) * dy + (this.pz - this.z) * dz) / (d * realDt);
      const target = clamp(SPEED_OF_SOUND / (SPEED_OF_SOUND - clamp(closing, -160, 160)), 0.65, 1.8);
      this.doppler = damp(this.doppler, target, 14, realDt);
      dirty = true;
    }
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    return dirty;
  }

  /** Remembers the current spot as last frame's, so a voice does not start with a Doppler jump. */
  anchor(): void {
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
  }

  setVolume(gain: number, seconds: number): void {
    if (!Number.isFinite(gain)) return;
    this.gain = gain;
    this.level.gain.setTargetAtTime(gain, this.ac.currentTime, Math.max(0.008, seconds / 3));
  }

  /** Fades out and frees the voice. */
  stop(seconds: number): void {
    if (!this.source || this.releasing) return;
    this.releasing = true;
    const now = this.ac.currentTime;
    this.level.gain.setTargetAtTime(0, now, Math.max(STEAL_FADE, seconds / 4));
    const end = now + Math.max(0.03, seconds * 1.6);
    this.source.stop(end);
    this.endsAt = end;
  }

  /** Quick cut for voice stealing. */
  steal(): void {
    this.stop(STEAL_FADE);
  }

  /** Immediate reuse when the pool has nothing free. */
  cut(): void {
    if (this.source) {
      this.source.onended = null;
      this.source.stop();
      this.source.disconnect();
      this.source = null;
    }
    this.generation++;
    this.soundId = null;
    this.def = null;
    this.releasing = false;
  }
}

/** One voice per handle. It stops working the moment the voice is reused, without the caller doing anything. */
export class VoiceHandle implements LoopHandle {
  private readonly generation: number;

  constructor(
    private readonly voice: Voice,
    private readonly catalogVolume: number,
    private readonly fadeOut: number,
  ) {
    this.generation = voice.generation;
  }

  private get live(): boolean {
    return this.voice.generation === this.generation && !this.voice.releasing;
  }

  get alive(): boolean { return this.live; }

  setVolume(volume: number, seconds = 0.05): void {
    if (this.live) this.voice.setVolume(this.catalogVolume * volume, seconds);
  }

  setPitch(pitch: number, seconds = 0): void {
    if (!this.live) return;
    this.voice.pitchTarget = pitch;
    this.voice.pitchSpeed = seconds > 0 ? 3 / seconds : 0;
  }

  setPosition(position: THREE.Vector3): void {
    if (this.live && this.voice.panner) this.voice.place(position.x, position.y, position.z);
  }

  stop(seconds = this.fadeOut): void {
    if (this.live) this.voice.stop(seconds);
  }
}

/** Returned for unknown ids and before the context exists, so callers never need to null-check. */
export const DEAD_HANDLE: LoopHandle = {
  alive: false,
  setVolume() {},
  setPitch() {},
  setPosition() {},
  stop() {},
};
