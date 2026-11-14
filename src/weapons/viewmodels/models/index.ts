/** Registry of every first-person weapon and device. */
import type { Kit } from '../kit/kit';
import type { Model } from '../kit/model';
import type { ViewDef } from '../def';
import { autocannonDef, sabotDef } from './autocannon';
import { batonDef } from './baton';
import { crowbarDef } from './crowbar';
import { buzzsawDef } from './buzzsaw';
import { buildDesignator, buildGrenade, buildStim, buildWalkie } from './devices';
import { harrowDef } from './harrow';
import { judgeDef } from './judge';
import { knifeDef } from './knife';
import { kilnDef } from './kiln';
import { lanceDef } from './lance';
import { piledriverDef } from './piledriver';
import { quiverDef } from './quiver';
import { rivetDef } from './rivet';
import { rocketDef } from './rocket';
import { shotgunDef } from './shotgun';
import { shovelDef } from './shovel';
import { smgDefs } from './smg';
import { stakegunDef } from './stakegun';
import { swordDef } from './sword';
import { thresherDef } from './thresher';
import { trommelDef } from './trommel';
import { SLOT8_OLD } from '../../data';

export interface OffhandSet {
  grenade: Model;
  walkie: Model;
  designator: Model;
  stim: Model;
}

export function buildDefs(kit: Kit): Record<string, ViewDef> {
  const smg = smgDefs(kit);
  return {
    smg: smg.right, smgLeft: smg.left, shotgun: shotgunDef(kit), rocket: rocketDef(kit), autocannon: autocannonDef(kit), sword: swordDef(kit),
    judge: judgeDef(kit), lance: lanceDef(kit), kiln: kilnDef(kit), stakegun: stakegunDef(kit),
    // Key 8: the Trommel wears the `buzzsaw` id. `?slot8=old` brings the Buzzsaw's own model back with its numbers.
    buzzsaw: SLOT8_OLD ? buzzsawDef(kit) : trommelDef(kit), piledriver: piledriverDef(kit),
    // Family members: the second weapon on a number key. One line here and one row in WEAPONS is the whole of adding one.
    harrow: harrowDef(kit), rivet: rivetDef(kit), sabot: sabotDef(kit), thresher: thresherDef(kit), quiver: quiverDef(kit),
    // Key 5 beside the sword. Their swings are one clip, models/melee.ts, with each one's own poses.
    knife: knifeDef(kit), crowbar: crowbarDef(kit), shovel: shovelDef(kit), baton: batonDef(kit),
  };
}

export function buildOffhand(kit: Kit): OffhandSet {
  return { grenade: buildGrenade(kit), walkie: buildWalkie(kit), designator: buildDesignator(kit), stim: buildStim(kit) };
}
