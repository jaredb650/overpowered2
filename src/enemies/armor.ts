/**
 * Armour plates: separate pieces with their own pools that sit over regions and shoot off when spent.
 * A plate takes the hit in full and shows it. Pieces fly off on a cheap ballistic arc with no physics body:
 * they are gone in under two seconds and nothing needs to collide with them.
 *
 * They are bolted on over the baked armour, so they have to read as a heavier second layer of the same suit: curved
 * to the body, chamfered, ribbed and bolted, in the suit's own paint. The mesh is built once per spec and shared.
 */
import * as THREE from 'three';
import type { GoreRegion } from '../characters/rig';
import { rand, TAU } from '../core/math';
import type { Ctx } from '../core/contracts';

export interface PlatePaint {
  body: number;
  /** The central rib, a shade off the body. */
  rib: number;
  /** Worn paint along the chamfer. */
  edge: number;
  /** Bare metal studs. */
  bolt: number;
  /** A short warning mark low on the plate, so it reads as a separate piece of kit. */
  stripe: number;
}

export interface PlateSpec {
  /** Regions this plate covers. A hit on any of them spends it. */
  regions: readonly GoreRegion[];
  bone: number;
  /** Fraction of the enemy's max health. */
  hp: number;
  /** Width, height, and how far the plate stands off the body at its crown. */
  size: readonly [number, number, number];
  offset: readonly [number, number, number];
  /** Euler rotation in bone space. A plate is built facing +Z. */
  tilt?: readonly [number, number, number];
  /** Only stops hits arriving from this side of the bone, in character space. */
  facing?: 'front' | 'back';
  /** 'slab' is a shallow curved plate. 'sleeve' wraps most of the way round a limb. */
  shape: 'slab' | 'sleeve';
  paint: PlatePaint;
  /**
   * The socket of a baked prop he already wears there (a helmet on 'head'). When his archetype mounts one, that prop is the
   * plate's mesh, seated where it was mounted, and the slab above is only the fallback.
   */
  worn?: string;
}

export interface Plate {
  spec: PlateSpec;
  hp: number;
  mesh: THREE.Mesh;
  /** The mesh is his own worn prop at the bone's origin, not a slab at `spec.offset`. */
  worn?: boolean;
}

/** Facets across and down a plate. Coarse on purpose: flat shading is what makes it read as forged. */
const GRID_U = 8;
const GRID_V = 5;
/** Outer ring of facets that falls away to the rim. */
const CHAMFER = 0.16;
const BOLT = 0.018;

const _c = new THREE.Color();

class PlateBuilder {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];

  /** One flat triangle. */
  tri(a: readonly number[], b: readonly number[], c: readonly number[], color: number): void {
    this.pos.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!);
    _c.setHex(color);
    for (let i = 0; i < 3; i++) this.col.push(_c.r, _c.g, _c.b);
  }

  quad(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[], color: number): void {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  /** A four-sided stud standing off the surface along its normal. */
  bolt(p: readonly number[], n: readonly number[], color: number): void {
    const up = Math.abs(n[1]!) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const tx = new THREE.Vector3(up[0], up[1], up[2]).cross(new THREE.Vector3(n[0], n[1], n[2])).normalize();
    const ty = new THREE.Vector3(n[0], n[1], n[2]).cross(tx);
    const corner = (sx: number, sy: number): number[] => [
      p[0]! + (tx.x * sx + ty.x * sy) * BOLT, p[1]! + (tx.y * sx + ty.y * sy) * BOLT, p[2]! + (tx.z * sx + ty.z * sy) * BOLT,
    ];
    const tip = [p[0]! + n[0]! * BOLT, p[1]! + n[1]! * BOLT, p[2]! + n[2]! * BOLT];
    const c = [corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)];
    for (let i = 0; i < 4; i++) this.tri(c[i]!, c[(i + 1) % 4]!, tip, color);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }

  /** Builds the geometry centered around its own vertex centroid so shards tumble cleanly around their center of mass. */
  buildCentered(): { geometry: THREE.BufferGeometry; centroid: THREE.Vector3 } {
    const count = this.pos.length / 3;
    let cx = 0, cy = 0, cz = 0;
    if (count > 0) {
      for (let i = 0; i < this.pos.length; i += 3) {
        cx += this.pos[i]!;
        cy += this.pos[i + 1]!;
        cz += this.pos[i + 2]!;
      }
      cx /= count;
      cy /= count;
      cz /= count;
      for (let i = 0; i < this.pos.length; i += 3) {
        this.pos[i] = this.pos[i]! - cx;
        this.pos[i + 1] = this.pos[i + 1]! - cy;
        this.pos[i + 2] = this.pos[i + 2]! - cz;
      }
    }
    const geometry = this.build();
    geometry.computeBoundingBox();
    return { geometry, centroid: new THREE.Vector3(cx, cy, cz) };
  }
}

function darkenHex(hex: number, factor: number): number {
  const r = Math.round(((hex >> 16) & 0xff) * factor);
  const g = Math.round(((hex >> 8) & 0xff) * factor);
  const b = Math.round((hex & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

/** Point on a slab: u, v in -1..1. The rim sits at z = 0 and the crown at `depth`. */
function slabPoint(u: number, v: number, w: number, h: number, depth: number): number[] {
  const edge = Math.max(Math.abs(u), Math.abs(v));
  const fall = edge > 1 - CHAMFER ? (1 - edge) / CHAMFER : 1;
  const crown = 0.55 + 0.45 * (1 - u * u) * (1 - 0.4 * v * v);
  // Tapers in at the top so a breastplate sits under the collar rather than fighting it.
  const taper = 1 - 0.12 * (v * 0.5 + 0.5);
  return [u * (w / 2) * taper, v * (h / 2), depth * crown * fall];
}

/** Point on a sleeve: u sweeps round the limb, v runs along it. */
function sleevePoint(u: number, v: number, w: number, h: number, depth: number): number[] {
  const a = u * 1.95;
  const edge = Math.abs(v);
  const r = w / 2 + depth * (edge > 1 - CHAMFER * 1.4 ? (1 - edge) / (CHAMFER * 1.4) * 0.6 + 0.4 : 1);
  return [Math.sin(a) * r, v * (h / 2) * (1 - 0.05 * v), Math.cos(a) * r];
}

const geometries = new WeakMap<PlateSpec, THREE.BufferGeometry>();

export function plateGeometry(spec: PlateSpec): THREE.BufferGeometry {
  let g = geometries.get(spec);
  if (g) return g;
  const b = new PlateBuilder();
  const [w, h, depth] = spec.size;
  const point = spec.shape === 'sleeve' ? sleevePoint : slabPoint;
  const at = (i: number, j: number): number[] => point((i / GRID_U) * 2 - 1, (j / GRID_V) * 2 - 1, w, h, depth);
  const { body, rib, edge, bolt, stripe } = spec.paint;
  for (let j = 0; j < GRID_V; j++) {
    for (let i = 0; i < GRID_U; i++) {
      const rim = i === 0 || j === 0 || i === GRID_U - 1 || j === GRID_V - 1;
      // A rib down the middle and a mark across it: enough structure to stop it reading as a lump.
      const middle = i === GRID_U / 2 - 1 || i === GRID_U / 2;
      const color = rim ? edge : !middle ? body : j === 1 ? stripe : rib;
      b.quad(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1), color);
    }
  }
  // Studs in the four corners and along the shoulder of the rim.
  for (const [i, j] of [[1, 1], [GRID_U - 1, 1], [1, GRID_V - 1], [GRID_U - 1, GRID_V - 1]] as const) {
    const p = at(i, j);
    const q = at(i + 1 > GRID_U ? i - 1 : i + 1, j);
    const r = at(i, j + 1 > GRID_V ? j - 1 : j + 1);
    const n = new THREE.Vector3(q[0]! - p[0]!, q[1]! - p[1]!, q[2]! - p[2]!)
      .cross(new THREE.Vector3(r[0]! - p[0]!, r[1]! - p[1]!, r[2]! - p[2]!)).normalize();
    if (spec.shape === 'slab' && n.z < 0) n.negate();
    b.bolt(p, [n.x, n.y, n.z], bolt);
  }
  g = b.build();
  geometries.set(spec, g);
  return g;
}

export interface ShardVariant {
  readonly geometry: THREE.BufferGeometry;
  /** Local centroid offset on the unbroken plate/helmet. */
  readonly offset: THREE.Vector3;
  /** Outward unit direction for diverging shatter velocity. */
  readonly dir: THREE.Vector3;
}

export function isHelmetPlate(spec: PlateSpec): boolean {
  return spec.regions.includes('head');
}

const shardCache = new WeakMap<PlateSpec, Map<number, readonly ShardVariant[]>>();

/** Jagged azimuthal cut along a helmet dome, shared by adjacent shards so pieces mate cleanly. */
function helmetCutAngle(cutIdx: number, count: number, t: number): number {
  const base = (cutIdx / count) * TAU + 0.35;
  const jag = (Math.sin(t * 9.3 + cutIdx * 2.1) * 0.14 + Math.cos(t * 15.7 + cutIdx * 1.3) * 0.08) * (0.25 + 0.75 * t);
  return base + jag;
}

/** Builds 2–3 jagged curved dome shards with painted outer shell, darker matte liner underside, and fractured walls. */
function buildHelmetShards(spec: PlateSpec, count: number): ShardVariant[] {
  const [w, h, depth] = spec.size;
  const rx = Math.max(w * 0.52, 0.13);
  const ry = Math.max(h * 0.56, 0.14);
  const rz = Math.max(w * 0.55, 0.14);
  const thick = Math.max(0.016, Math.min(depth * 0.35, 0.03));
  const ix = Math.max(0.65, 1 - thick / rx);
  const iy = Math.max(0.65, 1 - thick / ry);
  const iz = Math.max(0.65, 1 - thick / rz);

  const { body, rib, edge, stripe } = spec.paint;
  const liner = darkenHex(body, 0.24);
  const fracture = darkenHex(edge, 0.45);

  const SEG_A = 4;
  const SEG_P = 4;
  const variants: ShardVariant[] = [];

  for (let k = 0; k < count; k++) {
    const b = new PlateBuilder();
    const outerGrid: number[][][] = [];
    const innerGrid: number[][][] = [];

    for (let j = 0; j <= SEG_P; j++) {
      const t = j / SEG_P;
      const a0 = helmetCutAngle(k, count, t);
      const a1 = helmetCutAngle(k + 1, count, t);
      const outerRow: number[][] = [];
      const innerRow: number[][] = [];
      for (let i = 0; i <= SEG_A; i++) {
        const s = i / SEG_A;
        const a = a0 + (a1 - a0) * s;
        const crownPhi = 0.12 + 0.04 * Math.sin(a * 3 + k);
        const brimPhi = Math.PI * 0.58 + 0.06 * Math.cos(a * 2 - 0.5) + (j === SEG_P ? 0.03 * Math.sin(s * 7.1 + k) : 0);
        const phi = crownPhi + (brimPhi - crownPhi) * t;
        const sp = Math.sin(phi);
        const cp = Math.cos(phi);
        const sa = Math.sin(a);
        const ca = Math.cos(a);
        const ox = rx * sp * sa;
        const oy = ry * cp;
        const oz = rz * sp * ca;
        outerRow.push([ox, oy, oz]);
        innerRow.push([ox * ix, oy * iy, oz * iz]);
      }
      outerGrid.push(outerRow);
      innerGrid.push(innerRow);
    }

    for (let j = 0; j < SEG_P; j++) {
      for (let i = 0; i < SEG_A; i++) {
        const o00 = outerGrid[j]![i]!;
        const o10 = outerGrid[j]![i + 1]!;
        const o11 = outerGrid[j + 1]![i + 1]!;
        const o01 = outerGrid[j + 1]![i]!;
        const outerCol = j === SEG_P - 1 ? edge : j === 0 ? rib : (j === SEG_P - 2 && i === 1 ? stripe : body);
        b.quad(o00, o01, o11, o10, outerCol);

        // Darker matte liner underside (wound inward).
        const i00 = innerGrid[j]![i]!;
        const i10 = innerGrid[j]![i + 1]!;
        const i11 = innerGrid[j + 1]![i + 1]!;
        const i01 = innerGrid[j + 1]![i]!;
        b.quad(i00, i10, i11, i01, liner);
      }
    }

    // Closed fracture walls along left/right jagged meridian splits, crown, and brim.
    for (let j = 0; j < SEG_P; j++) {
      b.quad(outerGrid[j]![0]!, innerGrid[j]![0]!, innerGrid[j + 1]![0]!, outerGrid[j + 1]![0]!, fracture);
      b.quad(outerGrid[j]![SEG_A]!, outerGrid[j + 1]![SEG_A]!, innerGrid[j + 1]![SEG_A]!, innerGrid[j]![SEG_A]!, fracture);
    }
    for (let i = 0; i < SEG_A; i++) {
      b.quad(outerGrid[0]![i]!, outerGrid[0]![i + 1]!, innerGrid[0]![i + 1]!, innerGrid[0]![i]!, fracture);
      b.quad(outerGrid[SEG_P]![i]!, innerGrid[SEG_P]![i]!, innerGrid[SEG_P]![i + 1]!, outerGrid[SEG_P]![i + 1]!, edge);
    }

    const { geometry, centroid } = b.buildCentered();
    const midA = ((k + 0.5) / count) * TAU + 0.35;
    const dir = new THREE.Vector3(Math.sin(midA), 0.35, Math.cos(midA)).normalize();
    variants.push({ geometry, offset: centroid, dir });
  }
  return variants;
}

/** Crooked fracture seam curves across a plate in normalized (u, v) in [-1, 1]. */
function seamU(v: number): number {
  return 0.05 + 0.14 * Math.sin(v * 4.9 + 0.7) + 0.08 * Math.cos(v * 9.1 - 0.4);
}
function seamV(u: number): number {
  return -0.04 + 0.14 * Math.sin(u * 4.5 - 0.5) + 0.08 * Math.cos(u * 8.7 + 0.9);
}

interface PatchBounds {
  uMin: (v: number) => number;
  uMax: (v: number) => number;
  vMin: (u: number) => number;
  vMax: (u: number) => number;
  cutLeft: boolean;
  cutRight: boolean;
  cutBottom: boolean;
  cutTop: boolean;
}

function platePatches(count: number, wide: boolean): PatchBounds[] {
  const neg = () => -1;
  const pos = () => 1;
  if (count <= 2) {
    if (wide) {
      return [
        { uMin: neg, uMax: seamU, vMin: neg, vMax: pos, cutLeft: false, cutRight: true, cutBottom: false, cutTop: false },
        { uMin: seamU, uMax: pos, vMin: neg, vMax: pos, cutLeft: true, cutRight: false, cutBottom: false, cutTop: false },
      ];
    }
    return [
      { uMin: neg, uMax: pos, vMin: seamV, vMax: pos, cutLeft: false, cutRight: false, cutBottom: true, cutTop: false },
      { uMin: neg, uMax: pos, vMin: neg, vMax: seamV, cutLeft: false, cutRight: false, cutBottom: false, cutTop: true },
    ];
  }
  if (count === 3) {
    return [
      { uMin: neg, uMax: seamU, vMin: seamV, vMax: pos, cutLeft: false, cutRight: true, cutBottom: true, cutTop: false },
      { uMin: seamU, uMax: pos, vMin: seamV, vMax: pos, cutLeft: true, cutRight: false, cutBottom: true, cutTop: false },
      { uMin: neg, uMax: pos, vMin: neg, vMax: seamV, cutLeft: false, cutRight: false, cutBottom: false, cutTop: true },
    ];
  }
  return [
    { uMin: neg, uMax: seamU, vMin: seamV, vMax: pos, cutLeft: false, cutRight: true, cutBottom: true, cutTop: false },
    { uMin: seamU, uMax: pos, vMin: seamV, vMax: pos, cutLeft: true, cutRight: false, cutBottom: true, cutTop: false },
    { uMin: neg, uMax: seamU, vMin: neg, vMax: seamV, cutLeft: false, cutRight: true, cutBottom: false, cutTop: true },
    { uMin: seamU, uMax: pos, vMin: neg, vMax: seamV, cutLeft: true, cutRight: false, cutBottom: false, cutTop: true },
  ];
}

/** Builds 2–4 jagged faceted ceramic/steel armor shards matching the plate's outer vertex colors and curved silhouette. */
function buildPlateShards(spec: PlateSpec, count: number): ShardVariant[] {
  const [w, h, depth] = spec.size;
  const sleeve = spec.shape === 'sleeve';
  const outerFn = sleeve ? sleevePoint : slabPoint;
  const thick = Math.max(0.015, Math.min(depth * 0.45, 0.032));
  const { body, rib, edge, stripe } = spec.paint;
  const core = darkenHex(body, 0.32);
  const fracture = darkenHex(edge, 0.42);

  const innerOf = (p: readonly number[]): number[] => {
    if (!sleeve) return [p[0]!, p[1]!, p[2]! - thick];
    const len = Math.hypot(p[0]!, p[2]!) || 1;
    const f = Math.max(0.5, (len - thick) / len);
    return [p[0]! * f, p[1]!, p[2]! * f];
  };

  const patches = platePatches(count, w >= h);
  const SEG_U = 4;
  const SEG_V = 3;
  const variants: ShardVariant[] = [];

  for (const patch of patches) {
    const b = new PlateBuilder();
    const outerGrid: number[][][] = [];
    const innerGrid: number[][][] = [];
    const uvGrid: [number, number][][] = [];

    for (let j = 0; j <= SEG_V; j++) {
      const tv = j / SEG_V;
      const oRow: number[][] = [];
      const iRow: number[][] = [];
      const uvRow: [number, number][] = [];
      for (let i = 0; i <= SEG_U; i++) {
        const tu = i / SEG_U;
        // Two-pass fixed-point evaluation so shared crooked seams meet cleanly at corners.
        let v = -1 + 2 * tv;
        let u = patch.uMin(v) + (patch.uMax(v) - patch.uMin(v)) * tu;
        v = patch.vMin(u) + (patch.vMax(u) - patch.vMin(u)) * tv;
        u = patch.uMin(v) + (patch.uMax(v) - patch.uMin(v)) * tu;
        const op = outerFn(u, v, w, h, depth);
        oRow.push(op);
        iRow.push(innerOf(op));
        uvRow.push([u, v]);
      }
      outerGrid.push(oRow);
      innerGrid.push(iRow);
      uvGrid.push(uvRow);
    }

    for (let j = 0; j < SEG_V; j++) {
      for (let i = 0; i < SEG_U; i++) {
        const [u0, v0] = uvGrid[j]![i]!;
        const [u1, v1] = uvGrid[j + 1]![i + 1]!;
        const um = (u0 + u1) * 0.5;
        const vm = (v0 + v1) * 0.5;
        const rim = Math.abs(um) > 0.78 || Math.abs(vm) > 0.72;
        const middle = Math.abs(um) < 0.26;
        const outerCol = rim ? edge : !middle ? body : (vm > -0.65 && vm < -0.15 ? stripe : rib);
        b.quad(outerGrid[j]![i]!, outerGrid[j]![i + 1]!, outerGrid[j + 1]![i + 1]!, outerGrid[j + 1]![i]!, outerCol);
        // Darker fractured ceramic/steel backing face.
        b.quad(innerGrid[j]![i]!, innerGrid[j + 1]![i]!, innerGrid[j + 1]![i + 1]!, innerGrid[j]![i + 1]!, core);
      }
    }

    // Perimeter walls: fractured core color on split seams, plate edge color on intact rims.
    const leftCol = patch.cutLeft ? fracture : edge;
    const rightCol = patch.cutRight ? fracture : edge;
    const bottomCol = patch.cutBottom ? fracture : edge;
    const topCol = patch.cutTop ? fracture : edge;

    for (let j = 0; j < SEG_V; j++) {
      b.quad(outerGrid[j]![0]!, outerGrid[j + 1]![0]!, innerGrid[j + 1]![0]!, innerGrid[j]![0]!, leftCol);
      b.quad(outerGrid[j]![SEG_U]!, innerGrid[j]![SEG_U]!, innerGrid[j + 1]![SEG_U]!, outerGrid[j + 1]![SEG_U]!, rightCol);
    }
    for (let i = 0; i < SEG_U; i++) {
      b.quad(outerGrid[0]![i]!, innerGrid[0]![i]!, innerGrid[0]![i + 1]!, outerGrid[0]![i + 1]!, bottomCol);
      b.quad(outerGrid[SEG_V]![i]!, outerGrid[SEG_V]![i + 1]!, innerGrid[SEG_V]![i + 1]!, innerGrid[SEG_V]![i]!, topCol);
    }

    const { geometry, centroid } = b.buildCentered();
    const dir = centroid.clone();
    if (dir.lengthSq() < 1e-4) dir.set(0, 0.3, 1);
    else dir.z += sleeve ? 0.1 : 0.25;
    dir.normalize();
    variants.push({ geometry, offset: centroid, dir });
  }
  return variants;
}

/** Cached jagged shard variants per PlateSpec and piece count (2–3 for helmets, 2–4 for armor plates). */
export function plateShards(spec: PlateSpec, count: number): readonly ShardVariant[] {
  const helmet = isHelmetPlate(spec);
  const clamped = helmet ? Math.max(2, Math.min(3, Math.round(count))) : Math.max(2, Math.min(4, Math.round(count)));
  let byCount = shardCache.get(spec);
  if (!byCount) {
    byCount = new Map();
    shardCache.set(spec, byCount);
  }
  let shards = byCount.get(clamped);
  if (!shards) {
    shards = helmet ? buildHelmetShards(spec, clamped) : buildPlateShards(spec, clamped);
    byCount.set(clamped, shards);
  }
  return shards;
}

let material: THREE.MeshStandardMaterial | null = null;

/** One material for every plate. Local UVs would need a texture; vertex paint and flat facets carry it instead. */
export function plateMaterial(ctx: Ctx): THREE.Material {
  if (material) return material;
  material = ctx.render.materials.patch(new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, metalness: 0.5, roughness: 0.45, side: THREE.DoubleSide,
  }));
  return material;
}

interface Flying {
  mesh: THREE.Mesh;
  /** True for shard meshes owned & pooled by PlateDebris; false for intact enemy plate meshes. */
  pooled: boolean;
  baseScaleX: number;
  baseScaleY: number;
  baseScaleZ: number;
  vx: number;
  vy: number;
  vz: number;
  sx: number;
  sy: number;
  sz: number;
  life: number;
}

export const DEFAULT_SHATTER_CHANCE = 0.45;
export const MAX_FLYING = 48;
const GRAVITY = -28;

export class PlateDebris {
  private readonly slots: Flying[] = [];
  private readonly active: Flying[] = [];
  private readonly freeSlots: Flying[] = [];
  private shardPool: THREE.Mesh[] = [];
  private pos = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private scale = new THREE.Vector3();
  private offset = new THREE.Vector3();
  private outDir = new THREE.Vector3();
  private boxSize = new THREE.Vector3();

  constructor(private readonly ctx: Ctx) {
    for (let i = 0; i < MAX_FLYING; i++) {
      const slot: Flying = {
        mesh: null as unknown as THREE.Mesh,
        pooled: false,
        baseScaleX: 1,
        baseScaleY: 1,
        baseScaleZ: 1,
        vx: 0,
        vy: 0,
        vz: 0,
        sx: 0,
        sy: 0,
        sz: 0,
        life: 0,
      };
      this.slots.push(slot);
      this.freeSlots.push(slot);
    }
  }

  get activeCount(): number {
    return this.active.length;
  }

  get pooledCount(): number {
    return this.shardPool.length;
  }

  /**
   * Takes the plate off its bone and either throws it intact or shatters it into jagged flying shards.
   * `shatterChance` defaults to `DEFAULT_SHATTER_CHANCE` (~0.45); heavy/overkill/explosive/piercing hits pass higher.
   */
  launch(plate: Plate, dir: THREE.Vector3, shatterChance = DEFAULT_SHATTER_CHANCE): void {
    const { mesh } = plate;
    mesh.getWorldPosition(this.pos);
    mesh.getWorldQuaternion(this.quat);
    mesh.getWorldScale(this.scale);
    mesh.parent?.remove(mesh);

    if (shatterChance > 0 && Math.random() < shatterChance) {
      // Detach and hide the enemy's pooled plate mesh cleanly without destroying it; fitPlates / release restores it.
      mesh.visible = false;
      this.shatter(plate, dir);
      return;
    }

    mesh.position.copy(this.pos);
    mesh.quaternion.copy(this.quat);
    mesh.scale.copy(this.scale);
    mesh.visible = true;
    this.ctx.render.scene.add(mesh);
    this.spawnFlying(
      mesh,
      false,
      this.scale.x || 1,
      this.scale.y || 1,
      this.scale.z || 1,
      dir.x * 7 + rand(-3, 3),
      rand(6, 11),
      dir.z * 7 + rand(-3, 3),
      rand(4, 14) * (Math.random() < 0.5 ? 1 : -1),
      rand(0, TAU),
      rand(-4, 4),
      rand(1.1, 1.7),
    );
  }

  /** Spawns 2–3 helmet dome shards or 2–4 jagged plate shards exploding outward from the broken plate. */
  private shatter(plate: Plate, dir: THREE.Vector3): void {
    const { spec, mesh } = plate;
    const helmet = isHelmetPlate(spec);
    const count = helmet ? (Math.random() < 0.5 ? 2 : 3) : 2 + Math.floor(Math.random() * 3);
    const shards = plateShards(spec, count);
    const mat = plateMaterial(this.ctx);

    let sx = this.scale.x || 1;
    let sy = this.scale.y || 1;
    let sz = this.scale.z || 1;

    // For worn props or custom meshes whose geometry bounds differ from spec.size, adapt shard scale gently.
    if (plate.worn && mesh.geometry?.getAttribute('position')) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      if (bb && !bb.isEmpty()) {
        bb.getSize(this.boxSize);
        const [sw, sh] = spec.size;
        if (sw > 1e-3 && this.boxSize.x > 1e-3) sx *= Math.max(0.65, Math.min(1.65, this.boxSize.x / sw));
        if (sh > 1e-3 && this.boxSize.y > 1e-3) sy *= Math.max(0.65, Math.min(1.65, this.boxSize.y / sh));
        if (sw > 1e-3 && this.boxSize.z > 1e-3) sz *= Math.max(0.65, Math.min(1.65, this.boxSize.z / sw));
      }
    }

    for (let i = 0; i < shards.length; i++) {
      const variant = shards[i]!;
      const shardMesh = this.acquireShard(variant.geometry, mat);

      this.offset.copy(variant.offset);
      this.offset.x *= sx;
      this.offset.y *= sy;
      this.offset.z *= sz;
      this.offset.applyQuaternion(this.quat);

      shardMesh.position.copy(this.pos).add(this.offset);
      shardMesh.quaternion.copy(this.quat);
      shardMesh.scale.set(sx, sy, sz);
      shardMesh.visible = true;
      this.ctx.render.scene.add(shardMesh);

      this.outDir.copy(variant.dir).applyQuaternion(this.quat).normalize();
      const carry = rand(4.5, 8.5);
      const burst = helmet ? rand(3.5, 6.5) : rand(2.8, 5.8);
      const spinMax = helmet ? 18 : 16;

      this.spawnFlying(
        shardMesh,
        true,
        sx,
        sy,
        sz,
        dir.x * carry + this.outDir.x * burst + rand(-1.2, 1.2),
        Math.max(dir.y * 5, 0) + this.outDir.y * 2.5 + rand(4.5, 9.5),
        dir.z * carry + this.outDir.z * burst + rand(-1.2, 1.2),
        rand(5, spinMax) * (Math.random() < 0.5 ? 1 : -1),
        rand(5, spinMax) * (Math.random() < 0.5 ? 1 : -1),
        rand(4, spinMax - 2) * (Math.random() < 0.5 ? 1 : -1),
        rand(0.95, 1.55),
      );
    }
  }

  private acquireShard(geometry: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
    const recycled = this.shardPool.pop();
    if (recycled) {
      recycled.geometry = geometry;
      recycled.material = mat;
      return recycled;
    }
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = false;
    return mesh;
  }

  private spawnFlying(
    mesh: THREE.Mesh,
    pooled: boolean,
    baseScaleX: number,
    baseScaleY: number,
    baseScaleZ: number,
    vx: number,
    vy: number,
    vz: number,
    sx: number,
    sy: number,
    sz: number,
    life: number,
  ): void {
    let slot = this.freeSlots.pop();
    if (!slot) {
      // Evict the entry with the least remaining life without Array.shift().
      let oldestIdx = 0;
      let minLife = this.active[0]!.life;
      for (let i = 1; i < this.active.length; i++) {
        const l = this.active[i]!.life;
        if (l < minLife) {
          minLife = l;
          oldestIdx = i;
        }
      }
      slot = this.active[oldestIdx]!;
      this.retire(slot);
      const last = this.active.pop()!;
      if (oldestIdx < this.active.length) this.active[oldestIdx] = last;
    }
    slot.mesh = mesh;
    slot.pooled = pooled;
    slot.baseScaleX = baseScaleX;
    slot.baseScaleY = baseScaleY;
    slot.baseScaleZ = baseScaleZ;
    slot.vx = vx;
    slot.vy = vy;
    slot.vz = vz;
    slot.sx = sx;
    slot.sy = sy;
    slot.sz = sz;
    slot.life = life;
    this.active.push(slot);
  }

  /** A pooled body takes its piece back: stop flying if airborne and restore visibility & unit scale cleanly. */
  release(mesh: THREE.Mesh): void {
    for (let i = 0; i < this.active.length; i++) {
      const f = this.active[i]!;
      if (!f.pooled && f.mesh === mesh) {
        const last = this.active.pop()!;
        if (i < this.active.length) this.active[i] = last;
        f.mesh = null as unknown as THREE.Mesh;
        this.freeSlots.push(f);
        mesh.removeFromParent();
        break;
      }
    }
    mesh.visible = true;
    mesh.scale.setScalar(1);
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const f = this.active[i]!;
      f.life -= dt;
      f.vy += GRAVITY * dt;
      f.mesh.position.x += f.vx * dt;
      f.mesh.position.y += f.vy * dt;
      f.mesh.position.z += f.vz * dt;
      f.mesh.rotation.x += f.sx * dt;
      f.mesh.rotation.y += f.sy * dt;
      f.mesh.rotation.z += f.sz * dt;
      if (f.life < 0.3) {
        const k = Math.max(f.life / 0.3, 0.01);
        f.mesh.scale.set(f.baseScaleX * k, f.baseScaleY * k, f.baseScaleZ * k);
      }
      if (f.life <= 0) {
        this.retire(f);
        const last = this.active.pop()!;
        if (i < this.active.length) this.active[i] = last;
        f.mesh = null as unknown as THREE.Mesh;
        this.freeSlots.push(f);
      }
    }
  }

  clear(): void {
    for (let i = 0; i < this.active.length; i++) {
      const f = this.active[i]!;
      this.retire(f);
      f.mesh = null as unknown as THREE.Mesh;
      this.freeSlots.push(f);
    }
    this.active.length = 0;
  }

  private retire(f: Flying): void {
    f.mesh.removeFromParent();
    f.mesh.scale.setScalar(1);
    f.mesh.visible = true;
    if (f.pooled && this.shardPool.length < MAX_FLYING) this.shardPool.push(f.mesh);
  }
}
