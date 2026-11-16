/**
 * Guts: short verlet chains drawn together as one wet tube mesh, updated in place. A strand is thrown loose from a gib
 * and drapes, swings and slides on the floor, or hangs from a bone (a man opened at the belly, a top half cut at the
 * waist) and drags behind him as he crawls. No rigid bodies: each strand finds the floor under it a few times a second.
 *
 * Fixed pool: `RopeTuning.max` strands, the oldest given back first. A loose one lies `linger` seconds and shrinks away;
 * a hanging one lasts as long as the body it hangs from is in the scene.
 */
import * as THREE from 'three';
import { CG, type Ctx, type RayHit } from '../core/contracts';
import { clamp, mulberry32 } from '../core/math';
import type { BloodField } from './blood';

export const RopeTuning = {
  max: 14,
  points: 11,
  /** Metres between points on a 1.85 m body: a strand about 1.2 m long. */
  segment: 0.115,
  radius: 0.027,
  gravity: 14,
  iterations: 6,
  /** Velocity kept a step in the air, and the share of its sideways motion a point on the floor keeps. */
  damping: 0.99,
  floorKeep: 0.35,
  /** Seconds a loose strand lies, then shrinks away over `shrink`. */
  linger: 14,
  shrink: 1,
  /** Seconds between looks for the floor, and metres a strand's end drags between drops of blood. */
  groundEvery: 0.25,
  trailEvery: 0.3,
  /** Seconds it bleeds as it moves. */
  trailFor: 8,
  /** A hanging loop's length against a strand's, and how far it sways, in metres a second squared at its bottom. */
  loopSlack: 1.25,
  sway: 0.6,
};

const RADIAL = 7;
/** Two rings a point: one full, one pinched between, so it reads as bowel and not as a hose. */
const RINGS = RopeTuning.points * 2 - 1;
const VERTS = RINGS * RADIAL;

class Rope {
  alive = false;
  born = 0;
  /** World time it stopped moving for good, or -1. */
  restAt = -1;
  serial = 0;
  readonly x = new Float32Array(RopeTuning.points * 3);
  readonly px = new Float32Array(RopeTuning.points * 3);
  target: THREE.Object3D | null = null;
  readonly offset = new THREE.Vector3();
  /** Both ends held: a loop of gut hanging out of a wound, not a strand with a free end. */
  looped = false;
  readonly endOffset = new THREE.Vector3();
  /** The body's root. A hanging strand goes when that leaves the scene. */
  owner: THREE.Object3D | null = null;
  floor = -1e4;
  nextGround = 0;
  segment = RopeTuning.segment;
  thick = 1;
  trail = 0;
  still = 0;
  readonly last = new THREE.Vector3();
}

const _a = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };

export class RopeField {
  private readonly ropes: Rope[] = Array.from({ length: RopeTuning.max }, () => new Rope());
  private serial = 0;
  private mesh: THREE.Mesh | null = null;
  private pos: Float32Array | null = null;
  private nor: Float32Array | null = null;

  constructor(private readonly ctx: Ctx, private readonly blood: BloodField) {}

  /** Builds the one mesh. At load, so the first gib does not compile a program. */
  ensure(): void {
    if (this.mesh) return;
    const n = RopeTuning.max * VERTS;
    const pos = (this.pos = new Float32Array(n * 3));
    const nor = (this.nor = new Float32Array(n * 3));
    const col = new Float32Array(n * 3);
    const index: number[] = [];
    const pale = new THREE.Color(0xc98078);
    const dark = new THREE.Color(0x7a2a38);
    const blood = new THREE.Color(0x5a080c);
    const c = new THREE.Color();
    for (let r = 0; r < RopeTuning.max; r++) {
      const rnd = mulberry32(17 + r * 31);
      const base = r * VERTS;
      for (let i = 0; i < RINGS; i++) {
        for (let j = 0; j < RADIAL; j++) {
          const v = base + i * RADIAL + j;
          // Pinched rings darker, and a stripe of blood down one side that wanders round it.
          c.copy(pale).lerp(dark, i % 2 === 1 ? 0.55 : rnd() * 0.25);
          if (Math.abs(((j + i * 0.3) % RADIAL) - 2) < 1.8 && rnd() < 0.85) c.lerp(blood, 0.5 + rnd() * 0.35);
          col[v * 3] = c.r;
          col[v * 3 + 1] = c.g;
          col[v * 3 + 2] = c.b;
          if (i === RINGS - 1) continue;
          const k = (j + 1) % RADIAL;
          const a = base + i * RADIAL + j, b = base + i * RADIAL + k, d = base + (i + 1) * RADIAL + k, e = base + (i + 1) * RADIAL + j;
          index.push(a, b, e, b, d, e);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(index);
    const { render } = this.ctx;
    const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.15, side: THREE.DoubleSide });
    const mat = render.materials?.patch ? render.materials.patch(m) ?? m : m;
    const mesh = (this.mesh = new THREE.Mesh(g, mat));
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'gore.guts';
    render.scene.add(mesh);
  }

  private take(scale: number): Rope {
    let r = this.ropes.find(o => !o.alive);
    if (!r) {
      r = this.ropes[0]!;
      for (const o of this.ropes) if (o.serial < r.serial) r = o;
    }
    r.alive = true;
    r.serial = ++this.serial;
    r.born = this.ctx.time.elapsed;
    r.restAt = -1;
    r.target = null;
    r.owner = null;
    r.looped = false;
    r.nextGround = 0;
    r.floor = -1e4;
    r.segment = RopeTuning.segment * scale;
    r.thick = scale;
    r.trail = 0;
    r.still = 0;
    return r;
  }

  /** A loose strand, coiled at `at` and thrown at `v` m/s. */
  spill(at: THREE.Vector3, v: THREE.Vector3, scale = 1, seed = 1): void {
    this.ensure();
    const r = this.take(scale);
    const rnd = mulberry32(seed);
    const dt = 1 / 60;
    let a = rnd() * 6.28;
    for (let i = 0; i < RopeTuning.points; i++) {
      // A loose coil, so it unrolls as it flies.
      a += 1.1 + rnd() * 0.5;
      const rad = r.segment * 0.9;
      const x = at.x + Math.cos(a) * rad, y = at.y + (rnd() - 0.5) * r.segment, z = at.z + Math.sin(a) * rad;
      const s = 0.75 + rnd() * 0.5;
      r.x[i * 3] = x;
      r.x[i * 3 + 1] = y;
      r.x[i * 3 + 2] = z;
      r.px[i * 3] = x - v.x * s * dt;
      r.px[i * 3 + 1] = y - v.y * s * dt;
      r.px[i * 3 + 2] = z - v.z * s * dt;
    }
    r.last.copy(at);
  }

  /**
   * A strand hanging from `target`, at `offset` in its frame, for as long as `owner` is in the scene. With `endOffset` its
   * other end is held there too, and it hangs as a loop.
   */
  hang(target: THREE.Object3D, offset: THREE.Vector3, owner: THREE.Object3D, scale = 1, endOffset?: THREE.Vector3): void {
    this.ensure();
    const r = this.take(scale);
    r.target = target;
    r.owner = owner;
    r.offset.copy(offset);
    r.looped = endOffset !== undefined;
    if (endOffset) {
      r.endOffset.copy(endOffset);
      // A loop has slack to spare: it sags low and heavy between its two ends instead of hanging as two straight strands.
      r.segment *= RopeTuning.loopSlack;
      r.thick *= 1.15;
    }
    target.updateWorldMatrix(true, false);
    _a.copy(offset).applyMatrix4(target.matrixWorld);
    const P = RopeTuning.points;
    for (let i = 0; i < P; i++) {
      // Out of the wound and down, the way it falls; a loop comes back up to where it went in.
      const k = (r.looped ? Math.min(i, P - 1 - i) : i) * r.segment;
      r.x[i * 3] = r.px[i * 3] = _a.x + Math.sin(i * 0.9) * 0.03;
      r.x[i * 3 + 1] = r.px[i * 3 + 1] = _a.y - k * 0.8;
      r.x[i * 3 + 2] = r.px[i * 3 + 2] = _a.z + k * 0.3;
    }
    r.last.copy(_a);
  }

  /** Strands hanging from this body. */
  hangingFrom(owner: THREE.Object3D): number {
    let n = 0;
    for (const r of this.ropes) if (r.alive && r.owner === owner) n++;
    return n;
  }

  /** Lets go of every strand hanging from this body: they fall where they are. */
  drop(owner: THREE.Object3D): void {
    for (const r of this.ropes) {
      if (!r.alive || r.owner !== owner) continue;
      r.owner = null;
      r.target = null;
      r.born = this.ctx.time.elapsed;
    }
  }

  get live(): number {
    let n = 0;
    for (const r of this.ropes) if (r.alive) n++;
    return n;
  }

  /** World position of point `i` of the strand hanging from `owner`, for checks. */
  pointOf(owner: THREE.Object3D, i: number, out: THREE.Vector3): THREE.Vector3 | null {
    const r = this.ropes.find(o => o.alive && o.owner === owner);
    return r ? out.set(r.x[i * 3]!, r.x[i * 3 + 1]!, r.x[i * 3 + 2]!) : null;
  }

  update(dt: number): void {
    if (!this.mesh || dt <= 0) return;
    const now = this.ctx.time.elapsed;
    const t = RopeTuning;
    const h = Math.min(dt, 1 / 30);
    const P = t.points;
    for (const r of this.ropes) {
      if (!r.alive) continue;
      if (r.owner && r.owner.parent === null) {
        // The body has gone (sunk, released, pooled): its strand goes with it.
        r.alive = false;
        continue;
      }
      const loose = r.target === null;
      const age = now - r.born;
      if (loose && age > t.linger + t.shrink) {
        r.alive = false;
        continue;
      }
      if (now >= r.nextGround) {
        r.nextGround = now + t.groundEvery;
        const m = (P >> 1) * 3;
        _p.set(r.x[m]!, r.x[m + 1]! + 0.6, r.x[m + 2]!);
        if (this.ctx.physics.raycastInto(_p, _down, 4, CG.World, _hit)) r.floor = _hit.point.y;
      }
      if (r.restAt >= 0) continue;
      const x = r.x, px = r.px;
      const g = t.gravity * h * h;
      // Something hanging off a body never hangs dead still: a slow sway, strongest at the bottom of the loop.
      const swayX = r.target ? Math.sin(now * 1.3 + r.serial * 1.7) * t.sway * h * h : 0;
      const swayZ = r.target ? Math.cos(now * 0.9 + r.serial) * t.sway * 0.6 * h * h : 0;
      const floor = r.floor + t.radius * r.thick;
      let motion = 0;
      for (let i = 0; i < P; i++) {
        const o = i * 3;
        const vx = (x[o]! - px[o]!) * t.damping, vy = (x[o + 1]! - px[o + 1]!) * t.damping, vz = (x[o + 2]! - px[o + 2]!) * t.damping;
        px[o] = x[o]!;
        px[o + 1] = x[o + 1]!;
        px[o + 2] = x[o + 2]!;
        const reach = r.looped ? Math.sin((i / (P - 1)) * Math.PI) : i / (P - 1);
        x[o] = x[o]! + vx + swayX * reach;
        x[o + 1] = x[o + 1]! + vy - g;
        x[o + 2] = x[o + 2]! + vz + swayZ * reach;
        motion += Math.abs(vx) + Math.abs(vy) + Math.abs(vz);
      }
      if (r.target) {
        r.target.updateWorldMatrix(true, false);
        _a.copy(r.offset).applyMatrix4(r.target.matrixWorld);
        x[0] = _a.x;
        x[1] = _a.y;
        x[2] = _a.z;
      }
      const e0 = (P - 1) * 3;
      const pinEnd = () => {
        _a.copy(r.endOffset).applyMatrix4(r.target!.matrixWorld);
        x[e0] = _a.x;
        x[e0 + 1] = _a.y;
        x[e0 + 2] = _a.z;
      };
      if (r.looped && r.target) pinEnd();
      for (let it = 0; it < t.iterations; it++) {
        for (let i = 0; i < P - 1; i++) {
          const a = i * 3, b = a + 3;
          const dx = x[b]! - x[a]!, dy = x[b + 1]! - x[a + 1]!, dz = x[b + 2]! - x[a + 2]!;
          const d = Math.hypot(dx, dy, dz) || 1e-6;
          const diff = (d - r.segment) / d;
          // The anchored end does not move: all of the correction goes on the next point.
          const held = r.target !== null;
          const wa = i === 0 && held ? 0 : i === P - 2 && held && r.looped ? 1 : 0.5;
          const wb = i === 0 && held ? 1 : i === P - 2 && held && r.looped ? 0 : 0.5;
          x[a] = x[a]! + dx * diff * wa;
          x[a + 1] = x[a + 1]! + dy * diff * wa;
          x[a + 2] = x[a + 2]! + dz * diff * wa;
          x[b] = x[b]! - dx * diff * wb;
          x[b + 1] = x[b + 1]! - dy * diff * wb;
          x[b + 2] = x[b + 2]! - dz * diff * wb;
        }
        for (let i = 0; i < P; i++) {
          const o = i * 3;
          if (x[o + 1]! >= floor) continue;
          x[o + 1] = floor;
          // On the floor it slides and drags, it does not skate.
          px[o + 1] = Math.min(px[o + 1]!, floor);
          px[o] = x[o]! + (px[o]! - x[o]!) * t.floorKeep;
          px[o + 2] = x[o + 2]! + (px[o + 2]! - x[o + 2]!) * t.floorKeep;
        }
      }
      if (r.looped && r.target) pinEnd();
      // The free end (a loop's bottom) paints the floor it is dragged over.
      const e = (r.looped ? P >> 1 : P - 1) * 3;
      _p.set(x[e]!, x[e + 1]!, x[e + 2]!);
      r.trail += _p.distanceTo(r.last);
      r.last.copy(_p);
      if (r.trail > t.trailEvery && age < t.trailFor) {
        r.trail = 0;
        this.blood.droplet(_p.x, _p.y + 0.03, _p.z, 0, -1, 0, 0.07 * r.thick);
      }
      // A loose strand that has stopped is left where it lies.
      if (loose) {
        r.still = motion < 0.002 * P ? r.still + h : 0;
        if (r.still > 0.6) r.restAt = now;
      }
    }
    this.draw(now);
  }

  private draw(now: number): void {
    const pos = this.pos!, nor = this.nor!;
    const t = RopeTuning;
    const P = t.points;
    for (let k = 0; k < this.ropes.length; k++) {
      const r = this.ropes[k]!;
      const base = k * VERTS * 3;
      if (!r.alive) {
        pos.fill(0, base, base + VERTS * 3);
        continue;
      }
      const loose = r.target === null;
      const fade = loose ? 1 - clamp((now - r.born - t.linger) / t.shrink) : 1;
      const x = r.x;
      // Parallel transport keeps each ring turned like the one before it, so the tube does not twist.
      _n.set(0, 0, 0);
      for (let i = 0; i < RINGS; i++) {
        const j = i >> 1;
        const mid = i % 2 === 1;
        const o = j * 3;
        if (mid) {
          _p.set((x[o]! + x[o + 3]!) * 0.5, (x[o + 1]! + x[o + 4]!) * 0.5, (x[o + 2]! + x[o + 5]!) * 0.5);
          _t.set(x[o + 3]! - x[o]!, x[o + 4]! - x[o + 1]!, x[o + 5]! - x[o + 2]!);
        } else {
          _p.set(x[o]!, x[o + 1]!, x[o + 2]!);
          const a = Math.max(0, j - 1) * 3, b = Math.min(P - 1, j + 1) * 3;
          _t.set(x[b]! - x[a]!, x[b + 1]! - x[a + 1]!, x[b + 2]! - x[a + 2]!);
        }
        _t.normalize();
        if (_n.lengthSq() < 0.5) {
          _n.set(_t.y, -_t.x, 0);
          if (_n.lengthSq() < 1e-4) _n.set(1, 0, 0);
        }
        _n.addScaledVector(_t, -_n.dot(_t)).normalize();
        _b.crossVectors(_t, _n);
        // Pinched between points; a loose strand's ends taper shut.
        const end = loose ? Math.min(1, Math.min(i, RINGS - 1 - i) / 2 + 0.35) : Math.min(1, (RINGS - 1 - i) / 2 + 0.35);
        const swell = mid ? 0.62 : 0.88 + 0.3 * Math.abs(Math.sin(j * 2.3 + k));
        const radius = t.radius * r.thick * fade * (r.looped ? 1 : end) * swell;
        for (let q = 0; q < RADIAL; q++) {
          const ang = (q / RADIAL) * Math.PI * 2;
          const c = Math.cos(ang), s = Math.sin(ang);
          const v = base + (i * RADIAL + q) * 3;
          const nx = _n.x * c + _b.x * s, ny = _n.y * c + _b.y * s, nz = _n.z * c + _b.z * s;
          pos[v] = _p.x + nx * radius;
          pos[v + 1] = _p.y + ny * radius;
          pos[v + 2] = _p.z + nz * radius;
          nor[v] = nx;
          nor[v + 1] = ny;
          nor[v + 2] = nz;
        }
      }
    }
    const g = this.mesh!.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('normal').needsUpdate = true;
  }

  clear(): void {
    for (const r of this.ropes) r.alive = false;
    if (this.mesh) this.draw(0);
  }
}
