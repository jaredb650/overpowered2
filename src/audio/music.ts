/**
 * Soundtrack. Tracks run 5 to 10 minutes, so they stream through media elements and are never
 * decoded whole. Two elements alternate, which is what makes crossfades possible.
 */
import type { MusicState } from '../core/contracts';

interface Track { file: string; title: string }
type Manifest = Record<MusicState, Track[]>;

/** Seconds of crossfade into each state. Hard arrives fast because it should feel like a threat. */
const FADE_INTO: Record<MusicState, number> = { menu: 2.4, easy: 1.6, hard: 0.9 };
/** Crossfade between tracks of one state. */
const TRACK_FADE = 3;
/** Fade around a pause. */
const PAUSE_FADE = 0.12;

interface Deck {
  el: HTMLAudioElement;
  gain: GainNode;
  /** Seconds until this deck can stop. Zero while it is the live deck. */
  fadingOut: number;
  live: boolean;
}

export class MusicPlayer {
  private manifest: Manifest | null = null;
  private readonly decks: [Deck, Deck];
  private active = 0;
  private state: MusicState | null = null;
  private playing: MusicState | null = null;
  /** Shuffle bags: a state's tracks in random order, used up before any repeats. */
  private readonly bags: Record<MusicState, number[]> = { menu: [], easy: [], hard: [] };
  private readonly last: Record<MusicState, number> = { menu: -1, easy: -1, hard: -1 };
  private unlocked = false;
  private paused = false;
  private pauseTimer = 0;
  private failures = 0;

  constructor(private readonly ac: AudioContext, output: AudioNode, baseUrl: string) {
    const deck = (): Deck => {
      const el = new Audio();
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      const gain = ac.createGain();
      gain.gain.value = 0;
      ac.createMediaElementSource(el).connect(gain);
      gain.connect(output);
      return { el, gain, fadingOut: 0, live: false };
    };
    this.decks = [deck(), deck()];
    this.decks.forEach((d, i) => {
      // A track that will not load must not end the music, which is what the first game's "#" track did.
      d.el.addEventListener('error', () => this.onError(i));
      d.el.addEventListener('ended', () => { if (i === this.active) this.advance(0.2); });
      d.el.addEventListener('playing', () => { this.failures = 0; });
    });
    this.base = baseUrl;
  }

  private readonly base: string;

  async load(): Promise<void> {
    const response = await fetch(`${this.base}audio/music/manifest.json`);
    this.manifest = await response.json() as Manifest;
    this.begin();
  }

  /** Gives the state a track once both the manifest and a user gesture exist. */
  private begin(): void {
    if (this.unlocked && this.manifest && this.state && this.state !== this.playing) {
      const state = this.state;
      this.playing = state;
      this.fadeToNext(state, FADE_INTO[state]);
    }
  }

  unlock(): void {
    this.unlocked = true;
    this.begin();
  }

  setState(state: MusicState): void {
    if (state === this.state) return;
    this.state = state;
    this.begin();
  }

  get current(): { state: MusicState | null; title: string | null; time: number; paused: boolean } {
    const deck = this.decks[this.active];
    return { state: this.playing, title: deck.live ? deck.el.src.split('/').pop() ?? null : null, time: deck.el.currentTime, paused: deck.el.paused };
  }

  private nextIndex(state: MusicState): number {
    const count = this.manifest![state].length;
    const bag = this.bags[state];
    if (bag.length === 0) {
      for (let i = 0; i < count; i++) bag.push(i);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j]!, bag[i]!];
      }
      // The end of one bag must not be the start of the next.
      if (count > 1 && bag[bag.length - 1] === this.last[state]) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1]!, bag[0]!];
    }
    const index = bag.pop()!;
    this.last[state] = index;
    return index;
  }

  private fadeToNext(state: MusicState, seconds: number): void {
    // A build with no music (the public site) lists no tracks, and plays nothing rather than failing.
    if (this.manifest![state].length === 0) return;
    const track = this.manifest![state][this.nextIndex(state)]!;
    const now = this.ac.currentTime;
    const outgoing = this.decks[this.active];
    const incoming = this.decks[1 - this.active as 0 | 1];
    this.active = 1 - this.active;

    if (outgoing.live) {
      outgoing.live = false;
      outgoing.fadingOut = seconds + 0.1;
      outgoing.gain.gain.cancelScheduledValues(now);
      outgoing.gain.gain.setTargetAtTime(0, now, seconds / 3);
    }
    incoming.fadingOut = 0;
    incoming.live = true;
    incoming.el.src = `${this.base}${track.file}`;
    incoming.gain.gain.cancelScheduledValues(now);
    incoming.gain.gain.setValueAtTime(0, now);
    incoming.gain.gain.setTargetAtTime(1, now, seconds / 3);
    if (!this.paused) void incoming.el.play().catch(() => { /* retried on the next unlock or resume */ });
  }

  private advance(seconds: number): void {
    if (this.playing && this.manifest) this.fadeToNext(this.playing, seconds);
  }

  private onError(index: number): void {
    const deck = this.decks[index]!;
    if (!deck.live || !deck.el.getAttribute('src')) return;
    this.failures++;
    console.warn(`[audio] track failed to load: ${deck.el.src}`);
    // Every track failing means the files are missing. Stop rather than spin.
    const total = this.playing && this.manifest ? this.manifest[this.playing].length : 0;
    if (this.failures <= total) this.advance(0.3);
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.pauseTimer = PAUSE_FADE;
    const now = this.ac.currentTime;
    for (const d of this.decks) if (d.live) d.gain.gain.setTargetAtTime(0, now, PAUSE_FADE / 3);
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.pauseTimer = 0;
    const now = this.ac.currentTime;
    for (const d of this.decks) {
      if (!d.live) continue;
      d.gain.gain.setTargetAtTime(1, now, PAUSE_FADE / 3);
      void d.el.play().catch(() => { /* retried on the next gesture */ });
    }
  }

  update(realDt: number): void {
    if (this.pauseTimer > 0) {
      this.pauseTimer -= realDt;
      if (this.pauseTimer <= 0) for (const d of this.decks) d.el.pause();
    }
    for (const d of this.decks) {
      if (d.fadingOut <= 0) continue;
      d.fadingOut -= realDt;
      if (d.fadingOut <= 0) {
        d.el.pause();
        d.el.removeAttribute('src');
        d.el.load();
      }
    }
    if (!this.paused) {
      const live = this.decks[this.active];
      if (live.live && live.el.duration > 0 && live.el.duration - live.el.currentTime < TRACK_FADE && !live.el.paused) {
        this.advance(TRACK_FADE);
      }
    }
  }
}
