/**
 * Pure coordinate & spatial plan for Dogfight (`map: 'dogfight'`, `contract: 'dogfight'`).
 * Zero three.js imports so tests, wave directors, and carrier defense systems can read every
 * coordinate directly without pulling renderer state.
 *
 * USS SOVEREIGN (CVN-88) — Open-Ocean Aircraft Carrier Air-Combat Arena:
 *   - Ocean sea level at y = 0 stretching visually to +-900 m.
 *   - Playable airspace bounds: 520 m x 520 m (x, z in [-260, +260]), ceiling y = 185 m.
 *   - Carrier flight deck at y = 10 m, 144 m long (z in [-72, +72]), ~38 m wide.
 *   - Starboard Island command tower on +X side; wide angled landing waist on -X side.
 *   - Catapult Pad 1 sits clear ahead of the player spawn for instant takeoff, flanked by two
 *     interactive deck terminals (Aircraft Select & Carrier Defenses).
 */

export const CARRIER_DECK_Y = 10;

export const DOGFIGHT_BOUNDS = {
  x0: -260,
  y0: -14,
  z0: -260,
  x1: 260,
  y1: 185,
  z1: 260,
} as const;

/**
 * Compact LightVolume bounds centered around the carrier deck & island tower.
 * 192 m / 1.6 m = 120 cells (<= 200), 224 m / 1.6 m = 140 cells (<= 200), 48 m / 1.6 m = 30 cells (<= 48).
 */
export const DOGFIGHT_LIGHT_BOUNDS = {
  x0: -96,
  y0: -2,
  z0: -112,
  x1: 96,
  y1: 46,
  z1: 112,
} as const;

export const DOGFIGHT_LIGHT_CELL = 1.6;

export const DOGFIGHT_LEVELS = [CARRIER_DECK_Y] as const;

export const DOGFIGHT_HUB_PT: readonly [number, number, number] = [2, CARRIER_DECK_Y, 4];

/** Player spawns on the flight deck beside the island terminals looking straight at the staged catapult jet. */
export const DOGFIGHT_PLAYER_SPAWN: readonly [number, number, number] = [5.2, CARRIER_DECK_Y, 5.2];
export const DOGFIGHT_PLAYER_YAW = 1.05;

/** Catapult launch pad where the player's selected jet spawns, aimed straight down the bow runway (-Z => yaw = PI). */
export const CARRIER_CATAPULT_PAD: readonly [number, number, number] = [-4.2, CARRIER_DECK_Y, 12.0];
export const CARRIER_CATAPULT_YAW = Math.PI;

/** Secondary deck wingman launch pad (port angled deck) for friendly AI escort launches. */
export const CARRIER_WINGMAN_PAD: readonly [number, number, number] = [-14.0, CARRIER_DECK_Y + 0.5, 22.0];

/** Interactive deck terminals beside the starboard island superstructure. */
export const CARRIER_AIRCRAFT_TERMINAL: readonly [number, number, number] = [9.2, CARRIER_DECK_Y, 6.2];
export const CARRIER_DEFENSE_TERMINAL: readonly [number, number, number] = [9.2, CARRIER_DECK_Y, -4.2];

/** Carrier center aimpoint for enemy strike runs and distance checks. */
export const CARRIER_CENTER: readonly [number, number, number] = [0, CARRIER_DECK_Y + 4, 0];

/** Footprint bounding box of the flight deck for landing repair & rescue checks. */
export const CARRIER_DECK_RECT = {
  x0: -23.5,
  x1: 17.5,
  z0: -72,
  z1: 72,
} as const;

export interface SponsonMount {
  readonly id: string;
  readonly role: 'ciws' | 'sam';
  readonly at: readonly [number, number, number];
  readonly defaultYaw: number;
}

/** 4 CIWS Phalanx mounts + 3 SeaRAM SAM launcher sponsons around the carrier perimeter. */
export const CARRIER_CIWS_MOUNTS: readonly SponsonMount[] = [
  { id: 'ciws_bow_port',  role: 'ciws', at: [-18.8, CARRIER_DECK_Y + 0.8, -56.0], defaultYaw: Math.PI },
  { id: 'ciws_bow_stbd',  role: 'ciws', at: [16.8,  CARRIER_DECK_Y + 0.8, -56.0], defaultYaw: Math.PI },
  { id: 'ciws_st_port',   role: 'ciws', at: [-21.5, CARRIER_DECK_Y + 0.8,  52.0], defaultYaw: 0 },
  { id: 'ciws_st_stbd',   role: 'ciws', at: [16.8,  CARRIER_DECK_Y + 0.8,  52.0], defaultYaw: 0 },
];

export const CARRIER_SAM_MOUNTS: readonly SponsonMount[] = [
  { id: 'sam_island_fwd', role: 'sam', at: [14.5, CARRIER_DECK_Y + 12.2, -13.5], defaultYaw: Math.PI },
  { id: 'sam_island_aft', role: 'sam', at: [14.5, CARRIER_DECK_Y + 12.2,  13.5], defaultYaw: 0 },
  { id: 'sam_port_mid',   role: 'sam', at: [-22.6, CARRIER_DECK_Y + 0.8,  -4.0], defaultYaw: -Math.PI / 2 },
];

/** High-altitude ocean airspace entry points for hostile enemy jet squadrons. */
export const DOGFIGHT_SKY_SPAWNS: readonly (readonly [number, number, number])[] = [
  [0, 68, -235],
  [145, 76, -195],
  [-145, 72, -195],
  [230, 82, -40],
  [-230, 78, -40],
  [175, 86, 170],
  [-175, 84, 170],
  [0, 92, 235],
];

/** Deck supply pickup locations (health / ammo near island ops room). */
export const DOGFIGHT_PICKUPS: readonly (readonly [number, number, number])[] = [
  [7.8, CARRIER_DECK_Y + 0.4, 14.0],
  [7.8, CARRIER_DECK_Y + 0.4, -14.0],
];
