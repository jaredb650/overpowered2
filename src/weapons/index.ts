/** Public entry to weapons and combat. Game.ts finds these two factories by name. */
import type { Ctx } from '../core/contracts';
import type { CombatSystem, WeaponSystem } from '../core/gameplay';
import { Combat } from './Combat';
import { Weapons } from './Weapons';

export { WEAPONS, WEAPON_ORDER, SWORD, EXPLOSIONS, HIT_STOP, TUNING } from './data';

export function createCombat(ctx: Ctx): CombatSystem {
  return new Combat(ctx);
}

export function createWeapons(ctx: Ctx): WeaponSystem {
  return new Weapons(ctx);
}
