/**
 * Surplus — The Pump Yard (z = -14 .. -66) & Vaulted Dark Storm Sewer (y = -5.5).
 *
 * Surface Industrial Pump Yard (y = 0):
 *   - 4 colossal solid steel water cistern tanks flanking the yard (iconic solid landmarks).
 *   - Elevated industrial steel pipelines linking tanks overhead.
 *   - Clean flush concrete foundation pad at PUMP_YARD.towerBase ([0, 0, -40]) for Lane 4's
 *     collapsing 18.5 m Water Tower.
 *   - Solid North Dividing Wall at z = -56 with an open 16 m central street arch (x = -8..+8,
 *     h = 6.2 m) that Lane 4's collapsed Water Tower blocks at runtime, forcing the player into
 *     the Dark Storm Sewer!
 *   - Tier-0 destructible Pump Control Shack, 3 sandbag checkpoints, and red fuel drums.
 *
 * Vaulted Dark Storm Sewer (y = -5.5):
 *   - Open concrete drop pit & sloping entry ramp descending east from PUMP_YARD.sewerDropPos
 *     ([-14, 0, -30]) down to (-2.5, -5.5, -30).
 *   - 7 m wide, 4.4 m tall dark concrete vaulted storm tunnel running north along x = 0 from
 *     z = -30 to z = -74 (including exact PUMP_YARD.sewerExitBottom = [0, -5.5, -74]).
 *   - Concrete structural ribs, shallow dark water trough, dripping overhead rust pipes, and
 *     sparse dim warm emergency bulbs (spaced 20 m apart) so it's genuinely dark & eerie for
 *     the Thermal brain chip!
 *   - Wide steel grate exit ramp climbing west from (10.5, -5.5, -77) straight up to exact
 *     PUMP_YARD.sewerExitTop ([0, 0, -77]) right inside the Crashed Cargo Plane forecourt!
 */
import type { StructuralClusterSpec } from '../../destruction';
import { FACE } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { machine, pipe, tank } from '../../kit/props';
import type { MapSpec } from '../spec';
import { DESERT_PALETTE, SEWER_DROP_PIT, SEWER_EXIT_PIT } from './dunes';
import { DESERT_Z, PUMP_YARD } from './plan';

const SEWER_Y = PUMP_YARD.sewerFloorY; // -5.5
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
      { id: 'col_sw', pos: [x - hw, H / 2, z + hd], half: [0.18, H / 2, 0.18], mat: 'steelDark', hp: 90, tier: 0, anchored: true, kind: 'column' },
      { id: 'col_se', pos: [x + hw, H / 2, z + hd], half: [0.18, H / 2, 0.18], mat: 'steelDark', hp: 90, tier: 0, anchored: true, kind: 'column' },
      { id: 'col_nw', pos: [x - hw, H / 2, z - hd], half: [0.18, H / 2, 0.18], mat: 'steelDark', hp: 90, tier: 0, anchored: true, kind: 'column' },
      { id: 'col_ne', pos: [x + hw, H / 2, z - hd], half: [0.18, H / 2, 0.18], mat: 'steelDark', hp: 90, tier: 0, anchored: true, kind: 'column' },
      { id: 'wall_n', pos: [x, H / 2, z - hd], half: [hw - 0.2, H / 2, 0.14], mat: 'panel', color: 0x6e7b7e, hp: 85, tier: 0, anchored: true, kind: 'wall' },
      { id: 'wall_s', pos: [x, H / 2, z + hd], half: [hw - 0.2, H / 2, 0.14], mat: 'panel', color: 0x6e7b7e, hp: 85, tier: 0, anchored: true, kind: 'wall' },
      { id: 'wall_e', pos: [x + hw, H / 2, z], half: [0.14, H / 2, hd - 0.2], mat: 'rust', color: 0x84543c, hp: 85, tier: 0, anchored: true, kind: 'wall' },
      { id: 'roof', pos: [x, H + 0.12, z], half: [hw + 0.3, 0.12, hd + 0.3], mat: 'rust', color: 0x764c34, hp: 95, tier: 0, anchored: false, kind: 'roof', impactRadius: 7 },
      { id: 'pump_drum', pos: [x + 1.0, 0.56, z - 0.4], half: [0.42, 0.56, 0.42], mat: 'paintRed', color: 0xcc2820, hp: 35, tier: 0, anchored: true, kind: 'hazard', hazardRadius: 9.5, hazardDamage: 235 },
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
function buildPumpCheckpointCluster(idx: number, x: number, z: number, yaw: number): StructuralClusterSpec {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const pt = (lx: number, ly: number, lz: number): [number, number, number] => [
    x + lx * c + lz * s,
    ly,
    z - lx * s + lz * c,
  ];
  return {
    id: `pumpyard.checkpoint.${idx}`,
    tag: `pumpyard.checkpoint.${idx}`,
    kind: 'pumpCheckpoint',
    label: 'PUMP YARD CHECKPOINT',
    value: 26_000,
    nodes: [
      { id: 'bags_main', pos: pt(0, 0.62, 0), half: [2.2, 0.62, 0.42], mat: 'dirt', color: 0x9b8660, hp: 85, tier: 0, anchored: true, kind: 'wall', yaw },
      { id: 'shield_side', pos: pt(-2.1, 0.85, -0.7), half: [0.32, 0.85, 0.85], mat: 'rust', color: 0x82543c, hp: 75, tier: 0, anchored: true, kind: 'wall', yaw },
      { id: 'drum', pos: pt(1.9, 0.56, -0.45), half: [0.4, 0.56, 0.4], mat: 'paintRed', color: 0xcc2820, hp: 35, tier: 0, anchored: true, kind: 'hazard', yaw, hazardRadius: 8.8, hazardDamage: 220 },
    ],
    collapseThreshold: 0.5,
  };
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
    tank(k, cx, cz, 0, r, h, 'panel', { ladder: true, bands: 3, seg: 20 });
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
  // Pipe gantry trestle legs tucked at flanks (x = ±26)
  for (const px of [-26, 26]) {
    g.use('steelDark').cyl(px, 0, -16, px, 5.8, -16, 0.22, 0.2, 6, false, false);
    k.collide(px, 2.9, -16, 0.25, 2.9, 0.25, 'metal', false);
  }

  // 3. Flush Concrete Foundation Pad at exact PUMP_YARD.towerBase ([0, 0, -40]) for Lane 4's 18.5 m Water Tower!
  const [tx, , tz] = PUMP_YARD.towerBase;
  g.use('concreteDark').tint(0.75, 0.72, 0.66).box(tx, 0.025, tz, 5.4, 0.025, 5.4, FACE.py | FACE.sides);
  g.use('hazard').box(tx, 0.052, tz + 5.1, 5.2, 0.008, 0.32, FACE.py);
  g.use('hazard').box(tx, 0.052, tz - 5.1, 5.2, 0.008, 0.32, FACE.py);
  g.use('hazard').box(tx - 5.1, 0.052, tz, 0.32, 0.008, 4.8, FACE.py);
  g.use('hazard').box(tx + 5.1, 0.052, tz, 0.32, 0.008, 4.8, FACE.py);
  // 4 steel anchor bolt plates at the corners (decorative flush)
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
    bay: 8,
    back: true,
    pilasters: true,
  });
  k.wall(8, WALL_NORTH_Z, 76, WALL_NORTH_Z, 0, 7.6, {
    mat: 'concrete',
    backing: 'concreteDark',
    thick: 1.6,
    bay: 8,
    back: true,
    pilasters: true,
  });
  // Solid concrete & steel overhead arch lintel above x = -8..+8 (y = 6.2 .. 8.0)
  k.block('concreteDark', -8.6, 6.2, WALL_NORTH_Z - 1.0, 8.6, 8.0, WALL_NORTH_Z + 1.0, 0.12);
  g.use('hazard').box(0, 6.42, WALL_NORTH_Z + 1.04, 7.8, 0.22, 0.02, FACE.pz);
  g.use('hazard').box(0, 6.42, WALL_NORTH_Z - 1.04, 7.8, 0.22, 0.02, FACE.nz);
  // Twin industrial concrete arch piers at x = ±8.4 (keeps x = -8..+8 clear!)
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

  spec.cluster(buildPumpCheckpointCluster(0, -14, -18, 0.1));
  spec.cluster(buildPumpCheckpointCluster(1, -12, -48, 0.18));
  spec.cluster(buildPumpCheckpointCluster(2, 16, -48, -0.22));

  // Extra explosive fuel barrels near the south pump yard entrance
  spec.barrels(-20, 0, -34, 2);
  spec.barrels(14, 0, -24, 2);

  // Industrial overhead floodlight masts illuminating the Pump Yard
  k.mast(-24, -16, 0, 9.5, -0.5, 'orange', 52, 28);
  k.mast(24, -48, 0, 9.5, 2.6, 'orange', 52, 28);
  k.light(0, 12, -36, DESERT_PALETTE.dawnWarm, 48, 32);
}

/**
 * Builds the Vaulted Dark Storm Sewer at y = -5.5:
 *   - Drop shaft & sloping concrete ramp from (-13, 0, -30) -> (-2.5, -5.5, -30) right beside sewerDropPos [-14, 0, -30].
 *   - 7 m wide x 4.4 m tall concrete storm tunnel running north along x = 0 from z = -30 to z = -74 (sewerExitBottom).
 *   - Dark water trough, concrete rib pillars, dripping pipes, sparse dim emergency bulbs (ideal for Thermal vision!).
 *   - Wide steel grate exit ramp climbing west from (10.5, -5.5, -77) straight up to sewerExitTop [0, 0, -77].
 */
function buildDarkStormSewer(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const dp = SEWER_DROP_PIT; // x: -13.0..-4.8, z: -32.2..-27.8
  const ep = SEWER_EXIT_PIT; // x: 0.0..8.2, z: -78.9..-75.1
  const ceilY = -0.8; // flush with underside of y = 0 ground slab!
  const tunnelHalfW = 3.5; // 7.0 m interior width (x = -3.5 .. +3.5)

  // --- 1. Sewer Entry Drop Shaft & Sloping Ramp (beside PUMP_YARD.sewerDropPos = [-14, 0, -30]) ---
  // Hazard striping & concrete curb framing the open sewer grate pit at y = 0
  g.use('hazard').box(dp.x0 - 0.8, 0.025, -30, 0.75, 0.01, 2.3, FACE.py);
  // Guardrails on north, south & east rims of drop pit (west rim at x = -13.0 stays wide open!)
  k.rail([dp.x0, 0, dp.z0, dp.x1, 0, dp.z0, dp.x1, 0, dp.z1, dp.x0, 0, dp.z1], 1.0, 2.2);
  // Broken tilted heavy iron grate propped up on the south edge of the drop pit (visual storytelling!)
  k.push(-9.2, 0.9, dp.z1 + 0.35, 0.12, 0, 0.55);
  g.use('grate').tint(0.7).bevel(0, 0, 0, 1.8, 0.06, 1.4, 0.02);
  g.use('rust').bevel(0, 0, -1.4, 1.85, 0.1, 0.08, 0.02);
  g.use('rust').bevel(0, 0, 1.4, 1.85, 0.1, 0.08, 0.02);
  g.tint(1);
  k.pop();

  // Sloping concrete entry ramp from (-13.0, 0, -30) east down to (-2.5, -5.5, -30)
  // Run = 10.5 m, drop = 5.5 m -> ny = 0.886 >> 0.68!
  k.ramp(dp.x0, -30, 0, -2.5, -30, SEWER_Y, 4.4, 'concreteDark', 0.55, false);

  // Enclosing concrete shaft walls flanking the entry ramp (z = -32.45 and z = -27.55, x = -13.4..-3.5)
  k.block('concreteDark', -13.4, SEWER_Y, dp.z0 - 0.5, -3.5, 0.15, dp.z0, 0.04);
  k.block('concreteDark', -13.4, SEWER_Y, dp.z1, -3.5, 0.15, dp.z1 + 0.5, 0.04);
  // Under-ramp solid fill backing west end of pit so nobody clips under the ramp
  k.block('concreteDark', -13.6, SEWER_Y - 0.4, dp.z0 - 0.2, -13.0, -0.35, dp.z1 + 0.2, 0.04);
  // Floor transition pad beneath the bottom of the entry ramp (x = -4.8..-2.0, z = -32.2..-27.8)
  k.floor('concreteDark', -4.8, dp.z0, -2.0, dp.z1, SEWER_Y, 0.8, 3);

  // --- 2. Main Vaulted Concrete Sewer Tunnel (x = -3.5..+3.5, z = -27.5..-78.9, floor y = -5.5) ---
  // Solid walkable sewer floor at exact y = -5.5 (main tunnel + east north exit chamber)
  k.floor('concreteDark', -4.0, ep.z0, 4.0, -27.5, SEWER_Y, 0.8, 4);
  k.floor('concreteDark', 4.0, ep.z0, 12.6, -71.5, SEWER_Y, 0.8, 4);

  // Shallow dark storm-water trough down the tunnel center (decorative flush strip at y = -5.485)
  g.use('asphalt').tint(0.14, 0.18, 0.22).slab(0, SEWER_Y + 0.015, -52.5, 1.15, 0.01, 24.5, 4, FACE.py);
  g.tint(1);
  // Subtle wet concrete walkway curbs flanking the dark water trough (decorative bevels, 0.04 m high)
  g.use('concreteDark').tint(0.55);
  g.box(-2.35, SEWER_Y + 0.02, -52.5, 1.05, 0.02, 24.5, FACE.py);
  g.box(2.35, SEWER_Y + 0.02, -52.5, 1.05, 0.02, 24.5, FACE.py);
  g.tint(1);

  // Solid enclosing tunnel walls (y = -5.5 .. -0.8, sealing cleanly against ground slab underside!)
  // South end wall at z = -27.5
  k.block('concreteDark', -4.0, SEWER_Y, -27.5, 4.0, ceilY, -27.0, 0.04);
  // West tunnel wall north of drop ramp (z = -79.2 .. -32.2)
  k.block('concreteDark', -tunnelHalfW - 0.6, SEWER_Y, ep.z0 - 0.4, -tunnelHalfW, ceilY, dp.z0, 0.04);
  // East tunnel wall south of exit chamber (z = -71.5 .. -27.5)
  k.block('concreteDark', tunnelHalfW, SEWER_Y, -71.5, tunnelHalfW + 0.6, ceilY, -27.5, 0.04);
  // North end wall sealing both tunnel & exit ramp chamber (z = -79.4 .. -78.9)
  k.block('concreteDark', -4.0, SEWER_Y, ep.z0 - 0.5, 13.0, 0.15, ep.z0, 0.04);
  // Exit chamber south & east walls (x = +3.5..+13.0 at z = -71.5, and x = +12.6..+13.1)
  k.block('concreteDark', tunnelHalfW, SEWER_Y, -71.5, 13.0, ceilY, -71.0, 0.04);
  k.block('concreteDark', 12.6, SEWER_Y, ep.z0 - 0.4, 13.1, ceilY, -71.0, 0.04);

  // Ceiling slab liner sealing the main tunnel underside & vaulted haunch cornices (y = -1.25 .. -0.8)
  g.use('concreteDark').tint(0.45);
  g.slab(0, ceilY - 0.04, -53.2, tunnelHalfW + 0.1, 0.04, 25.8, 5, FACE.ny);
  g.slab(8.2, ceilY - 0.04, -75.2, 4.5, 0.04, 3.8, 4, FACE.ny);
  // Angled upper vault haunches along both tunnel walls for authentic arched storm-drain silhouette
  for (const side of [-1, 1] as const) {
    g.bevel(side * (tunnelHalfW - 0.45), ceilY - 0.38, -53.2, 0.48, 0.36, 25.4, 0.18);
  }
  g.tint(1);

  // Concrete structural pillars & overhead vaulted rib arches every 8 m (tucked against walls -> 5.0 m clear center!)
  for (const rz of [-34, -42, -50, -58, -66, -73]) {
    for (const side of [-1, 1] as const) {
      const px = side * (tunnelHalfW - 0.36);
      k.block('concrete', px - 0.32, SEWER_Y, rz - 0.35, px + 0.32, ceilY - 0.25, rz + 0.35, 0.05);
    }
    // Overhead vaulted concrete arch beam (y = -1.45 .. -0.95 -> leaves 4.05 m vertical clearance!)
    g.use('concreteDark').tint(0.6).bevel(0, ceilY - 0.42, rz, tunnelHalfW, 0.26, 0.32, 0.06);
  }
  g.tint(1);

  // Dripping overhead rusted drainage pipes along both upper walls
  pipe(k, [-3.05, -2.0, -32.5, -3.05, -2.0, -78.2], 0.22, 'rust', 9, 6, false);
  pipe(k, [3.05, -2.0, -28.0, 3.05, -2.0, -71.0], 0.22, 'rust', 9, 6, false);

  // Dim sparse warm-red emergency bulbs spaced 20 m apart (genuinely dark & eerie for Thermal vision!)
  for (const lz of [-32, -52, -72]) {
    g.use('steelDark').bevel(0, ceilY - 0.18, lz, 0.22, 0.12, 0.22, 0.02);
    g.use('emissiveRed').box(0, ceilY - 0.32, lz, 0.14, 0.08, 0.14, FACE.all);
    k.light(0, ceilY - 0.85, lz, 0xff5224, 7.5, 8.5);
  }
  // One dim amber bulb in the exit ramp chamber so players spot the steel ramp climbing up!
  g.use('emissiveOrange').box(10.5, ceilY - 0.24, -76.5, 0.18, 0.08, 0.18, FACE.all);
  k.light(10.5, ceilY - 0.9, -76.5, 0xff7a28, 10, 9.5);

  // 2 small Tier-0 destructible wooden/crate barricades inside the dark sewer
  for (const [idx, sz, sx] of [
    [0, -46, -1.2],
    [1, -62, 1.2],
  ] as const) {
    spec.cluster({
      id: `sewer.cover.${idx}`,
      tag: `sewer.cover.${idx}`,
      kind: 'sewerCover',
      label: 'SEWER BARRICADE',
      value: 14_000,
      nodes: [
        { id: 'plank_wall', pos: [sx, SEWER_Y + 0.62, sz], half: [1.35, 0.62, 0.26], mat: 'plywood', color: 0x7c6244, hp: 65, tier: 0, anchored: true, kind: 'wall' },
        { id: 'crate', pos: [sx - Math.sign(sx) * 1.1, SEWER_Y + 0.48, sz - 0.5], half: [0.46, 0.48, 0.46], mat: 'plywood', color: 0x6f563a, hp: 55, tier: 0, anchored: true, kind: 'wall' },
      ],
      collapseThreshold: 0.5,
    });
  }

  // --- 3. Wide Steel Grate Exit Ramp climbing WEST from (10.5, -5.5, -77) up to PUMP_YARD.sewerExitTop [0, 0, -77] ---
  // Run = 10.5 m, rise = 5.5 m -> ny = 0.886 >> 0.68! Width = 3.8 m (z = -78.9 .. -75.1).
  k.ramp(10.5, -77.0, SEWER_Y, 0.0, -77.0, 0, 3.8, 'grate', 0.45, false);

  // Retaining wall along south edge of exit ramp pit (z = -75.1, x = 0.0..8.2) separating ramp from deep chamber
  k.block('concreteDark', ep.x0, SEWER_Y, ep.z1, ep.x1, 0.15, ep.z1 + 0.45, 0.04);
  // Retaining lip along east wall of exit pit at surface (y = -0.8..0.15)
  k.block('concreteDark', ep.x1, -0.8, ep.z0, ep.x1 + 0.4, 0.15, ep.z1 + 0.4, 0.03);
  // Surface guardrails on north, south & east edges of exit pit (west edge at x = 0.0 stays wide open onto sewerExitTop!)
  k.rail([ep.x0, 0, ep.z0, ep.x1, 0, ep.z0, ep.x1, 0, ep.z1, ep.x0, 0, ep.z1], 1.0, 2.2);
  // Hazard stripe & amber exit beacon at sewerExitTop [0, 0, -77]
  g.use('hazard').box(-0.75, 0.025, -77.0, 0.65, 0.01, 2.0, FACE.py);
  g.use('emissiveOrange').box(ep.x0 + 0.2, 1.05, ep.z0 - 0.08, 0.18, 0.18, 0.12, FACE.all);
  k.light(0, 2.2, -77, DESERT_PALETTE.dawnAmber, 22, 12);
}

export function authorDesertPumpYard(k: Kit, spec: MapSpec): void {
  buildSurfacePumpYard(k, spec);
  buildDarkStormSewer(k, spec);
}
