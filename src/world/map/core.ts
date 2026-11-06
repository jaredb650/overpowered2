/**
 * Crucible Core: a sunken arena around the reactor, a rim plaza, a raised walkway ring at catwalk height and the
 * two floating rings the pads reach. Four viaduct mouths and four spokes make it the hub of the whole map.
 */
import type { Kit } from '../kit/kit';
import { FACE } from '../kit/geo';
import { barrier, cable, machine, pipe, signPanel } from '../kit/props';
import { signId } from '../kit/signs';
import type { MapSpec } from './spec';
import { kicker } from './shared';
import { BOWL, DIAGONALS, LEVEL, VIADUCT } from './layout';

const TAU = Math.PI * 2;
const pol = (a: number, r: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];
const DOOR_HALF = 0.14;
const RAMP_HALF = 0.17;
const CARDINALS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
const DIAG_ANGLES = [-Math.PI / 4, Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4];

const near = (a: number, b: number, tol: number) => {
  const d = Math.atan2(Math.sin(a - b), Math.cos(a - b));
  return Math.abs(d) < tol;
};

export const HALO = { r0: 24, r1: 34, y: LEVEL.halo } as const;
export const CROWN = { r0: 17, r1: 24.5, y: LEVEL.crown } as const;
const RIM_TOP = LEVEL.catwalk;
/** Rim kickers sit this far round from each spoke: clear of the bridges overhead and the pylons behind. */
export const KICKER_ANGLE = Math.PI / 16;

export function authorCore(k: Kit, spec: MapSpec): void {
  arena(k, spec);
  reactor(k, spec);
  rings(k, spec);
  rimWalls(k, spec);
  rimPlaza(k, spec);
}

function arena(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const y = LEVEL.arena;
  const R = BOWL.radius;

  // Floor: concentric bands in polar tessellation, so the circle stays a circle.
  const band = (mat: Parameters<typeof g.use>[0], r0: number, r1: number, seg = 96, tint = 1) => {
    g.use(mat).tint(tint).lathe([r1, 0, r0, 0], 0, y, 0, seg, false);
    g.tint(1);
  };
  for (let r = BOWL.reactor; r < R + 1; r += 3) {
    band(r > 20 && r < 24 ? 'concreteDark' : 'concrete', r, Math.min(R + 1, r + 3));
  }
  // Inlaid guide rings around the reactor; the floor points you at the hero.
  band('emissiveCyan', 20.6, 20.85, 96);
  band('emissiveCyan', 37.5, 37.7, 96);
  band('paintWhite', 15, 16.4, 96, 0.55);
  k.collide(0, y - 1, 0, R + 4, 1, R + 4, 'concrete');
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    if (i % 3 === 0) continue;
    const [ax, az] = pol(a, 22.5), [bx, bz] = pol(a, 37.5);
    k.stripLine([ax, y, az, bx, y, bz], 0.14);
  }

  // Bowl wall: run around it. Openings at the spokes (doors) and diagonals (ramps).
  const segs = 96;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU, am = (a0 + a1) / 2;
    const [ax, az] = pol(a0, R), [bx, bz] = pol(a1, R);
    const isRamp = DIAG_ANGLES.some(d => near(am, d, RAMP_HALF));
    const isDoor = CARDINALS.some(c => near(am, c, DOOR_HALF));
    if (isRamp) continue;
    k.wall(ax, az, bx, bz, isDoor ? -2 : y, 0, { thick: 1, bay: 100, lift: 2.7, pilasters: false, cap: false, plinth: !isDoor, strip: isDoor ? undefined : { mat: 'emissiveCyan', y: -1.1, h: 0.1 } });
    // Fills the ragged marching-squares edge behind the wall, so the rim is solid to the lip.
    const [cx, cz] = pol(am, R + 2.2);
    k.push(cx, 0, cz, -am + Math.PI / 2);
    k.collide(0, -1, 0, 1.9, 1, 1.9, 'concrete');
    k.pop();
    if (i % 3 === 1 && !isDoor) {
      const [px, pz] = pol(am, R - 0.55);
      k.push(px, 0, pz, Math.PI / 2 - am);
      g.use('concreteDark').tint(0.85).bevel(0, y / 2, 0, 0.6, -y / 2, 0.45, 0.1);
      g.tint(1);
      k.pop();
    }
    // Coping at the lip.
    const [ix, iz] = pol(a0, R + 0.5), [jx, jz] = pol(a1, R + 0.5);
    g.use('steelDark').quad(ix, 0.08, iz, jx, 0.08, jz, jx * 0.97, 0.08, jz * 0.97, ix * 0.97, 0.08, iz * 0.97);
  }

  // Lintel doors on the spokes lead to the lower level. The tunnels themselves live in lower.ts.
  for (const c of CARDINALS) {
    const [dx, dz] = pol(c, R - 0.2);
    k.push(dx, y, dz, Math.PI / 2 - c);
    const sg = k.geo;
    sg.use('steelDark');
    sg.bevel(-6.6, 3, 0, 0.6, 3.1, 0.9, 0.1);
    sg.bevel(6.6, 3, 0, 0.6, 3.1, 0.9, 0.1);
    sg.bevel(0, 6.3, 0, 7.2, 0.45, 1, 0.1);
    sg.use('hazard').box(0, 5.75, -0.82, 6, 0.1, 0.05, FACE.nz);
    sg.use('emissiveCyan');
    sg.box(-5.9, 3, -0.92, 0.05, 2.6, 0.03, FACE.nz);
    sg.box(5.9, 3, -0.92, 0.05, 2.6, 0.03, FACE.nz);
    k.pop();
    const [lx, lz] = pol(c, R - 3);
    k.light(lx, y + 4, lz, 'cyan', 36, 18);
  }

  // Ramps: straight lines from the viaducts down to the reactor, the fastest way in.
  for (const [ux, uz] of DIAGONALS) {
    const r0 = BOWL.radius - 10, r1 = VIADUCT.r0;
    k.ramp(ux * r1, uz * r1, 0, ux * r0, uz * r0, y, VIADUCT.width, 'concrete', 1.2);
    k.stripLine(sideLine(ux, uz, r0, r1, VIADUCT.width / 2 - 0.5, y, 0), 0.16);
    k.stripLine(sideLine(ux, uz, r0, r1, -VIADUCT.width / 2 + 0.5, y, 0), 0.16);
    // Side walls of the cut through the rim.
    const hw = VIADUCT.width / 2;
    const px = -uz, pz = ux;
    const r2 = BOWL.radius - 4;
    for (const s of [1, -1]) {
      const a = [ux * r2 + px * s * (hw + 0.5), uz * r2 + pz * s * (hw + 0.5)] as const;
      const b = [ux * r1 + px * s * (hw + 0.5), uz * r1 + pz * s * (hw + 0.5)] as const;
      if (s > 0) k.wall(b[0], b[1], a[0], a[1], y, 0, { thick: 1, bay: 7, lift: 2.7, strip: { mat: 'emissiveCyan', y: -1.1, h: 0.1 } });
      else k.wall(a[0], a[1], b[0], b[1], y, 0, { thick: 1, bay: 7, lift: 2.7, strip: { mat: 'emissiveCyan', y: -1.1, h: 0.1 } });
    }
  }

  // Cover: capacitor banks between the ramps, so the floor is not a shooting gallery.
  for (let q = 0; q < 8; q++) {
    const a = (q / 8) * TAU + TAU / 16;
    const [x, z] = pol(a, 34);
    machine(k, x, y, z, Math.PI / 2 - a, 5.5, 2.6, 2.6);
  }
  for (let q = 0; q < 16; q++) {
    const a = (q / 16) * TAU + TAU / 32;
    const [x, z] = pol(a, 26);
    if (q % 2) barrier(k, x, y, z, Math.PI / 2 - a, 4.5);
  }

  spec.view('core_floor', 37, y + 1.7, 6, 0, 18, 0);
  spec.view('core_ramp', 56, 1.7, -56, 0, 14, 0);
  spec.gate('core', 0, y + 0.1, -44);
  spec.gate('core', 44, y + 0.1, 0);
  spec.gate('core', 0, y + 0.1, 44);
  spec.gate('core', -44, y + 0.1, 0);
  for (let q = 0; q < 4; q++) {
    const [x, z] = pol(q * Math.PI / 2 + Math.PI / 8, 32);
    spec.pickup(x, y + 1, z);
  }
}

const sideLine = (ux: number, uz: number, r0: number, r1: number, off: number, y0: number, y1: number): number[] => {
  const px = -uz, pz = ux;
  return [ux * r0 + px * off, y0, uz * r0 + pz * off, ux * r1 + px * off, y1, uz * r1 + pz * off];
};

/** The landmark. Everything else in the map is scaled against this. */
function reactor(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const y0 = LEVEL.arena;
  const top = 112;
  spec.reactor = { floorY: y0, topY: top };

  // Stepped plinth.
  g.use('concreteDark').lathe([14.6, 0, 14.6, 1.6, 13.4, 2.1, 13.4, 4.4, 12.6, 4.9, 12.6, 9], 0, y0, 0, 64, false);
  g.use('steelDark').lathe([12.65, 8.9, 13, 9.2, 13, 9.9, 12.2, 10.3], 0, y0, 0, 64, false);
  // Lower drum.
  g.use('panel').tint(0.74, 0.8, 0.88).lathe([12.2, 10.3, 11.6, 30], 0, y0, 0, 64, false);
  g.tint(1);
  // Upper drum above the core window. It flares like a cooling tower, which reads from the far side of the map.
  const prof: number[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const y = 36 + t * 62;
    const r = 8.2 + 4.4 * Math.pow(Math.abs(t - 0.42) / 0.58, 2.1) + (t < 0.42 ? 2.2 * (0.42 - t) : 0);
    prof.push(r, y);
  }
  g.use('concrete').tint(0.82, 0.86, 0.94).lathe(prof, 0, 0, 0, 56, true);
  g.tint(1);
  const lip = prof[prof.length - 2]!;
  g.use('steelDark').lathe([lip, 98, lip + 0.6, 98.4, lip + 0.6, 99.8, lip - 1.6, 100.6, lip - 1.6, 99, 3.2, 99, 3.2, 96], 0, 0, 0, 56, false);
  g.use('steelDark').cyl(0, 96, 0, 0, top, 0, 2.4, 0.7, 16, false, true);
  for (let y = 40; y < 96; y += 11) {
    const t = (y - 36) / 62;
    const r = 8.2 + 4.4 * Math.pow(Math.abs(t - 0.42) / 0.58, 2.1) + (t < 0.42 ? 2.2 * (0.42 - t) : 0);
    g.use('steelDark').lathe([r, y - 0.35, r + 0.3, y - 0.2, r + 0.3, y + 0.2, r, y + 0.35], 0, 0, 0, 48, false);
    g.use('emissiveCyan').lathe([r + 0.32, y - 0.05, r + 0.32, y + 0.05], 0, 0, 0, 48, false);
  }
  // Vertical ribs on the lower drum.
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * TAU + TAU / 64;
    const [x, z] = pol(a, 12.05);
    k.push(x, 0, z, Math.PI / 2 - a, 0, 0);
    g.use('steelDark').bevel(0, y0 + 20, 0, 0.3, 19, 0.28, 0.05);
    k.pop();
  }
  // Collars.
  for (const y of [8, 15, 22]) {
    g.use('steelDark').lathe([11.95, y - 0.5, 12.4, y - 0.35, 12.4, y + 0.35, 11.95, y + 0.5], 0, 0, 0, 56, false);
  }

  // Containment cage around the exposed core, y 24 to 36.
  g.use('steelDark').lathe([11.6, 22, 12.4, 22.4, 12.4, 23.6, 7.2, 24.2, 7.2, 23], 0, 0, 0, 48, false);
  g.use('steelDark').lathe([7.2, 36.8, 7.2, 35.8, 12.8, 36.4, 12.8, 37.6, 10.6, 38], 0, 0, 0, 48, false);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const [ax, az] = pol(a, 11.6), [bx, bz] = pol(a + 0.14, 11.8);
    k.beam(ax, 22.8, az, bx, 37, bz, 0.34, 0.42, 'steelDark');
  }

  // Four great legs: the silhouette at ground level, and a run-up surface.
  for (const c of CARDINALS) {
    const [fx, fz] = pol(c, 29), [tx, tz] = pol(c, 11);
    k.along(fx, y0, fz, tx, 44, tz, len => {
      g.use('concrete').tint(0.84, 0.88, 0.94).slab(len / 2, 0, 0, len / 2, 1.5, 3, 3.5, FACE.all);
      g.tint(1);
      g.use('steelDark').bevel(len / 2, 1.62, 0, len / 2 - 2, 0.14, 1.2, 0.04);
      g.use('emissiveCyan').box(len / 2, 1.8, 0, len / 2 - 3, 0.05, 0.14, FACE.py | FACE.pz | FACE.nz);
      g.use('concreteDark').bevel(len / 2, 0, 3.2, len / 2 - 2, 1.1, 0.22, 0.04);
      g.use('concreteDark').bevel(len / 2, 0, -3.2, len / 2 - 2, 1.1, 0.22, 0.04);
      k.collide(len / 2, 0, 0, len / 2, 1.5, 3, 'concrete');
    });
    // Foot block anchors the leg visually.
    k.push(fx, y0, fz, Math.PI / 2 - c);
    k.block('concreteDark', -4.5, 0, -3.5, 4.5, 2.4, 4, 0.2);
    k.pop();
  }

  // Coolant lines dropping from the drum to the floor between the legs.
  for (let i = 0; i < 4; i++) {
    const a = DIAG_ANGLES[i]!;
    for (const off of [-0.2, 0.2]) {
      const [ax, az] = pol(a + off, 12.7), [bx, bz] = pol(a + off, 16.5), [cx, cz] = pol(a + off, 17);
      pipe(k, [ax, 5, az, bx, 5, bz, cx, y0 + 0.5, cz], 0.5, 'steel', 6, 10);
    }
  }

  k.collidePrism(0, 0, y0, 23, 13.2, 32, 'metal');
  k.collidePrism(0, 0, 23, 100, 11.6, 24, 'concrete');
  k.vox.fillCylinder(0, 0, y0, 23, 12.5);
  k.vox.fillCylinder(0, 0, 36, 100, 10);

  // Key lighting: the reactor is lit from the floor up, so it is the brightest mass on the map.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + TAU / 16;
    const [x, z] = pol(a, 19);
    k.light(x, y0 + 2.5, z, 'cyan', 90, 30);
  }
  k.light(0, 20, 26, 'cyan', 230, 44);
  k.light(26, 20, 0, 'cyan', 230, 44);
  k.light(0, 20, -26, 'cyan', 230, 44);
  k.light(-26, 20, 0, 'cyan', 230, 44);
  k.light(20, 60, 20, 'white', 260, 40);
  k.light(-20, 60, -20, 'white', 260, 40);
  spec.view('core_reactor', 62, 10, 34, 0, 36, 0);
}

/** Annulus slab in world space with a clean underside and a steel lip. */
function ring(k: Kit, r0: number, r1: number, y: number, thick: number, seg: number): void {
  const g = k.geo;
  g.use('panel').tint(0.8, 0.85, 0.92).lathe([r1, 0, r0, 0], 0, y, 0, seg, false);
  g.tint(1);
  g.use('steelDark').lathe([r0, -thick, r1, -thick], 0, y, 0, seg, false);
  g.use('steelDark').lathe([r1 + 0.1, -thick, r1 + 0.1, 0.1], 0, y, 0, seg, false);
  g.use('steelDark').lathe([r0 - 0.1, 0.1, r0 - 0.1, -thick], 0, y, 0, seg, false);
  g.use('emissiveCyan').lathe([r1 + 0.11, -0.2, r1 + 0.11, -0.05], 0, y, 0, seg, false);
  // Colliders: a polygon of tangent boxes. Flush tops, so the seams are invisible to the feet.
  const n = 40;
  const w = r1 - r0;
  const rm = (r0 + r1) / 2;
  const half = Math.tan(Math.PI / n) * r1 + 0.3;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const [x, z] = pol(a, rm);
    k.push(x, y, z, -a);
    k.collide(0, -thick / 2, 0, w / 2, thick / 2, half, 'metal');
    k.pop();
  }
}

/** Underside of a ring: you see this from the arena, so it gets the structure a real deck would have. */
function ringSoffit(k: Kit, r0: number, r1: number, y: number, n: number): void {
  const g = k.geo;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const [ax, az] = pol(a, r0 + 0.3), [bx, bz] = pol(a, r1 - 0.2);
    k.ibeam(ax, y - 0.55, az, bx, y - 0.55, bz, 0.5, 0.28, 'steelDark');
    if (i % 4 === 0) {
      const [lx, lz] = pol(a + TAU / n / 2, (r0 + r1) / 2);
      k.push(lx, y, lz, -a);
      g.use('steelDark').bevel(0, -0.95, 0, 1.6, 0.1, 0.28, 0.03);
      g.use('emissiveWhite').box(0, -1.06, 0, 1.4, 0.015, 0.14, FACE.ny);
      k.pop();
    }
  }
  for (const r of [r0 + (r1 - r0) * 0.33, r0 + (r1 - r0) * 0.66]) {
    g.use('steelDark').lathe([r - 0.15, y - 1, r + 0.15, y - 1, r + 0.15, y - 0.8, r - 0.15, y - 0.8], 0, 0, 0, 72, false);
    g.use('steel').lathe([r + 0.5, y - 1.02, r + 0.42, y - 1.14, r + 0.28, y - 1.14, r + 0.2, y - 1.02], 0, 0, 0, 72, false);
  }
}

function rings(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  ring(k, HALO.r0, HALO.r1, HALO.y, 0.9, 96);
  ring(k, CROWN.r0, CROWN.r1, CROWN.y, 0.8, 72);
  ringSoffit(k, HALO.r0, HALO.r1, HALO.y, 48);
  ringSoffit(k, CROWN.r0, CROWN.r1, CROWN.y, 36);

  // Struts carry the rings off the legs and drum.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + TAU / 32;
    const [ax, az] = pol(a, HALO.r0 + 4), [bx, bz] = pol(a, 12.4);
    k.beam(ax, HALO.y - 1, az, bx, HALO.y + 7, bz, 0.26, 0.34, 'steelDark');
    const [cx, cz] = pol(a, CROWN.r0 + 3), [dx, dz] = pol(a, 12);
    k.beam(cx, CROWN.y - 0.9, cz, dx, CROWN.y - 7, dz, 0.2, 0.28, 'steelDark');
  }
  // Rails on the rings, broken where pads and bridges meet them.
  for (const [r, y, seg] of [[HALO.r1, HALO.y, 96], [HALO.r0, HALO.y, 96], [CROWN.r1, CROWN.y, 72], [CROWN.r0, CROWN.y, 72]] as const) {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TAU, b = ((i + 1) / seg) * TAU;
      if (CARDINALS.some(c => near(a, c, 0.16)) || near(a, Math.PI / 4, 0.02)) continue;
      if (i % 2) continue;
      const [ax, az] = pol(a, r), [bx, bz] = pol(b, r);
      k.rail([ax, y, az, bx, y, bz], 1.05, 5);
    }
  }

  // Bridges from the Halo to the rim walkway, one per spoke, flying over the plaza.
  for (const c of CARDINALS) {
    const [ax, az] = pol(c, HALO.r1 - 0.5), [bx, bz] = pol(c, BOWL.rim + 2.5);
    k.along(ax, HALO.y, az, bx, RIM_TOP, bz, len => {
      k.mass('panel', 0, -0.8, -3.2, len, 0, 3.2, 3);
      k.rail([0, 0, -3.2, len, 0, -3.2], 1.05, 5);
      k.rail([0, 0, 3.2, len, 0, 3.2], 1.05, 5);
      g.use('emissiveCyan').box(len / 2, -0.25, 3.22, len / 2, 0.04, 0.03, FACE.pz);
      g.box(len / 2, -0.25, -3.22, len / 2, 0.04, 0.03, FACE.nz);
      g.use('steelDark').bevel(len / 2, -1, 0, len / 2, 0.22, 2.2, 0.05);
      // Hangers from a pylon at mid-span give the bridge its shape.
      for (const s of [1, -1]) {
        k.beam(len * 0.5, 7, s * 3.3, 3, 0.1, s * 3.3, 0.03, 0.03, 'steel');
        k.beam(len * 0.5, 7, s * 3.3, len - 3, 0.1, s * 3.3, 0.03, 0.03, 'steel');
        k.beam(len * 0.5, 7, s * 3.3, len * 0.5 - 8, 0.1, s * 3.3, 0.03, 0.03, 'steel');
        k.beam(len * 0.5, 7, s * 3.3, len * 0.5 + 8, 0.1, s * 3.3, 0.03, 0.03, 'steel');
      }
      k.deco('steelDark', len * 0.5 - 0.3, -0.8, -3.6, len * 0.5 + 0.3, 7.2, -3, 0.06);
      k.deco('steelDark', len * 0.5 - 0.3, -0.8, 3, len * 0.5 + 0.3, 7.2, 3.6, 0.06);
      k.deco('steelDark', len * 0.5 - 0.3, 6.6, -3.6, len * 0.5 + 0.3, 7.2, 3.6, 0.06);
    });
  }

  // Pad chain: arena floor to Halo, Halo to Crown, Crown out across the map.
  for (let q = 0; q < 4; q++) {
    const a = q * Math.PI / 2 + Math.PI / 8;
    const [px, pz] = pol(a, 40), [tx, tz] = pol(a, 29);
    spec.pad(px, LEVEL.arena, pz, tx, HALO.y, tz, 3.5);
    const b = a + Math.PI / 4;
    const [hx, hz] = pol(b, 29), [cx, cz] = pol(b, 21);
    spec.pad(hx, HALO.y, hz, cx, CROWN.y, cz, 3);
  }
  // Crown launchers, each aimed down a diagonal at the banked corner of the Ring Road. The high arc keeps
  // horizontal speed under the 45 m/s where air drag starts, and gives you four seconds over the whole map.
  for (const [ux, uz] of DIAGONALS) {
    spec.pad(ux * 20.5, CROWN.y, uz * 20.5, ux * 182, LEVEL.ring + 1.5, uz * 182, 36, 2.4);
  }
  g.tint(1);
  spec.view('core_halo', 28, HALO.y + 1.7, 12, -30, 26, -30);
  spec.view('core_crown', 21, CROWN.y + 1.7, 3, 120, 8, 120);
  spec.pickup(30, HALO.y + 1, 0);
  spec.pickup(-20, CROWN.y + 1, 0);
}

/**
 * Coliseum wall at the edge of the rim plaza. Its top is a walkway at catwalk height. Eight arcs, broken by the spokes
 * and viaduct mouths, tied together by bridges and arches.
 */
function rimWalls(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const R0 = BOWL.rim, R1 = R0 + 5;
  const spokeHalf = 0.21, mouthHalf = 0.145;
  const spans: [number, number][] = [];
  for (let q = 0; q < 4; q++) {
    const c = -Math.PI / 2 + q * Math.PI / 2;
    spans.push([c + spokeHalf, c + Math.PI / 4 - mouthHalf]);
    spans.push([c + Math.PI / 4 + mouthHalf, c + Math.PI / 2 - spokeHalf]);
  }
  for (const [a0, a1] of spans) {
    const seg = 6;
    k.arcWall(0, 0, R0, a0, a1, 0, RIM_TOP, seg, {
      thick: 0.8, lift: 2.7, cap: false, mat: 'concrete', strip: { mat: 'emissiveCyan', y: 3.1, h: 0.1 },
    });
    for (let i = 0; i < seg; i++) {
      const s = a0 + ((a1 - a0) * i) / seg, e = a0 + ((a1 - a0) * (i + 1)) / seg;
      const [ix, iz] = pol(s, R0 - 0.4), [jx, jz] = pol(e, R0 - 0.4), [ox, oz] = pol(s, R1), [px, pz] = pol(e, R1);
      // Solid walkway on top, a clean quad per segment.
      g.use('concrete').grid(ix, RIM_TOP, iz, ox - ix, 0, oz - iz, jx - ix, 0, jz - iz, 2, 2);
      g.use('concreteDark').quad(ix, RIM_TOP - 0.8, iz, jx, RIM_TOP - 0.8, jz, px, RIM_TOP - 0.8, pz, ox, RIM_TOP - 0.8, oz);
      const m = (s + e) / 2;
      const [cx, cz] = pol(m, (R0 + R1) / 2);
      k.push(cx, 0, cz, -m);
      const halfT = (Math.hypot(jx - ix, jz - iz) / 2) * 1.06;
      k.collide(0, RIM_TOP / 2, 0, (R1 - R0) / 2 + 0.3, RIM_TOP / 2, halfT, 'concrete');
      k.pop();
      k.rail([ix, RIM_TOP, iz, jx, RIM_TOP, jz], 1.05, 4);
      k.rail([ox, RIM_TOP, oz, px, RIM_TOP, pz], 1.05, 4);
      // Back face, seen from the zones.
      k.wall(px, pz, ox, oz, 0, RIM_TOP, { thick: 0.5, cap: false, lift: 2.7, bay: 12, collide: false, plain: false, pilasters: false });
    }
    // Stair from the plaza up the inside face, along the arc's first third.
    const sa = a0 + (a1 - a0) * 0.12, sb = a0 + (a1 - a0) * 0.72;
    const [sx, sz] = pol(sa, R0 - 2.4), [ex, ez] = pol(sb, R0 - 2.4);
    k.stairs(sx, sz, 0, ex, ez, RIM_TOP, 3.6, 'concrete');
    const [wx, wz] = pol(sb + 0.012, R0 - 2.4);
    g.use('concrete').lathe([R0 + 0.2, 0, R0 - 4.2, 0], 0, RIM_TOP - 0.01, 0, 160, false, sb, sb + 0.1);
    k.collide(wx, RIM_TOP - 0.3, wz, 3.2, 0.3, 3.2, 'concrete');
  }

  // Bridges across the spokes keep the walkway continuous; arches do the same over the viaduct mouths.
  for (const c of CARDINALS) {
    const [ax, az] = pol(c - spokeHalf - 0.02, (R0 + R1) / 2), [bx, bz] = pol(c + spokeHalf + 0.02, (R0 + R1) / 2);
    k.along(ax, RIM_TOP, az, bx, RIM_TOP, bz, len => {
      k.mass('concreteDark', 0, -1.1, -2.6, len, 0, 2.6, 3);
      k.rail([0, 0, -2.6, len, 0, -2.6]);
      k.rail([0, 0, 2.6, len, 0, 2.6]);
      g.use('steelDark').bevel(len / 2, -1.3, 0, len / 2, 0.2, 1.8, 0.05);
      g.use('emissiveCyan').box(len / 2, -1.05, 2.62, len / 2 - 0.5, 0.05, 0.03, FACE.pz);
      g.box(len / 2, -1.05, -2.62, len / 2 - 0.5, 0.05, 0.03, FACE.nz);
    });
  }
  // In CARDINALS order. Panels face inward, so you read where each spoke leads from the arena side.
  const names = ['REFINERY', 'SCRAPYARD', 'TRANSIT', 'FOUNDRY'] as const;
  CARDINALS.forEach((c, i) => {
    const [x, z] = pol(c, R0 - 1);
    signPanel(k, x, 5.6, z, Math.PI / 2 - c + Math.PI, 11, 2.75, signId(names[i]!));
  });
  for (const [ux, uz] of DIAGONALS) {
    const px = -uz, pz = ux;
    const r = (R0 + R1) / 2;
    const hw = VIADUCT.width / 2 + 3;
    const ax = ux * r + px * hw, az = uz * r + pz * hw, bx = ux * r - px * hw, bz = uz * r - pz * hw;
    k.along(ax, RIM_TOP, az, bx, RIM_TOP, bz, len => {
      k.mass('concreteDark', 0, -1.2, -2.4, len, 0, 2.4, 3);
      k.rail([0, 0, -2.4, len, 0, -2.4]);
      k.rail([0, 0, 2.4, len, 0, 2.4]);
      g.use('emissiveCyan').box(len / 2, -0.9, 2.42, len / 2 - 0.5, 0.05, 0.03, FACE.pz);
      g.box(len / 2, -0.9, -2.42, len / 2 - 0.5, 0.05, 0.03, FACE.nz);
    });
    for (const s of [1, -1]) {
      const cx = ux * r + px * hw * s, cz = uz * r + pz * hw * s;
      k.column(cx, cz, 0, RIM_TOP - 1.2, 2.4, 'concrete', Math.atan2(-uz, ux));
    }
  }
  spec.view('core_rim', 66, RIM_TOP + 1.7, -6, 0, 12, 0);
}

function rimPlaza(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  // Transformer pylons mark the eight arcs and hold the plaza's light.
  for (let q = 0; q < 8; q++) {
    const a = (q / 8) * TAU + TAU / 16;
    const [x, z] = pol(a, 58);
    k.push(x, 0, z, Math.PI / 2 - a);
    k.block('concreteDark', -2.2, 0, -1.6, 2.2, 1, 1.6, 0.12);
    k.block('steelDark', -0.5, 1, -0.5, 0.5, 13, 0.5, 0.08);
    k.beam(-4, 13, 0, 4, 13, 0, 0.18, 0.28, 'steelDark');
    for (const u of [-3.6, 0, 3.6]) {
      g.use('glass').cyl(u, 13.3, 0, u, 14.6, 0, 0.16, 0.08, 8, false, true);
      g.use('emissiveWhite').box(u, 12.65, 0, 0.3, 0.03, 0.14, FACE.ny);
    }
    k.pop();
    k.light(x, 10, z, 'white', 80, 30);
    const b = a + TAU / 8;
    const [nx, nz] = pol(b, 58);
    cable(k, x, 13.2, z, nx, 13.2, nz, 3.2, 0.05);
    const [mx, mz] = pol(a + 0.2, 53);
    machine(k, mx, 0, mz, Math.PI / 2 - a, 4.5, 2.2, 2.2);
  }
  // Low barriers around the lip, staggered so a fast player still has clean lines through them.
  for (let q = 0; q < 16; q++) {
    const a = (q / 16) * TAU + TAU / 32;
    const [x, z] = pol(a, 49);
    if (DIAG_ANGLES.some(d => near(a, d, 0.25)) || CARDINALS.some(c => near(a, c + KICKER_ANGLE, 0.15) || near(a, c, 0.15))) continue;
    barrier(k, x, 0, z, Math.PI / 2 - a, 5);
  }
  // Rim kickers: run at the lip at ground speed and they lob you across the bowl onto the Halo.
  for (let q = 0; q < 4; q++) {
    const a = q * Math.PI / 2 + KICKER_ANGLE;
    const [x, z] = pol(a, BOWL.radius + 1.5);
    kicker(k, spec, x, 0, z, -Math.cos(a), -Math.sin(a), { length: 7, width: 7, height: 1.4, boost: 0, lift: 18 });
  }
  spec.pickup(58, 1, 22);
  spec.pickup(-58, 1, -22);
  spec.view('core_overview', 96, 34, 96, 0, 6, 0);
}
