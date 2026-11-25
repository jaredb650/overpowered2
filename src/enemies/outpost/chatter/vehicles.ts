/**
 * Ground squad combined-arms chatter & physical reactions to player vehicles, vehicle ordnance, CCIP bomb aim,
 * hijacks, and roadkills. Listens to `vehicle:boarded`, `vehicle:ordnance`, and `vehicle:roadkill` and ticks
 * staggered first-contact vehicle callouts, live CCIP scatter, and anti-roadkill sidesteps.
 */
import * as THREE from 'three';
import { mountOfVehicle, type CcipKind, type OrdnanceEventKind, type PlayerMount } from '../../aiWorld';
import type { DriveVehicleId } from '../../../vehicles/drive/types';
import type { Outpost } from '../index';
import { FEAR } from '../morale';
import type { Soldier } from '../soldier';

const TICK_INTERVAL = 0.35;
const SPOT_COOLDOWN = 14;
const CCIP_SCATTER_COOLDOWN = 1.25;
const DODGE_COOLDOWN = 2.0;

const SCATTER_RADIUS: Partial<Record<OrdnanceEventKind, number>> = {
  moab: 44,
  thermobaric: 38,
  napalm: 28,
  cluster: 28,
  bomb: 26,
  chute: 26,
  dump_burn: 24,
  mortar: 18,
  lance: 18,
  stomp: 15,
};

const _escape = new THREE.Vector3();
const _dir = new THREE.Vector3();

function mountOfId(id: DriveVehicleId | 'frame'): PlayerMount {
  return id === 'frame' ? 'frame' : mountOfVehicle(id);
}

function ccipToOrdnance(kind: CcipKind | null): OrdnanceEventKind {
  return kind === null || kind === 'he' ? 'bomb' : kind;
}

export class VehicleChatter {
  private nextTickAt = 0;
  private lastSpottedMount: PlayerMount = 'foot';
  private lastSpottedAt = -Infinity;
  private lastCcipScatterAt = -Infinity;
  private readonly dodgedAt = new WeakMap<Soldier, number>();

  constructor(private readonly o: Outpost) {
    const events = o.w.ctx.events;
    events.on('vehicle:boarded', e => this.onBoarded(e.id, e.mount, e.hijacked, e.viaGrapple));
    events.on('vehicle:ordnance', e => this.onOrdnance(e.kind, mountOfId(e.vehicleId), e.origin, e.target));
    events.on('vehicle:roadkill', e => this.onRoadkill(e.vehicleId, mountOfId(e.vehicleId), e.position));
  }

  reset(): void {
    this.nextTickAt = 0;
    this.lastSpottedMount = 'foot';
    this.lastSpottedAt = -Infinity;
    this.lastCcipScatterAt = -Infinity;
  }

  private nearestFighter(point: THREE.Vector3, maxDist: number): Soldier | null {
    const maxSq = maxDist * maxDist;
    let best: Soldier | null = null;
    let bestSq = maxSq;
    for (const s of this.o.soldiers) {
      if (!s.fighting || s.injuries.mute) continue;
      const dSq = s.e.position.distanceToSquared(point);
      if (dSq < bestSq) {
        bestSq = dSq;
        best = s;
      }
    }
    return best;
  }

  private onBoarded(id: string, mount: PlayerMount, hijacked: boolean, viaGrapple: boolean): void {
    const { o } = this;
    const p = o.w.player.position;
    if (hijacked) {
      const witness = this.nearestFighter(p, 110) ?? o.squads.find(q => q.inContact && q.leader?.fighting)?.leader ?? null;
      if (witness) {
        o.comms.say('vehHijack', witness, null, { flags: { [mount]: true, [id]: true, viaGrapple } });
      }
      // Watching a jet, gunship, or tank get hijacked shakes nearby troops.
      for (const s of o.soldiers) {
        if (!s.fighting) continue;
        if (s.e.position.distanceToSquared(p) <= 32 * 32) o.scare(s, FEAR.rapidLosses * 0.45);
      }
      this.lastSpottedMount = mount;
      this.lastSpottedAt = o.w.now;
      return;
    }

    const witness = this.nearestFighter(p, 95);
    if (witness && (witness.sees || witness.squad.inContact)) {
      this.lastSpottedMount = mount;
      this.lastSpottedAt = o.w.now;
      o.comms.say('vehSpotted', witness, null, { flags: { [mount]: true, [id]: true } });
    }
  }

  private onOrdnance(kind: OrdnanceEventKind, mount: PlayerMount, origin: THREE.Vector3, target: THREE.Vector3 | null): void {
    const { o } = this;
    const focus = target ?? origin;
    const radius = SCATTER_RADIUS[kind] ?? 0;
    const hearing = radius > 0 ? Math.max(95, radius * 3) : 75;
    const speaker = this.nearestFighter(focus, hearing);
    if (speaker) {
      o.comms.say('ordnance', speaker, null, { flags: { [kind]: true, [mount]: true } });
    }
    if (radius > 0) this.scatterFrom(focus, radius);
  }

  private onRoadkill(id: string, mount: PlayerMount, pos: THREE.Vector3): void {
    const { o } = this;
    const witness = this.nearestFighter(pos, 50);
    if (witness) {
      o.comms.say('vehRoadkill', witness, null, { flags: { [mount]: true, [id]: true } });
    }
    this.dodgeVehiclePath();
  }

  /** Orders fighting troopers inside `radius` of a bomb/napalm/mortar drop point to scatter radially outward. */
  scatterFrom(point: THREE.Vector3, radius: number): void {
    const { o } = this;
    const nav = o.w.ctx.world.nav;
    const rSq = radius * radius;
    let i = 0;
    for (const s of o.soldiers) {
      if (!s.fighting) continue;
      const dx = s.e.position.x - point.x;
      const dz = s.e.position.z - point.z;
      const dSq = dx * dx + dz * dz;
      if (dSq > rSq) continue;
      const d = Math.sqrt(dSq);
      const nx = d > 0.25 ? dx / d : Math.cos(i * 1.7);
      const nz = d > 0.25 ? dz / d : Math.sin(i * 1.7);
      const run = Math.max(12, radius - d + 8);
      _escape.set(s.e.position.x + nx * run, s.e.position.y, s.e.position.z + nz * run);
      if (nav.nearest(_escape, 8, _escape)) {
        o.order(s, _escape, null, 2, (i++ % 4) * 0.08);
      }
    }
  }

  /** Orders troopers standing in front of a fast-moving ground vehicle to sidestep laterally. */
  private dodgeVehiclePath(): void {
    const { o } = this;
    const p = o.w.player;
    if (p.mount === 'foot' || p.airborne) return;
    const speed = Math.hypot(p.velocity.x, p.velocity.z);
    if (speed < 7) return;
    const now = o.w.now;
    const nav = o.w.ctx.world.nav;
    const vx = p.velocity.x / speed;
    const vz = p.velocity.z / speed;
    const lookAhead = Math.min(34, speed * 2.2);

    for (const s of o.soldiers) {
      if (!s.fighting) continue;
      if (now - (this.dodgedAt.get(s) ?? -Infinity) < DODGE_COOLDOWN) continue;
      const rx = s.e.position.x - p.position.x;
      const rz = s.e.position.z - p.position.z;
      const along = rx * vx + rz * vz;
      if (along < 1.5 || along > lookAhead) continue;
      const side = rx * -vz + rz * vx;
      if (Math.abs(side) > 4.8) continue;
      const sign = side >= 0 ? 1 : -1;
      // Perpendicular sidestep away from the vehicle's nose.
      _dir.set(-vz * sign, 0, vx * sign);
      _escape.set(s.e.position.x + _dir.x * 8.5, s.e.position.y, s.e.position.z + _dir.z * 8.5);
      if (nav.nearest(_escape, 5, _escape)) {
        this.dodgedAt.set(s, now);
        o.order(s, _escape, null, 2, 0);
      }
    }
  }

  /** Periodic combined-arms sensing: vehicle first-contact callouts, live CCIP scatter, and anti-roadkill sidesteps. */
  update(): void {
    const { o } = this;
    const now = o.w.now;
    if (now < this.nextTickAt) return;
    this.nextTickAt = now + TICK_INTERVAL;

    const p = o.w.player;
    if (p.mount === 'foot') {
      this.lastSpottedMount = 'foot';
      return;
    }

    // 1. First-contact vehicle sighting if the player rolled into view in a vehicle.
    if (p.mount !== this.lastSpottedMount || now - this.lastSpottedAt >= SPOT_COOLDOWN) {
      let spotter: Soldier | null = null;
      for (const s of o.soldiers) {
        if (s.fighting && s.sees && !s.injuries.mute) { spotter = s; break; }
      }
      if (spotter) {
        this.lastSpottedMount = p.mount;
        this.lastSpottedAt = now;
        o.comms.say('vehSpotted', spotter, null, {
          flags: { [p.mount]: true, ...(p.vehicleId ? { [p.vehicleId]: true } : {}), deployedBunker: p.deployedBunker },
        });
      }
    }

    // 2. Live CCIP bomb/napalm aim scatter before impact.
    if (p.ccipActive && p.ccipPos && now - this.lastCcipScatterAt >= CCIP_SCATTER_COOLDOWN) {
      const endangered = this.nearestFighter(p.ccipPos, 22);
      if (endangered) {
        this.lastCcipScatterAt = now;
        const kind = ccipToOrdnance(p.ccipKind);
        o.comms.say('ordnance', endangered, null, { flags: { [kind]: true, incoming: true } });
        this.scatterFrom(p.ccipPos, SCATTER_RADIUS[kind] ?? 24);
      }
    }

    // 3. Anti-roadkill perpendicular sidestep when a fast vehicle charges troopers.
    if (!p.airborne && p.speed > 7) {
      this.dodgeVehiclePath();
    }
  }
}
