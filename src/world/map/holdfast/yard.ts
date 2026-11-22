/**
 * The shipyard: the stacks with their crane aisle, the gantry crane and its cab, the quay apron and road, the quay crane, the Slip, the
 * boat shed, the cannery, the harbour wall and the flak tower. Container stacks are one collider a block (the parkour lessons are
 * measured against these faces), drawn as painted boxes on the faces and the top only.
 */
import { PLACES } from '../../../campaign/missions/foreclosure.places';
import {
  buildBarracksCluster,
  buildCanneryCluster,
  buildQuayCraneCluster,
  type StructuralClusterSpec,
} from '../../destruction';
import { FACE } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { container, signPanel, truck } from '../../kit/props';
import { signId } from '../../kit/signs';
import { Site } from '../outpost/site';
import type { MapSpec } from '../spec';
import { brazier, bulbs, flag, hull } from './props';
import { clearOf } from './town';
import {
  AISLE, APRON, BARRACKS, BOX, CANNERY, CHIMNEY, DYES, E1_STAIR, FLAK, GANTRY, HARBOUR, HARBOUR_STAIRS, LEVEL, QUAY_CRANE,
  QUAY_ROAD, type Rgb, SEA, SHED, SLIP, SLIP_RAMPS, type Stack, STACKS, stack, stackTop, WEST_X,
} from './plan';

/** Painted containers: the colours a port collects. */
const BOXES: readonly Rgb[] = [
  [0.62, 0.18, 0.12], [0.1, 0.3, 0.55], [0.7, 0.5, 0.08], [0.14, 0.42, 0.26], [0.7, 0.34, 0.08], [0.14, 0.44, 0.48], [0.46, 0.46, 0.48],
  [0.42, 0.2, 0.38], [0.6, 0.58, 0.52],
];

// -------------------------------------------------------------------------------------------------
// The stacks
// -------------------------------------------------------------------------------------------------

function block(k: Kit, site: Site, s: Stack): void {
  const top = stackTop(s);
  const build = () => k.collide((s.x0 + s.x1) / 2, top / 2, (s.z0 + s.z1) / 2, (s.x1 - s.x0) / 2, top / 2, (s.z1 - s.z0) / 2, 'metal');
  if (s.noClimb) k.noClimb(build);
  else build();
  site.plan.blocks.push({ x0: s.x0, z0: s.z0, x1: s.x1, z1: s.z1 });
  // The boxes: along their length, then across, then up. Only those on a face or on top are drawn.
  const len = s.along === 'x' ? s.x1 - s.x0 : s.z1 - s.z0, wide = s.along === 'x' ? s.z1 - s.z0 : s.x1 - s.x0;
  const nA = Math.max(1, Math.round(len / BOX.l)), nC = Math.max(1, Math.round(wide / BOX.w));
  const stepA = nA > 1 ? (len - BOX.l) / (nA - 1) : 0, stepC = wide / nC;
  for (let lv = 0; lv < s.levels; lv++) {
    for (let a = 0; a < nA; a++) {
      for (let c = 0; c < nC; c++) {
        const face = a === 0 || a === nA - 1 || c === 0 || c === nC - 1;
        if (!face && lv < s.levels - 1) continue;
        const u = BOX.l / 2 + a * stepA, v = (c + 0.5) * stepC;
        const tint = BOXES[Math.floor(k.rng() * BOXES.length)]!;
        if (s.along === 'x') container(k, s.x0 + u, lv * BOX.h, s.z0 + v, 0, tint, false);
        else container(k, s.x0 + v, lv * BOX.h, s.z0 + u, Math.PI / 2, tint, false);
      }
    }
  }
}

/** The chimney between the halves of B: a climbable liner just proud of each face, the blocks themselves refusing the climb. */
function chimney(k: Kit): void {
  const top = stackTop(stack('Bw')), h = top / 2, zc = (CHIMNEY.z0 + CHIMNEY.z1) / 2, hz = (CHIMNEY.z1 - CHIMNEY.z0) / 2;
  k.collide(CHIMNEY.x0 + 0.015, h, zc, 0.015, h, hz, 'metal', false);
  k.collide(CHIMNEY.x1 - 0.015, h, zc, 0.015, h, hz, 'metal', false);
  // Hand marks: someone has painted rungs on the doors.
  const g = k.geo.use('paintWhite').tint(0.95, 0.84, 0.3);
  for (let y = 1.2; y < top; y += 1.3) {
    g.box(CHIMNEY.x0 + 0.04, y, zc, 0.01, 0.05, 0.5, FACE.px);
    g.box(CHIMNEY.x1 - 0.04, y + 0.65, zc, 0.01, 0.05, 0.5, FACE.nx);
  }
  g.tint(1);
}

/** The gantry crane over the west stacks and the aisle: its west leg a static parkour chimney; girder, cab & east leg destructible. */
function gantry(k: Kit, site: Site): void {
  const { z0, z1, x0, x1, under, deck, leg, east, cab } = GANTRY, g = k.geo, zc = (z0 + z1) / 2, hz = (z1 - z0) / 2;
  // West leg: two static climbable plates from the ground to the girder's top, keeping the parkour chimney climb intact.
  for (const [a, b] of [[leg.x0, leg.gap0], [leg.gap1, leg.x1]] as const) {
    g.use('paintYellow').tint(0.62, 0.5, 0.2);
    g.box((a + b) / 2, deck / 2, zc, (b - a) / 2, deck / 2, hz, FACE.all);
    g.tint(1);
    k.collide((a + b) / 2, deck / 2, zc, (b - a) / 2, deck / 2, hz, 'metal');
  }
  g.use('hazard').box(leg.gap0 + 0.75, 2.2, z1 + 0.01, 0.75, 0.12, 0.01, FACE.pz);

  // Destructible Gantry Crane superstructure (Tier 2 — Frame ordnance / Howitzer / Nuke topples it across the aisle).
  const e1 = stackTop(stack('E1'));
  const eastX = (east.x0 + east.x1) / 2;
  const eastHalfX = (east.x1 - east.x0) / 2;
  const eastSpan = under - e1;
  const girderY = (under + deck) / 2;
  const girderHalfY = (deck - under) / 2;
  const cabX = (cab.x0 + cab.x1) / 2;
  const cabHalfX = (cab.x1 - cab.x0) / 2;
  const cabH = 3.0;
  const hx = (AISLE.x0 + AISLE.x1) / 2;

  const cluster: StructuralClusterSpec = {
    tag: 'gantryCrane',
    kind: 'gantryCrane',
    label: 'GANTRY CRANE',
    value: 520_000,
    collapseThreshold: 0.45,
    nodes: [
      // Anchored west collar on the west chimney leg & anchored east leg on stack E1.
      { id: 'west_collar', pos: [leg.x1 + 0.9, under - 1.5, zc], half: [0.9, 1.5, hz], mat: 'paintYellow', hp: 420, tier: 2, anchored: true, kind: 'column' },
      { id: 'east_leg_low', pos: [eastX, e1 + eastSpan * 0.25, zc], half: [eastHalfX, eastSpan * 0.25, hz], mat: 'paintYellow', hp: 420, tier: 2, anchored: true, kind: 'column' },
      { id: 'east_leg_high', pos: [eastX, e1 + eastSpan * 0.75, zc], half: [eastHalfX, eastSpan * 0.25, hz], mat: 'paintYellow', hp: 420, tier: 2, anchored: false, kind: 'column' },

      // West counterweight & tail girder over the west road.
      { id: 'girder_tail', pos: [(x0 + leg.x0) / 2, girderY, zc], half: [(leg.x0 - x0) / 2, girderHalfY, hz], mat: 'steelDark', hp: 380, tier: 2, anchored: false, kind: 'craneBoom', impactRadius: 11, impactDamage: 320 },
      { id: 'counterweight', pos: [x0 + 2.0, under - 1.4, zc], half: [1.8, 1.4, 1.6], mat: 'concreteDark', hp: 380, tier: 2, anchored: false, kind: 'slab', impactRadius: 10, impactDamage: 340 },

      // Walkable girder deck spans (top at y = GANTRY.deck = 22 m for the parkour climb into the cab).
      { id: 'girder_west', pos: [(leg.x1 + 29.9) / 2, girderY, zc], half: [(29.9 - leg.x1) / 2, girderHalfY, hz], mat: 'steelDark', hp: 450, tier: 2, anchored: false, kind: 'craneBoom', impactRadius: 12, impactDamage: 360 },
      { id: 'girder_mid', pos: [(29.9 + 45.9) / 2, girderY, zc], half: [(45.9 - 29.9) / 2, girderHalfY, hz], mat: 'steelDark', hp: 450, tier: 2, anchored: false, kind: 'craneBoom', impactRadius: 13, impactDamage: 400 },
      { id: 'girder_east', pos: [(45.9 + x1) / 2, girderY, zc], half: [(x1 - 45.9) / 2, girderHalfY, hz], mat: 'steelDark', hp: 450, tier: 2, anchored: false, kind: 'craneBoom', impactRadius: 14, impactDamage: 420, keyNode: true },

      // Operator cab over the stacks (open east/west doorways so the player runs straight in for the Sabot).
      { id: 'cab_north', pos: [cabX, deck + cabH / 2, cab.z0 + 0.14], half: [cabHalfX, cabH / 2, 0.14], mat: 'paintYellow', hp: 180, tier: 1, anchored: false, kind: 'wall' },
      { id: 'cab_south', pos: [cabX, deck + cabH / 2, cab.z1 - 0.14], half: [cabHalfX, cabH / 2, 0.14], mat: 'paintYellow', hp: 180, tier: 1, anchored: false, kind: 'wall' },
      { id: 'cab_roof', pos: [cabX, deck + cabH + 0.12, zc], half: [cabHalfX + 0.2, 0.12, (cab.z1 - cab.z0) / 2 + 0.2], mat: 'paintYellow', hp: 200, tier: 1, anchored: false, kind: 'roof', impactRadius: 7 },

      // Hanging crane hook block suspended over the Crane Aisle.
      { id: 'hook_block', pos: [hx, 14.0, zc], half: [0.65, 0.65, 0.55], mat: 'hazard', hp: 220, tier: 2, anchored: false, kind: 'craneBoom', impactRadius: 8, impactDamage: 280 },
    ],
    links: [
      ['west_collar', 'girder_tail'],
      ['girder_tail', 'counterweight'],
      ['west_collar', 'girder_west'],
      ['girder_west', 'girder_mid'],
      ['girder_mid', 'cab_north'],
      ['girder_mid', 'cab_south'],
      ['cab_north', 'cab_roof'],
      ['cab_south', 'cab_roof'],
      ['east_leg_low', 'east_leg_high'],
      ['east_leg_high', 'girder_east'],
      ['girder_east', 'hook_block'],
    ],
  };
  site.spec.cluster(cluster);
  k.light(cabX, deck + 2.4, zc, 'white', 10, 7);
  site.plan.decks.push({ x0, z0, x1, z1 });
}

function stacks(k: Kit, site: Site): void {
  for (const s of STACKS) block(k, site, s);
  chimney(k);
  // The first climb, lit from Crane Street, a ladder of painted rungs up A's face where people go up.
  const a = stack('A'), lx = (CHIMNEY.x0 + CHIMNEY.x1) / 2 - 5;
  k.light(lx, 4, a.z1 + 3, 'orange', 26, 12);
  const rg = k.geo.use('paintWhite').tint(0.95, 0.84, 0.3);
  for (let y = 0.8; y < stackTop(a); y += 0.9) rg.box(lx, y, a.z1 + 0.04, 0.5, 0.05, 0.01, FACE.pz);
  rg.tint(1);
  gantry(k, site);
  const g = k.geo;
  // Stairs up E1's east face in the lane, and a landing onto its top.
  const top = stackTop(stack('E1')), sx = (E1_STAIR.x0 + E1_STAIR.x1) / 2;
  k.stairs(sx, E1_STAIR.foot, 0, sx, E1_STAIR.top, top, E1_STAIR.x1 - E1_STAIR.x0, 'steel');
  g.use('grate').box(sx - 0.05, top - 0.06, E1_STAIR.top - 1.25, (E1_STAIR.x1 - E1_STAIR.x0) / 2 + 0.05, 0.06, 1.25, FACE.py | FACE.ny);
  k.collide(sx - 0.05, top - 0.15, E1_STAIR.top - 1.25, (E1_STAIR.x1 - E1_STAIR.x0) / 2 + 0.05, 0.15, 1.25, 'grate', false);
  // The snipers' nests on E1's edge over the aisle.
  for (const id of ['stacksSniperA', 'stacksSniperB'] as const) {
    const m = PLACES[id]!.at;
    site.sandbags(AISLE.x1 + 0.1, m[2] - 2, AISLE.x1 + 0.7, m[2] + 2, 0.75, top);
  }
  flag(k, AISLE.x1 + 1, top, -2, 3.5, 0.3, DYES[0]!);
  flag(k, AISLE.x1 + 1, top, -40, 3.5, 0.3, DYES[2]!);
  // The aisle: crane rails, a fallen container on its side, a forklift, light from lamps on the stacks.
  g.use('steel').tint(0.5);
  for (const x of [AISLE.x0 + 1.2, AISLE.x1 - 1.2]) g.box(x, 0.06, (AISLE.z0 + AISLE.z1) / 2, 0.08, 0.06, (AISLE.z1 - AISLE.z0) / 2, FACE.py | FACE.px | FACE.nx);
  g.tint(1);
  container(k, AISLE.x0 + 1.5, 0, -18, Math.PI / 2, BOXES[1], false);
  k.collide(AISLE.x0 + 1.5, 1.3, -18, 1.3, 1.3, 6.1, 'metal');
  truck(k, AISLE.x1 - 1.3, 0, -32, Math.PI / 2);
  for (const z of [0, -16, -30]) k.light((AISLE.x0 + AISLE.x1) / 2, 8, z, 'white', 24, 16);
  bulbs(k, AISLE.x0, 8.6, 4, AISLE.x1, 7.8, 4, 'emissiveCyan', 0);
  // Grandad's hide: sandbag cheeks either side of the aisle's north mouth on the apron.
  const q = PLACES.quayRoad!.at;
  site.sandbags(q[0] - 6.5, -45.4, q[0] - 3.6, -44.1, 1.3);
  site.sandbags(q[0] + 3.6, -45.4, q[0] + 6.5, -44.1, 1.3);
}

// -------------------------------------------------------------------------------------------------
// The quay
// -------------------------------------------------------------------------------------------------

function quay(k: Kit, site: Site): void {
  const g = k.geo;
  // The quay crane: walkable checkpoint deck at y = LEVEL.quayDeck (6 m) stays intact for PLACES.quay & pickups,
  // while its towering crane mast, cab, and cantilevered boom over the Slip are a destructible Tier-2/3 cluster.
  const c = QUAY_CRANE, d = c.deck, cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2;
  g.use('paintYellow').tint(0.7, 0.42, 0.12);
  for (const x of [c.x0 + 0.4, c.x1 - 0.4]) for (const z of [c.z0 + 0.4, c.z1 - 0.4]) {
    g.box(x, d / 2, z, 0.35, d / 2, 0.35, FACE.sides);
    k.collide(x, d / 2, z, 0.35, d / 2, 0.35, 'metal');
    g.box(x, d + 1.6, z, 0.12, 1.6, 0.12, FACE.sides);
  }
  g.box(cx, d + 3.25, cz, (c.x1 - c.x0) / 2 + 0.4, 0.08, (c.z1 - c.z0) / 2 + 0.4, FACE.all);
  g.tint(1);
  g.use('grate').box(cx, d - 0.1, cz, (c.x1 - c.x0) / 2, 0.1, (c.z1 - c.z0) / 2, FACE.py | FACE.ny);
  k.collide(cx, d - 0.2, cz, (c.x1 - c.x0) / 2, 0.2, (c.z1 - c.z0) / 2, 'grate', false);
  k.rail([c.x0, d, c.z0 + 0.1, c.x1, d, c.z0 + 0.1, c.x1, d, c.z1 - 0.1]);
  k.stairs(c.stair.foot, c.stair.z, 0, c.stair.top, c.stair.z, d, c.stair.w, 'steel');
  k.light(cx, d + 2.6, cz, 'white', 18, 10);
  site.plan.decks.push({ x0: c.x0, z0: c.z0, x1: c.x1, z1: c.z1 });
  signPanel(k, c.x0 + 0.05, d + 1.6, cz, -Math.PI / 2, 3, 0.8, signId('QUAY'));

  // Destructible Quay Crane tower & cantilevered boom cantilevered east over the Slip dockside (Frame/Howitzer ONLY).
  site.spec.cluster(buildQuayCraneCluster([cx, 0, -68.5], {
    tag: 'quayCrane', yaw: 0, tier: 3, label: 'QUAY CRANE',
  }));
  site.plan.blocks.push({ x0: cx - 3.6, z0: -72.1, x1: cx + 3.6, z1: -64.9 });

  // The apron: floods, bollards on the Slip's lip, a rail along it but for the ramp.
  for (const x of [20, 90, 140]) k.mast(x, APRON.z1 - 0.8, 0, 9, Math.PI, 'white', 70, 30);
  k.rail([SLIP.x0, 0, SLIP.z1 + 0.25, 110.5, 0, SLIP.z1 + 0.25]);
  k.rail([125.5, 0, SLIP.z1 + 0.25, SLIP.x1, 0, SLIP.z1 + 0.25]);
  // The quay road: a barricade the militia hold, oil drums, a burnt technical on the verge.
  truck(k, QUAY_ROAD.x0 - 2.4, 0, -8, Math.PI / 2 + 0.2, 0.05);
  for (const z of [-40, -14, 6]) brazier(k, QUAY_ROAD.x1 + 1.6, z, 0, 14);

  // The cannery: Tier-2 physics-destructible hall with interior chain-reaction brine boilers facing Quay Road.
  const n = CANNERY;
  site.spec.cluster(buildCanneryCluster([144, 0, -18], {
    tag: 'cannery', yaw: -Math.PI / 2, tier: 2, label: 'BRINE CANNERY',
  }));
  site.spec.barrels(137, 0, -14, 3);
  site.spec.tank(137, 0, -24);
  site.plan.blocks.push({ x0: n.x0, z0: n.z0, x1: n.x1, z1: n.z1 });
  k.light(n.x0 - 3, 6, -20, 'orange', 26, 16);
}

// -------------------------------------------------------------------------------------------------
// The Slip
// -------------------------------------------------------------------------------------------------

/** A ramp down into the dock: a solid wedge to run on, the slope drawn and its sides closed. */
function ramp(k: Kit, ax: number, az: number, bx: number, bz: number, w: number): void {
  const g = k.geo, y0 = 0, y1 = LEVEL.slip, rise = y1 - y0;
  k.along(ax, y0, az, bx, y1, bz, len => {
    g.use('concrete').tint(0.72, 0.7, 0.66).gridStep(0, 0, w / 2, len, 0, 0, 0, 0, -w, 3);
    g.tint(1);
    const deep = Math.abs(rise) + 1;
    k.collide(len / 2, -deep / 2, 0, len / 2, deep / 2, w / 2, 'concrete');
    g.use('hazard').box(len / 2, 0.01, w / 2 - 0.12, len / 2, 0.01, 0.1, FACE.py);
    g.box(len / 2, 0.01, -w / 2 + 0.12, len / 2, 0.01, 0.1, FACE.py);
  });
  const run = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / run, nz = (bx - ax) / run;
  for (const s of [1, -1]) {
    const ox = (nx * w * s) / 2, oz = (nz * w * s) / 2;
    const p0 = [ax + ox, az + oz] as const, p1 = [bx + ox, bz + oz] as const;
    g.use('concreteDark').tint(0.7);
    if (s > 0) g.tri(p0[0], y1, p0[1], p1[0], y1, p1[1], p0[0], y0, p0[1]);
    else g.tri(p1[0], y1, p1[1], p0[0], y1, p0[1], p0[0], y0, p0[1]);
    g.tint(1);
  }
}

function slip(k: Kit, site: Site): void {
  const g = k.geo, y = LEVEL.slip;
  // The floor and the four faces down to it.
  g.use('concreteDark').tint(0.62, 0.62, 0.6).gridStep(SLIP.x0, y, SLIP.z1, SLIP.x1 - SLIP.x0, 0, 0, 0, 0, SLIP.z0 - SLIP.z1, 3);
  g.use('concrete').tint(0.55, 0.54, 0.5);
  const cx = (SLIP.x0 + SLIP.x1) / 2, cz = (SLIP.z0 + SLIP.z1) / 2, hx = (SLIP.x1 - SLIP.x0) / 2, hz = (SLIP.z1 - SLIP.z0) / 2;
  g.box(cx, y / 2, SLIP.z0 + 0.01, hx, -y / 2, 0.01, FACE.pz);
  g.box(cx, y / 2, SLIP.z1 - 0.01, hx, -y / 2, 0.01, FACE.nz);
  g.box(SLIP.x0 + 0.01, y / 2, cz, 0.01, -y / 2, hz, FACE.px);
  g.box(SLIP.x1 - 0.01, y / 2, cz, 0.01, -y / 2, hz, FACE.nx);
  // Tide marks on the faces, from when there was a sea in it.
  g.use('paintWhite').tint(0.86, 0.86, 0.82);
  for (const yy of [-2.2, -3.6]) {
    g.box(cx, yy, SLIP.z0 + 0.02, hx, 0.08, 0.01, FACE.pz);
    g.box(cx, yy, SLIP.z1 - 0.02, hx, 0.08, 0.01, FACE.nz);
  }
  g.tint(1);
  site.plan.fills.push({ x0: SLIP.x0, z0: SLIP.z0, x1: SLIP.x1, z1: SLIP.z1, rgb: [0.18, 0.2, 0.22], label: 'THE SLIP' });
  const { south, west, east } = SLIP_RAMPS;
  ramp(k, (south.x0 + south.x1) / 2, south.top, (south.x0 + south.x1) / 2, south.foot, south.x1 - south.x0);
  ramp(k, west.top, (west.z0 + west.z1) / 2, west.foot, (west.z0 + west.z1) / 2, west.z1 - west.z0);
  ramp(k, east.top, (east.z0 + east.z1) / 2, east.foot, (east.z0 + east.z1) / 2, east.z1 - east.z0);
  // Keel blocks to hold the dock from: concrete, waist high, kept off the Frame's way out and off the marks.
  for (let x = SLIP.x0 + 5; x < SLIP.x1 - 4; x += 6) {
    for (const z of [-87, -70, -62]) {
      const px = x + k.rand(-1, 1);
      if (!clearOf(px, z, 1.2) || (z > -78 && ((px > 82 && px < 102 && z < -76) || (px > 109 && px < 127)))) continue;
      if ((px < 101 && z < -76) || (px > 135 && z < -76)) continue;
      g.use('concrete').tint(0.5, 0.48, 0.44);
      k.block('concrete', px - 0.8, y, z - 0.6, px + 0.8, y + 1.05, z + 0.6, 0.05);
      g.use('plywood').tint(0.5, 0.38, 0.26).box(px, y + 1.15, z, 0.85, 0.1, 0.65, FACE.noBottom);
      g.tint(1);
    }
  }
  // Floods on the rim, the sign, the caisson in the harbour wall.
  for (const [x, z, yaw] of [[SLIP.x0 + 2, SLIP.z0 - 2, -Math.PI * 0.75], [SLIP.x1 - 2, SLIP.z0 - 2, Math.PI * 0.75], [SLIP.x1 + 5, SLIP.z1 - 2, Math.PI * 0.25]] as const) {
    k.mast(x, z, 0, 10, yaw, 'white', 80, 34);
  }
  // Work lights strung over the basin, so the hold is fought in light.
  for (const x of [98, 118, 138]) k.light(x, y + 7, -74, 'white', 46, 22);
  bulbs(k, SLIP.x0, 1.2, -74, SLIP.x1, 1.2, -74, 'emissiveOrange', 0);
  signPanel(k, 131, 3.2, SLIP.z1 + 0.4, 0, 4, 1, signId('DRY DOCK'));
  k.geo.use('steelDark').cyl(131, 0, SLIP.z1 + 0.3, 131, 2.6, SLIP.z1 + 0.3, 0.08, 0.08, 6, false, true);
  g.use('rust').tint(0.55);
  g.bevel(118, HARBOUR.walk / 2 + 0.3, HARBOUR.z1 + 0.05, 9, HARBOUR.walk / 2 + 0.3, 0.12, 0.05);
  g.tint(1);
  // The 14th's way in: the south ramp. Barrels at the foot of the east one.
  site.spec.barrels(140, y, -84, 3);
}

// -------------------------------------------------------------------------------------------------
// The harbour
// -------------------------------------------------------------------------------------------------

function harbour(k: Kit, site: Site): void {
  const g = k.geo, h = HARBOUR, f = FLAK, x0 = WEST_X, x1 = SEA.eastX;
  const fx = (f.x0 + f.x1) / 2, fz = (f.z0 + f.z1) / 2;
  // The sea wall beside the Flak Tower: split cleanly around FLAK so the runtime physics FlakTower owns x: 12..28.
  g.use('concrete').tint(0.62, 0.6, 0.56);
  for (const [ax, bx] of [[x0, f.x0], [f.x1, x1]] as const) {
    k.mass('concrete', ax, 0, h.z0 + 0.8, bx, h.walk, h.z1, 4);
    k.mass('concrete', ax, 0, h.z0, bx, h.walk + h.parapet, h.z0 + 0.8, 4);
  }
  g.use('concreteDark').tint(0.5).box((x0 + x1) / 2, (SEA.y + 0) / 2, h.z0 - 0.01, (x1 - x0) / 2, -SEA.y / 2, 0.01, FACE.nz);
  g.tint(1);
  site.plan.walls.push({ ax: x0, az: (h.z0 + h.z1) / 2, bx: x1, bz: (h.z0 + h.z1) / 2, half: (h.z1 - h.z0) / 2 });
  for (const sx of HARBOUR_STAIRS) site.stairs(sx, h.z1 + 1.3, 0, sx + 7, h.z1 + 1.3, h.walk, 2.6, 'concrete', true);
  for (let x = x0 + 8; x < x1; x += 22) {
    k.light(x, h.walk + 3, h.z1 + 1, 'white', 22, 14);
    if (x + 3 < f.x0 - 1 || x + 3 > f.x1 + 1) {
      flag(k, x + 3, h.walk + h.parapet, h.z0 + 0.4, 3.2, 0.5, DYES[Math.abs(Math.round(x)) % DYES.length]!);
    }
  }
  // Flak Tower concrete mass & 4 AA guns are built at runtime by FlakTower (src/enemies/vehicles/flakTower.ts).
  // Keep its lighting and minimap footprint here so the tower is dramatically lit until flattened.
  k.light(fx, f.top + 2, fz, 'red', 30, 16);
  k.light(fx, 8, f.z1 + 4, 'orange', 30, 16);
  for (const [lx, lz] of [[f.x1 + 3, f.z1 + 3], [f.x0 - 3, f.z1 + 3]] as const) k.light(lx, 2, lz, 'white', 40, 22);
  site.plan.blocks.push({ x0: f.x0, z0: f.z0, x1: f.x1, z1: f.z1 });
}

/** The boat shed: an open steel frame with half its roof gone, a rusting hull on its slipway. */
function shed(k: Kit, site: Site): void {
  const s = SHED, g = k.geo;
  for (let z = s.z0; z <= s.z1 + 0.1; z += (s.z1 - s.z0) / 4) {
    for (const x of [s.x0, s.x1]) {
      g.use('steelDark').tint(0.8).box(x, s.h / 2, z, 0.3, s.h / 2, 0.3, FACE.sides);
      k.collide(x, s.h / 2, z, 0.3, s.h / 2, 0.3, 'metal', false);
    }
    k.truss(s.x0, s.h, z, s.x1, s.h, z, 1.6, 0, 'steelDark', 0.12);
  }
  g.tint(1);
  for (let x = s.x0; x < s.x1; x += 4) {
    if (k.rng() < 0.4) continue;
    g.use('rust').tint(0.6 + k.rng() * 0.3).box(x + 2, s.h + 0.9, (s.z0 + s.z1) / 2, 1.95, 0.04, (s.z1 - s.z0) / 2, FACE.py | FACE.ny);
  }
  g.tint(1);
  hull(k, (s.x0 + s.x1) / 2, 0.4, (s.z0 + s.z1) / 2, Math.PI / 2, 24, 7.5, 0.05);
  for (const z of [-86, -78, -70]) g.use('plywood').tint(0.4, 0.32, 0.24).box((s.x0 + s.x1) / 2, 0.2, z, 1.2, 0.2, 0.8, FACE.noBottom);
  g.tint(1);
  bulbs(k, s.x0, s.h - 1, s.z1 - 1, s.x1, s.h - 1, s.z1 - 1, 'emissiveOrange', 14);
  site.plan.blocks.push({ x0: s.x0 + 6, z0: s.z0 + 2, x1: s.x1 - 6, z1: s.z1 - 2 });
}

/** Enterable Tier-1 masonry garrison barracks in the Stacks, Cannery yard, and Harbour apron. */
function yardBarracks(site: Site): void {
  for (const b of BARRACKS) {
    if (b.tag === 'barracks.flats' || b.tag === 'barracks.market') continue;
    site.spec.cluster(buildBarracksCluster([b.x, 0, b.z], { tag: b.tag, yaw: b.yaw, tier: 1, label: b.label }));
    const swapped = Math.abs(Math.sin(b.yaw)) > 0.5;
    const hx = swapped ? 4 : 5.4, hz = swapped ? 5.4 : 4;
    site.plan.blocks.push({ x0: b.x - hx, z0: b.z - hz, x1: b.x + hx, z1: b.z + hz });
  }
}

export function authorYard(k: Kit, spec: MapSpec): void {
  const site = new Site(k, spec);
  stacks(k, site);
  quay(k, site);
  slip(k, site);
  harbour(k, site);
  shed(k, site);
  yardBarracks(site);
}
