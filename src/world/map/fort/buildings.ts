/**
 * The shops, one a ring, and what stands round them. Each is a plain box of walls with one doorway, a counter along the back wall and
 * a lit sign over the door, so it reads from across its ring. Every wall is a block whose collider is what you see.
 */
import { FACE, type Mat } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { signPanel, wallLamp } from '../../kit/props';
import { signId } from '../../kit/signs';
import { Site } from '../outpost/site';
import type { MapSpec } from '../spec';
import { type BuildingDef, BUILDINGS, COUNTER, MAGAZINE, ring, type Rgb, SHOP_WALL } from './plan';

const T = SHOP_WALL;

interface Look { wall: Mat; tint: Rgb; roof: Mat; counter: Mat }

const LOOKS: Record<BuildingDef['id'], Look> = {
  barracks: { wall: 'panel', tint: [0.42, 0.47, 0.33], roof: 'rust', counter: 'plywood' },
  armoury: { wall: 'concrete', tint: [0.7, 0.72, 0.76], roof: 'concreteDark', counter: 'steel' },
  infirmary: { wall: 'paintWhite', tint: [0.78, 0.8, 0.8], roof: 'steel', counter: 'paintWhite' },
};

function building(k: Kit, site: Site, b: BuildingDef): void {
  const g = k.geo, look = LOOKS[b.id], paint = ring(b.ring).paint;
  const { x0, z0, x1, z1, h, door } = b;
  const north = door.face === 'n';
  const d0 = door.x - door.w / 2, d1 = door.x + door.w / 2;
  const wall = (a: number, y0: number, c: number, e: number, y1: number, f: number) => {
    g.tint(look.tint[0], look.tint[1], look.tint[2]);
    k.block(look.wall, a, y0, c, e, y1, f, 0.03);
    g.tint(1);
  };
  // The door's face in three pieces, the back wall and the two ends.
  const fz0 = north ? z0 : z1 - T, fz1 = north ? z0 + T : z1;
  wall(x0, 0, fz0, d0, h, fz1);
  wall(d1, 0, fz0, x1, h, fz1);
  wall(d0, door.h, fz0, d1, h, fz1);
  wall(x0, 0, north ? z1 - T : z0, x1, h, north ? z1 : z0 + T);
  wall(x0, 0, z0 + T, x0 + T, h, z1 - T);
  wall(x1 - T, 0, z0 + T, x1, h, z1 - T);
  g.use(look.roof).tint(0.85);
  k.block(look.roof, x0 - 0.3, h, z0 - 0.3, x1 + 0.3, h + 0.22, z1 + 0.3, 0.04);
  g.tint(1);
  site.paintFloor('concrete', { x0: x0 + T, z0: z0 + T, x1: x1 - T, z1: z1 - T }, 0.01, [0.62, 0.62, 0.6]);
  site.plan.blocks.push({ x0, z0, x1, z1 });
  site.plan.doors.push({ x: door.x, z: north ? z0 + T / 2 : z1 - T / 2, dx: 0, dz: north ? 1 : -1, w: door.w });

  // A band in the ring's colour all the way round, and the door's jambs in it.
  const out = 0.012;
  g.use('paintWhite').tint(paint[0], paint[1], paint[2]);
  g.box((x0 + x1) / 2, h - 0.45, z0 - out, (x1 - x0) / 2, 0.14, out, FACE.nz);
  g.box((x0 + x1) / 2, h - 0.45, z1 + out, (x1 - x0) / 2, 0.14, out, FACE.pz);
  g.box(x0 - out, h - 0.45, (z0 + z1) / 2, out, 0.14, (z1 - z0) / 2, FACE.nx);
  g.box(x1 + out, h - 0.45, (z0 + z1) / 2, out, 0.14, (z1 - z0) / 2, FACE.px);
  const face = north ? z0 : z1;
  g.box(d0 - 0.001, door.h / 2, (fz0 + fz1) / 2, 0.001, door.h / 2, T / 2, FACE.px);
  g.box(d1 + 0.001, door.h / 2, (fz0 + fz1) / 2, 0.001, door.h / 2, T / 2, FACE.nx);
  g.tint(1);

  // Shelves of stock on the back wall, the keeper's floor, then the counter across the room. Its right end stops short of the wall:
  // the keeper's way in, with a hinged flap over it.
  const back = north ? z1 - T : z0 + T, dir = north ? -1 : 1;
  const cw = Math.min(2.6, (x1 - x0) / 2 - 1.2);
  const [c0, c1] = COUNTER.counter;
  const flapAt = door.x + cw + 0.45;
  k.block(look.counter, door.x - cw, 0, Math.min(back + dir * c0, back + dir * c1), door.x + cw, 1.05, Math.max(back + dir * c0, back + dir * c1), 0.03);
  g.use('steelDark').bevel(door.x, 1.07, back + dir * (c0 + c1) / 2, cw + 0.05, 0.02, (c1 - c0) / 2 + 0.06, 0.01);
  g.use('plywood').tint(0.7).box(flapAt, 1.06, back + dir * (c0 + c1) / 2, 0.42, 0.02, (c1 - c0) / 2, FACE.py | FACE.ny | FACE.sides);
  g.tint(1);
  // Under the flap, the gap a keeper walks through: nothing there for a buyer to stand on but the floor.
  g.use('steelDark');
  const sw = Math.min(cw + 0.8, (x1 - x0) / 2 - T - 0.1);
  for (const y of [0.6, 1.3, 1.95]) g.bevel(door.x, y, back + dir * 0.2, sw, 0.02, 0.2, 0.01);
  for (let i = 0; i < 12; i++) {
    const s = 0.12 + k.rng() * 0.12, row = i % 3;
    g.use(i % 3 ? 'panel' : 'paintYellow').tint(0.5 + k.rng() * 0.3);
    g.bevel(door.x - sw + 0.3 + Math.floor(i / 3) * ((sw * 2 - 0.6) / 3), [0.6, 1.3, 1.95][row]! + s + 0.02, back + dir * 0.2, s * 1.2, s, 0.14, 0.02);
  }
  g.tint(1);
  // A till on the counter and a lamp over the keeper.
  g.use('steelDark').bevel(door.x - cw + 0.6, 1.22, back + dir * (c0 + 0.2), 0.22, 0.14, 0.16, 0.03);
  g.use('emissiveCyan').box(door.x - cw + 0.6, 1.3, back + dir * (c0 + 0.03), 0.16, 0.05, 0.005, north ? FACE.nz : FACE.pz);
  k.lampBar(door.x, h - 0.15, (z0 + z1) / 2, 0, Math.min(4, x1 - x0 - 2), 'white', 0, 0);
  k.light(door.x, h - 0.9, (z0 + z1) / 2, 'white', 30, 8);
  // Over the keeper and his shelves, so whoever stands there is lit.
  k.light(door.x, h - 0.7, back + dir * 0.9, 'white', 18, 5);

  // The sign over the door, lit, and a lamp on the wall beside it.
  const yaw = north ? Math.PI : 0;
  signPanel(k, door.x, door.h + 0.55, face + (north ? -0.1 : 0.1), yaw, Math.max(door.w + 0.6, 3.2), 0.8, signId(b.sign), true);
  wallLamp(k, d1 + 0.7, door.h + 0.2, face + (north ? -0.02 : 0.02), yaw, 'white', 20, 10);
  k.light(door.x, door.h + 0.4, face + (north ? -1.6 : 1.6), 'white', 18, 9);
}

/** A red cross on the infirmary's roof and its door face, so the core's shop reads from the walls. */
function redCross(k: Kit, b: BuildingDef): void {
  const g = k.geo.use('paintRed');
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, y = b.h + 0.23;
  g.box(cx, y, cz, 1.6, 0.004, 0.5, FACE.py);
  g.box(cx, y, cz, 0.5, 0.004, 1.6, FACE.py);
  const face = b.door.face === 'n' ? b.z0 - 0.013 : b.z1 + 0.013, fx = b.door.x + b.door.w / 2 + 1.6, fy = 1.6;
  const faces = b.door.face === 'n' ? FACE.nz : FACE.pz;
  g.use('paintWhite').tint(0.95).box(fx, fy, face, 0.75, 0.75, 0.001, faces);
  g.tint(1).use('paintRed');
  g.box(fx, fy, face + (b.door.face === 'n' ? -0.002 : 0.002), 0.55, 0.17, 0.001, faces);
  g.box(fx, fy, face + (b.door.face === 'n' ? -0.002 : 0.002), 0.17, 0.55, 0.001, faces);
}

/** The core's ammunition: a sandbagged bunker in its south-east corner, crates outside its door. */
function magazine(k: Kit, site: Site): void {
  const { x0, z0, x1, z1, h } = MAGAZINE;
  const g = k.geo;
  g.tint(0.62, 0.62, 0.6);
  k.block('concrete', x0, 0, z0, x1, h, z1, 0.06);
  g.tint(1);
  site.plan.blocks.push({ x0, z0, x1, z1 });
  // Sandbags banked on the two faces that look into the core, the roof under more bags and a steel door.
  site.sandbags(x0 - 0.7, z0 + 0.6, x0, z1, 1.4);
  site.sandbags(x0 + 1.9, z0 - 0.7, x1, z0, 1.4);
  g.use('paintWhite').tint(0.46, 0.42, 0.32);
  g.slab((x0 + x1) / 2, h + 0.15, (z0 + z1) / 2, (x1 - x0) / 2 - 0.2, 0.15, (z1 - z0) / 2 - 0.2, 0.6, FACE.py | FACE.sides);
  g.tint(1).use('steelDark');
  g.bevel(x0 + 1.0, 1.05, z0 - 0.03, 0.62, 1.05, 0.03, 0.02);
  g.use('hazard').box(x0 + 1.0, 2.14, z0 - 0.065, 0.7, 0.06, 0.005, FACE.nz);
  signPanel(k, x0 + 3.4, 1.7, z0 - 0.08, Math.PI, 2.4, 0.6, signId('MAGAZINE'), true);
  for (const [cx, cz] of [[x0 - 2.2, z0 - 1.6], [x0 - 2.2, z0 - 2.6], [x0 - 1.0, z0 - 2.6]] as const) {
    site.crate(cx - 0.45, cz - 0.4, cx + 0.45, cz + 0.4, 0.7, [0.44, 0.48, 0.32]);
  }
  k.light(x0 - 1.2, 2.6, z0 - 1.2, 'white', 16, 8);
}

/** Floodlight masts, the flag and the core's pad: what makes the fort read from the field. */
function grounds(k: Kit, site: Site): void {
  site.paintFloor('concrete', { x0: -10.6, z0: -10.6, x1: 10.6, z1: 10.6 }, 0.006, [0.56, 0.56, 0.55], 2.4);
  k.mast(4.5, -4.5, 0, 14, Math.PI * 0.75, 'white', 120, 34);
  k.mast(-24, 24, 0, 12, -Math.PI / 4, 'white', 90, 30);
  k.mast(24, -24, 0, 12, Math.PI * 0.75, 'white', 90, 30);
  // A flag in the core, high enough to see from the fence.
  const g = k.geo;
  g.use('steel').cyl(-6, 0, 3, -6, 13, 3, 0.09, 0.07, 8, false, true);
  g.use('concreteDark').bevel(-6, 0.2, 3, 0.5, 0.2, 0.5, 0.05);
  k.collide(-6, 6.5, 3, 0.12, 6.5, 0.12, 'metal', false);
  g.use('paintRed').tint(0.7).box(-4.75, 12.2, 3, 1.15, 0.7, 0.02, FACE.pz | FACE.nz);
  g.tint(1);
}

export function authorBuildings(k: Kit, spec: MapSpec): void {
  const site = new Site(k, spec);
  for (const b of BUILDINGS) building(k, site, b);
  redCross(k, BUILDINGS.find(b => b.id === 'infirmary')!);
  magazine(k, site);
  grounds(k, site);
}
