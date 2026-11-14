/**
 * Everything outside the wall: the LZ Cut, the three lanes, the cover lines, the Perimeter Road and the buildings the fight turns on.
 * Bare ground from the cut to the gate, with towers looking down it, is what makes the first walk north feel as bad as it should.
 */
import { FACE } from '../../kit/geo';
import { barrier, container, rubble, signPanel, truck, tyres } from '../../kit/props';
import { signId } from '../../kit/signs';
import {
  carveAll, CITADEL, COVER_A, COVER_B, COVER_C, EDGE, LZ, LZ_RAMP, rect, type Rgb, SITE, SKY, WALL, WRECK,
} from './plan';
import type { Site } from './site';

const WEST_LANE: Rgb = [0.92, 0.32, 0.2], EAST_LANE: Rgb = [0.2, 0.62, 0.95];
const ROAD_HALF = 4.5, ROAD_Z = 34, SPUR_HALF = 7;
/** Toe and crest of a berm, measured in from the edge of the site's square. */
const TOE = SITE - 6, CREST = SITE + 2, BERM_H = 3.6;
const LINE: Rgb = [0.74, 0.7, 0.42];

function ground(s: Site): void {
  const pieces = carveAll(rect(-EDGE, -EDGE, EDGE, EDGE), [CITADEL, LZ, LZ_RAMP]);
  for (const p of pieces) {
    s.solid(p.x0, -4, p.z0, p.x1, 0, p.z1, 'dirt');
    s.paintFloor('dirt', p, 0, [0.62, 0.62, 0.66], 3);
  }
  // Past the berms nobody walks: a big dim plane, so the fly-in does not float in the sky.
  const g = s.k.geo.use('dirt').tint(0.42, 0.44, 0.48);
  for (const [x, z, w, d] of [[-300, -300, 600, 182], [-300, EDGE, 600, 182], [-300, -EDGE, 182, EDGE * 2], [EDGE, -EDGE, 182, EDGE * 2]] as const) {
    g.gridStep(x, -0.02, z + d, w, 0, 0, 0, 0, -d, 20);
  }
  g.tint(1);
}

/** A berm from toe to crest with a flat top behind it. `n` points out of the site along X or Z, and the span is the other axis. */
function berm(s: Site, axis: 'x' | 'z', n: number, a: number, b: number, toe = TOE, crest = CREST): void {
  const k = s.k, mid = (a + b) / 2, w = b - a;
  if (axis === 'x') {
    k.ramp(n * toe, mid, 0, n * crest, mid, BERM_H, w, 'dirt', 1.5, false);
    s.mass('dirt', Math.min(n * crest, n * EDGE), 0, a, Math.max(n * crest, n * EDGE), BERM_H, b, 0.8, 4, FACE.py);
  } else {
    k.ramp(mid, n * toe, 0, mid, n * crest, BERM_H, w, 'dirt', 1.5, false);
    s.mass('dirt', a, 0, Math.min(n * crest, n * EDGE), b, BERM_H, Math.max(n * crest, n * EDGE), 0.8, 4, FACE.py);
  }
}

/** The earth round the site. The two gaps in it are where the road comes in, so a vehicle arrives instead of appearing. */
function berms(s: Site): void {
  const gap = ROAD_Z - ROAD_HALF - 1.5, far = ROAD_Z + ROAD_HALF + 1.5, r = (TOE + CREST) / 2;
  for (const n of [-1, 1]) {
    berm(s, 'x', n, 8, gap);
    berm(s, 'x', n, far, EDGE);
    // The site stops at the wall's line, so nobody walks round the compound.
    berm(s, 'z', -1, n > 0 ? WALL.x + 2 : -EDGE, n > 0 ? EDGE : -WALL.x - 2, -18, -8);
    s.barrier(n * r - 0.2, -1, 12, n * r + 0.2, SKY, EDGE);
    const inner = n > 0 ? WALL.x : -r, outer = n > 0 ? r : -WALL.x;
    s.barrier(inner, -1, 12.8, outer, SKY, 13.2);
  }
  berm(s, 'z', 1, -EDGE, EDGE);
  s.barrier(-r, -1, r - 0.2, r, SKY, r + 0.2);
}

function roads(s: Site): void {
  const g = s.k.geo;
  const run = rect(-EDGE, ROAD_Z - ROAD_HALF, EDGE, ROAD_Z + ROAD_HALF);
  s.paintFloor('asphalt', run, 0.008, [0.86, 0.88, 0.92], 3);
  s.paintFloor('asphalt', rect(-SPUR_HALF, WALL.south + WALL.half, SPUR_HALF, ROAD_Z - ROAD_HALF), 0.008, [0.82, 0.84, 0.88], 3);
  s.line(-EDGE, ROAD_Z - ROAD_HALF + 0.2, -SPUR_HALF, ROAD_Z - ROAD_HALF + 0.4, LINE, 0.014);
  s.line(SPUR_HALF, ROAD_Z - ROAD_HALF + 0.2, EDGE, ROAD_Z - ROAD_HALF + 0.4, LINE, 0.014);
  s.line(-EDGE, ROAD_Z + ROAD_HALF - 0.4, EDGE, ROAD_Z + ROAD_HALF - 0.2, LINE, 0.014);
  for (const sx of [-1, 1]) s.line(sx * SPUR_HALF - 0.1, WALL.south + WALL.half, sx * SPUR_HALF + 0.1, ROAD_Z - ROAD_HALF, LINE, 0.014);
  for (let x = -EDGE + 2; x < EDGE; x += 7) s.line(x, ROAD_Z - 0.07, x + 3.4, ROAD_Z + 0.07, [0.66, 0.66, 0.6], 0.014);
  // Where trucks and tanks stop: the crews get out here, so it is worth knowing where it is.
  for (const x of [-48, -26, 26, 48]) {
    g.use('paintYellow').tint(0.6);
    g.box(x, 0.014, ROAD_Z, 0.12, 0.001, ROAD_HALF - 0.6, FACE.py);
    g.tint(1);
  }
  for (const n of [-1, 1]) s.paintFloor('asphalt', rect(n * 94 - 4, -102, n * 94 + 4, ROAD_Z - ROAD_HALF), 0.008, [0.72, 0.74, 0.78], 5);
  s.floorWords('CHEVRON', 0, 0, 20, 0, 5, [0.82, 0.2, 0.14]);
  // The two lanes the towers own say so on the ground, before anybody gets shot in them.
  for (const [x, rgb] of [[-40, WEST_LANE], [40, EAST_LANE]] as const) s.floorWords('LIVE FIRE', x, 0, 26, 0, 2, rgb);
}

/** A row of wire baskets, unit by unit, under one box. */
function hesco(s: Site, x0: number, x1: number, z: number, h: number): void {
  const k = s.k, g = k.geo, half = 0.72, n = Math.round((x1 - x0) / 1.45);
  for (let i = 0; i < n; i++) {
    const a = x0 + ((x1 - x0) * i) / n, b = x0 + ((x1 - x0) * (i + 1)) / n, m = (a + b) / 2;
    const t = k.rand(0.72, 0.98);
    g.use('paintWhite').tint(0.5 * t, 0.46 * t, 0.36 * t).bevel(m, h / 2, z, (b - a) / 2 - 0.02, h / 2 - 0.01, half - 0.02, 0.05);
    g.use('dirt').tint(t, t * 0.94, t * 0.86).box(m, h, z, (b - a) / 2 - 0.1, 0.012, half - 0.1, FACE.py);
    g.tint(1).use('steelDark');
    for (const sz of [1, -1]) g.box(a, h / 2, z + sz * half, 0.03, h / 2, 0.03, FACE.sides);
    g.box(m, h * 0.34, z + half, (b - a) / 2, 0.016, 0.012, FACE.pz | FACE.py);
    g.box(m, h * 0.68, z + half, (b - a) / 2, 0.016, 0.012, FACE.pz | FACE.py);
    g.box(m, h * 0.34, z - half, (b - a) / 2, 0.016, 0.012, FACE.nz | FACE.py);
    g.box(m, h * 0.68, z - half, (b - a) / 2, 0.016, 0.012, FACE.nz | FACE.py);
  }
  s.cover(x0, z - half, x1, z + half, h);
}

const TALL = 2.2, LOW = 1.3;

function coverLines(s: Site): void {
  for (const [a, b, h] of [
    [-60, -53, TALL], [-49, -41, LOW], [-38, -34, TALL], [-6, 1, LOW], [5, 12, TALL], [16, 20, LOW], [40, 47, TALL], [51, 59, LOW], [62, 66, TALL],
  ] as const) hesco(s, a, b, COVER_A, h);
  for (const [a, b, h] of [[-40, -33, LOW], [-29, -21, TALL], [-17, -12, LOW], [14, 21, TALL], [25, 33, LOW], [37, 44, TALL]] as const) hesco(s, a, b, COVER_B, h);
  // Jersey barriers along the road. The gap in the middle is the Gate Lane.
  for (const [a, b] of [[-66, -20], [20, 50]] as const) {
    for (let x = a + 2; x < b; x += 5.6) barrier(s.k, x, 0, COVER_C, 0, 4);
  }
}

/** The landing zone. Walls of exactly a mantle on all sides, and the one ramp plugged by what is left of the last truck to try it. */
function lzCut(s: Site): void {
  const k = s.k, g = k.geo;
  const y = LZ.floor;
  s.solid(LZ.x0 - 0.5, y - 1, LZ.z0 - 0.5, LZ.x1 + 0.5, y, LZ.z1 + 0.5, 'concrete');
  s.paintFloor('concreteDark', LZ, y, [0.74, 0.76, 0.8]);
  s.frameFloor(LZ, y, 1, 0.22, [0.82, 0.74, 0.22]);
  // The pad. Paint, because anything raised would be a step toward the wall.
  const cx = (LZ.x0 + LZ.x1) / 2, cz = (LZ.z0 + LZ.z1) / 2;
  s.line(cx - 5.4, cz - 5, cx - 3.6, cz + 5, [0.36, 0.38, 0.42], y + 0.014);
  s.line(cx + 3.6, cz - 5, cx + 5.4, cz + 5, [0.36, 0.38, 0.42], y + 0.014);
  s.line(cx - 3.6, cz - 0.8, cx + 3.6, cz + 0.8, [0.36, 0.38, 0.42], y + 0.014);
  // Revetment: flush with the collider, because this face is what a player climbs.
  const face = (x0: number, z0: number, x1: number, z1: number, n: number) => {
    g.use('concrete').tint(0.74, 0.76, 0.8);
    const axisX = z0 === z1;
    for (let u = axisX ? x0 : z0; u < (axisX ? x1 : z1) - 0.01; u += 2.4) {
      const e = Math.min(u + 2.4, axisX ? x1 : z1), t = k.rand(0.7, 0.92);
      g.tint(t, t * 1.02, t * 1.05);
      if (axisX) g.box((u + e) / 2 , y / 2, z0, (e - u) / 2 - 0.012, -y / 2, 0.001, n > 0 ? FACE.pz : FACE.nz);
      else g.box(x0, y / 2, (u + e) / 2, 0.001, -y / 2, (e - u) / 2 - 0.012, n > 0 ? FACE.px : FACE.nx);
    }
    g.tint(1).use('hazard');
    if (axisX) g.box((x0 + x1) / 2, 0.012, z0 - n * 0.2, (x1 - x0) / 2, 0.001, 0.2, FACE.py);
    else g.box(x0 - n * 0.2, 0.012, (z0 + z1) / 2, 0.2, 0.001, (z1 - z0) / 2, FACE.py);
  };
  face(LZ.x0, LZ.z0, LZ.x1, LZ.z0, 1);
  face(LZ.x0, LZ.z1, LZ.x1, LZ.z1, -1);
  face(LZ.x0, LZ.z0, LZ.x0, LZ.z1, 1);
  face(LZ.x1, LZ.z0, LZ.x1, LZ_RAMP.z0, -1);
  face(LZ.x1, LZ_RAMP.z1, LZ.x1, LZ.z1, -1);

  // The way out is up, and north is where the objective is. Paint on the face it means.
  s.words('ARROW', -32, -1.5, LZ.z0 + 0.012, 2, 1, [0.86, 0.72, 0.16]);
  s.words('EYES UP', -26, -1.4, LZ.z0 + 0.012, 0.6, 1, [0.86, 0.72, 0.16]);

  // Low cover on the pad, well off the walls, so it never gives a leg up.
  s.crate(-42, 79, -39.6, 81, 1.15, [0.6, 0.56, 0.42], y);
  s.crate(-26, 90, -23.6, 92, 1.15, [0.42, 0.5, 0.56], y);
  s.crate(-40, 92, -37, 93.6, 1.15, [0.5, 0.5, 0.54], y);
  s.crate(-24, 78.6, -21.6, 80.6, 1.15, [0.56, 0.5, 0.44], y);

  // The ramp out, up to ground level, with the truck across it. Its cab and bed fill the slot from wall to wall.
  s.stairs(LZ_RAMP.x0, (LZ_RAMP.z0 + LZ_RAMP.z1) / 2, y, LZ_RAMP.x1, (LZ_RAMP.z0 + LZ_RAMP.z1) / 2, 0, LZ_RAMP.z1 - LZ_RAMP.z0);
  face(LZ_RAMP.x0, LZ_RAMP.z0, LZ_RAMP.x1, LZ_RAMP.z0, 1);
  face(LZ_RAMP.x0, LZ_RAMP.z1, LZ_RAMP.x1, LZ_RAMP.z1, -1);
  truck(k, -10.5, -1.8, 86, Math.PI / 2 + 0.16, 0.08);
  s.mass('rust', -14.6, y, LZ_RAMP.z0, -13.6, 0, LZ_RAMP.z1, 0.5, 1.5, FACE.nx | FACE.py);
  s.spec.jump(-32, y, 76, -32, 0, 71);
  s.spec.jump(-46, y, 90, -52, 0, 90);
  s.spec.jump(-18, y, 96, -12, 0, 96);

  for (const [x, z, c] of [[LZ.x0 + 1.5, LZ.z0 + 1.5, 'cyan'], [LZ.x1 - 1.5, LZ.z0 + 1.5, 'cyan'], [LZ.x0 + 1.5, LZ.z1 - 1.5, 'red'], [LZ.x1 - 1.5, LZ.z1 - 1.5, 'red']] as const) {
    s.fill(x, y + 2.2, z, 26, 13, c);
  }
  for (const x of [LZ.x0, LZ.x1]) for (const z of [LZ.z0 + 6, LZ.z1 - 6]) {
    g.use(x < -40 ? 'emissiveCyan' : 'emissiveRed').box(x + (x < -40 ? 0.02 : -0.02), y + 0.1, z, 0.02, 0.08, 1.4, FACE.all);
  }
  s.fill(cx, y + 4.4, cz, 80, 24, 'white');
}

/** A guard hut with three doors, so it is a loop as well as cover, and the first thing worth running for. */
function guardhouse(s: Site): void {
  const g = s.k.geo;
  const x0 = 18, x1 = 30, z0 = 20, z1 = 28, top = 3.4, slab = 0.3, t = 0.4, door = { w: 3, y1: 2.5 };
  s.wall({ x0, z0, x1, z1: z0 + t, y1: top - slab, outside: 'poured' });
  s.wall({ x0, z0: z1 - t, x1, z1, y1: top - slab, outside: 'poured', openings: [{ at: 26, ...door }] });
  s.wall({ x0, z0: z0 + t, x1: x0 + t, z1: z1 - t, y1: top - slab, outside: 'poured', openings: [{ at: 24, ...door }] });
  s.wall({ x0: x1 - t, z0: z0 + t, x1, z1: z1 - t, y1: top - slab, outside: 'poured', openings: [{ at: 24, ...door }] });
  // Flush with the walls: an overhang would stop the mantle this roof is for.
  s.mass('concreteDark', x0, top - slab, z0, x1, top, z1, 0.8, 3);
  s.paintFloor('concreteDark', rect(x0 + t, z0 + t, x1 - t, z1 - t), 0.01, [0.8, 0.8, 0.84]);
  // Shelf along the north wall, flush, with a lamp over the one thing worth stopping for.
  s.crate(x0 + 0.5, z0 + t + 0.06, x0 + 3.1, z0 + t + 0.9, 1, [0.5, 0.54, 0.6]);
  s.crate(x1 - 3.1, z0 + t + 0.06, x1 - 0.5, z0 + t + 0.9, 1, [0.5, 0.54, 0.6]);
  s.bar(24, top - slab, 24, 0, 3, 'white', 24, 8);
  g.use('emissiveRed').box(26, 2.8, z1 + 0.06, 0.8, 0.05, 0.02, FACE.pz);
  s.lamp(24, 2.6, z1 + 0.05, 0, 'orange', 24, 10);
  s.plan.fills.push({ x0, z0, x1, z1, rgb: [0.86, 0.8, 0.3], label: '' });
}

/** Solid, with its pipes down one side. Nothing says climb it, which is the point: the Judge is for those who try. */
function pumpHouse(s: Site): void {
  const k = s.k, g = k.geo;
  const x0 = -67, x1 = -53, z0 = 45, z1 = 55, top = 3.6;
  s.mass('concreteDark', x0, 0, z0, x1, top, z1, 0.7, 2);
  s.plan.blocks.push({ x0, z0, x1, z1 });
  g.use('concrete');
  for (let x = x0 + 0.1; x < x1 - 0.1; x += 2.8) {
    const t = k.rand(0.7, 0.9);
    g.tint(t, t, t * 1.04);
    for (const [z, f] of [[z1, FACE.pz], [z0, FACE.nz]] as const) g.box(x + 1.35, top / 2, z, 1.33, top / 2 - 0.1, 0.001, f);
  }
  g.tint(1);
  g.use('steelDark');
  g.box((x0 + x1) / 2, top + 0.002, (z0 + z1) / 2, (x1 - x0) / 2, 0.001, (z1 - z0) / 2, FACE.py);
  for (const z of [z0 + 2.5, z1 - 2.5]) {
    g.use('steel').cyl(x1 + 0.3, 0.8, z, x1 + 3.2, 0.8, z, 0.28, 0.28, 8);
    g.use('steel').cyl(x1 + 3.2, 0, z, x1 + 3.2, 0.8, z, 0.28, 0.28, 8);
  }
  s.lamp(-60, 2.7, z1 + 0.02, 0, 'orange', 26, 11);
  s.lamp(-60, 2.7, z0 - 0.02, Math.PI, 'orange', 26, 11);
  signPanel(k, -60, 2.2, z1 + 0.04, 0, 3, 0.75, signId('COOLANT'), false);
  // A lamp on the roof, so it is worth a look from the ground.
  s.fill(-60, 5.4, 50, 20, 9, 'orange');
  g.use('emissiveOrange').box(-60, 3.9, 47.4, 0.3, 0.3, 0.05, FACE.all);
}

/** A storage tank with two boxes for a collider: a square turned on another is round enough to walk past. */
function fuelTank(s: Site, x: number, z: number, r: number, h: number): void {
  const k = s.k, g = k.geo;
  g.use('panel').tint(0.56, 0.56, 0.54).lathe([r + 0.2, 0, r + 0.2, 0.6, r, 0.7, r, h], x, 0, z, 20, false);
  const dome: number[] = [];
  for (let i = 0; i <= 5; i++) {
    const t = (i / 5) * Math.PI * 0.5;
    dome.push(r * Math.cos(t) + (i === 5 ? 0.001 : 0), h + r * 0.26 * Math.sin(t));
  }
  g.lathe(dome, x, 0, z, 20, true);
  g.tint(1).use('steelDark');
  for (const y of [h * 0.34, h * 0.67]) g.lathe([r, y - 0.1, r + 0.07, y - 0.06, r + 0.07, y + 0.06, r, y + 0.1], x, 0, z, 20, false);
  const a = r * 0.93;
  k.push(x, 0, z, 0);
  k.collide(0, h / 2, 0, a, h / 2, a, 'metal');
  k.pop();
  k.push(x, 0, z, Math.PI / 4);
  k.collide(0, h / 2, 0, a, h / 2, a, 'metal', false);
  k.pop();
  s.plan.blocks.push({ x0: x - a, z0: z - a, x1: x + a, z1: z + a });
}

/** By the east road, so one bullet can end a truck. */
function fuelFarm(s: Site): void {
  const k = s.k, g = k.geo;
  s.paintFloor('concreteDark', rect(50, 44, 72, 66), 0.008, [0.6, 0.6, 0.62], 3);
  fuelTank(s, 57, 58, 4.2, 7);
  fuelTank(s, 67, 57, 3.4, 5.6);
  s.spec.tank(52.5, 0, 47);
  s.spec.tank(70, 0, 48);
  for (const [x, z] of [[55, 42], [60, 41.5], [65, 42.5]] as const) s.spec.barrels(x, 0, z, 4, 1.05);
  g.use('emissiveRed').box(57, 7.9, 58, 0.14, 0.1, 0.14, FACE.all);
  s.fill(61, 3.2, 49, 44, 16, 'orange');
  s.plan.fills.push({ x0: 50, z0: 44, x1: 72, z1: 66, rgb: [0.86, 0.5, 0.2], label: '' });
}

/** One man's corpse, as a suit lying on its back. His feet are bare: the Commander kept the boots. */
function contractor(s: Site, x: number, y: number, z: number, yaw: number): void {
  const k = s.k, g = k.geo;
  k.push(x, y, z, yaw);
  g.use('steelDark').tint(0.55, 0.5, 0.46);
  g.bevel(0, 0.17, 0, 0.32, 0.15, 0.2, 0.05);
  g.bevel(0.56, 0.14, 0, 0.26, 0.12, 0.17, 0.05);
  g.use('panel').tint(0.34, 0.28, 0.26);
  g.bevel(-0.5, 0.18, 0, 0.17, 0.16, 0.15, 0.05);
  g.use('emissiveOrange').box(-0.62, 0.2, 0, 0.012, 0.03, 0.1, FACE.nx);
  g.use('steelDark').tint(0.5, 0.46, 0.42);
  for (const sz of [1, -1]) {
    k.beam(0.2, 0.14, sz * 0.32, 0.72, 0.1, sz * 0.46, 0.08, 0.08);
    k.beam(0.75, 0.12, sz * 0.1, 1.42, 0.09, sz * 0.2, 0.1, 0.1);
    g.use('paintWhite').tint(0.6, 0.47, 0.42);
    g.bevel(1.53, 0.08, sz * 0.21, 0.13, 0.05, 0.06, 0.02);
    g.use('steelDark').tint(0.5, 0.46, 0.42);
  }
  g.tint(1);
  k.pop();
}

/**
 * The last contractor's dropship. Burned out, flat-backed and alone. Everything solid on it is one box of exactly the deck's height:
 * the lesson is that one jump does not reach, so nothing may stand against the hull to give a leg up. The wing and tail have no collider
 * for the same reason, and hang off the far side from the way in.
 */
function wreck(s: Site): void {
  const k = s.k, g = k.geo;
  const { x0, z0, x1, z1, deck } = WRECK;
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  // No climb: a jump and a climb up the hull would make the double jump optional.
  k.noClimb(() => s.solid(x0, 0, z0, x1, deck, z1, 'metal'));
  s.plan.blocks.push({ x0, z0, x1, z1 });
  g.use('steelDark').tint(0.34, 0.32, 0.32).slab(mx, deck / 2, mz, (x1 - x0) / 2 - 0.01, deck / 2, (z1 - z0) / 2 - 0.01, 2, FACE.px | FACE.nx | FACE.pz | FACE.nz);
  // Hull plates, burned from the engine end forward.
  for (let x = x0; x < x1 - 0.1; x += 2) {
    for (let y = 0; y < deck - 0.1; y += 1.4) {
      const burn = (x - x0) / (x1 - x0);
      const t = k.rand(0.22, 0.42) * (1 - burn * 0.45);
      const skip = k.rng() < 0.08 + burn * 0.18;
      if (skip) continue;
      g.use('panel').tint(t, t * 0.96, t * 0.94);
      const h = Math.min(1.4, deck - y) / 2 - 0.02;
      for (const [z, f] of [[z0, FACE.nz], [z1, FACE.pz]] as const) g.box(x + 1, y + h + 0.02, z, 0.98, h, 0.001, f);
    }
  }
  g.tint(1);
  // The deck, which is the top of the box and must stay flat.
  for (let x = x0; x < x1 - 0.1; x += 2.5) {
    const t = k.rand(0.3, 0.5);
    g.use('panel').tint(t, t * 0.96, t * 0.92).slab(x + 1.25, deck - 0.01, mz, 1.23, 0.01, (z1 - z0) / 2 - 0.02, 2.5, FACE.py);
  }
  g.tint(1);
  // Ribs where the skin burned off, and the frame of the cockpit, up above head height at the nose so they read from the apron.
  for (let x = x1 - 7; x < x1; x += 1.6) {
    g.use('rust').tint(0.5);
    g.box(x, deck + 0.8, z0 + 0.06, 0.05, 0.8, 0.05, FACE.sides);
    g.box(x, deck + 0.8, z1 - 0.06, 0.05, 0.8, 0.05, FACE.sides);
    g.box(x, deck + 1.6, mz, 0.05, 0.05, (z1 - z0) / 2, FACE.py | FACE.ny | FACE.px | FACE.nx);
  }
  g.tint(1);
  for (const sz of [1, -1]) k.beam(x0 + 0.4, deck, mz + sz * 3.6, x0 + 3.4, deck + 1.9, mz + sz * 2, 0.08, 0.08, 'steelDark');
  k.beam(x0 + 3.4, deck + 1.9, mz - 2, x0 + 3.4, deck + 1.9, mz + 2, 0.08, 0.08, 'steelDark');
  // The wing on the side away from the apron, snapped and dug in, and a fin at the stern.
  g.use('panel').tint(0.26, 0.26, 0.28);
  k.push(mx + 2, 2.2, z1 + 3.4, 0, 0, -0.42);
  g.bevel(0, 0, 0, 3.6, 0.16, 3.6, 0.06);
  k.pop();
  g.use('rust').tint(0.42);
  k.beam(x1 - 1, deck, mz, x1 + 2.4, deck + 3.2, mz, 0.1, 1.2, 'rust');
  g.tint(1);
  // Scorched earth, and scrap that nobody can stand on.
  g.use('dirt').tint(0.2, 0.19, 0.2).fan(ring(mx, mz, 19, 16), 0.012);
  g.tint(1);
  rubble(k, x0 - 6, 0.02, z1 + 4, 4, 12, 'rust', false);
  rubble(k, x1 + 6, 0.02, z0 - 3, 4, 12, 'steelDark', false);
  s.floorWords('BULLSEYE', mx, deck, mz + 2.6, 0.3, 2.2, [0.26, 0.22, 0.2]);
  contractor(s, 87.6, deck, 85, 2.5);
  // The only warm light for a hundred metres, so the eye finds it from the far side of the apron.
  s.fill(84, deck + 2.6, 84, 70, 18, 'orange');
  s.fill(70, 3.4, 76, 30, 14, 'orange');
  g.use('emissiveOrange').box(x1 - 3.5, deck + 0.06, mz + 1.5, 1, 0.05, 0.7, FACE.py);
  g.use('emissiveOrange').box(x1 - 6.5, deck + 0.05, mz - 2, 0.7, 0.04, 0.5, FACE.py);
  s.plan.fills.push({ x0, z0, x1, z1, rgb: [0.95, 0.5, 0.15], label: '' });
}

function ring(x: number, z: number, r: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push(x + Math.cos(a) * r * (0.82 + 0.18 * Math.sin(i * 2.7)), z + Math.sin(a) * r * (0.82 + 0.18 * Math.sin(i * 2.7)));
  }
  return out;
}

/** Where the shells have already landed. Scorch and a low rim, no collider, so a sprint never notices. */
function craters(s: Site): void {
  const g = s.k.geo;
  for (const [x, z, r] of [[-30, 62, 2.8], [10, 62, 3.4], [-4, 46, 2.4], [32, 48, 2.6], [-52, 62, 3], [44, 64, 2.8], [18, 86, 3.6], [62, 74, 3], [-78, 74, 3.4], [-82, 50, 2.4], [86, 54, 2.8]] as const) {
    g.use('dirt').tint(0.34, 0.32, 0.32).fan(ring(x, z, r * 1.3, 12), 0.016);
    g.use('dirt').tint(0.52, 0.5, 0.48).lathe([r * 0.72, 0.016, r * 0.94, 0.11, r * 1.2, 0.016], x, 0, z, 12, true);
    g.tint(1);
  }
}

/** Far-flank cover, so the walk to the wreck can be made in bounds and is never a sprint across a car park. */
function scatter(s: Site): void {
  const k = s.k;
  container(k, -90, 0, 62, 0.3);
  container(k, -86, 0, 94, -0.5);
  container(k, 94, 0, 58, 1.2);
  container(k, 22, 0, 98, 0.1);
  truck(k, 52, 0, 76, 0.7, 0);
  truck(k, 36, 0, 84, -1.1, 0);
  for (const [x, z] of [[-74, 78], [6, 88], [58, 88], [30, 72], [84, 66]] as const) tyres(k, x, 0, z, 4);
  for (const [x, z, yaw] of [[-8, 84, 0.4], [-70, 34 + 12, 0.3], [78, 74, 0.8], [46, 96, 0.2]] as const) hedgehog(s, x, z, yaw);
  for (const [x, z, yaw] of [[-30, 46, 0], [30, 46, Math.PI], [-96, 46, 0.4], [96, 46, 2.7], [-10, 76, 0.2], [34, 76, -0.2], [-74, 62, 0.5], [76, 62, -0.5]] as const) k.mast(x, z, 0, 9, yaw, 'white', 130, 28);
}

/** Crossed steel beams: too low to hide behind, high enough to break a line. */
function hedgehog(s: Site, x: number, z: number, yaw: number): void {
  const k = s.k;
  k.push(x, 0, z, yaw);
  k.beam(-0.9, 0.05, -0.9, 0.9, 1.4, 0.9, 0.08, 0.08, 'rust');
  k.beam(0.9, 0.05, -0.9, -0.9, 1.4, 0.9, 0.08, 0.08, 'rust');
  k.beam(-0.9, 1.4, -0.9, 0.9, 0.05, 0.9, 0.08, 0.08, 'rust');
  k.collide(0, 0.7, 0, 0.7, 0.7, 0.7, 'metal', false);
  k.pop();
}

/** North of the road the Guardhouse stood alone. These give a slide somewhere to end. Authored last, so the rest of the site keeps its random draws. */
function slideCover(s: Site): void {
  for (const [a, b, z, h] of [[-46, -40, 26, TALL], [-30, -24, 22, LOW], [-16, -11, 27, TALL], [34, 40, 26, TALL], [46, 51, 20, LOW], [7, 12, 47, LOW]] as const) hesco(s, a, b, z, h);
}

export function authorApron(s: Site): void {
  ground(s);
  berms(s);
  roads(s);
  coverLines(s);
  lzCut(s);
  guardhouse(s);
  pumpHouse(s);
  fuelFarm(s);
  wreck(s);
  craters(s);
  scatter(s);
  slideCover(s);
}
