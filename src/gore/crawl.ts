/**
 * The top half of a body, still going. Physics, not animation: an arm is thrown forward, plants, and the
 * chest is hauled up to it. Because it is a real ragdoll being pulled, it snags and slumps like a real one.
 */
import * as THREE from 'three';
import { CG, type RayHit, type TorsoHalf } from '../core/contracts';
import { HumanoidBone } from '../characters/rig';
import { GRAVITY } from '../physics/Physics';
import type { Rag, RagPart } from './rag';
import { HUMAN_HEIGHT } from './rigInfo';

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

const DOWN = new THREE.Vector3(0, -1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _spine = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _vec = { x: 0, y: 0, z: 0 };
const _ray: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };

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
    if (!this.alive || !this.rag.active || dt <= 0 || !Number.isFinite(dt)) return;
    const { chest, head } = this;
    chest.body.translation(_chest);
    this.position.copy(_chest);

    // No arms left: cannot prop up on elbows, steer, or haul itself across the floor.
    const armL = this.arms[0] && this.rag.mask[HumanoidBone.foreArmL] === 1 ? this.arms[0] : null;
    const armR = this.arms[1] && this.rag.mask[HumanoidBone.foreArmR] === 1 ? this.arms[1] : null;
    if (!armL && !armR) {
      this.planted = false;
      return;
    }

    // Require floor proximity/contact so a torso falling off a ledge falls under full gravity instead of flying mid-air.
    const scale = this.rag.source.rig.height / HUMAN_HEIGHT;
    const scaleSq = scale * scale;
    const vScale = Math.sqrt(Math.max(scale, 0.25));
    const liftPad = 0.1 * scale;
    const groundReach = 0.55 * scale;
    _b.set(_chest.x, _chest.y + liftPad, _chest.z);
    const grounded = this.rag.physics.raycastInto(_b, DOWN, liftPad + groundReach, CG.World, _ray)
      && _chest.y - _ray.point.y <= groundReach;
    if (!grounded) {
      this.planted = false;
      return;
    }

    const toTarget = _a.copy(this.target).sub(_chest);
    toTarget.y = 0;
    const dist = toTarget.length();
    if (dist < 1e-3) {
      this.planted = false;
      return;
    }
    toTarget.divideScalar(dist);

    const t = CrawlTuning;
    this.clock += dt;
    if (this.clock >= t.stroke) {
      this.clock %= t.stroke;
      this.side ^= 1;
      this.planted = false;
    }
    const activeSide = (this.side === 0 ? armL : armR) ? this.side : (armL ? 0 : 1);
    const arm = activeSide === 0 ? armL! : armR!;
    const reaching = this.clock < t.stroke * t.reach;
    // A share of the weight that acts on it, which the tempo dial sets. Clamped for dt spikes.
    const lift = -GRAVITY * this.rag.gravity * t.lift * Math.min(dt, 0.1);

    // Up on the elbows: part of the weight of the chest and head comes off the floor.
    _vec.x = 0;
    _vec.y = chest.mass * lift;
    _vec.z = 0;
    chest.body.applyImpulse(_vec, true);
    if (head && this.rag.mask[HumanoidBone.head] === 1) {
      _vec.y = head.mass * lift * 1.5;
      head.body.applyImpulse(_vec, true);
    }

    // Spine along the direction of travel. The torque aims the chest's local +Y at the target.
    chest.body.rotation(chest.q);
    chest.body.angvel(chest.w);
    _spine.set(0, 1, 0).applyQuaternion(chest.q);
    _b.crossVectors(_spine, toTarget);
    if (_spine.dot(toTarget) < -0.9 && _b.lengthSq() < 0.04) {
      // 180° steering deadlock: break anti-parallel symmetry decisively around world +Y.
      _b.set(0, activeSide === 0 ? 1 : -1, 0);
    }
    const steerScale = dt / (1 + t.steerDamping * dt + t.steer * dt * dt);
    _b.multiplyScalar(t.steer);
    _b.addScaledVector(chest.w, -t.steerDamping);
    _b.multiplyScalar(steerScale);
    const maxDw = 12;
    if (_b.lengthSq() > maxDw * maxDw) _b.setLength(maxDw);
    const inertia = chest.mass * 0.09 * scaleSq;
    _vec.x = _b.x * inertia;
    _vec.y = _b.y * inertia;
    _vec.z = _b.z * inertia;
    chest.body.applyTorqueImpulse(_vec, true);

    if (dist < t.arrive) {
      this.planted = false;
      return;
    }

    arm.body.translation(arm.p);
    arm.body.linvel(arm.v);
    const maxArmDv = 6 * vScale;
    if (reaching) {
      // Throw the forearm out ahead and to its own side (left = up × toTarget = (+toTarget.z, 0, -toTarget.x)), then let it drop on the floor.
      const out = (activeSide === 0 ? 0.22 : -0.22) * scale;
      _b.set(
        _chest.x + toTarget.x * t.handAhead * scale + toTarget.z * out,
        _chest.y + 0.1 * scale,
        _chest.z + toTarget.z * t.handAhead * scale - toTarget.x * out,
      );
      const reachScale = dt / (1 + t.reachDamping * dt + t.reachStiffness * dt * dt);
      _c.copy(_b).sub(arm.p).multiplyScalar(t.reachStiffness);
      _c.addScaledVector(arm.v, -t.reachDamping);
      _c.multiplyScalar(reachScale);
      if (_c.lengthSq() > maxArmDv * maxArmDv) _c.setLength(maxArmDv);
      _vec.x = _c.x * arm.mass;
      _vec.y = _c.y * arm.mass;
      _vec.z = _c.z * arm.mass;
      arm.body.applyImpulse(_vec, true);
      // Equal-and-opposite shoulder reaction on the chest while reaching in the air.
      _vec.x = -_vec.x;
      _vec.y = -_vec.y;
      _vec.z = -_vec.z;
      chest.body.applyImpulse(_vec, true);
      return;
    }
    if (!this.planted) {
      this.planted = true;
      this.plant.copy(arm.p);
    }
    // Hand stays pinned on the floor where it landed (floor grip) while the chest hauls toward the target.
    const plantK = 160;
    const plantD = 22;
    const plantScale = dt / (1 + plantD * dt + plantK * dt * dt);
    _c.copy(this.plant).sub(arm.p).multiplyScalar(plantK);
    _c.addScaledVector(arm.v, -plantD);
    _c.y -= 12;
    _c.multiplyScalar(plantScale);
    if (_c.lengthSq() > maxArmDv * maxArmDv) _c.setLength(maxArmDv);
    _vec.x = _c.x * arm.mass;
    _vec.y = _c.y * arm.mass;
    _vec.z = _c.z * arm.mass;
    arm.body.applyImpulse(_vec, true);
    const haul = chest.mass * Math.min(t.pull * dt, 3.5 * vScale);
    _vec.x = toTarget.x * haul;
    _vec.y = 0;
    _vec.z = toTarget.z * haul;
    chest.body.applyImpulse(_vec, true);
  }
}
