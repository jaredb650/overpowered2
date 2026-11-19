/**
 * A bad network, inside the game: everything this page sends to other players can be delayed, jittered, lost or squeezed
 * through a slow link. It works the same on real WebRTC and on the loopback transport, since the lane layer (lanes.ts)
 * asks it when each outgoing message may really leave.
 *
 *   ?netsim=lag:80,jitter:30,loss:0.03            in the address, read when the page loads
 *   window.__op2.net.sim.set('lag:150,loss:0.1')  while playing (also an object: { lag: 150 }); set('off') clears it
 *
 *   lag     ms added to every message this page sends
 *   jitter  up to this many more ms, at random per message
 *   loss    share of packets lost, 0 to 1 (a number above 1 is read as a percentage)
 *   stall   ms a reliable lane takes to resend a lost packet (default 300)
 *   kbps    the page's upload speed to each peer; what does not fit queues up, and the peer reads as behind
 *
 * The two lane kinds suffer differently, as they do for real. A reliable lane never loses or reorders: a lost packet
 * costs `stall` more ms, and every later reliable message to that peer waits behind it. An unreliable lane really drops
 * a lost message, and jitter lets a later message overtake an earlier one.
 *
 * It is per page and one way: to feel 80 ms each way, set lag 80 on both pages. Off unless asked for.
 *
 *   window.__op2.net.sim.cut(true)    a dead line: nothing this page sends leaves it and nothing arrives, reliable lanes
 *                                     included, and neither end is told (a real connection that dies loses what was in
 *                                     flight). cut(false) brings it back; what was said meanwhile is gone for good. Not a
 *                                     setting: it is never carried to the next page.
 */

import { NETSIM } from './mode';

export interface SimSettings {
  lag: number;
  jitter: number;
  loss: number;
  stall: number;
  kbps: number;
}

export const SIM_OFF: SimSettings = { lag: 0, jitter: 0, loss: 0, stall: 300, kbps: 0 };

/** 'lag:80,jitter:30,loss:0.03' (also with = and spaces) to settings. Unknown words and bad numbers are ignored. */
export function parseSim(text: string | null | undefined): Partial<SimSettings> {
  const out: Partial<SimSettings> = {};
  if (!text) return out;
  if (/^\s*(off|none|0)\s*$/i.test(text)) return { ...SIM_OFF };
  for (const part of text.split(/[,;\s]+/)) {
    const [key, raw] = part.split(/[:=]/);
    const value = Number(raw);
    if (!key || !Number.isFinite(value) || value < 0) continue;
    if (key === 'lag' || key === 'jitter' || key === 'stall') out[key] = Math.min(value, 10_000);
    else if (key === 'loss') out.loss = Math.min(0.95, value > 1 ? value / 100 : value);
    else if (key === 'kbps') out.kbps = value;
  }
  return out;
}

interface Due { at: number; n: number; run: () => void }

type Timer = { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };

export class NetSim implements SimSettings {
  lag = 0;
  jitter = 0;
  loss = 0;
  stall = SIM_OFF.stall;
  kbps = 0;
  /** The line is dead (`cut`): everything sent or arriving is dropped. */
  down = false;
  /** What it has done since the page loaded. */
  readonly stats = { delayed: 0, dropped: 0, resent: 0 };
  /** A binary heap of what is still in the air, earliest first; ties leave in the order they were sent. */
  private readonly heap: Due[] = [];
  private count = 0;
  /** Per peer: when its reliable stream is free again, and when the slow link has sent what is queued. */
  private readonly reliableFree = new Map<string, number>();
  private readonly linkFree = new Map<string, number>();
  private handle: unknown = null;
  private handleAt = Infinity;

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly random: () => number = Math.random,
    private readonly timer: Timer = { set: (fn, ms) => setTimeout(fn, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
  ) {}

  get active(): boolean {
    return this.down || this.lag > 0 || this.jitter > 0 || this.loss > 0 || this.kbps > 0;
  }

  /** A dead line, or the line back. */
  cut(on: boolean): void {
    this.down = on;
  }

  set(settings: Partial<SimSettings> | string): SimSettings {
    Object.assign(this, typeof settings === 'string' ? parseSim(settings) : parseSim(Object.entries(settings).map(([k, v]) => `${k}:${v}`).join(',')));
    return this.get();
  }

  get(): SimSettings {
    return { lag: this.lag, jitter: this.jitter, loss: this.loss, stall: this.stall, kbps: this.kbps };
  }

  /** When the slow link lets a message of `bytes` out to `peer`: now, unless `kbps` is set and the link is busy. */
  private link(peer: string, bytes: number, now: number): number {
    if (!(this.kbps > 0)) return now;
    const start = Math.max(now, this.linkFree.get(peer) ?? 0);
    const end = start + (bytes * 8) / this.kbps;
    this.linkFree.set(peer, end);
    return end;
  }

  /** Bytes still queued for `peer` behind the slow link. */
  buffered(peer: string): number {
    if (!(this.kbps > 0)) return 0;
    return Math.max(0, ((this.linkFree.get(peer) ?? 0) - this.now()) * this.kbps / 8);
  }

  /** A message on a reliable lane: `deliver` runs late, never out of order for this peer, never dropped. */
  reliable(peer: string, bytes: number, deliver: () => void): void {
    if (this.down) { this.stats.dropped++; return; }
    const now = this.now();
    let at = this.link(peer, bytes, now) + this.lag + this.random() * this.jitter;
    // A lost packet is sent again after `stall`; the resend can be lost too.
    for (let tries = 0; tries < 8 && this.random() < this.loss; tries++) {
      at += this.stall;
      this.stats.resent++;
    }
    at = Math.max(at, this.reliableFree.get(peer) ?? 0);
    this.reliableFree.set(peer, at);
    this.push(at, deliver);
  }

  /** A message on an unreliable lane: lost (false, `deliver` never runs) or late on its own, whatever the others do. */
  unreliable(peer: string, bytes: number, deliver: () => void): boolean {
    if (this.down || this.random() < this.loss) {
      this.stats.dropped++;
      return false;
    }
    this.push(this.link(peer, bytes, this.now()) + this.lag + this.random() * this.jitter, deliver);
    return true;
  }

  private push(at: number, run: () => void): void {
    this.stats.delayed++;
    const heap = this.heap;
    const item: Due = { at, n: this.count++, run };
    let i = heap.length;
    heap.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(item, heap[parent]!)) break;
      heap[i] = heap[parent]!;
      i = parent;
    }
    heap[i] = item;
    this.arm();
  }

  private pop(): Due {
    const heap = this.heap;
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= heap.length) break;
        if (child + 1 < heap.length && before(heap[child + 1]!, heap[child]!)) child++;
        if (!before(heap[child]!, last)) break;
        heap[i] = heap[child]!;
        i = child;
      }
      heap[i] = last;
    }
    return top;
  }

  /** Sends everything that is due. A timer calls it; so does the game each frame, as a hidden tab's timers are throttled. */
  pump(): void {
    const now = this.now();
    while (this.heap.length && this.heap[0]!.at <= now) {
      const due = this.pop();
      try { due.run(); } catch (error) { console.warn('[netsim] a delayed send failed', error); }
    }
    this.arm();
  }

  private arm(): void {
    const next = this.heap[0];
    if (!next) return;
    if (this.handle !== null && this.handleAt <= next.at) return;
    if (this.handle !== null) this.timer.clear(this.handle);
    this.handleAt = next.at;
    this.handle = this.timer.set(() => {
      this.handle = null;
      this.handleAt = Infinity;
      this.pump();
    }, Math.max(0, next.at - this.now()));
  }

  /** How many messages are in the air. */
  get pending(): number {
    return this.heap.length;
  }
}

const before = (a: Due, b: Due): boolean => a.at < b.at || (a.at === b.at && a.n < b.n);

let page: NetSim | null = null;

/** This page's simulator, set from `?netsim=` as the page loaded with it (mode.ts). */
export function pageSim(): NetSim {
  if (!page) {
    page = new NetSim();
    if (NETSIM) {
      page.set(NETSIM);
      console.info('[coop] Network simulator on:', JSON.stringify(page.get()));
    }
  }
  return page;
}

/** The simulator's settings as `?netsim=` text, or '' when it does nothing: carried from the lobby page into the match page. */
export function simText(sim: NetSim = pageSim()): string {
  if (!sim.active) return '';
  const s = sim.get();
  return `lag:${s.lag},jitter:${s.jitter},loss:${s.loss},stall:${s.stall},kbps:${s.kbps}`;
}
