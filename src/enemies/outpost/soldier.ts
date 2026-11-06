/** One man's state. The Enemy is the body; this is what he knows, what he has been told and how he feels. */
import * as THREE from 'three';
import type { PostureName } from '../../characters/animation/postures';
import { Injuries } from '../wounds/injuries';
import type { Enemy } from '../Enemy';
import type { CoverSpot } from './cover';
import { ROLES, type Role, type RoleDef } from './doctrine';
import type { MoraleState } from './morale';
import { Route } from './routes';
import type { OutpostSquad } from './squad';

export type Task = 'hold' | 'move';
export type HoldStage = 'hide' | 'peek';
export type Fate = 'none' | 'flee' | 'surrender';
export type AidStage = 'none' | 'reach' | 'drag' | 'treat';
export type Grenade = 'frag' | 'flash';
/** What is in his hands. */
export type Weapon = 'primary' | 'sidearm' | 'none';
/** 0 walks, 1 jogs, 2 sprints while the sprint lasts. */
export type Urgency = 0 | 1 | 2;

/** A man can sprint this long before dropping back to a jog. */
export const SPRINT_SECONDS = 3;

export class Soldier {
  e!: Enemy;
  squad!: OutpostSquad;
  role: Role = 'rifle';
  def: RoleDef = ROLES.rifle;
  /** Number in the squad, for 'Alpha-2'. */
  seat = 0;
  /** Which of the squad's two fire teams. One moves while the other covers. */
  team: 0 | 1 = 0;

  morale = 100;
  baseMorale = 100;
  state: MoraleState = 'steady';
  /** Last time something frightened him. Morale only comes back after a quiet spell. */
  scaredAt = -99;

  /** 0..1 how sure he is he saw something. Reaching 1 is a sighting. */
  notice = 0;
  sees = false;
  /** Heard something, or was shot at. He looks harder. */
  alertUntil = 0;
  /** Last time he had a fix of his own. */
  knownAt = -99;
  senseAt = 0;

  task: Task = 'hold';
  readonly route = new Route();
  readonly dest = new THREE.Vector3();
  spot: CoverSpot | null = null;
  /** An order waiting to be walked. Orders reach men a beat apart, so a team never moves as one body. */
  hasOrder = false;
  orderAt = 0;
  urgency: Urgency = 1;
  sprintLeft = SPRINT_SECONDS;
  /** Route stall detection. */
  progressAt = 0;
  readonly progressFrom = new THREE.Vector3();
  stalls = 0;

  stage: HoldStage = 'hide';
  /** Where he stands to fire from this spot, and which way he leans. */
  readonly firePoint = new THREE.Vector3();
  fireSide = 0;
  canShoot = false;
  noShotSince = 0;
  nextPeekAt = 0;
  peekUntil = 0;
  /** Weapon up and able to fire. */
  exposed = false;
  /** Firing round the corner without looking. */
  blind = false;
  /** Told to keep a position under fire while the other team moves. */
  suppressing = false;
  /** Where the gun points when he cannot see the player. */
  readonly aim = new THREE.Vector3();
  mag = 0;
  reloadUntil = 0;

  grenades = 0;
  /** A throw the squad has ordered. */
  throwKind: Grenade | null = null;
  readonly throwAt = new THREE.Vector3();

  fate: Fate = 'none';
  /** Hands up and out of the fight, until he is shot or walks away. */
  surrendered = false;
  surrenderedAt = 0;
  /** Finished kneeling: led off the map, or left to walk. */
  released = false;

  /** Led the squad at the moment he left it. Read once, after the body is gone. */
  wasLeader = false;

  /** What he has wrong with him. See src/enemies/wounds. */
  readonly injuries = new Injuries();
  /** His speed before any wound. */
  baseSpeed = 1;
  weapon: Weapon = 'primary';
  /** Already used up the pistol. A man has one. */
  spentSidearm = false;
  /** Holding it in his left, because his right is gone. */
  sidearmLeft = false;
  /** Where the gun he dropped is, and the same again when he is going for it. */
  droppedAt: THREE.Vector3 | null = null;
  scramble: THREE.Vector3 | null = null;
  /** Dragging himself somewhere, and when he next thinks again about where. */
  crawling = false;
  crawlPlanAt = 0;
  /** Last time he called out, which is what brings people. */
  calledAt = -99;

  /** On the ground, unable to act. Set through Outpost.setDowned. */
  downed = false;
  rescuer: Soldier | null = null;
  patient: Soldier | null = null;
  aidStage: AidStage = 'none';
  aidUntil = 0;

  /** Back to a blank man for the pool. */
  clear(): void {
    this.role = 'rifle';
    this.def = ROLES.rifle;
    this.seat = 0;
    this.team = 0;
    this.morale = this.baseMorale = 100;
    this.state = 'steady';
    this.scaredAt = -99;
    this.notice = 0;
    this.sees = false;
    this.alertUntil = 0;
    this.knownAt = -99;
    this.senseAt = 0;
    this.task = 'hold';
    this.route.clear();
    this.spot = null;
    this.hasOrder = false;
    this.orderAt = 0;
    this.urgency = 1;
    this.sprintLeft = SPRINT_SECONDS;
    this.progressAt = 0;
    this.stalls = 0;
    this.stage = 'hide';
    this.fireSide = 0;
    this.canShoot = false;
    this.noShotSince = 0;
    this.nextPeekAt = this.peekUntil = 0;
    this.exposed = this.blind = this.suppressing = false;
    this.mag = 0;
    this.reloadUntil = 0;
    this.grenades = 0;
    this.throwKind = null;
    this.fate = 'none';
    this.surrendered = this.released = false;
    this.surrenderedAt = 0;
    this.wasLeader = false;
    this.downed = false;
    this.rescuer = this.patient = null;
    this.aidStage = 'none';
    this.aidUntil = 0;
    this.injuries.clear();
    this.baseSpeed = 1;
    this.weapon = 'primary';
    this.spentSidearm = this.sidearmLeft = this.crawling = false;
    this.droppedAt = this.scramble = null;
    this.crawlPlanAt = 0;
    this.calledAt = -99;
  }

  get callsign(): string {
    return `${this.squad.name}-${this.seat}`;
  }

  /** Still takes orders. */
  get fighting(): boolean {
    return this.fate === 'none' && !this.downed;
  }

  get isLeader(): boolean {
    return this.squad.leader === this;
  }
}

const ENLISTED = new WeakMap<object, Soldier>();

/** The soldier riding on a body, if it has one. Lives here, not on Enemy, because only one contract needs it. */
export const soldierOf = (e: object): Soldier | undefined => ENLISTED.get(e);
export const enlist = (e: Enemy, s: Soldier): void => void ENLISTED.set(e, s);
export const discharge = (e: Enemy): void => void ENLISTED.delete(e);

interface Posed {
  setPosture?(posture: PostureName): void;
}

/** Postures a man holds a pistol out in, when the hand with the grip is gone. */
const AIMING: ReadonlySet<PostureName> = new Set<PostureName>(['stand', 'peek', 'leanLeft', 'leanRight']);
/** Postures a gut wound will not let him straighten up into. */
const UPRIGHT: ReadonlySet<PostureName> = new Set<PostureName>(['stand', 'crouch', 'peek', 'flee']);

/**
 * Every posture goes through here, so a wound can overrule whatever his orders want from his body. A man on the floor stays on it
 * whatever behaviour last finished, and a gut-shot man does not stand up straight because he has been told to walk.
 */
export function pose(e: Enemy, posture: PostureName): void {
  const s = soldierOf(e);
  let wanted = posture;
  if (s?.injuries.floored) wanted = 'downed';
  else if (s?.sidearmLeft && s.weapon === 'sidearm' && AIMING.has(posture)) wanted = 'pistol';
  else if (s?.injuries.hunched && UPRIGHT.has(posture)) wanted = 'hunched';
  (e.char.anim as unknown as Posed).setPosture?.(wanted);
}
