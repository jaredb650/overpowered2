/**
 * Weapon and item silhouettes. Straight segments only, to match the faceted chips in the FX language.
 * Weapons are drawn side-on on a 96x32 grid with the muzzle to the right.
 */
import type { CallInId, PickupKind, WeaponId } from '../core/gameplay';

const svg = (viewBox: string, d: string) =>
  `<svg class="ico" viewBox="${viewBox}" aria-hidden="true"><path d="${d}"/></svg>`;

const WEAPON_PATHS: Record<WeaponId, string> = {
  smg:
    'M22 8H70V16H22Z M70 10H91V13H70Z M84 6H87V10H84Z M27 4H35V8H27Z ' +
    'M22 9H6L3 19H8L11 13H22Z M30 16H41L36 29H26Z M47 16H58L62 31H52Z',
  shotgun:
    'M1 14L8 10H31V17L22 18L7 25L1 23Z M31 8H53V19H31Z M53 8H95V11H53Z M53 13H87V17H53Z ' +
    'M58 12H77V20L74 22H61L58 20Z M36 19H45L43 24H37Z',
  rocket:
    'M11 8H74V20H11Z M2 5L11 8V20L2 23Z M74 9L86 10L94 14L86 18L74 19Z M39 2H52V8H39Z ' +
    'M29 20H38L35 30H26Z M54 20H61L60 28H54Z',
  autocannon:
    'M14 10H53V22H14Z M3 12H14V20L3 24Z M53 13H84V19H53Z M84 9H95V23H84Z M87 12H89V20H87Z ' +
    'M21 2H47V7H21Z M30 7H35V10H30Z M34 22H47V31H34Z M19 22H28L25 30H17Z',
  sword:
    'M27 13H85L95 16L85 19H27Z M22 5H27V27H22Z M6 14H22V18H6Z M1 11H6V21H1Z',
  judge:
    'M42 8H91V14H42Z M85 5H89V8H85Z M27 6H44V20H27Z M19 8H27V20H19Z M14 3L21 6V10H16Z ' +
    'M17 20H29L23 31H8Z M29 20H37L35 24H31Z',
  lance:
    'M26 7H93V11H26Z M26 18H93V22H26Z M42 4H48V25H42Z M57 4H63V25H57Z M72 4H78V25H72Z ' +
    'M8 6H30V23H8Z M2 10H8V21L2 24Z M14 23H23L20 31H11Z',
  buzzsaw:
    'M40 7H94V10H40Z M40 13H94V16H40Z M40 19H94V22H40Z M60 5H65V24H60Z M80 5H85V24H80Z ' +
    'M13 4H42V26H13Z M4 9H13V13H4Z M4 17H13V21H4Z M19 26H36V31H19Z',
  kiln:
    'M22 9H61V19H22Z M61 12L84 9V20L61 17Z M86 10L95 15L86 20Z M26 19H53V28L50 30H29L26 28Z ' +
    'M8 11H22V17H8Z M3 8H8V21H3Z M31 3H38V9H31Z',
  stakegun:
    'M17 13H85L95 15L85 17H17Z M8 9H45V21H8Z M58 3H63L68 12H63Z M63 18H68L63 27H58Z M45 9L63 12V18L45 21Z ' +
    'M15 21H24L21 31H12Z M3 11H8V19H3Z',
};

export function weaponIcon(id: WeaponId): string {
  return svg('0 0 96 32', WEAPON_PATHS[id]);
}

export const GRENADE_ICON = svg('0 0 16 20', 'M6 0H10V3H13L14 5H12V6L15 9V17L12 20H4L1 17V9L4 6V3H6Z');
export const DASH_ICON = svg('0 0 24 16', 'M0 0H7L13 8L7 16H0L6 8Z M11 0H18L24 8L18 16H11L17 8Z');

const CALLIN_PATHS: Record<CallInId, string> = {
  airstrike: 'M12 0L15 8L24 13V16L15 14L14 20L17 22V24L12 23L7 24V22L10 20L9 14L0 16V13L9 8Z',
  warthog: 'M0 11L8 10L10 3H13L15 10L23 11L24 13L15 14L14 21L17 23L10 23L10 14L0 13Z',
  orbital: 'M10 0H14V10L24 12L14 14V24H10V14L0 12L10 10Z',
  blackSun: 'M12 0L15 5L21 3L19 9L24 12L19 15L21 21L15 19L12 24L9 19L3 21L5 15L0 12L5 9L3 3L9 5Z M12 8L8 12L12 16L16 12Z',
  nuke: 'M12 9L15 12L12 15L9 12Z M9 0H15L13 7H11Z M24 15L21 20L15 15L16 13Z M3 20L0 15L8 13L9 15Z',
};

export function callInIcon(id: CallInId): string {
  return `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="${CALLIN_PATHS[id]}"/></svg>`;
}

/** Colours for pickups on the minimap and markers. Health and ammo finally look different. */
export function pickupColor(kind: PickupKind): string {
  switch (kind) {
    case 'health': case 'megaHealth': return '#ffffff';
    case 'armor': case 'heavyArmor': return '#39e0ff';
    case 'ammo': return '#ffb400';
    case 'weaponCache': return '#ff5a14';
    default: return '#ff7ad9';
  }
}
