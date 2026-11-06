/**
 * Dreams-style edit list. A model is an ordered list of edits (add, cut, paint), each carrying a bone
 * binding and a material. Order matters: a cut only affects what came before it, so panel lines are cut
 * into a plate and then the next plate is added on top, unaffected.
 */
import { clamp, type Shape, type V3 } from './sdf';

export const DETAIL_SKIN = 0;
export const DETAIL_CLOTH = 1;
export const DETAIL_METAL = 2;
export const DETAIL_RUBBER = 3;

/** Writable material sample. Everything in here is blended across edits, so a smooth union blends paint too. */
export interface MatSample {
  r: number;
  g: number;
  b: number;
  rough: number;
  metal: number;
  emissive: number;
  detail: number;
  wear: number;
}

export interface Mat {
  /** sRGB, 0..1. */
  albedo: V3;
  rough: number;
  metal?: number;
  emissive?: number;
  detail?: number;
  /** Bright convex edges where paint has worn to bare metal. 0..1. */
  wear?: number;
  /** Procedural surface colour. Runs at every texel, after the base values are copied in. */
  paint?: (x: number, y: number, z: number, o: MatSample) => void;
}

export const enum Op { Add, Cut, Paint }

export interface Edit {
  op: Op;
  shape: Shape;
  k: number;
  bone: number;
  mat: Mat | null;
  rigid: boolean;
  /** Skipped by the polygonizer and only seen by the texture baker. Rivets, stitches, skin folds. */
  detail: boolean;
  /** Paint edits: soft edge width. */
  soft: number;
  lo: V3;
  hi: V3;
}

export interface AddOptions {
  /** Smooth-union width in meters. */
  k?: number;
  /** Bind to a single bone with no joint blending. For armour and hard props. */
  rigid?: boolean;
  detail?: boolean;
}

export interface CutOptions {
  k?: number;
  /** Colour of the newly exposed surface. Omit to keep the colour underneath. */
  mat?: Mat;
  detail?: boolean;
}

const MARGIN = 0.03;

export class Model {
  readonly edits: Edit[] = [];

  add(shape: Shape, mat: Mat, bone: number, o: AddOptions = {}): this {
    this.push({ op: Op.Add, shape, k: o.k ?? 0, bone, mat, rigid: o.rigid ?? false, detail: o.detail ?? false, soft: 0 });
    return this;
  }

  cut(shape: Shape, o: CutOptions = {}): this {
    this.push({ op: Op.Cut, shape, k: o.k ?? 0, bone: -1, mat: o.mat ?? null, rigid: false, detail: o.detail ?? false, soft: 0 });
    return this;
  }

  /** Recolours everything inside `shape` without touching the surface. */
  paint(shape: Shape, mat: Mat, soft = 0.004): this {
    this.push({ op: Op.Paint, shape, k: 0, bone: -1, mat, rigid: false, detail: true, soft });
    return this;
  }

  private push(e: Omit<Edit, 'lo' | 'hi'>): void {
    const pad = e.k + MARGIN + e.soft;
    const s = e.shape;
    this.edits.push({
      ...e,
      lo: [s.lo[0] - pad, s.lo[1] - pad, s.lo[2] - pad],
      hi: [s.hi[0] + pad, s.hi[1] + pad, s.hi[2] + pad],
    });
  }

  /**
   * The model so far as one shape. Armour and clothing built from `offset(snapshot, t)` conform to the body
   * underneath, which is what makes straps and plates sit on the figure instead of floating near it.
   */
  snapshot(): Shape {
    const field = new Field(this.edits.filter(e => !e.detail));
    // Every piece of armour on the body asks about the same point in turn, so one remembered answer goes far.
    let lx = NaN, ly = NaN, lz = NaN, lv = 0;
    return {
      f: (x, y, z) => {
        if (x === lx && y === ly && z === lz) return lv;
        lx = x; ly = y; lz = z;
        return (lv = field.dist(x, y, z));
      },
      lo: field.lo,
      hi: field.hi,
    };
  }
}

/** Spatially indexed evaluator over an edit list. */
export class Field {
  readonly lo: [number, number, number];
  readonly hi: [number, number, number];
  private readonly cell: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;
  private readonly lists: (Int32Array | null)[];
  readonly edits: readonly Edit[];

  constructor(edits: readonly Edit[], cell = 0.05) {
    this.edits = edits;
    const lo: [number, number, number] = [Infinity, Infinity, Infinity];
    const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const e of edits) {
      if (e.op !== Op.Add) continue;
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], e.lo[k]!);
        hi[k] = Math.max(hi[k], e.hi[k]!);
      }
    }
    this.lo = lo;
    this.hi = hi;
    this.cell = cell;
    this.nx = Math.max(1, Math.ceil((hi[0] - lo[0]) / cell));
    this.ny = Math.max(1, Math.ceil((hi[1] - lo[1]) / cell));
    this.nz = Math.max(1, Math.ceil((hi[2] - lo[2]) / cell));
    const tmp: number[][] = Array.from({ length: this.nx * this.ny * this.nz }, () => []);
    edits.forEach((e, idx) => {
      const c = (v: number, a: number, n: number) => clamp(Math.floor((v - a) / cell), 0, n - 1);
      const i0 = c(e.lo[0], lo[0], this.nx), i1 = c(e.hi[0], lo[0], this.nx);
      const j0 = c(e.lo[1], lo[1], this.ny), j1 = c(e.hi[1], lo[1], this.ny);
      const k0 = c(e.lo[2], lo[2], this.nz), k1 = c(e.hi[2], lo[2], this.nz);
      for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) tmp[i + this.nx * (j + this.ny * k)]!.push(idx);
    });
    this.lists = tmp.map(l => (l.length ? Int32Array.from(l) : null));
  }

  listAt(x: number, y: number, z: number): Int32Array | null {
    const i = Math.floor((x - this.lo[0]) / this.cell);
    const j = Math.floor((y - this.lo[1]) / this.cell);
    const k = Math.floor((z - this.lo[2]) / this.cell);
    if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) return null;
    return this.lists[i + this.nx * (j + this.ny * k)]!;
  }

  dist(x: number, y: number, z: number): number {
    const list = this.listAt(x, y, z);
    if (!list) return 1;
    return this.evalList(list, x, y, z);
  }

  evalList(list: Int32Array, x: number, y: number, z: number): number {
    const edits = this.edits;
    let d = 1;
    for (let n = 0; n < list.length; n++) {
      const e = edits[list[n]!]!;
      if (e.op === Op.Paint) continue;
      const v = e.shape.f(x, y, z);
      if (e.op === Op.Add) {
        if (e.k > 0) {
          const h = e.k - Math.abs(d - v);
          const m = d < v ? d : v;
          d = h > 0 ? m - (h * h) / (4 * e.k) : m;
        } else if (v < d) d = v;
      } else if (e.k > 0) {
        const a = -d, b = v;
        const h = e.k - Math.abs(a - b);
        const m = a < b ? a : b;
        d = -(h > 0 ? m - (h * h) / (4 * e.k) : m);
      } else if (-v > d) d = -v;
    }
    return d;
  }

  /** Gradient and Laplacian from one central-difference stencil. Returns the Laplacian. */
  gradient(x: number, y: number, z: number, e: number, out: [number, number, number]): number {
    const c = this.dist(x, y, z);
    const a0 = this.dist(x + e, y, z), a1 = this.dist(x - e, y, z);
    const b0 = this.dist(x, y + e, z), b1 = this.dist(x, y - e, z);
    const c0 = this.dist(x, y, z + e), c1 = this.dist(x, y, z - e);
    const gx = a0 - a1, gy = b0 - b1, gz = c0 - c1;
    const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    out[0] = gx / l; out[1] = gy / l; out[2] = gz / l;
    return (a0 + a1 + b0 + b1 + c0 + c1 - 6 * c) / (e * e);
  }

  /**
   * Blended material on the surface at a point. Replays the edit list to find which edits own the surface,
   * then paints only those: most of the list is buried and its paint callbacks would be wasted noise.
   */
  material(x: number, y: number, z: number, o: MatSample): void {
    const list = this.listAt(x, y, z);
    o.r = o.g = o.b = 0.5; o.rough = 0.6; o.metal = 0; o.emissive = 0; o.detail = 0; o.wear = 0;
    if (!list) return;
    const edits = this.edits;
    let d = 1;
    let count = 0;
    for (let n = 0; n < list.length; n++) {
      const e = edits[list[n]!]!;
      const v = e.shape.f(x, y, z);
      let t = 0;
      if (e.op === Op.Add) {
        if (e.k > 0) {
          const h = clamp(0.5 + (0.5 * (d - v)) / e.k);
          const hh = e.k - Math.abs(d - v);
          const m = d < v ? d : v;
          d = hh > 0 ? m - (hh * hh) / (4 * e.k) : m;
          t = h;
        } else if (v < d) { d = v; t = 1; }
      } else if (e.op === Op.Cut) {
        if (e.k > 0) {
          const a = -d, b = v;
          const hh = e.k - Math.abs(a - b);
          const m = a < b ? a : b;
          const nd = -(hh > 0 ? m - (hh * hh) / (4 * e.k) : m);
          t = e.mat ? clamp(0.5 + (0.5 * (-v - d)) / e.k) : 0;
          d = nd;
        } else if (-v > d) { d = -v; t = e.mat ? 1 : 0; }
      } else {
        t = e.soft > 0 ? clamp(0.5 - v / e.soft) : v < 0 ? 1 : 0;
      }
      if (t > 0 && e.mat) {
        layerMat[count] = e.mat;
        layerT[count++] = t;
      }
    }
    let first = 0;
    let rem = 1;
    for (let i = count - 1; i >= 0; i--) {
      rem *= 1 - layerT[i]!;
      if (rem < 0.01) { first = i; break; }
    }
    for (let i = first; i < count; i++) mixMat(o, layerMat[i]!, x, y, z, layerT[i]!);
  }

  /** Per-bone signed distance at a point, considering only additive edits. Writes into `out` indexed by bone. */
  boneDistances(x: number, y: number, z: number, out: Float32Array): void {
    out.fill(1e9);
    const list = this.listAt(x, y, z);
    if (!list) return;
    for (let n = 0; n < list.length; n++) {
      const e = this.edits[list[n]!]!;
      if (e.op !== Op.Add || e.bone < 0) continue;
      const v = e.shape.f(x, y, z);
      if (v < out[e.bone]!) out[e.bone] = v;
    }
  }

  /** The additive edit that owns the surface here, for rigid binding. */
  ownerAt(x: number, y: number, z: number): Edit | null {
    const list = this.listAt(x, y, z);
    if (!list) return null;
    let d = 1;
    let owner: Edit | null = null;
    for (let n = 0; n < list.length; n++) {
      const e = this.edits[list[n]!]!;
      if (e.op !== Op.Add) continue;
      const v = e.shape.f(x, y, z);
      if (v < d) { d = v; owner = e; }
    }
    return owner;
  }
}

const layerMat: Mat[] = [];
const layerT = new Float64Array(4096);
const tmpSample: MatSample = { r: 0, g: 0, b: 0, rough: 0, metal: 0, emissive: 0, detail: 0, wear: 0 };

function mixMat(o: MatSample, m: Mat, x: number, y: number, z: number, t: number): void {
  const s = tmpSample;
  s.r = m.albedo[0]; s.g = m.albedo[1]; s.b = m.albedo[2];
  s.rough = m.rough; s.metal = m.metal ?? 0; s.emissive = m.emissive ?? 0; s.detail = m.detail ?? 0; s.wear = m.wear ?? 0;
  m.paint?.(x, y, z, s);
  o.r += (s.r - o.r) * t;
  o.g += (s.g - o.g) * t;
  o.b += (s.b - o.b) * t;
  o.rough += (s.rough - o.rough) * t;
  o.metal += (s.metal - o.metal) * t;
  o.emissive += (s.emissive - o.emissive) * t;
  o.wear += (s.wear - o.wear) * t;
  if (t >= 0.5) o.detail = s.detail;
}
