/**
 * Coarse occupancy grid of the map. One structure does three jobs: `isSolid` for the light bake, a mip pyramid
 * for voxel-cone vertex AO, and height-above-floor for dirt.
 */
import { clamp, smoothstep } from '../../core/math';
import { type Bucket, type Geo, isEmissive } from './geo';

const X0 = -180, Y0 = -20, Z0 = -180;
const NX = 360, NY = 112, NZ = 360;

interface Mip {
  size: number;
  nx: number;
  ny: number;
  nz: number;
  data: Uint8Array;
}

export class Voxels {
  readonly data = new Uint8Array(NX * NY * NZ);
  private mips: Mip[] = [];

  private set(ix: number, iy: number, iz: number): void {
    if (ix < 0 || iy < 0 || iz < 0 || ix >= NX || iy >= NY || iz >= NZ) return;
    this.data[(iz * NY + iy) * NX + ix] = 1;
  }

  isSolid(x: number, y: number, z: number): boolean {
    const ix = Math.floor(x - X0), iy = Math.floor(y - Y0), iz = Math.floor(z - Z0);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= NX || iy >= NY || iz >= NZ) return false;
    return this.data[(iz * NY + iy) * NX + ix] === 1;
  }

  /** Marks an oriented box. `m` is a row-major 3x4 frame; the box is local to it. */
  fillBox(m: Float64Array, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): void {
    // Thin geometry must still register at 1 m voxels.
    const ex = Math.max(hx, 0.55), ey = Math.max(hy, 0.55), ez = Math.max(hz, 0.55);
    const wx = m[0]! * cx + m[1]! * cy + m[2]! * cz + m[3]!;
    const wy = m[4]! * cx + m[5]! * cy + m[6]! * cz + m[7]!;
    const wz = m[8]! * cx + m[9]! * cy + m[10]! * cz + m[11]!;
    const rx = Math.abs(m[0]!) * ex + Math.abs(m[1]!) * ey + Math.abs(m[2]!) * ez;
    const ry = Math.abs(m[4]!) * ex + Math.abs(m[5]!) * ey + Math.abs(m[6]!) * ez;
    const rz = Math.abs(m[8]!) * ex + Math.abs(m[9]!) * ey + Math.abs(m[10]!) * ez;
    const ix0 = Math.max(0, Math.floor(wx - rx - X0)), ix1 = Math.min(NX - 1, Math.floor(wx + rx - X0));
    const iy0 = Math.max(0, Math.floor(wy - ry - Y0)), iy1 = Math.min(NY - 1, Math.floor(wy + ry - Y0));
    const iz0 = Math.max(0, Math.floor(wz - rz - Z0)), iz1 = Math.min(NZ - 1, Math.floor(wz + rz - Z0));
    const axisAligned = Math.abs(Math.abs(m[0]!) - 1) < 1e-6 && Math.abs(Math.abs(m[5]!) - 1) < 1e-6;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        const row = (iz * NY + iy) * NX;
        if (axisAligned) {
          this.data.fill(1, row + ix0, row + ix1 + 1);
          continue;
        }
        const dz = iz + Z0 + 0.5 - wz, dy = iy + Y0 + 0.5 - wy;
        for (let ix = ix0; ix <= ix1; ix++) {
          const dx = ix + X0 + 0.5 - wx;
          const lx = m[0]! * dx + m[4]! * dy + m[8]! * dz;
          const ly = m[1]! * dx + m[5]! * dy + m[9]! * dz;
          const lz = m[2]! * dx + m[6]! * dy + m[10]! * dz;
          if (Math.abs(lx) <= ex && Math.abs(ly) <= ey && Math.abs(lz) <= ez) this.data[row + ix] = 1;
        }
      }
    }
  }

  /** Marks triangles by dense sampling. Only used for the handful of mesh colliders. */
  fillTriangles(v: Float32Array, idx: Uint32Array): void {
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t]! * 3, b = idx[t + 1]! * 3, c = idx[t + 2]! * 3;
      const ax = v[a]!, ay = v[a + 1]!, az = v[a + 2]!;
      const ux = v[b]! - ax, uy = v[b + 1]! - ay, uz = v[b + 2]! - az;
      const wx = v[c]! - ax, wy = v[c + 1]! - ay, wz = v[c + 2]! - az;
      const steps = Math.ceil(Math.max(Math.hypot(ux, uy, uz), Math.hypot(wx, wy, wz)) / 0.7) + 1;
      for (let i = 0; i <= steps; i++) {
        for (let j = 0; j <= steps - i; j++) {
          const s = i / steps, q = j / steps;
          this.set(
            Math.floor(ax + ux * s + wx * q - X0),
            Math.floor(ay + uy * s + wy * q - Y0),
            Math.floor(az + uz * s + wz * q - Z0),
          );
        }
      }
    }
  }

  /** Solid vertical cylinder. For things whose collider is a prism, such as tanks and the reactor. */
  fillCylinder(x: number, z: number, y0: number, y1: number, r: number): void {
    const iy0 = Math.max(0, Math.floor(y0 - Y0)), iy1 = Math.min(NY - 1, Math.floor(y1 - Y0));
    const ix0 = Math.max(0, Math.floor(x - r - X0)), ix1 = Math.min(NX - 1, Math.floor(x + r - X0));
    const iz0 = Math.max(0, Math.floor(z - r - Z0)), iz1 = Math.min(NZ - 1, Math.floor(z + r - Z0));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const dx = ix + X0 + 0.5 - x, dz = iz + Z0 + 0.5 - z;
      if (dx * dx + dz * dz > r * r) continue;
      for (let iy = iy0; iy <= iy1; iy++) this.data[(iz * NY + iy) * NX + ix] = 1;
    }
  }

  buildMips(): void {
    this.mips = [];
    let src: Mip = { size: 1, nx: NX, ny: NY, nz: NZ, data: this.data };
    for (let level = 0; level < 4; level++) {
      const nx = src.nx >> 1, ny = src.ny >> 1, nz = src.nz >> 1;
      const out = new Uint8Array(nx * ny * nz);
      const sd = src.data, snx = src.nx, sny = src.ny;
      const scale = level === 0 ? 255 / 8 : 1 / 8;
      for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
        const r0 = ((z * 2) * sny + y * 2) * snx, r1 = r0 + snx, r2 = r0 + sny * snx, r3 = r2 + snx;
        const o = (z * ny + y) * nx;
        for (let x = 0; x < nx; x++) {
          const i = x * 2;
          out[o + x] = (sd[r0 + i]! + sd[r0 + i + 1]! + sd[r1 + i]! + sd[r1 + i + 1]! + sd[r2 + i]! + sd[r2 + i + 1]! + sd[r3 + i]! + sd[r3 + i + 1]!) * scale;
        }
      }
      src = { size: src.size * 2, nx, ny, nz, data: out };
      this.mips.push(src);
    }
  }

  /** Trilinear occupancy 0..1 at mip `level` (0 is the 2 m level). */
  private sample(level: number, x: number, y: number, z: number): number {
    const m = this.mips[level]!;
    const fx = (x - X0) / m.size - 0.5, fy = (y - Y0) / m.size - 0.5, fz = (z - Z0) / m.size - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= m.nx - 1 || iy >= m.ny - 1 || iz >= m.nz - 1) return 0;
    const tx = fx - ix, ty = fy - iy, tz = fz - iz;
    const d = m.data, nx = m.nx, plane = m.nx * m.ny;
    const i = (iz * m.ny + iy) * nx + ix;
    const c00 = d[i]! + (d[i + 1]! - d[i]!) * tx;
    const c10 = d[i + nx]! + (d[i + nx + 1]! - d[i + nx]!) * tx;
    const c01 = d[i + plane]! + (d[i + plane + 1]! - d[i + plane]!) * tx;
    const c11 = d[i + plane + nx]! + (d[i + plane + nx + 1]! - d[i + plane + nx]!) * tx;
    const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty;
    return (c0 + (c1 - c0) * tz) / 255;
  }

  /** Multiplies baked AO and grime into a bucket's vertex colours. */
  bakeBucket(b: Bucket): void {
    const { p, n, c, nv } = b;
    const floorMat = b.mat === 'asphalt' || b.mat === 'dirt' || b.mat === 'tile';
    for (let i = 0; i < nv; i++) {
      const i3 = i * 3, i4 = i * 4;
      const x = p[i3]!, y = p[i3 + 1]!, z = p[i3 + 2]!;
      const nx = n[i3]!, ny = n[i3 + 1]!, nz = n[i3 + 2]!;
      let occ = this.sample(0, x + nx * 1.9, y + ny * 1.9, z + nz * 1.9) * 0.9;
      occ += (1 - occ) * this.sample(1, x + nx * 3.6, y + ny * 3.6, z + nz * 3.6) * 0.8;
      occ += (1 - occ) * this.sample(2, x + nx * 7, y + ny * 7, z + nz * 7) * 0.55;
      // Sky term: what sits above, so interiors and undersides read darker than open yards.
      const sky = this.sample(2, x, y + 11, z) * 0.6 + this.sample(3, x, y + 24, z) * 0.7;
      let ao = (1 - clamp(occ * 1.15)) * (1 - clamp(sky) * 0.45);
      ao = 0.22 + ao * 0.78;

      // Vertical streaks hang off anything upright; flat surfaces get blotches.
      const wall = 1 - Math.abs(ny);
      const blotch = vnoise(x * 0.11, y * 0.11, z * 0.11) * 0.6 + vnoise(x * 0.47, y * 0.47, z * 0.47) * 0.4;
      const streak = vnoise(x * 0.9 + z * 0.9, y * 0.07, z * 0.13);
      let grime = smoothstep(0.42, 0.78, blotch) * 0.55 + wall * smoothstep(0.5, 0.82, streak) * 0.5;
      // Walls collect dirt at the foot, floors at the wall line.
      const foot = this.sample(0, x + nx * 1.1, y - 1.4, z + nz * 1.1);
      grime += wall * foot * 0.45;
      if (floorMat) grime *= 1.2;
      grime = clamp(grime);

      const shade = ao * (1 - grime * 0.55);
      c[i4] = c[i4]! * shade * (1 - grime * 0.06);
      c[i4 + 1] = c[i4 + 1]! * shade * (1 - grime * 0.03);
      c[i4 + 2] = c[i4 + 2]! * shade;
    }
  }

  /** Bakes every non-emissive bucket, yielding between buckets so progress can paint. */
  async bake(geo: Geo, onStep: (fraction: number) => Promise<void>): Promise<void> {
    this.buildMips();
    const buckets = [...geo.buckets.values()].filter(b => !isEmissive(b.mat) && b.mat !== 'glass');
    let done = 0;
    const total = buckets.reduce((s, b) => s + b.nv, 0) || 1;
    for (const b of buckets) {
      this.bakeBucket(b);
      done += b.nv;
      await onStep(done / total);
    }
  }
}

const hash = (x: number, y: number, z: number) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647 - 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Value noise, 0..1. */
export function vnoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iy, iz), b = hash(ix + 1, iy, iz), c = hash(ix, iy + 1, iz), d = hash(ix + 1, iy + 1, iz);
  const e = hash(ix, iy, iz + 1), f = hash(ix + 1, iy, iz + 1), g = hash(ix, iy + 1, iz + 1), h = hash(ix + 1, iy + 1, iz + 1);
  const p = a + (b - a) * fx, q = c + (d - c) * fx, r = e + (f - e) * fx, s = g + (h - g) * fx;
  const t = p + (q - p) * fy, u = r + (s - r) * fy;
  return t + (u - t) * fz;
}
