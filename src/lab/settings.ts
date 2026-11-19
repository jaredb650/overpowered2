/**
 * What the panel remembers. The range, a real game with ?dev=1 and the dev server's other pages keep separate copies, so a
 * test never leaks into a run. Those other pages did not ask for the lab, so they keep only the spawn picks: god mode,
 * every weapon, world speed and the rest start off on each load, and a cheat left on can never carry into a playtest.
 */
import { DEV_ASKED, DevFlags, ON_RANGE, REACT_SWITCHES, switchedOff } from '../core/devflags';
import type { EnemyId, WeaponSystem } from '../core/gameplay';

export type AiMode = 'off' | 'patrol' | 'on';

export interface LabSettings {
  spawn: EnemyId;
  ai: AiMode;
  row: number;
  god: boolean;
  /** Every weapon, infinite ammo. */
  arsenal: boolean;
  /** Reserves held full: a magazine still empties and reloads. Under `arsenal` the bottomless mag wins. */
  reserves: boolean;
  /** World time scale, 0.05 to 1. */
  speed: number;
  overlay: boolean;
  gibbing: boolean;
  explosiveDeaths: boolean;
  progression: boolean;
  muscles: boolean;
  /** The gore update's launch of a burst body's pieces (`GibThrow`). Off: the old one, to compare. */
  gibThrow: boolean;
  force: number;
  /** The gore update's hit reactions (`DevFlags`): each starts as the page's URL has it (`?flinch=0` and the rest), never as last left. */
  flinch: boolean;
  clutch: boolean;
  carry: boolean;
  aimspoil: boolean;
  sway: boolean;
  /** Blood on the weapon and the gloves (the gore update's B3). */
  vmBlood: boolean;
  /** Wear you can see: skin torn as a limb's pool is spent (the gore update's W1). */
  wear: boolean;
}

const KEY = `op2.lab.v1.${ON_RANGE ? 'range' : DEV_ASKED ? 'game' : 'dev'}`;
/** All a page that did not ask for the lab brings back. */
const CONVENIENCES: readonly (keyof LabSettings)[] = ['spawn', 'ai', 'row'];

/** Perks start off on the range because a stray Hellfire is exactly what stops a body being studied. */
const DEFAULTS: LabSettings = {
  spawn: 'trooper', ai: 'off', row: 5, god: ON_RANGE, arsenal: false, reserves: false, speed: 1, overlay: ON_RANGE,
  gibbing: true, explosiveDeaths: true, progression: !ON_RANGE, muscles: true, gibThrow: true, force: 1,
  flinch: true, clutch: true, carry: true, aimspoil: true, sway: true, vmBlood: true, wear: true,
};

/** A page's reaction switches are its URL's: what the panel last had them at would make `?sway=0` mean nothing. */
function fromUrl(s: LabSettings): LabSettings {
  for (const k of REACT_SWITCHES) s[k] = DevFlags[k];
  return s;
}

export function loadSettings(): LabSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<LabSettings>;
    if (DEV_ASKED) return fromUrl({ ...DEFAULTS, ...stored });
    const kept: Partial<LabSettings> = {};
    for (const k of CONVENIENCES) if (k in stored) (kept as Record<string, unknown>)[k] = stored[k];
    return fromUrl({ ...DEFAULTS, ...kept });
  } catch {
    return fromUrl({ ...DEFAULTS });
  }
}

export function saveSettings(s: LabSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // A private window can refuse this. The panel still works for the session.
  }
}

/** Cheats off: everything but the spawn picks goes back to its default, as on a page that did not ask for the lab. */
export function resetCheats(s: LabSettings): void {
  for (const k of Object.keys(DEFAULTS) as (keyof LabSettings)[]) if (!CONVENIENCES.includes(k)) (s as unknown as Record<string, unknown>)[k] = DEFAULTS[k];
  fromUrl(s);
}

export function applyFlags(s: LabSettings): void {
  DevFlags.gibbing = s.gibbing;
  DevFlags.explosiveDeaths = s.explosiveDeaths;
  DevFlags.progression = s.progression;
  DevFlags.muscles = s.muscles;
  DevFlags.gibThrow = s.gibThrow;
  DevFlags.force = s.force;
  for (const k of REACT_SWITCHES) DevFlags[k] = s[k];
  DevFlags.vmBlood = s.vmBlood && !switchedOff('vmblood');
  DevFlags.wear = s.wear && !switchedOff('wear');
}

/** Held every frame, as the arsenal is: every reserve back to its max after whatever the last reload took. */
export function holdReserves(s: LabSettings, weapons: WeaponSystem): void {
  if (s.reserves) weapons.addAmmo(1);
}
