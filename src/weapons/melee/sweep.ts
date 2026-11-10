/**
 * What a swing can touch. Pure geometry, no world: the caller adds the line-of-sight ray.
 *
 * A swing is the slab of space the blade passes through. Its plane holds the eye, the line of the crosshair and the
 * direction the blade travels across the screen, so whatever the crosshair is on, every swing passes through it. Inside
 * the plane the blade covers `arc` radians centred on the crosshair, out to `reach` meters from the eye; out of the
 * plane it is `width` thick either side, which is the blade's own width and the wobble of a real arm. A thrust is a
 * narrow cone along the crosshair instead.
 *
 * A body is an upright capsule: its feet, its height and a radius. It is touched when any part of it enters the slab.
 * `reach` is measured from the eye to the body's surface, never to its middle.
 *
 * A body wholly under the slab (a Skitter at the player's feet, a man on the floor) is met by the swing reaching down for
 * it: the same swing aimed lower, at the top of the body, by no more than `dip` radians. Its reach does not change.
 */
import * as THREE from 'three';

export interface SwingShape {
  /** Meters from the eye to the nearest surface of a body that can be struck. */
  reach: number;
  /** Total radians the blade sweeps in its plane, centred on the crosshair. For a thrust, the cone's full angle. */
  arc: number;
  /** Half thickness of the slab, meters. Unused by a thrust. */
  width: number;
  /** A body whose surface is this close to the eye and not behind it is struck by any swing, wherever it stands. */
  pointBlank: number;
  thrust?: boolean;
  /** Radians a swing may drop below the crosshair to meet a body wholly under it. Unset or 0 never drops. */
  dip?: number;
}

export interface BodyShape {
  /** Where its feet are. */
  base: THREE.Vector3;
  height: number;
  radius: number;
}

/** A frame of the swing: the eye, the crosshair and the blade's travel, all world space. `sweep` is square to `forward`. */
export interface SwingFrame {
  eye: THREE.Vector3;
  forward: THREE.Vector3;
  sweep: THREE.Vector3;
}

/** Spacing of the points tested along a body, meters. Well under any body's radius, so nothing slips between two. */
const SAMPLE_STEP = 0.12;
/** Meters of distance from the plane one radian off the crosshair is worth, in picking where a swing lands. */
const CROSSHAIR_PULL = 0.25;
const MAX_SAMPLES = 24;

const _normal = new THREE.Vector3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _right = new THREE.Vector3();
const _low: SwingFrame = { eye: new THREE.Vector3(), forward: new THREE.Vector3(), sweep: new THREE.Vector3() };

/**
 * Meters from the eye to the body's surface where the swing meets it, or -1 for a miss. `out` gets the point on the body's
 * axis where it is struck: the one nearest the blade's plane and, of those, nearest the crosshair.
 */
export function swingTouches(shape: SwingShape, frame: SwingFrame, body: BodyShape, out: THREE.Vector3): number {
  const met = touchOnce(shape, frame, body, out);
  const dip = shape.dip ?? 0;
  if (met >= 0 || dip <= 0) return met;
  // Reaching down: aim the swing at the top of the body, if that is below the crosshair, and test it again.
  const { eye, forward } = frame;
  const flat = Math.hypot(body.base.x - eye.x, body.base.z - eye.z);
  if (flat < 1e-4) return -1;
  const top = body.base.y + Math.max(body.height - body.radius * 0.5, body.height * 0.5);
  const drop = Math.asin(Math.min(1, Math.max(-1, forward.y))) - Math.atan2(top - eye.y, flat);
  if (drop <= 0.01) return -1;
  _right.set(-forward.z, 0, forward.x);
  if (_right.lengthSq() < 1e-8) return -1;
  _right.normalize();
  const by = -Math.min(drop, dip);
  _low.eye.copy(eye);
  _low.forward.copy(forward).applyAxisAngle(_right, by);
  _low.sweep.copy(frame.sweep).applyAxisAngle(_right, by);
  return touchOnce(shape, _low, body, out);
}

function touchOnce(shape: SwingShape, frame: SwingFrame, body: BodyShape, out: THREE.Vector3): number {
  const { eye, forward } = frame;
  const r = body.radius;
  const bottom = body.base.y + Math.min(r, body.height * 0.5);
  const top = body.base.y + Math.max(body.height - r * 0.5, body.height * 0.5);
  const span = top - bottom;
  const count = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(span / SAMPLE_STEP) + 1));

  // Point blank: right in front of the eye, whatever the swing.
  const cy = Math.min(top, Math.max(bottom, eye.y));
  _closest.set(body.base.x, cy, body.base.z);
  _v.subVectors(_closest, eye);
  const centre = _v.length();
  if (centre - r <= shape.pointBlank && _v.dot(forward) >= -r * 0.5) {
    out.copy(_closest);
    return Math.max(0, centre - r);
  }

  const normal = _normal.crossVectors(forward, frame.sweep);
  if (normal.lengthSq() < 1e-8) return -1;
  normal.normalize();
  const half = shape.arc / 2;
  let best = -1;
  let bestOff = Infinity;
  for (let i = 0; i < count; i++) {
    const y = bottom + (span * i) / (count - 1);
    _p.set(body.base.x, y, body.base.z);
    _v.subVectors(_p, eye);
    if (shape.thrust) {
      const d = _v.length();
      if (d - r > shape.reach || d < 1e-4) continue;
      const angle = Math.acos(Math.min(1, Math.max(-1, _v.dot(forward) / d)));
      const margin = d > r ? Math.asin(r / d) : Math.PI;
      if (angle > half + margin) continue;
      const off = angle;
      if (off < bestOff) {
        bestOff = off;
        best = Math.max(0, d - r);
        out.copy(_p);
      }
      continue;
    }
    const off = _v.dot(normal);
    const far = Math.abs(off) - shape.width;
    if (far > r) continue;
    // Into the plane: where the blade's line passes this part of the body.
    _v.addScaledVector(normal, -off);
    const d = _v.length();
    // Out of the slab, the body's edge reaches into it less far than its middle would suggest.
    const sink = far > 0 ? Math.sqrt(r * r - far * far) : r;
    if (d - sink > shape.reach) continue;
    let angle = 0;
    if (d > 1e-4) {
      angle = Math.atan2(_v.dot(frame.sweep), _v.dot(forward));
      const margin = d > sink ? Math.asin(sink / d) : Math.PI;
      if (Math.abs(angle) > half + margin) continue;
    }
    // Nearest the blade's plane, and of those nearest the crosshair: in a cut that runs down a body every point is the
    // same distance from the plane, and it lands where the crosshair is, not at the feet.
    const score = Math.abs(off) + Math.abs(angle) * CROSSHAIR_PULL;
    if (score < bestOff) {
      bestOff = score;
      best = Math.max(0, d - sink);
      out.copy(_p);
    }
  }
  return best;
}

/** The plane a swing cuts on: square to the crosshair and the blade's travel, so a sideways cut slices sideways. */
export function swingNormal(frame: SwingFrame, out: THREE.Vector3): THREE.Vector3 {
  return out.crossVectors(frame.forward, frame.sweep).normalize();
}

/**
 * The blade's travel across the screen, `sx` right and `sy` up in camera axes, as a world direction square to `forward`.
 * Looking straight up or down, right is taken from `yaw`.
 */
export function sweepDirection(forward: THREE.Vector3, sx: number, sy: number, out: THREE.Vector3, right = _rightScratch, up = _upScratch): THREE.Vector3 {
  right.set(-forward.z, 0, forward.x);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  up.crossVectors(right, forward).normalize();
  return out.copy(right).multiplyScalar(sx).addScaledVector(up, sy).normalize();
}

const _rightScratch = new THREE.Vector3();
const _upScratch = new THREE.Vector3();
