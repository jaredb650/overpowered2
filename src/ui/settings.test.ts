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
