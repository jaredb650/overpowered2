/**
 * Pure coordinate & spatial plan for Endless War (`map: 'endless_war'`, `contract: 'endless_war'`).
 * Zero Three.js imports so tests, the Frontline Director, FOB Defense, Strategic Facilities,
 * War Command Console, and Vehicle/Frame Terminal can read every coordinate directly.
 *
 * Scale & Architecture:
 *   - Ground Battlefield (`ENDLESS_WAR_NAV_BOUNDS`): 480 m wide x 720 m long (x in [-240, +240], z in [-360, +360])
 *     ~2.8x Badlands ground area and >2x push depth from Friendly FOB Vanguard (South) to Iron Bastion (North).
 *   - Flyable Airspace (`ENDLESS_WAR_BOUNDS`): 2,200 m x 2,200 m, ceiling y = 380 m (~39x Badlands airspace).
 *   - LightVolume (`ENDLESS_WAR_LIGHT_BOUNDS`): 480 x 72 x 720 m at 3.6 m cell -> [134, 20, 200] <= [200, 48, 200].
 *   - Midpoint River (`z in [-30, +30]`): 60 m wide sunken river gorge impassable on foot/wheels,
 *     funneling both armies across 3 fortified tactical crossings (West Rail/Pontoon, Center Highway Viaduct,
 *     East Broken Dam & Rocky Ford) while aircraft fly freely overhead and Distraint Frames can jump-jet across.
 */

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type Rgb = readonly [number, number, number];

export type WarLaneId = 'west' | 'center' | 'east';

export type StrategicFacilityId =
  | 'fuel_depot'
  | 'artillery_battery'
  | 'radar_aa'
  | 'motor_pool'
  | 'airfield_tower';

export interface StrategicFacilityPlan {
  readonly id: StrategicFacilityId;
  readonly name: string;
  readonly shortName: string;
  readonly lane: WarLaneId;
  readonly sector: 3 | 4;
  readonly position: Vec3;
  readonly half: Vec3;
  readonly maxHp: number;
  readonly bounty: number;
  readonly rebuildSec: number;
  readonly debuffLabel: string;
}

export interface RiverCrossingPlan {
  readonly id: WarLaneId;
  readonly label: string;
  readonly x: number;
  readonly width: number;
  readonly capturePos: Vec3;
  readonly captureRadius: number;
  readonly southApproach: Vec3;
  readonly northBridgehead: Vec3;
}

export interface DefenseEmplacementPlan {
  readonly id: string;
  readonly kind: 'sam_battery' | 'flak_tower' | 'radar_dome' | 'mortar_pit';
  readonly position: Vec3;
  readonly yaw: number;
  readonly facilityId: StrategicFacilityId;
}

export const ENDLESS_WAR_ATMOSPHERE = 'overcast' as const;

/** Massive 2,200 m x 2,200 m flyable airspace (y in [-16, +380]). */
export const ENDLESS_WAR_BOUNDS = {
  x0: -1100,
  y0: -16,
  z0: -1100,
  x1: 1100,
  y1: 380,
  z1: 1100,
} as const;

/** Full 480 m x 720 m ground combat NavGraph bounds. */
export const ENDLESS_WAR_NAV_BOUNDS = {
  x0: -240,
  y0: -10,
  z0: -360,
  x1: 240,
  y1: 42,
  z1: 360,
} as const;

/**
 * Crisp voxel-AO LightVolume covering the full 480 x 72 x 720 m battlefield:
 *   480 / 3.6 = 134 <= 200, 72 / 3.6 = 20 <= 48, 720 / 3.6 = 200 <= 200.
 */
export const ENDLESS_WAR_LIGHT_BOUNDS = {
  x0: -240,
  y0: -8,
  z0: -360,
  x1: 240,
  y1: 64,
  z1: 360,
} as const;

export const ENDLESS_WAR_LIGHT_CELL = 3.6;

/** Primary walkable floor levels (ground y=0, trenches/ford y=0, artillery/radar terrace y=3.6). */
export const ENDLESS_WAR_LEVELS = [0] as const;

export const ENDLESS_WAR_HUB_PT: Vec3 = [0, 0, 294];

/** Player spawns inside Friendly FOB Vanguard facing north (-Z) toward the frontline & terminals. */
export const ENDLESS_WAR_PLAYER_SPAWN: Vec3 = [0, 0, 306];
export const ENDLESS_WAR_PLAYER_YAW = 0;

/** Vehicle/Frame yaw facing north (-Z, toward Enemy Fortress). */
export const ENDLESS_WAR_NORTH_YAW = Math.PI;

/** Friendly FOB interactive stations & staging pads. */
export const ENDLESS_WAR_TERMINAL: Vec3 = [-14, 0, 298];
export const ENDLESS_WAR_WAR_CONSOLE: Vec3 = [14, 0, 298];
export const ENDLESS_WAR_PROCUREMENT_POD: Vec3 = [30, 0, 308];
export const ENDLESS_WAR_FRAME_PAD: Vec3 = [0, 0, 286];
export const ENDLESS_WAR_VEHICLE_PAD: Vec3 = [-48, 0, 292];
/** West-wing 170 m concrete airstrip threshold aimed straight north (-Z) with zero obstructions. */
export const ENDLESS_WAR_AIRCRAFT_PAD: Vec3 = [-210, 0, 332];

/** Friendly FOB Command Core (lose-condition target, 25,000 HP). */
export const ENDLESS_WAR_FOB_CORE: Vec3 = [0, 0, 336];
export const ENDLESS_WAR_FOB_CORE_HALF: Vec3 = [9.5, 4.5, 8.5];
export const ENDLESS_WAR_FOB_MAX_HP = 25_000;

/** 4 elevated corner CIWS / SAM defense bastions guarding Friendly FOB Vanguard. */
export const ENDLESS_WAR_FOB_TURRETS: readonly { readonly id: string; readonly pos: Vec3; readonly kind: 'ciws' | 'sam' }[] = [
  { id: 'fob_nw_ciws', pos: [-184, 7.6, 260], kind: 'ciws' },
  { id: 'fob_ne_ciws', pos: [184, 7.6, 260], kind: 'ciws' },
  { id: 'fob_sw_sam', pos: [-184, 7.6, 344], kind: 'sam' },
  { id: 'fob_se_sam', pos: [184, 7.6, 344], kind: 'sam' },
];

/** River gorge Z span (`60 m` wide, water surface at y = -3.0). */
export const ENDLESS_WAR_RIVER_Z0 = -30;
export const ENDLESS_WAR_RIVER_Z1 = 30;
export const ENDLESS_WAR_WATER_Y = -3.0;

/** The 3 tactical river crossings funneling ground troops and armor. */
export const ENDLESS_WAR_CROSSINGS: readonly RiverCrossingPlan[] = [
  {
    id: 'west',
    label: 'WEST RAIL BRIDGE',
    x: -145,
    width: 18,
    capturePos: [-145, 0, 0],
    captureRadius: 28,
    southApproach: [-145, 0, 56],
    northBridgehead: [-145, 0, -56],
  },
  {
    id: 'center',
    label: 'CENTER HIGHWAY VIADUCT',
    x: 0,
    width: 28,
    capturePos: [0, 0, 0],
    captureRadius: 34,
    southApproach: [0, 0, 58],
    northBridgehead: [0, 0, -58],
  },
  {
    id: 'east',
    label: 'EAST DAM FORD',
    x: 145,
    width: 20,
    capturePos: [145, 0, 0],
    captureRadius: 28,
    southApproach: [145, 0, 56],
    northBridgehead: [145, 0, -56],
  },
];

/** 5 destructible Enemy Strategic Facilities across Sector 3 (Defense Belt) and Sector 4 (Iron Bastion). */
export const ENDLESS_WAR_FACILITIES: readonly StrategicFacilityPlan[] = [
  {
    id: 'fuel_depot',
    name: 'FORWARD FUEL & AMMO DEPOT',
    shortName: 'FUEL DEPOT',
    lane: 'west',
    sector: 3,
    position: [-156, 0, -178],
    half: [11, 5.2, 10],
    maxHp: 2200,
    bounty: 1500,
    rebuildSec: 120,
    debuffLabel: 'ENEMY SPAWN CADENCE -25%',
  },
  {
    id: 'artillery_battery',
    name: 'ARTILLERY & MORTAR RIDGE',
    shortName: 'ARTILLERY',
    lane: 'center',
    sector: 3,
    position: [44, 0, -172],
    half: [10, 4.4, 10],
    maxHp: 2200,
    bounty: 1500,
    rebuildSec: 120,
    debuffLabel: 'ENEMY BRIDGE SHELLING SILENCED',
  },
  {
    id: 'radar_aa',
    name: 'RADAR & AA NETWORK',
    shortName: 'RADAR / AA',
    lane: 'east',
    sector: 3,
    position: [158, 0, -178],
    half: [9.5, 6.2, 9.5],
    maxHp: 2400,
    bounty: 1800,
    rebuildSec: 120,
    debuffLabel: 'ENEMY SAM NET DOWN / JETS DELAYED',
  },
  {
    id: 'motor_pool',
    name: 'IRON BASTION MOTOR POOL',
    shortName: 'MOTOR POOL',
    lane: 'west',
    sector: 4,
    position: [-146, 0, -314],
    half: [14, 5.5, 11],
    maxHp: 3400,
    bounty: 2500,
    rebuildSec: 140,
    debuffLabel: 'ENEMY ARMOR & TANKS HALTED',
  },
  {
    id: 'airfield_tower',
    name: 'AIRFIELD CONTROL TOWER',
    shortName: 'AIRFIELD',
    lane: 'east',
    sector: 4,
    position: [150, 0, -314],
    half: [9, 9.5, 9],
    maxHp: 3200,
    bounty: 2500,
    rebuildSec: 140,
    debuffLabel: 'ENEMY CHOPPERS & JETS GROUNDED',
  },
];

/** Active BaseDefenseSystem emplacements defending Enemy Sector 3 & Sector 4. */
export const ENDLESS_WAR_ENEMY_DEFENSES: readonly DefenseEmplacementPlan[] = [
  // Center Artillery Ridge mortars
  { id: 'ew_mortar_c1', kind: 'mortar_pit', position: [30, 0, -162], yaw: 0, facilityId: 'artillery_battery' },
  { id: 'ew_mortar_c2', kind: 'mortar_pit', position: [56, 0, -182], yaw: -0.2, facilityId: 'artillery_battery' },
  { id: 'ew_mortar_w1', kind: 'mortar_pit', position: [-96, 0, -148], yaw: 0.25, facilityId: 'artillery_battery' },
  // East Radar & AA Network
  { id: 'ew_radar_e1', kind: 'radar_dome', position: [158, 0, -160], yaw: 0, facilityId: 'radar_aa' },
  { id: 'ew_sam_e1', kind: 'sam_battery', position: [182, 0, -172], yaw: -0.4, facilityId: 'radar_aa' },
  { id: 'ew_flak_e1', kind: 'flak_tower', position: [122, 0, -188], yaw: 0.3, facilityId: 'radar_aa' },
  // Fortress Iron Bastion perimeter AA
  { id: 'ew_flak_fw', kind: 'flak_tower', position: [-184, 0, -264], yaw: 0.2, facilityId: 'motor_pool' },
  { id: 'ew_sam_fe', kind: 'sam_battery', position: [184, 0, -264], yaw: -0.2, facilityId: 'airfield_tower' },
  { id: 'ew_flak_fc', kind: 'flak_tower', position: [-42, 0, -268], yaw: 0, facilityId: 'airfield_tower' },
];

/** Friendly base barracks / infantry spawn points inside FOB Vanguard. */
export const ENDLESS_WAR_FRIENDLY_SPAWNS: Readonly<Record<WarLaneId, readonly Vec3[]>> = {
  west: [[-138, 0, 272], [-152, 0, 278], [-118, 0, 268]],
  center: [[-18, 0, 272], [18, 0, 272], [0, 0, 268]],
  east: [[138, 0, 272], [152, 0, 278], [118, 0, 268]],
};

/** Enemy fortress infantry & garrison spawn points inside Iron Bastion. */
export const ENDLESS_WAR_ENEMY_SPAWNS: Readonly<Record<WarLaneId, readonly Vec3[]>> = {
  west: [[-142, 0, -274], [-158, 0, -284], [-126, 0, -268]],
  center: [[-20, 0, -276], [20, 0, -276], [0, 0, -284]],
  east: [[142, 0, -274], [158, 0, -284], [126, 0, -268]],
};

/**
 * Full South -> North armor waypoint routes for friendly AI vehicles (`AiVehicleFleet`).
 * Every point stays cleanly centered inside graded lanes, gates, and bridge decks.
 */
export const ENDLESS_WAR_FRIENDLY_LANES: Readonly<Record<WarLaneId, readonly Vec2[]>> = {
  west: [
    [-145, 286],
    [-145, 240],
    [-145, 175],
    [-145, 102],
    [-145, 42],
    [-145, -42],
    [-145, -118],
    [-118, -176],
    [-145, -242],
    [-145, -296],
  ],
  center: [
    [0, 286],
    [0, 240],
    [0, 175],
    [0, 108],
    [0, 44],
    [0, -44],
    [0, -118],
    [-10, -182],
    [0, -242],
    [0, -294],
  ],
  east: [
    [145, 286],
    [145, 240],
    [145, 175],
    [145, 102],
    [145, 42],
    [145, -42],
    [145, -118],
    [118, -176],
    [145, -242],
    [145, -296],
  ],
};

/** Full North -> South armor waypoint routes for enemy vehicles (`VehicleSystem`). */
export const ENDLESS_WAR_ENEMY_LANES: Readonly<Record<WarLaneId, readonly Vec2[]>> = {
  west: [...ENDLESS_WAR_FRIENDLY_LANES.west].reverse(),
  center: [...ENDLESS_WAR_FRIENDLY_LANES.center].reverse(),
  east: [...ENDLESS_WAR_FRIENDLY_LANES.east].reverse(),
};

/** Friendly rally Z coordinates indexed by frontline stage (0 = FOB Defense, 1 = South Trenches, 2 = Bridges, 3 = North Belt, 4 = Iron Bastion). */
export const ENDLESS_WAR_RALLY_Z: readonly number[] = [242, 182, 42, -92, -214];

/** Chopper fast-rope landing zones across South Trenches, River Bridgeheads, and North Belt. */
export const ENDLESS_WAR_CHOPPER_LZS: readonly { readonly id: string; readonly lane: WarLaneId; readonly pos: Vec3 }[] = [
  { id: 'lz_south_w', lane: 'west', pos: [-112, 0, 146] },
  { id: 'lz_south_c', lane: 'center', pos: [-38, 0, 146] },
  { id: 'lz_south_e', lane: 'east', pos: [112, 0, 146] },
  { id: 'lz_mid_w', lane: 'west', pos: [-114, 0, -64] },
  { id: 'lz_mid_c', lane: 'center', pos: [36, 0, -64] },
  { id: 'lz_mid_e', lane: 'east', pos: [114, 0, -64] },
  { id: 'lz_north_c', lane: 'center', pos: [-44, 0, -214] },
];

/** High-altitude aircraft entry portals around the 2,200 m theater rim. */
export const ENDLESS_WAR_SKY_SPAWNS: readonly Vec3[] = [
  [0, 130, -820],
  [-480, 140, -760],
  [480, 140, -760],
  [-740, 135, -220],
  [740, 135, -220],
  [0, 120, 820],
  [-460, 130, 760],
  [460, 130, 760],
];

/** Supply & ammo pickup spots scattered across trenches, ruined town, and bridgeheads. */
export const ENDLESS_WAR_PICKUP_SPOTS: readonly Vec3[] = [
  [-24, 0, 290],
  [24, 0, 290],
  [-142, 0, 198],
  [0, 0, 200],
  [142, 0, 198],
  [-32, 0, 108],
  [36, 0, 96],
  [-136, 0, 48],
  [14, 0, 48],
  [136, 0, 48],
  [-136, 0, -52],
  [-14, 0, -52],
  [136, 0, -52],
  [-124, 0, -162],
  [18, 0, -162],
  [124, 0, -162],
];

/** Overcast war-torn mud, wet concrete, olive drab, and rust palette. */
export const WAR_PALETTE = {
  mudBase: [0.34, 0.30, 0.24] as Rgb,
  mudDark: [0.22, 0.19, 0.15] as Rgb,
  mudGrass: [0.28, 0.31, 0.21] as Rgb,
  mudTrack: [0.26, 0.22, 0.17] as Rgb,
  wetConcrete: [0.46, 0.48, 0.49] as Rgb,
  darkConcrete: [0.30, 0.32, 0.34] as Rgb,
  tarmac: [0.22, 0.23, 0.25] as Rgb,
  sandbag: [0.54, 0.49, 0.38] as Rgb,
  timber: [0.38, 0.29, 0.21] as Rgb,
  rustSteel: [0.40, 0.26, 0.19] as Rgb,
  oliveArmor: [0.28, 0.33, 0.24] as Rgb,
  enemySteel: [0.34, 0.26, 0.25] as Rgb,
  brickRuins: [0.46, 0.32, 0.26] as Rgb,
  riverWater: [0.11, 0.16, 0.18] as Rgb,
  riverBank: [0.20, 0.17, 0.13] as Rgb,
  hillRock: [0.30, 0.31, 0.30] as Rgb,
  cloudGray: [0.58, 0.60, 0.64] as Rgb,
} as const;
