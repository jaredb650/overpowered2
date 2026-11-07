/**
 * What a tank and a helicopter have in common: a health pool, breakable parts with a collider each, and being hit.
 *
 * A collider per part is what makes locational damage exact: the ray that stops on a track is the ray that hit the track, and what the
 * bullet stops on is what the player can see. They are plain moved colliders, like the campaign's doors, because nothing needs to bounce
 * off them, and they stay behind with the wreck as cover.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PartDef, VehicleDef } from './data';
import type { VehicleSystem } from './index';

export interface PartState {
  readonly def: PartDef;
  readonly owner: Vehicle;
  readonly collider: RAPIER.Collider;
  pool: number;
  broken: boolean;
}

const PARKED = 1e4;

const _at = new THREE.Vector3();
const _half = new THREE.Vector3();
const _local = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _spin = new THREE.Quaternion();
const _inverse = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

export abstract class Vehicle {
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  readonly parts: PartState[] = [];
  health: number;
  alive = true;
  /** Gone from the live list on the next tick. */
  retired = false;
  /** Whoever last hurt it, for the kill. */
  source = '';
  /** Takes its HUD marker down, if the mission gave it one. */
  unmark: (() => void) | null = null;
  /** What a gunner's sight marks. */
  readonly meshes: THREE.Object3D[] = [];
  /** Radians the turret stands off the hull. */
  protected turretYaw = 0;

  constructor(protected readonly sys: VehicleSystem, readonly def: VehicleDef, readonly tag: string | null) {
    this.health = def.health;
    const { physics } = sys.ctx;
    for (const part of def.parts) {
      _at.set(0, -PARKED, 0);
      _half.set(part.half[0], part.half[1], part.half[2]);
      const collider = physics.addStaticBox(_at, _half, null, def.surface);
      const state: PartState = { def: part, owner: this, collider, pool: part.pool, broken: false };
      this.parts.push(state);
      sys.colliders.set(collider.handle, state);
    }
  }

  protected collectMeshes(root: THREE.Object3D): void {
    root.traverse(o => {
      if ((o as THREE.Mesh).isMesh) this.meshes.push(o);
    });
  }

  abstract update(dt: number): void;
  /** The end of it: the blast, the wreck and the books. */
  protected abstract destroy(source: string, point: THREE.Vector3): void;
  /** Takes it off the map with no fuss, for a new run or a mission's sweep. */
  abstract remove(): void;
  /** A part's own pool ran out. */
  protected abstract broke(part: PartState, point: THREE.Vector3): void;

  /** Where the middle of it is, for anything aiming at it. */
  get center(): THREE.Vector3 {
    return this.position;
  }

  /** Puts every collider where the model is now. */
  protected placeColliders(): void {
    for (const part of this.parts) {
      const { at } = part.def;
      _at.set(at[0], at[1], at[2]).applyQuaternion(this.quaternion).add(this.position);
      _q.copy(this.quaternion);
      if (part.def.turns) _q.multiply(_spin.setFromAxisAngle(UP, this.turretYaw));
      part.collider.setTranslation(_at);
      part.collider.setRotation(_q);
    }
  }

  /** Every collider stops answering for this vehicle. They are the wreck's now, or nobody's. */
  protected releaseColliders(): RAPIER.Collider[] {
    const list: RAPIER.Collider[] = [];
    for (const part of this.parts) {
      this.sys.colliders.delete(part.collider.handle);
      list.push(part.collider);
    }
    return list;
  }

  /** Damage that has already been through the armour rules. */
  take(amount: number, part: PartState | null, source: string, point: THREE.Vector3): void {
    if (!this.alive || amount <= 0) return;
    this.source = source;
    this.health -= amount;
    if (part && part.def.pool > 0 && !part.broken) {
      part.pool -= amount;
      if (part.pool <= 0) {
        part.broken = true;
        this.broke(part, point);
      }
    }
    if (this.health <= 0 && this.alive) this.destroy(source, point);
  }

  /** Metres from a point to the nearest part of the vehicle, and which part that is. */
  nearest(point: THREE.Vector3, out: { distance: number; part: PartState | null }): void {
    _inverse.copy(this.quaternion).invert();
    _local.copy(point).sub(this.position).applyQuaternion(_inverse);
    out.distance = Infinity;
    out.part = null;
    for (const part of this.parts) {
      const { at, half } = part.def;
      const dx = Math.max(Math.abs(_local.x - at[0]) - half[0], 0);
      const dy = Math.max(Math.abs(_local.y - at[1]) - half[1], 0);
      const dz = Math.max(Math.abs(_local.z - at[2]) - half[2], 0);
      const d = Math.hypot(dx, dy, dz);
      if (d < out.distance) {
        out.distance = d;
        out.part = part;
      }
    }
  }
}
