/**
 * What a hit is worth on a vehicle. Pure arithmetic, so a test can hold the whole of section 17 to it.
 *
 * The shaped-charge rule is the same as on a plated man (`SHAPED_CHARGE`): a direct hit doubles and goes through, its splash has
 * little left. Soft-skins have no armour to go through, so blasts simply wreck them and bullets count.
 */
import type { ExplosionKind } from '../../core/contracts';
import { SHAPED_CHARGE } from '../../weapons/data';
import {
  ARMOUR_BLAST_MOST, ARMOUR_BLAST_SHARE, COCKPIT_SHELL_SCALE, SKIN_BULLETS, SKIN_PARTS, SOFT_BLAST_SCALE, SOURCE_SCALE,
  type PartDef, type VehicleDef,
} from './data';

/** Bullets are anything that lands with no blast behind it. */
export function bulletDamage(def: VehicleDef, part: PartDef, amount: number, source: string): number {
  if (!def.armoured) return amount * part.scale;
  const skin = SKIN_BULLETS[source];
  return skin !== undefined && SKIN_PARTS.has(part.id) ? amount * skin * part.scale : 0;
}

/** A rocket or a shell landing on the part itself. The blast that follows is counted apart, by `splashDamage`. */
export function directDamage(def: VehicleDef, part: PartDef, amount: number, kind: ExplosionKind, source: string): number {
  if (!def.armoured) return amount * SOFT_BLAST_SCALE * part.scale;
  const charge = SHAPED_CHARGE[kind];
  const hit = charge ? Math.min(amount, charge.most) * charge.direct : Math.min(amount, ARMOUR_BLAST_MOST) * ARMOUR_BLAST_SHARE;
  const perfect = part.id === 'cockpit' && kind === 'shell' ? COCKPIT_SHELL_SCALE : 1;
  // A perfect round stays perfect whichever gun sent it, so the source's scale only applies to everything else.
  const scale = perfect > 1 ? 1 : SOURCE_SCALE[source] ?? 1;
  return hit * part.scale * perfect * scale;
}

/** A blast nearby, already scaled by how far it was. `instakill` weapons have a number here: nothing one-shots armour by accident. */
export function splashDamage(def: VehicleDef, amount: number, kind: ExplosionKind, source: string): number {
  if (!def.armoured) return amount * SOFT_BLAST_SCALE;
  const charge = SHAPED_CHARGE[kind];
  const hit = charge ? Math.min(amount, charge.most) * charge.splash : Math.min(amount, ARMOUR_BLAST_MOST) * ARMOUR_BLAST_SHARE;
  return hit * (SOURCE_SCALE[source] ?? 1);
}
