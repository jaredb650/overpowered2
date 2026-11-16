/**
 * The tools the Office is built with. A wall is cut into vertical strips at every hole edge, so one wall can carry a door on the
 * ground floor, a window upstairs and a gap in the parapet. A slab is a rectangle with rectangular holes, cut into boxes.
 */
import type { SurfaceKind } from '../../../core/contracts';
import { FACE, type Mat } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import type { MapPlan, MapSpec } from '../spec';
import { B, type Hole, type Rect, type Rgb, SKIN, T_IN, type WallLine } from './plan';

/** Off-white drywall and the outside cladding. */
export const DRYWALL: Rgb = [0.86, 0.86, 0.84];
export const CLAD: Rgb = [0.3, 0.34, 0.4];
export const CEILING: Rgb = [0.74, 0.76, 0.78];
export const WAINSCOT: Rgb = [0.42, 0.48, 0.56];
const DADO = 1.05;
const FLOORS = [0, 4.4] as const;

/** Pane widths a window hole is cut into, mullion to mullion. Breakable panes and the frames both use it. */
export function paneSplit(h: Hole, most = 2.4): [number, number][] {
  const n = Math.max(1, Math.ceil(h.w / most));
  const a = h.at - h.w / 2;
  return Array.from({ length: n }, (_, i) => [a + (h.w * i) / n, a + (h.w * (i + 1)) / n] as [number, number]);
}

/** Rectangles covering `r` minus `holes`, by sweeping x. */
export function cut(r: Rect, holes: readonly Rect[]): Rect[] {
  const xs = [...new Set([r.x0, r.x1, ...holes.flatMap(h => [h.x0, h.x1])])].filter(x => x >= r.x0 && x <= r.x1).sort((a, b) => a - b);
  const out: Rect[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i]!, x1 = xs[i + 1]!, xm = (x0 + x1) / 2;
    const blocked = holes.filter(h => h.x0 < xm && h.x1 > xm).map(h => [Math.max(r.z0, h.z0), Math.min(r.z1, h.z1)] as const)
      .filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
    let z = r.z0;
    for (const [a, b] of blocked) {
      if (a > z) out.push({ x0, z0: z, x1, z1: a });
      z = Math.max(z, b);
    }
    if (z < r.z1) out.push({ x0, z0: z, x1, z1: r.z1 });
  }
  return out;
}

export class Builder {
  constructor(readonly k: Kit, readonly spec: MapSpec) {}

  get plan(): MapPlan {
    return this.spec.plan!;
  }

  get g() {
    return this.k.geo;
  }

  solid(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, surface: SurfaceKind = 'concrete', vox = true): void {
    this.k.collide((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, surface, vox);
  }

  /** A painted box with its collider. */
  box(mat: Mat, tint: Rgb, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, bev = 0.03, surface?: SurfaceKind): void {
    this.deco(mat, tint, x0, y0, z0, x1, y1, z1, bev);
    this.solid(x0, y0, z0, x1, y1, z1, surface ?? (mat === 'paintWhite' || mat === 'panel' ? 'metal' : 'concrete'));
  }

  /** The same, no collider. */
  deco(mat: Mat, tint: Rgb, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, bev = 0.03): void {
    this.g.use(mat).tint(tint[0], tint[1], tint[2]);
    if (bev > 0) this.g.bevel((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, bev);
    else this.g.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2);
    this.g.tint(1);
  }

  /** A flat finish on a floor, no collider. */
  finish(mat: Mat, tint: Rgb, r: Rect, y: number, step = 2): void {
    const g = this.g.use(mat).tint(tint[0], tint[1], tint[2]);
    g.gridStep(r.x0, y, r.z1, r.x1 - r.x0, 0, 0, 0, 0, r.z0 - r.z1, step);
    g.tint(1);
  }

  /** A slab from y0 to y1 over `r` with holes, one collider per piece. Its top is drawn only with `top`. */
  slab(r: Rect, y0: number, y1: number, holes: readonly Rect[], under: Rgb, top?: { mat: Mat; tint: Rgb }, side: Mat = 'concreteDark'): void {
    const g = this.g;
    for (const p of cut(r, holes)) {
      const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2, hx = (p.x1 - p.x0) / 2, hz = (p.z1 - p.z0) / 2, cy = (y0 + y1) / 2, hy = (y1 - y0) / 2;
      this.k.collide(cx, cy, cz, hx, hy, hz, 'concrete');
      g.use('plaster').tint(under[0], under[1], under[2]).slab(cx, cy, cz, hx, hy, hz, 3, FACE.ny);
      g.use(side).tint(0.7).slab(cx, cy, cz, hx, hy, hz, 3, FACE.sides);
      if (top) g.use(top.mat).tint(top.tint[0], top.tint[1], top.tint[2]).slab(cx, cy, cz, hx, hy, hz, 3, FACE.py);
      g.tint(1);
    }
  }

  /**
   * A wall, cut into strips at every hole's edge, each strip solid where no hole is. Inside walls are drywall both sides; an outside
   * wall is clad on its outer face. Doors and their frames go on the plan.
   */
  wall(w: WallLine, outer = false, look: { mat: Mat; tint: Rgb } = { mat: 'plaster', tint: DRYWALL }): void {
    const t = (w.t ?? T_IN) / 2;
    const alongX = w.axis === 'x';
    // Outward is away from the building's middle.
    const out = outer ? Math.sign(w.at) || 1 : 0;
    const edges = [...new Set([w.from, w.to, ...w.holes.flatMap(h => [h.at - h.w / 2, h.at + h.w / 2])])]
      .filter(u => u >= w.from && u <= w.to).sort((a, b) => a - b);
    const g = this.g;
    // On the plan a wall is drawn where it is solid at foot height on its lowest floor, so every doorway shows. One that only
    // stands upstairs is a thin line: the minimap is one picture of two floors.
    const foot = w.y0 + 0.5;
    const half = w.y0 >= FLOORS[1] - 0.01 ? 0.07 : t + SKIN;
    let run: number | null = null;
    const endRun = (u: number) => {
      if (run === null) return;
      this.plan.walls.push({ ax: alongX ? run : w.at, az: alongX ? w.at : run, bx: alongX ? u : w.at, bz: alongX ? w.at : u, half });
      run = null;
    };
    for (let i = 0; i < edges.length - 1; i++) {
      const u0 = edges[i]!, u1 = edges[i + 1]!, um = (u0 + u1) / 2;
      if (u1 - u0 < 0.01) continue;
      const open = w.holes.some(h => Math.abs(h.at - um) < h.w / 2 && (h.y0 ?? w.y0) <= foot && h.y1 > foot);
      if (open) endRun(u0);
      else run ??= u0;
      const cuts = w.holes.filter(h => Math.abs(h.at - um) < h.w / 2).map(h => [h.y0 ?? w.y0, h.y1] as const).sort((a, b) => a[0] - b[0]);
      let y = w.y0;
      const spans: [number, number][] = [];
      for (const [a, b] of cuts) {
        if (a > y) spans.push([y, a]);
        y = Math.max(y, b);
      }
      if (y < w.y1) spans.push([y, w.y1]);
      for (const [v0, v1] of spans) {
        if (v1 - v0 < 0.01) continue;
        const cy = (v0 + v1) / 2, hy = (v1 - v0) / 2, hu = (u1 - u0) / 2;
        if (alongX) this.k.collide(um, cy, w.at, hu, hy, t + SKIN, 'concrete');
        else this.k.collide(w.at, cy, um, t + SKIN, hy, hu, 'concrete');
        const inFace = alongX ? (out > 0 ? FACE.nz : FACE.pz) : (out > 0 ? FACE.nx : FACE.px);
        const outFace = alongX ? (out > 0 ? FACE.pz : FACE.nz) : (out > 0 ? FACE.px : FACE.nx);
        const ends = FACE.py | FACE.ny | (alongX ? FACE.px | FACE.nx : FACE.pz | FACE.nz);
        const drawn = out ? inFace | ends : FACE.all;
        g.use(look.mat).tint(look.tint[0], look.tint[1], look.tint[2]);
        if (alongX) g.slab(um, cy, w.at, hu, hy, t, 2.4, drawn);
        else g.slab(w.at, cy, um, t, hy, hu, 2.4, drawn);
        if (look.mat === 'plaster') this.dado(alongX, w.at, t, um, hu, v0, v1, out ? inFace : FACE.pz | FACE.nz | FACE.px | FACE.nx);
        if (out) {
          g.use('panel').tint(CLAD[0], CLAD[1], CLAD[2]);
          if (alongX) g.slab(um, cy, w.at, hu, hy, t, 3, outFace);
          else g.slab(w.at, cy, um, t, hy, hu, 3, outFace);
        }
        g.tint(1);
      }
    }
    endRun(edges[edges.length - 1]!);
    for (const h of w.holes) this.frame(w, h, t, out);
  }

  /**
   * Two-tone drywall: a painted lower band, a rail on it and a dark skirting, on each face of a strip that reaches a floor. Strips
   * stop at holes, so the band never crosses a doorway.
   */
  private dado(alongX: boolean, at: number, t: number, um: number, hu: number, v0: number, v1: number, faces: number): void {
    const g = this.g;
    for (const f of FLOORS) {
      const a = Math.max(v0, f), top = Math.min(v1, f + DADO);
      if (top - a < 0.05 || a > f + 0.01) continue;
      const side = (y0: number, y1: number, d: number, mat: Mat, tint: Rgb) => {
        g.use(mat).tint(tint[0], tint[1], tint[2]);
        const cy = (y0 + y1) / 2, hy = (y1 - y0) / 2;
        if (alongX) g.box(um, cy, at, hu, hy, t + d, faces & (FACE.pz | FACE.nz));
        else g.box(at, cy, um, t + d, hy, hu, faces & (FACE.px | FACE.nx));
      };
      side(a, top, 0.004, 'plaster', WAINSCOT);
      side(a, Math.min(top, a + 0.1), 0.012, 'steelDark', [0.18, 0.19, 0.21]);
      if (top >= f + DADO - 0.01) side(top - 0.03, top + 0.03, 0.015, 'steel', [0.6, 0.62, 0.66]);
      g.tint(1);
    }
  }

  /** Jambs and a head round a hole; a door's floor plate and its place on the plan; a window's sill and mullions. */
  private frame(w: WallLine, h: Hole, t: number, out: number): void {
    const alongX = w.axis === 'x';
    const y0 = h.y0 ?? w.y0, y1 = Math.min(h.y1, w.y1);
    const a = h.at - h.w / 2, b = h.at + h.w / 2, d = t + 0.04;
    const put = (u: number, y: number, hu: number, hy: number, hd: number, mat: Mat, tint: Rgb = [1, 1, 1]) => {
      this.g.use(mat).tint(tint[0], tint[1], tint[2]);
      if (alongX) this.g.bevel(u, y, w.at, hu, hy, hd, 0.015);
      else this.g.bevel(w.at, y, u, hd, hy, hu, 0.015);
      this.g.tint(1);
    };
    const trim: Rgb = h.kind === 'door' ? [0.26, 0.28, 0.32] : [0.5, 0.54, 0.6];
    if (y1 - y0 > 0.2) {
      put(a + 0.04, (y0 + y1) / 2, 0.04, (y1 - y0) / 2, d, 'steelDark', trim);
      put(b - 0.04, (y0 + y1) / 2, 0.04, (y1 - y0) / 2, d, 'steelDark', trim);
      if (y1 < w.y1 - 0.01) put(h.at, y1 - 0.04, h.w / 2, 0.04, d, 'steelDark', trim);
    }
    if (h.kind === 'pane') {
      put(h.at, y0 + 0.03, h.w / 2 + 0.02, 0.03, d + 0.05, 'steelDark', trim);
      const split = paneSplit(h);
      for (let i = 1; i < split.length; i++) put(split[i]![0], (y0 + y1) / 2, 0.035, (y1 - y0) / 2, t * 0.6, 'steelDark', trim);
      return;
    }
    if (h.kind === 'bay') {
      // A broken window: a stub of frame on the sill, glass long gone.
      put(h.at, y0 + 0.02, h.w / 2, 0.02, d, 'steelDark', [0.2, 0.2, 0.22]);
      return;
    }
    if (y0 > w.y0 + 0.5 && h.y0 !== undefined && y0 >= 8) return; // the parapet's gap needs no threshold
    // A threshold plate, and the doorway on the plan for the squads' room clearing.
    this.g.use('steelDark').tint(0.5);
    if (alongX) this.g.box(h.at, y0 + 0.012, w.at, h.w / 2, 0.012, d + 0.1, FACE.py);
    else this.g.box(w.at, y0 + 0.012, h.at, d + 0.1, 0.012, h.w / 2, FACE.py);
    this.g.tint(1);
    this.plan.doors.push({ x: alongX ? h.at : w.at, z: alongX ? w.at : h.at, dx: alongX ? 0 : 1, dz: alongX ? 1 : 0, w: h.w });
    if (out && y0 === 0) {
      // A lit sign over an outside door, so the ways in read from the street.
      put(h.at, y1 + 0.18, Math.min(0.5, h.w / 2), 0.07, d + 0.06, 'emissiveCyan');
    }
  }

  /** Stairs on a solid wedge: treads to look at, one plane to run on, nothing to crawl under. A to B, rising. */
  stairs(ax: number, az: number, y0: number, bx: number, bz: number, y1: number, w: number, mat: Mat = 'concrete', tint: Rgb = [0.8, 0.8, 0.82]): void {
    const k = this.k, g = this.g;
    const rise = y1 - y0, run = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(2, Math.round(Math.abs(rise) / 0.25));
    k.push(ax, y0, az, Math.atan2(-(bz - az), bx - ax));
    const sr = run / steps, sh = rise / steps;
    for (let i = 0; i < steps; i++) {
      const s = 0.9 + k.rng() * 0.12;
      g.use(mat).tint(tint[0] * s, tint[1] * s, tint[2] * s);
      g.box((i + 0.5) * sr, (i + 1) * sh - 0.04, 0, sr / 2 + 0.02, 0.04, w / 2, FACE.py | FACE.nx | FACE.px);
      g.box(i * sr + 0.015, (i + 1) * sh - sh / 2, 0, 0.015, Math.abs(sh) / 2, w / 2 - 0.02, FACE.nx);
      g.use('hazard').tint(1).box((i + 1) * sr - 0.05, (i + 1) * sh + 0.001, 0, 0.04, 0.001, w / 2 - 0.05, FACE.py);
    }
    g.tint(1);
    k.pop();
    k.along(ax, y0, az, bx, y1, bz, len => {
      const deep = Math.abs(rise) + 0.6;
      k.collide(len / 2, -deep / 2, 0, len / 2, deep / 2, w / 2, 'concrete');
    });
    // Solid sides down to the lower floor, so the wedge reads as concrete and not as a hovering plank.
    const nx = -(bz - az) / run, nz = (bx - ax) / run;
    for (const s of [1, -1]) {
      const ox = (nx * w * s) / 2, oz = (nz * w * s) / 2;
      const x0 = ax + ox, z0 = az + oz, x1 = bx + ox, z1 = bz + oz;
      g.use('concrete').tint(0.66);
      if (s > 0) g.tri(x0, y0, z0, x1, y0, z1, x1, y1, z1);
      else g.tri(x1, y0, z1, x0, y0, z0, x1, y1, z1);
      g.tint(1);
    }
  }

  /** A railing with no collider: it must never stop a run. */
  rail(points: readonly number[], h = 1.05): void {
    this.k.rail(points, h, 1.6);
  }

  /** A room's place on the minimap. */
  fill(r: Rect, rgb: Rgb, label = ''): void {
    this.plan.fills.push({ x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, rgb, label });
  }

  /** Cover or a solid block on the minimap. */
  block(x0: number, z0: number, x1: number, z1: number): void {
    this.plan.blocks.push({ x0, z0, x1, z1 });
  }
}

/** True if (x, z) is inside the building. */
export const inside = (x: number, z: number): boolean => x > B.x0 && x < B.x1 && z > B.z0 && z < B.z1;
