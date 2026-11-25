/**
 * Verification suite for the 4-part "Crossfire" campaign:
 *   - `validateMission()` passes with 0 problems on all 4 missions
 *   - Every `cf.*` call used across all 4 missions is documented/exported in `CROSSFIRE_CALLS`
 *   - Every `cf:*` signal referenced across all 4 missions is exported in `CROSSFIRE_SIGNALS`
 *   - Every dialogue line ID is globally unique with non-empty text
 *   - Every Halcyon target ID referenced by Part 3 exists in `HALCYON_TARGETS`
 *   - `chain.ts` state round-trip, validation, URL preservation, and Node safety
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowPageNavigation, isPageNavigationAllowed } from '../../input';
import { getHalcyonTarget } from '../../world/map/halcyon/targets';
import {
  CROSSFIRE_CALLS,
  CROSSFIRE_CHAIN_KEY,
  CROSSFIRE_DEFAULT_LANCER_MAX_HP,
  CROSSFIRE_SIGNALS,
  buildCrossfireSearch,
  clearChainState,
  createInitialChainState,
  loadChainState,
  patchChainState,
  saveChainState,
  transitionToCrossfirePart,
} from '../crossfire/chain';
import type { Mission, Script, Step, Trigger } from '../types';
import { validateMission } from '../validate';
import {
  CROSSFIRE_AIRBASE_LINES,
  CROSSFIRE_ALL_LINES,
  CROSSFIRE_HALCYON_LINES,
  CROSSFIRE_RETURN_LINES,
  CROSSFIRE_STRAIT_LINES,
} from './crossfire.lines';
import { CROSSFIRE_AIRBASE } from './crossfireAirbase';
import { CROSSFIRE_HALCYON, HALCYON_MISSION_TARGET_GROUPS } from './crossfireHalcyon';
import { CROSSFIRE_RETURN } from './crossfireReturn';
import { CROSSFIRE_STRAIT } from './crossfireStrait';

const ALL_MISSIONS: readonly Mission[] = [
  CROSSFIRE_AIRBASE,
  CROSSFIRE_STRAIT,
  CROSSFIRE_HALCYON,
  CROSSFIRE_RETURN,
];

function collectSteps(mission: Mission): Step[] {
  const out: Step[] = [];
  const push = (script?: Script): void => {
    for (const s of script ?? []) out.push(s);
  };
  for (const beat of mission.beats) {
    push(beat.start);
    for (const cue of beat.cues ?? []) push(cue.run);
  }
  return out;
}

function collectSignals(trigger: Trigger, out: Set<string>): void {
  if ('signal' in trigger) out.add(trigger.signal);
  if ('all' in trigger) for (const t of trigger.all) collectSignals(t, out);
  if ('any' in trigger) for (const t of trigger.any) collectSignals(t, out);
  if ('not' in trigger) collectSignals(trigger.not, out);
}

describe('Crossfire 4-part campaign missions', () => {
  it('validates all 4 missions with zero validation problems', () => {
    for (const mission of ALL_MISSIONS) {
      expect(validateMission(mission), `validation problems in ${mission.id}`).toEqual([]);
    }
  });

  it('defines the approved beat structure across all 4 parts', () => {
    expect(CROSSFIRE_AIRBASE.beats.map(b => b.id)).toEqual([
      'perimeter',
      'apron',
      'tower',
      'hangar',
      'takeoff',
    ]);
    expect(CROSSFIRE_STRAIT.beats.map(b => b.id)).toEqual([
      'outbound_probe',
      'destroyer_gauntlet',
      'coastal_aces',
    ]);
    expect(CROSSFIRE_HALCYON.beats.map(b => b.id)).toEqual([
      'breach',
      'ridge_suppression',
      'war_machine',
      'citadel_hq',
    ]);
    expect(CROSSFIRE_RETURN.beats.map(b => b.id)).toEqual([
      'ambush',
      'carrier_umbrella',
      'debrief',
    ]);
  });

  it('documents every cf.* director call in CROSSFIRE_CALLS with zero drift', () => {
    const usedCalls = new Set<string>();
    for (const mission of ALL_MISSIONS) {
      for (const step of collectSteps(mission)) {
        if (step.do === 'call' && step.name.startsWith('cf.')) {
          usedCalls.add(step.name);
          expect(
            CROSSFIRE_CALLS.has(step.name),
            `Undocumented call "${step.name}" in ${mission.id}`,
          ).toBe(true);
        }
      }
    }
    expect(usedCalls.size).toBeGreaterThan(0);
    // Every documented call in CROSSFIRE_CALLS should be invoked by at least one mission.
    for (const documented of CROSSFIRE_CALLS) {
      expect(usedCalls.has(documented), `Unused documented call "${documented}"`).toBe(true);
    }
  });

  it('registers every cf:* signal referenced across all 4 missions in CROSSFIRE_SIGNALS', () => {
    const knownSignals = new Set<string>(Object.values(CROSSFIRE_SIGNALS));
    const usedSignals = new Set<string>();
    for (const mission of ALL_MISSIONS) {
      for (const beat of mission.beats) {
        if (beat.until) collectSignals(beat.until, usedSignals);
        for (const cue of beat.cues ?? []) collectSignals(cue.when, usedSignals);
        for (const step of collectSteps(mission)) {
          if (step.do === 'until') collectSignals(step.when, usedSignals);
        }
      }
    }
    expect(usedSignals.size).toBeGreaterThan(0);
    for (const sig of usedSignals) {
      if (sig.startsWith('cf:')) {
        expect(knownSignals.has(sig), `Undocumented signal "${sig}"`).toBe(true);
      }
    }
  });

  it('has globally unique dialogue line IDs with non-empty text across all 4 parts', () => {
    const expectedCount =
      CROSSFIRE_AIRBASE_LINES.length
      + CROSSFIRE_STRAIT_LINES.length
      + CROSSFIRE_HALCYON_LINES.length
      + CROSSFIRE_RETURN_LINES.length;
    expect(CROSSFIRE_ALL_LINES.length).toBe(expectedCount);

    const seen = new Set<string>();
    const allowedSpeakers = new Set(['council', 'darrow', 'halvorsen', 'mercer', 'viper', 'carrier']);
    for (const entry of CROSSFIRE_ALL_LINES) {
      expect(entry.id.startsWith('mission.crossfire.'), `bad prefix on ${entry.id}`).toBe(true);
      expect(seen.has(entry.id), `duplicate line id ${entry.id}`).toBe(false);
      seen.add(entry.id);
      expect(entry.text.trim().length, `empty text on ${entry.id}`).toBeGreaterThan(0);
      expect(
        allowedSpeakers.has(entry.speaker),
        `unexpected legacy speaker "${entry.speaker}" on ${entry.id}`,
      ).toBe(true);
    }
  });

  it('references only valid HALCYON_TARGETS IDs in Part 3 target groups', () => {
    const allGroupIds = [
      ...HALCYON_MISSION_TARGET_GROUPS.breach,
      ...HALCYON_MISSION_TARGET_GROUPS.ridgeSuppression,
      ...HALCYON_MISSION_TARGET_GROUPS.warMachine,
      ...HALCYON_MISSION_TARGET_GROUPS.citadelHq,
    ];
    expect(allGroupIds.length).toBeGreaterThan(15);
    for (const targetId of allGroupIds) {
      expect(getHalcyonTarget(targetId), `missing Halcyon target "${targetId}"`).toBeDefined();
    }
  });
});

describe('Crossfire multi-map chain state (`chain.ts`)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stays safe in headless Node without sessionStorage or location', async () => {
    vi.stubGlobal('sessionStorage', undefined);
    vi.stubGlobal('location', undefined);
    expect(loadChainState()).toBeNull();
    expect(() => saveChainState(createInitialChainState())).not.toThrow();
    expect(() => clearChainState()).not.toThrow();
    const url = await transitionToCrossfirePart(
      'crossfire_strait',
      { part: 2, contractor: 'B' },
      'CONTRACTOR SEAT TRANSFER: #7712-A -> #7712-B',
      { holdMs: 0 },
    );
    expect(url).toContain('contract=crossfire_strait');
    expect(url).toContain('deploy=1');
  });

  it('round-trips chain state cleanly through sessionStorage', () => {
    const backing = new Map<string, string>();
    const mockStorage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => { backing.set(k, v); },
      removeItem: (k: string) => { backing.delete(k); },
    };
    vi.stubGlobal('sessionStorage', mockStorage);

    expect(loadChainState()).toBeNull();

    const initial = createInitialChainState({
      part: 1,
      lancerHp: CROSSFIRE_DEFAULT_LANCER_MAX_HP,
      lancerMaxHp: CROSSFIRE_DEFAULT_LANCER_MAX_HP,
      score: 12500,
      kills: 24,
      elapsed: 412,
      deaths: 1,
      contractor: 'A',
      startedAt: 1700000000000,
    });
    saveChainState(initial);
    expect(backing.has(CROSSFIRE_CHAIN_KEY)).toBe(true);
    expect(loadChainState()).toEqual(initial);

    const patched = patchChainState({
      part: 2,
      contractor: 'B',
      lancerHp: 6150,
      score: 21400,
      kills: 38,
    });
    expect(patched.part).toBe(2);
    expect(patched.contractor).toBe('B');
    expect(patched.lancerHp).toBe(6150);
    expect(patched.score).toBe(21400);
    expect(loadChainState()).toEqual(patched);

    // Clamps HP to lancerMaxHp and rejects corrupt payloads gracefully
    const clamped = patchChainState({ lancerHp: 99999 });
    expect(clamped.lancerHp).toBe(CROSSFIRE_DEFAULT_LANCER_MAX_HP);

    backing.set(CROSSFIRE_CHAIN_KEY, '{"broken":true}');
    expect(loadChainState()).toBeNull();

    backing.set(CROSSFIRE_CHAIN_KEY, 'not-json');
    expect(loadChainState()).toBeNull();

    saveChainState(initial);
    clearChainState();
    expect(loadChainState()).toBeNull();
  });

  it('preserves dev/unlock query parameters and calls location.assign during transition', async () => {
    const backing = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => { backing.set(k, v); },
      removeItem: (k: string) => { backing.delete(k); },
    });
    allowPageNavigation(false);
    let allowedAtAssign = false;
    const assign = vi.fn((_url: string) => { allowedAtAssign = isPageNavigationAllowed(); });
    vi.stubGlobal('location', {
      search: '?contract=crossfire&dev=1&unlock=1&map=airbase&autostart=1',
      assign,
    });

    const preview = buildCrossfireSearch('crossfire_halcyon', '?dev=1&unlock=1&map=strait&custom=1');
    expect(preview.startsWith('?')).toBe(true);
    const previewParams = new URLSearchParams(preview);
    expect(previewParams.get('contract')).toBe('crossfire_halcyon');
    expect(previewParams.get('dev')).toBe('1');
    expect(previewParams.get('unlock')).toBe('1');
    expect(previewParams.get('deploy')).toBe('1');
    expect(previewParams.has('map')).toBe(false);
    expect(previewParams.has('custom')).toBe(false);

    await transitionToCrossfirePart(
      'crossfire_strait',
      { part: 2, contractor: 'B', lancerHp: 7200 },
      'CONTRACTOR SEAT TRANSFER: #7712-A → #7712-B · VALKEN AIRSPACE → THE STRAIT',
      { holdMs: 0 },
    );

    expect(assign).toHaveBeenCalledTimes(1);
    expect(allowedAtAssign).toBe(true);
    allowPageNavigation(false);
    const navigatedRaw = assign.mock.calls[0]![0] as string;
    expect(navigatedRaw.startsWith('?')).toBe(true);
    expect(new URL(navigatedRaw, 'https://jaredb650.github.io/overpowered2/').pathname).toBe('/overpowered2/');
    const navigated = new URLSearchParams(navigatedRaw);
    expect(navigated.get('contract')).toBe('crossfire_strait');
    expect(navigated.get('dev')).toBe('1');
    expect(navigated.get('unlock')).toBe('1');
    expect(navigated.get('deploy')).toBe('1');
    expect(navigated.has('map')).toBe(false);
    expect(navigated.has('autostart')).toBe(false);

    const saved = loadChainState();
    expect(saved?.active).toBe(true);
    expect(saved?.part).toBe(2);
    expect(saved?.contractor).toBe('B');
    expect(saved?.lancerHp).toBe(7200);
  });
});
