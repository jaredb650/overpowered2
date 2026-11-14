/**
 * The three rings: destructible battlements and lift gates on the wall line, and behind them the catwalk, a steel gantry on posts.
 * Guard towers in the corners, a roofed gatehouse on the bridge over every gate, a pillbox inside each outer and middle gate, and the
 * mounted guns on concrete blockhouses with a port in the wall in front. Each side is authored as the north one in its own turned frame;
 * the walls and guns go to the spec in world coordinates through `rot`.
 */
import { FACE } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { signPanel } from '../../kit/props';
import { signId } from '../../kit/signs';
import { floorStencil, stencil } from '../../kit/stencil';
import { Site } from '../outpost/site';
import type { MapPlan, MapSpec } from '../spec';
import {
  BASTION, FORT_PORT, FORT_WALL, GUN_PAD, LEVEL, RAMPART, rampartSpan, type RingDef, RINGS, rot, STAIR, turnYaw, wallRuns,
} from './plan';

/** Mid-depth and full depth of the catwalk, in from the wall line. */
const MID = (RAMPART.from + RAMPART.to) / 2;
const DEPTH = RAMPART.to - RAMPART.from;
const LAMP_EVERY = 20;
const POST_EVERY = 4;
/** A gate's piers: concrete either side of its passage under the bridge, this thick. */
const PIER = 0.8;

/** Runs `fn` in side `i`'s frame, then turns whatever it added to the minimap into world coordinates. */
export function onSide(k: Kit, plan: MapPlan, i: number, fn: () => void): void {
  const marks = { blocks: plan.blocks.length, decks: plan.decks.length };
  k.push(0, 0, 0, (-i * Math.PI) / 2);
  fn();
  k.pop();
  for (const list of [plan.blocks, plan.decks]) {
    const from = list === plan.blocks ? marks.blocks : marks.decks;
    for (let n = from; n < list.length; n++) {
      const r = list[n]!;
      const [ax, az] = rot(i, r.x0, r.z0), [bx, bz] = rot(i, r.x1, r.z1);
      list[n] = { x0: Math.min(ax, bx), z0: Math.min(az, bz), x1: Math.max(ax, bx), z1: Math.max(az, bz) };
    }
  }
}

const near = (u: number, spans: readonly (readonly [number, number])[], pad = 0) => spans.some(([a, b]) => u > a - pad && u < b + pad);

/**
 * The catwalk from x0 to x1: a grate deck on cross beams, an edge girder on the yard side carried by posts every few metres, a rail and
 * a hazard edge on top, lamps on short posts. `holes` break the rail (stair heads, ramps); `open` spans have no posts under them
 * (gate passages, stair feet); the deck runs on over them.
 */
function gantry(k: Kit, plan: MapPlan, r: RingDef, x0: number, x1: number, holes: readonly (readonly [number, number])[], open: readonly (readonly [number, number])[]): void {
  if (x1 - x0 < 0.05) return;
  const g = k.geo, y = LEVEL.deck;
  const z0 = -r.half + RAMPART.from, z1 = -r.half + RAMPART.to, zm = (z0 + z1) / 2;
  g.use('grate').tint(0.86).slab((x0 + x1) / 2, y - 0.03, zm, (x1 - x0) / 2, 0.03, DEPTH / 2, 3, FACE.py | FACE.ny);
  g.tint(1).use('steelDark');
  // The girder on the yard side, a lighter one on the wall side, and cross beams under the grate.
  g.bevel((x0 + x1) / 2, y - 0.22, z1 - 0.08, (x1 - x0) / 2, 0.22, 0.08, 0.02);
  g.bevel((x0 + x1) / 2, y - 0.14, z0 + 0.06, (x1 - x0) / 2, 0.12, 0.06, 0.02);
  for (let u = x0 + 0.6; u < x1; u += 2) g.box(u, y - 0.12, zm, 0.05, 0.09, DEPTH / 2 - 0.1, FACE.ny | FACE.px | FACE.nx);
  // A cable tray under the girder: the base's comms run round every wall.
  g.use('rubber').tint(0.5).box((x0 + x1) / 2, y - 0.5, z1 - 0.22, (x1 - x0) / 2, 0.05, 0.08, FACE.ny | FACE.pz | FACE.py);
  g.tint(1).use('hazard').box((x0 + x1) / 2, y + 0.004, z1 - 0.12, (x1 - x0) / 2, 0.004, 0.12, FACE.py);
  k.collide((x0 + x1) / 2, y - 0.15, zm, (x1 - x0) / 2, 0.15, DEPTH / 2, 'metal', false);
  plan.decks.push({ x0, z0, x1, z1 });
  // Posts with knee braces, clear of the gate passages.
  const n = Math.max(1, Math.round((x1 - x0) / POST_EVERY));
  for (let i = 0; i <= n; i++) {
    const u = x0 + ((x1 - x0) * i) / n;
    if (near(u, open, 0.3)) continue;
    const pu = Math.min(x1 - 0.1, Math.max(x0 + 0.1, u));
    g.use('steelDark').bevel(pu, y / 2 - 0.2, z1 - 0.1, 0.1, y / 2 - 0.2, 0.1, 0.02);
    g.use('concreteDark').bevel(pu, 0.1, z1 - 0.1, 0.22, 0.1, 0.22, 0.03);
    k.beam(pu, y - 1.3, z1 - 0.1, pu, y - 0.3, z0 + 0.5, 0.04, 0.04);
    k.collide(pu, y / 2 - 0.2, z1 - 0.1, 0.1, y / 2 - 0.2, 0.1, 'metal', false);
  }
  let u = x0 + 0.2;
  for (const [h0, h1] of [...holes].sort((a, b) => a[0] - b[0])) {
    if (h1 < u || h0 > x1) continue;
    if (h0 - u > 1) k.rail([u, y, z1 - 0.06, h0, y, z1 - 0.06]);
    u = Math.max(u, h1);
  }
  if (x1 - 0.2 - u > 1) k.rail([u, y, z1 - 0.06, x1 - 0.2, y, z1 - 0.06]);
  for (let x = x0 + LAMP_EVERY / 2; x < x1 - 2; x += LAMP_EVERY) {
    if (near(x, holes, 2) || near(x, open, 2)) continue;
    // A caged lamp on a short post at the yard edge: it lights the deck and the yard below it.
    g.use('steelDark').box(x, y + 1.1, z1 - 0.25, 0.04, 1.1, 0.04, FACE.sides);
    k.push(x, y + 2.2, z1 - 0.25, Math.PI);
    g.use('steelDark').bevel(0, 0, 0, 0.18, 0.08, 0.18, 0.02);
    g.use('emissiveWhite').box(0, -0.1, 0, 0.12, 0.03, 0.12, FACE.ny);
    k.pop();
    k.light(x, y + 1.7, z1 + 0.8, 'white', 9, 12);
  }
}

/**
 * A corner guard tower: a concrete block raised to LEVEL.tower, a cabin on top with breast-high walls, windows all round under a
 * concrete lintel on the two outer faces and a tin roof, and a floodlight out over the corner. Stairs come up from both catwalks
 * through the gaps in the inner faces.
 */
function guardTower(k: Kit, site: Site, plan: MapPlan, r: RingDef): void {
  const H = r.half, a = -H + RAMPART.from, b = -H + BASTION.reach, y = LEVEL.tower, g = k.geo;
  const top = y + BASTION.roof, sill = y + 1.1, lintel = y + 2.15, t = 0.25, gap = -H + RAMPART.to + 0.1;
  site.mass('concrete', a, 0, a, b, y, b, 0.78, 2.4, FACE.pz | FACE.px | FACE.py);
  plan.blocks.push({ x0: a, z0: a, x1: b, z1: b });
  g.use('concrete').tint(0.7);
  // Breast walls: the two outer faces whole, the inner faces only past the stair heads.
  k.block('concrete', a, y, a, b, sill, a + t, 0.03);
  k.block('concrete', a, y, a + t, a + t, sill, b, 0.03);
  k.block('concrete', gap, y, b - t, b, sill, b, 0.03);
  k.block('concrete', b - t, y, gap, b, sill, b - t, 0.03);
  // Lintels over the outer windows, and the posts between.
  k.block('concrete', a, lintel, a, b, top, a + t, 0.03);
  k.block('concrete', a, lintel, a + t, a + t, top, b, 0.03);
  g.tint(1).use('steelDark');
  for (const [px, pz] of [[a + 0.12, a + 0.12], [b - 0.12, a + 0.12], [a + 0.12, b - 0.12], [b - 0.12, b - 0.12], [(a + b) / 2, a + 0.12], [a + 0.12, (a + b) / 2]] as const) {
    g.bevel(px, (y + top) / 2, pz, 0.08, (top - y) / 2, 0.08, 0.02);
    k.collide(px, (sill + lintel) / 2, pz, 0.08, (lintel - sill) / 2, 0.08, 'metal', false);
  }
  // Window frames on the sills, dark glassless openings.
  g.use('steelDark').box((a + b) / 2, sill + 0.03, a + t / 2, (b - a) / 2, 0.03, t / 2 + 0.03, FACE.py | FACE.pz | FACE.nz);
  g.box(a + t / 2, sill + 0.03, (a + b) / 2, t / 2 + 0.03, 0.03, (b - a) / 2, FACE.py | FACE.px | FACE.nx);
  // The roof, its eaves past the walls.
  g.use('rust').tint(0.62);
  k.push((a + b) / 2, top + 0.08, (a + b) / 2, 0, 0.05, 0.05);
  g.bevel(0, 0, 0, (b - a) / 2 + 0.55, 0.07, (b - a) / 2 + 0.55, 0.02);
  k.pop();
  g.tint(1);
  k.collide((a + b) / 2, top + 0.08, (a + b) / 2, (b - a) / 2 + 0.4, 0.08, (b - a) / 2 + 0.4, 'metal', false);
  g.use('concreteDark').tint(0.8).slab((a + b) / 2, y + 0.005, (a + b) / 2, (b - a) / 2 - 0.05, 0.005, (b - a) / 2 - 0.05, 1.5, FACE.py);
  g.tint(1);
  // Sandbags in the corner window, a rifle's rest.
  site.sandbags(a + t, a + t, a + 1.2, a + 1.2, 0.5, y);
  // A floodlight on the roof's edge, aimed out over the corner, and the cabin's own lamp.
  k.push(a + 0.3, top + 0.4, a + 0.3, Math.PI / 4);
  g.use('steelDark').bevel(0, 0, 0, 0.34, 0.24, 0.14, 0.03);
  g.use('emissiveWhite').box(0, 0, -0.15, 0.27, 0.18, 0.01, FACE.nz);
  k.pop();
  k.light(a - 4, top - 1.5, a - 4, 'white', 90, 34);
  k.light((a + b) / 2, y + 2, (a + b) / 2, 'white', 10, 6);
  // Hazard bands up the block's yard corner, and its number.
  g.use('hazard').box(b + 0.01, 1.2, b - 0.4, 0.004, 1.2, 0.4, FACE.px);
  g.box(b - 0.4, 1.2, b + 0.01, 0.4, 1.2, 0.004, FACE.pz);
  k.push((a + b) / 2, 0, b + 0.012, 0);
  stencil(k, 'EYES UP', 0, 2.4, 0, 0.5, [0.85, 0.82, 0.7]);
  k.pop();
}

/** A gun's concrete blockhouse under the catwalk, its top the firing step, with ramps up from the deck each end and sandbagged cheeks. */
function gunPost(k: Kit, site: Site, plan: MapPlan, r: RingDef, u: number): void {
  const z0 = -r.half + RAMPART.from, z1 = -r.half + RAMPART.to, h = GUN_PAD.half, run = GUN_PAD.ramp, g = k.geo;
  site.mass('concrete', u - h, 0, z0, u + h, LEVEL.gun, z1, 0.86, 1.2, FACE.pz | FACE.py | FACE.px | FACE.nx);
  plan.blocks.push({ x0: u - h, z0, x1: u + h, z1 });
  g.use('hazard').box(u, LEVEL.gun + 0.006, z1 - 0.1, h, 0.004, 0.1, FACE.py);
  for (const s of [-1, 1]) {
    k.ramp(u + s * (h + run), -r.half + MID, LEVEL.deck, u + s * h, -r.half + MID, LEVEL.gun, DEPTH, 'steel', 0.4, false);
    // Sandbags either side of the gun, against the port's pillars.
    site.sandbags(s < 0 ? u - h : u + h - 0.65, z0, s < 0 ? u - h + 0.65 : u + h, z0 + 1.1, 0.9, LEVEL.gun);
  }
  k.rail([u - h, LEVEL.gun, z1 - 0.06, u + h, LEVEL.gun, z1 - 0.06]);
  // An ammunition box on the step, the blockhouse's door, its number and a warning.
  site.crate(u + 0.7, z1 - 0.9, u + 1.3, z1 - 0.45, 0.4, [0.38, 0.42, 0.28], LEVEL.gun);
  g.use('steelDark').bevel(u - 0.9, 1.05, z1 + 0.03, 0.5, 1.05, 0.03, 0.02);
  g.use('hazard').box(u - 0.9, 2.18, z1 + 0.065, 0.58, 0.06, 0.005, FACE.pz);
  k.push(u + 0.6, 0, z1 + 0.012, 0);
  stencil(k, 'LIVE FIRE', 0, 2.9, 0, 0.42, [0.9, 0.3, 0.2]);
  k.pop();
}

/**
 * A gatehouse: concrete piers either side of the passage carry the bridge, and on the bridge a roof on posts, sandbags on its yard
 * edge, the gate's sign and a floodlight down the approach.
 */
function gatehouse(k: Kit, site: Site, plan: MapPlan, r: RingDef, gu: number, w: number, n: number): void {
  const H = r.half, z0 = -H + RAMPART.from, z1 = -H + RAMPART.to, y = LEVEL.deck, g = k.geo;
  const p0 = gu - w / 2 - 0.5, p1 = gu + w / 2 + 0.5;
  for (const [a, b] of [[p0 - PIER, p0], [p1, p1 + PIER]] as const) {
    site.mass('concrete', a, 0, z0, b, y - 0.3, z1, 0.72, 1.2, FACE.pz | FACE.px | FACE.nx);
    plan.blocks.push({ x0: a, z0, x1: b, z1 });
    g.use('hazard');
    for (const x of [a - 0.005, b + 0.005]) g.box(x, 0.6, (z0 + z1) / 2, 0.004, 0.6, DEPTH / 2, x < a ? FACE.nx : FACE.px);
  }
  // A heavier girder under the bridge's yard edge.
  g.use('steelDark').bevel(gu, y - 0.4, z1 - 0.12, p1 - gu + PIER, 0.12, 0.14, 0.03);
  // The roof stands on posts against the wall and is braced out over the walk, which keeps its whole width.
  const ra = p0 - PIER / 2, rb = p1 + PIER / 2, top = y + 2.6;
  for (const x of [ra, rb]) {
    g.use('steelDark').bevel(x, (y + top) / 2, z0 + 0.12, 0.08, (top - y) / 2, 0.08, 0.02);
    k.collide(x, (y + top) / 2, z0 + 0.12, 0.08, (top - y) / 2, 0.08, 'metal', false);
    k.beam(x, top - 1.1, z0 + 0.12, x, top - 0.05, z1 + 0.2, 0.04, 0.04);
  }
  g.use('rust').tint(0.7).bevel(gu, top + 0.06, (z0 + z1) / 2, (rb - ra) / 2 + 0.35, 0.06, DEPTH / 2 + 0.35, 0.02);
  g.tint(1);
  k.collide(gu, top + 0.06, (z0 + z1) / 2, (rb - ra) / 2 + 0.3, 0.06, DEPTH / 2 + 0.3, 'metal', false);
  // A steel kick plate along the bridge's yard edge, hazard striped: the walk over it stays the catwalk's full width.
  g.use('steelDark').box(gu, y + 0.35, z1 - 0.03, p1 - gu + 0.4, 0.35, 0.03, FACE.pz | FACE.nz | FACE.py);
  g.use('hazard').box(gu, y + 0.55, z1 + 0.002, p1 - gu + 0.4, 0.1, 0.002, FACE.pz);
  signPanel(k, gu, top - 0.55, z1 + 0.3, 0, 3.2, 0.8, signId(`GATE ${n}` as never), true);
  k.light(gu, top - 0.4, z1 - 1, 'white', 16, 9);
  // Down the passage and out over the approach.
  k.push(gu, top - 0.2, z0 + 0.3, 0);
  g.use('steelDark').bevel(0, 0, 0, 0.32, 0.22, 0.14, 0.03);
  g.use('emissiveWhite').box(0, 0, -0.15, 0.25, 0.16, 0.01, FACE.nz);
  k.pop();
  k.light(gu, 4, -H - 9, 'white', 70, 26);
  k.light(gu, 3.4, -H + 1.6, 'white', 24, 11);
  floorStencil(k, 'CHEVRON', gu, -H + 2, Math.PI, Math.min(2.6, w - 1.4), r.paint, 0.014);
  floorStencil(k, String(n) as never, gu, -H + 5.5, Math.PI, 1.6, [0.86, 0.84, 0.76], 0.014);
}

/**
 * A concrete pillbox in the yard, its slits on the gate: a man inside covers anything coming through, and the door is at the back.
 * `face` turns its front toward the passage.
 */
export function pillbox(k: Kit, site: Site, plan: MapPlan, x: number, z: number, face: number): void {
  const g = k.geo, hx = 1.7, hz = 1.5, h = 2.3, t = 0.35, s0 = 1.15, s1 = 1.45, from = plan.blocks.length;
  k.push(x, 0, z, face);
  g.tint(0.74);
  // Front: below the slit, the slit's ends, over it. Back: either side of the door, over it. Ends: whole.
  k.block('concrete', -hx, 0, -hz, hx, s0, -hz + t, 0.04);
  k.block('concrete', -hx, s0, -hz, -hx + 0.5, s1, -hz + t, 0.02);
  k.block('concrete', hx - 0.5, s0, -hz, hx, s1, -hz + t, 0.02);
  k.block('concrete', -0.1, s0, -hz, 0.1, s1, -hz + t, 0.02);
  k.block('concrete', -hx, s1, -hz, hx, h, -hz + t, 0.04);
  k.block('concrete', -hx, 0, hz - t, -0.5, h, hz, 0.04);
  k.block('concrete', 0.5, 0, hz - t, hx, h, hz, 0.04);
  k.block('concrete', -0.5, 2, hz - t, 0.5, h, hz, 0.02);
  for (const s of [-1, 1]) {
    k.block('concrete', s < 0 ? -hx : hx - t, 0, -hz + t, s < 0 ? -hx + t : hx, s0, hz - t, 0.04);
    k.block('concrete', s < 0 ? -hx : hx - t, s0, -hz + t, s < 0 ? -hx + t : hx, s1, -hz + 1.0, 0.02);
    k.block('concrete', s < 0 ? -hx : hx - t, s0, -hz + 1.5, s < 0 ? -hx + t : hx, s1, hz - t, 0.02);
    k.block('concrete', s < 0 ? -hx : hx - t, s1, -hz + t, s < 0 ? -hx + t : hx, h, hz - t, 0.02);
  }
  g.tint(0.62);
  k.block('concrete', -hx - 0.2, h, -hz - 0.2, hx + 0.2, h + 0.3, hz + 0.2, 0.06);
  g.tint(1);
  site.sandbags(-hx - 0.1, -hz - 0.7, hx + 0.1, -hz, 0.7);
  g.use('hazard').box(0, 2.15, hz + 0.01, 0.5, 0.06, 0.005, FACE.pz);
  k.light(0, 1.9, 0, 'orange', 6, 4);
  k.pop();
  plan.blocks.length = from;
  const c = Math.abs(Math.cos(face)), sn = Math.abs(Math.sin(face)), ex = hx * c + hz * sn, ez = hx * sn + hz * c;
  plan.blocks.push({ x0: x - ex, z0: z - ez, x1: x + ex, z1: z + ez });
}

/** One side of one ring, in its own frame. */
function side(k: Kit, site: Site, spec: MapSpec, r: RingDef, i: number): void {
  const plan = spec.plan!;
  const H = r.half;
  const gates = r.gates.filter(g => g.side === i).sort((a, b) => a.u - b.u);
  const guns = r.guns.filter(g => g.side === i).map(g => g.u);
  const stairs = r.stairs.filter(s => s.side === i).map(s => s.u);
  const [left, right] = rampartSpan(r, i);
  const zMid = -H + MID, inner = -H + RAMPART.to;

  // Walls and gates go to the spec in world coordinates, corner to corner along the side. Battlements first, so every pillar is a tall one.
  const runs = wallRuns(r, i);
  for (const run of [...runs.filter(x => x.kind === 'wall'), ...runs.filter(x => x.kind !== 'wall')]) {
    const [ax, az] = rot(i, run.u0, -H), [bx, bz] = rot(i, run.u1, -H);
    if (run.kind === 'gate') {
      spec.wallGate(ax, az, bx, bz, 0, true, FORT_WALL);
      const gu = (run.u0 + run.u1) / 2, w = run.u1 - run.u0;
      const [gx, gz] = rot(i, gu, -H), [ox, oz] = rot(i, 0, -1);
      plan.gates.push({ x: gx, z: gz, yaw: Math.atan2(-oz, ox), w: w - 1, bay: true });
      plan.doors.push({ x: gx, z: gz, dx: -ox, dz: -oz, w: w - 1 });
    } else {
      spec.wall(ax, az, bx, bz, 0, run.kind === 'port' ? FORT_PORT : FORT_WALL);
      plan.walls.push({ ax, az, bx, bz, half: FORT_WALL.thick / 2 + 0.05 });
    }
  }

  // Yard stairs: the ring's own, and one on the left of every gate, clear of its pier.
  const gateStairs = gates.map(g => g.u - g.w / 2 - 0.5 - PIER - 0.4 - STAIR.width / 2);
  const allStairs = [...stairs, ...gateStairs];
  const holes: [number, number][] = [
    ...allStairs.map(s => [s - STAIR.width / 2 - 0.1, s + STAIR.width / 2 + 0.1] as [number, number]),
    ...guns.map(g => [g - GUN_PAD.half - GUN_PAD.ramp, g + GUN_PAD.half + GUN_PAD.ramp] as [number, number]),
  ];
  const open: [number, number][] = [
    ...gates.map(g => [g.u - g.w / 2 - 0.5 - PIER, g.u + g.w / 2 + 0.5 + PIER] as [number, number]),
    ...allStairs.map(s => [s - STAIR.width / 2, s + STAIR.width / 2] as [number, number]),
  ];
  // The catwalk in pieces: the gun blockhouses stand in for it.
  let from = left;
  for (const gu of [...guns].sort((a, b) => a - b)) {
    gantry(k, plan, r, from, gu - GUN_PAD.half, holes, open);
    from = gu + GUN_PAD.half;
  }
  gantry(k, plan, r, from, right, holes, open);

  for (const s of allStairs) site.stairs(s, inner + STAIR.yard, 0, s, inner, LEVEL.deck, STAIR.width, 'concrete', true);
  gates.forEach(g => {
    const n = r.id === 'outer' ? i + 1 : r.id === 'middle' ? (i === 0 ? 5 : 6) : i === 1 ? 7 : 8;
    gatehouse(k, site, plan, r, g.u, g.w, n);
    // A pillbox inside each outer and middle gate, on the right of the passage, its slits across it.
    if (r.id !== 'core') pillbox(k, site, plan, g.u + g.w / 2 + 4.6, inner + 4.2, 1.0);
  });
  // Up to the towers at either end, from the catwalk.
  // Open steel flights: a solid one would fill the space under the catwalk.
  if (r.bastions.includes(i)) k.stairs(left + STAIR.tower, zMid, LEVEL.deck, left, zMid, LEVEL.tower, STAIR.width, 'steel', true);
  if (r.bastions.includes((i + 1) & 3)) k.stairs(right - STAIR.tower, zMid, LEVEL.deck, right, zMid, LEVEL.tower, STAIR.width, 'steel', true);
  if (r.bastions.includes(i)) guardTower(k, site, plan, r);

  for (const g of guns) {
    gunPost(k, site, plan, r, g);
    const [x, z] = rot(i, g, -H + GUN_PAD.back);
    spec.emplacement(x, LEVEL.gun, z, turnYaw(i), 1.15);
  }
  // The ring's colour on the yard face of the catwalk girder, so you know which wall you are under.
  k.geo.use('paintWhite').tint(r.paint[0], r.paint[1], r.paint[2]);
  k.geo.box((left + right) / 2, LEVEL.deck - 0.3, inner + 0.005, (right - left) / 2, 0.08, 0.004, FACE.pz);
  k.geo.tint(1);
}

export function authorRings(k: Kit, spec: MapSpec): void {
  const site = new Site(k, spec);
  for (const r of RINGS) for (let i = 0; i < 4; i++) onSide(k, spec.plan!, i, () => side(k, site, spec, r, i));
}
