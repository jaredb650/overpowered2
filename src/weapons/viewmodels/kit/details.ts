/** Small hard-surface details: the screws, rails and knurling that sell the scale of the big shapes. */
import { Kind, type Finish, type Mesher, type V3 } from './mesher';
import { poly, type V2 } from './shapes';
import { F } from './finishes';

/** Socket-head screw standing on the local XY plane, axis +Z. */
export function screw(m: Mesher, r = 0.0021, finish: Finish = F.steelDark): void {
  const h = r * 0.5;
  m.use(finish);
  m.lathe([[r * 0.52, h * 0.3, 0], [r * 0.52, h, 0], [r, h], [r * 1.02, 0, 0]], 10, { chamfer: r * 0.18 });
  m.use(F.black);
  m.lathe([[0, h * 0.3, 0], [r * 0.56, h * 0.3, 0]], 6, { chamfer: 0 });
}

/** Screw on a surface facing +X or -X (sign), at (y, z) on the plane x. */
export function screwX(m: Mesher, x: number, y: number, z: number, sign: 1 | -1, r?: number, finish?: Finish): void {
  m.at([x, y, z], [0, (sign * Math.PI) / 2, 0], () => screw(m, r, finish));
}

export function screwY(m: Mesher, x: number, y: number, z: number, r?: number, finish?: Finish): void {
  m.at([x, y, z], [-Math.PI / 2, 0, 0], () => screw(m, r, finish));
}

/** Hex bolt head with a washer, axis +Z. */
export function hexBolt(m: Mesher, r = 0.0042, finish: Finish = F.steelDark): void {
  m.use(finish);
  m.lathe([[r * 1.35, r * 0.18, 0], [r * 1.35, 0, 0]], 12, { chamfer: 0 });
  m.at([0, 0, r * 0.18], null, () => m.prism(ngonLoop(r, 6), r * 0.8, { bevel: r * 0.14 }));
}

function ngonLoop(r: number, n: number): V2[] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push([Math.cos((i / n) * Math.PI * 2) * r, Math.sin((i / n) * Math.PI * 2) * r]);
  return out;
}

/** Hex bolt on a surface facing +X or -X. */
export function hexX(m: Mesher, x: number, y: number, z: number, sign: 1 | -1, r?: number, finish?: Finish): void {
  m.at([x, y, z], [0, (sign * Math.PI) / 2, 0], () => hexBolt(m, r, finish));
}

/** Dome rivet, axis +Z. */
export function rivet(m: Mesher, r = 0.0016, finish: Finish = F.steelDark): void {
  m.use(finish);
  m.lathe([[0, r * 0.6, 0], [r * 0.6, r * 0.5, 0], [r * 0.95, r * 0.2, 0], [r, 0, 0]], 8);
}

/** MIL-STD-1913 rail along Z from z0 to z1, base on y = 0. */
export function rail(m: Mesher, z0: number, z1: number, width = 0.0212, finish: Finish = F.anodized): void {
  const hw = width / 2;
  m.use(finish);
  const zc = (z0 + z1) / 2;
  const len = Math.abs(z1 - z0);
  m.at([0, 0, zc], null, () => {
    m.front(poly([[-hw * 0.72, 0], [hw * 0.72, 0], [hw * 0.72, 0.0032], [-hw * 0.72, 0.0032]], 0.0004), len, { bevel: 0.0005 });
  });
  const pitch = 0.01;
  const count = Math.floor(len / pitch);
  const tooth: V2[] = poly([
    [-hw * 0.72, 0.0028], [-hw, 0.0042], [-hw, 0.0058], [-hw * 0.76, 0.0074], [hw * 0.76, 0.0074], [hw, 0.0058], [hw, 0.0042], [hw * 0.72, 0.0028],
  ], 0.0003, 1);
  const start = Math.min(z0, z1) + (len - (count - 1) * pitch) / 2;
  for (let i = 0; i < count; i++) {
    m.at([0, 0, start + i * pitch], null, () => m.front(tooth, 0.0052, { bevel: 0.0005 }));
  }
}

/** Straight-cut knurled band along Z, centred on the origin. */
export function knurl(m: Mesher, r: number, length: number, finish: Finish, teeth = 40, depth = 0.0006): void {
  m.use(finish);
  const n = teeth * 2;
  const h = length / 2;
  m.surface(n, 6, (u, t, out) => {
    const i = Math.round(u * n);
    const j = Math.round(t * 6);
    const ring = i % 2 === 0 ? 0 : -depth;
    // A fine diamond, not plain ribs: the rows alternate which column stands proud.
    const dia = (i + j) % 2 === 0 ? 0 : -depth * 0.5;
    const a = u * Math.PI * 2;
    const rr = r + ring * 0.5 + dia;
    out.set(Math.cos(a) * rr, Math.sin(a) * rr, h - t * length);
  }, { wrapU: true, flip: false });
}

/** Coil spring along Z, centred on the origin. */
export function coil(m: Mesher, r: number, wire: number, length: number, turns: number, finish: Finish = F.steel): void {
  m.use(finish);
  const pts: V3[] = [];
  const n = Math.ceil(turns * 10);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * Math.PI * 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r, length / 2 - t * length]);
  }
  m.tube(pts, wire, { seg: 5, straight: true, caps: false });
}

/** Rows of parallel raised ribs on a flat surface, the classic slide-serration shape. */
export function serrations(m: Mesher, count: number, pitch: number, depth: number, height: number, width: number, finish: Finish): void {
  m.use(finish);
  const prof: V2[] = [[-depth, -height / 2], [depth * 0.6, -height / 2], [depth * 0.6, height / 2], [-depth, height / 2]];
  for (let i = 0; i < count; i++) {
    m.at([0, 0, (i - (count - 1) / 2) * pitch], null, () => m.prism(prof, width, { bevel: 0.0003 }));
  }
}

/** Hose clamp around a tube along Z. */
export function clampBand(m: Mesher, r: number, width: number, finish: Finish = F.steel): void {
  m.use(finish);
  m.lathe([[r - 0.0002, width / 2, 0], [r + 0.0009, width / 2], [r + 0.0009, -width / 2], [r - 0.0002, -width / 2, 0]], 18);
  m.at([r + 0.002, 0, 0], null, () => m.box(0.0035, 0.006, width + 0.002, 0.0005));
}

/** Corrugated hose along a path. */
export function hose(m: Mesher, path: readonly V3[], r: number, ribs: number, finish: Finish = F.rubber): void {
  m.use(finish);
  m.tube(path, t => r * (1 + 0.1 * Math.cos(t * ribs * Math.PI * 2)), { seg: 8, samples: ribs * 5 });
}

export { Kind };
