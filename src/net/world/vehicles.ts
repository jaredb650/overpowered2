/**
 * The host's ground vehicles (humvees, trucks, tanks) on guests: the host sends where each is every SEND_MS, stamped with its
 * clock, and a guest draws models only, each a little in the past between two of those states (motion.ts, as the enemies
 * are), whatever the frame rate. They are hurt only on the host (a guest's blast reaches them through booms.ts).
 */
import * as THREE from 'three';
import type { GroundModel } from '../../enemies/vehicles/models';
import type { Vehicle } from '../../enemies/vehicles/vehicle';
import type { WorldContext, WorldModule } from './context';
import { HostClock, MotionBuffer, motionSample } from './motion';
import type { Replicas } from './replicas';
import { validVec, type Vec } from './wire';

/** Host: the trucks, humvees and tanks, 5 Hz, and the host's clock (ms) when they were read. Drawn on guests; hurt only on the host. */
export type VehiclesEvent = { t: 'vehicles'; at?: number; list: { id: number; kind: string; p: Vec; q: [number, number, number, number]; turret: number }[] };

const SEND_MS = 200;
const _q = new THREE.Quaternion();

export class Vehicles implements WorldModule {
  /** Host: an id for each vehicle; guest: the drawn copies. */
  private readonly ids = new WeakMap<Vehicle, number>();
  private serial = 0;
  private next = 0;
  private sent = false;
  private readonly puppets = new Map<number, { model: GroundModel; motion: MotionBuffer; kind: string }>();
  /** Guest: the host's clock from these events alone, used until the enemies' lane (many more packets) has a better one. */
  private readonly clock = new HostClock();
  private readonly sample = motionSample();
  private lastFrame = 0;

  constructor(private readonly w: WorldContext, private readonly replicas: Replicas) {
    w.router.guest('vehicles', (value, _from, now) => this.draw(value, now));
  }

  /** Guest: each drawn vehicle with the host's id for it (vehicleHits.ts gives them hit boxes). */
  each(visit: (id: number, kind: string, root: THREE.Object3D, turret: number) => void): void {
    for (const [id, puppet] of this.puppets) visit(id, puppet.kind, puppet.model.root, puppet.model.turret?.rotation.y ?? 0);
  }
  /** Guest: the host has sent no vehicle. */
  get none(): boolean { return this.puppets.size === 0; }
  /** Host: the live vehicle the guests know as `id` (claims.ts applies a guest's round to it). */
  find(id: number): Vehicle | undefined {
    const live = (this.w.ctx.enemies.vehicles as unknown as { live?: Vehicle[] } | undefined)?.live;
    return live?.find(vehicle => this.ids.get(vehicle) === id);
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
    this.w.send({ t: 'vehicles', at: Math.round(performance.now()), list });
  }

  /** Guest: the host's vehicles as models only; each state goes into its vehicle's buffer. */
  private draw(value: VehiclesEvent, now: number): void {
    if (!Array.isArray(value.list)) return;
    // The host's stamp; from a host that sent none, the time it came (the same timeline, a little rougher).
    const stamped = typeof value.at === 'number' && Number.isFinite(value.at);
    const t = stamped ? value.at! : now;
    if (stamped) this.clock.observe(t, now); else this.clock.observe(now, now);
    const fleet = (this.w.ctx.enemies.vehicles as unknown as { fleet?: { ground(kind: string): GroundModel } } | undefined)?.fleet;
    const seen = new Set<number>();
    for (const v of value.list.slice(0, 16)) {
      if (!v || !Number.isInteger(v.id) || !['humvee', 'truck', 'tank'].includes(v.kind) || !validVec(v.p) || !Array.isArray(v.q) || v.q.length !== 4 || !v.q.every(Number.isFinite)) continue;
      seen.add(v.id);
      let puppet = this.puppets.get(v.id);
      if (!puppet || puppet.kind !== v.kind) {
        if (!fleet) continue;
        puppet?.model.root.removeFromParent();
        const model = fleet.ground(v.kind);
        model.root.position.fromArray(v.p);
        model.root.quaternion.fromArray(v.q).normalize();
        puppet = { model, motion: new MotionBuffer(), kind: v.kind };
        puppet.motion.interval = SEND_MS;
        this.puppets.set(v.id, puppet);
      }
      // Where it is, its turret as the buffer's yaw (turned the short way), and its attitude in the four tags.
      puppet.motion.place(t, v.p[0], v.p[1], v.p[2], Number.isFinite(v.turret) ? v.turret : 0, v.q[0], v.q[1], v.q[2], v.q[3]);
      puppet.model.root.visible = true;
    }
    for (const [id, puppet] of this.puppets) if (!seen.has(id)) { puppet.model.root.removeFromParent(); this.puppets.delete(id); }
  }

  /** Guest, each frame before the enemies draw: every vehicle where its playhead has it, between two of the host's states. */
  animate(now: number): void {
    const dt = Math.max(0, Math.min(250, now - this.lastFrame));
    this.lastFrame = now;
    const clock = this.replicas.clock.empty ? this.clock : this.replicas.clock;
    if (clock.empty) return;
    const hostNow = clock.now(now), jitter = clock.jitter;
    for (const puppet of this.puppets.values()) {
      const motion = puppet.motion;
      const s = motion.advance(dt, hostNow, jitter, this.sample);
      if (s.mode === 2) continue;
      const root = puppet.model.root;
      root.position.set(s.x, s.y, s.z);
      root.quaternion.set(motion.tag(s.at, 0), motion.tag(s.at, 1), motion.tag(s.at, 2), motion.tag(s.at, 3));
      if (s.k > 0) root.quaternion.slerp(_q.set(motion.tag(s.at + 1, 0), motion.tag(s.at + 1, 1), motion.tag(s.at + 1, 2), motion.tag(s.at + 1, 3)), s.k);
      root.quaternion.normalize();
      if (puppet.model.turret) puppet.model.turret.rotation.y = s.yaw;
    }
  }

  dispose(): void {
    for (const puppet of this.puppets.values()) puppet.model.root.removeFromParent();
    this.puppets.clear();
  }
}
