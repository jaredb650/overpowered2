/**
 * What plays next. The soundtrack comes from two manifests: the game's own tracks in `public/audio/ost`, which are in
 * the repo and on the public site, and the owner's placeholder songs in `public/audio/music`, which exist only on the
 * owner's machine. Each list is the two merged, and the order takes turns between them so both are heard.
 *
 * No DOM and no audio here, so the rules can be tested in Node.
 */
import type { MusicState } from '../core/contracts';

export interface MusicTrack {
  /** Path under the site's base, e.g. `audio/ost/menu/blue-hour-briefing.mp3`. */
  file: string;
  title: string;
  /** True for the game's own soundtrack, false for a placeholder. */
  original: boolean;
}

export type TrackLists = Record<MusicState, MusicTrack[]>;

const STATES: readonly MusicState[] = ['menu', 'easy', 'hard'];

/** A file-name title turned into something a person would read: underscores become spaces. */
export function displayTitle(title: string): string {
  return title.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function entries(list: unknown, original: boolean, seen: Set<string>): MusicTrack[] {
  if (!Array.isArray(list)) return [];
  const out: MusicTrack[] = [];
  for (const item of list as unknown[]) {
    const e = item as { file?: unknown; title?: unknown } | null;
    if (!e || typeof e.file !== 'string' || !e.file || seen.has(e.file)) continue;
    seen.add(e.file);
    const title = typeof e.title === 'string' && e.title ? e.title : (e.file.split('/').pop() ?? e.file).replace(/\.[^.]+$/, '');
    out.push({ file: e.file, title: displayTitle(title), original });
  }
  return out;
}

/**
 * One list per state from the two manifests. Either may be missing, empty or malformed: the public site ships the
 * placeholder manifest with empty lists, and a fresh clone may have no placeholder files at all.
 */
export function mergeManifests(originals: unknown, placeholders: unknown): TrackLists {
  const out: TrackLists = { menu: [], easy: [], hard: [] };
  const a = (originals ?? {}) as Record<string, unknown>;
  const b = (placeholders ?? {}) as Record<string, unknown>;
  for (const state of STATES) {
    const seen = new Set<string>();
    out[state] = [...entries(a[state], true, seen), ...entries(b[state], false, seen)];
  }
  return out;
}

/**
 * One file from a manifest, to ask whether the songs it lists are on this server at all. Null for a manifest with nothing in
 * it. The placeholder manifest is in the repo but its songs are not, so a clone has the list and none of the files.
 */
export function sampleFile(manifest: unknown): string | null {
  const m = (manifest ?? {}) as Record<string, unknown>;
  for (const state of STATES) {
    const found = entries(m[state], false, new Set())[0];
    if (found) return found.file;
  }
  return null;
}

/**
 * Where a state looks for music, in order. A list with nothing in it borrows the next one, so a build that has menu
 * tracks but no run tracks yet plays the menu tracks through a run, which is better than a run in silence.
 */
export const FALLBACK: Record<MusicState, readonly MusicState[]> = {
  menu: ['menu', 'easy', 'hard'],
  easy: ['easy', 'hard', 'menu'],
  hard: ['hard', 'easy', 'menu'],
};

/** The list a state really plays from: its own, or the first in its fallback order that has anything. Null if none has. */
export function sourceFor(state: MusicState, counts: Record<MusicState, number>): MusicState | null {
  return FALLBACK[state].find(s => counts[s] > 0) ?? null;
}

/** A shuffle bag: every track once in random order before any comes round again. */
class Bag {
  private order: MusicTrack[] = [];
  private last: MusicTrack | null = null;
  constructor(readonly tracks: MusicTrack[], private readonly random: () => number) {}

  next(): MusicTrack | null {
    if (this.tracks.length === 0) return null;
    if (this.order.length === 0) {
      this.order = [...this.tracks];
      for (let i = this.order.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [this.order[i], this.order[j]] = [this.order[j]!, this.order[i]!];
      }
      // Tracks are taken from the end. The end of one bag must not be the start of the next.
      const top = this.order.length - 1;
      if (top > 0 && this.order[top] === this.last) [this.order[0], this.order[top]] = [this.order[top]!, this.order[0]!];
    }
    this.last = this.order.pop()!;
    return this.last;
  }

  drop(file: string): void {
    const at = this.tracks.findIndex(t => t.file === file);
    if (at >= 0) this.tracks.splice(at, 1);
    this.order = this.order.filter(t => t.file !== file);
  }
}

/**
 * The order of one list. Originals and placeholders take turns, each from its own shuffle bag, starting with an
 * original. With only one kind present it is a plain shuffle. The same track never plays twice in a row unless it is
 * the only one there is.
 */
export class Playlist {
  private readonly originals: Bag;
  private readonly placeholders: Bag;
  private turn: 'original' | 'placeholder' = 'original';

  constructor(tracks: readonly MusicTrack[], random: () => number = Math.random) {
    this.originals = new Bag(tracks.filter(t => t.original), random);
    this.placeholders = new Bag(tracks.filter(t => !t.original), random);
  }

  get length(): number {
    return this.originals.tracks.length + this.placeholders.tracks.length;
  }

  next(): MusicTrack | null {
    const first = this.turn === 'original' ? this.originals : this.placeholders;
    const second = this.turn === 'original' ? this.placeholders : this.originals;
    this.turn = this.turn === 'original' ? 'placeholder' : 'original';
    return first.next() ?? second.next();
  }

  /** A track that would not load is not offered again, so missing files cost one attempt each and no more. */
  drop(file: string): void {
    this.originals.drop(file);
    this.placeholders.drop(file);
  }
}
