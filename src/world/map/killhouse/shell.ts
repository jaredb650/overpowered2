/**
 * Slab, walls and gates. Every wall is a plain box with a skin of panels that sit inside its collider, so nothing
 * visible can catch a capsule. The whole site stands on one floor collider: there are no seams or thresholds to step over.
 */
import { FACE } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { fence } from '../../kit/props';
import { floorStencil, stencil, type StencilName } from '../../kit/stencil';
import type { MapPlan, MapSpec } from '../spec';
import { CORRIDOR, COURT, type Face, GATES, type GateDef, KH, ROOMS, type Rgb, rot, SKIN, spaceAt, type Space, WALLS, type WallDef, YARD, YARD_OUT } from './plan';

const MODULE = 2.4;
const SEAM = 0.016;

function panel(k: Kit, face: Face, side: number, t: number, a: number, b: number, c: number, d: number): void {
  const g = k.geo;
  const x = (a + b) / 2, y = (c + d) / 2, hx = (b - a) / 2, hy = (d - c) / 2, z = side * (t + 0.026);
  const s = 0.82 + k.rng() * 0.26;
  switch (face) {
    case 'poured':
      g.use('concrete').tint(s * 0.96, s * 0.98, s);
      break;
    case 'ply':
      g.use('paintWhite').tint(0.64 * s, 0.58 * s, 0.48 * s);
      break;
    case 'tile':
      g.use('tile').tint(1, 1, 1);
      break;
    case 'plate':
      g.use('panel').tint(0.66 * s, 0.72 * s, 0.8 * s);
      break;
  }
  g.bevel(x, y, z, hx, hy, 0.024, 0.012);
  g.tint(1);
}

const digit = (n: number): StencilName => String(n) as StencilName;

function dressSpan(k: Kit, w: WallDef, ux: number, uz: number, u0: number, u1: number): void {
  const g = k.geo;
  const t = w.half, h = w.h;
  const rows = w.perimeter ? 3 : 2;
  const rowH = h / rows;
  const nx = -uz, nz = ux;
  for (const side of [1, -1]) {
    const faces = side > 0 ? FACE.pz : FACE.nz;
    for (let m = Math.floor(u0 / MODULE); m * MODULE < u1; m++) {
      const a = Math.max(u0, m * MODULE) + SEAM, b = Math.min(u1, (m + 1) * MODULE) - SEAM;
      if (b - a < 0.2) continue;
      const mid = (a + b) / 2;
      const space = spaceAt(w.ax + ux * mid + nx * side * 1.2, w.az + uz * mid + nz * side * 1.2);
      const face = space?.face ?? 'poured';
      for (let r = 0; r < rows; r++) panel(k, face, side, t, a, b, r * rowH + SEAM, (r + 1) * rowH - SEAM);
      if (space && (space.n > 0 || space === CORRIDOR)) {
        // One unbroken band at hip height: the first thing the eye picks up when a door opens.
        const [cr, cg, cb] = space.paint;
        g.use('paintWhite').tint(cr, cg, cb);
        g.box(mid, 1.42, side * (t + 0.054), (b - a) / 2 + SEAM, 0.16, 0.001, faces);
        g.tint(1);
      }
    }
  }
  if (!w.decked) g.use('steelDark').bevel((u0 + u1) / 2, h + 0.05, 0, (u1 - u0) / 2, 0.06, t + 0.05, 0.02);
}

function buildSpan(k: Kit, plan: MapPlan, w: WallDef, ux: number, uz: number, u0: number, u1: number): void {
  const g = k.geo;
  const t = w.half, h = w.h, mid = (u0 + u1) / 2, half = (u1 - u0) / 2;
  k.collide(mid, h / 2, 0, half, h / 2, t + SKIN, 'concrete');
  if (w.perimeter) k.containment(mid, (h + KH.containment) / 2, 0, half, (KH.containment - h) / 2, t + SKIN);
  g.use('concreteDark').tint(0.72);
  g.slab(mid, h / 2, 0, half, h / 2, t, 1.6, FACE.pz | FACE.nz | FACE.px | FACE.nx | (w.decked ? 0 : FACE.py));
  g.tint(1);
  dressSpan(k, w, ux, uz, u0, u1);
  plan.walls.push({ ax: w.ax + ux * u0, az: w.az + uz * u0, bx: w.ax + ux * u1, bz: w.az + uz * u1, half: t + SKIN });
}

/** Jambs in the colour of the room you are about to enter, a plate over the join in the floors and the room's number. */
function dressDoor(k: Kit, plan: MapPlan, w: WallDef, ux: number, uz: number, d0: number, d1: number): void {
  const g = k.geo;
  const t = w.half, h = w.h, mid = (d0 + d1) / 2, nx = -uz, nz = ux;
  const cx = w.ax + ux * mid, cz = w.az + uz * mid;
  const front = spaceAt(cx + nx * 1.5, cz + nz * 1.5), back = spaceAt(cx - nx * 1.5, cz - nz * 1.5);
  plan.doors.push({ x: cx, z: cz, dx: nx, dz: nz, w: d1 - d0 });
  const room = front?.n ? front : back?.n ? back : null;
  const jamb: Rgb = room?.paint ?? CORRIDOR.paint;
  g.use('paintWhite').tint(jamb[0], jamb[1], jamb[2]);
  g.box(d0, h / 2, 0, 0.001, h / 2, t + SKIN, FACE.px);
  g.box(d1, h / 2, 0, 0.001, h / 2, t + SKIN, FACE.nx);
  g.tint(1);
  const depth = t + 0.3;
  g.use('steelDark').tint(0.8).box(mid, 0.016, 0, (d1 - d0) / 2, 0.001, depth, FACE.py);
  g.tint(1).use('hazard');
  for (const s of [1, -1]) g.box(mid, 0.018, s * (depth - 0.09), (d1 - d0) / 2, 0.001, 0.09, FACE.py);
  for (const side of [1, -1]) {
    const beyond = side > 0 ? back : front;
    if (!beyond?.n) continue;
    // The number of the room ahead, on the wall beside the door, on the side you approach from.
    k.push(d1 + 0.95, 0, side * (t + 0.056), side > 0 ? 0 : Math.PI);
    stencil(k, digit(beyond.n), 0, 2.75, 0, 1.25, beyond.paint);
    k.pop();
  }
}

function buildWall(k: Kit, plan: MapPlan, w: WallDef): void {
  const dx = w.bx - w.ax, dz = w.bz - w.az;
  const len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  k.push(w.ax, 0, w.az, Math.atan2(-dz, dx));
  let u = 0;
  for (const [d0, d1] of w.doors) {
    if (d0 > u) buildSpan(k, plan, w, ux, uz, u, d0);
    if (!w.perimeter) dressDoor(k, plan, w, ux, uz, d0, d1);
    u = d1;
  }
  if (u < len) buildSpan(k, plan, w, ux, uz, u, len);
  k.pop();
}

function floorRect(k: Kit, s: Space, x0: number, z0: number, x1: number, z1: number, step = 1.2): void {
  const g = k.geo.use(s.floor);
  g.tint(s.floorTint[0], s.floorTint[1], s.floorTint[2]);
  g.gridStep(x0, 0, z1, x1 - x0, 0, 0, 0, 0, z0 - z1, step);
  g.tint(1);
}

/** Painted line, flat on the floor. */
export function floorLine(k: Kit, x0: number, z0: number, x1: number, z1: number, rgb: Rgb, y = 0.012): void {
  const g = k.geo.use('paintWhite');
  g.tint(rgb[0], rgb[1], rgb[2]);
  g.box((x0 + x1) / 2, y, (z0 + z1) / 2, (x1 - x0) / 2, 0.001, (z1 - z0) / 2, FACE.py);
  g.tint(1);
}

function frameFloor(k: Kit, s: Space, inset: number, w: number): void {
  const a = s.x0 + inset, b = s.x1 - inset, c = s.z0 + inset, d = s.z1 - inset;
  floorLine(k, a, c, b, c + w, s.paint);
  floorLine(k, a, d - w, b, d, s.paint);
  floorLine(k, a, c + w, a + w, d - w, s.paint);
  floorLine(k, b - w, c + w, b, d - w, s.paint);
}

/** A room's edge on the nearest wall centre line, so floors tile with no overlap and run through every doorway. */
const toCentre = (v: number): number => {
  const a = Math.abs(v);
  return Math.sign(v) * (a > 20 ? KH.outer : a > 12 ? KH.ring : KH.court);
};

/** Pieces of the band between two squares, half-widths `a` < `b`. */
function band(k: Kit, s: Space, a: number, b: number): void {
  floorRect(k, s, -b, -b, b, -a);
  floorRect(k, s, -b, a, b, b);
  floorRect(k, s, -b, -a, -a, a);
  floorRect(k, s, a, -a, b, a);
}

function buildFloors(k: Kit): void {
  // One collider under everything, so a sprint from gate to gate crosses no seam at all.
  k.collide(0, -1, 0, 60, 1, 60, 'concrete');
  band(k, YARD, KH.outer, YARD_OUT);
  band(k, CORRIDOR, KH.court, KH.ring);
  floorRect(k, COURT, -KH.court, -KH.court, KH.court, KH.court);
  for (const r of ROOMS) {
    floorRect(k, r, toCentre(r.x0), toCentre(r.z0), toCentre(r.x1), toCentre(r.z1));
    frameFloor(k, r, 0.5, 0.14);
  }
  // Outside the wall nobody walks: a big dim plane so the overview does not float in the sky.
  const g = k.geo.use('dirt');
  g.tint(0.5, 0.52, 0.56);
  for (const [x, z, w, d] of [[-210, -210, 420, 170], [-210, 40, 420, 170], [-210, -40, 170, 80], [40, -40, 170, 80]] as const) {
    g.gridStep(x, -0.02, z + d, w, 0, 0, 0, 0, -d, 14);
  }
  g.tint(1);
}

function buildGate(k: Kit, spec: MapSpec, gate: GateDef): void {
  const g = k.geo;
  const { w } = gate;
  const D = KH.gateDepth, H = KH.perimeterH, C = KH.containment;
  k.push(gate.x, 0, gate.z, gate.yaw);
  k.block('concrete', 0.02, 0, -w / 2 - 1, D + 1, H, -w / 2, 0.05);
  k.block('concrete', 0.02, 0, w / 2, D + 1, H, w / 2 + 1, 0.05);
  k.block('concreteDark', D, 0, -w / 2, D + 1, H, w / 2, 0.05);
  k.containment((D + 1) / 2, (H + C) / 2, -w / 2 - 0.5, (D + 1) / 2, (C - H) / 2, 0.5);
  k.containment((D + 1) / 2, (H + C) / 2, w / 2 + 0.5, (D + 1) / 2, (C - H) / 2, 0.5);
  k.containment(D + 0.5, (H + C) / 2, 0, 0.5, (C - H) / 2, w / 2);
  g.use('asphalt').tint(0.5).gridStep(0, 0.004, w / 2, D, 0, 0, 0, 0, -w, 1.2);
  // Roller shutter, jammed open a body's height: this is the dark they come out of.
  g.use('panel').tint(0.44, 0.48, 0.54);
  for (let y = 3; y < H - 0.4; y += 0.34) g.bevel(D - 0.1, y, 0, 0.06, 0.15, w / 2 - 0.04, 0.03);
  g.tint(1);
  g.use('rubber').tint(0.5).box(D - 0.02, 1.5, 0, 0.01, 1.5, w / 2 - 0.1, FACE.nx);
  g.tint(1).use('hazard');
  g.box(D - 0.24, 2.92, 0, 0.1, 0.1, w / 2 - 0.04, FACE.nx | FACE.ny | FACE.py);
  g.use('steelDark');
  for (const s of [1, -1]) g.bevel(D - 0.3, 3.75, s * (w / 2 - 0.16), 0.18, 3.75, 0.16, 0.03);
  // Red means someone comes through here. It is the only warm light on the site that the player did not cause.
  g.use('emissiveRed');
  g.box(-0.02, 5.6, 0, 0.03, 0.09, w / 2 - 0.3, FACE.nx | FACE.py | FACE.ny);
  k.light(1.2, 3.6, 0, 'red', 18, 9);
  k.light(-1.6, 4.8, 0, 'white', 26, 13);
  k.pop();
  spec.plan!.gates.push({ x: gate.x, z: gate.z, yaw: gate.yaw, w, bay: true });
  const ox = Math.cos(gate.yaw), oz = -Math.sin(gate.yaw);
  const inset = D - 1.3;
  spec.gate('ring-yard', gate.x + ox * inset, 0.1, gate.z + oz * inset);
  floorStencil(k, 'CHEVRON', gate.x - ox * 2.1, gate.z - oz * 2.1, gate.yaw + Math.PI / 2, 2.6, [0.84, 0.18, 0.14], 0.014);
}

/** A shutter on the wall face with the same red line as the bays. Everything sits inside the wall's collider skin. */
function buildSallyPort(k: Kit, spec: MapSpec, gate: GateDef): void {
  const g = k.geo;
  const { w } = gate;
  k.push(gate.x, 0, gate.z, gate.yaw);
  // Wall panels stand 5 cm proud and the collider 6, so the whole shutter lives in the last centimeter.
  g.use('panel').tint(0.44, 0.48, 0.54);
  for (let y = 0.2; y < 3.3; y += 0.34) g.bevel(-0.052, y, 0, 0.006, 0.15, w / 2, 0.003);
  g.tint(1).use('steelDark');
  for (const s of [1, -1]) g.bevel(-0.053, 1.8, s * (w / 2 + 0.14), 0.006, 1.8, 0.14, 0.003);
  g.bevel(-0.053, 3.5, 0, 0.006, 0.14, w / 2 + 0.28, 0.003);
  g.use('emissiveRed');
  g.box(-0.055, 4.1, 0, 0.004, 0.09, w / 2 - 0.3, FACE.nx | FACE.py | FACE.ny);
  k.push(-0.059, 0, 0, -Math.PI / 2);
  stencil(k, 'NO ENTRY', 0, 1.75, 0, 0.8, [0.84, 0.18, 0.14]);
  k.pop();
  k.light(-1.6, 3.6, 0, 'red', 14, 8);
  k.light(-2.4, 4.6, 0, 'white', 26, 13);
  k.pop();
  const ox = Math.cos(gate.yaw), oz = -Math.sin(gate.yaw);
  spec.plan!.gates.push({ x: gate.x, z: gate.z, yaw: gate.yaw, w, bay: false });
  spec.gate('ring-yard', gate.x - ox * 1.2, 0.1, gate.z - oz * 1.2);
  floorStencil(k, 'CHEVRON', gate.x - ox * 2.4, gate.z - oz * 2.4, gate.yaw + Math.PI / 2, 2.2, [0.84, 0.18, 0.14], 0.014);
}

/** Chain-link along the top of the perimeter, with a gap over each bay. */
function buildPerimeterTop(k: Kit): void {
  const H = KH.perimeterH, P = KH.perimeter, c = KH.chamfer - P + 0.7, g = KH.gateW / 2 + 0.5;
  for (let i = 0; i < 4; i++) {
    const [ax, az] = rot(i, -c, -P), [bx, bz] = rot(i, -g, -P), [cx, cz] = rot(i, g, -P), [dx, dz] = rot(i, c, -P), [ex, ez] = rot(i, P, -c);
    fence(k, [ax, az, bx, bz], H, 2.1, false);
    fence(k, [cx, cz, dx, dz, ex, ez], H, 2.1, false);
  }
}

export function authorShell(k: Kit, spec: MapSpec): void {
  const plan = spec.plan!;
  buildFloors(k);
  for (const w of WALLS) buildWall(k, plan, w);
  for (const gate of GATES) (gate.bay ? buildGate : buildSallyPort)(k, spec, gate);
  buildPerimeterTop(k);
}
