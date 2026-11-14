/**
 * Loose pieces of a body: meat, viscera, bone, and a burst head's kit (cranium, jaw, brain, eyes). Faceted and wet, drawn as instances so a dozen
 * gibbed enemies stay a handful of draw calls. They collide with the world only. Each has a real body while
 * it moves, then gives it back and stays as a still instance until its slot is needed.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CG, type Ctx } from '../core/contracts';
import { groups } from '../physics/Physics';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, mulberry32, TAU } from '../core/math';
import type { BloodField } from './blood';
import { ImpactTuning, type ImpactEvents } from './impacts';

export type ChunkKind = 'meat' | 'viscera' | 'bone' | 'cranium' | 'jaw' | 'brain' | 'eye' | 'scrap';

export const ChunkTuning = {
  /** Slots per kind. A new piece reclaims the oldest in that kind. */
  capacity: { meat: 96, viscera: 40, bone: 48, cranium: 24, jaw: 16, brain: 16, eye: 16, scrap: 48 } as Record<ChunkKind, number>,
  /** Bodies alive at once across all kinds. Past this, new pieces take the oldest body's place. */
  maxBodies: 72,
  /** Seconds at rest before the body is dropped. */
  settle: 0.35,
  /** How long a still piece lies around before shrinking away. */
  linger: 14,
  shrink: 0.8,
  restitution: 0.32,
  friction: 0.75,
  /** Speed lost in one step that counts as a wet impact. */
  impactSpeed: 3.5,
};

interface Chunk {
  kind: ChunkKind;
  slot: number;
  body: RAPIER.RigidBody | null;
  size: number;
  /** How big it is to the floor: what it stains and how loud it lands. `size` for a lump, less for a thin head piece. */
  bulk: number;
  /** Non-uniform stretch, so instances of one shape do not look alike. */
  sx: number; sy: number; sz: number;
  born: number;
  still: number;
  /** When it stopped, or -1 while moving. */
  restedAt: number;
  speed: number;
  splats: number;
  /** World time this piece may next be heard landing. */
  nextThud: number;
  alive: boolean;
  readonly p: THREE.Vector3;
  readonly q: THREE.Quaternion;
  readonly v: THREE.Vector3;
}

/** A displaced icosahedron with flat facets, tinted darker in its dents. */
function lump(seed: number, detail: number, roughness: number, inner: number, outer: number, stretchY = 1): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const base = new THREE.IcosahedronGeometry(1, detail);
  const pos = base.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const a = new THREE.Color(inner);
  const b = new THREE.Color(outer);
  const c = new THREE.Color();
  // Vertices are unshared in a polyhedron, so displacement has to be keyed by position to stay closed.
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let k = seen.get(key);
    if (k === undefined) seen.set(key, (k = rnd()));
    const r = 1 + (k - 0.5) * roughness;
    pos.setXYZ(i, pos.getX(i) * r, pos.getY(i) * r * stretchY, pos.getZ(i) * r);
    c.copy(a).lerp(b, Math.min(1, Math.max(0, k * 1.35 - 0.1)));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  base.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  base.computeVertexNormals();
  return base;
}

/**
 * The pieces of a burst head, built for a head of radius 1 (y up, the face toward +z) and each moved to its own centre.
 * A cranium third is a curved shell, bloodied bone outside and dark red inside; a jaw half a quarter ring; a brain half
 * a lump with a flat dark face; an eye a ball. `at` is where the piece sits in the whole head, before its own turn `q`.
 */
interface KitPiece { kind: ChunkKind; at: THREE.Vector3; q: THREE.Quaternion }

/** Vertex colours from `pick(x, y, z, noise)`, with noise keyed by position so shared corners agree. */
function paint(g: THREE.BufferGeometry, seed: number, rough: number, pick: (x: number, y: number, z: number, k: number, out: THREE.Color) => void): void {
  const rnd = mulberry32(seed);
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let k = seen.get(key);
    if (k === undefined) seen.set(key, (k = rnd()));
    pick(x, y, z, k, c);
    const r = 1 + (k - 0.5) * rough;
    pos.setXYZ(i, x * r, y * r, z * r);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

const BONE = new THREE.Color(0xdccbab);
const GORE = new THREE.Color(0x6a0808);
const RAW = new THREE.Color(0x8e1414);

/** Moves a piece to its own centre, so its body spins about the piece, and says where that centre was. */
function centred(g: THREE.BufferGeometry): { g: THREE.BufferGeometry; at: THREE.Vector3 } {
  g.computeBoundingBox();
  const at = g.boundingBox!.getCenter(new THREE.Vector3());
  g.translate(-at.x, -at.y, -at.z);
  g.computeVertexNormals();
  return { g, at };
}

function craniumThird(): { g: THREE.BufferGeometry; at: THREE.Vector3 } {
  const span = 1.95;
  const outer = new THREE.SphereGeometry(1, 7, 6, 0, TAU / 3, 0, span);
  // Blood soaks in toward the broken edge, at the bottom of the shell.
  paint(outer, 17, 0.08, (_x, y, _z, k, c) => c.copy(BONE).lerp(GORE, clamp((0.35 - y) * 0.45 + (k - 0.55) * 1.6, 0, 0.85)));
  const inner = new THREE.SphereGeometry(0.84, 7, 6, 0, TAU / 3, 0, span);
  const idx = inner.getIndex()!;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i);
    idx.setX(i, idx.getX(i + 2));
    idx.setX(i + 2, a);
  }
  paint(inner, 19, 0.06, (_x, _y, _z, k, c) => c.copy(GORE).lerp(RAW, k));
  return centred(mergeGeometries([outer, inner])!);
}

function jawHalf(): { g: THREE.BufferGeometry; at: THREE.Vector3 } {
  const g = new THREE.TorusGeometry(0.58, 0.13, 4, 6, Math.PI / 2);
  // The ring from the hinge at +x round to the chin at +z, taller than it is thick.
  g.rotateX(Math.PI / 2);
  g.scale(1, 1.7, 1);
  paint(g, 23, 0.12, (x, _y, z, k, c) => c.copy(BONE).lerp(GORE, clamp((Math.min(x, z) < 0.12 ? 0.5 : 0) + (k - 0.5), 0, 0.8)));
  g.translate(0, -0.55, 0.08);
  return centred(g);
}

function brainHalf(): { g: THREE.BufferGeometry; at: THREE.Vector3 } {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const pos = g.getAttribute('position');
  // Cut at the midline: the left half folds flat onto it, and that face is the dark inside.
  for (let i = 0; i < pos.count; i++) pos.setX(i, Math.max(0, pos.getX(i)));
  paint(g, 31, 0.22, (x, _y, _z, k, c) => {
    if (x < 0.02) c.set(0x5c1018).lerp(RAW, k * 0.5);
    else c.set(0xb05a62).lerp(new THREE.Color(0xe8a3a8), k);
  });
  g.scale(0.36, 0.5, 0.72);
  g.translate(0.02, 0.22, -0.06);
  return centred(g);
}

function eye(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.17, 8, 6);
  paint(g, 37, 0, (_x, _y, z, _k, c) => c.set(z > 0.15 ? 0x111111 : z > 0.11 ? 0x3d5a4a : z < -0.1 ? 0x8a1a1a : 0xe9e3d6));
  g.computeVertexNormals();
  return g;
}

const _turn = new THREE.Quaternion();
const _y = new THREE.Vector3(0, 1, 0);
const _z = new THREE.Vector3(0, 0, 1);

/** Builds the kit's geometries and its layout in one head. */
function buildKit(): { geometry: Map<ChunkKind, THREE.BufferGeometry>; pieces: KitPiece[] } {
  const cranium = craniumThird();
  const jaw = jawHalf();
  const brain = brainHalf();
  const pieces: KitPiece[] = [];
  const piece = (kind: ChunkKind, at: THREE.Vector3, q: THREE.Quaternion) => pieces.push({ kind, at: at.clone().applyQuaternion(q), q: q.clone() });
  for (let i = 0; i < 3; i++) piece('cranium', cranium.at, _turn.setFromAxisAngle(_y, (i * TAU) / 3));
  piece('jaw', jaw.at, _turn.identity());
  // The other half is the same ring turned over onto the other side.
  piece('jaw', jaw.at, _turn.setFromAxisAngle(_z, Math.PI));
  pieces[pieces.length - 1]!.at.y = jaw.at.y;
  piece('brain', brain.at, _turn.identity());
  piece('brain', brain.at, _turn.setFromAxisAngle(_y, Math.PI));
  for (const side of [-1, 1]) piece('eye', new THREE.Vector3(0.33 * side, 0, 0.84), _turn.identity());
  return { geometry: new Map([['cranium', cranium.g], ['jaw', jaw.g], ['brain', brain.g], ['eye', eye()]]), pieces };
}

/** A kit piece's collider half-size against its head radius. A plain lump uses 0.72 of its size. */
const KIT_BOX: Partial<Record<ChunkKind, number>> = { cranium: 0.42, jaw: 0.3, brain: 0.3, eye: 0.17 };

/** Curved plate: a fragment of cranium, thin with a rough broken edge. Now only scrap, for machines. */
function shard(seed: number): THREE.BufferGeometry {
  const g = lump(seed, 0, 0.5, 0xc9b49a, 0xf0e6d2);
  g.scale(1, 0.34, 0.8);
  g.computeVertexNormals();
  return g;
}

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _hide = new THREE.Matrix4().makeScale(0, 0, 0);
const _none = new THREE.Quaternion();
const _rot = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _o = new THREE.Vector3();

export class ChunkField {
  private readonly meshes = new Map<ChunkKind, THREE.InstancedMesh>();
  private readonly slots = new Map<ChunkKind, Chunk[]>();
  private readonly ring = new Map<ChunkKind, number>();
  private readonly live: Chunk[] = [];
  /** Every slot of every kind, so the per-frame sweep needs no iterators. */
  private readonly all: Chunk[] = [];
  private ready = false;
  private readonly impactDir = new THREE.Vector3();
  private kit: KitPiece[] = [];

  constructor(private readonly ctx: Ctx, private readonly blood: BloodField, private readonly impacts: ImpactEvents) {}

  /** Builds the instanced meshes. Called at load, because doing it on the first gib stalls that frame. */
  ensure(): void {
    if (this.ready) return;
    this.ready = true;
    const { render } = this.ctx;
    const wet = (roughness: number, clearcoat: number) => {
      const m = new THREE.MeshPhysicalMaterial({
        vertexColors: true, flatShading: true, roughness, metalness: 0, clearcoat, clearcoatRoughness: 0.2,
      });
      return render.materials?.patch ? render.materials.patch(m) ?? m : m;
    };
    const make = (kind: ChunkKind, geometry: THREE.BufferGeometry, material: THREE.Material) => {
      const cap = ChunkTuning.capacity[kind];
      const mesh = new THREE.InstancedMesh(geometry, material, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      for (let i = 0; i < cap; i++) mesh.setMatrixAt(i, _hide);
      render.scene.add(mesh);
      this.meshes.set(kind, mesh);
      this.ring.set(kind, 0);
      const slots: Chunk[] = Array.from({ length: cap }, (_, slot) => ({
        kind, slot, body: null, size: 0, bulk: 0, sx: 1, sy: 1, sz: 1, born: 0, still: 0, restedAt: -1, speed: 0, splats: 0, nextThud: 0, alive: false,
        p: new THREE.Vector3(), q: new THREE.Quaternion(), v: new THREE.Vector3(),
      }));
      this.slots.set(kind, slots);
      this.all.push(...slots);
    };
    make('meat', lump(11, 1, 0.75, 0x4a0606, 0xc41a1a), wet(0.3, 0.7));
    make('viscera', lump(23, 1, 0.45, 0x7a1420, 0xd8455a, 1.5), wet(0.2, 1));
    make('bone', lump(5, 0, 0.55, 0xb9a98a, 0xeee4cd, 2.2), wet(0.55, 0.15));
    const kit = buildKit();
    this.kit = kit.pieces;
    const shell = wet(0.5, 0.2);
    shell.side = THREE.DoubleSide;
    make('cranium', kit.geometry.get('cranium')!, shell);
    make('jaw', kit.geometry.get('jaw')!, wet(0.5, 0.2));
    make('brain', kit.geometry.get('brain')!, wet(0.22, 1));
    make('eye', kit.geometry.get('eye')!, wet(0.15, 1));
    make('scrap', shard(41), wet(0.4, 0));
  }

  /**
   * A head coming apart: the kit's nine pieces start where they sit in the head (`turn` is the head's facing, `r` its
   * radius) and fly out from its centre together, pushed on along `dir`.
   */
  burstHead(center: THREE.Vector3, turn: THREE.Quaternion, r: number, dir: THREE.Vector3): void {
    this.ensure();
    for (const k of this.kit) {
      const p = _p.copy(k.at).applyQuaternion(turn);
      const out = _o.copy(p).normalize();
      p.multiplyScalar(r).add(center);
      const pop = (k.kind === 'brain' ? 2.2 : 3.4) * (0.85 + Math.random() * 0.3);
      const push = k.kind === 'brain' ? 2.5 : 3.5;
      _rot.copy(turn).multiply(k.q);
      this.spawn(
        k.kind, p.x, p.y, p.z,
        out.x * pop + dir.x * push, out.y * pop + dir.y * push + 2, out.z * pop + dir.z * push,
        r, _rot, 9,
      );
    }
  }

  /** Throws one piece. Oldest in its kind is reclaimed when the slots are full. */
  spawn(
    kind: ChunkKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number,
    rotation?: THREE.Quaternion, spin = 30,
  ): void {
    this.ensure();
    const { R, world } = this.ctx.physics;
    const ring = this.ring.get(kind)!;
    const slots = this.slots.get(kind)!;
    const c = slots[ring]!;
    this.ring.set(kind, (ring + 1) % slots.length);
    if (c.alive) this.retire(c);

    if (this.live.length >= ChunkTuning.maxBodies) this.dropBody(this.live[0]!);

    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setRotation(rotation ?? _none)
        .setLinvel(vx, vy, vz)
        .setAngvel({ x: (Math.random() - 0.5) * spin, y: (Math.random() - 0.5) * spin, z: (Math.random() - 0.5) * spin })
        .setLinearDamping(0.1)
        .setAngularDamping(0.9),
    );
    // Thin plates and long bones need a box. A sphere would roll forever.
    const box = KIT_BOX[kind];
    const hx = size * (box ?? 0.72);
    world.createCollider(
      R.ColliderDesc.cuboid(hx, kind === 'cranium' ? hx * 0.5 : hx, hx)
        .setDensity(1100)
        .setFriction(ChunkTuning.friction)
        .setRestitution(ChunkTuning.restitution)
        .setCollisionGroups(groups(CG.Debris, CG.World)),
      body,
    );
    c.body = body;
    c.size = size;
    c.bulk = box === undefined ? size : hx;
    // The kit's pieces fit together into a head, so they keep their shape.
    c.sx = box === undefined ? 0.75 + Math.random() * 0.5 : 1;
    c.sy = box === undefined ? 0.75 + Math.random() * 0.5 : 1;
    c.sz = box === undefined ? 0.75 + Math.random() * 0.5 : 1;
    c.born = this.ctx.time.elapsed;
    c.still = 0;
    c.restedAt = -1;
    c.speed = Math.hypot(vx, vy, vz);
    c.splats = 0;
    c.nextThud = 0;
    c.alive = true;
    this.live.push(c);
  }

  private dropBody(c: Chunk): void {
    if (c.body) {
      c.body.translation(c.p);
      c.body.rotation(c.q);
      this.ctx.physics.world.removeRigidBody(c.body);
      c.body = null;
    }
    c.restedAt = this.ctx.time.elapsed;
    const at = this.live.indexOf(c);
    if (at >= 0) {
      this.live[at] = this.live[this.live.length - 1]!;
      this.live.pop();
    }
    this.write(c, 1);
  }

  private retire(c: Chunk): void {
    if (c.body) this.dropBody(c);
    c.alive = false;
    const mesh = this.meshes.get(c.kind)!;
    mesh.setMatrixAt(c.slot, _hide);
    mesh.instanceMatrix.needsUpdate = true;
  }

  private write(c: Chunk, scale: number): void {
    const s = c.size * scale;
    _m.compose(c.p, c.q, _s.set(s * c.sx, s * c.sy, s * c.sz));
    const mesh = this.meshes.get(c.kind)!;
    mesh.setMatrixAt(c.slot, _m);
    mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    if (!this.ready) return;
    const now = this.ctx.time.elapsed;
    const t = ChunkTuning;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const c = this.live[i]!;
      const body = c.body!;
      body.translation(c.p);
      body.rotation(c.q);
      body.linvel(c.v);
      const speed = c.v.length();
      const lost = c.speed - speed;
      // A sharp loss of speed is a bounce. Stain where it hit, a few times at most per piece.
      if (lost > t.impactSpeed && c.splats < 3 && c.kind !== 'scrap') {
        c.splats++;
        this.blood.stainBelow(c.p, 0.14 + c.bulk * 2.2, 'blood', 0.8);
      }
      if (c.kind !== 'scrap') {
        const scale = clamp(c.bulk / ImpactTuning.organFullSize, ImpactTuning.organFloor, 1);
        c.nextThud = this.impacts.land('organ', lost, c.speed, c.p, c.nextThud, scale);
      }
      c.speed = speed;
      this.write(c, 1);
      if (speed < 0.25) c.still += dt;
      else c.still = 0;
      if (c.still > t.settle || now - c.born > 7) this.dropBody(c);
    }
    const all = this.all;
    for (let i = 0; i < all.length; i++) {
      const c = all[i]!;
      if (!c.alive || c.restedAt < 0) continue;
      const age = now - c.restedAt - t.linger;
      if (age <= 0) continue;
      if (age >= t.shrink) this.retire(c);
      else this.write(c, 1 - age / t.shrink);
    }
  }

  get bodies(): number {
    return this.live.length;
  }

  /** Speed of the fastest piece in flight. For checks. */
  get fastest(): number {
    let top = 0;
    for (let i = 0; i < this.live.length; i++) top = Math.max(top, this.live[i]!.speed);
    return top;
  }

  clear(): void {
    if (!this.ready) return;
    for (const c of this.all) if (c.alive) this.retire(c);
  }
}

/** Velocity helper shared by bursts: a direction plus a little scatter. */
export function scatter(dir: THREE.Vector3, speed: number, jitter: number, up: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(
    dir.x * speed + (Math.random() - 0.5) * 2 * jitter,
    dir.y * speed + Math.random() * up,
    dir.z * speed + (Math.random() - 0.5) * 2 * jitter,
  );
}

