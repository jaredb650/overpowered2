/**
 * Surplus — Section 5: The High Terraces ("The Perches", z = -80 .. -148).
 *
 * A dramatic 3-tier vertical desert shantytown amphitheater carved into red-sandstone ledges:
 *   - Tier 1 Courtyard (`y = 0`, `z = -80..-102`): Player emerges from the Dark Storm Sewer at
 *     `HIGH_TERRACES.sewerExitTop = [0, 0, -81]` facing uphill into elevated towers and tents.
 *   - Tier 2 Mid-Terrace (`y = 3.6`, `z = -102..-140`): Reached via twin broad sandstone switchback
 *     ramps (`x = -18.5, +19.5`) + a central stepped stairway (`x = 0`), with a broad central canyon
 *     ramp descending north from `(0, 3.6, -127.5)` straight down to the Salt Cave mouth `[0, 0, -148]`.
 *   - Tier 3 Upper Ridge Overlooks (`y = 7.2`, `z = -136..-147`): Twin commanding sandstone overlooks
 *     flanking the cave gorge, linked by stairs from Tier 2 and destructible timber catwalks to towers.
 *   - 6 Tall Timber-Stilt Guard Towers at `HIGH_TERRACES.towers` (`materialClass: 'wood'` legs, `hp: 140`)
 *     and 6 Elevated Canvas-and-Timber Stilted Tents at `HIGH_TERRACES.tents` (`materialClass: 'wood'`
 *     stilts `hp: 120`, colorful desert-cloth walls & roofs) — shoot out the wooden supports to make
 *     towers and tents twist, splinter, and collapse onto defenders inside and on top!
 *   - Keeps the far east shelf (`x = +43..+58`, `y = 0`) flat and unobstructed as the Eastern Convoy
 *     Bypass Road, separated from the combat terraces by a sculpted sandstone ridge at `x = +40.5`.
 */
import {
  createNavNodeProxy,
  type StructuralClusterSpec,
  type StructuralNodeSpec,
} from '../../destruction';
import { FACE } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { cable, tyres } from '../../kit/props';
import type { MapSpec } from '../spec';
import { DESERT_PALETTE, sandstoneMesa, type Rgb } from './dunes';
import { HIGH_TERRACES, type Pt3 } from './plan';

const T2 = HIGH_TERRACES.tier2Y; // 3.6
const T3 = HIGH_TERRACES.tier3Y; // 7.2

const TENT_PALETTE: readonly number[] = [
  0xc86438, // terracotta desert cloth
  0xd09a46, // sun-baked saffron ochre
  0xa8382c, // Saltblood crimson canvas
  0xcab48a, // bleached alkali linen
  0x5f8278, // faded oasis teal cloth
  0xb86e3c, // burnt sienna canvas
];

/**
 * Builds one of the 6 Tall Timber-Stilt Guard Towers at `HIGH_TERRACES.towers`.
 * Platform sits +3.6 m above `yBase` (exact `y = 3.6` for Tier 1 towers, exact `y = 7.2` for Tier 2 towers!).
 * Shooting/blasting 2 of the 4 timber legs (`materialClass: 'wood'`, `hp: 140`) causes the tower to
 * bend, splinter, groan, sag, and crash down!
 */
function buildTerraceTowerCluster(
  k: Kit,
  idx: number,
  pos: Pt3,
  withNavProxy: boolean,
): StructuralClusterSpec {
  const [x, yBase, z] = pos;
  const W = 1.8;
  const D = 1.75;
  const deckHalfY = 0.14;
  const legH = 3.6 - deckHalfY * 2; // 3.32 m -> deck top sits at exact yBase + 3.6!
  const deckY = yBase + 3.6 - deckHalfY;
  const deckTop = yBase + 3.6;

  const deck: StructuralNodeSpec = {
    id: 'deck',
    pos: [x, deckY, z],
    half: [W + 0.45, deckHalfY, D + 0.45],
    mat: 'plywood',
    color: 0x926d44,
    hp: 155,
    tier: 0,
    anchored: false,
    kind: 'slab',
    impactRadius: 8.5,
    materialClass: 'wood',
  };

  const nodes: StructuralNodeSpec[] = [
    // 4 Timber stilt legs (`materialClass: 'wood'`, `hp: 140`, anchored)
    { id: 'leg_sw', pos: [x - W, yBase + legH / 2, z + D], half: [0.2, legH / 2, 0.2], mat: 'plywood', color: 0x735133, hp: 140, tier: 0, anchored: true, kind: 'column', materialClass: 'wood' },
    { id: 'leg_se', pos: [x + W, yBase + legH / 2, z + D], half: [0.2, legH / 2, 0.2], mat: 'plywood', color: 0x735133, hp: 140, tier: 0, anchored: true, kind: 'column', materialClass: 'wood' },
    { id: 'leg_nw', pos: [x - W, yBase + legH / 2, z - D], half: [0.2, legH / 2, 0.2], mat: 'plywood', color: 0x67472c, hp: 140, tier: 0, anchored: true, kind: 'column', materialClass: 'wood' },
    { id: 'leg_ne', pos: [x + W, yBase + legH / 2, z - D], half: [0.2, legH / 2, 0.2], mat: 'plywood', color: 0x67472c, hp: 140, tier: 0, anchored: true, kind: 'column', materialClass: 'wood' },
    deck,
    // Waist-high corrugated metal sniper parapets facing south (+Z) & outer flanks (leaving catwalk entry clear!)
    { id: 'parapet_s', pos: [x, deckTop + 0.48, z + D + 0.24], half: [W + 0.35, 0.48, 0.16], mat: 'rust', color: 0x8e5236, hp: 150, tier: 0, anchored: false, kind: 'wall', materialClass: 'metal', fractureGrid: [2, 1] },
    ...(idx !== 4
      ? [{ id: 'parapet_w', pos: [x - W - 0.24, deckTop + 0.45, z] as readonly [number, number, number], half: [0.16, 0.45, D + 0.1] as readonly [number, number, number], mat: 'rust' as const, color: 0x7e4a30, hp: 140, tier: 0 as const, anchored: false, kind: 'wall' as const, materialClass: 'metal' as const }]
      : []),
    ...(idx !== 5
      ? [{ id: 'parapet_e', pos: [x + W + 0.24, deckTop + 0.45, z] as readonly [number, number, number], half: [0.16, 0.45, D + 0.1] as readonly [number, number, number], mat: 'rust' as const, color: 0x7e4a30, hp: 140, tier: 0 as const, anchored: false, kind: 'wall' as const, materialClass: 'metal' as const }]
      : []),
    // Canopy timber corner posts + corrugated roof canopy
    { id: 'canopy_roof', pos: [x, deckTop + 2.55, z], half: [W + 0.6, 0.12, D + 0.6], mat: 'rust', color: 0x8a5234, hp: 145, tier: 0, anchored: false, kind: 'roof', impactRadius: 7.5, materialClass: 'metal', fractureGrid: [2, 2] },
  ];

  const links: [string, string][] = [
    ['leg_sw', 'deck'],
    ['leg_se', 'deck'],
    ['leg_nw', 'deck'],
    ['leg_ne', 'deck'],
    ['deck', 'parapet_s'],
    ...(idx !== 4 ? [['deck', 'parapet_w'] as [string, string]] : []),
    ...(idx !== 5 ? [['deck', 'parapet_e'] as [string, string]] : []),
    ['deck', 'canopy_roof'],
  ];

  const navProxies = withNavProxy
    ? [createNavNodeProxy(k.physics, deck)].filter((c): c is NonNullable<typeof c> => c !== null)
    : undefined;

  return {
    id: `terraces.tower.${idx}`,
    tag: `terraces.tower.${idx}`,
    kind: 'terraceTower',
    label: 'TERRACE GUARD TOWER',
    value: 82_000,
    nodes,
    links,
    collapseThreshold: 0.35,
    navProxies,
  };
}

/**
 * Builds one of the 6 Elevated Canvas-and-Timber Stilted Tents at `HIGH_TERRACES.tents`.
 * Raised on 4 visible timber stilts (`stiltH = 1.45 m`, `hp: 120`, `materialClass: 'wood'`) with open
 * south firing bays so enemies stand INSIDE and ON TOP of the tent — shooting out the stilts collapses
 * the entire deck and canopy onto everyone inside!
 */
function buildTerraceTentCluster(idx: number, pos: Pt3): StructuralClusterSpec {
  const [x, yBase, z] = pos;
  const W = 2.4;
  const D = 2.0;
  const stiltH = 1.45;
  const deckHalfY = 0.12;
  const deckY = yBase + stiltH + deckHalfY;
  const floorTop = deckY + deckHalfY;
  const wallH = 2.25;
  const roofY = floorTop + wallH + 0.12;
  const clothColor = TENT_PALETTE[idx % TENT_PALETTE.length]!;

  const nodes: StructuralNodeSpec[] = [
    // 4 visible wooden stilts lifting the tent platform off the terrace (`hp: 120`, `materialClass: 'wood'`)
    { id: 'stilt_sw', pos: [x - W + 0.25, yBase + stiltH / 2, z + D - 0.25], half: [0.16, stiltH / 2, 0.16], mat: 'plywood', color: 0x6f4d30, hp: 120, tier: 0, anchored: true, kind: 'column', materialClass: 'wood' },
    { id: 'stilt_se', pos: [x + W - 0.25, yBase + stiltH / 2, z + D - 0.25], half: [0.16, stiltH / 2, 0.16], mat: 'plywood', color: 0x6f4d30, hp: 120, tier: 0, anchored: true, kind: 'column', materialClass: 'wood' },
    { id: 'stilt_nw', pos: [x - W + 0.25, yBase + stiltH / 2, z - D + 0.25], half: [0.16, stiltH / 2, 0.16], mat: 'plywood', color: 0x63442a, hp: 120, tier: 0, anchored: true, kind: 'column', materialClass: 'wood' },
    { id: 'stilt_ne', pos: [x + W - 0.25, yBase + stiltH / 2, z - D + 0.25], half: [0.16, stiltH / 2, 0.16], mat: 'plywood', color: 0x63442a, hp: 120, tier: 0, anchored: true, kind: 'column', materialClass: 'wood' },
    // Elevated wooden plank tent floor deck
    { id: 'tent_deck', pos: [x, deckY, z], half: [W + 0.2, deckHalfY, D + 0.2], mat: 'plywood', color: 0x8f6b44, hp: 130, tier: 0, anchored: false, kind: 'slab', impactRadius: 7.0, materialClass: 'wood' },
    // Colorful desert-cloth tent walls (south face left open as a firing porch!)
    { id: 'cloth_w', pos: [x - W + 0.1, floorTop + wallH / 2, z], half: [0.1, wallH / 2, D - 0.15], mat: 'paintWhite', color: clothColor, hp: 95, tier: 0, anchored: false, kind: 'wall', materialClass: 'wood', fractureGrid: [2, 2] },
    { id: 'cloth_e', pos: [x + W - 0.1, floorTop + wallH / 2, z], half: [0.1, wallH / 2, D - 0.15], mat: 'paintWhite', color: clothColor, hp: 95, tier: 0, anchored: false, kind: 'wall', materialClass: 'wood', fractureGrid: [2, 2] },
    { id: 'cloth_b', pos: [x, floorTop + wallH / 2, z - D + 0.1], half: [W - 0.2, wallH / 2, 0.1], mat: 'paintWhite', color: clothColor, hp: 100, tier: 0, anchored: false, kind: 'wall', materialClass: 'wood', fractureGrid: [2, 2] },
    // Low front sandbag/timber lip on the open south tent porch
    { id: 'front_lip', pos: [x, floorTop + 0.42, z + D - 0.1], half: [W - 0.25, 0.42, 0.14], mat: 'plywood', color: 0x886440, hp: 105, tier: 0, anchored: false, kind: 'wall', materialClass: 'wood' },
    // Sturdy colorful canvas-and-timber roof deck (enemies stand ON TOP of the tent too!)
    { id: 'tent_roof', pos: [x, roofY, z], half: [W + 0.45, 0.14, D + 0.45], mat: 'paintWhite', color: clothColor, hp: 115, tier: 0, anchored: false, kind: 'roof', impactRadius: 7.5, materialClass: 'wood', fractureGrid: [2, 2] },
  ];

  const links: [string, string][] = [
    ['stilt_sw', 'tent_deck'],
    ['stilt_se', 'tent_deck'],
    ['stilt_nw', 'tent_deck'],
    ['stilt_ne', 'tent_deck'],
    ['tent_deck', 'cloth_w'],
    ['tent_deck', 'cloth_e'],
    ['tent_deck', 'cloth_b'],
    ['tent_deck', 'front_lip'],
    ['cloth_w', 'tent_roof'],
    ['cloth_e', 'tent_roof'],
    ['cloth_b', 'tent_roof'],
    ['tent_deck', 'tent_roof'],
  ];

  return {
    id: `terraces.tent.${idx}`,
    tag: `terraces.tent.${idx}`,
    kind: 'terraceTent',
    label: 'STILTED SALTBLOOD TENT',
    value: 56_000,
    nodes,
    links,
    collapseThreshold: 0.35,
  };
}

/** Builds a destructible overhead timber/rope catwalk connecting towers and terrace ledges. */
function buildTerraceCatwalkCluster(
  k: Kit,
  idx: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  y: number,
  yBase: number,
): StructuralClusterSpec {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  const yaw = Math.atan2(-dz, dx);
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  const deckHalfY = 0.1;
  const postH = y - deckHalfY * 2 - yBase;

  const deck: StructuralNodeSpec = {
    id: 'catwalk_planks',
    pos: [mx, y - deckHalfY, mz],
    half: [len / 2 + 0.2, deckHalfY, 1.05],
    mat: 'plywood',
    color: 0x85603c,
    hp: 115,
    tier: 0,
    anchored: false,
    kind: 'catwalk',
    yaw,
    impactRadius: 6.0,
    materialClass: 'wood',
  };

  const nodes: StructuralNodeSpec[] = [
    { id: 'post_a', pos: [ax, yBase + postH / 2, az], half: [0.16, postH / 2, 0.75], mat: 'plywood', color: 0x6c4c2f, hp: 110, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood' },
    { id: 'post_b', pos: [bx, yBase + postH / 2, bz], half: [0.16, postH / 2, 0.75], mat: 'plywood', color: 0x6c4c2f, hp: 110, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood' },
    deck,
  ];

  const navProxies = [createNavNodeProxy(k.physics, deck)].filter((c): c is NonNullable<typeof c> => c !== null);

  return {
    id: `terraces.catwalk.${idx}`,
    tag: `terraces.catwalk.${idx}`,
    kind: 'terraceCatwalk',
    label: 'TIMBER OVERHEAD CATWALK',
    value: 32_000,
    nodes,
    links: [
      ['post_a', 'catwalk_planks'],
      ['post_b', 'catwalk_planks'],
    ],
    collapseThreshold: 0.45,
    navProxies,
  };
}

/** Builds sculpted sandstone terrace ledges (Tier 2 at y = 3.6, Tier 3 at y = 7.2) + walkable ramps & stairs. */
function buildTerraceLandform(k: Kit, spec: MapSpec): void {
  const g = k.geo;

  // --- Tier 2 Main Sandstone Amphitheater Shelf (y = 3.6, x = -38..+38, z = -127.5..-102.0) ---
  // Solid mesa rock body underneath (`y = 0 .. 3.6`) with warm desert sandstone tint
  g.use('concrete').tint(DESERT_PALETTE.mesaLight[0], DESERT_PALETTE.mesaLight[1], DESERT_PALETTE.mesaLight[2]);
  k.floor('concrete', -38, -127.5, 38, -102.0, T2, T2, 8);
  g.tint(1);
  // Subtle sandy dust cap on Tier 2 deck surface
  g.use('dirt').tint(DESERT_PALETTE.townDust[0], DESERT_PALETTE.townDust[1], DESERT_PALETTE.townDust[2]);
  g.gridStep(-37.8, T2 + 0.015, -102.2, 75.6, 0, 0, 0, 0, -25.1, 10);
  g.tint(1);
  spec.plan?.decks.push({ x0: -38, z0: -127.5, x1: 38, z1: -102.0 });

  // --- Tier 2 North-West & North-East Flanking Wings (y = 3.6, z = -140..-127.5) ---
  // Leaves a clean 15 m central pass (`x = -7.5 .. +7.5`) ramping down into the Salt Cave mouth!
  k.floor('concrete', -38, -140.0, -7.5, -127.5, T2, T2, 7);
  k.floor('concrete', 7.5, -140.0, 38, -127.5, T2, T2, 7);
  spec.plan?.decks.push(
    { x0: -38, z0: -140.0, x1: -7.5, z1: -127.5 },
    { x0: 7.5, z0: -140.0, x1: 38, z1: -127.5 },
  );
  // Guardrails edging the central cave-gorge drop-off along x = ±7.5
  k.rail([-7.4, T2, -127.6, -7.4, T2, -139.8], 1.0, 2.6);
  k.rail([7.4, T2, -127.6, 7.4, T2, -139.8], 1.0, 2.6);

  // --- 3 Broad Walkable Climbs from Tier 1 (y = 0) up to Tier 2 (y = 3.6) ---
  // 1. Central Stepped Sandstone/Steel Stairway (x = 0, w = 4.8 m, z = -94 -> -102, ny = 0.912)
  k.stairs(0, -94.0, 0, 0, -102.0, T2, 4.8, 'concrete', true);
  // 2. West Switchback Sandstone Ramp (x = -18.5, w = 3.8 m, z = -94 -> -102, ny = 0.912)
  k.ramp(-18.5, -94.0, 0, -18.5, -102.0, T2, 3.8, 'dirt', 0.65, true);
  // 3. East Switchback Sandstone Ramp (x = +19.5, w = 3.8 m, z = -94 -> -102, ny = 0.912)
  k.ramp(19.5, -94.0, 0, 19.5, -102.0, T2, 3.8, 'dirt', 0.65, true);

  // --- Central Pass Ramp Descending North from Tier 2 (y = 3.6) down to Cave Gorge (y = 0) ---
  // Runs north from (0, 3.6, -127.5) down to (0, 0, -137.5) (w = 8.0 m, run = 10.0 m, ny = 0.941!)
  k.ramp(0, -127.5, T2, 0, -137.5, 0, 8.0, 'dirt', 0.65, true);
  // Solid sandstone canyon flanks narrowing cleanly from z = -140 to the Salt Cave mouth at z = -148.5
  k.noClimb(() => {
    k.block('concrete', -38, 0, -148.5, -7.5, T2, -140.0, 0.2);
    k.block('concrete', 7.5, 0, -148.5, 38, T2, -140.0, 0.2);
  });

  // --- Tier 3 Twin Upper Ridge Overlooks (y = 7.2, flanking the Salt Cave gorge) ---
  // West Upper Ridge: x = -38..-21, z = -147..-136 (exact top y = 7.2)
  k.floor('concrete', -38, -147.0, -21, -136.0, T3, T3 - T2, 6);
  // East Upper Ridge: x = +21..+38, z = -147..-136 (exact top y = 7.2)
  k.floor('concrete', 21, -147.0, 38, -136.0, T3, T3 - T2, 6);
  spec.plan?.decks.push(
    { x0: -38, z0: -147.0, x1: -21, z1: -136.0 },
    { x0: 21, z0: -147.0, x1: 38, z1: -136.0 },
  );
  // Safety rails on south overlooks of Tier 3
  k.rail([-37.5, T3, -136.1, -24.2, T3, -136.1], 1.0, 2.6);
  k.rail([24.5, T3, -136.1, 37.5, T3, -136.1], 1.0, 2.6);

  // Walkable stairs climbing from Tier 2 (y = 3.6) up to Tier 3 Upper Ridges (y = 7.2)
  // West stair at x = -22.5 (between Tent 4 [-28,-128] & Tower 4 [-16,-134]): run = 7.5 m, ny = 0.902
  k.stairs(-22.5, -128.5, T2, -22.5, -136.0, T3, 2.4, 'steel', true);
  // East stair at x = +22.8 (between Tower 5 [18,-134] & Tent 5 [28,-128]): run = 7.5 m, ny = 0.902
  k.stairs(22.8, -128.5, T2, 22.8, -136.0, T3, 2.4, 'steel', true);

  // Decorative terraced red-sandstone cliff fascia stripes along the south face of Tier 2
  g.use('concrete').tint(DESERT_PALETTE.mesaDark[0], DESERT_PALETTE.mesaDark[1], DESERT_PALETTE.mesaDark[2]);
  for (const fx of [-30, -9, 9, 30]) {
    g.bevel(fx, 1.8, -101.8, 4.5, 1.75, 0.35, 0.14);
  }
  g.tint(1);
}

/**
 * Builds the West Canyon Cliff, the East Separating Berm/Rock Ridge (keeping the Eastern Convoy Bypass
 * Road at `x = +43..+58`, `y = 0` completely flat & unobstructed!), and the Far East Outer Canyon Cliff.
 */
function buildTerraceCanyonWalls(k: Kit, spec: MapSpec): void {
  k.noClimb(() => {
    // West Sandstone Canyon Wall sealing the High Terraces west flank (x = -41, z = -56..-152)
    k.wall(-41, -56, -41, -152, 0, 11.5, {
      mat: 'concrete',
      backing: 'concreteDark',
      thick: 2.6,
      bay: 12,
      pilasters: false,
    });
    // East Separating Sandstone Ridge along x = +40.5 (z = -58..-152, h = 6.8 m)
    // Separates the High Terraces amphitheater (x <= 38) from the flat Eastern Convoy Bypass Road (x = 43..58)!
    k.wall(40.5, -58, 40.5, -152, 0, 6.8, {
      mat: 'concrete',
      backing: 'concreteDark',
      thick: 2.8,
      bay: 12,
      pilasters: false,
    });
    // Far East Outer Canyon Wall framing the Eastern Convoy Bypass Road along x = +62 (z = -56..-212)
    k.wall(62, -56, 62, -212, 0, 12.0, {
      mat: 'concrete',
      backing: 'concreteDark',
      thick: 2.8,
      bay: 16,
      pilasters: false,
    });
  });

  spec.plan?.walls.push(
    { ax: -41, az: -56, bx: -41, bz: -152, half: 1.3 },
    { ax: 40.5, az: -58, bx: 40.5, bz: -152, half: 1.4 },
    { ax: 62, az: -56, bx: 62, bz: -212, half: 1.4 },
  );
}

/** Hanging village bunting & warm torch braziers lighting the vertical village amphitheater. */
function villageBunting(k: Kit, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
  const g = k.geo;
  const sag = 0.85;
  cable(k, ax, ay, az, bx, by, bz, sag, 0.02);
  const len = Math.hypot(bx - ax, bz - az);
  const count = Math.max(4, Math.round(len / 2.2));
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const y = ay + (by - ay) * t - sag * 4 * t * (1 - t);
    const dye: Rgb = DESERT_PALETTE.bannerDyes[i % DESERT_PALETTE.bannerDyes.length]!;
    g.use('paintWhite').tint(dye[0] * 1.15, dye[1] * 1.15, dye[2] * 1.15);
    g.box(x, y - 0.34, z, 0.32, 0.34, 0.015, FACE.pz | FACE.nz | FACE.px | FACE.nx);
  }
  g.tint(1);
}

export function authorDesertTerraces(k: Kit, spec: MapSpec): void {
  const g = k.geo;

  // 1. Sculpted 3-tier sandstone amphitheater terraces (y = 0, 3.6, 7.2) + walkable ramps & stairs
  buildTerraceLandform(k, spec);

  // 2. Canyon walls & East Separating Ridge preserving the flat Eastern Convoy Bypass Road (x = 43..58)
  buildTerraceCanyonWalls(k, spec);

  // 3. All 6 Tall Timber-Stilt Guard Towers at exact HIGH_TERRACES.towers (4 connected via catwalks have navProxies!)
  for (let i = 0; i < HIGH_TERRACES.towers.length; i++) {
    const pos = HIGH_TERRACES.towers[i]!;
    const hasCatwalk = i === 0 || i === 1 || i === 4 || i === 5;
    spec.cluster(buildTerraceTowerCluster(k, i, pos, hasCatwalk));
    spec.plan?.blocks.push({ x0: pos[0] - 2.2, z0: pos[2] - 2.2, x1: pos[0] + 2.2, z1: pos[2] + 2.2 });
    // Warm lantern under 4 of the 6 tower canopies (4 lights)
    if (i === 0 || i === 1 || i === 2 || i === 3) {
      k.light(pos[0], pos[1] + 5.6, pos[2] + 0.6, DESERT_PALETTE.lanternWarm, 28, 17);
    }
  }

  // 4. All 6 Elevated Canvas-and-Timber Stilted Tents at exact HIGH_TERRACES.tents
  for (let i = 0; i < HIGH_TERRACES.tents.length; i++) {
    const pos = HIGH_TERRACES.tents[i]!;
    spec.cluster(buildTerraceTentCluster(i, pos));
    spec.plan?.blocks.push({ x0: pos[0] - 2.5, z0: pos[2] - 2.1, x1: pos[0] + 2.5, z1: pos[2] + 2.1 });
    // Warm hearth lantern inside 2 upper tents (2 lights)
    if (i === 4 || i === 5) {
      k.light(pos[0], pos[1] + 3.0, pos[2] + 0.8, DESERT_PALETTE.dawnAmber, 24, 15);
    }
  }

  // 5. 4 Destructible Overhead Rope/Timber Catwalks bridging towers & upper ridges
  // Catwalks 0 & 1 connect Tier 1 Tower decks (y = 3.6) straight onto the Tier 2 terrace ledge!
  spec.cluster(buildTerraceCatwalkCluster(k, 0, -26, -96.2, -26, -102.0, T2, 0));
  spec.cluster(buildTerraceCatwalkCluster(k, 1, 26, -98.2, 26, -102.0, T2, 0));
  // Catwalks 2 & 3 connect Tier 3 Upper Ridges (y = 7.2) across to Tier 2 North Tower decks (y = 7.2)!
  spec.cluster(buildTerraceCatwalkCluster(k, 2, -21.0, -136.0, -17.8, -134.5, T3, T2));
  spec.cluster(buildTerraceCatwalkCluster(k, 3, 21.0, -136.0, 19.8, -134.5, T3, T2));

  // 6. Tactical sandstone cover rocks & scattered cover on Tier 1 & Tier 2 (keeping sewerExitTop & ramps wide open!)
  sandstoneMesa(k, spec, -7.0, -88.0, 2.1, 1.5, 1.45, 0.25, true);
  sandstoneMesa(k, spec, 7.5, -89.5, 2.2, 1.6, 1.5, -0.3, true);
  // Waist-high sandstone/timber cover barricades on Tier 2 mid-terrace (y = 3.6)
  for (const [bx, bz] of [
    [-10, -110],
    [10, -110],
    [-8, -121],
    [8, -121],
  ] as const) {
    k.block('concreteDark', bx - 1.8, T2, bz - 0.35, bx + 1.8, T2 + 1.15, bz + 0.35, 0.05);
  }

  // 2 isolated tactical fuel drums on the High Terraces (widely spaced!)
  spec.barrels(-14, T2, -118, 1);
  spec.barrels(15, T2, -112, 1);

  // Overhead desert village bunting & ropes tying the vertical towers together
  villageBunting(k, -26, 6.2, -94, -12, 5.2, -92);
  villageBunting(k, 14, 5.2, -92, 26, 6.2, -96);
  villageBunting(k, -22, 9.5, -114, 24, 9.5, -116);
  villageBunting(k, -16, 9.5, -134, 18, 9.5, -134);

  // Scattered tyre piles near Tier 1 & Tier 2 corners
  tyres(k, -33, 0, -86, 3, false);
  tyres(k, 34, 0, -88, 3, false);

  // Twin glowing sandstone torch braziers framing the Salt Cave Mouth ([0, 0, -148]) (2 lights)
  for (const sx of [-6.2, 6.2]) {
    g.use('rust').cyl(sx, 0, -146.5, sx, 1.35, -146.5, 0.36, 0.3, 8, false, false);
    g.use('emissiveOrange').cyl(sx, 1.28, -146.5, sx, 1.4, -146.5, 0.3, 0.3, 8, false, true);
    k.collide(sx, 0.7, -146.5, 0.38, 0.7, 0.38, 'metal', false);
    k.light(sx, 2.2, -146.5, DESERT_PALETTE.dawnAmber, 28, 16);
  }

  // Ramp work lamps at Tier 2 switchback heads (2 lights)
  k.light(-18.5, T2 + 2.2, -103, DESERT_PALETTE.lanternWarm, 24, 15);
  k.light(19.5, T2 + 2.2, -103, DESERT_PALETTE.lanternWarm, 24, 15);

  // Broad warm golden dawn skylight washes over the High Terraces amphitheater (2 lights -> total 12 in terraces.ts)
  k.light(0, 16, -96, DESERT_PALETTE.dawnWarm, 56, 36);
  k.light(0, 18, -126, DESERT_PALETTE.dawnWarm, 56, 38);
}
