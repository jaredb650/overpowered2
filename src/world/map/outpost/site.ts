/**
 * The tools every part of the Outpost is built with. A wall is a footprint: a concrete core, a box collider a skin proud of it, and
 * panels that stay inside that skin. Rooms dress their own walls, so a wall between two rooms needs to know neither.
 */
import { CG, type SurfaceKind } from '../../../core/contracts';
import { FACE, type Mat } from '../../kit/geo';
import type { Kit, LampColor } from '../../kit/kit';
import { surfaceOf } from '../../kit/kit';
import { wallLamp } from '../../kit/props';
import { floorStencil, stencil, type StencilName } from '../../kit/stencil';
import type { MapPlan, MapSpec } from '../spec';
import { type Face, type Rect, type Rgb, type Room, roomAt, SKIN } from './plan';

const MODULE = 2.4;
const SEAM = 0.016;
const PAINT = SKIN - 0.004;
/** No body has this bit, so nothing simulated ever touches a barrier. Queries carry every bit, which is how the player's still find it. */
const NO_CONTACT = 1 << 15;

export interface Opening {
  /** Centre along the wall's axis, in world coordinates. */
  at: number;
  w: number;
  /** Bottom and top of the hole. A door's bottom is the floor. */
  y0?: number;
  y1: number;
  /** A scripted door: hazard paint on its frame. */
  scripted?: boolean;
}

export interface WallSpec extends Rect {
  y0?: number;
  y1: number;
  openings?: readonly Opening[];
  /** Tint of the core where no room dresses it. */
  tone?: number;
  /** Dresses the bare sides as well, for walls seen from outside. */
  outside?: Face;
}

export class Site {
  constructor(readonly k: Kit, readonly spec: MapSpec) {}

  get plan(): MapPlan {
    return this.spec.plan!;
  }

  /** A box collider from its corners. */
  solid(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, surface: SurfaceKind = 'concrete', vox = true): void {
    this.k.collide((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, surface, vox);
  }

  /** The same, and a mark on the minimap. */
  cover(x0: number, z0: number, x1: number, z1: number, h: number, y = 0, surface: SurfaceKind = 'concrete'): void {
    this.solid(x0, y, z0, x1, y + h, z1, surface);
    this.plan.blocks.push({ x0, z0, x1, z1 });
  }

  /**
   * Stops a player and nothing else: no bullet, rocket, body, nav ray or light. This is what keeps the mission on its route, because
   * the men on the south wall have to fire out over the line a player must not cross.
   */
  barrier(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const { R, world } = this.k.physics;
    world.createCollider(
      R.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2)
        .setTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
        .setCollisionGroups(((CG.Barrier << 16) | NO_CONTACT) >>> 0),
    );
    this.k.colliders++;
  }

  /** A tessellated slab with its collider. */
  mass(mat: Mat, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tint = 1, step = 3, faces: number = FACE.all): void {
    const g = this.k.geo.use(mat).tint(tint);
    g.slab((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, step, faces);
    g.tint(1);
    this.solid(x0, y0, z0, x1, y1, z1, surfaceOf(mat));
  }

  /** Floor surface with no collider, for a room standing on a shared slab. */
  paintFloor(mat: Mat, r: Rect, y: number, tint: Rgb = [1, 1, 1], step = 1.2): void {
    const g = this.k.geo.use(mat).tint(tint[0], tint[1], tint[2]);
    g.gridStep(r.x0, y, r.z1, r.x1 - r.x0, 0, 0, 0, 0, r.z0 - r.z1, step);
    g.tint(1);
  }

  /** Painted strip, flat on the floor. */
  line(x0: number, z0: number, x1: number, z1: number, rgb: Rgb, y = 0.012, mat: Mat = 'paintWhite'): void {
    const g = this.k.geo.use(mat).tint(rgb[0], rgb[1], rgb[2]);
    g.box((x0 + x1) / 2, y, (z0 + z1) / 2, (x1 - x0) / 2, 0.001, (z1 - z0) / 2, FACE.py);
    g.tint(1);
  }

  /** A thin ring of paint inside a room, so a floor reads at a glance. */
  frameFloor(r: Rect, y: number, inset: number, w: number, rgb: Rgb): void {
    const a = r.x0 + inset, b = r.x1 - inset, c = r.z0 + inset, d = r.z1 - inset, f = y + 0.012;
    this.line(a, c, b, c + w, rgb, f);
    this.line(a, d - w, b, d, rgb, f);
    this.line(a, c + w, a + w, d - w, rgb, f);
    this.line(b - w, c + w, b, d - w, rgb, f);
  }

  /** The room's fill on the minimap, its floor and the slab that closes it. Anything past its footprint is the walls' job. */
  dressRoom(r: Room, ceiling = true): void {
    this.plan.fills.push({ x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, rgb: r.paint, label: '' });
    this.paintFloor(r.floor, r, r.y, r.floorTint);
    if (ceiling) this.mass('concreteDark', r.x0, r.ceil, r.z0, r.x1, Math.max(r.ceil + 1, 5), r.z1, 0.7, 3, FACE.ny);
  }

  private panel(face: Face, axisX: boolean, side: number, c: number, t: number, a: number, b: number, lo: number, hi: number): void {
    const g = this.k.geo;
    const u = (a + b) / 2, y = (lo + hi) / 2, hu = (b - a) / 2, hy = (hi - lo) / 2, n = c + side * (t + 0.026);
    const s = 0.82 + this.k.rng() * 0.26;
    switch (face) {
      case 'poured': g.use('concrete').tint(s * 0.96, s * 0.98, s); break;
      case 'ply': g.use('plywood').tint(0.72 * s, 0.68 * s, 0.6 * s); break;
      case 'tile': g.use('tile').tint(1); break;
      case 'plate': g.use('panel').tint(0.66 * s, 0.72 * s, 0.8 * s); break;
      case 'raw': return;
    }
    if (axisX) g.bevel(u, y, n, hu, hy, 0.024, 0.012);
    else g.bevel(n, y, u, 0.024, hy, hu, 0.012);
    g.tint(1);
  }

  /** Panels on one side of a stretch of wall, room by room, with each room's band at hip height. */
  private dressSide(axisX: boolean, side: number, c: number, t: number, u0: number, u1: number, v0: number, v1: number, outside?: Face): void {
    const g = this.k.geo;
    const away = c + side * (t + 0.9);
    const sideFace = axisX ? (side > 0 ? FACE.pz : FACE.nz) : (side > 0 ? FACE.px : FACE.nx);
    for (let m = Math.floor(u0 / MODULE); m * MODULE < u1; m++) {
      const a = Math.max(u0, m * MODULE) + SEAM, b = Math.min(u1, (m + 1) * MODULE) - SEAM;
      if (b - a < 0.2) continue;
      const mid = (a + b) / 2;
      const room = axisX ? roomAt(mid, Math.max(v0, 0.5), away) : roomAt(away, Math.max(v0, 0.5), mid);
      const face = room?.face ?? outside;
      if (!face) continue;
      const lo = Math.max(v0, room?.y ?? v0), hi = Math.min(v1, room?.ceil ?? v1);
      if (hi - lo < 0.1) continue;
      const rows = Math.max(1, Math.round((hi - lo) / 2.1));
      for (let r = 0; r < rows; r++) {
        this.panel(face, axisX, side, c, t, a, b, lo + ((hi - lo) * r) / rows + SEAM, lo + ((hi - lo) * (r + 1)) / rows - SEAM);
      }
      if (room && lo <= room.y + 1 && hi >= room.y + 1.6) {
        const [cr, cg, cb] = room.paint;
        const n = c + side * (t + PAINT);
        g.use('paintWhite').tint(cr, cg, cb);
        if (axisX) g.box(mid, room.y + 1.42, n, (b - a) / 2 + SEAM, 0.14, 0.001, sideFace);
        else g.box(n, room.y + 1.42, mid, 0.001, 0.14, (b - a) / 2 + SEAM, sideFace);
        g.tint(1);
      }
    }
  }

  /** One solid piece of a wall, from u0 to u1 along its axis, and v0 to v1 up. */
  private piece(w: WallSpec, axisX: boolean, c: number, t: number, u0: number, u1: number, v0: number, v1: number): void {
    if (u1 - u0 < 0.02 || v1 - v0 < 0.02) return;
    const g = this.k.geo;
    const mid = (u0 + u1) / 2, h = (u1 - u0) / 2, y = (v0 + v1) / 2, hy = (v1 - v0) / 2;
    if (axisX) this.k.collide(mid, y, c, h, hy, t + SKIN, 'concrete');
    else this.k.collide(c, y, mid, t + SKIN, hy, h, 'concrete');
    g.use('concreteDark').tint(w.tone ?? 0.72);
    if (axisX) g.slab(mid, y, c, h, hy, t, 1.8);
    else g.slab(c, y, mid, t, hy, h, 1.8);
    g.tint(1);
    for (const side of [1, -1]) this.dressSide(axisX, side, c, t, u0, u1, v0, v1, w.outside);
  }

  /** A hole's frame: jambs painted for the room you are walking into, and a plate over the join in the floors. */
  private frame(o: Opening, axisX: boolean, c: number, t: number, y0: number, floor: boolean): void {
    const g = this.k.geo;
    const a = o.at - o.w / 2, b = o.at + o.w / 2, top = o.y1;
    const front = axisX ? roomAt(o.at, y0 + 1, c + t + 1.5) : roomAt(c + t + 1.5, y0 + 1, o.at);
    const back = axisX ? roomAt(o.at, y0 + 1, c - t - 1.5) : roomAt(c - t - 1.5, y0 + 1, o.at);
    const rgb: Rgb = (front ?? back)?.paint ?? [0.5, 0.56, 0.62];
    const d = t + SKIN;
    g.use(o.scripted ? 'hazard' : 'paintWhite').tint(...(o.scripted ? [1, 1, 1] as const : rgb));
    const h = (top - y0) / 2, y = y0 + h;
    if (axisX) {
      g.box(a, y, c, 0.001, h, d, FACE.px);
      g.box(b, y, c, 0.001, h, d, FACE.nx);
    } else {
      g.box(c, y, a, d, h, 0.001, FACE.pz);
      g.box(c, y, b, d, h, 0.001, FACE.nz);
    }
    g.tint(1);
    if (!floor) return;
    const plate = t + 0.3;
    g.use('steelDark').tint(0.8);
    if (axisX) g.box(o.at, y0 + 0.016, c, o.w / 2, 0.001, plate, FACE.py);
    else g.box(c, y0 + 0.016, o.at, plate, 0.001, o.w / 2, FACE.py);
    g.tint(1).use('hazard');
    for (const s of [1, -1]) {
      if (axisX) g.box(o.at, y0 + 0.018, c + s * (plate - 0.09), o.w / 2, 0.001, 0.09, FACE.py);
      else g.box(c + s * (plate - 0.09), y0 + 0.018, o.at, 0.09, 0.001, o.w / 2, FACE.py);
    }
    const dx = axisX ? 0 : 1, dz = axisX ? 1 : 0;
    this.plan.doors.push({ x: axisX ? o.at : c, z: axisX ? c : o.at, dx, dz, w: o.w });
  }

  /** The wall along the longer side of its footprint, broken round its openings. */
  wall(w: WallSpec): void {
    const axisX = w.x1 - w.x0 >= w.z1 - w.z0;
    const c = axisX ? (w.z0 + w.z1) / 2 : (w.x0 + w.x1) / 2;
    const t = axisX ? (w.z1 - w.z0) / 2 : (w.x1 - w.x0) / 2;
    const start = axisX ? w.x0 : w.z0, end = axisX ? w.x1 : w.z1;
    const y0 = w.y0 ?? 0;
    const openings = [...(w.openings ?? [])].sort((a, b) => a.at - b.at);
    let u = start;
    for (const o of openings) {
      const a = o.at - o.w / 2, b = o.at + o.w / 2, lo = o.y0 ?? y0;
      this.piece(w, axisX, c, t, u, a, y0, w.y1);
      this.piece(w, axisX, c, t, a, b, y0, lo);
      this.piece(w, axisX, c, t, a, b, o.y1, w.y1);
      this.frame(o, axisX, c, t, lo, lo === y0);
      u = b;
    }
    this.piece(w, axisX, c, t, u, end, y0, w.y1);
    const hx = axisX ? 0 : t + SKIN, hz = axisX ? t + SKIN : 0;
    this.plan.walls.push({ ax: axisX ? start : c, az: axisX ? c : start, bx: axisX ? end : c, bz: axisX ? c : end, half: Math.max(hx, hz) });
  }

  /** Stairs on a solid wedge: real treads, one plane to run on, and nothing underneath to crawl into. Heads from A to B, rising or falling. */
  stairs(ax: number, az: number, y0: number, bx: number, bz: number, y1: number, w: number, mat: Mat = 'concrete', sides = false): void {
    const k = this.k, g = k.geo;
    const rise = y1 - y0, run = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(2, Math.round(Math.abs(rise) / 0.28));
    k.push(ax, y0, az, Math.atan2(-(bz - az), bx - ax));
    const stepRun = run / steps, stepRise = rise / steps;
    g.use(mat);
    for (let i = 0; i < steps; i++) {
      const s = 0.86 + k.rng() * 0.2;
      g.tint(s, s, s * 1.02);
      g.box((i + 0.5) * stepRun, (i + 1) * stepRise - 0.04, 0, stepRun / 2 + 0.02, 0.04, w / 2, FACE.py | FACE.nx | FACE.px);
      g.box(i * stepRun + 0.015, (i + 1) * stepRise - stepRise / 2, 0, 0.015, Math.abs(stepRise) / 2, w / 2 - 0.02, FACE.nx);
    }
    g.tint(1).use('hazard');
    for (const s of [1, -1]) g.box(run / 2, 0, s * (w / 2 - 0.05), run / 2, 0.012, 0.05, FACE.py);
    k.pop();
    // A deep tilted box is a wedge once the floor has swallowed its underside, and one plane to run on.
    k.along(ax, y0, az, bx, y1, bz, len => {
      const deep = Math.abs(rise) + 1;
      k.collide(len / 2, -deep / 2, 0, len / 2, deep / 2, w / 2, 'concrete');
    });
    if (!sides) return;
    const nx = -(bz - az) / run, nz = (bx - ax) / run, lo = Math.min(y0, y1);
    const n = Math.ceil(run / 1.6);
    for (const s of [1, -1]) {
      const ox = (nx * w * s) / 2, oz = (nz * w * s) / 2;
      for (let i = 0; i < n; i++) {
        const f0 = i / n, f1 = (i + 1) / n;
        const x0 = ax + (bx - ax) * f0 + ox, z0 = az + (bz - az) * f0 + oz, x1 = ax + (bx - ax) * f1 + ox, z1 = az + (bz - az) * f1 + oz;
        const t0 = y0 + rise * f0, t1 = y0 + rise * f1;
        g.use('concrete').tint(0.84 + k.rng() * 0.2);
        // A quad with two corners on one point has a zero normal, and that is a NaN pixel in the renderer.
        if (t0 - lo < 1e-4) { if (s > 0) g.tri(x0, lo, z0, x1, lo, z1, x1, t1, z1); else g.tri(x1, lo, z1, x0, lo, z0, x1, t1, z1); }
        else if (t1 - lo < 1e-4) { if (s > 0) g.tri(x0, lo, z0, x1, lo, z1, x0, t0, z0); else g.tri(x1, lo, z1, x0, lo, z0, x0, t0, z0); }
        else if (s > 0) g.quad(x0, lo, z0, x1, lo, z1, x1, t1, z1, x0, t0, z0);
        else g.quad(x1, lo, z1, x0, lo, z0, x0, t0, z0, x1, t1, z1);
      }
      g.tint(1);
    }
  }

  /** A bar light on a ceiling. */
  bar(x: number, ceil: number, z: number, yaw: number, len: number, color: LampColor, intensity: number, radius: number): void {
    this.k.lampBar(x, ceil - 0.2, z, yaw, len, color, intensity, radius);
  }

  /** Room fill, well clear of the walls so nothing burns out next to a lamp. */
  fill(x: number, y: number, z: number, intensity: number, radius: number, color: LampColor | number = 'white'): void {
    this.k.light(x, y, z, color, intensity, radius);
  }

  lamp(x: number, y: number, z: number, yaw: number, color: LampColor = 'white', intensity = 0, radius = 14): void {
    wallLamp(this.k, x, y, z, yaw, color, intensity, radius);
  }

  /** Words on a wall that runs along X at `z`, facing `dir` (+1 is south). */
  words(name: StencilName, x: number, y: number, z: number, h: number, dir: number, rgb: Rgb): void {
    this.k.push(x, 0, z, dir > 0 ? 0 : Math.PI);
    stencil(this.k, name, 0, y, 0, h, rgb);
    this.k.pop();
  }

  /** Words on a wall that runs along Z at `x`, facing `dir` (+1 is east). */
  sideWords(name: StencilName, x: number, y: number, z: number, h: number, dir: number, rgb: Rgb): void {
    this.k.push(x, 0, z, dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    stencil(this.k, name, 0, y, 0, h, rgb);
    this.k.pop();
  }

  floorWords(name: StencilName, x: number, y: number, z: number, yaw: number, h: number, rgb: Rgb): void {
    floorStencil(this.k, name, x, z, yaw, h, rgb, y + 0.02);
  }

  /** Steel crate with corner bands. */
  crate(x0: number, z0: number, x1: number, z1: number, h: number, tint: Rgb, y = 0): void {
    const g = this.k.geo;
    g.use('panel').tint(tint[0], tint[1], tint[2]);
    g.bevel((x0 + x1) / 2, y + h / 2, (z0 + z1) / 2, (x1 - x0) / 2, h / 2, (z1 - z0) / 2, 0.05);
    g.tint(1).use('steelDark');
    for (const cx of [x0 + 0.09, x1 - 0.09]) for (const cz of [z0 + 0.09, z1 - 0.09]) g.bevel(cx, y + h / 2, cz, 0.09, h / 2, 0.09, 0.02);
    this.cover(x0, z0, x1, z1, h, y, 'metal');
  }

  /** Staggered bags round a rectangle, all under one box. */
  sandbags(x0: number, z0: number, x1: number, z1: number, h = 1.15, y = 0): void {
    const k = this.k, g = k.geo;
    const bagL = 0.62, bagW = 0.32;
    const courses = Math.round(h / 0.17);
    const sides: [number, number, number, number, number][] = [
      [x0, z0, x1, z0, 0], [x1, z0, x1, z1, Math.PI / 2], [x1, z1, x0, z1, 0], [x0, z1, x0, z0, Math.PI / 2],
    ];
    for (let c = 0; c < courses; c++) {
      const cy = y + (c + 0.5) * (h / courses);
      for (const [ax, az, bx, bz, yaw] of sides) {
        const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / bagL));
        for (let i = 0; i < n; i++) {
          const f = (i + (c & 1 ? 0.25 : 0.75)) / n;
          const s = k.rand(0.72, 1);
          const px = ax + (bx - ax) * f, pz = az + (bz - az) * f;
          // Pulled in from the box edge, so the wobble cannot put a bag outside the collider.
          const inX = px + Math.sign((x0 + x1) / 2 - px) * (yaw === 0 ? 0 : bagW / 2), inZ = pz + Math.sign((z0 + z1) / 2 - pz) * (yaw === 0 ? bagW / 2 : 0);
          k.push(inX, cy, inZ, yaw + k.rand(-0.04, 0.04));
          g.use('dirt').tint(s, s * 0.94, s * 0.8);
          g.bevel(0, 0, 0, bagL * 0.5, (h / courses) * 0.56, bagW / 2, 0.07);
          k.pop();
        }
      }
    }
    g.use('dirt').tint(0.8, 0.75, 0.62);
    g.slab((x0 + x1) / 2, y + h - 0.02, (z0 + z1) / 2, (x1 - x0) / 2 - 0.02, 0.02, (z1 - z0) / 2 - 0.02, 1, FACE.py);
    g.tint(1);
    this.cover(x0, z0, x1, z1, h, y);
  }
}
