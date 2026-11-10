/**
 * Soundtrack. Tracks run 3 to 10 minutes, so they stream through media elements and are never
 * decoded whole. Two elements alternate, which is what makes crossfades possible.
 *
 * Two manifests feed it. `audio/ost/manifest.json` lists the game's own tracks, which are in the repo. `audio/music/manifest.json`
 * lists the owner's placeholder songs, which are on the owner's machine only: the public build empties it, and a clone has the
 * list but not the files. `playlist.ts` merges the two and decides the order.
 */
import type { MusicState } from '../core/contracts';
import { mergeManifests, Playlist, sampleFile, sourceFor, type MusicTrack, type TrackLists } from './playlist';

declare module '../core/contracts' {
  interface GameEvents {
    /** A track has really started to sound. `original` is false for the owner's local placeholder songs. */
    'music:track': { state: MusicState; title: string; file: string; original: boolean };
  }
}

/** `?music=ost` plays only the game's own tracks, `?music=local` only the placeholders. Anything else plays both. */
export type MusicSource = 'all' | 'ost' | 'local';

export const OST_MANIFEST = 'audio/ost/manifest.json';
export const PLACEHOLDER_MANIFEST = 'audio/music/manifest.json';

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
  track: MusicTrack | null;
  /** True once the track on this deck has been reported as playing. */
  announced: boolean;
}

export class MusicPlayer {
  private lists: TrackLists | null = null;
  private playlists: Record<MusicState, Playlist> | null = null;
  /** Called when a track starts to sound, once per track. */
  onTrack: ((state: MusicState, track: MusicTrack) => void) | null = null;
  private readonly decks: [Deck, Deck];
  private active = 0;
  private state: MusicState | null = null;
  private playing: MusicState | null = null;
  /** The list the live track came from. Not always `playing`: an empty list borrows another. See `sourceFor`. */
  private playingFrom: MusicState | null = null;
  private unlocked = false;
  private paused = false;
  private pauseTimer = 0;
  private failures = 0;

  constructor(private readonly ac: AudioContext, output: AudioNode, baseUrl: string, private readonly source: MusicSource = 'all') {
    const deck = (): Deck => {
      const el = new Audio();
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      const gain = ac.createGain();
      gain.gain.value = 0;
      ac.createMediaElementSource(el).connect(gain);
      gain.connect(output);
      return { el, gain, fadingOut: 0, live: false, track: null, announced: false };
    };
    this.decks = [deck(), deck()];
    this.decks.forEach((d, i) => {
      // A track that will not load must not end the music, which is what the first game's "#" track did.
      d.el.addEventListener('error', () => this.onError(i));
      d.el.addEventListener('ended', () => { if (i === this.active) this.advance(0.2); });
      d.el.addEventListener('playing', () => {
        this.failures = 0;
        if (d.live && d.track && !d.announced && this.playing) {
          d.announced = true;
          this.onTrack?.(this.playing, d.track);
        }
      });
    });
    this.base = baseUrl;
  }

  private readonly base: string;

  async load(): Promise<void> {
    // Either file may be missing, and neither may stop the other from playing.
    const read = async (path: string): Promise<unknown> => {
      try {
        const response = await fetch(`${this.base}${path}`);
        return response.ok ? await response.json() : null;
      } catch {
        return null;
      }
    };
    const [originals, placeholders] = await Promise.all([
      this.source === 'local' ? null : read(OST_MANIFEST),
      this.source === 'ost' ? null : read(PLACEHOLDER_MANIFEST).then(async m => ((await this.present(m)) ? m : null)),
    ]);
    this.setLists(mergeManifests(originals, placeholders));
  }

  /**
   * Whether the songs a manifest lists are on this server, judged by one of them. A clone has the placeholder manifest and
   * none of the songs: without this, the first state change would try every missing song in turn, cutting the music each
   * time. A single missing song on a machine that has the rest is still handled by `onError`.
   */
  private async present(manifest: unknown): Promise<boolean> {
    const file = sampleFile(manifest);
    if (!file) return false;
    try {
      const response = await fetch(`${this.base}${file}`, { method: 'HEAD' });
      // A dev server or a host may answer a missing file with its HTML page instead of a 404.
      return response.ok && !(response.headers.get('content-type') ?? '').includes('text/html');
    } catch {
      return false;
    }
  }

  /** Takes the merged lists. Split from `load` so tests can hand them in. */
  setLists(lists: TrackLists): void {
    this.lists = lists;
    this.playlists = { menu: new Playlist(lists.menu), easy: new Playlist(lists.easy), hard: new Playlist(lists.hard) };
    this.begin();
  }

  /** How many tracks each list holds, and how many of them are the game's own. */
  get counts(): Record<MusicState, { total: number; original: number }> | null {
    if (!this.lists) return null;
    const of = (list: MusicTrack[]) => ({ total: list.length, original: list.filter(t => t.original).length });
    return { menu: of(this.lists.menu), easy: of(this.lists.easy), hard: of(this.lists.hard) };
  }

  /** Gives the state a track once both the manifest and a user gesture exist. */
  private begin(): void {
    if (this.unlocked && this.playlists && this.state && this.state !== this.playing) {
      const state = this.state;
      this.playing = state;
      // Two states that share a list (one borrowing the other's) keep the track that is already playing.
      if (this.playingFrom !== null && this.listFor(state) === this.playingFrom) return;
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

  get current(): { state: MusicState | null; title: string | null; file: string | null; original: boolean | null; time: number; paused: boolean } {
    const deck = this.decks[this.active];
    const track = deck.live ? deck.track : null;
    return { state: this.playing, title: track?.title ?? null, file: track?.file ?? null, original: track?.original ?? null, time: deck.el.currentTime, paused: deck.el.paused };
  }

  private listFor(state: MusicState): MusicState | null {
    const p = this.playlists!;
    return sourceFor(state, { menu: p.menu.length, easy: p.easy.length, hard: p.hard.length });
  }

  private fadeToNext(state: MusicState, seconds: number): void {
    // A build with no tracks at all plays nothing rather than failing.
    const from = this.listFor(state);
    const track = from ? this.playlists![from].next() : null;
    if (!from || !track) return;
    this.playingFrom = from;
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
    incoming.track = track;
    incoming.announced = false;
    incoming.el.src = `${this.base}${track.file}`;
    incoming.gain.gain.cancelScheduledValues(now);
    incoming.gain.gain.setValueAtTime(0, now);
    incoming.gain.gain.setTargetAtTime(1, now, seconds / 3);
    if (!this.paused) void incoming.el.play().catch(() => { /* retried on the next unlock or resume */ });
  }

  private advance(seconds: number): void {
    if (this.playing && this.playlists) this.fadeToNext(this.playing, seconds);
  }

  private onError(index: number): void {
    const deck = this.decks[index]!;
    if (!deck.live || !deck.el.getAttribute('src')) return;
    this.failures++;
    console.warn(`[audio] track failed to load: ${deck.el.src}`);
    // A file that is not there is taken off the list and not asked for again. (A clone without any of the placeholder songs
    // never gets here: `present` leaves them out at load.) Every track failing means there is nothing to play: stop rather
    // than spin.
    if (deck.track && this.playlists) for (const list of Object.values(this.playlists)) list.drop(deck.track.file);
    if (this.playing && this.playlists && this.listFor(this.playing) && this.failures <= 64) this.advance(0.3);
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
