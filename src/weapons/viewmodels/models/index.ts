/** Registry of every first-person weapon and device. */
import * as THREE from 'three';
import type { Kit } from '../kit/kit';
import type { Model } from '../kit/model';
import type { ViewDef } from '../def';
import { autocannonDef, sabotDef } from './autocannon';
import { awlDef } from './awl';
import { batonDef } from './baton';
import { crowbarDef } from './crowbar';
import { deuceDef } from './deuce';
import { gimletDef } from './gimlet';
import { flailDef } from './flail';
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
import { ultramagDef } from './ultramag';
import { autorafficaDef } from './autoraffica';
import { SLOT8_OLD } from '../../data';
import { HANDS } from '../poses';

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
    harrow: harrowDef(kit), rivet: rivetDef(kit), sabot: sabotDef(kit), awl: awlDef(kit), thresher: thresherDef(kit), quiver: quiverDef(kit),
    deuce: deuceDef(kit), ultramag: ultramagDef(kit), gimlet: gimletDef(kit), autoraffica: autorafficaDef(kit),
    flail: flailDef(kit),
    // Key 5 beside the sword. Their swings are one clip, models/melee.ts, with each one's own poses.
    knife: knifeDef(kit), crowbar: crowbarDef(kit), shovel: shovelDef(kit), baton: batonDef(kit),
    // The akimbo mod's left-hand pistols (weapons/mods.ts AKIMBO_GUNS); the SMG's own `smgLeft` is above.
    rivetLeft: leftOf(rivetDef(kit)), ultramagLeft: leftOf(ultramagDef(kit)), judgeLeft: leftOf(judgeDef(kit)),
    autorafficaLeft: leftOf(autorafficaDef(kit)),
  };
}

/**
 * A pistol's akimbo twin: `def`, a build of its own, out on the left as far as the right one is on the right (and `gap` more, as
 * akimbo pushes the right one out). The left hand holds it as the right holds its own: `gripR` mirrored across the gun (`gripAk`).
 * No sights, as akimbo has no ADS.
 */
export function leftOf(def: ViewDef, gap = 0.03): ViewDef {
  const r = def.model.sockets.gripR!;
  const s = new THREE.Object3D();
  s.name = 'gripAk';
  s.position.set(-r.position.x, r.position.y, r.position.z);
  s.quaternion.set(r.quaternion.x, -r.quaternion.y, -r.quaternion.z, r.quaternion.w);
  r.parent!.add(s);
  def.model.sockets.gripAk = s;
  return {
    ...def, id: `${def.id}Left`, pos: [-def.pos[0] - gap, def.pos[1], def.pos[2]], rot: [def.rot[0], -def.rot[1], -def.rot[2]],
    sight: undefined, rear: undefined, right: null, left: { socket: 'gripAk', pose: HANDS.grip },
  };
}

export function buildOffhand(kit: Kit): OffhandSet {
  return { grenade: buildGrenade(kit), walkie: buildWalkie(kit), designator: buildDesignator(kit), stim: buildStim(kit) };
}
