/**
 * The lane layer: a `NetRoom` over any transport's `Wire`. One copy of everything the two transports share:
 *
 * - **Two lane kinds** (room.ts `ChannelOptions`). An unreliable channel sends bytes as one fast frame per message,
 *   `[name length u8][name ASCII][sequence u16 LE][payload]`, on the wire's unreliable path. While that path to a peer is
 *   not up, or the message is not bytes or is too large, the payload goes on the wire's reliable lane of the same name
 *   instead, unframed. A receiver listens on both, so the handler hears it either way.
 * - **The simulator** (netsim.ts) decides when each outgoing message really leaves: a reliable one late and in order, an
 *   unreliable one late on its own or never.
 * - **The counters** (metrics.ts): bytes and packets per lane and peer both ways, arrival gaps, loss on unreliable lanes
 *   from the sequence numbers, and the round trip to each peer once a second on both paths (lanes `net` and `netu`).
 * - **Backpressure:** `buffered(peer, unreliable)` is the wire's queue plus the simulator's slow link, and a `latest`
 *   channel skips a peer that is behind.
 *
 * A peer's malformed message must never take the game down: every handler runs under a catch.
 */
import { report } from '../core/report';
import { metrics as pageMetrics, type Lane, type NetMetrics } from './metrics';
import { NetSim } from './netsim';
import { BEHIND_BYTES, UNRELIABLE_MAX_BYTES, type Channel, type ChannelOptions, type NetError, type NetRoom } from './room';
import type { IceReport } from './ice';

/** What a transport provides. Ids are the transport's peer ids. */
export interface Wire {
  /** A reliable, ordered lane. Objects travel as JSON; bytes arrive as ArrayBuffer or Uint8Array. `to` absent: everyone. */
  reliable(name: string): { send(data: unknown, to?: string): void; on(handler: (data: unknown, from: string) => void): void };
  /** One unreliable frame to one peer. False when the fast path to that peer is not up (the caller then uses `reliable`). */
  fastSend(to: string, frame: Uint8Array): boolean;
  fastUp(peer: string): boolean;
  onFast(handler: (frame: Uint8Array, from: string) => void): void;
  /** Bytes queued for `peer` on that path and not yet taken by the network. */
  buffered(peer: string, unreliable: boolean): number;
  /** Reliable messages to `peer` that were lost while it stayed connected (room.ts `failed`). Absent: never. */
  failed?(peer: string): number;
  onPeerJoin(handler: (peerId: string) => void): void;
  onPeerLeave(handler: (peerId: string) => void): void;
  onError(handler: (error: NetError, peerId?: string) => void): void;
  leave(): void;
  status?(): { relays: boolean; trying: number; ice?: IceReport };
}

export interface LaneOptions {
  sim?: NetSim;
  /** Absent: nothing is counted (the door room). */
  metrics?: NetMetrics | null;
  /** Measure the round trip to every peer once a second. */
  ping?: boolean;
  pingMs?: number;
  now?: () => number;
}

type Handler = (data: unknown, from: string) => void;
type Bytes = ArrayBuffer | Uint8Array;

const isBytes = (data: unknown): data is Bytes => data instanceof ArrayBuffer || data instanceof Uint8Array;
const view = (data: Bytes): Uint8Array => (data instanceof Uint8Array ? data : new Uint8Array(data));

/** The size a message has on the wire, near enough: bytes as they are, anything else as its JSON. */
export function sizeOf(data: unknown): number {
  if (isBytes(data)) return data.byteLength;
  if (typeof data === 'string') return data.length;
  try { return JSON.stringify(data)?.length ?? 0; } catch { return 0; }
}

const PING_LANE = 'net';
const PING_FAST_LANE = 'netu';
const PING_BYTES = 9;

interface Lanes {
  name: string;
  unreliable: boolean;
  latest: boolean;
  /** `[length][name]`, the start of this lane's fast frames. */
  head: Uint8Array;
  handlers: Handler[];
  stats: Lane | null;
  seq: Map<string, number>;
  wire: ReturnType<Wire['reliable']>;
}

export class LaneRoom implements NetRoom {
  private readonly lanes = new Map<string, Lanes>();
  private readonly peers = new Set<string>();
  private readonly sim: NetSim;
  private readonly metrics: NetMetrics | null;
  private readonly now: () => number;
  private readonly joins: ((id: string) => void)[] = [];
  private readonly leaves: ((id: string) => void)[] = [];
  private pinger: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(private readonly wire: Wire, options: LaneOptions = {}) {
    this.sim = options.sim ?? new NetSim();
    this.metrics = options.metrics === undefined ? pageMetrics : options.metrics;
    this.now = options.now ?? (() => performance.now());
    wire.onPeerJoin(id => {
      this.peers.add(id);
      for (const handler of this.joins) handler(id);
    });
    wire.onPeerLeave(id => {
      this.peers.delete(id);
      // The next connection under this id counts its frames from 0 again.
      for (const lane of this.lanes.values()) lane.seq.delete(id);
      for (const handler of this.leaves) handler(id);
    });
    wire.onFast((frame, from) => this.fastIn(frame, from));
    if (options.ping) this.startPings(options.pingMs ?? 1000);
  }

  channel<T>(name: string, options: ChannelOptions = {}): Channel<T> {
    const lane = this.lane(name, options.unreliable === true);
    lane.latest ||= options.latest === true;
    return {
      send: (data, to) => this.send(lane, data, to),
      on: handler => void lane.handlers.push(handler as Handler),
    };
  }

  private lane(name: string, unreliable: boolean): Lanes {
    let lane = this.lanes.get(name);
    if (lane) {
      lane.unreliable ||= unreliable;
      if (unreliable && lane.stats) lane.stats.unreliable = true;
      return lane;
    }
    if (!/^[\x21-\x7e]{1,32}$/.test(name)) throw new Error(`Bad lane name "${name}"`);
    const head = new Uint8Array(1 + name.length);
    head[0] = name.length;
    for (let i = 0; i < name.length; i++) head[1 + i] = name.charCodeAt(i);
    const wire = this.wire.reliable(name);
    const made: Lanes = { name, unreliable, latest: false, head, handlers: [], stats: this.metrics?.lane(name, unreliable) ?? null, seq: new Map(), wire };
    lane = made;
    this.lanes.set(name, lane);
    wire.on((data, from) => {
      // A dead line (the simulator's `cut`) hears nothing either.
      if (this.closed || this.sim.down) return;
      made.stats?.peer(from).in(sizeOf(data), this.now());
      this.deliver(made, data, from);
    });
    return lane;
  }

  private deliver(lane: Lanes, data: unknown, from: string): void {
    for (const handler of lane.handlers) {
      try { handler(data, from); } catch (error) {
        report('UNCAUGHT_EXCEPTION', { error, stage: 'coop-message' });
        console.warn('[coop] Dropped a message that could not be read', error);
      }
    }
  }

  private send(lane: Lanes, data: unknown, to?: string): void {
    if (this.closed) return;
    if (to === undefined) {
      // Everyone: with nothing to simulate or count per peer the wire does it in one call, as it always did.
      if (!lane.unreliable && !this.sim.active && !lane.stats) return lane.wire.send(data);
      for (const peer of this.peers) this.send(lane, data, peer);
      return;
    }
    const size = sizeOf(data);
    const fast = lane.unreliable && isBytes(data) && size <= UNRELIABLE_MAX_BYTES && this.wire.fastUp(to);
    if (lane.latest && this.buffered(to, fast) > BEHIND_BYTES) {
      if (lane.stats) lane.stats.peer(to).skipped++;
      return;
    }
    lane.stats?.peer(to).out(size);
    if (fast) {
      const frame = this.frame(lane, data, to);
      if (!this.sim.active) return void this.wire.fastSend(to, frame);
      this.sim.unreliable(to, frame.byteLength, () => { if (!this.closed) this.wire.fastSend(to, frame); });
      return;
    }
    if (lane.unreliable && lane.stats) lane.stats.peer(to).fallback++;
    if (!this.sim.active) return lane.wire.send(data, to);
    // The sender may change or reuse what it handed over before the delayed send: keep it as it is now.
    const kept = isBytes(data) ? data.slice(0) : JSON.parse(JSON.stringify(data) ?? 'null') as unknown;
    this.sim.reliable(to, size, () => { if (!this.closed) lane.wire.send(kept, to); });
  }

  private frame(lane: Lanes, data: Bytes, to: string): Uint8Array {
    const payload = view(data);
    const head = lane.head.length;
    const frame = new Uint8Array(head + 2 + payload.byteLength);
    frame.set(lane.head, 0);
    const seq = lane.seq.get(to) ?? 0;
    lane.seq.set(to, (seq + 1) & 0xffff);
    frame[head] = seq & 0xff;
    frame[head + 1] = seq >> 8;
    frame.set(payload, head + 2);
    return frame;
  }

  private fastIn(frame: Uint8Array, from: string): void {
    if (this.closed || this.sim.down || frame.byteLength < 4) return;
    const length = frame[0]!;
    if (frame.byteLength < 1 + length + 2) return;
    // Lanes are few: match the name's bytes rather than build a string per packet.
    let found: Lanes | null = null;
    for (const lane of this.lanes.values()) {
      if (lane.head.length !== 1 + length) continue;
      let same = true;
      for (let i = 1; i <= length && same; i++) same = lane.head[i] === frame[i];
      if (same) { found = lane; break; }
    }
    if (!found) return;
    const at = 1 + length;
    const payload = frame.subarray(at + 2);
    if (found.stats) {
      const peer = found.stats.peer(from);
      peer.in(payload.byteLength, this.now());
      peer.sequence(frame[at]! | (frame[at + 1]! << 8));
    }
    this.deliver(found, payload, from);
  }

  /** The round trip to each peer: a 9-byte ping (`0`, then the sender's clock) answered by the same with `1`. */
  private startPings(everyMs: number): void {
    const reliable = this.channel<Bytes>(PING_LANE);
    const fast = this.channel<Bytes>(PING_FAST_LANE, { unreliable: true });
    const answer = (channel: Channel<Bytes>, isFast: boolean) => (data: Bytes, from: string) => {
      if (!isBytes(data) || data.byteLength !== PING_BYTES) return;
      const bytes = view(data);
      const sent = new DataView(bytes.buffer, bytes.byteOffset, PING_BYTES).getFloat64(1, true);
      if (bytes[0] === 0) {
        const pong = bytes.slice();
        pong[0] = 1;
        channel.send(pong, from);
      } else if (bytes[0] === 1) {
        const ms = this.now() - sent;
        if (ms >= 0 && ms < 60_000) this.metrics?.rtt(from, ms, isFast);
      }
    };
    reliable.on(answer(reliable, false));
    fast.on(answer(fast, true));
    this.pinger = setInterval(() => {
      if (!this.peers.size) return;
      const ping = new Uint8Array(PING_BYTES);
      new DataView(ping.buffer).setFloat64(1, this.now(), true);
      for (const peer of this.peers) {
        reliable.send(ping, peer);
        // Only by the real fast path: a fallback would measure the reliable one twice.
        if (this.wire.fastUp(peer)) fast.send(ping, peer);
      }
    }, everyMs);
    (this.pinger as { unref?: () => void }).unref?.();
  }

  onPeerJoin(handler: (peerId: string) => void): void {
    this.joins.push(handler);
  }

  onPeerLeave(handler: (peerId: string) => void): void {
    this.leaves.push(handler);
  }

  onError(handler: (error: NetError, peerId?: string) => void): void {
    this.wire.onError(handler);
  }

  leave(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.pinger) clearInterval(this.pinger);
    this.pinger = null;
    this.wire.leave();
  }

  status(): { relays: boolean; trying: number; ice?: IceReport } {
    return this.wire.status?.() ?? { relays: true, trying: 0 };
  }

  buffered(peerId: string, unreliable = false): number {
    return this.wire.buffered(peerId, unreliable) + this.sim.buffered(peerId);
  }

  failed(peerId: string): number {
    return this.wire.failed?.(peerId) ?? 0;
  }

  fast(peerId: string): boolean {
    return this.wire.fastUp(peerId);
  }

  pump(): void {
    this.sim.pump();
  }
}
