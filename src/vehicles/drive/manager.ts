/**
 * Manages all player-driveable vehicles on the map, world boarding prompts, live enemy vehicle
 * hijacking (both on-foot `[E]` / `[HOLD E]` on tanks AND mid-air Gaff harpoon grapple-hijacking),
 * Badlands 10-vehicle Motor Pool & Airbase Apron staging, Test Range showcase vehicles, and `?vehicle=`.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { ON_RANGE } from '../../core/devflags';
import type { HijackableVehicle } from '../../core/gameplay';
import { ACTIVE } from '../../contracts/select';
import type { ModelMaterials } from '../../progression/modelkit';
import type { SeatRig } from '../seat';
import { DRIVE_VEHICLES, VEHICLE_ASKED } from './data';
import { HIJACK_MAP, type DriveVehicleId } from './types';
import { DriveableVehicle } from './vehicle';

/** Badlands 10-vehicle Motor Pool & Airbase Apron (West ground/bikes crescent + East armor/airfield apron, zero overlap). */
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
  // East Heavy Guntruck, Rotorcraft & VTOL/Attack Jet Apron
  { slot: 'pool.kestrel',  id: 'kestrel',  at: [14.5, 0, 3.2],    yaw: 2.68 },
  { slot: 'pool.bastion',  id: 'bastion',  at: [11.8, 0, -9.2],   yaw: 2.48 },
  { slot: 'pool.valkyrie', id: 'valkyrie', at: [22.8, 0, -4.5],   yaw: 2.55 },
  { slot: 'pool.harrier',  id: 'harrier',  at: [19.0, 0, -20.5],  yaw: 2.35 },
  { slot: 'pool.warthog',  id: 'warthog',  at: [4.5, 0, -25.0],   yaw: 2.85 },
];

/** Test Range open-apron 10-vehicle showcase lineup. */
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
];

const BOARD_REACH = 5.8;
const HIJACK_REACH = 6.4;
const TANK_HOLD_SECONDS = 0.45;
const HIJACK_BONUS = 200;
const GRAPPLE_HIJACK_BONUS = 300;
const MAX_PLAYER_VEHICLES = 18;
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
      if (ACTIVE.def.id === 'badlands') {
        this.stagePool(BADLANDS_MOTOR_POOL);
      } else if (ON_RANGE) {
        this.stagePool(RANGE_MOTOR_POOL);
      }
    });

    ctx.events.on('wave:clear', () => {
      if (ACTIVE.def.id !== 'badlands') return;
      let replaced = 0;
      for (const s of BADLANDS_MOTOR_POOL) {
        const exists = this.vehicles.some(v => v.alive && v.poolSlot === s.slot);
        if (!exists) {
          _pos.set(s.at[0], s.at[1], s.at[2]);
          const gy = ctx.world?.nav?.groundHeight?.(_pos.x, _pos.y + 3, _pos.z);
          if (typeof gy === 'number' && Number.isFinite(gy)) _pos.y = gy;
          this.spawn(s.id, _pos, s.yaw, { poolSlot: s.slot });
          replaced++;
        }
      }
      if (replaced > 0) {
        ctx.hud?.feed?.(`MOTOR POOL RESTOCKED (${replaced} VEHICLE${replaced > 1 ? 'S' : ''})`, '#38e8ff');
      }
    });
  }

  /** Currently occupied player vehicle, or null when on foot or in another seat. */
  get active(): DriveableVehicle | null {
    for (const v of this.vehicles) {
      if (v.alive && v.occupied) return v;
    }
    return null;
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
    opts?: { velocity?: THREE.Vector3; healthFraction?: number; poolSlot?: string | null },
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
    const claim = this.ctx.enemies?.vehicles?.hijack?.(enemyVehicleId);
    if (!claim) return null;

    const driveId = HIJACK_MAP[claim.kind];
    const vehicle = this.spawn(driveId, claim.position, claim.yaw, {
      velocity: claim.velocity,
      healthFraction: Math.max(0.55, claim.healthFraction),
    });

    if (vehicle.board(0)) {
      const bonus = viaGrapple ? GRAPPLE_HIJACK_BONUS : HIJACK_BONUS;
      const title = viaGrapple ? 'GRAPPLE HIJACK!' : 'VEHICLE HIJACKED!';
      this.ctx.audio?.play('glass_break', { position: claim.position, volume: 0.7, pitch: 0.9 });
      this.ctx.audio?.play('metal_clang', { position: claim.position, volume: 0.9, pitch: 0.85 });
      this.ctx.fx?.sparks?.(claim.position, new THREE.Vector3(0, 1, 0), 22, 0xffd166);
      this.ctx.progression?.award?.(bonus, title, claim.position);
      this.ctx.hud?.feed?.(`${title} — ${DRIVE_VEHICLES[driveId].name} (+${bonus})`, '#ffd166');
      this.ctx.hud?.floatText?.(claim.position, title, '#ffd166');
      this.ctx.camera?.addTrauma?.(0.35);
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

    // 1. Check for nearby live enemy vehicle to HIJACK!
    const hijackTarget: HijackableVehicle | null = this.ctx.enemies?.vehicles?.findHijackable?.(player.position, HIJACK_REACH) ?? null;
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

    // 2. Check for nearest parked friendly/player driveable vehicle to board!
    let best: DriveableVehicle | null = null;
    let bestDist = Infinity;
    for (const v of this.vehicles) {
      if (!v.alive || v.occupied) continue;
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
