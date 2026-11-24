/**
 * Co-op sync for all player-driveable vehicles (`src/vehicles/drive/`): ground trucks, bikes, tanks,
 * hover skiffs, helicopters, and fighter/bomber jets, plus Badlands Motor Pool claiming/handoff and
 * guest hijacking of host-owned enemy vehicles.
 *
 * Each player simulates their own occupied vehicle locally at full frame rate (for zero-latency driving
 * and flight controls) and sends a compact 13-number pose (`drv`, 15 Hz) while seated, plus a reliable
 * exit (`drvx`) when leaving. Other browsers render the real 3D PBR vehicle chassis (`buildVehicleModel`)
 * smoothly interpolated with spinning wheels, turning turrets, rotors, swing wings, landing gear, and
 * afterburners, hide the driver's on-foot body (`remote.inVehicle = true`), and float their callsign tag
 * above the vehicle. Projectiles (rockets, bombs, shells) and explosions already cross via RemoteFire
 * and Booms; hitscan tracers and IR flares ride `drvf`.
 */
import * as THREE from 'three';
import type { MuzzleKind, TracerKind } from '../../core/contracts';
import type { HijackClaim, HijackableVehicle } from '../../core/gameplay';
import { clamp, damp, dampAngle } from '../../core/math';
import { ModelMaterials } from '../../progression/modelkit';
import { DRIVE_VEHICLES } from '../../vehicles/drive/data';
import type { DriveableManager } from '../../vehicles/drive/manager';
import { buildVehicleModel, type VehicleModelRig } from '../../vehicles/drive/models';
import type { DriveVehicleId } from '../../vehicles/drive/types';
import type { WireClasses } from '../pressure';
import type { WorldContext, WorldModule } from './context';
import type { Vehicles } from './vehicles';
import { validVec, type Vec } from './wire';

class Rate {
  private at = 0;
  private used = 0;
  take(now: number, max: number): boolean {
    if (now - this.at >= 1000) { this.at = now; this.used = 0; }
    if (this.used >= max) return false;
    this.used++;
    return true;
  }
}

export type DriveablesEvent =
  /** 15 Hz pose of a player's occupied driveable vehicle (`p`: 13 numbers from `DriveableVehicle.wirePose`). */
  | { t: 'drv'; slot?: number; id: string; pool?: string; p: number[] }
  /** Reliable exit from a driveable vehicle (also releases/repositions any Badlands Motor Pool slot). */
  | { t: 'drvx'; slot?: number; pool?: string; p?: Vec; y?: number }
  /** Visual FX for remote vehicle hitscan tracers, Particle Lance rays, and IR flares. */
  | { t: 'drvf'; slot?: number; k: 'ray' | 'flare'; a: Vec; b?: Vec; d?: Vec; tr?: TracerKind; fl?: MuzzleKind; s?: string; pi?: number }
  /** Guest -> host request to hijack a live enemy vehicle by host vehicle id. */
  | { t: 'vhijack'; vid: number; g?: 1 }
  /** Host -> guest grant after retiring the live enemy vehicle on the host. */
  | { t: 'vhijackok'; kind: HijackClaim['kind']; p: Vec; y: number; v: Vec; hp: number; g?: 1 };

const SEND_MS = 66; // ~15 Hz smooth vehicle & jet flight sync
const POSE_PER_SECOND = 28;
const FX_PER_SECOND = 32;
const HIJACK_PER_SECOND = 4;
const VALID_TRACERS: ReadonlySet<string> = new Set(['bullet', 'heavy', 'rail', 'plasma']);
const VALID_FLASHES: ReadonlySet<string> = new Set(['rifle', 'hmg', 'plasma', 'railgun', 'autocannon', 'minigun', 'rotary', 'smg', 'rocket']);
const VALID_HIJACK_KINDS: ReadonlySet<string> = new Set(['humvee', 'truck', 'tank', 'chopper', 'transport', 'doorGunner']);

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

interface DrivePuppet {
  slot: number;
  peerId: string;
  id: DriveVehicleId;
  pool: string | null;
  rig: VehicleModelRig;
  /** Target pose received from network. */
  target: number[];
  /** Current smoothed pose. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  turretYaw: number;
  turretPitch: number;
  steer: number;
  wheelSpin: number;
  rotorAngle: number;
  wingSweep: number;
  deploy: number;
  flags: number;
  smokeTimer: number;
  lastSeenAt: number;
}

interface ActiveLocal {
  id: DriveVehicleId;
  pool: string | null;
  lastPos: Vec;
  lastYaw: number;
}

function driveablesOf(w: WorldContext): DriveableManager | null {
  return (w.ctx.progression as unknown as { driveables?: DriveableManager } | undefined)?.driveables ?? null;
}

function isDriveId(id: unknown): id is DriveVehicleId {
  return typeof id === 'string' && Object.hasOwn(DRIVE_VEHICLES, id);
}

const mm = (n: number): number => Math.round(n * 100) / 100;

export class Driveables implements WorldModule {
  private readonly puppets = new Map<number, DrivePuppet>();
  private readonly lastBySlot = new Map<number, { id: DriveVehicleId; pool?: string; p: number[] }>();
  private readonly rates = new Map<string, { pose: Rate; fx: Rate; hijack: Rate }>();
  private readonly poseBuf: number[] = [];
  private materials: ModelMaterials | null = null;
  private local: ActiveLocal | null = null;
  private nextSend = 0;
  private lastFrame = 0;
  private readonly offs: (() => void)[] = [];

  constructor(private readonly w: WorldContext, private readonly enemyVehicles: Vehicles) {
    w.router.both('drv', (v, from, now) => this.onPose(v, from, now));
    w.router.both('drvx', (v, from) => this.onExit(v, from));
    w.router.both('drvf', (v, from, now) => this.onFx(v, from, now));
    w.router.host('vhijack', (v, from, now) => this.onHijackRequest(v, from, now));
    w.router.guest('vhijackok', v => this.onHijackGrant(v));

    this.offs.push(
      w.ctx.events.on('vehicle:fx', e => {
        if (!this.w.ready) return;
        const slot = this.w.session.lobby.me?.slot;
        const ev: Extract<DriveablesEvent, { t: 'drvf' }> = {
          t: 'drvf',
          slot,
          k: e.kind,
          a: [mm(e.from.x), mm(e.from.y), mm(e.from.z)],
          ...(e.to ? { b: [mm(e.to.x), mm(e.to.y), mm(e.to.z)] } : {}),
          ...(e.dir ? { d: [mm(e.dir.x), mm(e.dir.y), mm(e.dir.z)] } : {}),
          ...(e.tracer ? { tr: e.tracer } : {}),
          ...(e.flash ? { fl: e.flash } : {}),
          ...(e.sound ? { s: e.sound } : {}),
          ...(typeof e.pitch === 'number' && Number.isFinite(e.pitch) ? { pi: mm(e.pitch) } : {}),
        };
        this.w.send(ev);
      }),
      w.ctx.events.on('dogfight:player_flares', e => {
        if (!this.w.ready) return;
        const slot = this.w.session.lobby.me?.slot;
        this.w.send({
          t: 'drvf',
          slot,
          k: 'flare',
          a: [mm(e.position.x), mm(e.position.y), mm(e.position.z)],
        });
      }),
    );
  }

  /** Number of remote teammate vehicles currently rendered on this screen (for tests & proofs). */
  get remoteCount(): number {
    return this.puppets.size;
  }

  /** Read-only snapshot of a remote teammate's vehicle puppet by slot (for tests & proofs). */
  puppet(slot: number): { id: DriveVehicleId; pool: string | null; position: [number, number, number]; yaw: number; flags: number } | null {
    const p = this.puppets.get(slot);
    return p ? { id: p.id, pool: p.pool, position: [p.x, p.y, p.z], yaw: p.yaw, flags: p.flags } : null;
  }

  /** Guest: nearest hijackable host enemy ground vehicle within `reach`. */
  findGuestHijackable(pos: THREE.Vector3, reach: number): HijackableVehicle | null {
    return this.enemyVehicles.findHijackable(pos, reach);
  }

  /** Guest: asks the host to hijack enemy vehicle `vid`. */
  requestVehicleHijack(vid: number, viaGrapple: boolean): void {
    if (this.w.hosting || !this.w.ready || !Number.isInteger(vid) || vid <= 0) return;
    this.w.send({ t: 'vhijack', vid, ...(viaGrapple ? { g: 1 as const } : {}) });
  }

  private rate(from: string) {
    let r = this.rates.get(from);
    if (!r) this.rates.set(from, r = { pose: new Rate(), fx: new Rate(), hijack: new Rate() });
    return r;
  }

  private slotOf(from: string, slot: number | undefined): { slot: number; peerId: string } | null {
    const p = this.w.playerOf(from, slot);
    if (!p || p.id === this.w.session.lobby.you) return null;
    return { slot: p.slot, peerId: p.id };
  }

  update(now: number): void {
    const dt = this.lastFrame === 0 ? 0.016 : clamp((now - this.lastFrame) / 1000, 0, 0.25);
    this.lastFrame = now;

    // 1. Broadcast local player's occupied driveable vehicle (or reliable exit when dismounting).
    const mgr = driveablesOf(this.w);
    const active = mgr?.active ?? null;
    if (active) {
      const p = active.wirePose(this.poseBuf);
      const changedVehicle = !this.local || this.local.id !== active.def.id || this.local.pool !== active.poolSlot;
      if (!this.local || changedVehicle) {
        if (this.local && changedVehicle) this.sendExit(this.local);
        this.local = {
          id: active.def.id,
          pool: active.poolSlot,
          lastPos: [p[0]!, p[1]!, p[2]!],
          lastYaw: p[3]!,
        };
      } else {
        this.local.lastPos = [p[0]!, p[1]!, p[2]!];
        this.local.lastYaw = p[3]!;
      }

      if (this.w.ready && (changedVehicle || now >= this.nextSend)) {
        this.nextSend = now + SEND_MS;
        const slot = this.w.session.lobby.me?.slot;
        const copy = p.slice();
        if (slot !== undefined) {
          this.lastBySlot.set(slot, { id: active.def.id, ...(active.poolSlot ? { pool: active.poolSlot } : {}), p: copy });
        }
        this.w.send({
          t: 'drv',
          slot,
          id: active.def.id,
          ...(active.poolSlot ? { pool: active.poolSlot } : {}),
          p: copy,
        });
      }
    } else if (this.local) {
      const prev = this.local;
      this.local = null;
      this.sendExit(prev);
    }

    // 2. Smoothly animate all remote teammate vehicle puppets every frame.
    for (const [slot, puppet] of this.puppets) {
      // Auto-retire stale puppets if a peer silently vanished without sending `drvx`.
      if (now - puppet.lastSeenAt > 4500) {
        this.dropPuppet(slot, false);
        continue;
      }
      this.stepPuppet(puppet, dt);
    }
  }

  private sendExit(prev: ActiveLocal): void {
    const slot = this.w.session.lobby.me?.slot;
    if (slot !== undefined) this.lastBySlot.delete(slot);
    if (!this.w.ready) return;
    this.w.send({
      t: 'drvx',
      slot,
      ...(prev.pool ? { pool: prev.pool } : {}),
      p: prev.lastPos,
      y: prev.lastYaw,
    });
  }

  private onPose(value: Extract<DriveablesEvent, { t: 'drv' }>, from: string, now: number): void {
    const who = this.slotOf(from, value.slot);
    if (!who || !isDriveId(value.id) || !Array.isArray(value.p) || value.p.length < 13 || !value.p.every(Number.isFinite)) return;
    const pool = typeof value.pool === 'string' && value.pool.length <= 48 ? value.pool : undefined;
    const p = value.p.slice(0, 13);

    if (this.w.hosting) {
      if (!this.rate(from).pose.take(now, POSE_PER_SECOND)) return;
      // Grant vehicle-weapon range & burst allowance while this guest drives/flies a vehicle.
      this.w.validator.callIn(from, now);
      this.lastBySlot.set(who.slot, { id: value.id, ...(pool ? { pool } : {}), p });
      this.w.relay({ t: 'drv', slot: who.slot, id: value.id, ...(pool ? { pool } : {}), p }, from);
    }

    this.applyRemotePose(who.slot, who.peerId, value.id, pool ?? null, p, now);
  }

  private applyRemotePose(slot: number, peerId: string, id: DriveVehicleId, pool: string | null, p: number[], now: number): void {
    const scene = this.w.ctx.render?.scene;
    let puppet = this.puppets.get(slot);
    if (puppet && (puppet.id !== id || puppet.pool !== pool)) {
      this.dropPuppet(slot, false);
      puppet = undefined;
    }

    if (!puppet) {
      if (!scene) return;
      this.materials ??= new ModelMaterials(this.w.ctx);
      const rig = buildVehicleModel(id, this.materials);
      rig.root.position.set(p[0]!, p[1]!, p[2]!);
      rig.root.rotation.set(0, p[3]!, 0);
      if (rig.riders.length > 0) rig.riders[0]!.root.visible = true;
      scene.add(rig.root);

      puppet = {
        slot,
        peerId,
        id,
        pool,
        rig,
        target: p.slice(),
        x: p[0]!,
        y: p[1]!,
        z: p[2]!,
        yaw: p[3]!,
        pitch: p[4]!,
        roll: p[5]!,
        turretYaw: p[6]!,
        turretPitch: p[7]!,
        steer: p[8]!,
        wheelSpin: p[9]!,
        rotorAngle: p[10]!,
        wingSweep: p[11]!,
        deploy: (p[12]! & 8) ? 1 : 0,
        flags: p[12]! | 0,
        smokeTimer: 0,
        lastSeenAt: now,
      };
      this.puppets.set(slot, puppet);

      if (pool) driveablesOf(this.w)?.setRemoteClaim(pool, true);
    } else {
      puppet.peerId = peerId;
      puppet.target = p.slice();
      puppet.flags = p[12]! | 0;
      puppet.lastSeenAt = now;
    }

    const remote = this.w.session.remotes.get(peerId);
    if (remote) remote.inVehicle = true;
  }

  private onExit(value: Extract<DriveablesEvent, { t: 'drvx' }>, from: string): void {
    const who = this.slotOf(from, value.slot);
    if (!who) return;
    const pool = typeof value.pool === 'string' && value.pool.length <= 48 ? value.pool : undefined;
    const pos = validVec(value.p) ? value.p : undefined;
    const yaw = typeof value.y === 'number' && Number.isFinite(value.y) ? value.y : undefined;

    if (this.w.hosting) {
      this.lastBySlot.delete(who.slot);
      this.w.relay({ t: 'drvx', slot: who.slot, ...(pool ? { pool } : {}), ...(pos ? { p: pos } : {}), ...(yaw !== undefined ? { y: yaw } : {}) }, from);
    }

    this.dropPuppet(who.slot, true, pos, yaw, pool);
  }

  private dropPuppet(slot: number, releasePool: boolean, pos?: Vec, yaw?: number, overridePool?: string): void {
    const puppet = this.puppets.get(slot);
    const pool = overridePool ?? puppet?.pool ?? null;
    if (puppet) {
      puppet.rig.root.removeFromParent();
      const remote = this.w.session.remotes.get(puppet.peerId);
      if (remote) remote.inVehicle = false;
      this.puppets.delete(slot);
    } else {
      const p = this.w.session.lobby.players.find(x => x.slot === slot);
      const remote = p ? this.w.session.remotes.get(p.id) : undefined;
      if (remote) remote.inVehicle = false;
    }
    if (releasePool && pool) {
      const mgr = driveablesOf(this.w);
      if (pos && yaw !== undefined) {
        mgr?.releaseRemoteClaim(pool, _a.set(pos[0], pos[1], pos[2]), yaw);
      } else {
        mgr?.releaseRemoteClaim(pool);
      }
    }
  }

  private stepPuppet(p: DrivePuppet, dt: number): void {
    const t = p.target;
    const def = DRIVE_VEHICLES[p.id];
    const rate = def.category === 'jet' ? 18 : 15;
    // Snap if teleported (e.g., carrier deck respawn / ocean rescue) so we never streak across the map.
    const distSq = (t[0]! - p.x) ** 2 + (t[1]! - p.y) ** 2 + (t[2]! - p.z) ** 2;
    if (distSq > 64 * 64) {
      p.x = t[0]!; p.y = t[1]!; p.z = t[2]!;
      p.yaw = t[3]!; p.pitch = t[4]!; p.roll = t[5]!;
    } else {
      p.x = damp(p.x, t[0]!, rate, dt);
      p.y = damp(p.y, t[1]!, rate, dt);
      p.z = damp(p.z, t[2]!, rate, dt);
      p.yaw = dampAngle(p.yaw, t[3]!, rate, dt);
      p.pitch = damp(p.pitch, t[4]!, rate, dt);
      p.roll = damp(p.roll, t[5]!, rate, dt);
    }
    p.turretYaw = dampAngle(p.turretYaw, t[6]!, 14, dt);
    p.turretPitch = damp(p.turretPitch, t[7]!, 14, dt);
    p.steer = damp(p.steer, t[8]!, 14, dt);
    p.wheelSpin = damp(p.wheelSpin, t[9]!, 16, dt);
    p.rotorAngle = def.category === 'helicopter' ? p.rotorAngle + dt * 26 : damp(p.rotorAngle, t[10]!, 16, dt);
    p.wingSweep = damp(p.wingSweep, t[11]!, 8, dt);
    p.deploy = damp(p.deploy, (p.flags & 8) ? 1 : 0, 6, dt);

    const { rig } = p;
    rig.root.position.set(p.x, p.y, p.z);
    rig.root.rotation.set(0, p.yaw, 0);
    rig.body.position.y = rig.bodyBaseY ?? 0;
    rig.body.rotation.set(p.pitch, 0, p.roll);

    if (rig.turret) rig.turret.rotation.y = p.turretYaw;
    if (rig.barrel) rig.barrel.rotation.x = clamp(-p.turretPitch, -0.55, 0.38);
    for (const wf of rig.wheelsFront) {
      wf.rotation.order = 'YXZ';
      wf.rotation.y = p.steer;
      wf.rotation.x = p.wheelSpin;
    }
    for (const wr of rig.wheelsRear) wr.rotation.x = p.wheelSpin;
    if (rig.rotorMain) rig.rotorMain.rotation.y = p.rotorAngle;
    if (rig.rotorTail) rig.rotorTail.rotation.x = p.rotorAngle * 2.8;
    if (rig.wingsLeft) rig.wingsLeft.rotation.y = p.wingSweep * 0.78;
    if (rig.wingsRight) rig.wingsRight.rotation.y = -p.wingSweep * 0.78;
    if (rig.landingGear) rig.landingGear.visible = (p.flags & 4) !== 0;
    for (const g of rig.boostGlow) g.visible = (p.flags & 1) !== 0;
    if (rig.vtolGlow) for (const g of rig.vtolGlow) g.visible = (p.flags & 2) !== 0;
    if (rig.dumpBurnGlow) for (const g of rig.dumpBurnGlow) g.visible = (p.flags & 16) !== 0;
    for (let i = 0; i < rig.outriggers.length; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      rig.outriggers[i]!.rotation.z = side * 1.15 * (1 - p.deploy);
    }

    // Float the teammate's callsign tag cleanly above the vehicle roof/canopy.
    const remote = this.w.session.remotes.get(p.peerId);
    if (remote) {
      remote.inVehicle = true;
      remote.tag.set(p.x, p.y + def.halfHeight * 2 + 1.4, p.z);
    }

    // Damaged smoke plume on low-HP teammate vehicles.
    if (p.flags & 32) {
      p.smokeTimer -= dt;
      if (p.smokeTimer <= 0) {
        p.smokeTimer = 0.14;
        _a.set(p.x, p.y + def.halfHeight + 0.4, p.z);
        this.w.ctx.fx?.smoke?.(_a, 0x2e3136, 0.9, 1.4);
      }
    }
  }

  private onFx(value: Extract<DriveablesEvent, { t: 'drvf' }>, from: string, now: number): void {
    const who = this.slotOf(from, value.slot);
    if (!who || !validVec(value.a)) return;
    if (value.k !== 'ray' && value.k !== 'flare') return;

    if (this.w.hosting) {
      if (!this.rate(from).fx.take(now, FX_PER_SECOND)) return;
      this.w.relay({ ...value, slot: who.slot }, from);
    }

    const { ctx } = this.w;
    _a.set(value.a[0], value.a[1], value.a[2]);
    if (value.k === 'flare') {
      ctx.fx?.sparks?.(_a, _up, 18, 0xffe484);
      ctx.fx?.smoke?.(_a, 0xffe9b5, 1.3, 1.4);
      ctx.audio?.play?.('flare_pop', { position: _a, volume: 0.75 });
      return;
    }
    if (validVec(value.b)) {
      _b.set(value.b[0], value.b[1], value.b[2]);
      const tr: TracerKind = typeof value.tr === 'string' && VALID_TRACERS.has(value.tr) ? value.tr as TracerKind : 'bullet';
      ctx.fx?.tracer?.(_a, _b, tr);
    }
    if (validVec(value.d)) {
      _d.set(value.d[0], value.d[1], value.d[2]).normalize();
      const fl: MuzzleKind = typeof value.fl === 'string' && VALID_FLASHES.has(value.fl) ? value.fl as MuzzleKind : 'rifle';
      ctx.fx?.muzzleFlash?.(_a, _d, fl);
    }
    if (typeof value.s === 'string' && value.s.length > 0 && value.s.length <= 32) {
      const pitch = typeof value.pi === 'number' && Number.isFinite(value.pi) ? clamp(value.pi, 0.4, 2.5) : 1;
      ctx.audio?.play?.(value.s, { position: _a, volume: 0.62, pitch });
    }
  }

  /** Host: honors a guest's request to hijack a live enemy vehicle (`humvee`, `truck`, `tank`, etc.). */
  private onHijackRequest(value: Extract<DriveablesEvent, { t: 'vhijack' }>, from: string, now: number): void {
    if (!this.w.hosting || !Number.isInteger(value.vid) || value.vid <= 0) return;
    if (!this.rate(from).hijack.take(now, HIJACK_PER_SECOND)) return;
    const target = this.enemyVehicles.find(value.vid);
    if (!target || !target.alive) return;
    const claim = this.w.ctx.enemies?.vehicles?.hijack?.(target.uid);
    if (!claim) return;
    this.w.validator.callIn(from, now);
    this.w.send({
      t: 'vhijackok',
      kind: claim.kind,
      p: [mm(claim.position.x), mm(claim.position.y), mm(claim.position.z)],
      y: mm(claim.yaw),
      v: [mm(claim.velocity.x), mm(claim.velocity.y), mm(claim.velocity.z)],
      hp: mm(claim.healthFraction),
      ...(value.g === 1 ? { g: 1 as const } : {}),
    }, from);
  }

  /** Guest: spawns and boards the hijacked enemy vehicle granted by the host. */
  private onHijackGrant(value: Extract<DriveablesEvent, { t: 'vhijackok' }>): void {
    if (this.w.hosting) return;
    if (!validVec(value.p) || !validVec(value.v) || !Number.isFinite(value.y) || !Number.isFinite(value.hp)) return;
    if (!VALID_HIJACK_KINDS.has(value.kind)) return;
    const mgr = driveablesOf(this.w);
    if (!mgr) return;
    mgr.completeHijack(
      value.kind,
      new THREE.Vector3(value.p[0], value.p[1], value.p[2]),
      value.y,
      new THREE.Vector3(value.v[0], value.v[1], value.v[2]),
      clamp(value.hp, 0.25, 1),
      value.g === 1,
    );
  }

  /** Host: sends every currently occupied player vehicle to an arriving guest. */
  catchUp(id: string): void {
    if (!this.w.hosting) return;
    const to = this.w.session.lobby.players.find(p => p.id === id);
    if (!to) return;
    for (const [slot, snap] of this.lastBySlot) {
      if (slot === to.slot) continue;
      this.w.send({
        t: 'drv',
        slot,
        id: snap.id,
        ...(snap.pool ? { pool: snap.pool } : {}),
        p: snap.p,
      }, id);
    }
  }

  /** Guest: re-announces our occupied vehicle after reconnect. */
  resay(): void {
    if (this.w.hosting || !this.w.ready) return;
    const mgr = driveablesOf(this.w);
    const active = mgr?.active;
    if (!active) return;
    const slot = this.w.session.lobby.me?.slot;
    const p = active.wirePose(this.poseBuf).slice();
    this.w.send({
      t: 'drv',
      slot,
      id: active.def.id,
      ...(active.poolSlot ? { pool: active.poolSlot } : {}),
      p,
    });
  }

  /** Host: cleans up and releases any Motor Pool vehicle held by a dropped player. */
  lostSeat(_id: string, slot: number): void {
    const snap = this.lastBySlot.get(slot);
    this.lastBySlot.delete(slot);
    this.dropPuppet(slot, true, undefined, undefined, snap?.pool);
    if (this.w.hosting && snap) {
      this.w.send({ t: 'drvx', slot, ...(snap.pool ? { pool: snap.pool } : {}) });
    }
  }

  forgetPeer(id: string): void {
    this.rates.delete(id);
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    for (const slot of [...this.puppets.keys()]) this.dropPuppet(slot, true);
    this.puppets.clear();
    this.lastBySlot.clear();
    this.rates.clear();
    this.local = null;
    this.lastFrame = 0;
  }
}

export const DRIVEABLES_WIRE: WireClasses<DriveablesEvent> = {
  drv: 'latest',
  drvx: 'fact',
  drvf: 'cosmetic',
  vhijack: 'fact',
  vhijackok: 'fact',
};
