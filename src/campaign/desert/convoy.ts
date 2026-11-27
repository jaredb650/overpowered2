/**
 * Lane B: Ally-Driven 3-Truck Desert Raid Convoy, Player Sculpted Mk 19 Belt-Fed 40mm Grenade Launcher,
 * and Saltblood Bandit Vehicles (Motorcycles & Armed Scrap Technicals) for Mission 5: DESERT RAID.
 *
 * The player NEVER drives. Allies steer the 3-truck column along `CONVOY_PATHS`:
 *   - Section 1 (`startApproach`): Dawn dune run from z = +222 -> +84; raises `dr:approach_done`.
 *   - Section 2 (`startWallLoop`): Slow broadside shooting-gallery loop along Surplus's outer wall;
 *     raises `dr:wall_loop_ready` after the first pass or heavy wall/bandit damage, looping until dismount.
 *   - Section 3 (`dismountAtGate`): Parks all 3 trucks at the breached Main Gate (z ≈ 74) and releases
 *     the player cleanly on foot at `(0, 0, 68)` facing north (yaw = 0).
 *   - Section 8 (`arriveForExfil` -> `startExfilChase`): Sweeps into the Plane forecourt (z = -206) with pulsing
 *     `[E] Board Exfil Truck` prompt (auto-boards <= 4.5 m or E), optionally displaying zip-tied Hadrek Quist
 *     in the middle truck bed, raises `dr:exfil_boarded`, then rockets south along the eastern bypass road while
 *     pursuing Saltblood bikes & technicals attack; raises `dr:exfil_clear` once clear of the outer wall (z >= 108).
 *   - Ending (`enterEndingCruise`): Cleanly hands camera ownership to the ending cutscene, hides turret HUD,
 *     and keeps all 3 trucks cruising smoothly south along the desert approach road (capped at z = 185).
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CG, type Ctx, type ExplosionKind, type LoopHandle, type PlayerDamage, type SeatView } from '../../core/contracts';
import { isGuest } from '../../core/coop';
import type { EnemyInstance, ExplosionSpec, MissileTarget } from '../../core/gameplay';
import { clamp, damp, dampAngle, lerp, rand, randomInCone, wrapAngle } from '../../core/math';
import type { ExtraTarget, VehicleSystem } from '../../enemies/vehicles';
import { ModelBuilder, ModelMaterials } from '../../progression/modelkit';
import { div, Label, span } from '../../ui/dom';
import { Heat } from '../../vehicles/emplacement';
import { Gun, type GunSpec } from '../../vehicles/guns';
import { HYBRID_HMG_AGL } from '../../vehicles/drive/guns';
import { buildVehicleModel } from '../../vehicles/drive/models';
import { animateRider, setRiderAccent, type RiderRig } from '../../vehicles/drive/riders';
import { EXPLOSIONS } from '../../weapons/data';
import { CARGO_PLANE, CONVOY_PATHS, DESERT_Z, SIDE_GATES, type Pt3 } from '../../world/map/desert/plan';
import type { CampaignHud } from '../hud';
import type { MissionRunner } from '../runner';
import type { ConvoyController } from './types';

// -------------------------------------------------------------------------------------------------
// Public types & constants
// -------------------------------------------------------------------------------------------------

export type ConvoyPhase =
  | 'idle'
  | 'approach'
  | 'wallLoop'
  | 'parkedGate'
  | 'exfilArriving'
  | 'exfilWaiting'
  | 'exfilChase'
  | 'endingCruise';

export type BanditVehicleKind = 'bike' | 'quad' | 'truck';
export type BanditHitZoneKind = 'rider' | 'gunner' | 'engine' | 'tire' | 'chassis';
export type BanditBehavior = 'approach' | 'sideGate' | 'exfil';

export interface BanditHitZone {
  readonly id: string;
  readonly kind: BanditHitZoneKind;
  readonly offset: THREE.Vector3;
  readonly halfExtents: THREE.Vector3;
  hp: number;
  readonly maxHp: number;
  destroyed: boolean;
}

export interface BanditVehicle {
  readonly id: number;
  readonly kind: BanditVehicleKind;
  readonly behavior: BanditBehavior;
  readonly root: THREE.Group;
  readonly body: THREE.Group;
  readonly wheels: THREE.Object3D[];
  readonly gunnerPivot: THREE.Object3D | null;
  readonly driverRider: RiderRig | null;
  readonly gunnerRider: RiderRig | null;
  readonly liveryColor: number;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly center: THREE.Vector3;
  yaw: number;
  roll: number;
  pitch: number;
  speed: number;
  hp: number;
  readonly maxHp: number;
  alive: boolean;
  gunnerAlive: boolean;
  readonly zones: BanditHitZone[];
  collider: RAPIER.Collider | null;
  weavePhase: number;
  weaveAmp: number;
  weaveFreq: number;
  preferredSide: number;
  preferredLead: number;
  fireCooldown: number;
  smokeTimer: number;
  dustTimer: number;
  age: number;
}

export interface BanditWreck {
  readonly id: number;
  readonly kind: BanditVehicleKind;
  readonly root: THREE.Group;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly angVel: THREE.Vector3;
  age: number;
  maxAge: number;
  exploded: boolean;
  smokeTimer: number;
}

export interface Mk19Projectile {
  readonly id: number;
  readonly mesh: THREE.Group;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  age: number;
  readonly maxAge: number;
  smokeTimer: number;
}

export interface RaidTruck {
  readonly role: 'lead' | 'player' | 'rear';
  readonly root: THREE.Group;
  readonly body: THREE.Group;
  readonly wheels: THREE.Object3D[];
  readonly antenna: THREE.Object3D;
  readonly headlights: THREE.Object3D | null;
  readonly allyTurret: THREE.Object3D | null;
  readonly allyMuzzleOffset: THREE.Vector3;
  readonly quistMesh: THREE.Group | null;
  readonly position: THREE.Vector3;
  readonly offset: readonly [number, number, number];
  yaw: number;
  roll: number;
  pitch: number;
  speed: number;
  bumpPhase: number;
  dustTimer: number;
  allyFireCooldown: number;
}

export const DESERT_CONVOY_CONSTANTS = {
  approachSpeed: 15.2,
  wallLoopSpeed: 8.0,
  exfilArriveSpeed: 13,
  exfilSpeed: 18,
  endingCruiseSpeed: 7.5,
  endingCruiseMinZ: 115,
  endingCruiseMaxZ: 185,
  exfilClearZ: 108,
  exfilAutoBoardRadius: 4.5,
  exfilPromptRadius: 8.5,
  gateParkZ: 74,
  dismountPos: [0, 0, 68] as Pt3,
  leadOffset: [-11, 0, -10] as Pt3,
  rearOffset: [11, 0, 10] as Pt3,
  quistBedLocal: [0.54, 1.58, 1.92] as Pt3,
  maxHull: 500,
  phasePatchHeal: 160,
  /** Active mode 1 (.50-cal HMG, ~10.5 rps, shreds bandits, enemies & wooden walls/watchtowers). */
  hmgRps: 10.5,
  hmgDamage: 46,
  hmgStructDamage: 32,
  hmgSpread: 0.011,
  /** Active mode 2 (40mm Smart-AGL grenade launcher, toggled with Hold R, ~2.8 rps arcing HEDP grenades). */
  turretRps: 2.8,
  turretDamage: 210,
  turretSpread: 0.008,
  turretMaxRange: 300,
  grenadeSpeed: 110,
  grenadeGravity: 14,
  grenadeBlastRadius: 4.8,
  grenadeStructDamage: 95,
  grenadeStructRadius: 3.4,
  grenadeDirectBanditDamage: 125,
  turretFov: 74,
  turretZoomFov: 44,
  holdRSeconds: 0.35,
  pitchMin: (-25 * Math.PI) / 180,
  pitchMax: (45 * Math.PI) / 180,
  /** Generous sustained .50-cal HMG burst (~52 rounds before cooling vent). */
  heatPerShot: 1 / 52,
  heatCool: 0.36,
  heatVent: 0.58,
  wallLoopReadyHits: 12,
  bikeMaxHp: 75,
  quadMaxHp: 115,
  truckMaxHp: 240,
  bikeScore: 350,
  quadScore: 450,
  truckScore: 750,
} as const;

// -------------------------------------------------------------------------------------------------
// Scratch math objects (zero per-frame heap churn)
// -------------------------------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);
const _muzzle = new THREE.Vector3();
const _bore = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _right = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _casing = new THREE.Vector3();
const _hitPt = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _segPrev = new THREE.Vector3();
const _segNext = new THREE.Vector3();
const _segDir = new THREE.Vector3();
const _hitNorm = new THREE.Vector3();
const _impact = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _localOrigin = new THREE.Vector3();
const _localDir = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
const _q = new THREE.Quaternion();
const _stepQ = new THREE.Quaternion();
const _euler = new THREE.Euler();

// -------------------------------------------------------------------------------------------------
// Pure geometry & spline helpers
// -------------------------------------------------------------------------------------------------

function rayLocalBoxDist(
  localOrigin: THREE.Vector3,
  localDir: THREE.Vector3,
  offset: THREE.Vector3,
  half: THREE.Vector3,
  maxDist: number,
): number {
  let tMin = 0;
  let tMax = maxDist;

  // X slab
  const minX = offset.x - half.x;
  const maxX = offset.x + half.x;
  if (Math.abs(localDir.x) < 1e-7) {
    if (localOrigin.x < minX || localOrigin.x > maxX) return -1;
  } else {
    const inv = 1 / localDir.x;
    let t1 = (minX - localOrigin.x) * inv;
    let t2 = (maxX - localOrigin.x) * inv;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return -1;
  }

  // Y slab
  const minY = offset.y - half.y;
  const maxY = offset.y + half.y;
  if (Math.abs(localDir.y) < 1e-7) {
    if (localOrigin.y < minY || localOrigin.y > maxY) return -1;
  } else {
    const inv = 1 / localDir.y;
    let t1 = (minY - localOrigin.y) * inv;
    let t2 = (maxY - localOrigin.y) * inv;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return -1;
  }

  // Z slab
  const minZ = offset.z - half.z;
  const maxZ = offset.z + half.z;
  if (Math.abs(localDir.z) < 1e-7) {
    if (localOrigin.z < minZ || localOrigin.z > maxZ) return -1;
  } else {
    const inv = 1 / localDir.z;
    let t1 = (minZ - localOrigin.z) * inv;
    let t2 = (maxZ - localOrigin.z) * inv;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return -1;
  }

  return tMin >= 0 && tMin <= maxDist ? tMin : -1;
}

export class SplinePath {
  private readonly points: THREE.Vector3[] = [];
  private readonly cumLen: number[] = [];
  readonly length: number;
  readonly closed: boolean;

  constructor(waypoints: readonly Pt3[], closed = false, subdivisions = 12) {
    this.closed = closed;
    const vecs = waypoints.map(p => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(vecs, closed, 'catmullrom', 0.35);
    const totalSamples = Math.max(8, vecs.length * subdivisions);
    let acc = 0;
    for (let i = 0; i <= totalSamples; i++) {
      const pt = curve.getPoint(i / totalSamples);
      pt.y = 0;
      if (i > 0) acc += pt.distanceTo(this.points[i - 1]!);
      this.points.push(pt);
      this.cumLen.push(acc);
    }
    this.length = acc;
  }

  sample(dist: number, outPos: THREE.Vector3, outTan: THREE.Vector3): void {
    const n = this.points.length;
    if (n < 2 || this.length <= 1e-4) {
      outPos.copy(this.points[0] ?? new THREE.Vector3());
      outTan.set(0, 0, -1);
      return;
    }

    let d = dist;
    if (this.closed) {
      d = ((d % this.length) + this.length) % this.length;
    } else {
      d = clamp(d, 0, this.length);
    }

    // Binary search segment containing arc length d
    let lo = 0;
    let hi = n - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cumLen[mid]! <= d) lo = mid;
      else hi = mid - 1;
    }

    const a = this.points[lo]!;
    const b = this.points[lo + 1]!;
    const segStart = this.cumLen[lo]!;
    const segLen = Math.max(1e-5, this.cumLen[lo + 1]! - segStart);
    const t = clamp((d - segStart) / segLen, 0, 1);

    outPos.lerpVectors(a, b, t);
    outTan.subVectors(b, a);
    const len = outTan.length();
    if (len > 1e-5) outTan.divideScalar(len);
    else outTan.set(0, 0, -1);
  }
}

// -------------------------------------------------------------------------------------------------
// Procedural Vehicle & Character Visual Builders
// -------------------------------------------------------------------------------------------------

function buildCapturedQuist(materials: ModelMaterials): THREE.Group {
  const g = new THREE.Group();
  g.name = 'desert.convoy.quistCaptured';
  const b = new ModelBuilder();
  const COAT = '#cbb992';
  const COAT_SHADE = '#a99672';
  const VEST = '#523e2e';
  const SCARF = '#c82820';
  const SKIN = '#d6aa84';
  const HAIR = '#463f38';
  const PANTS = '#463e36';
  const BOOT = '#27211d';
  const ZIP = '#f4f8fc';
  const BENCH = '#4a4339';

  // Rear cargo bench plank under Quist (facing +Z, looking aft back toward burning Surplus)
  b.box(0.68, 0.08, 0.42, BENCH, { at: [0, 0.04, -0.02] });
  // Seated thighs & booted shins planted forward toward the rear tailgate (+Z)
  for (const s of [-1, 1]) {
    b.box(0.17, 0.16, 0.48, PANTS, { at: [s * 0.14, 0.15, 0.22], rot: [-0.1, 0, 0] });
    b.box(0.15, 0.34, 0.16, PANTS, { at: [s * 0.14, 0.02, 0.44] });
    b.box(0.15, 0.12, 0.22, BOOT, { at: [s * 0.14, -0.08, 0.5] });
  }
  // Upright torso + desert duster coat tails & dark leather tactical vest
  b.box(0.48, 0.62, 0.3, COAT, { at: [0, 0.48, -0.02], rot: [-0.06, 0, 0] });
  b.box(0.52, 0.24, 0.34, COAT_SHADE, { at: [0, 0.18, -0.05] });
  b.box(0.44, 0.38, 0.33, VEST, { at: [0, 0.52, -0.01], rot: [-0.06, 0, 0] });
  // Signature crimson Saltblood scarf wrapped around neck with draped chest tail
  b.box(0.44, 0.14, 0.34, SCARF, { at: [0, 0.78, 0.0] });
  b.box(0.15, 0.32, 0.08, SCARF, { at: [0.1, 0.6, 0.16], rot: [0.08, 0, -0.14] });
  // Arms pulled tightly together in front over his lap + bright white zip-tie wrist cuffs!
  for (const s of [-1, 1]) {
    b.box(0.13, 0.36, 0.13, COAT, { at: [s * 0.24, 0.54, 0.08], rot: [0.42, 0, -s * 0.22] });
    b.box(0.11, 0.11, 0.26, COAT_SHADE, { at: [s * 0.12, 0.36, 0.24], rot: [0.1, -s * 0.45, 0] });
    b.box(0.09, 0.08, 0.09, SKIN, { at: [s * 0.05, 0.35, 0.34] });
  }
  // Crisp white zip-ties clearly binding both wrists together (plus short tail tab)
  b.box(0.22, 0.075, 0.085, ZIP, { at: [0, 0.36, 0.31] });
  b.box(0.03, 0.12, 0.025, ZIP, { at: [0.06, 0.31, 0.36], rot: [0.35, 0, -0.25] });
  // Head, weathered beard/hair & iconic amber desert dust goggles facing +Z!
  b.solid(new THREE.SphereGeometry(0.155, 10, 8), SKIN, { at: [0, 0.96, 0.02] });
  b.box(0.25, 0.11, 0.25, HAIR, { at: [0, 1.06, -0.01] });
  b.box(0.19, 0.1, 0.12, HAIR, { at: [0, 0.87, 0.09] });
  // Goggle strap + dark frames + glowing amber lenses
  b.box(0.32, 0.06, 0.24, '#242220', { at: [0, 0.98, 0.01] });
  for (const s of [-1, 1]) {
    b.glow(new THREE.BoxGeometry(0.1, 0.065, 0.05), '#ffaa28', 2.4, { at: [s * 0.068, 0.98, 0.16] });
  }
  g.add(materials.group(b));
  g.visible = false;
  return g;
}

/** Distinct Saltblood warband paint palettes for enemy technicals, motos, and quads. */
const SALTBLOOD_LIVERIES: readonly number[] = [
  0xb83428, // Saltblood crimson rust
  0x464a50, // scorched gunmetal iron
  0xc86426, // burnt desert ochre-orange
  0x7d2626, // dark dried-blood maroon
  0x6b4c30, // weathered bronze-rust
];

const _liveryTarget = new THREE.Color();
const _vertColor = new THREE.Color();

/**
 * Safely re-tints a real driveable vehicle's painted armor panels to a faction/warband livery
 * without mutating shared PBR materials or geometry caches. Preserves per-vertex luminance shading!
 */
function applyVehicleLivery(root: THREE.Object3D, liveryHex: number, strength = 0.78): void {
  _liveryTarget.setHex(liveryHex);
  root.traverse(obj => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mat = obj.material;
    if (!(mat instanceof THREE.MeshStandardMaterial) || !mat.vertexColors) return;
    // Only recolor painted armor surfaces (roughness ~0.58, metalness ~0.34 in textures.ts);
    // leave dark rubber treads, chrome/gunmetal frames, carbon grips & glass canopies untouched!
    if (mat.roughness < 0.5 || mat.roughness > 0.68 || mat.metalness < 0.25 || mat.metalness > 0.45) return;
    const geo = obj.geometry;
    const colAttr = geo.getAttribute('color');
    if (!colAttr) return;
    const cloned = geo.clone();
    const attr = cloned.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < attr.count; i++) {
      _vertColor.setRGB(attr.getX(i), attr.getY(i), attr.getZ(i));
      const lum = Math.max(0.28, _vertColor.r * 0.3 + _vertColor.g * 0.59 + _vertColor.b * 0.11);
      // Skip very dark/black trim pieces baked into the armor mesh
      if (lum < 0.18) continue;
      const scale = clamp(lum / 0.58, 0.52, 1.28);
      attr.setXYZ(
        i,
        lerp(_vertColor.r, clamp(_liveryTarget.r * scale, 0, 1), strength),
        lerp(_vertColor.g, clamp(_liveryTarget.g * scale, 0, 1), strength),
        lerp(_vertColor.b, clamp(_liveryTarget.b * scale, 0, 1), strength),
      );
    }
    attr.needsUpdate = true;
    obj.geometry = cloned;
  });
}

function buildRaidTruckVisual(
  materials: ModelMaterials,
  role: 'lead' | 'player' | 'rear',
): {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Object3D[];
  antenna: THREE.Object3D;
  headlights: THREE.Object3D;
  allyTurret: THREE.Object3D | null;
  quistMesh: THREE.Group | null;
} {
  const root = new THREE.Group();
  root.name = `desert.convoy.truck.${role}`;
  const body = new THREE.Group();
  root.add(body);

  // Real Jackal PBR technical (built facing +Z; flip Math.PI inside holder so nose faces -Z like convoy.ts)
  const rig = buildVehicleModel('jackal', materials);
  const holder = new THREE.Group();
  holder.rotation.y = Math.PI;
  holder.add(rig.root);
  body.add(holder);

  // Friendly military desert-olive tint on flankers vs sand-tan command technical for player
  if (role !== 'player') {
    applyVehicleLivery(rig.root, 0x8f926e, 0.42);
  }

  // Show seated ally cab driver (and roof turret gunner on flank trucks) with friendly cyan accents
  for (let i = 0; i < rig.riders.length; i++) {
    const rider = rig.riders[i]!;
    setRiderAccent(rider, '#4cd8ff');
    rider.root.visible = role === 'player' ? i === 0 : true;
  }

  // On player truck, hide the 3P roof turret so our live 1P HYBRID_HMG_AGL Gun mounts cleanly on the ring!
  if (role === 'player' && rig.turret) {
    rig.turret.visible = false;
  }

  // Separate headlights glow group on the front bumper (-Z) so exfil arrival can blaze/pulse them
  const hlBuilder = new ModelBuilder();
  for (const s of [-1, 1]) {
    hlBuilder.glow(new THREE.BoxGeometry(0.36, 0.16, 0.06), '#ffe9b8', 3.8, { at: [s * 0.72, 1.06, -2.56] });
  }
  const headlights = materials.group(hlBuilder);
  body.add(headlights);

  // Flexible desert pennant whip antenna on rear right bed rail (+Z)
  const antenna = new THREE.Group();
  antenna.position.set(0.96, 1.44, 2.26);
  const antB = new ModelBuilder();
  antB.cyl(0.014, 0.022, 2.4, 6, '#23262b', { at: [0, 1.2, 0] });
  antB.box(0.04, 0.22, 0.34, '#d87a24', { at: [0, 2.18, 0.16] });
  antenna.add(materials.group(antB));
  body.add(antenna);

  const wheels: THREE.Object3D[] = [...rig.wheelsFront, ...rig.wheelsRear];
  const allyTurret: THREE.Object3D | null = role !== 'player' ? rig.turret : null;

  // Middle (player) truck carries optional captured zip-tied Hadrek Quist seated in the rear bed facing +Z!
  let quistMesh: THREE.Group | null = null;
  if (role === 'player') {
    quistMesh = buildCapturedQuist(materials);
    quistMesh.position.set(0.54, 1.04, 1.92);
    quistMesh.rotation.y = 0;
    body.add(quistMesh);
  }

  return { root, body, wheels, antenna, headlights, allyTurret, quistMesh };
}

/**
 * Legacy Mk 19 GunSpec kept exported for backwards-compatibility with tests/references.
 * The live Desert Raid technical mounts `HYBRID_HMG_AGL` (.50-cal HMG + 40mm AGL).
 */
export const MK19: GunSpec = {
  name: 'mk19-40mm',
  build: HYBRID_HMG_AGL.build,
  moving: HYBRID_HMG_AGL.moving,
  extra: HYBRID_HMG_AGL.extra,
  muzzle: HYBRID_HMG_AGL.muzzle,
  follow: HYBRID_HMG_AGL.follow,
  return: HYBRID_HMG_AGL.return,
};

let _mk19BodyGeo: THREE.CylinderGeometry | null = null;
let _mk19BodyMat: THREE.MeshBasicMaterial | null = null;
let _mk19GlowGeo: THREE.SphereGeometry | null = null;
let _mk19GlowMat: THREE.MeshBasicMaterial | null = null;

function buildMk19GrenadeMesh(): THREE.Group {
  if (!_mk19BodyGeo) {
    _mk19BodyGeo = new THREE.CylinderGeometry(0.045, 0.055, 0.24, 6);
    _mk19BodyGeo.rotateX(Math.PI / 2);
    _mk19BodyMat = new THREE.MeshBasicMaterial({
      color: 0xffc448,
      toneMapped: false,
    });
    _mk19GlowGeo = new THREE.SphereGeometry(0.11, 6, 6);
    _mk19GlowMat = new THREE.MeshBasicMaterial({
      color: 0xff8820,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
  }
  const g = new THREE.Group();
  g.name = 'desert.mk19.grenade';
  g.add(new THREE.Mesh(_mk19BodyGeo, _mk19BodyMat!));
  g.add(new THREE.Mesh(_mk19GlowGeo!, _mk19GlowMat!));
  return g;
}

interface BanditVisualResult {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Object3D[];
  gunnerPivot: THREE.Object3D | null;
  driverRider: RiderRig | null;
  gunnerRider: RiderRig | null;
  liveryColor: number;
}

/**
 * Builds a real Saltblood enemy vehicle (`jackal` technical, 2-up `moto` dirtbike, or 2-up `quad` ATV)
 * using the actual player-driveable PBR models, recolored to distinct Saltblood warband liveries with
 * visible drivers & rear pillion / roof turret shooters!
 */
function buildBanditVehicleVisual(
  materials: ModelMaterials,
  kind: BanditVehicleKind,
  variantIndex: number,
): BanditVisualResult {
  const driveId = kind === 'truck' ? 'jackal' : kind === 'quad' ? 'quad' : 'moto';
  const liveryColor = SALTBLOOD_LIVERIES[variantIndex % SALTBLOOD_LIVERIES.length]!;
  const rig = buildVehicleModel(driveId, materials);

  // Recolor armor panels into distinct Saltblood warband hues
  applyVehicleLivery(rig.root, liveryColor, kind === 'truck' ? 0.82 : 0.7);

  // Show BOTH driver and rear pillion / roof gunner with hostile crimson-orange accents
  const driverRider = rig.riders[0] ?? null;
  const gunnerRider = rig.riders[1] ?? null;
  if (driverRider) {
    setRiderAccent(driverRider, '#ff4824');
    driverRider.root.visible = true;
  }
  if (gunnerRider) {
    setRiderAccent(gunnerRider, '#ff2a18');
    gunnerRider.root.visible = true;
  }

  const root = new THREE.Group();
  root.name = `desert.bandit.${kind}`;
  const body = new THREE.Group();
  root.add(body);

  // Real drive models face +Z; flip Math.PI inside holder so nose aligns with -Z convoy convention
  const holder = new THREE.Group();
  holder.rotation.y = Math.PI;
  holder.add(rig.root);
  body.add(holder);

  const wheels: THREE.Object3D[] = [...rig.wheelsFront, ...rig.wheelsRear];
  const gunnerPivot: THREE.Object3D | null =
    kind === 'truck' ? rig.turret : (gunnerRider?.root ?? null);

  return {
    root,
    body,
    wheels,
    gunnerPivot,
    driverRider,
    gunnerRider,
    liveryColor,
  };
}

// -------------------------------------------------------------------------------------------------
// Desert Convoy M2-X50 .50-Cal HMG + 40mm Smart-AGL Gunner HUD
// -------------------------------------------------------------------------------------------------

const CONVOY_HUD_CSS = `
.dr-cv-hud { position: absolute; inset: 0; pointer-events: none; font-family: var(--mono, monospace); color: #f6efe2; opacity: 0; transition: opacity 0.22s; z-index: 5; }
.dr-cv-hud.on { opacity: 1; }
.dr-cv-top { position: absolute; top: 5.6rem; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 1.35rem; padding: 0.42rem 1.05rem; background: rgba(18, 14, 10, 0.82); border-top: 0.16rem solid #d89b38; box-shadow: 0.16rem 0.16rem 0 #000; }
.dr-cv-title { font: 700 1.02rem/1 var(--display, sans-serif); letter-spacing: 0.08em; color: #ffcf6e; }
.dr-cv-stage { font-size: 0.84rem; letter-spacing: 0.07em; color: #ff8c42; font-weight: 700; }
.dr-cv-speed { font-size: 0.9rem; letter-spacing: 0.08em; color: #9be88a; font-weight: 700; }
.dr-cv-bot { position: absolute; bottom: 9.8rem; left: 50%; transform: translateX(-50%); display: flex; gap: 1.25rem; padding: 0.55rem 1.1rem; background: rgba(18, 14, 10, 0.84); border-bottom: 0.16rem solid #d89b38; box-shadow: 0.16rem 0.16rem 0 #000; }
.dr-cv-gauge { width: 13.8rem; padding: 0.16rem 0.32rem; border-left: 2px solid transparent; opacity: 0.62; transition: opacity 0.12s, border-color 0.12s; }
.dr-cv-gauge.hull-g { opacity: 1; }
.dr-cv-gauge.active { opacity: 1; border-left-color: #ffcf6e; }
.dr-cv-ghead { display: flex; justify-content: space-between; font-size: 0.74rem; letter-spacing: 0.08em; margin-bottom: 0.24rem; }
.dr-cv-track { height: 0.48rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.18); overflow: hidden; }
.dr-cv-fill { height: 100%; width: 100%; transform-origin: 0 50%; transition: transform 0.06s linear; }
.dr-cv-fill.hull { background: linear-gradient(90deg, #4ec86b, #96f09e); }
.dr-cv-fill.hull.low { background: linear-gradient(90deg, #d82a20, #ff6440); }
.dr-cv-fill.heat { background: linear-gradient(90deg, #e0a624, #ff4420); }
.dr-cv-fill.heat.hot { background: #ff2818; animation: dr-cv-blink 0.25s infinite alternate; }
.dr-cv-fill.agl { background: linear-gradient(90deg, #ff9830, #ffcf6e); }
.dr-cv-overheat { color: #ff4228; font-weight: 800; }
.dr-cv-xh { position: absolute; left: 50%; top: 50%; width: 32px; height: 32px; margin: -16px 0 0 -16px; border: 1.5px solid rgba(255, 224, 136, 0.88); border-radius: 50%; box-shadow: 0 0 8px rgba(255, 176, 48, 0.35); transition: transform 0.12s; }
.dr-cv-xh.zoom { transform: scale(0.66); border-color: #ff7048; }
.dr-cv-xh.agl { border-color: #ff9e3b; box-shadow: 0 0 10px rgba(255, 140, 40, 0.55); }
.dr-cv-xh::after { content: ''; position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px 0 0 -2px; background: #ffcf6e; border-radius: 50%; }
@keyframes dr-cv-blink { from { opacity: 0.55; } to { opacity: 1; } }
`;

interface ConvoyHudRefs {
  root: HTMLElement;
  stage: Label;
  speed: Label;
  hullText: Label;
  hullFill: HTMLElement;
  hmgGauge: HTMLElement;
  heatText: Label;
  heatFill: HTMLElement;
  aglGauge: HTMLElement;
  aglText: Label;
  aglFill: HTMLElement;
  reticle: HTMLElement;
}

function createConvoyHud(): ConvoyHudRefs | null {
  if (typeof document === 'undefined') return null;
  if (!document.getElementById('dr-convoy-hud-style')) {
    const style = document.createElement('style');
    style.id = 'dr-convoy-hud-style';
    style.textContent = CONVOY_HUD_CSS;
    document.head?.append(style);
  }
  const stageEl = span('dr-cv-stage', 'APPROACH — OPEN DUNES');
  const speedEl = span('dr-cv-speed', '55 KM/H');
  const hullTextEl = span('', '500 / 500');
  const hullFill = div('dr-cv-fill hull');
  const heatTextEl = span('', '0%');
  const heatFill = div('dr-cv-fill heat');
  const aglTextEl = span('', 'READY');
  const aglFill = div('dr-cv-fill agl');
  const reticle = div('dr-cv-xh');
  const hmgGauge = div('dr-cv-gauge active', div('dr-cv-ghead', span('', '.50 HMG [LMB]'), heatTextEl), div('dr-cv-track', heatFill));
  const aglGauge = div('dr-cv-gauge', div('dr-cv-ghead', span('', '40MM AGL [HOLD R]'), aglTextEl), div('dr-cv-track', aglFill));

  const root = div(
    'dr-cv-hud',
    div('dr-cv-top', span('dr-cv-title', 'JACKAL TECHNICAL // LMB FIRE · RMB ZOOM · HOLD R SWITCH'), stageEl, speedEl),
    reticle,
    div(
      'dr-cv-bot',
      div('dr-cv-gauge hull-g', div('dr-cv-ghead', span('', 'TRUCK ARMOR'), hullTextEl), div('dr-cv-track', hullFill)),
      hmgGauge,
      aglGauge,
    ),
  );
  const host = document.querySelector('.hud') ?? document.body;
  host?.append(root);
  return {
    root,
    stage: new Label(stageEl),
    speed: new Label(speedEl),
    hullText: new Label(hullTextEl),
    hullFill,
    hmgGauge,
    heatText: new Label(heatTextEl),
    heatFill,
    aglGauge,
    aglText: new Label(aglTextEl),
    aglFill,
    reticle,
  };
}

// -------------------------------------------------------------------------------------------------
// DesertConvoy
// -------------------------------------------------------------------------------------------------

export class DesertConvoy implements ConvoyController, ExtraTarget {
  private readonly materials: ModelMaterials;
  private readonly root = new THREE.Group();
  private built = false;

  // Precomputed arc-length splines
  private readonly approachPath = new SplinePath(CONVOY_PATHS.approach, false, 14);
  private readonly wallLoopPath = new SplinePath(CONVOY_PATHS.wallLoop, true, 12);
  private readonly exfilPath = new SplinePath(CONVOY_PATHS.exfil, false, 14);

  // 3-truck ally-driven column
  private readonly _trucks: RaidTruck[] = [];
  private playerTruck: RaidTruck | null = null;

  // Player combination M2-X50 .50-cal HMG + 40mm Smart-AGL technical turret rig
  private gun: Gun | null = null;
  private readonly _turretPivot = new THREE.Vector3(0, 2.38, DESERT_Z.approachStart);
  private readonly _turretMuzzle = new THREE.Vector3(0, 2.4, DESERT_Z.approachStart - 1.48);
  private readonly seatView: SeatView = {
    position: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    roll: 0,
    shake: 1,
  };

  // Phase & progression state
  private _phase: ConvoyPhase = 'idle';
  private _mounted = false;
  private _yaw = 0;
  private _pitch = 0;
  private _zoomed = false;
  private _camFov: number = DESERT_CONVOY_CONSTANTS.turretFov;
  private _weaponMode: 'hmg' | 'agl' = 'hmg';
  private rHeld = -1;
  private _hull: number = DESERT_CONVOY_CONSTANTS.maxHull;
  readonly maxHull: number = DESERT_CONVOY_CONSTANTS.maxHull;
  readonly heat = new Heat({
    heatPerShot: DESERT_CONVOY_CONSTANTS.heatPerShot,
    cool: DESERT_CONVOY_CONSTANTS.heatCool,
    vent: DESERT_CONVOY_CONSTANTS.heatVent,
  });

  private pathDist = 0;
  private endingCruiseZ: number = DESERT_CONVOY_CONSTANTS.endingCruiseMinZ;
  private currentSpeed = 0;
  private _quistCaptured = false;
  private _banditVehiclesDestroyed = 0;

  // Signal latches & stage counters
  private approachDoneSignalled = false;
  private wallLoopReadySignalled = false;
  private exfilBoardedSignalled = false;
  private exfilClearSignalled = false;
  private _wallLoopPasses = 0;
  private _wallLoopHitScore = 0;

  // Exfil forecourt arrival & boarding prompt
  private exfilArriveElapsed = 0;
  private exfilArriveDuration = 1.6;
  private readonly exfilArriveStart = new THREE.Vector3(
    CARGO_PLANE.forecourtExfilPos[0] + 20,
    0,
    CARGO_PLANE.forecourtExfilPos[2] + 14,
  );
  private readonly exfilTargetPos = new THREE.Vector3(
    CARGO_PLANE.forecourtExfilPos[0],
    CARGO_PLANE.forecourtExfilPos[1],
    CARGO_PLANE.forecourtExfilPos[2],
  );
  private exfilPromptUnfollow: (() => void) | null = null;
  private readonly exfilPromptPos = new THREE.Vector3();
  private exfilPulseClock = 0;
  private exfilAutoSpawnTimer = 0;

  // Firing (LMB active mode: .50-cal HMG or 40mm AGL toggled via Hold R; RMB zooms) & audio
  private hmgCooldown = 0;
  private aglCooldown = 0;
  private shotsFired = 0;
  private engineLoop: LoopHandle | null = null;
  private nextProjectileId = 1;
  private readonly _projectiles: Mk19Projectile[] = [];
  private skipBlastBanditId = -1;

  // Saltblood bandit vehicles & wrecks
  private nextBanditId = 1;
  private waveSpawnCursor = 0;
  private readonly _bandits: BanditVehicle[] = [];
  private readonly _banditSnap: BanditVehicle[] = [];
  private _banditSnapInUse = false;
  private readonly _wrecks: BanditWreck[] = [];
  private readonly banditByCollider = new Map<number, BanditVehicle>();
  private registeredOn: VehicleSystem | null = null;

  // HUD
  private hud: ConvoyHudRefs | null = null;
  private hudLastKmh = -1;
  private hudLastStage = '';
  private hudLastHullText = '';
  private hudLastHullScale = '';
  private hudLastHullLow: boolean | null = null;
  private hudLastHeatText = '';
  private hudLastHeatOverheat: boolean | null = null;
  private hudLastHeatScale = '';
  private hudLastHeatHot: boolean | null = null;
  private hudLastAglText = '';
  private hudLastAglScale = '';
  private hudLastMode: 'hmg' | 'agl' | null = null;
  private hudLastZoom: boolean | null = null;

  constructor(
    private readonly ctx: Ctx,
    private readonly runner: MissionRunner,
    private readonly ui: CampaignHud,
  ) {
    this.materials = new ModelMaterials(ctx);
    this.root.name = 'desert.convoy.root';
    this.root.visible = false;
  }

  // -----------------------------------------------------------------------------------------------
  // Read-only state accessors
  // -----------------------------------------------------------------------------------------------

  get banditVehiclesDestroyed(): number {
    return this._banditVehiclesDestroyed;
  }

  get phase(): ConvoyPhase {
    return this._phase;
  }

  get mounted(): boolean {
    return this._mounted;
  }

  get hull(): number {
    return this._hull;
  }

  get yaw(): number {
    return this._yaw;
  }

  get pitch(): number {
    return this._pitch;
  }

  get zoomed(): boolean {
    return this._zoomed;
  }

  get weaponMode(): 'hmg' | 'agl' {
    return this._weaponMode;
  }

  get quistCaptured(): boolean {
    return this._quistCaptured;
  }

  get quistVisible(): boolean {
    return this.playerTruck?.quistMesh?.visible ?? false;
  }

  get trucks(): readonly RaidTruck[] {
    return this._trucks;
  }

  get bandits(): readonly BanditVehicle[] {
    return this._bandits;
  }

  get wrecks(): readonly BanditWreck[] {
    return this._wrecks;
  }

  get projectiles(): readonly Mk19Projectile[] {
    return this._projectiles;
  }

  get turretMuzzle(): THREE.Vector3 {
    return this._turretMuzzle;
  }

  get wallLoopPasses(): number {
    return this._wallLoopPasses;
  }

  get wallLoopHitScore(): number {
    return this._wallLoopHitScore;
  }

  // -----------------------------------------------------------------------------------------------
  // ConvoyController API
  // -----------------------------------------------------------------------------------------------

  startApproach(): void {
    this.ensureBuilt();
    this.ensureRegistered();
    this.clearBanditsAndWrecks();
    this.clearProjectiles();
    this.clearExfilPrompt();

    this.root.visible = true;
    this._phase = 'approach';
    this.pathDist = 0;
    this.currentSpeed = DESERT_CONVOY_CONSTANTS.approachSpeed;
    this._hull = this.maxHull;
    this._quistCaptured = false;
    this.setQuistVisible(false);
    this.heat.value = 0;
    this.heat.overheated = false;
    this.hmgCooldown = 0;
    this.aglCooldown = 0;
    this.approachDoneSignalled = false;
    this.wallLoopReadySignalled = false;
    this.exfilBoardedSignalled = false;
    this.exfilClearSignalled = false;
    this._wallLoopPasses = 0;
    this._wallLoopHitScore = 0;

    // Place convoy at Approach start (0, 0, 222) heading North (yaw ≈ 0)
    this.approachPath.sample(0, _tmp, _tan);
    const startYaw = Math.atan2(-_tan.x, -_tan.z);
    this.placeConvoy(_tmp, startYaw, 1, 0, true);

    this.mountTurret(0, 0);
    this.startEngineLoop(1.05);
    this.updateHud();
  }

  startWallLoop(): void {
    this.ensureBuilt();
    this.ensureRegistered();
    this.root.visible = true;
    this._phase = 'wallLoop';
    this.pathDist = 0;
    this.currentSpeed = DESERT_CONVOY_CONSTANTS.wallLoopSpeed;
    this.wallLoopReadySignalled = false;
    this._wallLoopPasses = 0;
    this._wallLoopHitScore = 0;
    this.patchHull(DESERT_CONVOY_CONSTANTS.phasePatchHeal);

    if (!this._mounted) {
      this.mountTurret(0, 0);
    }
    this.startEngineLoop(0.92);
    this.updateHud();
  }

  dismountAtGate(): void {
    this.ensureBuilt();
    this.clearExfilPrompt();
    this.clearProjectiles();
    this.root.visible = true;
    this._phase = 'parkedGate';
    this.currentSpeed = 0;

    // Park 3 trucks cleanly in front of the breached Main Gate (z ≈ 74)
    const gateMid = _tmp.set(0, 0, DESERT_CONVOY_CONSTANTS.gateParkZ);
    if (this.playerTruck) {
      this.playerTruck.position.copy(gateMid);
      this.playerTruck.yaw = 0;
      this.playerTruck.pitch = 0;
      this.playerTruck.roll = 0;
      this.playerTruck.speed = 0;
      this.syncTruckObject(this.playerTruck);
    }
    for (const t of this._trucks) {
      if (t.role === 'lead') {
        t.position.set(-10, 0, DESERT_CONVOY_CONSTANTS.gateParkZ + 4);
        t.yaw = 0.2;
        t.pitch = 0;
        t.roll = 0;
        t.speed = 0;
        this.syncTruckObject(t);
      } else if (t.role === 'rear') {
        t.position.set(10, 0, DESERT_CONVOY_CONSTANTS.gateParkZ + 4);
        t.yaw = -0.2;
        t.pitch = 0;
        t.roll = 0;
        t.speed = 0;
        this.syncTruckObject(t);
      }
    }

    // Release turret seat cleanly & place player at (0, 0, 68) facing North (0 yaw)
    this.dismountTurret(false, true);
    this.stopEngineLoop();
    const dismount = _tmp2.set(
      DESERT_CONVOY_CONSTANTS.dismountPos[0],
      DESERT_CONVOY_CONSTANTS.dismountPos[1],
      DESERT_CONVOY_CONSTANTS.dismountPos[2],
    );
    this.ctx.player?.teleport?.(dismount, 0);
    this.stowGunOnParkedTruck();
  }

  arriveForExfil(quistCaptured: boolean): void {
    this.ensureBuilt();
    this.ensureRegistered();
    this.clearExfilPrompt();

    this.root.visible = true;
    this.setQuistCaptured(quistCaptured);
    this._phase = 'exfilArriving';
    this.exfilBoardedSignalled = false;
    this.exfilClearSignalled = false;
    this.exfilArriveElapsed = 0;
    this.exfilArriveDuration = 1.6;
    this.exfilPulseClock = 0;
    this.currentSpeed = DESERT_CONVOY_CONSTANTS.exfilArriveSpeed;

    // Sweep in from the eastern bypass approach into CARGO_PLANE.forecourtExfilPos (0, 0, -206)
    this.exfilArriveStart.set(this.exfilTargetPos.x + 20, 0, this.exfilTargetPos.z + 14);
    this.placeConvoy(this.exfilArriveStart, 0.96, 0.65, 0, true);
    this.stowGunOnParkedTruck();
    this.startEngineLoop(1.18);
    this.ctx.audio?.play?.('vehicle_horn', { position: this.exfilTargetPos, volume: 0.85 });
    this.ctx.hud?.feed?.('CONVOY INBOUND — GET TO THE EXFIL TRUCK!', '#ffcf6e');
  }

  startExfilChase(quistCaptured: boolean): void {
    this.ensureBuilt();
    this.ensureRegistered();
    this.clearExfilPrompt();
    this.clearBoardingHint();

    this.root.visible = true;
    this.setQuistCaptured(quistCaptured);
    this._phase = 'exfilChase';
    this.pathDist = 0;
    this.currentSpeed = DESERT_CONVOY_CONSTANTS.exfilSpeed;
    this.exfilClearSignalled = false;
    this.exfilAutoSpawnTimer = 1.2;
    this.patchHull(DESERT_CONVOY_CONSTANTS.phasePatchHeal);

    this.exfilPath.sample(0, _tmp, _tan);
    const startYaw = Math.atan2(-_tan.x, -_tan.z);
    this.placeConvoy(_tmp, startYaw, 0.58, 0, true);

    if (!this._mounted) {
      // Face aft (North = yaw 0) so the gunner immediately sees pursuing Saltbloods & burning Surplus
      this.mountTurret(0, 0);
    }
    this.startEngineLoop(1.32);
    this.ctx.hud?.feed?.('EXFIL UNDERWAY — BLAST PURSUING SALTBLOODS!', '#ffcf6e');
    this.updateHud();
  }

  setQuistCaptured(captured: boolean): void {
    this._quistCaptured = captured;
    this.setQuistVisible(captured);
  }

  getQuistBedPosition(out: THREE.Vector3): THREE.Vector3 {
    const [lx, ly, lz] = DESERT_CONVOY_CONSTANTS.quistBedLocal;
    const pt = this.playerTruck;
    if (!pt) {
      return out.set(lx, ly, CONVOY_PATHS.approach[0]![2] + lz);
    }
    const cy = Math.cos(pt.yaw);
    const sy = Math.sin(pt.yaw);
    return out.set(
      pt.position.x + lx * cy + lz * sy,
      pt.root.position.y + ly,
      pt.position.z - lx * sy + lz * cy,
    );
  }

  enterEndingCruise(): void {
    this.ensureBuilt();
    this.clearExfilPrompt();
    this.clearBoardingHint();
    this.clearProjectiles();

    // Remove live hostile bandits so they do not interrupt the scenic ending cutscene
    for (const bv of this._bandits) {
      this.removeBanditCollider(bv);
      bv.root.removeFromParent();
    }
    this._bandits.length = 0;
    this.banditByCollider.clear();

    // Unmount turret input/HUD WITHOUT touching camera.setSeat(null), player.unpark(), or player.teleport()
    // so the ending cutscene maintains uninterrupted camera ownership.
    this._mounted = false;
    this._zoomed = false;
    if (this.ctx.player) {
      this.ctx.player.interceptor = null;
    }
    this.hideHud();

    this.root.visible = true;
    this._phase = 'endingCruise';
    this.currentSpeed = DESERT_CONVOY_CONSTANTS.endingCruiseSpeed;

    if (this.playerTruck) {
      const clampedZ = clamp(
        this.playerTruck.position.z,
        DESERT_CONVOY_CONSTANTS.endingCruiseMinZ,
        DESERT_CONVOY_CONSTANTS.endingCruiseMaxZ,
      );
      this.endingCruiseZ = clampedZ;
      if (this.playerTruck.position.z < DESERT_CONVOY_CONSTANTS.endingCruiseMinZ) {
        _tmp.set(0, 0, clampedZ);
        this.placeConvoy(_tmp, Math.PI, 1.0, 0, true);
      } else if (this.playerTruck.position.z > DESERT_CONVOY_CONSTANTS.endingCruiseMaxZ) {
        _tmp.set(this.playerTruck.position.x, 0, clampedZ);
        this.placeConvoy(_tmp, Math.PI, 1.0, 0, true);
      }
    } else {
      this.endingCruiseZ = DESERT_CONVOY_CONSTANTS.endingCruiseMinZ;
    }

    this.stowGunOnParkedTruck();
    this.startEngineLoop(0.88);
  }

  spawnSideGateTruck(side: 'west' | 'east'): void {
    this.ensureBuilt();
    this.ensureRegistered();
    const gate = SIDE_GATES.find(g => g.id === side) ?? SIDE_GATES[0]!;
    const spawnPos = new THREE.Vector3(gate.x, 0, gate.z + 1.5);
    // Burst south (+Z) out of the side gate (yaw = Math.PI)
    const truck = this.spawnBanditVehicle('truck', spawnPos, Math.PI, 'sideGate');
    truck.preferredSide = side === 'west' ? -1 : 1;
    this.ctx.audio?.play?.('vehicle_horn', { position: spawnPos, volume: 0.72, pitch: 0.86 });
    this.ctx.hud?.feed?.(
      side === 'west' ? 'SALTBLOOD TECHNICAL OUT OF WEST GATE!' : 'SALTBLOOD TECHNICAL OUT OF EAST GATE!',
      '#ff8c42',
    );
  }

  spawnBanditWave(phase: 'approach' | 'exfil', count: number): void {
    this.ensureBuilt();
    this.ensureRegistered();
    const n = Math.max(0, Math.round(count));
    if (n === 0) return;

    const mid = this.getTruckPosition(_tmp);
    const pattern: readonly BanditVehicleKind[] = ['bike', 'truck', 'quad', 'bike', 'quad', 'truck'];
    for (let i = 0; i < n; i++) {
      // Rich mix of 2-up Saltblood motos, 2-up quads, and colored armed technicals
      const kind: BanditVehicleKind = pattern[this.waveSpawnCursor++ % pattern.length]!;
      const side = i % 2 === 0 ? -1 : 1;
      const spreadX = side * rand(13, 30) + rand(-3.5, 3.5);

      if (phase === 'approach') {
        const spawnZ = Math.max(DESERT_Z.wallLine + 14, mid.z - rand(34, 58) - i * 4.5);
        const spawnPos = new THREE.Vector3(clamp(mid.x + spreadX, -76, 76), 0, spawnZ);
        const bv = this.spawnBanditVehicle(kind, spawnPos, Math.PI, 'approach');
        bv.preferredSide = side;
        bv.preferredLead = rand(16, 34);
      } else {
        // Exfil pursuers emerge behind/flanking the southbound convoy (lower Z, chasing +Z)
        const spawnZ = mid.z - rand(24, 46) - i * 5.5;
        const spawnPos = new THREE.Vector3(clamp(mid.x + spreadX * 0.72, -62, 62), 0, spawnZ);
        const bv = this.spawnBanditVehicle(kind, spawnPos, Math.PI, 'exfil');
        bv.preferredSide = side;
        bv.preferredLead = rand(-18, -8);
      }
    }
  }

  isPlayerBoarded(): boolean {
    return this._mounted;
  }

  getTruckPosition(out: THREE.Vector3): THREE.Vector3 {
    if (this.playerTruck) return out.copy(this.playerTruck.position);
    return out.set(0, 0, CONVOY_PATHS.approach[0]![2]);
  }

  getTruckYaw(): number {
    return this.playerTruck?.yaw ?? 0;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const step = Math.min(dt, 0.1);

    if (this._phase === 'approach') {
      this.updateApproach(step);
    } else if (this._phase === 'wallLoop') {
      this.updateWallLoop(step);
    } else if (this._phase === 'exfilArriving') {
      this.updateExfilArriving(step);
    } else if (this._phase === 'exfilWaiting') {
      this.updateExfilWaiting(step);
    } else if (this._phase === 'exfilChase') {
      this.updateExfilChase(step);
    } else if (this._phase === 'endingCruise') {
      this.updateEndingCruise(step);
    }

    if (this._phase !== 'idle') {
      this.updateTruckVisuals(step);
      this.updateAllyGunners(step);
    }

    if (this._mounted) {
      this.updateTurretControl(step);
    }

    if (this._projectiles.length > 0) {
      this.updateProjectiles(step);
    }

    if (this._bandits.length > 0) {
      this.updateBandits(step);
    }
    if (this._wrecks.length > 0) {
      this.updateWrecks(step);
    }

    if (this._mounted) {
      this.updateHud();
    }
  }

  clear(): void {
    this.dismountTurret(false, false);
    this.stopEngineLoop();
    this.clearExfilPrompt();
    this.clearBoardingHint();
    this.clearProjectiles();
    this.clearBanditsAndWrecks();

    if (this.registeredOn) {
      this.registeredOn.removeExtra(this);
      this.registeredOn = null;
    }

    this._phase = 'idle';
    this.pathDist = 0;
    this.endingCruiseZ = DESERT_CONVOY_CONSTANTS.endingCruiseMinZ;
    this.currentSpeed = 0;
    this._hull = this.maxHull;
    this._quistCaptured = false;
    this._banditVehiclesDestroyed = 0;
    this._wallLoopPasses = 0;
    this._wallLoopHitScore = 0;
    this.heat.value = 0;
    this.heat.overheated = false;
    this.hmgCooldown = 0;
    this.aglCooldown = 0;
    this.waveSpawnCursor = 0;
    this.approachDoneSignalled = false;
    this.wallLoopReadySignalled = false;
    this.exfilBoardedSignalled = false;
    this.exfilClearSignalled = false;

    this.setQuistVisible(false);
    this.root.visible = false;
    this.gun?.hide();
    this.hideHud();
  }

  reset(): void {
    this.clear();
  }

  // -----------------------------------------------------------------------------------------------
  // ExtraTarget implementation (so on-foot player weapons, rockets, grenades & Frame hit bandits)
  // -----------------------------------------------------------------------------------------------

  shot(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, source: string): boolean {
    const bv = this.banditByCollider.get(collider.handle);
    if (!bv) return false;
    if (!bv.alive) return true;
    this.damageBandit(bv, amount, source, point);
    return true;
  }

  direct(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, _kind: ExplosionKind, source: string): boolean {
    const bv = this.banditByCollider.get(collider.handle);
    if (!bv) return false;
    if (!bv.alive) return true;
    this.damageBandit(bv, amount * 1.45, source, point);
    return true;
  }

  blast(center: THREE.Vector3, spec: ExplosionSpec): number {
    const def = EXPLOSIONS[spec.kind];
    let hit = 0;
    const reuse = !this._banditSnapInUse;
    let snap: BanditVehicle[];
    if (reuse) {
      this._banditSnapInUse = true;
      snap = this._banditSnap;
      snap.length = this._bandits.length;
      for (let i = 0; i < this._bandits.length; i++) snap[i] = this._bandits[i]!;
    } else {
      snap = this._bandits.slice();
    }
    try {
      for (let i = 0; i < snap.length; i++) {
        const bv = snap[i]!;
        if (!bv.alive || bv.id === this.skipBlastBanditId) continue;
        const d = Math.max(0, bv.position.distanceTo(center) - 1.2);
        if (d > spec.radius) continue;
        const falloff = 1 - (d / spec.radius) * (1 - (def?.edgeDamage ?? 0.35));
        const dealt = spec.instakill ? bv.maxHp : spec.damage * falloff * 1.35;
        this.damageBandit(bv, dealt, spec.source, bv.center);
        hit++;
      }
    } finally {
      if (reuse) {
        snap.length = 0;
        this._banditSnapInUse = false;
      }
    }
    return hit;
  }

  paintable(out: MissileTarget[]): void {
    for (const bv of this._bandits) {
      if (!bv.alive) continue;
      out.push({
        center: bv.center,
        alive: bv.alive,
        aimLift: 0.4,
        paintRadius: bv.kind === 'truck' ? 2.6 : 1.4,
      });
    }
  }

  frameBlow(at: THREE.Vector3, radius: number, damage: number): number {
    let hit = 0;
    const reuse = !this._banditSnapInUse;
    let snap: BanditVehicle[];
    if (reuse) {
      this._banditSnapInUse = true;
      snap = this._banditSnap;
      snap.length = this._bandits.length;
      for (let i = 0; i < this._bandits.length; i++) snap[i] = this._bandits[i]!;
    } else {
      snap = this._bandits.slice();
    }
    try {
      for (let i = 0; i < snap.length; i++) {
        const bv = snap[i]!;
        if (!bv.alive) continue;
        if (bv.position.distanceTo(at) <= radius + 2.0) {
          this.damageBandit(bv, damage * 1.6, 'frame_stomp', bv.center);
          hit++;
        }
      }
    } finally {
      if (reuse) {
        snap.length = 0;
        this._banditSnapInUse = false;
      }
    }
    return hit;
  }

  // -----------------------------------------------------------------------------------------------
  // Public helpers for testing & direct control
  // -----------------------------------------------------------------------------------------------

  setAim(yaw: number, pitch: number): void {
    this._yaw = wrapAngle(yaw);
    this._pitch = clamp(pitch, DESERT_CONVOY_CONSTANTS.pitchMin, DESERT_CONVOY_CONSTANTS.pitchMax);
    this.gun?.snap(this._yaw, this._pitch);
    this.syncTurretTransforms(0);
  }

  patchHull(amount: number): void {
    if (amount <= 0) return;
    const prev = this._hull;
    this._hull = Math.min(this.maxHull, this._hull + amount);
    if (this._hull > prev) {
      this.ctx.audio?.play?.('pickup_armor', { volume: 0.55 });
    }
  }

  damageConvoyHull(amount: number, from?: THREE.Vector3, source = 'saltblood_fire'): void {
    if (!this._mounted || amount <= 0) return;
    this._hull = Math.max(0, this._hull - amount);

    const pos = this.getTruckPosition(_tmp).addScaledVector(UP, 1.5);
    this.ctx.fx?.sparks?.(pos, UP, 7, 0xffaa44);
    this.ctx.audio?.play?.(amount >= 14 ? 'veh_hit_heavy' : 'veh_hit_light', {
      volume: amount >= 14 ? 0.84 : 0.72,
      pitchJitter: 0.08,
    });
    this.ctx.camera?.addTrauma?.(clamp(amount * 0.012, 0.05, 0.35));

    if (from && this.ctx.render?.post?.damageDirection) {
      const dx = from.x - pos.x;
      const dz = from.z - pos.z;
      const worldAngle = Math.atan2(dx, -dz);
      const rel = wrapAngle(worldAngle + this._yaw);
      this.ctx.render.post.damageDirection(rel, clamp(amount / 40, 0.22, 1));
    }

    if (this._hull <= 0) {
      this.ctx.fx?.explosion?.(pos, { radius: 7, kind: 'barrel', scale: 1.35 });
      this.ctx.audio?.play?.('veh_destroyed', { volume: 1.0 });
      this.dismountTurret(true, false);
      this.ctx.player?.takeDamage?.({
        amount: 9999,
        type: 'explosive',
        source,
        from,
      });
    }
  }

  /**
   * Fires a single .50-cal HMG hitscan round from the Jackal technical's combination M2-X50 HMG + 40mm AGL turret.
   * Shreds Saltblood bandits (with locational rider/gunner/engine/tire hits), human enemies, fuel barrels,
   * wooden structures, watchtowers, and outer wall panels.
   */
  fireHmgShot(originOverride?: THREE.Vector3, dirOverride?: THREE.Vector3): boolean {
    const gun = this.gun;
    if (originOverride) {
      _muzzle.copy(originOverride);
    } else if (gun) {
      gun.muzzle(_muzzle);
    } else {
      _muzzle.copy(this._turretMuzzle);
    }

    if (dirOverride) {
      _dir.copy(dirOverride).normalize();
    } else {
      const cp = Math.cos(this._pitch);
      _bore.set(-Math.sin(this._yaw) * cp, Math.sin(this._pitch), -Math.cos(this._yaw) * cp);
      randomInCone(_bore, DESERT_CONVOY_CONSTANTS.hmgSpread, _dir);
    }

    const maxDist = DESERT_CONVOY_CONSTANTS.turretMaxRange;
    let bestDist: number = maxDist;
    let hitBandit: BanditVehicle | null = null;
    let hitZone: BanditHitZone | null = null;
    let hitEnemy: EnemyInstance | null = null;
    let hitCollider: RAPIER.Collider | null = null;
    let hitWorld = false;
    _hitNorm.copy(UP);

    // 1. World solid surfaces (ignore our own bandit static colliders so OBB hitboxes resolve riders/gunners)
    const worldHit = this.ctx.physics?.raycast?.(_muzzle, _dir, maxDist, CG.World) ?? null;
    const isBanditCol =
      worldHit?.collider != null && this.banditByCollider.has(worldHit.collider.handle);
    if (worldHit && !isBanditCol && worldHit.distance <= bestDist) {
      bestDist = worldHit.distance;
      hitWorld = true;
      hitCollider = worldHit.collider ?? null;
      _hitNorm.copy(worldHit.normal);
    }

    // 2. Saltblood bandit vehicle locational OBB hitboxes (rider, rear gunner, engine, tires, chassis)
    for (let bIdx = 0; bIdx < this._bandits.length; bIdx++) {
      const bv = this._bandits[bIdx]!;
      if (!bv.alive) continue;
      _invQ.copy(bv.root.quaternion).invert();
      _localOrigin.copy(_muzzle).sub(bv.position).applyQuaternion(_invQ);
      _localDir.copy(_dir).applyQuaternion(_invQ);

      for (let zIdx = 0; zIdx < bv.zones.length; zIdx++) {
        const z = bv.zones[zIdx]!;
        if (z.destroyed && z.kind !== 'chassis') continue;
        const d = rayLocalBoxDist(_localOrigin, _localDir, z.offset, z.halfExtents, bestDist);
        if (d >= 0 && d <= bestDist) {
          bestDist = d;
          hitBandit = bv;
          hitZone = z;
          hitEnemy = null;
          hitCollider = null;
          hitWorld = false;
          _hitNorm.copy(_dir).negate();
        }
      }
    }

    // 3. Living human Saltblood enemies
    const aliveEnemies = this.ctx.enemies?.alive;
    if (aliveEnemies) {
      for (let eIdx = 0; eIdx < aliveEnemies.length; eIdx++) {
        const e = aliveEnemies[eIdx]!;
        if (!e.alive) continue;
        _tmp.subVectors(e.center, _muzzle);
        const projT = _tmp.dot(_dir);
        if (projT < 0 || projT > bestDist) continue;
        _tmp2.copy(_muzzle).addScaledVector(_dir, projT);
        if (_tmp2.distanceToSquared(e.center) <= 0.65 * 0.65) {
          bestDist = projT;
          hitEnemy = e;
          hitBandit = null;
          hitZone = null;
          hitCollider = null;
          hitWorld = false;
          _hitNorm.copy(_dir).negate();
        }
      }
    }

    // 4. Desert floor fallback plane (y <= 0.05)
    if (!hitBandit && !hitEnemy && !hitWorld && _dir.y < -1e-4 && _muzzle.y > 0.05) {
      const groundT = (0.05 - _muzzle.y) / _dir.y;
      if (groundT > 0 && groundT < bestDist) {
        bestDist = groundT;
        _hitNorm.copy(UP);
      }
    }

    _hitPt.copy(_muzzle).addScaledVector(_dir, bestDist);
    this.ctx.fx?.tracer?.(_muzzle, _hitPt, 'heavy');
    this.ctx.fx?.muzzleFlash?.(_muzzle, _dir, 'hmg');

    if (hitBandit && hitZone) {
      this.damageBanditZone(hitBandit, hitZone, DESERT_CONVOY_CONSTANTS.hmgDamage, _hitPt, 'jackal_hmg');
      if (this._phase === 'wallLoop') {
        this.recordWallLoopHit(1);
      }
    } else if (hitEnemy && hitEnemy.alive) {
      const res = this.ctx.enemies?.applyDamage?.(hitEnemy, {
        amount: DESERT_CONVOY_CONSTANTS.hmgDamage,
        type: 'bullet',
        source: 'jackal_hmg',
        point: _hitPt.clone(),
        dir: _dir.clone(),
        force: 16,
        gib: false,
      });
      this.ctx.fx?.bloodHit?.(_hitPt, _hitNorm, 0.9);
      this.ctx.hud?.hitMarker?.(res?.killed ? 'kill' : 'body');
      this.ctx.audio?.play?.('hit_marker', { position: _hitPt, volume: 0.62 });
      if (this._phase === 'wallLoop') {
        this.recordWallLoopHit(1);
      }
    } else if (hitWorld || bestDist < maxDist) {
      this.ctx.fx?.sparks?.(_hitPt, _hitNorm, 7, 0xffc854);
      this.ctx.fx?.dust?.(_hitPt, _hitNorm, 0.85);
      this.ctx.fx?.chips?.(_hitPt, 0xc8b08a, 5);
      if (hitCollider) {
        this.ctx.world?.objects?.damageExplosive?.(hitCollider, DESERT_CONVOY_CONSTANTS.hmgStructDamage, 'jackal_hmg');
        this.ctx.world?.objects?.destruction?.damageCollider?.(
          hitCollider,
          DESERT_CONVOY_CONSTANTS.hmgStructDamage,
          'jackal_hmg',
          _hitPt,
        );
      }
      this.ctx.world?.objects?.destruction?.blast?.(
        _hitPt,
        1.35,
        Math.round(DESERT_CONVOY_CONSTANTS.hmgStructDamage * 0.55),
        'jackal_hmg',
      );
      if (this._phase === 'wallLoop' && Math.abs(_hitPt.z - DESERT_Z.wallLine) <= 16) {
        this.recordWallLoopHit(1);
      }
    }

    this.shotsFired++;
    if (gun) {
      _casing.set(-_dir.z, rand(0.9, 1.6), _dir.x).multiplyScalar(1.45);
      this.ctx.fx?.shellCasing?.(gun.root.position, _casing, 'rifle');
    }
    gun?.recoil(0.032);
    this.ctx.audio?.play?.('hmg_shot', { position: _muzzle, volume: 0.82, pitch: 0.96, pitchJitter: 0.06 });
    this.ctx.camera?.kick?.(rand(0.002, 0.0045), rand(-0.003, 0.003));
    this.ctx.camera?.addTrauma?.(0.022);

    return true;
  }

  /**
   * Launches a single 40mm HEDP grenade from the Jackal technical's coaxial 40mm Smart-AGL:
   * - Flies on a high-velocity ballistic arc (`110 m/s`, gravity `-14 m/s²`) with a visible golden warhead & trail.
   * - On impact with bandits, human Saltbloods, wall panels, watchtowers, or desert ground, detonates with
   *   `210` explosive damage in `4.8m` radius (`source: 'mgl'`, `kind: 'grenade'`) for chunky gore/paste
   *   plus controlled `95` structural damage in `3.4m` radius (`source: 'mgl'`) to dent/punch walls & topple towers!
   */
  fireSingleShot(originOverride?: THREE.Vector3, dirOverride?: THREE.Vector3): boolean {
    const gun = this.gun;
    if (originOverride) {
      _muzzle.copy(originOverride);
    } else if (gun) {
      gun.muzzle(_muzzle);
    } else {
      _muzzle.copy(this._turretMuzzle);
    }

    if (dirOverride) {
      _dir.copy(dirOverride).normalize();
    } else {
      const cp = Math.cos(this._pitch);
      _bore.set(-Math.sin(this._yaw) * cp, Math.sin(this._pitch), -Math.cos(this._yaw) * cp);
      randomInCone(_bore, DESERT_CONVOY_CONSTANTS.turretSpread, _dir);
    }

    const mesh = buildMk19GrenadeMesh();
    const pos = _muzzle.clone();
    const vel = _dir.clone().multiplyScalar(DESERT_CONVOY_CONSTANTS.grenadeSpeed);
    mesh.position.copy(pos);
    mesh.lookAt(pos.x + _dir.x, pos.y + _dir.y, pos.z + _dir.z);
    this.ctx.render.scene.add(mesh);

    this._projectiles.push({
      id: this.nextProjectileId++,
      mesh,
      position: pos,
      velocity: vel,
      age: 0,
      maxAge: 3.4,
      smokeTimer: 0,
    });

    // Visuals, brass 40mm casing ejection, heavy recoil & punchy 40mm AGL THUMP audio
    this.shotsFired++;

    this.ctx.fx?.muzzleFlash?.(_muzzle, _dir, 'autocannon');
    if (gun) {
      _casing.set(-_dir.z, rand(1.1, 2.0), _dir.x).multiplyScalar(1.65);
      this.ctx.fx?.shellCasing?.(gun.root.position, _casing, 'cannon');
    }
    gun?.recoil(0.085);
    this.ctx.audio?.play?.('mgl_shot', { position: _muzzle, volume: 0.92, pitch: 0.92, pitchJitter: 0.05 });
    this.ctx.audio?.play?.('autocannon_fire', { position: _muzzle, volume: 0.34, pitch: 0.72, pitchJitter: 0.04 });
    if (this.shotsFired % 2 === 0) {
      this.ctx.audio?.play?.('reload_bolt', { position: _muzzle, volume: 0.28, pitch: 1.28, pitchJitter: 0.06 });
    }
    this.ctx.camera?.kick?.(rand(0.005, 0.011), rand(-0.005, 0.005));
    this.ctx.camera?.addTrauma?.(0.055);

    return true;
  }

  private updateProjectiles(dt: number): void {
    const gravity = DESERT_CONVOY_CONSTANTS.grenadeGravity;

    for (let i = this._projectiles.length - 1; i >= 0; i--) {
      const p = this._projectiles[i]!;
      p.age += dt;
      _segPrev.copy(p.position);
      p.velocity.y -= gravity * dt;
      _segNext.copy(p.position).addScaledVector(p.velocity, dt);
      _segDir.subVectors(_segNext, _segPrev);
      const segLen = _segDir.length();
      if (segLen > 1e-5) {
        _segDir.divideScalar(segLen);
      } else {
        _segDir.set(0, -1, 0);
      }

      let bestDist = segLen;
      let hitBandit: BanditVehicle | null = null;
      let hitZone: BanditHitZone | null = null;
      let hitEnemy: EnemyInstance | null = null;
      let hitCollider: RAPIER.Collider | null = null;
      let hitWorld = false;
      let hitGround = false;
      _hitNorm.copy(UP);

      // 1. World solid surfaces (ignore our own bandit static colliders so OBB hitboxes resolve riders/gunners)
      if (segLen > 1e-5) {
        const worldHit = this.ctx.physics?.raycast?.(_segPrev, _segDir, segLen, CG.World) ?? null;
        const isBanditCol =
          worldHit?.collider != null && this.banditByCollider.has(worldHit.collider.handle);
        if (worldHit && !isBanditCol && worldHit.distance <= bestDist) {
          bestDist = worldHit.distance;
          hitWorld = true;
          hitCollider = worldHit.collider ?? null;
          _hitNorm.copy(worldHit.normal);
        }
      }

      // 2. Saltblood bandit vehicle locational OBB hitboxes
      for (let bIdx = 0; bIdx < this._bandits.length; bIdx++) {
        const bv = this._bandits[bIdx]!;
        if (!bv.alive) continue;
        _invQ.copy(bv.root.quaternion).invert();
        _localOrigin.copy(_segPrev).sub(bv.position).applyQuaternion(_invQ);
        _localDir.copy(_segDir).applyQuaternion(_invQ);

        for (let zIdx = 0; zIdx < bv.zones.length; zIdx++) {
          const z = bv.zones[zIdx]!;
          if (z.destroyed && z.kind !== 'chassis') continue;
          const d = rayLocalBoxDist(_localOrigin, _localDir, z.offset, z.halfExtents, bestDist);
          if (d >= 0 && d <= bestDist) {
            bestDist = d;
            hitBandit = bv;
            hitZone = z;
            hitEnemy = null;
            hitCollider = null;
            hitWorld = false;
            _hitNorm.copy(_segDir).negate();
          }
        }
      }

      // 3. Living human Saltblood enemies (generous 0.85m envelope for satisfying direct impacts on wall/towers)
      const aliveEnemies = this.ctx.enemies?.alive;
      if (aliveEnemies) {
        for (let eIdx = 0; eIdx < aliveEnemies.length; eIdx++) {
          const e = aliveEnemies[eIdx]!;
          if (!e.alive) continue;
          _tmp.subVectors(e.center, _segPrev);
          const projT = _tmp.dot(_segDir);
          if (projT < -0.6 || projT > bestDist + 0.6) continue;
          const clampedT = clamp(projT, 0, bestDist);
          _tmp2.copy(_segPrev).addScaledVector(_segDir, clampedT);
          if (_tmp2.distanceToSquared(e.center) <= 0.85 * 0.85) {
            bestDist = clampedT;
            hitEnemy = e;
            hitBandit = null;
            hitZone = null;
            hitCollider = null;
            hitWorld = false;
            _hitNorm.copy(_segDir).negate();
          }
        }
      }

      // 4. Desert floor fallback plane (y <= 0.05)
      if (!hitBandit && !hitEnemy && !hitWorld && _segNext.y <= 0.05) {
        if (_segPrev.y > 0.05) {
          const frac = clamp((_segPrev.y - 0.05) / Math.max(1e-5, _segPrev.y - _segNext.y), 0, 1);
          bestDist = segLen * frac;
        } else {
          bestDist = 0;
        }
        hitGround = true;
        _hitNorm.copy(UP);
      }

      if (hitBandit || hitEnemy || hitWorld || hitGround || p.age >= p.maxAge) {
        _hitPt.copy(_segPrev).addScaledVector(_segDir, bestDist);
        if (segLen > 0.25) {
          this.ctx.fx?.tracer?.(_segPrev, _hitPt, 'heavy');
        }
        p.mesh.removeFromParent();
        this._projectiles.splice(i, 1);
        this.detonateGrenade(_hitPt, _hitNorm, hitBandit, hitZone, hitEnemy, hitCollider);
        continue;
      }

      // Advance in-flight grenade with visible amber-gold tracer arc & light smoke wisp
      p.position.copy(_segNext);
      p.mesh.position.copy(p.position);
      p.mesh.lookAt(
        p.position.x + p.velocity.x,
        p.position.y + p.velocity.y,
        p.position.z + p.velocity.z,
      );
      if (segLen > 0.2) {
        this.ctx.fx?.tracer?.(_segPrev, _segNext, 'heavy');
      }
      p.smokeTimer -= dt;
      if (p.smokeTimer <= 0) {
        p.smokeTimer = 0.045;
        this.ctx.fx?.smoke?.(p.position, 0xd8cdb8, 0.34, 0.38);
      }
    }
  }

  private detonateGrenade(
    pos: THREE.Vector3,
    normal: THREE.Vector3,
    hitBandit: BanditVehicle | null,
    hitZone: BanditHitZone | null,
    hitEnemy: EnemyInstance | null,
    hitCollider: RAPIER.Collider | null,
  ): void {
    const blastRadius = DESERT_CONVOY_CONSTANTS.grenadeBlastRadius;
    const blastDamage = DESERT_CONVOY_CONSTANTS.turretDamage;
    const structDamage = DESERT_CONVOY_CONSTANTS.grenadeStructDamage;
    const structRadius = DESERT_CONVOY_CONSTANTS.grenadeStructRadius;

    // 1. Direct bandit vehicle hit (skip same vehicle during radial splash below to avoid double-counting)
    if (hitBandit && hitZone && hitBandit.alive) {
      this.skipBlastBanditId = hitBandit.id;
      this.damageBanditZone(
        hitBandit,
        hitZone,
        DESERT_CONVOY_CONSTANTS.grenadeDirectBanditDamage,
        pos,
        'mgl',
      );
      if (this._phase === 'wallLoop') {
        this.recordWallLoopHit(2);
      }
    }

    // 2. Direct human enemy hit — punchy immediate gore burst before radial blast finishes pasting them
    if (hitEnemy && hitEnemy.alive) {
      this.ctx.fx?.gibBurst?.(pos, normal, 18);
      this.ctx.fx?.bloodMist?.(pos, 1.35);
      this.ctx.audio?.play?.('gore_splat', { position: pos, volume: 0.78, pitchJitter: 0.1 });
      if (this._phase === 'wallLoop') {
        this.recordWallLoopHit(3);
      }
    }

    // 3. Radial 40mm HEDP blast via CombatSystem (`source: 'mgl'`, `kind: 'grenade'`, 210 dmg, 4.8m radius)
    //    `worldObject: true` lets Combat.explode resolve full enemy gore/paste, vehicle splash & impulses
    //    while we emit crisp 40mm FX/audio and exact controlled structural damage below.
    const explodeSpec: ExplosionSpec = {
      radius: blastRadius,
      damage: blastDamage,
      kind: 'grenade',
      source: 'mgl',
      team: 'player',
      selfDamage: 0,
      playerPush: 0,
      normal: normal.clone(),
      scale: 0.95,
      worldObject: true,
    };
    if (typeof this.ctx.combat?.explode === 'function') {
      this.ctx.combat.explode(pos, explodeSpec);
    } else {
      // Fallback for minimal mock environments without full CombatSystem.explode
      if (this.ctx.enemies?.alive) {
        for (const e of [...this.ctx.enemies.alive]) {
          if (!e.alive) continue;
          const d = e.center.distanceTo(pos);
          if (d > blastRadius) continue;
          const falloff = 1 - (d / blastRadius) * 0.65;
          this.ctx.enemies.applyDamage?.(e, {
            amount: blastDamage * falloff,
            type: 'explosive',
            source: 'mgl',
            point: e.center.clone(),
            dir: _tmp2.subVectors(e.center, pos).normalize().clone(),
            force: 24,
            gib: true,
          });
        }
      }
      this.blast(pos, explodeSpec);
    }
    this.skipBlastBanditId = -1;

    // 4. Crisp 40mm detonation FX, sparks, dust plume & grenade_explode audio
    this.ctx.fx?.explosion?.(pos, { radius: blastRadius, kind: 'grenade', scale: 0.95, normal });
    this.ctx.fx?.sparks?.(pos, normal, 11, 0xffc854);
    this.ctx.fx?.dust?.(pos, normal, 1.45);
    this.ctx.fx?.smoke?.(pos, 0x3b352d, 1.15, 0.95);
    this.ctx.render?.lights?.flash?.(pos, 0xff9830, 18, 22, 0.22);
    this.ctx.audio?.play?.('grenade_explode', { position: pos, volume: 0.78, pitch: 1.06, pitchJitter: 0.08 });
    this.ctx.camera?.addTrauma?.(0.08);

    // 5. Controlled localized structural damage (`source: 'mgl'`, 95 dmg in 3.4m) so walls dent/punch
    //    through in 2-3 hits and watchtowers topple in 2-3 thumps, plus direct fuel barrel detonations
    if (hitCollider) {
      this.ctx.world?.objects?.damageExplosive?.(hitCollider, structDamage, 'mgl');
      this.ctx.world?.objects?.destruction?.damageCollider?.(
        hitCollider,
        Math.round(structDamage * 0.45),
        'mgl',
        pos,
      );
    }
    if (typeof this.ctx.world?.objects?.damageExplosivesInRadius === 'function') {
      this.ctx.world.objects.damageExplosivesInRadius(pos, structRadius, structDamage, 'mgl');
    } else {
      this.ctx.world?.objects?.destruction?.blast?.(pos, structRadius, structDamage, 'mgl');
    }

    if (this._phase === 'wallLoop' && Math.abs(pos.z - DESERT_Z.wallLine) <= 16) {
      this.recordWallLoopHit(2);
    }
  }

  private clearProjectiles(): void {
    for (const p of this._projectiles) {
      p.mesh.removeFromParent();
    }
    this._projectiles.length = 0;
  }

  /** Spawns a single Saltblood bandit vehicle (2-up moto, 2-up quad, or colored technical). */
  spawnBanditVehicle(
    kind: BanditVehicleKind,
    pos: THREE.Vector3,
    yaw = Math.PI,
    behavior: BanditBehavior = 'approach',
  ): BanditVehicle {
    this.ensureBuilt();
    const id = this.nextBanditId++;

    const vis = buildBanditVehicleVisual(this.materials, kind, id - 1);
    const { root, body, wheels, gunnerPivot, driverRider, gunnerRider, liveryColor } = vis;
    let maxHp: number;
    let zones: BanditHitZone[];
    let halfExtents: THREE.Vector3;

    if (kind === 'bike') {
      maxHp = DESERT_CONVOY_CONSTANTS.bikeMaxHp;
      zones = [
        {
          id: 'rider',
          kind: 'rider',
          offset: new THREE.Vector3(0, 1.25, -0.18),
          halfExtents: new THREE.Vector3(0.58, 0.62, 0.56),
          hp: 45,
          maxHp: 45,
          destroyed: false,
        },
        {
          id: 'gunner',
          kind: 'gunner',
          offset: new THREE.Vector3(0, 1.38, 0.62),
          halfExtents: new THREE.Vector3(0.58, 0.65, 0.56),
          hp: 45,
          maxHp: 45,
          destroyed: false,
        },
        {
          id: 'chassis',
          kind: 'chassis',
          offset: new THREE.Vector3(0, 0.72, 0),
          halfExtents: new THREE.Vector3(0.85, 0.75, 1.38),
          hp: maxHp,
          maxHp,
          destroyed: false,
        },
      ];
      halfExtents = new THREE.Vector3(0.75, 0.8, 1.25);
    } else if (kind === 'quad') {
      maxHp = DESERT_CONVOY_CONSTANTS.quadMaxHp;
      zones = [
        {
          id: 'rider',
          kind: 'rider',
          offset: new THREE.Vector3(0, 1.28, -0.18),
          halfExtents: new THREE.Vector3(0.64, 0.62, 0.58),
          hp: 55,
          maxHp: 55,
          destroyed: false,
        },
        {
          id: 'gunner',
          kind: 'gunner',
          offset: new THREE.Vector3(0, 1.44, 0.64),
          halfExtents: new THREE.Vector3(0.64, 0.68, 0.58),
          hp: 55,
          maxHp: 55,
          destroyed: false,
        },
        {
          id: 'chassis',
          kind: 'chassis',
          offset: new THREE.Vector3(0, 0.78, 0),
          halfExtents: new THREE.Vector3(1.05, 0.78, 1.48),
          hp: maxHp,
          maxHp,
          destroyed: false,
        },
      ];
      halfExtents = new THREE.Vector3(0.95, 0.85, 1.4);
    } else {
      maxHp = DESERT_CONVOY_CONSTANTS.truckMaxHp;
      zones = [
        {
          id: 'gunner',
          kind: 'gunner',
          offset: new THREE.Vector3(0, 2.05, 0.78),
          halfExtents: new THREE.Vector3(0.76, 0.78, 0.78),
          hp: 85,
          maxHp: 85,
          destroyed: false,
        },
        {
          id: 'engine',
          kind: 'engine',
          offset: new THREE.Vector3(0, 1.15, -1.72),
          halfExtents: new THREE.Vector3(1.06, 0.68, 0.98),
          hp: 130,
          maxHp: 130,
          destroyed: false,
        },
        {
          id: 'tire_fl',
          kind: 'tire',
          offset: new THREE.Vector3(-1.12, 0.52, -1.62),
          halfExtents: new THREE.Vector3(0.48, 0.54, 0.6),
          hp: 65,
          maxHp: 65,
          destroyed: false,
        },
        {
          id: 'tire_fr',
          kind: 'tire',
          offset: new THREE.Vector3(1.12, 0.52, -1.62),
          halfExtents: new THREE.Vector3(0.48, 0.54, 0.6),
          hp: 65,
          maxHp: 65,
          destroyed: false,
        },
        {
          id: 'chassis',
          kind: 'chassis',
          offset: new THREE.Vector3(0, 1.15, 0),
          halfExtents: new THREE.Vector3(1.36, 1.05, 2.68),
          hp: maxHp,
          maxHp,
          destroyed: false,
        },
      ];
      halfExtents = new THREE.Vector3(1.25, 1.0, 2.5);
    }

    const p = pos.clone();
    p.y = 0;
    root.position.copy(p);
    root.rotation.set(0, yaw, 0);
    this.ctx.render.scene.add(root);

    let collider: RAPIER.Collider | null = null;
    if (typeof this.ctx.physics?.addStaticBox === 'function') {
      _q.setFromAxisAngle(UP, yaw);
      collider = this.ctx.physics.addStaticBox(
        _tmp.set(p.x, halfExtents.y, p.z),
        halfExtents,
        _q,
        'metal',
      );
    }

    const bv: BanditVehicle = {
      id,
      kind,
      behavior,
      root,
      body,
      wheels,
      gunnerPivot,
      driverRider,
      gunnerRider,
      liveryColor,
      position: p,
      velocity: new THREE.Vector3(),
      center: new THREE.Vector3(p.x, kind === 'truck' ? 1.25 : 0.95, p.z),
      yaw,
      roll: 0,
      pitch: 0,
      speed: kind === 'bike' ? 19 : kind === 'quad' ? 17 : 14,
      hp: maxHp,
      maxHp,
      alive: true,
      gunnerAlive: true,
      zones,
      collider,
      weavePhase: rand(0, Math.PI * 2),
      weaveAmp: kind === 'bike' ? rand(5, 10) : kind === 'quad' ? rand(4, 7.5) : rand(2, 4.5),
      weaveFreq: kind === 'bike' ? rand(1.4, 2.2) : kind === 'quad' ? rand(1.05, 1.65) : rand(0.65, 1.05),
      preferredSide: Math.random() < 0.5 ? -1 : 1,
      preferredLead: behavior === 'exfil' ? rand(-18, -9) : rand(16, 34),
      fireCooldown: rand(0.9, 1.8),
      smokeTimer: 0,
      dustTimer: rand(0, 0.12),
      age: 0,
    };

    if (collider) {
      this.banditByCollider.set(collider.handle, bv);
    }
    this._bandits.push(bv);
    return bv;
  }

  /** Applies locational zone damage to a Saltblood bike, quad, or technical. Returns true if destroyed. */
  damageBanditZone(
    bv: BanditVehicle,
    zone: BanditHitZone,
    amount: number,
    hitPt?: THREE.Vector3,
    source = 'mgl',
  ): boolean {
    if (!bv.alive || amount <= 0) return false;
    const pt = hitPt ?? bv.center;

    zone.hp = Math.max(0, zone.hp - amount);
    const hullMult =
      zone.kind === 'chassis'
        ? 1
        : zone.kind === 'rider'
          ? 1.7
          : zone.kind === 'engine'
            ? 1.4
            : zone.kind === 'gunner' && bv.kind !== 'truck'
              ? 0.45
              : 0.85;
    bv.hp = Math.max(0, bv.hp - amount * hullMult);

    const isWeak = zone.kind !== 'chassis';
    const isCrew = zone.kind === 'rider' || zone.kind === 'gunner';
    if (isCrew) {
      this.ctx.fx?.bloodHit?.(pt, UP, 1.0);
    }
    this.ctx.fx?.sparks?.(pt, UP, isWeak ? 12 : 6, isWeak ? 0xffbb33 : 0xffaa55);
    this.ctx.fx?.chips?.(pt, 0xff9a38, isWeak ? 8 : 5);
    this.ctx.hud?.hitMarker?.(bv.hp <= 0 || zone.hp <= 0 ? 'kill' : isWeak ? 'armorThrough' : 'armor');
    this.ctx.audio?.play?.(isWeak ? 'vehicle_weak_point' : 'hit_marker_armor', { position: pt, volume: 0.72 });
    if (!isCrew) {
      this.ctx.audio?.play?.(amount >= 30 || isWeak ? 'veh_hit_heavy' : 'veh_hit_light', {
        position: pt,
        volume: 0.7,
        pitchJitter: 0.1,
      });
    }

    if (zone.hp <= 0 && !zone.destroyed) {
      zone.destroyed = true;
      if (zone.kind === 'rider') {
        if (bv.driverRider) bv.driverRider.root.visible = false;
        this.ctx.fx?.gibBurst?.(pt, UP, 20);
        this.ctx.fx?.bloodMist?.(pt, 1.4);
        this.ctx.audio?.play?.('gore_splat', { position: pt, volume: 0.82, pitchJitter: 0.1 });
        this.ctx.audio?.play?.('gib_rain', { position: pt, volume: 0.62 });
        this.destroyBandit(bv, 'rider_flip', source);
        return true;
      }
      if (zone.kind === 'engine') {
        this.destroyBandit(bv, 'engine_blast', source);
        return true;
      }
      if (zone.kind === 'gunner') {
        bv.gunnerAlive = false;
        if (bv.gunnerRider) bv.gunnerRider.root.visible = false;
        if (bv.kind === 'truck' && bv.gunnerPivot) bv.gunnerPivot.visible = false;
        this.ctx.fx?.gibBurst?.(pt, UP, 18);
        this.ctx.fx?.bloodMist?.(pt, 1.3);
        this.ctx.audio?.play?.('gore_splat', { position: pt, volume: 0.8, pitchJitter: 0.1 });
        this.ctx.hud?.feed?.(
          bv.kind === 'truck' ? 'TECHNICAL GUNNER OBLITERATED!' : 'REAR GUNNER DOWN!',
          '#ffcf6e',
        );
      } else if (zone.kind === 'tire') {
        this.ctx.audio?.play?.('plate_destroyed', { position: pt, volume: 0.8 });
        bv.speed *= 0.72;
      }
    }

    if (bv.hp <= 0) {
      this.destroyBandit(
        bv,
        bv.kind === 'bike' ? 'bike_flip' : bv.kind === 'quad' ? 'quad_blast' : 'truck_blast',
        source,
      );
      return true;
    }
    return false;
  }

  /** Applies generic hull damage (from on-foot weapons, rockets, grenades) to a bandit vehicle. */
  damageBandit(bv: BanditVehicle, amount: number, source = 'weapon', hitPt?: THREE.Vector3): boolean {
    const chassis = bv.zones.find(z => z.kind === 'chassis') ?? bv.zones[0]!;
    return this.damageBanditZone(bv, chassis, amount, hitPt, source);
  }

  // -----------------------------------------------------------------------------------------------
  // Build & Registration
  // -----------------------------------------------------------------------------------------------

  private ensureBuilt(): void {
    if (this.built) return;
    this.built = true;

    const specs: readonly { role: 'lead' | 'player' | 'rear'; offset: readonly [number, number, number] }[] = [
      { role: 'lead', offset: DESERT_CONVOY_CONSTANTS.leadOffset },
      { role: 'player', offset: [0, 0, 0] },
      { role: 'rear', offset: DESERT_CONVOY_CONSTANTS.rearOffset },
    ];

    for (const spec of specs) {
      const vis = buildRaidTruckVisual(this.materials, spec.role);
      this.root.add(vis.root);
      const truck: RaidTruck = {
        role: spec.role,
        root: vis.root,
        body: vis.body,
        wheels: vis.wheels,
        antenna: vis.antenna,
        headlights: vis.headlights,
        allyTurret: vis.allyTurret,
        allyMuzzleOffset: new THREE.Vector3(0, 0.04, -1.4),
        quistMesh: vis.quistMesh,
        position: new THREE.Vector3(spec.offset[0], 0, CONVOY_PATHS.approach[0]![2] + spec.offset[2]),
        offset: spec.offset,
        yaw: 0,
        roll: 0,
        pitch: 0,
        speed: 0,
        bumpPhase: rand(0, Math.PI * 2),
        dustTimer: rand(0, 0.14),
        allyFireCooldown: rand(0.4, 1.0),
      };
      this._trucks.push(truck);
      if (spec.role === 'player') this.playerTruck = truck;
    }

    this.ctx.render.scene.add(this.root);

    // Player's real Jackal combination M2-X50 .50-cal HMG + 40mm Smart-AGL turret (top holo sight removed)
    this.gun = new Gun(this.materials, this.ctx.render.scene, HYBRID_HMG_AGL);

    this.hud = createConvoyHud();
  }

  private ensureRegistered(): void {
    const vs = (this.ctx.enemies as { vehicles?: VehicleSystem | null } | undefined)?.vehicles ?? null;
    if (!vs || vs === this.registeredOn) return;
    this.registeredOn?.removeExtra(this);
    vs.addExtra(this);
    this.registeredOn = vs;
  }

  private setQuistVisible(visible: boolean): void {
    if (this.playerTruck?.quistMesh) {
      this.playerTruck.quistMesh.visible = visible;
    }
  }

  private hideHud(): void {
    this.hud?.root.classList.remove('on');
  }

  private clearBoardingHint(): void {
    const ui = this.ui as (CampaignHud & { clearHint?: () => void }) | undefined;
    if (typeof ui?.clearHint === 'function') {
      ui.clearHint();
    } else if (ui) {
      ui.hint?.('', 0.01);
      ui.el?.querySelector?.('.ms-hint')?.classList.remove('on');
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Turret Mount / Dismount
  // -----------------------------------------------------------------------------------------------

  private mountTurret(initialYaw: number, initialPitch: number): void {
    if (this._mounted) return;
    this._mounted = true;
    this._yaw = wrapAngle(initialYaw);
    this._pitch = clamp(initialPitch, DESERT_CONVOY_CONSTANTS.pitchMin, DESERT_CONVOY_CONSTANTS.pitchMax);
    this._zoomed = false;
    this._camFov = DESERT_CONVOY_CONSTANTS.turretFov;
    this._weaponMode = 'hmg';
    this.rHeld = -1;

    const { camera, player, weapons, audio } = this.ctx;
    weapons?.setHolstered?.(true);
    const truckPos = this.getTruckPosition(_tmp);
    player.park(truckPos, true);
    player.interceptor = (dmg: PlayerDamage): boolean => {
      this.damageConvoyHull(dmg.amount, dmg.from, dmg.source);
      return true;
    };

    camera.setSeat(this.seatView);
    camera.setZoom(this._camFov);

    this.gun?.snap(this._yaw, this._pitch);
    this.gun?.setActive(1, 0);
    this.syncTurretTransforms(0);

    audio?.play?.('weapon_draw_heavy', { volume: 0.78 });
    this.hud?.root.classList.add('on');
  }

  private dismountTurret(lethal: boolean, keepGunStowed: boolean): void {
    if (!this._mounted) {
      if (!keepGunStowed) {
        this.gun?.hide();
      }
      return;
    }
    this._mounted = false;
    this._zoomed = false;
    this._camFov = DESERT_CONVOY_CONSTANTS.turretFov;
    this._weaponMode = 'hmg';
    if (this.rHeld >= 0) {
      this.rHeld = -1;
      this.ctx.hud?.hold?.(0);
    }

    const { camera, player, weapons } = this.ctx;
    player.interceptor = null;
    camera.setSeat(null);
    camera.setZoom(null);
    player.unpark(lethal ? 0 : 0.5);
    weapons?.setHolstered?.(false);

    if (!keepGunStowed) {
      this.gun?.hide();
    }
    this.hideHud();
  }

  private stowGunOnParkedTruck(): void {
    if (!this.playerTruck) return;
    this._yaw = this.playerTruck.yaw;
    this._pitch = -0.1;
    this.gun?.snap(this._yaw, this._pitch);
    this.syncTurretTransforms(0);
  }

  private startEngineLoop(pitch: number): void {
    if (this.engineLoop) {
      this.engineLoop.setPitch(pitch, 0.25);
      return;
    }
    this.engineLoop =
      this.ctx.audio?.startLoop?.('truck_engine_loop', { volume: 0.38, pitch, fadeIn: 0.35 }) ?? null;
  }

  private stopEngineLoop(): void {
    if (!this.engineLoop) return;
    this.engineLoop.stop(0.25);
    this.engineLoop = null;
  }

  private clearExfilPrompt(): void {
    if (this.exfilPromptUnfollow) {
      this.exfilPromptUnfollow();
      this.exfilPromptUnfollow = null;
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Per-Phase Convoy Spline Updates
  // -----------------------------------------------------------------------------------------------

  private updateApproach(dt: number): void {
    const speed = DESERT_CONVOY_CONSTANTS.approachSpeed;
    this.pathDist = Math.min(this.approachPath.length, this.pathDist + speed * dt);
    this.approachPath.sample(this.pathDist, _tmp, _tan);
    const yaw = Math.atan2(-_tan.x, -_tan.z);

    const reachedEnd = this.pathDist >= this.approachPath.length - 0.25 || _tmp.z <= 84.5;
    this.currentSpeed = reachedEnd ? 0 : speed;
    this.placeConvoy(_tmp, yaw, 1, dt, false);

    if (reachedEnd && !this.approachDoneSignalled) {
      this.approachDoneSignalled = true;
      this.runner?.signal?.('dr:approach_done');
    }
  }

  private updateWallLoop(dt: number): void {
    const speed = DESERT_CONVOY_CONSTANTS.wallLoopSpeed;
    this.currentSpeed = speed;
    const prevDist = this.pathDist;
    this.pathDist += speed * dt;
    if (this.pathDist >= this.wallLoopPath.length) {
      this.pathDist -= this.wallLoopPath.length;
      if (prevDist < this.wallLoopPath.length) {
        this._wallLoopPasses++;
        this.checkWallLoopReady();
      }
    }

    this.wallLoopPath.sample(this.pathDist, _tmp, _tan);
    const yaw = Math.atan2(-_tan.x, -_tan.z);
    this.placeConvoy(_tmp, yaw, 0.9, dt, false, DESERT_Z.wallLine + 9);
  }

  private recordWallLoopHit(weight: number): void {
    this._wallLoopHitScore += weight;
    this.checkWallLoopReady();
  }

  private checkWallLoopReady(): void {
    if (this.wallLoopReadySignalled || this._phase !== 'wallLoop') return;
    if (this._wallLoopPasses >= 1 || this._wallLoopHitScore >= DESERT_CONVOY_CONSTANTS.wallLoopReadyHits) {
      this.wallLoopReadySignalled = true;
      this.runner?.signal?.('dr:wall_loop_ready');
    }
  }

  private updateExfilArriving(dt: number): void {
    this.exfilArriveElapsed += dt;
    const t = clamp(this.exfilArriveElapsed / this.exfilArriveDuration, 0, 1);
    // Ease-out sweep in from the eastern bypass into the Plane forecourt, swinging South (Math.PI)
    const ease = 1 - (1 - t) * (1 - t);
    _tmp.lerpVectors(this.exfilArriveStart, this.exfilTargetPos, ease);
    const yaw = lerp(0.96, Math.PI, clamp((t - 0.35) / 0.65, 0, 1));
    this.currentSpeed = (1 - t) * DESERT_CONVOY_CONSTANTS.exfilArriveSpeed;
    this.placeConvoy(_tmp, yaw, 0.65, dt, false);
    this.stowGunOnParkedTruck();

    if (t >= 1) {
      this._phase = 'exfilWaiting';
      this.currentSpeed = 0;
      this.startEngineLoop(0.85);
      this.exfilPromptPos.set(this.exfilTargetPos.x, 3.1, this.exfilTargetPos.z);
      const key = this.ctx.input?.labelFor?.('interact') ?? 'E';
      this.exfilPromptUnfollow =
        this.ctx.hud?.follow?.(this.exfilPromptPos, `[${key}] BOARD EXFIL TRUCK`, '#ffcf6e') ?? null;
      this.ui?.hint?.('Press {interact} or walk to the truck to board!', 5);
    }
  }

  private updateExfilWaiting(dt: number): void {
    this.exfilPulseClock += dt;
    this.currentSpeed = 0;

    // Pulse headlights brightly so the exfil truck is unmistakable through smoke & dust
    const pulse = 0.8 + Math.sin(this.exfilPulseClock * 8) * 0.25;
    for (const t of this._trucks) {
      if (t.headlights) t.headlights.scale.setScalar(pulse);
    }

    const pPos = this.ctx.player?.position;
    if (!pPos || !this.playerTruck) return;

    const dist = Math.hypot(
      pPos.x - this.playerTruck.position.x,
      pPos.z - this.playerTruck.position.z,
    );
    const pressedInteract = this.ctx.input?.pressed?.('interact') ?? false;
    const shouldBoard =
      dist <= DESERT_CONVOY_CONSTANTS.exfilAutoBoardRadius ||
      (dist <= DESERT_CONVOY_CONSTANTS.exfilPromptRadius && pressedInteract);

    if (shouldBoard && !this.exfilBoardedSignalled) {
      this.exfilBoardedSignalled = true;
      this.clearExfilPrompt();
      this.clearBoardingHint();
      for (const t of this._trucks) {
        if (t.headlights) t.headlights.scale.setScalar(1);
      }
      this.mountTurret(0, 0);
      this.ctx.audio?.play?.('pickup_armor', { volume: 0.72 });
      this.runner?.signal?.('dr:exfil_boarded');
    }
  }

  private updateExfilChase(dt: number): void {
    const speed = DESERT_CONVOY_CONSTANTS.exfilSpeed;
    this.pathDist += speed * dt;

    if (this.pathDist <= this.exfilPath.length) {
      this.exfilPath.sample(this.pathDist, _tmp, _tan);
    } else {
      // Smoothly cruise south after path end, capped cleanly at endingCruiseMaxZ (185)
      this.exfilPath.sample(this.exfilPath.length, _tmp, _tan);
      const extra = this.pathDist - this.exfilPath.length;
      _tmp.z = Math.min(DESERT_CONVOY_CONSTANTS.endingCruiseMaxZ, _tmp.z + extra);
      _tan.set(0, 0, 1);
    }

    const capped = _tmp.z >= DESERT_CONVOY_CONSTANTS.endingCruiseMaxZ - 0.05;
    this.currentSpeed = capped ? 0 : speed;

    const yaw = Math.atan2(-_tan.x, -_tan.z);
    // Tighten lateral formation through the Pump Yard Bypass Gateway (z < 46) and Main Gate (z < 72),
    // then widen back into the full 3-truck desert column on the open dunes.
    const spreadScale = _tmp.z < 46 ? 0.36 : _tmp.z < 72 ? 0.28 : 1.0;
    this.placeConvoy(_tmp, yaw, spreadScale, dt, false);

    // Raise `dr:exfil_clear` once clear of the outer wall (z >= 108)
    if (!this.exfilClearSignalled && _tmp.z >= DESERT_CONVOY_CONSTANTS.exfilClearZ) {
      this.exfilClearSignalled = true;
      this.runner?.signal?.('dr:exfil_clear');
    }

    // Keep pursuing Saltbloods trickling in while racing south along the eastern bypass (until clear)
    if (!this.exfilClearSignalled) {
      this.exfilAutoSpawnTimer -= dt;
      if (this.exfilAutoSpawnTimer <= 0) {
        this.exfilAutoSpawnTimer = 5.5;
        if (this._bandits.length < 3) {
          this.spawnBanditWave('exfil', 2);
        }
      }
    }
  }

  private updateEndingCruise(dt: number): void {
    const pt = this.playerTruck;
    if (!pt) return;
    const maxZ = DESERT_CONVOY_CONSTANTS.endingCruiseMaxZ;
    const remaining = Math.max(0, maxZ - this.endingCruiseZ);
    const speed =
      remaining > 0.05
        ? DESERT_CONVOY_CONSTANTS.endingCruiseSpeed * clamp(remaining / 14, 0.15, 1)
        : 0;
    this.currentSpeed = speed;

    this.endingCruiseZ = Math.min(maxZ, this.endingCruiseZ + speed * dt);
    const nextX = damp(pt.position.x, 0, 2.2, dt);
    _tmp.set(nextX, 0, this.endingCruiseZ);
    this.placeConvoy(_tmp, Math.PI, 1.0, dt, false);

    // Keep stowed HMG+AGL turret synced on the rolling truck & carry parked player without touching camera
    this._yaw = pt.yaw;
    this._pitch = -0.1;
    this.syncTurretTransforms(dt);
    this.ctx.player?.carry?.(pt.position);
  }

  private placeConvoy(
    midPos: THREE.Vector3,
    headingYaw: number,
    offsetScale: number,
    dt: number,
    snap: boolean,
    minFlankerZ = -Infinity,
  ): void {
    const cy = Math.cos(headingYaw);
    const sy = Math.sin(headingYaw);

    for (const t of this._trucks) {
      const ox = t.offset[0] * offsetScale;
      const oz = t.offset[2] * offsetScale;
      const wx = midPos.x + ox * cy + oz * sy;
      const wz = Math.max(minFlankerZ, midPos.z - ox * sy + oz * cy);

      if (snap || dt <= 1e-5) {
        t.position.set(wx, 0, wz);
        t.yaw = headingYaw;
      } else {
        const rate = t.role === 'player' ? 14 : 6.5;
        const prevX = t.position.x;
        const prevZ = t.position.z;
        t.position.x = damp(prevX, wx, rate, dt);
        t.position.z = damp(prevZ, wz, rate, dt);
        const dx = t.position.x - prevX;
        const dz = t.position.z - prevZ;
        const distMoved = Math.hypot(dx, dz);
        t.speed = distMoved / dt;
        const targetYaw = distMoved > 0.02 ? Math.atan2(-dx, -dz) : headingYaw;
        const prevYaw = t.yaw;
        t.yaw = dampAngle(t.yaw, targetYaw, 6.5, dt);
        const yawRate = wrapAngle(t.yaw - prevYaw) / dt;
        t.roll = damp(t.roll, clamp(-yawRate * 0.08, -0.09, 0.09), 7, dt);
      }
      if (snap) {
        t.speed = this.currentSpeed;
        t.roll = 0;
      }
    }

    if (this._mounted && this.playerTruck) {
      this.ctx.player?.carry?.(this.playerTruck.position);
    }
  }

  private updateTruckVisuals(dt: number): void {
    for (const t of this._trucks) {
      const spd = t.speed;
      // Dune suspension bounce scaled by actual motion speed
      t.bumpPhase += Math.max(0.6, spd * 0.55) * dt * 2.4;
      const duneBounce = spd > 0.4 ? Math.sin(t.bumpPhase) * 0.075 + Math.sin(t.bumpPhase * 2.7) * 0.025 : 0;
      const targetPitch = spd > 0.4 ? Math.cos(t.bumpPhase) * 0.028 : 0;
      t.pitch = damp(t.pitch, targetPitch, 8, dt);

      t.root.position.set(t.position.x, duneBounce, t.position.z);
      t.root.rotation.set(0, t.yaw, 0);
      t.body.rotation.set(t.pitch, 0, t.roll);

      // Sway whip antenna realistically with speed & bounce
      t.antenna.rotation.x = clamp(spd * 0.024 + Math.sin(t.bumpPhase * 1.9) * 0.08, -0.25, 0.55);
      t.antenna.rotation.z = t.roll * 1.8 + Math.cos(t.bumpPhase * 1.4) * 0.06;

      // Spin all 4 wheels forward (positive rotation.x inside Math.PI-rotated real Jackal holder)
      const wSpin = (spd / 0.54) * dt;
      for (let i = 0; i < t.wheels.length; i++) {
        t.wheels[i]!.rotation.x += wSpin;
      }

      // Let moving Jackal technicals smash straight through wooden shacks & Tier-0 destructible structures!
      if (spd > 5.0) {
        this.smashWeakDestructibles(t, spd);
      }

      // Continuous trailing sand dust plumes while moving across dunes
      if (spd > 1.5) {
        t.dustTimer -= dt;
        if (t.dustTimer <= 0) {
          t.dustTimer = clamp(0.22 - spd * 0.007, 0.09, 0.22);
          const cy = Math.cos(t.yaw);
          const sy = Math.sin(t.yaw);
          // Rear left & right tires in world space (local z = +1.8, x = ±1.1)
          for (const sx of [-1.05, 1.05]) {
            const wx = t.position.x + sx * cy + 1.95 * sy;
            const wz = t.position.z - sx * sy + 1.95 * cy;
            _tmp.set(wx, 0.18, wz);
            this.ctx.fx?.dust?.(_tmp, UP, clamp(spd / 10, 0.8, 1.8));
          }
          _tmp.set(t.position.x + 2.4 * sy, 0.45, t.position.z + 2.4 * cy);
          this.ctx.fx?.smoke?.(_tmp, 0xc9a97c, clamp(spd * 0.12, 0.9, 1.9), 1.0);
        }
      }
    }
  }

  /**
   * Checks 3 bumper-width rays ahead of a rolling Jackal technical so it smashes cleanly through
   * wooden shacks, timber frames, fences, and other weak Tier-0 destructibles along the convoy path.
   */
  private smashWeakDestructibles(t: RaidTruck, speed: number): void {
    const objects = this.ctx.world?.objects;
    const physics = this.ctx.physics;
    if (typeof objects?.tryVehicleRam !== 'function' || typeof physics?.raycast !== 'function') return;

    const sy = Math.sin(t.yaw);
    const cy = Math.cos(t.yaw);
    // Convoy forward vector in -Z convention: (-sin(yaw), 0, -cos(yaw)); right vector: (cos(yaw), 0, -sin(yaw))
    _dir.set(-sy, 0, -cy);
    const ramSpeed = Math.max(12, speed);

    for (const lat of [-1.0, 0, 1.0]) {
      _tmp.set(t.position.x + lat * cy, 1.05, t.position.z - lat * sy);
      const hit = physics.raycast(_tmp, _dir, 3.4, CG.World);
      if (!hit || !hit.collider) continue;
      if (this.banditByCollider.has(hit.collider.handle)) continue;
      if (Math.abs(hit.normal.y) >= 0.6) continue;

      const res = objects.tryVehicleRam(hit.collider, 'medium', ramSpeed, hit.point, _dir);
      if (res.breached) {
        this.ctx.fx?.dust?.(hit.point, UP, 1.45);
        this.ctx.fx?.sparks?.(hit.point, UP, 8, 0xd8a86a);
        const isMountedPlayerTruck = t.role === 'player' && this._mounted;
        this.ctx.audio?.play?.('veh_hit_light', {
          position: isMountedPlayerTruck ? undefined : hit.point,
          volume: isMountedPlayerTruck ? 0.68 : 0.56,
          pitch: 1.04,
          pitchJitter: 0.08,
        });
        if (isMountedPlayerTruck) {
          this.ctx.camera?.addTrauma?.(0.08);
        }
      }
    }
  }

  private syncTruckObject(t: RaidTruck): void {
    t.root.position.copy(t.position);
    t.root.rotation.set(0, t.yaw, 0);
    t.body.rotation.set(t.pitch, 0, t.roll);
  }

  // -----------------------------------------------------------------------------------------------
  // Flank Truck Ally Gunners (epic tracers + flashes, low damage so player owns the kills!)
  // -----------------------------------------------------------------------------------------------

  private updateAllyGunners(dt: number): void {
    for (const t of this._trucks) {
      if (!t.allyTurret) continue;

      // Find nearest living bandit vehicle within 95 m, else nearest living enemy
      let targetPos: THREE.Vector3 | null = null;
      let targetBandit: BanditVehicle | null = null;
      let bestDist = 95;

      for (const bv of this._bandits) {
        if (!bv.alive) continue;
        const d = bv.position.distanceTo(t.position);
        if (d < bestDist) {
          bestDist = d;
          targetPos = bv.center;
          targetBandit = bv;
        }
      }

      if (!targetPos && this.ctx.enemies?.alive) {
        for (const e of this.ctx.enemies.alive) {
          if (!e.alive) continue;
          const d = e.position.distanceTo(t.position);
          if (d < bestDist) {
            bestDist = d;
            targetPos = e.center;
          }
        }
      }

      if (!targetPos) continue;

      // Aim flanker roof turret smoothly toward target in truck local space
      const dx = targetPos.x - t.position.x;
      const dz = targetPos.z - t.position.z;
      const worldYaw = Math.atan2(-dx, -dz);
      const localYaw = wrapAngle(worldYaw - t.yaw);
      t.allyTurret.rotation.y = dampAngle(t.allyTurret.rotation.y, localYaw, 6, dt);

      t.allyFireCooldown -= dt;
      if (t.allyFireCooldown <= 0) {
        t.allyFireCooldown = rand(0.28, 0.58);
        // Compute world muzzle position of ally roof turret (Jackal turret ring at local z = +0.78)
        const cy = Math.cos(t.yaw);
        const sy = Math.sin(t.yaw);
        const turretWorldX = t.position.x + 0.78 * sy;
        const turretWorldZ = t.position.z + 0.78 * cy;
        _tmp.set(turretWorldX - Math.sin(worldYaw) * 1.15, 2.42, turretWorldZ - Math.cos(worldYaw) * 1.15);
        _tmp2.copy(targetPos);
        _tmp2.x += rand(-0.8, 0.8);
        _tmp2.y += rand(-0.3, 0.5);
        _tmp2.z += rand(-0.8, 0.8);
        _dir.subVectors(_tmp2, _tmp).normalize();

        this.ctx.fx?.tracer?.(_tmp, _tmp2, 'heavy');
        this.ctx.fx?.muzzleFlash?.(_tmp, _dir, 'hmg');
        this.ctx.audio?.play?.('hmg_shot', { position: _tmp, volume: 0.45, pitchJitter: 0.08 });

        // Light chip damage (NEVER steals the killing blow: leaves bandit at >= 15 HP for player!)
        if (targetBandit && targetBandit.alive && targetBandit.hp > 20) {
          targetBandit.hp = Math.max(15, targetBandit.hp - 5);
          this.ctx.fx?.sparks?.(_tmp2, UP, 3, 0xffaa44);
        }
      }
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Player Combination .50-Cal HMG + 40mm Smart-AGL Turret Control
  // LMB fires active weapon, RMB zooms optic, Hold R switches between .50 HMG and 40mm AGL.
  // -----------------------------------------------------------------------------------------------

  private toggleWeaponMode(): void {
    this._weaponMode = this._weaponMode === 'hmg' ? 'agl' : 'hmg';
    const isAgl = this._weaponMode === 'agl';
    this.gun?.setActive(1, isAgl ? 1 : 0);
    this.ctx.audio?.play?.('reload_bolt', { volume: 0.78, pitch: isAgl ? 0.86 : 1.12 });
    this.ctx.hud?.callout?.(isAgl ? '40MM AGL' : '.50 CAL HMG');
    this.ctx.hud?.feed?.(
      isAgl ? 'TURRET MODE: 40MM SMART-AGL GRENADES' : 'TURRET MODE: .50-CAL HMG',
      isAgl ? '#ff9e3b' : '#ffcf6e',
    );
  }

  private updateTurretControl(dt: number): void {
    const { input, player, audio, camera } = this.ctx;

    // RMB (`aim`): optic zoom (scales mouse sensitivity & damps FOV smoothly)
    this._zoomed = input.isDown('aim');
    const targetFov = this._zoomed
      ? DESERT_CONVOY_CONSTANTS.turretZoomFov
      : DESERT_CONVOY_CONSTANTS.turretFov;
    this._camFov = damp(this._camFov, targetFov, 12, dt);
    camera?.setZoom?.(this._camFov);

    // Safe dual-path look input (works with live PlayerSystem AND standalone tests)
    const flX = input.frameLook?.x ?? 0;
    const flY = input.frameLook?.y ?? 0;
    const consumed = input.consumeLook?.();
    const dx = consumed && (consumed.x !== 0 || consumed.y !== 0) ? consumed.x : flX;
    const dy = consumed && (consumed.x !== 0 || consumed.y !== 0) ? consumed.y : flY;

    const sens = (player.sensitivity ?? 0.0022) * (player.lookScale ?? 1) * (this._zoomed ? 0.55 : 1);
    this._yaw = wrapAngle(this._yaw - dx * sens);
    this._pitch = clamp(
      this._pitch - dy * sens * (player.invertY ? -1 : 1),
      DESERT_CONVOY_CONSTANTS.pitchMin,
      DESERT_CONVOY_CONSTANTS.pitchMax,
    );

    this.syncTurretTransforms(dt);

    // Hold R (`reload`): switch between .50-cal HMG and 40mm Smart-AGL grenades
    const reloadDown = input.isDown('reload');
    if (reloadDown) {
      if (this.rHeld === -1) this.rHeld = 0;
      if (this.rHeld >= 0) {
        this.rHeld += dt;
        const holdFrac = clamp(this.rHeld / DESERT_CONVOY_CONSTANTS.holdRSeconds, 0, 1);
        this.ctx.hud?.hold?.(holdFrac);
        if (this.rHeld >= DESERT_CONVOY_CONSTANTS.holdRSeconds) {
          this.rHeld = -2;
          this.ctx.hud?.hold?.(0);
          this.toggleWeaponMode();
        }
      }
    } else {
      if (this.rHeld >= 0) this.ctx.hud?.hold?.(0);
      this.rHeld = -1;
    }

    // LMB (`fire`): fires whichever weapon mode is currently active (.50-cal HMG or 40mm AGL)
    const fireHeld = input.isDown('fire');
    const inHmgMode = this._weaponMode === 'hmg';
    if (inHmgMode && fireHeld && this.heat.overheated && input.pressed('fire')) {
      audio?.play?.('weapon_dry', { volume: 0.7 });
    }

    const shootingHmg = inHmgMode && fireHeld && !this.heat.overheated;
    if (shootingHmg) {
      this.hmgCooldown -= dt;
      let burst = 0;
      while (this.hmgCooldown <= 0 && burst < 4) {
        this.hmgCooldown += 1 / DESERT_CONVOY_CONSTANTS.hmgRps;
        burst++;
        this.fireHmgShot();
        if (this.heat.shot()) {
          audio?.play?.('steam_burst', { position: this._turretMuzzle, volume: 0.85 });
          this.ctx.fx?.smoke?.(this._turretMuzzle, 0xd8dce4, 0.8, 0.95);
          break;
        }
      }
      if (this.hmgCooldown < 0) this.hmgCooldown = 0;
    } else {
      this.hmgCooldown = Math.max(0, this.hmgCooldown - dt);
    }
    this.heat.cool(dt, shootingHmg);

    const shootingAgl = !inHmgMode && fireHeld;
    if (shootingAgl) {
      this.aglCooldown -= dt;
      let burst = 0;
      while (this.aglCooldown <= 0 && burst < 3) {
        this.aglCooldown += 1 / DESERT_CONVOY_CONSTANTS.turretRps;
        burst++;
        this.fireSingleShot();
      }
      if (this.aglCooldown < 0) this.aglCooldown = 0;
    } else {
      this.aglCooldown = Math.max(0, this.aglCooldown - dt);
    }
  }

  private syncTurretTransforms(dt: number): void {
    const pt = this.playerTruck;
    if (pt) {
      const cy = Math.cos(pt.yaw);
      const sy = Math.sin(pt.yaw);
      // Real Jackal roof turret ring sits at local (0, 2.38, +0.78) in -Z convoy space
      this._turretPivot.set(
        pt.position.x + 0.78 * sy,
        pt.root.position.y + 2.38,
        pt.position.z + 0.78 * cy,
      );
    }

    if (this.gun) {
      this.gun.point(this._turretPivot, this._yaw, this._pitch, dt);
      this.gun.muzzle(this._turretMuzzle);
    } else {
      const cp = Math.cos(this._pitch);
      this._turretMuzzle
        .copy(this._turretPivot)
        .addScaledVector(
          _tmp.set(-Math.sin(this._yaw) * cp, Math.sin(this._pitch), -Math.cos(this._yaw) * cp),
          1.54,
        );
    }

    if (!this._mounted) return;

    const cp = Math.cos(this._pitch);
    const sy = Math.sin(this._yaw);
    const cy = Math.cos(this._yaw);
    _aim.set(-sy * cp, Math.sin(this._pitch), -cy * cp);
    _right.set(cy, 0, -sy);
    _camUp.crossVectors(_right, _aim);
    _eye.copy(this._turretPivot).addScaledVector(_camUp, 0.34).addScaledVector(_aim, -0.78);

    this.seatView.position.copy(_eye);
    this.seatView.yaw = this._yaw;
    this.seatView.pitch = this._pitch;
    this.seatView.roll = (this.playerTruck?.roll ?? 0) * 0.45;
    this.ctx.camera?.syncSeat?.();
  }

  // -----------------------------------------------------------------------------------------------
  // Saltblood Bandit Vehicles AI, Combat & Destruction
  // -----------------------------------------------------------------------------------------------

  private updateBandits(dt: number): void {
    const mid = this.getTruckPosition(_tmp);

    for (let i = this._bandits.length - 1; i >= 0; i--) {
      const bv = this._bandits[i]!;
      if (!bv.alive) continue;
      bv.age += dt;
      bv.weavePhase += bv.weaveFreq * dt;

      let targetX: number;
      let targetZ: number;
      let cruiseSpeed = bv.kind === 'bike' ? 21 : bv.kind === 'quad' ? 19.5 : 17.5;

      if (bv.behavior === 'sideGate') {
        cruiseSpeed = bv.kind === 'bike' ? 19 : bv.kind === 'quad' ? 17 : 13.5;
        // Burst south out of the side gate (z=62 -> 76) then flank the convoy outside the wall!
        if (bv.position.z < DESERT_Z.wallLine + 13) {
          targetX = bv.position.x;
          targetZ = DESERT_Z.wallLine + 16;
        } else {
          targetX = mid.x + bv.preferredSide * 20 + Math.sin(bv.weavePhase) * bv.weaveAmp;
          targetZ = Math.max(DESERT_Z.wallLine + 12, mid.z - 2 + Math.cos(bv.weavePhase * 0.7) * 6);
        }
      } else if (bv.behavior === 'exfil') {
        // High-speed pursuit chasing the southbound convoy from behind/flanks
        cruiseSpeed = bv.kind === 'bike' ? 23 : bv.kind === 'quad' ? 21 : 19;
        targetX = mid.x + bv.preferredSide * (10 + Math.sin(bv.weavePhase) * bv.weaveAmp);
        targetZ = mid.z + bv.preferredLead;
      } else {
        // Approach raiders weaving across dunes ahead & flanking the northbound convoy
        targetX = mid.x + bv.preferredSide * (16 + Math.sin(bv.weavePhase) * bv.weaveAmp);
        targetZ = Math.max(DESERT_Z.wallLine + 12, mid.z - bv.preferredLead);
      }

      const toX = targetX - bv.position.x;
      const toZ = targetZ - bv.position.z;
      const distToTarget = Math.hypot(toX, toZ);
      const stepSpeed = Math.min(cruiseSpeed, Math.max(4, distToTarget * 1.4));

      if (distToTarget > 0.3) {
        const nx = toX / distToTarget;
        const nz = toZ / distToTarget;
        bv.velocity.x = damp(bv.velocity.x, nx * stepSpeed, 3.8, dt);
        bv.velocity.z = damp(bv.velocity.z, nz * stepSpeed, 3.8, dt);
      } else {
        bv.velocity.x = damp(bv.velocity.x, 0, 4, dt);
        bv.velocity.z = damp(bv.velocity.z, 0, 4, dt);
      }

      bv.position.x += bv.velocity.x * dt;
      bv.position.z += bv.velocity.z * dt;
      const moveSpd = Math.hypot(bv.velocity.x, bv.velocity.z);
      bv.speed = moveSpd;

      const wantYaw = moveSpd > 0.6 ? Math.atan2(-bv.velocity.x, -bv.velocity.z) : bv.yaw;
      const prevYaw = bv.yaw;
      bv.yaw = dampAngle(bv.yaw, wantYaw, 6, dt);
      const turnRate = wrapAngle(bv.yaw - prevYaw) / Math.max(dt, 1e-4);
      const leanScale = bv.kind === 'bike' ? 0.24 : bv.kind === 'quad' ? 0.09 : 0.06;
      bv.roll = damp(bv.roll, clamp(-turnRate * leanScale, -0.42, 0.42), 8, dt);

      const bounce = Math.sin(bv.age * 9 + bv.id) * (bv.kind === 'bike' ? 0.08 : bv.kind === 'quad' ? 0.065 : 0.05);
      bv.root.position.set(bv.position.x, bounce, bv.position.z);
      bv.root.rotation.set(0, bv.yaw, 0);
      bv.body.rotation.set(0, 0, bv.roll);
      bv.center.set(bv.position.x, bv.kind === 'truck' ? 1.25 : 0.95, bv.position.z);

      // Update on-foot static collider transform
      if (bv.collider) {
        _q.setFromAxisAngle(UP, bv.yaw);
        bv.collider.setTranslation(_tmp2.set(bv.position.x, bv.kind === 'truck' ? 1.0 : 0.85, bv.position.z));
        bv.collider.setRotation(_q);
      }

      // Spin wheels forward (positive rotation.x inside Math.PI-rotated real vehicle holder)
      const wheelR = bv.kind === 'bike' ? 0.38 : bv.kind === 'quad' ? 0.42 : 0.5;
      const wSpin = (moveSpd / wheelR) * dt;
      for (let w = 0; w < bv.wheels.length; w++) bv.wheels[w]!.rotation.x += wSpin;

      // Aim roof turret on technicals OR rear pillion shooter on 2-up motos & quads toward player/convoy
      const aimTarget = this._mounted ? mid : (this.ctx.player?.position ?? mid);
      const dxAim = aimTarget.x - bv.position.x;
      const dzAim = aimTarget.z - bv.position.z;
      const gYaw = Math.atan2(-dxAim, -dzAim);
      const relAimYaw = wrapAngle(gYaw - bv.yaw);
      const aimPitch = Math.atan2(
        (aimTarget.y + 1.5) - (bv.position.y + 1.4),
        Math.max(2, Math.hypot(dxAim, dzAim)),
      );
      const speedRatio = clamp(moveSpd / 24, 0, 1);

      if (bv.driverRider) {
        animateRider(bv.driverRider, clamp(-turnRate * 0.45, -0.6, 0.6), speedRatio, 0, 0, 0);
      }
      if (bv.gunnerAlive) {
        if (bv.kind === 'truck' && bv.gunnerPivot) {
          bv.gunnerPivot.rotation.y = dampAngle(bv.gunnerPivot.rotation.y, relAimYaw, 7, dt);
        }
        if (bv.gunnerRider) {
          animateRider(bv.gunnerRider, 0, speedRatio, 0, relAimYaw, aimPitch);
        }
      }

      // Desert tire dust
      if (moveSpd > 2.5) {
        bv.dustTimer -= dt;
        if (bv.dustTimer <= 0) {
          bv.dustTimer = 0.2;
          this.ctx.fx?.dust?.(bv.position, UP, bv.kind === 'truck' ? 1.1 : bv.kind === 'quad' ? 0.85 : 0.7);
        }
      }

      // Smoke heavily below 50% HP!
      if (bv.hp < bv.maxHp * 0.5) {
        bv.smokeTimer -= dt;
        if (bv.smokeTimer <= 0) {
          bv.smokeTimer = 0.22;
          _tmp2.copy(bv.position).addScaledVector(UP, bv.kind === 'truck' ? 1.45 : 0.9);
          this.ctx.fx?.smoke?.(_tmp2, 0x22201e, bv.kind === 'truck' ? 1.25 : 0.85, 1.2);
        }
      }

      // Fire tracer bursts at convoy / player when rear gunner / turret gunner is alive & in range
      const distToTargetPlayer = bv.position.distanceTo(aimTarget);
      if (bv.gunnerAlive && distToTargetPlayer <= 78) {
        bv.fireCooldown -= dt;
        if (bv.fireCooldown <= 0) {
          bv.fireCooldown = bv.kind === 'truck' ? rand(1.1, 1.9) : bv.kind === 'quad' ? rand(1.3, 2.2) : rand(1.5, 2.4);
          this.banditFireBurst(bv, aimTarget);
        }
      }
    }
  }

  private banditFireBurst(bv: BanditVehicle, aimTarget: THREE.Vector3): void {
    const sy = Math.sin(bv.yaw);
    const cy = Math.cos(bv.yaw);
    const rearOffset = bv.kind === 'truck' ? 0.78 : 0.64;
    const muzzlePos = _tmp2.set(
      bv.position.x + rearOffset * sy,
      bv.kind === 'truck' ? 2.35 : 1.46,
      bv.position.z + rearOffset * cy,
    );
    const impactPos = _impact.set(
      aimTarget.x + rand(-1.8, 1.8),
      aimTarget.y + rand(0.9, 2.1),
      aimTarget.z + rand(-1.8, 1.8),
    );
    this.ctx.fx?.tracer?.(muzzlePos, impactPos, 'enemy');
    this.ctx.audio?.play?.(bv.kind === 'truck' ? 'hmg_shot' : 'smg_shot', {
      position: muzzlePos,
      volume: 0.62,
      pitchJitter: 0.08,
    });

    const dmg = bv.kind === 'truck' ? 9 : bv.kind === 'quad' ? 6 : 5;
    const dmgSource =
      bv.kind === 'truck' ? 'saltblood_technical' : bv.kind === 'quad' ? 'saltblood_quad' : 'saltblood_bike';
    if (Math.random() < 0.65) {
      if (this._mounted) {
        this.damageConvoyHull(dmg, muzzlePos, dmgSource);
      } else if (this.ctx.player?.alive) {
        this.ctx.player.takeDamage({
          amount: dmg,
          type: 'bullet',
          source: dmgSource,
          from: muzzlePos.clone(),
        });
      }
    }
  }

  private destroyBandit(
    bv: BanditVehicle,
    mode: 'rider_flip' | 'bike_flip' | 'quad_blast' | 'engine_blast' | 'truck_blast',
    source: string,
  ): void {
    if (!bv.alive) return;
    const hadCrew = bv.kind !== 'truck' || bv.gunnerAlive;
    bv.alive = false;
    bv.gunnerAlive = false;
    if (bv.driverRider) bv.driverRider.root.visible = false;
    if (bv.gunnerRider) bv.gunnerRider.root.visible = false;
    if (bv.kind === 'truck' && bv.gunnerPivot) bv.gunnerPivot.visible = false;

    const idx = this._bandits.indexOf(bv);
    if (idx >= 0) this._bandits.splice(idx, 1);
    this.removeBanditCollider(bv);

    this._banditVehiclesDestroyed++;
    const pos = bv.position.clone();
    const crewPos = _tmp2.set(pos.x, bv.kind === 'truck' ? 1.85 : 1.35, pos.z);

    if (hadCrew && mode !== 'rider_flip') {
      this.ctx.fx?.gibBurst?.(crewPos, UP, bv.kind === 'truck' ? 22 : 18);
      this.ctx.fx?.bloodMist?.(crewPos, 1.4);
      this.ctx.audio?.play?.('gore_splat', { position: crewPos, volume: 0.78, pitchJitter: 0.1 });
    }

    if (bv.kind === 'bike') {
      this.ctx.fx?.explosion?.(pos, { radius: 4.2, kind: 'barrel', scale: 0.95 });
      this.ctx.fx?.sparks?.(pos, UP, 18, 0xffaa33);
      this.ctx.audio?.play?.('explosion_small', { position: pos, volume: 0.85 });
      this.ctx.audio?.play?.('veh_destroyed', { position: pos, volume: 0.8, pitch: 1.2 });
      this.ctx.hud?.feed?.(
        mode === 'rider_flip' ? 'SALTBLOOD RIDER DOWN — BIKE FLIPPED!' : 'SALTBLOOD BIKE DESTROYED!',
        '#ffcf6e',
      );
      if (!isGuest(this.ctx)) {
        this.ctx.progression?.award?.(DESERT_CONVOY_CONSTANTS.bikeScore, 'BANDIT BIKE', pos);
      }
    } else if (bv.kind === 'quad') {
      this.ctx.fx?.explosion?.(pos, { radius: 5.2, kind: 'barrel', scale: 1.1 });
      this.ctx.fx?.sparks?.(pos, UP, 20, 0xffaa33);
      this.ctx.fx?.embers?.(pos, 16, 2.4);
      this.ctx.audio?.play?.('explosion_small', { position: pos, volume: 0.88 });
      this.ctx.audio?.play?.('veh_destroyed', { position: pos, volume: 0.85, pitch: 1.08 });
      this.ctx.camera?.addTrauma?.(0.2);
      this.ctx.hud?.feed?.(
        mode === 'rider_flip' ? 'SALTBLOOD RIDER DOWN — QUAD FLIPPED!' : 'SALTBLOOD QUAD DESTROYED!',
        '#ffcf6e',
      );
      if (!isGuest(this.ctx)) {
        this.ctx.progression?.award?.(DESERT_CONVOY_CONSTANTS.quadScore, 'BANDIT QUAD', pos);
      }
    } else {
      this.ctx.fx?.explosion?.(pos, { radius: 7.2, kind: 'barrel', scale: 1.4 });
      this.ctx.fx?.embers?.(pos, 26, 3.2);
      this.ctx.render?.lights?.flash?.(pos, 0xff8828, 28, 38, 0.45);
      this.ctx.audio?.play?.('veh_destroyed', { position: pos, volume: 0.95 });
      this.ctx.audio?.play?.('explosion_barrel', { position: pos, volume: 0.85 });
      this.ctx.camera?.addTrauma?.(0.32);
      this.ctx.hud?.feed?.(
        mode === 'engine_blast' ? 'ENGINE DETONATED — TECHNICAL OBLITERATED!' : 'SALTBLOOD TECHNICAL DESTROYED!',
        '#ff8c42',
      );
      if (!isGuest(this.ctx)) {
        this.ctx.progression?.award?.(DESERT_CONVOY_CONSTANTS.truckScore, 'SALTBLOOD TECHNICAL', pos);
      }
    }

    this.ctx.events?.emit?.('vehicle:destroyed', {
      kind: 'truck',
      source,
      position: pos.clone(),
    });

    if (this._phase === 'wallLoop') {
      this.recordWallLoopHit(4);
    }

    // Launch tumbling flaming wreck into the desert air!
    const isLight = bv.kind !== 'truck';
    const vel = new THREE.Vector3(
      bv.velocity.x * 0.55 + rand(-5, 5),
      isLight ? rand(8.0, 11.2) : rand(5.5, 8.2),
      bv.velocity.z * 0.55 + rand(-5, 5),
    );
    const angVel = new THREE.Vector3(
      isLight ? rand(-8.5, 8.5) : rand(-4.5, 4.5),
      rand(-4, 4),
      isLight ? rand(-9.5, 9.5) : rand(-5.5, 5.5),
    );

    this._wrecks.push({
      id: bv.id,
      kind: bv.kind,
      root: bv.root,
      position: pos,
      velocity: vel,
      angVel,
      age: 0,
      maxAge: 4.5,
      exploded: true,
      smokeTimer: 0,
    });
  }

  private removeBanditCollider(bv: BanditVehicle): void {
    if (!bv.collider) return;
    this.banditByCollider.delete(bv.collider.handle);
    if (typeof this.ctx.physics?.world?.removeCollider === 'function') {
      this.ctx.physics.world.removeCollider(bv.collider, false);
    } else {
      bv.collider.setTranslation(_tmp2.set(0, -1000, 0));
    }
    bv.collider = null;
  }

  private updateWrecks(dt: number): void {
    for (let i = this._wrecks.length - 1; i >= 0; i--) {
      const w = this._wrecks[i]!;
      w.age += dt;
      w.velocity.y -= 22 * dt;
      w.position.addScaledVector(w.velocity, dt);

      if (w.position.y <= 0.15) {
        w.position.y = 0.15;
        if (w.velocity.y < -3.0) {
          w.velocity.y = -w.velocity.y * 0.28;
          w.velocity.x *= 0.65;
          w.velocity.z *= 0.65;
          this.ctx.audio?.play?.('wreck_land', { position: w.position, volume: 0.7 });
          this.ctx.fx?.sparks?.(w.position, UP, 10, 0xffaa33);
          this.ctx.fx?.dust?.(w.position, UP, 1.5);
        } else {
          w.velocity.y = 0;
          w.velocity.x *= Math.max(0, 1 - 4.5 * dt);
          w.velocity.z *= Math.max(0, 1 - 4.5 * dt);
          w.angVel.multiplyScalar(Math.max(0, 1 - 5 * dt));
        }
      }

      _euler.set(w.angVel.x * dt, w.angVel.y * dt, w.angVel.z * dt);
      _stepQ.setFromEuler(_euler);
      w.root.quaternion.multiply(_stepQ);
      w.root.position.copy(w.position);

      w.smokeTimer -= dt;
      if (w.smokeTimer <= 0) {
        w.smokeTimer = 0.16;
        this.ctx.fx?.smoke?.(w.position, 0x1e1c1a, w.kind === 'truck' ? 1.5 : 0.9, 1.3);
      }

      if (w.age >= w.maxAge) {
        w.root.removeFromParent();
        this._wrecks.splice(i, 1);
      }
    }
  }

  private clearBanditsAndWrecks(): void {
    for (const bv of this._bandits) {
      this.removeBanditCollider(bv);
      bv.root.removeFromParent();
    }
    this._bandits.length = 0;
    this.banditByCollider.clear();

    for (const w of this._wrecks) {
      w.root.removeFromParent();
    }
    this._wrecks.length = 0;
  }

  // -----------------------------------------------------------------------------------------------
  // HUD
  // -----------------------------------------------------------------------------------------------

  private updateHud(): void {
    const hud = this.hud;
    if (!hud) return;

    const kmh = Math.round(this.currentSpeed * 3.6);
    if (kmh !== this.hudLastKmh) {
      this.hudLastKmh = kmh;
      hud.speed.set(`${kmh} KM/H`);
    }

    let stage: string;
    if (this._phase === 'approach') {
      stage = 'APPROACH — OPEN DUNES';
    } else if (this._phase === 'wallLoop') {
      stage = 'WALL BROADSIDE — SHRED SURPLUS';
    } else if (this._phase === 'exfilChase') {
      stage = this._quistCaptured ? 'EXFIL — QUIST SECURED' : 'EXFIL — FULL THROTTLE';
    } else {
      stage = 'CONVOY STANDBY';
    }
    if (stage !== this.hudLastStage) {
      this.hudLastStage = stage;
      hud.stage.set(stage);
    }

    const hullFrac = clamp(this._hull / this.maxHull);
    const hullText = `${Math.ceil(this._hull)} / ${this.maxHull}`;
    if (hullText !== this.hudLastHullText) {
      this.hudLastHullText = hullText;
      hud.hullText.set(hullText);
    }
    const hullScale = `scaleX(${hullFrac.toFixed(4)})`;
    if (hullScale !== this.hudLastHullScale) {
      this.hudLastHullScale = hullScale;
      hud.hullFill.style.transform = hullScale;
    }
    const hullLow = hullFrac < 0.3;
    if (hullLow !== this.hudLastHullLow) {
      this.hudLastHullLow = hullLow;
      hud.hullFill.classList.toggle('low', hullLow);
    }

    const heatPct = Math.round(this.heat.value * 100);
    const heatText = this.heat.overheated ? 'OVERHEAT — VENTING' : `${heatPct}%`;
    if (heatText !== this.hudLastHeatText) {
      this.hudLastHeatText = heatText;
      hud.heatText.set(heatText);
    }
    if (this.heat.overheated !== this.hudLastHeatOverheat) {
      this.hudLastHeatOverheat = this.heat.overheated;
      hud.heatText.el.classList.toggle('dr-cv-overheat', this.heat.overheated);
    }
    const heatScale = `scaleX(${clamp(this.heat.value).toFixed(4)})`;
    if (heatScale !== this.hudLastHeatScale) {
      this.hudLastHeatScale = heatScale;
      hud.heatFill.style.transform = heatScale;
    }
    const heatHot = this.heat.overheated || this.heat.value > 0.8;
    if (heatHot !== this.hudLastHeatHot) {
      this.hudLastHeatHot = heatHot;
      hud.heatFill.classList.toggle('hot', heatHot);
    }

    const aglInterval = 1 / DESERT_CONVOY_CONSTANTS.turretRps;
    const aglReady = clamp(1 - this.aglCooldown / aglInterval);
    const aglText = aglReady >= 0.99 ? 'READY' : 'CYCLING';
    if (aglText !== this.hudLastAglText) {
      this.hudLastAglText = aglText;
      hud.aglText.set(aglText);
    }
    const aglScale = `scaleX(${aglReady.toFixed(4)})`;
    if (aglScale !== this.hudLastAglScale) {
      this.hudLastAglScale = aglScale;
      hud.aglFill.style.transform = aglScale;
    }

    if (this._weaponMode !== this.hudLastMode) {
      this.hudLastMode = this._weaponMode;
      const isAgl = this._weaponMode === 'agl';
      hud.hmgGauge.classList.toggle('active', !isAgl);
      hud.aglGauge.classList.toggle('active', isAgl);
      hud.reticle.classList.toggle('agl', isAgl);
    }

    if (this._zoomed !== this.hudLastZoom) {
      this.hudLastZoom = this._zoomed;
      hud.reticle.classList.toggle('zoom', this._zoomed);
    }
  }
}
