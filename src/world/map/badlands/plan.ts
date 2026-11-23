/**
 * Badlands — Open-Desert Mech Survival (`map: 'badlands'`, `contract: 'badlands'`) spatial plan.
 *
 * Pure data only (no Three.js) so the map builder, wave director, Frame pad spawner, and tests all
 * share one source of truth.
 *
 * Layout:
 *   - Maximum crisp voxel-AO footprint: 352 m × 352 m (`x, z ∈ [-176, +176]`, `y ∈ [-8, +112]`).
 *   - Wide-open central basin (`r <= 62 m`) with flush concrete staging pad (`[-16..16]²`), open sky
 *     for Distraint Frame flight/hover, and the player's Frame parked right next to spawn.
 *   - 8 unobstructed radial convoy corridors (`0°, 45°, 90°, 135°, 180°, 225°, 270°, 315°`, ≥ 24 m wide)
 *     feeding an inner ring road (`r = 56 m`) so technicals, troop trucks, and tanks converge from all
 *     directions without ever snagging on architecture.
 *   - 4 hero desert landmarks + 4 Tier-0 destructible Saltblood lookout posts tucked cleanly into the
 *     8 wedge sectors (`22.5°` off every convoy road), framed by outer rim dunes and red sandstone mesas.
 */
export const BADLANDS_BOUNDS = {
  x0: -176,
  x1: 176,
  y0: -8,
  y1: 112,
  z0: -176,
  z1: 176,
} as const;

/** LightVolume hard cap is 200 × 48 × 200 cells. At 2.0 m cell size: 176 × 40 × 176. */
export const BADLANDS_LIGHT_BOUNDS = {
  x0: -176,
  x1: 176,
  y0: -6,
  y1: 74,
  z0: -176,
  z1: 176,
} as const;

export const BADLANDS_LIGHT_CELL = 2.0;

/** Walkable elevation levels: flat desert basin & staging pad (`0`) plus hero landmark catwalks (`3.6`). */
export const BADLANDS_LEVELS: readonly number[] = [0, 3.6];

export const BADLANDS_HUB_PT: readonly [number, number, number] = [0, 0, 0];

/** Player spawns on the south edge of the staging pad facing north toward the parked Distraint Frame. */
export const BADLANDS_PLAYER_SPAWN: readonly [number, number, number] = [0, 0, 10];

/** Parked Distraint Frame staging spot beside player spawn on the concrete staging pad. */
export const BADLANDS_FRAME_PAD: readonly [number, number, number] = [4.5, 0, 1.5];

/** 8 cardinal + diagonal radial convoy entry lanes (spawns at r ≈ 158 m, routes onto the r = 56 m ring road). */
export interface ConvoyLane {
  readonly id: string;
  readonly spawn: readonly [number, number];
  /** Waypoints guiding vehicles down the clear radial road onto the inner ring road. */
  readonly route: readonly (readonly [number, number])[];
}

export const BADLANDS_RING_WAYPOINTS: readonly (readonly [number, number])[] = [
  [0, -56],    // 0: N
  [40, -40],   // 1: NE
  [56, 0],     // 2: E
  [40, 40],    // 3: SE
  [0, 56],     // 4: S
  [-40, 40],   // 5: SW
  [-56, 0],    // 6: W
  [-40, -40],  // 7: NW
];

export const BADLANDS_CONVOY_LANES: readonly ConvoyLane[] = [
  { id: 'lane_n',  spawn: [0, -158],    route: [[0, -110],   [0, -56],   [40, -40]] },
  { id: 'lane_ne', spawn: [112, -112],  route: [[78, -78],   [40, -40],  [56, 0]] },
  { id: 'lane_e',  spawn: [158, 0],     route: [[110, 0],    [56, 0],    [40, 40]] },
  { id: 'lane_se', spawn: [112, 112],   route: [[78, 78],    [40, 40],   [0, 56]] },
  { id: 'lane_s',  spawn: [0, 158],     route: [[0, 110],    [0, 56],    [-40, 40]] },
  { id: 'lane_sw', spawn: [-112, 112],  route: [[-78, 78],   [-40, 40],  [-56, 0]] },
  { id: 'lane_w',  spawn: [-158, 0],    route: [[-110, 0],   [-56, 0],   [-40, -40]] },
  { id: 'lane_nw', spawn: [-112, -112], route: [[-78, -78],  [-40, -40], [0, -56]] },
];

/** 4 hero desert landmarks tucked into odd 22.5° wedge sectors (~r = 104 m, >= 38 m from every road center). */
export const BADLANDS_LANDMARKS = {
  fuelDepot: { id: 'badlands.fuelDepot', label: 'FUEL DEPOT', x: 40, z: -96, yaw: -0.39 },
  sandstoneArch: { id: 'badlands.arch', label: 'SANDSTONE ARCH', x: 96, z: 40, yaw: 1.18 },
  wreckedOasis: { id: 'badlands.oasis', label: 'WRECKED OASIS', x: -40, z: 96, yaw: 2.75 },
  saltDerrick: { id: 'badlands.derrick', label: 'SALT DERRICK', x: -96, z: -40, yaw: -1.96 },
} as const;

/** 4 Tier-0 destructible Saltblood lookout posts in the alternating 22.5° wedge sectors (~r = 98 m). */
export interface BadlandsLookoutPost {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

export const BADLANDS_LOOKOUT_POSTS: readonly BadlandsLookoutPost[] = [
  { id: 'badlands.post.ene', x: 90, z: -38, yaw: -1.18 },
  { id: 'badlands.post.sse', x: 38, z: 90, yaw: -2.75 },
  { id: 'badlands.post.wsw', x: -90, z: 38, yaw: 1.96 },
  { id: 'badlands.post.nnw', x: -38, z: -90, yaw: 0.39 },
];

/** 8 open fast-rope helicopter hover LZs across the inner & mid basin (clear sky, flat y = 0 floor). */
export interface BadlandsHoverZone {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly hoverY: number;
}

export interface BadlandsDropZone {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
}

export const BADLANDS_HOVER_ZONES: readonly BadlandsHoverZone[] = [
  { id: 'lz_n',  x: 0,   y: 0, z: -44, hoverY: 16 },
  { id: 'lz_ne', x: 44,  y: 0, z: -44, hoverY: 16 },
  { id: 'lz_e',  x: 48,  y: 0, z: 0,   hoverY: 16 },
  { id: 'lz_se', x: 44,  y: 0, z: 44,  hoverY: 16 },
  { id: 'lz_s',  x: 0,   y: 0, z: 48,  hoverY: 16 },
  { id: 'lz_sw', x: -44, y: 0, z: 44,  hoverY: 16 },
  { id: 'lz_w',  x: -48, y: 0, z: 0,   hoverY: 16 },
  { id: 'lz_nw', x: -44, y: 0, z: -44, hoverY: 16 },
];

/** 8 broad desert paratrooper drop zones for overhead transport jets. */
export const BADLANDS_PARATROOPER_ZONES: readonly BadlandsDropZone[] = [
  { id: 'para_n',  x: 0,   y: 0, z: -74, radius: 14 },
  { id: 'para_ne', x: 64,  y: 0, z: -64, radius: 14 },
  { id: 'para_e',  x: 74,  y: 0, z: 0,   radius: 14 },
  { id: 'para_se', x: 64,  y: 0, z: 64,  radius: 14 },
  { id: 'para_s',  x: 0,   y: 0, z: 74,  radius: 14 },
  { id: 'para_sw', x: -64, y: 0, z: 64,  radius: 14 },
  { id: 'para_w',  x: -74, y: 0, z: 0,   radius: 14 },
  { id: 'para_nw', x: -64, y: 0, z: -64, radius: 14 },
];

/** 4 wide boss drop / chopper orbit patrol pads around the central basin. */
export const BADLANDS_BOSS_ZONES: readonly BadlandsDropZone[] = [
  { id: 'boss_n', x: 0,   y: 0, z: -58, radius: 12 },
  { id: 'boss_e', x: 58,  y: 0, z: 0,   radius: 12 },
  { id: 'boss_s', x: 0,   y: 0, z: 58,  radius: 12 },
  { id: 'boss_w', x: -58, y: 0, z: 0,   radius: 12 },
];

/** High-altitude perimeter sky spawns for attack choppers, door gunners, and air markers. */
export const BADLANDS_SKY_SPAWNS: readonly (readonly [number, number, number])[] = [
  [0, 56, -162],
  [116, 56, -116],
  [162, 56, 0],
  [116, 56, 116],
  [0, 56, 162],
  [-116, 56, 116],
  [-162, 56, 0],
  [-116, 56, -116],
];

/** 20 open pickup / supply-pod landing spots distributed across the staging pad, ring road, and outer sectors. */
export const BADLANDS_PICKUP_SPOTS: readonly (readonly [number, number, number])[] = [
  // Staging pad perimeter
  [-12, 0, 12],
  [12, 0, 12],
  [-12, 0, -12],
  [12, 0, -12],
  // Inner basin ring (r ~ 44..56 m)
  [0, 0, -48],
  [36, 0, -36],
  [48, 0, 0],
  [36, 0, 36],
  [0, 0, 48],
  [-36, 0, 36],
  [-48, 0, 0],
  [-36, 0, -36],
  // Mid-outer avenues (r ~ 92..108 m, cleanly on clear radial lanes)
  [0, 0, -96],
  [70, 0, -70],
  [96, 0, 0],
  [70, 0, 70],
  [0, 0, 96],
  [-70, 0, 70],
  [-96, 0, 0],
  [-70, 0, -70],
];
