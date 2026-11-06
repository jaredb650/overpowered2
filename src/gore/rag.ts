/**
 * Rigid-body bone chains. A Rag is any set of bones driven by physics: a whole body, a severed arm, or the
 * top half of a bisected enemy all run through the same code.
 *
 * Every body's frame IS its bone's world frame (origin at the joint, identity at bind pose), so a joint
 * anchor on the child side is always the zero vector and limits read straight off relative rotation.
 *
 * Bones are driven by rotation only, down the hierarchy from the chain root. Whatever Rapier's joints do
 * under a rocket-sized impulse, the mesh cannot stretch, because bone lengths never change.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CG, type PhysicsSystem } from '../core/contracts';
import { DevFlags } from '../core/devflags';
import { groups } from '../physics/Physics';
import type { BoneDef, RigDef } from '../characters/rig';
import { invInertia, JointMuscle, MuscleState, MuscleTuning, splitSwing, swingReach, swingTwist } from './muscles';
import { MAX_BONES, rigInfo, type RigInfo } from './rigInfo';

export interface RagSource {
  readonly rig: RigDef;
  readonly root: THREE.Object3D;
  readonly bones: readonly THREE.Bone[];
}

/** Six floats per bone: linear then angular velocity, world space. */
export const SEED_STRIDE = 6;

export interface RagBuild {
  /** First bone of the chain. 0 for a whole body. */
  chainRoot: number;
  /** 1 for each bone in the chain. */
  mask: Uint8Array;
  /** Per-bone start velocity. Null starts at rest. */
  seeds: Float32Array | null;
  /** Membership for colliders. Bodies are CG.Ragdoll, loose limbs CG.Gib. */
  membership: number;
  collidesWith: number;
  restitution: number;
  friction: number;
  /** Total mass of this rig, of which the chain takes its share by volume. */
  massScale?: number;
  /** Runs the chain on the muscle layer. Without it, joints have hard limits and nothing else. */
  muscles?: boolean;
}

/** Joint feel. All rates are 1/seconds, applied through exp() so they do not depend on the step length. */
export const RagTuning = {
  /** Base relative damping across a joint. High enough that nothing flutters. */
  jointDamping: 7,
  /**
   * Extra damping just after death, fading over `toneFade` seconds, so a body sags instead of snapping. It
   * comes in over `toneRise` rather than at once, or it would eat the motion the animation handed over.
   */
  toneDamping: 16,
  toneFade: 0.35,
  toneRise: 0.06,
  /** Extra damping once a body is nearly still. Kills the last jitter so it can freeze. */
  restDamping: 24,
  /** Fraction of a limit violation removed per step, and the fastest it may be corrected in rad/s. */
  limitBeta: 0.3,
  limitMaxSpeed: 4,
  /** Limits take hold over this long. A running stride starts past them, and must not get yanked back at death. */
  limitRise: 0.25,
  /** Twist stops being meaningful as swing nears a half turn, so its limit fades out between these. */
  twistFadeStart: 1.2,
  twistFadeEnd: 2.2,
  /** Below this speed for `quietTime`, the whole body starts losing spin. Nothing dead whirls in place. */
  quietSpeed: 0.7,
  quietTime: 0.2,
  quietDamping: 18,
  /** After this long quiet, limits let go: an arm wedged past its limit by the floor should stay wedged. */
  limitsOffAfter: 0.5,
  linearDamping: 0.08,
  angularDamping: 0.75,
  /** Hit capsules are generous for gunplay. Colliders are slimmer so limbs rest on the mesh surface. */
  colliderScale: 0.88,
  /** Hard ceiling on any single body's speed change from one impulse. A forearm is a few kilos, so this is what keeps it on. */
  maxImpulseSpeed: 9,
  /** Fastest a blast can throw a whole chain, in m/s. At this speed a body lands about 5 m out. */
  maxBlastSpeed: 10,
  maxSeedSpeed: 14,
  maxSeedSpin: 18,
};

/** Asymmetric swing limits for joints that do not reach equally in all directions. Radians. */
export interface SwingShape {
  forward: number;
  back: number;
  out: number;
  in: number;
  /** +1 on the character's left. Flips which sign of z is outward. */
  side: number;
}

function swingShape(def: BoneDef): SwingShape | null {
  const cone = def.joint?.cone ?? 0;
  const side = def.offset[0] >= 0 ? 1 : -1;
  if (def.name.startsWith('thigh')) return { forward: cone * 1.3, back: 0.4, out: 0.9, in: 0.3, side };
  if (def.name.startsWith('upperArm')) return { forward: cone, back: 0.9, out: cone, in: 0.6, side };
  return null;
}

export class RagPart {
  bone = -1;
  body!: RAPIER.RigidBody;
  parent: RagPart | null = null;
  joint: RAPIER.ImpulseJoint | null = null;
  hinge = false;
  cone = 0;
  twist = 0;
  shape: SwingShape | null = null;
  /** Where this joint sits on the parent, in the parent's frame. */
  readonly anchor = new THREE.Vector3();
  /** Twist axis in bind space, which is both parent and child local space at rest. */
  readonly axis = new THREE.Vector3(0, 1, 0);
  /** Diagonal inverse inertia in the principal frame. */
  readonly invI = new THREE.Vector3();
  readonly frame = new THREE.Quaternion();
  mass = 1;
  /** Centre of mass in the body's frame. */
  readonly com = new THREE.Vector3();
  /** Null when the chain runs on hard limits. */
  muscle: JointMuscle | null = null;
  /** Speed at the last measure. */
  speed = 0;
  /** Scratch filled each step. */
  readonly q = new THREE.Quaternion();
  readonly p = new THREE.Vector3();
  readonly w = new THREE.Vector3();
  readonly v = new THREE.Vector3();
  readonly tau = new THREE.Vector3();
  /** Linear impulse for this step. Zero unless a ligament is at work, so it rarely crosses into Rapier. */
  readonly push = new THREE.Vector3();
}

const _pos: THREE.Vector3[] = Array.from({ length: MAX_BONES }, () => new THREE.Vector3());
const _rot: THREE.Quaternion[] = Array.from({ length: MAX_BONES }, () => new THREE.Quaternion());
const _lpos: THREE.Vector3[] = Array.from({ length: MAX_BONES }, () => new THREE.Vector3());
const _lrot: THREE.Quaternion[] = Array.from({ length: MAX_BONES }, () => new THREE.Quaternion());
const _wq: THREE.Quaternion[] = Array.from({ length: MAX_BONES }, () => new THREE.Quaternion());
const _scale = new THREE.Vector3();
const _rootPos = new THREE.Vector3();
const _rootRot = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _inv = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _vec = { x: 0, y: 0, z: 0 };
const _zero = { x: 0, y: 0, z: 0 };

function readPose(src: RagSource, count: number, chainMask: Uint8Array | null): void {
  src.root.updateMatrixWorld(true);
  for (let i = 0; i < count; i++) {
    if (chainMask && chainMask[i] !== 1) continue;
    src.bones[i]!.matrixWorld.decompose(_pos[i]!, _rot[i]!, _scale);
  }
}

/**
 * Estimates each bone's velocity by stepping the animation a moment ahead and differencing, then restoring
 * the pose. It needs no per-frame tracking of living characters, so the cost is paid only at the moment of
 * death, and it captures whatever the animation is doing: stride, flinch, recoil.
 */
export function measureAnimVelocity(
  src: RagSource, anim: { update(dt: number, lod: number): void }, velocity: THREE.Vector3 | null | undefined, out: Float32Array,
): void {
  const n = src.rig.bones.length;
  const h = 1 / 90;
  // Animators can move the root too, for foot planting. That belongs to this probe, not to the pose.
  _rootPos.copy(src.root.position);
  _rootRot.copy(src.root.quaternion);
  readPose(src, n, null);
  for (let i = 0; i < n; i++) {
    const b = src.bones[i]!;
    _lpos[i]!.copy(b.position);
    _lrot[i]!.copy(b.quaternion);
    _wq[i]!.copy(_rot[i]!);
    out[i * SEED_STRIDE] = _pos[i]!.x;
    out[i * SEED_STRIDE + 1] = _pos[i]!.y;
    out[i * SEED_STRIDE + 2] = _pos[i]!.z;
  }
  anim.update(h, 0);
  readPose(src, n, null);
  const vx = velocity?.x ?? 0;
  const vy = velocity?.y ?? 0;
  const vz = velocity?.z ?? 0;
  const maxV = RagTuning.maxSeedSpeed;
  const maxW = RagTuning.maxSeedSpin;
  for (let i = 0; i < n; i++) {
    const o = i * SEED_STRIDE;
    _a.set(_pos[i]!.x - out[o]!, _pos[i]!.y - out[o + 1]!, _pos[i]!.z - out[o + 2]!).divideScalar(h).clampLength(0, maxV);
    out[o] = _a.x + vx;
    out[o + 1] = _a.y + vy;
    out[o + 2] = _a.z + vz;
    _q.copy(_wq[i]!).conjugate().premultiply(_rot[i]!);
    if (_q.w < 0) _q.set(-_q.x, -_q.y, -_q.z, -_q.w);
    _a.set(_q.x, _q.y, _q.z).multiplyScalar(2 / h).clampLength(0, maxW);
    out[o + 3] = _a.x;
    out[o + 4] = _a.y;
    out[o + 5] = _a.z;
    const b = src.bones[i]!;
    b.position.copy(_lpos[i]!);
    b.quaternion.copy(_lrot[i]!);
  }
  src.root.position.copy(_rootPos);
  src.root.quaternion.copy(_rootRot);
  src.root.updateMatrixWorld(true);
}

/** Linear motion only, for a limb cut from something that has no animation worth sampling. */
export function fillVelocity(count: number, velocity: THREE.Vector3 | null | undefined, out: Float32Array): void {
  out.fill(0, 0, count * SEED_STRIDE);
  if (!velocity) return;
  for (let i = 0; i < count; i++) {
    out[i * SEED_STRIDE] = velocity.x;
    out[i * SEED_STRIDE + 1] = velocity.y;
    out[i * SEED_STRIDE + 2] = velocity.z;
  }
}

let nextSolverSlot = 0;

export class Rag {
  readonly parts: RagPart[] = [];
  readonly info: RigInfo;
  /** Bones in the chain, parents before children. */
  private order: number[] = [];
  /** Bone index to its RagPart, or null when it rides on another bone. */
  private partOf: (RagPart | null)[] = [];
  /** The chain root's frame when it has no body of its own: the transform from it to `rootPart`. */
  private readonly viaPos = new THREE.Vector3();
  private readonly viaRot = new THREE.Quaternion();
  private rootPart!: RagPart;
  /** Chain root's parent, relative to the source root. */
  private readonly parentPos = new THREE.Vector3();
  private readonly parentRotInv = new THREE.Quaternion();
  age = 0;
  /** Seconds spent below the settle speed. */
  calm = 0;
  /** Seconds with almost no linear motion, however much anything is spinning. */
  quiet = 0;
  /** Highest body speed seen this frame. */
  speed = 0;
  /** Momentum the whole chain lost this frame. Joints and muscles are internal and cancel, so only contact shows. */
  thud = 0;
  /** The speed of the whole chain going into this frame. */
  thudSpeed = 0;
  /** The part that lost the most, which is where the chain hit something. Null if none did. */
  thudPart: RagPart | null = null;
  /** That part's speed going into this frame. */
  thudPartSpeed = 0;
  /**
   * World time the chain may next be heard landing as a whole, and a part of it alone. They are kept apart so that a
   * hand touching down first cannot use up the cooldown of the body arriving behind it.
   */
  nextThud = 0;
  nextPartThud = 0;
  /** Total mass of the bodies in the chain. */
  mass = 1;
  private momentum = 0;
  /** Lower-body height signal for smears: world position of the chain root. */
  readonly center = new THREE.Vector3();
  active = false;
  readonly mask: Uint8Array;
  readonly muscle: MuscleState | null;

  constructor(
    readonly physics: PhysicsSystem,
    readonly source: RagSource,
    readonly build: RagBuild,
  ) {
    this.info = rigInfo(source.rig);
    this.mask = build.mask.slice();
    this.partOf = new Array<RagPart | null>(this.info.count).fill(null);
    this.muscle = build.muscles ? new MuscleState(this) : null;
    this.create(build.seeds);
  }

  private create(seeds: Float32Array | null): void {
    const { physics, source, info, mask, build } = this;
    const { R, world } = physics;
    const rig = source.rig;
    const n = info.count;
    readPose(source, n, mask);

    this.order.length = 0;
    this.partOf.fill(null);
    this.parts.length = 0;
    for (let i = build.chainRoot; i < n; i++) if (mask[i] === 1) this.order.push(i);

    const defs = rig.bones;
    // Bones that get a body. A chain with none (a rig with only 'merge' here) still needs one.
    let any = false;
    for (const i of this.order) {
      if (defs[i]!.ragdoll !== 'body') continue;
      any = true;
      const part = new RagPart();
      part.bone = i;
      this.partOf[i] = part;
      this.parts.push(part);
    }
    if (!any) {
      const part = new RagPart();
      part.bone = build.chainRoot;
      this.partOf[build.chainRoot] = part;
      this.parts.push(part);
    }

    // Each bone's capsule goes on the nearest body above it, or below it for a merged chain root.
    const owner = new Array<RagPart | null>(n).fill(null);
    for (const i of this.order) {
      let p: number = i;
      while (p >= 0 && mask[p] === 1 && !this.partOf[p]) p = defs[p]!.parent;
      owner[i] = p >= 0 && mask[p] === 1 ? this.partOf[p] : null;
    }
    const first = this.parts[0]!;
    for (const i of this.order) owner[i] ??= first;

    let volume = 0;
    for (const i of this.order) volume += info.volume[i]!;
    const density = (info.mass * (build.massScale ?? 1)) / Math.max(wholeVolume(info), 1e-6);
    const totalMass = Math.max(volume * density, 0.5);

    const solverBit = 1 << (nextSolverSlot++ & 15);
    const solverGroups = groups(solverBit, 0xffff & ~solverBit);
    const collisionGroups = groups(build.membership, build.collidesWith);

    for (const part of this.parts) {
      const i = part.bone;
      const seed = seeds ? i * SEED_STRIDE : -1;
      const p = _pos[i]!;
      const q = _rot[i]!;
      const desc = R.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setRotation(q)
        .setLinearDamping(RagTuning.linearDamping)
        .setAngularDamping(RagTuning.angularDamping);
      part.body = world.createRigidBody(desc);

      _inv.copy(q).invert();
      let attached = 0;
      for (const b of this.order) {
        if (owner[b] !== part) continue;
        const hit = defs[b]!.hit;
        if (!hit) continue;
        // Capsule ends in this body's frame, through the bone that owns them.
        _a.set(hit.from[0], hit.from[1], hit.from[2]).applyQuaternion(_rot[b]!).add(_pos[b]!).sub(p).applyQuaternion(_inv);
        _b.set(hit.to[0], hit.to[1], hit.to[2]).applyQuaternion(_rot[b]!).add(_pos[b]!).sub(p).applyQuaternion(_inv);
        _c.copy(_b).sub(_a);
        const len = _c.length();
        const radius = hit.radius * RagTuning.colliderScale;
        const mass = Math.max((info.volume[b]! / Math.max(volume, 1e-6)) * totalMass, 0.05);
        const col = R.ColliderDesc.capsule(Math.max(len * 0.5, 1e-3), radius)
          .setTranslation((_a.x + _b.x) * 0.5, (_a.y + _b.y) * 0.5, (_a.z + _b.z) * 0.5)
          .setRotation(_q.setFromUnitVectors(_up, len > 1e-5 ? _c.divideScalar(len) : _up))
          .setMass(mass)
          .setFriction(build.friction)
          .setRestitution(build.restitution)
          .setCollisionGroups(collisionGroups)
          .setSolverGroups(solverGroups);
        world.createCollider(col, part.body);
        attached++;
      }
      if (attached === 0) {
        world.createCollider(
          R.ColliderDesc.ball(0.06).setMass(0.5).setCollisionGroups(collisionGroups).setSolverGroups(solverGroups),
          part.body,
        );
      }
      part.mass = part.body.mass();
      part.body.localCom(part.com);
      const inv = part.body.invPrincipalInertia();
      part.invI.set(inv.x, inv.y, inv.z);
      const frame = part.body.principalInertiaLocalFrame();
      part.frame.set(frame.x, frame.y, frame.z, frame.w);

      if (seeds) {
        // Seeds describe the bone origin. Rapier wants the centre of mass, which swings with the spin.
        const wx = seeds[seed + 3]!;
        const wy = seeds[seed + 4]!;
        const wz = seeds[seed + 5]!;
        const com = part.body.worldCom();
        _a.set(wx, wy, wz);
        _b.set(com.x - p.x, com.y - p.y, com.z - p.z);
        _c.crossVectors(_a, _b);
        _vec.x = seeds[seed]! + _c.x;
        _vec.y = seeds[seed + 1]! + _c.y;
        _vec.z = seeds[seed + 2]! + _c.z;
        part.body.setLinvel(_vec, true);
        _vec.x = wx;
        _vec.y = wy;
        _vec.z = wz;
        part.body.setAngvel(_vec, true);
      }
    }

    // Joints between each body and the nearest body above it.
    for (const part of this.parts) {
      let p = defs[part.bone]!.parent;
      while (p >= 0 && mask[p] === 1 && !this.partOf[p]) p = defs[p]!.parent;
      const parent = p >= 0 && mask[p] === 1 ? this.partOf[p]! : null;
      if (!parent) continue;
      part.parent = parent;
      const def = defs[part.bone]!;
      const joint = def.joint;
      _inv.copy(_rot[parent.bone]!).invert();
      _a.copy(_pos[part.bone]!).sub(_pos[parent.bone]!).applyQuaternion(_inv);
      part.anchor.copy(_a);
      const axisIndex = part.bone * 3;
      part.axis.set(info.axis[axisIndex]!, info.axis[axisIndex + 1]!, info.axis[axisIndex + 2]!);
      if (joint?.kind === 'hinge') {
        part.hinge = true;
        const ax = joint.axis ?? [1, 0, 0];
        // The animation may hold this joint slightly off its hinge axis. Using the child's own view of the
        // axis keeps that offset instead of snapping it straight on the first step.
        _b.set(ax[0], ax[1], ax[2]);
        _q.copy(_rot[part.bone]!).invert().multiply(_rot[parent.bone]!);
        _c.copy(_b).applyQuaternion(_q);
        const data = R.JointData.revoluteWithAxes(_a, _zero, _b, _c);
        const hinge = world.createImpulseJoint(data, parent.body, part.body, true) as RAPIER.RevoluteImpulseJoint;
        hinge.setContactsEnabled(false);
        // Rig limits are stated child-to-parent; Rapier measures parent-to-child, so the sign flips.
        let lo = -(joint.max ?? 0);
        let hi = -(joint.min ?? 0);
        if (build.muscles) {
          // The ligaments do the stopping. This is only there for what they cannot catch.
          lo -= lo === 0 ? MuscleTuning.hardMarginStraight : MuscleTuning.hardMarginFolded;
          hi += hi === 0 ? MuscleTuning.hardMarginStraight : MuscleTuning.hardMarginFolded;
        }
        const current = hingeAngle(_rot[parent.bone]!, _rot[part.bone]!, _b);
        lo = Math.min(lo, current - 0.02);
        hi = Math.max(hi, current + 0.02);
        hinge.setLimits(lo, hi);
        part.joint = hinge;
      } else {
        part.cone = joint?.cone ?? 0.7;
        part.twist = joint?.twist ?? 0.6;
        part.shape = swingShape(def);
        const ball = world.createImpulseJoint(R.JointData.spherical(_a, _zero), parent.body, part.body, true);
        ball.setContactsEnabled(false);
        part.joint = ball;
      }
    }

    this.muscle?.bind();
    this.bindDrive();
    this.momentum = 0;
    this.active = true;
    this.calm = 0;
    this.quiet = 0;
    this.age = 0;
  }

  /** Works out how to pose the chain root from its body, and moves the source root onto it. */
  private bindDrive(): void {
    const { source, build } = this;
    const defs = source.rig.bones;
    const root = build.chainRoot;
    const part = this.partOf[root];
    if (part) {
      this.rootPart = part;
      this.viaPos.set(0, 0, 0);
      this.viaRot.identity();
    } else {
      // A merged chain root (spine, neck): find the first body under it and remember the path.
      const target = this.parts[0]!;
      this.rootPart = target;
      _q.identity();
      _a.set(0, 0, 0);
      const chain: number[] = [];
      for (let b = target.bone; b !== root; b = defs[b]!.parent) chain.push(b);
      for (let k = chain.length - 1; k >= 0; k--) {
        const bone = source.bones[chain[k]!]!;
        _b.copy(bone.position).applyQuaternion(_q);
        _a.add(_b);
        _q.multiply(bone.quaternion);
      }
      this.viaPos.copy(_a);
      this.viaRot.copy(_q);
    }

    // Reset the source root so "world" and "relative to the source root" differ only by a translation.
    const srcRoot = source.root;
    srcRoot.position.set(0, 0, 0);
    srcRoot.quaternion.identity();
    srcRoot.updateMatrixWorld(true);
    const parent = source.bones[root]!.parent ?? srcRoot;
    parent.matrixWorld.decompose(this.parentPos, this.parentRotInv, _scale);
    this.parentRotInv.invert();
    this.drive();
  }

  /** Copies body poses onto the bones. Call once per frame, after the physics step. */
  drive(): void {
    const { parts, order, source, partOf } = this;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      part.body.translation(part.p);
      part.body.rotation(part.q);
    }
    const defs = source.rig.bones;
    const bones = source.bones;
    const rootBone = this.build.chainRoot;
    const rp = this.rootPart;
    const wq = _wq[rootBone]!;
    wq.copy(this.viaRot).invert().premultiply(rp.q);
    _a.copy(this.viaPos).applyQuaternion(wq);
    this.center.copy(rp.p).sub(_a);

    source.root.position.copy(this.center);
    const chain = bones[rootBone]!;
    // Parent frame is fixed relative to the source root, which now sits on the chain root.
    chain.position.copy(this.parentPos).negate().applyQuaternion(this.parentRotInv);
    chain.quaternion.copy(this.parentRotInv).multiply(wq);

    for (let k = 1; k < order.length; k++) {
      const b = order[k]!;
      const part = partOf[b];
      const pq = _wq[defs[b]!.parent]!;
      if (part) {
        _wq[b]!.copy(part.q);
        bones[b]!.quaternion.copy(pq).invert().multiply(part.q);
      } else {
        _wq[b]!.copy(pq).multiply(bones[b]!.quaternion);
      }
    }
    source.root.updateMatrixWorld(true);
  }

  /** Joint damping and soft limits. Runs before every physics sub-step. */
  preStep(dt: number): void {
    const parts = this.parts;
    const n = parts.length;
    if (n < 2) return;
    // Rapier keeps a velocity given to a sleeping body and reports it for good, without ever moving it, and a body
    // that looks like it is moving never settles. A chain sleeps as one island, so one body answers for all of it.
    if (this.muscle && !this.muscle.busy && parts[0]!.body.isSleeping()) return;
    for (let i = 0; i < n; i++) {
      const part = parts[i]!;
      part.body.rotation(part.q);
      part.body.angvel(part.w);
      part.tau.set(0, 0, 0);
      part.push.set(0, 0, 0);
    }
    const t = RagTuning;
    const muscle = this.muscle;
    const tone = t.toneDamping * Math.min(1, this.age / t.toneRise) * Math.exp(-this.age / t.toneFade);
    const rate = t.jointDamping * Math.min(1, this.age / t.toneRise) + tone + (this.calm > 0 ? t.restDamping : 0);
    const damp = 1 - Math.exp(-rate * dt);
    const hush = this.quiet > t.quietTime ? 1 - Math.exp(-t.quietDamping * dt) : 0;
    for (let i = 0; i < n; i++) {
      const c = parts[i]!;
      if (hush > 0) {
        const spin = c.w.length();
        if (spin > 1e-3) {
          _b.copy(c.w).divideScalar(spin);
          c.tau.addScaledVector(_b, (-hush * spin) / invInertia(c, _b));
        }
      }
      const p = c.parent;
      if (!p) continue;
      const rel = _a.copy(c.w).sub(p.w);
      const mag = rel.length();
      if (mag > 1e-4) {
        _b.copy(rel).divideScalar(mag);
        const lambda = (damp * mag) / (invInertia(p, _b) + invInertia(c, _b));
        c.tau.addScaledVector(_b, -lambda);
        p.tau.addScaledVector(_b, lambda);
      }
      if (!muscle && !c.hinge && this.quiet < t.limitsOffAfter) this.limit(c, p, rel, dt);
    }
    muscle?.step(dt);
    const wake = muscle?.driving === true;
    for (let i = 0; i < n; i++) {
      const part = parts[i]!;
      if (part.tau.lengthSq() > 1e-10) part.body.applyTorqueImpulse(part.tau, wake);
      if (part.push.lengthSq() > 1e-10) part.body.applyImpulse(part.push, wake);
    }
  }

  private limit(c: RagPart, p: RagPart, rel: THREE.Vector3, dt: number): void {
    const hold = Math.min(1, this.age / RagTuning.limitRise);
    if (hold <= 0) return;
    // Relative rotation in the parent's frame, which at rest is identity.
    const q = _q.copy(p.q).conjugate().multiply(c.q);
    splitSwing(q, c.axis);
    const { angle, twist, x, y, z, hasSwing } = swingTwist;
    if (hasSwing) {
      const excess = (angle - swingReach(c, x, z)) * hold;
      if (excess > 0) {
        _c.set(x, y, z).applyQuaternion(p.q);
        correct(c, p, _c, rel, excess, dt);
      }
    }
    const k = RagTuning;
    const weight = 1 - Math.min(1, Math.max(0, (angle - k.twistFadeStart) / (k.twistFadeEnd - k.twistFadeStart)));
    const twistExcess = (Math.abs(twist) - c.twist) * weight * hold;
    if (twistExcess > 0) {
      _c.copy(c.axis).applyQuaternion(p.q);
      if (twist < 0) _c.negate();
      correct(c, p, _c, rel, twistExcess, dt);
    }
  }

  applyImpulse(bone: number, point: THREE.Vector3, impulse: THREE.Vector3): void {
    // A frozen chain has handed its bodies back, and pushing one of those panics Rapier for the rest of the run.
    if (this.parts.length === 0) return;
    const part = this.partFor(bone);
    const force = DevFlags.force;
    const cap = RagTuning.maxImpulseSpeed * part.mass * Math.max(force, 1);
    const len = impulse.length() * force;
    // Rapier takes a NaN without complaint and the body then hangs frozen in mid-air for good.
    if (!Number.isFinite(len + point.x + point.y + point.z)) return;
    _d.copy(impulse).multiplyScalar(len > cap ? (force * cap) / len : force);
    part.body.applyImpulseAtPoint(_d, point, true);
  }

  /** Same falloff as Physics.radialImpulse, for bodies too new for it to find. */
  radialImpulse(center: THREE.Vector3, radius: number, strength: number): void {
    const muscle = this.muscle;
    // One direction for the whole chain: pushed along their own lines, the limbs shoot out sideways from the joints.
    if (muscle) _b.set(this.center.x - center.x, this.center.y - center.y + 0.5, this.center.z - center.z).normalize();
    const top = RagTuning.maxBlastSpeed * Math.max(DevFlags.force, 1);
    // A chain shares one ceiling: capped part by part, the light ones would stop short and the body would tear along them.
    let total = 0;
    let mass = 0;
    for (const part of this.parts) {
      part.body.translation(part.p);
      _a.set(part.p.x - center.x, part.p.y - center.y + 0.5, part.p.z - center.z);
      total += strength * Math.max(0, 1 - _a.length() / radius) * (muscle ? muscle.blastShare(part) : 1);
      mass += part.mass;
    }
    const limit = Math.abs(total) > top * mass ? (top * mass) / Math.abs(total) : 1;
    for (const part of this.parts) {
      _a.set(part.p.x - center.x, part.p.y - center.y + 0.5, part.p.z - center.z);
      const d = _a.length();
      const push = strength * Math.max(0, 1 - d / radius) * limit;
      if (muscle) _a.copy(_b).multiplyScalar(push * muscle.blastShare(part));
      else _a.multiplyScalar(push / Math.max(d, 0.2));
      part.body.applyImpulse(_a, true);
    }
  }

  /** The body that carries `bone`: its own, or the nearest above it. */
  partFor(bone: number): RagPart {
    const defs = this.source.rig.bones;
    for (let b = bone; b >= 0; b = defs[b]!.parent) {
      const part = this.partOf[b];
      if (part) return part;
    }
    return this.parts[0]!;
  }

  /** Largest distance between the two sides of any joint, in meters. A diagnostic: bones never show it. */
  jointGap(): number {
    let worst = 0;
    for (const part of this.parts) {
      const parent = part.parent;
      if (!parent) continue;
      parent.body.translation(parent.p);
      parent.body.rotation(parent.q);
      part.body.translation(part.p);
      _a.copy(part.anchor).applyQuaternion(parent.q).add(parent.p);
      worst = Math.max(worst, _a.distanceTo(part.p));
    }
    return worst;
  }

  /** Reads motion for settle detection. Call once per frame. */
  measure(dt: number, calmSpeed: number, calmSpin: number): void {
    let v = 0;
    let w = 0;
    let px = 0;
    let py = 0;
    let pz = 0;
    let mass = 0;
    let worst = 0;
    this.thudPart = null;
    const parts = this.parts;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      part.body.linvel(part.v);
      part.body.angvel(part.w);
      const sq = part.v.lengthSq();
      v = Math.max(v, sq);
      w = Math.max(w, part.w.lengthSq());
      const speed = Math.sqrt(sq);
      const lost = (part.speed - speed) * part.mass;
      part.speed = speed;
      if (lost > worst) {
        worst = lost;
        this.thudPart = part;
        this.thudPartSpeed = speed + lost / part.mass;
      }
      px += part.v.x * part.mass;
      py += part.v.y * part.mass;
      pz += part.v.z * part.mass;
      mass += part.mass;
    }
    const momentum = Math.hypot(px, py, pz);
    this.thud = this.momentum - momentum;
    this.thudSpeed = this.momentum / mass;
    this.momentum = momentum;
    this.mass = mass;
    this.speed = Math.sqrt(v);
    this.age += dt;
    this.muscle?.advance(dt, this.source.bones);
    // A body holding itself up, or twitching, is not a body at rest, however slowly it moves.
    const busy = this.muscle?.busy === true;
    if (this.speed < RagTuning.quietSpeed && !busy) this.quiet += dt;
    else this.quiet = 0;
    const still = w < calmSpin * calmSpin || this.quiet > RagTuning.limitsOffAfter;
    if (this.speed < calmSpeed && still && !busy) this.calm += dt;
    else this.calm = 0;
  }

  /** Writes current body velocities into `out`, indexed by bone, for rebuilding part of this chain. */
  writeSeeds(out: Float32Array): void {
    out.fill(0);
    for (const b of this.order) {
      const part = this.partFor(b);
      part.body.linvel(part.v);
      part.body.angvel(part.w);
      const o = b * SEED_STRIDE;
      out[o] = part.v.x;
      out[o + 1] = part.v.y;
      out[o + 2] = part.v.z;
      out[o + 3] = part.w.x;
      out[o + 4] = part.w.y;
      out[o + 5] = part.w.z;
    }
  }

  /** Removes `subtree` from this chain: its bodies go away and the bones stop being driven. */
  cut(subtree: Uint8Array): void {
    const { physics, parts, info } = this;
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i]!;
      if (subtree[part.bone] !== 1) continue;
      physics.world.removeRigidBody(part.body);
      this.partOf[part.bone] = null;
      parts.splice(i, 1);
    }
    for (let i = 0; i < info.count; i++) if (subtree[i] === 1) this.mask[i] = 0;
    this.order = this.order.filter(b => subtree[b] !== 1);
    // What left with the limb was not lost to anything.
    this.momentum = 0;
    if (this.active && parts.length > 0) this.muscle?.bind();
  }

  /** Takes every body out of the world. The pose stays on the bones. */
  freeze(): void {
    if (!this.active) return;
    this.muscle?.stop();
    for (const part of this.parts) this.physics.world.removeRigidBody(part.body);
    this.parts.length = 0;
    this.active = false;
  }

  /** Puts bodies back at the current pose, at rest. */
  wake(seeds: Float32Array | null = null): void {
    if (this.active) return;
    this.create(seeds);
    this.muscle?.spend();
  }

  /** Removes everything. The source's own lifetime is the caller's business. */
  destroy(): void {
    this.freeze();
  }
}

function wholeVolume(info: RigInfo): number {
  let v = 0;
  for (let i = 0; i < info.count; i++) v += info.volume[i]!;
  return v;
}

function hingeAngle(parent: THREE.Quaternion, child: THREE.Quaternion, axis: THREE.Vector3): number {
  const q = _q2.copy(parent).conjugate().multiply(child);
  const dot = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  let a = 2 * Math.atan2(dot, q.w);
  if (a > Math.PI) a -= Math.PI * 2;
  else if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Velocity-level soft constraint: stable at any stiffness, because it can only remove closing speed. */
function correct(c: RagPart, p: RagPart, axis: THREE.Vector3, rel: THREE.Vector3, excess: number, dt: number): void {
  const t = RagTuning;
  const target = -Math.min((excess * t.limitBeta) / dt, t.limitMaxSpeed);
  const current = rel.dot(axis);
  if (current <= target) return;
  const lambda = (target - current) / (invInertia(p, axis) + invInertia(c, axis));
  c.tau.addScaledVector(axis, lambda);
  p.tau.addScaledVector(axis, -lambda);
}

/** Collision filters for the chain kinds. */
export const BodyFilter = {
  membership: CG.Ragdoll,
  collidesWith: CG.World | CG.Ragdoll | CG.Gib,
};
export const LimbFilter = {
  membership: CG.Gib,
  collidesWith: CG.World | CG.Ragdoll | CG.Gib,
};
