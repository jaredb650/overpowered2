import { afterEach, describe, expect, it, vi } from 'vitest';
import { LaneRoom, sizeOf, type Wire } from './lanes';
import { NetMetrics } from './metrics';
import { NetSim } from './netsim';
import { BEHIND_BYTES, UNRELIABLE_MAX_BYTES } from './room';

/** Two wires joined back to back, delivering at once. `fast` switches the unreliable path; `drop` loses fast frames. */
function link() {
  const state = { fast: true, drop: false, queued: 0, reliableSent: [] as { lane: string; data: unknown }[], fastSent: 0 };
  const make = (self: string, other: () => Side): Side => {
    const side: Side = {
      id: self, lanes: new Map(), fastHandler: () => {}, joins: [], leaves: [],
      wire: {
        reliable: name => ({
          send: data => {
            state.reliableSent.push({ lane: name, data });
            // Objects cross as JSON, bytes as a Uint8Array, as on the real wire.
            const copy = data instanceof ArrayBuffer ? new Uint8Array(data.slice(0)) : data instanceof Uint8Array ? data.slice() : JSON.parse(JSON.stringify(data));
            for (const handler of other().lanes.get(name) ?? []) handler(copy, self);
          },
          on: handler => { side.lanes.set(name, [...(side.lanes.get(name) ?? []), handler]); },
        }),
        fastSend: (_to, frame) => {
          if (!state.fast) return false;
          state.fastSent++;
          if (!state.drop) other().fastHandler(frame.slice(), self);
          return true;
        },
        fastUp: () => state.fast,
        onFast: handler => { side.fastHandler = handler; },
        buffered: () => state.queued,
        onPeerJoin: handler => void side.joins.push(handler),
        onPeerLeave: handler => void side.leaves.push(handler),
        onError: () => {},
        leave: () => {},
      },
    };
    return side;
  };
  interface Side { id: string; lanes: Map<string, ((data: unknown, from: string) => void)[]>; fastHandler: (frame: Uint8Array, from: string) => void; joins: ((id: string) => void)[]; leaves: ((id: string) => void)[]; wire: Wire }
  const a: Side = make('a', () => b), b: Side = make('b', () => a);
  return { a, b, state, meet: () => { for (const h of a.joins) h('b'); for (const h of b.joins) h('a'); } };
}

const bytes = (...values: number[]) => new Uint8Array(values);

describe('the lane layer', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('a cut line (the simulator) sends nothing and hears nothing, on both kinds of lane; and a peer who leaves takes its frame count with it', () => {
    const { a, b, meet } = link();
    const sim = new NetSim();
    const left = new LaneRoom(a.wire, { metrics: null, sim }), right = new LaneRoom(b.wire, { metrics: null });
    meet();
    const heardRight: unknown[] = [], heardLeft: unknown[] = [];
    right.channel<{ n: number }>('lobby').on(data => heardRight.push(data));
    right.channel<Uint8Array>('pose', { unreliable: true }).on(data => heardRight.push([...data]));
    left.channel<{ n: number }>('lobby').on(data => heardLeft.push(data));
    sim.cut(true);
    left.channel<{ n: number }>('lobby').send({ n: 1 }, 'b');
    left.channel<Uint8Array>('pose', { unreliable: true }).send(bytes(7), 'b');
    right.channel<{ n: number }>('lobby').send({ n: 2 }, 'a');
    expect(heardRight).toEqual([]); expect(heardLeft).toEqual([]);
    sim.cut(false);
    left.channel<{ n: number }>('lobby').send({ n: 3 }, 'b');
    right.channel<{ n: number }>('lobby').send({ n: 4 }, 'a');
    expect(heardRight).toEqual([{ n: 3 }]); expect(heardLeft).toEqual([{ n: 4 }]);
    const seq = () => (left as unknown as { lanes: Map<string, { seq: Map<string, number> }> }).lanes.get('pose')!.seq;
    left.channel<Uint8Array>('pose', { unreliable: true }).send(bytes(8), 'b');
    expect(seq().has('b')).toBe(true);
    for (const h of a.leaves) h('b');
    expect(seq().has('b')).toBe(false);
  });

  it('carries a reliable lane as before: objects as objects, to the handler with the sender id', () => {
    const { a, b, meet } = link();
    const left = new LaneRoom(a.wire, { metrics: null }), right = new LaneRoom(b.wire, { metrics: null });
    meet();
    const got: unknown[] = [];
    right.channel<{ t: string }>('lobby').on((data, from) => got.push([data, from]));
    left.channel<{ t: string }>('lobby').send({ t: 'hello' }, 'b');
    left.channel<{ t: string }>('lobby').send({ t: 'all' });
    expect(got).toEqual([[{ t: 'hello' }, 'a'], [{ t: 'all' }, 'a']]);
  });

  it('sends an unreliable lane by the fast path, framed with the lane name and a sequence number', () => {
    const { a, b, state, meet } = link();
    const metrics = new NetMetrics(() => 0);
    const left = new LaneRoom(a.wire, { metrics: null }), right = new LaneRoom(b.wire, { metrics });
    meet();
    const got: Uint8Array[] = [];
    right.channel<Uint8Array>('pose', { unreliable: true }).on(data => got.push(data));
    const pose = left.channel<ArrayBuffer | Uint8Array>('pose', { unreliable: true });
    pose.send(bytes(1, 2, 3), 'b');
    pose.send(bytes(4, 5, 6).buffer, 'b');
    expect(got.map(g => [...g])).toEqual([[1, 2, 3], [4, 5, 6]]);
    expect(state.fastSent).toBe(2);
    expect(state.reliableSent).toEqual([]);
    expect(metrics.snapshot().lanes.pose).toMatchObject({ unreliable: true, in: { bytes: 6, packets: 2 }, lost: 0, expected: 2 });
  });

  it('falls back to the reliable path while the fast one is not up, and the same handler hears it', () => {
    const { a, b, state, meet } = link();
    const metrics = new NetMetrics(() => 0);
    const left = new LaneRoom(a.wire, { metrics }), right = new LaneRoom(b.wire, { metrics: null });
    meet();
    state.fast = false;
    const got: number[][] = [];
    right.channel<Uint8Array>('pose', { unreliable: true }).on(data => got.push([...new Uint8Array(data)]));
    const pose = left.channel<Uint8Array>('pose', { unreliable: true });
    pose.send(bytes(7, 8), 'b');
    expect(state.fastSent).toBe(0);
    expect(state.reliableSent.length).toBe(1);
    state.fast = true;
    pose.send(bytes(9), 'b');
    expect(got).toEqual([[7, 8], [9]]);
    expect(left.fast('b')).toBe(true);
    expect(metrics.snapshot().lanes.pose).toMatchObject({ out: { packets: 2, bytes: 3 }, fallback: 1 });
  });

  it('sends what is not bytes, or is too large, by the reliable path', () => {
    const { a, b, state, meet } = link();
    const left = new LaneRoom(a.wire, { metrics: null }), right = new LaneRoom(b.wire, { metrics: null });
    meet();
    const got: unknown[] = [];
    right.channel<unknown>('world', { unreliable: true }).on(data => got.push(data instanceof Uint8Array ? data.byteLength : data));
    const world = left.channel<unknown>('world', { unreliable: true });
    world.send({ match: 'm', data: 1 }, 'b');
    world.send(new Uint8Array(UNRELIABLE_MAX_BYTES + 1), 'b');
    world.send(new Uint8Array(UNRELIABLE_MAX_BYTES), 'b');
    expect(got).toEqual([{ match: 'm', data: 1 }, UNRELIABLE_MAX_BYTES + 1, UNRELIABLE_MAX_BYTES]);
    expect(state.fastSent).toBe(1);
  });

  it('counts fast frames that never arrive as loss', () => {
    const { a, b, state, meet } = link();
    const metrics = new NetMetrics(() => 0);
    const left = new LaneRoom(a.wire, { metrics: null }), right = new LaneRoom(b.wire, { metrics });
    meet();
    right.channel<Uint8Array>('pose', { unreliable: true }).on(() => {});
    const pose = left.channel<Uint8Array>('pose', { unreliable: true });
    for (let i = 0; i < 10; i++) { state.drop = i === 3 || i === 4 || i === 7; pose.send(bytes(i), 'b'); }
    expect(metrics.snapshot().lanes.pose).toMatchObject({ lost: 3, expected: 10, lossPercent: 30, in: { packets: 7 } });
  });

  it('under the simulator a reliable lane arrives late and whole, an unreliable one can be lost', () => {
    let now = 0;
    const rolls = [0, 0.9, 0.01, 0.9, 0];
    const sim = new NetSim(() => now, () => rolls.shift() ?? 0.5, { set: () => 0, clear: () => {} });
    sim.set({ lag: 100, loss: 0.05 });
    const { a, b, meet } = link();
    const left = new LaneRoom(a.wire, { metrics: null, sim, now: () => now }), right = new LaneRoom(b.wire, { metrics: null });
    meet();
    const got: unknown[] = [];
    right.channel<unknown>('lobby').on(data => got.push(data));
    right.channel<Uint8Array>('pose', { unreliable: true }).on(data => got.push([...data]));
    const players = [{ name: 'A' }];
    left.channel<unknown>('lobby').send({ players }, 'b');
    players[0]!.name = 'CHANGED AFTER SENDING';
    left.channel<Uint8Array>('pose', { unreliable: true }).send(bytes(1), 'b'); // lost
    left.channel<Uint8Array>('pose', { unreliable: true }).send(bytes(2), 'b');
    left.pump();
    expect(got).toEqual([]);
    now = 100;
    left.pump();
    expect(got).toEqual([{ players: [{ name: 'A' }] }, [2]]);
    expect(sim.stats).toMatchObject({ dropped: 1 });
  });

  it('skips a latest-wins message for a peer that is behind, and counts it', () => {
    const { a, b, state, meet } = link();
    const metrics = new NetMetrics(() => 0);
    const left = new LaneRoom(a.wire, { metrics }), right = new LaneRoom(b.wire, { metrics: null });
    meet();
    const got: number[] = [];
    right.channel<Uint8Array>('pose', { unreliable: true }).on(data => got.push(data[0]!));
    right.channel<Uint8Array>('events').on(data => got.push(data[0]!));
    const pose = left.channel<Uint8Array>('pose', { unreliable: true, latest: true });
    pose.send(bytes(1), 'b');
    state.queued = BEHIND_BYTES + 1;
    expect(left.buffered('b', true)).toBe(BEHIND_BYTES + 1);
    pose.send(bytes(2), 'b');
    left.channel<Uint8Array>('events').send(bytes(3), 'b'); // not latest-wins: always sent
    state.queued = 0;
    pose.send(bytes(4), 'b');
    expect(got).toEqual([1, 3, 4]);
    expect(metrics.snapshot().lanes.pose).toMatchObject({ skipped: 1, out: { packets: 2 } });
  });

  it('measures the round trip on both paths, through the simulator', () => {
    vi.useFakeTimers();
    let now = 0;
    const tick = (ms: number) => { now += ms; vi.advanceTimersByTime(ms); };
    const sim = new NetSim(() => now, () => 0);
    sim.set({ lag: 40 });
    const { a, b, state, meet } = link();
    const metrics = new NetMetrics(() => now);
    const left = new LaneRoom(a.wire, { metrics, sim, now: () => now, ping: true });
    const right = new LaneRoom(b.wire, { metrics: new NetMetrics(() => now), sim, now: () => now, ping: true });
    meet();
    // Small steps: the hand-turned clock and the fake timers move together.
    for (let i = 0; i < 300; i++) tick(10);
    const rtt = metrics.snapshot().rtt.b!;
    expect(rtt.fast.n).toBeGreaterThanOrEqual(2);
    expect(rtt.fast.p50).toBe(80);
    expect(rtt.reliable.p50).toBe(80);
    // No fast path: only the reliable round trip is measured.
    state.fast = false;
    metrics.reset();
    for (let i = 0; i < 300; i++) tick(10);
    expect(metrics.snapshot().rtt.b).toMatchObject({ fast: { n: 0 } });
    expect(metrics.snapshot().rtt.b!.reliable.n).toBeGreaterThanOrEqual(2);
    left.leave(); right.leave();
  });

  it('a handler that throws never stops the others or the room', () => {
    const { a, b, meet } = link();
    const left = new LaneRoom(a.wire, { metrics: null }), right = new LaneRoom(b.wire, { metrics: null });
    meet();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const got: unknown[] = [];
    const ch = right.channel<number>('action');
    ch.on(() => { throw new Error('malformed'); });
    ch.on(data => got.push(data));
    left.channel<number>('action').send(5, 'b');
    left.channel<number>('action').send(6, 'b');
    expect(got).toEqual([5, 6]);
    warn.mockRestore();
  });

  it('sends nothing after leaving, even what the simulator still held', () => {
    let now = 0;
    const sim = new NetSim(() => now, () => 0, { set: () => 0, clear: () => {} });
    sim.set({ lag: 50 });
    const { a, b, state, meet } = link();
    const left = new LaneRoom(a.wire, { metrics: null, sim }), right = new LaneRoom(b.wire, { metrics: null });
    meet();
    right.channel<number>('action').on(() => {});
    left.channel<number>('action').send(1, 'b');
    left.leave();
    now = 100; sim.pump();
    left.channel<number>('action').send(2, 'b');
    expect(state.reliableSent).toEqual([]);
  });

  it('sizes messages as bytes or as their JSON', () => {
    expect(sizeOf(new Uint8Array(45))).toBe(45);
    expect(sizeOf(new ArrayBuffer(12))).toBe(12);
    expect(sizeOf({ t: 'hi' })).toBe(10);
    expect(sizeOf(undefined)).toBe(0);
  });

  it('refuses a lane name that could not be framed', () => {
    const { a } = link();
    const room = new LaneRoom(a.wire, { metrics: null });
    expect(() => room.channel('')).toThrow();
    expect(() => room.channel('x'.repeat(33))).toThrow();
    expect(() => room.channel('pösé')).toThrow();
  });
});
