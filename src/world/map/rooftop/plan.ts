/**
 * Rooftop Skyline plan: every skyscraper footprint, elevation, bridge, stairwell door,
 * hover fast-rope LZ, paratrooper drop zone, sniper perch, and pickup coordinate in one place.
 *
 * Engine budgets honored:
 *   - NavGraph sampling: TOP_Y = 118, BOTTOM_Y = -19 -> playable roofs in y = 20..44.5, killY = 5
 *   - LightVolume MAX_DIMS = [200, 48, 200] -> lightBounds 168x40x168 @ 1.2m cell = 140x34x140
 */
import * as THREE from 'three';

export const ROOFTOP_BOUNDS = {
  x0: -84, x1: 84,
  y0: -12, y1: 76,
  z0: -84, z1: 84,
} as const;

export const ROOFTOP_LIGHT_BOUNDS = {
  x0: -84, x1: 84,
  y0: 14, y1: 54,
  z0: -84, z1: 84,
} as const;

export const ROOFTOP_LIGHT_CELL = 1.2;

/** Lethal fall kill-plane elevation: 15 m below the lowest playable deck (y = 20) and well above bounds.min.y (-12). */
export const ROOFTOP_KILL_Y = 5;

/** Visual street chasm floor far beneath the skyscrapers (non-colliding). */
export const CHASM_Y = -18;

/** Central hub on Apex Plaza that every walkable node connects to mutually. */
export const ROOFTOP_HUB = new THREE.Vector3(0, 28, 10);

/** Every walkable flat elevation included in NavGraph.levels. Parkour-only planks & sniper booms intentionally sit off these heights. */
export const LV = {
  bastion: 20,
  citadel: 22,
  foundry: 24,
  bastionMid: 25,
  meridian: 26,
  apex: 28,
  vanguard: 30,
  meridianMid: 31,
  helios: 34,
  meridianTop: 36,
  heliosTop: 40,
} as const;

export type TowerId = 'apex' | 'helios' | 'foundry' | 'meridian' | 'bastion' | 'vanguard' | 'citadel';

export interface TowerSpec {
  readonly id: TowerId;
  readonly zone: string;
  readonly name: string;
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  readonly y: number;
  readonly accent: 'emissiveCyan' | 'emissiveOrange' | 'emissiveMagenta' | 'emissiveWhite';
  readonly facade: 'glass' | 'concrete' | 'panel' | 'concreteDark';
  readonly rgb: readonly [number, number, number];
}

export const TOWERS: readonly TowerSpec[] = [
  { id: 'apex', zone: 'roof-apex', name: 'APEX PLAZA', x0: -22, x1: 22, z0: -20, z1: 20, y: LV.apex, accent: 'emissiveCyan', facade: 'glass', rgb: [110, 140, 165] },
  { id: 'helios', zone: 'roof-helios', name: 'HELIOS TOWER', x0: -20, x1: 20, z0: -68, z1: -32, y: LV.helios, accent: 'emissiveWhite', facade: 'glass', rgb: [130, 155, 185] },
  { id: 'foundry', zone: 'roof-foundry', name: 'EAST CONSTRUCTION', x0: 34, x1: 72, z0: -22, z1: 20, y: LV.foundry, accent: 'emissiveOrange', facade: 'concrete', rgb: [145, 125, 102] },
  { id: 'meridian', zone: 'roof-meridian', name: 'MERIDIAN EXCHANGE', x0: -72, x1: -34, z0: -22, z1: 22, y: LV.meridian, accent: 'emissiveCyan', facade: 'panel', rgb: [108, 124, 146] },
  { id: 'bastion', zone: 'roof-bastion', name: 'SOUTH ANNEX', x0: -24, x1: 24, z0: 32, z1: 68, y: LV.bastion, accent: 'emissiveOrange', facade: 'concreteDark', rgb: [98, 108, 118] },
  { id: 'vanguard', zone: 'roof-vanguard', name: 'NW RELAY TOWER', x0: -70, x1: -34, z0: -66, z1: -34, y: LV.vanguard, accent: 'emissiveMagenta', facade: 'panel', rgb: [122, 112, 150] },
  { id: 'citadel', zone: 'roof-citadel', name: 'SE GLASS ATRIUM', x0: 34, x1: 70, z0: 32, z1: 66, y: LV.citadel, accent: 'emissiveCyan', facade: 'glass', rgb: [104, 142, 152] },
];

export const TOWER_BY_ID: Record<TowerId, TowerSpec> = Object.fromEntries(
  TOWERS.map(t => [t.id, t]),
) as Record<TowerId, TowerSpec>;

export interface BridgeSpec {
  readonly id: string;
  readonly ax: number;
  readonly az: number;
  readonly ay: number;
  readonly bx: number;
  readonly bz: number;
  readonly by: number;
  readonly width: number;
  readonly style: 'glass' | 'catwalk' | 'steel';
}

/** Walkable skybridges & construction catwalks (every slope <= 0.50, step <= 0.62m) linking all 7 towers into two flanking loops. */
export const BRIDGES: readonly BridgeSpec[] = [
  { id: 'apex-helios', ax: -4, az: -20, ay: LV.apex, bx: -4, bz: -32, by: LV.helios, width: 4.4, style: 'glass' },
  { id: 'apex-foundry', ax: 22, az: 6, ay: LV.apex, bx: 34, bz: 6, by: LV.foundry, width: 4.4, style: 'catwalk' },
  { id: 'apex-meridian', ax: -22, az: 10, ay: LV.apex, bx: -34, bz: 10, by: LV.meridian, width: 4.4, style: 'glass' },
  { id: 'apex-bastion', ax: 6, az: 20, ay: LV.apex, bx: 6, bz: 36, by: LV.bastion, width: 4.6, style: 'steel' },
  { id: 'meridian-vanguard', ax: -54, az: -22, ay: LV.meridian, bx: -54, bz: -34, by: LV.vanguard, width: 4.2, style: 'catwalk' },
  { id: 'vanguard-helios', ax: -34, az: -46, ay: LV.vanguard, bx: -20, bz: -46, by: LV.helios, width: 4.2, style: 'catwalk' },
  { id: 'foundry-citadel', ax: 52, az: 20, ay: LV.foundry, bx: 52, bz: 32, by: LV.citadel, width: 4.2, style: 'steel' },
  { id: 'bastion-citadel', ax: 24, az: 48, ay: LV.bastion, bx: 34, bz: 48, by: LV.citadel, width: 4.2, style: 'catwalk' },
];

export interface StairwellDoor {
  readonly id: string;
  readonly tower: TowerId;
  readonly zone: string;
  /** Spawn/exit threshold on the rooftop slab outside the bulkhead doorway. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Outward unit normal pointing onto the roof deck. */
  readonly nx: number;
  readonly nz: number;
  readonly width: number;
}

/** Rooftop stairwell and elevator access doors across all 7 skyscrapers (also registered as spec.gates & spec.plan.doors). */
export const STAIRWELL_DOORS: readonly StairwellDoor[] = [
  { id: 'apex_nw', tower: 'apex', zone: 'roof-apex', x: -10, y: LV.apex, z: -9, nx: 1, nz: 0, width: 2.6 },
  { id: 'apex_se', tower: 'apex', zone: 'roof-apex', x: 12, y: LV.apex, z: 15, nx: -1, nz: 0, width: 2.6 },
  { id: 'helios_s', tower: 'helios', zone: 'roof-helios', x: -4, y: LV.helios, z: -51, nx: 0, nz: 1, width: 2.6 },
  { id: 'helios_w', tower: 'helios', zone: 'roof-helios', x: -13, y: LV.helios, z: -58, nx: -1, nz: 0, width: 2.6 },
  { id: 'foundry_core', tower: 'foundry', zone: 'roof-foundry', x: 61, y: LV.foundry, z: 12, nx: -1, nz: 0, width: 2.6 },
  { id: 'meridian_e', tower: 'meridian', zone: 'roof-meridian', x: -43, y: LV.meridian, z: 1, nx: 0, nz: 1, width: 2.6 },
  { id: 'bastion_w', tower: 'bastion', zone: 'roof-bastion', x: -14, y: LV.bastion, z: 37.5, nx: 1, nz: 0, width: 2.6 },
  { id: 'bastion_e', tower: 'bastion', zone: 'roof-bastion', x: 14, y: LV.bastion, z: 61.5, nx: -1, nz: 0, width: 2.6 },
  { id: 'vanguard_s', tower: 'vanguard', zone: 'roof-vanguard', x: -51, y: LV.vanguard, z: -46, nx: 1, nz: 0, width: 2.6 },
  { id: 'citadel_mezz', tower: 'citadel', zone: 'roof-citadel', x: 57, y: LV.citadel, z: 39, nx: -1, nz: 0, width: 2.6 },
];

export interface HoverDropZone {
  readonly id: string;
  readonly tower: TowerId;
  readonly zone: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Recommended helicopter fast-rope hover altitude above the deck. */
  readonly hoverY: number;
  readonly radius: number;
}

/** Helipad and clear open-sky fast-rope helicopter hover drop zones (one per skyscraper). */
export const HOVER_DROP_ZONES: readonly HoverDropZone[] = [
  { id: 'lz_apex_helipad', tower: 'apex', zone: 'roof-apex', x: 0, y: LV.apex, z: 0, hoverY: LV.apex + 12, radius: 6.5 },
  { id: 'lz_helios_deck', tower: 'helios', zone: 'roof-helios', x: 5, y: LV.helios, z: -41, hoverY: LV.helios + 12, radius: 5.5 },
  { id: 'lz_foundry_slab', tower: 'foundry', zone: 'roof-foundry', x: 46, y: LV.foundry, z: 6, hoverY: LV.foundry + 12, radius: 5.5 },
  { id: 'lz_meridian_court', tower: 'meridian', zone: 'roof-meridian', x: -54, y: LV.meridian, z: 12, hoverY: LV.meridian + 12, radius: 5.5 },
  { id: 'lz_bastion_pad', tower: 'bastion', zone: 'roof-bastion', x: 6, y: LV.bastion, z: 52, hoverY: LV.bastion + 12, radius: 6.5 },
  { id: 'lz_vanguard_east', tower: 'vanguard', zone: 'roof-vanguard', x: -42, y: LV.vanguard, z: -56, hoverY: LV.vanguard + 12, radius: 5 },
  { id: 'lz_citadel_atrium', tower: 'citadel', zone: 'roof-citadel', x: 45, y: LV.citadel, z: 46, hoverY: LV.citadel + 12, radius: 5.5 },
];

export interface ParatrooperZone {
  readonly id: string;
  readonly tower: TowerId;
  readonly zone: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
}

/** Open-sky paratrooper landing zones across the skyscraper rooftops. */
export const PARATROOPER_ZONES: readonly ParatrooperZone[] = HOVER_DROP_ZONES.map(z => ({
  id: z.id.replace('lz_', 'para_'),
  tower: z.tower,
  zone: z.zone,
  x: z.x,
  y: z.y,
  z: z.z,
  radius: z.radius,
}));

/** Wide open rooftop pads safe for boss (Juggernaut / Titan) drop-ins. */
export const BOSS_DROP_ZONES: readonly ParatrooperZone[] = [
  PARATROOPER_ZONES[0]!,
  PARATROOPER_ZONES[1]!,
  PARATROOPER_ZONES[2]!,
  PARATROOPER_ZONES[3]!,
  PARATROOPER_ZONES[4]!,
];

export interface SniperPerch {
  readonly id: string;
  readonly tower: TowerId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly navReachable: boolean;
}

export const SNIPER_PERCHES: readonly SniperPerch[] = [
  { id: 'crane_boom', tower: 'foundry', x: 44, y: 38.5, z: -10, navReachable: false },
  { id: 'comms_spire', tower: 'helios', x: -2, y: 44.5, z: -58, navReachable: false },
  { id: 'water_tower_deck', tower: 'bastion', x: -16, y: LV.vanguard, z: 54, navReachable: true },
  { id: 'apex_penthouse', tower: 'apex', x: -15, y: LV.helios, z: -9, navReachable: true },
  { id: 'meridian_terrace', tower: 'meridian', x: -43, y: LV.meridianTop, z: -7, navReachable: true },
];

export const PLAYER_SPAWNS: readonly { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }[] = [
  { x: 0, y: LV.apex, z: 12, yaw: 0 },
  { x: -5, y: LV.apex, z: 13, yaw: -0.15 },
  { x: 5, y: LV.apex, z: 13, yaw: 0.15 },
];

/** Open-sky rooftop pickup and supply pod spots, covering every skyscraper. */
export const PICKUP_SPOTS: readonly (readonly [number, number, number])[] = [
  [0, LV.apex, 0],
  [12, LV.apex, -4],
  [-8, LV.apex, 12],
  [5, LV.helios, -41],
  [-8, LV.helios, -40],
  [46, LV.foundry, 6],
  [44, LV.foundry, -12],
  [-54, LV.meridian, 12],
  [-42, LV.meridian, 14],
  [6, LV.bastion, 52],
  [-2, LV.bastion, 42],
  [-42, LV.vanguard, -56],
  [-42, LV.vanguard, -40],
  [45, LV.citadel, 46],
  [46, LV.citadel, 37],
];

/** Air flyer spawn points high above the perimeter sky. */
export const FLYER_SPAWNS: readonly (readonly [number, number, number])[] = [
  [-60, 56, -60],
  [60, 56, -60],
  [60, 56, 60],
  [-60, 56, 60],
  [0, 60, -72],
  [0, 58, 72],
];

/** Wall-run billboards & glass wall-run panels bridging lethal gaps between towers. */
export interface WallRunPanelSpec {
  readonly id: string;
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  readonly y0: number;
  readonly y1: number;
  readonly kind: 'billboard' | 'glass';
  readonly sign?: 'COMPLIANCE IS MANDATORY' | 'SMILE: YOU ARE BEING AUDITED' | 'GAP AHEAD' | 'WALL RUN' | 'HIGH VOLTAGE';
  readonly accent: 'emissiveCyan' | 'emissiveMagenta' | 'emissiveOrange';
}

export const WALL_RUN_PANELS: readonly WallRunPanelSpec[] = [
  // East side of Apex <-> Helios chasm (parallel to Z)
  { id: 'wr_apex_helios', x0: 11.7, x1: 12.3, z0: -32.6, z1: -19.4, y0: 27.2, y1: 37.8, kind: 'billboard', sign: 'SMILE: YOU ARE BEING AUDITED', accent: 'emissiveCyan' },
  // North side of Apex <-> Foundry chasm (parallel to X)
  { id: 'wr_apex_foundry', x0: 21.4, x1: 34.6, z0: -10.3, z1: -9.7, y0: 23.4, y1: 32.2, kind: 'billboard', sign: 'COMPLIANCE IS MANDATORY', accent: 'emissiveOrange' },
  // North side of Apex <-> Meridian chasm (parallel to X, sleek glass)
  { id: 'wr_apex_meridian', x0: -34.6, x1: -21.4, z0: -8.25, z1: -7.75, y0: 25.4, y1: 32.8, kind: 'glass', accent: 'emissiveCyan' },
  // West side of Apex <-> Bastion chasm (parallel to Z)
  { id: 'wr_apex_bastion', x0: -12.3, x1: -11.7, z0: 19.4, z1: 32.6, y0: 19.5, y1: 31.6, kind: 'billboard', sign: 'GAP AHEAD', accent: 'emissiveMagenta' },
  // East side of Meridian <-> Vanguard chasm (parallel to Z, sleek glass)
  { id: 'wr_meridian_vanguard', x0: -40.25, x1: -39.75, z0: -34.6, z1: -21.4, y0: 25.4, y1: 34.2, kind: 'glass', accent: 'emissiveMagenta' },
];
