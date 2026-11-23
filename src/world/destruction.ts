/**
 * THE FINALS-inspired physics-enabled structural destruction engine for OVERPOWERED 2.
 *
 * Structures are composed of load-bearing graphs (`StructuralCluster`) whose intact nodes carry Three.js meshes
 * and static Rapier box colliders. When blasts or ordnance break a node, its static collider is removed and
 * replaced by a live dynamic Rapier rigid body launched outward from the blast. A BFS from all surviving
 * ground-anchored nodes immediately identifies any newly unsupported upper sections (roofs, slabs, catwalks,
 * crane booms), putting them through a dramatic hinge/groan warning phase before releasing them as falling
 * dynamic bodies capable of crushing enemies and triggering domino collapses on neighboring structures.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import {
  CG,
  type Ctx,
  type DestructionManagerLike,
  type DestructionTier,
  type StructuralClusterLike,
  type SurfaceKind,
} from '../core/contracts';
import type { EnemyInstance } from '../core/gameplay';
import { clamp } from '../core/math';
import { groups } from '../physics/Physics';
import { Geo, type Mat } from './kit/geo';

export type { DestructionTier };

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

// ---------------------------------------------------------------------------------------------
// Armor Tier Gating & Source Multipliers
// ---------------------------------------------------------------------------------------------

/** Sources capable of penetrating Tier 3 (Reinforced Concrete / Heavy Steel). */
const TIER3_SOURCES = new Set<string>([
  'howitzer',
  'frame_howitzer',
  'ac130_105mm',
  'ac130_bomb',
  'nuke',
  'hazard_chain',
  'breach_charge',
  'hydraulic_overload',
]);

/** Sources capable of penetrating Tier 2 (Heavy Industrial: Cannery, Market Hall, Concrete Terraces, Heavy Pillars). */
const TIER2_SOURCES = new Set<string>([
  'howitzer',
  'frame_40mm',
  'frame_40mm_ap',
  'frame_howitzer',
  'frame_stomp',
  'frame_charge',
  'frame_crush',
  'frame_backhand',
  'frame_pod',
  'ac130_105mm',
  'ac130_bomb',
  'ac130_40mm',
  'ac130_40mm_ap',
  'tank_cannon',
  'hazard_chain',
  'nuke',
  'breach_charge',
  'hydraulic_overload',
]);

/** Sources capable of penetrating Tier 1 (Masonry, Barracks, Emplacement Platforms, Walls). */
const TIER1_SOURCES = new Set<string>([
  'howitzer',
  'satchel',
  'rocket',
  'mgl',
  'grenade',
  'c4',
  'tank_cannon',
  'nuke',
  'hazard_chain',
  'breach_charge',
  'hydraulic_overload',
  // Frame ordnance & melee
  'frame_40mm',
  'frame_40mm_ap',
  'frame_howitzer',
  'frame_stomp',
  'frame_charge',
  'frame_crush',
  'frame_backhand',
  'frame_pod',
  // Other heavy explosive/call-in/map sources
  'barrel',
  'tank',
  'airstrike',
  'orbital',
  'ac130',
  'ac130_105mm',
  'ac130_bomb',
  'ac130_40mm',
  'ac130_40mm_ap',
  'ac130_25mm',
  'ac130_wp',
  'black_sun',
  'warthog',
  'drop_pod',
  'chopper_rocket',
  'chopper_cannon',
  'sapper',
  'sapper_charge',
  'enemy_rocket',
  'mortar',
  'shell',
  'explosive',
  'test',
]);

/** Hand-held explosive sources that trigger a helpful bounce hint when hitting Tier 2+ armor. */
const HANDHELD_EXPLOSIVES = new Set<string>(['rocket', 'satchel', 'mgl', 'grenade', 'c4']);

/** Frame/heavy sources that trigger a Tier 3 bounce hint when hitting Reinforced Concrete. */
const TIER2_NON_HOWITZER = new Set<string>([
  'frame_40mm',
  'frame_40mm_ap',
  'frame_stomp',
  'frame_charge',
  'frame_crush',
  'frame_backhand',
  'frame_pod',
  'ac130_40mm',
  'ac130_40mm_ap',
  'tank_cannon',
]);

export const DESTRUCTION_SOURCE_MULT: Readonly<Record<string, number>> = {
  howitzer: 8.0,
  satchel: 3.2,
  frame_howitzer: 8.0,
  ac130_105mm: 8.0,
  ac130_bomb: 12.0,
  ac130_40mm_ap: 2.5,
  ac130_40mm: 2.2,
  ac130_wp: 1.8,
  ac130_25mm: 0.9,
  frame_40mm_ap: 2.5,
  frame_40mm: 2.2,
  frame_stomp: 4.5,
  frame_charge: 4.5,
  frame_crush: 4.5,
  frame_backhand: 3.0,
  frame_pod: 2.5,
  tank_cannon: 4.0,
  hazard_chain: 2.5,
  breach_charge: 2.5,
  hydraulic_overload: 3.0,
  nuke: 100,
};

/** Returns true if `source` can damage a structural element of the given `tier`. */
export function canDamageTier(tier: DestructionTier, source: string): boolean {
  if (tier === 0) return true;
  // Rotary airburst / rotary bullets never damage masonry or heavier tiers.
  if (source === 'frame_rotary_airburst' || source === 'frame_rotary' || source === 'frame_flak') return false;
  if (tier === 3) return TIER3_SOURCES.has(source);
  if (tier === 2) return TIER2_SOURCES.has(source);
  // Tier 1: masonry
  if (TIER1_SOURCES.has(source)) return true;
  if (source.startsWith('frame_')) return true;
  return false;
}

/** Returns the effective damage multiplier for `source` against `tier` (0 when blocked by armor tier). */
export function damageMultiplierFor(tier: DestructionTier, source: string): number {
  if (!canDamageTier(tier, source)) return 0;
  return DESTRUCTION_SOURCE_MULT[source] ?? 1;
}

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
  /** Optional `[cols, rows]` subdivision grid hint for localized irregular panel fracturing. */
  fractureGrid?: readonly [number, number];
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
  onCollapse?: (cluster: StructuralCluster) => void;
}

export interface StructuralNode {
  readonly id: string;
  readonly clusterId: string;
  readonly spec: StructuralNodeSpec;
  readonly basePos: THREE.Vector3;
  readonly half: THREE.Vector3;
  readonly baseQuat: THREE.Quaternion;
  readonly mat: Mat;
  readonly tier: DestructionTier;
  readonly anchored: boolean;
  readonly kind: StructuralNodeKind;
  readonly maxHp: number;
  readonly keyNode: boolean;
  hp: number;
  state: StructuralNodeState;
  mesh: THREE.Mesh | null;
  staticCollider: RAPIER.Collider | null;
  dynamicBody: RAPIER.RigidBody | null;
  // Tilt warning state
  tiltElapsed: number;
  tiltDuration: number;
  readonly tiltAxis: THREE.Vector3;
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
  readonly adjacency = new Map<string, Set<string>>();
  readonly center = new THREE.Vector3();
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

  getNode(id: string): StructuralNode | undefined {
    return this.byId.get(id);
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

function densityFor(tier: DestructionTier, mat: Mat): number {
  if (mat === 'plywood') return 550;
  if (tier === 0) return 650;
  if (tier === 1) return 1800;
  if (tier === 2) return 2350;
  return 2650;
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

function buildNodeGeometry(half: THREE.Vector3, mat: Mat, color?: number | readonly [number, number, number]): THREE.BufferGeometry {
  const geo = new Geo();
  geo.use(mat);
  if (typeof color === 'number') {
    _c.setHex(color);
    geo.tint(_c.r, _c.g, _c.b);
  } else if (Array.isArray(color)) {
    geo.tint(color[0], color[1], color[2]);
  }
  const minH = Math.min(half.x, half.y, half.z);
  const bevel = Math.min(0.06, minH * 0.22);
  if (bevel >= 0.015) geo.bevel(0, 0, 0, half.x, half.y, half.z, bevel);
  else geo.box(0, 0, 0, half.x, half.y, half.z);
  const b = [...geo.buckets.values()][0]!;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(b.p.slice(0, b.nv * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(b.n.slice(0, b.nv * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(b.uv.slice(0, b.nv * 2), 2));
  g.setAttribute('color', new THREE.BufferAttribute(b.c.slice(0, b.nv * 4), 4, true));
  g.setIndex(new THREE.BufferAttribute(b.idx.slice(0, b.ni), 1));
  g.computeBoundingSphere();
  return g;
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

// ---------------------------------------------------------------------------------------------
// DestructionManager
// ---------------------------------------------------------------------------------------------

export type SecondaryBlastHook = (center: THREE.Vector3, radius: number, amount: number, source: string) => void;

export class DestructionManager implements DestructionManagerLike {
  readonly root = new THREE.Group();
  private readonly clusters: StructuralCluster[] = [];
  private readonly byTag = new Map<string, StructuralCluster>();
  private readonly byCollider = new Map<number, { cluster: StructuralCluster; node: StructuralNode }>();
  private readonly tilting: { cluster: StructuralCluster; node: StructuralNode }[] = [];
  private readonly dynamicPool: DynamicEntry[] = [];
  private readonly pendingHazards: PendingHazard[] = [];
  private readonly sweeps: NukeSweepState[] = [];
  private readonly nearEnemies: EnemyInstance[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
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
  }

  /** Number of currently active falling dynamic rigid bodies (always <= MAX_DYNAMIC_BODIES). */
  get activeDynamicBodies(): number {
    return this.dynamicPool.length;
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

  private buildClusterRuntime(cluster: StructuralCluster): void {
    const { spec } = cluster;
    cluster.nodes.length = 0;
    cluster.byId.clear();
    cluster.adjacency.clear();
    cluster.collapsed = false;
    cluster.lastGroanAt = -10;
    cluster.center.set(0, 0, 0);

    for (const ns of spec.nodes) {
      const basePos = toVec3(ns.pos);
      const half = toVec3(ns.half);
      const baseQuat = new THREE.Quaternion().setFromEuler(
        _e.set(ns.pitch ?? 0, ns.yaw ?? 0, ns.roll ?? 0, 'YXZ'),
      );

      const geom = buildNodeGeometry(half, ns.mat, ns.color);
      this.geometries.push(geom);
      const mesh = new THREE.Mesh(geom, this.material(ns.mat));
      mesh.position.copy(basePos);
      mesh.quaternion.copy(baseQuat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);

      const staticCollider = this.ctx.physics.addStaticBox(
        basePos,
        half,
        baseQuat,
        surfaceForMat(ns.mat),
      );

      const node: StructuralNode = {
        id: ns.id,
        clusterId: cluster.id,
        spec: ns,
        basePos,
        half,
        baseQuat,
        mat: ns.mat,
        tier: ns.tier,
        anchored: ns.anchored,
        kind: ns.kind,
        maxHp: ns.hp,
        keyNode: ns.keyNode === true,
        hp: ns.hp,
        state: 'intact',
        mesh,
        staticCollider,
        dynamicBody: null,
        tiltElapsed: 0,
        tiltDuration: 0,
        tiltAxis: new THREE.Vector3(1, 0, 0),
        tiltBlastOrigin: null,
        tiltIsNuke: false,
      };

      cluster.nodes.push(node);
      cluster.byId.set(node.id, node);
      cluster.adjacency.set(node.id, new Set());
      cluster.center.add(basePos);

      if (staticCollider) {
        this.byCollider.set(staticCollider.handle, { cluster, node });
      }
    }

    if (cluster.nodes.length > 0) {
      cluster.center.multiplyScalar(1 / cluster.nodes.length);
    }

    const link = (a: string, b: string) => {
      if (a === b) return;
      const sa = cluster.adjacency.get(a);
      const sb = cluster.adjacency.get(b);
      if (sa && sb) {
        sa.add(b);
        sb.add(a);
      }
    };

    if (spec.links) {
      for (const [a, b] of spec.links) link(a, b);
    }
    for (const ns of spec.nodes) {
      if (ns.supports) {
        for (const other of ns.supports) link(ns.id, other);
      }
    }
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
    const { cluster, node } = entry;
    if (node.state !== 'intact' || amount <= 0) return true;

    const pt = hitPoint ?? node.basePos;
    const mult = damageMultiplierFor(node.tier, source);
    if (mult <= 0) {
      this.emitBlockedHit(node.tier, source, pt, true);
      return true;
    }

    const dealt = source === 'nuke' ? node.hp + 1 : amount * mult;
    this.applyNodeDamage(cluster, node, dealt, pt, source);
    return true;
  }

  /** Radial blast against all intact structural nodes in range, enforcing armor tiers and source multipliers. */
  blast(
    center: THREE.Vector3,
    radius: number,
    amount: number,
    source: string,
    excludeClusterId?: string,
  ): void {
    if (radius <= 0 || amount <= 0) return;

    let highestBlockedTier: DestructionTier | -1 = -1;
    let blockedPos: THREE.Vector3 | null = null;
    const hits: { cluster: StructuralCluster; node: StructuralNode; damage: number }[] = [];

    for (let ci = 0; ci < this.clusters.length; ci++) {
      const cluster = this.clusters[ci]!;
      if (excludeClusterId && cluster.id === excludeClusterId) continue;
      for (let ni = 0; ni < cluster.nodes.length; ni++) {
        const node = cluster.nodes[ni]!;
        if (node.state === 'tilting') {
          const d = distanceToOrientedBox(center, node.basePos, node.half, node.baseQuat);
          if (d <= radius && canDamageTier(node.tier, source)) {
            this.releaseTiltingNodeNow(cluster, node, center, source === 'nuke');
          }
          continue;
        }
        if (node.state !== 'intact') continue;

        const d = distanceToOrientedBox(center, node.basePos, node.half, node.baseQuat);
        if (d > radius) continue;

        const mult = damageMultiplierFor(node.tier, source);
        if (mult <= 0) {
          if (node.tier > highestBlockedTier) {
            highestBlockedTier = node.tier;
            blockedPos = node.basePos;
          }
          continue;
        }

        const falloff = 1 - (d / radius) * (1 - BLAST_EDGE);
        const dealt = source === 'nuke' ? node.hp + 1 : amount * falloff * mult;
        hits.push({ cluster, node, damage: dealt });
      }
    }

    if (highestBlockedTier >= 1 && blockedPos) {
      this.emitBlockedHit(highestBlockedTier as DestructionTier, source, blockedPos, false);
    }

    for (let i = 0; i < hits.length; i++) {
      const h = hits[i]!;
      if (h.node.state !== 'intact') continue;
      this.applyNodeDamage(h.cluster, h.node, h.damage, center, source);
    }
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

  private emitBlockedHit(tier: DestructionTier, source: string, pos: THREE.Vector3, direct: boolean): void {
    const { fx, audio, hud } = this.ctx;
    if (tier === 1) {
      if (this.time - this.lastBounceFxAt >= 0.06 || direct) {
        this.lastBounceFxAt = this.time;
        fx?.chips?.(pos, 0x999287, 5);
        fx?.sparks?.(pos, UP, 4, 0xffd699);
      }
    } else if (this.time - this.lastClangAt >= 0.06 || direct) {
      this.lastClangAt = this.time;
      if (tier === 2) {
        fx?.sparks?.(pos, UP, 14, 0xffc864);
        audio?.play?.('metal_clang', { position: pos, volume: 0.65, pitch: 1.32, pitchJitter: 0.08 });
      } else if (tier === 3) {
        fx?.sparks?.(pos, UP, 12, 0xdce4ee);
        fx?.chips?.(pos, 0x9aa0a8, 8);
        audio?.play?.('metal_clang', { position: pos, volume: 0.7, pitch: 0.85, pitchJitter: 0.06 });
        audio?.play?.('impact_concrete', { position: pos, volume: 0.6, pitch: 1.1 });
      }
    }

    const showTier2Hint = tier === 2 && HANDHELD_EXPLOSIVES.has(source);
    const showTier3Hint = tier === 3 && (HANDHELD_EXPLOSIVES.has(source) || TIER2_NON_HOWITZER.has(source));
    if ((showTier2Hint || showTier3Hint) && this.time - this.lastHintAt >= 3.5) {
      this.lastHintAt = this.time;
      hud?.hitMarker?.('armor');
      if (showTier2Hint) {
        hud?.feed?.('HEAVY ARMOR — FRAME ORDNANCE REQUIRED', '#f5a623');
      } else {
        hud?.feed?.('REINFORCED CONCRETE — 105MM HOWITZER OR NUKE REQUIRED', '#ff6b4a');
      }
    }
  }

  private applyNodeDamage(
    cluster: StructuralCluster,
    node: StructuralNode,
    damage: number,
    origin: THREE.Vector3,
    source: string,
  ): void {
    node.hp -= damage;
    if (node.hp > 0) {
      this.ctx.fx?.chips?.(node.basePos, chipColorFor(node.mat, node.spec.color), 6);
      return;
    }
    node.hp = 0;
    this.breakNode(cluster, node, origin, source === 'nuke');
  }

  private breakNode(
    cluster: StructuralCluster,
    node: StructuralNode,
    blastOrigin: THREE.Vector3 | null,
    isNuke = false,
  ): void {
    if (node.state !== 'intact') return;
    this.removeStaticCollider(node);

    // Emit immediate shatter FX & audio
    const { fx, audio } = this.ctx;
    const chipCol = chipColorFor(node.mat, node.spec.color);
    fx?.chips?.(node.basePos, chipCol, isNuke ? 22 : 16);
    fx?.dust?.(node.basePos, UP, isNuke ? 3.0 : 2.0);
    fx?.smoke?.(node.basePos, 0x8a8478, isNuke ? 4.2 : 2.8, isNuke ? 3.2 : 2.2);

    const isMetal = surfaceForMat(node.mat) === 'metal' || surfaceForMat(node.mat) === 'grate';
    audio?.play?.(isMetal ? 'metal_clang' : 'concrete_crumble', {
      position: node.basePos,
      volume: isNuke ? 0.9 : 0.72,
      pitchJitter: 0.14,
    });
    audio?.play?.('explosion_debris', { position: node.basePos, volume: 0.78, pitchJitter: 0.1 });

    // Chain-reaction hazard scheduling (brine boilers, fuel silos, ammo crates)
    if (node.kind === 'hazard') {
      this.pendingHazards.push({
        pos: node.basePos.clone(),
        radius: node.spec.hazardRadius ?? 11.5,
        damage: node.spec.hazardDamage ?? 260,
        delay: 0.14,
      });
    }

    // Spawn real dynamic Rapier rigid body launched away from the blast
    this.spawnDynamicBody(cluster, node, blastOrigin, isNuke, false);

    // Optional individual node liquidation event (when spec sets explicit per-node value)
    if (node.spec.value && node.spec.value > 0) {
      this.ctx.events?.emit?.('world:liquidated', {
        label: node.spec.label ?? node.kind.toUpperCase(),
        value: node.spec.value,
        position: node.basePos.clone(),
        kind: node.kind,
      });
    }

    // Load-bearing BFS: any intact node no longer connected to an intact ground anchor detaches!
    this.propagateSupportLoss(cluster, blastOrigin, isNuke);

    // Check cluster collapse threshold / key node collapse
    this.checkClusterCollapse(cluster);
  }

  private removeStaticCollider(node: StructuralNode): void {
    if (!node.staticCollider) return;
    this.byCollider.delete(node.staticCollider.handle);
    this.ctx.physics.world.removeCollider(node.staticCollider, false);
    node.staticCollider = null;
  }

  private propagateSupportLoss(
    cluster: StructuralCluster,
    blastOrigin: THREE.Vector3 | null,
    isNuke: boolean,
  ): void {
    const visited = new Set<string>();
    const queue: string[] = [];

    for (let i = 0; i < cluster.nodes.length; i++) {
      const n = cluster.nodes[i]!;
      if (n.state === 'intact' && n.anchored) {
        visited.add(n.id);
        queue.push(n.id);
      }
    }

    let head = 0;
    while (head < queue.length) {
      const currId = queue[head++]!;
      const neighbors = cluster.adjacency.get(currId);
      if (!neighbors) continue;
      for (const nextId of neighbors) {
        if (visited.has(nextId)) continue;
        const nextNode = cluster.byId.get(nextId);
        if (!nextNode || nextNode.state !== 'intact') continue;
        visited.add(nextId);
        queue.push(nextId);
      }
    }

    const detached: StructuralNode[] = [];
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < cluster.nodes.length; i++) {
      const n = cluster.nodes[i]!;
      if (n.state !== 'intact' || visited.has(n.id)) continue;
      detached.push(n);
      if (n.basePos.y < minY) minY = n.basePos.y;
      if (n.basePos.y > maxY) maxY = n.basePos.y;
    }

    const spanY = Math.max(0.01, maxY - minY);
    for (let i = 0; i < detached.length; i++) {
      const n = detached[i]!;
      const hFrac = detached.length > 1 ? (n.basePos.y - minY) / spanY : 0;
      n.state = 'tilting';
      n.tiltElapsed = 0;
      // Lower unsupported slabs release slightly before upper roofs so roofs never bounce off static floors below
      n.tiltDuration = isNuke ? 0.06 : 0.18 + hFrac * 0.10 + Math.random() * 0.04;
      n.tiltBlastOrigin = blastOrigin ? blastOrigin.clone() : null;
      n.tiltIsNuke = isNuke;

      // Pick a horizontal hinge axis perpendicular to the outward direction from blast / cluster center
      if (blastOrigin) {
        _v.subVectors(n.basePos, blastOrigin).setY(0);
      } else {
        _v.subVectors(n.basePos, cluster.center).setY(0);
      }
      if (_v.lengthSq() < 0.01) _v.set(1, 0, 0);
      else _v.normalize();
      n.tiltAxis.set(-_v.z, 0, _v.x).normalize();

      this.tilting.push({ cluster, node: n });
    }

    const anyDetached = detached.length > 0;

    if (anyDetached && this.time - cluster.lastGroanAt >= 0.4) {
      cluster.lastGroanAt = this.time;
      this.ctx.audio?.play?.('metal_groan', {
        position: cluster.center,
        volume: 0.85,
        pitchJitter: 0.12,
      });
    }
  }

  private releaseTiltingNodeNow(
    cluster: StructuralCluster,
    node: StructuralNode,
    blastOrigin: THREE.Vector3 | null,
    isNuke: boolean,
  ): void {
    const idx = this.tilting.findIndex(t => t.node === node);
    if (idx >= 0) this.tilting.splice(idx, 1);
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

    // Enforce active dynamic body cap smoothly
    while (this.dynamicPool.length >= MAX_DYNAMIC_BODIES) {
      this.recycleOldestDynamicBody();
    }

    const { R, world } = this.ctx.physics;
    const pos = node.mesh.position;
    const quat = node.mesh.quaternion;

    // Compute launch velocity outward from blast (or gentle tumble if detached by collapse)
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
        // Blast directly on the node (e.g. satchel planted on a column): kick outward from cluster center
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
    } else {
      // Gravity collapse from tilt: small outward kick + downward momentum
      _vel.subVectors(pos, blastOrigin ?? cluster.center).setY(0);
      if (_vel.lengthSq() > 0.01) _vel.normalize().multiplyScalar(1.8 + Math.random() * 2.2);
      else _vel.set((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2);
      _vel.y = -1.2;
    }

    const spin = isNuke ? 5.5 : fromTilt ? 2.4 : 3.8;
    const angX = (Math.random() - 0.5) * spin + (fromTilt ? node.tiltAxis.x * 1.4 : 0);
    const angY = (Math.random() - 0.5) * spin * 0.7;
    const angZ = (Math.random() - 0.5) * spin + (fromTilt ? node.tiltAxis.z * 1.4 : 0);

    // Directly blasted nodes fracture slightly smaller so columns/walls clear their mortar joints
    // instead of jamming floor-to-ceiling under still-tilting upper slabs.
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
    world.createCollider(
      R.ColliderDesc.cuboid(hx, hy, hz)
        .setDensity(densityFor(node.tier, node.mat))
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
    const oldest = this.dynamicPool.shift();
    if (!oldest) return;
    this.settleDynamicEntry(oldest, true);
  }

  private settleDynamicEntry(entry: DynamicEntry, recycledByCap: boolean): void {
    const { node, body } = entry;
    if (node.dynamicBody) {
      const t = body.translation();
      const r = body.rotation();
      if (node.mesh) {
        node.mesh.position.set(t.x, t.y, t.z);
        node.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        if (recycledByCap && t.y > 4) {
          // If recycled mid-air under extreme nuke load, hide cleanly instead of freezing floating blocks
          node.mesh.visible = false;
          node.state = 'gone';
        } else {
          node.state = 'settled';
        }
      } else {
        node.state = 'gone';
      }
      this.ctx.physics.world.removeRigidBody(body);
      node.dynamicBody = null;
    }
  }

  private checkClusterCollapse(cluster: StructuralCluster): void {
    if (cluster.collapsed) return;
    const keyBroken = cluster.nodes.some(n => n.keyNode && n.state !== 'intact');
    if (keyBroken || cluster.destroyedFraction >= cluster.collapseThreshold) {
      cluster.collapsed = true;
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

  /** Advance tilting nodes, dynamic falling physics, kinetic crush, hazard chains, and nuke sweeps. */
  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;

    // 1. Expanding Nuke shockwave sweeps
    for (let i = this.sweeps.length - 1; i >= 0; i--) {
      const sw = this.sweeps[i]!;
      sw.radius += sw.speed * dt;
      for (let ci = 0; ci < this.clusters.length; ci++) {
        const cluster = this.clusters[ci]!;
        for (let ni = 0; ni < cluster.nodes.length; ni++) {
          const node = cluster.nodes[ni]!;
          if (node.state !== 'intact' && node.state !== 'tilting') continue;
          const d = node.basePos.distanceTo(sw.epicenter);
          if (d > sw.radius) continue;
          if (node.state === 'tilting') {
            this.releaseTiltingNodeNow(cluster, node, sw.epicenter, true);
          } else {
            this.breakNode(cluster, node, sw.epicenter, true);
          }
        }
      }
      if (sw.radius >= sw.maxRadius) {
        this.sweeps.splice(i, 1);
      }
    }

    // 2. Staggered secondary hazard explosions (brine boilers, fuel silos, ammo crates)
    for (let i = this.pendingHazards.length - 1; i >= 0; i--) {
      const h = this.pendingHazards[i]!;
      h.delay -= dt;
      if (h.delay > 0) continue;
      this.pendingHazards.splice(i, 1);
      this.detonateHazard(h);
    }

    // 3. Dramatic hinge/tilt warning phase before releasing detached nodes
    for (let i = this.tilting.length - 1; i >= 0; i--) {
      const item = this.tilting[i]!;
      const { cluster, node } = item;
      node.tiltElapsed += dt;
      const t = clamp(node.tiltElapsed / Math.max(0.01, node.tiltDuration), 0, 1);
      if (node.mesh) {
        const ease = t * t;
        const angle = ease * 0.3;
        _q2.setFromAxisAngle(node.tiltAxis, angle);
        node.mesh.quaternion.multiplyQuaternions(_q2, node.baseQuat);
        const jitter = (1 - t) * 0.04;
        node.mesh.position.set(
          node.basePos.x + (Math.random() - 0.5) * jitter,
          node.basePos.y - ease * 0.25,
          node.basePos.z + (Math.random() - 0.5) * jitter,
        );
      }
      if (node.tiltElapsed >= node.tiltDuration) {
        this.tilting.splice(i, 1);
        this.removeStaticCollider(node);
        this.spawnDynamicBody(cluster, node, node.tiltBlastOrigin, node.tiltIsNuke, true);
      }
    }

    // 4. Active dynamic falling rigid bodies: sync transforms, kinetic crush, domino impacts, settling
    for (let i = this.dynamicPool.length - 1; i >= 0; i--) {
      const entry = this.dynamicPool[i]!;
      const { node, body } = entry;
      entry.age += dt;

      const t = body.translation();
      const r = body.rotation();
      const lv = body.linvel();
      _v2.set(t.x, t.y, t.z);
      _vel.set(lv.x, lv.y, lv.z);
      const speed = _vel.length();

      if (node.mesh) {
        node.mesh.position.copy(_v2);
        node.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }

      // Kinetic crush check against living enemies
      if (speed > CRUSH_SPEED && this.ctx.enemies?.query) {
        const crushRadius = Math.max(node.half.x, node.half.y, node.half.z) + 1.0;
        const n = this.ctx.enemies.query(_v2, crushRadius, this.nearEnemies);
        for (let ei = 0; ei < n; ei++) {
          const e = this.nearEnemies[ei]!;
          if (!e.alive || entry.crushedUids.has(e.uid)) continue;
          entry.crushedUids.add(e.uid);
          this.ctx.enemies.applyDamage(e, {
            amount: CRUSH_DAMAGE,
            type: 'crush',
            point: e.center.clone(),
            dir: _vel.clone().normalize(),
            force: 220,
            source: 'structural_collapse',
            gib: true,
          });
        }
      }

      // Domino kinetic impact when heavy falling structural sections slam into the ground/structures
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
        if (node.mesh) node.mesh.visible = false;
        node.state = 'gone';
        this.ctx.physics.world.removeRigidBody(body);
        node.dynamicBody = null;
        this.dynamicPool.splice(i, 1);
      } else if (entry.age >= DYNAMIC_MAX_AGE || entry.stillTime >= DYNAMIC_STILL_TIME) {
        this.dynamicPool.splice(i, 1);
        this.settleDynamicEntry(entry, false);
      }
    }
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
    audio?.play?.('concrete_crumble', { position: pos, volume: 0.9, pitch: 0.72 });
    audio?.play?.('explosion_debris', { position: pos, volume: 0.85, pitch: 0.8 });
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
  }

  /** Removes all clusters, meshes, colliders, dynamic bodies, pending hazards, and active sweeps. */
  clear(): void {
    for (const entry of this.dynamicPool) {
      this.ctx.physics.world.removeRigidBody(entry.body);
      entry.node.dynamicBody = null;
    }
    this.dynamicPool.length = 0;
    this.tilting.length = 0;
    this.pendingHazards.length = 0;
    this.sweeps.length = 0;

    for (const cluster of this.clusters) {
      for (const node of cluster.nodes) {
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
  }

  dispose(): void {
    this.clear();
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

