/**
 * What a ragdoll has that a bag of hinges does not: tension.
 *
 * Hard limits let a joint move at full speed and stop dead, so nothing that happens to a limb reaches the rest
 * of the body and it reads as weightless. This layer gives every joint a ligament, a resting posture, a reaction
 * to being hit, and for a body that is still dying, the muscles that hold it up.
 *
 * Every torque here is written into RagPart.tau, which Rag already sends to Rapier once per body, so a muscle adds
 * no calls across the WASM boundary. Only a ligament at work adds one, for the linear impulse in RagPart.push. Each
 * torque goes on the child with its reaction on the parent, so a body can reshape itself but never spin itself up.
 */
import * as THREE from 'three';
import type { CharacterAnimation, CharacterInstance } from '../core/contracts';
import { clamp, lerp, mulberry32, smoothstep } from '../core/math';
import type { JointRole } from '../characters/rig';
import { GRAVITY, OWN_BLAST } from '../physics/Physics';
import type { Rag, RagPart } from './rag';

/** How a body goes down when it is not dropped outright. */
export interface CollapseOptions {
  /** Seconds from the first weakness to a limp body. Default `MuscleTuning.collapseSeconds`, at most 5. */
  duration?: number;
  /** What the character was moving at. The legs stumble on with it. */
  velocity?: THREE.Vector3;
  /** Death twitching once it is down, 0..1. */
  twitch?: number;
}

// Added the way core/gameplay.ts adds to the contracts, so the shared file stays out of this system's changes.
declare module '../core/contracts' {
  interface RagdollOptions {
    /** The hit that caused this, so limbs react too. Left out, it is worked out from `impulses`. */
    impact?: { dir: THREE.Vector3; strength: number };
    /** Death twitching, 0..1. Defaults to 1 for a body with no head, 0 otherwise. */
    twitch?: number;
    /** False runs this one body on hard limits, for comparison. Defaults to `MuscleTuning.enabled`. */
    muscles?: boolean;
  }
  interface GoreSystem {
    /**
     * A death with time in it. Takes ownership, like ragdoll, but muscles hold the live animation and fade out:
     * upper body first, then the legs give way. Falls back to a plain ragdoll past `GoreTuning.maxCollapses`.
     */
    collapse(char: CharacterInstance, options?: CollapseOptions): void;
  }
}

const flag = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('muscles');

export const MuscleTuning = {
  /** ?muscles=0 turns the whole layer off, for comparison: hard limits, instant ragdolls, no reactions. */
  enabled: flag !== '0',

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
  hardMarginStraight: 0.18,
  hardMarginFolded: 0.5,

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
  impactFull: 6.6,
  impactCurve: 1.5,
  /** Per-body radial blast strength that counts as full strength. */
  blastFull: 95,
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
  /** Natural frequency and damping ratio of the hold on the hips. */
  hipRate: 11,
  hipDamping: 1,
  /** Point in the collapse where the feet stumble, and how fast. */
  stumbleAt: 0.42,
  stumbleSpeed: 1.3,
  /** Above this speed, in m/s, a body staggers on the way it was going. Below it, anywhere. */
  stumbleOnward: 0.4,
  /** Spread on the stagger and the topple, so that no two go down alike. */
  fallSpreadMin: 0.7,
  fallSpreadMax: 1.25,
  /** Drift dies away at this rate, in 1/s, with nothing left to steer it. */
  driftDecay: 2.2,
  /** Point where the torso tips the way it staggered, and how hard, in m/s. Folded straight down, a body sits. */
  toppleAt: 0.72,
  toppleSpeed: 1.6,
  /** A hit during a collapse brings the end this much closer: time runs this many times faster from then on. */
  dropPace: 4,

  /** Seconds that twitching lasts after the body goes limp. */
  twitchSeconds: 4.5,
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
  return clamp(force / mass / t.impactFull) ** t.impactCurve;
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
  weakLeg = 1;

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

/** Enough for a spasm to reach every joint of a person. */
const MAX_BURST = 12;
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
 * The child turns about the joint it hangs from, so it takes a linear impulse along with the torque. Most of the
 * momentum in a swinging limb is its centre of mass travelling, which a pure couple only reaches through the
 * solver, and four iterations cannot do that within a step: sized to stop the limb it overshoots and pumps energy
 * in, sized for the free body it is too weak to stop an arm. The parent stays a free body, which errs soft.
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

/** Muscle state of one Rag. */
export class MuscleState {
  /** Seconds since the body let go of itself. Infinite on a corpse that was shot awake: it has no tone left. */
  limp = 0;
  /** Strength of death twitching, 0 once it is over. */
  twitch = 0;
  collapse: CollapseDrive | null = null;
  private readonly rng: () => number;
  private readonly slump: number;
  private totalMass = 1;
  private meanMass = 1;
  /** Inertia of the whole chain about its root, for holding the hips. */
  private bodyInertia = 1;
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

  /**
   * A blast moves a body as one mass. Equal impulses would give a forearm ten times the speed of the hips and fling
   * every limb straight back, leaving nothing for `kick` to do. The chain's total stays what it was.
   */
  blastShare(part: RagPart): number {
    return lerp(1, part.mass / this.meanMass, MuscleTuning.blastEvenness);
  }

  /** True while the body must not count as settled. */
  get busy(): boolean {
    return this.collapse !== null || this.twitch > 0 || this.weightless;
  }

  /** True while muscles are moving the body themselves, so a sleeping one has to wake for them. */
  get driving(): boolean {
    return this.collapse !== null || this.burstLeft > 0 || this.weightless;
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
      m.load = Math.max(_b.length() * WEIGHT, 1e-3);
      m.stand = m.load;
      if (m.role === 'leg' && legs > 0) {
        // A leg's lever on the weight above it is short, because a standing leg is nearly straight.
        m.stand += t.standShare * (above / legs) * WEIGHT * (_b.length() / Math.max(massBelow, 1e-3));
      }
    }

    this.merged.length = 0;
    for (let i = 0; i < info.count; i++) {
      const relax = defs[i]!.relax;
      if (!relax || defs[i]!.ragdoll !== 'merge' || rag.mask[i] !== 1) continue;
      this.merged.push({ bone: i, rest: fromRotationVector(relax, new THREE.Quaternion()) });
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
      const q = _q.copy(p.q).conjugate().multiply(c.q);
      const rel = _rel.copy(c.w).sub(p.w);
      const free = 1 - m.drive;
      if (c.hinge) this.hinge(c, p, m, q, rel, ligament * free, tone * free, dt);
      else this.ball(c, p, m, q, rel, ligament * free, tone * free, dt);
    }
    if (this.twitch > 0) this.stepTwitch(dt);
    if (drive) this.holdHips(drive, dt);
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
      const back = 1 - this.collapse!.support;
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
      const back = 1 - this.collapse!.support;
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
    return (m.drive * m.stand) / MuscleTuning.driveDroop;
  }

  /** Once a frame. Tone and ligaments change slowly, and jointless bones have no physics to keep up with. */
  advance(dt: number, bones: readonly THREE.Bone[]): void {
    const t = MuscleTuning;
    const { rag } = this;
    this.hold = Math.min(1, rag.age / t.limitRise);
    this.ligament = 1 - smoothstep(t.limitLetGoStart, t.limitLetGoEnd, rag.quiet);
    this.elastic = smoothstep(t.limitElasticLow, t.limitElasticHigh, rag.speed);
    if (this.collapse) return;
    if (!this.weightless || this.limp < t.toneHold) this.limp += dt;
    const tone = smoothstep(0, t.toneRise, this.limp) * (1 - smoothstep(t.toneHold, t.toneHold + t.toneFade, this.limp));
    this.tone = tone;
    if (tone <= 0) return;
    const k = 1 - Math.exp(-t.mergedRate * tone * dt);
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
    this.twitch = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Rotational impact
  // -------------------------------------------------------------------------------------------

  /**
   * Throws the limbs as well as the torso. `dir` is the way the hit pushes. A blast in front of a body sends its
   * arms back with the blast and its legs forward, because the feet were resisting while the torso moved.
   */
  kick(dir: THREE.Vector3, strength: number): void {
    if (strength <= 0 || !Number.isFinite(strength + dir.x + dir.y + dir.z)) return;
    const { rag, rng } = this;
    const t = MuscleTuning;
    const parts = rag.parts;
    // A frozen corpse has given up its bodies, and a blast can still reach it.
    if (parts.length === 0) return;
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
    drive.weakLeg = this.rng() < 0.5 ? 1 : -1;
    this.collapse = drive;
    this.limp = 0;
    this.tone = 1;
    this.sampleStrengths(drive);
    this.readPose(drive);
  }

  /** Something hit a body that was going down anyway. It stops trying. */
  dropNow(): void {
    if (this.collapse) this.collapse.pace = MuscleTuning.dropPace;
  }

  /** Runs once a frame, before Rag.drive. Moves the ghost, runs the animator, reads the joint targets. */
  sampleCollapse(dt: number): void {
    const drive = this.collapse;
    // Animators divide by the step, and a paused game has none.
    if (!drive || dt <= 0) return;
    const t = MuscleTuning;
    drive.time += dt * drive.pace;
    const u = drive.time / drive.duration;
    if (u >= 1) {
      this.endCollapse();
      return;
    }
    if (!drive.stumbled && u >= t.stumbleAt) this.stumble(drive);
    if (!drive.toppled && u >= t.toppleAt) this.topple(drive);
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
    // Onward if it was moving, somewhere random if it was not. The animator takes real steps to keep up.
    const speed = Math.hypot(drive.drift.x, drive.drift.z);
    if (speed > MuscleTuning.stumbleOnward) drive.away.set(drive.drift.x / speed, 0, drive.drift.z / speed);
    else {
      const a = rng() * Math.PI * 2;
      drive.away.set(Math.cos(a), 0, Math.sin(a));
    }
    drive.drift.addScaledVector(drive.away, MuscleTuning.stumbleSpeed * this.spread());
  }

  private spread(): number {
    return lerp(MuscleTuning.fallSpreadMin, MuscleTuning.fallSpreadMax, this.rng());
  }

  private topple(drive: CollapseDrive): void {
    drive.toppled = true;
    // Whatever sits on the spine goes over, and takes the rest with it.
    const parts = this.rag.parts;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (part.muscle!.role !== 'spine') continue;
      const push = part.mass * MuscleTuning.toppleSpeed * this.spread();
      _vec.x = drive.away.x * push;
      _vec.y = 0;
      _vec.z = drive.away.z * push;
      part.body.applyImpulse(_vec, true);
    }
  }

  private sampleStrengths(drive: CollapseDrive): void {
    const t = MuscleTuning;
    const u = drive.time / drive.duration;
    drive.support = fade(t.supportFade, u, 0);
    const parts = this.rag.parts;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const m = part.muscle!;
      if (!part.parent) {
        m.drive = drive.support;
      } else if (m.role === 'leg') {
        const side = this.rag.info.bind[part.bone * 3]! >= 0 ? 1 : -1;
        m.drive = fade(t.legFade, u, side === drive.weakLeg ? t.weakLegLead : 0);
      } else {
        m.drive = fade(m.role === 'head' ? t.headFade : m.role === 'arm' ? t.armFade : t.spineFade, u, 0);
      }
      // A muscle that still works carries its own weight, which the solver then does not have to fight for it. Not
      // the legs: weightless feet have no friction, and they slide out from under the body.
      part.body.setGravityScale(m.role === 'leg' ? 1 : 1 - m.drive, false);
    }
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
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      part.muscle!.drive = 0;
      part.body.setGravityScale(1, true);
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
    if (this.collapse) return;
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
