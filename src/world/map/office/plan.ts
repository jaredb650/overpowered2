/**
 * The Office on paper: Regional Processing Office 9 of the Office of Societal Compliance. Every number the map is built to, and
 * nothing that imports three.js. x east, z south, y up. docs/proposals/office-map.md draws it.
 *
 * Walls are centred on whole metres. Nav cells are 1 m with centres on the half metre, so a wall blocks the cells on both of its
 * sides and no drop link (two cells out, no wall test) can reach through one.
 */
import type { Mat } from '../../kit/geo';

export type Rgb = readonly [number, number, number];
export interface Rect { x0: number; z0: number; x1: number; z1: number }
export const rect = (x0: number, z0: number, x1: number, z1: number): Rect => ({ x0, z0, x1, z1 });

/** The three floors, and so the nav's levels. A desk, a planter, a scaffold tier or an AC unit is never floor. */
export const LV = { g: 0, f2: 4.4, roof: 8.8 } as const;
export const CEIL = { g: 4.0, f2: 8.4 } as const;
export const PARAPET = 9.8;
export const SKIN = 0.06;
/** Interior partitions and the outside walls. Both block the nav cells either side of their line. */
export const T_IN = 0.3;
export const T_OUT = 0.6;

/** The building. */
export const B = rect(-28, -18, 28, 18);
/** Invisible walls: everything a body can reach is inside. */
export const SITE = rect(-70, -42, 74, 60);
/** Nav, minimap and the light bake stop a little past it. Whole metres, so nav cell centres sit on the half metre. */
export const BOUNDS = rect(-72, -44, 76, 62);
export const SKY = 34;

/** The car park: ground, deck and open roof, a ramp up each side. */
export const PARK = { ...rect(40, -18, 70, 20), ramp1: { x: 65, w: 6, z0: 16, z1: -10 }, ramp2: { x: 53, w: 6, z0: -10, z1: 16 } } as const;
/** The skybridge from the open office to the car park's deck. */
export const BRIDGE = { x0: B.x1, x1: PARK.x0, z0: -12, z1: -8, roof: 8.0 } as const;
/** The tower over the west half of the roof: out of bounds, a face to look at and a gondola to stand on. */
export const TOWER = { ...rect(-27.4, -17.7, -6, -8), top: 60 } as const;
/** The lift shaft, open from the ground to its machine room on the roof. */
export const LIFT = { ...rect(2, -18, 6, -14), top: 12 } as const;
/** Stair A, ground to upstairs: a flight on the west side of the core and a gallery on the east. */
export const STAIR_A = { x: -2.1, w: 3, z0: -7.5, z1: -15, gallery: -0.6 } as const;
/** The roof stair, upstairs along the north wall of the open office. */
export const STAIR_R = { z: -16.2, w: 2.8, x0: 16.6, x1: 24.1 } as const;
/** The fire escape on the north face: two flights and two landings, 0 to 4.4 to 8.8. */
export const ESCAPE = { z0: -21, z1: -18.6, f1: [2.5, 10], land1: [10, 17], f2: [17, 24.5], land2: [24.5, 27.9], gap: [25, 27.5] } as const;
/** Skylights over the open office: holes in the roof with a curb tall enough that no nav drop link crosses it. */
export const SKYLIGHTS: readonly Rect[] = [rect(4, 4, 8, 8), rect(16, 4, 20, 8), rect(16, -12, 20, -8)];
export const CURB = 0.6;
/** Entrance canopy over the lobby doors. */
export const CANOPY = { ...rect(-1, 18, 11, 23), top: 3.9 } as const;
/** Street kerb line: plaza north of it, road south. */
export const STREET_Z = 46;

// -------------------------------------------------------------------------------------------------
// Rooms
// -------------------------------------------------------------------------------------------------

export type Floor = 'g' | 'f2';

export interface Room extends Rect {
  /** Zone id. Starts with an audio room name: roomForZone matches by substring. */
  id: string;
  name: string;
  floor: Floor;
  /** Floor finish. */
  mat: Mat;
  tint: Rgb;
  /** Wall paint and the minimap's fill. */
  paint: Rgb;
  /** Light colour, and how bright. 0 is dark (the server room is lit by its racks). */
  light: number;
  lux: number;
}

const CARPET: Mat = 'carpet';
const room = (floor: Floor, id: string, name: string, r: Rect, mat: Mat, tint: Rgb, paint: Rgb, light = 0xdfe9ff, lux = 34): Room =>
  ({ ...r, floor, id, name, mat, tint, paint, light, lux });

export const ROOMS: readonly Room[] = [
  room('g', 'refinery-server', 'SERVER ROOM', rect(-28, -18, -14, -6), 'grate', [0.62, 0.66, 0.72], [0.1, 0.5, 0.9], 0x3fb4ff, 0),
  room('g', 'refinery-copy', 'COPY ROOM', rect(-14, -18, -4, -6), 'tile', [0.7, 0.72, 0.7], [0.86, 0.62, 0.2]),
  room('g', 'refinery-stair', 'STAIRS', rect(-4, -18, 2, -6), 'concrete', [0.8, 0.8, 0.82], [0.7, 0.72, 0.76], 0xe8f0ff, 26),
  room('g', 'refinery-lift', 'LIFT LOBBY', rect(2, -14, 6, -6), 'tile', [0.6, 0.62, 0.66], [0.7, 0.72, 0.76], 0xe8f0ff, 18),
  room('g', 'refinery-supply', 'SUPPLY', rect(6, -18, 14, -6), 'concrete', [0.7, 0.7, 0.72], [0.62, 0.66, 0.4], 0xfff0d8, 26),
  room('g', 'refinery-corridor', 'CORRIDOR', rect(-28, -6, 14, -2), 'tile', [0.74, 0.76, 0.8], [0.86, 0.88, 0.9]),
  room('g', 'refinery-break', 'BREAK ROOM', rect(-28, -2, -14, 18), 'tile', [0.86, 0.8, 0.66], [0.92, 0.56, 0.24], 0xfff0dc, 34),
  room('g', 'refinery-records', 'RECORDS', rect(-14, -2, -4, 8), CARPET, [0.34, 0.32, 0.3], [0.56, 0.5, 0.42], 0xfff2dc, 28),
  room('g', 'refinery-waiting', 'WAITING', rect(-14, 8, -4, 18), CARPET, [0.3, 0.34, 0.4], [0.3, 0.7, 0.66]),
  room('g', 'refinery-lobby', 'LOBBY', rect(-4, -2, 14, 18), 'tile', [0.9, 0.92, 0.96], [0.2, 0.8, 1], 0xe6f2ff, 40),
  room('g', 'refinery-cubicles', 'CUBICLES', rect(14, -18, 28, 18), CARPET, [0.28, 0.3, 0.36], [0.5, 0.62, 0.9]),
  room('f2', 'refinery-director', 'DIRECTOR', rect(-28, -18, -14, -6), CARPET, [0.38, 0.12, 0.14], [0.8, 0.2, 0.3], 0xffe6cc, 30),
  room('f2', 'refinery-print', 'PRINT ROOM', rect(-14, -18, -4, -6), 'tile', [0.68, 0.7, 0.7], [0.86, 0.62, 0.2]),
  room('f2', 'refinery-stair2', 'STAIRS', rect(-4, -18, 2, -6), 'concrete', [0.8, 0.8, 0.82], [0.7, 0.72, 0.76], 0xe8f0ff, 22),
  room('f2', 'refinery-lift2', 'LIFT LOBBY', rect(2, -14, 6, -6), 'tile', [0.6, 0.62, 0.66], [0.7, 0.72, 0.76], 0xe8f0ff, 18),
  room('f2', 'refinery-it', 'IT', rect(6, -18, 14, -6), 'grate', [0.6, 0.64, 0.7], [0.2, 0.9, 0.6], 0xc8ffe8, 24),
  room('f2', 'refinery-corridor2', 'CORRIDOR', rect(-28, -6, 14, -2), CARPET, [0.3, 0.3, 0.34], [0.86, 0.88, 0.9]),
  room('f2', 'refinery-exec', 'EXECUTIVE', rect(-28, -2, -14, 8), CARPET, [0.36, 0.24, 0.18], [0.8, 0.66, 0.4], 0xffe8cc, 30),
  room('f2', 'refinery-exec3', 'EXECUTIVE', rect(-28, 8, -14, 18), CARPET, [0.36, 0.24, 0.18], [0.8, 0.66, 0.4], 0xffe8cc, 30),
  room('f2', 'refinery-meeting', 'MEETING A', rect(-14, -2, -4, 8), CARPET, [0.26, 0.3, 0.36], [0.4, 0.86, 1]),
  room('f2', 'refinery-meeting2', 'MEETING B', rect(-14, 8, -4, 18), CARPET, [0.26, 0.3, 0.36], [0.4, 0.86, 1]),
  room('f2', 'refinery-open', 'OPEN OFFICE', rect(-4, -2, 28, 18), CARPET, [0.26, 0.28, 0.34], [0.5, 0.62, 0.9]),
  room('f2', 'refinery-open2', 'OPEN OFFICE', rect(14, -18, 28, -2), CARPET, [0.26, 0.28, 0.34], [0.5, 0.62, 0.9]),
];

export const floorY = (f: Floor): number => (f === 'g' ? LV.g : LV.f2);
export const ceilY = (f: Floor): number => (f === 'g' ? CEIL.g : CEIL.f2);

// -------------------------------------------------------------------------------------------------
// Walls
// -------------------------------------------------------------------------------------------------

/**
 * A hole in a wall. `kind` decides what fills it: a door is open, a pane hole gets breakable glass (stage c), a bay is a full
 * height hole with no glass (the broken ones the parkour comes in through).
 */
export interface Hole { at: number; w: number; y0?: number; y1: number; kind: 'door' | 'pane' | 'bay' }

/** A straight wall. `axis` 'x' runs along x at z = `at`; 'z' runs along z at x = `at`. */
export interface WallLine {
  axis: 'x' | 'z';
  at: number;
  from: number;
  to: number;
  y0: number;
  y1: number;
  holes: readonly Hole[];
  /** A glass partition: a low base, a head and mullions, and panes in between. */
  glass?: boolean;
  t?: number;
}

const door = (at: number, w = 2.4, y0 = 0, h = 2.8): Hole => ({ at, w, y0, y1: y0 + h, kind: 'door' });
const pane = (at: number, w: number, y0: number, y1: number): Hole => ({ at, w, y0, y1, kind: 'pane' });
const bay = (at: number, w: number, y0: number, y1: number): Hole => ({ at, w, y0, y1, kind: 'bay' });
const wx = (at: number, from: number, to: number, y0: number, y1: number, holes: Hole[] = [], glass = false): WallLine =>
  ({ axis: 'x', at, from, to, y0, y1, holes, glass });
const wz = (at: number, from: number, to: number, y0: number, y1: number, holes: Hole[] = [], glass = false): WallLine =>
  ({ axis: 'z', at, from, to, y0, y1, holes, glass });

const G0 = LV.g, G1 = CEIL.g, F0 = LV.f2, F1 = CEIL.f2;
const F2DOOR = (at: number, w = 2.4) => door(at, w, F0);
/** Window heads and sills. */
const WIN_G: [number, number] = [1.0, 3.2];
const WIN_F: [number, number] = [5.3, 7.8];

export const INNER: readonly WallLine[] = [
  // Ground.
  wx(-6, -28, 14, G0, G1, [door(-18), door(-9), door(-2.1), door(4, 3, 0, 3), door(10)]),
  wz(-14, -18, -6, G0, G1, [door(-12, 2)]),
  wz(-4, -18, -6, G0, G1),
  wz(2, -14, -6, G0, G1),
  wz(6, -14, -6, G0, G1),
  wz(14, -18, -6, G0, G1),
  wx(-2, -28, -4, G0, G1, [door(-21), door(-9)]),
  wz(-14, -2, 18, G0, G1, [door(3, 2), door(13, 2)]),
  wx(8, -14, -4, G0, G1),
  wz(-4, -2, 18, G0, G1, [door(3), door(13)]),
  wz(14, -2, 18, G0, G1, [door(6, 3, 0, 3), door(14)]),
  // Upstairs.
  wx(-6, -28, 14, F0, F1, [F2DOOR(-18), F2DOOR(-9), F2DOOR(0.6, 2.2), door(4, 3, F0, 3), F2DOOR(10)]),
  wz(-14, -18, -6, F0, F1, [F2DOOR(-12, 2)]),
  wz(-4, -18, -6, F0, F1),
  wz(2, -14, -6, F0, F1),
  wz(6, -14, -6, F0, F1),
  wz(14, -18, -6, F0, F1, [F2DOOR(-12)]),
  wx(-2, -28, -14, F0, F1, [F2DOOR(-21)]),
  wx(-2, -14, -4, F0, F1, [F2DOOR(-9, 2)], true),
  wz(-14, -2, 18, F0, F1, [F2DOOR(3, 2), F2DOOR(13, 2)]),
  wx(8, -28, -14, F0, F1, [F2DOOR(-21, 2)]),
  wx(8, -14, -4, F0, F1, [], true),
  wz(-4, -2, 18, F0, F1, [F2DOOR(3, 2), F2DOOR(13, 2)], true),
];

/** The lift shaft, one piece from the ground to its machine room on the roof, with a door on every floor. */
export const LIFT_WALLS: readonly WallLine[] = [
  wz(LIFT.x0, LIFT.z0, LIFT.z1, G0, LIFT.top),
  wz(LIFT.x1, LIFT.z0, LIFT.z1, G0, LIFT.top),
  wx(LIFT.z0, LIFT.x0, LIFT.x1, PARAPET, LIFT.top),
  wx(LIFT.z1, LIFT.x0, LIFT.x1, G0, LIFT.top, [door(4), door(4, 2.4, F0, 2.6), door(4, 2.4, LV.roof, 2.6)]),
];

/** The outside walls, ground to the top of the parapet, with every hole on both floors. */
export const OUTER: readonly WallLine[] = [
  // South: break room, waiting, the lobby's storefront and doors, cubicles; upstairs a ribbon of windows and the gondola's.
  { ...wx(B.z1, B.x0, B.x1, G0, PARAPET, [
    pane(-21, 9, ...WIN_G), pane(-9, 7, ...WIN_G),
    pane(-0.7, 5.4, 0.15, 3.4), door(5, 6, 0, 3.4), pane(10.7, 5.4, 0.15, 3.4),
    pane(17.5, 4, ...WIN_G), door(21), pane(25, 4, ...WIN_G),
    pane(-21, 11, ...WIN_F), pane(-9, 8, ...WIN_F), pane(-0.5, 5, ...WIN_F), pane(5.5, 5, ...WIN_F), pane(11.5, 5, ...WIN_F),
    bay(20, 5, WIN_F[0], WIN_F[1]), pane(25.5, 3.8, ...WIN_F),
  ]), t: T_OUT },
  // North: the alley doors; upstairs windows and the fire escape's door; the parapet's gap at its top landing.
  { ...wx(B.z0, B.x0, B.x1, G0, PARAPET, [
    door(-9), door(10),
    pane(-21, 8, ...WIN_F), pane(-9, 6, ...WIN_F), door(12, 2, F0, 2.6), pane(18, 5, ...WIN_F), pane(24, 3, ...WIN_F),
    { at: (ESCAPE.gap[0] + ESCAPE.gap[1]) / 2, w: ESCAPE.gap[1] - ESCAPE.gap[0], y0: LV.roof, y1: PARAPET + 0.1, kind: 'door' },
  ]), t: T_OUT },
  // West: the break room's yard door; upstairs the scaffold's two broken bays.
  { ...wz(B.x0, B.z0, B.z1, G0, PARAPET, [
    pane(1, 4, ...WIN_G), door(8), pane(14, 4, ...WIN_G),
    bay(-12, 3, F0, WIN_F[1]), pane(3, 6, ...WIN_F), bay(13, 3, F0, WIN_F[1]),
  ]), t: T_OUT },
  // East: two doors to the car park; upstairs the skybridge.
  { ...wz(B.x1, B.z0, B.z1, G0, PARAPET, [
    pane(-15, 4, ...WIN_G), door(-10), pane(-1, 8, ...WIN_G), door(8), pane(14, 4, ...WIN_G),
    pane(-15.5, 3, ...WIN_F), { at: (BRIDGE.z0 + BRIDGE.z1) / 2, w: BRIDGE.z1 - BRIDGE.z0, y0: F0, y1: 7.4, kind: 'door' },
    pane(-2, 8, ...WIN_F), pane(6, 5, ...WIN_F), pane(13.5, 6, ...WIN_F),
  ]), t: T_OUT },
];

// -------------------------------------------------------------------------------------------------
// Marks
// -------------------------------------------------------------------------------------------------

/** Where the enemies come in: the edges of the site, far from the lobby, out of sight of each other. */
export const ENTRANCES: readonly (readonly [number, number, number])[] = [
  [-64, 0, 53], [70, 0, 53], [-52, 0, 30], [62, 0, 34],
  [-62, 0, -6], [-60, 0, 12], [-62, 0, -31], [-12, 0, -33], [34, 0, -33], [68, 0, -31],
  [68, 0, 4], [36, 0, 14],
];
export const FLYERS: readonly (readonly [number, number, number])[] = [
  [0, 20, 40], [-40, 20, 32], [52, 20, 36], [-30, 22, -30], [30, 22, -30], [-52, 18, 0], [56, 20, 0],
];

/** Pickups. The ones outside are under open sky, so the supply pod can come down on them. */
export const PICKUPS_OUT: readonly (readonly [number, number, number])[] = [
  [-10, 0, 32], [22, 0, 32], [5, 0, 42], [-40, 0, 38], [46, 0, 38],
  [-48, 0, -4], [-40, 0, 12], [-40, 0, -30], [20, 0, -30], [56, 0, -30],
  [-2, LV.roof, 6], [22, LV.roof, 10], [62, LV.roof, -4], [46, LV.roof, 6],
];
export const PICKUPS_IN: readonly (readonly [number, number, number])[] = [
  [0, 0, 10], [-21, 0, 4], [-21, 0, -12], [21, 0, 0], [11.5, LV.f2, 8], [25, LV.f2, -13], [-21, LV.f2, 3], [47, LV.f2, 0], [46, 0, -6],
];
