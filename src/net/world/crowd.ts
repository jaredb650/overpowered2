/**
 * Every player, for the host's soldiers and their Commander (enemies/outpost/crowd.ts). The enemy side runs on the host and
 * was written about one player; this is what lets each of its mechanics be about the player it concerns.
 *
 * Host: hands the Outpost its `crowd` (every player with a body in the world, and whose claim is being applied), and takes
 * each guest's `note`: what the men would have heard or the Commander noted of that guest, which the host cannot tell from
 * their pose (shots, a landing, a slam, a pickup, a sonar ping, a reload, being hurt). Footsteps need no note: they are read
 * off the guest's body. Guest: sends those notes, a few a second at most, and takes `jam`: who is working a jammer, hiding
 * under foil or playing dead, so its own sonar and minimap lie as the host's do (enemies/commander/jam.ts).
 */
import * as THREE from 'three';
import { NOTE_KINDS, type CrowdLink, type CrowdPlayer, type JamState, type Note, type NoteKind } from '../../enemies/outpost/crowd';
import type { WorldContext, WorldModule } from './context';
import type { Targeting } from './targeting';
import { validVec, type Vec } from './wire';

export type CrowdEvent =
  /** Guest to host: something I did (outpost/crowd.ts `Note`). */
  | { t: 'note'; k: NoteKind; n?: number; w?: string; at?: Vec; left?: number }
  /** Host to guests: what your sonar may say: the jammer is on, and the men (by uid) who run it, hide from it or lie still. */
  | { t: 'jam'; on: boolean; ops: number[]; cold: number[]; floor: number[] };

declare module '../../core/contracts' {
  interface GameEvents {
    /** Co-op host: an enemy's damage went to a guest (targeting.ts `hurt`): whom, how much, and what did it. */
    'coop:hurt': { id: string; amount: number; source: string };
  }
}

/** Seconds a guest's shots and hurts are gathered for before they are told. */
const GATHER = 0.3;
/** Notes a guest may send a second, and how far from its body one may say it happened. */
const NOTES_PER_SECOND = 14;
const NOTE_REACH = 30;
const MOST_UIDS = 64;

interface OutpostParts {
  crowd: CrowdLink | null;
  told(who: CrowdPlayer, note: Note): void;
  commander: { trapped(who: CrowdPlayer, cause: string, amount: number): void; jam: { tell(state: JamState): void } };
}

const uids = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length <= MOST_UIDS && value.every(n => Number.isInteger(n) && n > 0);

export class Crowd implements WorldModule {
  private outpost: OutpostParts | null = null;
  private readonly list: CrowdPlayer[] = [];
  private stale = true;
  private readonly rate = new Map<string, { second: number; n: number }>();
  private readonly note: Note = { kind: 'shots', n: 0, what: '', at: new THREE.Vector3(), left: 1 };
  /** Guest: shots and damage since the last note of each. */
  private shots = 0;
  private shotWith = '';
  private readonly shotAt = new THREE.Vector3();
  private hurt = 0;
  private gatherAt = 0;
  /** For the proofs: notes sent (a guest) and taken (the host), by kind. */
  readonly counts: Record<string, number> = {};

  constructor(private readonly w: WorldContext, private readonly targeting: Targeting, private readonly applying: () => string | null) {
    const { ctx, router } = w;
    router.host('note', (value, from, now) => this.noteIn(value, from, now));
    router.guest('jam', value => {
      if (typeof value.on !== 'boolean' || !uids(value.ops) || !uids(value.cold) || !uids(value.floor)) return;
      this.find()?.commander.jam.tell({ on: value.on, ops: value.ops, cold: value.cold, floor: value.floor });
    });
    if (w.hosting) {
      w.listen('coop:hurt', e => {
        const who = this.players().find(p => p.id === e.id);
        if (who) this.find()?.commander.trapped(who, e.source, e.amount);
      });
      return;
    }
    w.listen('weapon:fired', f => {
      this.shots++;
      this.shotWith = f.weapon;
      this.shotAt.copy(f.origin);
    });
    w.listen('player:damaged', d => { this.hurt += d.amount; });
    w.listen('player:landed', l => this.tell('land', l.impact, '', ctx.player.position));
    w.listen('player:slam', s => this.tell('slam', s.radius, '', s.position));
    w.listen('pickup:collected', p => this.tell('pickup', 1, p.kind, p.position));
    w.listen('sonar:ping', p => this.tell('ping', 1, '', p.origin));
    w.listen('weapon:reload', r => { if (r.phase === 'start') this.tell('reload', 1, r.weapon, ctx.player.position); });
  }

  /** The Outpost is built with the enemies, after the world: found on first use. Null on a map without one. */
  private find(): OutpostParts | null {
    if (this.outpost) return this.outpost;
    const outpost = (this.w.manager as unknown as { outpost?: OutpostParts | null } | undefined)?.outpost;
    if (!outpost?.told) return null;
    this.outpost = outpost;
    if (this.w.hosting) outpost.crowd = {
      players: () => this.players(),
      applying: () => {
        const id = this.applying();
        return id === null ? null : this.players().find(p => p.id === id) ?? null;
      },
      bySlot: slot => this.players().find(p => p.slot === slot) ?? null,
      jam: state => { if (this.w.ready) this.w.send({ t: 'jam', on: state.on, ops: state.ops.slice(0, MOST_UIDS), cold: state.cold.slice(0, MOST_UIDS), floor: state.floor.slice(0, MOST_UIDS) }); },
    };
    return outpost;
  }

  /** Host: every player whose body is in the world, the host's own first. Built once a frame. */
  private players(): readonly CrowdPlayer[] {
    if (!this.stale) return this.list;
    this.stale = false;
    const { list } = this;
    const { lobby } = this.w.session;
    list.length = 0;
    for (const target of this.targeting.players()) {
      const own = target.id === lobby.you;
      const row: CrowdPlayer = { id: target.id, slot: lobby.players.find(p => p.id === target.id)?.slot ?? -1, player: target.player, own };
      if (own) list.unshift(row);
      else list.push(row);
    }
    return list;
  }

  private tell(kind: NoteKind, n: number, what: string, at: THREE.Vector3, left?: number): void {
    if (!this.w.ready) return;
    this.counts[kind] = (this.counts[kind] ?? 0) + 1;
    this.w.send({ t: 'note', k: kind, n: Math.round(n * 100) / 100, ...(what ? { w: what } : {}), at: [Math.round(at.x * 10) / 10, Math.round(at.y * 10) / 10, Math.round(at.z * 10) / 10],
      ...(left === undefined ? {} : { left: Math.round(left * 100) / 100 }) });
  }

  /** Host: a guest's note, checked (their body is here and alive, it happened near it, not a flood) and handed to the enemy side. */
  private noteIn(value: Extract<CrowdEvent, { t: 'note' }>, from: string, now: number): void {
    const remote = this.w.sender(from, now);
    if (!remote || this.w.life(from).down || !NOTE_KINDS.includes(value.k) || !validVec(value.at)) return;
    const second = Math.floor(now / 1000);
    const rate = this.rate.get(from) ?? { second, n: 0 };
    if (rate.second !== second) { rate.second = second; rate.n = 0; }
    this.rate.set(from, rate);
    if (++rate.n > NOTES_PER_SECOND) return;
    const at = this.note.at.set(...value.at);
    const body = remote.char.root.position;
    if (Math.hypot(at.x - body.x, at.z - body.z) > NOTE_REACH) return;
    const who = this.players().find(p => p.id === from);
    const outpost = this.find();
    if (!who || !outpost) return;
    const n = typeof value.n === 'number' && Number.isFinite(value.n) ? Math.min(Math.max(value.n, 0), 500) : 1;
    this.note.kind = value.k;
    this.note.n = value.k === 'shots' ? Math.min(Math.round(n), 40) : n;
    this.note.what = typeof value.w === 'string' ? value.w.slice(0, 32) : '';
    this.note.left = typeof value.left === 'number' && Number.isFinite(value.left) ? Math.min(Math.max(value.left, 0), 1) : 1;
    this.counts[value.k] = (this.counts[value.k] ?? 0) + 1;
    outpost.told(who, this.note);
  }

  update(now: number): void {
    this.stale = true;
    if (this.w.hosting) {
      this.find();
      return;
    }
    if (now < this.gatherAt) return;
    this.gatherAt = now + GATHER * 1000;
    const { player } = this.w.ctx;
    if (this.shots > 0) this.tell('shots', this.shots, this.shotWith, this.shotAt);
    if (this.hurt > 0) this.tell('hurt', this.hurt, '', player.position, player.maxHealth > 0 ? player.health / player.maxHealth : 1);
    this.shots = this.hurt = 0;
  }

  dispose(): void {
    if (this.outpost && this.w.hosting) this.outpost.crowd = null;
    this.outpost = null;
  }
}

/** For a peer that is behind: which of this module's events may be left out (net/pressure.ts). A fact never is. */
export const CROWD_WIRE: import('../pressure').WireClasses<CrowdEvent> = { note: 'fact', jam: 'fact' };
