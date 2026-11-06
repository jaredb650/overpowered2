/**
 * Surface nets over a block-sparse grid. Blocks that cannot contain the surface are rejected from a single
 * distance sample at their centre, so cost follows surface area rather than the volume of the bounding box.
 */
import { Field, Op, type Edit } from './model';

export interface RawMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

const B = 8;
const S = B + 1;
const known = new Uint8Array(S * S * S);
/** Corner pairs of a cube, with corners numbered by their x, y, z bits. */
const EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
];

export function polygonize(edits: readonly Edit[], h: number): RawMesh {
  const field = new Field(edits);
  const lo = field.lo, hi = field.hi;
  const nb = [0, 1, 2].map(k => Math.ceil((hi[k]! - lo[k]!) / (h * B)) + 1) as [number, number, number];
  const blockSize = h * B;
  const halfDiag = blockSize * 0.87;

  const cells = new Map<number, Int32Array>();
  const samples = new Map<number, Float32Array>();
  const key = (i: number, j: number, k: number) => i + nb[0] * (j + nb[1] * k);

  let verts = new Float32Array(1 << 18);
  let nv = 0;
  const pushVert = (x: number, y: number, z: number) => {
    if (nv * 3 + 3 > verts.length) {
      const g = new Float32Array(verts.length * 2);
      g.set(verts);
      verts = g;
    }
    verts[nv * 3] = x; verts[nv * 3 + 1] = y; verts[nv * 3 + 2] = z;
    return nv++;
  };

  const active: number[] = [];
  for (let bk = 0; bk < nb[2]; bk++) for (let bj = 0; bj < nb[1]; bj++) for (let bi = 0; bi < nb[0]; bi++) {
    const ox = lo[0] + bi * blockSize, oy = lo[1] + bj * blockSize, oz = lo[2] + bk * blockSize;
    const list = blockList(edits, ox, oy, oz, blockSize);
    if (!list) continue;
    const d0 = field.evalList(list, ox + blockSize / 2, oy + blockSize / 2, oz + blockSize / 2);
    // Ellipsoids and displaced shapes are not exact distances, so the rejection test keeps a wide margin.
    if (Math.abs(d0) > halfDiag * 2.2 + 0.01) continue;
    const s = new Float32Array(S * S * S);
    const ox0 = ox, oy0 = oy, oz0 = oz;
    known.fill(0);
    // Octree descent inside the block. A sub-cube the surface cannot reach keeps one approximate value, which
    // is enough: only its sign is ever read, and a neighbouring refined cube overwrites shared samples.
    const fill = (i: number, j: number, k: number, n: number): void => {
      if (n > 1) {
        const c = n / 2;
        const v = field.evalList(list, ox0 + (i + c) * h, oy0 + (j + c) * h, oz0 + (k + c) * h);
        if (Math.abs(v) > n * h * 1.9 + 0.006) {
          for (let c2 = k; c2 <= k + n; c2++) for (let b2 = j; b2 <= j + n; b2++) for (let a2 = i; a2 <= i + n; a2++) {
            const o = a2 + S * (b2 + S * c2);
            if (known[o] === 0) { s[o] = v; known[o] = 1; }
          }
          return;
        }
        fill(i, j, k, c); fill(i + c, j, k, c); fill(i, j + c, k, c); fill(i + c, j + c, k, c);
        fill(i, j, k + c, c); fill(i + c, j, k + c, c); fill(i, j + c, k + c, c); fill(i + c, j + c, k + c, c);
        return;
      }
      for (let c2 = k; c2 <= k + 1; c2++) for (let b2 = j; b2 <= j + 1; b2++) for (let a2 = i; a2 <= i + 1; a2++) {
        const o = a2 + S * (b2 + S * c2);
        if (known[o] === 2) continue;
        s[o] = field.evalList(list, ox0 + a2 * h, oy0 + b2 * h, oz0 + c2 * h);
        known[o] = 2;
      }
    };
    fill(0, 0, 0, B);
    let neg = 0, pos = 0;
    for (let i = 0; i < s.length; i++) { if (s[i]! < 0) neg++; else pos++; }
    if (!neg || !pos) continue;
    const id = key(bi, bj, bk);
    samples.set(id, s);
    const c = new Int32Array(B * B * B).fill(-1);
    cells.set(id, c);
    active.push(id);
    for (let k = 0; k < B; k++) for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
      const o = i + S * (j + S * k);
      const v0 = s[o]!, v1 = s[o + 1]!, v2 = s[o + S]!, v3 = s[o + S + 1]!;
      const v4 = s[o + S * S]!, v5 = s[o + S * S + 1]!, v6 = s[o + S * S + S]!, v7 = s[o + S * S + S + 1]!;
      let mask = 0;
      if (v0 < 0) mask |= 1; if (v1 < 0) mask |= 2; if (v2 < 0) mask |= 4; if (v3 < 0) mask |= 8;
      if (v4 < 0) mask |= 16; if (v5 < 0) mask |= 32; if (v6 < 0) mask |= 64; if (v7 < 0) mask |= 128;
      if (mask === 0 || mask === 255) continue;
      // Average of edge crossings. Keeps thin plates from wobbling the way a QEF vertex can.
      let sx = 0, sy = 0, sz = 0, n = 0;
      const edge = (a: number, b: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
        if ((a < 0) === (b < 0)) return;
        const t = a / (a - b);
        sx += ax + (bx - ax) * t; sy += ay + (by - ay) * t; sz += az + (bz - az) * t;
        n++;
      };
      edge(v0, v1, 0, 0, 0, 1, 0, 0); edge(v2, v3, 0, 1, 0, 1, 1, 0); edge(v4, v5, 0, 0, 1, 1, 0, 1); edge(v6, v7, 0, 1, 1, 1, 1, 1);
      edge(v0, v2, 0, 0, 0, 0, 1, 0); edge(v1, v3, 1, 0, 0, 1, 1, 0); edge(v4, v6, 0, 0, 1, 0, 1, 1); edge(v5, v7, 1, 0, 1, 1, 1, 1);
      edge(v0, v4, 0, 0, 0, 0, 0, 1); edge(v1, v5, 1, 0, 0, 1, 0, 1); edge(v2, v6, 0, 1, 0, 0, 1, 1); edge(v3, v7, 1, 1, 0, 1, 1, 1);
      c[i + B * (j + B * k)] = pushVert(ox + (i + sx / n) * h, oy + (j + sy / n) * h, oz + (k + sz / n) * h);
    }
  }

  const cellAt = (ci: number, cj: number, ck: number) => {
    const bi = Math.floor(ci / B), bj = Math.floor(cj / B), bk = Math.floor(ck / B);
    const c = cells.get(key(bi, bj, bk));
    if (!c) return -1;
    return c[(ci - bi * B) + B * ((cj - bj * B) + B * (ck - bk * B))]!;
  };

  /**
   * A cell can be missing when two blocks disagree about a shared sample because one of them only holds an
   * approximate value there. Building that cell exactly keeps the surface watertight.
   */
  const cellOrBuild = (ci: number, cj: number, ck: number) => {
    const existing = cellAt(ci, cj, ck);
    if (existing >= 0) return existing;
    const bi = Math.floor(ci / B), bj = Math.floor(cj / B), bk = Math.floor(ck / B);
    const x0 = lo[0] + ci * h, y0 = lo[1] + cj * h, z0 = lo[2] + ck * h;
    const v = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let n = 0; n < 8; n++) v[n] = field.dist(x0 + (n & 1) * h, y0 + ((n >> 1) & 1) * h, z0 + ((n >> 2) & 1) * h);
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of EDGES) {
      const va = v[a]!, vb = v[b]!;
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += (a & 1) + ((b & 1) - (a & 1)) * t;
      sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
      sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
      n++;
    }
    if (!n) { sx = sy = sz = 0.5; n = 1; }
    const id = pushVert(x0 + (sx / n) * h, y0 + (sy / n) * h, z0 + (sz / n) * h);
    const k = key(bi, bj, bk);
    let table = cells.get(k);
    if (!table) cells.set(k, (table = new Int32Array(B * B * B).fill(-1)));
    table[(ci - bi * B) + B * ((cj - bj * B) + B * (ck - bk * B))] = id;
    return id;
  };

  let idx = new Uint32Array(1 << 20);
  let ni = 0;
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (ni + 6 > idx.length) {
      const g = new Uint32Array(idx.length * 2);
      g.set(idx);
      idx = g;
    }
    if (flip) { idx[ni++] = a; idx[ni++] = c; idx[ni++] = b; idx[ni++] = a; idx[ni++] = d; idx[ni++] = c; }
    else { idx[ni++] = a; idx[ni++] = b; idx[ni++] = c; idx[ni++] = a; idx[ni++] = c; idx[ni++] = d; }
  };

  for (const id of active) {
    const bi = id % nb[0], bj = Math.floor(id / nb[0]) % nb[1], bk = Math.floor(id / (nb[0] * nb[1]));
    const s = samples.get(id)!;
    for (let k = 0; k < B; k++) for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
      const gi = bi * B + i, gj = bj * B + j, gk = bk * B + k;
      const o = i + S * (j + S * k);
      const v0 = s[o]!;
      const in0 = v0 < 0;
      if (in0 !== s[o + 1]! < 0) {
        quad(cellOrBuild(gi, gj - 1, gk - 1), cellOrBuild(gi, gj, gk - 1), cellOrBuild(gi, gj, gk), cellOrBuild(gi, gj - 1, gk), !in0);
      }
      if (in0 !== s[o + S]! < 0) {
        quad(cellOrBuild(gi - 1, gj, gk - 1), cellOrBuild(gi - 1, gj, gk), cellOrBuild(gi, gj, gk), cellOrBuild(gi, gj, gk - 1), !in0);
      }
      if (in0 !== s[o + S * S]! < 0) {
        quad(cellOrBuild(gi - 1, gj - 1, gk), cellOrBuild(gi, gj - 1, gk), cellOrBuild(gi, gj, gk), cellOrBuild(gi - 1, gj, gk), !in0);
      }
    }
  }
  return dropIslands(verts.subarray(0, nv * 3).slice(), idx.subarray(0, ni).slice());
}

function blockList(edits: readonly Edit[], ox: number, oy: number, oz: number, size: number): Int32Array | null {
  const out: number[] = [];
  let any = false;
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i]!;
    if (e.lo[0] > ox + size || e.hi[0] < ox || e.lo[1] > oy + size || e.hi[1] < oy || e.lo[2] > oz + size || e.hi[2] < oz) continue;
    if (e.op === Op.Add) any = true;
    out.push(i);
  }
  return any ? Int32Array.from(out) : null;
}

/** Surface nets leaves specks where a smooth blend pinches off. They are invisible but cost triangles. */
function dropIslands(positions: Float32Array, indices: Uint32Array, minTris = 16): RawMesh {
  const nv = positions.length / 3;
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (a: number) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!;
      a = parent[a]!;
    }
    return a;
  };
  for (let i = 0; i < indices.length; i += 3) {
    const a = find(indices[i]!), b = find(indices[i + 1]!), c = find(indices[i + 2]!);
    parent[b] = a;
    parent[find(c)] = a;
  }
  const count = new Map<number, number>();
  for (let i = 0; i < indices.length; i += 3) {
    const r = find(indices[i]!);
    count.set(r, (count.get(r) ?? 0) + 1);
  }
  const keep: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    if ((count.get(find(indices[i]!)) ?? 0) >= minTris) keep.push(indices[i]!, indices[i + 1]!, indices[i + 2]!);
  }
  return { positions, indices: Uint32Array.from(keep) };
}
