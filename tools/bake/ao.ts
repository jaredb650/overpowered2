/** Ambient occlusion sampled from the distance field. Distance fields make this nearly free: no rays to trace. */
import { Field } from './model';

const DIRS: readonly (readonly [number, number])[] = [
  [0, 0], [0.75, 0], [-0.75, 0], [0, 0.75], [0, -0.75], [0.55, 0.55], [-0.55, 0.55], [0.55, -0.55], [-0.55, -0.55],
];
const STEPS = [0.012, 0.03, 0.07, 0.14];

export function occlusion(field: Field, x: number, y: number, z: number, nx: number, ny: number, nz: number, reach = 1): number {
  const ax = Math.abs(ny) < 0.9 ? 0 : 1, ay = Math.abs(ny) < 0.9 ? 1 : 0;
  let tx = ay * nz, ty = -ax * nz, tz = ax * ny - ay * nx;
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl; ty /= tl; tz /= tl;
  const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
  let occ = 0, total = 0;
  for (const [u, v] of DIRS) {
    let dx = nx + tx * u + bx * v, dy = ny + ty * u + by * v, dz = nz + tz * u + bz * v;
    const l = 1 / Math.hypot(dx, dy, dz);
    dx *= l; dy *= l; dz *= l;
    for (let s = 0; s < STEPS.length; s++) {
      const h = STEPS[s]! * reach;
      const w = 1 / (s + 1);
      const d = field.dist(x + dx * h, y + dy * h, z + dz * h);
      occ += w * Math.max(0, Math.min(1, (h - d) / h));
      total += w;
    }
  }
  return 1 - Math.min(1, (occ / total) * 1.6);
}
