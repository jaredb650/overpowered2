/**
 * Section 19's playback. Recordings arrive later, as `public/audio/voice/<id>.mp3`, listed in `manifest.json` beside them. This looks
 * a line up in that list and plays it if it is there, so a line nobody has recorded yet simply stays as text. Nothing here knows or
 * cares how many lines have been recorded, and nothing talks to ElevenLabs.
 *
 * A clip name is an id, plus `~<variant>` for a line with a slot. A variant with no recording falls back to nothing, not to another
 * variant: a voice saying the wrong number is worse than no voice.
 */
import type { Ctx } from '../../core/contracts';
import type { Settings } from '../settings';

const BASE = 'audio/voice/';
/** Music dips this much under a voice. */
const DUCK = 0.55;

export class Voice {
  private known: ReadonlySet<string> = new Set();
  private current: HTMLAudioElement | null = null;
  private queue: string[] = [];

  constructor(private readonly ctx: Ctx, private readonly settings: Settings) {
    fetch(`${BASE}manifest.json`)
      .then(r => (r.ok ? r.json() : null))
      .then((m: { clips?: string[] } | null) => {
        if (Array.isArray(m?.clips)) this.known = new Set(m.clips);
      })
      // No list means no recordings, which is a fine way to ship.
      .catch(() => undefined);
  }

  has(clip: string | null): boolean {
    return clip !== null && this.known.has(clip);
  }

  /** Plays these in order. Anything unrecorded is skipped. */
  say(clips: readonly (string | null)[]): void {
    this.stop();
    this.queue = clips.filter((c): c is string => this.has(c));
    this.next();
  }

  private next(): void {
    const clip = this.queue.shift();
    if (!clip) {
      this.current = null;
      return;
    }
    const audio = new Audio(`${BASE}${encodeURIComponent(clip)}.mp3`);
    audio.volume = this.settings.master * this.settings.sfx;
    audio.addEventListener('ended', () => this.next(), { once: true });
    // A file that will not play is a line that stays as text.
    audio.addEventListener('error', () => this.next(), { once: true });
    audio.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(audio.duration)) this.ctx.audio.duck(DUCK, audio.duration);
    }, { once: true });
    audio.play().catch(() => this.next());
    this.current = audio;
  }

  /** True while a recording is still going, so the page stays up for it. */
  get speaking(): boolean {
    return this.current !== null;
  }

  /** A paused game has nobody talking over it. */
  setPaused(paused: boolean): void {
    if (!this.current) return;
    if (paused) this.current.pause();
    else this.current.play().catch(() => this.next());
  }

  stop(): void {
    this.queue = [];
    if (!this.current) return;
    this.current.pause();
    this.current = null;
  }
}
