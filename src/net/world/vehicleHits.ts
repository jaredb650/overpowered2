/**
 * A guest's rounds on the host's vehicles. Vehicles live on the host; a guest only draws them (vehicles.ts). This gives each
 * drawn truck, humvee and tank the same hit boxes the real one has, moved with the drawing, so a guest's round stops on its
 * hull as the host's does, and says where it landed: the part, and the point in the vehicle's own frame (the two machines do
 * not agree on where the vehicle is to the centimetre, and a hit on the hatch on my screen is a hit on the hatch). The host
 * applies it to the real vehicle (claims.ts `vhit`). A guest's explosion goes the same way, once, and the host works out
 * which vehicles it reaches.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { ExplosionKind } from '../../core/contracts';
import type { ExplosionSpec } from '../../core/gameplay';
import { bulletDamage, directDamage } from '../../enemies/vehicles/armour';
import type { VehicleKind } from '../../campaign/types';
import { VEHICLES, type PartDef } from '../../enemies/vehicles/data';
import type { Claims } from './claims';
import type { WorldContext } from './context';
import type { Vehicles } from './vehicles';

interface Shape { id: number; kind: VehicleKind; part: PartDef; collider: RAPIER.Collider; root: THREE.Object3D }

const UP = new THREE.Vector3(0, 1, 0);
const _at = new THREE.Vector3(), _half = new THREE.Vector3(), _q = new THREE.Quaternion(), _spin = new THREE.Quaternion(), _local = new THREE.Vector3();

export class VehicleHits {
  /** Guest: every hit box, by its collider, and each vehicle's boxes by the host's id for it. */
  private readonly shapes = new Map<number, Shape>();
  private readonly fleet = new Map<number, Shape[]>();
  private readonly seen = new Set<number>();

  constructor(private readonly w: WorldContext, private readonly vehicles: Vehicles, private readonly claims: Claims) {}

  /** Guest, each frame: the boxes follow the drawings. A vehicle the host no longer sends loses its boxes. */
  update(): void {
    if (this.w.hosting) return;
    const { physics } = this.w.ctx;
    this.seen.clear();
    this.vehicles.each((id, kind, root, turret) => {
      if (!Object.hasOwn(VEHICLES, kind)) return;
      this.seen.add(id);
      let boxes = this.fleet.get(id);
      if (boxes && boxes[0]?.kind !== kind) { this.drop(id); boxes = undefined; }
      if (!boxes) {
        const def = VEHICLES[kind as VehicleKind];
        boxes = def.parts.map(part => {
          const collider = physics.addStaticBox(_at.set(0, -1e4, 0), _half.set(part.half[0], part.half[1], part.half[2]), null, def.surface);
          const shape: Shape = { id, kind: kind as VehicleKind, part, collider, root };
          this.shapes.set(collider.handle, shape);
          return shape;
        });
        this.fleet.set(id, boxes);
      }
      for (const shape of boxes) {
        const { at } = shape.part;
        shape.root = root;
        _at.set(at[0], at[1], at[2]).applyQuaternion(root.quaternion).add(root.position);
        _q.copy(root.quaternion);
        if (shape.part.turns) _q.multiply(_spin.setFromAxisAngle(UP, turret));
        shape.collider.setTranslation(_at);
        shape.collider.setRotation(_q);
      }
    });
    for (const id of this.fleet.keys()) if (!this.seen.has(id)) this.drop(id);
  }

  private drop(id: number): void {
    for (const shape of this.fleet.get(id) ?? []) {
      this.shapes.delete(shape.collider.handle);
      this.w.ctx.physics.world.removeCollider(shape.collider, true);
    }
    this.fleet.delete(id);
  }

  /**
   * Guest: my round landed on `collider`. True if that is a vehicle's box: the host is told, and the marker says what the
   * armour rules make of it (a guess; the host's word is what counts). `kind` is a rocket or shell landing on it.
   */
  shot(collider: RAPIER.Collider | null, point: THREE.Vector3, amount: number, source: string, kind?: ExplosionKind): boolean {
    const shape = collider ? this.shapes.get(collider.handle) : undefined;
    if (!shape) return false;
    const { ctx } = this.w;
    const def = VEHICLES[shape.kind];
    _local.copy(point).sub(shape.root.position).applyQuaternion(_q.copy(shape.root.quaternion).invert());
    this.claims.vehicleHit(shape.id, shape.part.id, _local, amount, source, kind);
    const dealt = kind ? directDamage(def, shape.part, amount, kind, source) : bulletDamage(def, shape.part, amount, source);
    const pierced = dealt > 0 && def.armoured && !kind;
    ctx.hud.hitMarker(pierced ? 'armorThrough' : dealt > 0 ? 'body' : 'armor');
    ctx.audio.play(pierced ? 'armour_through' : dealt > 0 ? 'hit_marker' : 'armour_stopped');
    return true;
  }

  /** Guest: my explosion. The host works out which vehicles stand in it. Nothing is sent when the host has sent no vehicle. */
  blast(center: THREE.Vector3, spec: ExplosionSpec): void {
    if (this.w.hosting || this.vehicles.none) return;
    this.claims.vehicleBlast(center, spec);
  }

  dispose(): void {
    for (const id of [...this.fleet.keys()]) this.drop(id);
  }
}
