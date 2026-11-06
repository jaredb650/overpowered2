/**
 * A body that has lost its feet and not its life.
 *
 * A collapse follows the animation. This cannot: a thrown body has no animation worth following. So each frame this
 * works out what a person would do with their limbs from where they are in the air, and hands joints a pose in their
 * own terms, which the muscle layer then tries to reach. Nothing here touches a rigid body, so it cannot throw anything.
 *
 * Fall: arms go wide, then reach out and down as the floor comes up, knees draw in, chin tucks. Lying: a hand goes to the
 * wound, the rest curls round it. Gather: the limbs find the first frame of a get-up, so that the handover has little
 * left to blend. Rigs are read through joint roles, so a missing limb is just a limb nobody moves.
 */
import * as THREE from 'three';
import { CG, type CharacterAnimation, type RayHit } from '../core/contracts';
import { clamp, damp, lerp, smoothstep } from '../core/math';
import type { GetUpKind } from '../characters/animation/getUp';
import type { MuscleState } from './muscles';
import type { Rag, RagPart } from './rag';

export type ReflexPhase = 'fall' | 'lying' | 'gather';

export const ReflexTuning = {
  /** Seconds before muscles answer a hit. A body that reacts at once looks like it knew. */
  reaction: 0.07,
  /** Joint strength by role, 0..1, in each phase. Legs stay light: a strong leg on the floor props the body up. */
  fall: { arm: 0.75, leg: 0.32, spine: 0.34, head: 0.6 },
  lying: { arm: 0.55, leg: 0.3, spine: 0.14, head: 0.4 },
  gather: { arm: 0.8, leg: 0.6, spine: 0.4, head: 0.5 },
  /** How fast joint strength reaches what the phase wants, in 1/s. */
  driveRate: 11,
  /** A body counts as down with its hips under this share of their standing height, moving slower than this, for this long. */
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
  /** Seconds the hands stay up at the face when a blast takes a body, and how they let go. */
  guardHold: 0.2,
  guardFade: 0.45,
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
  kind: GetUpKind = 'prone';
  /** Where the hips sit at the start of the chosen get-up, relative to where it will stand. */
  readonly startHips = new THREE.Vector3();
  /** Seconds left to go slack, or below zero while still alive. */
  dying = -1;
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

  constructor(
    private readonly rag: Rag,
    private readonly muscle: MuscleState,
    private readonly anim: CharacterAnimation,
    options: { lie: number; hurt: number; groundY: number; dir: THREE.Vector3 | null; plank: boolean },
  ) {
    this.plank = options.plank;
    this.lie = options.lie;
    this.hurt = options.hurt;
    this.groundY = options.groundY;
    this.seed = muscle.random() * 100;
    this.keep = rag.source.bones.map(() => new THREE.Quaternion());
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
        if (below) {
          const e = below.bone * 3;
          rest.set(bind[e]! - bind[o]!, bind[e + 1]! - bind[o + 1]!, bind[e + 2]! - bind[o + 2]!);
          upper = rest.length();
          const hand = rag.info.children[below.bone]![0];
          if (hand !== undefined) {
            const h = hand * 3;
            fore = Math.hypot(bind[h]! - bind[e]!, bind[h + 1]! - bind[e + 1]!, bind[h + 2]! - bind[e + 2]!);
          }
        }
        this.arms.push({ shoulder: part, elbow: below, side, rest: rest.normalize(), upper, fore, phase: this.muscle.random() * Math.PI * 2 });
      }
    }
    if (this.woundPart && !parts.includes(this.woundPart)) this.woundPart = null;
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
    if (this.phase === 'gather' && strength >= ReflexTuning.strikeBack) this.enter('lying');
    if (this.phase === 'lying') this.time = Math.max(0, this.time - strength * ReflexTuning.strikeWait);
  }

  /** A blast has it in the air again. */
  thrown(): void {
    if (this.dying >= 0) return;
    this.ready = false;
    this.enter('fall');
    this.landed = 0;
  }

  /** Died on the way down: whatever it was doing fades out, it does not stop. */
  die(): void {
    if (this.dying < 0) this.dying = ReflexTuning.dieSeconds;
  }

  private enter(phase: ReflexPhase): void {
    this.phase = phase;
    this.time = 0;
    if (phase === 'gather') this.startGather();
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
    if (rag.thud / rag.mass > ReflexTuning.stunThud) this.stun = 1;
    this.advance(hips, dt);

    _front.set(0, 0, 1).applyQuaternion(chest.q);
    _up.set(0, 1, 0).applyQuaternion(chest.q);
    _left.set(1, 0, 0).applyQuaternion(chest.q);
    if (this.phase === 'fall') this.poseFall(hips, chest);
    else if (this.phase === 'lying') this.poseLying(chest);
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
      const low = hips.p.y - this.groundY < this.standHips * t.landHeight && hips.v.length() < t.landSpeed;
      this.landed = low ? this.landed + dt : 0;
      if (this.landed > t.landHold || this.time > t.maxFall) this.enter('lying');
    } else if (this.phase === 'lying') {
      const calm = hips.v.length() < t.gatherSpeed || this.time > this.lie + t.gatherPatience;
      if (this.dying < 0 && this.time > this.lie && calm) this.enter('gather');
    } else if (this.time > t.gatherSeconds) {
      this.ready = true;
    }
  }

  /** Face up or face down, read off the chest. Also where a legless body stops. */
  private pickGetUp(): GetUpKind {
    if (this.legs.length === 0) return 'crawl';
    const chest = this.spine ?? this.rag.parts[0]!;
    _front.set(0, 0, 1).applyQuaternion(chest.q);
    return _front.y > 0 ? 'supine' : 'prone';
  }

  private startGather(): void {
    const { rag, anim } = this;
    const bones = rag.source.bones;
    const defs = rag.source.rig.bones;
    this.kind = this.pickGetUp();
    const keep = this.keep;
    for (let i = 0; i < bones.length; i++) keep[i]!.copy(bones[i]!.quaternion);
    _a.copy(bones[0]!.position);
    anim.poseGetUpStart!(this.kind, this.startHips);
    for (const part of rag.parts) {
      const parent = part.parent;
      if (!parent) continue;
      const pose = part.muscle!.pose;
      pose.identity();
      for (let b = part.bone; b !== parent.bone; b = defs[b]!.parent) pose.premultiply(bones[b]!.quaternion);
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
    // Thrown, the first thing anybody does is cover their face.
    const guard = this.plank ? 0 : 1 - smoothstep(t.guardHold, t.guardFade, this.age);
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
      this.aim(arm, _dir, lerp(t.flailElbow + a * 0.3, t.braceElbow, brace));
      if (guard > 0.5 && this.head) {
        _b.copy(_front).multiplyScalar(0.14).addScaledVector(_left, arm.side * 0.07).add(this.head.p);
        this.reach(arm, _b);
      }
      const gain = lerp(1, t.braceGain, brace);
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
    return this.plank ? 1 - smoothstep(ReflexTuning.plankSeconds * 0.6, ReflexTuning.plankSeconds, this.age) : 0;
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
    const table = this.phase === 'fall' ? t.fall : this.phase === 'lying' ? t.lying : t.gather;
    // A landing knocks the strength out of everything for a moment. It is why a hand on the floor gives instead of propping.
    const stunned = 1 - t.stunLoss * this.stun;
    const fading = this.dying >= 0 ? this.dying / t.dieSeconds : 1;
    const awake = smoothstep(0, t.reaction * 2, this.age - t.reaction);
    const scale = stunned * fading * (this.plank ? 1 : awake);
    const parts = this.rag.parts;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const m = part.muscle!;
      if (!part.parent || m.role === null) continue;
      let want = table[m.role] * scale;
      if (this.phase === 'fall') {
        if (m.role === 'leg') want = lerp(want, t.plankLeg, this.plankLeft);
        else if (m.role === 'spine') want = lerp(want, t.plankSpine, this.plankLeft);
      }
      m.drive = damp(m.drive, want, t.driveRate, dt);
      if (this.phase !== 'fall') m.gain = 1;
      // A working muscle carries its own weight, as in a collapse, or an arm on the floor cannot lift itself off it.
      // Falling, the legs keep theirs: feet need it on the floor to tip over.
      if (m.role === 'arm' || m.role === 'head' || (m.role === 'leg' && this.phase !== 'fall')) part.body.setGravityScale(1 - m.drive, false);
    }
  }
}
