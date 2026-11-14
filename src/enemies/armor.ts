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
  vx: number;
  vy: number;
  vz: number;
  sx: number;
  sy: number;
  life: number;
}

const MAX_FLYING = 24;
const GRAVITY = -28;

export class PlateDebris {
  private flying: Flying[] = [];
  private pos = new THREE.Vector3();
  private quat = new THREE.Quaternion();

  constructor(private readonly ctx: Ctx) {}

  /** Takes the plate off its bone and throws it along `dir`. */
  launch(plate: Plate, dir: THREE.Vector3): void {
    const { mesh } = plate;
    mesh.getWorldPosition(this.pos);
    mesh.getWorldQuaternion(this.quat);
    mesh.parent?.remove(mesh);
    mesh.position.copy(this.pos);
    mesh.quaternion.copy(this.quat);
    this.ctx.render.scene.add(mesh);
    if (this.flying.length >= MAX_FLYING) this.retire(this.flying.shift()!);
    this.flying.push({
      mesh,
      vx: dir.x * 7 + rand(-3, 3),
      vy: rand(6, 11),
      vz: dir.z * 7 + rand(-3, 3),
      sx: rand(4, 14) * (Math.random() < 0.5 ? 1 : -1),
      sy: rand(0, TAU),
      life: rand(1.1, 1.7),
    });
  }

  update(dt: number): void {
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i]!;
      f.life -= dt;
      f.vy += GRAVITY * dt;
      f.mesh.position.x += f.vx * dt;
      f.mesh.position.y += f.vy * dt;
      f.mesh.position.z += f.vz * dt;
      f.mesh.rotation.x += f.sx * dt;
      f.mesh.rotation.y += f.sy * dt;
      if (f.life < 0.3) f.mesh.scale.setScalar(Math.max(f.life / 0.3, 0.01));
      if (f.life <= 0) {
        this.retire(f);
        this.flying.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const f of this.flying) this.retire(f);
    this.flying.length = 0;
  }

  private retire(f: Flying): void {
    f.mesh.removeFromParent();
    f.mesh.scale.setScalar(1);
  }
}
