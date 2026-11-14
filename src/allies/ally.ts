/** One friendly soldier. The Enemy is only his body, for the shared steering and animation; everything he knows lives here. */
import * as THREE from 'three';
import type { Structure } from '../core/contracts';
import type { EnemyInstance } from '../core/gameplay';
import { Enemy } from '../enemies/Enemy';
import type { CoverSpot } from '../enemies/outpost/cover';
import type { Foe } from '../enemies/outpost/soldier';
import { Route } from '../enemies/outpost/routes';
import { Injuries } from '../enemies/wounds/injuries';
import { ALLY_TYPES, type AllyType, type AllyTypeDef } from './data';
import type { Vitals } from './rules';

export type Order = 'post' | 'follow';

/**
 * A mounted gun as a man on it uses it (`vehicles/emplacement.ts`, `occupy` / `aimAt` / `trigger` / `vacate`). Only the shape: the allies
 * never import the vehicles.
 */
export interface AllyMount {
  readonly standAt: THREE.Vector3;
  readonly pivot: THREE.Vector3;
  readonly spec: { readonly yaw: number; readonly arc: number };
  readonly occupant: unknown;
  occupy(who: object): boolean;
  vacate(who: object): void;
  aimAt(point: THREE.Vector3): void;
  trigger(held: boolean): void;
}

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
  /** The mounted gun at his post, if it has one. He mans it while he holds the post and the player is not at it. */
  mount: AllyMount | null = null;
  /** On the gun now: `mount.occupant` is him. */
  manning = false;

  target: EnemyInstance | null = null;
  /** A vehicle he is shooting at instead of a man: where it is. */
  readonly armour = new THREE.Vector3();
  hasArmour = false;
  seenAt = -99;
  readonly lastSeen = new THREE.Vector3();
  thinkAt = 0;

  readonly dest = new THREE.Vector3();
  readonly route = new Route();
  /** The far destination his last long route search was for, and until when he keeps that route through stalls. */
  readonly longTo = new THREE.Vector3(Infinity, 0, 0);
  longUntil = 0;
  /** A shut lift gate his route stops at: he waits for it to rise, then goes on. */
  via: Structure | null = null;
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
    this.mount = null;
    this.manning = false;
    this.target = null;
    this.hasArmour = false;
    this.seenAt = -99;
    this.thinkAt = 0;
    this.route.clear();
    this.longTo.set(Infinity, 0, 0);
    this.longUntil = 0;
    this.via = null;
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
