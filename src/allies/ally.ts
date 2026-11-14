/** One friendly soldier. The Enemy is only his body, for the shared steering and animation; everything he knows lives here. */
import * as THREE from 'three';
import type { EnemyInstance } from '../core/gameplay';
import { Enemy } from '../enemies/Enemy';
import type { CoverSpot } from '../enemies/outpost/cover';
import type { Foe } from '../enemies/outpost/soldier';
import { Route } from '../enemies/outpost/routes';
import { Injuries } from '../enemies/wounds/injuries';
import { ALLY_TYPES, type AllyType, type AllyTypeDef } from './data';
import type { Vitals } from './rules';

export type Order = 'post' | 'follow';

export class Ally implements Vitals, Foe {
  readonly body = new Enemy();
  type: AllyType = 'rifleman';
  def: AllyTypeDef = ALLY_TYPES.rifleman;
  /** Seat in the squad: who stands where when following. */
  seat = 0;

  state: 'up' | 'down' | 'dead' = 'up';
  health = 0;
  maxHealth = 0;
  readonly injuries = new Injuries();
  bleedsOutAt = 0;

  /** The area he holds. */
  readonly post = new THREE.Vector3();
  postRadius = 6;
  /** Which way the post faces, for a man with nothing to look at. NaN for any. */
  postYaw = Number.NaN;
  order: Order = 'post';

  target: EnemyInstance | null = null;
  /** A vehicle he is shooting at instead of a man: where it is. */
  readonly armour = new THREE.Vector3();
  hasArmour = false;
  seenAt = -99;
  readonly lastSeen = new THREE.Vector3();
  thinkAt = 0;

  readonly dest = new THREE.Vector3();
  readonly route = new Route();
  spot: CoverSpot | null = null;
  /** Leans out of his spot to this side to fire: -1, 0 or 1. */
  fireSide = 0;
  patrolAt = 0;
  stalls = 0;
  readonly progressFrom = new THREE.Vector3();
  progressAt = 0;

  mag = 0;
  reloadUntil = 0;
  burstLeft = 0;
  nextShotAt = 0;

  /** Medic: stims left, the man he is working on, and when he finishes. */
  stims = 0;
  patient: Ally | null = null;
  treatedBy: Ally | null = null;
  treatUntil = 0;

  checkFireAt = -99;

  get alive(): boolean {
    return this.state === 'up';
  }

  get center(): THREE.Vector3 {
    return this.body.center;
  }

  /** Set by the system: one enemy round at him. See `Foe`. */
  shotAt: Foe['shotAt'] = () => {};
  /** Set by the system: an enemy rocket's burst landing on allies. See `Foe`. */
  blast: Foe['blast'] = () => {};

  clear(): void {
    this.state = 'up';
    this.health = this.maxHealth = 0;
    this.injuries.clear();
    this.bleedsOutAt = 0;
    this.postYaw = Number.NaN;
    this.order = 'post';
    this.target = null;
    this.hasArmour = false;
    this.seenAt = -99;
    this.thinkAt = 0;
    this.route.clear();
    this.spot = null;
    this.fireSide = 0;
    this.patrolAt = this.stalls = this.progressAt = 0;
    this.mag = this.reloadUntil = this.burstLeft = this.nextShotAt = 0;
    this.stims = 0;
    this.patient = this.treatedBy = null;
    this.treatUntil = 0;
    this.checkFireAt = -99;
  }
}
