/**
 * Shared spatial layout and coordinates for DESERT RAID — Surplus, the Saltblood shantytown.
 *
 * Single source of truth used by:
 *   - Map builders (`src/world/map/desert/*`)
 *   - Convoy & bandit vehicles (`src/campaign/desert/convoy.ts`)
 *   - Escort gunships, Warthog breach, friendly squads & ending cutscene (`src/campaign/desert/airAndSquads.ts`)
 *   - Loudspeaker poles, Water Tower collapse/flood, Sewer & Quist finale (`src/campaign/desert/setpieces.ts`)
 *   - Mission script & places (`src/campaign/missions/desertRaid*.ts`)
 *
 * Orientation:
 *   +Z (South) = Dawn open desert approach dunes (z = +215 -> +84)
 *    Z = +62   = The Wall (150 m Tier-0 destructible perimeter + solid Bulldozer Main Gate at x = 0)
 *    Z = +50 -> -12 = The Warren (cut-your-own-way Tier-0 shantytown + rooftop minigun nest)
 *    Z = -14 -> -62 = The Pump Yard (water tanks, pipes, 18 m Water Tower at (0,0,-40))
 *    Y = -5.5  = The Sewer (storm drain under Pump Yard from (-14,0,-30) to (0,0,-74))
 *    Z = -74 -> -134 = The Plane (100% solid crashed cargo plane hull; Quist cornered at tail (0,1.5,-124))
 */

export type Pt3 = readonly [number, number, number];

export const DESERT_BOUNDS = {
  x0: -180,
  x1: 180,
  y0: -12,
  y1: 95,
  z0: -165,
  z1: 230,
} as const;

/**
 * Light volume covers the playable town & wall corridor cleanly within the 200x200 cell cap:
 * 320 m / 1.6 m = 200 cells across X and Z; 48 m / 1.6 m = 30 cells across Y.
 */
export const DESERT_LIGHT_BOUNDS = {
  x0: -160,
  x1: 160,
  y0: -10,
  y1: 38,
  z0: -155,
  z1: 165,
} as const;

export const DESERT_LIGHT_CELL = 1.6;

/** Walkable floor levels for nav mesh baking: sewer (-5.5), desert ground (0), plane floor (1.5), shanty roofs (3.4, 4.2, 6.6). */
export const DESERT_LEVELS = [-5.5, 0, 1.5, 3.4, 4.2, 6.6] as const;

/** Nav seed point inside the main open street just north of the breached main gate. */
export const DESERT_HUB_PT: Pt3 = [0, 0, 44];

export const DESERT_Z = {
  approachStart: 208,
  approachMid: 146,
  convoyLoop: 82,
  wallLine: 62,
  wallWalkway: 57.5,
  warrenSouth: 50,
  warrenMid: 20,
  warrenNorth: -10,
  pumpSouth: -14,
  waterTower: -40,
  pumpNorthGate: -56,
  sewerDrop: -30,
  sewerExit: -74,
  planeForecourt: -76,
  planeRamp: -86,
  planeMidDoor: -102,
  planeAftDoor: -116,
  planeTail: -124,
  planeEnd: -134,
} as const;

export const MAIN_GATE = {
  x: 0,
  y: 0,
  z: DESERT_Z.wallLine,
  width: 14,
  height: 7.2,
  depth: 2.2,
} as const;

/** Side gates on the outer wall where Quist dispatches reinforcement trucks. */
export const SIDE_GATES: readonly { id: 'west' | 'east'; x: number; z: number }[] = [
  { id: 'west', x: -58, z: DESERT_Z.wallLine },
  { id: 'east', x: 58, z: DESERT_Z.wallLine },
];

/** Six destructible watchtowers guarding the outer wall (shooting legs tips them over). */
export const WALL_TOWERS: readonly { id: string; x: number; z: number; yaw: number; height: number }[] = [
  { id: 'wall_tower_w3', x: -68, z: 60.5, yaw: 0, height: 6.2 },
  { id: 'wall_tower_w2', x: -42, z: 60.5, yaw: 0, height: 6.8 },
  { id: 'wall_tower_w1', x: -16, z: 60.5, yaw: 0, height: 7.2 },
  { id: 'wall_tower_e1', x: 16, z: 60.5, yaw: 0, height: 7.2 },
  { id: 'wall_tower_e2', x: 42, z: 60.5, yaw: 0, height: 6.8 },
  { id: 'wall_tower_e3', x: 68, z: 60.5, yaw: 0, height: 6.2 },
];

/** Four desert lookout posts along the Section 1 approach dunes. */
export const APPROACH_POSTS: readonly { id: string; x: number; z: number; yaw: number }[] = [
  { id: 'approach_post_1', x: -28, z: 172, yaw: 0.35 },
  { id: 'approach_post_2', x: 30, z: 152, yaw: -0.4 },
  { id: 'approach_post_3', x: -34, z: 124, yaw: 0.25 },
  { id: 'approach_post_4', x: 32, z: 108, yaw: -0.3 },
];

/** Optional mounted minigun nest on a central Warren rooftop (not required to progress). */
export const WARREN_MINIGUN = {
  pos: [-14, 4.2, 22] as Pt3,
  yaw: Math.PI, // faces north (-Z) down the central Warren avenue, 140-deg arc
} as const;

/** Pump Yard water tower + storm sewer endpoints. */
export const PUMP_YARD = {
  towerBase: [0, 0, DESERT_Z.waterTower] as Pt3,
  towerHeight: 18.5,
  blockedStreetCenter: [0, 0, -52] as Pt3,
  sewerDropPos: [-14, 0, DESERT_Z.sewerDrop] as Pt3,
  sewerFloorY: -5.5,
  sewerExitBottom: [0, -5.5, DESERT_Z.sewerExit] as Pt3,
  sewerExitTop: [0, 0, DESERT_Z.sewerExit - 3] as Pt3,
} as const;

/** Solid crashed cargo plane interior geometry references. */
export const CARGO_PLANE = {
  centerX: 0,
  floorY: 1.5,
  hullHalfW: 3.4,
  hullHeight: 4.8,
  rampZ: DESERT_Z.planeRamp,
  door1Z: DESERT_Z.planeMidDoor,
  door2Z: DESERT_Z.planeAftDoor,
  quistWaitPos: [0, 1.5, DESERT_Z.planeMidDoor - 3] as Pt3,
  quistMidPos: [0, 1.5, DESERT_Z.planeAftDoor - 3] as Pt3,
  quistCornerPos: [0, 1.5, DESERT_Z.planeTail] as Pt3,
  forecourtExfilPos: [0, 0, DESERT_Z.planeForecourt + 6] as Pt3,
} as const;

/** Loudspeaker pole positions covering Surplus so Quist's PA voice rings across the town. */
export const LOUDSPEAKER_POLES: readonly Pt3[] = [
  [-22, 0, 56],
  [22, 0, 56],
  [-20, 0, 26],
  [20, 0, 14],
  [-12, 0, -4],
  [18, 0, -28],
  [-18, 0, -48],
  [16, 0, -80],
  [-16, 0, -80],
];

/** Three-truck convoy spline routes (middle truck carries player heavy gun; flankers offset +/-11 m). */
export const CONVOY_PATHS = {
  /** Section 1: open desert dawn approach from south dunes to outer wall. */
  approach: [
    [0, 0, 208],
    [-10, 0, 182],
    [8, 0, 154],
    [-12, 0, 126],
    [4, 0, 102],
    [0, 0, 84],
  ] as readonly Pt3[],

  /** Section 2: slow broadside shooting-gallery pass along the outer wall. */
  wallLoop: [
    [0, 0, 84],
    [-28, 0, 82],
    [-54, 0, 80],
    [-46, 0, 88],
    [-16, 0, 82],
    [18, 0, 82],
    [52, 0, 80],
    [44, 0, 88],
    [14, 0, 82],
    [0, 0, 80],
  ] as readonly Pt3[],

  /** Section 6: exfil pickup at plane forecourt, smashing south through shattered town into the desert. */
  exfil: [
    [0, 0, -70],
    [8, 0, -46],
    [12, 0, -18],
    [4, 0, 16],
    [0, 0, 52],
    [0, 0, 84],
    [-10, 0, 122],
    [6, 0, 164],
    [0, 0, 206],
  ] as readonly Pt3[],
} as const;
