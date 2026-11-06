/** Registry of every first-person weapon and device. */
import type { Kit } from '../kit/kit';
import type { Model } from '../kit/model';
import type { ViewDef } from '../def';
import { buildDesignator, buildGrenade, buildWalkie } from './devices';
import { shotgunDef } from './shotgun';
import { smgDefs } from './smg';

export interface OffhandSet {
  grenade: Model;
  walkie: Model;
  designator: Model;
}

export function buildDefs(kit: Kit): Record<string, ViewDef> {
  const smg = smgDefs(kit);
  return { smg: smg.right, smgLeft: smg.left, shotgun: shotgunDef(kit) };
}

export function buildOffhand(kit: Kit): OffhandSet {
  return { grenade: buildGrenade(kit), walkie: buildWalkie(kit), designator: buildDesignator(kit) };
}
