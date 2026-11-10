/**
 * Weapon families. Every weapon on one number key is a family, in WEAPON_ORDER: the key draws the member last held there,
 * and pressing it again while holding one steps to the next. Nothing here keeps state, so the HUD and the tests can ask
 * the same questions the weapon system does.
 *
 * A new member is one row in WEAPONS with the family's `slot` and a `base`, its id in WEAPON_ORDER after its siblings, and
 * a viewmodel. Nothing in this file changes.
 */
import type { WeaponId } from '../core/gameplay';
import { SLOT8_OLD, WEAPONS, WEAPON_ORDER } from './data';

/** `?families=0` leaves every number key with its first weapon only, as before families existed. */
export const FAMILIES_ON = typeof location === 'undefined' || new URLSearchParams(location.search).get('families') !== '0';

/** Number keys in the order the wheel walks them: the order their first weapon appears in WEAPON_ORDER. */
export const SLOT_ORDER: readonly number[] = WEAPON_ORDER.reduce<number[]>((out, id) => {
  const slot = WEAPONS[id].slot;
  if (!out.includes(slot)) out.push(slot);
  return out;
}, []);

/** `?melee=old` leaves key 5 with the katana alone, as before the Shiv, Prybar, Spade and Cosh. */
export const MELEE_FOUR_ON = typeof location === 'undefined' || new URLSearchParams(location.search).get('melee') !== 'old';

const BY_SLOT = new Map<number, readonly WeaponId[]>();
for (const slot of SLOT_ORDER) {
  const all = WEAPON_ORDER.filter(id => WEAPONS[id].slot === slot && (MELEE_FOUR_ON || WEAPONS[id].base !== 'sword'));
  BY_SLOT.set(slot, FAMILIES_ON ? all : all.slice(0, 1));
}
// `?slot8=old`: key 8 is the Buzzsaw alone, as it was, even where the lab's arsenal hands out every gun.
if (SLOT8_OLD) BY_SLOT.set(WEAPONS.buzzsaw.slot, ['buzzsaw']);
const NONE: readonly WeaponId[] = [];

/** Every weapon on a number key, base first. */
export function familyOfSlot(slot: number): readonly WeaponId[] {
  return BY_SLOT.get(slot) ?? NONE;
}

export function familyOf(id: WeaponId): readonly WeaponId[] {
  return familyOfSlot(WEAPONS[id].slot);
}

/** Weapons that arrive with `base`: its family members that name it. */
export function membersOf(base: WeaponId): readonly WeaponId[] {
  return familyOf(base).filter(id => WEAPONS[id].base === base);
}

/**
 * What a press of a slot's key draws. Holding a member of the family already: the next owned one after it, wrapping. Coming
 * from another slot: the member last held here, or the first owned. Null when nothing changes.
 */
export function pressSlot(
  slot: number, current: WeaponId, owned: ReadonlySet<WeaponId>, remembered: WeaponId | undefined,
): WeaponId | null {
  const family = familyOfSlot(slot);
  const at = family.indexOf(current);
  if (at >= 0) {
    for (let i = 1; i < family.length; i++) {
      const next = family[(at + i) % family.length]!;
      if (owned.has(next)) return next;
    }
    return null;
  }
  if (remembered !== undefined && owned.has(remembered) && family.includes(remembered)) return remembered;
  for (let i = 0; i < family.length; i++) if (owned.has(family[i]!)) return family[i]!;
  return null;
}

/**
 * The wheel: the next slot along that holds anything, landing on the member last held there. It walks slots, not weapons,
 * so a family of three is still one notch.
 */
export function wheelSlot(
  current: WeaponId, step: number, owned: ReadonlySet<WeaponId>, remembered: (slot: number) => WeaponId | undefined,
): WeaponId | null {
  const n = SLOT_ORDER.length;
  const from = SLOT_ORDER.indexOf(WEAPONS[current].slot);
  const dir = step < 0 ? -1 : 1;
  for (let i = 1; i < n; i++) {
    const slot = SLOT_ORDER[(((from + i * dir) % n) + n) % n]!;
    const pick = pressSlot(slot, current, owned, remembered(slot));
    if (pick) return pick;
  }
  return null;
}
