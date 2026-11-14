/**
 * The fort's own set dressing: what makes it a lived-in base and its field a place. Huts, trucks, fuel, tents, dishes and masts inside;
 * craters, wire, ruins, rocks and a checkpoint outside. Each draws into the static map (one mesh per material per chunk) and carries
 * box colliders that match what you see closely enough to fight round. Local frames follow the kit: yaw turns +X, the front is +Z.
 */
import { FACE, type Mat } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { cable, signPanel, wallLamp } from '../../kit/props';
import { signId, type SignName } from '../../kit/signs';
import type { Site } from '../outpost/site';
import { LEVEL, type Rgb } from './plan';

export const OLIVE: Rgb = [0.42, 0.46, 0.3];
export const CANVAS: Rgb = [0.5, 0.48, 0.36];
const SAND: Rgb = [0.62, 0.56, 0.42];

/** A box from its corners in the current frame, drawn bevelled with its collider. */
function solid(k: Kit, mat: Mat, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tint: Rgb | number = 1, bev = 0.04): void {
  const t = typeof tint === 'number' ? [tint, tint, tint] : tint;
  k.geo.tint(t[0]!, t[1]!, t[2]!);
  k.block(mat, x0, y0, z0, x1, y1, z1, bev);
  k.geo.tint(1);
}

/**
 * Marks the footprint of a yawed box on the minimap, dropping whatever the builders inside its frame marked since `from`: those
 * rects are in the turned frame, so they would land in the wrong place.
 */
function mark(site: Site, x: number, z: number, hx: number, hz: number, yaw: number, from = site.plan.blocks.length): void {
  site.plan.blocks.length = from;
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw)), ex = hx * c + hz * s, ez = hx * s + hz * c;
  site.plan.blocks.push({ x0: x - ex, z0: z - ez, x1: x + ex, z1: z + ez });
}

/**
 * A prefab hut: olive panel walls, a door and windows on its front (+Z), a step and a lamp. `roof: 'flat'` tops it with a slab at
 * LEVEL.roof, a sandbag lip on three edges and stairs up its +X end: a firing position you climb to. Otherwise a pitched tin roof.
 */
export function hut(k: Kit, site: Site, x: number, z: number, yaw: number, len: number, wid: number, roof: 'flat' | 'pitched', lit = true): void {
  const g = k.geo, hx = len / 2, hz = wid / 2, h = roof === 'flat' ? LEVEL.roof - 0.25 : 2.6, from = site.plan.blocks.length;
  k.push(x, 0, z, yaw);
  g.use('concreteDark').bevel(0, 0.1, 0, hx + 0.15, 0.1, hz + 0.15, 0.03);
  solid(k, 'panel', -hx, 0.2, -hz, hx, h, hz, [OLIVE[0] * 1.5, OLIVE[1] * 1.5, OLIVE[2] * 1.5], 0.05);
  // Panel seams.
  g.use('steelDark');
  for (let u = -hx + 1.2; u < hx; u += 1.2) {
    g.box(u, h / 2 + 0.1, hz + 0.01, 0.025, h / 2 - 0.1, 0.01, FACE.pz);
    g.box(u, h / 2 + 0.1, -hz - 0.01, 0.025, h / 2 - 0.1, 0.01, FACE.nz);
  }
  // The door, its step and lamp; windows either side, some lit.
  g.use('steelDark').bevel(0, 1.2, hz + 0.03, 0.5, 1.0, 0.03, 0.02);
  g.use('concrete').bevel(0, 0.12, hz + 0.45, 0.7, 0.12, 0.35, 0.03);
  for (const wx of [-hx + 1.4, hx - 1.4, -hx / 2, hx / 2]) {
    if (Math.abs(wx) < 1.2) continue;
    g.use('steelDark').box(wx, 1.6, hz + 0.02, 0.55, 0.42, 0.02, FACE.pz);
    g.use(lit && k.rng() < 0.6 ? 'emissiveOrange' : 'glass').box(wx, 1.6, hz + 0.045, 0.46, 0.34, 0.005, FACE.pz);
    g.use('glass').box(wx, 1.6, -hz - 0.045, 0.46, 0.34, 0.005, FACE.nz);
  }
  wallLamp(k, 0.9, 2.3, hz + 0.02, 0, 'white', lit ? 8 : 0, 8);
  // An air conditioner on the end, a cable off it.
  g.use('panel').tint(0.75).bevel(-hx - 0.3, 1.0, 0, 0.3, 0.4, 0.5, 0.04);
  g.tint(1);
  if (roof === 'pitched') {
    g.use('rust').tint(0.66);
    for (const s of [-1, 1]) {
      k.push(0, h + 0.45, s * hz / 2, 0, 0, 0);
      k.push(0, 0, 0, 0, s * 0.32, 0);
      g.bevel(0, 0, 0, hx + 0.3, 0.04, hz / 2 + 0.38, 0.01);
      k.pop();
      k.pop();
    }
    g.tint(1).use('panel').tint(OLIVE[0] * 1.3, OLIVE[1] * 1.3, OLIVE[2] * 1.3);
    for (const s of [-1, 1]) g.tri(s * hx, h, -hz, s * hx, h, hz, s * hx, h + 0.75, 0);
    g.tint(1);
  } else {
    solid(k, 'concrete', -hx - 0.1, h, -hz - 0.1, hx + 0.1, LEVEL.roof, hz + 0.1, 0.66, 0.03);
    site.sandbags(-hx - 0.1, -hz - 0.1, hx - 2.4, -hz + 0.5, 0.8, LEVEL.roof);
    site.sandbags(-hx - 0.1, -hz + 0.5, -hx + 0.5, hz + 0.1, 0.8, LEVEL.roof);
    site.stairs(hx + 3.4, -hz + 0.9, 0, hx + 0.1, -hz + 0.9, LEVEL.roof, 1.4, 'steel', false);
    g.use('hazard').box(0, LEVEL.roof + 0.006, hz - 0.05, hx, 0.004, 0.08, FACE.py);
  }
  k.pop();
  mark(site, x, z, hx + (roof === 'flat' ? 1.7 : 0), hz, yaw, from);
}

/** An army truck: olive cab, a canvas tilt over the bed, six wheels. `burnt` is a black, rusted shell instead. */
export function armyTruck(k: Kit, x: number, z: number, yaw: number, burnt = false): void {
  const g = k.geo, body: Rgb = burnt ? [0.22, 0.2, 0.18] : [OLIVE[0] * 1.4, OLIVE[1] * 1.4, OLIVE[2] * 1.4];
  k.push(x, 0, z, yaw, 0, burnt ? 0.04 : 0);
  g.use('steelDark').bevel(0, 0.9, 0, 3.6, 0.16, 0.9, 0.04);
  g.use(burnt ? 'rust' : 'panel').tint(body[0], body[1], body[2]);
  // Cab at +X, the bed behind it.
  g.bevel(2.55, 1.75, 0, 0.95, 0.75, 1.1, 0.12);
  g.bevel(3.3, 1.25, 0, 0.35, 0.3, 1.0, 0.08);
  g.use(burnt ? 'steelDark' : 'glass').tint(burnt ? 0.2 : 1).box(3.12, 2.05, 0, 0.36, 0.3, 0.98, FACE.px);
  g.tint(body[0] * 0.9, body[1] * 0.9, body[2] * 0.9).use(burnt ? 'rust' : 'panel');
  g.bevel(-1.0, 1.3, 0, 2.5, 0.25, 1.15, 0.04);
  if (!burnt) {
    // The tilt: canvas over hoops.
    g.use('panel').tint(CANVAS[0] * 1.3, CANVAS[1] * 1.3, CANVAS[2] * 1.3);
    g.bevel(-1.0, 2.35, 0, 2.45, 0.8, 1.15, 0.25);
  } else {
    g.use('steelDark').tint(0.4);
    for (const u of [-3, -2, -1, 0, 1]) g.box(u, 2.2, 0, 0.04, 0.03, 1.15, FACE.py | FACE.ny | FACE.pz | FACE.nz);
  }
  g.tint(1).use('rubber').tint(burnt ? 0.4 : 1);
  for (const u of [2.6, -0.8, -2.2]) for (const s of [1, -1]) g.cyl(u, 0.5, s * 1.15, u, 0.5, s * 0.75, 0.5, 0.5, 12);
  g.tint(1);
  k.collide(-0.3, 1.5, 0, 3.6, 1.5, 1.2, 'metal');
  k.pop();
}

/** A fuel bowser tank on cradles, a hose and a NO SMOKING sign. */
export function fuelTank(k: Kit, x: number, z: number, yaw: number, len = 5, r = 1.1): void {
  const g = k.geo;
  k.push(x, 0, z, yaw);
  g.use('paintWhite').tint(0.62, 0.64, 0.58).cyl(-len / 2, r + 0.5, 0, len / 2, r + 0.5, 0, r, r, 16, true, true);
  g.tint(1).use('steelDark');
  for (const u of [-len / 2 + 0.6, len / 2 - 0.6]) g.bevel(u, 0.4, 0, 0.18, 0.4, r * 0.8, 0.03);
  for (const u of [-len / 3, 0, len / 3]) g.cyl(u, r + 0.5, 0, u + 0.1, r + 0.5, 0, r + 0.03, r + 0.03, 16, false, false);
  g.use('hazard').box(0, r + 0.5, r + 0.005, len / 2 - 0.3, 0.12, 0.004, FACE.pz);
  g.use('steel').cyl(0, 2 * r + 0.5, 0, 0, 2 * r + 0.7, 0, 0.25, 0.25, 8);
  cable(k, len / 2, r + 0.3, 0.3, len / 2 + 1.4, 0.05, 0.9, 0.3, 0.05);
  k.collide(0, (r + 0.5) * 0.5 + r * 0.5, 0, len / 2, (2 * r + 0.5) / 2, r, 'metal');
  k.pop();
}

/** Oil drums in a huddle, some on their sides. Not explosive: the ones that are come from spec.barrel. */
export function drums(k: Kit, x: number, z: number, n: number, tint: Rgb = [0.3, 0.38, 0.5]): void {
  const g = k.geo;
  for (let i = 0; i < n; i++) {
    const a = i * 2.4, r = i === 0 ? 0 : 0.62 * Math.sqrt(i);
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    const t = 0.7 + k.rng() * 0.4;
    g.use('paintWhite').tint(tint[0] * t, tint[1] * t, tint[2] * t);
    if (i === n - 1 && n > 3) {
      g.cyl(px - 0.45, 0.29, pz, px + 0.45, 0.29, pz, 0.29, 0.29, 10, true, true);
    } else {
      g.cyl(px, 0, pz, px, 0.9, pz, 0.29, 0.29, 10, false, true);
      g.tint(0.3).use('steelDark').cyl(px, 0.88, pz, px, 0.9, pz, 0.24, 0.24, 8, false, true);
    }
  }
  g.tint(1);
  const s = 0.62 * Math.sqrt(n) + 0.3;
  k.collide(x, 0.45, z, s * 0.7, 0.45, s * 0.7, 'metal');
}

/** The mess tent: canvas on poles over tables and benches, its sides rolled up. */
export function tent(k: Kit, site: Site, x: number, z: number, yaw: number, len: number, wid: number): void {
  const g = k.geo, hx = len / 2, hz = wid / 2, eave = 2.2, ridge = 3.4;
  k.push(x, 0, z, yaw);
  g.use('panel').tint(CANVAS[0] * 1.4, CANVAS[1] * 1.4, CANVAS[2] * 1.4);
  for (const s of [-1, 1]) {
    // Each pitch, both faces, so it reads from under it.
    g.quad(-hx, eave, s * hz, hx, eave, s * hz, hx, ridge, 0, -hx, ridge, 0);
    g.quad(hx, eave, s * hz, -hx, eave, s * hz, -hx, ridge, 0, hx, ridge, 0);
    g.tri(s * hx, eave, -hz, s * hx, eave, hz, s * hx, ridge, 0);
    g.tri(s * hx, eave, hz, s * hx, eave, -hz, s * hx, ridge, 0);
  }
  // Rolled sides.
  g.tint(CANVAS[0] * 1.1, CANVAS[1] * 1.1, CANVAS[2] * 1.1);
  for (const s of [-1, 1]) g.cyl(-hx, eave - 0.1, s * hz, hx, eave - 0.1, s * hz, 0.12, 0.12, 6);
  g.tint(1).use('steelDark');
  for (let u = -hx; u <= hx + 0.01; u += len / 3) {
    for (const s of [-1, 1]) {
      g.box(u, eave / 2, s * hz, 0.04, eave / 2, 0.04, FACE.sides);
      k.collide(u, eave / 2, s * hz, 0.05, eave / 2, 0.05, 'metal', false);
    }
    g.box(u, ridge / 2, 0, 0.05, ridge / 2, 0.05, FACE.sides);
  }
  // Tables and benches.
  for (let u = -hx + 1.6; u < hx - 1; u += 2.8) {
    for (const s of [-1, 1]) {
      const zc = s * hz * 0.45;
      g.use('plywood').tint(0.8);
      k.block('plywood', u - 1.0, 0.72, zc - 0.4, u + 1.0, 0.78, zc + 0.4, 0.01);
      g.use('steelDark');
      for (const e of [-0.85, 0.85]) g.box(u + e, 0.36, zc, 0.03, 0.36, 0.35, FACE.sides);
      for (const b of [-0.65, 0.65]) {
        g.use('plywood').tint(0.65).box(u, 0.44, zc + b, 1.0, 0.03, 0.14, FACE.py | FACE.sides);
        g.use('steelDark').box(u, 0.21, zc + b, 0.9, 0.2, 0.02, FACE.pz | FACE.nz);
      }
    }
  }
  g.tint(1);
  k.lampBar(0, ridge - 0.25, 0, 0, Math.min(6, len - 2), 'white', 22, 10);
  k.pop();
  mark(site, x, z, hx, hz, yaw);
}

/** A satellite dish on a post, tilted up toward `yaw`. */
export function dish(k: Kit, x: number, y: number, z: number, yaw: number, r = 1.2): void {
  const g = k.geo;
  g.use('steelDark').cyl(x, y, z, x, y + r + 0.4, z, 0.08, 0.08, 6, false, false);
  k.push(x, y + r + 0.5, z, yaw, -0.7);
  const prof: number[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    prof.push(Math.max(0.001, r * t), r * 0.28 * t * t);
  }
  // Both faces of the bowl.
  g.use('paintWhite').tint(0.82, 0.84, 0.86).lathe(prof, 0, 0, 0, 16, true);
  const back: number[] = [];
  for (let i = 6; i >= 0; i--) back.push(Math.max(0.001, r * (i / 6)), r * 0.28 * (i / 6) ** 2 - 0.02);
  g.tint(0.6).lathe(back, 0, 0, 0, 16, true);
  g.tint(1).use('steelDark');
  for (const a of [0, 2.1, 4.2]) g.cyl(Math.cos(a) * r * 0.8, r * 0.18, Math.sin(a) * r * 0.8, 0, r * 0.75, 0, 0.02, 0.02, 4, false, false);
  g.bevel(0, r * 0.78, 0, 0.08, 0.08, 0.08, 0.02);
  k.pop();
}

/** A guyed lattice mast with a red light on top. */
export function latticeMast(k: Kit, x: number, z: number, y0: number, h: number, w = 0.7): void {
  const g = k.geo;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    g.use('paintRed').tint(0.85).cyl(x + sx * w / 2, y0, z + sz * w / 2, x + sx * w / 4, y0 + h, z + sz * w / 4, 0.04, 0.03, 4, false, false);
  }
  g.tint(1);
  for (let y = y0 + 1; y < y0 + h - 1; y += 2) {
    const f = 1 - ((y - y0) / h) * 0.5;
    k.beam(x - (w / 2) * f, y, z - (w / 2) * f, x + (w / 2) * f, y + 1, z - (w / 2) * f, 0.02, 0.02, 'steelDark');
    k.beam(x + (w / 2) * f, y, z + (w / 2) * f, x - (w / 2) * f, y + 1, z + (w / 2) * f, 0.02, 0.02, 'steelDark');
    k.beam(x - (w / 2) * f, y + 1, z - (w / 2) * f, x - (w / 2) * f, y, z + (w / 2) * f, 0.02, 0.02, 'steelDark');
    k.beam(x + (w / 2) * f, y + 1, z + (w / 2) * f, x + (w / 2) * f, y, z - (w / 2) * f, 0.02, 0.02, 'steelDark');
  }
  for (const a of [0.4, 2.5, 4.6]) {
    const gx = x + Math.cos(a) * h * 0.45, gz = z + Math.sin(a) * h * 0.45;
    g.use('steelDark').tri(gx, y0 + 0.02, gz, x, y0 + h * 0.8, z + 0.02, x + 0.02, y0 + h * 0.8, z);
    g.use('concreteDark').bevel(gx, y0 + 0.15, gz, 0.3, 0.15, 0.3, 0.04);
  }
  g.use('emissiveRed').cyl(x, y0 + h, z, x, y0 + h + 0.35, z, 0.12, 0.12, 6, true, true);
  k.collide(x, y0 + h / 2, z, w / 2, h / 2, w / 2, 'metal', false);
  k.light(x, y0 + h + 0.6, z, 'red', 6, 8);
}

/**
 * A steel stair tower: two flights side by side up to a platform at `top`, with a landing half way. The platform is a floor
 * (LEVEL.tower), railed, and `onTop` builds on it. Local: the flights run along +X from the foot at x 0, the platform is at x < 0.
 */
export function stairTower(k: Kit, site: Site, x: number, z: number, yaw: number, top: number, size: number, onTop?: () => void): void {
  const g = k.geo, half = top / 2, run = half / 0.72, w = 1.3, p = size / 2, from = site.plan.blocks.length;
  k.push(x, 0, z, yaw);
  k.stairs(0, -w / 2 - 0.05, 0, run, -w / 2 - 0.05, half, w, 'steel', true);
  k.stairs(run, w / 2 + 0.05, half, 0, w / 2 + 0.05, top, w, 'steel', true);
  // The landing, on two posts.
  k.catwalk(run, 0, run + 1.6, 0, half, w * 2 + 0.2, 'none');
  k.rail([run + 1.6, half, -w - 0.1, run + 1.6, half, w + 0.1]);
  g.use('steelDark');
  for (const s of [-1, 1]) {
    g.bevel(run + 1.5, half / 2, s * w, 0.07, half / 2, 0.07, 0.02);
    k.collide(run + 1.5, half / 2, s * w, 0.07, half / 2, 0.07, 'metal', false);
  }
  // The platform, its legs, cross bracing and rails, open on the stair side.
  k.catwalk(-size, 0, 0, 0, top, size, 'none');
  for (const [lx, lz] of [[-size + 0.1, -p + 0.1], [-0.1, -p + 0.1], [-size + 0.1, p - 0.1], [-0.1, p - 0.1]] as const) {
    g.use('steelDark').bevel(lx, top / 2, lz, 0.12, top / 2, 0.12, 0.02);
    k.collide(lx, top / 2, lz, 0.12, top / 2, 0.12, 'metal', false);
    g.use('concreteDark').bevel(lx, 0.15, lz, 0.35, 0.15, 0.35, 0.04);
  }
  for (let y = 1; y < top - 1; y += 2.2) {
    k.beam(-size + 0.1, y, -p + 0.1, -0.1, y + 2, -p + 0.1, 0.03, 0.03);
    k.beam(-size + 0.1, y + 2, p - 0.1, -0.1, y, p - 0.1, 0.03, 0.03);
    k.beam(-size + 0.1, y, -p + 0.1, -size + 0.1, y + 2, p - 0.1, 0.03, 0.03);
  }
  k.rail([0, top, -p, -size, top, -p, -size, top, p, 0, top, p]);
  g.use('hazard').box(-size / 2, top + 0.005, 0, size / 2, 0.004, 0.06, FACE.py);
  onTop?.();
  k.pop();
  site.plan.blocks.length = from;
  const c = Math.cos(yaw), sn = Math.sin(yaw), mx = x - (size / 2) * c, mz = z + (size / 2) * sn;
  site.plan.decks.push({ x0: mx - p, z0: mz - p, x1: mx + p, z1: mz + p });
}

/** A water tower on a stair tower: the tank on legs over a railed platform at LEVEL.tower, a sniper's nest under it. */
export function waterTower(k: Kit, site: Site, x: number, z: number, yaw: number): void {
  const size = 4.2, top = LEVEL.tower;
  stairTower(k, site, x, z, yaw, top, size, () => {
    const g = k.geo, cx = -size / 2, ty = top + 2.4;
    g.use('steelDark');
    for (const [lx, lz] of [[-size + 0.3, -1.8], [-0.3, -1.8], [-size + 0.3, 1.8], [-0.3, 1.8]] as const) {
      g.bevel(lx, (top + ty) / 2, lz, 0.08, (ty - top) / 2, 0.08, 0.02);
      k.collide(lx, (top + ty) / 2, lz, 0.08, (ty - top) / 2, 0.08, 'metal', false);
    }
    g.use('panel').tint(0.55, 0.6, 0.5).cyl(cx, ty, 0, cx, ty + 3.2, 0, 2.2, 2.2, 20, true, false);
    g.tint(0.5).cyl(cx, ty + 3.2, 0, cx, ty + 3.8, 0, 2.2, 0.3, 20, false, true);
    g.tint(1).use('steelDark').cyl(cx, ty + 1.5, 0, cx, ty + 1.7, 0, 2.25, 2.25, 20, false, false);
    k.collide(cx, ty + 1.8, 0, 2.1, 1.8, 2.1, 'metal');
    // Sandbags along two edges of the platform under the tank.
    site.sandbags(-size + 0.05, -2.1, -0.6, -1.5, 0.75, top);
    k.light(cx, top + 1.8, 0, 'white', 8, 6);
  });
}

/** A comms tower: a stair tower with a hut on its platform, dishes and a lattice mast on top. A sniper's nest on the roof hatch. */
export function commsTower(k: Kit, site: Site, x: number, z: number, yaw: number): void {
  const size = 4, top = LEVEL.tower;
  stairTower(k, site, x, z, yaw, top, size, () => {
    const g = k.geo;
    // A cabin on the back half, its door toward the stairs; the front half is open deck behind sandbags.
    g.tint(0.6, 0.66, 0.6);
    k.block('panel', -size + 0.1, top, -1.9, -size / 2 - 0.3, top + 2.3, 1.9, 0.04);
    g.tint(0.5).use('rust');
    g.bevel(-size * 0.62, top + 2.4, 0, size * 0.32, 0.06, 2.1, 0.02);
    g.tint(1);
    g.use('emissiveCyan').box(-size / 2 - 0.29, top + 1.5, 0.9, 0.005, 0.25, 0.35, FACE.px);
    site.sandbags(-size / 2 - 0.2, -1.95, -0.2, -1.4, 0.8, top);
    site.sandbags(-size / 2 - 0.2, 1.4, -0.2, 1.95, 0.8, top);
    latticeMast(k, -size * 0.75, 0, top + 2.4, 11, 0.6);
    dish(k, -size * 0.45, top + 2.4, 1.3, 0.5, 0.8);
    dish(k, -size * 0.45, top + 2.4, -1.3, -1.2, 0.6);
    k.light(-size / 2, top + 1.6, 0, 'white', 8, 6);
  });
}

/** A shell crater: a scorched bowl and a lip of thrown earth. No collider; the lip is too low to matter. */
export function crater(k: Kit, x: number, z: number, r: number): void {
  const g = k.geo;
  for (let i = 0; i < 4; i++) {
    k.push(x, 0.008 + i * 0.001, z, (i * Math.PI) / 8);
    g.use('dirt').tint(0.2, 0.18, 0.16).box(0, 0, 0, r * 0.82, 0.001, r * 0.34, FACE.py);
    g.box(0, 0, 0, r * 0.34, 0.001, r * 0.82, FACE.py);
    k.pop();
  }
  g.tint(0.12, 0.11, 0.1);
  k.push(x, 0.012, z, 0.3);
  g.box(0, 0, 0, r * 0.5, 0.001, r * 0.5, FACE.py);
  k.pop();
  const n = Math.max(6, Math.round(r * 5));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + k.rand(-0.2, 0.2), d = r * k.rand(0.85, 1.1), s = k.rand(0.25, 0.5) * Math.min(1.4, r / 2);
    k.push(x + Math.cos(a) * d, s * 0.25, z + Math.sin(a) * d, -a, k.rand(-0.3, 0.3), 0.25);
    g.use('dirt').tint(k.rand(0.35, 0.5), k.rand(0.32, 0.45), k.rand(0.26, 0.36)).bevel(0, 0, 0, s * 1.4, s * 0.4, s, s * 0.3);
    k.pop();
  }
  g.tint(1);
}

/** A row of concertina wire on pickets: coils over a low collider that stops a man walking and nothing over knee height. */
export function wire(k: Kit, ax: number, az: number, bx: number, bz: number, h = 0.9): void {
  const g = k.geo;
  k.along(ax, 0, az, bx, 0, bz, len => {
    g.use('steelDark');
    for (let u = 0; u <= len + 0.01; u += 3) g.box(u, h / 2 + 0.1, 0, 0.025, h / 2 + 0.1, 0.025, FACE.sides);
    // The coil: one long helix.
    const pts: number[] = [], turns = Math.round(len / 0.35), r = h / 2;
    for (let i = 0; i <= turns * 6; i++) {
      const t = i / 6, a = t * Math.PI * 2;
      pts.push((t / turns) * len, r + Math.sin(a) * r, Math.cos(a) * r * 0.9);
    }
    g.use('steel').tint(0.55).tube(pts, 0.012, 3);
    g.tint(1);
    k.collide(len / 2, h / 2, 0, len / 2, h / 2, 0.35, 'metal', false);
  });
}

/** A boulder: a few tilted blocks, grey-brown, under one collider. */
export function rock(k: Kit, x: number, z: number, s: number, y = 0): void {
  const g = k.geo;
  const tint = k.rand(0.36, 0.5);
  for (let i = 0; i < 3; i++) {
    const ox = k.rand(-0.3, 0.3) * s, oz = k.rand(-0.3, 0.3) * s, sz = s * k.rand(0.55, 0.85);
    k.push(x + ox, y + sz * 0.45, z + oz, k.rand(0, 6.28), k.rand(-0.35, 0.35), k.rand(-0.35, 0.35));
    g.use('concreteDark').tint(tint * 1.1, tint, tint * 0.88).bevel(0, 0, 0, sz * k.rand(0.8, 1.2), sz * k.rand(0.5, 0.8), sz * k.rand(0.7, 1.1), sz * 0.25);
    k.pop();
  }
  g.tint(1);
  k.collide(x, y + s * 0.4, z, s * 0.62, s * 0.4, s * 0.62, 'concrete');
}

/** A dead tree: a trunk and a few bare limbs. */
export function deadTree(k: Kit, x: number, z: number, h: number): void {
  const g = k.geo.use('rust').tint(0.32, 0.28, 0.24);
  g.cyl(x, 0, z, x + 0.1, h, z, 0.22, 0.08, 6, false, true);
  for (let i = 0; i < 4; i++) {
    const a = k.rand(0, 6.28), y = h * k.rand(0.45, 0.85), l = h * k.rand(0.2, 0.35);
    g.cyl(x, y, z, x + Math.cos(a) * l, y + l * 0.7, z + Math.sin(a) * l, 0.07, 0.02, 4, false, true);
  }
  g.tint(1);
  k.collide(x, h / 2, z, 0.2, h / 2, 0.2, 'dirt', false);
}

/**
 * A ruined house: block walls of uneven height with window and door holes, one corner standing to a second storey, a slab of roof
 * fallen in, rubble. `seed` picks which walls are down. Local front is +Z.
 */
export function ruin(k: Kit, site: Site, x: number, z: number, yaw: number, w: number, d: number, seed: number): void {
  const g = k.geo, t = 0.35, hx = w / 2, hz = d / 2, plaster: Rgb = [0.72, 0.66, 0.56];
  k.push(x, 0, z, yaw);
  g.use('concreteDark').tint(0.5).bevel(0, 0.1, 0, hx + 0.2, 0.1, hz + 0.2, 0.03);
  g.tint(1);
  const tall = 5.4, low = [2.4, 1.3, 2.8, 1.8];
  // Each wall in pieces round its holes: [from, to, top] along the wall, with a window gap or a door.
  const wallX = (zc: number, h0: number, holes: readonly [number, number, number, number][]) => {
    let u = -hx;
    for (const [a, b, y0, y1] of holes) {
      solid(k, 'concrete', u, 0, zc - t / 2, a, h0, zc + t / 2, plaster, 0.03);
      if (y0 > 0.05) solid(k, 'concrete', a, 0, zc - t / 2, b, y0, zc + t / 2, plaster, 0.03);
      if (y1 < h0 - 0.05) solid(k, 'concrete', a, y1, zc - t / 2, b, h0, zc + t / 2, plaster, 0.03);
      u = b;
    }
    solid(k, 'concrete', u, 0, zc - t / 2, hx, h0, zc + t / 2, plaster, 0.03);
  };
  const s = seed % 4;
  wallX(hz - t / 2, low[s]!, [[-0.5, 0.5, 0, 2.1], [hx - 1.8, hx - 0.8, 0.9, 1.9]]);
  wallX(-hz + t / 2, low[(s + 1) % 4]!, [[-hx + 1, -hx + 2, 0.9, 1.9]]);
  // The side walls: one standing to the second storey at its back corner, the other broken low.
  solid(k, 'concrete', -hx, 0, -hz + t, -hx + t, low[(s + 2) % 4]!, hz - t, plaster, 0.03);
  solid(k, 'concrete', hx - t, 0, -hz + t, hx, 1.0, 0, plaster, 0.03);
  solid(k, 'concrete', hx - t, 0, 0, hx, low[(s + 3) % 4]! + 0.6, hz - t, plaster, 0.03);
  // The tall corner: two storeys of wall, a window up top, and a floor slab hanging off it.
  solid(k, 'concrete', -hx, 0, -hz, -hx + 2.6, tall, -hz + t, plaster, 0.03);
  solid(k, 'concrete', -hx, 0, -hz + t, -hx + t, tall, -hz + 2.4, plaster, 0.03);
  k.push(-hx + 1.6, 2.9, -hz + 1.6, 0, 0.12, -0.18);
  g.use('concreteDark').tint(0.7).bevel(0, 0, 0, 1.4, 0.12, 1.3, 0.04);
  k.pop();
  k.collide(-hx + 1.5, 2.85, -hz + 1.5, 1.2, 0.12, 1.1, 'concrete');
  // The roof fallen in across the room.
  k.push(0.6, 0.9, 0.2, 0.3, 0.35, 0.1);
  g.use('concreteDark').tint(0.6).bevel(0, 0, 0, hx * 0.6, 0.1, hz * 0.55, 0.04);
  k.pop();
  g.tint(1);
  k.collide(0.6, 0.6, 0.2, hx * 0.5, 0.5, hz * 0.4, 'concrete');
  // Scorch round the windows and rubble round the foot.
  g.use('dirt').tint(0.15, 0.14, 0.13).box(hx - 1.3, 1.4, hz + 0.01, 0.9, 0.8, 0.005, FACE.pz);
  g.tint(1);
  k.pop();
  mark(site, x, z, hx, hz, yaw);
}

/** A guard booth: a small hut with windows all round, a light and a phone. */
export function booth(k: Kit, x: number, z: number, yaw: number): void {
  const g = k.geo;
  k.push(x, 0, z, yaw);
  solid(k, 'panel', -1, 0, -1, 1, 1.0, 1, [0.78, 0.76, 0.66]);
  g.use('glass').box(0, 1.6, 0, 0.98, 0.6, 0.98, FACE.sides);
  g.use('steelDark');
  for (const [px, pz] of [[-0.95, -0.95], [0.95, -0.95], [-0.95, 0.95], [0.95, 0.95]] as const) g.box(px, 1.6, pz, 0.05, 0.6, 0.05, FACE.sides);
  solid(k, 'panel', -1.2, 2.2, -1.2, 1.2, 2.4, 1.2, [0.6, 0.58, 0.5]);
  k.collide(0, 1.6, 0, 1, 0.6, 1, 'glass', false);
  g.use('hazard').box(0, 0.5, 1.01, 1, 0.12, 0.005, FACE.pz);
  k.light(0, 2.0, 1.5, 'white', 10, 8);
  k.pop();
}

/** A barrier arm, raised: a striped pole up off its counterweight post. */
export function boom(k: Kit, x: number, z: number, yaw: number, len: number): void {
  const g = k.geo;
  k.push(x, 0, z, yaw);
  solid(k, 'concrete', -0.3, 0, -0.3, 0.3, 1.1, 0.3, 0.8);
  k.push(0, 1.0, 0, 0, 0, 1.35);
  for (let i = 0; i < 6; i++) {
    g.use(i % 2 ? 'paintRed' : 'paintWhite').box(0.2 + (i + 0.5) * (len / 6), 0, 0, len / 12, 0.06, 0.06, FACE.py | FACE.ny | FACE.pz | FACE.nz | FACE.px);
  }
  k.pop();
  k.pop();
}

/** A sandbag fighting position: a horseshoe open at the back (-Z), with a crate of ammunition in it. */
export function nest(k: Kit, site: Site, x: number, z: number, yaw: number, w = 3, d = 2.4, h = 1.1): void {
  const from = site.plan.blocks.length;
  k.push(x, 0, z, yaw);
  site.sandbags(-w / 2, d / 2 - 0.6, w / 2, d / 2, h);
  site.sandbags(-w / 2, -d / 2, -w / 2 + 0.6, d / 2 - 0.6, h);
  site.sandbags(w / 2 - 0.6, -d / 2, w / 2, d / 2 - 0.6, h);
  site.crate(-0.4, -d / 2 + 0.2, 0.4, -d / 2 + 0.75, 0.45, [0.38, 0.42, 0.28]);
  k.pop();
  mark(site, x, z, w / 2, d / 2, yaw, from);
}

/** Dragon's teeth: a line of squat concrete pyramids. */
export function teeth(k: Kit, ax: number, az: number, bx: number, bz: number, every = 2.2): void {
  const g = k.geo;
  k.along(ax, 0, az, bx, 0, bz, len => {
    for (let u = 0; u <= len; u += every) {
      const s = k.rand(0.85, 1.05);
      g.use('concrete').tint(0.7 * s);
      g.quad(u - 0.6, 0, 0.6, u + 0.6, 0, 0.6, u + 0.15, 1.1 * s, 0.15, u - 0.15, 1.1 * s, 0.15);
      g.quad(u + 0.6, 0, -0.6, u - 0.6, 0, -0.6, u - 0.15, 1.1 * s, -0.15, u + 0.15, 1.1 * s, -0.15);
      g.quad(u + 0.6, 0, 0.6, u + 0.6, 0, -0.6, u + 0.15, 1.1 * s, -0.15, u + 0.15, 1.1 * s, 0.15);
      g.quad(u - 0.6, 0, -0.6, u - 0.6, 0, 0.6, u - 0.15, 1.1 * s, 0.15, u - 0.15, 1.1 * s, -0.15);
      g.box(u, 1.1 * s, 0, 0.15, 0.001, 0.15, FACE.py);
      k.collide(u, 0.45, 0, 0.42, 0.45, 0.42, 'concrete');
    }
    g.tint(1);
  });
}

/** A signboard on two legs, facing +Z in its frame. */
export function board(k: Kit, x: number, z: number, yaw: number, name: SignName, w = 2.6, y = 1.6): void {
  const g = k.geo;
  k.push(x, 0, z, yaw);
  g.use('steelDark');
  for (const s of [-1, 1]) g.box(s * (w / 2 - 0.2), y / 2, -0.1, 0.05, y / 2, 0.05, FACE.sides);
  k.pop();
  signPanel(k, x, y + 0.35, z, yaw, w, w / 4, signId(name), false);
}

/** Stacked ammunition boxes on pallets, under a camouflage net. */
export function ammoStack(k: Kit, site: Site, x: number, z: number, yaw: number): void {
  const from = site.plan.blocks.length;
  k.push(x, 0, z, yaw);
  for (const [cx, cz, n] of [[-1.2, 0, 3], [0, 0, 2], [1.2, 0, 3], [-0.6, 1.1, 2], [0.6, 1.1, 1]] as const) {
    k.geo.use('plywood').tint(0.55).box(cx, 0.06, cz, 0.55, 0.06, 0.5, FACE.py | FACE.sides);
    site.crate(cx - 0.5, cz - 0.45, cx + 0.5, cz + 0.45, 0.42 * n, [0.36, 0.4, 0.26], 0.12);
  }
  k.geo.use('panel').tint(SAND[0] * 0.6, SAND[1] * 0.6, SAND[2] * 0.5);
  k.push(0, 2.2, 0.5, 0, 0.1, 0.05);
  k.geo.box(0, 0, 0, 2.4, 0.01, 1.6, FACE.py | FACE.ny);
  k.pop();
  k.geo.tint(1).use('steelDark');
  for (const [px, pz] of [[-2.2, -1], [2.2, -1], [-2.2, 2], [2.2, 2]] as const) k.geo.box(px, 1.1, pz, 0.04, 1.1, 0.04, FACE.sides);
  k.pop();
  mark(site, x, z, 1.8, 0.55, yaw, from);
}
