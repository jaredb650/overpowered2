/**
 * 2D outline helpers. Outlines feed Mesher.prism and its side/top/front wrappers.
 * Every corner should get a radius: a dead-sharp silhouette is what makes procedural art look procedural.
 */
export type V2 = readonly [number, number];
/** x, y and an optional corner radius that overrides the default for this corner. */
export type P2 = readonly [number, number, number?];

/** Rounds the corners of a closed polygon. Radii are clamped so neighbouring arcs never overlap. */
export function poly(pts: readonly P2[], radius = 0.0015, seg = 3): V2[] {
  const n = pts.length;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const a = pts[(i + n - 1) % n]!;
    const b = pts[(i + 1) % n]!;
    const r = p[2] ?? radius;
    if (r <= 0) {
      out.push([p[0], p[1]]);
      continue;
    }
    let ax = a[0] - p[0];
    let ay = a[1] - p[1];
    let bx = b[0] - p[0];
    let by = b[1] - p[1];
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) continue;
    ax /= la; ay /= la; bx /= lb; by /= lb;
    const cos = Math.max(-1, Math.min(1, ax * bx + ay * by));
    const half = Math.acos(cos) / 2;
    if (half > 1.54) {
      out.push([p[0], p[1]]);
      continue;
    }
    const t = Math.min(r / Math.tan(half), la * 0.48, lb * 0.48);
    const s = Math.max(1, Math.round(seg * (1 - half / (Math.PI / 2)) + 1));
    for (let k = 0; k <= s; k++) {
      const u = k / s;
      const w0 = (1 - u) * (1 - u);
      const w1 = 2 * u * (1 - u);
      const w2 = u * u;
      out.push([
        w0 * (p[0] + ax * t) + w1 * p[0] + w2 * (p[0] + bx * t),
        w0 * (p[1] + ay * t) + w1 * p[1] + w2 * (p[1] + by * t),
      ]);
    }
  }
  return out;
}

export function rect(x0: number, y0: number, x1: number, y1: number, r = 0.0015, seg = 3): V2[] {
  return poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], r, seg);
}

export function circle(cx: number, cy: number, r: number, n = 20): V2[] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

/** Stadium shape between two points. */
export function slot(x0: number, y0: number, x1: number, y1: number, r: number, n = 6): V2[] {
  const dir = Math.atan2(y1 - y0, x1 - x0);
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = dir + Math.PI / 2 + (i / n) * Math.PI;
    out.push([x0 + Math.cos(a) * r, y0 + Math.sin(a) * r]);
  }
  for (let i = 0; i <= n; i++) {
    const a = dir - Math.PI / 2 + (i / n) * Math.PI;
    out.push([x1 + Math.cos(a) * r, y1 + Math.sin(a) * r]);
  }
  return out;
}

export function ngon(cx: number, cy: number, r: number, n: number, rot = 0): V2[] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

/** Catmull-Rom through open control points, for organic outline runs such as grips. */
export function curve(pts: readonly V2[], steps = 6): V2[] {
  const out: [number, number][] = [];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(i + 2, n - 1)]!;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (p2[0] - p0[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (3 * p1[0] - p0[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (p2[1] - p0[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (3 * p1[1] - p0[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push([pts[n - 1]![0], pts[n - 1]![1]]);
  return out;
}

/** A row of evenly spaced slots between two points, ready to pass as prism holes. */
export function slotRow(x0: number, y0: number, x1: number, y1: number, count: number, length: number, width: number, angle = Math.PI / 2): V2[][] {
  const out: V2[][] = [];
  const dx = Math.cos(angle) * length * 0.5;
  const dy = Math.sin(angle) * length * 0.5;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    out.push(slot(x - dx, y - dy, x + dx, y + dy, width * 0.5, 3));
  }
  return out;
}

/** Hexagon honeycomb inside a box, as holes. Skips cells whose centre fails `keep`. */
export function honeycomb(x0: number, y0: number, x1: number, y1: number, r: number, gap: number, keep?: (x: number, y: number) => boolean): V2[][] {
  const out: V2[][] = [];
  const dx = (r * 2 + gap) * 0.866;
  const dy = (r * 2 + gap) * 0.75;
  let row = 0;
  for (let y = y0 + r; y <= y1 - r; y += dy, row++) {
    for (let x = x0 + r + (row % 2) * dx * 0.5; x <= x1 - r; x += dx) {
      if (keep && !keep(x, y)) continue;
      out.push(ngon(x, y, r, 6, Math.PI / 6));
    }
  }
  return out;
}
