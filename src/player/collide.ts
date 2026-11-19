/**
 * Capsule queries for the character controller, straight on the Rapier world so a query allocates only what
 * Rapier itself returns. The position passed around everywhere is the FEET: the bottom of the capsule.
 *
 * Shape casts use a target distance of 0 and the controller keeps its own skin gap. Rapier's non-zero target
 * distance gives bad normals and missed hits when a cast starts inside that distance, and any cast that starts
 * in penetration can report nothing at all, so `depenetrate` exists as a safety net.
 *
 * Nothing outside the player's mask may change an answer here, and that takes more than the mask. Rapier gives one
 * hit for a sweep or a ray: the nearest. When two colliders are equally near (a capsule pressed into a desk and the
 * monitor on it, a seam between two floor slabs) it gives whichever its search tree reaches first, and every body
 * in the world is in that tree: a gib landing 30 m away changed which face the player was pushed off, and so where he
 * stood. So a hit is cast again without it, and a tie is settled by the faces themselves (`ahead`); the push out of
 * an overlap is summed in an order of its own. The player then moves the same whatever else is in the world.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsSystem } from '../core/contracts';

export interface SweepHit {
  /** 0..1 along the motion. */
  toi: number;
  normal: THREE.Vector3;
  point: THREE.Vector3;
  collider: RAPIER.Collider | null;
}

export const newSweepHit = (): SweepHit => ({
  toi: 0, normal: new THREE.Vector3(), point: new THREE.Vector3(), collider: null,
});

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const MAX_PUSHES = 4;
const OVERLAP_INSET = 0.02;
/** Colliders at the very same distance looked at for one query. More than this many is never seen. */
const MAX_TIES = 8;

/**
 * True when hit `a` should be taken over hit `b` at the same distance along `dir`: the face that stands most squarely
 * against the motion, then the one facing most upward, then by the numbers, so that the answer never depends on the
 * order Rapier found them in. The collider's handle is the last word, for two faces that are the same plane.
 */
export function ahead(a: SweepHit, b: SweepHit, dir: THREE.Vector3): boolean {
  const da = a.normal.dot(dir), db = b.normal.dot(dir);
  if (da !== db) return da < db;
  if (a.normal.y !== b.normal.y) return a.normal.y > b.normal.y;
  if (a.normal.x !== b.normal.x) return a.normal.x < b.normal.x;
  if (a.normal.z !== b.normal.z) return a.normal.z < b.normal.z;
  if (a.point.x !== b.point.x) return a.point.x < b.point.x;
  if (a.point.y !== b.point.y) return a.point.y < b.point.y;
  if (a.point.z !== b.point.z) return a.point.z < b.point.z;
  return (a.collider?.handle ?? 0) < (b.collider?.handle ?? 0);
}

const copyHit = (from: SweepHit, to: SweepHit): void => {
  to.toi = from.toi;
  to.normal.copy(from.normal);
  to.point.copy(from.point);
  to.collider = from.collider;
};

export class CapsuleWorld {
  private readonly groups: number;
  private readonly center = new THREE.Vector3();
  private readonly shapes = new Map<number, RAPIER.Capsule>();
  private readonly ray: RAPIER.Ray;
  private readonly rapier: PhysicsSystem['R'];
  private readonly world: RAPIER.World;
  private readonly push = new THREE.Vector3();
  /** A tied hit being weighed against the first. */
  private readonly alt = newSweepHit();
  /** Handles of the colliders already met at the tied distance; `untied` leaves them out of the next cast. */
  private readonly tied: number[] = [];
  private readonly untied = (collider: RAPIER.Collider): boolean => !this.tied.includes(collider.handle);
  /** The overlap's contacts, four numbers each (normal x, y, z and depth), summed sorted. Grows, never shrinks. */
  private readonly contacts: number[] = [];
  private readonly order: number[] = [];

  constructor(physics: PhysicsSystem, readonly radius: number, mask: number) {
    this.rapier = physics.R;
    this.world = physics.world;
    this.groups = (0xffff << 16) | (mask & 0xffff);
    this.ray = new physics.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  private shape(height: number, inset = 0): RAPIER.Capsule {
    const key = height + inset * 1000;
    let s = this.shapes.get(key);
    if (!s) {
      const radius = this.radius - inset;
      s = new this.rapier.Capsule(height / 2 - this.radius, radius);
      this.shapes.set(key, s);
    }
    return s;
  }

  private centerOf(feet: THREE.Vector3, height: number): THREE.Vector3 {
    this.center.copy(feet);
    this.center.y += height / 2;
    return this.center;
  }

  /** Casts the capsule along `motion`. Fills `out` and returns true on a hit. */
  sweep(feet: THREE.Vector3, height: number, motion: THREE.Vector3, out: SweepHit): boolean {
    const center = this.centerOf(feet, height);
    const shape = this.shape(height);
    const hit = this.world.castShape(center, IDENTITY, motion, shape, 0, 1, false, undefined, this.groups);
    if (!hit) return false;
    fillCast(out, hit);
    // Anything else at the very same distance? Rapier returned the nearest, so nothing is nearer.
    let next = this.world.castShape(center, IDENTITY, motion, shape, 0, 1, false, undefined, this.groups, hit.collider);
    if (!next || next.time_of_impact > out.toi) return true;
    const tied = this.tied;
    tied.length = 0;
    tied.push(hit.collider.handle);
    while (next && next.time_of_impact <= out.toi && tied.length < MAX_TIES) {
      fillCast(this.alt, next);
      if (ahead(this.alt, out, motion)) copyHit(this.alt, out);
      tied.push(next.collider.handle);
      next = this.world.castShape(center, IDENTITY, motion, shape, 0, 1, false, undefined, this.groups, undefined, undefined, this.untied);
    }
    tied.length = 0;
    return true;
  }

  /**
   * True when the capsule is inside something. It tests slightly smaller than the real capsule, because a body
   * resting a skin away from a large collider can read as overlapping through query error.
   */
  overlaps(feet: THREE.Vector3, height: number): boolean {
    return this.world.intersectionWithShape(
      this.centerOf(feet, height), IDENTITY, this.shape(height, OVERLAP_INSET), undefined, this.groups,
    ) !== null;
  }

  /** Casts a ray. Fills `out` with the distance in `toi`, and returns true on a hit. */
  castRay(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: SweepHit): boolean {
    this.ray.origin = origin;
    this.ray.dir = dir;
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, this.groups);
    if (!hit) return false;
    fillRay(out, hit, origin, dir);
    // As for a sweep: a tie is settled by the faces, not by Rapier's tree.
    let next = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, this.groups, hit.collider);
    if (!next || next.timeOfImpact > out.toi) return true;
    const tied = this.tied;
    tied.length = 0;
    tied.push(hit.collider.handle);
    while (next && next.timeOfImpact <= out.toi && tied.length < MAX_TIES) {
      fillRay(this.alt, next, origin, dir);
      if (ahead(this.alt, out, dir)) copyHit(this.alt, out);
      tied.push(next.collider.handle);
      next = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, this.groups, undefined, undefined, this.untied);
    }
    tied.length = 0;
    return true;
  }

  /**
   * Pushes the capsule out of anything it overlaps, along contact normals. Teleports, crushers and growing the
   * capsule can all start a tick inside a surface, where shape casts cannot be trusted. Returns true if it moved.
   */
  depenetrate(feet: THREE.Vector3, height: number, skin: number): boolean {
    const shape = this.shape(height);
    let moved = false;
    const contacts = this.contacts;
    for (let i = 0; i < MAX_PUSHES; i++) {
      const center = this.centerOf(feet, height);
      contacts.length = 0;
      this.world.intersectionsWithShape(center, IDENTITY, shape, collider => {
        const contact = shape.contactShape(center, IDENTITY, collider.shape, collider.translation(), collider.rotation(), skin);
        if (contact && contact.distance < 0) {
          // normal2 lies on the collider and points out of it.
          contacts.push(contact.normal2.x, contact.normal2.y, contact.normal2.z, -contact.distance + skin);
        }
        return true;
      }, undefined, this.groups);
      if (!contacts.length) break;
      // Rapier visits them in its tree's order, and three or more pushes summed in another order differ in the last bit.
      this.sumSorted();
      feet.add(this.push);
      moved = true;
    }
    contacts.length = 0;
    return moved;
  }

  /** `push` = the contacts' normals times their depths, summed in an order set by the numbers alone. */
  private sumSorted(): void {
    const c = this.contacts;
    const order = this.order;
    const n = c.length / 4;
    order.length = 0;
    for (let i = 0; i < n; i++) {
      // Insertion sort: there are one to three of them.
      let j = order.length;
      order.push(i);
      while (j > 0 && contactBefore(c, i, order[j - 1]!)) {
        order[j] = order[j - 1]!;
        j--;
      }
      order[j] = i;
    }
    this.push.set(0, 0, 0);
    for (let k = 0; k < n; k++) {
      const o = order[k]! * 4;
      const depth = c[o + 3]!;
      this.push.x += c[o]! * depth;
      this.push.y += c[o + 1]! * depth;
      this.push.z += c[o + 2]! * depth;
    }
    order.length = 0;
  }
}

function fillCast(out: SweepHit, hit: RAPIER.ColliderShapeCastHit): void {
  out.toi = hit.time_of_impact;
  out.normal.set(hit.normal1.x, hit.normal1.y, hit.normal1.z);
  out.point.set(hit.witness1.x, hit.witness1.y, hit.witness1.z);
  out.collider = hit.collider;
}

function fillRay(out: SweepHit, hit: RAPIER.RayColliderIntersection, origin: THREE.Vector3, dir: THREE.Vector3): void {
  out.toi = hit.timeOfImpact;
  out.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
  out.point.copy(origin).addScaledVector(dir, hit.timeOfImpact);
  out.collider = hit.collider;
}

/** Contact `a` is summed before contact `b`: by normal, then depth. */
function contactBefore(c: readonly number[], a: number, b: number): boolean {
  for (let k = 0; k < 4; k++) {
    const x = c[a * 4 + k]!, y = c[b * 4 + k]!;
    if (x !== y) return x < y;
  }
  return false;
}
