/**
 * The Kill House on paper: three concentric squares and eight dividers, built as one quarter turned four times.
 *
 *   yard            a ring around the building. Gates in the perimeter, S-bends of T-walls stop the long sightlines
 *   8 rooms         four square corners and four long halls, numbered clockwise from the north-west
 *   ring corridor   one lap of the court
 *   court           the middle, under the floodlight tower
 *
 * The pinwheel is the point: no door has a partner straight across the map, so a sightline dies within a room or two,
 * while every room still has at least three exits. Going inward always leads to the court, outward to the yard.
 *
 * Quarter frames: everything below is authored on the north side, and `rot(i)` carries it clockwise.
 */
import type { Mat } from '../../kit/geo';

export const KH = {
  wallH: 4.2,
  /** Walking surface of the catwalks. Their decks sit straight on the walls, so there is no gap to wedge into. */
  deck: 4.5,
  deckW: 4,
  perimeterH: 7.5,
  /** Invisible extension of the perimeter, so a rocket jump cannot leave the map. */
  containment: 26,
  /** Wall centre lines. */
  outer: 26,
  ring: 14.5,
  court: 9,
  perimeter: 35.5,
  outerHalf: 0.5,
  innerHalf: 0.4,
  perimeterHalf: 0.5,
  /** Yard corners are cut on this line (|x| + |z|). Opposite corners set the longest walk in the map, and each cut holds a gate. */
  chamfer: 59,
  door: 4,
  courtDoor: 5,
  gateW: 6,
  cornerGateW: 5,
  gateDepth: 3,
  /** Waist-high cover: below the eye, above the hip, and low enough to vault at speed. */
  waist: 1.15,
} as const;

/** What a wall's collider adds to its concrete core. Panels and paint stay inside it. */
export const SKIN = 0.06;

const OUT = KH.outer - KH.outerHalf;
const RO = KH.ring + KH.innerHalf;
const RI = KH.ring - KH.innerHalf;
const CO = KH.court + KH.innerHalf;
const CI = KH.court - KH.innerHalf;
export const YARD_IN = KH.outer + KH.outerHalf;
export const YARD_OUT = KH.perimeter - KH.perimeterHalf;
/** Inner faces of the walls. */
export const FACES = { out: OUT, ringOut: RO, ringIn: RI, courtOut: CO, courtIn: CI } as const;

/** Carries a north-side point `i` quarter turns clockwise, seen from above. */
export function rot(i: number, x: number, z: number): [number, number] {
  switch (i & 3) {
    case 1: return [-z, x];
    case 2: return [-x, -z];
    case 3: return [z, -x];
    default: return [x, z];
  }
}

export interface Rect { x0: number; z0: number; x1: number; z1: number }

export function rotRect(i: number, x0: number, z0: number, x1: number, z1: number): Rect {
  const [ax, az] = rot(i, x0, z0), [bx, bz] = rot(i, x1, z1);
  return { x0: Math.min(ax, bx), z0: Math.min(az, bz), x1: Math.max(ax, bx), z1: Math.max(az, bz) };
}

export type Rgb = readonly [number, number, number];
export type Face = 'poured' | 'ply' | 'tile' | 'plate';

export interface Space {
  /** Zone id. Starts with an audio room name, because roomForZone matches by substring. */
  id: string;
  name: string;
  /** Number stencilled on the walls. 0 for spaces that have none. */
  n: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  floor: Mat;
  floorTint: Rgb;
  face: Face;
  /** Band, stencils, door jambs and the room's fill on the minimap. */
  paint: Rgb;
}

const room = (n: number, name: string, r: Rect, floor: Mat, floorTint: Rgb, face: Face, paint: Rgb): Space => ({
  id: `scrapyard-room${n}`, name, n, ...r, floor, floorTint, face, paint,
});
const corner = (i: number) => rotRect(i, -OUT, -OUT, -RO, -RO);
const hall = (i: number) => rotRect(i, -RI, -OUT, RI, -RO);

/** Roofless concrete boxes sound like the open yard, so the rooms use its short reverb and not the default hall. */
export const ROOMS: readonly Space[] = [
  room(1, 'TYRES', corner(0), 'dirt', [0.82, 0.86, 0.84], 'poured', [0.1, 0.68, 0.52]),
  room(2, 'LANES', hall(0), 'concrete', [0.78, 0.8, 0.84], 'ply', [0.92, 0.94, 0.98]),
  room(3, 'CRATES', corner(1), 'concreteDark', [1, 1, 1], 'plate', [0.14, 0.74, 0.98]),
  room(4, 'STREET', hall(1), 'asphalt', [1, 1, 1], 'poured', [0.2, 0.36, 1]),
  room(5, 'SANDBAGS', corner(2), 'dirt', [0.96, 0.9, 0.78], 'poured', [0.62, 0.68, 0.34]),
  room(6, 'PLYWOOD', hall(2), 'concrete', [0.72, 0.72, 0.74], 'ply', [0.58, 0.32, 0.96]),
  room(7, 'TILES', corner(3), 'tile', [1, 1, 1], 'tile', [0.06, 0.07, 0.09]),
  room(8, 'PLANT', hall(3), 'concreteDark', [0.9, 0.9, 0.94], 'plate', [0.9, 0.22, 0.78]),
];

export const COURT: Space = {
  id: 'ring-court', name: 'COURT', n: 0, x0: -CI, z0: -CI, x1: CI, z1: CI, floor: 'concrete', floorTint: [0.86, 0.88, 0.92], face: 'poured', paint: [0.86, 0.9, 1],
};
/** Parallel concrete walls flutter, which is what the refinery room models. */
export const CORRIDOR: Space = {
  id: 'refinery-corridor', name: 'RING', n: 0, x0: -RI, z0: -RI, x1: RI, z1: RI, floor: 'concreteDark', floorTint: [0.9, 0.92, 0.98], face: 'poured', paint: [0.34, 0.8, 1],
};
const YE = YARD_OUT + KH.gateDepth + 1;
export const YARD: Space = {
  id: 'ring-yard', name: 'YARD', n: 0, x0: -YE, z0: -YE, x1: YE, z1: YE, floor: 'asphalt', floorTint: [0.8, 0.82, 0.86], face: 'poured', paint: [0.5, 0.56, 0.62],
};

/** In priority order: the court sits inside the corridor's box, and everything sits inside the yard's. */
export const SPACES: readonly Space[] = [COURT, CORRIDOR, ...ROOMS, YARD];

export function spaceAt(x: number, z: number): Space | null {
  for (const s of SPACES) if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return s;
  return null;
}

export interface WallDef {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  half: number;
  h: number;
  /** Door spans in meters from A. */
  doors: readonly (readonly [number, number])[];
  /** Carries a catwalk, so its top is hidden. */
  decked: boolean;
  perimeter: boolean;
}

interface WallOpts { half?: number; h?: number; decked?: boolean; perimeter?: boolean; door?: number }

const line = (ax: number, az: number, bx: number, bz: number, centres: readonly number[], o: WallOpts): WallDef => {
  const w = o.door ?? KH.door;
  return {
    ax, az, bx, bz, half: o.half ?? KH.innerHalf, h: o.h ?? KH.wallH, decked: o.decked ?? false, perimeter: o.perimeter ?? false,
    doors: centres.map(c => [c - w / 2, c + w / 2] as const),
  };
};
/** East-west wall. Door centres are world X. */
const H = (z: number, x0: number, x1: number, doors: readonly number[], o: WallOpts = {}) => line(x0, z, x1, z, doors.map(d => d - x0), o);
/** North-south wall. Door centres are world Z. */
const V = (x: number, z0: number, z1: number, doors: readonly number[], o: WallOpts = {}) => line(x, z0, x, z1, doors.map(d => d - z0), o);

const shell: WallOpts = { half: KH.outerHalf };
const ringWall: WallOpts = { decked: true };
const perimeter: WallOpts = { half: KH.perimeterHalf, h: KH.perimeterH, perimeter: true, door: KH.gateW };
const P = KH.perimeter, O = KH.outer + KH.outerHalf;
/** Half the cut wall's centre line, which sits half a thickness outside the yard face. */
const CUT = KH.chamfer / 2 + KH.perimeterHalf * Math.SQRT1_2;
/** Where the straight perimeter walls meet the cut. */
const PS = 2 * CUT - P;
/** Divider doors sit flush with the shell, in line with the ramp, so a sprint through one goes straight up it. */
const DIVIDER_DOOR = -OUT + KH.door / 2;
/** Ring doors stop at the court's corner. Any further and a line runs through two of them down the length of the corridor. */
const RING_DOOR = CO - KH.door / 2;

const quarter: readonly WallDef[] = [
  H(-P, -PS, PS, [0], perimeter),
  // Ends run past the straight walls so the corner joints are overlaps, not seams.
  line(PS - 0.4, -P - 0.4, P + 0.4, -PS + 0.4, [], perimeter),
  // Corner rooms get a yard door on both outer walls, because the far corners of the yard are what the longest walk is made
  // of. Halls get one either side of the gate. The east one opens at the foot of the ramp, so the catwalks are one straight
  // run from outside.
  H(-KH.outer, -O, O, [-19.5, -12, 12, 19.5], shell),
  H(-KH.ring, -RO, RO, [-RING_DOOR, RING_DOOR], ringWall),
  V(-KH.ring, -OUT, -RO, [DIVIDER_DOOR]),
  V(KH.ring, -OUT, -RO, [DIVIDER_DOOR]),
  // On the far side from the ring door it faces, or court, ring and yard doors fall on one line out from the centre.
  H(-KH.court, -CO, CO, [-3.5], { door: KH.courtDoor }),
];

const turnWall = (w: WallDef, i: number): WallDef => {
  const [ax, az] = rot(i, w.ax, w.az), [bx, bz] = rot(i, w.bx, w.bz);
  return { ...w, ax, az, bx, bz };
};
export const WALLS: readonly WallDef[] = [0, 1, 2, 3].flatMap(i => quarter.map(w => turnWall(w, i)));

/** The ramp of a hall, in the north frame: up the shell from the east, onto a solid pier, then a bridge over to the catwalk. */
export const RAMP = {
  footX: 10,
  topX: -1,
  /** Centre line. */
  z: -OUT + KH.deckW / 2,
  pierX: -5,
  bridgeX: -3,
} as const;

export interface GateDef {
  /** Centre of the opening on the yard face. */
  x: number;
  z: number;
  /** Local +X points out of the map. */
  yaw: number;
  w: number;
  /**
   * A gate on a straight wall is a real bay. A corner gate is a sally port, a shutter on the wall face: opposite corners
   * of the yard are the two farthest places on the map, and a bay behind each would put another 8 m on the longest walk.
   */
  bay: boolean;
}

const gatePair = (i: number): GateDef[] => {
  const [nx, nz] = rot(i, 0, -YARD_OUT), [cx, cz] = rot(i, KH.chamfer / 2, -KH.chamfer / 2);
  const turn = (i * Math.PI) / 2;
  return [{ x: nx, z: nz, yaw: Math.PI / 2 - turn, w: KH.gateW, bay: true }, { x: cx, z: cz, yaw: Math.PI / 4 - turn, w: KH.cornerGateW, bay: false }];
};
export const GATES: readonly GateDef[] = [0, 1, 2, 3].flatMap(gatePair);
