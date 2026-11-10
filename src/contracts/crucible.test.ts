/** Where the Crucible's rules are kept, which runs play them, and that a run on custom rules is unranked. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../core/contracts';
import { DEFAULT_RULES, cloneRules, rulesEqual, type CrucibleRules } from '../enemies/rules';
import { ScoreKeeper } from '../progression/score';
import { RunReport } from '../ui/runreport';
import {
  RULES_APPLY, RULES_KEY, crucibleRules, loadRules, refreshRules, resetRules, rulesCustom, saveRules, storedRulesCustom,
} from './crucible';
import { DEFAULT_CONTRACT } from './data';

class MapStorage {
  readonly map = new Map<string, string>();
  blocked = false;
  getItem(k: string): string | null {
    if (this.blocked) throw new Error('blocked');
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.blocked) throw new Error('blocked');
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    if (this.blocked) throw new Error('blocked');
    this.map.delete(k);
  }
}

let store: MapStorage;

const custom = (edit: (r: CrucibleRules) => void): CrucibleRules => {
  const r = cloneRules(DEFAULT_RULES);
  edit(r);
  return r;
};

beforeEach(() => {
  store = new MapStorage();
  vi.stubGlobal('localStorage', store);
  resetRules();
  refreshRules(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('keeping the rules', () => {
  it('reads the standard rules from an empty store', () => {
    expect(loadRules()).toBe(DEFAULT_RULES);
    expect(storedRulesCustom()).toBe(false);
  });

  it('stores only what differs, under a versioned key, and reads it back', () => {
    const r = custom(r => { r.titan.every = 5; r.types.bomber.on = false; r.maxAlive = 32; });
    saveRules(r);
    expect(RULES_KEY).toMatch(/\.v\d+$/);
    expect(JSON.parse(store.map.get(RULES_KEY)!)).toEqual({ maxAlive: 32, types: { bomber: { on: false } }, titan: { every: 5 } });
    expect(rulesEqual(loadRules(), r)).toBe(true);
    expect(storedRulesCustom()).toBe(true);
  });

  it('removes the key for the standard rules, and on reset', () => {
    saveRules(custom(r => { r.sizePct = 150; }));
    expect(store.map.has(RULES_KEY)).toBe(true);
    resetRules();
    expect(store.map.has(RULES_KEY)).toBe(false);
    saveRules(custom(r => { r.sizePct = 150; }));
    saveRules(cloneRules(DEFAULT_RULES));
    expect(store.map.has(RULES_KEY)).toBe(false);
    expect(loadRules()).toBe(DEFAULT_RULES);
  });

  it('checks what it saves', () => {
    const kept = saveRules({ ...cloneRules(DEFAULT_RULES), maxAlive: 99, sizePct: 133 });
    expect(kept).toMatchObject({ maxAlive: 48, sizePct: 125 });
    expect(JSON.parse(store.map.get(RULES_KEY)!)).toEqual({ sizePct: 125 });
  });

  it('reads a corrupt or an old blob as safely as it can', () => {
    store.map.set(RULES_KEY, '{not json');
    expect(loadRules()).toBe(DEFAULT_RULES);
    store.map.set(RULES_KEY, 'null');
    expect(loadRules()).toBe(DEFAULT_RULES);
    store.map.set(RULES_KEY, JSON.stringify({ v: 0, size: 2, juggernautEvery: 3 }));
    expect(loadRules()).toBe(DEFAULT_RULES);
    store.map.set(RULES_KEY, JSON.stringify({ maxAlive: 1000, startWave: -4, titan: { on: false }, types: { husk: { on: false }, trooper: { on: false } } }));
    const r = loadRules();
    expect(r.maxAlive).toBe(48);
    expect(r.startWave).toBe(1);
    expect(r.titan.on).toBe(false);
    // No type is left in wave 1, so the earliest one that is on moves there.
    expect(r.types.gunner.from).toBe(1);
  });

  it('keeps the rules for the page when the store is blocked', () => {
    store.blocked = true;
    expect(loadRules()).toBe(DEFAULT_RULES);
    const r = custom(r => { r.startWave = 10; });
    saveRules(r);
    expect(rulesEqual(loadRules(), r)).toBe(true);
    resetRules();
    expect(loadRules()).toBe(DEFAULT_RULES);
  });
});

describe('which runs play them', () => {
  it('never applies under the tests, where there is no page', () => {
    expect(RULES_APPLY).toBe(false);
    expect(crucibleRules()).toBe(DEFAULT_RULES);
  });

  it('takes the stored rules at the start of a Crucible run, and the standard ones anywhere else', () => {
    saveRules(custom(r => { r.juggernaut.every = 2; }));
    // Endless Humans, the Campaign, the range and a sandbox: the stored rules are ignored.
    refreshRules(false);
    expect(crucibleRules()).toBe(DEFAULT_RULES);
    expect(rulesCustom()).toBe(false);
    // The Crucible.
    refreshRules(true);
    expect(crucibleRules().juggernaut.every).toBe(2);
    expect(rulesCustom()).toBe(true);
    // Back to the standard rules: ranked again from the next run.
    resetRules();
    expect(rulesCustom()).toBe(true);
    refreshRules(true);
    expect(rulesCustom()).toBe(false);
    expect(crucibleRules()).toBe(DEFAULT_RULES);
  });
});

describe('the pages the rules apply to', () => {
  /** A fresh copy of the module behind a stand-in location, since a page reads its URL once. */
  const on = async (search: string) => {
    vi.resetModules();
    vi.stubGlobal('location', { search, pathname: '/' });
    return import('./crucible');
  };

  it('is The Crucible, on its own map or another', async () => {
    expect((await on('')).RULES_APPLY).toBe(true);
    expect((await on('?contract=crucible')).RULES_APPLY).toBe(true);
    expect((await on('?contract=crucible&map=killhouse')).RULES_APPLY).toBe(true);
  });

  it('is never Endless Humans, the Campaign, a mission, the range or a sandbox', async () => {
    for (const search of ['?contract=outpost', '?map=killhouse', '?contract=campaign', '?contract=campaign&map=crucible', '?mission=outpost', '?map=range', '?sandbox=arena&waves=1']) {
      expect((await on(search)).RULES_APPLY, search).toBe(false);
    }
  });

  it('is off with ?rules=0, which leaves what is stored alone', async () => {
    saveRules(custom(r => { r.sizePct = 200; }));
    const page = await on('?rules=0');
    expect(page.RULES_SKIPPED).toBe(true);
    expect(page.RULES_APPLY).toBe(false);
    // A fresh module has its own DEFAULT_RULES, so this compares by value.
    expect(page.refreshRules()).toEqual(DEFAULT_RULES);
    expect(page.rulesCustom()).toBe(false);
    expect(page.storedRulesCustom()).toBe(false);
    expect(store.map.has(RULES_KEY)).toBe(true);
    const crucible = await on('');
    expect(crucible.refreshRules().sizePct).toBe(200);
    expect(crucible.rulesCustom()).toBe(true);
  });
});

describe('a run on custom rules', () => {
  const keeper = () => {
    const sounds: string[] = [];
    const feeds: string[] = [];
    const ctx = {
      events: { emit: () => undefined },
      audio: { play: (s: string) => sounds.push(s) },
      hud: { feed: (t: string) => feeds.push(t), floatText: () => undefined },
      player: { velocity: { x: 0, z: 0 } },
      time: { frame: 0 },
    };
    return { k: new ScoreKeeper(ctx as unknown as Ctx), sounds, feeds };
  };

  beforeEach(() => {
    vi.stubGlobal('window', { addEventListener: () => undefined });
    store.map.set(DEFAULT_CONTRACT.scoreKey, '1000');
  });

  it('is ranked on the standard rules: it beats the record and writes it', () => {
    refreshRules(true);
    const { k, sounds, feeds } = keeper();
    expect(k.highScore).toBe(1000);
    k.add(1500, 'kill');
    expect(k.highScore).toBe(1500);
    expect(sounds).toContain('highscore');
    expect(feeds).toContain('NEW HIGH SCORE!');
    k.persist();
    expect(store.map.get(DEFAULT_CONTRACT.scoreKey)).toBe('1500');
  });

  it('never beats, announces or writes the record', () => {
    saveRules(custom(r => { r.healthPct = 50; }));
    refreshRules(true);
    const { k, sounds, feeds } = keeper();
    k.add(5000, 'kill');
    k.add(500, 'wave');
    expect(k.score).toBe(5500);
    expect(k.highScore).toBe(1000);
    expect(sounds).not.toContain('highscore');
    expect(feeds).not.toContain('NEW HIGH SCORE!');
    k.persist();
    k.reset();
    expect(store.map.get(DEFAULT_CONTRACT.scoreKey)).toBe('1000');
  });

  it('still banks a record the ranked run before it set', () => {
    refreshRules(true);
    const { k } = keeper();
    k.add(2000, 'kill');
    // The player sets custom rules on the menu and starts again: the reset keeps the last run's record.
    saveRules(custom(r => { r.startWave = 5; }));
    refreshRules(true);
    k.reset();
    expect(store.map.get(DEFAULT_CONTRACT.scoreKey)).toBe('2000');
    k.add(9000, 'kill');
    k.persist();
    expect(store.map.get(DEFAULT_CONTRACT.scoreKey)).toBe('2000');
  });

  it('is never a high score on the report', () => {
    const report = new RunReport({ events: { on: () => undefined } } as unknown as Ctx);
    report.begin(1000, true);
    report.score = 5000;
    expect(report.custom).toBe(true);
    expect(report.isHighScore).toBe(false);
    report.begin(1000);
    report.score = 5000;
    expect(report.isHighScore).toBe(true);
  });
});
