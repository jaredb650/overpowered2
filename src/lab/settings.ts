/**
 * What the panel remembers. The range, a real game with ?dev=1 and the dev server's other pages keep separate copies, so a
 * test never leaks into a run. Those other pages did not ask for the lab, so they keep only the spawn picks: god mode,
 * every weapon, world speed and the rest start off on each load, and a cheat left on can never carry into a playtest.
 */
import { DEV_ASKED, DevFlags, ON_RANGE } from '../core/devflags';
import type { EnemyId } from '../core/gameplay';

export type AiMode = 'off' | 'patrol' | 'on';

export interface LabSettings {
  spawn: EnemyId;
  ai: AiMode;
  row: number;
  god: boolean;
  /** Every weapon, infinite ammo. */
  arsenal: boolean;
  /** World time scale, 0.05 to 1. */
  speed: number;
  overlay: boolean;
  gibbing: boolean;
  explosiveDeaths: boolean;
  progression: boolean;
  muscles: boolean;
  force: number;
}

const KEY = `op2.lab.v1.${ON_RANGE ? 'range' : DEV_ASKED ? 'game' : 'dev'}`;
/** All a page that did not ask for the lab brings back. */
const CONVENIENCES: readonly (keyof LabSettings)[] = ['spawn', 'ai', 'row'];

/** Perks start off on the range because a stray Hellfire is exactly what stops a body being studied. */
const DEFAULTS: LabSettings = {
  spawn: 'trooper', ai: 'off', row: 5, god: ON_RANGE, arsenal: ON_RANGE, speed: 1, overlay: ON_RANGE,
  gibbing: true, explosiveDeaths: true, progression: !ON_RANGE, muscles: true, force: 1,
};

export function loadSettings(): LabSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<LabSettings>;
    if (DEV_ASKED) return { ...DEFAULTS, ...stored };
    const kept: Partial<LabSettings> = {};
    for (const k of CONVENIENCES) if (k in stored) (kept as Record<string, unknown>)[k] = stored[k];
    return { ...DEFAULTS, ...kept };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: LabSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // A private window can refuse this. The panel still works for the session.
  }
}

export function applyFlags(s: LabSettings): void {
  DevFlags.gibbing = s.gibbing;
  DevFlags.explosiveDeaths = s.explosiveDeaths;
  DevFlags.progression = s.progression;
  DevFlags.muscles = s.muscles;
  DevFlags.force = s.force;
}
