import { afterEach, describe, expect, it, vi } from 'vitest';
import { cheatsOn, isCheatPassword, normalizePassword, onCheats, resetCheatsForTest, setCheats } from './cheats';
import { rulesCustom } from '../contracts/crucible';

afterEach(() => { resetCheatsForTest(); vi.unstubAllGlobals(); });

describe('cheat password', () => {
  it('ignores case, spaces and apostrophes', () => {
    expect(normalizePassword("I'm a little Cheater")).toBe('imalittlecheater');
    for (const ok of ['imalittlecheater', "I'm a little cheater", 'IMALITTLECHEATER', ' i’m  a little cheater ']) expect(isCheatPassword(ok)).toBe(true);
    for (const bad of ['', 'imalittlecheat', 'a little cheater', 'im a little cheaters', 'password']) expect(isCheatPassword(bad)).toBe(false);
  });
});

describe('the cheats gate', () => {
  it('starts off, turns on and off, tells listeners and persists', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
    const seen: boolean[] = [];
    onCheats(on => seen.push(on));
    expect(cheatsOn()).toBe(false);
    setCheats(true);
    setCheats(true);
    expect(cheatsOn()).toBe(true);
    expect(store.get('op2.cheats.v1')).toBe('1');
    setCheats(false);
    expect(store.size).toBe(0);
    expect(seen).toEqual([true, false]);
  });

  it('works without storage, and a cheated run is unranked', () => {
    const blocked = () => { throw new Error('blocked'); };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
    expect(rulesCustom()).toBe(false);
    setCheats(true);
    expect(cheatsOn()).toBe(true);
    expect(rulesCustom()).toBe(true);
    setCheats(false);
    expect(rulesCustom()).toBe(false);
  });
});
