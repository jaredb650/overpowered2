/** Registry of every first-person weapon and device. */
import type { Kit } from '../kit/kit';
import type { Model } from '../kit/model';
import type { ViewDef } from '../def';
import { autocannonDef } from './autocannon';
import { buzzsawDef } from './buzzsaw';
import { buildDesignator, buildGrenade, buildWalkie } from './devices';
import { judgeDef } from './judge';
import { kilnDef } from './kiln';
import { lanceDef } from './lance';
import { rocketDef } from './rocket';
import { shotgunDef } from './shotgun';
import { smgDefs } from './smg';
import { stakegunDef } from './stakegun';
import { swordDef } from './sword';

export interface OffhandSet {
  grenade: Model;
  walkie: Model;
  designator: Model;
}

export function buildDefs(kit: Kit): Record<string, ViewDef> {
  const smg = smgDefs(kit);
  return {
    smg: smg.right, smgLeft: smg.left, shotgun: shotgunDef(kit), rocket: rocketDef(kit), autocannon: autocannonDef(kit), sword: swordDef(kit),
    judge: judgeDef(kit), lance: lanceDef(kit), buzzsaw: buzzsawDef(kit), kiln: kilnDef(kit), stakegun: stakegunDef(kit),
  };
}

export function buildOffhand(kit: Kit): OffhandSet {
  return { grenade: buildGrenade(kit), walkie: buildWalkie(kit), designator: buildDesignator(kit) };
}
