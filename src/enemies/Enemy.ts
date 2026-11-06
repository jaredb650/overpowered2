/** Runtime state of one enemy. Pooled; `reset` must restore every field a previous life could have touched. */
import * as THREE from 'three';
import type { GoreRegion } from '../characters/rig';
import type { CharacterInstance, EmitterHandle, LoopHandle } from '../core/contracts';
import type { EnemyId, EnemyInstance } from '../core/gameplay';
import type { AttackDef, AttackPhase, Behaviour } from './brain';
import type { EnemyDef } from './data';
import type { Plate } from './armor';
import type { Squad } from './director';
import type { BossController } from './bosses';

export type MoveMode =
  /** Follow the shared flow field to the player. */
  | 'flow'
  /** Straight line to `moveTarget`, falling back to flow when blocked. */
  | 'point'
  /** Circle the player at `orbitRadius`. */
  | 'orbit'
  /** Walk up the path-distance field, away from the player by the real route. */
  | 'flee'
  /** Stand still. */
  | 'hold';

export type FaceMode = 'move' | 'player' | 'lock';

/** What remains of the body. Every maimed rule reads this and nothing else. */
export interface MaimState {
  legs: number;
  arms: number;
  /** The arm that holds the weapon. */
  gunArm: boolean;
  offArm: boolean;
  head: boolean;
}

export type EntranceKind = 'none' | 'drop' | 'gate' | 'fly' | 'boss';

export class Enemy implements EnemyInstance {
  get machine(): boolean {
    return this.def.machine === true;
  }

  uid = 0;
  id: EnemyId = 'husk';
  def!: EnemyDef;
  char!: CharacterInstance;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly center = new THREE.Vector3();
  yaw = 0;
  health = 0;
  maxHealth = 0;
  armor = 0;
  alive = false;
  score = 0;
  isBoss = false;
  frozen = 0;
  burning = 0;

  /** Multipliers from the wave this enemy spawned in. */
  damageMul = 1;
  speedMul = 1;

  // Perception, refreshed on think ticks.
  dist = 999;
  pathDist = 999;
  hasLos = false;
  losAt = 0;
  /** True when the enemy sits inside the player's view cone. */
  inView = false;
  /** Seconds the crosshair has been on this enemy. */
  aimedAt = 0;
  /** Decaying 0..1 from near misses and hits. Drives cover and dodges. */
  pressure = 0;
  lastDodgeAt = -99;
  thinkAt = 0;
  /** Next line it may say out loud. */
  barkAt = 0;
  /** Next time being hurt may make it cry out. */
  painAt = 0;

  // Movement intent, written by behaviours.
  mode: MoveMode = 'flow';
  face: FaceMode = 'move';
  /** Fraction of the def's run speed. */
  pace = 1;
  readonly moveTarget = new THREE.Vector3();
  orbitRadius = 6;
  orbitDir = 1;
  /** Extra sideways weave on flow movement, so runners do not form a queue. */
  weave = 0;
  weavePhase = 0;
  /** Which side this enemy favours. Squads split flankers with it. */
  side = 1;

  // Movement state.
  readonly desired = new THREE.Vector3();
  /** Knockback, decays on its own. */
  readonly push = new THREE.Vector3();
  groundY = 0;
  airborne = false;
  verticalSpeed = 0;
  /** While jumping on a set arc the horizontal velocity is not steered. */
  ballistic = false;
  /** Seconds until a leap reaches the point it was aimed at. Zero for a fall or a pad flight, which have no aim. */
  flightLeft = 0;
  readonly leapTarget = new THREE.Vector3();
  /** Held off the ground by its own behaviour: clinging to a wall, or hovering. */
  pinned = false;
  /** Test Range: stands where it was put. Knockback still moves it, and nothing else does. */
  dummy = false;
  /** Never leaps up a ledge it runs into. The swarm flows that way, and a man in kit does not clear 4.5 m from a stand. */
  footbound = false;
  /** Someone has him by the collar: the player's own hostage is no body to bump into. */
  carried = false;
  /** How long progress has been too slow while trying to move. */
  stuck = 0;
  /** After getting stuck in point mode, follow flow until this time. */
  flowUntil = 0;
  /** Next wall ray for moves that leave the flow field. */
  probeAt = 0;
  readonly lastProgress = new THREE.Vector3();
  readonly groundSampleAt = new THREE.Vector2();
  /** Pulse phase for crawling and hopping gaits. */
  gaitPhase = 0;
  /** Shortest path to the player in the current window, and when it last got shorter. Finds the truly stranded. */
  bestPath = Infinity;
  bestPathAt = 0;
  /** Where the body stood when that window opened. */
  readonly windowStart = new THREE.Vector3();
  /** Last time the player shouldered through this body. */
  lastBumpAt = -99;
  /** Clock for damage from standing on a live hazard. */
  hazardTick = 0;

  // Entrance.
  entrance: EntranceKind = 'none';
  entranceTime = 0;
  readonly entranceDir = new THREE.Vector3();

  // Brain.
  behaviours: Behaviour[] = [];
  behaviour: Behaviour | null = null;
  behaviourUntil = 0;
  /** Free slots for the current behaviour, cleared on enter. Avoids a state object per role. */
  timerA = 0;
  timerB = 0;
  stage = 0;
  readonly scratchPoint = new THREE.Vector3();

  attacks: AttackDef[] = [];
  attack: AttackDef | null = null;
  attackPhase: AttackPhase = 'idle';
  attackClock = 0;
  attackWindup = 0;
  attackShots = 0;
  attackReadyAt = 0;
  /** Free slot for the running attack, so attacks never fight behaviours over `stage`. */
  attackStage = 0;
  readonly attackCooldowns = new Map<AttackDef, number>();
  /** Direction or point an attack locked at the end of its telegraph. */
  readonly aimDir = new THREE.Vector3(0, 0, 1);
  readonly aimPoint = new THREE.Vector3();
  /** Handle into the telegraph pool, or -1. */
  laser = -1;
  /** Sound that lasts as long as the attack: a minigun, a flame, a beam. */
  attackLoop: LoopHandle | null = null;
  /** Sound the body always makes: rotors, legs. */
  bodyLoop: LoopHandle | null = null;
  /** Shots since the last change of position. */
  shotsFired = 0;
  /** Earliest time it may run for cover again. */
  coverReadyAt = 0;

  squad: Squad | null = null;
  /** Bearing around the player this enemy tries to hold. */
  slotAngle = 0;
  /** Token flags, so a dying enemy can give its slot back. */
  holdsRanged = false;
  holdsMelee = false;

  // Damage state.
  readonly limbHp = new Map<GoreRegion, number>();
  plates: Plate[] = [];
  readonly maim: MaimState = { legs: 2, arms: 2, gunArm: true, offArm: true, head: true };
  /** Poise spent since it last recovered. Staggers when it passes the def's limit. */
  poise = 0;
  stagger = 0;
  /** What recent hits have done to its balance. Fades by itself. See reactions.ts. */
  shock = 0;
  /** World time it may next be staggered. */
  reactAt = 0;
  /** Catch steps: where the hit is carrying the body, in m/s. Fades faster than a walk and slower than knockback. */
  readonly reel = new THREE.Vector3();
  /** Seconds until a stagger becomes a fall, and how hard. Zero if it is keeping its feet. */
  fallIn = 0;
  fallStrength = 0;
  fallBone = 0;
  /** Gore has the body. Nothing here moves or poses it until it comes back. */
  downed = false;
  /** Seconds of get-up left once it has. */
  rising = 0;
  /** How long this get-up runs, and how long it stands there after, for when gore gives it back. */
  riseSeconds = 0;
  dazeSeconds = 0;
  blood = 0;
  /** HP per second lost through open stumps. */
  bleed = 0;
  burnTick = 0;
  burnEmitter: EmitterHandle | null = null;
  /** 0..1 how much of the skin has blackened. It stays after the fire goes out. */
  charred = 0;
  /** Warden shield hit points. */
  ward = 0;
  wardBy: Enemy | null = null;
  wardVisual = -1;
  /** Speed multiplier from a Warden's aura, faded by the aura tick. */
  buff = 0;
  /** Riot shield is still up. */
  shield = false;

  /** Set after the killing blow while the body plays out a death: a drone's crash, a boss's last act. */
  dying = 0;
  dyingKind: 'none' | 'crash' | 'boss' = 'none';
  /** Distance tier for animation and think rates. */
  lod = 0;
  boss: BossController | null = null;
  /** Bomber, burner and rocketeer tanks have blown. Stops a chain from firing twice. */
  tankBlown = false;

  reset(): void {
    this.position.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.center.set(0, 0, 0);
    this.yaw = 0;
    this.health = this.maxHealth = this.armor = 0;
    this.alive = false;
    this.score = 0;
    this.isBoss = false;
    this.frozen = this.burning = 0;
    this.damageMul = this.speedMul = 1;
    this.dist = this.pathDist = 999;
    this.hasLos = this.inView = false;
    this.losAt = this.aimedAt = this.pressure = 0;
    this.lastDodgeAt = -99;
    this.thinkAt = this.barkAt = this.painAt = 0;
    this.mode = 'flow';
    this.face = 'move';
    this.pace = 1;
    this.moveTarget.set(0, 0, 0);
    this.orbitRadius = 6;
    this.orbitDir = 1;
    this.weave = this.weavePhase = 0;
    this.side = 1;
    this.desired.set(0, 0, 0);
    this.push.set(0, 0, 0);
    this.groundY = 0;
    this.airborne = this.ballistic = this.pinned = this.dummy = this.footbound = this.carried = false;
    this.verticalSpeed = this.flightLeft = 0;
    this.leapTarget.set(0, 0, 0);
    this.stuck = this.flowUntil = this.probeAt = 0;
    this.gaitPhase = 0;
    this.bestPath = Infinity;
    this.bestPathAt = 0;
    this.windowStart.set(0, 0, 0);
    this.lastBumpAt = -99;
    this.hazardTick = 0;
    this.entrance = 'none';
    this.entranceTime = 0;
    this.behaviours = [];
    this.behaviour = null;
    this.behaviourUntil = this.timerA = this.timerB = this.stage = 0;
    this.attacks = [];
    this.attack = null;
    this.attackPhase = 'idle';
    this.attackClock = this.attackWindup = this.attackShots = this.attackReadyAt = this.attackStage = 0;
    this.attackCooldowns.clear();
    this.laser = -1;
    this.attackLoop = this.bodyLoop = null;
    this.shotsFired = this.coverReadyAt = 0;
    this.squad = null;
    this.slotAngle = 0;
    this.holdsRanged = this.holdsMelee = false;
    this.limbHp.clear();
    this.plates = [];
    this.maim.legs = this.maim.arms = 2;
    this.maim.gunArm = this.maim.offArm = this.maim.head = true;
    this.poise = this.stagger = this.blood = this.bleed = this.burnTick = this.charred = 0;
    this.shock = this.reactAt = this.fallIn = this.fallStrength = this.fallBone = 0;
    this.reel.set(0, 0, 0);
    this.downed = false;
    this.rising = this.riseSeconds = this.dazeSeconds = 0;
    this.burnEmitter = null;
    this.ward = 0;
    this.wardBy = null;
    this.wardVisual = -1;
    this.buff = 0;
    this.shield = false;
    this.dying = 0;
    this.dyingKind = 'none';
    this.lod = 0;
    this.boss = null;
    this.tankBlown = false;
  }
}
