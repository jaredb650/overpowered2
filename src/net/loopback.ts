/**
 * The loopback transport: pages of one browser (one profile, or one Playwright context) talk through a BroadcastChannel,
 * with no WebRTC and no Nostr relay. It exists for tests: fast, offline, repeatable, and as many runs at once as the
 * machine can hold. The real Lobby and game run on top, with the same codes and passwords, joins and leaves, four players.
 *
 * **Switching it on** takes both: `?net=loop` in the page's address, and a page that is a dev build or is served from this
 * computer (localhost). A page on the public site ignores the word, so no link can put a player on it by accident. The
 * address keeps `net=loop` from the lobby into the match. One tab per browser does not apply to these pages (main.ts), and
 * each tab is its own player to the host (lobby.ts keeps the browser id per tab).
 *
 * What it copies from the real one: a peer id per page (the same in a lobby's two rooms), objects travelling as JSON and
 * bytes arriving as a Uint8Array, a wrong password telling only the peer already in the room (the guest hears through
 * the door, as for real), a peer past the transport's cap (twelve, lobby.ts) refused as full, and a peer whose page closes or navigates leaving at once (a Web
 * Lock the others wait on). What it does not: it never loses, delays or reorders anything. The simulator in the lane layer
 * does that, for both transports.
 */
import { TRANSPORT_MAX_USERS } from './lobby';
import { LaneRoom, type Wire } from './lanes';
import { pageSim } from './netsim';
export { loopbackOn } from './mode';
import type { LobbyRooms, NetError, NetRoom } from './room';

/** How pages reach each other: a BroadcastChannel for real, an in-memory hub in tests. */
export interface Bus {
  post(message: unknown): void;
  listen(handler: (message: unknown) => void): void;
  close(): void;
}
export type BusFactory = (name: string) => Bus;

const broadcast: BusFactory = name => {
  const channel = new BroadcastChannel(name);
  return {
    post: message => channel.postMessage(message),
    listen: handler => { channel.onmessage = event => handler(event.data); },
    close: () => channel.close(),
  };
};

type Message =
  /** A newcomer announces itself; everyone already there answers `hey`, or `full`. */
  | { t: 'hi'; from: string; key: string }
  | { t: 'hey'; from: string; to: string }
  | { t: 'full'; from: string; to: string }
  | { t: 'bye'; from: string }
  /** A message on a reliable lane: `json` for objects, `bytes` for binary. */
  | { t: 'r'; from: string; to?: string; lane: string; json?: string; bytes?: ArrayBuffer }
  /** An unreliable frame. */
  | { t: 'u'; from: string; to: string; frame: ArrayBuffer };

const randomId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  return Array.from(bytes, b => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]).join('');
};

/** This page's peer id, the same in every room it opens. */
export const LOOP_SELF = randomId();

interface Locks { request(name: string, options: { signal?: AbortSignal }, callback: () => unknown): Promise<unknown> }

export interface LoopOptions {
  bus?: BusFactory;
  self?: string;
  /** Web Locks, so a page that dies is noticed. Absent in tests and old browsers: then only `leave()` tells the others. */
  locks?: Locks | null;
}

export function loopWire(roomId: string, password: string, options: LoopOptions = {}): Wire {
  const self = options.self ?? LOOP_SELF;
  const name = `op2-loop:${roomId}`;
  const bus = (options.bus ?? broadcast)(name);
  const locks = options.locks === undefined ? (globalThis.navigator as { locks?: Locks } | undefined)?.locks ?? null : options.locks;
  const peers = new Set<string>();
  const lanes = new Map<string, ((data: unknown, from: string) => void)[]>();
  const joins: ((id: string) => void)[] = [];
  const leaves: ((id: string) => void)[] = [];
  const errors: ((error: NetError, peerId?: string) => void)[] = [];
  let fast: (frame: Uint8Array, from: string) => void = () => {};
  let closed = false;
  let told = false;
  const abort = typeof AbortController === 'undefined' ? null : new AbortController();
  let release: () => void = () => {};
  const lockName = (id: string) => `${name}:${id}`;

  const join = (id: string) => {
    if (closed || peers.has(id)) return;
    peers.add(id);
    // The peer holds a lock for as long as its page lives in the room: getting it means the page is gone.
    locks?.request(lockName(id), { signal: abort?.signal }, () => left(id)).catch(() => {});
    for (const handler of joins) handler(id);
  };
  const left = (id: string) => {
    if (closed || !peers.delete(id)) return;
    for (const handler of leaves) handler(id);
  };
  const fail = (error: NetError, peerId?: string) => { for (const handler of errors) handler(error, peerId); };

  bus.listen(raw => {
    const message = raw as Message;
    if (closed || !message || typeof message !== 'object' || message.from === self) return;
    if (message.t === 'hi') {
      // Wrong password: only this side, already in the room, is told. The newcomer waits in silence (see the door).
      if (message.key !== password) return fail('password', message.from);
      if (peers.has(message.from)) return;
      // The transport's cap, not the game's four: around a match start every player has two pages in the room (lobby.ts).
      if (peers.size >= TRANSPORT_MAX_USERS - 1) return bus.post({ t: 'full', from: self, to: message.from } satisfies Message);
      bus.post({ t: 'hey', from: self, to: message.from } satisfies Message);
      join(message.from);
    } else if (message.t === 'hey' && message.to === self) join(message.from);
    else if (message.t === 'full' && message.to === self) {
      if (!told) fail('full');
      told = true;
    } else if (message.t === 'bye') left(message.from);
    else if (message.t === 'r' && peers.has(message.from) && (message.to === undefined || message.to === self)) {
      const handlers = lanes.get(message.lane);
      if (!handlers) return;
      let data: unknown;
      if (message.bytes) data = new Uint8Array(message.bytes);
      else try { data = JSON.parse(message.json ?? 'null'); } catch { return; }
      for (const handler of handlers) handler(data, message.from);
    } else if (message.t === 'u' && message.to === self && peers.has(message.from)) fast(new Uint8Array(message.frame), message.from);
  });

  const announce = () => { if (!closed) bus.post({ t: 'hi', from: self, key: password } satisfies Message); };
  if (locks) {
    // Hold this page's own lock first, then announce: whoever hears `hi` can already wait on it.
    locks.request(lockName(self), { signal: abort?.signal }, () => {
      announce();
      return new Promise<void>(resolve => { release = resolve; });
    }).catch(() => {});
  } else queueMicrotask(announce);

  return {
    reliable(lane) {
      return {
        send(data, to) {
          if (closed) return;
          const binary = data instanceof ArrayBuffer ? data.slice(0) : data instanceof Uint8Array ? data.slice().buffer : null;
          const message: Message = binary ? { t: 'r', from: self, to, lane, bytes: binary } : { t: 'r', from: self, to, lane, json: JSON.stringify(data) ?? 'null' };
          bus.post(message);
        },
        on(handler) {
          const list = lanes.get(lane) ?? [];
          list.push(handler);
          lanes.set(lane, list);
        },
      };
    },
    fastSend(to, frame) {
      if (closed || !peers.has(to)) return false;
      bus.post({ t: 'u', from: self, to, frame: frame.slice().buffer } satisfies Message);
      return true;
    },
    fastUp: peer => !closed && peers.has(peer),
    onFast: handler => { fast = handler; },
    buffered: () => 0,
    onPeerJoin: handler => void joins.push(handler),
    onPeerLeave: handler => void leaves.push(handler),
    onError: handler => void errors.push(handler),
    leave() {
      if (closed) return;
      bus.post({ t: 'bye', from: self } satisfies Message);
      closed = true;
      abort?.abort();
      release();
      bus.close();
    },
    status: () => ({ relays: true, trying: 0 }),
  };
}

export function openLoopRoom(code: string, password: string, options: LoopOptions & { main?: boolean } = {}): NetRoom {
  return new LaneRoom(loopWire(code, password, options), { sim: pageSim(), ping: options.main === true, metrics: options.main === true ? undefined : null });
}

/** A lobby's two rooms on the loopback, laid out as trystero.ts lays out the real ones. */
export function openLoopLobby(code: string, password: string): LobbyRooms {
  console.info('[coop] LOOPBACK transport (?net=loop): this lobby reaches only other tabs of this browser.');
  return { main: openLoopRoom(code, password, { main: true }), door: () => openLoopRoom(`${code}-door`, code) };
}
