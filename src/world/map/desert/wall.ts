/**
 * Surplus — The Wall (z = 62, x = -76 .. +76).
 *
 * The Section 2 broadside shooting-gallery centerpiece:
 *   - 32 Tier-0 destructible corrugated sheet-metal wall panel clusters spanning x = -76..-7 & +7..+76
 *     (leaving a clean 14 m Main Gate gap at x = -7..+7 for Lane 4's solid bulldozer gate).
 *   - 2 Tier-0 destructible side-gate scrap barricades at SIDE_GATES (x = -58 and x = +58).
 *   - 6 Tier-0 destructible watchtowers at WALL_TOWERS whose legs (hp: 100, tier: 0) tip the whole
 *     tower crashing down with its sandbag parapet, tin canopy, and rooftop red fuel drum!
 *   - Elevated steel/timber walkways behind the wall at z = 57.5, y = 3.4 (exact DESERT_LEVELS height)
 *     with stairs into the Warren so Saltblood defenders run along the wall and become exposed when
 *     wall panels blow clean off.
 *   - Outer warning banners, effigy poles, tyre stacks, Tier-0 sandbag nests, and flank containment walls.
 */
import type { StructuralClusterSpec, StructuralNodeSpec } from '../../destruction';
import { FACE } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { cable, tyres } from '../../kit/props';
import type { MapSpec } from '../spec';
import { DESERT_PALETTE, type Rgb } from './dunes';
import { DESERT_Z, MAIN_GATE, SIDE_GATES, WALL_TOWERS } from './plan';

const WALL_Z = DESERT_Z.wallLine; // 62
const WALK_Z = DESERT_Z.wallWalkway; // 57.5
const WALK_Y = 3.4; // Exact match with DESERT_LEVELS[3] = 3.4 so NavGraph samples every walkway cleanly!

const PANEL_COLORS: readonly number[] = [
  0x8e5638, // corrugated rust
  0xb0844c, // sun-baked ochre sheet
  0x6b7470, // weathered zinc
  0x9a4834, // oxidized red oxide
  0x7d6d56, // dusty scrap iron
  0x5d7a74, // faded salvage teal
];

/** Builds a single Tier-0 corrugated sheet-metal wall panel cluster (3.5–4 m wide, hp 75–115). */
function buildWallPanelCluster(
  idx: number,
  cx: number,
  width: number,
  withFuelDrum: boolean,
  withSandbags: boolean,
): StructuralClusterSpec {
  const hw = width / 2 - 0.06;
  const colLower = PANEL_COLORS[idx % PANEL_COLORS.length]!;
  const colUpper = PANEL_COLORS[(idx + 2) % PANEL_COLORS.length]!;
  const upperH = 2.0 + (idx % 3) * 0.28; // jagged scrap silhouette (total height 4.4..5.0 m)
  const lowerH = 2.4;

  const nodes: StructuralNodeSpec[] = [
    // Lower corrugated sheet bulkhead (Tier 0, anchored)
    {
      id: 'panel_lower',
      pos: [cx, lowerH / 2, WALL_Z],
      half: [hw, lowerH / 2, 0.22],
      mat: idx % 2 === 0 ? 'rust' : 'panel',
      color: colLower,
      hp: 105,
      tier: 0,
      anchored: true,
      kind: 'wall',
    },
    // Upper corrugated scrap parapet (Tier 0, supported by lower panel + brace post)
    {
      id: 'panel_upper',
      pos: [cx, lowerH + upperH / 2, WALL_Z],
      half: [hw - 0.04, upperH / 2, 0.16],
      mat: idx % 3 === 0 ? 'panel' : 'rust',
      color: colUpper,
      hp: 80,
      tier: 0,
      anchored: false,
      kind: 'wall',
    },
    // Vertical timber/steel scrap brace post behind panel
    {
      id: 'brace_post',
      pos: [cx + (idx % 2 === 0 ? -hw * 0.65 : hw * 0.65), 1.9, WALL_Z - 0.48],
      half: [0.16, 1.9, 0.18],
      mat: 'plywood',
      color: 0x76583a,
      hp: 85,
      tier: 0,
      anchored: true,
      kind: 'column',
    },
  ];

  const links: [string, string][] = [
    ['panel_lower', 'panel_upper'],
    ['brace_post', 'panel_upper'],
  ];

  if (withFuelDrum) {
    nodes.push({
      id: 'base_drum',
      pos: [cx, 0.56, WALL_Z + 0.85],
      half: [0.42, 0.56, 0.42],
      mat: 'paintRed',
      color: 0xcc2820,
      hp: 35,
      tier: 0,
      anchored: true,
      kind: 'hazard',
      hazardRadius: 9.2,
      hazardDamage: 225,
    });
  } else if (withSandbags) {
    nodes.push({
      id: 'base_sandbags',
      pos: [cx, 0.55, WALL_Z + 0.82],
      half: [hw * 0.72, 0.55, 0.42],
      mat: 'dirt',
      color: 0x9b8660,
      hp: 90,
      tier: 0,
      anchored: true,
      kind: 'wall',
    });
  }

  return {
    id: `wall.panel.${idx}`,
    tag: `wall.panel.${idx}`,
    kind: 'scrapWall',
    label: 'SCRAP PERIMETER PANEL',
    value: 28_000,
    nodes,
    links,
    collapseThreshold: 0.45,
  };
}

/** Builds a Tier-0 destructible scrap barricade spanning an 8 m side gate (west/east). */
function buildSideGateBarricadeCluster(side: 'west' | 'east', gx: number): StructuralClusterSpec {
  const nodes: StructuralNodeSpec[] = [
    {
      id: 'gate_leaf_l',
      pos: [gx - 1.9, 1.85, WALL_Z],
      half: [1.8, 1.85, 0.22],
      mat: 'rust',
      color: 0x8e4c30,
      hp: 95,
      tier: 0,
      anchored: true,
      kind: 'wall',
    },
    {
      id: 'gate_leaf_r',
      pos: [gx + 1.9, 1.85, WALL_Z],
      half: [1.8, 1.85, 0.22],
      mat: 'hazard',
      color: 0xc29032,
      hp: 95,
      tier: 0,
      anchored: true,
      kind: 'wall',
    },
    {
      id: 'gate_crossbar',
      pos: [gx, 3.85, WALL_Z],
      half: [3.7, 0.28, 0.24],
      mat: 'steelDark',
      color: 0x5c5852,
      hp: 75,
      tier: 0,
      anchored: false,
      kind: 'wall',
    },
    {
      id: 'gate_drum',
      pos: [gx + (side === 'west' ? 1.2 : -1.2), 0.56, WALL_Z + 0.95],
      half: [0.42, 0.56, 0.42],
      mat: 'paintRed',
      color: 0xc8261e,
      hp: 35,
      tier: 0,
      anchored: true,
      kind: 'hazard',
      hazardRadius: 9.0,
      hazardDamage: 220,
    },
  ];

  return {
    id: `wall.sidegate.${side}`,
    tag: `wall.sidegate.${side}`,
    kind: 'sideGateBarricade',
    label: side === 'west' ? 'WEST SIDE GATE BARRICADE' : 'EAST SIDE GATE BARRICADE',
    value: 45_000,
    nodes,
    links: [
      ['gate_leaf_l', 'gate_crossbar'],
      ['gate_leaf_r', 'gate_crossbar'],
    ],
    collapseThreshold: 0.45,
  };
}

/**
 * Builds one of the 6 Tier-0 destructible Watchtowers at WALL_TOWERS.
 * Shooting out the Tier-0 legs (hp: 100) tips the entire watchtower crashing down with its
 * sandbag parapet, corrugated canopy, and rooftop red fuel drum!
 */
function buildWallWatchtowerCluster(id: string, x: number, z: number, height: number, yaw: number): StructuralClusterSpec {
  const W = 1.85;
  const D = 1.75;
  const legH = height;

  const nodes: StructuralNodeSpec[] = [
    // 4 Tier-0 legs (hp: 100, anchored) — shooting them collapses the entire tower!
    { id: 'leg_sw', pos: [x - W, legH / 2, z + D], half: [0.22, legH / 2, 0.22], mat: 'rust', color: 0x7a4c34, hp: 100, tier: 0, anchored: true, kind: 'column', yaw },
    { id: 'leg_se', pos: [x + W, legH / 2, z + D], half: [0.22, legH / 2, 0.22], mat: 'rust', color: 0x7a4c34, hp: 100, tier: 0, anchored: true, kind: 'column', yaw },
    { id: 'leg_nw', pos: [x - W, legH / 2, z - D], half: [0.22, legH / 2, 0.22], mat: 'plywood', color: 0x7d5d3d, hp: 100, tier: 0, anchored: true, kind: 'column', yaw },
    { id: 'leg_ne', pos: [x + W, legH / 2, z - D], half: [0.22, legH / 2, 0.22], mat: 'plywood', color: 0x7d5d3d, hp: 100, tier: 0, anchored: true, kind: 'column', yaw },
    // Elevated lookout platform deck
    { id: 'deck', pos: [x, legH + 0.16, z], half: [W + 0.55, 0.16, D + 0.5], mat: 'plywood', color: 0x9b764e, hp: 110, tier: 0, anchored: false, kind: 'slab', yaw, impactRadius: 8.5 },
    // Front & side sandbag parapets
    { id: 'parapet_front', pos: [x, legH + 0.86, z + D + 0.22], half: [W + 0.45, 0.56, 0.22], mat: 'dirt', color: 0x9c8862, hp: 85, tier: 0, anchored: false, kind: 'wall', yaw },
    { id: 'parapet_w', pos: [x - W - 0.22, legH + 0.78, z], half: [0.2, 0.48, D + 0.1], mat: 'rust', color: 0x8e5638, hp: 75, tier: 0, anchored: false, kind: 'wall', yaw },
    { id: 'parapet_e', pos: [x + W + 0.22, legH + 0.78, z], half: [0.2, 0.48, D + 0.1], mat: 'rust', color: 0x8e5638, hp: 75, tier: 0, anchored: false, kind: 'wall', yaw },
    // Corrugated tin canopy roof
    { id: 'canopy', pos: [x, legH + 2.55, z], half: [W + 0.65, 0.12, D + 0.6], mat: 'rust', color: 0x864c34, hp: 75, tier: 0, anchored: false, kind: 'roof', yaw, impactRadius: 7.5 },
    // Rooftop red fuel drum hazard
    { id: 'rooftop_drum', pos: [x + 0.9, legH + 0.85, z - 0.55], half: [0.42, 0.54, 0.42], mat: 'paintRed', color: 0xd02a22, hp: 35, tier: 0, anchored: false, kind: 'hazard', yaw, hazardRadius: 10.5, hazardDamage: 250 },
  ];

  const links: [string, string][] = [
    ['leg_sw', 'deck'],
    ['leg_se', 'deck'],
    ['leg_nw', 'deck'],
    ['leg_ne', 'deck'],
    ['deck', 'parapet_front'],
    ['deck', 'parapet_w'],
    ['deck', 'parapet_e'],
    ['deck', 'canopy'],
    ['deck', 'rooftop_drum'],
  ];

  return {
    id,
    tag: id,
    kind: 'watchtower',
    label: 'SALTBLOOD WATCHTOWER',
    value: 90_000,
    nodes,
    links,
    collapseThreshold: 0.4,
  };
}

/** Builds a low Tier-0 outer sandbag machine-gun nest with an explosive fuel drum at the wall base. */
function buildOuterSandbagNestCluster(idx: number, x: number, z: number): StructuralClusterSpec {
  const nodes: StructuralNodeSpec[] = [
    { id: 'bags_front', pos: [x, 0.62, z + 0.9], half: [2.1, 0.62, 0.42], mat: 'dirt', color: 0x9b8660, hp: 85, tier: 0, anchored: true, kind: 'wall' },
    { id: 'bags_w', pos: [x - 2.0, 0.55, z], half: [0.38, 0.55, 1.0], mat: 'dirt', color: 0x937e5a, hp: 80, tier: 0, anchored: true, kind: 'wall' },
    { id: 'bags_e', pos: [x + 2.0, 0.55, z], half: [0.38, 0.55, 1.0], mat: 'dirt', color: 0x937e5a, hp: 80, tier: 0, anchored: true, kind: 'wall' },
    { id: 'nest_drum', pos: [x + 1.1, 0.55, z - 0.1], half: [0.4, 0.55, 0.4], mat: 'paintRed', color: 0xcc2820, hp: 35, tier: 0, anchored: true, kind: 'hazard', hazardRadius: 8.5, hazardDamage: 210 },
  ];

  return {
    id: `wall.sandbag.${idx}`,
    tag: `wall.sandbag.${idx}`,
    kind: 'sandbagNest',
    label: 'WALL SANDBAG NEST',
    value: 32_000,
    nodes,
    collapseThreshold: 0.5,
  };
}

/** Hanging Saltblood warning banner & effigy pole off the outer wall face (visual atmospheric dressing). */
function wallEffigyBanner(k: Kit, x: number, z: number, dye: Rgb): void {
  const g = k.geo;
  // Crossed scrap effigy pole jutting slightly out from wall face
  g.use('rust').tint(0.65).cyl(x, 0, z, x, 5.4, z, 0.08, 0.06, 5, false, true);
  g.use('steelDark').bevel(x, 4.7, z + 0.2, 1.0, 0.06, 0.06, 0.01);
  // Tattered hanging crimson/ochre cloth banner
  g.use('paintWhite').tint(dye[0] * 1.15, dye[1] * 1.15, dye[2] * 1.15);
  g.box(x, 3.25, z + 0.25, 0.72, 1.35, 0.02, FACE.pz | FACE.nz);
  // Dark painted Saltblood chevron stripe
  g.use('steelDark').tint(0.35).box(x, 3.25, z + 0.28, 0.68, 0.22, 0.01, FACE.pz);
  g.tint(1);
}

/** Heavy twin steel/concrete Main Gate pylons flanking x = -7..+7 + high scrap gantry arch (leaves gate gap 100% open!). */
function buildMainGateFrame(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const halfGap = MAIN_GATE.width / 2; // 7.0 m

  for (const side of [-1, 1] as const) {
    const px = side * (halfGap + 1.35);
    // Solid reinforced concrete & salvage steel gate pylon (x = -9.7..-7.0 and +7.0..+9.7)
    k.block('concreteDark', px - 1.25, 0, WALL_Z - 1.4, px + 1.25, 7.6, WALL_Z + 1.4, 0.12);
    // Steel armor corner plates & hazard stripes
    g.use('steelDark').bevel(px, 3.8, WALL_Z + 1.46, 1.1, 3.5, 0.08, 0.03);
    g.use('hazard').box(px, 1.0, WALL_Z + 1.54, 1.05, 0.35, 0.02, FACE.pz);
    // Top steel floodlight bracket & warm amber beacon
    g.use('rust').bevel(px, 8.1, WALL_Z, 0.9, 0.5, 0.9, 0.06);
    g.use('emissiveOrange').box(px, 7.3, WALL_Z + 1.54, 0.65, 0.18, 0.04, FACE.pz);
    k.light(px, 7.8, WALL_Z + 4.5, DESERT_PALETTE.dawnAmber, 48, 24);
    spec.plan?.blocks.push({ x0: px - 1.3, z0: WALL_Z - 1.4, x1: px + 1.3, z1: WALL_Z + 1.4 });
  }

  // High overhead steel gantry truss spanning well above MAIN_GATE.height (7.2 m) at y = 8.4..9.4
  k.truss(-halfGap - 1.2, 8.8, WALL_Z, halfGap + 1.2, 8.8, WALL_Z, 1.1, 1.4, 'rust', 0.12);
  g.use('paintRed').tint(0.75, 0.25, 0.18).bevel(0, 8.8, WALL_Z + 0.78, 5.4, 0.65, 0.08, 0.02);
  g.tint(1);
}

/** Elevated steel/timber walkways behind the wall (z = 57.5, y = 3.4) with Warren stairs so Saltbloods run behind panels! */
function buildWallWalkways(k: Kit, spec: MapSpec): void {
  const spans: readonly [number, number, readonly number[]][] = [
    // Far west walkway behind panels -76..-62 (stairs at -70)
    [-74, -63, [-70]],
    // Main west walkway behind panels -54..-10 (stairs at -48 and -24)
    [-53, -10, [-48, -24]],
    // Main east walkway behind panels +10..+54 (stairs at +24 and +48)
    [10, 53, [24, 48]],
    // Far east walkway behind panels +62..+76 (stairs at +70)
    [63, 74, [70]],
  ];

  for (const [x0, x1, stairXs] of spans) {
    // Grate/timber walkway deck at exact WALK_Y = 3.4 (width 2.8 m, z = 56.1..58.9)
    k.catwalk(x0, WALK_Z, x1, WALK_Z, WALK_Y, 2.8, 'right', false);
    // Sturdy supporting steel trestle legs down to ground (spaced every ~10 m)
    const count = Math.max(2, Math.round((x1 - x0) / 10));
    for (let i = 0; i <= count; i++) {
      const lx = x0 + ((x1 - x0) * i) / count;
      k.geo.use('rust').cyl(lx, 0, WALK_Z - 1.1, lx, WALK_Y - 0.15, WALK_Z - 1.1, 0.14, 0.12, 6, false, false);
      k.geo.use('rust').cyl(lx, 0, WALK_Z + 1.1, lx, WALK_Y - 0.15, WALK_Z + 1.1, 0.14, 0.12, 6, false, false);
      k.collide(lx, WALK_Y / 2, WALK_Z - 1.1, 0.16, WALK_Y / 2, 0.16, 'metal', false);
    }
    spec.plan?.decks.push({ x0, z0: WALK_Z - 1.4, x1, z1: WALK_Z + 1.4 });

    // Walkable steel stairs descending north into the Warren (z = 56.1 -> 50.1, run = 6.0 m, rise = 3.4 m, ny = 0.87)
    for (const sx of stairXs) {
      k.stairs(sx, WALK_Z - 7.4, 0, sx, WALK_Z - 1.4, WALK_Y, 2.2, 'steel', true);
    }
  }
}

/** Solid flank perimeter walls running north from the Wall ends (x = ±76, z = 62 -> -56) sealing the town edges. */
function buildTownFlankWalls(k: Kit, spec: MapSpec): void {
  for (const side of [-1, 1] as const) {
    const fx = side * 76;
    // Scrap/concrete flank curtain wall from z = 62 to z = -56 (height 6.5 m)
    k.wall(fx, WALL_Z, fx, DESERT_Z.pumpNorthGate, 0, 6.5, {
      mat: 'rust',
      backing: 'concreteDark',
      thick: 1.4,
      bay: 10,
      pilasters: true,
    });
    spec.plan?.walls.push({ ax: fx, az: WALL_Z, bx: fx, bz: DESERT_Z.pumpNorthGate, half: 0.7 });
  }
}

export function authorDesertWall(k: Kit, spec: MapSpec): void {
  // 1. Main Gate heavy frame & overhead gantry (keeps x = -7..+7, y = 0..7.2 completely open for Lane 4!)
  buildMainGateFrame(k, spec);

  // 2. 32 Tier-0 Destructible Corrugated Wall Panel Clusters across the 4 wall sections
  const sections: readonly [number, number, number][] = [
    [-76, -62, 4], // far west: 4 panels @ 3.5 m
    [-54, -9.8, 12], // mid west: 12 panels @ ~3.68 m
    [9.8, 54, 12], // mid east: 12 panels @ ~3.68 m
    [62, 76, 4], // far east: 4 panels @ 3.5 m
  ];

  let panelIdx = 0;
  for (const [x0, x1, count] of sections) {
    const step = (x1 - x0) / count;
    for (let i = 0; i < count; i++) {
      const cx = x0 + (i + 0.5) * step;
      const withFuelDrum = panelIdx % 3 === 1;
      const withSandbags = panelIdx % 3 === 2;
      spec.cluster(buildWallPanelCluster(panelIdx, cx, step, withFuelDrum, withSandbags));
      panelIdx++;
    }
    spec.plan?.walls.push({ ax: x0, az: WALL_Z, bx: x1, bz: WALL_Z, half: 0.45 });
  }

  // 3. 2 Tier-0 Side Gate Destructible Scrap Barricades (x = -58, +58)
  for (const sg of SIDE_GATES) {
    spec.cluster(buildSideGateBarricadeCluster(sg.id, sg.x));
    spec.plan?.gates.push({ x: sg.x, z: sg.z, yaw: 0, w: 8, bay: true });
    // Twin rust posts framing the 8 m side gate
    for (const s of [-4.2, 4.2]) {
      k.geo.use('steelDark').cyl(sg.x + s, 0, WALL_Z, sg.x + s, 5.2, WALL_Z, 0.24, 0.22, 6, false, true);
      k.collide(sg.x + s, 2.6, WALL_Z, 0.26, 2.6, 0.26, 'metal', false);
    }
  }
  spec.plan?.gates.push({ x: MAIN_GATE.x, z: MAIN_GATE.z, yaw: 0, w: MAIN_GATE.width, bay: true });

  // 4. All 6 Tier-0 Destructible Watchtowers at WALL_TOWERS
  for (const tw of WALL_TOWERS) {
    spec.cluster(buildWallWatchtowerCluster(tw.id, tw.x, tw.z, tw.height, tw.yaw));
    spec.plan?.blocks.push({ x0: tw.x - 2.2, z0: tw.z - 2.0, x1: tw.x + 2.2, z1: tw.z + 2.0 });
    // Warm amber floodlight on each tower silhouette
    k.light(tw.x, tw.height + 2.2, tw.z + 3.2, DESERT_PALETTE.dawnAmber, 38, 22);
  }

  // 5. Elevated walkways behind the wall (y = 3.4) + Warren access stairs
  buildWallWalkways(k, spec);

  // 6. Outer wall Tier-0 sandbag nests, stacked tyres, warning banners & effigies
  const nestXs = [-48, -28, 28, 48] as const;
  for (let i = 0; i < nestXs.length; i++) {
    const nx = nestXs[i]!;
    spec.cluster(buildOuterSandbagNestCluster(i, nx, WALL_Z + 3.6));
  }

  for (const bx of [-70, -50, -34, -22, 22, 34, 50, 70]) {
    const dye = DESERT_PALETTE.bannerDyes[Math.abs(bx) % DESERT_PALETTE.bannerDyes.length]!;
    wallEffigyBanner(k, bx, WALL_Z + 0.5, dye);
  }

  for (const [tx, tz, n] of [
    [-64, WALL_Z + 1.8, 3],
    [-38, WALL_Z + 1.9, 4],
    [-12, WALL_Z + 2.0, 3],
    [12, WALL_Z + 2.0, 3],
    [38, WALL_Z + 1.9, 4],
    [64, WALL_Z + 1.8, 3],
  ] as const) {
    tyres(k, tx, 0, tz, n, false);
  }

  // Overhead power cables linking watchtowers along the wall crest
  for (let i = 0; i + 1 < WALL_TOWERS.length; i++) {
    const a = WALL_TOWERS[i]!;
    const b = WALL_TOWERS[i + 1]!;
    if (a.x < 0 && b.x > 0) continue; // keep Main Gate gap clean!
    cable(k, a.x, a.height + 2.0, a.z, b.x, b.height + 2.0, b.z, 1.4, 0.04);
  }

  // 7. Solid perimeter flank walls closing west & east sides of Surplus
  buildTownFlankWalls(k, spec);
}
