/**
 * The ground level as one marching-squares sheet. Holes (the bowl, trenches, pits, the lava channel) are signed
 * distance functions, so curved and rotated cuts clip cleanly with no authored mesh per hole. The same field
 * drives a greedy rectangle cover for the colliders: boxes are cheaper to query and solid, unlike a thin trimesh.
 */
import type { Kit } from '../kit/kit';
import { surfaceOf } from '../kit/kit';
import type { Mat } from '../kit/geo';
import { BOWL, DIAGONALS, HALL, LAVA, PIT, RING, SUMP, TRENCH, VIADUCT } from './layout';

const CELL = 2;
const EXTENT = 176;

type Field = (x: number, z: number) => number;

const rect = (x0: number, z0: number, x1: number, z1: number): Field =>
  (x, z) => Math.max(x0 - x, x - x1, z0 - z, z - z1);
const circle = (cx: number, cz: number, r: number): Field => (x, z) => Math.hypot(x - cx, z - cz) - r;
/** Rectangle on a radial axis: `ux, uz` is the unit axis, r0..r1 the span along it, hw the half width across. */
const radial = (ux: number, uz: number, r0: number, r1: number, hw: number): Field => (x, z) => {
  const a = x * ux + z * uz, b = -x * uz + z * ux;
  return Math.max(r0 - a, a - r1, Math.abs(b) - hw);
};

const holes: Field[] = [
  circle(0, 0, BOWL.radius),
  rect(TRENCH.x0, TRENCH.z0, TRENCH.x1, TRENCH.z1),
  rect(PIT.x0, PIT.z0, PIT.x1, PIT.z1),
  rect(SUMP.x0, SUMP.z0, SUMP.x1, SUMP.z1),
  rect(LAVA.x0, LAVA.z0, LAVA.x1, LAVA.galleryZ1),
  ...DIAGONALS.map(([ux, uz]) => radial(ux, uz, BOWL.radius - 4, VIADUCT.r0, VIADUCT.width / 2)),
];

const field: Field = (x, z) => {
  let d = 1e9;
  for (const h of holes) {
    const v = h(x, z);
    if (v < d) d = v;
  }
  return d;
};

/** Which zone paints this cell. Zone seams sit under walls, so a hard tile edge never shows. */
function materialAt(x: number, z: number): Mat {
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax > RING.half - RING.width / 2 - 2 || az > RING.half - RING.width / 2 - 2) return 'asphalt';
  if (z < HALL.z1) return ax <= HALL.x ? 'concreteDark' : x < 0 ? 'dirt' : 'concrete';
  if (z > 70) {
    // Scrapyard: packed dirt, with haul roads through it.
    const road = Math.abs(z - 84) < 7 || Math.abs(z - 132) < 5 || Math.abs(x - 62) < 6 || Math.abs(x + 62) < 6;
    return road ? 'asphalt' : 'dirt';
  }
  if (x < -70) return 'tile';
  if (x > 70) return Math.abs(z) < 7 || Math.abs(x - 84) < 6 ? 'asphalt' : 'concrete';
  if (Math.hypot(x, z) < BOWL.rim) return 'concrete';
  return 'asphalt';
}

const clipBuf: number[] = [];

/** Clips a cell to the outside of the holes. Corners are CCW from above when seen with +z toward the viewer. */
function emitCell(k: Kit, x0: number, z0: number, d: number, f00: number, f10: number, f11: number, f01: number): void {
  const x1 = x0 + d, z1 = z0 + d;
  const corners = [x0, z0, f00, x1, z0, f10, x1, z1, f11, x0, z1, f01];
  clipBuf.length = 0;
  for (let i = 0; i < 4; i++) {
    const ax = corners[i * 3]!, az = corners[i * 3 + 1]!, af = corners[i * 3 + 2]!;
    const j = (i + 1) & 3;
    const bx = corners[j * 3]!, bz = corners[j * 3 + 1]!, bf = corners[j * 3 + 2]!;
    if (af >= 0) clipBuf.push(ax, az);
    if ((af >= 0) !== (bf >= 0)) {
      const t = af / (af - bf);
      clipBuf.push(ax + (bx - ax) * t, az + (bz - az) * t);
    }
  }
  if (clipBuf.length >= 6) k.geo.fan(clipBuf, 0);
}

/** Lit lines down each spoke, from the rim to the zone beyond it: the eye follows them before the feet do. */
function spokeLines(k: Kit): void {
  for (const [ux, uz] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
    const px = -uz, pz = ux;
    for (const s of [-6, 6]) {
      for (let r = 50; r < 76; r += 4) {
        k.stripLine([ux * r + px * s, 0, uz * r + pz * s, ux * (r + 2.4) + px * s, 0, uz * (r + 2.4) + pz * s], 0.16);
      }
    }
  }
}

export function authorGround(k: Kit): void {
  spokeLines(k);
  // Beyond the outer wall: only seen from the Crown and the high pads, and the fog finishes the job.
  const far = 3000;
  k.geo.use('asphalt').tint(0.4);
  for (const [x0, z0, x1, z1] of [[-far, -far, far, -EXTENT], [-far, EXTENT, far, far], [-far, -EXTENT, -EXTENT, EXTENT], [EXTENT, -EXTENT, far, EXTENT]] as const) {
    k.geo.quad(x0, -0.2, z1, x1, -0.2, z1, x1, -0.2, z0, x0, -0.2, z0);
  }
  k.geo.tint(1);

  const n = Math.ceil((EXTENT * 2) / CELL);
  const stride = n + 1;
  const f = new Float32Array(stride * stride);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) f[j * stride + i] = field(-EXTENT + i * CELL, -EXTENT + j * CELL);

  const cellSurf = new Int8Array(n * n).fill(-1);
  const surfaces = new Map<string, number>();
  const surfaceNames: string[] = [];
  const g = k.geo;

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = f[j * stride + i]!, b = f[j * stride + i + 1]!, c = f[(j + 1) * stride + i + 1]!, d = f[(j + 1) * stride + i]!;
      if (a < 0 && b < 0 && c < 0 && d < 0) continue;
      const x = -EXTENT + i * CELL, z = -EXTENT + j * CELL;
      const m = materialAt(x + CELL / 2, z + CELL / 2);
      g.use(m);
      if (a >= 0 && b >= 0 && c >= 0 && d >= 0) {
        g.quad(x, 0, z + CELL, x + CELL, 0, z + CELL, x + CELL, 0, z, x, 0, z);
        const s = surfaceOf(m);
        let id = surfaces.get(s);
        if (id === undefined) { id = surfaceNames.length; surfaces.set(s, id); surfaceNames.push(s); }
        cellSurf[j * n + i] = id;
      } else {
        emitCell(k, x, z, CELL, a, b, c, d);
      }
    }
  }

  // Greedy rectangles over fully solid cells, grouped by surface.
  const used = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const s = cellSurf[j * n + i]!;
      if (s < 0 || used[j * n + i]) continue;
      let w = 1;
      while (i + w < n && cellSurf[j * n + i + w] === s && !used[j * n + i + w]) w++;
      let h = 1;
      grow: while (j + h < n) {
        for (let q = 0; q < w; q++) {
          if (cellSurf[(j + h) * n + i + q] !== s || used[(j + h) * n + i + q]) break grow;
        }
        h++;
      }
      for (let q = 0; q < h; q++) used.fill(1, (j + q) * n + i, (j + q) * n + i + w);
      const hx = (w * CELL) / 2, hz = (h * CELL) / 2;
      k.collide(-EXTENT + i * CELL + hx, -1, -EXTENT + j * CELL + hz, hx, 1, hz, surfaceNames[s] as ReturnType<typeof surfaceOf>);
    }
  }
}
