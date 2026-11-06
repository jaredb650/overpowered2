/**
 * Light volume bake. Pure typed-array code that runs inside a worker.
 *
 * Each cell stores irradiance as L1 spherical harmonics with the cosine convolution already applied:
 * E(n) = c0 + dot(c1, n), per colour channel. A light of irradiance e arriving from direction d adds
 * 0.25 e to c0 and 0.5 e d to c1, which is exact for L1 and needs no constants at evaluation time.
 */

export interface BakeJob {
  nx: number;
  ny: number;
  nz: number;
  /** Fine occupancy cells per voxel on each axis. */
  sub: number;
  /** Fine occupancy, 1 = solid, x fastest, size (nx*sub) * (ny*sub) * (nz*sub). */
  solid: Uint8Array;
  origin: [number, number, number];
  cell: [number, number, number];
  /** x, y, z, r, g, b, intensity, radius per light. Colours are linear. */
  lights: Float32Array;
  /** Colours of the sky at the zenith and the horizon. */
  skyZenith: [number, number, number];
  skyHorizon: [number, number, number];
  bounce: number;
}

export interface BakeResult {
  /** RGBA half floats, one array per texture. 0: DC rgb + sky visibility. 1..3: L1 of r, g, b. */
  textures: [Uint16Array, Uint16Array, Uint16Array, Uint16Array];
}

const floatView = new Float32Array(1);
const intView = new Uint32Array(floatView.buffer);

function toHalf(v: number): number {
  floatView[0] = v;
  const x = intView[0]!;
  const sign = (x >>> 16) & 0x8000;
  let m = (x >>> 12) & 0x07ff;
  const e = (x >>> 23) & 0xff;
  if (e < 103) return sign;
  if (e > 142) return sign | 0x7bff;
  if (e < 113) {
    m |= 0x0800;
    return sign | ((m >> (114 - e)) + ((m >> (113 - e)) & 1));
  }
  const h = sign | ((e - 112) << 10) | (m >> 1);
  return h + (m & 1);
}

export function runBake(job: BakeJob, progress: (fraction: number) => void): BakeResult {
  const { nx, ny, nz, sub, solid, origin, cell, lights } = job;
  const n = nx * ny * nz;
  const fx = nx * sub, fy = ny * sub, fz = nz * sub;
  const fineCell = [cell[0] / sub, cell[1] / sub, cell[2] / sub] as const;
  const stride = nx;
  const layer = nx * ny;
  const fStride = fx;
  const fLayer = fx * fy;

  const dc = new Float32Array(n * 3);
  const lr = new Float32Array(n * 3);
  const lg = new Float32Array(n * 3);
  const lb = new Float32Array(n * 3);
  const sky = new Float32Array(n);
  const open = new Uint8Array(n);

  const half = sub >> 1;
  for (let z = 0, i = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++, i++) {
        const c = (z * sub + half) * fLayer + (y * sub + half) * fStride + x * sub + half;
        open[i] = solid[c]! === 0 ? 1 : 0;
      }
    }
  }

  const blocked = (px: number, py: number, pz: number): boolean => {
    const ix = Math.floor((px - origin[0]) / fineCell[0]);
    const iy = Math.floor((py - origin[1]) / fineCell[1]);
    const iz = Math.floor((pz - origin[2]) / fineCell[2]);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= fx || iy >= fy || iz >= fz) return false;
    return solid[iz * fLayer + iy * fStride + ix] !== 0;
  };

  // Direct light from every source, with shadow rays through the occupancy.
  const lightCount = lights.length / 8;
  const stepLen = Math.min(fineCell[0], fineCell[1], fineCell[2]) * 0.9;
  for (let l = 0; l < lightCount; l++) {
    const o = l * 8;
    const lx = lights[o]!, ly = lights[o + 1]!, lz = lights[o + 2]!;
    const cr = lights[o + 3]!, cg = lights[o + 4]!, cb = lights[o + 5]!;
    const intensity = lights[o + 6]!, radius = lights[o + 7]!;
    const x0 = Math.max(0, Math.floor((lx - radius - origin[0]) / cell[0]));
    const x1 = Math.min(nx - 1, Math.ceil((lx + radius - origin[0]) / cell[0]));
    const y0 = Math.max(0, Math.floor((ly - radius - origin[1]) / cell[1]));
    const y1 = Math.min(ny - 1, Math.ceil((ly + radius - origin[1]) / cell[1]));
    const z0 = Math.max(0, Math.floor((lz - radius - origin[2]) / cell[2]));
    const z1 = Math.min(nz - 1, Math.ceil((lz + radius - origin[2]) / cell[2]));
    // A lamp is usually mounted on a surface, so skip the first stretch of the ray next to it.
    const lampClear = Math.max(cell[0], cell[1], cell[2]) * 0.75;
    for (let z = z0; z <= z1; z++) {
      const pz = origin[2] + (z + 0.5) * cell[2];
      for (let y = y0; y <= y1; y++) {
        const py = origin[1] + (y + 0.5) * cell[1];
        for (let x = x0; x <= x1; x++) {
          const i = z * layer + y * stride + x;
          if (open[i] === 0) continue;
          const px = origin[0] + (x + 0.5) * cell[0];
          const dx = lx - px, dy = ly - py, dz = lz - pz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= radius * radius) continue;
          const d = Math.sqrt(d2);
          const inv = 1 / Math.max(d, 1e-3);
          const ux = dx * inv, uy = dy * inv, uz = dz * inv;
          let visible = true;
          for (let t = stepLen; t < d - lampClear; t += stepLen) {
            if (blocked(px + ux * t, py + uy * t, pz + uz * t)) {
              visible = false;
              break;
            }
          }
          if (!visible) continue;
          const r4 = d2 * d2 / (radius * radius * radius * radius);
          const window = (1 - r4) * (1 - r4);
          const e = intensity * window / Math.max(d2, 0.6);
          const er = e * cr, eg = e * cg, eb = e * cb;
          const k = i * 3;
          dc[k] += er * 0.25;
          dc[k + 1] += eg * 0.25;
          dc[k + 2] += eb * 0.25;
          lr[k] += er * 0.5 * ux;
          lr[k + 1] += er * 0.5 * uy;
          lr[k + 2] += er * 0.5 * uz;
          lg[k] += eg * 0.5 * ux;
          lg[k + 1] += eg * 0.5 * uy;
          lg[k + 2] += eg * 0.5 * uz;
          lb[k] += eb * 0.5 * ux;
          lb[k + 1] += eb * 0.5 * uy;
          lb[k + 2] += eb * 0.5 * uz;
        }
      }
    }
    if ((l & 7) === 0) progress(0.5 * l / Math.max(lightCount, 1));
  }

  // Sky: one shear sweep per direction. Instead of marching a ray per cell, visibility is carried down
  // the grid layer by layer, so a direction costs one pass over the volume no matter how far it reaches.
  const dirs = skyDirections();
  const visA = new Float32Array(fx * fz);
  const visB = new Float32Array(fx * fz);
  const fineStepRatioX = fineCell[1] / fineCell[0];
  const fineStepRatioZ = fineCell[1] / fineCell[2];
  for (let di = 0; di < dirs.length; di++) {
    const [ux, uy, uz, solidAngle] = dirs[di]!;
    const t = 1 - Math.pow(1 - uy, 2);
    const lumR = job.skyHorizon[0] + (job.skyZenith[0] - job.skyHorizon[0]) * t;
    const lumG = job.skyHorizon[1] + (job.skyZenith[1] - job.skyHorizon[1]) * t;
    const lumB = job.skyHorizon[2] + (job.skyZenith[2] - job.skyHorizon[2]) * t;
    const shiftX = (ux / uy) * fineStepRatioX;
    const shiftZ = (uz / uy) * fineStepRatioZ;
    visA.fill(1);
    let prev = visA, cur = visB;
    for (let fyi = fy - 1; fyi >= 0; fyi--) {
      for (let zi = 0; zi < fz; zi++) {
        const sz = zi + shiftZ;
        const zf = Math.floor(sz);
        const tz = sz - zf;
        for (let xi = 0; xi < fx; xi++) {
          if (solid[zi * fLayer + fyi * fStride + xi] !== 0) {
            cur[zi * fx + xi] = 0;
            continue;
          }
          const sx = xi + shiftX;
          const xf = Math.floor(sx);
          const tx = sx - xf;
          // Beyond the grid is open sky.
          const a = xf < 0 || zf < 0 || xf >= fx || zf >= fz ? 1 : prev[zf * fx + xf]!;
          const b = xf + 1 < 0 || zf < 0 || xf + 1 >= fx || zf >= fz ? 1 : prev[zf * fx + xf + 1]!;
          const c = xf < 0 || zf + 1 < 0 || xf >= fx || zf + 1 >= fz ? 1 : prev[(zf + 1) * fx + xf]!;
          const d = xf + 1 < 0 || zf + 1 < 0 || xf + 1 >= fx || zf + 1 >= fz ? 1 : prev[(zf + 1) * fx + xf + 1]!;
          cur[zi * fx + xi] = (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
        }
      }
      if (fyi % sub === half % sub) {
        const y = (fyi - (half % sub)) / sub;
        for (let z = 0; z < nz; z++) {
          for (let x = 0; x < nx; x++) {
            const v = cur[(z * sub + half) * fx + x * sub + half]!;
            if (v <= 0) continue;
            const i = z * layer + y * stride + x;
            const w = v * solidAngle;
            const k = i * 3;
            const er = w * lumR, eg = w * lumG, eb = w * lumB;
            dc[k] += er * 0.25;
            dc[k + 1] += eg * 0.25;
            dc[k + 2] += eb * 0.25;
            lr[k] += er * 0.5 * ux;
            lr[k + 1] += er * 0.5 * uy;
            lr[k + 2] += er * 0.5 * uz;
            lg[k] += eg * 0.5 * ux;
            lg[k + 1] += eg * 0.5 * uy;
            lg[k + 2] += eg * 0.5 * uz;
            lb[k] += eb * 0.5 * ux;
            lb[k + 1] += eb * 0.5 * uy;
            lb[k + 2] += eb * 0.5 * uz;
            sky[i] += w * uy / Math.PI;
          }
        }
      }
      const tmp = prev;
      prev = cur;
      cur = tmp;
    }
    progress(0.5 + 0.25 * di / dirs.length);
  }

  // Bounce: cells next to a surface re-emit what lands there, and the result diffuses through open
  // space only. It cannot leak through walls, and its gradient gives it a direction.
  if (job.bounce > 0) {
    const src = new Float32Array(n * 3);
    const neighbours: [number, number, number, number][] = [
      [1, 0, 0, 1], [-1, 0, 0, -1], [0, 1, 0, stride], [0, -1, 0, -stride], [0, 0, 1, layer], [0, 0, -1, -layer],
    ];
    for (let z = 0, i = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++, i++) {
          if (open[i] === 0) continue;
          for (const [ox, oy, oz, off] of neighbours) {
            const qx = x + ox, qy = y + oy, qz = z + oz;
            if (qx < 0 || qy < 0 || qz < 0 || qx >= nx || qy >= ny || qz >= nz) continue;
            if (open[i + off] !== 0) continue;
            const k = i * 3;
            // Irradiance on the surface facing this cell: E(n) with n pointing from the wall into the open.
            const er = Math.max(dc[k]! - (lr[k]! * ox + lr[k + 1]! * oy + lr[k + 2]! * oz), 0);
            const eg = Math.max(dc[k + 1]! - (lg[k]! * ox + lg[k + 1]! * oy + lg[k + 2]! * oz), 0);
            const eb = Math.max(dc[k + 2]! - (lb[k]! * ox + lb[k + 1]! * oy + lb[k + 2]! * oz), 0);
            src[k] = Math.max(src[k]!, er);
            src[k + 1] = Math.max(src[k + 1]!, eg);
            src[k + 2] = Math.max(src[k + 2]!, eb);
          }
        }
      }
    }
    let fA = src.slice();
    let fB = new Float32Array(n * 3);
    const iterations = 10;
    for (let it = 0; it < iterations; it++) {
      for (let z = 0, i = 0; z < nz; z++) {
        for (let y = 0; y < ny; y++) {
          for (let x = 0; x < nx; x++, i++) {
            const k = i * 3;
            if (open[i] === 0) {
              fB[k] = fB[k + 1] = fB[k + 2] = 0;
              continue;
            }
            let r = 0, g = 0, b = 0, c = 0;
            if (x > 0 && open[i - 1]) { const q = k - 3; r += fA[q]!; g += fA[q + 1]!; b += fA[q + 2]!; c++; }
            if (x < nx - 1 && open[i + 1]) { const q = k + 3; r += fA[q]!; g += fA[q + 1]!; b += fA[q + 2]!; c++; }
            if (y > 0 && open[i - stride]) { const q = k - stride * 3; r += fA[q]!; g += fA[q + 1]!; b += fA[q + 2]!; c++; }
            if (y < ny - 1 && open[i + stride]) { const q = k + stride * 3; r += fA[q]!; g += fA[q + 1]!; b += fA[q + 2]!; c++; }
            if (z > 0 && open[i - layer]) { const q = k - layer * 3; r += fA[q]!; g += fA[q + 1]!; b += fA[q + 2]!; c++; }
            if (z < nz - 1 && open[i + layer]) { const q = k + layer * 3; r += fA[q]!; g += fA[q + 1]!; b += fA[q + 2]!; c++; }
            if (c === 0) {
              fB[k] = fB[k + 1] = fB[k + 2] = 0;
              continue;
            }
            const inv = 0.985 / c;
            const s = src[k]! + src[k + 1]! + src[k + 2]!;
            // Surface cells hold on to their source; open cells only relay.
            const hold = s > 0 ? 0.5 : 0;
            fB[k] = src[k]! * hold + r * inv * (1 - hold);
            fB[k + 1] = src[k + 1]! * hold + g * inv * (1 - hold);
            fB[k + 2] = src[k + 2]! * hold + b * inv * (1 - hold);
          }
        }
      }
      const tmp = fA;
      fA = fB;
      fB = tmp;
    }
    const gain = job.bounce;
    for (let z = 0, i = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++, i++) {
          if (open[i] === 0) continue;
          const k = i * 3;
          const xp = x < nx - 1 && open[i + 1] ? k + 3 : k;
          const xm = x > 0 && open[i - 1] ? k - 3 : k;
          const yp = y < ny - 1 && open[i + stride] ? k + stride * 3 : k;
          const ym = y > 0 && open[i - stride] ? k - stride * 3 : k;
          const zp = z < nz - 1 && open[i + layer] ? k + layer * 3 : k;
          const zm = z > 0 && open[i - layer] ? k - layer * 3 : k;
          const gradScale = 0.5 * gain;
          for (let ch = 0; ch < 3; ch++) {
            dc[k + ch]! += fA[k + ch]! * gain;
            const coef = ch === 0 ? lr : ch === 1 ? lg : lb;
            coef[k]! += (fA[xp + ch]! - fA[xm + ch]!) * gradScale;
            coef[k + 1]! += (fA[yp + ch]! - fA[ym + ch]!) * gradScale;
            coef[k + 2]! += (fA[zp + ch]! - fA[zm + ch]!) * gradScale;
          }
        }
      }
    }
  }
  progress(0.85);

  // Cells inside solids hold no light, and trilinear filtering would pull surfaces toward black.
  // Fill each from its open neighbours, twice, so every surface sees valid data on both sides.
  const filled = open.slice();
  for (let pass = 0; pass < 2; pass++) {
    const newly: number[] = [];
    for (let z = 0, i = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++, i++) {
          if (filled[i] !== 0) continue;
          let w = 0;
          const k = i * 3;
          let d0 = 0, d1 = 0, d2 = 0, s = 0;
          const a = [0, 0, 0, 0, 0, 0, 0, 0, 0];
          for (let oz = -1; oz <= 1; oz++) {
            const qz = z + oz;
            if (qz < 0 || qz >= nz) continue;
            for (let oy = -1; oy <= 1; oy++) {
              const qy = y + oy;
              if (qy < 0 || qy >= ny) continue;
              for (let ox = -1; ox <= 1; ox++) {
                const qx = x + ox;
                if (qx < 0 || qx >= nx) continue;
                const q = qz * layer + qy * stride + qx;
                if (filled[q] === 0) continue;
                const wt = 1 / (1 + Math.abs(ox) + Math.abs(oy) + Math.abs(oz));
                const m = q * 3;
                w += wt;
                d0 += dc[m]! * wt;
                d1 += dc[m + 1]! * wt;
                d2 += dc[m + 2]! * wt;
                s += sky[q]! * wt;
                for (let c = 0; c < 3; c++) {
                  a[c] += lr[m + c]! * wt;
                  a[3 + c] += lg[m + c]! * wt;
                  a[6 + c] += lb[m + c]! * wt;
                }
              }
            }
          }
          if (w === 0) continue;
          const inv = 1 / w;
          dc[k] = d0 * inv;
          dc[k + 1] = d1 * inv;
          dc[k + 2] = d2 * inv;
          sky[i] = s * inv;
          for (let c = 0; c < 3; c++) {
            lr[k + c] = a[c]! * inv;
            lg[k + c] = a[3 + c]! * inv;
            lb[k + c] = a[6 + c]! * inv;
          }
          newly.push(i);
        }
      }
    }
    for (const i of newly) filled[i] = 1;
  }
  progress(0.92);

  const t0 = new Uint16Array(n * 4);
  const t1 = new Uint16Array(n * 4);
  const t2 = new Uint16Array(n * 4);
  const t3 = new Uint16Array(n * 4);
  for (let i = 0; i < n; i++) {
    const k = i * 3, q = i * 4;
    t0[q] = toHalf(dc[k]!);
    t0[q + 1] = toHalf(dc[k + 1]!);
    t0[q + 2] = toHalf(dc[k + 2]!);
    t0[q + 3] = toHalf(Math.min(sky[i]!, 1));
    t1[q] = toHalf(lr[k]!);
    t1[q + 1] = toHalf(lr[k + 1]!);
    t1[q + 2] = toHalf(lr[k + 2]!);
    t2[q] = toHalf(lg[k]!);
    t2[q + 1] = toHalf(lg[k + 1]!);
    t2[q + 2] = toHalf(lg[k + 2]!);
    t3[q] = toHalf(lb[k]!);
    t3[q + 1] = toHalf(lb[k + 1]!);
    t3[q + 2] = toHalf(lb[k + 2]!);
  }
  progress(1);
  return { textures: [t0, t1, t2, t3] };
}

/** Stratified upper-hemisphere directions: x, y, z, solid angle. */
function skyDirections(): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const rings = [
    { y: 0.92, count: 3 },
    { y: 0.68, count: 6 },
    { y: 0.36, count: 9 },
  ];
  // Rings split the hemisphere into equal-height bands, which are equal solid angle per unit height.
  const bands = [[0.8, 1], [0.5, 0.8], [0.22, 0.5]] as const;
  rings.forEach((ring, r) => {
    const [lo, hi] = bands[r]!;
    const area = 2 * Math.PI * (hi - lo);
    for (let i = 0; i < ring.count; i++) {
      const a = (i + r * 0.37) / ring.count * Math.PI * 2;
      const s = Math.sqrt(1 - ring.y * ring.y);
      out.push([Math.cos(a) * s, ring.y, Math.sin(a) * s, area / ring.count]);
    }
  });
  return out;
}
