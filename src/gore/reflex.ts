/**
 * A body that has lost its feet and not its life.
 *
 * A collapse follows the animation. This cannot: a thrown body has no animation worth following. So each frame this
 * works out what a person would do with their limbs from where they are in the air, and hands joints a pose in their
 * own terms, which the muscle layer then tries to reach. Nothing here touches a rigid body, so it cannot throw anything.
 *
 * Fall: arms go wide, then reach out and down as the floor comes up, knees draw in, chin tucks. Lying: a hand goes to the
 * wound, the rest curls round it. Struggle: face down or face up, it pushes itself up on its own muscles to a point part way
 * through its get-up, and a hurt body can give out and drop back. Gather: the limbs find the frame of the get-up the body
 * is handed back at, so that the handover has little left to blend. Rigs are read through joint roles, so a missing limb is
 * just a limb nobody moves.
 */
import * as THREE from 'three';
import { CG, type CharacterAnimation, type RayHit } from '../core/contracts';
import { clamp, damp, lerp, smoothstep } from '../core/math';
import type { GetUpKind } from '../characters/animation/getUp';
import { GRAVITY } from '../physics/Physics';
import { KNOCK_PASS, type MuscleState } from './muscles';
import type { Rag, RagPart } from './rag';

export type ReflexPhase = 'fall' | 'lying' | 'struggle' | 'gather';

const struggleFlag = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('struggle');
/**
 * `?struggle=0` puts back getting up from before a body fought its way up, for comparison in motion: it gathers to the first
 * frame of the clip and the animation does all of it, over the whole of its time; a rising body is put back down only by a
 * head hit, a blast or being run into. Read once, at load, by gore and by the damage model and its rules.
 */
export const STRUGGLE_PASS = struggleFlag !== '0';

/**
 * What a body fighting up off the floor asks of the lift under it, read each sub-step by `MuscleState`. Heights are in the
 * world, `force` in newtons is its cap right now, and 0 is no lift.
 */
export interface ReflexLift {
  hipsY: number;
  chestY: number;
  chest: RagPart | null;
  /** Where on the chest it lifts, in the chest's frame: between the shoulders, so it raises the chest and not only its base. */
  readonly chestAt: THREE.Vector3;
  force: number;
  band: number;
  damping: number;
}

/** Chance that one attempt at getting up gives out, for a body this hurt. */
export function giveOutChance(hurt: number): number {
  return clamp(ReflexTuning.giveOut * (hurt - 1 / 3));
}

export const ReflexTuning = {
  /** Seconds before muscles answer a hit. A body that reacts at once looks like it knew. */
  reaction: 0.07,
  /** Joint strength by role, 0..1, in each phase. Legs stay light: a strong leg on the floor props the body up. */
  fall: { arm: 0.75, leg: 0.32, spine: 0.34, head: 0.6 },
  lying: { arm: 0.55, leg: 0.3, spine: 0.14, head: 0.4 },
  gather: { arm: 0.8, leg: 0.6, spine: 0.4, head: 0.5 },
  /** How fast joint strength reaches what the phase wants, in 1/s. */
  driveRate: 11,
  /**
   * A body counts as down with its hips under this share of their standing height, moving slower than this, for this long.
   * Speeds here and in `stunThud` are at full gravity, and scale by `Rag.throwScale` under the tempo dial.
   */
  landHeight: 0.42,
  landSpeed: 2.4,
  landHold: 0.14,
  /** However it is going, a fall ends after this long. Something may be holding the body up. */
  maxFall: 3.2,
  /** Seconds to reach the first frame of the get-up. */
  gatherSeconds: 0.55,
  /** Slowest a body has to be before it can try, and how long past its time it waits for that. */
  gatherSpeed: 1.6,
  gatherPatience: 1.5,
  /** Metres per second a landing has to cost to knock the strength out of the arms, and how fast it comes back. */
  stunThud: 1.4,
  stunFade: 4.5,
  stunLoss: 0.75,
  /** Height of the chest over the floor at which the arms stop flailing and go for it. */
  braceHigh: 1.25,
  braceLow: 0.4,
  /** Seconds a body takes to go slack if it dies on the way down. */
  dieSeconds: 0.5,
  /** Seconds between looking for the floor. */
  groundEvery: 0.1,
  /** Flail rate in rad/s, and how far the arms wheel. */
  flailRate: 9,
  flailSize: 0.65,
  /** Elbow in radians as an arm wheels, and as it braces. */
  flailElbow: 0.85,
  braceElbow: 0.3,
  /**
   * The brace gives. Once a hand is this many metres off the floor with the chest still coming down faster than `yieldFalling`
   * (m/s, at full gravity), its elbow eases to `yieldElbow` over `yieldSeconds`, and its strength over what holds the arm
   * up drops from `braceGain` to `yieldGain`: the hand takes the weight and lets it through, instead of propping the body.
   */
  yieldReach: 0.08,
  yieldFalling: 0.3,
  yieldElbow: 1.3,
  yieldSeconds: 0.18,
  yieldGain: 2,
  /**
   * Share of the arms' and the head's gravity cut they keep while falling. At 1, as with `?knock=0`, a falling arm weighs what
   * its strength leaves (a quarter, at the fall's 0.75), as a working muscle does; at 0 it falls with all its weight. At 0.5 it
   * weighs five eighths, and still braces: at 0 the elbows fold flat under the body and some forward falls roll onto the back.
   */
  fallCarry: KNOCK_PASS ? 0.5 : 1,
  /**
   * Thrown by a blast, the hands go to the face and stay there while the hips are above `landHeight` of standing and falling
   * slower than `guardFalling` m/s (at full gravity), for at most `guardHold` seconds, then let go over `guardFade`. With
   * `?knock=0`, 0.2 s whatever the body is doing.
   */
  guardHold: KNOCK_PASS ? 0.6 : 0.2,
  guardFalling: 2,
  guardFade: 0.25,
  /**
   * Knocked cold by a head hit: the head hangs slack for `koHead` seconds and the arms are held to `koArm` for `koSeconds`, with
   * no brace and no guard, and legs and spine lock for `koPlank` seconds, not `plankSeconds`, so it goes over like a sack.
   */
  koHead: 0.25,
  koArm: 0.1,
  koSeconds: 0.6,
  koPlank: 0.25,
  /** rad/s the round snaps the head back on its neck with, on the frame it lands (`MuscleState.whip`). */
  koWhip: 24,
  /** Hip and knee in radians, in the air. */
  tuckHip: 0.55,
  tuckKnee: 0.9,
  /** Leg strength while a body tips over its feet, and how long that lasts. Slack, it folds at the knees and rolls over its head. */
  plankLeg: 0.8,
  plankSpine: 0.85,
  plankSeconds: 0.42,
  /** How much stronger than holding themselves up the arms are when they take a body's weight. */
  braceGain: 5,
  /** Spine and head in radians as a body goes down: curled going backward, chin up going forward. */
  fallCurl: 0.3,
  fallArch: -0.1,
  fallChin: 0.42,
  fallChinUp: -0.5,
  lyingCurl: 0.16,
  /** How much of a leg draws up while lying, and how fast it stirs, in rad/s. */
  writheHip: 0.5,
  writheKnee: 0.8,
  writheRate: 1.5,
  /** Below this it does not bother clutching: zombie types do not know they are hurt. */
  painFrom: 0.2,
  /** Seconds lost off the wait to get up per unit of hit strength, so a body being shot stays down. */
  strikeWait: 0.7,
  /** A hit this strong puts a body that has started to rise back on the floor. */
  strikeBack: 0.3,

  /**
   * Fighting up. Face down or face up with both arms and both legs, a body pushes itself on its own muscles to `struggleU`
   * of the way through its clip: a push-up face down, arms straight and legs still out behind (the prone clip's second key;
   * the clip brings the knees under), sat up face up (the supine
   * one's). Joints are driven at these strengths to that frame's pose, and the clip plays only the rest. With `?struggle=0`
   * it gathers to the clip's first frame.
   */
  struggle: { arm: 0.9, leg: 0.7, spine: 0.55, head: 0.5 },
  struggleU: { prone: 0.24, supine: 0.3 } as Readonly<Record<'prone' | 'supine', number>>,
  /** Seconds its effort takes to build, and for a body that feels nothing (`painFrom`). */
  pushSeconds: 0.7,
  pushUnhurt: 0.35,
  /**
   * The lift: a capped cheat under the hips and chest, like Euphoria's helper on a fall to the knees, never more than this
   * share of the body's weight, times the effort (all of it from `assistFull` of the effort) and the weaker of arms and legs
   * as a share of their push. An explicit vertical impulse each sub-step, never a joint torque, so the gain limit holds.
   * Nothing within `assistSlack` metres under where the frame has the hips and the chest, all of it `assistBand` further
   * down, and damped at `assistDamping` 1/s.
   */
  assistMax: 0.55,
  assistFull: 0.5,
  assistSlack: 0.03,
  assistBand: 0.06,
  assistDamping: 4,
  /** How much stronger than holding themselves up arms and legs are while they push, as `braceGain` is for a brace. */
  pushGain: 4,
  /** It strains: the effort shakes by this share at this many rad/s, times how hurt it is. */
  wobble: 0.08,
  wobbleRate: 17,
  /**
   * Up: hips and shoulders within `upReach` metres of where the frame has them and the chest within `upTilt` rad of its lean,
   * for `upHold` s. At 0.3 rad a body that had sat up swung its chest 0.4 rad either side of upright for half a second, and
   * one face down hung its head 0.3 to 0.4 rad off the frame with hips and shoulders where they should be.
   */
  upReach: 0.08,
  upTilt: 0.5,
  upHold: 0.15,
  /** Seconds it gathers there before it is handed back. Its joints have been reaching for that frame all along. */
  upGather: 0.2,
  /** Seconds an attempt may take to get there. Past it the body gathers to the clip's first frame instead. */
  upPatience: 2,
  /**
   * How often a hurt body gives out, the owner's question 3. An attempt fails with chance `giveOut × (hurt - 1/3)`, so a
   * body under a third hurt never does, a Husk (`hurt` 0) included. At 0.6 it is the plan's `0.6 × hurt - 0.2`. At 0.45
   * about a quarter of the Troopers knocked down on the range give out at least once (`gore.md`, Measured).
   */
  giveOut: 0.45,
  /**
   * How far up an attempt that is going to fail gets before it gives out, least and most, as a share of what its hips and
   * shoulders have to rise; or `giveLate` seconds after its effort is all there, if it never gets that far.
   */
  giveAt: [0.7, 0.9] as readonly [number, number],
  giveLate: 0.5,
  /** Giving out: the arms drop to `slumpArm` and the lift to nothing over `slumpSeconds`, and it lies `retryWait` s. */
  slumpArm: 0.15,
  slumpSeconds: 0.25,
  retryWait: [0.5, 1.2] as readonly [number, number],
  /** Attempts before one has to succeed. A body that is dying never does. */
  maxTries: 3,
  /**
   * Hit strength that knocks a body fighting up back down, added up and fading at `knockFade` 1/s. One SMG round is 0.47
   * and only rocks it; a second 0.1 s later, a shell's pellets together or a Judge round put it down.
   */
  struggleKnock: 0.6,
  knockFade: 7,
};

interface Arm {
  shoulder: RagPart;
  elbow: RagPart | null;
  side: 1 | -1;
  /** Which way the upper arm points at rest, in the chest's frame. */
  rest: THREE.Vector3;
  upper: number;
  fore: number;
  phase: number;
  /** The fingertips from the elbow, in the forearm's frame. Zero with no hand to put down. */
  readonly tip: THREE.Vector3;
  /** Age at which its hand reached the floor in this fall, or -1. */
  yieldAt: number;
}

interface Leg {
  hip: RagPart;
  knee: RagPart | null;
  side: 1 | -1;
  phase: number;
}

const _front = new THREE.Vector3();
const _up = new THREE.Vector3();
const _left = new THREE.Vector3();
const _fall = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _inv = new THREE.Quaternion();
const _origin = new THREE.Vector3();
const _d = new THREE.Vector3();
const _path = new Int32Array(8);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

const _ray: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };

export class Reflex {
  phase: ReflexPhase = 'fall';
  /** Seconds in this phase. */
  time = 0;
  /** Seconds since the hit. */
  age = 0;
  /** Set once the limbs have gathered, and the body can be handed back. */
  ready = false;
  /** Seconds on the floor before it tries to get up. */
  lie: number;
  /** 0 feels nothing, 1 is badly hurt. */
  hurt: number;
  groundY: number;
  /** Tipped over its feet rather than thrown off them. */
  readonly plank: boolean;
  /** Knocked cold by a head hit. See `ReflexTuning.koSeconds`. */
  readonly knockout: boolean;
  kind: GetUpKind = 'prone';
  /** Where the hips sit at the frame of the get-up it is handed back at, relative to where it will stand, and their turn. */
  readonly startHips = new THREE.Vector3();
  readonly startHipsTurn = new THREE.Quaternion();
  /** That frame, 0..1 of the clip: where its struggle got it to, or 0 when the clip does all of it. */
  startU = 0;
  /** Seconds left to go slack, or below zero while still alive. */
  dying = -1;
  /** Attempts at getting up so far, how many gave out by themselves, and how many were knocked back down. */
  tries = 0;
  fails = 0;
  knocks = 0;
  /** What it asks of the lift under it. See `ReflexLift`. */
  readonly lift: ReflexLift = { hipsY: 0, chestY: 0, chest: null, chestAt: new THREE.Vector3(), force: 0, band: 0, damping: 0 };
  /** 0..1 of the way into the effort of this attempt, and of the way up to its frame. */
  effort = 0;
  progress = 0;
  private arms: Arm[] = [];
  private legs: Leg[] = [];
  private spine: RagPart | null = null;
  private head: RagPart | null = null;
  private stun = 0;
  private landed = 0;
  private groundIn = 0;
  private woundPart: RagPart | null = null;
  private readonly woundAt = new THREE.Vector3();
  private readonly fallDir = new THREE.Vector3();
  private readonly seed: number;
  private readonly standHips: number;
  private readonly keep: THREE.Quaternion[];
  /** A leg's pose where an attempt began and in the frame it pushes for, by bone. The legs come with the body, not before it. */
  private readonly legFrom: THREE.Quaternion[];
  private readonly legTo: THREE.Quaternion[];
  /** Age at which the hands left the face, or -1 while they guard it. */
  private guardEnd = -1;
  /** How far up this attempt gives out (`progress`), or Infinity if it will not. */
  private giveAt = Infinity;
  /** Seconds since it gave out, or -1 while it is still trying. */
  private slump = -1;
  /** Knocked back down by a hit, so the slump is all there at once. */
  private knocked = false;
  /** Pushed itself to its frame, and is gathering there to be handed back at it. */
  private pushed = false;
  /** Seconds it has held its frame. */
  private held = 0;
  /** Hit strength taken while fighting up, fading. */
  private blow = 0;
  /** Heights over the floor of the hips and chest where the attempt began, and in the frame it pushes for, and its lean. */
  private fromHips = 0;
  private fromChest = 0;
  private keyHips = 0;
  private keyChest = 0;
  private keyTilt = 0;

  constructor(
    private readonly rag: Rag,
    private readonly muscle: MuscleState,
    private readonly anim: CharacterAnimation,
    options: { lie: number; hurt: number; groundY: number; dir: THREE.Vector3 | null; plank: boolean; knockout?: boolean },
  ) {
    this.plank = options.plank;
    this.knockout = KNOCK_PASS && options.knockout === true;
    this.lie = options.lie;
    this.hurt = options.hurt;
    this.groundY = options.groundY;
    this.seed = muscle.random() * 100;
    this.keep = rag.source.bones.map(() => new THREE.Quaternion());
    this.legFrom = rag.source.bones.map(() => new THREE.Quaternion());
    this.legTo = rag.source.bones.map(() => new THREE.Quaternion());
    const bind = rag.info.bind;
    this.standHips = bind[1]!;
    if (options.dir) this.fallDir.set(options.dir.x, 0, options.dir.z);
    this.bind();
    if (this.plank) this.lockTrunk();
  }

  /** Legs and spine hold the shape they were hit in, from the first step, so the body goes over in one piece. */
  private lockTrunk(): void {
    const t = ReflexTuning;
    const parts = this.rag.parts;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const m = part.muscle!;
      if (!part.parent || (m.role !== 'leg' && m.role !== 'spine')) continue;
      m.pose.copy(part.parent.q).conjugate().multiply(part.q);
      m.drive = m.role === 'leg' ? t.plankLeg : t.plankSpine;
    }
  }

  /** Finds the limbs. Call when the chain changes. */
  bind(): void {
    const { rag } = this;
    const bind = rag.info.bind;
    const parts = rag.parts;
    this.arms = [];
    this.legs = [];
    this.spine = this.head = null;
    for (const part of parts) {
      const m = part.muscle;
      if (!m || !part.parent) continue;
      if (m.role === 'spine') this.spine = part;
      else if (m.role === 'head') this.head = part;
      else if (!part.hinge && (m.role === 'arm' || m.role === 'leg')) {
        const side: 1 | -1 = bind[part.bone * 3]! >= 0 ? 1 : -1;
        const below = parts.find(k => k.parent === part && k.hinge) ?? null;
        if (m.role === 'leg') {
          this.legs.push({ hip: part, knee: below, side, phase: this.muscle.random() * Math.PI * 2 });
          continue;
        }
        const o = part.bone * 3;
        let upper = 0.3;
        let fore = 0.26;
        const rest = new THREE.Vector3(side * 0.3, -1, 0);
        const tip = new THREE.Vector3();
        if (below) {
          const e = below.bone * 3;
          rest.set(bind[e]! - bind[o]!, bind[e + 1]! - bind[o + 1]!, bind[e + 2]! - bind[o + 2]!);
          upper = rest.length();
          const hand = rag.info.children[below.bone]![0];
          if (hand !== undefined) {
            const h = hand * 3;
            fore = Math.hypot(bind[h]! - bind[e]!, bind[h + 1]! - bind[e + 1]!, bind[h + 2]! - bind[e + 2]!);
            // Bind frames line up with the world, as `rest` assumes, so the far end of the hand's capsule is plain offsets.
            const to = rag.source.rig.bones[hand]!.hit?.to ?? [0, 0, 0];
            tip.set(bind[h]! - bind[e]! + to[0], bind[h + 1]! - bind[e + 1]! + to[1], bind[h + 2]! - bind[e + 2]! + to[2]);
          }
        }
        this.arms.push({ shoulder: part, elbow: below, side, rest: rest.normalize(), upper, fore, phase: this.muscle.random() * Math.PI * 2, tip, yieldAt: -1 });
      }
    }
    if (this.woundPart && !parts.includes(this.woundPart)) this.woundPart = null;
    // Between the shoulders, from the chest's joint, in its frame: bind frames line up with the world.
    const at = this.lift.chestAt.set(0, 0, 0);
    const spine = this.spine;
    if (spine) {
      for (const arm of this.arms) {
        const o = arm.shoulder.bone * 3;
        const c = spine.bone * 3;
        at.x += (bind[o]! - bind[c]!) / this.arms.length;
        at.y += (bind[o + 1]! - bind[c + 1]!) / this.arms.length;
        at.z += (bind[o + 2]! - bind[c + 2]!) / this.arms.length;
      }
    }
  }

  /** Remembers a wound for a hand to find. */
  wound(bone: number, point: THREE.Vector3): void {
    const part = this.rag.partFor(bone);
    part.body.translation(part.p);
    part.body.rotation(part.q);
    this.woundPart = part;
    this.woundAt.copy(point).sub(part.p).applyQuaternion(_q.copy(part.q).conjugate());
  }

  /** A further hit. The way down carries on from where it had got to, and a body that was rising goes back. */
  struck(strength: number): void {
    if (this.dying >= 0) return;
    this.ready = false;
    // Fighting up, what it takes adds up, and `sample` puts it back down past `struggleKnock`.
    if (this.phase === 'struggle' || this.pushed) {
      this.blow += strength;
      return;
    }
    if (this.phase === 'gather' && strength >= ReflexTuning.strikeBack) this.enter('lying');
    if (this.phase === 'lying') this.time = Math.max(0, this.time - strength * ReflexTuning.strikeWait);
  }

  /** A blast has it in the air again. */
  thrown(): void {
    if (this.dying >= 0) return;
    this.ready = false;
    // Thrown while it pushes up, the lift goes this sub-step, and the legs fall with all their weight and a gain of 1, as a
    // body knocked off its feet starts: the fall writes neither, and they had the push's gain and most of their weight carried.
    if (this.phase === 'struggle' || this.pushed) {
      this.lift.force = 0;
      const g = this.rag.gravity;
      for (const part of this.rag.parts) {
        if (part.muscle!.role !== 'leg') continue;
        part.muscle!.gain = 1;
        part.body.setGravityScale(g, false);
      }
    }
    this.enter('fall');
    this.landed = 0;
    for (const arm of this.arms) arm.yieldAt = -1;
  }

  /**
   * Died on the way down: whatever it was doing fades out, it does not stop. Fighting up, the lift under it goes on the spot
   * and the push with it: what is left is muscle fading, and the body drops under its own weight.
   */
  die(): void {
    if (this.dying < 0) this.dying = ReflexTuning.dieSeconds;
    this.lift.force = 0;
  }

  private enter(phase: ReflexPhase): void {
    this.phase = phase;
    this.time = 0;
    if (phase !== 'gather') this.pushed = false;
    if (phase !== 'struggle') this.slump = -1;
    if (phase === 'struggle') this.startStruggle();
    else if (phase === 'gather' && !this.pushed) this.startGather();
  }

  /** Time to get up: it fights its way up if it can, or gathers for the clip to do it all. */
  private rise(): void {
    this.kind = this.pickGetUp();
    this.enter(STRUGGLE_PASS && this.kind !== 'crawl' && this.anim.poseGetUpAt && this.canPush() ? 'struggle' : 'gather');
  }

  /**
   * Both arms and both legs, whole, to push with. On one shin a body face down never got its hips past 0.21 m and gathered
   * for the clip 2 s later; the clip does it all, as before.
   */
  private canPush(): boolean {
    if (this.arms.length < 2 || this.legs.length < 2) return false;
    for (const arm of this.arms) if (!arm.elbow || arm.shoulder.muscle!.broken || arm.elbow.muscle!.broken) return false;
    for (const leg of this.legs) if (!leg.knee || leg.hip.muscle!.broken || leg.knee.muscle!.broken) return false;
    return true;
  }

  private startStruggle(): void {
    const t = ReflexTuning;
    const kind = this.kind === 'supine' ? 'supine' : 'prone';
    const rng = this.muscle;
    this.tries++;
    this.startU = t.struggleU[kind];
    this.readFrame(kind, this.startU, rng.random() < 0.5 ? 1 : -1);
    for (const part of this.rag.parts) {
      if (part.muscle!.role !== 'leg' || !part.parent) continue;
      this.legTo[part.bone]!.copy(part.muscle!.pose);
      this.legFrom[part.bone]!.copy(part.parent.q).conjugate().multiply(part.q);
    }
    this.effort = this.progress = 0;
    this.held = 0;
    this.knocked = false;
    // The last try gets there unless something stops it.
    const failing = this.tries < t.maxTries && rng.random() < giveOutChance(this.hurt);
    this.giveAt = failing ? lerp(t.giveAt[0], t.giveAt[1], rng.random()) : Infinity;
    const hips = this.rag.parts[0]!;
    this.fromHips = hips.p.y - this.groundY;
    const chest = this.spine ?? hips;
    this.fromChest = chest.p.y + _d.copy(this.lift.chestAt).applyQuaternion(chest.q).y - this.groundY;
  }

  /** Gives out, by itself or knocked back down: the arms drop and the lift goes, and it lies a moment before trying again. */
  private giveIn(knocked: boolean): void {
    if (knocked) this.knocks++;
    else this.fails++;
    this.phase = 'struggle';
    this.pushed = false;
    this.slump = 0;
    this.knocked = knocked;
    this.blow = 0;
  }

  /** One frame of an attempt at getting up. */
  private push(dt: number): void {
    const t = ReflexTuning;
    if (this.slump >= 0) {
      this.slump += dt;
      if (this.slump >= t.slumpSeconds) {
        this.lie = lerp(t.retryWait[0], t.retryWait[1], this.muscle.random());
        this.enter('lying');
      }
      return;
    }
    const push = this.hurt < t.painFrom ? t.pushUnhurt : t.pushSeconds;
    this.effort = Math.min(1, this.effort + dt / push);
    const hips = this.rag.parts[0]!;
    const chest = this.spine ?? hips;
    // How far up it has got: what the hips and the shoulders have gained of what they have to, together, to count as up.
    const hipsUp = hips.p.y - this.groundY;
    const shoulders = chest.p.y + _d.copy(this.lift.chestAt).applyQuaternion(chest.q).y - this.groundY;
    const hipsTo = Math.max(0, this.keyHips - t.upReach - this.fromHips);
    const chestTo = Math.max(0, this.keyChest - t.upReach - this.fromChest);
    const gained = clamp(hipsUp - this.fromHips, 0, hipsTo) + clamp(shoulders - this.fromChest, 0, chestTo);
    this.progress = hipsTo + chestTo > 0.05 ? gained / (hipsTo + chestTo) : this.effort;
    // A body that is going to give out does it most of the way up, or when it has pushed as hard as it can for a moment.
    if (this.progress >= this.giveAt || (this.giveAt < Infinity && this.time > push + t.giveLate)) {
      this.giveIn(false);
      return;
    }
    if (this.giveAt === Infinity) {
      _up.set(0, 1, 0).applyQuaternion(chest.q);
      const tilted = Math.abs(Math.acos(clamp(_up.y, -1, 1)) - this.keyTilt) >= t.upTilt;
      const there = Math.abs(hipsUp - this.keyHips) < t.upReach && Math.abs(shoulders - this.keyChest) < t.upReach && !tilted;
      this.held = there ? this.held + dt : 0;
      if (this.held >= t.upHold) {
        this.pushed = true;
        this.enter('gather');
        return;
      }
    }
    // It has not got there. The clip does it all, as it did before.
    if (this.time > t.upPatience) {
      this.startU = 0;
      this.enter('gather');
    }
  }

  /** Once a frame, after Rag.measure. */
  sample(dt: number): void {
    if (dt <= 0) return;
    const rag = this.rag;
    this.time += dt;
    this.age += dt;
    if (this.dying >= 0) this.dying = Math.max(0, this.dying - dt);
    const hips = rag.parts[0]!;
    const chest = this.spine ?? hips;
    this.look(chest, dt);
    this.stun = Math.max(0, this.stun - ReflexTuning.stunFade * dt);
    // Under less gravity a body lands slower from the same height, by the same share as it is thrown.
    if (rag.thud / rag.mass > ReflexTuning.stunThud * rag.throwScale) this.stun = 1;
    if (this.blow >= ReflexTuning.struggleKnock && (this.phase === 'struggle' || this.pushed) && this.slump < 0) this.giveIn(true);
    this.blow *= Math.exp(-ReflexTuning.knockFade * dt);
    this.advance(hips, dt);

    _front.set(0, 0, 1).applyQuaternion(chest.q);
    _up.set(0, 1, 0).applyQuaternion(chest.q);
    _left.set(1, 0, 0).applyQuaternion(chest.q);
    if (this.phase === 'fall') this.poseFall(hips, chest);
    else if (this.phase === 'lying') this.poseLying(chest);
    else if (this.phase === 'struggle') {
      if (this.slump < 0) this.poseStruggle();
      else this.poseSlump();
    }
    this.setStrengths(dt);
  }

  private look(chest: RagPart, dt: number): void {
    this.groundIn -= dt;
    if (this.groundIn > 0) return;
    this.groundIn = ReflexTuning.groundEvery;
    _origin.copy(chest.p);
    _origin.y += 0.2;
    if (this.rag.physics.raycastInto(_origin, DOWN, 40, CG.World, _ray)) this.groundY = _ray.point.y;
  }

  private advance(hips: RagPart, dt: number): void {
    const t = ReflexTuning;
    if (this.phase === 'fall') {
      const low = hips.p.y - this.groundY < this.standHips * t.landHeight && hips.v.length() < t.landSpeed * this.rag.throwScale;
      this.landed = low ? this.landed + dt : 0;
      if (this.landed > t.landHold || this.time > t.maxFall) this.enter('lying');
    } else if (this.phase === 'lying') {
      const calm = hips.v.length() < t.gatherSpeed || this.time > this.lie + t.gatherPatience;
      if (this.dying < 0 && this.time > this.lie && calm) this.rise();
    } else if (this.phase === 'struggle') {
      // Dead, it gets no further up and is not handed back.
      if (this.dying < 0) this.push(dt);
    } else if (this.time > (this.pushed ? t.upGather : t.gatherSeconds)) {
      this.ready = true;
    }
  }

  /** Face up or face down, read off the chest. Also where a legless body stops. */
  private pickGetUp(): GetUpKind {
    if (this.legs.length === 0 || this.anim.prone) return 'crawl';
    const chest = this.spine ?? this.rag.parts[0]!;
    _front.set(0, 0, 1).applyQuaternion(chest.q);
    return _front.y > 0 ? 'supine' : 'prone';
  }

  private startGather(): void {
    this.kind = this.pickGetUp();
    this.startU = 0;
    this.readFrame(this.kind, 0, 0);
  }

  /**
   * Has the animator pose the get-up at `u` and reads each joint's target out of it. With `flip` 0 the animator picks the
   * lead side, as it always has for the first frame. Notes where that frame has the hips and the chest, over the floor.
   */
  private readFrame(kind: GetUpKind, u: number, flip: number): void {
    const { rag, anim } = this;
    const bones = rag.source.bones;
    const defs = rag.source.rig.bones;
    const keep = this.keep;
    for (let i = 0; i < bones.length; i++) keep[i]!.copy(bones[i]!.quaternion);
    _a.copy(bones[0]!.position);
    if (flip === 0 || !anim.poseGetUpAt) anim.poseGetUpStart!(kind, this.startHips);
    else anim.poseGetUpAt(kind, u, this.startHips, flip);
    for (const part of rag.parts) {
      const parent = part.parent;
      if (!parent) continue;
      const pose = part.muscle!.pose;
      pose.identity();
      for (let b = part.bone; b !== parent.bone; b = defs[b]!.parent) pose.premultiply(bones[b]!.quaternion);
    }
    this.startHipsTurn.copy(bones[0]!.quaternion);
    this.keyHips = this.keyChest = this.startHips.y;
    this.keyTilt = 0;
    const chest = this.spine;
    if (chest) {
      // The chest's place in the frame, down the chain from the hips, which sit on the root.
      let n = 0;
      for (let b = chest.bone; b >= 0 && n < _path.length; b = defs[b]!.parent) _path[n++] = b;
      _b.set(0, 0, 0);
      _q.identity();
      for (let i = n - 1; i >= 0; i--) {
        const bone = bones[_path[i]!]!;
        _b.add(_d.copy(bone.position).applyQuaternion(_q));
        _q.multiply(bone.quaternion);
      }
      this.keyChest = _b.y + _d.copy(this.lift.chestAt).applyQuaternion(_q).y;
      this.keyTilt = Math.acos(clamp(_d.set(0, 1, 0).applyQuaternion(_q).y, -1, 1));
    }
    // These bones are the ragdoll's, and the merged ones are not rewritten by anything until the handover.
    for (let i = 0; i < bones.length; i++) bones[i]!.quaternion.copy(keep[i]!);
    bones[0]!.position.copy(_a);
  }

  private poseFall(hips: RagPart, chest: RagPart): void {
    const t = ReflexTuning;
    _fall.set(hips.v.x, 0, hips.v.z);
    if (_fall.lengthSq() < 0.25) {
      // Barely moving: it goes the way it has tipped.
      _fall.set(chest.p.x - hips.p.x, 0, chest.p.z - hips.p.z);
      if (_fall.lengthSq() < 0.01) _fall.copy(this.fallDir);
    }
    if (_fall.lengthSq() > 1e-6) _fall.normalize();
    const facing = _front.dot(_fall);
    const height = chest.p.y - this.groundY;
    const tipped = 1 - clamp(_up.y);
    const brace = clamp(Math.max(1 - smoothstep(t.braceLow, t.braceHigh, height), tipped * 0.8));
    const w = this.age * t.flailRate + this.seed;
    const forward = clamp(facing * 0.5 + 0.5);
    // Thrown, the first thing anybody does is cover their face. Knocked cold, nothing does anything.
    const guard = this.plank || this.knockout ? 0 : this.guarding(hips);
    const falling = chest.v.y < -t.yieldFalling * this.rag.throwScale;
    const slack = this.knockout && this.age < t.koSeconds;
    for (let i = 0; i < this.arms.length; i++) {
      const arm = this.arms[i]!;
      const a = Math.sin(w + arm.phase);
      const b = Math.cos(w * 0.7 + arm.phase);
      // Wide and wheeling, in the chest's axes.
      _dir.copy(_left).multiplyScalar(arm.side * 0.85);
      _dir.addScaledVector(_up, a * t.flailSize + 0.1).addScaledVector(_front, 0.35 + b * t.flailSize);
      _dir.normalize();
      // Out toward the floor it is falling at. Backward there is little reach behind a shoulder, so it goes out to the side.
      _a.copy(_fall).multiplyScalar(lerp(0.5, 0.95, forward));
      _a.addScaledVector(DOWN, 0.7).addScaledVector(_left, arm.side * lerp(0.6, 0.22, forward));
      _a.normalize();
      _dir.lerp(_a, brace).normalize();
      const give = this.give(arm, brace, falling);
      this.aim(arm, _dir, lerp(t.flailElbow + a * 0.3, lerp(t.braceElbow, t.yieldElbow, give), brace));
      if (guard > 0.5 && this.head) {
        _b.copy(_front).multiplyScalar(0.14).addScaledVector(_left, arm.side * 0.07).add(this.head.p);
        this.reach(arm, _b);
      }
      const gain = slack ? 1 : lerp(1, lerp(t.braceGain, t.yieldGain, give), brace);
      arm.shoulder.muscle!.gain = gain;
      if (arm.elbow) arm.elbow.muscle!.gain = gain;
    }
    const chin = lerp(t.fallChin, t.fallChinUp, forward);
    if (this.plankLeft > 0.5) {
      this.head?.muscle!.pose.setFromAxisAngle(X_AXIS, chin);
      return;
    }
    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i]!;
      const pedal = Math.sin(w * 0.55 + leg.phase) * (1 - brace);
      this.pose(leg, t.tuckHip * (0.7 + pedal * 0.5), t.tuckKnee * (0.75 - pedal * 0.4));
    }
    this.curl(lerp(t.fallCurl, t.fallArch, forward), chin);
  }

  /** 1 while legs are locked for a body tipping over its feet, fading to nothing. */
  private get plankLeft(): number {
    const seconds = this.knockout ? ReflexTuning.koPlank : ReflexTuning.plankSeconds;
    return this.plank ? 1 - smoothstep(seconds * 0.6, seconds, this.age) : 0;
  }

  /**
   * 1 while a thrown body's hands cover its face. They stay there while it is going up or hanging at the top, and let go as it
   * comes down at `guardFalling` or gets low, so they are free to meet the floor.
   */
  private guarding(hips: RagPart): number {
    const t = ReflexTuning;
    if (this.guardEnd < 0) {
      const up = !KNOCK_PASS || (hips.p.y - this.groundY > this.standHips * t.landHeight && hips.v.y > -t.guardFalling * this.rag.throwScale);
      if (!up || this.age >= t.guardHold) this.guardEnd = Math.min(this.age, t.guardHold);
    }
    return this.guardEnd < 0 ? 1 : 1 - smoothstep(this.guardEnd, this.guardEnd + t.guardFade, this.age);
  }

  /**
   * How far a bracing hand has given, 0 to 1. Once it is on the floor with the chest still coming down, the elbow bends and
   * the arm goes softer, so the weight comes through it instead of stopping on a straight arm. It does not take it back.
   */
  private give(arm: Arm, brace: number, falling: boolean): number {
    const t = ReflexTuning;
    if (!KNOCK_PASS || !arm.elbow) return 0;
    if (arm.yieldAt < 0) {
      if (!falling || brace < 0.5) return 0;
      _b.copy(arm.tip).applyQuaternion(arm.elbow.q).add(arm.elbow.p);
      if (_b.y - this.groundY >= t.yieldReach) return 0;
      arm.yieldAt = this.age;
    }
    return smoothstep(0, t.yieldSeconds, this.age - arm.yieldAt);
  }

  /**
   * The legs draw up as the body comes up, not ahead of it: driven to the frame's pose at once, a body face up lying flat
   * swung its legs into the air before it sat up.
   */
  private poseStruggle(): void {
    const k = smoothstep(0, 1, this.progress);
    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i]!;
      leg.hip.muscle!.pose.slerpQuaternions(this.legFrom[leg.hip.bone]!, this.legTo[leg.hip.bone]!, k);
      if (leg.knee) leg.knee.muscle!.pose.slerpQuaternions(this.legFrom[leg.knee.bone]!, this.legTo[leg.knee.bone]!, k);
    }
  }

  /** Giving out, the elbows give as a brace does, or straight arms under the shoulders hold the body up on their stops. */
  private poseSlump(): void {
    const bend = ReflexTuning.yieldElbow;
    for (let i = 0; i < this.arms.length; i++) {
      const e = this.arms[i]!.elbow?.muscle;
      if (e) e.pose.setFromAxisAngle(e.hingeAxis, clamp(-bend, e.lo, e.hi));
    }
  }

  private poseLying(chest: RagPart): void {
    const t = ReflexTuning;
    const felt = this.hurt >= t.painFrom;
    const stir = Math.sin(this.age * t.writheRate + this.seed);
    let clutching = false;
    for (let i = 0; i < this.arms.length; i++) {
      const arm = this.arms[i]!;
      const wound = this.woundPart;
      if (felt && !clutching && wound && wound !== arm.shoulder && wound !== arm.elbow) {
        clutching = true;
        _b.copy(this.woundAt).applyQuaternion(wound.q).add(wound.p);
        this.reach(arm, _b);
      } else if (felt) {
        // Nothing to hold, so it curls in on the belly, the way a body guards what it has left.
        _b.copy(chest.p).addScaledVector(_up, -0.1).addScaledVector(_front, 0.2).addScaledVector(_left, arm.side * 0.1);
        this.reach(arm, _b);
      } else {
        _dir.copy(DOWN).addScaledVector(_left, arm.side * 0.8);
        this.aim(arm, _dir.normalize(), 0.6);
      }
    }
    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i]!;
      const draw = felt ? 0.5 + 0.5 * Math.sin(this.age * t.writheRate * 0.7 + leg.phase) * (0.6 + stir * 0.4) : 0.3;
      this.pose(leg, t.writheHip * draw, t.writheKnee * draw);
    }
    this.curl(t.lyingCurl * (felt ? 1 : 0.3), _front.y > 0 ? 0.4 : -0.35);
  }

  private curl(spine: number, head: number): void {
    this.spine?.muscle!.pose.setFromAxisAngle(X_AXIS, spine);
    this.head?.muscle!.pose.setFromAxisAngle(X_AXIS, head);
  }

  private pose(leg: Leg, hip: number, knee: number): void {
    leg.hip.muscle!.pose.setFromAxisAngle(X_AXIS, -hip);
    const k = leg.knee?.muscle;
    if (k) k.pose.setFromAxisAngle(k.hingeAxis, clamp(knee, k.lo, k.hi));
  }

  /** Points an upper arm along a world direction, with this much bend at the elbow. */
  private aim(arm: Arm, dir: THREE.Vector3, bend: number): void {
    const chest = arm.shoulder.parent!;
    _a.copy(dir).applyQuaternion(_inv.copy(chest.q).conjugate());
    // A shoulder reaches behind the body much less than in front of it.
    if (_a.z < -0.45) {
      _a.z = -0.45;
      _a.normalize();
    }
    arm.shoulder.muscle!.pose.setFromUnitVectors(arm.rest, _a);
    const e = arm.elbow?.muscle;
    if (e) e.pose.setFromAxisAngle(e.hingeAxis, clamp(-bend, e.lo, e.hi));
  }

  /** Two-bone reach for a world point. The elbow goes out and back. */
  private reach(arm: Arm, target: THREE.Vector3): void {
    const { upper, fore } = arm;
    _dir.copy(target).sub(arm.shoulder.p);
    const d = clamp(_dir.length(), Math.abs(upper - fore) + 0.02, upper + fore - 0.01);
    _dir.normalize();
    const bend = Math.PI - Math.acos(clamp((upper * upper + fore * fore - d * d) / (2 * upper * fore), -1, 1));
    const lean = Math.acos(clamp((upper * upper + d * d - fore * fore) / (2 * upper * d), -1, 1));
    _b.copy(_left).multiplyScalar(arm.side * 0.7).addScaledVector(_front, -0.6).addScaledVector(_up, -0.3);
    _b.addScaledVector(_dir, -_b.dot(_dir));
    if (_b.lengthSq() > 1e-6) _b.normalize();
    _a.copy(_dir).multiplyScalar(Math.cos(lean)).addScaledVector(_b, Math.sin(lean));
    this.aim(arm, _a, bend);
  }

  private setStrengths(dt: number): void {
    const t = ReflexTuning;
    // A body that has died is not pushing: no push gain, no lift, and what it was holding fades as a gather's would.
    const fighting = (this.phase === 'struggle' || this.pushed) && this.dying < 0;
    const table = this.phase === 'fall' ? t.fall : this.phase === 'lying' ? t.lying : fighting ? t.struggle : t.gather;
    // A landing knocks the strength out of everything for a moment. It is why a hand on the floor gives instead of propping.
    const stunned = 1 - t.stunLoss * this.stun;
    const fading = this.dying >= 0 ? this.dying / t.dieSeconds : 1;
    const awake = smoothstep(0, t.reaction * 2, this.age - t.reaction);
    const scale = stunned * fading * (this.plank ? 1 : awake);
    // Giving out: the arms go first and the rest goes back to lying. Knocked down, all at once.
    const sag = this.slump < 0 ? 0 : this.knocked ? 1 : smoothstep(0, t.slumpSeconds, this.slump);
    const parts = this.rag.parts;
    const g = this.rag.gravity;
    let arms = 0;
    let armDrive = 0;
    let legs = 0;
    let legDrive = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const m = part.muscle!;
      if (!part.parent || m.role === null) continue;
      let want = table[m.role] * scale;
      if (this.phase === 'fall') {
        if (m.role === 'leg') want = lerp(want, t.plankLeg, this.plankLeft);
        else if (m.role === 'spine') want = lerp(want, t.plankSpine, this.plankLeft);
      }
      if (sag > 0) want = lerp(want, (m.role === 'arm' ? t.slumpArm : t.lying[m.role]) * scale, sag);
      m.drive = damp(m.drive, want, t.driveRate, dt);
      if (m.role === 'arm') {
        arms++;
        armDrive += m.drive;
      } else if (m.role === 'leg') {
        legs++;
        legDrive += m.drive;
      }
      // Knocked cold: the neck lets go on the spot, and the arms have nothing in them.
      if (this.knockout) {
        if (m.role === 'head' && this.age < t.koHead) m.drive = 0;
        else if (m.role === 'arm' && this.age < t.koSeconds) m.drive = Math.min(m.drive, t.koArm);
      }
      if (this.phase !== 'fall') m.gain = fighting && (m.role === 'arm' || m.role === 'leg') ? t.pushGain : 1;
      // A working muscle carries its own weight, as in a collapse, or an arm on the floor cannot lift itself off it.
      // Falling, the legs keep theirs: feet need it on the floor to tip over. The arms and head keep `fallCarry` of it.
      const carry = this.phase === 'fall' ? t.fallCarry : 1;
      if (m.role === 'arm' || m.role === 'head' || (m.role === 'leg' && this.phase !== 'fall')) part.body.setGravityScale(g * (1 - carry * m.drive), false);
    }
    const lift = this.lift;
    lift.force = 0;
    if (!fighting) return;
    // The lift rises with the effort toward the frame's heights, and is never more than its share of the body's weight times
    // the effort and the weaker of arms and legs: what they cannot push, it does not lift.
    const effort = this.pushed ? 1 : this.effort;
    const e = effort * effort * (3 - 2 * effort);
    const rag = this.rag;
    lift.hipsY = this.groundY + lerp(this.fromHips, this.keyHips, e) - t.assistSlack;
    lift.chestY = this.groundY + lerp(this.fromChest, this.keyChest, e) - t.assistSlack;
    lift.chest = this.spine;
    lift.band = t.assistBand;
    lift.damping = t.assistDamping;
    // As a share of the strength they push with, so the lift is all there with arms and legs at it.
    const limbs = Math.min(arms > 0 ? armDrive / arms / t.struggle.arm : 0, legs > 0 ? legDrive / legs / t.struggle.leg : 0);
    const shake = 1 + t.wobble * this.hurt * Math.sin(this.age * t.wobbleRate + this.seed) * Math.sin(this.age * t.wobbleRate * 0.31);
    lift.force = t.assistMax * rag.mass * -GRAVITY * g * clamp(Math.min(1, effort / t.assistFull) * limbs * shake * (1 - sag));
  }
}
