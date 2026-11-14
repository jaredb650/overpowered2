/**
 * Pieces of a structure that fly when it falls: a shack's boards, sheets, posts and roof, and lumps off a wall. Each is a real Rapier box
 * while it moves (it tumbles, piles on the others and gets thrown again by the next blast through Physics.radialImpulse), then gives
 * its body back and lies as a still instance until it shrinks away. Drawn as one instanced box per material, so a field of wreckage
 * is a handful of draw calls. Capped twice: bodies alive at once, and pieces per material (the oldest makes room). A blast near
 * wreckage that has come to rest throws it again (Physics.radialListeners), so a pile of boards can be blown about.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CG, type Ctx } from '../core/contracts';
import { groups } from '../physics/Physics';
import { Geo, type Mat } from './kit/geo';

export type DebrisMat = 'plywood' | 'rust' | 'steelDark' | 'concrete';
const MATS: readonly DebrisMat[] = ['plywood', 'rust', 'steelDark', 'concrete'];

export const DebrisTuning = {
  /** Bodies moving at once. Past this a new piece freezes the oldest moving one where it is. */
  maxBodies: 90,
  /** Pieces per material, moving or still. */
  capacity: 160,
  /** Seconds slow before a body is dropped, and the longest any piece flies. */
  settle: 0.6,
  maxFlight: 8,
  /** Seconds a still piece lies about, then how long it takes to shrink away. */
  linger: 16,
  shrink: 1.2,
  density: { plywood: 500, rust: 1400, steelDark: 2000, concrete: 2200 } as Record<DebrisMat, number>,
  restitution: 0.18,
  friction: 0.85,
};

interface Piece {
  mat: DebrisMat;
  slot: number;
  body: RAPIER.RigidBody | null;
  alive: boolean;
  born: number;
  still: number;
  restedAt: number;
  readonly half: THREE.Vector3;
  readonly p: THREE.Vector3;
  readonly q: THREE.Quaternion;
  readonly v: THREE.Vector3;
}

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _hide = new THREE.Matrix4().makeScale(0, 0, 0);
const _c = new THREE.Color();
const _v = new THREE.Vector3();

export class Debris {
  /** Its own group: the map adds it beside the structures' chunks. */
  readonly root = new THREE.Group();
  private readonly meshes = new Map<DebrisMat, THREE.InstancedMesh>();
  private readonly slots = new Map<DebrisMat, Piece[]>();
  private readonly ring = new Map<DebrisMat, number>();
  private readonly moving: Piece[] = [];
  private readonly all: Piece[] = [];
  private time = 0;
  private ready = false;

  constructor(private readonly ctx: Ctx, private readonly material: (m: Mat) => THREE.Material) {
    this.root.name = 'debris';
    ctx.physics.radialListeners?.add((c, r, s) => this.blast(c, r, s));
  }

  /** Throws again every resting piece in the blast, out from its middle and up, harder the nearer. */
  private blast(center: THREE.Vector3, radius: number, strength: number): void {
    if (!this.ready || strength <= 0) return;
    for (let i = 0; i < this.all.length; i++) {
      const c = this.all[i]!;
      if (!c.alive || c.body) continue;
      const d = c.p.distanceTo(center);
      if (d > radius) continue;
      const speed = Math.min(16, strength * 0.15 * (1 - d / radius));
      if (speed < 1) continue;
      _v.subVectors(c.p, center).setY(0).normalize().multiplyScalar(speed);
      _v.y = speed * (0.5 + Math.random() * 0.4);
      this.throw(c.mat, c.p, c.q, c.half, _v, 10, undefined, c);
    }
  }

  /** A unit box per material, with the map's uv and colour channels so the world's materials draw it as they draw a wall. */
  private ensure(): void {
    if (this.ready) return;
    this.ready = true;
    for (const mat of MATS) {
      const geo = new Geo();
      geo.use(mat).box(0, 0, 0, 0.5, 0.5, 0.5);
      const b = [...geo.buckets.values()][0]!;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(b.p.slice(0, b.nv * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(b.n.slice(0, b.nv * 3), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(b.uv.slice(0, b.nv * 2), 2));
      g.setAttribute('color', new THREE.BufferAttribute(b.c.slice(0, b.nv * 4), 4, true));
      g.setIndex(new THREE.BufferAttribute(b.idx.slice(0, b.ni), 1));
      const cap = DebrisTuning.capacity;
      const mesh = new THREE.InstancedMesh(g, this.material(mat), cap);
      mesh.name = `debris:${mat}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      for (let i = 0; i < cap; i++) {
        mesh.setMatrixAt(i, _hide);
        mesh.setColorAt(i, _c.setScalar(1));
      }
      // Nothing to draw until the first piece flies.
      mesh.visible = false;
      this.root.add(mesh);
      this.meshes.set(mat, mesh);
      this.ring.set(mat, 0);
      const slots: Piece[] = Array.from({ length: cap }, (_, slot) => ({
        mat, slot, body: null, alive: false, born: 0, still: 0, restedAt: -1,
        half: new THREE.Vector3(), p: new THREE.Vector3(), q: new THREE.Quaternion(), v: new THREE.Vector3(),
      }));
      this.slots.set(mat, slots);
      this.all.push(...slots);
    }
  }

  /** Throws one box of `half` extents from `pos`, turned `q`, at `vel`, spinning up to `spin` rad/s about each axis. */
  throw(mat: DebrisMat, pos: THREE.Vector3, q: THREE.Quaternion, half: THREE.Vector3, vel: THREE.Vector3, spin: number, tint?: number, again?: Piece): void {
    this.ensure();
    const { R, world } = this.ctx.physics;
    let c: Piece;
    if (again) c = again;
    else {
      const slots = this.slots.get(mat)!;
      const at = this.ring.get(mat)!;
      this.ring.set(mat, (at + 1) % slots.length);
      c = slots[at]!;
      if (c.alive) this.retire(c);
    }
    if (this.moving.length >= DebrisTuning.maxBodies) this.freeze(this.moving[0]!);
    // A thin board would slip through the floor's contact in one step at speed; it is thrown a little thicker than it looks.
    const hx = Math.max(half.x, 0.03), hy = Math.max(half.y, 0.03), hz = Math.max(half.z, 0.03);
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation(q)
        .setLinvel(vel.x, vel.y, vel.z)
        .setAngvel({ x: (Math.random() - 0.5) * spin, y: (Math.random() - 0.5) * spin, z: (Math.random() - 0.5) * spin })
        .setLinearDamping(0.05)
        .setAngularDamping(0.6),
    );
    world.createCollider(
      R.ColliderDesc.cuboid(hx, hy, hz)
        .setDensity(DebrisTuning.density[mat])
        .setFriction(DebrisTuning.friction)
        .setRestitution(DebrisTuning.restitution)
        .setCollisionGroups(groups(CG.Debris, CG.World | CG.Debris)),
      body,
    );
    c.body = body;
    c.alive = true;
    c.born = this.time;
    c.still = 0;
    c.restedAt = -1;
    c.half.copy(half);
    c.p.copy(pos);
    c.q.copy(q);
    this.moving.push(c);
    const mesh = this.meshes.get(mat)!;
    mesh.visible = true;
    if (tint !== undefined) {
      mesh.setColorAt(c.slot, _c.setScalar(tint));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.write(c, 1);
  }

  /** Gives a moving piece's body back; it stays where it lies. */
  private freeze(c: Piece): void {
    if (c.body) {
      c.body.translation(c.p);
      c.body.rotation(c.q);
      this.ctx.physics.world.removeRigidBody(c.body);
      c.body = null;
    }
    c.restedAt = this.time;
    const at = this.moving.indexOf(c);
    if (at >= 0) {
      this.moving[at] = this.moving[this.moving.length - 1]!;
      this.moving.pop();
    }
    this.write(c, 1);
  }

  private retire(c: Piece): void {
    if (c.body) this.freeze(c);
    c.alive = false;
    const mesh = this.meshes.get(c.mat)!;
    mesh.setMatrixAt(c.slot, _hide);
    mesh.instanceMatrix.needsUpdate = true;
  }

  private write(c: Piece, scale: number): void {
    _m.compose(c.p, c.q, _s.set(c.half.x * 2 * scale, c.half.y * 2 * scale, c.half.z * 2 * scale));
    const mesh = this.meshes.get(c.mat)!;
    mesh.setMatrixAt(c.slot, _m);
    mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    if (!this.ready) return;
    this.time += dt;
    const t = DebrisTuning;
    for (let i = this.moving.length - 1; i >= 0; i--) {
      const c = this.moving[i]!;
      const body = c.body!;
      body.translation(c.p);
      body.rotation(c.q);
      body.linvel(c.v);
      this.write(c, 1);
      if (c.v.lengthSq() < 0.09) c.still += dt;
      else c.still = 0;
      // Fallen off the world, or flying too long: let it go.
      if (c.p.y < -20) this.retire(c);
      else if (c.still > t.settle || this.time - c.born > t.maxFlight) this.freeze(c);
    }
    for (let i = 0; i < this.all.length; i++) {
      const c = this.all[i]!;
      if (!c.alive || c.restedAt < 0) continue;
      const age = this.time - c.restedAt - t.linger;
      if (age <= 0) continue;
      if (age >= t.shrink) this.retire(c);
      else this.write(c, 1 - age / t.shrink);
    }
  }

  /** Bodies in flight now. For checks and the perf readout. */
  get bodies(): number {
    return this.moving.length;
  }

  /** Pieces in the world, moving or still. */
  get pieces(): number {
    let n = 0;
    for (let i = 0; i < this.all.length; i++) if (this.all[i]!.alive) n++;
    return n;
  }

  clear(): void {
    if (!this.ready) return;
    for (const c of this.all) if (c.alive) this.retire(c);
  }
}
