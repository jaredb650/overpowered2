/**
 * Radio chatter as events. Section 19 ships recorded voices later, so a line is a kind plus text and nothing here plays
 * speech. Every call site says a kind; the rule table (chatter/) picks the row by who is talking and how scared he is, and
 * the row's id is what a voice bank will key on (docs/proposals/squad-chatter.md).
 *
 * In co-op only the host decides: guests hear its lines as `chatter` events (src/net/world.ts) and say nothing of their own.
 */
import * as THREE from 'three';
import type { AiWorld } from '../aiWorld';
import { say } from '../attacks';
import { FACTION, NAME_LIST, speakerTag } from './chatter/names';
import { ChatterMemory, URGENT, lineText, type ChatterFacts } from './chatter/rules';
import { RULES } from './chatter/lines';
import type { CommsKind, CommsLine } from './events';
import type { Soldier } from './soldier';

/** Seconds before the same kind of line can come again. */
const KIND_GAP: Partial<Record<CommsKind, number>> = {
  fix: 24, contact: 4, lost: 8, noise: 10, moving: 5, covering: 6, reloading: 4, flanking: 8, fear: 7, panic: 5, surrender: 6, regroup: 6, fallback: 6,
  hit: 3, dying: 6, beg: 5, scream: 4, rescue: 6, lastStand: 5, pinning: 7, flushing: 6, rushing: 5, cutoff: 6, opening: 8, wounded: 7, dry: 5, hostage: 5, clearShot: 5,
};
const DEFAULT_KIND_GAP = 2.5;
/** Spacing between any two lines, so the feed stays readable. A casualty cuts in regardless. */
const LINE_GAP = 1.3;
/** What radio silence takes off the air. A man on fire does not keep radio discipline. */
const DISCIPLINED: ReadonlySet<CommsKind> = new Set<CommsKind>([
  'contact', 'lost', 'noise', 'moving', 'covering', 'flanking', 'breach', 'fallback', 'regroup', 'fix', 'reloading', 'takingCommand', 'frag', 'flash',
  'pinning', 'flushing', 'rushing', 'cutoff', 'ambushSet', 'opening', 'wounded', 'dry', 'obey', 'behindUs',
]);

export class Comms {
  private nextLineAt = 0;
  private readonly kindAt = new Map<CommsKind, number>();
  readonly memory = new ChatterMemory();
  private readonly facts: ChatterFacts = { faction: FACTION, state: 'steady', role: null, rank: null, leader: false, buddy: false, flags: { dead: false } };
  private readonly line: CommsLine = { kind: 'contact', text: '', squad: '', speaker: null, enemy: null, position: new THREE.Vector3(), row: -1, name: -1, dead: -1 };

  constructor(private readonly w: AiWorld) {}

  reset(): void {
    this.nextLineAt = 0;
    this.kindAt.clear();
    this.memory.reset();
  }

  /** A guest's men only move their lips to the host's words. */
  private get deaf(): boolean {
    const coop = this.w.ctx.coop;
    return !!coop?.world && !coop.hosting;
  }

  /** `s` is who says it. Null is Command on the radio, heard everywhere. `dead` is the man whose death it is about. */
  say(kind: CommsKind, s: Soldier | null, dead: Soldier | null = null): void {
    const { w, line, facts } = this;
    const now = w.now;
    if (this.deaf) return;
    // A hole in the lung or the throat takes the voice with it, and a man in an ambush is not going to give it away.
    if (s?.injuries.mute || s?.silent) return;
    if (DISCIPLINED.has(kind) && w.enemies.outpost!.doctrine.radioSilence) return;
    if (now < (this.kindAt.get(kind) ?? 0)) return;
    if (now < this.nextLineAt && !URGENT.has(kind)) return;
    this.kindAt.set(kind, now + (KIND_GAP[kind] ?? DEFAULT_KIND_GAP));
    facts.state = s?.state ?? 'steady';
    facts.role = s?.role ?? null;
    facts.rank = s?.rank ?? null;
    facts.leader = s?.isLeader ?? false;
    facts.buddy = !!s && !!dead && (dead.buddy === s || s.buddy === dead);
    facts.flags.dead = !!dead && dead.name >= 0;
    // Every row on its gap is silence, which keeps the kind's gap like a line would.
    const row = this.memory.pick(kind, facts, now);
    if (row < 0) return;
    this.nextLineAt = now + LINE_GAP;
    line.kind = kind;
    line.row = row;
    line.name = s?.name ?? -1;
    line.dead = facts.flags.dead ? dead!.name : -1;
    line.text = lineText(row, line.dead >= 0 ? NAME_LIST[line.dead]! : null);
    line.squad = s ? s.squad.name : 'Command';
    line.speaker = s ? speakerTag(s.name, s.rankDef.label, s.squad.name) : null;
    line.enemy = s ? s.e : null;
    if (s) line.position.copy(s.e.center);
    else line.position.copy(w.player.position);
    w.ctx.events.emit('comms:line', line);
    // A dying man's voice is audio's `vox_dying_human`, from the same moment's `enemy:condition`.
    if (s && kind !== 'dying') say(s.e, w, RULES[row]!.channel === 'scream' ? 'vox_scream' : s.e.def.voice.attack, 0.45);
  }

  /** Words the caller chose, on the same feed. `who` names a voice that belongs to nobody on the map. */
  relay(text: string, s: Soldier | null, who: string | null): void {
    const { w, line } = this;
    if (s?.injuries.mute || this.deaf) return;
    this.nextLineAt = w.now + LINE_GAP;
    line.kind = 'order';
    line.text = text;
    line.row = line.dead = -1;
    line.name = s?.name ?? -1;
    line.squad = s ? s.squad.name : 'Command';
    line.speaker = who ?? (s ? speakerTag(s.name, s.rankDef.label, s.squad.name) : null);
    line.enemy = s ? s.e : null;
    if (s) line.position.copy(s.e.center);
    else line.position.copy(w.player.position);
    w.ctx.events.emit('comms:line', line);
  }
}
