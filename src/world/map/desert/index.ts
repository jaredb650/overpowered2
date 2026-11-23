/**
 * Surplus — Desert Raid 2.0 (Mission 5, `map: 'desert'`) map orchestrator.
 *
 * Composes 7 modular architectural stages:
 *   1. `dunes.ts`    — 10-band desert floor with surgical Sewer & Salt Cave cutouts, sculpted dawn
 *                      dunes, sandstone mesas, convoy tracks, and 4 Tier-0 Approach lookout posts.
 *   2. `wall.ts`     — 32 sturdy corrugated metal wall panels (fractureGrid 2x2), waist-high firing
 *                      embrasures, widened y=3.6 battlements, 6 wood-legged watchtowers, 3 isolated drums.
 *   3. `warren.ts`   — 20 Tier-0 destructible wood/metal shacks (h = 3.6 / 7.2), 4 rooftop catwalks,
 *                      3 solid cistern/rock landmarks, and the Optional Minigun Nest at [-14, 3.6, 22].
 *   4. `pumpyard.ts` — 4 colossal water cisterns, overhead pipes, tower foundation pad at [0,0,-40],
 *                      North Dividing Wall arch, and Extended 50 m 3-Chamber Dark Storm Sewer (y = -5.5).
 *   5. `terraces.ts` — NEW Section 5: The High Terraces ("The Perches", y = 0 / 3.6 / 7.2) vertical
 *                      village with 6 timber-stilt guard towers, 6 stilted tents, 4 overhead catwalks,
 *                      switchback ramps, and flat Eastern Convoy Bypass Road.
 *   6. `cave.ts`     — NEW Section 6: The Salt Cave ("The Cistern Tunnels", y = -2.5) carved sandstone
 *                      cavern with crystalline salt boulders, 4 destructible timber mine-shoring gantries,
 *                      and hanging amber miner lamps.
 *   7. `plane.ts`    — 100% solid relocated Crashed Cargo Plane (z = -212..-275, floor y = 1.5, open
 *                      rear ramp, 3 interior compartments, ±28 m wings, 18.5 m tail) framed by sandstone
 *                      canyon cliffs with a wide eastern exfil breach onto the bypass road.
 */
import * as THREE from 'three';
import type { SpawnPoint } from '../../../core/contracts';
import type { Kit } from '../../kit/kit';
import type { MapSpec } from '../spec';
import { authorDesertCave } from './cave';
import { authorDesertDunes } from './dunes';
import {
  CARGO_PLANE,
  CONVOY_PATHS,
  DESERT_BOUNDS,
  DESERT_HUB_PT,
  DESERT_LEVELS,
  DESERT_LIGHT_BOUNDS,
  DESERT_LIGHT_CELL,
  DESERT_Z,
  HIGH_TERRACES,
  PUMP_YARD,
  SALT_CAVE,
  WARREN_MINIGUN,
} from './plan';
import { authorDesertPlane } from './plane';
import { authorDesertPumpYard } from './pumpyard';
import { authorDesertTerraces } from './terraces';
import { authorDesertWall } from './wall';
import { authorDesertWarren } from './warren';

export { DESERT_BOUNDS, DESERT_LEVELS, DESERT_LIGHT_BOUNDS, DESERT_LIGHT_CELL };
export * from './plan';

export const DESERT_HUB = new THREE.Vector3(DESERT_HUB_PT[0], DESERT_HUB_PT[1], DESERT_HUB_PT[2]);

/** Tracks specs whose geometry stages have already run so calling `authorDesert` directly or after `DESERT_STAGES` never duplicates geometry. */
const STAGES_BUILT = new WeakSet<MapSpec>();

function start(spec: MapSpec): void {
  spec.reactor = null;
  spec.killY = DESERT_BOUNDS.y0; // -12

  const fill = (
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    rgb: readonly [number, number, number],
    label = '',
  ) => ({ x0, z0, x1, z1, rgb, label });

  spec.plan = {
    fills: [
      fill(DESERT_BOUNDS.x0, DESERT_Z.wallLine, DESERT_BOUNDS.x1, DESERT_BOUNDS.z1, [0.44, 0.35, 0.22], 'APPROACH DUNES'),
      fill(-76, 55, 76, 66, [0.46, 0.27, 0.16], 'THE WALL'),
      fill(-64, -14, 64, 55, [0.34, 0.27, 0.20], 'THE WARREN'),
      fill(-52, -56, 52, -14, [0.24, 0.26, 0.28], 'PUMP YARD'),
      fill(-7, -83, 7, -26, [0.14, 0.17, 0.22], 'STORM SEWER'),
      fill(-40, -148, 40, -80, [0.42, 0.29, 0.20], 'HIGH TERRACES'),
      fill(42, -206, 60, -56, [0.36, 0.30, 0.22], 'BYPASS ROAD'),
      fill(-13, -203, 13, -148, [0.22, 0.20, 0.24], 'SALT CAVE'),
      fill(-44, -278, 44, -203, [0.28, 0.31, 0.27], 'THE PLANE'),
    ],
    walls: [],
    blocks: [],
    decks: [],
    gates: [],
    doors: [],
  };

  spec.roads = [
    {
      id: 'approach',
      points: CONVOY_PATHS.approach.map(([x, , z]) => [x, z] as const),
      width: 14,
    },
    {
      id: 'wallLoop',
      points: CONVOY_PATHS.wallLoop.map(([x, , z]) => [x, z] as const),
      width: 14,
    },
    {
      id: 'exfil',
      points: CONVOY_PATHS.exfil.map(([x, , z]) => [x, z] as const),
      width: 11,
    },
  ];
}

export const DESERT_STAGES = [
  {
    label: 'Sculpting the dawn dunes & Surplus floor',
    run: (k: Kit, spec: MapSpec) => {
      start(spec);
      authorDesertDunes(k, spec);
      STAGES_BUILT.add(spec);
    },
  },
  {
    label: 'Raising the Scrap Wall & watchtowers',
    run: authorDesertWall,
  },
  {
    label: 'Building the Warren shantytown',
    run: authorDesertWarren,
  },
  {
    label: 'Excavating the Pump Yard & Dark Sewer',
    run: authorDesertPumpYard,
  },
  {
    label: 'Raising the High Terraces vertical village',
    run: authorDesertTerraces,
  },
  {
    label: 'Carving the Salt Cave cistern tunnels',
    run: authorDesertCave,
  },
  {
    label: 'Grounding the Crashed Cargo Plane',
    run: authorDesertPlane,
  },
] as const;

/** Smallest / most specific zones first so `zoneAt` always picks the tightest zone. */
function zones(spec: MapSpec): void {
  const sky = DESERT_BOUNDS.y1;

  spec.zone('desert-plane', 'CRASHED CARGO PLANE', -30, 0.6, -276, 30, 22, -211);
  spec.zone('desert-cave', 'THE SALT CAVE', -14, -4.0, -203, 14, 6.5, -148);
  spec.zone('desert-sewer', 'DARK STORM SEWER', -15, -7.0, -84, 14, -0.4, -25);
  spec.zone('desert-forecourt', 'PLANE FORECOURT', -48, -1.0, -216, 48, sky, -200);
  spec.zone('desert-terraces', 'THE HIGH TERRACES', -44, -1.0, -148, 44, sky, -78);
  spec.zone('desert-pumpyard', 'THE PUMP YARD', -56, -1.0, -56, 56, sky, -14);
  spec.zone('desert-warren', 'THE WARREN', -76, -1.0, -14, 76, sky, 56);
  spec.zone('desert-wall', 'THE WALL', -82, -1.0, 56, 82, sky, 74);
  spec.zone('desert-approach', 'DAWN APPROACH DUNES', DESERT_BOUNDS.x0, -2.0, 74, DESERT_BOUNDS.x1, sky, DESERT_BOUNDS.z1);
  spec.zone(
    'desert-surplus',
    'SURPLUS BADLANDS',
    DESERT_BOUNDS.x0,
    DESERT_BOUNDS.y0,
    DESERT_BOUNDS.z0,
    DESERT_BOUNDS.x1,
    sky,
    DESERT_BOUNDS.z1,
  );
}

const GROUND_SPAWNS: readonly (readonly [number, number, number, string])[] = [
  // Dawn Approach Dunes
  [0, 0, 208, 'desert-approach'],
  [-16, 0, 166, 'desert-approach'],
  [18, 0, 144, 'desert-approach'],
  [-18, 0, 118, 'desert-approach'],
  [16, 0, 96, 'desert-approach'],
  // The Wall widened battlements (y = 3.6) & gate floor
  [-36, 3.6, DESERT_Z.wallWalkway, 'desert-wall'],
  [-18, 3.6, DESERT_Z.wallWalkway, 'desert-wall'],
  [18, 3.6, DESERT_Z.wallWalkway, 'desert-wall'],
  [36, 3.6, DESERT_Z.wallWalkway, 'desert-wall'],
  [0, 0, 54, 'desert-wall'],
  // The Warren streets & alleys
  [0, 0, 44, 'desert-warren'],
  [-24, 0, 34, 'desert-warren'],
  [24, 0, 34, 'desert-warren'],
  [2, 0, 20, 'desert-warren'],
  [-24, 0, 8, 'desert-warren'],
  [26, 0, 12, 'desert-warren'],
  [8, 0, -4, 'desert-warren'],
  [-18, 0, -8, 'desert-warren'],
  // The Pump Yard
  [-8, 0, -22, 'desert-pumpyard'],
  [10, 0, -22, 'desert-pumpyard'],
  [-14, 0, -28, 'desert-pumpyard'],
  [10, 0, -46, 'desert-pumpyard'],
  [-10, 0, -52, 'desert-pumpyard'],
  // Extended Multi-Chamber Dark Storm Sewer (y = -5.5)
  [0, PUMP_YARD.sewerFloorY, -34, 'desert-sewer'],
  [-5, PUMP_YARD.sewerFloorY, -49, 'desert-sewer'],
  [5, PUMP_YARD.sewerFloorY, -53, 'desert-sewer'],
  [0, PUMP_YARD.sewerFloorY, -70, 'desert-sewer'],
  // Section 5: The High Terraces (Tier 1 y=0, Tier 2 y=3.6, Tier 3 y=7.2)
  [-18, 0, -86, 'desert-terraces'],
  [18, 0, -86, 'desert-terraces'],
  [0, HIGH_TERRACES.tier2Y, -110, 'desert-terraces'],
  [-16, HIGH_TERRACES.tier2Y, -110, 'desert-terraces'],
  [16, HIGH_TERRACES.tier2Y, -110, 'desert-terraces'],
  [0, HIGH_TERRACES.tier2Y, -122, 'desert-terraces'],
  [-30, HIGH_TERRACES.tier3Y, -141, 'desert-terraces'],
  [30, HIGH_TERRACES.tier3Y, -141, 'desert-terraces'],
  [0, 0, -144, 'desert-terraces'],
  // Section 6: The Salt Cave (y = -2.5)
  [0, SALT_CAVE.floorY, -162, 'desert-cave'],
  [0, SALT_CAVE.floorY, -176, 'desert-cave'],
  [0, SALT_CAVE.floorY, -190, 'desert-cave'],
  // Section 7: Plane Forecourt & Solid Cargo Plane Interior (y = 1.5)
  [0, 0, -206, 'desert-forecourt'],
  [-16, 0, -206, 'desert-forecourt'],
  [16, 0, -204, 'desert-forecourt'],
  [0, CARGO_PLANE.floorY, -224, 'desert-plane'],
  [0, CARGO_PLANE.floorY, -240, 'desert-plane'],
  [0, CARGO_PLANE.floorY, -256, 'desert-plane'],
];

const AIR_SPAWNS: readonly (readonly [number, number, number])[] = [
  [-90, 52, 160],
  [90, 52, 140],
  [-84, 48, 62],
  [84, 48, 62],
  [-72, 54, 10],
  [72, 54, 10],
  [-68, 56, -54],
  [68, 56, -54],
  [-64, 58, -120],
  [64, 58, -120],
  [0, 62, -230],
];

const PICKUP_SPOTS: readonly (readonly [number, number, number])[] = [
  // Warren ammo & medkits (central avenue, minigun nest, side alleys)
  [4, 0, 38],
  [WARREN_MINIGUN.pos[0] + 1.4, WARREN_MINIGUN.pos[1], WARREN_MINIGUN.pos[2] + 1.2],
  [-24, 0, 20],
  [26, 0, 22],
  [8, 0, 4],
  // Pump Yard (near sewer drop)
  [-16, 0, -28],
  [12, 0, -34],
  // Extended Dark Storm Sewer (ammo/medkit resupply inside Central Gallery & north exit)
  [-5, PUMP_YARD.sewerFloorY, -52],
  [0, PUMP_YARD.sewerFloorY, -70],
  // High Terraces (Tier 1 & Tier 2 resupply)
  [-14, 0, -84],
  [0, HIGH_TERRACES.tier2Y, -114],
  // Salt Cave (mid-cavern ammo & medkit resupply)
  [-3, SALT_CAVE.floorY, -176],
  // Plane Forecourt (final ammo & medkits before Quist chase)
  [-15, 0, -204],
  [15, 0, -204],
];

function spawns(spec: MapSpec): void {
  const groundSpawns: SpawnPoint[] = GROUND_SPAWNS.map(([x, y, z, zone]) => ({
    position: new THREE.Vector3(x, y + 0.1, z),
    zone,
    kind: 'ground',
  }));
  const airSpawns: SpawnPoint[] = AIR_SPAWNS.map(([x, y, z]) => ({
    position: new THREE.Vector3(x, y, z),
    zone: 'desert-surplus',
    kind: 'air',
  }));
  spec.spawns = [...groundSpawns, ...airSpawns];

  for (const [x, y, z, zone] of GROUND_SPAWNS) spec.gate(zone, x, y + 0.1, z);
  for (const [x, y, z] of PICKUP_SPOTS) spec.pickup(x, y, z);

  spec.playerSpawns.push(
    { position: new THREE.Vector3(0, 0.1, DESERT_Z.approachStart), yaw: 0 },
    { position: new THREE.Vector3(DESERT_HUB_PT[0], DESERT_HUB_PT[1] + 0.1, DESERT_HUB_PT[2]), yaw: 0 },
    { position: new THREE.Vector3(0, 0.1, -22), yaw: 0 },
    { position: new THREE.Vector3(0, 0.1, -81), yaw: 0 },
    { position: new THREE.Vector3(0, SALT_CAVE.floorY + 0.1, -176), yaw: 0 },
    { position: new THREE.Vector3(0, 0.1, -206), yaw: 0 },
  );
}

function views(spec: MapSpec): void {
  const eye = 1.62;
  const look = (name: string, x: number, y: number, z: number, lx: number, ly: number, lz: number) =>
    spec.view(name, x, y + eye, z, lx, ly, lz);

  spec.view('overview', 120, 102, 165, 0, 4, -60);
  look('approach', 0, 2.2, 200, 0, 6, 62);
  spec.view('wall', -38, 12, 92, 0, 4, 62);
  look('warren', 0, 0, 46, 0, 2.5, 4);
  look('minigun', WARREN_MINIGUN.pos[0], WARREN_MINIGUN.pos[1], WARREN_MINIGUN.pos[2], 6, 2.5, -10);
  look('pumpyard', 0, 0, -18, 0, 4, -48);
  look('sewer', 0, PUMP_YARD.sewerFloorY, -34, 0, PUMP_YARD.sewerFloorY + 1.4, -70);
  look('terraces', 0, 0, -83, 0, 6.5, -130);
  look('cave', 0, SALT_CAVE.floorY, -158, 0, SALT_CAVE.floorY + 1.5, -192);
  look('forecourt', 0, 0, -204, 0, 5, -238);
  spec.view('plane', 38, 16, -196, 0, 5, -240);
  look('planeInterior', 0, CARGO_PLANE.floorY, -220, 0, CARGO_PLANE.floorY + 1.5, -256);
}

/**
 * Finalizes Surplus zones, spawns, pickups, and views.
 * Also safely executes all DESERT_STAGES if called directly without iterating DESERT_STAGES first.
 */
export function authorDesert(k: Kit, spec: MapSpec): void {
  if (!STAGES_BUILT.has(spec)) {
    for (const stage of DESERT_STAGES) {
      stage.run(k, spec);
    }
  }
  zones(spec);
  spawns(spec);
  views(spec);
}
