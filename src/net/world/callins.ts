/**
 * Call-ins across players. The owner's rule: everyone can call them in, and it is global.
 *
 * A player's game tells the others what it called and what that does afterwards; every screen flies a copy through the same
 * strike code on a context that hurts nothing (progression/callins/mirror.ts). Damage stays with the caller, as hit claims
 * the host checks (claims.ts): the host notes each call so that player's call-in damage passes (authority.ts `callIn`).
 *
 *   callin   the news: a feed line for the others ("VIPER called in AIRSTRIKE"), and the host's note
 *   cin      the order: which call-in, its number, where, which way, a seed. Every other screen starts the same one
 *   cnews    what a running call-in did that its order could not say: a steered beam's aim, a gunship's round, a
 *            helicopter's pose, flares, a shoot-down, an early end. Kinds and their numbers: callins/link.ts
 *   mech     the Distraint Frame a player is in: its pose ten times a second (`p`), or one thing it did (`k`, `v`).
 *            A `mech` with neither says the player left it
 *   aadown   host to one guest: the Commander's missile brought down that guest's aircraft
 *   pfx      a streak perk's effect in the world: Chain Storm's lightning arc between two points (`k` 0), Frost Nova's ring
 *            (`k` 1). The perks' blasts (Skyfall, Chain Reaction, Hellfire rounds) already travel as `boom`
 *
 * A guest's goes to the host, which checks it, plays it and passes it on to the other guests with the caller's slot; the
 * host's own goes to every guest. Numbers are rounded to a millimetre before they go. What arrives is checked field by
 * field and capped per sender a second: it came from another browser.
 */
import * as THREE from 'three';
import type { CallInId } from '../../core/gameplay';
import { CALLINS, EFFECTS, FROST } from '../../progression/data';
import { MECH_KINDS, NEWS_KINDS, NEWS_NUMBERS, type CallinLink, type CallNews, type CallOrder, type MechKind } from '../../progression/callins/link';
import type { WorldContext, WorldModule } from './context';
import { validVec, type Vec } from './wire';

/** Someone called a strike or an aircraft in: a feed line for the others. */
export type CallinEvent = { t: 'callin'; id: string; slot?: number };
/** The order: enough for every other screen to fly the same call-in. `q` is `ai` (sent in with its crew). */
export type CallOrderEvent = { t: 'cin'; slot?: number; id: string; n: number; at: Vec; yaw: number; seed: number; q?: 1 };
/** News of a running call-in: `k` indexes `NEWS_KINDS`. */
export type CallNewsEvent = { t: 'cnews'; slot?: number; n: number; k: number; v?: number[] };
/** A player's Frame: a pose, or (`k`, indexing `MECH_KINDS`) something it did, or neither as they leave it. */
export type MechEvent = { t: 'mech'; slot?: number; p?: number[]; k?: number; v?: number[] };
/** Host to one guest: your aircraft of this kind is shot down. */
export type ShotDownEvent = { t: 'aadown'; id: string };
/** A perk's effect, drawn on every other screen: `k` 0 an arc from `a` to `b`, 1 a frost ring at `a`. */
export type PerkFxEvent = { t: 'pfx'; slot?: number; k: number; a: Vec; b?: Vec };
export type CallinsEvent = CallinEvent | CallOrderEvent | CallNewsEvent | MechEvent | ShotDownEvent | PerkFxEvent;

/** What one player may send a second, at most. A gunship's 25 mm is 18 rounds a second; two aircraft's poses are 20. */
const ORDERS_PER_SECOND = 4;
const NEWS_PER_SECOND = 90;
const MECH_PER_SECOND = 40;
const PERK_FX_PER_SECOND = 30;
const MECH_POSE = 13;

const UP = new THREE.Vector3(0, 1, 0);
const mm = (value: number): number => Math.round(value * 1000) / 1000;
const numbers = (value: unknown, most: number): value is number[] => Array.isArray(value) && value.length <= most
  && value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6);
const callinName = (id: unknown): string => typeof id === 'string' ? id.replace(/[^a-zA-Z]/g, '').replace(/([A-Z])/g, ' $1').toUpperCase().slice(0, 24) : '';

/** A count a second, per sender and kind. */
class Rate {
  private second = 0;
  private count = 0;
  take(now: number, most: number): boolean {
    const second = Math.floor(now / 1000);
    if (second !== this.second) { this.second = second; this.count = 0; }
    return ++this.count <= most;
  }
}

/** What the game's call-ins give co-op: `ProgressionSystem.callinLink` (callins/manager.ts). Absent in a test's stand-in. */
const linkOf = (w: WorldContext): CallinLink | null => (w.ctx.progression as unknown as { callinLink?: CallinLink } | undefined)?.callinLink ?? null;

export class Callins implements WorldModule {
  /**
   * For the proofs and the report: what this player's own call-ins have cost on the wire, by call-in, since `measure` was
   * turned on. Bytes are of the event as JSON, without the lane's envelope.
   */
  measure = false;
  readonly cost: Record<string, { orders: number; news: number; bytes: number }> = {};
  private readonly rates = new Map<string, { order: Rate; news: Rate; mech: Rate; perk: Rate }>();
  private readonly perkOut = new Rate();
  private readonly to = new THREE.Vector3();
  /** This player's running call-ins by number, to name the cost of their news. */
  private readonly mine = new Map<number, string>();
  /** Slots with a player in them last frame, to notice one leaving. */
  private present = 0;
  private readonly at = new THREE.Vector3();

  constructor(private readonly w: WorldContext) {
    const { ctx, session } = w;
    w.listen('callin:used', event => w.send({ t: 'callin', id: event.id, slot: session.lobby.me?.slot }));
    w.router.both('callin', (value, from, now) => {
      const player = w.playerOf(from, value.slot);
      const name = callinName(value.id);
      if (player && name) ctx.hud.feed(`${player.name} called in ${name}`, '#ffc14a');
      if (session.hosting && player) {
        w.validator.callIn(from, now);
        w.relay({ t: 'callin', id: name ? String(value.id).slice(0, 24) : '', slot: player.slot }, from);
      }
    });
    w.router.both('cin', (value, from, now) => this.orderIn(value, from, now));
    w.router.both('cnews', (value, from, now) => this.newsIn(value, from, now));
    w.router.both('mech', (value, from, now) => this.mechIn(value, from, now));
    w.router.both('pfx', (value, from, now) => this.perkIn(value, from, now));
    w.router.guest('aadown', value => {
      if (typeof value.id === 'string' && Object.hasOwn(CALLINS, value.id)) linkOf(w)?.shootDown(value.id as CallInId);
    });
    this.plug();
  }

  /** The game's side is built after the world: the line to it is made the first time it is there. */
  private plugged = false;
  private plug(): CallinLink | null {
    const link = linkOf(this.w);
    if (!link || this.plugged) return link;
    this.plugged = true;
    const { w } = this;
    const slot = () => w.session.lobby.me?.slot;
    link.send = {
      order: o => {
        this.mine.set(o.n, o.id);
        this.out({ t: 'cin', slot: slot(), id: o.id, n: o.n, at: o.at.map(mm) as Vec, yaw: mm(o.yaw), seed: o.seed, ...(o.ai ? { q: 1 as const } : {}) }, o.id, true);
      },
      news: n => {
        const k = NEWS_KINDS.indexOf(n.k);
        if (k >= 0) this.out({ t: 'cnews', slot: slot(), n: n.n, k, ...(n.v ? { v: n.v.map(mm) } : {}) }, this.mine.get(n.n) ?? 'other', false);
      },
      mech: p => this.out(p ? { t: 'mech', slot: slot(), p: p.map(mm) } : { t: 'mech', slot: slot() }, 'frame', false),
      mechNews: (kind, v) => this.out({ t: 'mech', slot: slot(), k: MECH_KINDS.indexOf(kind), ...(v ? { v: v.map(mm) } : {}) }, 'frame', false),
    };
    return link;
  }

  private out(event: CallinsEvent, id: string, order: boolean): void {
    if (!this.w.ready) return;
    this.w.send(event);
    if (!this.measure) return;
    const cost = this.cost[id] ??= { orders: 0, news: 0, bytes: 0 };
    if (order) cost.orders++;
    else cost.news++;
    cost.bytes += JSON.stringify(event).length;
  }

  private rate(from: string) {
    let rate = this.rates.get(from);
    if (!rate) this.rates.set(from, rate = { order: new Rate(), news: new Rate(), mech: new Rate(), perk: new Rate() });
    return rate;
  }

  /** The slot an arriving event is about: on the host its sender's, on a guest the one the host stamped. Never this player's own. */
  private slotOf(from: string, slot: number | undefined): number | null {
    const player = this.w.playerOf(from, slot);
    if (!player || player.id === this.w.session.lobby.you) return null;
    return player.slot;
  }

  private orderIn(value: CallOrderEvent, from: string, now: number): void {
    const { w } = this;
    const slot = this.slotOf(from, value.slot);
    if (slot === null || typeof value.id !== 'string' || !Object.hasOwn(CALLINS, value.id) || !Number.isInteger(value.n) || value.n < 0 || value.n > 255
      || !validVec(value.at) || !Number.isFinite(value.yaw) || Math.abs(value.yaw) > 100 || !Number.isFinite(value.seed)) return;
    const clean: CallOrderEvent = { t: 'cin', slot, id: value.id, n: value.n, at: value.at, yaw: value.yaw, seed: Math.floor(Math.abs(value.seed)) % 0x100000000, ...(value.q === 1 ? { q: 1 as const } : {}) };
    if (w.hosting) {
      if (!this.rate(from).order.take(now, ORDERS_PER_SECOND)) return;
      // A call-in's damage comes as claims for minutes afterwards: this is what lets them pass.
      w.validator.callIn(from, now);
      w.relay(clean, from);
      // The Commander answers a teammate's aircraft as he answers the host's.
      w.ctx.events.emit('callin:teammate', { id: clean.id as CallInId, slot, position: this.at.set(...clean.at) });
    }
    const order: CallOrder = { n: clean.n, id: clean.id as CallInId, at: clean.at, yaw: clean.yaw, seed: clean.seed, ai: clean.q === 1, age: 0 };
    this.plug()?.order(slot, order);
  }

  private newsIn(value: CallNewsEvent, from: string, now: number): void {
    const { w } = this;
    const slot = this.slotOf(from, value.slot);
    const kind = NEWS_KINDS[value.k];
    if (slot === null || !kind || !Number.isInteger(value.n) || value.n < 0 || value.n > 255 || (value.v !== undefined && !numbers(value.v, NEWS_NUMBERS))) return;
    if (w.hosting) {
      if (!this.rate(from).news.take(now, NEWS_PER_SECOND)) return;
      w.relay({ t: 'cnews', slot, n: value.n, k: value.k, ...(value.v ? { v: value.v } : {}) }, from);
    }
    const news: CallNews = value.v ? { n: value.n, k: kind, v: value.v } : { n: value.n, k: kind };
    this.plug()?.news(slot, news);
  }

  private mechIn(value: MechEvent, from: string, now: number): void {
    const { w } = this;
    const slot = this.slotOf(from, value.slot);
    if (slot === null) return;
    const kind: MechKind | undefined = value.k === undefined ? undefined : MECH_KINDS[value.k];
    if (value.p !== undefined && (!numbers(value.p, MECH_POSE) || value.p.length !== MECH_POSE)) return;
    if (value.k !== undefined && (!kind || (value.v !== undefined && !numbers(value.v, NEWS_NUMBERS)))) return;
    if (w.hosting) {
      if (!this.rate(from).mech.take(now, MECH_PER_SECOND)) return;
      w.relay({ t: 'mech', slot, ...(value.p ? { p: value.p } : {}), ...(kind ? { k: value.k, ...(value.v ? { v: value.v } : {}) } : {}) }, from);
    }
    const link = this.plug();
    if (!link) return;
    if (kind) link.mechNews(slot, kind, value.v ?? []);
    else link.mech(slot, value.p ?? null);
  }

  /** This player's perk drew something in the world: the others draw it too. */
  perkFx(kind: 'arc' | 'nova', at: THREE.Vector3, to?: THREE.Vector3): void {
    if (!this.w.ready || !this.perkOut.take(performance.now(), PERK_FX_PER_SECOND)) return;
    const a = [mm(at.x), mm(at.y), mm(at.z)] as Vec;
    this.out(kind === 'arc' && to ? { t: 'pfx', slot: this.w.session.lobby.me?.slot, k: 0, a, b: [mm(to.x), mm(to.y), mm(to.z)] } : { t: 'pfx', slot: this.w.session.lobby.me?.slot, k: 1, a }, 'perks', false);
  }

  private perkIn(value: PerkFxEvent, from: string, now: number): void {
    const { w } = this;
    const { audio, fx } = w.ctx;
    const slot = this.slotOf(from, value.slot);
    if (slot === null || !validVec(value.a) || (value.k !== 0 && value.k !== 1) || (value.k === 0 && !validVec(value.b))) return;
    if (w.hosting) {
      if (!this.rate(from).perk.take(now, PERK_FX_PER_SECOND)) return;
      w.relay(value.k === 0 ? { t: 'pfx', slot, k: 0, a: value.a, b: value.b } : { t: 'pfx', slot, k: 1, a: value.a }, from);
    }
    const at = this.at.set(...value.a);
    if (value.k === 0) {
      const to = this.to.set(...value.b!);
      fx.arc(at, to, EFFECTS.chainStorm.color, 0.22, 0.16);
      fx.sparks(to, this.to.clone().sub(at).normalize(), 10, EFFECTS.chainStorm.color);
      audio.play('lightning_arc', { position: at });
    } else {
      fx.ring(at, UP, EFFECTS.frostNova.color, FROST.radius * 2);
      audio.play('frost_nova_blast', { position: at });
    }
  }

  /** Host: the Commander's missile on what a teammate called in. True when that player has one of that kind up, as far as this screen knows. */
  shootDown(slot: number, id: CallInId): boolean {
    const { w } = this;
    const player = w.session.lobby.players.find(p => p.slot === slot);
    if (!w.hosting || !player || player.host || !this.plug()?.has(slot, id)) return false;
    w.send({ t: 'aadown', id }, player.id);
    return true;
  }

  /** Every frame: a player who left takes their call-ins with them, and a player in a Frame is drawn as the Frame alone. */
  update(): void {
    const link = this.plug();
    if (!link) return;
    const { session } = this.w;
    let present = 0;
    for (const player of session.lobby.players) present |= 1 << player.slot;
    const left = this.present & ~present;
    for (let slot = 0; left !== 0 && slot < 4; slot++) if (left & (1 << slot)) link.drop(slot);
    this.present = present;
    for (const remote of session.remotes.values()) remote.hidden = link.inFrame(remote.player.slot);
  }

  dispose(): void {
    const link = linkOf(this.w);
    if (link && this.plugged) link.send = null;
    this.rates.clear();
  }
}
