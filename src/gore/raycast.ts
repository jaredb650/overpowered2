/**
 * Analytic ray tests against rig hit capsules. All gunplay resolves through here, so it runs in world
 * space off the bone matrices the renderer last used: what the player saw is what the bullet hits.
 */
import * as THREE from 'three';
import type { Object3D } from 'three';
import type { CapsuleHit } from '../core/contracts';
import { CAP_STRIDE, type RigInfo } from './rigInfo';

const EPS = 1e-9;

/**
 * Nearest intersection of a unit-direction ray with the capsule a-b. Returns the distance along the ray,
 * or -1 for a miss. A ray starting inside the capsule hits at 0, so point-blank shots always connect.
 */
export function rayCapsule(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  r: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const aox = ox - ax;
  const aoy = oy - ay;
  const aoz = oz - az;
  const baba = abx * abx + aby * aby + abz * abz;
  const baoa = abx * aox + aby * aoy + abz * aoz;
  const r2 = r * r;

  // Inside test first: nothing below is well defined for an origin within the shape.
  const s = baba > EPS ? Math.min(1, Math.max(0, baoa / baba)) : 0;
  const ix = aox - abx * s;
  const iy = aoy - aby * s;
  const iz = aoz - abz * s;
  if (ix * ix + iy * iy + iz * iz <= r2) return 0;

  let best = Infinity;

  if (baba > EPS) {
    const bard = abx * dx + aby * dy + abz * dz;
    const rdoa = dx * aox + dy * aoy + dz * aoz;
    const oaoa = aox * aox + aoy * aoy + aoz * aoz;
    const a = baba - bard * bard;
    // A ray running along the axis never enters the side wall, only the end caps.
    if (a > EPS) {
      const b = baba * rdoa - baoa * bard;
      const c = baba * oaoa - baoa * baoa - r2 * baba;
      const h = b * b - a * c;
      if (h >= 0) {
        const t = (-b - Math.sqrt(h)) / a;
        const y = baoa + t * bard;
        if (t >= 0 && y >= 0 && y <= baba) best = t;
      }
    }
  }

  if (best === Infinity) {
    const ta = raySphere(aox, aoy, aoz, dx, dy, dz, r2);
    if (ta >= 0 && ta < best) best = ta;
    const tb = raySphere(ox - bx, oy - by, oz - bz, dx, dy, dz, r2);
    if (tb >= 0 && tb < best) best = tb;
  }
  return best === Infinity ? -1 : best;
}

/** `o` is the ray origin relative to the sphere centre. */
function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, r2: number): number {
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - r2;
  const h = b * b - c;
  if (h < 0) return -1;
  return -b - Math.sqrt(h);
}

/** True when a ray comes within `radius` of (cx, cy, cz) inside `maxDist`. The cheap reject before capsules. */
export function rayNearSphere(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number, radius: number, maxDist: number,
): boolean {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const along = lx * dx + ly * dy + lz * dz;
  const l2 = lx * lx + ly * ly + lz * lz;
  const r2 = radius * radius;
  if (l2 <= r2) return true;
  if (along < 0 || along - radius > maxDist) return false;
  return l2 - along * along <= r2;
}

/** Winner of the last rayBones call. Read it straight after a true return. */
export interface BoneRayResult {
  distance: number;
  capsule: number;
  bone: number;
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
}

export const boneRay: BoneRayResult = { distance: 0, capsule: -1, bone: -1, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0 };

/**
 * Tests a ray against every capsule of a rig. `skip` marks bones to ignore (severed, or outside a limb).
 * `boneMatrices` must hold world matrices, index-aligned with the rig.
 */
export function rayBones(
  info: RigInfo,
  bones: readonly Object3D[],
  skip: Uint8Array | null,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
): boolean {
  const caps = info.caps;
  let best = maxDist;
  let found = false;
  for (let c = 0; c < info.capCount; c++) {
    const bone = info.capBone[c]!;
    if (skip !== null && skip[bone] === 1) continue;
    const m = bones[bone]!.matrixWorld.elements;
    const o = c * CAP_STRIDE;
    const fx = caps[o]!;
    const fy = caps[o + 1]!;
    const fz = caps[o + 2]!;
    const tx = caps[o + 3]!;
    const ty = caps[o + 4]!;
    const tz = caps[o + 5]!;
    const ax = m[0]! * fx + m[4]! * fy + m[8]! * fz + m[12]!;
    const ay = m[1]! * fx + m[5]! * fy + m[9]! * fz + m[13]!;
    const az = m[2]! * fx + m[6]! * fy + m[10]! * fz + m[14]!;
    const bx = m[0]! * tx + m[4]! * ty + m[8]! * tz + m[12]!;
    const by = m[1]! * tx + m[5]! * ty + m[9]! * tz + m[13]!;
    const bz = m[2]! * tx + m[6]! * ty + m[10]! * tz + m[14]!;
    const scale = Math.sqrt(m[0]! * m[0]! + m[1]! * m[1]! + m[2]! * m[2]!);
    // A bone hidden by collapsing its scale has no surface left to hit.
    if (scale < 1e-4) continue;
    const t = rayCapsule(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, caps[o + 6]! * scale);
    if (t >= 0 && t <= best) {
      best = t;
      found = true;
      boneRay.distance = t;
      boneRay.capsule = c;
      boneRay.bone = bone;
      boneRay.ax = ax;
      boneRay.ay = ay;
      boneRay.az = az;
      boneRay.bx = bx;
      boneRay.by = by;
      boneRay.bz = bz;
    }
  }
  return found;
}

/**
 * Writes the hit point and outward normal for the last rayBones hit. A hit at distance 0 (origin inside a
 * capsule) has no meaningful surface, so its normal faces back along the ray.
 */
export function boneRayContact(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  point: THREE.Vector3, normal: THREE.Vector3,
): void {
  const r = boneRay;
  const t = r.distance;
  const px = ox + dx * t;
  const py = oy + dy * t;
  const pz = oz + dz * t;
  point.set(px, py, pz);
  if (t <= 0) {
    normal.set(-dx, -dy, -dz);
    return;
  }
  const abx = r.bx - r.ax;
  const aby = r.by - r.ay;
  const abz = r.bz - r.az;
  const baba = abx * abx + aby * aby + abz * abz;
  const s = baba > EPS
    ? Math.min(1, Math.max(0, ((px - r.ax) * abx + (py - r.ay) * aby + (pz - r.az) * abz) / baba))
    : 0;
  normal.set(px - (r.ax + abx * s), py - (r.ay + aby * s), pz - (r.az + abz * s)).normalize();
}

/**
 * Hits handed to gameplay come from a ring rather than one shared object. A shot loop keeps its best hit
 * while testing the next enemy, and only actual hits consume a slot, so a ring this size cannot alias
 * inside one shot even with piercing weapons. Hold a hit past the frame and it will be overwritten.
 */
const RING = 64;
const ring: CapsuleHit[] = Array.from({ length: RING }, () => ({
  distance: 0,
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  bone: -1,
  region: 'chest',
}));
let ringAt = 0;

export function nextCapsuleHit(): CapsuleHit {
  ringAt = (ringAt + 1) % RING;
  return ring[ringAt]!;
}
