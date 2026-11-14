/**
 * The three rings: destructible walls and gates on the wall line, and behind them the rampart, whose top is the catwalk. Each side is
 * authored as the north one in its own turned frame; the walls and guns go to the spec in world coordinates through `rot`.
 */
import { FACE } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { floorStencil } from '../../kit/stencil';
import { Site } from '../outpost/site';
import type { MapPlan, MapSpec } from '../spec';
import { BASTION, GUN_PAD, LEVEL, RAMPART, rampartSpan, type RingDef, RINGS, rot, STAIR, turnYaw } from './plan';

const KHAKI = [0.62, 0.55, 0.4] as const;
/** Mid-depth and full depth of the rampart, in from the wall line. */
const MID = (RAMPART.from + RAMPART.to) / 2;
const DEPTH = RAMPART.to - RAMPART.from;
const LAMP_EVERY = 18;

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

/** Earth-filled baskets: khaki fill, a wire cage on the faces you see, a top of `top` material. */
function hesco(k: Kit, x0: number, z0: number, x1: number, z1: number, y1: number, faces: number, top: 'grate' | 'none'): void {
  const g = k.geo;
  g.tint(KHAKI[0], KHAKI[1], KHAKI[2]);
  k.mass('dirt', x0, 0, z0, x1, y1, z1, 1.05, true, faces);
  g.tint(1).use('steelDark');
  const wire = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 1.05));
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      g.box(ax + (bx - ax) * f + nx * 0.012, y1 / 2, az + (bz - az) * f + nz * 0.012, 0.012, y1 / 2, 0.012, FACE.sides);
    }
    for (let y = 0.55; y < y1 - 0.2; y += 0.55) g.box((ax + bx) / 2 + nx * 0.012, y, (az + bz) / 2 + nz * 0.012, Math.abs(bx - ax) / 2 + 0.01, 0.01, Math.abs(bz - az) / 2 + 0.01, FACE.sides);
  };
  if (faces & FACE.pz) wire(x0, z1, x1, z1, 0, 1);
  if (faces & FACE.nz) wire(x0, z0, x1, z0, 0, -1);
  if (faces & FACE.px) wire(x1, z0, x1, z1, 1, 0);
  if (faces & FACE.nx) wire(x0, z0, x0, z1, -1, 0);
  if (top === 'none') return;
  // A steel deck on top, with a hazard edge on the yard side: what a catwalk looks like from below.
  g.use('grate').tint(0.86).slab((x0 + x1) / 2, y1 + 0.005, (z0 + z1) / 2, (x1 - x0) / 2, 0.005, (z1 - z0) / 2, 3, FACE.py);
  g.tint(1).use('steelDark');
  if (faces & FACE.pz) {
    g.bevel((x0 + x1) / 2, y1 - 0.06, z1 + 0.04, (x1 - x0) / 2, 0.07, 0.04, 0.02);
    g.use('hazard').box((x0 + x1) / 2, y1 + 0.012, z1 - 0.1, (x1 - x0) / 2, 0.004, 0.1, FACE.py);
  }
}

/** The rampart between two points along the side, with its rail and lamps. The rail breaks over `holes`: stair heads and ramps. */
function rampart(k: Kit, plan: MapPlan, r: RingDef, x0: number, x1: number, holes: readonly (readonly [number, number])[]): void {
  if (x1 - x0 < 0.05) return;
  const z0 = -r.half + RAMPART.from, z1 = -r.half + RAMPART.to;
  hesco(k, x0, z0, x1, z1, LEVEL.deck, FACE.pz | FACE.px | FACE.nx, 'grate');
  plan.decks.push({ x0, z0, x1, z1 });
  let u = x0 + 0.2;
  for (const [h0, h1] of [...holes].sort((a, b) => a[0] - b[0])) {
    if (h1 < u || h0 > x1) continue;
    if (h0 - u > 1) k.rail([u, LEVEL.deck, z1 - 0.06, h0, LEVEL.deck, z1 - 0.06]);
    u = Math.max(u, h1);
  }
  if (x1 - 0.2 - u > 1) k.rail([u, LEVEL.deck, z1 - 0.06, x1 - 0.2, LEVEL.deck, z1 - 0.06]);
  for (let x = x0 + LAMP_EVERY / 2; x < x1 - 2; x += LAMP_EVERY) {
    if (holes.some(([h0, h1]) => x > h0 - 2 && x < h1 + 2)) continue;
    // A caged lamp on a short post at the yard edge: it lights the deck and the yard below it.
    k.geo.use('steelDark').box(x, LEVEL.deck + 1.1, z1 - 0.25, 0.04, 1.1, 0.04, FACE.sides);
    k.push(x, LEVEL.deck + 2.2, z1 - 0.25, Math.PI);
    k.geo.use('steelDark').bevel(0, 0, 0, 0.18, 0.08, 0.18, 0.02);
    k.geo.use('emissiveOrange').box(0, -0.1, 0, 0.12, 0.03, 0.12, FACE.ny);
    k.pop();
    k.light(x, LEVEL.deck + 1.7, z1 + 0.6, 'orange', 16, 11);
  }
}

/** A corner tower: the rampart's corner raised to LEVEL.tower, sandbags on the two outer edges, a tin roof on posts and a floodlight. */
function bastion(k: Kit, site: Site, plan: MapPlan, r: RingDef): void {
  const H = r.half, a = -H + RAMPART.from, b = -H + BASTION.reach, y = LEVEL.tower;
  hesco(k, a, a, b, b, y, FACE.pz | FACE.px | FACE.nz | FACE.nx, 'grate');
  plan.blocks.push({ x0: a, z0: a, x1: b, z1: b });
  const t = 0.6;
  site.sandbags(a, a, b, a + t, 1.0, y);
  site.sandbags(a, a + t, a + t, b, 1.0, y);
  const g = k.geo;
  const top = y + BASTION.roof;
  g.use('steelDark');
  for (const px of [a + 0.15, b - 0.15]) for (const pz of [a + 0.15, b - 0.15]) g.box(px, (y + top) / 2, pz, 0.07, (top - y) / 2, 0.07, FACE.sides);
  g.use('rust').tint(0.8);
  k.push((a + b) / 2, top + 0.1, (a + b) / 2, 0, 0, 0.08);
  g.bevel(0, 0, 0, (b - a) / 2 + 0.5, 0.05, (b - a) / 2 + 0.5, 0.02);
  k.pop();
  g.tint(1);
  // A floodlight under the roof, aimed out over the corner.
  k.push(a + 0.6, top - 0.3, a + 0.6, Math.PI / 4);
  g.use('steelDark').bevel(0, 0, 0, 0.3, 0.2, 0.12, 0.03);
  g.use('emissiveWhite').box(0, 0, -0.13, 0.24, 0.15, 0.01, FACE.nz);
  k.pop();
  k.light(a - 3, top - 1, a - 3, 'white', 90, 34);
  k.light((a + b) / 2, y + 2, (a + b) / 2, 'white', 14, 7);
}

/** A raised pad for a mounted gun, so its trunnion clears the wall, with a ramp up from the catwalk at each end. */
function gunPad(k: Kit, site: Site, plan: MapPlan, r: RingDef, u: number): void {
  const z0 = -r.half + RAMPART.from, z1 = -r.half + RAMPART.to, h = GUN_PAD.half, run = GUN_PAD.ramp;
  site.mass('concrete', u - h, 0, z0, u + h, LEVEL.gun, z1, 0.9, 1.2, FACE.pz | FACE.py | FACE.px | FACE.nx);
  plan.blocks.push({ x0: u - h, z0, x1: u + h, z1 });
  k.geo.use('hazard').box(u, LEVEL.gun + 0.006, z1 - 0.1, h, 0.004, 0.1, FACE.py);
  for (const s of [-1, 1]) {
    k.ramp(u + s * (h + run), -r.half + MID, LEVEL.deck, u + s * h, -r.half + MID, LEVEL.gun, DEPTH, 'steel', 0.6, false);
  }
  k.rail([u - h, LEVEL.gun, z1 - 0.06, u + h, LEVEL.gun, z1 - 0.06]);
}

/** One side of one ring, in its own frame. */
function side(k: Kit, site: Site, spec: MapSpec, r: RingDef, i: number): void {
  const plan = spec.plan!;
  const H = r.half;
  const gates = r.gates.filter(g => g.side === i).sort((a, b) => a.u - b.u);
  const guns = r.guns.filter(g => g.side === i).map(g => g.u);
  const stairs = r.stairs.filter(s => s.side === i).map(s => s.u);
  const [left, right] = rampartSpan(r, i);
  const zMid = -H + MID;

  // Walls and gates go to the spec in world coordinates, corner to corner along the side.
  let u = -H;
  const run = (u0: number, u1: number) => {
    const [ax, az] = rot(i, u0, -H), [bx, bz] = rot(i, u1, -H);
    spec.wall(ax, az, bx, bz);
    plan.walls.push({ ax, az, bx, bz, half: 0.4 });
  };
  for (const g of gates) {
    run(u, g.u - g.w / 2);
    const [ax, az] = rot(i, g.u - g.w / 2, -H), [bx, bz] = rot(i, g.u + g.w / 2, -H);
    spec.wallGate(ax, az, bx, bz, 0, true);
    const [gx, gz] = rot(i, g.u, -H);
    const [ox, oz] = rot(i, 0, -1);
    plan.gates.push({ x: gx, z: gz, yaw: Math.atan2(-oz, ox), w: g.w - 0.8, bay: true });
    plan.doors.push({ x: gx, z: gz, dx: -ox, dz: -oz, w: g.w - 0.8 });
    u = g.u + g.w / 2;
  }
  run(u, H);

  // The rampart in pieces: cut at each gate, where stairs run down to the gate's passage.
  // Gun pads stand in for it, and ramps rise over it to them.
  const cuts: [number, number][] = [
    ...gates.map(g => [g.u - g.w / 2 - 0.4 - STAIR.gate, g.u + g.w / 2 + 0.4 + STAIR.gate] as [number, number]),
    ...guns.map(g => [g - GUN_PAD.half, g + GUN_PAD.half] as [number, number]),
  ].sort((a, b) => a[0] - b[0]);
  const holes: [number, number][] = [
    ...stairs.map(s => [s - STAIR.width / 2 - 0.1, s + STAIR.width / 2 + 0.1] as [number, number]),
    ...guns.map(g => [g - GUN_PAD.half - GUN_PAD.ramp, g + GUN_PAD.half + GUN_PAD.ramp] as [number, number]),
  ];
  let from = left;
  for (const [c0, c1] of cuts) {
    rampart(k, plan, r, from, c0, holes);
    from = c1;
  }
  rampart(k, plan, r, from, right, holes);

  for (const g of gates) {
    const near = g.w / 2 + 0.4;
    site.stairs(g.u - near - STAIR.gate, zMid, LEVEL.deck, g.u - near, zMid, 0, DEPTH, 'concrete', true);
    site.stairs(g.u + near + STAIR.gate, zMid, LEVEL.deck, g.u + near, zMid, 0, DEPTH, 'concrete', true);
    // Chevrons in the ring's colour on the way through, and a lamp over the passage.
    floorStencil(k, 'CHEVRON', g.u, -H + 2.4, Math.PI, Math.min(2.6, g.w - 1.4), r.paint, 0.014);
    k.light(g.u, 4.2, -H + 2.2, 'white', 28, 12);
  }
  // Up to the bastions at either end, from the catwalk.
  if (r.bastions.includes(i)) site.stairs(left + STAIR.tower, zMid, LEVEL.deck, left, zMid, LEVEL.tower, DEPTH, 'steel', true);
  if (r.bastions.includes((i + 1) & 3)) site.stairs(right - STAIR.tower, zMid, LEVEL.deck, right, zMid, LEVEL.tower, DEPTH, 'steel', true);
  if (r.bastions.includes(i)) bastion(k, site, plan, r);

  for (const g of guns) {
    gunPad(k, site, plan, r, g);
    const [x, z] = rot(i, g, -H + GUN_PAD.back);
    spec.emplacement(x, LEVEL.gun, z, turnYaw(i), 1.15);
  }
  for (const s of stairs) site.stairs(s, -H + RAMPART.to + STAIR.yard, 0, s, -H + RAMPART.to, LEVEL.deck, STAIR.width, 'concrete', true);
}

export function authorRings(k: Kit, spec: MapSpec): void {
  const site = new Site(k, spec);
  for (const r of RINGS) for (let i = 0; i < 4; i++) onSide(k, spec.plan!, i, () => side(k, site, spec, r, i));
}
