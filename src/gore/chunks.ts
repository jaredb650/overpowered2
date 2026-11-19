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
import { clamp, mulberry32, rand, TAU } from '../core/math';
import type { BloodField } from './blood';
import { ImpactTuning, type ImpactEvents } from './impacts';
import { buildFlesh, buildOrgans, buildRibcage, ORGANS, RIB_KINDS, type OrganKind, type RibKind } from './organs';
import { TrailTuning, type GibTrail, type Ribbon } from './trail';

/** A piece cut from one archetype's own body at load and registered here (`ChunkField.register`): a slab of its trunk (slabs.ts). */
export type CutKind = `slab:${string}`;
export type ChunkKind = 'meat' | 'viscera' | 'bone' | 'cranium' | 'jaw' | 'brain' | 'eye' | 'scrap' | OrganKind | RibKind | CutKind;

export const ChunkTuning = {
  /** Slots per kind. A new piece reclaims the oldest in that kind. */
  capacity: {
    meat: 96, viscera: 40, bone: 48, cranium: 24, jaw: 16, brain: 16, eye: 16, scrap: 48,
    // Organs and the ribcage's six fragments: eight trunks' worth, the oldest given back first.
    lung: 16, liver: 10, heart: 10, stomach: 10, ribsUL: 12, ribsLL: 12, ribsUR: 12, ribsLR: 12, sternum: 12, spine: 12,
  } as Record<Exclude<ChunkKind, CutKind>, number>,
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

/** A piece at least this big across, metres, trails blood as it flies: an organ, a rib fragment, a slab, a big lump of meat. */
const TRAIL_BULK = 0.05;
/** Seconds a flying piece of meat drips for, and its drops a second. */
const GIB_DRIP_FOR = 2.5;
const GIB_DRIPS = 3;

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
  /** An organ's wobble after a landing, 1 down to 0. */
  wob: number;
  /** World time it may next leave a strand of blood in its path, and the ribbon a big piece trails (trail.ts). */
  trailAt: number;
  ribbon: Ribbon | null;
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

/** A kit piece's collider half-size against its head radius (a ribcage fragment's: its body's scale). A plain lump uses 0.72 of its size. */
const KIT_BOX: Partial<Record<Exclude<ChunkKind, CutKind>, number>> = {
  cranium: 0.42, jaw: 0.3, brain: 0.3, eye: 0.17, ribsUL: 0.055, ribsLL: 0.055, ribsUR: 0.055, ribsLR: 0.055, sternum: 0.035, spine: 0.045,
};
const ORGAN_SET: ReadonlySet<ChunkKind> = new Set(ORGANS);
/** Kinds that trail a ribbon of blood as they fly (trail.ts). */
const RIBBONED: Set<ChunkKind> = new Set(ORGANS);
const LASTING: ReadonlySet<ChunkKind> = new Set([...ORGANS, ...RIB_KINDS]);

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
  /** Where each ribcage fragment sits in the chest bone's frame, for a 1.85 m body. */
  private readonly ribAt = new Map<ChunkKind, THREE.Vector3>();
  /** Half size of each soft or curved piece's own shape, for a collider it lies on instead of sinking through. */
  private readonly extent = new Map<ChunkKind, THREE.Vector3>();
  /**
   * The floor under the gib being thrown, set by gore around one: nothing starts below it. A body lying down puts its
   * organs and ribs under the floor, and pieces started inside the floor are pushed out through it as often as up.
   */
  floor = -Infinity;

  constructor(private readonly ctx: Ctx, private readonly blood: BloodField, private readonly impacts: ImpactEvents, private readonly trail: GibTrail | null = null) {}

  /** Builds the instanced meshes. Called at load, because doing it on the first gib stalls that frame. */
  ensure(): void {
    if (this.ready) return;
    this.ready = true;
    const { render } = this.ctx;
    const wet = (roughness: number, clearcoat: number, glow = 0) => {
      const m = new THREE.MeshPhysicalMaterial({
        vertexColors: true, flatShading: true, roughness, metalness: 0, clearcoat, clearcoatRoughness: 0.2,
        // A breath of its own colour: in a dark, blue-lit map, dark red and bone on dark floor read as nothing.
        emissive: glow ? new THREE.Color(glow) : undefined,
      });
      return render.materials?.patch ? render.materials.patch(m) ?? m : m;
    };
    const make = (kind: Exclude<ChunkKind, CutKind>, geometry: THREE.BufferGeometry, material: THREE.Material) => this.make(kind, geometry, material, ChunkTuning.capacity[kind]);
    // Soft torn flesh, smooth-shaded and wet (organs.ts): faceted lumps read as red gems.
    const flesh = buildFlesh();
    const meat = wet(0.24, 0.9, 0x180304);
    (meat as THREE.MeshPhysicalMaterial).flatShading = false;
    make('meat', flesh.get('meat')!, meat);
    make('viscera', flesh.get('viscera')!, meat);
    const splinter = wet(0.45, 0.3);
    (splinter as THREE.MeshPhysicalMaterial).flatShading = false;
    make('bone', flesh.get('bone')!, splinter);
    // Organs, flesh and ribs rest on boxes of their own bounds (most of them: a round thing sits a little into a box).
    for (const kind of [...ORGANS, ...RIB_KINDS, 'meat', 'viscera', 'bone'] as ChunkKind[]) {
      const g = this.meshes.get(kind)?.geometry;
      if (!g) continue;
      g.computeBoundingBox();
      this.extent.set(kind, g.boundingBox!.getSize(new THREE.Vector3()).multiplyScalar(RIB_KINDS.includes(kind as RibKind) ? 0.45 : 0.4));
    }
    const kit = buildKit();
    this.kit = kit.pieces;
    const shell = wet(0.5, 0.2);
    shell.side = THREE.DoubleSide;
    make('cranium', kit.geometry.get('cranium')!, shell);
    make('jaw', kit.geometry.get('jaw')!, wet(0.5, 0.2));
    make('brain', kit.geometry.get('brain')!, wet(0.22, 1));
    make('eye', kit.geometry.get('eye')!, wet(0.15, 1));
    make('scrap', shard(41), wet(0.4, 0));
    // Organs shade smooth: swollen and wet, not faceted like torn meat.
    const organ = wet(0.16, 1, 0x240607);
    (organ as THREE.MeshPhysicalMaterial).flatShading = false;
    for (const [kind, g] of buildOrgans()) make(kind, g, organ);
    const ribs = wet(0.42, 0.35, 0x1e1a14);
    (ribs as THREE.MeshPhysicalMaterial).flatShading = false;
    for (const [kind, g] of buildRibcage()) {
      const c = centred(g);
      this.ribAt.set(kind, c.at);
      make(kind, c.g, ribs);
    }
  }

  private make(kind: ChunkKind, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], cap: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    for (let i = 0; i < cap; i++) mesh.setMatrixAt(i, _hide);
    this.ctx.render.scene.add(mesh);
    this.meshes.set(kind, mesh);
    this.ring.set(kind, 0);
    const slots: Chunk[] = Array.from({ length: cap }, (_, slot) => ({
      kind, slot, body: null, size: 0, bulk: 0, sx: 1, sy: 1, sz: 1, born: 0, still: 0, restedAt: -1, speed: 0, splats: 0, nextThud: 0, wob: 0, trailAt: 0, ribbon: null, alive: false,
      p: new THREE.Vector3(), q: new THREE.Quaternion(), v: new THREE.Vector3(),
    }));
    this.slots.set(kind, slots);
    this.all.push(...slots);
    return mesh;
  }

  /**
   * A kind of piece cut from one archetype's own body (a slab of its trunk, slabs.ts): its geometry in metres as it sits
   * on that body, so it is thrown at size 1 and never stretched; `half` is half its bounds, for the box it rests on;
   * `cap` how many may be in the world. Its mesh is drawn once at load, out of sight, so its programs compile there and
   * not on the first gib, and after that only while one of them is in the world: thirteen archetypes of six slabs would
   * otherwise be a hundred and fifty draws of nothing every frame.
   */
  register(kind: CutKind, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], half: THREE.Vector3, cap: number): void {
    if (this.meshes.has(kind)) return;
    this.ensure();
    const mesh = this.make(kind, geometry, material, cap);
    this.extent.set(kind, half.clone().multiplyScalar(0.85));
    RIBBONED.add(kind);
    this.cut.set(kind, 0);
    // Drawn with each of its own materials, that is: a depth pass draws it with another, and compiles nothing of these.
    const own = new Set(Array.isArray(material) ? material : [material]);
    mesh.onAfterRender = (_renderer, _scene, _camera, _geometry, used) => {
      own.delete(used);
      if (own.size > 0) return;
      mesh.onAfterRender = () => {};
      this.drawn.add(kind);
      if (this.cut.get(kind) === 0) mesh.visible = false;
    };
  }

  /** Pieces alive of each registered kind, and the kinds whose mesh has been drawn once. */
  private readonly cut = new Map<ChunkKind, number>();
  private readonly drawn = new Set<ChunkKind>();

  /**
   * One whole ribcage bursting: each of `kinds` starts where it sits in the chest (`at`, turned `turn`, at `scale` of a 1.85 m
   * body) and flies out from the middle of it and on along `dir`. All six together read as a ribcage for a frame.
   */
  burstRibs(
    at: THREE.Vector3, turn: THREE.Quaternion, scale: number, dir: THREE.Vector3, kinds: readonly RibKind[], push: number, pop = 1,
    thrown?: (from: THREE.Vector3, out: THREE.Vector3) => unknown,
  ): void {
    this.ensure();
    for (const kind of kinds) {
      const local = this.ribAt.get(kind)!;
      const p = _p.copy(local).multiplyScalar(scale).applyQuaternion(turn);
      // Out from the cage's middle, a little above the chest bone.
      const out = _o.set(p.x, (local.y - 0.1) * scale * 0.6, p.z).normalize();
      p.add(at);
      const out2 = rand(2, 3.6) * pop;
      out.set(out.x * out2 + dir.x * push * rand(0.6, 1), out.y * out2 + dir.y * push + rand(1.5, 3.5) * pop, out.z * out2 + dir.z * push * rand(0.6, 1));
      // A gib says how its own pieces leave (`GibThrow` in index.ts).
      thrown?.(p, out);
      this.spawn(kind, p.x, p.y, p.z, out.x, out.y, out.z, scale, turn, 10 * pop);
    }
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

    const extent = this.extent.get(kind);
    const own = this.cut.get(kind);
    const box = own !== undefined ? 1 : KIT_BOX[kind as Exclude<ChunkKind, CutKind>];
    const hx = size * (box ?? 0.72);
    // The kit's pieces fit together into a head or a ribcage, and a slab is a piece of one man: they keep their shape.
    c.sx = box === undefined ? 0.75 + Math.random() * 0.5 : 1;
    c.sy = box === undefined ? 0.75 + Math.random() * 0.5 : 1;
    c.sz = box === undefined ? 0.75 + Math.random() * 0.5 : 1;
    if (own !== undefined) {
      this.cut.set(kind, own + 1);
      this.meshes.get(kind)!.visible = true;
    }
    // Never started under the floor of the gib it came out of, however it is turned: a body lying down turns its
    // ribcage on its side, and a piece started half in a thin floor is pushed out of either face of it.
    const reach = extent ? Math.max(extent.x * c.sx, extent.y * c.sy, extent.z * c.sz) * size : hx;
    y = Math.max(y, this.floor + reach + 0.01);
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setRotation(rotation ?? _none)
        .setLinvel(vx, vy, vz)
        .setAngvel({ x: (Math.random() - 0.5) * spin, y: (Math.random() - 0.5) * spin, z: (Math.random() - 0.5) * spin })
        .setLinearDamping(0.1)
        .setAngularDamping(0.9)
        // Small and thrown at up to 15 m/s: without it a piece crosses a thin floor between two steps and is gone.
        .setCcdEnabled(true),
    );
    // Thin plates and long bones need a box. A sphere would roll forever.
    world.createCollider(
      (extent
        ? R.ColliderDesc.cuboid(extent.x * size * c.sx, extent.y * size * c.sy, extent.z * size * c.sz)
        : R.ColliderDesc.cuboid(hx, kind === 'cranium' ? hx * 0.5 : hx, hx))
        .setDensity(1100)
        .setFriction(ChunkTuning.friction)
        .setRestitution(ChunkTuning.restitution)
        .setCollisionGroups(groups(CG.Debris, CG.World)),
      body,
    );
    c.body = body;
    c.size = size;
    c.bulk = own !== undefined && extent ? Math.max(extent.x, extent.y, extent.z) * 0.6 : box === undefined ? size : hx;
    c.born = this.ctx.time.elapsed;
    c.still = 0;
    c.restedAt = -1;
    c.speed = Math.hypot(vx, vy, vz);
    c.splats = 0;
    c.nextThud = 0;
    c.wob = 0;
    c.trailAt = 0;
    // An organ or a slab draws a ribbon behind it; a lump of meat or a rib fragment leaves strands.
    c.ribbon = this.trail && RIBBONED.has(kind) ? this.trail.open(c) : null;
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
    c.wob = 0;
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
    const own = this.cut.get(c.kind);
    if (own !== undefined) {
      this.cut.set(c.kind, own - 1);
      if (own <= 1 && this.drawn.has(c.kind)) mesh.visible = false;
    }
  }

  private write(c: Chunk, scale: number): void {
    const s = c.size * scale;
    // A landed organ wobbles: squashed and spread, then back, a few times over.
    const w = c.wob > 0 ? Math.sin(c.wob * 26) * c.wob * 0.28 : 0;
    _m.compose(c.p, c.q, _s.set(s * c.sx * (1 + w * 0.6), s * c.sy * (1 - w), s * c.sz * (1 + w * 0.6)));
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
      if (lost > t.impactSpeed * 0.5 && ORGAN_SET.has(c.kind)) c.wob = 1;
      if (c.wob > 0) c.wob = Math.max(0, c.wob - dt * 1.6);
      if (lost > t.impactSpeed && c.splats < 3 && c.kind !== 'scrap') {
        c.splats++;
        this.blood.stainBelow(c.p, 0.14 + c.bulk * 2.2, 'blood', 0.8);
      }
      // Meat drips as it flies and for a moment after, inside the blood budget's drops a frame.
      if (c.kind !== 'scrap' && c.kind !== 'bone' && now - c.born < GIB_DRIP_FOR && Math.random() < dt * GIB_DRIPS) {
        this.blood.drip(c.p, _o.copy(c.v).multiplyScalar(0.3), 0.8 + c.bulk * 8);
      }
      // The bigger pieces draw their arc in blood (trail.ts): what the eye follows out of a fireball.
      if (this.trail && speed > TrailTuning.minSpeed && now - c.born < TrailTuning.seconds) {
        if (c.ribbon) this.trail.feed(c.ribbon, c, c.p, c.v);
        else if (c.bulk >= TRAIL_BULK && c.kind !== 'scrap' && c.kind !== 'bone' && now >= c.trailAt && this.trail.leave(c.p, c.v, clamp(c.bulk * 9, 0.4, 1))) {
          c.trailAt = now + TrailTuning.strandEvery;
        }
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
      // The organs and the ribcage are what a gib is read by: they lie twice as long as torn meat.
      const age = now - c.restedAt - t.linger * (LASTING.has(c.kind) ? 2 : 1);
      if (age <= 0) continue;
      if (age >= t.shrink) this.retire(c);
      else this.write(c, 1 - age / t.shrink);
    }
  }

  get bodies(): number {
    return this.live.length;
  }

  /** Pieces of a kind in the world, moving or lying still. For checks. */
  aliveOf(kind: ChunkKind): number {
    let n = 0;
    for (const c of this.slots.get(kind) ?? []) if (c.alive) n++;
    return n;
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

