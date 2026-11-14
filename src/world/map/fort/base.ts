/**
 * What fills the rings, so the fort reads as a lived-in base and every yard has its own thing in it. World coordinates throughout:
 * nothing here is turned, each corner of the base is its own place.
 *
 *  outer ring  north: the motor pool (a three-bay shed, a roof to fight from), the fuel point, the mess tent, the water tower
 *              east:  the barracks huts (one with a firing roof) and the helipad
 *              south: HQ (a firing roof under dishes), a container stack to climb, the barracks shop
 *              west:  the ammunition dump behind sandbag revetments, the trucks, a storage shed
 *  middle      the comms tower (north-west), the vehicle bay (east, a firing roof), a hut (south), the generators (west), the armoury
 *  core        the infirmary and magazine, the flag, a mast
 *
 * Everything keeps clear of the stairs, gates, posts, breach points, the rally point and the mortar teams' spots (fort-map.test.ts).
 */
import { FACE } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { cable, container, machine, signPanel, tyres } from '../../kit/props';
import { signId } from '../../kit/signs';
import { Site } from '../outpost/site';
import type { MapSpec } from '../spec';
import { LEVEL } from './plan';
import { ammoStack, armyTruck, board, commsTower, dish, drums, fuelTank, hut, latticeMast, nest, OLIVE, tent, waterTower } from './props';

const ROAD: readonly [number, number, number] = [0.5, 0.5, 0.52];

/** A three-bay vehicle shed with a flat roof you climb to, open on its +Z side, a truck in each bay. Local frame, front +Z. */
function motorPool(k: Kit, site: Site, x: number, z: number, yaw: number, bays: number, trucks: readonly boolean[]): void {
  const g = k.geo, bay = 5.2, len = bays * bay, hx = len / 2, d = 8, hz = d / 2, h = LEVEL.roof - 0.25, from = site.plan.blocks.length;
  k.push(x, 0, z, yaw);
  site.paintFloor('concrete', { x0: -hx, z0: -hz, x1: hx, z1: hz + 1.5 }, 0.01, [0.5, 0.5, 0.48], 2);
  g.tint(OLIVE[0] * 1.4, OLIVE[1] * 1.4, OLIVE[2] * 1.4);
  k.block('panel', -hx, 0, -hz, hx, h, -hz + 0.25, 0.03);
  k.block('panel', -hx, 0, -hz + 0.25, -hx + 0.25, h, hz, 0.03);
  k.block('panel', hx - 0.25, 0, -hz + 0.25, hx, h, hz, 0.03);
  g.tint(1);
  for (let i = 1; i < bays; i++) k.column(-hx + i * bay, hz - 0.3, 0, h, 0.4, 'concrete');
  g.tint(0.62);
  k.block('concrete', -hx - 0.15, h, -hz - 0.15, hx + 0.15, LEVEL.roof, hz + 0.25, 0.03);
  g.tint(1);
  // The roof: sandbags along its front edge with a gap at each bay, a hazard edge, stairs up the right-hand end.
  for (let i = 0; i < bays; i++) site.sandbags(-hx + i * bay + 0.6, hz - 0.45, -hx + (i + 1) * bay - 1.6, hz + 0.2, 0.75, LEVEL.roof);
  g.use('hazard').box(0, LEVEL.roof + 0.006, -hz + 0.05, hx, 0.004, 0.08, FACE.py);
  site.stairs(hx + 4.3, hz - 1, 0, hx + 0.1, hz - 1, LEVEL.roof, 1.6, 'steel', true);
  for (let i = 0; i < bays; i++) {
    const cx = -hx + (i + 0.5) * bay;
    // Bay numbers on the floor and the back wall, an oil stain, a lamp.
    site.floorWords(String(i + 1) as never, cx, 0.012, hz - 1.4, Math.PI, 1.4, [0.86, 0.8, 0.3]);
    g.use('dirt').tint(0.12).box(cx + 0.4, 0.013, -0.6, 0.8, 0.001, 0.6, FACE.py);
    g.tint(1);
    k.lampBar(cx, h - 0.12, 0, 0, 2.4, 'white', 14, 8);
    if (trucks[i]) armyTruck(k, cx, -0.2, -Math.PI / 2, false);
  }
  tyres(k, hx - 1, 0, -hz + 1, 3);
  signPanel(k, 0, h - 0.5, hz + 0.27, 0, 3.6, 0.9, signId('MOTOR POOL'), true);
  k.pop();
  site.plan.blocks.length = from;
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  site.plan.blocks.push({ x0: x - hx * c - hz * s, z0: z - hx * s - hz * c, x1: x + hx * c + hz * s, z1: z + hx * s + hz * c });
}

/** A painted road from point to point, `w` wide, axis-aligned legs. */
function road(site: Site, x0: number, z0: number, x1: number, z1: number): void {
  site.paintFloor('asphalt', { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) }, 0.009, ROAD, 2);
}

function outerNorth(k: Kit, site: Site, spec: MapSpec): void {
  // The road from the outer gate round to the middle ring's north gate.
  road(site, -3, -49, 3, -38);
  road(site, -3, -38, 17, -33);
  site.floorWords('ARROW', 9, 0, -35.5, -Math.PI / 2, 1.8, [0.86, 0.84, 0.76]);
  motorPool(k, site, -38, -44.6, 0, 3, [true, true, false]);
  // The fuel point: two bowsers behind a sandbag berm, a pump island, drums, and a real fuel cache that goes up.
  fuelTank(k, -19.5, -46.6, 0);
  fuelTank(k, -19.5, -43.6, 0);
  site.sandbags(-23.4, -48.6, -22.7, -41.6, 1.3);
  site.sandbags(-22.7, -41.6, -15.6, -40.9, 1.3);
  drums(k, -16.4, -46.8, 5, [0.62, 0.22, 0.16]);
  board(k, -19.5, -40.5, 0, 'FUEL POINT');
  board(k, -23, -39.4, 0.3, 'NO SMOKING', 2.2, 1.3);
  spec.barrels(-15.6, 0, -38.6, 3, 0.9);
  // The mess tent, and the water tower in the corner.
  tent(k, site, 25, -40.5, 0, 12, 7);
  board(k, 25, -35.6, 0, 'MESS HALL');
  drums(k, 32, -38, 3, [0.4, 0.42, 0.32]);
  waterTower(k, site, 44, -41, Math.PI);
  k.mast(-44, -36.5, 0, 11, Math.PI * 0.8, 'white', 80, 28);
}

function outerEast(k: Kit, site: Site, spec: MapSpec): void {
  hut(k, site, 38.5, -31, -Math.PI / 2, 10, 5, 'pitched');
  hut(k, site, 38.5, -17, -Math.PI / 2, 10, 5, 'pitched');
  hut(k, site, 38.5, 17, -Math.PI / 2, 10, 5, 'flat');
  // Washing lines and duckboards between the huts: someone lives here.
  for (const [a, b] of [[-26, -22], [-12, -6]] as const) {
    cable(k, 36.4, 2.2, a, 36.4, 2.2, b, 0.3, 0.012);
    k.geo.use('plywood').tint(0.6).box(35, 0.03, (a + b) / 2, 0.5, 0.03, Math.abs(b - a) / 2, FACE.py | FACE.sides);
    k.geo.tint(1);
  }
  // The helipad, its windsock.
  helipad(k, 38, 0, 5);
  k.geo.use('steelDark').cyl(34, 0, -7.5, 34, 4.5, -7.5, 0.05, 0.04, 6, false, true);
  k.geo.use('paintRed').tint(0.9).cyl(34, 4.3, -7.5, 34.9, 4.2, -7.3, 0.22, 0.12, 8, true, true);
  k.geo.tint(1);
  spec.shack(35, 31, Math.PI / 2, 'sheet');
}

function helipad(k: Kit, x: number, z: number, r: number): void {
  const g = k.geo.use('concrete').tint(0.56);
  g.gridStep(x - r, 0.01, z + r, r * 2, 0, 0, 0, 0, -r * 2, 2);
  g.use('paintYellow').tint(0.8);
  for (const [cx, cz, hx, hz] of [[x - 1.5, z, 0.3, 2.2], [x + 1.5, z, 0.3, 2.2], [x, z, 1.2, 0.3], [x, z - r + 0.2, r, 0.12], [x, z + r - 0.2, r, 0.12], [x - r + 0.2, z, 0.12, r], [x + r - 0.2, z, 0.12, r]] as const) {
    g.box(cx, 0.015, cz, hx, 0.001, hz, FACE.py);
  }
  g.tint(1);
  for (const [cx, cz] of [[x - r, z - r], [x + r, z - r], [x - r, z + r], [x + r, z + r]] as const) {
    g.use('emissiveOrange').box(cx, 0.06, cz, 0.08, 0.05, 0.08, FACE.noBottom);
  }
}

function outerSouth(k: Kit, site: Site): void {
  // The road from the south gate to the middle ring's south gate.
  road(site, -3, 38, 3, 49);
  road(site, -17, 33, 3, 38);
  // HQ: a flat roof under dishes and a mast, a firing position over the south band.
  hut(k, site, 20, 38, Math.PI, 12, 6, 'flat', true);
  signPanel(k, 20, 2.3, 34.9, Math.PI, 1.8, 0.45, signId('HQ'), true);
  dish(k, 23, LEVEL.roof, 39.8, 3.6, 0.9);
  latticeMast(k, 25.3, 40.4, LEVEL.roof, 9, 0.5);
  k.geo.use('paintWhite').tint(0.7, 0.68, 0.6);
  // Parade ground: painted lines in front of HQ.
  for (let x = 12; x <= 28; x += 4) k.geo.box(x, 0.012, 32.9, 0.08, 0.001, 0.6, FACE.py);
  k.geo.tint(1);
  // A container stack to climb: two on the ground, one across them, stairs to the lower roof.
  container(k, 37, 0, 45.2, 0, [0.32, 0.4, 0.3]);
  container(k, 37, 0, 42.4, 0, [0.42, 0.34, 0.26]);
  container(k, 38, 2.6, 43.8, 0, [0.3, 0.36, 0.42]);
  site.stairs(26.4, 42.6, 0, 30.9, 42.6, 2.6, 1.4, 'steel', false);
  site.plan.blocks.push({ x0: 30.9, z0: 41.1, x1: 43.1, z1: 46.5 });
  k.mast(44, 33, 0, 11, -Math.PI * 0.8, 'white', 80, 28);
}

function outerWest(k: Kit, site: Site, spec: MapSpec): void {
  // The ammunition dump: three sandbag bays, a stack in each, a sign.
  for (const z of [-27, -21.5, -16]) {
    site.sandbags(-46.4, z - 2.4, -36, z - 1.8, 1.4);
    ammoStack(k, site, -41.5, z, 0);
  }
  site.sandbags(-46.4, -13.6, -36, -13, 1.4);
  board(k, -34.5, -24, Math.PI / 2, 'AMMO DUMP');
  board(k, -34.5, -17, Math.PI / 2, 'NO SMOKING', 2.2, 1.3);
  // Parked trucks, nose to the gate road, and a storage shed.
  armyTruck(k, -40, 18, 0, false);
  armyTruck(k, -40, 22.5, 0.05, false);
  tyres(k, -46, 15, 0, 2);
  drums(k, -46, 31, 4);
  spec.shack(-38, 33, 0.1, 'planks');
  k.mast(-36, 28, 0, 11, Math.PI * 0.25, 'white', 80, 28);
}

function middle(k: Kit, site: Site, spec: MapSpec): void {
  // The comms tower in the north-west, cables from it to the armoury and the core.
  commsTower(k, site, -24, -20, Math.PI / 2);
  cable(k, -24, 9.5, -18, -7, 3.4, -24, 2.5, 0.03);
  cable(k, -22.6, 9.5, -16.5, -14.4, 5.6, -10, 2, 0.03);
  board(k, -20.6, -17, Math.PI / 2, 'COMMS', 2, 1.4);
  // The vehicle bay in the east: two bays, a truck, a roof to fight from.
  motorPool(k, site, 22, 5.5, -Math.PI / 2, 2, [true, false]);
  // A barracks hut in the south band.
  hut(k, site, 0, 21.5, Math.PI, 12, 5, 'pitched');
  // Generators in the west, fuel drums, a lamp.
  machine(k, -24, 0, -4, Math.PI / 2, 3, 2, 2);
  machine(k, -24, 0, 1.5, Math.PI / 2, 3, 2, 2);
  drums(k, -20.5, -6.5, 4, [0.62, 0.22, 0.16]);
  cable(k, -22.8, 1.2, -4, -14.4, 4.2, -2, 1, 0.04);
  k.mast(26, 26, 0, 10, -Math.PI * 0.75, 'white', 70, 26);
  k.mast(-20, 5, 0, 10, Math.PI * 0.5, 'white', 70, 26);
  // Sandbag nests at the middle ring's inner corners.
  nest(k, site, -20, 15, Math.PI * 0.75);
  nest(k, site, 24, -5, -Math.PI / 2);
  spec.shack(-6, -18.6, 0, 'sheet');
}

function core(k: Kit, site: Site): void {
  dish(k, -4, 3.52, -9, 0.6, 0.7);
  nest(k, site, 6, 1, Math.PI / 2, 2.6, 2.2);
}

/** Floodlit, signposted, cluttered: the inside of the base. */
export function authorBase(k: Kit, spec: MapSpec): void {
  const site = new Site(k, spec);
  outerNorth(k, site, spec);
  outerEast(k, site, spec);
  outerSouth(k, site);
  outerWest(k, site, spec);
  middle(k, site, spec);
  core(k, site);
}
