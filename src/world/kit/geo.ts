/**
 * Merged static geometry writer. Everything the map draws goes through here: primitives are written straight
 * into per-material, per-chunk typed-array buckets, so a whole map costs a few dozen draw calls.
 *
 * Why buckets chunk by a per-material grid: common materials carry most of the triangles and want tight culling;
 * accent materials are thin and would only add draw calls if they were split finely.
 */
import * as THREE from 'three';
import type { WorldMaterialName } from '../../core/contracts';
import { signRect } from './signs';

export type Mat = WorldMaterialName | 'signs' | 'stencil' | 'plywood';

export const MATERIALS: readonly Mat[] = [
  'concrete', 'concreteDark', 'asphalt', 'steel', 'steelDark', 'rust', 'grate', 'hazard', 'panel', 'tile',
  'dirt', 'glass', 'rubber', 'paintRed', 'paintYellow', 'paintWhite',
  'emissiveCyan', 'emissiveMagenta', 'emissiveOrange', 'emissiveRed', 'emissiveWhite', 'lava', 'signs', 'stencil', 'plywood',
];

/** Chunks across the map per material. */
const CHUNKS_ACROSS: Partial<Record<Mat, number>> = {
  concrete: 5, concreteDark: 5, steel: 5, steelDark: 5, panel: 4, asphalt: 3, rust: 3, tile: 3, dirt: 3, grate: 3,
  hazard: 2, glass: 2, rubber: 2,
};
const MAP_MIN = -180;
const MAP_SIZE = 360;

export const MAT_INDEX = new Map<Mat, number>(MATERIALS.map((m, i) => [m, i]));
const emissiveMats = new Set<Mat>(['emissiveCyan', 'emissiveMagenta', 'emissiveOrange', 'emissiveRed', 'emissiveWhite', 'lava', 'signs']);
export const isEmissive = (m: Mat) => emissiveMats.has(m);

export class Bucket {
  nv = 0;
  ni = 0;
  p: Float32Array;
  n: Float32Array;
  uv: Float32Array;
  c: Uint8Array;
  idx: Uint32Array;
  constructor(public readonly mat: Mat, public readonly chunk: number, cap = 2048) {
    this.p = new Float32Array(cap * 3);
    this.n = new Float32Array(cap * 3);
    this.uv = new Float32Array(cap * 2);
    this.c = new Uint8Array(cap * 4);
    this.idx = new Uint32Array(cap * 3);
  }
  reserve(verts: number, indices: number): void {
    const needV = this.nv + verts;
    if (needV * 3 > this.p.length) {
      const cap = Math.max(needV, (this.p.length / 3) * 2);
      const p = new Float32Array(cap * 3); p.set(this.p); this.p = p;
      const n = new Float32Array(cap * 3); n.set(this.n); this.n = n;
      const uv = new Float32Array(cap * 2); uv.set(this.uv); this.uv = uv;
      const c = new Uint8Array(cap * 4); c.set(this.c); this.c = c;
    }
    const needI = this.ni + indices;
    if (needI > this.idx.length) {
      const idx = new Uint32Array(Math.max(needI, this.idx.length * 2));
      idx.set(this.idx);
      this.idx = idx;
    }
  }
}

/** Pre-computed bevelled unit-box topology: 8 corners x 3 axis vertices. */
const BEVEL = (() => {
  const signs: [number, number, number][] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) signs.push([sx, sy, sz]);
  const cornerOf = (sx: number, sy: number, sz: number) => signs.findIndex(s => s[0] === sx && s[1] === sy && s[2] === sz);
  const vid = (corner: number, axis: number) => corner * 3 + axis;
  const quads: number[][] = [];
  const tris: number[][] = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const s of [-1, 1]) {
      const a = (axis + 1) % 3, b = (axis + 2) % 3;
      const c = (sa: number, sb: number) => {
        const t = [0, 0, 0]; t[axis] = s; t[a] = sa; t[b] = sb;
        return vid(cornerOf(t[0]!, t[1]!, t[2]!), axis);
      };
      quads.push([c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)]);
    }
  }
  for (let axis = 0; axis < 3; axis++) {
    const a = (axis + 1) % 3, b = (axis + 2) % 3;
    for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
      const cor = (s: number) => {
        const t = [0, 0, 0]; t[axis] = s; t[a] = sa; t[b] = sb;
        return cornerOf(t[0]!, t[1]!, t[2]!);
      };
      quads.push([vid(cor(-1), a), vid(cor(1), a), vid(cor(1), b), vid(cor(-1), b)]);
    }
  }
  for (let i = 0; i < 8; i++) tris.push([vid(i, 0), vid(i, 1), vid(i, 2)]);
  // Winding is fixed up numerically so the tables above can stay simple.
  const pos = (id: number): number[] => {
    const corner = signs[Math.floor(id / 3)]!, axis = id % 3;
    return corner.map((s, i) => (i === axis ? s : s * 0.8));
  };
  const nrm = (id: number): number[] => {
    const corner = signs[Math.floor(id / 3)]!, axis = id % 3;
    return corner.map((s, i) => (i === axis ? s : 0));
  };
  const fix = (f: number[]) => {
    const [p0, p1, p2] = [pos(f[0]!), pos(f[1]!), pos(f[2]!)];
    const u = [p1[0]! - p0[0]!, p1[1]! - p0[1]!, p1[2]! - p0[2]!];
    const v = [p2[0]! - p0[0]!, p2[1]! - p0[1]!, p2[2]! - p0[2]!];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const avg = [0, 0, 0];
    for (const id of f) { const m = nrm(id); avg[0]! += m[0]!; avg[1]! += m[1]!; avg[2]! += m[2]!; }
    const dot = n[0]! * avg[0]! + n[1]! * avg[1]! + n[2]! * avg[2]!;
    return dot < 0 ? [...f].reverse() : f;
  };
  const idx: number[] = [];
  for (const q of quads) {
    const f = fix(q);
    idx.push(f[0]!, f[1]!, f[2]!, f[0]!, f[2]!, f[3]!);
  }
  for (const t of tris) idx.push(...fix(t));
  return { signs, indices: new Uint16Array(idx) };
})();

export const FACE = { px: 1, nx: 2, py: 4, ny: 8, pz: 16, nz: 32, all: 63, noBottom: 55, sides: 51 } as const;

export class Geo {
  readonly buckets = new Map<number, Bucket>();
  /** Row-major 3x4 affine of the current frame. */
  m: Float64Array = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
  private stack: Float64Array[] = [];
  private mat: Mat = 'concrete';
  private matIndex = 0;
  private across = 5;
  private r = 255;
  private g = 255;
  private b = 255;
  /** Last bucket lookup, because primitives usually come in runs. */
  private lastKey = -1;
  private last: Bucket | null = null;

  use(mat: Mat): this {
    this.mat = mat;
    this.matIndex = MAT_INDEX.get(mat)!;
    this.across = CHUNKS_ACROSS[mat] ?? 1;
    return this;
  }
  get material(): Mat {
    return this.mat;
  }
  /** Multiplies the vertex colour of everything written next. 1 is neutral. */
  tint(r = 1, g = r, b = r): this {
    this.r = Math.min(255, r * 255) | 0;
    this.g = Math.min(255, g * 255) | 0;
    this.b = Math.min(255, b * 255) | 0;
    return this;
  }

  push(x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0): void {
    this.stack.push(this.m.slice());
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    // Local = Ry(yaw) * Rz(pitch) * Rx(roll): pitch tilts local +X up, roll banks around it.
    const a00 = cy * cp, a01 = -cy * sp * cr + sy * sr, a02 = cy * sp * sr + sy * cr;
    const a10 = sp, a11 = cp * cr, a12 = -cp * sr;
    const a20 = -sy * cp, a21 = sy * sp * cr + cy * sr, a22 = -sy * sp * sr + cy * cr;
    const m = this.m;
    const n = new Float64Array(12);
    for (let i = 0; i < 3; i++) {
      const r0 = m[i * 4]!, r1 = m[i * 4 + 1]!, r2 = m[i * 4 + 2]!, r3 = m[i * 4 + 3]!;
      n[i * 4] = r0 * a00 + r1 * a10 + r2 * a20;
      n[i * 4 + 1] = r0 * a01 + r1 * a11 + r2 * a21;
      n[i * 4 + 2] = r0 * a02 + r1 * a12 + r2 * a22;
      n[i * 4 + 3] = r0 * x + r1 * y + r2 * z + r3;
    }
    this.m = n;
  }
  pop(): void {
    this.m = this.stack.pop()!;
  }

  private bucket(wx: number, wz: number): Bucket {
    const across = this.across;
    let cx = ((wx - MAP_MIN) / MAP_SIZE * across) | 0;
    let cz = ((wz - MAP_MIN) / MAP_SIZE * across) | 0;
    cx = cx < 0 ? 0 : cx >= across ? across - 1 : cx;
    cz = cz < 0 ? 0 : cz >= across ? across - 1 : cz;
    const chunk = cz * across + cx;
    const key = this.matIndex * 1024 + chunk;
    if (key === this.lastKey) return this.last!;
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = new Bucket(this.mat, chunk)));
    this.lastKey = key;
    this.last = b;
    return b;
  }

  private bucketAtLocal(x: number, y: number, z: number): Bucket {
    const m = this.m;
    return this.bucket(m[0]! * x + m[1]! * y + m[2]! * z + m[3]!, m[8]! * x + m[9]! * y + m[10]! * z + m[11]!);
  }

  /** Writes one vertex with an explicit UV. Position and normal are in the current frame. */
  private put(b: Bucket, x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): void {
    const m = this.m, i = b.nv, i3 = i * 3;
    const p = b.p, n = b.n;
    p[i3] = m[0]! * x + m[1]! * y + m[2]! * z + m[3]!;
    p[i3 + 1] = m[4]! * x + m[5]! * y + m[6]! * z + m[7]!;
    p[i3 + 2] = m[8]! * x + m[9]! * y + m[10]! * z + m[11]!;
    n[i3] = m[0]! * nx + m[1]! * ny + m[2]! * nz;
    n[i3 + 1] = m[4]! * nx + m[5]! * ny + m[6]! * nz;
    n[i3 + 2] = m[8]! * nx + m[9]! * ny + m[10]! * nz;
    b.uv[i * 2] = u;
    b.uv[i * 2 + 1] = v;
    const c = b.c, i4 = i * 4;
    c[i4] = this.r; c[i4 + 1] = this.g; c[i4 + 2] = this.b; c[i4 + 3] = 255;
    b.nv = i + 1;
  }

  /** Same as put, with a world-space UV chosen by the dominant axis of `nx,ny,nz`. */
  private putW(b: Bucket, x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
    this.put(b, x, y, z, nx, ny, nz, 0, 0);
    const i = b.nv - 1, i3 = i * 3;
    const px = b.p[i3]!, py = b.p[i3 + 1]!, pz = b.p[i3 + 2]!;
    const ax = Math.abs(b.n[i3]!), ay = Math.abs(b.n[i3 + 1]!), az = Math.abs(b.n[i3 + 2]!);
    if (ay >= ax && ay >= az) { b.uv[i * 2] = px; b.uv[i * 2 + 1] = pz; }
    else if (ax >= az) { b.uv[i * 2] = pz; b.uv[i * 2 + 1] = py; }
    else { b.uv[i * 2] = px; b.uv[i * 2 + 1] = py; }
  }

  /** CCW from outside. World-projected UVs. */
  quad(
    ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number, dx: number, dy: number, dz: number,
  ): void {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = dx - ax, vy = dy - ay, vz = dz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const b = this.bucketAtLocal((ax + cx) * 0.5, (ay + cy) * 0.5, (az + cz) * 0.5);
    b.reserve(4, 6);
    const i = b.nv;
    this.putW(b, ax, ay, az, nx, ny, nz);
    this.putW(b, bx, by, bz, nx, ny, nz);
    this.putW(b, cx, cy, cz, nx, ny, nz);
    this.putW(b, dx, dy, dz, nx, ny, nz);
    const d = b.idx, j = b.ni;
    d[j] = i; d[j + 1] = i + 1; d[j + 2] = i + 2; d[j + 3] = i; d[j + 4] = i + 2; d[j + 5] = i + 3;
    b.ni = j + 6;
  }

  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): void {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const b = this.bucketAtLocal((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3);
    b.reserve(3, 3);
    const i = b.nv;
    this.putW(b, ax, ay, az, nx, ny, nz);
    this.putW(b, bx, by, bz, nx, ny, nz);
    this.putW(b, cx, cy, cz, nx, ny, nz);
    const d = b.idx, j = b.ni;
    d[j] = i; d[j + 1] = i + 1; d[j + 2] = i + 2;
    b.ni = j + 3;
  }

  /** Tessellated parallelogram, normal U x V. Fine vertices are what carry baked AO and dirt on big surfaces. */
  grid(
    ox: number, oy: number, oz: number, ux: number, uy: number, uz: number, vx: number, vy: number, vz: number,
    nu: number, nv: number,
  ): void {
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const b = this.bucketAtLocal(ox + (ux + vx) * 0.5, oy + (uy + vy) * 0.5, oz + (uz + vz) * 0.5);
    b.reserve((nu + 1) * (nv + 1), nu * nv * 6);
    const base = b.nv;
    for (let j = 0; j <= nv; j++) {
      const fj = j / nv;
      for (let i = 0; i <= nu; i++) {
        const fi = i / nu;
        this.putW(b, ox + ux * fi + vx * fj, oy + uy * fi + vy * fj, oz + uz * fi + vz * fj, nx, ny, nz);
      }
    }
    const d = b.idx;
    let k = b.ni;
    const w = nu + 1;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base + j * w + i;
        d[k++] = a; d[k++] = a + 1; d[k++] = a + w + 1;
        d[k++] = a; d[k++] = a + w + 1; d[k++] = a + w;
      }
    }
    b.ni = k;
  }

  /** Grid subdivided to at most `step` meters along each side. */
  gridStep(
    ox: number, oy: number, oz: number, ux: number, uy: number, uz: number, vx: number, vy: number, vz: number,
    step: number,
  ): void {
    const nu = Math.max(1, Math.ceil(Math.hypot(ux, uy, uz) / step));
    const nv = Math.max(1, Math.ceil(Math.hypot(vx, vy, vz) / step));
    // Long skinny strips cross chunk borders, so split them for culling.
    const maxSpan = 24 / step;
    if (nu > maxSpan * 2 || nv > maxSpan * 2) {
      const su = Math.ceil(nu / maxSpan), sv = Math.ceil(nv / maxSpan);
      for (let j = 0; j < sv; j++) for (let i = 0; i < su; i++) {
        this.grid(
          ox + (ux * i) / su + (vx * j) / sv, oy + (uy * i) / su + (vy * j) / sv, oz + (uz * i) / su + (vz * j) / sv,
          ux / su, uy / su, uz / su, vx / sv, vy / sv, vz / sv, Math.ceil(nu / su), Math.ceil(nv / sv),
        );
      }
      return;
    }
    this.grid(ox, oy, oz, ux, uy, uz, vx, vy, vz, nu, nv);
  }

  /** Plain box. `faces` drops sides nobody sees. */
  box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, faces: number = FACE.all): void {
    const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy, z0 = cz - hz, z1 = cz + hz;
    if (faces & FACE.px) this.quad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1);
    if (faces & FACE.nx) this.quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0);
    if (faces & FACE.py) this.quad(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0);
    if (faces & FACE.ny) this.quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1);
    if (faces & FACE.pz) this.quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1);
    if (faces & FACE.nz) this.quad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0);
  }

  /** Box tessellated to `step`, for big surfaces. */
  slab(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, step = 3, faces: number = FACE.all): void {
    const x0 = cx - hx, y0 = cy - hy, z0 = cz - hz, w = hx * 2, h = hy * 2, d = hz * 2;
    if (faces & FACE.px) this.gridStep(x0 + w, y0, z0 + d, 0, 0, -d, 0, h, 0, step);
    if (faces & FACE.nx) this.gridStep(x0, y0, z0, 0, 0, d, 0, h, 0, step);
    if (faces & FACE.py) this.gridStep(x0, y0 + h, z0 + d, w, 0, 0, 0, 0, -d, step);
    if (faces & FACE.ny) this.gridStep(x0, y0, z0, w, 0, 0, 0, 0, d, step);
    if (faces & FACE.pz) this.gridStep(x0, y0, z0 + d, w, 0, 0, 0, h, 0, step);
    if (faces & FACE.nz) this.gridStep(x0 + w, y0, z0, -w, 0, 0, 0, h, 0, step);
  }

  /** Box with chamfered edges whose normals blend across the bevel, so every edge catches a highlight. */
  bevel(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, bev = 0.05): void {
    const e = Math.min(bev, hx * 0.45, hy * 0.45, hz * 0.45);
    const b = this.bucketAtLocal(cx, cy, cz);
    b.reserve(24, BEVEL.indices.length);
    const base = b.nv;
    const signs = BEVEL.signs;
    for (let i = 0; i < 8; i++) {
      const s = signs[i]!;
      const sx = s[0], sy = s[1], sz = s[2];
      const ix = cx + sx * (hx - e), iy = cy + sy * (hy - e), iz = cz + sz * (hz - e);
      this.putW(b, cx + sx * hx, iy, iz, sx, 0, 0);
      this.putW(b, ix, cy + sy * hy, iz, 0, sy, 0);
      this.putW(b, ix, iy, cz + sz * hz, 0, 0, sz);
    }
    const d = b.idx, src = BEVEL.indices;
    let k = b.ni;
    for (let i = 0; i < src.length; i++) d[k++] = base + src[i]!;
    b.ni = k;
  }

  /** Cone or cylinder between two points in the current frame, smooth sides. */
  cyl(
    ax: number, ay: number, az: number, bx: number, by: number, bz: number, ra: number, rb: number, seg = 10,
    capA = true, capB = true,
  ): void {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    // Any perpendicular basis works; pick the axis least aligned with the cylinder.
    let px: number, py: number, pz: number;
    if (Math.abs(dy) < 0.9) { px = dz; py = 0; pz = -dx; } else { px = 0; py = -dz; pz = dy; }
    const pl = Math.hypot(px, py, pz) || 1;
    px /= pl; py /= pl; pz /= pl;
    const qx = dy * pz - dz * py, qy = dz * px - dx * pz, qz = dx * py - dy * px;
    const b = this.bucketAtLocal((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
    b.reserve((seg + 1) * 2 + (seg + 1) * 2 + 2, seg * 12);
    const base = b.nv;
    const slope = (ra - rb) / len;
    const rAvg = (ra + rb) * 0.5;
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      const c = Math.cos(t), s = Math.sin(t);
      const ox = px * c + qx * s, oy = py * c + qy * s, oz = pz * c + qz * s;
      let nx = ox + dx * slope, ny = oy + dy * slope, nz = oz + dz * slope;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const u = t * rAvg;
      this.put(b, ax + ox * ra, ay + oy * ra, az + oz * ra, nx, ny, nz, u, 0);
      this.put(b, bx + ox * rb, by + oy * rb, bz + oz * rb, nx, ny, nz, u, len);
    }
    const d = b.idx;
    let k = b.ni;
    for (let i = 0; i < seg; i++) {
      const a = base + i * 2;
      d[k++] = a; d[k++] = a + 2; d[k++] = a + 3;
      d[k++] = a; d[k++] = a + 3; d[k++] = a + 1;
    }
    b.ni = k;
    const cap = (cx: number, cy: number, cz: number, r: number, sign: number) => {
      const start = b.nv;
      this.putW(b, cx, cy, cz, dx * sign, dy * sign, dz * sign);
      for (let i = 0; i <= seg; i++) {
        const t = (i / seg) * Math.PI * 2;
        const c = Math.cos(t), s = Math.sin(t);
        this.putW(b, cx + (px * c + qx * s) * r, cy + (py * c + qy * s) * r, cz + (pz * c + qz * s) * r, dx * sign, dy * sign, dz * sign);
      }
      const dd = b.idx;
      let kk = b.ni;
      for (let i = 0; i < seg; i++) {
        if (sign > 0) { dd[kk++] = start; dd[kk++] = start + 1 + i; dd[kk++] = start + 2 + i; }
        else { dd[kk++] = start; dd[kk++] = start + 2 + i; dd[kk++] = start + 1 + i; }
      }
      b.ni = kk;
    };
    if (capA) cap(ax, ay, az, ra, -1);
    if (capB) cap(bx, by, bz, rb, 1);
  }

  /**
   * Surface of revolution around Y at (x, y, z). `profile` is [r, y, r, y, ...], bottom to top for an outward
   * surface. Each profile segment is a band; `smooth` blends normals between bands, otherwise bands stay crisp.
   */
  lathe(profile: readonly number[], x: number, y: number, z: number, seg = 24, smooth = false, a0 = 0, a1 = Math.PI * 2): void {
    const np = profile.length / 2;
    // Each band gets its own chunk slice around the ring so a big ring still culls.
    const parts = seg >= 48 ? 8 : seg >= 24 ? 4 : 1;
    const norm: number[] = [];
    for (let i = 0; i < np - 1; i++) {
      const dr = profile[(i + 1) * 2]! - profile[i * 2]!, dy = profile[(i + 1) * 2 + 1]! - profile[i * 2 + 1]!;
      const l = Math.hypot(dr, dy) || 1;
      norm.push(dy / l, -dr / l);
    }
    const nrm = (i: number): [number, number] => {
      if (!smooth) { const s = Math.min(i, np - 2); return [norm[s * 2]!, norm[s * 2 + 1]!]; }
      const a = Math.max(0, i - 1), b = Math.min(np - 2, i);
      const nr = norm[a * 2]! + norm[b * 2]!, ny = norm[a * 2 + 1]! + norm[b * 2 + 1]!;
      const l = Math.hypot(nr, ny) || 1;
      return [nr / l, ny / l];
    };
    const segPer = Math.ceil(seg / parts);
    for (let part = 0; part < parts; part++) {
      const s0 = part * segPer, s1 = Math.min(seg, s0 + segPer);
      if (s0 >= s1) break;
      const mid = a0 + ((a1 - a0) * (s0 + s1)) / 2 / seg;
      const rMid = profile[Math.floor(np / 2) * 2]!;
      const b = this.bucketAtLocal(x + Math.cos(mid) * rMid, y, z + Math.sin(mid) * rMid);
      const cols = s1 - s0 + 1;
      b.reserve((np - 1) * 2 * cols, (np - 1) * (s1 - s0) * 6);
      let vDist = 0;
      for (let i = 0; i < np - 1; i++) {
        const r0 = profile[i * 2]!, y0 = profile[i * 2 + 1]!, r1 = profile[i * 2 + 2]!, y1 = profile[i * 2 + 3]!;
        const bandLen = Math.hypot(r1 - r0, y1 - y0);
        if (bandLen < 1e-5) continue;
        const [n0r, n0y] = nrm(i);
        const [n1r, n1y] = smooth ? nrm(i + 1) : [n0r, n0y];
        const start = b.nv;
        const rU = Math.max(r0, r1);
        for (let s = s0; s <= s1; s++) {
          const t = a0 + ((a1 - a0) * s) / seg;
          const c = Math.cos(t), sn = Math.sin(t);
          this.put(b, x + c * r0, y + y0, z + sn * r0, c * n0r, n0y, sn * n0r, t * rU, vDist);
          this.put(b, x + c * r1, y + y1, z + sn * r1, c * n1r, n1y, sn * n1r, t * rU, vDist + bandLen);
        }
        const d = b.idx;
        let k = b.ni;
        for (let s = 0; s < s1 - s0; s++) {
          const a = start + s * 2;
          d[k++] = a; d[k++] = a + 1; d[k++] = a + 3;
          d[k++] = a; d[k++] = a + 3; d[k++] = a + 2;
        }
        b.ni = k;
        vDist += bandLen;
      }
    }
  }

  /**
   * Sweeps an open polyline `profile` ([s, t, s, t, ...], s along the path's right vector, t along its up vector)
   * along `frames` ([x, y, z, rx, ry, rz, ux, uy, uz, dist] per station). Bands stay crisp across the profile
   * and smooth along the path.
   */
  sweep(frames: Float64Array, profile: readonly number[]): void {
    const ns = frames.length / 10;
    const np = profile.length / 2;
    const STRIDE = 8;
    for (let start = 0; start < ns - 1; start += STRIDE) {
      const end = Math.min(ns - 1, start + STRIDE);
      const f0 = start * 10;
      const b = this.bucketAtLocal(frames[f0]!, frames[f0 + 1]!, frames[f0 + 2]!);
      b.reserve((np - 1) * 2 * (end - start + 1), (np - 1) * (end - start) * 6);
      let vd = 0;
      for (let i = 0; i < np - 1; i++) {
        const s0 = profile[i * 2]!, t0 = profile[i * 2 + 1]!, s1 = profile[i * 2 + 2]!, t1 = profile[i * 2 + 3]!;
        const ds = s1 - s0, dt = t1 - t0;
        const l = Math.hypot(ds, dt) || 1;
        // The profile runs so its left side is the outside of the surface.
        const ns2 = -dt / l, nt = ds / l;
        const base = b.nv;
        for (let k = start; k <= end; k++) {
          const f = k * 10;
          const px = frames[f]!, py = frames[f + 1]!, pz = frames[f + 2]!;
          const rx = frames[f + 3]!, ry = frames[f + 4]!, rz = frames[f + 5]!;
          const ux = frames[f + 6]!, uy = frames[f + 7]!, uz = frames[f + 8]!;
          const dist = frames[f + 9]!;
          const nx = rx * ns2 + ux * nt, ny = ry * ns2 + uy * nt, nz = rz * ns2 + uz * nt;
          this.put(b, px + rx * s0 + ux * t0, py + ry * s0 + uy * t0, pz + rz * s0 + uz * t0, nx, ny, nz, dist, vd);
          this.put(b, px + rx * s1 + ux * t1, py + ry * s1 + uy * t1, pz + rz * s1 + uz * t1, nx, ny, nz, dist, vd + l);
        }
        const d = b.idx;
        let q = b.ni;
        for (let k = 0; k < end - start; k++) {
          const a = base + k * 2;
          d[q++] = a; d[q++] = a + 2; d[q++] = a + 3;
          d[q++] = a; d[q++] = a + 3; d[q++] = a + 1;
        }
        b.ni = q;
        vd += l;
      }
    }
  }

  /** Round tube along a polyline, using parallel-transported frames so it never twists. */
  tube(points: readonly number[], r: number, seg = 8): void {
    const n = points.length / 3;
    if (n < 2) return;
    let tx = points[3]! - points[0]!, ty = points[4]! - points[1]!, tz = points[5]! - points[2]!;
    let tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    let px: number, py: number, pz: number;
    if (Math.abs(ty) < 0.9) { px = tz; py = 0; pz = -tx; } else { px = 0; py = -tz; pz = ty; }
    const pl = Math.hypot(px, py, pz) || 1;
    px /= pl; py /= pl; pz /= pl;
    const b = this.bucketAtLocal(points[0]!, points[1]!, points[2]!);
    b.reserve(n * (seg + 1), (n - 1) * seg * 6);
    const base = b.nv;
    let dist = 0;
    for (let i = 0; i < n; i++) {
      const x = points[i * 3]!, y = points[i * 3 + 1]!, z = points[i * 3 + 2]!;
      if (i > 0) {
        const j = Math.min(n - 1, i + 1);
        let nx = points[j * 3]! - points[(i - 1) * 3]!, ny = points[j * 3 + 1]! - points[(i - 1) * 3 + 1]!, nz = points[j * 3 + 2]! - points[(i - 1) * 3 + 2]!;
        tl = Math.hypot(nx, ny, nz) || 1;
        nx /= tl; ny /= tl; nz /= tl;
        const dot = px * nx + py * ny + pz * nz;
        px -= nx * dot; py -= ny * dot; pz -= nz * dot;
        const l = Math.hypot(px, py, pz) || 1;
        px /= l; py /= l; pz /= l;
        tx = nx; ty = ny; tz = nz;
        dist += Math.hypot(x - points[(i - 1) * 3]!, y - points[(i - 1) * 3 + 1]!, z - points[(i - 1) * 3 + 2]!);
      }
      const qx = ty * pz - tz * py, qy = tz * px - tx * pz, qz = tx * py - ty * px;
      for (let s = 0; s <= seg; s++) {
        const t = (s / seg) * Math.PI * 2;
        const c = Math.cos(t), sn = Math.sin(t);
        const ox = px * c + qx * sn, oy = py * c + qy * sn, oz = pz * c + qz * sn;
        this.put(b, x + ox * r, y + oy * r, z + oz * r, ox, oy, oz, t * r, dist);
      }
    }
    const d = b.idx;
    let k = b.ni;
    const w = seg + 1;
    for (let i = 0; i < n - 1; i++) {
      for (let s = 0; s < seg; s++) {
        const a = base + i * w + s;
        d[k++] = a; d[k++] = a + 1; d[k++] = a + w + 1;
        d[k++] = a; d[k++] = a + w + 1; d[k++] = a + w;
      }
    }
    b.ni = k;
  }

  /** Signage quad in the local XY plane facing +Z, mapped to one atlas cell. */
  quadUV(x0: number, y0: number, z: number, x1: number, y1: number, sign: number): void {
    const [u0, v0, u1, v1] = signRect(sign);
    this.quadRect(x0, y0, z, x1, y1, u0, v0, u1, v1);
  }

  /** Quad in the local XY plane facing +Z, with explicit texture coordinates. */
  quadRect(x0: number, y0: number, z: number, x1: number, y1: number, u0: number, v0: number, u1: number, v1: number): void {
    const b = this.bucketAtLocal((x0 + x1) / 2, (y0 + y1) / 2, z);
    b.reserve(4, 6);
    const i = b.nv;
    this.put(b, x0, y0, z, 0, 0, 1, u0, v0);
    this.put(b, x1, y0, z, 0, 0, 1, u1, v0);
    this.put(b, x1, y1, z, 0, 0, 1, u1, v1);
    this.put(b, x0, y1, z, 0, 0, 1, u0, v1);
    const d = b.idx, j = b.ni;
    d[j] = i; d[j + 1] = i + 1; d[j + 2] = i + 2; d[j + 3] = i; d[j + 4] = i + 2; d[j + 5] = i + 3;
    b.ni = j + 6;
  }

  /** Solid-looking polygon cap in the XZ plane at height y, fan-triangulated. Polygon must be convex, CCW from above. */
  fan(points: readonly number[], y: number): void {
    const n = points.length / 2;
    for (let i = 1; i < n - 1; i++) {
      this.tri(points[0]!, y, points[1]!, points[i * 2 + 2]!, y, points[i * 2 + 3]!, points[i * 2]!, y, points[i * 2 + 1]!);
    }
  }

  triangles(): number {
    let t = 0;
    for (const b of this.buckets.values()) t += b.ni / 3;
    return t;
  }
  vertices(): number {
    let t = 0;
    for (const b of this.buckets.values()) t += b.nv;
    return t;
  }

  /** Turns the buckets into meshes under one group. `material` resolves names to shared materials. */
  finish(material: (mat: Mat) => THREE.Material): THREE.Group {
    const group = new THREE.Group();
    group.name = 'world-static';
    for (const b of this.buckets.values()) {
      if (b.ni === 0) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(b.p.slice(0, b.nv * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(b.n.slice(0, b.nv * 3), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(b.uv.slice(0, b.nv * 2), 2));
      g.setAttribute('color', new THREE.BufferAttribute(b.c.slice(0, b.nv * 4), 4, true));
      g.setIndex(new THREE.BufferAttribute(b.idx.slice(0, b.ni), 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, material(b.mat));
      mesh.name = `${b.mat}:${b.chunk}`;
      mesh.matrixAutoUpdate = false;
      const emissive = isEmissive(b.mat);
      // Stencils lie on a surface that already casts, and the shadow pass ignores their cut-out alpha.
      mesh.castShadow = !emissive && b.mat !== 'glass' && b.mat !== 'stencil';
      mesh.receiveShadow = !emissive;
      group.add(mesh);
    }
    return group;
  }
}
