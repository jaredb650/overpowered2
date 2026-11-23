/**
 * Outpost Defense is one fort for the whole team. The walls, gates and shacks (world/structures.ts) and the fort's own facts
 * (contracts/defense: the garrison's size, the guns' levels, the mortar teams, the shops' health, the next wave's line, who
 * carries a charge, the attackers' jump pads and sandbags) are the host's. The host sends every change as it happens and the
 * whole of it to a player who arrives; a guest draws it, and asks the host for what changes it: a blast or a round of its own on
 * the walls, a wall boarded up by hand, and a purchase that is the fort's (a hire, a work crew, a mortar team, a gun's upgrade,
 * a shop rebuilt), which the guest pays for from its own credits.
 */
import * as THREE from 'three';
import type { Structure } from '../../core/contracts';
import type { Act } from '../../contracts/defense/economy';
import { fortAct, type Defense, type FortState } from '../../contracts/defense';
import { SHOP_ORDER, type ShopId } from '../../contracts/defense/data';
import { SOURCE_MULT, type Structures } from '../../world/structures';
import type { WorldContext, WorldModule } from './context';
import type { Targeting } from './targeting';
import { validVec, type Vec } from './wire';

/** One piece on the wire: [index, stage, health, gate up, repair 0..1 or -1, the repair's seconds]. */
type PieceRow = [number, number, number, number, number, number];

export type FortEvent =
  /**
   * Host: pieces that changed. `full`: every piece, for a player who has just arrived (nothing is loud). `loud`: the indexes whose
   * stage changed with dust, sound and debris, thrown from `at` with `power` if a blast did it.
   */
  | { t: 'fort'; pieces: PieceRow[]; full?: boolean; loud?: number[]; at?: Vec; power?: number }
  /** Host: the fort's facts the shops and the HUD read (contracts/defense `FortState`). */
  | { t: 'fortstate'; state: FortState }
  /** Guest to host: a blast of mine reached the walls. The host wears them, and the sandbags, shutters and charges with them. */
  | { t: 'wallblast'; at: Vec; radius: number; amount: number; source: string }
  /** Guest to host: rounds of mine on a shack, summed since the last send. */
  | { t: 'wallhit'; i: number; amount: number }
  /** Guest to host: I boarded up piece `i`, which stood at stage `from`. The host answers the asker with `repaired`. */
  | { t: 'repair'; i: number; from: number }
  /** Host to one guest: your boarding up of `i` went up and pays `pay`; or the gap is not clear (`blocked`); or it was not yours to do. */
  | { t: 'repaired'; i: number; pay: number; blocked?: boolean }
  /** Guest to host: a purchase that is the fort's, numbered `n`. Paid for by the asker, who is refunded on a refusal. */
  | { t: 'fortbuy'; n: number; shop: ShopId; act: Act }
  /** Host to one guest: purchase `n` is done (`why` null) or was refused. */
  | { t: 'fortsold'; n: number; why: string | null }
  /** Host: a mortar round left a tube. `mine`: one of the team's own; else the attackers'. Drawn on guests, where it hurts nothing. */
  | { t: 'shell'; from: Vec; to: Vec; radius: number; flight: number; delay: number; ring: number | null; mine: boolean }
  /** Host: a line for everyone's feed or banner about the fort. */
  | { t: 'fortsay'; kind: 'banner' | 'feed' | 'float'; text: string; sub?: string; color: string; at?: Vec }
  /**
   * Guest to host: I am on mounted gun `gun` (or off it: `on` false), and where it points. Sent while seated, about 7 a second.
   * Host to that guest, with `on` false: the gun is someone else's, step off.
   */
  | { t: 'gunseat'; gun: number; on: boolean; yaw?: number; pitch?: number; firing?: boolean }
  /** Host: one of the garrison's callouts on the squad feed (contracts/defense/radio.ts). The box's own lines travel as barks (villain.ts). */
  | { t: 'fortradio'; text: string; speaker: string; at: Vec };

/** Health-only changes go out this often; a stage that changes goes out in the frame it happens. */
const HEALTH_MS = 150;
const STATE_MS = 250;
/** A guest's blasts on the walls a second, and its boarding up: a stage by hand takes 1.5 s at the least. */
const BLASTS_PER_SECOND = 24;
const REPAIR_MS = 900;
const REPAIR_REACH = 6;

declare module '../../core/contracts' {
  interface GameEvents {
    /** Co-op host: a guest's blast, for what stands only on the host and a blast knocks down (sandbags, pads, shutters, devices). */
    'coop:blast': { center: THREE.Vector3; radius: number };
  }
}

const _at = new THREE.Vector3();

export class Fort implements WorldModule {
  private walls: Structures | null = null;
  private defense: Defense | null = null;
  private linked = false;
  /** Host: pieces waiting to go out, and which of them changed stage loudly. */
  private readonly dirty = new Set<number>();
  private readonly loud = new Set<number>();
  private urgent = false;
  private blastAt: Vec | undefined;
  private blastPower = 0;
  private healthAt = 0;
  private stateAt = 0;
  private stateSent = '';
  /** Host: per guest, blasts/buys this second and the last repair. */
  private readonly spent = new Map<string, { second: number; blasts: number; buys: number; repairAt: number }>();
  /** Guest: shack hits not sent yet, by piece. */
  private readonly hits = new Map<number, number>();
  private hitsAt = 0;
  private readonly feet: THREE.Vector3[] = [];

  constructor(private readonly w: WorldContext, private readonly targeting: Targeting) {
    const { router } = w;
    router.guest('fort', value => this.piecesIn(value));
    router.guest('fortstate', value => { if (value.state && typeof value.state === 'object') this.find().defense?.applyState(value.state); });
    router.host('wallblast', (value, from) => this.blastIn(value, from));
    router.host('wallhit', (value, from) => {
      const piece = this.find().walls?.all[value.i];
      if (!piece || (piece.kind !== 'shack' && piece.kind !== 'stall') || !Number.isFinite(value.amount) || value.amount <= 0 || !this.spend(from)) return;
      this.walls!.hit(piece.colliders[0] ?? null, Math.min(2000, value.amount));
    });
    router.host('repair', (value, from, now) => this.repairIn(value, from, now));
    router.guest('repaired', value => {
      if (Number.isInteger(value.i)) this.find().defense?.repair.answered(value.i, Number.isFinite(value.pay) ? Math.max(0, Math.min(1000, value.pay)) : 0, value.blocked === true);
    });
    router.host('fortbuy', (value, from) => this.buyIn(value, from));
    router.guest('fortsold', value => {
      if (Number.isInteger(value.n)) this.find().defense?.sold(value.n, typeof value.why === 'string' ? value.why.slice(0, 60) : null);
    });
    router.guest('shell', value => {
      if (!validVec(value.from) || !validVec(value.to) || ![value.radius, value.flight, value.delay].every(Number.isFinite)) return;
      this.find().defense?.shellIn(new THREE.Vector3(...value.from), new THREE.Vector3(...value.to), Math.min(30, Math.max(0.5, value.radius)),
        Math.min(20, Math.max(0.2, value.flight)), Math.min(20, Math.max(0, value.delay)), Number.isFinite(value.ring) ? value.ring : null, value.mine === true);
    });
    router.guest('fortsay', value => this.sayIn(value));
    router.both('gunseat', (value, from) => {
      const defense = this.find().defense;
      if (!defense || !Number.isInteger(value.gun)) return;
      if (!this.w.hosting) { if (value.on === false) defense.unseat(value.gun); return; }
      const slot = this.w.session.lobby.players.find(p => p.id === from)?.slot;
      const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(-7, Math.min(7, n)) : 0);
      if (slot === undefined) return;
      if (this.w.life(from).down && value.on) {
        defense.leftSeats(slot);
        this.w.send({ t: 'gunseat', gun: value.gun, on: false }, from);
        return;
      }
      if (!defense.seatFor(slot, value.gun, value.on === true, num(value.yaw), num(value.pitch), value.firing === true)) this.w.send({ t: 'gunseat', gun: value.gun, on: false }, from);
    });
    router.guest('fortradio', value => this.radioIn(value));
  }

  /** Host: a lost player's mounted gun is free at once (it would otherwise wait out the seat's own keep time). */
  lostSeat(_id: string, slot: number): void { this.find().defense?.leftSeats(slot); }

  forgetPeer(id: string): void { this.spent.delete(id); }

  /** The walls and the contract are built after the world is: found on first use, and linked once. */
  private find(): this {
    const { ctx } = this.w;
    this.walls ??= (ctx.world?.objects as unknown as { walls?: Structures } | undefined)?.walls ?? null;
    this.defense ??= ctx.contracts?.defense ?? null;
    if (this.linked || !this.walls) return this;
    this.linked = true;
    const guest = !this.w.hosting;
    const { session } = this.w;
    this.walls.link = {
      guest,
      changed: (piece, loud, blast, power) => {
        if (guest) return;
        this.dirty.add(piece.id);
        if (!loud) return;
        this.loud.add(piece.id);
        this.urgent = true;
        if (blast) { this.blastAt = blast.toArray() as Vec; this.blastPower = power; }
      },
      blast: (center, radius, amount, source) => {
        if (this.w.ready) this.w.send({ t: 'wallblast', at: center.toArray() as Vec, radius, amount, source: source.slice(0, 32) });
      },
      hit: (piece, amount) => { this.hits.set(piece.id, (this.hits.get(piece.id) ?? 0) + amount); },
      others: out => this.others(out),
    };
    if (this.defense) this.defense.link = {
      guest,
      buy: (n, shop, act) => this.w.send({ t: 'fortbuy', n, shop, act }),
      repair: (i, from) => this.w.send({ t: 'repair', i, from }),
      shell: (from, to, radius, flight, delay, ring, mine) => {
        if (this.w.ready) this.w.send({ t: 'shell', from: from.toArray() as Vec, to: to.toArray() as Vec, radius, flight, delay, ring, mine });
      },
      say: (kind, text, sub, color, at) => {
        if (this.w.ready) this.w.send({ t: 'fortsay', kind, text, sub, color, at: at?.toArray() as Vec | undefined });
      },
      feet: out => this.everyone(out),
      squad: (text, speaker, at) => { if (!guest && this.w.ready) this.w.send({ t: 'fortradio', text, speaker, at: at.toArray() as Vec }); },
      get slot() { return session.lobby.me?.slot ?? 0; },
      seat: (gun, on, yaw, pitch, firing) => { if (guest && this.w.ready) this.w.send({ t: 'gunseat', gun, on, yaw, pitch, firing }); },
    };
    return this;
  }

  /** Host: the feet of every other living player. */
  private others(out: THREE.Vector3[]): THREE.Vector3[] {
    out.length = 0;
    const you = this.w.session.lobby.you;
    for (const target of this.targeting.players()) if (target.id !== you && target.player.alive) out.push(target.player.position);
    return out;
  }

  /** Host: the feet of every living player, this browser's first. */
  private everyone(out: THREE.Vector3[]): THREE.Vector3[] {
    this.others(out);
    if (this.w.ctx.player.alive) out.unshift(this.w.ctx.player.position);
    return out;
  }

  private row(piece: Structure): PieceRow {
    const q = piece as Structure & { index: number; open: boolean; repairSeconds: number };
    return [q.id, q.index, q.health, q.open ? 1 : 0, q.repairing < 0 ? -1 : Math.round(q.repairing * 1000) / 1000, q.repairSeconds];
  }

  /** Host: everything a player who has just arrived needs: every piece that is not whole and shut, and the fort's facts. */
  catchUp(id: string): void {
    this.find();
    if (!this.w.hosting) return;
    if (this.walls) {
      const pieces = this.walls.all.filter(p => p.stage !== 'intact' || p.health < p.maxHealth || p.repairing >= 0 || this.walls!.isOpen(p)).map(p => this.row(p));
      this.w.send({ t: 'fort', pieces, full: true }, id);
    }
    if (this.defense) this.w.send({ t: 'fortstate', state: this.defense.state() }, id);
  }

  update(now: number): void {
    this.find();
    if (this.w.hosting) this.hostUpdate(now);
    else if (this.hits.size && now >= this.hitsAt) {
      this.hitsAt = now + HEALTH_MS;
      for (const [i, amount] of this.hits) this.w.send({ t: 'wallhit', i, amount });
      this.hits.clear();
    }
  }

  private hostUpdate(now: number): void {
    const walls = this.walls;
    if (walls && this.dirty.size && (this.urgent || now >= this.healthAt)) {
      this.healthAt = now + HEALTH_MS;
      const pieces: PieceRow[] = [];
      for (const i of this.dirty) { const piece = walls.all[i]; if (piece) pieces.push(this.row(piece)); }
      this.w.send({ t: 'fort', pieces, ...(this.loud.size ? { loud: [...this.loud], at: this.blastAt, power: this.blastPower } : {}) });
      this.dirty.clear(); this.loud.clear();
      this.urgent = false; this.blastAt = undefined; this.blastPower = 0;
    }
    if (this.defense && now >= this.stateAt) {
      this.stateAt = now + STATE_MS;
      const state = this.defense.state();
      const text = JSON.stringify(state);
      if (text !== this.stateSent) { this.stateSent = text; this.w.send({ t: 'fortstate', state }); }
    }
  }

  /** Guest: the host's pieces. */
  private piecesIn(value: Extract<FortEvent, { t: 'fort' }>): void {
    const walls = this.find().walls;
    if (!walls || !Array.isArray(value.pieces)) return;
    const loud = new Set(Array.isArray(value.loud) ? value.loud : []);
    const at = validVec(value.at) ? _at.fromArray(value.at) : null;
    const power = Number.isFinite(value.power) ? Math.max(0, Math.min(1e5, value.power!)) : 0;
    const told = new Set<number>();
    for (const row of value.pieces.slice(0, 1024)) {
      if (!Array.isArray(row) || row.length !== 6 || !row.every(Number.isFinite)) continue;
      const [i, stage, health, open, repairing, seconds] = row;
      if (!Number.isInteger(i) || !walls.all[i]) continue;
      told.add(i);
      walls.apply(i, stage, health, open === 1, repairing, seconds, loud.has(i), at, power);
    }
    // A full list names every piece that is not whole: the rest stand as built.
    if (value.full === true) for (const piece of walls.all) if (!told.has(piece.id)) walls.apply(piece.id, 0, piece.maxHealth, false, -1, 1, false, null, 0);
  }

  private bucket(from: string): { second: number; blasts: number; buys: number; repairAt: number } {
    let s = this.spent.get(from);
    if (!s) this.spent.set(from, s = { second: 0, blasts: 0, buys: 0, repairAt: -Infinity });
    const second = Math.floor(performance.now() / 1000);
    if (second !== s.second) { s.second = second; s.blasts = 0; s.buys = 0; }
    return s;
  }

  private spend(from: string): { second: number; blasts: number; buys: number; repairAt: number } | null {
    const s = this.bucket(from);
    return ++s.blasts <= BLASTS_PER_SECOND ? s : null;
  }

  /** Host: a guest's blast on the fort. Bounded, and never the tank shell's multiplier. */
  private blastIn(value: Extract<FortEvent, { t: 'wallblast' }>, from: string): void {
    const walls = this.find().walls;
    if (!walls || !validVec(value.at) || !Number.isFinite(value.radius) || value.radius <= 0 || value.radius > 60 || !Number.isFinite(value.amount) || value.amount <= 0) return;
    if (!this.w.life(from) || this.w.life(from).down || !this.spend(from)) return;
    const source = typeof value.source === 'string' && !Object.hasOwn(SOURCE_MULT, value.source) ? value.source.slice(0, 32) : 'coop';
    const at = new THREE.Vector3(...value.at);
    const amount = Math.min(3000, value.amount);
    walls.blast(at, value.radius, amount, source);
    // What else of the fort a blast reaches on the host: the attackers' sandbags and pads, the villain's shutters and devices.
    if (amount >= 20) this.w.ctx.events.emit('coop:blast', { center: at, radius: value.radius });
  }

  /** Host: a guest finished boarding up a piece. Theirs if they stand at it, it still stands where they saw it, and nobody is in the gap. */
  private repairIn(value: Extract<FortEvent, { t: 'repair' }>, from: string, now: number): void {
    const { walls, defense } = this.find();
    const piece = walls?.all[value.i];
    const remote = this.w.sender(from, now);
    if (!walls || !defense || !piece || !remote) return;
    const s = this.bucket(from);
    const refuse = (blocked = false) => this.w.send({ t: 'repaired', i: value.i, pay: 0, blocked }, from);
    if (this.w.life(from).down || now - s.repairAt < REPAIR_MS || walls.distance(piece, remote.char.root.position) > REPAIR_REACH) return refuse();
    const result = defense.repair.finishFor(piece, value.from);
    if (result === 'blocked') return refuse(true);
    if (result === null) return refuse();
    s.repairAt = now;
    this.w.send({ t: 'repaired', i: value.i, pay: result }, from);
  }

  /** Host: a guest bought something that is the fort's. They have paid; a refusal sends the price back. */
  private buyIn(value: Extract<FortEvent, { t: 'fortbuy' }>, from: string): void {
    const defense = this.find().defense;
    if (!defense || !Number.isInteger(value.n)) return;
    const s = this.bucket(from);
    if (++s.buys > BLASTS_PER_SECOND) {
      this.w.send({ t: 'fortsold', n: value.n, why: 'Too fast' }, from);
      return;
    }
    const shop = (SHOP_ORDER as readonly string[]).includes(value.shop) ? value.shop : null;
    const act = value.act;
    let why: string | null = 'Not sold here';
    if (shop && act && typeof act === 'object' && typeof act.kind === 'string' && fortAct(act)) {
      const name = this.w.session.lobby.players.find(p => p.id === from)?.name ?? 'A teammate';
      why = defense.buyFor(shop, act, name);
    }
    this.w.send({ t: 'fortsold', n: value.n, why }, from);
  }

  /** Guest: one of the host's garrison speaks, on the same squad feed. */
  private radioIn(value: Extract<FortEvent, { t: 'fortradio' }>): void {
    if (typeof value.text !== 'string' || !validVec(value.at)) return;
    const speaker = String(value.speaker ?? '').slice(0, 32);
    this.w.ctx.events.emit('comms:line', { kind: 'ally', text: value.text.slice(0, 120), squad: 'Garrison', speaker, enemy: null, position: new THREE.Vector3(...value.at) });
  }

  private sayIn(value: Extract<FortEvent, { t: 'fortsay' }>): void {
    const { hud } = this.w.ctx;
    const text = String(value.text ?? '').slice(0, 80), color = /^#[0-9a-f]{6}$/i.test(String(value.color)) ? value.color : '#ffc14a';
    if (!text) return;
    if (value.kind === 'banner') hud.banner(text, String(value.sub ?? '').slice(0, 80), color);
    else if (value.kind === 'float' && validVec(value.at)) hud.floatText(new THREE.Vector3(...value.at), text, color);
    else hud.feed(text, color);
  }
}

/** For a peer that is behind: which of this module's events may be left out (net/pressure.ts). A fact never is. */
export const FORT_WIRE: import('../pressure').WireClasses<FortEvent> = { fort: 'fact', fortstate: 'fact', wallblast: 'fact', wallhit: 'fact', repair: 'fact', repaired: 'fact', fortbuy: 'fact', fortsold: 'fact', shell: 'fact', fortsay: 'fact', fortradio: 'fact', gunseat: 'fact' };
