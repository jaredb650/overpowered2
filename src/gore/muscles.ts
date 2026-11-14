/**
 * What a ragdoll has that a bag of hinges does not: tension.
 *
 * Hard limits let a joint move at full speed and stop dead, so nothing that happens to a limb reaches the rest
 * of the body and it reads as weightless. This layer gives every joint a ligament, a resting posture, a reaction
 * to being hit, and for a body that is still dying, the muscles that hold it up.
 *
 * Every torque here is written into RagPart.tau, which Rag already sends to Rapier once per body, so a muscle adds
 * no calls across the WASM boundary. Only a ligament at work adds one, for the linear impulse in RagPart.push. Each
 * torque goes on the child with its reaction on the parent, so a body can reshape itself without spinning itself up.
 * That push is the exception: it has no reaction, so a ligament adds a little momentum of its own. Weightless, it was
 * about 5% more spin than hard limits at worst, and a drift of around 0.1 m/s.
 */
import * as THREE from 'three';
import type { CharacterAnimation, CharacterInstance } from '../core/contracts';
import { DevFlags } from '../core/devflags';
import { clamp, lerp, mulberry32, smoothstep } from '../core/math';
import type { JointRole } from '../characters/rig';
import { GRAVITY, OWN_BLAST } from '../physics/Physics';
import type { Rag, RagPart } from './rag';
import type { Reflex, ReflexLift } from './reflex';
import { HUMAN_HEIGHT } from './rigInfo';

/** How a body goes down when it is not dropped outright. */
export interface CollapseOptions {
  /** Seconds from the first weakness to a limp body. Default `MuscleTuning.collapseSeconds`, at most 5. */
  duration?: number;
  /** What the character was moving at. The legs stumble on with it. */
  velocity?: THREE.Vector3;
  /** Death twitching once it is down, 0..1. */
  twitch?: number;
  /** The shot that did it: where it goes in, and which way it was going. The body staggers on along it. */
  hit?: { bone: number; point: THREE.Vector3; dir: THREE.Vector3; force: number };
}

/** Knocked off its feet and alive. Everything here is about how it lands and how long it stays there. */
export interface KnockdownOptions {
  /** World-space impulses, as on a ragdoll. A blast needs none: `Physics.radialImpulse` finds the body by itself. */
  impulses?: { bone: number; point: THREE.Vector3; impulse: THREE.Vector3 }[];
  /** What the character was already moving at. */
  velocity?: THREE.Vector3;
  /** Limbs thrown by the hit. Left out, it is worked out from `impulses`. */
  impact?: { dir: THREE.Vector3; strength: number };
  /** Metres per second put on the upper body, to tip it over its own feet. This is what makes a body fall and not fold. */
  topple?: THREE.Vector3;
  /** Seconds on the floor before it tries to get up. */
  lie?: number;
  /** Seconds the get-up takes. */
  rise?: number;
  /** 0 feels nothing and gets straight up, 1 is badly hurt. */
  hurt?: number;
  /** Where a hand should go. */
  wound?: { bone: number; point: THREE.Vector3 };
  /**
   * Knocked cold by a head hit: a shotgun or a heavy round. The head whips back from `wound.point` along `impact.dir` and
   * hangs slack for a moment, the arms go slack with no brace and no guard, and it goes over like a sack, alive.
   */
  knockout?: boolean;
  /**
   * Losing its balance, not knocked off its feet: the body goes onto its muscles on this frame and follows the stumble its
   * animator was just given, with a hold under the hips that fades over `seconds`. It goes over when its weight gets past its
   * feet, or at `seconds` at the latest, and from there this is the same knockdown, the same ragdoll. No `topple`, and
   * `impact` is not used: the animation is doing the flailing. Refused past `GoreTuning.maxStumbles`, on fewer than two
   * feet, and with `?stand=0`: the caller staggers it and knocks it down the old way.
   */
  stumble?: { seconds: number };
}

/** What the owner of a knocked-down character reads each frame. */
export interface DownedBody {
  /** The hips, in the world. */
  readonly center: THREE.Vector3;
}

// Added the way core/gameplay.ts adds to the contracts, so the shared file stays out of this system's changes.
declare module '../core/contracts' {
  interface RagdollOptions {
    /** The hit that caused this, so limbs react too. Left out, it is worked out from `impulses`. */
    impact?: { dir: THREE.Vector3; strength: number };
    /**
     * Death twitching, 0..1. Defaults to 1 for a body with no head, 0 otherwise, except that a limp body with no head is
     * a lethal headshot and takes `GoreTuning.headshotTwitch`, which is 0.
     */
    twitch?: number;
    /** False runs this one body on hard limits, for comparison. Defaults to `MuscleTuning.enabled`. */
    muscles?: boolean;
    /** Every muscle gone on this frame: no tone arrives and nothing eases the fall. A lethal headshot. */
    limp?: boolean;
  }
  interface GoreSystem {
    /**
     * A death with time in it. Takes ownership, like ragdoll, but muscles hold the live animation and fade out:
     * upper body first, then the legs give way. Falls back to a plain ragdoll past `GoreTuning.maxCollapses`.
     */
    collapse(char: CharacterInstance, options?: CollapseOptions): void;
    /**
     * Ragdoll without dying. The character stays the caller's: gore has its bones until it has got its limbs under it,
     * then hands it back on the floor, already getting up, with `root` where it will stand. Read `downed` each frame
     * to see where it is, and when that comes back null the character is yours again. Further calls on a body that is
     * down are further hits. Any death call ends it, and the body goes on falling from where it was. False if the rig
     * cannot get up, or past `GoreTuning.maxKnockdowns`: stagger it instead.
     */
    knockdown(char: CharacterInstance, options?: KnockdownOptions): boolean;
    /** The knocked-down body, or null if gore does not have it. */
    downed(char: CharacterInstance): DownedBody | null;
  }
}

const flag = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('muscles');
const weightFlag = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('weight');
/**
 * `?weight=0` puts back the bodies from before the weight pass, for comparison in motion: feet that stand on their soles, a
 * collapse that holds up a third of its own weight, a lethal headshot that twitches, a head round that a stumbling body
 * staggers on from, and a death that keeps only the stride, not the stagger. Read once, at load. Left on either way: the
 * stagger and topple of a collapse coming in over 0.2 s, and the true seed speed of far bodies.
 */
export const WEIGHT_PASS = weightFlag !== '0';

const massFlag = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('mass');
/**
 * `?mass=0` puts back hits from before they knew the mass of what they hit, for comparison in motion: a round's jolt and a
 * blast's spin the same on a Juggernaut as on a Trooper, a round putting up to 9 m/s on a limb, the living flinch and its
 * springs that rang, and a ragdoll budget that froze the oldest body however fresh or fast. Read once, at load. The
 * animator reads the same flag for its springs (`HumanoidAnimator`), since characters do not import gore.
 */
export const MASS_PASS = massFlag !== '0';

const knockFlag = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('knock');
/**
 * `?knock=0` puts back knockdowns from before they could be run over, for comparison in motion: running into a body only
 * staggers it, a head hit floors it only from a shotgun or a heavy round and goes over like any other knockdown, a hand that
 * braces a fall holds stiff, the arms carry their own weight in a fall, and a thrown body's hands leave its face after 0.2 s
 * whatever it is doing. Read once, at load, by gore and by the damage model and its rules.
 */
export const KNOCK_PASS = knockFlag !== '0';

const standFlag = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('stand');
/**
 * `?stand=0` puts back a fall from before a body lost its balance on its muscles, for comparison in motion: a stagger the
 * animation plays on its springs, then 0.16 to 0.42 s later a knockdown that tips it over with its legs and spine locked.
 * Read once, at load, by gore and by the damage model.
 */
export const STAND_PASS = standFlag !== '0';

export const MuscleTuning = {
  /** ?muscles=0 turns the whole layer off, for comparison: hard limits, instant ragdolls, no reactions. */
  get enabled(): boolean {
    return flag !== '0' && DevFlags.muscles;
  },

  /** Radians inside a limit where the ligament starts to take up. Never more than `limitZoneShare` of the range. */
  limitZone: 0.45,
  /** Shoulders take up from about shoulder height, or arms fly overhead and stay there. */
  shoulderZone: 1.05,
  limitZoneShare: 0.55,
  /** Damping and spring at the limit, as rates. Damping leads so that energy is lost, not stored and given back. */
  limitDamping: 40,
  limitSpring: 60,
  /** How far past the limit, in zone widths, resistance keeps growing. */
  limitOverdrive: 3,
  /** Fastest a ligament may push a joint back out, in rad/s. */
  limitPushSpeed: 3,
  /** Ligaments spring back only after this long. A running stride starts deep in them and must not be yanked. */
  limitRise: 0.25,
  /** Seconds quiet between which ligaments let go, so a limb wedged by the floor stays wedged. */
  limitLetGoStart: 0.25,
  limitLetGoEnd: 0.5,
  /**
   * Body speed in m/s between which ligaments start to spring back. Below it they can only take energy out, so a
   * body must come to rest: pushed against the floor by a spring, a light leg bounces for as long as it is allowed.
   */
  limitElasticLow: 0.35,
  limitElasticHigh: 1.2,
  /** Twist stops being meaningful as swing nears a half turn, so its limit fades out between these. */
  twistFadeStart: 1.2,
  twistFadeEnd: 2.2,
  /** Rapier's own hinge stop sits this far past the rig limit: at the straight end, and at the folded end. */
  hardMarginStraight: 0.14,
  hardMarginFolded: 0.5,
  /**
   * The same at a knee's folded end. A tighter stop was tried with the heel ball, from 0.35 down to 0.1, with and without a
   * braking zone before it: none laid a dead body out any longer, and every one propped it in a kneel for up to a second.
   */
  kneeMarginFolded: 0.5,

  /** Speed of the pull toward the resting pose, in rad/s of natural frequency. */
  neutralRate: 3.4,
  /** The pull as a share of the limb's own weight on the joint. Under 1 is what stops it lifting anything. */
  neutralCap: 0.3,
  /** Seconds for tone to arrive after death, to hold, and to drain away. */
  toneRise: 0.2,
  toneHold: 1.7,
  toneFade: 1.3,
  /** Rate at which joints with no body of their own, like ankles, ease to rest. Visual only. */
  mergedRate: 4,
  /** Each body's overall slump, its per-joint spread, and an offset in radians, so that no two corpses match. */
  slumpMin: 0.78,
  slumpMax: 1.15,
  jointSpread: 0.2,
  jointOffset: 0.12,
  strengthMin: 0.7,
  strengthMax: 1.3,

  /** Spin added to an arm and a leg by an impact of strength 1, in rad/s. */
  armSpin: 13,
  legSpin: 11,
  headSpin: 4,
  /** How far apart limbs land, as a multiple of the spin, and how far off-axis they go, as a share of it. */
  spinMin: 0.55,
  spinMax: 1.35,
  spinOffAxis: 0.3,
  /** Forearms and shins lag the joint above them by this share of its spin, so the limb bends as it goes. */
  lagMin: 0.08,
  lagMax: 0.35,
  /** Spin on a loose limb, which has no body to be thrown from. */
  limbSpin: 9,
  /** Change in body speed, in m/s, that counts as full strength, and the curve that keeps bullets small. */
  impactFull: 4,
  impactCurve: 1.5,
  /** Per-body radial blast strength that counts as full strength. */
  blastFull: 113,
  /** How far a blast is shared out by mass, not equally between bodies, 0..1. */
  blastEvenness: 0.9,
  /** A hit on a body already lying there moves less than one that catches it on its feet. */
  corpseImpact: 0.5,

  /** How long a collapse takes when the caller does not say. */
  collapseSeconds: 1.7,
  /** Fade of each role across the collapse, from start to end, as shares of its duration. */
  headFade: [0.02, 0.32],
  armFade: [0.1, 0.5],
  spineFade: [0.25, 0.65],
  legFade: [0.45, 1],
  /** The hand under the hips: it lets go before the legs do, so for a moment they carry real weight. */
  supportFade: [0.3, 0.8],
  /** Below this much support the body counts as falling, not standing. */
  standingSupport: 0.05,
  /** One leg gives out this much sooner, as a share of the duration. */
  weakLegLead: 0.14,
  /** How far a full-strength joint sags under the limb's own weight, in radians. */
  driveDroop: 0.1,
  driveDamping: 1.1,
  /** Share of a full correction each joint may make per step. Several joints act on each body at once, so they
   *  must not each try to do it all. */
  driveRelax: 0.9,
  /** Legs carry the body above them, not just themselves, by this share of its weight. */
  standShare: 0.6,
  /**
   * Share of the trunk's weight a collapse drops while its muscles still work, 0..1. At 1 a dying body held up a third of
   * its own weight and was lowered at a steady 0.6 to 0.8 m/s. At 0 the spine's muscles hold the chest up and hand its
   * weight down to the hips, where the hold and the legs carry it, so it sinks under its full weight from the first frame.
   * Left on the chest itself, that weight pitched it over the hold and turned the hips up to 1.1 rad off the animation's.
   * Arms and head still carry their own. 1 with `?weight=0`.
   */
  trunkCut: WEIGHT_PASS ? 0 : 1,
  /** Natural frequency and damping ratio of the hold on the hips. */
  hipRate: 11,
  hipDamping: 1,
  /** Point in the collapse where the feet stumble, how fast, and over how many seconds that speed comes in. */
  stumbleAt: 0.42,
  stumbleSpeed: 1.3,
  stumbleSeconds: 0.2,
  /** Above this speed, in m/s, a body staggers on the way it was going. Below it, anywhere. */
  stumbleOnward: 0.4,
  /** Spread on the stagger and the topple, so that no two go down alike. */
  fallSpreadMin: 0.7,
  fallSpreadMax: 1.25,
  /** Drift dies away at this rate, in 1/s, with nothing left to steer it. */
  driftDecay: 2.2,
  /**
   * Point where the torso tips the way it staggered, how hard, in m/s at full gravity (times `Rag.throwScale`), and over how
   * many seconds. Folded straight down, a body sits. Given in one frame, it was a hit.
   */
  toppleAt: 0.72,
  toppleSpeed: 1.6,
  toppleSeconds: 0.2,
  /** A hit during a collapse brings the end this much closer: time runs this many times faster from then on. */
  dropPace: 4,
  /** Hit strength between which a collapse starts to give up. Below it a bullet jolts the body, and it goes on dying. */
  dropFrom: 0.15,
  dropFull: 0.7,

  /**
   * A living body losing its balance (`KnockdownOptions.stumble`): the fade of each role, as a collapse's, in shares of the
   * stumble's seconds. The hold under the hips starts to go at once and carries the trunk's weight while it lasts, so the
   * weight comes onto the legs as it goes, before they give.
   */
  standFade: {
    support: [0, 0.7], leg: [0.35, 1], spine: [0.5, 1], arm: [0.7, 1], head: [0.7, 1],
  } as Readonly<Record<'support' | 'leg' | 'spine' | 'arm' | 'head', readonly [number, number]>>,
  /**
   * When it has lost it. Its weight is heading for a point on the floor, the capture point: where its centre of mass is, plus
   * its speed times the time a body that tall takes to tip, sqrt(height / gravity). A step reaches `stepReach` metres (times
   * the rig's size) from between the feet, and `balanceLost` steps away is out of reach.
   */
  stepReach: 0.55,
  balanceLost: 1.6,
  /** Or the chest is this far off upright, in radians. */
  tiltLost: 0.8,
  /** Or the hips are this many metres from where the animation has them: it is no longer the body that is stumbling. */
  hipGapLost: 0.3,
  /** Or its centre of mass is under this share of its standing height over its feet: its legs have gone. */
  sunkLost: 0.5,

  /** How hard the animation under a dying body flinches at a hit. Rounds all lean it the same way, and they add up fast. */
  collapseFlinch: 0.55,
  /** Share of a hit on a dying body that its feet carry, and how many times its real speed it gets. */
  carryShare: 0.75,
  carryGain: 0.7,
  /** Force in newton-seconds that jolts a living or dying body as hard as one can be, and the curve under it. */
  joltFull: 70,
  joltCurve: 0.6,
  /**
   * A jolt is a target spin per joint, sized from the joint's own inertia, so without this the same round turned a
   * Juggernaut's long arm as fast as a Trooper's and moved its hand nearly three times as far. It is times
   * `min(1.3, (HUMAN_MASS / mass) ** joltMassExp)`: 0.64 on a Brute, 0.30 on a Juggernaut, 1 on anything man-sized.
   * 0 with `?mass=0`.
   */
  joltMassExp: MASS_PASS ? 0.75 : 0,
  /** The same for the spin a blast gives the limbs (`kick` in `throwFromBlast`), at `min(1.3, (HUMAN_MASS / mass) ** this)`. */
  blastMassExp: MASS_PASS ? 1 : 0,
  /** Spin a jolt gives the struck limb, the joints up the chain from it, and the rest of the body, in rad/s. */
  joltSpin: 11,
  joltChain: 4.5,
  joltSpread: 5,
  /** Chance a joint up the chain kicks back the way the shot came. All one way, a stream of rounds just bends a body in half. */
  joltRebound: 0.4,
  /** Seconds the pulse lasts. A real flinch is over in the time it takes to see it. */
  joltLenMin: 0.07,
  joltLenMax: 0.15,
  /**
   * Share of a jolt left once the body has let go, and once its tone has gone as well. Flat on the floor the same torque
   * walks a body along it: at full strength an SMG moved one 5 m in 3 s.
   */
  joltLimp: 0.35,
  joltSpent: 0.15,

  /** Seconds that twitching lasts after the body goes limp. */
  twitchSeconds: 4.5,
  /** Nerves firing in mid-air read as a body still trying, so a twitch waits this long, then for the body to slow to this speed in m/s. */
  twitchAfter: 0.3,
  twitchLanded: 1.5,
  /** Seconds between bursts while fresh. The gaps stretch as twitching fades. */
  twitchGapMin: 0.28,
  twitchGapMax: 0.95,
  twitchLenMin: 0.1,
  twitchLenMax: 0.28,
  /**
   * Peak torque of a fresh burst as a share of the limb's weight on the joint, and how much of it is left at the end.
   * A limb lying on the floor does not stir below 1, so twitching fades by getting rarer and shorter, not weaker.
   */
  twitchTorque: 1.55,
  twitchFade: 0.65,
  /** Share of its length a burst still has at the very end. */
  twitchShorten: 0.6,
  /** Chance that a burst fires two limbs at once. */
  twitchPairChance: 0.35,
  /** Chance that a burst is instead an agonal spasm: the whole body straining against its resting pose. */
  spasmChance: 0.2,
  spasmLenMin: 0.45,
  spasmLenMax: 0.85,
  spasmTorque: 1.3,
  /** Spasms stop once twitching has this share of its life left. */
  spasmUntil: 0.4,
};

/** Scales an impulse in newton-seconds to the 0..1 strength of a rotational impact. */
export function impactStrength(force: number, mass: number): number {
  const t = MuscleTuning;
  return clamp((force * DevFlags.force) / mass / t.impactFull) ** t.impactCurve;
}

/** Scratch result of splitSwing. Swing axis is in the parent's frame. */
export const swingTwist = { angle: 0, twist: 0, x: 0, y: 0, z: 0, hasSwing: false };

const _tw = new THREE.Quaternion();
const _sw = new THREE.Quaternion();

/** Splits a relative rotation into twist about `axis` and the swing that remains. */
export function splitSwing(q: THREE.Quaternion, axis: THREE.Vector3): void {
  const out = swingTwist;
  const dot = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  const tw = _tw.set(axis.x * dot, axis.y * dot, axis.z * dot, q.w);
  const tl = Math.hypot(tw.x, tw.y, tw.z, tw.w);
  if (tl < 1e-6) tw.identity();
  else tw.set(tw.x / tl, tw.y / tl, tw.z / tl, tw.w / tl);
  let twist = 2 * Math.atan2(dot, q.w);
  if (twist > Math.PI) twist -= Math.PI * 2;
  else if (twist < -Math.PI) twist += Math.PI * 2;
  out.twist = twist;
  const swing = _sw.copy(tw).conjugate().premultiply(q);
  const sign = swing.w < 0 ? -1 : 1;
  const sl = Math.hypot(swing.x, swing.y, swing.z);
  out.angle = 2 * Math.atan2(sl, Math.abs(swing.w));
  out.hasSwing = sl > 1e-5;
  if (out.hasSwing) {
    out.x = (swing.x * sign) / sl;
    out.y = (swing.y * sign) / sl;
    out.z = (swing.z * sign) / sl;
  }
}

/** Swing reach of a ball joint in the direction it is heading. Hips and shoulders do not reach equally all ways. */
export function swingReach(part: RagPart, ax: number, az: number): number {
  const s = part.shape;
  if (!s) return part.cone;
  // Elliptical blend between the reach in each direction this swing is heading.
  const cx = ax > 0 ? s.back : s.forward;
  const cz = az * s.side > 0 ? s.out : s.in;
  return 1 / Math.sqrt((ax * ax) / (cx * cx) + (az * az) / (cz * cz) + 1e-6);
}

/** Per-joint muscle data. The root part carries one too: only `drive` and `role` mean anything there. */
export class JointMuscle {
  role: JointRole | null = null;
  /** Inertia of what this joint swings, in series with the rest of the chain. Rebuilt whenever the chain changes. */
  inertia = 1;
  /** Worst gravity torque the joint sees from what hangs off it, in newton-meters. */
  load = 1;
  /** `load`, plus the share of the body above that a standing leg must carry. */
  stand = 1;
  hasRelax = false;
  readonly relax = new THREE.Quaternion();
  relaxAngle = 0;
  /** This body's strength at this joint. */
  pull = 1;
  /** Hinge range in the same sense as hingeAngle. */
  lo = 0;
  hi = 0;
  readonly hingeAxis = new THREE.Vector3(1, 0, 0);
  /** Live animation target, relative to the parent. */
  readonly pose = new THREE.Quaternion();
  /** How much of the joint is still under the body's control, 0..1. */
  drive = 0;
  /** Stiffness over what it takes to hold this limb up, for a limb taking more than its own weight. */
  gain = 1;
  /** Snapped: no ligament, no tone, and no drive. Whatever hangs off it swings free. */
  broken = false;
}

/** A body that is still trying to stand. Runs the animator against a ghost root and hands joints their targets. */
export class CollapseDrive {
  time = 0;
  pace = 1;
  stumbled = false;
  toppled = false;
  /** How much the hips are still held, 0..1. */
  support = 1;
  readonly ghost = new THREE.Vector3();
  readonly drift = new THREE.Vector3();
  readonly facing = new THREE.Quaternion();
  readonly hipsLocal = new THREE.Vector3();
  readonly hipsAt = new THREE.Vector3();
  readonly hipsRot = new THREE.Quaternion();
  readonly local: THREE.Quaternion[];
  /** Which way the body staggers, chosen when it does. */
  readonly away = new THREE.Vector3();
  /** Seconds of the stagger and the topple still to come in, and how hard each is for this body. */
  stumbleLeft = 0;
  toppleLeft = 0;
  stumbleSpread = 1;
  toppleSpread = 1;
  weakLeg = 1;
  /** The leg that was shot goes first. Zero if it does not matter. */
  shotLeg = 0;
  /**
   * Not dying: a living body that has lost its balance and is failing to catch it (`KnockdownOptions.stumble`). Its fades are
   * `MuscleTuning.standFade`, it has no death stagger and no topple of its own, and it ends in the body's `Reflex`, not limp.
   */
  alive = false;

  /** Reads the pose and the root, so build this before the Rag takes them over. */
  constructor(
    readonly anim: CharacterAnimation,
    readonly root: THREE.Object3D,
    readonly bones: readonly THREE.Bone[],
    readonly duration: number,
    velocity: THREE.Vector3 | null | undefined,
  ) {
    this.ghost.copy(root.position);
    this.facing.copy(root.quaternion);
    if (velocity) this.drift.set(velocity.x, 0, velocity.z);
    this.hipsLocal.copy(bones[0]!.position);
    this.local = bones.map(b => b.quaternion.clone());
  }

  /** A hit, in m/s on the whole body, taken by the feet. */
  carry(dir: THREE.Vector3, speed: number): void {
    const gain = speed * MuscleTuning.carryShare * MuscleTuning.carryGain;
    this.drift.x += dir.x * gain;
    this.drift.z += dir.z * gain;
  }

  /** A flinch reads the character's yaw, and while the ragdoll has the root that is gone. */
  flinch(bone: number, dir: THREE.Vector3, magnitude: number): void {
    this.root.quaternion.copy(this.facing);
    this.anim.flinch(bone, dir, magnitude);
    this.root.quaternion.identity();
  }
}

const _rel = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _e = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _inv = new THREE.Quaternion();
const _d = new THREE.Vector3();
const _lever = new THREE.Vector3();
const _swing = new THREE.Vector3();
const _vec = { x: 0, y: 0, z: 0 };

/** Upward force in newtons one part of a body fighting up asks of the lift, for `mass` kilograms of it. */
function liftForce(part: RagPart, y: number, target: number, l: ReflexLift, mass: number): number {
  part.body.linvel(part.v);
  return clamp(l.force * clamp((target - y) / l.band) - l.damping * mass * part.v.y, 0, l.force);
}

/** Enough for a spasm to reach every joint of a person. */
const MAX_BURST = 12;
/** Pulses running at once. An SMG lands a round every 0.1 s, and each one sets off about three. Sized for faster fire than that. */
const MAX_JOLTS = 12;
const WEIGHT = -GRAVITY;

let nextSeed = 1;

/** Inverse inertia of a body about a world axis, from its principal moments. */
export function invInertia(part: RagPart, axis: THREE.Vector3): number {
  _inv.copy(part.q).multiply(part.frame).conjugate();
  _d.copy(axis).applyQuaternion(_inv);
  return _d.x * _d.x * part.invI.x + _d.y * _d.y * part.invI.y + _d.z * _d.z * part.invI.z;
}

/**
 * A ligament reaching full stretch: damping and stiffness that grow together the deeper it goes.
 *
 * Sized from the two bodies either side of the joint, never from all the limb hanging off it: four solver iterations
 * cannot pass a torque down a chain within one step, so anything larger overshoots and pumps energy in. The child
 * turns about the joint it hangs from, taking a linear impulse with the torque, because most of the momentum in a
 * swinging limb is its centre of mass travelling. That is a refinement: it takes a quarter off how far an arm runs
 * past its reach, and a pure torque here is stable and settles the same.
 */
function resist(
  c: RagPart, p: RagPart, axis: THREE.Vector3, sign: number, speed: number, depth: number, zone: number, dt: number, weight: number, hold: number, elastic: number,
): void {
  const t = MuscleTuning;
  const s = Math.min(depth / zone, t.limitOverdrive);
  const damping = t.limitDamping * s * s;
  const spring = t.limitSpring * s * s * s;
  const implicit = 1 / (1 + damping * dt + spring * dt * dt);
  const closing = speed * sign;
  // Implicit, so it stays stable however stiff it gets. Opening is damped too, which is what kills the rebound.
  // `hold` keeps a pose that began past the limit from being yanked back, but motion further out is always braked.
  const push = Math.min(spring * depth * dt * implicit, t.limitPushSpeed) * hold * elastic;
  const change = (push + damping * closing * dt * implicit * (closing > 0 ? 1 : hold)) * weight * sign;

  const lever = _lever.copy(c.com).applyQuaternion(c.q);
  const swing = _swing.crossVectors(axis, lever);
  const spinInertia = 1 / invInertia(c, axis);
  const pinned = spinInertia + c.mass * swing.lengthSq();
  const lambda = -change / (1 / pinned + invInertia(p, axis));
  const turn = lambda / pinned;
  c.tau.addScaledVector(axis, turn * spinInertia);
  c.push.addScaledVector(swing, turn * c.mass);
  p.tau.addScaledVector(axis, -lambda);
}

/** The rotation vector that takes `from` to `to`, both in the same frame. Written into `out`. */
function rotationBetween(from: THREE.Quaternion, to: THREE.Quaternion, out: THREE.Vector3): THREE.Vector3 {
  const e = _q2.copy(from).conjugate().premultiply(to);
  const sign = e.w < 0 ? -1 : 1;
  const s = Math.hypot(e.x, e.y, e.z);
  const k = s > 1e-6 ? (2 * Math.atan2(s, Math.abs(e.w)) * sign) / s : 2 * sign;
  return out.set(e.x * k, e.y * k, e.z * k);
}

/**
 * Why a living body's stumble ended. By itself: its momentum carried its weight past its feet, it leaned too far, its hips
 * left the animation's, its legs went from under it, its time was up, or it was told to stay on the floor (`prone`). From
 * outside: it lost a limb, a blast threw it, or it died on the way.
 */
export type BalanceLost = 'momentum' | 'tilt' | 'hips' | 'sunk' | 'clock' | 'prone' | 'limb' | 'thrown' | 'dead';

/** A living body's balance while it stumbles. See `MuscleTuning.balanceLost`. */
export interface Balance {
  /** Distance from between the feet to where its weight is heading, in steps (`MuscleTuning.stepReach`). */
  err: number;
  /** The chest off upright, in radians. */
  tilt: number;
  /** Metres between the hips and where the animation has them. */
  gap: number;
  /** Height of the centre of mass over the lower foot, as a share of standing. */
  height: number;
  /** What ended the stumble, or null while it lasts, and how far through its time that was. */
  lost: BalanceLost | null;
  at: number;
  /** The centre of mass's velocity at the last reading. */
  readonly speed: THREE.Vector3;
}

/** One short pulse across one joint. */
class Jolt {
  part: RagPart | null = null;
  readonly axis = new THREE.Vector3();
  /** Peak angular impulse per second. */
  size = 0;
  left = 0;
  length = 1;
}

/** Muscle state of one Rag. */
export class MuscleState {
  /** Seconds since the body let go of itself. Infinite on a corpse that was shot awake: it has no tone left. */
  limp = 0;
  /** Strength of death twitching, 0 once it is over. */
  twitch = 0;
  /** It has come to rest once, so it may twitch. Twitching throws it about too, and that must not stop it. */
  private onFloor = false;
  collapse: CollapseDrive | null = null;
  /** Alive and off its feet. See `reflex.ts`. */
  reflex: Reflex | null = null;
  private readonly jolts = Array.from({ length: MAX_JOLTS }, () => new Jolt());
  private joltAt = 0;
  /** Seconds until the last pulse ends. */
  private jolting = 0;
  private readonly rng: () => number;
  private readonly slump: number;
  private totalMass = 1;
  private meanMass = 1;
  /** Inertia of the whole chain about its root, for holding the hips. */
  private bodyInertia = 1;
  /** The shins, and where each one's lower end is in its own frame: what a body stands on, for reading its balance. */
  private readonly feet: { part: RagPart; at: THREE.Vector3 }[] = [];
  /** Height of the centre of mass over the feet, standing as the rig is bound. */
  private standCom = 1;
  /** The last reading of a living body's balance while it stumbles, and what ended the stumble. For tests and probes. */
  readonly balance: Balance = { err: 0, tilt: 0, gap: 0, height: 1, lost: null, at: 0, speed: new THREE.Vector3() };
  private readonly merged: { bone: number; rest: THREE.Quaternion }[] = [];
  private burstLeft = 0;
  private burstLength = 0;
  private burstWait = 0;
  private burstTorque = 0;
  private burstCount = 0;
  private readonly burstParts: (RagPart | null)[] = new Array<RagPart | null>(MAX_BURST).fill(null);
  private readonly burstAxes = Array.from({ length: MAX_BURST }, () => new THREE.Vector3());
  /** 0..1, how much resting tone is left. */
  private tone = 0;
  /** 0..1, how far ligaments have taken hold since the chain was built. */
  private hold = 0;
  /** 0..1, falling to nothing as a quiet body lets go of its limits. */
  private ligament = 1;
  /** 0..1, how much ligaments may push back as well as brake. */
  private elastic = 1;

  constructor(private readonly rag: Rag) {
    this.rng = mulberry32(nextSeed++ * 2654435761);
    this.slump = lerp(MuscleTuning.slumpMin, MuscleTuning.slumpMax, this.rng());
  }

  /** Each body has its own stream, so runs repeat. */
  random(): number {
    return this.rng();
  }

  /**
   * A blast moves a body as one mass. Equal impulses would give a forearm ten times the speed of the hips and fling
   * every limb straight back, leaving nothing for `kick` to do. The chain's total stays what it was.
   */
  blastShare(part: RagPart): number {
    return lerp(1, part.mass / this.meanMass, MuscleTuning.blastEvenness);
  }

  /** True while the body must not count as settled. */
  get busy(): boolean {
    return this.collapse !== null || this.reflex !== null || this.twitch > 0 || this.jolting > 0 || this.weightless;
  }

  /** True while muscles are moving the body themselves, so a sleeping one has to wake for them. */
  get driving(): boolean {
    return this.collapse !== null || this.reflex !== null || this.burstLeft > 0 || this.jolting > 0 || this.weightless;
  }

  /** How much of a joint's reaction the hold on the hips takes, which is none once nothing is holding them. */
  private get support(): number {
    return this.collapse?.support ?? 0;
  }

  /** Nothing presses a weightless body to rest, so stillness there says nothing about being finished. */
  private get weightless(): boolean {
    return this.rag.physics.world.gravity.y === 0;
  }

  /** True until the hips are let go: its feet are being walked, and a footfall is not a body landing. */
  get standing(): boolean {
    return this.collapse !== null && this.collapse.support > MuscleTuning.standingSupport;
  }

  /** Gives every part its joint data and works out what each joint carries. Call when the chain changes. */
  bind(): void {
    const { rag } = this;
    const { parts, info } = rag;
    const defs = rag.source.rig.bones;
    const t = MuscleTuning;
    this.burstLeft = 0;
    this.burstCount = 0;
    for (const j of this.jolts) j.left = 0;
    this.reflex?.bind();

    let total = 0;
    let legs = 0;
    let legMass = 0;
    for (const part of parts) {
      total += part.mass;
      const m = (part.muscle ??= this.makeJoint(part));
      if (m.role === 'leg') {
        legMass += part.mass;
        if (!part.hinge) legs++;
      }
    }
    this.totalMass = total;
    const above = total - legMass;
    this.meanMass = total / parts.length;
    for (const part of parts) part.body.userData = OWN_BLAST;
    // Sized for the weight that acts, so holding, standing, the resting pull and a twitch all match the tempo dial.
    const weight = WEIGHT * rag.gravity;

    const bind = info.bind;
    let rootInertia = 0;
    const r = parts[0]!;
    const ox = bind[r.bone * 3]!;
    const oy = bind[r.bone * 3 + 1]!;
    const oz = bind[r.bone * 3 + 2]!;
    for (const part of parts) {
      _a.set(bind[part.bone * 3]! - ox, bind[part.bone * 3 + 1]! - oy, bind[part.bone * 3 + 2]! - oz).add(part.com);
      rootInertia += part.mass * _a.lengthSq() + bodyInertia(part);
    }
    this.bodyInertia = Math.max(rootInertia, 1e-3);

    for (const c of parts) {
      if (!c.parent) continue;
      const m = c.muscle!;
      const jx = bind[c.bone * 3]!;
      const jy = bind[c.bone * 3 + 1]!;
      const jz = bind[c.bone * 3 + 2]!;
      let massBelow = 0;
      let inertiaBelow = 0;
      let inertiaAbove = 0;
      _b.set(0, 0, 0);
      for (const k of parts) {
        _a.set(bind[k.bone * 3]! - jx, bind[k.bone * 3 + 1]! - jy, bind[k.bone * 3 + 2]! - jz).add(k.com);
        const about = k.mass * _a.lengthSq() + bodyInertia(k);
        if (isBelow(k, c)) {
          massBelow += k.mass;
          inertiaBelow += about;
          _b.addScaledVector(_a, k.mass);
        } else {
          inertiaAbove += about;
        }
      }
      m.inertia = (inertiaBelow * inertiaAbove) / Math.max(inertiaBelow + inertiaAbove, 1e-6);
      m.load = Math.max(_b.length() * weight, 1e-3);
      m.stand = m.load;
      if (m.role === 'leg' && legs > 0) {
        // A leg's lever on the weight above it is short, because a standing leg is nearly straight.
        m.stand += t.standShare * (above / legs) * weight * (_b.length() / Math.max(massBelow, 1e-3));
      }
    }

    this.merged.length = 0;
    for (let i = 0; i < info.count; i++) {
      const relax = defs[i]!.relax;
      if (!relax || defs[i]!.ragdoll !== 'merge' || rag.mask[i] !== 1) continue;
      this.merged.push({ bone: i, rest: fromRotationVector(relax, new THREE.Quaternion()) });
    }

    // What it stands on: the lower end of each shin, which is the ankle, or the end of its capsule with no foot below it.
    this.feet.length = 0;
    let com = 0;
    let low = Infinity;
    for (const part of parts) {
      com += part.mass * (bind[part.bone * 3 + 1]! + part.com.y);
      if (!part.hinge || part.muscle!.role !== 'leg') continue;
      const at = new THREE.Vector3();
      const o = part.bone * 3;
      const foot = info.children[part.bone]![0];
      if (foot !== undefined && rag.mask[foot] === 1) at.set(bind[foot * 3]! - bind[o]!, bind[foot * 3 + 1]! - bind[o + 1]!, bind[foot * 3 + 2]! - bind[o + 2]!);
      else {
        const to = defs[part.bone]!.hit?.to;
        if (to) at.set(to[0], to[1], to[2]);
      }
      this.feet.push({ part, at });
      low = Math.min(low, bind[o + 1]! + at.y);
    }
    this.standCom = this.feet.length > 0 ? Math.max(com / total - low, 0.1) : 1;
  }

  /** The chain's gravity changed by `k`: a body killed in the air has landed. What each joint carries changes with it. */
  reweigh(k: number): void {
    for (const part of this.rag.parts) {
      const m = part.muscle;
      if (!m) continue;
      m.load *= k;
      m.stand *= k;
    }
  }

  private makeJoint(part: RagPart): JointMuscle {
    const { rng } = this;
    const t = MuscleTuning;
    const m = new JointMuscle();
    const def = this.rag.source.rig.bones[part.bone]!;
    const joint = def.joint;
    m.role = joint?.role ?? null;
    m.pull = lerp(t.strengthMin, t.strengthMax, rng());
    if (part.hinge) {
      const ax = joint?.axis ?? [1, 0, 0];
      m.hingeAxis.set(ax[0], ax[1], ax[2]);
      // Rig limits are stated child-to-parent, hingeAngle reads parent-to-child.
      m.lo = -(joint?.max ?? 0);
      m.hi = -(joint?.min ?? 0);
    }
    const relax = def.relax;
    if (relax) {
      m.hasRelax = true;
      const spread = this.slump * lerp(1 - t.jointSpread, 1 + t.jointSpread, rng());
      if (part.hinge) {
        const angle = (relax[0] * m.hingeAxis.x + relax[1] * m.hingeAxis.y + relax[2] * m.hingeAxis.z) * spread;
        m.relaxAngle = clamp(angle + lerp(-t.jointOffset, t.jointOffset, rng()), m.lo, m.hi);
        m.relax.setFromAxisAngle(m.hingeAxis, m.relaxAngle);
      } else {
        _a.set(
          relax[0] * spread + lerp(-t.jointOffset, t.jointOffset, rng()),
          relax[1] * spread + lerp(-t.jointOffset, t.jointOffset, rng()),
          relax[2] * spread + lerp(-t.jointOffset, t.jointOffset, rng()),
        );
        fromRotationVector([_a.x, _a.y, _a.z], m.relax);
      }
    }
    return m;
  }

  /** Runs before every physics sub-step, after Rag has read rotations and spins into its parts. */
  step(dt: number): void {
    const { rag } = this;
    const parts = rag.parts;
    const { tone, ligament } = this;
    const drive = this.collapse;
    for (let i = 0; i < parts.length; i++) {
      const c = parts[i]!;
      const p = c.parent;
      if (!p) continue;
      const m = c.muscle!;
      if (m.broken) continue;
      const q = _q.copy(p.q).conjugate().multiply(c.q);
      const rel = _rel.copy(c.w).sub(p.w);
      const free = 1 - m.drive;
      if (c.hinge) this.hinge(c, p, m, q, rel, ligament * free, tone * free, dt);
      else this.ball(c, p, m, q, rel, ligament * free, tone * free, dt);
    }
    if (this.twitch > 0) this.stepTwitch(dt);
    if (this.jolting > 0) this.stepJolts(dt);
    if (drive) this.holdHips(drive, dt);
    else if (this.reflex && this.reflex.lift.force > 0) this.lift(this.reflex.lift, dt);
  }

  /**
   * Called with the share of the chain's weight the lift carried, every sub-step it carries any. For tests: it must never
   * be more than `ReflexTuning.assistMax`.
   */
  static onLift: ((share: number) => void) | null = null;

  /**
   * The lift under a body fighting its way up (`Reflex.lift`): vertical impulses at the hips and the chest toward the heights
   * of the frame it pushes for, full `band` metres below them and nothing at them, damped, and never more than `force`
   * between them. An explicit impulse with a cap, like the hold on the hips, and never a joint torque.
   */
  private lift(l: ReflexLift, dt: number): void {
    const hips = this.rag.parts[0]!;
    const chest = l.chest !== hips ? l.chest : null;
    const half = this.totalMass * 0.5;
    hips.body.translation(hips.p);
    const up = liftForce(hips, hips.p.y, l.hipsY, l, half);
    let top = 0;
    if (chest) {
      chest.body.translation(chest.p);
      chest.body.rotation(chest.q);
      _d.copy(l.chestAt).applyQuaternion(chest.q).add(chest.p);
      top = liftForce(chest, _d.y, l.chestY, l, half);
    }
    const sum = up + top;
    if (sum <= 0) return;
    const k = (sum > l.force ? l.force / sum : 1) * dt;
    _vec.x = _vec.z = 0;
    _vec.y = up * k;
    if (_vec.y > 0) hips.body.applyImpulse(_vec, true);
    _vec.y = top * k;
    if (chest && _vec.y > 0) chest.body.applyImpulseAtPoint(_vec, _d, true);
    MuscleState.onLift?.((sum * k) / dt / (this.totalMass * WEIGHT * this.rag.gravity));
  }

  private hinge(c: RagPart, p: RagPart, m: JointMuscle, q: THREE.Quaternion, rel: THREE.Vector3, ligament: number, tone: number, dt: number): void {
    const t = MuscleTuning;
    const h = m.hingeAxis;
    let angle = 2 * Math.atan2(q.x * h.x + q.y * h.y + q.z * h.z, q.w);
    if (angle > Math.PI) angle -= Math.PI * 2;
    else if (angle < -Math.PI) angle += Math.PI * 2;
    const axis = _axis.copy(h).applyQuaternion(p.q);
    const speed = rel.dot(axis);
    if (ligament > 0) {
      const zone = Math.min(t.limitZone, (m.hi - m.lo) * t.limitZoneShare);
      if (angle < m.lo + zone) resist(c, p, axis, -1, speed, m.lo + zone - angle, zone, dt, ligament, this.hold, this.elastic);
      else if (angle > m.hi - zone) resist(c, p, axis, 1, speed, angle - m.hi + zone, zone, dt, ligament, this.hold, this.elastic);
    }
    if (tone > 0 && m.hasRelax) {
      const k = t.neutralRate * t.neutralRate * m.inertia * m.pull;
      const cap = t.neutralCap * m.load * m.pull;
      const impulse = clamp(k * (m.relaxAngle - angle), -cap, cap) * tone * dt;
      c.tau.addScaledVector(axis, impulse);
      p.tau.addScaledVector(axis, -impulse);
    }
    if (m.drive > 0) {
      const pose = m.pose;
      let target = 2 * Math.atan2(pose.x * h.x + pose.y * h.y + pose.z * h.z, pose.w);
      if (target > Math.PI) target -= Math.PI * 2;
      else if (target < -Math.PI) target += Math.PI * 2;
      const k = this.stiffness(m);
      const d = 2 * t.driveDamping * Math.sqrt(k * m.inertia);
      const back = 1 - this.support;
      const free = invInertia(c, axis) + back * invInertia(p, axis);
      const impulse = (t.driveRelax * (k * (target - angle) - d * speed) * dt) / (1 + (d * dt + k * dt * dt) * free);
      c.tau.addScaledVector(axis, impulse);
      p.tau.addScaledVector(axis, -impulse * back);
    }
  }

  private ball(c: RagPart, p: RagPart, m: JointMuscle, q: THREE.Quaternion, rel: THREE.Vector3, ligament: number, tone: number, dt: number): void {
    const t = MuscleTuning;
    if (ligament > 0) {
      splitSwing(q, c.axis);
      const st = swingTwist;
      const angle = st.angle;
      const twist = st.twist;
      if (st.hasSwing) {
        const reach = swingReach(c, st.x, st.z);
        const zone = Math.min(m.role === 'arm' ? t.shoulderZone : t.limitZone, reach * t.limitZoneShare);
        const depth = angle - reach + zone;
        if (depth > 0) {
          const axis = _axis.set(st.x, st.y, st.z).applyQuaternion(p.q);
          resist(c, p, axis, 1, rel.dot(axis), depth, zone, dt, ligament, this.hold, this.elastic);
        }
      }
      const weight = 1 - smoothstep(t.twistFadeStart, t.twistFadeEnd, angle);
      const zone = Math.min(t.limitZone, c.twist * t.limitZoneShare);
      const depth = Math.abs(twist) - c.twist + zone;
      if (depth > 0 && weight > 0) {
        const axis = _axis.copy(c.axis).applyQuaternion(p.q);
        const sign = twist < 0 ? -1 : 1;
        resist(c, p, axis, sign, rel.dot(axis), depth, zone, dt, ligament * weight, this.hold, this.elastic);
      }
    }
    if (tone > 0 && m.hasRelax) {
      const e = rotationBetween(q, m.relax, _e);
      const angle = e.length();
      if (angle > 1e-4) {
        const k = t.neutralRate * t.neutralRate * m.inertia * m.pull;
        const size = Math.min(k * angle, t.neutralCap * m.load * m.pull) * tone * dt;
        const axis = e.multiplyScalar(1 / angle).applyQuaternion(p.q);
        c.tau.addScaledVector(axis, size);
        p.tau.addScaledVector(axis, -size);
      }
    }
    if (m.drive > 0) {
      const e = rotationBetween(q, m.pose, _e).applyQuaternion(p.q);
      const k = this.stiffness(m);
      const d = 2 * t.driveDamping * Math.sqrt(k * m.inertia);
      // While the hips are held the hold takes the reaction, so every body answers to one controller. As support
      // fades the reaction lands on the parent, and what is left are true joint torques carrying real weight.
      const back = 1 - this.support;
      // Along the error, since a body offers far less inertia about some axes than others.
      const size = e.length();
      const free = size > 1e-5 ? invInertia(c, _a.copy(e).divideScalar(size)) + back * invInertia(p, _a) : 1 / m.inertia;
      const scale = (t.driveRelax * dt) / (1 + (d * dt + k * dt * dt) * free);
      const x = (k * e.x - d * rel.x) * scale;
      const y = (k * e.y - d * rel.y) * scale;
      const z = (k * e.z - d * rel.z) * scale;
      c.tau.x += x;
      c.tau.y += y;
      c.tau.z += z;
      p.tau.x -= x * back;
      p.tau.y -= y * back;
      p.tau.z -= z * back;
    }
  }

  private stiffness(m: JointMuscle): number {
    return (m.drive * m.gain * m.stand) / MuscleTuning.driveDroop;
  }

  /** Once a frame. Tone and ligaments change slowly, and jointless bones have no physics to keep up with. */
  advance(dt: number, bones: readonly THREE.Bone[]): void {
    const t = MuscleTuning;
    const { rag } = this;
    this.hold = Math.min(1, rag.age / t.limitRise);
    this.ligament = 1 - smoothstep(t.limitLetGoStart, t.limitLetGoEnd, rag.quiet);
    this.elastic = smoothstep(t.limitElasticLow, t.limitElasticHigh, rag.speed);
    if (this.collapse || this.reflex?.dying === -1) return;
    if (!this.weightless || this.limp < t.toneHold) this.limp += dt;
    const fade = smoothstep(0, t.toneRise, this.limp) * (1 - smoothstep(t.toneHold, t.toneHold + t.toneFade, this.limp));
    this.tone = rag.slack ? 0 : fade;
    if (fade <= 0) return;
    const k = 1 - Math.exp(-t.mergedRate * fade * dt);
    for (let i = 0; i < this.merged.length; i++) {
      const j = this.merged[i]!;
      bones[j.bone]!.quaternion.slerp(j.rest, k);
    }
  }

  /** A corpse shot awake moves, but it has no tone left to settle with. */
  spend(): void {
    this.limp = Infinity;
    this.tone = 0;
    this.twitch = 0;
    // A fresh chain: wherever the corpse lay is where it starts, even past a limit.
    this.hold = 0;
    this.ligament = 1;
  }

  /** The chain has left the world. */
  stop(): void {
    this.collapse = null;
    this.reflex = null;
    this.twitch = 0;
    this.jolting = 0;
    for (const j of this.jolts) j.left = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Rotational impact
  // -------------------------------------------------------------------------------------------

  /**
   * Throws the limbs as well as the torso. `dir` is the way the hit pushes. A blast in front of a body sends its
   * arms back with the blast and its legs forward, because the feet were resisting while the torso moved.
   */
  kick(dir: THREE.Vector3, hit: number): void {
    if (hit <= 0 || !Number.isFinite(hit + dir.x + dir.y + dir.z)) return;
    const { rag, rng } = this;
    const t = MuscleTuning;
    const parts = rag.parts;
    // A frozen corpse has given up its bodies, and a blast can still reach it.
    if (parts.length === 0) return;
    // Slower under less gravity, by the same share as a throw, so the limbs land as far apart.
    const strength = hit * rag.throwScale;
    rag.pushed = true;
    const first = parts[0]!;
    first.body.rotation(first.q);
    // Up along the body, not the world: a hit from above still throws the limbs of someone lying down.
    const up = _b.set(0, 1, 0).applyQuaternion(first.q);
    const axis = _axis.crossVectors(dir, up);
    if (axis.lengthSq() < 0.02) axis.set(rng() - 0.5, 0, rng() - 0.5).cross(up);
    axis.normalize();
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const role = part.muscle!.role;
      if (!part.parent) {
        // A loose limb has no torso to be thrown from, so it simply tumbles.
        if (rag.build.chainRoot !== 0) {
          _a.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize().multiplyScalar(t.limbSpin * strength * lerp(t.spinMin, t.spinMax, rng()));
          part.body.translation(part.p);
          this.spinLimb(part, _a, part.p);
        }
        continue;
      }
      // Hinges ride along with the joint above them.
      if (role === null || role === 'spine' || part.hinge) continue;
      const side = role === 'leg' ? -1 : 1;
      const spin = (role === 'arm' ? t.armSpin : role === 'leg' ? t.legSpin : t.headSpin) * strength * side * lerp(t.spinMin, t.spinMax, rng());
      const off = Math.abs(spin) * t.spinOffAxis;
      _a.copy(axis).multiplyScalar(spin);
      _a.x += (rng() - 0.5) * 2 * off;
      _a.y += (rng() - 0.5) * 2 * off;
      _a.z += (rng() - 0.5) * 2 * off;
      part.body.translation(part.p);
      this.spinLimb(part, _a, part.p);
    }
  }

  /**
   * Turns a limb about `pivot` as one piece. Spun alone, its top half would leave the rest behind: the elbow whips
   * round at twice the speed, hits its stop and drags the arm back the way it came. Each body also takes the speed
   * its centre of mass needs, because pure torque would turn it about that centre and the joint would fight it.
   */
  private spinLimb(top: RagPart, w: THREE.Vector3, pivot: THREE.Vector3): void {
    const { rag, rng } = this;
    const t = MuscleTuning;
    const px = pivot.x;
    const py = pivot.y;
    const pz = pivot.z;
    const parts = rag.parts;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (!isBelow(part, top)) continue;
      // The far end lags a little, which bends the joint between. It never snaps it straight.
      const share = part === top ? 1 : 1 - lerp(t.lagMin, t.lagMax, rng());
      part.body.translation(part.p);
      part.body.rotation(part.q);
      _e.copy(part.com).applyQuaternion(part.q).add(part.p);
      _e.x -= px;
      _e.y -= py;
      _e.z -= pz;
      _e.crossVectors(w, _e);
      _vec.x = _e.x * part.mass * share;
      _vec.y = _e.y * part.mass * share;
      _vec.z = _e.z * part.mass * share;
      part.body.applyImpulse(_vec, true);
      const inertia = bodyInertia(part) * share;
      _vec.x = w.x * inertia;
      _vec.y = w.y * inertia;
      _vec.z = w.z * inertia;
      part.body.applyTorqueImpulse(_vec, true);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Collapse
  // -------------------------------------------------------------------------------------------

  /** True if this chain has legs to stand on. Anything else just drops. */
  canStand(): boolean {
    for (const part of this.rag.parts) if (part.muscle!.role === 'leg') return true;
    return false;
  }

  startCollapse(drive: CollapseDrive): void {
    drive.weakLeg = drive.shotLeg || (this.rng() < 0.5 ? 1 : -1);
    this.collapse = drive;
    this.limp = 0;
    this.tone = 1;
    if (drive.alive) {
      const b = this.balance;
      b.err = b.tilt = b.gap = b.at = 0;
      b.height = 1;
      b.lost = null;
      b.speed.copy(drive.drift);
    }
    this.sampleStrengths(drive);
    this.readPose(drive);
  }

  /** Something hit a body that was going down anyway. It stops trying. */
  dropNow(): void {
    if (this.collapse) this.collapse.pace = MuscleTuning.dropPace;
  }

  /**
   * The same for a hit of this strength, 0..1. Bullets must not end a collapse, or a body under fire goes down faster the
   * more it is shot, and there is nothing left to see. They jolt it, and it goes on dying at the rate it was.
   */
  struck(strength: number): void {
    const t = MuscleTuning;
    const c = this.collapse;
    if (c) c.pace = Math.max(c.pace, lerp(1, t.dropPace, smoothstep(t.dropFrom, t.dropFull, strength)));
  }

  /** Alive, and from now on working out its own pose. */
  startReflex(reflex: Reflex): void {
    this.reflex = reflex;
    this.limp = 0;
    this.tone = 1;
  }

  /** Runs once a frame, after Rag.measure. */
  sampleReflex(dt: number): void {
    const r = this.reflex;
    if (!r) return;
    // A living body still on its feet follows its stumble, and the Reflex waits until it loses them.
    const drive = this.collapse;
    if (drive) {
      if (!drive.alive || dt <= 0) return;
      const lost = this.readBalance(drive);
      if (!lost) return;
      this.fallOver(drive, lost);
    }
    r.sample(dt);
    if (r.dying !== 0) return;
    this.letGo();
    // Already at full tone: it must not dip and rise again as the drive lets go.
    this.limp = MuscleTuning.toneRise;
  }

  /**
   * Where a stumbling body's weight is heading against where its feet are, read once a frame from what `Rag.drive` and
   * `Rag.measure` have just read. Returns what has cost it its feet, or null while it is still on them.
   */
  private readBalance(drive: CollapseDrive): BalanceLost | null {
    const t = MuscleTuning;
    const { rag, balance, feet } = this;
    const parts = rag.parts;
    let x = 0;
    let y = 0;
    let z = 0;
    let vx = 0;
    let vy = 0;
    let vz = 0;
    let mass = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      _a.copy(part.com).applyQuaternion(part.q).add(part.p);
      x += _a.x * part.mass;
      y += _a.y * part.mass;
      z += _a.z * part.mass;
      vx += part.v.x * part.mass;
      vy += part.v.y * part.mass;
      vz += part.v.z * part.mass;
      mass += part.mass;
    }
    x /= mass;
    y /= mass;
    z /= mass;
    balance.speed.set(vx / mass, vy / mass, vz / mass);
    if (drive.time >= drive.duration) return 'clock';
    // Told to stay on the floor while it stumbled (a wound, `setPosture`): the animation under it is lying down.
    if (drive.anim.prone) return 'prone';
    if (feet.length === 0) return 'sunk';
    let fx = 0;
    let fz = 0;
    let low = Infinity;
    for (let i = 0; i < feet.length; i++) {
      const f = feet[i]!;
      _a.copy(f.at).applyQuaternion(f.part.q).add(f.part.p);
      fx += _a.x;
      fz += _a.z;
      low = Math.min(low, _a.y);
    }
    fx /= feet.length;
    fz /= feet.length;
    const scale = rag.source.rig.height / HUMAN_HEIGHT;
    const h = Math.max(y - low, 0.05);
    // The time a body this tall takes to tip, under the gravity it falls at. The catch steps carry it at the drift for as long
    // as the legs taking them work, so what they cannot catch is the speed it has over that share of it. Read against the
    // feet alone, a body reeling at 4 m/s had lost it on its first frame, before a single step; with the whole drift taken
    // off, it never lost it to momentum at all, only by leaning over.
    let legs = 0;
    let n = 0;
    for (let i = 0; i < parts.length; i++) {
      const m = parts[i]!.muscle!;
      if (m.role !== 'leg') continue;
      legs += m.drive;
      n++;
    }
    const carried = n > 0 ? legs / n : 0;
    const tip = Math.sqrt(h / (WEIGHT * rag.gravity));
    const ox = (balance.speed.x - drive.drift.x * carried) * tip;
    const oz = (balance.speed.z - drive.drift.z * carried) * tip;
    balance.err = Math.hypot(x + ox - fx, z + oz - fz) / (t.stepReach * scale);
    balance.height = h / this.standCom;
    // Off the chest its stumble asks for, not off upright: a hard stumble leans the animated chest 0.7 to 0.86 rad by itself in
    // its first fifth of a second, and read off upright that ended it before its first step.
    const chest = this.firstJoint() ?? parts[0]!;
    // The animation's chest in the world: down the chain from the hips, joint target by joint target.
    _q.identity();
    for (let p: RagPart | null = chest; p?.parent; p = p.parent) _q.premultiply(p.muscle!.pose);
    _q.premultiply(drive.hipsRot);
    _a.set(0, 1, 0).applyQuaternion(_q);
    balance.tilt = Math.acos(clamp(_b.set(0, 1, 0).applyQuaternion(chest.q).dot(_a), -1, 1));
    balance.gap = parts[0]!.p.distanceTo(drive.hipsAt);
    if (balance.err > t.balanceLost) return 'momentum';
    if (balance.tilt > t.tiltLost) return 'tilt';
    if (balance.gap > t.hipGapLost * scale) return 'hips';
    if (balance.height < t.sunkLost) return 'sunk';
    return null;
  }

  /**
   * A living body's stumble ends: its feet are no longer under it. The `Reflex` takes the same chain on from where it is, every
   * muscle at the strength the stumble left it, and falls the way its weight was going. Nothing is zeroed and nothing is
   * built: there is no switch to see.
   */
  private fallOver(drive: CollapseDrive, lost: BalanceLost): void {
    const parts = this.rag.parts;
    const g = this.rag.gravity;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const m = part.muscle!;
      if (!part.parent) m.drive = 0;
      // The hold has gone and the trunk's weight is its own again. The Reflex writes gravity for arms and head, and for
      // legs once the body is down; never for the hips or the chest.
      if (!part.parent || m.role === 'spine' || m.role === 'leg') part.body.setGravityScale(g, false);
    }
    this.collapse = null;
    this.balance.lost = lost;
    this.balance.at = drive.time / drive.duration;
    this.reflex?.offFeet(this.balance.speed, lost === 'thrown');
  }

  /**
   * Takes a stumbling body off its feet now, whatever its balance: it has lost a limb, a blast has thrown it, or it has died
   * on the way, which carries on from where the body is. False, and nothing done, for a body that is not stumbling.
   */
  loseFooting(why: BalanceLost): boolean {
    const drive = this.collapse;
    if (!drive?.alive) return false;
    this.fallOver(drive, why);
    return true;
  }

  /**
   * Every muscle gone on this frame, whatever the body was doing: a collapse ends where it stands, and nothing twitches.
   * `letGo` is the same for a body that was down and alive.
   */
  giveUp(): void {
    if (this.collapse) this.endCollapse();
    this.twitch = 0;
  }

  /** A body down and alive stops being one. What it was doing with its limbs ends here. */
  letGo(): void {
    if (!this.reflex) return;
    this.reflex = null;
    const g = this.rag.gravity;
    for (const part of this.rag.parts) {
      part.muscle!.drive = 0;
      part.muscle!.gain = 1;
      part.body.setGravityScale(g, true);
    }
  }

  /**
   * Tips the upper body by this speed, in m/s. Internal to nothing: this is momentum, and it is meant to be. Slower under
   * less gravity, by `Rag.throwScale`, so it goes over as far.
   */
  tip(speed: THREE.Vector3): void {
    const parts = this.rag.parts;
    const k = this.rag.throwScale;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const role = part.muscle!.role;
      if (role === 'leg' || !part.parent) continue;
      _vec.x = speed.x * k * part.mass;
      _vec.y = speed.y * k * part.mass;
      _vec.z = speed.z * k * part.mass;
      part.body.applyImpulse(_vec, true);
    }
    this.rag.pushed = true;
  }

  // -------------------------------------------------------------------------------------------
  // Jolts
  // -------------------------------------------------------------------------------------------

  /**
   * A round going into a body with something still alive in it. All of this is torque across joints, each with its
   * reaction on the parent, so it moves the limbs against each other and cannot move the body as a whole. That is what
   * lets twenty rounds a second make it dance without throwing it across the room.
   */
  jolt(bone: number, point: THREE.Vector3, dir: THREE.Vector3, strength: number): void {
    const { rag, rng } = this;
    const t = MuscleTuning;
    const parts = rag.parts;
    // Spent, or on a limb with nothing above it, there is no joint for this to work across.
    if (parts.length < 2 || strength <= 0 || !Number.isFinite(strength + dir.x + dir.y + dir.z)) return;
    const size = strength * (this.collapse || this.reflex ? 1 : this.tone > 0 ? t.joltLimp : t.joltSpent);
    let part: RagPart | null = rag.partFor(bone);
    part.body.translation(part.p);
    // The struck limb turns about its joint, away from the shot.
    _lever.copy(point).sub(part.p);
    _axis.crossVectors(_lever, dir);
    if (_axis.lengthSq() < 1e-6) _axis.set(rng() - 0.5, rng() - 0.5, rng() - 0.5);
    _axis.normalize();
    if (part.parent) this.addJolt(part, _axis, t.joltSpin * size);
    // And it travels up the chain, so a shot in the arm is felt in the shoulder and a shot in the belly doubles the body.
    for (let up = part.parent ?? this.firstJoint(); up?.parent; up = up.parent) {
      this.addJolt(up, _axis, t.joltChain * size * (rng() < t.joltRebound ? -1 : 1));
    }
    // The rest of the body flinches with it, and which part does is what keeps it from looking like a machine.
    for (let i = 0; i < 2; i++) {
      part = parts[Math.floor(rng() * parts.length)]!;
      if (!part.parent) continue;
      _a.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
      this.addJolt(part, _a, t.joltSpread * size);
    }
  }

  private firstJoint(): RagPart | null {
    const parts = this.rag.parts;
    for (let i = 0; i < parts.length; i++) if (parts[i]!.muscle!.role === 'spine') return parts[i]!;
    return null;
  }

  /**
   * One pulse across the joint above `bone`, about `axis` (world, unit), toward `spin` rad/s, and nothing else: no chain and no
   * flinch elsewhere. A round in the face snaps the head back on its neck, where `jolt` would whip the chest back harder than
   * the head, which then lags it and reads as a nod. Sized from the joint's own inertia like every jolt, so it cannot overshoot.
   */
  whip(bone: number, axis: THREE.Vector3, spin: number): void {
    const part = this.rag.partFor(bone);
    if (!part.parent || !(spin > 0) || !Number.isFinite(axis.x + axis.y + axis.z)) return;
    this.addJolt(part, axis, spin);
  }

  private addJolt(part: RagPart, axis: THREE.Vector3, spin: number): void {
    const t = MuscleTuning;
    const j = this.jolts[this.joltAt = (this.joltAt + 1) % MAX_JOLTS]!;
    j.part = part;
    j.axis.copy(axis);
    j.length = j.left = lerp(t.joltLenMin, t.joltLenMax, this.rng());
    // A sine squared carries half its peak over its length, and the joint's own inertia sizes it, so it cannot overshoot.
    j.size = (part.muscle!.inertia * spin * 2) / j.length;
    this.jolting = Math.max(this.jolting, j.length);
  }

  private stepJolts(dt: number): void {
    this.jolting -= dt;
    for (let i = 0; i < MAX_JOLTS; i++) {
      const j = this.jolts[i]!;
      if (j.left <= 0) continue;
      j.left -= dt;
      const c = j.part!;
      const p = c.parent;
      if (!p) continue;
      const wave = Math.sin(Math.PI * clamp(1 - j.left / j.length));
      const impulse = j.size * wave * wave * dt;
      c.tau.addScaledVector(j.axis, impulse);
      p.tau.addScaledVector(j.axis, -impulse);
    }
  }

  /** Runs once a frame, before Rag.drive. Moves the ghost, runs the animator, reads the joint targets. */
  sampleCollapse(dt: number): void {
    const drive = this.collapse;
    // Animators divide by the step, and a paused game has none.
    if (!drive || dt <= 0) return;
    const t = MuscleTuning;
    drive.time += dt * drive.pace;
    const u = drive.time / drive.duration;
    // A living body's stumble ends in its Reflex, once the frame has been measured (`sampleReflex`), and until then it goes
    // on following the stumble its animator was given: no death stagger, and no topple but its own weight.
    if (!drive.alive) {
      if (u >= 1) {
        this.endCollapse();
        return;
      }
      if (!drive.stumbled && u >= t.stumbleAt) this.stumble(drive);
      if (!drive.toppled && u >= t.toppleAt) this.topple(drive);
      // On the collapse's own clock, so one a hit has hurried still gets all of both before it ends.
      this.easeFall(drive, dt * drive.pace);
    }
    drive.ghost.addScaledVector(drive.drift, dt);
    drive.drift.multiplyScalar(Math.exp(-t.driftDecay * dt));

    const { root, bones, local } = drive;
    root.position.copy(drive.ghost);
    root.quaternion.copy(drive.facing);
    // Rag.drive wrote physics into these. An animator that does not touch a bone must leave its target alone.
    for (let i = 0; i < local.length; i++) bones[i]!.quaternion.copy(local[i]!);
    bones[0]!.position.copy(drive.hipsLocal);
    drive.anim.update(dt, 0);
    for (let i = 0; i < local.length; i++) local[i]!.copy(bones[i]!.quaternion);
    drive.hipsLocal.copy(bones[0]!.position);
    root.quaternion.identity();

    this.sampleStrengths(drive);
    this.readPose(drive);
  }

  private stumble(drive: CollapseDrive): void {
    const { rng } = this;
    drive.stumbled = true;
    // Onward if it was moving, along the shot if it was shot, somewhere random if neither. The animator takes real steps to keep up.
    const speed = Math.hypot(drive.drift.x, drive.drift.z);
    if (speed > MuscleTuning.stumbleOnward) drive.away.set(drive.drift.x / speed, 0, drive.drift.z / speed);
    else if (drive.away.lengthSq() < 1e-6) {
      const a = rng() * Math.PI * 2;
      drive.away.set(Math.cos(a), 0, Math.sin(a));
    }
    drive.stumbleSpread = this.spread();
    drive.stumbleLeft = MuscleTuning.stumbleSeconds;
  }

  private spread(): number {
    return lerp(MuscleTuning.fallSpreadMin, MuscleTuning.fallSpreadMax, this.rng());
  }

  private topple(drive: CollapseDrive): void {
    drive.toppled = true;
    drive.toppleSpread = this.spread();
    drive.toppleLeft = MuscleTuning.toppleSeconds;
  }

  /**
   * The stagger and the topple come in over a moment, never in one frame: nothing a hit does to a body that is still
   * following its animation may land at once. `dt` is collapse time, so a collapse a hit has hurried four times over takes
   * them in 0.05 s, three frames. One ended outright, by a round in the head, keeps what it had of them.
   */
  private easeFall(drive: CollapseDrive, dt: number): void {
    const t = MuscleTuning;
    if (drive.stumbleLeft > 0) {
      const k = Math.min(dt, drive.stumbleLeft) / t.stumbleSeconds;
      drive.stumbleLeft -= dt;
      drive.drift.addScaledVector(drive.away, t.stumbleSpeed * drive.stumbleSpread * k);
    }
    if (drive.toppleLeft > 0) {
      const k = Math.min(dt, drive.toppleLeft) / t.toppleSeconds;
      drive.toppleLeft -= dt;
      // Whatever sits on the spine goes over, and takes the rest with it. Slower under less gravity, as far.
      const parts = this.rag.parts;
      const speed = t.toppleSpeed * this.rag.throwScale;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        if (part.muscle!.role !== 'spine') continue;
        const push = part.mass * speed * drive.toppleSpread * k;
        _vec.x = drive.away.x * push;
        _vec.y = 0;
        _vec.z = drive.away.z * push;
        part.body.applyImpulse(_vec, true);
      }
    }
  }

  private sampleStrengths(drive: CollapseDrive): void {
    const t = MuscleTuning;
    const u = drive.time / drive.duration;
    // A living body losing its balance fades on its own table: the hold first, then the legs, and the arms and head last.
    const stand = drive.alive ? t.standFade : null;
    drive.support = fade(stand ? stand.support : t.supportFade, u, 0);
    const parts = this.rag.parts;
    const g = this.rag.gravity;
    let root: RagPart | null = null;
    let carried = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const m = part.muscle!;
      if (!part.parent) {
        m.drive = drive.support;
      } else if (m.role === 'leg') {
        const side = this.rag.info.bind[part.bone * 3]! >= 0 ? 1 : -1;
        m.drive = fade(stand ? stand.leg : t.legFade, u, side === drive.weakLeg ? t.weakLegLead : 0);
      } else if (stand) {
        m.drive = fade(m.role === 'head' ? stand.head : m.role === 'arm' ? stand.arm : stand.spine, u, 0);
      } else {
        m.drive = fade(m.role === 'head' ? t.headFade : m.role === 'arm' ? t.armFade : t.spineFade, u, 0);
      }
      // A muscle that still works carries its own weight, which the solver then does not have to fight for it. Not the
      // legs, whose feet need their weight on the floor for friction. The spine's muscles hand theirs down to the hips.
      if (!part.parent) {
        root = part;
        continue;
      }
      part.body.setGravityScale(g * (m.role === 'leg' ? 1 : 1 - m.drive), false);
      if (m.role === 'spine') carried += part.mass * m.drive;
    }
    // The hips take the trunk's weight, and the hold and the legs under them carry it: the body goes down under its whole
    // weight, with nothing bending the chest over.
    // On its feet and alive, the hold carries the trunk's weight while it lasts, so the legs take catch steps instead of
    // carrying a body that sinks onto them: handed to the hips as a dying body's is, it sank 0.1 m in the first 0.15 s, the
    // swinging foot dragged on the floor, and a leg it then landed on stopped the hips' fall by up to 1.3 m/s in a frame.
    const cut = drive.alive ? 1 : t.trunkCut;
    if (root) root.body.setGravityScale(g * (1 - cut * root.muscle!.drive + ((1 - cut) * carried) / root.mass), false);
  }

  /** Reads joint targets out of the bones the animator just wrote. */
  private readPose(drive: CollapseDrive): void {
    const parts = this.rag.parts;
    const defs = this.rag.source.rig.bones;
    const local = drive.local;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const parent = part.parent;
      if (!parent) continue;
      const pose = part.muscle!.pose;
      pose.identity();
      for (let b = part.bone; b !== parent.bone; b = defs[b]!.parent) pose.premultiply(local[b]!);
    }
    drive.hipsAt.copy(drive.hipsLocal).applyQuaternion(drive.facing).add(drive.ghost);
    drive.hipsRot.copy(drive.facing).multiply(local[0]!);
  }

  /** The body is too tall to balance on torque alone. Something has to keep the hips where the animation has them. */
  private holdHips(drive: CollapseDrive, dt: number): void {
    const t = MuscleTuning;
    const a = drive.support;
    if (a <= 0) return;
    const hips = this.rag.parts[0]!;
    hips.body.translation(hips.p);
    hips.body.linvel(hips.v);
    const w = t.hipRate;
    const k = this.totalMass * w * w * a;
    const d = this.totalMass * 2 * t.hipDamping * w * a;
    // Sized for the whole body but applied to one small piece of it, so the hips' own mass bounds the gain.
    const scale = dt / (1 + (d * dt + k * dt * dt) / hips.mass);
    _vec.x = (k * (drive.hipsAt.x - hips.p.x) - d * (hips.v.x - drive.drift.x)) * scale;
    _vec.y = (k * (drive.hipsAt.y - hips.p.y) - d * hips.v.y) * scale;
    _vec.z = (k * (drive.hipsAt.z - hips.p.z) - d * (hips.v.z - drive.drift.z)) * scale;
    hips.body.applyImpulse(_vec, true);

    const e = rotationBetween(hips.q, drive.hipsRot, _e);
    const size = e.length();
    if (size < 1e-5) return;
    const ki = this.bodyInertia * w * w * a;
    const di = this.bodyInertia * 2 * t.hipDamping * w * a;
    const spin = (t.driveRelax * dt) / (1 + (di * dt + ki * dt * dt) * invInertia(hips, _a.copy(e).divideScalar(size)));
    hips.tau.x += (ki * e.x - di * hips.w.x) * spin;
    hips.tau.y += (ki * e.y - di * hips.w.y) * spin;
    hips.tau.z += (ki * e.z - di * hips.w.z) * spin;
  }

  private endCollapse(): void {
    const parts = this.rag.parts;
    const g = this.rag.gravity;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      part.muscle!.drive = 0;
      part.body.setGravityScale(g, true);
    }
    this.collapse = null;
    // Already at full tone: it must not dip and rise again as the drive lets go.
    this.limp = MuscleTuning.toneRise;
  }

  // -------------------------------------------------------------------------------------------
  // Twitching
  // -------------------------------------------------------------------------------------------

  /** Starts the twitching of a body that died too fast for its nerves to find out. */
  startTwitch(strength: number): void {
    this.twitch = clamp(strength);
    this.burstLeft = 0;
    this.burstWait = lerp(0.1, MuscleTuning.twitchGapMin, this.rng());
  }

  private stepTwitch(dt: number): void {
    const t = MuscleTuning;
    const life = 1 - this.limp / t.twitchSeconds;
    if (life <= 0) {
      this.twitch = 0;
      return;
    }
    if (this.collapse || !this.landed()) return;
    if (this.burstLeft <= 0) {
      this.burstWait -= dt;
      if (this.burstWait <= 0) this.startBurst(life);
      return;
    }
    this.burstLeft -= dt;
    const u = 1 - this.burstLeft / this.burstLength;
    // Sine-squared ends at zero torque and zero slope, which is what separates a spasm from jitter.
    const wave = Math.sin(Math.PI * clamp(u));
    const size = this.burstTorque * this.twitch * lerp(t.twitchFade, 1, life) * wave * wave * dt;
    for (let i = 0; i < this.burstCount; i++) {
      const c = this.burstParts[i]!;
      const p = c.parent!;
      const axis = _axis.copy(this.burstAxes[i]!).applyQuaternion(p.q);
      const impulse = size * c.muscle!.load;
      c.tau.addScaledVector(axis, impulse);
      p.tau.addScaledVector(axis, -impulse);
    }
    if (this.burstLeft <= 0) this.burstWait = lerp(t.twitchGapMin, t.twitchGapMax, this.rng()) / Math.max(life, 0.6);
  }

  private landed(): boolean {
    const t = MuscleTuning;
    this.onFloor ||= this.rag.age >= t.twitchAfter && this.rag.speed < t.twitchLanded;
    return this.onFloor;
  }

  private startBurst(life: number): void {
    const { rng } = this;
    const t = MuscleTuning;
    const parts = this.rag.parts;
    this.burstCount = 0;
    if (life > t.spasmUntil && rng() < t.spasmChance) {
      this.burstTorque = t.spasmTorque;
      this.burstLength = lerp(t.spasmLenMin, t.spasmLenMax, rng()) * lerp(t.twitchShorten, 1, life);
      // The whole body strains the wrong way: back arching, limbs straightening against the resting pose.
      for (let i = 0; i < parts.length && this.burstCount < MAX_BURST; i++) {
        const part = parts[i]!;
        const m = part.muscle!;
        if (!part.parent || !m.hasRelax) continue;
        const axis = this.burstAxes[this.burstCount]!;
        if (part.hinge) axis.copy(m.hingeAxis).multiplyScalar(m.relaxAngle > 0 ? -1 : 1);
        else axis.set(-m.relax.x, -m.relax.y, -m.relax.z).normalize();
        this.burstParts[this.burstCount++] = part;
      }
    } else {
      this.burstTorque = t.twitchTorque;
      this.burstLength = lerp(t.twitchLenMin, t.twitchLenMax, rng()) * lerp(t.twitchShorten, 1, life);
      const want = rng() < t.twitchPairChance ? 2 : 1;
      for (let tries = 0; tries < 8 && this.burstCount < want; tries++) {
        const part = parts[Math.floor(rng() * parts.length)]!;
        const m = part.muscle!;
        if (!part.parent || (m.role !== 'arm' && m.role !== 'leg')) continue;
        const axis = this.burstAxes[this.burstCount]!;
        const sign = rng() < 0.5 ? -1 : 1;
        if (part.hinge) axis.copy(m.hingeAxis).multiplyScalar(sign);
        else axis.set(sign, 0, (rng() - 0.5) * 0.8).normalize();
        this.burstParts[this.burstCount++] = part;
      }
    }
    this.burstLeft = this.burstCount > 0 ? this.burstLength : 0;
    if (this.burstCount === 0) this.burstWait = t.twitchGapMin;
  }
}

/** Strength left at `u` through a collapse, for a fade given as shares of its duration. */
function fade(window: readonly number[], u: number, lead: number): number {
  return 1 - smoothstep(window[0]! - lead, window[1]! - lead, u);
}

function fromRotationVector(v: readonly [number, number, number], out: THREE.Quaternion): THREE.Quaternion {
  const angle = Math.hypot(v[0], v[1], v[2]);
  if (angle < 1e-6) return out.identity();
  return out.setFromAxisAngle(_e.set(v[0] / angle, v[1] / angle, v[2] / angle), angle);
}

/** Mean moment of inertia of one body about its own centre of mass. */
function bodyInertia(part: RagPart): number {
  return 3 / Math.max(part.invI.x + part.invI.y + part.invI.z, 1e-6);
}

function isBelow(part: RagPart, joint: RagPart): boolean {
  for (let a: RagPart | null = part; a; a = a.parent) if (a === joint) return true;
  return false;
}
