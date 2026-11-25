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

/**
 * File suffixes for recorded chatter takes.
 * Indices 0..1 (`t2`, `t3`) are ground garrison troopers (`VOICE_COUNT = 2`).
 * Indices 2..11 are dedicated pilot, ace mini-boss, tank commander, and air-assault crew voices (see `docs/notes/voices.md`).
 */
export const VOICES = [
  't2',     // 0:  trooper1 (Garrison Trooper 1)
  't3',     // 1:  trooper2 (Garrison Trooper 2)
  'pmace',  // 2:  pilot_manic_ace (RESERVED: enemy F-22 Raptor Ace mini-boss only)
  'psace',  // 3:  pilot_surgical_ace (RESERVED: enemy F-22 Raptor Ace mini-boss only)
  'patc',   // 4:  pilot_serious_atc (Allied wingman lead, Hornet, Spectre AC-130)
  'pvet',   // 5:  pilot_airline_vet (B-1 Lancer bomber, Warthog, Hornet, Fast-Rope Transport)
  'pcow',   // 6:  pilot_gunship_cowboy (Warthog CAS, Harrier, Attack Chopper, Gunner Strike)
  'prook',  // 7:  pilot_academy_rookie (Allied wingman 2, Harrier, Hornet)
  'tsgt',   // 8:  tank_ironclad_sgt (Enemy Tank Commander)
  'tbrawl', // 9:  tank_metal_brawler (Enemy Tank Commander)
  'thull',  // 10: tank_hulldown_perf (Enemy Tank Commander)
  'tchief', // 11: transport_crew_chief (Fast-Rope Transport, Door Gunner & Attack Chopper Crew)
] as const;

export type VoiceSuffix = (typeof VOICES)[number];

/** Permanently blacklisted chatter voice suffixes — never re-add or ship clips for these voices. */
export const BLACKLISTED_VOICES: ReadonlySet<string> = new Set([
  'tsmug',  // tank_smug_tactician
  'tunion', // transport_union_driver
  'tsurf',  // transport_hotdrop_surfer
  'ttruck', // transport_convoy_trucker
]);

/** Ground squad trooper voice count (indices 0..1: t2, t3). */
export const VOICE_COUNT = 2;

/** Total chatter voice count including pilots, tank commanders, and transport crews. */
export const ALL_VOICE_COUNT = VOICES.length;

/** Named index lookup into `VOICES`. */
export const VOICE_INDEX: Readonly<Record<VoiceSuffix, number>> = {
  t2: 0,
  t3: 1,
  pmace: 2,
  psace: 3,
  patc: 4,
  pvet: 5,
  pcow: 6,
  prook: 7,
  tsgt: 8,
  tbrawl: 9,
  thull: 10,
  tchief: 11,
};

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
