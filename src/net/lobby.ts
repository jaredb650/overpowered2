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
import { decodePose, encodePose, type Pose } from './pose';
import type { Channel, LobbyRooms, NetError, NetRoom } from './room';

export type LobbyError = 'password' | 'version' | 'host-left' | 'no-host' | 'connect' | 'full';
export type LobbyPhase = 'connecting' | 'open' | 'closed';

export interface LobbyPlayer {
  id: string;
  name: string;
  ready: boolean;
  host: boolean;
  slot: number;
}

/** `from` null is the lobby's own line: joins, leaves, warnings. */
export interface ChatLine {
  from: string | null;
  text: string;
}

export const COOP_MODES = ['crucible', 'outpost', 'defense'] as const;
export type CoopMode = typeof COOP_MODES[number];
export interface Match { id: string; mode: CoopMode }
export const validMatch = (m: unknown): m is Match => !!m && typeof m === 'object'
  && typeof (m as Match).id === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test((m as Match).id)
  && COOP_MODES.includes((m as Match).mode);

type Msg =
  | { t: 'start'; match: Match }
  | { t: 'started'; id: string }
  | { t: 'hello'; v: string; name: string; host: boolean; deployed?: boolean }
  | { t: 'set'; name: string; ready: boolean }
  | { t: 'lobby'; you: string; players: LobbyPlayer[] }
  | { t: 'chat'; from: string | null; text: string };

/** Through the door: the host saw this guest's password fail. */
type DoorMsg = { t: 'wrong' };

export const MAX_PLAYERS = 4;
export const NAME_MAX = 16;
export const CHAT_MAX = 160;
const CHAT_KEEP = 40;
export const HOST_WAIT_MS = 30_000;
/** How long a guest waits in the main room before it asks at the door. A right password is in within about three. */
export const DOOR_AFTER_MS = 5_000;
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
  private starting = new Set<string>();
  private started = false;
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

  constructor(private readonly rooms: LobbyRooms, readonly hosting: boolean, private name: string, private readonly build = BUILD, private readonly deployed = false) {
    const room = (this.room = rooms.main);
    this.ch = room.channel<Msg>('lobby');
    this.poses = room.channel<ArrayBuffer>('pose');
    this.poses.on((data, from) => {
      if (this.phase !== 'open' || !this.match) return;
      const decoded = decodePose(data);
      if (!decoded) return;
      if (this.hosting) {
        const player = this.players.find(p => p.id === from && !p.host);
        if (!player) return;
        this.onPose(player.id, decoded.pose);
        // Never trust a guest's claimed slot. Only the host stamps identities on relayed poses.
        const stamped = encodePose(decoded.pose, player.slot);
        for (const p of this.players) if (!p.host && p.id !== from) this.poses.send(stamped, p.id);
      } else if (from === this.hostId) {
        const player = this.players.find(p => p.slot === decoded.slot && p.id !== this.you);
        if (player) this.onPose(player.id, decoded.pose);
      }
    });
    if (hosting) {
      this.phase = 'open';
      this.you = HOST_ID;
      this.players = [{ id: HOST_ID, name, ready: false, host: true, slot: 0 }];
      this.openDoor();
    } else {
      this.wait = setTimeout(() => this.close('no-host'), HOST_WAIT_MS);
      this.knock = setTimeout(() => this.openDoor(), DOOR_AFTER_MS);
    }
    room.onPeerJoin(id => this.ch.send({ t: 'hello', v: build, name: this.name, host: hosting, deployed }, id));
    room.onPeerLeave(id => this.peerLeft(id));
    room.onError((error, peerId) => this.netError(error, peerId));
    this.ch.on((msg, from) => {
      if (this.phase !== 'closed' && msg && typeof msg === 'object') this.receive(msg, from);
    });
  }

  get me(): LobbyPlayer | undefined {
    return this.players.find(p => p.id === this.you);
  }

  setName(name: string): void {
    this.name = clean(name, NAME_MAX) || this.name;
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
  startMatch(mode: CoopMode, id: string = crypto.randomUUID()): boolean {
    if (!this.hosting || this.phase !== 'open' || this.match || !COOP_MODES.includes(mode)) return false;
    this.match = { id, mode };
    this.starting = new Set(this.players.filter(p => !p.host).map(p => p.id));
    for (const peer of this.starting) this.ch.send({ t: 'start', match: this.match }, peer);
    this.finishStart();
    return true;
  }

  sendPose(pose: Pose): void {
    if (this.phase !== 'open' || !this.match || !this.me) return;
    const data = encodePose(pose, this.me.slot);
    if (this.hosting) {
      for (const p of this.players) if (!p.host) this.poses.send(data, p.id);
    } else if (this.hostId) this.poses.send(data, this.hostId);
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

  /** Sends this player's own name and ready, kept here: the list from the host can lag a change still on its way. */
  private change(): void {
    const me = this.me;
    if (this.hosting && me) {
      me.name = this.name;
      me.ready = this.ready;
      this.broadcast();
    } else if (this.hostId) {
      this.ch.send({ t: 'set', name: this.name, ready: this.ready }, this.hostId);
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
      if (msg.host || this.players.some(p => p.id === from)) return;
      const name = clean(msg.name, NAME_MAX) || 'PLAYER';
      // The guest sees the mismatch on its own side and stops; the host only notes it.
      if (!sameBuild) return this.post(null, `${name} could not join: different game version. They need to reload.`);
      if (this.players.length >= MAX_PLAYERS) return;
      const slot = [1, 2, 3].find(s => !this.players.some(p => p.slot === s))!;
      this.players.push({ id: from, name, ready: false, host: false, slot });
      this.post(null, `${name} joined.`);
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
      this.broadcast();
    } else if (msg.t === 'chat') {
      const text = clean(msg.text, CHAT_MAX);
      if (text) this.post(player.name, text);
    }
  }

  private fromHost(msg: Msg): void {
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
      else if (error === 'connect') this.post(null, 'A player found the lobby but could not connect. Their network may need a relay server.');
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
