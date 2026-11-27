/**
 * Procedural humanoid animation.
 *
 * Feet are planted in world space and swing between predicted landing spots; the pelvis, spine, arms and head
 * are then driven from the gait phase and the measured velocity, so a character cannot foot-slide no matter how
 * the AI moves it. Hands are IK targets too, which is what lets weapons, swings and crawling share one path.
 * Actions layer on top, flinches ride on springs, and everything reads the severed set to pick a body plan.
 */
import * as THREE from 'three';
import type { AnimAction, CharacterAnimation, LocomotionInput } from '../../core/contracts';
import { DevFlags } from '../../core/devflags';
import { HumanoidBone as H, type GoreRegion, type RigDef } from '../rig';
import type { ArchetypeDef } from '../archetypes';
import { GetUpPose, sampleGetUp, type GetUpKind } from './getUp';
import { Limb } from './ik';
import { Postures, type PostureName } from './postures';
import { HitSpring, Spring3 } from './springs';
import { Sway, type SwayPart } from './sway';
import { STYLES, type MoveStyle } from './styles';

const TAU = Math.PI * 2;
const LAND_LEAD = 0.36;
const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const damp = (a: number, b: number, rate: number, dt: number) => a + (b - a) * (1 - Math.exp(-rate * dt));
const wrap = (a: number) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;

const qA = new THREE.Quaternion();
const qB = new THREE.Quaternion();
const qC = new THREE.Quaternion();
const qD = new THREE.Quaternion();
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vC = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

const qEuler = (out: THREE.Quaternion, x: number, y: number, z: number) => out.setFromEuler(euler.set(x, y, z, 'YXZ'));
const clipPose = new GetUpPose();

/**
 * Stiffness and damping of the springs a flinch rides on, read when an animator is made. Damped at 0.8 of critical (0.6 for
 * the head), a hit lands, leans and comes back without rocking past where it started; at the old values, about half, the
 * chest rang past rest by a seventh of its lean. The peak barely moves with them: how far a flinch goes is set by its size.
 * The chest's also carries an enemy's own recoil (`play('shoot')`). `?mass=0` puts back the old ones, the same flag gore's
 * weight of hits reads (`MASS_PASS` in `gore/muscles.ts`), which characters do not import.
 */
export const FlinchSprings = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('mass') === '0'
  ? { spine: [170, 13], chest: [210, 15], head: [240, 13], pelvis: [180, 15] }
  : { spine: [110, 17], chest: [130, 19], head: [160, 15], pelvis: [120, 18] };

/**
 * How a hit shows on a body that stays on its feet (the gore update's R1, `?flinch=0` for the nod it replaces). Every figure is
 * the peak a flinch of size 1 reaches from rest, in radians unless it says otherwise; `flinch` sizes it by the weapon and the
 * body's build. What reads from behind the gun is sideways and down, so the trunk twists with the struck shoulder and drops
 * it, a struck arm is thrown back and out with the elbow folding after it, and a struck leg gives at the knee. It all rides on
 * `HitSpring`, which peaks in four frames and comes back overdamped: no part crosses rest on the way home.
 */
export const HitShape = {
  /** The trunk: leaning away along the shot, turning the struck shoulder with the round, and dropping that shoulder. */
  lean: 0.16,
  twist: 0.5,
  drop: 0.36,
  /** A round that lands nearer the spine than this share of the shoulder's width goes to one side or the other by turns. */
  centre: 0.6,
  /** Furthest fire can hold the trunk, on any axis. */
  trunkMax: 0.7,
  /** A round in the belly folds the body over it, whichever way it came. */
  fold: 0.22,
  /** The hips: pushed back along the shot and off to the side away from the struck shoulder, and sinking, in body heights. */
  hipBack: 0.035,
  hipSide: 0.03,
  hipSink: 0.04,
  hipsMax: 0.09,
  /** How much of the trunk's twist and roll the pelvis takes over planted feet. */
  hipsTurn: 0.25,
  /** The head, on a hit to it: snapped along the shot, turned and tipped by the side it was struck on. */
  headSnap: 0.4,
  headTurn: 0.34,
  headTilt: 0.26,
  headMax: 0.7,
  /** And on a hit to the trunk: how much of the shoulder's drop the head goes with, where it would otherwise stay level. */
  headFollow: 0.8,
  /** A struck arm: the upper arm thrown back along the shot and out from the body, and the elbow folding after it. */
  armSwing: 0.55,
  armOut: 0.45,
  elbow: 0.55,
  wrist: 0.4,
  armMax: 0.95,
  /** The arm on the struck side of a chest hit goes with the shoulder by this share, and the other arm by this one. */
  armFollow: 0.45,
  armOther: 0.12,
  /** A hand with a gun in it is thrown this much of that; the hand on its foregrip goes this much of the way with it. */
  gunArm: 0.75,
  gunFollow: 0.55,
  /** A struck leg: how far its knee gives per unit of size (1 is a buckle), and the most a flinch asks. */
  knee: 0.5,
  kneeMax: 0.8,
  /** And the body over it: bent forward, leaning to that side, the hips shifted toward it in body heights. */
  legFold: 0.1,
  legLean: 0.12,
  legShift: 0.024,
  /**
   * A hit to the trunk this big (its size for this build) on a body standing still takes a catch step: the foot on the
   * struck side goes back this far, in body heights, and the idle walks it home. Not again for `stepGap` seconds, or held
   * fire would have it dancing.
   */
  stepFrom: 1.2,
  step: 0.14,
  stepGap: 0.6,
};

/**
 * How a hurt body carries itself (the gore update's R2, `setHurt`): bent over and lower by how badly it is hurt, going back
 * to its last wound with a free hand, and limping on a leg its wounds have weakened.
 */
export const HurtShape = {
  /** At full hurt: radians the spine bends and the head hangs, and body heights the hips sink. */
  bend: 0.36,
  head: 0.16,
  drop: 0.045,
  /** Rate it eases in and out at, 1/s. */
  rate: 2.5,
  /** Hurt this much or more, a hand goes back to the last wound every `guardEvery` seconds (give or take 40%), for `guardFor`. */
  guardFrom: 0.4,
  guardEvery: 3.2,
  guardFor: 1.5,
  /**
   * A limp at full weakness: body heights the hips dip while the weak leg carries the body, radians the trunk lurches over
   * it, and, standing, body heights the hips rest toward the good leg.
   */
  limpDip: 0.04,
  limpRoll: 0.14,
  limpRest: 0.025,
};

/** How a body takes a hit that upsets its balance. */
const REEL = {
  /** Seconds of quick steps at full strength. */
  seconds: 1.15,
  /** Step rate while reeling, as a multiple of the walk at that speed. A catch step is fast or it is a fall. */
  cadence: 2,
  /** Lean per metre per second of reel, and the most of it. */
  lean: 0.09,
  leanMax: 0.5,
  /** How fast flailing arms and a buckled knee recover, in 1/s. */
  flailFade: 1.9,
  buckleFade: 2.6,
  /** How fast they get there, in 1/s. */
  takeUp: 16,
  /** Fraction of body height a buckled knee drops the hips, and the roll toward it. */
  buckleDrop: 0.075,
  buckleRoll: 0.34,
  /** How much of a flail takes a hand holding a gun with it. */
  gunHand: 0.55,
};

/** Clip length that is the cross-fade back into ordinary standing. */
const GETUP_RELEASE = 0.16;
/** Seconds to blend from a ragdoll's pose into the first frame of a clip. */
const POSE_MATCH = 0.42;
/** Shorter into a later frame, which a body that pushed itself part of the way up is already close to. */
const POSE_MATCH_PART = 0.25;
/** Longer for a body with no clip, whose whole change of pose is this blend. */
const POSE_MATCH_CRAWL = 0.7;
/** Seconds a wound hold takes to arrive and to let go. */
const CLUTCH_RATE = 9;
/** The joints that reach the floor first, and how far above it their bones ride, which is about a limb's radius. */
const LOW_BONES = [H.foreArmL, H.handL, H.foreArmR, H.handR, H.shinL, H.footL, H.shinR, H.footR];
const FLOOR_CLEARANCE = 0.04;
/** Radians a body folds and leans to get a hand down a leg. */
const CLUTCH_BEND = 0.7;
const CLUTCH_ROLL = 0.2;
const GUARD_RATE = 12;
/** Radians of sway at full daze, and how fast it goes. */
const DAZE_SWAY = 0.2;

export interface WeaponGrip {
  /** Prop-to-hand rotation from the hand socket, and its position on the hand. */
  socketPos: THREE.Vector3;
  socketRot: THREE.Quaternion;
  /** Where the off hand holds, in prop space. Null for one-handed weapons. */
  foregrip: THREE.Vector3 | null;
}

interface Foot {
  planted: boolean;
  /** Ankle position in the movement frame. */
  pos: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  yaw: number;
  fromYaw: number;
  t: number;
  dur: number;
  pitch: number;
  side: 1 | -1;
  limb: Limb | null;
  hipOffset: THREE.Vector3;
  phaseOffset: number;
  lastPsi: number;
  ground: number;
  /** Non-zero while the toe is rolling off, in radians. */
  roll: number;
}

interface Hand {
  limb: Limb | null;
  shoulderOffset: THREE.Vector3;
  side: 1 | -1;
  target: THREE.Vector3;
  pole: THREE.Vector3;
  /** Crawling: hand planted in the movement frame. */
  planted: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  swinging: boolean;
}

type Plan = 'biped' | 'hop' | 'crawl' | 'writhe';

type Curve = readonly (readonly [number, number])[];

/** Keyed curve lookup on [time, value] pairs with eased segments. */
function key(t: number, k: Curve): number {
  if (t <= k[0]![0]) return k[0]![1];
  for (let i = 1; i < k.length; i++) {
    const b = k[i]!;
    if (t < b[0]) {
      const a = k[i - 1]!;
      return lerp(a[1], b[1], smooth((t - a[0]) / (b[0] - a[0])));
    }
  }
  return k[k.length - 1]![1];
}

/** Keyed curves, hoisted so that an active action allocates nothing per frame. Time runs 0..1 over the action. */
const C = {
  attackMelee1: [[0, 0], [0.3, 0.04], [0.52, 0.1], [1, 0]],
  attackMelee2: [[0, 0], [0.3, -0.05], [0.52, 0.13], [1, 0]],
  attackMelee3: [[0, 0], [0.32, -0.25], [0.52, 0.35], [1, 0]],
  attackHeavy1: [[0, 0], [0.42, -0.015], [0.58, 0.2], [0.76, 0.17], [1, 0]],
  attackHeavy2: [[0, 0], [0.42, -0.08], [0.6, 0.15], [1, 0]],
  throw1: [[0, 0], [0.4, 0.05], [0.6, 0.02], [1, 0]],
  throw2: [[0, 0], [0.4, -0.08], [0.62, 0.12], [1, 0]],
  throw3: [[0, 0], [0.4, -0.3], [0.6, 0.3], [1, 0]],
  leap1: [[0, 0], [0.26, 0.2], [0.4, -0.03], [1, 0.05]],
  leap2: [[0, 0], [0.26, -0.03], [0.42, 0.1], [1, 0]],
  land1: [[0, 0.22], [0.25, 0.26], [1, 0]],
  roar1: [[0, 0], [0.18, 0.08], [0.34, 0.015], [0.8, 0.03], [1, 0]],
  roar2: [[0, 0], [0.18, -0.04], [0.34, 0.03], [1, 0]],
  stagger1: [[0, 0], [0.25, 0.09], [0.7, 0.05], [1, 0]],
  stagger2: [[0, 0], [0.25, -0.1], [0.7, -0.04], [1, 0]],
  stagger3: [[0, 0], [0.3, 0.05], [0.7, -0.03], [1, 0]],
  block1: [[0, 0], [0.25, 0.05], [1, 0.05]],
  deathStumble1: [[0, 0], [0.5, 0.08], [1, 0.26]],
  attackMelee4: [[0, 0], [0.32, -0.6], [0.52, 0.8], [1, 0]],
  attackMelee5: [[0, 0], [0.3, -0.12], [0.5, 0.38], [1, 0]],
  attackHeavy3: [[0, 0], [0.42, -0.5], [0.58, 0.85], [0.75, 0.75], [1, 0]],
  attackHeavy4: [[0, 0], [0.42, -0.3], [0.58, 0.2], [1, 0]],
  throw4: [[0, 0], [0.4, -0.7], [0.58, 0.7], [1, 0]],
  throw5: [[0, 0], [0.4, -0.25], [0.6, 0.35], [1, 0]],
  leap3: [[0, 0], [0.25, 0.65], [0.4, -0.25], [1, 0.1]],
  land2: [[0, 0.5], [0.3, 0.7], [1, 0]],
  roar3: [[0, 0], [0.18, 0.3], [0.32, -0.42], [0.8, -0.38], [1, 0]],
  roar4: [[0, 0], [0.18, 0.2], [0.32, -0.6], [0.8, -0.5], [1, 0]],
  stagger4: [[0, 0], [0.2, -0.5], [0.6, 0.25], [1, 0]],
  stagger5: [[0, 0], [0.25, 0.3], [0.6, -0.2], [1, 0]],
  deathStumble2: [[0, 0], [0.5, 0.3], [1, 0.8]],
  attackMelee6: [[0, 0], [0.16, 1], [0.8, 1], [1, 0]],
  attackMelee7: [[0, 0.1], [0.32, 0.24], [0.52, -0.2], [0.8, -0.3], [1, 0.1]],
  attackMelee8: [[0, -0.2], [0.32, 0.26], [0.52, -0.06], [0.8, -0.3], [1, -0.4]],
  attackMelee9: [[0, 0.1], [0.32, -0.12], [0.52, 0.56], [0.8, 0.42], [1, 0.1]],
  attackHeavy5: [[0, 0], [0.2, 1], [0.85, 1], [1, 0]],
  attackHeavy6: [[0, 0], [0.42, 0.62], [0.58, -0.08], [0.75, -0.3], [1, -0.3]],
  attackHeavy7: [[0, 0.1], [0.42, 0.04], [0.58, 0.48], [0.75, 0.42], [1, 0.1]],
  throw6: [[0, 0], [0.3, 1], [0.8, 1], [1, 0]],
  throw7: [[0, 0], [0.2, 1], [0.8, 1], [1, 0]],
  throw8: [[0, 0], [0.4, 0.42], [0.6, 0.2], [1, -0.3]],
  throw9: [[0, 0.1], [0.4, -0.26], [0.6, 0.6], [1, 0.2]],
  leap4: [[0, -0.4], [0.25, -0.4], [0.42, 0.34], [1, 0.05]],
  leap5: [[0, 0], [0.25, -0.34], [0.42, 0.44], [1, 0.34]],
  leap6: [[0, 0], [0.15, 1], [1, 1]],
  land3: [[0, -0.28], [0.4, -0.38], [1, -0.46]],
  land4: [[0, 1], [0.6, 1], [1, 0]],
  roar5: [[0, 0.16], [0.32, 0.3], [1, 0.16]],
  roar6: [[0, -0.42], [0.32, -0.26], [0.8, -0.3], [1, -0.42]],
  roar7: [[0, 0.1], [0.18, 0.2], [0.32, -0.16], [0.8, -0.12], [1, 0.1]],
  roar8: [[0, 0], [0.2, 1], [0.8, 1], [1, 0]],
  stagger6: [[0, -0.3], [0.2, -0.12], [1, -0.36]],
  stagger7: [[0, 0.1], [0.3, 0.24], [1, 0.1]],
  stagger8: [[0, 0], [0.15, 1], [0.7, 1], [1, 0]],
  block2: [[0, 0], [0.2, 1], [1, 1]],
  deathStumble3: [[0, 0], [0.2, 1], [0.8, 0.8], [1, 0.2]],
} as const satisfies Record<string, Curve>;

const PITCH_STILL: Curve = [[0, 0], [0.55, 0.25], [0.9, 0], [1, -0.05]];
const PITCH_STRIDE: Curve = [[0, 0.75], [0.55, 0.25], [0.9, -0.28], [1, -0.05]];

interface ActionState {
  kind: AnimAction;
  t: number;
  duration: number;
  flip: number;
}

const DURATION: Record<AnimAction, number> = {
  attackMelee: 0.55, attackHeavy: 1.15, shoot: 0.16, throw: 0.8, leap: 0.7, land: 0.5, roar: 1.5, stagger: 0.8, block: 0.5, deathStumble: 1.2,
};

export class HumanoidAnimator implements CharacterAnimation {
  /** Called on every foot plant, with its strength: 0.2 for a walk, 1 for a sprint or a heavy body. */
  onFootstep: ((x: number, y: number, z: number, strength: number) => void) | null = null;
  /** Feet advance from the input speed instead of the root's motion. For stationary previews. */
  treadmill = false;
  /** Ground height sampler. NaN or null means use the root's height. */
  groundAt: ((x: number, y: number, z: number) => number) | null = null;

  private readonly style: MoveStyle;
  private readonly L: number;
  private readonly legLength: number;
  private readonly hipY: number;
  private readonly ankleY: number;
  private readonly weight: number;

  private readonly feet: Foot[];
  private readonly hands: Hand[];
  private readonly limbL: Limb | null;
  private readonly limbR: Limb | null;

  private speedIn = 0;
  private moveX = 0;
  private moveZ = 1;
  private aimYaw = 0;
  private aimPitch = 0;
  private airborne = false;

  private readonly frame = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly lastRoot = new THREE.Vector3();
  private needsHome = true;
  private lastYaw = 0;
  private yawRate = 0;
  private speed = 0;
  private phase = 0;
  private stride = 0;
  private runBlend = 0;
  private moveBlend = 0;
  private fwdAccel = 0;
  private lastFwd = 0;
  private leanFwd = 0;
  private leanSide = 0;
  private time = Math.random() * 100;
  private readonly seed = Math.random() * 100;
  private acc = 0;
  private tickCount = Math.floor(Math.random() * 4);
  /** Level of detail of the last real update, which a probe poses at. */
  private lastLod = 0;

  private action: ActionState | null = null;
  private readonly actionSlot: ActionState = { kind: 'attackMelee', t: 0, duration: 1, flip: 1 };
  private meleeFlip = 1;
  private blockHold = 0;
  private stepAside = 0;
  private plan: Plan = 'biped';
  private planBlend = 0;
  /**
   * How far into a hop the body has got. All at once the hips jump 9 cm the moment a leg goes, and in the one frame gore
   * samples an animation to seed a ragdoll that reads as 8 m/s sideways: limb and body thrown in opposite directions.
   */
  private hopBlend = 0;
  private severedCount = -1;
  private headGone = false;
  private armGoneL = false;
  private armGoneR = false;
  private crawlPhase = 0;
  private hopHeight = 0;

  /** Seconds of catch steps left. */
  private reel = 0;
  /**
   * What a hit asks of the arms and the knee, and how far they have got. A stumble must never move a joint in one frame:
   * it pops, and if the same burst kills, gore reads the jump as speed and the body leaves at 14 m/s.
   */
  private flail = 0;
  private flailW = 0;
  private buckle = 0;
  private buckleW = 0;
  private buckleSide = 1;
  private guardFor = 0;
  private guardW = 0;
  private dazeFor = 0;
  private dazeW = 0;
  private clutchBone = -1;
  private clutchFor = 0;
  private clutchW = 0;
  private clutchHand: 1 | -1 = 1;
  /** Seconds before a hold that was asked for with a delay begins: the flinch first, then the hand. */
  private clutchIn = 0;
  /** How hurt the body carries itself, 0..1, where that is heading, and the same for a limp, signed: + is the left leg. */
  private hurt = 0;
  private hurtW = 0;
  private limp = 0;
  private limpW = 0;
  /** Seconds until a hurt body's hand next goes back to its wound. */
  private guardWait = 0;
  /** A wound below the reach of a hand on a straight back, so the body has to bend to it. */
  private clutchLow = false;
  private readonly clutchAt = new THREE.Vector3();
  private clipKind: GetUpKind | null = null;
  private clipU = 0;
  private clipSeconds = 1;
  private clipHurt = 0;
  /** Which side leads. Mirrored at random, so a crowd does not all get up the same way. */
  private clipFlip = 1;
  /** The pose a body came back from physics in, and how much of it is left to blend out. */
  private readonly snapQ: THREE.Quaternion[];
  private readonly snapHips = new THREE.Vector3();
  private snapLeft = 0;
  private snapSeconds = 1;
  private readonly restQ: THREE.Quaternion[];
  private readonly restHips = new THREE.Vector3();

  private grip: WeaponGrip | null = null;
  private shieldRot: THREE.Quaternion | null = null;
  private readonly posture = new Postures();
  /** What `disarm` took out of his hands, for the next body the pool makes of him. */
  private droppedGrip: WeaponGrip | null = null;
  private droppedShield: THREE.Quaternion | null = null;
  private readonly spine = new Spring3(FlinchSprings.spine[0]!, FlinchSprings.spine[1]!);
  private readonly chest = new Spring3(FlinchSprings.chest[0]!, FlinchSprings.chest[1]!);
  private readonly head = new Spring3(FlinchSprings.head[0]!, FlinchSprings.head[1]!);
  private readonly pelvis = new Spring3(FlinchSprings.pelvis[0]!, FlinchSprings.pelvis[1]!);
  private readonly armLS = new Spring3(150, 11);
  private readonly armRS = new Spring3(150, 11);
  private readonly recoil = new Spring3(420, 26);
  private readonly landing = new Spring3(120, 13);
  /**
   * What a hit rides on (`HitShape`): the trunk's pitch, twist and roll; the head's; the hips' shift in body heights; and for
   * each arm (left, right) the upper arm's swing, and behind it on a slower spring the fold of the elbow and wrist.
   */
  private readonly hitTrunk = new HitSpring(17, 8.5, 0.65);
  private readonly hitHead = new HitSpring(20, 10, 0.6);
  private readonly hitHips = new HitSpring(14, 7, 0.7);
  private readonly hitArm = [new HitSpring(15, 7, 0.55), new HitSpring(15, 7, 0.55)];
  private readonly hitFore = [new HitSpring(10, 5.5, 0.6), new HitSpring(10, 5.5, 0.6)];
  /** The parts of the body a hit has put on physics (`sway.ts`), made the first time one is asked for. */
  private swayRig: Sway | null = null;
  /** Which side the last round down the middle went to. */
  private hitSide = 1;
  private hitSideAt = -1;
  /** Seconds until a hit may ask for another catch step. */
  private hitStep = 0;
  private readonly shoulderX: number;

  private readonly pelvisPos = new THREE.Vector3();
  private readonly pelvisQ = new THREE.Quaternion();
  private readonly chestQ = new THREE.Quaternion();
  private readonly chestPos = new THREE.Vector3();
  private readonly weaponPos = new THREE.Vector3();
  private readonly weaponQ = new THREE.Quaternion();

  constructor(
    private readonly bones: readonly THREE.Bone[],
    private readonly rig: RigDef,
    def: ArchetypeDef,
    private readonly root: THREE.Object3D,
    private readonly severed: ReadonlySet<GoreRegion>,
    private readonly hidden: (bone: number) => boolean,
  ) {
    this.style = STYLES[def.id] ?? STYLES.trooper!;
    this.stance = def.stance;
    this.L = rig.height;
    this.weight = def.weight;
    this.hipY = bones[H.hips]!.position.y;
    this.ankleY = bindAnkle(bones);
    this.legLength = bones[H.shinL]!.position.length() + bones[H.footL]!.position.length();
    this.shoulderX = Math.max(Math.abs(bones[H.upperArmL]!.position.x), 0.05);
    const leg = (side: 1 | -1, t: number, s: number, f: number, phaseOffset: number): Foot => ({
      planted: true, pos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), yaw: 0, fromYaw: 0, t: 1, dur: 0.3, pitch: 0,
      side, limb: new Limb(bones[t]!, bones[s]!, bones[f]!, new THREE.Vector3(0, 0, 1)), hipOffset: bones[t]!.position.clone(), phaseOffset, lastPsi: phaseOffset, ground: 0, roll: 0,
    });
    this.feet = [leg(1, H.thighL, H.shinL, H.footL, 0), leg(-1, H.thighR, H.shinR, H.footR, 0.5)];
    const arm = (side: 1 | -1, u: number, f: number, h: number): Hand => ({
      limb: new Limb(bones[u]!, bones[f]!, bones[h]!, new THREE.Vector3(side * 0.3, 0, -1)), shoulderOffset: bones[u]!.position.clone(), side,
      target: new THREE.Vector3(), pole: new THREE.Vector3(), planted: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, swinging: false,
    });
    this.hands = [arm(1, H.upperArmL, H.foreArmL, H.handL), arm(-1, H.upperArmR, H.foreArmR, H.handR)];
    this.limbL = this.feet[0]!.limb;
    this.limbR = this.feet[1]!.limb;
    this.snapQ = bones.map(() => new THREE.Quaternion());
    this.restQ = bones.map(() => new THREE.Quaternion());
  }

  private stance: ArchetypeDef['stance'];

  /** How the weapon is held, for a body that carries different kit per wearer (`CharacterLibrary.arm`). */
  setStance(stance: ArchetypeDef['stance']): void {
    this.stance = stance;
  }

  setGrip(grip: WeaponGrip | null): void {
    this.grip = grip;
  }

  /** Socket rotation of a shield held in the left hand. */
  setShield(rot: THREE.Quaternion | null): void {
    this.shieldRot = rot;
  }

  /** See postures.ts. */
  setPosture(name: PostureName): void {
    const prone = this.posture.prone;
    this.posture.set(name);
    // On the floor he is a crawler with his legs along for the ride, however many he has.
    if (prone !== this.posture.prone) this.severedCount = -1;
  }

  /** Staying on the floor. Gore reads this to know that what it hands back is not getting up. */
  get prone(): boolean {
    return this.posture.prone;
  }

  /** Empty hands: the weapon is on the floor. They stay empty until he picks it back up or the pool resets him. */
  disarm(): void {
    this.droppedGrip ??= this.grip;
    this.droppedShield ??= this.shieldRot;
    this.grip = null;
    this.shieldRot = null;
  }

  rearm(): void {
    this.grip = this.droppedGrip ?? this.grip;
    this.droppedGrip = null;
  }

  setLocomotion(input: LocomotionInput): void {
    this.speedIn = input.speed;
    this.moveX = input.moveX;
    this.moveZ = input.moveZ;
    this.aimYaw = input.aimYaw;
    this.aimPitch = input.aimPitch;
    this.airborne = input.grounded === false;
  }

  play(action: AnimAction, speed = 1): number {
    if (action === 'shoot') {
      this.recoil.kick(0, 0, -2.4 / Math.max(0.6, this.weight * 1.6 + 0.6));
      this.chest.kick(-1.1, 0, 0);
      return DURATION.shoot / speed;
    }
    if (action === 'land') this.landing.kick(0, -2.6 - this.weight * 2, 0);
    if (action === 'block') this.blockHold = 1;
    const duration = DURATION[action] / speed;
    if (action === 'attackMelee') this.meleeFlip = -this.meleeFlip;
    const slot = this.actionSlot;
    slot.kind = action;
    slot.t = 0;
    slot.duration = duration;
    slot.flip = this.meleeFlip;
    this.action = slot;
    // Standing strikes commit a foot. The idle logic walks it home afterwards.
    if (action === 'attackMelee' || action === 'attackHeavy' || action === 'throw') this.stepAside = 0.3;
    else if (action === 'stagger') this.stepAside = -0.26;
    return duration;
  }

  flinch(bone: number, worldDir: THREE.Vector3, magnitude: number, worldPoint?: THREE.Vector3): void {
    // Into character space: the root only ever rotates about Y.
    const yaw = this.root.rotation.y;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const dx = worldDir.x * c - worldDir.z * s;
    const dz = worldDir.x * s + worldDir.z * c;
    const dy = worldDir.y;
    const m = magnitude * (1.4 - this.weight * 0.9);
    const name = this.rig.bones[bone]?.region ?? 'chest';
    if (DevFlags.flinch) {
      // Where across the body it landed, in shoulder widths: his left is +X.
      const across = worldPoint ? ((worldPoint.x - this.root.position.x) * c - (worldPoint.z - this.root.position.z) * s) / this.shoulderX : 0;
      this.takeHit(name, dx, dz, m, across);
      return;
    }
    // Lean away from the hit: a push along +Z pitches forward, along +X rolls toward -Z axis.
    const px = dz * 5, pz = -dx * 5;
    let wSpine = 0.6, wChest = 1, wHead = 0.6, wPelvis = 0.4;
    if (name === 'head') { wSpine = 0.1; wChest = 0.3; wHead = 2.6; wPelvis = 0.05; }
    else if (name === 'abdomen') { wSpine = 1.4; wChest = 0.5; wPelvis = 1; }
    else if (name.startsWith('leg') || name.startsWith('shin')) { wSpine = 0.3; wChest = 0.2; wHead = 0.2; wPelvis = 1.3; this.landing.kick(0, -1.5 * m, 0); }
    else if (name.startsWith('arm') || name.startsWith('forearm')) { wSpine = 0.1; wChest = 0.4; wHead = 0.1; wPelvis = 0.05; }
    this.spine.kick(px * m * wSpine, -dx * m * wSpine, pz * m * wSpine);
    this.chest.kick(px * m * wChest, -dx * m * wChest * 1.2, pz * m * wChest);
    this.head.kick(px * m * wHead, -dx * m * wHead * 1.5, pz * m * wHead);
    this.pelvis.kick(dx * m * wPelvis * 0.5, dy * m * wPelvis * 0.3, dz * m * wPelvis * 0.5);
    if (name.endsWith('L') && (name.startsWith('arm') || name.startsWith('forearm'))) this.armLS.kick(dx * m * 4, 0, dz * m * 4);
    if (name.endsWith('R') && (name.startsWith('arm') || name.startsWith('forearm'))) this.armRS.kick(dx * m * 4, 0, dz * m * 4);
  }

  /**
   * One hit, on the springs (`HitShape`). `dx`, `dz` are the round's direction in the body's own axes (his left is +X, his
   * front +Z), `m` its size for this build, `across` where it landed across him in shoulder widths. Nothing here moves a bone
   * on this frame: every part is a kick to a spring, or the knee's ease, because gore reads a jump as speed if the same burst
   * kills (gore.md, "Nothing a hit does to the animation may land in one frame").
   */
  private takeHit(name: string, dx: number, dz: number, m: number, across: number): void {
    const S = HitShape;
    const arm = name.startsWith('arm') || name.startsWith('forearm');
    const leg = name.startsWith('leg') || name.startsWith('shin');
    let side = arm || leg ? (name.endsWith('L') ? 1 : -1) : clamp(across, -1, 1);
    // Down the middle there is no shoulder to turn, so it goes to one side and then the other: held fire rocks a body. The
    // pellets of one shell land on one frame and go the same way, or they would cancel.
    if (Math.abs(side) < S.centre) {
      if (this.time !== this.hitSideAt) this.hitSide = -this.hitSide;
      this.hitSideAt = this.time;
      side = this.hitSide * S.centre;
    }
    // The struck shoulder goes with the round: back from a shot in front, forward from one behind. A shot from the side
    // turns nothing and leans the body away.
    const turn = -dz * side;
    let lean = dz * S.lean, twist = turn * S.twist, roll = -side * S.drop - dx * S.lean;
    let back = dz * S.hipBack, shift = -side * S.hipSide + dx * S.hipBack, sink = S.hipSink;
    if (name === 'head') {
      lean *= 0.3; twist *= 0.3; roll *= 0.3; back *= 0.3; shift *= 0.3; sink *= 0.3;
      this.hitHead.hit(dz * S.headSnap * m, turn * S.headTurn * m, (-side * S.headTilt - dx * S.headSnap) * m, S.headMax);
    } else {
      if (name === 'abdomen') { lean = S.fold; twist *= 0.5; roll *= 0.6; back *= 1.8; sink *= 2; }
      else if (arm) { lean *= 0.35; twist *= 0.8; roll *= 0.6; back *= 0.4; shift *= 0.5; sink *= 0.4; }
      else if (leg) { lean = S.legFold; twist *= 0.3; roll = -side * S.legLean; back *= 0.6; shift = side * S.legShift; sink = 0; }
      // The head would hold level over a dropped shoulder (`poseUpperBody` counters the trunk): it goes part of the way with it.
      this.hitHead.hit(0, 0, roll * S.headFollow * m, S.headMax);
    }
    this.hitTrunk.hit(lean * m, twist * m, roll * m, S.trunkMax);
    this.hitHips.hit(shift * m, -sink * m, back * m, S.hipsMax);

    if (leg && this.plan === 'biped') {
      const to = side > 0 ? 1 : -1;
      // The other knee is still giving: it has to come back first, or the hips would roll across in one frame.
      if (to === this.buckleSide || this.buckleW <= 0.05) {
        this.buckleSide = to;
        this.buckle = Math.max(this.buckle, clamp(S.knee * m, 0, S.kneeMax));
      }
      return;
    }
    if (leg) return;
    // A hard enough round to the trunk of a body standing still: the foot on that side steps back to catch it.
    if (!arm && name !== 'head' && m >= S.stepFrom && this.hitStep <= 0 && this.plan === 'biped' && this.moveBlend < 0.3 && this.stepAside === 0 && !this.action) {
      this.hitStep = S.stepGap;
      this.meleeFlip = side > 0 ? -1 : 1;
      this.stepAside = (dz > 0 ? 1 : -1) * S.step;
    }
    // Arms: the struck one thrown back along the shot and out, the elbow folding behind it; on a chest hit the arm on that
    // side goes with its shoulder. A hand on a gun is thrown less, and the hand on its foregrip goes with it.
    const armed = this.grip !== null && !this.armGoneR;
    for (let i = 0; i < 2; i++) {
      const own = i === 0 ? 1 : -1;
      let share = arm ? (own === side ? 1 : 0) : name === 'head' ? 0 : own * side > 0 ? S.armFollow * Math.abs(side) : S.armOther;
      if (armed && i === 1) share *= S.gunArm;
      if (arm && armed && i === 0 && side < 0 && this.grip!.foregrip) share = S.gunArm * S.gunFollow;
      if (share <= 0) continue;
      const swing = -dz * S.armSwing * share * m, out = (own * S.armOut - dx * S.armSwing) * share * m;
      this.hitArm[i]!.hit(swing, 0, out, S.armMax);
      this.hitFore[i]!.hit(Math.hypot(swing, out), 0, 0, S.armMax);
    }
  }

  sway(part: SwayPart, worldDir: THREE.Vector3, magnitude: number, bone: number): void {
    this.swayRig ??= new Sway(this.bones, this.root, this.hidden);
    // By build, as a flinch is.
    this.swayRig.hit(part, worldDir, magnitude * (1.4 - this.weight * 0.9), bone, this.grip !== null && !this.armGoneR);
  }

  get swaying(): boolean {
    return this.swayRig?.live === true;
  }

  /** How much of the body is on physics, 0..1. */
  get swayWeight(): number {
    return this.swayRig?.live ? this.swayRig.weight : 0;
  }

  easeSway(seconds: number): void {
    this.swayRig?.ease(seconds);
  }

  stumble(worldDir: THREE.Vector3, strength: number, bone: number): void {
    const s = clamp(strength);
    this.reel = Math.max(this.reel, REEL.seconds * (0.45 + s * 0.55));
    this.flail = Math.max(this.flail, s);
    this.stepAside = 0;
    const region = this.rig.bones[bone]?.region ?? 'chest';
    if (region.startsWith('leg') || region.startsWith('shin')) {
      this.buckle = Math.max(this.buckle, 0.35 + s * 0.65);
      this.buckleSide = region.endsWith('L') ? 1 : -1;
    }
    // Already walking, its feet are on their way. Jumping the gait would jump every limb that follows it.
    if (this.plan !== 'biped' || this.moveBlend > 0.3) return;
    // The foot that lets the body fall past it is the one that has to move, so it goes first and at once.
    const yaw = this.root.rotation.y;
    const side = worldDir.x * Math.cos(yaw) - worldDir.z * Math.sin(yaw);
    const catcher = this.buckle > 0.05 ? (this.buckleSide > 0 ? 1 : 0) : side >= 0 ? 0 : 1;
    const f = this.feet[catcher]!;
    const duty = lerp(0.62, 0.27, this.runBlend);
    this.phase = (duty - 0.01 - f.phaseOffset + 2) % 1;
    for (const g of this.feet) g.lastPsi = (this.phase + g.phaseOffset) % 1;
  }

  buckleLeg(side: number, amount: number): void {
    const to = side > 0 ? 1 : -1;
    // The other knee is still giving: it has to come back first, or the hips would roll across in one frame.
    if (to !== this.buckleSide && this.buckleW > 0.05) return;
    this.buckleSide = to;
    this.buckle = Math.max(this.buckle, clamp(amount));
  }

  holdWound(bone: number, worldPoint: THREE.Vector3, seconds: number, delay = 0): void {
    if (this.hidden(bone)) return;
    // A hand already on a wound goes straight to the new one. Otherwise it waits out the flinch.
    this.clutchIn = this.clutchFor > 0 ? 0 : delay;
    const b = this.bones[bone]!;
    b.updateWorldMatrix(true, false);
    this.clutchAt.copy(worldPoint);
    b.worldToLocal(this.clutchAt);
    this.clutchBone = bone;
    this.clutchFor = seconds;
    const region = this.rig.bones[bone]?.region ?? 'chest';
    this.clutchLow = region.startsWith('leg') || region.startsWith('shin');
    // Never the hand on the arm that was hit, and with a gun in the right hand the left is the one that is free.
    let hand: 1 | -1 = this.clutchAt.x >= 0 ? 1 : -1;
    if (region.endsWith('L') && (region.startsWith('arm') || region.startsWith('forearm'))) hand = -1;
    else if (region.endsWith('R') && (region.startsWith('arm') || region.startsWith('forearm'))) hand = 1;
    else if (this.grip) hand = 1;
    if (hand > 0 ? this.armGoneL : this.armGoneR) hand = hand > 0 ? -1 : 1;
    this.clutchHand = hand;
  }

  guard(seconds: number): void {
    this.guardFor = Math.max(this.guardFor, seconds);
  }

  setHurt(hurt: number, limp: number): void {
    this.hurt = clamp(hurt);
    this.limp = clamp(limp, -1, 1);
  }

  daze(seconds: number): void {
    this.dazeFor = Math.max(this.dazeFor, seconds);
  }

  /** The ragdoll's pose, kept so it can be blended out. Bones hold it right now. */
  private matchPose(seconds: number): void {
    const bones = this.bones;
    for (let i = 0; i < bones.length; i++) this.snapQ[i]!.copy(bones[i]!.quaternion);
    this.snapHips.copy(bones[H.hips]!.position);
    this.snapLeft = this.snapSeconds = seconds;
  }

  private clearHitState(): void {
    this.hitTrunk.clear();
    this.hitHead.clear();
    this.hitHips.clear();
    this.hitStep = 0;
    this.swayRig?.stop();
    for (let i = 0; i < 2; i++) {
      this.hitArm[i]!.clear();
      this.hitFore[i]!.clear();
    }
  }

  blendFrom(seconds: number): void {
    this.reel = this.flail = this.flailW = this.buckle = this.buckleW = 0;
    this.action = null;
    this.stepAside = 0;
    this.needsHome = true;
    this.moveBlend = this.runBlend = 0;
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.clearHitState();
    this.matchPose(seconds);
  }

  getUp(kind: GetUpKind, seconds: number, hurt: number, startU = 0): number {
    this.refreshPlan();
    this.reel = this.flail = this.flailW = this.buckle = this.buckleW = 0;
    this.action = null;
    this.stepAside = 0;
    this.needsHome = true;
    this.moveBlend = this.runBlend = 0;
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.clearHitState();
    if (this.plan === 'crawl' || this.plan === 'writhe' || kind === 'crawl') {
      this.planBlend = 1;
      this.clipKind = null;
      this.matchPose(POSE_MATCH_CRAWL);
      return 0;
    }
    this.planBlend = 0;
    this.clipKind = kind;
    // Pushed part of the way up already (gore's struggle), it plays the rest over `seconds`, from a pose it is already close to.
    this.clipU = clamp(startU, 0, 0.9);
    const rest = 1 - this.clipU;
    this.clipSeconds = Math.max(seconds, 0.4 * rest) / rest;
    this.clipHurt = clamp(hurt);
    this.matchPose(this.clipU > 0 ? POSE_MATCH_PART : POSE_MATCH);
    return this.clipSeconds * rest;
  }

  poseGetUpStart(kind: GetUpKind, hips: THREE.Vector3): void {
    this.poseGetUpAt(kind, 0, hips);
  }

  poseGetUpAt(kind: GetUpKind, u: number, hips: THREE.Vector3, flip?: number): void {
    this.refreshPlan();
    this.clipFlip = flip ?? (Math.random() < 0.5 ? 1 : -1);
    this.poseClip(kind, clamp(u), this.clipFlip, 0);
    hips.copy(this.pelvisPos);
  }

  /** Forget planted feet. Happens by itself on a large jump in root position. */
  resetFeet(): void {
    this.needsHome = true;
  }

  private rehome(): void {
    this.needsHome = false;
    this.frame.copy(this.root.position);
    const yaw = this.root.rotation.y;
    for (const f of this.feet) {
      this.homeFoot(f, vA);
      f.pos.copy(vA);
      f.yaw = yaw;
      f.planted = true;
      f.t = 1;
      f.roll = 0;
      f.ground = this.root.position.y;
    }
    this.lastRoot.copy(this.root.position);
    this.lastYaw = yaw;
    this.vel.set(0, 0, 0);
  }

  /** Back to a whole body, for reuse from the pool. */
  reset(): void {
    this.feet[0]!.limb = this.limbL;
    this.feet[1]!.limb = this.limbR;
    this.plan = 'biped';
    this.planBlend = this.hopBlend = 0;
    this.severedCount = -1;
    this.headGone = this.armGoneL = this.armGoneR = false;
    this.action = null;
    this.blockHold = 0;
    this.stepAside = 0;
    this.moveBlend = this.runBlend = 0;
    this.leanFwd = this.leanSide = 0;
    this.fwdAccel = this.lastFwd = 0;
    this.speed = 0;
    this.stride = 0;
    this.spine.clear(); this.chest.clear(); this.head.clear(); this.pelvis.clear();
    this.armLS.clear(); this.armRS.clear(); this.recoil.clear(); this.landing.clear();
    this.hitTrunk.clear(); this.hitHead.clear(); this.hitHips.clear();
    this.hitStep = 0;
    this.swayRig?.stop();
    for (let i = 0; i < 2; i++) { this.hitArm[i]!.clear(); this.hitFore[i]!.clear(); }
    this.hands[0]!.planted.set(0, 0, 0);
    this.hands[1]!.planted.set(0, 0, 0);
    this.reel = this.flail = this.flailW = this.buckle = this.buckleW = 0;
    this.guardFor = this.guardW = this.dazeFor = this.dazeW = 0;
    this.clutchBone = -1;
    this.clutchFor = this.clutchW = this.clutchIn = 0;
    this.hurt = this.hurtW = this.limp = this.limpW = this.guardWait = 0;
    this.clipKind = null;
    this.snapLeft = 0;
    this.posture.reset();
    this.grip = this.droppedGrip ?? this.grip;
    this.shieldRot = this.droppedShield ?? this.shieldRot;
    this.droppedGrip = this.droppedShield = null;
    this.acc = 0;
    this.lastLod = 0;
    this.needsHome = true;
  }

  private homeFoot(f: Foot, out: THREE.Vector3): void {
    const yaw = this.root.rotation.y;
    const w = f.hipOffset.x * (1 + (this.style.stance - 1) * 0.6) * 1.15;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    out.set(this.frame.x + w * c, this.frame.y + this.ankleY, this.frame.z - w * s);
  }

  private groundHeight(x: number, y: number, z: number): number {
    const g = this.groundAt?.(x, y + 1, z);
    return g === undefined || g === null || Number.isNaN(g) ? y : g;
  }

  private refreshPlan(): void {
    if (this.severed.size === this.severedCount) return;
    this.severedCount = this.severed.size;
    const legL = this.hidden(H.thighL) || this.hidden(H.shinL);
    const legR = this.hidden(H.thighR) || this.hidden(H.shinR);
    this.armGoneL = this.hidden(H.upperArmL) || this.hidden(H.foreArmL);
    this.armGoneR = this.hidden(H.upperArmR) || this.hidden(H.foreArmR);
    this.headGone = this.hidden(H.neck) || this.hidden(H.head);
    const armless = this.armGoneL && this.armGoneR;
    this.plan = (legL && legR) || this.posture.prone ? (armless ? 'writhe' : 'crawl') : legL || legR ? 'hop' : 'biped';
    this.feet[0]!.limb = this.hidden(H.thighL) || this.hidden(H.shinL) ? null : this.feet[0]!.limb;
    this.feet[1]!.limb = this.hidden(H.thighR) || this.hidden(H.shinR) ? null : this.feet[1]!.limb;
    if (this.hidden(H.spine)) this.plan = 'biped';
  }

  /**
   * `probing` is gore stepping ahead to read how fast the body is moving. A limb gone a moment ago is not movement, so the plan
   * waits for the next real frame: read across a change of plan, a few centimetres over 1/90 s seed a ragdoll at 12 m/s.
   * A probe steps exactly its own `dt`, at the level of detail the pose it is compared with was drawn at, and gore calls
   * `catchUp` first. Stepping a far body's saved frames inside the probe, posing its feet and arms in full, and reading the
   * stale pose of a body whose root had moved on, it seeded bodies at LOD 1 and 2 up to 1.7 times too fast.
   */
  update(dt: number, lod: number, probing = false): void {
    if (probing) {
      const lx = this.lastRoot.x, ly = this.lastRoot.y, lz = this.lastRoot.z;
      const fx = this.frame.x, fy = this.frame.y, fz = this.frame.z;
      const vx = this.vel.x, vy = this.vel.y, vz = this.vel.z;
      const lyaw = this.lastYaw, yrate = this.yawRate, lfwd = this.lastFwd, facc = this.fwdAccel;
      const lnf = this.leanFwd, lns = this.leanSide, spd = this.speed, tm = this.time;
      const onFoot = this.onFootstep;
      this.onFootstep = null;
      try {
        this.advance(dt, this.lastLod >= 3 ? 2 : this.lastLod, true);
      } finally {
        this.onFootstep = onFoot;
        this.lastRoot.set(lx, ly, lz);
        this.frame.set(fx, fy, fz);
        this.vel.set(vx, vy, vz);
        this.lastYaw = lyaw;
        this.yawRate = yrate;
        this.lastFwd = lfwd;
        this.fwdAccel = facc;
        this.leanFwd = lnf;
        this.leanSide = lns;
        this.speed = spd;
        this.time = tm;
      }
      return;
    }
    if (lod >= 3) {
      this.lastLod = lod;
      if (dt > 0) {
        const hadClip = this.clipKind !== null || this.snapLeft > 0;
        if (this.clipKind) {
          this.clipU = Math.min(1, this.clipU + dt / this.clipSeconds);
          if (this.clipU >= 1) this.clipKind = null;
        }
        if (this.snapLeft > 0) this.snapLeft = Math.max(0, this.snapLeft - dt);
        if (hadClip && this.clipKind === null && this.snapLeft <= 0) {
          this.acc = 0;
          this.needsHome = true;
          this.advance(Math.min(dt, 0.05), 2, false);
          return;
        }
      }
      this.acc = Math.min(this.acc + dt, 1.0);
      return;
    }
    const woke = this.lastLod >= 3;
    this.lastLod = lod;
    this.acc += dt;
    const every = lod <= 0 ? 1 : lod === 1 ? 2 : 4;
    if (!woke && ++this.tickCount % every !== 0) return;
    const step = this.acc;
    this.acc = 0;
    if (woke && step > 0.25) this.needsHome = true;
    this.advance(woke ? Math.min(step, 0.25) : step, lod, false);
  }

  /**
   * Spends the frames a far body has saved up, so that its pose is the present one: a planted foot drawn under a root that
   * has since moved on reads as a foot moving at metres a second. Nothing to do at LOD 0.
   */
  catchUp(): void {
    if (this.acc <= 0) return;
    const step = this.acc;
    this.acc = 0;
    if (step > 0.25) this.needsHome = true;
    this.advance(Math.min(step, 0.25), this.lastLod >= 3 ? 2 : this.lastLod, false);
  }

  private advance(step: number, lod: number, probing: boolean): void {
    if (step <= 0) return;
    if (!probing) this.refreshPlan();
    this.time += step;
    this.integrateRoot(step);
    this.stepSprings(step);
    this.stepAction(step);
    this.posture.step(step);

    this.planBlend = damp(this.planBlend, this.plan === 'crawl' || this.plan === 'writhe' || this.posture.prone ? 1 : 0, 6, step);
    this.hopBlend = damp(this.hopBlend, this.plan === 'hop' ? 1 : 0, 7, step);

    if (this.plan === 'biped') this.stepGait(step, lod);
    else if (this.plan === 'hop') this.stepHop(step);
    else this.stepCrawl(step);

    this.poseBody();
    this.poseUpperBody(step, lod);
    this.poseLegs(lod);
    const rising = this.clipKind !== null || this.snapLeft > 0;
    if (this.clipKind) this.stepClip(step);
    if (this.snapLeft > 0) this.blendSnapshot(step);
    if (rising) this.keepAboveFloor();
    // A struck part on physics, over the pose just made. Only at full detail, and never over a get-up, which is keyed.
    const sway = this.swayRig;
    if (sway?.live) {
      if (lod === 0 && this.clipKind === null) sway.step(step);
      else sway.stop();
    }
  }

  private integrateRoot(dt: number): void {
    const r = this.root.position;
    const yaw = this.root.rotation.y;
    if (this.needsHome) this.rehome();
    const c = Math.cos(yaw), s = Math.sin(yaw);
    if (this.treadmill) {
      const wx = this.moveX * c + this.moveZ * s, wz = -this.moveX * s + this.moveZ * c;
      this.vel.set(wx * this.speedIn, 0, wz * this.speedIn);
      this.frame.addScaledVector(this.vel, dt);
    } else {
      vA.subVectors(r, this.lastRoot);
      if (vA.lengthSq() > 16) {
        this.rehome();
        return;
      }
      this.vel.x = damp(this.vel.x, vA.x / dt, 18, dt);
      this.vel.z = damp(this.vel.z, vA.z / dt, 18, dt);
      this.frame.copy(r);
    }
    this.lastRoot.copy(r);
    this.yawRate = damp(this.yawRate, wrap(yaw - this.lastYaw) / dt, 12, dt);
    this.lastYaw = yaw;
    this.speed = Math.hypot(this.vel.x, this.vel.z);

    const fwd = this.vel.x * s + this.vel.z * c;
    const side = this.vel.x * c - this.vel.z * s;
    this.fwdAccel = damp(this.fwdAccel, (fwd - this.lastFwd) / dt, 10, dt);
    this.lastFwd = fwd;
    // Reeling, the body runs ahead of its feet in whatever direction it was sent, so it leans that way hard.
    const reeling = clamp(this.reel * 3);
    const leanTarget = clamp(0.015 * fwd + this.fwdAccel * 0.02, -0.25, 0.55) * (1 - this.weight * 0.35)
      + clamp(fwd * REEL.lean, -REEL.leanMax, REEL.leanMax) * reeling;
    this.leanFwd = damp(this.leanFwd, leanTarget, 8, dt);
    const turn = clamp(-this.yawRate * this.speed * 0.022 + side * 0.012, -0.32, 0.32)
      + clamp(-side * REEL.lean, -REEL.leanMax, REEL.leanMax) * reeling;
    this.leanSide = damp(this.leanSide, turn, 8, dt);
  }

  private stepSprings(dt: number): void {
    this.spine.step(dt); this.chest.step(dt); this.head.step(dt); this.pelvis.step(dt);
    this.armLS.step(dt); this.armRS.step(dt); this.recoil.step(dt); this.landing.step(dt);
    this.hitTrunk.step(dt); this.hitHead.step(dt); this.hitHips.step(dt);
    for (let i = 0; i < 2; i++) { this.hitArm[i]!.step(dt); this.hitFore[i]!.step(dt); }
  }

  private stepAction(dt: number): void {
    const a = this.action;
    if (a) {
      a.t += dt / a.duration;
      if (a.t >= 1) this.action = null;
    }
    this.blockHold = Math.max(0, this.blockHold - dt * 1.5);
    this.hitStep = Math.max(0, this.hitStep - dt);
    this.reel = Math.max(0, this.reel - dt);
    this.flail *= Math.exp(-REEL.flailFade * dt);
    this.buckle *= Math.exp(-REEL.buckleFade * dt);
    this.flailW = damp(this.flailW, this.flail, REEL.takeUp, dt);
    this.buckleW = damp(this.buckleW, this.buckle, REEL.takeUp, dt);
    this.guardFor = Math.max(0, this.guardFor - dt);
    this.guardW = damp(this.guardW, this.guardFor > 0 ? 1 : 0, GUARD_RATE, dt);
    this.dazeFor = Math.max(0, this.dazeFor - dt);
    this.dazeW = damp(this.dazeW, this.dazeFor > 0 ? 1 : 0, 4, dt);
    if (this.clutchIn > 0) this.clutchIn -= dt;
    else this.clutchFor = Math.max(0, this.clutchFor - dt);
    this.clutchW = damp(this.clutchW, this.clutchFor > 0 && this.clutchIn <= 0 ? 1 : 0, CLUTCH_RATE, dt);
    this.hurtW = damp(this.hurtW, this.hurt, HurtShape.rate, dt);
    this.limpW = damp(this.limpW, this.limp, HurtShape.rate, dt);
    // Badly hurt, a hand keeps going back to the last wound.
    if (this.hurtW >= HurtShape.guardFrom && this.clutchBone >= 0 && this.clutchFor <= 0) {
      this.guardWait -= dt;
      if (this.guardWait <= 0) {
        this.clutchFor = HurtShape.guardFor;
        this.guardWait = HurtShape.guardFor + HurtShape.guardEvery * (0.6 + 0.8 * Math.abs(noise1(this.time * 0.37 + this.seed)));
      }
    }
  }

  private cycleTime(): number {
    // Longer legs swing slower, as a pendulum does.
    const scale = Math.sqrt(0.9 / this.legLength);
    const f = (0.82 + 0.17 * Math.min(this.speed, 12)) * scale * this.style.cadence;
    return 1 / (f * lerp(1, REEL.cadence, clamp(this.reel * 4)));
  }

  private stepGait(dt: number, lod: number): void {
    const moving = this.speed > 0.25 * Math.sqrt(this.L / 1.85);
    const norm = this.speed / Math.sqrt(9.8 * this.legLength);
    const run = clamp((norm - 0.65) / 0.5) * (1 - this.weight * 0.6);
    this.runBlend = damp(this.runBlend, run, 6, dt);
    this.moveBlend = damp(this.moveBlend, moving ? 1 : 0, 7, dt);
    const T = this.cycleTime();
    const duty = lerp(0.62, 0.27, this.runBlend);
    this.stride = this.speed * T;
    if (moving) this.phase = (this.phase + dt / T) % 1;

    if (this.airborne) {
      this.stepAirborne(dt);
      return;
    }
    if (this.stepAside !== 0 && !moving) {
      // The foot opposite the striking arm leads, which is how a body throws its weight.
      const lead = this.feet[this.meleeFlip > 0 ? 1 : 0]!;
      if (lead.planted) {
        const yaw = this.root.rotation.y;
        this.homeFoot(lead, vA);
        vA.x += Math.sin(yaw) * this.stepAside * this.L;
        vA.z += Math.cos(yaw) * this.stepAside * this.L;
        this.liftTo(lead, vA, 0.2 * Math.sqrt(this.L / 1.85), lod);
      }
      this.stepAside = 0;
    }
    for (const f of this.feet) {
      const psi = (this.phase + f.phaseOffset) % 1;
      if (moving) {
        // Crossing the stance fraction lifts the foot, however the phase got there.
        const crossed = f.lastPsi < duty && psi >= duty;
        if (f.planted && (crossed || (psi >= duty && psi - duty < 0.3 && this.footStretch(f) > 0.9))) {
          this.lift(f, (1 - duty) * T, duty, T, lod);
        }
      } else if (f.planted) {
        this.homeFoot(f, vA);
        const off = Math.hypot(vA.x - f.pos.x, vA.z - f.pos.z);
        const other = this.feet[f.side > 0 ? 1 : 0]!;
        const yawErr = Math.abs(wrap(this.root.rotation.y - f.yaw));
        const busy = this.action !== null && this.action.t < 0.8;
        if (!busy && other.planted && (off > this.L * 0.075 || yawErr > 0.5) && off >= this.homeOffset(other)) {
          this.liftTo(f, vA, 0.3 * Math.sqrt(this.L / 1.85) * (1 + this.weight * 0.6), lod);
        }
      }
      f.lastPsi = psi;
      this.stepFoot(f, dt, T, duty);
    }
  }

  /** Feet leave the ground plan entirely: tucked under the body, one leading, ready to catch the landing. */
  private stepAirborne(dt: number): void {
    const yaw = this.root.rotation.y;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    for (const f of this.feet) {
      this.homeFoot(f, vA);
      const lead = f.side * 0.1 * this.L;
      vA.x += fx * lead;
      vA.z += fz * lead;
      vA.y += (0.2 + f.side * 0.05) * this.L;
      f.pos.x = damp(f.pos.x, vA.x, 14, dt);
      f.pos.y = damp(f.pos.y, vA.y, 14, dt);
      f.pos.z = damp(f.pos.z, vA.z, 14, dt);
      f.yaw = yaw;
      f.pitch = 0.45;
      f.roll = 0;
      f.planted = false;
      f.t = 1;
      f.dur = 0.1;
      // Touchdown just below, resolved by stepFoot once the character reports it has landed.
      f.to.set(f.pos.x, this.frame.y + this.ankleY, f.pos.z);
      f.from.copy(f.pos);
    }
  }

  private homeOffset(f: Foot): number {
    this.homeFoot(f, vB);
    return Math.hypot(vB.x - f.pos.x, vB.z - f.pos.z);
  }

  private footStretch(f: Foot): number {
    const d = Math.hypot(f.pos.x - this.frame.x, f.pos.z - this.frame.z);
    return d / (this.legLength * 0.95);
  }

  private lift(f: Foot, swing: number, duty: number, T: number, lod: number): void {
    // Landing spot: where the body will be at touchdown, plus part of a stance ahead of it. Under half,
    // because feet land close under the hips and spend the longer part of a stance pushing behind them.
    const lead = swing + duty * T * LAND_LEAD;
    this.homeFoot(f, vA);
    vA.addScaledVector(this.vel, lead);
    this.liftTo(f, vA, swing, lod);
  }

  private liftTo(f: Foot, to: THREE.Vector3, dur: number, lod: number): void {
    f.planted = false;
    f.from.copy(f.pos);
    f.to.copy(to);
    f.fromYaw = f.yaw;
    f.t = 0;
    f.dur = Math.max(0.05, dur);
    f.ground = lod <= 1 ? this.groundHeight(to.x, this.frame.y, to.z) : this.frame.y;
    f.to.y = f.ground + this.ankleY;
  }

  private stepFoot(f: Foot, dt: number, T: number, duty: number): void {
    if (f.planted) {
      // Toe roll in late stance: the heel comes up as the body passes over.
      if (this.moveBlend > 0.3) {
        const psi = (this.phase + f.phaseOffset) % 1;
        const u = clamp((psi / duty - 0.55) / 0.45);
        f.roll = damp(f.roll, u * u * lerp(0.55, 0.9, this.runBlend), 30, dt);
      } else f.roll = damp(f.roll, 0, 12, dt);
      return;
    }
    f.t = Math.min(1, f.t + dt / f.dur);
    const s = f.t;
    // Re-aim mid-swing so a turn or a sudden stop still lands in the right place.
    if (this.moveBlend > 0.5) {
      this.homeFoot(f, vA);
      vA.addScaledVector(this.vel, (1 - s) * f.dur + duty * T * LAND_LEAD);
      f.to.x = damp(f.to.x, vA.x, 14, dt);
      f.to.z = damp(f.to.z, vA.z, 14, dt);
    }
    const e = smooth(s);
    const h = this.L * (lerp(0.045, 0.2, this.runBlend) + 0.012 * Math.min(this.stride, 2)) * (1 - this.weight * 0.3);
    // Runners kick the heel up early in the swing; walkers just clear the ground.
    const arc = Math.pow(Math.sin(Math.PI * Math.pow(s, lerp(1, 0.7, this.runBlend))), 1.3);
    f.pos.lerpVectors(f.from, f.to, e);
    f.pos.y += arc * h;
    f.yaw = f.fromYaw + wrap(this.root.rotation.y - f.fromYaw) * e;
    f.pitch = lerp(key(s, PITCH_STILL), key(s, PITCH_STRIDE), this.moveBlend);
    f.roll = 0;
    if (s >= 1) {
      f.planted = true;
      f.pitch = 0;
      f.pos.copy(f.to);
      const strength = clamp(this.speed / 9 + this.weight * 0.7, 0.15, 1);
      this.landing.kick(0, -(0.1 + this.weight * 0.9 + this.runBlend * 0.3), 0);
      this.onFootstep?.(f.pos.x, f.pos.y - this.ankleY, f.pos.z, strength);
    }
  }

  private stepHop(dt: number): void {
    const good = this.feet[0]!.limb ? this.feet[0]! : this.feet[1]!;
    const moving = this.speed > 0.2;
    this.moveBlend = damp(this.moveBlend, moving ? 1 : 0, 6, dt);
    const T = 0.62 * Math.sqrt(this.L / 1.85);
    if (moving) this.phase = (this.phase + dt / T) % 1;
    const yaw = this.root.rotation.y;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    // Lunges: the surviving foot plants, the body pole-vaults past it, the foot catches up in the air.
    const flight = this.phase > 0.55;
    if (flight && good.planted) {
      good.planted = false;
      good.from.copy(good.pos);
      good.t = 0;
      good.dur = 0.45 * T;
      vA.copy(this.frame).addScaledVector(this.vel, T * 0.55);
      good.to.set(vA.x + good.hipOffset.x * 0.2 * c, this.frame.y + this.ankleY, vA.z - good.hipOffset.x * 0.2 * s);
    }
    if (!good.planted) {
      good.t = Math.min(1, good.t + dt / good.dur);
      good.pos.lerpVectors(good.from, good.to, smooth(good.t));
      good.pos.y += Math.sin(Math.PI * good.t) * this.L * 0.05;
      good.yaw = yaw;
      if (good.t >= 1) {
        good.planted = true;
        this.landing.kick(0, -1.1, 0);
        this.onFootstep?.(good.pos.x, good.pos.y - this.ankleY, good.pos.z, 0.5);
      }
    } else if (!moving) {
      this.homeFoot(good, vA);
      vA.x = lerp(vA.x, this.frame.x, 0.8);
      vA.z = lerp(vA.z, this.frame.z, 0.8);
      good.pos.x = damp(good.pos.x, vA.x, 5, dt);
      good.pos.z = damp(good.pos.z, vA.z, 5, dt);
    }
    this.hopHeight = Math.sin(Math.PI * clamp((this.phase - 0.5) / 0.5)) * this.L * 0.07 * this.moveBlend;
  }

  private stepCrawl(dt: number): void {
    this.moveBlend = damp(this.moveBlend, this.speed > 0.1 ? 1 : 0, 6, dt);
    const reach = this.L * 0.34;
    const T = clamp(reach / Math.max(this.speed, 0.35), 0.4, 1.5);
    if (this.speed > 0.1) this.crawlPhase = (this.crawlPhase + dt / T) % 1;
    for (const f of this.feet) f.planted = true;
  }

  private poseBody(): void {
    const st = this.style;
    const ph = this.phase * TAU;
    const mv = this.moveBlend;
    const run = this.runBlend;
    const L = this.L;
    const bounce = st.bounce * (1 + this.weight * 0.6);

    // Height drop grows with stride because the legs must reach further.
    const strideDrop = Math.min(0.14, (this.stride / L) * 0.022) * L * mv * (this.plan === 'biped' ? 1 : 0);
    const heavyDrop = this.weight * 0.018 * L * mv;
    const breathe = Math.sin(this.time * 1.7 + this.seed) * 0.0035 * L;
    let y = this.hipY * st.crouch - strideDrop - heavyDrop + breathe * (1 - mv);
    const twoPhase = Math.cos(ph * 2);
    // Walks peak mid-stance, runs dip there. The phase shift swaps which.
    y += lerp(-1, 1, run) * twoPhase * L * lerp(0.012, 0.02, run) * bounce * mv;
    y += this.landing.y * 0.05 * (L / 1.85);
    y -= this.buckleW * REEL.buckleDrop * L;
    // Hurt, it stands lower. On a weak leg the hips dip while that leg carries the body, and the trunk lurches over it.
    y -= this.hurtW * HurtShape.drop * L;
    const limp = Math.abs(this.limpW);
    let lurch = 0;
    if (limp > 0.01 && this.plan === 'biped') {
      const weak = this.feet[this.limpW > 0 ? 0 : 1]!;
      const duty = lerp(0.62, 0.27, run);
      const psi = (this.phase + weak.phaseOffset) % 1;
      lurch = limp * (psi < duty ? Math.sin(Math.PI * (psi / duty)) : 0) * mv;
      y -= lurch * HurtShape.limpDip * L;
    }

    let swayX = 0, x = 0, z = 0;
    if (this.plan === 'biped') swayX = Math.sin(ph) * L * lerp(0.018, 0.008, run) * bounce * mv;
    x += swayX;
    // Standing, the weight rests on the good leg.
    if (limp > 0.01 && this.plan === 'biped') x -= Math.sign(this.limpW) * limp * HurtShape.limpRest * L * (1 - mv);
    z += this.leanFwd * L * 0.08;
    if (this.plan === 'hop') {
      const good = this.feet[0]!.limb ? 1 : -1;
      x += good * L * 0.05 * this.hopBlend;
      y = lerp(y, this.hipY * st.crouch * 0.96 + this.hopHeight, this.hopBlend);
    }
    if (this.plan === 'crawl' || this.plan === 'writhe') {
      const surge = Math.sin(this.crawlPhase * TAU) * 0.018 * L * this.moveBlend;
      y = lerp(y, L * 0.105, this.planBlend);
      z = lerp(z, -L * 0.2 + surge, this.planBlend);
    }
    const act = this.action;
    let actYaw = 0;
    if (act && this.plan === 'biped') {
      // The legs sell an action: the hips load before a strike, drive through it, and sink into a landing.
      const t = act.t;
      switch (act.kind) {
        case 'attackMelee':
          y -= key(t, C.attackMelee1) * L;
          z += key(t, C.attackMelee2) * L;
          actYaw = act.flip * key(t, C.attackMelee3);
          break;
        case 'attackHeavy':
          y -= key(t, C.attackHeavy1) * L;
          z += key(t, C.attackHeavy2) * L;
          break;
        case 'throw':
          y -= key(t, C.throw1) * L;
          z += key(t, C.throw2) * L;
          actYaw = key(t, C.throw3);
          break;
        case 'leap':
          y -= key(t, C.leap1) * L;
          z += key(t, C.leap2) * L;
          break;
        case 'land':
          y -= key(t, C.land1) * L;
          break;
        case 'roar':
          y -= key(t, C.roar1) * L;
          z += key(t, C.roar2) * L;
          break;
        case 'stagger':
          y -= key(t, C.stagger1) * L;
          z += key(t, C.stagger2) * L;
          x += key(t, C.stagger3) * L;
          break;
        case 'block':
          y -= key(t, C.block1) * L;
          break;
        case 'deathStumble':
          y -= key(t, C.deathStumble1) * L;
          z += Math.sin(this.time * 5) * 0.03 * L;
          break;
        default:
          break;
      }
    }
    const dazed = this.dazeW * DAZE_SWAY;
    const sway = Math.sin(this.time * 1.9 + this.seed);
    x += this.posture.sway * L + sway * dazed * 0.25 * L;
    y -= this.posture.drop * L;
    z += this.posture.shift * L;
    // A hit shifts the hips over planted feet. On the floor there is nothing under them to sink into.
    const hh = this.hitHips;
    this.pelvisPos.set(x + this.pelvis.x * 0.08 * L + hh.x * L, y + this.pelvis.y * 0.05 * L + hh.y * L * (1 - this.planBlend), z + this.pelvis.z * 0.08 * L + hh.z * L);

    const yawP = Math.sin(ph) * lerp(0.1, 0.2, run) * mv * bounce * 0.8;
    const rollP = Math.cos(ph) * lerp(0.05, 0.03, run) * mv * bounce;
    const pitchP = 0.035 * mv + run * 0.08 + this.leanFwd * 0.5;
    const ht = this.hitTrunk;
    qEuler(this.pelvisQ, pitchP, yawP + actYaw + ht.y * HitShape.hipsTurn, rollP + this.leanSide * 0.5 - this.buckleSide * this.buckleW * REEL.buckleRoll + sway * dazed * 0.5 + ht.z * HitShape.hipsTurn
      - Math.sign(this.limpW) * lurch * HurtShape.limpRoll);
    if (this.planBlend > 0.001) {
      // Prone: the spine lies along the direction of travel.
      qEuler(qA, 1.42, Math.sin(this.crawlPhase * TAU) * 0.16 * this.moveBlend, Math.sin(this.crawlPhase * TAU) * 0.1 * this.moveBlend);
      this.pelvisQ.slerp(qA, this.planBlend);
    }
    if (this.plan === 'hop') {
      const good = this.feet[0]!.limb ? 1 : -1;
      qEuler(qA, (0.16 + this.hopHeight * 0.5) * this.hopBlend, 0, -good * 0.14 * this.hopBlend);
      this.pelvisQ.multiply(qA);
    }
    const hips = this.bones[H.hips]!;
    hips.position.copy(this.pelvisPos);
    hips.quaternion.copy(this.pelvisQ);
  }

  private poseUpperBody(dt: number, lod: number): void {
    const st = this.style;
    const ph = this.phase * TAU;
    const mv = this.moveBlend;
    const run = this.runBlend;
    const a = this.action;
    const at = a?.t ?? 0;

    let twist = -Math.sin(ph) * lerp(0.14, 0.34, run) * mv;
    let bend = st.hunch + this.leanFwd * 0.9 + run * 0.1 * mv;
    let roll = this.leanSide * 0.6 + Math.cos(ph) * 0.03 * mv;
    let headPitch = this.posture.head;
    let headYaw = 0;
    bend += this.posture.bend + this.hurtW * HurtShape.bend;
    roll += this.posture.roll;
    headPitch += this.hurtW * HurtShape.head;
    if (this.dazeW > 0.01) {
      // Head down and rolling, with the body a beat behind it.
      bend += 0.22 * this.dazeW;
      roll += Math.sin(this.time * 1.9 + this.seed + 0.7) * DAZE_SWAY * this.dazeW;
      headPitch += (0.28 + 0.14 * Math.sin(this.time * 2.7)) * this.dazeW;
      headYaw += Math.sin(this.time * 1.3 + this.seed) * 0.3 * this.dazeW;
    }
    if (this.clutchLow) {
      bend += CLUTCH_BEND * this.clutchW;
      roll += this.clutchHand * CLUTCH_ROLL * this.clutchW;
      headPitch -= CLUTCH_BEND * 0.4 * this.clutchW;
    }

    const aimW = this.grip !== null && !this.armGoneR ? 1 : 0;
    twist += this.aimYaw * 0.6;
    bend += -this.aimPitch * 0.3 * aimW;
    headYaw += this.aimYaw * 0.4;
    headPitch += -this.aimPitch * 0.6;

    if (st.twitch > 0) {
      const tw = noise1(this.time * 7 + this.seed) * noise1(this.time * 1.3 + this.seed * 3);
      headYaw += tw * 0.5 * st.twitch;
      headPitch += noise1(this.time * 9 + this.seed * 2) * noise1(this.time * 0.9) * 0.3 * st.twitch;
    }

    if (a) {
      const f = a.flip;
      switch (a.kind) {
        case 'attackMelee':
          twist += f * key(at, C.attackMelee4);
          bend += key(at, C.attackMelee5);
          break;
        case 'attackHeavy':
          bend += key(at, C.attackHeavy3);
          twist += key(at, C.attackHeavy4);
          break;
        case 'throw':
          twist += key(at, C.throw4);
          bend += key(at, C.throw5);
          break;
        case 'leap':
          bend += key(at, C.leap3);
          break;
        case 'land':
          bend += key(at, C.land2);
          break;
        case 'roar':
          bend += key(at, C.roar3);
          headPitch += key(at, C.roar4);
          break;
        case 'stagger':
          bend += key(at, C.stagger4);
          roll += key(at, C.stagger5);
          break;
        case 'deathStumble':
          bend += key(at, C.deathStumble2);
          roll += Math.sin(this.time * 6) * 0.25 * at;
          break;
        default:
          break;
      }
    }
    if (this.armGoneL !== this.armGoneR) roll += this.armGoneL ? 0.07 : -0.07;
    if (this.armGoneL && this.armGoneR && this.plan === 'biped') bend += 0.4;
    if (this.planBlend > 0.01) {
      // Crawling: arch the back so the head stays up off the floor.
      bend = lerp(bend, -0.62, this.planBlend);
      headPitch = lerp(headPitch, -0.6, this.planBlend);
    }

    const sp = this.spine, ch = this.chest, hd = this.head;
    // A hit's lean, twist and roll, shared between the two joints of the trunk; the pelvis has taken `hipsTurn` of the turn.
    const ht = this.hitTrunk, hh = this.hitHead;
    const turn = 1 - HitShape.hipsTurn;
    const spineQ = this.bones[H.spine]!.quaternion;
    const chestQ = this.bones[H.chest]!.quaternion;
    qEuler(spineQ, bend * 0.45 + sp.x * 0.5 + ht.x * 0.45, twist * 0.42 + sp.y * 0.5 + ht.y * 0.45 * turn, roll * 0.5 + sp.z * 0.5 + ht.z * 0.45 * turn);
    qEuler(chestQ, bend * 0.55 + ch.x * 0.6 + ht.x * 0.55, twist * 0.58 + ch.y * 0.6 + ht.y * 0.55 * turn, roll * 0.5 + ch.z * 0.6 + ht.z * 0.55 * turn);

    this.chestQ.copy(this.pelvisQ).multiply(spineQ).multiply(chestQ);
    this.chestPos.copy(this.bones[H.spine]!.position).applyQuaternion(this.pelvisQ).add(this.pelvisPos);
    qA.copy(this.pelvisQ).multiply(spineQ);
    this.chestPos.add(vA.copy(this.bones[H.chest]!.position).applyQuaternion(qA));

    if (!this.headGone) {
      // Counter the torso so the eyes hold their line, then add where the character is looking.
      euler.setFromQuaternion(this.chestQ, 'YXZ');
      const gaze = st.gazeLift;
      const counterX = -euler.x * gaze, counterY = -euler.y * 0.5, counterZ = -euler.z * 0.6;
      qEuler(this.bones[H.neck]!.quaternion, counterX * 0.45 + hd.x * 0.4 + hh.x * 0.4, counterY * 0.4 + headYaw * 0.4 + hd.y * 0.4 + hh.y * 0.4, counterZ * 0.5 + hd.z * 0.4 + hh.z * 0.4);
      qEuler(this.bones[H.head]!.quaternion, counterX * 0.55 + headPitch + hd.x * 0.7 + hh.x * 0.6, counterY * 0.6 + headYaw * 0.6 + hd.y * 0.7 + hh.y * 0.6, counterZ * 0.5 + hd.z * 0.7 + hh.z * 0.6);
    }
    this.poseArms(dt, lod);
  }

  private poseArms(dt: number, lod: number): void {
    const armed = this.grip !== null && !this.armGoneR;
    if (armed) this.computeWeapon();
    for (const h of this.hands) {
      if (!h.limb) continue;
      if (this.hidden(h.side > 0 ? H.upperArmL : H.upperArmR)) continue;
      vA.copy(h.shoulderOffset).applyQuaternion(this.chestQ).add(this.chestPos);
      const shoulder = vA;
      this.armTarget(h, dt, armed, shoulder);
      this.posture.hand(h.side, h.limb.l1 + h.limb.l2, this.chestQ, shoulder, h.target, h.pole);
      if (this.planBlend <= 0.5) this.protect(h, armed, shoulder);
      else this.clutch(h);
      const spring = h.side > 0 ? this.armLS : this.armRS;
      h.target.x += spring.x * 0.05 * this.L;
      h.target.z += spring.z * 0.05 * this.L;
      h.limb.solve(shoulder, this.chestQ, h.target, h.pole);
      if (armed && h.side < 0) {
        // Hand orientation: the socket on the hand must line up with the weapon.
        qB.copy(this.weaponQ).multiply(qC.copy(this.grip!.socketRot).invert());
        h.limb.setHand(qB);
      } else if (armed && h.side > 0 && this.grip!.foregrip) {
        qB.copy(this.weaponQ).multiply(qC.copy(this.grip!.socketRot).invert());
        h.limb.setHand(qB);
      } else if (h.side > 0 && this.shieldRot) {
        qEuler(qB, 0, this.aimYaw * 0.7, 0).multiply(qC.copy(this.shieldRot).invert());
        h.limb.setHand(qB);
      } else if (lod <= 1) {
        h.limb.relaxEnd();
      }
      this.swingArm(h);
    }
  }

  /**
   * A hit's swing on an arm the pose has just been solved for: the upper arm turned about the shoulder in the chest's axes,
   * then the elbow folded and the wrist let back behind it. Laid over the solved arm, so a hand leaves what it was holding
   * for as long as the swing lasts, and the gun in it goes with it.
   */
  private swingArm(h: Hand): void {
    const i = h.side > 0 ? 0 : 1;
    const a = this.hitArm[i]!, f = this.hitFore[i]!;
    if (!a.active && !f.active) return;
    const limb = h.limb!;
    limb.a.quaternion.premultiply(qEuler(qB, a.x, 0, a.z));
    // The elbow only folds one way (the rig's hinge: about its own X, toward the front).
    limb.b.quaternion.multiply(qEuler(qB, -Math.abs(f.x) * HitShape.elbow, 0, 0));
    limb.c.quaternion.multiply(qEuler(qB, Math.abs(f.x) * HitShape.wrist, 0, 0));
  }

  /** What a hand does for the body's sake, over whatever it was doing: out for balance, to a wound, up to the face. */
  private protect(h: Hand, armed: boolean, shoulder: THREE.Vector3): void {
    const s = this.L / 1.85;
    const side = h.side;
    const reach = ((h.limb!.l1 + h.limb!.l2) / 0.56) * s;
    const gun = armed && side < 0;
    if (this.flailW > 0.02) {
      const n = this.time * 11 + side * 2.1 + this.seed;
      const a = noise1(n);
      const b = noise1(n * 0.7 + 4);
      // Out and up from the shoulder, in the chest's axes: an arm thrown wide is what catches a body.
      this.reachTo(h, shoulder, reach, side * (0.62 + 0.2 * a), -0.18 + 0.42 * b, 0.22 + 0.3 * a * b, smooth(clamp(this.flailW * 1.5)) * (gun ? REEL.gunHand : 1));
      h.pole.set(side * 0.8, -0.5, -0.5);
    }
    if (this.guardW > 0.01) {
      vB.set(side * 0.09 * s, 0.5 * s, 0.24 * s).applyQuaternion(this.chestQ).add(this.chestPos);
      h.target.lerp(vB, this.guardW * (gun ? REEL.gunHand : 1));
      h.pole.set(side * 0.9, -0.7, -0.3);
    }
    if (this.dazeW > 0.01 && side === (this.grip ? 1 : -1)) {
      vB.set(side * 0.1 * s, 0.56 * s, 0.13 * s).applyQuaternion(this.chestQ).add(this.chestPos);
      h.target.lerp(vB, this.dazeW);
      h.pole.set(side * 0.9, -0.5, -0.2);
    }
    this.clutch(h);
  }

  /** A hand on a wound. Crawling keeps this and nothing else from `protect`: the other hand does the hauling. */
  private clutch(h: Hand): void {
    const side = h.side;
    if (this.clutchW <= 0.01 || side !== this.clutchHand || this.clutchBone < 0 || this.hidden(this.clutchBone)) return;
    // Last frame's world pose: legs are posed after arms, and a hand a frame behind a wound still reads as holding it.
    vB.copy(this.clutchAt).applyMatrix4(this.bones[this.clutchBone]!.matrixWorld);
    const yaw = this.root.rotation.y;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const dx = vB.x - this.root.position.x, dz = vB.z - this.root.position.z;
    vB.set(dx * c - dz * sn, vB.y - this.root.position.y, dx * sn + dz * c);
    h.target.lerp(vB, this.clutchW);
    h.pole.set(side * 0.8, -0.3, -0.7);
  }

  /** Weapon pose in character space, for the current stance. */
  private computeWeapon(): void {
    const L = this.L;
    const s = L / 1.85;
    const R = this.recoil;
    const st = this.stance;
    let pitch = -this.aimPitch;
    // Local weapon position relative to chest, in character axes.
    let wx = -0.13, wy = 0.14, wz = 0.3;
    if (st === 'heavy') { wx = -0.26; wy = -0.1; wz = 0.3; pitch *= 0.7; }
    if (st === 'shoulder') { wx = -0.3; wy = 0.14; wz = 0.1; }
    if (st === 'pistol' || st === 'shield') { wx = -0.1; wy = 0.15; wz = 0.44; }
    if (st === 'staff') { wx = -0.3; wy = 0.0; wz = 0.14; }
    const run = this.runBlend * this.moveBlend;
    // Sprinting drops the muzzle, so a charging soldier looks like one.
    if (st === 'rifle') { wy -= run * 0.09; wz -= run * 0.04; pitch += run * 0.32; }
    this.weaponPos.set(wx * s, wy * s, wz * s).applyQuaternion(this.chestQ).add(this.chestPos);
    this.weaponPos.addScaledVector(vB.set(0, 0, 1).applyQuaternion(this.chestQ), R.z * 0.07 * s);
    // The muzzle follows the aim, with a little of the torso's stride sway left in so the gun feels held.
    qEuler(this.weaponQ, pitch + R.z * 0.4, this.aimYaw + (this.chestYaw() - this.aimYaw * 0.6) * 0.3, 0);
    if (st === 'staff') qEuler(this.weaponQ, 0.05, this.chestYaw(), -0.05);
  }

  private chestYaw(): number {
    euler.setFromQuaternion(this.chestQ, 'YXZ');
    return euler.y;
  }

  private armTarget(h: Hand, dt: number, armed: boolean, shoulder: THREE.Vector3): void {
    const L = this.L;
    const s = L / 1.85;
    const side = h.side;
    const ph = this.phase * TAU;
    const mv = this.moveBlend;
    const run = this.runBlend;
    const st = this.style;
    const a = this.action;
    const at = a?.t ?? 0;
    h.pole.set(side * 0.5, -0.25, -1);

    if (this.planBlend > 0.5) {
      this.crawlHand(h, dt);
      return;
    }

    if (armed && side < 0) {
      // Grip hand sits so that its socket reaches the weapon's origin.
      this.gripToHand(vB);
      h.target.copy(vB);
      h.pole.set(-0.7, -0.6, -0.4);
      return;
    }
    if (armed && side > 0 && this.grip!.foregrip && !this.armGoneL) {
      vB.copy(this.grip!.foregrip).applyQuaternion(this.weaponQ).add(this.weaponPos);
      // The socket offset is the hand's palm. Back the target off so the palm meets the foregrip.
      qB.copy(this.weaponQ).multiply(qC.copy(this.grip!.socketRot).invert());
      vC.copy(this.grip!.socketPos).applyQuaternion(qB);
      h.target.copy(vB).sub(vC);
      h.pole.set(0.8, -0.7, -0.2);
      return;
    }

    if (side > 0 && this.shieldRot) {
      vB.set(0.17 * s, 0.1 * s, 0.34 * s).applyQuaternion(this.chestQ).add(this.chestPos);
      h.target.copy(vB);
      h.pole.set(0.9, -0.5, -0.3);
      return;
    }

    // Free arm: relaxed hang with swing. Runners pump with bent elbows; walkers just let it go.
    const swing = -Math.sin(ph) * side;
    const bendFwd = lerp(0.05, 0.2, run) * mv;
    const sw = lerp(0.1, 0.27, run) * mv * s;
    const elbowLift = lerp(0.03, 0.2, run) * mv * s;
    const spread = (0.12 + st.armsOut * 0.2) * s;
    const armLen = (h.limb!.l1 + h.limb!.l2);
    const armScale = armLen / 0.56;
    h.target.set(
      shoulder.x + side * spread - side * run * mv * 0.08 * s,
      shoulder.y - armLen * (lerp(0.94, 0.62, run * mv) - st.armLift) + elbowLift * (0.5 + 0.5 * swing),
      shoulder.z + (swing * sw + bendFwd * s) * armScale + 0.03 * s,
    );
    if (st.twitch > 0) {
      h.target.x += noise1(this.time * 5 + side * 9 + this.seed) * 0.02 * s * st.twitch;
      h.target.z += noise1(this.time * 4 + side * 5 + this.seed) * 0.03 * s * st.twitch;
    }
    if (this.plan === 'hop') {
      h.target.x += side * 0.14 * s;
      h.target.y += 0.12 * s;
    }
    if (side > 0 ? this.armGoneR : this.armGoneL) {
      // The surviving arm overcompensates for the missing counterweight.
      h.target.z += swing * sw * 0.7;
      h.target.x += side * 0.06 * s;
    }
    if (this.blockHold > 0.01 && !a) {
      vB.set(side * -0.06 * s, 0.14 * s, 0.26 * s).applyQuaternion(this.chestQ).add(this.chestPos);
      h.target.lerp(vB, clamp(this.blockHold * 2));
    }
    if (a) this.actionHand(h, a, at, shoulder);
  }

  /** Target for the wrist that puts the grip socket at the weapon origin. */
  private gripToHand(out: THREE.Vector3): void {
    qB.copy(this.weaponQ).multiply(qC.copy(this.grip!.socketRot).invert());
    vC.copy(this.grip!.socketPos).applyQuaternion(qB);
    out.copy(this.weaponPos).sub(vC);
  }

  private actionHand(h: Hand, a: ActionState, t: number, shoulder: THREE.Vector3): void {
    const s = this.L / 1.85;
    const side = h.side;
    const reach = (h.limb!.l1 + h.limb!.l2) / 0.56 * s;
    const striker = side === a.flip;
    switch (a.kind) {
      case 'attackMelee': {
        const w = key(t, C.attackMelee6);
        if (striker) {
          const x = side * key(t, C.attackMelee7);
          const y = key(t, C.attackMelee8);
          const z = key(t, C.attackMelee9);
          this.reachTo(h, shoulder, reach, x, y, z, w);
        } else this.reachTo(h, shoulder, reach, side * 0.12, -0.18, 0.24, w * 0.7);
        break;
      }
      case 'attackHeavy': {
        const w = key(t, C.attackHeavy5);
        const y = key(t, C.attackHeavy6);
        const z = key(t, C.attackHeavy7);
        this.reachTo(h, shoulder, reach, -side * 0.1, y, z, w);
        break;
      }
      case 'throw': {
        if (!striker) { this.reachTo(h, shoulder, reach, side * 0.1, 0.05, 0.4, key(t, C.throw6)); break; }
        const w = key(t, C.throw7);
        this.reachTo(h, shoulder, reach, side * 0.18, key(t, C.throw8), key(t, C.throw9), w);
        break;
      }
      case 'leap':
        // Arms load behind the body in the crouch, then drive up and forward with the jump.
        this.reachTo(h, shoulder, reach, side * 0.14, key(t, C.leap4), key(t, C.leap5), key(t, C.leap6));
        break;
      case 'land':
        this.reachTo(h, shoulder, reach, side * 0.24, key(t, C.land3), 0.14, key(t, C.land4));
        break;
      case 'roar':
        // Claws low and wide, thrown back as the chest opens.
        this.reachTo(h, shoulder, reach, side * key(t, C.roar5), key(t, C.roar6), key(t, C.roar7), key(t, C.roar8));
        break;
      case 'stagger':
        this.reachTo(h, shoulder, reach, side * 0.24, key(t, C.stagger6), key(t, C.stagger7), key(t, C.stagger8));
        break;
      case 'block':
        this.reachTo(h, shoulder, reach, -side * 0.18, 0.12, 0.28, key(t, C.block2));
        break;
      case 'deathStumble':
        this.reachTo(h, shoulder, reach, side * (0.2 + Math.sin(this.time * 9 + side) * 0.08), -0.34 + Math.sin(this.time * 7) * 0.1, 0.16, key(t, C.deathStumble3));
        break;
      default:
        break;
    }
  }

  /** Moves a hand target toward a point given in chest axes from the shoulder, in units of arm length. */
  private reachTo(h: Hand, shoulder: THREE.Vector3, reach: number, x: number, y: number, z: number, w: number): void {
    vB.set(x * reach, y * reach, z * reach).applyQuaternion(this.chestQ).add(shoulder);
    h.target.lerp(vB, w);
  }

  private crawlHand(h: Hand, dt: number): void {
    const s = this.L / 1.85;
    const yaw = this.root.rotation.y;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const phase = (this.crawlPhase + (h.side > 0 ? 0 : 0.5)) % 1;
    const reach = (h.limb!.l1 + h.limb!.l2) * 0.86;
    const moving = this.moveBlend > 0.3;
    const off = this.armGoneL || this.armGoneR ? 0 : h.side * 0.17 * s;
    const fwd = reach * 1.05 - 0.05 * s;
    if (moving && phase > 0.55 && !h.swinging) {
      h.swinging = true;
      h.t = 0;
      h.from.copy(h.planted);
    }
    // Reach ahead of the chest, in the movement frame.
    const tx = this.frame.x + off * c + fwd * sn, tz = this.frame.z - off * sn + fwd * c;
    if (h.swinging) {
      h.t = Math.min(1, h.t + dt / 0.28);
      h.planted.lerpVectors(h.from, vB.set(tx, this.frame.y + 0.03 * s, tz), smooth(h.t));
      h.planted.y += Math.sin(Math.PI * h.t) * 0.16 * s;
      if (h.t >= 1) {
        h.swinging = false;
        this.onFootstep?.(h.planted.x, h.planted.y, h.planted.z, 0.25);
      }
    } else if (h.planted.lengthSq() < 1e-6 || h.planted.distanceTo(vB.set(tx, this.frame.y, tz)) > reach * 1.8) {
      h.planted.set(tx, this.frame.y + 0.03 * s, tz);
    }
    // World frame to character frame.
    const dx = h.planted.x - this.frame.x, dz = h.planted.z - this.frame.z;
    h.target.set(dx * c - dz * sn, h.planted.y - this.frame.y, dx * sn + dz * c);
    h.pole.set(h.side * 1, 0.5, -0.4);
  }

  private poseLegs(lod: number): void {
    const yaw = this.root.rotation.y;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const f of this.feet) {
      const limb = f.limb;
      if (!limb) continue;
      if (this.planBlend > 0.5) {
        this.trailLeg(f);
        continue;
      }
      vA.copy(f.hipOffset).applyQuaternion(this.pelvisQ).add(this.pelvisPos);
      const dx = f.pos.x - this.frame.x, dz = f.pos.z - this.frame.z;
      vB.set(dx * c - dz * s, f.pos.y - this.frame.y, dx * s + dz * c);
      this.posture.foot(f.side, this.L, this.moveBlend, vB);
      if (lod === 0 && f.roll > 0.01) {
        // Pivot the ankle around the ball of the foot.
        const toe = this.L * 0.075;
        const sinR = Math.sin(f.roll), cosR = Math.cos(f.roll);
        const fy = wrap(f.yaw - yaw);
        const fx = Math.sin(fy), fz = Math.cos(fy);
        vB.x += fx * toe * (1 - cosR);
        vB.z += fz * toe * (1 - cosR);
        vB.y += toe * sinR;
      }
      const footYaw = wrap(f.yaw - yaw) * 0.7;
      // Knees point where the foot points, splayed outward a touch.
      vC.set(Math.sin(footYaw) + f.side * 0.14, 0.16, Math.cos(footYaw));
      limb.solve(vA, this.pelvisQ, vB, vC);
      const pitch = (f.planted ? f.roll : f.pitch) + this.posture.toe(f.side, this.moveBlend);
      qEuler(qD, pitch, footYaw, 0);
      limb.setEnd(qD);
    }
    const stump = this.plan === 'hop' ? (this.feet[0]!.limb ? this.feet[1]! : this.feet[0]!) : null;
    if (stump) {
      // Whatever is left of the missing leg dangles and swings with the hops.
      const thigh = stump.side > 0 ? H.thighL : H.thighR;
      if (!this.hidden(thigh)) qEuler(this.bones[thigh]!.quaternion, -0.35 + Math.sin(this.phase * TAU) * 0.3, 0, stump.side * 0.08);
    }
  }

  private stepClip(dt: number): void {
    const kind = this.clipKind!;
    this.clipU = Math.min(1, this.clipU + dt / this.clipSeconds);
    const u = this.clipU;
    // Standing has already been posed. The last stretch of a clip fades into it, feet and all.
    const out = smooth(clamp((u - (1 - GETUP_RELEASE)) / GETUP_RELEASE));
    const bones = this.bones;
    if (out > 0) {
      for (let i = 0; i < bones.length; i++) this.restQ[i]!.copy(bones[i]!.quaternion);
      this.restHips.copy(bones[H.hips]!.position);
    }
    this.poseClip(kind, u, this.clipFlip, this.clipHurt);
    if (out > 0) {
      for (let i = 0; i < bones.length; i++) bones[i]!.quaternion.slerp(this.restQ[i]!, out);
      bones[H.hips]!.position.lerp(this.restHips, out);
    }
    if (u >= 1) this.clipKind = null;
  }

  /** Writes one frame of a get-up onto the bones. Works in the same character space as the rest of the animator. */
  private poseClip(kind: GetUpKind, u: number, flip: number, hurt: number): void {
    const p = clipPose;
    sampleGetUp(kind, u, p);
    const s = this.L / 1.85;
    // Effort shows as a body that shakes and sags under its own weight, most of all halfway up.
    const strain = hurt * Math.sin(Math.PI * u);
    const shake = Math.sin(this.time * 17 + this.seed) * Math.sin(this.time * 5.3) * strain;
    this.pelvisPos.set((p.hips.x + shake * 0.012) * flip * s, (p.hips.y - strain * 0.03) * s, p.hips.z * s);
    qEuler(this.pelvisQ, p.pitch, 0, (p.roll + shake * 0.05) * flip);
    const hips = this.bones[H.hips]!;
    hips.position.copy(this.pelvisPos);
    hips.quaternion.copy(this.pelvisQ);

    const ch = this.chest, hd = this.head;
    const bend = p.bend + strain * 0.1;
    const spineQ = this.bones[H.spine]!.quaternion;
    const chestQ = this.bones[H.chest]!.quaternion;
    const ht = this.hitTrunk;
    qEuler(spineQ, bend * 0.45 + ht.x * 0.45, ht.y * 0.45, ht.z * 0.45);
    qEuler(chestQ, bend * 0.55 + ch.x * 0.6 + ht.x * 0.55, ch.y * 0.6 + ht.y * 0.55, ch.z * 0.6 + ht.z * 0.55);
    this.chestQ.copy(this.pelvisQ).multiply(spineQ).multiply(chestQ);
    this.chestPos.copy(this.bones[H.spine]!.position).applyQuaternion(this.pelvisQ).add(this.pelvisPos);
    qA.copy(this.pelvisQ).multiply(spineQ);
    this.chestPos.add(vA.copy(this.bones[H.chest]!.position).applyQuaternion(qA));
    if (!this.headGone) {
      qEuler(this.bones[H.neck]!.quaternion, p.head * 0.45 + hd.x * 0.4, hd.y * 0.4, hd.z * 0.4);
      qEuler(this.bones[H.head]!.quaternion, p.head * 0.55 + hd.x * 0.7, hd.y * 0.7, hd.z * 0.7);
    }

    const armed = this.grip !== null && !this.armGoneR;
    for (const h of this.hands) {
      if (!h.limb || this.hidden(h.side > 0 ? H.upperArmL : H.upperArmR)) continue;
      const leading = h.side === flip;
      vA.copy(h.shoulderOffset).applyQuaternion(this.chestQ).add(this.chestPos);
      const armLen = h.limb.l1 + h.limb.l2;
      // A hand with a gun in it cannot push on anything, so it hugs the weapon in and the other arm does the work.
      if (armed && h.side < 0) h.target.set(-0.1 * s, 0.1 * s, 0.26 * s).applyQuaternion(this.chestQ).add(this.chestPos);
      else h.target.set(vA.x + h.side * 0.1 * s, vA.y - armLen * 0.92, vA.z + 0.05 * s);
      if (!(armed && h.side < 0)) {
        const key = leading ? p.leadHand : p.trailHand;
        vB.set(key.x * flip * s, key.y * s, key.z * s);
        h.target.lerp(vB, leading ? p.leadGrip : p.trailGrip);
      }
      h.pole.set(h.side * 0.7, 0.55, -0.4);
      if (this.clutchW > 0.01 && h.side === this.clutchHand) this.protect(h, armed, vA);
      h.limb.solve(vA, this.chestQ, h.target, h.pole);
      h.limb.relaxEnd();
    }

    for (const f of this.feet) {
      const limb = f.limb;
      if (!limb) continue;
      const leading = f.side === flip;
      const key = leading ? p.lead : p.trail;
      vA.copy(f.hipOffset).applyQuaternion(this.pelvisQ).add(this.pelvisPos);
      vB.set(key.x * flip * s, key.y * s, key.z * s);
      vC.set(f.side * 0.14, 0.16, 1).applyQuaternion(this.pelvisQ);
      limb.solve(vA, this.pelvisQ, vB, vC);
      qEuler(qD, leading ? p.leadToe : p.trailToe, 0, 0);
      limb.setEnd(qD);
    }
  }

  private blendSnapshot(dt: number): void {
    this.snapLeft = Math.max(0, this.snapLeft - dt);
    const keep = smooth(this.snapLeft / this.snapSeconds);
    const bones = this.bones;
    for (let i = 0; i < bones.length; i++) bones[i]!.quaternion.slerp(this.snapQ[i]!, keep);
    bones[H.hips]!.position.lerp(this.snapHips, keep);
  }

  /**
   * A blend moves joint angles and knows nothing about the floor, so an arm swinging from where it lay to where it goes
   * can pass through it, and on a shorter or bulkier body than the keys were made on, so can a knee. The hips ride up
   * by however much that would be.
   */
  private keepAboveFloor(): void {
    const { bones, root } = this;
    root.updateMatrixWorld(true);
    let low = Infinity;
    for (let i = 0; i < LOW_BONES.length; i++) {
      const b = LOW_BONES[i]!;
      if (!this.hidden(b)) low = Math.min(low, bones[b]!.matrixWorld.elements[13]!);
    }
    const under = root.position.y + FLOOR_CLEARANCE * (this.L / 1.85) - low;
    if (under > 0) bones[H.hips]!.position.y += under;
  }

  private trailLeg(f: Foot): void {
    const limb = f.limb!;
    const w = Math.sin(this.crawlPhase * TAU + f.side) * 0.12;
    qEuler(limb.a.quaternion, 0.15 + w, 0, f.side * 0.14);
    qEuler(limb.b.quaternion, 0.2, 0, 0);
    limb.relaxEnd();
  }
}

/** Ankle height at bind: the foot bone's position above the floor. */
function bindAnkle(bones: readonly THREE.Bone[]): number {
  return bones[H.hips]!.position.y + bones[H.thighL]!.position.y + bones[H.shinL]!.position.y + bones[H.footL]!.position.y;
}

/** Smooth 1D noise, about -1..1. */
function noise1(x: number): number {
  return Math.sin(x) * 0.6 + Math.sin(x * 2.3 + 1.3) * 0.3 + Math.sin(x * 4.1 + 2.1) * 0.1;
}

