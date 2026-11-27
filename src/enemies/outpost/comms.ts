/**
 * What the men say, as events. Every call site says a concept; the rule table (chatter/) picks the row by who is talking and how
 * scared he is (docs/design/squad-comms.md). Nothing here plays speech: a row's id is what the voices will key on.
 *
 * Speech is physical. One man talks for his squad at a time, for the line's airtime. A line of a higher priority (critical >
 * tactical > emotional > idle) cuts the one in the air; a lower one waits its turn and is looked up again when it is due, so a
 * moment that has passed is simply not said. Death, a big hit or a lost limb cuts a man mid-word (`comms:cut`), and his own pain
 * always cuts his own line. Some lines bring an answer from another man (`CHAIN`).
 *
 * In co-op only the host decides: guests hear its lines as `chatter` and `chatcut` events (src/net/world.ts) and say nothing of
 * their own.
 */
import * as THREE from 'three';
import type { AiWorld } from '../aiWorld';
import { shout } from '../attacks';
import { FACTION, NAME_LIST, callName, speakerTag } from './chatter/names';
import { ChatterMemory, RANK, SPEAK_RATE, TIER_OF, URGENT, airtime, lineText, priorityOf, type ChatterFacts, type Priority } from './chatter/rules';
import { RULES } from './chatter/lines';
import type { CommsKind, CommsLine } from './events';
import type { OutpostSquad } from './squad';
import { listener } from './chatter/radio';
import { reactToCall, setReactedInSay } from './chatter/listeners';
import { VOICED, clipFor } from './chatter/voices';
import type { Soldier } from './soldier';
import { isGuest } from '../../core/coop';

/** Seconds before the same kind of line can come again. */
const KIND_GAP: Partial<Record<CommsKind, number>> = {
  fix: 24, contact: 4, lost: 8, noise: 10, moving: 5, covering: 6, reloading: 4, flanking: 8, fear: 7, panic: 5, surrender: 6, regroup: 6, fallback: 6,
  set: 6, playerHit: 10, rocketOut: 2.5, gunDown: 4, hold: 6,
  shieldUp: 8, stackOn: 4, shieldPush: 10, breakOut: 4, shieldFlanked: 6, shieldDown: 3, merge: 4,
  habit: 3, flee: 4, holdout: 2, fakeOut: 1, revenge: 4, taunt: 12,
  contactReport: 12, copy: 3, status: 10, squadWiped: 4, sayAgain: 1, radioCheck: 1, radioLost: 1, radioGrab: 1, hit: 3, dying: 6, plateHeld: 15, plateGone: 4, pierced: 10, artery: 5, gut: 5, limbLost: 1, downed: 6, beg: 5, scream: 4, rescue: 6, lastStand: 5, pinning: 7, flushing: 6, rushing: 5, cutoff: 6, opening: 8, wounded: 7, dry: 5, hostage: 5, clearShot: 5,
  vehSpotted: 7, ordnance: 2.5, vehHijack: 4, vehRoadkill: 4, vehAir: 7, vehArmor: 7, groundAirCall: 7,
  airInbound: 4, airStrike: 3.5, airDogfight: 4, airEvade: 3, airDown: 2, airSplash: 3.5,
};
const DEFAULT_KIND_GAP = 2.5;
/** Spacing between any two lines, so the feed stays readable. A casualty cuts in regardless. */
const LINE_GAP = 1.3;
/** What radio silence takes off the air. A man on fire does not keep radio discipline. */
const DISCIPLINED: ReadonlySet<CommsKind> = new Set<CommsKind>([
  'contact', 'lost', 'noise', 'moving', 'covering', 'flanking', 'breach', 'fallback', 'regroup', 'fix', 'reloading', 'takingCommand', 'frag', 'flash',
  'pinning', 'flushing', 'rushing', 'cutoff', 'ambushSet', 'opening', 'wounded', 'dry', 'obey', 'behindUs', 'ack',
  'set', 'playerHit', 'rocketOut', 'hold',
  'contactReport', 'copy', 'status',
]);
/** A man's own pain cuts whatever he was saying. */
const PAIN: ReadonlySet<CommsKind> = new Set<CommsKind>(['hit', 'scream', 'dying', 'limbLost', 'artery', 'gut', 'downed', 'plateGone']);
/** Lines that bring an answer from another man in the squad, after the call has been said. */
/** Radio calls that another squad's operator answers. */
export const NET_CHAIN: Partial<Record<CommsKind, CommsKind>> = { contactReport: 'copy', status: 'copy' };
export const CHAIN: Partial<Record<CommsKind, CommsKind>> = { frag: 'ack', flash: 'ack', reloading: 'covering', gunDown: 'hold', rocketOut: 'ack', merge: 'ack' };
/** A hit this big stops a sentence: a share of his health, or a limb. */
const BIG_HIT = 0.3;
/** Metres of height that make "above us" or "under us", and the speeds that make "charging" and "too fast". */
const CLIMB = 2.5;
const CHARGE = 4;
const FAST = 8;
/** A line waiting for its squad's turn is dropped if the turn is this late. */
const STALE = 4;

/** What a call site knows that the rows may ask about: blanks to fill and facts of the moment. */
export interface SayWith {
  slots?: Record<string, string>;
  flags?: Record<string, boolean>;
}

/**
 * Snapshot of a fallen soldier's identity captured before `Soldier.clear()` or pool reuse can wipe his fields.
 * Satisfies `Named` so `callName()` works directly even seconds later (e.g. queued lines or 7-second `radioGrab`).
 */
export interface DeadSnap {
  name: number;
  desig: number;
  nick: number;
  known: boolean;
  wasLeader: boolean;
  /** `e.uid` of this fallen man's buddy, or `-1` if none / mock without numeric uid. */
  buddyOf: number;
  /** Fallback buddy reference only when `buddyOf < 0` (unit tests with minimal mocks). */
  buddyRef?: Soldier | null;
  squad: OutpostSquad;
}

function isDeadSnap(x: Soldier | DeadSnap): x is DeadSnap {
  return 'buddyOf' in x;
}

/** Captures a fallen soldier's identity by value so delayed or queued chatter survives `Soldier.clear()` / pool reuse. */
export function snapDead(dead: Soldier | DeadSnap, speaker?: Soldier | null): DeadSnap {
  if (isDeadSnap(dead)) return dead;
  const mate = dead.buddy ?? (speaker && speaker.buddy === dead ? speaker : null);
  const buddyUid = typeof mate?.e?.uid === 'number' ? mate.e.uid : -1;
  return {
    name: dead.name,
    desig: dead.desig,
    nick: dead.nick,
    known: dead.known,
    wasLeader: dead.wasLeader,
    buddyOf: buddyUid,
    buddyRef: buddyUid < 0 ? mate : null,
    squad: dead.squad,
  };
}

interface Talk {
  s: Soldier | null;
  from: number;
  until: number;
  priority: Priority;
  interruptible: boolean;
  text: string;
  /** His own pain: a second wound waits for the first scream to end. */
  pain: boolean;
  /** On the radio: a cut dies in static. */
  radio: boolean;
}

interface Pending {
  kind: CommsKind;
  s: Soldier;
  dead: DeadSnap | null;
  with: SayWith | null;
  at: number;
  wanted: number;
  reply: boolean;
}

export class Comms {
  private nextLineAt = 0;
  private readonly kindAt = new Map<CommsKind, number>();
  readonly memory = new ChatterMemory();
  /** Who is talking for each squad (null for Command), and until when. */
  private readonly talks = new Map<OutpostSquad | null, Talk>();
  private readonly pending: Pending[] = [];
  private readonly timers: { at: number; run: () => void }[] = [];
  private readonly facts: ChatterFacts = { faction: FACTION, tier: 'high', role: null, flags: {} };
  private readonly slots: Record<string, string> = {};
  private readonly line: CommsLine = {
    kind: 'contact', text: '', squad: '', speaker: null, enemy: null, position: new THREE.Vector3(), row: -1, name: -1, dead: -1, slots: null, why: '', voice: -1, clip: null, radio: false, ally: false,
  };
  /** Alternates trooper voices for bodiless radio relays (`s === null`). */
  private relayVoice = 0;

  constructor(private readonly w: AiWorld) {
    const events = w.ctx.events;
    events.on('enemy:killed', k => this.silence(k.enemy));
    events.on('enemy:hit', h => {
      if (h.result.dealt >= BIG_HIT * h.enemy.maxHealth || h.result.severed.length > 0) this.silence(h.enemy);
    });
  }

  reset(): void {
    this.nextLineAt = 0;
    this.kindAt.clear();
    this.memory.reset();
    this.talks.clear();
    this.pending.length = 0;
    this.timers.length = 0;
    this.relayVoice = 0;
  }

  /** Something to decide `seconds` from now, on the AI clock: the radio's calls into silence. */
  after(seconds: number, run: () => void): void {
    this.timers.push({ at: this.w.now + seconds, run });
  }

  /** A guest's men only move their lips to the host's words. */
  private get deaf(): boolean {
    return isGuest(this.w.ctx);
  }

  /** Whoever is saying something with this body stops, mid-word. */
  silence(enemy: unknown): void {
    for (const [key, talk] of this.talks) if (talk.s?.e === enemy) this.cut(key, talk);
  }

  private cut(key: OutpostSquad | null, talk: Talk): void {
    this.talks.delete(key);
    const at = Math.floor((this.w.now - talk.from) / SPEAK_RATE);
    if (at >= talk.text.length || !talk.s) return;
    this.w.ctx.events.emit('comms:cut', { enemy: talk.s.e, at, radio: talk.radio });
  }

  /** Lines that waited for their turn, looked up again now it has come. */
  update(): void {
    const now = this.w.now;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i]!;
      if (now < t.at) continue;
      this.timers.splice(i, 1);
      t.run();
    }
    if (this.pending.length === 0) return;
    // In the order they fell due, so an answer keeps its place behind the call.
    this.pending.sort((a, b) => a.at - b.at);
    while (this.pending.length > 0 && this.pending[0]!.at <= now) {
      const p = this.pending.shift()!;
      const roster = this.w.enemies.outpost?.soldiers;
      if (now - p.wanted > STALE || !p.s.e.alive || (roster && !roster.includes(p.s))) continue;
      this.say(p.kind, p.s, p.dead, p.with, p.wanted, p.reply);
    }
  }

  private queue(kind: CommsKind, s: Soldier, dead: DeadSnap | null, extra: SayWith | null, at: number, wanted = this.w.now, reply = false): void {
    if (this.pending.some(p => p.s === s && p.kind === kind) || this.pending.length >= 12) return;
    this.pending.push({ kind, s, dead, with: extra, at, wanted, reply });
  }

  /**
   * `s` is who says it. Null is Command on the radio, heard everywhere. `dead` is the man it is about. `extra` fills the row's other
   * blanks ({clock}, {squad}...) and adds facts of the moment. `wanted` is when a line that had to wait was first wanted.
   */
  say(kind: CommsKind, s: Soldier | null, dead: Soldier | DeadSnap | null = null, extra: SayWith | null = null, wanted: number | null = null, reply = false): void {
    const { w, line, facts } = this;
    const now = w.now;
    if (this.deaf) return;
    if (s && !s.e.alive) return;
    // Physical AI reactions (dodging frags/flashes/backblast, medics responding to downed/scream, squad holding on gunDown)
    // must fire immediately even if the speech line is muted, radio-silenced, on cooldown, queued, or rate-limited.
    if (s && wanted === null && w.enemies.outpost) reactToCall(w.enemies.outpost, kind, s);
    // A hole in the lung or the throat takes the voice with it, and a man in an ambush is not going to give it away.
    if (s?.injuries.mute || s?.silent) return;
    if (DISCIPLINED.has(kind) && w.enemies.outpost?.doctrine?.radioSilence) return;
    if (now < (this.kindAt.get(kind) ?? 0)) return;
    const deadSnap = dead ? snapDead(dead, s) : null;
    const buddies = !!s && !!deadSnap && (
      (deadSnap.buddyOf >= 0 && s.e?.uid === deadSnap.buddyOf)
      || (deadSnap.buddyOf < 0 && deadSnap.buddyRef === s)
      || (dead !== null && !isDeadSnap(dead) && s.buddy === dead)
    );
    for (const f in facts.flags) facts.flags[f] = false;
    for (const k in this.slots) delete this.slots[k];
    // The read first, so a call site's own facts win over it.
    if (s) this.read(s);
    if (extra?.flags) Object.assign(facts.flags, extra.flags);
    // His pair, if still on his feet in the squad: the crawling man calls him by name.
    // When recorded voice clips are active for garrison troops, only nicknames exist for {dead} and {buddy}; without a nickname, fall back to the plain voiced row.
    const voicesOn = ((w.ctx.hud as { settings?: { voices?: number } } | undefined)?.settings?.voices ?? 1) > 0;
    const voiced = voicesOn && VOICED.clips.size > 0 && facts.faction === 'garrison';
    const mate = s?.buddy;
    const pal = !!s && !!mate && mate !== s && mate.e.alive && mate.fighting && s.squad.members.includes(mate) && (!voiced || mate.nick >= 0);
    facts.flags.buddyAlive = pal;
    facts.tier = TIER_OF[s?.state ?? 'steady'];
    facts.role = s?.role ?? null;
    facts.flags.leader = s?.isLeader ?? false;
    facts.flags.buddy = buddies;
    // A man nobody learned the name of goes down as "man down", unless it is his buddy or the leader saying it.
    const canNameDead = !!deadSnap && deadSnap.name >= 0 && (deadSnap.known || buddies || facts.flags.leader || deadSnap.wasLeader) && (!voiced || deadSnap.nick >= 0);
    facts.flags.dead = canNameDead;
    const key = s?.squad ?? null;
    const talk = this.talks.get(key);
    const priority = priorityOf(kind, facts);
    let cut = false;
    if (talk && now < talk.until) {
      // His own pain cuts his own line; anything else of his waits until he has finished. Another man cuts in only with a higher call.
      if (talk.s === s ? PAIN.has(kind) && !talk.pain : RANK[priority] > RANK[talk.priority] && talk.interruptible) {
        this.cut(key, talk);
        cut = true;
      } else {
        if (s) this.queue(kind, s, deadSnap, extra, talk.until + 0.15, wanted ?? now, reply);
        return;
      }
    }
    if (now < this.nextLineAt && !URGENT.has(kind) && !cut && !reply) return;
    this.kindAt.set(kind, now + (KIND_GAP[kind] ?? DEFAULT_KIND_GAP));
    // Every row on its cooldown is silence, which keeps the kind's gap like a line would.
    const row = this.memory.pick(kind, facts, now);
    if (row < 0) return;
    const rule = RULES[row]!;
    this.nextLineAt = now + LINE_GAP;
    line.kind = kind;
    line.row = row;
    line.name = s ? (rule.radio && s.desig >= 0 ? s.desig : s.name) : -1;
    line.dead = canNameDead ? (voiced && deadSnap!.nick >= 0 ? deadSnap!.nick : callName(deadSnap!, rule.radio, buddies)) : -1;
    if (extra?.slots) Object.assign(this.slots, extra.slots);
    if (pal && rule.text.includes('{buddy}')) this.slots.buddy = NAME_LIST[voiced && mate!.nick >= 0 ? mate!.nick : callName(mate!, false, true)]!;
    // Everything but {dead} goes to co-op guests as words; {dead} goes as a name id.
    const sent: Record<string, string> = {};
    for (const k in this.slots) if (rule.text.includes(`{${k}}`)) sent[k] = this.slots[k]!;
    if (line.dead >= 0) this.slots.dead = NAME_LIST[line.dead]!;
    line.slots = Object.keys(sent).length > 0 ? sent : null;
    line.text = lineText(row, this.slots);
    line.squad = s ? s.squad.name : 'Command';
    line.speaker = s ? speakerTag(line.name, s.rankDef.label, s.squad.name) : null;
    line.enemy = s ? s.e : null;
    line.voice = s?.voice ?? -1;
    const resolvedClip = clipFor(row, this.slots, s ? s.voice : 0);
    line.clip = resolvedClip;
    line.radio = false;
    line.ally = false;
    if (s) line.position.copy(s.e.center);
    else line.position.copy(w.player.position);
    const why = this.memory.why;
    let flags = '';
    for (const f in facts.flags) if (facts.flags[f]) flags += ` ${f}`;
    line.why = `${rule.id}  ${why.score} pts, ${why.rivals} tied  ${facts.tier}${facts.role ? ` ${facts.role}` : ''}${flags}  ${rule.priority}`;
    const until = now + airtime(line.text);
    this.talks.set(key, { s, from: now, until, priority: rule.priority, interruptible: rule.interruptible, text: line.text, pain: PAIN.has(kind), radio: rule.radio });
    setReactedInSay(true);
    try {
      w.ctx.events.emit('comms:line', line);
    } finally {
      setReactedInSay(false);
    }
    // A dying man's voice is audio's `vox_dying_human`, from the same moment's `enemy:condition`.
    // His recorded voice says it, when it can; the synth grunt only stands in where there is no take.
    if (s && kind !== 'dying' && !resolvedClip) shout(s.e, w, rule.channel === 'scream' ? 'vox_scream' : s.e.def.voice.attack, 0.45);
    const answer = CHAIN[kind];
    const by = s && answer ? this.answerer(s) : null;
    if (by) this.queue(answer!, by, null, null, until + 0.1, now, true);
    const net = NET_CHAIN[kind];
    const op = s && net && w.enemies.outpost ? listener(w.enemies.outpost, s.squad) : null;
    if (op) this.queue(net!, op, null, { slots: { squad: s!.squad.name, to: op.squad.name } }, until + 0.3, now, true);
  }

  /**
   * Where the player is from where this man stands, and what he is doing: the clock (12 dead ahead, 3 to his right), height,
   * charging or running, fast, hurt, mounted. Worked out only when somebody speaks.
   */
  private read(s: Soldier): void {
    const { w, facts } = this;
    const e = s.e;
    const p = w.player;
    const dx = p.position.x - e.position.x;
    const dz = p.position.z - e.position.z;
    const fx = Math.sin(e.yaw);
    const fz = Math.cos(e.yaw);
    // His right is forward x up: (-fz, 0, fx).
    let hour = Math.round(Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz) / (Math.PI / 6));
    hour = ((hour % 12) + 12) % 12 || 12;
    this.slots.clock = `${hour} o'clock`;
    const dist = Math.hypot(dx, dz) || 1;
    const closing = -(p.velocity.x * dx + p.velocity.z * dz) / dist;
    const rise = p.position.y - e.position.y;
    const senseHealth = p as unknown as { health?: number; maxHealth?: number };
    const focused = typeof senseHealth.health === 'number' && typeof senseHealth.maxHealth === 'number'
      ? { health: senseHealth.health, maxHealth: senseHealth.maxHealth }
      : (w.ctx.coop?.world?.targetPlayer ?? w.ctx.player);
    const flags = facts.flags;
    flags.behind = hour >= 5 && hour <= 7;
    flags.above = rise > CLIMB;
    flags.below = rise < -CLIMB;
    flags.charging = closing > CHARGE && dist < 30;
    flags.fleeing = closing < -CHARGE;
    flags.fast = p.speed > FAST;
    flags.playerHurt = focused.maxHealth > 0 && focused.health < focused.maxHealth * 0.5;
    flags.inVehicle = p.mount !== 'foot';
    flags.airborne = p.airborne;
    flags.heavyArmor = p.heavyArmor;
  }

  /** Who answers a man: his buddy if he can, otherwise the nearest of his squad still fighting. */
  private answerer(s: Soldier): Soldier | null {
    const b = s.buddy;
    if (b && b !== s && b.squad === s.squad && b.fighting && s.squad.members.includes(b)) return b;
    let best: Soldier | null = null;
    let near = Infinity;
    for (const m of s.squad.members) {
      if (m === s || !m.fighting) continue;
      const d = m.e.position.distanceToSquared(s.e.position);
      if (d < near) {
        near = d;
        best = m;
      }
    }
    return best;
  }

  /** Words the caller chose, on the same feed. `who` names a voice that belongs to nobody on the map. */
  relay(text: string, s: Soldier | null, who: string | null, clip: string | null = null, radio = false): void {
    const { w, line } = this;
    if (this.deaf || s?.injuries.mute || s?.silent || (s && !s.e.alive)) return;
    if (s) {
      const prev = this.talks.get(s.squad);
      if (prev && w.now < prev.until) this.cut(s.squad, prev);
    }
    this.nextLineAt = w.now + LINE_GAP;
    line.kind = 'order';
    line.text = text;
    line.row = line.dead = -1;
    line.slots = null;
    line.voice = s ? s.voice : clip ? (this.relayVoice++ & 1) : -1;
    line.clip = clip;
    line.radio = radio;
    line.ally = false;
    line.why = 'relay (words a caller chose)';
    line.name = s ? (radio && s.desig >= 0 ? s.desig : s.name) : -1;
    line.squad = s ? s.squad.name : 'Command';
    line.speaker = who ?? (s ? speakerTag(line.name, s.rankDef.label, s.squad.name) : null);
    line.enemy = s ? s.e : null;
    if (s) {
      line.position.copy(s.e.center);
      this.talks.set(s.squad, { s, from: w.now, until: w.now + airtime(text), priority: 'tactical', interruptible: true, text, pain: false, radio });
    } else line.position.copy(w.player.position);
    w.ctx.events.emit('comms:line', line);
  }
}
