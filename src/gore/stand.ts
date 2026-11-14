/**
 * Catching balance: a living body on its muscles and on its feet after a hard hit it might recover from.
 *
 * It runs on the drive a body losing its balance runs on (`CollapseDrive.alive`, `KnockdownOptions.stumble`), but nothing
 * here fades on a clock. The hold under the hips and the pins on the feet are as strong as the balance the body has left:
 * a budget the hit set, which every footfall and every further hit spends, and how far its weight is heading from its feet.
 * While they hold, the feet follow the animator's catch steps and the body follows the feet. When they go, it goes over, on
 * the same ragdoll (`MuscleState.fallOver`). If it comes to rest on its feet first, gore hands it back to the animation
 * mid-stride. `?stand=0` switches all of it off.
 */
import { clamp, lerp, smoothstep } from '../core/math';
import type { LimbStrength } from './muscles';

export const StandTuning = {
  /** A step reaches this far from between the feet, in metres times the rig's size. */
  stepReach: 0.55,
  /** Capture point error, in steps, where the hold starts to go, and where the body has lost it. */
  balanceFrom: 0.6,
  giveUp: 1.6,
  /** Budget a footfall costs, and a hit, per share of the body's health it took. */
  perStep: 0.06,
  hitCost: 0.5,
  /** Footfalls it may take to catch itself, and seconds. Past either it has not caught itself, and goes over. */
  maxSteps: 5,
  maxSeconds: 2.5,
  /** Chest this far off where its animation has it, in radians, or hips this many metres from theirs: it goes over. */
  abortTilt: 0.8,
  knockOut: 0.3,
  /** With this little hold left there is nothing holding it up. */
  spent: 0.1,
  /** A frame longer than this, in seconds, is a hitch: where the body is against its animation is not read on it. */
  slowFrame: 0.034,
  /** Caught: slower than this and turning slower than this for `stableHold` seconds, at least `minStand` after the hit. */
  stableSpeed: 0.45,
  stableSpin: 0.6,
  stableHold: 0.2,
  minStand: 0.35,
  /** And with its weight this well over its feet (1 is over them), and its hips this close to the animation's, in metres. */
  stableBalance: 0.8,
  stableGap: 0.1,
  /** Seconds the animation takes to blend out of the pose it is handed back in. */
  standBlend: 0.25,
  /**
   * The whiplash at impact: arms, spine and head restart this weak at a hit that changes the body's speed by `pinYieldFull`,
   * in proportion for less, and come back to `holdDrive` over `rampSeconds`.
   */
  startDrive: 0.25,
  holdDrive: 0.85,
  rampSeconds: 0.2,
  legDrive: 0.85,
  /** A hit that changes the body's speed by this much, in m/s, starts to unpin the hips sideways; by this much, wholly. */
  pinYieldFrom: 0.3,
  pinYieldFull: 1.0,
  /** Seconds the hold takes to come back. */
  pinRegain: 0.35,
  /** Share of that the pins on the feet give way by, sideways. */
  footYield: 1,
  /** Rate the hold follows the balance it has, 1/s. */
  supportRate: 8,
  /**
   * How much of the hold's height stays whatever the balance: 1, the hips are held up in full until the hold goes, and only
   * sideways does it weaken. At 0 the hips of a body with 0.8 of its hold sank 0.05 m, and with its legs bent to match, a
   * swinging foot came 0.05 m short of its lift and dragged.
   */
  lift: 1,
  /**
   * The pins on the feet: natural frequency in rad/s and damping ratio of the pull on each ankle toward where the animation
   * has it, at the speed the animation moves it. Without them the physical foot covers about half of a catch step (0.27 of
   * 0.59 m, 0.38 of 0.94): the joint drive trails its target by five frames, and a catch step lasts eight.
   */
  footRate: 30,
  footDamping: 1,
  /**
   * The pin on the chest, as a share of the hold on the hips. The hold alone cannot turn the trunk: a body whose feet braked
   * a 2.5 m/s reel went on over them, its chest 0.75 rad behind its animation's after half a second.
   */
  chestHold: 1,
  /** A foot target faster than `swingSpeed` m/s or `liftHeight` metres over the other is in the air; slower than `plantSpeed` and down after that, it has landed. */
  swingSpeed: 1,
  plantSpeed: 0.3,
  liftHeight: 0.02,
  /** A footfall counts as a step if the foot came down this far from where it went up, in metres times the rig's size. */
  stepLength: 0.15,
  /** Metres the ground may differ under the two feet, or under the body as it goes. More is stairs or a ledge. */
  uneven: 0.15,
};

/** The budget a hit of this strength, 0..1, leaves a body to catch itself with. */
export function standBudget(strength: number): number {
  return lerp(0.9, 0.55, clamp(strength));
}

/**
 * What a body's wounds and nature do to that budget (stage 8): half of it rests on the weaker leg, a head that is not all
 * there (`LimbStrength.neck` under 1, concussed or ringing) has 0.7 of it, and one that feels nothing (`felt` false: under
 * `ReflexTuning.painFrom`, the undead) 1.3 times it.
 */
export function strengthBudget(s: LimbStrength, felt: boolean): number {
  return (0.5 + 0.5 * clamp(Math.min(s.legL, s.legR))) * (s.neck < 1 ? 0.7 : 1) * (felt ? 1 : 1.3);
}

/** One body's fight for its balance. */
export class Stand {
  /** Footfalls so far. */
  steps = 0;
  /** How much the hips and feet are held, 0..1. */
  support = 1;
  /** Share of the hold on the hips the last hits took, sideways and in turning. */
  yielded = 0;
  /** Seconds since the last hit, and how loose it left the upper body, 0..1. */
  since = 0;
  loose = 1;
  /** Seconds it has been still. */
  still = 0;
  /** It has caught itself, and gore hands it back. */
  caught = false;

  constructor(public budget: number) {}

  /** A hit that changed the body's speed by `dv` m/s and took `cost` of its health. */
  hit(dv: number, cost: number): void {
    const t = StandTuning;
    // What unpins it takes that share of what it has left as well: a hit that moves the whole body off its hold is one it
    // does not catch, however healthy it is. Left to the body alone, the same 150 N·s felled it or not on which joints
    // the round happened to jolt.
    const gives = smoothstep(t.pinYieldFrom, t.pinYieldFull, dv);
    this.budget = (this.budget - t.hitCost * cost) * (1 - gives);
    this.yielded = Math.max(this.yielded, gives);
    // As loose as the hit was hard, on top of what the last one left: a round a Brute hardly feels must not slacken it.
    this.loose = Math.max(this.loose * (1 - clamp(this.since / t.rampSeconds)), clamp(dv / t.pinYieldFull));
    this.since = 0;
    this.still = 0;
  }

  footfall(): void {
    this.steps++;
    this.budget -= StandTuning.perStep;
  }

  /** How well its weight is over its feet, 1 to 0, from the capture point error in steps. */
  balance(err: number): number {
    const t = StandTuning;
    return 1 - clamp((err - t.balanceFrom) / (t.giveUp - t.balanceFrom));
  }

  /** Once a frame, with the last reading of its balance. */
  advance(dt: number, err: number): void {
    const t = StandTuning;
    this.since += dt;
    this.yielded = Math.max(0, this.yielded - dt / t.pinRegain);
    const want = clamp(Math.min(this.budget, this.balance(err)));
    this.support += (want - this.support) * (1 - Math.exp(-t.supportRate * dt));
  }

  /** What arms, spine and head are driven at: loose at the hit, then holding. */
  get upper(): number {
    const t = StandTuning;
    return lerp(lerp(t.holdDrive, t.startDrive, this.loose), t.holdDrive, clamp(this.since / t.rampSeconds));
  }
}
