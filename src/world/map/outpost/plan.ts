/**
 * The Outpost on paper. docs/campaign/MISSION.md section 2 draws it, `outpost.places.ts` holds every mark the mission uses, and this
 * file holds what stands between them. x runs east, z south, y up, the apron's floor is y 0 and north is -z.
 *
 * The citadel is authored as footprints, not centre lines: a wall is the rectangle it stands on, so a 1 m wall and the 4 m band between
 * the Coolant Hall and the Stack are the same kind of thing. Every room edge below is a wall face from the mission's table.
 *
 * The parkour numbers are PARKOUR's. Nothing here may change a gap, a ledge or a headroom by eye.
 */
import type { Mat } from '../../kit/geo';
import type { StencilName } from '../../kit/stencil';
import { LEVEL } from '../../../campaign/missions/outpost.places';
import { PARKOUR } from '../../../campaign/parkour';

export { LEVEL };

export type Rgb = readonly [number, number, number];
export interface Rect { x0: number; z0: number; x1: number; z1: number }
export const rect = (x0: number, z0: number, x1: number, z1: number): Rect => ({ x0, z0, x1, z1 });

/** What a wall's collider adds to its core. Panels, paint and frames stay inside it, so nothing visible can catch a capsule. */
export const SKIN = 0.06;

/** Half the site: everything a player walks on is inside this. */
export const SITE = 110;
/** Half the area with ground and nav under it, past the berm crest. */
export const EDGE = 118;
/** Top of the invisible containment. A rocket jump gets nowhere near it. */
export const SKY = 60;

export const WALL = { x: 78, north: -92, south: 12, h: 6, walk: 5, half: 1.2, parapet: 0.6 } as const;
export const TOWER = { half: 2.5, deck: LEVEL.upper + 4, cap: 11.8 } as const;
/** The main gate: 14 m wide between its pylons, which stand this much taller than the wall. */
export const GATE = { half: 7, h: 6, pylon: 3, pylonH: 8 } as const;
export const YARD = { x: 30, north: -12, south: 10.8, wallHalf: 1, h: 6 } as const;

/** Wing roof, and the top of every wall in a wing. */
/** Off the list of nav levels on purpose: nobody walks the wing roofs, and a height that is not a level is not a floor. */
export const WING = 5.1;
export const ROOF = LEVEL.roof;
/** Underside of the Comms Roof slab, which is the War Room's ceiling. */
export const WAR_CEIL = 13.5;
export const HALL_TOP = 12;
export const CITADEL = rect(-58, -80, 58, -12);

export const LZ = { ...rect(-49, 73, -15, 99), floor: -PARKOUR.mantle.ledge } as const;
/** The way the cut was meant to be left. It stays blocked: that is why the mantle is the only way out. */
export const LZ_RAMP = rect(-15, 83, -3, 89);

export const WRECK = { ...rect(74, 80, 94, 88), deck: PARKOUR.doubleJump.ledge } as const;

/** Near lip, far lip, and the platform between the near lip and the door. */
export const COOLANT = {
  x0: -56, x1: -14, north: -78, south: -46,
  nearLip: -50,
  farLip: -50 - PARKOUR.dash.gap,
  /** Width of the near platform. The hall's side walls are too far from it to run on, so this stays a lesson in the dash. */
  platform: rect(-40, -50, -28, -46),
  pit: -6,
} as const;

/** The cable gallery. The headroom is the lesson: see the notes on PARKOUR.wallRun. */
export const GALLERY = {
  north: -78, south: -78 + PARKOUR.wallRun.width,
  nearEnd: -24, nearLip: -PARKOUR.wallRun.gap / 2, farLip: PARKOUR.wallRun.gap / 2, farEnd: 24,
  floor: LEVEL.gallery, ceil: LEVEL.gallery + PARKOUR.wallRun.headroom,
  /**
   * Seven metres down, so the far deck cannot be climbed from the trench: a double jump, a kick off the wall and a mantle together
   * reach about six.
   */
  trench: -12,
} as const;

/** Down from the far platform to the near deck. It arrives side-on at the lip end, so the deck is the whole run-up: see PARKOUR's note on strafing. */
export const GALLERY_STAIR = { top: -24, foot: -14, north: -71.4, south: -68.4, landing: -11 } as const;
/** Up from the far deck into the kitchen. */
export const KITCHEN_STAIR = { foot: 24, top: 34, north: -76, south: -73 } as const;

export const STACK = {
  x0: -10, x1: 10, north: -64, south: -28,
  /** The central well. Galleries run round it on every level. */
  well: rect(-4, -58, 4, -34),
  /** The north-east shaft: two pairs of facing walls, 5 m apart, for kicking up. */
  shaft: rect(5, -64, 10, -59),
  stairW: 2.5,
} as const;

export const WAR = { x0: -16, x1: 16, north: -78, south: -66, floor: LEVEL.command, bayEdge: -11 } as const;
/** The way to the roof, in the west bay of the War Room. */
export const ROOF_STAIR = { x: -13.7, w: 3.2, foot: -75, top: -67 } as const;
export const COMMS = rect(-24, -80, 24, -26);

export type Face = 'poured' | 'plate' | 'ply' | 'tile' | 'raw';

export interface Room extends Rect {
  /** Zone id. Starts with an audio room name, because roomForZone matches by substring. */
  id: string;
  name: string;
  /** The stencil that names it on its walls, if any. */
  word?: StencilName;
  y: number;
  ceil: number;
  floor: Mat;
  floorTint: Rgb;
  face: Face;
  /** Band round the walls, door jambs and its fill on the minimap. */
  paint: Rgb;
}

const room = (id: string, name: string, r: Rect, y: number, ceil: number, floor: Mat, floorTint: Rgb, face: Face, paint: Rgb, word?: StencilName): Room =>
  ({ id, name, ...r, y, ceil, floor, floorTint, face, paint, word });

const STEEL: Rgb = [1, 1, 1];
const COLD: Rgb = [0.82, 0.85, 0.9];

/** The way the raid runs, clockwise. Each is a different material and a different colour, so a door opening says where it goes. */
export const SALLY = room('transit-sally', 'SALLY HALL', rect(-10, -26, 10, -14), 0, 4.4, 'concreteDark', STEEL, 'plate', [0.95, 0.72, 0.14], 'SALLY');
export const SOUTH_CORRIDOR = room('refinery-south', 'SOUTH CORRIDOR', rect(-56, -19, -10, -16), 0, 3.2, 'concreteDark', COLD, 'poured', [0.86, 0.22, 0.16]);
export const NORTH_CORRIDOR = room('refinery-north', 'NORTH CORRIDOR', rect(-56, -44, -12, -41), 0, 3.2, 'concreteDark', COLD, 'poured', [0.2, 0.42, 0.95]);
const bunk = (n: number, x0: number, x1: number, floor: Mat, face: Face, paint: Rgb): Room =>
  room(`scrapyard-bunk${n}`, `BUNK ${n}`, rect(x0, -40, x1, -20), 0, 3.2, floor, STEEL, face, paint);
export const BUNKS: readonly Room[] = [
  bunk(1, -22, -12, 'concrete', 'ply', [0.55, 0.7, 0.3]),
  bunk(2, -33, -23, 'concrete', 'ply', [0.3, 0.72, 0.62]),
  bunk(3, -44, -34, 'tile', 'tile', [0.6, 0.78, 0.92]),
  bunk(4, -56, -45, 'concreteDark', 'plate', [0.82, 0.5, 0.2]),
];
export const COOLANT_HALL = room('core-coolant', 'COOLANT HALL', rect(COOLANT.x0, COOLANT.north, COOLANT.x1, COOLANT.south), 0, HALL_TOP, 'concreteDark', [0.78, 0.84, 0.9], 'plate', [0.1, 0.78, 0.86]);
export const CABLE_GALLERY = room('refinery-gallery', 'CABLE GALLERY', rect(GALLERY.nearEnd, GALLERY.north, GALLERY.farEnd, GALLERY.south), GALLERY.floor, GALLERY.ceil, 'concreteDark', [0.7, 0.72, 0.76], 'raw', [0.14, 0.82, 1], 'GALLERY');
export const KITCHEN = room('scrapyard-kitchen', 'KITCHEN', rect(14, -78, 56, -70), 0, 3.4, 'tile', STEEL, 'tile', [0.86, 0.34, 0.2]);
export const MESS = room('foundry-mess', 'MESS HALL', rect(14, -69, 56, -46), 0, 4.6, 'tile', [0.7, 0.68, 0.64], 'ply', [0.9, 0.52, 0.16], 'MESS');
export const EAST_CORRIDOR = room('refinery-east', 'EAST CORRIDOR', rect(12, -44, 56, -41), 0, 3.2, 'concreteDark', COLD, 'poured', [0.72, 0.3, 0.9]);
export const ARMOURY = room('scrapyard-armoury', 'ARMOURY', rect(30, -40, 56, -33), 0, 3.4, 'concreteDark', STEEL, 'plate', [0.16, 0.86, 0.5], 'ARMOURY');
export const GUARD = room('scrapyard-guard', 'GUARD ROOM', rect(12, -40, 29, -33), 0, 3.2, 'concrete', COLD, 'poured', [0.86, 0.8, 0.3]);
export const PLATE = room('transit-plate', 'PLATE HALL', rect(12, -32, 56, -16), 0, 4.6, 'concreteDark', [0.86, 0.88, 0.94], 'plate', [0.9, 0.92, 0.98]);
export const STACK_ROOM = room('core-stack', 'THE STACK', rect(STACK.x0, STACK.north, STACK.x1, STACK.south), LEVEL.gallery, 13.4, 'concreteDark', STEEL, 'poured', [0.95, 0.16, 0.12], 'STACK');
export const WAR_ROOM = room('scrapyard-war', 'WAR ROOM', rect(WAR.x0, WAR.north, WAR.x1, WAR.south), WAR.floor, WAR_CEIL, 'concreteDark', [0.6, 0.62, 0.68], 'plate', [0.95, 0.2, 0.14]);

export const ROOMS: readonly Room[] = [
  SALLY, SOUTH_CORRIDOR, NORTH_CORRIDOR, ...BUNKS, COOLANT_HALL, CABLE_GALLERY, KITCHEN, MESS, EAST_CORRIDOR, ARMOURY, GUARD, PLATE, STACK_ROOM, WAR_ROOM,
];

/** The room whose floor is nearest under (x, y, z), so the gallery does not read as the kitchen above it. */
export function roomAt(x: number, y: number, z: number): Room | null {
  let best: Room | null = null;
  for (const r of ROOMS) {
    if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1 || y < r.y - 0.5 || y > r.ceil + 0.5) continue;
    if (!best || r.y > best.y) best = r;
  }
  return best;
}

/** Takes `hole` out of `rects`, leaving long east-west strips so a run along a room crosses as few seams as it can. */
export function carve(rects: readonly Rect[], hole: Rect): Rect[] {
  const out: Rect[] = [];
  for (const r of rects) {
    if (hole.x0 >= r.x1 || hole.x1 <= r.x0 || hole.z0 >= r.z1 || hole.z1 <= r.z0) { out.push(r); continue; }
    if (r.z0 < hole.z0) out.push({ ...r, z1: hole.z0 });
    if (hole.z1 < r.z1) out.push({ ...r, z0: hole.z1 });
    const z0 = Math.max(r.z0, hole.z0), z1 = Math.min(r.z1, hole.z1);
    if (r.x0 < hole.x0) out.push({ x0: r.x0, z0, x1: hole.x0, z1 });
    if (hole.x1 < r.x1) out.push({ x0: hole.x1, z0, x1: r.x1, z1 });
  }
  return out;
}

export const carveAll = (from: Rect, holes: readonly Rect[]): Rect[] => holes.reduce<Rect[]>((rs, h) => carve(rs, h), [from]);

/**
 * Where vehicles may go, as centre lines. Every ground route in `outpost.places.ts` runs on one of these, and the proof sheet sweeps a
 * tank's width along each and fails if anything solid stands on it.
 */
export const ROADS = [
  { id: 'perimeter', points: [[-EDGE, 34], [EDGE, 34]], width: 9 },
  { id: 'gate', points: [[0, 34], [0, -6]], width: 14 },
] as const;

/** Cover lines on the apron. Staggered so each lane can be crossed in bounds and never in one run. */
export const COVER_A = 70, COVER_B = 54, COVER_C = 42;
