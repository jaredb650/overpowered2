/**
 * Co-op's network counters, one set per page (`metrics`). The lane layer (lanes.ts) feeds the per-lane, per-peer bytes
 * and packets, arrival gaps, unreliable loss and the round-trip times. Any later code may feed named series:
 *
 *   metrics.sample('snapshot.enemies', 31)        a value
 *   metrics.gap('snapshot')                       time since the last call with this name, in ms
 *   metrics.start('shot', id); ... metrics.stop('shot', id)    a named timer, e.g. shot to the host's answer
 *
 * `snapshot()` is plain JSON for scripts (`window.__op2.net.snapshot()`); `reset()` starts a measuring window.
 * Feeding allocates nothing once a lane, peer or series exists.
 */

const RING = 512;
const scratch = new Float32Array(RING);

export interface SeriesRead { n: number; mean: number; p50: number; p90: number; p99: number; max: number; last: number }

/** Every value since the reset is counted; the percentiles come from the last 512. */
export class Series {
  count = 0;
  sum = 0;
  max = 0;
  last = 0;
  private readonly ring = new Float32Array(RING);

  add(value: number): void {
    this.ring[this.count % RING] = value;
    this.count++;
    this.sum += value;
    this.last = value;
    if (value > this.max) this.max = value;
  }

  reset(): void {
    this.count = this.sum = this.max = this.last = 0;
  }

  read(): SeriesRead {
    const n = Math.min(this.count, RING);
    if (!n) return { n: 0, mean: 0, p50: 0, p90: 0, p99: 0, max: 0, last: 0 };
    const sorted = scratch.subarray(0, n);
    sorted.set(this.ring.subarray(0, n));
    sorted.sort();
    const at = (q: number) => round(sorted[Math.min(n - 1, Math.floor(q * n))]!);
    return { n: this.count, mean: round(this.sum / this.count), p50: at(0.5), p90: at(0.9), p99: at(0.99), max: round(this.max), last: round(this.last) };
  }
}

const round = (value: number): number => Math.round(value * 100) / 100;

/** One lane to or from one peer. */
export class PeerLane {
  outBytes = 0;
  outPackets = 0;
  inBytes = 0;
  inPackets = 0;
  /** Unreliable lane: packets that went by the reliable path because the fast one was not up, or the message did not fit. */
  fallback = 0;
  /** Latest-wins sends skipped because this peer was behind. */
  skipped = 0;
  /** Unreliable lane: packets that arrived behind a newer one. */
  late = 0;
  readonly gap = new Series();
  private lastIn = 0;
  private started = false;
  private base = 0;
  private top = 0;
  private received = 0;

  constructor(private readonly lane: Lane) {}

  out(bytes: number): void {
    this.outBytes += bytes;
    this.outPackets++;
  }

  in(bytes: number, now: number): void {
    this.inBytes += bytes;
    this.inPackets++;
    if (this.lastIn) {
      this.gap.add(now - this.lastIn);
      this.lane.gap.add(now - this.lastIn);
    }
    this.lastIn = now;
  }

  /** An unreliable packet's 16-bit sequence number, for the loss count. */
  sequence(seq: number): void {
    if (!this.started) {
      this.started = true;
      this.base = this.top = seq;
      this.received = 1;
      return;
    }
    let ahead = (seq - this.top) & 0xffff;
    if (ahead >= 0x8000) ahead -= 0x10000;
    if (ahead > 0) this.top += ahead;
    else this.late++;
    this.received++;
  }

  /** Unreliable packets the far side sent that never came (so far: one still in the air counts until it lands). */
  get lost(): number {
    return this.started ? Math.max(0, this.top - this.base + 1 - this.received) : 0;
  }

  get expected(): number {
    return this.started ? this.top - this.base + 1 : 0;
  }

  /** A peer disconnected: its next connection restarts unreliable sequence numbers from 0. */
  resetSequence(): void {
    this.started = false;
    this.base = this.top = this.received = 0;
  }

  reset(): void {
    this.outBytes = this.outPackets = this.inBytes = this.inPackets = this.fallback = this.skipped = this.late = 0;
    this.gap.reset();
    this.lastIn = 0;
    this.started = false;
  }
}

export class Lane {
  readonly peers = new Map<string, PeerLane>();
  /** Arrival gaps on this lane from every peer. */
  readonly gap = new Series();

  constructor(readonly name: string, public unreliable: boolean) {}

  peer(id: string): PeerLane {
    let peer = this.peers.get(id);
    if (!peer) this.peers.set(id, (peer = new PeerLane(this)));
    return peer;
  }
}

export interface LaneRead {
  unreliable: boolean;
  out: { bytes: number; packets: number; bytesPerSecond: number; packetsPerSecond: number };
  in: { bytes: number; packets: number; bytesPerSecond: number; packetsPerSecond: number };
  /** Unreliable lanes: packets lost on the way in, of how many were sent, and the share. */
  lost: number;
  expected: number;
  lossPercent: number;
  late: number;
  fallback: number;
  skipped: number;
  /** Milliseconds between arrivals. */
  gap: SeriesRead;
}

/** One event type on the reliable lane (`metrics.event`, `metrics.heard`): how many, and their bytes on the wire. */
export interface EventRead { n: number; bytes: number; perSecond: number; bytesPerSecond: number; bytesEach: number }

class EventCount {
  out = 0;
  outBytes = 0;
  in = 0;
  inBytes = 0;
  reset(): void { this.out = this.outBytes = this.in = this.inBytes = 0; }
}

class Cost {
  ms = 0;
  n = 0;
}

export interface MetricsSnapshot {
  /** Length of the measuring window: since the page's first use or the last `reset()`. */
  seconds: number;
  /** The reliable lane's events by type: `out` counts one per recipient, `in` what arrived. */
  events: Record<string, { out: EventRead; in: EventRead }>;
  /** Named stretches of work (`metrics.spend`): total ms, how many times, and ms a second. */
  costs: Record<string, { ms: number; n: number; msPerSecond: number; msEach: number }>;
  lanes: Record<string, LaneRead & { peers: Record<string, LaneRead> }>;
  /** Round trip to each peer in ms, by the unreliable path (`fast`, when it is up) and the reliable one. */
  rtt: Record<string, { fast: SeriesRead; reliable: SeriesRead }>;
  series: Record<string, SeriesRead>;
  totals: { outBytesPerSecond: number; inBytesPerSecond: number };
}

/** Pending named timers are capped, so a timer that is never stopped cannot grow the map for ever. */
const TIMER_CAP = 256;

export class NetMetrics {
  readonly lanes = new Map<string, Lane>();
  private readonly fastRtt = new Map<string, Series>();
  private readonly reliableRtt = new Map<string, Series>();
  private readonly named = new Map<string, Series>();
  private readonly lastGap = new Map<string, number>();
  private readonly timers = new Map<string, Map<string | number, number>>();
  private readonly events = new Map<string, EventCount>();
  private readonly costs = new Map<string, Cost>();
  private since: number;

  constructor(private readonly clock: () => number = () => performance.now()) {
    this.since = clock();
  }

  lane(name: string, unreliable = false): Lane {
    let lane = this.lanes.get(name);
    if (!lane) this.lanes.set(name, (lane = new Lane(name, unreliable)));
    else if (unreliable) lane.unreliable = true;
    return lane;
  }

  rtt(peer: string, ms: number, fast: boolean): void {
    const map = fast ? this.fastRtt : this.reliableRtt;
    let series = map.get(peer);
    if (!series) map.set(peer, (series = new Series()));
    series.add(ms);
  }

  series(name: string): Series {
    let series = this.named.get(name);
    if (!series) this.named.set(name, (series = new Series()));
    return series;
  }

  sample(name: string, value: number): void {
    this.series(name).add(value);
  }

  /** Something named `name` just arrived: records the time since the one before. */
  gap(name: string, now = this.clock()): void {
    const last = this.lastGap.get(name);
    if (last !== undefined) this.series(name).add(now - last);
    this.lastGap.set(name, now);
  }

  /** Starts the named timer `name` for `key` (a shot id, an event id). */
  start(name: string, key: string | number = 0, now = this.clock()): void {
    let pending = this.timers.get(name);
    if (!pending) this.timers.set(name, (pending = new Map()));
    if (pending.size >= TIMER_CAP) pending.clear();
    pending.set(key, now);
  }

  /** Stops it and records the elapsed ms in the series `name`. Returns the ms, or -1 when no such timer runs. */
  stop(name: string, key: string | number = 0, now = this.clock()): number {
    const pending = this.timers.get(name);
    const started = pending?.get(key);
    if (started === undefined) return -1;
    pending!.delete(key);
    this.series(name).add(now - started);
    return now - started;
  }

  private eventOf(type: string): EventCount {
    let count = this.events.get(type);
    if (!count) this.events.set(type, (count = new EventCount()));
    return count;
  }

  /** An event of this type left on the reliable lane: `bytes` each, to `copies` peers. */
  event(type: string, bytes: number, copies = 1): void {
    const count = this.eventOf(type);
    count.out += copies;
    count.outBytes += bytes * copies;
  }

  /** An event of this type arrived. */
  heard(type: string, bytes = 0): void {
    const count = this.eventOf(type);
    count.in++;
    count.inBytes += bytes;
  }

  /** `ms` of work under `name` (co-op's own cost: `coop.update`, `coop.send`, `coop.receive`, `coop.flush`). */
  spend(name: string, ms: number): void {
    let cost = this.costs.get(name);
    if (!cost) this.costs.set(name, (cost = new Cost()));
    cost.ms += ms;
    cost.n++;
  }

  /** A new measuring window: every count back to zero. Lanes, peers and series stay. */
  reset(): void {
    this.since = this.clock();
    for (const lane of this.lanes.values()) {
      lane.gap.reset();
      for (const peer of lane.peers.values()) peer.reset();
    }
    for (const series of this.fastRtt.values()) series.reset();
    for (const series of this.reliableRtt.values()) series.reset();
    for (const series of this.named.values()) series.reset();
    this.lastGap.clear();
    for (const pending of this.timers.values()) pending.clear();
    for (const count of this.events.values()) count.reset();
    for (const cost of this.costs.values()) cost.ms = cost.n = 0;
  }

  snapshot(): MetricsSnapshot {
    const seconds = Math.max(0.001, (this.clock() - this.since) / 1000);
    const rate = (n: number) => Math.round(n / seconds);
    const read = (unreliable: boolean, peers: PeerLane[], gap: Series): LaneRead => {
      const sum = (pick: (p: PeerLane) => number) => peers.reduce((total, p) => total + pick(p), 0);
      const outBytes = sum(p => p.outBytes), outPackets = sum(p => p.outPackets), inBytes = sum(p => p.inBytes), inPackets = sum(p => p.inPackets);
      const lost = sum(p => p.lost), expected = sum(p => p.expected);
      return {
        unreliable,
        out: { bytes: outBytes, packets: outPackets, bytesPerSecond: rate(outBytes), packetsPerSecond: round(outPackets / seconds) },
        in: { bytes: inBytes, packets: inPackets, bytesPerSecond: rate(inBytes), packetsPerSecond: round(inPackets / seconds) },
        lost, expected, lossPercent: expected ? round((100 * lost) / expected) : 0,
        late: sum(p => p.late), fallback: sum(p => p.fallback), skipped: sum(p => p.skipped), gap: gap.read(),
      };
    };
    const lanes: MetricsSnapshot['lanes'] = {};
    let outBytes = 0, inBytes = 0;
    for (const lane of this.lanes.values()) {
      const peers: Record<string, LaneRead> = {};
      for (const [id, peer] of lane.peers) peers[id] = read(lane.unreliable, [peer], peer.gap);
      const all = read(lane.unreliable, [...lane.peers.values()], lane.gap);
      lanes[lane.name] = { ...all, peers };
      outBytes += all.out.bytes;
      inBytes += all.in.bytes;
    }
    const rtt: MetricsSnapshot['rtt'] = {};
    const empty = new Series();
    for (const id of new Set([...this.fastRtt.keys(), ...this.reliableRtt.keys()])) {
      rtt[id] = { fast: (this.fastRtt.get(id) ?? empty).read(), reliable: (this.reliableRtt.get(id) ?? empty).read() };
    }
    const series: MetricsSnapshot['series'] = {};
    for (const [name, s] of this.named) series[name] = s.read();
    const events: MetricsSnapshot['events'] = {};
    const eventRead = (n: number, bytes: number): EventRead => ({ n, bytes, perSecond: round(n / seconds), bytesPerSecond: rate(bytes), bytesEach: n ? round(bytes / n) : 0 });
    for (const [type, count] of this.events) if (count.out || count.in) events[type] = { out: eventRead(count.out, count.outBytes), in: eventRead(count.in, count.inBytes) };
    const costs: MetricsSnapshot['costs'] = {};
    for (const [name, cost] of this.costs) if (cost.n) costs[name] = { ms: round(cost.ms), n: cost.n, msPerSecond: round(cost.ms / seconds), msEach: Math.round((cost.ms / cost.n) * 10000) / 10000 };
    return { seconds: round(seconds), lanes, rtt, series, events, costs, totals: { outBytesPerSecond: rate(outBytes), inBytesPerSecond: rate(inBytes) } };
  }
}

/** This page's counters. */
export const metrics = new NetMetrics();
