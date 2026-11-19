import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS, SENSITIVITY_CURVE, SENSITIVITY_RANGE, loadSettings, sliderToValue, valueToSlider } from './settings';

afterEach(() => vi.unstubAllGlobals());
const store = (saved: unknown) => vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(saved) });

describe('mouse sensitivity range', () => {
  it('reaches 10 and keeps the old 0.1 floor', () => {
    expect(SENSITIVITY_RANGE).toEqual([0.1, 10]);
    expect(DEFAULTS.sensitivity).toBe(1);
  });
  it('keeps saved values, and clamps hand-edited ones', () => {
    store({ sensitivity: 4 });
    expect(loadSettings().sensitivity).toBe(4);
    store({ sensitivity: 0.35 });
    expect(loadSettings().sensitivity).toBe(0.35);
    store({ sensitivity: 99 });
    expect(loadSettings().sensitivity).toBe(10);
    store({ sensitivity: 0 });
    expect(loadSettings().sensitivity).toBe(0.1);
  });
  it('bends the track so the low end stays fine and the ends meet', () => {
    const [min, max] = SENSITIVITY_RANGE;
    expect(sliderToValue(0, min, max, SENSITIVITY_CURVE)).toBeCloseTo(0.1);
    expect(sliderToValue(1, min, max, SENSITIVITY_CURVE)).toBeCloseTo(10);
    expect(sliderToValue(0.25, min, max, SENSITIVITY_CURVE)).toBeLessThan(1);
    for (const v of [0.1, 0.5, 1, 4, 10]) expect(sliderToValue(valueToSlider(v, min, max, SENSITIVITY_CURVE), min, max, SENSITIVITY_CURVE)).toBeCloseTo(v);
  });
});

describe('the Mess setting', () => {
  it('is Standard unless chosen, keeps a saved choice, and clamps a hand-edited one', async () => {
    const { MESS_DEFAULT, MESS_NAMES } = await import('./settings');
    expect(MESS_NAMES[MESS_DEFAULT]).toBe('Standard');
    expect(DEFAULTS.mess).toBe(MESS_DEFAULT);
    store({ mess: 0 });
    expect(loadSettings().mess).toBe(0);
    store({ mess: 99 });
    expect(loadSettings().mess).toBe(MESS_NAMES.length - 1);
  });

  it('writes each cap to the system that keeps it', async () => {
    const { applyMess, MESS_NAMES } = await import('./settings');
    const { MESS, MESS_LEVELS, MessTuning } = await import('../gore/mess');
    const { GoreTuning } = await import('../gore');
    const { ChunkTuning } = await import('../gore/chunks');
    const { SliceTuning } = await import('../gore/sliced');
    expect(MESS_NAMES).toHaveLength(MESS_LEVELS.length);
    const limits: Record<string, number> = {};
    const decals = { soak: -1, setLimit: (ring: string, n: number) => { limits[ring] = n; } };
    let trimmed = 0;
    const ctx = { render: { decals }, gore: { chunks: { trim: () => trimmed++ } } } as never;
    for (let i = 0; i < MESS_LEVELS.length; i++) {
      const b = MESS[MESS_LEVELS[i]!];
      applyMess(ctx, i);
      expect(MessTuning.level).toBe(MESS_LEVELS[i]);
      expect(GoreTuning.maxCorpses).toBe(b.corpses);
      expect(GoreTuning.maxLimbs).toBe(b.limbs);
      expect(SliceTuning.maxHalves).toBe(b.halves);
      expect(ChunkTuning.share).toBe(b.pieces);
      expect(ChunkTuning.linger).toBe(b.pieceLinger);
      expect(limits).toEqual({ blood: b.blood, mark: b.marks, scorch: b.scorches, big: b.big });
      expect(decals.soak).toBe(b.soak);
      // The newest are drawn in full, more are drawn than that, and more are kept than are drawn.
      expect(b.full).toBeLessThan(b.drawn);
      expect(b.drawn).toBeLessThan(b.corpses);
    }
    expect(trimmed).toBe(MESS_LEVELS.length);
    // Only one level sweeps the floor at the break, and it is otherwise Standard.
    expect(MESS_LEVELS.filter(l => MESS[l].clearAtBreak)).toEqual(['break']);
    expect({ ...MESS.break, clearAtBreak: false }).toEqual(MESS.standard);
    applyMess(ctx, MESS_LEVELS.indexOf('standard'));
  });
});

describe('the gore update\'s parts follow the settings', () => {
  it('at the default quality and Standard mess every cap is the one its lane built', async () => {
    const { loadFor } = await import('./settings');
    const { MESS } = await import('../gore/mess');
    const { DEFAULT_QUALITY } = await import('../render/quality');
    const load = loadFor('standard', DEFAULT_QUALITY, 0);
    expect(load.budget).toBe(MESS.standard);
    expect(load).toMatchObject({ heaps: true, ragdolls: 14, collapses: 8, enemyPushRange: 30, swayBodies: 8, fireLights: 3, bigStains: MESS.standard.big });
    // Ultra is no less.
    expect(loadFor('standard', 3, 0)).toEqual(load);
  });

  it('a lower quality keeps fewer big stains, swings fewer struck parts and lights fewer burning bodies', async () => {
    const { loadFor } = await import('./settings');
    const { MESS } = await import('../gore/mess');
    const low = loadFor('standard', 0, 0);
    const medium = loadFor('standard', 1, 0);
    const high = loadFor('standard', 2, 0);
    for (const key of ['swayBodies', 'fireLights', 'bigStains'] as const) {
      expect(low[key]).toBeLessThanOrEqual(medium[key]);
      expect(medium[key]).toBeLessThan(high[key]);
      expect(low[key]).toBeGreaterThan(0);
    }
    expect(low.bigStains).toBe(MESS.standard.big / 2);
    // What stays on the floor is the Mess setting's alone: quality does not take bodies away.
    expect(low.budget).toBe(MESS.standard);
    expect(low.heaps).toBe(true);
  });

  it('Mess at Low leaves no capsules under the dead; the automatic steps take the heap first, then drawn bodies and live ragdolls', async () => {
    const { loadFor } = await import('./settings');
    const { MESS } = await import('../gore/mess');
    expect(loadFor('low', 2, 0).heaps).toBe(false);
    const [none, one, two] = [0, 1, 2].map(ease => loadFor('standard', 2, ease));
    expect(none!.heaps).toBe(true);
    expect(one!.heaps).toBe(false);
    expect(one!.budget).toMatchObject({ drawn: 19, full: 6, corpses: MESS.standard.corpses, blood: MESS.standard.blood });
    expect(two!.budget).toMatchObject({ drawn: 13, full: 4, corpses: MESS.standard.corpses });
    expect([none!.ragdolls, one!.ragdolls, two!.ragdolls]).toEqual([14, 14, 10]);
    expect([none!.collapses, one!.collapses, two!.collapses]).toEqual([8, 8, 4]);
    // Enemies stop stirring the dead at the second step; the player's own push is never eased.
    expect([none!.enemyPushRange, one!.enemyPushRange, two!.enemyPushRange]).toEqual([30, 30, 0]);
    // Still pieces shrink away sooner (never later than the Mess level has them go).
    expect([none!.pieceLinger, one!.pieceLinger, two!.pieceLinger]).toEqual([Infinity, 30, 12]);
    expect(loadFor('low', 2, 1).pieceLinger).toBe(MESS.low.pieceLinger);
    expect([none!.swayBodies, one!.swayBodies, two!.swayBodies]).toEqual([8, 4, 2]);
    expect([none!.fireLights, one!.fireLights, two!.fireLights]).toEqual([3, 2, 1]);
    // A step past the last is the last, and the floors hold at the lowest settings.
    expect(loadFor('standard', 2, 9)).toEqual(two);
    const least = loadFor('low', 0, 2);
    expect(least.budget.drawn).toBeGreaterThanOrEqual(8);
    expect(least.budget.full).toBeGreaterThanOrEqual(3);
    expect(least.swayBodies).toBe(1);
    expect(least.fireLights).toBe(1);
    expect(least.ragdolls).toBeGreaterThanOrEqual(6);
  });

  it('a step writes what it may and never trims the floor; a setting trims', async () => {
    const { applyLoad, applyMess, applyQuality, DEFAULTS } = await import('./settings');
    const { MESS, MESS_LEVELS, MessTuning, messBudget, leavesCapsules } = await import('../gore/mess');
    const { GoreLoad } = await import('../gore/load');
    const { GoreTuning } = await import('../gore');
    const { SWAY } = await import('../enemies/damage');
    const { FireTuning } = await import('../gore/fire');
    const limits: Record<string, number> = {};
    let trimmed = 0;
    const quality: number[] = [];
    const ctx = { render: { decals: { soak: 0, setLimit: (ring: string, n: number) => { limits[ring] = n; } }, setQuality: (q: number) => quality.push(q) }, gore: { chunks: { trim: () => trimmed++ } } } as never;
    try {
      applyMess(ctx, MESS_LEVELS.indexOf('standard'));
      applyQuality(ctx, { ...DEFAULTS, quality: 0 });
      expect(quality).toEqual([0]);
      expect(limits.big).toBe(MESS.standard.big / 2);
      expect(SWAY.max).toBe(3);
      expect(FireTuning.lights).toBe(1);
      applyQuality(ctx, { ...DEFAULTS });
      expect(limits.big).toBe(MESS.standard.big);
      expect([SWAY.max, FireTuning.lights, GoreTuning.maxRagdolls]).toEqual([8, 3, 14]);
      expect(leavesCapsules()).toBe(true);
      // The governor's step, as gore/load.ts announces it.
      const before = trimmed;
      const sent = { ...limits };
      GoreLoad.ease = 2;
      GoreLoad.changed!();
      expect(trimmed).toBe(before);
      expect(limits).toEqual(sent);
      expect(leavesCapsules()).toBe(false);
      expect(messBudget().drawn).toBe(13);
      expect(MessTuning.level).toBe('standard');
      expect([SWAY.max, FireTuning.lights, GoreTuning.maxRagdolls, GoreTuning.maxCollapses, MessTuning.enemyRange]).toEqual([2, 1, 10, 4, 0]);
      GoreLoad.ease = 0;
      GoreLoad.changed!();
      expect(messBudget()).toBe(MESS.standard);
      expect(leavesCapsules()).toBe(true);
      expect([SWAY.max, FireTuning.lights, GoreTuning.maxRagdolls, GoreTuning.maxCollapses, MessTuning.enemyRange]).toEqual([8, 3, 14, 8, 30]);
      // Low mess: bodies lie one deep, as before the update.
      applyMess(ctx, MESS_LEVELS.indexOf('low'));
      expect(leavesCapsules()).toBe(false);
    } finally {
      GoreLoad.ease = 0;
      GoreLoad.quality = DEFAULTS.quality;
      applyMess(ctx, MESS_LEVELS.indexOf('standard'));
      applyLoad(ctx, true);
    }
  });
});
