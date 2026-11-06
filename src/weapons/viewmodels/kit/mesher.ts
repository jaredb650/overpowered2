/**
 * Procedural hard-surface mesher.
 *
 * Every primitive computes its normals analytically in the style of "bevel + weighted normals": flat faces
 * keep a flat normal and the chamfer strip between them interpolates from one face normal to the other. That
 * gives soft, believable highlights on every edge from a single bevel segment. Chamfer vertices are tagged, and
 * the shader turns that tag plus noise into chipped paint.
 *
 * A model is a tree of parts (moving pieces). Each part holds one buffer per layer (opaque hard surface, glass,
 * decals, named glows), so a whole receiver with hundreds of details is a single draw call.
 */
import * as THREE from 'three';
import type { V2 } from './shapes';

export type V3 = readonly [number, number, number];

/** Surface kinds with a procedural pattern in the shader. */
export const Kind = { plain: 0, wood: 1, stipple: 2, brushed: 3, carbon: 4, rubber: 5, fabric: 6, leather: 7, blade: 8 } as const;

export interface Finish {
  /** sRGB hex. */
  color: number;
  rough: number;
  metal: number;
  /** 0..1. How readily this finish chips to bare metal on tagged edges. */
  wear: number;
  /** 0..1. How strongly this surface glows when the gun heats up. */
  heat?: number;
  kind?: number;
}

export interface PrismOpts {
  bevel?: number;
  holes?: readonly (readonly V2[])[];
  /** Corners sharper than this (degrees) get split normals. */
  smooth?: number;
  capFront?: boolean;
  capBack?: boolean;
}

export interface LatheOpts {
  /** Chamfer applied to sharp profile corners. */
  chamfer?: number;
  a0?: number;
  a1?: number;
  smooth?: number;
}

export interface TubeOpts {
  seg?: number;
  samples?: number;
  /** Straight segments instead of a spline through the points. */
  straight?: boolean;
  closed?: boolean;
  caps?: boolean;
  tension?: number;
}

export interface SurfaceOpts {
  wrapU?: boolean;
  wrapV?: boolean;
  flip?: boolean;
  /** 0..1 wear tag per sample. */
  edge?: (u: number, v: number) => number;
}

class Layer {
  p: number[] = [];
  n: number[] = [];
  /** RGBA bytes: sRGB colour and ambient occlusion. */
  a: number[] = [];
  /** RGBA bytes: roughness, metalness, wear, heat. */
  s: number[] = [];
  /** Bytes: surface kind. */
  k: number[] = [];
  uv: number[] = [];
  /** Skin indices and weights, four per vertex, only when a skin function is set. */
  si: number[] = [];
  sw: number[] = [];
  i: number[] = [];
  count = 0;
}

export interface PartNode {
  name: string;
  /** Pivot in parent-part space. */
  pivot: THREE.Vector3;
  rotation: THREE.Euler;
  layers: Map<string, Layer>;
  children: PartNode[];
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _eu = new THREE.Euler();
const _q = new THREE.Quaternion();
const _col = new THREE.Color();
const _skin: [number, number, number] = [0, 0, 1];

export class Mesher {
  /** Default chamfer width. */
  bevel = 0.0012;
  private finish: Finish = { color: 0x444444, rough: 0.5, metal: 0.5, wear: 0.5 };
  private rgb: [number, number, number] = [68, 68, 68];
  private m = new THREE.Matrix4();
  private nm = new THREE.Matrix3();
  private flip = false;
  private root: PartNode;
  private part_: PartNode;
  private layerName = 'hard';
  private layer_: Layer;
  /** Decal atlas lookup, set by the kit. */
  decals: Record<string, readonly [number, number, number, number]> = {};
  /** When set, every vertex gets skin data: writes [boneA, boneB, weightA] for a bind-space position. */
  skinFn: ((x: number, y: number, z: number, out: [number, number, number]) => void) | null = null;
  /** -1 when building a reflected limb: skin functions always see right-hand coordinates. */
  skinSide: 1 | -1 = 1;

  constructor() {
    this.root = this.newPart('root', new THREE.Vector3());
    this.part_ = this.root;
    this.layer_ = this.getLayer('hard');
  }

  private newPart(name: string, pivot: THREE.Vector3): PartNode {
    return { name, pivot, rotation: new THREE.Euler(), layers: new Map(), children: [] };
  }

  private getLayer(name: string): Layer {
    let l = this.part_.layers.get(name);
    if (!l) this.part_.layers.set(name, (l = new Layer()));
    return l;
  }

  private syncMatrix(): void {
    this.nm.setFromMatrix4(this.m);
    this.flip = this.m.determinant() < 0;
  }

  get tree(): PartNode {
    return this.root;
  }

  // --- State -------------------------------------------------------------------------------------

  use(f: Finish): this {
    this.finish = f;
    _col.setHex(f.color, THREE.SRGBColorSpace).convertLinearToSRGB();
    this.rgb = [Math.round(_col.r * 255), Math.round(_col.g * 255), Math.round(_col.b * 255)];
    return this;
  }

  /** Runs `fn` under a local transform. Rotation is Euler XYZ in radians. */
  at(pos: V3, rot: V3 | null, fn: () => void): void {
    const saved = this.m.clone();
    _mat.identity();
    if (rot) {
      _eu.set(rot[0], rot[1], rot[2]);
      _q.setFromEuler(_eu);
      _mat.makeRotationFromQuaternion(_q);
    }
    _mat.setPosition(pos[0], pos[1], pos[2]);
    this.m.multiply(_mat);
    this.syncMatrix();
    fn();
    this.m.copy(saved);
    this.syncMatrix();
  }

  /** Uniform scale around the current origin. */
  scaled(s: number, fn: () => void): void {
    const saved = this.m.clone();
    this.m.multiply(_mat.makeScale(s, s, s));
    this.syncMatrix();
    fn();
    this.m.copy(saved);
    this.syncMatrix();
  }

  /** Runs `fn` twice, the second time reflected across the YZ plane. */
  mirror(fn: () => void): void {
    fn();
    this.reflected(fn);
  }

  /** Runs `fn` once, reflected across the YZ plane. */
  reflected(fn: () => void): void {
    const saved = this.m.clone();
    this.m.multiply(_mat.makeScale(-1, 1, 1));
    this.syncMatrix();
    fn();
    this.m.copy(saved);
    this.syncMatrix();
  }

  /** Starts a moving part. Geometry inside `fn` is relative to `pivot`; the part animates around it. */
  part(name: string, pivot: V3, fn: () => void): void {
    _v.set(pivot[0], pivot[1], pivot[2]).applyMatrix4(this.m);
    const node = this.newPart(name, _v.clone());
    this.part_.children.push(node);
    const savedPart = this.part_;
    const savedLayer = this.layerName;
    const savedM = this.m.clone();
    this.part_ = node;
    this.m.identity();
    this.syncMatrix();
    this.layerName = 'hard';
    this.layer_ = this.getLayer('hard');
    fn();
    this.part_ = savedPart;
    this.m.copy(savedM);
    this.syncMatrix();
    this.layerName = savedLayer;
    this.layer_ = this.getLayer(savedLayer);
  }

  private inLayer(name: string, fn: () => void): void {
    const saved = this.layerName;
    this.layerName = name;
    this.layer_ = this.getLayer(name);
    fn();
    this.layerName = saved;
    this.layer_ = this.getLayer(saved);
  }

  /** Geometry inside goes to a named emissive layer the rig can drive at runtime. */
  glow(name: string, fn: () => void): void {
    this.inLayer(`glow:${name}`, fn);
  }

  glass(fn: () => void): void {
    this.inLayer('glass', fn);
  }

  // --- Low level ---------------------------------------------------------------------------------

  private vtx(x: number, y: number, z: number, nx: number, ny: number, nz: number, edge = 0): number {
    const l = this.layer_;
    _v.set(x, y, z).applyMatrix4(this.m);
    _n.set(nx, ny, nz).applyMatrix3(this.nm).normalize();
    l.p.push(_v.x, _v.y, _v.z);
    l.n.push(_n.x, _n.y, _n.z);
    const f = this.finish;
    l.a.push(this.rgb[0], this.rgb[1], this.rgb[2], 255);
    l.s.push(
      Math.round(f.rough * 255), Math.round(f.metal * 255),
      Math.round(Math.min(1, edge) * f.wear * 255), Math.round((f.heat ?? 0) * 255),
    );
    l.k.push(f.kind ?? 0);
    if (this.skinFn) {
      this.skinFn(_v.x * this.skinSide, _v.y, _v.z, _skin);
      l.si.push(_skin[0], _skin[1], 0, 0);
      l.sw.push(_skin[2], 1 - _skin[2], 0, 0);
    }
    return l.count++;
  }

  private tri(a: number, b: number, c: number): void {
    if (this.flip) this.layer_.i.push(a, c, b);
    else this.layer_.i.push(a, b, c);
  }

  private quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  // --- Prisms ------------------------------------------------------------------------------------

  /** Extrudes an outline in the local XY plane along Z, centred on Z=0, with chamfered caps. */
  prism(outline: readonly V2[], depth: number, o: PrismOpts = {}): void {
    const bevel = Math.min(o.bevel ?? this.bevel, depth * 0.45);
    const hz = depth / 2;
    const cosSmooth = Math.cos(((o.smooth ?? 38) * Math.PI) / 180);
    const front = o.capFront !== false;
    const back = o.capBack !== false;
    const outer = oriented(outline, true);
    const holes = (o.holes ?? []).map(h => oriented(h, false));
    const capLoops: V2[][] = [];
    for (const loop of [outer, ...holes]) {
      const n = loop.length;
      const en: V2[] = new Array(n);
      for (let i = 0; i < n; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % n]!;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const l = Math.hypot(dx, dy) || 1;
        en[i] = [dy / l, -dx / l];
      }
      // Per-vertex normals seen from the edge ending here and the edge starting here.
      const nIn: V2[] = new Array(n);
      const nOut: V2[] = new Array(n);
      const cap: [number, number][] = new Array(n);
      const corner = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const e0 = en[(i + n - 1) % n]!;
        const e1 = en[i]!;
        const dot = e0[0] * e1[0] + e0[1] * e1[1];
        const mx = e0[0] + e1[0];
        const my = e0[1] + e1[1];
        const ml = Math.hypot(mx, my) || 1;
        const smooth = dot > cosSmooth;
        const avg: V2 = [mx / ml, my / ml];
        nIn[i] = smooth ? avg : e0;
        nOut[i] = smooth ? avg : e1;
        // Positive cross means the outline turns outward here, so it is a convex corner that takes wear.
        const cross = e0[0] * e1[1] - e0[1] * e1[0];
        corner[i] = cross > 0.1 ? Math.min(1, cross * 3) : 0;
        const denom = Math.max(0.35, (avg[0] * e0[0] + avg[1] * e0[1]));
        const p = loop[i]!;
        cap[i] = [p[0] - (avg[0] * bevel) / denom, p[1] - (avg[1] * bevel) / denom];
      }
      capLoops.push(cap);
      const zf = hz - (front ? bevel : 0);
      const zb = -hz + (back ? bevel : 0);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a = loop[i]!;
        const b = loop[j]!;
        const na = nOut[i]!;
        const nb = nIn[j]!;
        // Only short arc segments carry the tag: on a long wall it would smear across the whole face.
        const shortEdge = Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.0045;
        const ca = shortEdge ? corner[i]! : 0;
        const cb = shortEdge ? corner[j]! : 0;
        this.quad(
          this.vtx(a[0], a[1], zb, na[0], na[1], 0, ca),
          this.vtx(b[0], b[1], zb, nb[0], nb[1], 0, cb),
          this.vtx(b[0], b[1], zf, nb[0], nb[1], 0, cb),
          this.vtx(a[0], a[1], zf, na[0], na[1], 0, ca),
        );
        if (bevel > 0) {
          const pa = cap[i]!;
          const pb = cap[j]!;
          if (front) {
            this.quad(
              this.vtx(a[0], a[1], zf, na[0], na[1], 0, 1),
              this.vtx(b[0], b[1], zf, nb[0], nb[1], 0, 1),
              this.vtx(pb[0], pb[1], hz, 0, 0, 1, 1),
              this.vtx(pa[0], pa[1], hz, 0, 0, 1, 1),
            );
          }
          if (back) {
            this.quad(
              this.vtx(pa[0], pa[1], -hz, 0, 0, -1, 1),
              this.vtx(pb[0], pb[1], -hz, 0, 0, -1, 1),
              this.vtx(b[0], b[1], zb, nb[0], nb[1], 0, 1),
              this.vtx(a[0], a[1], zb, na[0], na[1], 0, 1),
            );
          }
        }
      }
    }
    if (front) this.cap(capLoops, hz, 1);
    if (back) this.cap(capLoops, -hz, -1);
  }

  private cap(loops: V2[][], z: number, sign: 1 | -1): void {
    const contour = loops[0]!.map(p => new THREE.Vector2(p[0], p[1]));
    const holes = loops.slice(1).map(h => h.map(p => new THREE.Vector2(p[0], p[1])));
    const flat: V2[] = loops.flat();
    const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
    const base = this.layer_.count;
    for (const p of flat) this.vtx(p[0], p[1], z, 0, 0, sign, 0);
    for (const f of faces) {
      const a = flat[f[0]!]!;
      const b = flat[f[1]!]!;
      const c = flat[f[2]!]!;
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
      if (area * sign > 0) this.tri(base + f[0]!, base + f[1]!, base + f[2]!);
      else this.tri(base + f[0]!, base + f[2]!, base + f[1]!);
    }
  }

  /** Outline authored in (z, y) gun-side view, extruded along X, centred on X=0. */
  side(outline: readonly V2[], width: number, o?: PrismOpts): void {
    this.basis([0, 0, 1], [0, 1, 0], [1, 0, 0], () => this.prism(outline, width, o));
  }

  /** Outline authored in (x, z) top view, extruded along Y, centred on Y=0. */
  top(outline: readonly V2[], height: number, o?: PrismOpts): void {
    this.basis([1, 0, 0], [0, 0, 1], [0, 1, 0], () => this.prism(outline, height, o));
  }

  /** Outline authored in (x, y) from behind the gun, extruded along Z, centred on Z=0. */
  front(outline: readonly V2[], length: number, o?: PrismOpts): void {
    this.prism(outline, length, o);
  }

  private basis(u: V3, v: V3, w: V3, fn: () => void): void {
    const saved = this.m.clone();
    _mat.set(u[0], v[0], w[0], 0, u[1], v[1], w[1], 0, u[2], v[2], w[2], 0, 0, 0, 0, 1);
    this.m.multiply(_mat);
    this.syncMatrix();
    fn();
    this.m.copy(saved);
    this.syncMatrix();
  }

  /** Bevelled box centred on the current origin. */
  box(w: number, h: number, d: number, bevel?: number, corner?: number): void {
    const b = Math.min(bevel ?? this.bevel, w * 0.4, h * 0.4, d * 0.4);
    const r = corner ?? b;
    const x = w / 2;
    const y = h / 2;
    const c = Math.min(r, x * 0.8, y * 0.8);
    const k = c * 0.3;
    const out: V2[] = [
      [-x + c, -y], [x - c, -y], [x - k, -y + k], [x, -y + c], [x, y - c], [x - k, y - k],
      [x - c, y], [-x + c, y], [-x + k, y - k], [-x, y - c], [-x, -y + c], [-x + k, -y + k],
    ];
    this.prism(out, d, { bevel: b, smooth: 50 });
  }

  // --- Solids of revolution ----------------------------------------------------------------------

  /**
   * Revolves a profile around local Z. Points are [radius, z, chamfer?]. Walk the outside from the rear (+Z)
   * to the front (-Z), then back through any bore, so normals face out of the solid.
   */
  lathe(profile: readonly (readonly [number, number, number?])[], seg = 24, o: LatheOpts = {}): void {
    const def = o.chamfer ?? this.bevel * 0.7;
    const cosSmooth = Math.cos(((o.smooth ?? 32) * Math.PI) / 180);
    const a0 = o.a0 ?? 0;
    const a1 = o.a1 ?? Math.PI * 2;

    // Expand sharp corners into chamfers.
    interface Pt { r: number; z: number; }
    const pts: Pt[] = [];
    const chamferEdge: boolean[] = [];
    const n0 = profile.length;
    for (let i = 0; i < n0; i++) {
      const p = profile[i]!;
      const c = p[2] ?? def;
      if (i > 0 && i < n0 - 1 && c > 0) {
        const a = profile[i - 1]!;
        const b = profile[i + 1]!;
        const ax = a[0] - p[0];
        const ay = a[1] - p[1];
        const bx = b[0] - p[0];
        const by = b[1] - p[1];
        const la = Math.hypot(ax, ay);
        const lb = Math.hypot(bx, by);
        const cosAng = la > 0 && lb > 0 ? (ax * bx + ay * by) / (la * lb) : -1;
        if (cosAng > -cosSmooth) {
          const t = Math.min(c, la * 0.45, lb * 0.45);
          pts.push({ r: p[0] + (ax / la) * t, z: p[1] + (ay / la) * t });
          chamferEdge[pts.length - 1] = true;
          pts.push({ r: p[0] + (bx / lb) * t, z: p[1] + (by / lb) * t });
          continue;
        }
      }
      pts.push({ r: p[0], z: p[1] });
    }

    const ne = pts.length - 1;
    const enr = new Float64Array(ne);
    const enz = new Float64Array(ne);
    for (let i = 0; i < ne; i++) {
      const dr = pts[i + 1]!.r - pts[i]!.r;
      const dz = pts[i + 1]!.z - pts[i]!.z;
      const l = Math.hypot(dr, dz) || 1;
      enr[i] = -dz / l;
      enz[i] = dr / l;
    }
    for (let e = 0; e < ne; e++) {
      const isChamfer = chamferEdge[e] === true;
      // Chamfer edges borrow their neighbours' normals; smooth runs average them.
      let sr = enr[e]!;
      let sz = enz[e]!;
      let er = enr[e]!;
      let ez = enz[e]!;
      if (e > 0) {
        const pr = enr[e - 1]!;
        const pz = enz[e - 1]!;
        const dot = pr * enr[e]! + pz * enz[e]!;
        if (isChamfer) { sr = pr; sz = pz; }
        else if (chamferEdge[e - 1]) { /* keep own */ }
        else if (dot > cosSmooth) { const l = Math.hypot(pr + sr, pz + sz) || 1; sr = (pr + enr[e]!) / l; sz = (pz + enz[e]!) / l; }
      }
      if (e < ne - 1) {
        const nr = enr[e + 1]!;
        const nz = enz[e + 1]!;
        const dot = nr * enr[e]! + nz * enz[e]!;
        if (isChamfer) { er = nr; ez = nz; }
        else if (chamferEdge[e + 1]) { /* keep own */ }
        else if (dot > cosSmooth) { const l = Math.hypot(nr + er, nz + ez) || 1; er = (nr + enr[e]!) / l; ez = (nz + enz[e]!) / l; }
      }
      const p0 = pts[e]!;
      const p1 = pts[e + 1]!;
      if (p0.r < 1e-7 && p1.r < 1e-7) continue;
      const edge = isChamfer ? 1 : 0;
      let prev0 = -1;
      let prev1 = -1;
      for (let j = 0; j <= seg; j++) {
        const a = a0 + ((a1 - a0) * j) / seg;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const v0 = this.vtx(p0.r * c, p0.r * s, p0.z, sr * c, sr * s, sz, edge);
        const v1 = this.vtx(p1.r * c, p1.r * s, p1.z, er * c, er * s, ez, edge);
        if (j > 0) this.quad(prev0, prev1, v1, v0);
        prev0 = v0;
        prev1 = v1;
      }
    }
  }

  /** Solid cylinder along Z, centred on the origin, chamfered at both ends. */
  cyl(r: number, length: number, seg = 16, chamfer?: number): void {
    const h = length / 2;
    this.lathe([[0, h], [r, h], [r, -h], [0, -h]], seg, { chamfer: chamfer ?? this.bevel * 0.7 });
  }

  /** Hollow tube along Z with a visible bore. */
  pipe(r: number, bore: number, length: number, seg = 16): void {
    const h = length / 2;
    this.lathe([[bore, h], [r, h], [r, -h], [bore, -h], [bore, h]], seg);
  }

  // --- Sweeps and free surfaces ------------------------------------------------------------------

  /** Parametric surface. Normals are central differences on the grid. Face direction is du x dv. */
  surface(nu: number, nv: number, fn: (u: number, v: number, out: THREE.Vector3) => void, o: SurfaceOpts = {}): void {
    const cu = nu + 1;
    const cv = nv + 1;
    const g = new Float64Array(cu * cv * 3);
    for (let j = 0; j < cv; j++) {
      for (let i = 0; i < cu; i++) {
        fn(i / nu, j / nv, _a);
        const k = (j * cu + i) * 3;
        g[k] = _a.x;
        g[k + 1] = _a.y;
        g[k + 2] = _a.z;
      }
    }
    const at = (i: number, j: number, c: number) => g[(j * cu + i) * 3 + c]!;
    const idx = new Int32Array(cu * cv);
    for (let j = 0; j < cv; j++) {
      for (let i = 0; i < cu; i++) {
        const i0 = i > 0 ? i - 1 : o.wrapU ? nu - 1 : 0;
        const i1 = i < nu ? i + 1 : o.wrapU ? 1 : nu;
        const j0 = j > 0 ? j - 1 : o.wrapV ? nv - 1 : 0;
        const j1 = j < nv ? j + 1 : o.wrapV ? 1 : nv;
        _b.set(at(i1, j, 0) - at(i0, j, 0), at(i1, j, 1) - at(i0, j, 1), at(i1, j, 2) - at(i0, j, 2));
        _c.set(at(i, j1, 0) - at(i, j0, 0), at(i, j1, 1) - at(i, j0, 1), at(i, j1, 2) - at(i, j0, 2));
        _b.cross(_c);
        if (_b.lengthSq() < 1e-20) _b.set(0, 1, 0);
        _b.normalize();
        if (o.flip) _b.negate();
        idx[j * cu + i] = this.vtx(at(i, j, 0), at(i, j, 1), at(i, j, 2), _b.x, _b.y, _b.z, o.edge ? o.edge(i / nu, j / nv) : 0);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = idx[j * cu + i]!;
        const b = idx[j * cu + i + 1]!;
        const c = idx[(j + 1) * cu + i + 1]!;
        const d = idx[(j + 1) * cu + i]!;
        if (o.flip) this.quad(a, d, c, b);
        else this.quad(a, b, c, d);
      }
    }
  }

  /** Round tube along a path, spline-smoothed unless `straight`. `r` can vary along the length. */
  tube(path: readonly V3[], r: number | ((t: number) => number), o: TubeOpts = {}): void {
    const seg = o.seg ?? 8;
    const pts = path.map(p => new THREE.Vector3(p[0], p[1], p[2]));
    let samples: THREE.Vector3[];
    if (o.straight) {
      samples = pts;
    } else {
      const curve = new THREE.CatmullRomCurve3(pts, o.closed ?? false, 'catmullrom', o.tension ?? 0.5);
      samples = curve.getSpacedPoints(o.samples ?? Math.max(8, pts.length * 5));
      if (o.closed) samples.pop();
    }
    const n = samples.length;
    const radius = typeof r === 'number' ? () => r : r;
    const tan = samples.map((p, i) => {
      const a = samples[o.closed ? (i + n - 1) % n : Math.max(i - 1, 0)]!;
      const b = samples[o.closed ? (i + 1) % n : Math.min(i + 1, n - 1)]!;
      return new THREE.Vector3().subVectors(b, a).normalize();
    });
    // Parallel transport keeps the rings from twisting along bends.
    const nor = new THREE.Vector3(0, 1, 0);
    if (Math.abs(tan[0]!.y) > 0.9) nor.set(1, 0, 0);
    nor.addScaledVector(tan[0]!, -nor.dot(tan[0]!)).normalize();
    const ringCount = o.closed ? n + 1 : n;
    const rings: number[][] = [];
    const bin = new THREE.Vector3();
    for (let i = 0; i < ringCount; i++) {
      const k = i % n;
      const t = tan[k]!;
      if (i > 0) nor.addScaledVector(t, -nor.dot(t)).normalize();
      bin.crossVectors(t, nor);
      const rad = radius(i / (ringCount - 1));
      const c = samples[k]!;
      const ring: number[] = [];
      for (let j = 0; j <= seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        const cs = Math.cos(a);
        const sn = Math.sin(a);
        const nx = nor.x * cs + bin.x * sn;
        const ny = nor.y * cs + bin.y * sn;
        const nz = nor.z * cs + bin.z * sn;
        ring.push(this.vtx(c.x + nx * rad, c.y + ny * rad, c.z + nz * rad, nx, ny, nz));
      }
      rings.push(ring);
    }
    for (let i = 0; i < ringCount - 1; i++) {
      for (let j = 0; j < seg; j++) {
        this.quad(rings[i]![j]!, rings[i]![j + 1]!, rings[i + 1]![j + 1]!, rings[i + 1]![j]!);
      }
    }
    if (o.caps !== false && !o.closed) {
      this.tubeCap(samples[0]!, tan[0]!, rings[0]!, seg, -1);
      this.tubeCap(samples[n - 1]!, tan[n - 1]!, rings[n - 1]!, seg, 1);
    }
  }

  private tubeCap(center: THREE.Vector3, t: THREE.Vector3, ring: number[], seg: number, sign: 1 | -1): void {
    const l = this.layer_;
    const c = this.vtx(center.x, center.y, center.z, t.x * sign, t.y * sign, t.z * sign);
    // The ring is already in part space, so reuse its positions under a fresh normal.
    const pushed: number[] = [];
    for (let j = 0; j <= seg; j++) {
      const k = ring[j]! * 3;
      const v = l.count++;
      l.p.push(l.p[k]!, l.p[k + 1]!, l.p[k + 2]!);
      const cn = c * 3;
      l.n.push(l.n[cn]!, l.n[cn + 1]!, l.n[cn + 2]!);
      const q = ring[j]! * 4;
      l.a.push(l.a[q]!, l.a[q + 1]!, l.a[q + 2]!, l.a[q + 3]!);
      l.s.push(l.s[q]!, l.s[q + 1]!, l.s[q + 2]!, l.s[q + 3]!);
      l.k.push(l.k[ring[j]!]!);
      if (this.skinFn) {
        const b = ring[j]! * 4;
        l.si.push(l.si[b]!, l.si[b + 1]!, 0, 0);
        l.sw.push(l.sw[b]!, l.sw[b + 1]!, 0, 0);
      }
      pushed.push(v);
    }
    for (let j = 0; j < seg; j++) {
      if (sign > 0) this.tri(c, pushed[j]!, pushed[j + 1]!);
      else this.tri(c, pushed[j + 1]!, pushed[j]!);
    }
  }

  /** Closed loft through rings of equal length. Rings run along the body; points go counter-clockwise. */
  loft(rings: readonly (readonly V3[])[], o: { capStart?: boolean; capEnd?: boolean; flip?: boolean } = {}): void {
    const nr = rings.length - 1;
    const np = rings[0]!.length;
    this.surface(np, nr, (u, v, out) => {
      const i = Math.round(u * np) % np;
      const j = Math.round(v * nr);
      const p = rings[j]![i]!;
      out.set(p[0], p[1], p[2]);
    }, { wrapU: true, flip: o.flip });
    const fan = (ring: readonly V3[], sign: 1 | -1) => {
      let cx = 0, cy = 0, cz = 0;
      for (const p of ring) { cx += p[0]; cy += p[1]; cz += p[2]; }
      cx /= np; cy /= np; cz /= np;
      _a.set(ring[0]![0] - cx, ring[0]![1] - cy, ring[0]![2] - cz);
      _b.set(ring[1]![0] - cx, ring[1]![1] - cy, ring[1]![2] - cz);
      _c.crossVectors(_a, _b).normalize().multiplyScalar(sign * (o.flip ? -1 : 1));
      const nx = _c.x, ny = _c.y, nz = _c.z;
      const c = this.vtx(cx, cy, cz, nx, ny, nz);
      const vs = ring.map(p => this.vtx(p[0], p[1], p[2], nx, ny, nz, 0.6));
      for (let i = 0; i < np; i++) {
        const a = vs[i]!;
        const b = vs[(i + 1) % np]!;
        if ((sign > 0) !== !!o.flip) this.tri(c, a, b);
        else this.tri(c, b, a);
      }
    };
    if (o.capStart) fan(rings[0]!, -1);
    if (o.capEnd) fan(rings[nr]!, 1);
  }

  /** Flat quad facing +Z that shows a live canvas readout. */
  screen(name: string, w: number, h: number): void {
    this.inLayer(`screen:${name}`, () => {
      const l = this.layer_;
      const a = this.vtx(-w / 2, -h / 2, 0, 0, 0, 1);
      const b = this.vtx(w / 2, -h / 2, 0, 0, 0, 1);
      const c = this.vtx(w / 2, h / 2, 0, 0, 0, 1);
      const d = this.vtx(-w / 2, h / 2, 0, 0, 0, 1);
      l.uv.length = a * 2;
      // A reflected transform would otherwise show the readout backwards.
      if (this.flip) l.uv.push(1, 0, 0, 0, 0, 1, 1, 1);
      else l.uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      this.quad(a, b, c, d);
    });
  }

  /** Flat quad facing +Z textured from the decal atlas. Tint is white unless the current finish says otherwise. */
  decal(name: string, w: number, h: number, color = 0xffffff): void {
    const r = this.decals[name];
    if (!r) throw new Error(`Unknown decal ${name}`);
    this.inLayer('decal', () => {
      const saved = this.finish;
      this.use({ ...saved, color });
      const l = this.layer_;
      const a = this.vtx(-w / 2, -h / 2, 0, 0, 0, 1);
      const b = this.vtx(w / 2, -h / 2, 0, 0, 0, 1);
      const c = this.vtx(w / 2, h / 2, 0, 0, 0, 1);
      const d = this.vtx(-w / 2, h / 2, 0, 0, 0, 1);
      l.uv.length = a * 2;
      l.uv.push(r[0], r[1], r[2], r[1], r[2], r[3], r[0], r[3]);
      this.quad(a, b, c, d);
      this.use(saved);
    });
  }
}

function oriented(loop: readonly V2[], ccw: boolean): V2[] {
  let area = 0;
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % n]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  const isCcw = area > 0;
  return isCcw === ccw ? [...loop] : [...loop].reverse();
}

/** Turns one layer into a BufferGeometry with compact attributes. */
export function layerGeometry(l: Layer, withUv: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(l.p), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(l.n), 3));
  g.setAttribute('aAlb', new THREE.BufferAttribute(new Uint8Array(l.a), 4, true));
  g.setAttribute('aSurf', new THREE.BufferAttribute(new Uint8Array(l.s), 4, true));
  g.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(l.k), 1));
  if (withUv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(l.uv), 2));
  if (l.si.length > 0) {
    g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(l.si), 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(l.sw), 4));
  }
  g.setIndex(l.count > 65535 ? new THREE.BufferAttribute(new Uint32Array(l.i), 1) : new THREE.BufferAttribute(new Uint16Array(l.i), 1));
  g.computeBoundingSphere();
  return g;
}

export type { Layer };
