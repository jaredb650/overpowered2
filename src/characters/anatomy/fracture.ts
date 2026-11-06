/**
 * Broken limbs on a body that is still being animated. Whatever the animator wrote, a broken joint then swings by its
 * own weight from wherever the joint has been carried to, so a dead arm trails a running body and swings when it stops.
 * After death none of this runs: the ragdoll's limits for that joint are opened instead, and physics does the same job.
 */
import * as THREE from 'three';
import { clamp } from '../../core/math';
import type { RigDef } from '../rig';

export type FractureStyle = 'hyper' | 'limp';

const MAX_BREAKS = 8;
/** Twice the real thing, as everywhere in this game. */
const GRAVITY = 19;
/** Per second. High enough that a limb hangs instead of swinging for a minute. */
const DAMPING = 5;
/** A joint carried further than this in a frame was moved by a teleport, not by a body, and the limb goes with it. */
const SNAP_DISTANCE = 1.5;
/** Most a limb can trail behind in a frame, so a hit-stop or a frame spike cannot store up a swing. */
const LONGEST_STEP = 1 / 20;

/** Radians past straight, the wrong way, a snapped hinge settles between. */
const HYPER_MIN = 0.42;
const HYPER_MAX = 1.3;
/** A hinge under a dead shoulder or hip still bends, but nothing holds it. */
const SLACK_BEND = 0.5;
/** Furthest a dead shoulder or hip can swing from where the bind pose has it. */
const LIMP_CONE = 1.75;

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _local = new THREE.Vector3();
const _step = new THREE.Vector3();
const _parentRot = new THREE.Quaternion();
const _parentInv = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _x = new THREE.Vector3(1, 0, 0);
const _z = new THREE.Vector3(0, 0, 1);
const _twist = new THREE.Quaternion();

class Break {
  bone = -1;
  /** 1 for a hinge bending past straight, 0 for a ball joint, -1 for a hinge hanging slack. */
  mode = 0;
  /** Sign of a rotation about the hinge axis that goes the wrong way. The bone turns against its rig limits. */
  wrong = 1;
  length = 0.3;
  /** A little sideways too. No joint breaks exactly in its own plane. */
  skew = 0;
  placed = false;
  readonly rest = new THREE.Vector3();
  readonly joint = new THREE.Vector3();
  readonly tip = new THREE.Vector3();
  readonly last = new THREE.Vector3();
}

export class FracturePose {
  private readonly breaks = Array.from({ length: MAX_BREAKS }, () => new Break());
  private count = 0;

  constructor(private readonly rig: RigDef, private readonly bones: readonly THREE.Bone[]) {}

  has(bone: number): boolean {
    for (let i = 0; i < this.count; i++) if (this.breaks[i]!.bone === bone) return true;
    return false;
  }

  reset(): void {
    this.count = 0;
  }

  add(bone: number, style: FractureStyle, skew: number): void {
    if (this.has(bone) || this.count >= MAX_BREAKS) return;
    const def = this.rig.bones[bone]!;
    const kids = this.rig.bones.findIndex(b => b.parent === bone);
    if (kids < 0) return;
    const b = this.breaks[this.count++]!;
    const off = this.rig.bones[kids]!.offset;
    b.bone = bone;
    b.rest.set(off[0], off[1], off[2]);
    b.length = b.rest.length();
    b.rest.normalize();
    b.skew = skew;
    b.placed = false;
    const hinge = def.joint?.kind === 'hinge';
    b.mode = !hinge ? 0 : style === 'hyper' ? 1 : -1;
    // Limits say which way it does bend, so the wrong way is the side of zero they never reach.
    b.wrong = (def.joint?.max ?? 0) > 0.1 ? 1 : -1;
    if (style === 'limp' && !hinge) {
      const child = this.rig.bones[kids]!;
      if (child.joint?.kind === 'hinge') this.add(kids, 'limp', 0);
    }
  }

  /** Call after the animator has written its pose. */
  apply(dt: number): void {
    if (this.count === 0 || dt <= 0) return;
    const step = Math.min(dt, LONGEST_STEP);
    const keep = Math.exp(-DAMPING * step);
    for (let i = 0; i < this.count; i++) {
      const b = this.breaks[i]!;
      const bone = this.bones[b.bone]!;
      const parent = bone.parent!;
      parent.updateWorldMatrix(true, false);
      parent.matrixWorld.decompose(_origin, _parentRot, _scale);
      // A hidden limb has nothing to swing.
      if (_scale.x < 1e-3) continue;
      _origin.copy(bone.position).applyMatrix4(parent.matrixWorld);
      if (!b.placed) {
        b.placed = true;
        b.joint.copy(_origin);
        b.tip.copy(b.rest).applyQuaternion(bone.quaternion).applyQuaternion(_parentRot).multiplyScalar(b.length).add(_origin);
        b.last.copy(b.tip);
      } else if (b.joint.distanceToSquared(_origin) > SNAP_DISTANCE * SNAP_DISTANCE) {
        _step.copy(_origin).sub(b.joint);
        b.tip.add(_step);
        b.last.add(_step);
      }
      b.joint.copy(_origin);
      _step.copy(b.tip).sub(b.last).multiplyScalar(keep);
      b.last.copy(b.tip);
      b.tip.add(_step);
      b.tip.y -= GRAVITY * step * step;
      _dir.copy(b.tip).sub(_origin);
      if (_dir.lengthSq() < 1e-8) _dir.set(0, -1, 0);
      _dir.normalize();

      // Into the parent's frame, where the bind axes are the joint's own.
      _local.copy(_dir).applyQuaternion(_parentInv.copy(_parentRot).conjugate());
      if (b.mode === 0) {
        const angle = _local.angleTo(b.rest);
        if (angle > LIMP_CONE) _local.lerp(b.rest, 1 - LIMP_CONE / angle).normalize();
        bone.quaternion.setFromUnitVectors(b.rest, _local);
      } else {
        // The rotation about the hinge that carries the bind direction nearest to where the limb has swung.
        const r = b.rest;
        const swing = Math.atan2(r.y * _local.z - r.z * _local.y, r.y * _local.y + r.z * _local.z) * b.wrong;
        const held = b.mode === 1 ? clamp(swing, HYPER_MIN, HYPER_MAX) : clamp(swing, -SLACK_BEND, 0.02);
        bone.quaternion.setFromAxisAngle(_x, held * b.wrong);
        if (b.skew !== 0) bone.quaternion.premultiply(_twist.setFromAxisAngle(_z, b.skew));
      }
      // The swing goes on from where the joint let it get to, so what was held back is not stored up.
      b.tip.copy(b.rest).applyQuaternion(bone.quaternion).applyQuaternion(_parentRot).multiplyScalar(b.length).add(_origin);
    }
  }
}
