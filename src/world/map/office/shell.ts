/** The building: slabs, walls, the stairs, the lift shaft, the roof and the tower over it. */
import { FACE } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import type { MapSpec } from '../spec';
import { Builder, CEILING, cut, paneSplit } from './build';
import {
  B, BRIDGE, CEIL, CURB, ESCAPE, INNER, LIFT, LIFT_WALLS, LV, OUTER, PARAPET, rect, ROOMS, type Rect, SKYLIGHTS, STAIR_A, STAIR_R, T_OUT, TOWER,
  floorY,
} from './plan';

/** The lift shaft and the stair's flight are open through the first floor. */
export const F2_HOLES: readonly Rect[] = [
  rect(LIFT.x0, LIFT.z0, LIFT.x1, LIFT.z1),
  rect(-3.85, STAIR_A.z1, STAIR_A.gallery, -6.2),
];
/** The roof: the lift, the roof stair and the skylights. */
export const ROOF_HOLES: readonly Rect[] = [
  rect(LIFT.x0, LIFT.z0, LIFT.x1, LIFT.z1),
  rect(STAIR_R.x0 - 0.2, STAIR_R.z - STAIR_R.w / 2 - 0.1, STAIR_R.x1 + 0.1, STAIR_R.z + STAIR_R.w / 2 + 0.3),
  ...SKYLIGHTS,
];

function floors(b: Builder): void {
  for (const r of ROOMS) {
    for (const p of r.floor === 'g' ? [r] : cut(r, F2_HOLES)) b.finish(r.mat, r.tint, p, floorY(r.floor) + 0.006, 2);
    b.fill(r, r.paint);
  }
  b.finish('concreteDark', [0.5, 0.5, 0.52], LIFT, LV.g + 0.006);
  // The first floor, its underside the ground floor's ceiling. Its top is the rooms' finishes.
  b.slab(B, CEIL.g, LV.f2, F2_HOLES, CEILING);
  // The roof, its top a dark membrane.
  b.slab(B, CEIL.f2, LV.roof, ROOF_HOLES, CEILING, { mat: 'concreteDark', tint: [0.42, 0.44, 0.46] });
}

function walls(b: Builder): void {
  for (const w of OUTER) b.wall(w, true);
  for (const w of INNER) {
    if (w.glass) glassWall(b, w);
    else b.wall(w);
  }
  for (const w of LIFT_WALLS) b.wall(w);
  // The lift's machine room has a lid.
  b.box('concreteDark', [0.6, 0.6, 0.62], LIFT.x0 - 0.2, LIFT.top, LIFT.z0 - 0.2, LIFT.x1 + 0.2, LIFT.top + 0.3, LIFT.z1 + 0.2);
  // The parapet's coping and a lit line at each floor round the outside.
  const g = b.g;
  const e = T_OUT / 2;
  g.use('steelDark').tint(0.7);
  for (const [x0, z0, x1, z1] of [[B.x0 - e - 0.06, B.z0 - e - 0.06, B.x1 + e + 0.06, B.z0 + e + 0.06], [B.x0 - e - 0.06, B.z1 - e - 0.06, B.x1 + e + 0.06, B.z1 + e + 0.06],
    [B.x0 - e - 0.06, B.z0, B.x0 + e + 0.06, B.z1], [B.x1 - e - 0.06, B.z0, B.x1 + e + 0.06, B.z1]] as const) {
    g.bevel((x0 + x1) / 2, PARAPET + 0.05, (z0 + z1) / 2, (x1 - x0) / 2, 0.05, (z1 - z0) / 2, 0.02);
  }
  g.tint(1).use('emissiveCyan');
  for (const y of [LV.f2 - 0.15, LV.roof - 0.15]) {
    g.box(0, y, B.z1 + e + 0.03, (B.x1 - B.x0) / 2, 0.025, 0.02, FACE.pz);
    g.box(0, y, B.z0 - e - 0.03, (B.x1 - B.x0) / 2, 0.025, 0.02, FACE.nz);
    g.box(B.x0 - e - 0.03, y, 0, 0.02, 0.025, (B.z1 - B.z0) / 2, FACE.nx);
    g.box(B.x1 + e + 0.03, y, 0, 0.02, 0.025, (B.z1 - B.z0) / 2, FACE.px);
  }
}

/** A glass partition: an aluminium base and head and mullions, the panes left for the breakables. Doors are open frames. */
function glassWall(b: Builder, w: (typeof INNER)[number]): void {
  const g = b.g, alongX = w.axis === 'x';
  const put = (u0: number, u1: number, y0: number, y1: number, d: number) => {
    const u = (u0 + u1) / 2, hu = (u1 - u0) / 2, y = (y0 + y1) / 2, hy = (y1 - y0) / 2;
    g.use('steel').tint(0.62, 0.66, 0.7);
    if (alongX) g.bevel(u, y, w.at, hu, hy, d, 0.01);
    else g.bevel(w.at, y, u, d, hy, hu, 0.01);
    g.tint(1);
  };
  put(w.from, w.to, w.y0, w.y0 + 0.08, 0.06);
  put(w.from, w.to, w.y1 - 0.12, w.y1, 0.08);
  const n = Math.round((w.to - w.from) / 1.6);
  for (let i = 0; i <= n; i++) {
    const u = w.from + ((w.to - w.from) * i) / n;
    if (w.holes.some(h => Math.abs(h.at - u) < h.w / 2 + 0.05)) continue;
    put(u - 0.03, u + 0.03, w.y0, w.y1, 0.05);
  }
  for (const h of w.holes) {
    put(h.at - h.w / 2 - 0.05, h.at - h.w / 2 + 0.03, w.y0, w.y1, 0.07);
    put(h.at + h.w / 2 - 0.03, h.at + h.w / 2 + 0.05, w.y0, w.y1, 0.07);
    put(h.at - h.w / 2, h.at + h.w / 2, h.y1, h.y1 + 0.08, 0.07);
    b.plan.doors.push({ x: alongX ? h.at : w.at, z: alongX ? w.at : h.at, dx: alongX ? 0 : 1, dz: alongX ? 1 : 0, w: h.w });
  }
  b.plan.walls.push({ ax: alongX ? w.from : w.at, az: alongX ? w.at : w.from, bx: alongX ? w.to : w.at, bz: alongX ? w.at : w.to, half: 0.08 });
}

function stairs(b: Builder): void {
  // Stair A: up the west side of the core, the gallery along the east.
  b.stairs(STAIR_A.x, STAIR_A.z0, LV.g, STAIR_A.x, STAIR_A.z1, LV.f2, STAIR_A.w);
  b.rail([STAIR_A.gallery + 0.05, LV.f2, -6.3, STAIR_A.gallery + 0.05, LV.f2, STAIR_A.z1]);
  b.rail([-3.8, LV.f2, STAIR_A.z1 + 0.05, STAIR_A.gallery, LV.f2, STAIR_A.z1 + 0.05]);
  // The roof stair, along the north wall of the open office.
  b.k.stairs(STAIR_R.x0, STAIR_R.z, LV.f2, STAIR_R.x1, STAIR_R.z, LV.roof, STAIR_R.w, 'steel');
  const s = STAIR_R.z + STAIR_R.w / 2 + 0.25;
  b.rail([STAIR_R.x0 - 0.2, LV.roof, s, STAIR_R.x1, LV.roof, s]);
  b.rail([STAIR_R.x0 - 0.2, LV.roof, -17.6, STAIR_R.x0 - 0.2, LV.roof, s]);
}

function roof(b: Builder): void {
  // Curbs round the skylights, tall enough that the nav never drops a man through one.
  for (const r of SKYLIGHTS) {
    const t = 0.25;
    for (const [x0, z0, x1, z1] of [[r.x0 - t, r.z0 - t, r.x1 + t, r.z0], [r.x0 - t, r.z1, r.x1 + t, r.z1 + t], [r.x0 - t, r.z0, r.x0, r.z1], [r.x1, r.z0, r.x1 + t, r.z1]] as const) {
      b.box('concrete', [0.62, 0.62, 0.64], x0, LV.roof, z0, x1, LV.roof + CURB, z1, 0.03);
    }
    b.block(r.x0 - t, r.z0 - t, r.x1 + t, r.z1 + t);
  }
  tower(b.k, b);
}

/** A dark glass tower over the west of the roof, lit window by window. Out of bounds: one collider, no climb. */
function tower(k: Kit, b: Builder): void {
  const T = TOWER, g = k.geo;
  k.noClimb(() => b.solid(T.x0, LV.roof, T.z0, T.x1, T.top, T.z1, 'glass'));
  const w = T.x1 - T.x0, d = T.z1 - T.z0, h = T.top - LV.roof, cx = (T.x0 + T.x1) / 2, cz = (T.z0 + T.z1) / 2, cy = (LV.roof + T.top) / 2;
  g.use('steelDark').tint(0.32, 0.38, 0.48).slab(cx, cy, cz, w / 2, h / 2, d / 2, 4, FACE.sides | FACE.py);
  g.tint(1);
  // Spandrels and mullions: a grid of lines proud of the glass, and a scatter of lit windows.
  const floors = Math.floor(h / 3.6);
  g.use('steel').tint(0.36, 0.4, 0.46);
  for (let i = 1; i < floors; i++) {
    const y = LV.roof + i * 3.6;
    g.box(cx, y, T.z1 + 0.04, w / 2, 0.12, 0.04, FACE.pz | FACE.py | FACE.ny);
    g.box(T.x1 + 0.04, y, cz, 0.04, 0.12, d / 2, FACE.px | FACE.py | FACE.ny);
  }
  for (let x = T.x0 + 1.5; x < T.x1; x += 1.5) g.box(x, cy, T.z1 + 0.05, 0.04, h / 2, 0.05, FACE.pz | FACE.px | FACE.nx);
  for (let z = T.z0 + 1.5; z < T.z1; z += 1.5) g.box(T.x1 + 0.05, cy, z, 0.05, h / 2, 0.04, FACE.px | FACE.pz | FACE.nz);
  g.tint(1);
  for (let i = 2; i < floors; i++) {
    for (let x = T.x0 + 0.75; x < T.x1 - 0.5; x += 1.5) {
      if (k.rng() > 0.22) continue;
      const lit = k.rng() > 0.4 ? 'emissiveDim' : 'screen';
      g.use(lit).box(x, LV.roof + i * 3.6 + 1.7, T.z1 + 0.01, 0.66, 1.3, 0.01, FACE.pz);
    }
    for (let z = T.z0 + 0.75; z < T.z1 - 0.5; z += 1.5) {
      if (k.rng() > 0.18) continue;
      g.use('emissiveDim').box(T.x1 + 0.01, LV.roof + i * 3.6 + 1.7, z, 0.01, 1.3, 0.66, FACE.px);
    }
  }
  // Its name, high on the south face, where the whole plaza reads it.
  g.use('emissiveMagenta').box(cx, T.top - 4, T.z1 + 0.08, w * 0.36, 0.08, 0.02, FACE.pz);
  g.box(cx, T.top - 6.4, T.z1 + 0.08, w * 0.36, 0.08, 0.02, FACE.pz);
}

/** The fire escape on the north face: steel flights and grated landings, rails on the open side. */
function fireEscape(b: Builder): void {
  const E = ESCAPE, z = (E.z0 + E.z1) / 2, w = E.z1 - E.z0;
  b.k.stairs(E.f1[0], z, LV.g, E.f1[1], z, LV.f2, w, 'steel', false);
  b.k.stairs(E.f2[0], z, LV.f2, E.f2[1], z, LV.roof, w, 'steel', false);
  for (const [[x0, x1], y] of [[E.land1, LV.f2], [E.land2, LV.roof]] as const) {
    b.k.catwalk(x0, z, x1, z, y, w, 'none');
    b.rail([x0, y, E.z0 + 0.05, x1, y, E.z0 + 0.05]);
    b.plan.decks.push({ x0, z0: E.z0, x1, z1: E.z1 });
  }
  b.rail([E.f1[0], LV.g, E.z0 + 0.05, E.f1[1], LV.f2, E.z0 + 0.05]);
  b.rail([E.f2[0], LV.f2, E.z0 + 0.05, E.f2[1], LV.roof, E.z0 + 0.05]);
  // Brackets into the wall under each landing.
  for (const x of [11, 16, 25, 27.5]) b.k.beam(x, (x < 20 ? LV.f2 : LV.roof) - 0.25, B.z0 - T_OUT / 2, x, (x < 20 ? LV.f2 : LV.roof) - 0.25, E.z0, 0.06, 0.1);
}

/**
 * Glass, every pane a breakable: the outside windows and storefront, the meeting rooms' partitions, the skybridge and the skylights.
 * Panes sit between the mullions the walls drew.
 */
function glass(spec: MapSpec): void {
  const put = (alongX: boolean, at: number, u0: number, u1: number, y0: number, y1: number) => {
    const u = (u0 + u1) / 2, w = u1 - u0 - 0.06, h = y1 - y0 - 0.04;
    if (w < 0.2 || h < 0.2) return;
    if (alongX) spec.breakable('pane', u, (y0 + y1) / 2, at, 0, w, h);
    else spec.breakable('pane', at, (y0 + y1) / 2, u, Math.PI / 2, w, h);
  };
  for (const w of OUTER) for (const h of w.holes) {
    if (h.kind !== 'pane') continue;
    for (const [u0, u1] of paneSplit(h)) put(w.axis === 'x', w.at, u0, u1, h.y0 ?? w.y0, h.y1);
  }
  for (const w of INNER) {
    if (!w.glass) continue;
    const n = Math.round((w.to - w.from) / 1.6);
    for (let i = 0; i < n; i++) {
      let a = w.from + ((w.to - w.from) * i) / n, c = w.from + ((w.to - w.from) * (i + 1)) / n;
      for (const h of w.holes) {
        const h0 = h.at - h.w / 2 - 0.05, h1 = h.at + h.w / 2 + 0.05;
        if (h1 <= a || h0 >= c) continue;
        if (h0 - a > c - h1) c = h0; else a = h1;
      }
      put(w.axis === 'x', w.at, a, c, w.y0 + 0.08, w.y1 - 0.12);
    }
  }
  const x0 = BRIDGE.x0 + T_OUT / 2, x1 = BRIDGE.x1 - 0.15;
  for (const z of [BRIDGE.z0, BRIDGE.z1]) for (let i = 0; i < 4; i++) put(true, z, x0 + ((x1 - x0) * i) / 4, x0 + ((x1 - x0) * (i + 1)) / 4, LV.f2 + 1, BRIDGE.roof - 0.35);
  for (const r of SKYLIGHTS) for (const i of [0, 1]) for (const j of [0, 1]) {
    const w = (r.x1 - r.x0) / 2, d = (r.z1 - r.z0) / 2;
    spec.breakable('pane', r.x0 + w * (i + 0.5), LV.roof + CURB, r.z0 + d * (j + 0.5), 0, w - 0.06, d - 0.06, true);
  }
}

export function authorShell(k: Kit, spec: MapSpec): void {
  const b = new Builder(k, spec);
  glass(spec);
  floors(b);
  walls(b);
  stairs(b);
  roof(b);
  fireEscape(b);
}
