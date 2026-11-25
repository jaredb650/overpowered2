/**
 * Manages all player-driveable vehicles on the map, world boarding prompts, live enemy vehicle
 * hijacking (both on-foot `[E]` / `[HOLD E]` on tanks AND mid-air Gaff harpoon grapple-hijacking),
 * Badlands 10-vehicle Motor Pool & Airbase Apron staging, Test Range showcase vehicles, and `?vehicle=`.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { ON_RANGE } from '../../core/devflags';
import type { HijackClaim, HijackableVehicle } from '../../core/gameplay';
import { ACTIVE } from '../../contracts/select';
import type { ModelMaterials } from '../../progression/modelkit';
import type { SeatRig } from '../seat';
import { CARRIER_CATAPULT_PAD, CARRIER_CATAPULT_YAW } from '../../world/map/dogfight/plan';
import {
  BADLANDS_AIRCRAFT_PAD,
  BADLANDS_SPAWN_YAW,
  BADLANDS_VEHICLE_PAD,
} from '../../world/map/badlands/plan';
import {
  ENDLESS_WAR_AIRCRAFT_PAD,
  ENDLESS_WAR_NORTH_YAW,
  ENDLESS_WAR_VEHICLE_PAD,
} from '../../world/map/endlessWar/plan';
import { DRIVE_VEHICLES, VEHICLE_ASKED } from './data';
import { HIJACK_MAP, type DriveVehicleId } from './types';
import { DriveableVehicle } from './vehicle';
import { mountOfVehicle } from '../../enemies/aiWorld';

import type { MuzzleKind, TracerKind } from '../../core/contracts';

declare module '../../core/contracts' {
  interface GameEvents {
    /** Dogfight flight deck hangar terminal spawns or swaps the player's catapult aircraft. */
    'dogfight:spawn_jet': { id: DriveVehicleId; board?: boolean };
    /** Dogfight deck crew emergency repair heals any parked/active player aircraft. */
    'dogfight:repair_player_jet': { amount: number };
    /** Dogfight enemy radar/IR lock & incoming Fox-2 missile state forwarded to the cockpit RWR. */
    'dogfight:rwr': { locking: boolean; lockStrength: number; missileInbound: boolean; label?: string };
    /** Emitted whenever a player aircraft deploys IR flares / smoke countermeasures. */
    'dogfight:player_flares': { position: THREE.Vector3 };
    /** Enemy air-to-air gunfire / Fox-2 missile hit applied directly to the player's active aircraft hull. */
    'dogfight:damage_player_jet': { amount: number; from: THREE.Vector3; heavy?: boolean };
    /** Player-driven vehicle hitscan gunfire / lance / flare visual FX for co-op teammates. */
    'vehicle:fx': {
      kind: 'ray' | 'flare';
      from: THREE.Vector3;
      to?: THREE.Vector3;
      dir?: THREE.Vector3;
      tracer?: TracerKind;
      flash?: MuzzleKind;
      sound?: string;
      pitch?: number;
    };
  }
}

/** Badlands 13-vehicle Motor Pool & Airbase Apron (West ground/bikes crescent + East armor/airfield apron, zero overlap). */
export interface MotorPoolSlot {
  readonly slot: string;
  readonly id: DriveVehicleId;
  readonly at: readonly [number, number, number];
  readonly yaw: number;
}

export const BADLANDS_MOTOR_POOL: readonly MotorPoolSlot[] = [
  // West Light & Armored Crescent
  { slot: 'pool.viper',    id: 'viper',    at: [-3.0, 0, 6.4],    yaw: -2.68 },
  { slot: 'pool.moto',     id: 'moto',     at: [-9.2, 0, 2.0],    yaw: -2.55 },
  { slot: 'pool.quad',     id: 'quad',     at: [-12.8, 0, -2.5],  yaw: -2.48 },
  { slot: 'pool.jackal',   id: 'jackal',   at: [-15.2, 0, -7.8],  yaw: -2.42 },
  { slot: 'pool.aegis',    id: 'aegis',    at: [-19.5, 0, -15.5], yaw: -2.25 },
  // East Heavy Guntruck, Rotorcraft & Fighter/Bomber Airfield Apron
  { slot: 'pool.kestrel',  id: 'kestrel',  at: [14.5, 0, 3.2],    yaw: 2.68 },
  { slot: 'pool.bastion',  id: 'bastion',  at: [11.8, 0, -9.2],   yaw: 2.48 },
  { slot: 'pool.valkyrie', id: 'valkyrie', at: [22.8, 0, -4.5],   yaw: 2.55 },
  { slot: 'pool.harrier',  id: 'harrier',  at: [19.0, 0, -20.5],  yaw: 2.35 },
  { slot: 'pool.warthog',  id: 'warthog',  at: [4.5, 0, -25.0],   yaw: 2.85 },
  { slot: 'pool.raptor',   id: 'raptor',   at: [34.5, 0, -17.5],  yaw: 2.22 },
  { slot: 'pool.hornet',   id: 'hornet',   at: [31.5, 0, -32.0],  yaw: 2.42 },
  { slot: 'pool.lancer',   id: 'lancer',   at: [14.5, 0, -39.5],  yaw: 2.75 },
];

/** Test Range open-apron 13-vehicle showcase lineup. */
const RANGE_MOTOR_POOL: readonly MotorPoolSlot[] = [
  { slot: 'range.viper',    id: 'viper',    at: [-5, 0, -10],   yaw: 0.25 },
  { slot: 'range.moto',     id: 'moto',     at: [-9, 0, -10],   yaw: 0.3 },
  { slot: 'range.quad',     id: 'quad',     at: [-13, 0, -10],  yaw: 0.35 },
  { slot: 'range.jackal',   id: 'jackal',   at: [-18, 0, -12],  yaw: 0.42 },
  { slot: 'range.aegis',    id: 'aegis',    at: [-24, 0, -16],  yaw: 0.5 },
  { slot: 'range.bastion',  id: 'bastion',  at: [11, 0, -11],   yaw: -0.35 },
  { slot: 'range.kestrel',  id: 'kestrel',  at: [18, 0, -8],    yaw: -0.52 },
  { slot: 'range.valkyrie', id: 'valkyrie', at: [26, 0, -14],   yaw: -0.62 },
  { slot: 'range.harrier',  id: 'harrier',  at: [15, 0, -22],   yaw: -0.25 },
  { slot: 'range.warthog',  id: 'warthog',  at: [0, 0, -24],    yaw: 0.05 },
  { slot: 'range.raptor',   id: 'raptor',   at: [-16, 0, -27],  yaw: 0.22 },
  { slot: 'range.hornet',   id: 'hornet',   at: [29, 0, -28],   yaw: -0.35 },
  { slot: 'range.lancer',   id: 'lancer',   at: [8, 0, -39],    yaw: -0.05 },
];

const BOARD_REACH = 5.8;
const HIJACK_REACH = 6.4;
const TANK_HOLD_SECONDS = 0.45;
const HIJACK_BONUS = 200;
const GRAPPLE_HIJACK_BONUS = 300;
const MAX_PLAYER_VEHICLES = 22;
const EXIT_REBOARD_COOLDOWN = 0.24;

const _pos = new THREE.Vector3();

export class DriveableManager {
  readonly vehicles: DriveableVehicle[] = [];
  private hijackHoldId = -1;
  private hijackHoldElapsed = 0;
  private reboardCooldown = 0;
  private unprompt: (() => void) | null = null;
  private promptKey = '';
  private readonly promptPos = new THREE.Vector3();

  constructor(
    private readonly ctx: Ctx,
    private readonly materials: ModelMaterials,
    private readonly seats: SeatRig,
    private readonly holster: () => void,
  ) {
    ctx.events.on('vehicle:grapple_hijack', ({ vehicleId }) => {
      this.performHijack(vehicleId, true);
    });

    ctx.events.on('dogfight:spawn_jet', ({ id, board }) => {
      this.stageCarrierJet(id, Boolean(board));
    });

    ctx.events.on('badlands:spawn_vehicle', ({ id, board }) => {
      this.stageBadlandsVehicle(id, Boolean(board));
    });

    ctx.events.on('badlands:clear_vehicles', () => {
      const removed = this.clearUnoccupied();
      if (removed > 0) {
        ctx.hud?.feed?.(`CLEARED ${removed} UNOCCUPIED VEHICLE${removed > 1 ? 'S' : ''}`, '#38e8ff');
      }
    });

    ctx.events.on('dogfight:repair_player_jet', ({ amount }) => {
      for (const v of this.vehicles) {
        if (!v.alive) continue;
        v.health = Math.min(v.def.maxHealth, v.health + amount);
      }
    });

    ctx.events.on('dogfight:rwr', ({ locking, lockStrength, missileInbound, label }) => {
      this.active?.setExternalRwr(locking, lockStrength, missileInbound, label ?? '');
    });

    ctx.events.on('dogfight:damage_player_jet', ({ amount, from, heavy }) => {
      const kind = heavy === true ? 'heavy' : heavy === false ? 'light' : undefined;
      this.active?.absorbDamage(amount, from, false, kind);
    });

    ctx.events.on('run:start', () => {
      this.clear();
      if (VEHICLE_ASKED) {
        const spawn = ctx.world.playerSpawns[0];
        if (spawn) {
          const v = this.spawn(VEHICLE_ASKED, spawn.position, spawn.yaw);
          v.board(0);
        }
        return;
      }
      if (ACTIVE.def.id === 'dogfight') {
        this.stageCarrierJet('hornet', false);
      } else if (ON_RANGE) {
        this.stagePool(RANGE_MOTOR_POOL);
      }
    });
  }

  /**
   * Badlands sandbox requisition: spawns `id` on the staging pad vehicle bay (ground/hover/rotorcraft)
   * or clear north airstrip threshold (fixed-wing jets), clearing any unoccupied vehicle blocking that
   * pad while preserving vehicles driven out into the basin.
   */
  stageBadlandsVehicle(id: DriveVehicleId, board = false): DriveableVehicle {
    const def = DRIVE_VEHICLES[id];
    const isJet = def.category === 'jet';
    const isWar = ACTIVE.def.id === 'endless_war';
    const base = isWar
      ? (isJet ? ENDLESS_WAR_AIRCRAFT_PAD : ENDLESS_WAR_VEHICLE_PAD)
      : (isJet ? BADLANDS_AIRCRAFT_PAD : BADLANDS_VEHICLE_PAD);
    const spawnYaw = isWar ? ENDLESS_WAR_NORTH_YAW : BADLANDS_SPAWN_YAW;
    const slot = this.ctx.coop?.lobby.me?.slot ?? 0;
    const slotOffsetX = slot === 0 ? 0 : (slot % 2 === 1 ? -1 : 1) * Math.ceil(slot / 2) * (isJet ? 18 : 8);
    const slotOffsetZ = slot >= 2 ? (isJet ? -14 : -8) : 0;

    _pos.set(base[0] + slotOffsetX, base[1], base[2] + slotOffsetZ);
    const gy = this.ctx.world?.nav?.groundHeight?.(_pos.x, _pos.y + 3, _pos.z);
    if (typeof gy === 'number' && Number.isFinite(gy)) _pos.y = gy;

    const clearRadius = isJet ? 22 : 12;
    const clearRadiusSq = clearRadius * clearRadius;
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i]!;
      if (v.occupied) continue;
      const dx = v.position.x - _pos.x;
      const dz = v.position.z - _pos.z;
      if (dx * dx + dz * dz <= clearRadiusSq) {
        v.dispose();
        this.vehicles.splice(i, 1);
      }
    }

    const vehicle = this.spawn(id, _pos, spawnYaw, { poolSlot: null });
    if (board && !this.seats.occupied && this.ctx.player.alive) {
      vehicle.board(0);
      this.ctx.hud?.feed?.(`${def.name} DEPLOYED`, '#38e8ff');
    } else {
      const where = isJet ? (isWar ? 'FOB WEST AIRSTRIP' : 'NORTH AIRSTRIP') : 'VEHICLE PAD';
      this.ctx.hud?.feed?.(`${def.name} STAGED ON ${where}`, '#38e8ff');
    }
    return vehicle;
  }

  /** Number of currently alive, unoccupied player vehicles on the map. */
  get unoccupiedCount(): number {
    let n = 0;
    for (const v of this.vehicles) {
      if (v.alive && !v.occupied) n++;
    }
    return n;
  }

  /** Disposes all unoccupied player vehicles (leaving any currently driven vehicle intact). */
  clearUnoccupied(): number {
    let removed = 0;
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i]!;
      if (!v.occupied) {
        v.dispose();
        this.vehicles.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }

  /** Replaces any unoccupied jet on USS Sovereign's catapult with `id`, optionally boarding immediately. */
  stageCarrierJet(id: DriveVehicleId, board = false): DriveableVehicle {
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i]!;
      if (!v.occupied) {
        v.dispose();
        this.vehicles.splice(i, 1);
      }
    }
    const slot = this.ctx.coop?.lobby.me?.slot ?? 0;
    const dx = slot % 2 === 1 ? -9.3 : 0;
    const dz = slot >= 2 ? 20.0 : (slot === 1 ? 4.0 : 0);
    _pos.set(CARRIER_CATAPULT_PAD[0] + dx, CARRIER_CATAPULT_PAD[1], CARRIER_CATAPULT_PAD[2] + dz);
    const jet = this.spawn(id, _pos, CARRIER_CATAPULT_YAW, { poolSlot: `carrier.catapult.${slot}` });
    if (board && !this.seats.occupied && this.ctx.player.alive) {
      jet.board(0);
    }
    return jet;
  }

  /** Co-op: hides a Badlands/Range Motor Pool vehicle while a teammate drives it on their screen. */
  setRemoteClaim(poolSlot: string, claimed: boolean): void {
    if (!poolSlot || poolSlot.startsWith('carrier.')) return;
    for (const v of this.vehicles) {
      if (v.alive && v.poolSlot === poolSlot && !v.occupied) {
        v.setRemoteHidden(claimed);
      }
    }
  }

  /** Co-op: unhides and repositions a Motor Pool vehicle where a teammate parked/exited it intact. */
  releaseRemoteClaim(poolSlot: string, pos?: THREE.Vector3, yaw?: number): void {
    if (!poolSlot || poolSlot.startsWith('carrier.')) return;
    for (const v of this.vehicles) {
      if (v.alive && v.poolSlot === poolSlot && !v.occupied) {
        if (pos && typeof yaw === 'number' && Number.isFinite(yaw)) {
          v.parkAt(pos, yaw);
        }
        v.setRemoteHidden(false);
      }
    }
  }

  /** Currently occupied player vehicle, or null when on foot or in another seat. */
  get active(): DriveableVehicle | null {
    for (const v of this.vehicles) {
      if (v.alive && v.occupied) return v;
    }
    return null;
  }

  /** Co-op multi-crew: currently occupied vehicle being driven by a remote teammate (`isRemoteDriven`). */
  get remoteRidden(): DriveableVehicle | null {
    const a = this.active;
    return a && a.isRemoteDriven ? a : null;
  }

  /**
   * Co-op multi-crew: mounts the local player into an open gunner/passenger seat on a teammate's live vehicle.
   * The spawned `DriveableVehicle` mirrors the driver's hull pose (`isRemoteDriven = true`) while giving the
   * passenger full local weapon/optic/HUD/hand-weapon control and seamless promotion if the driver bails.
   */
  boardRemoteVehicle(
    driverSlot: number,
    id: DriveVehicleId,
    poolSlot: string | null,
    seatIndex: number,
    position: THREE.Vector3,
    yaw: number,
    onCrewExit: () => void,
    onRequestSeatSwap: (targetSeat: number) => boolean,
  ): DriveableVehicle | null {
    if (!this.ctx.player.alive || this.seats.occupied) return null;
    const v = this.spawn(id, position, yaw, { poolSlot });
    v.remoteDriverSlot = driverSlot;
    v.onRequestSeatSwap = onRequestSeatSwap;
    v.onCrewExit = () => {
      onCrewExit();
      // Remove and dispose the temporary passenger mirror chassis once exited.
      const idx = this.vehicles.indexOf(v);
      if (idx >= 0) this.vehicles.splice(idx, 1);
      v.dispose();
    };
    if (!v.board(seatIndex)) {
      const idx = this.vehicles.indexOf(v);
      if (idx >= 0) this.vehicles.splice(idx, 1);
      v.dispose();
      return null;
    }
    this.clearPrompt();
    const spec = v.activeSeatSpec;
    this.ctx.hud?.feed?.(`BOARDED ${v.def.shortName} · ${spec.name}`, '#38e8ff');
    return v;
  }

  /** Co-op multi-crew: forcefully ejects & disposes a remote-ridden vehicle when the hull explodes. */
  ejectRemoteVehicle(driverSlot: number, quiet = false): void {
    const v = this.vehicles.find(x => x.alive && x.remoteDriverSlot === driverSlot);
    if (!v) return;
    if (v.occupied) {
      v.exit(quiet);
    } else {
      const idx = this.vehicles.indexOf(v);
      if (idx >= 0) this.vehicles.splice(idx, 1);
      v.dispose();
    }
  }

  private stagePool(pool: readonly MotorPoolSlot[]): void {
    for (const s of pool) {
      _pos.set(s.at[0], s.at[1], s.at[2]);
      const gy = this.ctx.world?.nav?.groundHeight?.(_pos.x, _pos.y + 3, _pos.z);
      if (typeof gy === 'number' && Number.isFinite(gy)) _pos.y = gy;
      this.spawn(s.id, _pos, s.yaw, { poolSlot: s.slot });
    }
  }

  /** Spawns a driveable vehicle at `position` facing `yaw`. Enforces cap by retiring oldest unoccupied non-pool vehicle. */
  spawn(
    id: DriveVehicleId,
    position: THREE.Vector3,
    yaw: number,
    opts?: { velocity?: THREE.Vector3; healthFraction?: number; poolSlot?: string | null; exitLocked?: boolean },
  ): DriveableVehicle {
    while (this.vehicles.length >= MAX_PLAYER_VEHICLES) {
      const idx = this.vehicles.findIndex(v => !v.occupied && !v.poolSlot);
      if (idx < 0) break;
      this.vehicles[idx]!.dispose();
      this.vehicles.splice(idx, 1);
    }
    const v = new DriveableVehicle(this.ctx, this.materials, this.seats, this.holster, id, position, yaw, opts);
    this.vehicles.push(v);
    return v;
  }

  /** Executes an enemy vehicle hijack: retires enemy vehicle safely, spawns matching player vehicle, and boards! */
  performHijack(enemyVehicleId: number, viaGrapple: boolean): DriveableVehicle | null {
    if (!this.ctx.player.alive || this.seats.occupied) return null;
    // Co-op guest: ask the host to retire its live enemy vehicle and grant us the hijacked chassis.
    if (this.ctx.coop && !this.ctx.coop.hosting) {
      const world = this.ctx.coop.world as unknown as { requestVehicleHijack?(id: number, viaGrapple: boolean): void } | undefined;
      world?.requestVehicleHijack?.(enemyVehicleId, viaGrapple);
      this.clearPrompt();
      this.hijackHoldId = -1;
      this.hijackHoldElapsed = 0;
      return null;
    }
    const claim = this.ctx.enemies?.vehicles?.hijack?.(enemyVehicleId);
    if (!claim) return null;
    return this.completeHijack(claim.kind, claim.position, claim.yaw, claim.velocity, claim.healthFraction, viaGrapple);
  }

  /** Spawns and boards a hijacked enemy vehicle (used locally on solo/host, and after host grant on co-op guests). */
  completeHijack(
    kind: HijackClaim['kind'],
    position: THREE.Vector3,
    yaw: number,
    velocity: THREE.Vector3,
    healthFraction: number,
    viaGrapple: boolean,
  ): DriveableVehicle | null {
    if (!this.ctx.player.alive || this.seats.occupied) return null;
    const driveId = HIJACK_MAP[kind];
    const vehicle = this.spawn(driveId, position, yaw, {
      velocity,
      healthFraction: Math.max(0.55, healthFraction),
    });

    if (vehicle.board(0, true)) {
      const bonus = viaGrapple ? GRAPPLE_HIJACK_BONUS : HIJACK_BONUS;
      const title = viaGrapple ? 'GRAPPLE HIJACK!' : 'VEHICLE HIJACKED!';
      this.ctx.audio?.play('glass_break', { position, volume: 0.7, pitch: 0.9 });
      this.ctx.audio?.play('metal_clang', { position, volume: 0.9, pitch: 0.85 });
      this.ctx.fx?.sparks?.(position, new THREE.Vector3(0, 1, 0), 22, 0xffd166);
      this.ctx.progression?.award?.(bonus, title, position);
      this.ctx.hud?.feed?.(`${title} — ${DRIVE_VEHICLES[driveId].name} (+${bonus})`, '#ffd166');
      this.ctx.hud?.floatText?.(position, title, '#ffd166');
      this.ctx.camera?.addTrauma?.(0.35);
      this.ctx.events?.emit?.('vehicle:boarded', {
        id: driveId,
        mount: mountOfVehicle(driveId),
        hijacked: true,
        viaGrapple,
        position: position.clone(),
      });
    }
    this.clearPrompt();
    this.hijackHoldId = -1;
    this.hijackHoldElapsed = 0;
    return vehicle;
  }

  private setPrompt(pos: THREE.Vector3, yOffset: number, label: string, color: string): void {
    this.promptPos.set(pos.x, pos.y + yOffset, pos.z);
    const key = `${label}|${color}`;
    if (this.promptKey === key && this.unprompt) return;
    this.clearPrompt();
    this.promptKey = key;
    this.unprompt = this.ctx.hud?.follow?.(this.promptPos, label, color) ?? null;
  }

  private clearPrompt(): void {
    if (this.unprompt) {
      this.unprompt();
      this.unprompt = null;
    }
    this.promptKey = '';
  }

  /** Ticks all live vehicles and evaluates on-foot boarding & enemy hijacking prompts. */
  update(dt: number, canInteract: boolean): void {
    if (this.reboardCooldown > 0) this.reboardCooldown = Math.max(0, this.reboardCooldown - dt);
    const wasOccupied = this.seats.occupied;

    // Prune dead vehicles and tick live vehicles.
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i]!;
      if (!v.alive) {
        this.vehicles.splice(i, 1);
        continue;
      }
      v.update(dt);
    }

    // CRITICAL FIX: If the player JUST exited a vehicle on this tick, arm a brief re-board cooldown
    // and return immediately so the same `[E]` press NEVER re-boards the vehicle on the exact same frame!
    if (wasOccupied && !this.seats.occupied) {
      this.reboardCooldown = EXIT_REBOARD_COOLDOWN;
      this.clearPrompt();
      this.hijackHoldId = -1;
      this.hijackHoldElapsed = 0;
      return;
    }

    if (!canInteract || this.seats.occupied || this.reboardCooldown > 0 || !this.ctx.player.alive) {
      this.clearPrompt();
      this.hijackHoldId = -1;
      this.hijackHoldElapsed = 0;
      return;
    }

    const { hud, input, player } = this.ctx;
    const key = input.labelFor?.('interact') ?? 'E';

    // 1. Check for nearby live enemy vehicle to HIJACK! (On co-op guests, scan replicated enemy vehicle puppets.)
    let hijackTarget: HijackableVehicle | null = null;
    if (this.ctx.coop && !this.ctx.coop.hosting) {
      const world = this.ctx.coop.world as unknown as { findGuestHijackable?(pos: THREE.Vector3, reach: number): HijackableVehicle | null } | undefined;
      hijackTarget = world?.findGuestHijackable?.(player.position, HIJACK_REACH) ?? null;
    } else {
      hijackTarget = this.ctx.enemies?.vehicles?.findHijackable?.(player.position, HIJACK_REACH) ?? null;
    }
    if (hijackTarget) {
      if (hijackTarget.armored) {
        if (input.isDown('interact')) {
          if (this.hijackHoldId !== hijackTarget.id) {
            this.hijackHoldId = hijackTarget.id;
            this.hijackHoldElapsed = 0;
            this.ctx.audio?.play('metal_groan', { position: hijackTarget.position, volume: 0.7, pitch: 0.9 });
          }
          this.hijackHoldElapsed += dt;
          const fill = Math.min(1, this.hijackHoldElapsed / TANK_HOLD_SECONDS);
          hud.hold?.(fill);
          this.setPrompt(hijackTarget.position, 2.8, `HIJACKING ${hijackTarget.label}`, '#ffd166');
          if (this.hijackHoldElapsed >= TANK_HOLD_SECONDS) {
            this.performHijack(hijackTarget.id, false);
          }
          return;
        }
        this.hijackHoldId = -1;
        this.hijackHoldElapsed = 0;
        this.setPrompt(hijackTarget.position, 2.8, `HOLD ${key} HIJACK ${hijackTarget.label}`, '#ffd166');
        return;
      }

      this.setPrompt(hijackTarget.position, 2.5, `${key} HIJACK ${hijackTarget.label}`, '#ffd166');
      if (input.pressed('interact')) {
        this.performHijack(hijackTarget.id, false);
      }
      return;
    }

    this.hijackHoldId = -1;
    this.hijackHoldElapsed = 0;

    // 1.5. Co-op multi-crew: check for a nearby teammate's vehicle with an open gunner/passenger seat!
    if (this.ctx.coop?.world) {
      const world = this.ctx.coop.world as unknown as {
        findBoardableRemoteVehicle?(pos: THREE.Vector3): {
          driverSlot: number;
          id: DriveVehicleId;
          seatIndex: number;
          seatName: string;
          crewCount: number;
          seatCount: number;
          position: THREE.Vector3;
          halfHeight: number;
        } | null;
        requestCrewSeat?(driverSlot: number, seatIndex: number): void;
      };
      const crewTarget = world.findBoardableRemoteVehicle?.(player.position) ?? null;
      if (crewTarget) {
        const def = DRIVE_VEHICLES[crewTarget.id];
        this.setPrompt(
          crewTarget.position,
          crewTarget.halfHeight * 2 + 1.3,
          `${key} BOARD ${def.shortName} · ${crewTarget.seatName} (${crewTarget.crewCount}/${crewTarget.seatCount})`,
          '#38e8ff',
        );
        if (input.pressed('interact')) {
          this.clearPrompt();
          world.requestCrewSeat?.(crewTarget.driverSlot, crewTarget.seatIndex);
        }
        return;
      }
    }

    // 2. Check for nearest parked friendly/player driveable vehicle to board!
    let best: DriveableVehicle | null = null;
    let bestDist = Infinity;
    for (const v of this.vehicles) {
      if (!v.alive || v.occupied || v.remoteHidden) continue;
      const d = v.position.distanceTo(player.position);
      const reach = Math.max(BOARD_REACH, Math.max(v.def.halfLength, v.def.halfWidth) + 2.6);
      if (d <= reach && d < bestDist) {
        bestDist = d;
        best = v;
      }
    }
    if (best) {
      const cat = best.def.category;
      const verb = cat === 'helicopter' || cat === 'jet' ? 'FLY' : cat === 'hover' || cat === 'moto' ? 'RIDE' : 'DRIVE';
      this.setPrompt(best.position, best.def.halfHeight * 2 + 1.1, `${key} ${verb} ${best.def.name}`, best.def.color);
      if (input.pressed('interact')) {
        this.clearPrompt();
        best.board(0);
      }
    } else {
      this.clearPrompt();
    }
  }

  clear(): void {
    this.clearPrompt();
    for (const v of this.vehicles) v.dispose();
    this.vehicles.length = 0;
    this.hijackHoldId = -1;
    this.hijackHoldElapsed = 0;
    this.reboardCooldown = 0;
  }

  describe(): Record<string, unknown> {
    return {
      count: this.vehicles.length,
      active: this.active ? { id: this.active.def.id, seat: this.active.seatIndex, speedKmh: Math.round(this.active.speed * 3.6) } : null,
      vehicles: this.vehicles.map(v => ({
        id: v.def.id,
        hp: Math.round(v.health),
        occupied: v.occupied,
        x: Math.round(v.position.x),
        y: Math.round(v.position.y),
        z: Math.round(v.position.z),
      })),
    };
  }
}
