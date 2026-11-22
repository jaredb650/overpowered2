/**
 * Brine Central Reserve & Coastal Elevated Expressway ("Bank Run", Mission 4)
 * architectural plan and shared coordinate contract.
 *
 * Every elevation, zone footprint, vault coordinate, skylight breach aperture,
 * gold pallet position, getaway Humvee parking spot, and offset highway treadmill
 * origin lives here so the map builders, heist gameplay modules, and mission script
 * share a single exact source of truth.
 *
 * Engine budgets honored:
 *   - NavGraph sampling: TOP_Y = 118, BOTTOM_Y = -19 -> bounds y in [-6, 56], killY = -12
 *   - LightVolume MAX_DIMS = [200, 48, 200]:
 *       lightBounds x: [-68, 164] (232 m), y: [-6, 42] (48 m), z: [-68, 68] (136 m)
 *       @ lightCell = 1.5 m -> 155 x 32 x 91 <= [200, 48, 200]
 */
import * as THREE from 'three';

export const BANK_BOUNDS = {
  x0: -68,
  y0: -6,
  z0: -68,
  x1: 164,
  y1: 56,
  z1: 68,
} as const;

export const BANK_LIGHT_BOUNDS = {
  x0: -68,
  y0: -6,
  z0: -68,
  x1: 164,
  y1: 42,
  z1: 68,
} as const;

export const BANK_LIGHT_CELL = 1.5;

export const BANK_KILL_Y = -12;

/** Walkable floor elevations of Brine Central Reserve. */
export const BANK_LEVELS: readonly number[] = [-1.5, 0, 5.5, 14];

/** Central Banking Hall nav anchor mutually connected to vault, mezzanine, plaza, and roof. */
export const BANK_HUB = new THREE.Vector3(0, 0, 8);

/** Named floor elevations matching BANK_LEVELS. */
export const LV = {
  vault: -1.5,
  hall: 0,
  mezz: 5.5,
  roof: 14,
  highway: 12,
} as const;

/** Key architectural heights. */
export const CEIL = {
  vault: 3.8,
  mezzUnder: 5.1,
  hall: 13.6,
  roofParapet: 15.25,
} as const;

// -------------------------------------------------------------------------------------------------
// Act 1: Rooftop Fast-Rope & Atrium Skylight Breach
// -------------------------------------------------------------------------------------------------

/** Rooftop helipad center where the player touches down from Packmule 2-3. */
export const ROOF_HELIPAD = [0, LV.roof, 18] as const;

/** Packmule hover anchor above the rooftop helipad during Act 1 fast-rope insertion. */
export const PACKMULE_HOVER = [0, LV.roof + 12.5, 18] as const;

/** Central Atrium Skylight Dome aperture (9 m x 9 m opening in the y = 14 roof slab). */
export const SKYLIGHT_BOUNDS = {
  x0: -4.5,
  x1: 4.5,
  z0: -2.5,
  z1: 6.5,
  y: LV.roof,
} as const;

export const SKYLIGHT_CENTER = [0, LV.roof, 2] as const;

/** Satchel charges supply crate on the rooftop helipad edge. */
export const ROOF_SATCHEL_POS = [-8, LV.roof, 14] as const;

/** Sealed rooftop stairwell bulkhead door (Sterling locks it on PA at mission start). */
export const ROOF_STAIR_DOOR_POS = [-20, LV.roof, -12] as const;

// -------------------------------------------------------------------------------------------------
// Act 2: Grand Marble Banking Hall, Mezzanine & Vault Drill
// -------------------------------------------------------------------------------------------------

/** Hanging crystal/brass chandeliers in the double-height atrium (shootable/drop hazards). */
export const CHANDELIER_POSITIONS: readonly (readonly [number, number, number])[] = [
  [0, 11.4, -7],
  [0, 11.4, 9.5],
  [0, 11.4, 17],
];

/** Giant glowing LED Day-2 financial news ticker boards on the mezzanine fascias. */
export const TICKER_POSITIONS: readonly {
  readonly pos: readonly [number, number, number];
  readonly yaw: number;
  readonly width: number;
  readonly height: number;
}[] = [
  { pos: [0, 7.3, -15.4], yaw: 0, width: 16, height: 1.5 },
  { pos: [0, 7.3, 15.4], yaw: Math.PI, width: 14, height: 1.5 },
];

/** Optional weapon racks inside the bank. */
export const SABOT_RACK_POS = [-20, LV.mezz, -8] as const; // Mezzanine Security Office
export const MGL_RACK_POS = [13.5, LV.vault, -25.5] as const; // Vault Antechamber Guard Cage

/** Planetary Bullion Vault Door aperture center (floor level) & hinge pivot. */
export const VAULT_DOOR_POS = [0, LV.vault, -32] as const;
export const VAULT_DOOR_HINGE = [-2.3, LV.vault, -32] as const;
export const VAULT_DOOR_SIZE = { width: 4.6, height: 4.4 } as const;

/** Bureau Thermal Lance Drill anchor on the south face of the Vault Door. */
export const DRILL_POS = [0, LV.vault + 1.45, -31.15] as const;
export const DRILL_FLOOR_POS = [0, LV.vault, -30.5] as const;

/** SWAT flank breach doors into the Vault Antechamber. */
export const VAULT_WEST_DOOR_POS = [-18, LV.vault, -26] as const;
export const VAULT_EAST_DOOR_POS = [18, LV.vault, -26] as const;

/** Front Portico revolving bronze doors (south entrance to the banking hall). */
export const PORTICO_DOOR_POS = [0, LV.hall, 24] as const;

// -------------------------------------------------------------------------------------------------
// Act 3: Bullion Plunder & Getaway Humvee Extraction
// -------------------------------------------------------------------------------------------------

/** 7 Gold Bullion Pallets inside the Planetary Bullion Vault (first 4 mandatory, +3 bonus). */
export const GOLD_PALLETS: readonly {
  readonly id: string;
  readonly pos: readonly [number, number, number];
  readonly bonus: boolean;
}[] = [
  { id: 'pallet_nw', pos: [-6.5, LV.vault, -39.5], bonus: false },
  { id: 'pallet_ne', pos: [6.5, LV.vault, -39.5], bonus: false },
  { id: 'pallet_sw', pos: [-5.5, LV.vault, -35.5], bonus: false },
  { id: 'pallet_se', pos: [5.5, LV.vault, -35.5], bonus: false },
  { id: 'pallet_center', pos: [0, LV.vault, -41.2], bonus: true },
  { id: 'pallet_far_w', pos: [-8.5, LV.vault, -41.5], bonus: true },
  { id: 'pallet_far_e', pos: [8.5, LV.vault, -41.5], bonus: true },
];

export const MANDATORY_BAGS = 4;
export const BONUS_BAG_VALUE = 2500;

/** Armored Bureau Getaway Humvee parked tail-in at the base of the front marble steps. */
export const HUMVEE_PARK_POS = [0, LV.hall, 35.5] as const;
/** Cargo bed drop-off zone (tailgate faces north toward the bank front steps). */
export const HUMVEE_BED_POS = [0, LV.hall + 1.0, 32.8] as const;
/** Roof turret mount prompt position on the parked Getaway Humvee. */
export const HUMVEE_TURRET_POS = [0, LV.hall + 2.1, 35.5] as const;

// -------------------------------------------------------------------------------------------------
// Act 4: Offset Coastal Elevated Expressway (Scrolling Treadmill Zone)
// -------------------------------------------------------------------------------------------------

/** Center of the offset 4-lane Coastal Elevated Expressway treadmill zone. */
export const HIGHWAY_ORIGIN = [128, LV.highway, 0] as const;
export const HIGHWAY_HALF_WIDTH = 13;
export const HIGHWAY_HALF_LEN = 58;
/** Four lane X centers in world space (Humvee drives toward -Z; pursuers approach from +Z and flank). */
export const HIGHWAY_LANES: readonly number[] = [120.5, 125.5, 130.5, 135.5];

// -------------------------------------------------------------------------------------------------
// Spawns, Pickups & Roads
// -------------------------------------------------------------------------------------------------

export const PLAYER_SPAWNS: readonly { x: number; y: number; z: number; yaw: number }[] = [
  { x: 0, y: LV.roof, z: 18, yaw: 0 },
  { x: 0, y: LV.hall, z: 10, yaw: 0 },
];

export const GROUND_SPAWNS: readonly (readonly [number, number, number, string])[] = [
  [0, LV.roof, -12, 'bank-roof'],
  [-14, LV.roof, -4, 'bank-roof'],
  [14, LV.roof, -4, 'bank-roof'],
  [-10, LV.hall, 16, 'bank-hall'],
  [10, LV.hall, 16, 'bank-hall'],
  [-16, LV.hall, 2, 'bank-hall'],
  [16, LV.hall, 2, 'bank-hall'],
  [-20, LV.mezz, 6, 'bank-mezzanine'],
  [20, LV.mezz, 6, 'bank-mezzanine'],
  [0, LV.mezz, -13, 'bank-mezzanine'],
  [-14, LV.vault, -26, 'bank-antechamber'],
  [14, LV.vault, -26, 'bank-antechamber'],
  [-18, LV.hall, 42, 'bank-plaza'],
  [18, LV.hall, 42, 'bank-plaza'],
];

export const AIR_SPAWNS: readonly (readonly [number, number, number])[] = [
  [-44, 30, 32],
  [44, 30, 32],
  [-44, 32, -32],
  [44, 32, -32],
];

export const PICKUP_SPOTS: readonly (readonly [number, number, number])[] = [
  [-12, LV.roof, 10],
  [12, LV.roof, 10],
  [-16, LV.hall, 10],
  [16, LV.hall, 10],
  [-20, LV.mezz, -4],
  [20, LV.mezz, -4],
  [-10, LV.vault, -24],
  [10, LV.vault, -24],
  [-10, LV.hall, 36],
  [10, LV.hall, 36],
];

export const BANK_ROADS: readonly { id: string; points: readonly (readonly [number, number])[]; width: number }[] = [
  { id: 'plaza_avenue', points: [[-56, 46], [56, 46]], width: 12 },
];
