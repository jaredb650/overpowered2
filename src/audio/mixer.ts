/**
 * The bus graph.
 *
 *   voices --> sfx ----------+
 *   reverb sends --> rooms --+--> world --> low-health LP --> master --> limiter --> clipper --> out
 *   music --> duck --> slow-mo LP --+
 *   ui ------------------------------------> (joins after the low-pass, so menus stay clear)
 */
import { clamp, damp } from '../core/math';
import { generateImpulse, ROOMS, ROOM_IDS, type RoomId } from './reverb';

const NYQUIST_CAP = 20000;
const ROOM_SEED = 100;
/** Default music level. The first game's soundtrack sat at twice the SMG's level. */
const MUSIC_TRIM = 0.42;

/** Maps 0..1 onto a cutoff frequency, exponentially, because hearing is. */
const cutoff = (amount: number, wide: number, narrow: number) => wide * Math.pow(narrow / wide, clamp(amount));

export class Mixer {
  readonly sfxIn: GainNode;
  readonly uiIn: GainNode;
  readonly musicIn: GainNode;
  readonly reverbIn: GainNode;

  private readonly sfxLevel: GainNode;
  private readonly pauseGate: GainNode;
  private readonly musicLevel: GainNode;
  private readonly musicDuck: GainNode;
  private readonly musicSlowFilter: BiquadFilterNode;
  private readonly musicSlowGain: GainNode;
  private readonly lowHealthFilter: BiquadFilterNode;
  private readonly master: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly clipper: WaveShaperNode;
  private readonly roomGains = new Map<RoomId, GainNode>();
  private readonly roomReturn: GainNode;

  private room: RoomId | null = null;
  private duckAmount = 0;
  private duckHold = 0;
  private duckLevel = 0;
  private slowAmount = 0;
  private healthAmount = 0;

  /** Sandbox metering: peak measured after the limiter and before the clipper. */
  private meterPost: AnalyserNode | null = null;
  private meterPre: AnalyserNode | null = null;
  private meterBuffer: Float32Array<ArrayBuffer> | null = null;
  peakPost = 0;
  peakPre = 0;

  constructor(private readonly ac: AudioContext) {
    const gain = (value = 1) => {
      const g = ac.createGain();
      g.gain.value = value;
      return g;
    };
    this.sfxIn = gain();
    this.uiIn = gain();
    this.musicIn = gain();
    this.reverbIn = gain();
    this.sfxLevel = gain();
    this.pauseGate = gain();
    this.musicLevel = gain(MUSIC_TRIM);
    this.musicDuck = gain();
    this.musicSlowGain = gain();
    this.roomReturn = gain();
    this.master = gain();

    this.musicSlowFilter = ac.createBiquadFilter();
    this.musicSlowFilter.type = 'lowpass';
    this.musicSlowFilter.frequency.value = NYQUIST_CAP;
    this.musicSlowFilter.Q.value = 0.9;

    this.lowHealthFilter = ac.createBiquadFilter();
    this.lowHealthFilter.type = 'lowpass';
    this.lowHealthFilter.frequency.value = NYQUIST_CAP;
    this.lowHealthFilter.Q.value = 0.7;

    // Fast enough to catch a rocket on frame one. The slow release keeps it from pumping under the SMG.
    this.limiter = ac.createDynamicsCompressor();
    this.limiter.threshold.value = -4;
    this.limiter.knee.value = 3;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.12;

    // The compressor looks ahead only 6 ms, so a stack of transients can still overshoot. This is the backstop.
    this.clipper = ac.createWaveShaper();
    const curve = new Float32Array(4097);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      const a = Math.abs(x);
      const shaped = a < 0.8 ? a : 0.8 + 0.195 * Math.tanh((a - 0.8) / 0.195);
      curve[i] = Math.sign(x) * shaped;
    }
    this.clipper.curve = curve;
    this.clipper.oversample = '4x';

    this.sfxIn.connect(this.sfxLevel);
    this.roomReturn.connect(this.sfxLevel);
    this.sfxLevel.connect(this.pauseGate);
    this.pauseGate.connect(this.lowHealthFilter);

    this.musicIn.connect(this.musicDuck);
    this.musicDuck.connect(this.musicSlowFilter);
    this.musicSlowFilter.connect(this.musicSlowGain);
    this.musicSlowGain.connect(this.musicLevel);
    this.musicLevel.connect(this.lowHealthFilter);

    this.lowHealthFilter.connect(this.master);
    this.uiIn.connect(this.master);
    this.master.connect(this.limiter);
    this.limiter.connect(this.clipper);
    this.clipper.connect(ac.destination);
  }

  /** Generates a room and wires a convolver for it. Idle convolvers cost nothing: Web Audio skips silent nodes. */
  buildRoom(id: RoomId): void {
    const spec = ROOMS[id];
    const [left, right] = generateImpulse(spec, this.ac.sampleRate, ROOM_SEED + ROOM_IDS.indexOf(id));
    const buffer = new AudioBuffer({ length: left.length, numberOfChannels: 2, sampleRate: this.ac.sampleRate });
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    const convolver = this.ac.createConvolver();
    convolver.normalize = false;
    convolver.buffer = buffer;
    const send = this.ac.createGain();
    send.gain.value = id === this.room ? 1 : 0;
    this.reverbIn.connect(send);
    send.connect(convolver);
    const wet = this.ac.createGain();
    wet.gain.value = spec.wet;
    convolver.connect(wet);
    wet.connect(this.roomReturn);
    this.roomGains.set(id, send);
  }

  /** Crossfades the send, so the old room's tail rings out as you leave it. */
  setRoom(id: RoomId, seconds = 0.6): void {
    if (id === this.room) return;
    this.room = id;
    const now = this.ac.currentTime;
    for (const [room, g] of this.roomGains) g.gain.setTargetAtTime(room === id ? 1 : 0, now, seconds / 3);
  }

  get currentRoom(): RoomId | null { return this.room; }

  setVolumes(master: number, sfx: number, music: number): void {
    const now = this.ac.currentTime;
    this.master.gain.setTargetAtTime(clamp(master, 0, 2), now, 0.02);
    this.sfxLevel.gain.setTargetAtTime(clamp(sfx, 0, 2), now, 0.02);
    this.uiIn.gain.setTargetAtTime(clamp(sfx, 0, 2), now, 0.02);
    this.musicLevel.gain.setTargetAtTime(clamp(music, 0, 2) * MUSIC_TRIM, now, 0.02);
  }

  /** The strongest request wins for as long as any request holds. */
  duck(amount: number, seconds: number): void {
    this.duckAmount = Math.max(this.duckHold > 0 ? this.duckAmount : 0, clamp(amount));
    this.duckHold = Math.max(this.duckHold, seconds);
  }

  /** Mutes game sound on pause while menus keep theirs. */
  setPaused(paused: boolean): void {
    this.pauseGate.gain.setTargetAtTime(paused ? 0 : 1, this.ac.currentTime, paused ? 0.02 : 0.05);
  }

  /**
   * @param slowmo world time factor, 1 normal and 0.25 full slow-mo.
   * @param lowHealth 0..1.
   */
  update(realDt: number, slowmo: number, lowHealth: number): void {
    const now = this.ac.currentTime;

    this.duckHold = Math.max(0, this.duckHold - realDt);
    const duckTarget = this.duckHold > 0 ? this.duckAmount : 0;
    // Dips in a couple of frames so it beats the transient, returns over about a second.
    this.duckLevel = damp(this.duckLevel, duckTarget, duckTarget > this.duckLevel ? 60 : 1.6, realDt);
    this.musicDuck.gain.setTargetAtTime(1 - this.duckLevel, now, 0.012);

    const slow = clamp((1 - slowmo) / 0.75);
    if (Math.abs(slow - this.slowAmount) > 0.001) {
      this.slowAmount = slow;
      this.musicSlowFilter.frequency.setTargetAtTime(cutoff(slow, NYQUIST_CAP, 420), now, 0.05);
      this.musicSlowGain.gain.setTargetAtTime(1 - slow * 0.25, now, 0.05);
      this.reverbIn.gain.setTargetAtTime(1 + slow * 0.9, now, 0.08);
    }

    if (Math.abs(lowHealth - this.healthAmount) > 0.002) {
      this.healthAmount = lowHealth;
      this.lowHealthFilter.frequency.setTargetAtTime(cutoff(lowHealth, NYQUIST_CAP, 750), now, 0.08);
    }

    if (this.meterPost) this.readMeters();
  }

  /** Taps the limiter's input and output. Costs a little every frame, so only sandboxes turn it on. */
  enableMeters(): void {
    const tap = (node: AudioNode) => {
      const a = this.ac.createAnalyser();
      a.fftSize = 2048;
      node.connect(a);
      return a;
    };
    this.meterPre = tap(this.master);
    this.meterPost = tap(this.clipper);
    this.meterBuffer = new Float32Array(2048);
  }

  private readMeters(): void {
    const peak = (analyser: AnalyserNode) => {
      const data = this.meterBuffer!;
      analyser.getFloatTimeDomainData(data);
      let m = 0;
      for (let i = 0; i < data.length; i++) m = Math.max(m, Math.abs(data[i]!));
      return m;
    };
    this.peakPre = Math.max(this.peakPre, peak(this.meterPre!));
    this.peakPost = Math.max(this.peakPost, peak(this.meterPost!));
  }

  get duckValue(): number { return this.duckLevel; }
  get filters(): { musicHz: number; healthHz: number; gainReduction: number } {
    return {
      musicHz: this.musicSlowFilter.frequency.value,
      healthHz: this.lowHealthFilter.frequency.value,
      gainReduction: this.limiter.reduction,
    };
  }
}
