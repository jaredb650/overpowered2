/**
 * The squad comms voices, played (docs/design/squad-comms.md, "Build plan" 7; the proposal's section 7). Three pooled `<audio>`
 * elements, so only the clips being heard are ever decoded and the first page load carries none of them: the list of clips is
 * fetched on the first line said, each clip when it is said.
 *
 *   one voice per man   the line carries his voice for life (chatter/voices.ts); co-op guests get the same index from the host
 *   shouts              from his body: louder close, quieter out to EARSHOT, panned left and right; past EARSHOT, not heard
 *   radio               map-wide, through a band-pass (300 Hz to 3.2 kHz) and a soft clip: one dry take serves both
 *   cut-offs            a man killed or hit mid-word stops at once (`cut`), in a 30 ms fade so it does not click
 *   warnings            a critical line (frag, flash, rocket, a pulled pin) plays at full level and pushes the rest down while it lasts;
 *                       a full pool gives up its lowest, oldest line for a higher one, and never for a lower one
 *
 * Where Web Audio is missing (a test) the elements play straight, with no filter or pan.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { RULES } from '../../enemies/outpost/chatter/lines';
import { NAME_LIST } from '../../enemies/outpost/chatter/names';
import { RANK } from '../../enemies/outpost/chatter/rules';
import { VOICED, clipFor, relayClip } from '../../enemies/outpost/chatter/voices';
import type { CommsLine } from '../../enemies/outpost/events';
import type { Settings } from '../settings';

const BASE = 'audio/chatter/';
export const VOICE_POOL = 5;
/** Shouts are heard out to here, full level inside NEAR. */
export const EARSHOT = 65;
const NEAR = 14;
const FAR_LEVEL = 0.42;
/** Other lines under a warning. */
const UNDER_WARNING = 0.38;
const CUT_FADE = 0.03;
/** Voice clips peak around -7 dB while gunfire peaks near -1.5 dB; boost via Web Audio so callouts cut through combat. */
const VOICE_GAIN = 1.65;
/** Makeup gain on the 300–3200 Hz radio bandpass so radio traffic matches direct shouts. */
const RADIO_MAKEUP = 1.35;
/** Recovery guards so a stuck element never leaks a pool slot. */
const LOAD_GRACE = 3.5;
const MAX_PLAY_AGE = 9;

export interface VoiceDeps {
  audio(): HTMLAudioElement;
  list(): Promise<{ clips: string[]; ext?: string }>;
  context(): AudioContext | null;
}

const PAGE: VoiceDeps = {
  audio: () => new Audio(),
  list: async () => {
    const r = await fetch(`${BASE}manifest.json`);
    // No list is a game with no recorded voices: every line stays text.
    return r.ok ? ((await r.json()) as { clips: string[]; ext?: string }) : { clips: [] };
  },
  context: () => {
    try {
      return typeof AudioContext === 'undefined' ? null : new AudioContext({ latencyHint: 'interactive' });
    } catch {
      return null;
    }
  },
};

interface Slot {
  audio: HTMLAudioElement;
  /** Web Audio, when there is any: his level, his side, and how much goes through the radio. */
  gain: GainNode | null;
  pan: StereoPannerNode | null;
  dry: GainNode | null;
  wet: GainNode | null;
  enemy: EnemyInstance | null;
  speaker: string | null;
  rank: number;
  radio: boolean;
  bornAt: number;
  playing: boolean;
  /** Seconds of fade left on a cut, or 0. */
  fade: number;
  /** Monotonic generation counter so an aborted play() from a previous clip cannot kill a newly assigned clip. */
  gen: number;
  lastGain: number;
  lastPan: number;
}

const _v = new THREE.Vector3();
const _eye = new THREE.Vector3();

export class ChatterVoices {
  readonly pool: Slot[] = [];
  private listed: Promise<void> | null = null;
  private ac: AudioContext | null = null;
  private wired = false;
  private unlockBound = false;
  private clock = 0;
  private activeCount = 0;

  constructor(private readonly ctx: Ctx, private readonly settings: Settings, private readonly deps: VoiceDeps = PAGE) {
    for (let i = 0; i < VOICE_POOL; i++) {
      const audio = deps.audio();
      audio.preload = 'auto';
      const slot: Slot = {
        audio, gain: null, pan: null, dry: null, wet: null, enemy: null, speaker: null, rank: 0, radio: false,
        bornAt: 0, playing: false, fade: 0, gen: 0, lastGain: NaN, lastPan: NaN,
      };
      audio.addEventListener('ended', () => {
        if (slot.playing) this.free(slot);
      });
      audio.addEventListener('error', () => {
        if (slot.playing) this.free(slot);
      });
      this.pool.push(slot);
    }
    // Fetch the manifest up front so opening lines do not drop while the first request is in flight.
    void this.load();
  }

  /** The list of clips, fetched once (retried if an earlier fetch failed). */
  load(): Promise<void> {
    if (this.listed) return this.listed;
    const p = this.deps.list().then(m => {
      VOICED.ext = m.ext ?? 'mp3';
      for (const c of m.clips) VOICED.clips.add(c);
    }, () => {
      if (this.listed === p) this.listed = null;
    });
    this.listed = p;
    return p;
  }

  private get level(): number {
    const s = this.settings;
    return s.master * s.sfx * s.voices;
  }

  /** A line said aloud. Plays his take if there is one and he can be heard. */
  say(line: CommsLine): boolean {
    void this.load();
    if (this.level <= 0) return false;
    const voice = line.voice !== undefined && line.voice >= 0 ? line.voice : 0;
    let radio: boolean;
    let clip: string | null;
    let rank: number;
    if (line.row !== undefined && line.row >= 0) {
      const row = RULES[line.row];
      if (!row) return false;
      radio = row.radio || line.radio === true;
      if (!radio && !line.enemy) return false;
      const slots: Record<string, string> = { ...(line.slots ?? {}) };
      if (line.dead !== undefined && line.dead >= 0) slots.dead = NAME_LIST[line.dead]!;
      clip = clipFor(line.row, slots, voice);
      rank = RANK[row.priority];
    } else if (line.clip) {
      radio = line.radio === true;
      if (!radio && !line.enemy) return false;
      clip = relayClip(line.clip, voice);
      rank = RANK.tactical;
    } else {
      return false;
    }
    if (!clip) return false;
    if (!radio && line.enemy && this.distance(line.enemy) > EARSHOT) return false;
    // His own earlier line ends where the new one starts; otherwise a free element, or the lowest and oldest, never for a lower line.
    const speakerTag = !line.enemy && line.speaker ? line.speaker : null;
    let slot = (line.enemy
      ? this.pool.find(p => p.playing && p.enemy === line.enemy)
      : speakerTag
        ? this.pool.find(p => p.playing && !p.enemy && p.speaker === speakerTag)
        : this.pool.find(p => p.playing && !p.enemy && !p.speaker && p.radio))
      ?? this.pool.find(p => !p.playing)
      ?? null;
    if (!slot) {
      for (const p of this.pool) if (p.rank <= rank && (!slot || p.rank < slot.rank || (p.rank === slot.rank && p.bornAt < slot.bornAt))) slot = p;
    }
    if (!slot) return false;
    this.wire();
    const gen = ++slot.gen;
    const wasPlaying = slot.playing;
    slot.audio.pause();
    slot.enemy = line.enemy ?? null;
    slot.speaker = speakerTag;
    slot.rank = rank;
    slot.radio = radio;
    slot.bornAt = this.clock;
    slot.playing = true;
    if (!wasPlaying) this.activeCount++;
    slot.fade = 0;
    slot.lastGain = NaN;
    slot.lastPan = NaN;
    slot.audio.src = `${BASE}${encodeURIComponent(clip)}.${VOICED.ext}`;
    if (slot.dry && slot.wet) {
      slot.dry.gain.value = radio ? 0 : 1;
      slot.wet.gain.value = radio ? RADIO_MAKEUP : 0;
    }
    this.mix();
    this.resumeContext();
    slot.audio.play().catch(() => {
      if (slot.gen === gen) this.free(slot);
    });
    return true;
  }

  /** He was cut off: his voice stops now. */
  cut(enemy: EnemyInstance | null, speaker?: string | null): void {
    if (this.activeCount === 0) return;
    if (enemy) {
      for (const p of this.pool) if (p.playing && p.enemy === enemy && p.fade === 0) p.fade = CUT_FADE;
    } else if (speaker) {
      for (const p of this.pool) if (p.playing && !p.enemy && p.speaker === speaker && p.fade === 0) p.fade = CUT_FADE;
    }
  }

  update(dt: number, paused: boolean): void {
    this.clock += dt;
    if (this.activeCount === 0) return;
    for (const p of this.pool) {
      if (!p.playing) continue;
      if (paused !== p.audio.paused && p.fade === 0) {
        if (paused) p.audio.pause();
        else {
          const gen = p.gen;
          void p.audio.play().catch(() => {
            if (p.gen === gen) this.free(p);
          });
        }
      }
      if (p.fade > 0) {
        p.fade -= dt;
        if (p.fade <= 0) {
          this.free(p);
          continue;
        }
      }
      if (!paused) {
        const age = this.clock - p.bornAt;
        const stalled = age > LOAD_GRACE && typeof p.audio.currentTime === 'number' && p.audio.currentTime === 0;
        if (age > MAX_PLAY_AGE || stalled) this.free(p);
      }
    }
    if (this.activeCount > 0) this.mix();
  }

  /** Levels and sides, every frame: distance and bearing for shouts, the warning on top. */
  private mix(): void {
    let warning = false;
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i]!;
      if (p.playing && p.rank === RANK.critical) { warning = true; break; }
    }
    const camera = this.ctx.render.camera;
    for (const p of this.pool) {
      if (!p.playing) continue;
      if (!p.radio && !p.enemy) continue;
      let level = this.level * (warning && p.rank < RANK.critical ? UNDER_WARNING : 1);
      let side = 0;
      if (!p.radio && p.enemy) {
        const d = this.distance(p.enemy);
        level *= d <= NEAR ? 1 : Math.max(FAR_LEVEL, 1 - ((1 - FAR_LEVEL) * (d - NEAR)) / (EARSHOT - NEAR));
        if (camera instanceof THREE.Camera) {
          _v.copy(p.enemy.center).applyMatrix4(camera.matrixWorldInverse);
          side = THREE.MathUtils.clamp(_v.x / (Math.hypot(_v.x, _v.z) || 1), -1, 1) * 0.8;
        }
      }
      if (p.fade > 0) level *= p.fade / CUT_FADE;
      if (p.gain) {
        const g = level * VOICE_GAIN;
        if (!(Math.abs(g - p.lastGain) <= 1e-3)) {
          p.lastGain = g;
          p.gain.gain.value = g;
        }
      } else {
        const v = THREE.MathUtils.clamp(level, 0, 1);
        if (!(Math.abs(v - p.lastGain) <= 1e-3)) {
          p.lastGain = v;
          p.audio.volume = v;
        }
      }
      if (p.pan && !(Math.abs(side - p.lastPan) <= 1e-3)) {
        p.lastPan = side;
        p.pan.pan.value = side;
      }
    }
  }

  private distance(enemy: EnemyInstance): number {
    const camera = this.ctx.render.camera;
    const at = camera instanceof THREE.Camera ? _eye.setFromMatrixPosition(camera.matrixWorld) : this.ctx.player.eye;
    return enemy.center.distanceTo(at);
  }

  private resumeContext(): void {
    const ac = this.ac;
    if (!ac) return;
    if (ac.state === 'suspended') {
      void ac.resume().catch(() => undefined);
      if (!this.unlockBound && typeof window !== 'undefined') {
        this.unlockBound = true;
        const wake = () => {
          void ac.resume().catch(() => undefined);
          if (ac.state === 'running') {
            window.removeEventListener('pointerdown', wake);
            window.removeEventListener('keydown', wake);
            this.unlockBound = false;
          }
        };
        window.addEventListener('pointerdown', wake);
        window.addEventListener('keydown', wake);
      }
    }
  }

  /** The graph, built once, on the first line played. Shares AudioEngine's AudioContext when available. */
  private wire(): void {
    if (this.wired) return;
    this.wired = true;
    const shared = this.deps === PAGE ? (this.ctx.audio as { context?: AudioContext | null } | undefined)?.context ?? null : null;
    const ac = (this.ac = shared ?? this.deps.context());
    if (!ac) return;
    // The radio: a telephone band and a little grit, shared by every element.
    const low = ac.createBiquadFilter();
    low.type = 'highpass';
    low.frequency.value = 300;
    const high = ac.createBiquadFilter();
    high.type = 'lowpass';
    high.frequency.value = 3200;
    const grit = ac.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 2.2) / Math.tanh(2.2);
    grit.curve = curve;
    low.connect(high).connect(grit).connect(ac.destination);
    for (const p of this.pool) {
      const src = ac.createMediaElementSource(p.audio);
      p.gain = ac.createGain();
      p.pan = ac.createStereoPanner();
      p.dry = ac.createGain();
      p.wet = ac.createGain();
      src.connect(p.gain);
      p.gain.connect(p.dry).connect(p.pan).connect(ac.destination);
      p.gain.connect(p.wet).connect(low);
    }
  }

  private free(p: Slot): void {
    p.gen++;
    if (p.playing) {
      p.playing = false;
      this.activeCount = Math.max(0, this.activeCount - 1);
    }
    p.enemy = null;
    p.speaker = null;
    p.fade = 0;
    p.lastGain = NaN;
    p.lastPan = NaN;
    p.audio.pause();
  }

  reset(): void {
    for (const p of this.pool) if (p.playing) this.free(p);
  }
}
