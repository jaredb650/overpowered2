/**
 * Surplus — Section 6: The Salt Cave ("The Cistern Tunnels", z = -148 .. -204).
 *
 * Atmospheric carved red-sandstone desert cavern & subterranean salt-mine tunnel:
 *   - South Cave Mouth (`SALT_CAVE.southMouth = [0, 0, -148]`): Towering sculpted sandstone arch
 *     descending via a smooth 12.6 m wide walkable ramp (`z = -148.5..-156.5`) down to `y = -2.5`.
 *   - Main Salt Cavern (`z = -156.5..-193.5`, 24 m wide, floor `y = -2.5`, rock vault ceiling `y = +5.4`):
 *     - Sculpted stepped red-sandstone walls, natural rock ceiling ribs, hanging stalactites,
 *       2 floor-to-ceiling sandstone columns, and 6 crystalline pale salt-vein boulders (cover!).
 *     - 4 Destructible Timber Mine-Shoring Arch & Overhead Ammo Gantry Clusters (`materialClass: 'wood'`)
 *       whose splintering beams drop overhead crates onto Saltblood defenders!
 *     - 8 warm amber hanging miner work-lamps + 2 pale crystalline salt-vein glows (great with or
 *       without Thermal Vision!).
 *   - North Cave Exit Ramp (`z = -193.5..-201.5`): Smooth climb from `y = -2.5` up to `y = 0`,
 *     emerging through a sculpted sandstone exit arch at `SALT_CAVE.northExit = [0, 0, -203]`
 *     for the dramatic reveal of the colossal crashed Cargo Plane straight ahead!
 */
import type { StructuralClusterSpec, StructuralNodeSpec } from '../../destruction';
import { FACE } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { cable } from '../../kit/props';
import type { MapSpec } from '../spec';
import { DESERT_PALETTE, SALT_CAVE_PIT } from './dunes';
import { SALT_CAVE } from './plan';

const FLOOR_Y = SALT_CAVE.floorY; // -2.5
const CEIL_Y = 5.4; // 7.9 m total floor-to-vault height inside main cavern!
const HALF_W = 12.0; // 24 m wide main cavern (x = -12..+12)
const PORTAL_HALF_W = 6.3; // 12.6 m wide ramp & portal mouth

const SALT_TINT = [0.92, 0.96, 1.0] as const;
const CAVE_WALL_DARK = [0.58, 0.34, 0.22] as const;
const CAVE_WALL_MID = [0.74, 0.44, 0.28] as const;

/**
 * Builds one of the 4 Destructible Timber Mine-Shoring Arch & Overhead Ammo Gantry Clusters.
 * Shooting out the vertical timber shoring posts (`materialClass: 'wood'`, `hp: 130`) splinters the
 * crossbeam and drops the overhead plank gantry & supply crates down into the cavern!
 */
function buildCaveShoringCluster(idx: number, z: number): StructuralClusterSpec {
  const postX = 4.9;
  const postH = 3.8; // y = -2.5 .. +1.3 (leaves 3.8 m clear vertical headroom underneath!)
  const beamY = FLOOR_Y + postH + 0.16; // +1.46
  const deckY = beamY + 0.22; // +1.68

  const nodes: StructuralNodeSpec[] = [
    // Twin anchored vertical timber mine-shoring posts
    { id: 'post_w', pos: [-postX, FLOOR_Y + postH / 2, z], half: [0.22, postH / 2, 0.22], mat: 'plywood', color: 0x6c4b2e, hp: 130, tier: 0, anchored: true, kind: 'column', materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', loadCapacity: 24_000 },
    { id: 'post_e', pos: [postX, FLOOR_Y + postH / 2, z], half: [0.22, postH / 2, 0.22], mat: 'plywood', color: 0x6c4b2e, hp: 130, tier: 0, anchored: true, kind: 'column', materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', loadCapacity: 24_000 },
    // Heavy overhead timber header beam spanning the mine drift
    { id: 'crossbeam', pos: [0, beamY, z], half: [postX + 0.65, 0.18, 0.24], mat: 'plywood', color: 0x7b5636, hp: 125, tier: 0, anchored: false, kind: 'slab', impactRadius: 7.0, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', lazyFracture: true },
    // Wooden overhead loot/ammo gantry planks resting on the shoring beam
    { id: 'gantry_deck', pos: [0, deckY, z], half: [postX + 0.3, 0.1, 1.05], mat: 'plywood', color: 0x8e6942, hp: 115, tier: 0, anchored: false, kind: 'catwalk', impactRadius: 7.5, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', lazyFracture: true, fractureGrid: [2, 1] },
    // Supply & ammo crates perched on the overhead gantry (crash down when shoring snaps!)
    { id: 'crate_w', pos: [-2.4, deckY + 0.58, z], half: [0.58, 0.48, 0.54], mat: 'plywood', color: 0x9c784a, hp: 90, tier: 0, anchored: false, kind: 'wall', materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'infill' },
    { id: 'crate_e', pos: [2.2, deckY + 0.58, z], half: [0.58, 0.48, 0.54], mat: 'plywood', color: 0x8c683e, hp: 90, tier: 0, anchored: false, kind: 'wall', materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'infill' },
  ];

  return {
    id: `cave.shoring.${idx}`,
    tag: `cave.shoring.${idx}`,
    kind: 'caveShoring',
    label: 'MINE SHORING GANTRY',
    value: 44_000,
    batched: true,
    nodes,
    links: [
      ['post_w', 'crossbeam'],
      ['post_e', 'crossbeam'],
      ['crossbeam', 'gantry_deck'],
      ['gantry_deck', 'crate_w'],
      ['gantry_deck', 'crate_e'],
    ],
    collapseThreshold: 0.4,
  };
}

/** Faceted crystalline pale salt-vein boulder (solid waist/chest-high cover inside the cavern). */
function saltCrystalBoulder(
  k: Kit,
  x: number,
  z: number,
  rx: number,
  rz: number,
  h: number,
  yaw: number,
): void {
  const g = k.geo;
  k.push(x, FLOOR_Y, z, yaw);
  // Faceted sandstone base pedestal
  g.use('concrete').tint(CAVE_WALL_MID[0], CAVE_WALL_MID[1], CAVE_WALL_MID[2]);
  g.bevel(0, h * 0.25, 0, rx * 1.05, h * 0.25, rz * 1.05, 0.22);
  // Crystalline pale salt-vein upper spires
  g.use('paintWhite').tint(SALT_TINT[0], SALT_TINT[1], SALT_TINT[2]);
  g.bevel(0, h * 0.68, 0, rx * 0.82, h * 0.34, rz * 0.78, 0.25);
  g.bevel(rx * 0.32, h * 0.88, -rz * 0.2, rx * 0.36, h * 0.24, rz * 0.34, 0.14);
  g.tint(1);
  k.collide(0, h * 0.5, 0, rx * 0.9, h * 0.5, rz * 0.9, 'concrete');
  k.pop();
}

/** Hanging warm amber miner work-lamp suspended by cable from the cavern ceiling. */
function hangingMinerLamp(k: Kit, x: number, y: number, z: number, intensity = 24, radius = 16): void {
  const g = k.geo;
  g.use('steelDark').cyl(x, y + 0.12, z, x, CEIL_Y, z, 0.025, 0.025, 4, false, false);
  g.use('rust').bevel(x, y + 0.12, z, 0.32, 0.08, 0.32, 0.03);
  g.use('emissiveOrange').box(x, y - 0.06, z, 0.16, 0.12, 0.16, FACE.all);
  k.light(x, y - 0.45, z, DESERT_PALETTE.dawnAmber, intensity, radius);
}

/** Sculpted hanging sandstone stalactite (purely visual overhead detail, well above player headroom). */
function stalactite(k: Kit, x: number, z: number, r: number, drop: number): void {
  const g = k.geo;
  g.use('concrete').tint(CAVE_WALL_DARK[0], CAVE_WALL_DARK[1], CAVE_WALL_DARK[2]);
  g.cyl(x, CEIL_Y - drop, z, x, CEIL_Y + 0.1, z, r * 0.12, r, 6, true, false);
  g.tint(1);
}

export function authorDesertCave(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const cp = SALT_CAVE_PIT; // x: -13..+13, z: -201.5..-148.5
  const rampS0 = cp.z1; // -148.5
  const rampS1 = -156.5;
  const rampN0 = -193.5;
  const rampN1 = cp.z0; // -201.5

  // --- 1. Smooth Walkable Entry & Exit Ramps + Main Salt Cavern Floor (exact y = -2.5) ---
  // South descending ramp: (0, 0, -148.5) -> (0, -2.5, -156.5) (w = 12.6 m, run = 8.0 m, ny = 0.954!)
  k.ramp(0, rampS0, 0, 0, rampS1, FLOOR_Y, PORTAL_HALF_W * 2, 'dirt', 0.7, false);
  // Main Cavern compacted sandstone & salt floor (x = -12.8..+12.8, z = -194.2..-155.8, exact y = -2.5)
  k.floor('dirt', -HALF_W - 0.8, rampN0 - 0.7, HALF_W + 0.8, rampS1 + 0.7, FLOOR_Y, 0.8, 6);
  // North ascending exit ramp: (0, -2.5, -193.5) -> (0, 0, -201.5) (w = 12.6 m, run = 8.0 m, ny = 0.954!)
  k.ramp(0, rampN0, FLOOR_Y, 0, rampN1, 0, PORTAL_HALF_W * 2, 'dirt', 0.7, false);

  // Decorative pale crystalline salt crust inlays flush on the cavern floor
  g.use('paintWhite').tint(SALT_TINT[0] * 0.88, SALT_TINT[1] * 0.90, SALT_TINT[2] * 0.92);
  g.gridStep(-9.5, FLOOR_Y + 0.018, -158, 4.2, 0, 0, 0, 0, -33, 8);
  g.gridStep(5.2, FLOOR_Y + 0.018, -158, 4.4, 0, 0, 0, 0, -33, 8);
  g.tint(1);

  // --- 2. Sculpted South & North Sandstone Cave Mouth Arches + Ramp Funnel Walls ---
  k.noClimb(() => {
    // South portal piers & ramp chute walls (x = -13.8..-6.3 and +6.3..+13.8, z = -156.5..-148.0)
    for (const side of [-1, 1] as const) {
      const x0 = side < 0 ? -14.2 : PORTAL_HALF_W;
      const x1 = side < 0 ? -PORTAL_HALF_W : 14.2;
      g.use('concrete').tint(CAVE_WALL_MID[0], CAVE_WALL_MID[1], CAVE_WALL_MID[2]);
      k.block('concrete', x0, FLOOR_Y, rampS1, x1, 6.2, rampS0 + 0.6, 0.35);
      // North portal piers & exit ramp chute walls (z = -202.0..-193.5)
      k.block('concrete', x0, FLOOR_Y, rampN1 - 0.6, x1, 6.2, rampN0, 0.35);
    }
    // Overhanging red-sandstone arch brows crowning both South Mouth (-148.5) & North Exit (-201.5)
    g.use('concrete').tint(CAVE_WALL_DARK[0], CAVE_WALL_DARK[1], CAVE_WALL_DARK[2]);
    k.block('concrete', -15.0, 5.3, rampS1, 15.0, 11.2, rampS0 + 0.8, 0.45);
    k.block('concrete', -15.0, 5.3, rampN1 - 0.8, 15.0, 11.2, rampN0, 0.45);
    g.tint(1);
  });

  // --- 3. Sculpted Stepped Sandstone Main Cavern Walls & Natural Vaulted Rock Ceiling ---
  k.noClimb(() => {
    // West & East main cavern walls (x = ±12.0, z = -194..-156, y = -2.5..+6.2)
    g.use('concrete').tint(CAVE_WALL_MID[0], CAVE_WALL_MID[1], CAVE_WALL_MID[2]);
    k.block('concrete', -HALF_W - 2.6, FLOOR_Y, rampN0 - 0.5, -HALF_W, CEIL_Y + 0.8, rampS1 + 0.5, 0.25);
    k.block('concrete', HALF_W, FLOOR_Y, rampN0 - 0.5, HALF_W + 2.6, CEIL_Y + 0.8, rampS1 + 0.5, 0.25);

    // Solid vaulted rock ceiling sealing the entire Salt Cavern (`y = 5.4 .. 7.4`)
    g.use('concreteDark').tint(CAVE_WALL_DARK[0], CAVE_WALL_DARK[1], CAVE_WALL_DARK[2]);
    k.block('concreteDark', -HALF_W - 2.8, CEIL_Y, rampN0 - 0.8, HALF_W + 2.8, CEIL_Y + 2.0, rampS1 + 0.8, 0.2);

    // Exterior sculpted red-sandstone mountain massif crowning the cave (`y = 7.4 .. 15.5`, visual + collider)
    g.use('concrete').tint(DESERT_PALETTE.mesaLight[0], DESERT_PALETTE.mesaLight[1], DESERT_PALETTE.mesaLight[2]);
    g.bevel(0, 10.6, -175, 19.5, 3.4, 24.0, 1.8);
    g.use('concrete').tint(DESERT_PALETTE.mesaDark[0], DESERT_PALETTE.mesaDark[1], DESERT_PALETTE.mesaDark[2]);
    g.bevel(-4.0, 14.2, -173, 13.0, 2.2, 16.5, 1.4);
    g.tint(1);

    // Flanking west canyon massif sealing x = -41..-14 outside the cave & east separation ridge at x = +40.5
    // (Keeps Eastern Convoy Bypass Road x = +43..+58 completely flat and unobstructed!)
    k.block('concrete', -42, 0, -196, -14.2, 12.5, -148, 0.8);
    k.wall(40.5, -152, 40.5, -190, 0, 7.2, {
      mat: 'concrete',
      backing: 'concreteDark',
      thick: 2.8,
      bay: 12,
      pilasters: false,
    });
  });

  // Sculpted inward-jutting natural rock ribs & overhead cavern vault arches every 9 m (visual strata!)
  for (const rz of [-162, -171, -180, -189]) {
    g.use('concrete').tint(CAVE_WALL_DARK[0], CAVE_WALL_DARK[1], CAVE_WALL_DARK[2]);
    for (const side of [-1, 1] as const) {
      g.bevel(side * (HALF_W - 0.65), (FLOOR_Y + CEIL_Y) / 2, rz, 0.75, (CEIL_Y - FLOOR_Y) / 2, 1.1, 0.25);
    }
    // Overhead sandstone vault arch rib
    g.bevel(0, CEIL_Y - 0.28, rz, HALF_W, 0.36, 0.95, 0.16);
    g.tint(1);
  }

  // Hanging natural stalactites crowning the high cavern vault (visual, all y >= 3.7 -> > 6.2 m headroom!)
  for (const [sx, sz, r, drop] of [
    [-8.5, -160, 0.55, 1.3],
    [8.2, -165, 0.62, 1.5],
    [-3.5, -167, 0.45, 1.1],
    [4.2, -173, 0.58, 1.4],
    [-8.8, -178, 0.65, 1.6],
    [8.6, -183, 0.55, 1.3],
    [-4.0, -186, 0.48, 1.2],
    [3.8, -191, 0.52, 1.3],
  ] as const) {
    stalactite(k, sx, sz, r, drop);
  }

  // --- 4. Two Monumental Floor-to-Ceiling Sandstone/Salt Pillars + 6 Crystalline Salt Cover Boulders ---
  for (const [px, pz] of [
    [-6.6, -167.5],
    [6.6, -182.5],
  ] as const) {
    g.use('concrete').tint(CAVE_WALL_MID[0], CAVE_WALL_MID[1], CAVE_WALL_MID[2]);
    g.bevel(px, (FLOOR_Y + CEIL_Y) / 2, pz, 1.35, (CEIL_Y - FLOOR_Y) / 2, 1.35, 0.32);
    g.use('paintWhite').tint(SALT_TINT[0], SALT_TINT[1], SALT_TINT[2]);
    g.bevel(px + (px < 0 ? 0.9 : -0.9), FLOOR_Y + 1.5, pz, 0.55, 1.4, 0.72, 0.16);
    g.tint(1);
    k.noClimb(() => k.collide(px, (FLOOR_Y + CEIL_Y) / 2, pz, 1.35, (CEIL_Y - FLOOR_Y) / 2, 1.35, 'concrete'));
  }

  // 6 Faceted Pale Crystalline Salt-Vein Boulders (waist/chest cover keeping center lane x = -3.5..+3.5 open!)
  for (const [bx, bz, rx, rz, h, yaw] of [
    [-5.2, -160, 1.35, 1.05, 1.55, 0.3],
    [5.6, -163, 1.45, 1.1, 1.65, -0.4],
    [-8.2, -175, 1.6, 1.25, 1.95, 0.2],
    [8.0, -174, 1.55, 1.2, 1.85, -0.25],
    [-5.4, -187, 1.4, 1.05, 1.6, 0.35],
    [5.6, -186, 1.35, 1.05, 1.55, -0.3],
  ] as const) {
    saltCrystalBoulder(k, bx, bz, rx, rz, h, yaw);
  }

  // --- 5. Four Destructible Timber Mine-Shoring Arch & Overhead Ammo Gantry Clusters (`materialClass: 'wood'`) ---
  for (let i = 0; i < 4; i++) {
    const sz = -162 - i * 9; // -162, -171, -180, -189
    spec.cluster(buildCaveShoringCluster(i, sz));
  }

  // Overhead power cable festooning the hanging miner work-lamps down the spine of the Salt Cave
  cable(k, 0, CEIL_Y - 0.6, -152, 0, CEIL_Y - 0.6, -176, 0.65, 0.03);
  cable(k, 0, CEIL_Y - 0.6, -176, 0, CEIL_Y - 0.6, -198, 0.65, 0.03);

  // --- 6. Warm Amber Hanging Miner Work-Lamps (8 lights) + Subtle Crystalline Salt Glows (2 lights) = 10 lights ---
  hangingMinerLamp(k, 0, 4.1, -152, 26, 16);
  hangingMinerLamp(k, -2.5, 4.2, -160, 24, 16);
  hangingMinerLamp(k, 2.5, 4.2, -168, 24, 16);
  hangingMinerLamp(k, 0, 4.2, -176, 26, 18);
  hangingMinerLamp(k, -2.5, 4.2, -184, 24, 16);
  hangingMinerLamp(k, 2.5, 4.2, -192, 24, 16);
  hangingMinerLamp(k, 0, 4.1, -198, 26, 16);
  // Warm beacon glowing just outside the North Exit Arch framing the Cargo Plane reveal
  k.light(0, 3.6, -203.5, DESERT_PALETTE.dawnAmber, 28, 16);
  // 2 Subtle pale-cyan crystalline salt-vein accent glows on the flanking salt formations
  k.light(-7.6, FLOOR_Y + 1.6, -175, 0x8ad8ee, 14, 11);
  k.light(7.4, FLOOR_Y + 1.6, -174, 0x8ad8ee, 14, 11);

  // Minimap plan blocks framing the Salt Cave canyon walls
  spec.plan?.walls.push(
    { ax: -13, az: rampS0, bx: -13, bz: rampN1, half: 1.4 },
    { ax: 13, az: rampS0, bx: 13, bz: rampN1, half: 1.4 },
    { ax: 40.5, az: -152, bx: 40.5, bz: -190, half: 1.4 },
  );
}
