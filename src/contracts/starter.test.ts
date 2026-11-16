import { afterEach, describe, expect, it, vi } from 'vitest';
import { MISSIONS } from '../campaign/missions';
import { missionWithStarter } from '../campaign/starter';
import { MissionRunner } from '../campaign/runner';
import { FakeHost } from '../campaign/testkit';
import { validateMission } from '../campaign/validate';
import { survivalLoadout } from './loadouts';
import { weaponWares } from './shop/data';
import { STARTERS, STARTER_KEY, saveStarter, selectedStarter, starterPreference } from './starter';

afterEach(() => vi.unstubAllGlobals());

describe('starter choice', () => {
  it('defaults to each mode’s original gun and survives blocked storage', () => {
    vi.stubGlobal('localStorage', { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } });
    expect(selectedStarter('outpost')).toBe('harrow');
    for (const mode of ['crucible', 'campaign', 'foreclosure'] as const) expect(selectedStarter(mode)).toBe('smg');
    expect(() => saveStarter('gimlet')).not.toThrow();
  });

  it('remembers a choice, ignores invalid values, and gives the URL precedence', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key), setItem: (key: string, value: string) => data.set(key, value) });
    saveStarter('gimlet');
    expect(selectedStarter('outpost')).toBe('gimlet');
    vi.stubGlobal('location', { search: '?starter=harrow' });
    expect(selectedStarter('campaign')).toBe('harrow');
    vi.stubGlobal('location', { search: '?starter=rocket' });
    expect(starterPreference()).toBe('gimlet');
    data.set(STARTER_KEY, 'rocket');
    expect(starterPreference()).toBeUndefined();
  });

  it.each(STARTERS)('issues %s in both survival modes and sells the other two at their normal prices', gun => {
    vi.stubGlobal('location', { search: `?starter=${gun}` });
    const prices = { smg: 350, gimlet: 450, harrow: 700 };
    for (const mode of ['crucible', 'outpost'] as const) {
      expect(survivalLoadout(mode)).toEqual([gun, 'shotgun', 'rivet', 'sword']);
      const wares = weaponWares(mode);
      for (const id of STARTERS) expect(wares[id]!.price).toBe(id === gun ? 0 : prices[id]);
    }
    expect(survivalLoadout('defense')).toEqual(['smg', 'shotgun', 'rivet', 'sword']);
  });

  it.each(STARTERS)('keeps %s through every campaign checkpoint and accepts Foreclosure’s same-key replacement', gun => {
    for (const id of ['outpost', 'foreclosure']) {
      const source = MISSIONS[id]!;
      const mission = missionWithStarter(source, gun);
      expect(mission.loadout.weapons).toEqual(source.loadout.weapons.map(id => id === 'smg' ? gun : id));
      expect(validateMission(mission)).toEqual([]);
      const opening = new FakeHost();
      new MissionRunner(mission, opening).start();
      expect(opening.deployed!.weapons.split(',')).toEqual(mission.loadout.weapons);
      for (let i = 0; i < mission.beats.length; i++) {
        const kit = mission.beats[i]!.checkpoint?.loadout;
        if (!kit) continue;
        expect(kit.weapons).toEqual(source.beats[i]!.checkpoint!.loadout.weapons.map(id => id === 'smg' ? gun : id));
        const host = new FakeHost();
        const run = new MissionRunner(mission, host);
        run.start(mission.beats[i]!.id);
        expect(host.deployed!.weapons.split(',')).toEqual(kit.weapons);
        run.down(); run.redeploy();
        expect(host.deployed!.weapons.split(',')).toEqual(kit.weapons);
      }
      expect(source.loadout.weapons[0]).toBe('smg');
    }
  });
});
