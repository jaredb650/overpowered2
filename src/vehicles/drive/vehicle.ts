/**
 * A single live player-driveable vehicle (Jackal, Aegis, Kestrel, Viper, or Bastion).
 *
 * Handles:
 *   - Multi-seat boarding, exiting, and instant seat swapping (`[F]` cycle or `[1]-[3]` direct).
 *   - Smooth 3rd-person chase camera with wall collision pull-in AND 1st-person cockpit/gunner view (`[C]`).
 *   - Independent turret aiming & slewing, barrel elevation & firing recoil, wheel steer/spin, rotor spin,
 *     Bastion hydraulic outrigger deploy animation & resupply aura ring.
 *   - Primary (`LMB`), Secondary (`RMB`), Reload / Ammo Swap (`[R]`), and Special (`[Q]`: auto-turret,
 *     IR smoke, IR flares, overcharge pulse, or Bastion bunker deploy + resupply heal/ammo aura).
 *   - Kinetic roadkills / ramming sweeps against enemies & soft enemy vehicles.
 *   - Directional armor damage interception (`player.interceptDamage`) + critical warning + flaming wreck eject.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CG, type Ctx, type LoopHandle, type MuzzleKind, type PlayerDamage, type RayHit } from '../../core/contracts';
import type { EnemyInstance, MissileTarget } from '../../core/gameplay';
import { clamp, damp, dampAngle, rand, randomInCone, wrapAngle } from '../../core/math';
import type { ModelMaterials } from '../../progression/modelkit';
import { GunnerSeat, type SeatPlan, type SeatRig } from '../seat';
import { DRIVE_VEHICLES } from './data';
import { buildVehicleModel, type VehicleModelRig } from './models';
import { createPhysicsState, stepVehiclePhysics } from './physics';
import type {
  DriveVehicleDef,
  DriveVehicleId,
  VehicleHudData,
  VehicleInput,
  VehiclePhysicsState,
  VehicleSeatSpec,
  VehicleWeaponSpec,
} from './types';

interface WeaponRuntime {
  ammo: number;
  cooldown: number;
  reloadLeft: number;
  altActive: boolean;
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
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _up = new THREE.Vector3(0, 1, 0);
const _enemies: EnemyInstance[] = [];
const _paintTargets: MissileTarget[] = [];

const ROADKILL_INTERVAL = 0.06;
const SMOKE_INTERVAL = 0.14;
const RESUPPLY_INTERVAL = 1.4;
const RESUPPLY_RADIUS = 14;
const AUTO_TURRET_RANGE = 68;

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

  private seat: GunnerSeat | null = null;
  private _seatIndex = 0;
  private thirdPerson = true;
  private aimYaw = 0;
  private aimPitch = -0.06;
  private turretYaw = 0;
  private turretPitch = 0;
  private heat = 0;
  private overheated = false;
  private readonly primaryState: WeaponRuntime[] = [];
  private readonly secondaryState: (WeaponRuntime | null)[] = [];
  private podFlip = false;

  private specialActive = false;
  private specialRemaining = 0;
  private specialCooldown = 0;
  private autoTurretCooldown = 0;
  private resupplyTimer = 0;
  private roadkillTimer = 0;
  private smokeTimer = 0;
  private dustTimer = 0;
  private engineLoop: LoopHandle | null = null;
  private collider: RAPIER.Collider | null = null;
  private readonly damageIntercept = (damage: PlayerDamage): boolean => this.absorbDamage(damage.amount, damage.from);
  private readonly inputScratch: VehicleInput = {
    throttle: 0,
    steer: 0,
    climb: 0,
    boost: false,
    handbrake: false,
    firePrimary: false,
    fireSecondary: false,
    specialPressed: false,
    reloadPressed: false,
    cameraTogglePressed: false,
  };
  private readonly hudScratch: { -readonly [K in keyof VehicleHudData]: VehicleHudData[K] };
  private readonly rammedCooldown = new Map<number, number>();
  private clock = 0;
  private mouseIdleTimer = 0;
  private disposed = false;

  constructor(
    private readonly ctx: Ctx,
    materials: ModelMaterials,
    private readonly seats: SeatRig,
    private readonly holster: () => void,
    id: DriveVehicleId,
    position: THREE.Vector3,
    yaw: number,
    opts?: { velocity?: THREE.Vector3; healthFraction?: number; poolSlot?: string | null },
  ) {
    this.def = DRIVE_VEHICLES[id];
    this.poolSlot = opts?.poolSlot ?? null;
    this.health = Math.round(this.def.maxHealth * clamp(opts?.healthFraction ?? 1, 0.25, 1));
    this.phys = createPhysicsState(position, yaw, opts?.velocity);
    this.aimYaw = yaw;
    this.model = buildVehicleModel(id, materials);
    this.model.root.name = `drive.${id}.${this.uid}`;
    ctx.render.scene.add(this.model.root);

    // Initialize weapon magazines per seat.
    for (const s of this.def.seats) {
      this.primaryState.push({ ammo: s.primary.magSize, cooldown: 0, reloadLeft: 0, altActive: false });
      this.secondaryState.push(s.secondary ? { ammo: s.secondary.magSize, cooldown: 0, reloadLeft: 0, altActive: false } : null);
    }

    // Create a world static hull box collider while parked so bullets spark off it and players don't walk through it.
    if (ctx.physics?.addStaticBox) {
      const half = new THREE.Vector3(this.def.halfWidth * 0.9, this.def.halfHeight * 0.85, this.def.halfLength * 0.9);
      const center = position.clone().setY(position.y + this.def.halfHeight);
      this.collider = ctx.physics.addStaticBox(center, half, null, 'metal');
    }

    this.hudScratch = {
      id: this.def.id,
      name: this.def.name,
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
      cameraLabel: '3P',
      ammoMode: '',
      airborne: this.def.category === 'helicopter',
      deployed: false,
      lowHealth: false,
    };

    this.syncTransform();
  }

  get occupied(): boolean {
    return this.seat !== null && this.seats.seat === this.seat;
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

  /** Seats the local player in `seatIndex` (0 = Driver/Pilot) and hands control to this vehicle. */
  board(seatIndex = 0): boolean {
    if (!this.alive || this.occupied || this.seats.occupied) return false;
    this._seatIndex = clamp(seatIndex, 0, this.def.seats.length - 1);
    this.thirdPerson = this._seatIndex === 0;
    this.aimYaw = this.phys.yaw;
    this.aimPitch = -0.06;

    // Move static collider far underground while occupied so our own rays and camera pull-in never snag on our hull.
    this.setColliderParked(false);

    const plan = this.buildSeatPlan();
    const seat = new GunnerSeat(this.ctx, this.seats, plan);
    seat.hintText = this.buildHintText();
    this.seat = seat;
    this.holster();

    // Seat the player using SeatRig, hiding the body safely inside the vehicle hull.
    seat.fixed(this.phys.position);
    seat.noWayOut = false;
    seat.board();
    this.updateAimTarget();
    seat.sit(_target, _pivot);

    // Intercept all incoming damage to the parked player and route it into our vehicle armor!
    this.ctx.player.interceptor = this.damageIntercept;
    this.ctx.audio?.play('metal_clang', { position: this.phys.position, volume: 0.55, pitch: 0.82 });
    this.startEngine();
    this.syncHud();
    return true;
  }

  /** Switches seats cleanly inside the same vehicle (`[F]` or `1`/`2`/`3`). */
  switchSeat(index: number): void {
    if (!this.occupied || !this.seat) return;
    const next = ((index % this.def.seats.length) + this.def.seats.length) % this.def.seats.length;
    if (next === this._seatIndex) return;
    this._seatIndex = next;
    // Driver/Pilot defaults to 3P chase; gunners default to crisp turret sight 1P (still toggleable via [C]/wheel).
    this.thirdPerson = next === 0;
    this.seat.hintText = this.buildHintText();
    this.ctx.audio?.play('reload_bolt', { position: this.phys.position, volume: 0.65, pitch: 1.05 });
    this.ctx.hud?.feed?.(`${this.def.shortName} // ${this.activeSeatSpec.name}`, this.def.color);
    this.syncHud();
  }

  /** Exits cleanly beside the vehicle (preserving forward momentum on Viper for badass jump-offs!). */
  exit(quiet = false): void {
    if (!this.seat) return;
    const seat = this.seat;
    this.seat = null;
    if (this.ctx.player.interceptor === this.damageIntercept) {
      this.ctx.player.interceptor = null;
    }

    // Place the player cleanly to the left side of the vehicle at ground height (or airborne if bailing from Kestrel).
    const exitOffset = this.def.halfWidth + 1.45;
    const rx = Math.cos(this.phys.yaw);
    const rz = -Math.sin(this.phys.yaw);
    const ex = this.phys.position.x + rx * exitOffset;
    const ez = this.phys.position.z + rz * exitOffset;
    const navY = this.ctx.world?.nav?.groundHeight?.(ex, this.phys.position.y + 2.5, ez);
    const ey = this.def.category === 'helicopter' && this.phys.altitude > 2.5
      ? this.phys.position.y
      : (typeof navY === 'number' && Number.isFinite(navY) ? navY : this.phys.groundY);
    this.ctx.player.carry(_origin.set(ex, ey, ez));

    seat.vehicleHud = null;
    seat.leave(quiet);

    // Momentum-preserving eject when leaping off Viper or bailing at speed!
    if (!quiet && this.phys.speed > 6) {
      _vel.set(this.phys.velocity.x * 0.65, this.def.category === 'hover' ? 5.5 : 3.2, this.phys.velocity.z * 0.65);
      this.ctx.player.push(_vel);
    }

    if (this.alive) this.setColliderParked(true);
    this.stopEngine();
  }

  /** Applies damage to the vehicle hull (applying Aegis directional armor & Bastion deployed resistance). */
  absorbDamage(amount: number, from?: THREE.Vector3): boolean {
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
    if (this.specialActive && (this.def.special.id === 'smoke' || this.def.special.id === 'flares')) mult *= 0.65;

    const dealt = amount * mult;
    this.health = Math.max(0, this.health - dealt);
    if (this.occupied) {
      this.ctx.camera?.addTrauma?.(clamp(dealt * 0.008, 0.06, 0.45));
      this.ctx.audio?.play('metal_clang', { position: this.phys.position, volume: 0.45, pitch: rand(0.85, 1.15) });
    }
    if (this.health <= 0) {
      this.explodeAndDestroy();
    }
    return true;
  }

  /** Per-frame update (runs whether occupied or parked so coasting, outriggers, auto-turret & resupply keep working). */
  update(dt: number): void {
    if (!this.alive || this.disposed || dt <= 0) return;
    this.clock += dt;

    // If the seat was externally closed (e.g. player death / run reset), clean up gracefully.
    if (this.seat && (this.seat.stage === 'left' || this.seats.seat !== this.seat)) {
      this.exit(true);
    }

    const occupied = this.occupied;
    this.readInput(occupied);

    if (occupied) {
      if (this.ctx.input.pressed('interact')) {
        this.exit(false);
        return;
      }
      if (this.inputScratch.cameraTogglePressed) {
        this.thirdPerson = !this.thirdPerson;
      }
      if (this.ctx.input.pressed('melee')) {
        this.switchSeat(this._seatIndex + 1);
      } else if (this.ctx.input.pressed('weapon1') && this.def.seats.length >= 1) {
        this.switchSeat(0);
      } else if (this.ctx.input.pressed('weapon2') && this.def.seats.length >= 2) {
        this.switchSeat(1);
      } else if (this.ctx.input.pressed('weapon3') && this.def.seats.length >= 3) {
        this.switchSeat(2);
      }
      this.updateMouseLook(dt);
    }

    // Step physics (only driver/pilot seat feeds drive controls; gunners let vehicle coast or Kestrel auto-hover!).
    const driveActive = occupied && this._seatIndex === 0;
    const ownHandle = this.collider?.handle;
    stepVehiclePhysics(this.def, this.phys, this.inputScratch, dt, this.ctx.world, this.ctx.physics, driveActive, ownHandle);

    // Kestrel pilot smoothly aligns helicopter nose toward camera yaw so flight feels effortlessly intuitive!
    if (driveActive && this.def.category === 'helicopter') {
      const targetYaw = this.aimYaw;
      this.phys.yaw = dampAngle(this.phys.yaw, targetYaw, 3.6, dt);
    } else if (driveActive && (this.def.category === 'hover' || this.def.category === 'wheeled')) {
      // Follow steering yaw smoothly when driving with WASD, while preserving unrestricted 360° mouse free-look.
      if (this.mouseIdleTimer > 0.2 && Math.abs(this.phys.yawRate) > 0.01) {
        this.aimYaw = wrapAngle(this.aimYaw + this.phys.yawRate * dt * 0.85);
      }
      if (this.mouseIdleTimer > 0.85 && this.phys.speed > 4) {
        this.aimYaw = dampAngle(this.aimYaw, this.phys.yaw, 2.2, dt);
      }
    }

    // Update special timers & triggers.
    this.stepSpecial(dt, occupied);
    this.stepWeapons(dt, occupied);
    this.stepAutoTurret(dt);
    this.stepResupplyAura(dt);
    this.stepRoadkill(dt);
    this.stepEffects(dt, occupied);
    this.syncTransform();

    if (occupied && this.seat) {
      this.ctx.player.carry(this.phys.position);
      this.updateCamera(dt);
      this.updateEngineAudio();
      this.syncHud();
    } else if (this.collider) {
      this.setColliderParked(true);
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
    inp.specialPressed = false;
    inp.reloadPressed = false;
    inp.cameraTogglePressed = false;
    if (!occupied) return;

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
    inp.firePrimary = input.isDown('fire');
    inp.fireSecondary = input.isDown('aim');
    inp.specialPressed = input.pressed('stim');
    inp.reloadPressed = input.pressed('reload');
    const wheel = input.consumeWheel ? input.consumeWheel() : 0;
    inp.cameraTogglePressed =
      (this.def.category !== 'helicopter' && input.pressed('slide'))
      || input.pressed('weaponNext')
      || input.pressed('weaponPrev')
      || wheel !== 0;
  }

  private updateMouseLook(dt: number): void {
    const { input, player } = this.ctx;
    const look = input.frameLook;
    if (Math.abs(look.x) > 0.001 || Math.abs(look.y) > 0.001) {
      this.mouseIdleTimer = 0;
    } else {
      this.mouseIdleTimer += dt;
    }
    const scale = player.sensitivity * player.lookScale;
    this.aimYaw = wrapAngle(this.aimYaw - look.x * scale);
    const spec = this.activeSeatSpec;
    this.aimPitch = clamp(
      this.aimPitch - look.y * scale * (player.invertY ? -1 : 1),
      spec.pitchMin,
      spec.pitchMax,
    );

    // Slew main turret toward aimYaw relative to chassis hull yaw.
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

    // Direction vector for our look angles (Three.js vehicle convention: yaw=0 faces +Z).
    const cp = Math.cos(this.aimPitch);
    _aim.set(Math.sin(this.aimYaw) * cp, Math.sin(this.aimPitch), Math.cos(this.aimYaw) * cp);
    _target.copy(_pivot).addScaledVector(_aim, 120);
  }

  private updateCamera(dt: number): void {
    const seat = this.seat;
    if (!seat) return;
    const spec = this.activeSeatSpec;
    _quat.setFromEuler(_euler.set(this.phys.pitch, this.phys.yaw, this.phys.roll));

    // Aim direction along (aimYaw, aimPitch) where yaw=0 faces +Z.
    const cp = Math.cos(this.aimPitch);
    const dirX = Math.sin(this.aimYaw) * cp;
    const dirY = Math.sin(this.aimPitch);
    const dirZ = Math.cos(this.aimYaw) * cp;
    _aim.set(dirX, dirY, dirZ);

    if (this.thirdPerson && spec.chaseDist > 0.5) {
      // Pivot over vehicle hull, pull back along -aim with subtle pitch elevation + wall collision clamp!
      _pivot.set(spec.chaseOffset[0], spec.chaseOffset[1], spec.chaseOffset[2])
        .applyQuaternion(_quat)
        .add(this.phys.position);
      const viewPitch = clamp(this.aimPitch - spec.chasePitchBias, -0.85, 0.55);
      const vcp = Math.cos(viewPitch);
      _dir.set(-Math.sin(this.aimYaw) * vcp, -Math.sin(viewPitch), -Math.cos(this.aimYaw) * vcp).normalize();
      let dist = spec.chaseDist + (this.phys.boosting ? 1.15 : 0);
      if (this.ctx.physics?.raycastInto?.(_pivot, _dir, dist + 0.6, CG.World, _hit)) {
        dist = Math.max(1.8, _hit.distance - 0.55);
      }
      _eye.copy(_pivot).addScaledVector(_dir, dist);
      // Never sink camera below the desert floor.
      const camGround = this.ctx.world?.nav?.groundHeight?.(_eye.x, _eye.y + 2, _eye.z);
      if (typeof camGround === 'number' && Number.isFinite(camGround)) {
        _eye.y = Math.max(_eye.y, camGround + 0.75);
      }
    } else {
      // First-person cockpit / turret sight.
      _eye.set(spec.fpEye[0], spec.fpEye[1], spec.fpEye[2])
        .applyQuaternion(_quat)
        .add(this.phys.position);
    }

    // Raycast sight from eye along aim so weapons converge accurately on the crosshair!
    let aimDist = 240;
    if (this.ctx.physics?.raycastInto?.(_eye, _aim, 240, CG.World, _hit)) {
      aimDist = Math.max(4, _hit.distance);
      seat.point.copy(_hit.point);
    } else {
      seat.point.copy(_eye).addScaledVector(_aim, 240);
    }
    seat.range = aimDist;
    seat.altitude = this.phys.altitude;

    // Convert our +Z-forward yaw into CameraSystem's -Z-forward SeatView yaw (`camYaw = aimYaw - PI`).
    const camYaw = wrapAngle(this.aimYaw - Math.PI);
    seat.yaw = camYaw;
    seat.pitch = this.aimPitch;
    seat.aim.copy(_aim);
    seat.view.position.copy(_eye);
    seat.view.yaw = camYaw;
    seat.view.pitch = this.aimPitch;
    seat.view.roll = this.thirdPerson ? this.phys.roll * 0.22 : this.phys.roll * 0.65;

    // Dynamic FOV boost surge for exhilarating speed sensation!
    const baseFov = this.thirdPerson ? 76 : 64;
    const targetFov = baseFov + (this.phys.boosting ? 9 : 0) + clamp(this.phys.speed * 0.14, 0, 7);
    this.ctx.camera?.setZoom?.(targetFov);
    this.ctx.camera?.syncSeat?.();

    // Update GunnerSeat enemy boxes & keep subtle heat cooling.
    const coolRate = this.phys.deployed && this.def.id === 'bastion' ? 0.56 : 0.3;
    this.heat = Math.max(0, this.heat - coolRate * dt);
    if (this.overheated && this.heat < 0.28) this.overheated = false;
  }

  private stepSpecial(dt: number, occupied: boolean): void {
    if (this.specialCooldown > 0) this.specialCooldown = Math.max(0, this.specialCooldown - dt);
    if (this.specialActive && this.def.special.id !== 'autoTurret' && this.def.special.id !== 'deploy') {
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
      return;
    }

    if (this.specialCooldown > 0) return;
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
      this.ctx.hud?.feed?.('IR SMOKE SCREEN DEPLOYED', this.def.color);
    } else if (sp.id === 'flares') {
      this.ctx.audio?.play('steam_burst', { position: this.phys.position, volume: 0.9, pitch: 1.35 });
      for (let i = 0; i < 6; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        _origin.copy(this.phys.position).addScaledVector(_up, -0.4);
        _dir.set(side * rand(0.5, 1), -0.4, rand(-0.6, 0.2)).normalize();
        this.ctx.fx?.sparks?.(_origin, _dir, 14, 0xffd166);
      }
      this.ctx.combat?.interceptEnemyProjectiles?.(this.phys.position, 28, 6);
      this.ctx.hud?.feed?.('IR FLARES LAUNCHED', this.def.color);
    } else if (sp.id === 'pulse') {
      this.phys.boostFuel = 1;
      this.ctx.audio?.play('steam_burst', { position: this.phys.position, volume: 0.85, pitch: 1.2 });
      this.ctx.combat?.explode?.(this.phys.position, {
        radius: 9.5,
        damage: 220,
        kind: 'grenade',
        source: 'viper_overcharge',
        team: 'player',
        selfDamage: 0,
        scale: 1.1,
      });
      this.ctx.hud?.feed?.('VIPER OVERCHARGE — BOOST FULL', this.def.color);
    }
  }

  private stepWeapons(dt: number, occupied: boolean): void {
    // Tick cooldowns & reloads across all seats so gunner weapons finish reloading seamlessly.
    for (let i = 0; i < this.def.seats.length; i++) {
      const spec = this.def.seats[i]!;
      this.tickWeaponRuntime(this.primaryState[i]!, spec.primary, dt);
      const sec = this.secondaryState[i];
      if (sec && spec.secondary) this.tickWeaponRuntime(sec, spec.secondary, dt);
    }

    if (!occupied) return;

    const spec = this.activeSeatSpec;
    const prim = this.primaryState[this._seatIndex]!;
    const sec = this.secondaryState[this._seatIndex];

    // [R]: If primary has alternate ammo mode (Aegis 120mm APFSDS <-> HE-FRAG), toggle ammo cleanly! Otherwise reload.
    if (this.inputScratch.reloadPressed) {
      if (spec.primary.altMode) {
        prim.altActive = !prim.altActive;
        const label = prim.altActive ? spec.primary.altMode.name : spec.primary.name;
        this.ctx.audio?.play('reload_bolt', { position: this.phys.position, volume: 0.7, pitch: 0.9 });
        this.ctx.hud?.feed?.(`AMMO LOADED: ${label}`, this.def.color);
      } else {
        if (prim.ammo < spec.primary.magSize && prim.reloadLeft <= 0) prim.reloadLeft = spec.primary.reloadSeconds;
        if (sec && spec.secondary && sec.ammo < spec.secondary.magSize && sec.reloadLeft <= 0) sec.reloadLeft = spec.secondary.reloadSeconds;
      }
    }

    if (this.inputScratch.firePrimary && !this.overheated) {
      this.tryFire(spec.primary, prim);
    }
    if (this.inputScratch.fireSecondary && spec.secondary && sec && !this.overheated) {
      this.tryFire(spec.secondary, sec);
    }
  }

  private tickWeaponRuntime(rt: WeaponRuntime, spec: VehicleWeaponSpec, dt: number): void {
    if (rt.cooldown > 0) rt.cooldown = Math.max(0, rt.cooldown - dt);
    if (rt.reloadLeft > 0) {
      rt.reloadLeft -= dt;
      if (rt.reloadLeft <= 0) {
        rt.reloadLeft = 0;
        rt.ammo = spec.magSize;
      }
    }
  }

  private tryFire(spec: VehicleWeaponSpec, rt: WeaponRuntime): void {
    if (rt.cooldown > 0 || rt.reloadLeft > 0) return;
    if (rt.ammo <= 0) {
      rt.reloadLeft = spec.reloadSeconds;
      return;
    }
    rt.ammo--;
    rt.cooldown = 1 / spec.fireRate;
    if (rt.ammo <= 0) rt.reloadLeft = spec.reloadSeconds;

    const heatScale = this.phys.deployed && this.def.id === 'bastion' ? 0.5 : 1;
    this.heat = Math.min(1, this.heat + spec.heatPerShot * heatScale);
    if (this.heat >= 1) this.overheated = true;

    // Resolve world-space muzzle position.
    let slot = spec.muzzleSlot;
    if (slot === 'podLeft' && spec.kind === 'rockets') {
      this.podFlip = !this.podFlip;
      slot = this.podFlip ? 'podLeft' : 'podRight';
    }
    this.model.root.updateMatrixWorld(true);
    this.model.muzzles[slot].getWorldPosition(_muzzle);

    // Converge shot from muzzle onto the player's crosshair sight point!
    const aimPoint = this.seat?.point ?? _target;
    _dir.subVectors(aimPoint, _muzzle);
    if (_dir.lengthSq() < 1) _dir.copy(_aim);
    else _dir.normalize();
    if (spec.spread > 0) randomInCone(_dir, spec.spread, _dir);

    const useAlt = rt.altActive && Boolean(spec.altMode);
    const dmg = useAlt ? spec.altMode!.damage : spec.damage;
    const speed = useAlt ? spec.altMode!.speed : spec.speed;
    const blastR = useAlt ? spec.altMode!.blastRadius : spec.blastRadius;
    const blastK = useAlt ? spec.altMode!.blastKind : spec.blastKind;
    const snd = useAlt ? spec.altMode!.sound : spec.sound;

    if (spec.kind === 'ram') {
      // Wide forward concussion shockwave (Viper Concussion Wave / Bastion Plow Shock Ram).
      _origin.copy(_muzzle).addScaledVector(_dir, 4.2);
      this.ctx.combat.explode(_origin, {
        radius: blastR,
        damage: dmg,
        kind: blastK ?? 'grenade',
        source: spec.id,
        team: 'player',
        selfDamage: 0,
        scale: 1.15,
      });
    } else if (spec.kind === 'rotary' || spec.kind === 'coax' || spec.kind === 'pulse') {
      this.ctx.combat.fireRay(_muzzle, _dir, {
        damage: dmg,
        source: spec.id,
        team: 'player',
        maxDistance: 240,
        tracer: spec.kind === 'pulse' ? 'plasma' : 'heavy',
        tracerFrom: _muzzle,
        blastRadius: blastR > 0 ? blastR : undefined,
        armorPiercing: spec.kind === 'rotary' || spec.kind === 'pulse',
        force: 45,
        severMult: 1.8,
      });
    } else if (spec.kind === 'grenade') {
      // Arcing high-explosive 40mm grenade / 105mm siege mortar!
      _vel.copy(_dir).multiplyScalar(speed);
      _vel.y += spec.id.includes('mortar') ? 22 : 5.5;
      this.ctx.combat.spawnProjectile({
        origin: _muzzle,
        velocity: _vel,
        kind: 'shell',
        team: 'player',
        damage: dmg,
        source: spec.id,
        gravity: spec.id.includes('mortar') ? 26 : 16,
        lifetime: 6,
        trail: 'smoke',
        explosion: {
          radius: blastR,
          damage: dmg,
          kind: blastK ?? 'grenade',
          selfDamage: 0,
          scale: blastR > 8 ? 1.5 : 1.0,
        },
      });
    } else if (spec.kind === 'atgm') {
      // Guided anti-armor missile: picks nearest enemy vehicle or boss near crosshair!
      let lock: MissileTarget | null = null;
      this.ctx.enemies?.vehicles?.paintable?.(_paintTargets);
      let bestDot = 0.82;
      for (const t of _paintTargets) {
        if (!t.alive) continue;
        _origin.subVectors(t.center, _muzzle).normalize();
        const d = _origin.dot(_dir);
        if (d > bestDot) {
          bestDot = d;
          lock = t;
        }
      }
      if (!lock) {
        for (const e of this.ctx.enemies.alive) {
          if (!e.alive) continue;
          _origin.subVectors(e.center, _muzzle).normalize();
          const d = _origin.dot(_dir);
          if (d > bestDot) {
            bestDot = d;
            lock = e;
          }
        }
      }
      _vel.copy(_dir).multiplyScalar(speed);
      this.ctx.combat.spawnProjectile({
        origin: _muzzle,
        velocity: _vel,
        kind: 'rocket',
        team: 'player',
        damage: dmg,
        bossDamage: dmg * 1.25,
        source: spec.id,
        lifetime: 7,
        trail: 'hellfire',
        target: lock,
        turnRate: lock ? 4.2 : 0,
        armorPiercing: true,
        explosion: {
          radius: blastR,
          damage: dmg,
          kind: blastK ?? 'rocket',
          selfDamage: 0,
          scale: 1.4,
        },
      });
    } else {
      // Heavy 120mm tank cannon shell, Hydra rockets, 20mm/30mm autocannon, or Quad 35mm proximity flak!
      _vel.copy(_dir).multiplyScalar(speed);
      const isCannon = spec.kind === 'cannon';
      this.ctx.combat.spawnProjectile({
        origin: _muzzle,
        velocity: _vel,
        kind: spec.kind === 'rockets' ? 'rocket' : 'shell',
        team: 'player',
        damage: dmg,
        bossDamage: isCannon && !useAlt ? dmg * 1.35 : undefined,
        source: spec.id,
        gravity: isCannon ? 6 : spec.kind === 'rockets' ? 1.5 : 3,
        lifetime: 5,
        trail: spec.kind === 'rockets' ? 'smoke' : isCannon ? 'rings' : 'sparks',
        tracer: 'heavy',
        flak: spec.kind === 'flak',
        armorPiercing: isCannon && !useAlt,
        explosion: blastR > 0 ? {
          radius: blastR,
          damage: dmg,
          kind: blastK ?? 'rocket',
          selfDamage: 0,
          scale: isCannon ? (useAlt ? 1.7 : 1.25) : 1.0,
        } : undefined,
      });
    }

    // Tactile firing punch: recoil kick, muzzle flash, camera shake & crisp sound!
    if (spec.recoilKick) {
      this.phys.recoilOffset = Math.min(1, this.phys.recoilOffset + spec.recoilKick);
      if (this.occupied) this.ctx.camera?.addTrauma?.(spec.recoilKick * 0.45);
    }
    const muzzleKind: MuzzleKind =
      spec.kind === 'cannon' || spec.kind === 'autocannon' || spec.kind === 'flak' ? 'autocannon'
      : spec.kind === 'rockets' || spec.kind === 'atgm' ? 'rocket'
      : spec.kind === 'pulse' ? 'plasma'
      : spec.kind === 'rotary' ? 'rotary'
      : 'hmg';
    this.ctx.fx?.muzzleFlash?.(_muzzle, _dir, muzzleKind);
    this.ctx.audio?.play(snd, { position: _muzzle, volume: spec.kind === 'cannon' ? 1.0 : 0.72, pitch: spec.soundPitch ?? 1.0, pitchJitter: 0.04 });
  }

  /** Jackal's toggleable `[Q]` AI roof gunner: tracks & shreds nearest enemy while you drift! */
  private stepAutoTurret(dt: number): void {
    if (this.def.id !== 'jackal' || !this.specialActive || !this.occupied || this._seatIndex !== 0) return;
    this.autoTurretCooldown -= dt;
    if (this.autoTurretCooldown > 0) return;

    this.model.root.updateMatrixWorld(true);
    this.model.muzzles.roof.getWorldPosition(_muzzle);

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
      damage: 28,
      source: 'jackal_auto_turret',
      team: 'player',
      maxDistance: AUTO_TURRET_RANGE + 10,
      tracer: 'heavy',
      tracerFrom: _muzzle,
    });
    this.ctx.fx?.muzzleFlash?.(_muzzle, _dir, 'rotary');
    this.ctx.audio?.play('cannon_shot', { position: _muzzle, volume: 0.42, pitch: 1.55, pitchJitter: 0.06 });
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

  /** High-speed roadkill / armored ramming sweep against enemies in our path! */
  private stepRoadkill(dt: number): void {
    // Decay per-enemy ram cooldowns.
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

    const speedRatio = clamp(this.phys.speed / this.def.maxSpeed, 0.5, 1.8);
    const dmg = this.def.ramDamage * speedRatio;
    _dir.copy(this.phys.velocity).normalize();
    _dir.y = 0.45;
    _dir.normalize();

    for (let i = 0; i < count; i++) {
      const e = _enemies[i]!;
      if (!e.alive || this.rammedCooldown.has(e.uid)) continue;
      if (Math.abs(e.position.y - this.phys.position.y) > 2.8) continue;
      this.rammedCooldown.set(e.uid, 0.45);
      const res = this.ctx.enemies.applyDamage(e, {
        amount: dmg,
        type: 'melee',
        point: e.center,
        dir: _dir,
        force: 220 * speedRatio,
        source: `${this.def.id}_roadkill`,
        gib: this.phys.speed >= this.def.ramSpeed * 1.6,
        severMult: 2.5,
      });
      this.ctx.audio?.play('metal_clang', { position: e.center, volume: 0.72, pitch: 0.78 });
      if (this.occupied) {
        this.ctx.camera?.addTrauma?.(0.18);
        if (res.killed) {
          this.ctx.hud?.floatText?.(e.center, 'ROADKILL', '#ff9e3b');
        }
      }
    }
  }

  private stepEffects(dt: number, occupied: boolean): void {
    // Boost / afterburner cones visibility.
    for (const g of this.model.boostGlow) {
      g.visible = this.phys.boosting;
      if (this.phys.boosting) {
        const s = 0.85 + Math.sin(this.clock * 45) * 0.22;
        g.scale.set(1, 1, s);
      }
    }

    // Bastion glowing green resupply ring pulse.
    if (this.model.resupplyRing) {
      this.model.resupplyRing.visible = this.phys.deployed;
      if (this.phys.deployed) {
        this.model.resupplyRing.rotation.y += dt * 0.45;
      }
    }

    // Sand kick-up dust while drifting or moving fast across the desert!
    if ((this.phys.drifting || (occupied && this.phys.grounded && this.phys.speed > 14)) && this.def.category !== 'helicopter') {
      this.dustTimer -= dt;
      if (this.dustTimer <= 0) {
        this.dustTimer = this.phys.drifting ? 0.06 : 0.14;
        const fx = Math.sin(this.phys.yaw);
        const fz = Math.cos(this.phys.yaw);
        _origin.set(this.phys.position.x - fx * this.def.halfLength * 0.8, this.phys.groundY + 0.35, this.phys.position.z - fz * this.def.halfLength * 0.8);
        this.ctx.fx?.smoke?.(_origin, 0xcbb596, this.phys.drifting ? 1.2 : 0.75, 0.9);
      }
    }

    // Low-health warning smoke & sparks!
    const frac = this.health / this.def.maxHealth;
    if (frac < 0.38) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = frac < 0.2 ? 0.08 : SMOKE_INTERVAL;
        _origin.set(this.phys.position.x, this.phys.position.y + this.def.halfHeight + 0.4, this.phys.position.z);
        this.ctx.fx?.smoke?.(_origin, 0x2e3136, frac < 0.2 ? 1.3 : 0.85, 1.4);
        if (frac < 0.2) this.ctx.fx?.sparks?.(_origin, _up, 6, 0xff9436);
      }
    }
  }

  private syncTransform(): void {
    const { root, body, turret, barrel, subTurret, wheelsFront, wheelsRear, rotorMain, rotorTail, outriggers } = this.model;
    root.position.copy(this.phys.position);
    root.rotation.set(0, this.phys.yaw, 0);

    // Subtle idle engine vibration / hover-bob on Viper!
    const hoverBob = this.def.category === 'hover' ? Math.sin(this.clock * 4.2) * 0.065 : 0;
    body.position.y = hoverBob;
    body.rotation.set(this.phys.pitch, 0, this.phys.roll);

    if (turret) {
      turret.rotation.y = this.turretYaw;
    }
    if (barrel) {
      barrel.rotation.x = clamp(-this.turretPitch, -0.55, 0.38);
      barrel.position.z = this.model.barrelBaseZ - this.phys.recoilOffset * 0.55;
    }
    if (subTurret && this._seatIndex >= 1) {
      subTurret.rotation.y = this.turretYaw - (turret && this.def.id === 'aegis' ? this.turretYaw : 0);
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

    // Bastion hydraulic outriggers swing smoothly from stowed (1.15 rad) down to planted (0 rad).
    for (let i = 0; i < outriggers.length; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      outriggers[i]!.rotation.z = side * 1.15 * (1 - this.phys.deployAnim);
    }
  }

  private setColliderParked(parked: boolean): void {
    if (!this.collider) return;
    if (parked) {
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
    this.stopEngine();
    this.engineLoop = this.ctx.audio?.startLoop?.(this.def.engineLoop, {
      position: this.phys.position,
      volume: this.def.engineVolume,
      pitch: this.def.enginePitchIdle,
    }) ?? null;
  }

  private updateEngineAudio(): void {
    if (!this.engineLoop) return;
    const frac = clamp(this.phys.speed / this.def.boostSpeed, 0, 1);
    const pitch = this.def.enginePitchIdle + (this.def.enginePitchMax - this.def.enginePitchIdle) * frac + (this.phys.boosting ? 0.18 : 0);
    this.engineLoop.setPosition(this.phys.position);
    this.engineLoop.setPitch(pitch);
    this.engineLoop.setVolume(this.def.engineVolume * (0.85 + frac * 0.35));
  }

  private stopEngine(): void {
    this.engineLoop?.stop();
    this.engineLoop = null;
  }

  private explodeAndDestroy(): void {
    if (!this.alive) return;
    this.alive = false;
    const pos = this.phys.position.clone();
    const wasOccupied = this.occupied;
    if (wasOccupied) {
      this.ctx.hud?.feed?.(`${this.def.name} DESTROYED — EJECTED!`, '#ff4a3a');
      this.exit(false);
      // Blast-eject upward with brief invulnerability grace from seat.leave().
      this.ctx.player.push(_vel.set(rand(-4, 4), 10.5, rand(-4, 4)));
    }
    this.ctx.combat.explode(pos.clone().setY(pos.y + 1.2), {
      radius: 9,
      damage: 420,
      kind: 'barrel',
      source: `${this.def.id}_wreck`,
      team: 'player',
      selfDamage: 0,
      scale: 1.5,
    });
    this.ctx.audio?.play('vehicle_explode', { position: pos });
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
      reach: 240,
      grade: null,
      enemyColor: '#ff5a3a',
      grace: 1.2,
      shake: 0.75,
      exposed: true,
    };
  }

  private buildHintText(): string {
    const swap = this.def.seats.length > 1 ? 'F SEAT // ' : '';
    const extra = this.def.category === 'helicopter'
      ? 'SPACE CLIMB // CTRL DESCEND // '
      : this.def.category === 'hover'
        ? 'SPACE DUNE-HOP // '
        : this.def.id === 'jackal'
          ? 'SPACE DRIFT // '
          : this.def.id === 'aegis'
            ? 'R APFSDS/HE // '
            : '';
    const cam = this.def.category === 'helicopter' ? 'WHEEL VIEW' : 'C VIEW';
    return `WASD DRIVE // SHIFT BOOST // ${extra}${swap}${cam} // Q ${this.def.special.name} // E EXIT`;
  }

  private syncHud(): void {
    const seat = this.seat;
    if (!seat) return;
    const spec = this.activeSeatSpec;
    const prim = this.primaryState[this._seatIndex]!;
    const sec = this.secondaryState[this._seatIndex];

    const primName = prim.altActive && spec.primary.altMode ? spec.primary.altMode.name : spec.primary.name;
    seat.weapons.length = 0;
    seat.weapons.push({
      name: `LMB ${primName}`,
      ammo: prim.ammo,
      max: spec.primary.magSize,
      reload: prim.reloadLeft > 0 ? 1 - prim.reloadLeft / spec.primary.reloadSeconds : -1,
      selected: true,
    });
    if (spec.secondary && sec) {
      seat.weapons.push({
        name: `RMB ${spec.secondary.name}`,
        ammo: sec.ammo,
        max: spec.secondary.magSize,
        reload: sec.reloadLeft > 0 ? 1 - sec.reloadLeft / spec.secondary.reloadSeconds : -1,
      });
    }

    const hullFrac = clamp(this.health / this.def.maxHealth, 0, 1);
    seat.hull = hullFrac;
    seat.hullText = `${Math.ceil(this.health)} / ${this.def.maxHealth}`;
    seat.heat = this.heat;
    seat.overheated = this.overheated;
    seat.status = spec.name;

    const h = this.hudScratch;
    h.seatIndex = this._seatIndex;
    h.seatName = spec.name;
    h.speedKmh = this.phys.speed * 3.6;
    h.boost = this.phys.boostFuel;
    h.boosting = this.phys.boosting;
    h.specialActive = this.specialActive;
    h.specialReady = this.specialCooldown <= 0;
    h.specialFraction = this.def.special.cooldown > 0 ? clamp(1 - this.specialCooldown / this.def.special.cooldown, 0, 1) : 1;
    h.cameraLabel = this.thirdPerson ? '3P' : '1P';
    h.ammoMode = spec.primary.altMode ? (prim.altActive ? 'HE-FRAG' : 'APFSDS') : '';
    h.deployed = this.phys.deployed;
    h.lowHealth = hullFrac < 0.3;
    seat.vehicleHud = h;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.alive = false;
    if (this.seat) this.exit(true);
    this.stopEngine();
    this.ctx.render?.scene?.remove(this.model.root);
    if (this.collider) {
      this.ctx.physics?.world?.removeCollider?.(this.collider, false);
      this.collider = null;
    }
  }
}
