/**
 * The vertical end of the mission: the Stack, the War Room at the top of it and the Comms Roof over everything. The Stack is one well
 * with galleries round it at each level, so men on three floors can all see each other and the player. Two stairs climb it in opposite
 * directions, which is the loop, and the north-east shaft is the way up for those who have learned to kick.
 */
import { DOORS } from '../../../campaign/missions/outpost.places';
import { FACE } from '../../kit/geo';
import { machine, pipe, vent } from '../../kit/props';
import {
  carveAll, COMMS, LEVEL, rect, type Rect, ROOF, ROOF_STAIR, type Rgb, SKIN, SKY, STACK, STACK_ROOM, WAR, WAR_CEIL, WAR_ROOM,
} from './plan';
import type { Site } from './site';

const { x0: SX0, x1: SX1, north: SN, south: SS, well, shaft, stairW } = STACK;
const ALARM: Rgb = [0.95, 0.16, 0.12];

/** Slits look into the Stack from the rooms around it, so the player keeps catching sight of the thing they are circling. */
function shell(s: Site): void {
  const slit = (at: number) => ({ at, w: 3, y0: 1.5, y1: 1.9 });
  s.wall({ x0: SX0 - 2, z0: SN - 2, x1: SX0, z1: SS + 2, y1: ROOF, openings: [slit(-32), slit(-56)] });
  s.wall({ x0: SX1, z0: SN - 2, x1: SX1 + 2, z1: SS + 2, y1: ROOF, openings: [{ at: -30, w: 3, y1: 3 }, { at: -36, w: 3, y1: 3 }, slit(-56)] });
  s.wall({ x0: SX0, z0: SS, x1: SX1, z1: SS + 2, y1: ROOF });
  s.wall({ x0: SX0, z0: SN - 2, x1: SX1, z1: SN, y1: WAR.floor });
}

/** Where each level's floor is cut for the flight rising through it. */
const SLOTS: Readonly<Record<number, readonly Rect[]>> = {
  [LEVEL.upper]: [rect(SX0, -46, SX0 + stairW, -36), rect(SX1 - stairW, -56, SX1, -46)],
  [LEVEL.command]: [rect(SX0, -58, SX0 + stairW, -48), rect(SX1 - stairW, -44, SX1, -34)],
};

/** A grated floor round the well at `y`. Nothing under it blocks the light, so each level is lit by the one below as well. */
function gallery(s: Site, y: number): void {
  const k = s.k, g = k.geo;
  const holes = [well, shaft, ...SLOTS[y]!];
  const floor = carveAll(rect(SX0, SN, SX1, SS), holes);
  for (const r of floor) {
    g.use('grate').slab((r.x0 + r.x1) / 2, y - 0.04, (r.z0 + r.z1) / 2, (r.x1 - r.x0) / 2, 0.04, (r.z1 - r.z0) / 2, 3, FACE.py | FACE.ny);
    s.solid(r.x0, y - 0.3, r.z0, r.x1, y, r.z1, 'grate', false);
    s.plan.decks.push({ ...r });
  }
  g.use('steelDark');
  for (const z of [well.z0 - 0.1, well.z1 + 0.1]) g.bevel(0, y - 0.16, z, (well.x1 - well.x0) / 2 + 0.1, 0.14, 0.1, 0.02);
  for (const x of [well.x0 - 0.1, well.x1 + 0.1]) g.bevel(x, y - 0.16, (well.z0 + well.z1) / 2, 0.1, 0.14, (well.z1 - well.z0) / 2, 0.02);
  k.rail([well.x0, y, well.z0, well.x1, y, well.z0, well.x1, y, well.z1, well.x0, y, well.z1, well.x0, y, well.z0]);
}

function floors(s: Site): void {
  const g = s.k.geo;
  // Ground level is solid to the bottom of the well, so the men at the base have nowhere to go but the two stairs.
  for (const r of carveAll(rect(SX0, SN, SX1, SS), [well])) {
    s.solid(r.x0, LEVEL.gallery - 1, r.z0, r.x1, 0, r.z1);
    s.paintFloor('concreteDark', r, 0, STACK_ROOM.floorTint);
  }
  s.solid(well.x0, LEVEL.gallery - 1, well.z0, well.x1, LEVEL.gallery, well.z1);
  s.paintFloor('concreteDark', well, LEVEL.gallery, [0.6, 0.6, 0.64]);
  g.use('concrete').tint(0.48, 0.5, 0.54);
  const d = -LEVEL.gallery / 2;
  g.box(0, -d, well.z0 + 0.002, (well.x1 - well.x0) / 2, d, 0.001, FACE.pz);
  g.box(0, -d, well.z1 - 0.002, (well.x1 - well.x0) / 2, d, 0.001, FACE.nz);
  g.box(well.x0 + 0.002, -d, (well.z0 + well.z1) / 2, 0.001, d, (well.z1 - well.z0) / 2, FACE.px);
  g.box(well.x1 - 0.002, -d, (well.z0 + well.z1) / 2, 0.001, d, (well.z1 - well.z0) / 2, FACE.nx);
  g.tint(1);
  s.stairs(0, -44, LEVEL.gallery, 0, -34, 0, 3, 'concrete', true);
  s.stairs(0, -48, LEVEL.gallery, 0, -58, 0, 3, 'concrete', true);
  s.k.rail([well.x0, 0, well.z0, -1.5, 0, well.z0]);
  s.k.rail([1.5, 0, well.z0, well.x1, 0, well.z0, well.x1, 0, well.z1, 1.5, 0, well.z1]);
  s.k.rail([-1.5, 0, well.z1, well.x0, 0, well.z1, well.x0, 0, well.z0]);
  gallery(s, LEVEL.upper);
  gallery(s, LEVEL.command);
  const west = SX0 + stairW / 2, east = SX1 - stairW / 2;
  s.k.stairs(west, -36, 0, west, -46, LEVEL.upper, stairW);
  s.k.stairs(west, -48, LEVEL.upper, west, -58, LEVEL.command, stairW);
  s.k.stairs(east, -56, 0, east, -46, LEVEL.upper, stairW);
  s.k.stairs(east, -44, LEVEL.upper, east, -34, LEVEL.command, stairW);
}

/** Two pairs of walls, 5 m apart, with nothing else on them. A kick from one reaches the next all the way to the top landing. */
function kickShaft(s: Site): void {
  const { x0, z1 } = shaft;
  const k = s.k;
  // Open at the foot on the south side, so the way in is a doorway off the ground floor.
  s.wall({ x0: x0 - 0.4, z0: SN, x1: x0, z1: z1 + 0.4, y1: LEVEL.command });
  s.wall({ x0, z0: z1, x1: SX1, z1: z1 + 0.4, y1: LEVEL.command, openings: [{ at: (x0 + SX1) / 2, w: 3, y1: 3 }] });
  for (const y of [2, 4.5, 7]) k.geo.use('emissiveCyan').box(x0 + 0.03, y, (SN + z1) / 2, 0.012, 0.03, 2, FACE.px);
  k.light((x0 + SX1) / 2, 5, (SN + z1) / 2, 'cyan', 30, 11);
  s.words('EYES UP', (x0 + SX1) / 2, 3.4, z1 + 0.41, 0.5, 1, [0.14, 0.82, 0.9]);
}

function dress(s: Site): void {
  const k = s.k, g = k.geo;
  // A riser up the middle of the well's north end, for scale. It touches nothing a body can reach.
  pipe(k, [SX0 + 0.5, -4.6, SN + 0.5, SX0 + 0.5, 13, SN + 0.5], 0.3, 'steelDark', 6, 8);
  pipe(k, [SX1 - 6, -4.6, SS - 0.6, SX1 - 6, 13, SS - 0.6], 0.22, 'steel', 6, 8);
  for (const y of [1.6, 6.6]) s.k.geo.use('emissiveRed').box(SX0 + 0.02, y + 0.4, -38, 0.012, 0.04, 6, FACE.px);
  s.words('STACK', 0, 3.2, SS - SKIN, 1.6, -1, ALARM);
  s.floorWords('ARROW', 0, 0, -31, Math.PI, 2, ALARM);
  // White at the bottom, red at the top: the climb is toward him.
  s.fill(0, -2.2, -46, 46, 13, 'orange');
  s.fill(-7, 3.4, -32, 40, 13, 'white');
  s.fill(7, 3.4, -46, 36, 12, 'white');
  s.fill(-7, 3.4, -56, 36, 12, 'white');
  s.fill(7, 8.2, -38, 40, 13, 'orange');
  s.fill(-7, 8.2, -50, 40, 13, 'orange');
  s.fill(0, 12, -36, 44, 14, 'red');
  s.fill(0, 12, -56, 54, 15, 'red');
  for (const [x, z] of [[-9.9, -34], [9.9, -40], [-9.9, -56]] as const) {
    s.lamp(x, 3.4, z, x > 0 ? -Math.PI / 2 : Math.PI / 2, 'white', 0);
    s.lamp(x, 8.4, z, x > 0 ? -Math.PI / 2 : Math.PI / 2, 'orange', 0);
    s.lamp(x, 12.6, z, x > 0 ? -Math.PI / 2 : Math.PI / 2, 'red', 0);
  }
  g.use('emissiveRed').box(0, 12.9, SS - SKIN, 8, 0.04, 0.01, FACE.nz);
  s.spec.pickup(-6.5, LEVEL.upper + 0.3, -54);
  s.spec.pickup(7, 0.3, -37);
}

/** He sits behind this. Solid but for the middle pane, which the mission takes out when the fight starts. */
function glass(s: Site): void {
  const k = s.k, g = k.geo;
  const pane = DOORS.warGlass!;
  const z = pane.at[2], half = pane.width / 2, top = pane.at[1] + pane.height;
  const y0 = WAR.floor;
  for (const [a, b] of [[SX0, -half], [half, SX1]] as const) {
    s.solid(a, y0, z - 0.1, b, WAR_CEIL, z + 0.1, 'glass');
    g.use('glass').slab((a + b) / 2, (y0 + WAR_CEIL) / 2, z, (b - a) / 2, (WAR_CEIL - y0) / 2, 0.04, 3, FACE.pz | FACE.nz);
    for (let x = a; x <= b + 0.01; x += (b - a) / 2) g.use('steelDark').bevel(x, (y0 + WAR_CEIL) / 2, z, 0.07, (WAR_CEIL - y0) / 2, 0.11, 0.02);
  }
  g.use('steelDark').bevel(0, y0 + 0.05, z, SX1, 0.06, 0.12, 0.02);
  s.solid(-half, top, z - 0.15, half, WAR_CEIL, z + 0.15, 'metal');
  g.use('steelDark').bevel(0, (top + WAR_CEIL) / 2, z, half, (WAR_CEIL - top) / 2, 0.14, 0.02);
  for (const x of [-half, half]) g.use('steelDark').bevel(x, (y0 + top) / 2, z, 0.09, (top - y0) / 2, 0.14, 0.02);
  // The two bays beyond the Stack's width are wall, and the room's corners close on them.
  s.wall({ x0: WAR.x0 - 2, z0: z - 1, x1: SX0, z1: z + 1, y0, y1: WAR_CEIL });
  s.wall({ x0: SX1, z0: z - 1, x1: WAR.x1, z1: z + 1, y0, y1: WAR_CEIL });
}

function warRoom(s: Site): void {
  const r = WAR_ROOM, k = s.k, g = k.geo;
  s.plan.fills.push({ x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, rgb: r.paint, label: '' });
  s.paintFloor('concreteDark', rect(WAR.bayEdge, r.z0, r.x1, r.z1), r.y, r.floorTint);
  s.paintFloor('concrete', rect(r.x0, r.z0, WAR.bayEdge, r.z1), r.y, [0.6, 0.6, 0.64]);
  glass(s);
  s.mass('concreteDark', WAR.x0 - 2, r.y, r.z0 - 2, WAR.x0, WAR_CEIL, r.z1, 0.62, 3);
  // The partition that hides the stairs to the roof. He opens it himself when he runs.
  const door = DOORS.warRoomStairs!;
  s.wall({ x0: WAR.bayEdge - 0.4, z0: r.z0, x1: WAR.bayEdge, z1: r.z1, y0: r.y, y1: WAR_CEIL, openings: [{ at: door.at[2], w: door.width, y1: r.y + door.height, scripted: true }], tone: 0.8 });
  // Consoles flush with the north wall, and two plotting tables either side of where he stands.
  for (const x of [-6, 2, 10]) {
    g.use('steelDark').bevel(x, r.y + 0.6, -77.5, 2.8, 0.6, 0.44, 0.04);
    g.use('emissiveRed').box(x, r.y + 1.24, -77.4, 2.5, 0.02, 0.2, FACE.py);
    s.solid(x - 2.8, r.y, -78, x + 2.8, r.y + 1.2, -77.06, 'metal');
  }
  for (const x of [-7, 7]) {
    g.use('steelDark').bevel(x, r.y + 0.48, -72, 2.2, 0.48, 1.3, 0.04);
    g.use('emissiveCyan').box(x, r.y + 0.97, -72, 2, 0.01, 1.1, FACE.py);
    s.cover(x - 2.2, -73.3, x + 2.2, -70.7, 0.96, r.y, 'metal');
  }
  // The wall map: the only big light in the room, and what the player sees through the glass from the bottom of the Stack.
  g.use('emissiveRed').box(2, r.y + 2.7, -78 + 0.02, 7, 0.6, 0.01, FACE.pz);
  for (const x of [-6, 2, 10]) s.bar(x, WAR_CEIL, -72, 0, 4, 'red', 44, 14);
  s.fill(0, 12, -68, 40, 13, 'red');
  // The way to the roof.
  const { x, w, foot, top } = ROOF_STAIR;
  s.stairs(x, foot, r.y, x, top, ROOF, w, 'concrete');
  s.fill(x, 12, -76.2, 20, 9, 'white');
}

/** The end of the climb: open sky, the whole apron burning to the south, and the mast he calls his mortars from. */
function roof(s: Site): void {
  const k = s.k, g = k.geo;
  const { x0, z0, x1, z1 } = COMMS;
  const { x, w, foot, top } = ROOF_STAIR;
  const hole = rect(x - w / 2, Math.min(foot, top), x + w / 2, Math.max(foot, top));
  for (const r of carveAll(COMMS, [hole])) {
    g.use('concreteDark').tint(0.6, 0.62, 0.66).slab((r.x0 + r.x1) / 2, ROOF - 0.25, (r.z0 + r.z1) / 2, (r.x1 - r.x0) / 2, 0.25, (r.z1 - r.z0) / 2, 3, FACE.py | FACE.ny);
    g.tint(1);
    s.solid(r.x0, ROOF - 0.5, r.z0, r.x1, ROOF, r.z1);
  }
  s.plan.decks.push({ ...COMMS });
  // Parapet, then a barrier above it. Off this roof there is nothing but wings no one can get back from.
  const p = 0.5, h = ROOF + 1.1;
  s.wall({ x0, z0, x1, z1: z0 + p, y0: ROOF, y1: h, outside: 'poured', tone: 0.68 });
  s.wall({ x0, z0: z1 - p, x1, z1, y0: ROOF, y1: h, outside: 'poured', tone: 0.68 });
  s.wall({ x0, z0: z0 + p, x1: x0 + p, z1: z1 - p, y0: ROOF, y1: h, outside: 'poured', tone: 0.68 });
  s.wall({ x0: x1 - p, z0: z0 + p, x1, z1: z1 - p, y0: ROOF, y1: h, outside: 'poured', tone: 0.68 });
  s.barrier(x0, h, z0, x1, SKY, z0 + p);
  s.barrier(x0, h, z1 - p, x1, SKY, z1);
  s.barrier(x0, h, z0, x0 + p, SKY, z1);
  s.barrier(x1 - p, h, z0, x1, SKY, z1);
  k.rail([hole.x0, ROOF, hole.z0, hole.x1, ROOF, hole.z0, hole.x1, ROOF, hole.z1, hole.x0, ROOF, hole.z1, hole.x0, ROOF, hole.z0]);
  // The mast stands just north of the mark he runs to, so he fights with it behind him.
  const mx = 0, mz = -74;
  g.use('concreteDark').bevel(mx, ROOF + 0.4, mz, 1.4, 0.4, 1.4, 0.06);
  s.solid(mx - 1.4, ROOF, mz - 1.4, mx + 1.4, ROOF + 0.8, mz + 1.4);
  g.use('steelDark').cyl(mx, ROOF, mz, mx, ROOF + 22, mz, 0.26, 0.08, 8, false, false);
  for (const y of [8, 14, 19]) g.use('steelDark').box(mx, ROOF + y, mz, 1.8 - y * 0.05, 0.03, 0.03, FACE.py | FACE.ny | FACE.pz | FACE.nz);
  g.use('emissiveRed').box(mx, ROOF + 22.2, mz, 0.12, 0.12, 0.12, FACE.all);
  // Air plant and dishes: the only cover up here, three metres clear of everything so a mortar round has something to chase him from.
  for (const [cx, cz, hx, hz] of [[-12, -60, 2, 1.5], [12, -60, 2, 1.5], [0, -50, 2.4, 1.4], [-12, -36, 1.6, 2], [12, -36, 1.6, 2], [0, -34, 2.4, 1.2]] as const) {
    g.use('panel').tint(0.44, 0.48, 0.54).bevel(cx, ROOF + 0.65, cz, hx, 0.65, hz, 0.06);
    g.tint(1);
    vent(k, cx, ROOF + 0.72, cz + hz + 0.02, 0, hx * 1.4, 0.8);
    s.cover(cx - hx, cz - hz, cx + hx, cz + hz, 1.3, ROOF, 'metal');
  }
  machine(k, 18, ROOF, -74, 0.3, 2.6, 1.4, 1.6);
  for (const [cx, cz, yaw] of [[-18, -74, 0.6], [19, -30, -2.2]] as const) dish(s, cx, cz, yaw);
  s.fill(0, ROOF + 2.6, -62, 44, 18, 'red');
  s.fill(0, ROOF + 2.6, -38, 40, 18, 'white');
}

function dish(s: Site, x: number, z: number, yaw: number): void {
  const k = s.k, g = k.geo;
  k.push(x, ROOF, z, yaw);
  g.use('steelDark').cyl(0, 0, 0, 0, 2, 0, 0.14, 0.12, 6);
  k.push(0, 2.3, 0, 0, 0.8, 0);
  const r = 1.7, prof: number[] = [];
  for (let i = 0; i <= 5; i++) prof.push(Math.max(0.01, (i / 5) * r), (i / 5) * (i / 5) * 0.7);
  g.use('paintWhite').tint(0.6, 0.62, 0.66).lathe(prof, 0, 0, 0, 14, true);
  g.tint(1);
  k.pop();
  k.pop();
  s.solid(x - 0.3, ROOF, z - 0.3, x + 0.3, ROOF + 2, z + 0.3, 'metal', false);
}

export function authorStack(s: Site): void {
  shell(s);
  floors(s);
  kickShaft(s);
  dress(s);
  warRoom(s);
  roof(s);
}
