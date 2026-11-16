/** Everything outside the building: the ground, the plaza and street, the yard, the alley, the car park and the skybridge. */
import { FACE, type Mat } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import type { MapSpec } from '../spec';
import { Builder } from './build';
import { B, BRIDGE, CANOPY, LV, PARK, rect, type Rect, type Rgb, SITE, STREET_Z, T_OUT } from './plan';

const PLAZA: Rgb = [0.62, 0.64, 0.68];
const RAW = { mat: 'concrete' as Mat, tint: [0.62, 0.62, 0.64] as Rgb };

function ground(b: Builder): void {
  // One collider under the whole site, so no sprint crosses a seam.
  b.solid(SITE.x0 - 4, -2, SITE.z0 - 4, SITE.x1 + 4, 0, SITE.z1 + 4);
  const f = (mat: Mat, tint: Rgb, r: Rect, step = 3) => b.finish(mat, tint, r, 0, step);
  f('asphalt', [0.8, 0.8, 0.84], rect(SITE.x0, STREET_Z, SITE.x1, SITE.z1));
  f('tile', PLAZA, rect(SITE.x0, 20, SITE.x1, STREET_Z), 2);
  f('tile', PLAZA, rect(SITE.x0, B.z1, PARK.x0, 20), 2);
  f('concrete', [0.6, 0.6, 0.6], rect(SITE.x0, B.z0, B.x0, B.z1));
  f('asphalt', [0.66, 0.66, 0.7], rect(SITE.x0, SITE.z0, SITE.x1, B.z0));
  f('concrete', [0.56, 0.56, 0.58], rect(B.x1, B.z0, PARK.x0, B.z1));
  f('concrete', [0.5, 0.5, 0.52], rect(PARK.x0, PARK.z0, PARK.x1, PARK.z1));
  f('concrete', [0.56, 0.56, 0.58], rect(PARK.x1, B.z0, SITE.x1, PARK.z1));
  const g = b.g;
  // The kerb, and lane lines on the road.
  g.use('concrete').tint(0.8).box((SITE.x0 + SITE.x1) / 2, 0.06, STREET_Z, (SITE.x1 - SITE.x0) / 2, 0.06, 0.15, FACE.py | FACE.pz | FACE.nz);
  g.use('paintWhite').tint(0.9, 0.86, 0.5);
  for (let x = SITE.x0 + 2; x < SITE.x1 - 2; x += 6) g.box(x, 0.011, 53, 1.5, 0.001, 0.08, FACE.py);
  g.tint(1);
}

/** Facades round the site that close it in, with invisible walls up to the sky above them. */
function boundary(b: Builder): void {
  const k = b.k, g = b.g;
  const block = (x0: number, z0: number, x1: number, z1: number, h: number, tint: Rgb, face: 'n' | 's' | 'e' | 'w') => {
    k.noClimb(() => b.solid(x0, 0, z0, x1, h, z1));
    g.use('concrete').tint(tint[0], tint[1], tint[2]).slab((x0 + x1) / 2, h / 2, (z0 + z1) / 2, (x1 - x0) / 2, h / 2, (z1 - z0) / 2, 4, FACE.sides | FACE.py);
    g.tint(1);
    // Rows of windows, some lit.
    const along = face === 'n' || face === 's';
    const len = along ? x1 - x0 : z1 - z0;
    const fz = face === 's' ? z0 - 0.02 : face === 'n' ? z1 + 0.02 : 0;
    const fx = face === 'e' ? x0 - 0.02 : face === 'w' ? x1 + 0.02 : 0;
    for (let y = 4.2; y < h - 1; y += 3.4) {
      for (let u = 2; u < len - 1; u += 3) {
        const lit = k.rng();
        g.use(lit > 0.75 ? 'emissiveWhite' : lit > 0.68 ? 'emissiveOrange' : 'steelDark').tint(lit > 0.68 ? 1 : 0.5);
        if (along) g.box(x0 + u, y, fz, 1, 0.8, 0.01, face === 's' ? FACE.nz : FACE.pz);
        else g.box(fx, y, z0 + u, 0.01, 0.8, 1, face === 'e' ? FACE.nx : FACE.px);
      }
    }
    g.tint(1);
  };
  block(SITE.x0 - 4, SITE.z1, SITE.x1 + 4, SITE.z1 + 4, 16, [0.5, 0.48, 0.46], 's');
  block(SITE.x0 - 4, SITE.z0 - 4, SITE.x1 + 4, SITE.z0, 24, [0.46, 0.48, 0.5], 'n');
  block(SITE.x0 - 4, SITE.z0, SITE.x0, SITE.z1, 20, [0.5, 0.5, 0.5], 'w');
  block(SITE.x1, SITE.z0, SITE.x1 + 4, SITE.z1, 18, [0.48, 0.48, 0.52], 'e');
  // The Archive's name over the alley, and the shops' fronts on the street.
  g.use('emissiveCyan').box(0, 14, SITE.z0 + 0.04, 18, 0.1, 0.02, FACE.pz);
  for (let x = SITE.x0 + 8; x < SITE.x1 - 6; x += 14) {
    g.use('steelDark').tint(0.5).box(x, 2, SITE.z1 - 0.05, 5, 2, 0.05, FACE.nz);
    g.use(k.rng() > 0.5 ? 'emissiveMagenta' : 'emissiveOrange').tint(1).box(x, 4.5, SITE.z1 - 0.08, 4.5, 0.35, 0.03, FACE.nz);
    k.light(x, 3.5, SITE.z1 - 2.5, k.rng() > 0.5 ? 0xff5ad8 : 0xff9a4a, 18, 10);
  }
  g.tint(1);
  // Over the facades, up to the sky: rocket jumps stay on the map.
  const top = 40, t = 2;
  k.containment((SITE.x0 + SITE.x1) / 2, top / 2, SITE.z1 + t, (SITE.x1 - SITE.x0) / 2 + 6, top / 2, t);
  k.containment((SITE.x0 + SITE.x1) / 2, top / 2, SITE.z0 - t, (SITE.x1 - SITE.x0) / 2 + 6, top / 2, t);
  k.containment(SITE.x0 - t, top / 2, (SITE.z0 + SITE.z1) / 2, t, top / 2, (SITE.z1 - SITE.z0) / 2 + 6);
  k.containment(SITE.x1 + t, top / 2, (SITE.z0 + SITE.z1) / 2, t, top / 2, (SITE.z1 - SITE.z0) / 2 + 6);
}

/** Towers on the skyline, far beyond the walls: no colliders, a few hundred triangles, lit windows. */
function skyline(b: Builder): void {
  const g = b.g, k = b.k;
  // The city's ground out to the horizon, under the site's own finishes.
  g.use('asphalt').tint(0.32, 0.33, 0.36).gridStep(-320, -0.03, 320, 640, 0, 0, 0, 0, -640, 40);
  g.tint(1);
  const spots: [number, number, number, number, number][] = [
    [-150, -120, 30, 26, 120], [-60, -160, 34, 30, 160], [40, -150, 26, 26, 140], [140, -110, 30, 30, 110], [180, 10, 24, 30, 90],
    [150, 120, 30, 26, 130], [40, 170, 34, 30, 100], [-70, 150, 28, 28, 150], [-170, 60, 26, 30, 95], [-180, -40, 30, 24, 120],
  ];
  for (const [x, z, w, d, h] of spots) {
    g.use('steelDark').tint(0.24, 0.27, 0.34).box(x, h / 2, z, w / 2, h / 2, d / 2, FACE.sides | FACE.py);
    for (let y = 8; y < h - 4; y += 6) {
      if (k.rng() < 0.35) continue;
      g.use(k.rng() > 0.6 ? 'emissiveWhite' : 'emissiveCyan').tint(0.22);
      g.box(x, y, z, w / 2 + 0.05, 0.12, d / 2 + 0.05, FACE.sides);
    }
    if (k.rng() > 0.4) g.use('emissiveRed').tint(1).box(x, h + 1, z, 0.4, 1, 0.4, FACE.all);
  }
  g.tint(1);
}

/** A parked car: body, glasshouse, wheels. One box collider. */
export function car(b: Builder, x: number, y: number, z: number, yaw: number, tint: Rgb): void {
  const k = b.k, g = b.g;
  k.push(x, y, z, yaw);
  g.use('paintWhite').tint(tint[0], tint[1], tint[2]);
  g.bevel(0, 0.62, 0, 2.2, 0.32, 0.92, 0.16);
  g.bevel(-0.2, 1.12, 0, 1.25, 0.24, 0.8, 0.18);
  g.use('glass').tint(1).bevel(-0.2, 1.14, 0, 1.28, 0.2, 0.82, 0.16);
  g.use('rubber');
  for (const [wx, wz] of [[-1.4, 0.82], [1.4, 0.82], [-1.4, -0.82], [1.4, -0.82]] as const) g.cyl(wx, 0.36, wz - 0.12, wx, 0.36, wz + 0.12, 0.36, 0.36, 10);
  g.use('emissiveWhite').box(2.21, 0.7, 0.6, 0.01, 0.06, 0.18, FACE.px);
  g.box(2.21, 0.7, -0.6, 0.01, 0.06, 0.18, FACE.px);
  g.use('emissiveRed').box(-2.21, 0.74, 0, 0.01, 0.05, 0.75, FACE.nx);
  g.tint(1);
  k.collide(0, 0.72, 0, 2.2, 0.66, 0.92, 'metal');
  k.pop();
}

function plaza(b: Builder): void {
  const g = b.g, k = b.k;
  // The entrance canopy on two posts: a ledge for the plaza climb.
  const C = CANOPY;
  b.box('steelDark', [0.42, 0.46, 0.52], C.x0, C.top - 0.3, C.z0 + T_OUT / 2, C.x1, C.top, C.z1, 0.04, 'metal');
  g.use('emissiveCyan').box((C.x0 + C.x1) / 2, C.top - 0.31, C.z1 - 0.1, (C.x1 - C.x0) / 2 - 0.2, 0.01, 0.04, FACE.ny);
  for (const x of [C.x0 + 0.4, C.x1 - 0.4]) b.box('steel', [0.6, 0.62, 0.66], x - 0.15, 0, C.z1 - 0.55, x + 0.15, C.top - 0.3, C.z1 - 0.25, 0.03, 'metal');
  k.light(5, 3.0, 20.6, 0xcfe6ff, 30, 11);
  // Planters: low cover, and the first step of the plaza climb.
  const planter = (x0: number, z0: number, x1: number, z1: number) => {
    b.box('concrete', [0.56, 0.56, 0.58], x0, 0, z0, x1, 0.9, z1, 0.05);
    b.deco('dirt', [0.5, 0.42, 0.34], x0 + 0.12, 0.86, z0 + 0.12, x1 - 0.12, 0.9, z1 - 0.12, 0);
    for (let i = 0; i < Math.max(2, Math.round((x1 - x0) * (z1 - z0) / 2)); i++) {
      const sx = k.rand(x0 + 0.4, x1 - 0.4), sz = k.rand(z0 + 0.4, z1 - 0.4), r = k.rand(0.35, 0.6);
      g.use('paintWhite').tint(0.14, k.rand(0.3, 0.42), 0.16).bevel(sx, 0.9 + r * 0.8, sz, r, r * 0.8, r, r * 0.4);
    }
    g.tint(1);
    b.block(x0, z0, x1, z1);
  };
  planter(12.5, 23, 15.5, 25);
  planter(-6.5, 23, -3.5, 25);
  for (const x of [-46, -20, 30, 56]) planter(x - 3, 27, x + 3, 29);
  for (const x of [-34, 44]) planter(x - 1.5, 36, x + 1.5, 40);
  planter(-60, 22, -54, 24);
  // The fountain: a round basin, a slab of water, and the Bureau's monument in it.
  const F = { x: 5, z: 34, r: 5 };
  k.collidePrism(F.x, F.z, 0, 0.6, F.r, 18, 'concrete');
  g.use('concrete').tint(0.66).lathe([F.r, 0, F.r, 0.6, F.r - 0.4, 0.6, F.r - 0.4, 0.3], F.x, 0, F.z, 36, false);
  g.use('emissiveCyan').tint(0.1).lathe([F.r - 0.4, 0.3, 0, 0.3], F.x, 0, F.z, 36, false);
  g.use('concreteDark').tint(0.8).bevel(F.x, 2.2, F.z, 0.6, 2.2, 0.6, 0.1);
  g.use('emissiveMagenta').tint(1).box(F.x, 3.6, F.z + 0.61, 0.4, 0.05, 0.01, FACE.pz);
  g.tint(1);
  k.light(F.x, 1.4, F.z, 0x6fe0ff, 26, 10);
  b.block(F.x - F.r, F.z - F.r, F.x + F.r, F.z + F.r);
  // Benches (no collider: a seat must not stop a sprint) and bollards along the kerb.
  for (const [x, z, yaw] of [[-12, 30, 0], [22, 30, 0], [-28, 40, 0], [38, 40, 0], [5, 26, 0]] as const) {
    k.push(x, 0, z, yaw);
    g.use('steelDark').bevel(-0.8, 0.22, 0, 0.06, 0.22, 0.25, 0.02);
    g.bevel(0.8, 0.22, 0, 0.06, 0.22, 0.25, 0.02);
    g.use('plywood').tint(0.7, 0.55, 0.4).bevel(0, 0.46, 0, 1, 0.04, 0.26, 0.02);
    g.tint(1);
    k.pop();
  }
  g.use('steelDark').tint(0.5);
  for (let x = SITE.x0 + 3; x < SITE.x1 - 2; x += 4) g.cyl(x, 0, STREET_Z - 0.6, x, 0.9, STREET_Z - 0.6, 0.11, 0.11, 8);
  g.tint(1);
  // Lamp posts.
  for (const x of [-60, -40, -20, 18, 36, 56]) {
    k.push(x, 0, 44.6, 0);
    g.use('steelDark').cyl(0, 0, 0, 0, 7, 0, 0.13, 0.09, 8);
    g.bevel(0, 7, -0.6, 0.08, 0.06, 0.7, 0.02);
    g.use('emissiveWhite').box(0, 6.92, -1.1, 0.16, 0.03, 0.3, FACE.ny);
    k.collide(0, 3.5, 0, 0.15, 3.5, 0.15, 'metal', false);
    k.pop();
    k.light(x, 6.2, 43.4, 0xdfe6ff, 40, 16);
  }
  // A bus shelter and parked cars on the street.
  b.box('steelDark', [0.4, 0.42, 0.46], -40, 2.5, 47.2, -34, 2.6, 49);
  b.deco('glass', [1, 1, 1], -40, 0, 48.9, -34, 2.5, 49, 0.01);
  b.solid(-40, 0, 48.85, -34, 2.5, 49.05, 'glass');
  b.deco('signs', [1, 1, 1], -37.6, 0.4, 48.86, -36.4, 2.2, 48.88, 0);
  k.light(-37, 2.2, 48, 0xcfe6ff, 14, 6);
  const tints: Rgb[] = [[0.6, 0.12, 0.1], [0.2, 0.24, 0.3], [0.8, 0.8, 0.82], [0.12, 0.3, 0.5], [0.3, 0.3, 0.32], [0.7, 0.6, 0.2]];
  [[-58, 50.5, 0], [-46, 50.5, 0], [-12, 50.5, 0], [10, 50.5, 0.04], [28, 50.5, 0], [52, 50.5, 0], [-26, 56, Math.PI], [40, 56, Math.PI], [66, 56, Math.PI]]
    .forEach(([x, z, yaw], i) => { car(b, x!, 0, z!, yaw!, tints[i % tints.length]!); b.block(x! - 2.2, z! - 0.9, x! + 2.2, z! + 0.9); });
}

function yard(b: Builder, spec: MapSpec): void {
  const g = b.g, k = b.k;
  // The generator pen: a slab, a low wall, and the fuel tank beside it.
  b.box('concreteDark', [0.5, 0.5, 0.52], -46, 0, -14, -36, 0.25, -6, 0.04);
  for (const [x0, z0, x1, z1] of [[-46, -14, -36, -13.7], [-46, -14, -45.7, -9]] as const) b.box('concrete', [0.6, 0.6, 0.62], x0, 0.25, z0, x1, 1.2, z1, 0.03);
  spec.tank(-50, 0, -10);
  // Dumpsters and pallets.
  const dumpster = (x: number, z: number, yaw: number, tint: Rgb) => {
    k.push(x, 0, z, yaw);
    g.use('paintWhite').tint(tint[0], tint[1], tint[2]).bevel(0, 0.75, 0, 1, 0.75, 0.8, 0.06);
    g.use('steelDark').tint(0.4).bevel(0, 1.55, -0.1, 1.05, 0.05, 0.85, 0.02);
    g.tint(1);
    k.collide(0, 0.8, 0, 1.05, 0.8, 0.85, 'metal');
    k.pop();
  };
  dumpster(-34, 4, 0, [0.15, 0.4, 0.22]);
  dumpster(-34, 10.5, 0, [0.2, 0.3, 0.5]);
  b.block(-35, 3, -33, 12);
  for (const [x, z] of [[-56, 4], [-58, 6], [-55, 8]] as const) b.box('plywood', [0.7, 0.6, 0.45], x - 0.6, 0, z - 0.6, x + 0.6, 0.9, z + 0.6, 0.02);
  // Floods on the building's west face.
  for (const z of [-12, 0, 12]) {
    k.push(B.x0 - T_OUT / 2, 6.4, z, Math.PI / 2);
    g.use('steelDark').bevel(0, 0, 0.12, 0.3, 0.18, 0.12, 0.02);
    g.use('emissiveWhite').box(0, -0.02, 0.25, 0.24, 0.12, 0.01, FACE.pz);
    k.pop();
    k.light(B.x0 - 3, 5.4, z, 0xe8eeff, 46, 18);
  }
  k.light(-52, 4, 8, 0xffb070, 24, 14);
  k.light(-58, 4, -10, 0xffb070, 24, 14);
}

function alley(b: Builder): void {
  const g = b.g, k = b.k;
  // Condensers along the building's north face: low cover the length of the alley.
  for (const x of [-24, -18, -2, 30, 36]) {
    b.box('panel', [0.6, 0.62, 0.64], x - 1.2, 0, B.z0 - 2.4, x + 1.2, 1.3, B.z0 - 0.9, 0.05);
    g.use('steelDark').tint(0.3).cyl(x, 1.31, B.z0 - 1.65, x, 1.33, B.z0 - 1.65, 0.6, 0.6, 16);
    g.tint(1);
    b.block(x - 1.2, B.z0 - 2.4, x + 1.2, B.z0 - 0.9);
  }
  // A van across the far end, crates, and lamps on the Archive's wall.
  k.push(-48, 0, -30, 0.3);
  g.use('paintWhite').tint(0.82, 0.82, 0.84).bevel(0, 1.3, 0, 2.8, 1.1, 1.05, 0.15);
  g.use('glass').bevel(2.6, 1.7, 0, 0.3, 0.5, 0.95, 0.1);
  g.use('rubber');
  for (const [wx, wz] of [[-1.8, 0.95], [1.8, 0.95], [-1.8, -0.95], [1.8, -0.95]] as const) g.cyl(wx, 0.4, wz - 0.14, wx, 0.4, wz + 0.14, 0.4, 0.4, 10);
  g.tint(1);
  k.collide(0, 1.25, 0, 2.8, 1.15, 1.05, 'metal');
  k.pop();
  for (const [x, z] of [[8, -30], [9.6, -30.4], [8.6, -28.6], [52, -36], [53.4, -36.2]] as const) {
    b.box('panel', [0.36, 0.4, 0.3], x - 0.6, 0, z - 0.6, x + 0.6, 1.2, z + 0.6, 0.04);
  }
  for (let x = -60; x <= 66; x += 14) {
    k.push(x, 5, SITE.z0, 0);
    g.use('steelDark').bevel(0, 0, 0.1, 0.25, 0.2, 0.1, 0.02);
    g.use('emissiveOrange').box(0, -0.05, 0.21, 0.18, 0.1, 0.01, FACE.pz);
    k.pop();
    k.light(x, 4.2, SITE.z0 + 2.4, 0xffa060, 30, 14);
  }
}

/** The car park: ground, deck and roof, a ramp up each side, low walls round the decks, columns. */
function carPark(b: Builder): void {
  const P = PARK, g = b.g, k = b.k;
  const r1 = rect(P.ramp1.x - P.ramp1.w / 2, P.ramp1.z1, P.ramp1.x + P.ramp1.w / 2, P.ramp1.z0);
  const r2 = rect(P.ramp2.x - P.ramp2.w / 2, P.ramp2.z0, P.ramp2.x + P.ramp2.w / 2, P.ramp2.z1);
  const deck = rect(P.x0 - 0.2, P.z0 - 0.2, P.x1 + 0.2, P.z1 + 0.2);
  b.slab(deck, LV.f2 - 0.4, LV.f2, [r1], [0.5, 0.5, 0.52], { mat: 'concrete', tint: [0.5, 0.5, 0.52] });
  b.slab(deck, LV.roof - 0.4, LV.roof, [r2], [0.5, 0.5, 0.52], { mat: 'concrete', tint: [0.56, 0.56, 0.58] });
  k.ramp(P.ramp1.x, P.ramp1.z0, LV.g, P.ramp1.x, P.ramp1.z1, LV.f2, P.ramp1.w, 'concrete', 0.4);
  k.ramp(P.ramp2.x, P.ramp2.z0, LV.f2, P.ramp2.x, P.ramp2.z1, LV.roof, P.ramp2.w, 'concrete', 0.4);
  for (const r of [r1, r2]) {
    const y = r === r1 ? LV.f2 : LV.roof;
    b.rail([r.x0, y, r.z0, r.x0, y, r.z1]);
    b.rail([r.x1, y, r.z0, r.x1, y, r.z1]);
  }
  // Low walls round both decks; the skybridge comes in through the west one.
  for (const y of [LV.f2, LV.roof]) {
    const h = 1.1;
    const holes = y === LV.f2 ? [{ at: (BRIDGE.z0 + BRIDGE.z1) / 2, w: BRIDGE.z1 - BRIDGE.z0, y0: y, y1: y + h + 0.1, kind: 'door' as const }] : [];
    b.wall({ axis: 'z', at: P.x0, from: P.z0, to: P.z1, y0: y, y1: y + h, holes }, false, RAW);
    b.wall({ axis: 'z', at: P.x1, from: P.z0, to: P.z1, y0: y, y1: y + h, holes: [] }, false, RAW);
    b.wall({ axis: 'x', at: P.z0, from: P.x0, to: P.x1, y0: y, y1: y + h, holes: [] }, false, RAW);
    b.wall({ axis: 'x', at: P.z1, from: P.x0, to: P.x1, y0: y, y1: y + h, holes: [] }, false, RAW);
    g.use('hazard').tint(1);
    for (const [x, z, hx, hz] of [[(P.x0 + P.x1) / 2, P.z0, (P.x1 - P.x0) / 2, 0.16], [(P.x0 + P.x1) / 2, P.z1, (P.x1 - P.x0) / 2, 0.16], [P.x0, (P.z0 + P.z1) / 2, 0.16, (P.z1 - P.z0) / 2], [P.x1, (P.z0 + P.z1) / 2, 0.16, (P.z1 - P.z0) / 2]] as const) {
      g.box(x, y + h + 0.01, z, hx, 0.01, hz, FACE.py);
    }
  }
  // Columns through the two lower levels, and round the edge of the ground floor.
  const col = (x: number, z: number) => b.box('concrete', [0.62, 0.62, 0.64], x - 0.4, 0, z - 0.4, x + 0.4, LV.roof - 0.4, z + 0.4, 0.05);
  for (const x of [46, 59]) for (const z of [-12, 0, 12]) col(x, z);
  for (const x of [P.x0, P.x1]) for (const z of [-17.6, -6, 6, 19.6]) {
    b.box('concrete', [0.6, 0.6, 0.62], x - 0.3, 0, z - 0.3, x + 0.3, LV.f2 - 0.4, z + 0.3, 0.04);
    b.box('concrete', [0.6, 0.6, 0.62], x - 0.3, LV.f2 + 1.1, z - 0.3, x + 0.3, LV.roof - 0.4, z + 0.3, 0.04);
  }
  // Bays and lights on the two covered levels; lamp posts on the roof.
  for (const y of [LV.g, LV.f2]) {
    g.use('paintWhite').tint(0.85, 0.85, 0.8);
    for (let z = P.z0 + 2; z < P.z1 - 1; z += 2.6) g.box(44, y + 0.012, z, 3, 0.001, 0.05, FACE.py);
    g.tint(1);
    for (const x of [44, 52, 60]) for (const z of [-12, -2, 8, 16]) {
      if (y === LV.f2 && x === 60 && z > -10) continue;
      k.lampBar(x, y + 3.75, z, 0, 2.2, 'white', 0, 0);
    }
    for (const [x, z] of [[46, -8], [46, 8], [58, -6], [58, 10]] as const) k.light(x, y + 3, z, 0xd8f0d0, 30, 12);
  }
  for (const [x, z] of [[44, -14], [44, 16], [66, -14], [66, 16]] as const) {
    k.push(x, LV.roof, z, 0);
    g.use('steelDark').cyl(0, 0, 0, 0, 5, 0, 0.1, 0.08, 8);
    g.use('emissiveWhite').box(0, 5.05, 0, 0.3, 0.05, 0.3, FACE.ny | FACE.sides);
    k.collide(0, 2.5, 0, 0.12, 2.5, 0.12, 'metal', false);
    k.pop();
    k.light(x, LV.roof + 4.4, z, 0xe6eeff, 34, 14);
  }
  const tints: Rgb[] = [[0.2, 0.22, 0.28], [0.7, 0.7, 0.72], [0.5, 0.1, 0.1], [0.1, 0.2, 0.36]];
  const cars: [number, number, number, number][] = [
    [43.5, LV.g, -14, Math.PI / 2], [43.5, LV.g, 4, Math.PI / 2], [48.5, LV.g, 14, Math.PI / 2], [56.5, LV.g, -4, Math.PI / 2],
    [43.5, LV.f2, 2, Math.PI / 2], [43.5, LV.f2, 12, Math.PI / 2], [58, LV.f2, 4, Math.PI / 2], [60, LV.f2, -15, 0],
    [44, LV.roof, 0, Math.PI / 2], [62, LV.roof, 6, Math.PI / 2], [64, LV.roof, -12, 0.2],
  ];
  cars.forEach(([x, y, z, yaw], i) => car(b, x, y, z, yaw, tints[i % tints.length]!));
  g.use('emissiveCyan').box(P.x0 - 0.2, 2.2, -2, 0.02, 0.4, 3, FACE.nx);
}

/** The skybridge: a glass corridor at the first floor from the open office to the car park's deck. */
function skybridge(b: Builder): void {
  const S = BRIDGE, g = b.g, k = b.k;
  const x0 = S.x0 + T_OUT / 2, x1 = S.x1 - 0.15;
  b.slab(rect(x0, S.z0 - 0.15, x1, S.z1 + 0.15), LV.f2 - 0.4, LV.f2, [], [0.5, 0.52, 0.56], { mat: 'tile', tint: [0.7, 0.72, 0.76] });
  b.slab(rect(x0, S.z0 - 0.3, x1, S.z1 + 0.3), S.roof - 0.35, S.roof, [], [0.6, 0.62, 0.66], { mat: 'steelDark', tint: [0.4, 0.42, 0.46] });
  for (const z of [S.z0, S.z1]) {
    // A low wall: tall enough that the nav never drops off the side. Glass above it (the breakables').
    b.wall({ axis: 'x', at: z, from: x0, to: x1, y0: LV.f2, y1: LV.f2 + 1, holes: [] }, false, { mat: 'panel', tint: [0.36, 0.4, 0.46] });
    g.use('steel').tint(0.6, 0.64, 0.7);
    for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / 4) g.bevel(x, (LV.f2 + 1 + S.roof - 0.35) / 2, z, 0.05, (S.roof - 0.35 - LV.f2 - 1) / 2, 0.06, 0.01);
    g.tint(1);
  }
  g.use('emissiveCyan').box((x0 + x1) / 2, S.roof - 0.37, (S.z0 + S.z1) / 2, (x1 - x0) / 2 - 0.4, 0.01, 0.08, FACE.ny);
  k.light((x0 + x1) / 2, S.roof - 1.2, (S.z0 + S.z1) / 2, 0xcfeaff, 24, 9);
  b.plan.decks.push({ x0, z0: S.z0, x1, z1: S.z1 });
}

export function authorOutside(k: Kit, spec: MapSpec): void {
  const b = new Builder(k, spec);
  ground(b);
  boundary(b);
  skyline(b);
  plaza(b);
  yard(b, spec);
  alley(b);
  carPark(b);
  skybridge(b);
}
