/**
 * The ground and the field round the fort: one floor collider under everything, the roads and the track, a line of tank traps
 * outside the walls, shacks and wrecks for the attackers to hide behind, mortar pits, landing zones, and the fence at the edge.
 * Each side is authored as the north one and turned. Lanes, landing zones and the track are kept clear: the map test sweeps them.
 */
import { FACE, type Mat } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { barrier, container, fence, rubble, signPanel, truck, tyres } from '../../kit/props';
import { signId } from '../../kit/signs';
import { Site } from '../outpost/site';
import type { MapSpec } from '../spec';
import { onSide } from './rings';
import { EDGE, FENCE, LEVEL, LZ_AT, MORTAR_AT, ring, type Rgb, rot, SKY, TRACK } from './plan';
import { armyTruck, board, boom, booth, crater, deadTree, latticeMast, nest, rock, ruin, teeth, wire } from './props';

const OUTER = ring('outer').half;
const HORIZON = 180;

function ground(k: Kit, mat: Mat, tint: Rgb, x0: number, z0: number, x1: number, z1: number, y: number, step: number): void {
  const g = k.geo.use(mat).tint(tint[0], tint[1], tint[2]);
  g.gridStep(x0, y, z1, x1 - x0, 0, 0, 0, 0, z0 - z1, step);
  g.tint(1);
}

/** The four pieces of the band between two squares, half-widths `a` < `b`. */
function band(k: Kit, mat: Mat, tint: Rgb, a: number, b: number, y: number, step: number): void {
  ground(k, mat, tint, -b, -b, b, -a, y, step);
  ground(k, mat, tint, -b, a, b, b, y, step);
  ground(k, mat, tint, -b, -a, -a, a, y, step);
  ground(k, mat, tint, a, -a, b, a, y, step);
}

function floors(k: Kit): void {
  // One collider under the whole field, so nothing anywhere crosses a seam.
  k.collide(0, -1, 0, EDGE + 2, 1, EDGE + 2, 'dirt');
  ground(k, 'dirt', [0.6, 0.57, 0.5], -OUTER, -OUTER, OUTER, OUTER, 0, 4);
  band(k, 'dirt', [0.5, 0.47, 0.4], OUTER, EDGE, 0, 6);
  band(k, 'dirt', [0.3, 0.29, 0.26], EDGE, HORIZON, -0.02, 20);
  // The track round the walls, worn darker.
  band(k, 'dirt', [0.4, 0.37, 0.32], TRACK - 4, TRACK + 4, 0.006, 4);
  // Two roads: asphalt north to south, gravel east to west, each from beyond the fence to its gate.
  for (const s of [-1, 1]) {
    ground(k, 'asphalt', [0.5, 0.5, 0.52], -5, s < 0 ? -FENCE - 6 : OUTER + 0.3, 5, s < 0 ? -OUTER - 0.3 : FENCE + 6, 0.012, 3);
    ground(k, 'dirt', [0.34, 0.32, 0.28], s < 0 ? -FENCE - 6 : OUTER + 0.3, -4, s < 0 ? -OUTER - 0.3 : FENCE + 6, 4, 0.012, 3);
  }
  // The road's edge lines.
  const g = k.geo.use('paintWhite').tint(0.7, 0.68, 0.6);
  for (const s of [-1, 1]) for (const e of [-4.6, 4.6]) {
    g.box(e, 0.014, s * (OUTER + FENCE) / 2, 0.08, 0.002, (FENCE - OUTER) / 2, FACE.py);
  }
  g.tint(1);
}

/** Chain-link round the field on its own posts, and the invisible wall on it that keeps everyone in. */
function edge(k: Kit): void {
  const F = FENCE;
  fence(k, [-F, -F, F, -F, F, F, -F, F, -F, -F], 0, 2.6, false);
  const half = SKY / 2;
  k.containment(0, half, -F - 0.5, F + 1, half, 0.5);
  k.containment(0, half, F + 0.5, F + 1, half, 0.5);
  k.containment(-F - 0.5, half, 0, 0.5, half, F);
  k.containment(F + 0.5, half, 0, 0.5, half, F);
}

/** A Czech hedgehog: three crossed girders. Cover for a man, a wall for a wheel. */
function hedgehog(k: Kit, x: number, z: number, yaw: number): void {
  k.push(x, 0.62, z, yaw);
  for (const [p, r] of [[0.62, 0], [-0.62, 0], [0, Math.PI / 2]] as const) {
    k.push(0, 0, 0, r, p, r === 0 ? 0 : 0.62);
    k.geo.use('rust').tint(0.7).box(0, 0, 0, 0.95, 0.06, 0.06, FACE.py | FACE.ny | FACE.pz | FACE.nz | FACE.px | FACE.nx);
    k.pop();
  }
  k.geo.tint(1);
  k.collide(0, 0, 0, 0.55, 0.6, 0.55, 'metal', false);
  k.pop();
}

/** An oil drum burning: an orange glow to steer by, in the dark of the field. */
function burner(k: Kit, x: number, z: number, y = 0): void {
  const g = k.geo;
  g.use('rust').cyl(x, y, z, x, y + 0.9, z, 0.3, 0.3, 10, false, false);
  g.use('emissiveOrange').cyl(x, y + 0.86, z, x, y + 0.88, z, 0.27, 0.27, 10, false, true);
  k.collide(x, y + 0.45, z, 0.3, 0.45, 0.3, 'metal');
  k.light(x, y + 1.6, z, 'orange', 22, 11);
}

/** A sandbag crescent with a tube behind it. The spot itself is FORT_MORTARS; nothing stands on it. */
function mortarPit(k: Kit, site: Site, u: number, z: number): void {
  site.sandbags(u - 2.4, z + 2.2, u + 2.4, z + 3, 1.1);
  site.sandbags(u - 2.4, z + 0.4, u - 1.6, z + 2.2, 1.1);
  site.sandbags(u + 1.6, z + 0.4, u + 2.4, z + 2.2, 1.1);
  const g = k.geo;
  g.use('steelDark').bevel(u + 1, 0.03, z - 0.6, 0.3, 0.03, 0.3, 0.01);
  k.push(u + 1, 0.05, z - 0.6, Math.PI / 2, 1.0);
  g.use('steel').tint(0.6).cyl(0, 0, 0, 1.1, 0, 0, 0.06, 0.06, 8, false, true);
  g.tint(1);
  k.pop();
  site.crate(u - 1.3, z - 1.6, u - 0.5, z - 1.0, 0.45, [0.42, 0.46, 0.3]);
}

/** A painted ring and an H, so a helicopter's spot reads from the walls. */
function landingZone(k: Kit, x: number, z: number): void {
  const g = k.geo.use('paintWhite').tint(0.75, 0.74, 0.68);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    k.push(x + Math.cos(a) * 7, 0.016, z + Math.sin(a) * 7, -a);
    g.box(0, 0, 0, 0.18, 0.002, 0.8, FACE.py);
    k.pop();
  }
  g.box(x - 1.4, 0.016, z, 0.22, 0.002, 2, FACE.py);
  g.box(x + 1.4, 0.016, z, 0.22, 0.002, 2, FACE.py);
  g.box(x, 0.016, z, 1.2, 0.002, 0.22, FACE.py);
  g.tint(1);
}

/**
 * Each side of the field is its own ground, authored in the side's turned frame (the fort at +z, the fence at -114):
 *   north  the asphalt road in, a checkpoint on it, jersey barriers, a sign gantry, street lamps, wrecks
 *   east   a ruined village either side of the gravel road, shacks among the houses
 *   south  a spoil bank like a ditch's, wire in front of it, dragon's teeth under the walls, fighting holes, shell craters
 *   west   a rocky rise: a mesa with a flat top at LEVEL.rise and ramps up two faces, boulders and dead trees
 * All of it keeps off the lanes, the track, the landing zone, the mortar pits and the spawns. Shacks: u, z, yaw, and planks or sheet.
 */
type Shack = readonly [number, number, number, 'planks' | 'sheet'];

const SHACKS: Record<number, readonly Shack[]> = {
  0: [[-20, -74, 0.2, 'planks'], [-14, -80, -0.4, 'sheet'], [-25, -98, 1.3, 'planks'], [17, -75, 0.1, 'sheet'], [26, -72, -0.2, 'planks'], [14, -101, 0.5, 'sheet'], [47, -80, 0.9, 'planks']],
  1: [[-11, -90, 0.1, 'planks'], [11, -88, -0.2, 'sheet'], [-30, -72, 0.3, 'sheet'], [30, -74, 0.4, 'planks'], [38, -105, 0.2, 'planks'], [60, -88, -0.3, 'sheet'], [-36, -104, 0.6, 'planks']],
  2: [[-14, -90, 0.2, 'sheet'], [-25, -98, 0.9, 'planks'], [13, -100, -0.3, 'planks'], [21, -86, 0.4, 'sheet'], [52, -96, 0.1, 'planks'], [-62, -78, -0.4, 'planks'], [45, -84, 0.7, 'sheet']],
  3: [[-20, -74, 0.2, 'planks'], [18, -72, -0.3, 'sheet'], [13, -101, 0.5, 'planks'], [27, -80, 0.2, 'sheet'], [-36, -104, 1.1, 'planks'], [-12, -86, 0.3, 'sheet']],
};

function north(k: Kit, site: Site): void {
  // The checkpoint: a booth either side, the arms up, barriers lining the road, a gantry over it saying so.
  booth(k, 10.2, -84, Math.PI);
  booth(k, -10.2, -89, 0);
  boom(k, 7.8, -84, Math.PI / 2, 6);
  boom(k, -7.8, -89, -Math.PI / 2, 6);
  for (let z = -104; z <= -72; z += 5.2) {
    if (z > -92 && z < -80) continue;
    barrier(k, 8.7, 0, z, Math.PI / 2);
    barrier(k, -8.7, 0, z, Math.PI / 2);
  }
  const g = k.geo;
  for (const u of [-9.4, 9.4]) {
    g.use('steelDark').bevel(u, 3.3, -96, 0.14, 3.3, 0.14, 0.03);
    k.collide(u, 3.3, -96, 0.14, 3.3, 0.14, 'metal', false);
  }
  k.truss(-9.4, 6.4, -96, 9.4, 6.4, -96, 0.8, 0.5);
  signPanel(k, -3.2, 6.4, -96.4, Math.PI, 5.2, 1.3, signId('CHECKPOINT'), true);
  signPanel(k, 3.6, 6.4, -96.4, Math.PI, 3.2, 1.3, signId('HALT'), true);
  nest(k, site, 14, -91, 0);
  nest(k, site, -30, -92, 0, 2.6);
  // Street lamps down the road.
  for (const z of [-100, -76]) for (const u of [-11.5, 11.5]) {
    g.use('steelDark').cyl(u, 0, z, u, 5.5, z, 0.08, 0.06, 6, false, true);
    g.bevel(u - Math.sign(u) * 0.6, 5.5, z, 0.7, 0.05, 0.08, 0.02);
    g.use('emissiveOrange').box(u - Math.sign(u) * 1.1, 5.43, z, 0.22, 0.02, 0.1, FACE.ny);
    k.collide(u, 2.75, z, 0.1, 2.75, 0.1, 'metal', false);
  }
  k.light(-10, 5, -76, 'orange', 20, 14);
  k.light(10, 5, -100, 'orange', 20, 14);
  // Wrecks and shell holes off the road.
  armyTruck(k, -20, -90, 0.3, true);
  truck(k, 27, 0, -98, 0.25);
  for (const [u, z, r] of [[-22, -92, 2.2], [17, -84, 1.6], [40, -104, 2.4], [-38, -76, 1.8], [56, -90, 2], [-14, -102, 1.4]] as const) crater(k, u, z, r);
  container(k, 58, 0, -96, 0.35);
  tyres(k, 22, 0, -92, 3);
  for (let u = -45; u <= 45; u += 6) if (Math.abs(u) > 9) hedgehog(k, u, -OUTER - 5, u * 0.7);
}

function east(k: Kit, site: Site): void {
  // The village: houses either side of the road, most of them down.
  for (const [u, z, yaw, w, d, n] of [
    [-18, -80, 0.2, 8, 6, 0], [-20, -99, -0.15, 7, 6, 1], [15, -79, -0.1, 7, 6, 2], [24, -99, 0.1, 7, 5.5, 3], [48, -82, 0.3, 8, 6, 4], [47, -99, -0.2, 7, 6, 5],
    [-48, -74, 0.1, 6, 5, 6],
  ] as const) ruin(k, site, u, z, yaw, w, d, n);
  for (const [u, z, r, n] of [[-12, -96, 2.2, 10], [28, -93, 1.8, 7], [56, -90, 2, 8], [-30, -94, 1.6, 6]] as const) rubble(k, u, 0, z, r, n, 'concrete');
  for (const [u, z, h] of [[-26, -86, 6], [12, -92, 5], [40, -74, 7], [-40, -104, 5.5]] as const) deadTree(k, u, z, h);
  armyTruck(k, 34, -80, 1.4, true);
  for (const [u, z, r] of [[-34, -80, 1.6], [26, -90, 1.4], [60, -76, 2]] as const) crater(k, u, z, r);
  // A burning car in the street, fires still going in the houses.
  burner(k, -9.5, -78);
  burner(k, 12.6, -77.4);
  burner(k, 44.5, -97.7);
  burner(k, -22.4, -97.5);
  for (let u = -45; u <= 45; u += 6) if (Math.abs(u) > 9) hedgehog(k, u, -OUTER - 5, u * 0.7 + 1);
}

function south(k: Kit, site: Site): void {
  // The spoil bank, toe to crest to toe, either side of the road: the walls' side has a lip to fire over.
  const crest = 1.3;
  for (const [a, b] of [[-60, -11], [11, 62]] as const) {
    const mid = (a + b) / 2, w = b - a;
    k.ramp(mid, -79, 0, mid, -77, crest, w, 'dirt', 1.2, false);
    k.ramp(mid, -72.5, 0, mid, -74.5, crest, w, 'dirt', 1.2, false);
    site.mass('dirt', a, 0, -77, b, crest, -74.5, 0.5, 3, FACE.py);
    k.geo.use('dirt').tint(0.42, 0.38, 0.32);
    for (const end of [a, b]) k.geo.box(end, crest / 2, -75.75, 0.01, crest / 2, 1.25, end === a ? FACE.nx : FACE.px);
    k.geo.tint(1);
    site.plan.blocks.push({ x0: a, z0: -79, x1: b, z1: -72.5 });
  }
  // Wire out in front of the bank, with gaps a man can find.
  for (const [a, b, z] of [[-60, -36, -80.5], [-34, -10, -87], [10, 28, -84], [38, 62, -100], [-36, -14, -101], [12, 30, -101]] as const) wire(k, a, z, b, z);
  // Minefield signs hung along the wire, red so they read from the walls.
  for (const [u, z] of [[-50, -80.1], [-24, -86.6], [20, -83.6], [50, -99.6], [-26, -100.6], [20, -100.6]] as const) board(k, u, z, 0, 'MINES', 1.6, 0.9);
  // Searchlights on poles at the bank's ends, raking the wire.
  for (const [u, yaw] of [[-12.5, -0.5], [12.5, 0.5]] as const) {
    k.geo.use('steelDark').cyl(u, 0, -73.5, u, 6, -73.5, 0.1, 0.08, 6, false, true);
    k.push(u, 6.2, -73.5, Math.PI + yaw, -0.25);
    k.geo.use('steelDark').bevel(0, 0, 0, 0.35, 0.3, 0.3, 0.04);
    k.geo.use('emissiveWhite').box(0, 0, -0.31, 0.28, 0.24, 0.01, FACE.nz);
    k.pop();
    k.collide(u, 3, -73.5, 0.12, 3, 0.12, 'metal', false);
    k.light(u + Math.sign(u) * 6, 2.5, -88, 'white', 60, 22);
  }
  // Fighting holes behind the bank and shell craters everywhere.
  for (const u of [-38, -22, 26, 44]) nest(k, site, u, -81.6, 0, 2.6, 2);
  for (const [u, z, r] of [
    [-22, -92, 2.4], [20, -94, 1.8], [-54, -100, 2], [36, -106, 2.2], [56, -86, 1.6], [-12, -108, 1.4], [30, -71, 1.2], [-44, -82, 1.4],
  ] as const) crater(k, u, z, r);
  armyTruck(k, 30, -94, -0.6, true);
  armyTruck(k, -16, -97, 2.2, true);
  teeth(k, -45, -OUTER - 5, -9, -OUTER - 5);
  teeth(k, 9, -OUTER - 5, 45, -OUTER - 5);
}

function west(k: Kit, site: Site): void {
  // The rise: a flat top at LEVEL.rise, a ramp up its west face and one up the face toward the fort, rock faces on the others.
  const y = LEVEL.rise, u0 = 46, u1 = 58, z0 = -96, z1 = -82;
  site.mass('dirt', u0, 0, z0, u1, y, z1, 0.52, 3, FACE.py | FACE.px | FACE.nz);
  k.ramp(40, (z0 + z1) / 2, 0, u0, (z0 + z1) / 2, y, z1 - z0, 'dirt', 1.5, false);
  k.ramp((u0 + u1) / 2, -76, 0, (u0 + u1) / 2, z1, y, u1 - u0, 'dirt', 1.5, false);
  site.plan.decks.push({ x0: u0, z0, x1: u1, z1 });
  for (const [u, z, s] of [[59, -84, 2.6], [59.5, -90, 2.4], [58.5, -95.5, 2.8], [52, -97.5, 2.4], [46.5, -97, 2.2], [42.5, -79, 2.4], [44, -80.5, 1.8]] as const) rock(k, u, z, s);
  // On top: boulders to hide behind, a broken relay mast, a sandbag perch facing the walls.
  for (const [u, z, s] of [[49, -93, 1.4], [55, -86, 1.2]] as const) rock(k, u, z, s, y);
  latticeMast(k, 50, -88, y, 7, 0.5);
  nest(k, site, 52, -83.8, 0, 2.6, 2);
  burner(k, 55.5, -91, y);
  armyTruck(k, 34, -74, 2.6, true);
  // An outcrop and boulders down the slope, dead trees.
  for (const [u, z, s] of [[-18, -95, 2.2], [-14, -92, 1.6], [-22, -99, 1.8], [-18, -80, 1.6], [12, -96, 1.8], [16, -76, 1.4], [-60, -76, 2], [30, -106, 2.2], [-52, -106, 1.6]] as const) rock(k, u, z, s);
  for (const [u, z, h] of [[24, -84, 6], [-14, -104, 5], [64, -92, 7], [-30, -95, 6]] as const) deadTree(k, u, z, h);
  for (const [u, z, r] of [[-40, -72, 1.6], [20, -90, 1.4]] as const) crater(k, u, z, r);
  for (let u = -45; u <= 45; u += 6) if (Math.abs(u) > 9) hedgehog(k, u, -OUTER - 5, u * 0.7 + 3);
}

const THEMES = [north, east, south, west] as const;

function side(k: Kit, site: Site, spec: MapSpec, i: number): void {
  for (const [u, z, yaw, look] of SHACKS[i]!) {
    const [x, wz] = rot(i, u, z);
    spec.shack(x, wz, yaw - (i * Math.PI) / 2, look);
  }
  for (const [u, z] of MORTAR_AT) mortarPit(k, site, u, z);
  landingZone(k, LZ_AT[0], LZ_AT[1]);
  THEMES[i]!(k, site);
  if (i !== 1) burner(k, -16, -85);
  burner(k, 21, -81);
}

export function authorField(k: Kit, spec: MapSpec): void {
  const site = new Site(k, spec);
  floors(k);
  edge(k);
  for (let i = 0; i < 4; i++) onSide(k, spec.plan!, i, () => side(k, site, spec, i));
}
