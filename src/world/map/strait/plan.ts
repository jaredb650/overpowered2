/**
 * Pure coordinate & spatial plan for The Open-Sea Strait (`map: 'strait'`, Crossfire Parts 2 & 4).
 * Zero Three.js imports so tests, mission directors, BaseDefenseSystem, and AI flight wings can
 * read every coordinate directly without pulling renderer state.
 *
 * Layout (1,640 m x 1,640 m Open-Ocean Bomber Escort Corridor):
 *   - Ocean plane visually extending to +-2,600 m with sunlit wake streaks & dusk/dawn shimmer.
 *   - South End (z = +540): Friendly Carrier Strike Group (CVN-91 + escort frigate & screen) —
 *     visual recovery umbrella for Part 4 Dusk Return.
 *   - Mid-Strait (z = -180..+180): 8 towering jagged volcanic sea stacks (94–142 m tall) for
 *     high-speed F-22 weaving, plus 2 detailed PBR Southern Missile Destroyers (`destroyer_west`
 *     at [-140, 0, -60] and `destroyer_east` at [+150, 0, -160]) with exported SAM/CIWS mounts.
 *   - North Horizon (z = -680..-820): Fortified enemy coastline cliffs, radar towers, and rising
 *     dark smoke pillars marking Fortress Halcyon ahead.
 *   - High-Altitude Cloud Layer (y = 175..230 m): atmospheric cloud deck & puffs for Mach dogfighting.
 */

export const STRAIT_ATMOSPHERE = 'dawn' as const;

export const STRAIT_CARRIER_DECK_Y = 10;

/** Massive 1,640 m x 1,640 m playable ocean airspace (ceiling y = 340 m). */
export const STRAIT_BOUNDS = {
  x0: -820,
  y0: -14,
  z0: -820,
  x1: 820,
  y1: 340,
  z1: 820,
} as const;

/** Tiny fast 1 m NavGraph bake bounds so loading stays instantaneous on the huge sea arena. */
export const STRAIT_NAV_BOUNDS = {
  x0: -48,
  y0: -4,
  z0: -96,
  x1: 48,
  y1: 48,
  z1: 96,
} as const;

/**
 * Compact LightVolume bounds (hard cap [200, 48, 200]):
 *   200 / 1.6 = 125 <= 200, 54 / 1.6 = 34 <= 48, 240 / 1.6 = 150 <= 200.
 */
export const STRAIT_LIGHT_BOUNDS = {
  x0: -100,
  y0: -6,
  z0: -120,
  x1: 100,
  y1: 48,
  z1: 120,
} as const;

export const STRAIT_LIGHT_CELL = 1.6;

export const STRAIT_HUB_PT: readonly [number, number, number] = [0, 10, 0];

export const STRAIT_LEVELS: readonly number[] = [0, 10];

/** South End Friendly Carrier Strike Group (z = +540) — Part 4 recovery umbrella. */
export const STRAIT_CARRIER_CENTER: readonly [number, number, number] = [0, STRAIT_CARRIER_DECK_Y, 540];

export const STRAIT_CARRIER_DECK_RECT = {
  x0: -23.5,
  x1: 17.5,
  z0: 468,
  z1: 612,
} as const;

export interface StraitShipPose {
  readonly id: string;
  readonly name: string;
  readonly role: 'carrier' | 'frigate' | 'destroyer';
  readonly faction: 'friendly' | 'hostile';
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/** Friendly escort warships screening the south aircraft carrier. */
export const STRAIT_FRIENDLY_ESCORTS: readonly StraitShipPose[] = [
  { id: 'ffg_42', name: 'USS HARBINGER (FFG-42)', role: 'frigate', faction: 'friendly', x: -150, z: 578, yaw: 0.04 },
  { id: 'ddg_93', name: 'USS RESOLUTE (DDG-93)', role: 'frigate', faction: 'friendly', x: 162, z: 596, yaw: -0.05 },
];

/** Two hostile Southern Missile Destroyers guarding the Mid-Strait gauntlet. */
export const STRAIT_DESTROYERS: readonly StraitShipPose[] = [
  { id: 'destroyer_west', name: 'SNS IRONCLAD', role: 'destroyer', faction: 'hostile', x: -140, z: -60, yaw: 0.16 },
  { id: 'destroyer_east', name: 'SNS BASTION', role: 'destroyer', faction: 'hostile', x: 150, z: -160, yaw: -0.20 },
];

export interface StraitDefenseMount {
  readonly id: string;
  readonly shipId: string;
  readonly role: 'ciws' | 'sam';
  readonly at: readonly [number, number, number];
  readonly defaultYaw: number;
}

/** Local-to-world helper matching Kit.push(x, 0, z, yaw). */
function shipWorld(
  ship: StraitShipPose,
  lx: number,
  ly: number,
  lz: number,
): readonly [number, number, number] {
  const c = Math.cos(ship.yaw);
  const s = Math.sin(ship.yaw);
  return [
    Math.round((ship.x + lx * c + lz * s) * 100) / 100,
    ly,
    Math.round((ship.z - lx * s + lz * c) * 100) / 100,
  ];
}

/** Local mount offsets on every hostile Southern Missile Destroyer (aligned with built sponson pads). */
export const DESTROYER_LOCAL_MOUNTS = [
  { suffix: 'sam_fwd', role: 'sam' as const, local: [0, 7.5, -24.0] as const, yawOffset: Math.PI },
  { suffix: 'sam_aft', role: 'sam' as const, local: [0, 11.4, 12.0] as const, yawOffset: 0 },
  { suffix: 'ciws_port', role: 'ciws' as const, local: [-6.8, 7.1, -5.0] as const, yawOffset: -Math.PI / 2 },
  { suffix: 'ciws_stbd', role: 'ciws' as const, local: [6.8, 7.1, -5.0] as const, yawOffset: Math.PI / 2 },
] as const;

/** World-space SAM & CIWS weapon mount coordinates for both Southern Missile Destroyers (consumed by BaseDefenseSystem). */
export const STRAIT_DESTROYER_MOUNTS: readonly StraitDefenseMount[] = STRAIT_DESTROYERS.flatMap(ship =>
  DESTROYER_LOCAL_MOUNTS.map(m => ({
    id: `${ship.id}_${m.suffix}`,
    shipId: ship.id,
    role: m.role,
    at: shipWorld(ship, m.local[0], m.local[1], m.local[2]),
    defaultYaw: ship.yaw + m.yawOffset,
  })),
);

export const STRAIT_DESTROYER_SAM_MOUNTS: readonly StraitDefenseMount[] = STRAIT_DESTROYER_MOUNTS.filter(m => m.role === 'sam');
export const STRAIT_DESTROYER_CIWS_MOUNTS: readonly StraitDefenseMount[] = STRAIT_DESTROYER_MOUNTS.filter(m => m.role === 'ciws');

export interface StraitSeaStack {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly height: number;
  readonly yaw: number;
}

/** 8 dramatic jagged volcanic sea stacks (94–142 m tall) flanking the Mid-Strait flight corridor. */
export const STRAIT_SEA_STACKS: readonly StraitSeaStack[] = [
  { id: 'stack_nw_spire',   x: -360, z: -145, radius: 38, height: 128, yaw: 0.42 },
  { id: 'stack_ne_needle',  x:  355, z: -110, radius: 34, height: 142, yaw: 1.18 },
  { id: 'stack_sw_crag',    x: -295, z:   95, radius: 32, height: 108, yaw: 2.15 },
  { id: 'stack_se_fang',    x:  315, z:  138, radius: 36, height: 118, yaw: 0.78 },
  { id: 'stack_far_west',   x: -510, z:   15, radius: 44, height: 96,  yaw: 1.65 },
  { id: 'stack_far_east',   x:  495, z:  -30, radius: 40, height: 132, yaw: 2.60 },
  { id: 'stack_north_gate', x: -225, z: -275, radius: 28, height: 94,  yaw: 0.95 },
  { id: 'stack_south_gate', x:  240, z:  285, radius: 30, height: 102, yaw: 1.92 },
];

/** Distant North Horizon fortified enemy coastal radar installations marking Fortress Halcyon (z = -715..-735). */
export const STRAIT_COASTAL_RADARS: readonly { readonly id: string; readonly x: number; readonly z: number; readonly baseY: number; readonly height: number }[] = [
  { id: 'halcyon_radar_west',   x: -340, z: -725, baseY: 54, height: 42 },
  { id: 'halcyon_radar_center', x:   15, z: -735, baseY: 68, height: 48 },
  { id: 'halcyon_radar_east',   x:  365, z: -720, baseY: 50, height: 40 },
];

/** Rising dark industrial & flak smoke pillars along the North Fortress Halcyon shoreline. */
export const STRAIT_SMOKE_PILLARS: readonly { readonly x: number; readonly z: number; readonly baseY: number; readonly height: number; readonly radius: number }[] = [
  { x: -460, z: -748, baseY: 32, height: 158, radius: 22 },
  { x: -185, z: -742, baseY: 42, height: 185, radius: 26 },
  { x:   75, z: -756, baseY: 48, height: 205, radius: 30 },
  { x:  290, z: -746, baseY: 36, height: 172, radius: 24 },
  { x:  520, z: -760, baseY: 28, height: 150, radius: 22 },
];

/** High-altitude cloud deck bands & puffs (y = 178..228 m, visual only — no colliders). */
export const STRAIT_CLOUD_BANKS: readonly {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rx: number;
  readonly ry: number;
  readonly rz: number;
  readonly yaw: number;
}[] = [
  { x: -420, y: 186, z:  380, rx: 115, ry: 10, rz: 64, yaw: 0.20 },
  { x:  380, y: 194, z:  340, rx: 125, ry: 11, rz: 68, yaw: -0.18 },
  { x:  -60, y: 212, z:  240, rx: 130, ry: 9,  rz: 58, yaw: 0.08 },
  { x: -560, y: 202, z:   60, rx: 140, ry: 12, rz: 74, yaw: 0.32 },
  { x:  540, y: 188, z:   40, rx: 135, ry: 10, rz: 70, yaw: -0.25 },
  { x: -240, y: 224, z:  -60, rx: 110, ry: 9,  rz: 54, yaw: 0.14 },
  { x:  220, y: 182, z: -120, rx: 120, ry: 10, rz: 62, yaw: -0.12 },
  { x: -460, y: 216, z: -320, rx: 145, ry: 12, rz: 76, yaw: 0.28 },
  { x:   40, y: 196, z: -360, rx: 150, ry: 11, rz: 68, yaw: -0.06 },
  { x:  480, y: 208, z: -380, rx: 135, ry: 11, rz: 70, yaw: -0.30 },
  { x: -280, y: 184, z: -560, rx: 130, ry: 10, rz: 64, yaw: 0.15 },
  { x:  310, y: 220, z: -540, rx: 140, ry: 11, rz: 66, yaw: -0.22 },
];

export interface StraitFlightPose {
  readonly id: string;
  readonly at: readonly [number, number, number];
  readonly yaw: number;
  readonly speed: number;
}

/**
 * Part 2 Outbound B-1B Lancer Bomber Escort Waypoint Path:
 * South Carrier Strike Group -> Mid-Strait Destroyer Gauntlet -> North Coastal Feet-Dry.
 */
export const STRAIT_OUTBOUND_LANCER_PATH: readonly (readonly [number, number, number])[] = [
  [0, 92, 520],
  [-18, 96, 260],
  [12, 102, 40],
  [-10, 108, -140],
  [0, 114, -380],
  [0, 120, -615],
];

/** Z threshold marking coastal feet-dry at the north end of Part 2. */
export const STRAIT_FEET_DRY_Z = -600;

/**
 * Part 4 Inbound Dusk Return B-1B Lancer Waypoint Path:
 * North Fortress Halcyon Egress -> Mid-Strait Gauntlet -> Friendly Carrier Recovery Umbrella.
 */
export const STRAIT_INBOUND_LANCER_PATH: readonly (readonly [number, number, number])[] = [
  [0, 118, -610],
  [22, 106, -340],
  [-16, 94, -80],
  [14, 86, 200],
  [0, 78, 470],
];

/** Z threshold marking safe return inside the Friendly Carrier Strike Group umbrella in Part 4. */
export const STRAIT_CARRIER_RECOVERY_Z = 440;

/** Part 2 Player F-22 Raptor spawn pose (escorting on the Lancer's starboard wing, heading North yaw = PI). */
export const STRAIT_OUTBOUND_PLAYER_SPAWN: StraitFlightPose = {
  id: 'player_f22_outbound',
  at: [26, 92, 502],
  yaw: Math.PI,
  speed: 68,
};

/** Part 2 Friendly F-22 Wingmen poses flanking the B-1B Lancer. */
export const STRAIT_OUTBOUND_WINGMAN_SPAWNS: readonly StraitFlightPose[] = [
  { id: 'wingman_outbound_port', at: [-26, 94, 506], yaw: Math.PI, speed: 68 },
  { id: 'wingman_outbound_high', at: [0, 108, 545], yaw: Math.PI, speed: 68 },
];

/** Part 4 Player F-22 Raptor spawn pose (escorting damaged Lancer back South, heading South yaw = 0). */
export const STRAIT_INBOUND_PLAYER_SPAWN: StraitFlightPose = {
  id: 'player_f22_inbound',
  at: [-26, 114, -590],
  yaw: 0,
  speed: 68,
};

/** Part 4 Friendly F-22 Wingmen poses on the dusk return run. */
export const STRAIT_INBOUND_WINGMAN_SPAWNS: readonly StraitFlightPose[] = [
  { id: 'wingman_inbound_stbd', at: [26, 112, -594], yaw: 0, speed: 68 },
];

/** Grounded carrier deck fallback spawn (y = 10 on CVN-91 at z = +540). */
export const STRAIT_DECK_PLAYER_SPAWN: readonly [number, number, number] = [5.2, STRAIT_CARRIER_DECK_Y, 545.2];
export const STRAIT_DECK_PLAYER_YAW = 0;

export interface StraitEnemySector {
  readonly id: string;
  readonly label: string;
  readonly phase: 'outbound' | 'inbound' | 'both';
  readonly spawns: readonly (readonly [number, number, number])[];
}

/** Named hostile air-intercept wave spawn sectors across the 1,640 m strait. */
export const STRAIT_ENEMY_SECTORS: readonly StraitEnemySector[] = [
  {
    id: 'north_cap',
    label: 'NORTH COASTAL CAP',
    phase: 'outbound',
    spawns: [
      [-180, 132, -620],
      [0, 146, -640],
      [180, 132, -620],
    ],
  },
  {
    id: 'west_flank',
    label: 'WEST SEA-STACK FLANK',
    phase: 'both',
    spawns: [
      [-640, 124, -180],
      [-660, 138, 60],
      [-610, 118, 280],
    ],
  },
  {
    id: 'east_flank',
    label: 'EAST SEA-STACK FLANK',
    phase: 'both',
    spawns: [
      [640, 124, -180],
      [660, 138, 60],
      [610, 118, 280],
    ],
  },
  {
    id: 'high_cover',
    label: 'HIGH-ALTITUDE INTERCEPTORS',
    phase: 'both',
    spawns: [
      [-320, 228, -220],
      [320, 228, -220],
      [0, 242, 120],
    ],
  },
  {
    id: 'north_pursuit',
    label: 'HALCYON PURSUIT SQUADRON',
    phase: 'inbound',
    spawns: [
      [-240, 136, -660],
      [0, 152, -680],
      [240, 136, -660],
    ],
  },
];

/** Flattened air spawn points for generic MapSpec air wave validators. */
export const STRAIT_SKY_SPAWNS: readonly (readonly [number, number, number])[] = STRAIT_ENEMY_SECTORS.flatMap(
  sector => sector.spawns,
);
