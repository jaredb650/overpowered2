/**
 * A single live player-driveable vehicle across all 10 fleet chassis:
 *   Jackal, Nomad Quad, Razor Moto, Viper Lance Skiff, Aegis MBT, Bastion 6x6,
 *   Kestrel Gunship, Valkyrie Door-Gunner, Harrier VTOL Jump-Jet, and A-10 Warthog.
 *
 * Handles:
 *   - Smooth damped 3P chase camera & calibrated 1P cockpit/gunner views (zero Shift stutter, zero face-clipping).
 *   - Desert-Raid-style 3D mounted guns (`HYBRID_HMG_AGL`, `M134`, `VULCAN_AA`), Kestrel FLIR Thermal Cam,
 *     Fighter Jet green HUD telemetry (CCIP live bomb impact point, missile lock-on, pitch ladder),
 *     AA Lead-Computing reticle pips, and Quad/Moto passenger hand-held weapons!
 *   - Real Kinematic Position-Based Rapier RigidBody hull (`CG.Ragdoll` membership) so active ragdolls,
 *     gibs, and debris physically bounce off the bumper and roll over the hood & windshield (GTA physics!).
 *   - Tiered speed-based roadkill (low-med non-gib hood vault, high-speed side-clipped limb dismemberment,
 *     extreme-speed/heavy-armor gib), high-speed wall/ground/vehicle crashes, kamikaze ramming, and pushable wrecks.
 *   - Viper chargeable Particle Lance beam, Harrier/Warthog VTOL toggle + boresight guns + gravity bombs +
 *     3-mode `[R]` ordnance cycling, and incoming enemy missile lock warnings + `[Q]` IR flare/smoke countermeasures.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CG, type Ctx, type PlayerDamage, type RayHit } from '../../core/contracts';
import type { EnemyInstance, MissileTarget, VehicleRadarTarget } from '../../core/gameplay';
import { clamp, damp, dampAngle, rand, randomInCone, wrapAngle } from '../../core/math';
import type { GoreRegion } from '../../characters/rig';
import type { ModelMaterials } from '../../progression/modelkit';
import { Gun, M134, type GunSpec } from '../guns';
import { GunnerSeat, type SeatPlan, type SeatRig } from '../seat';
import { VehicleVision } from '../vision';
import { VehicleAudioController, type VehicleAudioTelemetry } from './audio';
import { DRIVE_VEHICLES } from './data';
import { HYBRID_HMG_AGL, VULCAN_AA } from './guns';
import { buildVehicleModel, type VehicleModelRig } from './models';
import { mountOfVehicle, type OrdnanceEventKind } from '../../enemies/aiWorld';
import { createPhysicsState, stepVehiclePhysics } from './physics';
import { animateRider, setRiderAccent } from './riders';
import type {
  DriveVehicleDef,
  DriveVehicleId,
  VehicleHudData,
  VehicleInput,
  VehicleMountGun,
  VehiclePhysicsState,
  VehicleSeatSpec,
  VehicleWeaponKind,
  VehicleWeaponSpec,
} from './types';

interface WeaponRuntime {
  ammo: number;
  cooldown: number;
  reloadLeft: number;
  /** 0 = base mode, 1 = altMode, 2 = thirdMode (cycled via `[R]`). */
  modeIndex: number;
}

const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };
const _aim = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _target = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _right = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _up = new THREE.Vector3(0, 1, 0);
const _ccipPos = new THREE.Vector3();
const _ccipVel = new THREE.Vector3();
const _enemies: EnemyInstance[] = [];
const _paintTargets: MissileTarget[] = [];
const _radarTargets: VehicleRadarTarget[] = [];
const _hlLit: THREE.Object3D[] = [];
const _bumperBoxPos = new THREE.Vector3();
const _bumperImp = new THREE.Vector3();
const _bumperBodyT = new THREE.Vector3();

const ROADKILL_INTERVAL = 0.05;
const SMOKE_INTERVAL = 0.14;
const RESUPPLY_INTERVAL = 1.4;
const RESUPPLY_RADIUS = 14;
const AUTO_TURRET_RANGE = 68;
const MAX_LEAD_PIPS = 6;
const HOLD_R_SWITCH_SECONDS = 0.35;

export type VehicleDamageKind = 'light' | 'heavy' | 'crash';

const HEAVY_DAMAGE_SOURCE =
  /missile|rocket|aam|sam|cannon|bomb|mortar|shell|flak|blast|explod|atgm|artillery|howitzer|rail|lance|nuke|strike/i;

function classifyVehicleDamage(damage: PlayerDamage): VehicleDamageKind {
  if (damage.type === 'explosive' || damage.type === 'crush') return 'heavy';
  if (damage.source && HEAVY_DAMAGE_SOURCE.test(damage.source)) return 'heavy';
  return 'light';
}

const MOUNT_SPECS: Readonly<Record<VehicleMountGun, GunSpec>> = {
  hybrid: HYBRID_HMG_AGL,
  m134: M134,
  vulcan: VULCAN_AA,
};

let nextDriveUid = 1;

export class DriveableVehicle {
  readonly uid = nextDriveUid++;
  readonly def: DriveVehicleDef;
  readonly model: VehicleModelRig;
  readonly phys: VehiclePhysicsState;

  health: number;
  alive = true;
  /** Optional Motor Pool slot tag (so Badlands can replace lost staged vehicles between waves). */
  readonly poolSlot: string | null;
  /** Co-op: true when a teammate is currently driving this Motor Pool vehicle (hidden & non-colliding locally). */
  remoteHidden = false;

  private seat: GunnerSeat | null = null;
  private _seatIndex = 0;
  private thirdPerson = true;
  private aimYaw = 0;
  private aimPitch = -0.06;
  private turretYaw = 0;
  private turretPitch = 0;
  private heat = 0;
  private overheated = false;
  private camDistCurrent = 7.4;
  private camFovCurrent = 76;
  private readonly primaryState: WeaponRuntime[] = [];
  private readonly secondaryState: (WeaponRuntime | null)[] = [];
  private podFlip = false;
  private gunnerZoomed = false;
  private secondarySelected = false;
  private reloadHold = -1;

  // Viper chargeable Particle Lance state.
  private lanceCharge = 0;
  private lanceHeld = false;

  // Mounted 1P 3D gun (Desert-Raid style: Jackal Hybrid, Valkyrie M134, Bastion Vulcan).
  private readonly mountGuns = new Map<VehicleMountGun, Gun>();
  private activeMountGun: Gun | null = null;

  // Specials, IR Flares / Smoke countermeasure & Missile Warning state.
  private specialActive = false;
  private specialRemaining = 0;
  private specialCooldown = 0;
  private flareRemaining = 0;
  private flareCooldown = 0;
  private bombBayHold = 0;
  private bombBayOpen = 0;
  private missileWarning = false;
  private radarLockWarning = false;
  private extRwrLock = false;
  private extRwrLockStrength = 0;
  private extRwrMissile = false;
  private extRwrLabel = '';
  private extRwrTimer = 0;
  private warningBeepTimer = 0;
  private autoTurretCooldown = 0;
  private autoAglCooldown = 0;
  private resupplyTimer = 0;
  private roadkillTimer = 0;
  private ramVehicleCooldown = 0;
  private wallCrashCooldown = 0;
  private smokeTimer = 0;
  private dustTimer = 0;
  private crashAudioCooldown = 0;
  private bumpAudioCooldown = 0;
  private lightHitAudioCooldown = 0;
  private heavyHitAudioCooldown = 0;
  private lanceChargeBeep = 0;
  private wasBoosting = false;
  private wasAbandonedFall = false;
  private prevTurretYaw = 0;
  private readonly engineAudio: VehicleAudioController;
  /** Occupant IDs per seat (`'local'` for local player, peer/AI IDs for co-op passengers & gunners). */
  private readonly seatOccupants: (string | null)[];
  /** Co-op multi-crew: >= 0 when this vehicle is driven by a remote teammate (`slot`) and we ride as gunner/passenger. */
  remoteDriverSlot = -1;
  /** Co-op multi-crew: host-arbitrated seat swap request hook (returns false when deferred to host). */
  onRequestSeatSwap: ((targetSeat: number) => boolean) | null = null;
  /** Co-op multi-crew: invoked when a passenger exits a remote-driven vehicle so Driveables cleans up. */
  onCrewExit: (() => void) | null = null;
  /** When true, manual bail-out via the interact key (`E`) is disabled (e.g. airborne campaign missions). */
  exitLocked = false;
  private exitLockFeedCooldown = 0;
  private remoteGunnerSeat = -1;
  private remoteGunnerYaw = 0;
  private remoteGunnerPitch = 0;
  private keyCPressed = false;
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'KeyC' && !e.repeat && this.occupied) {
      this.keyCPressed = true;
    }
  };

  // Parked static hull collider (blocks bullets/player walk when unoccupied).
  private collider: RAPIER.Collider | null = null;
  // Moving Kinematic Position-Based Rapier RigidBody (CG.Ragdoll membership -> GTA ragdoll-vehicle physics!).
  private kinBody: RAPIER.RigidBody | null = null;
  private kinCollider: RAPIER.Collider | null = null;
  private bumperShape: RAPIER.Cuboid | null = null;

  private readonly damageIntercept = (damage: PlayerDamage): boolean =>
    this.absorbDamage(damage.amount, damage.from, false, classifyVehicleDamage(damage));
  private readonly inputScratch: VehicleInput = {
    throttle: 0,
    steer: 0,
    climb: 0,
    boost: false,
    handbrake: false,
    firePrimary: false,
    fireSecondary: false,
    aimHeld: false,
    specialPressed: false,
    reloadPressed: false,
    reloadHeld: false,
    cameraTogglePressed: false,
    lookX: 0,
    lookY: 0,
    targetAimYaw: 0,
    targetAimPitch: 0,
  };
  private readonly hudScratch: { -readonly [K in keyof VehicleHudData]: VehicleHudData[K] };
  private readonly ccipOut: [number, number, number] = [0, 0, 0];
  private readonly gunPipOut: [number, number, number] = [0, 0, 0];
  private readonly lockOut: [number, number, number] = [0, 0, 0];
  private readonly leadPipPool: [number, number, number][] = Array.from({ length: MAX_LEAD_PIPS }, () => [0, 0, 0]);
  private readonly leadPipsOut: [number, number, number][] = [];
  private currentLockTarget: MissileTarget | null = null;
  private prevLockTarget: MissileTarget | null = null;
  private currentLockLabel = '';

  private readonly rammedCooldown = new Map<number, number>();
  private dumpBurnWakeTimer = 0;
  private cobraVaporTimer = 0;
  private lastOrdnanceEmitAt = -10;
  private clock = 0;
  private mouseIdleTimer = 0;
  private disposed = false;

  constructor(
    private readonly ctx: Ctx,
    private readonly materials: ModelMaterials,
    private readonly seats: SeatRig,
    private readonly holster: () => void,
    id: DriveVehicleId,
    position: THREE.Vector3,
    yaw: number,
    opts?: { velocity?: THREE.Vector3; healthFraction?: number; poolSlot?: string | null; exitLocked?: boolean },
  ) {
    this.def = DRIVE_VEHICLES[id];
    this.poolSlot = opts?.poolSlot ?? null;
    this.exitLocked = Boolean(opts?.exitLocked);
    this.health = Math.round(this.def.maxHealth * clamp(opts?.healthFraction ?? 1, 0.25, 1));
    this.phys = createPhysicsState(position, yaw, opts?.velocity);
    this.aimYaw = yaw;
    this.camDistCurrent = this.def.seats[0]!.chaseDist || 7.4;
    this.engineAudio = new VehicleAudioController(ctx, this.def);
    this.seatOccupants = this.def.seats.map(() => null);
    this.model = buildVehicleModel(id, materials);
    this.model.root.name = `drive.${id}.${this.uid}`;
    ctx.render.scene.add(this.model.root);

    // Initialize weapon magazines per seat.
    for (const s of this.def.seats) {
      this.primaryState.push({ ammo: s.primary.magSize, cooldown: 0, reloadLeft: 0, modeIndex: 0 });
      this.secondaryState.push(s.secondary ? { ammo: s.secondary.magSize, cooldown: 0, reloadLeft: 0, modeIndex: 0 } : null);
    }

    // Static hull collider while parked so bullets spark off it and players don't walk through it.
    if (ctx.physics?.addStaticBox) {
      const half = new THREE.Vector3(this.def.halfWidth * 0.9, this.def.halfHeight * 0.85, this.def.halfLength * 0.9);
      const center = position.clone().setY(position.y + this.def.halfHeight);
      this.collider = ctx.physics.addStaticBox(center, half, null, 'metal');
    }

    // Kinematic Rapier rigid body with CG.Ragdoll membership so active ragdolls, gibs & debris physically
    // bounce off the bumper and roll over the hood/windshield WITHOUT blocking CG.World rays or camera!
    const R = ctx.physics?.R;
    const pWorld = ctx.physics?.world;
    if (R && pWorld && typeof R.RigidBodyDesc?.kinematicPositionBased === 'function') {
      try {
        const kDesc = R.RigidBodyDesc.kinematicPositionBased().setTranslation(
          position.x,
          position.y + this.def.halfHeight * 0.72,
          position.z,
        );
        this.kinBody = pWorld.createRigidBody(kDesc);
        const ragGroup = ((CG.Ragdoll & 0xffff) << 16) | ((CG.Ragdoll | CG.Gib | CG.Debris) & 0xffff);
        const cDesc = R.ColliderDesc.cuboid(
          this.def.halfWidth * 0.96,
          this.def.halfHeight * 0.68,
          this.def.halfLength * 0.96,
        )
          .setCollisionGroups(ragGroup)
          .setFriction(0.32)
          .setRestitution(0.28);
        this.kinCollider = pWorld.createCollider(cDesc, this.kinBody);
        this.bumperShape = new R.Cuboid(
          this.def.halfWidth * 1.12,
          this.def.halfHeight * 0.82,
          this.def.halfLength * 1.08,
        );
      } catch {
        this.kinBody = null;
        this.kinCollider = null;
        this.bumperShape = null;
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
    }

    this.hudScratch = {
      id: this.def.id,
      name: this.def.name,
      hudMode: this.def.seats[0]!.hudMode,
      seatIndex: 0,
      seatCount: this.def.seats.length,
      seatName: this.def.seats[0]!.name,
      speedKmh: 0,
      boost: 1,
      boosting: false,
      specialLabel: this.def.special.name,
      specialReady: true,
      specialActive: false,
      specialFraction: 1,
      ammoMode: '',
      cameraLabel: '3P',
      deployed: false,
      chargeFraction: 0,
      missileWarning: false,
      vtolMode: true,
      pitchRad: 0,
      rollRad: 0,
      altitudeM: 0,
      ccipWorld: null,
      ccipLabel: 'CCIP HE',
      gunPipWorld: null,
      lockWorld: null,
      lockLabel: '',
      leadPips: this.leadPipsOut,
    };

    this.syncTransform();
  }

  get occupied(): boolean {
    return this.seat !== null && this.seats.seat === this.seat;
  }

  /** True while IR Flares or IR Smoke are active — read by `Projectiles.ts` to spoof incoming homing missiles! */
  get isCountermeasureActive(): boolean {
    if (this.flareRemaining > 0) return true;
    return this.specialActive && (this.def.special.id === 'flares' || this.def.special.id === 'smoke');
  }

  get seatIndex(): number {
    return this._seatIndex;
  }

  get position(): THREE.Vector3 {
    return this.phys.position;
  }

  get velocity(): THREE.Vector3 {
    return this.phys.velocity;
  }

  get speed(): number {
    return this.phys.speed;
  }

  get yaw(): number {
    return this.phys.yaw;
  }

  get deployed(): boolean {
    return this.phys.deployed;
  }

  get activeSeatSpec(): VehicleSeatSpec {
    return this.def.seats[this._seatIndex]!;
  }

  get zoomed(): boolean {
    return this.gunnerZoomed;
  }

  get secondaryModeSelected(): boolean {
    return this.secondarySelected;
  }

  get audioTelemetry(): VehicleAudioTelemetry {
    return this.engineAudio.telemetry;
  }

  /** Number of currently occupied seats (local player + any co-op / AI riders). */
  get occupiedSeatCount(): number {
    let count = 0;
    for (const occ of this.seatOccupants) {
      if (occ !== null) count++;
    }
    return count;
  }

  /** Remaining open seats available for co-op teammates or AI gunners. */
  get openSeatCount(): number {
    return Math.max(0, this.def.seats.length - this.occupiedSeatCount);
  }

  /** Returns the occupant ID (`'local'`, remote player ID, AI ID, or `null`) in `seatIndex`. */
  getSeatOccupant(seatIndex: number): string | null {
    return this.seatOccupants[seatIndex] ?? null;
  }

  /**
   * Assigns or clears a visible rider in `seatIndex` (used locally on board/seat-swap and ready for
   * co-op replication & AI squadmates). Optionally tints the rider's tactical visor & shoulder stripes.
   */
  setSeatOccupant(seatIndex: number, occupantId: string | null, accentColor?: string): void {
    if (seatIndex < 0 || seatIndex >= this.seatOccupants.length) return;
    this.seatOccupants[seatIndex] = occupantId;
    if (accentColor) {
      for (const r of this.model.riders) {
        if (r.seatIndex === seatIndex) setRiderAccent(r, accentColor);
      }
    }
    this.syncRiderModels();
  }

  /** Co-op multi-crew: true while this vehicle's hull is driven by a remote teammate (`remoteDriverSlot`). */
  get isRemoteDriven(): boolean {
    return this.remoteDriverSlot >= 0;
  }

  /** Co-op multi-crew: current seat index and turret yaw/pitch for gunner aim broadcast (`drvg`). */
  get localTurretAim(): { seat: number; yaw: number; pitch: number } {
    const yaw = this.activeSeatSpec.usesTurret || this.activeSeatSpec.usesSubTurret
      ? this.turretYaw
      : wrapAngle(this.aimYaw - this.phys.yaw);
    return { seat: this._seatIndex, yaw, pitch: this.aimPitch };
  }

  /**
   * Co-op multi-crew: syncs remote crew riders into `seatOccupants` (preserving `'local'` in our own seat)
   * and updates visible tinted 3D rider models on this vehicle.
   */
  setCrewOccupants(entries: readonly [number, string, string | undefined][]): void {
    const nextMap = new Map<number, { id: string; color?: string }>();
    for (const [seatIdx, id, color] of entries) {
      if (seatIdx >= 0 && seatIdx < this.seatOccupants.length) {
        nextMap.set(seatIdx, { id, color });
      }
    }
    for (let i = 0; i < this.seatOccupants.length; i++) {
      if (this.occupied && i === this._seatIndex) {
        this.seatOccupants[i] = 'local';
        continue;
      }
      const entry = nextMap.get(i);
      this.seatOccupants[i] = entry ? entry.id : null;
      if (entry?.color) {
        for (const r of this.model.riders) {
          if (r.seatIndex === i) setRiderAccent(r, entry.color);
        }
      }
    }
    if (this.remoteGunnerSeat >= 0 && !nextMap.has(this.remoteGunnerSeat)) {
      this.remoteGunnerSeat = -1;
    }
    this.syncRiderModels();
  }

  /**
   * Co-op multi-crew: smoothly drives this passenger-ridden vehicle's hull from the remote driver's
   * interpolated pose stream (`drv`) without running conflicting local hull physics.
   */
  applyRemoteHullPose(
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
    roll: number,
    steer: number,
    wheelSpin: number,
    rotorAngle: number,
    wingSweep: number,
    flags: number,
    dt: number,
    driverTurretYaw?: number,
    driverTurretPitch?: number,
  ): void {
    const p = this.phys;
    const prevX = p.position.x;
    const prevY = p.position.y;
    const prevZ = p.position.z;
    p.position.set(x, y, z);
    if (dt > 0.001) {
      const dx = x - prevX;
      const dy = y - prevY;
      const dz = z - prevZ;
      if (dx * dx + dy * dy + dz * dz < 40 * 40) {
        p.velocity.set(dx / dt, dy / dt, dz / dt);
        p.speed = Math.hypot(p.velocity.x, p.velocity.z);
      } else {
        p.velocity.set(0, 0, 0);
        p.speed = 0;
      }
    }
    p.yaw = yaw;
    p.pitch = pitch;
    p.roll = roll;
    p.steerAngle = steer;
    p.wheelSpin = wheelSpin;
    p.rotorAngle = rotorAngle;
    p.wingSweep = wingSweep;
    p.boosting = (flags & 1) !== 0;
    p.vtolMode = (flags & 2) !== 0;
    p.altitude = (flags & 4) !== 0 ? 0.5 : Math.max(4, y);
    p.deployed = (flags & 8) !== 0;
    p.deployAnim = damp(p.deployAnim, p.deployed ? 1 : 0, 6, Math.max(0.016, dt));
    p.dumpBurnTimer = (flags & 16) !== 0 ? 0.2 : 0;
    if ((flags & 32) !== 0 && this.health > this.def.maxHealth * 0.35) {
      this.health = Math.round(this.def.maxHealth * 0.3);
    }
    // If we're riding in a non-main-turret seat (e.g. Aegis cupola), show the driver's main turret turning!
    if (
      this._seatIndex !== 0
      && !this.activeSeatSpec.usesTurret
      && typeof driverTurretYaw === 'number'
      && typeof driverTurretPitch === 'number'
    ) {
      this.turretYaw = dampAngle(this.turretYaw, driverTurretYaw, 16, Math.max(0.016, dt));
      this.turretPitch = damp(this.turretPitch, driverTurretPitch, 16, Math.max(0.016, dt));
    }
  }

  /** Co-op multi-crew: rotates this vehicle's gunner turret on the driver's screen to match a remote gunner. */
  applyRemoteGunnerTurret(seatIndex: number, yaw: number, pitch: number): void {
    if (seatIndex < 1 || seatIndex >= this.def.seats.length) return;
    if (this.occupied && this._seatIndex === seatIndex) return;
    this.remoteGunnerSeat = seatIndex;
    this.remoteGunnerYaw = yaw;
    this.remoteGunnerPitch = pitch;
  }

  /**
   * Co-op multi-crew: seamlessly promotes a passenger to local driver/owner when the original driver bails
   * out of an intact vehicle (preventing mid-air drops and preserving hull momentum & Motor Pool slot).
   */
  promoteToDriver(takeDriverSeat = true): void {
    if (!this.isRemoteDriven) return;
    this.remoteDriverSlot = -1;
    this.onCrewExit = null;
    if (this.seatOccupants[0] !== 'local') this.seatOccupants[0] = null;
    if (takeDriverSeat && this.occupied && this._seatIndex !== 0) {
      this.switchSeat(0, true);
    } else {
      this.syncRiderModels();
      this.syncHud();
    }
    this.ctx.hud?.feed?.(`DRIVER BAILED — YOU HAVE CONTROL OF ${this.def.shortName}!`, '#38e8ff');
  }

  private syncRiderModels(): void {
    const is1P = this.occupied && (!this.thirdPerson || this.activeSeatSpec.chaseDist <= 0.5);
    for (const r of this.model.riders) {
      const occ = this.seatOccupants[r.seatIndex] ?? null;
      r.occupantId = occ;
      // Hide ONLY the local player's rider mesh while in 1P (never hide co-op teammates!).
      r.root.visible = occ !== null && !(is1P && occ === 'local' && r.seatIndex === this._seatIndex);
    }
  }

  private getOrBuildMountGun(kind: VehicleMountGun): Gun {
    let gun = this.mountGuns.get(kind);
    if (!gun) {
      gun = new Gun(this.materials, this.ctx.render.scene, MOUNT_SPECS[kind]);
      this.mountGuns.set(kind, gun);
    }
    return gun;
  }

  private applySeatVisuals(): void {
    const spec = this.activeSeatSpec;
    const is1P = !this.thirdPerson || spec.chaseDist <= 0.5;

    // Hide any previously active 3D mount gun.
    if (this.activeMountGun) {
      this.activeMountGun.hide();
      this.activeMountGun = null;
    }

    // Hide exterior canopy/turret parts in 1P so the camera NEVER clips into vehicle geometry!
    if (this.model.fpHideParts) {
      for (const p of this.model.fpHideParts) p.visible = !is1P;
    }
    const hideWholeBody = is1P && (
      spec.hudMode === 'thermal'
      || spec.hudMode === 'chopper'
      || (this.def.id === 'valkyrie' && spec.role === 'pilot')
      || this.def.id === 'warthog'
    );
    this.model.body.visible = !hideWholeBody;

    // Mount Desert-Raid-style 3D gun cleanly in 1P gunner seats.
    const usesMount = is1P && Boolean(spec.mountGun);
    if (this.model.turret) {
      const hiddenByFp = Boolean(this.model.fpHideParts?.includes(this.model.turret));
      this.model.turret.visible = !(is1P && hiddenByFp) && !(usesMount && spec.usesTurret);
    }
    if (this.model.subTurret) {
      this.model.subTurret.visible = !(is1P && spec.usesSubTurret);
    }
    if (usesMount && spec.mountGun) {
      this.activeMountGun = this.getOrBuildMountGun(spec.mountGun);
      this.activeMountGun.snap(wrapAngle(this.aimYaw - Math.PI), this.aimPitch);
      if (spec.holdRToggleSecondary) {
        this.activeMountGun.setActive(1, this.secondarySelected ? 1 : 0);
      }
    }

    // Apply or clear Kestrel FLIR Thermal optic filter cleanly via GunnerSeat.look()!
    if (this.seat) {
      if (spec.hudMode === 'thermal') {
        this.seat.boxes = false;
        this.seat.look('thermal', 'grayscale(1) contrast(1.22)', '#ffd9a0');
      } else if (spec.hudMode === 'chopper') {
        this.seat.boxes = true;
        this.seat.look(null, 'contrast(1.06) saturate(0.88)', '#ffb84d');
      } else {
        this.seat.boxes = true;
        this.seat.look(null, '', '#ff5a3a');
      }
    }

    // Enable player's actual hand-held weapons in Quad/Moto rear passenger seat!
    if (spec.passengerWeapons) {
      this.ctx.weapons?.setHolstered?.(false);
    } else if (this.occupied) {
      this.holster();
    }

    this.syncRiderModels();
  }

  private restoreVisualsOnExit(): void {
    if (this.activeMountGun) {
      this.activeMountGun.hide();
      this.activeMountGun = null;
    }
    if (this.model.fpHideParts) {
      for (const p of this.model.fpHideParts) p.visible = true;
    }
    this.model.body.visible = true;
    if (this.model.turret) {
      this.model.turret.visible = true;
    }
    if (this.model.subTurret) {
      this.model.subTurret.visible = true;
    }
    this.syncRiderModels();
  }

  /** Seats the local player in `seatIndex` (0 = Driver/Pilot) and hands control to this vehicle. */
  board(seatIndex = 0, fromHijack = false): boolean {
    if (!this.alive || this.occupied || this.seats.occupied) return false;
    this._seatIndex = clamp(seatIndex, 0, this.def.seats.length - 1);
    const spec = this.activeSeatSpec;
    this.thirdPerson = this._seatIndex === 0 && spec.chaseDist > 0.5;
    this.aimYaw = this.phys.yaw;
    this.aimPitch = this.def.category === 'jet' ? 0.02 : -0.06;
    this.camDistCurrent = spec.chaseDist || 7.4;
    this.camFovCurrent = this.thirdPerson ? 76 : 64;
    this.gunnerZoomed = false;
    this.secondarySelected = false;
    this.reloadHold = -1;
    this.keyCPressed = false;
    this.wasBoosting = false;
    this.wasAbandonedFall = false;
    this.phys.abandonedFall = false;

    // Move parked static collider underground so our own rays and camera pull-in never snag on our hull.
    this.setColliderParked(false);

    const plan = this.buildSeatPlan();
    const seat = new GunnerSeat(this.ctx, this.seats, plan);
    seat.hintText = this.buildHintText();
    this.seat = seat;
    if (!spec.passengerWeapons) this.holster();

    seat.fixed(this.phys.position);
    seat.noWayOut = this.exitLocked;
    seat.board();
    this.seatOccupants[this._seatIndex] = 'local';
    this.updateAimTarget();
    seat.sit(_target, _pivot);
    this.applySeatVisuals();

    this.ctx.player.interceptor = this.damageIntercept;
    this.ctx.audio?.play('veh_board', { position: this.phys.position, volume: 0.78, pitch: 1.0 });
    this.startEngine();
    this.syncHud();
    if (!fromHijack) {
      this.ctx.events?.emit?.('vehicle:boarded', {
        id: this.def.id,
        mount: mountOfVehicle(this.def.id),
        hijacked: false,
        viaGrapple: false,
        position: this.phys.position.clone(),
      });
    }
    return true;
  }

  /** Locks or unlocks manual bail-out via `[E]` and keeps the active seat HUD hint in sync. */
  setExitLocked(locked: boolean): void {
    this.exitLocked = locked;
    if (this.seat) {
      this.seat.noWayOut = locked;
      this.seat.hintText = this.buildHintText();
    }
  }

  /** Switches seats cleanly inside the same vehicle (`[F]` or `1`/`2`/`3`). */
  switchSeat(index: number, force = false): void {
    if (!this.occupied || !this.seat) return;
    const count = this.def.seats.length;
    const next = ((index % count) + count) % count;
    if (next === this._seatIndex) return;
    if (!force) {
      const occ = this.seatOccupants[next];
      if (occ !== null && occ !== 'local') {
        this.ctx.audio?.play('veh_seat_click', { position: this.phys.position, volume: 0.45, pitch: 0.65 });
        this.ctx.hud?.feed?.(`${this.def.seats[next]!.name} OCCUPIED`, '#ffb84d');
        return;
      }
      // Co-op multi-crew: let the host arbitrate seat swaps so two teammates never claim the same seat.
      if (this.onRequestSeatSwap && !this.onRequestSeatSwap(next)) {
        return;
      }
    }
    const prev = this._seatIndex;
    if (this.seatOccupants[prev] === 'local') this.seatOccupants[prev] = null;
    this._seatIndex = next;
    this.seatOccupants[next] = 'local';
    const spec = this.activeSeatSpec;
    this.thirdPerson = next === 0 && spec.chaseDist > 0.5;
    this.camDistCurrent = spec.chaseDist || 7.4;
    this.gunnerZoomed = false;
    this.secondarySelected = false;
    if (this.reloadHold >= 0) {
      this.reloadHold = -1;
      this.ctx.hud?.hold?.(0);
    }
    this.lanceCharge = 0;
    this.lanceHeld = false;
    this.seat.zoomed = false;
    this.seat.hintText = this.buildHintText();
    this.applySeatVisuals();
    this.ctx.audio?.play('veh_seat_click', { position: this.phys.position, volume: 0.78, pitch: 1.04 });
    this.ctx.hud?.feed?.(`${this.def.shortName} // ${spec.name}`, this.def.color);
    this.syncHud();
  }

  /** Cycles to the next open seat inside the vehicle (skipping seats occupied by co-op teammates). */
  private cycleOpenSeat(): void {
    const count = this.def.seats.length;
    for (let step = 1; step < count; step++) {
      const cand = (this._seatIndex + step) % count;
      const occ = this.seatOccupants[cand];
      if (occ === null || occ === 'local') {
        this.switchSeat(cand);
        return;
      }
    }
    this.ctx.hud?.feed?.('ALL OTHER SEATS OCCUPIED', '#ffb84d');
  }

  /** Exits cleanly beside the vehicle (preserving forward momentum for badass jump-offs!). */
  exit(quiet = false): void {
    if (!this.seat) return;
    const seat = this.seat;
    const crewExitCb = this.onCrewExit;
    const wasRemote = this.isRemoteDriven;
    this.seat = null;
    this.onCrewExit = null;
    this.remoteDriverSlot = -1;
    if (this.seatOccupants[this._seatIndex] === 'local') {
      this.seatOccupants[this._seatIndex] = null;
    }
    this.gunnerZoomed = false;
    this.secondarySelected = false;
    if (this.reloadHold >= 0) {
      this.reloadHold = -1;
      this.ctx.hud?.hold?.(0);
    }
    this.lanceCharge = 0;
    this.lanceHeld = false;
    this.missileWarning = false;
    this.wasBoosting = false;
    this.restoreVisualsOnExit();
    if (this.ctx.player.interceptor === this.damageIntercept) {
      this.ctx.player.interceptor = null;
    }

    const exitOffset = this.def.halfWidth + 1.45;
    const rx = Math.cos(this.phys.yaw);
    const rz = -Math.sin(this.phys.yaw);
    const ex = this.phys.position.x + rx * exitOffset;
    const ez = this.phys.position.z + rz * exitOffset;
    const navY = this.ctx.world?.nav?.groundHeight?.(ex, this.phys.position.y + 2.5, ez);
    const airborneExit = (this.def.category === 'helicopter' || this.def.category === 'jet') && this.phys.altitude > 2.5;
    const ey = airborneExit
      ? this.phys.position.y
      : (typeof navY === 'number' && Number.isFinite(navY) ? navY : this.phys.groundY);
    this.ctx.player.carry(_origin.set(ex, ey, ez));

    seat.vehicleHud = null;
    seat.leave(quiet);

    if (!quiet && this.phys.speed > 6) {
      _vel.set(this.phys.velocity.x * 0.65, this.def.category === 'hover' || this.def.category === 'moto' ? 5.5 : 3.2, this.phys.velocity.z * 0.65);
      this.ctx.player.push(_vel);
    }

    if (this.alive && !wasRemote) this.setColliderParked(true);
    // Keep aircraft engine roaring while an abandoned chopper/jet spirals down; otherwise smoothly spin down!
    if (wasRemote || (!airborneExit && this.occupiedSeatCount === 0)) {
      this.engineAudio.shutdown();
    }
    crewExitCb?.();
  }

  /** Applies damage to the vehicle hull (directional armor, Bastion deployed resistance & kamikaze detonation). */
  absorbDamage(
    amount: number,
    from?: THREE.Vector3,
    kamikaze = false,
    kind?: VehicleDamageKind,
    playSound = true,
  ): boolean {
    if (!this.alive || amount <= 0) return true;
    let mult = 1;
    if (from) {
      const dx = from.x - this.phys.position.x;
      const dz = from.z - this.phys.position.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.01) {
        const fx = Math.sin(this.phys.yaw);
        const fz = Math.cos(this.phys.yaw);
        const dot = (dx * fx + dz * fz) / len;
        mult = dot > 0.45 ? this.def.armor.front : dot < -0.45 ? this.def.armor.rear : this.def.armor.side;
      }
    }
    if (this.phys.deployed && this.def.id === 'bastion') mult *= 0.6;
    if (this.isCountermeasureActive) mult *= 0.65;

    const dealt = amount * mult;
    this.health = Math.max(0, this.health - dealt);

    const heavy =
      kind === 'heavy' ||
      kind === 'crash' ||
      (kind === 'light'
        ? dealt >= 95 || dealt >= this.def.maxHealth * 0.14
        : dealt >= 45 || dealt >= this.def.maxHealth * 0.085);

    if (this.occupied) {
      this.ctx.camera?.addTrauma?.(clamp(dealt * (heavy ? 0.011 : 0.008), heavy ? 0.14 : 0.06, 0.48));
    }
    if (playSound) {
      if (heavy) {
        if (this.heavyHitAudioCooldown <= 0) {
          this.heavyHitAudioCooldown = 0.18;
          if (this.occupied) {
            this.ctx.audio?.play('veh_hit_heavy', {
              volume: clamp(0.84 + dealt * 0.003, 0.84, 1.0),
              pitch: rand(0.92, 1.08),
            });
          } else {
            this.ctx.audio?.play('veh_hit_heavy', {
              position: this.phys.position,
              volume: 0.72,
              pitch: rand(0.92, 1.08),
            });
          }
        }
      } else if (this.lightHitAudioCooldown <= 0) {
        this.lightHitAudioCooldown = 0.085;
        if (this.occupied) {
          this.ctx.audio?.play('veh_hit_light', {
            volume: clamp(0.74 + dealt * 0.008, 0.74, 1.0),
            pitch: rand(0.94, 1.08),
          });
        } else {
          this.ctx.audio?.play('veh_hit_light', {
            position: this.phys.position,
            volume: 0.56,
            pitch: rand(0.94, 1.08),
          });
        }
      }
    }
    if (this.health <= 0) {
      this.explodeAndDestroy(kamikaze || this.phys.speed >= 18);
    }
    return true;
  }

  /** Per-frame update (runs whether occupied or parked so coasting, outriggers, auto-turret & resupply keep working). */
  update(dt: number): void {
    if (!this.alive || this.disposed || dt <= 0) return;
    this.clock += dt;
    if (this.crashAudioCooldown > 0) this.crashAudioCooldown = Math.max(0, this.crashAudioCooldown - dt);
    if (this.bumpAudioCooldown > 0) this.bumpAudioCooldown = Math.max(0, this.bumpAudioCooldown - dt);
    if (this.lightHitAudioCooldown > 0) this.lightHitAudioCooldown = Math.max(0, this.lightHitAudioCooldown - dt);
    if (this.heavyHitAudioCooldown > 0) this.heavyHitAudioCooldown = Math.max(0, this.heavyHitAudioCooldown - dt);
    if (this.ramVehicleCooldown > 0) this.ramVehicleCooldown = Math.max(0, this.ramVehicleCooldown - dt);
    if (this.wallCrashCooldown > 0) this.wallCrashCooldown = Math.max(0, this.wallCrashCooldown - dt);
    if (this.autoAglCooldown > 0) this.autoAglCooldown = Math.max(0, this.autoAglCooldown - dt);
    if (this.exitLockFeedCooldown > 0) this.exitLockFeedCooldown = Math.max(0, this.exitLockFeedCooldown - dt);
    if (this.flareRemaining > 0) this.flareRemaining = Math.max(0, this.flareRemaining - dt);
    if (this.flareCooldown > 0) this.flareCooldown = Math.max(0, this.flareCooldown - dt);
    if (this.bombBayHold > 0) this.bombBayHold = Math.max(0, this.bombBayHold - dt);
    const bayTarget = this.bombBayHold > 0 ? 1 : 0;
    this.bombBayOpen = damp(this.bombBayOpen, bayTarget, bayTarget > 0 ? 14 : 4.5, dt);
    if (bayTarget === 0 && this.bombBayOpen < 0.002) this.bombBayOpen = 0;

    if (this.seat && (this.seat.stage === 'left' || this.seats.seat !== this.seat)) {
      this.exit(true);
    }

    const occupied = this.occupied;
    const remoteDriven = this.isRemoteDriven;
    this.readInput(occupied);

    if (occupied) {
      if (this.ctx.input.pressed('interact')) {
        if (!this.exitLocked) {
          this.exit(false);
          return;
        }
        if (this.exitLockFeedCooldown <= 0) {
          this.exitLockFeedCooldown = 1.6;
          this.ctx.audio?.play?.('veh_seat_click', { position: this.phys.position, volume: 0.4, pitch: 0.6 });
          this.ctx.hud?.feed?.('CANOPY LOCKED — STAY ON MISSION!', '#ffb84d');
        }
      }
      if (this.inputScratch.cameraTogglePressed && this.activeSeatSpec.chaseDist > 0.5) {
        this.thirdPerson = !this.thirdPerson;
        this.applySeatVisuals();
      }
      if (this.ctx.input.pressed('melee') && this.def.seats.length > 1) {
        this.cycleOpenSeat();
      } else if (!this.activeSeatSpec.passengerWeapons) {
        // Only intercept 1/2/3 seat swaps when NOT using hand-held passenger weapons!
        if (this.ctx.input.pressed('weapon1') && this.def.seats.length >= 1) this.switchSeat(0);
        else if (this.ctx.input.pressed('weapon2') && this.def.seats.length >= 2) this.switchSeat(1);
        else if (this.ctx.input.pressed('weapon3') && this.def.seats.length >= 3) this.switchSeat(2);
      }
      this.updateMouseLook(dt);
    }

    // Feed mouse aim angles into physics so Jet Mach flight has ONE unified smooth controller (zero dual-mutation stutter!).
    this.inputScratch.targetAimYaw = this.aimYaw;
    this.inputScratch.targetAimPitch = this.aimPitch;

    if (!remoteDriven) {
      // Step physics (only driver/pilot seat feeds drive controls; gunners let vehicle coast or aircraft auto-hover;
      // completely abandoned airborne aircraft spiral and crash under gravity!).
      const driveActive = occupied && this._seatIndex === 0;
      const ownHandle = this.collider?.handle;
      stepVehiclePhysics(this.def, this.phys, this.inputScratch, dt, this.ctx.world, this.ctx.physics, driveActive, ownHandle, occupied);

      // Boost ignition whoosh on rising edge!
      if (occupied && this.phys.boosting && !this.wasBoosting) {
        this.ctx.audio?.play('veh_boost_whoosh', {
          position: this.phys.position,
          volume: this.def.category === 'jet' ? 0.9 : 0.72,
          pitch: this.def.category === 'jet' ? 1.05 : this.def.category === 'moto' ? 1.25 : 1.0,
        });
      }
      this.wasBoosting = occupied && this.phys.boosting;

      // Abandoned aircraft stricken alarm!
      if (this.phys.abandonedFall && !this.wasAbandonedFall) {
        this.wasAbandonedFall = true;
        this.ctx.audio?.play('gunship_stricken', { position: this.phys.position, volume: 0.9, pitch: 1.0 });
      } else if (!this.phys.abandonedFall) {
        this.wasAbandonedFall = false;
      }

      // Nose-to-camera steering synchronization per vehicle class!
      if (driveActive && this.def.category === 'helicopter') {
        this.phys.yaw = dampAngle(this.phys.yaw, this.aimYaw, 3.6, dt);
      } else if (driveActive && this.def.category === 'jet') {
        if (this.phys.vtolMode) {
          this.phys.yaw = dampAngle(this.phys.yaw, this.aimYaw, 4.2, dt);
        } else if (this.mouseIdleTimer > 0.25 && Math.abs(this.inputScratch.steer) > 0.05) {
          // When banking with keyboard A/D without moving the mouse, let camera smoothly track the nose.
          this.aimYaw = dampAngle(this.aimYaw, this.phys.yaw, 5.5, dt);
        }
      } else if (driveActive && (this.def.category === 'hover' || this.def.category === 'wheeled' || this.def.category === 'moto')) {
        if (this.mouseIdleTimer > 0.2 && Math.abs(this.phys.yawRate) > 0.01) {
          this.aimYaw = wrapAngle(this.aimYaw + this.phys.yawRate * dt * 0.85);
        }
        if (this.mouseIdleTimer > 0.85 && this.phys.speed > 4) {
          this.aimYaw = dampAngle(this.aimYaw, this.phys.yaw, 2.2, dt);
        }
      }

      // Sync Kinematic Rapier Body for real GTA ragdoll-vehicle physics!
      this.syncKinematicHull();

      // Handle high-speed wall/ground crashes, abandoned aircraft crashes, pushable wrecks & enemy-vehicle ramming!
      this.stepCrashAndRam(dt, occupied);
      if (!this.alive) return;

      this.stepSpecial(dt, occupied);
      this.stepWeapons(dt, occupied);
      this.stepAutoTurret(dt);
      this.stepResupplyAura(dt);
      this.stepRoadkill(dt);
    } else {
      // Passenger / Gunner riding a teammate's vehicle: full local weapon firing & turret aiming, zero hull conflict!
      this.stepWeapons(dt, occupied);
    }

    this.stepMissileWarning(dt, occupied);
    this.stepEffects(dt, occupied);
    this.syncTransform();

    const turretTurning = Math.abs(wrapAngle(this.turretYaw - this.prevTurretYaw)) > 0.006;
    this.prevTurretYaw = this.turretYaw;

    if (occupied && this.seat) {
      this.ctx.player.carry(this.phys.position);
      this.updateCamera(dt);
      this.updateTacticalOverlays();
      this.engineAudio.update(dt, this.phys, true, this.inputScratch, turretTurning, this.lanceCharge);
      this.syncHud();
    } else {
      this.engineAudio.update(dt, this.phys, false, null, false, 0);
      if (this.collider && !remoteDriven) {
        this.setColliderParked(true);
      }
    }
  }

  private readInput(occupied: boolean): void {
    const inp = this.inputScratch;
    inp.throttle = 0;
    inp.steer = 0;
    inp.climb = 0;
    inp.boost = false;
    inp.handbrake = false;
    inp.firePrimary = false;
    inp.fireSecondary = false;
    inp.aimHeld = false;
    inp.specialPressed = false;
    inp.reloadPressed = false;
    inp.reloadHeld = false;
    inp.cameraTogglePressed = false;
    inp.lookX = 0;
    inp.lookY = 0;
    if (!occupied) {
      this.keyCPressed = false;
      return;
    }

    const { input } = this.ctx;
    if (input.isDown('forward')) inp.throttle += 1;
    if (input.isDown('back')) inp.throttle -= 1;
    if (input.isDown('right')) inp.steer += 1;
    if (input.isDown('left')) inp.steer -= 1;
    if (input.isDown('jump')) {
      inp.climb += 1;
      inp.handbrake = true;
    }
    if (input.isDown('slide')) {
      inp.climb -= 1;
    }
    inp.boost = input.isDown('dash');
    // When using hand-held passenger weapons (Quad/Moto Seat 2), let Weapons.ts consume fire/aim/reload!
    const spec = this.activeSeatSpec;
    const handWeps = Boolean(spec.passengerWeapons);
    inp.firePrimary = !handWeps && input.isDown('fire');
    inp.aimHeld = !handWeps && input.isDown('aim');
    inp.fireSecondary = !handWeps && !spec.aimZooms && !spec.holdRToggleSecondary && inp.aimHeld;
    inp.specialPressed = input.pressed('stim');
    inp.reloadPressed = !handWeps && input.pressed('reload');
    inp.reloadHeld = !handWeps && input.isDown('reload');
    // Clean [C] view toggle (NO mouse-wheel accidental camera switching!).
    const isAir = this.def.category === 'helicopter' || this.def.category === 'jet';
    inp.cameraTogglePressed = this.keyCPressed || (!isAir && input.pressed('slide'));
    this.keyCPressed = false;
    inp.lookX = input.frameLook.x;
    inp.lookY = input.frameLook.y;
  }

  private updateMouseLook(dt: number): void {
    const { input, player } = this.ctx;
    const spec = this.activeSeatSpec;
    this.gunnerZoomed = Boolean(spec.aimZooms && this.inputScratch.aimHeld);
    const look = input.frameLook;
    if (Math.abs(look.x) > 0.001 || Math.abs(look.y) > 0.001) {
      this.mouseIdleTimer = 0;
    } else {
      this.mouseIdleTimer += dt;
    }
    const scale = player.sensitivity * player.lookScale * (this.gunnerZoomed ? 0.55 : 1);
    this.aimYaw = wrapAngle(this.aimYaw - look.x * scale);
    this.aimPitch = clamp(
      this.aimPitch - look.y * scale * (player.invertY ? -1 : 1),
      spec.pitchMin,
      spec.pitchMax,
    );

    const desiredRelYaw = wrapAngle(this.aimYaw - this.phys.yaw);
    if (Number.isFinite(spec.turretSlew)) {
      const diff = wrapAngle(desiredRelYaw - this.turretYaw);
      const maxStep = spec.turretSlew * dt;
      this.turretYaw = wrapAngle(this.turretYaw + clamp(diff, -maxStep, maxStep));
    } else {
      this.turretYaw = desiredRelYaw;
    }
    this.turretPitch = damp(this.turretPitch, this.aimPitch, 14, dt);
  }

  private updateAimTarget(): void {
    const spec = this.activeSeatSpec;
    _quat.setFromEuler(_euler.set(this.phys.pitch, this.phys.yaw, this.phys.roll));
    _pivot.set(spec.chaseOffset[0], spec.chaseOffset[1], spec.chaseOffset[2])
      .applyQuaternion(_quat)
      .add(this.phys.position);

    const cp = Math.cos(this.aimPitch);
    _aim.set(Math.sin(this.aimYaw) * cp, Math.sin(this.aimPitch), Math.cos(this.aimYaw) * cp);
    _target.copy(_pivot).addScaledVector(_aim, 120);
  }

  private updateCamera(dt: number): void {
    const seat = this.seat;
    if (!seat) return;
    const spec = this.activeSeatSpec;
    _quat.setFromEuler(_euler.set(this.phys.pitch, this.phys.yaw, this.phys.roll));

    const is1P = !this.thirdPerson || spec.chaseDist <= 0.5;
    const cp = Math.cos(this.aimPitch);
    _aim.set(Math.sin(this.aimYaw) * cp, Math.sin(this.aimPitch), Math.cos(this.aimYaw) * cp);

    if (!is1P) {
      // Smoothly damped 3P chase camera (ZERO Shift boost stutter!).
      _pivot.set(spec.chaseOffset[0], spec.chaseOffset[1], spec.chaseOffset[2])
        .applyQuaternion(_quat)
        .add(this.phys.position);
      const viewPitch = clamp(this.aimPitch - spec.chasePitchBias, -0.85, 0.55);
      const vcp = Math.cos(viewPitch);
      _dir.set(-Math.sin(this.aimYaw) * vcp, -Math.sin(viewPitch), -Math.cos(this.aimYaw) * vcp).normalize();

      const targetDist = spec.chaseDist + (this.phys.boosting ? 1.1 : 0);
      this.camDistCurrent = damp(this.camDistCurrent, targetDist, 7.5, dt);
      let dist = this.camDistCurrent;
      if (this.ctx.physics?.raycastInto?.(_pivot, _dir, dist + 0.6, CG.World, _hit)) {
        dist = Math.max(1.8, _hit.distance - 0.55);
      }
      _eye.copy(_pivot).addScaledVector(_dir, dist);
      const camGround = this.ctx.world?.nav?.groundHeight?.(_eye.x, _eye.y + 2, _eye.z);
      if (typeof camGround === 'number' && Number.isFinite(camGround)) {
        _eye.y = Math.max(_eye.y, camGround + 0.75);
      }
    } else if (this.activeMountGun) {
      // Calibrated Desert-Raid-style 1P 3D gun mount! Camera sits cleanly behind the ring/holo sight!
      _pivot.set(spec.muzzleOffset[0], spec.muzzleOffset[1], spec.muzzleOffset[2])
        .applyQuaternion(_quat)
        .add(this.phys.position);
      const camYaw = wrapAngle(this.aimYaw - Math.PI);
      this.activeMountGun.point(_pivot, camYaw, this.aimPitch, dt);

      _right.set(Math.cos(camYaw), 0, -Math.sin(camYaw));
      _camUp.crossVectors(_right, _aim).normalize();
      _eye.copy(_pivot).addScaledVector(_camUp, 0.29).addScaledVector(_aim, -0.78);
    } else {
      // Clean 1P cockpit / killstreak cam / thermal / MBT / mortar / fighter sight (zero clipping!).
      _eye.set(spec.fpEye[0], spec.fpEye[1], spec.fpEye[2])
        .applyQuaternion(_quat)
        .add(this.phys.position);
    }

    // Raycast sight from eye along aim so weapons converge accurately on the crosshair.
    let aimDist = 260;
    if (this.ctx.physics?.raycastInto?.(_eye, _aim, 260, CG.World, _hit)) {
      aimDist = Math.max(4, _hit.distance);
      seat.point.copy(_hit.point);
    } else {
      seat.point.copy(_eye).addScaledVector(_aim, 260);
    }
    seat.range = aimDist;
    seat.altitude = this.phys.altitude;

    const camYaw = wrapAngle(this.aimYaw - Math.PI);
    seat.yaw = camYaw;
    seat.pitch = this.aimPitch;
    seat.aim.copy(_aim);
    seat.view.position.copy(_eye);
    seat.view.yaw = camYaw;
    seat.view.pitch = this.aimPitch;
    // Camera looks down -Z, so positive camera rotation.z tilts LEFT; negate phys.roll (+ = right bank) so
    // banking right tilts the horizon/camera naturally to the right!
    seat.view.roll = !is1P
      ? -this.phys.roll * 0.22
      : spec.hudMode === 'fighter'
        ? -this.phys.roll * 0.72
        : spec.hudMode === 'chopper'
          ? -this.phys.roll * 0.36
          : spec.mountGun
            ? -this.phys.roll * 0.22
            : -this.phys.roll * 0.48;

    // If passenger has hand-held weapons active (Quad/Moto Seat 2), keep player eye & forward synced to our seat!
    if (spec.passengerWeapons) {
      this.ctx.player.eye.copy(_eye);
      this.ctx.player.forward.copy(_aim);
      this.ctx.player.yaw = camYaw;
      this.ctx.player.pitch = this.aimPitch;
    }

    // Kestrel FLIR Thermal Cam: highlight live enemies glowing hot through dust & walls!
    if (spec.hudMode === 'thermal' && VehicleVision.enabled && this.ctx.render?.highlight) {
      _hlLit.length = 0;
      for (const e of this.ctx.enemies.alive) {
        if (e.alive) _hlLit.push(e.char.mesh);
      }
      if (_hlLit.length > 0) this.ctx.render.highlight(_hlLit, '#ffd9a0', 1, 0.85);
    }

    // Smoothly damped FOV (ZERO Shift boost jitter!), with gunner optic zoom when RMB is held.
    seat.zoomed = this.gunnerZoomed;
    const baseFov = !is1P
      ? 76
      : spec.hudMode === 'tank'
        ? 48
        : spec.hudMode === 'thermal'
          ? 54
          : spec.hudMode === 'chopper'
            ? 62
            : spec.hudMode === 'fighter'
              ? 74
              : 66;
    const speedFov = clamp(this.phys.speed * (this.def.category === 'jet' ? 0.12 : 0.14), 0, 8);
    const targetFov = this.gunnerZoomed
      ? (spec.zoomFov ?? 40)
      : baseFov + (this.phys.boosting ? 7.5 : 0) + speedFov;
    this.camFovCurrent = damp(this.camFovCurrent, targetFov, this.gunnerZoomed ? 12 : 7.5, dt);
    this.ctx.camera?.setZoom?.(this.camFovCurrent);
    this.ctx.camera?.syncSeat?.();

    const coolRate = this.phys.deployed && this.def.id === 'bastion' ? 0.56 : 0.32;
    this.heat = Math.max(0, this.heat - coolRate * dt);
    if (this.overheated && this.heat < 0.28) this.overheated = false;
  }

  /** Computes live CCIP ground bomb impact point, Fighter Gun-Tracking Pipper, missile lock target, and AA lead pips! */
  private updateTacticalOverlays(): void {
    const spec = this.activeSeatSpec;
    const secRt = this.secondaryState[this._seatIndex];
    const secResolved = spec.secondary && secRt ? this.resolveWeaponMode(spec.secondary, secRt.modeIndex) : null;

    // 1. Live Fighter Jet / Strategic Bomber CCIP Bomb Ground Impact Point (Thermobaric, CBU-105, Snake-Eye, Cluster, Napalm, HE)!
    this.hudScratch.ccipWorld = null;
    this.hudScratch.ccipLabel = secResolved?.thermobaric
      ? 'CCIP THERMOBARIC'
      : secResolved?.aerialCluster
        ? 'CCIP CBU-105'
        : secResolved?.chute
          ? 'CCIP SNAKE-EYE'
          : secResolved?.cluster
            ? 'CCIP CLUSTER'
            : secResolved?.napalm
              ? 'CCIP NAPALM'
              : 'CCIP HE';
    if (spec.hudMode === 'fighter' && secResolved && secResolved.kind === 'bomb' && this.phys.altitude > 3) {
      _ccipPos.copy(this.phys.position);
      _ccipPos.y -= 0.45;
      _ccipVel.copy(this.phys.velocity);
      _ccipVel.y -= 3.5;
      const g = secResolved.gravity || 28;
      const isChute = secResolved.chute;
      const step = isChute ? 0.12 : 0.18;
      const maxSteps = isChute ? 110 : 60;
      for (let i = 0; i < maxSteps; i++) {
        const t = (i + 1) * step;
        _ccipVel.y -= g * step;
        if (isChute && t > 0.12) {
          const drag = Math.exp(-3.4 * step);
          _ccipVel.x *= drag;
          _ccipVel.z *= drag;
          if (_ccipVel.y < -26) _ccipVel.y = -26;
        }
        _ccipPos.addScaledVector(_ccipVel, step);
        const navGy = this.ctx.world?.nav?.groundHeight?.(_ccipPos.x, _ccipPos.y + 4, _ccipPos.z);
        const gy = typeof navGy === 'number' && Number.isFinite(navGy) ? navGy : this.phys.groundY;
        if (_ccipPos.y <= gy) {
          this.ccipOut[0] = _ccipPos.x;
          this.ccipOut[1] = gy + 0.25;
          this.ccipOut[2] = _ccipPos.z;
          this.hudScratch.ccipWorld = this.ccipOut;
          break;
        }
      }
    }

    // 1b. Live Fighter Boresight Gun-Tracking Pipper (shows exact ground/air convergence of nose GAU-12 / GAU-8 / M61 Vulcan)!
    this.hudScratch.gunPipWorld = null;
    if (spec.hudMode === 'fighter' && spec.primary.boresight) {
      this.model.root.updateMatrixWorld(true);
      this.model.muzzles.main.getWorldPosition(_muzzle);
      _quat.setFromEuler(_euler.set(this.phys.pitch, this.phys.yaw, this.phys.roll));
      _dir.set(0, 0, 1).applyQuaternion(_quat).normalize();
      if (this.ctx.physics?.raycastInto?.(_muzzle, _dir, 240, CG.World, _hit)) {
        this.gunPipOut[0] = _hit.point.x;
        this.gunPipOut[1] = _hit.point.y;
        this.gunPipOut[2] = _hit.point.z;
      } else {
        this.gunPipOut[0] = _muzzle.x + _dir.x * 160;
        this.gunPipOut[1] = _muzzle.y + _dir.y * 160;
        this.gunPipOut[2] = _muzzle.z + _dir.z * 160;
      }
      this.hudScratch.gunPipWorld = this.gunPipOut;
    }

    // 2. Live Missile Lock Target (Raptor AIM-9X/AMRAAM wide off-boresight, Hornet, Fighter ATGM, Kestrel Hellfire, Aegis TOW-X)!
    this.currentLockTarget = null;
    this.currentLockLabel = '';
    this.hudScratch.lockWorld = null;
    this.hudScratch.lockLabel = '';
    const wantsLock = Boolean(secResolved?.homing);
    if (wantsLock) {
      let bestTarget: MissileTarget | null = null;
      let bestLabel = 'TARGET';
      let bestDot = this.def.id === 'raptor' ? 0.66 : this.def.id === 'hornet' ? 0.72 : 0.78;
      // Prefer enemy vehicles & choppers first.
      this.ctx.enemies?.vehicles?.paintable?.(_paintTargets);
      for (const t of _paintTargets) {
        if (!t.alive) continue;
        _dir.subVectors(t.center, this.phys.position).normalize();
        const d = _dir.dot(_aim);
        if (d > bestDot) {
          bestDot = d;
          bestTarget = t;
          bestLabel = this.def.id === 'raptor' ? 'AIR / ARMOR LOCK' : 'ARMOR LOCK';
        }
      }
      if (!bestTarget) {
        for (const e of this.ctx.enemies.alive) {
          if (!e.alive) continue;
          _dir.subVectors(e.center, this.phys.position).normalize();
          const d = _dir.dot(_aim);
          if (d > bestDot) {
            bestDot = d;
            bestTarget = e;
            bestLabel = e.isBoss ? 'BOSS LOCK' : 'HOSTILE';
          }
        }
      }
      if (bestTarget) {
        this.currentLockTarget = bestTarget;
        this.currentLockLabel = bestLabel;
        this.lockOut[0] = bestTarget.center.x;
        this.lockOut[1] = bestTarget.center.y + (bestTarget.aimLift ?? 0.6);
        this.lockOut[2] = bestTarget.center.z;
        this.hudScratch.lockWorld = this.lockOut;
        this.hudScratch.lockLabel = bestLabel;
      }
    }
    if (this.currentLockTarget && this.currentLockTarget !== this.prevLockTarget) {
      this.ctx.audio?.play('quiver_lock', { position: this.phys.position, volume: 0.72, pitch: this.def.id === 'raptor' ? 1.18 : 1.05 });
    }
    this.prevLockTarget = this.currentLockTarget;

    // 3. Live AA Lead-Computing Reticle Pips on Enemy Aircraft (AA Turrets + Dogfighters Raptor & Hornet)!
    this.leadPipsOut.length = 0;
    const showAaLeads = spec.hudMode === 'aa' || this.def.id === 'raptor' || this.def.id === 'hornet';
    if (showAaLeads && this.ctx.enemies?.vehicles?.listTargets) {
      this.ctx.enemies.vehicles.listTargets(_radarTargets);
      const projSpeed = Math.max(120, spec.primary.speed || 220);
      for (const rt of _radarTargets) {
        if (!rt.airborne || this.leadPipsOut.length >= MAX_LEAD_PIPS) continue;
        const dist = rt.position.distanceTo(this.phys.position);
        const tof = clamp(dist / projSpeed, 0.04, 2.2);
        const slot = this.leadPipPool[this.leadPipsOut.length]!;
        slot[0] = rt.position.x + rt.velocity.x * tof;
        slot[1] = rt.position.y + rt.velocity.y * tof;
        slot[2] = rt.position.z + rt.velocity.z * tof;
        this.leadPipsOut.push(slot);
      }
    }
  }

  /** Updates external RWR lock/missile warnings (e.g. enemy AI fighters in Dogfight mode). */
  setExternalRwr(locking: boolean, lockStrength: number, missileInbound: boolean, label = ''): void {
    this.extRwrLock = locking;
    this.extRwrLockStrength = clamp(lockStrength, 0, 1);
    this.extRwrMissile = missileInbound;
    this.extRwrLabel = label;
    this.extRwrTimer = (locking || missileInbound) ? 0.38 : 0;
  }

  private stepMissileWarning(dt: number, occupied: boolean): void {
    if (this.extRwrTimer > 0) this.extRwrTimer = Math.max(0, this.extRwrTimer - dt);
    if (!occupied) {
      this.missileWarning = false;
      this.radarLockWarning = false;
      return;
    }
    const warnRange = this.def.stealth ? 58 : 105;
    const combatIncoming = this.ctx.combat?.hasIncomingEnemyMissile?.(this.phys.position, warnRange) ?? false;
    const extMissile = this.extRwrTimer > 0 && this.extRwrMissile;
    const extLock = this.extRwrTimer > 0 && this.extRwrLock;

    this.missileWarning = (combatIncoming || extMissile) && !this.isCountermeasureActive;
    this.radarLockWarning = !this.missileWarning && extLock && !this.isCountermeasureActive;

    if (this.missileWarning) {
      this.warningBeepTimer -= dt;
      if (this.warningBeepTimer <= 0) {
        this.warningBeepTimer = 0.14;
        this.ctx.audio?.play('ui_click', { position: this.phys.position, volume: 0.78, pitch: 2.15 });
      }
    } else if (this.radarLockWarning) {
      this.warningBeepTimer -= dt;
      if (this.warningBeepTimer <= 0) {
        // Authentic accelerating RWR lock chirp as enemy lock nears 100%!
        this.warningBeepTimer = clamp(0.42 - this.extRwrLockStrength * 0.24, 0.16, 0.42);
        this.ctx.audio?.play('ui_click', { position: this.phys.position, volume: 0.56, pitch: 1.45 + this.extRwrLockStrength * 0.4 });
      }
    } else {
      this.warningBeepTimer = 0;
    }
  }

  private stepSpecial(dt: number, occupied: boolean): void {
    if (this.specialCooldown > 0) this.specialCooldown = Math.max(0, this.specialCooldown - dt);
    if (this.specialActive && this.def.special.id !== 'autoTurret' && this.def.special.id !== 'deploy' && this.def.special.id !== 'vtol') {
      this.specialRemaining -= dt;
      if (this.specialRemaining <= 0) {
        this.specialActive = false;
        this.specialRemaining = 0;
      }
    }

    if (!occupied || !this.inputScratch.specialPressed) return;
    const sp = this.def.special;

    if (sp.id === 'autoTurret') {
      this.specialActive = !this.specialActive;
      this.ctx.audio?.play('reload_bolt', { position: this.phys.position, volume: 0.6, pitch: this.specialActive ? 1.25 : 0.8 });
      this.ctx.hud?.feed?.(`JACKAL AUTO-TURRET ${this.specialActive ? 'ONLINE' : 'OFFLINE'}`, this.def.color);
      return;
    }
    if (sp.id === 'deploy') {
      this.phys.deployed = !this.phys.deployed;
      this.specialActive = this.phys.deployed;
      this.ctx.audio?.play('metal_groan', { position: this.phys.position, volume: 0.75, pitch: this.phys.deployed ? 0.85 : 1.15 });
      this.ctx.hud?.feed?.(this.phys.deployed ? 'BASTION DEPLOYED — +40% ARMOR & RESUPPLY AURA' : 'BASTION MOBILE', this.def.color);
      if (this.phys.deployed) this.emitOrdnance('bunker', this.phys.position, this.phys.position, true);
      return;
    }
    if (sp.id === 'vtol') {
      // If a missile lock or radar lock warning is flashing and flares are ready, pop IR Flares immediately without dropping out of Jet flight!
      if ((this.missileWarning || this.radarLockWarning) && this.flareCooldown <= 0) {
        this.popFlares();
        return;
      }
      // Toggle VTOL Hover <-> Forward Mach Jet Flight!
      this.phys.vtolMode = !this.phys.vtolMode;
      this.specialActive = !this.phys.vtolMode;
      if (!this.phys.vtolMode) {
        // Kick smooth forward jet thrust on transition!
        this.phys.airThrottle = Math.max(this.phys.airThrottle, 0.78);
        if (this.phys.altitude < 2.2) {
          this.phys.velocity.y = Math.max(this.phys.velocity.y, 12);
          this.phys.grounded = false;
        }
      }
      this.engineAudio.playVtolShift(this.phys.position, !this.phys.vtolMode);
      this.ctx.hud?.feed?.(this.phys.vtolMode ? `${this.def.shortName} // VTOL HOVER MODE` : `${this.def.shortName} // MACH JET MODE`, this.def.color);
      // Also pop countermeasures if off cooldown so pilots always feel safe!
      if (this.flareCooldown <= 0 && (this.missileWarning || this.radarLockWarning)) this.popFlares();
      return;
    }

    if (this.specialCooldown > 0) {
      if (sp.id === 'dump_burn' && (this.missileWarning || this.radarLockWarning) && this.flareCooldown <= 0) {
        this.popFlares();
      }
      return;
    }
    this.specialActive = true;
    this.specialRemaining = sp.duration;
    this.specialCooldown = sp.cooldown;

    if (sp.id === 'smoke') {
      this.ctx.audio?.play('steam_burst', { position: this.phys.position, volume: 0.9, pitch: 0.75 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        _origin.set(this.phys.position.x + Math.cos(a) * 3.8, this.phys.position.y + 1.4, this.phys.position.z + Math.sin(a) * 3.8);
        this.ctx.fx?.smoke?.(_origin, 0x8e969e, 2.2, 4.5);
      }
      this.ctx.combat?.interceptEnemyProjectiles?.(this.phys.position, 22, 4);
      this.ctx.events.emit('dogfight:player_flares', { position: this.phys.position.clone() });
      this.ctx.hud?.feed?.('IR SMOKE SCREEN — LOCK BROKEN', this.def.color);
    } else if (sp.id === 'flares') {
      this.popFlares();
    } else if (sp.id === 'cobra') {
      // F-22 Raptor 2D Thrust-Vectoring Cobra Airbrake + IR Flares!
      if (this.phys.vtolMode) {
        // If still on tarmac/STOL, snap right into airborne Mach combat!
        this.phys.vtolMode = false;
        this.phys.airThrottle = 0.85;
        this.phys.velocity.y = Math.max(this.phys.velocity.y, 16);
        this.phys.grounded = false;
      }
      this.phys.cobraTimer = sp.duration;
      this.phys.boostFuel = Math.min(1, this.phys.boostFuel + 0.35);
      this.phys.boostLocked = false;
      this.popFlares();
      this.engineAudio.playVtolShift(this.phys.position, true);
      this.ctx.hud?.feed?.('F-22 COBRA MANEUVER // 2D THRUST-VECTOR TURN + FLARES', this.def.color);
      this.emitOrdnance('cobra', this.phys.position, null, true);
    } else if (sp.id === 'dump_burn') {
      // Lancer "Dump-and-Burn" trailing jet-fuel afterburner torch + incendiary wake + IR Flares!
      if (this.phys.vtolMode) {
        this.phys.vtolMode = false;
        this.phys.airThrottle = 1.0;
        this.phys.velocity.y = Math.max(this.phys.velocity.y, 14);
        this.phys.grounded = false;
      }
      this.phys.dumpBurnTimer = sp.duration;
      this.phys.boostFuel = 1;
      this.phys.boostLocked = false;
      this.dumpBurnWakeTimer = 0;
      this.popFlares();
      this.ctx.audio?.play('veh_afterburner_ignite', { position: this.phys.position, volume: 1.0, pitch: 0.78 });
      this.ctx.hud?.feed?.('LANCER DUMP-AND-BURN // FUEL TORCH + FLARES', this.def.color);
      this.emitOrdnance('dump_burn', this.phys.position, this.phys.position, true);
    } else if (sp.id === 'overcharge') {
      this.phys.boostFuel = 1;
      this.phys.boostLocked = false;
      this.ctx.audio?.play('steam_burst', { position: this.phys.position, volume: 0.85, pitch: 1.25 });
      this.ctx.combat?.explode?.(this.phys.position, {
        radius: 10.5,
        damage: 240,
        kind: 'plasma',
        source: 'viper_overcharge',
        team: 'player',
        selfDamage: 0,
        scale: 1.15,
      });
      this.ctx.hud?.feed?.('VIPER EMP OVERCHARGE — BOOST FULL', this.def.color);
    } else if (sp.id === 'wheelie') {
      // Quad Turbo Hop / Moto Stunt Wheelie impulse!
      if (this.phys.grounded) {
        this.phys.velocity.y = this.def.id === 'moto' ? 10.5 : 12.0;
        this.phys.grounded = false;
        this.phys.pitch = -0.34;
      }
      this.phys.boostFuel = Math.min(1, this.phys.boostFuel + 0.35);
      this.phys.boostLocked = false;
      this.ctx.audio?.play('steam_burst', { position: this.phys.position, volume: 0.72, pitch: 1.35 });
      this.ctx.hud?.feed?.(this.def.id === 'moto' ? 'STUNT WHEELIE!' : 'QUAD TURBO HOP!', this.def.color);
    }
  }

  private emitOrdnance(kind: OrdnanceEventKind, origin: THREE.Vector3, target: THREE.Vector3 | null, force = false): void {
    if (!force && this.clock - this.lastOrdnanceEmitAt < 1.4) return;
    this.lastOrdnanceEmitAt = this.clock;
    this.ctx.events?.emit?.('vehicle:ordnance', {
      vehicleId: this.def.id,
      kind,
      origin: origin.clone(),
      target: target ? target.clone() : null,
    });
  }

  private popFlares(): void {
    this.flareRemaining = 4.2;
    this.flareCooldown = this.def.id === 'lancer' ? 5.5 : this.def.stealth ? 6.5 : 9.5;
    this.ctx.audio?.play('veh_flare_pop', { position: this.phys.position, volume: 0.92, pitch: 1.04 });
    for (let i = 0; i < 8; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      _origin.copy(this.phys.position).addScaledVector(_up, -0.4);
      _dir.set(side * rand(0.5, 1), -0.4, rand(-0.6, 0.2)).normalize();
      this.ctx.fx?.sparks?.(_origin, _dir, 14, 0xffd166);
    }
    this.ctx.combat?.interceptEnemyProjectiles?.(this.phys.position, 32, 8);
    this.ctx.events.emit('dogfight:player_flares', { position: this.phys.position.clone() });
    this.emitOrdnance('flares', this.phys.position, null, false);
    this.ctx.hud?.feed?.('IR FLARES DEPLOYED — MISSILE LOCK BROKEN', '#ffd166');
  }

  private resolveWeaponMode(spec: VehicleWeaponSpec, modeIndex: number): {
    name: string;
    kind: VehicleWeaponKind;
    damage: number;
    speed: number;
    gravity: number;
    interval: number;
    magSize: number;
    reloadSeconds: number;
    blastRadius: number;
    blastDamage: number;
    explosionKind: VehicleWeaponSpec['explosionKind'];
    homing: boolean;
    napalm: boolean;
    cluster: boolean;
    aerialCluster: boolean;
    chute: boolean;
    moab: boolean;
    thermobaric: boolean;
    audio: string;
    audioPitch: number;
  } {
    const mode = modeIndex === 3 && spec.fourthMode
      ? spec.fourthMode
      : modeIndex === 2 && spec.thirdMode
        ? spec.thirdMode
        : modeIndex === 1 && spec.altMode
          ? spec.altMode
          : null;
    if (mode) {
      return {
        name: mode.name,
        kind: mode.kind ?? spec.kind,
        damage: mode.damage,
        speed: mode.speed,
        gravity: mode.gravity ?? spec.gravity,
        interval: mode.interval ?? spec.interval,
        magSize: mode.magSize ?? spec.magSize,
        reloadSeconds: mode.reloadSeconds ?? spec.reloadSeconds,
        blastRadius: mode.blastRadius,
        blastDamage: mode.blastDamage,
        explosionKind: mode.explosionKind,
        homing: Boolean(mode.homing),
        napalm: Boolean(mode.napalm),
        cluster: Boolean(mode.cluster),
        aerialCluster: Boolean(mode.aerialCluster),
        chute: Boolean(mode.chute),
        moab: Boolean(mode.moab),
        thermobaric: Boolean(mode.thermobaric),
        audio: mode.audio ?? spec.audio,
        audioPitch: mode.audioPitch ?? spec.audioPitch,
      };
    }
    return {
      name: spec.name,
      kind: spec.kind,
      damage: spec.damage,
      speed: spec.speed,
      gravity: spec.gravity,
      interval: spec.interval,
      magSize: spec.magSize,
      reloadSeconds: spec.reloadSeconds,
      blastRadius: spec.blastRadius,
      blastDamage: spec.blastDamage,
      explosionKind: spec.explosionKind,
      homing: Boolean(spec.homing),
      napalm: Boolean(spec.napalm),
      cluster: Boolean(spec.cluster),
      aerialCluster: Boolean(spec.aerialCluster),
      chute: Boolean(spec.chute),
      moab: Boolean(spec.moab),
      thermobaric: Boolean(spec.thermobaric),
      audio: spec.audio,
      audioPitch: spec.audioPitch,
    };
  }

  private stepWeapons(dt: number, occupied: boolean): void {
    for (let i = 0; i < this.def.seats.length; i++) {
      const spec = this.def.seats[i]!;
      this.tickWeaponRuntime(this.primaryState[i]!, spec.primary, dt);
      const sec = this.secondaryState[i];
      if (sec && spec.secondary) this.tickWeaponRuntime(sec, spec.secondary, dt);
    }

    if (!occupied || this.activeSeatSpec.passengerWeapons) return;

    const spec = this.activeSeatSpec;
    const prim = this.primaryState[this._seatIndex]!;
    const sec = this.secondaryState[this._seatIndex];

    // Seats with Hold-R toggle (e.g. Jackal Roof Gunner .50 HMG <-> 40mm Smart-AGL):
    // Hold R >= 0.35s switches active weapon; tap R reloads; LMB fires active weapon; RMB zooms.
    if (spec.holdRToggleSecondary && spec.secondary && sec) {
      if (this.inputScratch.reloadHeld) {
        if (this.reloadHold === -1) this.reloadHold = 0;
        if (this.reloadHold >= 0) {
          this.reloadHold += dt;
          this.ctx.hud?.hold?.(clamp(this.reloadHold / HOLD_R_SWITCH_SECONDS, 0, 1));
          if (this.reloadHold >= HOLD_R_SWITCH_SECONDS) {
            this.reloadHold = -2;
            this.ctx.hud?.hold?.(0);
            this.secondarySelected = !this.secondarySelected;
            this.activeMountGun?.setActive(1, this.secondarySelected ? 1 : 0);
            const activeName = this.secondarySelected ? spec.secondary.name : spec.primary.name;
            this.ctx.audio?.play('reload_bolt', {
              position: this.phys.position,
              volume: 0.78,
              pitch: this.secondarySelected ? 0.86 : 1.12,
            });
            this.ctx.hud?.callout?.(this.secondarySelected ? '40MM AGL' : '.50 CAL HMG');
            this.ctx.hud?.feed?.(`TURRET MODE: ${activeName}`, this.secondarySelected ? '#ff9e3b' : this.def.color);
          }
        }
      } else {
        if (this.reloadHold >= 0) {
          // Released before threshold -> treat as normal manual reload tap.
          this.ctx.hud?.hold?.(0);
          const pm = this.resolveWeaponMode(spec.primary, prim.modeIndex);
          const sm = this.resolveWeaponMode(spec.secondary, sec.modeIndex);
          if (this.secondarySelected) {
            if (sm.magSize > 0 && sec.ammo < sm.magSize && sec.reloadLeft <= 0) sec.reloadLeft = sm.reloadSeconds;
          } else if (pm.magSize > 0 && prim.ammo < pm.magSize && prim.reloadLeft <= 0) {
            prim.reloadLeft = pm.reloadSeconds;
          }
        }
        this.reloadHold = -1;
      }

      if (this.inputScratch.firePrimary && !this.overheated) {
        if (this.secondarySelected) {
          if (spec.secondary.kind !== 'none') this.tryFire(spec.secondary, sec, true);
        } else if (spec.primary.kind !== 'none') {
          this.tryFire(spec.primary, prim, false);
        }
      }
      return;
    }

    // [R]: Cycle alternate ammo / Fighter ordnance modes (or reload)!
    if (this.inputScratch.reloadPressed) {
      if (spec.primary.altMode) {
        const count = spec.primary.fourthMode ? 4 : spec.primary.thirdMode ? 3 : 2;
        prim.modeIndex = (prim.modeIndex + 1) % count;
        const m = this.resolveWeaponMode(spec.primary, prim.modeIndex);
        this.ctx.audio?.play('reload_bolt', { position: this.phys.position, volume: 0.7, pitch: 0.92 });
        this.ctx.hud?.feed?.(`AMMO LOADED: ${m.name}`, this.def.color);
      } else if (spec.secondary?.altMode && sec) {
        const count = spec.secondary.fourthMode ? 4 : spec.secondary.thirdMode ? 3 : 2;
        sec.modeIndex = (sec.modeIndex + 1) % count;
        const m = this.resolveWeaponMode(spec.secondary, sec.modeIndex);
        sec.ammo = m.magSize;
        sec.reloadLeft = 0;
        this.ctx.audio?.play('reload_bolt', { position: this.phys.position, volume: 0.75, pitch: 1.08 });
        this.ctx.hud?.feed?.(`ORDNANCE SELECTED: ${m.name}`, this.def.color);
      } else {
        const pm = this.resolveWeaponMode(spec.primary, prim.modeIndex);
        if (pm.magSize > 0 && prim.ammo < pm.magSize && prim.reloadLeft <= 0) prim.reloadLeft = pm.reloadSeconds;
        if (sec && spec.secondary) {
          const sm = this.resolveWeaponMode(spec.secondary, sec.modeIndex);
          if (sm.magSize > 0 && sec.ammo < sm.magSize && sec.reloadLeft <= 0) sec.reloadLeft = sm.reloadSeconds;
        }
      }
    }

    // Viper Chargeable Particle Lance Beam!
    if (spec.primary.kind === 'lance') {
      const chargeTime = spec.primary.chargeSeconds ?? 0.75;
      if (this.inputScratch.firePrimary && !this.overheated && prim.cooldown <= 0) {
        this.lanceHeld = true;
        this.lanceCharge = Math.min(1, this.lanceCharge + dt / chargeTime);
        this.lanceChargeBeep -= dt;
        if (this.lanceChargeBeep <= 0) {
          this.lanceChargeBeep = 0.22;
          this.ctx.audio?.play('railgun_charge', {
            position: this.phys.position,
            volume: 0.45,
            pitch: 0.9 + this.lanceCharge * 0.65,
          });
        }
        if (this.lanceCharge >= 1) {
          this.fireParticleLance(spec.primary, prim, 1);
          this.lanceCharge = 0;
          this.lanceHeld = false;
          this.lanceChargeBeep = 0;
        }
      } else if (this.lanceHeld) {
        if (this.lanceCharge >= 0.25 && prim.cooldown <= 0) {
          this.fireParticleLance(spec.primary, prim, this.lanceCharge);
        }
        this.lanceCharge = 0;
        this.lanceHeld = false;
        this.lanceChargeBeep = 0;
      } else {
        this.lanceCharge = damp(this.lanceCharge, 0, 8, dt);
        this.lanceChargeBeep = 0;
      }
    } else if (this.inputScratch.firePrimary && spec.primary.kind !== 'none' && !this.overheated) {
      this.tryFire(spec.primary, prim, false);
    }

    if (this.inputScratch.fireSecondary && spec.secondary && sec && spec.secondary.kind !== 'none' && !this.overheated) {
      this.tryFire(spec.secondary, sec, true);
    }
  }

  private tickWeaponRuntime(rt: WeaponRuntime, spec: VehicleWeaponSpec, dt: number): void {
    if (rt.cooldown > 0) rt.cooldown = Math.max(0, rt.cooldown - dt);
    if (rt.reloadLeft > 0) {
      rt.reloadLeft -= dt;
      if (rt.reloadLeft <= 0) {
        rt.reloadLeft = 0;
        rt.ammo = this.resolveWeaponMode(spec, rt.modeIndex).magSize;
      }
    }
  }

  private resolveMuzzlePosition(spec: VehicleWeaponSpec, isSecondary: boolean): void {
    if (this.activeMountGun) {
      this.activeMountGun.muzzle(_muzzle);
      return;
    }
    this.model.root.updateMatrixWorld(true);
    if (isSecondary && (spec.kind === 'rocket' || spec.kind === 'bomb' || spec.kind === 'atgm')) {
      this.podFlip = !this.podFlip;
      const node = this.podFlip ? this.model.muzzles.podLeft : this.model.muzzles.podRight;
      node.getWorldPosition(_muzzle);
      return;
    }
    if (this.activeSeatSpec.usesTurret) {
      this.model.muzzles.main.getWorldPosition(_muzzle);
      return;
    }
    if (this.activeSeatSpec.usesSubTurret) {
      this.model.muzzles.roof.getWorldPosition(_muzzle);
      return;
    }
    this.model.muzzles.front.getWorldPosition(_muzzle);
  }

  private fireParticleLance(spec: VehicleWeaponSpec, rt: WeaponRuntime, charge: number): void {
    rt.cooldown = spec.interval + 0.28;
    this.heat = Math.min(1, this.heat + 0.16 + 0.14 * charge);
    if (this.heat >= 1) this.overheated = true;

    this.resolveMuzzlePosition(spec, false);
    const aimPoint = this.seat?.point ?? _target;
    _dir.subVectors(aimPoint, _muzzle);
    if (_dir.lengthSq() < 1) _dir.copy(_aim);
    else _dir.normalize();

    const dmg = Math.round(spec.damage * (0.45 + 0.55 * charge));
    const res = this.ctx.combat.fireRay(_muzzle, _dir, {
      damage: dmg,
      bossDamage: Math.round(dmg * 1.45),
      source: 'viper_lance',
      team: 'player',
      maxDistance: 260,
      tracer: 'rail',
      tracerFrom: _muzzle,
      pierce: 6,
      armorPiercing: true,
      force: 180 * charge,
      severMult: 3.5,
      gib: charge >= 0.85,
    });
    // Incandescent plasma burst at the impact endpoint!
    this.ctx.combat.explode(res.end, {
      radius: spec.blastRadius * (0.65 + 0.5 * charge),
      damage: Math.round(spec.blastDamage * (0.5 + 0.5 * charge)),
      kind: 'plasma',
      source: 'viper_lance_blast',
      team: 'player',
      selfDamage: 0,
      scale: 0.95 + 0.55 * charge,
      vaporize: charge >= 0.75,
    });
    this.ctx.fx?.muzzleFlash?.(_muzzle, _dir, 'plasma');
    this.ctx.audio?.play(spec.audio, { position: _muzzle, volume: 0.95, pitch: 1.05 + charge * 0.45 });
    this.ctx.events.emit('vehicle:fx', {
      kind: 'ray',
      from: _muzzle,
      to: res.end,
      dir: _dir,
      tracer: 'rail',
      flash: 'plasma',
      sound: spec.audio,
      pitch: 1.05 + charge * 0.45,
    });
    this.phys.recoilOffset = Math.min(1, this.phys.recoilOffset + 0.45 * charge);
    if (this.occupied) this.ctx.camera?.addTrauma?.(spec.trauma * (0.6 + 0.6 * charge));
    this.emitOrdnance('lance', _muzzle, this.seat?.point ?? null, false);
  }

  private tryFire(spec: VehicleWeaponSpec, rt: WeaponRuntime, isSecondary: boolean): void {
    if (rt.cooldown > 0 || rt.reloadLeft > 0) return;
    const m = this.resolveWeaponMode(spec, rt.modeIndex);
    if (m.magSize > 0) {
      if (rt.ammo <= 0) {
        rt.reloadLeft = m.reloadSeconds;
        return;
      }
      rt.ammo--;
      if (rt.ammo <= 0) rt.reloadLeft = m.reloadSeconds;
    }
    rt.cooldown = m.interval;

    const heatScale = this.phys.deployed && this.def.id === 'bastion' ? 0.5 : 1;
    const heatPer = m.interval < 0.08 ? 0.018 : m.interval < 0.2 ? 0.028 : 0.06;
    this.heat = Math.min(1, this.heat + heatPer * heatScale);
    if (this.heat >= 1) this.overheated = true;

    this.resolveMuzzlePosition(spec, isSecondary);

    // Fixed boresight weapons (Harrier GAU-12, Warthog GAU-8, Gravity Bombs) fire straight along aircraft nose!
    if (spec.boresight && this.def.category === 'jet') {
      _quat.setFromEuler(_euler.set(this.phys.pitch, this.phys.yaw, this.phys.roll));
      _dir.set(0, 0, 1).applyQuaternion(_quat).normalize();
    } else {
      const aimPoint = this.seat?.point ?? _target;
      _dir.subVectors(aimPoint, _muzzle);
      if (_dir.lengthSq() < 1) _dir.copy(_aim);
      else _dir.normalize();
    }
    if (spec.spread > 0) randomInCone(_dir, spec.spread, _dir);

    // Animate close-up 1P mounted 3D gun barrel spin & recoil!
    if (this.activeMountGun) {
      this.activeMountGun.recoil(clamp(spec.recoilKick * 2.4, 0.015, 0.09));
      if (this.activeSeatSpec.mountGun === 'm134' || this.activeSeatSpec.mountGun === 'vulcan') {
        this.activeMountGun.turn(0.75);
      }
    }

    if (m.kind === 'bomb') {
      // Swing open internal belly bomb-bay doors (Lancer triple bays) and hold open 2.2 s after last release!
      this.bombBayHold = 2.2;
      this.bombBayOpen = Math.max(this.bombBayOpen, 0.35);
      // Gravity-dropped fighter/bomber bomb (Mk-82 Snake-Eye, CBU-105 Aerial Cluster, BLU-27 Napalm, or BLU-121/B Thermobaric) -> lands on CCIP!
      // Cleared slightly below the wing pylon / belly bay with a crisp downward ejector kick, zero smoke/flame trail, and live 3D whistle.
      _muzzle.y -= 0.45;
      _vel.copy(this.phys.velocity);
      _vel.y -= 3.5;
      const bombScale = m.thermobaric ? 1.45 : m.moab ? 4.4 : m.blastRadius >= 20 ? 3.0 : m.blastRadius >= 16 ? 2.5 : 1.9;
      const modelSize = m.thermobaric ? 1.65 : m.moab ? 1.95 : m.napalm ? 1.08 : (m.aerialCluster || m.cluster) ? 1.12 : m.blastRadius >= 20 ? 1.22 : 0.96;
      const bombSource = m.napalm
        ? `${this.def.id}_napalm`
        : (m.aerialCluster || m.cluster)
          ? `${this.def.id}_cluster`
          : m.thermobaric
            ? `${this.def.id}_thermobaric`
            : m.chute
              ? `${this.def.id}_chute`
              : `${this.def.id}_bomb`;
      this.ctx.combat.spawnProjectile({
        origin: _muzzle,
        velocity: _vel,
        kind: 'shell',
        team: 'player',
        damage: m.damage,
        bossDamage: m.damage * 1.45,
        source: bombSource,
        gravity: m.gravity || 28,
        lifetime: m.chute ? 16 : (m.thermobaric || m.aerialCluster) ? 14 : 10,
        trail: 'none',
        size: modelSize,
        armorPiercing: true,
        bomb: true,
        napalm: m.napalm,
        cluster: m.cluster || m.aerialCluster,
        aerialCluster: m.aerialCluster,
        chute: m.chute,
        thermobaric: m.thermobaric,
        explosion: {
          radius: m.blastRadius,
          damage: m.blastDamage,
          kind: m.explosionKind,
          selfDamage: 0,
          scale: bombScale,
          shake: m.thermobaric ? 2.4 : m.moab ? 2.2 : 1.4,
        },
      });
      const ccip = this.hudScratch.ccipWorld;
      const dropTarget = ccip ? _ccipPos.set(ccip[0], ccip[1], ccip[2]) : null;
      const ordKind: OrdnanceEventKind = m.napalm
        ? 'napalm'
        : (m.aerialCluster || m.cluster)
          ? 'cluster'
          : m.thermobaric
            ? 'thermobaric'
            : m.moab
              ? 'moab'
              : m.chute
                ? 'chute'
                : 'bomb';
      this.emitOrdnance(ordKind, _muzzle, dropTarget, true);
    } else if (m.kind === 'atgm' || m.homing) {
      const lock = this.currentLockTarget;
      _vel.copy(_dir).multiplyScalar(m.speed);
      if (this.def.category === 'jet') _vel.addScaledVector(this.phys.velocity, 0.35);
      const missileTurn = this.def.id === 'raptor' ? 7.6 : this.def.id === 'hornet' ? 6.0 : 4.8;
      const isAircraft = this.def.category === 'jet' || this.def.category === 'helicopter';
      this.ctx.combat.spawnProjectile({
        origin: _muzzle,
        velocity: _vel,
        kind: 'rocket',
        team: 'player',
        damage: m.damage,
        bossDamage: m.damage * 1.3,
        source: `${this.def.id}_atgm`,
        lifetime: 8,
        trail: isAircraft ? 'missile' : 'hellfire',
        target: lock,
        turnRate: lock ? missileTurn : 0,
        armorPiercing: true,
        explosion: {
          radius: m.blastRadius,
          damage: m.blastDamage,
          kind: m.explosionKind,
          selfDamage: 0,
          scale: 1.45,
        },
      });
      this.emitOrdnance('missile', _muzzle, lock ? lock.center : (this.seat?.point ?? null), false);
    } else if (m.kind === 'agl' || m.kind === 'mortar') {
      _vel.copy(_dir).multiplyScalar(m.speed);
      _vel.y += m.kind === 'mortar' ? 22 : 5.2;
      this.ctx.combat.spawnProjectile({
        origin: _muzzle,
        velocity: _vel,
        kind: 'shell',
        team: 'player',
        damage: m.damage,
        source: `${this.def.id}_${m.kind}`,
        gravity: m.gravity || 18,
        lifetime: 7,
        trail: 'smoke',
        explosion: {
          radius: m.blastRadius,
          damage: m.blastDamage,
          kind: m.explosionKind,
          selfDamage: 0,
          scale: m.blastRadius > 8 ? 1.55 : 1.05,
        },
      });
      if (m.kind === 'mortar') this.emitOrdnance('mortar', _muzzle, this.seat?.point ?? null, false);
    } else if (m.speed <= 0 || m.kind === 'mg' || (m.kind === 'hmg' && m.speed <= 0)) {
      const tracerKind = m.kind === 'hmg' ? 'heavy' : 'bullet';
      const rayRes = this.ctx.combat.fireRay(_muzzle, _dir, {
        damage: m.damage,
        source: `${this.def.id}_${m.kind}`,
        team: 'player',
        maxDistance: 250,
        tracer: tracerKind,
        tracerFrom: _muzzle,
        blastRadius: m.blastRadius > 0 ? m.blastRadius : undefined,
        armorPiercing: m.kind === 'hmg',
        force: m.kind === 'hmg' ? 55 : 28,
        severMult: m.kind === 'hmg' ? 2.0 : 1.2,
      });
      this.ctx.events.emit('vehicle:fx', {
        kind: 'ray',
        from: _muzzle,
        to: rayRes.end,
        dir: _dir,
        tracer: tracerKind,
        flash: spec.muzzleFlash,
        sound: m.audio,
        pitch: m.audioPitch,
      });
    } else {
      // High-velocity 120mm tank cannon, 20mm/25mm/30mm autocannon/AA flak, Hydra rockets, or Plasma bolts!
      _vel.copy(_dir).multiplyScalar(m.speed);
      const isCannon = m.kind === 'cannon';
      const isRocket = m.kind === 'rocket';
      const isPlasma = m.kind === 'plasma';
      const isAA = this.activeSeatSpec.hudMode === 'aa';
      this.ctx.combat.spawnProjectile({
        origin: _muzzle,
        velocity: _vel,
        kind: isRocket ? 'rocket' : isPlasma ? 'plasma' : 'shell',
        team: 'player',
        damage: m.damage,
        bossDamage: isCannon ? m.damage * 1.35 : undefined,
        source: `${this.def.id}_${m.kind}`,
        gravity: m.gravity,
        lifetime: 6,
        trail: isRocket ? 'smoke' : isPlasma ? 'plasma' : isCannon && m.blastRadius >= 4 ? 'rings' : 'sparks',
        tracer: isPlasma ? 'plasma' : 'heavy',
        flak: isAA,
        armorPiercing: isCannon || isPlasma,
        explosion: m.blastRadius > 0 ? {
          radius: m.blastRadius,
          damage: m.blastDamage,
          kind: m.explosionKind,
          selfDamage: 0,
          scale: m.blastRadius >= 9 ? 1.7 : isCannon ? 1.25 : 0.95,
        } : undefined,
      });
      if (isRocket) this.emitOrdnance('rocket', _muzzle, this.seat?.point ?? null, false);
      else if (this.def.id === 'warthog' && spec.boresight) this.emitOrdnance('gau8', _muzzle, this.seat?.point ?? null, false);
      else if (isCannon && this.def.id === 'aegis') this.emitOrdnance('cannon', _muzzle, this.seat?.point ?? null, false);
    }

    if (spec.recoilKick > 0) {
      this.phys.recoilOffset = Math.min(1, this.phys.recoilOffset + spec.recoilKick * 8);
    }
    if (this.occupied && spec.trauma > 0) {
      this.ctx.camera?.addTrauma?.(spec.trauma);
    }
    if (m.kind !== 'bomb') {
      this.ctx.fx?.muzzleFlash?.(_muzzle, _dir, spec.muzzleFlash);
    }
    this.ctx.audio?.play(m.audio, {
      position: _muzzle,
      volume:
        m.kind === 'cannon' || m.kind === 'bomb' || m.kind === 'atgm' || m.audio === 'aircraft_missile_fire'
          ? 0.95
          : 0.74,
      pitch: m.audioPitch,
      pitchJitter: 0.04,
    });
  }

  /**
   * Jackal's toggleable `[Q]` AI roof gunner: dynamically switches between 40mm Smart-AGL (enemy clusters of 2+,
   * bosses, or enemy vehicles at 14..68 m) and the .50-Cal HMG (close range, single movers, or AGL reload)!
   */
  private stepAutoTurret(dt: number): void {
    if (this.def.id !== 'jackal' || !this.specialActive || !this.occupied || this._seatIndex !== 0) return;
    this.autoTurretCooldown -= dt;
    if (this.autoTurretCooldown > 0) return;

    this.model.root.updateMatrixWorld(true);
    this.model.muzzles.roof.getWorldPosition(_muzzle);

    // 1. Check for high-value 40mm Smart-AGL targets (enemy vehicles, bosses, or tight clusters >= 2) at 14..68 m!
    let aglTargetPos: THREE.Vector3 | null = null;
    if (this.autoAglCooldown <= 0) {
      let bestScore = 0;
      // Prefer enemy vehicles in mid-range first.
      this.ctx.enemies?.vehicles?.paintable?.(_paintTargets);
      for (const vt of _paintTargets) {
        if (!vt.alive) continue;
        const dist = vt.center.distanceTo(_muzzle);
        if (dist >= 14 && dist <= AUTO_TURRET_RANGE) {
          const score = 120 - dist * 0.4;
          if (score > bestScore) {
            bestScore = score;
            aglTargetPos = vt.center;
          }
        }
      }
      // Also check bosses and infantry clusters (2+ enemies within 6.5 m of each other).
      const alive = this.ctx.enemies.alive;
      for (let i = 0; i < alive.length; i++) {
        const e = alive[i]!;
        if (!e.alive) continue;
        const dist = e.center.distanceTo(_muzzle);
        if (dist < 14 || dist > AUTO_TURRET_RANGE) continue;
        let cluster = 1;
        for (let j = 0; j < alive.length; j++) {
          if (i === j) continue;
          const o = alive[j]!;
          if (o.alive && o.center.distanceToSquared(e.center) <= 42.25) cluster++;
        }
        if (e.isBoss || cluster >= 2) {
          const score = (e.isBoss ? 105 : 60 + cluster * 18) - dist * 0.35;
          if (score > bestScore) {
            bestScore = score;
            aglTargetPos = e.center;
          }
        }
      }
    }

    if (aglTargetPos) {
      const dist = aglTargetPos.distanceTo(_muzzle);
      const speed = 44;
      const g = 16;
      const tof = dist / speed;
      _dir.subVectors(aglTargetPos, _muzzle);
      const targetRelYaw = wrapAngle(Math.atan2(_dir.x, _dir.z) - this.phys.yaw);
      this.turretYaw = dampAngle(this.turretYaw, targetRelYaw, 12, 0.14);
      // Compute ballistic arc launch velocity so the 40mm grenade lands right in the pack!
      _vel.set(_dir.x / Math.max(0.15, tof), (_dir.y + 0.5 * g * tof * tof) / Math.max(0.15, tof), _dir.z / Math.max(0.15, tof));
      _dir.copy(_vel).normalize();
      this.turretPitch = Math.asin(clamp(_dir.y, -0.45, 0.85));

      this.autoAglCooldown = 2.6;
      this.autoTurretCooldown = 0.36;
      this.ctx.combat.spawnProjectile({
        origin: _muzzle,
        velocity: _vel,
        kind: 'shell',
        team: 'player',
        damage: 145,
        source: 'jackal_auto_agl',
        gravity: g,
        lifetime: 6,
        trail: 'smoke',
        explosion: {
          radius: 4.8,
          damage: 150,
          kind: 'grenade',
          selfDamage: 0,
          scale: 1.05,
        },
      });
      this.ctx.fx?.muzzleFlash?.(_muzzle, _dir, 'autocannon');
      this.ctx.audio?.play('mgl_shot', { position: _muzzle, volume: 0.65, pitch: 0.98, pitchJitter: 0.05 });
      return;
    }

    // 2. Otherwise shred nearest enemy with the M2-X50 .50-Cal HMG!
    let best: EnemyInstance | null = null;
    let bestD2 = AUTO_TURRET_RANGE * AUTO_TURRET_RANGE;
    for (const e of this.ctx.enemies.alive) {
      if (!e.alive) continue;
      const d2 = e.center.distanceToSquared(_muzzle);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = e;
      }
    }
    if (!best) return;

    _dir.subVectors(best.center, _muzzle).normalize();
    const targetRelYaw = wrapAngle(Math.atan2(_dir.x, _dir.z) - this.phys.yaw);
    this.turretYaw = dampAngle(this.turretYaw, targetRelYaw, 10, 0.12);
    this.turretPitch = Math.asin(clamp(_dir.y, -0.5, 0.8));

    this.autoTurretCooldown = 0.11;
    this.ctx.combat.fireRay(_muzzle, _dir, {
      damage: 34,
      source: 'jackal_auto_turret',
      team: 'player',
      maxDistance: AUTO_TURRET_RANGE + 10,
      tracer: 'heavy',
      tracerFrom: _muzzle,
    });
    this.ctx.fx?.muzzleFlash?.(_muzzle, _dir, 'rotary');
    this.ctx.audio?.play('hmg_shot', { position: _muzzle, volume: 0.45, pitch: 1.38, pitchJitter: 0.06 });
  }

  /** Bastion Deployed `[Q]` mobile bunker aura: heals nearby players & refills weapon reserves every 1.4 s! */
  private stepResupplyAura(dt: number): void {
    if (this.def.id !== 'bastion' || !this.phys.deployed) return;
    this.resupplyTimer -= dt;
    if (this.resupplyTimer > 0) return;
    this.resupplyTimer = RESUPPLY_INTERVAL;

    const p = this.ctx.player;
    if (!p.alive) return;
    const d = p.position.distanceTo(this.phys.position);
    if (d <= RESUPPLY_RADIUS) {
      if (p.health < p.maxHealth) p.heal(10);
      this.ctx.weapons?.addAmmo?.(0.08);
      if (this.health < this.def.maxHealth) {
        this.health = Math.min(this.def.maxHealth, this.health + 45);
      }
    }
  }

  /** Syncs the Kinematic Rapier RigidBody hull & applies bumper scoop impulses to resting ragdolls! */
  private syncKinematicHull(): void {
    if (!this.kinBody) return;
    _quat.setFromEuler(_euler.set(this.phys.pitch, this.phys.yaw, this.phys.roll));
    _bumperBoxPos.set(
      this.phys.position.x,
      this.phys.position.y + this.def.halfHeight * 0.72,
      this.phys.position.z,
    );
    this.kinBody.setNextKinematicTranslation(_bumperBoxPos);
    this.kinBody.setNextKinematicRotation(_quat);

    // When driving over corpses/ragdolls at speed, scoop them up & over the hood/windshield!
    if (this.phys.speed > 5.5 && this.bumperShape && this.ctx.physics?.world) {
      const ragQuery = ((0xffff) << 16) | ((CG.Ragdoll | CG.Gib) & 0xffff);
      const speed = this.phys.speed;
      const vx = this.phys.velocity.x;
      const vz = this.phys.velocity.z;
      const bodies: RAPIER.RigidBody[] = [];
      this.ctx.physics.world.intersectionsWithShape(
        _bumperBoxPos,
        _quat,
        this.bumperShape,
        col => {
          if (this.kinCollider && col.handle === this.kinCollider.handle) return true;
          const b = col.parent();
          if (b && b.isDynamic()) bodies.push(b);
          return true;
        },
        undefined,
        ragQuery,
      );
      for (const b of bodies) {
        b.translation(_bumperBodyT);
        const sideX = _bumperBodyT.x - this.phys.position.x;
        const sideZ = _bumperBodyT.z - this.phys.position.z;
        const inv = 1 / Math.max(0.4, Math.hypot(sideX, sideZ));
        _bumperImp.set(
          vx * 0.55 + sideX * inv * speed * 0.25,
          clamp(4.5 + speed * 0.34, 4.5, 16),
          vz * 0.55 + sideZ * inv * speed * 0.25,
        );
        b.setLinvel(_bumperImp, true);
      }
    }
  }

  /** Handles high-speed wall/ground crashes, abandoned aircraft impacts, pushable wrecks, and player-favorable enemy-vehicle ramming! */
  private stepCrashAndRam(_dt: number, occupied: boolean): void {
    // 1. Push destroyed enemy wrecks out of the way cleanly!
    if (this.phys.speed > 2.2) {
      const pushRadius = Math.max(this.def.halfWidth, this.def.halfLength) + 1.1;
      this.ctx.enemies?.vehicles?.pushWrecks?.(this.phys.position, pushRadius, this.phys.velocity, this.def.mass);
    }

    // 2. Abandoned falling aircraft slamming into terrain or buildings -> dramatic fireball!
    if (!occupied && this.phys.abandonedFall && (this.phys.crashImpact > 10 || this.phys.grounded)) {
      this.ctx.audio?.play('veh_hit_heavy', { position: this.phys.position, volume: 0.95, pitch: 0.85 });
      this.explodeAndDestroy(true);
      return;
    }

    // 2b. Structural smash-through (tanks plowing through drywall houses/shacks/masonry walls) or bunker deflection!
    if (this.phys.ramBreachImpact > 0) {
      const impact = this.phys.ramBreachImpact;
      const heavy = this.def.mass >= 4.5 || impact >= 12;
      if (this.bumpAudioCooldown <= 0) {
        this.bumpAudioCooldown = 0.22;
        const sound = heavy ? 'veh_hit_heavy' : 'veh_hit_light';
        const vol = clamp(0.72 + impact * 0.015, 0.72, 1.0);
        if (occupied) {
          this.ctx.audio?.play(sound, { volume: vol, pitch: rand(0.84, 0.98) });
        } else {
          this.ctx.audio?.play(sound, { position: this.phys.ramBreachPoint, volume: vol * 0.8, pitch: rand(0.84, 0.98) });
        }
      }
      if (occupied) this.ctx.camera?.addTrauma?.(clamp(impact * 0.012, 0.14, 0.36));
      this.ctx.fx?.dust?.(this.phys.ramBreachPoint, _up, heavy ? 2.4 : 1.5);
      this.ctx.fx?.sparks?.(this.phys.ramBreachPoint, _up, heavy ? 14 : 8, 0xd8c6a8);
    } else if (this.phys.ramBlocked && this.phys.crashImpact > 4.5 && this.bumpAudioCooldown <= 0) {
      const impact = this.phys.crashImpact;
      this.bumpAudioCooldown = 0.42;
      if (occupied) {
        this.ctx.audio?.play('veh_hit_heavy', { volume: clamp(0.76 + impact * 0.015, 0.76, 1.0), pitch: 0.78 });
        this.ctx.camera?.addTrauma?.(clamp(impact * 0.015, 0.14, 0.34));
      } else {
        this.ctx.audio?.play('veh_hit_heavy', { position: this.phys.position, volume: 0.72, pitch: 0.78 });
      }
      this.ctx.fx?.sparks?.(this.phys.position, this.phys.crashNormal, 14, 0xffc060);
    }

    // 3. Wall / ground crash feedback:
    //    - Minor bumps / hard landings (`7..25 m/s`): crisp light hull thud + light sparks (no self-damage).
    //    - High-speed wall / ground crashes (`> 25 m/s`): heavy crunch + capped self-damage.
    if (this.phys.crashImpact > 7 && this.phys.crashImpact <= 25 && this.bumpAudioCooldown <= 0) {
      const impact = this.phys.crashImpact;
      this.bumpAudioCooldown = 0.38;
      const bumpVol = clamp(0.55 + (impact - 7) * 0.02, 0.55, 0.9);
      if (occupied) {
        this.ctx.audio?.play('veh_hit_light', { volume: bumpVol, pitch: rand(0.92, 1.06) });
        this.ctx.camera?.addTrauma?.(clamp(impact * 0.006, 0.04, 0.14));
      } else {
        this.ctx.audio?.play('veh_hit_light', {
          position: this.phys.position,
          volume: bumpVol * 0.7,
          pitch: rand(0.92, 1.06),
        });
      }
      this.ctx.fx?.sparks?.(this.phys.position, this.phys.crashNormal, 8, 0xffc864);
    }

    if (this.wallCrashCooldown <= 0 && this.phys.crashImpact > 25) {
      const impact = this.phys.crashImpact;
      this.wallCrashCooldown = 1.15;
      const isCatastrophicJetDive = this.def.category === 'jet' && impact >= 42;
      const rawDmg = Math.round((impact - 22) * (this.def.category === 'jet' ? 22 : 7));
      const maxCap = Math.round(this.def.maxHealth * (isCatastrophicJetDive ? 0.55 : 0.14));
      const dmg = Math.min(rawDmg, maxCap);
      if (this.crashAudioCooldown <= 0) {
        this.crashAudioCooldown = 0.45;
        this.heavyHitAudioCooldown = Math.max(this.heavyHitAudioCooldown, 0.25);
        const crashVol = clamp(0.86 + (impact - 25) * 0.005, 0.86, 1.0);
        if (occupied) {
          this.ctx.audio?.play('veh_hit_heavy', { volume: crashVol, pitch: rand(0.9, 1.02) });
        } else {
          this.ctx.audio?.play('veh_hit_heavy', {
            position: this.phys.position,
            volume: 0.82,
            pitch: rand(0.9, 1.02),
          });
        }
        this.ctx.fx?.sparks?.(this.phys.position, this.phys.crashNormal, 18, 0xffae3a);
      }
      if (occupied) this.ctx.camera?.addTrauma?.(clamp(impact * 0.011, 0.16, 0.55));
      this.absorbDamage(dmg, undefined, isCatastrophicJetDive, 'crash', false);
      if (!this.alive) return;
    }

    // 4. Ramming LIVE enemy trucks, humvees, tanks & choppers — heavily favors the player (no bounce-spam self-destruction)!
    if (this.ramVehicleCooldown <= 0 && this.phys.speed > 6.5 && this.ctx.enemies?.vehicles?.vehicleRam) {
      const ramRadius = Math.max(this.def.halfWidth, this.def.halfLength) + 0.95;
      const impactSpeed = this.phys.speed;
      const res = this.ctx.enemies.vehicles.vehicleRam(
        this.phys.position,
        ramRadius,
        this.phys.velocity,
        this.def.mass,
        `${this.def.id}_ram`,
      );
      if (res?.hit) {
        // Long cooldown (1.15 s) eliminates low-speed repeated bounce damage when holding W!
        this.ramVehicleCooldown = 1.15;
        _dir.subVectors(this.phys.position, res.point);
        _dir.y = 0;
        if (_dir.lengthSq() < 0.01) _dir.set(0, 0, -1);
        else _dir.normalize();
        const heavyRam = impactSpeed >= 15 || res.armored || res.killed;
        const ramSound = heavyRam ? 'veh_hit_heavy' : 'veh_hit_light';
        const ramPitch = res.armored ? 0.9 : 1.04;
        if (occupied) {
          this.ctx.audio?.play(ramSound, { volume: heavyRam ? 0.94 : 0.82, pitch: ramPitch });
        } else {
          this.ctx.audio?.play(ramSound, { position: res.point, volume: heavyRam ? 0.86 : 0.72, pitch: ramPitch });
        }
        this.ctx.fx?.sparks?.(res.point, _dir, 28, 0xffb84d);
        if (occupied) this.ctx.camera?.addTrauma?.(clamp(impactSpeed * 0.014, 0.22, 0.52));

        // Plow through light/destroyed targets cleanly; gentle non-bouncing slowdown against live heavy armor.
        const vn = this.phys.velocity.x * _dir.x + this.phys.velocity.z * _dir.z;
        if (vn < 0) {
          const dampFactor = res.killed || this.def.mass >= 6 ? 0.35 : 0.72;
          this.phys.velocity.x -= _dir.x * vn * dampFactor;
          this.phys.velocity.z -= _dir.z * vn * dampFactor;
        }

        // Player-favorable self-damage cap: heavy armor shrugs off rams, light vehicles take modest chip damage.
        const capFrac = this.def.mass >= 6 ? 0.03 : this.def.mass >= 1.5 ? 0.07 : 0.12;
        const rawSelf = (res.armored ? 72 : 34) * clamp(impactSpeed / 22, 0.5, 1.5) * (1 / Math.max(0.8, Math.sqrt(this.def.mass)));
        const selfDmg = Math.min(Math.round(rawSelf), Math.round(this.def.maxHealth * capFrac));
        this.absorbDamage(selfDmg, undefined, false, heavyRam ? 'crash' : 'light', false);
      }
    }
  }

  /**
   * GTA-style Tiered Roadkill Sweep!
   *   - Low-Med Speed (`< 13.5 m/s`): Non-gib hood-vault ragdoll (flies up & tumbles over the windshield!).
   *   - High Speed (`13.5..24 m/s`): Ragdoll launch + side-clipped PARTIAL DISMEMBERMENT (`armL`/`armR`/`legL`/`legR`)!
   *   - Extreme Speed (`>= 24 m/s`) OR Heavy Armor (`mass >= 8`): Full catastrophic gore gib!
   */
  private stepRoadkill(dt: number): void {
    for (const [uid, t] of this.rammedCooldown) {
      if (t <= dt) this.rammedCooldown.delete(uid);
      else this.rammedCooldown.set(uid, t - dt);
    }

    if (this.phys.speed < this.def.ramSpeed) return;
    this.roadkillTimer -= dt;
    if (this.roadkillTimer > 0) return;
    this.roadkillTimer = ROADKILL_INTERVAL;

    const radius = Math.max(this.def.halfWidth, this.def.halfLength) + 0.65;
    const count = this.ctx.enemies.query(this.phys.position, radius, _enemies);
    if (count === 0) return;

    const speed = this.phys.speed;
    const speedRatio = clamp(speed / this.def.maxSpeed, 0.5, 1.9);
    const dmg = this.def.ramDamage * speedRatio;
    const rx = Math.cos(this.phys.yaw);
    const rz = -Math.sin(this.phys.yaw);

    // Upward-and-forward bumper launch vector so non-gib ragdolls arc cleanly over the hood!
    _dir.copy(this.phys.velocity).normalize();
    _dir.y = speed < 14 ? 0.65 : 0.45;
    _dir.normalize();

    const heavyCrush = this.def.mass >= 8.0;
    const extremeSpeed = speed >= 24.0 || heavyCrush;
    const partialSeverTier = !extremeSpeed && speed >= 13.5;

    for (let i = 0; i < count; i++) {
      const e = _enemies[i]!;
      if (!e.alive || this.rammedCooldown.has(e.uid)) continue;
      if (Math.abs(e.position.y - this.phys.position.y) > 2.8) continue;
      this.rammedCooldown.set(e.uid, 0.45);

      let region: GoreRegion | undefined;
      let severMult = 0.45;
      if (partialSeverTier) {
        const dx = e.position.x - this.phys.position.x;
        const dz = e.position.z - this.phys.position.z;
        const sideDot = dx * rx + dz * rz;
        if (Math.abs(sideDot) > this.def.halfWidth * 0.25 || speed > 17.5) {
          const leftSide = sideDot >= 0;
          region = leftSide
            ? (Math.random() < 0.55 ? 'armL' : 'legL')
            : (Math.random() < 0.55 ? 'armR' : 'legR');
          severMult = 6.5;
        }
      } else if (extremeSpeed) {
        severMult = 4.0;
      }

      const res = this.ctx.enemies.applyDamage(e, {
        amount: dmg,
        type: 'melee',
        point: e.center,
        dir: _dir,
        force: (extremeSpeed ? 260 : partialSeverTier ? 210 : 155) * speedRatio,
        source: `${this.def.id}_roadkill`,
        region,
        gib: extremeSpeed,
        severMult,
      });
      this.ctx.audio?.play('metal_clang', { position: e.center, volume: 0.72, pitch: extremeSpeed ? 0.68 : 0.84 });
      if (this.occupied) {
        this.ctx.camera?.addTrauma?.(extremeSpeed ? 0.22 : 0.13);
        if (res.killed) {
          this.ctx.hud?.floatText?.(e.center, region ? 'CLIPPED!' : 'ROADKILL', '#ff9e3b');
          this.ctx.events?.emit?.('vehicle:roadkill', {
            vehicleId: this.def.id,
            position: e.center.clone(),
            speed: this.phys.speed,
          });
        }
      }
    }
  }

  private stepEffects(dt: number, occupied: boolean): void {
    const showBoost = this.phys.boosting || this.phys.dumpBurnTimer > 0 || (this.def.category === 'jet' && occupied && !this.phys.vtolMode);
    for (const g of this.model.boostGlow) {
      g.visible = showBoost;
      if (showBoost) {
        const base = this.phys.boosting || this.phys.dumpBurnTimer > 0 ? 1.2 : 0.68;
        const s = base + Math.sin(this.clock * 45) * 0.22;
        g.scale.set(1, 1, s);
      }
    }

    if (this.model.dumpBurnGlow) {
      const showTorch = this.phys.dumpBurnTimer > 0;
      for (const tg of this.model.dumpBurnGlow) {
        tg.visible = showTorch;
        if (showTorch) {
          const s = 0.92 + Math.sin(this.clock * 54) * 0.24;
          tg.scale.set(0.95 + Math.sin(this.clock * 33) * 0.14, 0.95 + Math.cos(this.clock * 37) * 0.14, s);
        } else {
          tg.scale.setScalar(0.001);
        }
      }
      if (showTorch) {
        this.dumpBurnWakeTimer -= dt;
        if (this.dumpBurnWakeTimer <= 0) {
          this.dumpBurnWakeTimer = 0.18;
          const fx = Math.sin(this.phys.yaw);
          const fz = Math.cos(this.phys.yaw);
          _origin.set(
            this.phys.position.x - fx * 14.5,
            this.phys.position.y + 1.8,
            this.phys.position.z - fz * 14.5,
          );
          this.ctx.fx?.smoke?.(_origin, 0xff7a24, 1.85, 0.95);
          this.ctx.fx?.sparks?.(_origin, _up, 10, 0xffc844);
          // Drop burning fuel fireball that ignites the ground below if skimming low!
          if (this.phys.altitude < 42) {
            _vel.set(this.phys.velocity.x * 0.3, -18, this.phys.velocity.z * 0.3);
            this.ctx.combat.spawnProjectile({
              origin: _origin,
              velocity: _vel,
              kind: 'shell',
              team: 'player',
              damage: 140,
              source: 'lancer_dump_burn',
              gravity: 24,
              lifetime: 3.5,
              trail: 'smoke',
              size: 0.55,
              napalm: true,
              explosion: {
                radius: 7.5,
                damage: 180,
                kind: 'rocket',
                selfDamage: 0,
                scale: 1.1,
                shake: 0.25,
              },
            });
          }
        }
      }
    }

    // F-22 Raptor high-G Cobra wingtip condensation trails!
    if (this.phys.cobraTimer > 0) {
      this.cobraVaporTimer -= dt;
      if (this.cobraVaporTimer <= 0) {
        this.cobraVaporTimer = 0.055;
        const rx = Math.cos(this.phys.yaw);
        const rz = -Math.sin(this.phys.yaw);
        for (const side of [-1, 1]) {
          _origin.set(
            this.phys.position.x + rx * side * 4.5,
            this.phys.position.y + 1.4,
            this.phys.position.z + rz * side * 4.5,
          );
          this.ctx.fx?.smoke?.(_origin, 0xe8f6ff, 0.85, 0.75);
        }
      }
    }

    if (this.model.vtolGlow) {
      const showVtol = this.def.category === 'jet' && occupied && this.phys.vtolMode && (this.phys.altitude > 0.3 || this.inputScratch.climb > 0.1);
      for (const vg of this.model.vtolGlow) {
        vg.visible = showVtol;
        if (showVtol) {
          const s = 0.85 + Math.sin(this.clock * 38) * 0.2;
          vg.scale.set(1, s, 1);
        }
      }
    }

    if (this.model.resupplyRing) {
      this.model.resupplyRing.visible = this.phys.deployed;
      if (this.phys.deployed) {
        this.model.resupplyRing.rotation.y += dt * 0.45;
      }
    }

    if ((this.phys.drifting || (occupied && this.phys.grounded && this.phys.speed > 14)) && this.def.category !== 'helicopter' && this.def.category !== 'jet') {
      this.dustTimer -= dt;
      if (this.dustTimer <= 0) {
        this.dustTimer = this.phys.drifting ? 0.06 : 0.14;
        const fx = Math.sin(this.phys.yaw);
        const fz = Math.cos(this.phys.yaw);
        _origin.set(this.phys.position.x - fx * this.def.halfLength * 0.8, this.phys.groundY + 0.35, this.phys.position.z - fz * this.def.halfLength * 0.8);
        this.ctx.fx?.smoke?.(_origin, 0xcbb596, this.phys.drifting ? 1.2 : 0.75, 0.9);
      }
    }

    const frac = this.health / this.def.maxHealth;
    if (frac < 0.38 || this.phys.abandonedFall) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = frac < 0.2 || this.phys.abandonedFall ? 0.07 : SMOKE_INTERVAL;
        _origin.set(this.phys.position.x, this.phys.position.y + this.def.halfHeight + 0.4, this.phys.position.z);
        this.ctx.fx?.smoke?.(_origin, 0x2e3136, frac < 0.2 || this.phys.abandonedFall ? 1.45 : 0.85, 1.5);
        if (frac < 0.2 || this.phys.abandonedFall) this.ctx.fx?.sparks?.(_origin, _up, 6, 0xff9436);
      }
    }
  }

  private syncTransform(): void {
    const { root, body, turret, barrel, subTurret, wheelsFront, wheelsRear, rotorMain, rotorTail, outriggers } = this.model;
    root.position.copy(this.phys.position);
    root.rotation.set(0, this.phys.yaw, 0);

    const hoverBob = this.def.category === 'hover' ? Math.sin(this.clock * 4.2) * 0.065 : 0;
    body.position.y = (this.model.bodyBaseY ?? 0) + hoverBob;
    body.rotation.set(this.phys.pitch, 0, this.phys.roll);

    const remoteGunnerSpec = this.remoteGunnerSeat >= 1 ? this.def.seats[this.remoteGunnerSeat] : undefined;
    const remoteDrivesMain = Boolean(remoteGunnerSpec?.usesTurret && !this.activeSeatSpec.usesTurret);
    const mainYaw = remoteDrivesMain ? this.remoteGunnerYaw : this.turretYaw;
    const mainPitch = remoteDrivesMain ? this.remoteGunnerPitch : this.turretPitch;
    if (turret) {
      turret.rotation.y = mainYaw;
    }
    if (barrel) {
      barrel.rotation.x = clamp(-mainPitch, -0.55, 0.38);
      barrel.position.z = this.model.barrelBaseZ - this.phys.recoilOffset * 0.55;
    }
    if (subTurret) {
      if (this._seatIndex >= 1 && this.activeSeatSpec.usesSubTurret) {
        subTurret.rotation.y = this.turretYaw - (turret && this.def.id === 'aegis' ? this.turretYaw : 0);
      } else if (remoteGunnerSpec?.usesSubTurret) {
        subTurret.rotation.y = this.remoteGunnerYaw - (turret && this.def.id === 'aegis' ? mainYaw : 0);
      }
    }

    for (const wf of wheelsFront) {
      wf.rotation.order = 'YXZ';
      wf.rotation.y = this.phys.steerAngle;
      wf.rotation.x = this.phys.wheelSpin;
    }
    for (const wr of wheelsRear) {
      wr.rotation.x = this.phys.wheelSpin;
    }

    if (rotorMain) rotorMain.rotation.y = this.phys.rotorAngle;
    if (rotorTail) rotorTail.rotation.x = this.phys.rotorAngle * 2.8;

    // Animated variable-geometry swing wings (Lancer: 0 unswept -> 0.78 rad supersonic delta!)
    if (this.model.wingsLeft) this.model.wingsLeft.rotation.y = this.phys.wingSweep * 0.78;
    if (this.model.wingsRight) this.model.wingsRight.rotation.y = -this.phys.wingSweep * 0.78;

    // Animated ventral internal bomb-bay doors (Lancer triple bays: swing wide on release, close smoothly after 2.2 s)
    if (this.model.bombBayDoors) {
      for (const door of this.model.bombBayDoors) {
        const side = (door.userData.side as number) || 1;
        door.rotation.z = side * this.bombBayOpen * 1.48;
      }
    }

    // Animated 2D thrust-vectoring exhaust nozzles (F-22 Raptor)
    if (this.model.nozzles) {
      for (const noz of this.model.nozzles) {
        noz.rotation.x = this.phys.nozzleDeflect;
      }
    }

    // Retractable tricycle landing gear (tucks away cleanly once airborne!)
    if (this.model.landingGear) {
      this.model.landingGear.visible = this.phys.altitude < 3.2;
    }

    for (let i = 0; i < outriggers.length; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      outriggers[i]!.rotation.z = side * 1.15 * (1 - this.phys.deployAnim);
    }

    if (this.model.riders.length > 0) {
      const spdRatio = clamp(this.phys.speed / Math.max(1, this.def.maxSpeed), 0, 1.2);
      const lookYawDelta = wrapAngle(this.aimYaw - this.phys.yaw);
      for (const r of this.model.riders) {
        if (!r.root.visible) continue;
        animateRider(r, this.phys.steerAngle, spdRatio, clamp(-this.phys.pitch, 0, 0.6), lookYawDelta, this.aimPitch);
      }
    }
  }

  /** Co-op: packs pose & animated part telemetry for remote teammates' screens (13 numbers). */
  wirePose(out: number[]): number[] {
    const p = this.phys;
    let flags = 0;
    if (p.boosting) flags |= 1;
    if (p.vtolMode) flags |= 2;
    if (p.altitude < 3.2) flags |= 4;
    if (p.deployed) flags |= 8;
    if (p.dumpBurnTimer > 0) flags |= 16;
    if (this.health / Math.max(1, this.def.maxHealth) < 0.38) flags |= 32;
    out.length = 13;
    out[0] = Math.round(p.position.x * 100) / 100;
    out[1] = Math.round(p.position.y * 100) / 100;
    out[2] = Math.round(p.position.z * 100) / 100;
    out[3] = Math.round(p.yaw * 1000) / 1000;
    out[4] = Math.round(p.pitch * 1000) / 1000;
    out[5] = Math.round(p.roll * 1000) / 1000;
    out[6] = Math.round(this.turretYaw * 1000) / 1000;
    out[7] = Math.round(this.turretPitch * 1000) / 1000;
    out[8] = Math.round(p.steerAngle * 1000) / 1000;
    out[9] = Math.round(p.wheelSpin * 100) / 100;
    out[10] = Math.round(p.rotorAngle * 100) / 100;
    out[11] = Math.round(p.wingSweep * 1000) / 1000;
    out[12] = flags;
    return out;
  }

  /** Refills primary & secondary ammo reserves for all seats and optionally selects a secondary ordnance mode. */
  refillOrdnance(selectSecondaryMode?: number): void {
    for (let i = 0; i < this.def.seats.length; i++) {
      const spec = this.def.seats[i]!;
      const prim = this.primaryState[i];
      if (prim) {
        const pm = this.resolveWeaponMode(spec.primary, prim.modeIndex);
        prim.ammo = pm.magSize;
        prim.reloadLeft = 0;
      }
      const sec = this.secondaryState[i];
      if (sec && spec.secondary) {
        if (typeof selectSecondaryMode === 'number') {
          const count = spec.secondary.fourthMode ? 4 : spec.secondary.thirdMode ? 3 : spec.secondary.altMode ? 2 : 1;
          sec.modeIndex = clamp(Math.floor(selectSecondaryMode), 0, count - 1);
        }
        const sm = this.resolveWeaponMode(spec.secondary, sec.modeIndex);
        sec.ammo = sm.magSize;
        sec.reloadLeft = 0;
      }
    }
    this.syncHud();
  }

  /** Co-op: hides/unhides a parked Motor Pool vehicle while a teammate drives it on their screen. */
  setRemoteHidden(hidden: boolean): void {
    if (this.occupied) return;
    this.remoteHidden = hidden;
    this.model.root.visible = !hidden;
    this.setColliderParked(!hidden);
  }

  /** Co-op: moves an unoccupied Motor Pool vehicle to where a teammate parked/exited it. */
  parkAt(pos: THREE.Vector3, yaw: number): void {
    if (this.occupied) return;
    this.phys.position.copy(pos);
    this.phys.velocity.set(0, 0, 0);
    this.phys.speed = 0;
    this.phys.yaw = yaw;
    this.phys.pitch = 0;
    this.phys.roll = 0;
    this.syncTransform();
    if (!this.remoteHidden) this.setColliderParked(true);
  }

  private setColliderParked(parked: boolean): void {
    if (!this.collider) return;
    if (parked && !this.remoteHidden) {
      _origin.set(this.phys.position.x, this.phys.position.y + this.def.halfHeight, this.phys.position.z);
      _quat.setFromAxisAngle(_up, this.phys.yaw);
      this.collider.setTranslation(_origin);
      this.collider.setRotation(_quat);
    } else {
      _origin.set(0, -1e4, 0);
      this.collider.setTranslation(_origin);
    }
  }

  private startEngine(): void {
    this.engineAudio.start(this.phys.position, this.phys.vtolMode);
  }

  private stopEngine(): void {
    this.engineAudio.stopAll();
  }

  private explodeAndDestroy(kamikaze = false): void {
    if (!this.alive) return;
    this.alive = false;
    const pos = this.phys.position.clone();
    const wasOccupied = this.occupied;
    if (wasOccupied) {
      this.ctx.hud?.feed?.(
        kamikaze ? `${this.def.shortName} KAMIKAZE DETONATION!` : `${this.def.name} DESTROYED — EJECTED!`,
        '#ff4a3a',
      );
      this.exit(false);
      this.ctx.player.push(_vel.set(rand(-4, 4), 11.5, rand(-4, 4)));
    }
    const blastDamage = kamikaze ? this.def.kamikazeDamage : Math.max(420, this.def.kamikazeDamage * 0.7);
    const blastRadius = kamikaze ? 13.5 : 9.5;
    this.ctx.combat.explode(pos.clone().setY(pos.y + 1.2), {
      radius: blastRadius,
      damage: blastDamage,
      kind: kamikaze ? 'rocket' : 'barrel',
      source: kamikaze ? `${this.def.id}_kamikaze` : `${this.def.id}_wreck`,
      team: 'player',
      selfDamage: 0,
      scale: kamikaze ? 2.0 : 1.5,
    });
    this.ctx.audio?.play('veh_destroyed', wasOccupied ? { volume: 1 } : { position: pos, volume: 1 });
    this.dispose();
  }

  private buildSeatPlan(): SeatPlan {
    return {
      label: this.def.name,
      tone: 'vehicle',
      seconds: 9999,
      fov: 76,
      zoomFov: 52,
      aimZooms: false,
      arcCenter: 0,
      arcHalf: Math.PI,
      pitchMin: -1.35,
      pitchMax: 1.15,
      lock: 0,
      roll: 0,
      eye: [0, 0, 0],
      reach: 260,
      grade: null,
      enemyColor: '#ff5a3a',
      grace: 1.2,
      shake: 0.75,
      exposed: true,
    };
  }

  private buildHintText(): string {
    const spec = this.activeSeatSpec;
    if (spec.passengerWeapons) {
      return this.exitLocked
        ? 'HAND WEAPONS ACTIVE // 1-9 SWITCH GUN // F DRIVER SEAT'
        : 'HAND WEAPONS ACTIVE // 1-9 SWITCH GUN // F DRIVER SEAT // E EXIT';
    }
    if (spec.holdRToggleSecondary && spec.secondary) {
      const parts: string[] = ['LMB FIRE'];
      if (spec.aimZooms) parts.push('RMB ZOOM');
      parts.push(`HOLD R ${spec.secondary.name}`, 'R RELOAD');
      if (this.def.seats.length > 1) parts.push('F SEAT');
      if (spec.chaseDist > 0.5) parts.push('C VIEW');
      if (!this.exitLocked) parts.push('E EXIT');
      return parts.join(' // ');
    }
    const parts: string[] = ['WASD DRIVE', 'SHIFT BOOST'];
    if (this.def.category === 'jet') {
      parts.push(
        this.def.id === 'raptor'
          ? 'SPACE TAKEOFF // SHIFT SUPERCRUISE // R MISSILES // Q COBRA+FLARES'
          : this.def.id === 'lancer'
            ? 'SPACE TAKEOFF // SHIFT MACH SWEEP // R BOMBS // Q DUMP&BURN'
            : this.def.id === 'hornet'
              ? 'SPACE TAKEOFF // SHIFT AFTERBURNER // R ORDNANCE // Q FLARES'
              : 'SPACE LIFT // SHIFT AFTERBURNER // R ORDNANCE // Q VTOL/FLARES',
      );
    } else if (this.def.category === 'helicopter') {
      parts.push('SPACE CLIMB // CTRL DESCEND // Q FLARES');
    } else if (this.def.category === 'hover') {
      parts.push('HOLD LMB LANCE // SPACE HOP // Q OVERCHARGE');
    } else if (this.def.category === 'moto') {
      parts.push('SPACE DRIFT // Q WHEELIE');
    } else if (this.def.id === 'aegis') {
      parts.push('R APFSDS/HE // Q IR SMOKE');
    } else if (this.def.id === 'jackal') {
      parts.push('SPACE DRIFT // Q AUTO-TURRET');
    } else {
      parts.push(`Q ${this.def.special.name}`);
    }
    if (this.def.seats.length > 1) parts.push('F SEAT');
    if (spec.chaseDist > 0.5) parts.push('C VIEW');
    if (!this.exitLocked) parts.push('E EXIT');
    return parts.join(' // ');
  }

  private syncHud(): void {
    const seat = this.seat;
    if (!seat) return;
    const spec = this.activeSeatSpec;
    const prim = this.primaryState[this._seatIndex]!;
    const sec = this.secondaryState[this._seatIndex];

    const primMode = this.resolveWeaponMode(spec.primary, prim.modeIndex);
    const holdRToggle = Boolean(spec.holdRToggleSecondary && spec.secondary && sec);
    seat.weapons.length = 0;
    if (spec.primary.kind !== 'none') {
      const primSelected = !holdRToggle || !this.secondarySelected;
      const primPrefix = spec.primary.kind === 'lance'
        ? 'HOLD LMB '
        : holdRToggle
          ? (primSelected ? 'LMB ' : 'HOLD R ')
          : 'LMB ';
      seat.weapons.push({
        name: `${primPrefix}${primMode.name}`,
        ammo: primMode.magSize > 0 ? prim.ammo : 999,
        max: primMode.magSize > 0 ? primMode.magSize : 999,
        reload: prim.reloadLeft > 0 ? 1 - prim.reloadLeft / primMode.reloadSeconds : -1,
        selected: primSelected,
      });
    }
    let ammoModeText = '';
    if (spec.primary.altMode) ammoModeText = primMode.name;
    if (spec.secondary && sec && spec.secondary.kind !== 'none') {
      const secMode = this.resolveWeaponMode(spec.secondary, sec.modeIndex);
      if (spec.secondary.altMode) ammoModeText = secMode.name;
      if (holdRToggle) ammoModeText = this.secondarySelected ? secMode.name : primMode.name;
      seat.weapons.push({
        name: holdRToggle
          ? `${this.secondarySelected ? 'LMB' : 'HOLD R'} ${secMode.name}`
          : `RMB ${secMode.name}`,
        ammo: secMode.magSize > 0 ? sec.ammo : 999,
        max: secMode.magSize > 0 ? secMode.magSize : 999,
        reload: sec.reloadLeft > 0 ? 1 - sec.reloadLeft / secMode.reloadSeconds : -1,
        selected: holdRToggle ? this.secondarySelected : undefined,
      });
    }

    const hullFrac = clamp(this.health / this.def.maxHealth, 0, 1);
    seat.hull = hullFrac;
    seat.hullText = `${Math.ceil(this.health)} / ${this.def.maxHealth}`;
    seat.heat = this.heat;
    seat.overheated = this.overheated;
    const crewCount = this.occupiedSeatCount;
    seat.status = crewCount > 1 ? `${spec.name} · CREW ${crewCount}/${this.def.seats.length}` : spec.name;

    const h = this.hudScratch;
    h.hudMode = spec.hudMode;
    h.seatIndex = this._seatIndex;
    h.seatName = spec.name;
    h.speedKmh = this.phys.speed * 3.6;
    h.boost = this.phys.boostFuel;
    h.boosting = this.phys.boosting;
    h.specialLabel = this.def.special.id === 'vtol'
      ? (this.phys.vtolMode ? 'JET MODE' : 'VTOL HOVER')
      : this.def.special.name;
    h.specialActive = this.specialActive || this.flareRemaining > 0 || this.phys.cobraTimer > 0 || this.phys.dumpBurnTimer > 0;
    h.specialReady = this.specialCooldown <= 0;
    h.specialFraction = this.def.special.cooldown > 0 ? clamp(1 - this.specialCooldown / this.def.special.cooldown, 0, 1) : 1;
    h.cameraLabel = !this.thirdPerson || spec.chaseDist <= 0.5 ? '1P' : '3P';
    h.ammoMode = ammoModeText;
    h.deployed = this.phys.deployed;
    h.chargeFraction = this.lanceCharge;
    h.missileWarning = this.missileWarning;
    h.radarLockWarning = this.radarLockWarning;
    h.rwrLabel = this.extRwrLabel;
    h.vtolMode = this.phys.vtolMode;
    h.pitchRad = -this.phys.pitch;
    h.rollRad = this.phys.roll;
    h.altitudeM = this.phys.altitude;
    seat.vehicleHud = h;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.alive = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
    }
    if (this.seat) this.exit(true);
    this.stopEngine();
    for (const gun of this.mountGuns.values()) {
      this.ctx.render?.scene?.remove(gun.root);
    }
    this.mountGuns.clear();
    this.ctx.render?.scene?.remove(this.model.root);
    if (this.collider) {
      this.ctx.physics?.world?.removeCollider?.(this.collider, false);
      this.collider = null;
    }
    if (this.kinCollider) {
      this.ctx.physics?.world?.removeCollider?.(this.kinCollider, false);
      this.kinCollider = null;
    }
    if (this.kinBody) {
      this.ctx.physics?.world?.removeRigidBody?.(this.kinBody);
      this.kinBody = null;
    }
  }
}
