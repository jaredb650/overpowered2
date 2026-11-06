/**
 * Signed-distance modelling kit. A Shape is a distance closure plus a conservative bounding box;
 * the box is what lets the polygonizer and the texture baker skip almost all of the model at any point.
 * Closures never allocate: they are called hundreds of millions of times per bake.
 */
export type V3 = readonly [number, number, number];
export type Fn = (x: number, y: number, z: number) => number;

export interface Shape {
  f: Fn;
  lo: V3;
  hi: V3;
}

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const mix = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const sstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const boxOf = (lo: V3, hi: V3, pad: number): { lo: V3; hi: V3 } => ({
  lo: [lo[0] - pad, lo[1] - pad, lo[2] - pad],
  hi: [hi[0] + pad, hi[1] + pad, hi[2] + pad],
});

// ------------------------------------------------------------------------------------------------
// Frames
// ------------------------------------------------------------------------------------------------

/** Orthonormal frame. Local axes are given in model space. */
export interface Frame {
  o: V3;
  x: V3;
  y: V3;
  z: V3;
}

/** Frame at `o` whose +Y runs along `yAxis`; `zHint` picks the roll. */
export function frameY(o: V3, yAxis: V3, zHint: V3 = [0, 0, 1]): Frame {
  const y = norm(yAxis);
  let x = cross(y, zHint);
  if (len(x) < 1e-5) x = cross(y, [1, 0, 0]);
  x = norm(x);
  return { o, x, y, z: cross(x, y) };
}

/** Frame at `o` whose +Z runs along `zAxis`; `yHint` picks the roll. */
export function frameZ(o: V3, zAxis: V3, yHint: V3 = [0, 1, 0]): Frame {
  const z = norm(zAxis);
  let x = cross(yHint, z);
  if (len(x) < 1e-5) x = cross([1, 0, 0], z);
  x = norm(x);
  return { o, x, y: cross(z, x), z };
}

/** Euler (XYZ radians) frame, for props and plates placed by eye. */
export function frameE(o: V3, rx = 0, ry = 0, rz = 0): Frame {
  const rot = (p: V3): V3 => {
    let [x, y, z] = p;
    let c = Math.cos(rx), s = Math.sin(rx);
    [y, z] = [y * c - z * s, y * s + z * c];
    c = Math.cos(ry); s = Math.sin(ry);
    [x, z] = [x * c + z * s, -x * s + z * c];
    c = Math.cos(rz); s = Math.sin(rz);
    [x, y] = [x * c - y * s, x * s + y * c];
    return [x, y, z];
  };
  return { o, x: rot([1, 0, 0]), y: rot([0, 1, 0]), z: rot([0, 0, 1]) };
}

export const toWorld = (fr: Frame, p: V3): V3 => [
  fr.o[0] + fr.x[0] * p[0] + fr.y[0] * p[1] + fr.z[0] * p[2],
  fr.o[1] + fr.x[1] * p[0] + fr.y[1] * p[1] + fr.z[1] * p[2],
  fr.o[2] + fr.x[2] * p[0] + fr.y[2] * p[1] + fr.z[2] * p[2],
];

/** Places a shape authored around the origin into a frame. */
export function at(fr: Frame, s: Shape): Shape {
  const [ox, oy, oz] = fr.o;
  const [ax, ay, az] = fr.x;
  const [bx, by, bz] = fr.y;
  const [cx, cy, cz] = fr.z;
  const f = s.f;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const c = toWorld(fr, [i & 1 ? s.hi[0] : s.lo[0], i & 2 ? s.hi[1] : s.lo[1], i & 4 ? s.hi[2] : s.lo[2]]);
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, c[k]!);
      hi[k] = Math.max(hi[k]!, c[k]!);
    }
  }
  return {
    f: (x, y, z) => {
      const dx = x - ox, dy = y - oy, dz = z - oz;
      return f(dx * ax + dy * ay + dz * az, dx * bx + dy * by + dz * bz, dx * cx + dy * cy + dz * cz);
    },
    lo: lo as unknown as V3,
    hi: hi as unknown as V3,
  };
}

// ------------------------------------------------------------------------------------------------
// Primitives
// ------------------------------------------------------------------------------------------------

export function sphere(c: V3, r: number): Shape {
  const [cx, cy, cz] = c;
  return {
    f: (x, y, z) => Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) - r,
    ...boxOf(c, c, r),
  };
}

/** Bound-corrected ellipsoid. Not an exact distance, close enough near the surface. */
export function ellipsoid(c: V3, r: V3): Shape {
  const [cx, cy, cz] = c;
  const [rx, ry, rz] = r;
  const ix = 1 / rx, iy = 1 / ry, iz = 1 / rz;
  const jx = ix * ix, jy = iy * iy, jz = iz * iz;
  const m = Math.max(rx, ry, rz);
  return {
    f: (x, y, z) => {
      const dx = x - cx, dy = y - cy, dz = z - cz;
      const k0 = Math.sqrt(dx * dx * jx + dy * dy * jy + dz * dz * jz);
      if (k0 < 1e-6) return -Math.min(rx, ry, rz);
      const k1 = Math.sqrt(dx * dx * jx * jx + dy * dy * jy * jy + dz * dz * jz * jz);
      return (k0 * (k0 - 1)) / k1;
    },
    ...boxOf(c, c, m),
  };
}

export function capsule(a: V3, b: V3, r: number): Shape {
  const [ax, ay, az] = a;
  const bax = b[0] - ax, bay = b[1] - ay, baz = b[2] - az;
  const inv = 1 / (bax * bax + bay * bay + baz * baz || 1e-9);
  return {
    f: (x, y, z) => {
      const px = x - ax, py = y - ay, pz = z - az;
      let h = (px * bax + py * bay + pz * baz) * inv;
      h = h < 0 ? 0 : h > 1 ? 1 : h;
      const qx = px - bax * h, qy = py - bay * h, qz = pz - baz * h;
      return Math.sqrt(qx * qx + qy * qy + qz * qz) - r;
    },
    lo: [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r],
    hi: [Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r],
  };
}

/** Exact round cone between two spheres. The workhorse for limbs. */
export function cone(a: V3, b: V3, r1: number, r2: number): Shape {
  const [ax, ay, az] = a;
  const bax = b[0] - ax, bay = b[1] - ay, baz = b[2] - az;
  const l2 = bax * bax + bay * bay + baz * baz || 1e-9;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const sr = Math.sign(rr) * rr * rr;
  const m = Math.max(r1, r2);
  return {
    f: (x, y, z) => {
      const pax = x - ax, pay = y - ay, paz = z - az;
      const yy = pax * bax + pay * bay + paz * baz;
      const zz = yy - l2;
      const qx = pax * l2 - bax * yy, qy = pay * l2 - bay * yy, qz = paz * l2 - baz * yy;
      const x2 = qx * qx + qy * qy + qz * qz;
      const y2 = yy * yy * l2;
      const z2 = zz * zz * l2;
      const k = sr * x2;
      if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
      if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
      return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
    },
    lo: [Math.min(a[0], b[0]) - m, Math.min(a[1], b[1]) - m, Math.min(a[2], b[2]) - m],
    hi: [Math.max(a[0], b[0]) + m, Math.max(a[1], b[1]) + m, Math.max(a[2], b[2]) + m],
  };
}

/** Rounded box centred on `c`. `h` is the half-size including the rounding. */
export function rbox(c: V3, h: V3, r = 0.005): Shape {
  const [cx, cy, cz] = c;
  const bx = h[0] - r, by = h[1] - r, bz = h[2] - r;
  return {
    f: (x, y, z) => {
      const qx = Math.abs(x - cx) - bx, qy = Math.abs(y - cy) - by, qz = Math.abs(z - cz) - bz;
      const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0, oz = qz > 0 ? qz : 0;
      const m = qx > qy ? (qx > qz ? qx : qz) : qy > qz ? qy : qz;
      return Math.sqrt(ox * ox + oy * oy + oz * oz) + (m < 0 ? m : 0) - r;
    },
    lo: sub(c, h),
    hi: add(c, h),
  };
}

/** Capped cylinder from `a` to `b`, edge-rounded by `round`. */
export function cyl(a: V3, b: V3, r: number, round = 0.003): Shape {
  const axis = sub(b, a);
  const L = len(axis);
  const mid = mix(a, b, 0.5);
  const hh = L / 2 - round;
  const rr = r - round;
  const local: Shape = {
    f: (x, y, z) => {
      const dx = Math.sqrt(x * x + z * z) - rr, dy = Math.abs(y) - hh;
      const ox = dx > 0 ? dx : 0, oy = dy > 0 ? dy : 0;
      return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(dx, dy), 0) - round;
    },
    lo: [-r, -L / 2, -r],
    hi: [r, L / 2, r],
  };
  return at(frameY(mid, axis), local);
}

/** Truncated cone from `a` (radius ra) to `b` (radius rb), with hard caps. */
export function frustum(a: V3, b: V3, ra: number, rb: number, round = 0.002): Shape {
  const axis = sub(b, a);
  const L = len(axis);
  const mid = mix(a, b, 0.5);
  const h = L / 2;
  const local: Shape = {
    f: (x, y, z) => {
      const q0 = Math.sqrt(x * x + z * z), q1 = y;
      const k1x = rb, k1y = h;
      const k2x = rb - ra, k2y = 2 * h;
      const cax = q0 - Math.min(q0, q1 < 0 ? ra : rb), cay = Math.abs(q1) - h;
      const t = clamp(((k1x - q0) * k2x + (k1y - q1) * k2y) / (k2x * k2x + k2y * k2y));
      const cbx = q0 - k1x + k2x * t, cby = q1 - k1y + k2y * t;
      const s = cbx < 0 && cay < 0 ? -1 : 1;
      return s * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby)) - round;
    },
    lo: [-Math.max(ra, rb) - round, -h - round, -Math.max(ra, rb) - round],
    hi: [Math.max(ra, rb) + round, h + round, Math.max(ra, rb) + round],
  };
  return at(frameY(mid, axis), local);
}

/** Torus in the plane normal to `axis`. */
export function torus(c: V3, axis: V3, R: number, r: number): Shape {
  const local: Shape = {
    f: (x, y, z) => {
      const q = Math.sqrt(x * x + z * z) - R;
      return Math.sqrt(q * q + y * y) - r;
    },
    lo: [-R - r, -r, -R - r],
    hi: [R + r, r, R + r],
  };
  return at(frameY(c, axis), local);
}

/** Hexagonal prism along +Y of a frame. Bolts and nuts. */
export function hexBolt(c: V3, axis: V3, r: number, h: number): Shape {
  const local: Shape = {
    f: (x, y, z) => {
      const ax = Math.abs(x), az = Math.abs(z);
      const hex = Math.max(ax * 0.866 + az * 0.5, az) - r;
      const dy = Math.abs(y) - h;
      return Math.min(Math.max(hex, dy), 0) + Math.sqrt(Math.max(hex, 0) ** 2 + Math.max(dy, 0) ** 2);
    },
    lo: [-r * 1.2, -h, -r * 1.2],
    hi: [r * 1.2, h, r * 1.2],
  };
  return at(frameY(c, axis), local);
}

// ------------------------------------------------------------------------------------------------
// Curves
// ------------------------------------------------------------------------------------------------

/** Catmull-Rom through `pts`, resampled to `n` segments. */
export function spline(pts: readonly V3[], n: number): V3[] {
  const out: V3[] = [];
  const seg = pts.length - 1;
  for (let i = 0; i <= n; i++) {
    const u = (i / n) * seg;
    const k = Math.min(seg - 1, Math.floor(u));
    const t = u - k;
    const p0 = pts[Math.max(0, k - 1)]!, p1 = pts[k]!, p2 = pts[k + 1]!, p3 = pts[Math.min(seg, k + 2)]!;
    const c = (a: number, b: number, cc: number, d: number) =>
      0.5 * (2 * b + (cc - a) * t + (2 * a - 5 * b + 4 * cc - d) * t * t + (3 * b - a - 3 * cc + d) * t * t * t);
    out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1]), c(p0[2], p1[2], p2[2], p3[2])]);
  }
  return out;
}

/** Cubic bezier, resampled to `n` segments. */
export function bezier(a: V3, b: V3, c: V3, d: V3, n: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
    out.push([
      a[0] * w0 + b[0] * w1 + c[0] * w2 + d[0] * w3,
      a[1] * w0 + b[1] * w1 + c[1] * w2 + d[1] * w3,
      a[2] * w0 + b[2] * w1 + c[2] * w2 + d[2] * w3,
    ]);
  }
  return out;
}

export interface TubeOptions {
  /** Corrugation: rings per meter of length. */
  ribs?: number;
  ribDepth?: number;
}

/** Tube along a polyline. Radius may vary along the length. `ribs` gives corrugated hoses. */
export function tube(pts: readonly V3[], r: number | ((t: number) => number), o: TubeOptions = {}): Shape {
  const n = pts.length - 1;
  const ax = new Float64Array(n), ay = new Float64Array(n), az = new Float64Array(n);
  const dx = new Float64Array(n), dy = new Float64Array(n), dz = new Float64Array(n);
  const inv = new Float64Array(n), s0 = new Float64Array(n), sl = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    ax[i] = a[0]; ay[i] = a[1]; az[i] = a[2];
    dx[i] = b[0] - a[0]; dy[i] = b[1] - a[1]; dz[i] = b[2] - a[2];
    const l2 = dx[i]! ** 2 + dy[i]! ** 2 + dz[i]! ** 2 || 1e-9;
    inv[i] = 1 / l2;
    s0[i] = total;
    sl[i] = Math.sqrt(l2);
    total += sl[i]!;
  }
  const radius = typeof r === 'number' ? () => r : r;
  const ribs = o.ribs ?? 0;
  const ribDepth = o.ribDepth ?? 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  let maxR = 0;
  for (let i = 0; i <= 16; i++) maxR = Math.max(maxR, radius(i / 16));
  for (const p of pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, p[k]!); hi[k] = Math.max(hi[k]!, p[k]!); }
  return {
    f: (x, y, z) => {
      let best = 1e9, bestS = 0;
      for (let i = 0; i < n; i++) {
        const px = x - ax[i]!, py = y - ay[i]!, pz = z - az[i]!;
        let h = (px * dx[i]! + py * dy[i]! + pz * dz[i]!) * inv[i]!;
        h = h < 0 ? 0 : h > 1 ? 1 : h;
        const qx = px - dx[i]! * h, qy = py - dy[i]! * h, qz = pz - dz[i]! * h;
        const d2 = qx * qx + qy * qy + qz * qz;
        if (d2 < best) { best = d2; bestS = s0[i]! + sl[i]! * h; }
      }
      let d = Math.sqrt(best) - radius(bestS / total);
      if (ribs > 0) d -= ribDepth * Math.abs(Math.sin(bestS * ribs * Math.PI));
      return d;
    },
    lo: [lo[0]! - maxR - ribDepth, lo[1]! - maxR - ribDepth, lo[2]! - maxR - ribDepth],
    hi: [hi[0]! + maxR + ribDepth, hi[1]! + maxR + ribDepth, hi[2]! + maxR + ribDepth],
  };
}

/** Flat strap along a polyline. `up` is the strap's face normal at the first point. */
export function strap(pts: readonly V3[], width: number, thick: number, up: V3): Shape {
  const n = pts.length - 1;
  const segs: { a: V3; d: V3; il2: number; s: V3; u: V3 }[] = [];
  // The side vector is carried along the curve rather than recomputed, or it flips wherever the strap turns
  // through `up`, such as over the top of a shoulder.
  let side = norm(cross(norm(sub(pts[1]!, pts[0]!)), up));
  for (let i = 0; i < n; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const d = sub(b, a);
    const t = norm(d);
    side = norm(sub(side, scale(t, dot(side, t))));
    const s = side;
    const u = cross(s, t);
    segs.push({ a, d, il2: 1 / (dot(d, d) || 1e-9), s, u });
  }
  const w = width / 2, h = thick / 2;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, p[k]!); hi[k] = Math.max(hi[k]!, p[k]!); }
  const pad = Math.max(w, h);
  return {
    f: (x, y, z) => {
      let best = 1e9;
      for (let i = 0; i < n; i++) {
        const g = segs[i]!;
        const px = x - g.a[0], py = y - g.a[1], pz = z - g.a[2];
        let t = (px * g.d[0] + py * g.d[1] + pz * g.d[2]) * g.il2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = px - g.d[0] * t, qy = py - g.d[1] * t, qz = pz - g.d[2] * t;
        const across = Math.abs(qx * g.s[0] + qy * g.s[1] + qz * g.s[2]) - w;
        const face = Math.abs(qx * g.u[0] + qy * g.u[1] + qz * g.u[2]) - h;
        const ox = across > 0 ? across : 0, oy = face > 0 ? face : 0;
        const d = Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(across, face), 0);
        if (d < best) best = d;
      }
      return best;
    },
    lo: [lo[0]! - pad, lo[1]! - pad, lo[2]! - pad],
    hi: [hi[0]! + pad, hi[1]! + pad, hi[2]! + pad],
  };
}

// ------------------------------------------------------------------------------------------------
// Combinators
// ------------------------------------------------------------------------------------------------

/** Polynomial smooth minimum. `k` is the blend width in meters. */
export const smin = (a: number, b: number, k: number) => {
  const h = k - Math.abs(a - b);
  const m = a < b ? a : b;
  return h > 0 ? m - (h * h) / (4 * k) : m;
};
export const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

const merged = (shapes: readonly Shape[], pad = 0): { lo: V3; hi: V3 } => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const s of shapes) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, s.lo[k]!);
      hi[k] = Math.max(hi[k]!, s.hi[k]!);
    }
  }
  return boxOf(lo as unknown as V3, hi as unknown as V3, pad);
};

export function union(...shapes: Shape[]): Shape {
  const fs = shapes.map(s => s.f);
  const n = fs.length;
  return {
    f: (x, y, z) => {
      let d = 1e9;
      for (let i = 0; i < n; i++) {
        const v = fs[i]!(x, y, z);
        if (v < d) d = v;
      }
      return d;
    },
    ...merged(shapes),
  };
}

export function blend(k: number, ...shapes: Shape[]): Shape {
  const fs = shapes.map(s => s.f);
  const n = fs.length;
  return {
    f: (x, y, z) => {
      let d = 1e9;
      for (let i = 0; i < n; i++) d = smin(d, fs[i]!(x, y, z), k);
      return d;
    },
    ...merged(shapes, k * 0.5),
  };
}

export function cut(a: Shape, b: Shape, k = 0): Shape {
  const fa = a.f, fb = b.f;
  return {
    f: k > 0 ? (x, y, z) => smax(fa(x, y, z), -fb(x, y, z), k) : (x, y, z) => Math.max(fa(x, y, z), -fb(x, y, z)),
    lo: a.lo,
    hi: a.hi,
  };
}

export function inter(a: Shape, b: Shape, k = 0): Shape {
  const fa = a.f, fb = b.f;
  const lo: V3 = [Math.max(a.lo[0], b.lo[0]), Math.max(a.lo[1], b.lo[1]), Math.max(a.lo[2], b.lo[2])];
  const hi: V3 = [Math.min(a.hi[0], b.hi[0]), Math.min(a.hi[1], b.hi[1]), Math.min(a.hi[2], b.hi[2])];
  return { f: k > 0 ? (x, y, z) => smax(fa(x, y, z), fb(x, y, z), k) : (x, y, z) => Math.max(fa(x, y, z), fb(x, y, z)), lo, hi };
}

/** Grows (t > 0) or shrinks the surface. */
export function offset(a: Shape, t: number): Shape {
  const f = a.f;
  return { f: (x, y, z) => f(x, y, z) - t, ...boxOf(a.lo, a.hi, Math.max(t, 0)) };
}

/** Hollow skin of thickness `t` centred on the surface. */
export function shell(a: Shape, t: number): Shape {
  const f = a.f;
  const h = t / 2;
  return { f: (x, y, z) => Math.abs(f(x, y, z)) - h, ...boxOf(a.lo, a.hi, h) };
}

/** Adds a displacement field. `amp` bounds the field so the bounding box stays honest. */
export function displace(a: Shape, fn: Fn, amp: number): Shape {
  const f = a.f;
  return { f: (x, y, z) => f(x, y, z) - fn(x, y, z), ...boxOf(a.lo, a.hi, amp) };
}

/** Mirrors a shape across the YZ plane, keeping both halves. */
export function mirrorX(a: Shape): Shape {
  const f = a.f;
  const m = Math.max(Math.abs(a.lo[0]), Math.abs(a.hi[0]));
  return { f: (x, y, z) => f(Math.abs(x), y, z), lo: [-m, a.lo[1], a.lo[2]], hi: [m, a.hi[1], a.hi[2]] };
}

/** Reflects a shape to the other side of the YZ plane. */
export function flipX(a: Shape): Shape {
  const f = a.f;
  return { f: (x, y, z) => f(-x, y, z), lo: [-a.hi[0], a.lo[1], a.lo[2]], hi: [-a.lo[0], a.hi[1], a.hi[2]] };
}

/** Repeats a shape along an axis `count` times at `step` spacing. Cheap rivet rows and vent slats. */
export function rows(a: Shape, axis: 0 | 1 | 2, step: number, count: number): Shape {
  const f = a.f;
  const lo = [...a.lo], hi = [...a.hi];
  hi[axis] = hi[axis]! + step * (count - 1);
  const last = count - 1;
  const pick = (v: number) => {
    const i = Math.round(v / step);
    return (i < 0 ? 0 : i > last ? last : i) * step;
  };
  const fn: Fn = axis === 0
    ? (x, y, z) => f(x - pick(x), y, z)
    : axis === 1
      ? (x, y, z) => f(x, y - pick(y), z)
      : (x, y, z) => f(x, y, z - pick(z));
  return { f: fn, lo: lo as unknown as V3, hi: hi as unknown as V3 };
}

/** Rotational repeat around Y, centred on the origin. */
export function radial(a: Shape, count: number): Shape {
  const f = a.f;
  const step = (Math.PI * 2) / count;
  const m = Math.max(Math.hypot(a.lo[0], a.lo[2]), Math.hypot(a.hi[0], a.hi[2]));
  return {
    f: (x, y, z) => {
      const ang = Math.atan2(z, x);
      const r = Math.sqrt(x * x + z * z);
      const q = ang - Math.round(ang / step) * step;
      return f(r * Math.cos(q), y, r * Math.sin(q));
    },
    lo: [-m, a.lo[1], -m],
    hi: [m, a.hi[1], m],
  };
}

// ------------------------------------------------------------------------------------------------
// Noise
// ------------------------------------------------------------------------------------------------

const PERM = new Uint8Array(512);
{
  let s = 0x9e3779b9;
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]!;
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const grad = (h: number, x: number, y: number, z: number) => {
  const q = h & 15;
  const u = q < 8 ? x : y;
  const v = q < 4 ? y : q === 12 || q === 14 ? x : z;
  return (q & 1 ? -u : u) + (q & 2 ? -v : v);
};

/** Improved Perlin noise, about -1..1. */
export function noise(x: number, y: number, z: number): number {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  const X = fx & 255, Y = fy & 255, Z = fz & 255;
  x -= fx; y -= fy; z -= fz;
  const u = fade(x), v = fade(y), w = fade(z);
  const A = PERM[X]! + Y, AA = PERM[A]! + Z, AB = PERM[A + 1]! + Z;
  const B = PERM[X + 1]! + Y, BA = PERM[B]! + Z, BB = PERM[B + 1]! + Z;
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(
      l(grad(PERM[AA]!, x, y, z), grad(PERM[BA]!, x - 1, y, z), u),
      l(grad(PERM[AB]!, x, y - 1, z), grad(PERM[BB]!, x - 1, y - 1, z), u),
      v,
    ),
    l(
      l(grad(PERM[AA + 1]!, x, y, z - 1), grad(PERM[BA + 1]!, x - 1, y, z - 1), u),
      l(grad(PERM[AB + 1]!, x, y - 1, z - 1), grad(PERM[BB + 1]!, x - 1, y - 1, z - 1), u),
      v,
    ),
    w,
  );
}

export function fbm(x: number, y: number, z: number, oct = 4): number {
  let a = 0.5, s = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise(x, y, z);
    x = x * 2.03 + 11.1; y = y * 2.03 + 3.7; z = z * 2.03 + 7.3;
    a *= 0.5;
  }
  return s;
}

/** Sharp creases, like veins and tears. 0..1 with ridges at 1. */
export function ridged(x: number, y: number, z: number, oct = 3): number {
  let a = 0.5, s = 0, w = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(noise(x, y, z));
    n *= n * w;
    w = n > 1 ? 1 : n;
    s += a * n;
    x = x * 2.1 + 5.2; y = y * 2.1 + 1.3; z = z * 2.1 + 9.1;
    a *= 0.55;
  }
  return s;
}

/** Cell noise: distance to the nearest feature point, and second nearest minus nearest in `cellEdge`. */
let cellF2 = 0;
export function cell(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let f1 = 9, f2 = 9;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const h = PERM[(PERM[(PERM[(ix + i) & 255]! + iy + j) & 255]! + iz + k) & 255]!;
    const h2 = PERM[(h + 57) & 255]!, h3 = PERM[(h2 + 113) & 255]!;
    const dx = ix + i + h / 255 - x, dy = iy + j + h2 / 255 - y, dz = iz + k + h3 / 255 - z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  cellF2 = Math.sqrt(f2);
  return Math.sqrt(f1);
}
/** Distance to the nearest cell wall after a `cell()` call at the same point. */
export const cellEdge = (f1: number) => cellF2 - f1;
