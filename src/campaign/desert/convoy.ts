/**
 * Lane 2: Ally-Driven 3-Truck Desert Raid Convoy, Player Heavy `.50 cal` Turret Seat,
 * and Saltblood Bandit Vehicles (Dirt-Bikes & Armed Scrap Technicals) for Mission 5: DESERT RAID.
 *
 * The player NEVER drives. Allies steer the 3-truck column along `CONVOY_PATHS`:
 *   - Section 1 (`startApproach`): Dawn dune run from z = +208 -> +84; raises `dr:approach_done`.
 *   - Section 2 (`startWallLoop`): Slow broadside shooting-gallery loop along Surplus's outer wall;
 *     raises `dr:wall_loop_ready` after the first pass or heavy wall/bandit damage, looping until dismount.
 *   - Section 3 (`dismountAtGate`): Parks all 3 trucks at the breached Main Gate (z ≈ 74) and releases
 *     the player cleanly on foot at `(0, 0, 68)` facing north (yaw = 0).
 *   - Section 6 (`arriveForExfil` -> `startExfilChase`): Smashes into the Plane forecourt with pulsing
 *     `[E] Board Exfil Truck` prompt (auto-boards <= 4.5 m or E), optionally displaying zip-tied Hadrek Quist
 *     in the middle truck bed, raises `dr:exfil_boarded`, then rockets south through Surplus while pursuing
 *     Saltblood bikes & technicals attack; raises `dr:exfil_clear` once `z >= 125` while rolling onward.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CG, type Ctx, type ExplosionKind, type LoopHandle, type PlayerDamage, type SeatView } from '../../core/contracts';
import { isGuest } from '../../core/coop';
import type { ExplosionSpec, MissileTarget, ShotSpec } from '../../core/gameplay';
import { clamp, damp, dampAngle, lerp, rand, randomInCone, wrapAngle } from '../../core/math';
import type { ExtraTarget, VehicleSystem } from '../../enemies/vehicles';
import { ModelBuilder, ModelMaterials } from '../../progression/modelkit';
import { div, Label, span } from '../../ui/dom';
import { Heat, HMG } from '../../vehicles/emplacement';
import { Gun } from '../../vehicles/guns';
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
  | 'exfilChase';

export type BanditVehicleKind = 'bike' | 'truck';
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
  approachSpeed: 11,
  wallLoopSpeed: 6.5,
  exfilArriveSpeed: 13,
  exfilSpeed: 15,
  exfilClearZ: 125,
  exfilAutoBoardRadius: 4.5,
  exfilPromptRadius: 8.5,
  gateParkZ: 74,
  dismountPos: [0, 0, 68] as Pt3,
  leadOffset: [-11, 0, -10] as Pt3,
  rearOffset: [11, 0, 10] as Pt3,
  maxHull: 500,
  phasePatchHeal: 160,
  turretRps: 11,
  turretDamage: 55,
  turretSpread: 0.0055,
  turretMaxRange: 280,
  turretFov: 74,
  turretZoomFov: 44,
  pitchMin: (-25 * Math.PI) / 180,
  pitchMax: (45 * Math.PI) / 180,
  heatPerShot: 1 / 78,
  heatCool: 0.3,
  heatVent: 0.42,
  wallLoopReadyHits: 12,
  bikeMaxHp: 75,
  truckMaxHp: 240,
  bikeScore: 350,
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
const _impact = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _localOrigin = new THREE.Vector3();
const _localDir = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
const _q = new THREE.Quaternion();
const _stepQ = new THREE.Quaternion();
const _euler = new THREE.Euler();

const ALONG_X: readonly [number, number, number] = [0, 0, Math.PI / 2];
const ALONG_Z: readonly [number, number, number] = [Math.PI / 2, 0, 0];

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

function buildOffroadWheel(materials: ModelMaterials, radius: number, width: number, rimColor = '#5d5342'): THREE.Group {
  const b = new ModelBuilder();
  b.cyl(radius, radius, width, 12, '#1c1b19', { rot: ALONG_X });
  b.cyl(radius * 0.52, radius * 0.52, width + 0.04, 10, rimColor, { rot: ALONG_X });
  b.cyl(radius * 0.2, radius * 0.2, width + 0.08, 8, '#2b2d30', { rot: ALONG_X });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.box(width + 0.03, radius * 0.16, radius * 0.26, '#2a2824', {
      at: [0, Math.cos(a) * radius * 0.9, Math.sin(a) * radius * 0.9],
      rot: [a, 0, 0],
    });
  }
  return materials.group(b);
}

function buildCapturedQuist(materials: ModelMaterials): THREE.Group {
  const g = new THREE.Group();
  g.name = 'desert.convoy.quistCaptured';
  const b = new ModelBuilder();
  const COAT = '#c7b897';
  const VEST = '#5a4636';
  const SKIN = '#d6aa84';
  const HAIR = '#4a433c';
  const PANTS = '#484038';
  const ZIP = '#f2f6fa';

  // Seated legs folded forward in truck bed
  for (const s of [-1, 1]) {
    b.box(0.18, 0.16, 0.56, PANTS, { at: [s * 0.14, 0.12, -0.24], rot: [0.15, 0, 0] });
    b.box(0.14, 0.22, 0.18, '#2c2622', { at: [s * 0.14, 0.06, -0.52] });
  }
  // Slumped torso + salt-stained khaki coat
  b.box(0.46, 0.58, 0.3, COAT, { at: [0, 0.44, 0.02], rot: [0.18, 0, 0] });
  b.box(0.42, 0.34, 0.32, VEST, { at: [0, 0.48, 0.01], rot: [0.18, 0, 0] });
  // Arms pinned behind his back + bright white zip-tie cuff!
  for (const s of [-1, 1]) {
    b.box(0.14, 0.42, 0.14, COAT, { at: [s * 0.22, 0.42, 0.16], rot: [-0.45, 0, s * 0.22] });
  }
  b.box(0.24, 0.08, 0.08, ZIP, { at: [0, 0.28, 0.24] });
  // Head & scruffy salt-king beard/hair
  b.solid(new THREE.SphereGeometry(0.15, 8, 6), SKIN, { at: [0, 0.85, -0.02] });
  b.box(0.24, 0.1, 0.24, HAIR, { at: [0, 0.94, 0.01] });
  b.box(0.18, 0.08, 0.12, HAIR, { at: [0, 0.77, -0.09] });
  g.add(materials.group(b));
  g.visible = false;
  return g;
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
  const b = new ModelBuilder();

  const TAN = role === 'player' ? '#bfa172' : '#b29468';
  const TAN_DARK = '#8e744e';
  const OLIVE = '#555c42';
  const OLIVE_DARK = '#3d4330';
  const STEEL = '#30343a';
  const RUST = '#70442c';
  const GLASS = '#152028';
  const HELMET = '#464d38';
  const GEAR = '#2b2f26';

  // Heavy welded chassis & underbody (facing -Z)
  b.box(2.26, 0.42, 5.5, STEEL, { at: [0, 0.72, 0] });
  // Welded heavy bullbar & front skid plate (-Z)
  b.box(2.38, 0.24, 0.26, STEEL, { at: [0, 0.66, -2.84] });
  b.box(1.9, 0.45, 0.12, TAN_DARK, { at: [0, 0.56, -2.74], rot: [0.45, 0, 0] });
  for (const s of [-1, 1]) {
    b.box(0.08, 0.68, 0.08, STEEL, { at: [s * 0.88, 1.0, -2.88] });
    b.box(0.08, 0.54, 0.08, STEEL, { at: [s * 0.36, 0.96, -2.88] });
  }
  b.box(1.86, 0.08, 0.08, STEEL, { at: [0, 1.28, -2.88] });

  // Sloped desert-tan armored hood (-Z) + olive air intake + dust fender flares
  b.box(2.14, 0.62, 1.78, TAN, { at: [0, 1.24, -1.84] });
  b.box(1.72, 0.12, 1.48, OLIVE, { at: [0, 1.56, -1.8], rot: [0.05, 0, 0] });
  b.box(1.88, 0.36, 0.08, '#232629', { at: [0, 1.18, -2.74] }); // radiator grille
  b.box(2.18, 0.1, 0.32, OLIVE_DARK, { at: [0, 1.38, -2.62] });

  // Open-frame desert tactical cab
  b.box(2.2, 0.66, 1.56, TAN, { at: [0, 1.26, -0.22] });
  b.box(2.24, 0.14, 1.58, OLIVE, { at: [0, 1.08, -0.22] });
  // Cab pillars & roof
  for (const s of [-1, 1]) {
    b.box(0.1, 0.72, 0.1, STEEL, { at: [s * 1.04, 1.84, -0.94], rot: [0.22, 0, 0] });
    b.box(0.1, 0.72, 0.1, STEEL, { at: [s * 1.04, 1.84, 0.48] });
  }
  b.box(1.94, 0.52, 0.06, GLASS, { at: [0, 1.84, -0.94], rot: [0.22, 0, 0] });
  b.box(2.16, 0.1, 1.58, OLIVE, { at: [0, 2.22, -0.22] });
  // Roof desert rack & amber convoy beacon
  b.box(1.8, 0.08, 0.9, STEEL, { at: [0, 2.31, -0.14] });
  b.glow(new THREE.BoxGeometry(0.42, 0.14, 0.22), '#ffaa28', 3.0, { at: [0, 2.38, -0.68] });

  // Sculpted ally driver inside cab (left seat)
  b.box(0.4, 0.52, 0.28, OLIVE_DARK, { at: [-0.46, 1.56, -0.24] });
  b.solid(new THREE.SphereGeometry(0.16, 8, 6), HELMET, { at: [-0.46, 1.94, -0.26] });
  b.box(0.18, 0.07, 0.06, '#283c48', { at: [-0.46, 1.94, -0.4] }); // goggles
  b.solid(new THREE.TorusGeometry(0.17, 0.025, 6, 12), '#1a1c1e', { at: [-0.46, 1.54, -0.64], rot: [0.5, 0, 0] }); // steering wheel

  // Open steel roll-cage rear pickup bed (+Z)
  b.box(2.12, 0.1, 2.18, '#36322c', { at: [0, 1.0, 1.62] }); // bed floor
  for (const s of [-1, 1]) {
    b.box(0.14, 0.64, 2.24, TAN, { at: [s * 1.06, 1.32, 1.62] });
    b.box(0.16, 0.12, 2.24, OLIVE_DARK, { at: [s * 1.07, 1.56, 1.62] });
    // Tubular steel roll-cage uprights & side bars
    b.cyl(0.045, 0.045, 0.85, 8, STEEL, { at: [s * 1.0, 2.02, 0.64] });
    b.cyl(0.045, 0.045, 0.72, 8, STEEL, { at: [s * 1.0, 1.96, 2.52] });
    b.cyl(0.04, 0.04, 1.94, 8, STEEL, { at: [s * 1.0, 2.34, 1.58], rot: ALONG_Z });
    // Red jerrycan & stowage box strapped to outer bed rails
    b.box(0.22, 0.42, 0.34, s < 0 ? '#a82e22' : OLIVE, { at: [s * 1.2, 1.32, 2.12] });
    // Glowing red taillights
    b.glow(new THREE.BoxGeometry(0.32, 0.16, 0.06), '#ff2618', 3.2, { at: [s * 0.82, 1.18, 2.76] });
  }
  // Rollbar crossbar behind cab + rear tailgate
  b.cyl(0.045, 0.045, 2.06, 8, STEEL, { at: [0, 2.4, 0.64], rot: ALONG_X });
  b.box(2.16, 0.56, 0.14, TAN_DARK, { at: [0, 1.28, 2.68] });
  // Spare tire strapped to rear tailgate/corner
  b.cyl(0.44, 0.44, 0.28, 12, '#1c1b19', { at: [-0.52, 1.36, 2.86], rot: ALONG_Z });
  b.cyl(0.22, 0.22, 0.3, 8, RUST, { at: [-0.52, 1.36, 2.86], rot: ALONG_Z });
  // Turret ring & pintle post inside bed
  b.solid(new THREE.TorusGeometry(0.56, 0.065, 6, 16), STEEL, { at: [0, 1.62, 1.48], rot: [Math.PI / 2, 0, 0] });
  b.cyl(0.055, 0.07, 0.68, 8, GEAR, { at: [0, 1.34, 1.48] });
  // Exhaust stack behind cab
  b.cyl(0.06, 0.06, 1.5, 8, RUST, { at: [1.14, 1.72, 0.42] });

  const body = materials.group(b);
  root.add(body);

  // Separate headlights mesh group so exfil arrival can blaze/pulse them!
  const hlBuilder = new ModelBuilder();
  for (const s of [-1, 1]) {
    hlBuilder.glow(new THREE.BoxGeometry(0.34, 0.18, 0.06), '#ffe9b8', 3.6, { at: [s * 0.78, 1.2, -2.76] });
  }
  const headlights = materials.group(hlBuilder);
  body.add(headlights);

  // Flexible whip antenna on rear right corner
  const antenna = new THREE.Group();
  antenna.position.set(1.04, 1.66, 2.64);
  const antB = new ModelBuilder();
  antB.cyl(0.014, 0.022, 2.4, 6, '#23262b', { at: [0, 1.2, 0] });
  antB.box(0.04, 0.22, 0.34, '#d87a24', { at: [0, 2.18, 0.16] }); // desert orange pennant flag
  antenna.add(materials.group(antB));
  body.add(antenna);

  // 4 chunky spinning off-road wheels
  const wheels: THREE.Object3D[] = [];
  for (const [wx, wy, wz] of [
    [-1.16, 0.54, -1.78],
    [1.16, 0.54, -1.78],
    [-1.16, 0.54, 1.68],
    [1.16, 0.54, 1.68],
  ] as const) {
    const w = buildOffroadWheel(materials, 0.54, 0.38);
    w.position.set(wx, wy, wz);
    root.add(w);
    wheels.push(w);
  }

  // Flank trucks get a sculpted ally gunner + rotating bed HMG
  let allyTurret: THREE.Object3D | null = null;
  if (role !== 'player') {
    allyTurret = new THREE.Group();
    allyTurret.position.set(0, 1.88, 1.48);
    const tb = new ModelBuilder();
    // Welded gunshield + heavy barrel along -Z
    tb.box(0.76, 0.44, 0.05, OLIVE, { at: [0, 0.06, -0.36] });
    tb.box(0.22, 0.22, 0.62, '#3a4148', { at: [0, 0.04, -0.05] });
    tb.cyl(0.032, 0.032, 1.15, 8, '#2d3238', { at: [0, 0.04, -0.82], rot: ALONG_Z });
    // Sculpted ally gunner standing behind spade grips
    tb.box(0.42, 0.64, 0.28, OLIVE_DARK, { at: [0, -0.14, 0.52] });
    tb.solid(new THREE.SphereGeometry(0.16, 8, 6), HELMET, { at: [0, 0.32, 0.48] });
    tb.box(0.18, 0.07, 0.06, '#2a3d4a', { at: [0, 0.32, 0.34] });
    for (const s of [-1, 1]) {
      tb.box(0.12, 0.12, 0.36, TAN_DARK, { at: [s * 0.2, 0.04, 0.34] });
    }
    allyTurret.add(materials.group(tb));
    body.add(allyTurret);
  }

  // Middle (player) truck carries optional captured zip-tied Hadrek Quist in the bed!
  let quistMesh: THREE.Group | null = null;
  if (role === 'player') {
    quistMesh = buildCapturedQuist(materials);
    quistMesh.position.set(0.56, 1.05, 2.22);
    quistMesh.rotation.y = -0.45;
    body.add(quistMesh);
  }

  return { root, body, wheels, antenna, headlights, allyTurret, quistMesh };
}

function buildDesertTurretShield(materials: ModelMaterials): { pivot: THREE.Group; heatSleeve: THREE.Mesh } {
  const pivot = new THREE.Group();
  pivot.name = 'desert.turretShield';
  const b = new ModelBuilder();
  const PLATE = '#545b42';
  const TAN_TRIM = '#b59668';
  const STEEL = '#30353b';
  const BRASS = '#c49d46';

  // Welded desert-olive steel gunshield framing clear U-shaped barrel sightline
  b.box(0.46, 0.58, 0.055, PLATE, { at: [-0.39, -0.02, -0.48], rot: [0, 0.18, 0] });
  b.box(0.46, 0.58, 0.055, PLATE, { at: [0.39, -0.02, -0.48], rot: [0, -0.18, 0] });
  b.box(0.38, 0.24, 0.055, PLATE, { at: [0, -0.19, -0.48] });
  b.box(0.46, 0.05, 0.065, TAN_TRIM, { at: [-0.39, 0.28, -0.48], rot: [0, 0.18, 0] });
  b.box(0.46, 0.05, 0.065, TAN_TRIM, { at: [0.39, 0.28, -0.48], rot: [0, -0.18, 0] });
  // Side ammo belt box & brass links
  b.box(0.18, 0.24, 0.34, '#434a34', { at: [-0.28, -0.14, 0.02] });
  for (let i = 0; i < 4; i++) {
    b.box(0.08, 0.028, 0.05, BRASS, { at: [-0.2 + i * 0.03, -0.01 + i * 0.025, 0.02], rot: [0, 0, -0.45] });
  }
  b.box(0.05, 0.05, 0.42, STEEL, { at: [-0.18, -0.18, -0.25] });
  b.box(0.05, 0.05, 0.42, STEEL, { at: [0.18, -0.18, -0.25] });
  pivot.add(materials.group(b, materials.nearby));

  // Glowing additive thermal barrel sleeve along -Z
  const sleeveGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.92, 10);
  sleeveGeo.rotateX(Math.PI / 2);
  const sleeveMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ff5514'),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const heatSleeve = new THREE.Mesh(sleeveGeo, sleeveMat);
  heatSleeve.position.set(0, 0.02, -0.94);
  pivot.add(heatSleeve);

  return { pivot, heatSleeve };
}

function buildBanditBikeVisual(materials: ModelMaterials): {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Object3D[];
} {
  const root = new THREE.Group();
  root.name = 'desert.bandit.bike';
  const b = new ModelBuilder();
  const RUST = '#84482a';
  const FRAME = '#2e2b28';
  const TANK = '#b03a24';
  const SCARF = '#c92e24';
  const CLOTH = '#584c3d';
  const HELMET = '#36322e';

  // Welded scrap dirt-bike frame (facing -Z)
  b.box(0.32, 0.34, 1.48, FRAME, { at: [0, 0.64, 0] });
  b.box(0.38, 0.24, 0.56, TANK, { at: [0, 0.92, -0.22], rot: [-0.12, 0, 0] }); // fuel tank
  b.box(0.32, 0.14, 0.62, '#24201c', { at: [0, 0.88, 0.34] }); // saddle
  // Front fork & wide handlebars
  for (const s of [-1, 1]) {
    b.cyl(0.032, 0.032, 0.92, 6, '#565a60', { at: [s * 0.16, 0.72, -0.72], rot: [0.38, 0, 0] });
  }
  b.cyl(0.025, 0.025, 0.86, 6, FRAME, { at: [0, 1.12, -0.56], rot: ALONG_X });
  // Cyclops glowing headlight + spiked scrap front fender
  b.glow(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 8), '#ffe49c', 3.4, { at: [0, 0.98, -0.74], rot: ALONG_Z });
  b.box(0.24, 0.06, 0.44, RUST, { at: [0, 0.76, -0.84], rot: [0.22, 0, 0] });
  // Exhaust pipe
  b.cyl(0.045, 0.055, 0.85, 6, RUST, { at: [0.22, 0.56, 0.42], rot: [Math.PI / 2 - 0.16, 0, 0] });

  // Sculpted scarfed Saltblood rider leaning forward
  b.box(0.42, 0.54, 0.28, CLOTH, { at: [0, 1.24, 0.16], rot: [-0.36, 0, 0] });
  b.solid(new THREE.SphereGeometry(0.15, 8, 6), HELMET, { at: [0, 1.56, 0.04] });
  b.box(0.18, 0.07, 0.06, '#ff6828', { at: [0, 1.56, -0.1] }); // orange goggles
  // Fluttering crimson desert scarf trailing back (+Z)
  b.box(0.16, 0.1, 0.52, SCARF, { at: [0.06, 1.44, 0.36], rot: [0.18, 0.15, 0] });
  for (const s of [-1, 1]) {
    b.box(0.12, 0.12, 0.48, CLOTH, { at: [s * 0.24, 1.18, -0.22], rot: [0.1, s * 0.18, 0] });
  }

  const body = materials.group(b);
  root.add(body);

  const wheels: THREE.Object3D[] = [];
  for (const wz of [-0.92, 0.86] as const) {
    const w = buildOffroadWheel(materials, 0.38, 0.18, RUST);
    w.position.set(0, 0.38, wz);
    root.add(w);
    wheels.push(w);
  }
  return { root, body, wheels };
}

function buildBanditTruckVisual(materials: ModelMaterials): {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Object3D[];
  gunnerPivot: THREE.Object3D;
} {
  const root = new THREE.Group();
  root.name = 'desert.bandit.truck';
  const b = new ModelBuilder();
  const RUST = '#7c3f24';
  const RUST_HI = '#9b5530';
  const SCRAP = '#3a3734';
  const PLATE = '#504b45';
  const SPIKE = '#8e9296';
  const SCARF = '#c92e24';

  // Scrap pickup chassis (facing -Z)
  b.box(2.18, 0.44, 5.1, SCRAP, { at: [0, 0.72, 0] });
  // Spiked ram bumper (-Z)
  b.box(2.38, 0.34, 0.24, PLATE, { at: [0, 0.68, -2.68] });
  for (let i = -3; i <= 3; i++) {
    b.cyl(0.015, 0.065, 0.46, 5, SPIKE, { at: [i * 0.34, 0.68, -2.95], rot: [-Math.PI / 2, 0, 0] });
  }
  // Rusted hood with welded patchwork armor plates
  b.box(2.06, 0.58, 1.66, RUST, { at: [0, 1.18, -1.68] });
  b.box(1.5, 0.12, 1.24, PLATE, { at: [0.12, 1.5, -1.64], rot: [0.08, 0.05, -0.04] });
  for (const s of [-1, 1]) {
    b.glow(new THREE.BoxGeometry(0.28, 0.16, 0.06), '#ffd480', 3.2, { at: [s * 0.76, 1.14, -2.54] });
    b.glow(new THREE.BoxGeometry(0.28, 0.14, 0.06), '#ff2214', 2.6, { at: [s * 0.78, 1.12, 2.58] });
  }
  // Welded cage cab with bolted armor slats
  b.box(2.12, 0.94, 1.54, RUST_HI, { at: [0, 1.52, -0.14] });
  b.box(1.94, 0.12, 1.56, PLATE, { at: [0, 2.02, -0.14] });
  b.box(1.88, 0.38, 0.08, '#1b1d20', { at: [0, 1.72, -0.92], rot: [0.18, 0, 0] });
  // Armored slat bars across windshield
  for (const yOff of [-0.08, 0.08]) {
    b.box(1.92, 0.045, 0.04, SPIKE, { at: [0, 1.72 + yOff, -0.98] });
  }
  // Open rear pickup bed with jagged scrap side armor plates
  b.box(2.06, 0.1, 1.98, SCRAP, { at: [0, 1.0, 1.56] });
  for (const s of [-1, 1]) {
    b.box(0.16, 0.68, 2.04, RUST, { at: [s * 1.04, 1.32, 1.56] });
    b.box(0.08, 0.56, 1.48, PLATE, { at: [s * 1.14, 1.44, 1.42], rot: [0, 0, s * -0.08] });
  }
  b.box(2.1, 0.54, 0.14, RUST_HI, { at: [0, 1.24, 2.52] });
  // Pintle mount post in bed
  b.cyl(0.055, 0.065, 0.75, 8, SCRAP, { at: [0, 1.38, 1.38] });

  const body = materials.group(b);
  root.add(body);

  // Rotating bed gunner + scrap machine gun
  const gunnerPivot = new THREE.Group();
  gunnerPivot.position.set(0, 1.84, 1.38);
  const gb = new ModelBuilder();
  gb.box(0.68, 0.42, 0.05, PLATE, { at: [0, 0.06, -0.34] });
  gb.box(0.2, 0.2, 0.58, '#2c2f34', { at: [0, 0.05, -0.08] });
  gb.cyl(0.032, 0.032, 1.08, 8, '#23262a', { at: [0, 0.05, -0.78], rot: ALONG_Z });
  // Standing Saltblood bed gunner with crimson scarf
  gb.box(0.42, 0.64, 0.28, '#544638', { at: [0, -0.14, 0.46] });
  gb.box(0.44, 0.14, 0.3, SCARF, { at: [0, 0.16, 0.46] });
  gb.solid(new THREE.SphereGeometry(0.16, 8, 6), '#34302c', { at: [0, 0.32, 0.44] });
  gb.glow(new THREE.BoxGeometry(0.18, 0.06, 0.05), '#ff4a20', 2.8, { at: [0, 0.32, 0.3] });
  gunnerPivot.add(materials.group(gb));
  body.add(gunnerPivot);

  const wheels: THREE.Object3D[] = [];
  for (const [wx, wy, wz] of [
    [-1.1, 0.5, -1.62],
    [1.1, 0.5, -1.62],
    [-1.1, 0.5, 1.54],
    [1.1, 0.5, 1.54],
  ] as const) {
    const w = buildOffroadWheel(materials, 0.5, 0.34, RUST);
    w.position.set(wx, wy, wz);
    root.add(w);
    wheels.push(w);
  }
  return { root, body, wheels, gunnerPivot };
}

// -------------------------------------------------------------------------------------------------
// Desert Convoy Heavy Gunner HUD
// -------------------------------------------------------------------------------------------------

const CONVOY_HUD_CSS = `
.dr-cv-hud { position: absolute; inset: 0; pointer-events: none; font-family: var(--mono, monospace); color: #f6efe2; opacity: 0; transition: opacity 0.22s; z-index: 5; }
.dr-cv-hud.on { opacity: 1; }
.dr-cv-top { position: absolute; top: 1.4rem; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 1.35rem; padding: 0.42rem 1.05rem; background: rgba(18, 14, 10, 0.82); border-top: 0.16rem solid #d89b38; box-shadow: 0.16rem 0.16rem 0 #000; }
.dr-cv-title { font: 700 1.02rem/1 var(--display, sans-serif); letter-spacing: 0.08em; color: #ffcf6e; }
.dr-cv-stage { font-size: 0.84rem; letter-spacing: 0.07em; color: #ff8c42; font-weight: 700; }
.dr-cv-speed { font-size: 0.9rem; letter-spacing: 0.08em; color: #9be88a; font-weight: 700; }
.dr-cv-bot { position: absolute; bottom: 9.8rem; left: 50%; transform: translateX(-50%); display: flex; gap: 1.5rem; padding: 0.55rem 1.1rem; background: rgba(18, 14, 10, 0.84); border-bottom: 0.16rem solid #d89b38; box-shadow: 0.16rem 0.16rem 0 #000; }
.dr-cv-gauge { width: 15.2rem; }
.dr-cv-ghead { display: flex; justify-content: space-between; font-size: 0.75rem; letter-spacing: 0.08em; margin-bottom: 0.24rem; }
.dr-cv-track { height: 0.48rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.18); overflow: hidden; }
.dr-cv-fill { height: 100%; width: 100%; transform-origin: 0 50%; transition: transform 0.06s linear; }
.dr-cv-fill.hull { background: linear-gradient(90deg, #4ec86b, #96f09e); }
.dr-cv-fill.hull.low { background: linear-gradient(90deg, #d82a20, #ff6440); }
.dr-cv-fill.heat { background: linear-gradient(90deg, #e0a624, #ff4420); }
.dr-cv-fill.heat.hot { background: #ff2818; animation: dr-cv-blink 0.25s infinite alternate; }
.dr-cv-overheat { color: #ff4228; font-weight: 800; }
.dr-cv-xh { position: absolute; left: 50%; top: 50%; width: 28px; height: 28px; margin: -14px 0 0 -14px; border: 1.5px solid rgba(255, 224, 136, 0.88); border-radius: 50%; box-shadow: 0 0 8px rgba(255, 176, 48, 0.35); transition: transform 0.12s; }
.dr-cv-xh.zoom { transform: scale(0.66); border-color: #ff7048; }
.dr-cv-xh::after { content: ''; position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px 0 0 -2px; background: #ffcf6e; border-radius: 50%; }
@keyframes dr-cv-blink { from { opacity: 0.55; } to { opacity: 1; } }
`;

interface ConvoyHudRefs {
  root: HTMLElement;
  stage: Label;
  speed: Label;
  hullText: Label;
  hullFill: HTMLElement;
  heatText: Label;
  heatFill: HTMLElement;
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
  const speedEl = span('dr-cv-speed', '40 KM/H');
  const hullTextEl = span('', '500 / 500');
  const hullFill = div('dr-cv-fill hull');
  const heatTextEl = span('', '0%');
  const heatFill = div('dr-cv-fill heat');
  const reticle = div('dr-cv-xh');

  const root = div(
    'dr-cv-hud',
    div('dr-cv-top', span('dr-cv-title', 'RAID CONVOY // M2 .50 CAL HEAVY GUN'), stageEl, speedEl),
    reticle,
    div(
      'dr-cv-bot',
      div('dr-cv-gauge', div('dr-cv-ghead', span('', 'TRUCK ARMOR'), hullTextEl), div('dr-cv-track', hullFill)),
      div('dr-cv-gauge', div('dr-cv-ghead', span('', 'BARREL HEAT'), heatTextEl), div('dr-cv-track', heatFill)),
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
    heatText: new Label(heatTextEl),
    heatFill,
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

  // Player heavy `.50 cal` turret rig
  private gun: Gun | null = null;
  private shieldPivot: THREE.Group | null = null;
  private heatSleeve: THREE.Mesh | null = null;
  private readonly _turretPivot = new THREE.Vector3(0, 2.24, 208);
  private readonly _turretMuzzle = new THREE.Vector3(0, 2.26, 206.46);
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
  private _hull: number = DESERT_CONVOY_CONSTANTS.maxHull;
  readonly maxHull: number = DESERT_CONVOY_CONSTANTS.maxHull;
  readonly heat = new Heat({
    heatPerShot: DESERT_CONVOY_CONSTANTS.heatPerShot,
    cool: DESERT_CONVOY_CONSTANTS.heatCool,
    vent: DESERT_CONVOY_CONSTANTS.heatVent,
  });

  private pathDist = 0;
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
  private readonly exfilArriveStart = new THREE.Vector3(0, 0, -48);
  private readonly exfilTargetPos = new THREE.Vector3(
    CARGO_PLANE.forecourtExfilPos[0],
    CARGO_PLANE.forecourtExfilPos[1],
    CARGO_PLANE.forecourtExfilPos[2],
  );
  private exfilPromptUnfollow: (() => void) | null = null;
  private readonly exfilPromptPos = new THREE.Vector3();
  private exfilPulseClock = 0;
  private exfilAutoSpawnTimer = 0;

  // Firing & audio
  private roundCooldown = 0;
  private shotsFired = 0;
  private engineLoop: LoopHandle | null = null;
  private readonly shotSpec: ShotSpec;

  // Saltblood bandit vehicles & wrecks
  private nextBanditId = 1;
  private readonly _bandits: BanditVehicle[] = [];
  private readonly _wrecks: BanditWreck[] = [];
  private readonly banditByCollider = new Map<number, BanditVehicle>();
  private registeredOn: VehicleSystem | null = null;

  // HUD
  private hud: ConvoyHudRefs | null = null;

  constructor(
    private readonly ctx: Ctx,
    private readonly runner: MissionRunner,
    private readonly ui: CampaignHud,
  ) {
    this.materials = new ModelMaterials(ctx);
    this.root.name = 'desert.convoy.root';
    this.root.visible = false;
    this.shotSpec = {
      damage: DESERT_CONVOY_CONSTANTS.turretDamage,
      source: 'emplacement',
      team: 'player',
      maxDistance: DESERT_CONVOY_CONSTANTS.turretMaxRange,
      tracer: 'heavy',
      tracerFrom: _muzzle,
      force: 55,
      severMult: 4.0,
      penetrate: 1.4,
      bodyCost: 0.3,
      impactScale: 1.8,
      armorPiercing: true,
    };
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
    this.roundCooldown = 0;
    this.approachDoneSignalled = false;
    this.wallLoopReadySignalled = false;
    this.exfilBoardedSignalled = false;
    this.exfilClearSignalled = false;
    this._wallLoopPasses = 0;
    this._wallLoopHitScore = 0;

    // Place convoy at Approach start (0, 0, 208) heading North (yaw ≈ 0)
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
    this._quistCaptured = quistCaptured;
    this.setQuistVisible(quistCaptured);
    this._phase = 'exfilArriving';
    this.exfilBoardedSignalled = false;
    this.exfilClearSignalled = false;
    this.exfilArriveElapsed = 0;
    this.exfilArriveDuration = 1.6;
    this.exfilPulseClock = 0;
    this.currentSpeed = DESERT_CONVOY_CONSTANTS.exfilArriveSpeed;

    // Roll in from south of forecourt smashing into CARGO_PLANE.forecourtExfilPos
    this.exfilArriveStart.set(this.exfilTargetPos.x, 0, this.exfilTargetPos.z + 24);
    this.placeConvoy(this.exfilArriveStart, 0, 0.65, 0, true);
    this.stowGunOnParkedTruck();
    this.startEngineLoop(1.18);
    this.ctx.audio?.play?.('vehicle_horn', { position: this.exfilTargetPos, volume: 0.85 });
    this.ctx.hud?.feed?.('CONVOY INBOUND — GET TO THE EXFIL TRUCK!', '#ffcf6e');
  }

  startExfilChase(quistCaptured: boolean): void {
    this.ensureBuilt();
    this.ensureRegistered();
    this.clearExfilPrompt();

    this.root.visible = true;
    this._quistCaptured = quistCaptured;
    this.setQuistVisible(quistCaptured);
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
    for (let i = 0; i < n; i++) {
      // Mix agile dirt-bikes (~65%) and scrap pickup technicals (~35%)
      const isTruck = n >= 2 && (i % 3 === 1);
      const kind: BanditVehicleKind = isTruck ? 'truck' : 'bike';
      const side = i % 2 === 0 ? -1 : 1;
      const spreadX = side * rand(14, 34) + rand(-4, 4);

      if (phase === 'approach') {
        const spawnZ = Math.max(DESERT_Z.wallLine + 14, mid.z - rand(38, 66) - i * 5);
        const spawnPos = new THREE.Vector3(clamp(mid.x + spreadX, -76, 76), 0, spawnZ);
        const bv = this.spawnBanditVehicle(kind, spawnPos, Math.PI, 'approach');
        bv.preferredSide = side;
        bv.preferredLead = rand(14, 32);
      } else {
        // Exfil pursuers emerge behind/flanking the southbound convoy (lower Z, chasing +Z)
        const spawnZ = mid.z - rand(24, 48) - i * 6;
        const spawnPos = new THREE.Vector3(clamp(mid.x + spreadX * 0.7, -55, 55), 0, spawnZ);
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
    }

    if (this._phase !== 'idle') {
      this.updateTruckVisuals(step);
      this.updateAllyGunners(step);
    }

    if (this._mounted) {
      this.updateTurretControl(step);
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
    this.clearBanditsAndWrecks();

    if (this.registeredOn) {
      this.registeredOn.removeExtra(this);
      this.registeredOn = null;
    }

    this._phase = 'idle';
    this.pathDist = 0;
    this.currentSpeed = 0;
    this._hull = this.maxHull;
    this._quistCaptured = false;
    this._banditVehiclesDestroyed = 0;
    this._wallLoopPasses = 0;
    this._wallLoopHitScore = 0;
    this.heat.value = 0;
    this.heat.overheated = false;
    this.roundCooldown = 0;
    this.approachDoneSignalled = false;
    this.wallLoopReadySignalled = false;
    this.exfilBoardedSignalled = false;
    this.exfilClearSignalled = false;

    this.setQuistVisible(false);
    this.root.visible = false;
    this.gun?.hide();
    if (this.shieldPivot) this.shieldPivot.visible = false;
    if (this.hud) this.hud.root.classList.remove('on');
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
    for (const bv of [...this._bandits]) {
      if (!bv.alive) continue;
      const d = Math.max(0, bv.position.distanceTo(center) - 1.2);
      if (d > spec.radius) continue;
      const falloff = 1 - (d / spec.radius) * (1 - (def?.edgeDamage ?? 0.35));
      const dealt = spec.instakill ? bv.maxHp : spec.damage * falloff * 1.35;
      this.damageBandit(bv, dealt, spec.source, bv.center);
      hit++;
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
    for (const bv of [...this._bandits]) {
      if (!bv.alive) continue;
      if (bv.position.distanceTo(at) <= radius + 2.0) {
        this.damageBandit(bv, damage * 1.6, 'frame_stomp', bv.center);
        hit++;
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
    this.ctx.audio?.play?.('impact_metal', { position: pos, volume: 0.72, pitchJitter: 0.1 });
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
      this.ctx.audio?.play?.('vehicle_explode', { position: pos, volume: 0.9 });
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
   * Fires a single heavy `.50 cal` round from the player's truck turret:
   * - Tests generous OBB hitboxes on all live Saltblood bikes & technicals.
   * - Calls `ctx.combat.fireRay` (`source: 'emplacement'`, `damage: 55`) to shred Tier-0 sheet-metal
   *   wall panels, topple watchtowers, blow fuel drums, and punch through gaps into Saltbloods behind!
   * - Also drives localized Tier-0 structural blast & impact sparks/dust when hitting world surfaces.
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

    const maxRange = DESERT_CONVOY_CONSTANTS.turretMaxRange;
    const worldHit = this.ctx.physics?.raycast?.(_muzzle, _dir, maxRange, CG.World) ?? null;
    const hitOwnBanditCollider =
      worldHit?.collider != null && this.banditByCollider.has(worldHit.collider.handle);
    const solidWallDist = worldHit && !hitOwnBanditCollider ? worldHit.distance : maxRange;

    // 1. Check Saltblood bandit vehicle locational OBB hitboxes
    let bestBanditDist = solidWallDist;
    let hitBandit: BanditVehicle | null = null;
    let hitZone: BanditHitZone | null = null;

    for (let i = 0; i < this._bandits.length; i++) {
      const bv = this._bandits[i]!;
      if (!bv.alive) continue;
      _invQ.copy(bv.root.quaternion).invert();
      _localOrigin.copy(_muzzle).sub(bv.position).applyQuaternion(_invQ);
      _localDir.copy(_dir).applyQuaternion(_invQ);

      for (let zIdx = 0; zIdx < bv.zones.length; zIdx++) {
        const z = bv.zones[zIdx]!;
        if (z.destroyed && z.kind !== 'chassis') continue;
        const d = rayLocalBoxDist(_localOrigin, _localDir, z.offset, z.halfExtents, bestBanditDist);
        if (d >= 0 && d < bestBanditDist) {
          bestBanditDist = d;
          hitBandit = bv;
          hitZone = z;
        }
      }
    }

    let hitSomething = false;

    if (hitBandit && hitZone) {
      hitSomething = true;
      _hitPt.copy(_muzzle).addScaledVector(_dir, bestBanditDist);
      this.damageBanditZone(hitBandit, hitZone, DESERT_CONVOY_CONSTANTS.turretDamage, _hitPt);
      this.ctx.fx?.tracer?.(_muzzle, _hitPt, 'heavy');
      if (this._phase === 'wallLoop') {
        this.recordWallLoopHit(2);
      }
    } else {
      // 2. Fire through CombatSystem (`source: 'emplacement'`, `damage: 55`) for enemies, explosives, & Tier-0 panels!
      const shotResult = this.ctx.combat?.fireRay?.(_muzzle, _dir, this.shotSpec);
      if (shotResult) {
        if (shotResult.hitEnemy) {
          hitSomething = true;
          if (this._phase === 'wallLoop') this.recordWallLoopHit(shotResult.killed ? 3 : 1);
        }
        _hitPt.copy(shotResult.end);
      } else {
        _hitPt.copy(_muzzle).addScaledVector(_dir, solidWallDist);
        this.ctx.fx?.tracer?.(_muzzle, _hitPt, 'heavy');
      }

      // 3. Structural destruction oomph against Tier-0 wall panels, watchtowers & fuel drums
      if (worldHit && !hitOwnBanditCollider) {
        hitSomething = true;
        if (!shotResult && worldHit.collider) {
          this.ctx.world?.objects?.damageExplosive?.(
            worldHit.collider,
            DESERT_CONVOY_CONSTANTS.turretDamage,
            'emplacement',
          );
          this.ctx.world?.objects?.destruction?.damageCollider?.(
            worldHit.collider,
            DESERT_CONVOY_CONSTANTS.turretDamage,
            'emplacement',
            worldHit.point,
          );
        }
        // Localized Tier-0 structural splash rips adjacent corrugated panels & watchtower legs cleanly
        this.ctx.world?.objects?.destruction?.blast?.(worldHit.point, 1.35, 30, 'emplacement');
        this.ctx.fx?.sparks?.(worldHit.point, worldHit.normal, 7, 0xffc864);
        this.ctx.fx?.dust?.(worldHit.point, worldHit.normal, 1.25);

        if (this._phase === 'wallLoop' && Math.abs(worldHit.point.z - DESERT_Z.wallLine) <= 14) {
          this.recordWallLoopHit(1);
        }
      }
    }

    // Visuals, brass ejection, recoil kick & punchy .50 cal audio
    this.shotsFired++;
    if (this.shotsFired % 2 === 1) {
      this.ctx.fx?.muzzleFlash?.(_muzzle, _dir, 'hmg');
    }
    if (this.shotsFired % 2 === 0 && gun) {
      _casing.set(-_dir.z, rand(1.1, 2.0), _dir.x).multiplyScalar(1.55);
      this.ctx.fx?.shellCasing?.(gun.root.position, _casing, 'cannon');
    }
    gun?.recoil(0.055);
    this.ctx.audio?.play?.('hmg_shot', { pitch: 0.96, pitchJitter: 0.04 });
    this.ctx.camera?.kick?.(rand(0.002, 0.006), rand(-0.004, 0.004));
    this.ctx.camera?.addTrauma?.(0.038);

    return hitSomething;
  }

  /** Spawns a single Saltblood bandit vehicle (public for deterministic testing). */
  spawnBanditVehicle(
    kind: BanditVehicleKind,
    pos: THREE.Vector3,
    yaw = Math.PI,
    behavior: BanditBehavior = 'approach',
  ): BanditVehicle {
    this.ensureBuilt();
    const id = this.nextBanditId++;

    let root: THREE.Group;
    let body: THREE.Group;
    let wheels: THREE.Object3D[];
    let gunnerPivot: THREE.Object3D | null = null;
    let maxHp: number;
    let zones: BanditHitZone[];
    let halfExtents: THREE.Vector3;

    if (kind === 'bike') {
      const vis = buildBanditBikeVisual(this.materials);
      root = vis.root;
      body = vis.body;
      wheels = vis.wheels;
      maxHp = DESERT_CONVOY_CONSTANTS.bikeMaxHp;
      zones = [
        {
          id: 'rider',
          kind: 'rider',
          offset: new THREE.Vector3(0, 1.32, 0.08),
          halfExtents: new THREE.Vector3(0.68, 0.7, 0.78),
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
    } else {
      const vis = buildBanditTruckVisual(this.materials);
      root = vis.root;
      body = vis.body;
      wheels = vis.wheels;
      gunnerPivot = vis.gunnerPivot;
      maxHp = DESERT_CONVOY_CONSTANTS.truckMaxHp;
      zones = [
        {
          id: 'gunner',
          kind: 'gunner',
          offset: new THREE.Vector3(0, 1.9, 1.38),
          halfExtents: new THREE.Vector3(0.76, 0.76, 0.78),
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
      position: p,
      velocity: new THREE.Vector3(),
      center: new THREE.Vector3(p.x, kind === 'truck' ? 1.25 : 0.9, p.z),
      yaw,
      roll: 0,
      pitch: 0,
      speed: kind === 'bike' ? 16 : 11,
      hp: maxHp,
      maxHp,
      alive: true,
      gunnerAlive: kind === 'truck',
      zones,
      collider,
      weavePhase: rand(0, Math.PI * 2),
      weaveAmp: kind === 'bike' ? rand(5, 10) : rand(2, 4.5),
      weaveFreq: kind === 'bike' ? rand(1.4, 2.2) : rand(0.65, 1.05),
      preferredSide: Math.random() < 0.5 ? -1 : 1,
      preferredLead: behavior === 'exfil' ? rand(-18, -9) : rand(14, 28),
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

  /** Applies locational zone damage to a Saltblood bike or technical. Returns true if destroyed. */
  damageBanditZone(
    bv: BanditVehicle,
    zone: BanditHitZone,
    amount: number,
    hitPt?: THREE.Vector3,
    source = 'emplacement',
  ): boolean {
    if (!bv.alive || amount <= 0) return false;
    const pt = hitPt ?? bv.center;

    zone.hp = Math.max(0, zone.hp - amount);
    const hullMult = zone.kind === 'chassis' ? 1 : zone.kind === 'rider' ? 1.7 : zone.kind === 'engine' ? 1.4 : 0.85;
    bv.hp = Math.max(0, bv.hp - amount * hullMult);

    const isWeak = zone.kind !== 'chassis';
    this.ctx.fx?.sparks?.(pt, UP, isWeak ? 12 : 6, isWeak ? 0xffbb33 : 0xffaa55);
    this.ctx.fx?.chips?.(pt, 0xff9a38, isWeak ? 8 : 5);
    this.ctx.hud?.hitMarker?.(bv.hp <= 0 || zone.hp <= 0 ? 'kill' : isWeak ? 'armorThrough' : 'armor');
    this.ctx.audio?.play?.(isWeak ? 'vehicle_weak_point' : 'hit_marker_armor', { position: pt, volume: 0.72 });

    if (zone.hp <= 0 && !zone.destroyed) {
      zone.destroyed = true;
      if (zone.kind === 'rider') {
        this.destroyBandit(bv, 'rider_flip', source);
        return true;
      }
      if (zone.kind === 'engine') {
        this.destroyBandit(bv, 'engine_blast', source);
        return true;
      }
      if (zone.kind === 'gunner') {
        bv.gunnerAlive = false;
        if (bv.gunnerPivot) bv.gunnerPivot.visible = false;
        this.ctx.hud?.feed?.('TECHNICAL GUNNER ELIMINATED!', '#ffcf6e');
      } else if (zone.kind === 'tire') {
        this.ctx.audio?.play?.('plate_destroyed', { position: pt, volume: 0.8 });
        bv.speed *= 0.72;
      }
    }

    if (bv.hp <= 0) {
      this.destroyBandit(bv, bv.kind === 'bike' ? 'bike_flip' : 'truck_blast', source);
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

    // Player's heavy .50 cal gun & desert gunshield
    this.gun = new Gun(this.materials, this.ctx.render.scene, HMG);
    const sh = buildDesertTurretShield(this.materials);
    this.shieldPivot = sh.pivot;
    this.heatSleeve = sh.heatSleeve;
    this.shieldPivot.visible = false;
    this.ctx.render.scene.add(this.shieldPivot);

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

  // -----------------------------------------------------------------------------------------------
  // Turret Mount / Dismount
  // -----------------------------------------------------------------------------------------------

  private mountTurret(initialYaw: number, initialPitch: number): void {
    if (this._mounted) return;
    this._mounted = true;
    this._yaw = wrapAngle(initialYaw);
    this._pitch = clamp(initialPitch, DESERT_CONVOY_CONSTANTS.pitchMin, DESERT_CONVOY_CONSTANTS.pitchMax);
    this._zoomed = false;

    const { camera, player, weapons, audio } = this.ctx;
    weapons?.setHolstered?.(true);
    const truckPos = this.getTruckPosition(_tmp);
    player.park(truckPos, true);
    player.interceptor = (dmg: PlayerDamage): boolean => {
      this.damageConvoyHull(dmg.amount, dmg.from, dmg.source);
      return true;
    };

    camera.setSeat(this.seatView);
    camera.setZoom(DESERT_CONVOY_CONSTANTS.turretFov);

    this.gun?.snap(this._yaw, this._pitch);
    if (this.shieldPivot) this.shieldPivot.visible = true;
    this.syncTurretTransforms(0);

    audio?.play?.('weapon_draw_heavy', { volume: 0.78 });
    this.hud?.root.classList.add('on');
  }

  private dismountTurret(lethal: boolean, keepGunStowed: boolean): void {
    if (!this._mounted) {
      if (!keepGunStowed) {
        this.gun?.hide();
        if (this.shieldPivot) this.shieldPivot.visible = false;
      }
      return;
    }
    this._mounted = false;
    this._zoomed = false;

    const { camera, player, weapons } = this.ctx;
    player.interceptor = null;
    camera.setSeat(null);
    camera.setZoom(null);
    player.unpark(lethal ? 0 : 0.5);
    weapons?.setHolstered?.(false);

    if (!keepGunStowed) {
      this.gun?.hide();
      if (this.shieldPivot) this.shieldPivot.visible = false;
    }
    this.hud?.root.classList.remove('on');
  }

  private stowGunOnParkedTruck(): void {
    if (!this.playerTruck) return;
    this._yaw = this.playerTruck.yaw;
    this._pitch = -0.1;
    this.gun?.snap(this._yaw, this._pitch);
    if (this.shieldPivot) this.shieldPivot.visible = true;
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
    // Ease-out slide into the Cargo Plane forecourt and swing around facing South (Math.PI)
    const ease = 1 - (1 - t) * (1 - t);
    _tmp.lerpVectors(this.exfilArriveStart, this.exfilTargetPos, ease);
    const yaw = lerp(0, Math.PI, clamp((t - 0.45) / 0.55, 0, 1));
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
      this.ui?.hint?.('', 0);
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
    this.currentSpeed = speed;
    this.pathDist += speed * dt;

    if (this.pathDist <= this.exfilPath.length) {
      this.exfilPath.sample(this.pathDist, _tmp, _tan);
    } else {
      // Keep cruising south across the open desert after path end for the scenic ending cutscene!
      this.exfilPath.sample(this.exfilPath.length, _tmp, _tan);
      const extra = this.pathDist - this.exfilPath.length;
      _tmp.z += extra;
      _tan.set(0, 0, 1);
    }

    const yaw = Math.atan2(-_tan.x, -_tan.z);
    // Tighten lateral formation inside Surplus (z < 64), widen smoothly back to full desert column past wall!
    const spreadScale = _tmp.z < DESERT_Z.wallLine + 4 ? 0.58 : 1.0;
    this.placeConvoy(_tmp, yaw, spreadScale, dt, false);

    // Raise `dr:exfil_clear` once clear of the outer wall (z >= 125)
    if (!this.exfilClearSignalled && _tmp.z >= DESERT_CONVOY_CONSTANTS.exfilClearZ) {
      this.exfilClearSignalled = true;
      this.runner?.signal?.('dr:exfil_clear');
    }

    // Keep pursuing Saltbloods trickling in while racing out through Surplus (until clear)
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

      // Spin all 4 wheels according to distance travelled
      const wSpin = -(spd / 0.54) * dt;
      for (let i = 0; i < t.wheels.length; i++) {
        t.wheels[i]!.rotation.x += wSpin;
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

      // Aim flanker turret smoothly toward target in truck local space
      const dx = targetPos.x - t.position.x;
      const dz = targetPos.z - t.position.z;
      const worldYaw = Math.atan2(-dx, -dz);
      const localYaw = wrapAngle(worldYaw - t.yaw);
      t.allyTurret.rotation.y = dampAngle(t.allyTurret.rotation.y, localYaw, 6, dt);

      t.allyFireCooldown -= dt;
      if (t.allyFireCooldown <= 0) {
        t.allyFireCooldown = rand(0.28, 0.58);
        // Compute world muzzle position of ally gun
        const cy = Math.cos(t.yaw);
        const sy = Math.sin(t.yaw);
        const turretWorldX = t.position.x + 1.48 * sy;
        const turretWorldZ = t.position.z + 1.48 * cy;
        _tmp.set(turretWorldX - Math.sin(worldYaw) * 1.15, 2.05, turretWorldZ - Math.cos(worldYaw) * 1.15);
        _tmp2.copy(targetPos);
        _tmp2.x += rand(-0.8, 0.8);
        _tmp2.y += rand(-0.3, 0.5);
        _tmp2.z += rand(-0.8, 0.8);
        _dir.subVectors(_tmp2, _tmp).normalize();

        this.ctx.fx?.tracer?.(_tmp, _tmp2, 'heavy');
        this.ctx.fx?.muzzleFlash?.(_tmp, _dir, 'hmg');
        this.ctx.audio?.play?.('mounted_gun', { position: _tmp, volume: 0.45, pitchJitter: 0.08 });

        // Light chip damage (NEVER steals the killing blow: leaves bandit at >= 15 HP for player!)
        if (targetBandit && targetBandit.alive && targetBandit.hp > 20) {
          targetBandit.hp = Math.max(15, targetBandit.hp - 5);
          this.ctx.fx?.sparks?.(_tmp2, UP, 3, 0xffaa44);
        }
      }
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Player Heavy Gunner Turret Control
  // -----------------------------------------------------------------------------------------------

  private updateTurretControl(dt: number): void {
    const { input, player, camera, audio } = this.ctx;

    // Safe dual-path look input (works with live PlayerSystem AND standalone tests)
    const flX = input.frameLook?.x ?? 0;
    const flY = input.frameLook?.y ?? 0;
    const consumed = input.consumeLook?.();
    const dx = consumed && (consumed.x !== 0 || consumed.y !== 0) ? consumed.x : flX;
    const dy = consumed && (consumed.x !== 0 || consumed.y !== 0) ? consumed.y : flY;

    const sens = (player.sensitivity ?? 0.0022) * (player.lookScale ?? 1) * (this._zoomed ? 0.62 : 1);
    this._yaw = wrapAngle(this._yaw - dx * sens);
    this._pitch = clamp(
      this._pitch - dy * sens * (player.invertY ? -1 : 1),
      DESERT_CONVOY_CONSTANTS.pitchMin,
      DESERT_CONVOY_CONSTANTS.pitchMax,
    );

    // Optional RMB tactical zoom
    const wantZoom = input.isDown('aim');
    if (wantZoom !== this._zoomed) {
      this._zoomed = wantZoom;
      camera.setZoom(this._zoomed ? DESERT_CONVOY_CONSTANTS.turretZoomFov : DESERT_CONVOY_CONSTANTS.turretFov);
      audio?.play?.('autocannon_zoom', { volume: 0.45, pitch: this._zoomed ? 1.08 : 0.92 });
    }

    this.syncTurretTransforms(dt);

    // Trigger & barrel overheat/venting loop
    const fireHeld = input.isDown('fire');
    if (fireHeld && this.heat.overheated && input.pressed('fire')) {
      audio?.play?.('weapon_dry', { volume: 0.7 });
    }

    const shooting = fireHeld && !this.heat.overheated;
    if (shooting) {
      this.roundCooldown -= dt;
      let burst = 0;
      while (this.roundCooldown <= 0 && burst < 4) {
        this.roundCooldown += 1 / DESERT_CONVOY_CONSTANTS.turretRps;
        burst++;
        this.fireSingleShot();
        if (this.heat.shot()) {
          audio?.play?.('steam_burst', { position: this._turretMuzzle, volume: 0.85 });
          this.ctx.fx?.smoke?.(this._turretMuzzle, 0xd8dce4, 0.8, 0.95);
          break;
        }
      }
      if (this.roundCooldown < 0) this.roundCooldown = 0;
    } else {
      this.roundCooldown = Math.max(0, this.roundCooldown - dt);
    }
    this.heat.cool(dt, shooting);

    // Thermal barrel glow sleeve
    if (this.heatSleeve) {
      const mat = this.heatSleeve.material as THREE.MeshBasicMaterial;
      const glow = clamp((this.heat.value - 0.32) / 0.68);
      mat.opacity = this.heat.overheated ? 0.55 + Math.sin(performance.now() * 0.025) * 0.25 : glow * 0.65;
    }
  }

  private syncTurretTransforms(dt: number): void {
    const pt = this.playerTruck;
    if (pt) {
      const cy = Math.cos(pt.yaw);
      const sy = Math.sin(pt.yaw);
      // Turret ring sits in the open cargo bed at local (0, 2.24, +1.48)
      this._turretPivot.set(
        pt.position.x + 1.48 * sy,
        pt.root.position.y + 2.24,
        pt.position.z + 1.48 * cy,
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

    if (this.shieldPivot) {
      this.shieldPivot.position.copy(this._turretPivot);
      this.shieldPivot.rotation.set(0, this._yaw, 0);
    }

    if (!this._mounted) return;

    const cp = Math.cos(this._pitch);
    const sy = Math.sin(this._yaw);
    const cy = Math.cos(this._yaw);
    _aim.set(-sy * cp, Math.sin(this._pitch), -cy * cp);
    _right.set(cy, 0, -sy);
    _camUp.crossVectors(_right, _aim);
    _eye.copy(this._turretPivot).addScaledVector(_camUp, 0.36).addScaledVector(_aim, -0.82);

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
      let cruiseSpeed = bv.kind === 'bike' ? 17.5 : 11.5;

      if (bv.behavior === 'sideGate') {
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
        cruiseSpeed = bv.kind === 'bike' ? 21 : 17.5;
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
      const leanScale = bv.kind === 'bike' ? 0.24 : 0.06;
      bv.roll = damp(bv.roll, clamp(-turnRate * leanScale, -0.42, 0.42), 8, dt);

      const bounce = Math.sin(bv.age * 9 + bv.id) * (bv.kind === 'bike' ? 0.08 : 0.05);
      bv.root.position.set(bv.position.x, bounce, bv.position.z);
      bv.root.rotation.set(0, bv.yaw, 0);
      bv.body.rotation.set(0, 0, bv.roll);
      bv.center.set(bv.position.x, bv.kind === 'truck' ? 1.25 : 0.9, bv.position.z);

      // Update on-foot static collider transform
      if (bv.collider) {
        _q.setFromAxisAngle(UP, bv.yaw);
        bv.collider.setTranslation(_tmp2.set(bv.position.x, bv.kind === 'truck' ? 1.0 : 0.8, bv.position.z));
        bv.collider.setRotation(_q);
      }

      // Spin wheels
      const wheelR = bv.kind === 'bike' ? 0.38 : 0.5;
      const wSpin = -(moveSpd / wheelR) * dt;
      for (let w = 0; w < bv.wheels.length; w++) bv.wheels[w]!.rotation.x += wSpin;

      // Aim bed gunner on technicals toward player/convoy
      const aimTarget = this._mounted ? mid : (this.ctx.player?.position ?? mid);
      if (bv.gunnerPivot && bv.gunnerAlive) {
        const gYaw = Math.atan2(-(aimTarget.x - bv.position.x), -(aimTarget.z - bv.position.z));
        bv.gunnerPivot.rotation.y = dampAngle(bv.gunnerPivot.rotation.y, wrapAngle(gYaw - bv.yaw), 7, dt);
      }

      // Desert tire dust
      if (moveSpd > 2.5) {
        bv.dustTimer -= dt;
        if (bv.dustTimer <= 0) {
          bv.dustTimer = 0.2;
          this.ctx.fx?.dust?.(bv.position, UP, bv.kind === 'truck' ? 1.1 : 0.7);
        }
      }

      // Smoke heavily below 50% HP!
      if (bv.hp < bv.maxHp * 0.5) {
        bv.smokeTimer -= dt;
        if (bv.smokeTimer <= 0) {
          bv.smokeTimer = 0.22;
          _tmp2.copy(bv.position).addScaledVector(UP, bv.kind === 'truck' ? 1.45 : 0.85);
          this.ctx.fx?.smoke?.(_tmp2, 0x22201e, bv.kind === 'truck' ? 1.25 : 0.8, 1.2);
        }
      }

      // Fire tracer bursts at convoy / player when in range
      const distToTargetPlayer = bv.position.distanceTo(aimTarget);
      const canShoot = bv.kind === 'bike' || bv.gunnerAlive;
      if (canShoot && distToTargetPlayer <= 78) {
        bv.fireCooldown -= dt;
        if (bv.fireCooldown <= 0) {
          bv.fireCooldown = bv.kind === 'truck' ? rand(1.1, 1.9) : rand(1.5, 2.5);
          this.banditFireBurst(bv, aimTarget);
        }
      }
    }
  }

  private banditFireBurst(bv: BanditVehicle, aimTarget: THREE.Vector3): void {
    const muzzlePos = _tmp2.set(
      bv.position.x,
      bv.kind === 'truck' ? 2.1 : 1.25,
      bv.position.z,
    );
    const impactPos = _impact.set(
      aimTarget.x + rand(-1.8, 1.8),
      aimTarget.y + rand(0.9, 2.1),
      aimTarget.z + rand(-1.8, 1.8),
    );
    this.ctx.fx?.tracer?.(muzzlePos, impactPos, 'enemy');
    this.ctx.audio?.play?.(bv.kind === 'truck' ? 'mounted_gun' : 'enemy_smg', {
      position: muzzlePos,
      volume: 0.62,
    });

    const dmg = bv.kind === 'truck' ? 9 : 5;
    if (Math.random() < 0.65) {
      if (this._mounted) {
        this.damageConvoyHull(dmg, muzzlePos, bv.kind === 'truck' ? 'saltblood_technical' : 'saltblood_bike');
      } else if (this.ctx.player?.alive) {
        this.ctx.player.takeDamage({
          amount: dmg,
          type: 'bullet',
          source: bv.kind === 'truck' ? 'saltblood_technical' : 'saltblood_bike',
          from: muzzlePos.clone(),
        });
      }
    }
  }

  private destroyBandit(
    bv: BanditVehicle,
    mode: 'rider_flip' | 'bike_flip' | 'engine_blast' | 'truck_blast',
    source: string,
  ): void {
    if (!bv.alive) return;
    bv.alive = false;
    bv.gunnerAlive = false;
    if (bv.gunnerPivot) bv.gunnerPivot.visible = false;

    const idx = this._bandits.indexOf(bv);
    if (idx >= 0) this._bandits.splice(idx, 1);
    this.removeBanditCollider(bv);

    this._banditVehiclesDestroyed++;
    const pos = bv.position.clone();

    if (bv.kind === 'bike') {
      this.ctx.fx?.explosion?.(pos, { radius: 4.2, kind: 'barrel', scale: 0.95 });
      this.ctx.fx?.sparks?.(pos, UP, 18, 0xffaa33);
      this.ctx.audio?.play?.('explosion_small', { position: pos, volume: 0.85 });
      this.ctx.audio?.play?.('vehicle_explode', { position: pos, volume: 0.65, pitch: 1.35 });
      this.ctx.hud?.feed?.(
        mode === 'rider_flip' ? 'SALTBLOOD RIDER DOWN — BIKE FLIPPED!' : 'SALTBLOOD BIKE DESTROYED!',
        '#ffcf6e',
      );
      if (!isGuest(this.ctx)) {
        this.ctx.progression?.award?.(DESERT_CONVOY_CONSTANTS.bikeScore, 'BANDIT BIKE', pos);
      }
    } else {
      this.ctx.fx?.explosion?.(pos, { radius: 7.2, kind: 'barrel', scale: 1.4 });
      this.ctx.fx?.embers?.(pos, 26, 3.2);
      this.ctx.render?.lights?.flash?.(pos, 0xff8828, 28, 38, 0.45);
      this.ctx.audio?.play?.('vehicle_explode', { position: pos, volume: 0.92 });
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
    const vel = new THREE.Vector3(
      bv.velocity.x * 0.55 + rand(-5, 5),
      bv.kind === 'bike' ? rand(8.5, 11.5) : rand(5.5, 8.2),
      bv.velocity.z * 0.55 + rand(-5, 5),
    );
    const angVel = new THREE.Vector3(
      bv.kind === 'bike' ? rand(-9, 9) : rand(-4.5, 4.5),
      rand(-4, 4),
      bv.kind === 'bike' ? rand(-10, 10) : rand(-5.5, 5.5),
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
    hud.speed.set(`${kmh} KM/H`);

    if (this._phase === 'approach') {
      hud.stage.set('APPROACH — OPEN DUNES');
    } else if (this._phase === 'wallLoop') {
      hud.stage.set('WALL BROADSIDE — SHRED SURPLUS');
    } else if (this._phase === 'exfilChase') {
      hud.stage.set(this._quistCaptured ? 'EXFIL — QUIST SECURED' : 'EXFIL — FULL THROTTLE');
    } else {
      hud.stage.set('CONVOY STANDBY');
    }

    const hullFrac = clamp(this._hull / this.maxHull);
    hud.hullText.set(`${Math.ceil(this._hull)} / ${this.maxHull}`);
    hud.hullFill.style.transform = `scaleX(${hullFrac.toFixed(4)})`;
    hud.hullFill.classList.toggle('low', hullFrac < 0.3);

    const heatPct = Math.round(this.heat.value * 100);
    hud.heatText.set(this.heat.overheated ? 'OVERHEAT — VENTING' : `${heatPct}%`);
    hud.heatText.el.classList.toggle('dr-cv-overheat', this.heat.overheated);
    hud.heatFill.style.transform = `scaleX(${clamp(this.heat.value).toFixed(4)})`;
    hud.heatFill.classList.toggle('hot', this.heat.overheated || this.heat.value > 0.8);

    hud.reticle.classList.toggle('zoom', this._zoomed);
  }
}
