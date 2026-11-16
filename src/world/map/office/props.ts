/**
 * The office's furniture that stays put: desks, cabinets, shelves, counters, tables, sofas, the reception desk, signs and the
 * ceiling. Everything here is merged into the static map. What breaks is placed beside it as a breakable (`spec.breakable`).
 * Anything with a collider upstairs is at least 0.5 m tall, so no nav drop link reaches through the slab under it.
 */
import { FACE, type Mat } from '../../kit/geo';
import { signId, type SignName } from '../../kit/signs';
import type { Builder } from './build';
import type { Rgb } from './plan';

const WOOD: Rgb = [0.62, 0.48, 0.34];
const LAMINATE: Rgb = [0.84, 0.84, 0.82];
const METAL: Rgb = [0.5, 0.53, 0.58];
const DARK: Rgb = [0.2, 0.21, 0.24];

/** Runs `fn` in a frame at (x, y, z) turned `yaw`. */
export function at(b: Builder, x: number, y: number, z: number, yaw: number, fn: () => void): void {
  b.k.push(x, y, z, yaw);
  fn();
  b.k.pop();
}

/** A local box, bevelled, painted. With `solid` it gets a collider in the same frame. */
function part(b: Builder, mat: Mat, tint: Rgb, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, solid = false, bev = 0.02): void {
  b.g.use(mat).tint(tint[0], tint[1], tint[2]);
  if (bev > 0) b.g.bevel((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, bev);
  else b.g.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2);
  b.g.tint(1);
  if (solid) b.k.collide((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, mat === 'plywood' ? 'concrete' : 'metal');
}

/** A desk, 1.6 by 0.8, its user on local +z. A pedestal of drawers, a keyboard, papers, sometimes a mug. */
export function desk(b: Builder, x: number, y: number, z: number, yaw: number, top: Rgb = LAMINATE): void {
  at(b, x, y, z, yaw, () => {
    part(b, 'plaster', top, -0.8, 0.72, -0.4, 0.8, 0.76, 0.4, false, 0.012);
    part(b, 'steel', METAL, -0.78, 0, -0.38, -0.74, 0.72, 0.38);
    part(b, 'plaster', [0.6, 0.62, 0.66], 0.32, 0, -0.36, 0.76, 0.7, 0.3);
    part(b, 'steelDark', DARK, 0.34, 0.24, 0.3, 0.74, 0.25, 0.31, false, 0);
    part(b, 'steelDark', DARK, 0.34, 0.47, 0.3, 0.74, 0.48, 0.31, false, 0);
    part(b, 'plaster', [0.6, 0.62, 0.66], -0.76, 0.1, -0.39, 0.3, 0.6, -0.37, false, 0);
    part(b, 'rubber', DARK, -0.25, 0.76, 0.06, 0.2, 0.78, 0.22, false, 0.005);
    if (b.k.rng() > 0.3) part(b, 'paintWhite', [1, 1, 0.96], 0.3, 0.76, -0.05, 0.6, 0.79, 0.3, false, 0.002);
    if (b.k.rng() > 0.5) b.g.use('paintWhite').tint(b.k.rand(0.5, 1), 0.3, 0.3).cyl(-0.55, 0.76, 0.2, -0.55, 0.86, 0.2, 0.04, 0.04, 8);
    b.g.tint(1);
    b.k.collide(0, 0.38, 0, 0.8, 0.38, 0.4, 'metal');
  });
}

/** Four desks back to back, the pod's middle at (x, z). The dividers and what sits on the desks are breakables. */
export function pod(b: Builder, x: number, y: number, z: number): void {
  for (const s of [-1, 1]) for (const e of [-1, 1]) {
    desk(b, x + e * 0.8, y, z + s * 0.42, s > 0 ? 0 : Math.PI);
    b.spec.breakable('monitor', x + e * 0.8 + b.k.rand(-0.15, 0.15), y + 0.76, z + s * 0.24, s > 0 ? 0 : Math.PI);
    b.spec.breakable('chair', x + e * 0.8 + b.k.rand(-0.2, 0.2), y, z + s * 1.35, (s > 0 ? Math.PI : 0) + b.k.rand(-0.5, 0.5));
  }
  b.spec.breakable('divider', x, y + 0.76, z, 0, 3.2, 0.5);
  b.spec.breakable('divider', x, y + 0.76, z, Math.PI / 2, 1.6, 0.4);
  b.block(x - 1.6, z - 0.84, x + 1.6, z + 0.84);
}

/** A run of filing cabinets against a wall, their backs on local -z. */
export function cabinets(b: Builder, x: number, y: number, z: number, yaw: number, n: number, h = 1.32, tint: Rgb = [0.62, 0.64, 0.66]): void {
  at(b, x, y, z, yaw, () => {
    const w = 0.48;
    for (let i = 0; i < n; i++) {
      const u = (i - (n - 1) / 2) * w;
      part(b, 'paintWhite', tint, u - w / 2 + 0.01, 0, 0, u + w / 2 - 0.01, h, 0.62);
      for (let d = 0; d < Math.round(h / 0.33); d++) part(b, 'steelDark', DARK, u - 0.1, 0.2 + d * 0.33, 0.62, u + 0.1, 0.23 + d * 0.33, 0.64, false, 0);
    }
    b.k.collide(0, h / 2, 0.31, (n * w) / 2, h / 2, 0.31, 'metal');
  });
}

/** A shelving unit of binders and boxes, its back on local -z. */
export function shelves(b: Builder, x: number, y: number, z: number, yaw: number, w = 1.8, h = 2.1, d = 0.45): void {
  at(b, x, y, z, yaw, () => {
    part(b, 'steel', METAL, -w / 2, 0, 0, -w / 2 + 0.04, h, d, false, 0.005);
    part(b, 'steel', METAL, w / 2 - 0.04, 0, 0, w / 2, h, d, false, 0.005);
    const rows = Math.round(h / 0.42);
    for (let r = 0; r <= rows; r++) {
      const y0 = (r * h) / rows;
      part(b, 'steel', METAL, -w / 2, y0, 0, w / 2, y0 + 0.025, d, false, 0);
      if (r === rows) break;
      let u = -w / 2 + 0.06;
      while (u < w / 2 - 0.12) {
        const bw = b.k.rand(0.06, 0.12), bh = b.k.rand(0.24, 0.34);
        const box = b.k.rng() > 0.8;
        const c: Rgb = box ? [0.6, 0.48, 0.32] : ([[0.2, 0.3, 0.6], [0.7, 0.2, 0.2], [0.2, 0.5, 0.3], [0.8, 0.8, 0.76], [0.2, 0.2, 0.22]] as Rgb[])[Math.floor(b.k.rng() * 5)]!;
        const ww = box ? 0.32 : bw;
        if (u + ww > w / 2 - 0.06) break;
        part(b, box ? 'plywood' : 'paintWhite', c, u, y0 + 0.025, 0.04, u + ww, y0 + 0.025 + (box ? 0.26 : bh), d - 0.04, false, 0.004);
        u += ww + 0.01;
      }
    }
    b.k.collide(0, h / 2, d / 2, w / 2, h / 2, d / 2, 'metal');
  });
}

/** A kitchen counter with base cabinets and a sink, its back on local -z. */
export function counter(b: Builder, x: number, y: number, z: number, yaw: number, w: number, sink = true, upper = true): void {
  at(b, x, y, z, yaw, () => {
    part(b, 'plaster', [0.78, 0.74, 0.66], -w / 2, 0, 0, w / 2, 0.86, 0.6, true);
    part(b, 'tile', [0.36, 0.38, 0.4], -w / 2 - 0.02, 0.86, -0.02, w / 2 + 0.02, 0.92, 0.64, false, 0.01);
    for (let u = -w / 2 + 0.3; u < w / 2 - 0.2; u += 0.6) part(b, 'steelDark', DARK, u - 0.1, 0.72, 0.6, u + 0.1, 0.74, 0.62, false, 0);
    if (sink) {
      part(b, 'steel', [0.7, 0.72, 0.74], -0.35, 0.88, 0.1, 0.35, 0.93, 0.5, false, 0.01);
      b.g.use('steel').tint(0.7).cyl(0, 0.92, 0.12, 0, 1.2, 0.12, 0.02, 0.02, 6);
    }
    // Wall cabinets above.
    if (upper) part(b, 'plaster', [0.86, 0.84, 0.8], -w / 2, 1.5, 0, w / 2, 2.2, 0.34, false);
    b.g.tint(1);
  });
}

/** A round table for four. */
export function roundTable(b: Builder, x: number, y: number, z: number): void {
  b.g.use('steelDark').tint(0.3).cyl(x, y, z, x, y + 0.72, z, 0.05, 0.05, 8);
  b.g.lathe([0.3, 0, 0.3, 0.03, 0, 0.04], x, y, z, 12, false);
  b.g.use('plaster').tint(...LAMINATE).lathe([0, 0.72, 0.5, 0.72, 0.52, 0.75, 0.5, 0.77, 0, 0.77], x, y, z, 18, false);
  b.g.tint(1);
  b.k.collide(x, y + 0.385, z, 0.35, 0.385, 0.35, 'metal');
}

/** A long table, `w` by `d`, on two trestles. */
export function table(b: Builder, x: number, y: number, z: number, yaw: number, w: number, d: number, top: Rgb = WOOD): void {
  at(b, x, y, z, yaw, () => {
    part(b, 'plaster', top, -w / 2, 0.72, -d / 2, w / 2, 0.77, d / 2, false, 0.015);
    for (const s of [-1, 1]) part(b, 'steelDark', DARK, s * (w / 2 - 0.3) - 0.04, 0, -d / 2 + 0.1, s * (w / 2 - 0.3) + 0.04, 0.72, d / 2 - 0.1, false, 0.01);
    b.k.collide(0, 0.385, 0, w / 2, 0.385, d / 2, 'metal');
  });
}

/** A low sofa, its back on local -z. */
export function sofa(b: Builder, x: number, y: number, z: number, yaw: number, w = 2, tint: Rgb = [0.3, 0.32, 0.38]): void {
  at(b, x, y, z, yaw, () => {
    part(b, 'carpet', tint, -w / 2, 0.1, 0, w / 2, 0.48, 0.85, false, 0.06);
    part(b, 'carpet', tint, -w / 2, 0.48, 0, w / 2, 0.95, 0.22, false, 0.06);
    for (const s of [-1, 1]) part(b, 'carpet', tint, s * w / 2 - 0.12, 0.1, 0, s * w / 2 + 0.12, 0.66, 0.85, false, 0.05);
    part(b, 'steelDark', DARK, -w / 2 + 0.1, 0, 0.1, w / 2 - 0.1, 0.1, 0.75, false, 0);
    b.k.collide(0, 0.48, 0.42, w / 2 + 0.12, 0.48, 0.43, 'concrete');
  });
}

/** A sign from the atlas on a wall, facing local +z, lit from above. */
export function sign(b: Builder, x: number, y: number, z: number, yaw: number, name: SignName, w = 1.6): void {
  at(b, x, y, z, yaw, () => {
    const h = w / 4;
    part(b, 'steelDark', DARK, -w / 2 - 0.05, -h / 2 - 0.05, 0, w / 2 + 0.05, h / 2 + 0.05, 0.04, false, 0.01);
    b.g.use('signs').quadUV(-w / 2, -h / 2, 0.045, w / 2, h / 2, signId(name));
  });
}

/** A poster or whiteboard flat on a wall, facing local +z. */
export function panel(b: Builder, x: number, y: number, z: number, yaw: number, w: number, h: number, tint: Rgb, frame = true): void {
  at(b, x, y, z, yaw, () => {
    if (frame) part(b, 'steel', METAL, -w / 2 - 0.03, -h / 2 - 0.03, 0, w / 2 + 0.03, h / 2 + 0.03, 0.02, false, 0.005);
    part(b, 'paintWhite', tint, -w / 2, -h / 2, 0.02, w / 2, h / 2, 0.025, false, 0);
  });
}

/** A ceiling: a grid of tees under it and lit panels where the room's lights are. */
export function ceiling(b: Builder, x0: number, z0: number, x1: number, z1: number, y: number, lamps: readonly (readonly [number, number])[], lit: Mat = 'emissiveWhite'): void {
  const g = b.g;
  g.use('steel').tint(0.66, 0.68, 0.7);
  for (let x = x0 + 1.2; x < x1 - 0.1; x += 1.2) g.box(x, y - 0.01, (z0 + z1) / 2, 0.012, 0.01, (z1 - z0) / 2, FACE.ny | FACE.px | FACE.nx);
  for (let z = z0 + 0.6; z < z1 - 0.1; z += 1.2) g.box((x0 + x1) / 2, y - 0.01, z, (x1 - x0) / 2, 0.01, 0.012, FACE.ny | FACE.pz | FACE.nz);
  g.tint(1);
  // Panels on a regular grid, more of them over the lamps' own spots.
  const spots: [number, number][] = [...lamps.map(([x, z]) => [x, z] as [number, number])];
  for (let x = x0 + 2.4; x < x1 - 1.2; x += 4.8) for (let z = z0 + 1.8; z < z1 - 1.2; z += 3.6) {
    if (!lamps.some(([lx, lz]) => Math.abs(lx - x) < 2.4 && Math.abs(lz - z) < 1.8)) spots.push([x, z]);
  }
  for (const [lx, lz] of spots) {
    for (const s of [-1, 1]) {
      const cx = Math.round(lx / 1.2) * 1.2 + 0.6 * s, cz = Math.round(lz / 1.2) * 1.2;
      g.use('steelDark').tint(0.5).box(cx, y - 0.025, cz, 0.58, 0.015, 0.29, FACE.ny);
      g.use(lit).tint(0.7).box(cx, y - 0.035, cz, 0.54, 0.005, 0.26, FACE.ny);
    }
  }
  g.tint(1);
}

/** A wall clock: always a little after five. */
export function clock(b: Builder, x: number, y: number, z: number, yaw: number): void {
  at(b, x, y, z, yaw, () => {
    b.g.use('paintWhite').tint(0.92).cyl(0, 0, 0, 0, 0, 0.05, 0.22, 0.22, 16);
    b.g.use('steelDark').tint(0.2).box(0, 0.08, 0.052, 0.012, 0.09, 0.003, FACE.pz);
    b.g.box(0.03, -0.04, 0.052, 0.012, 0.05, 0.003, FACE.pz);
    b.g.tint(1);
  });
}

/** A reception desk, its counter facing local +z: a lit front panel, a raised transaction ledge, monitors on the working side. */
export function reception(b: Builder, x: number, y: number, z: number, yaw: number, w: number): void {
  at(b, x, y, z, yaw, () => {
    part(b, 'plaster', [0.86, 0.86, 0.84], -w / 2, 0, -0.4, w / 2, 1.1, 0.4, true, 0.03);
    part(b, 'plaster', WOOD, -w / 2 - 0.05, 1.1, 0.1, w / 2 + 0.05, 1.16, 0.55, false, 0.015);
    part(b, 'emissiveCyan', [1, 1, 1], -w / 2 + 0.2, 0.18, 0.405, w / 2 - 0.2, 0.22, 0.41, false, 0);
    part(b, 'plaster', LAMINATE, -w / 2 + 0.1, 0.74, -0.9, w / 2 - 0.1, 0.78, -0.4, false, 0.01);
    for (const s of [-1, 1]) part(b, 'steelDark', DARK, s * (w / 2 - 0.2) - 0.03, 0, -0.85, s * (w / 2 - 0.2) + 0.03, 0.74, -0.45, false, 0);
  });
}

/** A low turnstile: a post with a lit top and an arm. No collider: the gate is for show and the nav must pass. */
export function turnstile(b: Builder, x: number, y: number, z: number, yaw: number): void {
  at(b, x, y, z, yaw, () => {
    part(b, 'steel', [0.7, 0.72, 0.76], -0.12, 0, -0.5, 0.12, 0.95, 0.5, false, 0.03);
    part(b, 'emissiveCyan', [1, 1, 1], -0.1, 0.95, -0.45, 0.1, 0.97, 0.45, false, 0);
    part(b, 'steel', [0.7, 0.72, 0.76], 0.12, 0.85, -0.03, 0.62, 0.89, 0.03, false, 0.01);
  });
}

/** A tall fridge or a stationery locker, its door on local +z. */
export function tall(b: Builder, x: number, y: number, z: number, yaw: number, w: number, h: number, tint: Rgb): void {
  at(b, x, y, z, yaw, () => {
    part(b, 'paintWhite', tint, -w / 2, 0, 0, w / 2, h, 0.7, true, 0.03);
    part(b, 'steelDark', DARK, w / 2 - 0.12, h * 0.45, 0.7, w / 2 - 0.08, h * 0.75, 0.73, false, 0);
  });
}

/** A rooftop AC unit: fans on its top, louvres on its sides. Solid: it is a ledge. */
export function acUnit(b: Builder, x: number, y: number, z: number, yaw: number, w = 2.2, h = 2.2, d = 1.8): void {
  at(b, x, y, z, yaw, () => {
    part(b, 'panel', [0.66, 0.68, 0.7], -w / 2, 0, -d / 2, w / 2, h, d / 2, true, 0.05);
    const g = b.g.use('steelDark').tint(0.3);
    for (const s of [-1, 1]) g.cyl(s * w / 4, h, 0, s * w / 4, h + 0.03, 0, Math.min(w / 4, d / 2) - 0.08, Math.min(w / 4, d / 2) - 0.08, 14);
    for (let i = 1; i < 8; i++) g.box(-w / 2 + (w * i) / 8, h * 0.5, d / 2 + 0.01, 0.03, h * 0.35, 0.01, FACE.pz);
    g.tint(1);
  });
}
