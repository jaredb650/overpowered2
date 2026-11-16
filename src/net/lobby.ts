/**
 * The co-op lobby: who is in, who is ready, and a chat line. The host's browser owns the list and sends it to each guest;
 * a guest only ever asks the host. Everything a peer sends is checked here, since it arrives from someone else's browser.
 *
 * Joining: every peer says hello with its build id on connect. A guest that meets a host on another build stops with
 * 'version'. A wrong password stops it with 'password', told by trystero or, through the door (room.ts), by the host.
 * A guest that hears from no host in HOST_WAIT_MS stops with 'no-host': a wrong code, a host who left, or a network that
 * will not connect, so it is never silence.
 */
import { BUILD } from './build';
import { defaultStarter, isStarter, type StarterGun } from '../contracts/starter';
import { decodePose, encodePose, type Pose } from './pose';
import type { Channel, LobbyRooms, NetError, NetRoom } from './room';

export type LobbyError = 'password' | 'version' | 'host-left' | 'no-host' | 'connect' | 'full' | 'relays' | 'lost' | 'code-taken';
export type LobbyPhase = 'connecting' | 'open' | 'closed';

export interface LobbyPlayer {
  id: string;
  name: string;
  ready: boolean;
  host: boolean;
  slot: number;
  starter?: StarterGun;
  /** Round trip to the host in ms, measured by the host. The host's own is 0. */
  ping?: number;
  /** Back in the lobby page while the match goes on without them. */
  away?: boolean;
}

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
export const validMatch = (m: unknown): m is Match => !!m && typeof m === 'object'
  && typeof (m as Match).id === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test((m as Match).id)
  && COOP_MODES.includes((m as Match).mode)
  && ((m as Match).map === undefined || COOP_MAPS.includes((m as Match).map!));

type Msg =
  | { t: 'start'; match: Match }
  | { t: 'started'; id: string }
  | { t: 'hello'; v: string; name: string; host: boolean; deployed?: boolean; starter?: StarterGun; born?: number }
  | { t: 'set'; name: string; ready: boolean; starter?: StarterGun }
  | { t: 'lobby'; you: string; players: LobbyPlayer[] }
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

/** Through the door: the host saw this guest's password fail. */
type DoorMsg = { t: 'wrong' };

export const MAX_PLAYERS = 4;
export const NAME_MAX = 16;
export const CHAT_MAX = 160;
const CHAT_KEEP = 40;
export const HOST_WAIT_MS = 30_000;
/** How long a guest waits in the main room before it asks at the door. A right password is in within about three. */
export const DOOR_AFTER_MS = 5_000;
export const PING_MS = 2_000;
/** Silence after which a peer is gone, even if WebRTC has not noticed yet (a closed lid, a dropped Wi-Fi). */
export const SILENCE_MS = 20_000;
export const COUNTDOWN_S = 5;
/** The host's own row. Guests are listed by their peer id. */
const HOST_ID = 'host';

const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';

export class Lobby {
  phase: LobbyPhase = 'connecting';
  error: LobbyError | null = null;
  /** The other side's build, when `error` is 'version'. */
  theirBuild = '';
  players: LobbyPlayer[] = [];
  /** This browser's row in `players`. */
  you = '';
  chat: ChatLine[] = [];
  onChange: () => void = () => {};
  match: Match | null = null;
  onMatch: (match: Match) => void = () => {};
  onPose: (id: string, pose: Pose) => void = () => {};
  /** Every chat line as it arrives, for the in-game feed. */
  onLine: (line: ChatLine) => void = () => {};
  /** Seconds left on the host's start countdown, 0 when none runs. */
  count = 0;
  /** Guest: the match the host is still playing after this guest went back to the lobby page. */
  awayFrom: Match | null = null;
  /** Host ended the match: everyone's game goes back to the lobby page. */
  onEnd: () => void = () => {};
  private starting = new Set<string>();
  private started = false;
  private readonly heard = new Map<string, number>();
  private pings = new Map<string, number>();
  private beat: ReturnType<typeof setInterval> | null = null;
  private nextBeat = 0;
  /** When this lobby opened, so of two hosts on one code the newer one steps aside. */
  private readonly born = Date.now() + Math.random();
  private counter: ReturnType<typeof setInterval> | null = null;
  private readonly poses: Channel<ArrayBuffer>;


  private readonly ch: Channel<Msg>;
  private hostId: string | null = null;
  private ready = false;
  private wait: ReturnType<typeof setTimeout> | null = null;
  private knock: ReturnType<typeof setTimeout> | null = null;
  private readonly room: NetRoom;
  private door: NetRoom | null = null;
  private doorCh: Channel<DoorMsg> | null = null;
  /** Host: peers whose password failed, and who is standing at the door. */
  private failed = new Set<string>();
  private atDoor = new Set<string>();

  constructor(private readonly rooms: LobbyRooms, readonly hosting: boolean, private name: string, private readonly build = BUILD, private readonly deployed = false, private starter?: StarterGun) {
    const room = (this.room = rooms.main);
    this.ch = room.channel<Msg>('lobby');
    this.poses = room.channel<ArrayBuffer>('pose');
    this.poses.on((data, from) => {
      this.heard.set(from, performance.now());
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
      this.players = [{ id: HOST_ID, name, ready: false, host: true, slot: 0, starter }];
      this.openDoor();
    } else {
      this.wait = setTimeout(() => this.close('no-host'), HOST_WAIT_MS);
      this.knock = setTimeout(() => this.openDoor(), DOOR_AFTER_MS);
    }
    room.onPeerJoin(id => this.ch.send({ t: 'hello', v: build, name: this.name, host: hosting, deployed, starter: this.starter, born: this.born }, id));
    room.onPeerLeave(id => this.peerLeft(id));
    room.onError((error, peerId) => this.netError(error, peerId));
    this.ch.on((msg, from) => {
      this.heard.set(from, performance.now());
      if (this.phase !== 'closed' && msg && typeof msg === 'object' && typeof msg.t === 'string') this.receive(msg, from);
    });
    this.beat = setInterval(() => this.heartbeat(), PING_MS);
  }

  /** Every PING_MS: the host pings each guest, and either side drops a peer that has gone silent. */
  heartbeat(now = performance.now()): void {
    // Also called every game frame, which a hidden tab's worker keeps ticking when its timers are throttled.
    if (this.phase !== 'open' || now < this.nextBeat) return;
    this.nextBeat = now + PING_MS - 50;
    if (!this.hosting) {
      if (this.hostId && now - (this.heard.get(this.hostId) ?? now) > SILENCE_MS) this.close('lost');
      return;
    }
    for (const p of this.players) {
      if (p.host) continue;
      const last = this.heard.get(p.id) ?? now;
      if (!this.heard.has(p.id)) this.heard.set(p.id, now);
      if (now - last > SILENCE_MS) { this.peerLeft(p.id); continue; }
      this.pings.set(p.id, now);
      this.ch.send({ t: 'ping', n: now }, p.id);
    }
    this.broadcast();
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

  setReady(ready: boolean): void {
    this.ready = ready;
    this.change();
  }

  say(text: string): void {
    const line = clean(text, CHAT_MAX);
    if (!line || this.phase !== 'open') return;
    if (this.hosting) this.post(this.name, line);
    else if (this.hostId) this.ch.send({ t: 'chat', from: null, text: line }, this.hostId);
  }

  /** Only the host picks the mode. Guests acknowledge before the host changes page. */
  startMatch(mode: CoopMode, id: string = crypto.randomUUID(), map?: CoopMap): boolean {
    if (!this.hosting || this.phase !== 'open' || this.match || !COOP_MODES.includes(mode)) return false;
    if (map !== undefined && !COOP_MAPS.includes(map)) return false;
    this.stopCount();
    for (const player of this.players) player.starter ??= defaultStarter(mode);
    this.broadcast();
    this.match = map ? { id, mode, map } : { id, mode };
    this.starting = new Set(this.players.filter(p => !p.host).map(p => p.id));
    for (const peer of this.starting) this.ch.send({ t: 'start', match: this.match }, peer);
    this.finishStart();
    return true;
  }

  /**
   * Host: Start counts down COUNTDOWN_S seconds out loud for everyone, then starts. Pressed again, it cancels. A guest who
   * is not ready yet sees the count and can still ready up; nobody is held back by it.
   */
  countdown(mode: CoopMode, map?: CoopMap, seconds = COUNTDOWN_S): boolean {
    if (!this.hosting || this.phase !== 'open' || this.match) return false;
    if (this.count) {
      this.stopCount();
      this.post(null, 'Start cancelled.');
      return true;
    }
    this.count = seconds;
    const tick = () => {
      for (const p of this.players) if (!p.host) this.ch.send({ t: 'count', n: this.count }, p.id);
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

  private stopCount(): void {
    if (this.counter) clearInterval(this.counter);
    this.counter = null;
    const was = this.count;
    this.count = 0;
    if (was) for (const p of this.players) if (!p.host) this.ch.send({ t: 'count', n: 0 }, p.id);
  }

  /** Host: the match is over for everyone, and the room stays open for the next one. */
  endMatch(): void {
    if (!this.hosting || !this.match) return;
    this.match = null;
    this.started = false;
    this.starting.clear();
    for (const p of this.players) {
      p.away = false;
      if (!p.host) this.ch.send({ t: 'end' }, p.id);
    }
    this.broadcast();
  }

  /** Guest: back to the lobby page while the host plays on (`back` false), or back into that match (`back` true). */
  away(back: boolean): void {
    if (this.hosting || !this.hostId || this.phase !== 'open') return;
    if (!back && this.match) { this.awayFrom = this.match; this.match = null; }
    if (back) this.awayFrom = null;
    this.ch.send({ t: 'away', back }, this.hostId);
  }

  sendPose(pose: Pose): void {
    if (this.phase !== 'open' || !this.match || !this.me) return;
    const data = encodePose(pose, this.me.slot);
    if (this.hosting) {
      for (const p of this.players) if (!p.host && !p.away) this.poses.send(data, p.id);
    } else if (this.hostId) this.poses.send(data, this.hostId);
  }

  gameplay<T>(name: 'world' | 'action', receive: (data: T, from: string) => void): (data: T, to?: string) => number {
    const channel = this.room.channel<{ match: string; data: T } | ArrayBuffer | Uint8Array>(name);
    channel.on((message, from) => {
      this.heard.set(from, performance.now());
      if (this.phase !== 'open' || !this.match) return;
      const binary = message instanceof ArrayBuffer ? message : message instanceof Uint8Array ? message.slice().buffer : null;
      if (!binary && (message as { match: string } | null)?.match !== this.match.id) return;
      if (this.hosting ? this.players.some(player => !player.host && !player.away && player.id === from) : from === this.hostId) receive((binary ?? (message as { data: T }).data) as T, from);
    });
    return (data, to) => {
      if (this.phase !== 'open' || !this.match) return 0;
      const message = data instanceof ArrayBuffer ? data : { match: this.match.id, data };
      const recipients = this.hosting ? this.players.filter(player => !player.host && !player.away && (!to || player.id === to)).map(player => player.id)
        : this.hostId ? [this.hostId] : [];
      for (const id of recipients) channel.send(message, id);
      return recipients.length;
    };
  }

  /** Who answers for which peer id: lets the game drop lanes from guests who have gone back to the lobby. */
  inMatch(id: string): boolean {
    const p = this.players.find(player => player.id === id);
    return !!p && !p.away;
  }

  private finishStart(): void {
    if (this.match && !this.starting.size && !this.started) {
      this.started = true;
      this.onMatch(this.match);
    }
  }

  leave(): void {
    this.close(null);
  }

  /** Host: a line from the lobby itself (amber, no name), for everyone. */
  notice(text: string): void {
    if (this.hosting && this.phase === 'open') this.post(null, clean(text, CHAT_MAX));
  }

  /** The players' round trips, as the host measured them. */
  pingOf(id: string): number | undefined {
    return this.players.find(p => p.id === id)?.ping;
  }

  /** Sends this player's own name and ready, kept here: the list from the host can lag a change still on its way. */
  private change(): void {
    const me = this.me;
    if (this.hosting && me) {
      me.name = this.name;
      me.ready = this.ready;
      if (!this.match) me.starter = this.starter;
      this.broadcast();
    } else if (this.hostId) {
      this.ch.send({ t: 'set', name: this.name, ready: this.ready, starter: this.starter }, this.hostId);
    }
  }

  private receive(msg: Msg, from: string): void {
    if (msg.t === 'hello') this.hello(msg, from);
    else if (this.hosting) this.fromGuest(msg, from);
    else if (from === this.hostId) this.fromHost(msg);
  }

  private hello(msg: Extract<Msg, { t: 'hello' }>, from: string): void {
    // During the page handoff an early guest can meet the old host while a later guest is still acknowledging.
    // Reconnected guests only adopt the host's new page; the old lobby never admits those returning peers.
    if ((!this.hosting && this.deployed && !msg.deployed) || (this.hosting && this.match && !this.deployed && msg.deployed)) return;
    const sameBuild = msg.v === this.build;
    if (this.hosting) {
      // Two hosts on one code: the newer, still empty lobby steps aside so guests are never split between them.
      if (msg.host) return void (!this.deployed && this.players.length === 1 && !this.match && Number(msg.born) < this.born && this.close('code-taken'));
      if (this.players.some(p => p.id === from)) return;
      const name = clean(msg.name, NAME_MAX) || 'PLAYER';
      // The guest sees the mismatch on its own side and stops; the host only notes it.
      if (!sameBuild) return this.post(null, `${name} could not join: different game version. They need to reload.`);
      if (this.players.length >= MAX_PLAYERS) {
        this.ch.send({ t: 'full' }, from);
        return this.post(null, `${name} could not join: the lobby is full.`);
      }
      const slot = [1, 2, 3].find(s => !this.players.some(p => p.slot === s))!;
      this.players.push({ id: from, name, ready: false, host: false, slot, starter: isStarter(msg.starter) ? msg.starter : undefined });
      this.heard.set(from, performance.now());
      // A guest back from the page handoff is not news; one arriving mid-match is.
      if (!msg.deployed) this.post(null, this.match ? `${name} joined the match in progress.` : `${name} joined.`);
      else this.broadcast();
      if (this.match) this.ch.send({ t: 'start', match: this.match }, from);
      return;
    }
    if (!msg.host || this.hostId) return;
    if (!sameBuild) {
      this.theirBuild = clean(msg.v, 40);
      return this.close('version');
    }
    this.hostId = from;
    this.phase = 'open';
    this.clearWait();
    this.shutDoor();
    this.onChange();
  }

  private fromGuest(msg: Msg, from: string): void {
    const player = this.players.find(p => p.id === from);
    if (!player) return;
    if (msg.t === 'started' && msg.id === this.match?.id) {
      this.starting.delete(from);
      this.finishStart();
    } else if (msg.t === 'set') {
      player.name = clean(msg.name, NAME_MAX) || player.name;
      player.ready = msg.ready === true;
      if (!this.match) player.starter = isStarter(msg.starter) ? msg.starter : undefined;
      this.broadcast();
    } else if (msg.t === 'chat') {
      const text = clean(msg.text, CHAT_MAX);
      if (text) this.post(player.name, text);
    } else if (msg.t === 'pong' && msg.n === this.pings.get(from)) {
      player.ping = Math.round(Math.min(9999, Math.max(0, performance.now() - msg.n)));
    } else if (msg.t === 'away' && typeof msg.back === 'boolean') {
      if (player.away === !msg.back) return;
      player.away = !msg.back;
      this.post(null, msg.back ? `${player.name} is back in the match.` : `${player.name} went back to the lobby.`);
      if (msg.back && this.match) this.ch.send({ t: 'start', match: this.match }, from);
    }
  }

  private fromHost(msg: Msg): void {
    if (msg.t === 'ping' && Number.isFinite(msg.n)) return this.ch.send({ t: 'pong', n: msg.n }, this.hostId!);
    if (msg.t === 'full') return this.close('full');
    if (msg.t === 'count' && Number.isInteger(msg.n) && msg.n >= 0 && msg.n <= 30) {
      this.count = msg.n;
      return this.onChange();
    }
    if (msg.t === 'end') {
      this.match = this.awayFrom = null;
      this.started = false;
      this.onEnd();
      return this.onChange();
    }
    if (msg.t === 'start' && validMatch(msg.match)) {
      // A duplicate start (or a late join) must never reset a live run.
      if (this.match && this.match.id !== msg.match.id) return;
      const fresh = !this.match;
      this.match = msg.match;
      this.ch.send({ t: 'started', id: msg.match.id }, this.hostId!);
      if (fresh) this.onMatch(msg.match);
    } else if (msg.t === 'lobby' && Array.isArray(msg.players)) {
      this.you = clean(msg.you, 64);
      this.players = msg.players.slice(0, 8).map(p => ({
        id: clean(p?.id, 64),
        name: clean(p?.name, NAME_MAX) || 'PLAYER',
        ready: p?.ready === true,
        ping: Number.isFinite(p?.ping) ? Math.max(0, Math.min(9999, Math.round(p.ping!))) : undefined,
        away: p?.away === true,
        starter: isStarter(p?.starter) ? p.starter : undefined,
        host: p?.host === true,
        slot: Number.isInteger(p?.slot) && p.slot >= 0 && p.slot < MAX_PLAYERS ? p.slot : -1,
      }));
      this.onChange();
    } else if (msg.t === 'chat') {
      const text = clean(msg.text, CHAT_MAX);
      if (text) this.addLine(msg.from === null ? null : clean(msg.from, NAME_MAX), text);
    }
  }

  private peerLeft(id: string): void {
    if (!this.hosting) {
      if (id === this.hostId) this.close('host-left');
      return;
    }
    const player = this.players.find(p => p.id === id);
    if (!player) return;
    this.heard.delete(id);
    this.players = this.players.filter(p => p !== player);
    this.post(null, `${player.name} left.`);
    this.starting.delete(id);
    this.finishStart();
  }

  private openDoor(): void {
    const door = (this.door = this.rooms.door());
    const ch = (this.doorCh = door.channel<DoorMsg>('door'));
    if (this.hosting) {
      door.onPeerJoin(id => {
        this.atDoor.add(id);
        if (this.failed.has(id)) ch.send({ t: 'wrong' }, id);
      });
      door.onPeerLeave(id => this.atDoor.delete(id));
    } else {
      ch.on(msg => {
        if (msg?.t === 'wrong' && this.phase === 'connecting') this.close('password');
      });
    }
  }

  private shutDoor(): void {
    if (this.knock) clearTimeout(this.knock);
    this.knock = null;
    this.door?.leave();
    this.door = this.doorCh = null;
  }

  private netError(error: NetError, peerId?: string): void {
    if (this.hosting) {
      if (error === 'password' && peerId) {
        this.failed.add(peerId);
        if (this.atDoor.has(peerId)) this.doorCh?.send({ t: 'wrong' }, peerId);
      }
      if (error === 'password') this.post(null, 'Someone tried to join with the wrong password.');
      else if (error === 'connect') this.post(null, 'A player found the lobby but your networks could not connect directly. Set up TURN (docs/notes/coop.md) or try another network.');
      else if (error === 'relays' && this.players.length === 1) this.close('relays');
      return;
    }
    // Once in, another guest's bad password or bad network is not this player's problem.
    if (this.phase === 'connecting') this.close(error);
  }

  /** A chat line from the host's side: kept here and sent on, with the list, to every guest. */
  private post(from: string | null, text: string): void {
    this.addLine(from, text, false);
    for (const p of this.players) if (p.id !== HOST_ID) this.ch.send({ t: 'chat', from, text }, p.id);
    this.broadcast();
  }

  private addLine(from: string | null, text: string, notify = true): void {
    this.chat.push({ from, text });
    if (this.chat.length > CHAT_KEEP) this.chat.shift();
    this.onLine({ from, text });
    if (notify) this.onChange();
  }

  private broadcast(): void {
    for (const p of this.players) if (p.id !== HOST_ID) this.ch.send({ t: 'lobby', you: p.id, players: this.players }, p.id);
    this.onChange();
  }

  private clearWait(): void {
    if (this.wait) clearTimeout(this.wait);
    this.wait = null;
  }

  private close(error: LobbyError | null): void {
    if (this.phase === 'closed') return;
    this.phase = 'closed';
    this.error = error;
    if (this.beat) clearInterval(this.beat);
    this.beat = null;
    this.stopCount();
    this.clearWait();
    this.shutDoor();
    this.room.leave();
    this.onChange();
  }
}

// --- Codes, names, links ---

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

export const inviteLink = (code: string, at: { origin: string; pathname: string } = location): string => `${at.origin}${at.pathname}?join=${code}`;

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
