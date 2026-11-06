/**
 * Loose pieces of a body: meat, viscera, bone and skull. Faceted and wet, drawn as instances so a dozen
 * gibbed enemies stay a handful of draw calls. They collide with the world only. Each has a real body while
 * it moves, then gives it back and stays as a still instance until its slot is needed.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CG, type Ctx } from '../core/contracts';
import { groups } from '../physics/Physics';
import { clamp, mulberry32 } from '../core/math';
import type { BloodField } from './blood';
import { ImpactTuning, type ImpactEvents } from './impacts';

export type ChunkKind = 'meat' | 'viscera' | 'bone' | 'skull' | 'brain' | 'scrap';

export const ChunkTuning = {
  /** Slots per kind. A new piece reclaims the oldest in that kind. */
  capacity: { meat: 96, viscera: 40, bone: 48, skull: 40, brain: 24, scrap: 48 } as Record<ChunkKind, number>,
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

/** Curved plate: a fragment of cranium, thin with a rough broken edge. */
function shard(seed: number): THREE.BufferGeometry {
  const g = lump(seed, 0, 0.5, 0xc9b49a, 0xf0e6d2);
  g.scale(1, 0.34, 0.8);
  g.computeVertexNormals();
  return g;
}

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _hide = new THREE.Matrix4().makeScale(0, 0, 0);

export class ChunkField {
  private readonly meshes = new Map<ChunkKind, THREE.InstancedMesh>();
  private readonly slots = new Map<ChunkKind, Chunk[]>();
  private readonly ring = new Map<ChunkKind, number>();
  private readonly live: Chunk[] = [];
  /** Every slot of every kind, so the per-frame sweep needs no iterators. */
  private readonly all: Chunk[] = [];
  private ready = false;
  private readonly impactDir = new THREE.Vector3();

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
        kind, slot, body: null, size: 0, sx: 1, sy: 1, sz: 1, born: 0, still: 0, restedAt: -1, speed: 0, splats: 0, nextThud: 0, alive: false,
        p: new THREE.Vector3(), q: new THREE.Quaternion(), v: new THREE.Vector3(),
      }));
      this.slots.set(kind, slots);
      this.all.push(...slots);
    };
    make('meat', lump(11, 1, 0.75, 0x4a0606, 0xc41a1a), wet(0.3, 0.7));
    make('viscera', lump(23, 1, 0.45, 0x7a1420, 0xd8455a, 1.5), wet(0.2, 1));
    make('bone', lump(5, 0, 0.55, 0xb9a98a, 0xeee4cd, 2.2), wet(0.55, 0.15));
    make('skull', shard(17), wet(0.5, 0.2));
    make('brain', lump(31, 1, 0.5, 0xa84a55, 0xe59aa0), wet(0.22, 1));
    make('scrap', shard(41), wet(0.4, 0));
  }

  /** Throws one piece. Oldest in its kind is reclaimed when the slots are full. */
  spawn(kind: ChunkKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): void {
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
        .setLinvel(vx, vy, vz)
        .setAngvel({ x: (Math.random() - 0.5) * 30, y: (Math.random() - 0.5) * 30, z: (Math.random() - 0.5) * 30 })
        .setLinearDamping(0.1)
        .setAngularDamping(0.9),
    );
    // Thin plates and long bones need a box. A sphere would roll forever.
    const hx = size * 0.72;
    world.createCollider(
      R.ColliderDesc.cuboid(hx, kind === 'skull' ? hx * 0.4 : hx, hx)
        .setDensity(1100)
        .setFriction(ChunkTuning.friction)
        .setRestitution(ChunkTuning.restitution)
        .setCollisionGroups(groups(CG.Debris, CG.World)),
      body,
    );
    c.body = body;
    c.size = size;
    c.sx = 0.75 + Math.random() * 0.5;
    c.sy = 0.75 + Math.random() * 0.5;
    c.sz = 0.75 + Math.random() * 0.5;
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
        this.blood.stainBelow(c.p, 0.14 + c.size * 2.2, 'blood', 0.8);
      }
      if (c.kind !== 'scrap') {
        const scale = clamp(c.size / ImpactTuning.organFullSize, ImpactTuning.organFloor, 1);
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

