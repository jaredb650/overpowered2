/** Scalar segment maths for hit tests. Takes vectors, returns numbers, so nothing allocates. */
import * as THREE from 'three';

const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _r = new THREE.Vector3();

/** Result of closestSegmentPoints: parameters along each segment, and squared distance between the points. */
export const closest = { s: 0, t: 0, dist2: 0 };

/** Closest approach of segments p1-q1 and p2-q2. Ericson, Real-Time Collision Detection, 5.1.9. */
export function closestSegmentPoints(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3): typeof closest {
  _d1.subVectors(q1, p1);
  _d2.subVectors(q2, p2);
  _r.subVectors(p1, p2);
  const a = _d1.lengthSq();
  const e = _d2.lengthSq();
  const f = _d2.dot(_r);
  let s = 0;
  let t = 0;
  if (a <= 1e-9 && e <= 1e-9) {
    s = t = 0;
  } else if (a <= 1e-9) {
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  } else {
    const c = _d1.dot(_r);
    if (e <= 1e-9) {
      s = THREE.MathUtils.clamp(-c / a, 0, 1);
    } else {
      const b = _d1.dot(_d2);
      const denom = a * e - b * b;
      s = denom > 1e-9 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
      }
    }
  }
  const x = p1.x + _d1.x * s - (p2.x + _d2.x * t);
  const y = p1.y + _d1.y * s - (p2.y + _d2.y * t);
  const z = p1.z + _d1.z * s - (p2.z + _d2.z * t);
  closest.s = s;
  closest.t = t;
  closest.dist2 = x * x + y * y + z * z;
  return closest;
}

/** Writes the point on segment a-b nearest to `p` into `out`. */
export function closestOnSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  _d1.subVectors(b, a);
  const len2 = _d1.lengthSq();
  const t = len2 > 1e-9 ? THREE.MathUtils.clamp(_r.subVectors(p, a).dot(_d1) / len2, 0, 1) : 0;
  return out.copy(a).addScaledVector(_d1, t);
}
