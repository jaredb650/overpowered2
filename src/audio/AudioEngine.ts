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
import { LoadGovernor, quietFloor, repeatGap } from './budget';
import { ALIASES, CATALOG, lookup, synthCount, type SoundDef } from './catalog';
import { PlayerFoley } from './foley';
import { Mixer } from './mixer';
import { MusicPlayer } from './music';
import { Reactions } from './reactions';
import { roomForZone, type RoomId } from './reverb';
import { DEAD_HANDLE, Voice, VoiceHandle, airCutoff, attenuation, kRate, wetness } from './voices';

/**
 * Pool sizes are the ceiling. `VOICE_BUDGETS` in budget.ts is what the 3D and 2D pools may use together, which the
 * load governor lowers. Every pooled chain costs the render thread a little even when silent, so spares are not free.
 */
const VOICES_3D = 32;
const VOICES_2D = 18;
const VOICES_UI = 6;
/** The 3D voices that are HRTF for life. HRTF convolves per voice, so only a few close sounds get it. */
const HRTF_VOICES = 3;
const HRTF_RANGE = 14;
/** The 3D pool is never squeezed below this by 2D sounds, or a fight would have no world in it. */
const MIN_VOICES_3D = 8;
/** Voices past the budget are let go at this rate, so a lower budget does not cut a dozen sounds on one frame. */
const SHED_FADE = 0.06;
/** Seconds between load measurements. Long enough that timer jitter cannot read as a late clock. */
const LOAD_WINDOW = 1;
/** Distance is rewritten for a voice every this many frames, in turn: at 60 fps that is still 15 times a second. */
const DISTANCE_STRIDE = 4;
/** Seconds between looks for voices whose end never came, and between tries at waking a stopped context. */
const SWEEP_SECONDS = 0.5;
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

/** One bank of voices and the ones not in use. HRTF voices wait apart, so only the sounds that want them get them. */
interface Pool {
  all: Voice[];
  free: Voice[];
  freeHrtf: Voice[];
}

const emptyPool = (): Pool => ({ all: [], free: [], freeHrtf: [] });

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
  /** Refused a voice: `droppedBudget` plus `droppedFamily`. */
  dropped: number;
  droppedBudget: number;
  droppedFamily: number;
  /** Too quiet to be worth a voice even in an empty mix. */
  culled: number;
  /** Second and later plays of an id on one frame. */
  collapsed: number;
  /** Skipped because the mix was crowded and this one would have been lost in it. */
  thinnedQuiet: number;
  thinnedRepeat: number;
  /** One-shots asked for while the context was not running. */
  notRunning: number;
  /** Requests with a NaN or infinite position, level, pitch or delay. */
  invalid: number;
  /** Voices taken back because their end event never arrived. */
  reclaimed: number;
  /** Asked for before it had rendered. Should stay near zero in a normal run. */
  missed: number;
  /** Voices the 3D and 2D pools may use together right now. */
  budget: number;
  /** 0 is normal. Above that the load governor has taken voices away. */
  loadStep: number;
  /** Audio seconds per wall second. Below 1 the render thread is not keeping up. */
  clockRate: number;
  underrunShare: number;
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
  private readonly pool3d = emptyPool();
  private readonly pool2d = emptyPool();
  private readonly poolUi = emptyPool();
  private readonly pools: readonly Pool[] = [this.pool3d, this.pool2d, this.poolUi];
  private readonly governor = new LoadGovernor();
  /** When each family last started, on the audio clock. */
  private readonly familyStart = new Map<string, number>();
  /** Voices sounding in the 3D and 2D pools: refreshed each frame and counted up on every start. */
  private active = 0;
  private active2d = 0;
  private sweepClock = 0;
  private loadClock = LOAD_WINDOW;
  private loadWall = 0;
  private loadAudio = 0;
  private loadUnderrun = 0;
  private loadTotal = 0;

  private readonly listener = new THREE.Vector3();
  private listenerFrame = -1;
  private order = 0;
  private slowmo = 1;
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
  private counts = {
    played: 0, stolen: 0, droppedBudget: 0, droppedFamily: 0, culled: 0, collapsed: 0, thinnedQuiet: 0, thinnedRepeat: 0,
    notRunning: 0, invalid: 0, reclaimed: 0, missed: 0,
  };

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

    // Browsers need a gesture before audio starts. Listening here means nobody else has to remember to, and it never
    // stops listening, because a context that loses its device or is interrupted can need a gesture again mid-run.
    const gesture = () => this.unlock();
    window.addEventListener('pointerdown', gesture, { capture: true });
    window.addEventListener('keydown', gesture, { capture: true });
    document.addEventListener('visibilitychange', () => {
      const ac = this.ac;
      if (!ac || ac.state === 'closed' || !this.unlocked) return;
      void (document.hidden ? ac.suspend() : ac.resume());
    });
    this.publishStats();

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

    const fill = (pool: Pool, count: number, spatial: boolean, output: AudioNode, reverb: AudioNode | null, hrtf = 0) => {
      for (let i = 0; i < count; i++) {
        const home = i < hrtf ? pool.freeHrtf : pool.free;
        const v = new Voice(ac, output, reverb, spatial, i < hrtf, voice => { home.push(voice); });
        pool.all.push(v);
        home.push(v);
      }
    };
    // Building the HRTF voices here also starts the browser loading its database, which would otherwise cost the
    // first close sound of the run its attack.
    fill(this.pool3d, VOICES_3D, true, mixer.sfxIn, mixer.reverbIn, HRTF_VOICES);
    fill(this.pool2d, VOICES_2D, false, mixer.sfxIn, mixer.reverbIn);
    fill(this.poolUi, VOICES_UI, false, mixer.uiIn, null);

    // A moving listener puts every panner on the sample-accurate path unless these are k-rate too. See voices.ts.
    const l = ac.listener;
    if (l.positionX) kRate(l.positionX, l.positionY, l.positionZ, l.forwardX, l.forwardY, l.forwardZ, l.upX, l.upY, l.upZ);
    this.loadAudio = ac.currentTime;
    this.loadWall = performance.now();

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
    for (const v of this.pool3d.all) if (v.loop) v.stop(seconds);
    for (const v of this.pool2d.all) if (v.loop) v.stop(seconds);
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
    // A sample that failed to load, or has not landed yet, still has something to say.
    if (!sound.buffers && def.fallback) {
      this.play(def.fallback, options);
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

  private claim(def: SoundDef, pool: Pool, limit: number, wantHrtf: boolean): Voice | null {
    const decision = arbitrate(pool.all, def, limit);
    if (decision.kind === 'drop') {
      if (decision.reason === 'family') this.counts.droppedFamily++;
      else this.counts.droppedBudget++;
      return null;
    }
    if (decision.kind === 'steal') {
      this.counts.stolen++;
      const victim = decision.victim;
      victim.steal();
      // Its fade finishes on the audio thread. Until then the slot is busy, so take another if one is free.
      if (pool.free.length === 0 && pool.freeHrtf.length === 0) {
        victim.cut();
        return victim;
      }
    }
    return (wantHrtf ? pool.freeHrtf.pop() : undefined) ?? pool.free.pop() ?? pool.freeHrtf.pop() ?? null;
  }

  /** Whether a crowded mix can do without this. Critical sounds never reach here. */
  private thin(def: SoundDef, level: number, now: number): boolean {
    const pressure = this.active / this.governor.budget;
    if (level < quietFloor(pressure)) {
      this.counts.thinnedQuiet++;
      return true;
    }
    const family = def.family;
    if (family === undefined) return false;
    const gap = repeatGap(pressure);
    if (gap > 0 && now - (this.familyStart.get(family) ?? -1) < gap) {
      this.counts.thinnedRepeat++;
      return true;
    }
    this.familyStart.set(family, now);
    return false;
  }

  private startVoice(sound: Sound, options: PlayOptions | LoopOptions, layer: SoundLayer, sharedWhen: number): Voice | null {
    const ac = this.ac;
    if (!ac) return null;
    const { def } = sound;
    if (ac.state !== 'running' && !def.loop) {
      this.counts.notRunning++;
      return null;
    }
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
      if (def.airDelay && distance > AIR_DELAY_MIN) delay += distance / SPEED_OF_SOUND;
    }

    const jitter = (options as PlayOptions).pitchJitter ?? def.pitchJitter;
    let pitch = (options.pitch ?? 1) * (layer.pitch ?? 1);
    if (jitter > 0) pitch *= 1 + rand(-jitter, jitter);
    const gain = def.volume * sound.trim * (options.volume ?? 1) * (layer.volume ?? 1);
    // The param setters and start() throw on these, which would leave a voice claimed and never started.
    if (!Number.isFinite(gain + pitch + delay + attenuated + (position ? position.x + position.y + position.z : 0))) {
      this.counts.invalid++;
      return null;
    }

    const now = ac.currentTime;
    if (!def.loop && !def.critical) {
      if (position && attenuated * gain < quietFloor(0)) {
        this.counts.culled++;
        return null;
      }
      if (this.thin(def, attenuated * gain, now)) return null;
    }

    const ui = def.bus === 'ui';
    const pool = ui ? this.poolUi : position ? this.pool3d : this.pool2d;
    const limit = ui || !position ? pool.all.length : Math.max(MIN_VOICES_3D, this.governor.budget - this.active2d);
    const wantHrtf = def.hrtf && distance < HRTF_RANGE && this.governor.step === 0;
    const voice = this.claim(def, pool, limit, wantHrtf);
    if (!voice) return null;
    if (!ui) {
      this.active++;
      if (!position) this.active2d++;
    }

    const exempt = options.unaffectedByTime === true || def.exempt;
    const when = sharedWhen > 0 ? sharedWhen + delay : now + delay;
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
    const voices3d = this.pool3d.all;
    let active3d = 0;
    for (let i = 0; i < voices3d.length; i++) {
      const v = voices3d[i]!;
      if (v.soundId === null || v.releasing) continue;
      active3d++;
      const dirty = v.stepPitch(realDt, l.x, l.y, l.z);
      if (rateChanged || dirty) v.setRate(slowmo);
      if ((i + time.frame) % DISTANCE_STRIDE !== 0) continue;
      const def = v.def!;
      const dx = v.x - l.x;
      const dy = v.y - l.y;
      const dz = v.z - l.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const a = attenuation(d, def.near, def.far);
      // At 45 m/s a long sound changes distance fast enough that fixing its level at the start would be wrong.
      v.applyDistance(a, airCutoff(d), def.send * wetness(d, def.near, a), 0.06);
    }
    let active2d = 0;
    for (const v of this.pool2d.all) {
      if (v.soundId === null || v.releasing) continue;
      active2d++;
      const dirty = v.stepPitch(realDt, l.x, l.y, l.z);
      if (rateChanged || dirty) v.setRate(slowmo);
    }
    this.active2d = active2d;
    this.active = active3d + active2d;
    if (this.active > this.governor.budget) this.shed();

    this.sweepClock -= realDt;
    if (this.sweepClock <= 0) {
      this.sweepClock = SWEEP_SECONDS;
      this.sweep(ac);
    }
    this.loadClock -= realDt;
    if (this.loadClock <= 0) {
      this.loadClock = LOAD_WINDOW;
      this.measureLoad(ac);
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

  /** Lets one voice go when the budget has fallen below what is sounding. Critical sounds are left alone. */
  private shed(): void {
    let weakest: Voice | null = null;
    for (const v of this.pool3d.all) {
      if (v.soundId === null || v.releasing || v.critical || v.loop) continue;
      if (!weakest || v.loudness < weakest.loudness) weakest = v;
    }
    weakest?.stop(SHED_FADE);
  }

  /** Takes back voices whose end never came, and keeps trying to wake a context something else stopped. */
  private sweep(ac: AudioContext): void {
    if (ac.state !== 'running') {
      if (ac.state !== 'closed' && this.unlocked && !document.hidden) void ac.resume().catch(() => { /* the next gesture will */ });
      return;
    }
    const now = ac.currentTime;
    for (const pool of this.pools) {
      for (const v of pool.all) {
        if (v.soundId !== null && v.overdue(now)) {
          v.reclaim();
          this.counts.reclaimed++;
        }
      }
    }
  }

  /** Compares the audio clock with the wall clock, which is the one measure that works in every browser. */
  private measureLoad(ac: AudioContext): void {
    const wallNow = performance.now();
    const wall = (wallNow - this.loadWall) / 1000;
    const audio = ac.currentTime - this.loadAudio;
    this.loadWall = wallNow;
    this.loadAudio = ac.currentTime;
    // A stopped context or a stalled tab says nothing about the render thread.
    if (ac.state !== 'running' || document.hidden || wall > LOAD_WINDOW * 3) return;
    const stats = (ac as AudioContext & { playbackStats?: { underrunDuration: number; totalDuration: number } }).playbackStats;
    let share: number | null = null;
    if (stats) {
      const total = stats.totalDuration - this.loadTotal;
      if (total > 0) share = (stats.underrunDuration - this.loadUnderrun) / total;
      this.loadTotal = stats.totalDuration;
      this.loadUnderrun = stats.underrunDuration;
    }
    this.governor.sample(audio, wall, share);
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

  /** `window.__op2.audio` and `__op2.stats().audio`, for the F4 overlay. Read a few times a second, never per frame. */
  private publishStats(): void {
    const debug = (window as unknown as { __op2?: { stats?: () => Record<string, unknown>; audio?: unknown } }).__op2;
    if (!debug) return;
    Object.defineProperty(debug, 'audio', { configurable: true, get: () => this.stats() });
    const stats = debug.stats;
    if (stats) debug.stats = () => ({ ...stats(), audio: this.readout() });
  }

  /** One line of what the mix is doing, with its two warning signs first. */
  readout(): string {
    const s = this.stats();
    const refused = s.droppedBudget + s.droppedFamily;
    return `${s.state} clock ${s.clockRate.toFixed(2)} under ${(s.underrunShare * 100).toFixed(0)}% | voices ${s.voices3d + s.voices2d}/${s.budget} step ${s.loadStep} hrtf ${s.hrtf} loops ${s.loops} | thinned ${s.thinnedQuiet + s.thinnedRepeat} refused ${refused} | duck ${s.duck.toFixed(2)} limit ${this.mixer?.filters.gainReduction.toFixed(1) ?? '-'} dB`;
  }

  stats(): AudioStats {
    const bank = this.bank;
    const busy = (voices: Voice[]) => voices.reduce((n, v) => n + (v.soundId !== null && !v.releasing ? 1 : 0), 0);
    const loops = [...this.pool3d.all, ...this.pool2d.all].reduce((n, v) => n + (v.loop && !v.releasing ? 1 : 0), 0);
    const hrtf = this.pool3d.all.reduce((n, v) => n + (v.hrtf && v.soundId !== null ? 1 : 0), 0);
    const c = this.counts;
    return {
      state: this.ac?.state ?? 'none',
      ready: this.loaded,
      samples: bank?.stats.samples ?? 0,
      rendered: bank?.stats.rendered ?? 0,
      total: synthCount(),
      voices3d: busy(this.pool3d.all),
      voices2d: busy(this.pool2d.all),
      voicesUi: busy(this.poolUi.all),
      hrtf,
      loops,
      played: c.played,
      stolen: c.stolen,
      dropped: c.droppedBudget + c.droppedFamily,
      droppedBudget: c.droppedBudget,
      droppedFamily: c.droppedFamily,
      culled: c.culled,
      collapsed: c.collapsed,
      thinnedQuiet: c.thinnedQuiet,
      thinnedRepeat: c.thinnedRepeat,
      notRunning: c.notRunning,
      invalid: c.invalid,
      reclaimed: c.reclaimed,
      missed: c.missed,
      budget: this.governor.budget,
      loadStep: this.governor.step,
      clockRate: this.governor.clockRate,
      underrunShare: this.governor.underrunShare,
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
