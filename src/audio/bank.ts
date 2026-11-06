/**
 * Fills the sound bank without getting in the way of the boot or the frame.
 *
 * Decoding and rendering run on browser threads. What lands on the main thread is the glue: building each
 * recipe's graph, trimming, normalizing, measuring. All of it is cut into small jobs that run in idle time, so
 * audio fits into the gaps between the world builder's steps and between frames instead of competing with them.
 * Nothing waits for the bank. A sound that is not ready yet is skipped, and asking for it moves it to the front.
 */
import { loudness } from './analyze';
import { renderRank, sampleDefs, type SoundDef } from './catalog';
import type { Mixer } from './mixer';
import { ROOM_IDS } from './reverb';
import { finishVariant, startVariant, trimFor, type RawRender } from './synth/render';

/** Per-id live state. */
export interface Sound {
  def: SoundDef;
  buffers: AudioBuffer[] | null;
  /** Loudness match from rendering. 1 for samples, which keep the first game's balance. */
  trim: number;
  /** Sum of the variants' loudness so far, which `trim` is the running mean of. */
  loudSum: number;
  lastPick: number;
  lastFrame: number;
  frameCount: number;
  /** Already moved to the front of the render queue. */
  wanted: boolean;
}

interface RenderTask {
  sound: Sound;
  variant: number;
  rank: number;
}

/** Sample edges below these fractions of peak count as silence. */
const LEAD_FLOOR = 0.003;
const TAIL_FLOOR = 0.001;

/** Offline renders at once. Each is a browser thread, and this is someone's laptop. */
const RENDER_THREADS = 2;
const DECODE_THREADS = 4;
/** Longest wait for an idle gap. Long while the world builds, because every job then delays the boot. */
const BOOT_PATIENCE_MS = 250;
const PLAY_PATIENCE_MS = 60;
const URGENT_PATIENCE_MS = 16;
/** Run another job in the same gap only if the browser promises this much of it is left. */
const GAP_MS = 3;

type Idle = (run: (deadline?: IdleDeadline) => void, timeoutMs: number) => void;

const whenIdle: Idle = typeof requestIdleCallback === 'function'
  ? (run, timeout) => requestIdleCallback(run, { timeout })
  : (run, timeout) => setTimeout(run, Math.min(timeout, 32));

export interface BankStats {
  /** Wall time from start to the last sound. */
  loadMs: number;
  /** Main-thread time spent on loading so far. */
  mainMs: number;
  /** Time spent during the boot in jobs the browser had no idle time for. Only this can delay the world build. */
  forcedBootMs: number;
  /** The longest single job, which is the worst a frame can be delayed by. */
  longestMs: number;
  samples: number;
  rendered: number;
}

export class SoundBank {
  private readonly jobs: (() => void)[] = [];
  private readonly renders: RenderTask[] = [];
  private inFlight = 0;
  private pending = 0;
  private scheduled = false;
  private patience = BOOT_PATIENCE_MS;
  private started = 0;
  private finished: (() => void) | null = null;

  readonly stats: BankStats = { loadMs: 0, mainMs: 0, forcedBootMs: 0, longestMs: 0, samples: 0, rendered: 0 };
  /** Seconds of silence cut from the front of each sample, for the report. */
  readonly leadTrim = new Map<string, number>();

  constructor(
    private readonly ac: AudioContext,
    private readonly mixer: Mixer,
    private readonly sounds: ReadonlyMap<string, Sound>,
    private readonly baseUrl: string,
  ) {}

  /** Resolves when every sound has loaded. */
  start(): Promise<void> {
    this.started = performance.now();
    // The rooms go first: every sound after them passes through one.
    for (const room of ROOM_IDS) this.addJob(() => this.mixer.buildRoom(room));

    const samples = sampleDefs();
    this.pending += samples.length;
    let next = 0;
    const decoder = async () => {
      while (next < samples.length) await this.decode(samples[next++]!);
    };
    for (let i = 0; i < DECODE_THREADS; i++) void decoder();

    for (const sound of this.sounds.values()) {
      const { def } = sound;
      if (def.kind !== 'synth') continue;
      for (let variant = 0; variant < def.recipe!.n; variant++) {
        this.renders.push({ sound, variant, rank: renderRank(def, variant) });
      }
    }
    this.pending += this.renders.length;
    this.renders.sort((a, b) => a.rank - b.rank);

    this.schedule();
    return new Promise(resolve => { this.finished = resolve; });
  }

  /** The boot is over, so the only thing left to protect is the frame. */
  bootDone(): void {
    this.patience = PLAY_PATIENCE_MS;
  }

  /** A sound was asked for before it rendered. Its first variant goes next, the rest follow. */
  want(sound: Sound): void {
    if (sound.wanted || sound.def.kind !== 'synth') return;
    sound.wanted = true;
    const mine = this.renders.filter(task => task.sound === sound);
    const rest = this.renders.filter(task => task.sound !== sound);
    this.renders.length = 0;
    this.renders.push(...mine, ...rest);
    this.schedule(URGENT_PATIENCE_MS);
  }

  private addJob(job: () => void): void {
    this.pending++;
    this.jobs.push(job);
  }

  private async decode(def: SoundDef): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}audio/sfx/${def.file}`);
      const data = await response.arrayBuffer();
      const buffer = await this.ac.decodeAudioData(data);
      this.jobs.push(() => {
        const trimmed = trimSilence(buffer);
        this.leadTrim.set(def.id, trimmed.leadSeconds);
        this.sounds.get(def.id)!.buffers = [trimmed.buffer];
        this.stats.samples++;
      });
    } catch (err) {
      console.warn(`[audio] sample failed: ${def.file}`, err);
      this.pending--;
    }
    this.schedule();
  }

  private schedule(patience = this.patience): void {
    if (this.scheduled && patience >= this.patience) return;
    this.scheduled = true;
    whenIdle(this.pump, patience);
  }

  private readonly pump = (deadline?: IdleDeadline): void => {
    this.scheduled = false;
    const forced = !deadline || deadline.didTimeout;
    const began = performance.now();
    while (this.step()) {
      if (forced || deadline.timeRemaining() < GAP_MS) break;
    }
    if (forced && this.patience === BOOT_PATIENCE_MS) this.stats.forcedBootMs += performance.now() - began;
    if (this.pending === 0) this.finish();
    else if (this.jobs.length > 0 || (this.renders.length > 0 && this.inFlight < RENDER_THREADS)) this.schedule();
  };

  /** One job. Ready results go first, so finished work reaches the mix before new work starts. */
  private step(): boolean {
    const job = this.jobs.shift();
    const task = job || this.inFlight >= RENDER_THREADS ? undefined : this.renders.shift();
    if (!job && !task) return false;
    const began = performance.now();
    try {
      if (job) job();
      else this.render(task!);
    } catch (err) {
      console.warn('[audio] load job failed', err);
    }
    if (job) this.pending--;
    const took = performance.now() - began;
    this.stats.mainMs += took;
    if (took > this.stats.longestMs) this.stats.longestMs = took;
    return true;
  }

  private render(task: RenderTask): void {
    const { sound, variant } = task;
    const { recipe } = sound.def;
    this.inFlight++;
    startVariant(recipe!, variant, this.ac.sampleRate).then(raw => {
      this.inFlight--;
      this.jobs.push(() => this.store(sound, raw));
      this.schedule();
    }).catch(err => {
      console.warn(`[audio] render failed: ${sound.def.id}`, err);
      this.inFlight--;
      this.pending--;
      this.schedule();
    });
  }

  private store(sound: Sound, raw: RawRender): void {
    const recipe = sound.def.recipe!;
    const buffer = finishVariant(recipe, raw);
    const buffers = sound.buffers ?? (sound.buffers = []);
    buffers.push(buffer);
    sound.loudSum += loudness(channelsOf(buffer), buffer.sampleRate);
    sound.trim = trimFor(sound.loudSum / buffers.length);
    if (buffers.length === recipe.n) this.stats.rendered++;
  }

  private finish(): void {
    if (!this.finished) return;
    this.stats.loadMs = performance.now() - this.started;
    this.finished();
    this.finished = null;
  }
}

const channelsOf = (buffer: AudioBuffer) => Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));

/** Where a sample's sound begins and ends, in samples. Levels below these fractions of its peak count as silence. */
export function audibleSpan(channels: readonly Float32Array[], sampleRate: number): { start: number; end: number; pad: number } {
  let peak = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]!);
      if (a > peak) peak = a;
    }
  }
  const floor = peak * LEAD_FLOOR;
  const length = channels[0]!.length;
  let start = length;
  let end = 0;
  for (const data of channels) {
    for (let i = 0; i < start; i++) {
      if (Math.abs(data[i]!) > floor) {
        start = i;
        break;
      }
    }
    for (let i = data.length - 1; i > end; i--) {
      if (Math.abs(data[i]!) > peak * TAIL_FLOOR) {
        end = i;
        break;
      }
    }
  }
  const pad = Math.floor(sampleRate * 0.001);
  return { start: Math.max(0, start - pad), end: Math.min(length, end + Math.floor(sampleRate * 0.02)), pad };
}

/**
 * Cuts dead air off both ends of a sample.
 *
 * Nearly every first-game file opens with silence: MP3 encoder padding plus whatever the source had.
 * Measured, the SMG speaks 50 ms after the trigger, the rocket 159 ms, the headshot layers up to 300 ms.
 * That is 3 to 18 frames behind the muzzle flash, and pillar 2 wants them on the same frame. The tail
 * goes too, because silence holds a voice and polyphony caps count it.
 */
function trimSilence(buffer: AudioBuffer): { buffer: AudioBuffer; leadSeconds: number } {
  const channels = channelsOf(buffer);
  const { start, end, pad } = audibleSpan(channels, buffer.sampleRate);
  const length = end - start;
  if (length <= 0) return { buffer, leadSeconds: 0 };
  const out = new AudioBuffer({ length, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
  channels.forEach((data, c) => {
    const part = data.slice(start, end);
    // A hard edge where the cut lands on nonzero audio would click on every shot.
    for (let i = 0; i < pad && i < length; i++) part[i] = part[i]! * (i / pad);
    out.copyToChannel(part, c);
  });
  return { buffer: out, leadSeconds: start / buffer.sampleRate };
}
