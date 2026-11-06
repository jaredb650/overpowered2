/**
 * Set dressing: industrial pieces with their silhouettes worked out once, so zones can place them in a line of code.
 * Each takes a world position and a yaw and adds simple colliders that match what the player can stand on.
 */
import { FACE, type Mat } from './geo';
import { type Kit, surfaceOf, type LampColor } from './kit';

/** Pipe along [x, y, z] points with flanges at joints and every `every` meters. */
export function pipe(k: Kit, pts: readonly number[], r: number, mat: Mat = 'steel', every = 7, seg = 8, collide = false): void {
  const g = k.geo.use(mat);
  const n = pts.length / 3;
  // Rounded elbows: each corner is replaced by a short arc so the run reads as welded pipe, not a bent straw.
  const path: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3]!, y = pts[i * 3 + 1]!, z = pts[i * 3 + 2]!;
    if (i === 0 || i === n - 1) { path.push(x, y, z); continue; }
    const px = pts[i * 3 - 3]!, py = pts[i * 3 - 2]!, pz = pts[i * 3 - 1]!;
    const qx = pts[i * 3 + 3]!, qy = pts[i * 3 + 4]!, qz = pts[i * 3 + 5]!;
    const la = Math.hypot(px - x, py - y, pz - z), lb = Math.hypot(qx - x, qy - y, qz - z);
    const e = Math.min(r * 2.4, la * 0.45, lb * 0.45);
    const ax = x + ((px - x) / la) * e, ay = y + ((py - y) / la) * e, az = z + ((pz - z) / la) * e;
    const bx = x + ((qx - x) / lb) * e, by = y + ((qy - y) / lb) * e, bz = z + ((qz - z) / lb) * e;
    for (let t = 0; t <= 4; t++) {
      const f = t / 4, f1 = 1 - f;
      path.push(f1 * f1 * ax + 2 * f1 * f * x + f * f * bx, f1 * f1 * ay + 2 * f1 * f * y + f * f * by, f1 * f1 * az + 2 * f1 * f * z + f * f * bz);
    }
  }
  g.tube(path, r, seg);
  for (let i = 0; i < n - 1; i++) {
    const ax = pts[i * 3]!, ay = pts[i * 3 + 1]!, az = pts[i * 3 + 2]!;
    const bx = pts[i * 3 + 3]!, by = pts[i * 3 + 4]!, bz = pts[i * 3 + 5]!;
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const count = Math.floor(len / every);
    for (let j = 1; j <= count; j++) {
      const f = j / (count + 1);
      const cx = ax + (bx - ax) * f, cy = ay + (by - ay) * f, cz = az + (bz - az) * f;
      const dx = (bx - ax) / len, dy = (by - ay) / len, dz = (bz - az) / len;
      const w = Math.max(0.05, r * 0.16);
      k.geo.use('steelDark').cyl(cx - dx * w, cy - dy * w, cz - dz * w, cx + dx * w, cy + dy * w, cz + dz * w, r * 1.3, r * 1.3, seg, true, true);
    }
    if (collide) k.beam(ax, ay, az, bx, by, bz, r, r, mat, true);
  }
}

/** Hanging cable bundle between two points, sagging under its own weight. */
export function cable(k: Kit, ax: number, ay: number, az: number, bx: number, by: number, bz: number, sag = 1.2, r = 0.06): void {
  const pts: number[] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(ax + (bx - ax) * t, ay + (by - ay) * t - sag * 4 * t * (1 - t), az + (bz - az) * t);
  }
  k.geo.use('rubber').tube(pts, r, 4);
}

/** Vertical storage tank with ribs and a shallow dome. */
export function tank(k: Kit, x: number, z: number, y0: number, r: number, h: number, mat: Mat = 'panel', opts: { ladder?: boolean; bands?: number; seg?: number } = {}): void {
  const g = k.geo;
  const seg = opts.seg ?? 32;
  const dome = r * 0.32;
  const profile = [r + 0.25, 0, r + 0.25, 0.7, r, 0.8, r, h];
  g.use(mat).tint(0.95).lathe(profile, x, y0, z, seg, false);
  const cap: number[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = (i / 6) * Math.PI * 0.5;
    cap.push(r * Math.cos(t) + (i === 6 ? 0.001 : 0), h + dome * Math.sin(t));
  }
  g.lathe(cap, x, y0, z, seg, true);
  g.tint(1);
  const bands = opts.bands ?? Math.floor(h / 4);
  g.use('steelDark');
  for (let i = 1; i <= bands; i++) {
    const y = (i / (bands + 1)) * h;
    g.lathe([r, y - 0.14, r + 0.09, y - 0.1, r + 0.09, y + 0.1, r, y + 0.14], x, y0, z, seg, false);
  }
  if (opts.ladder !== false) {
    const a = k.rand(0, Math.PI * 2);
    const lx = x + Math.cos(a) * (r + 0.4), lz = z + Math.sin(a) * (r + 0.4);
    g.use('steelDark');
    g.box(lx - Math.sin(a) * 0.3, y0 + h / 2, lz + Math.cos(a) * 0.3, 0.03, h / 2, 0.03, FACE.sides);
    g.box(lx + Math.sin(a) * 0.3, y0 + h / 2, lz - Math.cos(a) * 0.3, 0.03, h / 2, 0.03, FACE.sides);
    const rungs = Math.floor(h / 0.9);
    for (let i = 0; i < rungs; i += 1) {
      k.beam(lx - Math.sin(a) * 0.3, y0 + i * 0.9, lz + Math.cos(a) * 0.3, lx + Math.sin(a) * 0.3, y0 + i * 0.9, lz - Math.cos(a) * 0.3, 0.02, 0.02);
    }
  }
  k.collidePrism(x, z, y0, y0 + h + dome * 0.6, r + 0.05, 20, 'metal');
}

/** Spherical pressure vessel on legs. */
export function sphereTank(k: Kit, x: number, z: number, y0: number, r: number): void {
  const g = k.geo;
  const cy = y0 + r + 3.4;
  const prof: number[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = -Math.PI / 2 + (i / 14) * Math.PI;
    prof.push(Math.max(0.001, r * Math.cos(t)), r * Math.sin(t));
  }
  g.use('paintWhite').tint(0.72, 0.76, 0.82).lathe(prof, x, cy, z, 36, true);
  g.tint(1).use('steelDark');
  g.lathe([r + 0.02, -0.16, r + 0.14, -0.1, r + 0.14, 0.1, r + 0.02, 0.16], x, cy, z, 36, false);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const lx = x + c * r * 0.92, lz = z + s * r * 0.92;
    g.use('steelDark').cyl(lx, y0, lz, lx, cy + 0.5, lz, 0.32, 0.26, 8, false, false);
    g.use('concreteDark').bevel(lx, y0 + 0.3, lz, 0.7, 0.3, 0.7, 0.06);
    k.collide(lx - x + x, y0 + (cy - y0) / 2, lz, 0.32, (cy - y0) / 2, 0.32, 'metal');
    if (i % 2 === 0) {
      const j = (i + 2) % 8;
      const b = (j / 8) * Math.PI * 2;
      k.beam(lx, y0 + 1, lz, x + Math.cos(b) * r * 0.92, cy - 1, z + Math.sin(b) * r * 0.92, 0.05, 0.05);
    }
  }
  k.collidePrism(x, z, cy - r * 0.86, cy + r * 0.86, r * 0.82, 14, 'metal', false);
  k.vox.fillCylinder(x, z, cy - r * 0.7, cy + r * 0.7, r * 0.85);
}

/** Distillation column with platforms and a stack of rings. */
export function tower(k: Kit, x: number, z: number, y0: number, r: number, h: number, platforms: readonly number[] = []): void {
  const g = k.geo;
  g.use('steel').tint(0.88).lathe([r + 1, 0, r + 1, 1.2, r, 1.5, r, h, r * 0.75, h + 1.5, r * 0.3, h + 3, r * 0.3, h + 5], x, y0, z, 20, false);
  g.tint(1).use('steelDark');
  for (let y = 5; y < h; y += 5.5) g.lathe([r, y - 0.2, r + 0.13, y - 0.14, r + 0.13, y + 0.14, r, y + 0.2], x, y0, z, 20, false);
  for (const py of platforms) {
    const pr = r + 1.8;
    g.use('grate').lathe([r, py, pr, py], x, y0, z, 18, false);
    g.use('steelDark').lathe([pr + 0.05, py - 0.2, pr + 0.05, py], x, y0, z, 18, false);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, b = ((i + 1) / 12) * Math.PI * 2;
      k.rail([x + Math.cos(a) * pr, y0 + py, z + Math.sin(a) * pr, x + Math.cos(b) * pr, y0 + py, z + Math.sin(b) * pr], 1.05, 4);
    }
    k.collide(x, y0 + py - 0.1, z, pr * 0.8, 0.1, pr * 0.8, 'grate', false);
    k.push(x, y0, z, Math.PI / 4);
    k.collide(0, py - 0.1, 0, pr * 0.8, 0.1, pr * 0.8, 'grate', false);
    k.pop();
  }
  k.collidePrism(x, z, y0, y0 + h, r + 0.05, 14, 'metal');
  // Beacon so the tower reads through fog at night.
  g.use('emissiveRed').cyl(x, y0 + h + 5, z, x, y0 + h + 5.5, z, 0.2, 0.2, 6, true, true);
}

export const CONTAINER_TINTS: readonly [number, number, number][] = [
  [0.42, 0.5, 0.6], [0.3, 0.38, 0.46], [0.54, 0.58, 0.62], [0.32, 0.42, 0.42], [0.62, 0.64, 0.68], [0.5, 0.26, 0.24],
];

export const CONTAINER = { l: 12.2, w: 2.5, h: 2.6 } as const;

/** Shipping container with real corrugation. `tint` is a colour multiplier on painted steel. */
export function container(k: Kit, x: number, y: number, z: number, yaw: number, tint?: readonly [number, number, number], collide = true, open = false): void {
  const c = tint ?? CONTAINER_TINTS[Math.floor(k.rng() * CONTAINER_TINTS.length)]!;
  const { l, w, h } = CONTAINER;
  const g = k.geo;
  k.push(x, y, z, yaw);
  const mat: Mat = 'panel';
  const shade = 0.82 + k.rng() * 0.26;
  g.use(mat).tint(c[0] * shade * 1.6, c[1] * shade * 1.6, c[2] * shade * 1.6);
  const hx = l / 2, hz = w / 2;
  // Trapezoid corrugation on both long sides.
  const pitch = 0.61;
  const ribs = Math.floor((l - 0.4) / pitch);
  const depth = 0.05;
  for (const side of [1, -1]) {
    const zf = side * hz, zb = side * (hz - depth);
    for (let i = 0; i < ribs; i++) {
      const u0 = -hx + 0.2 + i * pitch;
      const a = u0, b = u0 + pitch * 0.12, c2 = u0 + pitch * 0.5, d = u0 + pitch * 0.62, e = u0 + pitch;
      const y0 = 0.14, y1 = h - 0.12;
      if (side > 0) {
        g.quad(a, y0, zf, b, y0, zb, b, y1, zb, a, y1, zf);
        g.quad(b, y0, zb, c2, y0, zb, c2, y1, zb, b, y1, zb);
        g.quad(c2, y0, zb, d, y0, zf, d, y1, zf, c2, y1, zb);
        g.quad(d, y0, zf, e, y0, zf, e, y1, zf, d, y1, zf);
      } else {
        g.quad(b, y0, zb, a, y0, zf, a, y1, zf, b, y1, zb);
        g.quad(c2, y0, zb, b, y0, zb, b, y1, zb, c2, y1, zb);
        g.quad(d, y0, zf, c2, y0, zb, c2, y1, zb, d, y1, zf);
        g.quad(e, y0, zf, d, y0, zf, d, y1, zf, e, y1, zf);
      }
    }
  }
  // Roof, floor and end walls.
  g.box(0, h - 0.06, 0, hx, 0.06, hz, FACE.py);
  g.box(-hx + 0.03, h / 2, 0, 0.03, h / 2, hz, FACE.nx);
  if (!open) {
    // Doors at the +X end: two leaves, lock bars.
    g.box(hx - 0.03, h / 2, 0, 0.03, h / 2, hz, FACE.px);
    g.tint(c[0] * shade * 1.1, c[1] * shade * 1.1, c[2] * shade * 1.1);
    for (const s of [-0.62, -0.2, 0.2, 0.62]) g.box(hx + 0.03, h / 2, s, 0.015, h / 2 - 0.15, 0.02, FACE.px | FACE.pz | FACE.nz);
  }
  g.tint(1).use('steelDark');
  const posts = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]] as const;
  for (const [px, pz] of posts) g.box(px - Math.sign(px) * 0.08, h / 2, pz - Math.sign(pz) * 0.08, 0.08, h / 2, 0.08, FACE.sides);
  g.box(0, 0.08, hz - 0.03, hx, 0.08, 0.03, FACE.pz | FACE.nz | FACE.py);
  g.box(0, 0.08, -hz + 0.03, hx, 0.08, 0.03, FACE.pz | FACE.nz | FACE.py);
  g.box(0, h - 0.06, hz - 0.03, hx, 0.06, 0.03, FACE.pz | FACE.ny);
  g.box(0, h - 0.06, -hz + 0.03, hx, 0.06, 0.03, FACE.nz | FACE.ny);
  if (collide) k.collide(0, h / 2, 0, hx, h / 2, hz, 'metal');
  k.pop();
}

/** Column of containers. Upper ones drift a little, as they do when stacked by a tired crane. */
export function stack(k: Kit, x: number, y: number, z: number, yaw: number, levels: number): void {
  for (let i = 0; i < levels; i++) {
    const jitter = i === 0 ? 0 : k.rand(-0.06, 0.06);
    container(k, x + jitter * 2, y + i * CONTAINER.h, z + jitter, yaw + jitter * 0.25);
  }
}

/** Metro car. Local +X along the train. */
export function trainCar(k: Kit, x: number, y: number, z: number, yaw: number, opts: { lit?: boolean; tilt?: number } = {}): void {
  const L = 22, W = 3.1, H = 3.6;
  const g = k.geo;
  k.push(x, y, z, yaw, 0, opts.tilt ?? 0);
  const hx = L / 2, hz = W / 2;
  const floor = 1.05;
  // Body: rounded shoulders, sweep along X.
  const prof = [-hz, floor, -hz, floor + 2.0, -hz + 0.25, floor + H - 0.45, -hz + 0.7, floor + H - 0.15, hz - 0.7, floor + H - 0.15, hz - 0.25, floor + H - 0.45, hz, floor + 2.0, hz, floor];
  const n = prof.length / 2;
  g.use('panel').tint(0.75, 0.8, 0.86);
  for (let i = 0; i < n - 1; i++) {
    const az = prof[i * 2]!, ay = prof[i * 2 + 1]!, bz = prof[i * 2 + 2]!, by = prof[i * 2 + 3]!;
    g.grid(-hx, ay, az, 0, by - ay, bz - az, L, 0, 0, 1, 11);
  }
  g.tint(1);
  // End caps.
  g.use('steelDark');
  g.box(hx, floor + 1.7, 0, 0.05, 1.8, hz - 0.05, FACE.px);
  g.box(-hx, floor + 1.7, 0, 0.05, 1.8, hz - 0.05, FACE.nx);
  // Windows and doors on both flanks.
  for (const s of [1, -1]) {
    for (let i = 0; i < 6; i++) {
      const u = -hx + 1.8 + i * 3.7;
      g.use('steelDark').tint(0.55).box(u, floor + 1.95, s * (hz + 0.01), 1.15, 0.62, 0.015, s > 0 ? FACE.pz : FACE.nz);
      g.tint(1);
      if (opts.lit && i % 2 === 0) {
        g.use('emissiveWhite').box(u, floor + 2.42, s * (hz + 0.012), 1.0, 0.04, 0.01, s > 0 ? FACE.pz : FACE.nz);
      }
    }
    for (const u of [-hx + 4.6, hx - 4.6]) {
      g.use('steel').box(u, floor + 1.25, s * (hz + 0.02), 1.0, 1.25, 0.02, s > 0 ? FACE.pz : FACE.nz);
      g.use('steelDark').tint(0.5).box(u - 0.5, floor + 1.55, s * (hz + 0.045), 0.3, 0.55, 0.005, s > 0 ? FACE.pz : FACE.nz);
      g.box(u + 0.5, floor + 1.55, s * (hz + 0.045), 0.3, 0.55, 0.005, s > 0 ? FACE.pz : FACE.nz);
      g.tint(1);
    }
    g.use('emissiveCyan').box(0, floor + 0.55, s * (hz + 0.012), hx - 0.4, 0.035, 0.01, s > 0 ? FACE.pz : FACE.nz);
  }
  // Bogies and underframe.
  g.use('steelDark').bevel(0, floor - 0.15, 0, hx - 0.5, 0.2, hz - 0.2, 0.04);
  for (const u of [-hx + 4, hx - 4]) {
    g.use('rust').bevel(u, 0.55, 0, 1.6, 0.3, hz - 0.35, 0.05);
    for (const du of [-0.95, 0.95]) for (const s of [1, -1]) {
      g.use('steelDark').cyl(u + du, 0.42, s * 0.9, u + du, 0.42, s * 0.75, 0.42, 0.42, 10);
    }
  }
  // Roof equipment.
  g.use('steelDark');
  g.bevel(-3, floor + H, 0, 1.8, 0.16, 0.8, 0.05);
  g.bevel(4.5, floor + H, 0, 1.2, 0.2, 0.7, 0.05);
  k.collide(0, (floor + H - 0.15 + 0) / 2, 0, hx, (floor + H - 0.15) / 2, hz, 'metal');
  k.pop();
}

/** Open flatbed or hopper wagon for the freight yard. */
export function freightCar(k: Kit, x: number, y: number, z: number, yaw: number): void {
  const g = k.geo;
  k.push(x, y, z, yaw);
  const hx = 8.5, hz = 1.4;
  g.use('rust').bevel(0, 1.0, 0, hx, 0.18, hz, 0.05);
  g.use('rust').tint(0.75);
  for (const s of [1, -1]) {
    for (let i = -6; i <= 6; i++) g.bevel(i * 1.3, 2.1, s * hz, 0.08, 0.95, 0.06, 0.02);
    g.box(0, 2.1, s * (hz - 0.03), hx, 0.95, 0.03, FACE.pz | FACE.nz);
  }
  g.box(hx, 2.1, 0, 0.03, 0.95, hz, FACE.px | FACE.nx);
  g.box(-hx, 2.1, 0, 0.03, 0.95, hz, FACE.px | FACE.nx);
  g.tint(1);
  for (const u of [-5.5, 5.5]) {
    g.use('steelDark').bevel(u, 0.5, 0, 1.3, 0.28, 1.1, 0.04);
    for (const du of [-0.8, 0.8]) g.cyl(u + du, 0.42, 0.9, u + du, 0.42, -0.9, 0.42, 0.42, 10);
  }
  k.collide(0, 1.55, 0, hx, 1.55, hz, 'metal');
  k.pop();
}

/** Burnt-out heavy truck. */
export function truck(k: Kit, x: number, y: number, z: number, yaw: number, roll = 0): void {
  const g = k.geo;
  k.push(x, y, z, yaw, 0, roll);
  g.use('rust');
  g.bevel(0, 0.95, 0, 4.6, 0.16, 1.0, 0.04);
  g.use('steelDark').tint(0.7);
  g.bevel(3.4, 2.05, 0, 1.15, 0.95, 1.15, 0.2);
  g.tint(0.3).box(4.53, 2.45, 0, 0.03, 0.42, 0.95, FACE.px);
  g.tint(1).use('rust').tint(0.7);
  g.bevel(-1.3, 2.15, 0, 3.1, 1.05, 1.2, 0.05);
  g.tint(1).use('rubber');
  for (const u of [3.1, -0.4, -2.8]) for (const s of [1, -1]) g.cyl(u, 0.55, s * 1.15, u, 0.55, s * 0.7, 0.55, 0.55, 12);
  k.collide(-0.4, 1.65, 0, 4.7, 1.65, 1.25, 'metal');
  k.pop();
}

/** Wrecked wheel loader with a raised bucket. A big lump of cover. */
export function loader(k: Kit, x: number, y: number, z: number, yaw: number): void {
  const g = k.geo;
  k.push(x, y, z, yaw);
  g.use('paintYellow').tint(0.34, 0.33, 0.3);
  g.bevel(-1.6, 2.1, 0, 2.3, 1.05, 1.35, 0.12);
  g.bevel(1.4, 1.5, 0, 1.0, 0.6, 1.1, 0.1);
  g.use('steelDark').tint(0.7).bevel(-1.6, 3.8, 0, 1.25, 0.72, 1.05, 0.12);
  g.tint(1).use('rubber');
  for (const u of [-2.6, 2.0]) for (const s of [1, -1]) g.cyl(u, 1.15, s * 1.55, u, 1.15, s * 0.95, 1.15, 1.15, 14);
  k.beam(1.8, 2.0, 0.8, 4.4, 2.6, 0.8, 0.14, 0.16);
  k.beam(1.8, 2.0, -0.8, 4.4, 2.6, -0.8, 0.14, 0.16);
  g.use('rust');
  g.bevel(5.1, 2.6, 0, 0.7, 0.75, 1.8, 0.08);
  k.collide(0, 2.2, 0, 4.2, 2.2, 1.6, 'metal');
  k.collide(5.1, 2.6, 0, 0.8, 0.8, 1.8, 'metal');
  k.pop();
}

/** Nose-down VTOL wreck, the scrapyard's landmark. */
export function dropship(k: Kit, x: number, y: number, z: number, yaw: number): void {
  const g = k.geo;
  k.push(x, y, z, yaw, -0.22, 0.32);
  const prof = [0.2, -14, 2.2, -11, 3.3, -6, 3.5, 0, 3.4, 7, 2.6, 12, 0.5, 14];
  k.push(0, 0, 0, 0, Math.PI / 2, 0);
  g.use('panel').tint(0.5, 0.56, 0.62).lathe(prof, 0, 0, 0, 16, true);
  g.tint(1);
  k.pop();
  g.use('steelDark');
  for (let u = -9; u <= 10; u += 3.2) {
    k.push(u, 0, 0, 0, Math.PI / 2, 0);
    g.lathe([3.55, -0.1, 3.62, -0.05, 3.62, 0.05, 3.55, 0.1], 0, 0, 0, 16, false);
    k.pop();
  }
  // Stub wings with engine pods. One wing has sheared off.
  g.use('panel').tint(0.42, 0.46, 0.52).bevel(1, 1.4, 6.5, 2.4, 0.22, 4.6, 0.08);
  g.tint(1);
  g.use('steelDark').cyl(-2.4, 1.4, 11.5, 3.8, 1.4, 11.5, 1.5, 1.2, 14);
  g.use('rust').bevel(1, 1.4, -5, 1.8, 0.2, 2.2, 0.06);
  // Tail fins.
  g.use('panel').tint(0.42, 0.46, 0.52);
  k.beam(-10, 2.4, 1.2, -13.5, 5.4, 3.0, 0.14, 1.0, 'panel');
  k.beam(-10, 2.4, -1.2, -13.5, 5.4, -3.0, 0.14, 1.0, 'panel');
  g.tint(1);
  k.collide(0, 0, 0, 12, 3, 3, 'metal');
  k.collide(1, 1.4, 7, 2.4, 0.3, 5, 'metal');
  k.pop();
}

/** Square roof or wall vent with slats. */
export function vent(k: Kit, x: number, y: number, z: number, yaw: number, w = 1.6, h = 1.0): void {
  const g = k.geo;
  k.push(x, y, z, yaw);
  g.use('steelDark').bevel(0, 0, 0, w / 2, h / 2, 0.1, 0.03);
  g.use('steel');
  const n = Math.round(h / 0.16);
  for (let i = 0; i < n; i++) {
    const v = -h / 2 + 0.1 + (i + 0.5) * ((h - 0.2) / n);
    g.box(0, v, 0.12, w / 2 - 0.08, 0.03, 0.03, FACE.py | FACE.pz | FACE.ny);
  }
  k.pop();
}

/** Static portal crane: two A-frames and a girder. Local +Z across the span. */
export function portalCrane(k: Kit, x: number, y: number, z: number, yaw: number, span: number, height: number, walkway = true): void {
  const g = k.geo;
  k.push(x, y, z, yaw);
  for (const s of [1, -1]) {
    const zc = (s * span) / 2;
    for (const u of [-5, 5]) {
      k.beam(u, 0, zc, 0, height, zc, 0.45, 0.45, 'steelDark', true);
    }
    k.beam(-5, 3, zc, 5, 3, zc, 0.3, 0.3, 'steelDark');
    g.use('rust').bevel(0, 0.6, zc, 6.5, 0.6, 1.2, 0.08);
  }
  k.truss(0, height + 1.2, -span / 2 - 7, 0, height + 1.2, span / 2 + 7, 2.6, 3.2, 'steelDark', 0.16);
  if (walkway) {
    // Deck rides on the girder, so the crane doubles as a route.
    g.use('grate');
    g.slab(0, height + 2.7, 0, 1.8, 0.05, span / 2 + 7, 3, FACE.py | FACE.ny);
    k.collide(0, height + 2.6, 0, 1.8, 0.15, span / 2 + 7, 'grate', false);
    k.rail([1.8, height + 2.75, -span / 2 - 7, 1.8, height + 2.75, span / 2 + 7]);
    k.rail([-1.8, height + 2.75, -span / 2 - 7, -1.8, height + 2.75, span / 2 + 7]);
  }
  g.use('paintYellow').tint(0.4, 0.38, 0.34).bevel(0, height - 0.6, 3, 2, 1.1, 2.5, 0.1);
  g.tint(1);
  k.pop();
}

/** Loose chunks of broken concrete. */
export function rubble(k: Kit, x: number, y: number, z: number, radius: number, count: number, mat: Mat = 'concrete', collide = false): void {
  const g = k.geo;
  for (let i = 0; i < count; i++) {
    const a = k.rand(0, Math.PI * 2), r = radius * Math.sqrt(k.rng());
    const s = k.rand(0.2, 0.9) * (1 - (r / radius) * 0.5);
    k.push(x + Math.cos(a) * r, y + s * 0.3, z + Math.sin(a) * r, k.rand(0, 6.28), k.rand(-0.5, 0.5), k.rand(-0.5, 0.5));
    g.use(mat).tint(k.rand(0.6, 0.95));
    g.bevel(0, 0, 0, s * k.rand(0.7, 1.3), s * k.rand(0.45, 0.8), s * k.rand(0.7, 1.3), s * 0.18);
    k.pop();
  }
  g.tint(1);
  if (collide) k.collide(x, y + radius * 0.15, z, radius * 0.6, radius * 0.15, radius * 0.6, surfaceOf(mat));
}

/** Rebar sticking out of a broken slab edge. */
export function rebar(k: Kit, x: number, y: number, z: number, yaw: number, span: number, count: number): void {
  const g = k.geo.use('rust');
  k.push(x, y, z, yaw);
  for (let i = 0; i < count; i++) {
    const u = (i / (count - 1) - 0.5) * span;
    const v = k.rand(-0.8, -0.1);
    const len = k.rand(0.6, 2.4);
    const droop = k.rand(0.1, 0.9);
    g.tube([u, v, 0, u + k.rand(-0.1, 0.1), v - droop * 0.2, len * 0.5, u + k.rand(-0.2, 0.2), v - droop, len], 0.024, 4);
  }
  k.pop();
}

/** Concrete jersey barrier as low cover. */
export function barrier(k: Kit, x: number, y: number, z: number, yaw: number, len = 4, mat: Mat = 'concrete'): void {
  k.push(x, y, z, yaw);
  const g = k.geo.use(mat);
  const hx = len / 2;
  g.tint(0.9);
  g.quad(-hx, 0, 0.4, hx, 0, 0.4, hx, 0.3, 0.34, -hx, 0.3, 0.34);
  g.quad(-hx, 0.3, 0.34, hx, 0.3, 0.34, hx, 1.05, 0.14, -hx, 1.05, 0.14);
  g.quad(hx, 0, -0.4, -hx, 0, -0.4, -hx, 0.3, -0.34, hx, 0.3, -0.34);
  g.quad(hx, 0.3, -0.34, -hx, 0.3, -0.34, -hx, 1.05, -0.14, hx, 1.05, -0.14);
  g.quad(-hx, 1.05, 0.14, hx, 1.05, 0.14, hx, 1.05, -0.14, -hx, 1.05, -0.14);
  g.quad(hx, 0, 0.4, hx, 0, -0.4, hx, 1.05, -0.14, hx, 1.05, 0.14);
  g.quad(-hx, 0, -0.4, -hx, 0, 0.4, -hx, 1.05, 0.14, -hx, 1.05, -0.14);
  g.tint(1);
  k.collide(0, 0.52, 0, hx, 0.52, 0.32, 'concrete');
  k.pop();
}

/** Machinery lump: transformer, pump, capacitor bank. Fins and pipes give it a scale cue. */
export function machine(k: Kit, x: number, y: number, z: number, yaw: number, w = 3, h = 2.4, d = 2): void {
  const g = k.geo;
  k.push(x, y, z, yaw);
  g.use('concreteDark').bevel(0, 0.15, 0, w / 2 + 0.3, 0.15, d / 2 + 0.3, 0.05);
  g.use('panel').tint(0.8, 0.84, 0.9).bevel(0, h / 2 + 0.3, 0, w / 2, h / 2, d / 2, 0.08);
  g.tint(1).use('steelDark');
  const fins = Math.floor(w / 0.32);
  for (let i = 0; i < fins; i++) g.box(-w / 2 + 0.2 + i * 0.32, h * 0.55 + 0.3, d / 2 + 0.07, 0.03, h * 0.3, 0.07, FACE.py | FACE.pz | FACE.px | FACE.nx);
  g.bevel(w * 0.2, h + 0.5, 0, 0.5, 0.2, 0.5, 0.05);
  g.use('steel').cyl(-w * 0.25, h + 0.3, 0, -w * 0.25, h + 0.75, 0, 0.16, 0.16, 8);
  g.use('emissiveCyan').box(w * 0.32, h * 0.8 + 0.3, d / 2 + 0.01, 0.2, 0.05, 0.01, FACE.pz);
  k.collide(0, (h + 0.3) / 2, 0, w / 2 + 0.05, (h + 0.3) / 2, d / 2 + 0.05, 'metal');
  k.pop();
}

/** Overhead sign bridge element: signage atlas panel with a backing frame. */
export function signPanel(k: Kit, x: number, y: number, z: number, yaw: number, w: number, h: number, sign: number, lit = true): void {
  const g = k.geo;
  k.push(x, y, z, yaw);
  g.use('steelDark').bevel(0, 0, -0.08, w / 2 + 0.12, h / 2 + 0.12, 0.07, 0.03);
  g.use('signs');
  g.quadUV(-w / 2, -h / 2, 0.005, w / 2, h / 2, sign);
  if (lit) g.use('emissiveWhite').box(0, h / 2 + 0.06, 0.14, w / 2 - 0.1, 0.02, 0.1, FACE.ny);
  k.pop();
}

/** Wall lamp in a cage. */
export function wallLamp(k: Kit, x: number, y: number, z: number, yaw: number, color: LampColor = 'white', intensity = 18, radius = 14): void {
  const g = k.geo;
  k.push(x, y, z, yaw);
  g.use('steelDark').bevel(0, 0, 0.08, 0.2, 0.28, 0.08, 0.02);
  const mat: Mat = color === 'cyan' ? 'emissiveCyan' : color === 'orange' ? 'emissiveOrange' : color === 'red' ? 'emissiveRed' : 'emissiveWhite';
  g.use(mat).box(0, 0, 0.19, 0.12, 0.2, 0.03, FACE.pz | FACE.py | FACE.ny);
  if (intensity > 0) k.light(0, -0.4, 1.4, color, intensity, radius);
  k.pop();
}

/** Stack of tyres. */
export function tyres(k: Kit, x: number, y: number, z: number, n: number, collide = true): void {
  const g = k.geo.use('rubber');
  for (let i = 0; i < n; i++) {
    const r = 0.62;
    const ox = k.rand(-0.09, 0.09), oz = k.rand(-0.09, 0.09);
    g.lathe([r - 0.26, 0.04, r - 0.04, 0.03, r, 0.16, r - 0.04, 0.29, r - 0.26, 0.28, r - 0.26, 0.04], x + ox, y + i * 0.3, z + oz, 12, true);
  }
  if (collide) k.collide(x, y + n * 0.15, z, 0.55, n * 0.15, 0.55, 'concrete', false);
}

/** A mound of tangled scrap with beams and plates poking out: the Scrapyard's organic silhouette. */
export function scrapHeap(k: Kit, x: number, z: number, r: number, h: number, y = 0): void {
  const g = k.geo;
  const prof: number[] = [];
  for (let i = 0; i <= 7; i++) {
    const t = i / 7;
    prof.push(Math.max(0.15, r * (1 - t * t * 0.96) * (0.94 + 0.08 * Math.sin(i * 2.7))), h * Math.sin((t * Math.PI) / 2));
  }
  g.use('rust').tint(0.42, 0.42, 0.46).lathe(prof, x, y, z, 18, true);
  g.tint(1);
  k.collidePrism(x, z, y, y + h * 0.62, r * 0.6, 10, 'metal');
  const n = Math.round(r * r * 1.6);
  for (let i = 0; i < n; i++) {
    const a = k.rand(0, Math.PI * 2), d = r * Math.sqrt(k.rng()) * 0.92;
    const sy = y + h * Math.max(0, 1 - (d / r) * (d / r)) * 0.92;
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    k.push(px, sy, pz, k.rand(0, 6.28), k.rand(-0.7, 0.7), k.rand(-0.9, 0.9));
    const kind = k.rng();
    if (kind < 0.4) {
      g.use('rust').tint(k.rand(0.4, 0.85));
      g.bevel(0, 0, 0, k.rand(0.8, 2.4), 0.05, k.rand(0.5, 1.2), 0.02);
    } else if (kind < 0.75) {
      g.use('steelDark').tint(k.rand(0.5, 0.9));
      const l = k.rand(1.4, 3.8);
      g.box(0, 0, 0, l, 0.11, 0.11, FACE.py | FACE.ny | FACE.pz | FACE.nz);
    } else {
      g.use('panel').tint(k.rand(0.4, 0.7), k.rand(0.4, 0.7), k.rand(0.45, 0.8));
      g.bevel(0, 0, 0, k.rand(0.4, 1), k.rand(0.3, 0.7), k.rand(0.4, 1), 0.05);
    }
    k.pop();
  }
  g.tint(1);
}

/** Chain-link fence with concrete feet, along [x, z] points. */
export function fence(k: Kit, pts: readonly number[], y = 0, h = 2.6, collide = true): void {
  const g = k.geo;
  const n = pts.length / 2;
  for (let i = 0; i < n - 1; i++) {
    const ax = pts[i * 2]!, az = pts[i * 2 + 1]!, bx = pts[i * 2 + 2]!, bz = pts[i * 2 + 3]!;
    k.along(ax, y, az, bx, y, bz, len => {
      const bays = Math.max(1, Math.round(len / 3));
      g.use('grate').tint(0.7);
      g.grid(0, 0.1, 0, len, 0, 0, 0, h, 0, bays, 1);
      g.grid(len, 0.1, 0, -len, 0, 0, 0, h, 0, bays, 1);
      g.tint(1).use('steelDark');
      for (let b = 0; b <= bays; b++) {
        const u = (b / bays) * len;
        g.box(u, h / 2 + 0.1, 0, 0.035, h / 2 + 0.1, 0.035, FACE.sides);
        g.use('concreteDark').bevel(u, 0.1, 0, 0.3, 0.1, 0.18, 0.03);
        g.use('steelDark');
      }
      g.box(len / 2, h + 0.1, 0, len / 2, 0.025, 0.025, FACE.py | FACE.ny | FACE.pz | FACE.nz);
      if (collide) k.collide(len / 2, h / 2, 0, len / 2, h / 2, 0.06, 'grate', false);
    });
  }
}

/** Plain tall block dressed as a building: pilasters, window bands, a roof line. Local origin at the base centre. */
export function towerBlock(k: Kit, hx: number, hz: number, h: number, mat: Mat = 'concrete'): void {
  const g = k.geo;
  k.block(mat, -hx, 0, -hz, hx, h, hz, 0.14);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.use('concreteDark').tint(0.85).bevel(sx * (hx - 0.2), h / 2, sz * (hz - 0.2), 0.42, h / 2 + 0.1, 0.42, 0.08);
  }
  g.tint(1);
  for (let y = 3; y < h - 1.5; y += 3.3) {
    for (const s of [1, -1]) {
      g.use('steelDark').bevel(0, y, s * (hz + 0.04), hx - 1, 0.5, 0.08, 0.03);
      g.use('emissiveCyan').box(0, y, s * (hz + 0.12), hx - 1.4, 0.03, 0.02, s > 0 ? FACE.pz : FACE.nz);
      g.use('steelDark').bevel(s * (hx + 0.04), y, 0, 0.08, 0.5, hz - 1, 0.03);
    }
  }
}
