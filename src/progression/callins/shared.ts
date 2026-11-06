/** What every call-in shares. */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import type { ModelMaterials } from '../modelkit';
import type { GroundProbe } from './ground';
import type { Ordnance } from './ordnance';

const _lifted = new THREE.Vector3();

/**
 * A blast point standing clear of the floor. combat.explode tests each victim with a ray from the blast, and a ray
 * that starts on the floor stops there, so a blast on the exact impact point reaches nobody at all.
 */
export function aboveFloor(p: THREE.Vector3): THREE.Vector3 {
  return _lifted.copy(p).setY(p.y + 0.7);
}

export interface StrikeKit {
  ctx: Ctx;
  probe: GroundProbe;
  materials: ModelMaterials;
  ordnance: Ordnance;
  /** The one Warthog airframe, hidden between runs. */
  jet: THREE.Group;
}

/**
 * A running call-in. The clock handed to `update` is time.realDt: strikes keep the first game's rhythm through SLOWMO,
 * and because rockets themselves fly on world time they pile up mid-air, which is the accident worth keeping.
 * It only ticks while playing, so pause holds a strike and `dispose` on a new run kills it.
 */
export interface Strike {
  /** Returns true once finished. */
  update(dt: number): boolean;
  /** Called when it finishes and when a run ends early: no more damage, nothing left in the scene. */
  dispose(): void;
}

export interface StrikeOrder {
  point: THREE.Vector3;
  /** Unit XZ direction of travel. Only the Warthog uses it. */
  heading: THREE.Vector3;
}
