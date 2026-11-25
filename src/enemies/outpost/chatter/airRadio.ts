/**
 * Standalone radio chatter for enemy and allied aircraft pilots, door gunners, transport aircrews, and enemy tank crews.
 * Works both when Outpost is active (Badlands, Endless Humans) and when Outpost is null (Dogfight mode), sharing the
 * same rule table (`lines.json`) and recorded voice clips while supporting mid-sentence cut-offs when an aircraft or
 * vehicle is destroyed mid-transmission and two-way Air <-> Ground coordination with Outpost squads.
 */
import * as THREE from 'three';
import type { Ctx } from '../../../core/contracts';
import { isGuest } from '../../../core/coop';
import type { CommsKind, CommsLine } from '../events';
import type { Outpost } from '../index';
import { FACTION } from './names';
import { RULES } from './lines';
import { ChatterMemory, SPEAK_RATE, URGENT, airtime, lineText, type ChatterFacts } from './rules';
import { VOICE_INDEX } from './voices';

export type AirCrewRole =
  | 'warthog'
  | 'lancer'
  | 'harrier'
  | 'hornet'
  | 'raptor'
  | 'chopper'
  | 'doorGunner'
  | 'transport'
  | 'tank'
  | 'allyWingman';

export interface AirSpeaker {
  /** HUD speaker tag, e.g. 'Hog 2-1 · CAS' or 'Viper 1-1 · Wingman'. */
  callsign: string;
  /** Short flight/unit label for `CommsLine.squad`. */
  flight: string;
  /** Aircraft or crew class; passed as a boolean flag to the rule table. */
  role: AirCrewRole;
  /** Locked voice index into `VOICES` for this crew's lifetime. */
  voice: number;
  /** True for allied Dogfight wingmen (styled in var(--friend) and selects friendly lines). */
  ally?: boolean;
}

interface AirTalk {
  from: number;
  until: number;
  text: string;
}

/** Reserved Ace Pilot mini-boss voices (`pilot_manic_ace`, `pilot_surgical_ace`) — enemy F-22 Raptor Aces ONLY. */
export const ACE_VOICES: readonly number[] = [VOICE_INDEX.pmace, VOICE_INDEX.psace];

/** Dedicated voice pool per aircraft / vehicle crew class (see `docs/notes/voices.md`). */
export const ROLE_VOICE_POOLS: Readonly<Record<AirCrewRole, readonly number[]>> = {
  // Enemy F-22 Raptor Ace mini-bosses ONLY (Dogfight Wave 5/8/10+ & Badlands boss escorts).
  raptor: ACE_VOICES,
  // Allied wingmen (Viper Lead = serious ATC, Wingman 2 = eager academy rookie).
  allyWingman: [VOICE_INDEX.patc, VOICE_INDEX.prook],
  // Close-air-support & strike jets (never use reserved Ace voices).
  warthog: [VOICE_INDEX.pcow, VOICE_INDEX.pvet],
  lancer: [VOICE_INDEX.pvet],
  harrier: [VOICE_INDEX.prook, VOICE_INDEX.pcow],
  hornet: [VOICE_INDEX.patc, VOICE_INDEX.prook, VOICE_INDEX.pvet],
  // Rotorcraft & air-assault crews.
  chopper: [VOICE_INDEX.pcow, VOICE_INDEX.tchief],
  doorGunner: [VOICE_INDEX.tchief],
  transport: [VOICE_INDEX.tunion, VOICE_INDEX.tsurf, VOICE_INDEX.ttruck],
  // Armored vehicle / tank commanders.
  tank: [VOICE_INDEX.tsmug, VOICE_INDEX.tsgt, VOICE_INDEX.tbrawl, VOICE_INDEX.thull],
};

const CALLSIGN_POOLS: Record<AirCrewRole, { prefix: readonly string[]; flight: string }> = {
  warthog: { prefix: ['Hog 2-1', 'Hog 2-2', 'Boar 2-1', 'Tusk 2-2'], flight: 'CAS' },
  lancer: { prefix: ['Bone 3-1', 'Bone 3-2', 'Hammer 3-1', 'Anvil 3-2'], flight: 'Bomber' },
  harrier: { prefix: ['Jump 4-1', 'Jump 4-2', 'Dart 4-1', 'Harrier 4-2'], flight: 'VTOL' },
  hornet: { prefix: ['Sting 5-1', 'Sting 5-2', 'Wasp 5-1', 'Hornet 5-2'], flight: 'Strike' },
  raptor: { prefix: ['Raptor 1-1', 'Raptor 1-2', 'Ghost 1-1', 'Talon 1-2'], flight: 'Ace' },
  chopper: { prefix: ['Reaper 1', 'Reaper 2', 'Banshee 1', 'Valkyrie 2'], flight: 'Gunship' },
  doorGunner: { prefix: ['Door-1', 'Door-2', 'Gunner-1', 'Gunner-2'], flight: 'Gunship' },
  transport: { prefix: ['Chalk 1', 'Chalk 2', 'Dustoff 1', 'Lift 2'], flight: 'Air Assault' },
  tank: { prefix: ['Iron 1-1', 'Iron 1-2', 'Sabot 2-1', 'Anvil 2-2'], flight: 'Armor' },
  allyWingman: { prefix: ['Viper 1', 'Viper 2', 'Angel 1', 'Sabre 2'], flight: 'Wingman' },
};

const KIND_GAP_AIR: Partial<Record<CommsKind, number>> = {
  airInbound: 3.5,
  airStrike: 3.2,
  airDogfight: 3.8,
  airEvade: 2.8,
  airDown: 1.5,
  airSplash: 3.0,
};

const GLOBAL_AIR_GAP = 0.85;

const fallbackMemory = new ChatterMemory();
const talks = new Map<string, AirTalk>();
const kindAt = new Map<string, number>();
const roleSerial: Record<AirCrewRole, number> = {
  warthog: 0, lancer: 0, harrier: 0, hornet: 0, raptor: 0,
  chopper: 0, doorGunner: 0, transport: 0, tank: 0, allyWingman: 0,
};
let nextAirAt = 0;
const _facts: ChatterFacts = { faction: FACTION, tier: 'high', role: null, flags: {} };
const _pos = new THREE.Vector3();

/** Resets standalone air-radio state between runs or tests. */
export function resetAirRadio(): void {
  fallbackMemory.reset();
  talks.clear();
  kindAt.clear();
  for (const k in roleSerial) roleSerial[k as AirCrewRole] = 0;
  nextAirAt = 0;
}

/** Creates a pilot or vehicle crew speaker with a rotating tactical callsign and role-matched lifetime voice index. */
export function makeAirSpeaker(role: AirCrewRole, ally = false, customCallsign?: string): AirSpeaker {
  const pool = CALLSIGN_POOLS[role];
  const voices = ROLE_VOICE_POOLS[role];
  const idx = roleSerial[role]++;
  const tag = customCallsign ?? pool.prefix[idx % pool.prefix.length]!;
  const voice = voices[idx % voices.length]!;
  return {
    callsign: `${tag} · ${pool.flight}`,
    flight: pool.flight,
    role,
    voice,
    ally,
  };
}

function clockNow(ctx: Ctx): number {
  return ctx.time?.elapsed ?? (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);
}

function outpostOf(ctx: Ctx): Outpost | null {
  return (ctx.enemies as { outpost?: Outpost | null } | undefined)?.outpost ?? null;
}

/**
 * Emits a voiced radio line from an aircraft pilot or vehicle crew using the shared rule table.
 * When Outpost is active, enemy air calls can automatically trigger a two-way ground-squad reply.
 */
export function sayAir(
  ctx: Ctx,
  kind: CommsKind,
  speaker: AirSpeaker,
  flags?: Record<string, boolean>,
  urgent = false,
): boolean {
  if (isGuest(ctx)) return false;
  const now = clockNow(ctx);
  const gapKey = `${speaker.ally ? 'ally' : 'hostile'}:${kind}`;
  const isUrgent = urgent || URGENT.has(kind);
  if (!isUrgent && now < nextAirAt) return false;
  if (!urgent && now < (kindAt.get(gapKey) ?? 0)) return false;

  const active = talks.get(speaker.callsign);
  if (active && now < active.until && kind !== 'airDown' && !urgent) return false;

  const outpost = outpostOf(ctx);
  const memory = outpost ? outpost.comms.memory : fallbackMemory;

  for (const f in _facts.flags) _facts.flags[f] = false;
  _facts.tier = 'high';
  _facts.role = null;
  _facts.flags[speaker.role] = true;
  if (speaker.ally) _facts.flags.ally = true;
  if (flags) Object.assign(_facts.flags, flags);

  const row = memory.pick(kind, _facts, now);
  if (row < 0) return false;
  const rule = RULES[row]!;
  const text = lineText(row, {});

  nextAirAt = now + GLOBAL_AIR_GAP;
  kindAt.set(gapKey, now + (KIND_GAP_AIR[kind] ?? 3));

  const until = now + airtime(text);
  talks.set(speaker.callsign, { from: now, until, text });

  _pos.copy(ctx.player.position);
  const line: CommsLine = {
    kind,
    text,
    squad: speaker.flight,
    speaker: speaker.callsign,
    enemy: null,
    position: _pos,
    row,
    name: -1,
    dead: -1,
    slots: null,
    why: `${rule.id}  air:${speaker.role}${speaker.ally ? ' ally' : ''}`,
    voice: speaker.voice,
    clip: null,
    radio: true,
    ally: !!speaker.ally,
  };
  ctx.events.emit('comms:line', line);

  // Two-way Air <-> Ground coordination: ground squads react to enemy CAS/air strikes or losing air cover.
  if (outpost && !speaker.ally && speaker.role !== 'tank' && speaker.role !== 'doorGunner') {
    if (kind === 'airInbound' || kind === 'airStrike') {
      scheduleGroundAirReply(outpost, { incomingAir: true, [speaker.role]: true }, 1.25);
    } else if (kind === 'airDown') {
      scheduleGroundAirReply(outpost, { airLost: true, [speaker.role]: true }, 1.0);
    }
  }

  return true;
}

/**
 * Cuts off an aircraft pilot or vehicle crew mid-sentence if they are shot down while transmitting.
 */
export function cutAir(ctx: Ctx, speaker: AirSpeaker): boolean {
  if (isGuest(ctx)) return false;
  const talk = talks.get(speaker.callsign);
  if (!talk) return false;
  talks.delete(speaker.callsign);
  const now = clockNow(ctx);
  if (now >= talk.until) return false;
  const at = Math.floor((now - talk.from) / SPEAK_RATE);
  if (at >= talk.text.length) return false;
  ctx.events.emit('comms:cut', { enemy: null, speaker: speaker.callsign, at, radio: true });
  return true;
}

function scheduleGroundAirReply(
  outpost: Outpost,
  flags: Record<string, boolean>,
  delay: number,
): void {
  outpost.comms.after(delay, () => {
    for (const q of outpost.squads) {
      if (!q.inContact) continue;
      const speaker = q.radioman?.fighting ? q.radioman : q.leader?.fighting ? q.leader : null;
      if (!speaker) continue;
      outpost.comms.say('groundAirCall', speaker, null, { flags });
      return;
    }
  });
}
