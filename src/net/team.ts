/**
 * Co-op's team rules: going down, bleeding out, reviving, spectating, how a run ends, the team's break between waves, and what
 * each player reports about themselves (health, kills, credits) for the teammates strip and the Tab board.
 *
 * The host decides every life. A player at 0 health goes DOWN: they crawl (Player.downed) and can be revived by any
 * teammate holding E beside them for ALLY.revive seconds (the allies' hold, src/allies/rules.ts OrderKey; no stim spent).
 * After BLEED_MS down they are DEAD and watch a living teammate. **Everyone dead or down comes back when the wave is
 * cleared**, so the whole team shops in the break; a second pass runs as the next wave starts.
 *
 * Endings: a run only ever ends through `finish` (host) and the `over` event, which puts the team board on every screen:
 * a wipe, the Commander dead in Endless Humans, a mission won. No screen falls back to the solo game-over or "complete" page,
 * and the host's world keeps running under the board.
 *
 * The break (teamBreak.ts): 45 s after a cleared wave, 60 s before a boss wave, ended early when every player has pressed the
 * next-wave key. Single player keeps its own break.
 *
 * Seats: what the host keeps for a player who drops and comes back, under the player's stable id (the browser's, lobby.ts):
 * the purse (credits, score, kills), the kit (kit.ts) and whether they were alive. A rejoin gives the kit back and is never a
 * free revive: someone who left dead or down comes back dead and waits for the team's next respawn.
 *
 * Economy: each player's own purse is their own Crucible shop (contracts/shop). Kill pay goes to whoever killed
 * (world/credit.ts attributes kills; a guest replays its own kills as local `enemy:killed`). The wave-clear bonus is shared:
 * every player, alive or not, is paid the full wave pay by their own shop when the host's `wave:clear` reaches them.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import type { WavePhase } from '../core/gameplay';
import { cheatsOn } from '../core/cheats';
import { OrderKey } from '../allies/rules';
import { MISSION_ID } from '../campaign/select';
import { crucibleRules } from '../contracts/crucible';
import { DEFAULT_RULES } from '../enemies/rules';
import { isTitanWave } from '../enemies/waves';
import { COLORS } from './remote';
import type { CoopSession } from './index';
import { applyKit, cleanKit, readKit, type Kit } from './kit';
import type { WorldEvent } from './worldProtocol';
import type { Router } from './world/router';
import { validVec, type Vec } from './world/wire';
import { spread } from './mission';
import { Marks } from './marks';
import { TeamBreak } from './teamBreak';

export type LifeState = 'up' | 'down' | 'dead';
/** How a run ended: everyone down, the contract fulfilled (the Commander dead) or a mission won. (A lost host is the session's own board.) */
export type Ending = 'wipe' | 'fulfilled' | 'mission';
const ENDINGS: readonly Ending[] = ['wipe', 'fulfilled', 'mission'];
/** What one player shows the others: the teammates strip and the Tab board. Clamped on arrival (`cleanCard`). */
export interface Card {
  slot: number; state: LifeState; bleed: number; life: number; hp: number; max: number; armor: number;
  kills: number; score: number; credits: number; downs: number; revives: number; ping: number;
  /** This player has the cheat panel unlocked: said on the strip and the boards, never hidden. */
  cheats: boolean;
  /** In a menu, a shop or the loadout: standing still on purpose. */
  menu: boolean;
  /** A guest's own word that its seat is settled (the host's `restore` has been applied): only then is its purse kept. */
  ok: boolean;
}
/** The team's events on the wire. */
export type TeamEvent =
  /** Guest to host: I am at 0 health, on life `life`. */
  | { t: 'life'; slot: number; alive: boolean; life: number }
  /** Guest to host: my card, 4 Hz. Host to guests: everyone's, 4 Hz, with the host's word on life, bleed and ping. */
  | { t: 'card'; card: Card }
  | { t: 'team'; list: Card[] }
  /** Guest to host: I held E over this downed player. */
  | { t: 'revive'; slot: number }
  /** Host: this player is up again, revived (`by` the reviver's slot) or respawned at a wave's end or start. */
  | { t: 'up'; slot: number; life: number; how: 'revive' | 'respawn'; by: number; at?: Vec; yaw?: number }
  /**
   * Host: the waves' own events, replayed on guests so their shops, pods, banners and ammo follow the host's waves.
   * `titan`: the boss of a boss wave, by the host's rules (a guest's own saved rules may differ). `phase`, `next`: the waves'
   * phase and clock as the event went out, which a guest sets before it replays the event (`followPhase`).
   */
  | { t: 'wave'; kind: 'start' | 'clear'; wave: number; total: number; boss: boolean; bonus: number; titan?: boolean; phase?: string; next?: number }
  /** Host: the run is over for everyone; the cards are the final board. `how` says which ending (absent: a wipe). */
  | { t: 'over'; wave: number; cards: Card[]; won?: boolean; how?: Ending }
  /**
   * Host to a guest whose world just came up, always, once: the seat is settled. For a returning player it carries the
   * purse and score they left with, the kit, and `dead` if they left dead or down.
   */
  | { t: 'restore'; credits: number; score: number; kills: number; kit?: Kit; dead?: boolean; hp?: number; armor?: number }
  /** Guest to host: my kit as it stands, sent when it changes (at most every KIT_MS). */
  | { t: 'kit'; kit: Kit }
  /** Guest to host: the next-wave key, pressed in a break. */
  | { t: 'ready' }
  /** Host: who has voted to start the next wave (slots), how many votes it takes, and whose vote this was (-1: a reset). */
  | { t: 'vote'; ready: number[]; need: number; by: number }
  /** Host to a guest who arrived mid-run: where the waves stand, so it gets the banner and, in a break, the clock and the vote. */
  | { t: 'sync'; wave: number; phase: WavePhase; left: number; rest: boolean; custom: boolean; ready: number[]; need: number }
  /** A ping: a marker in the world, for everyone. A guest's goes to the host, who stamps the slot and passes it on. */
  | { t: 'mark'; at: Vec; slot?: number };
/** The events `receive` takes on each side, for the world's router. */
const HOST_EVENTS = ['life', 'card', 'revive', 'kit', 'ready'] as const;
const GUEST_EVENTS = ['team', 'up', 'wave', 'over', 'restore', 'vote', 'sync'] as const;

/** Down to dead. The allies bleed for longer; a friend should be reached in a wave, not after it. */
export const BLEED_MS = 30_000;
/** Health a revived player gets back. */
export const REVIVE_HEALTH = 40;
/** Metres from a downed friend at which E revives. A little more for the host's check, for the pose's lag. */
export const REVIVE_REACH = 2.4;
const HOST_REACH = 4.5;
const CARD_MS = 250;
/** A guest's kit goes to the host when it has changed, checked this often. */
export const KIT_MS = 2000;
/** A host frame longer than this is a stall (a hitch, a sleeping tab): the bleed clocks do not count the excess. */
const STALL_MS = 250;
/** After the Commander falls his last words are read out before the board (ui/commander); if they never finish, the board comes anyway. */
const FULFILLED_WAIT_MS = 25_000;
const DOWN_COLOR = '#ff3b3b';
/** The host's custom Crucible rules run the shared world: every player is told, once. */
const CUSTOM_LINE = 'HOST\'S CUSTOM RULES APPLY · unranked';
const GOOD = '#79f1ad';

/** One player's life, as the host keeps it. `life` counts lives, so damage meant for an earlier one is dropped. */
export class TeamLife {
  state: LifeState = 'up';
  life = 0;
  bleedUntil = 0;
  get down(): boolean { return this.state !== 'up'; }
  /** At 0 health. False if already down or dead. */
  fall(now: number): boolean {
    if (this.state !== 'up') return false;
    this.state = 'down';
    this.bleedUntil = now + BLEED_MS;
    return true;
  }
  /** A teammate's hold: only from down. */
  revive(): boolean {
    if (this.state !== 'down') return false;
    this.state = 'up';
    this.life++;
    return true;
  }
  /** The wave is cleared, or a new one starts: the dead and anyone still down come back. */
  respawn(): boolean {
    if (this.state === 'up') return false;
    this.state = 'up';
    this.life++;
    return true;
  }
  /** True the moment a downed player bleeds out. */
  bleed(now: number): boolean {
    if (this.state !== 'down' || now < this.bleedUntil) return false;
    this.state = 'dead';
    return true;
  }
  accepts(life: number): boolean { return this.state === 'up' && life === this.life; }
}

/** Nobody is up: the run is over. An empty team is not a wipe. */
export const wiped = (lives: readonly TeamLife[]): boolean => lives.length > 0 && lives.every(life => life.state !== 'up');

const STATES: readonly LifeState[] = ['up', 'down', 'dead'];
const int = (value: unknown, max: number): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : 0;

/** A card as it arrives from someone else's browser: every field clamped, nothing else kept. */
export function cleanCard(value: unknown): Card | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Partial<Card>;
  if (!Number.isInteger(c.slot) || c.slot! < 0 || c.slot! > 3) return null;
  return {
    slot: c.slot!, state: STATES.includes(c.state as LifeState) ? c.state! : 'up', bleed: int(c.bleed, 60), life: int(c.life, 1e6),
    hp: int(c.hp, 1000), max: int(c.max, 1000) || 100, armor: int(c.armor, 1000), kills: int(c.kills, 1e6), score: int(c.score, 1e9),
    credits: int(c.credits, 1e9), downs: int(c.downs, 1e4), revives: int(c.revives, 1e4), ping: int(c.ping, 9999),
    cheats: c.cheats === true, menu: c.menu === true, ok: c.ok === true,
  };
}

/** Host: what is kept for a player across a drop, under their stable id. */
interface Seat {
  purse: Card | null;
  kit: Kit | null;
  /** They left dead or down: they come back dead. */
  dead: boolean;
  /** Their cheats were on the last time their card said. */
  cheats: boolean;
}

export class Team {
  /** Host: every player's life by lobby id. Guests mirror the host's cards into it. */
  readonly lives = new Map<string, TeamLife>();
  /** Every player's latest card, by slot. */
  readonly cards = new Map<number, Card>();
  /** Spent at the end: the cards as the run ended, for the end-of-run board. */
  final: Card[] | null = null;
  ending: Ending | null = null;
  overWave = 0;
  downs = 0;
  revives = 0;
  reviving = false;
  /** The boss of the wave that last started is a Titan, by the host's rules (the HUD's banner reads it). */
  titanWave = false;
  /** The host plays on custom Crucible rules: said once to everyone. */
  customRules = false;
  /** The break between waves: its length and the ready vote. */
  readonly rest: TeamBreak;
  /** Pings: markers in the world, for everyone. */
  readonly marks: Marks;
  private readonly key = new OrderKey();
  private nextCard = 0;
  private nextKit = 0;
  private sentKit = '';
  private watching = -1;
  private readonly seat = { position: new THREE.Vector3(), yaw: 0, pitch: -0.25, roll: 0, shake: 0 };
  private prompt: { text: string; off: () => void } | null = null;
  private readonly promptAt = new THREE.Vector3();
  private myState: LifeState = 'up';
  private readonly off: (() => void)[] = [];
  /** Host: what each player left with, by stable id (`seatKey`). */
  private readonly seats = new Map<string, Seat>();
  /** Guest: the host has settled my seat (its `restore` came): my purse and kit may be kept from now on. */
  private settled: boolean;
  private lastNow = 0;
  private fulfilledAt = 0;
  private toldCheats = false;
  private toldRules = false;
  /** Host: each arrived guest's seat key, kept while they are in, because the lobby forgets a player the moment they leave. */
  private readonly left = new Map<string, string>();
  /** Host: arrived players who are out of the world right now, and those of them the team respawned meanwhile. */
  private readonly awayIds = new Set<string>();
  private readonly rose = new Set<string>();
  onOver: (cards: Card[], wave: number, ending: Ending) => void = () => {};
  /** Host: a guest's world is up (its first card came in): the moment to hand it what it missed while loading. */
  onArrived: (id: string) => void = () => {};
  private readonly arrived = new Set<string>();

  constructor(private readonly ctx: Ctx, private readonly session: CoopSession, private readonly send: (event: WorldEvent, to?: string) => void) {
    this.settled = session.hosting;
    this.rest = new TeamBreak(ctx, session, send, () => this.voters());
    this.marks = new Marks(ctx, session, send);
    this.off.push(ctx.events.on('player:died', () => this.fell(session.lobby.you)));
    if (session.hosting) {
      this.off.push(ctx.events.on('wave:start', e => {
        this.titanWave = e.boss && isTitanWave(e.wave, (ctx.waves as { rules?: Parameters<typeof isTitanWave>[1] }).rules);
        this.send({ t: 'wave', kind: 'start', wave: e.wave, total: e.total, boss: e.boss, bonus: 0, titan: this.titanWave, ...this.wavePhase() });
        this.rest.ended();
        // The second pass: anyone who fell in the break itself.
        this.respawnFallen();
      }));
      this.off.push(ctx.events.on('wave:clear', e => {
        // Before the wave's own news goes out: a guest is on its feet when its shop pays and its pod is called.
        this.respawnFallen();
        // The team's break is set first, so the clock the event carries is the team's.
        this.rest.began(e.wave);
        this.send({ t: 'wave', kind: 'clear', wave: e.wave, total: 0, boss: false, bonus: e.bonus, ...this.wavePhase() });
      }));
      // A mission won is the end of the run for everyone, with the board.
      this.off.push(ctx.events.on('campaign:complete', () => this.finish('mission')));
      // Endless Humans: the Commander is dead. The HUD calls `finish` once his last words are read; this is the backstop.
      this.off.push(ctx.events.on('commander:fulfilled', () => { if (!MISSION_ID) this.fulfilledAt = performance.now() + FULFILLED_WAIT_MS; }));
    }
  }

  private get me(): number { return this.session.lobby.me?.slot ?? 0; }
  private get mission(): boolean { return MISSION_ID !== null; }
  /** "back at wave clear", or in a mission, where there are no waves, the checkpoint. */
  private get backWhen(): string { return this.mission ? 'back at the checkpoint' : 'back at wave clear'; }

  /** Host: the waves' phase and clock as a wave event goes out. A guest's only other source is the next snapshot, which is later. */
  private wavePhase(): { phase: string; next: number } {
    const waves = this.ctx.waves;
    return { phase: waves.phase, next: Number.isFinite(waves.nextWaveIn) ? Math.max(0, Math.round(waves.nextWaveIn * 10) / 10) : 0 };
  }

  /**
   * Guest: the phase a wave event carries is set before the event is replayed, so what hears it (the supply pod, the shop) is
   * already in the break. Without it the pod was called in `spawning` and retired on the next frame (audit A5).
   */
  private followPhase(kind: 'start' | 'clear', phase: unknown, next: unknown, wave: number): void {
    // A clear is the break whatever the host's director said at that instant (Outpost Defense's still announces first).
    const known: WavePhase = kind === 'clear' ? 'intermission' : phase === 'boss' || phase === 'clearing' ? phase : 'spawning';
    const waves = this.ctx.waves as { wave: number; phase: WavePhase; nextWaveIn: number };
    waves.wave = wave;
    waves.phase = known;
    if (typeof next === 'number' && Number.isFinite(next) && next >= 0 && next < 100000) waves.nextWaveIn = next;
  }

  life(id: string): TeamLife {
    let life = this.lives.get(id);
    if (!life) this.lives.set(id, life = new TeamLife());
    return life;
  }

  private idOf(slot: number): string | undefined {
    return this.session.lobby.players.find(p => p.slot === slot)?.id;
  }

  private nameOf(slot: number): string {
    return this.session.lobby.players.find(p => p.slot === slot)?.name ?? 'A player';
  }

  /** Host: the players in the match whose world is up: the ones a wipe and a vote count. Not the away, the loading or the lost. */
  private present(): { id: string; slot: number; name: string }[] {
    const lobby = this.session.lobby;
    return lobby.players.filter(p => !p.away && (p as { lost?: boolean }).lost !== true && (p.id === lobby.you || this.arrived.has(p.id)));
  }

  /** Host: the slots whose vote ends the break: everyone in the match who is on their feet. The dead never hold the team up. */
  private voters(): number[] {
    return this.present().filter(p => this.life(p.id).state === 'up').map(p => p.slot);
  }

  /**
   * Host: the id a player's seat is kept under: the lobby's seat (one per browser, the same through reloads and reconnects),
   * else their browser's id, else their callsign.
   */
  private seatKey(id: string): string {
    const lobby = this.session.lobby as CoopSession['lobby'] & { browserOf?(id: string): string };
    const player = lobby.players.find(p => p.id === id);
    const seat = (player as { seat?: string } | undefined)?.seat;
    if (seat) return `s:${seat}`;
    const browser = lobby.browserOf?.(id);
    if (browser) return `b:${browser}`;
    return player?.name ? `n:${player.name}` : '';
  }

  private seatOf(key: string): Seat {
    let seat = this.seats.get(key);
    if (!seat) this.seats.set(key, seat = { purse: null, kit: null, dead: false, cheats: false });
    return seat;
  }

  /**
   * Host: credits owed to the player who had lobby id `id` when they earned them (a prisoner's bounty, paid when the drone
   * secures him, perhaps a minute later). Returns the id to send them to now: their own, or their seat's new one if they
   * reloaded meanwhile. Null: they are out of the match, and the credits wait in their seat's purse for the rejoin.
   * Undefined: nobody to pay (never seated), so the caller keeps the money where it is.
   */
  payee(id: string, amount: number): string | null | undefined {
    if (!this.session.hosting) return undefined;
    const lobby = this.session.lobby;
    const key = this.left.get(id) ?? (lobby.players.some(p => p.id === id) ? this.seatKey(id) : '');
    if (!key) return undefined;
    const now = lobby.players.find(p => !p.away && this.arrived.has(p.id) && this.seatKey(p.id) === key);
    if (now) return now.id;
    const seat = this.seatOf(key);
    if (!seat.purse) return undefined;
    seat.purse = { ...seat.purse, credits: Math.min(1e9, seat.purse.credits + Math.max(0, Math.round(amount))) };
    return null;
  }

  /** Someone hit 0 health. Locally first (the crawl starts at once), then the host makes it so. */
  fell(id: string): void {
    if (this.final) return;
    if (id === this.session.lobby.you) {
      const p = this.ctx.player as unknown as { downed: boolean };
      p.downed = true;
      this.myState = 'down';
      this.downs++;
      this.ctx.hud.feed('YOU ARE DOWN · crawl to cover, a teammate can revive you with E', DOWN_COLOR);
    }
    if (!this.session.hosting) {
      if (id !== this.session.lobby.you) return;
      const life = this.life(id);
      this.send({ t: 'life', slot: this.me, alive: false, life: life.life });
      // Until the host's word comes back, damage for this life is already moot.
      life.state = 'down';
      return;
    }
    if (!this.life(id).fall(performance.now())) return;
    const name = this.session.lobby.players.find(p => p.id === id)?.name ?? 'A player';
    if (id !== this.session.lobby.you) this.ctx.hud.feed(`${name} IS DOWN`, DOWN_COLOR);
    this.broadcastCards();
  }

  /** Host: a checkpoint (or the team's redeploy): everyone down or dead gets up beside the host. */
  respawnAll(): void {
    if (!this.session.hosting) return;
    const at = this.ctx.player.position;
    for (const [id, life] of this.lives) if (life.respawn()) this.up(id, 'respawn', undefined, [at.x, at.y, at.z], this.ctx.player.yaw);
    this.forgiveSeats();
  }

  /** Host: the team has respawned. Someone who left dead and is not back yet has sat that out: they return alive. */
  private forgiveSeats(): void {
    for (const seat of this.seats.values()) seat.dead = false;
  }

  /** Host: the wave is cleared (or the next begins): the dead and the downed come back at the spawn, so everyone shops. */
  private respawnFallen(): void {
    for (const [id, life] of this.lives) if (life.respawn()) this.up(id, 'respawn');
    this.forgiveSeats();
  }

  /** Host: a revive or a respawn. The player's own browser puts them back on their feet: at the map's spawn, or beside `at`. */
  private up(id: string, how: 'revive' | 'respawn', by?: string, at?: [number, number, number], yaw = 0): void {
    const target = this.session.lobby.players.find(p => p.id === id);
    const slot = target?.slot;
    if (slot === undefined) return;
    // Out of the world just now (a dropped connection): the news waits for them (`update`).
    if (target!.away) this.rose.add(id);
    const life = this.life(id);
    const event: WorldEvent = { t: 'up', slot, life: life.life, how, by: by ? this.session.lobby.players.find(p => p.id === by)?.slot ?? -1 : -1,
      ...(at ? { at, yaw } : {}) };
    this.send(event);
    this.applyUp(event);
  }

  private applyUp(event: Extract<WorldEvent, { t: 'up' }>): void {
    const lobby = this.session.lobby;
    const player = lobby.players.find(p => p.slot === event.slot);
    if (!player) return;
    if (!this.session.hosting) {
      const life = this.life(player.id);
      life.state = 'up';
      life.life = event.life;
    }
    const by = lobby.players.find(p => p.slot === event.by);
    if (player.id === lobby.you) {
      const p = this.ctx.player as unknown as { alive: boolean; downed: boolean; health: number; maxHealth: number };
      p.alive = true;
      p.downed = false;
      this.myState = 'up';
      this.stopWatching();
      if (event.how === 'revive') {
        p.health = REVIVE_HEALTH;
        this.ctx.hud.feed(by ? `${by.name} GOT YOU UP` : 'BACK ON YOUR FEET', GOOD);
      } else {
        p.health = p.maxHealth;
        const spawns = this.ctx.world.playerSpawns;
        const spawn = spawns[(lobby.me?.slot ?? 0) % Math.max(1, spawns.length)];
        const at = Array.isArray(event.at) && event.at.length === 3 && event.at.every(Number.isFinite) ? event.at : null;
        if (at) this.ctx.player.teleport(new THREE.Vector3(...spread(at, Number.isFinite(event.yaw) ? event.yaw! : 0, lobby.me?.slot ?? 0)), event.yaw);
        else if (spawn) this.ctx.player.teleport(spawn.position, spawn.yaw);
        this.ctx.hud.feed('BACK IN THE FIGHT', GOOD);
      }
    } else if (event.how === 'revive') {
      this.ctx.hud.feed(`${by?.name ?? 'Someone'} revived ${player.name}`, GOOD);
    }
    if (by?.id === lobby.you && event.how === 'revive') this.revives++;
  }

  /** Registers the team's events with the world's router (world/router.ts): each goes to `receive` on the side that hears it. */
  plug(router: Router): void {
    for (const type of HOST_EVENTS) router.host(type, (event, from) => { this.receive(event, from); });
    for (const type of GUEST_EVENTS) router.guest(type, (event, from) => { this.receive(event, from); });
    router.both('mark', (event, from) => { this.receive(event, from); });
  }

  /** Everything addressed to the team. True when the event was one of its own. */
  receive(value: WorldEvent, from: string): boolean {
    const lobby = this.session.lobby;
    if (value.t === 'mark') {
      if (!validVec(value.at)) return true;
      const slot = this.session.hosting ? lobby.players.find(p => p.id === from)?.slot : value.slot;
      if (!Number.isInteger(slot)) return true;
      // The host stamps who it was and passes it on to the others.
      if (this.session.hosting) {
        if (!this.marks.allow(from, performance.now())) return true;
        for (const p of lobby.players) if (!p.host && !p.away && p.id !== from) this.send({ t: 'mark', at: value.at, slot }, p.id);
      }
      this.marks.show(slot!, value.at);
      return true;
    }
    if (this.session.hosting) {
      switch (value.t) {
        case 'life':
          if (value.alive === false && value.life === this.life(from).life) this.fell(from);
          return true;
        case 'card': {
          const player = lobby.players.find(p => p.id === from);
          const card = cleanCard({ ...(value.card as object), slot: player?.slot });
          if (!card || !player) return true;
          if (!this.arrived.has(from)) this.arrive(from);
          const life = this.life(from);
          Object.assign(card, { state: life.state, life: life.life, bleed: this.bleedLeft(life), ping: lobby.pingOf(from) ?? 0 });
          this.cards.set(card.slot, card);
          const seat = this.seatOf(this.seatKey(from));
          // Only a settled guest's numbers are kept: a card that left before the purse came back would wipe the purse.
          if (card.ok) seat.purse = card;
          if (card.cheats && !seat.cheats) lobby.notice(`${player.name} has cheats on · unranked`);
          seat.cheats = card.cheats;
          return true;
        }
        case 'kit': {
          const kit = cleanKit(value.kit);
          if (kit && this.arrived.has(from)) this.seatOf(this.seatKey(from)).kit = kit;
          return true;
        }
        case 'ready':
          this.rest.vote(from);
          return true;
        case 'revive': {
          const target = this.idOf(value.slot);
          if (!target || !this.near(from, target) || this.life(from).state !== 'up' || !this.life(target).revive()) return true;
          this.up(target, 'revive', from);
          return true;
        }
        default: return false;
      }
    }
    switch (value.t) {
      case 'team':
        if (!Array.isArray(value.list)) return true;
        for (const raw of value.list.slice(0, 4)) {
          const card = cleanCard(raw);
          if (!card) continue;
          this.cards.set(card.slot, card);
          const id = this.idOf(card.slot);
          if (!id) continue;
          const life = this.life(id);
          life.state = card.state;
          life.life = card.life;
          // The host says this player bled out or got up while a message was lost: follow it.
          if (id === lobby.you && card.state !== this.myState) this.follow(card.state);
        }
        return true;
      case 'up': if (Number.isInteger(value.slot) && Number.isInteger(value.life)) this.applyUp(value); return true;
      case 'wave':
        if (!Number.isInteger(value.wave) || value.wave < 0 || value.wave > 100000) return true;
        this.followPhase(value.kind, value.phase, value.next, value.wave);
        if (value.kind === 'start') {
          this.titanWave = value.titan === true;
          this.rest.ended();
          this.ctx.events.emit('wave:start', { wave: value.wave, total: int(value.total, 1000), boss: value.boss === true });
        } else if (value.kind === 'clear') {
          this.rest.began(value.wave);
          this.ctx.events.emit('wave:clear', { wave: value.wave, bonus: int(value.bonus, 1e7) });
        }
        return true;
      case 'over': {
        const cards = Array.isArray(value.cards) ? value.cards.map(cleanCard).filter((c): c is Card => !!c) : [];
        this.over(cards, int(value.wave, 1e5), ENDINGS.includes(value.how as Ending) ? value.how! : value.won === true ? 'mission' : 'wipe');
        return true;
      }
      case 'restore': this.restored(value); return true;
      case 'vote': this.rest.voted(value); return true;
      case 'sync': this.synced(value); return true;
      default: return false;
    }
  }

  /** Host: a guest's first card: its world is up. Its seat is settled (a returning player's purse, kit and life), then the catch-up. */
  private arrive(id: string): void {
    this.arrived.add(id);
    const seat = this.seats.get(this.seatKey(id));
    const purse = seat?.purse;
    const dead = seat?.dead === true;
    // Not a free revive: they wait, dead, for the team's next respawn.
    if (dead) this.life(id).state = 'dead';
    const returning = !!seat && (!!purse || !!seat.kit || dead);
    this.send({ t: 'restore', credits: purse?.credits ?? 0, score: purse?.score ?? 0, kills: purse?.kills ?? 0,
      ...(returning && seat.kit ? { kit: seat.kit } : {}), ...(dead ? { dead: true } : {}),
      ...(returning && purse && !dead ? { hp: purse.hp, armor: purse.armor } : {}) }, id);
    if (seat) seat.dead = false;
    this.send({ t: 'sync', wave: this.ctx.waves.wave, phase: this.ctx.waves.phase, left: Math.max(0, Math.ceil(this.ctx.waves.nextWaveIn)),
      rest: this.rest.on, custom: this.customRules, ...this.rest.tally() }, id);
    // The run ended while they loaded: they get the board, not a finished world.
    if (this.final) this.send({ t: 'over', wave: this.overWave, cards: this.final, won: this.ending !== 'wipe', how: this.ending ?? 'wipe' }, id);
    this.onArrived(id);
  }

  /** Guest: the host has settled my seat. A returning player gets the purse, the kit and their life back. */
  private restored(value: Extract<WorldEvent, { t: 'restore' }>): void {
    const { ctx } = this;
    // This page has been settled before (its connection dropped and came back): what it holds is newer than the host's copy.
    if (this.settled) return;
    const credits = int(value.credits, 1e9), score = int(value.score, 1e9), kills = int(value.kills, 1e6);
    const kit = value.kit ? cleanKit(value.kit) : null;
    const back = credits > 0 || score > 0 || !!kit || value.dead === true;
    if (back) {
      ctx.progression.resume(score, kills, kit?.headshots ?? ctx.progression.headshots);
      const wallet = ctx.contracts.wallet as { credits?: number } | null | undefined;
      if (wallet && typeof wallet.credits === 'number') wallet.credits = credits;
      if (kit) {
        try { applyKit(ctx, kit); }
        catch (error) { console.warn('[coop] The kit could not be put back whole', error); }
      }
      const p = ctx.player as unknown as { alive: boolean; downed: boolean; health: number; maxHealth: number; armor: number };
      if (value.dead === true) {
        p.alive = false; p.downed = false; p.health = 0;
        this.myState = 'dead';
        this.life(this.session.lobby.you).state = 'dead';
        ctx.hud.feed(`YOU LEFT DOWN · ${this.backWhen}`, DOWN_COLOR);
      } else {
        if (Number.isFinite(value.hp) && value.hp! > 0) p.health = Math.min(p.maxHealth, Math.max(1, int(value.hp, 1000)));
        if (Number.isFinite(value.armor)) p.armor = int(value.armor, 1000);
      }
      // The feed's lines are about forty characters wide: every line here fits.
      ctx.hud.feed(kit ? 'REJOINED · your kit and credits are back' : 'REJOINED · credits and score are back', GOOD);
    }
    this.settled = true;
    // The kit as it stands now is what the host has: nothing to send until it changes.
    this.sentKit = JSON.stringify(readKit(ctx));
  }

  /** Guest: arrived mid-run. The banner the others got, and in a break the clock and the vote as they stand. */
  private synced(value: Extract<WorldEvent, { t: 'sync' }>): void {
    const { ctx } = this;
    const wave = int(value.wave, 1e5);
    this.customRules = value.custom === true;
    if (this.customRules) ctx.hud.feed(CUSTOM_LINE, '#ffb33d');
    if (this.mission || wave < 1) return;
    if (value.rest === true) {
      this.rest.began(wave);
      this.rest.voted({ t: 'vote', ready: Array.isArray(value.ready) ? value.ready : [], need: int(value.need, 4), by: -1 });
      // The break's pod is shared: the world's own catch-up brings it (world/pods.ts).
      ctx.hud.banner(`WAVE ${wave} CLEAR`, `wave ${wave + 1} in ${int(value.left, 255)} s · find the supply pod`);
    } else ctx.hud.banner(`WAVE ${wave}`, 'in progress · you joined late');
  }

  /** A guest whose own state the host has moved on (a lost `up`, a bleed-out). */
  private follow(state: LifeState): void {
    // Only an `up` event brings a player back (and says how); a card that lags my own fall must not undo it.
    if (state === 'up') return;
    const p = this.ctx.player as unknown as { alive: boolean; downed: boolean; health: number };
    this.myState = state;
    if (state === 'dead') p.downed = false;
    if (state === 'down' && p.alive) { p.alive = false; p.downed = true; p.health = 0; }
  }

  /** Host: has the reviver's body really been beside the downed one? Positions from the pose lane or the host's own player. */
  private near(a: string, b: string): boolean {
    const at = (id: string) => id === this.session.lobby.you ? this.ctx.player.position : this.session.remotes.get(id)?.char.root.position;
    const pa = at(a), pb = at(b);
    return !!pa && !!pb && pa.distanceTo(pb) <= HOST_REACH;
  }

  private bleedLeft(life: TeamLife): number {
    return life.state === 'down' ? Math.max(0, Math.ceil((life.bleedUntil - performance.now()) / 1000)) : 0;
  }

  /** My own card: what the teammates strip and the Tab board show about me. */
  private card(): Card {
    const p = this.ctx.player;
    const wallet = this.ctx.contracts?.wallet as { credits?: number } | null | undefined;
    const life = this.life(this.session.lobby.you);
    return { slot: this.me, state: this.session.hosting ? life.state : this.myState, bleed: this.bleedLeft(life), life: life.life,
      hp: Math.max(0, Math.round(p.health)), max: Math.round(p.maxHealth), armor: Math.round(p.armor), kills: this.ctx.progression.kills,
      score: Math.round(this.ctx.progression.score), credits: Math.round(wallet?.credits ?? 0), downs: this.downs, revives: this.revives, ping: 0,
      cheats: cheatsOn(), menu: this.session.localPaused === true && !this.final, ok: this.settled };
  }

  private broadcastCards(): void {
    if (!this.session.hosting) return;
    const lobby = this.session.lobby;
    const mine = this.card();
    if (mine.cheats && !this.toldCheats) lobby.notice(`${lobby.me?.name ?? 'The host'} has cheats on · unranked`);
    this.toldCheats = mine.cheats;
    this.cards.set(this.me, mine);
    for (const player of lobby.players) {
      // A player whose own card has not come in yet still has a line, with what the host knows.
      if (!this.cards.has(player.slot)) this.cards.set(player.slot, cleanCard({ slot: player.slot })!);
      const card = this.cards.get(player.slot);
      const life = this.life(player.id);
      if (card) Object.assign(card, { state: life.state, life: life.life, bleed: this.bleedLeft(life), ping: player.host ? 0 : lobby.pingOf(player.id) ?? 0 });
    }
    for (const slot of [...this.cards.keys()]) if (!lobby.players.some(p => p.slot === slot)) this.cards.delete(slot);
    this.send({ t: 'team', list: [...this.cards.values()] });
  }

  update(now: number, dt: number): void {
    const lobby = this.session.lobby;
    this.marks.update(now);
    if (this.final) return;
    if (now >= this.nextCard) {
      this.nextCard = now + CARD_MS;
      if (this.session.hosting) this.broadcastCards();
      else this.send({ t: 'card', card: this.card() });
    }
    if (!this.session.hosting && this.settled && now >= this.nextKit) {
      this.nextKit = now + KIT_MS;
      const kit = readKit(this.ctx);
      const text = JSON.stringify(kit);
      if (text !== this.sentKit) { this.sentKit = text; this.send({ t: 'kit', kit }); }
    }
    this.rest.update();
    this.marks.key();
    if (this.session.hosting) {
      if (!this.toldRules) {
        // The rules are read as the run starts (Hud.startRun), after this was built: said once, to everyone.
        this.toldRules = true;
        this.customRules = this.session.match.mode === 'crucible' && crucibleRules() !== DEFAULT_RULES;
        // Guests are told as they arrive (`sync`).
        if (this.customRules) this.ctx.hud.feed(CUSTOM_LINE, '#ffb33d');
      }
      // A stalled host (a long hitch, a sleeping laptop) must not eat a downed player's seconds.
      const frame = this.lastNow ? now - this.lastNow : 0;
      const stall = frame - STALL_MS;
      this.lastNow = now;
      if (stall > 0) for (const life of this.lives.values()) if (life.state === 'down') life.bleedUntil += stall;
      // A player whose connection dropped (or who is out of the world) is not bleeding: their seconds wait for them. When
      // the same page is back, a respawn the team had meanwhile reaches them now.
      for (const player of lobby.players) {
        if (!this.arrived.has(player.id)) continue;
        if (player.away) {
          this.awayIds.add(player.id);
          const life = this.lives.get(player.id);
          if (life?.state === 'down') life.bleedUntil += Math.min(frame, STALL_MS);
        } else if (this.awayIds.delete(player.id) && this.rose.delete(player.id)) {
          const life = this.life(player.id);
          if (life.state === 'up') this.send({ t: 'up', slot: player.slot, life: life.life, how: 'respawn', by: -1 }, player.id);
        }
      }
      const lives: TeamLife[] = [];
      for (const player of this.present()) {
        const life = this.life(player.id);
        lives.push(life);
        if (life.bleed(now)) {
          if (player.id === lobby.you) this.follow('dead');
          this.ctx.hud.feed(`${player.name} BLED OUT · ${this.backWhen}`, DOWN_COLOR);
          this.broadcastCards();
        }
      }
      // A player who has gone: their seat remembers whether they left alive, and their life is forgotten.
      for (const [id, life] of this.lives) {
        if (lobby.players.some(p => p.id === id)) continue;
        this.lives.delete(id);
        this.arrived.delete(id);
        const key = this.left.get(id);
        if (key) this.seatOf(key).dead = life.state !== 'up';
        this.awayIds.delete(id);
        this.rose.delete(id);
      }
      for (const id of this.arrived) if (!this.left.has(id)) this.left.set(id, this.seatKey(id));
      // Kept after they go (a bounty may still be owed to that id, `payee`), but never without bound.
      if (this.left.size > 64) for (const id of [...this.left.keys()]) if (!lobby.players.some(p => p.id === id)) { this.left.delete(id); if (this.left.size <= 32) break; }
      if (this.fulfilledAt && now >= this.fulfilledAt) return this.finish('fulfilled');
      // Before the barrier lifts (players still loading, nobody past "Click to deploy") there is no run to lose.
      if ((this.session as { holding?: boolean }).holding === true) { this.markers(); return; }
      if (wiped(lives) && this.checkpoint()) return;
      if (wiped(lives)) return this.finish('wipe');
    }
    this.markers();
    this.reviveKey(dt);
    if (this.myState === 'dead') this.spectate();
  }

  /** Downed teammates carry a red tag with their seconds left, and E beside one revives them. */
  private markers(): void {
    const lobby = this.session.lobby;
    for (const player of lobby.players) {
      if (player.id === lobby.you) continue;
      const remote = this.session.remotes.get(player.id);
      const card = this.cards.get(player.slot);
      const life = this.lives.get(player.id);
      if (!remote) continue;
      remote.downed = life?.state === 'down';
      // Session lane: a teammate standing still under a menu or in a hidden tab says so on their tag (LobbyPlayer.idle).
      remote.setTag(remote.downed ? `${player.name} DOWN ${card?.bleed ?? ''}s` : player.idle ? `${player.name} · ${player.idle === 'hidden' ? 'tabbed out' : 'in a menu'}` : '',
        remote.downed ? DOWN_COLOR : '#9db0bd');
    }
  }

  private reviveKey(dt: number): void {
    const { player, input } = this.ctx;
    this.reviving = false;
    let target: { slot: number; name: string; at: THREE.Vector3 } | null = null;
    if (player.alive && !player.parked) {
      let best = REVIVE_REACH;
      for (const p of this.session.lobby.players) {
        if (this.lives.get(p.id)?.state !== 'down') continue;
        const body = this.session.remotes.get(p.id)?.char.root.position;
        const d = body?.distanceTo(player.position) ?? Infinity;
        if (d < best) { best = d; target = { slot: p.slot, name: p.name, at: body! }; }
      }
    }
    if (!target) {
      this.key.held = -1;
      this.setPrompt('');
      return;
    }
    const gesture = this.key.update(dt, input.pressed('interact'), input.isDown('interact'), true);
    this.reviving = this.key.held >= 0;
    if (this.key.held >= 0) this.ctx.hud.hold?.(this.key.progress(true));
    if (gesture === 'revive') {
      this.ctx.hud.hold?.(1);
      const id = this.idOf(target.slot);
      if (this.session.hosting) { if (id && this.life(id).revive()) this.up(id, 'revive', this.session.lobby.you); }
      else this.send({ t: 'revive', slot: target.slot });
    }
    // Above the name tag on the body, so the two never sit on each other.
    this.promptAt.copy(target.at).y += 1.9;
    // The ring round the crosshair shows the hold, so the words stay put.
    this.setPrompt(`Hold [${input.labelFor?.('interact') ?? 'E'}] to revive ${target.name}`);
  }

  private setPrompt(text: string): void {
    if (this.prompt?.text === text) return;
    this.prompt?.off();
    this.prompt = text ? { text, off: this.ctx.hud.follow(this.promptAt, text, GOOD) } : null;
  }

  /** Dead: the camera rides over a living teammate's shoulder. Fire cycles to the next one. */
  private spectate(): void {
    const lobby = this.session.lobby;
    const living = lobby.players.filter(p => p.id !== lobby.you && this.lives.get(p.id)?.state === 'up' && this.session.remotes.get(p.id)?.char.root.visible);
    if (!living.length) return this.stopWatching();
    let index = living.findIndex(p => p.slot === this.watching);
    if (index < 0 || this.ctx.input.pressed('fire')) index = (index + 1) % living.length;
    const watched = living[index]!;
    this.watching = watched.slot;
    const remote = this.session.remotes.get(watched.id)!;
    const root = remote.char.root;
    // The body faces +Z with a half turn (remote.ts); the camera looks down its -Z.
    const yaw = root.rotation.y - Math.PI;
    this.seat.yaw = yaw;
    this.seat.position.set(root.position.x + Math.sin(yaw) * 3.2, root.position.y + 2.3, root.position.z + Math.cos(yaw) * 3.2);
    this.ctx.camera.setSeat?.(this.seat);
    // Over a friend's shoulder there is no gun in my hands.
    const view = this.ctx.render.viewScene as { visible?: boolean } | undefined;
    if (view) view.visible = false;
    this.setPrompt('');
    if (this.ctx.time.frame % 30 === 0) this.ctx.hud.callout?.(`WATCHING ${watched.name} · ${this.backWhen} · fire: next`);
  }

  private stopWatching(): void {
    if (this.watching < 0) return;
    this.watching = -1;
    this.ctx.camera.setSeat?.(null);
    const view = this.ctx.render.viewScene as { visible?: boolean } | undefined;
    if (view) view.visible = true;
  }

  /**
   * Host, in a mission: everyone down sends the whole team back to the last checkpoint, as one player's death does alone.
   * False off a mission, or with no checkpoint to go back to.
   */
  private checkpoint(): boolean {
    const campaign = this.ctx.campaign as unknown as { active?: boolean; restart?(): boolean };
    if (!campaign?.active || !campaign.restart) return false;
    if (!campaign.restart()) return false;
    this.session.lobby.notice('EVERYONE DOWN · back to the checkpoint');
    this.respawnAll();
    return true;
  }

  /** Host, from the pause menu in a mission: the whole team goes back to the last checkpoint, and is told. False with none to go to. */
  restartCheckpoint(): boolean {
    if (!this.session.hosting || this.final) return false;
    const campaign = this.ctx.campaign as unknown as { active?: boolean; restart?(): boolean };
    if (!campaign?.active || !campaign.restart?.()) return false;
    this.session.lobby.notice('The host sent the team back to the checkpoint.');
    this.respawnAll();
    return true;
  }

  /**
   * Host: the run is over for the whole team, and every screen gets the board: everyone down (`wipe`), the Commander dead in
   * Endless Humans (`fulfilled`), a mission won (`mission`). The only way a co-op run ends.
   */
  finish(how: Ending): void {
    if (!this.session.hosting || this.final) return;
    this.fulfilledAt = 0;
    this.broadcastCards();
    const cards = [...this.cards.values()];
    this.send({ t: 'over', wave: this.ctx.waves.wave, cards, won: how !== 'wipe', how });
    this.over(cards, this.ctx.waves.wave, how);
  }

  private over(cards: Card[], wave: number, ending: Ending): void {
    if (this.final) return;
    this.final = cards.sort((a, b) => b.score - a.score);
    this.ending = ending;
    this.overWave = wave;
    this.stopWatching();
    this.setPrompt('');
    this.onOver(this.final, wave, ending);
  }

  /** The strip and the board read this: every player in slot order, with the colour of their tag. */
  roster(): { card: Card; name: string; color: string; me: boolean }[] {
    const lobby = this.session.lobby;
    if (!this.session.hosting) this.cards.set(this.me, { ...this.card(), ...this.pick(this.cards.get(this.me)) });
    return lobby.players.filter(p => !p.away).sort((a, b) => a.slot - b.slot).flatMap(p => {
      const card = p.id === lobby.you ? { ...this.card(), ...this.pick(this.cards.get(p.slot)) } : this.cards.get(p.slot);
      return card ? [{ card, name: p.name, color: slotColor(p.slot), me: p.id === lobby.you }] : [];
    });
  }

  /** A player's name and tag colour by slot, for the kill feed and the pings. */
  who(slot: number): { name: string; color: string; me: boolean } {
    return { name: this.nameOf(slot), color: slotColor(slot), me: slot === this.me };
  }

  /** The host's word on state, bleed and ping, over my own numbers. */
  private pick(card: Card | undefined): Partial<Card> {
    return card ? { state: card.state, bleed: card.bleed, ping: card.ping } : {};
  }

  dispose(): void {
    for (const off of this.off) off();
    this.setPrompt('');
    this.stopWatching();
    this.marks.dispose();
  }
}

/** A slot's tag colour as CSS. */
export const slotColor = (slot: number): string => `#${(COLORS[slot] ?? COLORS[0]!).toString(16).padStart(6, '0')}`;
