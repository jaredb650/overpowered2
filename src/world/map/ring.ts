/**
 * Ring Road: the elevated speed loop. A rounded square at 14 m with banked corners, a continuous outer wall to run
 * on and a colonnade underneath that doubles as a ground-level loop. Stations travel clockwise from above, which
 * keeps the local right vector pointing outward.
 */
import { smoothstep } from '../../core/math';
import type { Kit } from '../kit/kit';
import { FACE } from '../kit/geo';
import { barrier, cable, rebar, rubble, signPanel, truck, vent } from '../kit/props';
import { signId, type SignName } from '../kit/signs';
import type { MapSpec } from './spec';
import { LEVEL, RING } from './layout';

const BANK = 0.14;
const HALF_W = RING.width / 2;
const CC = RING.half - RING.corner;
/** The collapsed span on the south straight. */
export const GAP = { x0: -9, x1: 9 } as const;

interface Station { x: number; y: number; z: number; ox: number; oz: number; bank: number; dist: number; corner: boolean }

/** Each run is a section of road without a break. */
function stations(): Station[][] {
  const runs: Station[][] = [];
  let run: Station[] = [];
  let dist = 0;
  let lx = NaN, lz = NaN;
  const add = (x: number, z: number, ox: number, oz: number, bank: number, corner: boolean) => {
    if (!Number.isNaN(lx)) dist += Math.hypot(x - lx, z - lz);
    lx = x; lz = z;
    run.push({ x, y: LEVEL.ring + HALF_W * Math.sin(bank), z, ox, oz, bank, dist, corner });
  };
  const straight = (ax: number, az: number, bx: number, bz: number, ox: number, oz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(len / 8);
    for (let i = 0; i < n; i++) add(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n, ox, oz, 0, false);
  };
  const corner = (cx: number, cz: number, a0: number) => {
    const n = 18;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const a = a0 + t * Math.PI / 2;
      const bank = BANK * smoothstep(0, 0.35, t) * (1 - smoothstep(0.65, 1, t));
      add(cx + Math.cos(a) * RING.corner, cz + Math.sin(a) * RING.corner, Math.cos(a), Math.sin(a), bank, true);
    }
  };
  const H = RING.half;
  straight(H, -CC, H, CC, 1, 0);
  corner(CC, CC, 0);
  straight(CC, H, GAP.x1, H, 0, 1);
  add(GAP.x1, H, 0, 1, 0, false);
  runs.push(run);
  run = [];
  lx = NaN;
  straight(GAP.x0, H, -CC, H, 0, 1);
  corner(-CC, CC, Math.PI / 2);
  straight(-H, CC, -H, -CC, -1, 0);
  corner(-CC, -CC, Math.PI);
  straight(-CC, -H, CC, -H, 0, -1);
  corner(CC, -CC, Math.PI * 1.5);
  add(H, -CC, 1, 0, 0, false);
  runs.push(run);
  return runs;
}

function frames(run: Station[]): Float64Array {
  const f = new Float64Array(run.length * 10);
  run.forEach((s, i) => {
    const c = Math.cos(s.bank), n = Math.sin(s.bank);
    f.set([s.x, s.y, s.z, s.ox * c, n, s.oz * c, -s.ox * n, c, -s.oz * n, s.dist], i * 10);
  });
  return f;
}

const offset = (s: Station, side: number, up = 0): [number, number, number] => {
  const c = Math.cos(s.bank), n = Math.sin(s.bank);
  return [s.x + s.ox * c * side - s.ox * n * up, s.y + n * side + c * up, s.z + s.oz * c * side - s.oz * n * up];
};

export function authorRing(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const runs = stations();
  const H = RING.half;

  for (const run of runs) {
    const fr = frames(run);
    g.use('asphalt').sweep(fr, [-HALF_W, 0, -4.5, 0, 0, 0, 4.5, 0, HALF_W, 0]);
    // Box girder under the deck.
    g.use('concreteDark').sweep(fr, [HALF_W, -0.1, 7.4, -1.7, -7.4, -1.7, -HALF_W, -0.1]);
    g.use('concrete').sweep(fr, [-HALF_W - 0.5, -0.3, -HALF_W - 0.5, 0.95, -HALF_W - 0.25, 1.05, -HALF_W + 0.05, 1.05, -HALF_W + 0.25, 0.25, -HALF_W + 0.5, 0]);
    g.use('steelDark').sweep(fr, [HALF_W - 0.4, 0, HALF_W - 0.4, 0.25, HALF_W + 0.5, 0.25]);
    g.use('emissiveCyan').sweep(fr, [-HALF_W - 0.14, 1.07, -HALF_W + 0.14, 1.07]);

    // Deck collider: one trimesh per run, no seams to catch a sliding capsule.
    const v = new Float32Array(run.length * 6);
    const idx: number[] = [];
    run.forEach((s, i) => {
      v.set(offset(s, -HALF_W), i * 6);
      v.set(offset(s, HALF_W + 0.5), i * 6 + 3);
      if (i < run.length - 1) {
        const a = i * 2;
        idx.push(a, a + 3, a + 1, a, a + 2, a + 3);
      }
    });
    k.collideMesh(v, new Uint32Array(idx), 'concrete');

    // Inner barrier collider, opened where the viaducts join, plus lane paint and fixtures.
    let nextPier = 0, nextLamp = 0;
    for (let i = 0; i < run.length - 1; i++) {
      const s = run[i]!, e = run[i + 1]!;
      const isJunction = s.corner && Math.abs(s.bank - BANK) < 0.02;
      if (!isJunction) {
        const a = offset(s, -HALF_W - 0.1, 0.5), b = offset(e, -HALF_W - 0.1, 0.5);
        k.along(a[0], a[1], a[2], b[0], b[1], b[2], len => k.collide(len / 2, 0, 0, len / 2 + 0.25, 0.55, 0.42, 'concrete'));
      }
      if (i % 2 === 0) {
        const a = offset(s, 0, 0.03), b = offset(e, 0, 0.03);
        const f = 0.55;
        k.along(a[0], a[1], a[2], a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, len => {
          g.use('paintWhite').tint(0.75).quad(0, 0, 0.11, len, 0, 0.11, len, 0, -0.11, 0, 0, -0.11);
          g.tint(1);
        });
      }
      if (s.dist >= nextPier) {
        nextPier = s.dist + 22;
        pier(k, s);
      }
      if (s.dist >= nextLamp) {
        nextLamp = s.dist + 44;
        lamp(k, s);
      }
    }
  }

  // Outer wall, from the ground to well above the deck: the longest wall-run on the map.
  const wall = H + HALF_W + 1;
  const strip = { mat: 'emissiveCyan' as const, y: LEVEL.ring + 2.2, h: 0.18 };
  const wo = { thick: 1.6, bay: 11, lift: 3.5, strip, mat: 'concrete' as const };
  const top = RING.wallTop;
  k.wall(wall, -CC, wall, CC, 0, top, wo);
  k.wall(CC, wall, -CC, wall, 0, top, wo);
  k.wall(-wall, CC, -wall, -CC, 0, top, wo);
  k.wall(-CC, -wall, CC, -wall, 0, top, wo);
  const R = RING.corner + HALF_W + 1;
  for (let q = 0; q < 4; q++) {
    const cx = q === 0 || q === 3 ? CC : -CC, cz = q < 2 ? CC : -CC;
    const a0 = [0, Math.PI / 2, Math.PI, Math.PI * 1.5][q]!;
    k.arcWall(cx, cz, R, a0, a0 + Math.PI / 2, 0, top, 14, { thick: 1.6, lift: 3.5, strip, mat: 'concrete' });
  }

  // Invisible containment: nobody should clear the wall, however good the chain.
  for (const [x, z, hx, hz] of [[H + 24, 0, 8, H + 40], [-H - 24, 0, 8, H + 40], [0, H + 24, H + 40, 8], [0, -H - 24, H + 40, 8]] as const) {
    k.collide(x, 80, z, hx, 90, hz, 'concrete', false);
  }
  k.collide(0, 150, 0, H + 40, 2, H + 40, 'concrete', false);

  theGap(k, spec);
  spec.view('ring_south', 110, LEVEL.ring + 1.7, RING.half - 2, 20, LEVEL.ring + 1, RING.half);
  spec.view('ring_corner', RING.half - 6, LEVEL.ring + 1.7, 62, 138, LEVEL.ring + 5, 118);
  spec.view('ring_colonnade', RING.half + 3, 1.7, -30, RING.half + 3, 3, 50);
  spec.view('ring_gap', 34, LEVEL.ring + 1.7, RING.half - 3, -30, LEVEL.ring + 1, RING.half);
  // Yaw per side: local +X spans the road and the panel faces traffic running clockwise.
  const EAST = Math.PI, SOUTH = Math.PI / 2, WEST = 0, NORTH = -Math.PI / 2;
  gantrySign(k, H, 40, EAST, 'REFINERY');
  gantrySign(k, H, -46, EAST, 'SECTOR 02');
  gantrySign(k, -60, H, SOUTH, 'SCRAPYARD');
  gantrySign(k, -H, -40, WEST, 'TRANSIT');
  gantrySign(k, -H, 46, WEST, 'SECTOR 05');
  gantrySign(k, -40, -H, NORTH, 'FOUNDRY');
  gantrySign(k, 40, -H, NORTH, 'SECTOR 01');

  // Chevron boards on the outer wall of each corner, pointing the way round at any speed.
  for (let q = 0; q < 4; q++) {
    const cx = q === 0 || q === 3 ? CC : -CC, cz = q < 2 ? CC : -CC;
    const a0 = [0, Math.PI / 2, Math.PI, Math.PI * 1.5][q]!;
    for (let i = 1; i <= 4; i++) {
      const a = a0 + (i / 5) * (Math.PI / 2);
      const r = RING.corner + HALF_W - 0.45;
      signPanel(k, cx + Math.cos(a) * r, LEVEL.ring + 4.8, cz + Math.sin(a) * r, -a - Math.PI / 2, 8, 2, signId('ARROW R'));
    }
  }

  // Portal frames on the straights: at 40 m/s these are what tells your eye how fast you are going.
  for (const off of [-66, -22, 22, 66]) {
    roadFrame(k, H, off, EAST);
    roadFrame(k, -H, off, WEST);
    roadFrame(k, off, -H, NORTH);
  }
  for (const x of [66, 30, -30, -66]) roadFrame(k, x, H, SOUTH);

  // Abandoned traffic gives the deck scale and some cover at speed.
  truck(k, H - 3, LEVEL.ring, -30, Math.PI / 2 + 0.06);
  truck(k, -H + 4, LEVEL.ring, 28, -Math.PI / 2 + 2.9);
  truck(k, 66, LEVEL.ring, -H + 3, 0.1);
  barrier(k, H + 3, LEVEL.ring, 12, 1.5);
  barrier(k, H + 3, LEVEL.ring, 17, 1.6);
  barrier(k, -30, LEVEL.ring, -H - 3, 0.05);
  barrier(k, -25, LEVEL.ring, -H - 3, -0.03);
}

/**
 * Steel step-over where a route crosses the inner barrier. `x, z` is on the barrier, `dx, dz` points onto the road.
 * The barrier keeps its collider, so these ramps are what the player actually touches.
 */
export function ringStile(k: Kit, x: number, z: number, dx: number, dz: number, w: number): void {
  const y = LEVEL.ring, top = y + 1.2;
  k.ramp(x - dx * 2.6, z - dz * 2.6, y, x - dx * 0.2, z - dz * 0.2, top, w, 'steel', 0.12, false);
  k.ramp(x - dx * 0.2, z - dz * 0.2, top, x + dx * 0.8, z + dz * 0.8, top, w, 'steel', 0.12, false);
  k.ramp(x + dx * 0.8, z + dz * 0.8, top, x + dx * 3.6, z + dz * 3.6, y, w, 'steel', 0.12, false);
}

function pier(k: Kit, s: Station): void {
  const inner = offset(s, -6.2), outer = offset(s, HALF_W);
  const yaw = Math.atan2(-s.oz, s.ox);
  k.column(inner[0], inner[2], 0, LEVEL.ring - 1.5, 1.9, 'concrete', yaw);
  k.beam(inner[0], LEVEL.ring - 2.2, inner[2], outer[0], LEVEL.ring - 2.2, outer[2], 0.8, 0.7, 'concreteDark');
  // Bracket under the cross-beam, with the colonnade's own lighting hung off it.
  k.beam(inner[0] + s.ox * 1, 9.6, inner[2] + s.oz * 1, inner[0] + s.ox * 3.6, LEVEL.ring - 2.8, inner[2] + s.oz * 3.6, 0.4, 0.3, 'concreteDark');
  k.geo.use('emissiveWhite').box(inner[0] + s.ox * 7, LEVEL.ring - 3, inner[2] + s.oz * 7, 0.35, 0.03, 0.35, FACE.ny);
  if (Math.round(s.dist / 22) % 2 === 0) k.light(inner[0] + s.ox * 7, LEVEL.ring - 4.4, inner[2] + s.oz * 7, 'white', 48, 22);
}

function lamp(k: Kit, s: Station): void {
  const b = offset(s, -HALF_W - 0.1, 1);
  const yaw = Math.atan2(-s.oz, s.ox);
  k.push(b[0], b[1], b[2], yaw);
  const g = k.geo.use('steelDark');
  g.cyl(0, 0, 0, 0, 6.8, 0, 0.09, 0.06, 6, false, false);
  k.beam(0, 6.8, 0, 2.6, 7.3, 0, 0.05, 0.05);
  g.use('steelDark').bevel(2.8, 7.26, 0, 0.5, 0.07, 0.16, 0.02);
  g.use('emissiveWhite').box(2.8, 7.17, 0, 0.42, 0.02, 0.1, FACE.ny);
  k.light(3, 5.8, 0, 'white', 44, 24);
  k.pop();
}

function roadFrame(k: Kit, x: number, z: number, yaw: number): void {
  k.push(x, LEVEL.ring, z, yaw);
  const hw = HALF_W + 0.9;
  const g = k.geo;
  for (const s of [-1, 1]) {
    g.use('steelDark').bevel(s * hw, 4, 0, 0.3, 4, 0.34, 0.05);
    k.collide(s * hw, 4, 0, 0.3, 4, 0.34, 'metal');
  }
  g.use('steelDark').bevel(0, 8.2, 0, hw + 0.3, 0.4, 0.34, 0.06);
  g.use('emissiveCyan').box(0, 7.76, 0, hw - 0.3, 0.03, 0.08, FACE.ny);
  k.pop();
}

function gantrySign(k: Kit, x: number, z: number, yaw: number, sign: SignName): void {
  // Local +X runs across the road from the inner barrier to the outer wall; the panel faces oncoming traffic.
  k.push(x, LEVEL.ring, z, yaw);
  const hw = HALF_W + 1;
  k.column(-hw - 0.2, 0, 0, 7.2, 0.5, 'steelDark');
  k.column(hw - 0.2, 0, 0, 7.2, 0.5, 'steelDark');
  k.truss(-hw, 7.2, 0, hw, 7.2, 0, 1.3, 1.2, 'steelDark', 0.07);
  signPanel(k, -4.5, 7.2, 0.72, 0, 7, 1.75, signId(sign));
  signPanel(k, 4.5, 7.2, 0.72, 0, 7, 1.75, signId('RING ROAD'));
  k.pop();
}

/** The south straight has fallen in. Kickers on both lips make it a jump instead of a wall. */
function theGap(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const y = LEVEL.ring, z = RING.half;
  for (const side of [1, -1]) {
    const lip = side > 0 ? GAP.x1 : GAP.x0;
    // Kicker: a slab of road tipped up by the collapse.
    k.ramp(lip + side * 9, z + HALF_W - 1, y, lip + side * 0.2, z + HALF_W - 1, y + 1.3, 6, 'asphalt', 0.5);
    k.ramp(lip + side * 9, z - 3, y, lip + side * 0.2, z - 3, y + 1.3, 7, 'asphalt', 0.5);
    rebar(k, lip, y, z, side > 0 ? -Math.PI / 2 : Math.PI / 2, RING.width, 22);
    rubble(k, lip - side * 3, 0, z, 9, 26, 'concrete', true);
    rubble(k, lip - side * 3, y + 0.1, z - HALF_W + 1, 1.3, 7);
    k.push(lip + side * 12, y, z - 6, side > 0 ? 0 : Math.PI);
    signPanel(k, 0, 2.4, 0, side * Math.PI / 2, 4, 1, signId('GAP AHEAD'));
    g.use('steelDark').bevel(0, 1, 0, 0.1, 1, 0.1, 0.02);
    k.pop();
    vent(k, lip + side * 1, y - 1.2, z + 2, side > 0 ? -Math.PI / 2 : Math.PI / 2);
    cable(k, lip, y - 0.4, z - 6, lip - side * 5, y - 8, z - 4, 1.8, 0.05);
    cable(k, lip, y - 0.4, z + 3, lip - side * 4, y - 7, z + 5, 1.4, 0.05);
  }
  spec.jump(GAP.x1 + 0.5, y + 1, z - 3, GAP.x0 - 0.5, y + 1, z - 3);
}
