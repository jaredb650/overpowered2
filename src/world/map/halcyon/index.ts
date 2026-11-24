/**
 * Map 3: Fortress Halcyon (`map: 'halcyon'`) — Giga-Sized Destructible Military Installation
 * for Part 3 of the "Crossfire" campaign mission.
 *
 * Composes 5 modular architectural stages:
 *   1. Terrain, Tarmac Roads, South Invasion Beachhead & Distant Coastal/Mountain Scenery (out to +-750 m)
 *   2. Fortified Perimeter Blast Walls (`structures.ts` nav-unblocking WallStyle + Gates) & 4 Corner Watchtowers
 *   3. 3 Mortar Trenches, 4 SAM Battery Pads, 3 Elevated Flak Bastions & 2 Geodesic Radar Domes
 *   4. West Sector Tank Armory + 6 Parked Tanks/APCs & East Sector Hardened Hangars + 6 Parked Aircraft
 *   5. NW Chain-Exploding Fuel Tank Farm & Ammo Bunkers, NE Multi-Story Barracks & 3-Tier Citadel Command HQ
 *
 * Every major facility is wired into `DestructionManager` (`spec.destructionClusters`), `Structures`
 * (`spec.structures`), `Breakables` (`spec.breakables`), and `HALCYON_TARGETS` so the player can
 * level almost the entire installation from the B-1B Lancer while combined-arms forces storm through
 * the blasted breaches below.
 */
import * as THREE from 'three';
import type { SpawnPoint } from '../../../core/contracts';
import type { StructuralClusterSpec, StructuralNodeSpec } from '../../destruction';
import { FACE, type Mat } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { pipe, truck } from '../../kit/props';
import { floorStencil, stencil } from '../../kit/stencil';
import type { MapSpec } from '../spec';
import {
  HALCYON_ATMOSPHERE,
  HALCYON_BOUNDS,
  HALCYON_CORNER_TOWERS,
  HALCYON_DISTRICTS,
  HALCYON_GROUND_SPAWNS,
  HALCYON_HUB_PT,
  HALCYON_LEVELS,
  HALCYON_LIGHT_BOUNDS,
  HALCYON_LIGHT_CELL,
  HALCYON_NAV_BOUNDS,
  HALCYON_NAVAL_SHIPS,
  HALCYON_NORTH_RIDGES,
  HALCYON_OUTER_MESAS,
  HALCYON_PALETTE,
  HALCYON_PERIMETER_WALLS,
  HALCYON_PICKUP_SPOTS,
  HALCYON_PLAYER_SPAWN,
  HALCYON_PLAYER_YAW,
  HALCYON_ROADS,
  HALCYON_SKY_SPAWNS,
  HALCYON_WALL_STYLE,
  type RgbTuple,
  type Vec2Tuple,
  type Vec3Tuple,
} from './plan';
import {
  HALCYON_AMMO_BUNKERS,
  HALCYON_BARRACKS,
  HALCYON_CHOPPER_LZS,
  HALCYON_CITADEL_HQ_POS,
  HALCYON_DEFENSE_SITES,
  HALCYON_FUEL_SILOS,
  HALCYON_HANGARS,
  HALCYON_PARKED_AIRCRAFT,
  HALCYON_PARKED_ARMOR,
  HALCYON_TANK_DEPOT_POS,
} from './targets';

export {
  HALCYON_ATMOSPHERE,
  HALCYON_BOUNDS,
  HALCYON_LEVELS,
  HALCYON_LIGHT_BOUNDS,
  HALCYON_LIGHT_CELL,
  HALCYON_NAV_BOUNDS,
};
export * from './plan';
export * from './targets';

export const HALCYON_HUB = new THREE.Vector3(HALCYON_HUB_PT[0], HALCYON_HUB_PT[1], HALCYON_HUB_PT[2]);

/** Prevents duplicate geometry if `authorHalcyon` is invoked after `HALCYON_STAGES`. */
const STAGES_BUILT = new WeakSet<MapSpec>();

const GROUND_THICK = 1.0;

// ---------------------------------------------------------------------------
// Low-level Geometry & Transform Helpers
// ---------------------------------------------------------------------------

function localToWorld(ox: number, oy: number, oz: number, yaw: number) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return (lx: number, ly: number, lz: number): [number, number, number] => [
    ox + lx * c + lz * s,
    oy + ly,
    oz - lx * s + lz * c,
  ];
}

function groundPatch(
  k: Kit,
  mat: Mat,
  tint: RgbTuple,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  step: number,
): void {
  const g = k.geo.use(mat).tint(tint[0], tint[1], tint[2]);
  g.gridStep(x0, y, z1, x1 - x0, 0, 0, 0, 0, z0 - z1, step);
  g.tint(1);
}

function drawTarmacRoad(k: Kit, pts: readonly Vec2Tuple[], width: number): void {
  const g = k.geo;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    k.along(a[0], 0.026, a[1], b[0], 0.026, b[1], len => {
      g.use('asphalt').tint(HALCYON_PALETTE.tarmac[0], HALCYON_PALETTE.tarmac[1], HALCYON_PALETTE.tarmac[2]);
      g.box(len / 2, 0.004, 0, len / 2 + 1.2, 0.004, width / 2, FACE.py);
      // Crisp shoulder edge lines
      g.use('paintWhite').tint(0.76, 0.78, 0.80);
      for (const s of [-1, 1]) {
        g.box(len / 2, 0.009, s * (width * 0.44), len / 2 + 0.4, 0.003, 0.16, FACE.py);
      }
      // Dashed yellow centerline
      g.use('paintYellow').tint(HALCYON_PALETTE.hazardYellow[0], HALCYON_PALETTE.hazardYellow[1], HALCYON_PALETTE.hazardYellow[2]);
      for (let u = 4; u < len - 4; u += 10) {
        g.box(u, 0.01, 0, 2.2, 0.003, 0.14, FACE.py);
      }
      g.tint(1);
    });
  }
}

function drawHazardBorder(k: Kit, x0: number, z0: number, x1: number, z1: number, y = 0.032, strip = 0.45): void {
  const g = k.geo;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const hx = (x1 - x0) / 2;
  const hz = (z1 - z0) / 2;
  g.use('hazard').tint(0.92, 0.84, 0.56);
  g.box(cx, y, z0, hx, 0.005, strip, FACE.py);
  g.box(cx, y, z1, hx, 0.005, strip, FACE.py);
  g.box(x0, y, cz, strip, 0.005, hz, FACE.py);
  g.box(x1, y, cz, strip, 0.005, hz, FACE.py);
  g.tint(1);
}

function drawLzPad(k: Kit, x: number, z: number, r: number): void {
  const g = k.geo;
  const y = 0.034;
  // Dark concrete landing circle / octagon pad
  g.use('concreteDark').tint(0.32, 0.35, 0.38);
  g.box(x, y - 0.006, z, r * 0.72, 0.005, r * 0.72, FACE.py);
  // Yellow corner brackets
  g.use('paintYellow').tint(HALCYON_PALETTE.hazardYellow[0], HALCYON_PALETTE.hazardYellow[1], HALCYON_PALETTE.hazardYellow[2]);
  const e = r * 0.68;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.box(x + sx * (e - 1.4), y, z + sz * e, 1.5, 0.005, 0.25, FACE.py);
      g.box(x + sx * e, y, z + sz * (e - 1.4), 0.25, 0.005, 1.5, FACE.py);
    }
  }
  // Bold white "H" in center
  g.use('paintWhite').tint(0.92, 0.94, 0.96);
  g.box(x - 1.8, y + 0.004, z, 0.35, 0.005, 3.0, FACE.py);
  g.box(x + 1.8, y + 0.004, z, 0.35, 0.005, 3.0, FACE.py);
  g.box(x, y + 0.004, z, 1.8, 0.005, 0.4, FACE.py);
  g.tint(1);
}

function drawFloodlightMast(k: Kit, x: number, z: number, h: number, lookYaw: number, lightHex: number, range = 46): void {
  const g = k.geo;
  g.use('concreteDark').tint(0.38, 0.41, 0.45).bevel(x, 0.45, z, 0.75, 0.45, 0.75, 0.06);
  g.use('steelDark').tint(0.34, 0.38, 0.42).cyl(x, 0.9, z, x, h, z, 0.24, 0.14, 6, false, true);
  k.push(x, h + 0.2, z, lookYaw);
  g.use('steel').tint(0.46, 0.50, 0.56).box(0, 0, 0, 1.4, 0.32, 0.26);
  g.use('emissiveWhite').tint(0.95, 0.97, 1.0).box(0, -0.05, 0.28, 1.15, 0.22, 0.04, FACE.pz);
  g.use('emissiveRed').tint(1.0, 0.22, 0.16).box(0, 0.55, 0, 0.22, 0.22, 0.22);
  k.pop();
  g.tint(1);
  k.noClimb(() => k.collide(x, h * 0.5, z, 0.55, h * 0.5, 0.55, 'metal', false));
  k.light(x, h - 1.2, z, lightHex, 42, range);
}

function drawHedgehog(k: Kit, x: number, z: number, yaw: number): void {
  const g = k.geo;
  k.push(x, 0, z, yaw);
  g.use('steelDark').tint(0.34, 0.36, 0.38);
  g.cyl(-0.85, 0, -0.85, 0.85, 1.45, 0.85, 0.09, 0.09, 4, true, true);
  g.cyl(0.85, 0, -0.85, -0.85, 1.45, 0.85, 0.09, 0.09, 4, true, true);
  g.cyl(0, 0, 0.95, 0, 1.45, -0.95, 0.09, 0.09, 4, true, true);
  g.tint(1);
  k.pop();
}

function drawCraterDecal(k: Kit, x: number, z: number, r: number): void {
  const g = k.geo;
  g.use('asphalt').tint(0.18, 0.17, 0.16);
  g.box(x, 0.018, z, r * 0.72, 0.004, r * 0.72, FACE.py);
  g.use('dirt').tint(0.30, 0.27, 0.22);
  g.box(x, 0.012, z, r, 0.004, r, FACE.py);
  g.tint(1);
}

function drawDistantMesa(k: Kit, x: number, z: number, rx: number, rz: number, h: number, yaw: number, basalt: boolean): void {
  const g = k.geo;
  const base = basalt ? HALCYON_PALETTE.basaltDark : HALCYON_PALETTE.mesaRock;
  k.push(x, 0, z, yaw);
  g.use('concreteDark').tint(base[0], base[1], base[2]);
  g.box(0, h * 0.24, 0, rx, h * 0.24, rz, FACE.noBottom);
  g.tint(base[0] * 1.15, base[1] * 1.12, base[2] * 1.08);
  g.box(rx * 0.08, h * 0.60, -rz * 0.06, rx * 0.68, h * 0.22, rz * 0.66, FACE.noBottom);
  g.tint(base[0] * 1.28, base[1] * 1.22, base[2] * 1.16);
  g.box(-rx * 0.05, h * 0.88, rz * 0.04, rx * 0.36, h * 0.16, rz * 0.36, FACE.noBottom);
  g.tint(1);
  k.pop();
}

// ---------------------------------------------------------------------------
// Stage 0: MapSpec Init (Minimap Plan & Roads)
// ---------------------------------------------------------------------------

function start(spec: MapSpec): void {
  spec.reactor = null;
  spec.killY = HALCYON_BOUNDS.y0;

  const fill = (
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    rgb: RgbTuple,
    label = '',
  ) => ({ x0, z0, x1, z1, rgb, label });

  spec.plan = {
    fills: [
      fill(-180, -180, 180, 180, [0.34, 0.32, 0.28], ''),
      fill(-142, -138, 142, 98, [0.28, 0.30, 0.33], ''),
      fill(-176, 102, 176, 176, [0.40, 0.36, 0.29], 'INVASION BEACHHEAD'),
      fill(-126, -22, -44, 54, [0.24, 0.27, 0.29], 'TANK ARMORY'),
      fill(44, -34, 132, 56, [0.23, 0.26, 0.30], 'HARDENED AIRFIELD'),
      fill(-126, -124, -48, -52, [0.34, 0.24, 0.21], 'FUEL & AMMO'),
      fill(48, -124, 126, -52, [0.27, 0.30, 0.32], 'GARRISON BARRACKS'),
      fill(-34, -64, 34, 6, [0.32, 0.28, 0.24], 'CITADEL HQ'),
    ],
    walls: [],
    blocks: [],
    decks: [],
    gates: [],
    doors: [],
  };

  spec.roads = HALCYON_ROADS.map(r => ({
    id: r.id,
    width: r.width,
    points: r.points,
  }));
}

// ---------------------------------------------------------------------------
// Stage 1: Terrain, Roads, Beachhead & Outer 1,500 m Visual Landscape
// ---------------------------------------------------------------------------

function authorTerrainAndRoads(k: Kit, spec: MapSpec): void {
  const { x0, x1, y1, z0, z1 } = HALCYON_BOUNDS;
  const g = k.geo;

  // 1. Flat continuous ground collider across the entire 1,640 m airspace (top exact y = 0)
  k.collide(0, -GROUND_THICK / 2, 0, (x1 - x0) / 2, GROUND_THICK / 2, (z1 - z0) / 2, 'dirt');

  // 2. Nav-zone base ground ([-180..180])
  groundPatch(k, 'dirt', HALCYON_PALETTE.coastalGravel, -180, -180, 180, 180, 0, 20);

  // 3. Fortress interior concrete foundation pad ([-142..142] x [-138..98])
  groundPatch(k, 'concrete', [0.38, 0.41, 0.44], -142, -138, 142, 98, 0.014, 24);

  // 4. Sector specialized tarmac / concrete aprons
  // West Tank Armory & Armored Motor Pool apron
  groundPatch(k, 'asphalt', HALCYON_PALETTE.tarmacDark, -126, -22, -44, 54, 0.02, 16);
  drawHazardBorder(k, -125, -21, -45, 53, 0.032, 0.45);

  // East Hardened Airfield tarmac & alert flight-line strip
  groundPatch(k, 'asphalt', HALCYON_PALETTE.tarmac, 44, -34, 132, 56, 0.02, 16);
  drawHazardBorder(k, 45, -33, 131, 55, 0.032, 0.45);
  // Crisp white alert taxiway centerline dashes running along x = 76
  g.use('paintWhite').tint(0.90, 0.92, 0.94);
  for (let z = -30; z <= 50; z += 8) {
    g.box(76, 0.032, z, 0.28, 0.004, 2.4, FACE.py);
  }
  // Yellow flight-line hold line along x = 51
  g.use('paintYellow').tint(HALCYON_PALETTE.hazardYellow[0], HALCYON_PALETTE.hazardYellow[1], HALCYON_PALETTE.hazardYellow[2]);
  g.box(51, 0.032, 11, 0.26, 0.004, 42, FACE.py);
  g.tint(1);

  // NW Fuel Tank Farm & Ammo Depot concrete containment bund apron
  groundPatch(k, 'concreteDark', [0.30, 0.32, 0.35], -124, -124, -48, -52, 0.02, 18);
  drawHazardBorder(k, -114, -85, -50, -51, 0.032, 0.42);
  drawHazardBorder(k, -108, -123, -46, -105, 0.032, 0.42);

  // NE Concrete Barracks Complex & Parade Square
  groundPatch(k, 'concrete', [0.44, 0.47, 0.50], 48, -124, 126, -52, 0.02, 18);
  groundPatch(k, 'asphalt', HALCYON_PALETTE.tarmacDark, 72, -98, 98, -76, 0.025, 14);

  // Center Citadel Armored Plaza ([-34..34] x [-64..6])
  groundPatch(k, 'concreteDark', [0.28, 0.31, 0.35], -34, -64, 34, 6, 0.022, 12);
  drawHazardBorder(k, -33, -63, 33, 5, 0.036, 0.65);
  floorStencil(k, 'WAR ROOM', 0, 1.5, Math.PI, 3.2, [0.92, 0.76, 0.22], 0.038);

  // 5. Tarmac road network & assault avenues
  for (const road of HALCYON_ROADS) {
    drawTarmacRoad(k, road.points, road.width);
  }

  // 6. South Invasion Beachhead staging pads, Valkyrie LZs, tank traps, craters & artillery ridges
  groundPatch(k, 'concrete', [0.42, 0.44, 0.46], -14, 148, 14, 168, 0.02, 14);
  groundPatch(k, 'concrete', [0.42, 0.44, 0.46], -92, 144, -68, 166, 0.02, 14);
  groundPatch(k, 'concrete', [0.42, 0.44, 0.46], 68, 144, 92, 166, 0.02, 14);

  for (const lz of HALCYON_CHOPPER_LZS) {
    drawLzPad(k, lz.pos[0], lz.pos[2], lz.radius * 0.65);
  }

  // Beachhead shell craters (visual-only low decals)
  for (const [cx, cz, cr] of [
    [-46, 122, 4.2], [-22, 114, 3.6], [24, 118, 4.0], [52, 126, 4.4],
    [-112, 116, 4.5], [114, 118, 4.2], [-62, 110, 3.2], [60, 112, 3.4],
  ] as const) {
    drawCraterDecal(k, cx, cz, cr);
  }

  // Czech hedgehog steel tank traps along z = 110 strictly outside the 3 assault lanes
  const trapXs = [-126, -118, -110, -102, -62, -54, -46, -38, 38, 46, 54, 62, 102, 110, 118, 126];
  for (let i = 0; i < trapXs.length; i++) {
    drawHedgehog(k, trapXs[i]!, 110 + (i % 2) * 2.5, i * 0.7);
  }

  // Friendly artillery ridge cover berms on outer beachhead flanks (clear of lanes & LZs)
  for (const sx of [-126, 126]) {
    g.use('dirt').tint(0.40, 0.36, 0.30).bevel(sx, 1.3, 148, 12, 1.3, 4.5, 0.4);
    g.use('concreteDark').tint(0.36, 0.38, 0.40).bevel(sx, 0.65, 142, 6, 0.65, 0.9, 0.08);
    k.collide(sx, 1.2, 148, 11.5, 1.2, 4.2, 'dirt');
    spec.plan?.blocks.push({ x0: sx - 12, z0: 143, x1: sx + 12, z1: 153 });
  }
  g.tint(1);

  // 7. Distant Visual Landscape (pure visual geometry out to +-780 m for 120 m bomber runs!)
  // East, West & North desert-rock military plateau skirt
  groundPatch(k, 'dirt', HALCYON_PALETTE.plateauDirt, -820, -820, 820, -180, -0.06, 160);
  groundPatch(k, 'dirt', HALCYON_PALETTE.plateauDirt, -820, -180, -180, 320, -0.06, 160);
  groundPatch(k, 'dirt', HALCYON_PALETTE.plateauDirt, 180, -180, 820, 320, -0.06, 160);
  // Southern coastal shelf sloping to dawn sea strait (z = 180..320 land, z = 320..820 sea)
  groundPatch(k, 'dirt', HALCYON_PALETTE.coastalGravel, -820, 180, 820, 320, -0.06, 160);
  groundPatch(k, 'steel', HALCYON_PALETTE.seaWater, -820, 320, 820, 820, -0.14, 160);
  // Surf shoreline foam band at z = 320
  g.use('paintWhite').tint(HALCYON_PALETTE.seaFoam[0], HALCYON_PALETTE.seaFoam[1], HALCYON_PALETTE.seaFoam[2]);
  g.box(0, -0.02, 320, 800, 0.02, 6.5, FACE.py);

  // Outer perimeter military supply highways running East & West out to +-720 m
  g.use('asphalt').tint(0.24, 0.26, 0.29);
  g.box(-460, 0.01, -42, 280, 0.01, 7, FACE.py);
  g.box(460, 0.01, -42, 280, 0.01, 7, FACE.py);
  g.tint(1);

  // Distant East/West plateau mesas & Northern basalt mountain ridges
  for (const m of HALCYON_OUTER_MESAS) {
    drawDistantMesa(k, m.x, m.z, m.rx, m.rz, m.h, m.yaw, false);
  }
  for (const r of HALCYON_NORTH_RIDGES) {
    drawDistantMesa(k, r.x, r.z, r.rx, r.rz, r.h, r.yaw, true);
  }

  // Distant Friendly Amphibious Assault Ships offshore to the south (cinematic bomber turn landmarks)
  for (const ship of HALCYON_NAVAL_SHIPS) {
    const sc = ship.scale;
    k.push(ship.x, 0, ship.z, ship.yaw);
    g.use('steel').tint(0.38, 0.43, 0.48).box(0, 3.5 * sc, 0, 11 * sc, 3.5 * sc, 48 * sc, FACE.noBottom);
    g.use('asphalt').tint(0.24, 0.27, 0.30).box(0, 7.1 * sc, 0, 10.6 * sc, 0.2 * sc, 46 * sc, FACE.py);
    g.use('steelDark').tint(0.32, 0.36, 0.42).box(6.5 * sc, 12.5 * sc, -6 * sc, 3.2 * sc, 5.5 * sc, 12 * sc);
    g.use('emissiveRed').tint(1.0, 0.25, 0.18).box(6.5 * sc, 19.5 * sc, -6 * sc, 0.6, 0.6, 0.6);
    g.use('paintWhite').tint(HALCYON_PALETTE.seaFoam[0], HALCYON_PALETTE.seaFoam[1], HALCYON_PALETTE.seaFoam[2]);
    g.box(0, 0.02, 74 * sc, 9 * sc, 0.02, 28 * sc, FACE.py);
    g.tint(1);
    k.pop();
  }

  // 8. Invisible outer airspace containment walls at +-820 m (aircraft fly freely up to bounds)
  const hh = y1 / 2;
  const hx = (x1 - x0) / 2 + 1;
  const hz = (z1 - z0) / 2 + 1;
  k.containment(0, hh, z0 - 0.5, hx, hh, 0.5);
  k.containment(0, hh, z1 + 0.5, hx, hh, 0.5);
  k.containment(x0 - 0.5, hh, 0, 0.5, hh, hz);
  k.containment(x1 + 0.5, hh, 0, 0.5, hh, hz);

  // 9. Broad harsh dawn war-zone illumination washes (4 baked lights) + 3 Beachhead LZ beacons
  k.light(0, 32, 130, HALCYON_PALETTE.dawnSun, 82, 72);
  k.light(-88, 34, -10, HALCYON_PALETTE.dawnSun, 76, 68);
  k.light(88, 34, -10, HALCYON_PALETTE.dawnSun, 76, 68);
  k.light(0, 36, -60, HALCYON_PALETTE.floodCold, 78, 70);
  for (const lz of HALCYON_CHOPPER_LZS.slice(0, 3)) {
    k.light(lz.pos[0], 6.5, lz.pos[2], HALCYON_PALETTE.floodAmber, 34, 24);
  }
}

// ---------------------------------------------------------------------------
// Stage 2: Fortified Perimeter Blast Walls (`structures.ts`) & Corner Watchtowers
// ---------------------------------------------------------------------------

function buildWatchtowerCluster(id: string, name: string, x: number, z: number, yaw: number): StructuralClusterSpec {
  const pt = localToWorld(x, 0, z, yaw);
  const H = 6.2;
  const W = 3.2;

  const nodes: StructuralNodeSpec[] = [
    { id: 'col_fl', pos: pt(-W, H / 2, W), half: [0.55, H / 2, 0.55], mat: 'concreteDark', color: 0x5c646d, hp: 320, tier: 1, anchored: true, kind: 'column', yaw, materialClass: 'concrete' },
    { id: 'col_fr', pos: pt(W, H / 2, W), half: [0.55, H / 2, 0.55], mat: 'concreteDark', color: 0x5c646d, hp: 320, tier: 1, anchored: true, kind: 'column', yaw, materialClass: 'concrete' },
    { id: 'col_bl', pos: pt(-W, H / 2, -W), half: [0.55, H / 2, 0.55], mat: 'concreteDark', color: 0x5c646d, hp: 320, tier: 1, anchored: true, kind: 'column', yaw, materialClass: 'concrete' },
    { id: 'col_br', pos: pt(W, H / 2, -W), half: [0.55, H / 2, 0.55], mat: 'concreteDark', color: 0x5c646d, hp: 320, tier: 1, anchored: true, kind: 'column', yaw, materialClass: 'concrete' },
    { id: 'cabin', pos: pt(0, H + 1.35, 0), half: [W + 0.45, 1.35, W + 0.45], mat: 'concrete', color: 0x767f88, hp: 340, tier: 1, anchored: false, kind: 'slab', yaw, impactRadius: 10, impactDamage: 240, materialClass: 'concrete', fractureGrid: [2, 2] },
    { id: 'roof', pos: pt(0, H + 3.05, 0), half: [W + 0.8, 0.35, W + 0.8], mat: 'steelDark', color: 0x3b444f, hp: 220, tier: 1, anchored: false, kind: 'roof', yaw, impactRadius: 10, impactDamage: 220, materialClass: 'metal' },
  ];

  const links: [string, string][] = [
    ['col_fl', 'cabin'],
    ['col_fr', 'cabin'],
    ['col_bl', 'cabin'],
    ['col_br', 'cabin'],
    ['cabin', 'roof'],
  ];

  return {
    id,
    tag: id,
    kind: 'watchtower',
    label: name,
    value: 110_000,
    nodes,
    links,
    collapseThreshold: 0.45,
  };
}

function authorPerimeterAndTowers(k: Kit, spec: MapSpec): void {
  const g = k.geo;

  // 1. Place every perimeter blast wall & armored gate in EXACT deterministic order!
  for (const run of HALCYON_PERIMETER_WALLS) {
    const opts = {
      style: HALCYON_WALL_STYLE,
      tier: run.tier,
      value: run.value,
      label: run.label,
    };
    if (run.kind === 'gate') {
      spec.wallGate(run.ax, run.az, run.bx, run.bz, 0, false, opts);
      const gx = (run.ax + run.bx) / 2;
      const gz = (run.az + run.bz) / 2;
      const w = Math.hypot(run.bx - run.ax, run.bz - run.az);
      spec.plan?.gates.push({ x: gx, z: gz, yaw: Math.atan2(-(run.bz - run.az), run.bx - run.ax), w, bay: true });
    } else {
      spec.wall(run.ax, run.az, run.bx, run.bz, 0, opts);
      spec.plan?.walls.push({ ax: run.ax, az: run.az, bx: run.bx, bz: run.bz, half: HALCYON_WALL_STYLE.thick / 2 });
    }
  }

  // 2. Painted tactical breach stencils & hazard bars outside South Wall gates
  for (const gx of [-80, 0, 80]) {
    g.use('hazard').tint(0.95, 0.85, 0.55);
    g.box(gx, 0.036, 102.5, 5.5, 0.005, 1.2, FACE.py);
    g.tint(1);
    floorStencil(k, 'CHEVRON', gx, 106.5, 0, 2.8, [0.94, 0.74, 0.18], 0.038);
    k.light(gx, 7.2, 104, HALCYON_PALETTE.floodAmber, 38, 28);
  }
  floorStencil(k, 'GATE', 0, 111.5, 0, 2.4, [0.92, 0.92, 0.90], 0.038);

  // 3. Walkable interior rampart catwalks (y = 3.8) behind solid South Curtains (clear of breach gates!)
  for (const [x0, x1] of [[-68, -32], [32, 68]] as const) {
    const cx = (x0 + x1) / 2;
    const hw = (x1 - x0) / 2;
    const cz = 94.2;
    const hd = 1.8;
    const deckY = HALCYON_LEVELS[1]; // 3.8
    g.use('grate').tint(0.68, 0.72, 0.76).slab(cx, deckY - 0.12, cz, hw, 0.12, hd, 4, FACE.all);
    g.use('steelDark').tint(0.36, 0.40, 0.44);
    for (let px = x0 + 2; px <= x1 - 2; px += 9) {
      g.box(px, deckY / 2 - 0.12, cz - hd + 0.15, 0.18, deckY / 2 - 0.12, 0.18);
      g.box(px, deckY / 2 - 0.12, cz + hd - 0.15, 0.18, deckY / 2 - 0.12, 0.18);
    }
    g.tint(1);
    k.collide(cx, deckY - 0.12, cz, hw, 0.12, hd, 'grate');
    spec.plan?.decks.push({ x0, z0: cz - hd, x1, z1: cz + hd });
    // Wide concrete access ramp down to y = 0 on the fortress interior side
    const rampX = cx < 0 ? x1 - 4 : x0 + 4;
    k.ramp(rampX, cz - hd - 8.2, 0, rampX, cz - hd, deckY, 3.0, 'concrete', 0.35, false);
  }

  // 4. Four Collapsible Perimeter Corner Watchtowers
  for (const t of HALCYON_CORNER_TOWERS) {
    spec.cluster(buildWatchtowerCluster(t.id, t.name, t.x, t.z, t.yaw));
    spec.plan?.blocks.push({ x0: t.x - 4, z0: t.z - 4, x1: t.x + 4, z1: t.z + 4 });
    k.light(t.x, 10.5, t.z, HALCYON_PALETTE.floodCold, 44, 34);
  }
}

// ---------------------------------------------------------------------------
// Stage 3: Mortar Trenches, SAM Batteries, Flak Bastions & Geodesic Radar Domes
// ---------------------------------------------------------------------------

function buildMortarPitCluster(id: string, name: string, x: number, z: number): StructuralClusterSpec {
  const nodes: StructuralNodeSpec[] = [
    { id: 'berm_s', pos: [x, 0.9, z + 4.4], half: [4.6, 0.9, 0.7], mat: 'dirt', color: 0x8f8268, hp: 220, tier: 1, anchored: true, kind: 'wall', materialClass: 'stone', fractureGrid: [2, 1] },
    { id: 'berm_w', pos: [x - 4.4, 0.9, z], half: [0.7, 0.9, 4.4], mat: 'dirt', color: 0x8f8268, hp: 220, tier: 1, anchored: true, kind: 'wall', materialClass: 'stone' },
    { id: 'berm_e', pos: [x + 4.4, 0.9, z], half: [0.7, 0.9, 4.4], mat: 'dirt', color: 0x8f8268, hp: 220, tier: 1, anchored: true, kind: 'wall', materialClass: 'stone' },
    { id: 'canopy', pos: [x, 3.1, z - 0.8], half: [4.8, 0.18, 3.6], mat: 'steelDark', color: 0x4b5346, hp: 160, tier: 0, anchored: false, kind: 'roof', impactRadius: 8, impactDamage: 180, materialClass: 'metal' },
    { id: 'ammo_pile', pos: [x + 1.8, 0.7, z - 1.2], half: [1.1, 0.7, 1.1], mat: 'paintRed', color: 0x9c3224, hp: 120, tier: 0, anchored: true, kind: 'hazard', hazardRadius: 11, hazardDamage: 260, keyNode: true, materialClass: 'metal' },
  ];
  const links: [string, string][] = [
    ['berm_s', 'canopy'],
    ['berm_w', 'canopy'],
    ['berm_e', 'canopy'],
  ];
  return {
    id,
    tag: id,
    kind: 'mortarPit',
    label: name,
    value: 220_000,
    nodes,
    links,
    collapseThreshold: 0.45,
  };
}

function buildSamBatteryCluster(id: string, name: string, x: number, z: number, yaw: number): StructuralClusterSpec {
  const pt = localToWorld(x, 0, z, yaw);
  const nodes: StructuralNodeSpec[] = [
    { id: 'base_pad', pos: pt(0, 0.65, 0), half: [3.6, 0.65, 3.6], mat: 'concreteDark', color: 0x4b525a, hp: 420, tier: 2, anchored: true, kind: 'slab', yaw, materialClass: 'concrete' },
    { id: 'blast_wall', pos: pt(0, 1.8, -4.6), half: [4.6, 1.8, 0.55], mat: 'concrete', color: 0x6f767e, hp: 360, tier: 1, anchored: true, kind: 'wall', yaw, materialClass: 'concrete', fractureGrid: [2, 1] },
    { id: 'control_cab', pos: pt(-3.4, 1.9, 1.2), half: [1.4, 1.25, 1.9], mat: 'steelDark', color: 0x3b444c, hp: 280, tier: 1, anchored: true, kind: 'wall', yaw, materialClass: 'metal' },
    { id: 'launcher', pos: pt(0.5, 2.9, 0.2), half: [1.8, 1.45, 2.4], mat: 'panel', color: 0x5c6852, hp: 260, tier: 1, anchored: false, kind: 'hazard', yaw, pitch: -0.35, hazardRadius: 15, hazardDamage: 340, keyNode: true, materialClass: 'metal' },
    { id: 'radar_mast', pos: pt(-3.4, 4.6, 1.2), half: [0.45, 1.45, 1.1], mat: 'paintWhite', color: 0xcfd6dc, hp: 180, tier: 1, anchored: false, kind: 'tower', yaw, impactRadius: 7, materialClass: 'metal' },
  ];
  const links: [string, string][] = [
    ['base_pad', 'launcher'],
    ['control_cab', 'radar_mast'],
  ];
  return {
    id,
    tag: id,
    kind: 'samBattery',
    label: name,
    value: 480_000,
    nodes,
    links,
    collapseThreshold: 0.45,
  };
}

function buildFlakTowerCluster(id: string, name: string, x: number, z: number): StructuralClusterSpec {
  const baseY = HALCYON_LEVELS[1]; // 3.8
  const topY = HALCYON_LEVELS[2];  // 7.6
  const H = topY - baseY;          // 3.8
  const W = 3.6;

  const nodes: StructuralNodeSpec[] = [
    { id: 'pier_fl', pos: [x - W, baseY + H / 2, z + W], half: [0.65, H / 2, 0.65], mat: 'concreteDark', color: 0x4f565e, hp: 420, tier: 2, anchored: true, kind: 'column', materialClass: 'concrete' },
    { id: 'pier_fr', pos: [x + W, baseY + H / 2, z + W], half: [0.65, H / 2, 0.65], mat: 'concreteDark', color: 0x4f565e, hp: 420, tier: 2, anchored: true, kind: 'column', materialClass: 'concrete' },
    { id: 'pier_bl', pos: [x - W, baseY + H / 2, z - W], half: [0.65, H / 2, 0.65], mat: 'concreteDark', color: 0x4f565e, hp: 420, tier: 2, anchored: true, kind: 'column', materialClass: 'concrete' },
    { id: 'pier_br', pos: [x + W, baseY + H / 2, z - W], half: [0.65, H / 2, 0.65], mat: 'concreteDark', color: 0x4f565e, hp: 420, tier: 2, anchored: true, kind: 'column', materialClass: 'concrete' },
    { id: 'gun_deck', pos: [x, topY + 0.35, z], half: [W + 1.1, 0.35, W + 1.1], mat: 'concrete', color: 0x6f7780, hp: 440, tier: 2, anchored: false, kind: 'slab', impactRadius: 11, impactDamage: 260, materialClass: 'concrete' },
    { id: 'turret_housing', pos: [x, topY + 1.65, z], half: [1.85, 1.0, 2.2], mat: 'steelDark', color: 0x3a424a, hp: 320, tier: 1, anchored: false, kind: 'tower', keyNode: true, impactRadius: 9, materialClass: 'metal' },
    { id: 'gun_shield', pos: [x, topY + 1.25, z + W + 0.6], half: [W + 0.5, 0.6, 0.25], mat: 'steel', color: 0x59626c, hp: 240, tier: 1, anchored: false, kind: 'wall', materialClass: 'metal' },
    { id: 'ammo_mag', pos: [x, baseY + 1.1, z], half: [1.5, 1.1, 1.5], mat: 'paintRed', color: 0xb03022, hp: 160, tier: 1, anchored: true, kind: 'hazard', hazardRadius: 14, hazardDamage: 320, materialClass: 'metal' },
  ];

  const links: [string, string][] = [
    ['pier_fl', 'gun_deck'],
    ['pier_fr', 'gun_deck'],
    ['pier_bl', 'gun_deck'],
    ['pier_br', 'gun_deck'],
    ['gun_deck', 'turret_housing'],
    ['gun_deck', 'gun_shield'],
  ];

  return {
    id,
    tag: id,
    kind: 'flakBastion',
    label: name,
    value: 360_000,
    nodes,
    links,
    collapseThreshold: 0.45,
  };
}

function buildRadarDomeCluster(id: string, name: string, x: number, z: number): StructuralClusterSpec {
  const nodes: StructuralNodeSpec[] = [
    // Reinforced concrete octagonal pedestal
    { id: 'pedestal', pos: [x, 1.8, z], half: [5.4, 1.8, 5.4], mat: 'concreteDark', color: 0x4d545c, hp: 540, tier: 2, anchored: true, kind: 'slab', materialClass: 'concrete' },
    // Lower geodesic white radome shell walls (4 sides)
    { id: 'shell_n', pos: [x, 5.6, z - 4.4], half: [4.6, 2.0, 0.55], mat: 'paintWhite', color: 0xd6dce2, hp: 280, tier: 1, anchored: false, kind: 'wall', materialClass: 'metal', fractureGrid: [2, 2] },
    { id: 'shell_s', pos: [x, 5.6, z + 4.4], half: [4.6, 2.0, 0.55], mat: 'paintWhite', color: 0xd6dce2, hp: 280, tier: 1, anchored: false, kind: 'wall', materialClass: 'metal', fractureGrid: [2, 2] },
    { id: 'shell_w', pos: [x - 4.4, 5.6, z], half: [0.55, 2.0, 4.4], mat: 'paintWhite', color: 0xcbd3da, hp: 280, tier: 1, anchored: false, kind: 'wall', materialClass: 'metal', fractureGrid: [2, 2] },
    { id: 'shell_e', pos: [x + 4.4, 5.6, z], half: [0.55, 2.0, 4.4], mat: 'paintWhite', color: 0xcbd3da, hp: 280, tier: 1, anchored: false, kind: 'wall', materialClass: 'metal', fractureGrid: [2, 2] },
    // Upper tapered geodesic dome panels
    { id: 'dome_w', pos: [x - 2.4, 9.0, z], half: [2.2, 1.6, 3.6], mat: 'paintWhite', color: 0xe2e7ec, hp: 240, tier: 1, anchored: false, kind: 'roof', roll: 0.28, materialClass: 'metal' },
    { id: 'dome_e', pos: [x + 2.4, 9.0, z], half: [2.2, 1.6, 3.6], mat: 'paintWhite', color: 0xe2e7ec, hp: 240, tier: 1, anchored: false, kind: 'roof', roll: -0.28, materialClass: 'metal' },
    { id: 'dome_n', pos: [x, 9.0, z - 2.4], half: [3.6, 1.6, 2.2], mat: 'paintWhite', color: 0xdbe1e7, hp: 240, tier: 1, anchored: false, kind: 'roof', pitch: -0.28, materialClass: 'metal' },
    // Geodesic crown cap
    { id: 'crown', pos: [x, 11.4, z], half: [2.8, 0.9, 2.8], mat: 'paintWhite', color: 0xeef2f5, hp: 200, tier: 1, anchored: false, kind: 'roof', impactRadius: 12, impactDamage: 260, materialClass: 'metal' },
    // Internal high-voltage radar transceiver core (keyNode hazard!)
    { id: 'radar_core', pos: [x, 5.4, z], half: [1.8, 1.8, 1.8], mat: 'emissiveCyan', color: 0x3ec2e8, hp: 220, tier: 1, anchored: false, kind: 'hazard', hazardRadius: 15, hazardDamage: 350, keyNode: true, materialClass: 'metal' },
  ];

  const links: [string, string][] = [
    ['pedestal', 'shell_n'],
    ['pedestal', 'shell_s'],
    ['pedestal', 'shell_w'],
    ['pedestal', 'shell_e'],
    ['pedestal', 'radar_core'],
    ['shell_w', 'dome_w'],
    ['shell_e', 'dome_e'],
    ['shell_n', 'dome_n'],
    ['shell_s', 'dome_w'],
    ['dome_w', 'crown'],
    ['dome_e', 'crown'],
    ['dome_n', 'crown'],
  ];

  return {
    id,
    tag: id,
    kind: 'radarDome',
    label: name,
    value: 550_000,
    nodes,
    links,
    collapseThreshold: 0.45,
  };
}

function authorDefenseSites(k: Kit, spec: MapSpec): void {
  const g = k.geo;

  for (const site of HALCYON_DEFENSE_SITES) {
    const [x, , z] = site.pos;

    if (site.role === 'mortar') {
      // Flush concrete firing pad + hazard border
      g.use('concreteDark').tint(0.32, 0.35, 0.38).box(x, 0.025, z, 5.5, 0.01, 5.5, FACE.py);
      drawHazardBorder(k, x - 5.4, z - 5.4, x + 5.4, z + 5.4, 0.036, 0.32);
      spec.cluster(buildMortarPitCluster(site.clusterId, site.name, x, z));
      spec.barrels(x - 3.6, 0, z - 3.2, 2);
      spec.plan?.blocks.push({ x0: x - 5, z0: z - 5, x1: x + 5, z1: z + 5 });
    } else if (site.role === 'sam') {
      // Octagonal SAM concrete pad + hazard perimeter
      g.use('concrete').tint(0.48, 0.51, 0.54).box(x, 0.028, z, 6.4, 0.012, 6.4, FACE.py);
      drawHazardBorder(k, x - 6.2, z - 6.2, x + 6.2, z + 6.2, 0.038, 0.42);
      spec.cluster(buildSamBatteryCluster(site.clusterId, site.name, x, z, site.defaultYaw));
      spec.breakable('generator', x + 5.2, 0, z + 3.2, 0);
      spec.plan?.blocks.push({ x0: x - 6, z0: z - 6, x1: x + 6, z1: z + 6 });
    } else if (site.role === 'flak') {
      // Elevated solid concrete bastion pedestal (y = 0..3.8) + walkable ramp up to y = 3.8
      const baseY = HALCYON_LEVELS[1]; // 3.8
      k.block('concreteDark', x - 5.2, 0, z - 5.2, x + 5.2, baseY, z + 5.2, 0.12);
      g.use('hazard').tint(0.92, 0.82, 0.52).box(x, baseY + 0.015, z, 5.0, 0.008, 5.0, FACE.py);
      g.tint(1);
      // Wide concrete ramp on the interior side (north for south flak towers, south for north flak tower)
      const rampDir = z > 0 ? -1 : 1;
      k.ramp(x, z + rampDir * 13.4, 0, x, z + rampDir * 5.2, baseY, 3.2, 'concrete', 0.35, false);
      spec.plan?.decks.push({ x0: x - 5.2, z0: z - 5.2, x1: x + 5.2, z1: z + 5.2 });
      spec.cluster(buildFlakTowerCluster(site.clusterId, site.name, x, z));
      k.light(x, 10.2, z, HALCYON_PALETTE.floodAmber, 38, 28);
    } else if (site.role === 'radar') {
      // Geodesic Radar Compound pad + backup generator
      g.use('concrete').tint(0.46, 0.50, 0.54).box(x, 0.028, z, 7.6, 0.012, 7.6, FACE.py);
      drawHazardBorder(k, x - 7.4, z - 7.4, x + 7.4, z + 7.4, 0.038, 0.42);
      spec.cluster(buildRadarDomeCluster(site.clusterId, site.name, x, z));
      spec.breakable('generator', x + (x < 0 ? -7.2 : 7.2), 0, z + 4.8, 0);
      spec.plan?.blocks.push({ x0: x - 6.5, z0: z - 6.5, x1: x + 6.5, z1: z + 6.5 });
      k.light(x, 13.5, z, HALCYON_PALETTE.alertRed, 32, 26);
    }
  }
}

// ---------------------------------------------------------------------------
// Stage 4: West Tank Armory & Motor Pool + East Hardened Airfield & Flight Line
// ---------------------------------------------------------------------------

function buildTankArmoryDepotCluster(): StructuralClusterSpec {
  const [cx, , cz] = HALCYON_TANK_DEPOT_POS; // (-88, 0, -2)
  const H = 9.6;
  const W = 19.5; // x in [-107.5, -68.5]
  const D = 13.5; // z in [-15.5, +11.5]

  const nodes: StructuralNodeSpec[] = [
    // 6 massive ribbed load-bearing perimeter bay columns (Tier 2)
    { id: 'col_wn', pos: [cx - W, H / 2, cz - D], half: [0.95, H / 2, 0.95], mat: 'steelDark', color: 0x3b434c, hp: 460, tier: 2, anchored: true, kind: 'column', materialClass: 'metal' },
    { id: 'col_wm', pos: [cx - W, H / 2, cz], half: [0.95, H / 2, 0.95], mat: 'steelDark', color: 0x3b434c, hp: 460, tier: 2, anchored: true, kind: 'column', materialClass: 'metal' },
    { id: 'col_ws', pos: [cx - W, H / 2, cz + D], half: [0.95, H / 2, 0.95], mat: 'steelDark', color: 0x3b434c, hp: 460, tier: 2, anchored: true, kind: 'column', materialClass: 'metal' },
    { id: 'col_en', pos: [cx + W, H / 2, cz - D], half: [0.95, H / 2, 0.95], mat: 'steelDark', color: 0x3b434c, hp: 460, tier: 2, anchored: true, kind: 'column', materialClass: 'metal' },
    { id: 'col_em', pos: [cx + W, H / 2, cz], half: [0.95, H / 2, 0.95], mat: 'steelDark', color: 0x3b434c, hp: 460, tier: 2, anchored: true, kind: 'column', materialClass: 'metal' },
    { id: 'col_es', pos: [cx + W, H / 2, cz + D], half: [0.95, H / 2, 0.95], mat: 'steelDark', color: 0x3b434c, hp: 460, tier: 2, anchored: true, kind: 'column', materialClass: 'metal' },
    // Reinforced blast walls (North rear + West/East flanks; South side stays open for rolling tanks!)
    { id: 'wall_n', pos: [cx, H / 2, cz - D], half: [W - 1.0, H / 2, 0.75], mat: 'concrete', color: 0x67707a, hp: 480, tier: 2, anchored: true, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    { id: 'wall_w1', pos: [cx - W, H / 2, cz - D / 2], half: [0.7, H / 2, D / 2 - 0.9], mat: 'concrete', color: 0x616973, hp: 420, tier: 2, anchored: true, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    { id: 'wall_w2', pos: [cx - W, H / 2, cz + D / 2], half: [0.7, H / 2, D / 2 - 0.9], mat: 'concrete', color: 0x616973, hp: 420, tier: 2, anchored: true, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    { id: 'wall_e1', pos: [cx + W, H / 2, cz - D / 2], half: [0.7, H / 2, D / 2 - 0.9], mat: 'concrete', color: 0x616973, hp: 420, tier: 2, anchored: true, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    { id: 'wall_e2', pos: [cx + W, H / 2, cz + D / 2], half: [0.7, H / 2, D / 2 - 0.9], mat: 'concrete', color: 0x616973, hp: 420, tier: 2, anchored: true, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    // Overhead steel roof truss bays (domino-collapse when side columns fall!)
    { id: 'roof_n', pos: [cx, H + 0.75, cz - D * 0.62], half: [W + 1.0, 0.75, D * 0.36], mat: 'steel', color: 0x48515c, hp: 360, tier: 2, anchored: false, kind: 'roof', impactRadius: 13, impactDamage: 300, materialClass: 'metal' },
    { id: 'roof_m', pos: [cx, H + 0.95, cz], half: [W + 1.0, 0.85, D * 0.34], mat: 'steelDark', color: 0x3b444f, hp: 360, tier: 2, anchored: false, kind: 'roof', impactRadius: 13, impactDamage: 300, materialClass: 'metal' },
    { id: 'roof_s', pos: [cx, H + 0.75, cz + D * 0.62], half: [W + 1.0, 0.75, D * 0.36], mat: 'steel', color: 0x48515c, hp: 360, tier: 2, anchored: false, kind: 'roof', impactRadius: 13, impactDamage: 300, materialClass: 'metal' },
    // South portal armored header beam
    { id: 'portal_header', pos: [cx, H - 1.1, cz + D], half: [W - 1.0, 1.1, 0.65], mat: 'hazard', color: 0xc29e38, hp: 320, tier: 1, anchored: false, kind: 'slab', impactRadius: 10, materialClass: 'metal' },
    // Internal tank shells & diesel munitions cache
    { id: 'ammo_cache', pos: [cx - 6, 1.4, cz - 4], half: [2.4, 1.4, 2.2], mat: 'paintRed', color: 0xb82e20, hp: 180, tier: 1, anchored: true, kind: 'hazard', hazardRadius: 16, hazardDamage: 380, materialClass: 'metal' },
  ];

  const links: [string, string][] = [
    ['col_wn', 'roof_n'], ['col_en', 'roof_n'], ['wall_n', 'roof_n'], ['wall_w1', 'roof_n'], ['wall_e1', 'roof_n'],
    ['col_wm', 'roof_m'], ['col_em', 'roof_m'], ['roof_n', 'roof_m'], ['roof_s', 'roof_m'],
    ['col_ws', 'roof_s'], ['col_es', 'roof_s'], ['wall_w2', 'roof_s'], ['wall_e2', 'roof_s'],
    ['col_ws', 'portal_header'], ['col_es', 'portal_header'],
  ];

  return {
    id: 'halcyon.tank_armory.depot',
    tag: 'halcyon.tank_armory.depot',
    kind: 'tankArmoryDepot',
    label: 'ARMORED VEHICLE DEPOT',
    value: 1_100_000,
    nodes,
    links,
    collapseThreshold: 0.5,
  };
}

function buildParkedArmorCluster(id: string, name: string, variant: string, x: number, z: number, yaw: number): StructuralClusterSpec {
  const pt = localToWorld(x, 0, z, yaw);
  const isTank = variant === 'tank';
  const nodes: StructuralNodeSpec[] = [
    { id: 'hull', pos: pt(0, 0.95, 0), half: [isTank ? 3.5 : 3.2, 0.95, isTank ? 1.85 : 1.65], mat: 'panel', color: isTank ? 0x4b5640 : 0x525d49, hp: 280, tier: 1, anchored: true, kind: 'wall', yaw, materialClass: 'metal' },
    { id: 'turret', pos: pt(isTank ? 0.2 : 0.4, 2.25, 0), half: [isTank ? 2.1 : 1.3, 0.55, isTank ? 1.25 : 0.95], mat: 'steelDark', color: 0x3b4435, hp: 200, tier: 1, anchored: false, kind: 'tower', yaw, impactRadius: 7, materialClass: 'metal' },
    { id: 'fuel_ammo', pos: pt(-2.2, 1.35, 0), half: [1.0, 0.65, 1.1], mat: 'paintRed', color: 0x9e3424, hp: 110, tier: 0, anchored: false, kind: 'hazard', yaw, hazardRadius: 10, hazardDamage: 240, keyNode: true, materialClass: 'metal' },
  ];
  return {
    id,
    tag: id,
    kind: isTank ? 'parkedTank' : 'parkedApc',
    label: name,
    value: isTank ? 140_000 : 110_000,
    nodes,
    links: [['hull', 'turret'], ['hull', 'fuel_ammo']],
    collapseThreshold: 0.45,
  };
}

function buildHangarCluster(id: string, name: string, cx: number, cz: number): StructuralClusterSpec {
  // Hangar spans x in [cx - 15, cx + 15] (30 m deep), z in [cz - 12, cz + 12] (24 m wide), opens west (-X)
  const H = 8.4;
  const W = 14.5;
  const D = 11.5;

  const nodes: StructuralNodeSpec[] = [
    // 4 heavy concrete/steel arch base piers (Tier 2)
    { id: 'pier_nw', pos: [cx - W, H / 2, cz - D], half: [1.1, H / 2, 1.1], mat: 'concreteDark', color: 0x454d56, hp: 440, tier: 2, anchored: true, kind: 'column', materialClass: 'concrete' },
    { id: 'pier_ne', pos: [cx + W, H / 2, cz - D], half: [1.1, H / 2, 1.1], mat: 'concreteDark', color: 0x454d56, hp: 440, tier: 2, anchored: true, kind: 'column', materialClass: 'concrete' },
    { id: 'pier_sw', pos: [cx - W, H / 2, cz + D], half: [1.1, H / 2, 1.1], mat: 'concreteDark', color: 0x454d56, hp: 440, tier: 2, anchored: true, kind: 'column', materialClass: 'concrete' },
    { id: 'pier_se', pos: [cx + W, H / 2, cz + D], half: [1.1, H / 2, 1.1], mat: 'concreteDark', color: 0x454d56, hp: 440, tier: 2, anchored: true, kind: 'column', materialClass: 'concrete' },
    // Armored side & east rear blast walls
    { id: 'wall_n', pos: [cx, H / 2, cz - D], half: [W - 1.1, H / 2, 0.75], mat: 'steelDark', color: 0x3b444e, hp: 420, tier: 2, anchored: true, kind: 'wall', materialClass: 'metal', fractureGrid: [2, 2] },
    { id: 'wall_s', pos: [cx, H / 2, cz + D], half: [W - 1.1, H / 2, 0.75], mat: 'steelDark', color: 0x3b444e, hp: 420, tier: 2, anchored: true, kind: 'wall', materialClass: 'metal', fractureGrid: [2, 2] },
    { id: 'wall_e', pos: [cx + W, H / 2, cz], half: [0.8, H / 2, D - 1.1], mat: 'concrete', color: 0x626b75, hp: 480, tier: 2, anchored: true, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    // Arched steel roof ribs (north sloped wing, central arch crown, south sloped wing)
    { id: 'arch_n', pos: [cx, H + 1.4, cz - D * 0.56], half: [W + 0.8, 0.75, D * 0.48], mat: 'steel', color: 0x4f5965, hp: 340, tier: 2, anchored: false, kind: 'roof', pitch: -0.26, impactRadius: 12, impactDamage: 280, materialClass: 'metal' },
    { id: 'arch_top', pos: [cx, H + 2.8, cz], half: [W + 0.8, 0.8, D * 0.36], mat: 'steelDark', color: 0x3e4752, hp: 340, tier: 2, anchored: false, kind: 'roof', impactRadius: 13, impactDamage: 300, materialClass: 'metal' },
    { id: 'arch_s', pos: [cx, H + 1.4, cz + D * 0.56], half: [W + 0.8, 0.75, D * 0.48], mat: 'steel', color: 0x4f5965, hp: 340, tier: 2, anchored: false, kind: 'roof', pitch: 0.26, impactRadius: 12, impactDamage: 280, materialClass: 'metal' },
    // West hangar portal header fascia
    { id: 'portal_w', pos: [cx - W, H + 0.4, cz], half: [0.65, 1.2, D - 1.0], mat: 'hazard', color: 0xc29e38, hp: 280, tier: 1, anchored: false, kind: 'slab', impactRadius: 10, materialClass: 'metal' },
    // Internal aviation JP-8 fuel bowser & missile cart
    { id: 'fuel_cart', pos: [cx + 4, 1.35, cz], half: [2.2, 1.35, 1.8], mat: 'paintRed', color: 0xc23020, hp: 150, tier: 0, anchored: true, kind: 'hazard', hazardRadius: 16, hazardDamage: 360, materialClass: 'metal' },
  ];

  const links: [string, string][] = [
    ['pier_nw', 'arch_n'], ['pier_ne', 'arch_n'], ['wall_n', 'arch_n'],
    ['pier_sw', 'arch_s'], ['pier_se', 'arch_s'], ['wall_s', 'arch_s'],
    ['arch_n', 'arch_top'], ['arch_s', 'arch_top'], ['wall_e', 'arch_top'],
    ['pier_nw', 'portal_w'], ['pier_sw', 'portal_w'], ['arch_top', 'portal_w'],
  ];

  return {
    id,
    tag: id,
    kind: 'aircraftHangar',
    label: name,
    value: 880_000,
    nodes,
    links,
    collapseThreshold: 0.5,
  };
}

function buildParkedAircraftCluster(id: string, name: string, variant: string, x: number, z: number, yaw: number): StructuralClusterSpec {
  const pt = localToWorld(x, 0, z, yaw);
  const isFighter = variant === 'fighter';
  const nodes: StructuralNodeSpec[] = [
    { id: 'fuselage', pos: pt(0, 1.35, 0), half: [isFighter ? 5.8 : 4.8, 0.85, isFighter ? 1.05 : 1.2], mat: 'steel', color: isFighter ? 0x67727e : 0x454f46, hp: 180, tier: 1, anchored: true, kind: 'wall', yaw, materialClass: 'metal' },
    { id: 'wings', pos: pt(isFighter ? -0.6 : 0.4, isFighter ? 1.3 : 2.85, 0), half: [isFighter ? 2.1 : 0.65, 0.22, isFighter ? 4.8 : 5.4], mat: 'steelDark', color: isFighter ? 0x56606b : 0x353b42, hp: 130, tier: 0, anchored: false, kind: 'roof', yaw, impactRadius: 7, materialClass: 'metal' },
    { id: 'tail', pos: pt(isFighter ? -4.8 : -4.4, 2.75, 0), half: [1.1, 1.25, 0.22], mat: 'steelDark', color: 0x4d5661, hp: 120, tier: 0, anchored: false, kind: 'tower', yaw, materialClass: 'metal' },
    { id: 'jp8_tank', pos: pt(1.2, 1.1, 0), half: [1.3, 0.65, 0.95], mat: 'paintRed', color: 0xb83022, hp: 90, tier: 0, anchored: false, kind: 'hazard', yaw, hazardRadius: 12, hazardDamage: 280, keyNode: true, materialClass: 'metal' },
  ];
  return {
    id,
    tag: id,
    kind: isFighter ? 'parkedFighter' : 'parkedChopper',
    label: name,
    value: isFighter ? 240_000 : 210_000,
    nodes,
    links: [['fuselage', 'wings'], ['fuselage', 'tail'], ['fuselage', 'jp8_tank']],
    collapseThreshold: 0.45,
  };
}

function authorArmoryAndAirfield(k: Kit, spec: MapSpec): void {
  const g = k.geo;

  // --- West Sector: Tank Armory Depot + 6 Parked Tanks/APCs ---
  spec.cluster(buildTankArmoryDepotCluster());
  const [dx, , dz] = HALCYON_TANK_DEPOT_POS;
  spec.plan?.blocks.push({ x0: dx - 20, z0: dz - 14, x1: dx + 20, z1: dz + 14 });
  spec.breakable('generator', dx + 22, 0, dz - 8, 0);
  spec.barrels(dx + 22, 0, dz + 6, 3);
  floorStencil(k, 'ARMOURY', dx + 24, dz + 18, Math.PI, 2.6, [0.92, 0.78, 0.22], 0.036);
  k.light(dx, 14, dz + 18, HALCYON_PALETTE.floodCold, 48, 42);
  k.light(-92, 12, 36, HALCYON_PALETTE.floodAmber, 44, 38);

  for (const armor of HALCYON_PARKED_ARMOR) {
    const [ax, , az] = armor.pos;
    // Low concrete revetment curb markings around each bay
    g.use('concreteDark').tint(0.36, 0.39, 0.43);
    g.box(ax - 5.2, 0.55, az, 0.45, 0.55, 4.4);
    g.box(ax + 5.2, 0.55, az, 0.45, 0.55, 4.4);
    g.box(ax, 0.55, az - 4.4, 5.4, 0.55, 0.45);
    g.tint(1);
    spec.cluster(buildParkedArmorCluster(armor.id, armor.name, armor.variant, ax, az, armor.yaw));
    spec.plan?.blocks.push({ x0: ax - 5, z0: az - 4, x1: ax + 5, z1: az + 4 });
  }
  // Explosive fuel drums scattered along the motor pool bays for chain blasts
  spec.barrels(-103, 0, 35, 3);
  spec.barrels(-85, 0, 35, 3);

  // --- East Sector: 2 Hardened Aircraft Hangars + 6 Parked Fighters/Choppers ---
  for (const hangar of HALCYON_HANGARS) {
    const [hx, , hz] = hangar.pos;
    spec.cluster(buildHangarCluster(hangar.id, hangar.name, hx, hz));
    spec.plan?.blocks.push({ x0: hx - 15, z0: hz - 12, x1: hx + 15, z1: hz + 12 });
    k.light(hx - 18, 13, hz, HALCYON_PALETTE.floodCold, 48, 42);
  }

  for (const ac of HALCYON_PARKED_AIRCRAFT) {
    const [ax, , az] = ac.pos;
    // Painted yellow aircraft revetment parking outline on tarmac
    drawHazardBorder(k, ax - 6.2, az - 5.8, ax + 6.2, az + 5.8, 0.034, 0.22);
    spec.cluster(buildParkedAircraftCluster(ac.id, ac.name, ac.variant, ax, az, ac.yaw));
    spec.plan?.blocks.push({ x0: ax - 5.5, z0: az - 5, x1: ax + 5.5, z1: az + 5 });
  }

  // Volatile JP-8 fuel bowsers & gaslines bridging the parked flight line for huge chain blasts!
  for (const [fx, fz] of [[62, -16], [62, 0], [62, 16], [62, 32], [82, 48]] as const) {
    spec.tank(fx, 0, fz);
    spec.breakable('gasline', fx + 3.2, 0, fz, 0);
  }
  spec.barrels(80, 0, -14, 3);
  spec.barrels(80, 0, 30, 3);
}

// ---------------------------------------------------------------------------
// Stage 5: NW Fuel/Ammo Depot, NE Barracks Complex & Center Citadel Command HQ
// ---------------------------------------------------------------------------

function buildFuelSiloCluster(id: string, name: string, x: number, z: number): StructuralClusterSpec {
  const nodes: StructuralNodeSpec[] = [
    { id: 'plinth', pos: [x, 0.65, z], half: [5.4, 0.65, 5.4], mat: 'concreteDark', color: 0x454b52, hp: 320, tier: 1, anchored: true, kind: 'slab', materialClass: 'concrete' },
    { id: 'silo_core', pos: [x, 5.4, z], half: [4.6, 4.1, 4.6], mat: 'paintWhite', color: 0xd9dde0, hp: 180, tier: 1, anchored: false, kind: 'hazard', hazardRadius: 19, hazardDamage: 440, keyNode: true, materialClass: 'metal' },
    { id: 'silo_dome', pos: [x, 10.35, z], half: [4.2, 0.85, 4.2], mat: 'paintRed', color: 0xc22e22, hp: 140, tier: 0, anchored: false, kind: 'roof', impactRadius: 11, impactDamage: 240, materialClass: 'metal' },
  ];
  return {
    id,
    tag: id,
    kind: 'fuelSilo',
    label: name,
    value: 200_000,
    nodes,
    links: [['plinth', 'silo_core'], ['silo_core', 'silo_dome']],
    collapseThreshold: 0.45,
  };
}

function buildAmmoBunkerCluster(id: string, name: string, x: number, z: number): StructuralClusterSpec {
  const H = 4.6;
  const W = 6.2;
  const D = 5.4;
  const nodes: StructuralNodeSpec[] = [
    { id: 'wall_n', pos: [x, H / 2, z - D], half: [W, H / 2, 0.75], mat: 'concrete', color: 0x626a72, hp: 420, tier: 2, anchored: true, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    { id: 'wall_w', pos: [x - W, H / 2, z], half: [0.75, H / 2, D], mat: 'concrete', color: 0x626a72, hp: 420, tier: 2, anchored: true, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    { id: 'wall_e', pos: [x + W, H / 2, z], half: [0.75, H / 2, D], mat: 'concrete', color: 0x626a72, hp: 420, tier: 2, anchored: true, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    { id: 'blast_door', pos: [x, H / 2 - 0.2, z + D], half: [3.2, H / 2 - 0.2, 0.45], mat: 'steelDark', color: 0x3b434b, hp: 280, tier: 1, anchored: true, kind: 'wall', materialClass: 'metal' },
    { id: 'vault_roof', pos: [x, H + 0.75, z], half: [W + 0.9, 0.75, D + 0.9], mat: 'concreteDark', color: 0x4b535c, hp: 440, tier: 2, anchored: false, kind: 'roof', impactRadius: 12, impactDamage: 300, materialClass: 'concrete' },
    { id: 'ordnance_stack', pos: [x, 1.5, z], half: [2.4, 1.5, 2.2], mat: 'hazard', color: 0xd04024, hp: 160, tier: 1, anchored: true, kind: 'hazard', hazardRadius: 18, hazardDamage: 460, keyNode: true, materialClass: 'metal' },
  ];
  return {
    id,
    tag: id,
    kind: 'ammoBunker',
    label: name,
    value: 320_000,
    nodes,
    links: [
      ['wall_n', 'vault_roof'], ['wall_w', 'vault_roof'], ['wall_e', 'vault_roof'], ['blast_door', 'vault_roof'],
    ],
    collapseThreshold: 0.45,
  };
}

function buildBarracksCluster(id: string, name: string, variant: string, cx: number, cz: number): StructuralClusterSpec {
  const isThree = variant === 'three_story';
  const W = isThree ? 14.5 : 11.2;
  const D = isThree ? 6.8 : 6.4;
  const F1 = 3.8;
  const F2 = isThree ? 7.6 : 7.4;
  const roofY = isThree ? 11.2 : 7.8;

  const nodes: StructuralNodeSpec[] = [
    // Ground-floor load-bearing walls (Tier 1 masonry/concrete)
    { id: 'l1_n', pos: [cx, F1 / 2, cz - D], half: [W, F1 / 2, 0.55], mat: 'concrete', color: 0x6f767e, hp: 320, tier: 1, anchored: true, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    { id: 'l1_s', pos: [cx, F1 / 2, cz + D], half: [W, F1 / 2, 0.55], mat: 'concrete', color: 0x6f767e, hp: 320, tier: 1, anchored: true, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    { id: 'l1_w', pos: [cx - W, F1 / 2, cz], half: [0.55, F1 / 2, D], mat: 'concreteDark', color: 0x5c646d, hp: 320, tier: 1, anchored: true, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    { id: 'l1_e', pos: [cx + W, F1 / 2, cz], half: [0.55, F1 / 2, D], mat: 'concreteDark', color: 0x5c646d, hp: 320, tier: 1, anchored: true, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    // 2nd-floor concrete deck slab (crashes down onto L1 squads when ground walls break!)
    { id: 'slab_2', pos: [cx, F1 + 0.3, cz], half: [W + 0.5, 0.3, D + 0.5], mat: 'concreteDark', color: 0x4e565f, hp: 360, tier: 1, anchored: false, kind: 'slab', impactRadius: 11, impactDamage: 260, materialClass: 'concrete' },
    // Upper-story walls
    { id: 'l2_n', pos: [cx, (F1 + roofY) / 2, cz - D], half: [W, (roofY - F1) / 2, 0.5], mat: 'concrete', color: 0x7b838c, hp: 280, tier: 1, anchored: false, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    { id: 'l2_s', pos: [cx, (F1 + roofY) / 2, cz + D], half: [W, (roofY - F1) / 2, 0.5], mat: 'concrete', color: 0x7b838c, hp: 280, tier: 1, anchored: false, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    { id: 'l2_w', pos: [cx - W, (F1 + roofY) / 2, cz], half: [0.5, (roofY - F1) / 2, D], mat: 'concreteDark', color: 0x676f78, hp: 280, tier: 1, anchored: false, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    { id: 'l2_e', pos: [cx + W, (F1 + roofY) / 2, cz], half: [0.5, (roofY - F1) / 2, D], mat: 'concreteDark', color: 0x676f78, hp: 280, tier: 1, anchored: false, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    // Heavy flat concrete barracks roof slab
    { id: 'roof', pos: [cx, roofY + 0.35, cz], half: [W + 0.8, 0.35, D + 0.8], mat: 'steelDark', color: 0x3f4750, hp: 300, tier: 1, anchored: false, kind: 'roof', impactRadius: 12, impactDamage: 300, materialClass: 'concrete' },
    // Boiler & backup power transformer hazard beside building
    { id: 'boiler', pos: [cx, F2 * 0.18, cz], half: [1.6, 1.2, 1.4], mat: 'paintRed', color: 0xb03022, hp: 130, tier: 0, anchored: true, kind: 'hazard', hazardRadius: 12, hazardDamage: 280, materialClass: 'metal' },
  ];

  const links: [string, string][] = [
    ['l1_n', 'slab_2'], ['l1_s', 'slab_2'], ['l1_w', 'slab_2'], ['l1_e', 'slab_2'],
    ['slab_2', 'l2_n'], ['slab_2', 'l2_s'], ['slab_2', 'l2_w'], ['slab_2', 'l2_e'],
    ['l2_n', 'roof'], ['l2_s', 'roof'], ['l2_w', 'roof'], ['l2_e', 'roof'],
  ];

  return {
    id,
    tag: id,
    kind: 'militaryBarracks',
    label: name,
    value: isThree ? 620_000 : 450_000,
    nodes,
    links,
    collapseThreshold: 0.5,
  };
}

/**
 * Massive 3-Tier Reinforced Concrete Command HQ Fortress at `(0, 0, -30)`.
 * Outer battered buttress piers are Tier 3 Reinforced Concrete so heavy bombing runs /
 * Thermobaric strikes bring all 3 tiers and the 28.5 m comms spire crashing down into rubble!
 */
function buildCitadelHqCluster(): StructuralClusterSpec {
  const [cx, , cz] = HALCYON_CITADEL_HQ_POS; // (0, 0, -30)
  const T1H = 7.6;
  const T2H = 7.0; // y = 7.6 .. 14.6
  const W1 = 18.0;
  const D1 = 15.5;
  const W2 = 12.6;
  const D2 = 10.8;

  const nodes: StructuralNodeSpec[] = [
    // --- Tier 1: Ground Fortress Base (y = 0..7.6) ---
    // 8 massive Tier-3 Reinforced Concrete outer buttress columns
    { id: 'but_nw', pos: [cx - W1, T1H / 2, cz - D1], half: [1.6, T1H / 2, 1.6], mat: 'concreteDark', color: 0x454c54, hp: 760, tier: 3, anchored: true, kind: 'column', materialClass: 'concrete' },
    { id: 'but_ne', pos: [cx + W1, T1H / 2, cz - D1], half: [1.6, T1H / 2, 1.6], mat: 'concreteDark', color: 0x454c54, hp: 760, tier: 3, anchored: true, kind: 'column', materialClass: 'concrete' },
    { id: 'but_sw', pos: [cx - W1, T1H / 2, cz + D1], half: [1.6, T1H / 2, 1.6], mat: 'concreteDark', color: 0x454c54, hp: 760, tier: 3, anchored: true, kind: 'column', materialClass: 'concrete' },
    { id: 'but_se', pos: [cx + W1, T1H / 2, cz + D1], half: [1.6, T1H / 2, 1.6], mat: 'concreteDark', color: 0x454c54, hp: 760, tier: 3, anchored: true, kind: 'column', materialClass: 'concrete' },
    { id: 'but_mnw', pos: [cx - 6.8, T1H / 2, cz - D1], half: [1.3, T1H / 2, 1.4], mat: 'concreteDark', color: 0x4b535c, hp: 700, tier: 3, anchored: true, kind: 'column', materialClass: 'concrete' },
    { id: 'but_mne', pos: [cx + 6.8, T1H / 2, cz - D1], half: [1.3, T1H / 2, 1.4], mat: 'concreteDark', color: 0x4b535c, hp: 700, tier: 3, anchored: true, kind: 'column', materialClass: 'concrete' },
    { id: 'but_msw', pos: [cx - 6.8, T1H / 2, cz + D1], half: [1.3, T1H / 2, 1.4], mat: 'concreteDark', color: 0x4b535c, hp: 700, tier: 3, anchored: true, kind: 'column', materialClass: 'concrete' },
    { id: 'but_mse', pos: [cx + 6.8, T1H / 2, cz + D1], half: [1.3, T1H / 2, 1.4], mat: 'concreteDark', color: 0x4b535c, hp: 700, tier: 3, anchored: true, kind: 'column', materialClass: 'concrete' },
    // 4 thick Tier-2 armored ground blast curtain walls
    { id: 't1_n', pos: [cx, T1H / 2, cz - D1 + 0.5], half: [W1 - 1.5, T1H / 2, 1.0], mat: 'concrete', color: 0x5c646e, hp: 540, tier: 2, anchored: true, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    { id: 't1_s', pos: [cx, T1H / 2, cz + D1 - 0.5], half: [W1 - 1.5, T1H / 2, 1.0], mat: 'concrete', color: 0x5c646e, hp: 540, tier: 2, anchored: true, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    { id: 't1_w', pos: [cx - W1 + 0.5, T1H / 2, cz], half: [1.0, T1H / 2, D1 - 1.5], mat: 'concrete', color: 0x5c646e, hp: 540, tier: 2, anchored: true, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    { id: 't1_e', pos: [cx + W1 - 0.5, T1H / 2, cz], half: [1.0, T1H / 2, D1 - 1.5], mat: 'concrete', color: 0x5c646e, hp: 540, tier: 2, anchored: true, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    // Internal War-Room Command Reactor / Munitions Vault
    { id: 'core_vault', pos: [cx, 2.6, cz], half: [3.8, 2.6, 3.4], mat: 'emissiveOrange', color: 0xe66824, hp: 380, tier: 2, anchored: true, kind: 'hazard', hazardRadius: 22, hazardDamage: 540, materialClass: 'metal' },
    // Massive Tier-1->Tier-2 Reinforced Command Deck Slab
    { id: 'deck_t2', pos: [cx, T1H + 0.55, cz], half: [W1 + 1.2, 0.55, D1 + 1.2], mat: 'concreteDark', color: 0x454d56, hp: 640, tier: 2, anchored: false, kind: 'slab', impactRadius: 16, impactDamage: 380, materialClass: 'concrete' },

    // --- Tier 2: Blast-Shielded Command Deck (y = 8.15..15.15) ---
    { id: 't2_n', pos: [cx, T1H + 0.55 + T2H / 2, cz - D2], half: [W2, T2H / 2, 0.95], mat: 'steelDark', color: 0x3b444e, hp: 460, tier: 2, anchored: false, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    { id: 't2_s', pos: [cx, T1H + 0.55 + T2H / 2, cz + D2], half: [W2, T2H / 2, 0.95], mat: 'steelDark', color: 0x3b444e, hp: 460, tier: 2, anchored: false, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    { id: 't2_w', pos: [cx - W2, T1H + 0.55 + T2H / 2, cz], half: [0.95, T2H / 2, D2], mat: 'steelDark', color: 0x3b444e, hp: 460, tier: 2, anchored: false, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    { id: 't2_e', pos: [cx + W2, T1H + 0.55 + T2H / 2, cz], half: [0.95, T2H / 2, D2], mat: 'steelDark', color: 0x3b444e, hp: 460, tier: 2, anchored: false, kind: 'wall', materialClass: 'concrete', fractureGrid: [2, 2] },
    // Central Tier-3 Reinforced Core Piers supporting the Rooftop Helipad
    { id: 'core_col_w', pos: [cx - 4.4, T1H + 0.55 + T2H / 2, cz], half: [1.3, T2H / 2, 2.2], mat: 'concreteDark', color: 0x3d444c, hp: 680, tier: 3, anchored: false, kind: 'column', materialClass: 'concrete' },
    { id: 'core_col_e', pos: [cx + 4.4, T1H + 0.55 + T2H / 2, cz], half: [1.3, T2H / 2, 2.2], mat: 'concreteDark', color: 0x3d444c, hp: 680, tier: 3, anchored: false, kind: 'column', materialClass: 'concrete' },
    // Heavy Rooftop Helipad & Blast Roof Slab (y = 15.6)
    { id: 'helipad_roof', pos: [cx, T1H + 0.55 + T2H + 0.55, cz], half: [W2 + 1.4, 0.55, D2 + 1.4], mat: 'asphalt', color: 0x343a42, hp: 520, tier: 2, anchored: false, kind: 'roof', impactRadius: 17, impactDamage: 420, materialClass: 'concrete' },

    // --- Tier 3: Rooftop Comms Bunkers, Capacitor & 28.5 m Spire ---
    { id: 'comms_w', pos: [cx - 8.4, 17.6, cz - 5.5], half: [2.6, 1.5, 2.8], mat: 'steel', color: 0x525c68, hp: 280, tier: 1, anchored: false, kind: 'wall', materialClass: 'metal' },
    { id: 'comms_e', pos: [cx + 8.4, 17.6, cz - 5.5], half: [2.6, 1.5, 2.8], mat: 'steel', color: 0x525c68, hp: 280, tier: 1, anchored: false, kind: 'wall', materialClass: 'metal' },
    { id: 'comms_spire', pos: [cx, 22.4, cz - 6.2], half: [1.2, 6.2, 1.2], mat: 'steelDark', color: 0x46505c, hp: 260, tier: 1, anchored: false, kind: 'tower', impactRadius: 13, impactDamage: 320, materialClass: 'metal' },
    { id: 'roof_capacitor', pos: [cx, 17.3, cz + 6.4], half: [2.2, 1.15, 1.8], mat: 'paintRed', color: 0xc42e20, hp: 180, tier: 1, anchored: false, kind: 'hazard', hazardRadius: 15, hazardDamage: 360, materialClass: 'metal' },
  ];

  const links: [string, string][] = [
    // Tier 1 supports Deck T2
    ['but_nw', 'deck_t2'], ['but_ne', 'deck_t2'], ['but_sw', 'deck_t2'], ['but_se', 'deck_t2'],
    ['but_mnw', 'deck_t2'], ['but_mne', 'deck_t2'], ['but_msw', 'deck_t2'], ['but_mse', 'deck_t2'],
    ['t1_n', 'deck_t2'], ['t1_s', 'deck_t2'], ['t1_w', 'deck_t2'], ['t1_e', 'deck_t2'],
    // Deck T2 supports Tier 2 walls & core piers
    ['deck_t2', 't2_n'], ['deck_t2', 't2_s'], ['deck_t2', 't2_w'], ['deck_t2', 't2_e'],
    ['deck_t2', 'core_col_w'], ['deck_t2', 'core_col_e'],
    // Tier 2 supports Rooftop Helipad Slab
    ['t2_n', 'helipad_roof'], ['t2_s', 'helipad_roof'], ['t2_w', 'helipad_roof'], ['t2_e', 'helipad_roof'],
    ['core_col_w', 'helipad_roof'], ['core_col_e', 'helipad_roof'],
    // Helipad supports Tier 3 Comms Array & Spire
    ['helipad_roof', 'comms_w'], ['helipad_roof', 'comms_e'], ['helipad_roof', 'comms_spire'], ['helipad_roof', 'roof_capacitor'],
  ];

  return {
    id: 'halcyon.citadel.hq',
    tag: 'halcyon.citadel.hq',
    kind: 'citadelCommandHq',
    label: 'FORTRESS HALCYON COMMAND HQ',
    value: 2_500_000,
    nodes,
    links,
    collapseThreshold: 0.52,
  };
}

function authorNorthAndCitadel(k: Kit, spec: MapSpec): void {
  const g = k.geo;

  // --- NW Sector: 6 Chain-Exploding Fuel Silos & 3 Blast-Bermed Ammo Bunkers ---
  for (const silo of HALCYON_FUEL_SILOS) {
    const [sx, , sz] = silo.pos;
    spec.cluster(buildFuelSiloCluster(silo.id, silo.name, sx, sz));
    spec.plan?.blocks.push({ x0: sx - 5.5, z0: sz - 5.5, x1: sx + 5.5, z1: sz + 5.5 });
  }
  // Overhead steel fuel manifolds + explosive gaslines/tanks linking the 6 silos for chain infernos!
  pipe(k, [-102, 4.2, -60, -82, 4.2, -60, -62, 4.2, -60], 0.32, 'steelDark', 6, 6, false);
  pipe(k, [-102, 4.2, -76, -82, 4.2, -76, -62, 4.2, -76], 0.32, 'steelDark', 6, 6, false);
  for (const [gx, gz] of [
    [-92, -60], [-72, -60], [-92, -76], [-72, -76], [-102, -68], [-82, -68], [-62, -68],
  ] as const) {
    spec.breakable('gasline', gx, 0, gz, 0);
    spec.tank(gx, 0, gz + 2.4);
  }
  k.light(-82, 13, -68, HALCYON_PALETTE.floodAmber, 48, 42);

  for (const bunker of HALCYON_AMMO_BUNKERS) {
    const [bx, , bz] = bunker.pos;
    // Low concrete blast-berm side cheeks
    g.use('concreteDark').tint(0.36, 0.39, 0.42);
    g.box(bx - 7.8, 1.1, bz, 0.65, 1.1, 6.2);
    g.box(bx + 7.8, 1.1, bz, 0.65, 1.1, 6.2);
    g.tint(1);
    spec.cluster(buildAmmoBunkerCluster(bunker.id, bunker.name, bx, bz));
    spec.barrels(bx, 0, bz + 7.4, 3);
    spec.plan?.blocks.push({ x0: bx - 7, z0: bz - 6, x1: bx + 7, z1: bz + 6 });
  }
  k.light(-76, 11, -110, HALCYON_PALETTE.floodAmber, 44, 38);

  // --- NE Sector: 3 Multi-Story Military Barracks Blocks & Motor Yard ---
  for (const bar of HALCYON_BARRACKS) {
    const [bx, , bz] = bar.pos;
    spec.cluster(buildBarracksCluster(bar.id, bar.name, bar.variant, bx, bz));
    spec.plan?.blocks.push({ x0: bx - 12, z0: bz - 7, x1: bx + 12, z1: bz + 7 });
  }
  // NE Motor Yard military trucks, generator & floodlights
  truck(k, 76, 0, -84, 0.15, 0);
  truck(k, 92, 0, -88, -0.1, 0);
  spec.barrels(84, 0, -92, 3);
  spec.breakable('generator', 68, 0, -84, 0);
  k.light(84, 14, -84, HALCYON_PALETTE.floodCold, 48, 42);
  k.light(84, 14, -108, HALCYON_PALETTE.floodCold, 44, 38);

  // --- Center Citadel: Fortress Halcyon Command HQ & Plaza Floodlight Ring ---
  spec.cluster(buildCitadelHqCluster());
  const [hqx, , hqz] = HALCYON_CITADEL_HQ_POS;
  spec.plan?.blocks.push({ x0: hqx - 19, z0: hqz - 16, x1: hqx + 19, z1: hqz + 16 });

  // 4 Towering Citadel Plaza Corner Floodlight Masts
  drawFloodlightMast(k, -30, -60, 14.5, -Math.PI * 0.25, HALCYON_PALETTE.floodCold, 52);
  drawFloodlightMast(k, 30, -60, 14.5, Math.PI * 0.25, HALCYON_PALETTE.floodCold, 52);
  drawFloodlightMast(k, -30, 2, 14.5, -Math.PI * 0.75, HALCYON_PALETTE.floodCold, 52);
  drawFloodlightMast(k, 30, 2, 14.5, Math.PI * 0.75, HALCYON_PALETTE.floodCold, 52);

  // Tactical warning signage & explosive backup generators flanking the Citadel HQ
  spec.breakable('generator', -24, 0, -30, Math.PI / 2);
  spec.breakable('generator', 24, 0, -30, -Math.PI / 2);
  spec.barrels(-22, 0, -10, 3);
  spec.barrels(22, 0, -10, 3);

  k.push(0, 0, 5.2, 0);
  stencil(k, 'NO ENTRY', 0, 1.4, 0, 0.7, [0.92, 0.28, 0.20]);
  k.pop();
}

// ---------------------------------------------------------------------------
// Ordered Build Stages (used by World loading progress bar & standalone authorHalcyon)
// ---------------------------------------------------------------------------

export const HALCYON_STAGES = [
  {
    label: 'Charting Fortress Halcyon terrain & coastal plateau',
    run: (k: Kit, spec: MapSpec) => {
      start(spec);
      authorTerrainAndRoads(k, spec);
      STAGES_BUILT.add(spec);
    },
  },
  {
    label: 'Raising the fortified perimeter blast walls & watchtowers',
    run: authorPerimeterAndTowers,
  },
  {
    label: 'Deploying SAM pads, flak bastions, radar domes & mortar trenches',
    run: authorDefenseSites,
  },
  {
    label: 'Constructing West Tank Armory & East Hardened Airfield',
    run: authorArmoryAndAirfield,
  },
  {
    label: 'Stocking NW Fuel/Ammo Depot, NE Barracks & Center Citadel HQ',
    run: authorNorthAndCitadel,
  },
] as const;

// ---------------------------------------------------------------------------
// Zones, Spawns, Pickups & Tactical Camera Views
// ---------------------------------------------------------------------------

function zones(spec: MapSpec): void {
  const sky = HALCYON_BOUNDS.y1;
  const d = HALCYON_DISTRICTS;
  // Tightest / most specific zones first so `zoneAt` always matches cleanly
  spec.zone(d.citadel.id, d.citadel.name, d.citadel.x0, -2, d.citadel.z0, d.citadel.x1, 48, d.citadel.z1);
  spec.zone(d.tankArmory.id, d.tankArmory.name, d.tankArmory.x0, -2, d.tankArmory.z0, d.tankArmory.x1, 36, d.tankArmory.z1);
  spec.zone(d.airfield.id, d.airfield.name, d.airfield.x0, -2, d.airfield.z0, d.airfield.x1, 36, d.airfield.z1);
  spec.zone(d.fuelAmmo.id, d.fuelAmmo.name, d.fuelAmmo.x0, -2, d.fuelAmmo.z0, d.fuelAmmo.x1, 36, d.fuelAmmo.z1);
  spec.zone(d.barracks.id, d.barracks.name, d.barracks.x0, -2, d.barracks.z0, d.barracks.x1, 36, d.barracks.z1);
  spec.zone(d.northRidge.id, d.northRidge.name, d.northRidge.x0, -2, d.northRidge.z0, d.northRidge.x1, 42, d.northRidge.z1);
  spec.zone(d.southTrenches.id, d.southTrenches.name, d.southTrenches.x0, -2, d.southTrenches.z0, d.southTrenches.x1, 32, d.southTrenches.z1);
  spec.zone(d.perimeter.id, d.perimeter.name, d.perimeter.x0, -2, d.perimeter.z0, d.perimeter.x1, 30, d.perimeter.z1);
  spec.zone(d.beachhead.id, d.beachhead.name, d.beachhead.x0, -2, d.beachhead.z0, d.beachhead.x1, 40, d.beachhead.z1);
  spec.zone(
    'halcyon-airspace',
    'FORTRESS HALCYON AIRSPACE',
    HALCYON_BOUNDS.x0,
    HALCYON_BOUNDS.y0,
    HALCYON_BOUNDS.z0,
    HALCYON_BOUNDS.x1,
    sky,
    HALCYON_BOUNDS.z1,
  );
}

function spawns(spec: MapSpec): void {
  const groundSpawns: SpawnPoint[] = HALCYON_GROUND_SPAWNS.map(s => ({
    position: new THREE.Vector3(s.pos[0], s.pos[1] + 0.1, s.pos[2]),
    zone: s.zone,
    kind: 'ground',
  }));
  const airSpawns: SpawnPoint[] = HALCYON_SKY_SPAWNS.map(([x, y, z]) => ({
    position: new THREE.Vector3(x, y, z),
    zone: 'halcyon-airspace',
    kind: 'air',
  }));

  spec.spawns = [...groundSpawns, ...airSpawns];
  for (const s of groundSpawns) spec.gate(s.zone, s.position.x, s.position.y, s.position.z);
  for (const [x, y, z] of HALCYON_PICKUP_SPOTS) spec.pickup(x, y, z);

  spec.playerSpawns.push(
    { position: new THREE.Vector3(HALCYON_PLAYER_SPAWN[0], HALCYON_PLAYER_SPAWN[1] + 0.1, HALCYON_PLAYER_SPAWN[2]), yaw: HALCYON_PLAYER_YAW },
    { position: new THREE.Vector3(-78, 0.1, 152), yaw: 0 },
    { position: new THREE.Vector3(78, 0.1, 152), yaw: 0 },
    { position: new THREE.Vector3(0, 0.1, 18), yaw: 0 },
  );
}

function views(spec: MapSpec): void {
  spec.view('overview', 165, 118, 225, 0, 8, -10);
  spec.view('bomberPass', 0, 125, 290, 0, 6, -30);
  spec.view('beachhead', 0, 24, 174, 0, 5, 86);
  spec.view('sectionB', -34, 16, 132, 0, 4, 96);
  spec.view('armory', -42, 26, 68, -90, 5, 6);
  spec.view('airfield', 44, 28, 72, 92, 6, 8);
  spec.view('fuelDepot', -38, 32, -32, -82, 6, -78);
  spec.view('barracks', 38, 28, -32, 84, 6, -82);
  spec.view('citadel', 48, 36, 34, 0, 12, -30);
}

/**
 * Finalizes Fortress Halcyon zones, spawns, pickups, and tactical views.
 * Safely executes `HALCYON_STAGES` when called standalone without running stages first.
 */
export function authorHalcyon(k: Kit, spec: MapSpec): void {
  if (!STAGES_BUILT.has(spec)) {
    for (const stage of HALCYON_STAGES) {
      stage.run(k, spec);
    }
  }
  zones(spec);
  spawns(spec);
  views(spec);
}
