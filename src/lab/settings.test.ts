import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('Test Range starting weapons', () => {
  it('does not silently enable the all-weapons cheat on a fresh range', async () => {
    vi.stubGlobal('location', { search: '?map=range' });
    vi.stubGlobal('localStorage', { getItem: () => null });
    const { loadSettings } = await import('./settings');
    expect(loadSettings()).toMatchObject({ arsenal: false, god: true });
  });

  it('still honours an explicitly enabled arsenal cheat', async () => {
    vi.stubGlobal('location', { search: '?map=range' });
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ arsenal: true }) });
    const { loadSettings } = await import('./settings');
    expect(loadSettings().arsenal).toBe(true);
  });
});
