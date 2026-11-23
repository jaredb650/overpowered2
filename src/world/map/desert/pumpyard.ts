/**
 * Surplus — The Pump Yard (z = -14 .. -56) & Extended 50 m Multi-Chamber Dark Storm Sewer (y = -5.5).
 *
 * Surface Industrial Pump Yard (y = 0):
 *   - 4 colossal solid steel water cistern tanks flanking the yard (iconic solid landmarks).
 *   - Elevated industrial steel pipelines linking tanks overhead.
 *   - Clean flush concrete foundation pad at PUMP_YARD.towerBase ([0, 0, -40]) for collapsing Water Tower.
 *   - Solid North Dividing Wall at z = -56 with an open 16 m central street arch (x = -8..+8, h = 6.2 m).
 *   - Tier-0 destructible Pump Control Shack (`materialClass: 'metal'` / `'wood'`), 3 checkpoints, 2 isolated drums.
 *
 * Extended Vaulted Dark Storm Sewer (y = -5.5, ceiling y = -1.2, z = -28 .. -81):
 *   - South Entry Sump Chamber (`z = -25.5..-38.0`) with broken iron drop grate, wall ladder & sloping ramp
 *     descending east from PUMP_YARD.sewerDropPos ([-14, 0, -28]) down to (-2.5, -5.5, -28).
 *   - Central Cistern Ambush Gallery (`z = -38.0..-64.0`, width 14 m!) with 6 concrete support pillars,
 *     twin drainage sluice alcoves, iron catwalk grates, and waist-high cover baffles for a 10-man dark
 *     Thermal-Vision firefight!
 *   - North Conduit & Exit Shaft (`z = -64.0..-83.0`) containing PUMP_YARD.sewerExitBottom ([0, -5.5, -78])
 *     with a wide steel-grate exit ramp + vertical wall ladder climbing cleanly up to
 *     HIGH_TERRACES.sewerExitTop ([0, 0, -81]).
 *   - Genuinely dark & moody (only 4 dim red/amber safety bulbs + red guide strips) so Thermal Vision (`T`) shines!
 */
import type { StructuralClusterSpec } from '../../destruction';
import { FACE } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { machine, pipe, tank } from '../../kit/props';
import type { MapSpec } from '../spec';
import { DESERT_PALETTE, SEWER_DROP_PIT, SEWER_EXIT_PIT } from './dunes';
import { DESERT_Z, PUMP_YARD } from './plan';

const SEWER_Y = PUMP_YARD.sewerFloorY; // -5.5
const SEWER_CEIL = -1.2; // vaulted dark ceiling underside (ground slab underside is -0.8)
const WALL_NORTH_Z = DESERT_Z.pumpNorthGate; // -56

/** Builds the Tier-0 destructible Pump Control Shack at (20, 0, -36). */
function buildPumpControlShackCluster(): StructuralClusterSpec {
  const x = 20;
  const z = -36;
  const hw = 2.8;
  const hd = 2.2;
  const H = 3.2;

  return {
    id: 'pumpyard.controlShack',
    tag: 'pumpyard.controlShack',
    kind: 'pumpControlShack',
    label: 'PUMP CONTROL SHACK',
    value: 52_000,
    nodes: [
      { id: 'col_sw', pos: [x - hw, H / 2, z + hd], half: [0.18, H / 2, 0.18], mat: 'steelDark', hp: 145, tier: 0, anchored: true, kind: 'column', materialClass: 'metal' },
      { id: 'col_se', pos: [x + hw, H / 2, z + hd], half: [0.18, H / 2, 0.18], mat: 'steelDark', hp: 145, tier: 0, anchored: true, kind: 'column', materialClass: 'metal' },
      { id: 'col_nw', pos: [x - hw, H / 2, z - hd], half: [0.18, H / 2, 0.18], mat: 'steelDark', hp: 145, tier: 0, anchored: true, kind: 'column', materialClass: 'metal' },
      { id: 'col_ne', pos: [x + hw, H / 2, z - hd], half: [0.18, H / 2, 0.18], mat: 'steelDark', hp: 145, tier: 0, anchored: true, kind: 'column', materialClass: 'metal' },
      { id: 'wall_n', pos: [x, H / 2, z - hd], half: [hw - 0.2, H / 2, 0.14], mat: 'panel', color: 0x6e7b7e, hp: 165, tier: 0, anchored: true, kind: 'wall', materialClass: 'metal', fractureGrid: [2, 2] },
      { id: 'wall_s', pos: [x, H / 2, z + hd], half: [hw - 0.2, H / 2, 0.14], mat: 'panel', color: 0x6e7b7e, hp: 165, tier: 0, anchored: true, kind: 'wall', materialClass: 'metal', fractureGrid: [2, 2] },
      { id: 'wall_e', pos: [x + hw, H / 2, z], half: [0.14, H / 2, hd - 0.2], mat: 'rust', color: 0x84543c, hp: 165, tier: 0, anchored: true, kind: 'wall', materialClass: 'metal', fractureGrid: [2, 2] },
      { id: 'roof', pos: [x, H + 0.12, z], half: [hw + 0.3, 0.12, hd + 0.3], mat: 'rust', color: 0x764c34, hp: 155, tier: 0, anchored: false, kind: 'roof', impactRadius: 7, materialClass: 'metal', fractureGrid: [2, 2] },
      { id: 'pump_drum', pos: [x + 1.0, 0.56, z - 0.4], half: [0.42, 0.56, 0.42], mat: 'paintRed', color: 0xcc2820, hp: 38, tier: 0, anchored: true, kind: 'hazard', hazardRadius: 7.5, hazardDamage: 210, materialClass: 'metal' },
    ],
    links: [
      ['col_sw', 'roof'],
      ['col_se', 'roof'],
      ['col_nw', 'roof'],
      ['col_ne', 'roof'],
      ['wall_n', 'roof'],
      ['wall_s', 'roof'],
      ['wall_e', 'roof'],
    ],
    collapseThreshold: 0.45,
  };
}

/** Builds a Tier-0 industrial sandbag checkpoint in the Pump Yard. */
function buildPumpCheckpointCluster(idx: number, x: number, z: number, yaw: number, withDrum: boolean): StructuralClusterSpec {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const pt = (lx: number, ly: number, lz: number): [number, number, number] => [
    x + lx * c + lz * s,
    ly,
    z - lx * s + lz * c,
  ];
  const nodes: StructuralClusterSpec['nodes'] = [
    { id: 'bags_main', pos: pt(0, 0.62, 0), half: [2.2, 0.62, 0.42], mat: 'dirt', color: 0x9b8660, hp: 140, tier: 0, anchored: true, kind: 'wall', yaw, materialClass: 'stone' },
    { id: 'shield_side', pos: pt(-2.1, 0.85, -0.7), half: [0.32, 0.85, 0.85], mat: 'rust', color: 0x82543c, hp: 145, tier: 0, anchored: true, kind: 'wall', yaw, materialClass: 'metal' },
    ...(withDrum
      ? [{ id: 'drum', pos: pt(1.9, 0.56, -0.45), half: [0.4, 0.56, 0.4] as readonly [number, number, number], mat: 'paintRed' as const, color: 0xcc2820, hp: 38, tier: 0 as const, anchored: true, kind: 'hazard' as const, yaw, hazardRadius: 7.5, hazardDamage: 200, materialClass: 'metal' as const }]
      : [{ id: 'crate_side', pos: pt(1.8, 0.54, -0.45), half: [0.55, 0.54, 0.55] as readonly [number, number, number], mat: 'plywood' as const, color: 0x8a6640, hp: 115, tier: 0 as const, anchored: true, kind: 'wall' as const, yaw, materialClass: 'wood' as const }]),
  ];
  return {
    id: `pumpyard.checkpoint.${idx}`,
    tag: `pumpyard.checkpoint.${idx}`,
    kind: 'pumpCheckpoint',
    label: 'PUMP YARD CHECKPOINT',
    value: 26_000,
    nodes,
    collapseThreshold: 0.5,
  };
}

/** Decorative vertical iron maintenance ladder bolted to a sewer shaft wall. */
function wallLadder(k: Kit, x: number, y0: number, y1: number, z: number, facing: 'px' | 'nx' | 'pz' | 'nz'): void {
  const g = k.geo.use('steelDark');
  const railOff = 0.24;
  const rungCount = Math.max(4, Math.floor((y1 - y0) / 0.42));
  if (facing === 'pz' || facing === 'nz') {
    g.cyl(x - railOff, y0, z, x - railOff, y1, z, 0.03, 0.03, 5, false, false);
    g.cyl(x + railOff, y0, z, x + railOff, y1, z, 0.03, 0.03, 5, false, false);
    for (let i = 1; i <= rungCount; i++) {
      const ry = y0 + ((y1 - y0) * i) / (rungCount + 1);
      g.box(x, ry, z, railOff, 0.02, 0.02, FACE.all);
    }
  } else {
    g.cyl(x, y0, z - railOff, x, y1, z - railOff, 0.03, 0.03, 5, false, false);
    g.cyl(x, y0, z + railOff, x, y1, z + railOff, 0.03, 0.03, 5, false, false);
    for (let i = 1; i <= rungCount; i++) {
      const ry = y0 + ((y1 - y0) * i) / (rungCount + 1);
      g.box(x, ry, z, 0.02, 0.02, railOff, FACE.all);
    }
  }
}

/** Builds the surface Industrial Pump Yard: 4 giant cistern tanks, overhead pipes, tower pad & north dividing arch wall. */
function buildSurfacePumpYard(k: Kit, spec: MapSpec): void {
  const g = k.geo;

  // 1. Four Huge Solid Steel Water Cistern Tanks (landmarks flanking the yard)
  const cisterns: readonly [number, number, number, number][] = [
    [-34, -22, 5.2, 9.5],
    [-34, -44, 5.2, 10.5],
    [32, -22, 5.0, 9.5],
    [32, -44, 5.0, 10.5],
  ];
  for (const [cx, cz, r, h] of cisterns) {
    tank(k, cx, cz, 0, r, h, 'panel', { ladder: true, bands: 3, seg: 16 });
    spec.plan?.blocks.push({ x0: cx - r, z0: cz - r, x1: cx + r, z1: cz + r });
  }

  // Pump machinery lumps beside the west & east tank banks
  machine(k, -25, 0, -22, Math.PI / 2, 3.2, 2.4, 2.0);
  machine(k, -25, 0, -44, Math.PI / 2, 3.2, 2.4, 2.0);
  machine(k, 23, 0, -22, -Math.PI / 2, 3.2, 2.4, 2.0);

  // 2. Overhead Industrial Steel Pipelines connecting tanks & spanning high above the yard (y = 6.2..7.2)
  pipe(k, [-34, 6.4, -22, -34, 6.4, -44], 0.48, 'steel', 7, 8, false);
  pipe(k, [32, 6.4, -22, 32, 6.4, -44], 0.48, 'steel', 7, 8, false);
  pipe(k, [-34, 7.2, -40, -14, 7.2, -40, -6, 7.2, -40], 0.42, 'rust', 6, 8, false);
  pipe(k, [32, 7.2, -40, 14, 7.2, -40, 6, 7.2, -40], 0.42, 'rust', 6, 8, false);
  pipe(k, [-28, 5.8, -16, 26, 5.8, -16], 0.36, 'steelDark', 8, 8, false);
  for (const px of [-26, 26]) {
    g.use('steelDark').cyl(px, 0, -16, px, 5.8, -16, 0.22, 0.2, 6, false, false);
    k.collide(px, 2.9, -16, 0.25, 2.9, 0.25, 'metal', false);
  }

  // 3. Flush Concrete Foundation Pad at exact PUMP_YARD.towerBase ([0, 0, -40]) for collapsing 18.5 m Water Tower!
  const [tx, , tz] = PUMP_YARD.towerBase;
  g.use('concreteDark').tint(0.75, 0.72, 0.66).box(tx, 0.025, tz, 5.4, 0.025, 5.4, FACE.py | FACE.sides);
  g.use('hazard').box(tx, 0.052, tz + 5.1, 5.2, 0.008, 0.32, FACE.py);
  g.use('hazard').box(tx, 0.052, tz - 5.1, 5.2, 0.008, 0.32, FACE.py);
  g.use('hazard').box(tx - 5.1, 0.052, tz, 0.32, 0.008, 4.8, FACE.py);
  g.use('hazard').box(tx + 5.1, 0.052, tz, 0.32, 0.008, 4.8, FACE.py);
  g.use('steelDark');
  for (const sx of [-3.6, 3.6]) {
    for (const sz of [-3.6, 3.6]) {
      g.bevel(tx + sx, 0.06, tz + sz, 0.55, 0.06, 0.55, 0.02);
    }
  }
  g.tint(1);

  // 4. North Dividing Wall at z = -56 with Central Street Arch (x = -8..+8, h = 6.2 m — OPEN for nav, blocked by fallen tower!)
  k.wall(-76, WALL_NORTH_Z, -8, WALL_NORTH_Z, 0, 7.6, {
    mat: 'concrete',
    backing: 'concreteDark',
    thick: 1.6,
    bay: 10,
    back: true,
    pilasters: true,
  });
  k.wall(8, WALL_NORTH_Z, 76, WALL_NORTH_Z, 0, 7.6, {
    mat: 'concrete',
    backing: 'concreteDark',
    thick: 1.6,
    bay: 10,
    back: true,
    pilasters: true,
  });
  k.block('concreteDark', -8.6, 6.2, WALL_NORTH_Z - 1.0, 8.6, 8.0, WALL_NORTH_Z + 1.0, 0.12);
  g.use('hazard').box(0, 6.42, WALL_NORTH_Z + 1.04, 7.8, 0.22, 0.02, FACE.pz);
  g.use('hazard').box(0, 6.42, WALL_NORTH_Z - 1.04, 7.8, 0.22, 0.02, FACE.nz);
  for (const side of [-1, 1] as const) {
    k.block('steelDark', side * 8.4 - 0.5, 0, WALL_NORTH_Z - 1.15, side * 8.4 + 0.5, 8.2, WALL_NORTH_Z + 1.15, 0.08);
  }
  spec.plan?.walls.push(
    { ax: -76, az: WALL_NORTH_Z, bx: -8, bz: WALL_NORTH_Z, half: 0.8 },
    { ax: 8, az: WALL_NORTH_Z, bx: 76, bz: WALL_NORTH_Z, half: 0.8 },
  );
  spec.plan?.gates.push({ x: 0, z: WALL_NORTH_Z, yaw: 0, w: 16, bay: true });

  // 5. Tier-0 Destructible Pump Control Shack & Sandbag Checkpoints
  spec.cluster(buildPumpControlShackCluster());
  spec.plan?.blocks.push({ x0: 17.2, z0: -38.2, x1: 22.8, z1: -33.8 });

  spec.cluster(buildPumpCheckpointCluster(0, -14, -18, 0.1, false));
  spec.cluster(buildPumpCheckpointCluster(1, -12, -48, 0.18, true));
  spec.cluster(buildPumpCheckpointCluster(2, 16, -48, -0.22, false));

  // Single isolated explosive drum near south-east yard flank
  spec.barrels(14, 0, -24, 1);

  // Industrial overhead floodlight masts illuminating the Pump Yard (3 baked lights)
  k.mast(-24, -16, 0, 9.5, -0.5, 'orange', 52, 28);
  k.mast(24, -48, 0, 9.5, 2.6, 'orange', 52, 28);
  k.light(0, 12, -36, DESERT_PALETTE.dawnWarm, 48, 32);
}

/**
 * Builds the Extended 50 m Multi-Chamber Vaulted Dark Storm Sewer at y = -5.5 (ceiling y = -1.2):
 *   1. South Entry Sump Chamber (`z = -25.5..-38.0`, x = -3.8..+3.8) with drop pit beside [-14, 0, -28] & wall ladder.
 *   2. Central Cistern Ambush Gallery (`z = -38.0..-64.0`, width 14 m: x = -7.0..+7.0) with 6 concrete pillars,
 *      twin drainage sluice alcoves, iron catwalk grate strips, and 4 low waist-high cover baffles!
 *   3. North Conduit & Exit Shaft (`z = -64.0..-83.0`) through PUMP_YARD.sewerExitBottom ([0, -5.5, -78])
 *      climbing west via wide steel grate exit ramp (+ wall ladder) cleanly up to HIGH_TERRACES.sewerExitTop ([0, 0, -81]).
 */
function buildDarkStormSewer(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const dp = SEWER_DROP_PIT; // x: -13.0..-4.8, z: -30.2..-25.8
  const ep = SEWER_EXIT_PIT; // x: 0.5..9.1, z: -82.9..-79.1
  const slabUnderY = -0.8; // underside of y = 0 ground slab
  const dropZ = PUMP_YARD.sewerDropPos[2]; // -28
  const exitZ = PUMP_YARD.sewerExitTop[2]; // -81

  // --- 1. Sewer Entry Drop Shaft & Sloping Ramp (beside PUMP_YARD.sewerDropPos = [-14, 0, -28]) ---
  g.use('hazard').box(dp.x0 - 0.8, 0.025, dropZ, 0.75, 0.01, 2.2, FACE.py);
  k.rail([dp.x0, 0, dp.z0, dp.x1, 0, dp.z0, dp.x1, 0, dp.z1, dp.x0, 0, dp.z1], 1.0, 2.2);
  // Broken tilted heavy iron grate propped up on south rim of drop pit
  k.push(-9.0, 0.9, dp.z1 + 0.35, 0.12, 0, 0.55);
  g.use('grate').tint(0.7).bevel(0, 0, 0, 1.8, 0.06, 1.4, 0.02);
  g.use('rust').bevel(0, 0, -1.4, 1.85, 0.1, 0.08, 0.02);
  g.use('rust').bevel(0, 0, 1.4, 1.85, 0.1, 0.08, 0.02);
  g.tint(1);
  k.pop();

  // Sloping concrete entry ramp from (-13.0, 0, -28) east down to (-2.5, -5.5, -28) (run = 10.5 m, ny = 0.886)
  k.ramp(dp.x0, dropZ, 0, -2.5, dropZ, SEWER_Y, 4.4, 'concreteDark', 0.55, false);
  // Wall maintenance ladder bolted beside drop shaft north cheek
  wallLadder(k, -12.1, SEWER_Y, 0.0, dp.z0 + 0.08, 'pz');

  // Enclosing shaft cheek walls & under-ramp backing
  k.block('concreteDark', -13.4, SEWER_Y, dp.z0 - 0.5, -3.8, 0.15, dp.z0, 0.04);
  k.block('concreteDark', -13.4, SEWER_Y, dp.z1, -3.8, 0.15, dp.z1 + 0.5, 0.04);
  k.block('concreteDark', -13.6, SEWER_Y - 0.4, dp.z0 - 0.2, -13.0, -0.35, dp.z1 + 0.2, 0.04);

  // --- 2. Continuous Walkable Floors across all 3 Chambers (exact y = -5.5) ---
  // Chamber 1 (South Entry Sump: z = -38 .. -25.5) + Chamber 3 (North Conduit: z = -83 .. -64)
  k.floor('concreteDark', -4.2, -38.2, 4.2, -25.5, SEWER_Y, 0.8, 4);
  // Chamber 2 (Wide 14 m Central Cistern Ambush Gallery: x = -7.2 .. +7.2, z = -64 .. -38)
  k.floor('concreteDark', -7.2, -64.2, 7.2, -37.8, SEWER_Y, 0.8, 5);
  // Chamber 3 (North Conduit + East Exit Chamber: x = -4.2..+4.2 for z = -83..-64, plus x = +4.0..+13.2 for z = -83..-74)
  k.floor('concreteDark', -4.2, -83.2, 4.2, -63.8, SEWER_Y, 0.8, 4);
  k.floor('concreteDark', 4.0, -83.2, 13.2, -74.0, SEWER_Y, 0.8, 4);

  // Shallow dark storm-water trough down the 55 m tunnel centerline (flush visual strip at y = -5.485)
  g.use('asphalt').tint(0.12, 0.16, 0.20).slab(0, SEWER_Y + 0.015, -54.0, 1.35, 0.01, 27.5, 6, FACE.py);
  // Wet iron catwalk grate strips running along the flanks of the wide Central Cistern Gallery (x = ±5.4)
  g.use('grate').tint(0.55);
  g.slab(-5.4, SEWER_Y + 0.02, -51.0, 1.1, 0.015, 12.2, 4, FACE.py);
  g.slab(5.4, SEWER_Y + 0.02, -51.0, 1.1, 0.015, 12.2, 4, FACE.py);
  g.tint(1);

  // --- 3. Enclosing Perimeter Walls Sealing all 3 Chambers up to slabUnderY (-0.8) ---
  // Chamber 1 South end wall & side walls
  k.block('concreteDark', -4.2, SEWER_Y, -25.8, 4.2, slabUnderY, -25.2, 0.04);
  k.block('concreteDark', -4.4, SEWER_Y, -38.2, -3.8, slabUnderY, dp.z0, 0.04);
  k.block('concreteDark', 3.8, SEWER_Y, -38.2, 4.4, slabUnderY, -25.5, 0.04);

  // Chamber 2 Wide Central Cistern Gallery shoulder & side walls (x = -7.0 .. +7.0, z = -64 .. -38)
  k.block('concreteDark', -7.6, SEWER_Y, -38.4, -3.8, slabUnderY, -37.8, 0.04);
  k.block('concreteDark', 3.8, SEWER_Y, -38.4, 7.6, slabUnderY, -37.8, 0.04);
  k.block('concreteDark', -7.6, SEWER_Y, -64.2, -7.0, slabUnderY, -38.0, 0.04);
  k.block('concreteDark', 7.0, SEWER_Y, -64.2, 7.6, slabUnderY, -38.0, 0.04);
  k.block('concreteDark', -7.6, SEWER_Y, -64.4, -3.8, slabUnderY, -63.8, 0.04);
  k.block('concreteDark', 3.8, SEWER_Y, -64.4, 7.6, slabUnderY, -63.8, 0.04);

  // Chamber 3 North Conduit & Exit Sump Room walls
  k.block('concreteDark', -4.4, SEWER_Y, -83.4, -3.8, slabUnderY, -64.0, 0.04);
  k.block('concreteDark', 3.8, SEWER_Y, -74.2, 4.4, slabUnderY, -64.0, 0.04);
  k.block('concreteDark', 3.8, SEWER_Y, -74.2, 13.4, slabUnderY, -73.6, 0.04);
  k.block('concreteDark', 13.0, SEWER_Y, -83.4, 13.6, slabUnderY, -73.8, 0.04);
  // North end wall sealing both north tunnel & exit ramp pit (z = -83.4 .. -82.9)
  k.block('concreteDark', -4.2, SEWER_Y, ep.z0 - 0.5, 13.5, 0.15, ep.z0, 0.04);

  // --- 4. Dark Vaulted Ceiling Liner (y = -1.2) + Concrete Arches + Twin Sluice Alcoves ---
  g.use('concreteDark').tint(0.42);
  g.slab(0, SEWER_CEIL, -31.8, 3.9, 0.06, 6.4, 4, FACE.ny);
  g.slab(0, SEWER_CEIL, -51.0, 7.1, 0.06, 13.2, 6, FACE.ny);
  g.slab(0, SEWER_CEIL, -73.5, 3.9, 0.06, 9.6, 5, FACE.ny);
  g.slab(8.5, SEWER_CEIL, -78.5, 4.6, 0.06, 4.5, 4, FACE.ny);
  // Twin decorative iron drainage sluice gates recessed on east & west Central Gallery walls
  for (const side of [-1, 1] as const) {
    for (const sz of [-45, -57]) {
      g.use('steelDark').bevel(side * 6.92, SEWER_Y + 1.55, sz, 0.14, 1.55, 2.2, 0.04);
      g.use('grate').tint(0.35).box(side * 6.84, SEWER_Y + 1.45, sz, 0.05, 1.25, 1.75, side > 0 ? FACE.nx : FACE.px);
    }
  }
  g.tint(1);

  // 6 Heavy Concrete Structural Pillars down the 14 m Central Cistern Gallery (x = ±3.8 at z = -44, -51, -58)
  for (const pz of [-44, -51, -58]) {
    for (const side of [-1, 1] as const) {
      k.block('concrete', side * 3.8 - 0.42, SEWER_Y, pz - 0.42, side * 3.8 + 0.42, SEWER_CEIL, pz + 0.42, 0.06);
    }
    // Overhead vaulted transverse rib beam spanning the 14 m gallery
    g.use('concreteDark').tint(0.55).bevel(0, SEWER_CEIL - 0.22, pz, 7.0, 0.24, 0.34, 0.05);
  }
  // Overhead rib arches in south & north conduits (visual only)
  for (const rz of [-33, -68, -75]) {
    g.use('concreteDark').tint(0.55).bevel(0, SEWER_CEIL - 0.22, rz, 3.8, 0.24, 0.32, 0.05);
  }
  g.tint(1);

  // 4 Waist-High Tactical Concrete Cover Baffles inside the Central Cistern Gallery (h = 1.15 m)
  // Staggered across the 7.6 m center aisle so a 10-man Thermal-Vision firefight has rich cover & flanking!
  for (const [bx, bz] of [
    [-1.6, -42],
    [1.8, -48],
    [-1.8, -54],
    [1.6, -60],
  ] as const) {
    k.block('concreteDark', bx - 1.15, SEWER_Y, bz - 0.26, bx + 1.15, SEWER_Y + 1.15, bz + 0.26, 0.04);
  }

  // 2 Tier-0 Destructible Wooden Barricades tucked in the gallery flank lanes
  for (const [idx, sx, sz] of [
    [0, -5.2, -46],
    [1, 5.2, -56],
  ] as const) {
    spec.cluster({
      id: `sewer.cover.${idx}`,
      tag: `sewer.cover.${idx}`,
      kind: 'sewerCover',
      label: 'SEWER BARRICADE',
      value: 14_000,
      nodes: [
        { id: 'plank_wall', pos: [sx, SEWER_Y + 0.62, sz], half: [1.25, 0.62, 0.24], mat: 'plywood', color: 0x7c6244, hp: 115, tier: 0, anchored: true, kind: 'wall', materialClass: 'wood' },
        { id: 'crate', pos: [sx - Math.sign(sx) * 0.9, SEWER_Y + 0.48, sz - 0.55], half: [0.46, 0.48, 0.46], mat: 'plywood', color: 0x6f563a, hp: 105, tier: 0, anchored: true, kind: 'wall', materialClass: 'wood' },
      ],
      collapseThreshold: 0.5,
    });
  }

  // Dripping overhead rusted drainage pipes along upper walls
  pipe(k, [-3.3, -1.9, -31.0, -3.3, -1.9, -38.0], 0.22, 'rust', 6, 6, false);
  pipe(k, [-6.5, -1.9, -38.5, -6.5, -1.9, -63.5], 0.26, 'rust', 8, 6, false);
  pipe(k, [6.5, -1.9, -38.5, 6.5, -1.9, -63.5], 0.26, 'rust', 8, 6, false);
  pipe(k, [-3.3, -1.9, -64.5, -3.3, -1.9, -82.0], 0.22, 'rust', 7, 6, false);

  // Sparse dim red/amber safety strips & only 4 dim underground bulbs (genuinely dark for Thermal Vision `T`!)
  for (const [lx, lz, col, inten] of [
    [0, -31, 0xff4c22, 6.5],
    [-4.2, -46, 0xff421e, 7.0],
    [4.2, -59, 0xff421e, 7.0],
    [10.8, -79, 0xff7a28, 9.5],
  ] as const) {
    g.use('steelDark').bevel(lx, SEWER_CEIL - 0.14, lz, 0.22, 0.1, 0.22, 0.02);
    g.use(col === 0xff7a28 ? 'emissiveOrange' : 'emissiveRed').box(lx, SEWER_CEIL - 0.26, lz, 0.14, 0.06, 0.14, FACE.all);
    k.light(lx, SEWER_CEIL - 0.85, lz, col, inten, 9.0);
  }
  // Faint red horizontal safety strips along Central Gallery walls (visual guide without flooding ambient light)
  g.use('emissiveRed');
  g.box(-6.94, SEWER_Y + 2.4, -51, 0.03, 0.05, 11.5, FACE.px);
  g.box(6.94, SEWER_Y + 2.4, -51, 0.03, 0.05, 11.5, FACE.nx);

  // --- 5. Wide Steel Grate Exit Ramp climbing WEST from (11.0, -5.5, -81) up to (0.5, 0, -81) beside sewerExitTop [0, 0, -81] ---
  // Run = 10.5 m, rise = 5.5 m -> ny = 0.886 >> 0.68! Width = 3.8 m (z = -82.9 .. -79.1).
  k.ramp(11.0, exitZ, SEWER_Y, ep.x0, exitZ, 0, 3.8, 'grate', 0.45, false);
  // Decorative maintenance escape ladder bolted on the north shaft wall beside the exit ramp
  wallLadder(k, 1.5, SEWER_Y, 0.0, ep.z0 + 0.08, 'pz');

  // Retaining wall separating exit ramp pit from deep exit room (z = -79.1 .. -78.65, x = 0.5 .. 9.1)
  k.block('concreteDark', ep.x0, SEWER_Y, ep.z1, ep.x1, 0.15, ep.z1 + 0.45, 0.04);
  // Retaining lip along east wall of exit pit at surface
  k.block('concreteDark', ep.x1, -0.8, ep.z0, ep.x1 + 0.4, 0.15, ep.z1 + 0.4, 0.03);
  // Surface guardrails on north, south & east rims (west rim at x = 0.5 stays wide open onto [0, 0, -81]!)
  k.rail([ep.x0, 0, ep.z0, ep.x1, 0, ep.z0, ep.x1, 0, ep.z1, ep.x0, 0, ep.z1], 1.0, 2.2);
  // Hazard stripe & amber exit beacon at HIGH_TERRACES.sewerExitTop [0, 0, -81] (5th sewer light; total 8 in pumpyard.ts)
  g.use('hazard').box(ep.x0 - 0.75, 0.025, exitZ, 0.65, 0.01, 2.0, FACE.py);
  g.use('emissiveOrange').box(ep.x0 + 0.2, 1.05, ep.z0 - 0.08, 0.18, 0.18, 0.12, FACE.all);
  k.light(0, 2.2, exitZ, DESERT_PALETTE.dawnAmber, 22, 12);
}

export function authorDesertPumpYard(k: Kit, spec: MapSpec): void {
  buildSurfacePumpYard(k, spec);
  buildDarkStormSewer(k, spec);
}
