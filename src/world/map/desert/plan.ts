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
 *   +Z (South) = Dawn open desert approach dunes (z = +222 -> +84)
 *    Z = +62   = The Wall (150 m Tier-0 destructible perimeter + solid Bulldozer Main Gate at x = 0)
 *    Z = +50 -> -10   = The Warren (cut-your-own-way Tier-0 shantytown + rooftop minigun nest)
 *    Z = -14 -> -56   = The Pump Yard (water tanks, pipes, 18 m Water Tower at (0,0,-40))
 *    Y = -5.5         = The Sewer (storm drain under Pump Yard from (-14,0,-28) to (0,0,-78))
 *    Z = -80 -> -144  = The High Terraces ("The Perches" — multi-tier vertical village, y = 0 / 3.6 / 7.2)
 *    Z = -148 -> -202 = The Salt Cave ("The Cistern Tunnels" — subterranean floor y = -2.5)
 *    Z = -208 -> -266 = The Plane (100% solid crashed cargo plane hull; Quist cornered at tail (0,1.5,-256))
 */

export type Pt3 = readonly [number, number, number];

export const DESERT_BOUNDS = {
  x0: -180,
  x1: 180,
  y0: -12,
  y1: 95,
  z0: -285,
  z1: 240,
} as const;

/**
 * Light volume covers the playable town, terraces, cave, and plane corridor cleanly within the 200x200 cell cap:
 * 320 m / 2.0 m = 160 cells across X; 56 m / 2.0 m = 28 cells across Y; 400 m / 2.0 m = 200 cells across Z.
 */
export const DESERT_LIGHT_BOUNDS = {
  x0: -160,
  x1: 160,
  y0: -12,
  y1: 44,
  z0: -280,
  z1: 120,
} as const;

export const DESERT_LIGHT_CELL = 2.0;

/**
 * Walkable floor levels for nav mesh baking:
 * -5.5 Storm Sewer, -2.5 Salt Cave, 0 desert ground / Warren / Pump Yard / Plane Forecourt,
 * 1.5 Crashed Cargo Plane deck, 3.6 wall walkways / Warren roofs / High Terraces Mid-Tier,
 * 7.2 High Terraces Upper-Tier & tall watchtower / tent decks.
 */
export const DESERT_LEVELS = [-5.5, -2.5, 0, 1.5, 3.6, 7.2] as const;

/** Nav seed point inside the main open street just north of the breached main gate. */
export const DESERT_HUB_PT: Pt3 = [0, 0, 44];

export const DESERT_Z = {
  approachStart: 222,
  approachMid: 150,
  convoyLoop: 82,
  wallLine: 62,
  wallWalkway: 57.5,
  warrenSouth: 50,
  warrenMid: 20,
  warrenNorth: -10,
  pumpSouth: -14,
  waterTower: -40,
  pumpNorthGate: -56,
  sewerDrop: -28,
  sewerExit: -78,
  // NEW Section 5: The High Terraces ("The Perches" — vertical village)
  terracesSouth: -80,
  terracesMid: -112,
  terracesNorth: -144,
  // NEW Section 6: The Salt Cave ("The Cistern Tunnels")
  caveSouth: -148,
  caveMid: -176,
  caveNorth: -202,
  // Section 7: The Crashed Cargo Plane (relocated north of Salt Cave!)
  planeForecourt: -208,
  planeRamp: -218,
  planeMidDoor: -234,
  planeAftDoor: -248,
  planeTail: -256,
  planeEnd: -266,
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
  pos: [-14, 3.6, 22] as Pt3,
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

/** Section 5: The High Terraces ("The Perches" — multi-tier vertical village). */
export const HIGH_TERRACES = {
  sewerExitTop: [0, 0, -81] as Pt3,
  tier1Y: 0,
  tier2Y: 3.6,
  tier3Y: 7.2,
  towers: [
    [-26, 0, -94],
    [26, 0, -96],
    [-22, 3.6, -114],
    [24, 3.6, -116],
    [-16, 3.6, -134],
    [18, 3.6, -134],
  ] as readonly Pt3[],
  tents: [
    [-12, 0, -92],
    [14, 0, -92],
    [-32, 3.6, -108],
    [32, 3.6, -110],
    [-28, 3.6, -128],
    [28, 3.6, -128],
  ] as readonly Pt3[],
  caveEntrancePos: [0, 0, -148] as Pt3,
} as const;

/** Section 6: The Salt Cave ("The Cistern Tunnels" — subterranean cavern corridor). */
export const SALT_CAVE = {
  southMouth: [0, 0, -148] as Pt3,
  floorY: -2.5,
  midChamber: [0, -2.5, -176] as Pt3,
  northExit: [0, 0, -203] as Pt3,
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
  forecourtExfilPos: [0, 0, DESERT_Z.planeForecourt + 2] as Pt3,
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
  [-18, 3.6, -104],
  [18, 3.6, -126],
  [16, 0, -210],
  [-16, 0, -210],
];

/** Three-truck convoy spline routes (middle truck carries player heavy gun; flankers offset +/-11 m). */
export const CONVOY_PATHS = {
  /** Section 1: open desert dawn approach from south dunes to outer wall. */
  approach: [
    [0, 0, 222],
    [-10, 0, 194],
    [8, 0, 162],
    [-12, 0, 132],
    [4, 0, 106],
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

  /** Section 8: exfil pickup at plane forecourt, sweeping south via the wide eastern bypass canyon road. */
  exfil: [
    [0, 0, -204],
    [26, 0, -196],
    [48, 0, -172],
    [50, 0, -126],
    [48, 0, -78],
    [36, 0, -34],
    [18, 0, 6],
    [4, 0, 40],
    [0, 0, 68],
    [0, 0, 96],
    [-8, 0, 132],
    [0, 0, 168],
  ] as readonly Pt3[],
} as const;
