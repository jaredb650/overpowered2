/**
 * The town: its south wall with the main gate and the two wall guns, the firing steps behind it, the west wall and its gate; outside,
 * the outer shanties (shacks, barracks, watchtowers, munitions sheds, pillboxes, the trench, the fuel farm, two roof guns, the sniper's
 * shack); inside, the Market's destructible concrete terraces, Port Office tower, Market Halls, lanes, Square, and lived-in port dressing.
 */
import { BATTLES, PLACES, ROUTES } from '../../../campaign/missions/foreclosure.places';
import {
  buildBarracksCluster,
  buildCatwalkCluster,
  buildEmplacementPlatformCluster,
  buildFiringStepCluster,
  buildFountainCluster,
  buildGateTowerCluster,
  buildMarketHallCluster,
  buildMunitionsShedCluster,
  buildPillboxCluster,
  buildShantyHouseCluster,
  buildTerraceCluster,
  buildTowerCluster,
  buildWallGunPadCluster,
  buildWatchtowerCluster,
} from '../../destruction';
import { FACE } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { barrier, signPanel, tank, tyres } from '../../kit/props';
import { signId } from '../../kit/signs';
import { Site } from '../outpost/site';
import type { MapSpec } from '../spec';
import {
  banner, brazier, bulbs, bunting, cableSpool, drumCluster, dryingRack, flag, handcart, loudspeaker,
  marketCanopy, palletStack, rustedSkiff, rustedWreck, scrapLeanTo, utilityPole, waterTankStilt, wireSpan,
} from './props';
import {
  BARRACKS, BLOCKS, BREACH, DYES, FRAME, FUEL, FUEL_TANKS, HOLDFAST_SPAWNS, LEVEL, LZ, MAIN_GATE, PAD, PAINTS, ROADS, ROOF_GUNS,
  SQUARE, STALLS, STEP, STEPS, TERRACE, TRENCH, TRENCH_W, WALL_GUNS, WALL_X0, WALL_X1, WALL_Z, WEST_GATE, WEST_X,
} from './plan';

const HARBOUR_FACE = -105;
/** Market blocks replaced by physics-destructible Market Halls & Garrison Barracks clusters. */
const CLUSTER_BLOCKS = new Set(['w2', 'e3', 'e7']);

/** Outer-shanty AC-130 destructible set pieces (watchtowers, munitions sheds, pillboxes) kept clear by scattered shacks/props. */
const OUTER_SET_PIECES: readonly {
  readonly tag: string;
  readonly kind: 'watchtower' | 'munitions' | 'pillbox';
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly label: string;
  readonly barrels?: readonly [number, number];
}[] = [
  { tag: 'watchtower.west', kind: 'watchtower', x: 37, z: 78, yaw: 0, label: 'WEST SHANTY WATCHTOWER' },
  { tag: 'watchtower.east', kind: 'watchtower', x: 94, z: 78, yaw: 0, label: 'EAST SHANTY WATCHTOWER' },
  { tag: 'watchtower.southeast', kind: 'watchtower', x: 132, z: 80, yaw: -Math.PI / 4, label: 'FLATS FLANK WATCHTOWER' },
  { tag: 'munitions.west', kind: 'munitions', x: 23, z: 86, yaw: Math.PI / 2, label: 'WEST MUNITIONS SHED', barrels: [26.8, 86] },
  { tag: 'munitions.mid', kind: 'munitions', x: 82, z: 96, yaw: 0, label: 'FLATS FUEL SHED', barrels: [85.8, 95] },
  { tag: 'munitions.east', kind: 'munitions', x: 106, z: 86, yaw: Math.PI, label: 'EAST MUNITIONS SHED', barrels: [102.2, 86] },
  { tag: 'munitions.fuelPump', kind: 'munitions', x: 155, z: 96, yaw: -Math.PI / 2, label: 'FUEL FARM PUMP SHED', barrels: [151.4, 96] },
  { tag: 'pillbox.south', kind: 'pillbox', x: 56, z: 102, yaw: -Math.PI * 0.75, label: 'SOUTH FLATS PILLBOX' },
  { tag: 'pillbox.east', kind: 'pillbox', x: 132, z: 104, yaw: Math.PI, label: 'EAST FLATS PILLBOX' },
];

/** Distance from (x, z) to the segment a-b. */
function toSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

/**
 * Whether a thing of radius `r` at (x, z) keeps off every road, every Frame route and every mark. Scattered dressing asks this, so the
 * proof's sweeps and the marks' floors never meet a shack nobody meant to put there.
 */
export function clearOf(x: number, z: number, r: number): boolean {
  for (const road of ROADS) {
    for (let i = 0; i + 1 < road.points.length; i++) {
      const [ax, az] = road.points[i]!, [bx, bz] = road.points[i + 1]!;
      if (toSegment(x, z, ax, az, bx, bz) < road.width / 2 + r + 0.6) return false;
    }
  }
  for (const route of Object.values(ROUTES)) {
    for (let i = 0; i + 1 < route.length; i++) {
      const a = PLACES[route[i]!]!.at, b = PLACES[route[i + 1]!]!.at;
      if (toSegment(x, z, a[0], a[2], b[0], b[2]) < FRAME.width / 2 + r + 0.8) return false;
    }
  }
  for (const m of Object.values(PLACES)) if (m.at[1] < 1 && Math.hypot(m.at[0] - x, m.at[2] - z) < r + 2.2) return false;
  for (const p of HOLDFAST_SPAWNS.foot) if (Math.hypot(p[0] - x, p[2] - z) < r + 2.2) return false;
  // Nothing in a battle's firing line.
  for (const b of Object.values(BATTLES)) {
    const p = PLACES[b.at]!.at, q = PLACES[b.from]!.at;
    if (toSegment(x, z, p[0], p[2], q[0], q[2]) < r + 2.4) return false;
  }
  return true;
}

/** Additional outer-shanty exclusion test so scattered shacks/props stay clear of LZ, barracks, set pieces, trench, and fuel farm. */
function clearOfShantyFeatures(x: number, z: number, r: number): boolean {
  if (!clearOf(x, z, r)) return false;
  if (Math.hypot(x - LZ.x, z - LZ.z) < LZ.radius + r + 1.5) return false;
  if (Math.hypot(x - FUEL.x, z - FUEL.z) < 15 + r) return false;
  if (BARRACKS.some(b => Math.hypot(x - b.x, z - b.z) < 7.5 + r || Math.hypot(x - b.spawn[0], z - b.spawn[2]) < 3.2 + r)) return false;
  if (OUTER_SET_PIECES.some(p => Math.hypot(x - p.x, z - p.z) < 4.5 + r)) return false;
  if (TRENCH.some(([tx, tz]) => Math.abs(x - tx) < 4.5 + r && Math.abs(z - tz) < 4.5 + r)) return false;
  if (ROOF_GUNS.some(g => Math.abs(x - g.x) < 5.5 + r && Math.abs(z - g.z) < 5 + r)) return false;
  if (Math.abs(x - 88) < 5 + r && Math.abs(z - 67) < 5 + r) return false;
  return true;
}

const pick = <T>(k: Kit, list: readonly T[]): T => list[Math.floor(k.rng() * list.length)]!;

// -------------------------------------------------------------------------------------------------
// The walls
// -------------------------------------------------------------------------------------------------

function walls(k: Kit, site: Site): void {
  const spec = site.spec, g = k.geo;
  // South: the dyke to the gate, the gate, the gate to the sea. The gate does not open: it is blown, or the charge goes in beside it.
  spec.wall(WALL_X0, WALL_Z, MAIN_GATE.x - MAIN_GATE.half, WALL_Z);
  spec.wallGate(MAIN_GATE.x - MAIN_GATE.half, WALL_Z, MAIN_GATE.x + MAIN_GATE.half, WALL_Z);
  spec.wall(MAIN_GATE.x + MAIN_GATE.half, WALL_Z, WALL_X1, WALL_Z);
  // West: reinforced concrete curtain wall & blast gate (Tier 3 — 105mm Howitzer or Nuke ONLY).
  spec.wall(WEST_X, WALL_Z, WEST_X, WEST_GATE.z + WEST_GATE.half, 0, { tier: 3, label: 'REINFORCED WEST WALL' });
  spec.wallGate(WEST_X, WEST_GATE.z + WEST_GATE.half, WEST_X, WEST_GATE.z - WEST_GATE.half, 0, false, { tier: 3, label: 'REINFORCED WEST GATE' });
  spec.wall(WEST_X, WEST_GATE.z - WEST_GATE.half, WEST_X, HARBOUR_FACE, 0, { tier: 3, label: 'REINFORCED WEST WALL' });
  // Thin Tier-1 masonry courtyard flank walls: Satchel Charges blow flanking shortcuts through the Market & Shanties.
  spec.wall(10.2, 25, 13.8, 25, 0, { tier: 1, label: 'COURTYARD FLANK WALL' });
  spec.wall(98.2, 24.5, 101.8, 24.5, 0, { tier: 1, label: 'MARKET COURTYARD WALL' });
  spec.wall(50, 76, 58, 76, 0, { tier: 1, label: 'SHANTY COMPOUND WALL' });
  site.plan.walls.push({ ax: WALL_X0, az: WALL_Z, bx: WALL_X1, bz: WALL_Z, half: 0.4 }, { ax: WEST_X, az: WALL_Z, bx: WEST_X, bz: HARBOUR_FACE, half: 0.4 });
  site.plan.gates.push({ x: MAIN_GATE.x, z: WALL_Z, yaw: 0, w: MAIN_GATE.half * 2, bay: true }, { x: WEST_X, z: WEST_GATE.z, yaw: Math.PI / 2, w: WEST_GATE.half * 2, bay: true });

  // Destructible Tier-2 painted concrete gate towers behind the main gate (105mm Howitzer / 40mm / Frame collapses them!).
  for (const s of [-1, 1]) {
    const x = MAIN_GATE.x + s * (MAIN_GATE.half + 2.1);
    const c = s < 0 ? PAINTS[0]! : PAINTS[1]!;
    spec.cluster(buildGateTowerCluster([x, 0, WALL_Z - 2.425], {
      tag: s < 0 ? 'gateTower.west' : 'gateTower.east',
      w: 3.0,
      d: 3.95,
      h: 7.0,
      color: c,
      tier: 2,
      label: s < 0 ? 'WEST GATE TOWER' : 'EAST GATE TOWER',
    }));
    site.plan.blocks.push({ x0: x - 1.5, z0: WALL_Z - 4.4, x1: x + 1.5, z1: WALL_Z - 0.45 });
    k.light(x, 5, WALL_Z + 3, 'white', 40, 16);
  }
  k.beam(MAIN_GATE.x - 4.5, 6.6, WALL_Z - 0.3, MAIN_GATE.x + 4.5, 6.6, WALL_Z - 0.3, 0.12, 0.25, 'rust');
  signPanel(k, MAIN_GATE.x, 5.6, WALL_Z + 0.1, 0, 5, 1.2, signId('HOLDFAST'));
  // The segment marked for the charge: hazard paint on the salt either side, a stake with a rag.
  g.use('hazard');
  g.box(BREACH.x, 0.02, BREACH.z + 1.6, 2, 0.01, 0.35, FACE.py);
  g.box(BREACH.x, 0.02, BREACH.z - 1.6, 2, 0.01, 0.35, FACE.py);
  flag(k, BREACH.x + 2.4, 0, BREACH.z + 1.2, 1.8, 0.3, [0.95, 0.84, 0.3]);

  // Destructible Tier-1 wall gun pads + sandbag cheeks + rear stairs: exact LEVEL.pad deck height for emplacements & nav.
  for (const gun of WALL_GUNS) {
    const { x } = gun;
    spec.cluster(buildWallGunPadCluster(x, {
      tag: x < MAIN_GATE.x ? 'wallGunPad.west' : 'wallGunPad.east',
      halfX: PAD.half,
      z0: PAD.z0,
      z1: PAD.z1,
      height: LEVEL.pad,
      stair: { ax: x - 0.8, y0: 0, az: PAD.z0 - 3.4, bx: x - 0.8, y1: LEVEL.pad, bz: PAD.z0, width: 1.4 },
      navPhysics: k.physics,
      tier: 1,
      label: x < MAIN_GATE.x ? 'WEST WALL GUN PAD' : 'EAST WALL GUN PAD',
    }));
    site.plan.decks.push({ x0: x - PAD.half, z0: PAD.z0, x1: x + PAD.half, z1: PAD.z1 });
    spec.emplacement(x, LEVEL.pad, gun.z, Math.PI, 1.1, 1);
    k.light(x, 4.4, WALL_Z - 3, 'orange', 22, 12);
  }

  // Destructible Tier-1 firing steps + rear stairs behind the south wall at LEVEL.step.
  for (let i = 0; i < STEPS.length; i++) {
    const [x0, x1] = STEPS[i]!;
    const z0 = WALL_Z - 0.25 - STEP.to, z1 = WALL_Z - 0.25 - STEP.from;
    spec.cluster(buildFiringStepCluster({
      tag: `firingStep.${i}`,
      x0,
      x1,
      z0,
      z1,
      height: LEVEL.step,
      stair: { ax: x0 + 1.2, y0: 0, az: z0 - 2.8, bx: x0 + 1.2, y1: LEVEL.step, bz: z0, width: 1.3 },
      navPhysics: k.physics,
      tier: 1,
      label: 'WALL FIRING STEP',
    }));
    site.plan.decks.push({ x0, z0, x1, z1 });
    for (let x = x0 + 6; x < x1 - 2; x += 14) banner(k, x, 2.95, WALL_Z - 0.26, Math.PI, 1.6, 2.4, pick(k, DYES));
  }
  // Floods on the wall, looking out over the shanties.
  for (const x of [10, 30, 110, 130, 150]) k.light(x, 4.5, WALL_Z + 2, 'white', 34, 18);
}

// -------------------------------------------------------------------------------------------------
// Outside: the outer shanties
// -------------------------------------------------------------------------------------------------

function trench(k: Kit, site: Site): void {
  const g = k.geo, bank = 1.2, h = 1.3;
  for (let i = 0; i + 1 < TRENCH.length; i++) {
    const [ax, az] = TRENCH[i]!, [bx, bz] = TRENCH[i + 1]!;
    k.along(ax, 0, az, bx, 0, bz, len => {
      for (const s of [-1, 1]) {
        const off = s * (TRENCH_W / 2 + bank / 2);
        g.use('dirt').tint(0.5, 0.46, 0.38);
        // Short of the corners: the inside bank of one zig would shut the walk off at the next, and a gap is a way out.
        const half = len / 2 - 1.6;
        g.bevel(len / 2, h / 2, off, half, h / 2, bank / 2, 0.25);
        g.use('paintWhite').tint(0.42, 0.38, 0.28).box(len / 2, h + 0.08, off, half - 0.2, 0.08, bank / 2 - 0.15, FACE.noBottom);
        k.collide(len / 2, h / 2, off, half, h / 2, bank / 2, 'dirt');
      }
      g.tint(1);
    });
  }
  site.plan.blocks.push({ x0: TRENCH[0]![0] - 2, z0: 62, x1: TRENCH[TRENCH.length - 1]![0] + 2, z1: 71 });
}

function fuelFarm(k: Kit, site: Site): void {
  const { berm } = FUEL;
  // A sandbag berm, open toward the gate.
  site.sandbags(berm.x0, berm.z1 - 0.8, berm.x1, berm.z1, 1.2);
  site.sandbags(berm.x1 - 0.8, berm.z0, berm.x1, berm.z1 - 0.8, 1.2);
  site.sandbags(berm.x0, berm.z0, berm.x0 + 0.8, berm.z0 + 8, 1.2);
  for (const [x, z] of FUEL_TANKS) {
    tank(k, x, z, 0, FUEL.r, FUEL.h, 'panel', { ladder: true, bands: 2, seg: 20 });
    k.collide(x, FUEL.h / 2, z, FUEL.r * 0.9, FUEL.h / 2, FUEL.r * 0.9, 'metal');
    site.spec.tank(x, FUEL.h + 0.5, z);
    site.plan.blocks.push({ x0: x - FUEL.r, z0: z - FUEL.r, x1: x + FUEL.r, z1: z + FUEL.r });
  }
  site.spec.barrels(147, 0, 68.5, 4);
  signPanel(k, berm.x0 + 4, 2.4, berm.z1 + 0.2, 0, 3.2, 0.8, signId('TANK FARM'));
  k.light(FUEL.x, 7, FUEL.z, 'orange', 30, 16);
}

/** Destructible painted shacks and shanty houses on the salt south of the wall, kept off the tracks, the LZ and the marks. */
function shanties(k: Kit, site: Site): void {
  const spec = site.spec;
  // Two destructible Tier-1 shanty houses with a roof gun & sandbag breastwork + side stairs (walkable at LEVEL.roof).
  for (const gun of ROOF_GUNS) {
    spec.cluster(buildShantyHouseCluster([gun.x, 0, gun.z], {
      tag: gun.x < MAIN_GATE.x ? 'roofGunHouse.west' : 'roofGunHouse.east',
      w: 7,
      d: 5.5,
      h: LEVEL.roof,
      yaw: 0,
      color: pick(k, PAINTS),
      sandbagFront: true,
      stair: { ax: gun.x + 4.25, y0: 0, az: gun.z + 4.15, bx: gun.x + 4.25, y1: LEVEL.roof, bz: gun.z - 0.85, width: 1.4 },
      navPhysics: k.physics,
      tier: 1,
      label: gun.x < MAIN_GATE.x ? 'WEST ROOF-GUN HOUSE' : 'EAST ROOF-GUN HOUSE',
    }));
    site.plan.blocks.push({ x0: gun.x - 3.5, z0: gun.z - 2.75, x1: gun.x + 3.5, z1: gun.z + 2.75 });
    spec.emplacement(gun.x, LEVEL.roof, gun.z + 1.2, gun.yaw, 1.2, 1);
  }
  // The sniper's shack: one rocket flattens it.
  const sn = PLACES.sniperShack!.at;
  spec.shack(sn[0], sn[2] + 2.6, 0, 'sheet', 0, PAINTS[6]);
  // Shacks & destructible shanty houses scattered on a jittered grid between the wall and the Flats.
  let n = 0;
  for (let z = 56; z < 84; z += 6.5) {
    for (let x = -4; x < 160; x += 7.5) {
      const px = x + k.rand(-1.8, 1.8), pz = z + k.rand(-1.5, 1.5);
      if (k.rng() < 0.36 || !clearOfShantyFeatures(px, pz, 2.5)) continue;
      // The approach to the gate stays open ground: a killing field for the wall guns, and the 14th's way in.
      if (Math.abs(px - 70) < 11 && pz < 78) continue;
      if (Math.abs(px - sn[0]) < 5 && Math.abs(pz - sn[2] - 2.6) < 4) continue;
      if (px > 47 && px < 61 && Math.abs(pz - 76) < 4) continue;
      const yaw = k.rng() < 0.5 ? 0 : Math.PI / 2;
      if (k.rng() < 0.24) {
        spec.cluster(buildShantyHouseCluster([px, 0, pz], {
          w: 5,
          d: 4,
          h: 2.6 + k.rng() * 0.6,
          yaw: yaw + (k.rng() < 0.5 ? 0 : Math.PI),
          color: pick(k, PAINTS),
          tier: 1,
          label: 'SHANTY HOUSE',
        }));
        site.plan.blocks.push({ x0: px - 2.6, z0: pz - 2.2, x1: px + 2.6, z1: pz + 2.2 });
      } else {
        spec.shack(px, pz, yaw + k.rand(-0.15, 0.15), k.rng() < 0.5 ? 'planks' : 'sheet', 0, pick(k, PAINTS));
      }
      if (++n % 6 === 0) brazier(k, px + 2.6, pz + 1.4, 0, 14);
      else if (n % 7 === 0) tyres(k, px - 2.4, 0, pz + 1.2, 3);
    }
  }
  // Extra compound shacks & stalls clustered around the outer-shanty barracks for juicy AC-130 targets.
  const compoundShacks: readonly (readonly [number, number, number, 'planks' | 'sheet'])[] = [
    [16, 102, Math.PI / 2, 'planks'],
    [25, 105, 0, 'sheet'],
    [64, 100, 0, 'planks'],
    [74, 86, Math.PI, 'sheet'],
    [92, 102, 0, 'planks'],
    [104, 98, -Math.PI / 2, 'sheet'],
    [-3, 84, Math.PI / 2, 'planks'],
    [6, 68, 0, 'sheet'],
    [138, 94, Math.PI, 'planks'],
    [154, 104, -Math.PI / 2, 'sheet'],
  ];
  for (const [sx, sz, syaw, look] of compoundShacks) {
    if (clearOfShantyFeatures(sx, sz, 2.2)) {
      spec.shack(sx, sz, syaw, look, 0, pick(k, PAINTS));
    }
  }
}

/** Cover for each side of the war's battles: a jersey barrier a step toward the enemy, where the ground has none of its own. */
function battleCover(k: Kit, site: Site): void {
  const own = new Set(['eastMilitia', 'wallGunWest', 'westBureau', 'cornerMilitia', 'cornerBureau']);
  for (const b of Object.values(BATTLES)) {
    for (const [mine, theirs] of [[b.at, b.from], [b.from, b.at]] as const) {
      if (own.has(mine)) continue;
      const a = PLACES[mine]!.at, t = PLACES[theirs]!.at;
      const dx = t[0] - a[0], dz = t[2] - a[2], d = Math.hypot(dx, dz);
      const x = a[0] + (dx / d) * 1.3, z = a[2] + (dz / d) * 1.3;
      // Its length across the line to the enemy.
      barrier(k, x, a[1], z, Math.atan2(-dx, -dz), 2.6);
      site.plan.blocks.push({ x0: x - 1.3, z0: z - 1.3, x1: x + 1.3, z1: z + 1.3 });
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Inside: the Market and the Square
// -------------------------------------------------------------------------------------------------

function block(k: Kit, site: Site, b: (typeof BLOCKS)[number]): void {
  const spec = site.spec, d = TERRACE.depth, len = b.x1 - b.x0;
  const north = b.row === 'n';
  const t = north ? { x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z0 + d } : { x0: b.x0, z0: b.z1 - d, x1: b.x1, z1: b.z1 };
  const cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2;
  if (b.tower) {
    // Destructible Tier-2 concrete Port Office Tower.
    spec.cluster(buildTowerCluster([cx, 0, cz], {
      tag: 'tower.portOffice',
      w: len,
      d,
      h: 8.4,
      yaw: north ? Math.PI : 0,
      color: pick(k, PAINTS),
      tier: 2,
      label: 'PORT OFFICE TOWER',
    }));
    site.plan.blocks.push({ x0: t.x0, z0: t.z0, x1: t.x1, z1: t.z1 });
    signPanel(k, cx, 6.6, north ? t.z0 - 0.02 : t.z1 + 0.02, north ? Math.PI : 0, 4.4, 1, signId('PORT OFFICE'));
  } else {
    // Destructible Tier-2 concrete Market Terrace + Tier-1 rear stairs (walkable roof at LEVEL.roof via navProxies).
    const back = north ? t.z1 + 0.75 : t.z0 - 0.75;
    const end = b.stair > 0 ? b.x1 - 0.4 : b.x0 + 0.4;
    spec.cluster(buildTerraceCluster([cx, 0, cz], {
      tag: `terrace.${b.id}`,
      len,
      depth: d,
      height: LEVEL.roof,
      yaw: north ? Math.PI : 0,
      colors: [pick(k, PAINTS), pick(k, PAINTS), pick(k, PAINTS)],
      stair: { ax: end - b.stair * 5.2, y0: 0, az: back, bx: end, y1: LEVEL.roof, bz: back, width: 1.4 },
      navPhysics: k.physics,
      tier: 2,
      label: `MARKET TERRACE ${b.id.toUpperCase()}`,
    }));
    site.plan.blocks.push({ x0: t.x0, z0: t.z0, x1: t.x1, z1: t.z1 });
  }
  // Shacks along the other face, alleys between them.
  const face = north ? b.z1 - 1.4 : b.z0 + 1.4;
  const count = Math.floor(len / 4.4);
  const step = len / count;
  for (let i = 0; i < count; i++) {
    const x = b.x0 + step * (i + 0.5);
    if (k.rng() < 0.2) continue;
    spec.shack(x, face, north ? 0 : Math.PI, k.rng() < 0.6 ? 'planks' : 'sheet', 0, pick(k, PAINTS));
  }
  // A lamp over the lane in front, so the paint reads at night.
  k.light((b.x0 + b.x1) / 2, 4.2, north ? b.z0 - 2 : b.z1 + 2, k.rng() < 0.5 ? 'orange' : 0xffc890, 34, 13);
  // The yard between: crates, drying racks, pallets, water tanks on stilts.
  const yz = north ? t.z1 + 2.4 : t.z0 - 2.4;
  if (len > 14) {
    site.crate(b.x0 + len * 0.35, yz - 0.5, b.x0 + len * 0.35 + 1.1, yz + 0.5, 0.9, pick(k, DYES));
    if (clearOf(b.x0 + len * 0.68, yz, 1.4)) dryingRack(k, b.x0 + len * 0.68, yz, 0, pick(k, DYES));
  } else if (clearOf(b.x0 + len * 0.5, yz, 1.2)) {
    palletStack(k, b.x0 + len * 0.5, yz, k.rand(0, Math.PI), 2, pick(k, DYES));
  }
  // Bunting from the terrace's roof across the lane in front, bulbs along it.
  const front = north ? b.z0 - 0.1 : b.z1 + 0.1, across = north ? -3.9 : 3.9;
  bunting(k, b.x0 + 1, LEVEL.roof + 1.6, front, b.x0 + 1 + len * 0.4, LEVEL.roof + 1.4, front + across);
  bulbs(k, b.x1 - 1, LEVEL.roof + 1.2, front, b.x1 - 1 - len * 0.5, LEVEL.roof + 1.4, front + across, pick(k, ['emissiveOrange', 'emissiveMagenta', 'emissiveCyan'] as const), 0);
}

function square(k: Kit, site: Site): void {
  // Destructible Tier-1 dry fountain & anchor monument in Market Square.
  const fx = 64.5, fz = 23.5;
  site.spec.cluster(buildFountainCluster([fx, 0, fz], {
    tag: 'square.fountain',
    tier: 1,
    label: 'SQUARE FOUNTAIN',
  }));
  site.plan.blocks.push({ x0: fx - 2, z0: fz - 2, x1: fx + 2, z1: fz + 2 });
  loudspeaker(k, 79, 18, 9);
  k.light(79, 8, 18.5, 'white', 26, 18);
  // Bunting and bulbs criss-crossing the Square from the roofs round it.
  for (const [ax, az, bx, bz] of [[SQUARE.x0, SQUARE.z0, SQUARE.x1, SQUARE.z1], [SQUARE.x1, SQUARE.z0, SQUARE.x0, SQUARE.z1], [SQUARE.x0, 28, SQUARE.x1, 28]] as const) {
    bunting(k, ax, 6.2, az, bx, 6.2, bz, 1.2);
  }
  bulbs(k, SQUARE.x0, 6, 22, SQUARE.x1, 6, 22, 'emissiveOrange', 18);
  bulbs(k, SQUARE.x0, 6, 34, SQUARE.x1, 6, 34, 'emissiveMagenta', 18);
  for (const [x, z] of [[SQUARE.x0 + 1, SQUARE.z0 + 1], [SQUARE.x1 - 1, SQUARE.z1 - 1]] as const) flag(k, x, 0, z, 7, 0.6, pick(k, DYES));
  brazier(k, 59.5, 31, 0, 18);
  // Lived-in Square touches: handcarts, pallet stacks, shade canopies tucked at corners away from Frame routes.
  if (clearOf(60.5, 34.2, 1.2)) handcart(k, 60.5, 34.2, 0.4, DYES[1]!);
  if (clearOf(79.2, 33.8, 1.2)) palletStack(k, 79.2, 33.8, 0.2, 2, DYES[0]!);
  if (clearOf(79.0, 20.5, 1.2)) drumCluster(k, 79.0, 20.5, 3);
}

/** Extra Tier-0 stalls & market shacks so the Frame's rampage through the Market splinters everything in its path. */
const EXTRA_STALLS: readonly (readonly [number, number, number, number])[] = [
  [18, 28.8, 0, 2], [28, 28.8, Math.PI, 4], [39, 29, 0, 6], [4, 29, Math.PI, 1], [18, 14.2, Math.PI, 5],
  [65, 36.8, 0, 1], [75, 36.8, 0, 3], [142, 14.2, Math.PI, 0], [152, 14.2, Math.PI, 2], [142, 43.2, 0, 5],
];

const EXTRA_MARKET_SHACKS: readonly (readonly [number, number, number, 'planks' | 'sheet'])[] = [
  [126, 43.5, 0, 'planks'], [132, 43.5, 0, 'sheet'], [2, 43.8, 0, 'planks'], [155, 11.5, Math.PI, 'sheet'],
];

function stalls(k: Kit, site: Site): void {
  const spec = site.spec;
  for (const [x, z, yaw, dye] of STALLS) spec.stall(x, z, yaw, 0, DYES[dye % DYES.length]!);
  for (const [x, z, yaw, dye] of EXTRA_STALLS) {
    if (clearOf(x, z, 1.9)) spec.stall(x, z, yaw, 0, DYES[dye % DYES.length]!);
  }
  for (const [x, z, yaw, look] of EXTRA_MARKET_SHACKS) {
    if (clearOf(x, z, 2.2)) spec.shack(x, z, yaw, look, 0, pick(k, PAINTS));
  }
}

/** Physics-enabled destructible buildings, barracks, elevated gun platforms, steel catwalks, and outer-shanty AC-130 targets. */
function townClusters(k: Kit, site: Site): void {
  const spec = site.spec;
  // Enterable Tier-1 masonry garrison barracks in the Outer Shanties & East Market (all BARRACKS south of Crane Street).
  for (const b of BARRACKS) {
    if (b.z < 20) continue;
    spec.cluster(buildBarracksCluster([b.x, 0, b.z], { tag: b.tag, yaw: b.yaw, tier: 1, label: b.label }));
    const swapped = Math.abs(Math.sin(b.yaw)) > 0.5;
    const hx = swapped ? 4 : 5.4, hz = swapped ? 5.4 : 4;
    site.plan.blocks.push({ x0: b.x - hx, z0: b.z - hz, x1: b.x + hx, z1: b.z + hz });
  }

  // Outer Shanty AC-130 destructible set pieces: Militia Watchtowers, volatile Munitions Sheds (+ barrels), and Guard Pillboxes.
  for (const p of OUTER_SET_PIECES) {
    if (p.kind === 'watchtower') {
      spec.cluster(buildWatchtowerCluster([p.x, 0, p.z], { tag: p.tag, yaw: p.yaw, tier: 1, label: p.label }));
      site.plan.blocks.push({ x0: p.x - 2.3, z0: p.z - 2.3, x1: p.x + 2.3, z1: p.z + 2.3 });
    } else if (p.kind === 'munitions') {
      spec.cluster(buildMunitionsShedCluster([p.x, 0, p.z], { tag: p.tag, yaw: p.yaw, color: pick(k, PAINTS), tier: 1, label: p.label }));
      site.plan.blocks.push({ x0: p.x - 3.0, z0: p.z - 2.4, x1: p.x + 3.0, z1: p.z + 2.4 });
      if (p.barrels) spec.barrels(p.barrels[0], 0, p.barrels[1], 3);
    } else {
      spec.cluster(buildPillboxCluster([p.x, 0, p.z], { tag: p.tag, yaw: p.yaw, tier: 1, label: p.label }));
      site.plan.blocks.push({ x0: p.x - 2.6, z0: p.z - 2.2, x1: p.x + 2.6, z1: p.z + 2.2 });
    }
  }

  // Two Tier-2 Heavy Industrial Market Halls (Frame weapons / 105mm / stomp / charge) replacing static blocks w2 & e3.
  spec.cluster(buildMarketHallCluster([22, 0, 22], { tag: 'marketHall.west', yaw: 0, tier: 2, label: 'WEST MARKET HALL' }));
  site.plan.blocks.push({ x0: 14.5, z0: 17, x1: 29.5, z1: 27 });
  k.light(22, 4.4, 22, 'orange', 34, 14);

  spec.cluster(buildMarketHallCluster([132, 0, 21.0], { tag: 'marketHall.east', yaw: 0, tier: 2, label: 'EAST MARKET HALL' }));
  site.plan.blocks.push({ x0: 124.5, z0: 16, x1: 139.5, z1: 26 });
  k.light(132, 4.4, 21, 'orange', 34, 14);

  // Two Tier-1 elevated militia emplacement platforms: knock out their piers to drop the deck & gunners.
  spec.cluster(buildEmplacementPlatformCluster([88, 0, 67], {
    tag: 'emplacement.flats', yaw: 0, tier: 1, height: 3.0, label: 'FLATS GUN PLATFORM',
  }));
  site.plan.blocks.push({ x0: 85, z0: 64, x1: 91, z1: 70 });

  spec.cluster(buildEmplacementPlatformCluster([150, 0, 45.2], {
    tag: 'emplacement.market', yaw: 0, tier: 1, height: 3.0, label: 'WALL FLANK PLATFORM',
  }));
  site.plan.blocks.push({ x0: 147, z0: 42.4, x1: 153, z1: 48 });

  // Two collapsing steel catwalks overlooking the Square flank & East Crane Street.
  spec.cluster(buildCatwalkCluster([56.5, 0, 28], {
    tag: 'catwalk.square', yaw: Math.PI / 2, length: 12, height: 3.6, tier: 1, label: 'SQUARE OVERLOOK CATWALK',
  }));
  spec.cluster(buildCatwalkCluster([146, 0, 11.5], {
    tag: 'catwalk.eastMarket', yaw: 0, length: 12, height: 3.8, tier: 1, label: 'CRANE STREET CATWALK',
  }));
}

/** Crane Street: cover where the militia counter-attack and where the aisle opens, braziers, a sign over the aisle. */
function craneStreet(k: Kit, site: Site): void {
  for (const [x, z] of [[40, 13.6], [88, 13.6], [108, 13.6], [148, 13.6], [6, 13.6]] as const) brazier(k, x, z, 0, 14);
  for (const [x0, z0, x1, z1] of [[18, 9, 19.2, 10.2], [131, 9, 132.4, 10.4], [96, 12.6, 97.4, 14]] as const) site.crate(x0, z0, x1, z1, 1.2, pick(k, DYES));
  signPanel(k, 56.5, 6, 8.1, 0, 4.6, 1, signId('CRANE 04'));
  // The cul-de-sac west of the stacks: shacks round a yard, shut off from the west road by the barricade.
  const spec = site.spec;
  for (const [x, z, yaw] of [[-6.5, -6, Math.PI / 2], [-6.5, -1, Math.PI / 2], [-6.5, 4, Math.PI / 2], [3, -7.6, 0], [8.5, -7.6, 0]] as const) {
    spec.shack(x, z, yaw, 'sheet', 0, pick(k, PAINTS));
  }
  brazier(k, 3, 0, 0, 16);
}

/**
 * Lived-in port & shanty dressing: utility pole lines with sagging overhead wires & string lights, dyed market canopies,
 * salt-fish drying racks, stacked pallets, cable spools, oil drums, water tanks on stilts, scrap lean-tos, handcarts,
 * weathered skiffs, and rusted wrecks — every piece strictly clear of roads, Frame routes, battles, spawns, and the LZ.
 */
function livedInTown(k: Kit): void {
  // 1. Utility pole & overhead power-line runs along the Outer Shanties, South Wall approach, and Crane Street.
  const poleRuns: readonly (readonly [number, number, boolean][])[] = [
    // South wall outer verge (west -> gate -> east)
    [[2, 53.2, true], [24, 53.2, false], [46, 53.2, true], [92, 53.2, true], [116, 53.2, false], [136, 53.2, true]],
    // Outer shanties mid-line (west barracks -> flats barracks -> east barracks)
    [[2, 88, false], [26, 90, true], [62, 86, true], [90, 86, false], [114, 88, true], [138, 90, false]],
    // Outer flats southern road verge
    [[22, 106.5, false], [52, 106.5, true], [80, 106.5, false], [110, 106.5, true], [138, 106.5, false]],
    // Crane Street north side utility line
    [[6, 8.6, false], [28, 8.6, true], [48, 8.6, false], [78, 8.6, true], [104, 8.6, false], [134, 8.6, true], [156, 8.6, false]],
  ];
  for (const run of poleRuns) {
    const placed: [number, number][] = [];
    for (const [px, pz, lamp] of run) {
      if (!clearOf(px, pz, 0.8)) continue;
      utilityPole(k, px, pz, 7.2, 0, lamp);
      placed.push([px, pz]);
    }
    for (let i = 0; i + 1 < placed.length; i++) {
      const [ax, az] = placed[i]!, [bx, bz] = placed[i + 1]!;
      if (Math.hypot(bx - ax, bz - az) > 48) continue;
      wireSpan(k, ax, 6.65, az, bx, 6.65, bz, 0.85);
      if (i % 2 === 0 && Math.hypot(bx - ax, bz - az) < 30) {
        bulbs(k, ax, 5.8, az, bx, 5.8, bz, 'emissiveOrange', 0);
      }
    }
  }

  // 2. Overhead dyed sailcloth canopies in non-Frame Market lanes & shanty pockets.
  const canopies: readonly (readonly [number, number, number, number, number, number])[] = [
    [12, 23, Math.PI / 2, 4.4, 3.0, 0],
    [12, 35, Math.PI / 2, 4.4, 3.0, 2],
    [32, 21, Math.PI / 2, 4.4, 3.0, 1],
    [32, 37, Math.PI / 2, 4.4, 3.0, 4],
    [45, 29, 0, 5.2, 3.0, 5],
    [22, 29, 0, 4.8, 2.8, 3],
    [100, 22, Math.PI / 2, 4.2, 2.8, 6],
    [142, 22, Math.PI / 2, 4.4, 3.0, 0],
    [142, 36, Math.PI / 2, 4.4, 3.0, 2],
    [72, 98, 0, 4.8, 3.4, 1],
    [20, 74, 0, 4.2, 3.0, 5],
  ];
  for (const [cx, cz, yaw, w, d, dyeIdx] of canopies) {
    if (clearOf(cx, cz, 1.4)) marketCanopy(k, cx, cz, yaw, w, d, DYES[dyeIdx % DYES.length]!);
  }

  // 3. Stilted corrugated water tanks in shanty & market yards.
  const waterTanks: readonly (readonly [number, number, number])[] = [
    [8, 60, 0.2], [32, 82, 0.8], [62, 83, 0], [92, 84, 0.5], [116, 78, 1.1], [148, 86, 0.3],
    [2, 29, 0], [50, 43.5, 0.4], [108, 43.5, 0.9], [156, 43.5, 0.1], [8, 13.8, 0],
  ];
  for (const [wx, wz, yaw] of waterTanks) {
    if (clearOfShantyFeatures(wx, wz, 1.3)) waterTankStilt(k, wx, wz, yaw);
  }

  // 4. Scrap lean-tos, drying racks, pallets, cable spools, drums, handcarts, skiffs, and rusted wrecks in outer shanties & lanes.
  const wrecks: readonly (readonly [number, number, number])[] = [
    [14, 104, 0.4], [64, 106, -0.35], [104, 104, 0.6], [136, 86, -0.5], [3, 94, 1.2], [44, 83, 0.2],
  ];
  for (const [rx, rz, yaw] of wrecks) {
    if (clearOfShantyFeatures(rx, rz, 2.4)) rustedWreck(k, rx, rz, yaw);
  }

  const skiffs: readonly (readonly [number, number, number, number])[] = [
    [12, 74, 0.3, 1], [78, 102, -0.4, 0], [118, 102, 0.5, 6], [156, 78, 1.4, 3], [5, 11.2, 0.1, 1],
  ];
  for (const [sx, sz, yaw, dyeIdx] of skiffs) {
    if (clearOfShantyFeatures(sx, sz, 2.1)) rustedSkiff(k, sx, sz, yaw, DYES[dyeIdx % DYES.length]!);
  }

  const leanTos: readonly (readonly [number, number, number, number])[] = [
    [16, 82, 0.2, 0], [34, 72, -0.4, 2], [48, 80, 0.1, 4], [74, 98, 0.5, 1], [100, 76, -0.2, 5],
    [114, 94, 0.3, 3], [130, 88, -0.6, 6], [148, 102, 0.4, 0], [4, 44, 0, 2], [90, 44, 0, 4],
  ];
  for (const [lx, lz, yaw, dyeIdx] of leanTos) {
    if (clearOfShantyFeatures(lx, lz, 1.8)) scrapLeanTo(k, lx, lz, yaw, DYES[dyeIdx % DYES.length]!);
  }

  // Scattered small lived-in clutter: drying racks, pallets, cable spools, drums, handcarts.
  const clutterSpots: readonly (readonly [number, number])[] = [
    // Outer shanties & flats pockets
    [8, 84], [18, 92], [30, 72], [46, 76], [60, 96], [76, 88], [88, 92], [102, 82], [114, 82], [126, 84], [140, 88], [152, 88],
    [12, 62], [28, 62], [44, 60], [82, 62], [98, 62], [114, 62], [134, 62],
    // Wall lane & Market lanes
    [14, 44], [28, 44], [52, 44], [84, 44], [112, 44], [138, 44],
    [12, 19], [12, 31], [32, 18], [32, 31], [50, 29], [100, 18], [100, 39], [142, 18], [142, 39],
    // Crane street edges
    [14, 13.8], [32, 13.8], [78, 13.8], [102, 13.8], [136, 13.8], [156, 13.8],
  ];
  for (let i = 0; i < clutterSpots.length; i++) {
    const [cx, cz] = clutterSpots[i]!;
    if (!clearOfShantyFeatures(cx, cz, 1.3)) continue;
    const yaw = k.rand(0, Math.PI);
    const kind = i % 5;
    if (kind === 0) dryingRack(k, cx, cz, yaw, pick(k, DYES));
    else if (kind === 1) palletStack(k, cx, cz, yaw, 2, pick(k, DYES));
    else if (kind === 2) cableSpool(k, cx, cz, 0.7, yaw);
    else if (kind === 3) drumCluster(k, cx, cz, 3);
    else handcart(k, cx, cz, yaw, pick(k, DYES));
  }
}

export function authorTown(k: Kit, spec: MapSpec): void {
  const site = new Site(k, spec);
  walls(k, site);
  trench(k, site);
  fuelFarm(k, site);
  shanties(k, site);
  for (const b of BLOCKS) if (!CLUSTER_BLOCKS.has(b.id)) block(k, site, b);
  townClusters(k, site);
  square(k, site);
  stalls(k, site);
  craneStreet(k, site);
  livedInTown(k);
  battleCover(k, site);
}

