/**
 * Friendly AI-Driven Vehicle Fleet (`AiVehicleFleet`) for Combined-Arms Missions.
 *
 * Drives real 3D PBR vehicle models (`aegis` MBT, `bastion` Guntruck/APC, `jackal` Technical,
 * `valkyrie` Fast-Rope Transport Chopper, `kestrel` Attack Gunship) without player occupancy:
 *   - Ground armor follows waypoint lanes, halts cleanly at blocked breach gates until opened
 *     via `setGateOpen(laneId, true)`, aims turrets & fires cannons/MGs at live `ctx.enemies`
 *     and `ctx.enemies.vehicles.live`, absorbs enemy fire, and explodes into burning wrecks.
 *   - Friendly `valkyrie` transports fly inbound to LZ waypoints, flare into hover, deploy
 *     fast-rope lines, drop a squad of `ctx.allies` infantry, and bank out cleanly.
 *   - Friendly `kestrel` gunships orbit assigned target zones and strafe enemy armor, infantry,
 *     and hostile helicopters with chin-gun bursts and Hydra rockets.
 *   - Exposes `getLiveGroundTargets()` (implementing `FriendlyGroundTarget`) so enemy tanks,
 *     humvees, and choppers in `VehicleSystem` engage friendly armor in real tank-vs-tank battles!
 */
import * as THREE from 'three';
import type { Ally } from '../../allies/ally';
import type { AllyType } from '../../allies/data';
import type { Ctx, DamageInfo, EmitterHandle } from '../../core/contracts';
import type { EnemyInstance, ExplosionSpec } from '../../core/gameplay';
import { clamp, damp, dampAngle, rand, wrapAngle } from '../../core/math';
import type { EnemyManager } from '../../enemies/EnemyManager';
import type { FriendlyGroundTarget } from '../../enemies/vehicles';
import type { Vehicle as EnemyVehicle } from '../../enemies/vehicles/vehicle';
import { ModelMaterials } from '../../progression/modelkit';
import { DRIVE_VEHICLES } from './data';
import { buildVehicleModel, type VehicleModelRig } from './models';
import type { DriveVehicleDef } from './types';

export type AiFriendlyVehicleKind = 'aegis' | 'bastion' | 'jackal' | 'valkyrie' | 'kestrel';
export type AiGroundVehicleKind = 'aegis' | 'bastion' | 'jackal';
export type AiVehicleRole = 'ground' | 'transport' | 'gunship';
export type ValkyriePhase = 'inbound' | 'hover' | 'fast_rope' | 'egress' | 'departed';

export type WaypointLike = THREE.Vector3 | readonly [number, number] | readonly [number, number, number];

export interface AiGroundSpawnOptions {
  readonly id?: string;
  readonly kind: AiGroundVehicleKind;
  readonly laneId: string;
  readonly spawn: WaypointLike;
  readonly waypoints: readonly WaypointLike[];
  /**
   * Waypoint index where the unit holds while `laneId`'s gate is closed.
   * When explicitly provided and `laneId` has not yet been opened, that lane defaults to closed.
   */
  readonly gateWaypointIndex?: number;
  readonly hpOverride?: number;
  readonly speedScale?: number;
  readonly label?: string;
  readonly onDestroyed?: (unit: AiFriendlyVehicle) => void;
}

export interface AiValkyrieSpawnOptions {
  readonly id?: string;
  readonly lzId?: string;
  readonly approachFrom: WaypointLike;
  readonly lzPos: WaypointLike;
  readonly egressTo?: WaypointLike;
  readonly hoverHeight?: number;
  readonly squadCount?: number;
  readonly squadTypes?: readonly AllyType[];
  readonly postPos?: WaypointLike;
  /** Mark fast-roped troops as expendable frontline infantry (no down state or HUD kill spam). */
  readonly expendable?: boolean;
  /** Mark fast-roped troops as detached so player [E] squad holds only command the core squad. */
  readonly detached?: boolean;
  readonly hpOverride?: number;
  readonly label?: string;
  readonly onTroopsDeployed?: (unit: AiFriendlyVehicle, spawned: readonly Ally[]) => void;
  readonly onDestroyed?: (unit: AiFriendlyVehicle) => void;
}

export interface AiKestrelSpawnOptions {
  readonly id?: string;
  readonly spawn: WaypointLike;
  readonly orbitCenter: WaypointLike;
  readonly orbitRadius?: number;
  readonly orbitAltitude?: number;
  readonly hpOverride?: number;
  readonly label?: string;
  readonly onDestroyed?: (unit: AiFriendlyVehicle) => void;
}

interface PendingFriendlyShell {
  at: THREE.Vector3;
  radius: number;
  damage: number;
  delay: number;
  source: string;
}

const DEFAULT_SQUAD_TYPES: readonly AllyType[] = ['rifleman', 'rifleman', 'shotgunner', 'medic'];

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _enemyScratch: EnemyInstance[] = [];

const _damageInfo: DamageInfo = {
  amount: 0,
  type: 'bullet',
  point: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  force: 0,
  source: 'ally_vehicle',
};

let nextAiUnitUid = 1;

function toVec3(p: WaypointLike, defaultY = 0): THREE.Vector3 {
  if (p instanceof THREE.Vector3) return p.clone();
  if (p.length === 2) return new THREE.Vector3(p[0], defaultY, p[1]);
  return new THREE.Vector3(p[0], p[1], p[2]);
}

function groundAt(ctx: Ctx, x: number, yHint: number, z: number): number {
  const gy = ctx.world?.nav?.groundHeight?.(x, yHint + 2.5, z);
  return typeof gy === 'number' && Number.isFinite(gy) ? gy : yHint;
}

interface ResolvedEnemyTarget {
  kind: 'vehicle' | 'infantry';
  pos: THREE.Vector3;
  vehicle?: EnemyVehicle;
  enemy?: EnemyInstance;
  dist: number;
}

export class AiFriendlyVehicle implements FriendlyGroundTarget {
  readonly id: string;
  readonly kind: AiFriendlyVehicleKind;
  readonly role: AiVehicleRole;
  readonly def: DriveVehicleDef;
  readonly laneId: string | null;
  readonly lzId: string | null;
  readonly armored: boolean;
  readonly airborne: boolean;
  readonly aimLift: number;

  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly maxHealth: number;
  health: number;
  alive = true;
  wrecked = false;
  disposed = false;

  yaw = 0;
  pitch = 0;
  roll = 0;
  speed = 0;
  turretYaw = 0;
  turretPitch = 0;
  wheelSpin = 0;
  rotorAngle = 0;
  recoil = 0;

  // Ground lane state
  readonly waypoints: THREE.Vector3[] = [];
  waypointIndex = 0;
  gateWaypointIndex = 0;
  waitingAtGate = false;
  routeCompleted = false;
  private readonly speedScale: number;

  // Valkyrie fast-rope state
  valkyriePhase: ValkyriePhase = 'inbound';
  readonly lzPos = new THREE.Vector3();
  readonly egressPos = new THREE.Vector3();
  readonly postPos = new THREE.Vector3();
  readonly deployedTroops: Ally[] = [];
  private hoverHeight = 13;
  private hoverTimer = 0;
  private squadRemaining = 0;
  private squadTypes: readonly AllyType[] = DEFAULT_SQUAD_TYPES;
  private squadExpendable = false;
  private squadDetached = false;
  private dropCooldown = 0;
  private dropIndex = 0;
  private readonly ropes: THREE.Mesh[] = [];
  private ropesVisible = false;
  private onTroopsDeployed: ((unit: AiFriendlyVehicle, spawned: readonly Ally[]) => void) | null = null;

  // Kestrel orbit state
  readonly orbitCenter = new THREE.Vector3();
  orbitRadius = 55;
  orbitAltitude = 32;
  orbitAngle = 0;

  // Combat & VFX state
  shotsFired = 0;
  private scanCd = 0;
  private fireCd = 0;
  private rocketCd = 2.5;
  private smokeCd = 0;
  private currentTarget: ResolvedEnemyTarget | null = null;
  private readonly emitters: EmitterHandle[] = [];
  private unmark: (() => void) | null = null;
  private readonly markerPos = new THREE.Vector3();
  private readonly onDestroyed: ((unit: AiFriendlyVehicle) => void) | null;

  readonly rig: VehicleModelRig;
  private readonly beacon: THREE.Mesh;

  constructor(
    private readonly ctx: Ctx,
    private readonly fleet: AiVehicleFleet,
    materials: ModelMaterials,
    kind: AiFriendlyVehicleKind,
    role: AiVehicleRole,
    spawnPos: THREE.Vector3,
    initialYaw: number,
    opts: {
      id?: string;
      laneId?: string | null;
      lzId?: string | null;
      hpOverride?: number;
      speedScale?: number;
      label?: string;
      onDestroyed?: (unit: AiFriendlyVehicle) => void;
    },
  ) {
    this.id = opts.id ?? `ai_${kind}_${nextAiUnitUid++}`;
    this.kind = kind;
    this.role = role;
    this.def = DRIVE_VEHICLES[kind];
    this.laneId = opts.laneId ?? null;
    this.lzId = opts.lzId ?? null;
    this.armored = kind === 'aegis' || kind === 'bastion';
    this.airborne = kind === 'valkyrie' || kind === 'kestrel';
    this.aimLift = this.airborne ? 1.2 : 1.65;
    this.speedScale = opts.speedScale ?? 0.62;
    this.onDestroyed = opts.onDestroyed ?? null;

    this.maxHealth = opts.hpOverride != null ? Math.max(1, Math.round(opts.hpOverride)) : this.def.maxHealth;
    this.health = this.maxHealth;

    this.position.copy(spawnPos);
    this.yaw = initialYaw;
    this.turretYaw = initialYaw;

    this.rig = buildVehicleModel(kind, materials);
    this.rig.root.name = `ai_friendly.${this.id}`;
    if (this.rig.resupplyRing) this.rig.resupplyRing.visible = false;
    for (const r of this.rig.riders) r.root.visible = true;

    // Bright cyan friendly IFF beacon so friendly armor & choppers read clearly in battle.
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0x38e8ff });
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), beaconMat);
    this.beacon.position.set(0, this.def.halfHeight * 1.45 + 0.5, -0.4);
    this.rig.body.add(this.beacon);

    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.set(0, this.yaw, 0, 'YXZ');
    ctx.render?.scene?.add(this.rig.root);

    this.markerPos.copy(this.position).setY(this.position.y + this.def.halfHeight * 2 + 1.2);
    const label = opts.label ?? `ALLY · ${this.def.shortName}`;
    this.unmark = ctx.hud?.follow?.(this.markerPos, label, '#38e8ff') ?? null;
  }

  /** Configures ground waypoint lane and gate stop index. */
  configureGround(waypoints: readonly THREE.Vector3[], gateWaypointIndex: number): void {
    this.waypoints.length = 0;
    for (const wp of waypoints) this.waypoints.push(wp.clone());
    this.waypointIndex = 0;
    this.gateWaypointIndex = clamp(gateWaypointIndex, 0, Math.max(0, this.waypoints.length - 1));
    this.routeCompleted = this.waypoints.length === 0;
  }

  /** Configures Valkyrie inbound LZ, fast-rope squad, and egress flight path. */
  configureValkyrie(opts: AiValkyrieSpawnOptions): void {
    this.lzPos.copy(toVec3(opts.lzPos, 0));
    this.lzPos.y = groundAt(this.ctx, this.lzPos.x, this.lzPos.y, this.lzPos.z);
    this.postPos.copy(opts.postPos ? toVec3(opts.postPos, this.lzPos.y) : this.lzPos);
    this.hoverHeight = opts.hoverHeight ?? 13;
    if (opts.egressTo) {
      this.egressPos.copy(toVec3(opts.egressTo, this.lzPos.y + this.hoverHeight + 25));
    } else {
      // Default bank-out vector away from approach
      _v.subVectors(this.lzPos, this.position).setY(0);
      if (_v.lengthSq() < 1) _v.set(1, 0, 0);
      _v.normalize();
      this.egressPos.set(
        this.lzPos.x + (-_v.z * 220 + _v.x * 120),
        this.lzPos.y + this.hoverHeight + 30,
        this.lzPos.z + (_v.x * 220 + _v.z * 120),
      );
    }
    this.squadRemaining = Math.max(1, opts.squadCount ?? 4);
    this.squadTypes = opts.squadTypes && opts.squadTypes.length > 0 ? opts.squadTypes : DEFAULT_SQUAD_TYPES;
    this.squadExpendable = opts.expendable === true;
    this.squadDetached = opts.detached === true;
    this.onTroopsDeployed = opts.onTroopsDeployed ?? null;
    this.valkyriePhase = 'inbound';

    // Pre-build 2 fast-rope cylinders attached beneath side doors (hidden until hover/fast_rope).
    const ropeGeo = new THREE.CylinderGeometry(0.055, 0.055, this.hoverHeight, 6);
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x5c5346, roughness: 0.95 });
    for (const side of [-1.45, 1.45]) {
      const rope = new THREE.Mesh(ropeGeo, ropeMat);
      rope.position.set(side, -this.hoverHeight * 0.5, 0.2);
      rope.visible = false;
      this.rig.root.add(rope);
      this.ropes.push(rope);
    }
  }

  /** Configures Kestrel orbit zone. */
  configureKestrel(opts: AiKestrelSpawnOptions): void {
    this.orbitCenter.copy(toVec3(opts.orbitCenter, 0));
    this.orbitRadius = opts.orbitRadius ?? 55;
    this.orbitAltitude = opts.orbitAltitude ?? 32;
    this.orbitAngle = Math.atan2(this.position.x - this.orbitCenter.x, this.position.z - this.orbitCenter.z);
  }

  /** Dynamically retargets a Kestrel gunship's patrol orbit center. */
  setOrbitCenter(center: WaypointLike, radius?: number, altitude?: number): void {
    this.orbitCenter.copy(toVec3(center, 0));
    if (radius !== undefined) this.orbitRadius = radius;
    if (altitude !== undefined) this.orbitAltitude = altitude;
  }

  /** FriendlyGroundTarget damage intake from enemy tanks, humvees, choppers, or mortars. */
  takeDamage(amount: number, from?: THREE.Vector3, _source?: string): void {
    if (!this.alive || this.disposed || amount <= 0) return;
    // Heavy armor mitigates light small-arms glancing hits slightly.
    const mult = this.armored && amount < 25 ? 0.55 : 1.0;
    this.health -= amount * mult;
    this.ctx.fx?.sparks?.(from ?? this.position, _up, 8, 0xffaa33);
    if (this.health <= 0) {
      this.explodeAndWreck();
    }
  }

  private explodeAndWreck(): void {
    if (!this.alive) return;
    this.alive = false;
    this.health = 0;
    this.wrecked = true;
    this.speed = 0;
    this.velocity.set(0, 0, 0);
    this.beacon.visible = false;
    this.setRopesVisible(false);
    this.unmark?.();
    this.unmark = null;

    // Ground wreck if airborne chopper got shot down
    if (this.airborne) {
      this.position.y = groundAt(this.ctx, this.position.x, this.position.y, this.position.z) + 0.5;
      this.pitch = 0.14;
      this.roll = rand(-0.35, 0.35);
      this.rig.root.position.copy(this.position);
      this.rig.root.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    }

    const blastCenter = this.position.clone().setY(this.position.y + 1.2);
    this.ctx.fx?.explosion?.(blastCenter, {
      radius: this.armored ? 9 : 6.5,
      scale: this.armored ? 1.85 : 1.35,
    });
    this.ctx.fx?.chips?.(blastCenter, 0xff9000, 36);
    this.ctx.render?.lights?.flash?.(blastCenter, 0xffa040, 14, 38, 0.45);
    this.ctx.render?.decals?.add?.('scorch', this.position, _up, this.def.halfLength * 2.1, rand(0, 6.28));
    this.ctx.audio?.play?.('vehicle_explode', { position: blastCenter, volume: 0.85 });

    // Scorch hull meshes charcoal black & attach burning wreck smoke/fire emitters!
    for (const m of this.rig.meshes) {
      if (m instanceof THREE.Mesh && m.material && !Array.isArray(m.material)) {
        const cloned = m.material.clone();
        if ('color' in cloned && cloned.color instanceof THREE.Color) {
          cloned.color.multiplyScalar(0.24);
        }
        m.material = cloned;
      }
    }
    const fire = this.ctx.fx?.attachEmitter?.(this.rig.root, 'burning', new THREE.Vector3(0, 1.4, 0), 90);
    if (fire) this.emitters.push(fire);
    const smoke = this.ctx.fx?.attachEmitter?.(this.rig.root, 'smokeTrail', new THREE.Vector3(0, 1.8, -0.4), 90);
    if (smoke) this.emitters.push(smoke);

    this.onDestroyed?.(this);
  }

  private setRopesVisible(visible: boolean): void {
    if (this.ropesVisible === visible) return;
    this.ropesVisible = visible;
    for (const r of this.ropes) r.visible = visible;
  }

  update(dt: number): void {
    if (this.disposed || !this.alive) return;

    if (this.role === 'ground') {
      this.updateGround(dt);
    } else if (this.role === 'transport') {
      this.updateValkyrie(dt);
    } else {
      this.updateKestrel(dt);
    }

    if (!this.alive || this.disposed) return;

    // Damaged smoke trail below 45% HP
    if (this.health < this.maxHealth * 0.45) {
      this.smokeCd -= dt;
      if (this.smokeCd <= 0) {
        this.smokeCd = 0.22;
        this.ctx.fx?.smoke?.(
          _v.set(this.position.x, this.position.y + 1.8, this.position.z),
          '#1b1a19',
          1.4,
          1.2,
        );
      }
    }

    this.syncModel(dt);
  }

  // -------------------------------------------------------------------------------------------
  // Ground Armor AI (Aegis MBT, Bastion APC, Jackal Technical)
  // -------------------------------------------------------------------------------------------

  private updateGround(dt: number): void {
    const laneClosed = this.laneId !== null && !this.fleet.isGateOpen(this.laneId);
    const topSpeed = this.def.maxSpeed * this.speedScale;

    if (this.waypoints.length === 0 || this.routeCompleted) {
      this.waitingAtGate = false;
      this.speed = damp(this.speed, 0, 5.5, dt);
      this.velocity.set(Math.sin(this.yaw) * this.speed, 0, Math.cos(this.yaw) * this.speed);
    } else {
      const wp = this.waypoints[this.waypointIndex]!;
      const dx = wp.x - this.position.x;
      const dz = wp.z - this.position.z;
      const dist = Math.hypot(dx, dz);

      const blockedHere = laneClosed && this.waypointIndex >= this.gateWaypointIndex;
      if (blockedHere && dist <= 4.5) {
        // Hold cleanly at the staging waypoint right in front of the closed perimeter wall!
        this.waitingAtGate = true;
        this.speed = damp(this.speed, 0, 7.5, dt);
        this.velocity.set(Math.sin(this.yaw) * this.speed, 0, Math.cos(this.yaw) * this.speed);
      } else {
        this.waitingAtGate = false;
        if (dist <= 4.0) {
          if (laneClosed && this.waypointIndex >= this.gateWaypointIndex) {
            this.waitingAtGate = true;
            this.speed = 0;
            this.velocity.set(0, 0, 0);
          } else {
            this.waypointIndex++;
            if (this.waypointIndex >= this.waypoints.length) {
              this.routeCompleted = true;
            }
          }
        } else {
          const desiredYaw = Math.atan2(dx, dz);
          const yawErr = wrapAngle(desiredYaw - this.yaw);
          const maxTurn = this.def.turnRate * 0.9 * dt;
          this.yaw = wrapAngle(this.yaw + clamp(yawErr, -maxTurn, maxTurn));

          const alignFactor = clamp(Math.cos(yawErr), 0.18, 1);
          const approachFactor = blockedHere ? clamp((dist - 3.5) / 14, 0, 1) : 1;
          const desiredSpeed = topSpeed * alignFactor * approachFactor;
          this.speed = damp(this.speed, desiredSpeed, 3.6, dt);
          this.velocity.set(Math.sin(this.yaw) * this.speed, 0, Math.cos(this.yaw) * this.speed);
          this.position.x += this.velocity.x * dt;
          this.position.z += this.velocity.z * dt;
        }
      }
    }

    const gy = groundAt(this.ctx, this.position.x, this.position.y, this.position.z);
    this.position.y = damp(this.position.y, gy, 10, dt);
    this.wheelSpin += this.speed * dt * 1.4;

    // Ground combat: scan & fire turret cannon/MG at live enemies & enemy vehicles!
    const engageRange = this.kind === 'aegis' ? 145 : this.kind === 'bastion' ? 125 : 105;
    this.updateWeapons(dt, engageRange, this.kind === 'aegis');
  }

  // -------------------------------------------------------------------------------------------
  // Friendly Valkyrie Fast-Rope Transport Chopper AI
  // -------------------------------------------------------------------------------------------

  private updateValkyrie(dt: number): void {
    this.rotorAngle += dt * 24;

    if (this.valkyriePhase === 'inbound') {
      _v.set(this.lzPos.x, this.lzPos.y + this.hoverHeight, this.lzPos.z);
      const dist = this.flyToward(_v, 36, 1.85, dt);
      if (dist <= 6.5) {
        this.valkyriePhase = 'hover';
        this.hoverTimer = 1.0;
        this.setRopesVisible(true);
      }
      return;
    }

    if (this.valkyriePhase === 'hover') {
      _v.set(this.lzPos.x, this.lzPos.y + this.hoverHeight, this.lzPos.z);
      this.position.lerp(_v, clamp(3.5 * dt, 0, 1));
      this.velocity.multiplyScalar(Math.max(0, 1 - 4 * dt));
      this.pitch = damp(this.pitch, 0, 5, dt);
      this.roll = damp(this.roll, 0, 5, dt);
      this.hoverTimer -= dt;
      if (this.hoverTimer <= 0) {
        this.valkyriePhase = 'fast_rope';
        this.dropCooldown = 0;
      }
      this.updateWeapons(dt, 95, false);
      return;
    }

    if (this.valkyriePhase === 'fast_rope') {
      _v.set(this.lzPos.x, this.lzPos.y + this.hoverHeight, this.lzPos.z);
      this.position.lerp(_v, clamp(4.0 * dt, 0, 1));
      this.velocity.set(0, 0, 0);
      this.pitch = damp(this.pitch, 0, 6, dt);
      this.roll = damp(this.roll, 0, 6, dt);

      this.dropCooldown -= dt;
      if (this.dropCooldown <= 0 && this.squadRemaining > 0) {
        this.dropCooldown = 0.42;
        this.deployOneTrooper();
        this.squadRemaining--;
        if (this.squadRemaining <= 0) {
          this.onTroopsDeployed?.(this, this.deployedTroops);
          this.setRopesVisible(false);
          this.valkyriePhase = 'egress';
        }
      }
      this.updateWeapons(dt, 95, false);
      return;
    }

    if (this.valkyriePhase === 'egress') {
      const dist = this.flyToward(this.egressPos, 44, 1.9, dt);
      if (dist <= 18) {
        this.valkyriePhase = 'departed';
        this.dispose();
      }
    }
  }

  private deployOneTrooper(): void {
    const idx = this.dropIndex++;
    const side = idx % 2 === 0 ? -1 : 1;
    const spread = 1.6 + Math.floor(idx / 2) * 1.4;
    const dropPos = new THREE.Vector3(
      this.lzPos.x + side * spread,
      this.lzPos.y,
      this.lzPos.z + rand(-1.5, 1.5),
    );
    dropPos.y = groundAt(this.ctx, dropPos.x, dropPos.y, dropPos.z);

    this.ctx.fx?.dust?.(dropPos, _up, 2);
    const type = this.squadTypes[idx % this.squadTypes.length] ?? 'rifleman';
    const ally = this.ctx.allies?.spawn?.(type, dropPos, this.postPos.clone(), 7, this.yaw);
    if (ally) {
      if (this.squadExpendable) ally.expendable = true;
      if (this.squadDetached) ally.detached = true;
      this.deployedTroops.push(ally);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Friendly Kestrel Attack Chopper AI
  // -------------------------------------------------------------------------------------------

  private updateKestrel(dt: number): void {
    this.rotorAngle += dt * 28;
    const orbitSpeed = 24;
    const angRate = orbitSpeed / Math.max(18, this.orbitRadius);
    this.orbitAngle = wrapAngle(this.orbitAngle + angRate * dt);

    const groundY = groundAt(this.ctx, this.orbitCenter.x, 0, this.orbitCenter.z);
    _v.set(
      this.orbitCenter.x + Math.sin(this.orbitAngle) * this.orbitRadius,
      groundY + this.orbitAltitude,
      this.orbitCenter.z + Math.cos(this.orbitAngle) * this.orbitRadius,
    );
    this.flyToward(_v, 32, 2.2, dt);

    // Engage enemy armor, enemy choppers, and enemy infantry!
    this.updateWeapons(dt, 165, true);
  }

  private flyToward(goal: THREE.Vector3, cruiseSpeed: number, turnRate: number, dt: number): number {
    const dx = goal.x - this.position.x;
    const dy = goal.y - this.position.y;
    const dz = goal.z - this.position.z;
    const flat = Math.hypot(dx, dz);
    const dist = Math.hypot(flat, dy);

    if (flat > 1) {
      const desiredYaw = Math.atan2(dx, dz);
      const err = wrapAngle(desiredYaw - this.yaw);
      const step = clamp(err, -turnRate * dt, turnRate * dt);
      this.yaw = wrapAngle(this.yaw + step);
      const targetRoll = clamp((-step / Math.max(0.01, turnRate * dt)) * 0.42, -0.42, 0.42);
      this.roll = damp(this.roll, targetRoll, 4.5, dt);
    }

    const desiredSpeed = clamp(dist * 1.15, 4, cruiseSpeed);
    this.speed = damp(this.speed, desiredSpeed, 3.0, dt);
    if (dist > 0.05) {
      const inv = 1 / dist;
      this.velocity.set(dx * inv * this.speed, dy * inv * this.speed, dz * inv * this.speed);
      this.position.addScaledVector(this.velocity, dt);
    }
    const targetPitch = clamp((this.speed / Math.max(1, cruiseSpeed)) * 0.2, 0, 0.24);
    this.pitch = damp(this.pitch, targetPitch, 4.0, dt);
    return dist;
  }

  // -------------------------------------------------------------------------------------------
  // Combined-Arms Target Acquisition & Weapon Fire (Enemies + Enemy Vehicles)
  // -------------------------------------------------------------------------------------------

  private updateWeapons(dt: number, maxRange: number, preferArmor: boolean): void {
    this.scanCd -= dt;
    if (this.scanCd <= 0 || !this.isTargetAlive(this.currentTarget)) {
      this.scanCd = 0.25;
      this.currentTarget = this.acquireEnemyTarget(maxRange, preferArmor);
    }

    const target = this.currentTarget;
    if (!target) {
      // Return turret smoothly to hull forward
      this.turretYaw = dampAngle(this.turretYaw, this.yaw, 3.0, dt);
      this.turretPitch = damp(this.turretPitch, 0, 3.0, dt);
      return;
    }

    // Slew turret toward target
    const dx = target.pos.x - this.position.x;
    const dy = target.pos.y - (this.position.y + this.aimLift);
    const dz = target.pos.z - this.position.z;
    const flat = Math.max(0.1, Math.hypot(dx, dz));
    const desiredYaw = Math.atan2(dx, dz);
    const desiredPitch = clamp(Math.atan2(dy, flat), -0.45, 0.55);

    const slew = this.kind === 'aegis' ? 1.85 : 3.2;
    const yawErr = wrapAngle(desiredYaw - this.turretYaw);
    this.turretYaw = wrapAngle(this.turretYaw + clamp(yawErr, -slew * dt, slew * dt));
    this.turretPitch = damp(this.turretPitch, desiredPitch, 5.5, dt);

    if (Math.abs(yawErr) > 0.22) return;

    // Primary weapon fire
    this.fireCd -= dt;
    if (this.fireCd <= 0) {
      this.firePrimary(target);
    }

    // Kestrel secondary Hydra rocket salvo against enemy armor/groups
    if (this.kind === 'kestrel') {
      this.rocketCd -= dt;
      if (this.rocketCd <= 0 && target.dist > 18 && target.dist < maxRange) {
        this.rocketCd = rand(4.2, 6.0);
        this.fireKestrelRocket(target);
      }
    }
  }

  private isTargetAlive(t: ResolvedEnemyTarget | null): boolean {
    if (!t) return false;
    if (t.kind === 'vehicle') return Boolean(t.vehicle && t.vehicle.alive && !t.vehicle.retired);
    return Boolean(t.enemy && t.enemy.alive);
  }

  private acquireEnemyTarget(maxRange: number, preferArmor: boolean): ResolvedEnemyTarget | null {
    const enemies = this.ctx.enemies as unknown as EnemyManager | undefined;
    if (!enemies) return null;

    let best: ResolvedEnemyTarget | null = null;
    let bestScore = Infinity;

    // 1. Live enemy vehicles (tanks, humvees, trucks, attack choppers)
    const enemyVehicles = enemies.vehicles?.live;
    if (enemyVehicles && enemyVehicles.length > 0) {
      for (let i = 0; i < enemyVehicles.length; i++) {
        const v = enemyVehicles[i]!;
        if (!v.alive || v.retired) continue;
        const dist = this.position.distanceTo(v.center);
        if (dist > maxRange) continue;
        const score = preferArmor ? dist * 0.65 : dist * 0.85;
        if (score < bestScore) {
          bestScore = score;
          best = { kind: 'vehicle', pos: v.center, vehicle: v, dist };
        }
      }
    }

    // 2. Live enemy infantry via spatial query
    if (typeof enemies.query === 'function') {
      const count = enemies.query(this.position, maxRange, _enemyScratch);
      for (let i = 0; i < count; i++) {
        const e = _enemyScratch[i]!;
        if (!e.alive) continue;
        const dist = this.position.distanceTo(e.center);
        if (dist > maxRange) continue;
        if (dist < bestScore) {
          bestScore = dist;
          best = { kind: 'infantry', pos: e.center, enemy: e, dist };
        }
      }
    }

    return best;
  }

  private getMuzzlePos(out: THREE.Vector3): THREE.Vector3 {
    const m = this.rig.muzzles.main;
    if (m) {
      this.rig.root.updateMatrixWorld(true);
      m.getWorldPosition(out);
      return out;
    }
    return out.set(this.position.x, this.position.y + this.aimLift, this.position.z);
  }

  private firePrimary(target: ResolvedEnemyTarget): void {
    const { fx, audio } = this.ctx;
    this.getMuzzlePos(_muzzle);
    _dir.subVectors(target.pos, _muzzle).normalize();
    this.shotsFired++;

    if (this.kind === 'aegis') {
      // 120mm main battle tank cannon!
      this.fireCd = rand(2.6, 3.4);
      this.recoil = 0.55;
      fx?.muzzleFlash?.(_muzzle, _dir, 'autocannon');
      fx?.tracer?.(_muzzle, target.pos, 'heavy');
      fx?.smoke?.(_muzzle, '#8a8478', 2.2, 1.2);
      audio?.play?.('tank_cannon', { position: _muzzle, volume: 0.72, pitch: 1.04 });

      const travel = clamp(target.dist / 95, 0.05, 1.8);
      this.fleet.scheduleFriendlyShell(target.pos, 6.5, 190, travel, 'ally_tank_cannon');
      return;
    }

    // Rapid autocannon / HMG / chin-gun burst (Bastion, Jackal, Kestrel, Valkyrie door-gun)
    const isAuto = this.kind === 'bastion' || this.kind === 'kestrel';
    this.fireCd = isAuto ? 0.22 : 0.18;
    const dmg = this.kind === 'kestrel' ? 32 : this.kind === 'bastion' ? 26 : 18;
    const source = `ally_${this.kind}`;

    fx?.muzzleFlash?.(_muzzle, _dir, isAuto ? 'autocannon' : 'rifle');
    fx?.tracer?.(_muzzle, target.pos, isAuto ? 'heavy' : 'bullet');
    if (this.shotsFired % 3 === 1) {
      audio?.play?.(isAuto ? 'gunship_gun' : 'mounted_gun', {
        position: _muzzle,
        volume: 0.45,
        pitch: isAuto ? 1.05 : 1.15,
      });
    }

    this.applyDirectFriendlyHit(target, dmg, source);
  }

  private fireKestrelRocket(target: ResolvedEnemyTarget): void {
    const { fx, audio } = this.ctx;
    this.getMuzzlePos(_muzzle);
    _dir.subVectors(target.pos, _muzzle).normalize();
    fx?.muzzleFlash?.(_muzzle, _dir, 'rocket');
    fx?.tracer?.(_muzzle, target.pos, 'heavy');
    audio?.play?.('rocket_fire', { position: _muzzle, volume: 0.6, pitch: 1.1 });

    const travel = clamp(target.dist / 78, 0.12, 2.2);
    this.fleet.scheduleFriendlyShell(target.pos, 7.2, 155, travel, 'ally_kestrel_rocket');
  }

  private applyDirectFriendlyHit(target: ResolvedEnemyTarget, damage: number, source: string): void {
    const enemies = this.ctx.enemies as unknown as EnemyManager | undefined;
    if (!enemies) return;

    if (target.kind === 'vehicle' && target.vehicle && target.vehicle.alive) {
      // Bastion 30mm / Kestrel 30mm punch enemy armor cleanly; Jackal .50 cal shreds soft-skins & chips armor.
      const eff = target.vehicle.def.armoured && this.kind === 'jackal' ? damage * 0.4 : damage;
      target.vehicle.take(eff, null, source, target.pos);
      this.ctx.fx?.sparks?.(target.pos, _up, 5, 0xffd080);
    } else if (target.kind === 'infantry' && target.enemy && target.enemy.alive) {
      _damageInfo.amount = damage;
      _damageInfo.type = 'bullet';
      _damageInfo.point.copy(target.pos);
      _damageInfo.dir.copy(_dir);
      _damageInfo.force = 4;
      _damageInfo.source = source;
      enemies.applyDamage(target.enemy, _damageInfo);
    }
  }

  private syncModel(dt: number): void {
    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');

    if (this.rig.turret) {
      this.rig.turret.rotation.y = wrapAngle(this.turretYaw - this.yaw);
    }
    if (this.rig.barrel) {
      this.recoil = damp(this.recoil, 0, 6.5, dt);
      this.rig.barrel.rotation.x = -this.turretPitch;
      this.rig.barrel.position.z = this.rig.barrelBaseZ - this.recoil;
    }
    for (const w of this.rig.wheelsFront) w.rotation.x = this.wheelSpin;
    for (const w of this.rig.wheelsRear) w.rotation.x = this.wheelSpin;
    if (this.rig.rotorMain) this.rig.rotorMain.rotation.y = this.rotorAngle;
    if (this.rig.rotorTail) this.rig.rotorTail.rotation.x = this.rotorAngle * 1.9;

    this.markerPos.set(this.position.x, this.position.y + this.def.halfHeight * 2 + 1.2, this.position.z);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.alive = false;
    this.unmark?.();
    this.unmark = null;
    for (const e of this.emitters) e.stop();
    this.emitters.length = 0;
    for (const r of this.ropes) {
      r.geometry.dispose();
      (r.material as THREE.Material).dispose();
    }
    this.ropes.length = 0;
    this.ctx.render?.scene?.remove(this.rig.root);
    (this.beacon.material as THREE.Material).dispose();
    this.beacon.geometry.dispose();
  }
}

export class AiVehicleFleet {
  readonly units: AiFriendlyVehicle[] = [];
  private readonly materials: ModelMaterials;
  private readonly laneGates = new Map<string, boolean>();
  private readonly pendingShells: PendingFriendlyShell[] = [];
  private readonly groundTargetCache: FriendlyGroundTarget[] = [];

  constructor(
    private readonly ctx: Ctx,
    materials?: ModelMaterials,
  ) {
    this.materials = materials ?? new ModelMaterials(ctx);
  }

  /** Opens or closes a breach wall gate for `laneId`. Friendly armor holds cleanly until opened! */
  setGateOpen(laneId: string, open: boolean): void {
    this.laneGates.set(laneId, open);
  }

  /** True when `laneId`'s gate is open (lanes never marked closed default to open). */
  isGateOpen(laneId: string): boolean {
    return this.laneGates.get(laneId) !== false;
  }

  /** Spawns a friendly AI-driven ground vehicle (`aegis`, `bastion`, or `jackal`) on a waypoint lane. */
  spawnGround(opts: AiGroundSpawnOptions): AiFriendlyVehicle {
    const spawnPos = toVec3(opts.spawn, 0);
    spawnPos.y = groundAt(this.ctx, spawnPos.x, spawnPos.y, spawnPos.z);

    const wps = opts.waypoints.map(w => {
      const v = toVec3(w, spawnPos.y);
      v.y = groundAt(this.ctx, v.x, v.y, v.z);
      return v;
    });

    const first = wps[0];
    const yaw = first ? Math.atan2(first.x - spawnPos.x, first.z - spawnPos.z) : 0;

    // If caller specified a gateWaypointIndex and never opened the lane yet, start that gate closed.
    if (opts.gateWaypointIndex !== undefined && !this.laneGates.has(opts.laneId)) {
      this.laneGates.set(opts.laneId, false);
    }

    const unit = new AiFriendlyVehicle(this.ctx, this, this.materials, opts.kind, 'ground', spawnPos, yaw, {
      id: opts.id,
      laneId: opts.laneId,
      hpOverride: opts.hpOverride,
      speedScale: opts.speedScale,
      label: opts.label,
      onDestroyed: opts.onDestroyed,
    });
    const gateIdx = opts.gateWaypointIndex ?? Math.min(1, Math.max(0, wps.length - 1));
    unit.configureGround(wps, gateIdx);
    this.units.push(unit);
    return unit;
  }

  /** Spawns a friendly AI `valkyrie` transport helicopter that flies to an LZ, fast-ropes `ctx.allies`, and banks out. */
  spawnValkyrie(opts: AiValkyrieSpawnOptions): AiFriendlyVehicle {
    const from = toVec3(opts.approachFrom, 45);
    const lz = toVec3(opts.lzPos, 0);
    const yaw = Math.atan2(lz.x - from.x, lz.z - from.z);

    const unit = new AiFriendlyVehicle(this.ctx, this, this.materials, 'valkyrie', 'transport', from, yaw, {
      id: opts.id,
      lzId: opts.lzId ?? null,
      hpOverride: opts.hpOverride,
      label: opts.label ?? 'VALKYRIE TRANSPORT',
      onDestroyed: opts.onDestroyed,
    });
    unit.configureValkyrie(opts);
    this.units.push(unit);
    return unit;
  }

  /** Spawns a friendly AI `kestrel` attack gunship that orbits a target zone and strafes enemies. */
  spawnKestrel(opts: AiKestrelSpawnOptions): AiFriendlyVehicle {
    const spawn = toVec3(opts.spawn, opts.orbitAltitude ?? 32);
    const center = toVec3(opts.orbitCenter, 0);
    const yaw = Math.atan2(center.x - spawn.x, center.z - spawn.z);

    const unit = new AiFriendlyVehicle(this.ctx, this, this.materials, 'kestrel', 'gunship', spawn, yaw, {
      id: opts.id,
      hpOverride: opts.hpOverride,
      label: opts.label ?? 'KESTREL CAS',
      onDestroyed: opts.onDestroyed,
    });
    unit.configureKestrel(opts);
    this.units.push(unit);
    return unit;
  }

  /**
   * Returns all live friendly ground vehicles (and optionally choppers) in a reused array
   * compatible with `VehicleSystem.setFriendlyVehicles(() => fleet.getLiveGroundTargets())`.
   */
  getLiveGroundTargets(includeAirborne = false): readonly FriendlyGroundTarget[] {
    this.groundTargetCache.length = 0;
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]!;
      if (!u.alive || u.disposed) continue;
      if (u.airborne && !includeAirborne) continue;
      this.groundTargetCache.push(u);
    }
    return this.groundTargetCache;
  }

  /** Returns a snapshot of all live friendly AI vehicles (ground + air). */
  getLiveAll(): AiFriendlyVehicle[] {
    return this.units.filter(u => u.alive && !u.disposed);
  }

  /** Finds a managed unit by ID. */
  getById(id: string): AiFriendlyVehicle | undefined {
    return this.units.find(u => u.id === id);
  }

  /** Applies enemy blast damage (e.g., mortar shells, artillery) to live friendly AI vehicles. */
  applyEnemyBlast(center: THREE.Vector3, radius: number, damage: number, source = 'vehicle_blast'): number {
    let hits = 0;
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]!;
      if (!u.alive || u.disposed) continue;
      const reach = radius + (u.armored ? 3.2 : 2.0);
      const d = u.position.distanceTo(center);
      if (d > reach) continue;
      const falloff = clamp(1 - (d / Math.max(0.5, reach)) * 0.72, 0.25, 1);
      u.takeDamage(damage * falloff, center, source);
      hits++;
    }
    return hits;
  }

  /** Internal helper for Aegis cannon shells & Kestrel rockets to resolve explosive splash on enemy targets. */
  scheduleFriendlyShell(at: THREE.Vector3, radius: number, damage: number, delay: number, source: string): void {
    this.pendingShells.push({
      at: at.clone(),
      radius,
      damage,
      delay,
      source,
    });
  }

  private detonateFriendlyShell(s: PendingFriendlyShell): void {
    const { fx, audio } = this.ctx;
    fx?.explosion?.(s.at, { radius: s.radius, kind: 'shell', scale: 1.2 });
    audio?.play?.('rocket_explosion', { position: s.at, volume: 0.65, pitchJitter: 0.08 });

    const enemies = this.ctx.enemies as unknown as EnemyManager | undefined;
    if (!enemies) return;

    // 1. Splash enemy infantry (never hurts player or allies)
    if (typeof enemies.query === 'function') {
      const n = enemies.query(s.at, s.radius + 1.5, _enemyScratch);
      for (let i = 0; i < n; i++) {
        const e = _enemyScratch[i]!;
        if (!e.alive) continue;
        const d = e.center.distanceTo(s.at);
        const falloff = clamp(1 - (d / Math.max(0.5, s.radius + 1.5)) * 0.75, 0.25, 1);
        _v2.subVectors(e.center, s.at).normalize();
        _damageInfo.amount = s.damage * falloff;
        _damageInfo.type = 'explosive';
        _damageInfo.point.copy(e.center);
        _damageInfo.dir.copy(_v2);
        _damageInfo.force = 14 * falloff;
        _damageInfo.source = s.source;
        enemies.applyDamage(e, _damageInfo);
      }
    }

    // 2. Splash enemy vehicles (real tank-vs-tank / gunship-vs-armor kills!)
    if (enemies.vehicles) {
      const spec: ExplosionSpec = {
        radius: s.radius,
        damage: s.damage,
        kind: 'shell',
        source: s.source,
        team: 'player',
      };
      enemies.vehicles.blast(s.at, spec);
    }
  }

  update(dt: number): void {
    // Tick scheduled friendly tank shells & Kestrel rockets
    for (let i = this.pendingShells.length - 1; i >= 0; i--) {
      const s = this.pendingShells[i]!;
      s.delay -= dt;
      if (s.delay > 0) continue;
      this.pendingShells.splice(i, 1);
      this.detonateFriendlyShell(s);
    }

    // Update all active friendly vehicles
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i]!;
      if (u.disposed) {
        this.units.splice(i, 1);
        continue;
      }
      u.update(dt);
    }
  }

  clear(): void {
    for (const u of this.units) u.dispose();
    this.units.length = 0;
    this.pendingShells.length = 0;
    this.laneGates.clear();
    this.groundTargetCache.length = 0;
  }

  dispose(): void {
    this.clear();
  }
}
