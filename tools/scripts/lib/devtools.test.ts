import { describe, expect, it } from 'vitest';
// @ts-expect-error standalone Node JavaScript tool
import { verdict } from './glmem.mjs';
// @ts-expect-error standalone Node JavaScript tool
import { summarise } from './trace.mjs';

const MB = 1048576;

describe('leak soak verdict (tools/scripts/lib/glmem.mjs)', () => {
  const run = (values: number[], name = 'gpuTotal') => verdict(values.map(v => ({ [name]: v })), { warm: 1 });
  it('calls a number that comes back flat, and leaves the warm-up round out', () => {
    const r = run([10 * MB, 300 * MB, 300.2 * MB, 299.9 * MB, 300.5 * MB, 300.1 * MB]);
    expect(r.metrics.gpuTotal).toMatchObject({ first: 300 * MB, verdict: 'flat' });
    expect(r).toMatchObject({ rounds: 5, growing: [], holds: true });
  });
  it('calls steady growth a leak, with the amount per round', () => {
    const r = run([0, 300 * MB, 312 * MB, 324 * MB, 336 * MB, 348 * MB]);
    expect(r.metrics.gpuTotal).toMatchObject({ verdict: 'grows', growth: 48 * MB, perRound: 12 * MB });
    expect(r).toMatchObject({ growing: ['gpuTotal'], holds: false });
  });
  it('tells a pool that filled and then held (step) from a leak, and sees a fall', () => {
    expect(run([0, 300 * MB, 340 * MB, 340 * MB, 340 * MB, 340.1 * MB]).metrics.gpuTotal.verdict).toBe('step');
    expect(run([0, 300 * MB, 340 * MB, 340 * MB, 340 * MB, 340.1 * MB]).holds).toBe(true);
    expect(run([0, 300 * MB, 250 * MB, 250 * MB, 250 * MB]).metrics.gpuTotal.verdict).toBe('shrinks');
  });
  it('judges counts by count: a few objects either way is flat, a steady climb is not', () => {
    expect(run([0, 500, 502, 499, 503], 'nTexture').metrics.nTexture.verdict).toBe('flat');
    expect(run([0, 500, 540, 580, 620, 660], 'nTexture').metrics.nTexture.verdict).toBe('grows');
  });
  it('gives no verdict on too few rounds and skips what is not a number', () => {
    expect(run([0, 1, 2])).toMatchObject({ holds: null });
    const r = verdict([{ a: 1, heap: null }, { a: 1, heap: null }, { a: 1, heap: null }, { a: 1, heap: null }], { warm: 1 });
    expect(Object.keys(r.metrics)).toEqual(['a']);
  });
});

describe('performance trace summary (tools/scripts/lib/trace.mjs)', () => {
  /** 10 frames 16.7 ms apart doing 4 ms of work, but frame 6 does 40 ms, of which 30 ms is in `slowThing` and 5 ms is a GC. */
  const trace = () => {
    const events: Record<string, unknown>[] = [];
    const main = { pid: 1, tid: 7 };
    let ts = 1_000_000;
    const nodes = [
      { id: 1, callFrame: { functionName: '(root)' } },
      { id: 2, parent: 1, callFrame: { functionName: 'tick', url: 'http://127.0.0.1:5420/src/core/Game.ts?t=1', lineNumber: 181 } },
      { id: 3, parent: 2, callFrame: { functionName: 'slowThing', url: 'http://127.0.0.1:5420/src/gore/index.ts', lineNumber: 41 } },
      { id: 4, parent: 1, callFrame: { functionName: '(idle)' } },
    ];
    events.push({ ...main, name: 'Profile', ph: 'P', id: '0x1', ts, args: { data: { startTime: ts } } });
    const samples: number[] = [];
    const deltas: number[] = [];
    for (let frame = 0; frame < 10; frame++) {
      const slow = frame === 6;
      const work = slow ? 40_000 : 4_000;
      events.push({ ...main, name: 'FireAnimationFrame', ph: 'X', ts, dur: work });
      // One sample a millisecond while working, then one idle sample for the rest of the frame.
      for (let t = 0; t < work / 1000; t++) { samples.push(slow && t < 30 ? 3 : 2); deltas.push(1000); }
      const rest = (slow ? 50_000 : 16_700) - work;
      samples.push(4); deltas.push(rest);
      if (slow) events.push({ ...main, name: 'MinorGC', ph: 'X', ts: ts + 31_000, dur: 5_000 });
      ts += slow ? 50_000 : 16_700;
    }
    events.push({ ...main, name: 'ProfileChunk', ph: 'P', id: '0x1', ts, args: { data: { cpuProfile: { nodes, samples }, timeDeltas: deltas } } });
    // Another thread's frames and samples must not count.
    events.push({ pid: 1, tid: 9, name: 'FireAnimationFrame', ph: 'X', ts: 1_000_000, dur: 900_000 });
    return events;
  };

  it('finds the frame rate, the slow frame, what ate it and the collection inside it', () => {
    const s = summarise(trace(), { top: 3 });
    expect(s.frames).toBe(10);
    expect(s.intervalMs).toMatchObject({ median: 16.7, worst: 50 });
    expect(s.workMs).toMatchObject({ median: 4, worst: 40 });
    expect(s.slowFrames).toHaveLength(3);
    expect(s.slowFrames[0]).toMatchObject({ workMs: 40, gcMs: 5 });
    expect(s.slowFrames[0].atMs).toBeCloseTo(100.2, 1);
    expect(s.slowFrames[0].top[0].fn).toBe('slowThing (src/gore/index.ts:42)');
    expect(s.slowFrames[0].top[0].ms).toBeCloseTo(30, 0);
    expect(s.slowFrames[0].top[1].fn).toBe('tick (src/core/Game.ts:182)');
    // Over the whole trace: tick 9 x 4 + 10 = 46 ms, slowThing 30 ms; idle time is not a function.
    expect(s.functions.map((f: { fn: string }) => f.fn)).toEqual(['tick (src/core/Game.ts:182)', 'slowThing (src/gore/index.ts:42)']);
    expect(s.functions[0].ms).toBeCloseTo(46, 0);
    expect(s.functions[0].percent + s.functions[1].percent).toBeCloseTo(100, 0);
    expect(s.gc).toEqual({ count: 1, totalMs: 5, worstMs: 5 });
  });
  it('gives zeros, not an error, for a trace with no frames', () => {
    expect(summarise([])).toMatchObject({ frames: 0, fps: 0, slowFrames: [], functions: [] });
  });
});
