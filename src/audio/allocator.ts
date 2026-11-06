/**
 * Polyphony rules, kept free of Web Audio so they can be tested directly.
 *
 * A new sound gets a voice by one of three routes, checked in order: its own id is at its cap, so its
 * oldest voice is retriggered; its family is at its cap, so the family's weakest goes; the budget is
 * spent, so the weakest voice anywhere goes. In the last two a stronger voice is never cut for a
 * weaker sound: the new sound is dropped instead.
 *
 * A critical sound is the exception. It is never dropped, so a mix full of explosions cannot cost the
 * player a gunshot, and only another critical sound can take a critical sound's voice.
 */
export interface VoiceSlot {
  /** Catalogue id, or null when free. */
  soundId: string | null;
  family: string | undefined;
  priority: number;
  critical: boolean;
  /** Start sequence number. Lower is older. */
  order: number;
  /** Current linear level after distance, for choosing between equals. */
  loudness: number;
  /** Already fading out. Does not count toward any cap. */
  releasing: boolean;
  loop: boolean;
}

export interface VoiceRequest {
  id: string;
  family?: string;
  familyMax?: number;
  maxVoices: number;
  priority: number;
  critical: boolean;
}

/** Which of two voices to give up first. Quieter loses among equals, so the mix keeps what you can hear. */
function weaker<T extends VoiceSlot>(a: T | null, b: T): T {
  if (!a) return b;
  if (a.critical !== b.critical) return a.critical ? b : a;
  // Cutting a loop is audible for as long as it would have run. Prefer a one-shot at the same priority.
  if (a.priority !== b.priority) return a.priority < b.priority ? a : b;
  if (a.loop !== b.loop) return a.loop ? b : a;
  if (Math.abs(a.loudness - b.loudness) > 0.02) return a.loudness < b.loudness ? a : b;
  return a.order < b.order ? a : b;
}

export type DropReason = 'family' | 'budget';

export type Decision<T> = { kind: 'free' } | { kind: 'drop'; reason: DropReason } | { kind: 'steal'; victim: T };

const FREE = { kind: 'free' } as const;
const DROP_FAMILY = { kind: 'drop', reason: 'family' } as const;
const DROP_BUDGET = { kind: 'drop', reason: 'budget' } as const;
const steal = { kind: 'steal', victim: null as unknown };

/** One shared result: this runs on every play, and the caller reads it at once. */
function reuse<T>(victim: T): Decision<T> {
  steal.victim = victim;
  return steal as Decision<T>;
}

/** @param limit how many of these voices may sound at once, which the load governor can hold below the pool's size. */
export function arbitrate<T extends VoiceSlot>(voices: readonly T[], request: VoiceRequest, limit = voices.length): Decision<T> {
  let sameCount = 0;
  let sameOldest: T | null = null;
  let familyCount = 0;
  let familyWeakest: T | null = null;
  let weakest: T | null = null;
  let fading: T | null = null;
  let busy = 0;
  let active = 0;
  for (const v of voices) {
    if (v.soundId === null) continue;
    busy++;
    if (v.releasing) {
      fading = v;
      continue;
    }
    active++;
    weakest = weaker(weakest, v);
    if (v.soundId === request.id) {
      sameCount++;
      if (!sameOldest || v.order < sameOldest.order) sameOldest = v;
    }
    if (request.family !== undefined && v.family === request.family) {
      familyCount++;
      familyWeakest = weaker(familyWeakest, v);
    }
  }
  if (sameCount >= request.maxVoices && sameOldest) return reuse(sameOldest);
  if (request.family !== undefined && request.familyMax !== undefined && familyCount >= request.familyMax && familyWeakest) {
    return outranks(familyWeakest, request) ? DROP_FAMILY : reuse(familyWeakest);
  }
  if (busy < voices.length && active < limit) return FREE;
  if (weakest && !outranks(weakest, request)) return reuse(weakest);
  // Every voice mid-fade is the one case with nothing to steal, and a critical sound still may not be refused.
  if (request.critical && (weakest ?? fading)) return reuse((weakest ?? fading)!);
  return DROP_BUDGET;
}

function outranks(voice: VoiceSlot, request: VoiceRequest): boolean {
  if (request.critical) return false;
  return voice.critical || voice.priority > request.priority;
}
