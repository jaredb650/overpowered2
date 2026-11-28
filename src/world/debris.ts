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

export type DebrisMat = 'plywood' | 'rust' | 'steelDark' | 'concrete' | 'plaster' | 'glass' | 'dirt';
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
  density: { plywood: 500, rust: 1400, steelDark: 2000, concrete: 2200, plaster: 900, glass: 2500, dirt: 1500 } as Record<DebrisMat, number>,
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
  restingIndex: number;
  r: number;
  g: number;
  b: number;
  readonly half: THREE.Vector3;
  readonly p: THREE.Vector3;
  readonly q: THREE.Quaternion;
  readonly v: THREE.Vector3;
}

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _v = new THREE.Vector3();

export class Debris {
  /** Its own group: the map adds it beside the structures' chunks. */
  readonly root = new THREE.Group();
  private readonly meshes = new Map<DebrisMat, THREE.InstancedMesh>();
  private readonly active = new Map<DebrisMat, Piece[]>();
  private readonly free = new Map<DebrisMat, Piece[]>();
  private readonly dirtyMin = new Map<DebrisMat, number>();
  private readonly dirtyMax = new Map<DebrisMat, number>();
  private readonly colorDirty = new Map<DebrisMat, boolean>();
  private readonly moving: Piece[] = [];
  private readonly resting: Piece[] = [];
  private readonly all: Piece[] = [];
  private time = 0;
  private ready = false;

  /** `mats` are the materials this pool throws; the walls' own four by default. */
  constructor(private readonly ctx: Ctx, private readonly material: (m: Mat) => THREE.Material, private readonly mats: readonly DebrisMat[] = MATS) {
    this.root.name = 'debris';
    this.root.matrixAutoUpdate = false;
    this.root.updateMatrix();
    ctx.physics.radialListeners?.add((c, r, s) => this.blast(c, r, s));
  }

  /** Pre-builds instanced meshes during world load so the first explosion doesn't stall on allocation/compile. */
  warm(): void {
    this.ensure();
  }

  /** Throws again every resting piece in the blast, out from its middle and up, harder the nearer. */
  private blast(center: THREE.Vector3, radius: number, strength: number): void {
    if (!this.ready || strength <= 0 || this.resting.length === 0) return;
    const rSq = radius * radius;
    for (let i = this.resting.length - 1; i >= 0; i--) {
      const c = this.resting[i]!;
      const dSq = c.p.distanceToSquared(center);
      if (dSq > rSq) continue;
      const d = Math.sqrt(dSq);
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
    for (const mat of this.mats) {
      const geo = new Geo();
      geo.use(mat).box(0, 0, 0, 0.5, 0.5, 0.5);
      const b = [...geo.buckets.values()][0]!;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(b.p.slice(0, b.nv * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(b.n.slice(0, b.nv * 3), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(b.uv.slice(0, b.nv * 2), 2));
      g.setAttribute('color', new THREE.BufferAttribute(b.c.slice(0, b.nv * 4), 4, true));
      g.setIndex(new THREE.BufferAttribute(b.nv <= 65535 ? new Uint16Array(b.idx.subarray(0, b.ni)) : b.idx.slice(0, b.ni), 1));
      const cap = DebrisTuning.capacity;
      const mesh = new THREE.InstancedMesh(g, this.material(mat), cap);
      mesh.name = `debris:${mat}`;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.userData.dynamicShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = mat !== 'glass';
      mesh.receiveShadow = true;
      for (let i = 0; i < cap; i++) {
        mesh.setColorAt(i, _c.setScalar(1));
      }
      mesh.count = 0;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // Nothing to draw until the first piece flies.
      mesh.visible = false;
      this.root.add(mesh);
      this.meshes.set(mat, mesh);
      this.dirtyMin.set(mat, cap);
      this.dirtyMax.set(mat, -1);
      this.colorDirty.set(mat, false);
      const pool: Piece[] = Array.from({ length: cap }, () => ({
        mat, slot: -1, body: null, alive: false, born: 0, still: 0, restedAt: -1, restingIndex: -1,
        r: 1, g: 1, b: 1,
        half: new THREE.Vector3(), p: new THREE.Vector3(), q: new THREE.Quaternion(), v: new THREE.Vector3(),
      }));
      this.active.set(mat, []);
      this.free.set(mat, pool);
      this.all.push(...pool);
    }
  }

  private removeResting(c: Piece): void {
    const idx = c.restingIndex;
    if (idx < 0) return;
    const last = this.resting.pop()!;
    if (idx < this.resting.length) {
      this.resting[idx] = last;
      last.restingIndex = idx;
    }
    c.restingIndex = -1;
  }

  private markDirty(mat: DebrisMat, slot: number): void {
    const lo = this.dirtyMin.get(mat)!;
    const hi = this.dirtyMax.get(mat)!;
    if (slot < lo) this.dirtyMin.set(mat, slot);
    if (slot > hi) this.dirtyMax.set(mat, slot);
  }

  private flushDirty(): void {
    for (const [mat, mesh] of this.meshes) {
      const count = mesh.count;
      const hi = Math.min(this.dirtyMax.get(mat)!, count - 1);
      const lo = this.dirtyMin.get(mat)!;
      if (hi >= 0 && lo <= hi) {
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(lo * 16, (hi - lo + 1) * 16);
        mesh.instanceMatrix.needsUpdate = true;
      }
      this.dirtyMin.set(mat, DebrisTuning.capacity);
      this.dirtyMax.set(mat, -1);
      if (this.colorDirty.get(mat)) {
        this.colorDirty.set(mat, false);
        if (mesh.instanceColor && count > 0) {
          mesh.instanceColor.clearUpdateRanges();
          mesh.instanceColor.addUpdateRange(0, count * 3);
          mesh.instanceColor.needsUpdate = true;
        }
      }
    }
  }

  /** Throws one box of `half` extents from `pos`, turned `q`, at `vel`, spinning up to `spin` rad/s about each axis. */
  throw(mat: DebrisMat, pos: THREE.Vector3, q: THREE.Quaternion, half: THREE.Vector3, vel: THREE.Vector3, spin: number, tint?: number | readonly [number, number, number], again?: Piece): void {
    this.ensure();
    const { R, world } = this.ctx.physics;
    const mesh = this.meshes.get(mat)!;
    const active = this.active.get(mat)!;
    const free = this.free.get(mat)!;
    let c: Piece;
    if (again) {
      c = again;
      this.removeResting(c);
    } else {
      if (free.length === 0) {
        // Evict the oldest live piece of this material.
        let oldest = active[0]!;
        for (let i = 1; i < active.length; i++) {
          if (active[i]!.born < oldest.born) oldest = active[i]!;
        }
        this.retire(oldest);
      }
      c = free.pop()!;
      c.slot = active.length;
      active.push(c);
      mesh.count = active.length;
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
    mesh.visible = true;
    if (tint !== undefined) {
      if (typeof tint === 'number') { c.r = tint; c.g = tint; c.b = tint; }
      else { c.r = tint[0]; c.g = tint[1]; c.b = tint[2]; }
      mesh.setColorAt(c.slot, _c.setRGB(c.r, c.g, c.b));
      this.colorDirty.set(mat, true);
    } else if (!again) {
      c.r = 1; c.g = 1; c.b = 1;
      mesh.setColorAt(c.slot, _c.setScalar(1));
      this.colorDirty.set(mat, true);
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
    if (c.alive && c.restingIndex < 0) {
      c.restingIndex = this.resting.length;
      this.resting.push(c);
    }
    this.write(c, 1);
  }

  private retire(c: Piece): void {
    if (!c.alive) return;
    if (c.body) {
      this.ctx.physics.world.removeRigidBody(c.body);
      c.body = null;
      const at = this.moving.indexOf(c);
      if (at >= 0) {
        this.moving[at] = this.moving[this.moving.length - 1]!;
        this.moving.pop();
      }
    }
    this.removeResting(c);
    c.alive = false;
    c.restedAt = -1;

    const mesh = this.meshes.get(c.mat)!;
    const active = this.active.get(c.mat)!;
    const free = this.free.get(c.mat)!;
    const slot = c.slot;
    const last = active.pop()!;
    if (last !== c && slot >= 0 && slot < active.length) {
      active[slot] = last;
      last.slot = slot;
      // Copy last's instance matrix & color into the vacated slot.
      const matArr = mesh.instanceMatrix.array as Float32Array;
      matArr.copyWithin(slot * 16, active.length * 16, (active.length + 1) * 16);
      mesh.setColorAt(slot, _c.setRGB(last.r, last.g, last.b));
      this.markDirty(c.mat, slot);
      this.colorDirty.set(c.mat, true);
    }
    c.slot = -1;
    free.push(c);
    mesh.count = active.length;
    if (active.length === 0) mesh.visible = false;
  }

  private write(c: Piece, scale: number): void {
    _m.compose(c.p, c.q, _s.set(c.half.x * 2 * scale, c.half.y * 2 * scale, c.half.z * 2 * scale));
    const mesh = this.meshes.get(c.mat)!;
    mesh.setMatrixAt(c.slot, _m);
    this.markDirty(c.mat, c.slot);
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
    for (let i = this.resting.length - 1; i >= 0; i--) {
      const c = this.resting[i]!;
      const age = this.time - c.restedAt - t.linger;
      if (age <= 0) continue;
      if (age >= t.shrink) this.retire(c);
      else this.write(c, 1 - age / t.shrink);
    }
    this.flushDirty();
  }

  /** Bodies in flight now. For checks and the perf readout. */
  get bodies(): number {
    return this.moving.length;
  }

  /** Pieces in the world, moving or still. */
  get pieces(): number {
    return this.moving.length + this.resting.length;
  }

  clear(): void {
    if (!this.ready) return;
    for (const c of this.all) if (c.alive) this.retire(c);
    this.flushDirty();
  }
}
