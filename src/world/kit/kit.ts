/**
 * Architecture kit: walls, floors, stairs, ramps, catwalks, beams, railings and light fixtures, each producing
 * merged geometry and a clean collider in one call. All pieces work in the current frame (`push`/`pop`).
 *
 * Convention: a wall or path from A to B has its front on the right of travel (local +Z when heading +X).
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { mulberry32 } from '../../core/math';
import { CG, type BakedLight, type PhysicsSystem, type SurfaceKind } from '../../core/contracts';
import { FACE, Geo, type Mat } from './geo';
import { Voxels } from './voxels';

export const surfaceOf = (m: Mat): SurfaceKind => {
  switch (m) {
    case 'steel': case 'steelDark': case 'rust': case 'hazard': case 'paintRed': case 'paintYellow': case 'paintWhite':
      return 'metal';
    case 'grate': return 'grate';
    case 'dirt': return 'dirt';
    case 'glass': return 'glass';
    default: return 'concrete';
  }
};

export interface Opening {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  /** Steel surround and lit jambs. */
  frame?: boolean;
}

export interface WallOpts {
  thick?: number;
  mat?: Mat;
  backing?: Mat;
  trim?: Mat;
  bay?: number;
  lift?: number;
  openings?: Opening[];
  plinth?: boolean;
  cap?: boolean;
  pilasters?: boolean;
  /** Continuous emissive line at this height. */
  strip?: { mat: Mat; y: number; h?: number };
  /** Precast panels on the back face as well. */
  back?: boolean;
  /** Skip panels and pilasters on the front. */
  plain?: boolean;
  collide?: boolean;
  surface?: SurfaceKind;
}

export type LampColor = 'cyan' | 'white' | 'orange' | 'magenta' | 'red';
const LAMP: Record<LampColor, { mat: Mat; rgb: number }> = {
  cyan: { mat: 'emissiveCyan', rgb: 0x59d8ff },
  white: { mat: 'emissiveWhite', rgb: 0xcfe2ff },
  orange: { mat: 'emissiveOrange', rgb: 0xff7a26 },
  magenta: { mat: 'emissiveMagenta', rgb: 0xe24bff },
  red: { mat: 'emissiveRed', rgb: 0xff2a24 },
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _c = new THREE.Vector3();
const _h = new THREE.Vector3();
/** Rapier group word for invisible containment: world to every body and query, except a query from the air (CG.Air). */
const CONTAINMENT = ((CG.World << 16) | (0xffff & ~CG.Air)) >>> 0;

export class Kit {
  readonly geo = new Geo();
  readonly vox = new Voxels();
  readonly lights: BakedLight[] = [];
  readonly rng = mulberry32(0xc0ffee);
  colliders = 0;
  /** While set, every collider made is "no climb". Set it with `noClimb`. */
  private climbless = false;

  constructor(readonly physics: PhysicsSystem) {}

  rand(lo = 0, hi = 1): number {
    return lo + this.rng() * (hi - lo);
  }

  push(x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0): void {
    this.geo.push(x, y, z, yaw, pitch, roll);
  }
  pop(): void {
    this.geo.pop();
  }

  /** Runs `fn` in a frame whose local +X points from (ax, az) toward (bx, bz). Returns the length. */
  along(ax: number, ay: number, az: number, bx: number, by: number, bz: number, fn: (len: number) => void): void {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const flat = Math.hypot(dx, dz);
    this.push(ax, ay, az, Math.atan2(-dz, dx), Math.atan2(dy, flat));
    fn(Math.hypot(flat, dy));
    this.pop();
  }

  // ---- collision ---------------------------------------------------------------------------------------------

  /** Every collider `fn` makes, by any builder, refuses the player's wall climb: for a face a level needs out of one jump's reach. */
  noClimb(fn: () => void): void {
    const was = this.climbless;
    this.climbless = true;
    try {
      fn();
    } finally {
      this.climbless = was;
    }
  }

  /** Box collider in the current frame. `vox` false keeps it out of AO and light occlusion (gratings). */
  collide(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, surface: SurfaceKind = 'concrete', vox = true): RAPIER.Collider {
    const m = this.geo.m;
    _c.set(
      m[0]! * cx + m[1]! * cy + m[2]! * cz + m[3]!,
      m[4]! * cx + m[5]! * cy + m[6]! * cz + m[7]!,
      m[8]! * cx + m[9]! * cy + m[10]! * cz + m[11]!,
    );
    _h.set(hx, hy, hz);
    const identity = m[0] === 1 && m[5] === 1 && m[10] === 1;
    if (!identity) {
      _m.set(m[0]!, m[1]!, m[2]!, 0, m[4]!, m[5]!, m[6]!, 0, m[8]!, m[9]!, m[10]!, 0, 0, 0, 0, 1);
      _q.setFromRotationMatrix(_m);
    }
    const c = this.physics.addStaticBox(_c, _h, identity ? null : _q, surface);
    if (this.climbless) this.physics.markNoClimb(c);
    this.colliders++;
    if (vox) this.vox.fillBox(m, cx, cy, cz, hx, hy, hz);
    return c;
  }

  /**
   * Invisible containment, the box that keeps a rocket jump on the map. It stops everything a wall stops, but fire from
   * an aircraft outside the map passes it: a gunship's rounds would otherwise burst on its outer face in mid-air.
   */
  containment(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): void {
    this.collide(cx, cy, cz, hx, hy, hz, 'concrete', false).setCollisionGroups(CONTAINMENT);
  }

  collideMesh(vertices: Float32Array, indices: Uint32Array, surface: SurfaceKind, vox = true): void {
    const c = this.physics.addStaticMesh(vertices, indices, surface);
    if (this.climbless) this.physics.markNoClimb(c);
    this.colliders++;
    if (vox) this.vox.fillTriangles(vertices, indices);
  }

  /** Upright prism collider, so curved walls stay smooth to run on. World space. */
  collidePrism(x: number, z: number, y0: number, y1: number, r: number, sides: number, surface: SurfaceKind, vox = true): void {
    const v = new Float32Array((sides * 2 + 2) * 3);
    const idx: number[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      v.set([px, y0, pz], i * 6);
      v.set([px, y1, pz], i * 6 + 3);
      const j = (i + 1) % sides;
      idx.push(i * 2, i * 2 + 1, j * 2, j * 2, i * 2 + 1, j * 2 + 1);
    }
    const top = sides * 2, bottom = top + 1;
    v.set([x, y1, z], top * 3);
    v.set([x, y0, z], bottom * 3);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      idx.push(top, j * 2 + 1, i * 2 + 1, bottom, i * 2, j * 2);
    }
    this.physics.addStaticMesh(v, new Uint32Array(idx), surface);
    this.colliders++;
    if (vox) this.vox.fillCylinder(x, z, y0, y1, r);
  }

  // ---- blocks ------------------------------------------------------------------------------------------------

  /** Decorative bevelled box from min and max corners, no collider. */
  deco(mat: Mat, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, bev = 0.05): void {
    this.geo.use(mat).bevel((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, bev);
  }

  /** Bevelled box with a matching collider. */
  block(mat: Mat, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, bev = 0.06, surface?: SurfaceKind): void {
    this.deco(mat, x0, y0, z0, x1, y1, z1, bev);
    this.collide((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, surface ?? surfaceOf(mat));
  }

  /** Big tessellated block, for slabs that need vertices to carry AO. */
  mass(mat: Mat, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, step = 3, collide = true, faces: number = FACE.all): void {
    this.geo.use(mat).slab((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, step, faces);
    if (collide) this.collide((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, surfaceOf(mat));
  }

  /** Flat walkable slab with a tessellated top. */
  floor(mat: Mat, x0: number, z0: number, x1: number, z1: number, y: number, thick = 0.6, step = 3, surface?: SurfaceKind): void {
    const g = this.geo.use(mat);
    g.slab((x0 + x1) / 2, y - thick / 2, (z0 + z1) / 2, (x1 - x0) / 2, thick / 2, (z1 - z0) / 2, step, FACE.all);
    this.collide((x0 + x1) / 2, y - thick / 2, (z0 + z1) / 2, (x1 - x0) / 2, thick / 2, (z1 - z0) / 2, surface ?? surfaceOf(mat));
  }

  // ---- walls -------------------------------------------------------------------------------------------------

  wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, opts: WallOpts = {}): void {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    this.push(ax, 0, az, Math.atan2(-dz, dx));
    this.wallLocal(len, y0, y1, opts);
    this.pop();
  }

  /** A wall along local +X from 0 to `len`. */
  wallLocal(len: number, y0: number, y1: number, o: WallOpts): void {
    const t = (o.thick ?? 1) / 2;
    const openings = [...(o.openings ?? [])].sort((a, b) => a.u0 - b.u0);
    const rects: [number, number, number, number][] = [];
    let u = 0;
    for (const op of openings) {
      if (op.u0 > u) rects.push([u, op.u0, y0, y1]);
      if (op.v0 > y0) rects.push([op.u0, op.u1, y0, op.v0]);
      if (op.v1 < y1) rects.push([op.u0, op.u1, op.v1, y1]);
      u = op.u1;
    }
    if (u < len) rects.push([u, len, y0, y1]);

    const mat = o.mat ?? 'concrete';
    const backing = o.backing ?? 'concreteDark';
    const trim = o.trim ?? 'steelDark';
    const bay = o.bay ?? 8;
    const lift = o.lift ?? 3.2;
    const surface = o.surface ?? surfaceOf(mat);
    const g = this.geo;
    const proud = 0.08;

    for (const [u0, u1, v0, v1] of rects) {
      if (u1 - u0 < 0.05 || v1 - v0 < 0.05) continue;
      if (o.collide !== false) {
        this.collide((u0 + u1) / 2, (v0 + v1) / 2, 0, (u1 - u0) / 2, (v1 - v0) / 2, t + proud, surface);
      }
      g.use(backing).tint(0.8);
      g.slab((u0 + u1) / 2, (v0 + v1) / 2, 0, (u1 - u0) / 2, (v1 - v0) / 2, t, 3.2, FACE.pz | FACE.nz | FACE.py | FACE.px | FACE.nx);
      g.tint(1);
      if (o.plain) continue;
      const sides = o.back ? [1, -1] : [1];
      for (const side of sides) this.panels(mat, side, t, u0, u1, v0, v1, y0, bay, lift);
      if (o.pilasters !== false) {
        const first = Math.ceil(u0 / bay);
        for (let i = first; i * bay <= u1; i++) {
          const x = i * bay;
          if (x < u0 + 0.3 || x > u1 - 0.3) continue;
          for (const side of sides) {
            const zc = side * (t + 0.12);
            g.use(mat).tint(0.82);
            g.bevel(x, (v0 + v1) / 2, zc, 0.42, (v1 - v0) / 2, 0.16, 0.07);
            g.tint(1);
          }
        }
      }
      if (o.plinth !== false && v0 <= y0 + 0.01) {
        g.use('concreteDark').tint(0.75);
        for (const side of sides) g.bevel((u0 + u1) / 2, y0 + 0.5, side * (t + 0.1), (u1 - u0) / 2, 0.5, 0.14, 0.06);
        g.tint(1);
      }
      if (o.cap !== false && v1 >= y1 - 0.01) {
        g.use(trim);
        g.bevel((u0 + u1) / 2, y1 + 0.12, 0, (u1 - u0) / 2 + 0.05, 0.26, t + 0.22, 0.08);
      }
      if (o.strip && o.strip.y > v0 && o.strip.y < v1) {
        const h = o.strip.h ?? 0.14;
        g.use(o.strip.mat);
        for (const side of sides) g.box((u0 + u1) / 2, o.strip.y, side * (t + 0.11), (u1 - u0) / 2 - 0.1, h / 2, 0.04, FACE.all);
      }
    }

    for (const op of openings) {
      if (!op.frame) continue;
      const w = 0.35;
      g.use('steelDark');
      const depth = t + 0.3;
      g.bevel(op.u0 - w, (op.v0 + op.v1) / 2, 0, w, (op.v1 - op.v0) / 2 + w * 2, depth, 0.08);
      g.bevel(op.u1 + w, (op.v0 + op.v1) / 2, 0, w, (op.v1 - op.v0) / 2 + w * 2, depth, 0.08);
      g.bevel((op.u0 + op.u1) / 2, op.v1 + w, 0, (op.u1 - op.u0) / 2 + w * 2, w, depth, 0.08);
      g.use('emissiveCyan');
      g.box(op.u0 + 0.05, (op.v0 + op.v1) / 2, t + 0.28, 0.05, (op.v1 - op.v0) / 2 - 0.3, 0.05);
      g.box(op.u1 - 0.05, (op.v0 + op.v1) / 2, t + 0.28, 0.05, (op.v1 - op.v0) / 2 - 0.3, 0.05);
      g.box((op.u0 + op.u1) / 2, op.v1 - 0.06, t + 0.28, (op.u1 - op.u0) / 2 - 0.2, 0.05, 0.05);
    }
  }

  /** Precast panels with a thin shadow gap, each with its own tone, so a wall reads as built rather than tiled. */
  private panels(mat: Mat, side: number, t: number, u0: number, u1: number, v0: number, v1: number, base: number, bay: number, lift: number): void {
    const g = this.geo.use(mat);
    const gap = 0.05;
    for (let i = Math.floor(u0 / bay); i * bay < u1; i++) {
      const a = Math.max(u0, i * bay) + gap, b = Math.min(u1, (i + 1) * bay) - gap;
      if (b - a < 0.3) continue;
      for (let j = Math.floor((v0 - base) / lift); base + j * lift < v1; j++) {
        const c = Math.max(v0, base + j * lift) + gap, d = Math.min(v1, base + (j + 1) * lift) - gap;
        if (d - c < 0.2) continue;
        const shade = 0.78 + this.rng() * 0.3;
        g.tint(shade, shade, shade * (0.98 + this.rng() * 0.05));
        const off = this.rng() * 0.05;
        g.bevel((a + b) / 2, (c + d) / 2, side * (t + 0.03 + off), (b - a) / 2, (d - c) / 2, 0.05, 0.03);
      }
    }
    g.tint(1);
  }

  /** Wall following an arc around (cx, cz). Increasing angle puts the front toward the centre. */
  arcWall(cx: number, cz: number, r: number, a0: number, a1: number, y0: number, y1: number, segments: number, o: WallOpts = {}): void {
    for (let i = 0; i < segments; i++) {
      const s = a0 + ((a1 - a0) * i) / segments, e = a0 + ((a1 - a0) * (i + 1)) / segments;
      const ax = cx + Math.cos(s) * r, az = cz + Math.sin(s) * r, bx = cx + Math.cos(e) * r, bz = cz + Math.sin(e) * r;
      const len = Math.hypot(bx - ax, bz - az);
      this.wall(ax, az, bx, bz, y0, y1, { ...o, bay: len, pilasters: o.pilasters ?? false });
    }
  }

  // ---- slopes ------------------------------------------------------------------------------------------------

  /** Solid ramp from (ax, y0, az) to (bx, y1, bz). The collider is one clean plane. */
  ramp(ax: number, az: number, y0: number, bx: number, bz: number, y1: number, w: number, mat: Mat = 'concrete', thick = 0.8, skirt = true): void {
    this.along(ax, y0, az, bx, y1, bz, len => {
      const g = this.geo.use(mat);
      g.gridStep(0, 0, w / 2, len, 0, 0, 0, 0, -w, 3);
      this.collide(len / 2, -thick / 2, 0, len / 2, thick / 2, w / 2, surfaceOf(mat));
      if (skirt) {
        g.use('steelDark');
        g.bevel(len / 2, -thick / 2, w / 2 + 0.06, len / 2, thick / 2 + 0.04, 0.08, 0.03);
        g.bevel(len / 2, -thick / 2, -w / 2 - 0.06, len / 2, thick / 2 + 0.04, 0.08, 0.03);
        g.use('concreteDark').slab(len / 2, -thick / 2 - 0.02, 0, len / 2, 0.02, w / 2, 6, FACE.ny);
      }
    });
  }

  /** Stairs: real treads to look at, one ramp plane to run on, so speed survives them. */
  stairs(ax: number, az: number, y0: number, bx: number, bz: number, y1: number, w: number, mat: Mat = 'steel', rails = true): void {
    const rise = y1 - y0;
    const run = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(2, Math.round(Math.abs(rise) / 0.28));
    const yaw = Math.atan2(-(bz - az), bx - ax);
    const g = this.geo;
    this.push(ax, y0, az, yaw);
    const stepRun = run / steps, stepRise = rise / steps;
    g.use(mat);
    for (let i = 0; i < steps; i++) {
      const x = (i + 0.5) * stepRun, top = (i + 1) * stepRise;
      g.box(x, top - 0.04, 0, stepRun / 2 + 0.02, 0.04, w / 2, FACE.py | FACE.nx | FACE.px);
      g.box(x - stepRun / 2 + 0.015, top - stepRise / 2, 0, 0.015, Math.abs(stepRise) / 2, w / 2 - 0.02, FACE.nx);
    }
    this.pop();
    // Stringers and the collider follow the slope.
    this.along(ax, y0, az, bx, y1, bz, len => {
      g.use('steelDark');
      g.bevel(len / 2, -0.12, w / 2 + 0.06, len / 2, 0.22, 0.07, 0.02);
      g.bevel(len / 2, -0.12, -w / 2 - 0.06, len / 2, 0.22, 0.07, 0.02);
      this.collide(len / 2, -0.2, 0, len / 2, 0.2, w / 2, surfaceOf(mat), false);
    });
    if (rails) {
      const nx = -(bz - az) / run, nz = (bx - ax) / run;
      for (const s of [1, -1]) {
        const ox = (nx * w * s) / 2, oz = (nz * w * s) / 2;
        this.rail([ax + ox, y0, az + oz, bx + ox, y1, bz + oz]);
      }
    }
  }

  /**
   * Retaining wall with a sloped top, from (ax, az) to (bx, bz). Top runs ty0 to ty1, foot at `foot`.
   * Front is on the right of travel. Used where a ramp rises beside open ground.
   */
  sideWall(ax: number, az: number, ty0: number, bx: number, bz: number, ty1: number, foot: number, mat: Mat = 'concrete', thick = 0.8): void {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / 5));
    this.push(ax, 0, az, Math.atan2(-(bz - az), bx - ax));
    const g = this.geo;
    for (let i = 0; i < n; i++) {
      const u0 = (i / n) * len, u1 = ((i + 1) / n) * len;
      const t0 = ty0 + (ty1 - ty0) * (i / n), t1 = ty0 + (ty1 - ty0) * ((i + 1) / n);
      const shade = 0.8 + this.rng() * 0.26;
      g.use(mat).tint(shade);
      g.quad(u0 + 0.03, foot, thick / 2, u1 - 0.03, foot, thick / 2, u1 - 0.03, t1, thick / 2, u0 + 0.03, t0, thick / 2);
      g.quad(u1 - 0.03, foot, -thick / 2, u0 + 0.03, foot, -thick / 2, u0 + 0.03, t0, -thick / 2, u1 - 0.03, t1, -thick / 2);
      g.tint(1);
      g.use('concreteDark').tint(0.7).quad(u1 - 0.03, foot, thick / 2 - 0.05, u1 + 0.03, foot, thick / 2 - 0.05, u1 + 0.03, t1, thick / 2 - 0.05, u1 - 0.03, t1, thick / 2 - 0.05);
      g.tint(1);
    }
    g.use('steelDark');
    this.pop();
    this.along(ax, ty0, az, bx, ty1, bz, l => {
      g.use('steelDark').bevel(l / 2, 0.08, 0, l / 2, 0.1, thick / 2 + 0.08, 0.03);
    });
  }

  // ---- thin steel --------------------------------------------------------------------------------------------

  /** Railing along a polyline of [x, y, z] floor points. Never has a collider: a rail must not stop a player at 40 m/s. */
  rail(points: readonly number[], h = 1.08, spacing = 2.4): void {
    const g = this.geo.use('steelDark');
    const n = points.length / 3;
    for (let i = 0; i < n - 1; i++) {
      const ax = points[i * 3]!, ay = points[i * 3 + 1]!, az = points[i * 3 + 2]!;
      const bx = points[i * 3 + 3]!, by = points[i * 3 + 4]!, bz = points[i * 3 + 5]!;
      const len = Math.hypot(bx - ax, by - ay, bz - az);
      const posts = Math.max(1, Math.round(len / spacing));
      for (let p = 0; p <= posts; p++) {
        if (p === posts && i < n - 2) continue;
        const f = p / posts;
        g.box(ax + (bx - ax) * f, ay + (by - ay) * f + h / 2, az + (bz - az) * f, 0.03, h / 2, 0.03, FACE.sides);
      }
      this.along(ax, ay, az, bx, by, bz, l => {
        g.box(l / 2, h, 0, l / 2, 0.03, 0.03, FACE.py | FACE.ny | FACE.pz | FACE.nz);
        g.box(l / 2, h * 0.55, 0, l / 2, 0.018, 0.018, FACE.py | FACE.ny | FACE.pz | FACE.nz);
      });
    }
  }

  /** Grate walkway from A to B at a height. */
  catwalk(ax: number, az: number, bx: number, bz: number, y: number, w = 3, rails: 'both' | 'left' | 'right' | 'none' = 'both', hangers = false): void {
    const len = Math.hypot(bx - ax, bz - az);
    const g = this.geo;
    this.push(ax, y, az, Math.atan2(-(bz - az), bx - ax));
    g.use('grate');
    g.slab(len / 2, -0.04, 0, len / 2, 0.04, w / 2, 3, FACE.py | FACE.ny);
    g.use('steelDark');
    g.bevel(len / 2, -0.1, w / 2, len / 2, 0.14, 0.06, 0.02);
    g.bevel(len / 2, -0.1, -w / 2, len / 2, 0.14, 0.06, 0.02);
    const cross = Math.max(1, Math.round(len / 2.2));
    for (let i = 0; i <= cross; i++) g.box((i / cross) * len, -0.14, 0, 0.05, 0.07, w / 2, FACE.py | FACE.ny | FACE.px | FACE.nx);
    if (hangers) {
      const every = Math.max(1, Math.round(len / 7));
      for (let i = 0; i <= every; i++) {
        const x = (i / every) * len;
        for (const s of [1, -1]) g.box(x, 2, (s * w) / 2, 0.03, 2, 0.03, FACE.sides);
      }
    }
    this.collide(len / 2, -0.15, 0, len / 2, 0.15, w / 2, 'grate', false);
    this.pop();
    const nx = -(bz - az) / len, nz = (bx - ax) / len;
    const hw = w / 2;
    if (rails === 'both' || rails === 'right') this.rail([ax + nx * hw, y, az + nz * hw, bx + nx * hw, y, bz + nz * hw]);
    if (rails === 'both' || rails === 'left') this.rail([ax - nx * hw, y, az - nz * hw, bx - nx * hw, y, bz - nz * hw]);
  }

  /** Oriented bevelled beam between two points. */
  beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, hw: number, hh: number, mat: Mat = 'steelDark', collide = false): void {
    this.along(ax, ay, az, bx, by, bz, len => {
      this.geo.use(mat).bevel(len / 2, 0, 0, len / 2, hh, hw, Math.min(hw, hh) * 0.2);
      if (collide) this.collide(len / 2, 0, 0, len / 2, hh, hw, surfaceOf(mat));
    });
  }

  /** I-section beam. */
  ibeam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, depth: number, width: number, mat: Mat = 'steelDark', collide = false): void {
    this.along(ax, ay, az, bx, by, bz, len => {
      const g = this.geo.use(mat);
      const f = Math.max(0.04, depth * 0.08);
      const ends = FACE.py | FACE.ny | FACE.pz | FACE.nz;
      g.box(len / 2, depth / 2 - f / 2, 0, len / 2, f / 2, width / 2, ends);
      g.box(len / 2, -depth / 2 + f / 2, 0, len / 2, f / 2, width / 2, ends);
      g.box(len / 2, 0, 0, len / 2, depth / 2 - f, width * 0.08, FACE.pz | FACE.nz);
      if (collide) this.collide(len / 2, 0, 0, len / 2, depth / 2, width / 2, 'metal');
    });
  }

  /** Warren truss between two points, `depth` tall. With `width` it becomes a square box truss. */
  truss(ax: number, ay: number, az: number, bx: number, by: number, bz: number, depth: number, width = 0, mat: Mat = 'steelDark', member = 0.12): void {
    this.along(ax, ay, az, bx, by, bz, len => {
      const panels = Math.max(2, Math.round(len / (depth * 1.1)));
      const planes = width > 0 ? [-width / 2, width / 2] : [0];
      const g = this.geo.use(mat);
      const ends = FACE.py | FACE.ny | FACE.pz | FACE.nz;
      for (const z of planes) {
        g.box(len / 2, depth / 2, z, len / 2, member, member, ends);
        g.box(len / 2, -depth / 2, z, len / 2, member, member, ends);
        for (let i = 0; i < panels; i++) {
          const x0 = (i / panels) * len, x1 = ((i + 1) / panels) * len, xm = (x0 + x1) / 2;
          this.diag(x0, -depth / 2, z, xm, depth / 2, z, member * 0.7);
          this.diag(xm, depth / 2, z, x1, -depth / 2, z, member * 0.7);
        }
      }
      if (width > 0) {
        const cross = panels;
        for (let i = 0; i <= cross; i++) {
          const x = (i / cross) * len;
          g.box(x, depth / 2, 0, member * 0.7, member * 0.7, width / 2, FACE.py | FACE.ny | FACE.px | FACE.nx);
          g.box(x, -depth / 2, 0, member * 0.7, member * 0.7, width / 2, FACE.py | FACE.ny | FACE.px | FACE.nx);
        }
      }
    });
  }

  private diag(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): void {
    this.along(ax, ay, az, bx, by, bz, len => {
      this.geo.box(len / 2, 0, 0, len / 2, r, r, FACE.py | FACE.ny | FACE.pz | FACE.nz);
    });
  }

  /** Square column with a stepped base and capital. */
  column(x: number, z: number, y0: number, y1: number, w: number, mat: Mat = 'concrete', yaw = 0): void {
    this.push(x, 0, z, yaw);
    const g = this.geo.use(mat);
    const h = w / 2;
    g.bevel(0, (y0 + y1) / 2, 0, h, (y1 - y0) / 2, h, Math.min(0.12, w * 0.1));
    g.use('concreteDark').tint(0.8);
    g.bevel(0, y0 + 0.45, 0, h + 0.18, 0.45, h + 0.18, 0.08);
    g.tint(1).use('steelDark');
    g.bevel(0, y1 - 0.3, 0, h + 0.12, 0.3, h + 0.12, 0.06);
    this.collide(0, (y0 + y1) / 2, 0, h, (y1 - y0) / 2, h, surfaceOf(mat));
    this.pop();
  }

  // ---- light -------------------------------------------------------------------------------------------------

  light(x: number, y: number, z: number, color: LampColor | number, intensity: number, radius: number): void {
    const m = this.geo.m;
    const rgb = typeof color === 'number' ? color : LAMP[color].rgb;
    this.lights.push({
      position: new THREE.Vector3(
        m[0]! * x + m[1]! * y + m[2]! * z + m[3]!,
        m[4]! * x + m[5]! * y + m[6]! * z + m[7]!,
        m[8]! * x + m[9]! * y + m[10]! * z + m[11]!,
      ),
      color: rgb,
      intensity,
      radius,
    });
  }

  /** Ceiling or wall bar light. Local +X along the bar. */
  lampBar(x: number, y: number, z: number, yaw: number, len: number, color: LampColor, intensity: number, radius: number): void {
    this.push(x, y, z, yaw);
    const g = this.geo;
    g.use('steelDark').bevel(0, 0.09, 0, len / 2 + 0.1, 0.09, 0.2, 0.03);
    g.use(LAMP[color].mat).box(0, -0.02, 0, len / 2, 0.03, 0.12, FACE.ny | FACE.pz | FACE.nz);
    if (intensity > 0) this.light(0, -1.3, 0, color, intensity, radius);
    this.pop();
  }

  /** Free-standing floodlight mast. */
  mast(x: number, z: number, y0: number, h: number, yaw: number, color: LampColor = 'white', intensity = 110, radius = 36): void {
    this.push(x, y0, z, yaw);
    const g = this.geo;
    g.use('concreteDark').bevel(0, 0.4, 0, 0.8, 0.4, 0.8, 0.1);
    g.use('steelDark').cyl(0, 0.8, 0, 0, h, 0, 0.2, 0.11, 8, false, false);
    g.bevel(0, h, 0, 1.4, 0.1, 0.14, 0.03);
    for (const s of [-0.9, 0, 0.9]) {
      g.use('steelDark').bevel(s, h + 0.2, 0.25, 0.36, 0.28, 0.1, 0.03);
      g.use(LAMP[color].mat).box(s, h + 0.2, 0.36, 0.3, 0.22, 0.02, FACE.pz);
    }
    this.collide(0, h / 2, 0, 0.25, h / 2, 0.25, 'metal', false);
    if (intensity > 0) this.light(0, h - 1, 2, color, intensity, radius);
    this.pop();
  }

  /** Flat emissive line laid on a surface, following [x, y, z] points. */
  stripLine(points: readonly number[], w: number, mat: Mat = 'emissiveCyan'): void {
    const g = this.geo.use(mat);
    const n = points.length / 3;
    for (let i = 0; i < n - 1; i++) {
      const ax = points[i * 3]!, ay = points[i * 3 + 1]!, az = points[i * 3 + 2]!;
      const bx = points[i * 3 + 3]!, by = points[i * 3 + 4]!, bz = points[i * 3 + 5]!;
      this.along(ax, ay, az, bx, by, bz, len => {
        g.quad(0, 0.02, w / 2, len, 0.02, w / 2, len, 0.02, -w / 2, 0, 0.02, -w / 2);
      });
    }
  }
}
