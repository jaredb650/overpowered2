/**
 * Cyber implants (docs/proposals/implants.md): the streak perks as a loadout. Three are core and always on; the other eight are
 * implants in three classes, at most one of each class fitted, in as many slots as the run has opened. Progression only grants
 * a perk that is core or fitted. Each implant is also a part on the contractor's body (characters/implants.ts).
 *
 * Pure data and rules, no three.js, so the shop, the menu and the tests read it as the runtime does. `?implants=0` (dev only)
 * brings back the old game: every perk earnable, the old Berserk, no caps.
 */
import type { EffectId } from './data';
import type { PerkId } from '../core/gameplay';

const query = typeof location === 'undefined' ? null : new URLSearchParams(location.search);

/** False on `?implants=0`: every perk on the ladder, stacking as it did before implants. */
export const IMPLANTS_ON: boolean = query?.get('implants') !== '0';

export type ImplantClass = 'gun' | 'kill' | 'move';
export type ImplantId = 'bloodthirst' | 'hellfire' | 'berserk' | 'butcher' | 'chainReaction' | 'chainStorm' | 'skyfall' | 'overdrive';

/** Always on, never fitted: cheap, tied to a basic skill, and they add no shots or explosions. */
export const CORE: readonly PerkId[] = ['slowmo', 'adrenaline', 'geneva'];

export interface ImplantDef {
  id: ImplantId;
  class: ImplantClass;
  /** Credits. 0: issued. */
  price: number;
  /** The wave that has to be cleared before it is sold. 0: from the start. */
  wave: number;
  /** The part he wears for it, by name. */
  part: string;
  /** What starts it, and what it does, for the shop's card. */
  trigger: string;
  does: string;
  lore: string;
}

export const CLASS_NAMES: Readonly<Record<ImplantClass, string>> = { gun: 'Gun', kill: 'Kill', move: 'Move' };
/** Where each class sits on the body. */
export const CLASS_REGION: Readonly<Record<ImplantClass, string>> = { gun: 'left arm', kill: 'head', move: 'legs' };

const def = (id: ImplantId, cls: ImplantClass, price: number, wave: number, part: string, trigger: string, does: string, lore: string): ImplantDef =>
  ({ id, class: cls, price, wave, part, trigger, does, lore });

export const IMPLANTS: Readonly<Record<ImplantId, ImplantDef>> = {
  bloodthirst: def('bloodthirst', 'gun', 0, 0, 'Haemal Feed forearm',
    '4 kills in 5 s', '2x damage, bottomless magazine, 2x shotgun pellets, magazines refilled. 10 s',
    'Two glass lines of something red run from the wrist to the elbow. The Council describes it as a hydration system and asks that you do not.'),
  hellfire: def('hellfire', 'gun', 1600, 4, 'Kiln forearm with heat vents',
    '10 kills in 10 s', 'Every bullet explodes; rockets blast 2.5x wider and kill outright. 5 s',
    'A furnace for the forearm, vented down both sides. Keep it away from paperwork, other contractors and the Council\'s soft furnishings.'),
  berserk: def('berserk', 'gun', 2400, 6, 'Rampart heavy forearm',
    'Combo 15, then every 15 more', 'You cannot die. Dual SMGs, 2x damage, 1.5x fire rate, 1.4x speed, bottomless. 10 s',
    'A slab of armour where the forearm used to be, and a shoulder to carry it. While it runs you cannot die, which Legal has asked us to call a feature.'),
  butcher: def('butcher', 'kill', 600, 1, 'Cleaver slit visor',
    'Limbs off 5 different enemies in 4 s', 'Every hit severs a limb. 8 s',
    'One narrow slot, one bright line across it. It shows the joints. What you do with that is a matter for your own conscience and our indemnity.'),
  chainReaction: def('chainReaction', 'kill', 1200, 3, 'Cascade lens visor',
    '4 kills from one explosion', 'Every corpse explodes. 6 s',
    'Five amber lenses that count the dead in a row. It sets them off, too. The Council regrets any inconvenience to the deceased.'),
  chainStorm: def('chainStorm', 'kill', 2800, 10, 'Tempest crown visor',
    'Combo 30, then every 30 more', 'Every kill throws three lightning arcs. 12 s',
    'Two coils at the temples and a visor that hums. The lightning goes where it likes. You are insured, provided you are standing somewhere else.'),
  skyfall: def('skyfall', 'move', 800, 2, 'Skyfall calf thrusters',
    '4 kills in 6 s while off the ground', 'Unlimited air dash; a ground slam detonates. 8 s',
    'A thruster on the outside of each calf. Unlimited air, then a landing the ground files a complaint about.'),
  overdrive: def('overdrive', 'move', 1000, 3, 'Overdrive sprinter blades',
    '5 kills in 10 s above 18 m/s', 'Damage climbs with your speed, to 3x. 10 s',
    'Carbon blades behind both calves and a drive at each knee. The faster you run, the harder you hit, which is also the Council\'s growth strategy.'),
};

/** In the shop's order: by class, then by price. */
export const IMPLANT_ORDER: readonly ImplantId[] = ['bloodthirst', 'hellfire', 'berserk', 'butcher', 'chainReaction', 'chainStorm', 'skyfall', 'overdrive'];

/** Slot 1 is open from the start; 2 and 3 are bought. */
export const SLOT_WARES: readonly { price: number; wave: number; lore: string }[] = [
  { price: 0, wave: 0, lore: 'Issued. The Council fits one port to every contractor, free, in the interests of productivity.' },
  { price: 1500, wave: 5, lore: 'A second port, in a part of you that you were not using for much. Holds one implant of a class you have not fitted.' },
  { price: 3000, wave: 12, lore: 'The third and final port. Beyond three the Council\'s actuaries stop calling you a contractor and start calling you equipment.' },
];

/** Always on, never fitted: for the shop's Implants page. */
export const CORE_COPY = 'Standard issue, always on: SLOWMO (3 headshots), Adrenaline (3 sword kills), Geneva Suggestion (executions).';

/** A new run's loadout: the core, and Blood Thirst issued in slot 1. */
export const DEFAULT_FITTED: readonly ImplantId[] = ['bloodthirst'];

/** The caps on what can run at once (proposal section 5). None of them apply on `?implants=0`. */
export const CAPS = {
  /** All damage effects multiplied together. */
  damage: 6,
  /** All fire-rate effects multiplied, Berserk's akimbo SMG counted as 2x. */
  fireRate: 2,
  pellets: 2,
  /** Exploding-bullet blasts per frame. Past it a round hits as a plain round, at Hellfire's damage, with no blast. */
  blastsPerFrame: 6,
  /** Seconds after an implant's effect ends before it can start again: the style gate's rearm, for every implant. */
  rearm: 30,
} as const;

export const isImplant = (id: EffectId | string): id is ImplantId => Object.hasOwn(IMPLANTS, id);
export const isCore = (id: EffectId | string): boolean => (CORE as readonly string[]).includes(id);

/**
 * What the run in play has fitted, for the HUD, which has no loadout of its own to read.
 * shortcut: the last Loadout changed writes it, which is the one run in play; give the HUD the loadout if there are ever two.
 */
export const FITTED_NOW = new Set<ImplantId>();

/** The combo ladder's rungs that are implants: the HUD shows them only when fitted. */
export const LADDER_IMPLANTS: Readonly<Record<string, ImplantId>> = { Berserk: 'berserk', 'Chain Storm': 'chainStorm' };

/** Is this rung of the HUD's ladder on offer? Every rung but an implant not fitted. */
export const rungShown = (name: string): boolean => {
  const id = LADDER_IMPLANTS[name];
  return !IMPLANTS_ON || id === undefined || FITTED_NOW.has(id);
};

/**
 * What a run has bought and fitted. Purchases last for one run, as guns and mods do; `reset()` puts the default back. Listeners
 * hear every change, so progression can end a removed effect and the viewmodel can change arms.
 */
export class Loadout {
  readonly owned = new Set<ImplantId>();
  readonly fitted = new Set<ImplantId>();
  slots = 1;
  private readonly listeners: (() => void)[] = [];

  constructor() {
    this.reset();
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private changed(): void {
    FITTED_NOW.clear();
    for (const id of this.fitted) FITTED_NOW.add(id);
    for (const fn of this.listeners) fn();
  }

  reset(): void {
    this.owned.clear();
    this.fitted.clear();
    this.slots = 1;
    for (const id of DEFAULT_FITTED) {
      this.owned.add(id);
      this.fitted.add(id);
    }
    this.changed();
  }

  /** May progression grant this perk? Core always; an implant only fitted; anything else (capsules) always. */
  allows(id: EffectId): boolean {
    return !IMPLANTS_ON || !isImplant(id) || this.fitted.has(id);
  }

  /** The fitted implant of the same class, which fitting `id` would take off. */
  replaces(id: ImplantId): ImplantId | null {
    for (const f of this.fitted) if (f !== id && IMPLANTS[f].class === IMPLANTS[id].class) return f;
    return null;
  }

  /** Why `id` cannot be fitted now, or null. Owning it is the shop's question, not this one. */
  whyNotFit(id: ImplantId): string | null {
    if (this.fitted.has(id) || this.replaces(id)) return null;
    return this.fitted.size >= this.slots ? 'No free slot' : null;
  }

  grant(id: ImplantId): void {
    if (this.owned.has(id)) return;
    this.owned.add(id);
    this.changed();
  }

  /**
   * Fits `id`, taking off whatever of its class is on; or takes it off. False if there is no free slot. Fitting one not owned
   * grants it: the shop charges first, the cheat panel does not.
   */
  fit(id: ImplantId, on: boolean): boolean {
    if (!on) {
      if (!this.fitted.delete(id)) return true;
      this.changed();
      return true;
    }
    if (this.fitted.has(id)) return true;
    if (this.whyNotFit(id)) return false;
    const out = this.replaces(id);
    if (out) this.fitted.delete(out);
    this.owned.add(id);
    this.fitted.add(id);
    this.changed();
    return true;
  }

  /** Opens the next slot, up to three. */
  openSlot(): boolean {
    if (this.slots >= SLOT_WARES.length) return false;
    this.slots++;
    this.changed();
    return true;
  }

  /** The fitted implant of a class, for the parts on the body. */
  ofClass(cls: ImplantClass): ImplantId | null {
    for (const f of this.fitted) if (IMPLANTS[f].class === cls) return f;
    return null;
  }
}

const WORN_KEY = 'op2.implants.worn';

/** The last loadout a run wore, for the main menu's contractor. Empty if storage is out. */
export function lastWorn(): ImplantId[] {
  try {
    const raw = globalThis.localStorage?.getItem(WORN_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(ids) ? ids.filter((id): id is ImplantId => typeof id === 'string' && isImplant(id)) : [...DEFAULT_FITTED];
  } catch {
    return [...DEFAULT_FITTED];
  }
}

export function saveWorn(ids: Iterable<ImplantId>): void {
  try {
    globalThis.localStorage?.setItem(WORN_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage off: the menu shows the default.
  }
}
