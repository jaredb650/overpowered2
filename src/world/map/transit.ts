/** Transit: a sunken station with trains in it, a concourse each side and a rail yard to the south. */
import type { Kit } from '../kit/kit';
import { FACE } from '../kit/geo';
import { barrier, cable, fence, freightCar, machine, pipe, rubble, signPanel, towerBlock, trainCar, truck, vent, wallLamp } from '../kit/props';
import { signId } from '../kit/signs';
import type { MapSpec } from './spec';
import { LEVEL, RING, TRENCH } from './layout';
import { ringStile } from './ring';

const { x0: X0, x1: X1, z0: Z0, z1: Z1, y: FLOOR } = TRENCH;
const PLAT = FLOOR + 1.1;
const CW = LEVEL.catwalk;
const ROOF = CW + 0.4;
const TRACKS = [-109, -101];

export function authorTransit(k: Kit, spec: MapSpec): void {
  trench(k, spec);
  canopy(k, spec);
  hall(k, spec);
  westConcourse(k, spec);
  railYard(k, spec);
  spec.view('transit_platform', -94.5, PLAT + 1.7, -60, -106, PLAT + 2, 40);
  spec.view('transit_tracks', -105, FLOOR + 1.7, 60, -105, FLOOR + 2, -70);
  spec.view('transit_roof', -96, ROOF + 1.7, -64, -112, 4, 60);
  spec.view('transit_concourse', -130, 1.7, -66, -122, 3, 40);
  spec.view('transit_hall', -76, 1.7, -8, -92, 3, 6);
  spec.view('rail_yard', -92, 3, 80, -124, 2, 130);
}

function tracks(k: Kit, x: number, z0: number, z1: number, y: number, yaw = 0): void {
  const g = k.geo;
  k.push(x, y, (z0 + z1) / 2, yaw);
  const half = (z1 - z0) / 2;
  g.use('steelDark').tint(0.7);
  for (let z = -half; z < half; z += 1.5) g.box(0, 0.09, z, 1.35, 0.08, 0.14, FACE.py | FACE.pz | FACE.nz);
  g.tint(1).use('steel');
  for (const s of [-0.76, 0.76]) {
    g.box(s, 0.24, 0, 0.04, 0.07, half, FACE.py | FACE.px | FACE.nx);
    g.box(s, 0.18, 0, 0.07, 0.015, half, FACE.py);
  }
  k.pop();
}

function trench(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const o = { thick: 1, bay: 7.4, lift: 2.33, cap: false, mat: 'tile' as const, surface: 'concrete' as const, strip: { mat: 'emissiveCyan' as const, y: -2.6, h: 0.1 } };
  const portal = (c: number) => [{ u0: c - 6.6, u1: c + 6.6, v0: FLOOR, v1: -2, frame: true }];
  k.wall(X0, Z0, X1, Z0, FLOOR, 0, { ...o, openings: portal(13) });
  k.wall(X1, Z0, X1, Z1, FLOOR, 0, { ...o, openings: portal(74) });
  k.wall(X1, Z1, X0, Z1, FLOOR, 0, { ...o, openings: portal(13) });
  k.wall(X0, Z1, X0, Z0, FLOOR, 0, o);

  // Ballast bed, tracks, platforms with bright edges that run into the tunnel mouths.
  k.floor('dirt', X0, Z0, X1, Z1, FLOOR, 1, 2);
  for (const x of TRACKS) tracks(k, x, Z0 - 40, Z1 + 40, FLOOR);
  for (const [a, b, edge, side] of [[X0, X0 + 5, X0 + 4.9, 1], [X1 - 5, X1, X1 - 4.9, -1]] as const) {
    k.floor('tile', a, Z0 + 0.5, b, Z1 - 0.5, PLAT, 1.1, 2.5);
    g.use('paintWhite').tint(0.85, 0.85, 0.9).box(edge - side * 0.4, PLAT + 0.012, 0, 0.26, 0.01, 73, FACE.py);
    g.tint(1).use('emissiveCyan').box(edge, PLAT - 0.15, 0, 0.04, 0.05, 73, side > 0 ? FACE.px : FACE.nx);
    // Benches and timetable pillars along the platform.
    for (let z = -60; z <= 60; z += 15) {
      if (Math.abs(z) < 8) continue;
      const x = (a + b) / 2 - side * 0.4;
      k.block('steelDark', x - 0.25, PLAT, z - 1.4, x + 0.25, PLAT + 0.5, z + 1.4, 0.04);
    }
  }

  // Three crossings at ground level.
  const bridge = (z: number, w: number) => {
    k.mass('concrete', X0, -1.2, z - w / 2, X1, 0, z + w / 2, 3);
    k.rail([X0, 0, z - w / 2, X1, 0, z - w / 2]);
    k.rail([X0, 0, z + w / 2, X1, 0, z + w / 2]);
    g.use('emissiveCyan').box((X0 + X1) / 2, -1.25, z, 12.5, 0.03, 0.08, FACE.ny);
    k.lampBar(-105, -1.4, z, Math.PI / 2, w * 0.6, 'white', 30, 18);
  };
  bridge(-42, 8);
  bridge(0, 13);
  bridge(42, 8);

  // Stairs from the platforms to the concourses, along the trench walls.
  for (const z of [-54, 14]) {
    k.stairs(X1 - 1.8, z, PLAT, X1 - 1.8, z + 20, 0, 3);
    k.floor('tile', X1 - 3.6, z + 20, X1, z + 23, 0, 0.4);
    k.stairs(X0 + 1.8, -z, PLAT, X0 + 1.8, -z - 20, 0, 3);
    k.floor('tile', X0, -z - 23, X0 + 3.6, -z - 20, 0, 0.4);
  }

  // Trains. A long set parked on track one, a shorter one on track two, the last car off the rails.
  trainCar(k, TRACKS[0]!, FLOOR + 0.22, -50, Math.PI / 2, { lit: true });
  trainCar(k, TRACKS[0]!, FLOOR + 0.22, -27.4, Math.PI / 2, { lit: true });
  trainCar(k, TRACKS[0]!, FLOOR + 0.22, -4.8, Math.PI / 2, { lit: false });
  trainCar(k, TRACKS[1]!, FLOOR + 0.22, 16, Math.PI / 2, { lit: true });
  trainCar(k, TRACKS[1]!, FLOOR + 0.22, 38.6, Math.PI / 2, { lit: false });
  trainCar(k, TRACKS[1]! - 2.4, FLOOR + 0.5, 62, Math.PI / 2 + 0.16, { tilt: 0.34 });
  rubble(k, -103, FLOOR, 58, 4, 18, 'concrete');
  rubble(k, -112, FLOOR, 26, 3, 12, 'rust');
  barrier(k, -111, FLOOR, 44, Math.PI / 2, 4);
  barrier(k, -99, FLOOR, -36, Math.PI / 2, 4);

  signPanel(k, X0 + 0.6, -3.9, -20, Math.PI / 2, 8, 2, signId('PLATFORM 1'));
  signPanel(k, X0 + 0.6, -3.9, 26, Math.PI / 2, 8, 2, signId('LINE 7 CENTRAL'));
  signPanel(k, X1 - 0.6, -3.9, -24, -Math.PI / 2, 8, 2, signId('PLATFORM 2'));
  signPanel(k, X1 - 0.6, -3.9, 30, -Math.PI / 2, 8, 2, signId('TRANSIT'));
  for (let z = -56; z <= 56; z += 28) {
    k.light(-96, PLAT + 2.4, z, 'white', 26, 18);
    k.light(-114, PLAT + 2.4, z + 14, 'white', 26, 18);
    k.light(-105, 5.6, z + 7, 'white', 44, 18);
  }
  spec.gate('transit', -105, FLOOR + 0.1, -70);
  spec.gate('transit', -105, FLOOR + 0.1, 70);
  spec.pad(-95, PLAT, 52, -85, 0, 52, 6);
  spec.pad(-114.8, PLAT, -9.5, -125, 0, -10, 6);
  spec.pickup(-95, PLAT + 1, 8);
  spec.pickup(-115, PLAT + 1, -12);
}

function canopy(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  // One long roof over the trench on a spine of T-columns; its top is the zone's upper route.
  for (let z = -66; z <= 66; z += 16.5) {
    const y0 = FLOOR;
    k.column(-105, z, y0, CW - 0.6, 1.5, 'concrete');
    k.beam(-105, CW - 2.6, z, -117.5, CW - 0.5, z, 0.4, 0.4, 'concreteDark');
    k.beam(-105, CW - 2.6, z, -92.5, CW - 0.5, z, 0.4, 0.4, 'concreteDark');
    g.use('emissiveWhite').box(-111, CW - 0.25, z + 8.25, 5, 0.04, 0.1, FACE.ny);
    g.box(-99, CW - 0.25, z + 8.25, 5, 0.04, 0.1, FACE.ny);
  }
  k.floor('panel', X0, -66, X1, 66, ROOF, 0.5, 4, 'metal');
  // Skylight rib and walkway paint down the middle of the roof.
  for (let z = -60; z < 60; z += 12) {
    k.deco('steelDark', -106.5, ROOF, z, -103.5, ROOF + 0.22, z + 7, 0.05);
    g.use('glass').box(-105, ROOF + 0.24, z + 3.5, 1.3, 0.02, 3.3, FACE.py);
  }
  g.use('emissiveCyan').box(X0 + 0.15, ROOF - 0.15, 0, 0.05, 0.05, 66, FACE.nx | FACE.px);
  g.box(X1 - 0.15, ROOF - 0.15, 0, 0.05, 0.05, 66, FACE.nx | FACE.px);
  for (const [a, b] of [[X0, X1]] as const) {
    k.rail([a, ROOF, -66, b, ROOF, -66]);
    k.rail([a, ROOF, 66, b, ROOF, 66]);
  }
  // Rooftop plant: cover for the upper route, spaced so a run down the spine stays clear.
  for (const [x, z, w, d] of [[-112.5, -52, 5, 3], [-97.5, -30, 4, 6], [-113, -8, 3.4, 5], [-97, 18, 5, 3], [-112, 40, 4, 6], [-98, 56, 3.4, 3.4]] as const) {
    machine(k, x, ROOF, z, 0, w, 2, d);
    vent(k, x + w / 2 + 0.1, ROOF + 1, z, Math.PI / 2, 1.4, 0.9);
  }
  for (const z of [-44, -2, 34]) {
    pipe(k, [-116, ROOF + 0.6, z, -94, ROOF + 0.6, z], 0.22, 'steel', 7, 8);
    for (const x of [-112, -98]) k.deco('steelDark', x - 0.2, ROOF, z - 0.25, x + 0.2, ROOF + 0.6, z + 0.25, 0.04);
  }
  for (const [x, z] of [[-116, -62], [-94, 62]] as const) {
    g.use('steelDark').cyl(x, ROOF, z, x, ROOF + 7, z, 0.08, 0.04, 6, false, false);
    g.use('emissiveRed').cyl(x, ROOF + 7, z, x, ROOF + 7.3, z, 0.1, 0.1, 6);
  }
  // Roof to viaduct links, keeping the catwalk ring whole.
  k.catwalk(-101, -66, -97.8, -85, CW, 3.2, 'both');
  k.catwalk(-101, 66, -97.8, 85, CW, 3.2, 'both');
  spec.pad(-124, 0, 10, -112, ROOF, 10, 3);
  spec.pad(-86, 0, -48, -98, ROOF, -48, 3);
  spec.pad(-112, ROOF, -30, -146, LEVEL.ring, -30, 6);
  spec.pickup(-105, ROOF + 1, 0);
}

function hall(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  // Booking hall between the Core and the tracks: long walls outside, columns and gates inside.
  const o = { thick: 1, bay: 7.5, lift: 2.7, strip: { mat: 'emissiveCyan' as const, y: 3.2, h: 0.1 } };
  const x0 = -91, x1 = -75, z0 = -34, z1 = 34;
  const door = (c: number, w: number, h = 5.4) => ({ u0: c - w / 2, u1: c + w / 2, v0: 0, v1: h, frame: true });
  k.wall(x1, z0, x1, z1, 0, CW, { ...o, openings: [door(34, 15, 6)] });
  k.wall(x0, z1, x0, z0, 0, CW, { ...o, openings: [door(10, 8), door(34, 13), door(58, 8)] });
  k.wall(x0, z0, x1, z0, 0, CW, { ...o, openings: [door(8, 6)] });
  k.wall(x1, z1, x0, z1, 0, CW, { ...o, openings: [door(8, 6)] });
  k.floor('panel', x0 - 0.5, z0 - 0.5, x1 + 0.5, z1 + 0.5, CW + 0.4, 0.6, 3, 'concrete');
  g.use('panel').tint(0.6).gridStep(x0, CW - 0.2, z0, x1 - x0, 0, 0, 0, 0, z1 - z0, 4);
  g.tint(1);
  for (let z = z0 + 8; z < z1; z += 9) {
    if (Math.abs(z) < 7) continue;
    k.column(-83, z, 0, CW - 0.2, 1.2, 'tile');
    k.lampBar(-79, CW - 0.4, z, Math.PI / 2, 3, 'white', Math.abs(z - 8) % 18 < 1 ? 40 : 0, 16);
    k.lampBar(-87, CW - 0.4, z, Math.PI / 2, 3, 'white', 0, 14);
    g.use('steelDark');
  }
  for (const z of [-26, -13, 13, 26]) {
    k.light(-79, 6.2, z, 'white', 34, 15);
    k.light(-87, 6.2, z, 'white', 30, 15);
  }
  k.light(-83, 5.6, 0, 'cyan', 40, 16);
  // Ticket gates: a thin line of cover, gapped so a slide threads it.
  for (let z = -28; z <= 28; z += 3) {
    if (Math.abs(z) < 7) continue;
    k.block('steel', -86.2, 0, z - 0.1, -85.8, 1.05, z + 1.3, 0.04);
    g.use('emissiveCyan').box(-86, 1.06, z + 0.6, 0.12, 0.012, 0.2, FACE.py);
  }
  // Link across the W spoke opening to the rim bridge, at roof height.
  k.floor('panel', x1 + 0.5, -10, -72.5, 10, CW + 0.4, 0.5, 3, 'concrete');
  k.floor('panel', X1, -7, x0 - 0.5, 7, CW + 0.4, 0.5, 3, 'concrete');
  signPanel(k, x1 + 0.7, 6.8, 18, Math.PI / 2, 7, 1.75, signId('TRANSIT'));
  signPanel(k, x1 + 0.7, 6.8, -18, Math.PI / 2, 7, 1.75, signId('SECTOR 05'));
  k.stairs(-84, 36.5, 0, -74, 36.5, CW + 0.4, 3, 'concrete');
  k.floor('concrete', -76, 34, -72, 39, CW + 0.4, 0.5);
  k.stairs(-74, -36.5, CW + 0.4, -84, -36.5, 0, 3, 'concrete');
  k.floor('concrete', -76, -39, -72, -34, CW + 0.4, 0.5);
  machine(k, -80, 0, 24, 0, 3, 2, 2);
  barrier(k, -80, 0, -22, Math.PI / 2, 4, 'tile');
  spec.pickup(-83, 1, 0);
  spec.gate('transit', -83, 0.1, -28);
}

function westConcourse(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const edge = -(RING.half - RING.width / 2);
  // Signal towers mark the ends of the concourse and carry the stairs up to the road.
  for (const z of [-54, 54]) {
    k.push(-128, 0, z, 0);
    towerBlock(k, 5, 4, LEVEL.ring - 0.3);
    g.use('steelDark').bevel(0, LEVEL.ring + 3, 0, 4.4, 0.2, 3.4, 0.08);
    for (const [x, y] of [[-4, 0], [4, 0]] as const) k.column(x, y + (z > 0 ? 2.8 : -2.8), LEVEL.ring, LEVEL.ring + 3, 0.3, 'steelDark');
    g.use('glass').tint(0.8).box(0, LEVEL.ring + 1.5, 0, 3.8, 1.2, 2.9, FACE.sides);
    g.tint(1);
    k.pop();
    k.floor('concrete', -133.2, z - 4, edge + 0.4, z + 4, LEVEL.ring, 0.5, 2.5);
    ringStile(k, edge, z, -1, 0, 7);
    // Stair wraps the tower.
    k.stairs(-122, z + (z > 0 ? -7.5 : 7.5), 0, -122, z + (z > 0 ? 4.6 : -4.6), 6.4, 3, 'concrete');
    k.floor('concrete', -124, z + (z > 0 ? 4 : -7.6), -120, z + (z > 0 ? 7.6 : -4), 6.4, 0.4);
    k.stairs(-125.5, z + (z > 0 ? 5.8 : -5.8), 6.4, -133 + 0.5, z + (z > 0 ? 5.8 : -5.8), LEVEL.ring, 3, 'concrete');
    k.floor('concrete', -133.2, z + (z > 0 ? 4 : -7.6), -131, z + (z > 0 ? 7.6 : -4), LEVEL.ring, 0.4);
    k.light(-122, 3, z, 'cyan', 40, 18);
  }
  // Kiosks and planters, staggered to keep lanes open.
  for (const [x, z, w] of [[-126, -30, 5], [-132, 0, 4.5], [-124, 26, 5]] as const) {
    k.block('tile', x - w / 2, 0, z - 2, x + w / 2, 3, z + 2, 0.1);
    k.deco('steelDark', x - w / 2 - 0.3, 3, z - 2.3, x + w / 2 + 0.3, 3.25, z + 2.3, 0.06);
    g.use('emissiveMagenta').box(x, 2.6, z + 2.02, w / 2 - 0.3, 0.06, 0.02, FACE.pz);
    g.box(x, 2.6, z - 2.02, w / 2 - 0.3, 0.06, 0.02, FACE.nz);
    k.light(x, 3.6, z + 3, 'magenta', 18, 12);
  }
  for (const z of [-14, 14, 40, -44]) barrier(k, -129, 0, z, Math.PI / 2 + 0.2, 4, 'tile');
  for (let z = -60; z <= 60; z += 30) {
    wallLamp(k, -119, -1, z, Math.PI / 2, 'white', 0);
    vent(k, -119, 1, z + 8, Math.PI / 2, 1.2, 0.7);
  }
  k.mast(-136, -18, 0, 13, Math.PI / 2, 'white', 90, 34);
  k.mast(-136, 22, 0, 13, Math.PI / 2, 'white', 90, 34);
  cable(k, -136, 13, -18, -136, 13, 22, 3, 0.05);
  spec.pad(-134, 0, -72, -146, LEVEL.ring, -72, 2.5);
  spec.pickup(-128, 1, 8);
  spec.pickup(-130, LEVEL.ring + 1, 54);
}

function railYard(k: Kit, spec: MapSpec): void {
  // South-west corner: lines of freight wagons on open track. Walls you can see over and run along.
  for (const z of [84, 96, 108, 120, 130]) tracks(k, -100, z - 44, z + 44, 0, Math.PI / 2);
  const lines: [number, number, number][] = [
    [-120, 88, 2], [-96, 88, 1], [-132, 100, 1], [-108, 100, 2], [-122, 112, 2], [-96, 112, 1], [-110, 124, 2],
  ];
  for (const [x, z, n] of lines) {
    for (let i = 0; i < n; i++) freightCar(k, x + i * 18, 0, z, 0);
  }
  truck(k, -78, 0, 126, 1.1);
  fence(k, [-138, 80, -92, 80]);
  fence(k, [-70, 80, -70, 134]);
  barrier(k, -88, 0, 134, 0.3, 4);
  k.mast(-74, 104, 0, 15, 0.8, 'white', 90, 34);
  k.mast(-130, 126, 0, 15, -2.4, 'white', 90, 34);
  signPanel(k, -78, 2.4, 78.6, Math.PI, 5, 1.25, signId('RAIL YARD'), false);
  spec.ringPad(-80, 80, Math.PI * 0.8);
  spec.barrels(-104, 0, 94, 4);
  spec.tank(-124, 0, 94);
  spec.pickup(-100, 1, 118);
  spec.gate('transit', -128, 0.1, 62);
}
