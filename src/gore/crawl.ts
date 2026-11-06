/**
 * The top half of a body, still going. Physics, not animation: an arm is thrown forward, plants, and the
 * chest is hauled up to it. Because it is a real ragdoll being pulled, it snags and slumps like a real one.
 */
import * as THREE from 'three';
import type { TorsoHalf } from '../core/contracts';
import { HumanoidBone } from '../characters/rig';
import { GRAVITY } from '../physics/Physics';
import type { Rag, RagPart } from './rag';

export const CrawlTuning = {
  /** Seconds per stroke of one arm. */
  stroke: 0.82,
  /** Share of a stroke spent reaching before the hand plants. */
  reach: 0.42,
  /** How hard the hand is thrown at its target, per second squared of error. */
  reachStiffness: 90,
  reachDamping: 14,
  /** Haul on the chest while a hand is planted, in m/s². */
  pull: 17,
  /** How far ahead of the chest a hand lands. */
  handAhead: 0.72,
  /** Fraction of gravity taken off the chest and head, as if up on the elbows. */
  lift: 0.5,
  /** Keeps the spine pointing at the target. */
  steer: 55,
  steerDamping: 10,
  /** Stops within this distance of the target. */
  arrive: 0.8,
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _spine = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _vec = { x: 0, y: 0, z: 0 };

export class Crawler implements TorsoHalf {
  readonly position = new THREE.Vector3();
  readonly target = new THREE.Vector3();
  alive = true;
  /** Set once the half stops by itself, when it bleeds out. */
  ends: number;
  private clock = 0;
  private side = 0;
  private readonly arms: (RagPart | null)[];
  private readonly chest: RagPart;
  private readonly head: RagPart | null;
  private readonly plant = new THREE.Vector3();
  private planted = false;

  constructor(private readonly rag: Rag, target: THREE.Vector3 | null, ends: number) {
    this.ends = ends;
    this.chest = rag.partFor(HumanoidBone.chest);
    this.head = rag.mask[HumanoidBone.head] === 1 ? rag.partFor(HumanoidBone.head) : null;
    this.arms = [
      rag.mask[HumanoidBone.foreArmL] === 1 ? rag.partFor(HumanoidBone.foreArmL) : null,
      rag.mask[HumanoidBone.foreArmR] === 1 ? rag.partFor(HumanoidBone.foreArmR) : null,
    ];
    this.target.copy(rag.center).add(_a.set(0, 0, 2));
    if (target) this.setTarget(target);
    this.position.copy(rag.center);
  }

  setTarget(point: THREE.Vector3): void {
    // Rapier takes a NaN without complaint and the body then hangs frozen in mid-air for good.
    if (Number.isFinite(point.x + point.y + point.z)) this.target.copy(point);
  }

  kill(): void {
    this.alive = false;
  }

  step(dt: number): void {
    if (!this.alive || !this.rag.active) return;
    const { chest, head } = this;
    chest.body.translation(_chest);
    this.position.copy(_chest);
    const toTarget = _a.copy(this.target).sub(_chest);
    toTarget.y = 0;
    const dist = toTarget.length();
    if (dist < 1e-3) return;
    toTarget.divideScalar(dist);

    const t = CrawlTuning;
    this.clock += dt;
    if (this.clock >= t.stroke) {
      this.clock -= t.stroke;
      this.side ^= 1;
      this.planted = false;
    }
    const reaching = this.clock < t.stroke * t.reach;
    const lift = -GRAVITY * t.lift * dt;

    // Up on the elbows: part of the weight of the chest and head comes off the floor.
    _vec.x = 0;
    _vec.y = chest.mass * lift;
    _vec.z = 0;
    chest.body.applyImpulse(_vec, true);
    if (head) {
      _vec.y = head.mass * lift * 1.5;
      head.body.applyImpulse(_vec, true);
    }

    // Spine along the direction of travel. The torque aims the chest's local +Y at the target.
    chest.body.rotation(chest.q);
    chest.body.angvel(chest.w);
    _spine.set(0, 1, 0).applyQuaternion(chest.q);
    _b.crossVectors(_spine, toTarget).multiplyScalar(t.steer);
    _b.addScaledVector(chest.w, -t.steerDamping);
    const inertia = chest.mass * 0.09;
    _vec.x = _b.x * inertia * dt;
    _vec.y = _b.y * inertia * dt;
    _vec.z = _b.z * inertia * dt;
    chest.body.applyTorqueImpulse(_vec, true);

    if (dist < t.arrive) return;
    const arm = this.arms[this.side] ?? this.arms[this.side ^ 1];
    if (!arm) return;

    arm.body.translation(arm.p);
    arm.body.linvel(arm.v);
    if (reaching) {
      // Throw the forearm out ahead and to its own side, then let it drop on the floor.
      const out = this.side === 0 ? 0.22 : -0.22;
      _b.set(_chest.x + toTarget.x * t.handAhead - toTarget.z * out, _chest.y + 0.1, _chest.z + toTarget.z * t.handAhead + toTarget.x * out);
      _c.copy(_b).sub(arm.p).multiplyScalar(t.reachStiffness);
      _c.addScaledVector(arm.v, -t.reachDamping);
      _vec.x = _c.x * arm.mass * dt;
      _vec.y = _c.y * arm.mass * dt;
      _vec.z = _c.z * arm.mass * dt;
      arm.body.applyImpulse(_vec, true);
      return;
    }
    if (!this.planted) {
      this.planted = true;
      this.plant.copy(arm.p);
    }
    // Hand stays where it landed, chest hauls toward it. The two forces are equal and opposite.
    _c.copy(this.plant).sub(arm.p).multiplyScalar(160);
    _c.addScaledVector(arm.v, -22);
    _c.y -= 12;
    _vec.x = _c.x * arm.mass * dt;
    _vec.y = _c.y * arm.mass * dt;
    _vec.z = _c.z * arm.mass * dt;
    arm.body.applyImpulse(_vec, true);
    const haul = chest.mass * t.pull * dt;
    _vec.x = toTarget.x * haul;
    _vec.y = 0;
    _vec.z = toTarget.z * haul;
    chest.body.applyImpulse(_vec, true);
  }
}
