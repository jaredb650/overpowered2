import { describe, expect, it } from 'vitest';
import { EASE_STEPS, GoreLoad, HEAPS, LoadGovernor, LoadTuning, resetLoad, stepLoad, type ResolutionState } from './load';
import { MessTuning } from './mess';

/** Runs the governor for `seconds` at a frame interval of `ms`, and returns the steps it took, as [second, ease]. */
function run(g: LoadGovernor, seconds: number, ms: number, resolution: ResolutionState, from = 0): [number, number][] {
  const out: [number, number][] = [];
  const dt = ms / 1000;
  for (let t = 0; t < seconds; t += dt) if (g.update(dt, resolution)) out.push([Math.round((from + t) * 10) / 10, g.ease]);
  return out;
}

const full: ResolutionState = { enabled: true, scale: 1, starved: false };
const spent: ResolutionState = { enabled: true, scale: 0.62, starved: false };
const starved: ResolutionState = { enabled: true, scale: 1, starved: true };

describe('the automatic step-down of the gore update', () => {
  it('does nothing on a machine that holds 60, however long', () => {
    const g = new LoadGovernor();
    expect(run(g, 600, 16.7, full)).toEqual([]);
    expect(g.ease).toBe(0);
  });

  it('does nothing while resolution has not been tried: a slow GPU is dynamic resolution\'s to answer first', () => {
    const g = new LoadGovernor();
    expect(run(g, 60, 25, full)).toEqual([]);
    expect(run(g, 60, 25, { enabled: true, scale: 0.85, starved: false })).toEqual([]);
  });

  it('steps down when frames are missed with the resolution spent, one step at a time, and stops at the last', () => {
    const g = new LoadGovernor();
    const steps = run(g, 60, 22, spent);
    expect(steps.map(s => s[1])).toEqual([1, 2]);
    // The first after about two seconds of missing plus the time the smoothed interval takes to cross the mark; the
    // second a cooldown later, so what the first did has been seen.
    expect(steps[0]![0]).toBeGreaterThan(LoadTuning.downAfter);
    expect(steps[0]![0]).toBeLessThan(LoadTuning.downAfter + 2);
    expect(steps[1]![0] - steps[0]![0]).toBeGreaterThanOrEqual(LoadTuning.cooldown - 0.1);
    expect(g.ease).toBe(EASE_STEPS);
  });

  it('steps down when resolution gave up (the processor is the limit), at full size', () => {
    const g = new LoadGovernor();
    expect(run(g, 8, 24, starved).map(s => s[1])).toEqual([1]);
  });

  it('a single long frame, or a second of them, is not a reason', () => {
    const g = new LoadGovernor();
    run(g, 20, 16.7, spent);
    g.update(0.25, spent);
    expect(run(g, 20, 16.7, spent)).toEqual([]);
    expect(run(g, 1, 30, spent)).toEqual([]);
    expect(run(g, 20, 16.7, spent)).toEqual([]);
  });

  it('gives a step back after half a minute at 60, and waits twice as long after giving one back too soon', () => {
    const g = new LoadGovernor();
    run(g, 20, 22, spent);
    expect(g.ease).toBe(2);
    const back = run(g, 40, 16.7, full);
    expect(back.map(s => s[1])).toEqual([1]);
    expect(back[0]![0]).toBeGreaterThan(LoadTuning.upAfter);
    // It was too soon: frames are missed again at once, the step is taken again, and the next wait is doubled.
    expect(run(g, 10, 22, spent).map(s => s[1])).toEqual([2]);
    expect(run(g, LoadTuning.upAfter + 20, 16.7, full)).toEqual([]);
    expect(run(g, LoadTuning.upAfter + 20, 16.7, full).map(s => s[1])).toEqual([1]);
  });

  it('is off under automation, where dynamic resolution is: a test\'s picture does not depend on the machine\'s load', () => {
    const g = new LoadGovernor();
    expect(run(g, 60, 40, { enabled: false, scale: 1, starved: false })).toEqual([]);
  });

  it('heaps are off at Mess Low and on above it, and off from the first automatic step', () => {
    expect(HEAPS).toEqual({ low: false, break: true, standard: true, everything: true });
    expect(LoadTuning.heaps).toEqual([true, false, false]);
    expect(LoadTuning.enemiesPush).toEqual([true, true, false]);
    for (const row of [LoadTuning.drawn, LoadTuning.full, LoadTuning.ragdolls, LoadTuning.collapses, LoadTuning.sway]) {
      expect(row).toHaveLength(EASE_STEPS + 1);
      expect(row[0]).toBe(1);
      for (let i = 1; i < row.length; i++) expect(row[i]).toBeLessThanOrEqual(row[i - 1]!);
    }
  });

  it('once a frame it tells the settings code when the step moved, and sheds resting capsules while heaps are off', () => {
    let shed = 0;
    let told = 0;
    const mess = { shed: (n: number) => { shed += n; return 0; } };
    const resolution = { ...starved };
    const ctx = { time: { realDt: 0.03 }, render: { dynamicResolution: resolution } } as never;
    GoreLoad.changed = () => { told++; MessTuning.heaps = GoreLoad.ease === 0; };
    resetLoad();
    MessTuning.heaps = true;
    try {
      for (let i = 0; i < 60; i++) stepLoad(ctx, mess);
      expect(told).toBe(0);
      expect(shed).toBe(0);
      for (let i = 0; i < 60; i++) stepLoad(ctx, mess);
      expect(GoreLoad.ease).toBe(1);
      expect(told).toBe(1);
      expect(shed).toBeGreaterThan(0);
      expect(shed % LoadTuning.shedPerFrame).toBe(0);
      // A new run starts from the settings.
      resetLoad();
      expect(GoreLoad.ease).toBe(0);
      expect(told).toBe(2);
      expect(MessTuning.heaps).toBe(true);
    } finally {
      GoreLoad.changed = null;
      GoreLoad.ease = 0;
      MessTuning.heaps = true;
      resetLoad();
    }
  });
});
