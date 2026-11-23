/**
 * The squad comms voices (docs/design/squad-comms.md; stage I). Two of the owner's ElevenLabs voices, Trooper 2 and Trooper 3. Each
 * man is dealt one when he joins his first squad and keeps it for life: every line he says, radio, pain, grief or cut-off, is in it.
 *
 * A clip is `<row id>[~<slot values>].<voice>.<ext>` under `audio/chatter/`, listed in `manifest.json` there. Slot values are the
 * row's blanks in key order, spaces taken out, joined by '-': `ch.garrison.manDown.buddy.1~Patch.t2.mp3`. Only the values the voice
 * pass rendered exist (`VOICED_SLOTS`); for the blanks it rendered one value of (`{to}`, `{range}`), the take with that value stands in.
 * A line with no take stays text. No three.js here, and nothing talks to ElevenLabs.
 */
import { RULES } from './lines';

/** File suffixes, in the order a squad deals them. */
export const VOICES = ['t2', 't3'] as const;
export const VOICE_COUNT = VOICES.length;

/** What the voice pass renders for each blank. {dead} and {buddy} are nicknames, the names buddies use. */
export const VOICED_SLOTS: Readonly<Record<string, readonly string[]>> = {
  to: ['All units'],
  range: ['50 metres'],
  count: ['one', 'two'],
};

/** The clips that exist, and their file type. Filled once from the manifest; empty means text only. */
export const VOICED = { clips: new Set<string>(), ext: 'mp3' };

const SLOT = /\{(\w+)\}/g;

/** The clip name for a row with its blanks filled, without the voice: `id` or `id~v1-v2`. */
export function clipKey(row: number, slots: Readonly<Record<string, string>>): string {
  const r = RULES[row]!;
  const keys = [...new Set([...r.text.matchAll(SLOT)].map(m => m[1]!))].sort();
  if (keys.length === 0) return r.id;
  return `${r.id}~${keys.map(k => (slots[k] ?? '').replace(/\s+/g, '')).join('-')}`;
}

/**
 * The file for this line in this voice, or null if there is none. Tries the words as said, then with the blanks the pass rendered only
 * one value of swapped for that value.
 */
export function clipFor(row: number, slots: Readonly<Record<string, string>>, voice: number): string | null {
  const v = VOICES[voice];
  if (row < 0 || !v) return null;
  const exact = `${clipKey(row, slots)}.${v}`;
  if (VOICED.clips.has(exact)) return exact;
  const lean: Record<string, string> = { ...slots };
  for (const k in VOICED_SLOTS) if (lean[k] !== undefined && !VOICED_SLOTS[k]!.includes(lean[k]!)) lean[k] = VOICED_SLOTS[k]![0]!;
  const near = `${clipKey(row, lean)}.${v}`;
  return VOICED.clips.has(near) ? near : null;
}

/** The file for a relayed clip key (without voice suffix), or null if none was rendered. */
export function relayClip(key: string | null | undefined, voice: number): string | null {
  const v = VOICES[voice];
  if (!key || !v) return null;
  const exact = `${key}.${v}`;
  return VOICED.clips.has(exact) ? exact : null;
}
