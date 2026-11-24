/**
 * Pure coordinate & spatial plan for Valken Airbase (`map: 'airbase'`, Crossfire Part 1).
 * Zero Three.js imports so tests, mission directors, vehicle spawners, and AI squad routers
 * share a single source of truth without pulling renderer state.
 *
 * Layout (South z = +145 -> North z = -145, open-air dawn raid + B-1B Lancer runway takeoff):
 *   1. South Perimeter & Radar Gate (z = +110..+150): insertion road, perimeter fence + blast gate,
 *      concrete guardhouse, sandbag bunkers, jersey barriers, and 18 m radar dish mast.
 *   2. Fuel Apron & Hangar Row (z = +20..+105, west x = -110..-10): wide concrete taxiway,
 *      2 open maintenance hangars with fuel tankers & explosive barrels, static parked fighters,
 *      concrete jet blast deflectors, and y = 3.6 flanking steel catwalks.
 *   3. 3-Level Air Traffic Control Tower (x = -56, z = -12): walkable levels y = 0 -> 3.6 -> 7.2 -> 10.8
 *      leading to the panoramic glass Flight-Ops Control Room (Hangar Override & IFF Spoof Console)
 *      with clear sightlines across the Main Runway and Alert Hangar.
 *   4. Hardened Alert Hangar (x = +12, z = -76): 40 m wide x 44 m long x 15 m tall reinforced arched
 *      shelter sized generously for the 28.2 m x 26.8 m B-1B Lancer, with 36 m wide blast door slots
 *      opening straight north & south onto the taxiway and runway.
 *   5. Main Concrete Runway (x = +62, z = -150..+150, 300 m x 32 m): threshold stripes, centerline dashes,
 *      amber/cyan runway edge lights, blast deflectors, and 2 alert revetment pads for buddy F-22 Raptors.
 */

export const AIRBASE_ATMOSPHERE = 'dawn' as const;

/** Vast flyable airspace bounds so the B-1B Lancer can roar off the runway and climb into the dawn sky. */
export const AIRBASE_BOUNDS = {
  x0: -640,
  y0: -10,
  z0: -640,
  x1: 640,
  y1: 300,
  z1: 640,
} as const;

/** Crisp 1 m NavGraph bounds spanning the entire combat airfield footprint (336 x 336 m). */
export const AIRBASE_NAV_BOUNDS = {
  x0: -168,
  y0: -6,
  z0: -168,
  x1: 168,
  y1: 40,
  z1: 168,
} as const;

/**
 * LightVolume bounds covering the airfield.
 * Hard cap is [200, 48, 200]:
 *   336 / 1.8 = 187 <= 200, 44 / 1.8 = 25 <= 48, 336 / 1.8 = 187 <= 200.
 */
export const AIRBASE_LIGHT_BOUNDS = {
  x0: -168,
  y0: -4,
  z0: -168,
  x1: 168,
  y1: 40,
  z1: 168,
} as const;

export const AIRBASE_LIGHT_CELL = 1.8;

/** Walkable floor levels: ground apron (0), hangar catwalks & ATC L1 (3.6), ATC L2 (7.2), ATC Ops Cab (10.8). */
export const AIRBASE_LEVELS: readonly number[] = [0, 3.6, 7.2, 10.8];

/** NavGraph hub on the clear South Insertion Road approaching the Perimeter Gate. */
export const AIRBASE_HUB_PT: readonly [number, number, number] = [0, 0, 128];

/** Player spawns on the South Insertion Road facing North (-Z, camera yaw = 0) toward the Perimeter Gate. */
export const AIRBASE_PLAYER_SPAWN: readonly [number, number, number] = [0, 0, 142];
export const AIRBASE_PLAYER_YAW = 0;

/** Friendly raid squadmate insertion spawns flanking the player on the South Insertion Road. */
export const AIRBASE_ALLY_SPAWNS: readonly {
  readonly id: string;
  readonly callsign: string;
  readonly at: readonly [number, number, number];
  readonly yaw: number;
}[] = [
  { id: 'ally_1', callsign: 'VIPER-2', at: [-5.5, 0, 144], yaw: 0 },
  { id: 'ally_2', callsign: 'VIPER-3', at: [5.5, 0, 144], yaw: 0 },
  { id: 'ally_3', callsign: 'VIPER-4', at: [-9.0, 0, 139], yaw: 0 },
];

/** Key landmark spatial descriptors. */
export const AIRBASE_SOUTH_GATE = {
  z: 118,
  roadHalfW: 11,
  guardhouse: { x: 20, z: 118, halfX: 5.5, halfZ: 4.5, h: 4.2 },
  radarMast: { x: -34, z: 124, height: 18 },
} as const;

export const AIRBASE_MAINT_HANGARS = [
  { id: 'maint_hangar_south', label: 'MAINTENANCE HANGAR 01', x: -78, z: 82, halfX: 16, halfZ: 12, height: 9.6 },
  { id: 'maint_hangar_north', label: 'MAINTENANCE HANGAR 02', x: -78, z: 42, halfX: 16, halfZ: 12, height: 9.6 },
] as const;

/** 3-Level Air Traffic Control Tower centered at (-56, 0, -12) with walkable stairs 0 -> 3.6 -> 7.2 -> 10.8. */
export const AIRBASE_ATC_TOWER = {
  x: -56,
  z: -12,
  coreHalfX: 6.5,
  coreHalfZ: 6.5,
  levels: [0, 3.6, 7.2, 10.8] as const,
  cabFloorY: 10.8,
  cabCeilY: 14.8,
  roofY: 15.2,
  mastTopY: 22.8,
} as const;

/** Hangar Override & IFF Spoof Console inside the top-level ATC Flight-Ops Control Room. */
export const AIRBASE_ATC_CONSOLE = {
  id: 'airbase_atc_override',
  label: 'HANGAR OVERRIDE & IFF SPOOF CONSOLE',
  at: [-50.5, 10.8, -12.0] as readonly [number, number, number],
  interactRadius: 3.6,
  lookTarget: [12, 6, -76] as readonly [number, number, number],
} as const;

/**
 * Hardened Alert Hangar at (+12, 0, -76), sized generously for the 28.2 m x 26.8 m B-1B Lancer:
 *   - Interior clear width:  40 m (x in [-8, +32])
 *   - Interior clear length: 44 m (z in [-98, -54])
 *   - Interior clear height: 15.0 m at center vault (>= 14.2 m across full 36 m doorway)
 *   - Blast door slots:      36 m wide (x in [-6, +30]) at both south (z = -54) and north (z = -98)
 */
export const AIRBASE_ALERT_HANGAR = {
  x: 12,
  z: -76,
  interiorWidth: 40,
  interiorLength: 44,
  interiorHeight: 15.0,
  x0: -8,
  x1: 32,
  z0: -98,
  z1: -54,
  blastDoorSlot: {
    x0: -6,
    x1: 30,
    y0: 0,
    y1: 14.2,
    width: 36,
    height: 14.2,
    southZ: -54,
    northZ: -98,
  },
} as const;

/** Main 300 m x 32 m Concrete Runway along x = +62 (z = -150..+150). */
export const AIRBASE_RUNWAY = {
  centerX: 62,
  width: 32,
  x0: 46,
  x1: 78,
  z0: -150,
  z1: 150,
  length: 300,
  /** Vehicle heading aligned North (-Z) down the runway toward the climb-out gate. */
  headingYaw: Math.PI,
  southThreshold: [62, 0, 136] as readonly [number, number, number],
  northThreshold: [62, 0, -136] as readonly [number, number, number],
} as const;

/** Stolen B-1B Lancer spawn centered cleanly inside the Alert Hangar, aligned North (-Z) to taxi & take off. */
export const AIRBASE_LANCER_SPAWN = {
  id: 'valken_lancer',
  vehicleId: 'lancer',
  at: [12, 0, -76] as readonly [number, number, number],
  yaw: Math.PI,
} as const;

/** Two stolen F-22 Raptors staged on alert revetment pads beside the hangar & runway, ready to launch with you. */
export const AIRBASE_BUDDY_RAPTOR_SPAWNS: readonly {
  readonly id: string;
  readonly callsign: string;
  readonly vehicleId: 'raptor';
  readonly at: readonly [number, number, number];
  readonly yaw: number;
}[] = [
  { id: 'buddy_raptor_west', callsign: 'VIPER-2', vehicleId: 'raptor', at: [-26, 0, -78], yaw: Math.PI },
  { id: 'buddy_raptor_east', callsign: 'VIPER-3', vehicleId: 'raptor', at: [96, 0, -78], yaw: Math.PI },
];

/** Takeoff climb gate triggering transition from Part 1 (Valken Airbase) to Part 2 (Open-Sea Strait). */
export const AIRBASE_TAKEOFF_GATE = {
  northZ: -260,
  minAltitudeY: 48,
  /** Ideal departure corridor guidance marker north of the runway. */
  beaconAt: [42, 64, -270] as readonly [number, number, number],
} as const;

export interface AirbaseEnemySpawn {
  readonly at: readonly [number, number, number];
  readonly section: 'southGate' | 'fuelApron' | 'atcTower' | 'alertHangar' | 'runway';
  readonly role: 'rifle' | 'heavy' | 'sniper' | 'officer' | 'rocket';
  readonly yaw: number;
}

/** Authored enemy garrison spawns per raid section (all verified on NavGraph levels 0, 3.6, 7.2, 10.8). */
export const AIRBASE_ENEMY_SPAWNS: readonly AirbaseEnemySpawn[] = [
  // Section 1: South Perimeter & Radar Gate
  { at: [-14, 0, 114], section: 'southGate', role: 'rifle', yaw: 0 },
  { at: [10, 0, 114], section: 'southGate', role: 'rifle', yaw: 0 },
  { at: [0, 0, 108], section: 'southGate', role: 'heavy', yaw: 0 },
  { at: [-24, 0, 118], section: 'southGate', role: 'rifle', yaw: 0.2 },
  { at: [20, 0, 108], section: 'southGate', role: 'officer', yaw: -0.2 },

  // Section 2: Fuel Apron & Hangar Row (ground + y = 3.6 flanking catwalk)
  { at: [-26, 0, 88], section: 'fuelApron', role: 'rifle', yaw: 0 },
  { at: [-48, 0, 82], section: 'fuelApron', role: 'heavy', yaw: 0.4 },
  { at: [-72, 0, 82], section: 'fuelApron', role: 'rifle', yaw: 1.57 },
  { at: [-58, 3.6, 80], section: 'fuelApron', role: 'sniper', yaw: 1.2 },
  { at: [-24, 0, 56], section: 'fuelApron', role: 'rifle', yaw: 0 },
  { at: [-58, 3.6, 44], section: 'fuelApron', role: 'rifle', yaw: 1.4 },
  { at: [-72, 0, 42], section: 'fuelApron', role: 'heavy', yaw: 1.57 },
  { at: [-32, 0, 28], section: 'fuelApron', role: 'rocket', yaw: 0.3 },

  // Section 3: 3-Level Air Traffic Control Tower (all 4 levels!)
  { at: [-44, 0, -8], section: 'atcTower', role: 'rifle', yaw: 0.4 },
  { at: [-56, 0, -12], section: 'atcTower', role: 'heavy', yaw: 0 },
  { at: [-54, 3.6, -12], section: 'atcTower', role: 'rifle', yaw: 0.5 },
  { at: [-56, 7.2, -12], section: 'atcTower', role: 'sniper', yaw: 0.8 },
  { at: [-56, 10.8, -12], section: 'atcTower', role: 'officer', yaw: 1.2 },

  // Section 4: Hardened Alert Hangar & Runway Perimeter
  { at: [-4, 0, -44], section: 'alertHangar', role: 'heavy', yaw: 0 },
  { at: [24, 0, -44], section: 'alertHangar', role: 'rifle', yaw: 0 },
  { at: [12, 0, -64], section: 'alertHangar', role: 'rifle', yaw: 0 },
  { at: [26, 0, -88], section: 'alertHangar', role: 'rocket', yaw: -0.4 },
  { at: [-14, 0, -76], section: 'alertHangar', role: 'rifle', yaw: 0.8 },
  { at: [44, 0, -34], section: 'runway', role: 'heavy', yaw: -0.6 },
  { at: [44, 0, -96], section: 'runway', role: 'rocket', yaw: -0.8 },
];

export interface AirbaseVehicleRoute {
  readonly id: string;
  readonly kind: 'tank' | 'qrf' | 'patrol';
  readonly spawn: readonly [number, number];
  readonly waypoints: readonly (readonly [number, number])[];
}

/** Unobstructed concrete taxiway & perimeter road routes for enemy QRF trucks and armored tanks. */
export const AIRBASE_VEHICLE_ROUTES: readonly AirbaseVehicleRoute[] = [
  {
    id: 'qrf_east_taxiway',
    kind: 'qrf',
    spawn: [62, -138],
    waypoints: [[62, -76], [62, -18], [26, -18], [0, 32], [0, 92]],
  },
  {
    id: 'tank_runway_north',
    kind: 'tank',
    spawn: [62, -142],
    waypoints: [[62, -96], [62, -40], [36, -24], [36, 48], [36, 98]],
  },
  {
    id: 'qrf_west_apron',
    kind: 'qrf',
    spawn: [-38, -134],
    waypoints: [[-38, -40], [-30, -8], [-22, 36], [-22, 92], [0, 102]],
  },
  {
    id: 'patrol_runway_south',
    kind: 'patrol',
    spawn: [62, 138],
    waypoints: [[62, 84], [62, 18], [62, -52], [62, -124]],
  },
];

/** Destructible Tier-0 bunker & fuel farm cluster placements exported for mission & test checks. */
export interface AirbaseDestructibleSpec {
  readonly id: string;
  readonly label: string;
  readonly kind: 'bunker' | 'fuelDepot' | 'radarShed';
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

export const AIRBASE_DESTRUCTIBLES: readonly AirbaseDestructibleSpec[] = [
  { id: 'airbase.south.bunker', label: 'SOUTH GATE SANDBAG BUNKER', kind: 'bunker', x: -18, z: 108, yaw: 0 },
  { id: 'airbase.fuel.south', label: 'SOUTH JP-8 FUEL DEPOT', kind: 'fuelDepot', x: -34, z: 88, yaw: 0 },
  { id: 'airbase.fuel.north', label: 'NORTH JP-8 FUEL DEPOT', kind: 'fuelDepot', x: -34, z: 36, yaw: 0 },
  { id: 'airbase.hangar.bunker', label: 'ALERT APRON MUNITIONS BUNKER', kind: 'bunker', x: -14, z: -38, yaw: 0.35 },
  { id: 'airbase.east.radar', label: 'RUNWAY APPROACH RADAR SHED', kind: 'radarShed', x: 106, z: 22, yaw: -Math.PI / 2 },
];

/** Named map zones (tightest first for zoneAt lookup). */
export const AIRBASE_ZONES = [
  { id: 'airbase-atc', name: 'ATC FLIGHT-OPS TOWER', x0: -68, y0: -1, z0: -24, x1: -44, y1: 26, z1: 2 },
  { id: 'airbase-alert-hangar', name: 'HARDENED ALERT HANGAR', x0: -12, y0: -1, z0: -102, x1: 36, y1: 22, z1: -50 },
  { id: 'airbase-south-gate', name: 'SOUTH PERIMETER & RADAR GATE', x0: -48, y0: -1, z0: 104, x1: 42, y1: 28, z1: 154 },
  { id: 'airbase-fuel-apron', name: 'FUEL APRON & HANGAR ROW', x0: -112, y0: -1, z0: 16, x1: 22, y1: 28, z1: 104 },
  { id: 'airbase-runway', name: 'MAIN CONCRETE RUNWAY 01/19', x0: 42, y0: -1, z0: -162, x1: 84, y1: 48, z1: 162 },
  { id: 'airbase-airfield', name: 'VALKEN AIRBASE', x0: -168, y0: -6, z0: -168, x1: 168, y1: 60, z1: 168 },
  { id: 'airbase-airspace', name: 'VALKEN AIRSPACE', x0: -640, y0: -10, z0: -640, x1: 640, y1: 300, z1: 640 },
] as const;

/** Ground ammo & medkit pickup spots along the raid route. */
export const AIRBASE_PICKUPS: readonly (readonly [number, number, number])[] = [
  [0, 0, 134],
  [14, 0, 110],
  [-46, 0, 92],
  [-58, 3.6, 62],
  [-46, 0, 34],
  [-48, 0, -6],
  [-54, 10.8, -10],
  [-6, 0, -34],
  [26, 0, -48],
  [40, 0, -76],
];

/** High-altitude perimeter sky spawns for enemy QRF gunships / CAP jets. */
export const AIRBASE_SKY_SPAWNS: readonly (readonly [number, number, number])[] = [
  [0, 90, -480],
  [380, 96, -320],
  [-380, 96, -320],
  [460, 104, 120],
  [-460, 104, 120],
  [0, 110, 460],
];
