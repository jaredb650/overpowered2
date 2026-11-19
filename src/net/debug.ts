/**
 * `window.__op2.net`: the network side for scripts, proofs and the console.
 *
 *   __op2.net.transport            'loop' or 'rtc'
 *   __op2.net.sim.set('lag:80,jitter:30,loss:0.03')    the simulator (netsim.ts); .get(), .set('off'), .stats
 *   __op2.net.metrics              the counters (metrics.ts): .reset(), .sample(), .gap(), .start(), .stop()
 *   __op2.net.snapshot()           everything as plain JSON: lanes, round trips, series, the simulator, which peers have
 *                                  the unreliable path up, and co-op's own frame cost
 *
 * The game makes `window.__op2` when it boots, after a match page has already reconnected its room, so this is attached
 * each time a lobby opens and again when a match begins.
 */
import { metrics, type MetricsSnapshot } from './metrics';
import { transportName } from './mode';
import { pageSim, type SimSettings } from './netsim';
import type { NetRoom } from './room';

export interface NetSnapshot extends MetricsSnapshot {
  transport: 'loop' | 'rtc';
  sim: SimSettings & { delayed: number; dropped: number; resent: number; pending: number };
  /** Per peer: is the unreliable path up (false: its lanes ride the reliable one), and what is queued for it. */
  peers: Record<string, { fast: boolean; bufferedReliable: number; bufferedUnreliable: number }>;
  /** What co-op itself costs a frame, ms, averaged (`CoopSession.cpuMs`); null outside a match. */
  coopMs: number | null;
}

let room: NetRoom | null = null;
let cost: (() => number) | null = null;

/** The room whose peers `snapshot()` describes: the lobby's main room, set when it opens. */
export function watchNet(current: NetRoom | null): void {
  room = current;
}

/** The match's cost meter, set when a match begins. */
export function watchCost(coopMs: (() => number) | null): void {
  cost = coopMs;
}

export function netSnapshot(): NetSnapshot {
  const sim = pageSim();
  const base = metrics.snapshot();
  const peers: NetSnapshot['peers'] = {};
  const ids = new Set<string>();
  for (const lane of metrics.lanes.values()) for (const id of lane.peers.keys()) ids.add(id);
  for (const id of ids) {
    peers[id] = { fast: room?.fast?.(id) ?? false, bufferedReliable: Math.round(room?.buffered?.(id, false) ?? 0), bufferedUnreliable: Math.round(room?.buffered?.(id, true) ?? 0) };
  }
  return { ...base, transport: transportName(), sim: { ...sim.get(), ...sim.stats, pending: sim.pending }, peers, coopMs: cost ? Math.round(cost() * 1000) / 1000 : null };
}

const api = {
  get transport() { return transportName(); },
  get sim() { return pageSim(); },
  metrics,
  snapshot: netSnapshot,
};

export function publishNet(): void {
  if (typeof window === 'undefined') return;
  // Only onto the game's own object, never one made here: scripts read `window.__op2?.ctx` and expect all of it or nothing.
  const page = (window as unknown as { __op2?: Record<string, unknown> }).__op2;
  if (page) page.net = api;
}
