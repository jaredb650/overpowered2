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

/**
 * A call-in that is an aircraft: the door gunner, the attack chopper and the gunship. Each is the player's to fly or an
 * AI's, and it is what the enemy's anti-air (part 2 of `docs/proposals/air-support.md`) will shoot at.
 */
export interface Aircraft extends Strike {
  readonly position: THREE.Vector3;
  /** Missile hits left before it goes down. */
  hits: number;
  /** Flares left to throw at a missile. */
  flares: number;
  /** A missile reached it. True when that brought it down. */
  hit(): boolean;
  /** Down now: whoever is in the seat is back in the body, and the aircraft is gone. */
  down(): void;
}

export function isAircraft(strike: Strike): strike is Aircraft {
  return typeof (strike as Partial<Aircraft>).down === 'function';
}

/**
 * Tap or hold on a call-in key. A tap is a press let go inside `hold` seconds, a hold is one kept down that long. Feed it
 * the key every frame from the press on; it answers once and is then idle until the next `press`.
 */
export class TapOrHold {
  private t = -1;

  constructor(private readonly hold: number) {}

  get waiting(): boolean {
    return this.t >= 0;
  }

  press(): void {
    this.t = 0;
  }

  cancel(): void {
    this.t = -1;
  }

  update(dt: number, down: boolean): 'tap' | 'hold' | null {
    if (this.t < 0) return null;
    this.t += dt;
    if (!down) {
      this.t = -1;
      return 'tap';
    }
    if (this.t < this.hold) return null;
    this.t = -1;
    return 'hold';
  }
}
