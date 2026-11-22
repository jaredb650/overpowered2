/**
 * Holdfast on paper: every number the map is built to, and the data other systems read. No three.js. x east, z south, y up, north is
 * -z, the salt flats at y 0. docs/notes/holdfast.md draws it; `foreclosure.places.ts` names the marks the mission uses on it.
 *
 * The town is the east two thirds: the Flats and the outer shanties south of its wall, the Market and the Square inside it, the stacks
 * north of the Market, the quay, the Slip and the harbour wall along the sea. West of its west wall, through the west gate, the Pans.
 */
import { PARKOUR } from '../../../campaign/parkour';

export type Rgb = readonly [number, number, number];
export type Vec = readonly [number, number, number];
export interface Rect { x0: number; z0: number; x1: number; z1: number }
export const rect = (x0: number, z0: number, x1: number, z1: number): Rect => ({ x0, z0, x1, z1 });

/** The invisible walls. Everything a body can reach is inside. */
export const SITE = { x0: -166, x1: 163, z0: -112.5, z1: 122 } as const;
/** Nav, the minimap and the light bake stop a little past the site. */
export const BOUNDS = { x0: -168, x1: 166, z0: -116, z1: 124 } as const;
/** Ground and sea are drawn out to here, so the salt runs to the horizon. */
export const HORIZON = 180;
export const SKY = 50;

/** Every floor a man stands on, and so the nav's levels. Stack tops, cranes and the flak tower's top are not floors. */
export const LEVEL = {
  slip: -6,
  ground: 0,
  /** The timber firing step behind the town wall: a standing eye clears the 3 m wall by about 0.3 m (structures.ts, WALL.catwalk). */
  step: 1.7,
  /** The wall guns' pads: the gun's trunnion clears the wall. */
  pad: 2.1,
  /** Flat roofs in the shanties and the Market, with stairs up. */
  roof: 3,
  /** The harbour wall's walk. */
  harbour: 4,
  /** The quay crane's machinery deck: the crane cab over the quay. */
  quayDeck: 6,
  /** The east stacks' top, where the militia's snipers lie. */
  stack: 7.8,
} as const;

/** The containers, the kit's (props.ts, CONTAINER). One high is a jump; two is a wall climb; four is out of any climb's reach. */
export const BOX = { l: 12.2, w: 2.5, h: 2.6 } as const;

// -------------------------------------------------------------------------------------------------
// The town wall and the two gates
// -------------------------------------------------------------------------------------------------

/** The south wall: the fort's plain 3 m kit (structures.ts WALL), from the dyke to the sea. */
export const WALL_Z = 50;
export const WALL_X0 = -10;
export const WALL_X1 = 163;
/** The main gate: a shut steel gate, blown (400 health) or bypassed by the charge on the marked segment. */
export const MAIN_GATE = { x: 70, half: 3 } as const;
/** The wall segment painted for the 14th's breaching charge. */
export const BREACH = { x: 55, z: WALL_Z } as const;
/** The wall guns: a timber pad behind the wall, the gun facing south over it. */
export const WALL_GUNS: readonly { x: number; z: number }[] = [{ x: 40, z: 48.2 }, { x: 100, z: 48.2 }];
/** The pad's half-width along the wall, and its north and south edges. */
export const PAD = { half: 2.2, z0: 44.6, z1: 49.4 } as const;
/** Stretches of firing step behind the wall, x from and to. Off the gate, off the pads. */
export const STEPS: readonly (readonly [number, number])[] = [[6, 36], [46, 61], [79, 96], [106, 136]];
export const STEP = { from: 0.3, to: 2.4 } as const;

/** The west wall runs north from the dyke to the harbour wall, the west gate in it: 8 m, wide enough for the Frame. */
export const WEST_X = -10;
export const WEST_GATE = { z: -20, half: 4 } as const;
/** South of the wall line the town is closed off from the Pans by the salt dyke: a steep bank, no climb. */
export const DYKE = { x0: -15, x1: -9.3, z0: 49.6, z1: 122, h: 7 } as const;

// -------------------------------------------------------------------------------------------------
// Outside the wall: the Flats and the outer shanties
// -------------------------------------------------------------------------------------------------

/** The LZ the gunship circles and the 14th land on. Painted on the salt, kept clear (the test drops rays on it). */
export const LZ = { x: 40, z: 95, radius: 11 } as const;
/** The militia's trench across the shanties: two earth banks with a 2.4 m walk between, zig-zagging. White phosphorus goes in it. */
export const TRENCH: readonly (readonly [number, number])[] = [[30, 69], [37, 64], [44, 69], [51, 64], [58, 69]];
export const TRENCH_W = 2.4;
/** The fuel farm in the east shanties: three tanks and drums behind a berm. The glide bomb's target. */
export const FUEL = { x: 151, z: 66, r: 3.6, h: 6, berm: rect(140, 55, 161, 76) } as const;
export const FUEL_TANKS: readonly (readonly [number, number])[] = [[146, 61.5], [156, 61.5], [151, 70.5]];
/** Two shanty houses with a gun on the roof: roof guns for the gunship and the landing. */
export const ROOF_GUNS: readonly { x: number; z: number; yaw: number }[] = [{ x: 28, z: 78, yaw: Math.PI }, { x: 106, z: 74, yaw: Math.PI }];

// -------------------------------------------------------------------------------------------------
// The Market and the Square
// -------------------------------------------------------------------------------------------------

export const SQUARE = rect(58, 16, 82, 40);
/** The street from the gate to the Square. */
export const MAIN_STREET = rect(66, 40, 74, WALL_Z - 0.5);
/** Along the stacks' south face, the whole width of the town. */
export const CRANE_STREET = rect(-8, 8, 163, 15);
/** The Market's east-west street, east of the Square: 6 m, the Frame's way through. West of the Square it narrows to a lane. */
export const SALT_STREET = rect(82, 26, 163, 32);
/** The street from Salt Street north to Crane Street and on as the quay road. */
export const QUAY_STREET = rect(116, 15, 122, 42);
/** The lane behind the wall, from the firing steps to the first row of houses. */
export const WALL_LANE = { z0: 42, z1: WALL_Z - 0.3 } as const;

/**
 * Market blocks between lanes 3 to 5 m wide. Each has a terrace of painted houses along one face (`row`), its flat roof a floor
 * (LEVEL.roof) for riflemen with stairs up behind it, and a row of shacks along the other face with alleys between them into the yard.
 * `tower` puts a tall house on the block instead: over the roofs, not a floor.
 */
export interface Block extends Rect {
  id: string;
  row: 'n' | 's';
  /** Which end of the terrace its stairs climb from: -1 west, 1 east. */
  stair: -1 | 1;
  tower?: boolean;
}
export const BLOCKS: readonly Block[] = [
  { id: 'w1', ...rect(-6, 17, 10, 27), row: 'n', stair: 1 },
  { id: 'w2', ...rect(14, 17, 30, 27), row: 's', stair: -1 },
  { id: 'w3', ...rect(34, 17, 55, 27), row: 'n', stair: 1 },
  { id: 'w4', ...rect(-6, 31, 10, 41), row: 's', stair: 1 },
  { id: 'w5', ...rect(14, 31, 30, 41), row: 'n', stair: 1 },
  { id: 'w6', ...rect(34, 31, 55, 41), row: 's', stair: -1 },
  { id: 'e1', ...rect(85, 17, 98, 26), row: 'n', stair: -1 },
  { id: 'e2', ...rect(102, 17, 114, 26), row: 's', stair: 1 },
  { id: 'e3', ...rect(124, 17, 140, 26), row: 'n', stair: -1 },
  { id: 'e4', ...rect(144, 17, 160, 26), row: 's', stair: 1 },
  { id: 'e5', ...rect(85, 32, 98, 41), row: 'n', stair: 1, tower: true },
  { id: 'e6', ...rect(102, 32, 114, 41), row: 'n', stair: -1 },
  { id: 'e7', ...rect(124, 32, 140, 41), row: 's', stair: 1 },
  { id: 'e8', ...rect(144, 32, 160, 41), row: 'n', stair: -1 },
];
/** Depth of a terrace row and its roof. */
export const TERRACE = { depth: 4.5, h: LEVEL.roof } as const;

/**
 * Stalls: posts, a dyed awning and a counter you can crouch behind. Static for now, and listed so stage 5's `stall` structure can take
 * them over by position. x, z, yaw (the kit's: the counter runs along local x, the buyer stands on +z), awning colour index.
 */
export const STALLS: readonly (readonly [number, number, number, number])[] = [
  // Round the Square, facing in.
  [61, 19.5, Math.PI, 0], [64.5, 19.5, Math.PI, 1], [76, 19.5, Math.PI, 2], [61, 36.5, 0, 3], [79, 36.5, 0, 4],
  [61.5, 27, -Math.PI / 2, 5], [78.5, 23, Math.PI / 2, 6],
  // Down the west lanes.
  [12, 21, Math.PI / 2, 0], [12, 37, -Math.PI / 2, 2], [32, 23, Math.PI / 2, 4], [32, 35, -Math.PI / 2, 6], [45, 29, 0, 1], [24, 29, Math.PI, 3],
  // The east lanes.
  [100, 21, Math.PI / 2, 5], [100, 36, -Math.PI / 2, 0], [142, 21, Math.PI / 2, 2], [142, 36, -Math.PI / 2, 4],
  // Crane Street.
  [24, 14.2, Math.PI, 0], [92, 14.2, Math.PI, 3], [138, 14.2, Math.PI, 5],
];
export const STALL = { w: 3, d: 1.6, counter: 1.05, awning: 2.5 } as const;

/** Dyed sailcloth, paint and bunting: the town's colours. No Bureau red. */
export const DYES: readonly Rgb[] = [
  [0.95, 0.62, 0.12], [0.12, 0.62, 0.78], [0.86, 0.28, 0.52], [0.24, 0.7, 0.42], [0.56, 0.32, 0.78], [0.96, 0.84, 0.3], [0.2, 0.78, 0.74],
];
export const PAINTS: readonly Rgb[] = [
  [0.82, 0.42, 0.28], [0.24, 0.5, 0.72], [0.9, 0.74, 0.32], [0.36, 0.62, 0.46], [0.84, 0.5, 0.62], [0.88, 0.85, 0.76],
  [0.52, 0.4, 0.7], [0.3, 0.68, 0.7], [0.92, 0.58, 0.26],
];

// -------------------------------------------------------------------------------------------------
// The stacks
// -------------------------------------------------------------------------------------------------

/** The crane aisle: 12 m between the west and east stacks, Crane Street to the quay. The killing ground. */
export const AISLE = { x0: 50.5, x1: 62.5, z0: -44, z1: 8 } as const;

/** A solid block of containers: one collider, the boxes drawn on its faces and top. `along` x means containers lie east-west. */
export interface Stack extends Rect {
  id: string;
  levels: number;
  along: 'x' | 'z';
  /** Refuses the wall climb: a face a lesson needs out of reach (Kit.noClimb). */
  noClimb?: boolean;
}

const L = BOX.l, W = BOX.w;
/** The east faces of the west stacks line the aisle. */
const E = AISLE.x0;
/** Rows of the west stacks, south to north. */
const ROW = { aS: 8, aN: 8 - 3 * W, bN: 8 - 9 * W, cS: 8 - 9 * W - PARKOUR.stacks.gap, c1N: 8 - 16 * W, cN: AISLE.z0 } as const;
/** The chimney between the two halves of B: two climbable liners, this far apart, from the ground to B's top. */
export const CHIMNEY = { x0: E - L - PARKOUR.stacks.chimney.width, x1: E - L, z0: ROW.bN, z1: ROW.aN, w: PARKOUR.stacks.chimney.width } as const;

export const STACKS: readonly Stack[] = [
  // The parkour route, west of the aisle (PARKOUR.stacks). A: a wall climb from Crane Street, two high.
  { id: 'A', ...rect(E - 3 * L, ROW.aN, E, ROW.aS), levels: 2, along: 'x' },
  // B: four high, in two halves either side of the chimney. No climb, so the chimney is the only way up from A.
  { id: 'Bw', ...rect(CHIMNEY.x0 - 2 * L, ROW.bN, CHIMNEY.x0, ROW.aN), levels: 4, along: 'x', noClimb: true },
  { id: 'Be', ...rect(CHIMNEY.x1, ROW.bN, E, ROW.aN), levels: 4, along: 'x', noClimb: true },
  // One high across the gap between B and C, so the gap is a jump on top and no alley underneath.
  { id: 'gap', ...rect(E - 3 * L, ROW.cS, E, ROW.bN), levels: 1, along: 'x' },
  { id: 'C1', ...rect(E - 3 * L, ROW.c1N, E, ROW.cS), levels: 4, along: 'x' },
  { id: 'C2', ...rect(E - 3 * L, ROW.cN, E, ROW.c1N), levels: 3, along: 'x' },
  // East of the aisle: the militia's. E1 has stairs to its top, E2 is a wall.
  { id: 'E1', ...rect(AISLE.x1, -43.9, AISLE.x1 + 7 * W, -43.9 + 4 * L), levels: 3, along: 'z' },
  { id: 'E2', ...rect(AISLE.x1 + 7 * W + 5, -43.9, AISLE.x1 + 15 * W + 5, -43.9 + 4 * L), levels: 2, along: 'z' },
  // The barricade that shuts the west road off from Crane Street: two high, on its side.
  { id: 'barricade', ...rect(WEST_X + 0.3, -12.5, CHIMNEY.x0 - 2 * L, -10), levels: 3, along: 'x', noClimb: true },
];
export const stack = (id: string): Stack => STACKS.find(s => s.id === id)!;
export const stackTop = (s: Stack): number => s.levels * BOX.h;

/** The lane between E1 and E2, and the stairs up E1's east face in it. */
export const E1_STAIR = { x0: stack('E1').x1 + 0.1, x1: stack('E1').x1 + 2.5, foot: -2, top: -2 - 14 } as const;

/**
 * The gantry crane over the west stacks and the aisle: a girder at `deck` on two legs. The west leg is two plates with a chimney
 * between them from the ground to the girder's top; the cab with the Sabot in it sits on the girder over the stacks.
 */
export const GANTRY = {
  z0: -22, z1: -18, x0: -7, x1: 67, under: 20.5, deck: 22,
  /** The west leg: plates at x 4.4..5.6 and 7.1..8.3, the chimney between. */
  leg: { x0: 4.4, x1: 8.3, gap0: 5.6, gap1: 7.1 },
  /** The east leg, a plain column standing on E1's top. */
  east: { x0: 63, x1: 66 },
  cab: rect(27, -22.5, 34, -17.5),
} as const;

// -------------------------------------------------------------------------------------------------
// The quay, the Slip, the harbour
// -------------------------------------------------------------------------------------------------

/** The quay apron: the road along the stacks' north face, from the west road to the east quay. Grandad holds its middle. */
export const APRON = rect(-8, -56, 163, -44);
/** The quay road up the stacks' east side, from Crane Street to the apron. */
export const QUAY_ROAD = rect(110, -56, 125, 15);
/** The road west of the stacks, from the harbour quay down to the barricade: the way to the west gate. */
export const WEST_ROAD = rect(-8, -105, 3, -12.5);
/** The road from the apron north to the flak tower's foot. */
export const TOWER_ROAD = rect(8, -98, 26, -56);

/** The dry dock. Floor at LEVEL.slip, ramps down on three sides, the caisson to the north. */
export const SLIP = rect(84, -92, 152, -56);
export const SLIP_RAMPS = {
  south: { x0: 111, x1: 125, top: -56, foot: -72 },
  west: { z0: -90, z1: -78, top: 84, foot: 100 },
  east: { z0: -90, z1: -78, top: 152, foot: 136 },
} as const;

/** The quay crane at the Slip's west end: a deck on four legs, stairs up from the apron. The checkpoint over the quay. */
export const QUAY_CRANE = { ...rect(66, -64, 78, -57), deck: LEVEL.quayDeck, stair: { z: -58.6, foot: 54, top: 66, w: 2.4 } } as const;

/** The harbour wall: a sea wall with a walk on top, the sea north of it. */
export const HARBOUR = { z0: -112, z1: -105, walk: LEVEL.harbour, parapet: 1.1 } as const;
/** Stairs up the harbour wall's town face, hugging it from x0 (the foot) east to x0 + 7 (the walk). */
export const HARBOUR_STAIRS: readonly number[] = [-8, 30, 140];
/** The flak tower on the harbour wall: concrete to `top`, four guns on its corners. */
export const FLAK = { ...rect(12, -112, 28, -98), top: 24 } as const;
export const FLAK_GUNS: readonly Vec[] = [[14, FLAK.top, -110], [26, FLAK.top, -110], [14, FLAK.top, -100], [26, FLAK.top, -100]];

/** The boat shed in the north yard: an open steel frame, a rusting hull on its slipway. */
export const SHED = { ...rect(30, -92, 62, -64), h: 13 } as const;
/** The cannery on the east quay: a long painted shed, a wall to the quay road's east. */
export const CANNERY = { ...rect(130, -40, 158, -2), h: 9 } as const;

/** The sea, past the harbour wall and the east quay. */
export const SEA = { y: -2.6, eastX: 163 } as const;

// -------------------------------------------------------------------------------------------------
// The Pans
// -------------------------------------------------------------------------------------------------

/** Open salt west of the town. Old Mother circles this ellipse. */
export const PANS = { x0: -164, x1: WEST_X - 2, z0: -112, z1: 120, loop: { x: -86, z: 0, rx: 52, rz: 78 } } as const;

// -------------------------------------------------------------------------------------------------
// Roads, for vehicles: the proof sweeps a technical's width down each
// -------------------------------------------------------------------------------------------------

export const ROADS: readonly { id: string; points: readonly (readonly [number, number])[]; width: number }[] = [
  { id: 'flats', points: [[-4, 113], [160, 113]], width: 8 },
  { id: 'westTrack', points: [[8, 118], [14, 86], [20, 58.5], [60, 58.5]], width: 6 },
  { id: 'eastTrack', points: [[150, 118], [146, 86], [120, 58.5], [80, 58.5]], width: 6 },
  { id: 'quayRoad', points: [[117.5, 13], [117.5, -50]], width: 8 },
  { id: 'apron', points: [[-4, -50], [160, -50]], width: 9 },
  { id: 'westRoad', points: [[-3, -100], [-3, -14]], width: 8 },
  { id: 'saltStreet', points: [[84, 29], [160, 29]], width: 4.4 },
];

/** Where men come from when nothing names a mark: the town's back lanes and yards, the shanties, the harbour. Helicopters from the sea. */
export const HOLDFAST_SPAWNS = {
  foot: [
    [12, 0, 29], [150, 0, 29], [83, 0, -20], [140, 0, 4], [-2, 0, -70], [100, 0, -98], [157, 0, -80], [4, 0, 62], [156, 0, 82],
    [2, 0, 118], [80, 0, 118], [-2, 0, 2],
  ],
  air: [[60, 30, -108], [130, 30, -108], [-60, 30, 0], [80, 30, 120]],
} as const;

/** The 3.6 m the Frame needs, and the height it stands to: a swept box this wide and tall must clear every route it walks. */
export const FRAME = { width: 3.6, step: 1.2, height: 6.4 } as const;

export interface BarracksDef {
  readonly tag: string;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly spawn: Vec;
  readonly label: string;
}

/**
 * Five enterable Tier-1 masonry garrison barracks across Holdfast: troops emerge from their doorways until flattened
 * with Satchel Charges, rockets, or the Distraint Frame. Clear of LZ, ROADS, ROUTES, TRENCH, FUEL, SLIP, and PLACES.
 */
export const BARRACKS: readonly BarracksDef[] = [
  { tag: 'barracks.flats', x: 68, z: 92, yaw: -Math.PI / 2, spawn: [62, 0, 92], label: 'FLATS GARRISON BARRACKS' },
  { tag: 'barracks.market', x: 132, z: 37.5, yaw: Math.PI, spawn: [132, 0, 31.5], label: 'MARKET GARRISON BARRACKS' },
  { tag: 'barracks.stacks', x: 102, z: 10.8, yaw: Math.PI / 2, spawn: [108, 0, 10.8], label: 'STACKS GARRISON BARRACKS' },
  { tag: 'barracks.cannery', x: 145, z: -35.5, yaw: -Math.PI / 2, spawn: [139, 0, -35.5], label: 'CANNERY GARRISON BARRACKS' },
  { tag: 'barracks.harbour', x: 71, z: -94, yaw: 0, spawn: [71, 0, -88], label: 'HARBOUR GARRISON BARRACKS' },
];


