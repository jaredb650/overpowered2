/**
 * OpenMind HQ & Grand Boulevard (`openmind`, Mission: Deprecation / Form 7742-A).
 *
 * Single source of truth for every coordinate, elevation, skyscraper footprint, zipline cable,
 * Gaff grapple anchor, parkour obstacle (sourced directly from `PARKOUR`), OpenMind HQ office
 * floor, freight elevator shaft, Sub-Level 4 Compute Vault, and Grand Boulevard destructible
 * downtown arena.
 *
 * Engine budgets honored:
 *   - LightVolume MAX_DIMS = [200, 48, 200]:
 *       lightBounds 224 x 70 x 320 @ 1.6 m cell -> [140, 44, 200] (strictly <= [200, 48, 200])
 *   - NavGraph sampling: BOTTOM_Y = -19 .. TOP_Y = 118 -> LV spans y = -6 .. +52
 */
import * as THREE from 'three';
import { PARKOUR } from '../../../campaign/parkour';

export const OPENMIND_BOUNDS = {
  x0: -112, x1: 112,
  y0: -18, y1: 82,
  z0: -156, z1: 164,
} as const;

export const OPENMIND_LIGHT_BOUNDS = {
  x0: -112, x1: 112,
  y0: -8, y1: 62,
  z0: -156, z1: 164,
} as const;

export const OPENMIND_LIGHT_CELL = 1.6;

/** Global bottom kill plane (active inside Tower 4, Compute Vault, and Boulevard). */
export const OPENMIND_KILL_Y = -18;

/** Skyline chasm kill plane (active while north of Tower 4 at z < -12 on Towers 1-3). */
export const SKYLINE_KILL_Y = 14;

/** Non-colliding visual street chasm floor far below Towers 1-3. */
export const CHASM_Y = -28;

/** Central NavGraph hub on Grand Boulevard. */
export const OPENMIND_HUB = new THREE.Vector3(0, 0, 56);

/** Every walkable flat elevation included in NavGraph.levels (strictly within -19..118). */
export const LV = {
  vault: -6,
  garage: -3.2,
  catwalk: -1,
  street: 0,
  plazaCatwalk: 5.5,
  tower2Ledge: 31,
  mezz: 34,
  tower2: 38,
  exec: 42,
  tower3Mid: 38 + PARKOUR.stacks.chimney.rise,       // 43.2
  tower3Top: 38 + PARKOUR.stacks.chimney.rise * 2,   // 48.4
  tower1: 52,
} as const;

export const OPENMIND_LEVELS: readonly number[] = Object.values(LV);

// -------------------------------------------------------------------------------------------------
// Skyline Towers 1-3 & Tower 4 (OpenMind HQ)
// -------------------------------------------------------------------------------------------------

export type OpenmindTowerId = 'tower1' | 'tower2' | 'tower3' | 'hq';

export interface OpenmindTowerSpec {
  readonly id: OpenmindTowerId;
  readonly zone: string;
  readonly name: string;
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  readonly y: number;
  readonly accent: 'emissiveOrange' | 'emissiveCyan' | 'emissiveWhite';
  readonly rgb: readonly [number, number, number];
}

export const TOWERS: readonly OpenmindTowerSpec[] = [
  { id: 'tower1', zone: 'om-tower1', name: 'EAST SPIRE', x0: -102, x1: -66, z0: -154, z1: -124, y: LV.tower1, accent: 'emissiveOrange', rgb: [215, 224, 234] },
  { id: 'tower2', zone: 'om-tower2', name: 'MERIDIAN RELAY DECK', x0: -10, x1: 24, z0: -124, z1: -96, y: LV.tower2, accent: 'emissiveCyan', rgb: [198, 214, 228] },
  { id: 'tower3', zone: 'om-tower3', name: 'LIGHTWELL TOWER', x0: -12, x1: 22, z0: -58, z1: -26, y: LV.tower2, accent: 'emissiveOrange', rgb: [204, 218, 232] },
  { id: 'hq', zone: 'om-exec', name: 'OPENMIND HQ', x0: -26, x1: 26, z0: -12, z1: 18, y: LV.exec, accent: 'emissiveCyan', rgb: [184, 214, 238] },
];

export const TOWER_BY_ID: Record<OpenmindTowerId, OpenmindTowerSpec> = Object.fromEntries(
  TOWERS.map(t => [t.id, t]),
) as Record<OpenmindTowerId, OpenmindTowerSpec>;

// -------------------------------------------------------------------------------------------------
// Ziplines, Gaff Grapple Anchors & Parkour Obstacles
// -------------------------------------------------------------------------------------------------

export interface ZiplineSpec {
  readonly id: string;
  readonly start: readonly [number, number, number];
  readonly end: readonly [number, number, number];
  /** Optional fraction along the cable where the far pylon detonates and detaches the rider. */
  readonly snapAt?: number;
  readonly label: string;
}

export const ZIPLINES: readonly ZiplineSpec[] = [
  {
    id: 'canyon_zipline',
    start: [-68, LV.tower1 + 1.5, -136],
    end: [-8, LV.tower2 + 1.5, -112],
    snapAt: 0.65,
    label: 'CANYON MAINTENANCE ZIPLINE',
  },
  {
    id: 'hq_launch_zipline',
    start: [0, LV.tower3Top + 1.5, -26],
    end: [0, LV.exec + 2.2, -11.5],
    label: 'HQ GLASS BREACH LINE',
  },
];

export interface GrappleAnchorSpec {
  readonly id: string;
  readonly pos: readonly [number, number, number];
  /** Solid structural beam bounds `[x0, y0, z0, x1, y1, z1]` that receives the Gaff harpoon collider. */
  readonly beam: readonly [number, number, number, number, number, number];
  readonly section: 'skyline_drop' | 'glass_run' | 'boss_stage3';
  readonly label: string;
}

export const GRAPPLE_ANCHORS: readonly GrappleAnchorSpec[] = [
  {
    id: 'tower2_rescue_crane',
    pos: [-11, 46.0, -113],
    beam: [-16, 45.4, -113.6, -6, 46.6, -112.4],
    section: 'skyline_drop',
    label: 'TOWER 2 RESCUE CRANE',
  },
  {
    id: 'canyon_crane_1',
    pos: [4, 46.0, -84],
    beam: [-16, 45.4, -84.6, 12, 46.6, -83.4],
    section: 'glass_run',
    label: 'CHASM CRANE BOOM 1',
  },
  {
    id: 'canyon_crane_2',
    pos: [8, 48.0, -69],
    beam: [2, 47.4, -69.6, 30, 48.6, -68.4],
    section: 'glass_run',
    label: 'CHASM CRANE BOOM 2',
  },
  {
    id: 'spire_anchor_nw',
    pos: [-14, 9.2, 134],
    beam: [-15.2, 8.8, 133.4, -12.8, 9.6, 134.6],
    section: 'boss_stage3',
    label: 'SPIRE PILLAR NW',
  },
  {
    id: 'spire_anchor_ne',
    pos: [14, 9.2, 134],
    beam: [12.8, 8.8, 133.4, 15.2, 9.6, 134.6],
    section: 'boss_stage3',
    label: 'SPIRE PILLAR NE',
  },
  {
    id: 'spire_anchor_sw',
    pos: [-14, 9.2, 154],
    beam: [-15.2, 8.8, 153.4, -12.8, 9.6, 154.6],
    section: 'boss_stage3',
    label: 'SPIRE PILLAR SW',
  },
  {
    id: 'spire_anchor_se',
    pos: [14, 9.2, 154],
    beam: [12.8, 8.8, 153.4, 15.2, 9.6, 154.6],
    section: 'boss_stage3',
    label: 'SPIRE PILLAR SE',
  },
];

export const PARKOUR_GEOM = {
  /** Tower 1 HVAC vault units (height 1.05 m, depth 1.4 m — strictly inside 0.5..1.35 m vault spec). */
  hvacVaults: [
    { x: -87, y: LV.tower1, z: -143, depth: 1.4, width: 3.8, height: 1.05 },
    { x: -80, y: LV.tower1, z: -140, depth: 1.4, width: 3.8, height: 1.05 },
    { x: -73.5, y: LV.tower1, z: -137.5, depth: 1.4, width: 3.8, height: 1.05 },
  ] as const,
  /** Tower 2 -> Tower 3 canyon gap & 26 m unbroken glass wall-run billboard facade. */
  canyon: {
    mainGap: 38,
    tower2SouthZ: -96,
    tower3NorthZ: -58,
    /** East wall-run launch lip (z = -88) to catch lip (z = -66) = exactly PARKOUR.wallRun.gap (22 m). */
    wallRunNearLipZ: -88,
    wallRunFarLipZ: -88 + PARKOUR.wallRun.gap, // -66
    wallRunPanel: {
      x0: 13.5,
      x1: 14.1,
      z0: -90,
      z1: -64, // 26 m unbroken length (2 m past each lip)
      y0: LV.tower2 - 1.5,
      y1: LV.tower2 + 7.5,
    },
    /** Low glass canopy giving exact PARKOUR.wallRun.headroom if desired, open sky above cranes. */
    corridorWidth: PARKOUR.wallRun.width,
  },
  /** Tower 3 closing armored roof shutter matching PARKOUR.slide exact dims. */
  shutter: {
    x: 0,
    y: LV.tower2,
    z: -35,
    width: 4.4,
    height: PARKOUR.slide.doorHeight,       // 3.6
    closeSeconds: PARKOUR.slide.closeSeconds, // 2.8
    triggerRange: PARKOUR.slide.triggerRange, // 22
    runupStartZ: -35 - PARKOUR.slide.triggerRange, // -57 (cleanly on Tower 3 deck z=-58..-26)
  },
  /** Tower 3 twin-glass lightwell chimney matching PARKOUR.stacks.chimney exact dims. */
  chimney: {
    x0: -PARKOUR.stacks.chimney.width / 2, // -0.75
    x1: PARKOUR.stacks.chimney.width / 2,  // +0.75
    width: PARKOUR.stacks.chimney.width,   // 1.5
    stageRise: PARKOUR.stacks.chimney.rise, // 5.2
    stages: 2,
    z0: -32.8,
    z1: -28.4,
    baseY: LV.tower2,
    midY: LV.tower3Mid,
    topY: LV.tower3Top,
  },
  /** Tower 3 -> Tower 4 Launch Crane jib aimed straight at HQ's 80th-floor glass curtain wall. */
  launchCrane: {
    x: 0,
    z0: -26,
    z1: -16.5,
    startY: LV.tower3Top,
    tipY: 44.5,
    width: 3.2,
  },
} as const;

// -------------------------------------------------------------------------------------------------
// Tower 4: OpenMind HQ (Executive Floor, Engineering Mezzanine, Freight Elevator Shaft)
// -------------------------------------------------------------------------------------------------

export const OFFICE = {
  x0: -26,
  x1: 26,
  z0: -12,
  z1: 18,
  execY: LV.exec,       // 42
  execCeil: 48,
  mezzY: LV.mezz,       // 34
  mezzCeil: 41.4,
  crownTopY: 64,
  /** 14 m x 6 m floor-to-ceiling breakable `pane` glass curtain wall facing the launch crane. */
  curtainWall: {
    x0: -7,
    x1: 7,
    y0: LV.exec,
    y1: LV.exec + 6,
    z: -12,
    width: 14,
    height: 6,
    panesX: 7,
    panesY: 2,
  },
  /** 6 m x 6 m breakable floor skylight opening from Executive Floor (42) down to Mezzanine (34). */
  skylight: {
    x0: -3,
    x1: 3,
    z0: -1,
    z1: 5,
    y: LV.exec,
  },
  /** West grand glass staircase linking Mezzanine (34) and Executive Floor (42). */
  grandStair: {
    x: -21,
    z0: -4,
    z1: 12,
    width: 3.4,
    y0: LV.mezz,
    y1: LV.exec,
  },
  /** Rear service corridor leading east to the Freight Elevator Lobby on Mezzanine. */
  serviceLobby: {
    x0: 4,
    x1: 14,
    z0: 8,
    z1: 14,
    y: LV.mezz,
  },
} as const;

export const ELEVATOR_SHAFT = {
  x0: 14,
  x1: 20,
  z0: 8,
  z1: 14,
  cx: 17,
  cz: 11,
  width: 6,
  depth: 6,
  topY: LV.mezz,     // 34
  jamY: 18,
  bottomY: LV.vault, // -6
  grateY: -1.4,
  clampOffsets: [
    [-2.55, -2.55],
    [2.55, -2.55],
    [-2.55, 2.55],
    [2.55, 2.55],
  ] as readonly (readonly [number, number])[],
} as const;

// -------------------------------------------------------------------------------------------------
// Sub-Level 4 Compute Vault (Datacenter)
// -------------------------------------------------------------------------------------------------

export const DATACENTER = {
  x0: -34,
  x1: 34,
  z0: -24,
  z1: 18,
  floorY: LV.vault,     // -6
  catwalkY: LV.catwalk, // -1
  ceilY: 4.5,
  /** 3 Compute Clusters lined with chain-exploding `rack` breakables + glass partitions. */
  clusters: [
    { id: 'cluster.north', name: 'NORTH COMPUTE CLUSTER', x0: -10, x1: 10, z0: -21, z1: -12, center: [0, LV.vault, -16.5] as const },
    { id: 'cluster.west', name: 'WEST COMPUTE CLUSTER', x0: -30, x1: -18, z0: -12, z1: 6, center: [-24, LV.vault, -3] as const },
    { id: 'cluster.east', name: 'EAST COMPUTE CLUSTER', x0: 18, x1: 30, z0: -12, z1: 4, center: [24, LV.vault, -4] as const },
  ] as const,
  /** Central Air-Gap Containment Core + 4 destructible containment pylons. */
  airGapCore: {
    center: [0, LV.vault, -3] as const,
    radius: 5.5,
    pylons: [
      { id: 'vault.pylon.0', pos: [-4.2, LV.vault, -7.2] as const },
      { id: 'vault.pylon.1', pos: [4.2, LV.vault, -7.2] as const },
      { id: 'vault.pylon.2', pos: [-4.2, LV.vault, 1.2] as const },
      { id: 'vault.pylon.3', pos: [4.2, LV.vault, 1.2] as const },
    ] as const,
  },
  /** Hidden containment bay for AEGIS-0 (Project Safeguard). */
  aegisBay: {
    x0: -32,
    x1: -18,
    z0: 8,
    z1: 17,
    center: [-25, LV.vault, 12.5] as const,
  },
  /** Structural concrete breakout ramp rising from y = -6 up to y = 0 at z = +18. */
  breakoutRamp: {
    x0: -4,
    x1: 4,
    z0: 2,
    z1: 18,
    y0: LV.vault,
    y1: LV.street,
    width: 8,
    bulkheadTag: 'vault.breakoutBulkhead',
    bulkheadZ: 18,
  },
} as const;

// -------------------------------------------------------------------------------------------------
// Downtown Grand Boulevard, Intersection & Civic Spire Plaza
// -------------------------------------------------------------------------------------------------

export const BOULEVARD = {
  x0: -64,
  x1: 64,
  z0: 18,
  z1: 162,
  roadHalfW: 16,
  sidewalkOuterX: 25,
  /** Sunken Plaza Garage housing Ram's prototype Distraint Frame. */
  plazaGarage: {
    x0: 20,
    x1: 38,
    z0: 36,
    z1: 52,
    floorY: LV.garage, // -3.2
    framePos: [28, LV.garage, 44] as const,
    ramp: { x: 24, z0: 52, z1: 62, y0: LV.garage, y1: LV.street, width: 7.2 },
    hatchTag: 'plaza.fountainHatch',
  },
  /** Destructible storefronts & colonnades flanking Grand Boulevard (z = +26..+84). */
  storefronts: [
    { tag: 'blvd.west1', label: 'WEST GALLERIA STOREFRONT', x: -31, z: 32, w: 12, d: 14, h: 10.5, tier: 1 as const },
    { tag: 'blvd.west2', label: 'WEST COLONNADE ATRIUM', x: -31, z: 52, w: 12, d: 16, h: 12.0, tier: 2 as const },
    { tag: 'blvd.west3', label: 'WEST RETAIL TERRACE', x: -31, z: 72, w: 12, d: 14, h: 10.0, tier: 1 as const },
    { tag: 'blvd.east1', label: 'EAST PLAZA PAVILION', x: 31, z: 27, w: 12, d: 10, h: 9.0, tier: 1 as const },
    { tag: 'blvd.east2', label: 'EAST COMMERCE COLONNADE', x: 31, z: 72, w: 12, d: 14, h: 11.5, tier: 2 as const },
  ] as const,
  /** Destructible Pedestrian Skybridge spanning Grand Boulevard at z = +86. */
  skybridge: {
    tag: 'blvd.skybridge',
    label: 'PEDESTRIAN SKYBRIDGE',
    z: 86,
    x0: -22,
    x1: 22,
    clearanceY: 8.5,
    deckY: 9.0,
    topY: 12.6,
    depth: 4.8,
  },
  /** Civic 4-Way Intersection (z = +92..+126) with 4 destructible corner buildings for Stage 2 stagger. */
  intersection: {
    z0: 92,
    z1: 126,
    crossZ0: 100,
    crossZ1: 118,
    center: [0, LV.street, 109] as const,
    corners: [
      { tag: 'corner.nw', label: 'NW CIVIC CORNER TOWER', x: -27, z: 93, w: 14, d: 12, h: 12.5, colFaceX: -20, colFaceZ: 99 },
      { tag: 'corner.ne', label: 'NE CIVIC CORNER TOWER', x: 27, z: 93, w: 14, d: 12, h: 12.5, colFaceX: 20, colFaceZ: 99 },
      { tag: 'corner.sw', label: 'SW CIVIC CORNER TOWER', x: -27, z: 125, w: 14, d: 12, h: 12.5, colFaceX: -20, colFaceZ: 119 },
      { tag: 'corner.se', label: 'SE CIVIC CORNER TOWER', x: 27, z: 125, w: 14, d: 12, h: 12.5, colFaceX: 20, colFaceZ: 119 },
    ] as const,
  },
  /** Civic Spire Plaza (z = +126..+162): Municipal Power Spire, 3 Grid Substations & Stage 3B wall-run pillars. */
  spirePlaza: {
    z0: 126,
    z1: 162,
    x0: -48,
    x1: 48,
    spireCenter: [0, LV.street, 144] as const,
    spireHeight: 28,
    spireRadius: 4.0,
    substations: [
      { tag: 'substation.0', label: 'WEST GRID SUBSTATION', pos: [-28, LV.street, 144] as const, yaw: Math.PI / 2 },
      { tag: 'substation.1', label: 'EAST GRID SUBSTATION', pos: [28, LV.street, 144] as const, yaw: -Math.PI / 2 },
      { tag: 'substation.2', label: 'SOUTH GRID SUBSTATION', pos: [0, LV.street, 158] as const, yaw: 0 },
    ] as const,
    wallRunPillars: [
      { id: 'spire_wr_nw', x: -14, z: 134, yaw: Math.PI / 4, length: 9.0, y0: 1.2, y1: 8.6 },
      { id: 'spire_wr_ne', x: 14, z: 134, yaw: -Math.PI / 4, length: 9.0, y0: 1.2, y1: 8.6 },
      { id: 'spire_wr_sw', x: -14, z: 154, yaw: -Math.PI / 4, length: 9.0, y0: 1.2, y1: 8.6 },
      { id: 'spire_wr_se', x: 14, z: 154, yaw: Math.PI / 4, length: 9.0, y0: 1.2, y1: 8.6 },
    ] as const,
    catwalkY: LV.plazaCatwalk,
  },
  /** Glowing green SUBWAY stairwell entrances on both sidewalks for fleeing civilians. */
  subwayEntrances: [
    { id: 'subway_w1', x: -21, z: 42, yaw: Math.PI / 2 },
    { id: 'subway_e1', x: 21, z: 78, yaw: -Math.PI / 2 },
    { id: 'subway_w2', x: -22, z: 103, yaw: Math.PI / 2 },
    { id: 'subway_e2', x: 22, z: 115, yaw: -Math.PI / 2 },
  ] as const,
} as const;

// -------------------------------------------------------------------------------------------------
// Spawns, Pickups, Roads & Camera Views
// -------------------------------------------------------------------------------------------------

export const PLAYER_SPAWNS: readonly { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }[] = [
  { x: -94, y: LV.tower1, z: -146, yaw: -Math.PI * 0.62 },
  { x: -96, y: LV.tower1, z: -142, yaw: -Math.PI * 0.62 },
  { x: -92, y: LV.tower1, z: -144, yaw: -Math.PI * 0.62 },
  { x: -96, y: LV.tower1, z: -138, yaw: -Math.PI * 0.62 },
];

export const GROUND_SPAWNS: readonly (readonly [number, number, number, string])[] = [
  [-74, LV.tower1, -132, 'om-tower1'],
  [6, LV.tower2, -110, 'om-tower2'],
  [14, LV.tower2, -104, 'om-tower2'],
  [0, LV.tower2, -46, 'om-tower3'],
  [12, LV.tower2, -40, 'om-tower3'],
  [0, LV.exec, 10, 'om-exec'],
  [-16, LV.exec, 4, 'om-exec'],
  [16, LV.exec, 4, 'om-exec'],
  [0, LV.mezz, -6, 'om-mezz'],
  [10, LV.mezz, 11, 'om-mezz'],
  [0, LV.vault, -17, 'om-vault'],
  [-24.8, LV.vault, -4, 'om-vault'],
  [24.8, LV.vault, -4, 'om-vault'],
  [0, LV.street, 36, 'om-boulevard'],
  [0, LV.street, 74, 'om-boulevard'],
  [0, LV.street, 109, 'om-intersection'],
  [-24, LV.street, 109, 'om-intersection'],
  [24, LV.street, 109, 'om-intersection'],
  [0, LV.street, 136, 'om-spire'],
];

export const AIR_SPAWNS: readonly (readonly [number, number, number])[] = [
  [-44, 62, -120],
  [36, 58, -80],
  [-38, 56, -40],
  [44, 48, 52],
  [-44, 48, 108],
  [0, 52, 148],
];

export const PICKUP_SPOTS: readonly (readonly [number, number, number])[] = [
  [-84, LV.tower1, -134],
  [8, LV.tower2, -110],
  [-6, LV.tower2, -42],
  [0, LV.exec, 8],
  [-14, LV.mezz, 6],
  [10, LV.mezz, 11],
  [0, LV.vault, 6],
  [-16, LV.catwalk, -11],
  [28, LV.garage, 44],
  [-12, LV.street, 54],
  [12, LV.street, 98],
  [-18, LV.plazaCatwalk, 144],
  [18, LV.plazaCatwalk, 144],
];

export const OPENMIND_ROADS = [
  { id: 'grand_boulevard', width: 22, points: [[0, 22], [0, 126]] as const },
  { id: 'civic_cross_ave', width: 16, points: [[-56, 109], [56, 109]] as const },
] as const;

export const VIEWS: Readonly<Record<string, { readonly pos: readonly [number, number, number]; readonly look: readonly [number, number, number] }>> = {
  overview: { pos: [78, 86, 110], look: [0, 18, -10] },
  skyline: { pos: [-96, LV.tower1 + 4, -148], look: [-8, LV.tower2 + 2, -112] },
  canyon: { pos: [-14, LV.tower2 + 12, -104], look: [6, LV.tower2 + 4, -64] },
  chimney: { pos: [0, LV.tower2 + 2, -37], look: [0, LV.tower3Top, -30] },
  hqLaunch: { pos: [8, LV.tower3Top + 3, -24], look: [0, LV.exec + 2, -10] },
  execFloor: { pos: [-12, LV.exec + 2, -6], look: [8, LV.exec + 1.5, 10] },
  mezzanine: { pos: [-14, LV.mezz + 2, 0], look: [14, LV.mezz + 1.5, 11] },
  datacenter: { pos: [12, LV.vault + 3, 12], look: [0, LV.vault + 1.5, -14] },
  boulevard: { pos: [0, LV.street + 6, 26], look: [0, 6, 110] },
  plazaGarage: { pos: [16, LV.street + 4, 58], look: [28, LV.garage + 2, 44] },
  intersection: { pos: [-20, LV.street + 8, 92], look: [10, 4, 116] },
  spirePlaza: { pos: [0, LV.street + 10, 122], look: [0, 8, 150] },
};
