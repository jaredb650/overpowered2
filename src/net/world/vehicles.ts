/**
 * The host's ground vehicles (humvees, trucks, tanks) on guests: the host sends where each is every SEND_MS, and a guest draws
 * models only, moved toward each update. They are hurt only on the host (a guest's blast reaches them through booms.ts).
 */
import * as THREE from 'three';
import type { GroundModel } from '../../enemies/vehicles/models';
import type { Vehicle } from '../../enemies/vehicles/vehicle';
import type { WorldContext, WorldModule } from './context';
import { validVec, type Vec } from './wire';

/** Host: the trucks, humvees and tanks, 5 Hz. Drawn on guests; hurt only on the host. */
export type VehiclesEvent = { t: 'vehicles'; list: { id: number; kind: string; p: Vec; q: [number, number, number, number]; turret: number }[] };

const SEND_MS = 200;

export class Vehicles implements WorldModule {
  /** Host: an id for each vehicle; guest: the drawn copies. */
  private readonly ids = new WeakMap<Vehicle, number>();
  private serial = 0;
  private next = 0;
  private sent = false;
  private readonly puppets = new Map<number, { model: GroundModel; from: THREE.Vector3; to: THREE.Vector3; q: THREE.Quaternion; turret: number; at: number; kind: string }>();

  constructor(private readonly w: WorldContext) {
    w.router.guest('vehicles', value => this.draw(value));
  }

  update(now: number): void {
    if (this.w.hosting && now >= this.next) { this.next = now + SEND_MS; this.send(); }
  }

  /** Host: where every truck, humvee and tank is, for the guests to draw. */
  private send(): void {
    const live = (this.w.ctx.enemies.vehicles as unknown as { live?: Vehicle[] } | undefined)?.live;
    if (!live?.length && !this.sent) return;
    this.sent = !!live?.length;
    const list = (live ?? []).filter(v => v.alive && ['humvee', 'truck', 'tank'].includes(v.def.kind)).slice(0, 16).map(v => {
      let id = this.ids.get(v);
      if (id === undefined) this.ids.set(v, id = ++this.serial);
      return { id, kind: v.def.kind, p: v.position.toArray() as Vec, q: v.quaternion.toArray() as [number, number, number, number],
        turret: (v as unknown as { turretYaw?: number }).turretYaw ?? 0 };
    });
    this.w.send({ t: 'vehicles', list });
  }

  /** Guest: the host's vehicles as models only, moved toward each update over the next 200 ms. */
  private draw(value: VehiclesEvent): void {
    if (!Array.isArray(value.list)) return;
    const fleet = (this.w.ctx.enemies.vehicles as unknown as { fleet?: { ground(kind: string): GroundModel } } | undefined)?.fleet;
    const seen = new Set<number>();
    const now = performance.now();
    for (const v of value.list.slice(0, 16)) {
      if (!v || !Number.isInteger(v.id) || !['humvee', 'truck', 'tank'].includes(v.kind) || !validVec(v.p) || !Array.isArray(v.q) || v.q.length !== 4 || !v.q.every(Number.isFinite)) continue;
      seen.add(v.id);
      let puppet = this.puppets.get(v.id);
      if (!puppet || puppet.kind !== v.kind) {
        if (!fleet) continue;
        puppet?.model.root.removeFromParent();
        const model = fleet.ground(v.kind);
        model.root.position.fromArray(v.p);
        puppet = { model, from: new THREE.Vector3(...v.p), to: new THREE.Vector3(...v.p), q: new THREE.Quaternion(), turret: 0, at: now, kind: v.kind };
        this.puppets.set(v.id, puppet);
      }
      puppet.from.copy(puppet.model.root.position);
      puppet.to.fromArray(v.p);
      puppet.q.fromArray(v.q);
      puppet.turret = Number.isFinite(v.turret) ? v.turret : 0;
      puppet.at = now;
      puppet.model.root.visible = true;
    }
    for (const [id, puppet] of this.puppets) if (!seen.has(id)) { puppet.model.root.removeFromParent(); this.puppets.delete(id); }
  }

  /** Guest, each frame before the enemies draw: every vehicle moved toward its latest place. */
  animate(now: number): void {
    for (const puppet of this.puppets.values()) {
      const root = puppet.model.root;
      root.position.lerpVectors(puppet.from, puppet.to, Math.min(1, (now - puppet.at) / 200));
      root.quaternion.slerp(puppet.q, 0.25);
      if (puppet.model.turret) puppet.model.turret.rotation.y = puppet.turret;
    }
  }

  dispose(): void {
    for (const puppet of this.puppets.values()) puppet.model.root.removeFromParent();
    this.puppets.clear();
  }
}
