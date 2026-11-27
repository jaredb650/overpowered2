/**
 * Surplus — The Wall (z = 62, x = -76 .. +76).
 *
 * The Section 2 broadside shooting-gallery centerpiece (Desert Raid 2.0):
 *   - 32 sturdy Tier-0 corrugated sheet-metal wall panel clusters (`hp: 265..290`, `materialClass: 'metal'`,
 *     `fractureGrid: [2, 2]`) so 40mm Mk 19 grenades visibly dent, warp, and chew jagged holes through
 *     the wall in 2-3 direct hits while stray small arms never pop panels instantly.
 *   - Alternating waist-high firing embrasures (`y = 4.55`, 0.95 m above the `y = 3.6` battlements) and
 *     widened 4.4 m elevated walkways (`z = 56.6..61.0`, `y = 3.6`) with forward firing balconies so
 *     human Saltblood defenders stand prominently visible to the player riding past on the Mk 19.
 *   - ZERO fuel drums on wall panels, side gates, or watchtowers! Only 3 isolated fuel drums sit far
 *     south of the wall on distant outer sandbag nests (`>= 32 m` apart) so barrels can NEVER chain-nuke the wall.
 *   - 6 Tier-0 timber-legged watchtowers at WALL_TOWERS (`materialClass: 'wood'`, `hp: 185`) whose legs
 *     splinter and bend under sustained fire before dramatically toppling the tower.
 *   - Solid Main Gate frame leaving x = -7..+7 wide open for runtime bulldozer gate setpiece.
 */
import type { StructuralClusterSpec, StructuralNodeSpec } from '../../destruction';
import { FACE } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { cable, tyres } from '../../kit/props';
import type { MapSpec } from '../spec';
import { DESERT_PALETTE, type Rgb } from './dunes';
import { DESERT_Z, MAIN_GATE, SIDE_GATES, WALL_TOWERS } from './plan';

const WALL_Z = DESERT_Z.wallLine; // 62
const WALK_Y = 3.6; // Exact match with DESERT_LEVELS[4] = 3.6 so NavGraph samples every battlement cleanly!
const WALK_CENTER_Z = 59.0; // Widened 4.6 m walkway spans z = 56.7 .. 61.3 flush against brace posts (covers DESERT_Z.wallWalkway = 57.5!)
const WALK_WIDTH = 4.6;

const PANEL_COLORS: readonly number[] = [
  0x8e5638, // corrugated rust
  0xb0844c, // sun-baked ochre sheet
  0x6b7470, // weathered zinc
  0x9a4834, // oxidized red oxide
  0x7d6d56, // dusty scrap iron
  0x5d7a74, // faded salvage teal
];

/**
 * Builds a single sturdy Tier-0 corrugated sheet-metal wall panel cluster (3.5–4 m wide, hp 265–290).
 * Alternating panels form waist-high firing embrasures (`top y = 4.55`, 0.95 m above the y = 3.6 walkway)
 * so human defenders on the battlements are clearly visible from the convoy road.
 */
function buildWallPanelCluster(
  idx: number,
  cx: number,
  width: number,
  withSandbags: boolean,
): StructuralClusterSpec {
  const hw = width / 2 - 0.06;
  const colLower = PANEL_COLORS[idx % PANEL_COLORS.length]!;
  const colUpper = PANEL_COLORS[(idx + 2) % PANEL_COLORS.length]!;
  const isEmbrasure = idx % 2 === 1;
  const lowerH = 2.6;
  const upperH = isEmbrasure ? 1.95 : 2.55; // Embrasure top = 4.55 (waist-high above 3.6); Merlon top = 5.15

  const nodes: StructuralNodeSpec[] = [
    // Sturdy lower corrugated sheet bulkhead (Tier 0 timber-gated metal sheet, lazy impact-centered 2x2 fracture)
    {
      id: 'panel_lower',
      pos: [cx, lowerH / 2, WALL_Z],
      half: [hw, lowerH / 2, 0.24],
      mat: idx % 2 === 0 ? 'rust' : 'panel',
      color: colLower,
      hp: 290,
      tier: 0,
      anchored: true,
      kind: 'wall',
      materialClass: 'metal',
      structuralMaterial: 'timber',
      supportRole: 'load_bearing',
      loadCapacity: 28_000,
      lazyFracture: true,
      fractureGrid: [2, 2],
      navBlock: true,
    },
    // Upper corrugated scrap parapet / waist-high firing embrasure
    {
      id: 'panel_upper',
      pos: [cx, lowerH + upperH / 2, WALL_Z],
      half: [hw - 0.04, upperH / 2, 0.18],
      mat: idx % 3 === 0 ? 'panel' : 'rust',
      color: colUpper,
      hp: 265,
      tier: 0,
      anchored: false,
      kind: 'wall',
      materialClass: 'metal',
      structuralMaterial: 'timber',
      supportRole: 'infill',
      lazyFracture: true,
      fractureGrid: [2, 2],
    },
    // Vertical timber brace post behind panel
    {
      id: 'brace_post',
      pos: [cx + (idx % 2 === 0 ? -hw * 0.65 : hw * 0.65), 1.9, WALL_Z - 0.48],
      half: [0.18, 1.9, 0.18],
      mat: 'plywood',
      color: 0x76583a,
      hp: 175,
      tier: 0,
      anchored: true,
      kind: 'column',
      materialClass: 'wood',
      structuralMaterial: 'timber',
      supportRole: 'load_bearing',
      loadCapacity: 24_000,
    },
  ];

  const links: [string, string][] = [
    ['panel_lower', 'panel_upper'],
    ['brace_post', 'panel_upper'],
  ];

  if (withSandbags) {
    nodes.push({
      id: 'base_sandbags',
      pos: [cx, 0.55, WALL_Z + 0.85],
      half: [hw * 0.72, 0.55, 0.42],
      mat: 'dirt',
      color: 0x9b8660,
      hp: 160,
      tier: 0,
      anchored: true,
      kind: 'wall',
      materialClass: 'stone',
      structuralMaterial: 'timber',
      supportRole: 'infill',
      navBlock: true,
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

/** Builds a sturdy Tier-0 destructible scrap barricade spanning an 8 m side gate (no explosive barrels!). */
function buildSideGateBarricadeCluster(side: 'west' | 'east', gx: number): StructuralClusterSpec {
  const nodes: StructuralNodeSpec[] = [
    {
      id: 'gate_leaf_l',
      pos: [gx - 1.9, 1.95, WALL_Z],
      half: [1.8, 1.95, 0.24],
      mat: 'rust',
      color: 0x8e4c30,
      hp: 260,
      tier: 0,
      anchored: true,
      kind: 'wall',
      materialClass: 'metal',
      structuralMaterial: 'timber',
      supportRole: 'load_bearing',
      lazyFracture: true,
      fractureGrid: [2, 2],
      navBlock: true,
    },
    {
      id: 'gate_leaf_r',
      pos: [gx + 1.9, 1.95, WALL_Z],
      half: [1.8, 1.95, 0.24],
      mat: 'hazard',
      color: 0xc29032,
      hp: 260,
      tier: 0,
      anchored: true,
      kind: 'wall',
      materialClass: 'metal',
      structuralMaterial: 'timber',
      supportRole: 'load_bearing',
      lazyFracture: true,
      fractureGrid: [2, 2],
      navBlock: true,
    },
    {
      id: 'gate_crossbar',
      pos: [gx, 4.05, WALL_Z],
      half: [3.7, 0.28, 0.24],
      mat: 'steelDark',
      color: 0x5c5852,
      hp: 210,
      tier: 0,
      anchored: false,
      kind: 'wall',
      materialClass: 'metal',
      structuralMaterial: 'timber',
      supportRole: 'infill',
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
 * Builds one of the 6 Tier-0 timber-legged Watchtowers at WALL_TOWERS.
 * Connected to the 4-pass zero-floating structural solver: breaking 2 adjacent legs or 3 legs
 * immediately tips and collapses the entire lookout deck and canopy!
 */
function buildWallWatchtowerCluster(id: string, x: number, z: number, height: number, yaw: number): StructuralClusterSpec {
  const W = 1.95;
  const D = 1.8;
  const legH = height;

  const nodes: StructuralNodeSpec[] = [
    // 4 Tier-0 load-bearing timber legs (`structuralMaterial: 'timber'`, `hp: 185`, anchored)
    { id: 'leg_sw', pos: [x - W, legH / 2, z + D], half: [0.22, legH / 2, 0.22], mat: 'plywood', color: 0x7d5a38, hp: 185, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', loadCapacity: 26_000 },
    { id: 'leg_se', pos: [x + W, legH / 2, z + D], half: [0.22, legH / 2, 0.22], mat: 'plywood', color: 0x7d5a38, hp: 185, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', loadCapacity: 26_000 },
    { id: 'leg_nw', pos: [x - W, legH / 2, z - D], half: [0.22, legH / 2, 0.22], mat: 'plywood', color: 0x725032, hp: 185, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', loadCapacity: 26_000 },
    { id: 'leg_ne', pos: [x + W, legH / 2, z - D], half: [0.22, legH / 2, 0.22], mat: 'plywood', color: 0x725032, hp: 185, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', loadCapacity: 26_000 },
    // Elevated timber lookout platform deck
    { id: 'deck', pos: [x, legH + 0.16, z], half: [W + 0.55, 0.16, D + 0.5], mat: 'plywood', color: 0x9b764e, hp: 210, tier: 0, anchored: false, kind: 'slab', yaw, impactRadius: 8.5, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', lazyFracture: true, fractureGrid: [2, 2] },
    // Low waist-high front & side firing parapets (infill — never falsely hold up the tower!)
    { id: 'parapet_front', pos: [x, legH + 0.75, z + D + 0.22], half: [W + 0.45, 0.43, 0.2], mat: 'rust', color: 0x8e5638, hp: 180, tier: 0, anchored: false, kind: 'wall', yaw, materialClass: 'metal', structuralMaterial: 'timber', supportRole: 'infill', lazyFracture: true, fractureGrid: [2, 1] },
    { id: 'parapet_w', pos: [x - W - 0.22, legH + 0.72, z], half: [0.18, 0.4, D + 0.1], mat: 'rust', color: 0x844e34, hp: 165, tier: 0, anchored: false, kind: 'wall', yaw, materialClass: 'metal', structuralMaterial: 'timber', supportRole: 'infill' },
    { id: 'parapet_e', pos: [x + W + 0.22, legH + 0.72, z], half: [0.18, 0.4, D + 0.1], mat: 'rust', color: 0x844e34, hp: 165, tier: 0, anchored: false, kind: 'wall', yaw, materialClass: 'metal', structuralMaterial: 'timber', supportRole: 'infill' },
    // Corrugated tin canopy roof raised high (2.7 m clearance) for clean open firing view
    { id: 'canopy', pos: [x, legH + 2.78, z], half: [W + 0.65, 0.12, D + 0.6], mat: 'rust', color: 0x864c34, hp: 185, tier: 0, anchored: false, kind: 'roof', yaw, impactRadius: 7.5, materialClass: 'metal', structuralMaterial: 'timber', supportRole: 'load_bearing', lazyFracture: true, fractureGrid: [2, 2] },
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

/** Builds a low Tier-0 outer sandbag machine-gun nest well forward of the wall (isolated optional drum). */
function buildOuterSandbagNestCluster(idx: number, x: number, z: number, withDrum: boolean): StructuralClusterSpec {
  const nodes: StructuralNodeSpec[] = [
    { id: 'bags_front', pos: [x, 0.62, z + 0.9], half: [2.1, 0.62, 0.42], mat: 'dirt', color: 0x9b8660, hp: 150, tier: 0, anchored: true, kind: 'wall', materialClass: 'stone', structuralMaterial: 'timber', supportRole: 'infill', navBlock: true },
    { id: 'bags_w', pos: [x - 2.0, 0.55, z], half: [0.38, 0.55, 1.0], mat: 'dirt', color: 0x937e5a, hp: 140, tier: 0, anchored: true, kind: 'wall', materialClass: 'stone', structuralMaterial: 'timber', supportRole: 'infill', navBlock: true },
    { id: 'bags_e', pos: [x + 2.0, 0.55, z], half: [0.38, 0.55, 1.0], mat: 'dirt', color: 0x937e5a, hp: 140, tier: 0, anchored: true, kind: 'wall', materialClass: 'stone', structuralMaterial: 'timber', supportRole: 'infill', navBlock: true },
  ];

  if (withDrum) {
    // Isolated fuel drum placed 4.6 m south of the wall line with tight 6.0 m blast radius — never chains to wall panels!
    nodes.push({
      id: 'nest_drum',
      pos: [x + 1.1, 0.55, z + 0.15],
      half: [0.4, 0.55, 0.4],
      mat: 'paintRed',
      color: 0xcc2820,
      hp: 40,
      tier: 0,
      anchored: true,
      kind: 'hazard',
      hazardRadius: 6.0,
      hazardDamage: 180,
      materialClass: 'metal',
      structuralMaterial: 'timber',
      supportRole: 'infill',
    });
  }

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
  g.use('rust').tint(0.65).cyl(x, 0, z, x, 5.4, z, 0.08, 0.06, 5, false, true);
  g.use('steelDark').bevel(x, 4.7, z + 0.2, 1.0, 0.06, 0.06, 0.01);
  g.use('paintWhite').tint(dye[0] * 1.15, dye[1] * 1.15, dye[2] * 1.15);
  g.box(x, 3.25, z + 0.25, 0.72, 1.35, 0.02, FACE.pz | FACE.nz);
  g.use('steelDark').tint(0.35).box(x, 3.25, z + 0.28, 0.68, 0.22, 0.01, FACE.pz);
  g.tint(1);
}

/** Heavy twin steel/concrete Main Gate pylons flanking x = -7..+7 + high scrap gantry arch (leaves gate gap 100% open!). */
function buildMainGateFrame(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const halfGap = MAIN_GATE.width / 2; // 7.0 m

  for (const side of [-1, 1] as const) {
    const px = side * (halfGap + 1.35);
    k.block('concreteDark', px - 1.25, 0, WALL_Z - 1.4, px + 1.25, 7.6, WALL_Z + 1.4, 0.12);
    g.use('steelDark').bevel(px, 3.8, WALL_Z + 1.46, 1.1, 3.5, 0.08, 0.03);
    g.use('hazard').box(px, 1.0, WALL_Z + 1.54, 1.05, 0.35, 0.02, FACE.pz);
    g.use('rust').bevel(px, 8.1, WALL_Z, 0.9, 0.5, 0.9, 0.06);
    g.use('emissiveOrange').box(px, 7.3, WALL_Z + 1.54, 0.65, 0.18, 0.04, FACE.pz);
    k.light(px, 7.8, WALL_Z + 4.5, DESERT_PALETTE.dawnAmber, 48, 24);
    spec.plan?.blocks.push({ x0: px - 1.3, z0: WALL_Z - 1.4, x1: px + 1.3, z1: WALL_Z + 1.4 });
  }

  k.truss(-halfGap - 1.2, 8.8, WALL_Z, halfGap + 1.2, 8.8, WALL_Z, 1.1, 1.4, 'rust', 0.12);
  g.use('paintRed').tint(0.75, 0.25, 0.18).bevel(0, 8.8, WALL_Z + 0.78, 5.4, 0.65, 0.08, 0.02);
  g.tint(1);
}

/**
 * Widened elevated battlements behind the wall (`y = 3.6`, exact match with DESERT_LEVELS) with
 * forward firing balconies hugging the waist-high wall embrasures (`z = 56.6 .. 61.0`) and wide stairs into the Warren.
 */
function buildWallWalkways(k: Kit, spec: MapSpec): void {
  const spans: readonly [number, number, readonly number[]][] = [
    [-74, -63, [-70]],
    [-53, -10, [-48, -24]],
    [10, 53, [24, 48]],
    [63, 74, [70]],
  ];

  for (const [x0, x1, stairXs] of spans) {
    // Widened 4.4 m battlement walkway at exact WALK_Y = 3.6 (spans z = 56.6 .. 61.0)
    k.catwalk(x0, WALK_CENTER_Z, x1, WALK_CENTER_Z, WALK_Y, WALK_WIDTH, 'right', false);

    // Visual steel trestle legs down to ground (collider only at span ends to stay lean on collider budget)
    const count = Math.max(2, Math.round((x1 - x0) / 14));
    for (let i = 0; i <= count; i++) {
      const lx = x0 + ((x1 - x0) * i) / count;
      k.geo.use('rust').cyl(lx, 0, WALK_CENTER_Z - 1.9, lx, WALK_Y - 0.15, WALK_CENTER_Z - 1.9, 0.14, 0.12, 6, false, false);
      k.geo.use('rust').cyl(lx, 0, WALK_CENTER_Z + 1.9, lx, WALK_Y - 0.15, WALK_CENTER_Z + 1.9, 0.14, 0.12, 6, false, false);
      if (i === 0 || i === count) {
        k.collide(lx, WALK_Y / 2, WALK_CENTER_Z - 1.9, 0.18, WALK_Y / 2, 0.18, 'metal', false);
      }
    }
    spec.plan?.decks.push({
      x0,
      z0: WALK_CENTER_Z - WALK_WIDTH / 2,
      x1,
      z1: WALK_CENTER_Z + WALK_WIDTH / 2,
    });

    // Walkable steel stairs descending north into the Warren (z = 56.6 -> 50.0, run = 6.6 m, rise = 3.6 m, ny = 0.878)
    for (const sx of stairXs) {
      k.stairs(sx, WALK_CENTER_Z - WALK_WIDTH / 2 - 6.6, 0, sx, WALK_CENTER_Z - WALK_WIDTH / 2, WALK_Y, 2.2, 'steel', true);
    }
  }
}

/** Solid flank perimeter walls running north from the Wall ends (x = ±76, z = 62 -> -56) sealing the town edges. */
function buildTownFlankWalls(k: Kit, spec: MapSpec): void {
  for (const side of [-1, 1] as const) {
    const fx = side * 76;
    k.wall(fx, WALL_Z, fx, DESERT_Z.pumpNorthGate, 0, 6.5, {
      mat: 'rust',
      backing: 'concreteDark',
      thick: 1.4,
      bay: 12,
      pilasters: true,
    });
    spec.plan?.walls.push({ ax: fx, az: WALL_Z, bx: fx, bz: DESERT_Z.pumpNorthGate, half: 0.7 });
  }
}

export function authorDesertWall(k: Kit, spec: MapSpec): void {
  // 1. Main Gate heavy frame & overhead gantry (2 baked lights)
  buildMainGateFrame(k, spec);

  // 2. 32 Sturdy Tier-0 Destructible Corrugated Wall Panel Clusters (ZERO barrels attached!)
  const sections: readonly [number, number, number][] = [
    [-76, -62, 4],
    [-54, -9.8, 12],
    [9.8, 54, 12],
    [62, 76, 4],
  ];

  let panelIdx = 0;
  for (const [x0, x1, count] of sections) {
    const step = (x1 - x0) / count;
    for (let i = 0; i < count; i++) {
      const cx = x0 + (i + 0.5) * step;
      const withSandbags = panelIdx % 4 === 2;
      spec.cluster(buildWallPanelCluster(panelIdx, cx, step, withSandbags));
      panelIdx++;
    }
    spec.plan?.walls.push({ ax: x0, az: WALL_Z, bx: x1, bz: WALL_Z, half: 0.45 });
  }

  // 3. 2 Tier-0 Side Gate Destructible Scrap Barricades (x = -58, +58)
  for (const sg of SIDE_GATES) {
    spec.cluster(buildSideGateBarricadeCluster(sg.id, sg.x));
    spec.plan?.gates.push({ x: sg.x, z: sg.z, yaw: 0, w: 8, bay: true });
    for (const s of [-4.2, 4.2]) {
      k.geo.use('steelDark').cyl(sg.x + s, 0, WALL_Z, sg.x + s, 5.2, WALL_Z, 0.24, 0.22, 6, false, true);
      k.collide(sg.x + s, 2.6, WALL_Z, 0.26, 2.6, 0.26, 'metal', false);
    }
  }
  spec.plan?.gates.push({ x: MAIN_GATE.x, z: MAIN_GATE.z, yaw: 0, w: MAIN_GATE.width, bay: true });

  // 4. All 6 Tier-0 Timber-Legged Watchtowers at WALL_TOWERS (4 amber silhouette lights on key towers -> total 6 lights in wall.ts)
  for (let i = 0; i < WALL_TOWERS.length; i++) {
    const tw = WALL_TOWERS[i]!;
    spec.cluster(buildWallWatchtowerCluster(tw.id, tw.x, tw.z, tw.height, tw.yaw));
    spec.plan?.blocks.push({ x0: tw.x - 2.2, z0: tw.z - 2.0, x1: tw.x + 2.2, z1: tw.z + 2.0 });
    if (i === 0 || i === 2 || i === 3 || i === 5) {
      k.light(tw.x, tw.height + 2.2, tw.z + 3.2, DESERT_PALETTE.dawnAmber, 40, 24);
    }
  }

  // 5. Widened elevated battlements behind the wall (y = 3.6) + Warren access stairs
  buildWallWalkways(k, spec);

  // 6. Outer wall Tier-0 sandbag nests (only 3 widely-spaced isolated drums >= 32 m apart, 4.6 m south of wall!)
  const nestSpecs: readonly [number, boolean][] = [
    [-50, true],
    [-26, false],
    [26, true],
    [66, true],
  ];
  for (let i = 0; i < nestSpecs.length; i++) {
    const [nx, withDrum] = nestSpecs[i]!;
    spec.cluster(buildOuterSandbagNestCluster(i, nx, WALL_Z + 4.4, withDrum));
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
    if (a.x < 0 && b.x > 0) continue;
    cable(k, a.x, a.height + 2.0, a.z, b.x, b.height + 2.0, b.z, 1.4, 0.04);
  }

  // 7. Solid perimeter flank walls closing west & east sides of Surplus
  buildTownFlankWalls(k, spec);
}
