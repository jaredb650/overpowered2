/**
 * Structured Target & Tactical Registry for Map 3: Fortress Halcyon (`map: 'halcyon'`).
 * Zero three.js imports — consumed by `halcyon/index.ts`, the Crossfire Part 3 mission director,
 * BaseDefenseSystem, allied ground assault AI, and tactical HUD target tracking.
 *
 * Every destructible military facility lists its exact linked `clusterIds` (DestructionManager)
 * and/or `structureIds` (Structures 0-based `Structure.id` indices) so real-time destruction
 * directly drives mission objectives, NavGraph breach unblocking, and radio dialogue.
 */
import {
  HALCYON_CORNER_TOWERS,
  HALCYON_DISTRICTS,
  HALCYON_WALL_IDS_BY_SECTION,
  type Vec2Tuple,
  type Vec3Tuple,
  type WallSectionKey,
} from './plan';

export type HalcyonTargetCategory =
  | 'wall'
  | 'mortar'
  | 'sam'
  | 'flak'
  | 'radar'
  | 'tank_armory'
  | 'hangar'
  | 'parked_aircraft'
  | 'fuel_ammo'
  | 'barracks'
  | 'hq';

export interface HalcyonTargetDef {
  readonly id: string;
  readonly name: string;
  readonly category: HalcyonTargetCategory;
  readonly district: string;
  readonly pos: Vec3Tuple;
  readonly radius: number;
  readonly hp: number;
  /** 1 = mission-critical objective, 2 = major air/ground defense or war asset, 3 = secondary military asset. */
  readonly priority: 1 | 2 | 3;
  readonly value: number;
  /** Linked `StructuralClusterSpec.id` values in `DestructionManager`. */
  readonly clusterIds: readonly string[];
  /** Linked 0-based `Structure.id` indices in `Structures` (`spec.structures`). */
  readonly structureIds: readonly number[];
}

export interface HalcyonBreachWallDef {
  readonly id: string;
  readonly name: string;
  readonly section: WallSectionKey;
  readonly pos: Vec3Tuple;
  readonly radius: number;
  readonly structureIds: readonly number[];
  /** Ground lane IDs that unlock once this breach section is blasted open. */
  readonly unlocksLanes: readonly string[];
}

export type HalcyonDefenseRole = 'mortar' | 'sam' | 'flak' | 'radar';

export interface HalcyonDefenseSiteDef {
  readonly id: string;
  readonly name: string;
  readonly role: HalcyonDefenseRole;
  /** Ground footprint center of the emplacement. */
  readonly pos: Vec3Tuple;
  /** Exact turret / launcher / dish elevation for live BaseDefenseSystem mounting. */
  readonly mountPos: Vec3Tuple;
  readonly defaultYaw: number;
  readonly range: number;
  readonly targetId: string;
  readonly clusterId: string;
}

export interface HalcyonGroundLaneDef {
  readonly id: string;
  readonly name: string;
  readonly faction: 'friendly' | 'enemy';
  readonly role: 'armor_breach' | 'infantry_assault' | 'counterattack';
  /** Optional breach wall ID required before friendly armor pours through. */
  readonly breachWallId?: string;
  readonly spawn: Vec2Tuple;
  readonly waypoints: readonly Vec2Tuple[];
}

export interface HalcyonChopperLzDef {
  readonly id: string;
  readonly name: string;
  readonly phase: 'beachhead' | 'inner_assault';
  readonly pos: Vec3Tuple;
  readonly approachFrom: Vec3Tuple;
  readonly egressTo: Vec3Tuple;
  readonly radius: number;
}

export interface HalcyonAirPatrolDef {
  readonly id: string;
  readonly name: string;
  readonly faction: 'enemy' | 'friendly';
  readonly role: 'cap_orbit' | 'bomber_corridor' | 'cas_escort';
  readonly altitude: number;
  readonly waypoints: readonly Vec3Tuple[];
}

export interface HalcyonAssetPlacement {
  readonly id: string;
  readonly name: string;
  readonly variant: string;
  readonly pos: Vec3Tuple;
  readonly yaw: number;
}

// ---------------------------------------------------------------------------
// Breachable Perimeter Wall Piece IDs (exact 0-based indices into spec.structures)
// ---------------------------------------------------------------------------

/** Section B central south blast wall + Main South Armored Gate (`x in [-28, +28], z = +98`). */
export const BREACH_SECTION_B_IDS: readonly number[] = [...HALCYON_WALL_IDS_BY_SECTION.south_section_b];
/** South-West Armored Gate breach sector (`x in [-88, -72], z = +98`). */
export const BREACH_WEST_GATE_IDS: readonly number[] = [...HALCYON_WALL_IDS_BY_SECTION.south_west_gate];
/** South-East Armored Gate breach sector (`x in [+72, +88], z = +98`). */
export const BREACH_EAST_GATE_IDS: readonly number[] = [...HALCYON_WALL_IDS_BY_SECTION.south_east_gate];
/** West Flank Armored Gate (`x = -142, z in [+16, +24]`). */
export const BREACH_FLANK_WEST_GATE_IDS: readonly number[] = [...HALCYON_WALL_IDS_BY_SECTION.west_flank_gate];
/** East Flank Armored Gate (`x = +142, z in [+16, +24]`). */
export const BREACH_FLANK_EAST_GATE_IDS: readonly number[] = [...HALCYON_WALL_IDS_BY_SECTION.east_flank_gate];

/** All primary south front breachable wall & gate piece IDs monitored by the mission director. */
export const BREACH_WALL_IDS: readonly number[] = [
  ...BREACH_SECTION_B_IDS,
  ...BREACH_WEST_GATE_IDS,
  ...BREACH_EAST_GATE_IDS,
];

export const HALCYON_BREACH_WALLS: readonly HalcyonBreachWallDef[] = [
  {
    id: 'breach_section_b',
    name: 'SOUTH BLAST WALL — SECTION B',
    section: 'south_section_b',
    pos: [0, 0, 98],
    radius: 28,
    structureIds: BREACH_SECTION_B_IDS,
    unlocksLanes: ['lane_center_breach'],
  },
  {
    id: 'breach_west_gate',
    name: 'SOUTH-WEST ARMORED GATE',
    section: 'south_west_gate',
    pos: [-80, 0, 98],
    radius: 10,
    structureIds: BREACH_WEST_GATE_IDS,
    unlocksLanes: ['lane_west_breach'],
  },
  {
    id: 'breach_east_gate',
    name: 'SOUTH-EAST ARMORED GATE',
    section: 'south_east_gate',
    pos: [80, 0, 98],
    radius: 10,
    structureIds: BREACH_EAST_GATE_IDS,
    unlocksLanes: ['lane_east_breach'],
  },
  {
    id: 'breach_flank_west',
    name: 'WEST FLANK GATE',
    section: 'west_flank_gate',
    pos: [-142, 0, 20],
    radius: 6,
    structureIds: BREACH_FLANK_WEST_GATE_IDS,
    unlocksLanes: [],
  },
  {
    id: 'breach_flank_east',
    name: 'EAST FLANK GATE',
    section: 'east_flank_gate',
    pos: [142, 0, 20],
    radius: 6,
    structureIds: BREACH_FLANK_EAST_GATE_IDS,
    unlocksLanes: [],
  },
];

// ---------------------------------------------------------------------------
// Individual Facility Coordinates (shared between targets.ts and index.ts)
// ---------------------------------------------------------------------------

export const HALCYON_DEFENSE_SITES: readonly HalcyonDefenseSiteDef[] = [
  // 3 Forward Mortar Trenches overlooking the South Beachhead
  {
    id: 'site_mortar_west',
    name: 'WEST MORTAR TRENCH',
    role: 'mortar',
    pos: [-96, 0, 72],
    mountPos: [-96, 1.4, 72],
    defaultYaw: Math.PI,
    range: 195,
    targetId: 'mortar_west',
    clusterId: 'halcyon.mortar.west',
  },
  {
    id: 'site_mortar_east',
    name: 'EAST MORTAR TRENCH',
    role: 'mortar',
    pos: [96, 0, 72],
    mountPos: [96, 1.4, 72],
    defaultYaw: Math.PI,
    range: 195,
    targetId: 'mortar_east',
    clusterId: 'halcyon.mortar.east',
  },
  {
    id: 'site_mortar_center',
    name: 'CENTRAL MORTAR PIT',
    role: 'mortar',
    pos: [0, 0, 64],
    mountPos: [0, 1.4, 64],
    defaultYaw: Math.PI,
    range: 210,
    targetId: 'mortar_center',
    clusterId: 'halcyon.mortar.center',
  },

  // 4 Heavy SAM Battery Pads (flanks & northern ridge)
  {
    id: 'site_sam_sw',
    name: 'SAM BATTERY ALPHA (SW)',
    role: 'sam',
    pos: [-124, 0, 10],
    mountPos: [-124, 3.2, 10],
    defaultYaw: Math.PI * 0.75,
    range: 620,
    targetId: 'sam_sw',
    clusterId: 'halcyon.sam.sw',
  },
  {
    id: 'site_sam_se',
    name: 'SAM BATTERY BRAVO (SE)',
    role: 'sam',
    pos: [124, 0, 10],
    mountPos: [124, 3.2, 10],
    defaultYaw: -Math.PI * 0.75,
    range: 620,
    targetId: 'sam_se',
    clusterId: 'halcyon.sam.se',
  },
  {
    id: 'site_sam_nw',
    name: 'SAM BATTERY CHARLIE (NW)',
    role: 'sam',
    pos: [-116, 0, -98],
    mountPos: [-116, 3.2, -98],
    defaultYaw: Math.PI * 0.25,
    range: 640,
    targetId: 'sam_nw',
    clusterId: 'halcyon.sam.nw',
  },
  {
    id: 'site_sam_ne',
    name: 'SAM BATTERY DELTA (NE)',
    role: 'sam',
    pos: [116, 0, -98],
    mountPos: [116, 3.2, -98],
    defaultYaw: -Math.PI * 0.25,
    range: 640,
    targetId: 'sam_ne',
    clusterId: 'halcyon.sam.ne',
  },

  // 3 Elevated Flak Tower Bastions (deck at y = 3.8, AA turret ring at y = 7.6)
  {
    id: 'site_flak_west',
    name: 'WEST FLAK BASTION',
    role: 'flak',
    pos: [-52, 0, 70],
    mountPos: [-52, 7.6, 70],
    defaultYaw: Math.PI,
    range: 460,
    targetId: 'flak_west',
    clusterId: 'halcyon.flak.west',
  },
  {
    id: 'site_flak_east',
    name: 'EAST FLAK BASTION',
    role: 'flak',
    pos: [52, 0, 70],
    mountPos: [52, 7.6, 70],
    defaultYaw: Math.PI,
    range: 460,
    targetId: 'flak_east',
    clusterId: 'halcyon.flak.east',
  },
  {
    id: 'site_flak_north',
    name: 'NORTH CITADEL FLAK TOWER',
    role: 'flak',
    pos: [0, 0, -104],
    mountPos: [0, 7.6, -104],
    defaultYaw: 0,
    range: 500,
    targetId: 'flak_north',
    clusterId: 'halcyon.flak.north',
  },

  // 2 Geodesic Early-Warning Radar Domes
  {
    id: 'site_radar_west',
    name: 'WEST RADAR DOME',
    role: 'radar',
    pos: [-48, 0, -96],
    mountPos: [-48, 8.2, -96],
    defaultYaw: 0,
    range: 820,
    targetId: 'radar_west',
    clusterId: 'halcyon.radar.west',
  },
  {
    id: 'site_radar_east',
    name: 'EAST RADAR DOME',
    role: 'radar',
    pos: [48, 0, -96],
    mountPos: [48, 8.2, -96],
    defaultYaw: 0,
    range: 820,
    targetId: 'radar_east',
    clusterId: 'halcyon.radar.east',
  },
];

/** 6 Destructible parked tanks/APCs in West Motor Pool blast revetments. */
export const HALCYON_PARKED_ARMOR: readonly HalcyonAssetPlacement[] = [
  { id: 'halcyon.parked_armor.1', name: 'PARKED MAIN BATTLE TANK #1', variant: 'tank', pos: [-112, 0, 26], yaw: Math.PI * 0.5 },
  { id: 'halcyon.parked_armor.2', name: 'PARKED MAIN BATTLE TANK #2', variant: 'tank', pos: [-94, 0, 26], yaw: Math.PI * 0.5 },
  { id: 'halcyon.parked_armor.3', name: 'PARKED BASTION APC #1', variant: 'apc', pos: [-76, 0, 26], yaw: Math.PI * 0.5 },
  { id: 'halcyon.parked_armor.4', name: 'PARKED MAIN BATTLE TANK #3', variant: 'tank', pos: [-112, 0, 44], yaw: Math.PI * 0.5 },
  { id: 'halcyon.parked_armor.5', name: 'PARKED BASTION APC #2', variant: 'apc', pos: [-94, 0, 44], yaw: Math.PI * 0.5 },
  { id: 'halcyon.parked_armor.6', name: 'PARKED BASTION APC #3', variant: 'apc', pos: [-76, 0, 44], yaw: Math.PI * 0.5 },
];

/** 6 Destructible parked strike fighters & attack choppers on the East Airfield alert line. */
export const HALCYON_PARKED_AIRCRAFT: readonly HalcyonAssetPlacement[] = [
  { id: 'halcyon.aircraft.1', name: 'PARKED INTERCEPTOR #1', variant: 'fighter', pos: [62, 0, -24], yaw: -Math.PI * 0.5 },
  { id: 'halcyon.aircraft.2', name: 'PARKED INTERCEPTOR #2', variant: 'fighter', pos: [62, 0, -8], yaw: -Math.PI * 0.5 },
  { id: 'halcyon.aircraft.3', name: 'PARKED INTERCEPTOR #3', variant: 'fighter', pos: [62, 0, 8], yaw: -Math.PI * 0.5 },
  { id: 'halcyon.aircraft.4', name: 'PARKED GUNSHIP CHOPPER #1', variant: 'chopper', pos: [62, 0, 24], yaw: -Math.PI * 0.5 },
  { id: 'halcyon.aircraft.5', name: 'PARKED GUNSHIP CHOPPER #2', variant: 'chopper', pos: [62, 0, 40], yaw: -Math.PI * 0.5 },
  { id: 'halcyon.aircraft.6', name: 'QRA ALERT FIGHTER #4', variant: 'fighter', pos: [99, 0, 52], yaw: Math.PI },
];

/** 6 Chain-exploding cylindrical fuel silos in NW Tank Farm. */
export const HALCYON_FUEL_SILOS: readonly HalcyonAssetPlacement[] = [
  { id: 'halcyon.fuel.1', name: 'FUEL SILO 01', variant: 'silo', pos: [-102, 0, -60], yaw: 0 },
  { id: 'halcyon.fuel.2', name: 'FUEL SILO 02', variant: 'silo', pos: [-82, 0, -60], yaw: 0 },
  { id: 'halcyon.fuel.3', name: 'FUEL SILO 03', variant: 'silo', pos: [-62, 0, -60], yaw: 0 },
  { id: 'halcyon.fuel.4', name: 'FUEL SILO 04', variant: 'silo', pos: [-102, 0, -76], yaw: 0 },
  { id: 'halcyon.fuel.5', name: 'FUEL SILO 05', variant: 'silo', pos: [-82, 0, -76], yaw: 0 },
  { id: 'halcyon.fuel.6', name: 'FUEL SILO 06', variant: 'silo', pos: [-62, 0, -76], yaw: 0 },
];

/** 3 Blast-bermed concrete ammunition bunkers on the NW northern edge. */
export const HALCYON_AMMO_BUNKERS: readonly HalcyonAssetPlacement[] = [
  { id: 'halcyon.ammo.1', name: 'AMMO BUNKER ALPHA', variant: 'bunker', pos: [-96, 0, -114], yaw: 0 },
  { id: 'halcyon.ammo.2', name: 'AMMO BUNKER BRAVO', variant: 'bunker', pos: [-76, 0, -114], yaw: 0 },
  { id: 'halcyon.ammo.3', name: 'AMMO BUNKER CHARLIE', variant: 'bunker', pos: [-56, 0, -114], yaw: 0 },
];

/** 3 Multi-story concrete military barracks blocks in NE Sector. */
export const HALCYON_BARRACKS: readonly HalcyonAssetPlacement[] = [
  { id: 'halcyon.barracks.west', name: 'GARRISON BARRACKS BLOCK A', variant: 'two_story', pos: [66, 0, -64], yaw: 0 },
  { id: 'halcyon.barracks.east', name: 'GARRISON BARRACKS BLOCK B', variant: 'two_story', pos: [102, 0, -64], yaw: 0 },
  { id: 'halcyon.barracks.north', name: 'OFFICER GARRISON BLOCK C', variant: 'three_story', pos: [82, 0, -114], yaw: 0 },
];

/** 2 Hardened arched aircraft hangars in East Airfield. */
export const HALCYON_HANGARS: readonly HalcyonAssetPlacement[] = [
  { id: 'halcyon.hangar.north', name: 'HARDENED AIRCRAFT HANGAR 01', variant: 'arched_hangar', pos: [99, 0, -14], yaw: 0 },
  { id: 'halcyon.hangar.south', name: 'HARDENED AIRCRAFT HANGAR 02', variant: 'arched_hangar', pos: [99, 0, 30], yaw: 0 },
];

/** West Sector Armored Vehicle Depot & Center Citadel Command HQ anchors. */
export const HALCYON_TANK_DEPOT_POS: Vec3Tuple = [-88, 0, -2];
export const HALCYON_CITADEL_HQ_POS: Vec3Tuple = [0, 0, -30];

// ---------------------------------------------------------------------------
// Complete Structured Target Registry (`HALCYON_TARGETS`)
// ---------------------------------------------------------------------------

export const HALCYON_TARGETS: readonly HalcyonTargetDef[] = [
  // 1. Perimeter Breach Walls & Corner Watchtowers (`wall`)
  {
    id: 'wall_section_b',
    name: 'SOUTH BLAST WALL — SECTION B',
    category: 'wall',
    district: HALCYON_DISTRICTS.perimeter.id,
    pos: [0, 0, 98],
    radius: 28,
    hp: 1800,
    priority: 1,
    value: 950_000,
    clusterIds: [],
    structureIds: BREACH_SECTION_B_IDS,
  },
  {
    id: 'wall_west_gate',
    name: 'SOUTH-WEST ARMORED GATE',
    category: 'wall',
    district: HALCYON_DISTRICTS.perimeter.id,
    pos: [-80, 0, 98],
    radius: 10,
    hp: 900,
    priority: 2,
    value: 310_000,
    clusterIds: [],
    structureIds: BREACH_WEST_GATE_IDS,
  },
  {
    id: 'wall_east_gate',
    name: 'SOUTH-EAST ARMORED GATE',
    category: 'wall',
    district: HALCYON_DISTRICTS.perimeter.id,
    pos: [80, 0, 98],
    radius: 10,
    hp: 900,
    priority: 2,
    value: 310_000,
    clusterIds: [],
    structureIds: BREACH_EAST_GATE_IDS,
  },
  {
    id: 'wall_corner_towers',
    name: 'PERIMETER WATCHTOWER NETWORK',
    category: 'wall',
    district: HALCYON_DISTRICTS.perimeter.id,
    pos: [0, 0, 96],
    radius: 145,
    hp: 1600,
    priority: 3,
    value: 440_000,
    clusterIds: HALCYON_CORNER_TOWERS.map(t => t.id),
    structureIds: [...BREACH_FLANK_WEST_GATE_IDS, ...BREACH_FLANK_EAST_GATE_IDS],
  },

  // 2. Mortar Trenches (`mortar`)
  {
    id: 'mortar_west',
    name: 'WEST MORTAR TRENCH',
    category: 'mortar',
    district: HALCYON_DISTRICTS.southTrenches.id,
    pos: [-96, 0, 72],
    radius: 9,
    hp: 650,
    priority: 2,
    value: 220_000,
    clusterIds: ['halcyon.mortar.west'],
    structureIds: [],
  },
  {
    id: 'mortar_east',
    name: 'EAST MORTAR TRENCH',
    category: 'mortar',
    district: HALCYON_DISTRICTS.southTrenches.id,
    pos: [96, 0, 72],
    radius: 9,
    hp: 650,
    priority: 2,
    value: 220_000,
    clusterIds: ['halcyon.mortar.east'],
    structureIds: [],
  },
  {
    id: 'mortar_center',
    name: 'CENTRAL MORTAR PIT',
    category: 'mortar',
    district: HALCYON_DISTRICTS.southTrenches.id,
    pos: [0, 0, 64],
    radius: 9,
    hp: 700,
    priority: 2,
    value: 240_000,
    clusterIds: ['halcyon.mortar.center'],
    structureIds: [],
  },

  // 3. SAM Battery Pads (`sam`)
  {
    id: 'sam_sw',
    name: 'SAM BATTERY ALPHA (SW)',
    category: 'sam',
    district: HALCYON_DISTRICTS.tankArmory.id,
    pos: [-124, 0, 10],
    radius: 10,
    hp: 950,
    priority: 1,
    value: 480_000,
    clusterIds: ['halcyon.sam.sw'],
    structureIds: [],
  },
  {
    id: 'sam_se',
    name: 'SAM BATTERY BRAVO (SE)',
    category: 'sam',
    district: HALCYON_DISTRICTS.airfield.id,
    pos: [124, 0, 10],
    radius: 10,
    hp: 950,
    priority: 1,
    value: 480_000,
    clusterIds: ['halcyon.sam.se'],
    structureIds: [],
  },
  {
    id: 'sam_nw',
    name: 'SAM BATTERY CHARLIE (NW)',
    category: 'sam',
    district: HALCYON_DISTRICTS.northRidge.id,
    pos: [-116, 0, -98],
    radius: 10,
    hp: 950,
    priority: 1,
    value: 480_000,
    clusterIds: ['halcyon.sam.nw'],
    structureIds: [],
  },
  {
    id: 'sam_ne',
    name: 'SAM BATTERY DELTA (NE)',
    category: 'sam',
    district: HALCYON_DISTRICTS.northRidge.id,
    pos: [116, 0, -98],
    radius: 10,
    hp: 950,
    priority: 1,
    value: 480_000,
    clusterIds: ['halcyon.sam.ne'],
    structureIds: [],
  },

  // 4. Elevated Flak Towers (`flak`)
  {
    id: 'flak_west',
    name: 'WEST FLAK BASTION',
    category: 'flak',
    district: HALCYON_DISTRICTS.southTrenches.id,
    pos: [-52, 3.8, 70],
    radius: 10,
    hp: 1100,
    priority: 2,
    value: 360_000,
    clusterIds: ['halcyon.flak.west'],
    structureIds: [],
  },
  {
    id: 'flak_east',
    name: 'EAST FLAK BASTION',
    category: 'flak',
    district: HALCYON_DISTRICTS.southTrenches.id,
    pos: [52, 3.8, 70],
    radius: 10,
    hp: 1100,
    priority: 2,
    value: 360_000,
    clusterIds: ['halcyon.flak.east'],
    structureIds: [],
  },
  {
    id: 'flak_north',
    name: 'NORTH CITADEL FLAK TOWER',
    category: 'flak',
    district: HALCYON_DISTRICTS.northRidge.id,
    pos: [0, 3.8, -104],
    radius: 10,
    hp: 1200,
    priority: 2,
    value: 380_000,
    clusterIds: ['halcyon.flak.north'],
    structureIds: [],
  },

  // 5. Geodesic Radar Domes (`radar`)
  {
    id: 'radar_west',
    name: 'WEST GEODESIC RADAR DOME',
    category: 'radar',
    district: HALCYON_DISTRICTS.northRidge.id,
    pos: [-48, 0, -96],
    radius: 11,
    hp: 1250,
    priority: 1,
    value: 550_000,
    clusterIds: ['halcyon.radar.west'],
    structureIds: [],
  },
  {
    id: 'radar_east',
    name: 'EAST GEODESIC RADAR DOME',
    category: 'radar',
    district: HALCYON_DISTRICTS.northRidge.id,
    pos: [48, 0, -96],
    radius: 11,
    hp: 1250,
    priority: 1,
    value: 550_000,
    clusterIds: ['halcyon.radar.east'],
    structureIds: [],
  },

  // 6. West Sector — Tank Armory & Armored Motor Pool (`tank_armory`)
  {
    id: 'tank_armory_depot',
    name: 'ARMORED VEHICLE DEPOT',
    category: 'tank_armory',
    district: HALCYON_DISTRICTS.tankArmory.id,
    pos: HALCYON_TANK_DEPOT_POS,
    radius: 24,
    hp: 2400,
    priority: 1,
    value: 1_100_000,
    clusterIds: ['halcyon.tank_armory.depot'],
    structureIds: [],
  },
  {
    id: 'tank_armory_motor_pool',
    name: 'ARMORED MOTOR POOL REVETMENTS',
    category: 'tank_armory',
    district: HALCYON_DISTRICTS.tankArmory.id,
    pos: [-94, 0, 35],
    radius: 26,
    hp: 1800,
    priority: 2,
    value: 780_000,
    clusterIds: HALCYON_PARKED_ARMOR.map(a => a.id),
    structureIds: [],
  },

  // 7. East Sector — Hardened Airfield Hangars (`hangar`)
  {
    id: 'hangar_north',
    name: 'HARDENED AIRCRAFT HANGAR 01',
    category: 'hangar',
    district: HALCYON_DISTRICTS.airfield.id,
    pos: [99, 0, -14],
    radius: 20,
    hp: 2100,
    priority: 1,
    value: 880_000,
    clusterIds: ['halcyon.hangar.north'],
    structureIds: [],
  },
  {
    id: 'hangar_south',
    name: 'HARDENED AIRCRAFT HANGAR 02',
    category: 'hangar',
    district: HALCYON_DISTRICTS.airfield.id,
    pos: [99, 0, 30],
    radius: 20,
    hp: 2100,
    priority: 1,
    value: 880_000,
    clusterIds: ['halcyon.hangar.south'],
    structureIds: [],
  },

  // 8. East Sector — Parked Flight Line (`parked_aircraft`)
  {
    id: 'flightline_fighters',
    name: 'ALERT INTERCEPTOR FLIGHT LINE',
    category: 'parked_aircraft',
    district: HALCYON_DISTRICTS.airfield.id,
    pos: [62, 0, -8],
    radius: 22,
    hp: 900,
    priority: 2,
    value: 690_000,
    clusterIds: ['halcyon.aircraft.1', 'halcyon.aircraft.2', 'halcyon.aircraft.3'],
    structureIds: [],
  },
  {
    id: 'flightline_choppers',
    name: 'GUNSHIP REARMING APRON',
    category: 'parked_aircraft',
    district: HALCYON_DISTRICTS.airfield.id,
    pos: [62, 0, 32],
    radius: 16,
    hp: 650,
    priority: 2,
    value: 520_000,
    clusterIds: ['halcyon.aircraft.4', 'halcyon.aircraft.5'],
    structureIds: [],
  },
  {
    id: 'flightline_qra_pad',
    name: 'SOUTH QRA ALERT PAD',
    category: 'parked_aircraft',
    district: HALCYON_DISTRICTS.airfield.id,
    pos: [99, 0, 52],
    radius: 12,
    hp: 350,
    priority: 3,
    value: 260_000,
    clusterIds: ['halcyon.aircraft.6'],
    structureIds: [],
  },

  // 9. NW Sector — Fuel Tank Farm & Blast-Bermed Ammo Depot (`fuel_ammo`)
  {
    id: 'fuel_tank_farm',
    name: 'NW STRATEGIC FUEL TANK FARM',
    category: 'fuel_ammo',
    district: HALCYON_DISTRICTS.fuelAmmo.id,
    pos: [-82, 0, -68],
    radius: 28,
    hp: 1500,
    priority: 1,
    value: 1_200_000,
    clusterIds: HALCYON_FUEL_SILOS.map(s => s.id),
    structureIds: [],
  },
  {
    id: 'ammo_bunker_depot',
    name: 'BLAST-BERMED AMMUNITION DEPOT',
    category: 'fuel_ammo',
    district: HALCYON_DISTRICTS.fuelAmmo.id,
    pos: [-76, 0, -114],
    radius: 26,
    hp: 1800,
    priority: 2,
    value: 960_000,
    clusterIds: HALCYON_AMMO_BUNKERS.map(b => b.id),
    structureIds: [],
  },

  // 10. NE Sector — Concrete Barracks Complex (`barracks`)
  {
    id: 'barracks_west',
    name: 'GARRISON BARRACKS BLOCK A',
    category: 'barracks',
    district: HALCYON_DISTRICTS.barracks.id,
    pos: [66, 0, -64],
    radius: 15,
    hp: 1400,
    priority: 2,
    value: 450_000,
    clusterIds: ['halcyon.barracks.west'],
    structureIds: [],
  },
  {
    id: 'barracks_east',
    name: 'GARRISON BARRACKS BLOCK B',
    category: 'barracks',
    district: HALCYON_DISTRICTS.barracks.id,
    pos: [102, 0, -64],
    radius: 15,
    hp: 1400,
    priority: 2,
    value: 450_000,
    clusterIds: ['halcyon.barracks.east'],
    structureIds: [],
  },
  {
    id: 'barracks_north',
    name: 'OFFICER GARRISON BLOCK C',
    category: 'barracks',
    district: HALCYON_DISTRICTS.barracks.id,
    pos: [82, 0, -114],
    radius: 18,
    hp: 1800,
    priority: 2,
    value: 620_000,
    clusterIds: ['halcyon.barracks.north'],
    structureIds: [],
  },

  // 11. Center Citadel — Fortress Halcyon Command HQ (`hq`)
  {
    id: 'citadel_command_hq',
    name: 'FORTRESS HALCYON COMMAND HQ',
    category: 'hq',
    district: HALCYON_DISTRICTS.citadel.id,
    pos: HALCYON_CITADEL_HQ_POS,
    radius: 26,
    hp: 4500,
    priority: 1,
    value: 2_500_000,
    clusterIds: ['halcyon.citadel.hq'],
    structureIds: [],
  },
];

// ---------------------------------------------------------------------------
// Ground Assault Lanes, Fast-Rope Chopper LZs & Air Patrol Corridors
// ---------------------------------------------------------------------------

export const HALCYON_GROUND_LANES: readonly HalcyonGroundLaneDef[] = [
  {
    id: 'lane_center_breach',
    name: 'Mercer Armored Spearhead (Section B)',
    faction: 'friendly',
    role: 'armor_breach',
    breachWallId: 'breach_section_b',
    spawn: [0, 166],
    waypoints: [[0, 128], [0, 98], [0, 82], [14, 72], [14, 52], [0, 34], [0, 14]],
  },
  {
    id: 'lane_west_breach',
    name: 'West Flank Armor Column (SW Gate)',
    faction: 'friendly',
    role: 'armor_breach',
    breachWallId: 'breach_west_gate',
    spawn: [-80, 166],
    waypoints: [[-80, 126], [-80, 98], [-80, 82], [-38, 60], [-38, 12], [-38, -42]],
  },
  {
    id: 'lane_east_breach',
    name: 'East Flank Assault Column (SE Gate)',
    faction: 'friendly',
    role: 'armor_breach',
    breachWallId: 'breach_east_gate',
    spawn: [80, 166],
    waypoints: [[80, 126], [80, 98], [80, 82], [38, 60], [38, 12], [38, -42]],
  },
  {
    id: 'lane_beach_infantry_w',
    name: 'Beachhead Infantry West Wave',
    faction: 'friendly',
    role: 'infantry_assault',
    breachWallId: 'breach_section_b',
    spawn: [-30, 160],
    waypoints: [[-20, 126], [-14, 98], [-14, 72], [-14, 48], [0, 14]],
  },
  {
    id: 'lane_enemy_armor_west',
    name: 'Enemy Tank Armory Counterattack',
    faction: 'enemy',
    role: 'counterattack',
    spawn: [-54, 16],
    waypoints: [[-38, 20], [-38, 62], [-38, 82], [0, 82]],
  },
  {
    id: 'lane_enemy_armor_east',
    name: 'Enemy NE Garrison QRF Rollout',
    faction: 'enemy',
    role: 'counterattack',
    spawn: [84, -84],
    waypoints: [[38, -42], [38, 14], [38, 82], [0, 82]],
  },
];

export const HALCYON_CHOPPER_LZS: readonly HalcyonChopperLzDef[] = [
  // 3 South Beachhead Fast-Rope Valkyrie LZs
  {
    id: 'lz_beach_west',
    name: 'VALKYRIE LZ ALPHA (WEST BEACHHEAD)',
    phase: 'beachhead',
    pos: [-74, 0, 142],
    approachFrom: [-280, 48, 340],
    egressTo: [-320, 62, 220],
    radius: 14,
  },
  {
    id: 'lz_beach_center',
    name: 'VALKYRIE LZ BRAVO (CENTER BEACHHEAD)',
    phase: 'beachhead',
    pos: [0, 0, 144],
    approachFrom: [20, 52, 380],
    egressTo: [-160, 65, 360],
    radius: 16,
  },
  {
    id: 'lz_beach_east',
    name: 'VALKYRIE LZ CHARLIE (EAST BEACHHEAD)',
    phase: 'beachhead',
    pos: [74, 0, 142],
    approachFrom: [280, 48, 340],
    egressTo: [320, 62, 220],
    radius: 14,
  },
  // 2 Inner Fortress Combat Assault LZs (after SAMs/Flak suppressed)
  {
    id: 'lz_inner_west',
    name: 'FORWARD LZ DELTA (ARMORY FLANK)',
    phase: 'inner_assault',
    pos: [-38, 0, 26],
    approachFrom: [-260, 56, 140],
    egressTo: [-280, 74, -80],
    radius: 12,
  },
  {
    id: 'lz_inner_east',
    name: 'FORWARD LZ ECHO (AIRFIELD FLANK)',
    phase: 'inner_assault',
    pos: [38, 0, 26],
    approachFrom: [260, 56, 140],
    egressTo: [280, 74, -80],
    radius: 12,
  },
];

export const HALCYON_AIR_PATROLS: readonly HalcyonAirPatrolDef[] = [
  {
    id: 'patrol_enemy_cap_high',
    name: 'Halcyon Interceptor CAP (High)',
    faction: 'enemy',
    role: 'cap_orbit',
    altitude: 155,
    waypoints: [
      [-360, 155, -320],
      [360, 155, -320],
      [420, 165, 220],
      [-420, 165, 220],
    ],
  },
  {
    id: 'patrol_enemy_cap_low',
    name: 'Fortress Defense Gunship Orbit',
    faction: 'enemy',
    role: 'cap_orbit',
    altitude: 86,
    waypoints: [
      [-180, 86, -150],
      [180, 86, -150],
      [180, 86, 110],
      [-180, 86, 110],
    ],
  },
  {
    id: 'corridor_b1b_south_north',
    name: 'B-1B Lancer Primary Bombing Corridor (S -> N)',
    faction: 'friendly',
    role: 'bomber_corridor',
    altitude: 120,
    waypoints: [
      [0, 120, 620],
      [0, 115, 110],
      [0, 115, -30],
      [0, 130, -560],
    ],
  },
  {
    id: 'corridor_b1b_west_east',
    name: 'B-1B Lancer Cross-Fortress Sweep (W -> E)',
    faction: 'friendly',
    role: 'bomber_corridor',
    altitude: 112,
    waypoints: [
      [-640, 112, -20],
      [-100, 110, -20],
      [100, 110, -20],
      [640, 125, -20],
    ],
  },
  {
    id: 'patrol_friendly_escort',
    name: 'Friendly Fighter Escort Cover',
    faction: 'friendly',
    role: 'cas_escort',
    altitude: 145,
    waypoints: [
      [-460, 145, 420],
      [0, 145, 340],
      [460, 145, 420],
      [260, 155, -180],
      [-260, 155, -180],
    ],
  },
];

// ---------------------------------------------------------------------------
// Fast Lookup Helpers
// ---------------------------------------------------------------------------

export function getHalcyonTarget(id: string): HalcyonTargetDef | undefined {
  return HALCYON_TARGETS.find(t => t.id === id);
}

export function getHalcyonTargetsByCategory(category: HalcyonTargetCategory): readonly HalcyonTargetDef[] {
  return HALCYON_TARGETS.filter(t => t.category === category);
}

/** Reverse index from `StructuralClusterSpec.id` to its parent `HalcyonTargetDef.id`. */
export const HALCYON_CLUSTER_TO_TARGET: Readonly<Record<string, string>> = Object.fromEntries(
  HALCYON_TARGETS.flatMap(t => t.clusterIds.map(cid => [cid, t.id] as const)),
);
