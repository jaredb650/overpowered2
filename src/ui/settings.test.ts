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
