/**
 * What makes each room itself, in the order the raid reaches it. Cover is flush against a wall or at least 3 m clear of everything,
 * because a gap in between is a nook that catches a body. Each piece is one or two box colliders, and every detail inside it has none.
 */
import { FACE, type Mat } from '../../kit/geo';
import { cable, machine, pipe, signPanel } from '../../kit/props';
import { signId } from '../../kit/signs';
import { DOORS } from '../../../campaign/missions/outpost.places';
import {
  ARMOURY, BUNKS, EAST_CORRIDOR, GUARD, KITCHEN, KITCHEN_STAIR, MESS, NORTH_CORRIDOR, PLATE, rect, type Rgb, SALLY, SKIN, SOUTH_CORRIDOR,
} from './plan';
import type { Site } from './site';

const DARK: Rgb = [0.24, 0.26, 0.3];

/** Red lamp and a hazard band over a door that the Commander works himself, so a shut one reads as shut and not as a wall. */
function doorHead(s: Site, x: number, y: number, z: number, yaw: number, w: number): void {
  const k = s.k, g = k.geo;
  k.push(x, y, z, yaw);
  g.use('hazard').box(0, 0.2, 0, w / 2 + 0.2, 0.16, 0.006, FACE.pz);
  g.use('emissiveRed').box(0, 0.5, 0, 0.3, 0.06, 0.012, FACE.pz);
  k.pop();
}

function sally(s: Site): void {
  const r = SALLY;
  s.dressRoom(r);
  s.frameFloor(r, 0, 0.6, 0.16, r.paint);
  const d = DOORS;
  doorHead(s, d.sallyWest!.at[0] + SKIN, 3, d.sallyWest!.at[2], Math.PI / 2, 3);
  doorHead(s, 10 - SKIN, 3, d.sallyEast!.at[2], -Math.PI / 2, 3);
  // The north door never opens. It only has to look like the way you want to go.
  const g = s.k.geo;
  g.use('steelDark').tint(0.7).box(0, 1.6, -26 + SKIN - 0.01, 2, 1.6, 0.012, FACE.pz);
  g.tint(1);
  doorHead(s, 0, 3.2, -26 + SKIN, 0, 4);
  s.words('NO ENTRY', 0, 1.7, -26 + SKIN + 0.004, 0.8, 1, [0.84, 0.18, 0.14]);
  s.words('SALLY', -6.4, 3.3, -26 + SKIN, 1, 1, r.paint);
  s.crate(-9.4, -25.9, -6.8, -24.2, 1.3, [0.5, 0.48, 0.34]);
  s.crate(6.8, -25.9, 9.4, -24.2, 1.3, [0.5, 0.48, 0.34]);
  s.sandbags(-4.2, -20.4, 4.2, -19.6, 1.1);
  for (const x of [-5.6, 5.6]) s.bar(x, r.ceil, -20, Math.PI / 2, 4, 'white', 22, 12);
  s.lamp(-8.5, 3.2, -14 - SKIN, Math.PI, 'red', 8, 7);
  s.lamp(8.5, 3.2, -14 - SKIN, Math.PI, 'red', 8, 7);
  s.spec.pickup(-7, 0.3, -17);
}

/** A straight line with a gun at the end of it. The sandbags are the first thing you see and the last thing you want to walk at. */
function southCorridor(s: Site): void {
  const r = SOUTH_CORRIDOR;
  s.dressRoom(r);
  s.line(r.x0, -17.56, r.x1, -17.44, r.paint, 0.012);
  for (let x = -50; x < -12; x += 8.4) s.bar(x, r.ceil, -17.5, 0, 2.4, 'white', 9, 7);
  // Half the corridor, so the gunner can get out of the nest and everybody else can get in.
  s.sandbags(-52.6, -19 + SKIN, -51.8, -17.7, 1.15);
  s.lamp(-55.9, 2.4, -17.5, -Math.PI / 2, 'red', 9, 8);
  pipe(s.k, [-56, 2.95, -18.7, -12, 2.95, -18.7], 0.08, 'steelDark', 6, 6);
  pipe(s.k, [-56, 2.8, -18.7, -12, 2.8, -18.7], 0.05, 'steel', 9, 6);
}

function northCorridor(s: Site): void {
  const r = NORTH_CORRIDOR;
  s.dressRoom(r);
  s.line(r.x0, -42.56, r.x1, -42.44, r.paint, 0.012);
  for (let x = -52; x < -14; x += 9.5) s.bar(x, r.ceil, -42.5, 0, 2.4, 'white', 9, 7);
  pipe(s.k, [-56, 2.95, -43.7, -12, 2.95, -43.7], 0.08, 'steelDark', 6, 6);
  s.sideWords('KEEP MOVING', -12 - SKIN, 2.2, -42.5, 0.7, -1, r.paint);
  // Where the cold air comes from: the way on, lit from the far side of the door.
  s.lamp(-29.6, 3, -44 + SKIN, 0, 'cyan', 10, 8);
}

/** A run of beds along a wall: one box, with frames and mattresses inside it. */
function bedRow(s: Site, x: number, dir: number, z0: number, z1: number, tint: Rgb): void {
  const k = s.k, g = k.geo, depth = 0.95;
  const n = Math.floor((z1 - z0) / 2.1);
  for (let i = 0; i < n; i++) {
    const z = z0 + (i + 0.5) * ((z1 - z0) / n), cx = x + (dir * depth) / 2;
    g.use('steelDark');
    for (const a of [-1, 1]) for (const b of [-1, 1]) g.box(cx + a * 0.42, 0.9, z + b * 0.9, 0.025, 0.9, 0.025, FACE.sides);
    for (const y of [0.42, 1.28]) {
      g.use('steelDark').bevel(cx, y, z, 0.44, 0.03, 0.94, 0.01);
      const t = k.rand(0.7, 1);
      g.use('paintWhite').tint(tint[0] * t, tint[1] * t, tint[2] * t).bevel(cx, y + 0.1, z, 0.4, 0.075, 0.9, 0.03);
      g.tint(1);
    }
  }
  s.cover(Math.min(x, x + dir * depth), z0, Math.max(x, x + dir * depth), z1, 1.8);
}

/** A bank of lockers, flush with a wall. */
function lockers(s: Site, x0: number, z0: number, x1: number, z1: number, h: number, tint: Rgb): void {
  const k = s.k, g = k.geo;
  const alongX = x1 - x0 > z1 - z0;
  const n = Math.max(1, Math.round((alongX ? x1 - x0 : z1 - z0) / 0.62));
  g.use('panel').tint(tint[0], tint[1], tint[2]);
  g.bevel((x0 + x1) / 2, h / 2, (z0 + z1) / 2, (x1 - x0) / 2, h / 2, (z1 - z0) / 2, 0.02);
  g.tint(1).use('steelDark');
  for (let i = 1; i < n; i++) {
    const f = i / n;
    if (alongX) g.box(x0 + (x1 - x0) * f, h / 2, z1 + 0.002, 0.012, h / 2 - 0.05, 0.002, FACE.pz);
    else g.box(x1 + 0.002, h / 2, z0 + (z1 - z0) * f, 0.002, h / 2 - 0.05, 0.012, FACE.px);
  }
  s.cover(x0, z0, x1, z1, h, 0, 'metal');
}

/** Four rooms, four jobs: the flanking loop runs through all of them, so each has to read differently at a glance in the dark. */
function bunks(s: Site): void {
  const [one, two, three, four] = BUNKS as [typeof BUNKS[0], typeof BUNKS[0], typeof BUNKS[0], typeof BUNKS[0]];
  for (const r of BUNKS) {
    s.dressRoom(r);
    s.frameFloor(r, 0, 0.4, 0.12, r.paint);
    s.bar((r.x0 + r.x1) / 2, r.ceil, -30, Math.PI / 2, 3, 'white', 14, 10);
    s.fill((r.x0 + r.x1) / 2, 2.2, -24, 5, 7, 'white');
    s.fill((r.x0 + r.x1) / 2, 2.2, -36, 5, 7, 'white');
    s.spec.pickup((r.x0 + r.x1) / 2, 0.3, -30);
  }
  const SHEET: Rgb = [0.5, 0.52, 0.46], WOOL: Rgb = [0.36, 0.4, 0.3];
  // One: made beds and a wall of lockers, the way the place is meant to look.
  bedRow(s, one.x1 - SKIN, -1, -35, -24, SHEET);
  bedRow(s, one.x0 + SKIN, 1, -35, -24, SHEET);
  s.floorWords('1', -17, 0, -30, 0, 2.4, one.paint);
  // Two: the barricade. Lockers pushed together across the middle, with room to walk round both ends.
  bedRow(s, two.x1 - SKIN, -1, -37, -27, WOOL);
  lockers(s, -31.5, -33.8, -27.5, -33, 1.9, [0.34, 0.42, 0.4]);
  s.floorWords('2', -28, 0, -25, 0, 2.4, two.paint);
  // Three: showers. Tile stalls down the west wall, far enough apart to walk into.
  for (const z of [-36, -31, -26]) {
    const x0 = three.x0 + SKIN, x1 = x0 + 3;
    s.k.geo.use('tile').bevel((x0 + x1) / 2, 1, z, (x1 - x0) / 2, 1, 0.1, 0.02);
    s.cover(x0, z - 0.1, x1, z + 0.1, 2);
    s.k.geo.use('steel').cyl(x0 + 0.5, 1.9, z + 1.4, x0 + 0.5, 2.2, z + 1.4, 0.04, 0.04, 5);
  }
  s.floorWords('3', -38, 0, -30, 0, 2.4, three.paint);
  // Four: stores. It is where the second squad waits, so it is the room with the most to hide behind.
  s.crate(-55.9, -39.9, -53.4, -37.4, 1.9, [0.4, 0.42, 0.34]);
  s.crate(-55.9, -24.6, -53.4, -22.1, 1.3, [0.46, 0.42, 0.34]);
  s.crate(-51.6, -33.2, -49, -30.8, 1.3, [0.42, 0.4, 0.34]);
  s.crate(-45.1 - 2.5, -26.4, -45.1, -23.9, 1.9, [0.4, 0.42, 0.34]);
  s.floorWords('4', -49, 0, -25.5, 0, 2.4, four.paint);
}

/** Tables on their sides, so the men lying behind them are hidden until the word is given. */
function tableOver(s: Site, x: number, z: number, yaw: number): void {
  const k = s.k, g = k.geo;
  k.push(x, 0, z, yaw);
  g.use('plywood').tint(0.52, 0.48, 0.42).bevel(0, 0.54, 0, 1.25, 0.5, 0.05, 0.02);
  g.tint(1).use('steelDark');
  for (const a of [-1, 1]) g.box(a * 1.05, 0.54, 0.34, 0.03, 0.03, 0.3, FACE.py | FACE.ny | FACE.px | FACE.nx);
  k.collide(0, 0.54, 0, 1.3, 0.54, 0.1, 'concrete');
  k.pop();
}

/** A table still set: half a meal, and nobody at it. */
function tableUp(s: Site, x: number, z: number): void {
  const k = s.k, g = k.geo;
  g.use('plywood').tint(0.56, 0.52, 0.46).bevel(x, 0.74, z, 1.25, 0.03, 0.45, 0.01);
  g.tint(1).use('steelDark');
  for (const a of [-1, 1]) for (const b of [-1, 1]) g.box(x + a * 1.1, 0.36, z + b * 0.34, 0.03, 0.36, 0.03, FACE.sides);
  for (let i = 0; i < 5; i++) {
    const ox = k.rand(-1, 1), oz = k.rand(-0.32, 0.32);
    g.use('paintWhite').tint(0.7).cyl(x + ox, 0.77, z + oz, x + ox, 0.79, z + oz, 0.11, 0.1, 8);
  }
  g.tint(1);
  s.solid(x - 1.3, 0, z - 0.5, x + 1.3, 0.77, z + 0.5);
  s.plan.blocks.push({ x0: x - 1.3, z0: z - 0.5, x1: x + 1.3, z1: z + 0.5 });
}

function mess(s: Site): void {
  const r = MESS, k = s.k;
  s.dressRoom(r);
  s.frameFloor(r, 0, 0.6, 0.18, r.paint);
  for (const [x, z] of [[26, -62], [46, -62], [26, -52], [46, -52]] as const) k.column(x, z, 0, r.ceil, 0.9, 'concrete');
  for (const [x, z, yaw] of [
    [20, -65, 0.2], [32, -66, -0.1], [40, -60, 0.5], [52, -64, 0], [18, -58, 1.4], [33, -56, -0.3], [39, -51, 0.15], [50, -57, 1.2], [22, -49, 0.3], [32, -49.6, -0.4], [52, -49, 0.6],
  ] as const) tableOver(s, x, z, yaw);
  for (const [x, z] of [[36, -63.6], [43.6, -55.6], [28, -56.8]] as const) tableUp(s, x, z);
  for (const x of [20, 36, 50]) s.bar(x, r.ceil, -63, 0, 5, 'orange', 18, 13);
  for (const x of [20, 36, 50]) s.bar(x, r.ceil, -51, 0, 5, 'orange', 18, 13);
  s.words('MESS', 36, 3.6, -69 + 0.08, 1.1, 1, r.paint);
  s.spec.pickup(16, 0.3, -48);
  s.spec.pickup(54, 0.3, -67);
}

function kitchen(s: Site): void {
  const r = KITCHEN, k = s.k, g = k.geo;
  s.dressRoom(r);
  const CT: Mat = 'steel';
  // Counters flush with the north wall, and an island on the east side with room to run round it.
  const counter = (x0: number, z0: number, x1: number, z1: number) => {
    g.use(CT).tint(0.7).bevel((x0 + x1) / 2, 0.92, (z0 + z1) / 2, (x1 - x0) / 2, 0.04, (z1 - z0) / 2, 0.01);
    g.tint(1).use('steelDark').bevel((x0 + x1) / 2, 0.44, (z0 + z1) / 2, (x1 - x0) / 2 - 0.04, 0.44, (z1 - z0) / 2 - 0.04, 0.02);
    s.cover(x0, z0, x1, z1, 0.96);
  };
  counter(35, -78 + SKIN, 46, -77);
  counter(14 + SKIN, -78 + SKIN, 16, -71);
  counter(38, -74.8, 45, -73.2);
  machine(k, 54, 0, -76.8, Math.PI, 3, 1.7, 1.4);
  for (const x of [20, 40, 52]) s.bar(x, r.ceil, -74, 0, 3, 'white', 12, 9);
  // A rail round the stairs up from the gallery, so the hole in the floor is not a surprise.
  const { foot, top, north, south } = KITCHEN_STAIR;
  k.rail([foot, 0, north, top, 0, north]);
  k.rail([foot, 0, south, top, 0, south]);
  s.spec.pickup(52, 0.3, -72);
}

function eastCorridor(s: Site): void {
  const r = EAST_CORRIDOR;
  s.dressRoom(r);
  s.line(r.x0, -42.56, r.x1, -42.44, r.paint, 0.012);
  for (let x = 16; x < 54; x += 9.5) s.bar(x, r.ceil, -42.5, 0, 2.4, 'white', 9, 7);
  pipe(s.k, [12, 2.95, -43.7, 56, 2.95, -43.7], 0.08, 'steelDark', 6, 6);
  s.words('ARMOURY', 44, 3, -41 - SKIN, 0.6, -1, ARMOURY.paint);
}

/** The breath: racks along both long walls, a green light, and a floor with nothing on it but what you came for. */
function armoury(s: Site): void {
  const r = ARMOURY, k = s.k, g = k.geo;
  s.dressRoom(r);
  s.frameFloor(r, 0, 0.4, 0.14, r.paint);
  for (let x = 32; x < 55; x += 3.4) {
    if (Math.abs(x - 44) < 2.6) continue;
    g.use('steelDark').bevel(x, 1.2, -39.7, 1.4, 1.2, 0.22, 0.02);
    g.use('steel').tint(0.6);
    for (const y of [0.8, 1.5]) g.bevel(x, y, -39.45, 1.3, 0.04, 0.08, 0.01);
    g.tint(1);
    for (let i = 0; i < 5; i++) k.beam(x - 1 + i * 0.5, 0.4, -39.42, x - 1 + i * 0.5, 1.9, -39.42, 0.03, 0.03, 'steelDark');
  }
  s.solid(30 + SKIN, 0, -40 + SKIN, 41.4, 2.4, -39.46, 'metal');
  s.solid(46.6, 0, -40 + SKIN, 56 - SKIN, 2.4, -39.46, 'metal');
  s.crate(30.2, -34.8, 33, -33 - SKIN, 1.3, [0.3, 0.42, 0.34]);
  s.crate(53.2, -34.8, 55.9, -33 - SKIN, 1.3, [0.3, 0.42, 0.34]);
  s.bar(37, r.ceil, -36.5, 0, 4, 'cyan', 12, 9);
  s.bar(51, r.ceil, -36.5, 0, 4, 'cyan', 12, 9);
  s.fill(44, 2.6, -36.5, 18, 9, 0x8cffc0);
  g.use('emissiveCyan').box(44, 2.8, -40 + SKIN + 0.01, 1.8, 0.03, 0.01, FACE.pz);
  s.words('ARMOURY', 36, 2.7, -33 - SKIN, 0.7, -1, r.paint);
  doorHead(s, DOORS.armourySouth!.at[0], 3, -33 - SKIN, Math.PI, 3);
}

function guardRoom(s: Site): void {
  const r = GUARD;
  s.dressRoom(r);
  s.frameFloor(r, 0, 0.4, 0.12, r.paint);
  s.crate(12.2, -39.9, 15, -38.6, 1.15, DARK);
  s.crate(25.6, -34.2, 28.9, -33 - SKIN, 1.15, DARK);
  lockers(s, 24.4, -40 + SKIN, 28.9, -39.4, 2.1, [0.4, 0.42, 0.34]);
  s.bar(20.5, r.ceil, -36.5, 0, 3, 'white', 12, 9);
  s.spec.pickup(16, 0.3, -35);
}

/** The one long room inside: ribs, bar lights and nothing to stand behind, so a line of men walking down it has time to mean it. */
function plateHall(s: Site): void {
  const r = PLATE, k = s.k, g = k.geo;
  s.dressRoom(r);
  for (let x = 16; x < 56; x += 8) {
    g.use('steelDark').tint(0.8);
    for (const z of [r.z0 + 0.03, r.z1 - 0.03]) g.box(x, r.ceil / 2, z, 0.3, r.ceil / 2, 0.028, z < -20 ? FACE.pz : FACE.nz);
    g.box(x, r.ceil - 0.14, (r.z0 + r.z1) / 2, 0.2, 0.14, (r.z1 - r.z0) / 2, FACE.ny | FACE.px | FACE.nx);
    g.tint(1);
    if (x < 54) s.bar(x + 4, r.ceil, -24, Math.PI / 2, 9, 'white', 26, 14);
  }
  s.line(13, -24.1, 55, -23.9, r.paint, 0.012);
  s.line(13, -30.2, 55, -30.08, [0.5, 0.52, 0.56], 0.012);
  s.line(13, -18, 55, -17.88, [0.5, 0.52, 0.56], 0.012);
  // Flush along the south wall, and only at the ends: two places to duck, neither in the middle of the hall.
  s.crate(13, -16 - SKIN - 1, 17, -16 - SKIN, 1.2, DARK);
  s.crate(50, -16 - SKIN - 1, 55.9, -16 - SKIN, 1.2, DARK);
  s.crate(51.4, -32 + SKIN, 55.9, -30.6, 1.2, DARK);
  cable(k, 14, 4.2, -31.8, 54, 4.2, -31.8, 0.3, 0.05);
  s.spec.pickup(54, 0.3, -24);
  s.spec.pickup(14, 0.3, -24);
}

export function authorRooms(s: Site): void {
  sally(s);
  southCorridor(s);
  bunks(s);
  northCorridor(s);
  mess(s);
  kitchen(s);
  eastCorridor(s);
  armoury(s);
  guardRoom(s);
  plateHall(s);
  signPanel(s.k, 0, 4.2, -12 + SKIN + 0.04, 0, 5, 1.2, signId('BLAST DOOR'), true);
  s.paintFloor('steelDark', rect(-3, -14, 3, -12), 0.012, [0.7, 0.7, 0.74], 2);
}
