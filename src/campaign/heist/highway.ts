/**
 * Act 4 On-Rails Highway `.50 cal` Humvee Escape ("Bank Run", Mission 4).
 *
 * Streams the 4-lane Coastal Elevated Expressway treadmill past the armored Bureau Getaway Humvee
 * at `HIGHWAY_ORIGIN = [128, 12, 0]`, mounts the player onto the 360-degree roof M2 `.50 cal`
 * turret with overheat/venting and tactical zoom, drives Wave 1 (Police Interceptors with
 * locational tire/engine/driver destruction) and Wave 2 (SWAT BearCat vans with shootable RPGs +
 * chain-detonating Explosive Fuel Tanker Trucks), cooperates with `GunshipBoss` (AUDITOR-1), and
 * finishes with the Port Extraction Tunnel sprint and white-out transition.
 */
import * as THREE from 'three';
import type { Ctx, LoopHandle, PlayerDamage, SeatView } from '../../core/contracts';
import { clamp, damp, dampAngle, lerp, rand, randomInCone, wrapAngle } from '../../core/math';
import { ModelBuilder, ModelMaterials } from '../../progression/modelkit';
import { div, Label, span } from '../../ui/dom';
import { Heat, HMG } from '../../vehicles/emplacement';
import { Gun } from '../../vehicles/guns';
import {
  HIGHWAY_HALF_LEN,
  HIGHWAY_HALF_WIDTH,
  HIGHWAY_LANES,
  HIGHWAY_ORIGIN,
  LV,
} from '../../world/map/bank/plan';

// -------------------------------------------------------------------------------------------------
// Public types & constants
// -------------------------------------------------------------------------------------------------

export type HighwayPhase = 'idle' | 'wave1' | 'wave2' | 'boss' | 'tunnel' | 'complete';
export type PursuerKind = 'cruiser' | 'bearcat' | 'tanker';
export type HitZoneKind = 'tire' | 'engine' | 'cab' | 'tank' | 'chassis';
export type DestructionMode = 'tire_flip' | 'engine_flip' | 'driver_swerve' | 'tanker_blast' | 'chassis_blast';

export interface ShotHitResult {
  distance: number;
  point: THREE.Vector3;
}

export type ExtraShotHandler = (
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
  damage: number,
) => ShotHitResult | boolean | null | void;

export interface PursuerZone {
  readonly id: string;
  readonly kind: HitZoneKind;
  readonly offset: THREE.Vector3;
  readonly halfExtents: THREE.Vector3;
  hp: number;
  readonly maxHp: number;
  destroyed: boolean;
}

export interface HighwayPursuer {
  readonly id: number;
  readonly kind: PursuerKind;
  readonly root: THREE.Group;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  lane: number;
  targetLane: number;
  laneTimer: number;
  targetZ: number;
  hp: number;
  readonly maxHp: number;
  alive: boolean;
  readonly zones: PursuerZone[];
  fireCooldown: number;
  rpgCooldown: number;
  strobePhase: number;
  readonly wheels: THREE.Object3D[];
  readonly strobeRed: THREE.Object3D | null;
  readonly strobeBlue: THREE.Object3D | null;
  readonly rearDoorL: THREE.Object3D | null;
  readonly rearDoorR: THREE.Object3D | null;
  doorsOpen: number;
  yaw: number;
  roll: number;
  smokeTimer: number;
}

export interface HighwayWreck {
  readonly id: number;
  readonly kind: PursuerKind;
  readonly mode: DestructionMode;
  readonly root: THREE.Group;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly angVel: THREE.Vector3;
  age: number;
  maxAge: number;
  exploded: boolean;
  ramActive: boolean;
  swerveDir: number;
  smokeTimer: number;
}

export interface HighwayRpg {
  readonly id: number;
  readonly mesh: THREE.Group;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  hp: number;
  age: number;
  maxAge: number;
  alive: boolean;
  smokeTimer: number;
}

export const HIGHWAY_CONSTANTS = {
  scrollSpeed: 36,
  tunnelSpeed: 46,
  maxHull: 420,
  wave2Heal: 90,
  bossHeal: 110,
  turretRps: 10,
  turretDamage: 55,
  turretSpread: 0.004,
  turretFov: 72,
  turretZoomFov: 44,
  pitchMin: -0.55,
  pitchMax: 0.65,
  heatPerShot: 1 / 72,
  heatCool: 0.28,
  heatVent: 0.4,
  tankerBlastRadius: 16,
  tankerBearcatDamage: 220,
  tunnelDuration: 2.2,
  wave1Count: 8,
  wave2Cruisers: 4,
  wave2Bearcats: 3,
  wave2Tankers: 2,
} as const;

// -------------------------------------------------------------------------------------------------
// Scratch math objects (zero per-frame allocations)
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
const _localOrigin = new THREE.Vector3();
const _localDir = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
const _stepQ = new THREE.Quaternion();
const _euler = new THREE.Euler();

const ALONG_X: readonly [number, number, number] = [0, 0, Math.PI / 2];
const ALONG_Z: readonly [number, number, number] = [Math.PI / 2, 0, 0];

// -------------------------------------------------------------------------------------------------
// Pure geometry helpers
// -------------------------------------------------------------------------------------------------

function raySphereDist(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  center: THREE.Vector3,
  radius: number,
  maxDist: number,
): number {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  if (c <= 0) return 0;
  if (b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= maxDist ? t : -1;
}

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

// -------------------------------------------------------------------------------------------------
// Procedural highway & vehicle models
// -------------------------------------------------------------------------------------------------

interface ScrollItem {
  readonly obj: THREE.Object3D;
  z: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function buildWheelMesh(materials: ModelMaterials, radius: number, width: number): THREE.Group {
  const b = new ModelBuilder();
  b.cyl(radius, radius, width, 12, '#17191d', { rot: ALONG_X });
  b.cyl(radius * 0.54, radius * 0.54, width + 0.04, 10, '#444c56', { rot: ALONG_X });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.box(width + 0.03, radius * 0.16, radius * 0.28, '#262b31', {
      at: [0, Math.cos(a) * radius * 0.88, Math.sin(a) * radius * 0.88],
      rot: [a, 0, 0],
    });
  }
  return materials.group(b);
}

function createExpresswaySignTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext?.('2d');
  if (!g) return null;
  g.fillStyle = '#0f5c36';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#e8f4ee';
  g.lineWidth = 6;
  g.strokeRect(8, 8, 496, 112);
  g.fillStyle = '#f2faf6';
  g.font = 'bold 34px monospace';
  g.textAlign = 'center';
  g.fillText('BRINE COASTAL EXPY', 256, 56);
  g.fillStyle = '#ffd76a';
  g.font = 'bold 26px monospace';
  g.fillText('▲ PORT TUNNEL  //  EXIT 04 ▲', 256, 98);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildHumveeVisual(materials: ModelMaterials): {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Object3D[];
} {
  const root = new THREE.Group();
  root.name = 'heist.humvee';
  const b = new ModelBuilder();
  const MATTE = '#181c22';
  const ARMOR = '#252b34';
  const CRIMSON = '#a82222';
  const GLASS = '#0b141c';
  const GOLD = '#d8a62a';
  const DUFFEL = '#22262c';

  // Lower chassis & armored bumpers (facing -Z)
  b.box(2.26, 0.48, 5.1, MATTE, { at: [0, 0.78, 0] });
  b.box(2.34, 0.24, 0.26, '#343c46', { at: [0, 0.68, -2.62] });
  b.box(2.3, 0.2, 0.22, '#343c46', { at: [0, 0.68, 2.58] });
  // Sloped armored hood (-Z)
  b.box(2.14, 0.56, 1.8, ARMOR, { at: [0, 1.24, -1.62] });
  b.box(1.9, 0.14, 1.5, MATTE, { at: [0, 1.55, -1.55], rot: [0.06, 0, 0] });
  // Crimson Bureau nose stripe & brush guard
  b.box(2.18, 0.12, 0.36, CRIMSON, { at: [0, 1.26, -2.42] });
  for (const s of [-1, 1]) {
    b.box(0.08, 0.65, 0.08, '#3d4550', { at: [s * 0.85, 1.02, -2.64] });
    b.glow(new THREE.BoxGeometry(0.28, 0.14, 0.05), '#ffe6b3', 3.0, { at: [s * 0.76, 1.2, -2.56] });
  }
  // Armored cab & ballistic windshield
  b.box(2.24, 0.96, 1.72, MATTE, { at: [0, 1.56, -0.05] });
  b.box(2.28, 0.14, 1.85, CRIMSON, { at: [0, 1.18, -0.05] });
  b.box(1.94, 0.42, 0.08, GLASS, { at: [0, 1.72, -0.92], rot: [0.24, 0, 0] });
  b.box(2.16, 0.12, 1.66, ARMOR, { at: [0, 2.08, -0.05] });
  // Turret ring on roof
  b.solid(new THREE.TorusGeometry(0.54, 0.075, 6, 16), '#3a424d', { at: [0, 2.15, -0.15], rot: [Math.PI / 2, 0, 0] });
  // Rear cargo bed (+Z) packed with stacked gold bullion duffels!
  for (const s of [-1, 1]) {
    b.box(0.14, 0.62, 1.76, ARMOR, { at: [s * 1.06, 1.32, 1.65] });
    b.box(0.16, 0.12, 1.76, CRIMSON, { at: [s * 1.07, 1.12, 1.65] });
    // Glowing red brake/taillights
    b.glow(new THREE.BoxGeometry(0.32, 0.16, 0.06), '#ff2218', 3.4, { at: [s * 0.84, 1.15, 2.58] });
  }
  b.box(2.18, 0.56, 0.14, MATTE, { at: [0, 1.28, 2.5] });
  b.box(2.0, 0.08, 1.7, '#2d333c', { at: [0, 1.06, 1.64] });
  // Gold bullion duffel bags visible in the bed
  const bagOffsets: readonly (readonly [number, number, number, number])[] = [
    [-0.48, 1.28, 1.32, 0.18],
    [0.44, 1.28, 1.38, -0.22],
    [-0.42, 1.28, 2.02, -0.12],
    [0.46, 1.28, 1.98, 0.25],
    [0.02, 1.56, 1.68, 0.08],
    [-0.18, 1.54, 2.05, -0.35],
  ];
  for (const [bx, by, bz, ry] of bagOffsets) {
    b.box(0.68, 0.34, 0.44, DUFFEL, { at: [bx, by, bz], rot: [0, ry, 0] });
    b.box(0.54, 0.12, 0.28, GOLD, { at: [bx, by + 0.16, bz], rot: [0, ry, 0] });
  }

  const body = materials.group(b);
  root.add(body);

  const wheels: THREE.Object3D[] = [];
  const wheelPos: readonly (readonly [number, number, number])[] = [
    [-1.12, 0.52, -1.62],
    [1.12, 0.52, -1.62],
    [-1.12, 0.52, 1.56],
    [1.12, 0.52, 1.56],
  ];
  for (const [wx, wy, wz] of wheelPos) {
    const w = buildWheelMesh(materials, 0.52, 0.36);
    w.position.set(wx, wy, wz);
    root.add(w);
    wheels.push(w);
  }
  return { root, body, wheels };
}

function buildTurretShield(materials: ModelMaterials): { pivot: THREE.Group; heatSleeve: THREE.Mesh } {
  const pivot = new THREE.Group();
  pivot.name = 'heist.turretShield';
  const b = new ModelBuilder();
  const PLATE = '#242a32';
  const TRIM = '#a82222';
  // Left & right armored wing plates framing an open-top U-shaped barrel sightline
  b.box(0.42, 0.56, 0.05, PLATE, { at: [-0.38, -0.02, -0.46], rot: [0, 0.16, 0] });
  b.box(0.42, 0.56, 0.05, PLATE, { at: [0.38, -0.02, -0.46], rot: [0, -0.16, 0] });
  b.box(0.36, 0.22, 0.05, PLATE, { at: [0, -0.19, -0.46] });
  b.box(0.42, 0.045, 0.06, TRIM, { at: [-0.38, 0.27, -0.46], rot: [0, 0.16, 0] });
  b.box(0.42, 0.045, 0.06, TRIM, { at: [0.38, 0.27, -0.46], rot: [0, -0.16, 0] });
  pivot.add(materials.group(b, materials.nearby));

  // Glowing thermal barrel sleeve along -Z
  const sleeveGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.88, 10);
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
  heatSleeve.position.set(0, 0.02, -0.92);
  pivot.add(heatSleeve);
  return { pivot, heatSleeve };
}

function buildCruiserVisual(materials: ModelMaterials): {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  strobeRed: THREE.Object3D;
  strobeBlue: THREE.Object3D;
} {
  const root = new THREE.Group();
  const b = new ModelBuilder();
  const DARK = '#141820';
  const WHITE = '#e6ebf0';
  const GLASS = '#0b131b';
  // Facing -Z (pursuing Humvee northward)
  b.box(2.04, 0.56, 4.7, DARK, { at: [0, 0.72, 0] });
  b.box(2.08, 0.48, 1.85, WHITE, { at: [0, 0.82, 0.08] });
  b.box(1.94, 0.42, 1.55, DARK, { at: [0, 1.02, -1.52] }); // front hood (-Z)
  b.box(1.88, 0.56, 1.85, WHITE, { at: [0, 1.38, 0.14] }); // cab
  b.box(1.74, 0.38, 0.06, GLASS, { at: [0, 1.38, -0.79], rot: [0.34, 0, 0] });
  b.box(1.74, 0.34, 0.06, GLASS, { at: [0, 1.38, 1.07], rot: [-0.34, 0, 0] });
  // Pushbar & headlights
  b.box(1.84, 0.14, 0.14, '#363d46', { at: [0, 0.64, -2.44] });
  for (const s of [-1, 1]) {
    b.box(0.08, 0.48, 0.08, '#363d46', { at: [s * 0.58, 0.82, -2.44] });
    b.glow(new THREE.BoxGeometry(0.32, 0.14, 0.05), '#e8f4ff', 3.2, { at: [s * 0.74, 0.88, -2.36] });
    b.glow(new THREE.BoxGeometry(0.32, 0.12, 0.05), '#ff2a1e', 2.4, { at: [s * 0.72, 0.88, 2.36] });
  }
  // Rooftop lightbar mount
  b.box(1.26, 0.08, 0.24, '#242930', { at: [0, 1.7, 0.08] });
  root.add(materials.group(b));

  const redMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff1e1e').multiplyScalar(3.2), toneMapped: false });
  const blueMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#1e78ff').multiplyScalar(3.2), toneMapped: false });
  const strobeRed = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.22), redMat);
  strobeRed.position.set(-0.3, 1.79, 0.08);
  const strobeBlue = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.22), blueMat);
  strobeBlue.position.set(0.3, 1.79, 0.08);
  root.add(strobeRed, strobeBlue);

  const wheels: THREE.Object3D[] = [];
  for (const [wx, wy, wz] of [
    [-1.02, 0.42, -1.45],
    [1.02, 0.42, -1.45],
    [-1.02, 0.42, 1.42],
    [1.02, 0.42, 1.42],
  ] as const) {
    const w = buildWheelMesh(materials, 0.42, 0.28);
    w.position.set(wx, wy, wz);
    root.add(w);
    wheels.push(w);
  }
  return { root, wheels, strobeRed, strobeBlue };
}

function buildBearcatVisual(materials: ModelMaterials): {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  strobeRed: THREE.Object3D;
  strobeBlue: THREE.Object3D;
  rearDoorL: THREE.Object3D;
  rearDoorR: THREE.Object3D;
} {
  const root = new THREE.Group();
  const b = new ModelBuilder();
  const NAVY = '#182234';
  const NAVY_HI = '#24324a';
  const STEEL = '#303844';
  const GLASS = '#0b141e';

  // Heavy SWAT armored van body (facing -Z)
  b.box(2.56, 0.72, 6.4, STEEL, { at: [0, 0.9, 0] });
  b.box(2.52, 1.38, 4.4, NAVY, { at: [0, 1.88, 0.78] });
  b.box(2.32, 0.96, 1.85, NAVY_HI, { at: [0, 1.54, -2.18] }); // armored engine nose
  b.box(2.2, 0.46, 0.1, GLASS, { at: [0, 2.1, -1.35], rot: [0.18, 0, 0] });
  b.box(2.56, 0.14, 0.34, '#c48f22', { at: [0, 1.32, -3.12] }); // tactical ram bar
  for (const s of [-1, 1]) {
    b.glow(new THREE.BoxGeometry(0.32, 0.18, 0.06), '#e8f4ff', 3.2, { at: [s * 0.88, 1.34, -3.16] });
    b.box(0.08, 0.24, 3.8, '#394658', { at: [s * 1.3, 1.6, 0.75] });
  }
  // Silhouette SWAT shooters inside rear compartment (visible when rear doors swing open)
  for (const sx of [-0.55, 0.55]) {
    b.box(0.46, 0.9, 0.34, '#10141c', { at: [sx, 1.56, 2.35] });
    b.solid(new THREE.SphereGeometry(0.18, 8, 6), '#10141c', { at: [sx, 2.14, 2.35] });
    b.glow(new THREE.BoxGeometry(0.2, 0.07, 0.06), '#ff3824', 3.0, { at: [sx, 2.15, 2.16] });
  }
  root.add(materials.group(b));

  // Swinging rear armored doors
  const doorGeo = new THREE.BoxGeometry(1.16, 1.34, 0.12);
  const doorMat = materials.solid;
  const rearDoorL = new THREE.Group();
  rearDoorL.position.set(-1.18, 1.86, 2.98);
  const dMeshL = new THREE.Mesh(doorGeo, doorMat);
  dMeshL.position.set(0.58, 0, 0);
  rearDoorL.add(dMeshL);

  const rearDoorR = new THREE.Group();
  rearDoorR.position.set(1.18, 1.86, 2.98);
  const dMeshR = new THREE.Mesh(doorGeo, doorMat);
  dMeshR.position.set(-0.58, 0, 0);
  rearDoorR.add(dMeshR);
  root.add(rearDoorL, rearDoorR);

  const redMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff1e1e').multiplyScalar(3.2), toneMapped: false });
  const blueMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#2280ff').multiplyScalar(3.2), toneMapped: false });
  const strobeRed = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.24), redMat);
  strobeRed.position.set(-0.42, 2.66, -0.8);
  const strobeBlue = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.24), blueMat);
  strobeBlue.position.set(0.42, 2.66, -0.8);
  root.add(strobeRed, strobeBlue);

  const wheels: THREE.Object3D[] = [];
  for (const [wx, wy, wz] of [
    [-1.28, 0.56, -2.05],
    [1.28, 0.56, -2.05],
    [-1.28, 0.56, 1.85],
    [1.28, 0.56, 1.85],
  ] as const) {
    const w = buildWheelMesh(materials, 0.56, 0.38);
    w.position.set(wx, wy, wz);
    root.add(w);
    wheels.push(w);
  }
  return { root, wheels, strobeRed, strobeBlue, rearDoorL, rearDoorR };
}

function buildTankerVisual(materials: ModelMaterials): {
  root: THREE.Group;
  wheels: THREE.Object3D[];
} {
  const root = new THREE.Group();
  const b = new ModelBuilder();
  const CAB = '#3c434d';
  const STEEL = '#282e36';
  const TANK_RED = '#c8261e';
  const HAZARD = '#e4a820';
  const GLASS = '#0c151f';

  // Heavy industrial frame (facing -Z)
  b.box(2.5, 0.44, 8.8, STEEL, { at: [0, 0.96, 0.2] });
  // Forward tractor cab
  b.box(2.44, 1.85, 2.25, CAB, { at: [0, 2.08, -3.05] });
  b.box(2.2, 0.54, 0.08, GLASS, { at: [0, 2.42, -4.18] });
  for (const s of [-1, 1]) {
    b.glow(new THREE.BoxGeometry(0.32, 0.18, 0.06), '#ffe4a8', 3.0, { at: [s * 0.9, 1.38, -4.2] });
    b.cyl(0.08, 0.08, 2.4, 8, '#58606a', { at: [s * 1.24, 2.4, -2.05] });
  }
  // Massive bright crimson pressurized fuel tank cylinder (+ hazard bands + glowing hazard beacon)
  b.cyl(1.16, 1.16, 6.2, 16, TANK_RED, { at: [0, 2.24, 1.25], rot: ALONG_Z });
  for (const zOff of [-0.95, 1.25, 3.45]) {
    b.cyl(1.2, 1.2, 0.24, 16, HAZARD, { at: [0, 2.24, zOff], rot: ALONG_Z });
  }
  b.glow(new THREE.BoxGeometry(0.45, 0.18, 0.45), '#ff5518', 2.8, { at: [0, 3.52, 1.25] });
  for (const s of [-1, 1]) {
    b.glow(new THREE.BoxGeometry(0.34, 0.16, 0.06), '#ff2214', 2.6, { at: [s * 0.92, 1.02, 4.62] });
  }
  root.add(materials.group(b));

  const wheels: THREE.Object3D[] = [];
  for (const [wx, wy, wz] of [
    [-1.24, 0.58, -3.15],
    [1.24, 0.58, -3.15],
    [-1.24, 0.58, 1.75],
    [1.24, 0.58, 1.75],
    [-1.24, 0.58, 3.25],
    [1.24, 0.58, 3.25],
  ] as const) {
    const w = buildWheelMesh(materials, 0.58, 0.42);
    w.position.set(wx, wy, wz);
    root.add(w);
    wheels.push(w);
  }
  return { root, wheels };
}

function buildRpgMesh(materials: ModelMaterials): THREE.Group {
  const b = new ModelBuilder();
  b.cyl(0.06, 0.06, 0.9, 8, '#363d45', { rot: ALONG_Z });
  b.cyl(0.03, 0.14, 0.34, 8, '#b82a1e', { at: [0, 0, -0.58], rot: ALONG_Z });
  b.glow(new THREE.SphereGeometry(0.18, 8, 6), '#ff7a20', 4.5, { at: [0, 0, 0.5] });
  return materials.group(b);
}

function buildExtractionTunnel(materials: ModelMaterials): THREE.Group {
  const g = new THREE.Group();
  g.name = 'heist.extractionTunnel';
  const b = new ModelBuilder();
  const CONC = '#4c545e';
  const DARK = '#1a2028';
  // Huge portal arch framing the 4-lane expressway
  b.box(3.2, 11.5, 22, CONC, { at: [-HIGHWAY_HALF_WIDTH - 1.2, 5.75, -10] });
  b.box(3.2, 11.5, 22, CONC, { at: [HIGHWAY_HALF_WIDTH + 1.2, 5.75, -10] });
  b.box(HIGHWAY_HALF_WIDTH * 2 + 5.6, 3.2, 22, CONC, { at: [0, 10.6, -10] });
  b.box(HIGHWAY_HALF_WIDTH * 2 + 2, 0.6, 0.8, '#e8a820', { at: [0, 8.95, 1.0] });
  // Bright white-cyan exit light wall inside the tunnel mouth
  b.glow(new THREE.PlaneGeometry(HIGHWAY_HALF_WIDTH * 2, 9.2), '#eaf8ff', 4.2, { at: [0, 4.6, -6] });
  b.box(HIGHWAY_HALF_WIDTH * 2 + 6, 0.5, 22, DARK, { at: [0, 12.2, -10] });
  // Overhead green tunnel lights
  for (let i = -2; i <= 2; i++) {
    b.glow(new THREE.BoxGeometry(1.6, 0.25, 0.35), '#52ff9a', 3.5, { at: [i * 4.5, 9.45, 1.15] });
  }
  g.add(materials.group(b));
  return g;
}

// -------------------------------------------------------------------------------------------------
// Highway Turret HUD
// -------------------------------------------------------------------------------------------------

const HIGHWAY_HUD_CSS = `
.bk-hw-hud { position: absolute; inset: 0; pointer-events: none; font-family: var(--mono, monospace); color: #eef4f8; opacity: 0; transition: opacity 0.22s; z-index: 5; }
.bk-hw-hud.on { opacity: 1; }
.bk-hw-top { position: absolute; top: 1.4rem; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 1.4rem; padding: 0.42rem 1.05rem; background: rgba(10, 14, 18, 0.82); border-top: 0.16rem solid #d8a62a; box-shadow: 0.16rem 0.16rem 0 #000; }
.bk-hw-title { font: 700 1.05rem/1 var(--display, sans-serif); letter-spacing: 0.08em; color: #ffcf56; }
.bk-hw-wave { font-size: 0.86rem; letter-spacing: 0.07em; color: #ff6b50; font-weight: 700; }
.bk-hw-speed { font-size: 0.92rem; letter-spacing: 0.08em; color: #7ee787; font-weight: 700; }
.bk-hw-bot { position: absolute; bottom: 9.8rem; left: 50%; transform: translateX(-50%); display: flex; gap: 1.5rem; padding: 0.55rem 1.1rem; background: rgba(10, 14, 18, 0.84); border-bottom: 0.16rem solid #d8a62a; box-shadow: 0.16rem 0.16rem 0 #000; }
.bk-hw-gauge { width: 15.5rem; }
.bk-hw-ghead { display: flex; justify-content: space-between; font-size: 0.76rem; letter-spacing: 0.08em; margin-bottom: 0.24rem; }
.bk-hw-track { height: 0.48rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.18); overflow: hidden; }
.bk-hw-fill { height: 100%; width: 100%; transform-origin: 0 50%; transition: transform 0.06s linear; }
.bk-hw-fill.hull { background: linear-gradient(90deg, #35c86b, #80f09e); }
.bk-hw-fill.hull.low { background: linear-gradient(90deg, #d82a20, #ff6440); }
.bk-hw-fill.heat { background: linear-gradient(90deg, #e0a624, #ff4420); }
.bk-hw-fill.heat.hot { background: #ff2818; animation: bk-hw-blink 0.25s infinite alternate; }
.bk-hw-overheat { color: #ff4228; font-weight: 800; }
.bk-hw-xh { position: absolute; left: 50%; top: 50%; width: 26px; height: 26px; margin: -13px 0 0 -13px; border: 1.5px solid rgba(255, 224, 128, 0.85); border-radius: 50%; box-shadow: 0 0 8px rgba(255, 180, 40, 0.35); transition: transform 0.12s; }
.bk-hw-xh.zoom { transform: scale(0.68); border-color: #ff7048; }
.bk-hw-xh::after { content: ''; position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px 0 0 -2px; background: #ffcf56; border-radius: 50%; }
.bk-hw-flash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; }
@keyframes bk-hw-blink { from { opacity: 0.6; } to { opacity: 1; } }
`;

interface HighwayHudRefs {
  root: HTMLElement;
  wave: Label;
  speed: Label;
  hullText: Label;
  hullFill: HTMLElement;
  heatText: Label;
  heatFill: HTMLElement;
  reticle: HTMLElement;
  flash: HTMLElement;
}

function createHighwayHud(): HighwayHudRefs | null {
  if (typeof document === 'undefined') return null;
  if (!document.getElementById('bk-highway-hud-style')) {
    const style = document.createElement('style');
    style.id = 'bk-highway-hud-style';
    style.textContent = HIGHWAY_HUD_CSS;
    document.head?.append(style);
  }
  const waveEl = span('bk-hw-wave', 'WAVE 1 — INTERCEPTORS');
  const speedEl = span('bk-hw-speed', '132 KM/H');
  const hullTextEl = span('', '420 / 420');
  const hullFill = div('bk-hw-fill hull');
  const heatTextEl = span('', '0%');
  const heatFill = div('bk-hw-fill heat');
  const reticle = div('bk-hw-xh');
  const flash = div('bk-hw-flash');

  const root = div(
    'bk-hw-hud',
    div('bk-hw-top', span('bk-hw-title', 'BAILIFF HUMVEE // M2 .50 CAL TURRET'), waveEl, speedEl),
    reticle,
    div(
      'bk-hw-bot',
      div('bk-hw-gauge', div('bk-hw-ghead', span('', 'CHASSIS INTEGRITY'), hullTextEl), div('bk-hw-track', hullFill)),
      div('bk-hw-gauge', div('bk-hw-ghead', span('', 'BARREL HEAT'), heatTextEl), div('bk-hw-track', heatFill)),
    ),
    flash,
  );
  const host = document.querySelector('.hud') ?? document.body;
  host?.append(root);
  return {
    root,
    wave: new Label(waveEl),
    speed: new Label(speedEl),
    hullText: new Label(hullTextEl),
    hullFill,
    heatText: new Label(heatTextEl),
    heatFill,
    reticle,
    flash,
  };
}

// -------------------------------------------------------------------------------------------------
// HighwayChase
// -------------------------------------------------------------------------------------------------

export class HighwayChase {
  private readonly materials: ModelMaterials;
  private readonly root = new THREE.Group();
  private readonly scrollItems: ScrollItem[] = [];
  private built = false;

  // Humvee & turret rig
  private humveeRoot: THREE.Group | null = null;
  private humveeBody: THREE.Group | null = null;
  private humveeWheels: THREE.Object3D[] = [];
  private gun: Gun | null = null;
  private shieldPivot: THREE.Group | null = null;
  private heatSleeve: THREE.Mesh | null = null;
  private tunnelPortal: THREE.Group | null = null;

  private readonly _humveePos = new THREE.Vector3(HIGHWAY_ORIGIN[0], LV.highway, HIGHWAY_ORIGIN[2]);
  private readonly _turretPivot = new THREE.Vector3(HIGHWAY_ORIGIN[0], LV.highway + 2.38, HIGHWAY_ORIGIN[2] - 0.15);
  private readonly _turretMuzzle = new THREE.Vector3(HIGHWAY_ORIGIN[0], LV.highway + 2.4, HIGHWAY_ORIGIN[2] + 1.35);
  private readonly seatView: SeatView = {
    position: new THREE.Vector3(),
    yaw: Math.PI,
    pitch: -0.05,
    roll: 0,
    shake: 1,
  };

  // Turret & Humvee gameplay state
  private _phase: HighwayPhase = 'idle';
  private _mounted = false;
  private _yaw = Math.PI; // looking aft (+Z) toward pursuers
  private _pitch = -0.04;
  private _zoomed = false;
  private _hull: number = HIGHWAY_CONSTANTS.maxHull;
  readonly maxHull: number = HIGHWAY_CONSTANTS.maxHull;
  readonly heat = new Heat({
    heatPerShot: HIGHWAY_CONSTANTS.heatPerShot,
    cool: HIGHWAY_CONSTANTS.heatCool,
    vent: HIGHWAY_CONSTANTS.heatVent,
  });

  // Weaving & suspension dynamics
  private laneIndex = 1;
  private targetLaneIndex = 2;
  private laneSwitchIn = 3.6;
  private humveeVelX = 0;
  private humveeRoll = 0;
  private humveePitch = 0;
  private bumpPhase = 0;
  private scrollSpeed: number = HIGHWAY_CONSTANTS.scrollSpeed;

  // Firing & audio
  private roundCooldown = 0;
  private shotsFired = 0;
  private engineLoop: LoopHandle | null = null;
  private extraShotHandler: ExtraShotHandler | null = null;

  // Waves, pursuers, wrecks & RPGs
  private nextId = 1;
  private readonly _pursuers: HighwayPursuer[] = [];
  private readonly _wrecks: HighwayWreck[] = [];
  private readonly _rockets: HighwayRpg[] = [];
  private spawnQueue: PursuerKind[] = [];
  private spawnTimer = 0;
  private wave1Signalled = false;
  private wave2Signalled = false;

  // Extraction tunnel state
  private tunnelElapsed = 0;
  private tunnelSignalled = false;

  // HUD
  private hud: HighwayHudRefs | null = null;

  constructor(private readonly ctx: Ctx, private readonly onSignal: (sig: string) => void) {
    this.materials = new ModelMaterials(ctx);
    this.root.name = 'heist.highwayRoot';
    this.root.visible = false;
  }

  // ---- Read-only state accessors ----------------------------------------------------------------

  get active(): boolean {
    return this._phase !== 'idle' && this._phase !== 'complete';
  }

  get mounted(): boolean {
    return this._mounted;
  }

  get phase(): HighwayPhase {
    return this._phase;
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

  get humveePosition(): THREE.Vector3 {
    return this._humveePos;
  }

  get turretMuzzle(): THREE.Vector3 {
    return this._turretMuzzle;
  }

  get pursuers(): readonly HighwayPursuer[] {
    return this._pursuers;
  }

  get wrecks(): readonly HighwayWreck[] {
    return this._wrecks;
  }

  get rockets(): readonly HighwayRpg[] {
    return this._rockets;
  }

  get remainingPursuers(): number {
    let alive = 0;
    for (const p of this._pursuers) if (p.alive) alive++;
    return alive + this.spawnQueue.length;
  }

  // ---- Public API -------------------------------------------------------------------------------

  registerExtraShotHandler(fn: ExtraShotHandler | null): void {
    this.extraShotHandler = fn;
  }

  /** Programmatic aim helper (used by cutscenes/tests). */
  setAim(yaw: number, pitch: number): void {
    this._yaw = wrapAngle(yaw);
    this._pitch = clamp(pitch, HIGHWAY_CONSTANTS.pitchMin, HIGHWAY_CONSTANTS.pitchMax);
    this.gun?.snap(this._yaw, this._pitch);
    this.syncTurretTransforms(0);
  }

  /** Starts the Act 4 highway sequence (default Wave 1: Police Interceptors). */
  start(wave: 1 | 2 = 1): void {
    this.ensureBuilt();
    this.clearEntities();
    this.root.visible = true;
    this._hull = this.maxHull;
    this.heat.value = 0;
    this.heat.overheated = false;
    this.roundCooldown = 0;
    this.shotsFired = 0;
    this.scrollSpeed = HIGHWAY_CONSTANTS.scrollSpeed;
    this.laneIndex = 1;
    this.targetLaneIndex = 2;
    this._humveePos.set(HIGHWAY_LANES[this.laneIndex]!, LV.highway, HIGHWAY_ORIGIN[2]);
    this.humveeVelX = 0;
    this.humveeRoll = 0;
    this.humveePitch = 0;
    this.wave1Signalled = false;
    this.wave2Signalled = false;
    this.tunnelElapsed = 0;
    this.tunnelSignalled = false;
    if (this.tunnelPortal) this.tunnelPortal.visible = false;

    this.mountTurret();

    if (wave === 1) {
      this._phase = 'wave1';
      this.spawnQueue = Array.from({ length: HIGHWAY_CONSTANTS.wave1Count }, () => 'cruiser');
      this.spawnTimer = 0.25;
      // Spawn initial pack of 3 cruisers right away so action is immediate
      this.spawnPack(3);
      this.ctx.hud?.feed?.('COASTAL EXPRESSWAY — HOLD OFF PURSUERS!', '#ffcf56');
    } else {
      this.startWave2();
    }
    this.updateHud();
  }

  /** Begins Wave 2: SWAT BearCat vans, Explosive Fuel Tankers, and escort cruisers. */
  startWave2(): void {
    this.ensureBuilt();
    if (!this._mounted) this.mountTurret();
    this.root.visible = true;
    this._phase = 'wave2';
    this.wave2Signalled = false;
    this.patchHull(HIGHWAY_CONSTANTS.wave2Heal);
    // Staggered mixed convoy: 3 BearCats, 2 Fuel Tankers, 4 Cruisers = 9 pursuers
    this.spawnQueue = [
      'cruiser', 'tanker', 'bearcat',
      'cruiser', 'bearcat', 'cruiser',
      'tanker', 'cruiser', 'bearcat',
    ];
    this.spawnTimer = 0.35;
    this.spawnPack(3);
    this.ctx.hud?.feed?.('SWAT CONVOY & FUEL TANKERS INBOUND — SHOOT THE RED TANKS!', '#ff8c38');
    this.updateHud();
  }

  /** Transitions expressway cleanly to the AUDITOR-1 Gunship Boss battle. */
  enterBossPhase(): void {
    this.ensureBuilt();
    if (!this._mounted) this.mountTurret();
    this.root.visible = true;
    this.clearEntities();
    this._phase = 'boss';
    this.scrollSpeed = HIGHWAY_CONSTANTS.scrollSpeed;
    this.patchHull(HIGHWAY_CONSTANTS.bossHeal);
    this.ctx.hud?.feed?.('CHASSIS PATCHED — AUDITOR-1 INBOUND!', '#ff5b4c');
    this.updateHud();
  }

  /** Launches the high-speed sprint into the illuminated Port Extraction Tunnel + white-out flash. */
  playExtractionTunnel(): void {
    this.ensureBuilt();
    this.clearEntities();
    this._phase = 'tunnel';
    this.tunnelElapsed = 0;
    this.tunnelSignalled = false;
    if (this.tunnelPortal) {
      this.tunnelPortal.visible = true;
      this.tunnelPortal.position.set(0, 0, -76);
    }
    this.ctx.hud?.feed?.('PORT EXTRACTION TUNNEL AHEAD — PUNCH IT!', '#7ee787');
    this.ctx.audio?.play?.('wave_clear', { volume: 0.75 });
    this.updateHud();
  }

  /** Restores Humvee chassis integrity up to `maxHull`. */
  patchHull(amount: number): void {
    if (amount <= 0) return;
    const prev = this._hull;
    this._hull = Math.min(this.maxHull, this._hull + amount);
    if (this._hull > prev) {
      this.ctx.audio?.play?.('pickup_armor', { volume: 0.65 });
    }
  }

  /** Applies enemy gunfire / rocket / boss damage to the Humvee chassis. */
  damageHumvee(amount: number, from?: THREE.Vector3, source = 'highway_enemy'): void {
    if (!this.active || amount <= 0 || this._phase === 'tunnel') return;
    this._hull = Math.max(0, this._hull - amount);

    // Impact sparks & audio on chassis
    _tmp.copy(this._humveePos).addScaledVector(UP, 1.45);
    this.ctx.fx?.sparks?.(_tmp, UP, 8, 0xffaa44);
    this.ctx.audio?.play?.('impact_metal', { position: _tmp, volume: 0.75, pitchJitter: 0.1 });
    this.ctx.camera?.addTrauma?.(clamp(amount * 0.014, 0.07, 0.42));

    if (from && this.ctx.render?.post?.damageDirection) {
      const dx = from.x - this._humveePos.x;
      const dz = from.z - this._humveePos.z;
      const worldAngle = Math.atan2(dx, -dz);
      const rel = wrapAngle(worldAngle + this._yaw);
      this.ctx.render.post.damageDirection(rel, clamp(amount / 45, 0.25, 1));
    }

    if (this._hull <= 0) {
      this.ctx.fx?.explosion?.(this._humveePos, { radius: 8, kind: 'barrel', scale: 1.4 });
      this.ctx.audio?.play?.('vehicle_explode', { position: this._humveePos, volume: 0.9 });
      this.dismount(true);
      this.ctx.player?.takeDamage?.({
        amount: 9999,
        type: 'explosive',
        source,
        from,
      });
    }
    this.updateHud();
  }

  /** Main per-frame update. */
  update(dt: number): void {
    if (!this.active || dt <= 0) return;
    const step = Math.min(dt, 0.1);

    this.updateScrolling(step);
    this.updateHumveeMotion(step);
    this.updateTurretControl(step);

    if (this._phase === 'wave1' || this._phase === 'wave2') {
      this.updateSpawner(step);
      this.updatePursuers(step);
      this.updateRockets(step);
      this.checkWaveCompletion();
    } else if (this._phase === 'tunnel') {
      this.updateTunnel(step);
    }

    this.updateWrecks(step);
    this.updateHud();
  }

  /** Cleans up all active highway state, dismounts cleanly, and restores camera/player/HUD. */
  clear(): void {
    this.dismount(false);
    this.clearEntities();
    this._phase = 'idle';
    this._hull = this.maxHull;
    this.heat.value = 0;
    this.heat.overheated = false;
    this.roundCooldown = 0;
    this.wave1Signalled = false;
    this.wave2Signalled = false;
    this.tunnelElapsed = 0;
    this.tunnelSignalled = false;
    this.root.visible = false;
    this.gun?.hide();
    if (this.shieldPivot) this.shieldPivot.visible = false;
    if (this.tunnelPortal) this.tunnelPortal.visible = false;
    if (this.hud) {
      this.hud.root.classList.remove('on');
      this.hud.flash.style.opacity = '0';
    }
  }

  reset(): void {
    this.clear();
  }

  /**
   * Fires a single `.50 cal` ray from the turret (or custom origin/dir) against RPGs,
   * the registered `extraShotHandler` (GunshipBoss), and highway pursuers.
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
      randomInCone(_bore, HIGHWAY_CONSTANTS.turretSpread, _dir);
    }

    const maxRange = 220;
    let bestDist = maxRange;
    let hitRpg: HighwayRpg | null = null;
    let hitPursuer: HighwayPursuer | null = null;
    let hitZone: PursuerZone | null = null;

    // 1. Check active shootable SWAT RPGs first (generous 1.25 m radius)
    for (const r of this._rockets) {
      if (!r.alive) continue;
      const d = raySphereDist(_muzzle, _dir, r.position, 1.25, bestDist);
      if (d >= 0 && d < bestDist) {
        bestDist = d;
        hitRpg = r;
      }
    }

    // 2. Check road pursuers locational OBB hitboxes
    for (const p of this._pursuers) {
      if (!p.alive) continue;
      _invQ.copy(p.root.quaternion).invert();
      _localOrigin.copy(_muzzle).sub(p.position).applyQuaternion(_invQ);
      _localDir.copy(_dir).applyQuaternion(_invQ);

      for (const z of p.zones) {
        if (z.destroyed && z.kind !== 'chassis') continue;
        const d = rayLocalBoxDist(_localOrigin, _localDir, z.offset, z.halfExtents, bestDist);
        if (d >= 0 && d < bestDist) {
          bestDist = d;
          hitRpg = null;
          hitPursuer = p;
          hitZone = z;
        }
      }
    }

    // 3. Check optional extra shot handler (e.g., GunshipBoss AUDITOR-1)
    let hitExtra = false;
    if (this.extraShotHandler) {
      const res = this.extraShotHandler(_muzzle, _dir, bestDist, HIGHWAY_CONSTANTS.turretDamage);
      if (res) {
        hitExtra = true;
        if (typeof res === 'object' && res.point) {
          bestDist = res.distance;
          _hitPt.copy(res.point);
        } else {
          _hitPt.copy(_muzzle).addScaledVector(_dir, Math.min(bestDist, 80));
        }
        hitRpg = null;
        hitPursuer = null;
        hitZone = null;
      }
    }

    if (!hitExtra) {
      _hitPt.copy(_muzzle).addScaledVector(_dir, bestDist);
    }

    // Apply hit result
    if (hitRpg) {
      this.damageRpg(hitRpg, HIGHWAY_CONSTANTS.turretDamage, _hitPt);
    } else if (hitPursuer && hitZone) {
      this.damagePursuerZone(hitPursuer, hitZone, HIGHWAY_CONSTANTS.turretDamage, _hitPt);
    }

    // Visuals & audio
    this.shotsFired++;
    this.ctx.fx?.tracer?.(_muzzle, _hitPt, 'heavy');
    if (this.shotsFired % 2 === 1) {
      this.ctx.fx?.muzzleFlash?.(_muzzle, _dir, 'hmg');
    }
    if (this.shotsFired % 2 === 0 && gun) {
      _casing.set(-_dir.z, rand(1.1, 2.0), _dir.x).multiplyScalar(1.5);
      this.ctx.fx?.shellCasing?.(gun.root.position, _casing, 'cannon');
    }
    gun?.recoil(0.055);
    this.ctx.audio?.play?.('hmg_shot', { pitch: 0.98, pitchJitter: 0.04 });
    this.ctx.camera?.kick?.(rand(0.002, 0.007), rand(-0.005, 0.005));
    this.ctx.camera?.addTrauma?.(0.036);
    return hitExtra || hitRpg !== null || hitPursuer !== null;
  }

  // ---- Build treadmill & vehicles ---------------------------------------------------------------

  private ensureBuilt(): void {
    if (this.built) return;
    this.built = true;

    this.root.position.set(HIGHWAY_ORIGIN[0], HIGHWAY_ORIGIN[1], HIGHWAY_ORIGIN[2]);

    // Static distant coastal water plane & skyline silhouettes flanking the elevated expressway
    const env = new ModelBuilder();
    env.box(320, 0.4, 200, '#0a1f30', { at: [0, -11.5, 0] }); // coastal sea below viaduct
    // Continuous road edge curbs
    for (const s of [-1, 1]) {
      env.box(0.55, 1.15, HIGHWAY_HALF_LEN * 2 + 28, '#5a6068', { at: [s * (HIGHWAY_HALF_WIDTH - 0.3), 0.56, 0] });
    }
    this.root.add(this.materials.group(env));

    // Scrolling dashed lane lines (3 dividers across 4 lanes) & Jersey barrier segments (z in [-66, +66], 12 x 11m = 132m)
    const laneDividerXs = [-5, 0, 5];
    const dashStep = 11;
    for (let i = 0; i < 12; i++) {
      const z = -66 + i * dashStep;
      const seg = new ModelBuilder();
      for (const lx of laneDividerXs) {
        seg.box(0.22, 0.03, 4.4, '#e6ecf0', { at: [lx, 0.04, 0] });
      }
      // Concrete barrier joints + amber highway reflectors
      for (const s of [-1, 1]) {
        seg.box(0.7, 1.22, 1.2, '#6c737c', { at: [s * (HIGHWAY_HALF_WIDTH - 0.25), 0.61, 0] });
        seg.glow(new THREE.BoxGeometry(0.14, 0.14, 0.24), '#ffae2a', 2.4, {
          at: [s * (HIGHWAY_HALF_WIDTH - 0.62), 0.96, 0],
        });
      }
      const g = this.materials.group(seg);
      g.position.set(0, 0, z);
      this.root.add(g);
      this.scrollItems.push({ obj: g, z, minZ: -66, maxZ: 66 });
    }

    // Tall steel sodium highway light gantries every 24m (6 x 24m = 144m, wrapping seamlessly in [-72, +72])
    const signTex = createExpresswaySignTexture();
    const signMat = signTex
      ? new THREE.MeshBasicMaterial({ map: signTex })
      : new THREE.MeshStandardMaterial({ color: '#0f5c36', roughness: 0.7 });
    const signGeo = new THREE.PlaneGeometry(11.5, 2.6);

    for (let i = 0; i < 6; i++) {
      const z = -72 + i * 24;
      const gantry = new THREE.Group();
      const gb = new ModelBuilder();
      const STEEL = '#3a424c';
      // Dual steel legs & overhead truss
      for (const s of [-1, 1]) {
        gb.box(0.55, 9.6, 0.55, STEEL, { at: [s * (HIGHWAY_HALF_WIDTH + 0.4), 4.8, 0] });
        gb.box(2.4, 0.25, 0.35, STEEL, { at: [s * (HIGHWAY_HALF_WIDTH - 0.8), 9.2, 0] });
        // Warm glowing sodium highway lamp fixtures
        gb.glow(new THREE.BoxGeometry(1.4, 0.18, 0.5), '#ffbe55', 3.4, {
          at: [s * (HIGHWAY_HALF_WIDTH - 2.4), 9.0, 0],
        });
      }
      gb.box(HIGHWAY_HALF_WIDTH * 2 + 1.4, 0.45, 0.45, STEEL, { at: [0, 9.4, 0] });
      gb.glow(new THREE.BoxGeometry(1.6, 0.16, 0.42), '#ffc866', 3.2, { at: [0, 9.08, 0] });
      // Distant bridge suspension pylons & coastal skyline blocks flanking expressway
      if (i % 2 === 0) {
        gb.box(3.2, 34, 3.2, '#28323e', { at: [-38, 6, 0] });
        gb.box(3.2, 34, 3.2, '#28323e', { at: [38, 6, 0] });
        gb.glow(new THREE.SphereGeometry(0.42, 6, 4), '#ff2a20', 3.6, { at: [-38, 23.4, 0] });
        gb.glow(new THREE.SphereGeometry(0.42, 6, 4), '#ff2a20', 3.6, { at: [38, 23.4, 0] });
      } else {
        // Coastal city skyline towers far on the west side
        gb.box(10, 22 + (i % 3) * 8, 12, '#151c26', { at: [-56, 0, 0] });
        gb.box(8, 16 + (i % 2) * 10, 10, '#18212e', { at: [54, -2, 0] });
      }
      gantry.add(this.materials.group(gb));

      // Overhead green coastal expressway sign on every other gantry
      if (i % 2 === 1) {
        const signBack = new THREE.Mesh(signGeo, signMat);
        signBack.position.set(0, 8.9, 0.34);
        const signFront = new THREE.Mesh(signGeo, signMat);
        signFront.position.set(0, 8.9, -0.34);
        signFront.rotation.y = Math.PI;
        gantry.add(signBack, signFront);
      }

      gantry.position.set(0, 0, z);
      this.root.add(gantry);
      this.scrollItems.push({ obj: gantry, z, minZ: -72, maxZ: 72 });
    }

    // Extraction tunnel portal (hidden until playExtractionTunnel)
    this.tunnelPortal = buildExtractionTunnel(this.materials);
    this.tunnelPortal.visible = false;
    this.root.add(this.tunnelPortal);

    // Humvee
    const hv = buildHumveeVisual(this.materials);
    this.humveeRoot = hv.root;
    this.humveeBody = hv.body;
    this.humveeWheels = hv.wheels;
    this.humveeRoot.position.copy(this._humveePos);
    this.ctx.render.scene.add(this.root, this.humveeRoot);

    // Roof M2 .50 cal gun & armored shield
    this.gun = new Gun(this.materials, this.ctx.render.scene, HMG);
    const sh = buildTurretShield(this.materials);
    this.shieldPivot = sh.pivot;
    this.heatSleeve = sh.heatSleeve;
    this.shieldPivot.visible = false;
    this.ctx.render.scene.add(this.shieldPivot);

    // DOM HUD
    this.hud = createHighwayHud();
  }

  // ---- Mount / dismount -------------------------------------------------------------------------

  private mountTurret(): void {
    if (this._mounted) return;
    this._mounted = true;
    this._yaw = Math.PI;
    this._pitch = -0.04;
    this._zoomed = false;

    const { camera, player, weapons, audio } = this.ctx;
    weapons?.setHolstered?.(true);
    // Park with exposed=true so incoming damage routes into player.interceptor -> damageHumvee
    player.park(this._humveePos, true);
    player.interceptor = (dmg: PlayerDamage): boolean => {
      this.damageHumvee(dmg.amount, dmg.from, dmg.source);
      return true;
    };

    camera.setSeat(this.seatView);
    camera.setZoom(HIGHWAY_CONSTANTS.turretFov);

    this.gun?.snap(this._yaw, this._pitch);
    if (this.shieldPivot) this.shieldPivot.visible = true;
    this.syncTurretTransforms(0);

    audio?.play?.('weapon_draw_heavy', { volume: 0.8 });
    this.engineLoop = audio?.startLoop?.('truck_engine_loop', { volume: 0.42, pitch: 1.28, fadeIn: 0.35 }) ?? null;
    this.hud?.root.classList.add('on');
  }

  private dismount(lethal: boolean): void {
    if (!this._mounted) return;
    this._mounted = false;
    this._zoomed = false;

    const { camera, player, weapons } = this.ctx;
    player.interceptor = null;
    camera.setSeat(null);
    camera.setZoom(null);
    player.unpark(0);
    weapons?.setHolstered?.(false);

    this.engineLoop?.stop(0.25);
    this.engineLoop = null;
    this.gun?.hide();
    if (this.shieldPivot) this.shieldPivot.visible = false;
    if (!lethal) {
      this.hud?.root.classList.remove('on');
    }
  }

  // ---- Per-frame subsystems ---------------------------------------------------------------------

  private updateScrolling(dt: number): void {
    const dz = this.scrollSpeed * dt;
    for (let i = 0; i < this.scrollItems.length; i++) {
      const item = this.scrollItems[i]!;
      item.z += dz;
      const span = item.maxZ - item.minZ;
      while (item.z > item.maxZ) item.z -= span;
      item.obj.position.z = item.z;
    }
  }

  private updateHumveeMotion(dt: number): void {
    // Dynamically weave across the 4 lanes
    this.laneSwitchIn -= dt;
    if (this.laneSwitchIn <= 0) {
      this.laneSwitchIn = rand(3.2, 5.8);
      const stepDir = this.targetLaneIndex === 0 ? 1 : this.targetLaneIndex === HIGHWAY_LANES.length - 1 ? -1 : (Math.random() < 0.5 ? -1 : 1);
      this.targetLaneIndex = clamp(this.targetLaneIndex + stepDir, 0, HIGHWAY_LANES.length - 1);
    }

    const targetX = this._phase === 'tunnel' ? HIGHWAY_ORIGIN[0] : HIGHWAY_LANES[this.targetLaneIndex]!;
    const prevX = this._humveePos.x;
    const nextX = damp(prevX, targetX, 2.1, dt);
    this.humveeVelX = dt > 1e-5 ? (nextX - prevX) / dt : 0;
    this._humveePos.x = nextX;

    // Expansion-joint suspension bumps every ~24 m
    this.bumpPhase += (this.scrollSpeed / 24) * dt * Math.PI * 2;
    const jointBump = Math.pow(Math.max(0, Math.sin(this.bumpPhase)), 6) * 0.09;
    const roadJitter = Math.sin(this.bumpPhase * 3.7) * 0.018;
    this._humveePos.y = LV.highway + jointBump + roadJitter;
    this._humveePos.z = HIGHWAY_ORIGIN[2];

    // Smooth suspension roll & pitch
    this.humveeRoll = damp(this.humveeRoll, clamp(-this.humveeVelX * 0.018, -0.09, 0.09), 7, dt);
    this.humveePitch = damp(this.humveePitch, jointBump * 0.25 + (this._phase === 'tunnel' ? 0.03 : 0), 9, dt);

    if (this.humveeRoot) {
      this.humveeRoot.position.copy(this._humveePos);
      this.humveeRoot.rotation.set(0, clamp(-this.humveeVelX * 0.02, -0.11, 0.11), 0);
    }
    if (this.humveeBody) {
      this.humveeBody.rotation.set(this.humveePitch, 0, this.humveeRoll);
    }
    const wheelSpin = -(this.scrollSpeed / 0.52) * dt;
    for (let i = 0; i < this.humveeWheels.length; i++) {
      this.humveeWheels[i]!.rotation.x += wheelSpin;
    }

    this.ctx.player.carry?.(this._humveePos);
  }

  private updateTurretControl(dt: number): void {
    if (!this._mounted) return;
    const { input, player, camera, audio } = this.ctx;

    // Read look safely whether Player.update ran earlier in the frame (frameLook) or standalone (consumeLook)
    const flX = input.frameLook?.x ?? 0;
    const flY = input.frameLook?.y ?? 0;
    const consumed = input.consumeLook?.();
    const dx = consumed && (consumed.x !== 0 || consumed.y !== 0) ? consumed.x : flX;
    const dy = consumed && (consumed.x !== 0 || consumed.y !== 0) ? consumed.y : flY;

    const sens = (player.sensitivity ?? 0.0022) * (player.lookScale ?? 1) * (this._zoomed ? 0.62 : 1);
    this._yaw = wrapAngle(this._yaw - dx * sens);
    this._pitch = clamp(
      this._pitch - dy * sens * (player.invertY ? -1 : 1),
      HIGHWAY_CONSTANTS.pitchMin,
      HIGHWAY_CONSTANTS.pitchMax,
    );

    // RMB tactical zoom
    const wantZoom = input.isDown('aim');
    if (wantZoom !== this._zoomed) {
      this._zoomed = wantZoom;
      camera.setZoom(this._zoomed ? HIGHWAY_CONSTANTS.turretZoomFov : HIGHWAY_CONSTANTS.turretFov);
      audio?.play?.('autocannon_zoom', { volume: 0.45, pitch: this._zoomed ? 1.08 : 0.92 });
    }

    this.syncTurretTransforms(dt);

    // Trigger & M2 .50 cal overheat/vent mechanics
    const fireHeld = input.isDown('fire') && this._phase !== 'tunnel';
    if (fireHeld && this.heat.overheated && input.pressed('fire')) {
      audio?.play?.('weapon_dry', { volume: 0.7 });
    }
    const shooting = fireHeld && !this.heat.overheated;
    if (shooting) {
      this.roundCooldown -= dt;
      let burst = 0;
      while (this.roundCooldown <= 0 && burst < 4) {
        this.roundCooldown += 1 / HIGHWAY_CONSTANTS.turretRps;
        burst++;
        this.fireSingleShot();
        if (this.heat.shot()) {
          audio?.play?.('steam_burst', { position: this._turretMuzzle, volume: 0.85 });
          this.ctx.fx?.smoke?.(this._turretMuzzle, 0xd8dce4, 0.75, 0.9);
          break;
        }
      }
      if (this.roundCooldown < 0) this.roundCooldown = 0;
    } else {
      this.roundCooldown = Math.max(0, this.roundCooldown - dt);
    }
    this.heat.cool(dt, shooting);

    // Thermal barrel glow
    if (this.heatSleeve) {
      const mat = this.heatSleeve.material as THREE.MeshBasicMaterial;
      const glow = clamp((this.heat.value - 0.35) / 0.65);
      mat.opacity = this.heat.overheated ? 0.55 + Math.sin(performance.now() * 0.025) * 0.25 : glow * 0.65;
    }
  }

  private syncTurretTransforms(dt: number): void {
    this._turretPivot.set(
      this._humveePos.x,
      this._humveePos.y + 2.38,
      this._humveePos.z - 0.15,
    );
    if (this.gun) {
      this.gun.point(this._turretPivot, this._yaw, this._pitch, dt);
      this.gun.muzzle(this._turretMuzzle);
    } else {
      const cp = Math.cos(this._pitch);
      this._turretMuzzle
        .copy(this._turretPivot)
        .addScaledVector(_tmp.set(-Math.sin(this._yaw) * cp, Math.sin(this._pitch), -Math.cos(this._yaw) * cp), 1.54);
    }
    if (this.shieldPivot) {
      this.shieldPivot.position.copy(this._turretPivot);
      this.shieldPivot.rotation.set(0, this._yaw, 0);
    }

    // Place gunner eye behind the M2 spade grips looking downrange
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
    this.seatView.roll = this.humveeRoll * 0.45;
    this.ctx.camera.syncSeat();
  }

  // ---- Spawning & Pursuer AI --------------------------------------------------------------------

  private updateSpawner(dt: number): void {
    if (this.spawnQueue.length === 0) return;
    let alive = 0;
    for (const p of this._pursuers) if (p.alive) alive++;
    const maxConcurrent = this._phase === 'wave1' ? 3 : 4;
    if (alive >= maxConcurrent) return;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      const packSize = Math.min(maxConcurrent - alive, this.spawnQueue.length, 2);
      this.spawnPack(packSize);
      this.spawnTimer = rand(1.6, 2.8);
    }
  }

  private spawnPack(count: number): void {
    const usedLanes = new Set<number>();
    for (const p of this._pursuers) {
      if (p.alive && p.position.z > 28) usedLanes.add(p.lane);
    }
    for (let i = 0; i < count && this.spawnQueue.length > 0; i++) {
      const kind = this.spawnQueue.shift()!;
      let lane = Math.floor(Math.random() * HIGHWAY_LANES.length);
      for (let tries = 0; tries < 4 && usedLanes.has(lane); tries++) {
        lane = (lane + 1) % HIGHWAY_LANES.length;
      }
      usedLanes.add(lane);
      this.spawnPursuer(kind, lane, 48 + i * 7);
    }
  }

  /** Spawns a specific pursuer on `lane` at relative Z offset (public for deterministic testing). */
  spawnPursuer(kind: PursuerKind, laneIndex: number, startZ = 50): HighwayPursuer {
    this.ensureBuilt();
    const lane = clamp(Math.round(laneIndex), 0, HIGHWAY_LANES.length - 1);
    const id = this.nextId++;

    let root: THREE.Group;
    let wheels: THREE.Object3D[] = [];
    let strobeRed: THREE.Object3D | null = null;
    let strobeBlue: THREE.Object3D | null = null;
    let rearDoorL: THREE.Object3D | null = null;
    let rearDoorR: THREE.Object3D | null = null;
    let maxHp: number;
    let targetZ: number;
    let zones: PursuerZone[];

    if (kind === 'cruiser') {
      const vis = buildCruiserVisual(this.materials);
      root = vis.root;
      wheels = vis.wheels;
      strobeRed = vis.strobeRed;
      strobeBlue = vis.strobeBlue;
      maxHp = 160;
      targetZ = rand(8, 22);
      zones = [
        { id: 'tire_fl', kind: 'tire', offset: new THREE.Vector3(-1.05, 0.44, -1.45), halfExtents: new THREE.Vector3(0.45, 0.48, 0.56), hp: 45, maxHp: 45, destroyed: false },
        { id: 'tire_fr', kind: 'tire', offset: new THREE.Vector3(1.05, 0.44, -1.45), halfExtents: new THREE.Vector3(0.45, 0.48, 0.56), hp: 45, maxHp: 45, destroyed: false },
        { id: 'tire_rl', kind: 'tire', offset: new THREE.Vector3(-1.05, 0.44, 1.42), halfExtents: new THREE.Vector3(0.45, 0.48, 0.56), hp: 45, maxHp: 45, destroyed: false },
        { id: 'tire_rr', kind: 'tire', offset: new THREE.Vector3(1.05, 0.44, 1.42), halfExtents: new THREE.Vector3(0.45, 0.48, 0.56), hp: 45, maxHp: 45, destroyed: false },
        { id: 'engine', kind: 'engine', offset: new THREE.Vector3(0, 0.96, -1.55), halfExtents: new THREE.Vector3(0.96, 0.55, 0.85), hp: 95, maxHp: 95, destroyed: false },
        { id: 'cab', kind: 'cab', offset: new THREE.Vector3(0, 1.42, 0.12), halfExtents: new THREE.Vector3(0.95, 0.52, 0.95), hp: 80, maxHp: 80, destroyed: false },
        { id: 'chassis', kind: 'chassis', offset: new THREE.Vector3(0, 0.95, 0.1), halfExtents: new THREE.Vector3(1.15, 0.85, 2.45), hp: 160, maxHp: 160, destroyed: false },
      ];
    } else if (kind === 'bearcat') {
      const vis = buildBearcatVisual(this.materials);
      root = vis.root;
      wheels = vis.wheels;
      strobeRed = vis.strobeRed;
      strobeBlue = vis.strobeBlue;
      rearDoorL = vis.rearDoorL;
      rearDoorR = vis.rearDoorR;
      maxHp = 320;
      targetZ = rand(14, 22);
      zones = [
        { id: 'tire_fl', kind: 'tire', offset: new THREE.Vector3(-1.28, 0.58, -2.05), halfExtents: new THREE.Vector3(0.5, 0.62, 0.65), hp: 85, maxHp: 85, destroyed: false },
        { id: 'tire_fr', kind: 'tire', offset: new THREE.Vector3(1.28, 0.58, -2.05), halfExtents: new THREE.Vector3(0.5, 0.62, 0.65), hp: 85, maxHp: 85, destroyed: false },
        { id: 'tire_rl', kind: 'tire', offset: new THREE.Vector3(-1.28, 0.58, 1.85), halfExtents: new THREE.Vector3(0.5, 0.62, 0.65), hp: 85, maxHp: 85, destroyed: false },
        { id: 'tire_rr', kind: 'tire', offset: new THREE.Vector3(1.28, 0.58, 1.85), halfExtents: new THREE.Vector3(0.5, 0.62, 0.65), hp: 85, maxHp: 85, destroyed: false },
        { id: 'engine', kind: 'engine', offset: new THREE.Vector3(0, 1.5, -2.2), halfExtents: new THREE.Vector3(1.18, 0.72, 0.98), hp: 150, maxHp: 150, destroyed: false },
        { id: 'cab', kind: 'cab', offset: new THREE.Vector3(0, 2.05, -0.8), halfExtents: new THREE.Vector3(1.15, 0.65, 0.95), hp: 130, maxHp: 130, destroyed: false },
        { id: 'chassis', kind: 'chassis', offset: new THREE.Vector3(0, 1.48, 0.1), halfExtents: new THREE.Vector3(1.38, 1.25, 3.25), hp: 320, maxHp: 320, destroyed: false },
      ];
    } else {
      const vis = buildTankerVisual(this.materials);
      root = vis.root;
      wheels = vis.wheels;
      maxHp = 220;
      targetZ = rand(6, 18);
      zones = [
        { id: 'tank', kind: 'tank', offset: new THREE.Vector3(0, 2.25, 1.25), halfExtents: new THREE.Vector3(1.32, 1.28, 3.2), hp: 110, maxHp: 110, destroyed: false },
        { id: 'tire_fl', kind: 'tire', offset: new THREE.Vector3(-1.26, 0.6, -3.15), halfExtents: new THREE.Vector3(0.52, 0.64, 0.68), hp: 65, maxHp: 65, destroyed: false },
        { id: 'tire_fr', kind: 'tire', offset: new THREE.Vector3(1.26, 0.6, -3.15), halfExtents: new THREE.Vector3(0.52, 0.64, 0.68), hp: 65, maxHp: 65, destroyed: false },
        { id: 'cab', kind: 'cab', offset: new THREE.Vector3(0, 2.1, -3.05), halfExtents: new THREE.Vector3(1.26, 0.96, 1.15), hp: 110, maxHp: 110, destroyed: false },
        { id: 'chassis', kind: 'chassis', offset: new THREE.Vector3(0, 1.55, 0.2), halfExtents: new THREE.Vector3(1.35, 1.3, 4.4), hp: 220, maxHp: 220, destroyed: false },
      ];
    }

    const pos = new THREE.Vector3(HIGHWAY_LANES[lane]!, LV.highway, HIGHWAY_ORIGIN[2] + startZ);
    root.position.copy(pos);
    this.ctx.render.scene.add(root);

    const pursuer: HighwayPursuer = {
      id,
      kind,
      root,
      position: pos,
      velocity: new THREE.Vector3(0, 0, -14),
      lane,
      targetLane: lane,
      laneTimer: rand(2.5, 5.2),
      targetZ,
      hp: maxHp,
      maxHp,
      alive: true,
      zones,
      fireCooldown: rand(1.1, 2.2),
      rpgCooldown: rand(3.4, 5.2),
      strobePhase: rand(0, Math.PI * 2),
      wheels,
      strobeRed,
      strobeBlue,
      rearDoorL,
      rearDoorR,
      doorsOpen: 0,
      yaw: 0,
      roll: 0,
      smokeTimer: 0,
    };
    this._pursuers.push(pursuer);
    return pursuer;
  }

  private updatePursuers(dt: number): void {
    for (let i = this._pursuers.length - 1; i >= 0; i--) {
      const p = this._pursuers[i]!;
      if (!p.alive) continue;

      // Lane weaving
      p.laneTimer -= dt;
      if (p.laneTimer <= 0) {
        p.laneTimer = p.kind === 'tanker' ? rand(5.5, 9.0) : rand(2.6, 5.0);
        const candidates = [0, 1, 2, 3].filter(l => {
          // Avoid overlapping Humvee if alongside
          if (Math.abs(p.position.z - this._humveePos.z) < 7 && Math.abs(HIGHWAY_LANES[l]! - this._humveePos.x) < 2.8) {
            return false;
          }
          return true;
        });
        if (candidates.length > 0) {
          p.targetLane = candidates[Math.floor(Math.random() * candidates.length)]!;
        }
      }

      const wantX = HIGHWAY_LANES[p.targetLane]!;
      const prevX = p.position.x;
      p.position.x = damp(p.position.x, wantX, p.kind === 'tanker' ? 1.2 : 2.5, dt);
      p.velocity.x = dt > 1e-5 ? (p.position.x - prevX) / dt : 0;

      // Longitudinal pursuit positioning in Humvee frame
      const wantZ = HIGHWAY_ORIGIN[2] + p.targetZ;
      const prevZ = p.position.z;
      p.position.z = damp(p.position.z, wantZ, p.kind === 'cruiser' ? 1.8 : 1.35, dt);
      p.velocity.z = dt > 1e-5 ? (p.position.z - prevZ) / dt : 0;
      p.position.y = LV.highway;

      p.yaw = damp(p.yaw, clamp(-p.velocity.x * 0.03, -0.2, 0.2), 8, dt);
      p.roll = damp(p.roll, clamp(-p.velocity.x * 0.025, -0.12, 0.12), 8, dt);
      p.root.position.copy(p.position);
      p.root.rotation.set(0, p.yaw, p.roll);

      // Spin wheels
      const wSpin = -(this.scrollSpeed / 0.5) * dt;
      for (let w = 0; w < p.wheels.length; w++) p.wheels[w]!.rotation.x += wSpin;

      // Police / SWAT red-blue strobe lightbar
      if (p.strobeRed && p.strobeBlue) {
        p.strobePhase += dt * 13;
        const redOn = Math.sin(p.strobePhase) >= 0;
        p.strobeRed.visible = redOn;
        p.strobeBlue.visible = !redOn;
      }

      // BearCat rear doors swing open once in combat range
      if (p.kind === 'bearcat' && p.rearDoorL && p.rearDoorR) {
        const wantOpen = p.position.z < 28 ? 1 : 0;
        p.doorsOpen = damp(p.doorsOpen, wantOpen, 3.8, dt);
        p.rearDoorL.rotation.y = -p.doorsOpen * 1.9;
        p.rearDoorR.rotation.y = p.doorsOpen * 1.9;
      }

      // Smoke when heavily damaged
      if (p.hp < p.maxHp * 0.5) {
        p.smokeTimer -= dt;
        if (p.smokeTimer <= 0) {
          p.smokeTimer = 0.25;
          _tmp.copy(p.position).addScaledVector(UP, 1.5);
          this.ctx.fx?.smoke?.(_tmp, 0x262628, 1.1, 1.2);
        }
      }

      // Combat attacks when in firing range (tankers don't shoot)
      if (p.kind !== 'tanker' && p.position.z < 34) {
        p.fireCooldown -= dt;
        if (p.fireCooldown <= 0) {
          p.fireCooldown = p.kind === 'bearcat' ? rand(1.15, 1.9) : rand(1.4, 2.4);
          this.pursuerFireBurst(p);
        }
        if (p.kind === 'bearcat' && p.doorsOpen > 0.65) {
          p.rpgCooldown -= dt;
          if (p.rpgCooldown <= 0) {
            p.rpgCooldown = rand(5.2, 7.6);
            this.launchPursuerRpg(p);
          }
        }
      }
    }
  }

  private pursuerFireBurst(p: HighwayPursuer): void {
    _tmp.copy(p.position).add(new THREE.Vector3(0, p.kind === 'bearcat' ? 2.1 : 1.45, -1.2));
    _tmp2.copy(this._humveePos).add(new THREE.Vector3(rand(-1.3, 1.3), rand(1.0, 2.2), rand(-1.2, 1.2)));
    this.ctx.fx?.tracer?.(_tmp, _tmp2, 'enemy');
    this.ctx.audio?.play?.(p.kind === 'bearcat' ? 'mounted_gun' : 'enemy_smg', { position: _tmp, volume: 0.65 });
    // Apply fair chip damage to Humvee (via player.takeDamage so interceptor runs, or direct)
    const dmg = p.kind === 'bearcat' ? 11 : 7;
    if (Math.random() < 0.72) {
      this.damageHumvee(dmg, _tmp, p.kind === 'bearcat' ? 'swat_bearcat' : 'police_cruiser');
    }
  }

  private launchPursuerRpg(p: HighwayPursuer): void {
    const start = new THREE.Vector3(p.position.x, p.position.y + 2.15, p.position.z + 2.2);
    const mesh = buildRpgMesh(this.materials);
    mesh.position.copy(start);
    this.ctx.render.scene.add(mesh);

    const travelTime = 2.2;
    const vel = new THREE.Vector3()
      .subVectors(_tmp.copy(this._humveePos).addScaledVector(UP, 1.5), start)
      .divideScalar(travelTime);
    const rpg: HighwayRpg = {
      id: this.nextId++,
      mesh,
      position: start,
      velocity: vel,
      hp: 18,
      age: 0,
      maxAge: 3.4,
      alive: true,
      smokeTimer: 0,
    };
    this._rockets.push(rpg);
    this.ctx.audio?.play?.('enemy_rocket_fire', { position: start, volume: 0.8 });
    this.ctx.hud?.feed?.('SWAT RPG INBOUND — SHOOT IT DOWN!', '#ff6b3d');
  }

  private updateRockets(dt: number): void {
    for (let i = this._rockets.length - 1; i >= 0; i--) {
      const r = this._rockets[i]!;
      if (!r.alive) {
        r.mesh.removeFromParent();
        this._rockets.splice(i, 1);
        continue;
      }
      r.age += dt;
      // Gently home toward Humvee current X so it stays dramatic while still shootable
      const toTargetX = this._humveePos.x - r.position.x;
      r.velocity.x = damp(r.velocity.x, clamp(toTargetX * 1.4, -8, 8), 1.8, dt);
      r.position.addScaledVector(r.velocity, dt);
      r.mesh.position.copy(r.position);
      r.mesh.lookAt(r.position.x + r.velocity.x, r.position.y + r.velocity.y, r.position.z + r.velocity.z);

      r.smokeTimer -= dt;
      if (r.smokeTimer <= 0) {
        r.smokeTimer = 0.06;
        this.ctx.fx?.smoke?.(r.position, 0xd4d0c8, 0.55, 0.65);
      }

      const dist = r.position.distanceTo(_tmp.copy(this._humveePos).addScaledVector(UP, 1.5));
      if (dist <= 2.35) {
        r.alive = false;
        r.mesh.removeFromParent();
        this._rockets.splice(i, 1);
        this.ctx.fx?.explosion?.(r.position, { radius: 5, kind: 'rocket', scale: 1.0 });
        this.ctx.audio?.play?.('explosion_barrel', { position: r.position, volume: 0.85 });
        this.damageHumvee(34, r.position, 'swat_rpg');
      } else if (r.age >= r.maxAge || r.position.z < -40) {
        r.alive = false;
        r.mesh.removeFromParent();
        this._rockets.splice(i, 1);
      }
    }
  }

  private damageRpg(r: HighwayRpg, amount: number, hitPt: THREE.Vector3): void {
    r.hp -= amount;
    if (r.hp <= 0 && r.alive) {
      r.alive = false;
      this.ctx.fx?.explosion?.(hitPt, { radius: 3.5, kind: 'rocket', scale: 0.75 });
      this.ctx.audio?.play?.('explosion_small', { position: hitPt, volume: 0.8 });
      this.ctx.hud?.hitMarker?.('kill');
      this.ctx.hud?.feed?.('RPG INTERCEPTED!', '#7ee787');
    }
  }

  // ---- Locational Destruction & Chain Tanker Detonation -----------------------------------------

  /** Applies damage to a specific locational zone on a pursuer (public for deterministic testing). */
  damagePursuerZone(p: HighwayPursuer, zone: PursuerZone, amount: number, hitPt?: THREE.Vector3): boolean {
    if (!p.alive || amount <= 0) return false;
    const pt = hitPt ?? p.position;

    zone.hp = Math.max(0, zone.hp - amount);
    const hullMult = zone.kind === 'chassis' ? 1 : zone.kind === 'tank' ? 1.4 : 0.7;
    p.hp = Math.max(0, p.hp - amount * hullMult);

    const isWeak = zone.kind !== 'chassis';
    this.ctx.fx?.sparks?.(pt, UP, isWeak ? 10 : 5, isWeak ? 0xffbb33 : 0xffaa55);
    this.ctx.fx?.chips?.(pt, zone.kind === 'tank' ? 0xff4422 : 0xffaa44, 6);
    this.ctx.hud?.hitMarker?.(zone.hp <= 0 || p.hp <= 0 ? 'kill' : isWeak ? 'armorThrough' : 'armor');
    this.ctx.audio?.play?.(isWeak ? 'vehicle_weak_point' : 'hit_marker_armor', { position: pt, volume: 0.7 });

    if (zone.hp <= 0 && !zone.destroyed) {
      zone.destroyed = true;
      if (p.kind === 'tanker' && zone.kind === 'tank') {
        this.destroyPursuer(p, 'tanker_blast');
        return true;
      }
      if (zone.kind === 'tire') {
        if (p.kind === 'tanker') {
          this.destroyPursuer(p, 'tanker_blast');
          return true;
        }
        // Cruiser: instant spin-out barrel-roll! BearCat: popping a tire deals massive instability / flips when <= 55% or 2 tires
        const brokenTires = p.zones.filter(z => z.kind === 'tire' && z.destroyed).length;
        if (p.kind === 'cruiser' || brokenTires >= 2 || p.hp <= p.maxHp * 0.55) {
          this.destroyPursuer(p, 'tire_flip');
          return true;
        }
        this.ctx.hud?.feed?.('BEARCAT TIRE SHREDDED!', '#ffcf56');
      } else if (zone.kind === 'engine') {
        this.destroyPursuer(p, p.kind === 'tanker' ? 'tanker_blast' : 'engine_flip');
        return true;
      } else if (zone.kind === 'cab') {
        this.destroyPursuer(p, p.kind === 'tanker' ? 'tanker_blast' : 'driver_swerve');
        return true;
      }
    }

    if (p.hp <= 0) {
      this.destroyPursuer(p, p.kind === 'tanker' ? 'tanker_blast' : 'chassis_blast');
      return true;
    }
    return false;
  }

  /** Destroys a pursuer with the given locational destruction choreography. */
  destroyPursuer(p: HighwayPursuer, mode: DestructionMode): void {
    if (!p.alive) return;
    p.alive = false;
    const idx = this._pursuers.indexOf(p);
    if (idx >= 0) this._pursuers.splice(idx, 1);

    const pos = p.position.clone();
    const towardBarrier = pos.x < HIGHWAY_ORIGIN[0] ? -1 : 1;

    // Immediate effects by destruction mode
    if (mode === 'tanker_blast') {
      this.detonateFuelTanker(pos);
    } else if (mode === 'tire_flip') {
      this.ctx.fx?.sparks?.(pos, UP, 20, 0xffaa33);
      this.ctx.audio?.play?.('plate_destroyed', { position: pos, volume: 0.85 });
      this.ctx.hud?.feed?.('TIRE BLOWN — SPIN-OUT!', '#ffcf56');
    } else if (mode === 'engine_flip') {
      this.ctx.fx?.explosion?.(pos, { radius: 5.5, kind: 'barrel', scale: 1.0 });
      this.ctx.audio?.play?.('explosion_barrel', { position: pos, volume: 0.85 });
      this.ctx.hud?.feed?.('ENGINE SHREDDED — AIRBORNE FLIP!', '#ff9438');
    } else if (mode === 'driver_swerve') {
      this.ctx.audio?.play?.('vehicle_horn', { position: pos, volume: 0.75 });
      this.ctx.hud?.feed?.('DRIVER DOWN — OUT OF CONTROL!', '#ffcf56');
    } else {
      this.ctx.fx?.explosion?.(pos, { radius: 6.5, kind: 'barrel', scale: 1.2 });
      this.ctx.audio?.play?.('vehicle_explode', { position: pos, volume: 0.88 });
      this.ctx.camera?.addTrauma?.(0.24);
      this.ctx.hud?.feed?.(p.kind === 'bearcat' ? 'SWAT BEARCAT DESTROYED!' : 'INTERCEPTOR WRECKED!', '#7ee787');
    }

    // Turn the vehicle mesh into an animated tumbling wreck!
    const vel = new THREE.Vector3();
    const angVel = new THREE.Vector3();
    let swerveDir = towardBarrier;

    if (mode === 'tire_flip') {
      vel.set(towardBarrier * 14, 5.2, 16);
      angVel.set(2.5, towardBarrier * 4.5, -towardBarrier * 8.5);
    } else if (mode === 'engine_flip') {
      vel.set(rand(-3, 3), 11.2, 18);
      angVel.set(-7.8, rand(-2, 2), rand(-3, 3));
    } else if (mode === 'driver_swerve') {
      // Swerve toward nearest neighboring pursuer if one exists, else into barrier
      let bestTarget: HighwayPursuer | null = null;
      let bestD = 16;
      for (const other of this._pursuers) {
        if (!other.alive) continue;
        const d = Math.hypot(other.position.x - pos.x, other.position.z - pos.z);
        if (d < bestD) {
          bestD = d;
          bestTarget = other;
        }
      }
      swerveDir = bestTarget ? (bestTarget.position.x >= pos.x ? 1 : -1) : towardBarrier;
      vel.set(swerveDir * 19, 0.5, 4);
      angVel.set(0, -swerveDir * 3.2, -swerveDir * 1.4);
    } else if (mode === 'tanker_blast') {
      vel.set(rand(-5, 5), 6.5, 24);
      angVel.set(-3.5, rand(-3, 3), rand(-4, 4));
    } else {
      vel.set(towardBarrier * 7, 5.5, 22);
      angVel.set(-4.0, rand(-3, 3), -towardBarrier * 5.0);
    }

    const wreck: HighwayWreck = {
      id: p.id,
      kind: p.kind,
      mode,
      root: p.root,
      position: pos,
      velocity: vel,
      angVel,
      age: 0,
      maxAge: 3.4,
      exploded: mode === 'chassis_blast' || mode === 'tanker_blast',
      ramActive: mode === 'driver_swerve',
      swerveDir,
      smokeTimer: 0,
    };
    this._wrecks.push(wreck);
  }

  private detonateFuelTanker(center: THREE.Vector3): void {
    const R = HIGHWAY_CONSTANTS.tankerBlastRadius;
    this.ctx.fx?.explosion?.(center, { radius: R, kind: 'hellfire', scale: 2.1 });
    this.ctx.render?.lights?.flash?.(center, 0xff7722, 34, 48, 0.55);
    this.ctx.audio?.play?.('explosion_tank', { position: center, volume: 1.0 });
    this.ctx.audio?.play?.('vehicle_explode', { position: center, volume: 0.95 });
    this.ctx.camera?.addTrauma?.(0.68);
    this.ctx.hud?.feed?.('FUEL TANKER DETONATED — MASSIVE FIREBALL!', '#ff6b3d');

    // Chain-blast every nearby living pursuer within 16 m!
    const snapshot = [...this._pursuers];
    for (const other of snapshot) {
      if (!other.alive) continue;
      const d = other.position.distanceTo(center);
      if (d > R) continue;
      if (other.kind === 'cruiser') {
        this.destroyPursuer(other, 'chassis_blast');
      } else if (other.kind === 'tanker') {
        this.destroyPursuer(other, 'tanker_blast');
      } else if (other.kind === 'bearcat') {
        other.hp = Math.max(0, other.hp - HIGHWAY_CONSTANTS.tankerBearcatDamage);
        this.ctx.fx?.sparks?.(other.position, UP, 14, 0xff8833);
        if (other.hp <= 0) {
          this.destroyPursuer(other, 'chassis_blast');
        }
      }
    }
  }

  private updateWrecks(dt: number): void {
    const minX = HIGHWAY_ORIGIN[0] - HIGHWAY_HALF_WIDTH + 1.4;
    const maxX = HIGHWAY_ORIGIN[0] + HIGHWAY_HALF_WIDTH - 1.4;

    for (let i = this._wrecks.length - 1; i >= 0; i--) {
      const w = this._wrecks[i]!;
      w.age += dt;
      w.velocity.y -= 22 * dt;
      w.position.addScaledVector(w.velocity, dt);

      // Floor bounce
      if (w.position.y <= LV.highway) {
        w.position.y = LV.highway;
        if (w.velocity.y < -3.5) {
          w.velocity.y = -w.velocity.y * 0.3;
          this.ctx.audio?.play?.('wreck_land', { position: w.position, volume: 0.75 });
          this.ctx.fx?.sparks?.(w.position, UP, 12, 0xffaa33);
          if (!w.exploded && w.mode === 'engine_flip') {
            this.explodeWreck(w);
          }
        } else {
          w.velocity.y = 0;
        }
      }

      // Driver-snipe swerve ram check against neighboring pursuers!
      if (w.ramActive && w.age < 1.2) {
        const snapshot = [...this._pursuers];
        for (const other of snapshot) {
          if (!other.alive) continue;
          const d = Math.hypot(other.position.x - w.position.x, other.position.z - w.position.z);
          if (d <= 3.4) {
            w.ramActive = false;
            this.ctx.hud?.feed?.('RAM KILL — PILE-UP!', '#ffcf56');
            if (other.kind === 'tanker') {
              this.destroyPursuer(other, 'tanker_blast');
            } else if (other.kind === 'cruiser') {
              this.destroyPursuer(other, 'chassis_blast');
            } else {
              other.hp = Math.max(0, other.hp - 160);
              if (other.hp <= 0) this.destroyPursuer(other, 'chassis_blast');
            }
            this.explodeWreck(w);
            break;
          }
        }
      }

      // Jersey barrier slam -> fireball explosion!
      if (w.position.x <= minX || w.position.x >= maxX) {
        w.position.x = clamp(w.position.x, minX, maxX);
        w.velocity.x *= -0.35;
        w.velocity.z = Math.max(w.velocity.z, 22);
        w.ramActive = false;
        if (!w.exploded) {
          this.explodeWreck(w);
        }
      }

      // Tumbling rotation
      _euler.set(w.angVel.x * dt, w.angVel.y * dt, w.angVel.z * dt);
      _stepQ.setFromEuler(_euler);
      w.root.quaternion.multiply(_stepQ);
      w.root.position.copy(w.position);

      w.smokeTimer -= dt;
      if (w.smokeTimer <= 0) {
        w.smokeTimer = 0.14;
        this.ctx.fx?.smoke?.(w.position, 0x1e1d1c, 1.5, 1.3);
      }

      if (w.age >= w.maxAge || w.position.z > HIGHWAY_ORIGIN[2] + 78) {
        w.root.removeFromParent();
        this._wrecks.splice(i, 1);
      }
    }
  }

  private explodeWreck(w: HighwayWreck): void {
    if (w.exploded) return;
    w.exploded = true;
    this.ctx.fx?.explosion?.(w.position, { radius: 6, kind: 'barrel', scale: 1.25 });
    this.ctx.audio?.play?.('vehicle_explode', { position: w.position, volume: 0.85 });
    this.ctx.camera?.addTrauma?.(0.26);
    w.velocity.y = Math.max(w.velocity.y, 4.5);
    w.velocity.z = Math.max(w.velocity.z, 22);
  }

  private checkWaveCompletion(): void {
    if (this.remainingPursuers > 0) return;
    if (this._phase === 'wave1' && !this.wave1Signalled) {
      this.wave1Signalled = true;
      this.ctx.hud?.feed?.('INTERCEPTOR PACK CLEARED!', '#7ee787');
      this.onSignal('bk:highway_wave1_done');
    } else if (this._phase === 'wave2' && !this.wave2Signalled) {
      this.wave2Signalled = true;
      this.ctx.hud?.feed?.('SWAT CONVOY ANNIHILATED!', '#7ee787');
      this.onSignal('bk:highway_wave2_done');
    }
  }

  // ---- Extraction Tunnel ------------------------------------------------------------------------

  private updateTunnel(dt: number): void {
    this.tunnelElapsed += dt;
    const t = clamp(this.tunnelElapsed / HIGHWAY_CONSTANTS.tunnelDuration);
    this.scrollSpeed = lerp(HIGHWAY_CONSTANTS.scrollSpeed, HIGHWAY_CONSTANTS.tunnelSpeed, t);

    if (this.tunnelPortal) {
      this.tunnelPortal.position.z = lerp(-76, 6, t);
    }

    // Smooth white-out flash over the final 1.2 s
    const flashAlpha = clamp((t - 0.35) / 0.65);
    if (this.hud) {
      this.hud.flash.style.opacity = flashAlpha.toFixed(3);
    }
    if (t >= 0.65 && !this.tunnelSignalled) {
      this.ctx.render?.post?.flash?.('#ffffff', 0.95, 0.9);
    }

    if (this.tunnelElapsed >= HIGHWAY_CONSTANTS.tunnelDuration && !this.tunnelSignalled) {
      this.tunnelSignalled = true;
      this._phase = 'complete';
      this.dismount(false);
      this.root.visible = false;
      if (this.hud) {
        this.hud.root.classList.remove('on');
        this.hud.flash.style.opacity = '0';
      }
      this.onSignal('bk:tunnel_complete');
    }
  }

  // ---- HUD & Cleanup ----------------------------------------------------------------------------

  private updateHud(): void {
    const hud = this.hud;
    if (!hud) return;

    const kmh = Math.round(this.scrollSpeed * 3.6);
    hud.speed.set(`${kmh} KM/H`);

    if (this._phase === 'wave1') {
      hud.wave.set(`WAVE 1 — INTERCEPTORS: ${this.remainingPursuers} LEFT`);
    } else if (this._phase === 'wave2') {
      hud.wave.set(`WAVE 2 — SWAT CONVOY: ${this.remainingPursuers} LEFT`);
    } else if (this._phase === 'boss') {
      hud.wave.set('BOSS INTERCEPT — AUDITOR-1');
    } else if (this._phase === 'tunnel') {
      hud.wave.set('PORT EXTRACTION TUNNEL');
    }

    const hullFrac = clamp(this._hull / this.maxHull);
    hud.hullText.set(`${Math.ceil(this._hull)} / ${this.maxHull}`);
    hud.hullFill.style.transform = `scaleX(${hullFrac.toFixed(4)})`;
    hud.hullFill.classList.toggle('low', hullFrac < 0.3);

    const heatPct = Math.round(this.heat.value * 100);
    hud.heatText.set(this.heat.overheated ? 'OVERHEAT — VENTING' : `${heatPct}%`);
    hud.heatText.el.classList.toggle('bk-hw-overheat', this.heat.overheated);
    hud.heatFill.style.transform = `scaleX(${clamp(this.heat.value).toFixed(4)})`;
    hud.heatFill.classList.toggle('hot', this.heat.overheated || this.heat.value > 0.8);

    hud.reticle.classList.toggle('zoom', this._zoomed);
  }

  private clearEntities(): void {
    for (const p of this._pursuers) p.root.removeFromParent();
    this._pursuers.length = 0;
    for (const w of this._wrecks) w.root.removeFromParent();
    this._wrecks.length = 0;
    for (const r of this._rockets) r.mesh.removeFromParent();
    this._rockets.length = 0;
    this.spawnQueue.length = 0;
  }
}
