/**
 * Surplus — The Warren (z = +50 -> -12, x = -58 .. +58).
 *
 * Cut-your-own-way destructible shantytown:
 *   - 20 distinct Tier-0 destructible shacks (14 single-storey h = 3.4 m + 6 two-storey h = 6.6 m)
 *     arranged in dense West, Center-Flank, and East avenues. Every shack uses Tier-0 posts and
 *     walls (hp: 75–110) so bullets & explosives punch walk-through holes straight through shacks
 *     or snap corner posts to drop roofs onto bandits inside!
 *   - 4 Tier-0 elevated rooftop catwalks bridging alleys at y = 3.4, overhead sagging washing lines,
 *     power cables, dyed bunting, Tier-0 street sandbag/crate barricades & fuel drums (kind: 'hazard').
 *   - 3 solid weathered concrete cistern / sandstone rock landmarks so navigation never gets lost
 *     even after the entire shantytown is leveled!
 *   - Elevated Optional Minigun Nest at exact WARREN_MINIGUN.pos ([-14, 4.2, 22]) with wide street
 *     stairs, Tier-0 destructible front sandbag cover + sunshade, and mounted M134 emplacement facing
 *     north (-Z) down the central Warren avenue!
 *   - Clear ~10–12 m central rubble-corridor along CONVOY_PATHS.exfil for Section 6 exfil trucks.
 */
import {
  createNavNodeProxy,
  type StructuralClusterSpec,
  type StructuralNodeSpec,
} from '../../destruction';
import { FACE, type Mat } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { cable, tank, tyres } from '../../kit/props';
import type { MapSpec } from '../spec';
import { DESERT_PALETTE, type Rgb } from './dunes';
import { WARREN_MINIGUN } from './plan';

const SINGLE_H = 3.4; // Exact match with DESERT_LEVELS = 3.4
const DOUBLE_H = 6.6; // Exact match with DESERT_LEVELS = 6.6

interface ShackSpec {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  readonly stories: 1 | 2;
  readonly yaw: number;
  readonly color: number;
  readonly hasHazard: boolean;
  readonly hasAwning: boolean;
  readonly walkableRoof?: boolean;
}

/**
 * 20 distinct Tier-0 shacks across West, Center-Flank, and East avenues.
 * All positions verified clear of:
 *   - Central exfil corridor: (0, 50) -> (4, 16) -> (12, -14) (width ~11 m)
 *   - DESERT_HUB_PT: [0, 0, 44]
 *   - WARREN_MINIGUN platform & stairs: x in [-18, -10], z in [18.5, 33]
 *   - LOUDSPEAKER_POLES: [-22,56], [22,56], [-20,26], [20,14], [-12,-4]
 *   - 3 Solid landmarks: (-36, 32), (34, 18), (-26, -2)
 */
const WARREN_SHACKS: readonly ShackSpec[] = [
  // West Avenue (x = -52 .. -22)
  { id: 'warren.shack.0', x: -46, z: 44, w: 6.4, d: 5.0, stories: 1, yaw: 0, color: 0xc97b4b, hasHazard: true, hasAwning: true },
  { id: 'warren.shack.1', x: -30, z: 44, w: 6.2, d: 4.8, stories: 2, yaw: 0.08, color: 0xb58d52, hasHazard: false, hasAwning: true },
  { id: 'warren.shack.2', x: -48, z: 30, w: 6.0, d: 5.2, stories: 1, yaw: Math.PI / 2, color: 0x6e8c82, hasHazard: true, hasAwning: false },
  { id: 'warren.shack.3', x: -46, z: 16, w: 6.6, d: 5.0, stories: 2, yaw: 0, color: 0x9b5a3c, hasHazard: true, hasAwning: true },
  { id: 'warren.shack.4', x: -30, z: 14, w: 5.8, d: 4.8, stories: 1, yaw: -0.06, color: 0xc4a472, hasHazard: false, hasAwning: true, walkableRoof: true },
  { id: 'warren.shack.5', x: -44, z: 2, w: 6.4, d: 5.0, stories: 1, yaw: 0.05, color: 0xa84836, hasHazard: true, hasAwning: false },
  { id: 'warren.shack.6', x: -42, z: -8, w: 6.2, d: 4.6, stories: 2, yaw: Math.PI, color: 0x7c7668, hasHazard: false, hasAwning: true },

  // Center-West Flank (x = -18 .. -8)
  { id: 'warren.shack.7', x: -16, z: 42, w: 5.8, d: 4.6, stories: 1, yaw: Math.PI / 2, color: 0xb58d52, hasHazard: true, hasAwning: true, walkableRoof: true },
  { id: 'warren.shack.8', x: -14, z: 8, w: 5.8, d: 4.8, stories: 1, yaw: Math.PI / 2, color: 0xc97b4b, hasHazard: true, hasAwning: true, walkableRoof: true },
  { id: 'warren.shack.9', x: -4, z: -4, w: 5.6, d: 4.6, stories: 1, yaw: 0, color: 0x8e6b46, hasHazard: false, hasAwning: false },

  // Center-East Flank (x = +12 .. +26)
  { id: 'warren.shack.10', x: 16, z: 42, w: 6.2, d: 4.8, stories: 1, yaw: -Math.PI / 2, color: 0x6e8c82, hasHazard: true, hasAwning: true },
  { id: 'warren.shack.11', x: 16, z: 28, w: 6.0, d: 5.0, stories: 2, yaw: -Math.PI / 2, color: 0xc97b4b, hasHazard: true, hasAwning: true },
  { id: 'warren.shack.12', x: 22, z: 4, w: 5.8, d: 4.6, stories: 1, yaw: 0, color: 0xa84836, hasHazard: false, hasAwning: true },
  { id: 'warren.shack.13', x: 24, z: -7, w: 6.0, d: 4.6, stories: 1, yaw: Math.PI, color: 0xc4a472, hasHazard: true, hasAwning: false },

  // East Avenue (x = +30 .. +52)
  { id: 'warren.shack.14', x: 32, z: 44, w: 6.4, d: 4.8, stories: 1, yaw: 0, color: 0x9b5a3c, hasHazard: false, hasAwning: true },
  { id: 'warren.shack.15', x: 48, z: 42, w: 6.2, d: 5.0, stories: 2, yaw: -0.08, color: 0x7c7668, hasHazard: true, hasAwning: true },
  { id: 'warren.shack.16', x: 34, z: 32, w: 6.0, d: 4.8, stories: 1, yaw: 0.04, color: 0xb58d52, hasHazard: true, hasAwning: false, walkableRoof: true },
  { id: 'warren.shack.17', x: 48, z: 26, w: 6.4, d: 5.0, stories: 1, yaw: -Math.PI / 2, color: 0x6e8c82, hasHazard: false, hasAwning: true },
  { id: 'warren.shack.18', x: 48, z: 10, w: 6.2, d: 5.2, stories: 2, yaw: 0, color: 0xc97b4b, hasHazard: true, hasAwning: true },
  { id: 'warren.shack.19', x: 44, z: -5, w: 6.4, d: 4.8, stories: 1, yaw: Math.PI, color: 0x8e6b46, hasHazard: true, hasAwning: true },
];

/** Builds a cut-your-own-way Tier-0 destructible shack (1-storey 3.4 m or 2-storey 6.6 m). */
function buildWarrenShackCluster(k: Kit, s: ShackSpec): StructuralClusterSpec {
  const c = Math.cos(s.yaw);
  const sn = Math.sin(s.yaw);
  const pt = (lx: number, ly: number, lz: number): [number, number, number] => [
    s.x + lx * c + lz * sn,
    ly,
    s.z - lx * sn + lz * c,
  ];
  const hw = s.w / 2;
  const hd = s.d / 2;
  const roofHalfY = 0.14;
  const wallH = SINGLE_H - roofHalfY * 2; // 3.12 m -> roof top exact 3.4 m
  const matWall: Mat = s.color === 0x7c7668 ? 'panel' : 'paintWhite';

  const nodes: StructuralNodeSpec[] = [
    // 4 corner Tier-0 timber/rust posts (anchored, hp 90) — snapping them drops the roof!
    { id: 'post_fl', pos: pt(-hw + 0.15, wallH / 2, hd - 0.15), half: [0.16, wallH / 2, 0.16], mat: 'plywood', color: 0x6e4e32, hp: 90, tier: 0, anchored: true, kind: 'column', yaw: s.yaw },
    { id: 'post_fr', pos: pt(hw - 0.15, wallH / 2, hd - 0.15), half: [0.16, wallH / 2, 0.16], mat: 'plywood', color: 0x6e4e32, hp: 90, tier: 0, anchored: true, kind: 'column', yaw: s.yaw },
    { id: 'post_bl', pos: pt(-hw + 0.15, wallH / 2, -hd + 0.15), half: [0.16, wallH / 2, 0.16], mat: 'rust', color: 0x6e422c, hp: 90, tier: 0, anchored: true, kind: 'column', yaw: s.yaw },
    { id: 'post_br', pos: pt(hw - 0.15, wallH / 2, -hd + 0.15), half: [0.16, wallH / 2, 0.16], mat: 'rust', color: 0x6e422c, hp: 90, tier: 0, anchored: true, kind: 'column', yaw: s.yaw },

    // Thin breakable corrugated/plywood side & back walls (hp 75–85, tier 0) -> blast walk-through holes right through!
    { id: 'wall_w', pos: pt(-hw, wallH / 2, 0), half: [0.14, wallH / 2, hd - 0.32], mat: matWall, color: s.color, hp: 80, tier: 0, anchored: true, kind: 'wall', yaw: s.yaw },
    { id: 'wall_e', pos: pt(hw, wallH / 2, 0), half: [0.14, wallH / 2, hd - 0.32], mat: matWall, color: s.color, hp: 80, tier: 0, anchored: true, kind: 'wall', yaw: s.yaw },
    { id: 'wall_b', pos: pt(0, wallH / 2, -hd), half: [hw - 0.32, wallH / 2, 0.14], mat: 'rust', color: s.color, hp: 85, tier: 0, anchored: true, kind: 'wall', yaw: s.yaw },
    // Front wall split around a 1.8 m doorway so you can run inside OR shoot the cheeks out
    { id: 'wall_fl', pos: pt(-hw * 0.58, wallH / 2, hd), half: [hw * 0.34, wallH / 2, 0.14], mat: matWall, color: s.color, hp: 75, tier: 0, anchored: true, kind: 'wall', yaw: s.yaw },
    { id: 'wall_fr', pos: pt(hw * 0.58, wallH / 2, hd), half: [hw * 0.34, wallH / 2, 0.14], mat: matWall, color: s.color, hp: 75, tier: 0, anchored: true, kind: 'wall', yaw: s.yaw },
  ];

  // First-floor roof / deck slab (top exact y = 3.4)
  const roof1: StructuralNodeSpec = {
    id: 'roof_1',
    pos: pt(0, SINGLE_H - roofHalfY, 0),
    half: [hw + 0.25, roofHalfY, hd + 0.25],
    mat: 'rust',
    color: 0x7b563c,
    hp: 95,
    tier: 0,
    anchored: false,
    kind: 'roof',
    yaw: s.yaw,
    impactRadius: 7.5,
  };
  nodes.push(roof1);

  const links: [string, string][] = [
    ['post_fl', 'roof_1'],
    ['post_fr', 'roof_1'],
    ['post_bl', 'roof_1'],
    ['post_br', 'roof_1'],
    ['wall_w', 'roof_1'],
    ['wall_e', 'roof_1'],
    ['wall_b', 'roof_1'],
  ];

  if (s.stories === 2) {
    const upperWallH = DOUBLE_H - SINGLE_H - roofHalfY * 2; // 2.92 m -> top roof exact 6.6 m
    const yMid = SINGLE_H + upperWallH / 2;
    nodes.push(
      { id: 'up_wall_w', pos: pt(-hw + 0.12, yMid, 0), half: [0.14, upperWallH / 2, hd - 0.25], mat: 'panel', color: s.color, hp: 80, tier: 0, anchored: false, kind: 'wall', yaw: s.yaw },
      { id: 'up_wall_e', pos: pt(hw - 0.12, yMid, 0), half: [0.14, upperWallH / 2, hd - 0.25], mat: 'panel', color: s.color, hp: 80, tier: 0, anchored: false, kind: 'wall', yaw: s.yaw },
      { id: 'up_wall_b', pos: pt(0, yMid, -hd + 0.12), half: [hw - 0.25, upperWallH / 2, 0.14], mat: 'rust', color: 0x86543a, hp: 80, tier: 0, anchored: false, kind: 'wall', yaw: s.yaw },
      { id: 'up_parapet_f', pos: pt(0, SINGLE_H + 0.65, hd - 0.12), half: [hw - 0.25, 0.65, 0.14], mat: 'plywood', color: 0x9b764e, hp: 75, tier: 0, anchored: false, kind: 'wall', yaw: s.yaw },
      { id: 'roof_2', pos: pt(0, DOUBLE_H - roofHalfY, 0), half: [hw + 0.35, roofHalfY, hd + 0.35], mat: 'rust', color: 0x6f4b34, hp: 105, tier: 0, anchored: false, kind: 'roof', yaw: s.yaw, impactRadius: 9.0 },
    );
    links.push(
      ['roof_1', 'up_wall_w'],
      ['roof_1', 'up_wall_e'],
      ['roof_1', 'up_wall_b'],
      ['roof_1', 'up_parapet_f'],
      ['up_wall_w', 'roof_2'],
      ['up_wall_e', 'roof_2'],
      ['up_wall_b', 'roof_2'],
    );
  }

  if (s.hasAwning) {
    nodes.push({
      id: 'awning',
      pos: pt(0, 2.55, hd + 0.85),
      half: [hw * 0.72, 0.08, 0.85],
      mat: 'rust',
      color: 0xb2683e,
      hp: 55,
      tier: 0,
      anchored: false,
      kind: 'roof',
      yaw: s.yaw,
      pitch: 0.18,
    });
    links.push(['post_fl', 'awning'], ['post_fr', 'awning']);
  }

  if (s.hasHazard) {
    nodes.push({
      id: 'fuel_drum',
      pos: pt(-hw * 0.45, 0.56, -hd * 0.35),
      half: [0.42, 0.56, 0.42],
      mat: 'paintRed',
      color: 0xcc2820,
      hp: 35,
      tier: 0,
      anchored: true,
      kind: 'hazard',
      yaw: s.yaw,
      hazardRadius: 9.0,
      hazardDamage: 225,
    });
  }

  const navProxies = s.walkableRoof
    ? [createNavNodeProxy(k.physics, roof1)].filter((c): c is NonNullable<typeof c> => c !== null)
    : undefined;

  return {
    id: s.id,
    tag: s.id,
    kind: 'warrenShack',
    label: s.stories === 2 ? 'TWO-STOREY SHANTY' : 'WARREN SHANTY',
    value: s.stories === 2 ? 78_000 : 48_000,
    nodes,
    links,
    collapseThreshold: 0.42,
    navProxies,
  };
}

/** Builds a Tier-0 destructible rooftop catwalk bridge at y = 3.4 between alley shacks. */
function buildRooftopCatwalkCluster(
  k: Kit,
  idx: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  withNavProxy: boolean,
): StructuralClusterSpec {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  const yaw = Math.atan2(-dz, dx);
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  const deckHalfY = 0.1;
  const legH = SINGLE_H - deckHalfY * 2;

  const deck: StructuralNodeSpec = {
    id: 'catwalk_deck',
    pos: [mx, SINGLE_H - deckHalfY, mz],
    half: [len / 2, deckHalfY, 1.1],
    mat: 'grate',
    color: 0x6b6a64,
    hp: 85,
    tier: 0,
    anchored: false,
    kind: 'catwalk',
    yaw,
    impactRadius: 6,
  };

  const nodes: StructuralNodeSpec[] = [
    { id: 'leg_a', pos: [ax, legH / 2, az], half: [0.18, legH / 2, 0.85], mat: 'rust', color: 0x764c34, hp: 85, tier: 0, anchored: true, kind: 'column', yaw },
    { id: 'leg_b', pos: [bx, legH / 2, bz], half: [0.18, legH / 2, 0.85], mat: 'rust', color: 0x764c34, hp: 85, tier: 0, anchored: true, kind: 'column', yaw },
    deck,
  ];

  const navProxies = withNavProxy
    ? [createNavNodeProxy(k.physics, deck)].filter((c): c is NonNullable<typeof c> => c !== null)
    : undefined;

  return {
    id: `warren.catwalk.${idx}`,
    tag: `warren.catwalk.${idx}`,
    kind: 'rooftopCatwalk',
    label: 'ROOFTOP CATWALK',
    value: 36_000,
    nodes,
    links: [
      ['leg_a', 'catwalk_deck'],
      ['leg_b', 'catwalk_deck'],
    ],
    collapseThreshold: 0.45,
    navProxies,
  };
}

/** Builds a Tier-0 street sandbag/crate barricade cluster with explosive fuel drum. */
function buildStreetCoverCluster(idx: number, x: number, z: number, yaw: number): StructuralClusterSpec {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const pt = (lx: number, ly: number, lz: number): [number, number, number] => [
    x + lx * c + lz * s,
    ly,
    z - lx * s + lz * c,
  ];

  return {
    id: `warren.cover.${idx}`,
    tag: `warren.cover.${idx}`,
    kind: 'streetCover',
    label: 'STREET BARRICADE',
    value: 18_000,
    nodes: [
      { id: 'sandbags', pos: pt(0, 0.56, 0), half: [1.9, 0.56, 0.42], mat: 'dirt', color: 0x9b8660, hp: 80, tier: 0, anchored: true, kind: 'wall', yaw },
      { id: 'crate', pos: pt(-1.6, 0.52, -0.7), half: [0.55, 0.52, 0.55], mat: 'plywood', color: 0x9a7549, hp: 65, tier: 0, anchored: true, kind: 'wall', yaw },
      { id: 'drum', pos: pt(1.5, 0.55, -0.55), half: [0.4, 0.55, 0.4], mat: 'paintRed', color: 0xcc2820, hp: 35, tier: 0, anchored: true, kind: 'hazard', yaw, hazardRadius: 8.5, hazardDamage: 210 },
    ],
    collapseThreshold: 0.5,
  };
}

/**
 * Elevated Optional Minigun Nest at exact WARREN_MINIGUN.pos ([-14, 4.2, 22]).
 * Solid concrete/steel platform & street stairs ensure rock-solid NavGraph + gun footing,
 * while its front sandbag breastwork and corrugated sunshade canopy are Tier-0 destructible!
 */
function buildMinigunNest(k: Kit, spec: MapSpec): void {
  const [mx, my, mz] = WARREN_MINIGUN.pos; // [-14, 4.2, 22]
  const g = k.geo;

  // Solid elevated scaffold deck (top surface exact y = 4.2, footprint x: -17.4..-10.6, z: 19.2..24.8)
  k.floor('steel', mx - 3.4, mz - 2.8, mx + 3.4, mz + 2.8, my, 0.36, 3, 'metal');
  // 4 solid corner concrete/steel scaffold columns supporting the deck
  for (const sx of [-3.0, 3.0]) {
    for (const sz of [-2.4, 2.4]) {
      k.column(mx + sx, mz + sz, 0, my - 0.36, 0.56, 'concreteDark');
    }
  }
  // Cross-bracing I-beams beneath the deck for authentic salvage-tower silhouette
  k.beam(mx - 3.0, 0.4, mz - 2.4, mx + 3.0, my - 0.5, mz - 2.4, 0.1, 0.1, 'rust');
  k.beam(mx + 3.0, 0.4, mz - 2.4, mx - 3.0, my - 0.5, mz - 2.4, 0.1, 0.1, 'rust');
  // Safety rail along west edge (north & east have Tier-0 sandbag cover; south has stairs!)
  k.rail([mx - 3.3, my, mz + 2.7, mx - 3.3, my, mz - 2.7], 1.05, 1.8);

  // Wide walkable stairs ascending from south street (-14, 0, 31.8) up to deck south edge (-14, 4.2, 24.8)
  // Run = 7.0 m, rise = 4.2 m -> slope = 0.60, ny = 0.857 >> 0.68!
  k.stairs(mx, mz + 9.8, 0, mx, mz + 2.8, my, 2.6, 'steel', true);

  // Tier-0 destructible front sandbag cover & overhead corrugated sunshade canopy on the minigun deck
  spec.cluster({
    id: 'warren.minigun.cover',
    tag: 'warren.minigun.cover',
    kind: 'minigunCover',
    label: 'MINIGUN NEST PARAPET',
    value: 35_000,
    nodes: [
      { id: 'bags_north', pos: [mx, my + 0.48, mz - 2.5], half: [2.9, 0.48, 0.32], mat: 'dirt', color: 0x9b8660, hp: 90, tier: 0, anchored: true, kind: 'wall' },
      { id: 'bags_east', pos: [mx + 3.1, my + 0.48, mz - 0.4], half: [0.32, 0.48, 2.1], mat: 'dirt', color: 0x937e5a, hp: 90, tier: 0, anchored: true, kind: 'wall' },
      { id: 'post_nw', pos: [mx - 3.0, my + 1.35, mz - 2.4], half: [0.12, 1.35, 0.12], mat: 'rust', color: 0x764c34, hp: 70, tier: 0, anchored: true, kind: 'column' },
      { id: 'post_ne', pos: [mx + 3.0, my + 1.35, mz - 2.4], half: [0.12, 1.35, 0.12], mat: 'rust', color: 0x764c34, hp: 70, tier: 0, anchored: true, kind: 'column' },
      { id: 'sunshade', pos: [mx, my + 2.75, mz - 1.1], half: [3.3, 0.08, 1.6], mat: 'rust', color: 0x9a5638, hp: 70, tier: 0, anchored: false, kind: 'roof' },
    ],
    links: [
      ['post_nw', 'sunshade'],
      ['post_ne', 'sunshade'],
    ],
    collapseThreshold: 0.5,
  });

  // Mount the optional M134 Minigun facing north (-Z, camera yaw = 0) with 140-deg (±1.22 rad) arc!
  spec.emplacement(mx, my, mz, 0, 1.22, 1);

  // Subtle warm work lamp lighting the minigun platform so players spot it immediately from the street
  g.use('emissiveOrange').box(mx - 3.0, my + 2.5, mz - 2.35, 0.25, 0.14, 0.14, FACE.all);
  k.light(mx, my + 2.2, mz, DESERT_PALETTE.lanternWarm, 28, 14);
  spec.plan?.decks.push({ x0: mx - 3.4, z0: mz - 2.8, x1: mx + 3.4, z1: mz + 2.8 });
}

/** 3 solid weathered concrete cistern / rock landmarks so navigation never gets lost when shacks are flattened. */
function buildWarrenLandmarks(k: Kit, spec: MapSpec): void {
  const g = k.geo;

  // 1. West Weathered Concrete Water Cistern at (-36, 0, 32)
  tank(k, -36, 32, 0, 3.2, 4.6, 'concrete', { ladder: true, bands: 2, seg: 16 });
  spec.plan?.blocks.push({ x0: -39.4, z0: 28.6, x1: -32.6, z1: 35.4 });

  // 2. East Red-Sandstone Outcrop / Shrine Rock at (34, 0, 18)
  k.push(34, 0, 18, 0.35);
  g.use('concrete').tint(DESERT_PALETTE.mesaDark[0], DESERT_PALETTE.mesaDark[1], DESERT_PALETTE.mesaDark[2]);
  g.bevel(0, 1.5, 0, 3.3, 1.5, 2.5, 0.45);
  g.use('concrete').tint(DESERT_PALETTE.mesaLight[0], DESERT_PALETTE.mesaLight[1], DESERT_PALETTE.mesaLight[2]);
  g.bevel(0.4, 3.4, -0.2, 2.3, 1.6, 1.9, 0.4);
  g.tint(1);
  k.collide(0, 2.4, 0, 3.0, 2.4, 2.3, 'concrete');
  k.pop();
  k.light(34, 5.4, 18, DESERT_PALETTE.lanternWarm, 22, 13);
  spec.plan?.blocks.push({ x0: 30.6, z0: 15.2, x1: 37.4, z1: 20.8 });

  // 3. North-West Weathered Concrete Wellhouse Cistern at (-26, 0, -2)
  tank(k, -26, -2, 0, 3.0, 4.2, 'concreteDark', { ladder: true, bands: 2, seg: 16 });
  spec.plan?.blocks.push({ x0: -29.2, z0: -5.2, x1: -22.8, z1: 1.2 });
}

/** Overhead sagging washing line with fluttering dyed cloth scraps between two street anchors. */
function washingLine(k: Kit, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
  const g = k.geo;
  const sag = 0.75;
  cable(k, ax, ay, az, bx, by, bz, sag, 0.015);
  const len = Math.hypot(bx - ax, bz - az);
  const count = Math.max(4, Math.round(len / 1.4));
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const y = ay + (by - ay) * t - sag * 4 * t * (1 - t);
    const dye: Rgb = DESERT_PALETTE.bannerDyes[i % DESERT_PALETTE.bannerDyes.length]!;
    g.use('paintWhite').tint(dye[0] * 1.15, dye[1] * 1.15, dye[2] * 1.15);
    g.box(x, y - 0.32, z, 0.28, 0.32, 0.015, FACE.pz | FACE.nz | FACE.px | FACE.nx);
  }
  g.tint(1);
}

/** Burning oil-drum brazier casting warm desert night/dawn amber pools down shanty alleys. */
function streetBrazier(k: Kit, x: number, z: number): void {
  const g = k.geo;
  g.use('rust').cyl(x, 0, z, x, 0.9, z, 0.3, 0.3, 8, false, false);
  g.use('emissiveOrange').cyl(x, 0.86, z, x, 0.9, z, 0.26, 0.26, 8, false, true);
  k.collide(x, 0.45, z, 0.32, 0.45, 0.32, 'metal', false);
  k.light(x, 1.8, z, DESERT_PALETTE.dawnAmber, 22, 13);
}

export function authorDesertWarren(k: Kit, spec: MapSpec): void {
  // 1. 20 distinct Tier-0 destructible shacks (14 single-storey + 6 two-storey)
  for (const s of WARREN_SHACKS) {
    spec.cluster(buildWarrenShackCluster(k, s));
    const hw = s.w / 2;
    const hd = s.d / 2;
    spec.plan?.blocks.push({ x0: s.x - hw, z0: s.z - hd, x1: s.x + hw, z1: s.z + hd });
  }

  // 2. Walkable steel access stairs up to 2 single-storey shanty roofs so players & enemies can fight on roofs
  // Shack 7 (-16, 42) stair from south (-16, 0, 50.8) -> (-16, 3.4, 44.8)
  k.stairs(-16, 50.8, 0, -16, 44.8, SINGLE_H, 1.8, 'steel', true);
  // Shack 4 (-30, 14) stair from south (-30, 0, 22.4) -> (-30, 3.4, 16.4)
  k.stairs(-30, 22.4, 0, -30, 16.4, SINGLE_H, 1.8, 'steel', true);
  // Shack 16 (34, 32) stair from south (34, 0, 40.4) -> (34, 3.4, 34.4)
  k.stairs(34, 40.4, 0, 34, 34.4, SINGLE_H, 1.8, 'steel', true);

  // 3. 4 Tier-0 Destructible Rooftop Catwalks bridging shanty alleys at y = 3.4
  const catwalks: readonly [number, number, number, number, boolean][] = [
    [-27.0, 14.0, -17.0, 8.0, true], // West alley bridge from Shack 4 roof to Shack 8 roof
    [-44.0, 44.0, -33.2, 44.0, false], // South-West alley catwalk between Shack 0 and Shack 1
    [34.0, 34.5, 34.0, 41.6, true], // East alley catwalk connecting Shack 16 & Shack 14
    [19.2, 28.0, 30.8, 31.0, false], // Center-East alley catwalk
  ];
  for (let i = 0; i < catwalks.length; i++) {
    const [ax, az, bx, bz, navProxy] = catwalks[i]!;
    spec.cluster(buildRooftopCatwalkCluster(k, i, ax, az, bx, bz, navProxy));
    spec.plan?.decks.push({
      x0: Math.min(ax, bx) - 1.1,
      z0: Math.min(az, bz) - 1.1,
      x1: Math.max(ax, bx) + 1.1,
      z1: Math.max(az, bz) + 1.1,
    });
  }

  // 4. Elevated Optional Minigun Nest at exact WARREN_MINIGUN.pos ([-14, 4.2, 22])
  buildMinigunNest(k, spec);

  // 5. 3 Solid Weathered Concrete Cistern / Rock Landmarks
  buildWarrenLandmarks(k, spec);

  // 6. 6 Tier-0 Street Sandbag & Crate Barricade Clusters (flanking the central exfil corridor, never blocking it!)
  const streetCovers: readonly [number, number, number][] = [
    [-7.5, 36, 0.25],
    [9.5, 34, -0.3],
    [-24, 24, 0.15],
    [12, 18, -0.2],
    [-22, 6, 0.3],
    [34, 8, -0.15],
  ];
  for (let i = 0; i < streetCovers.length; i++) {
    const [cx, cz, cyaw] = streetCovers[i]!;
    spec.cluster(buildStreetCoverCluster(i, cx, cz, cyaw));
  }

  // Extra red fuel barrel clusters tucked in alley ambush corners
  spec.barrels(-8, 0, 26, 2);
  spec.barrels(12, 0, 10, 2);
  spec.barrels(-34, 0, 6, 3);
  spec.barrels(36, 0, 24, 3);

  // 7. Overhead washing lines, sagging power cables, tyres & warm alley braziers
  washingLine(k, -16, 4.5, 42, 16, 4.5, 42);
  washingLine(k, -30, 5.2, 44, -16, 4.4, 42);
  washingLine(k, 16, 5.2, 28, 34, 4.4, 32);
  washingLine(k, -46, 5.2, 16, -30, 4.4, 14);
  washingLine(k, -14, 4.5, 8, 22, 4.5, 4);
  cable(k, -30, 6.4, 44, 16, 6.4, 28, 1.5, 0.035);
  cable(k, 16, 6.4, 28, 48, 6.4, 10, 1.8, 0.035);
  cable(k, -46, 6.4, 16, -42, 6.4, -8, 1.6, 0.035);

  for (const [bx, bz] of [
    [-8, 46],
    [9, 46],
    [-24, 36],
    [26, 36],
    [-22, 14],
    [24, 18],
    [-8, 2],
    [22, -2],
  ] as const) {
    streetBrazier(k, bx, bz);
  }

  for (const [tx, tz] of [
    [-38, 38],
    [24, 38],
    [-36, 22],
    [40, 16],
    [-16, -2],
  ] as const) {
    tyres(k, tx, 0, tz, 3, false);
  }

  // Warm dawn skylight washes over the central Warren avenue
  k.light(0, 14, 32, DESERT_PALETTE.dawnWarm, 55, 36);
  k.light(4, 14, 4, DESERT_PALETTE.dawnWarm, 52, 34);
}
