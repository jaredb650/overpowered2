/** What the panel remembers. The range and a real game with ?dev=1 keep separate copies, so a test never leaks into a run. */
import { DevFlags, ON_RANGE } from '../core/devflags';
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

const KEY = `op2.lab.v1.${ON_RANGE ? 'range' : 'game'}`;

/** Perks start off on the range because a stray Hellfire is exactly what stops a body being studied. */
const DEFAULTS: LabSettings = {
  spawn: 'trooper', ai: 'off', row: 5, god: ON_RANGE, arsenal: ON_RANGE, speed: 1, overlay: ON_RANGE,
  gibbing: true, explosiveDeaths: true, progression: !ON_RANGE, muscles: true, force: 1,
};

export function loadSettings(): LabSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<LabSettings>) };
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
