/**
 * Holdfast's own dressing: what makes it a squatters' port and not a base. Painted terraces and shanty houses, dyed awnings, stalls,
 * bunting and strings of bulbs across the lanes, banners, braziers, loudspeakers, rusting hulls. Everything is drawn into the static map
 * (one mesh per material per chunk) with box colliders where a body or a round should stop. Local frames follow the kit: yaw turns +X,
 * the front is +Z.
 */
import { FACE, type Mat } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { cable, wallLamp } from '../../kit/props';
import type { Site } from '../outpost/site';
import { DYES, LEVEL, PAINTS, type Rect, type Rgb, STALL } from './plan';

const pick = <T>(k: Kit, list: readonly T[]): T => list[Math.floor(k.rng() * list.length)]!;
const shade = (c: Rgb, s: number): Rgb => [c[0] * s, c[1] * s, c[2] * s];

function paint(k: Kit, mat: Mat, c: Rgb): ReturnType<Kit['geo']['use']> {
  return k.geo.use(mat).tint(c[0], c[1], c[2]);
}

/** A box in the current frame, painted, with its collider. */
function solid(k: Kit, mat: Mat, c: Rgb, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, bev = 0.04): void {
  paint(k, mat, c);
  k.block(mat, x0, y0, z0, x1, y1, z1, bev);
  k.geo.tint(1);
}

/** A dyed cloth awning over a door or a stall, sloping down to its front (+Z). */
export function awning(k: Kit, x: number, y: number, z: number, yaw: number, w: number, d: number, dye: Rgb, stripes = true): void {
  const g = k.geo;
  k.push(x, y, z, yaw, 0, 0);
  const n = stripes ? Math.max(2, Math.round(w / 0.5)) : 1;
  for (let i = 0; i < n; i++) {
    const u0 = -w / 2 + (i * w) / n, u1 = u0 + w / n;
    const c = stripes && i % 2 ? [0.9, 0.88, 0.8] as const : dye;
    g.use('paintWhite').tint(c[0] * 1.15, c[1] * 1.15, c[2] * 1.15);
    g.quad(u0, 0, 0, u1, 0, 0, u1, -0.45, d, u0, -0.45, d);
    g.quad(u1, 0, 0, u0, 0, 0, u0, -0.45, d, u1, -0.45, d);
    // The scalloped valance.
    g.quad(u0, -0.45, d, u1, -0.45, d, u1, -0.72, d + 0.02, u0, -0.72, d + 0.02);
    g.quad(u1, -0.45, d, u0, -0.45, d, u0, -0.72, d + 0.02, u1, -0.72, d + 0.02);
  }
  g.tint(1);
  k.pop();
}

/** A painted door, lit or not, its frame and a step. On the +Z face of the current frame at `u`. */
function door(k: Kit, u: number, face: number, c: Rgb, lit: boolean): void {
  const g = k.geo;
  paint(k, 'paintWhite', shade(c, 0.55)).box(u, 1.05, face + 0.02, 0.55, 1.05, 0.02, FACE.pz);
  g.use(lit ? 'emissiveOrange' : 'steelDark').tint(lit ? 0.7 : 0.5).box(u, 1.0, face + 0.045, 0.42, 0.95, 0.005, FACE.pz);
  g.tint(1);
}

function window(k: Kit, u: number, y: number, face: number, lit: boolean, shutter: Rgb): void {
  const g = k.geo;
  g.use('steelDark').box(u, y, face + 0.02, 0.5, 0.4, 0.02, FACE.pz);
  g.use(lit ? 'emissiveOrange' : 'glass').tint(lit ? 0.85 : 1).box(u, y, face + 0.045, 0.4, 0.31, 0.005, FACE.pz);
  paint(k, 'plywood', shutter);
  g.box(u - 0.72, y, face + 0.05, 0.2, 0.42, 0.02, FACE.pz | FACE.px | FACE.nx);
  g.box(u + 0.72, y, face + 0.05, 0.2, 0.42, 0.02, FACE.pz | FACE.px | FACE.nx);
  g.tint(1);
}

/**
 * A row of shanty houses built wall to wall: one box with its own collider, each house a different colour along the front (+Z, local)
 * with a door, windows, an awning, and a roof at `h`. A roof at LEVEL.roof is a floor: a lip round it, clutter on it.
 */
export function terrace(k: Kit, site: Site, x: number, z: number, yaw: number, len: number, depth: number, h: number = LEVEL.roof, backFace = false): void {
  const g = k.geo, hx = len / 2, hz = depth / 2;
  k.push(x, 0, z, yaw);
  // The core, in the shade of the first house, and its collider.
  k.collide(0, h / 2, 0, hx, h / 2, hz, 'concrete');
  const houses = Math.max(1, Math.round(len / 4.2));
  const each = len / houses;
  for (let i = 0; i < houses; i++) {
    const u0 = -hx + i * each, u = u0 + each / 2;
    const c = pick(k, PAINTS), top = h + (k.rng() < 0.3 ? 0.18 : 0);
    paint(k, 'paintWhite', c);
    g.box(u, top / 2, 0, each / 2 - 0.01, top / 2, hz, FACE.pz | FACE.nz | (i === 0 ? FACE.nx : 0) | (i === houses - 1 ? FACE.px : 0));
    // A band of darker paint at the foot, splashed salt on it.
    paint(k, 'paintWhite', shade(c, 0.6)).box(u, 0.3, hz + 0.012, each / 2 - 0.02, 0.3, 0.01, FACE.pz);
    g.use('paintWhite').tint(0.9, 0.9, 0.86).box(u, 0.04, hz + 0.02, each / 2 - 0.02, 0.04, 0.01, FACE.pz);
    const lit = k.rng() < 0.55;
    if (each > 3.2) {
      door(k, u - each / 4 + 0.3, hz, c, lit);
      window(k, u + each / 4 - 0.1, 1.55, hz, k.rng() < 0.5, pick(k, DYES));
      if (k.rng() < 0.7) awning(k, u - each / 4 + 0.3, 2.45, hz, 0, 1.8, 0.9, pick(k, DYES));
    } else {
      door(k, u, hz, c, lit);
    }
    if (backFace) window(k, -u, 1.55, hz, false, pick(k, DYES));
    if (lit && k.rng() < 0.4) wallLamp(k, u, 2.6, hz + 0.02, 0, 'orange', 12, 9);
  }
  g.tint(1);
  // The roof: a slab and, where it is a floor, a low lip and the clutter of people who live up there.
  g.use('concreteDark').tint(0.6).box(0, h + 0.03, 0, hx + 0.08, 0.03, hz + 0.08, FACE.py | FACE.sides);
  if (h === LEVEL.roof) {
    paint(k, 'paintWhite', [0.86, 0.84, 0.78]);
    g.box(0, h + 0.2, hz - 0.08, hx, 0.17, 0.08, FACE.all);
    g.box(0, h + 0.2, -hz + 0.08, hx, 0.17, 0.08, FACE.all);
    g.tint(1);
    if (len > 6 && k.rng() < 0.8) {
      const u = (k.rng() - 0.5) * (len - 4);
      g.use('paintWhite').tint(0.3, 0.42, 0.62).cyl(u, h, -hz + 1.0, u, h + 1.2, -hz + 1.0, 0.55, 0.55, 10, false, true);
      g.tint(1);
    }
    if (len > 8) {
      // A washing line along the roof.
      const y = h + 1.6;
      g.use('steelDark').cyl(-hx + 0.5, h, 0, -hx + 0.5, y, 0, 0.03, 0.03, 4, false, false);
      g.cyl(hx - 0.5, h, 0, hx - 0.5, y, 0, 0.03, 0.03, 4, false, false);
      for (let u = -hx + 1.2; u < hx - 1; u += 0.9) {
        if (k.rng() < 0.4) continue;
        const c = pick(k, DYES);
        g.use('paintWhite').tint(c[0], c[1], c[2]).box(u, y - 0.35, 0, 0.3, 0.33, 0.01, FACE.pz | FACE.nz);
      }
      g.tint(1);
    }
  }
  k.pop();
  // On the minimap.
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw)), ex = hx * c + hz * s, ez = hx * s + hz * c;
  site.plan.blocks.push({ x0: x - ex, z0: z - ez, x1: x + ex, z1: z + ez });
}

/** A terrace whose footprint is the rect, its front on `face` (the side it looks out of). */
export function terraceIn(k: Kit, site: Site, r: Rect, face: 'n' | 's' | 'e' | 'w', h: number = LEVEL.roof): void {
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, dx = r.x1 - r.x0, dz = r.z1 - r.z0;
  // Front on local +Z: south is yaw 0, north π, east π/2... the kit's yaw turns +X, so +Z turns to (sin, cos).
  if (face === 's') terrace(k, site, cx, cz, 0, dx, dz, h, true);
  else if (face === 'n') terrace(k, site, cx, cz, Math.PI, dx, dz, h, true);
  else if (face === 'e') terrace(k, site, cx, cz, Math.PI / 2, dz, dx, h, true);
  else terrace(k, site, cx, cz, -Math.PI / 2, dz, dx, h, true);
}

/** A tall house over the roofs: two storeys, painted, a balcony, not a floor. */
export function tower(k: Kit, site: Site, x: number, z: number, yaw: number, w: number, d: number, h: number): void {
  const g = k.geo, c = pick(k, PAINTS);
  k.push(x, 0, z, yaw);
  solid(k, 'paintWhite', c, -w / 2, 0, -d / 2, w / 2, h, d / 2, 0.06);
  for (const y of [1.6, 4.4, 7.2]) {
    if (y > h - 0.8) break;
    for (const u of [-w / 4, w / 4]) window(k, u, y, d / 2, k.rng() < 0.5, pick(k, DYES));
  }
  door(k, 0, d / 2, c, true);
  g.use('rust').tint(0.8).box(0, 3.05, d / 2 + 0.55, w / 2 - 0.3, 0.06, 0.55, FACE.all);
  g.tint(1);
  k.rail([-w / 2 + 0.3, 3.1, d / 2 + 1.05, w / 2 - 0.3, 3.1, d / 2 + 1.05], 0.9, 1.2);
  g.use('concreteDark').tint(0.55).box(0, h + 0.05, 0, w / 2 + 0.15, 0.05, d / 2 + 0.15, FACE.py | FACE.sides);
  g.tint(1);
  k.pop();
  site.plan.blocks.push({ x0: x - Math.max(w, d) / 2, z0: z - Math.max(w, d) / 2, x1: x + Math.max(w, d) / 2, z1: z + Math.max(w, d) / 2 });
}

/** A market stall: four posts, a dyed awning, a counter to crouch behind (its collider), crates and goods on it. Front is +Z. */
export function stall(k: Kit, site: Site, x: number, z: number, yaw: number, dye: Rgb): void {
  const g = k.geo, hw = STALL.w / 2, hd = STALL.d / 2;
  k.push(x, 0, z, yaw);
  g.use('rust').tint(0.7);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.cyl(sx * (hw - 0.06), 0, sz * (hd - 0.06), sx * (hw - 0.06), STALL.awning + (sz < 0 ? 0.3 : 0), sz * (hd - 0.06), 0.04, 0.04, 5, false, true);
  g.tint(1);
  // The counter: planks on trestles, painted boards on its front.
  paint(k, 'plywood', shade(pick(k, PAINTS), 0.9));
  g.box(0, STALL.counter / 2, hd - 0.25, hw - 0.1, STALL.counter / 2, 0.22, FACE.all);
  k.collide(0, STALL.counter / 2, hd - 0.25, hw - 0.1, STALL.counter / 2, 0.24, 'dirt', true);
  // What is for sale: fish, salt, cloth, tins.
  for (let u = -hw + 0.45; u < hw - 0.3; u += 0.55) {
    const c = k.rng() < 0.5 ? pick(k, DYES) : ([0.86, 0.86, 0.82] as Rgb);
    paint(k, 'paintWhite', c).box(u, STALL.counter + 0.08, hd - 0.25, 0.22, 0.08, 0.16, FACE.noBottom);
  }
  g.tint(1);
  awning(k, 0, STALL.awning + 0.3, -hd, 0, STALL.w + 0.3, STALL.d + 0.2, dye, k.rng() < 0.6);
  k.pop();
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  site.plan.blocks.push({ x0: x - hw * c - hd * s, z0: z - hw * s - hd * c, x1: x + hw * c + hd * s, z1: z + hw * s + hd * c });
}

/** Triangular pennants on a sagging line. No collider. */
export function bunting(k: Kit, ax: number, ay: number, az: number, bx: number, by: number, bz: number, sag = 0.8): void {
  const g = k.geo, len = Math.hypot(bx - ax, bz - az), n = Math.max(3, Math.round(len / 0.7));
  cable(k, ax, ay, az, bx, by, bz, sag, 0.012);
  const ux = (bx - ax) / len, uz = (bz - az) / len;
  for (let i = 1; i < n; i++) {
    const t = i / n, y = ay + (by - ay) * t - sag * 4 * t * (1 - t);
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    const c = DYES[(((i + Math.round(ax)) % DYES.length) + DYES.length) % DYES.length]!;
    g.use('paintWhite').tint(c[0] * 1.2, c[1] * 1.2, c[2] * 1.2);
    const h = 0.22;
    g.tri(x - ux * h, y, z - uz * h, x + ux * h, y, z + uz * h, x, y - 0.42, z);
    g.tri(x + ux * h, y, z + uz * h, x - ux * h, y, z - uz * h, x, y - 0.42, z);
  }
  g.tint(1);
}

/** A string of bare bulbs on a sagging cable, each one emissive; one baked light in the middle if `light`. */
export function bulbs(k: Kit, ax: number, ay: number, az: number, bx: number, by: number, bz: number, mat: Mat = 'emissiveOrange', light = 0): void {
  const g = k.geo, len = Math.hypot(bx - ax, bz - az), n = Math.max(3, Math.round(len / 1.4)), sag = Math.min(1.2, len * 0.06);
  cable(k, ax, ay, az, bx, by, bz, sag, 0.012);
  g.use(mat);
  for (let i = 1; i < n; i++) {
    const t = i / n, y = ay + (by - ay) * t - sag * 4 * t * (1 - t) - 0.08;
    g.box(ax + (bx - ax) * t, y, az + (bz - az) * t, 0.06, 0.08, 0.06, FACE.all);
  }
  if (light > 0) k.light((ax + bx) / 2, (ay + by) / 2 - sag - 0.3, (az + bz) / 2, mat === 'emissiveCyan' ? 'cyan' : mat === 'emissiveMagenta' ? 'magenta' : 'orange', light, 10);
}

/** A cloth banner hung flat on a wall, a stripe across it. Local +Z is out of the wall. */
export function banner(k: Kit, x: number, y: number, z: number, yaw: number, w: number, h: number, dye: Rgb): void {
  const g = k.geo;
  k.push(x, y, z, yaw);
  g.use('paintWhite').tint(dye[0] * 1.2, dye[1] * 1.2, dye[2] * 1.2).box(0, -h / 2, 0.03, w / 2, h / 2, 0.01, FACE.pz | FACE.nz);
  const o = pick(k, DYES);
  g.tint(o[0], o[1], o[2]).box(0, -h * 0.55, 0.045, w / 2, h * 0.1, 0.004, FACE.pz);
  g.use('rust').tint(0.6).cyl(-w / 2 - 0.1, 0.02, 0.05, w / 2 + 0.1, 0.02, 0.05, 0.03, 0.03, 4, true, true);
  g.tint(1);
  k.pop();
}

/** A flag on a pole. */
export function flag(k: Kit, x: number, y: number, z: number, h: number, yaw: number, dye: Rgb): void {
  const g = k.geo;
  g.use('steelDark').cyl(x, y, z, x, y + h, z, 0.05, 0.04, 6, false, true);
  k.push(x, y + h - 0.1, z, yaw);
  g.use('paintWhite').tint(dye[0] * 1.2, dye[1] * 1.2, dye[2] * 1.2);
  g.quad(0, 0, 0, 1.6, -0.1, 0.12, 1.6, -0.9, 0.12, 0, -1.0, 0);
  g.quad(1.6, -0.1, 0.12, 0, 0, 0, 0, -1.0, 0, 1.6, -0.9, 0.12);
  g.tint(1);
  k.pop();
}

/** A burning drum: orange light to steer by, and something to crouch behind. */
export function brazier(k: Kit, x: number, z: number, y = 0, light = 20): void {
  const g = k.geo;
  g.use('rust').cyl(x, y, z, x, y + 0.9, z, 0.3, 0.3, 10, false, false);
  g.use('emissiveOrange').cyl(x, y + 0.86, z, x, y + 0.88, z, 0.27, 0.27, 10, false, true);
  k.collide(x, y + 0.45, z, 0.3, 0.45, 0.3, 'metal');
  if (light > 0) k.light(x, y + 1.6, z, 'orange', light, 11);
}

/** The Harbourmaster's loudspeakers: a pole with horns pointing four ways. */
export function loudspeaker(k: Kit, x: number, z: number, h: number, y = 0): void {
  const g = k.geo;
  g.use('steelDark').cyl(x, y, z, x, y + h, z, 0.1, 0.08, 6, false, true);
  k.collide(x, y + h / 2, z, 0.12, h / 2, 0.12, 'metal', false);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + 0.4;
    k.push(x, y + h - 0.4 - (i % 2) * 0.5, z, a, -0.15, 0);
    g.use('paintWhite').tint(0.85, 0.8, 0.66).cyl(0.1, 0, 0, 0.75, 0, 0, 0.1, 0.32, 10, true, false);
    g.tint(1);
    k.pop();
  }
}

/** A rusting hull, keel down: a dead boat on the flats or on the shed's slipway. Local +X along it. */
export function hull(k: Kit, x: number, y: number, z: number, yaw: number, len: number, beam: number, roll = 0): void {
  const g = k.geo;
  k.push(x, y, z, yaw, 0, roll);
  const ribs = Math.max(4, Math.round(len / 1.4));
  const hb = beam / 2, depth = beam * 0.62;
  // Plates as a run of quads along each side, narrowing at bow and stern; a few plates missing so the ribs show.
  for (let i = 0; i < ribs; i++) {
    const u0 = -len / 2 + (i * len) / ribs, u1 = u0 + len / ribs;
    const w0 = hb * Math.sqrt(Math.max(0.05, 1 - (2 * u0 / len) ** 4)), w1 = hb * Math.sqrt(Math.max(0.05, 1 - (2 * u1 / len) ** 4));
    if (k.rng() < 0.18) continue;
    const t = 0.55 + k.rng() * 0.35;
    g.use('rust').tint(t, t * 0.85, t * 0.75);
    for (const s of [1, -1]) {
      if (s > 0) g.quad(u0, 0, s * w0 * 0.4, u1, 0, s * w1 * 0.4, u1, depth, s * w1, u0, depth, s * w0);
      else g.quad(u1, 0, s * w1 * 0.4, u0, 0, s * w0 * 0.4, u0, depth, s * w0, u1, depth, s * w1);
    }
    g.use('steelDark').tint(0.7).box(u0, depth / 2, 0, 0.06, depth / 2, w0 * 0.85, FACE.px | FACE.nx | FACE.py);
  }
  // A painted waterline that has not seen water in years.
  g.use('paintWhite').tint(0.2, 0.5, 0.62).box(0, depth * 0.35, hb * 0.72, len * 0.4, 0.12, 0.01, FACE.pz);
  g.tint(1);
  k.collide(0, depth / 2, 0, len / 2 * 0.92, depth / 2, hb * 0.8, 'metal');
  k.pop();
}

/** A shanty house standing alone: a terrace of one, a stair up its side to a flat roof when `roof`. Front on local +Z. */
export function shanty(k: Kit, site: Site, x: number, z: number, yaw: number, w: number, d: number, roof: boolean): void {
  terrace(k, site, x, z, yaw, w, d, roof ? LEVEL.roof : 2.6 + k.rng() * 0.6, true);
  if (!roof) return;
  // Stairs up the +X end, heading back along the side to the roof's edge.
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (u: number, v: number): [number, number] => [x + u * c + v * s, z - u * s + v * c];
  const [ax, az] = at(w / 2 + 0.75, d / 2 + 1.4), [bx, bz] = at(w / 2 + 0.75, d / 2 - 3.6);
  site.stairs(ax, az, 0, bx, bz, LEVEL.roof, 1.4, 'concrete');
}
