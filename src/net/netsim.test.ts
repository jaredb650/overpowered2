import { describe, expect, it } from 'vitest';
import { NetSim, parseSim } from './netsim';

/** A simulator on a hand-turned clock, with a chosen run of "random" numbers (then 0.5 for ever). */
function rig(randoms: number[] = []) {
  let now = 0;
  const timers: { at: number; fn: () => void }[] = [];
  const sim = new NetSim(() => now, () => randoms.shift() ?? 0.5, {
    set: (fn, ms) => { const t = { at: now + ms, fn }; timers.push(t); return t; },
    clear: handle => { const i = timers.indexOf(handle as typeof timers[number]); if (i >= 0) timers.splice(i, 1); },
  });
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      now = next.at;
      next.fn();
    }
    now = end;
  };
  return { sim, advance, time: () => now };
}

describe('network simulator', () => {
  it('reads its settings from text', () => {
    expect(parseSim('lag:80,jitter:30,loss:0.03')).toEqual({ lag: 80, jitter: 30, loss: 0.03 });
    expect(parseSim('lag=150 loss=5 stall=400 kbps=256')).toEqual({ lag: 150, loss: 0.05, stall: 400, kbps: 256 });
    expect(parseSim('lag:abc,wat:3,jitter:-4')).toEqual({});
    expect(parseSim('off')).toMatchObject({ lag: 0, jitter: 0, loss: 0, kbps: 0 });
    expect(parseSim(null)).toEqual({});
  });

  it('is off until asked, and set() merges', () => {
    const { sim } = rig();
    expect(sim.active).toBe(false);
    sim.set('lag:80');
    sim.set({ loss: 0.1 });
    expect(sim.get()).toMatchObject({ lag: 80, loss: 0.1, stall: 300 });
    expect(sim.active).toBe(true);
    sim.set('off');
    expect(sim.active).toBe(false);
  });

  it('delays a reliable message by the lag plus jitter', () => {
    const { sim, advance } = rig([0.5, 0.9]);
    sim.set({ lag: 80, jitter: 30, loss: 0.03 });
    const got: number[] = [];
    sim.reliable('a', 100, () => got.push(1));
    advance(94);
    expect(got).toEqual([]);
    advance(1);
    expect(got).toEqual([1]);
  });

  it('turns loss on a reliable lane into a resend delay that holds back what follows, in order', () => {
    // First message: jitter 0, lost once (0.01 < loss), then through. The second would be early; it waits behind the first.
    const { sim, advance } = rig([0, 0.01, 0.9, 0, 0.9]);
    sim.set({ lag: 50, jitter: 10, loss: 0.05, stall: 300 });
    const got: string[] = [];
    sim.reliable('a', 10, () => got.push('first'));
    sim.reliable('a', 10, () => got.push('second'));
    sim.reliable('b', 10, () => got.push('other peer'));
    advance(60);
    expect(got).toEqual(['other peer']);
    advance(289);
    expect(got).toEqual(['other peer']);
    advance(1);
    expect(got).toEqual(['other peer', 'first', 'second']);
    expect(sim.stats.resent).toBe(1);
    expect(sim.stats.dropped).toBe(0);
  });

  it('really drops on an unreliable lane, and lets a later message overtake an earlier one', () => {
    // loss roll then jitter roll per message: dropped; kept with full jitter; kept with none.
    const { sim, advance } = rig([0.01, 0.9, 1, 0.9, 0]);
    sim.set({ lag: 20, jitter: 40, loss: 0.05 });
    const got: string[] = [];
    expect(sim.unreliable('a', 10, () => got.push('lost'))).toBe(false);
    expect(sim.unreliable('a', 10, () => got.push('slow'))).toBe(true);
    expect(sim.unreliable('a', 10, () => got.push('quick'))).toBe(true);
    advance(100);
    expect(got).toEqual(['quick', 'slow']);
    expect(sim.stats.dropped).toBe(1);
  });

  it('loses about the asked share of unreliable packets', () => {
    let seed = 12345;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const sim = new NetSim(() => 0, random, { set: () => 0, clear: () => {} });
    sim.set({ loss: 0.2 });
    let kept = 0;
    for (let i = 0; i < 5000; i++) if (sim.unreliable('a', 10, () => {})) kept++;
    expect(kept).toBeGreaterThan(3850);
    expect(kept).toBeLessThan(4150);
  });

  it('queues behind a slow link, and says how much', () => {
    const { sim, advance } = rig();
    sim.set({ kbps: 80 }); // 10,000 bytes a second
    const got: number[] = [];
    for (let i = 0; i < 5; i++) sim.reliable('a', 1000, () => got.push(i));
    expect(Math.round(sim.buffered('a'))).toBe(5000);
    expect(sim.buffered('b')).toBe(0);
    advance(250);
    expect(got).toEqual([0, 1]);
    expect(Math.round(sim.buffered('a'))).toBe(2500);
    advance(250);
    expect(got).toEqual([0, 1, 2, 3, 4]);
    expect(sim.buffered('a')).toBe(0);
  });

  it('sends what is due when pumped, without waiting for its timer', () => {
    let now = 0;
    const sim = new NetSim(() => now, () => 0, { set: () => 0, clear: () => {} });
    sim.set({ lag: 100 });
    const got: number[] = [];
    sim.reliable('a', 1, () => got.push(1));
    sim.unreliable('a', 1, () => got.push(2));
    now = 99; sim.pump();
    expect(got).toEqual([]);
    expect(sim.pending).toBe(2);
    now = 100; sim.pump();
    expect(got).toEqual([1, 2]);
  });

  it('a cut line drops everything it is given, reliable lanes included, until it is back', () => {
    const { sim, advance } = rig();
    const got: number[] = [];
    sim.cut(true);
    expect(sim.active).toBe(true);
    sim.reliable('a', 1, () => got.push(1));
    expect(sim.unreliable('a', 1, () => got.push(2))).toBe(false);
    advance(5000);
    expect(got).toEqual([]);
    expect(sim.stats.dropped).toBe(2);
    sim.cut(false);
    expect(sim.active).toBe(false);
    sim.reliable('a', 1, () => got.push(3));
    advance(10);
    // What was said while it was down is gone for good; what is said now arrives.
    expect(got).toEqual([3]);
    // Not a setting: it is not carried into the next page's address.
    sim.cut(true);
    expect(sim.get()).not.toHaveProperty('down');
  });

  it('keeps going when a delayed send throws', () => {
    const { sim, advance } = rig();
    sim.set({ lag: 10 });
    const got: number[] = [];
    sim.reliable('a', 1, () => { throw new Error('closed'); });
    sim.reliable('a', 1, () => got.push(2));
    advance(20);
    expect(got).toEqual([2]);
  });
  it('throttles the link to one peer and leaves the others alone; what was queued still leaves at the old speed', () => {
    const { sim, advance } = rig();
    expect(sim.active).toBe(false);
    sim.throttle('slow', 8);
    expect(sim.active).toBe(true);
    const got: string[] = [];
    // 1,000 bytes at 8 kbit/s is a second each.
    for (let i = 0; i < 3; i++) sim.reliable('slow', 1000, () => got.push(`slow${i}`));
    sim.reliable('fine', 1000, () => got.push('fine'));
    expect(sim.buffered('slow')).toBe(3000);
    expect(sim.buffered('fine')).toBe(0);
    advance(1);
    expect(got).toEqual(['fine']);
    advance(1000);
    expect(got).toEqual(['fine', 'slow0']);
    expect(sim.buffered('slow')).toBeCloseTo(1999, 0);
    // The throttle is lifted: the queue is still there, and drains as it was filled.
    sim.throttle('slow', 0);
    expect(sim.buffered('slow')).toBeCloseTo(1999, 0);
    sim.reliable('slow', 10, () => got.push('after'));
    advance(2000);
    expect(got).toEqual(['fine', 'slow0', 'slow1', 'slow2', 'after']);
    expect(sim.buffered('slow')).toBe(0);
    expect(sim.active).toBe(false);
  });
  it('keeps a reliable lane in order when it is switched off with messages still in the air', () => {
    const { sim, advance } = rig();
    sim.set('lag:200');
    const got: string[] = [];
    sim.reliable('p', 10, () => got.push('delayed'));
    sim.set('off');
    // Something is still in the air, so the lane layer must keep asking (lanes.ts sends at once when the simulator is idle).
    expect(sim.active).toBe(true);
    sim.reliable('p', 10, () => got.push('sent after'));
    advance(100);
    expect(got).toEqual([]);
    advance(101);
    expect(got).toEqual(['delayed', 'sent after']);
    expect(sim.active).toBe(false);
  });
});
