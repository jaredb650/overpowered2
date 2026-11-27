/**
 * Physics-enabled structural destruction engine for OVERPOWERED 2.
 *
 * Combines *The Finals* (localized impact-centered fracture, gradual hinged sagging, exposed rebar),
 * *Red Faction: Guerrilla* (4-pass structural integrity solver with support-polygon tipping, cantilever
 * shear, and compressive column buckling cascades), and *Battlefield* (material-vs-damage matrix,
 * tank smash-through on light/masonry walls vs bunker deflection, persistent walkable rubble mounds).
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import {
  CG,
  type Ctx,
  type DestructionManagerLike,
  type DestructionTier,
  type StructuralClusterLike,
  type StructuralMaterial,
  type SurfaceKind,
  type VehicleRamClass,
  type VehicleRamResult,
} from '../core/contracts';
import type { EnemyInstance } from '../core/gameplay';
import { clamp } from '../core/math';
import { groups } from '../physics/Physics';
import type { Mat } from './kit/geo';
import type { NavGraph } from './nav';
import {
  applyBreakFractureDeform,
  buildFractureCellGeometry,
  buildSubdividedBoxGeometry,
  deformNodeGeometry,
  inferMaterialClass,
  MAX_SPLINTERS,
  planPanelFracture,
  resolveFractureGrid,
  SplinterPool,
  type FractureGridPlan,
  type MaterialClass,
  type SplinterKind,
} from './fracture';
import {
  blockedHintFor,
  canDamageMaterial,
  canDamageTier,
  canVehicleRamMaterial,
  classifyDamageSource,
  damageMultiplierFor,
  damageMultiplierForMaterial,
  DESTRUCTION_SOURCE_MULT,
  ramSourceFor,
  resolveStructuralMaterial,
  STRUCTURAL_MATERIAL_PROPS,
} from './destructionMaterials';
import {
  computeInitialSupportMetadata,
  computeNodeLoadCapacity,
  computeNodeMass,
  inferSupportRole,
  solveStructuralIntegrity,
  type SupportRole,
} from './structuralSolver';

export type { DestructionTier, MaterialClass, StructuralMaterial, SupportRole, VehicleRamClass, VehicleRamResult };
export {
  canDamageMaterial,
  canDamageTier,
  canVehicleRamMaterial,
  classifyDamageSource,
  damageMultiplierFor,
  damageMultiplierForMaterial,
  DESTRUCTION_SOURCE_MULT,
  MAX_SPLINTERS,
  resolveStructuralMaterial,
  STRUCTURAL_MATERIAL_PROPS,
};

export type DestructionTierName = 'timber' | 'masonry' | 'heavy' | 'reinforced';

export const DESTRUCTION_TIER_NAMES: Readonly<Record<DestructionTier, DestructionTierName>> = {
  0: 'timber',
  1: 'masonry',
  2: 'heavy',
  3: 'reinforced',
};

export type StructuralNodeKind =
  | 'column'
  | 'wall'
  | 'slab'
  | 'roof'
  | 'catwalk'
  | 'hazard'
  | 'craneBoom'
  | 'tower';

export type StructuralNodeState = 'intact' | 'tilting' | 'falling' | 'settled' | 'gone';

/** Cap on simultaneously active dynamic falling structural rigid bodies for steady 60 FPS even during Nuke sweeps. */
export const MAX_DYNAMIC_BODIES = 96;
/** Cap on persistent walkable rubble mounds left behind by collapsed masonry/concrete buildings. */
export const MAX_RUBBLE_MOUNDS = 24;
/** Expanding shockwave ring speed (m/s) for Nuke structural sweeps. */
export const NUKE_SWEEP_SPEED = 115;
/** Kinetic speed threshold (m/s) above which a falling chunk deals lethal crush damage to enemies. */
const CRUSH_SPEED = 4.5;
const CRUSH_DAMAGE = 350;
/** Edge falloff fraction for radial structural blasts (matches Structures.EDGE). */
const BLAST_EDGE = 0.4;
/** Default fraction of nodes gone before a cluster is marked collapsed & liquidated. */
const DEFAULT_COLLAPSE_THRESHOLD = 0.65;
/** Maximum dynamic lifetime (seconds) before a chunk settles into static rubble and releases its rigid body. */
const DYNAMIC_MAX_AGE = 6.0;
const DYNAMIC_STILL_TIME = 1.1;
/** Minimum intact node count in a cluster to enable merged per-material intact batch rendering. */
const BATCH_MIN_NODES = 16;

// ---------------------------------------------------------------------------------------------
// Cluster & Node Types
// ---------------------------------------------------------------------------------------------

export type Vec3Like = THREE.Vector3 | readonly [number, number, number];

export interface StructuralNodeSpec {
  id: string;
  pos: Vec3Like;
  half: Vec3Like;
  mat: Mat;
  color?: number | readonly [number, number, number];
  hp: number;
  tier: DestructionTier;
  anchored: boolean;
  /** Optional list of node IDs this node is structurally connected to (undirected edge). */
  supports?: readonly string[];
  kind: StructuralNodeKind;
  yaw?: number;
  pitch?: number;
  roll?: number;
  /** Optional secondary blast parameters when `kind === 'hazard'`. */
  hazardRadius?: number;
  hazardDamage?: number;
  /** Kinetic impact blast radius when a heavy piece slams down (e.g. craneBoom, roof, slab). */
  impactRadius?: number;
  impactDamage?: number;
  /** Optional liquidation value for breaking this individual node if desired. */
  value?: number;
  label?: string;
  /** If true, breaking this node collapses the entire cluster immediately. */
  keyNode?: boolean;
  /** Optional material class hint for splinter/bend/shatter fracture dynamics. */
  materialClass?: 'wood' | 'metal' | 'concrete' | 'stone';
  /** Physical structural material governing weapon/vehicle damage susceptibility, mass, and cantilever limits. */
  structuralMaterial?: StructuralMaterial;
  /** Structural support role: `infill` (drywall/glass/parapets) never transmits support to hold up upper slabs. */
  supportRole?: SupportRole;
  /** Optional explicit vertical compressive load capacity (kg) for columns/bearing walls. */
  loadCapacity?: number;
  /** Optional `[cols, rows]` subdivision grid hint for localized irregular panel fracturing. */
  fractureGrid?: readonly [number, number];
  /** If true, spawns as 1 collider and fractures lazily around the exact impact point on first damaging hit. */
  lazyFracture?: boolean;
  /** If true, marks NavGraph blocked while intact and unblocks AI pathing when breached. */
  navBlock?: boolean;
  /** If true, marks elevated NavGraph cells blocked when this floor/stair/ramp collapses. */
  navWalkable?: boolean;
}

export interface StructuralClusterSpec {
  id?: string;
  tag?: string;
  kind: string;
  label?: string;
  value?: number;
  spawnPoint?: Vec3Like;
  nodes: readonly StructuralNodeSpec[];
  /** Undirected structural support edges between node IDs. Merged with per-node `supports`. */
  links?: readonly (readonly [string, string])[];
  /** Fraction of nodes non-intact required to collapse the cluster (defaults to 0.65). */
  collapseThreshold?: number;
  /** Temporary static colliders placed before navGraph.build() for elevated walkable floors/stairs; removed when the cluster spawns. */
  navProxies?: RAPIER.Collider[];
  /** Force batched intact rendering on or off (defaults to auto when node count >= BATCH_MIN_NODES). */
  batched?: boolean;
  onCollapse?: (cluster: StructuralCluster) => void;
}

export interface StructuralNode {
  readonly id: string;
  /** Original spec node ID (equals `id` unless this node is a subdivided fracture cell `${origId}#k`). */
  readonly origId: string;
  readonly clusterId: string;
  readonly spec: StructuralNodeSpec;
  readonly basePos: THREE.Vector3;
  readonly half: THREE.Vector3;
  readonly baseQuat: THREE.Quaternion;
  readonly mat: Mat;
  readonly materialClass: MaterialClass;
  readonly structuralMaterial: StructuralMaterial;
  readonly supportRole: SupportRole;
  readonly mass: number;
  readonly loadCapacity: number;
  readonly isFractureCell: boolean;
  readonly lazyFracture: boolean;
  readonly navBlock: boolean;
  readonly navWalkable: boolean;
  navBlocked: boolean;
  initialSupportCount: number;
  initialAnchoredSupportCount: number;
  readonly tier: DestructionTier;
  readonly anchored: boolean;
  readonly kind: StructuralNodeKind;
  readonly maxHp: number;
  readonly keyNode: boolean;
  /** Cached pristine rest vertex positions for zero-allocation in-place DMM deformation. */
  readonly restPositions: Float32Array;
  /** Cached pristine rest RGBA vertex colors for crack/crease darkening. */
  readonly restColors: Uint8Array;
  hp: number;
  state: StructuralNodeState;
  batched: boolean;
  deformStrain: number;
  deformStage: number;
  readonly bendDirLocal: THREE.Vector3;
  readonly lastImpactLocal: THREE.Vector3;
  mesh: THREE.Mesh | null;
  staticCollider: RAPIER.Collider | null;
  dynamicBody: RAPIER.RigidBody | null;
  // Gradual hinged sagging state
  tiltElapsed: number;
  tiltDuration: number;
  tiltMaxAngle: number;
  tiltFxTimer: number;
  tiltBendApplied: boolean;
  readonly tiltAxis: THREE.Vector3;
  readonly tiltHingeOffset: THREE.Vector3;
  tiltBlastOrigin: THREE.Vector3 | null;
  tiltIsNuke: boolean;
}

export class StructuralCluster implements StructuralClusterLike {
  readonly id: string;
  readonly tag?: string;
  readonly kind: string;
  readonly label: string;
  readonly value: number;
  readonly spawnPoint?: THREE.Vector3;
  readonly collapseThreshold: number;
  readonly onCollapse?: (cluster: StructuralCluster) => void;
  readonly nodes: StructuralNode[] = [];
  readonly byId = new Map<string, StructuralNode>();
  /** Maps original spec node ID -> its cell nodes (1 entry if unsubdivided, cols*rows if fractured). */
  readonly cellGroups = new Map<string, StructuralNode[]>();
  readonly adjacency = new Map<string, Set<string>>();
  readonly batchMeshes: THREE.Mesh[] = [];
  batchEnabled = false;
  batchDirty = false;
  readonly center = new THREE.Vector3();
  radius = 0;
  collapsed = false;
  lastGroanAt = -10;

  constructor(readonly spec: StructuralClusterSpec, id: string) {
    this.id = id;
    this.tag = spec.tag;
    this.kind = spec.kind;
    this.label = spec.label ?? spec.kind.toUpperCase();
    this.value = spec.value ?? 100_000;
    this.spawnPoint = spec.spawnPoint ? toVec3(spec.spawnPoint) : undefined;
    this.collapseThreshold = spec.collapseThreshold ?? DEFAULT_COLLAPSE_THRESHOLD;
    this.onCollapse = spec.onCollapse;
  }

  get intactCount(): number {
    let n = 0;
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.nodes[i]!.state === 'intact') n++;
    }
    return n;
  }

  get destroyedFraction(): number {
    if (this.nodes.length === 0) return 1;
    return (this.nodes.length - this.intactCount) / this.nodes.length;
  }

  /**
   * Matches an exact node ID (including `${origId}#k`), or returns the first surviving intact cell
   * (or first cell if none are intact) when queried by a subdivided parent's original ID.
   */
  getNode(id: string): StructuralNode | undefined {
    const exact = this.byId.get(id);
    if (exact) return exact;
    const group = this.cellGroups.get(id);
    if (!group || group.length === 0) return undefined;
    for (let i = 0; i < group.length; i++) {
      if (group[i]!.state === 'intact') return group[i]!;
    }
    return group[0];
  }

  /** Returns all fracture cells (or the single node) originating from `origId`. */
  getNodes(origId: string): readonly StructuralNode[] {
    const group = this.cellGroups.get(origId);
    if (group) return group;
    const exact = this.byId.get(origId);
    return exact ? [exact] : [];
  }
}

interface DynamicEntry {
  cluster: StructuralCluster;
  node: StructuralNode;
  body: RAPIER.RigidBody;
  age: number;
  stillTime: number;
  peakSpeed: number;
  impactRadius: number;
  impactDamage: number;
  impactTriggered: boolean;
  readonly crushedUids: Set<number>;
}

interface BucklingEntry {
  cluster: StructuralCluster;
  node: StructuralNode;
  delay: number;
  origin: THREE.Vector3 | null;
}

interface RubbleMound {
  mesh: THREE.Mesh;
  geom: THREE.BufferGeometry;
  collider: RAPIER.Collider | null;
}

interface PendingHazard {
  pos: THREE.Vector3;
  radius: number;
  damage: number;
  delay: number;
}

interface NukeSweepState {
  epicenter: THREE.Vector3;
  radius: number;
  maxRadius: number;
  speed: number;
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Color();

function toVec3(v: Vec3Like, out = new THREE.Vector3()): THREE.Vector3 {
  if (v instanceof THREE.Vector3) return out.copy(v);
  return out.set(v[0], v[1], v[2]);
}

function surfaceForMat(mat: Mat): SurfaceKind {
  switch (mat) {
    case 'steel':
    case 'steelDark':
    case 'rust':
    case 'hazard':
    case 'panel':
      return 'metal';
    case 'grate':
      return 'grate';
    case 'glass':
      return 'glass';
    case 'plywood':
    case 'dirt':
      return 'dirt';
    default:
      return 'concrete';
  }
}

/**
 * Registers temporary static colliders for every `navWalkable` node (elevated slabs, stairs, driveable ramps,
 * watchtower decks) in `clusters` so `NavGraph.build()` discovers multi-story walkable areas before
 * `DestructionManager.addCluster()` spawns the live destructible colliders.
 * Call the returned cleanup callback right after `NavGraph.build()` completes.
 */
export function registerDestructionNavProxies(
  physics: Ctx['physics'],
  clusters: readonly StructuralClusterSpec[],
): () => void {
  const created: RAPIER.Collider[] = [];
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i]!;
    for (let j = 0; j < c.nodes.length; j++) {
      const ns = c.nodes[j]!;
      if (!ns.navWalkable) continue;
      const pos = toVec3(ns.pos);
      const half = toVec3(ns.half);
      const quat = new THREE.Quaternion().setFromEuler(e.set(ns.pitch ?? 0, ns.yaw ?? 0, ns.roll ?? 0, 'YXZ'));
      created.push(physics.addStaticBox(pos, half, quat, surfaceForMat(ns.mat)));
    }
  }
  const flush = (physics as { flushQueries?: () => void }).flushQueries;
  if (created.length > 0) flush?.call(physics);
  return () => {
    for (let i = 0; i < created.length; i++) {
      physics.world.removeCollider(created[i]!, true);
    }
    if (created.length > 0) flush?.call(physics);
  };
}

function chipColorFor(mat: Mat, color?: number | readonly [number, number, number]): number {
  if (typeof color === 'number') return color;
  if (Array.isArray(color)) return _c.setRGB(color[0], color[1], color[2]).getHex();
  switch (mat) {
    case 'plywood':
      return 0x9b7a4a;
    case 'steel':
    case 'steelDark':
    case 'grate':
      return 0x525a66;
    case 'rust':
      return 0x7c4a32;
    case 'paintRed':
      return 0xa83830;
    case 'paintYellow':
    case 'hazard':
      return 0xc99c2e;
    default:
      return 0x8c877d;
  }
}

const DOWN = new THREE.Vector3(0, -1, 0);
const _mat4 = new THREE.Matrix4();
const _normMat3 = new THREE.Matrix3();
const _scaleOne = new THREE.Vector3(1, 1, 1);

function densityFor(material: StructuralMaterial): number {
  return STRUCTURAL_MATERIAL_PROPS[material].density;
}

function defaultImpactRadius(node: StructuralNode): number {
  if (node.spec.impactRadius !== undefined) return node.spec.impactRadius;
  if (node.kind === 'craneBoom') return 14;
  if (node.kind === 'tower') return 10;
  if (node.kind === 'roof' || node.kind === 'slab') {
    const vol = node.half.x * node.half.y * node.half.z * 8;
    return vol >= 16 ? 8.5 : 0;
  }
  return 0;
}

function splinterKindFor(materialClass: MaterialClass): SplinterKind {
  if (materialClass === 'wood') return 'wood';
  if (materialClass === 'metal') return 'metal';
  return 'concrete';
}

function isHeavyMetalNode(node: StructuralNode): boolean {
  return node.structuralMaterial === 'heavy_steel' || (node.materialClass === 'metal' && node.tier >= 2);
}

function breakSfxFor(node: StructuralNode): string {
  if (node.structuralMaterial === 'glass') return 'glass_break';
  if (node.structuralMaterial === 'drywall') return 'wood_crunch';
  if (node.materialClass === 'wood') return 'wood_destroyed';
  if (node.materialClass === 'metal' || node.structuralMaterial === 'heavy_steel') {
    return isHeavyMetalNode(node) ? 'metal_plate_destroyed' : 'sheet_metal_destroyed';
  }
  return 'concrete_destroyed';
}

function clusterCollapseSfxFor(cluster: StructuralCluster): string {
  let concrete = 0;
  let heavyMetal = 0;
  let sheetMetal = 0;
  let wood = 0;
  for (let i = 0; i < cluster.nodes.length; i++) {
    const n = cluster.nodes[i]!;
    if (n.structuralMaterial === 'glass' || n.structuralMaterial === 'drywall') continue;
    if (isHeavyMetalNode(n)) heavyMetal++;
    else if (n.materialClass === 'metal') sheetMetal++;
    else if (n.materialClass === 'wood') wood++;
    else concrete++;
  }
  if (concrete >= heavyMetal && concrete >= sheetMetal && concrete >= wood && concrete > 0) {
    return 'concrete_destroyed';
  }
  if (heavyMetal >= sheetMetal && heavyMetal >= wood && heavyMetal > 0) {
    return 'metal_plate_destroyed';
  }
  if (sheetMetal >= wood && sheetMetal > 0) {
    return 'sheet_metal_destroyed';
  }
  return wood > 0 ? 'wood_destroyed' : 'concrete_destroyed';
}

function distanceToOrientedBox(
  point: THREE.Vector3,
  center: THREE.Vector3,
  half: THREE.Vector3,
  quat: THREE.Quaternion,
): number {
  _v.subVectors(point, center);
  _q.copy(quat).invert();
  _v.applyQuaternion(_q);
  const ex = Math.max(0, Math.abs(_v.x) - half.x);
  const ey = Math.max(0, Math.abs(_v.y) - half.y);
  const ez = Math.max(0, Math.abs(_v.z) - half.z);
  return Math.hypot(ex, ey, ez);
}

/** Approximate surface-to-surface distance between two structural nodes for linking subdivided cell groups. */
function pairNodeDistance(a: StructuralNode, b: StructuralNode): number {
  const dAB = distanceToOrientedBox(a.basePos, b.basePos, b.half, b.baseQuat);
  const dBA = distanceToOrientedBox(b.basePos, a.basePos, a.half, a.baseQuat);
  return Math.min(dAB, dBA);
}

/** Computes damage multiplier for a structural node, keeping Tier-0 volatile hazards (ammo crates) shootable by rifles. */
function nodeDamageMultiplier(node: StructuralNode, source: string): number {
  const mult = damageMultiplierForMaterial(node.structuralMaterial, source);
  if (mult > 0) return mult;
  if (node.kind === 'hazard' && node.tier === 0) return 1.0;
  return 0;
}

/** Merges a list of intact batched structural nodes sharing a `Mat` into a single world-space BufferGeometry. */
function mergeIntactBatchGeometry(nodes: readonly StructuralNode[]): THREE.BufferGeometry | null {
  let totalVerts = 0;
  let totalIndices = 0;
  for (let i = 0; i < nodes.length; i++) {
    const geom = nodes[i]!.mesh?.geometry;
    if (!geom) continue;
    const pos = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos) continue;
    totalVerts += pos.count;
    const idx = geom.getIndex();
    totalIndices += idx ? idx.count : pos.count;
  }
  if (totalVerts === 0 || totalIndices === 0) return null;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const colors = new Uint8Array(totalVerts * 4);
  const indices = new Uint32Array(totalIndices);

  let vOffset = 0;
  let iOffset = 0;
  for (let nIdx = 0; nIdx < nodes.length; nIdx++) {
    const node = nodes[nIdx]!;
    const geom = node.mesh?.geometry;
    if (!geom) continue;
    const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
    const nrmAttr = geom.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const uvAttr = geom.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const colAttr = geom.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!posAttr) continue;

    _mat4.compose(node.basePos, node.baseQuat, _scaleOne);
    _normMat3.getNormalMatrix(_mat4);

    const vCount = posAttr.count;
    const pArr = posAttr.array as Float32Array;
    const nArr = nrmAttr ? (nrmAttr.array as Float32Array) : null;
    const uArr = uvAttr ? (uvAttr.array as Float32Array) : null;
    const cArr = colAttr ? (colAttr.array as Uint8Array) : null;

    for (let v = 0; v < vCount; v++) {
      const o3 = v * 3;
      const d3 = (vOffset + v) * 3;
      _v.set(pArr[o3]!, pArr[o3 + 1]!, pArr[o3 + 2]!).applyMatrix4(_mat4);
      positions[d3] = _v.x;
      positions[d3 + 1] = _v.y;
      positions[d3 + 2] = _v.z;

      if (nArr) {
        _v.set(nArr[o3]!, nArr[o3 + 1]!, nArr[o3 + 2]!).applyMatrix3(_normMat3).normalize();
        normals[d3] = _v.x;
        normals[d3 + 1] = _v.y;
        normals[d3 + 2] = _v.z;
      } else {
        normals[d3] = 0;
        normals[d3 + 1] = 1;
        normals[d3 + 2] = 0;
      }

      const d2 = (vOffset + v) * 2;
      if (uArr) {
        uvs[d2] = uArr[v * 2]!;
        uvs[d2 + 1] = uArr[v * 2 + 1]!;
      }

      const d4 = (vOffset + v) * 4;
      if (cArr) {
        const c4 = v * 4;
        colors[d4] = cArr[c4]!;
        colors[d4 + 1] = cArr[c4 + 1]!;
        colors[d4 + 2] = cArr[c4 + 2]!;
        colors[d4 + 3] = cArr[c4 + 3] ?? 255;
      } else {
        colors[d4] = 255;
        colors[d4 + 1] = 255;
        colors[d4 + 2] = 255;
        colors[d4 + 3] = 255;
      }
    }

    const idxAttr = geom.getIndex();
    if (idxAttr) {
      const arr = idxAttr.array;
      for (let k = 0; k < idxAttr.count; k++) {
        indices[iOffset++] = (arr[k] as number) + vOffset;
      }
    } else {
      for (let k = 0; k < vCount; k++) {
        indices[iOffset++] = k + vOffset;
      }
    }
    vOffset += vCount;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 4, true));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingSphere();
  return merged;
}

/** Builds a low walkable jagged concrete/brick rubble pile mesh (1 draw call) for collapsed buildings. */
function buildRubbleMoundGeometry(radius: number, height: number, colorHex: number): THREE.BufferGeometry {
  _c.setHex(colorHex);
  const cr = _c.r;
  const cg = _c.g;
  const cb = _c.b;

  const parts: { pos: [number, number, number]; half: [number, number, number]; yaw: number; pitch: number; shade: number }[] = [
    { pos: [0, height * 0.45, 0], half: [radius * 0.72, height * 0.48, radius * 0.65], yaw: 0.25, pitch: 0.08, shade: 0.76 },
    { pos: [-radius * 0.42, height * 0.34, radius * 0.28], half: [radius * 0.48, height * 0.36, radius * 0.42], yaw: -0.55, pitch: -0.14, shade: 0.86 },
    { pos: [radius * 0.46, height * 0.32, -radius * 0.22], half: [radius * 0.45, height * 0.35, radius * 0.46], yaw: 0.9, pitch: 0.16, shade: 0.72 },
    { pos: [radius * 0.14, height * 0.62, radius * 0.12], half: [radius * 0.36, height * 0.22, radius * 0.28], yaw: 1.4, pitch: -0.22, shade: 0.92 },
    { pos: [-radius * 0.24, height * 0.28, -radius * 0.44], half: [radius * 0.38, height * 0.28, radius * 0.34], yaw: 0.45, pitch: 0.12, shade: 0.80 },
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (const p of parts) {
    const b = new THREE.BoxGeometry(p.half[0] * 2, p.half[1] * 2, p.half[2] * 2);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.pitch, p.yaw, p.pitch * 0.5, 'YXZ'));
    _mat4.compose(new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]), q, _scaleOne);
    _normMat3.getNormalMatrix(_mat4);

    const pAttr = b.getAttribute('position') as THREE.BufferAttribute;
    const nAttr = b.getAttribute('normal') as THREE.BufferAttribute;
    const uAttr = b.getAttribute('uv') as THREE.BufferAttribute;
    const vStart = positions.length / 3;
    for (let i = 0; i < pAttr.count; i++) {
      _v.set(pAttr.getX(i), pAttr.getY(i), pAttr.getZ(i)).applyMatrix4(_mat4);
      positions.push(_v.x, Math.max(0.01, _v.y), _v.z);
      _v.set(nAttr.getX(i), nAttr.getY(i), nAttr.getZ(i)).applyMatrix3(_normMat3).normalize();
      normals.push(_v.x, _v.y, _v.z);
      uvs.push(uAttr.getX(i), uAttr.getY(i));
      colors.push(
        clamp(Math.round(cr * p.shade * 255), 0, 255),
        clamp(Math.round(cg * p.shade * 255), 0, 255),
        clamp(Math.round(cb * p.shade * 255), 0, 255),
        255,
      );
    }
    const idx = b.getIndex()!;
    for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + vStart);
    b.dispose();
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(colors), 4, true));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------------------------
// DestructionManager
// ---------------------------------------------------------------------------------------------

export type SecondaryBlastHook = (center: THREE.Vector3, radius: number, amount: number, source: string) => void;

export class DestructionManager implements DestructionManagerLike {
  readonly root = new THREE.Group();
  readonly splinters = new SplinterPool(MAX_SPLINTERS);
  private nav: NavGraph | null = null;
  private readonly clusters: StructuralCluster[] = [];
  private readonly byTag = new Map<string, StructuralCluster>();
  private readonly byCollider = new Map<number, { cluster: StructuralCluster; node: StructuralNode }>();
  private readonly tilting: { cluster: StructuralCluster; node: StructuralNode }[] = [];
  private readonly buckling: BucklingEntry[] = [];
  private readonly bucklingIds = new Set<string>();
  private readonly dynamicPool: DynamicEntry[] = [];
  private readonly rubbleMounds: RubbleMound[] = [];
  private readonly pendingHazards: PendingHazard[] = [];
  private readonly sweeps: NukeSweepState[] = [];
  private readonly nearEnemies: EnemyInstance[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly _t = { x: 0, y: 0, z: 0 };
  private readonly _r = { x: 0, y: 0, z: 0, w: 1 };
  private readonly _lv = { x: 0, y: 0, z: 0 };
  private readonly _crushPt = new THREE.Vector3();
  private readonly _crushDir = new THREE.Vector3();
  private shadowRefreshPending = false;
  private time = 0;
  private nextId = 1;
  private lastHintAt = -10;
  private lastBounceFxAt = -10;
  private lastClangAt = -10;

  constructor(
    private readonly ctx: Ctx,
    private readonly material: (m: Mat) => THREE.Material,
    private readonly onSecondaryBlast?: SecondaryBlastHook,
  ) {
    this.root.name = 'destruction';
    this.root.matrixAutoUpdate = false;
    this.root.updateMatrix();
    this.root.add(this.splinters.root);
  }

  /** Attaches the world NavGraph so breached ground walls unblock AI paths and collapsed floors block air paths. */
  attachNav(nav: NavGraph | null): void {
    this.nav = nav;
    if (!nav) return;
    for (let ci = 0; ci < this.clusters.length; ci++) {
      const cluster = this.clusters[ci]!;
      for (let ni = 0; ni < cluster.nodes.length; ni++) {
        const node = cluster.nodes[ni]!;
        if (node.state === 'intact' && node.navBlock && !node.navBlocked) {
          this.setNodeNavBlocked(node, true);
        }
      }
    }
  }

  private setNodeNavBlocked(node: StructuralNode, blocked: boolean): void {
    if (!this.nav) return;
    if (blocked && node.navBlocked) return;
    if (!blocked && !node.navBlocked) return;

    // Horizontal orientation unit vector along node's local X axis
    _v.set(1, 0, 0).applyQuaternion(node.baseQuat);
    const lenXZ = Math.hypot(_v.x, _v.z);
    const ux = lenXZ > 1e-4 ? _v.x / lenXZ : 1;
    const uz = lenXZ > 1e-4 ? _v.z / lenXZ : 0;
    const floorY = node.navWalkable
      ? node.basePos.y + node.half.y
      : Math.max(0, node.basePos.y - node.half.y);
    this.nav.setBlocked(
      node.basePos.x,
      node.basePos.z,
      floorY,
      ux,
      uz,
      node.half.x + 0.35,
      node.half.z + 0.35,
      blocked,
    );
    node.navBlocked = blocked;
  }

  private onNodeLostNavSync(node: StructuralNode): void {
    if (!this.nav) return;
    if (node.navBlock && node.navBlocked) {
      this.setNodeNavBlocked(node, false);
    }
    if (node.navWalkable && !node.navBlocked) {
      this.setNodeNavBlocked(node, true);
    }
  }

  private requestStaticShadowRefresh(): void {
    this.shadowRefreshPending = true;
  }

  private flushStaticShadowRefresh(): void {
    if (!this.shadowRefreshPending) return;
    this.shadowRefreshPending = false;
    (this.ctx.render as { refreshStaticShadows?: () => void } | undefined)?.refreshStaticShadows?.();
  }

  /** Number of currently active falling dynamic rigid bodies (always <= MAX_DYNAMIC_BODIES). */
  get activeDynamicBodies(): number {
    return this.dynamicPool.length;
  }

  /** Number of currently active pooled 3D splinters / shards (always <= MAX_SPLINTERS). */
  get activeSplinters(): number {
    return this.splinters.activeCount;
  }

  /** Number of active persistent walkable rubble mounds (always <= MAX_RUBBLE_MOUNDS). */
  get activeRubbleMounds(): number {
    return this.rubbleMounds.length;
  }

  /** Registers and spawns a new structural cluster into the world. */
  addCluster(spec: StructuralClusterSpec): StructuralCluster {
    if (spec.navProxies && spec.navProxies.length > 0) {
      for (const proxy of spec.navProxies) {
        this.ctx.physics.world.removeCollider(proxy, false);
      }
      spec.navProxies.length = 0;
    }
    const id = spec.id ?? `cluster_${this.nextId++}`;
    const cluster = new StructuralCluster(spec, id);
    this.buildClusterRuntime(cluster);
    this.clusters.push(cluster);
    if (cluster.tag) this.byTag.set(cluster.tag, cluster);
    return cluster;
  }

  private createStaticCellCollider(
    _geom: THREE.BufferGeometry,
    basePos: THREE.Vector3,
    half: THREE.Vector3,
    baseQuat: THREE.Quaternion,
    surface: SurfaceKind,
  ): RAPIER.Collider | null {
    return this.ctx.physics.addStaticBox(basePos, half, baseQuat, surface);
  }

  private clearClusterBatchMeshes(cluster: StructuralCluster): void {
    for (let i = 0; i < cluster.batchMeshes.length; i++) {
      const m = cluster.batchMeshes[i]!;
      this.root.remove(m);
      m.geometry.dispose();
    }
    cluster.batchMeshes.length = 0;
  }

  private rebuildClusterBatch(cluster: StructuralCluster): void {
    cluster.batchDirty = false;
    this.clearClusterBatchMeshes(cluster);
    if (!cluster.batchEnabled) return;

    const byMat = new Map<Mat, StructuralNode[]>();
    for (let i = 0; i < cluster.nodes.length; i++) {
      const n = cluster.nodes[i]!;
      if (n.state !== 'intact' || !n.batched) continue;
      let list = byMat.get(n.mat);
      if (!list) {
        list = [];
        byMat.set(n.mat, list);
      }
      list.push(n);
    }

    for (const [mat, list] of byMat) {
      const geom = mergeIntactBatchGeometry(list);
      if (!geom) continue;
      const mesh = new THREE.Mesh(geom, this.material(mat));
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.staticShadow = true;
      this.root.add(mesh);
      cluster.batchMeshes.push(mesh);
    }
    this.requestStaticShadowRefresh();
  }

  private flushDirtyBatches(): void {
    for (let i = 0; i < this.clusters.length; i++) {
      const c = this.clusters[i]!;
      if (c.batchDirty) this.rebuildClusterBatch(c);
    }
  }

  /** Promotes an intact batched node to its own live Three.js mesh on first deformation/tilt/break. */
  private promoteNodeFromBatch(cluster: StructuralCluster, node: StructuralNode): void {
    if (!node.batched) return;
    node.batched = false;
    if (node.mesh && node.mesh.parent !== this.root) {
      this.root.add(node.mesh);
    }
    if (cluster.batchEnabled) {
      cluster.batchDirty = true;
    }
  }

  private createNodeRecord(
    cluster: StructuralCluster,
    ns: StructuralNodeSpec,
    nodeId: string,
    basePos: THREE.Vector3,
    half: THREE.Vector3,
    baseQuat: THREE.Quaternion,
    anchored: boolean,
    geom: THREE.BufferGeometry,
    materialClass: MaterialClass,
    structuralMaterial: StructuralMaterial,
    isFractureCell: boolean,
    lazyFracture: boolean,
    navBlock: boolean,
    navWalkable: boolean,
    staticCollider: RAPIER.Collider | null,
    batched: boolean,
  ): StructuralNode {
    this.geometries.push(geom);
    const mesh = new THREE.Mesh(geom, this.material(ns.mat));
    mesh.position.copy(basePos);
    mesh.quaternion.copy(baseQuat);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.staticShadow = true;
    if (!batched) {
      this.root.add(mesh);
    }

    const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = geom.getAttribute('color') as THREE.BufferAttribute;
    const restPositions = new Float32Array(posAttr.array as Float32Array);
    const restColors = new Uint8Array(colAttr.array as Uint8Array);
    const supportRole = inferSupportRole(ns.kind, structuralMaterial, ns.supportRole);
    const mass = computeNodeMass(half, structuralMaterial);
    const loadCapacity = computeNodeLoadCapacity(half, ns.kind, structuralMaterial, ns.loadCapacity);

    const node: StructuralNode = {
      id: nodeId,
      origId: ns.id,
      clusterId: cluster.id,
      spec: ns,
      basePos,
      half,
      baseQuat,
      mat: ns.mat,
      materialClass,
      structuralMaterial,
      supportRole,
      mass,
      loadCapacity,
      isFractureCell,
      lazyFracture,
      navBlock,
      navWalkable,
      navBlocked: false,
      initialSupportCount: 0,
      initialAnchoredSupportCount: 0,
      tier: ns.tier,
      anchored,
      kind: ns.kind,
      maxHp: ns.hp,
      keyNode: ns.keyNode === true,
      restPositions,
      restColors,
      hp: ns.hp,
      state: 'intact',
      batched,
      deformStrain: 0,
      deformStage: 0,
      bendDirLocal: new THREE.Vector3(),
      lastImpactLocal: new THREE.Vector3(),
      mesh,
      staticCollider,
      dynamicBody: null,
      tiltElapsed: 0,
      tiltDuration: 0,
      tiltMaxAngle: 0.48,
      tiltFxTimer: 0,
      tiltBendApplied: false,
      tiltAxis: new THREE.Vector3(1, 0, 0),
      tiltHingeOffset: new THREE.Vector3(),
      tiltBlastOrigin: null,
      tiltIsNuke: false,
    };

    cluster.nodes.push(node);
    cluster.byId.set(node.id, node);
    cluster.adjacency.set(node.id, new Set());
    if (staticCollider) {
      this.byCollider.set(staticCollider.handle, { cluster, node });
    }
    if (this.nav && navBlock) {
      this.setNodeNavBlocked(node, true);
    }
    return node;
  }

  private buildClusterRuntime(cluster: StructuralCluster): void {
    const { spec } = cluster;
    this.clearClusterBatchMeshes(cluster);
    cluster.nodes.length = 0;
    cluster.byId.clear();
    cluster.cellGroups.clear();
    cluster.adjacency.clear();
    cluster.collapsed = false;
    cluster.lastGroanAt = -10;
    cluster.center.set(0, 0, 0);
    cluster.radius = 0;
    cluster.batchEnabled = spec.batched ?? (spec.nodes.length >= BATCH_MIN_NODES);
    cluster.batchDirty = false;

    const linkExact = (a: string, b: string) => {
      if (a === b) return;
      const sa = cluster.adjacency.get(a);
      const sb = cluster.adjacency.get(b);
      if (sa && sb) {
        sa.add(b);
        sb.add(a);
      }
    };

    for (const ns of spec.nodes) {
      const parentPos = toVec3(ns.pos);
      const parentHalf = toVec3(ns.half);
      const parentQuat = new THREE.Quaternion().setFromEuler(
        _e.set(ns.pitch ?? 0, ns.yaw ?? 0, ns.roll ?? 0, 'YXZ'),
      );
      const materialClass = inferMaterialClass(ns.mat, ns.materialClass);
      const structuralMaterial = resolveStructuralMaterial(ns.tier, ns.mat, ns.structuralMaterial);
      const surface = surfaceForMat(ns.mat);
      const useLazy = ns.lazyFracture === true;
      const gridPlan = useLazy ? null : resolveFractureGrid(ns, parentHalf, false);

      if (gridPlan) {
        const cells = planPanelFracture(ns, parentHalf, gridPlan);
        const exposeRebar = structuralMaterial === 'concrete' || structuralMaterial === 'reinforced_concrete';
        const created: StructuralNode[] = [];
        for (const cell of cells) {
          const cellWorldPos = cell.localOffset.clone().applyQuaternion(parentQuat).add(parentPos);
          const geom = buildFractureCellGeometry(cell, ns.color, materialClass, exposeRebar);
          const col = this.createStaticCellCollider(geom, cellWorldPos, cell.half, parentQuat, surface);
          const node = this.createNodeRecord(
            cluster,
            ns,
            cell.id,
            cellWorldPos,
            cell.half,
            parentQuat.clone(),
            cell.anchored,
            geom,
            materialClass,
            structuralMaterial,
            true,
            false,
            ns.navBlock === true && cell.row === 0,
            ns.navWalkable === true,
            col,
            cluster.batchEnabled,
          );
          cluster.center.add(cellWorldPos);
          created.push(node);
        }

        const { cols, rows } = gridPlan;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            const curr = created[idx]!;
            if (c + 1 < cols) linkExact(curr.id, created[idx + 1]!.id);
            if (r + 1 < rows) linkExact(curr.id, created[idx + cols]!.id);
          }
        }
        cluster.cellGroups.set(ns.id, created);
      } else {
        const geom = buildSubdividedBoxGeometry(parentHalf, ns.color);
        const col = this.ctx.physics.addStaticBox(parentPos, parentHalf, parentQuat, surface);
        const node = this.createNodeRecord(
          cluster,
          ns,
          ns.id,
          parentPos,
          parentHalf,
          parentQuat,
          ns.anchored,
          geom,
          materialClass,
          structuralMaterial,
          false,
          useLazy,
          ns.navBlock === true,
          ns.navWalkable === true,
          col,
          cluster.batchEnabled,
        );
        cluster.center.add(parentPos);
        cluster.cellGroups.set(ns.id, [node]);
      }
    }

    if (cluster.nodes.length > 0) {
      cluster.center.multiplyScalar(1 / cluster.nodes.length);
      let maxR = 0;
      for (let i = 0; i < cluster.nodes.length; i++) {
        const n = cluster.nodes[i]!;
        const r = cluster.center.distanceTo(n.basePos) + n.half.length();
        if (r > maxR) maxR = r;
      }
      cluster.radius = maxR;
    }

    const linkGroups = (origA: string, origB: string) => {
      if (origA === origB) return;
      const groupA = cluster.cellGroups.get(origA);
      const groupB = cluster.cellGroups.get(origB);
      if (!groupA || !groupB || groupA.length === 0 || groupB.length === 0) return;

      if (groupA.length === 1 && groupB.length === 1) {
        linkExact(groupA[0]!.id, groupB[0]!.id);
        return;
      }

      let minDist = Infinity;
      for (let i = 0; i < groupA.length; i++) {
        for (let j = 0; j < groupB.length; j++) {
          const d = pairNodeDistance(groupA[i]!, groupB[j]!);
          if (d < minDist) minDist = d;
        }
      }
      const threshold = minDist + 0.85;
      for (let i = 0; i < groupA.length; i++) {
        for (let j = 0; j < groupB.length; j++) {
          if (pairNodeDistance(groupA[i]!, groupB[j]!) <= threshold) {
            linkExact(groupA[i]!.id, groupB[j]!.id);
          }
        }
      }
    };

    if (spec.links) {
      for (const [a, b] of spec.links) linkGroups(a, b);
    }
    for (const ns of spec.nodes) {
      if (ns.supports) {
        for (const other of ns.supports) linkGroups(ns.id, other);
      }
    }

    // Precompute initial support topology for the 4-pass structural integrity solver
    const supportMeta = computeInitialSupportMetadata(cluster);
    for (let i = 0; i < cluster.nodes.length; i++) {
      const n = cluster.nodes[i]!;
      const m = supportMeta.get(n.id);
      if (m) {
        n.initialSupportCount = m.directSupports;
        n.initialAnchoredSupportCount = m.anchoredSupports;
      }
    }

    if (cluster.batchEnabled) {
      this.rebuildClusterBatch(cluster);
    }
  }

  /**
   * Lazily subdivides an intact panel node around `worldImpact` into irregular jagged fracture cells
   * with exposed steel rebar stubs (on concrete/reinforced_concrete) and preserves graph connectivity.
   */
  private subdivideNodeAroundImpact(
    cluster: StructuralCluster,
    parent: StructuralNode,
    worldImpact: THREE.Vector3,
    plan: FractureGridPlan,
  ): StructuralNode[] {
    // Transform impact into parent's local frame
    _q.copy(parent.baseQuat).invert();
    const localHit = new THREE.Vector3().subVectors(worldImpact, parent.basePos).applyQuaternion(_q);
    localHit.set(
      clamp(localHit.x, -parent.half.x, parent.half.x),
      clamp(localHit.y, -parent.half.y, parent.half.y),
      clamp(localHit.z, -parent.half.z, parent.half.z),
    );

    const cells = planPanelFracture(parent.spec, parent.half, plan, localHit);
    const exposeRebar =
      parent.structuralMaterial === 'concrete' || parent.structuralMaterial === 'reinforced_concrete';
    const surface = surfaceForMat(parent.mat);

    // Record parent's external neighbors before replacing it
    const externalNeighbors = [...(cluster.adjacency.get(parent.id) ?? [])];

    // Tear down parent runtime state cleanly
    this.removeStaticCollider(parent);
    if (parent.navBlocked) this.setNodeNavBlocked(parent, false);
    if (parent.mesh && parent.mesh.parent === this.root) {
      this.root.remove(parent.mesh);
    }
    if (parent.batched && cluster.batchEnabled) {
      cluster.batchDirty = true;
    }
    parent.batched = false;
    parent.state = 'gone';

    const parentIdx = cluster.nodes.indexOf(parent);
    if (parentIdx >= 0) cluster.nodes.splice(parentIdx, 1);
    cluster.byId.delete(parent.id);
    cluster.adjacency.delete(parent.id);
    for (let i = 0; i < externalNeighbors.length; i++) {
      cluster.adjacency.get(externalNeighbors[i]!)?.delete(parent.id);
    }

    const created: StructuralNode[] = [];
    const hpRatio = clamp(parent.hp / Math.max(1, parent.maxHp), 0.15, 1);
    for (const cell of cells) {
      const cellWorldPos = cell.localOffset.clone().applyQuaternion(parent.baseQuat).add(parent.basePos);
      const geom = buildFractureCellGeometry(cell, parent.spec.color, parent.materialClass, exposeRebar);
      const col = this.createStaticCellCollider(geom, cellWorldPos, cell.half, parent.baseQuat, surface);
      const child = this.createNodeRecord(
        cluster,
        parent.spec,
        cell.id,
        cellWorldPos,
        cell.half,
        parent.baseQuat.clone(),
        cell.anchored,
        geom,
        parent.materialClass,
        parent.structuralMaterial,
        true,
        false,
        parent.navBlock && cell.row === 0,
        parent.navWalkable,
        col,
        false, // Newly fractured panel cells render live immediately for DMM deformation & breakage
      );
      // Scale cell HP gently (individually punchable by heavy shells, yet coherent as a wall)
      child.hp = Math.max(25, Math.round(parent.maxHp * 0.65 * hpRatio));
      child.initialSupportCount = parent.initialSupportCount;
      child.initialAnchoredSupportCount = parent.initialAnchoredSupportCount;
      created.push(child);
    }

    const linkExact = (a: string, b: string) => {
      if (a === b) return;
      cluster.adjacency.get(a)?.add(b);
      cluster.adjacency.get(b)?.add(a);
    };

    // Wire intra-panel orthogonal edges
    const { cols, rows } = plan;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const curr = created[idx]!;
        if (c + 1 < cols) linkExact(curr.id, created[idx + 1]!.id);
        if (r + 1 < rows) linkExact(curr.id, created[idx + cols]!.id);
      }
    }

    // Reconnect parent's external neighbors to the closest boundary cells
    for (let i = 0; i < externalNeighbors.length; i++) {
      const extNode = cluster.byId.get(externalNeighbors[i]!);
      if (!extNode) continue;
      let minDist = Infinity;
      for (let j = 0; j < created.length; j++) {
        const d = pairNodeDistance(extNode, created[j]!);
        if (d < minDist) minDist = d;
      }
      const threshold = minDist + 0.85;
      for (let j = 0; j < created.length; j++) {
        if (pairNodeDistance(extNode, created[j]!) <= threshold) {
          linkExact(extNode.id, created[j]!.id);
        }
      }
    }

    cluster.cellGroups.set(parent.origId, created);
    return created;
  }

  /** True when the tagged cluster exists and has not collapsed. */
  isClusterAlive(tag: string): boolean {
    const c = this.byTag.get(tag);
    return !!c && !c.collapsed && c.intactCount > 0;
  }

  getCluster(tag: string): StructuralCluster | undefined {
    return this.byTag.get(tag);
  }

  aliveClusters(kind?: string): StructuralCluster[] {
    const out: StructuralCluster[] = [];
    for (let i = 0; i < this.clusters.length; i++) {
      const c = this.clusters[i]!;
      if (c.collapsed || c.intactCount === 0) continue;
      if (kind !== undefined && c.kind !== kind) continue;
      out.push(c);
    }
    return out;
  }

  allClusters(): readonly StructuralCluster[] {
    return this.clusters;
  }

  /** Direct weapon/projectile/melee hit against a collider. Returns true if it hit a structural node. */
  damageCollider(
    collider: RAPIER.Collider | null,
    amount: number,
    source: string,
    hitPoint?: THREE.Vector3,
  ): boolean {
    if (!collider) return false;
    const entry = this.byCollider.get(collider.handle);
    if (!entry) return false;
    const { cluster } = entry;
    let node = entry.node;
    if (node.state !== 'intact' || amount <= 0) return true;

    const pt = hitPoint ?? node.basePos;
    const mult = nodeDamageMultiplier(node, source);
    if (mult <= 0) {
      this.emitBlockedHit(node.structuralMaterial, source, pt, true);
      return true;
    }

    // Lazy impact-centered fracture on first damaging hit!
    if (node.lazyFracture && !node.isFractureCell) {
      const plan = resolveFractureGrid(node.spec, node.half, true);
      if (plan) {
        const cells = this.subdivideNodeAroundImpact(cluster, node, pt, plan);
        // Pick the jagged cell closest to the exact hit point
        let closest = cells[0]!;
        let bestD = distanceToOrientedBox(pt, closest.basePos, closest.half, closest.baseQuat);
        for (let i = 1; i < cells.length; i++) {
          const d = distanceToOrientedBox(pt, cells[i]!.basePos, cells[i]!.half, cells[i]!.baseQuat);
          if (d < bestD) {
            bestD = d;
            closest = cells[i]!;
          }
        }
        node = closest;
      }
    }

    const dealt = source === 'nuke' ? node.hp + 1 : amount * mult;
    this.applyNodeDamage(cluster, node, dealt, pt, source);
    this.flushDirtyBatches();
    return true;
  }

  /**
   * Vehicle collision ram check: tanks smash smoothly through drywall/timber/masonry walls
   * (triggering jagged fractures + structural collapse behind them) while bouncing hard off
   * reinforced concrete bunkers.
   */
  tryVehicleRam(
    collider: RAPIER.Collider | null,
    ramClass: VehicleRamClass,
    speed: number,
    hitPoint: THREE.Vector3,
    forwardDir: THREE.Vector3,
  ): VehicleRamResult {
    if (!collider) return { hit: false, breached: false, speedRetain: 1 };
    const entry = this.byCollider.get(collider.handle);
    if (!entry) return { hit: false, breached: false, speedRetain: 1 };

    const { cluster } = entry;
    let node = entry.node;
    if (node.state !== 'intact') {
      return { hit: true, breached: true, speedRetain: 0.96, material: node.structuralMaterial };
    }

    const mat = node.structuralMaterial;
    const ramSource = ramSourceFor(ramClass);
    if (!canVehicleRamMaterial(mat, ramClass, speed)) {
      if (speed >= 4.0) {
        this.emitBlockedHit(mat, ramSource, hitPoint, true);
      }
      return { hit: true, breached: false, speedRetain: 0, material: mat };
    }

    // Subdivide lazy wall around vehicle bumper impact before punching out the hole
    if (node.lazyFracture && !node.isFractureCell) {
      const plan = resolveFractureGrid(node.spec, node.half, true);
      if (plan) {
        const cells = this.subdivideNodeAroundImpact(cluster, node, hitPoint, plan);
        let closest = cells[0]!;
        let bestD = distanceToOrientedBox(hitPoint, closest.basePos, closest.half, closest.baseQuat);
        for (let i = 1; i < cells.length; i++) {
          const d = distanceToOrientedBox(hitPoint, cells[i]!.basePos, cells[i]!.half, cells[i]!.baseQuat);
          if (d < bestD) {
            bestD = d;
            closest = cells[i]!;
          }
        }
        node = closest;
      }
    }

    const bumperRadius = ramClass === 'heavy' ? 2.4 : ramClass === 'medium' ? 1.75 : 1.25;
    const launchOrigin = hitPoint.clone().addScaledVector(forwardDir, -2.5);
    const toBreak: StructuralNode[] = [node];
    for (let i = 0; i < cluster.nodes.length; i++) {
      const other = cluster.nodes[i]!;
      if (other === node || other.state !== 'intact') continue;
      if (Math.abs(other.basePos.y - hitPoint.y) > 2.2) continue;
      if (!canVehicleRamMaterial(other.structuralMaterial, ramClass, speed)) continue;
      if (distanceToOrientedBox(hitPoint, other.basePos, other.half, other.baseQuat) <= bumperRadius) {
        toBreak.push(other);
      }
    }

    for (let i = 0; i < toBreak.length; i++) {
      const target = toBreak[i]!;
      if (target.state !== 'intact') continue;
      target.hp = 0;
      this.breakNode(cluster, target, launchOrigin, false, true);
    }

    this.propagateSupportLoss(cluster, launchOrigin, false);
    this.checkClusterCollapse(cluster);
    this.flushDirtyBatches();

    const retain = STRUCTURAL_MATERIAL_PROPS[mat].ramSpeedRetain;
    return { hit: true, breached: true, speedRetain: retain, material: mat };
  }

  /** Radial blast against all intact structural nodes in range, enforcing material matrix & lazy fracture. */
  blast(
    center: THREE.Vector3,
    radius: number,
    amount: number,
    source: string,
    excludeClusterId?: string,
  ): void {
    if (radius <= 0 || amount <= 0) return;

    // Pre-pass: lazily fracture any large untouched panel hit by a damaging blast so explosives
    // blow irregular jagged holes right where the shell landed instead of popping whole walls off!
    for (let ci = 0; ci < this.clusters.length; ci++) {
      const cluster = this.clusters[ci]!;
      if (excludeClusterId && cluster.id === excludeClusterId) continue;
      const reach = radius + cluster.radius;
      if (center.distanceToSquared(cluster.center) > reach * reach) continue;
      let toSplit: StructuralNode[] | null = null;
      for (let ni = 0; ni < cluster.nodes.length; ni++) {
        const node = cluster.nodes[ni]!;
        if (node.state !== 'intact' || !node.lazyFracture || node.isFractureCell) continue;
        if (nodeDamageMultiplier(node, source) <= 0) continue;
        if (distanceToOrientedBox(center, node.basePos, node.half, node.baseQuat) <= radius) {
          if (!toSplit) toSplit = [];
          toSplit.push(node);
        }
      }
      if (toSplit) {
        for (let i = 0; i < toSplit.length; i++) {
          const n = toSplit[i]!;
          const plan = resolveFractureGrid(n.spec, n.half, true);
          if (plan) this.subdivideNodeAroundImpact(cluster, n, center, plan);
        }
      }
    }

    let highestBlockedMat: StructuralMaterial | null = null;
    let highestBlockedTier = -1;
    let blockedPos: THREE.Vector3 | null = null;
    const hits: { cluster: StructuralCluster; node: StructuralNode; damage: number }[] = [];

    for (let ci = 0; ci < this.clusters.length; ci++) {
      const cluster = this.clusters[ci]!;
      if (excludeClusterId && cluster.id === excludeClusterId) continue;
      const reach = radius + cluster.radius;
      if (center.distanceToSquared(cluster.center) > reach * reach) continue;
      for (let ni = 0; ni < cluster.nodes.length; ni++) {
        const node = cluster.nodes[ni]!;
        if (node.state === 'tilting') {
          const d = distanceToOrientedBox(center, node.basePos, node.half, node.baseQuat);
          if (d <= radius && nodeDamageMultiplier(node, source) > 0) {
            this.releaseTiltingNodeNow(cluster, node, center, source === 'nuke');
          }
          continue;
        }
        if (node.state !== 'intact') continue;

        const d = distanceToOrientedBox(center, node.basePos, node.half, node.baseQuat);
        if (d > radius) continue;

        const mult = nodeDamageMultiplier(node, source);
        if (mult <= 0) {
          const rank = STRUCTURAL_MATERIAL_PROPS[node.structuralMaterial].legacyTier;
          if (rank > highestBlockedTier) {
            highestBlockedTier = rank;
            highestBlockedMat = node.structuralMaterial;
            blockedPos = node.basePos;
          }
          continue;
        }

        const falloff = 1 - (d / radius) * (1 - BLAST_EDGE);
        const dealt = source === 'nuke' ? node.hp + 1 : amount * falloff * mult;
        hits.push({ cluster, node, damage: dealt });
      }
    }

    if (highestBlockedMat && blockedPos) {
      this.emitBlockedHit(highestBlockedMat, source, blockedPos, false);
    }

    let dirtyClusters: Set<StructuralCluster> | null = null;
    let damagedClusters: Set<StructuralCluster> | null = null;
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i]!;
      if (h.node.state !== 'intact') continue;
      const broke = this.applyNodeDamage(h.cluster, h.node, h.damage, center, source, true);
      if (broke) {
        if (!dirtyClusters) dirtyClusters = new Set();
        dirtyClusters.add(h.cluster);
      } else {
        if (!damagedClusters) damagedClusters = new Set();
        damagedClusters.add(h.cluster);
      }
    }

    if (dirtyClusters) {
      const isNuke = source === 'nuke';
      for (const cluster of dirtyClusters) {
        this.propagateSupportLoss(cluster, center, isNuke);
        this.checkClusterCollapse(cluster);
      }
    } else if (damagedClusters) {
      // Heavy damage to columns without breaking them outright can still trigger load-overload buckling
      for (const cluster of damagedClusters) {
        this.checkOverloadOnly(cluster, center);
      }
    }

    this.flushDirtyBatches();
  }

  /** Starts an expanding nuke shockwave ring (115 m/s) shattering all structural nodes outward. */
  nukeSweep(epicenter: THREE.Vector3, maxRadius = 340): void {
    this.sweeps.push({
      epicenter: epicenter.clone(),
      radius: 0,
      maxRadius,
      speed: NUKE_SWEEP_SPEED,
    });
    this.ctx.render?.sweep?.(epicenter, 0xffaa44, NUKE_SWEEP_SPEED, maxRadius);
  }

  private emitBlockedHit(
    material: StructuralMaterial,
    source: string,
    pos: THREE.Vector3,
    direct: boolean,
  ): void {
    const { fx, audio, hud } = this.ctx;
    if (material === 'timber' || material === 'drywall') {
      if (this.time - this.lastBounceFxAt >= 0.08 || direct) {
        this.lastBounceFxAt = this.time;
        fx?.chips?.(pos, material === 'timber' ? 0x9b7a4a : 0xc8c0b4, 3);
      }
    } else if (material === 'masonry') {
      if (this.time - this.lastBounceFxAt >= 0.06 || direct) {
        this.lastBounceFxAt = this.time;
        fx?.chips?.(pos, 0x999287, 5);
        fx?.sparks?.(pos, UP, 4, 0xffd699);
      }
    } else if (this.time - this.lastClangAt >= 0.06 || direct) {
      this.lastClangAt = this.time;
      if (material === 'heavy_steel') {
        fx?.sparks?.(pos, UP, 12, 0xffc864);
        fx?.chips?.(pos, 0x8f8a80, 6);
        audio?.play?.('metal_clang', { position: pos, volume: 0.65, pitch: 1.32, pitchJitter: 0.08 });
      } else if (material === 'concrete') {
        fx?.sparks?.(pos, UP, 10, 0xffd280);
        fx?.chips?.(pos, 0x8f8a80, 6);
        audio?.play?.('impact_concrete', { position: pos, volume: 0.65, pitch: 1.05, pitchJitter: 0.08 });
      } else if (material === 'reinforced_concrete') {
        fx?.sparks?.(pos, UP, 14, 0xdce4ee);
        fx?.chips?.(pos, 0x9aa0a8, 8);
        audio?.play?.('metal_clang', { position: pos, volume: 0.72, pitch: 0.85, pitchJitter: 0.06 });
        audio?.play?.('impact_concrete', { position: pos, volume: 0.65, pitch: 1.1 });
      }
    }

    const hint = blockedHintFor(material, source);
    if (hint && this.time - this.lastHintAt >= 3.5) {
      this.lastHintAt = this.time;
      hud?.hitMarker?.('armor');
      hud?.feed?.(hint.text, hint.color);
    }
  }

  private applyNodeDamage(
    cluster: StructuralCluster,
    node: StructuralNode,
    damage: number,
    origin: THREE.Vector3,
    source: string,
    deferSupportCheck = false,
  ): boolean {
    this.promoteNodeFromBatch(cluster, node);

    // Transform impact point and push direction into node local space
    _q.copy(node.baseQuat).invert();
    _v.subVectors(origin, node.basePos).applyQuaternion(_q);
    _v.set(
      clamp(_v.x, -node.half.x, node.half.x),
      clamp(_v.y, -node.half.y, node.half.y),
      clamp(_v.z, -node.half.z, node.half.z),
    );
    node.lastImpactLocal.copy(_v);

    _v2.subVectors(node.basePos, origin).applyQuaternion(_q);
    if (_v2.lengthSq() < 1e-4) {
      if (node.half.x <= node.half.y && node.half.x <= node.half.z) _v2.set(1, 0, 0);
      else if (node.half.y <= node.half.x && node.half.y <= node.half.z) _v2.set(0, -1, 0);
      else _v2.set(0, 0, 1);
    } else {
      _v2.normalize();
    }

    node.hp -= damage;
    if (node.hp > 0) {
      const maxHp = Math.max(1, node.maxHp);
      const hpRatio = clamp(node.hp / maxHp, 0, 1);
      const damageFrac = clamp(1 - hpRatio, 0, 1);
      const hitFrac = clamp(damage / maxHp, 0.05, 1);
      const stage = hpRatio <= 0.35 ? 3 : hpRatio <= 0.6 ? 2 : hpRatio <= 0.85 ? 1 : 0;
      const crossedThreshold = stage > node.deformStage;
      node.deformStrain = Math.max(node.deformStrain, damageFrac);

      if (node.mesh) {
        deformNodeGeometry({
          geom: node.mesh.geometry,
          restPos: node.restPositions,
          restCol: node.restColors,
          half: node.half,
          materialClass: node.materialClass,
          localHit: node.lastImpactLocal,
          localDir: _v2,
          damageFrac,
          hitFrac,
          bendDirAccum: node.bendDirLocal,
        });
      }

      _v3.copy(node.lastImpactLocal).applyQuaternion(node.baseQuat).add(node.basePos);
      _v4.subVectors(origin, node.basePos);
      if (_v4.lengthSq() < 1e-4) _v4.copy(UP);
      else _v4.normalize();

      const { fx, audio } = this.ctx;
      const chipCol = chipColorFor(node.mat, node.spec.color);
      fx?.chips?.(_v3, chipCol, 5 + stage * 2);

      if (node.materialClass === 'wood') {
        const splinterCount = 2 + Math.max(1, stage);
        this.splinters.spawnBurst(_v3, _v4, 'wood', splinterCount, chipCol, 6.8 + stage * 1.1);
        audio?.play?.('wood_crunch', {
          position: _v3,
          volume: crossedThreshold ? 0.72 : 0.52,
          pitch: 0.92 + Math.random() * 0.14,
          pitchJitter: 0.1,
          duration: crossedThreshold ? 0.9 : 0.45,
        });
      } else if (node.materialClass === 'metal' || node.structuralMaterial === 'heavy_steel') {
        fx?.sparks?.(_v3, _v4, 6 + stage * 4, 0xffcc66);
        if (crossedThreshold || hitFrac >= 0.15) {
          this.splinters.spawnBurst(_v3, _v4, 'metal', 1 + stage, chipCol, 7.5);
          if (crossedThreshold) {
            const tearId = isHeavyMetalNode(node) ? 'metal_plate_destroyed' : 'sheet_metal_destroyed';
            audio?.play?.(tearId, {
              position: _v3,
              volume: 0.55,
              pitch: 1.08,
              pitchJitter: 0.08,
              duration: 0.55,
            });
          } else {
            audio?.play?.('metal_clang', {
              position: _v3,
              volume: 0.48,
              pitch: 1.18 + Math.random() * 0.18,
              pitchJitter: 0.08,
            });
          }
        }
      } else {
        fx?.dust?.(_v3, _v4, 0.9 + stage * 0.35);
        this.splinters.spawnBurst(_v3, _v4, 'concrete', 2 + stage, chipCol, 5.8);
        if (node.structuralMaterial === 'drywall') {
          if (crossedThreshold || hitFrac >= 0.15) {
            audio?.play?.('wood_crunch', {
              position: _v3,
              volume: crossedThreshold ? 0.6 : 0.44,
              pitch: 1.18,
              pitchJitter: 0.1,
              duration: crossedThreshold ? 0.6 : 0.38,
            });
          }
        } else if (crossedThreshold || hitFrac >= 0.15) {
          audio?.play?.('impact_concrete', { position: _v3, volume: 0.5, pitch: 0.92, pitchJitter: 0.1 });
          if (crossedThreshold) {
            audio?.play?.('concrete_crumble', { position: _v3, volume: 0.55, pitch: 0.9, pitchJitter: 0.08 });
          }
        }
      }

      if (crossedThreshold) node.deformStage = stage;
      if (!deferSupportCheck && node.kind === 'column') {
        this.checkOverloadOnly(cluster, origin);
      }
      return false;
    }

    node.hp = 0;
    node.deformStrain = Math.max(node.deformStrain, 0.85);
    this.breakNode(cluster, node, origin, source === 'nuke', deferSupportCheck);
    return true;
  }

  private breakNode(
    cluster: StructuralCluster,
    node: StructuralNode,
    blastOrigin: THREE.Vector3 | null,
    isNuke = false,
    deferSupportCheck = false,
  ): void {
    if (node.state !== 'intact') return;
    this.promoteNodeFromBatch(cluster, node);
    this.removeStaticCollider(node);
    this.onNodeLostNavSync(node);

    if (node.mesh) {
      applyBreakFractureDeform(node.mesh.geometry, node.half, node.materialClass);
    }

    const { fx, audio } = this.ctx;
    const chipCol = chipColorFor(node.mat, node.spec.color);
    fx?.chips?.(node.basePos, chipCol, isNuke ? 22 : 16);
    fx?.dust?.(node.basePos, UP, isNuke ? 3.0 : 2.2);
    fx?.smoke?.(node.basePos, 0x8a8478, isNuke ? 4.2 : 2.8, isNuke ? 3.2 : 2.2);

    if (blastOrigin) {
      _v4.subVectors(node.basePos, blastOrigin);
      if (_v4.lengthSq() < 1e-4) _v4.copy(UP);
      else _v4.normalize();
    } else {
      _v4.copy(UP);
    }

    if (node.structuralMaterial === 'glass') {
      const count = isNuke ? 5 : 6;
      this.splinters.spawnBurst(node.basePos, _v4, 'metal', count, 0xb8d4e6, 9.0);
      audio?.play?.('glass_break', { position: node.basePos, volume: 0.72, pitchJitter: 0.12 });
    } else if (node.structuralMaterial === 'drywall') {
      const count = isNuke ? 5 : 7;
      this.splinters.spawnBurst(node.basePos, _v4, 'concrete', count, chipCol, 8.2);
      fx?.dust?.(node.basePos, _v4, 2.4);
      audio?.play?.('wood_crunch', {
        position: node.basePos,
        volume: isNuke ? 0.88 : 0.8,
        pitch: 1.12,
        pitchJitter: 0.12,
        duration: 1.0,
      });
    } else if (node.materialClass === 'wood') {
      const count = isNuke ? 7 : 7 + Math.floor(Math.random() * 4);
      this.splinters.spawnBurst(node.basePos, _v4, 'wood', count, chipCol, isNuke ? 13 : 9.5);
      audio?.play?.('wood_destroyed', {
        position: node.basePos,
        volume: isNuke ? 0.95 : 0.85,
        pitchJitter: 0.1,
      });
    } else if (node.materialClass === 'metal' || node.structuralMaterial === 'heavy_steel') {
      const count = isNuke ? 5 : 5 + Math.floor(Math.random() * 4);
      this.splinters.spawnBurst(node.basePos, _v4, 'metal', count, chipCol, isNuke ? 14 : 9.0);
      fx?.sparks?.(node.basePos, _v4, isNuke ? 22 : 14, 0xffc864);
      const metalBreakId = isHeavyMetalNode(node) ? 'metal_plate_destroyed' : 'sheet_metal_destroyed';
      audio?.play?.(metalBreakId, {
        position: node.basePos,
        volume: isNuke ? 0.98 : 0.86,
        pitchJitter: 0.09,
      });
    } else {
      const count = isNuke ? 6 : 6 + Math.floor(Math.random() * 5);
      this.splinters.spawnBurst(node.basePos, _v4, 'concrete', count, chipCol, isNuke ? 12 : 8.4);
      audio?.play?.('concrete_destroyed', {
        position: node.basePos,
        volume: isNuke ? 1.0 : 0.88,
        pitchJitter: 0.1,
      });
    }
    audio?.play?.('explosion_debris', { position: node.basePos, volume: 0.55, pitchJitter: 0.1 });

    if (node.kind === 'hazard') {
      this.pendingHazards.push({
        pos: node.basePos.clone(),
        radius: node.spec.hazardRadius ?? 11.5,
        damage: node.spec.hazardDamage ?? 260,
        delay: 0.14,
      });
    }

    this.spawnDynamicBody(cluster, node, blastOrigin, isNuke, false);

    if (node.spec.value && node.spec.value > 0) {
      this.ctx.events?.emit?.('world:liquidated', {
        label: node.spec.label ?? node.kind.toUpperCase(),
        value: node.spec.value,
        position: node.basePos.clone(),
        kind: node.kind,
      });
    }

    if (!deferSupportCheck) {
      this.propagateSupportLoss(cluster, blastOrigin, isNuke);
      this.checkClusterCollapse(cluster);
    }
  }

  private removeStaticCollider(node: StructuralNode): void {
    if (!node.staticCollider) return;
    this.byCollider.delete(node.staticCollider.handle);
    this.ctx.physics.world.removeCollider(node.staticCollider, false);
    node.staticCollider = null;
  }

  private queueOverloadedColumns(
    cluster: StructuralCluster,
    overloadedIds: readonly string[],
    origin: THREE.Vector3 | null,
  ): void {
    for (let i = 0; i < overloadedIds.length; i++) {
      const id = overloadedIds[i]!;
      const key = `${cluster.id}:${id}`;
      if (this.bucklingIds.has(key)) continue;
      const node = cluster.byId.get(id);
      if (!node || node.state !== 'intact') continue;
      this.bucklingIds.add(key);
      this.promoteNodeFromBatch(cluster, node);
      this.buckling.push({
        cluster,
        node,
        delay: 0.22 + Math.random() * 0.22,
        origin: origin ? origin.clone() : null,
      });
      this.ctx.fx?.dust?.(node.basePos, UP, 1.3);
      this.ctx.fx?.sparks?.(node.basePos, UP, 6, 0xffcc66);
    }
  }

  private checkOverloadOnly(cluster: StructuralCluster, origin: THREE.Vector3 | null): void {
    const res = solveStructuralIntegrity(cluster);
    if (res.overloaded.length > 0) {
      this.queueOverloadedColumns(cluster, res.overloaded, origin);
    }
  }

  private propagateSupportLoss(
    cluster: StructuralCluster,
    blastOrigin: THREE.Vector3 | null,
    isNuke: boolean,
  ): void {
    const result = solveStructuralIntegrity(cluster);
    if (result.overloaded.length > 0 && !isNuke) {
      this.queueOverloadedColumns(cluster, result.overloaded, blastOrigin);
    }
    if (result.detached.length === 0) return;

    let minY = Infinity;
    let maxY = -Infinity;
    const detachedNodes: { node: StructuralNode; tipDirX: number; tipDirZ: number; reason: string }[] = [];
    for (let i = 0; i < result.detached.length; i++) {
      const d = result.detached[i]!;
      const n = cluster.byId.get(d.nodeId);
      if (!n || n.state !== 'intact') continue;
      detachedNodes.push({ node: n, tipDirX: d.tipDirX, tipDirZ: d.tipDirZ, reason: d.reason });
      if (n.basePos.y < minY) minY = n.basePos.y;
      if (n.basePos.y > maxY) maxY = n.basePos.y;
    }

    const spanY = Math.max(0.01, maxY - minY);
    let anyWood = false;
    for (let i = 0; i < detachedNodes.length; i++) {
      const { node: n, tipDirX, tipDirZ, reason } = detachedNodes[i]!;
      if (n.materialClass === 'wood') anyWood = true;
      this.promoteNodeFromBatch(cluster, n);
      this.onNodeLostNavSync(n);

      const hFrac = detachedNodes.length > 1 ? (n.basePos.y - minY) / spanY : 0;
      n.state = 'tilting';
      if (n.mesh) {
        n.mesh.matrixAutoUpdate = true;
        n.mesh.userData.staticShadow = false;
      }
      n.tiltElapsed = 0;
      n.tiltDuration = isNuke ? 0.06 : 0.55 + hFrac * 0.22 + Math.random() * 0.13;
      n.tiltMaxAngle = reason === 'tipping' ? 0.52 + Math.random() * 0.16 : 0.42 + Math.random() * 0.16;
      n.tiltFxTimer = 0.08;
      n.tiltBendApplied = false;
      n.tiltBlastOrigin = blastOrigin ? blastOrigin.clone() : null;
      n.tiltIsNuke = isNuke;

      // Orient tipping/hinge axis from the 4-pass solver's exact tip vector when available!
      if (Math.hypot(tipDirX, tipDirZ) > 0.05) {
        _v.set(tipDirX, 0, tipDirZ).normalize();
      } else if (blastOrigin) {
        _v.subVectors(blastOrigin, n.basePos).setY(0);
        if (_v.lengthSq() < 0.02) _v.subVectors(n.basePos, cluster.center).setY(0);
        if (_v.lengthSq() < 0.02) _v.set(1, 0, 0);
        _v.normalize();
      } else {
        _v.subVectors(cluster.center, n.basePos).setY(0);
        if (_v.lengthSq() < 0.02) _v.set(1, 0, 0);
        _v.normalize();
      }

      _q.copy(n.baseQuat).invert();
      _v2.copy(_v).applyQuaternion(_q);
      const projHalf = Math.abs(_v2.x) * n.half.x + Math.abs(_v2.z) * n.half.z;
      const hingeDist = clamp(projHalf * 0.85, 0.35, 3.2);
      n.tiltHingeOffset.copy(_v).multiplyScalar(-hingeDist);
      n.tiltAxis.set(_v.z, 0, -_v.x).normalize();

      this.tilting.push({ cluster, node: n });
    }

    if (detachedNodes.length > 0) {
      this.requestStaticShadowRefresh();
    }

    if (detachedNodes.length > 0 && this.time - cluster.lastGroanAt >= 0.4) {
      cluster.lastGroanAt = this.time;
      this.ctx.audio?.play?.('metal_groan', {
        position: cluster.center,
        volume: 0.85,
        pitchJitter: 0.12,
      });
      if (anyWood) {
        this.ctx.audio?.play?.('wood_crunch', {
          position: cluster.center,
          volume: 0.85,
          pitch: 0.82,
          pitchJitter: 0.1,
        });
      }
    }
  }

  private releaseTiltingNodeNow(
    cluster: StructuralCluster,
    node: StructuralNode,
    blastOrigin: THREE.Vector3 | null,
    isNuke: boolean,
  ): void {
    const idx = this.tilting.findIndex(t => t.node === node);
    if (idx >= 0) {
      const last = this.tilting.pop()!;
      if (idx < this.tilting.length) this.tilting[idx] = last;
    }
    this.removeStaticCollider(node);
    this.spawnDynamicBody(cluster, node, blastOrigin ?? node.tiltBlastOrigin, isNuke || node.tiltIsNuke, true);
  }

  private spawnDynamicBody(
    cluster: StructuralCluster,
    node: StructuralNode,
    blastOrigin: THREE.Vector3 | null,
    isNuke: boolean,
    fromTilt: boolean,
  ): void {
    node.state = 'falling';
    if (!node.mesh) return;
    if (node.mesh.parent !== this.root) this.root.add(node.mesh);
    node.mesh.matrixAutoUpdate = true;
    node.mesh.userData.staticShadow = false;
    this.requestStaticShadowRefresh();

    while (this.dynamicPool.length >= MAX_DYNAMIC_BODIES) {
      this.recycleOldestDynamicBody();
    }

    const { R, world } = this.ctx.physics;
    const pos = node.mesh.position;
    const quat = node.mesh.quaternion;

    if (isNuke && blastOrigin) {
      _vel.subVectors(pos, blastOrigin);
      const dist = Math.max(1, _vel.length());
      _vel.multiplyScalar(1 / dist);
      const radial = 22 + Math.random() * 16;
      _vel.multiplyScalar(radial);
      _vel.y = Math.max(10, _vel.y + 12 + Math.random() * 12);
    } else if (blastOrigin && !fromTilt) {
      _vel.subVectors(pos, blastOrigin);
      const rawLen = _vel.length();
      if (rawLen < 0.25) {
        _vel.subVectors(pos, cluster.center).setY(0);
        if (_vel.lengthSq() < 0.01) {
          const a = Math.random() * Math.PI * 2;
          _vel.set(Math.cos(a), 0, Math.sin(a));
        } else {
          _vel.normalize();
        }
      } else {
        _vel.multiplyScalar(1 / rawLen);
      }
      const dist = Math.max(0.8, rawLen);
      const speed = clamp(12 / Math.sqrt(dist), 4.5, 16) + Math.random() * 4;
      _vel.multiplyScalar(speed);
      _vel.y += 1.5 + Math.random() * 2.5;

      if (node.materialClass === 'wood' && node.deformStrain > 0.1 && node.bendDirLocal.lengthSq() > 0.01) {
        _v3.copy(node.bendDirLocal).applyQuaternion(node.baseQuat);
        _vel.addScaledVector(_v3, 3.8 * node.deformStrain);
        _vel.y += 1.2 * node.deformStrain;
      }
    } else {
      const omegaMag = (2.2 * node.tiltMaxAngle) / Math.max(0.12, node.tiltDuration);
      _v3.copy(node.tiltAxis).multiplyScalar(omegaMag);
      _v4.copy(node.tiltHingeOffset).negate();
      _vel.crossVectors(_v3, _v4);
      _vel.y = Math.min(_vel.y - 1.2, -1.8);
      if (Math.hypot(_vel.x, _vel.z) < 0.8) {
        _v3.subVectors(pos, blastOrigin ?? cluster.center).setY(0);
        if (_v3.lengthSq() > 0.01) _v3.normalize().multiplyScalar(1.4 + Math.random() * 1.4);
        else _v3.set((Math.random() - 0.5) * 1.6, 0, (Math.random() - 0.5) * 1.6);
        _vel.x += _v3.x;
        _vel.z += _v3.z;
      }
    }

    const woodWhipSpin = node.materialClass === 'wood' && node.deformStrain > 0.1 ? 2.4 * node.deformStrain : 0;
    const spin = (isNuke ? 5.5 : fromTilt ? 1.8 : 3.8) + woodWhipSpin;
    const tiltOmega = fromTilt ? clamp((2.2 * node.tiltMaxAngle) / Math.max(0.15, node.tiltDuration), 1.0, 3.2) : 0;
    const angX = (Math.random() - 0.5) * spin + (fromTilt ? node.tiltAxis.x * tiltOmega : 0);
    const angY = (Math.random() - 0.5) * spin * 0.7;
    const angZ = (Math.random() - 0.5) * spin + (fromTilt ? node.tiltAxis.z * tiltOmega : 0);

    const cScaleXZ = fromTilt ? 0.94 : 0.82;
    const cScaleY = fromTilt ? 0.94 : 0.75;
    const hx = Math.max(0.08, node.half.x * cScaleXZ);
    const hy = Math.max(0.08, node.half.y * cScaleY);
    const hz = Math.max(0.08, node.half.z * cScaleXZ);

    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation(quat)
        .setLinvel(_vel.x, _vel.y, _vel.z)
        .setAngvel({ x: angX, y: angY, z: angZ })
        .setLinearDamping(0.08)
        .setAngularDamping(0.4),
    );

    const colDesc = R.ColliderDesc.cuboid(hx, hy, hz);
    world.createCollider(
      colDesc
        .setDensity(densityFor(node.structuralMaterial))
        .setFriction(fromTilt ? 0.65 : 0.45)
        .setRestitution(0.14)
        .setCollisionGroups(groups(CG.Debris, CG.World | CG.Debris)),
      body,
    );

    node.dynamicBody = body;
    const impactRadius = defaultImpactRadius(node);
    this.dynamicPool.push({
      cluster,
      node,
      body,
      age: 0,
      stillTime: 0,
      peakSpeed: _vel.length(),
      impactRadius,
      impactDamage: node.spec.impactDamage ?? (node.kind === 'craneBoom' ? 420 : 240),
      impactTriggered: false,
      crushedUids: new Set(),
    });
  }

  private recycleOldestDynamicBody(): void {
    const len = this.dynamicPool.length;
    if (len === 0) return;
    let oldestIdx = 0;
    let maxAge = this.dynamicPool[0]!.age;
    for (let i = 1; i < len; i++) {
      const a = this.dynamicPool[i]!.age;
      if (a > maxAge) {
        maxAge = a;
        oldestIdx = i;
      }
    }
    const oldest = this.dynamicPool[oldestIdx]!;
    const last = this.dynamicPool.pop()!;
    if (oldestIdx < this.dynamicPool.length) this.dynamicPool[oldestIdx] = last;
    this.settleDynamicEntry(oldest, true);
  }

  /** Spawns a persistent low walkable rubble pile on the ground when heavy concrete/masonry buildings collapse. */
  private spawnRubbleMound(center: THREE.Vector3, radius: number, colorHex: number): void {
    while (this.rubbleMounds.length >= MAX_RUBBLE_MOUNDS) {
      const oldest = this.rubbleMounds.shift()!;
      this.root.remove(oldest.mesh);
      oldest.geom.dispose();
      if (oldest.collider) this.ctx.physics.world.removeCollider(oldest.collider, false);
    }

    // Raycast down to place mound flush on terrain/floor
    _v.set(center.x, Math.max(2, center.y + 4), center.z);
    const groundHit = this.ctx.physics.raycast?.(_v, DOWN, 30, CG.World) ?? null;
    const baseY = groundHit ? groundHit.point.y : 0;

    const r = clamp(radius, 1.4, 3.6);
    const h = clamp(0.45 + r * 0.08, 0.45, 0.72);
    const geom = buildRubbleMoundGeometry(r, h, colorHex);
    const mesh = new THREE.Mesh(geom, this.material('concreteDark'));
    mesh.position.set(center.x, baseY, center.z);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.staticShadow = true;
    this.root.add(mesh);

    // Low step-over walkable box collider so soldiers can scramble over collapsed rubble as cover
    const colPos = new THREE.Vector3(center.x, baseY + h * 0.34, center.z);
    const colHalf = new THREE.Vector3(r * 0.65, h * 0.34, r * 0.65);
    const collider = this.ctx.physics.addStaticBox(colPos, colHalf, null, 'concrete');
    this.rubbleMounds.push({ mesh, geom, collider });
    this.requestStaticShadowRefresh();
  }

  private settleDynamicEntry(entry: DynamicEntry, recycledByCap: boolean): void {
    const { node, body } = entry;
    if (!node.dynamicBody) return;
    const t = body.translation(this._t);
    const r = body.rotation(this._r);

    // Zero-air settle verification: never freeze a floating debris block in mid-air!
    const maxExtent = Math.max(node.half.x, node.half.y, node.half.z);
    let grounded = t.y <= maxExtent + 1.1;
    if (!grounded && this.ctx.physics.raycast) {
      _v.set(t.x, t.y, t.z);
      const hit = this.ctx.physics.raycast(_v, DOWN, maxExtent + 1.8, CG.World);
      if (hit && hit.distance <= maxExtent + 1.55) {
        grounded = true;
      }
    }

    if (node.mesh) {
      node.mesh.position.set(t.x, t.y, t.z);
      node.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      node.mesh.updateMatrix();
      node.mesh.matrixAutoUpdate = false;
      if (!grounded || (recycledByCap && t.y > 3.5)) {
        node.mesh.visible = false;
        node.mesh.userData.staticShadow = false;
        node.state = 'gone';
      } else {
        node.state = 'settled';
        if (maxExtent < 0.55) {
          node.mesh.castShadow = false;
          node.mesh.userData.staticShadow = false;
        } else {
          node.mesh.userData.staticShadow = true;
        }
        this.requestStaticShadowRefresh();
      }
    } else {
      node.state = 'gone';
    }
    this.ctx.physics.world.removeRigidBody(body);
    node.dynamicBody = null;
  }

  private checkClusterCollapse(cluster: StructuralCluster): void {
    if (cluster.collapsed) return;
    const keyBroken = cluster.nodes.some(n => n.keyNode && n.state !== 'intact');
    if (keyBroken || cluster.destroyedFraction >= cluster.collapseThreshold) {
      cluster.collapsed = true;
      // Leave persistent walkable rubble piles behind collapsed masonry/concrete buildings
      const hasHeavyMasonry = cluster.nodes.some(
        n =>
          n.structuralMaterial === 'concrete' ||
          n.structuralMaterial === 'masonry' ||
          n.structuralMaterial === 'reinforced_concrete',
      );
      if (hasHeavyMasonry && cluster.nodes.length >= 6) {
        const moundR = clamp(cluster.radius * 0.28, 1.8, 3.4);
        this.spawnRubbleMound(cluster.center, moundR, 0x7c7870);
      }
      const collapseSfx = clusterCollapseSfxFor(cluster);
      this.ctx.audio?.play?.(collapseSfx, {
        position: cluster.center,
        volume: 1.0,
        pitch: 0.84,
        pitchJitter: 0.06,
      });
      cluster.onCollapse?.(cluster);
      this.ctx.events?.emit?.('world:liquidated', {
        label: cluster.label,
        value: cluster.value,
        position: cluster.center.clone(),
        kind: cluster.kind,
      });
      this.ctx.progression?.award?.(Math.max(100, Math.round(cluster.value / 100)), cluster.label, cluster.center);
    }
  }

  /** Kinetic crush check for falling structural debris against living enemies (passes type: 'crush'). */
  private checkCrush(entry: DynamicEntry, pos: THREE.Vector3, vel: THREE.Vector3, speed: number): void {
    if (speed <= CRUSH_SPEED || !this.ctx.enemies?.query) return;
    const { node } = entry;
    const crushRadius = Math.max(node.half.x, node.half.y, node.half.z) + 1.0;
    const n = this.ctx.enemies.query(pos, crushRadius, this.nearEnemies);
    if (n === 0) return;
    this._crushDir.copy(vel).normalize();
    for (let ei = 0; ei < n; ei++) {
      const e = this.nearEnemies[ei]!;
      if (!e.alive || entry.crushedUids.has(e.uid)) continue;
      entry.crushedUids.add(e.uid);
      this._crushPt.copy(e.center);
      this.ctx.enemies.applyDamage(e, {
        amount: CRUSH_DAMAGE,
        type: 'crush',
        point: this._crushPt,
        dir: this._crushDir,
        force: 220,
        source: 'structural_collapse',
        gib: true,
      });
    }
  }

  /** Advance splinters, buckling columns, sagging nodes, dynamic falling physics, kinetic crush, hazard chains, and nuke sweeps. */
  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;

    // 0. Advance pooled 3D splinters / shards / masonry chunks (O(1) when idle)
    this.splinters.update(dt);

    // 1. Expanding Nuke shockwave sweeps
    for (let i = this.sweeps.length - 1; i >= 0; i--) {
      const sw = this.sweeps[i]!;
      sw.radius += sw.speed * dt;
      const rSq = sw.radius * sw.radius;
      let dirtyClusters: Set<StructuralCluster> | null = null;
      for (let ci = 0; ci < this.clusters.length; ci++) {
        const cluster = this.clusters[ci]!;
        const reach = sw.radius + cluster.radius;
        if (sw.epicenter.distanceToSquared(cluster.center) > reach * reach) continue;
        for (let ni = 0; ni < cluster.nodes.length; ni++) {
          const node = cluster.nodes[ni]!;
          if (node.state !== 'intact' && node.state !== 'tilting') continue;
          if (node.basePos.distanceToSquared(sw.epicenter) > rSq) continue;
          if (node.state === 'tilting') {
            this.releaseTiltingNodeNow(cluster, node, sw.epicenter, true);
          } else {
            this.breakNode(cluster, node, sw.epicenter, true, true);
            if (!dirtyClusters) dirtyClusters = new Set();
            dirtyClusters.add(cluster);
          }
        }
      }
      if (dirtyClusters) {
        for (const cluster of dirtyClusters) {
          this.propagateSupportLoss(cluster, sw.epicenter, true);
          this.checkClusterCollapse(cluster);
        }
      }
      if (sw.radius >= sw.maxRadius) {
        const last = this.sweeps.pop()!;
        if (i < this.sweeps.length) this.sweeps[i] = last;
      }
    }

    // 2. Staggered secondary hazard explosions
    for (let i = this.pendingHazards.length - 1; i >= 0; i--) {
      const h = this.pendingHazards[i]!;
      h.delay -= dt;
      if (h.delay > 0) continue;
      const last = this.pendingHazards.pop()!;
      if (i < this.pendingHazards.length) this.pendingHazards[i] = last;
      this.detonateHazard(h);
    }

    // 2.5. Compressive overload column-buckling cascades (Red Faction pancake collapses)
    for (let i = this.buckling.length - 1; i >= 0; i--) {
      const b = this.buckling[i]!;
      b.delay -= dt;
      if (b.delay > 0) continue;
      const last = this.buckling.pop()!;
      if (i < this.buckling.length) this.buckling[i] = last;
      this.bucklingIds.delete(`${b.cluster.id}:${b.node.id}`);
      if (b.node.state === 'intact') {
        b.node.hp = 0;
        this.breakNode(b.cluster, b.node, b.origin, false, false);
      }
    }

    // 3. Gradual hinged sagging ("The Finals" intermediate groan-and-sag phase)
    for (let i = this.tilting.length - 1; i >= 0; i--) {
      const item = this.tilting[i]!;
      const { cluster, node } = item;
      node.tiltElapsed += dt;
      const t = clamp(node.tiltElapsed / Math.max(0.01, node.tiltDuration), 0, 1);
      if (node.mesh) {
        const ease = Math.pow(t, 2.2);
        const angle = ease * node.tiltMaxAngle;
        _q2.setFromAxisAngle(node.tiltAxis, angle);
        node.mesh.quaternion.multiplyQuaternions(_q2, node.baseQuat);

        _v.copy(node.tiltHingeOffset).negate().applyQuaternion(_q2).add(node.tiltHingeOffset).add(node.basePos);
        const jitter = (1 - t * 0.65) * 0.035;
        node.mesh.position.set(
          _v.x + (Math.random() - 0.5) * jitter,
          _v.y - ease * 0.24,
          _v.z + (Math.random() - 0.5) * jitter,
        );

        if (!node.tiltBendApplied && !node.tiltIsNuke && t >= 0.4) {
          node.tiltBendApplied = true;
          _q.copy(node.baseQuat).invert();
          _v3.set(0, -1, 0).applyQuaternion(_q);
          _v4.set(0, 0, 0);
          deformNodeGeometry({
            geom: node.mesh.geometry,
            restPos: node.restPositions,
            restCol: node.restColors,
            half: node.half,
            materialClass: node.materialClass,
            localHit: _v4,
            localDir: _v3,
            damageFrac: Math.max(node.deformStrain, 0.55),
            hitFrac: 0.35,
            bendDirAccum: node.bendDirLocal,
          });
        }

        node.tiltFxTimer -= dt;
        if (!node.tiltIsNuke && node.tiltFxTimer <= 0) {
          node.tiltFxTimer = 0.13 + Math.random() * 0.06;
          _v3.copy(node.basePos).add(node.tiltHingeOffset);
          const chipCol = chipColorFor(node.mat, node.spec.color);
          this.ctx.fx?.dust?.(_v3, UP, 0.85);
          if (node.materialClass === 'wood') {
            this.splinters.spawnBurst(_v3, UP, 'wood', 2, chipCol, 4.5);
          } else if (node.materialClass === 'metal') {
            this.ctx.fx?.sparks?.(_v3, UP, 6, 0xffcc66);
            this.splinters.spawnBurst(_v3, UP, 'metal', 1, chipCol, 4.8);
          } else {
            this.splinters.spawnBurst(_v3, UP, 'concrete', 2, chipCol, 4.0);
          }
        }
      }
      if (node.tiltElapsed >= node.tiltDuration) {
        const last = this.tilting.pop()!;
        if (i < this.tilting.length) this.tilting[i] = last;
        this.removeStaticCollider(node);
        if (node.mesh) {
          applyBreakFractureDeform(node.mesh.geometry, node.half, node.materialClass);
        }
        const chipCol = chipColorFor(node.mat, node.spec.color);
        this.splinters.spawnBurst(
          node.mesh ? node.mesh.position : node.basePos,
          UP,
          splinterKindFor(node.materialClass),
          node.materialClass === 'wood' ? 5 : 3,
          chipCol,
          6.5,
        );
        this.spawnDynamicBody(cluster, node, node.tiltBlastOrigin, node.tiltIsNuke, true);
      }
    }

    // 4. Active dynamic falling rigid bodies: sync transforms, kinetic crush, domino impacts, settling
    for (let i = this.dynamicPool.length - 1; i >= 0; i--) {
      const entry = this.dynamicPool[i]!;
      const { node, body } = entry;
      entry.age += dt;

      const t = body.translation(this._t);
      const r = body.rotation(this._r);
      const lv = body.linvel(this._lv);
      _v2.set(t.x, t.y, t.z);
      _vel.set(lv.x, lv.y, lv.z);
      const speed = _vel.length();

      if (node.mesh) {
        node.mesh.position.copy(_v2);
        node.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }

      this.checkCrush(entry, _v2, _vel, speed);

      if (entry.impactRadius > 0 && !entry.impactTriggered) {
        if (speed > entry.peakSpeed) entry.peakSpeed = speed;
        const minH = Math.min(node.half.x, node.half.y, node.half.z);
        const slammed = entry.peakSpeed > 5.0 && (speed < entry.peakSpeed * 0.45 || _v2.y - minH <= 0.65);
        if (slammed) {
          entry.impactTriggered = true;
          this.triggerDominoImpact(entry, _v2);
        }
      }

      if (speed < 0.35) entry.stillTime += dt;
      else entry.stillTime = 0;

      if (_v2.y < -40) {
        if (node.mesh) {
          node.mesh.visible = false;
          node.mesh.matrixAutoUpdate = false;
        }
        node.state = 'gone';
        this.ctx.physics.world.removeRigidBody(body);
        node.dynamicBody = null;
        const last = this.dynamicPool.pop()!;
        if (i < this.dynamicPool.length) this.dynamicPool[i] = last;
      } else if (entry.age >= DYNAMIC_MAX_AGE || entry.stillTime >= DYNAMIC_STILL_TIME) {
        const last = this.dynamicPool.pop()!;
        if (i < this.dynamicPool.length) this.dynamicPool[i] = last;
        this.settleDynamicEntry(entry, false);
      }
    }

    this.flushDirtyBatches();
    this.flushStaticShadowRefresh();
  }

  private detonateHazard(h: PendingHazard): void {
    const { fx, audio, render, camera, player, combat } = this.ctx;
    fx?.explosion?.(h.pos, { radius: h.radius, kind: 'barrel', scale: 1.7 });
    fx?.smoke?.(h.pos, 0x36322e, 4.5, 4.0);
    fx?.sparks?.(h.pos, UP, 28, 0xffaa33);
    render?.lights?.flash?.(h.pos, 0xff8022, 95, h.radius * 2.5, 0.55);
    audio?.play?.('explosion_tank', { position: h.pos, volume: 0.95 });
    if (player?.position instanceof THREE.Vector3) {
      const d = player.position.distanceTo(h.pos);
      camera?.addTrauma?.(clamp(1 - d / (h.radius * 3.5), 0, 1) * 0.8);
    }
    combat?.explode?.(h.pos, {
      radius: h.radius,
      damage: h.damage,
      kind: 'barrel',
      source: 'hazard_chain',
      team: 'player',
      scale: 1.6,
      worldObject: true,
    });
    this.blast(h.pos, h.radius, h.damage, 'hazard_chain');
    this.onSecondaryBlast?.(h.pos, h.radius, h.damage, 'hazard_chain');
  }

  private triggerDominoImpact(entry: DynamicEntry, impactPos: THREE.Vector3): void {
    const { fx, audio, camera, player } = this.ctx;
    const pos = impactPos.clone();
    fx?.dust?.(pos, UP, 3.2);
    fx?.smoke?.(pos, 0x8a8478, 4.0, 3.0);
    fx?.chips?.(pos, chipColorFor(entry.node.mat, entry.node.spec.color), 20);
    const impactSfx = breakSfxFor(entry.node);
    audio?.play?.(impactSfx, { position: pos, volume: 0.95, pitch: 0.82, pitchJitter: 0.08 });
    audio?.play?.('explosion_debris', { position: pos, volume: 0.65, pitch: 0.8 });
    if (player?.position instanceof THREE.Vector3) {
      const d = player.position.distanceTo(pos);
      camera?.addTrauma?.(clamp(1 - d / 40, 0, 1) * 0.65);
    }
    this.blast(pos, entry.impactRadius, entry.impactDamage, 'hazard_chain', entry.cluster.id);
    this.onSecondaryBlast?.(pos, entry.impactRadius, entry.impactDamage, 'hazard_chain');
  }

  /** Restores every registered cluster back to pristine intact state (e.g. on run restart). */
  reset(): void {
    const specs = this.clusters.map(c => ({ id: c.id, spec: c.spec }));
    this.clear();
    for (const s of specs) {
      const cluster = new StructuralCluster(s.spec, s.id);
      this.buildClusterRuntime(cluster);
      this.clusters.push(cluster);
      if (cluster.tag) this.byTag.set(cluster.tag, cluster);
    }
    this.requestStaticShadowRefresh();
    this.flushStaticShadowRefresh();
  }

  /** Removes all clusters, meshes, colliders, dynamic bodies, rubble mounds, splinters, pending hazards, and active sweeps. */
  clear(): void {
    for (const entry of this.dynamicPool) {
      this.ctx.physics.world.removeRigidBody(entry.body);
      entry.node.dynamicBody = null;
    }
    this.dynamicPool.length = 0;
    this.tilting.length = 0;
    this.buckling.length = 0;
    this.bucklingIds.clear();
    this.pendingHazards.length = 0;
    this.sweeps.length = 0;
    this.splinters.clear();

    for (const m of this.rubbleMounds) {
      this.root.remove(m.mesh);
      m.geom.dispose();
      if (m.collider) this.ctx.physics.world.removeCollider(m.collider, false);
    }
    this.rubbleMounds.length = 0;

    for (const cluster of this.clusters) {
      this.clearClusterBatchMeshes(cluster);
      for (const node of cluster.nodes) {
        if (node.navBlocked) this.setNodeNavBlocked(node, false);
        if (node.staticCollider) {
          this.ctx.physics.world.removeCollider(node.staticCollider, false);
          node.staticCollider = null;
        }
        if (node.mesh) {
          this.root.remove(node.mesh);
          node.mesh = null;
        }
      }
    }
    this.byCollider.clear();
    this.byTag.clear();
    this.clusters.length = 0;

    for (const g of this.geometries) g.dispose();
    this.geometries.length = 0;
    this.requestStaticShadowRefresh();
    this.flushStaticShadowRefresh();
  }

  dispose(): void {
    this.clear();
    this.splinters.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Helper Cluster Builders
// ---------------------------------------------------------------------------------------------

export interface ClusterBuilderOptions {
  id?: string;
  tag?: string;
  yaw?: number;
  label?: string;
  value?: number;
  tier?: DestructionTier;
  onCollapse?: (cluster: StructuralCluster) => void;
}

function makeTransform(origin: Vec3Like, yaw = 0) {
  const o = toVec3(origin);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    pt(lx: number, ly: number, lz: number): [number, number, number] {
      return [o.x + lx * c + lz * s, o.y + ly, o.z - lx * s + lz * c];
    },
    yaw,
  };
}

/**
 * Tier 1 Masonry Garrison Barracks with 4 anchored foundation columns, perimeter masonry walls,
 * supported roof slabs, an interior volatile ammo crate hazard, and a front doorway spawnPoint.
 */
export function buildBarracksCluster(
  origin: Vec3Like,
  opts: ClusterBuilderOptions = {},
): StructuralClusterSpec {
  const tier: DestructionTier = opts.tier ?? 1;
  const t = makeTransform(origin, opts.yaw ?? 0);
  const W = 5.0; // half width
  const D = 3.5; // half depth
  const H = 3.8; // wall height

  const nodes: StructuralNodeSpec[] = [
    // 4 anchored corner columns
    { id: 'col_fl', pos: t.pt(-W, H / 2, D), half: [0.45, H / 2, 0.45], mat: 'concrete', hp: 220, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'col_fr', pos: t.pt(W, H / 2, D), half: [0.45, H / 2, 0.45], mat: 'concrete', hp: 220, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'col_bl', pos: t.pt(-W, H / 2, -D), half: [0.45, H / 2, 0.45], mat: 'concrete', hp: 220, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'col_br', pos: t.pt(W, H / 2, -D), half: [0.45, H / 2, 0.45], mat: 'concrete', hp: 220, tier, anchored: true, kind: 'column', yaw: t.yaw },

    // Side & back masonry walls
    { id: 'wall_left', pos: t.pt(-W, H / 2, 0), half: [0.28, H / 2, D - 0.5], mat: 'concrete', color: 0xb0a696, hp: 180, tier, anchored: true, kind: 'wall', yaw: t.yaw },
    { id: 'wall_right', pos: t.pt(W, H / 2, 0), half: [0.28, H / 2, D - 0.5], mat: 'concrete', color: 0xb0a696, hp: 180, tier, anchored: true, kind: 'wall', yaw: t.yaw },
    { id: 'wall_back', pos: t.pt(0, H / 2, -D), half: [W - 0.5, H / 2, 0.28], mat: 'concrete', color: 0xa69c8c, hp: 200, tier, anchored: true, kind: 'wall', yaw: t.yaw },

    // Front lintel beam over doorway (unsupported once front columns fall)
    { id: 'lintel_front', pos: t.pt(0, H - 0.4, D), half: [W - 0.5, 0.4, 0.3], mat: 'concreteDark', hp: 160, tier, anchored: false, kind: 'wall', yaw: t.yaw },

    // Twin heavy roof slabs (unsupported once columns/walls are blown out!)
    { id: 'roof_left', pos: t.pt(-W / 2, H + 0.28, 0), half: [W / 2 + 0.3, 0.28, D + 0.4], mat: 'concreteDark', hp: 240, tier, anchored: false, kind: 'roof', yaw: t.yaw, impactRadius: 7 },
    { id: 'roof_right', pos: t.pt(W / 2, H + 0.28, 0), half: [W / 2 + 0.3, 0.28, D + 0.4], mat: 'concreteDark', hp: 240, tier, anchored: false, kind: 'roof', yaw: t.yaw, impactRadius: 7 },

    // Interior ammo crate hazard
    { id: 'ammo_hazard', pos: t.pt(-2.2, 0.65, -1.2), half: [0.65, 0.65, 0.65], mat: 'paintRed', hp: 60, tier: 0, anchored: true, kind: 'hazard', yaw: t.yaw, hazardRadius: 9.5, hazardDamage: 240 },
  ];

  const links: [string, string][] = [
    ['col_fl', 'lintel_front'],
    ['col_fr', 'lintel_front'],
    ['col_fl', 'roof_left'],
    ['col_bl', 'roof_left'],
    ['wall_left', 'roof_left'],
    ['col_fr', 'roof_right'],
    ['col_br', 'roof_right'],
    ['wall_right', 'roof_right'],
    ['wall_back', 'roof_left'],
    ['wall_back', 'roof_right'],
    ['roof_left', 'roof_right'],
  ];

  return {
    id: opts.id,
    tag: opts.tag,
    kind: 'barracks',
    label: opts.label ?? 'GARRISON BARRACKS',
    value: opts.value ?? 140_000,
    spawnPoint: t.pt(0, 0, D + 2.5),
    nodes,
    links,
    onCollapse: opts.onCollapse,
  };
}

/**
 * Tier 2 Heavy Industrial Cannery Hall: 6 steel columns, industrial siding, heavy elevated roof bays,
 * and 2 volatile brine boilers (`kind: 'hazard'`) whose secondary chain blasts can blow the roof off.
 */
export function buildCanneryCluster(
  origin: Vec3Like,
  opts: ClusterBuilderOptions = {},
): StructuralClusterSpec {
  const tier: DestructionTier = opts.tier ?? 2;
  const t = makeTransform(origin, opts.yaw ?? 0);
  const W = 8.0;
  const D = 5.0;
  const H = 6.2;

  const nodes: StructuralNodeSpec[] = [
    // 6 anchored heavy steel columns
    { id: 'col_fl', pos: t.pt(-W, H / 2, D), half: [0.5, H / 2, 0.5], mat: 'steelDark', hp: 420, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'col_fm', pos: t.pt(0, H / 2, D), half: [0.5, H / 2, 0.5], mat: 'steelDark', hp: 420, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'col_fr', pos: t.pt(W, H / 2, D), half: [0.5, H / 2, 0.5], mat: 'steelDark', hp: 420, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'col_bl', pos: t.pt(-W, H / 2, -D), half: [0.5, H / 2, 0.5], mat: 'steelDark', hp: 420, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'col_bm', pos: t.pt(0, H / 2, -D), half: [0.5, H / 2, 0.5], mat: 'steelDark', hp: 420, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'col_br', pos: t.pt(W, H / 2, -D), half: [0.5, H / 2, 0.5], mat: 'steelDark', hp: 420, tier, anchored: true, kind: 'column', yaw: t.yaw },

    // Side & rear heavy corrugated walls
    { id: 'wall_l', pos: t.pt(-W, H / 2, 0), half: [0.3, H / 2, D - 0.6], mat: 'rust', hp: 340, tier, anchored: true, kind: 'wall', yaw: t.yaw },
    { id: 'wall_r', pos: t.pt(W, H / 2, 0), half: [0.3, H / 2, D - 0.6], mat: 'rust', hp: 340, tier, anchored: true, kind: 'wall', yaw: t.yaw },
    { id: 'wall_bl', pos: t.pt(-W / 2, H / 2, -D), half: [W / 2 - 0.6, H / 2, 0.3], mat: 'panel', hp: 340, tier, anchored: true, kind: 'wall', yaw: t.yaw },
    { id: 'wall_br', pos: t.pt(W / 2, H / 2, -D), half: [W / 2 - 0.6, H / 2, 0.3], mat: 'panel', hp: 340, tier, anchored: true, kind: 'wall', yaw: t.yaw },

    // Heavy elevated roof slabs (2 bays)
    { id: 'roof_west', pos: t.pt(-W / 2, H + 0.35, 0), half: [W / 2 + 0.3, 0.35, D + 0.5], mat: 'steel', hp: 460, tier, anchored: false, kind: 'roof', yaw: t.yaw, impactRadius: 10 },
    { id: 'roof_east', pos: t.pt(W / 2, H + 0.35, 0), half: [W / 2 + 0.3, 0.35, D + 0.5], mat: 'steel', hp: 460, tier, anchored: false, kind: 'roof', yaw: t.yaw, impactRadius: 10 },

    // Brine boilers (Tier 1 hazards inside the cannery)
    { id: 'boiler_west', pos: t.pt(-W * 0.48, 1.8, -1.2), half: [1.1, 1.8, 1.1], mat: 'paintRed', hp: 140, tier: 1, anchored: true, kind: 'hazard', yaw: t.yaw, hazardRadius: 13, hazardDamage: 320 },
    { id: 'boiler_east', pos: t.pt(W * 0.48, 1.8, -1.2), half: [1.1, 1.8, 1.1], mat: 'paintRed', hp: 140, tier: 1, anchored: true, kind: 'hazard', yaw: t.yaw, hazardRadius: 13, hazardDamage: 320 },
  ];

  const links: [string, string][] = [
    ['col_fl', 'roof_west'],
    ['col_fm', 'roof_west'],
    ['col_bl', 'roof_west'],
    ['col_bm', 'roof_west'],
    ['wall_l', 'roof_west'],
    ['wall_bl', 'roof_west'],
    ['col_fm', 'roof_east'],
    ['col_fr', 'roof_east'],
    ['col_bm', 'roof_east'],
    ['col_br', 'roof_east'],
    ['wall_r', 'roof_east'],
    ['wall_br', 'roof_east'],
    ['roof_west', 'roof_east'],
  ];

  return {
    id: opts.id,
    tag: opts.tag,
    kind: 'cannery',
    label: opts.label ?? 'CANNERY HALL',
    value: opts.value ?? 320_000,
    nodes,
    links,
    onCollapse: opts.onCollapse,
  };
}

/**
 * Tier 3 Reinforced Quay Crane Base + Tier 2 Steel Gantry Mast & Cantilevered Crane Boom.
 * Destroying the reinforced base (Howitzer/Nuke) or snapping the mast sends the massive boom crashing down
 * with domino impact damage on surrounding clusters.
 */
export function buildQuayCraneCluster(
  origin: Vec3Like,
  opts: ClusterBuilderOptions = {},
): StructuralClusterSpec {
  const baseTier: DestructionTier = opts.tier ?? 3;
  const upperTier: DestructionTier = baseTier >= 2 ? 2 : baseTier;
  const t = makeTransform(origin, opts.yaw ?? 0);

  const nodes: StructuralNodeSpec[] = [
    // Reinforced concrete/steel anchor legs (Tier 3)
    { id: 'base_fl', pos: t.pt(-2.8, 2.2, 2.8), half: [0.85, 2.2, 0.85], mat: 'concreteDark', hp: 650, tier: baseTier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'base_fr', pos: t.pt(2.8, 2.2, 2.8), half: [0.85, 2.2, 0.85], mat: 'concreteDark', hp: 650, tier: baseTier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'base_bl', pos: t.pt(-2.8, 2.2, -2.8), half: [0.85, 2.2, 0.85], mat: 'concreteDark', hp: 650, tier: baseTier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'base_br', pos: t.pt(2.8, 2.2, -2.8), half: [0.85, 2.2, 0.85], mat: 'concreteDark', hp: 650, tier: baseTier, anchored: true, kind: 'column', yaw: t.yaw },

    // Slewing deck platform
    { id: 'deck', pos: t.pt(0, 4.9, 0), half: [3.6, 0.55, 3.6], mat: 'steelDark', hp: 500, tier: upperTier, anchored: false, kind: 'slab', yaw: t.yaw, impactRadius: 10 },

    // Steel tower mast & operator cab
    { id: 'tower_mast', pos: t.pt(0, 9.6, 0), half: [1.5, 4.2, 1.5], mat: 'paintYellow', hp: 460, tier: upperTier, anchored: false, kind: 'tower', yaw: t.yaw, impactRadius: 11, keyNode: true },
    { id: 'cab', pos: t.pt(2.1, 7.6, 1.2), half: [1.2, 1.3, 1.4], mat: 'panel', hp: 220, tier: 1, anchored: false, kind: 'wall', yaw: t.yaw },

    // Massive cantilevered crane boom + counterweight
    { id: 'boom_front', pos: t.pt(6.8, 14.3, 0), half: [7.8, 0.7, 0.85], mat: 'paintYellow', hp: 400, tier: upperTier, anchored: false, kind: 'craneBoom', yaw: t.yaw, impactRadius: 15, impactDamage: 480 },
    { id: 'boom_rear', pos: t.pt(-4.6, 14.3, 0), half: [3.8, 0.85, 1.1], mat: 'hazard', hp: 420, tier: upperTier, anchored: false, kind: 'craneBoom', yaw: t.yaw, impactRadius: 12, impactDamage: 380 },
  ];

  const links: [string, string][] = [
    ['base_fl', 'deck'],
    ['base_fr', 'deck'],
    ['base_bl', 'deck'],
    ['base_br', 'deck'],
    ['deck', 'tower_mast'],
    ['tower_mast', 'cab'],
    ['tower_mast', 'boom_front'],
    ['tower_mast', 'boom_rear'],
    ['boom_front', 'boom_rear'],
  ];

  return {
    id: opts.id,
    tag: opts.tag,
    kind: 'quayCrane',
    label: opts.label ?? 'QUAY CRANE',
    value: opts.value ?? 450_000,
    nodes,
    links,
    collapseThreshold: 0.5,
    onCollapse: opts.onCollapse,
  };
}

/**
 * Tier 2 Heavy Steel/Masonry Market Hall with anchored colonnade piers, wide canopy roof slabs,
 * and an interior fuel generator hazard.
 */
export function buildMarketHallCluster(
  origin: Vec3Like,
  opts: ClusterBuilderOptions = {},
): StructuralClusterSpec {
  const tier: DestructionTier = opts.tier ?? 2;
  const t = makeTransform(origin, opts.yaw ?? 0);
  const W = 7.0;
  const D = 4.6;
  const H = 5.2;

  const nodes: StructuralNodeSpec[] = [
    { id: 'pier_fl', pos: t.pt(-W, H / 2, D), half: [0.48, H / 2, 0.48], mat: 'concrete', hp: 360, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'pier_fm', pos: t.pt(0, H / 2, D), half: [0.48, H / 2, 0.48], mat: 'concrete', hp: 360, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'pier_fr', pos: t.pt(W, H / 2, D), half: [0.48, H / 2, 0.48], mat: 'concrete', hp: 360, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'pier_bl', pos: t.pt(-W, H / 2, -D), half: [0.48, H / 2, 0.48], mat: 'concrete', hp: 360, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'pier_bm', pos: t.pt(0, H / 2, -D), half: [0.48, H / 2, 0.48], mat: 'concrete', hp: 360, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'pier_br', pos: t.pt(W, H / 2, -D), half: [0.48, H / 2, 0.48], mat: 'concrete', hp: 360, tier, anchored: true, kind: 'column', yaw: t.yaw },

    // Timber/plaster gable end walls (Tier 1)
    { id: 'gable_l', pos: t.pt(-W, H * 0.72, 0), half: [0.24, H * 0.28, D - 0.6], mat: 'plywood', hp: 120, tier: 0, anchored: false, kind: 'wall', yaw: t.yaw },
    { id: 'gable_r', pos: t.pt(W, H * 0.72, 0), half: [0.24, H * 0.28, D - 0.6], mat: 'plywood', hp: 120, tier: 0, anchored: false, kind: 'wall', yaw: t.yaw },

    // Wide heavy canopy roof panels
    { id: 'canopy_w', pos: t.pt(-W / 2, H + 0.3, 0), half: [W / 2 + 0.3, 0.3, D + 0.6], mat: 'rust', hp: 380, tier, anchored: false, kind: 'roof', yaw: t.yaw, impactRadius: 9 },
    { id: 'canopy_e', pos: t.pt(W / 2, H + 0.3, 0), half: [W / 2 + 0.3, 0.3, D + 0.6], mat: 'rust', hp: 380, tier, anchored: false, kind: 'roof', yaw: t.yaw, impactRadius: 9 },

    // Fuel generator hazard
    { id: 'gen_hazard', pos: t.pt(0, 1.0, -D + 1.4), half: [0.9, 1.0, 0.8], mat: 'paintRed', hp: 100, tier: 1, anchored: true, kind: 'hazard', yaw: t.yaw, hazardRadius: 11, hazardDamage: 260 },
  ];

  const links: [string, string][] = [
    ['pier_fl', 'gable_l'],
    ['pier_bl', 'gable_l'],
    ['pier_fr', 'gable_r'],
    ['pier_br', 'gable_r'],
    ['pier_fl', 'canopy_w'],
    ['pier_fm', 'canopy_w'],
    ['pier_bl', 'canopy_w'],
    ['pier_bm', 'canopy_w'],
    ['pier_fm', 'canopy_e'],
    ['pier_fr', 'canopy_e'],
    ['pier_bm', 'canopy_e'],
    ['pier_br', 'canopy_e'],
    ['canopy_w', 'canopy_e'],
  ];

  return {
    id: opts.id,
    tag: opts.tag,
    kind: 'marketHall',
    label: opts.label ?? 'MARKET HALL',
    value: opts.value ?? 260_000,
    nodes,
    links,
    onCollapse: opts.onCollapse,
  };
}

/**
 * Elevated Industrial Steel Catwalk with anchored stanchions and supported steel grate walkway spans.
 * Knocking out the stanchions sends the entire walkway crashing down.
 */
export function buildCatwalkCluster(
  origin: Vec3Like,
  opts: ClusterBuilderOptions & { length?: number; height?: number } = {},
): StructuralClusterSpec {
  const tier: DestructionTier = opts.tier ?? 2;
  const L = opts.length ?? 14;
  const H = opts.height ?? 4.2;
  const t = makeTransform(origin, opts.yaw ?? 0);
  const halfL = L / 2;

  const nodes: StructuralNodeSpec[] = [
    // 3 pairs of anchored stanchions (left, middle, right)
    { id: 'stanchion_l', pos: t.pt(-halfL + 1.0, H / 2, 0), half: [0.32, H / 2, 1.1], mat: 'steelDark', hp: 280, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'stanchion_m', pos: t.pt(0, H / 2, 0), half: [0.32, H / 2, 1.1], mat: 'steelDark', hp: 280, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'stanchion_r', pos: t.pt(halfL - 1.0, H / 2, 0), half: [0.32, H / 2, 1.1], mat: 'steelDark', hp: 280, tier, anchored: true, kind: 'column', yaw: t.yaw },

    // Two elevated catwalk grate deck spans
    { id: 'deck_l', pos: t.pt(-halfL / 2, H + 0.16, 0), half: [halfL / 2, 0.16, 1.3], mat: 'grate', hp: 240, tier, anchored: false, kind: 'catwalk', yaw: t.yaw, impactRadius: 6 },
    { id: 'deck_r', pos: t.pt(halfL / 2, H + 0.16, 0), half: [halfL / 2, 0.16, 1.3], mat: 'grate', hp: 240, tier, anchored: false, kind: 'catwalk', yaw: t.yaw, impactRadius: 6 },
  ];

  const links: [string, string][] = [
    ['stanchion_l', 'deck_l'],
    ['stanchion_m', 'deck_l'],
    ['stanchion_m', 'deck_r'],
    ['stanchion_r', 'deck_r'],
    ['deck_l', 'deck_r'],
  ];

  return {
    id: opts.id,
    tag: opts.tag,
    kind: 'catwalk',
    label: opts.label ?? 'STEEL CATWALK',
    value: opts.value ?? 95_000,
    nodes,
    links,
    onCollapse: opts.onCollapse,
  };
}

/**
 * Tier 1 Masonry Elevated Gun Emplacement Platform: 4 anchored corner piers, elevated concrete deck slab,
 * front parapet breastwork, and an ammunition crate hazard.
 */
export function buildEmplacementPlatformCluster(
  origin: Vec3Like,
  opts: ClusterBuilderOptions & { height?: number } = {},
): StructuralClusterSpec {
  const tier: DestructionTier = opts.tier ?? 1;
  const H = opts.height ?? 3.2;
  const t = makeTransform(origin, opts.yaw ?? 0);
  const W = 2.6;
  const D = 2.4;

  const nodes: StructuralNodeSpec[] = [
    // 4 anchored corner piers
    { id: 'pier_fl', pos: t.pt(-W, H / 2, D), half: [0.42, H / 2, 0.42], mat: 'concrete', hp: 200, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'pier_fr', pos: t.pt(W, H / 2, D), half: [0.42, H / 2, 0.42], mat: 'concrete', hp: 200, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'pier_bl', pos: t.pt(-W, H / 2, -D), half: [0.42, H / 2, 0.42], mat: 'concrete', hp: 200, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'pier_br', pos: t.pt(W, H / 2, -D), half: [0.42, H / 2, 0.42], mat: 'concrete', hp: 200, tier, anchored: true, kind: 'column', yaw: t.yaw },

    // Elevated deck slab
    { id: 'deck', pos: t.pt(0, H + 0.24, 0), half: [W + 0.4, 0.24, D + 0.4], mat: 'concreteDark', hp: 260, tier, anchored: false, kind: 'slab', yaw: t.yaw, impactRadius: 7 },

    // Front armored parapet
    { id: 'parapet', pos: t.pt(0, H + 1.0, D + 0.15), half: [W + 0.3, 0.55, 0.24], mat: 'concrete', hp: 180, tier, anchored: false, kind: 'wall', yaw: t.yaw },

    // Ammo supply hazard on the deck
    { id: 'ammo_crate', pos: t.pt(-1.4, H + 0.9, -1.0), half: [0.55, 0.45, 0.55], mat: 'paintRed', hp: 50, tier: 0, anchored: false, kind: 'hazard', yaw: t.yaw, hazardRadius: 9, hazardDamage: 220 },
  ];

  const links: [string, string][] = [
    ['pier_fl', 'deck'],
    ['pier_fr', 'deck'],
    ['pier_bl', 'deck'],
    ['pier_br', 'deck'],
    ['deck', 'parapet'],
    ['deck', 'ammo_crate'],
  ];

  return {
    id: opts.id,
    tag: opts.tag,
    kind: 'emplacementPlatform',
    label: opts.label ?? 'EMPLACEMENT PLATFORM',
    value: opts.value ?? 110_000,
    nodes,
    links,
    onCollapse: opts.onCollapse,
  };
}

// ---------------------------------------------------------------------------------------------
// Stair & Nav-Proxy Helpers for Elevated Destructible Structures
// ---------------------------------------------------------------------------------------------

export type NavProxyPhysics = Pick<Ctx['physics'], 'addStaticBox'>;

export interface StairSpan {
  readonly ax: number;
  readonly y0: number;
  readonly az: number;
  readonly bx: number;
  readonly y1: number;
  readonly bz: number;
  readonly width: number;
}

/** Computes center, half-extents, yaw, and roll for a sloped walkable ramp node whose top surface connects A to B. */
export function makeStairNode(
  id: string,
  span: StairSpan,
  opts: {
    mat?: Mat;
    color?: number | readonly [number, number, number];
    hp?: number;
    tier?: DestructionTier;
    anchored?: boolean;
    thickness?: number;
  } = {},
): StructuralNodeSpec {
  const th = opts.thickness ?? 0.2;
  const dx = span.bx - span.ax;
  const dy = span.y1 - span.y0;
  const dz = span.bz - span.az;
  const flat = Math.hypot(dx, dz);
  const len = Math.hypot(flat, dy);
  const yaw = Math.atan2(-dz, dx);
  const roll = Math.atan2(dy, flat);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);
  const mx = (span.ax + span.bx) * 0.5 + th * sr * cy;
  const my = (span.y0 + span.y1) * 0.5 - th * cr;
  const mz = (span.az + span.bz) * 0.5 - th * sr * sy;
  return {
    id,
    pos: [mx, my, mz],
    half: [len * 0.5, th, span.width * 0.5],
    mat: opts.mat ?? 'concrete',
    color: opts.color,
    hp: opts.hp ?? 140,
    tier: opts.tier ?? 1,
    anchored: opts.anchored ?? true,
    kind: 'catwalk',
    yaw,
    pitch: 0,
    roll,
  };
}

/** Creates a temporary static collider matching a StructuralNodeSpec so navGraph.build() samples elevated floors/stairs. */
export function createNavNodeProxy(physics: NavProxyPhysics, node: StructuralNodeSpec): RAPIER.Collider | null {
  const pos = toVec3(node.pos);
  const half = toVec3(node.half);
  const quat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(node.pitch ?? 0, node.yaw ?? 0, node.roll ?? 0, 'YXZ'),
  );
  return physics.addStaticBox(pos, half, quat, surfaceForMat(node.mat));
}

function collectNavProxies(
  physics: NavProxyPhysics | undefined,
  nodes: readonly StructuralNodeSpec[],
): RAPIER.Collider[] | undefined {
  if (!physics) return undefined;
  const out: RAPIER.Collider[] = [];
  for (const n of nodes) {
    const c = createNavNodeProxy(physics, n);
    if (c) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Holdfast Full-Destruction Builders
// ---------------------------------------------------------------------------------------------

export interface TerraceClusterOptions extends ClusterBuilderOptions {
  readonly len: number;
  readonly depth: number;
  readonly height?: number;
  readonly colors?: readonly (number | readonly [number, number, number])[];
  readonly stair?: StairSpan;
  readonly navPhysics?: NavProxyPhysics;
}

/**
 * Concrete Market Terrace: 2–3 painted concrete wall/core bays (Tier 2), walkable roof slabs at exact `height`
 * (`LEVEL.roof`), optional Tier 1 rear concrete stairs, and an optional rooftop water tank.
 * 40mm / Frame weapons breach it; a single 105mm Howitzer shell flattens the whole block!
 */
export function buildTerraceCluster(
  origin: Vec3Like,
  opts: TerraceClusterOptions,
): StructuralClusterSpec {
  const tier: DestructionTier = opts.tier ?? 2;
  const H = opts.height ?? 3.0;
  const hx = opts.len / 2;
  const hz = opts.depth / 2;
  const t = makeTransform(origin, opts.yaw ?? 0);
  const roofHalfY = 0.22;
  const wallH = H - roofHalfY * 2;
  const bays = opts.len >= 18 ? 3 : 2;
  const bayW = opts.len / bays;
  const palette = opts.colors && opts.colors.length > 0 ? opts.colors : [0xc87a56, 0x4b80a8, 0xd8b454];

  const nodes: StructuralNodeSpec[] = [];
  const links: [string, string][] = [];
  const walkableNodes: StructuralNodeSpec[] = [];

  for (let i = 0; i < bays; i++) {
    const lx = -hx + bayW * (i + 0.5);
    nodes.push({
      id: `bay_${i}`,
      pos: t.pt(lx, wallH / 2, 0),
      half: [bayW / 2 - 0.04, wallH / 2, hz - 0.04],
      mat: 'paintWhite',
      color: palette[i % palette.length],
      hp: 250,
      tier,
      anchored: true,
      kind: 'wall',
      yaw: t.yaw,
    });
  }

  // Two walkable concrete roof slabs whose top face sits at exact y = H
  const roofW: StructuralNodeSpec = {
    id: 'roof_w',
    pos: t.pt(-hx / 2, H - roofHalfY, 0),
    half: [hx / 2 + 0.06, roofHalfY, hz + 0.06],
    mat: 'concreteDark',
    color: 0x6b6862,
    hp: 240,
    tier,
    anchored: false,
    kind: 'roof',
    yaw: t.yaw,
    impactRadius: 8.5,
  };
  const roofE: StructuralNodeSpec = {
    id: 'roof_e',
    pos: t.pt(hx / 2, H - roofHalfY, 0),
    half: [hx / 2 + 0.06, roofHalfY, hz + 0.06],
    mat: 'concreteDark',
    color: 0x65625c,
    hp: 240,
    tier,
    anchored: false,
    kind: 'roof',
    yaw: t.yaw,
    impactRadius: 8.5,
  };
  nodes.push(roofW, roofE);
  walkableNodes.push(roofW, roofE);

  for (let i = 0; i < bays; i++) {
    const lx = -hx + bayW * (i + 0.5);
    if (lx <= 0.1) links.push([`bay_${i}`, 'roof_w']);
    if (lx >= -0.1) links.push([`bay_${i}`, 'roof_e']);
  }
  links.push(['roof_w', 'roof_e']);

  // Tier 1 rear concrete stairs (satchels/rockets/40mm/105mm can blow out rooftop access)
  if (opts.stair) {
    const stairNode = makeStairNode('stair_ramp', opts.stair, {
      mat: 'concrete',
      color: 0x8d887e,
      hp: 140,
      tier: 1,
      anchored: true,
      thickness: 0.2,
    });
    nodes.push(stairNode);
    walkableNodes.push(stairNode);
  }

  return {
    id: opts.id,
    tag: opts.tag,
    kind: 'terrace',
    label: opts.label ?? 'MARKET TERRACE',
    value: opts.value ?? 135_000,
    nodes,
    links,
    collapseThreshold: 0.55,
    navProxies: collectNavProxies(opts.navPhysics, walkableNodes),
    onCollapse: opts.onCollapse,
  };
}

export interface TowerClusterOptions extends ClusterBuilderOptions {
  readonly w: number;
  readonly d: number;
  readonly h: number;
  readonly color?: number | readonly [number, number, number];
}

/**
 * Multi-story concrete Port Office Tower (Tier 2): anchored lower piers/core, unsupported upper story & roof cap,
 * plus Tier 1 steel balcony slab. Crumbles violently when shelled by the 105mm Howitzer or Frame weapons.
 */
export function buildTowerCluster(
  origin: Vec3Like,
  opts: TowerClusterOptions,
): StructuralClusterSpec {
  const tier: DestructionTier = opts.tier ?? 2;
  const t = makeTransform(origin, opts.yaw ?? 0);
  const hw = opts.w / 2;
  const hd = opts.d / 2;
  const midH = opts.h * 0.5;
  const upperH = opts.h - midH - 0.4;
  const col = opts.color ?? 0xc97b54;

  const nodes: StructuralNodeSpec[] = [
    { id: 'base_w', pos: t.pt(-hw / 2, midH / 2, 0), half: [hw / 2 - 0.04, midH / 2, hd - 0.04], mat: 'paintWhite', color: col, hp: 320, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'base_e', pos: t.pt(hw / 2, midH / 2, 0), half: [hw / 2 - 0.04, midH / 2, hd - 0.04], mat: 'paintWhite', color: col, hp: 320, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'upper_w', pos: t.pt(-hw / 2, midH + upperH / 2, 0), half: [hw / 2 - 0.06, upperH / 2, hd - 0.06], mat: 'paintWhite', color: col, hp: 280, tier, anchored: false, kind: 'tower', yaw: t.yaw, impactRadius: 10 },
    { id: 'upper_e', pos: t.pt(hw / 2, midH + upperH / 2, 0), half: [hw / 2 - 0.06, upperH / 2, hd - 0.06], mat: 'paintWhite', color: col, hp: 280, tier, anchored: false, kind: 'tower', yaw: t.yaw, impactRadius: 10 },
    { id: 'roof_cap', pos: t.pt(0, opts.h - 0.2, 0), half: [hw + 0.16, 0.2, hd + 0.16], mat: 'concreteDark', color: 0x5c5852, hp: 260, tier, anchored: false, kind: 'roof', yaw: t.yaw, impactRadius: 11 },
    { id: 'balcony', pos: t.pt(0, 3.05, hd + 0.55), half: [hw - 0.3, 0.1, 0.55], mat: 'rust', hp: 130, tier: 1, anchored: false, kind: 'catwalk', yaw: t.yaw },
  ];

  const links: [string, string][] = [
    ['base_w', 'upper_w'],
    ['base_e', 'upper_e'],
    ['upper_w', 'upper_e'],
    ['upper_w', 'roof_cap'],
    ['upper_e', 'roof_cap'],
    ['base_w', 'balcony'],
    ['base_e', 'balcony'],
  ];

  return {
    id: opts.id,
    tag: opts.tag,
    kind: 'tower',
    label: opts.label ?? 'PORT OFFICE TOWER',
    value: opts.value ?? 210_000,
    nodes,
    links,
    collapseThreshold: 0.5,
    onCollapse: opts.onCollapse,
  };
}

/**
 * Painted 7m concrete Main Gate Tower (Tier 2): anchored lower masonry base, upper shaft, and steel loudspeaker cap.
 */
export function buildGateTowerCluster(
  origin: Vec3Like,
  opts: ClusterBuilderOptions & { w?: number; d?: number; h?: number; color?: number | readonly [number, number, number] } = {},
): StructuralClusterSpec {
  const tier: DestructionTier = opts.tier ?? 2;
  const hw = (opts.w ?? 3.0) / 2;
  const hd = (opts.d ?? 3.95) / 2;
  const H = opts.h ?? 7.0;
  const midH = H * 0.5;
  const t = makeTransform(origin, opts.yaw ?? 0);
  const col = opts.color ?? 0xd16b47;

  const nodes: StructuralNodeSpec[] = [
    { id: 'base_w', pos: t.pt(-hw / 2, midH / 2, 0), half: [hw / 2 - 0.03, midH / 2, hd - 0.03], mat: 'paintWhite', color: col, hp: 300, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'base_e', pos: t.pt(hw / 2, midH / 2, 0), half: [hw / 2 - 0.03, midH / 2, hd - 0.03], mat: 'paintWhite', color: col, hp: 300, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'upper_w', pos: t.pt(-hw / 2, midH + midH / 2, 0), half: [hw / 2 - 0.04, midH / 2, hd - 0.04], mat: 'paintWhite', color: col, hp: 240, tier, anchored: false, kind: 'tower', yaw: t.yaw, impactRadius: 9 },
    { id: 'upper_e', pos: t.pt(hw / 2, midH + midH / 2, 0), half: [hw / 2 - 0.04, midH / 2, hd - 0.04], mat: 'paintWhite', color: col, hp: 240, tier, anchored: false, kind: 'tower', yaw: t.yaw, impactRadius: 9 },
    { id: 'cap', pos: t.pt(0, H + 0.16, 0), half: [Math.min(hw, 1.3), 0.16, Math.min(hd, 1.3)], mat: 'steelDark', hp: 140, tier: 1, anchored: false, kind: 'roof', yaw: t.yaw, impactRadius: 8 },
  ];

  const links: [string, string][] = [
    ['base_w', 'upper_w'],
    ['base_e', 'upper_e'],
    ['upper_w', 'upper_e'],
    ['upper_w', 'cap'],
    ['upper_e', 'cap'],
  ];

  return {
    id: opts.id,
    tag: opts.tag,
    kind: 'gateTower',
    label: opts.label ?? 'GATE WATCH TOWER',
    value: opts.value ?? 160_000,
    nodes,
    links,
    collapseThreshold: 0.5,
    onCollapse: opts.onCollapse,
  };
}

export interface WallGunPadClusterOptions extends ClusterBuilderOptions {
  readonly halfX: number;
  readonly z0: number;
  readonly z1: number;
  readonly height: number;
  readonly stair?: StairSpan;
  readonly navPhysics?: NavProxyPhysics;
}

/**
 * Tier 1 destructible Wall Gun Pad behind the south wall: timber piers, walkable top deck at exact `height` (`LEVEL.pad`),
 * flanking sandbag cheeks, and rear access stairs.
 */
export function buildWallGunPadCluster(
  x: number,
  opts: WallGunPadClusterOptions,
): StructuralClusterSpec {
  const tier: DestructionTier = opts.tier ?? 1;
  const { halfX, z0, z1, height } = opts;
  const cz = (z0 + z1) / 2;
  const hz = (z1 - z0) / 2;
  const deckHalfY = 0.16;
  const pierH = height - deckHalfY * 2;

  const deck: StructuralNodeSpec = {
    id: 'deck',
    pos: [x, height - deckHalfY, cz],
    half: [halfX, deckHalfY, hz],
    mat: 'plywood',
    color: 0x9e7552,
    hp: 170,
    tier,
    anchored: false,
    kind: 'slab',
    impactRadius: 6,
  };

  const nodes: StructuralNodeSpec[] = [
    { id: 'pier_w', pos: [x - halfX + 0.55, pierH / 2, cz], half: [0.5, pierH / 2, hz - 0.15], mat: 'plywood', color: 0x7d5c3e, hp: 150, tier, anchored: true, kind: 'column' },
    { id: 'pier_e', pos: [x + halfX - 0.55, pierH / 2, cz], half: [0.5, pierH / 2, hz - 0.15], mat: 'plywood', color: 0x7d5c3e, hp: 150, tier, anchored: true, kind: 'column' },
    deck,
    { id: 'cheek_w', pos: [x - halfX + 0.3, height + 0.45, z1 - 0.8], half: [0.3, 0.45, 0.8], mat: 'dirt', color: 0x8f8266, hp: 110, tier, anchored: false, kind: 'wall' },
    { id: 'cheek_e', pos: [x + halfX - 0.3, height + 0.45, z1 - 0.8], half: [0.3, 0.45, 0.8], mat: 'dirt', color: 0x8f8266, hp: 110, tier, anchored: false, kind: 'wall' },
  ];

  const links: [string, string][] = [
    ['pier_w', 'deck'],
    ['pier_e', 'deck'],
    ['deck', 'cheek_w'],
    ['deck', 'cheek_e'],
  ];

  const walkable: StructuralNodeSpec[] = [deck];
  if (opts.stair) {
    const stairNode = makeStairNode('stair', opts.stair, {
      mat: 'concrete',
      color: 0x8a8378,
      hp: 120,
      tier,
      anchored: true,
      thickness: 0.2,
    });
    nodes.push(stairNode);
    walkable.push(stairNode);
  }

  return {
    id: opts.id,
    tag: opts.tag,
    kind: 'wallGunPad',
    label: opts.label ?? 'WALL GUN PLATFORM',
    value: opts.value ?? 85_000,
    nodes,
    links,
    collapseThreshold: 0.5,
    navProxies: collectNavProxies(opts.navPhysics, walkable),
    onCollapse: opts.onCollapse,
  };
}

export interface FiringStepClusterOptions extends ClusterBuilderOptions {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  readonly height: number;
  readonly stair?: StairSpan;
  readonly navPhysics?: NavProxyPhysics;
}

/**
 * Tier 1 destructible timber Firing Step behind the south wall: steel trestle legs, walkable timber deck spans
 * at exact `height` (`LEVEL.step`), and rear access stairs.
 */
export function buildFiringStepCluster(
  opts: FiringStepClusterOptions,
): StructuralClusterSpec {
  const tier: DestructionTier = opts.tier ?? 1;
  const { x0, x1, z0, z1, height } = opts;
  const len = x1 - x0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const hz = (z1 - z0) / 2;
  const deckHalfY = 0.12;
  const legH = height - deckHalfY * 2;
  const halfLen = len / 2;

  const deckW: StructuralNodeSpec = {
    id: 'deck_w',
    pos: [x0 + halfLen / 2, height - deckHalfY, cz],
    half: [halfLen / 2, deckHalfY, hz],
    mat: 'plywood',
    color: 0x8c6b4c,
    hp: 140,
    tier,
    anchored: false,
    kind: 'catwalk',
  };
  const deckE: StructuralNodeSpec = {
    id: 'deck_e',
    pos: [x0 + halfLen * 1.5, height - deckHalfY, cz],
    half: [halfLen / 2, deckHalfY, hz],
    mat: 'plywood',
    color: 0x8c6b4c,
    hp: 140,
    tier,
    anchored: false,
    kind: 'catwalk',
  };

  const nodes: StructuralNodeSpec[] = [
    { id: 'leg_w', pos: [x0 + 1.0, legH / 2, cz], half: [0.22, legH / 2, hz - 0.15], mat: 'rust', hp: 120, tier, anchored: true, kind: 'column' },
    { id: 'leg_m', pos: [cx, legH / 2, cz], half: [0.22, legH / 2, hz - 0.15], mat: 'rust', hp: 120, tier, anchored: true, kind: 'column' },
    { id: 'leg_e', pos: [x1 - 1.0, legH / 2, cz], half: [0.22, legH / 2, hz - 0.15], mat: 'rust', hp: 120, tier, anchored: true, kind: 'column' },
    deckW,
    deckE,
  ];

  const links: [string, string][] = [
    ['leg_w', 'deck_w'],
    ['leg_m', 'deck_w'],
    ['leg_m', 'deck_e'],
    ['leg_e', 'deck_e'],
    ['deck_w', 'deck_e'],
  ];

  const walkable: StructuralNodeSpec[] = [deckW, deckE];
  if (opts.stair) {
    const stairNode = makeStairNode('stair', opts.stair, {
      mat: 'concrete',
      color: 0x8a8378,
      hp: 110,
      tier,
      anchored: true,
      thickness: 0.2,
    });
    nodes.push(stairNode);
    walkable.push(stairNode);
  }

  return {
    id: opts.id,
    tag: opts.tag,
    kind: 'firingStep',
    label: opts.label ?? 'WALL FIRING STEP',
    value: opts.value ?? 75_000,
    nodes,
    links,
    collapseThreshold: 0.5,
    navProxies: collectNavProxies(opts.navPhysics, walkable),
    onCollapse: opts.onCollapse,
  };
}

export interface ShantyHouseClusterOptions extends ClusterBuilderOptions {
  readonly w: number;
  readonly d: number;
  readonly h?: number;
  readonly color?: number | readonly [number, number, number];
  readonly stair?: StairSpan;
  readonly sandbagFront?: boolean;
  readonly navPhysics?: NavProxyPhysics;
}

/**
 * Tier 1 destructible painted Shanty House (both Roof-Gun houses and scattered outer shanties).
 * Roof sits at exact `h` (`LEVEL.roof` when walkable), collapses cleanly under 40mm, 105mm, satchels, or rockets.
 */
export function buildShantyHouseCluster(
  origin: Vec3Like,
  opts: ShantyHouseClusterOptions,
): StructuralClusterSpec {
  const tier: DestructionTier = opts.tier ?? 1;
  const H = opts.h ?? 3.0;
  const hw = opts.w / 2;
  const hd = opts.d / 2;
  const t = makeTransform(origin, opts.yaw ?? 0);
  const roofHalfY = 0.18;
  const wallH = H - roofHalfY * 2;
  const col = opts.color ?? 0xc87a56;

  const roof: StructuralNodeSpec = {
    id: 'roof',
    pos: t.pt(0, H - roofHalfY, 0),
    half: [hw + 0.08, roofHalfY, hd + 0.08],
    mat: 'concreteDark',
    color: 0x6c6862,
    hp: 150,
    tier,
    anchored: false,
    kind: 'roof',
    yaw: t.yaw,
    impactRadius: 6.5,
  };

  const nodes: StructuralNodeSpec[] = [
    { id: 'wall_w', pos: t.pt(-hw / 2, wallH / 2, 0), half: [hw / 2 - 0.04, wallH / 2, hd - 0.04], mat: 'paintWhite', color: col, hp: 140, tier, anchored: true, kind: 'wall', yaw: t.yaw },
    { id: 'wall_e', pos: t.pt(hw / 2, wallH / 2, 0), half: [hw / 2 - 0.04, wallH / 2, hd - 0.04], mat: 'paintWhite', color: col, hp: 140, tier, anchored: true, kind: 'wall', yaw: t.yaw },
    roof,
  ];

  const links: [string, string][] = [
    ['wall_w', 'roof'],
    ['wall_e', 'roof'],
  ];

  if (opts.sandbagFront) {
    nodes.push({
      id: 'sandbag_front',
      pos: t.pt(0, H + 0.35, hd - 0.45),
      half: [Math.min(2.4, hw - 0.3), 0.35, 0.3],
      mat: 'dirt',
      color: 0x8e8064,
      hp: 100,
      tier,
      anchored: false,
      kind: 'wall',
      yaw: t.yaw,
    });
    links.push(['roof', 'sandbag_front']);
  }

  const walkable: StructuralNodeSpec[] = opts.navPhysics ? [roof] : [];
  if (opts.stair) {
    const stairNode = makeStairNode('stair', opts.stair, {
      mat: 'concrete',
      color: 0x8a8378,
      hp: 110,
      tier,
      anchored: true,
      thickness: 0.2,
    });
    nodes.push(stairNode);
    if (opts.navPhysics) walkable.push(stairNode);
  }

  return {
    id: opts.id,
    tag: opts.tag,
    kind: 'shantyHouse',
    label: opts.label ?? 'SHANTY HOUSE',
    value: opts.value ?? 75_000,
    nodes,
    links,
    collapseThreshold: 0.5,
    navProxies: collectNavProxies(opts.navPhysics, walkable),
    onCollapse: opts.onCollapse,
  };
}

/**
 * Tier 1 Outer-Shanty / Dockyard Militia Watchtower: braced rust/timber stilts, elevated lookout deck,
 * sandbag breastworks, tin roof canopy, and a volatile rooftop ammo box for dramatic AC-130 / rocket kills.
 */
export function buildWatchtowerCluster(
  origin: Vec3Like,
  opts: ClusterBuilderOptions & { height?: number } = {},
): StructuralClusterSpec {
  const tier: DestructionTier = opts.tier ?? 1;
  const H = opts.height ?? 5.6;
  const t = makeTransform(origin, opts.yaw ?? 0);
  const W = 1.8;

  const nodes: StructuralNodeSpec[] = [
    { id: 'legs_w', pos: t.pt(-W, H / 2, 0), half: [0.24, H / 2, W], mat: 'rust', hp: 130, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'legs_e', pos: t.pt(W, H / 2, 0), half: [0.24, H / 2, W], mat: 'rust', hp: 130, tier, anchored: true, kind: 'column', yaw: t.yaw },
    { id: 'deck', pos: t.pt(0, H + 0.16, 0), half: [W + 0.45, 0.16, W + 0.45], mat: 'plywood', color: 0x94704a, hp: 130, tier, anchored: false, kind: 'slab', yaw: t.yaw, impactRadius: 7 },
    { id: 'parapet_s', pos: t.pt(0, H + 0.85, W + 0.25), half: [W + 0.3, 0.55, 0.2], mat: 'dirt', color: 0x8e8268, hp: 90, tier: 0, anchored: false, kind: 'wall', yaw: t.yaw },
    { id: 'canopy', pos: t.pt(0, H + 2.55, 0), half: [W + 0.55, 0.12, W + 0.55], mat: 'rust', color: 0x7c4a32, hp: 80, tier: 0, anchored: false, kind: 'roof', yaw: t.yaw, impactRadius: 7 },
    { id: 'ammo_box', pos: t.pt(0, H + 0.72, -0.7), half: [0.45, 0.4, 0.45], mat: 'paintRed', hp: 45, tier: 0, anchored: false, kind: 'hazard', yaw: t.yaw, hazardRadius: 9, hazardDamage: 220 },
  ];

  const links: [string, string][] = [
    ['legs_w', 'deck'],
    ['legs_e', 'deck'],
    ['deck', 'parapet_s'],
    ['deck', 'canopy'],
    ['deck', 'ammo_box'],
  ];

  return {
    id: opts.id,
    tag: opts.tag,
    kind: 'watchtower',
    label: opts.label ?? 'MILITIA WATCHTOWER',
    value: opts.value ?? 95_000,
    nodes,
    links,
    collapseThreshold: 0.5,
    onCollapse: opts.onCollapse,
  };
}

/**
 * Tier 1 Munitions / Fuel Pump Shed: corrugated walls, tin roof, and a central high-explosive munitions/fuel core
 * (`kind: 'hazard'`) that chain-detonates dramatically under AC-130 or ground fire.
 */
export function buildMunitionsShedCluster(
  origin: Vec3Like,
  opts: ClusterBuilderOptions & { color?: number | readonly [number, number, number] } = {},
): StructuralClusterSpec {
  const tier: DestructionTier = opts.tier ?? 1;
  const t = makeTransform(origin, opts.yaw ?? 0);
  const W = 2.8;
  const D = 2.2;
  const H = 2.9;

  const nodes: StructuralNodeSpec[] = [
    { id: 'wall_w', pos: t.pt(-W, H / 2, 0), half: [0.22, H / 2, D], mat: 'panel', color: opts.color ?? 0x7a6a58, hp: 130, tier, anchored: true, kind: 'wall', yaw: t.yaw },
    { id: 'wall_e', pos: t.pt(W, H / 2, 0), half: [0.22, H / 2, D], mat: 'panel', color: opts.color ?? 0x7a6a58, hp: 130, tier, anchored: true, kind: 'wall', yaw: t.yaw },
    { id: 'wall_b', pos: t.pt(0, H / 2, -D), half: [W - 0.25, H / 2, 0.22], mat: 'rust', hp: 130, tier, anchored: true, kind: 'wall', yaw: t.yaw },
    { id: 'roof', pos: t.pt(0, H + 0.14, 0), half: [W + 0.35, 0.14, D + 0.35], mat: 'rust', hp: 100, tier: 0, anchored: false, kind: 'roof', yaw: t.yaw, impactRadius: 7 },
    { id: 'munitions_core', pos: t.pt(0, 0.85, -0.3), half: [0.95, 0.85, 0.8], mat: 'paintRed', hp: 50, tier: 0, anchored: true, kind: 'hazard', yaw: t.yaw, hazardRadius: 12, hazardDamage: 280 },
  ];

  const links: [string, string][] = [
    ['wall_w', 'roof'],
    ['wall_e', 'roof'],
    ['wall_b', 'roof'],
  ];

  return {
    id: opts.id,
    tag: opts.tag,
    kind: 'munitionsShed',
    label: opts.label ?? 'MUNITIONS SHED',
    value: opts.value ?? 105_000,
    nodes,
    links,
    collapseThreshold: 0.5,
    onCollapse: opts.onCollapse,
  };
}

/**
 * Tier 1 Sandbag & Timber Guard Pillbox: low fortified firing bunker with removable sandbag walls and timber/earth roof.
 */
export function buildPillboxCluster(
  origin: Vec3Like,
  opts: ClusterBuilderOptions = {},
): StructuralClusterSpec {
  const tier: DestructionTier = opts.tier ?? 1;
  const t = makeTransform(origin, opts.yaw ?? 0);
  const W = 2.4;
  const D = 2.0;
  const H = 2.2;

  const nodes: StructuralNodeSpec[] = [
    { id: 'wall_l', pos: t.pt(-W, H / 2, 0), half: [0.35, H / 2, D], mat: 'dirt', color: 0x8b7e62, hp: 140, tier, anchored: true, kind: 'wall', yaw: t.yaw },
    { id: 'wall_r', pos: t.pt(W, H / 2, 0), half: [0.35, H / 2, D], mat: 'dirt', color: 0x8b7e62, hp: 140, tier, anchored: true, kind: 'wall', yaw: t.yaw },
    { id: 'wall_f', pos: t.pt(0, 0.65, D), half: [W - 0.35, 0.65, 0.35], mat: 'concrete', color: 0x868178, hp: 160, tier, anchored: true, kind: 'wall', yaw: t.yaw },
    { id: 'roof', pos: t.pt(0, H + 0.18, 0), half: [W + 0.4, 0.18, D + 0.35], mat: 'plywood', color: 0x7c6244, hp: 120, tier, anchored: false, kind: 'roof', yaw: t.yaw, impactRadius: 6 },
    { id: 'ammo', pos: t.pt(0.8, 0.5, -0.5), half: [0.45, 0.45, 0.45], mat: 'paintRed', hp: 45, tier: 0, anchored: true, kind: 'hazard', yaw: t.yaw, hazardRadius: 8.5, hazardDamage: 200 },
  ];

  const links: [string, string][] = [
    ['wall_l', 'roof'],
    ['wall_r', 'roof'],
  ];

  return {
    id: opts.id,
    tag: opts.tag,
    kind: 'pillbox',
    label: opts.label ?? 'GUARD PILLBOX',
    value: opts.value ?? 80_000,
    nodes,
    links,
    collapseThreshold: 0.5,
    onCollapse: opts.onCollapse,
  };
}

/**
 * Tier 1 destructible Square Dry Fountain & Anchor Monument.
 */
export function buildFountainCluster(
  origin: Vec3Like,
  opts: ClusterBuilderOptions = {},
): StructuralClusterSpec {
  const tier: DestructionTier = opts.tier ?? 1;
  const t = makeTransform(origin, opts.yaw ?? 0);

  const nodes: StructuralNodeSpec[] = [
    { id: 'rim_n', pos: t.pt(0, 0.4, -1.7), half: [1.85, 0.4, 0.28], mat: 'concrete', color: 0xc2b8a4, hp: 140, tier, anchored: true, kind: 'wall' },
    { id: 'rim_s', pos: t.pt(0, 0.4, 1.7), half: [1.85, 0.4, 0.28], mat: 'concrete', color: 0xc2b8a4, hp: 140, tier, anchored: true, kind: 'wall' },
    { id: 'rim_w', pos: t.pt(-1.7, 0.4, 0), half: [0.28, 0.4, 1.45], mat: 'concrete', color: 0xc2b8a4, hp: 140, tier, anchored: true, kind: 'wall' },
    { id: 'rim_e', pos: t.pt(1.7, 0.4, 0), half: [0.28, 0.4, 1.45], mat: 'concrete', color: 0xc2b8a4, hp: 140, tier, anchored: true, kind: 'wall' },
    { id: 'anchor_shaft', pos: t.pt(0, 2.2, 0), half: [0.24, 2.2, 0.24], mat: 'rust', color: 0x7a4b34, hp: 180, tier, anchored: true, kind: 'column' },
    { id: 'anchor_cross', pos: t.pt(0, 1.0, 0), half: [1.35, 0.18, 0.22], mat: 'rust', color: 0x7a4b34, hp: 120, tier, anchored: false, kind: 'wall' },
  ];

  const links: [string, string][] = [['anchor_shaft', 'anchor_cross']];

  return {
    id: opts.id,
    tag: opts.tag,
    kind: 'fountain',
    label: opts.label ?? 'SQUARE FOUNTAIN',
    value: opts.value ?? 65_000,
    nodes,
    links,
    collapseThreshold: 0.5,
    onCollapse: opts.onCollapse,
  };
}

/**
 * Tier 2 destructible North Yard Boat Shed steel frame & corrugated roof bays:
 * knocking out the 6 anchored steel columns sends the massive 13m-high steel roof trusses crashing onto the slipway hull!
 */
export function buildBoatShedCluster(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  h: number,
  opts: ClusterBuilderOptions = {},
): StructuralClusterSpec {
  const tier: DestructionTier = opts.tier ?? 2;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const hx = (x1 - x0) / 2;
  const hz = (z1 - z0) / 2;

  const nodes: StructuralNodeSpec[] = [
    // 6 anchored steel frame columns (3 west, 3 east)
    { id: 'col_wn', pos: [x0, h / 2, z0 + 1], half: [0.38, h / 2, 0.38], mat: 'steelDark', hp: 360, tier, anchored: true, kind: 'column' },
    { id: 'col_wm', pos: [x0, h / 2, cz], half: [0.38, h / 2, 0.38], mat: 'steelDark', hp: 360, tier, anchored: true, kind: 'column' },
    { id: 'col_ws', pos: [x0, h / 2, z1 - 1], half: [0.38, h / 2, 0.38], mat: 'steelDark', hp: 360, tier, anchored: true, kind: 'column' },
    { id: 'col_en', pos: [x1, h / 2, z0 + 1], half: [0.38, h / 2, 0.38], mat: 'steelDark', hp: 360, tier, anchored: true, kind: 'column' },
    { id: 'col_em', pos: [x1, h / 2, cz], half: [0.38, h / 2, 0.38], mat: 'steelDark', hp: 360, tier, anchored: true, kind: 'column' },
    { id: 'col_es', pos: [x1, h / 2, z1 - 1], half: [0.38, h / 2, 0.38], mat: 'steelDark', hp: 360, tier, anchored: true, kind: 'column' },
    // 3 heavy steel truss & corrugated roof bays spanning the shed
    { id: 'roof_n', pos: [cx, h + 0.45, z0 + (z1 - z0) / 6], half: [hx + 0.4, 0.45, (z1 - z0) / 6 - 0.2], mat: 'rust', color: 0x764c38, hp: 320, tier, anchored: false, kind: 'roof', impactRadius: 12, impactDamage: 320 },
    { id: 'roof_m', pos: [cx, h + 0.45, cz], half: [hx + 0.4, 0.45, (z1 - z0) / 6 - 0.2], mat: 'steelDark', hp: 320, tier, anchored: false, kind: 'roof', impactRadius: 12, impactDamage: 320 },
    { id: 'roof_s', pos: [cx, h + 0.45, z1 - (z1 - z0) / 6], half: [hx + 0.4, 0.45, (z1 - z0) / 6 - 0.2], mat: 'rust', color: 0x82543d, hp: 320, tier, anchored: false, kind: 'roof', impactRadius: 12, impactDamage: 320 },
  ];

  const links: [string, string][] = [
    ['col_wn', 'roof_n'],
    ['col_en', 'roof_n'],
    ['col_wm', 'roof_m'],
    ['col_em', 'roof_m'],
    ['col_ws', 'roof_s'],
    ['col_es', 'roof_s'],
    ['roof_n', 'roof_m'],
    ['roof_m', 'roof_s'],
  ];

  return {
    id: opts.id,
    tag: opts.tag,
    kind: 'boatShed',
    label: opts.label ?? 'NORTH YARD BOAT SHED',
    value: opts.value ?? 280_000,
    nodes,
    links,
    collapseThreshold: 0.5,
    onCollapse: opts.onCollapse,
  };
}

/**
 * Tier 1 destructible standalone Staircase (for East Stack E1 access and Harbour Wall access) with optional top landing.
 */
export function buildStaircaseCluster(
  span: StairSpan,
  opts: ClusterBuilderOptions & {
    mat?: Mat;
    landing?: { pos: Vec3Like; half: Vec3Like; mat?: Mat };
    navPhysics?: NavProxyPhysics;
  } = {},
): StructuralClusterSpec {
  const tier: DestructionTier = opts.tier ?? 1;
  const mat = opts.mat ?? 'steel';
  const stairNode = makeStairNode('ramp', span, {
    mat,
    hp: 150,
    tier,
    anchored: true,
    thickness: 0.2,
  });

  const nodes: StructuralNodeSpec[] = [stairNode];
  const links: [string, string][] = [];
  const walkable: StructuralNodeSpec[] = [stairNode];

  // Mid support strut beneath the stairs
  const mx = (span.ax + span.bx) * 0.5;
  const mz = (span.az + span.bz) * 0.5;
  const midH = Math.max(0.5, (span.y0 + span.y1) * 0.5 - 0.2);
  nodes.push({
    id: 'support',
    pos: [mx, span.y0 + midH * 0.5, mz],
    half: [0.22, midH * 0.5, Math.min(0.8, span.width * 0.4)],
    mat: 'steelDark',
    hp: 140,
    tier,
    anchored: true,
    kind: 'column',
  });

  if (opts.landing) {
    const landingNode: StructuralNodeSpec = {
      id: 'landing',
      pos: opts.landing.pos,
      half: opts.landing.half,
      mat: opts.landing.mat ?? 'grate',
      hp: 150,
      tier,
      anchored: false,
      kind: 'catwalk',
    };
    nodes.push(landingNode);
    walkable.push(landingNode);
    links.push(['ramp', 'landing']);
  }

  return {
    id: opts.id,
    tag: opts.tag,
    kind: 'staircase',
    label: opts.label ?? 'ACCESS STAIRWAY',
    value: opts.value ?? 55_000,
    nodes,
    links,
    collapseThreshold: 0.5,
    navProxies: collectNavProxies(opts.navPhysics, walkable),
    onCollapse: opts.onCollapse,
  };
}

/**
 * Tier 1 destructible standalone shipping container (for loose aisle/dockside cover containers).
 */
export function buildContainerCluster(
  origin: Vec3Like,
  opts: ClusterBuilderOptions & { color?: number | readonly [number, number, number] } = {},
): StructuralClusterSpec {
  const tier: DestructionTier = opts.tier ?? 1;
  const t = makeTransform(origin, opts.yaw ?? 0);
  const col = opts.color ?? 0x2c6694;
  const nodes: StructuralNodeSpec[] = [
    { id: 'half_a', pos: t.pt(-3.05, 1.3, 0), half: [3.02, 1.3, 1.25], mat: 'panel', color: col, hp: 180, tier, anchored: true, kind: 'wall', yaw: t.yaw },
    { id: 'half_b', pos: t.pt(3.05, 1.3, 0), half: [3.02, 1.3, 1.25], mat: 'panel', color: col, hp: 180, tier, anchored: true, kind: 'wall', yaw: t.yaw },
  ];
  return {
    id: opts.id,
    tag: opts.tag,
    kind: 'container',
    label: opts.label ?? 'SHIPPING CONTAINER',
    value: opts.value ?? 50_000,
    nodes,
    collapseThreshold: 0.5,
    onCollapse: opts.onCollapse,
  };
}

