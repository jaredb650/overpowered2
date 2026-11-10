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
export const DEV_TOOLS = DEV_ASKED || (typeof location !== 'undefined' && import.meta.env.DEV && dev !== '0');

export const DevFlags = {
  /** Off: nothing bursts into limbs and chunks, whatever killed it. */
  gibbing: true,
  /** Off: blasts and heavy shells throw and maim, and leave a body behind. */
  explosiveDeaths: true,
  /** Off: hits, kills and severed limbs earn no combo, perk, call-in or drop. */
  progression: true,
  /** Off: new ragdolls run on hard limits with no muscle layer. */
  muscles: true,
  /** Master multiplier on every push a body takes. */
  force: 1,
};
