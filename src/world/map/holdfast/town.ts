/**
 * The town: its south wall with the main gate and the two wall guns, the firing steps behind it, the west wall and its gate; outside,
 * the outer shanties (shacks, the trench, the fuel farm, two roof guns, the sniper's shack); inside, the Market's blocks and lanes and
 * the Square. Shacks are structures (structures.ts), painted, so a rocket or the Frame flattens them; the rest is static.
 */
import { BATTLES, PLACES, ROUTES } from '../../../campaign/missions/foreclosure.places';
import { FACE } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { barrier, signPanel, tank, tyres } from '../../kit/props';
import { signId } from '../../kit/signs';
import { Site } from '../outpost/site';
import type { MapSpec } from '../spec';
import { banner, brazier, bulbs, bunting, flag, loudspeaker, shanty, terraceIn, tower } from './props';
import {
  BLOCKS, BREACH, DYES, FRAME, FUEL, FUEL_TANKS, HOLDFAST_SPAWNS, LEVEL, MAIN_GATE, PAD, PAINTS, ROADS, ROOF_GUNS, SQUARE,
  STALLS, STEP, STEPS, TERRACE, TRENCH, TRENCH_W, WALL_GUNS, WALL_X0, WALL_X1, WALL_Z, WEST_GATE, WEST_X,
} from './plan';

const HARBOUR_FACE = -105;

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
  // West: from the dyke north to the harbour wall, the west gate in it. It lifts for the Frame and for friends.
  spec.wall(WEST_X, WALL_Z, WEST_X, WEST_GATE.z + WEST_GATE.half);
  spec.wallGate(WEST_X, WEST_GATE.z + WEST_GATE.half, WEST_X, WEST_GATE.z - WEST_GATE.half, 0, true);
  spec.wall(WEST_X, WEST_GATE.z - WEST_GATE.half, WEST_X, HARBOUR_FACE);
  site.plan.walls.push({ ax: WALL_X0, az: WALL_Z, bx: WALL_X1, bz: WALL_Z, half: 0.4 }, { ax: WEST_X, az: WALL_Z, bx: WEST_X, bz: HARBOUR_FACE, half: 0.4 });
  site.plan.gates.push({ x: MAIN_GATE.x, z: WALL_Z, yaw: 0, w: MAIN_GATE.half * 2, bay: true }, { x: WEST_X, z: WEST_GATE.z, yaw: Math.PI / 2, w: WEST_GATE.half * 2, bay: true });

  // Gate towers behind the main gate, the town's name on a beam between them and a loudspeaker on each.
  for (const s of [-1, 1]) {
    const x = MAIN_GATE.x + s * (MAIN_GATE.half + 2.1);
    const c = s < 0 ? PAINTS[0]! : PAINTS[1]!;
    g.use('paintWhite').tint(c[0], c[1], c[2]);
    k.block('paintWhite', x - 1.5, 0, WALL_Z - 4.4, x + 1.5, 7, WALL_Z - 0.45, 0.06);
    g.tint(1);
    banner(k, x, 6.4, WALL_Z - 0.4, 0, 2.2, 4.2, DYES[s < 0 ? 0 : 2]!);
    banner(k, x, 6.4, WALL_Z - 4.45, Math.PI, 2.2, 4.2, DYES[s < 0 ? 3 : 4]!);
    loudspeaker(k, x, WALL_Z - 2.4, 2.4, 7);
    k.light(x, 5, WALL_Z + 3, 'white', 40, 16);
    g.use('steelDark').bevel(x, 7.2, WALL_Z - 2.4, 1.2, 0.12, 1.2, 0.03);
  }
  k.beam(MAIN_GATE.x - 4.5, 6.6, WALL_Z - 0.3, MAIN_GATE.x + 4.5, 6.6, WALL_Z - 0.3, 0.12, 0.25, 'rust');
  signPanel(k, MAIN_GATE.x, 5.6, WALL_Z + 0.1, 0, 5, 1.2, signId('HOLDFAST'));
  // The segment marked for the charge: hazard paint on the salt either side, a stake with a rag.
  g.use('hazard');
  g.box(BREACH.x, 0.02, BREACH.z + 1.6, 2, 0.01, 0.35, FACE.py);
  g.box(BREACH.x, 0.02, BREACH.z - 1.6, 2, 0.01, 0.35, FACE.py);
  flag(k, BREACH.x + 2.4, 0, BREACH.z + 1.2, 1.8, 0.3, [0.95, 0.84, 0.3]);

  // The wall guns: a timber pad behind the wall, sandbag cheeks, stairs up its north side. The gun faces south over the wall.
  for (const gun of WALL_GUNS) {
    const { x } = gun;
    g.use('plywood').tint(0.62, 0.46, 0.32);
    k.block('plywood', x - PAD.half, 0, PAD.z0, x + PAD.half, LEVEL.pad, PAD.z1, 0.04);
    g.tint(1);
    site.plan.decks.push({ x0: x - PAD.half, z0: PAD.z0, x1: x + PAD.half, z1: PAD.z1 });
    site.sandbags(x - PAD.half, PAD.z1 - 1.6, x - PAD.half + 0.6, PAD.z1, 0.9, LEVEL.pad);
    site.sandbags(x + PAD.half - 0.6, PAD.z1 - 1.6, x + PAD.half, PAD.z1, 0.9, LEVEL.pad);
    site.stairs(x - 0.8, PAD.z0 - 3.4, 0, x - 0.8, PAD.z0, LEVEL.pad, 1.4, 'concrete');
    spec.emplacement(x, LEVEL.pad, gun.z, Math.PI, 1.1, 1);
    k.light(x, 4.4, WALL_Z - 3, 'orange', 22, 12);
  }

  // Firing steps: timber decks behind the wall at WALL.catwalk, posts under them, stairs up from the lane.
  for (const [x0, x1] of STEPS) {
    const z0 = WALL_Z - 0.25 - STEP.to, z1 = WALL_Z - 0.25 - STEP.from;
    g.use('plywood').tint(0.55, 0.42, 0.3);
    g.box((x0 + x1) / 2, LEVEL.step - 0.08, (z0 + z1) / 2, (x1 - x0) / 2, 0.08, (z1 - z0) / 2, FACE.all);
    k.collide((x0 + x1) / 2, LEVEL.step - 0.4, (z0 + z1) / 2, (x1 - x0) / 2, 0.4, (z1 - z0) / 2, 'dirt');
    g.use('rust').tint(0.7);
    for (let x = x0 + 0.3; x < x1; x += 3) g.box(x, (LEVEL.step - 0.16) / 2, z0 + 0.12, 0.08, (LEVEL.step - 0.16) / 2, 0.08, FACE.sides);
    g.tint(1);
    site.plan.decks.push({ x0, z0, x1, z1 });
    site.stairs(x0 + 1.2, z0 - 2.8, 0, x0 + 1.2, z0, LEVEL.step, 1.3, 'concrete');
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

/** Painted shacks and shanty houses on the salt south of the wall, kept off the tracks, the LZ and the marks. */
function shanties(k: Kit, site: Site): void {
  const spec = site.spec;
  // Two shanty houses with a gun on the roof, sandbags round it.
  for (const gun of ROOF_GUNS) {
    shanty(k, site, gun.x, gun.z, 0, 7, 5.5, true);
    site.sandbags(gun.x - 2.4, gun.z + 2.0, gun.x + 2.4, gun.z + 2.6, 0.7, LEVEL.roof);
    spec.emplacement(gun.x, LEVEL.roof, gun.z + 1.2, gun.yaw, 1.2, 1);
    flag(k, gun.x - 3.2, LEVEL.roof, gun.z - 2.4, 3, 0.4, DYES[1]!);
  }
  // The sniper's shack: one rocket flattens it.
  const sn = PLACES.sniperShack!.at;
  spec.shack(sn[0], sn[2] + 2.6, 0, 'sheet', 0, PAINTS[6]);
  // Shacks scattered on a jittered grid between the wall and the Flats.
  let n = 0;
  for (let z = 56; z < 84; z += 6.5) {
    for (let x = -4; x < 160; x += 7.5) {
      const px = x + k.rand(-1.8, 1.8), pz = z + k.rand(-1.5, 1.5);
      if (k.rng() < 0.38 || !clearOf(px, pz, 2.4)) continue;
      if (Math.hypot(px - FUEL.x, pz - FUEL.z) < 16) continue;
      // The approach to the gate stays open ground: a killing field for the wall guns, and the 14th's way in.
      if (Math.abs(px - 70) < 11 && pz < 78) continue;
      if (TRENCH.some(([tx, tz]) => Math.abs(px - tx) < 6 && Math.abs(pz - tz) < 6)) continue;
      if (ROOF_GUNS.some(r => Math.abs(px - r.x) < 7 && Math.abs(pz - r.z) < 6)) continue;
      if (Math.abs(px - sn[0]) < 5 && Math.abs(pz - sn[2] - 2.6) < 4) continue;
      const yaw = k.rng() < 0.5 ? 0 : Math.PI / 2;
      if (k.rng() < 0.22) shanty(k, site, px, pz, yaw + (k.rng() < 0.5 ? 0 : Math.PI), 5, 4, false);
      else spec.shack(px, pz, yaw + k.rand(-0.15, 0.15), k.rng() < 0.5 ? 'planks' : 'sheet', 0, pick(k, PAINTS));
      if (++n % 5 === 0) brazier(k, px + 2.6, pz + 1.4, 0, 16);
      else if (n % 7 === 0) tyres(k, px - 2.4, 0, pz + 1.2, 3);
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
  if (b.tower) {
    tower(k, site, (t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2, north ? Math.PI : 0, len, d, 8.4);
    signPanel(k, (t.x0 + t.x1) / 2, 6.6, north ? t.z0 - 0.02 : t.z1 + 0.02, north ? Math.PI : 0, 4.4, 1, signId('PORT OFFICE'));
  } else {
    terraceIn(k, site, t, b.row);
    // Stairs up behind the terrace, along its back, from the yard to the roof.
    const back = north ? t.z1 + 0.75 : t.z0 - 0.75;
    const end = b.stair > 0 ? b.x1 - 0.4 : b.x0 + 0.4;
    site.stairs(end - b.stair * 5.2, back, 0, end, back, LEVEL.roof, 1.4, 'concrete');
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
  // The yard between: a brazier, crates.
  const yz = north ? t.z1 + 2.4 : t.z0 - 2.4;
  if (len > 14) site.crate(b.x0 + len * 0.35, yz - 0.5, b.x0 + len * 0.35 + 1.1, yz + 0.5, 0.9, pick(k, DYES));
  // Bunting from the terrace's roof across the lane in front, bulbs along it.
  const front = north ? b.z0 - 0.1 : b.z1 + 0.1, across = north ? -3.9 : 3.9;
  bunting(k, b.x0 + 1, LEVEL.roof + 1.6, front, b.x0 + 1 + len * 0.4, LEVEL.roof + 1.4, front + across);
  bulbs(k, b.x1 - 1, LEVEL.roof + 1.2, front, b.x1 - 1 - len * 0.5, LEVEL.roof + 1.4, front + across, pick(k, ['emissiveOrange', 'emissiveMagenta', 'emissiveCyan'] as const), 9);
}

function square(k: Kit, site: Site): void {
  const g = k.geo;
  // A dry fountain: a low round wall to crouch behind, an anchor standing in it.
  const fx = 64.5, fz = 23.5;
  g.use('concrete').tint(0.78, 0.72, 0.64).lathe([2, 0, 2, 0.7, 1.7, 0.7, 1.7, 0.2, 0.01, 0.2], fx, 0, fz, 20, false);
  g.tint(1);
  k.collidePrism(fx, fz, 0, 0.7, 2, 10, 'concrete');
  g.use('rust').tint(0.7).box(fx, 2.2, fz, 0.16, 2.2, 0.16, FACE.sides | FACE.py);
  g.box(fx, 0.9, fz, 1.3, 0.14, 0.16, FACE.all);
  g.tint(1);
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
}

function stalls(_k: Kit, site: Site): void {
  const spec = site.spec;
  for (const [x, z, yaw, dye] of STALLS) spec.stall(x, z, yaw, 0, DYES[dye % DYES.length]!);
}

/** Crane Street: cover where the militia counter-attack and where the aisle opens, a burnt car, braziers, a sign over the aisle. */
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

export function authorTown(k: Kit, spec: MapSpec): void {
  const site = new Site(k, spec);
  walls(k, site);
  trench(k, site);
  fuelFarm(k, site);
  shanties(k, site);
  for (const b of BLOCKS) block(k, site, b);
  square(k, site);
  stalls(k, site);
  craneStreet(k, site);
  battleCover(k, site);
}
