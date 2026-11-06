/**
 * Capsule queries for the character controller, straight on the Rapier world so a query allocates only what
 * Rapier itself returns. The position passed around everywhere is the FEET: the bottom of the capsule.
 *
 * Shape casts use a target distance of 0 and the controller keeps its own skin gap. Rapier's non-zero target
 * distance gives bad normals and missed hits when a cast starts inside that distance, and any cast that starts
 * in penetration can report nothing at all, so `depenetrate` exists as a safety net.
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

export class CapsuleWorld {
  private readonly groups: number;
  private readonly center = new THREE.Vector3();
  private readonly shapes = new Map<number, RAPIER.Capsule>();
  private readonly ray: RAPIER.Ray;
  private readonly rapier: PhysicsSystem['R'];
  private readonly world: RAPIER.World;
  private readonly push = new THREE.Vector3();

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
    const hit = this.world.castShape(
      this.centerOf(feet, height), IDENTITY, motion, this.shape(height), 0, 1, false, undefined, this.groups,
    );
    if (!hit) return false;
    out.toi = hit.time_of_impact;
    out.normal.set(hit.normal1.x, hit.normal1.y, hit.normal1.z);
    out.point.set(hit.witness1.x, hit.witness1.y, hit.witness1.z);
    out.collider = hit.collider;
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
    out.toi = hit.timeOfImpact;
    out.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    out.point.copy(origin).addScaledVector(dir, hit.timeOfImpact);
    out.collider = hit.collider;
    return true;
  }

  /**
   * Pushes the capsule out of anything it overlaps, along contact normals. Teleports, crushers and growing the
   * capsule can all start a tick inside a surface, where shape casts cannot be trusted. Returns true if it moved.
   */
  depenetrate(feet: THREE.Vector3, height: number, skin: number): boolean {
    const shape = this.shape(height);
    let moved = false;
    for (let i = 0; i < MAX_PUSHES; i++) {
      const center = this.centerOf(feet, height);
      this.push.set(0, 0, 0);
      let any = false;
      this.world.intersectionsWithShape(center, IDENTITY, shape, collider => {
        const contact = shape.contactShape(center, IDENTITY, collider.shape, collider.translation(), collider.rotation(), skin);
        if (contact && contact.distance < 0) {
          // normal2 lies on the collider and points out of it.
          const depth = -contact.distance + skin;
          this.push.x += contact.normal2.x * depth;
          this.push.y += contact.normal2.y * depth;
          this.push.z += contact.normal2.z * depth;
          any = true;
        }
        return true;
      }, undefined, this.groups);
      if (!any) break;
      feet.add(this.push);
      moved = true;
    }
    return moved;
  }
}
