/**
 * Dev switches. The defaults are the real game and only the lab writes them, so a normal run pays one read at each
 * gate. They live in core because the gates are spread across gore, enemies and progression.
 */
const query = typeof location === 'undefined' ? null : new URLSearchParams(location.search);

const dev = query?.get('dev') ?? null;

/** Booted on the Test Range: no menus, no waves. */
export const ON_RANGE = query?.get('map') === 'range';
/** The page asked for the lab: the Test Range, or ?dev=1 in any build, the public site included. */
export const DEV_ASKED = ON_RANGE || dev === '1';
/**
 * The lab's panel and keys exist: wherever it was asked for, and on every page of the dev server unless `?dev=0`. A
 * production build keeps ?dev=1 only. Under the tests there is no location, so it is off. On a page that did not ask, the
 * panel stays quiet until it is first opened (lab/index.ts) and starts every page with the cheats off (lab/settings.ts).
 * The location check comes first: a script run by tsx has no `import.meta.env`, and physics and gore import this file.
 */
export const DEV_TOOLS = DEV_ASKED || (typeof location !== 'undefined' && import.meta.env?.DEV && dev !== '0');

/** A switch that a URL parameter turns off (`?name=0`), for comparing the game with and without one change. */
const on = (name: string): boolean => query?.get(name) !== '0';

export const DevFlags = {
  /** Off: nothing bursts into limbs and chunks, whatever killed it. */
  gibbing: true,
  /** Off: blasts and heavy shells throw and maim, and leave a body behind. */
  explosiveDeaths: true,
  /** Off: hits, kills and severed limbs earn no combo, perk, call-in or drop. */
  progression: true,
  /** Off: new ragdolls run on hard limits with no muscle layer. */
  muscles: true,
  /** Off: a burst body's pieces leave it as before the gore update (slower, lower, no ribbons of blood). `?gibthrow=0` too. */
  gibThrow: true,
  /** Master multiplier on every push a body takes. */
  force: 1,
  /**
   * The gore update's hit reactions (docs/notes/gore-update.md, lane "react"), each with its URL switch, so the game can be
   * played with and without one. `flinch` (`?flinch=0`): every hit shows, in the shape and at the size of the update; off,
   * the small nod from before it. `clutch` (`?clutch=0`): a hand to the wound and a hurt posture on a plain flinch too.
   * `carry` (`?carry=0`): more bodies die on their feet at once, and a kill on a body on its muscles keeps that motion.
   * `aimspoil` (`?aimspoil=0`): a hit spoils an enemy's aim. `sway` (`?sway=0`): the struck part goes onto physics.
   */
  flinch: on('flinch'),
  clutch: on('clutch'),
  carry: on('carry'),
  aimspoil: on('aimspoil'),
  sway: on('sway'),
  /** Off: no blood lands on the weapon in the hands or on the gloves (weapons/viewmodels/blood.ts). `?vmblood=0` starts it off. */
  vmBlood: on('vmblood'),
  /** Off: a body's skin does not show how far its limbs' pools are spent (characters/anatomy/wear.ts). `?wear=0` starts it off. */
  wear: on('wear'),
};

/** The hit-reaction switches as the page's URL left them: the lab starts from these, not from what it last remembered. */
export const REACT_SWITCHES = ['flinch', 'clutch', 'carry', 'aimspoil', 'sway'] as const;
export type ReactSwitch = (typeof REACT_SWITCHES)[number];

/** The page's address turned a switch off (`?<name>=0`): the lab's stored tick does not turn it back on. */
export const switchedOff = (name: string): boolean => !on(name);
