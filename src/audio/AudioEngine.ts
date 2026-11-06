/**
 * The audio system. Owns the context, the sound bank, voices and the rules for who gets to be heard.
 *
 * It is safe from the first call. Before the context is unlocked or a buffer has rendered, a one-shot
 * is simply not played, rather than piling up to fire all at once on the first click.
 */
import * as THREE from 'three';
import type {
  AudioSystem, Ctx, LoopHandle, LoopOptions, MusicState, PlayOptions, SoundLayer,
} from '../core/contracts';
import { clamp, damp, rand } from '../core/math';
import { arbitrate } from './allocator';
import { SoundBank, type Sound } from './bank';
import { ALIASES, CATALOG, lookup, synthCount, type SoundDef } from './catalog';
import { PlayerFoley } from './foley';
import { Mixer } from './mixer';
import { MusicPlayer } from './music';
import { Reactions } from './reactions';
import { roomForZone, type RoomId } from './reverb';
import { DEAD_HANDLE, Voice, VoiceHandle, airCutoff, attenuation, wetness } from './voices';

/** Hard caps. Plenty for the mix, and a ceiling on audio-thread work. */
const VOICES_3D = 48;
const VOICES_2D = 32;
const VOICES_UI = 10;
/** HRTF convolves per voice, so only a few close sounds get it. */
const MAX_HRTF = 6;
const HRTF_RANGE = 18;
/** Below this linear level a 3D sound is not worth a voice. */
const CULL_LEVEL = 0.004;
const SPEED_OF_SOUND = 343;
const DEVICE_PATIENCE_MS = 6000;
/** How fast sounds still ringing recover from slow-mo when a run ends in the middle of one, per second. */
const RUN_END_RATE_RECOVERY = 5;
/** How long every loop in the world takes to die away when a run ends. */
const RUN_END_FADE = 0.8;
/** Past this range the delay is audible as distance rather than as lag. */
const AIR_DELAY_MIN = 40;
/** Layers get a shared start slightly ahead, so they all land on one audio frame. */
const LAYER_LEAD = 0.008;
const NO_OPTIONS: PlayOptions = {};
const NO_TRIM: ReadonlyMap<string, number> = new Map();
const NO_LAYER: SoundLayer = { id: '' };

export interface AudioStats {
  state: AudioContextState | 'none';
  ready: boolean;
  samples: number;
  rendered: number;
  total: number;
  voices3d: number;
  voices2d: number;
  voicesUi: number;
  hrtf: number;
  loops: number;
  played: number;
  stolen: number;
  dropped: number;
  culled: number;
  collapsed: number;
  /** Asked for before it had rendered. Should stay near zero in a normal run. */
  missed: number;
  room: RoomId | null;
  duck: number;
  peakPre: number;
  peakPost: number;
  /** Main-thread time spent setting up, not counting the sounds. */
  initMs: number;
  /** Wall time until the last sound landed, and main-thread time spent getting there. */
  loadMs: number;
  loadMainMs: number;
  /** The part of `loadMainMs` the boot could feel: jobs run because their wait ran out, not in idle time. */
  loadForcedBootMs: number;
  loadLongestMs: number;
}

export class AudioEngine implements AudioSystem {
  private ac: AudioContext | null = null;
  private mixer: Mixer | null = null;
  private musicPlayer: MusicPlayer | null = null;
  private foley: PlayerFoley | null = null;
  private reactions: Reactions | null = null;

  private readonly sounds = new Map<string, Sound>();
  private readonly voices3d: Voice[] = [];
  private readonly voices2d: Voice[] = [];
  private readonly voicesUi: Voice[] = [];
  private readonly free3d: Voice[] = [];
  private readonly free2d: Voice[] = [];
  private readonly freeUi: Voice[] = [];

  private readonly listener = new THREE.Vector3();
  private listenerFrame = -1;
  private order = 0;
  private slowmo = 1;
  private hrtfActive = 0;
  private warned = new Set<string>();
  private zoneTimer = 0;
  private bed: LoopHandle = DEAD_HANDLE;
  private bedRoom: RoomId | null = null;
  private inRun = false;

  /** Resolves once the context and mixer exist. Only sandboxes need this. */
  opened: Promise<void> = Promise.resolve();
  /** Resolves when every sound has loaded. Nothing has to wait for it. */
  ready: Promise<void> = Promise.resolve();
  private loaded = false;
  private initMs = 0;
  private bank: SoundBank | null = null;
  private readonly deviceWarm: Promise<unknown>;
  /** Requests made before the context exists, which are applied when it does. */
  private wanted: { music: MusicState | null; volumes: readonly [number, number, number] | null } = { music: null, volumes: null };
  private booted = false;
  private counts = { played: 0, stolen: 0, dropped: 0, culled: 0, collapsed: 0, missed: 0 };

  constructor(private readonly ctx: Ctx) {
    // The first AudioContext in a page blocks the main thread for a second or more while the browser brings up
    // its audio service. Listing devices starts that same service without blocking, so this runs as early as
    // anything can, the context is only made once it answers, and the wait is spent building the world instead.
    this.deviceWarm = navigator.mediaDevices?.enumerateDevices?.() ?? Promise.resolve();
  }

  // -------------------------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------------------------

  init(): void {
    const started = performance.now();
    for (const def of CATALOG.values()) {
      this.sounds.set(def.id, { def, buffers: null, trim: 1, loudSum: 0, lastPick: -1, lastFrame: -1, frameCount: 0, wanted: false });
    }
    this.foley = new PlayerFoley(this.ctx, this);
    this.reactions = new Reactions(this.ctx, this);
    this.wireEvents();

    // Browsers need a gesture before audio starts. Listening here means nobody else has to remember to.
    const gesture = () => this.unlock();
    window.addEventListener('pointerdown', gesture, { once: true, capture: true });
    window.addEventListener('keydown', gesture, { once: true, capture: true });
    document.addEventListener('visibilitychange', () => {
      const ac = this.ac;
      if (!ac || ac.state === 'closed' || !this.unlocked) return;
      void (document.hidden ? ac.suspend() : ac.resume());
    });

    // A device list that never answers must not cost the game its sound.
    const patience = new Promise(resolve => { setTimeout(resolve, DEVICE_PATIENCE_MS); });
    const open = () => this.open();
    this.opened = Promise.race([this.deviceWarm, patience]).then(open, open);
    this.ready = this.opened.then(() => this.bank?.start()).then(() => { this.loaded = true; });
    this.initMs = performance.now() - started;
  }

  /** Everything that needs the context. All public methods are safe until this has run. */
  private open(): void {
    const started = performance.now();
    let ac: AudioContext;
    try {
      ac = new AudioContext({ latencyHint: 'interactive' });
    } catch (err) {
      console.warn('[audio] no audio output, running silent', err);
      return;
    }
    this.ac = ac;
    const mixer = new Mixer(ac);
    this.mixer = mixer;

    const pool = (count: number, spatial: boolean, output: AudioNode, reverb: AudioNode | null, all: Voice[], free: Voice[]) => {
      for (let i = 0; i < count; i++) {
        const v = new Voice(ac, output, reverb, spatial, voice => {
          if (voice.hrtf) {
            voice.hrtf = false;
            this.hrtfActive--;
          }
          free.push(voice);
        });
        all.push(v);
        free.push(v);
      }
    };
    pool(VOICES_3D, true, mixer.sfxIn, mixer.reverbIn, this.voices3d, this.free3d);
    pool(VOICES_2D, false, mixer.sfxIn, mixer.reverbIn, this.voices2d, this.free2d);
    pool(VOICES_UI, false, mixer.uiIn, null, this.voicesUi, this.freeUi);
    // The first HRTF voice would be silent while the browser loads its database, so start that now.
    this.voices3d[0]!.panner!.panningModel = 'HRTF';

    const base = import.meta.env.BASE_URL;
    this.musicPlayer = new MusicPlayer(ac, mixer.musicIn, base);
    this.musicPlayer.load().catch(err => console.warn('[audio] music manifest failed', err));
    this.bank = new SoundBank(ac, mixer, this.sounds, base);
    if (this.booted) this.bank.bootDone();

    const { music, volumes } = this.wanted;
    if (volumes) mixer.setVolumes(...volumes);
    if (music) this.musicPlayer.setState(music);
    if (this.unlocked) this.unlock();
    this.initMs += performance.now() - started;
  }

  private unlocked = false;

  unlock(): void {
    this.unlocked = true;
    const ac = this.ac;
    if (!ac) return;
    if (ac.state === 'suspended') void ac.resume();
    this.musicPlayer?.unlock();
  }

  private wireEvents(): void {
    const { events } = this.ctx;
    events.on('game:state', ({ from, to }) => {
      this.booted = true;
      this.bank?.bootDone();
      const paused = to === 'paused';
      this.mixer?.setPaused(paused);
      if (paused) this.musicPlayer?.pause();
      else this.musicPlayer?.resume();
      if (to === 'playing' && from !== 'paused') this.inRun = true;
      if (to === 'menu' || to === 'gameover') {
        this.music('menu');
        this.endRun();
      }
    });
    events.on('run:start', () => this.music('easy'));
    events.on('wave:start', ({ wave }) => { if (wave >= 10) this.music('hard'); });
  }

  /** Frames stop updating the systems that own loops, so nothing else will ever stop them. */
  private endRun(): void {
    this.inRun = false;
    this.stopLoops(RUN_END_FADE);
    this.foley?.reset();
    this.reactions?.reset();
  }

  private stopLoops(seconds: number): void {
    for (const v of this.voices3d) if (v.loop) v.stop(seconds);
    for (const v of this.voices2d) if (v.loop) v.stop(seconds);
    this.bed = DEAD_HANDLE;
    this.bedRoom = null;
  }

  reset(): void {
    this.stopLoops(0.1);
    this.foley?.reset();
    this.reactions?.reset();
    this.mixer?.setPaused(false);
  }

  // -------------------------------------------------------------------------------------------
  // Public playback
  // -------------------------------------------------------------------------------------------

  private find(id: string): Sound | undefined {
    const sound = this.sounds.get(ALIASES[id] ?? id);
    if (!sound && this.ac && !this.warned.has(id)) {
      this.warned.add(id);
      console.warn(`[audio] unknown sound id "${id}"`);
    }
    return sound;
  }

  has(id: string): boolean {
    return lookup(id) !== undefined;
  }

  play(id: string, options: PlayOptions = NO_OPTIONS): void {
    const sound = this.find(id);
    if (!sound) return;
    const { def } = sound;
    if (def.kind === 'stack') {
      this.layer(def.layers!, options);
      return;
    }
    if (def.kind === 'group') {
      const members = def.members!;
      let i = Math.floor(Math.random() * members.length);
      if (i === sound.lastPick) i = (i + 1) % members.length;
      sound.lastPick = i;
      this.play(members[i]!, options);
      return;
    }
    this.startVoice(sound, options, NO_LAYER, 0);
  }

  playOneOf(ids: readonly string[], options?: PlayOptions): void {
    if (ids.length > 0) this.play(ids[Math.floor(Math.random() * ids.length)]!, options);
  }

  layer(layers: readonly SoundLayer[], options: PlayOptions = NO_OPTIONS): void {
    const ac = this.ac;
    if (!ac) return;
    const when = ac.currentTime + LAYER_LEAD;
    for (const layer of layers) {
      const sound = this.find(layer.id);
      if (sound && sound.def.kind !== 'stack' && sound.def.kind !== 'group') this.startVoice(sound, options, layer, when);
    }
  }

  startLoop(id: string, options: LoopOptions = NO_OPTIONS): LoopHandle {
    const sound = this.find(id);
    if (!sound) return DEAD_HANDLE;
    const voice = this.startVoice(sound, options, NO_LAYER, 0);
    if (!voice) return DEAD_HANDLE;
    voice.useDoppler = options.doppler === true && voice.spatial;
    return new VoiceHandle(voice, sound.def.volume * sound.trim, sound.def.fadeOut);
  }

  duck(amount: number, seconds: number): void {
    this.mixer?.duck(amount, seconds);
  }

  music(state: MusicState): void {
    this.wanted.music = state;
    this.musicPlayer?.setState(state);
  }

  setVolumes(master: number, sfx: number, music: number): void {
    this.wanted.volumes = [master, sfx, music];
    this.mixer?.setVolumes(master, sfx, music);
  }

  setListener(position: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3): void {
    const ac = this.ac;
    if (!ac) return;
    this.listenerFrame = this.ctx.time.frame;
    this.applyListener(position.x, position.y, position.z, forward.x, forward.y, forward.z, up.x, up.y, up.z);
  }

  private applyListener(x: number, y: number, z: number, fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void {
    this.listener.set(x, y, z);
    const l = this.ac!.listener;
    // Firefox has only the deprecated setters.
    if (!l.positionX) {
      l.setPosition(x, y, z);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
      return;
    }
    l.positionX.value = x;
    l.positionY.value = y;
    l.positionZ.value = z;
    l.forwardX.value = fx;
    l.forwardY.value = fy;
    l.forwardZ.value = fz;
    l.upX.value = ux;
    l.upY.value = uy;
    l.upZ.value = uz;
  }

  // -------------------------------------------------------------------------------------------
  // Voices
  // -------------------------------------------------------------------------------------------

  private pickBuffer(sound: Sound): AudioBuffer | null {
    const buffers = sound.buffers;
    if (!buffers || buffers.length === 0) return null;
    if (buffers.length === 1) return buffers[0]!;
    let i = Math.floor(Math.random() * buffers.length);
    if (i === sound.lastPick) i = (i + 1) % buffers.length;
    sound.lastPick = i;
    return buffers[i]!;
  }

  private claim(def: SoundDef, pool: Voice[], free: Voice[]): Voice | null {
    const decision = arbitrate(pool, def);
    if (decision.kind === 'drop') {
      this.counts.dropped++;
      return null;
    }
    if (decision.kind === 'steal') {
      this.counts.stolen++;
      const victim = decision.victim;
      victim.steal();
      // Its fade finishes on the audio thread. Until then the slot is busy, so take another if one is free.
      if (free.length === 0) {
        if (victim.hrtf) {
          victim.hrtf = false;
          this.hrtfActive--;
        }
        victim.cut();
        return victim;
      }
    }
    return free.pop() ?? null;
  }

  private startVoice(sound: Sound, options: PlayOptions | LoopOptions, layer: SoundLayer, sharedWhen: number): Voice | null {
    const ac = this.ac;
    if (!ac || ac.state !== 'running' && !sound.def.loop) return null;
    const { def } = sound;
    const buffer = this.pickBuffer(sound);
    if (!buffer) {
      this.counts.missed++;
      this.bank!.want(sound);
      return null;
    }

    const frame = this.ctx.time.frame;
    if (sound.lastFrame === frame) {
      if (sound.frameCount >= def.perFrame) {
        this.counts.collapsed++;
        return null;
      }
      sound.frameCount++;
    } else {
      sound.lastFrame = frame;
      sound.frameCount = 1;
    }

    const position = def.bus === 'ui' ? undefined : options.position;
    let delay = (options as PlayOptions).delay ?? 0;
    delay += layer.delay ?? 0;
    let attenuated = 1;
    let distance = 0;
    if (position) {
      distance = position.distanceTo(this.listener);
      attenuated = attenuation(distance, def.near, def.far);
      if (attenuated * def.volume * sound.trim * (options.volume ?? 1) < CULL_LEVEL && !def.loop) {
        this.counts.culled++;
        return null;
      }
      if (def.airDelay && distance > AIR_DELAY_MIN) delay += distance / SPEED_OF_SOUND;
    }

    const pool = def.bus === 'ui' ? this.voicesUi : position ? this.voices3d : this.voices2d;
    const free = def.bus === 'ui' ? this.freeUi : position ? this.free3d : this.free2d;
    const voice = this.claim(def, pool, free);
    if (!voice) return null;

    const jitter = (options as PlayOptions).pitchJitter ?? def.pitchJitter;
    let pitch = (options.pitch ?? 1) * (layer.pitch ?? 1);
    if (jitter > 0) pitch *= 1 + rand(-jitter, jitter);
    const exempt = options.unaffectedByTime === true || def.exempt;
    const gain = def.volume * sound.trim * (options.volume ?? 1) * (layer.volume ?? 1);
    const when = sharedWhen > 0 ? sharedWhen + delay : ac.currentTime + delay;
    const offset = (options as PlayOptions).offset ?? layer.offset ?? 0;
    const duration = (options as PlayOptions).duration ?? layer.duration ?? 0;
    const fadeIn = def.loop ? (options as LoopOptions).fadeIn ?? def.fadeIn : 0;

    voice.begin(def, buffer, gain, pitch, this.slowmo, exempt, ++this.order, when, offset, duration, fadeIn);
    voice.loudness = gain * attenuated;
    this.counts.played++;

    if (position) {
      voice.spatial = true;
      voice.place(position.x, position.y, position.z);
      voice.anchor();
      voice.applyDistance(attenuated, airCutoff(distance), def.send * wetness(distance, def.near, attenuated), 0);
      const wantHrtf = def.hrtf && distance < HRTF_RANGE && this.hrtfActive < MAX_HRTF;
      voice.panner!.panningModel = wantHrtf ? 'HRTF' : 'equalpower';
      if (wantHrtf) {
        voice.hrtf = true;
        this.hrtfActive++;
      }
    } else if (voice.send) {
      voice.setSend(def.send);
    }

    if (def.duck) this.mixer!.duck(def.duck[0] * clamp(attenuated * 1.5), def.duck[1]);
    return voice;
  }

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------

  update(): void {
    const ac = this.ac;
    const mixer = this.mixer;
    if (!ac || !mixer) return;
    const { time, player, render } = this.ctx;
    const realDt = time.realDt;

    // Normally CameraRig feeds this after moving the camera. A fallback keeps sound right without it.
    if (this.listenerFrame !== time.frame) {
      const cam = render.camera;
      const e = cam?.matrixWorld?.elements;
      if (e && typeof e[12] === 'number') this.applyListener(e[12]!, e[13]!, e[14]!, -e[8]!, -e[9]!, -e[10]!, e[4]!, e[5]!, e[6]!);
    }

    // Dying in slow-mo leaves the clock slowed, and the menus after it must not inherit that.
    const slowmo = this.inRun ? time.slowmo : damp(this.slowmo, 1, RUN_END_RATE_RECOVERY, realDt);
    const rateChanged = Math.abs(slowmo - this.slowmo) > 0.0005;
    this.slowmo = slowmo;

    const l = this.listener;
    for (const v of this.voices3d) {
      if (v.soundId === null || v.releasing) continue;
      const dirty = v.stepPitch(realDt, l.x, l.y, l.z);
      if (rateChanged || dirty) v.setRate(slowmo);
      const def = v.def!;
      const dx = v.x - l.x;
      const dy = v.y - l.y;
      const dz = v.z - l.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const a = attenuation(d, def.near, def.far);
      // At 45 m/s a long sound changes distance fast enough that fixing its level at the start would be wrong.
      v.applyDistance(a, airCutoff(d), def.send * wetness(d, def.near, a), 0.03);
    }
    for (const v of this.voices2d) {
      if (v.soundId === null || v.releasing) continue;
      const dirty = v.stepPitch(realDt, l.x, l.y, l.z);
      if (rateChanged || dirty) v.setRate(slowmo);
    }

    if (this.inRun) {
      this.foley?.update(realDt);
      if (!time.paused) this.reactions?.update(time.dt, mixer.currentRoom);
    }
    mixer.update(realDt, slowmo, this.inRun ? this.foley?.lowHealth ?? 0 : 0);
    this.musicPlayer?.update(realDt);

    this.zoneTimer -= realDt;
    if (this.zoneTimer <= 0) {
      this.zoneTimer = 0.25;
      this.updateZone(player.position);
    }
  }

  /** Runs the room and its bed from where the player is. */
  private updateZone(position: THREE.Vector3): void {
    const world = this.ctx.world;
    if (!position || typeof position.x !== 'number' || typeof world.zoneAt !== 'function') return;
    const zone = world.zoneAt(position);
    const id = typeof zone?.id === 'string' ? zone.id : null;
    this.setRoom(roomForZone(id));
  }

  /** Public for sandboxes and for anything scripted that wants a specific room. */
  setRoom(room: RoomId): void {
    this.mixer?.setRoom(room);
    if (!this.inRun || (room === this.bedRoom && this.bed.alive)) return;
    this.bedRoom = room;
    this.bed.stop();
    // Dead until the bed has rendered. The zone check calls back here, so it comes up on its own.
    this.bed = this.startLoop(`amb_${room}`);
  }

  // -------------------------------------------------------------------------------------------
  // Introspection
  // -------------------------------------------------------------------------------------------

  /** Buffers behind an id, for the report and the sandbox. */
  buffersOf(id: string): readonly AudioBuffer[] {
    return this.sounds.get(ALIASES[id] ?? id)?.buffers ?? [];
  }

  /** The level an id actually plays at. */
  levelOf(id: string): number {
    const sound = this.sounds.get(ALIASES[id] ?? id);
    return sound ? sound.def.volume * sound.trim : 0;
  }

  get mixerForTests(): Mixer | null { return this.mixer; }
  get musicForTests(): MusicPlayer | null { return this.musicPlayer; }
  get contextForTests(): AudioContext | null { return this.ac; }

  /** Seconds of silence cut from the front of each sample, for the report. */
  get leadTrim(): ReadonlyMap<string, number> { return this.bank?.leadTrim ?? NO_TRIM; }

  stats(): AudioStats {
    const bank = this.bank;
    const busy = (voices: Voice[]) => voices.reduce((n, v) => n + (v.soundId !== null && !v.releasing ? 1 : 0), 0);
    const loops = [...this.voices3d, ...this.voices2d].reduce((n, v) => n + (v.loop && !v.releasing ? 1 : 0), 0);
    return {
      state: this.ac?.state ?? 'none',
      ready: this.loaded,
      samples: bank?.stats.samples ?? 0,
      rendered: bank?.stats.rendered ?? 0,
      total: synthCount(),
      voices3d: busy(this.voices3d),
      voices2d: busy(this.voices2d),
      voicesUi: busy(this.voicesUi),
      hrtf: this.hrtfActive,
      loops,
      played: this.counts.played,
      stolen: this.counts.stolen,
      dropped: this.counts.dropped,
      culled: this.counts.culled,
      collapsed: this.counts.collapsed,
      missed: this.counts.missed,
      room: this.mixer?.currentRoom ?? null,
      duck: this.mixer?.duckValue ?? 0,
      peakPre: this.mixer?.peakPre ?? 0,
      peakPost: this.mixer?.peakPost ?? 0,
      initMs: this.initMs,
      loadMs: bank?.stats.loadMs ?? 0,
      loadMainMs: bank?.stats.mainMs ?? 0,
      loadForcedBootMs: bank?.stats.forcedBootMs ?? 0,
      loadLongestMs: bank?.stats.longestMs ?? 0,
    };
  }
}
