/**
 * Dev switches. The defaults are the real game and only the lab writes them, so a normal run pays one read at each
 * gate. They live in core because the gates are spread across gore, enemies and progression.
 */
const query = typeof location === 'undefined' ? null : new URLSearchParams(location.search);

/** Booted on the Test Range: no menus, no waves. */
export const ON_RANGE = query?.get('map') === 'range';
/** The lab's panel and keys exist: on the Test Range, or in any game with ?dev=1. */
export const DEV_TOOLS = ON_RANGE || query?.get('dev') === '1';

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
