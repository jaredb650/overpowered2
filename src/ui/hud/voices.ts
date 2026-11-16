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
import { VOICED, clipFor } from '../../enemies/outpost/chatter/voices';
import type { CommsLine } from '../../enemies/outpost/events';
import type { Settings } from '../settings';

const BASE = 'audio/chatter/';
export const VOICE_POOL = 3;
/** Shouts are heard out to here, full level inside NEAR. */
export const EARSHOT = 45;
const NEAR = 8;
const FAR_LEVEL = 0.3;
/** Other lines under a warning. */
const UNDER_WARNING = 0.35;
const CUT_FADE = 0.03;

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
  rank: number;
  radio: boolean;
  bornAt: number;
  playing: boolean;
  /** Seconds of fade left on a cut, or 0. */
  fade: number;
}

const _v = new THREE.Vector3();
const _eye = new THREE.Vector3();

export class ChatterVoices {
  readonly pool: Slot[] = [];
  private listed: Promise<void> | null = null;
  private ac: AudioContext | null = null;
  private wired = false;
  private clock = 0;

  constructor(private readonly ctx: Ctx, private readonly settings: Settings, private readonly deps: VoiceDeps = PAGE) {
    for (let i = 0; i < VOICE_POOL; i++) {
      const audio = deps.audio();
      audio.preload = 'auto';
      const slot: Slot = { audio, gain: null, pan: null, dry: null, wet: null, enemy: null, rank: 0, radio: false, bornAt: 0, playing: false, fade: 0 };
      audio.addEventListener('ended', () => this.free(slot));
      audio.addEventListener('error', () => this.free(slot));
      this.pool.push(slot);
    }
  }

  /** The list of clips, fetched once, on the first line anybody says. */
  load(): Promise<void> {
    return (this.listed ??= this.deps.list().then(m => {
      VOICED.ext = m.ext ?? 'mp3';
      for (const c of m.clips) VOICED.clips.add(c);
    }, () => undefined));
  }

  private get level(): number {
    const s = this.settings;
    return s.master * s.sfx * s.voices;
  }

  /** A line said aloud. Plays his take if there is one and he can be heard. */
  say(line: CommsLine): boolean {
    void this.load();
    if (this.level <= 0 || line.row === undefined || line.row < 0 || !line.enemy) return false;
    const slots: Record<string, string> = { ...(line.slots ?? {}) };
    if (line.dead !== undefined && line.dead >= 0) slots.dead = NAME_LIST[line.dead]!;
    const clip = clipFor(line.row, slots, line.voice ?? -1);
    if (!clip) return false;
    const row = RULES[line.row]!;
    const radio = row.radio;
    if (!radio && this.distance(line.enemy) > EARSHOT) return false;
    const rank = RANK[row.priority];
    // His own earlier line ends where the new one starts; otherwise a free element, or the lowest and oldest, never for a lower line.
    let slot = this.pool.find(p => p.playing && p.enemy === line.enemy) ?? this.pool.find(p => !p.playing) ?? null;
    if (!slot) {
      for (const p of this.pool) if (p.rank <= rank && (!slot || p.rank < slot.rank || (p.rank === slot.rank && p.bornAt < slot.bornAt))) slot = p;
    }
    if (!slot) return false;
    this.wire();
    slot.audio.pause();
    slot.enemy = line.enemy;
    slot.rank = rank;
    slot.radio = radio;
    slot.bornAt = this.clock;
    slot.playing = true;
    slot.fade = 0;
    slot.audio.src = `${BASE}${encodeURIComponent(clip)}.${VOICED.ext}`;
    if (slot.dry && slot.wet) {
      slot.dry.gain.value = radio ? 0 : 1;
      slot.wet.gain.value = radio ? 1 : 0;
    }
    this.mix();
    void this.ac?.resume().catch(() => undefined);
    slot.audio.play().catch(() => this.free(slot));
    return true;
  }

  /** He was cut off: his voice stops now. */
  cut(enemy: EnemyInstance): void {
    for (const p of this.pool) if (p.playing && p.enemy === enemy && p.fade === 0) p.fade = CUT_FADE;
  }

  update(dt: number, paused: boolean): void {
    this.clock += dt;
    for (const p of this.pool) {
      if (!p.playing) continue;
      if (paused !== p.audio.paused && p.fade === 0) {
        if (paused) p.audio.pause();
        else void p.audio.play().catch(() => this.free(p));
      }
      if (p.fade > 0) {
        p.fade -= dt;
        if (p.fade <= 0) this.free(p);
      }
    }
    this.mix();
  }

  /** Levels and sides, every frame: distance and bearing for shouts, the warning on top. */
  private mix(): void {
    const warning = this.pool.some(p => p.playing && p.rank === RANK.critical);
    const camera = this.ctx.render.camera;
    for (const p of this.pool) {
      if (!p.playing || !p.enemy) continue;
      let level = this.level * (warning && p.rank < RANK.critical ? UNDER_WARNING : 1);
      let side = 0;
      if (!p.radio) {
        const d = this.distance(p.enemy);
        level *= d <= NEAR ? 1 : Math.max(FAR_LEVEL, 1 - ((1 - FAR_LEVEL) * (d - NEAR)) / (EARSHOT - NEAR));
        if (camera instanceof THREE.Camera) {
          _v.copy(p.enemy.center).applyMatrix4(camera.matrixWorldInverse);
          side = THREE.MathUtils.clamp(_v.x / (Math.hypot(_v.x, _v.z) || 1), -1, 1) * 0.8;
        }
      }
      if (p.fade > 0) level *= p.fade / CUT_FADE;
      if (p.gain) p.gain.gain.value = level;
      else p.audio.volume = THREE.MathUtils.clamp(level, 0, 1);
      if (p.pan) p.pan.pan.value = side;
    }
  }

  private distance(enemy: EnemyInstance): number {
    const camera = this.ctx.render.camera;
    const at = camera instanceof THREE.Camera ? _eye.setFromMatrixPosition(camera.matrixWorld) : this.ctx.player.eye;
    return enemy.center.distanceTo(at);
  }

  /** The graph, built once, on the first line played. */
  private wire(): void {
    if (this.wired) return;
    this.wired = true;
    const ac = (this.ac = this.deps.context());
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
    p.playing = false;
    p.enemy = null;
    p.fade = 0;
    p.audio.pause();
  }

  reset(): void {
    for (const p of this.pool) if (p.playing) this.free(p);
  }
}
