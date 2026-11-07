/**
 * Section 19's playback. Recordings are `public/audio/voice/<id>.mp3`, listed in `manifest.json` beside them. This looks a line up in
 * that list and plays it if it is there, so a line nobody has recorded simply stays as text. Nothing here knows or cares how many
 * lines have been recorded, and nothing talks to ElevenLabs.
 *
 * A clip name is an id, plus `~<variant>` for a line with a slot. A variant with no recording falls back to nothing, not to another
 * variant: a voice saying the wrong number is worse than no voice.
 *
 * The list is fetched once for the page and shared. A line asked for before it has arrived waits for it, counting as talking, so the
 * first words of a run are not lost to a slow request. A clip that will not start, or stops moving, is dropped as if it had failed, so
 * nothing can hold a line open for ever.
 */
import type { Ctx } from '../../core/contracts';
import type { Settings } from '../settings';

const BASE = 'audio/voice/';
/** Music dips this much under a voice, */
const DUCK = 0.55;
/** and stays down this long after the last word, which carries it over the breath between one line and the next. */
const DUCK_HOLD = 0.6;
/** Seconds a line waits for the list of recordings, if it is asked for before the list has arrived. */
const LIST_WAIT = 5;
/** Seconds before a list that failed on the way is asked for again, once. */
const LIST_RETRY = 2;
/** Seconds a clip may take to start, and may then sit without moving, before it counts as a clip that will not play. */
const LOAD_GRACE = 4;
const STALL_GRACE = 2.5;
/** Seconds a clip that is cut off takes to go, so that it stops rather than clicks. */
const FADE_SECONDS = 0.1;

type ClipList = ReadonlySet<string>;

/** What a Voice needs from the page. A test passes its own. */
export interface VoiceDeps {
  /** A new element for one clip. */
  audio(url: string): HTMLAudioElement;
  /** The ids that have a recording. */
  list(): Promise<ClipList>;
}

let pageList: Promise<ClipList> | null = null;

async function fetchList(): Promise<ClipList> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`${BASE}manifest.json`);
      // No list means no recordings, which is a fine way to ship.
      if (!r.ok) return new Set();
      const m = (await r.json()) as { clips?: unknown } | null;
      if (Array.isArray(m?.clips)) return new Set(m.clips.filter((c): c is string => typeof c === 'string'));
      break;
    } catch {
      if (attempt === 0) await new Promise(go => setTimeout(go, LIST_RETRY * 1000));
    }
  }
  console.warn('[voice] the list of recordings did not load, so every line stays text');
  return new Set();
}

const PAGE: VoiceDeps = {
  audio: url => new Audio(url),
  list: () => (pageList ??= fetchList()),
};

/** Lets go of an element and of whatever it was still downloading. */
function unload(audio: HTMLAudioElement): void {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

interface Playing {
  audio: HTMLAudioElement;
  /** Takes every listener off it at once, so a clip that has been replaced cannot act on the one that replaced it. */
  off: AbortController;
  started: boolean;
  /** Where it was when last looked at, and for how long it has stayed there. */
  at: number;
  still: number;
}

interface Fading {
  audio: HTMLAudioElement;
  from: number;
  left: number;
}

export class Voice {
  private known: ClipList | null = null;
  private current: Playing | null = null;
  private queue: string[] = [];
  /** Clips asked for before the list arrived, and how much longer they will wait for it. */
  private pending: readonly (string | null)[] | null = null;
  private pendingFor = 0;
  private readonly fading: Fading[] = [];
  private paused = false;
  /** Out of sight in a background tab, to be picked up again when it comes back. */
  private hidden = false;
  private sounded = false;

  constructor(private readonly ctx: Ctx, private readonly settings: Settings, private readonly deps: VoiceDeps = PAGE) {
    const arrived = (list: ClipList): void => {
      this.known = list;
      const clips = this.pending;
      this.pending = null;
      if (clips) this.play(clips);
    };
    deps.list().then(arrived, () => arrived(new Set()));
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => this.setHidden(document.hidden));
  }

  /** Plays these in order. Anything unrecorded is skipped. */
  say(clips: readonly (string | null)[]): void {
    this.stop();
    this.sounded = false;
    if (this.known) this.play(clips);
    else if (clips.some(c => c !== null)) {
      this.pending = clips;
      this.pendingFor = LIST_WAIT;
    }
  }

  /** True while a recording is still going, or may yet, so the page stays up for it. */
  get speaking(): boolean {
    return this.current !== null || this.pending !== null;
  }

  /** A recording of what was last asked for has been heard. Once it ends, the words are only text. */
  get voiced(): boolean {
    return this.sounded;
  }

  /** A paused game has nobody talking over it. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.settle();
    const p = this.current;
    if (!p || this.hidden) return;
    if (paused) p.audio.pause();
    else this.resume(p);
  }

  stop(): void {
    this.queue = [];
    this.pending = null;
    const p = this.current;
    this.current = null;
    if (!p) return;
    p.off.abort();
    // Cut off mid-word, it fades. Anything not yet sounding just goes.
    if (p.started && !p.audio.paused) this.fading.push({ audio: p.audio, from: p.audio.volume, left: FADE_SECONDS });
    else unload(p.audio);
  }

  /** Every frame the game runs: fades, the wait for the list, and a watch on a clip that has stopped coming. */
  update(dt: number): void {
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const f = this.fading[i]!;
      f.left -= dt;
      if (f.left > 0) {
        f.audio.volume = f.from * (f.left / FADE_SECONDS);
        continue;
      }
      unload(f.audio);
      this.fading.splice(i, 1);
    }
    if (this.paused || this.hidden) return;
    // No list in time: the line is text, and a list that turns up later does not start it over somebody else. Later lines stop
    // waiting for a list that may never come, and one that does turn up still voices them.
    if (this.pending && (this.pendingFor -= dt) <= 0) {
      this.pending = null;
      this.known ??= new Set();
    }
    const p = this.current;
    if (!p) return;
    const t = p.audio.currentTime;
    if (t !== p.at) {
      p.at = t;
      p.still = 0;
      return;
    }
    p.still += dt;
    if (p.still >= (p.started ? STALL_GRACE : LOAD_GRACE)) this.next();
  }

  private play(clips: readonly (string | null)[]): void {
    const known = this.known!;
    this.queue = clips.filter((c): c is string => c !== null && known.has(c));
    this.next();
  }

  private next(): void {
    const was = this.current;
    this.current = null;
    if (was) {
      was.off.abort();
      unload(was.audio);
    }
    const clip = this.queue.shift();
    if (!clip) return;
    const audio = this.deps.audio(`${BASE}${encodeURIComponent(clip)}.mp3`);
    const p: Playing = { audio, off: new AbortController(), started: false, at: -1, still: 0 };
    const mine = { signal: p.off.signal };
    audio.volume = this.level;
    audio.addEventListener('ended', () => this.next(), mine);
    // A file that will not play is a line that stays as text.
    audio.addEventListener('error', () => this.next(), mine);
    audio.addEventListener('playing', () => {
      p.started = this.sounded = true;
      // Time spent loading is not a stall: a slow download must not cut the clip the moment it starts.
      p.still = 0;
      this.duck();
    }, mine);
    // From what is really playing, not from what the file says it will, so a stop or a pause lets the music back up.
    audio.addEventListener('timeupdate', () => this.duck(), mine);
    this.current = p;
    if (!this.paused && !this.hidden) this.start(p);
  }

  private start(p: Playing): void {
    p.audio.play().catch((err: unknown) => {
      // A pause or a stop got there first, and whoever did it has this clip in hand.
      if (this.current !== p || (err as { name?: unknown } | null)?.name === 'AbortError') return;
      this.next();
    });
  }

  private resume(p: Playing): void {
    p.audio.volume = this.level;
    p.still = 0;
    this.start(p);
  }

  private setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    this.settle();
    const p = this.current;
    if (!p || this.paused) return;
    if (hidden) p.audio.pause();
    else this.resume(p);
  }

  /** A fade has nobody left to finish it while the game is stopped. */
  private settle(): void {
    for (const f of this.fading) unload(f.audio);
    this.fading.length = 0;
  }

  private duck(): void {
    this.ctx.audio.duck(DUCK, DUCK_HOLD);
  }

  private get level(): number {
    return this.settings.master * this.settings.sfx;
  }
}
