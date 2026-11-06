/**
 * Plane cut of a triangle mesh. Everything the surface has (normals, UVs, colours) is interpolated across
 * the cut, then the openings are closed with flesh: a pale rim where skin and fat were, muscle inside, and
 * a disc of bone wherever a bone crosses the plane.
 *
 * Works on any geometry. Openings are found from welded positions rather than vertex indices, so UV seams
 * and split normals on the source mesh do not break the loops.
 */
import * as THREE from 'three';

export interface BoneCrossing {
  x: number; y: number; z: number;
  radius: number;
}

export interface CutSide {
  geometry: THREE.BufferGeometry;
  /** Centre of the piece. Vertices in `geometry` are relative to this. */
  readonly origin: THREE.Vector3;
  /** Centre of the cut face, relative to `origin`. */
  readonly capCenter: THREE.Vector3;
  /** Outward normal of the cut face. */
  readonly capNormal: THREE.Vector3;
  /** A sample of vertices relative to `origin`, for a convex hull. */
  hull: Float32Array;
  /** Local bounds relative to `origin`. */
  readonly min: THREE.Vector3;
  readonly max: THREE.Vector3;
  /** Rough area of the cut face in square meters. */
  capArea: number;
}

/**
 * Pieces on each side of the plane, largest first. A side is often more than one piece: a swing through the
 * waist also takes off both hands, and they should not stay rigidly attached to the hips through thin air.
 */
export interface CutResult {
  above: CutSide[];
  below: CutSide[];
  loops: number;
}

const HULL_POINTS = 56;
/** Separate pieces kept per side. Anything smaller is carried by the largest. */
const MAX_PIECES = 4;
const MIN_PIECE_TRIANGLES = 48;
/** Width of the pale band at the edge of the cut. */
const RIM = 0.014;
/** Texture repeats per meter on the cut face. */
const CAP_UV = 3.5;
const WELD = 2048; // 1/2048 m grid: finer than any mesh here, coarse enough to absorb float noise.

const FLESH = new THREE.Color(0.62, 0.035, 0.04);
const RIM_COLOR = new THREE.Color(0.95, 0.72, 0.62);
const BONE = new THREE.Color(0.98, 0.93, 0.82);
const MARROW = new THREE.Color(0.45, 0.06, 0.05);

interface Attr {
  name: string;
  size: number;
  normalized: boolean;
  src: THREE.TypedArray;
}

/**
 * One side of the cut. The triangle pass only records indices. Attributes are gathered afterwards in tight
 * per-attribute loops, because copying them vertex by vertex across mixed array types is what costs the time.
 */
class Side {
  /** Same element types as the source, so packed colours and UVs stay packed. */
  attrs: THREE.TypedArray[] = [];
  capColor = new Float32Array(0);
  readonly index: Uint32Array;
  indexCount = 0;
  vertexCount = 0;
  /** Source vertex for each output vertex, or -1 - k for the k-th edge vertex. */
  readonly source: Int32Array;
  readonly remap: Int32Array;
  readonly edges = new Map<number, number>();
  readonly edgeA: Int32Array;
  readonly edgeB: Int32Array;
  readonly edgeT: Float32Array;
  edgeCount = 0;

  constructor(vertexCap: number, indexCap: number, edgeCap: number, sourceVertices: number) {
    this.index = new Uint32Array(indexCap);
    this.source = new Int32Array(vertexCap);
    this.remap = new Int32Array(sourceVertices).fill(-1);
    this.edgeA = new Int32Array(edgeCap);
    this.edgeB = new Int32Array(edgeCap);
    this.edgeT = new Float32Array(edgeCap);
  }

  vertex(i: number): number {
    const m = this.remap[i]!;
    if (m >= 0) return m;
    const o = this.vertexCount++;
    this.remap[i] = o;
    this.source[o] = i;
    return o;
  }

  /** The vertex where edge a-b crosses the plane, shared by the two triangles on that edge. */
  edgeVertex(a: number, b: number, t: number, count: number): number {
    const key = a < b ? a * count + b : b * count + a;
    const cached = this.edges.get(key);
    if (cached !== undefined) return cached;
    const o = this.vertexCount++;
    this.edges.set(key, o);
    const k = this.edgeCount++;
    this.edgeA[k] = a;
    this.edgeB[k] = b;
    this.edgeT[k] = t;
    this.source[o] = -1 - k;
    return o;
  }

  tri(a: number, b: number, c: number): void {
    const n = this.indexCount;
    this.index[n] = a;
    this.index[n + 1] = b;
    this.index[n + 2] = c;
    this.indexCount = n + 3;
  }

  /** Output vertices that came from the triangle pass. Cap vertices come after them. */
  sourceVertices = 0;

  /** Fills attribute arrays for everything the triangle pass used, leaving room for the cap. */
  gather(list: readonly Attr[], capVertices: number): void {
    const total = this.vertexCount + capVertices;
    const n = this.vertexCount;
    this.sourceVertices = n;
    this.capColor = new Float32Array(total * 3);
    this.attrs = list.map(a => {
      const dst = new (a.src.constructor as new (n: number) => THREE.TypedArray)(total * a.size);
      gatherAttribute(dst, a.src, a.size, this.source, n, this.edgeA, this.edgeB, this.edgeT);
      return dst;
    });
  }
}

function gatherAttribute(
  dst: THREE.TypedArray, src: THREE.TypedArray, size: number, source: Int32Array, count: number,
  edgeA: Int32Array, edgeB: Int32Array, edgeT: Float32Array,
): void {
  for (let o = 0; o < count; o++) {
    const s = source[o]!;
    const d = o * size;
    if (s >= 0) {
      const f = s * size;
      for (let c = 0; c < size; c++) dst[d + c] = src[f + c]!;
    } else {
      const k = -1 - s;
      const a = edgeA[k]! * size;
      const b = edgeB[k]! * size;
      const t = edgeT[k]!;
      for (let c = 0; c < size; c++) {
        const x = src[a + c]!;
        dst[d + c] = x + (src[b + c]! - x) * t;
      }
    }
  }
}

const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();

/** The cut outline as closed loops of 2D points in the plane's own coordinates. */
interface Loop {
  x: Float64Array;
  y: Float64Array;
  /** Signed. Positive loops are material boundaries, negative are holes in one. */
  area: number;
  /** An outline node on this loop that has a segment leaving it. */
  node: number;
}

/**
 * For each vertex, the first vertex at the same position. A baked mesh is split along its UV charts, so
 * index connectivity alone would call every chart a separate piece. Depends only on topology, so it can be
 * computed once per model and passed to every cut.
 */
export function weldTable(geometry: THREE.BufferGeometry): Int32Array {
  const position = geometry.getAttribute('position');
  const count = position.count;
  const pos = position.array as Float32Array;
  const out = new Int32Array(count);
  const seen = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const key = `${Math.round(pos[i * 3]! * 4096)},${Math.round(pos[i * 3 + 1]! * 4096)},${Math.round(pos[i * 3 + 2]! * 4096)}`;
    const first = seen.get(key);
    if (first === undefined) seen.set(key, i);
    out[i] = first ?? i;
  }
  return out;
}

export function cutMesh(
  geometry: THREE.BufferGeometry,
  point: THREE.Vector3,
  normal: THREE.Vector3,
  crossings: readonly BoneCrossing[] = [],
  weld: Int32Array | null = null,
): CutResult {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const count = position.count;
  const pos = position.array as Float32Array;
  const nx = normal.x;
  const ny = normal.y;
  const nz = normal.z;
  const offset = nx * point.x + ny * point.y + nz * point.z;

  const dist = new Float32Array(count);
  for (let i = 0, o = 0; i < count; i++, o += 3) {
    const d = pos[o]! * nx + pos[o + 1]! * ny + pos[o + 2]! * nz - offset;
    // A vertex exactly on the plane would make a zero-area sliver. Nudging it off costs nothing visible.
    dist[i] = d === 0 ? 1e-7 : d;
  }

  const srcIndex = geometry.getIndex();
  const idx = srcIndex ? (srcIndex.array as ArrayLike<number>) : null;
  const indexCount = idx ? srcIndex!.count : count;

  let crossingsCount = 0;
  for (let t = 0; t < indexCount; t += 3) {
    const a = idx ? idx[t]! : t;
    const b = idx ? idx[t + 1]! : t + 1;
    const c = idx ? idx[t + 2]! : t + 2;
    const sa = dist[a]! > 0;
    if (sa !== dist[b]! > 0 || sa !== dist[c]! > 0) crossingsCount++;
  }

  const list: Attr[] = [];
  for (const name of Object.keys(geometry.attributes)) {
    if (name === 'skinIndex' || name === 'skinWeight' || name === 'color') continue;
    const attr = geometry.getAttribute(name) as THREE.BufferAttribute;
    list.push({ name, size: attr.itemSize, normalized: attr.normalized, src: attr.array as THREE.TypedArray });
  }

  // Worst case every cut triangle gives two new vertices per side, and the cap adds its own on top.
  const capVerts = crossingsCount * 2 + crossings.length * 20;
  const vertexCap = count + crossingsCount * 2 + 8;
  const indexCap = indexCount + crossingsCount * 6 + capVerts * 6 + 48;
  const edgeCap = crossingsCount * 2 + 2;
  const above = new Side(vertexCap, indexCap, edgeCap, count);
  const below = new Side(vertexCap, indexCap, edgeCap, count);

  // Welded nodes on the outline. Each segment points the way the ABOVE cap has to run to close the mesh.
  const nodes = new Map<number, number>();
  const nodeX: number[] = [];
  const nodeY: number[] = [];
  const nodeZ: number[] = [];
  const next = new Int32Array(crossingsCount * 2 + 1).fill(-1);
  // A skin vertex on each side of every outline node, which ties a cap to the piece it closes.
  const skinAbove = new Int32Array(crossingsCount * 2 + 1);
  const skinBelow = new Int32Array(crossingsCount * 2 + 1);
  const originX = point.x;
  const originY = point.y;
  const originZ = point.z;
  const nodeFor = (x: number, y: number, z: number): number => {
    // Relative to the cut, so each axis fits its 16 bits wherever in the world this happens.
    const key = (Math.round((x - originX) * WELD) + 32768) * 4294967296
      + (Math.round((y - originY) * WELD) + 32768) * 65536
      + (Math.round((z - originZ) * WELD) + 32768);
    let id = nodes.get(key);
    if (id === undefined) {
      id = nodeX.length;
      nodes.set(key, id);
      nodeX.push(x);
      nodeY.push(y);
      nodeZ.push(z);
    }
    return id;
  };

  const emitCut = (lone: number, o1: number, o2: number): void => {
    // lone sits alone on one side of the plane; o1 and o2 are on the other, in winding order.
    const dl = dist[lone]!;
    const t1 = dl / (dl - dist[o1]!);
    const t2 = dl / (dl - dist[o2]!);
    const loneAbove = dl > 0;
    const near = loneAbove ? above : below;
    const far = loneAbove ? below : above;
    const n1 = near.edgeVertex(lone, o1, t1, count);
    const n2 = near.edgeVertex(lone, o2, t2, count);
    const f1 = far.edgeVertex(lone, o1, t1, count);
    const f2 = far.edgeVertex(lone, o2, t2, count);
    near.tri(near.vertex(lone), n1, n2);
    const a = far.vertex(o1);
    const b = far.vertex(o2);
    far.tri(f1, a, b);
    far.tri(f1, b, f2);
    const l3 = lone * 3;
    const a3 = o1 * 3;
    const b3 = o2 * 3;
    const px = pos[l3]! + (pos[a3]! - pos[l3]!) * t1;
    const py = pos[l3 + 1]! + (pos[a3 + 1]! - pos[l3 + 1]!) * t1;
    const pz = pos[l3 + 2]! + (pos[a3 + 2]! - pos[l3 + 2]!) * t1;
    const qx = pos[l3]! + (pos[b3]! - pos[l3]!) * t2;
    const qy = pos[l3 + 1]! + (pos[b3 + 1]! - pos[l3 + 1]!) * t2;
    const qz = pos[l3 + 2]! + (pos[b3 + 2]! - pos[l3 + 2]!) * t2;
    const p = nodeFor(px, py, pz);
    const q = nodeFor(qx, qy, qz);
    if (p === q) return;
    if (loneAbove) {
      next[q] = p;
      skinAbove[p] = n1;
      skinBelow[p] = f1;
    } else {
      next[p] = q;
      skinBelow[p] = n1;
      skinAbove[p] = f1;
    }
  };

  for (let t = 0; t < indexCount; t += 3) {
    const a = idx ? idx[t]! : t;
    const b = idx ? idx[t + 1]! : t + 1;
    const c = idx ? idx[t + 2]! : t + 2;
    const sa = dist[a]! > 0;
    const sb = dist[b]! > 0;
    const sc = dist[c]! > 0;
    if (sa === sb && sb === sc) {
      const side = sa ? above : below;
      side.tri(side.vertex(a), side.vertex(b), side.vertex(c));
    } else if (sa === sb) {
      emitCut(c, a, b);
    } else if (sa === sc) {
      emitCut(b, c, a);
    } else {
      emitCut(a, b, c);
    }
  }

  // Plane basis with u x v = -n, so the above cap's loops come out counter-clockwise from outside.
  _n.set(nx, ny, nz);
  _u.set(Math.abs(nx) < 0.9 ? 1 : 0, Math.abs(nx) < 0.9 ? 0 : 1, 0).cross(_n).normalize();
  _v.crossVectors(_u, _n);
  const ux = _u.x, uy = _u.y, uz = _u.z;
  const vx = _v.x, vy = _v.y, vz = _v.z;

  const loops = traceLoops(next, nodeX, nodeY, nodeZ, ux, uy, uz, vx, vy, vz);
  const outers = loops.filter(l => l.area > 0);
  const holes = loops.filter(l => l.area <= 0);
  const holesOf = new Map<Loop, Loop[]>();
  for (const h of holes) {
    let host: Loop | null = null;
    for (const o of outers) {
      if ((!host || o.area < host.area) && contains(o, h.x[0]!, h.y[0]!)) host = o;
    }
    if (host) {
      const list2 = holesOf.get(host);
      if (list2) list2.push(h);
      else holesOf.set(host, [h]);
    }
  }

  let capVertices = crossings.length * 17;
  for (const l of loops) capVertices += l.x.length * 2;
  above.gather(list, capVertices);
  below.gather(list, capVertices);

  const planeO = _p.copy(_n).multiplyScalar(offset);
  const cap = { px: planeO.x, py: planeO.y, pz: planeO.z, ux, uy, uz, vx, vy, vz, nx, ny, nz };
  const aboveCap = buildCap(above, list, outers, holesOf, cap, crossings, -1, skinAbove);
  const belowCap = buildCap(below, list, outers, holesOf, cap, crossings, 1, skinBelow);

  return {
    above: pieces(above, list, aboveCap, weld, count),
    below: pieces(below, list, belowCap, weld, count),
    loops: outers.length,
  };
}

function traceLoops(
  next: Int32Array, xs: number[], ys: number[], zs: number[],
  ux: number, uy: number, uz: number, vx: number, vy: number, vz: number,
): Loop[] {
  const loops: Loop[] = [];
  const count = xs.length;
  const seen = new Uint8Array(count);
  const chain: number[] = [];
  for (let start = 0; start < count; start++) {
    if (seen[start] || next[start]! < 0) continue;
    chain.length = 0;
    let at = start;
    while (at >= 0 && !seen[at]) {
      seen[at] = 1;
      chain.push(at);
      at = next[at]!;
    }
    if (chain.length < 3) continue;
    const n = chain.length;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const k = chain[i]!;
      x[i] = xs[k]! * ux + ys[k]! * uy + zs[k]! * uz;
      y[i] = xs[k]! * vx + ys[k]! * vy + zs[k]! * vz;
    }
    let area = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) area += x[j]! * y[i]! - x[i]! * y[j]!;
    area *= 0.5;
    if (Math.abs(area) < 1e-6) continue;
    loops.push({ x, y, area, node: chain[0]! });
  }
  return loops;
}

function contains(loop: Loop, px: number, py: number): boolean {
  const { x, y } = loop;
  let inside = false;
  for (let i = 0, j = x.length - 1; i < x.length; j = i++) {
    if (y[i]! > py !== y[j]! > py && px < ((x[j]! - x[i]!) * (py - y[i]!)) / (y[j]! - y[i]!) + x[i]!) inside = !inside;
  }
  return inside;
}

interface Plane {
  px: number; py: number; pz: number;
  ux: number; uy: number; uz: number;
  vx: number; vy: number; vz: number;
  nx: number; ny: number; nz: number;
}

interface CapInfo {
  /** First cap index. Everything before it is skin. */
  start: number;
  nx: number; ny: number; nz: number;
  /** Pairs of vertices that belong together though no triangle joins them: a cap and the skin it closes. */
  ties: number[];
}

/**
 * Appends the flesh cap to one side. `facing` is the sign of the plane normal that points out of this
 * side's cut face: -1 for above, +1 for below. Loops were traced for the above side, so below runs reversed.
 */
function buildCap(
  side: Side, list: readonly Attr[], outers: readonly Loop[], holes: Map<Loop, Loop[]>, plane: Plane,
  crossings: readonly BoneCrossing[], facing: number, skin: Int32Array,
): CapInfo {
  const start = side.indexCount;
  const posAttr = list.findIndex(a => a.name === 'position');
  const nrmAttr = list.findIndex(a => a.name === 'normal');
  const uvAttr = list.findIndex(a => a.name === 'uv');
  const capColor = side.capColor;
  const fx = plane.nx * facing;
  const fy = plane.ny * facing;
  const fz = plane.nz * facing;

  const add = (x: number, y: number, tint: THREE.Color, lift: number): number => {
    const o = side.vertexCount++;
    const wx = plane.px + plane.ux * x + plane.vx * y + fx * lift;
    const wy = plane.py + plane.uy * x + plane.vy * y + fy * lift;
    const wz = plane.pz + plane.uz * x + plane.vz * y + fz * lift;
    const p = side.attrs[posAttr]!;
    p[o * 3] = wx;
    p[o * 3 + 1] = wy;
    p[o * 3 + 2] = wz;
    if (nrmAttr >= 0) {
      const n = side.attrs[nrmAttr]!;
      n[o * 3] = fx;
      n[o * 3 + 1] = fy;
      n[o * 3 + 2] = fz;
    }
    if (uvAttr >= 0) {
      // Packed UVs cannot go past 1, so the cap wraps here and the texture repeats anyway.
      const u = side.attrs[uvAttr]!;
      const scale = list[uvAttr]!.normalized ? 65535 : 1;
      const wrap = (t: number) => (scale === 1 ? t : (t - Math.floor(t)) * scale);
      u[o * 2] = wrap(x * CAP_UV);
      u[o * 2 + 1] = wrap(y * CAP_UV);
    }
    capColor[o * 3] = tint.r;
    capColor[o * 3 + 1] = tint.g;
    capColor[o * 3 + 2] = tint.b;
    return o;
  };

  // Triangle whose front must face out of this side, whatever order earcut produced.
  const face = (a: number, b: number, c: number): void => {
    const p = side.attrs[posAttr]!;
    const e1x = p[b * 3]! - p[a * 3]!, e1y = p[b * 3 + 1]! - p[a * 3 + 1]!, e1z = p[b * 3 + 2]! - p[a * 3 + 2]!;
    const e2x = p[c * 3]! - p[a * 3]!, e2y = p[c * 3 + 1]! - p[a * 3 + 1]!, e2z = p[c * 3 + 2]! - p[a * 3 + 2]!;
    const d = (e1y * e2z - e1z * e2y) * fx + (e1z * e2x - e1x * e2z) * fy + (e1x * e2y - e1y * e2x) * fz;
    if (d >= 0) side.tri(a, b, c);
    else side.tri(a, c, b);
  };

  const ties: number[] = [];

  const rimAndInset = (loop: Loop): { xs: number[]; ys: number[]; first: number; n: number } => {
    // Inset along each corner's bisector. Material is to the left of a loop for outers and holes alike.
    const { x, y } = loop;
    const n = x.length;
    const xs = new Array<number>(n);
    const ys = new Array<number>(n);
    const first = side.vertexCount;
    for (let i = 0; i < n; i++) {
      const a = (i + n - 1) % n;
      const b = (i + 1) % n;
      let e1x = x[i]! - x[a]!;
      let e1y = y[i]! - y[a]!;
      let e2x = x[b]! - x[i]!;
      let e2y = y[b]! - y[i]!;
      const l1 = Math.hypot(e1x, e1y) || 1;
      const l2 = Math.hypot(e2x, e2y) || 1;
      e1x /= l1;
      e1y /= l1;
      e2x /= l2;
      e2y /= l2;
      let mx = -(e1y + e2y);
      let my = e1x + e2x;
      const ml = Math.hypot(mx, my) || 1;
      mx /= ml;
      my /= ml;
      xs[i] = x[i]! + mx * RIM;
      ys[i] = y[i]! + my * RIM;
      add(x[i]!, y[i]!, RIM_COLOR, 0);
    }
    const inner = side.vertexCount;
    for (let i = 0; i < n; i++) add(xs[i]!, ys[i]!, FLESH, 0);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      face(first + i, first + j, inner + j);
      face(first + i, inner + j, inner + i);
    }
    return { xs, ys, first: inner, n };
  };

  for (const outer of outers) {
    const ring = rimAndInset(outer);
    const contour = ring.xs.map((x, i) => new THREE.Vector2(x, ring.ys[i]!));
    const holeRings: THREE.Vector2[][] = [];
    const firsts = [ring.first];
    const sizes = [ring.n];
    for (const hole of holes.get(outer) ?? []) {
      const h = rimAndInset(hole);
      holeRings.push(h.xs.map((x, i) => new THREE.Vector2(x, h.ys[i]!)));
      firsts.push(h.first);
      sizes.push(h.n);
    }
    // ShapeUtils may drop a duplicated closing point, which would misalign vertex ids.
    const triangles = THREE.ShapeUtils.triangulateShape(contour, holeRings);
    const lookup = (k: number): number => {
      let at = k;
      for (let r = 0; r < firsts.length; r++) {
        if (at < sizes[r]!) return firsts[r]! + at;
        at -= sizes[r]!;
      }
      return firsts[0]!;
    };
    for (const t of triangles) face(lookup(t[0]!), lookup(t[1]!), lookup(t[2]!));
    ties.push(ring.first, skin[outer.node]!);
  }

  for (const c of crossings) {
    const dx = c.x - plane.px;
    const dy = c.y - plane.py;
    const dz = c.z - plane.pz;
    const x = dx * plane.ux + dy * plane.uy + dz * plane.uz;
    const y = dx * plane.vx + dy * plane.vy + dz * plane.vz;
    const lift = 0.0015;
    const centre = add(x, y, MARROW, lift);
    for (let o = 0; o < outers.length; o++) {
      if (contains(outers[o]!, x, y)) {
        ties.push(centre, skin[outers[o]!.node]!);
        break;
      }
    }
    const inner: number[] = [];
    const outer: number[] = [];
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      inner.push(add(x + Math.cos(a) * c.radius * 0.5, y + Math.sin(a) * c.radius * 0.5, BONE, lift));
      outer.push(add(x + Math.cos(a) * c.radius, y + Math.sin(a) * c.radius, BONE, lift));
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      face(centre, inner[i]!, inner[j]!);
      face(inner[i]!, outer[i]!, outer[j]!);
      face(inner[i]!, outer[j]!, inner[j]!);
    }
  }

  return { start, nx: fx, ny: fy, nz: fz, ties };
}

function find(parent: Int32Array, i: number): number {
  let root = i;
  while (parent[root] !== root) root = parent[root]!;
  while (parent[i] !== root) {
    const next = parent[i]!;
    parent[i] = root;
    i = next;
  }
  return root;
}

/** Splits a side into its connected pieces, largest first. */
function pieces(side: Side, list: readonly Attr[], cap: CapInfo, weld: Int32Array | null, sourceCount: number): CutSide[] {
  const n = side.vertexCount;
  if (n === 0 || side.indexCount === 0) return [];
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const idx = side.index;
  const count = side.indexCount;
  for (let t = 0; t < count; t += 3) {
    const a = find(parent, idx[t]!);
    const b = find(parent, idx[t + 1]!);
    const c = find(parent, idx[t + 2]!);
    if (a !== b) parent[b] = a;
    if (a !== c) parent[find(parent, c)] = a;
  }
  if (weld) {
    // Vertices split along a UV seam are one point on the surface.
    const first = new Int32Array(sourceCount).fill(-1);
    for (let o = 0; o < n; o++) {
      const s = side.source[o]!;
      if (s < 0 || o >= side.sourceVertices) continue;
      const w = weld[s]!;
      if (first[w]! < 0) {
        first[w] = o;
      } else {
        const a = find(parent, first[w]!);
        const b = find(parent, o);
        if (a !== b) parent[b] = a;
      }
    }
  }
  for (let i = 0; i < cap.ties.length; i += 2) {
    const a = find(parent, cap.ties[i]!);
    const b = find(parent, cap.ties[i + 1]!);
    if (a !== b) parent[b] = a;
  }

  // Flatten once, so everything after this is a plain array read per triangle.
  const rootOf = parent;
  for (let i = 0; i < n; i++) rootOf[i] = find(parent, i);
  const sizes = new Int32Array(n);
  for (let t = 0; t < count; t += 3) sizes[rootOf[idx[t]!]!]!++;
  const roots: number[] = [];
  for (let i = 0; i < n; i++) if (sizes[i]! > 0) roots.push(i);
  roots.sort((a, b) => sizes[b]! - sizes[a]!);
  const kept = roots.filter((r, i) => i === 0 || (i < MAX_PIECES && sizes[r]! >= MIN_PIECE_TRIANGLES));
  if (kept.length === 1) return [finish(side, list, cap, null, 0, rootOf)];
  // Slivers too small to bother with ride along with the largest piece.
  const slot = new Uint8Array(n);
  kept.forEach((r, i) => {
    slot[r] = i;
  });
  return kept.map((_, i) => finish(side, list, cap, slot, i, rootOf));
}

/** Builds one piece. `slot` is null when the whole side is one piece. */
function finish(
  side: Side, list: readonly Attr[], cap: CapInfo, slot: Uint8Array | null, which: number, rootOf: Int32Array,
): CutSide {
  const posIndex = list.findIndex(a => a.name === 'position');
  const src = side.index;
  const total = side.indexCount;

  // Skin triangles first, then cap, so one group boundary still separates the two materials.
  const index = new Uint32Array(total);
  let vertexCount = 0;
  let skinCount = 0;
  let capCount = 0;
  const local = slot ? new Int32Array(side.vertexCount).fill(-1) : null;
  const order = slot ? new Int32Array(side.vertexCount) : null;
  const use = (v: number): number => {
    if (!local) return v;
    let m = local[v]!;
    if (m < 0) {
      m = vertexCount++;
      local[v] = m;
      order![m] = v;
    }
    return m;
  };
  let write = 0;
  for (let t = 0; t < total; t += 3) {
    if (slot && slot[rootOf[src[t]!]!] !== which) continue;
    index[write++] = use(src[t]!);
    index[write++] = use(src[t + 1]!);
    index[write++] = use(src[t + 2]!);
    if (t < cap.start) skinCount += 3;
    else capCount += 3;
  }
  if (!local) vertexCount = side.vertexCount;

  const n = vertexCount;
  const attrs = list.map((a, k) => {
    const from = side.attrs[k]!;
    if (!order) return from.subarray(0, n * a.size);
    const dst = new (a.src.constructor as new (n: number) => THREE.TypedArray)(n * a.size);
    for (let i = 0; i < n; i++) {
      const o = order[i]! * a.size;
      for (let c = 0; c < a.size; c++) dst[i * a.size + c] = from[o + c]!;
    }
    return dst;
  });
  let color = side.capColor.subarray(0, n * 3);
  if (order) {
    color = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const o = order[i]! * 3;
      color[i * 3] = side.capColor[o]!;
      color[i * 3 + 1] = side.capColor[o + 1]!;
      color[i * 3 + 2] = side.capColor[o + 2]!;
    }
  }

  const pos = attrs[posIndex]! as Float32Array;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0, o = 0; i < n; i++, o += 3) {
    const x = pos[o]!, y = pos[o + 1]!, z = pos[o + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const ox = (minX + maxX) * 0.5;
  const oy = (minY + maxY) * 0.5;
  const oz = (minZ + maxZ) * 0.5;
  for (let i = 0, o = 0; i < n; i++, o += 3) {
    pos[o] = pos[o]! - ox;
    pos[o + 1] = pos[o + 1]! - oy;
    pos[o + 2] = pos[o + 2]! - oz;
  }

  // Area and centre of this piece's cut face, straight from its triangles.
  let area = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let t = skinCount; t < skinCount + capCount; t += 3) {
    const a = index[t]! * 3;
    const b = index[t + 1]! * 3;
    const c = index[t + 2]! * 3;
    const e1x = pos[b]! - pos[a]!, e1y = pos[b + 1]! - pos[a + 1]!, e1z = pos[b + 2]! - pos[a + 2]!;
    const e2x = pos[c]! - pos[a]!, e2y = pos[c + 1]! - pos[a + 1]!, e2z = pos[c + 2]! - pos[a + 2]!;
    const w = Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x) * 0.5;
    area += w;
    cx += ((pos[a]! + pos[b]! + pos[c]!) / 3) * w;
    cy += ((pos[a + 1]! + pos[b + 1]! + pos[c + 1]!) / 3) * w;
    cz += ((pos[a + 2]! + pos[b + 2]! + pos[c + 2]!) / 3) * w;
  }
  const inv = area > 0 ? 1 / area : 0;

  const g = new THREE.BufferGeometry();
  for (let k = 0; k < list.length; k++) {
    const a = list[k]!;
    g.setAttribute(a.name, new THREE.BufferAttribute(attrs[k]!, a.size, a.normalized));
  }
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setIndex(new THREE.BufferAttribute(index.subarray(0, write), 1));
  g.addGroup(0, skinCount, 0);
  g.addGroup(skinCount, capCount, 1);

  const stride = Math.max(1, Math.floor(n / HULL_POINTS));
  const samples = Math.ceil(n / stride);
  const hull = new Float32Array(samples * 3);
  for (let i = 0, s = 0; i < n && s < samples; i += stride, s++) {
    hull[s * 3] = pos[i * 3]!;
    hull[s * 3 + 1] = pos[i * 3 + 1]!;
    hull[s * 3 + 2] = pos[i * 3 + 2]!;
  }

  return {
    geometry: g,
    origin: new THREE.Vector3(ox, oy, oz),
    capCenter: new THREE.Vector3(cx * inv, cy * inv, cz * inv),
    capNormal: new THREE.Vector3(cap.nx, cap.ny, cap.nz),
    hull,
    min: new THREE.Vector3(minX - ox, minY - oy, minZ - oz),
    max: new THREE.Vector3(maxX - ox, maxY - oy, maxZ - oz),
    capArea: area,
  };
}
