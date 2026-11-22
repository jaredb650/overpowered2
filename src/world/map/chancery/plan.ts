/**
 * Chancery Estate ("Quiet Title") architectural plan and shared coordinate contract.
 *
 * Every elevation, zone footprint, stealth light fixture, wing breaker panel, sweeping CCTV camera,
 * alarm panel, spawn point, and sniper sightline lives here so Mission 3 scripts, Vane Director,
 * and geometry builders share a single exact source of truth.
 *
 * Engine budgets honored:
 *   - NavGraph sampling: TOP_Y = 118, BOTTOM_Y = -19 -> bounds y in [-14, 46], killY = -18
 *   - LightVolume MAX_DIMS = [200, 48, 200] -> lightBounds 184x48x154 @ 1.2 m = 154x40x129
 */
import * as THREE from 'three';
import type { AlarmPanelSpec } from '../../alarms';
import type { BreakerSpec } from '../../breakers';
import type { CameraSpec } from '../../cameras';
import type { LightFixtureSpec } from '../../lights';

export const CHANCERY_BOUNDS = {
  x0: -92,
  y0: -14,
  z0: -82,
  x1: 92,
  y1: 46,
  z1: 72,
} as const;

export const CHANCERY_LIGHT_BOUNDS = {
  x0: -92,
  y0: -12,
  z0: -82,
  x1: 92,
  y1: 36,
  z1: 72,
} as const;

export const CHANCERY_LIGHT_CELL = 1.2;

export const CHANCERY_KILL_Y = -18;

export const CHANCERY_LEVELS: readonly number[] = [-8, 0, 6, 11.5];

export const CHANCERY_HUB = new THREE.Vector3(0, 0, 12);

/** Named floor elevations matching CHANCERY_LEVELS. */
export const LV = {
  sub: -8,
  ground: 0,
  upper: 6,
  perch: 11.5,
} as const;

/** Key architectural ceilings & structural heights. */
export const CEIL = {
  sub: -3.4,
  guardhouse: 3.6,
  generator: 5.4,
  conservatory: 5.6,
  servant: 5.4,
  mansionGround: 5.8,
  upperBureau: 11.6,
  belfryRoof: 16.5,
} as const;

/** Shared mission & gameplay coordinates. */
export const INSERTION = { x: -55, y: 0, z: 62, yaw: 0 } as const;
export const CAPACITOR_POS = [-50, -8, -22] as const;
export const SECURITY_HUB_POS = [18, 0, -34] as const;
export const VANE_DESK_POS = [0, 6, -46] as const;
export const RED_GOGGLES_BOARD_POS = [-19.5, 6, -42] as const;
export const EXEC_LIFT_UPPER_POS = [-16, 6, -54] as const;
export const EXEC_LIFT_BUNKER_POS = [-16, -8, -54] as const;
export const ARMORY_BENCH_POS = [-14, -8, -16] as const;
export const BUNKER_DOOR_POS = [0, -8, -38] as const;
export const BUNKER_DESK_POS = [0, -8, -52] as const;

/** Critical sniper sightlines from East Bell Tower Perch. */
export const SIGHTLINES = {
  perchEye: [48, 13.1, -22] as readonly [number, number, number],
  vaneWindow: [0, 7.6, -29] as readonly [number, number, number],
  eastLoggia: [24, 7.6, -40] as readonly [number, number, number],
  vaneDesk: [0, 7.6, -46] as readonly [number, number, number],
} as const;

export const PLAYER_SPAWNS: readonly { x: number; y: number; z: number; yaw: number }[] = [
  INSERTION,
  { x: 0, y: 0, z: 54, yaw: 0 },
];

export const GROUND_SPAWNS: readonly (readonly [number, number, number, string])[] = [
  [0, 0, 52, 'ring-approach'],
  [-36, 0, 32, 'ring-west-garden'],
  [44, 0, 32, 'ring-east-terrace'],
  [-16, 0, 14, 'ring-courtyard'],
  [16, 0, 14, 'ring-courtyard'],
  [0, 0, -28, 'mansion-foyer'],
  [-18, 0, -40, 'mansion-library'],
  [18, 0, -46, 'mansion-archive'],
  [-44, 0, -34, 'mansion-servant'],
  [48, 0, -4, 'conservatory-hall'],
  [0, 6, -36, 'mansion-bureau'],
  [-8, -8, -30, 'bunker-antechamber'],
];

export const AIR_SPAWNS: readonly (readonly [number, number, number])[] = [
  [-60, 28, 56],
  [60, 28, 56],
  [-64, 30, -56],
  [64, 30, -56],
];

export const PICKUP_SPOTS: readonly (readonly [number, number, number])[] = [
  [-50, 0, 40],
  [-46, 0, 4],
  [46, 0, 22],
  [48, 11.5, -20],
  [-18, 0, -32],
  [16, 0, -48],
  [-14, -8, -14],
  [-46, -8, -22],
];

export const CHANCERY_ROADS: readonly { id: string; points: readonly (readonly [number, number])[]; width: number }[] = [
  { id: 'approach', points: [[0, 68], [0, 36]], width: 7 },
  { id: 'courtyard_west', points: [[-15, 36], [-15, -18]], width: 5 },
  { id: 'courtyard_east', points: [[15, 36], [15, -18]], width: 5 },
];

// -------------------------------------------------------------------------------------------------
// 44 Shootable Dynamic Light Fixtures grouped into 4 Wing Circuits
// -------------------------------------------------------------------------------------------------

const WARM_GOLD = 0xffcf88;
const WARM_LAMP = 0xffd79a;
const COOL_FLOOD = 0xdcecff;
const FLUOR_TECH = 0xbfe2ff;
const AMBER_IND = 0xffa852;
const DESK_GREEN = 0xffe0a0;
const BUNKER_COLD = 0xc5d8eb;

export const CHANCERY_LIGHTS: readonly LightFixtureSpec[] = [
  // ---- west_wing circuit (11 fixtures): West Garden, Guardhouse A, Generator House, Servant Wing, West Library ----
  { id: 'light.w.garden_sw', position: [-60, 0, 38], color: WARM_LAMP, intensity: 28, radius: 14, kind: 'lamp', group: 'west_wing' },
  { id: 'light.w.garden_mid', position: [-44, 0, 32], color: WARM_LAMP, intensity: 28, radius: 14, kind: 'lamp', group: 'west_wing' },
  { id: 'light.w.garden_ne', position: [-30, 0, 22], color: WARM_LAMP, intensity: 26, radius: 13, kind: 'lamp', group: 'west_wing' },
  { id: 'light.w.guard_a', position: [-27, 2.7, 43.3], color: FLUOR_TECH, intensity: 22, radius: 10, kind: 'sconce', group: 'west_wing', yaw: 0 },
  { id: 'light.w.gen_sw', position: [-58, 4.3, 13.3], color: AMBER_IND, intensity: 30, radius: 15, kind: 'sconce', group: 'west_wing', yaw: 0 },
  { id: 'light.w.gen_mid', position: [-32.7, 4.3, 2], color: AMBER_IND, intensity: 30, radius: 15, kind: 'sconce', group: 'west_wing', yaw: -Math.PI / 2 },
  { id: 'light.w.gen_north', position: [-42, 4.3, -17.3], color: AMBER_IND, intensity: 28, radius: 14, kind: 'sconce', group: 'west_wing', yaw: Math.PI },
  { id: 'light.w.servant_s', position: [-51.3, 3.8, -34], color: WARM_GOLD, intensity: 24, radius: 12, kind: 'sconce', group: 'west_wing', yaw: Math.PI / 2 },
  { id: 'light.w.servant_n', position: [-33, 3.8, -57.3], color: WARM_GOLD, intensity: 24, radius: 12, kind: 'sconce', group: 'west_wing', yaw: Math.PI },
  { id: 'light.w.library_ch', position: [-18, 4.7, -34], color: WARM_GOLD, intensity: 32, radius: 14, kind: 'chandelier', group: 'west_wing' },
  { id: 'light.w.library_desk', position: [-18, 0.85, -48], color: DESK_GREEN, intensity: 18, radius: 9, kind: 'desk', group: 'west_wing' },

  // ---- courtyard circuit (11 fixtures): Main Gatehouse, Grand Courtyard Floods & Colonnades, Grand Foyer ----
  { id: 'light.c.gate_w', position: [-5.3, 3.4, 44.5], color: WARM_LAMP, intensity: 28, radius: 14, kind: 'sconce', group: 'courtyard', yaw: Math.PI / 2 },
  { id: 'light.c.gate_e', position: [5.3, 3.4, 44.5], color: WARM_LAMP, intensity: 28, radius: 14, kind: 'sconce', group: 'courtyard', yaw: -Math.PI / 2 },
  { id: 'light.c.flood_sw', position: [-16, 4.8, 22], color: COOL_FLOOD, intensity: 46, radius: 22, kind: 'floodlight', group: 'courtyard', yaw: Math.PI * 0.25 },
  { id: 'light.c.flood_se', position: [16, 4.8, 22], color: COOL_FLOOD, intensity: 46, radius: 22, kind: 'floodlight', group: 'courtyard', yaw: -Math.PI * 0.25 },
  { id: 'light.c.flood_nw', position: [-16, 4.8, -10], color: COOL_FLOOD, intensity: 46, radius: 22, kind: 'floodlight', group: 'courtyard', yaw: Math.PI * 0.75 },
  { id: 'light.c.flood_ne', position: [16, 4.8, -10], color: COOL_FLOOD, intensity: 46, radius: 22, kind: 'floodlight', group: 'courtyard', yaw: -Math.PI * 0.75 },
  { id: 'light.c.col_w', position: [-21.2, 3.4, 6], color: WARM_GOLD, intensity: 26, radius: 14, kind: 'sconce', group: 'courtyard', yaw: Math.PI / 2 },
  { id: 'light.c.col_e', position: [21.2, 3.4, 6], color: WARM_GOLD, intensity: 26, radius: 14, kind: 'sconce', group: 'courtyard', yaw: -Math.PI / 2 },
  { id: 'light.c.foyer_ch', position: [0, 4.8, -30], color: WARM_GOLD, intensity: 38, radius: 16, kind: 'chandelier', group: 'courtyard' },
  { id: 'light.c.foyer_w', position: [-11.3, 3.4, -34], color: WARM_GOLD, intensity: 22, radius: 11, kind: 'sconce', group: 'courtyard', yaw: Math.PI / 2 },
  { id: 'light.c.foyer_e', position: [11.3, 3.4, -34], color: WARM_GOLD, intensity: 22, radius: 11, kind: 'sconce', group: 'courtyard', yaw: -Math.PI / 2 },

  // ---- east_wing circuit (12 fixtures): Guardhouse B, East Terrace, Conservatory, Archive, Security Hub, Upper Bureau, Loggia ----
  { id: 'light.e.guard_b', position: [35, 2.7, 43.3], color: FLUOR_TECH, intensity: 22, radius: 10, kind: 'sconce', group: 'east_wing', yaw: 0 },
  { id: 'light.e.terrace_w', position: [42, 0, 30], color: WARM_LAMP, intensity: 28, radius: 14, kind: 'lamp', group: 'east_wing' },
  { id: 'light.e.terrace_e', position: [60, 0, 24], color: WARM_LAMP, intensity: 28, radius: 14, kind: 'lamp', group: 'east_wing' },
  { id: 'light.e.cons_s', position: [42, 0, 2], color: WARM_LAMP, intensity: 26, radius: 13, kind: 'lamp', group: 'east_wing' },
  { id: 'light.e.cons_n', position: [54, 0, -6], color: WARM_LAMP, intensity: 26, radius: 13, kind: 'lamp', group: 'east_wing' },
  { id: 'light.e.cons_wall', position: [34.7, 3.6, -12], color: FLUOR_TECH, intensity: 24, radius: 12, kind: 'sconce', group: 'east_wing', yaw: Math.PI / 2 },
  { id: 'light.e.archive', position: [23.3, 3.8, -46], color: FLUOR_TECH, intensity: 26, radius: 13, kind: 'sconce', group: 'east_wing', yaw: -Math.PI / 2 },
  { id: 'light.e.sechub_desk', position: [20.4, 0.9, -32], color: FLUOR_TECH, intensity: 20, radius: 10, kind: 'desk', group: 'east_wing' },
  { id: 'light.e.bureau_ch', position: [0, 10.5, -35], color: WARM_GOLD, intensity: 36, radius: 17, kind: 'chandelier', group: 'east_wing' },
  { id: 'light.e.bureau_desk', position: [1.4, 6.84, -46], color: DESK_GREEN, intensity: 20, radius: 10, kind: 'desk', group: 'east_wing' },
  { id: 'light.e.bureau_board', position: [-19.3, 9.0, -42], color: WARM_GOLD, intensity: 26, radius: 13, kind: 'sconce', group: 'east_wing', yaw: Math.PI / 2 },
  { id: 'light.e.loggia', position: [20.7, 9.0, -40], color: WARM_LAMP, intensity: 28, radius: 14, kind: 'sconce', group: 'east_wing', yaw: Math.PI / 2 },

  // ---- bunker circuit (10 fixtures): Generator Sub-Basement, Utility Tunnel, Vault Antechamber, Armory, Continuity Bunker ----
  { id: 'light.b.subgen_w', position: [-61.3, -4.4, -22], color: AMBER_IND, intensity: 26, radius: 13, kind: 'sconce', group: 'bunker', yaw: Math.PI / 2 },
  { id: 'light.b.subgen_e', position: [-40.7, -4.4, -20], color: AMBER_IND, intensity: 24, radius: 12, kind: 'sconce', group: 'bunker', yaw: -Math.PI / 2 },
  { id: 'light.b.tunnel_w', position: [-46, -4.4, -20.7], color: BUNKER_COLD, intensity: 22, radius: 12, kind: 'sconce', group: 'bunker', yaw: 0 },
  { id: 'light.b.tunnel_mid', position: [-38, -4.4, -45.3], color: BUNKER_COLD, intensity: 22, radius: 12, kind: 'sconce', group: 'bunker', yaw: Math.PI },
  { id: 'light.b.tunnel_e', position: [-28, -4.4, -20.7], color: BUNKER_COLD, intensity: 22, radius: 12, kind: 'sconce', group: 'bunker', yaw: 0 },
  { id: 'light.b.ante_w', position: [-12, -4.2, -37.2], color: COOL_FLOOD, intensity: 30, radius: 15, kind: 'floodlight', group: 'bunker', yaw: Math.PI },
  { id: 'light.b.ante_e', position: [10, -4.2, -37.2], color: COOL_FLOOD, intensity: 30, radius: 15, kind: 'floodlight', group: 'bunker', yaw: Math.PI },
  { id: 'light.b.armory', position: [-14, -4.4, -8.7], color: FLUOR_TECH, intensity: 24, radius: 12, kind: 'sconce', group: 'bunker', yaw: 0 },
  { id: 'light.b.bunker_w', position: [-10, -4.4, -50], color: BUNKER_COLD, intensity: 28, radius: 14, kind: 'chandelier', group: 'bunker' },
  { id: 'light.b.bunker_e', position: [10, -4.4, -50], color: BUNKER_COLD, intensity: 28, radius: 14, kind: 'chandelier', group: 'bunker' },
];

// -------------------------------------------------------------------------------------------------
// 4 Wing Breaker Panels (3 in Generator House, 1 in Generator Sub-Basement)
// -------------------------------------------------------------------------------------------------

export const CHANCERY_BREAKERS: readonly BreakerSpec[] = [
  {
    id: 'breaker.courtyard',
    label: 'COURTYARD & FOYER GRID',
    group: 'courtyard',
    position: [-32.7, 1.45, 6],
    yaw: -Math.PI / 2,
  },
  {
    id: 'breaker.west',
    label: 'WEST WING & GARDEN GRID',
    group: 'west_wing',
    position: [-40, 1.45, 13.3],
    yaw: 0,
  },
  {
    id: 'breaker.east',
    label: 'EAST WING & BUREAU GRID',
    group: 'east_wing',
    position: [-32.7, 1.45, -6],
    yaw: -Math.PI / 2,
  },
  {
    id: 'breaker.bunker',
    label: 'SUB-LEVEL VAULT GRID',
    group: 'bunker',
    position: [-40.8, -6.55, -24],
    yaw: -Math.PI / 2,
  },
];

// -------------------------------------------------------------------------------------------------
// 6 Sweeping Security Cameras linked to Breaker Circuits
// -------------------------------------------------------------------------------------------------

export const CHANCERY_CAMERAS: readonly CameraSpec[] = [
  {
    id: 'cam.gate',
    position: [-5.4, 4.1, 42.6],
    yaw: Math.PI * 0.85,
    pitch: 0.34,
    sweepAngle: 0.65,
    sweepSpeed: 0.42,
    range: 24,
    group: 'courtyard',
  },
  {
    id: 'cam.foyer',
    position: [-10.8, 4.7, -25.2],
    yaw: -Math.PI * 0.72,
    pitch: 0.36,
    sweepAngle: 0.6,
    sweepSpeed: 0.45,
    range: 18,
    group: 'courtyard',
  },
  {
    id: 'cam.conservatory',
    position: [34.8, 4.3, 8.8],
    yaw: Math.PI * 0.25,
    pitch: 0.32,
    sweepAngle: 0.65,
    sweepSpeed: 0.4,
    range: 22,
    group: 'east_wing',
  },
  {
    id: 'cam.bureau',
    position: [18.8, 10.3, -56.8],
    yaw: Math.PI * 0.78,
    pitch: 0.35,
    sweepAngle: 0.62,
    sweepSpeed: 0.44,
    range: 20,
    group: 'east_wing',
  },
  {
    id: 'cam.tunnel',
    position: [-33, -4.1, -21.2],
    yaw: Math.PI * 0.75,
    pitch: 0.3,
    sweepAngle: 0.6,
    sweepSpeed: 0.45,
    range: 18,
    group: 'bunker',
  },
  {
    id: 'cam.antechamber',
    position: [14.8, -4.1, -21.2],
    yaw: Math.PI * 0.25,
    pitch: 0.32,
    sweepAngle: 0.62,
    sweepSpeed: 0.42,
    range: 20,
    group: 'bunker',
  },
];

// -------------------------------------------------------------------------------------------------
// 5 Wall Alarm Panels + 1 Central Security Hub Override Console
// -------------------------------------------------------------------------------------------------

export const CHANCERY_ALARMS: readonly AlarmPanelSpec[] = [
  { id: 'alarm.courtyard', position: [-21.2, 1.5, 16], yaw: Math.PI / 2, group: 'courtyard' },
  { id: 'alarm.guardhouse', position: [-22.8, 1.5, 42], yaw: -Math.PI / 2, group: 'west_wing' },
  { id: 'alarm.foyer', position: [11.2, 1.5, -27], yaw: -Math.PI / 2, group: 'courtyard' },
  { id: 'alarm.bureau', position: [-19.2, 7.5, -52], yaw: Math.PI / 2, group: 'east_wing' },
  { id: 'alarm.antechamber', position: [-4.5, -6.5, -37.2], yaw: Math.PI, group: 'bunker' },
  { id: 'alarm.hub', position: SECURITY_HUB_POS, yaw: -Math.PI / 2, group: 'east_wing', isHub: true },
];
