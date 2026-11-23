/**
 * Shared types for player-driveable vehicles, multi-seat crews, and enemy hijacking.
 */
import type * as THREE from 'three';
import type { ExplosionKind } from '../../core/contracts';

export type DriveVehicleId = 'jackal' | 'aegis' | 'kestrel' | 'viper' | 'bastion';

export const DRIVE_VEHICLE_ORDER: readonly DriveVehicleId[] = [
  'jackal',
  'aegis',
  'kestrel',
  'viper',
  'bastion',
] as const;

export type EnemyVehicleKind = 'humvee' | 'truck' | 'tank' | 'chopper' | 'transport' | 'doorGunner';

/** Maps each hijackable enemy vehicle kind to its player-driveable counterpart. */
export const HIJACK_MAP: Readonly<Record<EnemyVehicleKind, DriveVehicleId>> = {
  humvee: 'jackal',
  truck: 'bastion',
  tank: 'aegis',
  chopper: 'kestrel',
  transport: 'kestrel',
  doorGunner: 'kestrel',
};

export type VehicleCategory = 'wheeled' | 'tracked' | 'helicopter' | 'hover';

export type VehicleWeaponKind =
  | 'rotary'
  | 'cannon'
  | 'coax'
  | 'autocannon'
  | 'grenade'
  | 'rockets'
  | 'pulse'
  | 'ram'
  | 'flak'
  | 'atgm';

export interface VehicleWeaponSpec {
  readonly id: string;
  readonly name: string;
  readonly kind: VehicleWeaponKind;
  readonly fireRate: number;
  readonly damage: number;
  readonly speed: number;
  readonly spread: number;
  readonly heatPerShot: number;
  readonly blastRadius: number;
  readonly blastKind?: ExplosionKind;
  readonly magSize: number;
  readonly reloadSeconds: number;
  readonly sound: string;
  readonly soundPitch?: number;
  readonly muzzleSlot: 'main' | 'coax' | 'podLeft' | 'podRight' | 'roof' | 'front' | 'rear';
  readonly tracerColor?: number;
  readonly recoilKick?: number;
  /** Optional alternate ammo mode (e.g. Aegis 120mm APFSDS vs HE-FRAG toggled with [R]). */
  readonly altMode?: {
    readonly name: string;
    readonly damage: number;
    readonly speed: number;
    readonly blastRadius: number;
    readonly blastKind: ExplosionKind;
    readonly sound: string;
  };
}

export interface VehicleSeatSpec {
  readonly name: string;
  readonly role: 'driver' | 'pilot' | 'gunner' | 'commander';
  /** Local eye offset for first-person / turret sight view. */
  readonly fpEye: readonly [number, number, number];
  /** Local chase camera target offset and pull-back distance for third-person view. */
  readonly chaseOffset: readonly [number, number, number];
  readonly chaseDist: number;
  readonly chasePitchBias: number;
  readonly pitchMin: number;
  readonly pitchMax: number;
  /** True if turret yaw follows mouse aim independently from hull heading. */
  readonly independentTurret: boolean;
  /** Max turret slew rate in rad/s (Infinity = instant pintle/chin aim). */
  readonly turretSlew: number;
  readonly primary: VehicleWeaponSpec;
  readonly secondary: VehicleWeaponSpec | null;
}

export interface DriveVehicleDef {
  readonly id: DriveVehicleId;
  readonly name: string;
  readonly shortName: string;
  readonly tagline: string;
  readonly category: VehicleCategory;
  readonly color: string;
  readonly maxHealth: number;
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly halfLength: number;
  /** Max forward speed in m/s (normal throttle). */
  readonly maxSpeed: number;
  /** Max reverse speed in m/s. */
  readonly maxReverse: number;
  /** Max speed while boosting/afterburning in m/s. */
  readonly boostSpeed: number;
  /** Forward acceleration in m/s². */
  readonly accel: number;
  /** Braking deceleration in m/s². */
  readonly brake: number;
  /** Steering turn rate in rad/s at nominal speed. */
  readonly turnRate: number;
  /** Lateral grip stiffness (higher = crisper rails, lower = more drift). */
  readonly lateralGrip: number;
  /** Lateral grip when handbrake/drift is held. */
  readonly driftGrip: number;
  /** Boost fuel burn rate (fraction per second) and recharge rate. */
  readonly boostDrain: number;
  readonly boostRegen: number;
  /** Minimum speed in m/s to splatter/crush enemies on contact. */
  readonly ramSpeed: number;
  readonly ramDamage: number;
  /** Directional damage multipliers (front / side / rear). */
  readonly armor: { readonly front: number; readonly side: number; readonly rear: number };
  /** Helicopter / hover-bike specific flight & suspension tuning. */
  readonly hoverHeight: number;
  readonly climbRate: number;
  readonly maxAltitude: number;
  readonly hopImpulse: number;
  /** Engine audio loop id & pitch curve. */
  readonly engineLoop: string;
  readonly enginePitchIdle: number;
  readonly enginePitchMax: number;
  readonly engineVolume: number;
  /** Special ability triggered via [Q]. */
  readonly special: {
    readonly id: 'autoTurret' | 'smoke' | 'flares' | 'pulse' | 'deploy';
    readonly name: string;
    readonly cooldown: number;
    readonly duration: number;
  };
  readonly seats: readonly VehicleSeatSpec[];
}

export interface VehicleInput {
  throttle: number;
  steer: number;
  climb: number;
  boost: boolean;
  handbrake: boolean;
  firePrimary: boolean;
  fireSecondary: boolean;
  specialPressed: boolean;
  reloadPressed: boolean;
  cameraTogglePressed: boolean;
}

export interface VehiclePhysicsState {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  pitchRate: number;
  rollRate: number;
  yawRate: number;
  steerAngle: number;
  wheelSpin: number;
  rotorAngle: number;
  boostFuel: number;
  boosting: boolean;
  drifting: boolean;
  grounded: boolean;
  groundY: number;
  altitude: number;
  hopCooldown: number;
  recoilOffset: number;
  deployed: boolean;
  deployAnim: number;
  speed: number;
}

/** Snapshot pushed to GunnerHud when the player is driving/gunning a player vehicle. */
export interface VehicleHudData {
  readonly id: DriveVehicleId;
  readonly name: string;
  readonly seatIndex: number;
  readonly seatCount: number;
  readonly seatName: string;
  readonly speedKmh: number;
  readonly boost: number;
  readonly boosting: boolean;
  readonly specialLabel: string;
  readonly specialReady: boolean;
  readonly specialActive: boolean;
  readonly specialFraction: number;
  readonly cameraLabel: '3P' | '1P';
  readonly ammoMode: string;
  readonly airborne: boolean;
  readonly deployed: boolean;
  readonly lowHealth: boolean;
}
