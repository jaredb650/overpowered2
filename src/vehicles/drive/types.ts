/**
 * Core types for OVERPOWERED 2's player-driveable vehicles, multi-seat crews,
 * dedicated 1P cockpit/gunner HUD modes, VTOL/Jet flight, and live hijacking.
 */
import type * as THREE from 'three';
import type { VehicleKind } from '../../campaign/types';
import type { ExplosionKind, MuzzleKind } from '../../core/contracts';

export type DriveVehicleId =
  | 'jackal'
  | 'aegis'
  | 'kestrel'
  | 'viper'
  | 'bastion'
  | 'quad'
  | 'moto'
  | 'valkyrie'
  | 'harrier'
  | 'warthog'
  | 'raptor'
  | 'hornet'
  | 'lancer';

export type VehicleCategory = 'wheeled' | 'tracked' | 'helicopter' | 'hover' | 'moto' | 'jet';

export type HudViewMode =
  | 'standard'
  | 'emplacement'
  | 'chopper'
  | 'thermal'
  | 'tank'
  | 'aa'
  | 'mortar'
  | 'fighter'
  | 'passenger';

export type VehicleWeaponKind =
  | 'mg'
  | 'hmg'
  | 'cannon'
  | 'agl'
  | 'rocket'
  | 'atgm'
  | 'mortar'
  | 'plasma'
  | 'lance'
  | 'bomb'
  | 'none';

export type VehicleMountGun = 'hybrid' | 'm134' | 'vulcan';

export type VehicleSpecialId =
  | 'autoTurret'
  | 'smoke'
  | 'flares'
  | 'overcharge'
  | 'deploy'
  | 'vtol'
  | 'wheelie'
  | 'cobra'
  | 'dump_burn'
  | 'none';

export interface VehicleWeaponAltMode {
  readonly name: string;
  readonly kind?: VehicleWeaponKind;
  readonly damage: number;
  readonly speed: number;
  readonly gravity?: number;
  readonly interval?: number;
  readonly magSize?: number;
  readonly reloadSeconds?: number;
  readonly blastRadius: number;
  readonly blastDamage: number;
  readonly explosionKind: ExplosionKind;
  readonly homing?: boolean;
  readonly napalm?: boolean;
  readonly cluster?: boolean;
  readonly aerialCluster?: boolean;
  readonly chute?: boolean;
  readonly moab?: boolean;
  readonly thermobaric?: boolean;
  readonly audio?: string;
  readonly audioPitch?: number;
}

export interface VehicleWeaponSpec {
  readonly name: string;
  readonly kind: VehicleWeaponKind;
  readonly damage: number;
  /** Seconds between shots. */
  readonly interval: number;
  /** Magazine rounds (0 = infinite / heat-only). */
  readonly magSize: number;
  /** Seconds to reload an empty or manual-reloaded mag. */
  readonly reloadSeconds: number;
  /** Projectile speed in m/s (0 = instant hitscan / lance beam). */
  readonly speed: number;
  /** Gravity pull in m/s^2 for arcing weapons (AGL, mortar, bombs). */
  readonly gravity: number;
  /** Angular spread in radians. */
  readonly spread: number;
  /** Blast radius in meters (0 = direct kinetic hit). */
  readonly blastRadius: number;
  readonly blastDamage: number;
  readonly explosionKind: ExplosionKind;
  readonly muzzleFlash: MuzzleKind;
  readonly audio: string;
  readonly audioPitch: number;
  readonly recoilKick: number;
  readonly trauma: number;
  /** True for homing / lock-on missiles. */
  readonly homing?: boolean;
  /** True for incendiary BLU-27 napalm bombs. */
  readonly napalm?: boolean;
  /** True for aerial cluster canister bombs. */
  readonly cluster?: boolean;
  /** True for heavy bomber CBU-105 high-altitude aerial cluster dispensers (28 m airburst -> 52 AP bomblets). */
  readonly aerialCluster?: boolean;
  /** True for Mk-82 Snake-Eye retarded parachute bombs (high horizontal air-drag chute). */
  readonly chute?: boolean;
  /** True for GBU-43 MOAB thermobaric mega-bombs. */
  readonly moab?: boolean;
  /** True for BLU-121/B thermobaric ("Fuel-Air") warheads. */
  readonly thermobaric?: boolean;
  /** True for fixed-boresight nose guns (fighter jets / A-10) that shoot straight along the hull nose. */
  readonly boresight?: boolean;
  /** Optional charge duration in seconds (Viper Particle Lance beam). */
  readonly chargeSeconds?: number;
  /** Optional alternate ammo / ordnance mode toggled via `[R]`. */
  readonly altMode?: VehicleWeaponAltMode;
  /** Optional third ordnance mode cycled via `[R]`. */
  readonly thirdMode?: VehicleWeaponAltMode;
  /** Optional fourth ordnance mode cycled via `[R]` (Harrier HE Bombs -> Napalm -> Missiles -> Rockets). */
  readonly fourthMode?: VehicleWeaponAltMode;
}

export interface VehicleSeatSpec {
  readonly id: string;
  readonly name: string;
  readonly role: 'driver' | 'pilot' | 'gunner' | 'commander' | 'passenger';
  /** Dedicated 1P HUD/optic style for this seat. */
  readonly hudMode: HudViewMode;
  /** Optional Desert-Raid-style close-up 3D gun mounted directly ahead of the 1P camera. */
  readonly mountGun?: VehicleMountGun;
  /** True when the passenger keeps their actual hand-held player weapons active (Quad / Moto rear seat!). */
  readonly passengerWeapons?: boolean;
  /** First-person eye offset in vehicle local space (+Z = nose, +Y = up). */
  readonly fpEye: readonly [number, number, number];
  /** Third-person camera pivot offset in vehicle local space. */
  readonly chaseOffset: readonly [number, number, number];
  /** Third-person camera pullback distance in meters (0 = forced 1P turret sight). */
  readonly chaseDist: number;
  /** Pitch bias for 3P chase camera in radians. */
  readonly chasePitchBias: number;
  /** Weapon muzzle offset in local space (or turret-local when `usesTurret`). */
  readonly muzzleOffset: readonly [number, number, number];
  readonly usesTurret?: boolean;
  readonly usesSubTurret?: boolean;
  readonly pitchMin: number;
  readonly pitchMax: number;
  /** Turret yaw slew rate in rad/s (`Infinity` = instant mouse aim). */
  readonly turretSlew: number;
  /** When true, RMB zooms the gunner optic instead of firing `secondary`. */
  readonly aimZooms?: boolean;
  /** Target FOV in degrees while zoomed via `aimZooms` (default 40). */
  readonly zoomFov?: number;
  /** When true, holding R switches LMB between `primary` and `secondary` (tap R reloads). */
  readonly holdRToggleSecondary?: boolean;
  readonly primary: VehicleWeaponSpec;
  readonly secondary?: VehicleWeaponSpec;
}

export interface VehicleSpecialSpec {
  readonly id: VehicleSpecialId;
  readonly name: string;
  readonly cooldown: number;
  readonly duration: number;
}

export interface DriveVehicleDef {
  readonly id: DriveVehicleId;
  readonly name: string;
  readonly shortName: string;
  readonly category: VehicleCategory;
  readonly color: string;
  /** Low-observable radar signature (F-22 Raptor, B-2 Spirit): halves enemy missile lock range & faster flare cycle. */
  readonly stealth?: boolean;
  readonly maxHealth: number;
  /** Effective vehicle mass (tons-scale factor: 0.45 moto, 1.8 jackal, 6.5 bastion, 10 aegis) for wreck pushing & ramming. */
  readonly mass: number;
  /** Kamikaze detonation damage when crashing at extreme speed into walls or enemy armor. */
  readonly kamikazeDamage: number;
  /** Directional damage multipliers (front, side, rear). */
  readonly armor: { readonly front: number; readonly side: number; readonly rear: number };
  /** Hull half-extents for collision, ramp sampling, and kinematic ragdoll bumper. */
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly halfLength: number;
  /** Physics tuning. */
  readonly maxSpeed: number;
  readonly boostSpeed: number;
  readonly maxReverse: number;
  readonly accel: number;
  readonly brake: number;
  readonly turnRate: number;
  readonly lateralGrip: number;
  readonly driftGrip: number;
  readonly boostDrain: number;
  readonly boostRegen: number;
  /** Helicopter / VTOL / Jet / Hover specific tuning. */
  readonly hoverHeight: number;
  readonly hopImpulse: number;
  readonly climbRate: number;
  readonly maxAltitude: number;
  /** Minimum speed in m/s for roadkill / vehicle ramming. */
  readonly ramSpeed: number;
  readonly ramDamage: number;
  readonly engineLoop: string;
  /** Optional secondary audio loop (tank tracks, heli turbine, jet afterburner). */
  readonly engineLayerLoop?: string;
  readonly enginePitchIdle: number;
  readonly enginePitchMax: number;
  readonly engineVolume: number;
  readonly special: VehicleSpecialSpec;
  readonly seats: readonly VehicleSeatSpec[];
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
  /** Hysteresis latch preventing boost chatter at low fuel (eliminates Shift camera stutter). */
  boostLocked: boolean;
  drifting: boolean;
  grounded: boolean;
  groundY: number;
  altitude: number;
  hopCooldown: number;
  recoilOffset: number;
  deployed: boolean;
  deployAnim: number;
  speed: number;
  /** Smooth vertical climb rate tracked on ramps so vehicles launch naturally off crests! */
  recentClimbVy: number;
  climbCarryTimer: number;
  /** Instantaneous wall/ground crash speed from this physics tick (0 when clean). */
  crashImpact: number;
  readonly crashNormal: THREE.Vector3;
  /** Instantaneous speed of a destructible wall/building smashed through on this tick (0 when none). */
  ramBreachImpact: number;
  readonly ramBreachPoint: THREE.Vector3;
  /** True when a destructible structure rejected this vehicle's ram (e.g., tank hitting reinforced bunker). */
  ramBlocked: boolean;
  /** VTOL Hover / STOL tarmac mode flag for Jets (Harrier / Warthog / STOL takeoff). */
  vtolMode: boolean;
  /** Current forward jet throttle 0..1. */
  airThrottle: number;
  /** True when an abandoned helicopter/jet is spiraling/plummeting out of the sky to crash! */
  abandonedFall: boolean;
  /** Spin rate (rad/s) during an uncontrolled abandoned aircraft crash spiral. */
  fallSpin: number;
  /** Remaining seconds of F-22 Raptor 2D Thrust-Vectoring Cobra airbrake maneuver. */
  cobraTimer: number;
  /** Variable-geometry wing sweep factor 0 (unswept low-speed) .. 1 (supersonic swept delta, Lancer). */
  wingSweep: number;
  /** Animated 2D thrust-vectoring exhaust nozzle pitch deflection in radians (Raptor). */
  nozzleDeflect: number;
  /** Remaining seconds of Lancer "Dump-and-Burn" trailing jet-fuel afterburner torch. */
  dumpBurnTimer: number;
}

export interface VehicleInput {
  throttle: number;
  steer: number;
  climb: number;
  boost: boolean;
  handbrake: boolean;
  firePrimary: boolean;
  fireSecondary: boolean;
  aimHeld?: boolean;
  specialPressed: boolean;
  reloadPressed: boolean;
  reloadHeld?: boolean;
  cameraTogglePressed: boolean;
  /** Jet pitch/roll mouse delta inputs. */
  lookX: number;
  lookY: number;
  /** Unified aim yaw/pitch targets fed into stepJet so jet flight never fights itself. */
  targetAimYaw?: number;
  targetAimPitch?: number;
}

export interface VehicleHudData {
  readonly id: DriveVehicleId;
  readonly name: string;
  readonly hudMode: HudViewMode;
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
  readonly ammoMode: string;
  readonly cameraLabel: string;
  readonly deployed: boolean;
  readonly chargeFraction: number;
  readonly missileWarning: boolean;
  readonly radarLockWarning?: boolean;
  readonly rwrLabel?: string;
  readonly vtolMode: boolean;
  readonly pitchRad: number;
  readonly rollRad: number;
  readonly altitudeM: number;
  readonly ccipWorld: readonly [number, number, number] | null;
  readonly ccipLabel: string;
  readonly gunPipWorld: readonly [number, number, number] | null;
  readonly lockWorld: readonly [number, number, number] | null;
  readonly lockLabel: string;
  readonly leadPips: readonly (readonly [number, number, number])[];
}

/** Maps enemy vehicle kinds to their corresponding player-driveable equivalent on hijack. */
export const HIJACK_MAP: Readonly<Record<VehicleKind, DriveVehicleId>> = {
  humvee: 'jackal',
  truck: 'bastion',
  tank: 'aegis',
  chopper: 'kestrel',
  transport: 'valkyrie',
  doorGunner: 'valkyrie',
};
