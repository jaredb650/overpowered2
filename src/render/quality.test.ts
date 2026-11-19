import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUALITY, QUALITY, SETTINGS_KEY, savedQuality } from './quality';
import { DEFAULTS, saveSettings } from '../ui/settings';
import { SHEET } from './decalSheet';
import { TILES } from './BloodMap';

afterEach(() => vi.unstubAllGlobals());

describe('the gore update on the quality presets', () => {
  it('the default level is the update as its lanes built it: nothing is cut on a strong machine', () => {
    const high = QUALITY[DEFAULT_QUALITY]!;
    expect(DEFAULTS.quality).toBe(DEFAULT_QUALITY);
    expect(high.decalSheet).toBe(1);
    expect(high.bloodTiles).toBe(TILES);
    expect(high.bigStains).toBe(1);
    expect(high.swayBodies).toBe(8);
    expect(high.fireLights).toBe(3);
    // Ultra never has less than High.
    const ultra = QUALITY[3]!;
    for (const key of ['decalSheet', 'bloodTiles', 'bigStains', 'swayBodies', 'fireLights'] as const) expect(ultra[key]).toBeGreaterThanOrEqual(high[key]);
  });

  it('each level below has no more of any part than the one above', () => {
    for (let i = 1; i < QUALITY.length; i++) {
      for (const key of ['decalSheet', 'bloodTiles', 'bigStains', 'swayBodies', 'fireLights'] as const) expect(QUALITY[i - 1]![key]).toBeLessThanOrEqual(QUALITY[i]![key]);
    }
    // Low and Medium hold the decal sheet at half size: a quarter of 89 MB, under the 44 MB the game had before.
    const bytes = (scale: number) => SHEET.width * scale * SHEET.height * scale * 4 * 2 * (4 / 3);
    expect(bytes(QUALITY[0]!.decalSheet) / 1048576).toBeLessThan(44);
    expect(bytes(QUALITY[1]!.decalSheet) / 1048576).toBeLessThan(44);
    expect(Math.round(bytes(1) / 1048576)).toBe(85);
    // Even on Low a struck part still swings on somebody and a burning body still lights the floor.
    expect(QUALITY[0]!.swayBodies).toBeGreaterThan(0);
    expect(QUALITY[0]!.fireLights).toBeGreaterThan(0);
  });

  it('reads the saved level before the settings are applied, from where the settings screen writes it', () => {
    expect(savedQuality()).toBe(DEFAULT_QUALITY);
    const kept = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) });
    saveSettings({ ...DEFAULTS, quality: 0 });
    expect([...kept.keys()]).toEqual([SETTINGS_KEY]);
    expect(savedQuality()).toBe(0);
    kept.set(SETTINGS_KEY, JSON.stringify({ quality: 99 }));
    expect(savedQuality()).toBe(QUALITY.length - 1);
    kept.set(SETTINGS_KEY, '{not json');
    expect(savedQuality()).toBe(DEFAULT_QUALITY);
    kept.set(SETTINGS_KEY, JSON.stringify({ quality: 'high' }));
    expect(savedQuality()).toBe(DEFAULT_QUALITY);
  });
});
