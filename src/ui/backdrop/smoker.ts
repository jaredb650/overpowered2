/**
 * The contractor sitting in the Packmule's door with a cigar: a pose written straight onto the bones, with two-bone IK
 * for the limbs, driven by `SmokeRhythm`. Nothing here runs the game's animator.
 *
 * He sits on the cabin floor against the forward door post, facing aft down the cabin. His right leg is over the sill
 * with the boot on the wheel, his left knee is up, and the cigar hand rests on that knee. On a drag the hand comes to his
 * mouth so that the cigar's end meets his lips: the hand's pose at the mouth is worked out backwards from where the cigar
 * has to be, so the cigar never leaves the fingers.
 *
 * Character space is the body's own: +Z the way he faces, +X his left. In the aircraft that is aft and inboard.
 */
import * as THREE from 'three';
import type { Character } from '../../characters/Character';
import { HumanoidBone as H } from '../../characters/rig';
import { basisQuat, Limb } from '../../characters/animation/ik';
import { smoothstep } from '../../core/math';
import type { SmokerPose } from './rhythm';

/** Where he sits in the aircraft: the floor by the forward door post. */
export const SEAT = new THREE.Vector3(0.96, -1, 1.53);

/** Character-space targets, metres and radians. `shift` is the weight forward over the knee. */
const POSE = {
  pelvis: { y: 0.15, z: 0.02, pitch: -0.36, yaw: -0.12, roll: 0.03 },
  shiftPelvis: { z: 0.06, pitch: -0.16 },
  spine: 0.14,
  chest: 0.14,
  shiftSpine: 0.12,
  /** The right boot on the wheel outside the door, the left planted with the knee up. */
  footR: new THREE.Vector3(-0.7, -0.08, 0.15),
  footL: new THREE.Vector3(0.2, 0.07, 0.47),
  kneeR: new THREE.Vector3(-0.2, 1, 0.5),
  kneeL: new THREE.Vector3(0.3, 1, 0.5),
  /** The right hand on the right thigh; the left hanging past the left knee with the cigar. */
  handR: new THREE.Vector3(-0.33, 0.27, 0.2),
  elbowR: new THREE.Vector3(-0.7, -0.3, -0.6),
  /** Elbow poles for the cigar arm: resting on the knee, and coming up under the hand at the lips. */
  elbowL: new THREE.Vector3(0.5, -0.8, -0.3),
  elbowLips: new THREE.Vector3(0.3, -1, 0.2),
  /** From the left knee to the left hand at rest. */
  restHand: new THREE.Vector3(0.0, 0.03, 0.13),
  /**
   * The cigar's direction at rest, and the hand's roll about it: out to his left and a little up, square to the menu
   * camera's line, so its length shows instead of foreshortening to the ember.
   */
  restCigar: new THREE.Vector3(0.85, 0.35, -0.4),
  restRoll: new THREE.Vector3(0, 0, -1),
  /** At the lips: the cigar's direction in head space, out of the left corner of the mouth so the hand is off to the side and not over the mouth, and the roll that keeps the fist under it. */
  lipCigar: new THREE.Vector3(0.8, -0.35, 0.5),
  lipRoll: new THREE.Vector3(0, -1, 0.2),
  /** Head yaw and pitch: down the cabin, out of the door, and on the exhale. */
  gaze: { yaw: 0.22, pitch: 0.22 },
  door: { yaw: -1.05, pitch: -0.04 },
  breathe: { yaw: -0.45, pitch: -0.2 },
} as const;

/** The cigar, butt at the origin, lit end along +Y. */
export const CIGAR_LENGTH = 0.13;
/** How far up the cigar from the mouth end the fingers hold it. */
const GRIP = 0.04;

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3(1, 1, 1);

const qEuler = (out: THREE.Quaternion, x: number, y: number, z: number) => out.setFromEuler(_e.set(x, y, z, 'YXZ'));

export class Smoker {
  readonly cigar = new THREE.Group();
  /** The lit end, for the ember and the light. */
  readonly ember: THREE.Mesh;
  private readonly emberMat: THREE.MeshBasicMaterial;
  private readonly haloMat: THREE.MeshBasicMaterial;
  private readonly owned: { dispose(): void }[] = [];
  private readonly offsets: THREE.Vector3[];
  private readonly armL: Limb;
  private readonly armR: Limb;
  private readonly legL: Limb;
  private readonly legR: Limb;
  /** The cigar in the left hand's space. */
  private readonly inHandPos = new THREE.Vector3();
  private readonly inHandQ = new THREE.Quaternion();
  private readonly mouth: THREE.Vector3;
  // Character-space results, reused every frame.
  private readonly pelvisQ = new THREE.Quaternion();
  private readonly pelvisPos = new THREE.Vector3();
  private readonly chestQ = new THREE.Quaternion();
  private readonly chestPos = new THREE.Vector3();
  private readonly headQ = new THREE.Quaternion();
  private readonly headPos = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly handQ = new THREE.Quaternion();
  private readonly restQ = new THREE.Quaternion();
  private readonly lipQ = new THREE.Quaternion();
  private readonly restPos = new THREE.Vector3();
  private readonly lipPos = new THREE.Vector3();

  constructor(readonly body: Character, mouthSocket: readonly [number, number, number] | null) {
    const b = body.bones;
    this.offsets = b.map(bone => bone.position.clone());
    this.armL = new Limb(b[H.upperArmL]!, b[H.foreArmL]!, b[H.handL]!, new THREE.Vector3(0.3, 0, -1));
    this.armR = new Limb(b[H.upperArmR]!, b[H.foreArmR]!, b[H.handR]!, new THREE.Vector3(-0.3, 0, -1));
    this.legL = new Limb(b[H.thighL]!, b[H.shinL]!, b[H.footL]!, new THREE.Vector3(0, 0, 1));
    this.legR = new Limb(b[H.thighR]!, b[H.shinR]!, b[H.footR]!, new THREE.Vector3(0, 0, 1));
    this.mouth = new THREE.Vector3(...(mouthSocket ?? [0.012, 0.027, 0.104]));

    // The cigar sits in the left fist, the way the baked hand grips: across the palm, out on the thumb's side.
    const fore = this.bindPos(H.foreArmL);
    const hand = this.bindPos(H.handL);
    const fingers = _v.subVectors(hand, fore).normalize();
    const thumb = _v2.set(0, 0, 1).addScaledVector(fingers, -fingers.z).normalize();
    const palm = new THREE.Vector3().crossVectors(fingers, thumb);
    this.inHandPos.copy(fingers).multiplyScalar(0.085).addScaledVector(palm, 0.02).addScaledVector(thumb, -0.035);
    basisQuat(this.inHandQ, thumb, palm.clone().negate());
    // Held a little way up its length, not by the end, so at the lips the fist sits off to the side of the mouth.
    this.inHandPos.addScaledVector(_v.set(0, 1, 0).applyQuaternion(this.inHandQ), -GRIP);

    const leaf = new THREE.MeshStandardMaterial({ color: 0x7a5236, roughness: 0.75 });
    const band = new THREE.MeshStandardMaterial({ color: 0x6b1712, roughness: 0.5, metalness: 0.2 });
    const ash = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 1 });
    this.emberMat = new THREE.MeshBasicMaterial({ color: 0xff5a14, toneMapped: false });
    const r = 0.0095;
    const bodyGeo = new THREE.CylinderGeometry(r, r * 0.86, CIGAR_LENGTH - 0.016, 10).translate(0, (CIGAR_LENGTH - 0.016) / 2, 0);
    const bandGeo = new THREE.CylinderGeometry(r * 1.06, r * 1.06, 0.012, 10).translate(0, 0.026, 0);
    const ashGeo = new THREE.CylinderGeometry(r * 0.92, r, 0.012, 10).translate(0, CIGAR_LENGTH - 0.01, 0);
    const emberGeo = new THREE.CylinderGeometry(r * 0.9, r * 0.92, 0.005, 10).translate(0, CIGAR_LENGTH - 0.0015, 0);
    this.cigar.add(new THREE.Mesh(bodyGeo, leaf), new THREE.Mesh(bandGeo, band), new THREE.Mesh(ashGeo, ash));
    this.ember = new THREE.Mesh(emberGeo, this.emberMat);
    // A soft ball of glow round the tip, which the bloom spreads further.
    this.haloMat = new THREE.MeshBasicMaterial({ color: 0xff5a14, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const haloGeo = new THREE.SphereGeometry(0.016, 10, 6).translate(0, CIGAR_LENGTH + 0.002, 0);
    const halo = new THREE.Mesh(haloGeo, this.haloMat);
    halo.renderOrder = 6;
    this.cigar.add(this.ember, halo);
    this.owned.push(leaf, band, ash, this.emberMat, this.haloMat, bodyGeo, bandGeo, ashGeo, emberGeo, haloGeo);

    body.root.position.copy(SEAT);
    body.root.rotation.set(0, Math.PI, 0);
  }

  private bindPos(i: number): THREE.Vector3 {
    const out = new THREE.Vector3();
    for (let k = i; k >= 0; k = this.body.rig.bones[k]!.parent) out.add(this.offsets[k]!);
    return out;
  }

  /** Head direction as yaw and pitch, split between neck and head. */
  private look(yaw: number, pitch: number, roll: number): void {
    const b = this.body.bones;
    qEuler(_q, pitch * 0.4, yaw * 0.4, roll * 0.5);
    b[H.neck]!.quaternion.copy(_q2.copy(this.chestQ).invert()).multiply(_q);
    const neckQ = _q3.copy(_q);
    const neckPos = _v.copy(this.offsets[H.neck]!).applyQuaternion(this.chestQ).add(this.chestPos);
    qEuler(this.headQ, pitch, yaw, roll);
    b[H.head]!.quaternion.copy(_q2.copy(neckQ).invert()).multiply(this.headQ);
    this.headPos.copy(this.offsets[H.head]!).applyQuaternion(neckQ).add(neckPos);
  }

  /**
   * Writes the pose. `t` is seconds, for breathing and drift. `sway` is the airframe's roll and pitch, which the body
   * takes a little of, a beat behind.
   */
  update(p: SmokerPose, t: number, sway: THREE.Vector2): void {
    const b = this.body.bones;
    const P = POSE;
    const sh = p.shift;
    const breath = Math.sin(t * 1.55) * (1 + p.draw * 0.6);

    // Pelvis, spine and chest.
    this.pelvisPos.set(0, P.pelvis.y, P.pelvis.z + P.shiftPelvis.z * sh);
    qEuler(this.pelvisQ, P.pelvis.pitch + (P.shiftPelvis.pitch - P.pelvis.pitch) * sh, P.pelvis.yaw, P.pelvis.roll - sway.x * 0.35);
    b[H.hips]!.position.copy(this.pelvisPos);
    b[H.hips]!.quaternion.copy(this.pelvisQ);
    qEuler(b[H.spine]!.quaternion, P.spine + P.shiftSpine * sh + breath * 0.008, 0, sway.x * 0.2);
    const spineQ = _q.copy(this.pelvisQ).multiply(b[H.spine]!.quaternion);
    const spinePos = _v.copy(this.offsets[H.spine]!).applyQuaternion(this.pelvisQ).add(this.pelvisPos);
    qEuler(b[H.chest]!.quaternion, P.chest + breath * 0.012 - p.draw * 0.04, 0.05 * (1 - sh), 0);
    this.chestQ.copy(spineQ).multiply(b[H.chest]!.quaternion);
    this.chestPos.copy(this.offsets[H.chest]!).applyQuaternion(spineQ).add(spinePos);

    // Head: down the cabin at rest, out of the door on a look, up and away on the exhale, down to the hand on a drag.
    const drift = Math.sin(t * 0.37) * 0.05 + Math.sin(t * 0.91 + 1) * 0.025;
    let yaw = P.gaze.yaw + drift + (P.door.yaw - P.gaze.yaw) * p.look;
    let pitch = P.gaze.pitch + sh * 0.12 + (P.door.pitch - P.gaze.pitch) * p.look + Math.sin(t * 0.53) * 0.02;
    yaw += (P.breathe.yaw - yaw) * p.exhale * 0.85;
    pitch += (P.breathe.pitch - pitch) * p.exhale * 0.85;
    pitch += p.hand * 0.06;
    this.look(yaw, pitch, sway.x * 0.4 - p.look * 0.08);

    // Legs first: the left hand rests on the left knee.
    const hipL = _v.copy(this.offsets[H.thighL]!).applyQuaternion(this.pelvisQ).add(this.pelvisPos);
    this.legL.solve(hipL, this.pelvisQ, this.target.copy(P.footL), P.kneeL);
    this.legL.setEnd(qEuler(_q, 0.1, 0.25, 0));
    const kneeL = _v2.copy(this.legL.joint);
    const hipR = _v.copy(this.offsets[H.thighR]!).applyQuaternion(this.pelvisQ).add(this.pelvisPos);
    // The dangling boot rocks a little on the wheel as the airframe moves.
    this.target.copy(P.footR);
    this.target.y += Math.sin(t * 0.8) * 0.006;
    this.legR.solve(hipR, this.pelvisQ, this.target, P.kneeR);
    this.legR.setEnd(qEuler(_q, 0.25, -0.65, -0.15));

    // Right arm: hand on the right thigh.
    const shoulderR = _v.copy(this.offsets[H.upperArmR]!).applyQuaternion(this.chestQ).add(this.chestPos);
    this.target.copy(P.handR);
    this.target.z += sh * 0.08;
    this.armR.solve(shoulderR, this.chestQ, this.target, P.elbowR);
    this.armR.setEnd(qEuler(_q, 1.25, -0.3, -0.25));

    // Left arm: the cigar hand. Rest pose past the knee; the drag pose worked back from the cigar at the lips.
    basisQuat(_q, _v.copy(P.restCigar).normalize(), P.restRoll);
    this.restQ.copy(_q).multiply(_q2.copy(this.inHandQ).invert());
    this.restPos.copy(kneeL).add(P.restHand);
    this.restPos.z += sh * 0.05;
    basisQuat(_q, _v.copy(P.lipCigar).normalize(), P.lipRoll);
    _q.premultiply(this.headQ);
    this.lipQ.copy(_q).multiply(_q2.copy(this.inHandQ).invert());
    const lips = _v.copy(this.mouth).applyQuaternion(this.headQ).add(this.headPos);
    this.lipPos.copy(lips).sub(_v2.copy(this.inHandPos).applyQuaternion(this.lipQ));
    const k = smoothstep(0, 1, p.hand);
    this.handQ.copy(this.restQ).slerp(this.lipQ, k);
    this.target.lerpVectors(this.restPos, this.lipPos, k);
    // The hand swings out and up on its way, rather than through the chest.
    this.target.x += Math.sin(k * Math.PI) * 0.08;
    this.target.z += Math.sin(k * Math.PI) * 0.12;
    const shoulderL = _v.copy(this.offsets[H.upperArmL]!).applyQuaternion(this.chestQ).add(this.chestPos);
    const pole = _v2.lerpVectors(P.elbowL, P.elbowLips, k);
    this.armL.solve(shoulderL, this.chestQ, this.target, pole);
    this.armL.setEnd(this.handQ);

    // The cigar follows the hand bone.
    const hand = b[H.handL]!;
    this.body.root.updateMatrixWorld(true);
    _m.compose(this.inHandPos, this.inHandQ, _s).premultiply(hand.matrixWorld);
    this.cigar.matrixAutoUpdate = false;
    this.cigar.matrix.copy(_m);
    this.cigar.matrixWorldNeedsUpdate = true;

    // The tip glows by heat: dull red at rest, orange-white on a draw. HDR, so a hot tip blooms.
    const e = p.ember;
    this.emberMat.color.setRGB(1.2 + e * 5.5, 0.18 + e * 1.4 + e * e * 0.8, 0.03 + e * e * 0.25);
    this.haloMat.color.setRGB(0.5 + e * 1.6, 0.1 + e * 0.35, 0.02);
  }

  /** The lit end, in the aircraft's frame. */
  tip(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, CIGAR_LENGTH, 0).applyMatrix4(this.cigar.matrix);
  }

  /** The lips and the way he breathes out, in the aircraft's frame. */
  breath(mouth: THREE.Vector3, dir: THREE.Vector3): void {
    const head = this.body.bones[H.head]!;
    mouth.copy(this.mouth).applyMatrix4(head.matrixWorld);
    dir.set(-0.2, 0.15, 1).normalize().transformDirection(head.matrixWorld);
  }

  dispose(): void {
    for (const o of this.owned) o.dispose();
  }
}
