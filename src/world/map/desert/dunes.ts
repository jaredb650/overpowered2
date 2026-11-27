/**
 * Surplus — Dawn Desert Floor, Flanking Sand Dunes, Sandstone Mesas & Section 1 Approach Posts.
 *
 * Covers the full expanded DESERT_BOUNDS (-180..180, -285..240) with a 10-band ground slab that
 * leaves surgical cutouts for:
 *   - Pump Yard storm sewer entry drop pit (`SEWER_DROP_PIT`, centered at z = -28)
 *   - Storm sewer exit shaft (`SEWER_EXIT_PIT`, emerging at HIGH_TERRACES.sewerExitTop [0, 0, -81])
 *   - Salt Cave subterranean corridor (`SALT_CAVE_PIT`, z = -201.5..-148.5, x = -13..+13)
 * Keeps CONVOY_PATHS.approach, CONVOY_PATHS.wallLoop, and the Eastern Convoy Bypass Road
 * (`x = +44..+56`, `y = 0`) flat and unobstructed while flanking the valley with sculpted dunes,
 * monumental red-sandstone mesas, and 4 Tier-0 Saltblood lookout posts at APPROACH_POSTS.
 */
import type { StructuralClusterSpec, StructuralNodeSpec } from '../../destruction';
import { FACE, type Mat } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { cable, truck, tyres } from '../../kit/props';
import type { MapSpec } from '../spec';
import { APPROACH_POSTS, CONVOY_PATHS, DESERT_BOUNDS, DESERT_Z } from './plan';

export type Rgb = readonly [number, number, number];

/** Shared cutout rectangles in the y = 0 ground slab for Sewer shafts and Salt Cave corridor. */
export const SEWER_DROP_PIT = { x0: -13.0, x1: -4.8, z0: -30.2, z1: -25.8 } as const;
export const SEWER_EXIT_PIT = { x0: 0.5, x1: 9.1, z0: -82.9, z1: -79.1 } as const;
export const SALT_CAVE_PIT = { x0: -13.0, x1: 13.0, z0: -201.5, z1: -148.5 } as const;

/** Warm golden dawn desert palette shared across Surplus modules. */
export const DESERT_PALETTE = {
  sandLight: [1.14, 0.92, 0.64] as Rgb,
  sandMid: [1.04, 0.82, 0.54] as Rgb,
  sandSalt: [0.95, 0.88, 0.74] as Rgb,
  trackDirt: [0.78, 0.60, 0.40] as Rgb,
  townDust: [0.88, 0.72, 0.52] as Rgb,
  mesaLight: [0.88, 0.56, 0.36] as Rgb,
  mesaDark: [0.70, 0.42, 0.28] as Rgb,
  concreteDust: [0.82, 0.76, 0.66] as Rgb,
  dawnWarm: 0xffb35c,
  dawnAmber: 0xff8a36,
  lanternWarm: 0xff9a44,
  shantyColors: [
    0xc97b4b, // sun-baked terracotta
    0xb58d52, // desert ochre
    0x6e8c82, // faded alkali teal
    0x9b5a3c, // rust sienna
    0xc4a472, // bleached sandstone
    0x7c7668, // weathered tin grey
    0xa84836, // Saltblood crimson
    0x8e6b46, // sun-bleached timber
  ] as readonly number[],
  bannerDyes: [
    [0.82, 0.22, 0.16] as Rgb, // Saltblood crimson
    [0.92, 0.58, 0.18] as Rgb, // dawn ochre
    [0.24, 0.20, 0.18] as Rgb, // oil-black
    [0.86, 0.76, 0.52] as Rgb, // bleached bone
  ] as readonly Rgb[],
} as const;

const GROUND_THICK = 0.8;

/** Helper to lay a visual ground quad patch with tint. */
function groundPatch(
  k: Kit,
  mat: Mat,
  tint: Rgb,
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

/** 10-band ground floor & matching box colliders covering DESERT_BOUNDS with surgical cutouts. */
function buildGround(k: Kit): void {
  const { x0, x1, z0, z1 } = DESERT_BOUNDS;
  const dp = SEWER_DROP_PIT;
  const ep = SEWER_EXIT_PIT;
  const cp = SALT_CAVE_PIT;

  const bands: readonly [number, number, number, number][] = [
    // Band 1: Approach, Wall, Warren, South Pump Yard (z = -25.8 .. 240)
    [x0, dp.z1, x1, z1],
    // Band 2: Sewer Drop Pit strip (z = -30.2 .. -25.8)
    [x0, dp.z0, dp.x0, dp.z1],
    [dp.x1, dp.z0, x1, dp.z1],
    // Band 3: Pump Yard North & South Terrace Buffer (z = -79.1 .. -30.2)
    [x0, ep.z1, x1, dp.z0],
    // Band 4: Sewer Exit Pit strip (z = -82.9 .. -79.1)
    [x0, ep.z0, ep.x0, ep.z1],
    [ep.x1, ep.z0, x1, ep.z1],
    // Band 5: High Terraces Ground Floor & Eastern Bypass (z = -148.5 .. -82.9)
    [x0, cp.z1, x1, ep.z0],
    // Band 6: Salt Cave Corridor strip (z = -201.5 .. -148.5) — leaves Eastern Bypass (x = 44..56) flat at y = 0!
    [x0, cp.z0, cp.x0, cp.z1],
    [cp.x1, cp.z0, x1, cp.z1],
    // Band 7: Plane Canyon Forecourt & Crashed Plane North Plateau (z = -285 .. -201.5)
    [x0, z0, x1, cp.z0],
  ];

  for (const [bx0, bz0, bx1, bz1] of bands) {
    // Visual golden sand base (generous grid step keeps tri budget lean across 525 m span)
    const span = Math.max(bx1 - bx0, bz1 - bz0);
    const step = span > 80 ? 14 : span > 30 ? 10 : 6;
    groundPatch(k, 'dirt', DESERT_PALETTE.sandLight, bx0, bz0, bx1, bz1, 0, step);
    // Single clean static ground collider per band (top exact y = 0, bottom y = -0.8)
    k.collide(
      (bx0 + bx1) / 2,
      -GROUND_THICK / 2,
      (bz0 + bz1) / 2,
      (bx1 - bx0) / 2,
      GROUND_THICK / 2,
      (bz1 - bz0) / 2,
      'dirt',
    );
  }

  // Sun-bleached salt-flat alkali patches on the outer flanks
  groundPatch(k, 'paintWhite', DESERT_PALETTE.sandSalt, -178, 86, -64, 232, 0.012, 20);
  groundPatch(k, 'paintWhite', DESERT_PALETTE.sandSalt, 64, 86, 178, 232, 0.012, 20);

  // Dusty shantytown floor inside The Warren (z = -14 .. 62, x = -76 .. 76)
  groundPatch(k, 'dirt', DESERT_PALETTE.townDust, -76, -14, 76, DESERT_Z.wallLine, 0.014, 10);

  // Industrial concrete apron across Pump Yard (respecting drop pit cutout!)
  groundPatch(k, 'concrete', DESERT_PALETTE.concreteDust, -50, dp.z1, 50, -14, 0.018, 8);
  groundPatch(k, 'concrete', DESERT_PALETTE.concreteDust, -50, dp.z0, dp.x0, dp.z1, 0.018, 6);
  groundPatch(k, 'concrete', DESERT_PALETTE.concreteDust, dp.x1, dp.z0, 50, dp.z1, 0.018, 6);
  groundPatch(k, 'concrete', DESERT_PALETTE.concreteDust, -50, -56, 50, dp.z0, 0.018, 8);

  // High Terraces Tier-1 compacted sandstone courtyard floor (respecting exit pit cutout!)
  groundPatch(k, 'dirt', DESERT_PALETTE.townDust, -40, ep.z0, ep.x0, ep.z1, 0.016, 6);
  groundPatch(k, 'dirt', DESERT_PALETTE.townDust, ep.x1, ep.z0, 40, ep.z1, 0.016, 6);
  groundPatch(k, 'dirt', DESERT_PALETTE.townDust, -40, -104, 40, ep.z0, 0.016, 8);

  // Plane Canyon Forecourt compacted hardpan apron (z = -274 .. -201.5)
  groundPatch(k, 'dirt', DESERT_PALETTE.townDust, -44, -274, 44, cp.z0, 0.016, 10);

  // Convoy dirt track ruts along approach, wall broadside loop, and Eastern Convoy Bypass Road (flush at y = 0.022)
  drawConvoyTrack(k, CONVOY_PATHS.approach, 10.5);
  drawConvoyTrack(k, CONVOY_PATHS.wallLoop, 9.5);
  drawConvoyTrack(k, CONVOY_PATHS.exfil.slice(0, 9), 8.0);

  // Endless golden dawn desert skirt past DESERT_BOUNDS to the horizon (visual only)
  const FAR = 960;
  groundPatch(k, 'dirt', DESERT_PALETTE.sandMid, -FAR, -FAR, FAR, z0, -0.04, 180);
  groundPatch(k, 'dirt', DESERT_PALETTE.sandMid, -FAR, z1, FAR, FAR, -0.04, 180);
  groundPatch(k, 'dirt', DESERT_PALETTE.sandMid, -FAR, z0, x0, z1, -0.04, 180);
  groundPatch(k, 'dirt', DESERT_PALETTE.sandMid, x1, z0, FAR, z1, -0.04, 180);
}

/** Paints a compacted desert convoy track & twin wheel-rut bands along a polyline. */
function drawConvoyTrack(k: Kit, pts: readonly (readonly [number, number, number])[], width: number): void {
  const g = k.geo;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    k.along(a[0], 0.02, a[2], b[0], 0.02, b[2], len => {
      g.use('dirt').tint(DESERT_PALETTE.trackDirt[0], DESERT_PALETTE.trackDirt[1], DESERT_PALETTE.trackDirt[2]);
      g.box(len / 2, 0.005, 0, len / 2 + 1.5, 0.005, width / 2, FACE.py);
      g.tint(0.56, 0.42, 0.28);
      for (const s of [-1, 1]) {
        g.box(len / 2, 0.009, s * (width * 0.26), len / 2 + 1.2, 0.004, 0.55, FACE.py);
      }
      g.tint(1);
    });
  }
}

/** Sculpted sweeping desert sand dune ridge with windward/leeward slopes and solid core collider. */
function sandDune(
  k: Kit,
  spec: MapSpec,
  x: number,
  z: number,
  len: number,
  w: number,
  h: number,
  yaw: number,
  collide = true,
): void {
  const g = k.geo;
  const hl = len / 2;
  const hw = w / 2;
  const crest = w * 0.12;
  k.push(x, 0, z, yaw);

  g.use('dirt').tint(DESERT_PALETTE.sandLight[0], DESERT_PALETTE.sandLight[1], DESERT_PALETTE.sandLight[2]);
  g.quad(-hl, 0, hw, hl, 0, hw, hl * 0.72, h, crest, -hl * 0.72, h, crest);
  g.use('dirt').tint(DESERT_PALETTE.sandMid[0] * 0.88, DESERT_PALETTE.sandMid[1] * 0.86, DESERT_PALETTE.sandMid[2] * 0.84);
  g.quad(hl, 0, -hw, -hl, 0, -hw, -hl * 0.72, h, crest, hl * 0.72, h, crest);
  g.use('dirt').tint(DESERT_PALETTE.sandMid[0], DESERT_PALETTE.sandMid[1], DESERT_PALETTE.sandMid[2]);
  g.tri(-hl, 0, -hw, -hl, 0, hw, -hl * 0.72, h, crest);
  g.tri(hl, 0, hw, hl, 0, -hw, hl * 0.72, h, crest);
  g.tint(1);

  if (collide) {
    k.noClimb(() => k.collide(0, h * 0.42, 0, hl * 0.78, h * 0.42, hw * 0.58, 'dirt'));
    const c = Math.abs(Math.cos(yaw));
    const s = Math.abs(Math.sin(yaw));
    const ex = hl * 0.75 * c + hw * 0.55 * s;
    const ez = hl * 0.75 * s + hw * 0.55 * c;
    spec.plan?.blocks.push({ x0: x - ex, z0: z - ez, x1: x + ex, z1: z + ez });
  }
  k.pop();
}

/** Layered red-sandstone desert mesa / rocky outcrop landmark (100% solid). */
export function sandstoneMesa(
  k: Kit,
  spec: MapSpec,
  x: number,
  z: number,
  rx: number,
  rz: number,
  h: number,
  yaw = 0,
  collide = true,
): void {
  const g = k.geo;
  k.push(x, 0, z, yaw);

  g.use('concrete').tint(DESERT_PALETTE.mesaDark[0], DESERT_PALETTE.mesaDark[1], DESERT_PALETTE.mesaDark[2]);
  g.bevel(0, h * 0.22, 0, rx, h * 0.22, rz, Math.min(rx, rz) * 0.18);
  g.use('concrete').tint(DESERT_PALETTE.mesaLight[0], DESERT_PALETTE.mesaLight[1], DESERT_PALETTE.mesaLight[2]);
  g.bevel(rx * 0.05, h * 0.58, -rz * 0.04, rx * 0.78, h * 0.34, rz * 0.78, Math.min(rx, rz) * 0.14);
  g.use('concreteDark').tint(DESERT_PALETTE.mesaDark[0] * 1.1, DESERT_PALETTE.mesaDark[1] * 1.1, DESERT_PALETTE.mesaDark[2] * 1.05);
  g.bevel(-rx * 0.04, h * 0.90, rz * 0.03, rx * 0.62, h * 0.14, rz * 0.60, Math.min(rx, rz) * 0.12);
  g.tint(1);

  if (collide) {
    k.noClimb(() => k.collide(0, h * 0.5, 0, rx * 0.85, h * 0.5, rz * 0.85, 'concrete'));
    const c = Math.abs(Math.cos(yaw));
    const s = Math.abs(Math.sin(yaw));
    const ex = rx * 0.85 * c + rz * 0.85 * s;
    const ez = rx * 0.85 * s + rz * 0.85 * c;
    spec.plan?.blocks.push({ x0: x - ex, z0: z - ez, x1: x + ex, z1: z + ez });
  }
  k.pop();
}

/** Sun-bleached desert scrub bush / marker pole with tattered red rag. */
function desertScrubPole(k: Kit, x: number, z: number, h: number, yaw: number, withFlag = true): void {
  const g = k.geo;
  g.use('rust').tint(0.75).cyl(x, 0, z, x + Math.sin(yaw) * 0.15, h, z + Math.cos(yaw) * 0.15, 0.07, 0.045, 5, false, true);
  if (withFlag) {
    k.push(x + Math.sin(yaw) * 0.15, h - 0.1, z + Math.cos(yaw) * 0.15, yaw);
    const dye = DESERT_PALETTE.bannerDyes[Math.abs(Math.round(x + z)) % DESERT_PALETTE.bannerDyes.length]!;
    g.use('paintWhite').tint(dye[0] * 1.2, dye[1] * 1.2, dye[2] * 1.2);
    g.quad(0, 0, 0, 1.35, -0.08, 0.08, 1.25, -0.68, 0.12, 0, -0.78, 0);
    g.quad(1.35, -0.08, 0.08, 0, 0, 0, 0, -0.78, 0, 1.25, -0.68, 0.12);
    k.pop();
  }
  g.use('plywood').tint(0.62, 0.54, 0.36);
  for (let i = 0; i < 3; i++) {
    const a = yaw + i * 2.1;
    g.cyl(x, 0, z, x + Math.cos(a) * 0.7, 0.65, z + Math.sin(a) * 0.7, 0.05, 0.02, 4, false, true);
  }
  g.tint(1);
}

/**
 * Builds one Tier-0 destructible Saltblood desert lookout post:
 * 4 timber stilts, elevated deck, corrugated shelter walls, slanted roof,
 * ground-level sandbag bunker, and a red fuel drum hazard so convoy heavy fire blows it apart.
 */
function buildApproachPostCluster(id: string, x: number, z: number, yaw: number): StructuralClusterSpec {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const pt = (lx: number, ly: number, lz: number): [number, number, number] => [
    x + lx * c + lz * s,
    ly,
    z - lx * s + lz * c,
  ];
  const H = 3.2;
  const W = 1.9;
  const D = 1.6;

  const nodes: StructuralNodeSpec[] = [
    { id: 'stilt_fl', pos: pt(-W, H / 2, D), half: [0.18, H / 2, 0.18], mat: 'plywood', color: 0x7c5b3b, hp: 90, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', loadCapacity: 24_000 },
    { id: 'stilt_fr', pos: pt(W, H / 2, D), half: [0.18, H / 2, 0.18], mat: 'plywood', color: 0x7c5b3b, hp: 90, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', loadCapacity: 24_000 },
    { id: 'stilt_bl', pos: pt(-W, H / 2, -D), half: [0.18, H / 2, 0.18], mat: 'plywood', color: 0x7d4c32, hp: 90, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', loadCapacity: 24_000 },
    { id: 'stilt_br', pos: pt(W, H / 2, -D), half: [0.18, H / 2, 0.18], mat: 'plywood', color: 0x7d4c32, hp: 90, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', loadCapacity: 24_000 },
    { id: 'deck', pos: pt(0, H + 0.14, 0), half: [W + 0.4, 0.14, D + 0.4], mat: 'plywood', color: 0x9b764c, hp: 105, tier: 0, anchored: false, kind: 'slab', yaw, impactRadius: 6.5, materialClass: 'wood', structuralMaterial: 'timber', supportRole: 'load_bearing', lazyFracture: true, fractureGrid: [2, 2], navWalkable: true },
    { id: 'wall_back', pos: pt(0, H + 1.25, -D), half: [W + 0.2, 1.0, 0.12], mat: 'rust', color: 0x9b5a3c, hp: 110, tier: 0, anchored: false, kind: 'wall', yaw, materialClass: 'metal', structuralMaterial: 'timber', supportRole: 'infill', lazyFracture: true, fractureGrid: [2, 2] },
    { id: 'parapet_front', pos: pt(0, H + 0.72, D + 0.1), half: [W + 0.25, 0.48, 0.18], mat: 'dirt', color: 0x9c8864, hp: 95, tier: 0, anchored: false, kind: 'wall', yaw, materialClass: 'stone', structuralMaterial: 'timber', supportRole: 'infill' },
    { id: 'roof', pos: pt(0, H + 2.38, 0), half: [W + 0.55, 0.1, D + 0.55], mat: 'panel', color: 0xb58d52, hp: 100, tier: 0, anchored: false, kind: 'roof', yaw, impactRadius: 6.5, materialClass: 'metal', structuralMaterial: 'timber', supportRole: 'load_bearing', lazyFracture: true, fractureGrid: [2, 2] },
    { id: 'sandbags_base', pos: pt(0, 0.6, D + 0.9), half: [W + 0.6, 0.6, 0.38], mat: 'dirt', color: 0x9b8660, hp: 100, tier: 0, anchored: true, kind: 'wall', yaw, materialClass: 'stone', structuralMaterial: 'timber', supportRole: 'infill', navBlock: true },
    { id: 'fuel_drum', pos: pt(W + 0.85, 0.55, D + 0.35), half: [0.42, 0.55, 0.42], mat: 'paintRed', color: 0xc82820, hp: 35, tier: 0, anchored: true, kind: 'hazard', yaw, hazardRadius: 8.5, hazardDamage: 220, materialClass: 'metal', structuralMaterial: 'timber', supportRole: 'infill' },
  ];

  const links: [string, string][] = [
    ['stilt_fl', 'deck'],
    ['stilt_fr', 'deck'],
    ['stilt_bl', 'deck'],
    ['stilt_br', 'deck'],
    ['deck', 'wall_back'],
    ['deck', 'parapet_front'],
    ['wall_back', 'roof'],
    ['deck', 'roof'],
  ];

  return {
    id,
    tag: id,
    kind: 'lookoutPost',
    label: 'SALTBLOOD LOOKOUT POST',
    value: 55_000,
    nodes,
    links,
    collapseThreshold: 0.45,
  };
}

/** Invisible perimeter containment walls on DESERT_BOUNDS so rocket jumps stay inside while gunship fire passes cleanly. */
function buildContainment(k: Kit): void {
  const { x0, x1, y1, z0, z1 } = DESERT_BOUNDS;
  const h = y1 / 2;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const hx = (x1 - x0) / 2 + 1;
  const hz = (z1 - z0) / 2 + 1;
  k.containment(cx, h, z0 - 0.5, hx, h, 0.5);
  k.containment(cx, h, z1 + 0.5, hx, h, 0.5);
  k.containment(x0 - 0.5, h, cz, 0.5, h, hz);
  k.containment(x1 + 0.5, h, cz, 0.5, h, hz);
}

export function authorDesertDunes(k: Kit, spec: MapSpec): void {
  buildGround(k);

  // Flanking golden sand dunes along the Approach corridor & outer desert flanks (well clear of Eastern Bypass x = 44..56!)
  const duneSpecs: readonly [number, number, number, number, number, number][] = [
    [-72, 204, 46, 22, 7.5, 0.25],
    [76, 198, 48, 24, 8.2, -0.22],
    [-82, 148, 52, 24, 8.8, -0.18],
    [80, 140, 44, 22, 7.2, 0.30],
    [-98, 96, 48, 24, 7.8, 0.15],
    [102, 98, 46, 24, 7.6, -0.20],
    [-124, 20, 56, 26, 9.0, 1.35],
    [126, 12, 56, 26, 9.2, 1.65],
    [-112, -112, 54, 24, 8.4, 0.45],
    [118, -116, 54, 24, 8.6, -0.40],
  ];
  for (const [dx, dz, len, w, h, yaw] of duneSpecs) {
    sandDune(k, spec, dx, dz, len, w, h, yaw, true);
  }

  // Monumental red-sandstone mesas & rocky outcrops framing the valley & north plane canyon
  const mesaSpecs: readonly [number, number, number, number, number, number, boolean][] = [
    [-132, 182, 24, 18, 22, 0.2, true],
    [136, 170, 26, 20, 26, -0.35, true],
    [-138, 108, 22, 16, 19, -0.15, true],
    [138, 114, 24, 18, 21, 0.25, true],
    [-136, -42, 26, 24, 24, 0.1, true],
    [138, -46, 28, 22, 25, -0.18, true],
    [-98, -172, 28, 22, 24, 0.12, true],
    [106, -176, 30, 22, 26, -0.15, true],
    [-96, -248, 28, 22, 25, 0.22, true],
    [98, -252, 30, 22, 27, -0.2, true],
    // Massive distant dawn horizon mesas (visual backdrop past playable bounds)
    [-260, -320, 72, 46, 58, 0.2, false],
    [255, -330, 78, 48, 64, -0.25, false],
    [12, -370, 92, 42, 54, 0.05, false],
    [-275, 110, 58, 48, 46, 0.4, false],
    [285, 95, 62, 44, 50, -0.3, false],
  ];
  for (const [mx, mz, rx, rz, h, yaw, col] of mesaSpecs) {
    sandstoneMesa(k, spec, mx, mz, rx, rz, h, yaw, col);
  }

  // Smaller rocky sandstone boulders lining the approach flanks (outside convoy lane)
  for (const [rx, rz, r, h] of [
    [-46, 188, 3.4, 2.8],
    [48, 176, 3.8, 3.2],
    [-52, 140, 4.0, 3.4],
    [52, 128, 3.5, 2.9],
    [-64, 104, 4.2, 3.6],
    [66, 102, 4.0, 3.2],
  ] as const) {
    sandstoneMesa(k, spec, rx, rz, r, r * 0.82, h, rx * 0.1, true);
  }

  // 4 Tier-0 Destructible Saltblood Lookout Posts at exact APPROACH_POSTS (4 baked lights)
  for (const post of APPROACH_POSTS) {
    spec.cluster(buildApproachPostCluster(post.id, post.x, post.z, post.yaw));
    spec.plan?.blocks.push({
      x0: post.x - 2.6,
      z0: post.z - 2.6,
      x1: post.x + 2.6,
      z1: post.z + 2.6,
    });
    k.light(post.x, 4.2, post.z, DESERT_PALETTE.dawnAmber, 30, 18);
    tyres(k, post.x - Math.sign(post.x) * 3.4, 0, post.z + 1.8, 3, false);
    desertScrubPole(k, post.x + Math.sign(post.x) * 3.2, post.z - 2.0, 3.6, post.yaw, true);
  }

  // Rusted burnt-out desert convoy hulks flanking the approach dunes
  truck(k, -48, 0, 162, 0.55, 0.08);
  truck(k, 48, 0, 134, -0.75, -0.06);
  truck(k, -78, 0, 82, 1.3, 0.05);

  // Dried desert utility poles & sagging wire line running east of the approach toward Surplus
  const polePts: readonly [number, number][] = [
    [46, 206],
    [48, 170],
    [50, 134],
    [54, 98],
    [62, 68],
  ];
  for (let i = 0; i < polePts.length; i++) {
    const [px, pz] = polePts[i]!;
    k.geo.use('plywood').tint(0.55, 0.42, 0.28).cyl(px, 0, pz, px, 7.6, pz, 0.16, 0.12, 6, false, true);
    k.geo.use('steelDark').bevel(px, 7.2, pz, 1.1, 0.08, 0.08, 0.02);
    k.geo.tint(1);
    k.collide(px, 3.8, pz, 0.2, 3.8, 0.2, 'dirt', false);
    if (i > 0) {
      const [ax, az] = polePts[i - 1]!;
      cable(k, ax - 0.8, 7.2, az, px - 0.8, 7.2, pz, 1.6, 0.035);
      cable(k, ax + 0.8, 7.2, az, px + 0.8, 7.2, pz, 1.8, 0.035);
    }
  }

  // Convoy approach marker poles & scrub flanking the broad dawn road
  for (const [mx, mz, yaw] of [
    [-22, 198, 0.2],
    [22, 194, -0.3],
    [-25, 158, 0.4],
    [26, 138, -0.25],
    [-26, 108, 0.3],
    [26, 98, -0.35],
    [-64, 78, 0.6],
    [64, 78, -0.6],
  ] as const) {
    desertScrubPole(k, mx, mz, 2.8, yaw, true);
  }

  // Broad warm golden dawn sunlight wash over the approach & convoy loop (2 baked lights; total 6 in dunes)
  k.light(0, 18, 154, DESERT_PALETTE.dawnWarm, 72, 48);
  k.light(0, 16, 96, DESERT_PALETTE.dawnWarm, 68, 44);

  buildContainment(k);
}
