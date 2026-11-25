/**
 * Badlands — Open-Desert Mech Survival (`map: 'badlands'`, `contract: 'badlands'`) map orchestrator.
 *
 * Set in the golden-dawn desert of Surplus (Desert Raid), scaled to the engine's maximum crisp
 * voxel-AO arena (`352 m × 352 m`, `y ∈ [-8, +112]`) so the player has massive horizontal & vertical
 * room to fight, charge, hover, and fly in a Distraint Frame while combined-arms enemy convoys,
 * fast-rope helicopters, paratrooper jets, door gunners, tanks, and attack choppers pour in from all sides.
 */
import * as THREE from 'three';
import type { SpawnPoint } from '../../../core/contracts';
import type { StructuralClusterSpec, StructuralNodeSpec } from '../../destruction';
import { FACE, type Mat } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { cable, scrapHeap, truck, tyres } from '../../kit/props';
import { DESERT_PALETTE, sandstoneMesa, type Rgb } from '../desert/dunes';
import type { MapSpec } from '../spec';
import {
  BADLANDS_AIRCRAFT_PAD,
  BADLANDS_BOUNDS,
  BADLANDS_CONVOY_LANES,
  BADLANDS_FRAME_PAD,
  BADLANDS_HUB_PT,
  BADLANDS_LANDMARKS,
  BADLANDS_LEVELS,
  BADLANDS_LIGHT_BOUNDS,
  BADLANDS_LIGHT_CELL,
  BADLANDS_LOOKOUT_POSTS,
  BADLANDS_PICKUP_SPOTS,
  BADLANDS_PLAYER_SPAWN,
  BADLANDS_RING_WAYPOINTS,
  BADLANDS_SKY_SPAWNS,
  BADLANDS_TERMINAL,
  BADLANDS_VEHICLE_PAD,
} from './plan';

export { BADLANDS_BOUNDS, BADLANDS_LEVELS, BADLANDS_LIGHT_BOUNDS, BADLANDS_LIGHT_CELL };
export * from './plan';

export const BADLANDS_HUB = new THREE.Vector3(BADLANDS_HUB_PT[0], BADLANDS_HUB_PT[1], BADLANDS_HUB_PT[2]);

/** Prevents duplicate geometry if `authorBadlands` is called after `BADLANDS_STAGES`. */
const STAGES_BUILT = new WeakSet<MapSpec>();

const GROUND_THICK = 0.8;

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

function drawConvoyTrack(k: Kit, pts: readonly (readonly [number, number])[], width: number): void {
  const g = k.geo;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    k.along(a[0], 0.02, a[1], b[0], 0.02, b[1], len => {
      g.use('dirt').tint(DESERT_PALETTE.trackDirt[0], DESERT_PALETTE.trackDirt[1], DESERT_PALETTE.trackDirt[2]);
      g.box(len / 2, 0.005, 0, len / 2 + 1.6, 0.005, width / 2, FACE.py);
      g.tint(0.56, 0.42, 0.28);
      for (const s of [-1, 1]) {
        g.box(len / 2, 0.009, s * (width * 0.26), len / 2 + 1.2, 0.004, 0.55, FACE.py);
      }
      g.tint(1);
    });
  }
}

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

function desertScrubPole(k: Kit, x: number, z: number, h: number, yaw: number, withFlag = true): void {
  const g = k.geo;
  g.use('rust').tint(0.75).cyl(x, 0, z, x + Math.sin(yaw) * 0.14, h, z + Math.cos(yaw) * 0.14, 0.07, 0.045, 5, false, true);
  if (withFlag) {
    k.push(x + Math.sin(yaw) * 0.14, h - 0.1, z + Math.cos(yaw) * 0.14, yaw);
    const dye = DESERT_PALETTE.bannerDyes[Math.abs(Math.round(x + z)) % DESERT_PALETTE.bannerDyes.length]!;
    g.use('paintWhite').tint(dye[0] * 1.2, dye[1] * 1.2, dye[2] * 1.2);
    g.quad(0, 0, 0, 1.4, -0.08, 0.08, 1.3, -0.72, 0.12, 0, -0.82, 0);
    g.quad(1.4, -0.08, 0.08, 0, 0, 0, 0, -0.82, 0, 1.3, -0.72, 0.12);
    k.pop();
  }
  g.use('plywood').tint(0.62, 0.54, 0.36);
  for (let i = 0; i < 3; i++) {
    const a = yaw + i * 2.1;
    g.cyl(x, 0, z, x + Math.cos(a) * 0.7, 0.65, z + Math.sin(a) * 0.7, 0.05, 0.02, 4, false, true);
  }
  g.tint(1);
}

/** Builds a Tier-0 destructible Saltblood desert lookout post with timber stilts, deck, shelter walls, and fuel drum. */
function buildLookoutPostCluster(id: string, x: number, z: number, yaw: number): StructuralClusterSpec {
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
    { id: 'stilt_fl', pos: pt(-W, H / 2, D), half: [0.18, H / 2, 0.18], mat: 'plywood', color: 0x7c5b3b, hp: 90, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood' },
    { id: 'stilt_fr', pos: pt(W, H / 2, D), half: [0.18, H / 2, 0.18], mat: 'plywood', color: 0x7c5b3b, hp: 90, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood' },
    { id: 'stilt_bl', pos: pt(-W, H / 2, -D), half: [0.18, H / 2, 0.18], mat: 'plywood', color: 0x7d4c32, hp: 90, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood' },
    { id: 'stilt_br', pos: pt(W, H / 2, -D), half: [0.18, H / 2, 0.18], mat: 'plywood', color: 0x7d4c32, hp: 90, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood' },
    { id: 'deck', pos: pt(0, H + 0.14, 0), half: [W + 0.4, 0.14, D + 0.4], mat: 'plywood', color: 0x9b764c, hp: 105, tier: 0, anchored: false, kind: 'slab', yaw, impactRadius: 6.5, materialClass: 'wood' },
    { id: 'wall_back', pos: pt(0, H + 1.25, -D), half: [W + 0.2, 1.0, 0.12], mat: 'rust', color: 0x9b5a3c, hp: 110, tier: 0, anchored: false, kind: 'wall', yaw, materialClass: 'metal', fractureGrid: [2, 2] },
    { id: 'parapet_front', pos: pt(0, H + 0.72, D + 0.1), half: [W + 0.25, 0.48, 0.18], mat: 'dirt', color: 0x9c8864, hp: 95, tier: 0, anchored: false, kind: 'wall', yaw, materialClass: 'stone' },
    { id: 'roof', pos: pt(0, H + 2.38, 0), half: [W + 0.55, 0.1, D + 0.55], mat: 'panel', color: 0xb58d52, hp: 100, tier: 0, anchored: false, kind: 'roof', yaw, impactRadius: 6.5, materialClass: 'metal', fractureGrid: [2, 2] },
    { id: 'sandbags_base', pos: pt(0, 0.6, D + 0.9), half: [W + 0.6, 0.6, 0.38], mat: 'dirt', color: 0x9b8660, hp: 100, tier: 0, anchored: true, kind: 'wall', yaw, materialClass: 'stone' },
    { id: 'fuel_drum', pos: pt(W + 0.85, 0.55, D + 0.35), half: [0.42, 0.55, 0.42], mat: 'paintRed', color: 0xc82820, hp: 35, tier: 0, anchored: true, kind: 'hazard', yaw, hazardRadius: 8.5, hazardDamage: 220, materialClass: 'metal' },
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

/** Builds a compact Tier-0 destructible desert outbuilding / pump shed beside a hero landmark. */
function buildDesertShedCluster(
  id: string,
  label: string,
  x: number,
  z: number,
  yaw: number,
  color: number,
): StructuralClusterSpec {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const pt = (lx: number, ly: number, lz: number): [number, number, number] => [
    x + lx * c + lz * s,
    ly,
    z - lx * s + lz * c,
  ];
  const W = 2.6;
  const D = 2.0;
  const H = 3.1;

  const nodes: StructuralNodeSpec[] = [
    { id: 'col_fl', pos: pt(-W, H / 2, D), half: [0.18, H / 2, 0.18], mat: 'plywood', color: 0x7c5b3b, hp: 110, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood' },
    { id: 'col_fr', pos: pt(W, H / 2, D), half: [0.18, H / 2, 0.18], mat: 'plywood', color: 0x7c5b3b, hp: 110, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood' },
    { id: 'col_bl', pos: pt(-W, H / 2, -D), half: [0.18, H / 2, 0.18], mat: 'plywood', color: 0x7c5b3b, hp: 110, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood' },
    { id: 'col_br', pos: pt(W, H / 2, -D), half: [0.18, H / 2, 0.18], mat: 'plywood', color: 0x7c5b3b, hp: 110, tier: 0, anchored: true, kind: 'column', yaw, materialClass: 'wood' },
    { id: 'wall_back', pos: pt(0, H / 2, -D), half: [W, H / 2, 0.14], mat: 'rust', color, hp: 140, tier: 0, anchored: true, kind: 'wall', yaw, materialClass: 'metal', fractureGrid: [2, 2] },
    { id: 'wall_left', pos: pt(-W, H / 2, 0), half: [0.14, H / 2, D], mat: 'rust', color, hp: 140, tier: 0, anchored: true, kind: 'wall', yaw, materialClass: 'metal', fractureGrid: [2, 2] },
    { id: 'wall_right', pos: pt(W, H / 2, 0), half: [0.14, H / 2, D], mat: 'rust', color, hp: 140, tier: 0, anchored: true, kind: 'wall', yaw, materialClass: 'metal', fractureGrid: [2, 2] },
    { id: 'roof', pos: pt(0, H + 0.12, 0), half: [W + 0.45, 0.12, D + 0.45], mat: 'panel', color: 0xb58d52, hp: 115, tier: 0, anchored: false, kind: 'roof', yaw, impactRadius: 7, materialClass: 'metal', fractureGrid: [2, 2] },
    { id: 'fuel_drum', pos: pt(W + 0.9, 0.55, 0.8), half: [0.42, 0.55, 0.42], mat: 'paintRed', color: 0xc82820, hp: 35, tier: 0, anchored: true, kind: 'hazard', yaw, hazardRadius: 8.5, hazardDamage: 220, materialClass: 'metal' },
  ];

  const links: [string, string][] = [
    ['col_fl', 'roof'],
    ['col_fr', 'roof'],
    ['col_bl', 'roof'],
    ['col_br', 'roof'],
    ['wall_back', 'roof'],
    ['wall_left', 'roof'],
    ['wall_right', 'roof'],
  ];

  return {
    id,
    tag: id,
    kind: 'desertShed',
    label,
    value: 65_000,
    nodes,
    links,
    collapseThreshold: 0.45,
  };
}

function start(spec: MapSpec): void {
  spec.reactor = null;
  spec.killY = BADLANDS_BOUNDS.y0; // -8

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
      fill(BADLANDS_BOUNDS.x0, BADLANDS_BOUNDS.z0, BADLANDS_BOUNDS.x1, BADLANDS_BOUNDS.z1, [0.46, 0.36, 0.22], ''),
      fill(-64, -64, 64, 64, [0.40, 0.32, 0.21], ''),
      fill(-16, -16, 16, 16, [0.28, 0.29, 0.30], 'FRAME PAD'),
      fill(26, -112, 54, -80, [0.36, 0.28, 0.20], 'FUEL DEPOT'),
      fill(82, 26, 110, 54, [0.46, 0.29, 0.19], 'SANDSTONE ARCH'),
      fill(-54, 80, -26, 112, [0.33, 0.29, 0.23], 'WRECKED OASIS'),
      fill(-112, -54, -80, -26, [0.32, 0.29, 0.25], 'SALT DERRICK'),
    ],
    walls: [],
    blocks: [],
    decks: [],
    gates: [],
    doors: [],
  };

  spec.roads = [
    ...BADLANDS_CONVOY_LANES.map(lane => ({
      id: lane.id,
      points: [lane.spawn, ...lane.route] as readonly (readonly [number, number])[],
      width: 12,
    })),
    {
      id: 'inner_ring',
      points: [...BADLANDS_RING_WAYPOINTS, BADLANDS_RING_WAYPOINTS[0]!],
      width: 12,
    },
  ];
}

function authorBasinAndRoads(k: Kit, spec: MapSpec): void {
  const { x0, x1, y1, z0, z1 } = BADLANDS_BOUNDS;

  // Single continuous desert basin floor collider (top exact y = 0)
  groundPatch(k, 'dirt', DESERT_PALETTE.sandLight, x0, z0, x1, z1, 0, 16);
  k.collide(0, -GROUND_THICK / 2, 0, (x1 - x0) / 2, GROUND_THICK / 2, (z1 - z0) / 2, 'dirt');

  // Sun-bleached salt-flat alkali patches in the four outer quadrants
  groundPatch(k, 'paintWhite', DESERT_PALETTE.sandSalt, -168, -168, -68, -68, 0.012, 24);
  groundPatch(k, 'paintWhite', DESERT_PALETTE.sandSalt, 68, -168, 168, -68, 0.012, 24);
  groundPatch(k, 'paintWhite', DESERT_PALETTE.sandSalt, -168, 68, -68, 168, 0.012, 24);
  groundPatch(k, 'paintWhite', DESERT_PALETTE.sandSalt, 68, 68, 168, 168, 0.012, 24);

  // Compacted basin hardpan apron inside the inner ring road
  groundPatch(k, 'dirt', DESERT_PALETTE.townDust, -52, -52, 52, 52, 0.014, 14);

  // Flush concrete Distraint Frame staging pad ([-16..16] × [-16..16], open sky above)
  groundPatch(k, 'concrete', DESERT_PALETTE.concreteDust, -16, -16, 16, 16, 0.018, 8);
  const g = k.geo;
  // Painted hazard border stripes & Frame bay markings (visual flush at y = 0.024)
  g.use('paintYellow').tint(0.92, 0.72, 0.24);
  for (const s of [-15.3, 15.3]) {
    g.box(0, 0.024, s, 15.6, 0.004, 0.35, FACE.py);
    g.box(s, 0.024, 0, 0.35, 0.004, 15.6, FACE.py);
  }
  // Mech bay stencil around BADLANDS_FRAME_PAD (4.5, 0, 1.5)
  const fx = BADLANDS_FRAME_PAD[0];
  const fz = BADLANDS_FRAME_PAD[2];
  g.use('paintWhite').tint(0.92, 0.86, 0.72);
  for (const s of [-3.4, 3.4]) {
    g.box(fx, 0.025, fz + s, 3.6, 0.004, 0.22, FACE.py);
    g.box(fx + s, 0.025, fz, 0.22, 0.004, 3.6, FACE.py);
  }

  // Vehicle delivery bay stencil around BADLANDS_VEHICLE_PAD (-4.5, 0, -5.5)
  const vx = BADLANDS_VEHICLE_PAD[0];
  const vz = BADLANDS_VEHICLE_PAD[2];
  g.use('emissiveCyan').tint(0.24, 0.78, 0.92);
  for (const s of [-4.6, 4.6]) {
    g.box(vx, 0.025, vz + s, 4.0, 0.004, 0.18, FACE.py);
  }
  for (const s of [-3.9, 3.9]) {
    g.box(vx + s, 0.025, vz, 0.18, 0.004, 4.7, FACE.py);
  }
  // North-pointing chevron inside vehicle bay
  g.use('paintYellow').tint(0.92, 0.72, 0.24);
  g.box(vx, 0.026, vz - 3.6, 1.4, 0.004, 0.22, FACE.py);

  // Marked north desert airstrip threshold around BADLANDS_AIRCRAFT_PAD (0, 0, -28)
  const ax = BADLANDS_AIRCRAFT_PAD[0];
  const az = BADLANDS_AIRCRAFT_PAD[2];
  g.use('concreteDark').tint(0.62, 0.56, 0.48);
  g.box(ax, 0.018, az - 10, 7.6, 0.004, 18, FACE.py);
  g.use('paintWhite').tint(0.9, 0.88, 0.82);
  for (const tx of [-5.2, -3.2, 3.2, 5.2]) {
    g.box(ax + tx, 0.024, az + 5.8, 0.55, 0.004, 2.2, FACE.py);
  }
  for (let d = 0; d < 4; d++) {
    g.box(ax, 0.024, az - 1.5 - d * 6.8, 0.35, 0.004, 2.0, FACE.py);
  }

  // Interactive Motor Pool & Frame Requisition Terminal kiosk at BADLANDS_TERMINAL (-7.5, 0, 7.5)
  {
    const [tx, ty, tz] = BADLANDS_TERMINAL;
    const termYaw = Math.atan2(BADLANDS_PLAYER_SPAWN[0] - tx, BADLANDS_PLAYER_SPAWN[2] - tz);
    k.push(tx, ty, tz, termYaw);
    // Concrete beveled plinth & dark-steel console housing
    g.use('concreteDark').tint(0.74, 0.70, 0.64);
    g.bevel(0, 0.12, 0, 1.45, 0.12, 0.95, 0.05);
    g.use('steelDark').tint(0.38, 0.42, 0.48);
    g.bevel(0, 0.92, -0.1, 1.15, 0.72, 0.52, 0.06);
    // Operator desk ledge & overhead sun canopy on dual steel posts
    g.use('steel').tint(0.54, 0.58, 0.62);
    g.bevel(0, 0.96, 0.46, 1.02, 0.08, 0.24, 0.03);
    g.cyl(-1.24, 0.2, -0.58, -1.24, 2.72, -0.58, 0.1, 0.09, 6, false, true);
    g.cyl(1.24, 0.2, -0.58, 1.24, 2.72, -0.58, 0.1, 0.09, 6, false, true);
    g.bevel(0, 2.76, 0.12, 1.55, 0.11, 1.05, 0.04);
    // Glowing cyan screen, canopy beacon strip, amber header bar, and floor standing mat
    g.use('emissiveCyan').tint(0.25, 0.92, 1.0);
    g.box(0, 1.52, 0.44, 0.92, 0.42, 0.05);
    g.box(0, 2.76, 1.18, 1.38, 0.08, 0.06);
    g.box(0, 0.028, 1.55, 1.25, 0.008, 0.65, FACE.py);
    g.use('emissiveOrange').tint(1.0, 0.70, 0.18);
    g.box(0, 2.02, 0.44, 0.92, 0.045, 0.05);
    k.noClimb(() => k.collide(0, 1.0, -0.05, 1.25, 1.0, 0.68, 'metal'));
    k.pop();
    k.light(tx + 1.2, ty + 2.3, tz + 0.4, 0x38e8ff, 14, 12);
  }
  g.tint(1);

  // 4 low-profile perimeter staging-pad light pylons at corners (±15.6, ±15.6)
  for (const sx of [-15.6, 15.6]) {
    for (const sz of [-15.6, 15.6]) {
      g.use('concreteDark').bevel(sx, 0.4, sz, 0.65, 0.4, 0.65, 0.08);
      g.use('steelDark').cyl(sx, 0.8, sz, sx, 4.6, sz, 0.14, 0.1, 6, false, true);
      g.use('emissiveOrange').box(sx, 4.75, sz, 0.38, 0.18, 0.38);
      k.collide(sx, 2.4, sz, 0.45, 2.4, 0.45, 'metal', false);
      k.light(sx * 0.88, 5.4, sz * 0.88, DESERT_PALETTE.dawnAmber, 28, 22);
    }
  }
  g.tint(1);

  // 8 radial convoy roads & full octagonal inner ring road (all flush at y = 0.02)
  for (const lane of BADLANDS_CONVOY_LANES) {
    drawConvoyTrack(k, [lane.spawn, lane.route[0]!, lane.route[1]!], 11.5);
  }
  drawConvoyTrack(k, [...BADLANDS_RING_WAYPOINTS, BADLANDS_RING_WAYPOINTS[0]!], 11.0);

  // Endless golden dawn desert skirt past playable bounds to the horizon (visual only)
  const FAR = 960;
  groundPatch(k, 'dirt', DESERT_PALETTE.sandMid, -FAR, -FAR, FAR, z0, -0.04, 180);
  groundPatch(k, 'dirt', DESERT_PALETTE.sandMid, -FAR, z1, FAR, FAR, -0.04, 180);
  groundPatch(k, 'dirt', DESERT_PALETTE.sandMid, -FAR, z0, x0, z1, -0.04, 180);
  groundPatch(k, 'dirt', DESERT_PALETTE.sandMid, x1, z0, FAR, z1, -0.04, 180);

  // Invisible perimeter containment walls (CG.World excluding CG.Air so aircraft fly freely)
  const h = y1 / 2;
  const hx = (x1 - x0) / 2 + 1;
  const hz = (z1 - z0) / 2 + 1;
  k.containment(0, h, z0 - 0.5, hx, h, 0.5);
  k.containment(0, h, z1 + 0.5, hx, h, 0.5);
  k.containment(x0 - 0.5, h, 0, 0.5, h, hz);
  k.containment(x1 + 0.5, h, 0, 0.5, h, hz);

  // Broad warm golden dawn sunlight wash across the open central basin (4 baked lights)
  k.light(0, 26, 0, DESERT_PALETTE.dawnWarm, 86, 62);
  k.light(0, 24, -68, DESERT_PALETTE.dawnWarm, 72, 52);
  k.light(68, 24, 0, DESERT_PALETTE.dawnWarm, 72, 52);
  k.light(-68, 24, 68, DESERT_PALETTE.dawnWarm, 72, 52);

  // Prevent unused param warning while keeping consistent signature
  void spec;
}

function authorDunesAndMesas(k: Kit, spec: MapSpec): void {
  // 8 wedge bisectors (22.5° off all 8 convoy corridors) for outer rim dunes & sandstone mesas
  const wedgeAngles = [
    Math.PI * 0.125,  // ESE
    Math.PI * 0.375,  // SSE
    Math.PI * 0.625,  // SSW
    Math.PI * 0.875,  // WSW
    Math.PI * 1.125,  // WNW
    Math.PI * 1.375,  // NNW
    Math.PI * 1.625,  // NNE
    Math.PI * 1.875,  // ENE
  ];

  // Sweeping outer rim sand dunes (r = 144 m, tangent to basin rim, >= 32 m clear of every convoy lane)
  for (let i = 0; i < wedgeAngles.length; i++) {
    const a = wedgeAngles[i]!;
    const r = 144;
    const dx = Math.cos(a) * r;
    const dz = Math.sin(a) * r;
    const yaw = -a + Math.PI / 2;
    sandDune(k, spec, dx, dz, 44, 20, 7.2 + (i % 3) * 1.1, yaw, true);
  }

  // Monumental red-sandstone rim mesas nestled outside the dunes (r = 158 m, well clear of roads & containment)
  for (let i = 0; i < wedgeAngles.length; i++) {
    const a = wedgeAngles[i]!;
    const r = 158;
    const mx = Math.cos(a) * r;
    const mz = Math.sin(a) * r;
    const rx = 18 + (i % 2) * 4;
    const rz = 14 + ((i + 1) % 2) * 3;
    const h = 21 + (i % 3) * 5;
    sandstoneMesa(k, spec, mx, mz, rx, rz, h, -a + 0.15, true);
  }

  // Massive distant dawn horizon mesas (visual-only sky backdrop at r = 290..410 m for mech flight vistas)
  const horizonMesas: readonly [number, number, number, number, number, number][] = [
    [0, -340, 96, 46, 72, 0.05],
    [260, -255, 78, 50, 68, -0.4],
    [350, 20, 68, 86, 62, 0.15],
    [260, 275, 82, 48, 66, 0.35],
    [-15, 355, 94, 46, 58, -0.08],
    [-265, 265, 74, 52, 64, -0.35],
    [-355, -15, 64, 88, 70, 0.12],
    [-255, -265, 84, 50, 76, 0.32],
  ];
  for (const [mx, mz, rx, rz, h, yaw] of horizonMesas) {
    sandstoneMesa(k, spec, mx, mz, rx, rz, h, yaw, false);
  }

  // Scatter sandstone boulders & Saltblood flag poles flanking the convoy lanes (strictly >= 18 m off lane center)
  for (let i = 0; i < wedgeAngles.length; i++) {
    const a = wedgeAngles[i]!;
    const br = 76 + (i % 2) * 10;
    const bx = Math.cos(a) * br;
    const bz = Math.sin(a) * br;
    sandstoneMesa(k, spec, bx, bz, 3.2, 2.6, 2.8 + (i % 2) * 0.6, a, true);

    const fr = 68;
    const fx = Math.cos(a + 0.12) * fr;
    const fz = Math.sin(a + 0.12) * fr;
    desertScrubPole(k, fx, fz, 3.4, -a, true);
  }

  // Mid-basin dawn rim bounce lights (8 lights)
  for (let i = 0; i < wedgeAngles.length; i++) {
    const a = wedgeAngles[i]!;
    const lr = 112;
    k.light(Math.cos(a) * lr, 20, Math.sin(a) * lr, DESERT_PALETTE.dawnWarm, 56, 44);
  }
}

/** Landmark 1 (NNE): Fuel Depot — twin horizontal fuel tanks, y = 3.6 steel gantry with ramp, destructible pump shed. */
function buildFuelDepot(k: Kit, spec: MapSpec): void {
  const { x, z, yaw } = BADLANDS_LANDMARKS.fuelDepot;
  const g = k.geo;

  k.push(x, 0, z, yaw);
  // Concrete pad
  g.use('concrete').tint(DESERT_PALETTE.concreteDust[0], DESERT_PALETTE.concreteDust[1], DESERT_PALETTE.concreteDust[2]);
  g.box(0, 0.02, 0, 9.5, 0.02, 7.5, FACE.py);
  g.tint(1);

  // Two weathered horizontal fuel tanks on concrete saddles
  for (const tz of [-3.6, 0.4]) {
    g.use('concreteDark').bevel(-3.2, 0.55, tz, 0.45, 0.55, 1.3, 0.06);
    g.use('concreteDark').bevel(3.2, 0.55, tz, 0.45, 0.55, 1.3, 0.06);
    g.use('rust').tint(0.95, 0.84, 0.72).cyl(-5.0, 2.15, tz, 5.0, 2.15, tz, 1.35, 1.35, 10, true, true);
    g.use('paintRed').tint(0.9, 0.25, 0.18).cyl(-0.6, 2.15, tz, 0.6, 2.15, tz, 1.38, 1.38, 10, false, false);
    g.tint(1);
    k.collide(0, 1.85, tz, 5.1, 1.75, 1.4, 'metal');
  }

  // Elevated y = 3.6 steel inspection gantry deck + ramp (nav-reachable level 3.6)
  g.use('steelDark').bevel(0, 3.48, 4.2, 4.6, 0.12, 1.8, 0.04);
  k.collide(0, 3.48, 4.2, 4.6, 0.12, 1.8, 'metal');
  for (const px of [-4.2, 4.2]) {
    for (const pz of [2.6, 5.8]) {
      g.use('steelDark').cyl(px, 0, pz, px, 3.45, pz, 0.16, 0.16, 6, false, true);
    }
  }
  // Wide walkable ramp from ground (x = 12.2) up to deck (x = 4.6)
  k.ramp(12.2, 4.2, 0, 4.6, 4.2, 3.6, 2.8, 'steel', 0.35, false);

  // Supply clutter & scrap pile on pad edge (real explosive drum placed via spec.explosive below)
  tyres(k, -6.2, 0, 5.2, 3, false);
  scrapHeap(k, -7.2, -4.6, 1.8, 1.3, 0);
  k.pop();

  // Record minimap footprint & explosive drums
  spec.plan?.blocks.push({ x0: x - 8, z0: z - 7, x1: x + 8, z1: z + 7 });
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const wpt = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  const [ex1, ez1] = wpt(-7.2, 4.6);
  spec.barrels(ex1, 0, ez1, 2);

  // Destructible Tier-0 pump shed tucked north of tanks
  const [sx, sz] = wpt(0, -8.8);
  spec.cluster(buildDesertShedCluster('badlands.fuelDepot.shed', 'FUEL PUMP SHED', sx, sz, yaw, 0x9b5a3c));

  k.light(x, 6.2, z, DESERT_PALETTE.dawnAmber, 38, 28);
}

/** Landmark 2 (ESE): Monumental Sandstone Arch — 14 m wide × 10.5 m tall natural stone span (huge mech clearance!). */
function buildSandstoneArch(k: Kit, spec: MapSpec): void {
  const { x, z, yaw } = BADLANDS_LANDMARKS.sandstoneArch;
  const g = k.geo;

  k.push(x, 0, z, yaw);
  // Twin sandstone cliff piers at x = ±8.5 (leaving 11 m clear center span for mech stomping & charging!)
  for (const sx of [-8.8, 8.8]) {
    g.use('concrete').tint(DESERT_PALETTE.mesaDark[0], DESERT_PALETTE.mesaDark[1], DESERT_PALETTE.mesaDark[2]);
    g.bevel(sx, 3.2, 0, 3.4, 3.2, 4.2, 0.55);
    g.use('concrete').tint(DESERT_PALETTE.mesaLight[0], DESERT_PALETTE.mesaLight[1], DESERT_PALETTE.mesaLight[2]);
    g.bevel(sx * 0.94, 8.4, 0, 2.9, 2.8, 3.6, 0.45);
    k.noClimb(() => k.collide(sx, 5.6, 0, 3.1, 5.6, 3.8, 'concrete'));
  }
  // Overhead sandstone bridge lintel (bottom at y = 10.6 m, top at y = 15.2 m — tall enough to stride right under!)
  g.use('concrete').tint(DESERT_PALETTE.mesaLight[0], DESERT_PALETTE.mesaLight[1], DESERT_PALETTE.mesaLight[2]);
  g.bevel(0, 12.6, 0, 11.4, 2.0, 3.2, 0.65);
  g.use('concreteDark').tint(DESERT_PALETTE.mesaDark[0] * 1.1, DESERT_PALETTE.mesaDark[1] * 1.1, DESERT_PALETTE.mesaDark[2]);
  g.bevel(0, 14.9, 0, 9.6, 0.9, 2.6, 0.4);
  g.tint(1);
  k.noClimb(() => k.collide(0, 12.9, 0, 10.8, 2.3, 3.0, 'concrete'));

  // Low boulder & tyre cover near piers
  tyres(k, -4.6, 0, 4.8, 3, false);
  tyres(k, 4.6, 0, -4.8, 3, false);
  k.pop();

  spec.plan?.blocks.push({ x0: x - 11, z0: z - 5, x1: x + 11, z1: z + 5 });

  // Destructible Saltblood watch shed nestled beside the arch
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  spec.cluster(
    buildDesertShedCluster(
      'badlands.arch.shed',
      'ARCH OVERWATCH SHED',
      x + 0 * c + 9.2 * s,
      z - 0 * s + 9.2 * c,
      yaw,
      0xc97b4b,
    ),
  );

  k.light(x, 8.5, z, DESERT_PALETTE.dawnAmber, 40, 30);
}

/** Landmark 3 (SSW): Wrecked Convoy Oasis — dry concrete cistern ring, burnt-out trucks, destructible ammo bunker. */
function buildWreckedOasis(k: Kit, spec: MapSpec): void {
  const { x, z, yaw } = BADLANDS_LANDMARKS.wreckedOasis;
  const g = k.geo;

  k.push(x, 0, z, yaw);
  // Dry concrete cistern basin low rim (segmented octagon low parapet, open walk-in gaps)
  g.use('concrete').tint(DESERT_PALETTE.concreteDust[0], DESERT_PALETTE.concreteDust[1], DESERT_PALETTE.concreteDust[2]);
  g.box(0, 0.02, 0, 6.2, 0.02, 6.2, FACE.py);
  for (const [cx, cz, hx, hz] of [
    [0, -6.0, 4.2, 0.45],
    [0, 6.0, 4.2, 0.45],
    [-6.0, 0, 0.45, 4.2],
    [6.0, 0, 0.45, 4.2],
  ] as const) {
    g.bevel(cx, 0.72, cz, hx, 0.72, hz, 0.08);
    k.collide(cx, 0.72, cz, hx, 0.72, hz, 'concrete');
  }
  g.tint(1);

  // Two burnt-out desert convoy hulks angled around the dry cistern
  truck(k, -10.5, 0, -4.0, 0.45, 0.06);
  truck(k, 10.2, 0, 3.8, -2.35, -0.05);
  tyres(k, 0, 0, -1.5, 4, false);
  scrapHeap(k, 2.4, 2.0, 1.5, 1.1, 0);
  k.pop();

  spec.plan?.blocks.push({ x0: x - 10, z0: z - 8, x1: x + 10, z1: z + 8 });

  // Destructible Tier-0 ammo bunker shed north of the oasis
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  spec.cluster(
    buildDesertShedCluster(
      'badlands.oasis.bunker',
      'OASIS AMMO BUNKER',
      x + 0 * c - 10.5 * s,
      z - 0 * s - 10.5 * c,
      yaw,
      0x8e6b46,
    ),
  );

  k.light(x, 6.0, z, DESERT_PALETTE.dawnAmber, 38, 28);
}

/** Landmark 4 (WNW): Salt Pump Derrick — 17 m steel tower landmark, y = 3.6 work deck + ramp, destructible generator shed. */
function buildSaltDerrick(k: Kit, spec: MapSpec): void {
  const { x, z, yaw } = BADLANDS_LANDMARKS.saltDerrick;
  const g = k.geo;

  k.push(x, 0, z, yaw);
  // Base concrete plinth
  g.use('concrete').tint(DESERT_PALETTE.concreteDust[0], DESERT_PALETTE.concreteDust[1], DESERT_PALETTE.concreteDust[2]);
  g.box(0, 0.02, 0, 8.5, 0.02, 8.5, FACE.py);
  g.tint(1);

  // Elevated y = 3.6 steel pump deck + ramp (nav-reachable level 3.6)
  g.use('steelDark').bevel(0, 3.48, 0, 4.4, 0.12, 4.4, 0.04);
  k.collide(0, 3.48, 0, 4.4, 0.12, 4.4, 'metal');
  k.ramp(12.0, 0, 0, 4.4, 0, 3.6, 2.8, 'steel', 0.35, false);

  // 17 m tapered 4-leg steel derrick mast rising from the deck corners (dramatic vertical skyline marker for mech flight!)
  g.use('rust').tint(0.85, 0.62, 0.44);
  const bot = 3.8;
  const top = 1.05;
  const H = 17.5;
  const corners: readonly [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [cx, cz] of corners) {
    g.cyl(cx * bot, 0, cz * bot, cx * top, H, cz * top, 0.22, 0.14, 6, false, true);
  }
  // Cross braces at y = 7.5, 12.0, 16.8
  for (const by of [7.5, 12.0, 16.8]) {
    const t = by / H;
    const r = bot + (top - bot) * t;
    for (let i = 0; i < 4; i++) {
      const a = corners[i]!;
      const b = corners[(i + 1) % 4]!;
      g.cyl(a[0] * r, by, a[1] * r, b[0] * r, by, b[1] * r, 0.1, 0.1, 5, false, true);
    }
  }
  // Crown beacon lamp at top of derrick
  g.use('emissiveOrange').box(0, H + 0.45, 0, 0.55, 0.45, 0.55);
  g.tint(1);
  // Central pump shaft collider
  k.noClimb(() => k.collide(0, 8.8, 0, 1.2, 8.8, 1.2, 'metal'));

  // Overhead guy cables anchored to outer bollards
  for (const [cx, cz] of [[-10, -10], [10, -10], [-10, 10]] as const) {
    cable(k, cx, 0.4, cz, Math.sign(cx) * 1.6, 13.5, Math.sign(cz) * 1.6, 0.6, 0.04);
  }
  tyres(k, -5.8, 0, 4.2, 3, false);
  k.pop();

  spec.plan?.blocks.push({ x0: x - 6, z0: z - 6, x1: x + 6, z1: z + 6 });

  // Destructible generator shed tucked beside the derrick
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const [gx, gz] = [x + (-9.4) * c + 0 * s, z - (-9.4) * s + 0 * c];
  spec.cluster(buildDesertShedCluster('badlands.derrick.shed', 'PUMP GENERATOR SHED', gx, gz, yaw + Math.PI / 2, 0x6e8c82));

  k.light(x, 7.5, z, DESERT_PALETTE.dawnAmber, 40, 30);
}

function authorLandmarksAndPosts(k: Kit, spec: MapSpec): void {
  buildFuelDepot(k, spec);
  buildSandstoneArch(k, spec);
  buildWreckedOasis(k, spec);
  buildSaltDerrick(k, spec);

  // 4 Tier-0 Destructible Saltblood Lookout Posts in the alternating wedges (4 baked lights)
  for (const post of BADLANDS_LOOKOUT_POSTS) {
    spec.cluster(buildLookoutPostCluster(post.id, post.x, post.z, post.yaw));
    spec.plan?.blocks.push({
      x0: post.x - 2.6,
      z0: post.z - 2.6,
      x1: post.x + 2.6,
      z1: post.z + 2.6,
    });
    k.light(post.x, 4.4, post.z, DESERT_PALETTE.dawnAmber, 30, 20);
    tyres(k, post.x - Math.sign(post.x) * 3.4, 0, post.z + 1.8, 3, false);
    desertScrubPole(k, post.x + Math.sign(post.x) * 3.2, post.z - 2.0, 3.6, post.yaw, true);
  }
}

export const BADLANDS_STAGES = [
  {
    label: 'Sculpting the Badlands basin & convoy roads',
    run: (k: Kit, spec: MapSpec) => {
      start(spec);
      authorBasinAndRoads(k, spec);
      STAGES_BUILT.add(spec);
    },
  },
  {
    label: 'Raising the outer dunes & sandstone mesas',
    run: authorDunesAndMesas,
  },
  {
    label: 'Building the desert landmarks & lookout posts',
    run: authorLandmarksAndPosts,
  },
] as const;

function zones(spec: MapSpec): void {
  const sky = BADLANDS_BOUNDS.y1;
  spec.zone('badlands-pad', 'FRAME STAGING PAD', -18, -1, -18, 18, 30, 18);
  spec.zone('badlands-fuel', 'FUEL DEPOT', 22, -1, -114, 58, 36, -78);
  spec.zone('badlands-arch', 'SANDSTONE ARCH', 78, -1, 22, 114, 36, 58);
  spec.zone('badlands-oasis', 'WRECKED OASIS', -58, -1, 78, -22, 36, 114);
  spec.zone('badlands-derrick', 'SALT PUMP DERRICK', -114, -1, -58, -78, 36, -22);
  spec.zone('badlands-basin', 'CENTRAL SALT BASIN', -68, -1, -68, 68, sky, 68);
  spec.zone(
    'badlands-outer',
    'THE BADLANDS',
    BADLANDS_BOUNDS.x0,
    BADLANDS_BOUNDS.y0,
    BADLANDS_BOUNDS.z0,
    BADLANDS_BOUNDS.x1,
    sky,
    BADLANDS_BOUNDS.z1,
  );
}

function spawns(spec: MapSpec): void {
  const groundSpawns: SpawnPoint[] = [
    // Inner ring road & basin perimeter
    ...BADLANDS_RING_WAYPOINTS.map(([x, z]): SpawnPoint => ({
      position: new THREE.Vector3(x, 0.1, z),
      zone: 'badlands-basin',
      kind: 'ground',
    })),
    // Outer radial avenue entry points
    ...BADLANDS_CONVOY_LANES.map((lane): SpawnPoint => ({
      position: new THREE.Vector3(lane.route[0]![0], 0.1, lane.route[0]![1]),
      zone: 'badlands-outer',
      kind: 'ground',
    })),
  ];

  const airSpawns: SpawnPoint[] = BADLANDS_SKY_SPAWNS.map(([x, y, z]) => ({
    position: new THREE.Vector3(x, y, z),
    zone: 'badlands-outer',
    kind: 'air',
  }));

  spec.spawns = [...groundSpawns, ...airSpawns];
  for (const s of groundSpawns) spec.gate(s.zone, s.position.x, s.position.y, s.position.z);
  for (const [x, y, z] of BADLANDS_PICKUP_SPOTS) spec.pickup(x, y, z);

  spec.playerSpawns.push(
    { position: new THREE.Vector3(BADLANDS_PLAYER_SPAWN[0], BADLANDS_PLAYER_SPAWN[1] + 0.1, BADLANDS_PLAYER_SPAWN[2]), yaw: 0 },
    { position: new THREE.Vector3(0, 0.1, -12), yaw: Math.PI },
    { position: new THREE.Vector3(-12, 0.1, 0), yaw: -Math.PI / 2 },
    { position: new THREE.Vector3(12, 0.1, 0), yaw: Math.PI / 2 },
  );
}

function views(spec: MapSpec): void {
  const eye = 1.62;
  spec.view('overview', 128, 84, 146, 0, 4, 0);
  spec.view('pad', 0, eye, 12, 4, 3.2, -6);
  spec.view('basin', -48, 22, 62, 0, 4, -12);
  spec.view('fuelDepot', 18, 10, -76, 40, 3.5, -96);
  spec.view('arch', 74, 11, 22, 96, 6, 40);
  spec.view('oasis', -18, 10, 74, -40, 2.5, 96);
  spec.view('derrick', -70, 14, -20, -96, 8, -40);
  spec.view('sky', 88, 56, 98, 0, 6, 0);
}

/**
 * Finalizes Badlands zones, spawns, pickups, and views.
 * Safely executes `BADLANDS_STAGES` when called standalone without running stages first.
 */
export function authorBadlands(k: Kit, spec: MapSpec): void {
  if (!STAGES_BUILT.has(spec)) {
    for (const stage of BADLANDS_STAGES) {
      stage.run(k, spec);
    }
  }
  zones(spec);
  spawns(spec);
  views(spec);
}
