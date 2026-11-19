import { describe, expect, it } from 'vitest';
import { NetMetrics, Series } from './metrics';

describe('net metrics', () => {
  it('reads a series as count, mean, percentiles and max', () => {
    const s = new Series();
    for (let i = 1; i <= 100; i++) s.add(i);
    expect(s.read()).toMatchObject({ n: 100, mean: 50.5, p50: 51, p90: 91, max: 100, last: 100 });
    s.reset();
    expect(s.read().n).toBe(0);
  });

  it('keeps counting past the ring, with percentiles of the latest values', () => {
    const s = new Series();
    for (let i = 0; i < 2000; i++) s.add(i < 1500 ? 1000 : 5);
    const read = s.read();
    expect(read.n).toBe(2000);
    expect(read.max).toBe(1000);
    expect(read.p50).toBe(5);
  });

  it('counts bytes and packets per lane and peer, both ways, as rates over the window', () => {
    let now = 0;
    const m = new NetMetrics(() => now);
    const pose = m.lane('pose', true);
    for (let i = 0; i < 20; i++) { pose.peer('a').out(45); pose.peer('b').out(45); }
    for (let i = 0; i < 10; i++) { now += 100; pose.peer('a').in(45, now); }
    m.lane('action').peer('a').out(400);
    now = 1000;
    const snap = m.snapshot();
    expect(snap.seconds).toBe(1);
    expect(snap.lanes.pose).toMatchObject({ unreliable: true, out: { bytes: 1800, packets: 40, bytesPerSecond: 1800 }, in: { bytes: 450, packets: 10 } });
    expect(snap.lanes.pose!.peers.a!.out.bytes).toBe(900);
    expect(snap.lanes.pose!.gap).toMatchObject({ n: 9, p50: 100, max: 100 });
    expect(snap.lanes.action!.unreliable).toBe(false);
    expect(snap.totals.outBytesPerSecond).toBe(2200);
  });

  it('counts unreliable loss and late packets from sequence numbers, across the 16-bit wrap', () => {
    const m = new NetMetrics(() => 0);
    const peer = m.lane('pose', true).peer('a');
    for (const seq of [65533, 65534, 0, 1, 3, 2, 6]) peer.sequence(seq);
    // 65535, 4 and 5 never came; 2 came after 3.
    expect(peer.lost).toBe(3);
    expect(peer.late).toBe(1);
    expect(peer.expected).toBe(10);
    expect(m.snapshot().lanes.pose).toMatchObject({ lost: 3, expected: 10, lossPercent: 30, late: 1 });
  });

  it('records round trips per peer and path', () => {
    const m = new NetMetrics(() => 0);
    m.rtt('a', 40, true); m.rtt('a', 60, true); m.rtt('a', 300, false);
    expect(m.snapshot().rtt.a).toMatchObject({ fast: { n: 2, mean: 50, max: 60 }, reliable: { n: 1, last: 300 } });
  });

  it('offers gaps, samples and named timers to later code', () => {
    let now = 1000;
    const m = new NetMetrics(() => now);
    m.gap('snapshot'); now += 50; m.gap('snapshot'); now += 150; m.gap('snapshot');
    m.sample('enemies', 31);
    m.start('shot', 7); now += 80;
    expect(m.stop('shot', 7)).toBe(80);
    expect(m.stop('shot', 7)).toBe(-1);
    const snap = m.snapshot();
    expect(snap.series.snapshot).toMatchObject({ n: 2, max: 150 });
    expect(snap.series.enemies!.last).toBe(31);
    expect(snap.series.shot).toMatchObject({ n: 1, last: 80 });
  });

  it('never lets unstopped timers grow without limit', () => {
    const m = new NetMetrics(() => 0);
    for (let i = 0; i < 2000; i++) m.start('shot', i);
    expect(m.stop('shot', 0)).toBe(-1);
    expect(m.stop('shot', 1999)).toBe(0);
  });

  it('resets to a new window and keeps its lanes', () => {
    let now = 0;
    const m = new NetMetrics(() => now);
    const peer = m.lane('world', true).peer('h');
    peer.out(100); peer.in(100, 5); peer.sequence(1); peer.sequence(5);
    m.sample('x', 1); m.rtt('h', 30, true);
    now = 5000;
    m.reset();
    now = 6000;
    const snap = m.snapshot();
    expect(snap.seconds).toBe(1);
    expect(snap.lanes.world).toMatchObject({ out: { bytes: 0 }, in: { bytes: 0 }, lost: 0, expected: 0 });
    expect(snap.series.x!.n).toBe(0);
    expect(snap.rtt.h!.fast.n).toBe(0);
    peer.sequence(9);
    expect(peer.lost).toBe(0);
  });
});
