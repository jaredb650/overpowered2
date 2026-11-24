/**
 * Co-op sync for all player-driveable vehicles (`src/vehicles/drive/`): ground trucks, bikes, tanks,
 * hover skiffs, helicopters, and fighter/bomber jets, including:
 *   - 15 Hz hull pose & animated part replication (`drv`) + reliable exit & Motor Pool handoff (`drvx`)
 *   - Full multi-crew co-op boarding & host-arbitrated seat swapping (`drvs`) for all 8 multi-seat
 *     vehicles (Jackal, Aegis, Bastion 3-seat, Kestrel, Valkyrie, Viper, Quad, Moto)
 *   - 15 Hz gunner turret aim sync (`drvg`) so drivers & observers see roof guns / cupolas / AA Vulcans turn
 *   - Seamless driver-bail promotion (if the driver jumps out of an intact vehicle, the gunner takes over!)
 *   - Hitscan tracers, Particle Lance & IR flare FX (`drvf`)
 *   - Guest hijacking of host-owned enemy vehicles (`vhijack` / `vhijackok`)
 */
import * as THREE from 'three';
import type { MuzzleKind, TracerKind } from '../../core/contracts';
import type { HijackClaim, HijackableVehicle } from '../../core/gameplay';
import { clamp, damp, dampAngle } from '../../core/math';
import { ModelMaterials } from '../../progression/modelkit';
import { DRIVE_VEHICLES } from '../../vehicles/drive/data';
import type { DriveableManager } from '../../vehicles/drive/manager';
import { buildVehicleModel, type VehicleModelRig } from '../../vehicles/drive/models';
import { setRiderAccent } from '../../vehicles/drive/riders';
import type { DriveVehicleId } from '../../vehicles/drive/types';
import type { DriveableVehicle } from '../../vehicles/drive/vehicle';
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
  /** Reliable exit from a driveable vehicle (also releases/repositions any Badlands Motor Pool slot, or triggers crew promotion). */
  | { t: 'drvx'; slot?: number; pool?: string; p?: Vec; y?: number; dead?: 1 }
  /** Visual FX for remote vehicle hitscan tracers, Particle Lance rays, and IR flares. */
  | { t: 'drvf'; slot?: number; k: 'ray' | 'flare'; a: Vec; b?: Vec; d?: Vec; tr?: TracerKind; fl?: MuzzleKind; s?: string; pi?: number }
  /** Multi-crew seat requests (`join`/`leave`/`swap` -> host) and authoritative crew roster (`sync` -> all). */
  | { t: 'drvs'; a: 'join' | 'leave' | 'swap'; d: number; s: number; slot?: number }
  | { t: 'drvs'; a: 'sync'; d: number; c: [number, number][] }
  /** 15 Hz gunner turret yaw/pitch from a multi-crew passenger/gunner seat. */
  | { t: 'drvg'; slot?: number; d: number; s: number; ty: number; tp: number }
  /** Guest -> host request to hijack a live enemy vehicle by host vehicle id. */
  | { t: 'vhijack'; vid: number; g?: 1 }
  /** Host -> guest grant after retiring the live enemy vehicle on the host. */
  | { t: 'vhijackok'; kind: HijackClaim['kind']; p: Vec; y: number; v: Vec; hp: number; g?: 1 };

export interface BoardableRemoteVehicle {
  driverSlot: number;
  id: DriveVehicleId;
  seatIndex: number;
  seatName: string;
  crewCount: number;
  seatCount: number;
  position: THREE.Vector3;
  halfHeight: number;
}

const SEND_MS = 66; // ~15 Hz smooth vehicle, jet, and gunner turret sync
const POSE_PER_SECOND = 28;
const FX_PER_SECOND = 32;
const CREW_PER_SECOND = 8;
const HIJACK_PER_SECOND = 4;
const BOARD_REACH = 5.4;
const SLOT_ACCENT = ['#38e8ff', '#ffd166', '#ff6b9d', '#7cff7a'] as const;
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
  /** Remote gunner turret aim (for multi-crew roof gun / cupola / AA Vulcan). */
  gunnerSeat: number;
  gunnerYaw: number;
  gunnerPitch: number;
  smokeTimer: number;
  lastSeenAt: number;
}

interface ActiveLocal {
  vehicle: DriveableVehicle;
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
const rad = (n: number): number => Math.round(n * 1000) / 1000;
const accentForSlot = (slot: number): string => SLOT_ACCENT[((slot % SLOT_ACCENT.length) + SLOT_ACCENT.length) % SLOT_ACCENT.length]!;

export class Driveables implements WorldModule {
  private readonly puppets = new Map<number, DrivePuppet>();
  private readonly lastBySlot = new Map<number, { id: DriveVehicleId; pool?: string; p: number[] }>();
  /** Multi-crew roster per vehicle driver slot: `driverSlot -> Map<seatIndex, playerSlot>`. */
  private readonly crewByDriver = new Map<number, Map<number, number>>();
  private readonly rates = new Map<string, { pose: Rate; fx: Rate; crew: Rate; hijack: Rate }>();
  private readonly poseBuf: number[] = [];
  private materials: ModelMaterials | null = null;
  private local: ActiveLocal | null = null;
  private nextSend = 0;
  private nextGunnerSend = 0;
  private lastFrame = 0;
  private readonly offs: (() => void)[] = [];

  constructor(private readonly w: WorldContext, private readonly enemyVehicles: Vehicles) {
    w.router.both('drv', (v, from, now) => this.onPose(v, from, now));
    w.router.both('drvx', (v, from) => this.onExit(v, from));
    w.router.both('drvf', (v, from, now) => this.onFx(v, from, now));
    w.router.both('drvs', (v, from, now) => this.onCrewEvent(v, from, now));
    w.router.both('drvg', (v, from, now) => this.onGunnerAim(v, from, now));
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
  puppet(slot: number): { id: DriveVehicleId; pool: string | null; position: [number, number, number]; yaw: number; flags: number; crew: [number, number][] } | null {
    const p = this.puppets.get(slot);
    if (!p) return null;
    const crew = [...(this.crewByDriver.get(slot)?.entries() ?? [[0, slot]])] as [number, number][];
    return { id: p.id, pool: p.pool, position: [p.x, p.y, p.z], yaw: p.yaw, flags: p.flags, crew };
  }

  /** Read-only crew snapshot for a driver slot (`[seatIndex, playerSlot][]`, for tests & HUD). */
  crewOf(driverSlot: number): [number, number][] {
    return [...(this.crewByDriver.get(driverSlot)?.entries() ?? [])];
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

  /**
   * Co-op multi-crew: scans nearby teammate vehicles for an open gunner/passenger seat within boarding reach.
   */
  findBoardableRemoteVehicle(pos: THREE.Vector3): BoardableRemoteVehicle | null {
    const mySlot = this.w.session.lobby.me?.slot;
    let best: BoardableRemoteVehicle | null = null;
    let bestDist = Infinity;
    for (const [driverSlot, puppet] of this.puppets) {
      if (driverSlot === mySlot) continue;
      const def = DRIVE_VEHICLES[puppet.id];
      if (def.seats.length <= 1) continue;
      const crew = this.crewByDriver.get(driverSlot);
      // Find the first open seat (prefer passenger/gunner seats 1..N-1, or seat 0 if driver swapped out).
      let openSeat = -1;
      for (let i = 1; i < def.seats.length; i++) {
        if (!crew || !crew.has(i)) { openSeat = i; break; }
      }
      if (openSeat < 0 && crew && !crew.has(0)) openSeat = 0;
      if (openSeat < 0) continue;

      const dx = puppet.x - pos.x;
      const dy = puppet.y - pos.y;
      const dz = puppet.z - pos.z;
      const d = Math.hypot(dx, dy, dz);
      const reach = Math.max(BOARD_REACH, Math.max(def.halfLength, def.halfWidth) + 2.8);
      if (d <= reach && d < bestDist) {
        bestDist = d;
        const crewCount = crew ? crew.size : 1;
        best = {
          driverSlot,
          id: puppet.id,
          seatIndex: openSeat,
          seatName: def.seats[openSeat]!.name,
          crewCount,
          seatCount: def.seats.length,
          position: new THREE.Vector3(puppet.x, puppet.y, puppet.z),
          halfHeight: def.halfHeight,
        };
      }
    }
    return best;
  }

  /** Co-op multi-crew: requests to board an open gunner/passenger seat on `driverSlot`'s vehicle. */
  requestCrewSeat(driverSlot: number, seatIndex: number): void {
    const me = this.w.session.lobby.me;
    if (!this.w.ready || !me || driverSlot === me.slot) return;
    if (this.w.hosting) {
      this.hostHandleCrewRequest(me.slot, me.id, { t: 'drvs', a: 'join', d: driverSlot, s: seatIndex }, performance.now());
    } else {
      this.w.send({ t: 'drvs', a: 'join', d: driverSlot, s: seatIndex, slot: me.slot });
    }
  }

  /** Co-op multi-crew: asks the host to move us to `targetSeat` inside `driverSlot`'s vehicle. */
  requestCrewSwap(driverSlot: number, targetSeat: number): void {
    const me = this.w.session.lobby.me;
    if (!this.w.ready || !me) return;
    if (this.w.hosting) {
      this.hostHandleCrewRequest(me.slot, me.id, { t: 'drvs', a: 'swap', d: driverSlot, s: targetSeat }, performance.now());
    } else {
      this.w.send({ t: 'drvs', a: 'swap', d: driverSlot, s: targetSeat, slot: me.slot });
    }
  }

  /** Co-op multi-crew: informs the host we have exited our passenger/gunner seat on `driverSlot`'s vehicle. */
  requestCrewLeave(driverSlot: number): void {
    const me = this.w.session.lobby.me;
    if (!me) return;
    if (this.w.hosting) {
      this.hostHandleCrewRequest(me.slot, me.id, { t: 'drvs', a: 'leave', d: driverSlot, s: 0 }, performance.now());
    } else if (this.w.ready) {
      this.w.send({ t: 'drvs', a: 'leave', d: driverSlot, s: 0, slot: me.slot });
    }
  }

  private rate(from: string) {
    let r = this.rates.get(from);
    if (!r) this.rates.set(from, r = { pose: new Rate(), fx: new Rate(), crew: new Rate(), hijack: new Rate() });
    return r;
  }

  private slotOf(from: string, slot: number | undefined): { slot: number; peerId: string } | null {
    const p = this.w.playerOf(from, slot);
    if (!p || p.id === this.w.session.lobby.you) return null;
    return { slot: p.slot, peerId: p.id };
  }

  private peerBySlot(slot: number) {
    return this.w.session.lobby.players.find(p => p.slot === slot) ?? null;
  }

  update(now: number): void {
    const dt = this.lastFrame === 0 ? 0.016 : clamp((now - this.lastFrame) / 1000, 0, 0.25);
    this.lastFrame = now;

    const mgr = driveablesOf(this.w);
    const active = mgr?.active ?? null;
    const mySlot = this.w.session.lobby.me?.slot;

    // 1. Broadcast local DRIVER's occupied vehicle (or reliable exit when dismounting / destroyed).
    const driving = active && !active.isRemoteDriven ? active : null;
    if (driving) {
      const p = driving.wirePose(this.poseBuf);
      const changedVehicle = !this.local || this.local.vehicle !== driving;
      if (!this.local || changedVehicle) {
        if (this.local && changedVehicle) this.sendExit(this.local);
        this.local = {
          vehicle: driving,
          id: driving.def.id,
          pool: driving.poolSlot,
          lastPos: [p[0]!, p[1]!, p[2]!],
          lastYaw: p[3]!,
        };
        if (mySlot !== undefined) {
          // Ensure host & local driver have seat roster initialized for this vehicle.
          let crew = this.crewByDriver.get(mySlot);
          if (!crew) {
            crew = new Map([[driving.seatIndex, mySlot]]);
            this.crewByDriver.set(mySlot, crew);
          } else {
            // Preserve any existing passengers carried over from a driver-bail promotion!
            for (const [s, ps] of [...crew]) if (ps === mySlot) crew.delete(s);
            crew.set(driving.seatIndex, mySlot);
          }
          driving.onRequestSeatSwap = targetSeat => {
            if ((this.crewByDriver.get(mySlot)?.size ?? 1) <= 1) return true;
            this.requestCrewSwap(mySlot, targetSeat);
            return false;
          };
        }
      } else {
        this.local.lastPos = [p[0]!, p[1]!, p[2]!];
        this.local.lastYaw = p[3]!;
      }

      if (this.w.ready && (changedVehicle || now >= this.nextSend)) {
        this.nextSend = now + SEND_MS;
        const copy = p.slice();
        if (mySlot !== undefined) {
          this.lastBySlot.set(mySlot, { id: driving.def.id, ...(driving.poolSlot ? { pool: driving.poolSlot } : {}), p: copy });
        }
        this.w.send({
          t: 'drv',
          slot: mySlot,
          id: driving.def.id,
          ...(driving.poolSlot ? { pool: driving.poolSlot } : {}),
          p: copy,
        });
      }
    } else if (this.local) {
      const prev = this.local;
      this.local = null;
      this.sendExit(prev);
    }

    // 2. Smoothly animate all remote teammate vehicle puppets every frame.
    const remoteRidden = mgr?.remoteRidden ?? null;
    for (const [slot, puppet] of this.puppets) {
      // Auto-retire stale puppets if a peer silently vanished without sending `drvx`.
      if (now - puppet.lastSeenAt > 4500) {
        const pool = puppet.pool ?? undefined;
        this.handleDriverGone(slot, false);
        if (this.w.hosting) {
          this.lastBySlot.delete(slot);
          this.hostHandleDriverExit(slot, false, pool);
        }
        continue;
      }
      const hiddenByLocalRide = remoteRidden !== null && remoteRidden.remoteDriverSlot === slot;
      this.stepPuppet(puppet, dt, hiddenByLocalRide);

      // Feed smoothly interpolated hull pose directly into our local passenger-ridden `DriveableVehicle`!
      if (hiddenByLocalRide && remoteRidden) {
        remoteRidden.applyRemoteHullPose(
          puppet.x,
          puppet.y,
          puppet.z,
          puppet.yaw,
          puppet.pitch,
          puppet.roll,
          puppet.steer,
          puppet.wheelSpin,
          puppet.rotorAngle,
          puppet.wingSweep,
          puppet.flags,
          dt,
          puppet.turretYaw,
          puppet.turretPitch,
        );
      }
    }

    // 3. If we are riding as a multi-crew passenger/gunner, broadcast our turret aim (`drvg`) at 15 Hz!
    if (remoteRidden && this.w.ready && mySlot !== undefined && now >= this.nextGunnerSend) {
      this.nextGunnerSend = now + SEND_MS;
      const aim = remoteRidden.localTurretAim;
      this.w.send({
        t: 'drvg',
        slot: mySlot,
        d: remoteRidden.remoteDriverSlot,
        s: aim.seat,
        ty: rad(aim.yaw),
        tp: rad(aim.pitch),
      });
    }
  }

  private sendExit(prev: ActiveLocal): void {
    const slot = this.w.session.lobby.me?.slot;
    const dead = !prev.vehicle.alive;
    if (slot !== undefined) {
      this.lastBySlot.delete(slot);
    }
    if (this.w.ready) {
      this.w.send({
        t: 'drvx',
        slot,
        ...(prev.pool ? { pool: prev.pool } : {}),
        p: prev.lastPos,
        y: prev.lastYaw,
        ...(dead ? { dead: 1 as const } : {}),
      });
    }
    if (slot !== undefined) {
      if (this.w.hosting) {
        this.hostHandleDriverExit(slot, dead, prev.pool ?? undefined);
      } else {
        this.crewByDriver.delete(slot);
      }
    }
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
      if (!this.crewByDriver.has(who.slot)) {
        this.crewByDriver.set(who.slot, new Map([[0, who.slot]]));
      }
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
        gunnerSeat: -1,
        gunnerYaw: 0,
        gunnerPitch: 0,
        smokeTimer: 0,
        lastSeenAt: now,
      };
      this.puppets.set(slot, puppet);
      if (!this.crewByDriver.has(slot)) {
        this.crewByDriver.set(slot, new Map([[0, slot]]));
      }
      this.syncPuppetRiders(puppet);

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

  private syncPuppetRiders(puppet: DrivePuppet): void {
    const crew = this.crewByDriver.get(puppet.slot);
    for (const r of puppet.rig.riders) {
      const occupantSlot = crew ? crew.get(r.seatIndex) : (r.seatIndex === 0 ? puppet.slot : undefined);
      if (occupantSlot !== undefined) {
        r.root.visible = true;
        setRiderAccent(r, accentForSlot(occupantSlot));
      } else {
        r.root.visible = false;
      }
    }
  }

  private onExit(value: Extract<DriveablesEvent, { t: 'drvx' }>, from: string): void {
    const who = this.slotOf(from, value.slot);
    if (!who) return;
    const pool = typeof value.pool === 'string' && value.pool.length <= 48 ? value.pool : undefined;
    const pos = validVec(value.p) ? value.p : undefined;
    const yaw = typeof value.y === 'number' && Number.isFinite(value.y) ? value.y : undefined;
    const dead = value.dead === 1;

    if (this.w.hosting) {
      this.lastBySlot.delete(who.slot);
      this.w.relay({
        t: 'drvx',
        slot: who.slot,
        ...(pool ? { pool } : {}),
        ...(pos ? { p: pos } : {}),
        ...(yaw !== undefined ? { y: yaw } : {}),
        ...(dead ? { dead: 1 as const } : {}),
      }, from);
    }

    this.handleDriverGone(who.slot, dead, pos, yaw, pool);

    if (this.w.hosting) {
      this.hostHandleDriverExit(who.slot, dead, pool);
    }
  }

  /**
   * Host: updates authoritative crew tables when a driver exits (`drvx`) or disconnects (`lostSeat`).
   * If intact with passengers aboard, migrates remaining crew onto the lowest-seat passenger so they take over!
   */
  private hostHandleDriverExit(driverSlot: number, dead: boolean, _pool?: string): void {
    const crew = this.crewByDriver.get(driverSlot);
    if (!crew) return;
    const passengers = [...crew.entries()]
      .filter(([, pSlot]) => pSlot !== driverSlot)
      .sort((a, b) => a[0] - b[0]);

    if (dead || passengers.length === 0) {
      this.crewByDriver.delete(driverSlot);
      return;
    }

    // Promote the lowest-seat passenger to own the hull!
    const promotedSlot = passengers[0]![1];
    const nextCrew = new Map<number, number>();
    nextCrew.set(0, promotedSlot);
    for (let i = 1; i < passengers.length; i++) {
      nextCrew.set(passengers[i]![0], passengers[i]![1]);
    }
    this.crewByDriver.delete(driverSlot);
    this.crewByDriver.set(promotedSlot, nextCrew);

    const entries = [...nextCrew.entries()] as [number, number][];
    this.w.send({ t: 'drvs', a: 'sync', d: promotedSlot, c: entries });
  }

  /** Local cleanup + seamless passenger promotion or ejection when `driverSlot`'s hull ends. */
  private handleDriverGone(driverSlot: number, dead: boolean, pos?: Vec, yaw?: number, overridePool?: string): void {
    const mySlot = this.w.session.lobby.me?.slot;
    const mgr = driveablesOf(this.w);
    const crew = this.crewByDriver.get(driverSlot);
    const passengers = crew
      ? [...crew.entries()].filter(([, pSlot]) => pSlot !== driverSlot).sort((a, b) => a[0] - b[0])
      : [];

    const hasPromotion = !dead && passengers.length > 0;
    const promotedSlot = hasPromotion ? passengers[0]![1] : -1;

    // Handle local passenger riding this vehicle!
    const riding = mgr?.remoteRidden;
    if (riding && riding.remoteDriverSlot === driverSlot) {
      if (hasPromotion && mySlot === promotedSlot) {
        // We are the newly promoted driver! Keep the vehicle seamlessly and take seat 0!
        riding.promoteToDriver(true);
      } else if (hasPromotion && promotedSlot >= 0) {
        // Another teammate was promoted (e.g. 3-seat Bastion): re-parent our ride to them!
        riding.remoteDriverSlot = promotedSlot;
      } else {
        // Vehicle exploded or no promotion: safely eject passenger!
        mgr?.ejectRemoteVehicle(driverSlot, false);
      }
    }

    // Clear `inVehicle` for any remote passengers when no promotion keeps them seated.
    if (!hasPromotion && crew) {
      for (const [, pSlot] of crew) {
        if (pSlot === driverSlot || pSlot === mySlot) continue;
        const peer = this.peerBySlot(pSlot);
        const remote = peer ? this.w.session.remotes.get(peer.id) : undefined;
        if (remote) remote.inVehicle = false;
      }
    }

    if (!this.w.hosting) {
      this.crewByDriver.delete(driverSlot);
      if (hasPromotion && promotedSlot >= 0) {
        const nextCrew = new Map<number, number>([[0, promotedSlot]]);
        for (let i = 1; i < passengers.length; i++) nextCrew.set(passengers[i]![0], passengers[i]![1]);
        this.crewByDriver.set(promotedSlot, nextCrew);
      }
    }

    // Drop the old driver's puppet (keep Badlands Motor Pool claimed if a passenger took over driving!).
    this.dropPuppet(driverSlot, !hasPromotion, pos, yaw, overridePool);
  }

  // ---- Multi-crew seat sync (`drvs`) & gunner turret aim (`drvg`) ----

  private onCrewEvent(value: Extract<DriveablesEvent, { t: 'drvs' }>, from: string, now: number): void {
    if (value.a === 'sync') {
      if (this.w.hosting) return;
      if (!Number.isInteger(value.d) || value.d < 0 || value.d > 3 || !Array.isArray(value.c)) return;
      const entries: [number, number][] = [];
      for (const pair of value.c.slice(0, 4)) {
        if (Array.isArray(pair) && pair.length === 2 && Number.isInteger(pair[0]) && Number.isInteger(pair[1])) {
          entries.push([pair[0]!, pair[1]!]);
        }
      }
      this.applyCrewSync(value.d, entries);
      return;
    }

    if (!this.w.hosting) return;
    if (!this.rate(from).crew.take(now, CREW_PER_SECOND)) return;
    const who = this.slotOf(from, value.slot);
    if (!who) return;
    this.hostHandleCrewRequest(who.slot, who.peerId, value, now);
  }

  private hostHandleCrewRequest(
    reqSlot: number,
    reqPeerId: string,
    value: Extract<DriveablesEvent, { t: 'drvs'; a: 'join' | 'leave' | 'swap' }>,
    now: number,
  ): void {
    const d = value.d;
    if (!Number.isInteger(d) || d < 0 || d > 3) return;
    const snap = this.lastBySlot.get(d);
    const localSnap = d === this.w.session.lobby.me?.slot ? this.local : null;
    const vehicleId = snap?.id ?? localSnap?.id;
    if (!vehicleId) return;
    const def = DRIVE_VEHICLES[vehicleId];
    if (def.seats.length <= 1) return;

    let crew = this.crewByDriver.get(d);
    if (!crew) {
      crew = new Map([[0, d]]);
      this.crewByDriver.set(d, crew);
    }

    if (value.a === 'join') {
      if (reqSlot === d) return;
      // Remove requester from any other vehicle's crew first.
      for (const [otherDriver, otherCrew] of this.crewByDriver) {
        if (otherDriver === d) continue;
        let removed = false;
        for (const [s, ps] of [...otherCrew]) {
          if (ps === reqSlot) { otherCrew.delete(s); removed = true; }
        }
        if (removed) {
          const otherEntries = [...otherCrew.entries()] as [number, number][];
          this.w.send({ t: 'drvs', a: 'sync', d: otherDriver, c: otherEntries });
          this.applyCrewSync(otherDriver, otherEntries);
        }
      }

      // Already seated on this vehicle? Ignore duplicate join.
      for (const ps of crew.values()) if (ps === reqSlot) return;

      let seat = Number.isInteger(value.s) && value.s >= 0 && value.s < def.seats.length ? value.s : 1;
      if (crew.has(seat)) {
        seat = -1;
        for (let i = 1; i < def.seats.length; i++) {
          if (!crew.has(i)) { seat = i; break; }
        }
        if (seat < 0 && !crew.has(0)) seat = 0;
      }
      if (seat < 0) return;

      crew.set(seat, reqSlot);
      if (reqPeerId !== this.w.session.lobby.you) {
        this.w.validator.callIn(reqPeerId, now);
      }
    } else if (value.a === 'swap') {
      let curSeat = -1;
      for (const [s, ps] of crew) if (ps === reqSlot) { curSeat = s; break; }
      if (curSeat < 0) return;
      const target = Number.isInteger(value.s) ? value.s : -1;
      if (target < 0 || target >= def.seats.length || target === curSeat || crew.has(target)) return;
      crew.delete(curSeat);
      crew.set(target, reqSlot);
      if (reqPeerId !== this.w.session.lobby.you) {
        this.w.validator.callIn(reqPeerId, now);
      }
    } else if (value.a === 'leave') {
      if (reqSlot === d) return;
      let removed = false;
      for (const [s, ps] of [...crew]) {
        if (ps === reqSlot) { crew.delete(s); removed = true; }
      }
      if (!removed) return;
    }

    const entries = [...crew.entries()] as [number, number][];
    this.w.send({ t: 'drvs', a: 'sync', d, c: entries });
    this.applyCrewSync(d, entries);
  }

  private applyCrewSync(driverSlot: number, entries: [number, number][]): void {
    const prevCrew = this.crewByDriver.get(driverSlot);
    const nextCrew = new Map<number, number>(entries);
    this.crewByDriver.set(driverSlot, nextCrew);

    const mySlot = this.w.session.lobby.me?.slot;
    const mgr = driveablesOf(this.w);

    // Clear `inVehicle` for any teammate who just left this crew (and isn't driving their own vehicle).
    if (prevCrew) {
      for (const [, oldSlot] of prevCrew) {
        if (oldSlot === mySlot) continue;
        let stillIn = false;
        for (const ps of nextCrew.values()) if (ps === oldSlot) { stillIn = true; break; }
        if (!stillIn && !this.puppets.has(oldSlot)) {
          const peer = this.peerBySlot(oldSlot);
          const remote = peer ? this.w.session.remotes.get(peer.id) : undefined;
          if (remote) remote.inVehicle = false;
        }
      }
    }

    // Mark every current remote crew member as `inVehicle = true`.
    for (const [, pSlot] of nextCrew) {
      if (pSlot === mySlot) continue;
      const peer = this.peerBySlot(pSlot);
      const remote = peer ? this.w.session.remotes.get(peer.id) : undefined;
      if (remote) remote.inVehicle = true;
    }

    // Find my seat inside this vehicle (if any).
    let mySeat = -1;
    if (mySlot !== undefined) {
      for (const [s, ps] of nextCrew) if (ps === mySlot) { mySeat = s; break; }
    }

    // Build crew rider entries for `DriveableVehicle.setCrewOccupants`.
    const riderEntries: [number, string, string | undefined][] = [];
    for (const [s, ps] of nextCrew) {
      if (ps === mySlot) continue;
      const peer = this.peerBySlot(ps);
      riderEntries.push([s, peer?.id ?? `slot:${ps}`, accentForSlot(ps)]);
    }

    // Case A: Local player is the DRIVER of this vehicle!
    if (mySlot !== undefined && driverSlot === mySlot) {
      const active = mgr?.active;
      if (active && !active.isRemoteDriven) {
        active.setCrewOccupants(riderEntries);
        if (mySeat >= 0 && active.seatIndex !== mySeat) {
          active.switchSeat(mySeat, true);
        }
      }
      return;
    }

    const puppet = this.puppets.get(driverSlot);

    // Case B: Local player is a PASSENGER / GUNNER in `driverSlot`'s vehicle!
    if (mySeat >= 0) {
      const riding = mgr?.remoteRidden;
      if (riding && riding.remoteDriverSlot === driverSlot) {
        if (riding.seatIndex !== mySeat) riding.switchSeat(mySeat, true);
        riding.setCrewOccupants(riderEntries);
      } else if (puppet && mgr) {
        const boarded = mgr.boardRemoteVehicle(
          driverSlot,
          puppet.id,
          puppet.pool,
          mySeat,
          _a.set(puppet.x, puppet.y, puppet.z),
          puppet.yaw,
          () => this.requestCrewLeave(driverSlot),
          targetSeat => { this.requestCrewSwap(driverSlot, targetSeat); return false; },
        );
        if (boarded) {
          boarded.setCrewOccupants(riderEntries);
          puppet.rig.root.visible = false;
        }
      }
    } else {
      // Case C: Local player is NOT in this vehicle — ensure we aren't still riding it, and update puppet riders!
      const riding = mgr?.remoteRidden;
      if (riding && riding.remoteDriverSlot === driverSlot) {
        mgr?.ejectRemoteVehicle(driverSlot, true);
      }
      if (puppet) {
        puppet.rig.root.visible = true;
        this.syncPuppetRiders(puppet);
      }
    }
  }

  private onGunnerAim(value: Extract<DriveablesEvent, { t: 'drvg' }>, from: string, now: number): void {
    const who = this.slotOf(from, value.slot);
    if (!who) return;
    if (!Number.isInteger(value.d) || !Number.isInteger(value.s) || !Number.isFinite(value.ty) || !Number.isFinite(value.tp)) return;

    if (this.w.hosting) {
      if (!this.rate(from).pose.take(now, POSE_PER_SECOND)) return;
      // Keep vehicle-weapon ClaimValidator window fresh while a guest fires from a gunner seat!
      this.w.validator.callIn(from, now);
      this.w.relay({ t: 'drvg', slot: who.slot, d: value.d, s: value.s, ty: value.ty, tp: value.tp }, from);
    }

    // Apply gunner turret aim to local driver's vehicle or to the observed puppet!
    const mySlot = this.w.session.lobby.me?.slot;
    const mgr = driveablesOf(this.w);
    if (mySlot !== undefined && value.d === mySlot) {
      const active = mgr?.active;
      if (active && !active.isRemoteDriven) {
        active.applyRemoteGunnerTurret(value.s, value.ty, value.tp);
      }
      return;
    }

    const riding = mgr?.remoteRidden;
    if (riding && riding.remoteDriverSlot === value.d) {
      riding.applyRemoteGunnerTurret(value.s, value.ty, value.tp);
    }

    const puppet = this.puppets.get(value.d);
    if (puppet) {
      puppet.gunnerSeat = value.s;
      puppet.gunnerYaw = value.ty;
      puppet.gunnerPitch = value.tp;
    }
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

  private stepPuppet(p: DrivePuppet, dt: number, hiddenByLocalRide: boolean): void {
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
    rig.root.visible = !hiddenByLocalRide;
    rig.root.position.set(p.x, p.y, p.z);
    rig.root.rotation.set(0, p.yaw, 0);
    rig.body.position.y = rig.bodyBaseY ?? 0;
    rig.body.rotation.set(p.pitch, 0, p.roll);

    const gunnerSpec = p.gunnerSeat >= 1 ? def.seats[p.gunnerSeat] : undefined;
    const gunnerMain = Boolean(gunnerSpec?.usesTurret && !def.seats[0]?.usesTurret);
    const mainYaw = gunnerMain ? p.gunnerYaw : p.turretYaw;
    const mainPitch = gunnerMain ? p.gunnerPitch : p.turretPitch;
    if (rig.turret) rig.turret.rotation.y = mainYaw;
    if (rig.barrel) rig.barrel.rotation.x = clamp(-mainPitch, -0.55, 0.38);
    if (rig.subTurret && gunnerSpec?.usesSubTurret) {
      rig.subTurret.rotation.y = p.gunnerYaw - (rig.turret && p.id === 'aegis' ? mainYaw : 0);
    }

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

    // Float ALL crew callsign tags cleanly stacked above the vehicle roof/canopy!
    const crew = this.crewByDriver.get(p.slot);
    const mySlot = this.w.session.lobby.me?.slot;
    const baseY = p.y + def.halfHeight * 2 + 1.4;
    if (crew && crew.size > 0) {
      let rank = 0;
      for (const [, memberSlot] of crew) {
        if (memberSlot === mySlot) continue;
        const peer = this.peerBySlot(memberSlot);
        const remote = peer ? this.w.session.remotes.get(peer.id) : undefined;
        if (remote) {
          remote.inVehicle = true;
          remote.tag.set(p.x, baseY + rank * 0.65, p.z);
          rank++;
        }
      }
    } else {
      const remote = this.w.session.remotes.get(p.peerId);
      if (remote) {
        remote.inVehicle = true;
        remote.tag.set(p.x, baseY, p.z);
      }
    }

    // Damaged smoke plume on low-HP teammate vehicles (skip duplicate smoke when we're riding inside).
    if (!hiddenByLocalRide && (p.flags & 32)) {
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

  /** Host: sends every currently occupied player vehicle and multi-crew seat roster to an arriving guest. */
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
      const crew = this.crewByDriver.get(slot);
      if (crew && crew.size > 1) {
        this.w.send({ t: 'drvs', a: 'sync', d: slot, c: [...crew.entries()] as [number, number][] }, id);
      }
    }
  }

  /** Guest: re-announces our occupied vehicle (or crew seat) after reconnect. */
  resay(): void {
    if (this.w.hosting || !this.w.ready) return;
    const mgr = driveablesOf(this.w);
    const active = mgr?.active;
    if (!active) return;
    const slot = this.w.session.lobby.me?.slot;
    if (active.isRemoteDriven) {
      this.w.send({ t: 'drvs', a: 'join', d: active.remoteDriverSlot, s: active.seatIndex, slot });
      return;
    }
    const p = active.wirePose(this.poseBuf).slice();
    this.w.send({
      t: 'drv',
      slot,
      id: active.def.id,
      ...(active.poolSlot ? { pool: active.poolSlot } : {}),
      p,
    });
  }

  /** Host & guests: cleans up when a player disconnects (removing them from any crew seat or handing off their vehicle). */
  lostSeat(_id: string, slot: number): void {
    // 1. If they were a passenger/gunner in someone else's vehicle, vacate their seat!
    for (const [driverSlot, crew] of this.crewByDriver) {
      if (driverSlot === slot) continue;
      let removed = false;
      for (const [s, ps] of [...crew]) {
        if (ps === slot) { crew.delete(s); removed = true; }
      }
      if (removed) {
        const entries = [...crew.entries()] as [number, number][];
        if (this.w.hosting) this.w.send({ t: 'drvs', a: 'sync', d: driverSlot, c: entries });
        this.applyCrewSync(driverSlot, entries);
      }
    }

    // 2. If they were driving a vehicle, hand off or release it cleanly!
    const snap = this.lastBySlot.get(slot);
    this.lastBySlot.delete(slot);
    if (this.w.hosting && snap) {
      this.w.send({ t: 'drvx', slot, ...(snap.pool ? { pool: snap.pool } : {}) });
    }
    this.handleDriverGone(slot, false, undefined, undefined, snap?.pool);
    if (this.w.hosting) {
      this.hostHandleDriverExit(slot, false, snap?.pool);
    }
  }

  forgetPeer(id: string): void {
    this.rates.delete(id);
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    const mgr = driveablesOf(this.w);
    if (mgr?.remoteRidden) {
      mgr.ejectRemoteVehicle(mgr.remoteRidden.remoteDriverSlot, true);
    }
    for (const slot of [...this.puppets.keys()]) this.dropPuppet(slot, true);
    this.puppets.clear();
    this.crewByDriver.clear();
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
  drvs: 'fact',
  drvg: 'latest',
  vhijack: 'fact',
  vhijackok: 'fact',
};
