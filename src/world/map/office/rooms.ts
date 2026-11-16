/**
 * What makes each room itself: its lights and ceiling, its furniture, its signs, and the props that break. Positions are world
 * coordinates; a prop's `yaw` turns its front (local +z) from south (0) through east (pi / 2).
 */
import { FACE } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import type { MapSpec } from '../spec';
import { Builder } from './build';
import { acUnit, cabinets, ceiling, clock, counter, panel, pod, reception, roundTable, shelves, sign, sofa, table, tall, turnstile } from './props';
import { CEIL, LV, ROOMS, type Room } from './plan';

const N = 0, S = Math.PI, E = Math.PI / 2, W = -Math.PI / 2;
const NO_CEILING = /stair|lift|server/;

/** The room's lamps: a grid well clear of the walls, so nothing burns a hot spot into the drywall. */
export function lampsOf(r: Room): [number, number][] {
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  const nx = Math.max(1, Math.round(w / 8)), nz = Math.max(1, Math.round(d / 8));
  const out: [number, number][] = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) out.push([r.x0 + (w * (i + 0.5)) / nx, r.z0 + (d * (j + 0.5)) / nz]);
  return out;
}

function lights(b: Builder): void {
  for (const r of ROOMS) {
    const ceil = r.floor === 'g' ? CEIL.g : CEIL.f2;
    if (r.lux <= 0) continue;
    const lamps = lampsOf(r);
    for (const [x, z] of lamps) {
      b.k.light(x, ceil - 1, z, r.light, r.lux, Math.max(9, Math.min(15, Math.max((r.x1 - r.x0) / Math.max(1, Math.round((r.x1 - r.x0) / 8)), (r.z1 - r.z0) / Math.max(1, Math.round((r.z1 - r.z0) / 8))) * 1.3)));
    }
    if (!NO_CEILING.test(r.id)) ceiling(b, r.x0 + 0.15, r.z0 + 0.15, r.x1 - 0.15, r.z1 - 0.15, ceil, lamps);
    else if (!/server/.test(r.id)) for (const [x, z] of lamps) b.k.lampBar(x, ceil - 0.2, z, 0, 1.2, 'white', 0, 0);
  }
}

// -------------------------------------------------------------------------------------------------
// Ground floor
// -------------------------------------------------------------------------------------------------

function server(b: Builder, s: MapSpec): void {
  // Two rows of racks, fronts out, aisles between; the dark fight of the map, lit by the racks themselves.
  for (let x = -26.6; x <= -17.4; x += 0.82) {
    s.breakable('rack', x, 0, -14.5, S);
    s.breakable('rack', x, 0, -10, N);
  }
  const g = b.g;
  // Cable trays over the rows.
  g.use('grate').tint(0.6);
  for (const z of [-14.5, -10]) g.box(-22, 3.3, z, 5, 0.04, 0.3, FACE.py | FACE.ny);
  g.use('emissiveCyan').tint(0.5);
  for (const z of [-15.3, -13.7, -10.8, -9.2]) g.box(-22, 3.95, z, 4.6, 0.01, 0.02, FACE.ny);
  g.tint(1);
  b.k.light(-22, 2.4, -12.2, 0x2f8dff, 22, 10);
  b.k.light(-15.8, 2.6, -8, 0x2f8dff, 14, 8);
  b.k.light(-22, 2.4, -16.4, 0xff2a24, 8, 6);
  s.breakable('extinguisher', -14.35, 1, -8.2, W);
  sign(b, -18, 3.25, -5.8, N, 'SERVER ROOM', 1.6);
}

function copy(b: Builder, s: MapSpec, y: number, room: 'COPY ROOM' | 'PRINT ROOM'): void {
  s.breakable('copier', -12.6, y, -17.1, N);
  s.breakable('copier', -5.6, y, -17.1, N);
  if (y > 0) s.breakable('copier', -12.6, y, -8.8, E);
  shelves(b, -4.2, y, -12, W, 3, 2.1);
  table(b, -8.5, y, -11.5, E, 2.4, 1);
  for (const [x, z] of [[-6.6, -7.2], [-13.4, -7.2]] as const) b.box('plaster', [0.2, 0.36, 0.6], x - 0.3, y, z - 0.3, x + 0.3, y + 0.7, z + 0.3, 0.03);
  s.breakable('extinguisher', -4.35, y + 1, -7.4, W);
  sign(b, -9, y + 3.25, -5.8, N, room, 1.6);
  panel(b, -9, y + 1.8, -17.68, N, 2, 1.1, [0.95, 0.95, 0.92]);
}

function supply(b: Builder): void {
  for (let z = -16.6; z <= -8.2; z += 2.1) shelves(b, 6.2, 0, z, E, 2, 2.4, 0.5);
  for (let z = -16.6; z <= -8.2; z += 2.1) shelves(b, 13.8, 0, z, W, 2, 2.4, 0.5);
  sign(b, 10, 3.25, -5.8, N, 'SUPPLY', 1.2);
}

function corridor(b: Builder, s: MapSpec, y: number): void {
  for (const x of [-25, -12.5, 7]) s.breakable('extinguisher', x, y + 1, -5.78, S);
  s.breakable('cooler', -13, y, -2.5, S);
  s.breakable('plant', -27.3, y, -5.3, N);
  for (const x of [-15, 2]) panel(b, x, y + 1.7, -2.18, S, 1.6, 1, [0.86, 0.9, 0.95]);
  sign(b, -1, y + 3.25, -5.8, N, 'STAIRS', 1.2);
  sign(b, 4, y + 3.35, -5.8, N, 'THE LIFT IS UNDER REVIEW', 2.4);
  sign(b, -6, y + 2.6, -2.18, S, y > 0 ? 'MORALE IS MONITORED' : 'COMPLIANCE IS MANDATORY', 2.2);
  clock(b, 8, y + 3, -5.8, N);
}

function lift(b: Builder, y: number): void {
  // Brushed doors parked open, and tape across the gap.
  for (const s of [-1, 1]) b.deco('steel', [0.72, 0.74, 0.78], 4 + s * 1.5 - 0.3, y, -13.84, 4 + s * 1.5 + 0.3, y + 2.8, -13.8, 0.01);
  b.g.use('hazard').tint(1);
  for (const h of [0.9, 1.5]) b.g.box(4, y + h, -13.7, 1.2, 0.04, 0.005, FACE.pz | FACE.nz);
  b.g.tint(1);
}

function breakRoom(b: Builder, s: MapSpec): void {
  counter(b, -25, 0, -1.82, N, 5.2);
  counter(b, -17, 0, -1.82, N, 5.2, false);
  s.breakable('microwave', -26.4, 0.92, -1.5, N);
  s.breakable('microwave', -16, 0.92, -1.5, N);
  tall(b, -14.6, 0, 0.6, W, 0.9, 2, [0.86, 0.86, 0.84]);
  s.breakable('vending', -14.62, 0, 6.6, W);
  s.breakable('vending', -14.62, 0, 9.4, W);
  s.breakable('cooler', -26.8, 0, 17.3, S);
  for (const [x, z] of [[-23.5, 5], [-18.5, 5], [-23.5, 12], [-18.5, 12]] as const) {
    roundTable(b, x, 0, z);
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + b.k.rand(0, 0.5);
      s.breakable('chair', x + Math.sin(a) * 0.9, 0, z + Math.cos(a) * 0.9, a + Math.PI);
    }
  }
  sofa(b, -27.68, 0, 14.5, E, 2.4, [0.6, 0.3, 0.2]);
  counter(b, -21, 0, 8.05, N, 4.6, false, false);
  for (const x of [-22.6, -21, -19.4]) s.breakable('chair', x, 0, 9.4, S);
  s.breakable('plant', -15, 0, 17, N);
  s.breakable('plant', -27.1, 0, 11, N);
  sign(b, -21, 2.8, -1.85, N, 'BREAK ROOM', 1.6);
  sign(b, -21, 3.25, -2.18, S, 'BREAK ROOM', 1.6);
  panel(b, -14.18, 2.4, 13, W, 1.6, 0.9, [0.08, 0.1, 0.12]);
  b.g.use('emissiveCyan').tint(0.4).box(-14.21, 2.4, 13, 0.004, 0.4, 0.74, FACE.nx);
  b.g.tint(1);
  s.breakable('extinguisher', -14.35, 1, 1.4, W);
}

function records(b: Builder, s: MapSpec): void {
  cabinets(b, -12, 0, -1.82, N, 5);
  cabinets(b, -6, 0, -1.82, N, 4);
  for (const x of [-12.5, -9, -5.5]) shelves(b, x, 0, 7.82, S, 2.6, 2.2);
  table(b, -9, 0, 3, N, 2.2, 1);
  s.breakable('chair', -9.6, 0, 3.9, S);
  s.breakable('monitor', -9, 0.77, 2.8, N);
  sign(b, -9, 3.25, -2.18, S, 'RECORDS', 1.4);
}

function waiting(b: Builder, s: MapSpec): void {
  for (const z of [10.6, 15.8]) for (let x = -12.6; x <= -5.4; x += 0.8) s.breakable('chair', x, 0, z, S + b.k.rand(-0.08, 0.08));
  sign(b, -9, 2.9, 8.18, S, 'NOW SERVING 0000', 2.6);
  sign(b, -9, 2.2, 8.18, S, 'PLEASE TAKE A NUMBER', 2.2);
  s.breakable('plant', -13.3, 0, 17.3, N);
  s.breakable('plant', -4.7, 0, 8.8, N);
  table(b, -9, 0, 13.2, N, 1.6, 0.6, [0.3, 0.3, 0.32]);
}

function lobby(b: Builder, s: MapSpec): void {
  reception(b, 5, 0, 5, N, 6);
  for (const x of [3.2, 5, 6.8]) { s.breakable('monitor', x, 0.78, 4.3, S); s.breakable('chair', x, 0, 3.4, N); }
  sign(b, 5, 3.3, 6.2, N, 'RECEPTION', 2.4);
  sign(b, 5, 3.3, 6.1, S, 'NOW SERVING 0000', 2.4);
  for (const x of [-1.5, 1, 9, 11.5]) turnstile(b, x, 0, 1, E);
  for (const x of [0, 10]) {
    b.box('plaster', [0.72, 0.74, 0.78], x - 0.45, 0, 11.55, x + 0.45, CEIL.g, 12.45, 0.04);
    b.deco('emissiveCyan', [1, 1, 1], x - 0.46, 2.6, 11.54, x + 0.46, 2.65, 12.46, 0);
    s.breakable('extinguisher', x, 1, 12.47, N);
    b.block(x - 0.45, 11.55, x + 0.45, 12.45);
  }
  sofa(b, -3.8, 0, 8, E, 2.6, [0.2, 0.36, 0.42]);
  sofa(b, 13.8, 0, 10, W, 2.6, [0.2, 0.36, 0.42]);
  for (const [x, z] of [[-3.3, 17.3], [13.3, 17.3], [-3.3, -1.3], [13.3, -1.3]] as const) s.breakable('plant', x, 0, z, N);
  sign(b, 13.8, 3.1, 1.6, W, 'SOCIETAL COMPLIANCE', 3.6);
  sign(b, -3.8, 3.1, 10.5, E, 'THANK YOU FOR YOUR COMPLIANCE', 3.6);
  sign(b, 5, 3.6, 17.7, S, 'REGIONAL OFFICE 9', 3.2);
  s.breakable('cooler', 13.4, 0, 3.2, W);
}

function cubicles(b: Builder, s: MapSpec): void {
  for (const x of [18, 24.2]) for (const z of [-12.5, 2.5, 12]) pod(b, x, 0, z);
  s.breakable('copier', 24, 0, -4.6, E);
  cabinets(b, 18, 0, -17.68, N, 6);
  cabinets(b, 24.5, 0, -17.68, N, 5);
  s.breakable('cooler', 27.3, 0, 4.6, W);
  for (const [x, z] of [[14.8, -17.2], [27.2, 17.2], [14.8, 17.2]] as const) s.breakable('plant', x, 0, z, N);
  panel(b, 14.18, 1.8, -12, E, 2.4, 1.2, [0.95, 0.95, 0.93]);
  sign(b, 21, 3.25, 17.78, N, 'EXIT', 1);
  for (const z of [-10, 8]) sign(b, 27.78, 3.25, z, W, 'CAR PARK', 1.2);
  s.breakable('extinguisher', 27.65, 1, -6.5, W);
}

// -------------------------------------------------------------------------------------------------
// First floor
// -------------------------------------------------------------------------------------------------

function director(b: Builder, s: MapSpec): void {
  const y = LV.f2;
  b.finish('carpet', [0.5, 0.36, 0.22], { x0: -24, z0: -15.5, x1: -18, z1: -10.5 }, y + 0.012);
  table(b, -21, y, -13.4, N, 2.6, 1.1, [0.36, 0.22, 0.14]);
  s.breakable('monitor', -21.4, y + 0.77, -13.6, S);
  s.breakable('chair', -21, y, -14.5, N);
  for (const x of [-22, -20]) s.breakable('chair', x, y, -12, S);
  for (const x of [-25.6, -23.4, -18.6, -16.4]) shelves(b, x, y, -17.68, N, 2.1, 2.4);
  sofa(b, -14.4, y, -11, W, 2.6, [0.3, 0.12, 0.12]);
  for (const [x, z] of [[-27.2, -7], [-15, -17], [-27.2, -16.8]] as const) s.breakable('plant', x, y, z, N);
  sign(b, -18, y + 3.25, -5.8, N, 'DIRECTOR', 1.4);
  panel(b, -14.18, y + 2, -15, W, 1.2, 1.6, [0.4, 0.1, 0.12]);
  clock(b, -21, y + 3, -17.7, N);
}

function it(b: Builder, s: MapSpec): void {
  const y = LV.f2;
  for (let z = -17; z <= -8.8; z += 0.82) s.breakable('rack', 6.95, y, z, E);
  table(b, 13.3, y, -11, W, 4, 0.9, [0.4, 0.42, 0.46]);
  for (const z of [-12.2, -10.6, -9.4]) s.breakable('monitor', 13.5, y + 0.77, z, W);
  for (const z of [-12, -10]) s.breakable('chair', 12.3, y, z, E);
  sign(b, 10, y + 3.25, -5.8, N, 'IT', 0.8);
  sign(b, 12, y + 3, -17.7, N, 'FIRE ESCAPE', 1.6);
}

function exec(b: Builder, s: MapSpec): void {
  const y = LV.f2;
  table(b, -21, y, 3.6, N, 2.2, 1, [0.4, 0.26, 0.16]);
  s.breakable('monitor', -21, y + 0.77, 3.4, S);
  s.breakable('chair', -21, y, 2.5, N);
  s.breakable('chair', -21.5, y, 5, S);
  for (const x of [-25.5, -16.5]) shelves(b, x, y, 7.82, S, 2.6, 2.2);
  sofa(b, -14.4, y, 0.2, W, 2, [0.28, 0.24, 0.2]);
  s.breakable('plant', -27.2, y, -1.2, N);
  sign(b, -21, y + 3.25, -2.18, S, 'EXECUTIVE SUITE', 2);
  // The second office through the suite door.
  table(b, -20, y, 14.4, S, 2.2, 1, [0.4, 0.26, 0.16]);
  s.breakable('monitor', -20, y + 0.77, 14.6, N);
  s.breakable('chair', -20, y, 15.5, S);
  sofa(b, -16.8, y, 8.18, N, 2.4, [0.2, 0.2, 0.24]);
  for (const [x, z] of [[-27.2, 17.2], [-14.8, 17.2]] as const) s.breakable('plant', x, y, z, N);
  s.breakable('extinguisher', -14.35, y + 1, 10.2, W);
}

function meeting(b: Builder, s: MapSpec, z: number, name: 'MEETING A' | 'MEETING B'): void {
  const y = LV.f2;
  table(b, -9, y, z, N, 4.4, 1.4, [0.82, 0.82, 0.8]);
  for (const x of [-10.6, -9, -7.4]) for (const side of [-1, 1]) s.breakable('chair', x, y, z + side * 1.15, side > 0 ? S : N);
  panel(b, -13.82, y + 1.8, z, E, 2.4, 1.3, [0.04, 0.05, 0.07]);
  b.g.use('emissiveCyan').tint(0.25).box(-13.78, y + 1.8, z, 0.004, 0.6, 1.15, FACE.px);
  b.g.tint(1);
  s.breakable('plant', -4.8, y, z + (z < 8 ? -4.2 : 4.2), N);
  sign(b, -3.8, y + 2.7, z - 1.4, E, name, 1.4);
}

function openOffice(b: Builder, s: MapSpec): void {
  const y = LV.f2;
  for (const x of [1, 8, 15, 22]) for (const z of [3.5, 12.5]) pod(b, x, y, z);
  pod(b, 20.5, y, -10);
  s.breakable('copier', 25.6, y, -4.6, W);
  s.breakable('copier', -3.2, y, 8, E);
  s.breakable('cooler', 27.3, y, 0.5, W);
  s.breakable('cooler', 14.6, y, -16.8, E);
  for (const [x, z] of [[27.2, 17.2], [-3.2, 17.2], [27.2, -17.2], [11.5, -2.7], [14.6, -3]] as const) s.breakable('plant', x, y, z, N);
  for (const x of [5, 18.5]) s.breakable('extinguisher', x, y + 1, -5.78, S);
  sign(b, 11, y + 3.3, 8, N, 'OPEN OFFICE', 2);
  sign(b, 11, y + 3.3, 8.02, S, 'FILE IN TRIPLICATE', 2.2);
  sign(b, 27.78, y + 2.9, -10, W, 'CAR PARK', 1.2);
  sign(b, 18, y + 3.3, -14.4, S, 'ROOF', 1);
  sign(b, 20, y + 2.6, 17.7, S, 'SMILE: YOU ARE BEING AUDITED', 2.6);
  sign(b, -3.78, y + 2.9, -1.2, E, 'BREAKAGES ARE ITEMISED', 2.4);
  clock(b, 2, y + 3, -5.78, S);
}

// -------------------------------------------------------------------------------------------------
// Roof
// -------------------------------------------------------------------------------------------------

function roof(b: Builder, s: MapSpec): void {
  const y = LV.roof;
  // AC units: ledges and cover. The one under the tower's gondola is the first step up to it.
  acUnit(b, -17, y, -4.4, N);
  for (const [x, z, yaw] of [[-2, 12, N], [12, 13, N], [24, 4, E], [-22, 8, E], [-10, 2, N]] as const) acUnit(b, x, y, z, yaw);
  for (const [x, z, w, d] of [[-17, -4.4, 2.2, 1.8], [-2, 12, 2.2, 1.8], [12, 13, 2.2, 1.8], [24, 4, 1.8, 2.2], [-22, 8, 1.8, 2.2], [-10, 2, 2.2, 1.8]] as const) {
    b.block(x - w / 2, z - d / 2, x + w / 2, z + d / 2);
  }
  // Vents and a run of duct.
  const g = b.g;
  for (const [x, z] of [[2, 2], [10, -2], [-4, -2], [22, 14], [-24, 14]] as const) {
    g.use('steel').tint(0.62).cyl(x, y, z, x, y + 1.1, z, 0.3, 0.3, 10);
    g.use('steelDark').tint(0.5).cyl(x, y + 1.1, z, x, y + 1.35, z, 0.45, 0.2, 10);
  }
  g.tint(1);
  b.k.beam(-12, y + 0.5, 2, 4, y + 0.5, 2, 0.35, 0.3, 'steel', false);
  b.box('steel', [0.6, 0.62, 0.66], -12, y, 1.65, 4, y + 0.8, 2.35, 0.04);
  // A dish and a mast with a red light on the lift's machine room.
  g.use('steelDark').cyl(4, 12.3, -16, 4, 15.5, -16, 0.06, 0.04, 6);
  g.use('emissiveRed').box(4, 15.6, -16, 0.08, 0.08, 0.08);
  g.use('paintWhite').tint(0.8).lathe([0, 0, 0.9, 0.25, 1.05, 0.4], 26, y + 1.2, 14, 16, true);
  g.use('steelDark').cyl(26, y, 14, 26, y + 1.2, 14, 0.08, 0.08, 6);
  g.tint(1);
  sign(b, 4, LIFT_DOOR_Y, -13.8, N, 'THE LIFT IS UNDER REVIEW', 2.4);
  s.breakable('gasline', 25, y, 17.4, S);
  s.breakable('gasline', 22, y, 17.4, S);
}
const LIFT_DOOR_Y = LV.roof + 2.9;

// -------------------------------------------------------------------------------------------------
// Outside: the props that break
// -------------------------------------------------------------------------------------------------

function outsideBreakables(s: MapSpec): void {
  // The generator in its pen, beside the fuel tank.
  s.breakable('generator', -41, 0.25, -10, E);
  // The gas line up the yard face of the building and along the alley: valves that set each other off.
  for (const z of [-15, -9, -3, 3]) s.breakable('gasline', -28.4, 0, z, W);
  for (const x of [-14, -6, 18, 24]) s.breakable('gasline', x, 0, -18.4, S);
  // A vending machine and planters by the plaza doors.
  s.breakable('vending', 27, 0, 19, S);
  for (const [x, z] of [[-1.5, 19.6], [11.5, 19.6]] as const) s.breakable('plant', x, 0, z, N);
}

export function authorRooms(k: Kit, spec: MapSpec): void {
  const b = new Builder(k, spec);
  lights(b);
  server(b, spec);
  copy(b, spec, 0, 'COPY ROOM');
  copy(b, spec, LV.f2, 'PRINT ROOM');
  supply(b);
  corridor(b, spec, 0);
  corridor(b, spec, LV.f2);
  lift(b, 0);
  lift(b, LV.f2);
  breakRoom(b, spec);
  records(b, spec);
  waiting(b, spec);
  lobby(b, spec);
  cubicles(b, spec);
  director(b, spec);
  it(b, spec);
  exec(b, spec);
  meeting(b, spec, 3, 'MEETING A');
  meeting(b, spec, 13, 'MEETING B');
  openOffice(b, spec);
  roof(b, spec);
  outsideBreakables(spec);
}
