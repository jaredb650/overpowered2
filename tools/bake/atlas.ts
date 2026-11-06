/**
 * Texture bake. The simplified mesh gets a chart-based UV atlas, then every texel is projected back onto the
 * full-detail distance field: normals, colour, roughness, metalness and emissive all come from the SDF, so
 * seams, rivets and skin folds finer than the triangle budget survive as texels.
 *
 * Normals are stored in object space. A skinned object-space map needs no tangents, which means no tangent
 * seams and no per-vertex tangent data; the vertex shader passes the skin rotation instead.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelMeta } from '../../src/characters/format';
import { Field, type MatSample } from './model';
import type { RawMesh } from './polygonize';
import { encodePng } from './png';
import { OUT_DIR } from './write';
import { clamp, fbm, noise, sstep } from './sdf';

export interface Unwrapped {
  /** New vertex to original vertex. */
  remap: Int32Array;
  /** Normalized u16 pairs. */
  uv: Uint16Array;
  indices: Uint32Array;
  /** Atlas-space float uv per new vertex, in 0..1. */
  uvf: Float32Array;
}

const COS_LIMIT = Math.cos((62 * Math.PI) / 180);

interface Chart {
  tris: number[];
  nx: number;
  ny: number;
  nz: number;
  /** Projected vertex position in meters, keyed by original vertex. */
  uv: Map<number, [number, number]>;
  w: number;
  h: number;
  minU: number;
  minV: number;
  /** Placement in texels. */
  x: number;
  y: number;
}

function buildCharts(mesh: RawMesh, labels: Uint8Array | null): Chart[] {
  const idx = mesh.indices;
  const P = mesh.positions;
  const nt = idx.length / 3;
  const fn = new Float32Array(nt * 3);
  const area = new Float32Array(nt);
  const edge = new Map<number, number[]>();
  const nv = P.length / 3;
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3]!, b = idx[t * 3 + 1]!, c = idx[t * 3 + 2]!;
    const ux = P[b * 3]! - P[a * 3]!, uy = P[b * 3 + 1]! - P[a * 3 + 1]!, uz = P[b * 3 + 2]! - P[a * 3 + 2]!;
    const vx = P[c * 3]! - P[a * 3]!, vy = P[c * 3 + 1]! - P[a * 3 + 1]!, vz = P[c * 3 + 2]! - P[a * 3 + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1e-12;
    fn[t * 3] = nx / l; fn[t * 3 + 1] = ny / l; fn[t * 3 + 2] = nz / l;
    area[t] = l / 2;
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const k = Math.min(p, q) * nv + Math.max(p, q);
      const list = edge.get(k);
      if (list) list.push(t); else edge.set(k, [t]);
    }
  }
  const nbr: number[][] = Array.from({ length: nt }, () => []);
  for (const list of edge.values()) {
    // Surface nets pinches thin layers into edges shared by four triangles. Treating those as borders would
    // shatter the charts, so triangles on one link up with whichever partners face the same way.
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!, b = list[j]!;
      if (list.length > 2 && fn[a * 3]! * fn[b * 3]! + fn[a * 3 + 1]! * fn[b * 3 + 1]! + fn[a * 3 + 2]! * fn[b * 3 + 2]! < 0.3) continue;
      nbr[a]!.push(b);
      nbr[b]!.push(a);
    }
  }
  // Per-triangle bone label, cleaned by a neighbour vote so a stray vertex at a joint does not split a chart.
  const label = new Int16Array(nt);
  if (labels) {
    for (let t = 0; t < nt; t++) {
      const a = labels[idx[t * 3]!]!, b = labels[idx[t * 3 + 1]!]!, c = labels[idx[t * 3 + 2]!]!;
      label[t] = b === c ? b : a;
    }
    for (let pass = 0; pass < 3; pass++) {
      const next = label.slice();
      for (let t = 0; t < nt; t++) {
        const votes = new Map<number, number>();
        for (const u of nbr[t]!) votes.set(label[u]!, (votes.get(label[u]!) ?? 0) + 1);
        let best = label[t]!, count = votes.get(best) ?? 0;
        for (const [l, n] of votes) if (n > count + 1) { best = l; count = n; }
        next[t] = best;
      }
      label.set(next);
    }
  }
  const owner = new Int32Array(nt).fill(-1);
  const order = Array.from({ length: nt }, (_, i) => i).sort((a, b) => area[b]! - area[a]!);
  const charts: Chart[] = [];
  for (const seed of order) {
    if (owner[seed]! >= 0) continue;
    const id = charts.length;
    const ch: Chart = { tris: [], nx: fn[seed * 3]!, ny: fn[seed * 3 + 1]!, nz: fn[seed * 3 + 2]!, uv: new Map(), w: 0, h: 0, minU: 0, minV: 0, x: 0, y: 0 };
    let sx = 0, sy = 0, sz = 0;
    const stack = [seed];
    owner[seed] = id;
    while (stack.length) {
      const t = stack.pop()!;
      ch.tris.push(t);
      sx += fn[t * 3]! * area[t]!; sy += fn[t * 3 + 1]! * area[t]!; sz += fn[t * 3 + 2]! * area[t]!;
      const l = Math.hypot(sx, sy, sz) || 1;
      ch.nx = sx / l; ch.ny = sy / l; ch.nz = sz / l;
      for (const u of nbr[t]!) {
        if (owner[u]! >= 0) continue;
        // Charts stop at bone boundaries. Limb-sized charts pack tightly; a chart wandering from arm to
        // torso wastes most of its bounding rectangle.
        if (label[u] !== label[seed]) continue;
        const d = fn[u * 3]! * ch.nx + fn[u * 3 + 1]! * ch.ny + fn[u * 3 + 2]! * ch.nz;
        if (d > COS_LIMIT) {
          owner[u] = id;
          stack.push(u);
        }
      }
    }
    charts.push(ch);
  }
  if (process.env.BAKE_DEBUG) console.log(`  charts before merge: ${charts.length}`);
  return mergeSlivers(charts, owner, nbr, fn, area);
}

/**
 * Hard-surface models shatter into bevel-sized charts, and each one costs padding on every side. Small charts
 * fold into a neighbour as long as they still face its projection plane.
 */
function mergeSlivers(charts: Chart[], owner: Int32Array, nbr: number[][], fn: Float32Array, area: Float32Array): Chart[] {
  const alive = charts.map(() => true);
  const chartArea = charts.map(c => c.tris.reduce((s, t) => s + area[t]!, 0));
  // Facing limits relax as the charts in question get smaller: a sliver a few millimetres wide can sit almost
  // edge-on to its host, and the smear across it is invisible next to what its padding would cost.
  const rounds: readonly (readonly [number, number])[] = [
    [0.012, 0.3], [0.006, 0.12], [0.003, 0.02], [0.0012, -0.2], [0.0012, -0.2],
  ];
  for (const [maxArea, facing] of rounds) {
    const order = charts.map((_, i) => i).filter(i => alive[i]).sort((a, b) => chartArea[a]! - chartArea[b]!);
    for (const id of order) {
      const c = charts[id]!;
      if (!alive[id] || chartArea[id]! > maxArea) continue;
      const shared = new Map<number, number>();
      for (const t of c.tris) for (const u of nbr[t]!) {
        const o = owner[u]!;
        if (o !== id) shared.set(o, (shared.get(o) ?? 0) + 1);
      }
      const best = [...shared.entries()].sort((a, b) => b[1] - a[1]);
      for (const [other] of best) {
        const n = charts[other]!;
        let ok = true;
        for (const t of c.tris) {
          if (fn[t * 3]! * n.nx + fn[t * 3 + 1]! * n.ny + fn[t * 3 + 2]! * n.nz < facing) { ok = false; break; }
        }
        if (!ok) continue;
        for (const t of c.tris) { owner[t] = other; n.tris.push(t); }
        chartArea[other] = chartArea[other]! + chartArea[id]!;
        alive[id] = false;
        break;
      }
    }
  }
  return charts.filter((_, i) => alive[i]);
}

function project(mesh: RawMesh, ch: Chart): void {
  const idx = mesh.indices, P = mesh.positions;
  const { nx, ny, nz } = ch;
  let ax = Math.abs(nx) < 0.7 ? 1 : 0, ay = ax ? 0 : 1, az = 0;
  const d = ax * nx + ay * ny + az * nz;
  ax -= nx * d; ay -= ny * d; az -= nz * d;
  const l = Math.hypot(ax, ay, az) || 1;
  ax /= l; ay /= l; az /= l;
  const bx = ny * az - nz * ay, by = nz * ax - nx * az, bz = nx * ay - ny * ax;
  const pts = ch.uv;
  for (const t of ch.tris) {
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k]!;
      if (pts.has(v)) continue;
      const x = P[v * 3]!, y = P[v * 3 + 1]!, z = P[v * 3 + 2]!;
      pts.set(v, [x * ax + y * ay + z * az, x * bx + y * by + z * bz]);
    }
  }
  // Principal axis alignment shrinks the bounding rectangle of long limb charts.
  let mu = 0, mv = 0;
  for (const [u, v] of pts.values()) { mu += u; mv += v; }
  mu /= pts.size; mv /= pts.size;
  let suu = 0, svv = 0, suv = 0;
  for (const [u, v] of pts.values()) {
    suu += (u - mu) ** 2; svv += (v - mv) ** 2; suv += (u - mu) * (v - mv);
  }
  const ang = 0.5 * Math.atan2(2 * suv, suu - svv);
  const c = Math.cos(-ang), s = Math.sin(-ang);
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (const p of pts.values()) {
    const u = p[0] * c - p[1] * s, v = p[0] * s + p[1] * c;
    p[0] = u; p[1] = v;
    if (u < minU) minU = u;
    if (v < minV) minV = v;
    if (u > maxU) maxU = u;
    if (v > maxV) maxV = v;
  }
  // Lying flat suits the skyline packer.
  if (maxV - minV > maxU - minU) {
    for (const p of pts.values()) {
      const u = p[0];
      p[0] = p[1];
      p[1] = u;
    }
    [minU, minV, maxU, maxV] = [minV, minU, maxV, maxU];
  }
  ch.minU = minU; ch.minV = minV;
  ch.w = maxU - minU; ch.h = maxV - minV;
}

/** Skyline packing into a square of `size` texels at `scale` texels per meter. False when it overflows. */
function pack(charts: Chart[], scale: number, size: number, pad: number): boolean {
  const sky = new Int32Array(size);
  for (const ch of charts) {
    const w = Math.ceil(ch.w * scale) + pad * 2 + 1;
    const h = Math.ceil(ch.h * scale) + pad * 2 + 1;
    if (w > size || h > size) return false;
    let bestX = -1, bestY = 1 << 30;
    for (let x = 0; x + w <= size; x++) {
      let y = 0;
      for (let i = x; i < x + w; i++) if (sky[i]! > y) y = sky[i]!;
      if (y < bestY) { bestY = y; bestX = x; }
    }
    if (bestX < 0 || bestY + h > size) return false;
    for (let i = bestX; i < bestX + w; i++) sky[i] = bestY + h;
    ch.x = bestX + pad;
    ch.y = bestY + pad;
  }
  return true;
}

export function unwrap(mesh: RawMesh, size = 1024, labels: Uint8Array | null = null): Unwrapped {
  const charts = buildCharts(mesh, labels);
  for (const c of charts) project(mesh, c);
  charts.sort((a, b) => b.h - a.h);
  // Largest density that still fits, by bisection.
  const pad = size >= 1024 ? 3 : 2;
  let lo = 16, hi = 2000;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (pack(charts, mid, size, pad)) lo = mid; else hi = mid;
  }
  pack(charts, lo, size, pad);
  console.log(`  unwrap: ${charts.length} charts, ${lo.toFixed(0)} texels/m (${(1000 / lo).toFixed(2)} mm per texel)`);

  const remap: number[] = [];
  const uvf: number[] = [];
  const out = new Uint32Array(mesh.indices.length);
  let o = 0;
  for (const ch of charts) {
    const local = new Map<number, number>();
    for (const t of ch.tris) {
      for (let k = 0; k < 3; k++) {
        const v = mesh.indices[t * 3 + k]!;
        let n = local.get(v);
        if (n === undefined) {
          n = remap.length;
          local.set(v, n);
          remap.push(v);
          const p = ch.uv.get(v)!;
          uvf.push((ch.x + 0.5 + (p[0] - ch.minU) * lo) / size, (ch.y + 0.5 + (p[1] - ch.minV) * lo) / size);
        }
        out[o++] = n;
      }
    }
  }
  const uv = new Uint16Array(uvf.length);
  for (let i = 0; i < uv.length; i++) uv[i] = Math.round(clamp(uvf[i]!) * 65535);
  console.log(`  unwrap: ${mesh.positions.length / 3} -> ${remap.length} verts`);
  return { remap: Int32Array.from(remap), uv, indices: out, uvf: Float32Array.from(uvf) };
}

const toSrgb8 = (v: number) => Math.round(clamp(v) * 255);

export interface BakeInput extends Unwrapped {
  positions: Float32Array;
  normals: Float32Array;
  size: number;
  voxel: number;
}

export async function bakeAtlas(id: string, fine: Field, _coarse: Field, o: BakeInput): Promise<ModelMeta['atlas']> {
  const t0 = Date.now();
  const S = o.size;
  const A = new Uint8Array(S * S * 4);
  const N = new Uint8Array(S * S * 4);
  const filled = new Uint8Array(S * S);
  const idx = o.indices;
  const uvs = o.uvf;
  const P = o.positions, VN = o.normals, R = o.remap;
  const mat: MatSample = { r: 0, g: 0, b: 0, rough: 0, metal: 0, emissive: 0, detail: 0, wear: 0 };
  const g: [number, number, number] = [0, 0, 0];
  const texelMeters = 0.0022;
  let surfaced = 0;

  const shade = (ti: number, x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    // Pull the low-poly point onto the true surface along its own normal, then polish with the gradient.
    let d = fine.dist(x, y, z);
    if (d > 0.04) d = 0.04; else if (d < -0.04) d = -0.04;
    x -= nx * d; y -= ny * d; z -= nz * d;
    const curv = fine.gradient(x, y, z, texelMeters, g);
    d = fine.dist(x, y, z);
    if (Math.abs(d) < 0.03) { x -= g[0] * d; y -= g[1] * d; z -= g[2] * d; }
    surfaced++;
    fine.material(x, y, z, mat);

    // Crevice darkening from a short probe along the normal. Large-scale AO lives in the vertices.
    const c1 = fine.dist(x + g[0] * 0.006, y + g[1] * 0.006, z + g[2] * 0.006);
    const c2 = fine.dist(x + g[0] * 0.016, y + g[1] * 0.016, z + g[2] * 0.016);
    const cav = clamp(((0.006 - c1) / 0.006) * 0.6 + ((0.016 - c2) / 0.016) * 0.8);

    const k = 1 - cav * 0.72;
    let r = mat.r * k, gg = mat.g * k, b = mat.b * k;
    let rough = clamp(mat.rough + cav * 0.25);
    let metal = mat.metal;

    if (mat.wear > 0) {
      // Convex edges get scuffed down to bare steel. Curvature is the SDF Laplacian, already in hand.
      const n = fbm(x * 55, y * 55, z * 55, 3);
      const e = sstep(60, 170, curv + n * 90) * mat.wear * 0.8;
      if (e > 0) {
        r += (0.44 - r) * e; gg += (0.45 - gg) * e; b += (0.47 - b) * e;
        metal += (1 - metal) * e;
        rough += (0.38 - rough) * e;
      }
    }
    // Grime settles in the lower half of anything facing up less than sideways, and water streaks run down.
    const grime = sstep(0.18, 0.5, noise(x * 5, y * 11, z * 5) + cav * 0.5) * 0.3;
    r *= 1 - grime * 0.6; gg *= 1 - grime * 0.6; b *= 1 - grime * 0.55;

    const t4 = ti * 4;
    A[t4] = toSrgb8(r); A[t4 + 1] = toSrgb8(gg); A[t4 + 2] = toSrgb8(b);
    const pack = mat.emissive > 0.01 ? 0.5 + clamp(mat.emissive) * 0.5 : clamp(metal) * 0.5;
    A[t4 + 3] = Math.round(pack * 255);
    N[t4] = Math.round((g[0] * 0.5 + 0.5) * 255);
    N[t4 + 1] = Math.round((g[1] * 0.5 + 0.5) * 255);
    N[t4 + 2] = Math.round((g[2] * 0.5 + 0.5) * 255);
    N[t4 + 3] = Math.round(clamp(rough) * 255);
    filled[ti] = 1;
  };

  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
    const ax = uvs[a * 2]! * S, ay = uvs[a * 2 + 1]! * S;
    const bx = uvs[b * 2]! * S, by = uvs[b * 2 + 1]! * S;
    const cx = uvs[c * 2]! * S, cy = uvs[c * 2 + 1]! * S;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-9) continue;
    const inv = 1 / den;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 1)), x1 = Math.min(S - 1, Math.ceil(Math.max(ax, bx, cx) + 1));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 1)), y1 = Math.min(S - 1, Math.ceil(Math.max(ay, by, cy) + 1));
    const oa = R[a]! * 3, ob = R[b]! * 3, oc = R[c]! * 3;
    // A half-texel skirt so bilinear filtering at chart edges reads real surface, not dilated fill.
    const eps = -1.2 / Math.sqrt(Math.abs(den) + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const ti = x + y * S;
        if (filled[ti]) continue;
        const qx = x + 0.5, qy = y + 0.5;
        const wa = ((by - cy) * (qx - cx) + (cx - bx) * (qy - cy)) * inv;
        const wb = ((cy - ay) * (qx - cx) + (ax - cx) * (qy - cy)) * inv;
        const wc = 1 - wa - wb;
        if (wa < eps || wb < eps || wc < eps) continue;
        const X = P[oa]! * wa + P[ob]! * wb + P[oc]! * wc;
        const Y = P[oa + 1]! * wa + P[ob + 1]! * wb + P[oc + 1]! * wc;
        const Z = P[oa + 2]! * wa + P[ob + 2]! * wb + P[oc + 2]! * wc;
        let nx = VN[oa]! * wa + VN[ob]! * wb + VN[oc]! * wc;
        let ny = VN[oa + 1]! * wa + VN[ob + 1]! * wb + VN[oc + 1]! * wc;
        let nz = VN[oa + 2]! * wa + VN[ob + 2]! * wb + VN[oc + 2]! * wc;
        const l = 1 / (Math.hypot(nx, ny, nz) || 1);
        nx *= l; ny *= l; nz *= l;
        shade(ti, X, Y, Z, nx, ny, nz);
      }
    }
  }

  // Dilate outward so mip levels never pull in the empty background.
  let front: number[] = [];
  for (let i = 0; i < S * S; i++) if (filled[i]) front.push(i);
  for (let pass = 0; pass < 8; pass++) {
    const next: number[] = [];
    for (const i of front) {
      const x = i % S, y = (i / S) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const u = x + dx, w = y + dy;
        if (u < 0 || w < 0 || u >= S || w >= S) continue;
        const j = u + w * S;
        if (filled[j]) continue;
        filled[j] = 1;
        for (let k = 0; k < 4; k++) { A[j * 4 + k] = A[i * 4 + k]!; N[j * 4 + k] = N[i * 4 + k]!; }
        next.push(j);
      }
    }
    front = next;
  }
  // Seven-bit normals and roughness are invisible after filtering and cut the PNG by about a third.
  for (let i = 0; i < N.length; i++) N[i] = N[i]! & 0xfe;
  const albedo = `${id}.a.png`, normal = `${id}.n.png`;
  const pa = encodePng(A, S, S), pn = encodePng(N, S, S);
  writeFileSync(join(OUT_DIR, albedo), pa);
  writeFileSync(join(OUT_DIR, normal), pn);
  console.log(`  atlas: ${S}px, ${surfaced} texels, ${(pa.length / 1024) | 0}+${(pn.length / 1024) | 0} KB, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return { size: S, albedo, normal };
}
