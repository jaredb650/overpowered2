/**
 * The world that breaks, shared: barrels, fuel tanks and the breakable props (windows, monitors, copiers, racks, chairs).
 * The objects and every rule are world/objects.ts and world/breakables.ts; this is their wire (`PropLink`).
 *
 * The host decides. A thing breaks once, for everyone, by its number in the map's list (the map is built from one seed, so the
 * lists match on every screen).
 *  - A guest tells the host what its own shots (`hit`, added up per frame) and blasts (`blast`) reached. What its own hit breaks
 *    it breaks at once on its own screen, as a guess; the host's `break` confirms it. A guess the host has not confirmed in
 *    `GUESS_MS` asks for the host's whole state (`ask`), which puts it right.
 *  - The host applies a guest's hit to its own copy, as that guest's doing (kill credit, credit.ts), and tells every guest what
 *    broke (`break`), which barrels came back (`restore`), which chairs flew (`knock`) and where they came to rest (`rest`).
 *  - On a guest a barrel or an exploding prop is drawn and felt, never counted: the host's copy hurt the enemies. Each player's
 *    own game works out what the blast does to that player (damage, push, shake) from where they really stand (`feel`).
 *  - A guest whose world comes up late gets the lot (`state`): what is broken, and where the moved chairs lie.
 *  - The map's timed machinery (crushers, live plates, gantries) runs on the host's clock on every screen, and the reactor is in
 *    the state the host's waves put it in (`clock`, every `CLOCK_MS` and at once when the reactor changes).
 */
import * as THREE from 'three';
import type { PropLink, PropState } from '../../world/breakables';
import type { Objects } from '../../world/objects';
import type { WorldContext, WorldModule } from './context';
import type { Credit } from './credit';
import type { Targeting } from './targeting';
import { validVec, type Vec } from './wire';

/**
 * Guest to host: `hit` (set 'x' explosive or 'b' prop, by `id`), `blast`, `ask` (send me your state).
 * Host to guests: `break`, `restore` (explosive `id` is back), `knock` (chair `id` thrown at `v`), `rest` (chair `id` lies at
 * `p`, turned `q`), `state` (`x`: explosives gone, `b`: props broken, `chairs`: moved chairs), `clock` (`now`: the host's world
 * clock in seconds, `reactor`: its state).
 */
export type PropEvent = {
  t: 'prop'; op: 'hit' | 'blast' | 'ask' | 'break' | 'restore' | 'knock' | 'rest' | 'state' | 'clock';
  now?: number; reactor?: string;
  set?: 'x' | 'b'; id?: number; amount?: number; source?: string; at?: Vec; r?: number; v?: Vec; p?: Vec; q?: number[];
  x?: number[]; b?: number[]; chairs?: [number, number[], number[]][];
};

/** A guess (this game's own hit broke it here) waits this long for the host's word before asking for the host's state. */
const GUESS_MS = 2500;
const ASK_EVERY_MS = 3000;
/** Host: what one guest may send a second: hits (a flamethrower, a pellet gun on a row of monitors) and blasts. */
const HITS_PER_SECOND = 300;
const BLASTS_PER_SECOND = 40;
/** Host: the most one hit or blast counts for, and how far from the sender's body its target may be. */
const MOST = 5000;
const REACH = 450;
/** Host: chair throws told to guests a second, at most (a blast in an office moves dozens). */
const KNOCKS_PER_SECOND = 90;
/** Host: how often guests are told its world clock, and how far a guest's may be off before it jumps instead of easing. */
const CLOCK_MS = 2000;
const CLOCK_SNAP = 0.75;
const REACTOR = ['stable', 'unstable', 'critical'];
/** Entries in a `state` list, at most. */
const LIST = 4096;

interface Felt { at: THREE.Vector3; radius: number; damage: number; kind: 'barrel' | 'tank'; source: string }

const ints = (list: unknown): number[] | null =>
  (Array.isArray(list) && list.length <= LIST && list.every(n => Number.isInteger(n) && n >= 0 && n < 1e6) ? list as number[] : null);
const nums = (list: unknown, n: number): list is number[] => Array.isArray(list) && list.length === n && list.every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e5);

export class Props implements WorldModule, PropLink {
  /** For the proofs and the tests. */
  readonly stats = { hits: 0, blasts: 0, breaks: 0, got: 0, guesses: 0, asks: 0, refused: 0, states: 0 };
  /** Guest: true while a world blast is being felt, so the player takes its damage (`CoopWorld.allowsLocalDamage`). */
  feeling = false;
  private objects: Objects | null = null;
  /** Guest: this frame's hits, added up per target and gun. */
  private readonly outbox = new Map<string, { set: 'x' | 'b'; id: number; amount: number; source: string }>();
  /** Guest: what this game broke ahead of the host's word, and when. */
  private readonly guesses = new Map<string, number>();
  private readonly felt: Felt[] = [];
  private lastAsk = -Infinity;
  /** Host: each guest's allowance this second. */
  private readonly spent = new Map<string, { second: number; hits: number; blasts: number; asks: number }>();
  private knocks = 0;
  private knockSecond = 0;
  private nextClock = 0;
  private readonly spot = new THREE.Vector3();

  constructor(private readonly w: WorldContext, private readonly credit: Credit, private readonly targeting: Targeting) {
    w.router.both('prop', (value, from, now) => (w.hosting ? this.hostIn(value, from, now) : this.guestIn(value)));
  }

  get guest(): boolean { return !this.w.hosting; }

  /** The map is up: the barrels and the props are on the wire from here. */
  begin(): void {
    const objects = this.w.ctx.world?.objects as Objects | undefined;
    if (!objects || !('net' in objects)) return;
    this.objects = objects;
    objects.net = this;
  }

  forgetPeer(id: string): void { this.spent.delete(id); }

  dispose(): void {
    if (this.objects) {
      this.objects.net = null;
      this.objects.clockSkew = 0;
    }
    this.objects = null;
  }

  // ---- PropLink: what the objects tell the wire ----------------------------------------------------------------

  hit(set: 'x' | 'b', id: number, amount: number, source: string): void {
    const key = `${set}${id}|${source}`;
    const held = this.outbox.get(key);
    if (held) held.amount += amount;
    else this.outbox.set(key, { set, id, amount, source });
  }

  blast(center: THREE.Vector3, radius: number, amount: number, source: string): void {
    if (!this.w.ready) return;
    this.stats.blasts++;
    this.w.send({ t: 'prop', op: 'blast', at: center.toArray() as Vec, r: radius, amount, source });
  }

  guessed(set: 'x' | 'b', id: number): void {
    this.stats.guesses++;
    this.guesses.set(set + id, performance.now());
  }

  feel(center: THREE.Vector3, radius: number, damage: number, kind: 'barrel' | 'tank', source: string): void {
    // Next frame, from the world's own update: this can be called from inside the guest's own blast, and a blast inside a blast waits.
    if (this.felt.length < 64) this.felt.push({ at: center.clone(), radius, damage, kind, source });
  }

  broke(set: 'x' | 'b', id: number, source: string): void {
    this.stats.breaks++;
    this.tell({ t: 'prop', op: 'break', set, id, source: source.slice(0, 32) });
  }

  restored(id: number): void {
    this.tell({ t: 'prop', op: 'restore', id });
  }

  knocked(id: number, velocity: THREE.Vector3): void {
    const second = Math.floor(performance.now() / 1000);
    if (second !== this.knockSecond) { this.knockSecond = second; this.knocks = 0; }
    // Over the cap a chair's throw is not told; where it comes to rest still is.
    if (++this.knocks <= KNOCKS_PER_SECOND) this.tell({ t: 'prop', op: 'knock', id, v: velocity.toArray().map(n => Math.round(n * 100) / 100) as Vec });
  }

  rested(id: number, p: THREE.Vector3, q: THREE.Quaternion): void {
    this.tell({ t: 'prop', op: 'rest', id, p: p.toArray().map(n => Math.round(n * 1000) / 1000) as Vec, q: q.toArray().map(n => Math.round(n * 10000) / 10000) });
  }

  owner(): string | null { return this.credit.crediting; }

  as<T>(owner: string | null, run: () => T): T {
    const before = this.credit.as(owner);
    try { return run(); } finally { this.credit.as(before); }
  }

  anyoneNear(at: THREE.Vector3, radius: number): boolean {
    for (const target of this.targeting.players()) if (target.player.position.distanceTo(at) < radius) return true;
    return false;
  }

  reactor(): void {
    // The state is set after this returns: the clock goes out on the next frame, with it.
    this.nextClock = 0;
  }

  private tell(event: PropEvent, to?: string): void {
    if (this.w.ready) this.w.send(event, to);
  }

  private clock(to?: string): void {
    const o = this.objects;
    if (o) this.tell({ t: 'prop', op: 'clock', now: Math.round(this.w.ctx.time.elapsed * 1000) / 1000, reactor: o.reactorNow }, to);
  }

  // ---- frame ---------------------------------------------------------------------------------------------------

  update(now: number): void {
    if (this.w.hosting) {
      if (now >= this.nextClock) {
        this.nextClock = now + CLOCK_MS;
        this.clock();
      }
      return;
    }
    for (const h of this.outbox.values()) {
      this.stats.hits++;
      this.w.send({ t: 'prop', op: 'hit', set: h.set, id: h.id, amount: Math.min(MOST, h.amount), source: h.source.slice(0, 32) });
    }
    this.outbox.clear();
    // What the host's barrels and props did to this player, worked out here from where the player really is.
    if (this.felt.length) {
      const combat = this.w.ctx.combat;
      for (const f of this.felt.splice(0)) {
        this.feeling = true;
        // The same blast combat makes of a map explosive in a solo game ('barrel', whatever went off), for this player alone.
        try { combat.explode(f.at, { radius: f.radius, damage: f.damage, kind: 'barrel', source: f.source, team: 'player', worldObject: true, playerOnly: true }); }
        finally { this.feeling = false; }
      }
    }
    // A guess the host never confirmed: ask for the host's state, which stands the thing up again or knocks down what is missing.
    let stale = false;
    for (const at of this.guesses.values()) if (now - at > GUESS_MS) stale = true;
    if (stale && now - this.lastAsk > ASK_EVERY_MS) {
      // The answer is the host's whole state, which settles every guess at once.
      this.guesses.clear();
      this.lastAsk = now;
      this.stats.asks++;
      this.w.send({ t: 'prop', op: 'ask' });
    }
  }

  // ---- host ----------------------------------------------------------------------------------------------------

  /** Host: a guest whose world has just come up is told the world as broken as it is. */
  catchUp(id: string): void {
    const o = this.objects;
    if (!o) return;
    const props: PropState = o.props.state();
    this.stats.states++;
    this.tell({ t: 'prop', op: 'state', x: o.deadExplosives(), b: props.dead, chairs: props.chairs }, id);
    this.clock(id);
  }

  private allowance(from: string, now: number) {
    const second = Math.floor(now / 1000);
    let a = this.spent.get(from);
    if (!a || a.second !== second) this.spent.set(from, a = { second, hits: 0, blasts: 0, asks: 0 });
    return a;
  }

  private hostIn(value: PropEvent, from: string, now: number): void {
    const o = this.objects;
    const sender = this.w.sender(from, now);
    if (!o || !sender) return;
    const allowance = this.allowance(from, now);
    if (value.op === 'ask') {
      if (++allowance.asks <= 1) this.catchUp(from);
      return;
    }
    const amount = typeof value.amount === 'number' && Number.isFinite(value.amount) && value.amount > 0 ? Math.min(MOST, value.amount) : 0;
    const source = typeof value.source === 'string' ? value.source.slice(0, 32) : '';
    const body = sender.char.root.position;
    if (!amount || !source || this.w.life(from).down) return void this.stats.refused++;
    if (value.op === 'hit') {
      const id = value.id;
      const at = !Number.isInteger(id) ? undefined : value.set === 'x' ? o.explosives[id!]?.pos : value.set === 'b' ? o.props.props[id!]?.p : undefined;
      if (!at || at.distanceTo(body) > REACH || ++allowance.hits > HITS_PER_SECOND) return void this.stats.refused++;
      this.stats.got++;
      this.as(from, () => o.hostHit(value.set!, id!, amount, source, body));
    } else if (value.op === 'blast') {
      if (!validVec(value.at) || typeof value.r !== 'number' || !(value.r > 0 && value.r <= 60) || ++allowance.blasts > BLASTS_PER_SECOND) return void this.stats.refused++;
      const at = this.spot.set(...value.at);
      if (at.distanceTo(body) > REACH) return void this.stats.refused++;
      this.stats.got++;
      this.as(from, () => o.hostBlast(at, value.r!, amount, source));
    }
  }

  // ---- guest ---------------------------------------------------------------------------------------------------

  private guestIn(value: PropEvent): void {
    const o = this.objects;
    if (!o) return;
    const id = Number.isInteger(value.id) && value.id! >= 0 ? value.id! : -1;
    switch (value.op) {
      case 'break': {
        if (id < 0 || (value.set !== 'x' && value.set !== 'b')) return;
        this.stats.got++;
        this.guesses.delete(value.set + id);
        const source = typeof value.source === 'string' ? value.source.slice(0, 32) : '';
        if (value.set === 'x') o.detonateById(id, source);
        else o.props.breakById(id, source);
        return;
      }
      case 'restore': if (id >= 0) o.restoreById(id); return;
      case 'knock': if (id >= 0 && validVec(value.v) && value.v.every(n => Math.abs(n) <= 40)) o.props.knockById(id, this.spot.set(...value.v)); return;
      case 'rest': if (id >= 0 && validVec(value.p) && nums(value.q, 4)) o.props.restById(id, this.spot.set(...value.p), new THREE.Quaternion().fromArray(value.q).normalize()); return;
      case 'clock': {
        if (typeof value.now !== 'number' || !Number.isFinite(value.now) || value.now < 0) return;
        // Ease onto the host's clock (the message's own delay jitters by a few ms); a real gap (a late join, a stall) jumps.
        const want = value.now - this.w.ctx.time.elapsed;
        o.clockSkew = Math.abs(want - o.clockSkew) > CLOCK_SNAP ? want : o.clockSkew + (want - o.clockSkew) * 0.2;
        if (typeof value.reactor === 'string' && REACTOR.includes(value.reactor)) o.setReactorState(value.reactor as Parameters<Objects['setReactorState']>[0]);
        return;
      }
      case 'state': {
        const x = ints(value.x), b = ints(value.b);
        if (!x || !b || !Array.isArray(value.chairs) || value.chairs.length > LIST) return;
        const chairs = value.chairs.filter(c => Array.isArray(c) && Number.isInteger(c[0]) && c[0] >= 0 && nums(c[1], 3) && nums(c[2], 4));
        this.stats.states++;
        this.guesses.clear();
        o.adoptExplosives(x);
        o.props.adopt({ dead: b, chairs });
        return;
      }
    }
  }
}
