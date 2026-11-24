/**
 * Valken Airbase (`map: 'airbase'`, Crossfire Part 1: On-Foot Raid + B-1B Lancer Runway Takeoff).
 *
 * Crisp cold-blue dawn airbase with warm amber runway/hangar floodlights and clear South -> North
 * progression from perimeter insertion through fuel apron, 3-level ATC Tower, Hardened Alert Hangar,
 * and 300 m Main Concrete Runway:
 *   1. South Perimeter & Radar Gate (z = +110..+150)
 *   2. Fuel Apron, Maintenance Hangar Row & y = 3.6 Flanking Catwalks (z = +20..+105, west)
 *   3. 3-Level Air Traffic Control Tower (x = -56, z = -12, walkable y = 0 -> 3.6 -> 7.2 -> 10.8)
 *   4. Hardened Alert Hangar (x = +12, z = -76, 40 m x 44 m x 15 m vaulted shelter for B-1B Lancer)
 *   5. Main Concrete Runway (x = +62, 300 m x 32 m), Alert Revetments & Dawn Valley Horizon (+-600 m)
 */
import * as THREE from 'three';
import type { SpawnPoint } from '../../../core/contracts';
import type { StructuralClusterSpec, StructuralNodeSpec } from '../../destruction';
import { FACE, type Mat } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { barrier, cable, container, fence, machine, tyres } from '../../kit/props';
import type { MapSpec } from '../spec';
import {
  AIRBASE_ALERT_HANGAR,
  AIRBASE_ATC_CONSOLE,
  AIRBASE_ATC_TOWER,
  AIRBASE_BOUNDS,
  AIRBASE_BUDDY_RAPTOR_SPAWNS,
  AIRBASE_DESTRUCTIBLES,
  AIRBASE_ENEMY_SPAWNS,
  AIRBASE_HUB_PT,
  AIRBASE_LEVELS,
  AIRBASE_LIGHT_BOUNDS,
  AIRBASE_LIGHT_CELL,
  AIRBASE_MAINT_HANGARS,
  AIRBASE_NAV_BOUNDS,
  AIRBASE_PICKUPS,
  AIRBASE_PLAYER_SPAWN,
  AIRBASE_PLAYER_YAW,
  AIRBASE_RUNWAY,
  AIRBASE_SKY_SPAWNS,
  AIRBASE_SOUTH_GATE,
  AIRBASE_VEHICLE_ROUTES,
  AIRBASE_ZONES,
} from './plan';

export {
  AIRBASE_BOUNDS,
  AIRBASE_LEVELS,
  AIRBASE_LIGHT_BOUNDS,
  AIRBASE_LIGHT_CELL,
  AIRBASE_NAV_BOUNDS,
};
export * from './plan';

export const AIRBASE_HUB = new THREE.Vector3(AIRBASE_HUB_PT[0], AIRBASE_HUB_PT[1], AIRBASE_HUB_PT[2]);

/** Prevents duplicate geometry if `authorAirbase` is called after `AIRBASE_STAGES`. */
const STAGES_BUILT = new WeakSet<MapSpec>();

const GROUND_THICK = 0.8;

/** Cold-blue dawn + warm airfield sodium floodlight palette. */
const PALETTE = {
  dawnSky: 0x9ec8ff,
  amberFlood: 0xffb866,
  warmSodium: 0xffa64d,
  opsCyan: 0x4ae6ff,
  alertRed: 0xff3b2f,
  tarmac: [0.28, 0.30, 0.34] as const,
  apronConcrete: [0.52, 0.55, 0.59] as const,
  runwayConcrete: [0.46, 0.49, 0.53] as const,
  coldEarth: [0.24, 0.27, 0.25] as const,
  ridgeDark: [0.22, 0.25, 0.30] as const,
  ridgeLit: [0.34, 0.35, 0.40] as const,
} as const;

function patch(
  k: Kit,
  mat: Mat,
  tint: readonly [number, number, number],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  step: number,
): void {
  const g = k.geo.use(mat).tint(tint[0], tint[1], tint[2]);
  if (step > 24) {
    const nu = Math.max(1, Math.ceil((x1 - x0) / step));
    const nv = Math.max(1, Math.ceil((z1 - z0) / step));
    g.grid(x0, y, z1, x1 - x0, 0, 0, 0, 0, z0 - z1, nu, nv);
  } else {
    g.gridStep(x0, y, z1, x1 - x0, 0, 0, 0, 0, z0 - z1, step);
  }
  g.tint(1);
}

/** Sculpted distant dawn mountain ridge block (visual backdrop out to +-600 m). */
function dawnRidge(k: Kit, x: number, z: number, hx: number, hz: number, h: number, yaw: number): void {
  const g = k.geo;
  k.push(x, -0.5, z, yaw);
  g.use('concrete').tint(PALETTE.ridgeDark[0], PALETTE.ridgeDark[1], PALETTE.ridgeDark[2]);
  g.quad(-hx, 0, hz, hx, 0, hz, hx * 0.62, h, hz * 0.18, -hx * 0.62, h, hz * 0.18);
  g.tint(PALETTE.ridgeLit[0], PALETTE.ridgeLit[1], PALETTE.ridgeLit[2]);
  g.quad(hx, 0, -hz, -hx, 0, -hz, -hx * 0.62, h, hz * 0.18, hx * 0.62, h, hz * 0.18);
  g.tint(PALETTE.ridgeDark[0] * 0.9, PALETTE.ridgeDark[1] * 0.92, PALETTE.ridgeDark[2] * 0.96);
  g.tri(-hx, 0, -hz, -hx, 0, hz, -hx * 0.62, h, hz * 0.18);
  g.tri(hx, 0, hz, hx, 0, -hz, hx * 0.62, h, hz * 0.18);
  g.tint(1);
  k.pop();
}

/** Static sleek parked military interceptor jet on wheel chocks (visual + compact hull collider). */
function staticParkedFighter(k: Kit, x: number, z: number, yaw: number): void {
  const g = k.geo;
  k.push(x, 0, z, yaw);
  // Landing gear struts + rubber tyres
  g.use('steelDark');
  g.cyl(0, 0.35, 3.8, 0, 1.35, 3.8, 0.08, 0.08, 6);
  g.cyl(-1.9, 0.42, -1.0, -1.9, 1.45, -1.0, 0.1, 0.1, 6);
  g.cyl(1.9, 0.42, -1.0, 1.9, 1.45, -1.0, 0.1, 0.1, 6);
  g.use('rubber');
  g.cyl(-0.18, 0.34, 3.8, 0.18, 0.34, 3.8, 0.32, 0.32, 8);
  g.cyl(-2.15, 0.44, -1.0, -1.65, 0.44, -1.0, 0.42, 0.42, 8);
  g.cyl(1.65, 0.44, -1.0, 2.15, 0.44, -1.0, 0.42, 0.42, 8);

  // Tapered stealth fuselage (nose pointing local +Z)
  g.use('panel').tint(0.42, 0.46, 0.52);
  g.bevel(0, 1.65, 0.2, 1.15, 0.62, 5.4, 0.18);
  g.bevel(0, 1.55, 6.4, 0.68, 0.42, 2.1, 0.16);
  g.use('steelDark').tint(0.28, 0.31, 0.36);
  g.cyl(0, 1.52, 8.2, 0, 1.48, 10.1, 0.46, 0.06, 8, false, true);

  // Tinted teardrop cockpit canopy
  g.use('glass').tint(0.20, 0.36, 0.46);
  g.bevel(0, 2.38, 3.6, 0.54, 0.42, 1.85, 0.22);

  // Swept delta main wings & horizontal stabilators
  g.use('panel').tint(0.46, 0.50, 0.56);
  g.bevel(-3.8, 1.52, -0.6, 3.1, 0.12, 2.1, 0.05);
  g.bevel(3.8, 1.52, -0.6, 3.1, 0.12, 2.1, 0.05);
  g.bevel(-2.1, 1.56, -4.6, 1.4, 0.09, 1.1, 0.04);
  g.bevel(2.1, 1.56, -4.6, 1.4, 0.09, 1.1, 0.04);

  // Canted twin vertical tail fins
  for (const s of [-1, 1]) {
    k.push(s * 1.15, 2.85, -4.5, 0, 0, -s * 0.28);
    g.use('panel').tint(0.40, 0.44, 0.50);
    g.bevel(0, 0, 0, 0.09, 1.35, 1.3, 0.03);
    g.use('paintRed').tint(0.75, 0.22, 0.18);
    g.box(0, 0.85, -0.1, 0.11, 0.22, 0.95);
    k.pop();
  }

  // Twin afterburner exhaust nozzles
  g.use('steelDark').tint(0.24, 0.26, 0.30);
  g.cyl(-0.55, 1.60, -5.1, -0.55, 1.60, -6.2, 0.44, 0.36, 8);
  g.cyl(0.55, 1.60, -5.1, 0.55, 1.60, -6.2, 0.44, 0.36, 8);
  g.tint(1);

  k.noClimb(() => {
    k.collide(0, 1.6, 0.6, 2.2, 1.4, 6.2, 'metal');
  });
  k.pop();
}

/** Static military JP-8 aviation fuel tanker trailer parked in maintenance hangars. */
function fuelTankerTruck(k: Kit, x: number, z: number, yaw: number): void {
  const g = k.geo;
  k.push(x, 0, z, yaw);
  // Chassis & cab
  g.use('steelDark').bevel(0, 0.88, 0, 4.9, 0.22, 1.2, 0.05);
  g.use('panel').tint(0.44, 0.48, 0.42);
  g.bevel(3.9, 1.95, 0, 1.15, 0.95, 1.18, 0.12);
  g.use('glass').tint(0.18, 0.28, 0.36);
  g.box(5.06, 2.25, 0, 0.04, 0.42, 0.96, FACE.px);
  // Cylindrical JP-8 tank body + red flammable band
  g.use('paintWhite').tint(0.78, 0.80, 0.82);
  g.cyl(-4.4, 2.1, 0, 2.3, 2.1, 0, 1.15, 1.15, 10, true, true);
  g.use('paintRed').tint(0.88, 0.22, 0.18);
  g.cyl(-1.8, 2.1, 0, -0.6, 2.1, 0, 1.18, 1.18, 10, false, false);
  // Rubber wheels
  g.tint(1).use('rubber');
  for (const ux of [3.8, -0.8, -3.4]) {
    for (const sz of [-1.15, 1.15]) {
      g.cyl(ux, 0.52, sz - 0.18, ux, 0.52, sz + 0.18, 0.52, 0.52, 8);
    }
  }
  k.collide(0, 1.65, 0, 5.1, 1.65, 1.3, 'metal');
  k.pop();
}

/** Angled reinforced concrete jet blast deflector wall. */
function jetBlastDeflector(k: Kit, x: number, z: number, yaw: number, width = 10): void {
  const g = k.geo;
  const hw = width / 2;
  k.push(x, 0, z, yaw);
  g.use('concrete').tint(0.58, 0.60, 0.64);
  // Angled face deflecting exhaust upward
  g.quad(-hw, 0, 1.3, hw, 0, 1.3, hw, 3.2, -0.6, -hw, 3.2, -0.6);
  g.quad(hw, 0, -1.2, -hw, 0, -1.2, -hw, 3.2, -0.6, hw, 3.2, -0.6);
  g.tri(-hw, 0, -1.2, -hw, 0, 1.3, -hw, 3.2, -0.6);
  g.tri(hw, 0, 1.3, hw, 0, -1.2, hw, 3.2, -0.6);
  // Rear concrete buttress ribs
  g.use('concreteDark').tint(0.45, 0.47, 0.50);
  for (const rx of [-hw * 0.68, 0, hw * 0.68]) {
    g.bevel(rx, 1.4, -0.95, 0.3, 1.4, 0.45, 0.05);
  }
  // Yellow hazard top edge strip
  g.use('hazard').tint(0.9, 0.8, 0.4);
  g.box(0, 3.24, -0.6, hw, 0.1, 0.22);
  g.tint(1);
  k.collide(0, 1.6, 0, hw, 1.6, 1.2, 'concrete');
  k.pop();
}

/** Builds a Tier-0 destructible sandbag bunker or JP-8 fuel depot cluster with explosive hazard drums. */
function buildAirbaseDestructible(
  id: string,
  label: string,
  kind: 'bunker' | 'fuelDepot' | 'radarShed',
  x: number,
  z: number,
  yaw: number,
): StructuralClusterSpec {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const pt = (lx: number, ly: number, lz: number): [number, number, number] => [
    x + lx * c + lz * s,
    ly,
    z - lx * s + lz * c,
  ];

  if (kind === 'fuelDepot') {
    const nodes: StructuralNodeSpec[] = [
      { id: 'col_fl', pos: pt(-3.2, 1.7, 2.2), half: [0.18, 1.7, 0.18], mat: 'steelDark', color: 0x3b424c, hp: 110, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'metal' },
      { id: 'col_fr', pos: pt(3.2, 1.7, 2.2), half: [0.18, 1.7, 0.18], mat: 'steelDark', color: 0x3b424c, hp: 110, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'metal' },
      { id: 'col_bl', pos: pt(-3.2, 1.7, -2.2), half: [0.18, 1.7, 0.18], mat: 'steelDark', color: 0x3b424c, hp: 110, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'metal' },
      { id: 'col_br', pos: pt(3.2, 1.7, -2.2), half: [0.18, 1.7, 0.18], mat: 'steelDark', color: 0x3b424c, hp: 110, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'metal' },
      { id: 'canopy', pos: pt(0, 3.55, 0), half: [3.7, 0.14, 2.6], mat: 'panel', color: 0x6f7b88, hp: 120, tier: 0, anchored: false, kind: 'roof', yaw, impactRadius: 7.5, materialClass: 'metal', fractureGrid: [2, 2] },
      { id: 'pump_wall', pos: pt(-3.2, 1.4, 0), half: [0.16, 1.4, 2.1], mat: 'rust', color: 0x6a5c50, hp: 120, tier: 0, anchored: true, kind: 'wall', yaw, materialClass: 'metal', fractureGrid: [2, 2] },
      { id: 'jp8_tank_a', pos: pt(-0.8, 0.95, 0), half: [0.85, 0.95, 1.4], mat: 'paintRed', color: 0xcc2c22, hp: 45, tier: 0, anchored: true, kind: 'hazard', yaw, hazardRadius: 10, hazardDamage: 260, materialClass: 'metal' },
      { id: 'jp8_tank_b', pos: pt(1.4, 0.95, 0), half: [0.85, 0.95, 1.4], mat: 'paintRed', color: 0xcc2c22, hp: 45, tier: 0, anchored: true, kind: 'hazard', yaw, hazardRadius: 10, hazardDamage: 260, materialClass: 'metal' },
    ];
    return {
      id,
      tag: id,
      kind: 'fuelDepot',
      label,
      value: 80_000,
      nodes,
      links: [
        ['col_fl', 'canopy'],
        ['col_fr', 'canopy'],
        ['col_bl', 'canopy'],
        ['col_br', 'canopy'],
        ['pump_wall', 'canopy'],
      ],
      collapseThreshold: 0.45,
    };
  }

  // Sandbag Bunker or Radar Shed (Tier 0 destructible fortification with explosive drum)
  const W = 2.6;
  const D = 2.0;
  const H = 2.9;
  const wallColor = kind === 'bunker' ? 0x8e8068 : 0x5c6876;
  const wallMat: Mat = kind === 'bunker' ? 'dirt' : 'panel';
  const nodes: StructuralNodeSpec[] = [
    { id: 'post_fl', pos: pt(-W, H / 2, D), half: [0.2, H / 2, 0.2], mat: 'steelDark', color: 0x3b424c, hp: 105, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'metal' },
    { id: 'post_fr', pos: pt(W, H / 2, D), half: [0.2, H / 2, 0.2], mat: 'steelDark', color: 0x3b424c, hp: 105, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'metal' },
    { id: 'post_bl', pos: pt(-W, H / 2, -D), half: [0.2, H / 2, 0.2], mat: 'steelDark', color: 0x3b424c, hp: 105, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'metal' },
    { id: 'post_br', pos: pt(W, H / 2, -D), half: [0.2, H / 2, 0.2], mat: 'steelDark', color: 0x3b424c, hp: 105, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'metal' },
    { id: 'front_parapet', pos: pt(0, 0.72, D), half: [W, 0.72, 0.34], mat: wallMat, color: wallColor, hp: 115, tier: 0, anchored: true, kind: 'wall', yaw, materialClass: 'stone', fractureGrid: [2, 2] },
    { id: 'left_wall', pos: pt(-W, H / 2, 0), half: [0.22, H / 2, D], mat: wallMat, color: wallColor, hp: 120, tier: 0, anchored: true, kind: 'wall', yaw, materialClass: 'stone', fractureGrid: [2, 2] },
    { id: 'right_wall', pos: pt(W, H / 2, 0), half: [0.22, H / 2, D], mat: wallMat, color: wallColor, hp: 120, tier: 0, anchored: true, kind: 'wall', yaw, materialClass: 'stone', fractureGrid: [2, 2] },
    { id: 'roof', pos: pt(0, H + 0.14, 0), half: [W + 0.45, 0.14, D + 0.45], mat: 'concreteDark', color: 0x525860, hp: 120, tier: 0, anchored: false, kind: 'roof', yaw, impactRadius: 7.0, materialClass: 'concrete', fractureGrid: [2, 2] },
    { id: 'ammo_drum', pos: pt(W + 0.85, 0.55, 0.6), half: [0.42, 0.55, 0.42], mat: 'paintRed', color: 0xc82820, hp: 35, tier: 0, anchored: true, kind: 'hazard', yaw, hazardRadius: 8.5, hazardDamage: 220, materialClass: 'metal' },
  ];

  return {
    id,
    tag: id,
    kind,
    label,
    value: 60_000,
    nodes,
    links: [
      ['post_fl', 'roof'],
      ['post_fr', 'roof'],
      ['post_bl', 'roof'],
      ['post_br', 'roof'],
      ['left_wall', 'roof'],
      ['right_wall', 'roof'],
    ],
    collapseThreshold: 0.45,
  };
}

function start(spec: MapSpec): void {
  spec.reactor = null;
  spec.killY = AIRBASE_BOUNDS.y0;

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
      fill(-168, -168, 168, 168, [0.24, 0.27, 0.28], ''),
      fill(-112, 16, 44, 114, [0.34, 0.37, 0.40], 'FUEL APRON'),
      fill(46, -150, 78, 150, [0.26, 0.28, 0.32], 'RUNWAY 01/19'),
      fill(-10, -100, 34, -52, [0.40, 0.35, 0.28], 'ALERT HANGAR'),
      fill(-66, -22, -46, -2, [0.25, 0.38, 0.46], 'ATC TOWER'),
      fill(-42, 108, 36, 152, [0.30, 0.32, 0.34], 'SOUTH GATE'),
    ],
    walls: [],
    blocks: [],
    decks: [],
    gates: [],
    doors: [],
  };

  spec.roads = AIRBASE_VEHICLE_ROUTES.map(r => ({
    id: r.id,
    points: [r.spawn, ...r.waypoints] as readonly (readonly [number, number])[],
    width: 12,
  }));
}

/** Stage 1: Airfield ground plane, concrete tarmac, 300 m Main Runway, taxiways, and dawn horizon ridges. */
function authorGroundAndRunway(k: Kit, spec: MapSpec): void {
  const g = k.geo;

  // Continuous flat ground physics collider across the entire +-660 m airspace (exact top y = 0).
  k.collide(0, -GROUND_THICK / 2, 0, 660, GROUND_THICK / 2, 660, 'concrete');

  // Outer cold-dawn valley terrain skirt extending to +-640 m (visual only).
  const FAR = 640;
  patch(k, 'dirt', PALETTE.coldEarth, -FAR, -FAR, FAR, -168, -0.04, 160);
  patch(k, 'dirt', PALETTE.coldEarth, -FAR, 168, FAR, FAR, -0.04, 160);
  patch(k, 'dirt', PALETTE.coldEarth, -FAR, -168, -168, 168, -0.04, 160);
  patch(k, 'dirt', PALETTE.coldEarth, 168, -168, FAR, 168, -0.04, 160);

  // Airfield inner perimeter base earth + wide concrete apron & taxiway pads.
  patch(k, 'dirt', [0.26, 0.29, 0.27], -168, -168, 168, 168, 0, 28);
  // South insertion asphalt road (x in [-11, +11], z in [104, 168])
  patch(k, 'asphalt', PALETTE.tarmac, -11, 104, 11, 168, 0.014, 16);
  // West Fuel Apron & Hangar Taxiway (x in [-102, 46], z in [-148, 112])
  patch(k, 'concrete', PALETTE.apronConcrete, -102, -148, 46, 112, 0.012, 24);
  // East Runway Alert Revetment Apron (x in [78, 120], z in [-106, -48])
  patch(k, 'concrete', PALETTE.apronConcrete, 78, -106, 120, -48, 0.012, 16);

  // --- Main Concrete Runway (x = +62, z = -150..+150, 300 m x 32 m) ---
  const R = AIRBASE_RUNWAY;
  patch(k, 'asphalt', PALETTE.tarmac, R.x0, R.z0, R.x1, R.z1, 0.018, 20);
  // Paved overrun / blast pads at north & south runway thresholds
  patch(k, 'concreteDark', [0.34, 0.36, 0.40], R.x0, R.z0 - 16, R.x1, R.z0, 0.015, 16);
  patch(k, 'concreteDark', [0.34, 0.36, 0.40], R.x0, R.z1, R.x1, R.z1 + 16, 0.015, 16);

  // Painted runway markings (flush at y = 0.028, no colliders!)
  const mkY = 0.028;
  g.use('paintWhite').tint(0.92, 0.94, 0.96);
  // Solid runway edge lines
  g.box(R.x0 + 1.0, mkY, 0, 0.35, 0.006, 148, FACE.py);
  g.box(R.x1 - 1.0, mkY, 0, 0.35, 0.006, 148, FACE.py);
  // Dashed centerline along x = +62
  for (let z = -124; z <= 124; z += 16) {
    g.box(R.centerX, mkY, z, 0.42, 0.006, 4.6, FACE.py);
  }
  // White threshold piano-key stripes at south (+141) and north (-141)
  for (const tz of [-141, 141]) {
    for (let i = -4; i <= 4; i++) {
      if (i === 0) continue;
      g.box(R.centerX + i * 3.1, mkY, tz, 0.72, 0.006, 6.2, FACE.py);
    }
  }
  // Aiming point touchdown blocks
  for (const tz of [-92, 92]) {
    g.box(R.centerX - 8.2, mkY, tz, 2.2, 0.006, 8.0, FACE.py);
    g.box(R.centerX + 8.2, mkY, tz, 2.2, 0.006, 8.0, FACE.py);
  }

  // Painted yellow taxiway centerlines leading from Alert Hangar (+12, -76) & apron onto Main Runway (+62)
  g.use('paintYellow').tint(0.96, 0.78, 0.18);
  // Alert Hangar through-line along x = +12 (z = -146..-18)
  g.box(12, mkY, -82, 0.30, 0.006, 64, FACE.py);
  // North connector taxiway from Alert Hangar to Runway (z = -130, x = 12..62)
  g.box(37, mkY, -130, 25, 0.006, 0.30, FACE.py);
  // Mid connector taxiway from Apron/Hangar to Runway (z = -18, x = -22..62)
  g.box(20, mkY, -18, 42, 0.006, 0.30, FACE.py);
  // South connector taxiway (z = 96, x = -22..62)
  g.box(20, mkY, 96, 42, 0.006, 0.30, FACE.py);
  // West apron taxiway spine along x = -22 (z = -18..96)
  g.box(-22, mkY, 39, 0.30, 0.006, 57, FACE.py);

  // Overrun yellow hazard bars at north & south runway blast pads
  for (const oz of [-158, 158]) {
    g.box(R.centerX, mkY, oz, 13.0, 0.006, 0.9, FACE.py);
  }

  // Glowing low-profile runway edge lights (NO colliders so wings never snag!)
  for (let z = -148; z <= 148; z += 20) {
    const isEnd = Math.abs(z) >= 140;
    const mat: Mat = isEnd ? (z < 0 ? 'emissiveRed' : 'emissiveCyan') : (Math.abs(z) > 100 ? 'emissiveOrange' : 'emissiveWhite');
    g.use(mat).tint(1, 1, 1);
    g.box(R.x0 - 0.9, 0.16, z, 0.22, 0.16, 0.34);
    g.box(R.x1 + 0.9, 0.16, z, 0.22, 0.16, 0.34);
  }
  // Glowing blue/cyan taxiway edge marker beacons along north & mid connectors
  g.use('emissiveCyan').tint(0.35, 0.85, 1.0);
  for (const x of [16, 28, 40]) {
    g.box(x, 0.14, -124, 0.18, 0.14, 0.18);
    g.box(x, 0.14, -136, 0.18, 0.14, 0.18);
    g.box(x, 0.14, -12, 0.18, 0.14, 0.18);
    g.box(x, 0.14, -24, 0.18, 0.14, 0.18);
  }
  g.tint(1);

  // --- Distant Sculpted Dawn Horizon Ridges (visual only, +-280..580 m; north departure corridor kept low & clear!) ---
  const ridges: readonly [number, number, number, number, number, number][] = [
    [-420, -340, 140, 75, 58, 0.35],
    [-460, -40, 110, 165, 64, 0.08],
    [-410, 320, 145, 90, 52, -0.32],
    [-120, 440, 165, 78, 44, 0.06],
    [180, 450, 155, 82, 48, -0.10],
    [430, 310, 140, 88, 56, 0.38],
    [460, -20, 115, 170, 68, -0.06],
    [410, -350, 145, 78, 60, -0.36],
  ];
  for (const [rx, rz, hx, hz, h, yaw] of ridges) {
    dawnRidge(k, rx, rz, hx, hz, h, yaw);
  }

  // Broad cold-blue dawn sky ambient bounce + warm horizon wash (6 baked lights)
  k.light(0, 28, 128, PALETTE.dawnSky, 75, 58);
  k.light(-48, 28, 60, PALETTE.dawnSky, 80, 60);
  k.light(12, 28, -10, PALETTE.dawnSky, 80, 62);
  k.light(62, 28, 50, PALETTE.amberFlood, 72, 58);
  k.light(62, 28, -60, PALETTE.amberFlood, 72, 58);
  k.light(62, 28, -135, PALETTE.dawnSky, 68, 52);

  void spec;
}

/** Stage 2: Section 1 — South Perimeter Security Fence, Blast Gate Portal, Guardhouse, Sandbag Bunkers & Radar Mast. */
function authorSouthPerimeter(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const gateZ = AIRBASE_SOUTH_GATE.z + 3; // z = 121 (cleanly clears z = 118 enemy spawn)

  // Chain-link perimeter security fence with open central road gate (x in [-11.5, +11.5])
  // and full unobstructed runway corridor clearance (x in [42, 82])
  fence(k, [-146, gateZ, -12, gateZ], 0, 2.8, true);
  fence(k, [26.5, gateZ, 42, gateZ], 0, 2.8, true);
  fence(k, [82, gateZ, 146, gateZ], 0, 2.8, true);
  // West & East perimeter fence runs framing the airfield
  fence(k, [-146, gateZ, -146, -146], 0, 2.8, true);
  fence(k, [146, gateZ, 146, -146], 0, 2.8, true);

  // Blast Gate Concrete Piers & Overhead Steel Security Gantry Arch (open center x in [-10.5, +10.5], headroom 6.2 m)
  for (const sx of [-11.8, 11.8]) {
    k.block('concrete', sx - 1.2, 0, gateZ - 1.4, sx + 1.2, 6.4, gateZ + 1.4, 0.1);
    g.use('hazard').tint(0.92, 0.80, 0.30);
    g.box(sx, 1.4, gateZ + 1.45, 1.15, 0.55, 0.04, FACE.pz);
    g.use('emissiveOrange').tint(1, 0.65, 0.2);
    g.box(sx, 6.65, gateZ, 0.35, 0.25, 0.35);
  }
  // Overhead security portal girder & signage bar
  k.truss(-11.8, 6.9, gateZ, 11.8, 6.9, gateZ, 1.1, 1.4, 'steelDark', 0.10);
  g.use('emissiveOrange').tint(1, 0.62, 0.18);
  g.box(0, 6.25, gateZ + 0.75, 8.4, 0.12, 0.08, FACE.pz);
  g.tint(1);
  // Raised open security boom arm (angled up at 45 deg so vehicles/infantry pass freely)
  k.push(10.4, 1.2, gateZ + 0.8, 0, 0.85, 0);
  g.use('paintRed').tint(0.9, 0.22, 0.18);
  g.box(-3.6, 0, 0, 3.6, 0.08, 0.08);
  g.tint(1);
  k.pop();
  k.light(0, 5.8, gateZ + 2, PALETTE.amberFlood, 44, 30);

  // Concrete Guardhouse at (20, 0, 118) — walkable open north doorway & tinted observation window facing road
  const gh = AIRBASE_SOUTH_GATE.guardhouse;
  const gx0 = gh.x - gh.halfX, gx1 = gh.x + gh.halfX;
  const gz0 = gh.z - gh.halfZ, gz1 = gh.z + gh.halfZ;
  k.wall(gx0, gz1, gx1, gz1, 0, gh.h, { thick: 0.6, mat: 'concrete', openings: [{ u0: 2.2, u1: 8.8, v0: 1.2, v1: 2.8, frame: true }] });
  k.wall(gx1, gz1, gx1, gz0, 0, gh.h, { thick: 0.6, mat: 'concrete' });
  k.wall(gx1, gz0, gx0, gz0, 0, gh.h, { thick: 0.6, mat: 'concrete', openings: [{ u0: 3.8, u1: 7.2, v0: 0, v1: 2.8, frame: true }] });
  k.wall(gx0, gz0, gx0, gz1, 0, gh.h, { thick: 0.6, mat: 'concrete', openings: [{ u0: 1.8, u1: 7.2, v0: 1.2, v1: 2.8, frame: true }] });
  // Roof slab + roof beacon
  k.block('concreteDark', gx0 - 0.5, gh.h, gz0 - 0.5, gx1 + 0.5, gh.h + 0.45, gz1 + 0.5, 0.06);
  g.use('emissiveRed').box(gh.x, gh.h + 0.85, gh.z, 0.25, 0.32, 0.25);
  spec.breakable('pane', gh.x, 2.0, gz1, 0, 6.4, 1.5);
  spec.breakable('pane', gx0, 2.0, gh.z, Math.PI / 2, 5.2, 1.5);
  k.light(gh.x, 3.2, gh.z, PALETTE.warmSodium, 26, 18);
  spec.plan?.blocks.push({ x0: gx0, z0: gz0, x1: gx1, z1: gz1 });

  // Jersey barriers & tactical cover flanking the insertion road (leaving central x in [-8, +8] clear!)
  barrier(k, -9.8, 0, 132, 0.22, 4.2);
  barrier(k, 9.8, 0, 132, -0.22, 4.2);
  barrier(k, -14.5, 0, 114, 0.08, 4.2);
  barrier(k, 12.2, 0, 110, -0.15, 4.2);
  tyres(k, -17, 0, 128, 3, true);
  tyres(k, 14, 0, 130, 3, true);

  // Tall 18 m Perimeter Surveillance Radar Dish Mast at (-34, 0, 124)
  const rm = AIRBASE_SOUTH_GATE.radarMast;
  k.block('concreteDark', rm.x - 2.4, 0, rm.z - 2.4, rm.x + 2.4, 1.2, rm.z + 2.4, 0.1);
  // 4-leg tapered lattice mast
  g.use('steelDark').tint(0.42, 0.46, 0.52);
  const bRad = 1.9, tRad = 0.65;
  const corners: readonly [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [cx, cz] of corners) {
    g.cyl(rm.x + cx * bRad, 1.2, rm.z + cz * bRad, rm.x + cx * tRad, rm.height, rm.z + cz * tRad, 0.16, 0.10, 6);
  }
  for (const by of [5.5, 10.0, 14.5, 17.6]) {
    const f = (by - 1.2) / (rm.height - 1.2);
    const r = bRad + (tRad - bRad) * f;
    for (let i = 0; i < 4; i++) {
      const a = corners[i]!;
      const b = corners[(i + 1) % 4]!;
      g.cyl(rm.x + a[0] * r, by, rm.z + a[1] * r, rm.x + b[0] * r, by, rm.z + b[1] * r, 0.07, 0.07, 4);
    }
  }
  // Tilted white parabolic radar dish + glowing red aviation warning beacon
  k.push(rm.x, rm.height + 1.4, rm.z, 0.4, -0.25, 0);
  g.use('paintWhite').tint(0.88, 0.90, 0.94);
  g.bevel(0, 0, 0, 2.8, 1.6, 0.25, 0.08);
  g.use('steelDark').cyl(0, 0, 0.2, 0, 0, 1.9, 0.12, 0.08, 6);
  g.use('emissiveRed').box(0, 2.1, 0, 0.28, 0.32, 0.28);
  g.tint(1);
  k.pop();
  k.noClimb(() => k.collide(rm.x, rm.height / 2, rm.z, 1.6, rm.height / 2, 1.6, 'metal'));
  k.light(rm.x, rm.height + 2.2, rm.z, PALETTE.alertRed, 22, 24);
  spec.plan?.blocks.push({ x0: rm.x - 2.4, z0: rm.z - 2.4, x1: rm.x + 2.4, z1: rm.z + 2.4 });
}

/** Stage 3: Section 2 — Fuel Apron, 2 Open Maintenance Hangars, y = 3.6 Catwalks, Blast Deflectors & Parked Fighters. */
function authorFuelApronAndHangars(k: Kit, spec: MapSpec): void {
  const g = k.geo;

  // --- 2 Open Maintenance Hangars on West Side (opening East toward the apron) ---
  for (const h of AIRBASE_MAINT_HANGARS) {
    const x0 = h.x - h.halfX; // -94
    const x1 = h.x + h.halfX; // -62
    const z0 = h.z - h.halfZ; // z - 12
    const z1 = h.z + h.halfZ; // z + 12

    // Back (West), North, and South reinforced steel-clad hangar walls (East face completely open!)
    k.wall(x0, z0, x0, z1, 0, h.height - 1.6, { thick: 0.9, mat: 'panel', backing: 'steelDark' });
    k.wall(x0, z1, x1, z1, 0, h.height - 1.6, { thick: 0.9, mat: 'panel', backing: 'steelDark', openings: [{ u0: 22, u1: 26, v0: 0, v1: 3.0, frame: true }] });
    k.wall(x1, z0, x0, z0, 0, h.height - 1.6, { thick: 0.9, mat: 'panel', backing: 'steelDark', openings: [{ u0: 6, u1: 10, v0: 0, v1: 3.0, frame: true }] });

    // Overhead steel trusses + corrugated pitched roof (y = 8.0 -> 9.8)
    for (let rx = x0 + 4; rx <= x1 - 2; rx += 7.5) {
      k.truss(rx, h.height - 1.2, z0 + 0.5, rx, h.height - 1.2, z1 - 0.5, 1.1, 0, 'steelDark', 0.09);
    }
    g.use('steelDark').tint(0.38, 0.42, 0.48);
    g.box(h.x, h.height, h.z, h.halfX + 0.6, 0.35, h.halfZ + 0.6);
    g.tint(1);
    k.noClimb(() => k.collide(h.x, h.height, h.z, h.halfX + 0.6, 0.4, h.halfZ + 0.6, 'metal'));

    // Warm overhead sodium lamps inside each hangar
    k.lampBar(h.x - 4, h.height - 1.8, h.z, 0, 5.2, 'orange', 48, 34);
    k.lampBar(h.x + 8, h.height - 1.8, h.z, 0, 5.2, 'white', 42, 32);

    // JP-8 fuel tanker truck, ammo containers & explosive barrels inside/beside each hangar
    fuelTankerTruck(k, h.x - 7, h.z - 5.5, 0.08);
    container(k, h.x - 6, 0, h.z + 7.2, 0, [0.34, 0.40, 0.36], true);
    spec.barrels(h.x + 12, 0, h.z - 8.5, 3);
    spec.barrels(h.x + 12, 0, h.z + 8.5, 2);

    spec.plan?.blocks.push({ x0, z0, x1: x0 + 2, z1 });
  }

  // --- Flanking Steel Grate Catwalk at y = 3.6 along Front of Maintenance Hangars (x = -58, z = +24..+98) ---
  k.catwalk(-58, 24, -58, 98, 3.6, 3.2, 'both', false);
  // Steel support columns under catwalk
  for (const cz of [28, 46, 62, 78, 94]) {
    g.use('steelDark').cyl(-59.3, 0, cz, -59.3, 3.5, cz, 0.14, 0.14, 6);
    g.use('steelDark').cyl(-56.7, 0, cz, -56.7, 3.5, cz, 0.14, 0.14, 6);
  }
  // Walkable stairs at both South (z = 98 -> 107) and North (z = 24 -> 15) ends!
  k.stairs(-58, 107, 0, -58, 98, 3.6, 2.8, 'steel', true);
  k.stairs(-58, 15, 0, -58, 24, 3.6, 2.8, 'steel', true);
  spec.plan?.decks.push({ x0: -59.6, z0: 24, x1: -56.4, z1: 98 });

  // --- Static Parked Military Fighters on Apron Revetments (clear of vehicle routes & spawns) ---
  staticParkedFighter(k, -45, 70, Math.PI / 2 - 0.15);
  staticParkedFighter(k, -45, 48, Math.PI / 2 + 0.12);

  // --- Concrete Jet Blast Deflectors separating Fuel Apron from Runway Service Road (x = +22) ---
  jetBlastDeflector(k, 22, 82, Math.PI / 2, 10);
  jetBlastDeflector(k, 22, 54, Math.PI / 2, 10);
  jetBlastDeflector(k, 22, 26, Math.PI / 2, 10);

  // Apron tactical cover: supply containers, generators, jersey barriers & explosive barrels
  container(k, -12, 0, 74, Math.PI / 2, [0.42, 0.48, 0.54], true);
  barrier(k, -12, 0, 52, 0.15, 4.5);
  barrier(k, -12, 0, 34, -0.20, 4.5);
  machine(k, -52, 0, 62, 0, 3.2, 2.2, 2.0);
  spec.barrels(-14, 0, 62, 3);
  spec.tank(-34, 0, 62);

  // Tall dawn airfield apron floodlight masts (placed off road centerlines)
  k.mast(-52, 102, 0, 12, 0.7, 'orange', 75, 44);
  k.mast(-52, 18, 0, 12, 0.9, 'orange', 75, 44);
  k.mast(32, 76, 0, 12, -1.6, 'white', 70, 44);
  k.mast(32, 16, 0, 12, -1.6, 'white', 70, 44);
}

/** Stage 4: Section 3 — 3-Level Air Traffic Control Tower (x = -56, z = -12, walkable y = 0 -> 3.6 -> 7.2 -> 10.8). */
function authorAtcTower(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const T = AIRBASE_ATC_TOWER;
  const x0 = T.x - T.coreHalfX; // -62.5
  const x1 = T.x + T.coreHalfX; // -49.5
  const z0 = T.z - T.coreHalfZ; // -18.5
  const z1 = T.z + T.coreHalfZ; // -5.5

  // --- Structural corner concrete columns (y = 0 -> 10.8) ---
  for (const cx of [x0 + 0.7, x1 - 0.7]) {
    for (const cz of [z0 + 0.7, z1 - 0.7]) {
      k.column(cx, cz, 0, 10.8, 1.3, 'concreteDark');
    }
  }

  // --- Level 0 Ground Lobby Walls (y = 0..3.6) with wide East & South entry portals ---
  k.wall(x0, z0, x0, z1, 0, 3.6, { thick: 0.7, mat: 'concrete' });
  k.wall(x1, z0, x0, z0, 0, 3.6, { thick: 0.7, mat: 'concrete' });
  k.wall(x0, z1, x1, z1, 0, 3.6, { thick: 0.7, mat: 'concrete', openings: [{ u0: 4.0, u1: 9.0, v0: 0, v1: 3.1, frame: true }] });
  k.wall(x1, z1, x1, z0, 0, 3.6, { thick: 0.7, mat: 'concrete', openings: [{ u0: 4.0, u1: 9.0, v0: 0, v1: 3.1, frame: true }] });
  k.light(T.x, 3.0, T.z, PALETTE.warmSodium, 32, 22);

  // --- Flight 1 (0 -> 3.6) along South exterior face, landing onto Level 1 South-East Balcony ---
  k.stairs(-61.5, -3.2, 0, -52.5, -3.2, 3.6, 2.8, 'steel', true);

  // --- Level 1 Operations Deck (y = 3.6) ---
  k.floor('concrete', x0, z0, x1, z1, 3.6, 0.42, 3.2);
  // Level 1 South-East landing connecting Flight 1 top to East balcony & Flight 2 foot
  k.floor('concrete', -52.5, -5.5, -46.2, -1.6, 3.6, 0.36, 2.5);
  k.rail([-52.5, 3.6, -1.7, -46.3, 3.6, -1.7, -46.3, 3.6, -5.5]);
  // Low waist-high perimeter parapet walls on Level 1 (open entry on South-East & East)
  k.wall(x0, z0, x0, z1, 3.6, 7.2, { thick: 0.6, mat: 'concrete', openings: [{ u0: 3.0, u1: 10.0, v0: 4.8, v1: 6.8 }] });
  k.wall(x1, z0, x0, z0, 3.6, 7.2, { thick: 0.6, mat: 'concrete', openings: [{ u0: 3.0, u1: 10.0, v0: 4.8, v1: 6.8 }] });
  k.wall(x0, z1, -53.2, z1, 3.6, 4.8, { thick: 0.5, mat: 'concreteDark' });
  k.light(T.x, 6.5, T.z, PALETTE.opsCyan, 28, 20);

  // --- Flight 2 (3.6 -> 7.2) along East exterior face (epic runway vista while climbing!) ---
  k.stairs(-47.8, -5.5, 3.6, -47.8, -14.5, 7.2, 2.8, 'steel', true);

  // --- Level 2 Radar & Comms Deck (y = 7.2) ---
  k.floor('concrete', x0, z0, x1, z1, 7.2, 0.42, 3.2);
  // Level 2 North-East landing connecting Flight 2 top directly to Flight 3 foot
  k.floor('concrete', -49.5, -21.8, -46.2, -14.5, 7.2, 0.36, 2.5);
  k.rail([-46.3, 7.2, -14.5, -46.3, 7.2, -21.7, -49.5, 7.2, -21.7]);
  // Level 2 tactical walls with firing embrasures facing Runway & Hangar
  k.wall(x0, z0, x0, z1, 7.2, 10.8, { thick: 0.6, mat: 'concrete', openings: [{ u0: 2.8, u1: 10.2, v0: 8.4, v1: 10.3 }] });
  k.wall(x0, z1, x1, z1, 7.2, 10.8, { thick: 0.6, mat: 'concrete', openings: [{ u0: 2.8, u1: 10.2, v0: 8.4, v1: 10.3 }] });
  k.wall(x1, z1, x1, -14.2, 7.2, 8.4, { thick: 0.5, mat: 'concreteDark' });
  // Server racks along west wall (clear of center spawn at -56, 7.2, -12)
  spec.breakable('rack', x0 + 1.4, 7.2, T.z - 2.2, Math.PI / 2);
  spec.breakable('rack', x0 + 1.4, 7.2, T.z + 2.2, Math.PI / 2);
  k.light(T.x, 10.1, T.z, PALETTE.warmSodium, 28, 20);

  // --- Flight 3 (7.2 -> 10.8) along North exterior face (looking straight at Alert Hangar!) ---
  k.stairs(-49.5, -20.2, 7.2, -58.5, -20.2, 10.8, 2.8, 'steel', true);

  // --- Level 3 Panoramic Glass Flight-Ops Control Room (y = 10.8..14.8) ---
  const cabX0 = -64.0, cabX1 = -48.0, cabZ0 = -19.5, cabZ1 = -4.5;
  k.floor('concrete', cabX0, cabZ0, cabX1, cabZ1, 10.8, 0.44, 3.2);
  // North-West stair landing seamlessly joining Flight 3 top into the Control Room
  k.floor('concrete', cabX0, -21.8, -58.5, cabZ0, 10.8, 0.36, 2.5);
  k.rail([cabX0 + 0.1, 10.8, -21.7, cabX0 + 0.1, 10.8, cabZ0]);
  k.rail([cabX0 + 0.1, 10.8, -21.7, -58.5, 10.8, -21.7]);

  // Waist-high armored cab skirt (y = 10.8..11.85) with open North-West entrance (x = -63.5..-58.5)
  k.wall(cabX0, cabZ1, cabX1, cabZ1, 10.8, 11.85, { thick: 0.45, mat: 'panel', backing: 'steelDark', cap: true });
  k.wall(cabX1, cabZ1, cabX1, cabZ0, 10.8, 11.85, { thick: 0.45, mat: 'panel', backing: 'steelDark', cap: true });
  k.wall(cabX1, cabZ0, -58.2, cabZ0, 10.8, 11.85, { thick: 0.45, mat: 'panel', backing: 'steelDark', cap: true });
  k.wall(cabX0, cabZ0, cabX0, cabZ1, 10.8, 11.85, { thick: 0.45, mat: 'panel', backing: 'steelDark', cap: true });

  // Steel window mullions around the cantilevered Flight-Ops Cab
  for (const [mx, mz] of [
    [cabX0 + 0.3, cabZ0 + 0.3],
    [cabX1 - 0.3, cabZ0 + 0.3],
    [cabX1 - 0.3, cabZ1 - 0.3],
    [cabX0 + 0.3, cabZ1 - 0.3],
    [T.x, cabZ1 - 0.3],
    [cabX1 - 0.3, T.z],
    [cabX0 + 0.3, T.z],
  ] as const) {
    g.use('steelDark').bevel(mx, 13.3, mz, 0.22, 1.5, 0.22, 0.04);
  }
  // Breakable panoramic glass window panes looking out across the Runway & Alert Hangar!
  spec.breakable('pane', cabX1 - 0.15, 13.3, T.z - 3.6, Math.PI / 2, 6.6, 2.7);
  spec.breakable('pane', cabX1 - 0.15, 13.3, T.z + 3.6, Math.PI / 2, 6.6, 2.7);
  spec.breakable('pane', -53.2, 13.3, cabZ0 + 0.15, 0, 9.2, 2.7);
  spec.breakable('pane', T.x, 13.3, cabZ1 - 0.15, 0, 14.2, 2.7);

  // Overhanging ATC Cab Roof (y = 14.8..15.3) + Radar Radome & VHF Antenna Mast (y = 22.8)
  k.block('steelDark', cabX0 - 0.9, 14.8, cabZ0 - 0.9, cabX1 + 0.9, 15.35, cabZ1 + 0.9, 0.1);
  // Roof glowing cyan fascia trim so ATC Tower is an unmistakable dawn landmark from across the base
  g.use('emissiveCyan').tint(0.35, 0.9, 1.0);
  g.box(T.x, 15.05, cabZ0 - 0.94, 8.6, 0.10, 0.05, FACE.nz);
  g.box(T.x, 15.05, cabZ1 + 0.94, 8.6, 0.10, 0.05, FACE.pz);
  g.box(cabX1 + 0.94, 15.05, T.z, 0.05, 0.10, 8.2, FACE.px);
  // Geodesic-style white radar radome & communications spire on roof
  g.use('paintWhite').tint(0.88, 0.90, 0.94);
  const domeProf: number[] = [];
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI * 0.25 + (i / 8) * Math.PI * 0.75;
    domeProf.push(Math.max(0.05, 2.4 * Math.cos(a)), 2.2 + 2.4 * Math.sin(a));
  }
  g.lathe(domeProf, T.x - 2.4, 15.35, T.z, 14, true);
  g.use('steelDark').cyl(T.x + 3.4, 15.35, T.z - 2.2, T.x + 3.4, T.mastTopY, T.z - 2.2, 0.24, 0.08, 8);
  g.use('steel').box(T.x + 3.4, 20.6, T.z - 2.2, 2.6, 0.12, 0.18);
  g.use('emissiveRed').tint(1, 0.2, 0.15);
  g.box(T.x + 3.4, T.mastTopY + 0.25, T.z - 2.2, 0.26, 0.30, 0.26);
  g.tint(1);

  // --- Hangar Override & IFF Spoof Console inside Level 3 Control Room ---
  const con = AIRBASE_ATC_CONSOLE.at; // [-50.5, 10.8, -12.0]
  const deskX = con[0] + 1.3; // -49.2 (right at the east panoramic window overlooking runway + hangar!)
  g.use('steelDark').tint(0.32, 0.36, 0.42);
  g.bevel(deskX, 11.45, con[2], 0.55, 0.62, 1.85, 0.05);
  // Glowing cyan/amber tactical screens & holographic IFF console indicator
  g.use('emissiveCyan').tint(0.25, 0.95, 1.0);
  g.box(deskX - 0.45, 12.15, con[2] - 0.65, 0.08, 0.34, 0.52);
  g.use('emissiveOrange').tint(1.0, 0.72, 0.20);
  g.box(deskX - 0.45, 12.15, con[2] + 0.65, 0.08, 0.34, 0.52);
  // Floor highlight marker pad where player stands to interact
  g.use('emissiveCyan').tint(0.3, 0.9, 1.0);
  g.box(con[0], 10.83, con[2], 0.85, 0.015, 1.3, FACE.py);
  g.tint(1);
  k.noClimb(() => k.collide(deskX, 11.45, con[2], 0.58, 0.62, 1.85, 'metal'));

  // Control room tactical monitors & chairs (destructible flavor props)
  spec.breakable('monitor', T.x - 1.5, 11.7, cabZ1 - 1.2, 0);
  spec.breakable('chair', con[0] - 1.2, 10.8, con[2] + 2.4, 0.4);

  k.light(T.x, 14.0, T.z, PALETTE.opsCyan, 42, 26);
  k.light(deskX - 0.8, 13.4, con[2], PALETTE.amberFlood, 24, 16);
  k.light(T.x + 3.4, T.mastTopY + 0.4, T.z - 2.2, PALETTE.alertRed, 22, 22);

  spec.plan?.blocks.push({ x0: cabX0, z0: cabZ0, x1: cabX1, z1: cabZ1 });
  spec.plan?.decks.push({ x0: cabX0, z0: -21.8, x1: -46.2, z1: -1.6 });
}

/**
 * Stage 5: Section 4 — Hardened Alert Hangar (+12, 0, -76) sized generously for the 28.2 m x 26.8 m B-1B Lancer,
 * plus the 2 Buddy F-22 Raptor Alert Revetments and Tier-0 Destructible Fuel/Bunker Clusters.
 */
function authorAlertHangarAndRevetments(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const H = AIRBASE_ALERT_HANGAR;
  const wallT = 2.6;

  // --- Side Reinforced Concrete Walls (x0 = -8, x1 = +32 -> 40 m clear interior width!) ---
  const sideWallH = 10.8;
  // West armored bunker wall (x in [-10.6, -8.0], z in [-98, -54])
  k.block('concrete', H.x0 - wallT, 0, H.z0, H.x0, sideWallH, H.z1, 0.14);
  // East armored bunker wall (x in [+32.0, +34.6], z in [-98, -54] — 11.4 m clear of Main Runway at x = +46!)
  k.block('concrete', H.x1, 0, H.z0, H.x1 + wallT, sideWallH, H.z1, 0.14);

  // Heavy exterior angled concrete buttresses along West & East walls
  g.use('concreteDark').tint(0.46, 0.49, 0.53);
  for (let bz = H.z0 + 4; bz <= H.z1 - 4; bz += 9) {
    g.bevel(H.x0 - wallT - 1.2, 4.6, bz, 1.3, 4.6, 0.9, 0.12);
    g.bevel(H.x1 + wallT + 1.2, 4.6, bz, 1.3, 4.6, 0.9, 0.12);
  }
  g.tint(1);

  // --- Impressive Arched Reinforced Concrete & Steel Ribbed Vault Roof (clear interior height >= 15.0 m at center!) ---
  // 5-segment vault spanning x from -10.6 to +34.6 (rise from y = 10.8 at eaves to y = 16.4 at crown)
  const archPts: readonly [number, number][] = [
    [H.x0 - wallT, 10.6],
    [H.x0 + 3.5, 14.3],
    [H.x - 8.5, 16.0],
    [H.x + 8.5, 16.0],
    [H.x1 - 3.5, 14.3],
    [H.x1 + wallT, 10.6],
  ];
  const roofThick = 1.2;
  for (let i = 0; i < archPts.length - 1; i++) {
    const [ax, ay] = archPts[i]!;
    const [bx, by] = archPts[i + 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const segLen = Math.hypot(dx, dy);
    const pitch = Math.atan2(dy, dx);
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2 + roofThick * 0.5;
    k.push(mx, my, H.z, 0, pitch, 0);
    g.use('concreteDark').tint(0.44, 0.48, 0.52);
    g.box(0, 0, 0, segLen / 2 + 0.35, roofThick / 2, H.interiorLength / 2 + 0.4);
    g.use('steelDark').tint(0.30, 0.34, 0.38);
    g.box(0, -roofThick / 2 - 0.06, 0, segLen / 2, 0.08, H.interiorLength / 2);
    g.tint(1);
    k.noClimb(() => k.collide(0, 0, 0, segLen / 2 + 0.2, roofThick / 2, H.interiorLength / 2 + 0.3, 'concrete'));
    k.pop();
  }

  // 7 Massive Internal Steel Arch Ribs framing the vaulted ceiling every 6.8 m
  for (let rz = H.z0 + 2.0; rz <= H.z1 - 2.0; rz += 6.8) {
    for (let i = 0; i < archPts.length - 1; i++) {
      const [ax, ay] = archPts[i]!;
      const [bx, by] = archPts[i + 1]!;
      k.ibeam(ax, ay - 0.15, rz, bx, by - 0.15, rz, 0.65, 0.45, 'steelDark', false);
    }
  }

  // --- South (z = -54) & North (z = -98) Blast Door Portals (36 m wide x 14.2 m tall clear opening!) ---
  const bd = H.blastDoorSlot;
  for (const pz of [bd.southZ, bd.northZ]) {
    const faceDir = pz === bd.southZ ? 1 : -1;
    // Heavy steel blast-door jamb piers & retracted armored door leaves parked in side pockets
    k.block('steelDark', H.x0, 0, pz - 0.9, bd.x0, 14.2, pz + 0.9, 0.08);
    k.block('steelDark', bd.x1, 0, pz - 0.9, H.x1, 14.2, pz + 0.9, 0.08);
    // Overhead reinforced lintel beam above y = 14.3
    k.block('concreteDark', H.x0 - wallT, 14.3, pz - 1.1, H.x1 + wallT, 16.4, pz + 1.1, 0.1);
    // High-visibility hazard chevron trim & glowing cyan/amber portal clearance strips
    g.use('hazard').tint(0.95, 0.80, 0.25);
    g.box(H.x, 14.42, pz + faceDir * 1.14, bd.width / 2, 0.24, 0.06, faceDir > 0 ? FACE.pz : FACE.nz);
    g.use('emissiveCyan').tint(0.3, 0.92, 1.0);
    g.box(bd.x0 + 0.08, 7.1, pz + faceDir * 0.96, 0.12, 6.8, 0.08);
    g.box(bd.x1 - 0.08, 7.1, pz + faceDir * 0.96, 0.12, 6.8, 0.08);
    g.use('emissiveOrange').tint(1.0, 0.68, 0.20);
    g.box(H.x, 14.08, pz + faceDir * 1.14, bd.width / 2 - 1.5, 0.12, 0.08);
    // Red aviation beacons atop portal corners
    g.use('emissiveRed').tint(1, 0.2, 0.15);
    g.box(H.x0 - 1.3, 16.75, pz, 0.35, 0.35, 0.35);
    g.box(H.x1 + 1.3, 16.75, pz, 0.35, 0.35, 0.35);
    g.tint(1);
  }

  // Painted Alert Hangar interior floor markings (B-1B Lancer wingtip safety lines & nose box)
  const mkY = 0.028;
  g.use('paintRed').tint(0.86, 0.22, 0.18);
  g.box(H.x - 15.2, mkY, H.z, 0.24, 0.006, 20, FACE.py);
  g.box(H.x + 15.2, mkY, H.z, 0.24, 0.006, 20, FACE.py);
  g.use('paintYellow').tint(0.96, 0.78, 0.18);
  g.box(H.x, mkY, H.z - 15, 7.0, 0.006, 0.30, FACE.py);
  g.box(H.x, mkY, H.z + 15, 7.0, 0.006, 0.30, FACE.py);
  g.tint(1);

  // High-bay Alert Hangar floodlights illuminating the B-1B Lancer dramatically!
  k.lampBar(H.x - 10, 13.8, H.z - 10, Math.PI / 2, 7.5, 'white', 64, 42);
  k.lampBar(H.x + 10, 13.8, H.z - 10, Math.PI / 2, 7.5, 'white', 64, 42);
  k.lampBar(H.x - 10, 13.8, H.z + 10, Math.PI / 2, 7.5, 'orange', 58, 40);
  k.lampBar(H.x + 10, 13.8, H.z + 10, Math.PI / 2, 7.5, 'orange', 58, 40);
  k.light(H.x, 12.5, bd.southZ + 8, PALETTE.amberFlood, 48, 34);
  k.light(H.x, 12.5, bd.northZ - 8, PALETTE.opsCyan, 42, 34);

  // Overhead power cables linking ATC Tower back to Alert Hangar West wall
  cable(k, -48, 13.5, -18, H.x0 - 2.4, 10.4, H.z1 - 4, 2.2, 0.07);

  spec.plan?.blocks.push({ x0: H.x0 - wallT, z0: H.z0, x1: H.x0, z1: H.z1 });
  spec.plan?.blocks.push({ x0: H.x1, z0: H.z0, x1: H.x1 + wallT, z1: H.z1 });

  // --- 2 Alert Revetment Pads for Buddy F-22 Raptors (open northward for instant scramble!) ---
  for (const pad of AIRBASE_BUDDY_RAPTOR_SPAWNS) {
    const [px, , pz] = pad.at;
    // Painted yellow scramble pad box
    g.use('paintYellow').tint(0.96, 0.80, 0.18);
    g.box(px - 8.5, mkY, pz, 0.22, 0.006, 10.5, FACE.py);
    g.box(px + 8.5, mkY, pz, 0.22, 0.006, 10.5, FACE.py);
    g.box(px, mkY, pz + 10.5, 8.7, 0.006, 0.22, FACE.py);
    g.box(px, mkY, pz - 10.5, 8.7, 0.006, 0.22, FACE.py);
    // Cyan guidance strobe posts flanking the northern exit (no colliders)
    g.use('emissiveCyan').tint(0.35, 0.92, 1.0);
    g.box(px - 9.0, 0.25, pz - 11.2, 0.22, 0.25, 0.22);
    g.box(px + 9.0, 0.25, pz - 11.2, 0.22, 0.25, 0.22);
    g.tint(1);
    // Angled blast deflector behind each Raptor (at pz + 14, leaving north wide open!)
    jetBlastDeflector(k, px, pz + 14.0, 0, 12);
    k.light(px, 8.5, pz, PALETTE.amberFlood, 36, 28);
  }

  // --- Tier-0 Destructible Fuel Farm & Bunker Clusters ---
  for (const d of AIRBASE_DESTRUCTIBLES) {
    spec.cluster(buildAirbaseDestructible(d.id, d.label, d.kind, d.x, d.z, d.yaw));
    spec.plan?.blocks.push({ x0: d.x - 3.5, z0: d.z - 2.8, x1: d.x + 3.5, z1: d.z + 2.8 });
    k.light(d.x, 4.8, d.z, PALETTE.warmSodium, 26, 20);
  }
}

export const AIRBASE_STAGES = [
  {
    label: 'Grading Valken tarmac, runway & dawn ridges',
    run: (k: Kit, spec: MapSpec) => {
      start(spec);
      authorGroundAndRunway(k, spec);
      STAGES_BUILT.add(spec);
    },
  },
  {
    label: 'Fortifying the South Perimeter & radar gate',
    run: authorSouthPerimeter,
  },
  {
    label: 'Building the Fuel Apron, maintenance hangars & catwalks',
    run: authorFuelApronAndHangars,
  },
  {
    label: 'Raising the 3-level Air Traffic Control Tower',
    run: authorAtcTower,
  },
  {
    label: 'Vaulting the Hardened Alert Hangar & scramble revetments',
    run: authorAlertHangarAndRevetments,
  },
] as const;

function zones(spec: MapSpec): void {
  for (const z of AIRBASE_ZONES) {
    spec.zone(z.id, z.name, z.x0, z.y0, z.z0, z.x1, z.y1, z.z1);
  }
}

function spawns(spec: MapSpec): void {
  const sectionToZone: Record<(typeof AIRBASE_ENEMY_SPAWNS)[number]['section'], string> = {
    southGate: 'airbase-south-gate',
    fuelApron: 'airbase-fuel-apron',
    atcTower: 'airbase-atc',
    alertHangar: 'airbase-alert-hangar',
    runway: 'airbase-runway',
  };

  const groundSpawns: SpawnPoint[] = AIRBASE_ENEMY_SPAWNS.map(s => ({
    position: new THREE.Vector3(s.at[0], s.at[1] + 0.1, s.at[2]),
    zone: sectionToZone[s.section],
    kind: 'ground',
  }));

  const airSpawns: SpawnPoint[] = AIRBASE_SKY_SPAWNS.map(([x, y, z]) => ({
    position: new THREE.Vector3(x, y, z),
    zone: 'airbase-airspace',
    kind: 'air',
  }));

  spec.spawns = [...groundSpawns, ...airSpawns];
  for (const s of groundSpawns) spec.gate(s.zone, s.position.x, s.position.y, s.position.z);
  for (const [x, y, z] of AIRBASE_PICKUPS) spec.pickup(x, y, z);

  spec.playerSpawns.push(
    { position: new THREE.Vector3(AIRBASE_PLAYER_SPAWN[0], AIRBASE_PLAYER_SPAWN[1] + 0.1, AIRBASE_PLAYER_SPAWN[2]), yaw: AIRBASE_PLAYER_YAW },
    { position: new THREE.Vector3(AIRBASE_HUB_PT[0], AIRBASE_HUB_PT[1] + 0.1, AIRBASE_HUB_PT[2]), yaw: 0 },
    { position: new THREE.Vector3(-42, 0.1, 62), yaw: 0 },
    { position: new THREE.Vector3(AIRBASE_ATC_CONSOLE.at[0], AIRBASE_ATC_CONSOLE.at[1] + 0.1, AIRBASE_ATC_CONSOLE.at[2]), yaw: -0.75 },
    { position: new THREE.Vector3(12, 0.1, -48), yaw: 0 },
  );
}

function views(spec: MapSpec): void {
  const eye = 1.62;
  spec.view('overview', 165, 92, 165, 0, 8, -20);
  spec.view('southGate', AIRBASE_PLAYER_SPAWN[0], eye, AIRBASE_PLAYER_SPAWN[2], 0, 3.5, 110);
  spec.view('fuelApron', -30, 8, 102, -62, 4, 48);
  spec.view('atcTower', -20, 14, 18, -56, 11, -12);
  spec.view('atcConsole', AIRBASE_ATC_CONSOLE.at[0], AIRBASE_ATC_CONSOLE.at[1] + eye, AIRBASE_ATC_CONSOLE.at[2], 12, 6, -76);
  spec.view('alertHangar', 12, 8, -32, 12, 6, -76);
  spec.view('runway', 62, 14, 146, 62, 4, -120);
  spec.view('takeoff', 96, 48, -195, 36, 10, -76);
}

/**
 * Finalizes Valken Airbase zones, spawns, pickups, and views.
 * Safely executes `AIRBASE_STAGES` when called standalone without running stages first.
 */
export function authorAirbase(k: Kit, spec: MapSpec): void {
  if (!STAGES_BUILT.has(spec)) {
    for (const stage of AIRBASE_STAGES) {
      stage.run(k, spec);
    }
  }
  zones(spec);
  spawns(spec);
  views(spec);
}
