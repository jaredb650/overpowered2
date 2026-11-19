import { report, reporter } from '../core/report';
import { coopErrorCode } from '../core/errors';
import { turnConfigured } from './turn';
/**
 * The co-op lobby: who is in, who is ready, and a chat line. The host's browser owns the list and sends it to each guest;
 * a guest only ever asks the host. Everything a peer sends is checked here, since it arrives from someone else's browser.
 *
 * Joining: every peer says hello with its build id on connect. A guest that meets a host on another build stops with
 * 'version'. A wrong password stops it with 'password', told by trystero or, through the door (room.ts), by the host.
 * A guest that hears from no host in HOST_WAIT_MS stops with 'no-host': a wrong code, a host who left, or a network that
 * will not connect, so it is never silence. While it waits, `stage` says how far it got (relays, the lobby, the host's
 * connection, the version check), and a timeout names the stage that stalled.
 */
import { BUILD } from './build';
import { defaultStarter, isStarter, type StarterGun } from '../contracts/starter';
import { decodePose, encodePose, type Pose } from './pose';
import { BEHIND_BYTES, type Channel, type ChannelOptions, type LobbyRooms, type NetError, type NetRoom } from './room';
import { Batcher, KIND_JSON, RecordWriter, batchTag, matchTag, readBatch, readJson, type Packer } from './batch';
import { Pressure } from './pressure';
import { metrics } from './metrics';
import { LOOPBACK } from './mode';
import { iceAdvice } from './ice';

/** 'no-answer': a host was reached but never said hello (its tab is frozen or still loading). */
export type LobbyError = 'password' | 'version' | 'host-left' | 'no-host' | 'connect' | 'full' | 'relays' | 'lost' | 'code-taken' | 'no-answer';
export type LobbyPhase = 'connecting' | 'open' | 'closed';
/** How far a guest's join got: the relays, then the lobby, then a connection to the host, then its version. */
export type JoinStage = 'relays' | 'looking' | 'connecting' | 'version' | 'joined';

export interface LobbyPlayer {
  id: string;
  name: string;
  ready: boolean;
  host: boolean;
  slot: number;
  starter?: StarterGun;
  /** Round trip to the host in ms, measured by the host. The host's own is 0. */
  ping?: number;
  /**
   * Not in the match's world right now, so nothing of the game is sent to or taken from them: back on the lobby page while
   * the match goes on, still loading the map, or lost (`state` says which of the last two).
   */
  away?: boolean;
  /**
   * The seat: one per browser, the same through reloads, reconnects and every match in this room. Slot (colour, spawn, tag)
   * stays with it. Per-player state on the host (lives, purses, kits) is keyed by it, never by `id`, which is only the
   * seat's current connection and changes on every page load.
   */
  seat?: string;
  /**
   * In a match: 'loading' (the map page is booting, or the player has not connected yet), 'ready' (booted, at "Click to
   * deploy"), 'lost' (the connection dropped; the seat is kept for SEAT_GRACE_MS). Absent: in the world, or on the lobby page.
   */
  state?: SeatState;
  /** In the world but not at the controls: a menu, the shop or the loadout is open ('menu'), or their tab is hidden ('hidden'). */
  idle?: Idle;
  /** This player has the cheat panel unlocked: the lobby's list says so before a match, as the team's cards do in one. */
  cheats?: boolean;
}
export type Idle = 'menu' | 'hidden';
const idleOf = (value: unknown): Idle | undefined => (value === 'menu' || value === 'hidden' ? value : undefined);
export type SeatState = 'loading' | 'ready' | 'lost';

/** One seat as the match handoff carries it to the host's map page, so that page knows who is coming (session.ts). */
export interface SeatRecord { browser: string; seat: string; name: string; slot: number; starter?: StarterGun }

export interface LobbyOptions {
  /** The match this page was built for (a map page), or null on a lobby page. Sent in hello: see `hello`. */
  page?: string | null;
  /** Host, on a map page: the players the lobby sent into this match, pre-seated as 'loading'. */
  roster?: readonly SeatRecord[];
  /** Host: every browser this room has seated so far, so a seat id means the same player for the room's whole life. */
  seats?: readonly (readonly [string, string])[];
  /**
   * Host: the slot each seat had (seat id, slot), from the lobby this one takes over from after its page was reloaded. A seat
   * that comes back gets its slot again if it is free, so nobody changes colour or spawn because of who said hello first.
   */
  slots?: readonly (readonly [string, number])[];
  /** Guest: how long to wait for a host before giving up (HOST_WAIT_MS, longer on a map page that is busy loading). */
  hostWait?: number;
}

/**
 * A reliable lane of events for the match (`Lobby.events`). Everything sent between two flushes travels as one message
 * per peer (batch.ts), in the order it was sent.
 */
export interface EventLane<T> {
  /**
   * Queues `data` for the match's players (a guest: for the host), for the one named `to`, or for all but `except`.
   * `cosmetic`: left out for a peer that is behind (pressure.ts). Returns how many players it was queued for.
   */
  send(data: T, to?: string, except?: string, cosmetic?: boolean): number;
  /** The size on the wire of the event the last `send` encoded, per recipient. */
  readonly bytes: number;
}

/** What happened to a seat, for the game (index.ts). `rejoin`: this seat has been in this match's world before. */
export type SeatEvent = { kind: 'in'; rejoin: boolean } | { kind: 'lost' } | { kind: 'gone' };

/** `from` null is the lobby's own line: joins, leaves, warnings. */
export interface ChatLine {
  from: string | null;
  text: string;
}

/** The survival modes, then the campaign's missions (`campaign` is the Outpost, mission 1). */
export const COOP_MODES = ['crucible', 'outpost', 'defense', 'campaign', 'foreclosure'] as const;
export type CoopMode = typeof COOP_MODES[number];
/** Maps a mode may be played on besides its own (`ContractDef.alsoOn`). */
export const COOP_MAPS = ['office'] as const;
export type CoopMap = typeof COOP_MAPS[number];
export interface Match { id: string; mode: CoopMode; map?: CoopMap }
/** The mode the host has selected, before any match: guests see it, and their untouched starter follows it. */
export type ModePick = Omit<Match, 'id'>;
export const validMatch = (m: unknown): m is Match => !!m && typeof m === 'object'
  && typeof (m as Match).id === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test((m as Match).id)
  && COOP_MODES.includes((m as Match).mode)
  && ((m as Match).map === undefined || COOP_MAPS.includes((m as Match).map!));

type Msg =
  | { t: 'start'; match: Match }
  | { t: 'started'; id: string }
  /**
   * `page`: the match this page was built for, null on a lobby page. `match` (host): the match it is running or starting.
   * A host whose `page` is not its `match` is on its way out to a new page; see `hello`.
   * `n` (host): how many guests are connected to it now, for two hosts that meet on one code (`otherHost`).
   */
  | { t: 'hello'; v: string; name: string; host: boolean; page?: string | null; match?: string | null; starter?: StarterGun; born?: number; browser?: string; n?: number }
  | { t: 'set'; name: string; ready: boolean; starter?: StarterGun; idle?: Idle; cheats?: boolean }
  /**
   * `live`: the match's world has started (the load barrier is over). `holdLeft`: seconds until it starts regardless.
   * `on`: the match the host is running or starting, null for none, so a page that missed an `end` (it was loading, or
   * reloading) still learns its match is over.
   */
  | { t: 'lobby'; you: string; players: LobbyPlayer[]; pick?: ModePick; live?: boolean; holdLeft?: number; on?: string | null }
  /** Guest to host: my map page has booted (`click` false), or I clicked Deploy and am in the world (`click` true). */
  | { t: 'loaded'; click: boolean; id: string }
  /** A deliberate quit, so the other side says "left" at once instead of holding the seat or counting down a reconnect. */
  | { t: 'bye' }
  | { t: 'chat'; from: string | null; text: string }
  /** Host to guest and back: the round trip is the ping, and any message at all is the heartbeat. */
  | { t: 'ping'; n: number }
  | { t: 'pong'; n: number }
  /** The host already has four. */
  | { t: 'full' }
  /** The start countdown, in whole seconds; 0 is cancelled. */
  | { t: 'count'; n: number }
  /** Host: the match is over, everyone back to the lobby page. Guest: I left the match for the lobby page (`back` false) or want back in. */
  | { t: 'end' }
  | { t: 'away'; back: boolean };

/** Through the door: the host saw this guest's password fail (`wrong`), or says which peer the host is (`host`). */
type DoorMsg = { t: 'wrong' } | { t: 'host' };

export const MAX_PLAYERS = 4;
/**
 * The transport's own cap on a room (trystero's `maxUsers`, and the loopback's), kept well above the game's four. Its count
 * is not the lobby's: it includes a player whose tab died until the transport notices, and both pages of everyone during a
 * match start (eight pages for four players), so at four it turned away a friend coming straight back, or a new map page,
 * for good ("lobby full" while their own ghost held the place). The lobby's own check is the only cap (`admit`).
 */
export const TRANSPORT_MAX_USERS = MAX_PLAYERS * 3;
export const NAME_MAX = 16;
export const CHAT_MAX = 160;
const CHAT_KEEP = 40;
export const HOST_WAIT_MS = 30_000;
/** The same wait on a map page: its host is loading a map too, after waiting for slow acks, so the lobby's 30 s is too tight. */
export const MATCH_HOST_WAIT_MS = 120_000;
/**
 * No matchmaking relay open by then: nothing else can work, so say so rather than wait out HOST_WAIT_MS. 25 s, not 10: on
 * mobile data or a slow link a relay's handshake alone was measured at 6 to 10 s, and the owner got "could not be reached"
 * on the public site while every relay answered from a wired machine.
 */
export const RELAY_WAIT_MS = 25_000;
/** How long a guest waits in the main room before it asks at the door. A right password is in within about three. */
export const DOOR_AFTER_MS = 5_000;
export const PING_MS = 2_000;
/** Silence after which a peer is gone, even if WebRTC has not noticed yet (a closed lid, a dropped Wi-Fi). */
export const SILENCE_MS = 20_000;
export const COUNTDOWN_S = 5;
/** Guests acknowledge a start before the host changes page. One that does not within this is left to catch up on its own. */
export const START_ACK_MS = 5_000;
/** Host, the load barrier: the world waits this long, from the host's own deploy click, for players still loading. */
export const LOAD_WAIT_MS = 90_000;
/** And this long for a player whose page has loaded but who has not clicked Deploy (away from the keyboard). */
export const CLICK_WAIT_MS = 20_000;
/** Nothing heard for this long: the link is in trouble. A guest shows "Reconnecting to host"; nothing is closed yet. */
export const QUIET_MS = 6_000;
/** Guest: how long "Reconnecting to host" lasts before the match is given up as lost. */
export const RECONNECT_MS = 30_000;
/** Host: how long a lost guest's seat (slot, life, purse, kit) is kept for them. */
export const SEAT_GRACE_MS = 60_000;
/** Host: how long a seat whose player never connected to the match is kept (a late joiner still loading, a no-show). */
export const LOADING_SEAT_MS = 180_000;
/** A heartbeat that last ran longer ago than this means the page itself was stalled, not the peers silent. */
export const STALL_MS = 5_000;
/**
 * After a deliberate leave the room stays up this long, so the goodbye gets out before the connection closes. Without it a
 * slow link loses the word, and the quit reads "lost connection" on the other side.
 */
export const BYE_FLUSH_MS = 600;
/** A guest closes on an error from a peer it cannot tell from the host only when nothing else is in progress for this long. */
export const PENDING_ERROR_MS = 8_000;
/** The host's own row. Guests are listed by their peer id. */
const HOST_ID = 'host';

const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';

/** A seat nobody is connected to: its row keeps the name and slot under an id no peer can have. */
const offline = (seat: string): string => `~${seat}`;
const linked = (p: LobbyPlayer): boolean => !p.host && !p.id.startsWith('~');
const SEAT_STATES: readonly SeatState[] = ['loading', 'ready', 'lost'];

export class Lobby {
  phase: LobbyPhase = 'connecting';
  error: LobbyError | null = null;
  /** With a 'connect' error: what the failed connection's candidates say, or '' (ice.ts). */
  connectAdvice = '';
  /** The other side's build, when `error` is 'version'. */
  theirBuild = '';
  players: LobbyPlayer[] = [];
  /** This browser's row in `players`. */
  you = '';
  chat: ChatLine[] = [];
  onChange: () => void = () => {};
  match: Match | null = null;
  /**
   * A match to load: the host's own start once the guests have acknowledged it; a guest's when the host says so. A guest
   * also gets it for a *different* match than the one it holds (the host reloaded, or started another while this page was
   * loading): the old one is over, and whoever listens loads the new one.
   */
  onMatch: (match: Match) => void = () => {};
  onPose: (id: string, pose: Pose) => void = () => {};
  /** Every chat line as it arrives, for the in-game feed. */
  onLine: (line: ChatLine) => void = () => {};
  /** Seconds left on the host's start countdown, 0 when none runs. */
  count = 0;
  /** The host's selected mode (setPick); guests follow it from the host's list. */
  pick: ModePick = { mode: 'crucible' };
  /** Guest: the match the host is still playing after this guest went back to the lobby page. */
  awayFrom: Match | null = null;
  /** Host ended the match: everyone's game goes back to the lobby page. */
  onEnd: () => void = () => {};
  /** Host: '' when this page can carry a match over to the map page, else the line that says why not (tab storage blocked). */
  canStart: () => string = () => '';
  /**
   * The load barrier. False from a match's start until the host starts its world: when every player has clicked Deploy, or
   * the wait ran out. Guests mirror the host's word.
   */
  live = false;
  /** While the barrier holds: seconds until the host starts regardless of who is missing; 0 before the host itself is in. */
  holdLeft = 0;
  /** The barrier is over: the host starts its world (waves, directors, the mission). Fires on guests too. */
  onGo: () => void = () => {};
  /** Host: a player came into the world, lost their connection, or is gone for good (index.ts turns these into the game's hooks). */
  onSeat: (player: LobbyPlayer, event: SeatEvent) => void = () => {};
  /** The match this page was built for (a map page); null on a lobby page, and again once the match is over or left. */
  page: string | null;
  /** How far this page is into the match: on the lobby page, loading the map, at "Click to deploy", or in the world. */
  where: 'lobby' | 'loading' | 'ready' | 'in';
  /**
   * Guest: the link to the host is in trouble (silent, or the host's page went away) and has until `until` to come back
   * before the room closes with `reason`. Nothing is closed meanwhile.
   */
  reconnecting: { since: number; until: number; reason: 'lost' | 'host-left' } | null = null;
  private starting = new Set<string>();
  private started = false;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly heard = new Map<string, number>();
  private pings = new Map<string, number>();
  private beat: ReturnType<typeof setInterval> | null = null;
  private nextBeat = 0;
  private lastBeat = 0;
  /** When this lobby opened, so of two hosts on one code the newer one steps aside. */
  private readonly born = Date.now() + Math.random();
  /** This browser's id (localStorage), sent in hello: the host seats a player by it, so a reload or a reconnect is the same player. */
  browser = BROWSER_ID;
  /** Host: browser id to seat, for the room's whole life (carried across the host's own page loads). */
  private readonly seatOf = new Map<string, string>();
  private seatCount = 0;
  /** Host: the slot each seat last had in this room. */
  private readonly slotWanted = new Map<string, number>();
  /** Host, by seat: when it was lost (or last had a connection, for a seat still loading), and when its page booted. */
  private readonly lostAt = new Map<string, number>();
  private readonly readyAt = new Map<string, number>();
  /** Host: seats that have been in this match's world, so coming back reads "is back" and counts as a rejoin. */
  private readonly beenIn = new Set<string>();
  /** Host: peers that said goodbye, so their leaving reads "left", not "lost connection". */
  private readonly byes = new Set<string>();
  /** Host: seats that stepped out to the lobby page by choice. A reconnect must not pull them back into the match. */
  private readonly out = new Set<string>();
  /** Host: when the host itself got into the world, which starts the barrier's clock. */
  private holdFrom = 0;
  private counter: ReturnType<typeof setInterval> | null = null;
  private readonly poses: Channel<ArrayBuffer>;
  /** The reliable event lanes' queues, flushed together (`flushEvents`). */
  private readonly batchers: Batcher[] = [];
  /** How a flush is put off to the end of the frame; null sends each event as it is queued (`batching`). */
  private defer: ((run: () => void) => void) | null = null;
  private flushDue = false;
  private tagOf = { id: '', tag: 0 };
  /** Backpressure on the reliable event lanes, per peer (pressure.ts). `stats` counts what it left out. */
  readonly pressure = new Pressure();
  /** Host: peers cut for falling too far behind (`stall`). Each comes back when its queue has drained. */
  private readonly stalled = new Set<string>();

  private readonly ch: Channel<Msg>;
  private hostId: string | null = null;
  /**
   * Guest: the browser of the host this page knows (hello carries it). While the link is in trouble only that browser is
   * taken as the host again, on a new connection or a new page: never whoever else says "host" on the code.
   */
  private hostBrowser = '';
  /** Host: other hosts met on this code (peer ids), told again each heartbeat how many players this one has. */
  private readonly rivals = new Set<string>();
  /** Host: the callsign of the host this lobby gave way to (`error` is then 'code-taken'). */
  yieldedTo = '';
  private ready = false;
  private cheats = false;
  private idle: Idle | undefined;
  private wait: ReturnType<typeof setTimeout> | null = null;
  private relayWait: ReturnType<typeof setTimeout> | null = null;
  /** Guest: peers connected whose hello has not come yet (the host, while its version is checked). */
  private unheard = new Set<string>();
  private lastStage: JoinStage = 'looking';
  private knock: ReturnType<typeof setTimeout> | null = null;
  private readonly room: NetRoom;
  private door: NetRoom | null = null;
  private doorCh: Channel<DoorMsg> | null = null;
  /** Host: peers whose password failed, and who is standing at the door. */
  private failed = new Set<string>();
  private atDoor = new Set<string>();
  /**
   * Guest, while joining: what went wrong with which peer. trystero joins every browser to every other, so an error may be
   * about another guest (their network, their typo) and says nothing about the host. Only the host's own failure closes a join.
   */
  private readonly errors = new Map<string, NetError>();
  private lastError: NetError | null = null;
  /** Guest: which peer the host is, as the door told it. */
  private doorHost: string | null = null;
  private pendingError: ReturnType<typeof setTimeout> | null = null;
  private nextLoaded = 0;
  private reconnectLeft = 0;
  private readonly build: string;

  /** `starter` is this player's own pick, which the match handoff uses even if the host's list has not caught up. */
  constructor(private readonly rooms: LobbyRooms, readonly hosting: boolean, private name: string, build = BUILD, options: LobbyOptions = {}, public starter?: StarterGun) {
    this.build = build;
    this.page = options.page ?? null;
    this.where = this.page ? 'loading' : 'lobby';
    reporter.context({ role: hosting ? 'host' : 'guest' });
    report('COOP_STAGE', { stage: hosting ? 'hosting' : 'relays' });
    const room = (this.room = rooms.main);
    const ch = room.channel<Msg>('lobby');
    // What the lobby says keeps its place after the events queued before it (an `end` after the match's last event).
    this.ch = { send: (msg, to) => { this.flushEvents(); ch.send(msg, to); }, on: handler => ch.on(handler) };
    // Latest-wins, 20 a second: unreliable, so a lost pose never holds up the next (or anything else), and none for a peer that is behind.
    this.poses = room.channel<ArrayBuffer>('pose', { unreliable: true, latest: true });
    this.poses.on((data, from) => {
      this.hear(from);
      if (this.phase !== 'open' || !this.match) return;
      const decoded = decodePose(data);
      if (!decoded) return;
      if (this.hosting) {
        const player = this.players.find(p => p.id === from && !p.host && !p.away);
        if (!player) return;
        this.onPose(player.id, decoded.pose);
        // Never trust a guest's claimed slot. Only the host stamps identities on relayed poses.
        const stamped = encodePose(decoded.pose, player.slot);
        for (const p of this.players) if (!p.host && !p.away && p.id !== from) this.poses.send(stamped, p.id);
      } else if (from === this.hostId) {
        const player = this.players.find(p => p.slot === decoded.slot && p.id !== this.you);
        if (player) this.onPose(player.id, decoded.pose);
      }
    });
    if (hosting) {
      this.phase = 'open';
      this.you = HOST_ID;
      for (const [browser, seat] of options.seats ?? []) {
        this.seatOf.set(browser, seat);
        this.seatCount = Math.max(this.seatCount, Number(seat.slice(1)) || 0);
      }
      for (const [seat, slot] of options.slots ?? []) if (typeof seat === 'string' && Number.isInteger(slot) && slot >= 1 && slot < MAX_PLAYERS) this.slotWanted.set(seat, slot);
      this.players = [{ id: HOST_ID, name, ready: false, host: true, slot: 0, seat: 's0', starter, ...(this.page ? { away: true, state: 'loading' as const } : {}) }];
      // The players the lobby sent into this match: seated before they connect, so the barrier can wait for them by name.
      const now = performance.now();
      for (const r of options.roster ?? []) {
        if (this.players.length >= MAX_PLAYERS || !r.browser || this.players.some(p => p.seat === r.seat || p.slot === r.slot)) continue;
        this.seatOf.set(r.browser, r.seat);
        this.seatCount = Math.max(this.seatCount, Number(r.seat.slice(1)) || 0);
        this.players.push({ id: offline(r.seat), name: clean(r.name, NAME_MAX) || 'PLAYER', ready: false, host: false, slot: r.slot, seat: r.seat,
          starter: isStarter(r.starter) ? r.starter : undefined, away: true, state: 'loading' });
        this.lostAt.set(r.seat, now);
      }
      this.openDoor();
    } else {
      // The stage that stalled is the reason: no relay, a host found but never connected, or no lobby at all.
      this.wait = setTimeout(() => this.close(this.timeoutReason()), options.hostWait ?? (this.page ? MATCH_HOST_WAIT_MS : HOST_WAIT_MS));
      this.relayWait = setTimeout(() => this.stage === 'relays' && this.close('relays'), RELAY_WAIT_MS);
      this.knock = setTimeout(() => this.openDoor(), DOOR_AFTER_MS);
    }
    room.onPeerJoin(id => {
      // A lobby that has closed says nothing more, though its room may still be up for a moment (BYE_FLUSH_MS).
      if (this.phase === 'closed') return;
      if (this.phase === 'connecting') { this.unheard.add(id); report('COOP_STAGE', { stage: 'version' }); }
      this.sayHello(id);
    });
    room.onPeerLeave(id => this.peerLeft(id));
    room.onError((error, peerId) => this.netError(error, peerId));
    this.ch.on((msg, from) => {
      this.hear(from);
      if (this.phase !== 'closed' && msg && typeof msg === 'object' && typeof msg.t === 'string') this.receive(msg, from);
    });
    this.beat = setInterval(() => this.heartbeat(), PING_MS);
  }

  private sayHello(to: string): void {
    this.ch.send({ t: 'hello', v: this.build, name: this.name, host: this.hosting, page: this.page, match: this.match?.id ?? null, starter: this.starter,
      born: this.born, browser: this.browser, ...(this.hosting ? { n: this.players.filter(linked).length } : {}) }, to);
  }

  /** Anything at all from a peer is its heartbeat; from a guest's silent host, it is the link coming back. */
  private hear(from: string): void {
    this.heard.set(from, performance.now());
    if (this.reconnecting?.reason === 'lost' && from === this.hostId) {
      this.reconnecting = null;
      console.info('[coop] The link to the host is back.');
      this.onChange();
    }
  }

  /**
   * Every PING_MS, and every game frame: the host pings each guest, runs the load barrier and the seats' clocks; a guest
   * watches its link to the host. Either side forgives silence that was really its own page standing still.
   */
  heartbeat(now = performance.now()): void {
    // A stalled page (sleep, a closed lid, a long hitch) runs this before it has read the messages that queued up
    // meanwhile. Silence measured across the stall is the page's own, so every peer starts from now.
    const stalled = this.lastBeat > 0 && now - this.lastBeat > STALL_MS;
    this.lastBeat = now;
    if (stalled) for (const id of this.heard.keys()) this.heard.set(id, now);
    if (this.phase === 'connecting' && this.stage !== this.lastStage) {
      this.lastStage = this.stage;
      report('COOP_STAGE', { stage: this.lastStage });
      this.onChange();
    }
    if (this.phase !== 'open') return;
    if (!this.hosting) return this.guestBeat(now);
    this.checkHold(now);
    for (const p of [...this.players]) {
      if (p.host) continue;
      const at = this.lostAt.get(p.seat!);
      if (at === undefined) continue;
      if (p.state === 'lost' && now - at > SEAT_GRACE_MS) this.dropSeat(p, `${p.name} left.`);
      else if (p.state === 'loading' && !linked(p) && now - at > LOADING_SEAT_MS) this.dropSeat(p, '');
    }
    // Also called every game frame, which a hidden tab's worker keeps ticking when its timers are throttled.
    if (now < this.nextBeat) return;
    this.nextBeat = now + PING_MS - 50;
    // Another host on this code hears how many players this one has now, so the two always agree on who gives way.
    for (const id of this.rivals) this.sayHello(id);
    for (const p of [...this.players]) {
      if (!linked(p)) continue;
      const last = this.heard.get(p.id) ?? now;
      if (!this.heard.has(p.id)) this.heard.set(p.id, now);
      // A page loading a map is busy, not gone: the barrier judges how long to wait for it, not this rule.
      if (p.state !== 'lost' && now - last > (p.state === 'loading' ? LOADING_SEAT_MS : SILENCE_MS)) { this.seatLost(p, now); continue; }
      this.pings.set(p.id, now);
      this.ch.send({ t: 'ping', n: now }, p.id);
    }
    this.broadcast();
  }

  private guestBeat(now: number): void {
    const r = this.reconnecting;
    if (r) {
      if (now >= r.until) return this.close(r.reason);
      const left = Math.ceil((r.until - now) / 1000);
      if (left !== this.reconnectLeft) { this.reconnectLeft = left; this.onChange(); }
      return;
    }
    // A page busy loading its map cannot answer in time and must not judge the host by what it has not read yet.
    // The same goes for the host's page: while it loads its map it is slow to answer, and its row says so.
    const quiet = this.players.find(p => p.host)?.state === 'loading' ? LOADING_SEAT_MS : QUIET_MS;
    if (this.where !== 'loading' && this.hostId && now - (this.heard.get(this.hostId) ?? now) > quiet) this.hostGone('lost', now);
    this.reconcile(now);
  }

  /**
   * Guest: the host's list is the truth about who is in. If it has this page down as loading or lost while the page is
   * further on (the link dropped and came back, or a message was lost), the page says again where it is.
   */
  private reconcile(now = performance.now()): void {
    const mine = this.me?.state;
    if (this.match && this.page === this.match.id && now >= this.nextLoaded
      && ((this.where === 'in' && mine) || (this.where === 'ready' && (mine === 'loading' || mine === 'lost')))) this.tellLoaded(now);
  }

  /** Seconds left of "Reconnecting to host", 0 when the link is fine. */
  get reconnectIn(): number {
    return this.reconnecting ? Math.max(0, Math.ceil((this.reconnecting.until - performance.now()) / 1000)) : 0;
  }

  /** Guest: the host went silent or its page went away. The room stays open for RECONNECT_MS in case it comes back. */
  private hostGone(reason: 'lost' | 'host-left', now = performance.now()): void {
    if (this.reconnecting) {
      if (reason === 'host-left') this.reconnecting.reason = reason;
      return;
    }
    this.reconnecting = { since: now, until: now + RECONNECT_MS, reason };
    this.reconnectLeft = Math.ceil(RECONNECT_MS / 1000);
    console.warn(`[coop] ${reason === 'lost' ? 'Nothing heard from the host' : 'The host\'s connection closed'}; waiting ${RECONNECT_MS / 1000} s for it to come back.`);
    report('COOP_STAGE', { stage: 'reconnecting', reason });
    this.onChange();
  }

  get stage(): JoinStage {
    if (this.phase === 'open') return 'joined';
    if (this.unheard.size) return 'version';
    const status = this.room.status?.();
    return !status ? 'looking' : !status.relays ? 'relays' : status.trying ? 'connecting' : 'looking';
  }

  /** Host: browsers that found the lobby and are still connecting to it. */
  get trying(): number {
    return this.room.status?.().trying ?? 0;
  }

  /** Host: the guests the start waits on. A lost seat holds nobody up. */
  get notReady(): LobbyPlayer[] {
    return this.players.filter(p => !p.host && !p.ready && p.state !== 'lost');
  }

  /** Host: the guests whose acknowledgement the start is still waiting for, before it changes page. */
  get slowToStart(): LobbyPlayer[] {
    return this.started ? [] : this.players.filter(p => this.starting.has(p.id));
  }

  /** While the load barrier holds: the players the world is waiting for, the host included. */
  get waitingFor(): LobbyPlayer[] {
    return !this.match || this.live ? [] : this.players.filter(p => p.state === 'loading' || p.state === 'ready');
  }

  /**
   * This page is the map page of the match it is running: the only place the load barrier applies. A newcomer there is
   * 'loading' until its own map page says it is in. Anywhere else (the lobby page in the moments before it changes page,
   * and every lobby in the unit tests, which play a match without a page of its own) a newcomer is simply in.
   */
  private get barrier(): boolean {
    return !!this.match && this.page === this.match.id;
  }

  get me(): LobbyPlayer | undefined {
    return this.players.find(p => p.id === this.you);
  }

  setName(name: string): void {
    this.name = clean(name, NAME_MAX) || this.name;
    this.change();
  }

  setStarter(starter: StarterGun): void {
    if (!isStarter(starter) || this.match) return;
    this.starter = starter;
    this.change();
  }

  /** Host: the mode selected in the picker, sent to guests with the list. */
  setPick(mode: CoopMode, map?: CoopMap): void {
    if (!this.hosting) return;
    this.pick = map ? { mode, map } : { mode };
    this.broadcast();
  }

  /** This player is standing still under a menu, or their tab is hidden: the others' tag over them says so. */
  setIdle(idle: Idle | undefined): void {
    if (idle === this.idle) return;
    this.idle = idle;
    this.change();
  }

  /** This player's cheats are on (core/cheats.ts; the page tells the lobby): everyone's list tags them. */
  setCheats(on: boolean): void {
    if (on === this.cheats) return;
    this.cheats = on;
    this.change();
  }

  setReady(ready: boolean): void {
    this.ready = ready;
    this.change();
  }

  say(text: string): void {
    const line = clean(text, CHAT_MAX);
    if (!line || this.phase !== 'open') return;
    if (this.hosting) this.post(this.me?.name ?? this.name, line);
    else if (this.hostId) this.ch.send({ t: 'chat', from: null, text: line }, this.hostId);
  }

  /** Only the host picks the mode. Guests acknowledge before the host changes page. */
  startMatch(mode: CoopMode, id: string = crypto.randomUUID(), map?: CoopMap): boolean {
    if (!this.hosting || this.phase !== 'open' || this.match || !COOP_MODES.includes(mode)) return false;
    if (map !== undefined && !COOP_MAPS.includes(map)) return false;
    // Before anyone is sent off: a host that cannot carry the match to its map page would strand them all.
    const blocked = this.page === id ? '' : this.canStart();
    if (blocked) {
      this.stopCount();
      this.post(null, clean(blocked, CHAT_MAX));
      return false;
    }
    this.stopCount();
    for (const player of this.players) player.starter ??= defaultStarter(mode);
    this.broadcast();
    this.match = map ? { id, mode, map } : { id, mode };
    // The barrier is the map page's: only there is there a world to hold and a click to wait for.
    this.live = this.page !== id;
    this.holdLeft = 0;
    this.beenIn.clear();
    // With no load barrier (not this match's own map page) everyone here is in the world as it starts.
    if (this.page !== id) for (const p of this.players) if (!p.host && !p.away && p.seat) this.beenIn.add(p.seat);
    this.readyAt.clear();
    this.out.clear();
    this.starting = new Set(this.players.filter(p => linked(p) && p.state !== 'lost').map(p => p.id));
    for (const peer of this.starting) this.ch.send({ t: 'start', match: this.match }, peer);
    // One slow or frozen guest must not hold everyone on a dead lobby page: it gets `start` again when it says hello.
    if (this.starting.size) this.ackTimer = setTimeout(() => {
      this.starting.clear();
      this.finishStart();
    }, START_ACK_MS);
    this.onChange();
    this.finishStart();
    return true;
  }

  /**
   * Host: Start counts down COUNTDOWN_S seconds out loud for everyone, then starts. Pressed again, it cancels. It waits for
   * every guest to be ready (false, with a line naming who), and a guest who stops being ready, or joins, stops the count:
   * nobody is carried into a match from the middle of picking a gun.
   */
  countdown(mode: CoopMode, map?: CoopMap, seconds = COUNTDOWN_S): boolean {
    if (!this.hosting || this.phase !== 'open' || this.match) return false;
    if (this.count) {
      this.stopCount();
      this.post(null, 'Start cancelled.');
      return true;
    }
    if (this.notReady.length) {
      this.post(null, `Waiting for ${this.names(this.notReady)} to ready up.`);
      return false;
    }
    this.count = seconds;
    const tick = () => {
      for (const p of this.players) if (linked(p)) this.ch.send({ t: 'count', n: this.count }, p.id);
      this.onChange();
    };
    tick();
    this.counter = setInterval(() => {
      if (--this.count > 0) return tick();
      this.stopCount();
      this.startMatch(mode, undefined, map);
    }, 1000);
    return true;
  }

  /**
   * Host: start now without waiting for the guests who are not ready, after the host confirmed it. They come in with the gun
   * they picked, or the mode's (startMatch). Start with its ready check stays the normal way in.
   */
  forceStart(mode: CoopMode, map?: CoopMap): boolean {
    if (!this.hosting || this.phase !== 'open' || this.match) return false;
    if (this.notReady.length) this.post(null, `The host started without waiting for ${this.names(this.notReady)}.`);
    return this.startMatch(mode, undefined, map);
  }

  private names(players: LobbyPlayer[]): string {
    return players.map(p => p.name).join(', ');
  }

  /** Host: a count running while someone is not ready stops, with why. */
  private holdCount(): void {
    if (!this.count || !this.notReady.length) return;
    this.stopCount();
    this.post(null, `Start cancelled: ${this.names(this.notReady)} not ready.`);
  }

  private stopCount(): void {
    if (this.counter) clearInterval(this.counter);
    this.counter = null;
    const was = this.count;
    this.count = 0;
    if (was) for (const p of this.players) if (linked(p)) this.ch.send({ t: 'count', n: 0 }, p.id);
  }

  /** Host: the match is over for everyone, and the room stays open for the next one. */
  endMatch(): void {
    if (!this.hosting || !this.match) return;
    this.match = null;
    this.started = false;
    this.starting.clear();
    this.backToLobbyPage();
    this.beenIn.clear();
    this.readyAt.clear();
    this.out.clear();
    // A seat nobody ever connected to is nobody on the lobby page; a lost one keeps its grace.
    this.players = this.players.filter(p => p.host || linked(p));
    for (const p of this.players) {
      if (p.state === 'lost') continue;
      p.away = false;
      p.state = undefined;
      this.lostAt.delete(p.seat!);
      if (linked(p)) this.ch.send({ t: 'end' }, p.id);
    }
    this.broadcast();
  }

  /** This page is a lobby page again: no match to its name, so the next match's pages tell it from their own host (`hello`). */
  private backToLobbyPage(): void {
    this.page = null;
    this.where = 'lobby';
    this.live = false;
    this.holdLeft = 0;
  }

  /** Guest: back to the lobby page while the host plays on (`back` false), or back into that match (`back` true). */
  away(back: boolean): void {
    if (this.hosting || !this.hostId || this.phase !== 'open') return;
    if (!back && this.match) {
      this.awayFrom = this.match;
      this.match = null;
      this.backToLobbyPage();
    }
    if (back) this.awayFrom = null;
    this.ch.send({ t: 'away', back }, this.hostId);
  }

  /** This page's map has booted: the player is at "Click to deploy". The lobby's liveness rules apply to it again. */
  booted(): void {
    if (this.where !== 'loading') return;
    this.where = 'ready';
    this.tellLoaded();
  }

  /** The player clicked Deploy and is in the world. The host's world waits for every player's (the load barrier). */
  deployed(): void {
    if (this.where !== 'loading' && this.where !== 'ready') return;
    this.where = 'in';
    this.tellLoaded();
  }

  private tellLoaded(now = performance.now()): void {
    this.nextLoaded = now + 1000;
    const click = this.where === 'in';
    if (!this.hosting) {
      if (this.hostId && this.match) this.ch.send({ t: 'loaded', click, id: this.match.id }, this.hostId);
      return;
    }
    const me = this.me;
    if (!me || !this.match) return;
    me.state = click ? undefined : 'ready';
    me.away = !click;
    if (click) this.holdFrom = now;
    this.broadcast();
    this.checkHold(now);
  }

  /**
   * Host, the load barrier: the world starts when every player expected in this match is in it. Nobody waits for ever: a
   * player still loading gets LOAD_WAIT_MS from the host's own deploy, one sitting at "Click to deploy" CLICK_WAIT_MS, and
   * a lost seat nothing. Whoever is missing then is named, and comes in as a late joiner with the full catch-up.
   */
  private checkHold(now = performance.now()): void {
    if (!this.hosting || !this.match || this.live || this.phase !== 'open' || this.page !== this.match.id) return;
    const me = this.me;
    if (!me || me.state) return;
    let wait = 0;
    const missing: LobbyPlayer[] = [];
    for (const p of this.players) {
      if (p.host || (p.state !== 'loading' && p.state !== 'ready')) continue;
      missing.push(p);
      const ready = p.state === 'ready' ? this.readyAt.get(p.seat!) : undefined;
      const until = Math.min(this.holdFrom + LOAD_WAIT_MS, ready === undefined ? Infinity : Math.max(ready, this.holdFrom) + CLICK_WAIT_MS);
      wait = Math.max(wait, until - now);
    }
    if (missing.length && wait > 0) {
      const left = Math.ceil(wait / 1000);
      if (left !== this.holdLeft) { this.holdLeft = left; this.broadcast(); }
      return;
    }
    this.live = true;
    this.holdLeft = 0;
    if (missing.length) this.post(null, `Started without ${this.names(missing)}: not in yet. They join when they arrive.`);
    else this.broadcast();
    console.info(`[coop] The world starts${missing.length ? ` without ${this.names(missing)}` : ': everyone is in'}.`);
    this.onGo();
  }

  sendPose(pose: Pose): void {
    if (this.phase !== 'open' || !this.match || !this.me) return;
    const data = encodePose(pose, this.me.slot);
    if (this.hosting) {
      for (const p of this.players) if (!p.host && !p.away) this.poses.send(data, p.id);
    } else if (this.hostId && !this.reconnecting) this.poses.send(data, this.hostId);
  }

  /**
   * A lane for the match: `receive` hears only the match's players (a guest only the host), and the returned function sends to
   * them (a guest to the host) and says to how many. Objects travel wrapped with the match id; bytes travel as they are.
   * This is the lane for bytes of the game's own making (the enemy snapshots). Events go through `events`, which batches.
   * `options` picks the lane kind (room.ts): `{ unreliable: true }` for latest-wins bytes that must never wait on a lost packet
   * (they may arrive out of order, or not at all), and `latest: true` to skip a peer that is behind. The default is reliable.
   */
  gameplay<T>(name: string, receive: (data: T, from: string) => void, options?: ChannelOptions): (data: T, to?: string) => number {
    const channel = this.room.channel<{ match: string; data: T } | ArrayBuffer | Uint8Array>(name, options);
    channel.on((message, from) => {
      this.hear(from);
      if (this.phase !== 'open' || !this.match) return;
      const binary = message instanceof ArrayBuffer ? message : message instanceof Uint8Array ? message.slice().buffer : null;
      if (!binary && (message as { match: string } | null)?.match !== this.match.id) return;
      if (this.hosting ? this.players.some(player => !player.host && !player.away && player.id === from) : from === this.hostId) receive((binary ?? (message as { data: T }).data) as T, from);
    });
    return (data, to) => {
      if (this.phase !== 'open' || !this.match) return 0;
      const message = data instanceof ArrayBuffer ? data : { match: this.match.id, data };
      if (!this.hosting) {
        if (!this.hostId) return 0;
        channel.send(message, this.hostId);
        return 1;
      }
      // Called for every snapshot chunk to every guest: no list of recipients is built.
      let count = 0;
      for (const player of this.players) {
        if (player.host || player.away || (to && player.id !== to)) continue;
        channel.send(message, player.id);
        count++;
      }
      return count;
    };
  }

  /**
   * A reliable lane of events for the match, batched: `receive` hears each event of the match's players (a guest only the
   * host's), with its size on the wire, in the order they were sent; `send` queues one. `packer` gives some events a
   * packed form (batch.ts). Until `batching` is called an event leaves as it is queued, a batch of one.
   */
  events<T>(name: string, receive: (data: T, from: string, bytes: number) => void, packer?: Packer<T>): EventLane<T> {
    const channel = this.room.channel<Uint8Array | ArrayBuffer>(name);
    const writer = new RecordWriter<T>(packer);
    const batcher = new Batcher((batch, to) => channel.send(batch, to));
    this.batchers.push(batcher);
    const allowed = (from: string): boolean => this.phase === 'open' && !!this.match
      && (this.hosting ? this.players.some(player => !player.host && !player.away && player.id === from) : from === this.hostId);
    channel.on((message, from) => {
      this.hear(from);
      if (!allowed(from) || batchTag(message) !== this.matchTag()) return;
      readBatch(message, (kind, payload, size) => {
        // An event may end the match or send its sender away: the rest of its batch is then nobody's.
        if (!allowed(from)) return false;
        const event = kind === KIND_JSON ? readJson(payload) : packer?.unpack(kind, payload) ?? undefined;
        if (event === undefined) return;
        try { receive(event as T, from, size); }
        catch (error) { console.warn('[coop] Dropped an event that could not be applied', error); }
      });
    });
    const lane = {
      bytes: 0,
      send: (data: T, to?: string, except?: string, cosmetic = false): number => {
        if (this.phase !== 'open' || !this.match) return 0;
        const record = writer.encode(data);
        if (!record) return 0;
        lane.bytes = record.end - record.start;
        const tag = this.matchTag();
        let count = 0;
        if (!this.hosting) {
          if (this.hostId && !(cosmetic && this.pressure.drops(this.hostId))) { batcher.add(record, this.hostId, tag); count = 1; }
        } else for (const player of this.players) {
          if (player.host || player.away || (to !== undefined && player.id !== to) || player.id === except) continue;
          if (cosmetic && this.pressure.drops(player.id)) continue;
          batcher.add(record, player.id, tag);
          count++;
        }
        if (count === 0) return 0;
        if (!this.defer) this.flushEvents();
        else if (!this.flushDue) {
          this.flushDue = true;
          this.defer(() => this.flushEvents());
        }
        return count;
      },
    };
    return lane;
  }

  /**
   * Turns batching on: queued events leave together when `defer` runs its callback. The game passes `queueMicrotask`, so
   * everything one frame (or one arriving message) produced goes out as one message per peer, at the end of that frame's
   * script, before the page draws. Unit tests leave it off and read each event as it is sent.
   */
  batching(defer: ((run: () => void) => void) | null): void {
    this.flushEvents();
    this.defer = defer;
  }

  /** Sends every queued event now, a message per peer. Also run before anything the lobby itself says, and before it closes. */
  flushEvents(): void {
    this.flushDue = false;
    if (this.batchers.length === 0) return;
    const now = performance.now();
    let sent = false;
    for (const batcher of this.batchers) if (batcher.waiting) { batcher.flush(to => this.mayFlush(to, now)); sent = true; }
    if (sent) metrics.spend('coop.flush', performance.now() - now);
  }

  private matchTag(): number {
    const id = this.match?.id ?? '';
    if (this.tagOf.id !== id) this.tagOf = { id, tag: matchTag(id) };
    return this.tagOf.tag;
  }

  /** Is this peer still worth queueing for? Judges its backlog first; a stalled guest is cut here and gets nothing more. */
  private mayFlush(peer: string, now: number): boolean {
    if (!this.room.buffered) return true;
    const verdict = this.pressure.judge(peer, this.room.buffered(peer, false), this.room.failed?.(peer) ?? 0, now);
    if (verdict !== 'stalled' || !this.hosting) return true;
    const player = this.players.find(p => p.id === peer);
    if (player) this.stall(player);
    return false;
  }

  /**
   * Host: a guest's reliable queue has grown past what the link will ever catch up on, or the transport has lost a
   * message to it. Nothing more is queued for it: the seat is treated as lost (the world goes on for the others, the
   * body leaves it) and comes back, with everything it missed, when the queue has drained and the guest is heard again
   * (`seatBack`). If the link is gone for good the seat's grace and the silence rule end it as they always did.
   */
  private stall(player: LobbyPlayer): void {
    if (player.host || player.away || player.state) return;
    this.stalled.add(player.id);
    console.warn(`[coop] ${player.name} is too far behind (${Math.round((this.room.buffered?.(player.id, false) ?? 0) / 1024)} KB queued, ${this.room.failed?.(player.id) ?? 0} lost): held out of the match until the link catches up.`);
    report('COOP_PEER_LEFT', { reason: 'stalled' });
    this.seatLost(player, performance.now(), `${player.name} fell behind (a slow connection).`);
  }

  /** Host: a seat cut by `stall` whose queue has not drained yet stays out, whatever is heard from it. */
  private held(player: LobbyPlayer): boolean {
    if (!this.stalled.has(player.id)) return false;
    return !this.pressure.clear(player.id, this.room.buffered?.(player.id, false) ?? 0);
  }

  /**
   * Backpressure: is this player's connection behind, with more queued for it than the network has taken? A sender of
   * latest-wins data skips them this time. `unreliable` picks the lane kind asked about.
   */
  behind(id: string, unreliable = true): boolean {
    const peer = id === HOST_ID ? this.hostId : id;
    return !!peer && (this.room.buffered?.(peer, unreliable && this.room.fast?.(peer) !== false) ?? 0) > BEHIND_BYTES;
  }

  /** Who answers for which peer id: lets the game drop lanes from guests who have gone back to the lobby. */
  inMatch(id: string): boolean {
    const p = this.players.find(player => player.id === id);
    return !!p && !p.away;
  }

  private finishStart(): void {
    if (this.match && !this.starting.size && !this.started) {
      this.started = true;
      if (this.ackTimer) clearTimeout(this.ackTimer);
      this.ackTimer = null;
      this.onMatch(this.match);
    }
  }

  /** A deliberate quit: the other side is told, so it reads "left" there and not a lost connection. */
  leave(): void {
    let told = false;
    if (this.phase === 'open') {
      if (!this.hosting) { if (this.hostId) { this.ch.send({ t: 'bye' }, this.hostId); told = true; } }
      else for (const p of this.players) if (linked(p)) { this.ch.send({ t: 'bye' }, p.id); told = true; }
    }
    this.close(null, told ? BYE_FLUSH_MS : 0);
  }

  /** Host: a line from the lobby itself (amber, no name), for everyone. */
  notice(text: string): void {
    if (this.hosting && this.phase === 'open') this.post(null, clean(text, CHAT_MAX));
  }

  /** The players' round trips, as the host measured them. */
  pingOf(id: string): number | undefined {
    return this.players.find(p => p.id === id)?.ping;
  }

  /** Host: the stable id of a guest's browser (hello carries it), '' when unknown. What the team keeps a returning player's seat under. */
  browserOf(id: string): string {
    const seat = this.players.find(p => p.id === id)?.seat;
    if (seat) for (const [browser, held] of this.seatOf) if (held === seat) return browser;
    return '';
  }

  /** Host: what the map page needs to know about who is coming, and every seat this room has given out (session.ts). */
  seatRecords(): { roster: SeatRecord[]; seats: [string, string][]; slots: [string, number][] } {
    const browserOf = new Map([...this.seatOf].map(([browser, seat]) => [seat, browser]));
    const roster: SeatRecord[] = [];
    for (const p of this.players) {
      const browser = browserOf.get(p.seat ?? '');
      // Away by choice (on the lobby page while a match runs) is not coming; they step back in when they like.
      if (p.host || !browser || (p.away && !p.state)) continue;
      roster.push({ browser, seat: p.seat!, name: p.name, slot: p.slot, ...(p.starter ? { starter: p.starter } : {}) });
    }
    for (const p of this.players) if (!p.host && p.seat) this.slotWanted.set(p.seat, p.slot);
    return { roster, seats: [...this.seatOf], slots: [...this.slotWanted] };
  }

  /**
   * Guest, after the host is gone for good: who hosts the new lobby on the same code. The players the host last listed,
   * without the host and without anyone already lost, in slot order: the first hosts, the rest join, and `rank` is this
   * player's place in that line (the wait before taking over if nobody ahead of them shows up).
   */
  successors(): { rank: number; names: string[] } {
    const line = this.players.filter(p => !p.host && p.state !== 'lost').sort((a, b) => a.slot - b.slot);
    const rank = line.findIndex(p => p.id === this.you);
    return { rank: Math.max(0, rank), names: line.map(p => p.name) };
  }

  /** Sends this player's own name and ready, kept here: the list from the host can lag a change still on its way. */
  private change(): void {
    const me = this.me;
    if (this.hosting && me) {
      me.name = this.uniqueName(this.name, me);
      me.ready = this.ready;
      me.idle = this.idle;
      me.cheats = this.cheats || undefined;
      if (!this.match) me.starter = this.starter;
      this.broadcast();
    } else if (this.hostId) {
      this.ch.send({ t: 'set', name: this.name, ready: this.ready, starter: this.starter, idle: this.idle, ...(this.cheats ? { cheats: true } : {}) }, this.hostId);
    }
  }

  /** Host: no two players under one callsign. The second VIPER-27 is "VIPER-27 (2)". */
  private uniqueName(name: string, self?: LobbyPlayer): string {
    const taken = (n: string) => this.players.some(p => p !== self && p.name === n);
    if (!taken(name)) return name;
    for (let i = 2; i <= MAX_PLAYERS + 1; i++) {
      const tag = ` (${i})`;
      const candidate = name.slice(0, NAME_MAX - tag.length) + tag;
      if (!taken(candidate)) return candidate;
    }
    return name;
  }

  private receive(msg: Msg, from: string): void {
    if (msg.t === 'hello') this.hello(msg, from);
    else if (this.hosting) this.fromGuest(msg, from);
    else if (from === this.hostId) this.fromHost(msg);
  }

  /**
   * Which page is talking. A match is played on a fresh page per player, so around every start two pages of the host exist
   * for a moment: the lobby page it is leaving (`match` set, `page` not that match) and the map page it is going to
   * (`page` equal to `match`). A guest already on a map page takes only a host that is not on its way out; a host on its
   * way out leaves the guests arriving for its next page alone. `page` is a match id, not a flag, so the same rule holds
   * for the second and third match in a room, when every lobby page was once a map page.
   */
  private hello(msg: Extract<Msg, { t: 'hello' }>, from: string): void {
    const sameBuild = msg.v === this.build;
    if (this.hosting) {
      if (this.match && this.page !== this.match.id && msg.page === this.match.id) return;
      if (msg.host) return this.otherHost(msg, from);
      this.admit(msg, from, sameBuild);
      return;
    }
    this.unheard.delete(from);
    if (!msg.host) return;
    const leaving = typeof msg.match === 'string' && msg.page !== msg.match;
    if (leaving && this.page) return;
    // A second host on the code is not ours, unless ours is gone and this is its new page (or the same page, reconnected).
    if (this.hostId && this.hostId !== from && !this.reconnecting) return;
    // And then only the host this page knew: the same browser, by its id. Anyone else who says "host" while the link is in
    // trouble is a stranger (or a teammate's regrouped lobby, which this page joins on purpose once its own host is given up).
    const theirs = typeof msg.browser === 'string' ? msg.browser.slice(0, 64) : '';
    if (this.hostId && this.hostId !== from && this.hostBrowser && theirs !== this.hostBrowser) return;
    if (!sameBuild) {
      if (this.phase !== 'connecting') return;
      this.theirBuild = clean(msg.v, 40);
      return this.close('version');
    }
    const first = this.phase === 'connecting';
    this.hostId = from;
    this.hostBrowser = theirs;
    this.phase = 'open';
    if (this.reconnecting) console.info('[coop] The host is back.');
    this.reconnecting = null;
    if (first) {
      report('COOP_CONNECTED', { stage: 'joined' });
      this.clearWait();
      this.shutDoor();
    } else {
      // The host's new connection knows nothing this page said to the old one.
      this.ch.send({ t: 'set', name: this.name, ready: this.ready, starter: this.starter, idle: this.idle, ...(this.cheats ? { cheats: true } : {}) }, from);
      this.nextLoaded = 0;
    }
    this.onChange();
  }

  /**
   * Host: another host on this code. One room has one host, so one of the two gives way (closes with 'code-taken'; its page
   * then joins the other as a guest, ui/screens/coop.ts and index.ts) and nobody is left alone in a lobby of their own:
   *  - a host with nobody connected to it gives way to one that has players;
   *  - of two with nobody, the newer gives way (`born`).
   * Both ends work it out from the same two hellos, which each repeats on its heartbeat (`rivals`), so the count of players
   * each acts on is the other's of now. Two hosts that both have players stay as they are: there is no merging two rooms.
   *
   * How two hosts meet: a new lobby opened on a code in use; a regroup where two took over at once; and a host whose page
   * reloaded for longer than its guests waited, coming back (as a host on its map page, or on its lobby page) to find them
   * regrouped under a new host.
   */
  private otherHost(msg: Extract<Msg, { t: 'hello' }>, from: string): void {
    // This player's own other page (the lobby page being left, the map page being loaded) is no rival.
    if (this.browser && msg.browser === this.browser) return;
    // Nor is a host on its way out to a map page: it is about to be gone, and its next page speaks for itself.
    if ((typeof msg.match === 'string' && msg.page !== msg.match) || (this.match && this.page !== this.match.id)) return;
    this.rivals.add(from);
    const mine = this.players.filter(linked).length;
    const theirs = Number.isInteger(msg.n) && msg.n! > 0 ? msg.n! : 0;
    if (mine > 0 || !(theirs > 0 || Number(msg.born) < this.born)) return;
    this.yieldedTo = clean(msg.name, NAME_MAX);
    console.info(`[coop] Another host${this.yieldedTo ? ` (${this.yieldedTo})` : ''} has this code${theirs ? ` with ${theirs} player${theirs === 1 ? '' : 's'}` : ''}; this lobby gives way.`);
    this.close('code-taken');
  }

  /** Host: a guest's hello. The same browser takes its own seat back (a reload, a reconnect, another tab); a new one gets a seat. */
  private admit(msg: Extract<Msg, { t: 'hello' }>, from: string, sameBuild: boolean): void {
    const now = performance.now();
    const browser = typeof msg.browser === 'string' ? msg.browser.slice(0, 64) : '';
    const known = browser ? this.seatOf.get(browser) : undefined;
    const seated = this.players.find(p => p.id === from) ?? (known ? this.players.find(p => !p.host && p.seat === known) : undefined);
    // The same connection saying hello twice changes nothing.
    if (seated && seated.id === from && seated.state !== 'lost') return;
    const wanted = clean(msg.name, NAME_MAX) || 'PLAYER';
    // The guest sees the mismatch on its own side and stops; the host only notes it.
    if (!sameBuild) {
      report('COOP_VERSION_MISMATCH', { stage: 'host-version' });
      return this.post(null, `${wanted} could not join: different game version. They need to reload.`);
    }
    // A guest's hello is answered with the host's own. The one sent as the connection came up can be missed by a page that
    // left this room and came straight back (a host that gave way and rejoined as a guest, over real WebRTC, never heard
    // it and gave up with "lobby not found"): a guest that hears nothing from a host has no host.
    this.sayHello(from);
    if (seated) {
      const was = seated.state;
      // The same connection found again (the transport dropped the link and remade it under the same id): the same page.
      const sameLink = seated.id === from;
      if (!sameLink) this.pings.delete(seated.id);
      this.heard.delete(seated.id);
      this.starting.delete(seated.id);
      seated.id = from;
      seated.name = this.uniqueName(wanted, seated);
      this.heard.set(from, now);
      this.lostAt.delete(seated.seat!);
      report('COOP_CONNECTED', { stage: 'guest-back' });
      if (this.match && this.out.has(seated.seat!) && msg.page !== this.match.id) {
        // They chose the lobby page; a reconnect leaves them there.
        seated.away = true;
        seated.state = undefined;
        if (was === 'lost') this.post(null, `${seated.name} reconnected.`);
        else this.broadcast();
      } else if (this.match && this.barrier) {
        // A fresh connection is not in the world until its page says so (`loaded`).
        this.out.delete(seated.seat!);
        seated.away = true;
        seated.state = 'loading';
        this.readyAt.delete(seated.seat!);
        this.broadcast();
        this.ch.send({ t: 'start', match: this.match }, from);
      } else if (this.match) {
        this.out.delete(seated.seat!);
        seated.away = false;
        seated.state = undefined;
        if (was === 'lost') this.post(null, `${seated.name} is back.`);
        else this.broadcast();
        this.ch.send({ t: 'start', match: this.match }, from);
        if (sameLink) this.cameIn(seated);
      } else {
        seated.away = false;
        seated.state = undefined;
        if (isStarter(msg.starter)) seated.starter = msg.starter;
        if (was === 'lost') this.post(null, `${seated.name} reconnected.`);
        else this.broadcast();
      }
      this.finishStart();
      return;
    }
    if (this.players.length >= MAX_PLAYERS) {
      // A lost player's seat never keeps a live one out: the one lost longest makes room.
      const ghost = this.players.filter(p => p.state === 'lost' || (p.state === 'loading' && !linked(p) && !p.host))
        .sort((a, b) => (this.lostAt.get(a.seat!) ?? 0) - (this.lostAt.get(b.seat!) ?? 0))[0];
      if (ghost) this.dropSeat(ghost, ghost.state === 'lost' ? `${ghost.name} left.` : '');
    }
    if (this.players.length >= MAX_PLAYERS) {
      report('COOP_FULL', { stage: 'host-admission' });
      this.ch.send({ t: 'full' }, from);
      return this.post(null, `${wanted} could not join: the lobby is full.`);
    }
    const seat = known ?? `s${++this.seatCount}`;
    const free = (s: number) => !this.players.some(p => p.slot === s);
    // The slot this seat had before (the host's page was reloaded, or they left and came back), when nobody has it now, and
    // otherwise the first one no seat still to come back is waiting for.
    const had = this.slotWanted.get(seat);
    const kept = new Set([...this.slotWanted].filter(([other]) => other !== seat && !this.players.some(p => p.seat === other)).map(([, s]) => s));
    const slot = (had !== undefined && free(had) ? had : undefined) ?? [1, 2, 3].find(s => free(s) && !kept.has(s)) ?? [1, 2, 3].find(free)!;
    this.slotWanted.set(seat, slot);
    if (browser) this.seatOf.set(browser, seat);
    const name = this.uniqueName(wanted);
    report('COOP_CONNECTED', { stage: 'guest-joined' });
    this.players.push({ id: from, name, ready: false, host: false, slot, seat, starter: isStarter(msg.starter) ? msg.starter : undefined,
      ...(this.barrier ? { away: true, state: 'loading' as const } : {}) });
    this.heard.set(from, now);
    this.post(null, this.barrier ? `${name} is joining…` : this.match ? `${name} joined the match in progress.` : `${name} joined.`);
    this.holdCount();
    if (this.match) this.ch.send({ t: 'start', match: this.match }, from);
  }

  /**
   * Host, with no load barrier: the same connection back mid-match is the same page, whose world never went away, so the
   * seat's return is said here. Behind the barrier it is said when the page says it is in (`loaded`); a new page with no
   * barrier is known by its first card (team.ts).
   */
  private cameIn(player: LobbyPlayer): void {
    const rejoin = this.beenIn.has(player.seat!);
    this.beenIn.add(player.seat!);
    this.onSeat(player, { kind: 'in', rejoin });
  }

  private fromGuest(msg: Msg, from: string): void {
    const player = this.players.find(p => p.id === from);
    if (!player) return;
    // A seat given up as lost whose connection was only slow: it is back, and its page says where it is (`loaded`).
    if (player.state === 'lost' && msg.t !== 'bye' && !this.held(player)) this.seatBack(player);
    if (msg.t === 'started' && msg.id === this.match?.id) {
      this.starting.delete(from);
      this.finishStart();
    } else if (msg.t === 'set') {
      player.name = this.uniqueName(clean(msg.name, NAME_MAX) || player.name, player);
      player.ready = msg.ready === true;
      player.idle = idleOf(msg.idle);
      player.cheats = msg.cheats === true || undefined;
      if (!this.match) player.starter = isStarter(msg.starter) ? msg.starter : undefined;
      this.broadcast();
      this.holdCount();
    } else if (msg.t === 'chat') {
      const text = clean(msg.text, CHAT_MAX);
      if (text) this.post(player.name, text);
    } else if (msg.t === 'pong' && msg.n === this.pings.get(from)) {
      player.ping = Math.round(Math.min(9999, Math.max(0, performance.now() - msg.n)));
    } else if (msg.t === 'away' && typeof msg.back === 'boolean') {
      if (msg.back ? !player.away || !!player.state : player.away === true && !player.state) return;
      if (!msg.back) {
        player.away = true;
        player.state = undefined;
        this.out.add(player.seat!);
        this.post(null, `${player.name} went back to the lobby.`);
        this.checkHold();
      } else if (this.match && this.barrier) {
        // On their way in: their page loads the map and says so; "is back" is posted when they are.
        this.out.delete(player.seat!);
        player.state = 'loading';
        this.readyAt.delete(player.seat!);
        this.broadcast();
        this.ch.send({ t: 'start', match: this.match }, from);
      } else if (this.match) {
        this.out.delete(player.seat!);
        player.away = false;
        this.post(null, `${player.name} is back in the match.`);
        this.ch.send({ t: 'start', match: this.match }, from);
      }
    } else if (msg.t === 'loaded' && typeof msg.click === 'boolean' && this.match && msg.id === this.match.id) {
      // A seat cut for its backlog comes back when the backlog has drained (`seatBack`, above), not because its page says it is in.
      if (!this.stalled.has(player.id)) this.loaded(player, msg.click);
    } else if (msg.t === 'bye') {
      this.byes.add(from);
      this.dropSeat(player, `${player.name} left.`);
    }
  }

  /** Host: a guest's page has booted (`click` false) or is in the world (`click` true). */
  private loaded(player: LobbyPlayer, click: boolean): void {
    const now = performance.now();
    if (!click) {
      if (player.state !== 'loading') return;
      player.state = 'ready';
      this.readyAt.set(player.seat!, now);
      this.broadcast();
      return this.checkHold(now);
    }
    // Already in, or stepped out to the lobby page by choice and never asked back in (a stale word from the page they left).
    if (!player.state) return;
    player.away = false;
    player.state = undefined;
    this.lostAt.delete(player.seat!);
    const rejoin = this.beenIn.has(player.seat!);
    this.beenIn.add(player.seat!);
    if (rejoin) this.post(null, `${player.name} is back.`);
    else if (this.live) this.post(null, `${player.name} joined.`);
    else this.broadcast();
    this.onSeat(player, { kind: 'in', rejoin });
    this.checkHold(now);
  }

  private fromHost(msg: Msg): void {
    if (msg.t === 'ping' && Number.isFinite(msg.n)) return this.ch.send({ t: 'pong', n: msg.n }, this.hostId!);
    if (msg.t === 'full') return this.close('full');
    if (msg.t === 'bye') return this.close('host-left');
    if (msg.t === 'count' && Number.isInteger(msg.n) && msg.n >= 0 && msg.n <= 30) {
      this.count = msg.n;
      return this.onChange();
    }
    if (msg.t === 'end') return this.ended();
    if (msg.t === 'start' && validMatch(msg.match)) {
      // A duplicate start (or a late join) must never reset a live run: the same match again only gets its acknowledgement.
      const fresh = this.match?.id !== msg.match.id;
      this.match = msg.match;
      this.awayFrom = null;
      this.ch.send({ t: 'started', id: msg.match.id }, this.hostId!);
      if (fresh) this.onMatch(msg.match);
    } else if (msg.t === 'lobby' && Array.isArray(msg.players)) {
      // The host has no match on, and this page still thinks it is in (or loading) one: the `end` was never heard.
      if (msg.on === null && (this.match || this.page)) this.ended();
      this.you = clean(msg.you, 64);
      const pick = msg.pick;
      if (pick && COOP_MODES.includes(pick.mode) && (pick.map === undefined || COOP_MAPS.includes(pick.map))) this.pick = pick.map ? { mode: pick.mode, map: pick.map } : { mode: pick.mode };
      this.players = msg.players.slice(0, 8).map(p => ({
        id: clean(p?.id, 64),
        name: clean(p?.name, NAME_MAX) || 'PLAYER',
        ready: p?.ready === true,
        ping: Number.isFinite(p?.ping) ? Math.max(0, Math.min(9999, Math.round(p.ping!))) : undefined,
        away: p?.away === true,
        starter: isStarter(p?.starter) ? p.starter : undefined,
        host: p?.host === true,
        slot: Number.isInteger(p?.slot) && p.slot >= 0 && p.slot < MAX_PLAYERS ? p.slot : -1,
        seat: clean(p?.seat, 16) || undefined,
        state: SEAT_STATES.includes(p?.state as SeatState) ? p.state : undefined,
        idle: idleOf(p?.idle),
        cheats: p?.cheats === true || undefined,
      }));
      this.holdLeft = Number.isFinite(msg.holdLeft) ? Math.max(0, Math.min(999, Math.round(msg.holdLeft!))) : 0;
      const live = msg.live === true;
      const go = live && !this.live && !!this.match;
      this.live = live;
      if (go) this.onGo();
      this.reconcile();
      this.onChange();
    } else if (msg.t === 'chat') {
      const text = clean(msg.text, CHAT_MAX);
      if (text) this.addLine(msg.from === null ? null : clean(msg.from, NAME_MAX), text);
    }
  }

  /** Guest: the host's match is over. */
  private ended(): void {
    this.match = this.awayFrom = null;
    this.started = false;
    this.backToLobbyPage();
    this.onEnd();
    this.onChange();
  }

  /** A connection that is gone: what was queued for it, and what was held against it, go with it. */
  private forgetPeer(id: string): void {
    for (const batcher of this.batchers) batcher.forget(id);
    this.pressure.forget(id);
    this.stalled.delete(id);
  }

  private peerLeft(id: string): void {
    this.rivals.delete(id);
    this.pings.delete(id);
    this.forgetPeer(id);
    if (!this.hosting) {
      this.unheard.delete(id);
      // Not the end yet: a dropped link comes back more often than not (RECONNECT_MS).
      if (id === this.hostId && this.phase === 'open') this.hostGone('host-left');
      return;
    }
    const player = this.players.find(p => p.id === id);
    if (!player) return;
    report('COOP_PEER_LEFT', { reason: 'peer-left-or-timeout' });
    if (this.byes.delete(id)) return this.dropSeat(player, `${player.name} left.`);
    this.seatLost(player);
  }

  /**
   * Host: a guest's connection is gone, or silent too long. In a match its seat is kept (slot, and whatever the game holds
   * by seat) for SEAT_GRACE_MS; the body leaves the world meanwhile, so nothing targets it and no wipe waits on it.
   */
  private seatLost(player: LobbyPlayer, now = performance.now(), line = `${player.name} lost connection.`): void {
    if (player.state === 'lost') return;
    this.heard.delete(player.id);
    this.starting.delete(player.id);
    // This lobby page sent it off to load the map and is still waiting for the others' word: its old page going away is the
    // plan, not a loss.
    const sentOff = !!this.match && this.page !== this.match.id && !this.started;
    // A page still loading that drops (the lobby page of a late joiner, a crash mid-boot) was never in: keep the seat, quietly.
    if (sentOff || player.state === 'loading' || player.state === 'ready') {
      if (!sentOff) {
        player.id = offline(player.seat!);
        player.state = 'loading';
        this.lostAt.set(player.seat!, now);
        this.broadcast();
        this.checkHold(now);
      }
      return this.finishStart();
    }
    const wasIn = !player.away;
    player.state = 'lost';
    player.away = true;
    player.ready = false;
    this.lostAt.set(player.seat!, now);
    this.post(null, line);
    if (wasIn && this.match) this.onSeat(player, { kind: 'lost' });
    this.finishStart();
    this.checkHold(now);
  }

  /** Host: a lost seat's own connection answers again. */
  private seatBack(player: LobbyPlayer): void {
    this.lostAt.delete(player.seat!);
    this.stalled.delete(player.id);
    if (this.match && this.out.has(player.seat!)) {
      player.state = undefined;
      this.post(null, `${player.name} reconnected.`);
    } else if (this.match && this.barrier) {
      player.state = 'loading';
      this.broadcast();
      this.ch.send({ t: 'start', match: this.match }, player.id);
    } else {
      player.state = undefined;
      player.away = false;
      this.post(null, `${player.name} reconnected.`);
      if (this.match) this.cameIn(player);
    }
  }

  /** Host: the seat is given up. `line` is what the lobby says about it, if anything. */
  private dropSeat(player: LobbyPlayer, line: string): void {
    if (!this.players.includes(player)) return;
    this.heard.delete(player.id);
    this.starting.delete(player.id);
    this.lostAt.delete(player.seat!);
    this.readyAt.delete(player.seat!);
    this.out.delete(player.seat!);
    // Their slot is free for whoever comes next; it is held only for seats still to come back to a reopened lobby.
    this.slotWanted.delete(player.seat!);
    this.pings.delete(player.id);
    this.players = this.players.filter(p => p !== player);
    this.forgetPeer(player.id);
    if (line) this.post(null, line);
    else this.broadcast();
    this.onSeat(player, { kind: 'gone' });
    this.finishStart();
    this.checkHold();
  }

  private openDoor(): void {
    if (this.door) return;
    const door = (this.door = this.rooms.door());
    const ch = (this.doorCh = door.channel<DoorMsg>('door'));
    if (this.hosting) {
      door.onPeerJoin(id => {
        this.atDoor.add(id);
        // Who the host is: a joining guest can then tell the host's own failure from another guest's.
        ch.send({ t: 'host' }, id);
        if (this.failed.has(id)) ch.send({ t: 'wrong' }, id);
      });
      door.onPeerLeave(id => this.atDoor.delete(id));
    } else {
      ch.on((msg, from) => {
        if (this.phase !== 'connecting') return;
        if (msg?.t === 'wrong') return this.close('password');
        if (msg?.t !== 'host') return;
        this.doorHost = from;
        const error = this.errors.get(from);
        if (error) this.close(error);
      });
    }
  }

  private shutDoor(): void {
    if (this.knock) clearTimeout(this.knock);
    if (this.pendingError) clearTimeout(this.pendingError);
    this.knock = this.pendingError = null;
    this.door?.leave();
    this.door = this.doorCh = null;
  }

  private netError(error: NetError, peerId?: string): void {
    if (this.hosting) report(coopErrorCode(error, !!this.room.status?.().ice?.ours.publicIps.some(ip => this.room.status?.().ice?.theirs.publicIps.includes(ip)), turnConfigured()), { stage: 'host-peer-failure', reason: error, ice: this.reportIce() });
    if (this.hosting) {
      if (error === 'password' && peerId) {
        this.failed.add(peerId);
        if (this.atDoor.has(peerId)) this.doorCh?.send({ t: 'wrong' }, peerId);
      }
      if (error === 'password') this.post(null, 'Someone tried to join with the wrong password.');
      else if (error === 'connect') this.post(null, `A player couldn't connect. ${iceAdvice(this.room.status?.().ice, 'host') || 'One of your networks blocks direct connections. Have one player switch networks (e.g. a phone hotspot).'}`);
      else if (error === 'relays' && this.players.length === 1) this.close('relays');
      return;
    }
    // Once in, another guest's bad password or bad network is not this player's problem.
    if (this.phase !== 'connecting') return;
    // No relay at all is nobody's fault but the network's, and nothing else can work.
    if (error === 'relays') return this.close('relays');
    console.info(`[coop] A connection ${peerId ? 'to one peer ' : ''}failed while joining (${error}); checking whether that was the host.`);
    this.lastError = error;
    if (peerId) this.errors.set(peerId, error);
    // The host's own failure is the answer. Anyone else's is theirs: the door says who the host is, so ask there now.
    if (peerId && peerId === this.doorHost) return this.close(error);
    this.openDoor();
    this.pendingError ??= setTimeout(() => this.judgePending(), PENDING_ERROR_MS);
  }

  /** Guest: an error came from a peer that may or may not be the host, and the door has not said. With nothing else still coming, it was. */
  private judgePending(): void {
    this.pendingError = null;
    if (this.phase !== 'connecting' || !this.lastError) return;
    if (!this.doorHost && !this.unheard.size && !this.room.status?.().trying) return this.close(this.lastError);
    this.pendingError = setTimeout(() => this.judgePending(), 2000);
  }

  /** Guest: nobody answered in time. The host's own error if there was one, else the stage that stalled. */
  private timeoutReason(): LobbyError {
    const stage = this.stage;
    if (stage === 'relays') return 'relays';
    const error = this.doorHost ? this.errors.get(this.doorHost) : this.lastError;
    return error ?? (stage === 'connecting' ? 'connect' : stage === 'version' ? 'no-answer' : 'no-host');
  }

  /** A chat line from the host's side: kept here and sent on, with the list, to every guest. */
  private post(from: string | null, text: string): void {
    this.addLine(from, text, false);
    for (const p of this.players) if (linked(p)) this.ch.send({ t: 'chat', from, text }, p.id);
    this.broadcast();
  }

  private addLine(from: string | null, text: string, notify = true): void {
    this.chat.push({ from, text });
    if (this.chat.length > CHAT_KEEP) this.chat.shift();
    this.onLine({ from, text });
    if (notify) this.onChange();
  }

  private broadcast(): void {
    for (const p of this.players) if (linked(p)) this.ch.send({ t: 'lobby', you: p.id, players: this.players, pick: this.pick, live: this.live, holdLeft: this.holdLeft, on: this.match?.id ?? null }, p.id);
    this.onChange();
  }

  private clearWait(): void {
    if (this.wait) clearTimeout(this.wait);
    if (this.relayWait) clearTimeout(this.relayWait);
    this.wait = this.relayWait = null;
  }

  /** Counts only: addresses and peer ids never enter the reporter. */
  private reportIce(): string {
    const ice = this.room.status?.().ice;
    if (!ice) return 'unknown';
    return (['ours', 'theirs'] as const).map(side => `${side}:host=${ice[side].host},mdns=${ice[side].mdns},srflx=${ice[side].srflx},relay=${ice[side].relay}`).join(';');
  }

  /** `linger`: how long the room itself stays up after this lobby has closed (a goodbye on its way out). */
  private close(error: LobbyError | null, linger = 0): void {
    if (this.phase === 'closed') return;
    this.flushEvents();
    const stage = this.stage;
    const ice = this.room.status?.().ice;
    const sameLan = !!ice?.ours.publicIps.some(ip => ice.theirs.publicIps.includes(ip));
    report(error ? coopErrorCode(error, sameLan, turnConfigured()) : 'COOP_DISCONNECTED', { stage, reason: error ?? 'left', ice: this.reportIce() });
    // The reason is on the console too, whatever screen ends up showing it.
    if (error) console.warn(`[coop] The room closed: ${error} (${this.hosting ? 'host' : 'guest'}, ${stage}${this.match ? `, match ${this.match.mode}` : ''}).`);
    this.phase = 'closed';
    this.error = error;
    this.reconnecting = null;
    // Read before leaving: the candidates of the connection that failed say why (ice.ts).
    if (error === 'connect') this.connectAdvice = iceAdvice(this.room.status?.().ice, this.hosting ? 'host' : 'guest');
    if (this.beat) clearInterval(this.beat);
    this.beat = null;
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.ackTimer = null;
    this.stopCount();
    this.clearWait();
    this.shutDoor();
    if (linger > 0) setTimeout(() => this.room.leave(), linger);
    else this.room.leave();
    this.onChange();
  }
}

// --- Codes, names, links ---

/**
 * One random id per browser, kept in localStorage; '' where there is none (tests), and then a player is only their
 * connection. On the loopback test transport (`?net=loop`) several players share one browser profile, so there the id is
 * per tab (sessionStorage, which a reload keeps).
 */
const BROWSER_ID: string = (() => {
  try {
    const store = LOOPBACK ? sessionStorage : localStorage;
    let id = store.getItem('op2_browser');
    if (!id) store.setItem('op2_browser', (id = crypto.randomUUID()));
    return id;
  } catch { return ''; }
})();

/** No 0/O, 1/I/L: the code is read out over voice chat. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** What the player typed or the link carried, as a code, or '' when it is not one. */
export function cleanCode(text: string): string {
  const code = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === CODE_LENGTH && [...code].every(c => CODE_ALPHABET.includes(c)) ? code : '';
}

/** A lobby on the loopback test transport (`loop`) hands out links that stay on it. */
export const inviteLink = (code: string, at: { origin: string; pathname: string } = location, loop: boolean = LOOPBACK): string =>
  `${at.origin}${at.pathname}?join=${code}${loop ? '&net=loop' : ''}`;

const CALLSIGNS = ['VIPER', 'GHOST', 'HAMMER', 'RAVEN', 'BISHOP', 'NOMAD', 'SABRE', 'JACKAL', 'COBALT', 'WARDEN', 'ONYX', 'TALON'];
const NAME_KEY = 'op2_coop_name';

export const randomCallsign = (): string => `${CALLSIGNS[Math.floor(Math.random() * CALLSIGNS.length)]}-${10 + Math.floor(Math.random() * 90)}`;

export function loadCallsign(): string {
  try {
    const stored = clean(localStorage.getItem(NAME_KEY), NAME_MAX);
    if (stored) return stored;
  } catch {
    // Blocked storage: a fresh callsign each visit.
  }
  const name = randomCallsign();
  saveCallsign(name);
  return name;
}

export function saveCallsign(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Blocked storage keeps the name for this visit only.
  }
}
