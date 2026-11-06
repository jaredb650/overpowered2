/** Parameterised equipment. Everything conforms to the snapshot of the body it is worn on. */
import type { Mat, Model } from '../model';
import {
  add, at, blend, capsule, cone, cut, cyl, displace, ellipsoid, fbm, frameE, frameY, frustum,
  len, mix, noise, norm, rbox, ridged, rows, scale, smax, sphere, spline, sub, torus, tube, union,
  type Shape, type V3,
} from '../sdf';
import { darkSteel, rubber, steel } from './materials';
import { B, type Side, type Sk } from './skeleton';

/** The mask's box, limited to the body's box. A slab mask alone would span the whole bake volume. */
function clip(mask: Shape, base: Shape, pad: number): { lo: V3; hi: V3 } {
  return {
    lo: [Math.max(mask.lo[0], base.lo[0] - pad), Math.max(mask.lo[1], base.lo[1] - pad), Math.max(mask.lo[2], base.lo[2] - pad)],
    hi: [Math.min(mask.hi[0], base.hi[0] + pad), Math.min(mask.hi[1], base.hi[1] + pad), Math.min(mask.hi[2], base.hi[2] + pad)],
  };
}

/** Skin of `base` at offset `off`, cut to `mask`. The mask runs first, so most points never touch the body. */
export function conform(base: Shape, off: number, thick: number, mask: Shape, bevel = 0.003): Shape {
  const f = base.f, mf = mask.f;
  const h = thick / 2;
  return {
    f: (x, y, z) => {
      const m = mf(x, y, z);
      if (m > 0.03) return m;
      return smax(Math.abs(f(x, y, z) - off) - h, m, bevel);
    },
    ...clip(mask, base, off + h),
  };
}

/** Solid layer from inside the body out to `off`, cut to `mask`. For pads with no visible underside. */
export function padOn(base: Shape, off: number, mask: Shape, bevel = 0.004): Shape {
  const f = base.f, mf = mask.f;
  return {
    f: (x, y, z) => {
      const m = mf(x, y, z);
      if (m > 0.03) return m;
      return smax(f(x, y, z) - off, m, bevel);
    },
    ...clip(mask, base, off),
  };
}

/** First point on the zero set of `base`, marching from `from` along `dir`. */
export function surfaceHit(base: Shape, from: V3, dir: V3, maxDist = 0.5): V3 {
  const d = norm(dir);
  let t = 0;
  for (let i = 0; i < 96 && t < maxDist; i++) {
    const p = add(from, scale(d, t));
    const v = base.f(p[0], p[1], p[2]);
    if (v < 0.0008) return p;
    t += Math.max(v * 0.7, 0.001);
  }
  return add(from, scale(d, t));
}

/** Clothing folds: long drapes down the limbs plus tight compression creases across them. */
export function foldField(amount: number, seed = 0) {
  return (x: number, y: number, z: number) => {
    const drape = fbm(x * 8 + seed, y * 2.6, z * 8, 3);
    const crease = ridged(x * 13 + seed, y * 21, z * 13, 2) - 0.55;
    return (drape * 0.016 + crease * 0.0075) * amount;
  };
}

export interface SuitOptions {
  off?: number;
  folds?: number;
  /** Bare patches. */
  exclude?: Shape[];
  seed?: number;
}

export function suit(m: Model, base: Shape, mat: Mat, o: SuitOptions = {}): void {
  const f = base.f;
  const off = o.off ?? 0.007;
  const fold = foldField(o.folds ?? 1, o.seed ?? 0);
  const ex = o.exclude?.length ? union(...o.exclude) : null;
  const exf = ex?.f;
  m.add({
    f: (x, y, z) => {
      const d0 = f(x, y, z) - off;
      // Fold noise is the expensive part and only matters right at the surface.
      if (d0 > 0.04 || d0 < -0.04) return d0;
      // Folds only ever rise from the cloth line, or skin shows through in the troughs.
      const d = d0 - Math.max(fold(x, y, z), -off * 0.7);
      if (!exf) return d;
      return smax(d, -exf(x, y, z), 0.006);
    },
    lo: base.lo,
    hi: base.hi,
  }, mat, -1);
}

/** Hand and head cut-outs that nearly every garment needs. */
export function handsAndHead(sk: Sk, withHead = true): Shape[] {
  const out = [
    sphere(sk.on(B.foreArmL, B.handL, 1.25), 0.13),
    sphere(sk.on(B.foreArmR, B.handR, 1.25), 0.13),
  ];
  if (withHead) out.push(sphere(sk.p(B.head, 0, 0.09, 0.0), 0.15));
  return out;
}

export function feet(sk: Sk): Shape[] {
  return [sphere(sk.p(B.footL, 0, -0.03, 0.03), 0.12), sphere(sk.p(B.footR, 0, -0.03, 0.03), 0.12)];
}

export function boot(m: Model, sk: Sk, side: Side, mat: Mat, o: { plated?: Mat; height?: number } = {}): void {
  const { foot, shin } = sk.legBones(side);
  const A = sk.pos[foot]!;
  const x = A[0];
  const top = o.height ?? 0.24;
  const shaft = blend(0.02, cone(sk.p(foot, 0, top, -0.004), sk.p(foot, 0, 0.03, -0.012), 0.056, 0.05), torus(sk.p(foot, 0, top, -0.004), [0, 1, 0], 0.052, 0.008));
  m.add(shaft, mat, shin, { k: 0.01 });
  const vamp = blend(0.035,
    ellipsoid([x, 0.062, -0.052], [0.05, 0.06, 0.062]),
    ellipsoid([x + side * 0.004, 0.056, 0.05], [0.052, 0.048, 0.1]),
    ellipsoid([x + side * 0.005, 0.05, 0.135], [0.05, 0.04, 0.062]));
  m.add(vamp, mat, foot, { k: 0.016 });
  const soleOutline = blend(0.03, ellipsoid([x, 0.015, -0.05], [0.056, 0.03, 0.08]), ellipsoid([x + side * 0.006, 0.015, 0.1], [0.06, 0.03, 0.115]));
  const sole = cut(cut(soleOutline, rbox([x, -0.1, 0.03], [0.2, 0.1, 0.3], 0.001)), rbox([x, 0.13, 0.03], [0.2, 0.1, 0.3], 0.001));
  m.add(sole, rubber, foot, { rigid: true });
  m.cut(rows(rbox([x, 0.0, -0.11], [0.09, 0.012, 0.006], 0.002), 2, 0.034, 10), { detail: true });
  m.add(ellipsoid([x + side * 0.005, 0.066, 0.158], [0.046, 0.032, 0.046]), steel, foot, { rigid: true, k: 0.004 });
  for (let i = 0; i < 4; i++) {
    const zz = 0.062 - i * 0.013;
    m.add(capsule([x - 0.03, 0.09 + i * 0.02, zz + 0.022], [x + 0.03, 0.09 + i * 0.02, zz + 0.022], 0.0036), darkSteel, foot, { detail: true });
  }
  m.add(conformBand(sk.p(foot, 0, 0.1, -0.012), 0.057, 0.015), darkSteel, shin, { rigid: true, detail: true });
  if (o.plated) m.add(rbox(sk.p(foot, 0, 0.13, 0.058), [0.034, 0.08, 0.01], 0.008), o.plated, shin, { rigid: true });
}

/** A strap around a limb, as a thin torus-like hoop. */
export function conformBand(c: V3, r: number, w: number): Shape {
  return cut(cyl(sub(c, [0, w / 2, 0]), add(c, [0, w / 2, 0]), r + 0.005, 0.002), cyl(sub(c, [0, w, 0]), add(c, [0, w, 0]), r - 0.002, 0.001));
}

/** A horizontal band around the torso alone. An unbounded slab would also ring the arms hanging beside it. */
export function torsoBand(sk: Sk, y: number, h: number): Shape {
  const W = sk.pos[B.upperArmL]![0] / 0.2;
  return rbox([0, y, 0], [0.245 * W, h, 0.32], 0.002);
}

export function belt(m: Model, sk: Sk, base: Shape, y: number, mat: Mat, buckle: Mat, o: { width?: number; off?: number; bone?: number } = {}): void {
  const w = o.width ?? 0.022;
  const off = o.off ?? 0.016;
  const bone = o.bone ?? B.hips;
  m.add(padOn(base, off, torsoBand(sk, y, w), 0.003), mat, bone);
  const front = surfaceHit(base, [0, y, 0.4], [0, 0, -1]);
  m.add(rbox(add(front, [0, 0, off + 0.004]), [0.024, w + 0.004, 0.007], 0.003), buckle, bone, { rigid: true });
}

export interface PouchOptions {
  size?: V3;
  flap?: Mat;
  bone: number;
}

export function pouch(m: Model, c: V3, mat: Mat, o: PouchOptions): void {
  const s = o.size ?? [0.042, 0.048, 0.024];
  m.add(rbox(c, s, 0.012), mat, o.bone, { rigid: true });
  m.add(rbox(add(c, [0, s[1] * 0.55, 0.002]), [s[0] * 1.06, s[1] * 0.55, s[2] * 1.12], 0.01), o.flap ?? mat, o.bone, { rigid: true, k: 0.002 });
  m.add(cyl(add(c, [0, s[1] * 0.2, s[2] * 1.05]), add(c, [0, s[1] * 0.2, s[2] * 1.3]), 0.006), steel, o.bone, { rigid: true, detail: true });
}

/** Plate with edge bevel, panel lines and rivets. */
export function plate(m: Model, base: Shape, off: number, thick: number, mask: Shape, mat: Mat, bone: number, o: { rigid?: boolean; bevel?: number } = {}): Shape {
  const s = conform(base, off, thick, mask, o.bevel ?? 0.004);
  m.add(s, mat, bone, { rigid: o.rigid ?? true });
  return s;
}

export function panelLine(m: Model, a: V3, b: V3, r = 0.0026): void {
  m.cut(capsule(a, b, r), { detail: true, k: 0.0015 });
}

/** A shallow engraved line following `surface`, wherever `mask` crosses it. */
export function groove(m: Model, surface: Shape, mask: Shape, depth = 0.0032): void {
  const sf = surface.f, mf = mask.f;
  m.cut({
    f: (x, y, z) => {
      const a = mf(x, y, z);
      if (a > 0.012) return a;
      return smax(a, -(sf(x, y, z) + depth), 0.0008);
    },
    lo: mask.lo,
    hi: mask.hi,
  }, { detail: true, k: 0.0014 });
}

/** Thin blades for groove masks. Depth runs along Z unless the shape is rotated. */
export const lineV = (x: number, y0: number, y1: number, z: number, w = 0.0022, deep = 0.16): Shape => rbox([x, (y0 + y1) / 2, z], [w, (y1 - y0) / 2, deep], 0.0006);
export const lineH = (y: number, x0: number, x1: number, z: number, w = 0.0022, deep = 0.16): Shape => rbox([(x0 + x1) / 2, y, z], [(x1 - x0) / 2, w, deep], 0.0006);

const stencilInk: Mat = { albedo: [0.78, 0.8, 0.76], rough: 0.6, detail: 2, wear: 0.4 };

/** Painted unit marks: a block of bars that reads as lettering from a few metres. */
export function stencil(m: Model, c: V3, w: number, h: number, seed: number, ink: Mat = stencilInk, axis: 'z' | 'x' = 'z'): void {
  let s = seed * 2654435761;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const glyphs = 3 + Math.floor(rnd() * 2);
  const gw = (w / glyphs) * 0.76;
  for (let g = 0; g < glyphs; g++) {
    const gx = -w / 2 + (g + 0.5) * (w / glyphs);
    for (let bar = 0; bar < 3; bar++) {
      const horizontal = rnd() > 0.35;
      const by = (bar - 1) * h * 0.42;
      const box = horizontal
        ? (axis === 'z' ? rbox(add(c, [gx, by, 0]), [gw / 2, h * 0.075, 0.2], 0.0004) : rbox(add(c, [0, by, gx]), [0.2, h * 0.075, gw / 2], 0.0004))
        : (axis === 'z' ? rbox(add(c, [gx + (rnd() - 0.5) * gw * 0.7, by * 0.6, 0]), [gw * 0.13, h * 0.3, 0.2], 0.0004) : rbox(add(c, [0, by * 0.6, gx + (rnd() - 0.5) * gw * 0.7]), [0.2, h * 0.3, gw * 0.13], 0.0004));
      m.paint(box, ink, 0.0008);
    }
  }
}

export function rivets(m: Model, surface: Shape, pts: readonly V3[], dir: V3, mat: Mat, bone: number, r = 0.0052): void {
  for (const p of pts) {
    const hit = surfaceHit(surface, sub(p, scale(norm(dir), 0.12)), dir, 0.3);
    m.add(sphere(hit, r), mat, bone, { detail: true });
  }
}

export interface HoseOptions {
  ribs?: number;
  r?: number;
  mat?: Mat;
  sag?: number;
}

export function hosePath(m: Model, ctrl: readonly V3[], bone: number, o: HoseOptions = {}): void {
  m.add(tube(spline(ctrl, ctrl.length * 7), o.r ?? 0.011, { ribs: o.ribs ?? 110, ribDepth: 0.0018 }), o.mat ?? rubber, bone);
}

/** Local frame of a head, with helpers for face positions. */
export const headP = (sk: Sk) => (x: number, y: number, z: number): V3 => sk.p(B.head, x, y, z);

/** Rubber hood sealed to the neck. The base for every masked head. */
export function hood(m: Model, sk: Sk, mat: Mat, o: { folds?: number; size?: number } = {}): void {
  const P = headP(sk);
  const q = o.size ?? 1;
  const dome = blend(0.04,
    ellipsoid(P(0, 0.104, -0.008), [0.092 * q, 0.104 * q, 0.108 * q]),
    ellipsoid(P(0, 0.05, 0.02), [0.078 * q, 0.092 * q, 0.084 * q]),
    cone(P(0, 0.03, -0.015), P(0, -0.1, -0.02), 0.076, 0.082));
  const folds = o.folds ?? 1;
  m.add(displace(dome, (x, y, z) => ridged(x * 18, y * 26, z * 18, 2) * 0.004 * folds, 0.006), mat, B.head, { k: 0.01 });
}

/** Respirator snout with a screw-on filter. */
export function respirator(m: Model, sk: Sk, mat: Mat, o: { filter?: Mat; side?: boolean } = {}): void {
  const P = headP(sk);
  const body = blend(0.02,
    ellipsoid(P(0, 0.03, 0.098), [0.06, 0.05, 0.042]),
    frustum(P(0, 0.024, 0.12), P(0, 0.008, 0.172), 0.038, 0.028, 0.006));
  m.add(body, mat, B.head, { rigid: true, k: 0.012 });
  const fa = P(0, 0.006, 0.168), fb = P(0, -0.004, 0.204);
  const filter = o.filter ?? darkSteel;
  m.add(cyl(fa, fb, 0.039, 0.005), filter, B.head, { rigid: true });
  for (let i = 0; i < 3; i++) {
    const t = 0.25 + i * 0.25;
    const p = mix(fa, fb, t);
    const axis = sub(fb, fa);
    m.cut(torus(p, axis, 0.04, 0.0022), { detail: true });
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    m.cut(cyl(add(fb, [Math.cos(a) * 0.02, Math.sin(a) * 0.02, -0.004]), add(fb, [Math.cos(a) * 0.02, Math.sin(a) * 0.02, 0.012]), 0.0058, 0.001), { detail: true, mat: rubber });
  }
  if (o.side) {
    for (const s of [1, -1]) {
      const a = P(s * 0.058, 0.012, 0.086), b = P(s * 0.098, -0.016, 0.098);
      m.add(cyl(a, b, 0.026, 0.005), filter, B.head, { rigid: true });
    }
  }
}

export interface HelmetOptions {
  mat: Mat;
  /** Scale of the shell over the skull. */
  size?: number;
  brim?: boolean;
  ears?: boolean;
  neckGuard?: boolean;
}

/** Hard shell over the skull. */
export function helmet(m: Model, sk: Sk, o: HelmetOptions): Shape {
  const P = headP(sk);
  const q = o.size ?? 1;
  const dome = ellipsoid(P(0, 0.115, -0.006), [0.106 * q, 0.103 * q, 0.122 * q]);
  const lower = rbox(P(0, 0.056, -0.02), [0.2, 0.054, 0.3], 0.002);
  let shell = cut(dome, lower, 0.008);
  shell = cut(shell, rbox(P(0, 0.07, 0.12), [0.07, 0.03, 0.06], 0.01), 0.008);
  m.add(shell, o.mat, B.head, { rigid: true });
  // Crown ridge, a ring around the crown and a line down each side of the face.
  groove(m, shell, lineV(0, 0.08 + sk.pos[B.head]![1], 0.26 + sk.pos[B.head]![1], sk.pos[B.head]![2], 0.0018, 0.2));
  groove(m, shell, lineH(sk.pos[B.head]![1] + 0.15, -0.14, 0.14, sk.pos[B.head]![2], 0.0018, 0.2));
  rivets(m, shell, [-0.08, -0.04, 0.04, 0.08].map(x => P(x, 0.136, 0)), [0, 0, -1], steel, B.head, 0.0042);
  if (o.brim) m.add(at(frameE(P(0, 0.122, 0.106), -0.28), rbox([0, 0, 0], [0.092, 0.007, 0.03], 0.006)), o.mat, B.head, { rigid: true, k: 0.008 });
  if (o.ears) {
    for (const s of [1, -1]) {
      m.add(cyl(P(s * 0.088, 0.088, 0.0), P(s * 0.118, 0.088, 0.0), 0.044, 0.008), darkSteel, B.head, { rigid: true });
      m.add(torus(P(s * 0.118, 0.088, 0), [1, 0, 0], 0.03, 0.005), steel, B.head, { rigid: true, detail: true });
    }
  }
  if (o.neckGuard) {
    const guard = cut(ellipsoid(P(0, 0.05, -0.06), [0.112 * q, 0.07, 0.092 * q]), ellipsoid(P(0, 0.05, -0.02), [0.09 * q, 0.1, 0.1 * q]));
    m.add(cut(guard, rbox(P(0, 0.05, 0.18), [0.2, 0.2, 0.14], 0.002)), o.mat, B.head, { rigid: true });
  }
  return shell;
}

/** Horizontal visor slit: dark band with a thin emissive core. */
export function visorSlit(m: Model, sk: Sk, accent: Mat, o: { y?: number; w?: number; h?: number; z?: number } = {}): void {
  const P = headP(sk);
  const y = o.y ?? 0.09;
  const w = o.w ?? 0.085;
  const h = o.h ?? 0.014;
  const z = o.z ?? 0.118;
  m.add(cut(ellipsoid(P(0, y, z - 0.05), [w + 0.012, h + 0.012, 0.062]), rbox(P(0, y, z - 0.13), [0.2, 0.1, 0.06], 0.002)), darkSteel, B.head, { rigid: true });
  m.add(ellipsoid(P(0, y, z - 0.044), [w, h, 0.06]), accent, B.head, { rigid: true });
}

export function antenna(m: Model, a: V3, b: V3, bone: number, mat: Mat, tip?: Mat): void {
  m.add(cone(a, b, 0.006, 0.0022), mat, bone, { rigid: true });
  m.add(cyl(a, add(a, scale(norm(sub(b, a)), 0.04)), 0.011), darkSteel, bone, { rigid: true });
  if (tip) m.add(sphere(b, 0.008), tip, bone, { rigid: true });
}

/** Hinged shoulder plate. `tier` stacks extra lames below it. */
export function pauldron(m: Model, sk: Sk, side: Side, mat: Mat, o: { size?: number; tiers?: number; spike?: Mat; flare?: number } = {}): void {
  const { upper, fore } = sk.armBones(side);
  const U = sk.pos[upper]!, F = sk.pos[fore]!;
  const q = o.size ?? 1;
  const axis = norm(sub(F, U));
  const c = add(U, [side * 0.018 * q, 0.012, 0]);
  const flare = o.flare ?? 0;
  const dome = ellipsoid(c, [0.094 * q, 0.082 * q, 0.1 * q]);
  const hollow = ellipsoid(add(c, [-side * 0.01, -0.03, 0]), [0.08 * q, 0.08 * q, 0.086 * q]);
  m.add(cut(dome, hollow), mat, upper, { rigid: true });
  m.add(cut(torus(add(c, [side * 0.012, -0.03 * q, 0]), [side * 0.2 + flare * side, 1, 0], 0.086 * q, 0.009), rbox(add(c, [-side * 0.1, 0, 0]), [0.06, 0.1, 0.14], 0.002)), darkSteel, upper, { rigid: true });
  for (let t = 0; t < (o.tiers ?? 0); t++) {
    const p = add(U, scale(axis, 0.055 + t * 0.042));
    const lame = cut(ellipsoid(add(p, [side * 0.02, 0, 0]), [0.08 * q, 0.044, 0.088 * q]), ellipsoid(add(p, [side * 0.006, -0.03, 0]), [0.072 * q, 0.06, 0.08 * q]));
    m.add(lame, mat, upper, { rigid: true });
  }
  if (o.spike) {
    for (let i = -1; i <= 1; i++) m.add(cone(add(c, [side * 0.05 * q, 0.058 * q, i * 0.055 * q]), add(c, [side * 0.09 * q, 0.14 * q, i * 0.07 * q]), 0.016, 0.003), o.spike, upper, { rigid: true });
  }
}

export function kneePad(m: Model, base: Shape, sk: Sk, side: Side, mat: Mat, q = 1): void {
  const { shin } = sk.legBones(side);
  const c = sk.p(shin, 0, 0.0, 0.05);
  plate(m, base, 0.014, 0.014, ellipsoid(c, [0.064 * q, 0.082 * q, 0.07]), mat, shin);
  m.add(rbox(sk.p(shin, 0, 0.0, 0.094), [0.03 * q, 0.04 * q, 0.008], 0.007), darkSteel, shin, { rigid: true, detail: true });
}

export function elbowPad(m: Model, base: Shape, sk: Sk, side: Side, mat: Mat): void {
  const { fore } = sk.armBones(side);
  plate(m, base, 0.012, 0.012, ellipsoid(sk.p(fore, side * 0.01, 0, -0.04), [0.05, 0.058, 0.05]), mat, fore);
}

/** Armoured forearm sleeve with a wrist cuff. */
export function bracer(m: Model, base: Shape, sk: Sk, side: Side, mat: Mat): void {
  const { fore, hand } = sk.armBones(side);
  const F = sk.pos[fore]!, H = sk.pos[hand]!;
  const mid = mix(F, H, 0.58);
  const mask = at(frameY(mid, sub(H, F)), rbox([0, 0, 0], [0.09, 0.09, 0.09], 0.006));
  plate(m, base, 0.012, 0.012, mask, mat, fore);
}

export function shinGuard(m: Model, base: Shape, sk: Sk, side: Side, mat: Mat): void {
  const { shin, foot } = sk.legBones(side);
  const K = sk.pos[shin]!, A = sk.pos[foot]!;
  const c = add(mix(K, A, 0.42), [0, 0, 0.05]);
  plate(m, base, 0.014, 0.012, at(frameY(c, sub(K, A)), ellipsoid([0, 0, 0], [0.062, 0.17, 0.05])), mat, shin);
}

export function thighPlate(m: Model, base: Shape, sk: Sk, side: Side, mat: Mat): void {
  const { thigh, shin } = sk.legBones(side);
  const T = sk.pos[thigh]!, K = sk.pos[shin]!;
  const c = add(mix(T, K, 0.42), [side * 0.02, 0, 0.05]);
  plate(m, base, 0.014, 0.012, at(frameY(c, sub(T, K)), ellipsoid([0, 0, 0], [0.08, 0.15, 0.07])), mat, thigh);
}

/** Front and back torso armour, scored with seams that follow the plate. */
export function cuirass(m: Model, base: Shape, sk: Sk, mat: Mat, o: { off?: number; top?: number; bottom?: number; width?: number } = {}): Shape {
  const off = o.off ?? 0.02;
  const top = o.top ?? 1.5;
  const bottom = o.bottom ?? 1.14;
  const w = o.width ?? 0.2;
  const yc = (top + bottom) / 2;
  const mask = rbox([0, yc, 0.08], [w, (top - bottom) / 2, 0.14], 0.03);
  const front = plate(m, base, off, 0.016, mask, mat, B.chest);
  const back = plate(m, base, off, 0.016, rbox([0, yc, -0.1], [w, (top - bottom) / 2, 0.14], 0.03), mat, B.chest);
  const h = (top - bottom);
  // Sternum seam, collarbone break, and a pair of side panels with a recessed access plate.
  groove(m, front, lineV(0, bottom, top - h * 0.1, 0.1));
  groove(m, front, lineH(top - h * 0.24, -w, w, 0.1));
  groove(m, front, lineH(bottom + h * 0.22, -w, w, 0.1));
  for (const s of [1, -1]) {
    groove(m, front, lineV(s * w * 0.62, bottom + h * 0.22, top - h * 0.24, 0.1));
    groove(m, back, lineV(s * w * 0.5, bottom, top, -0.1));
    const y = top - h * 0.36;
    groove(m, front, rbox([s * w * 0.32, y, 0.1], [w * 0.17, 0.0022, 0.16], 0.0006));
    groove(m, front, rbox([s * w * 0.32, y - h * 0.16, 0.1], [w * 0.17, 0.0022, 0.16], 0.0006));
    rivets(m, front, [[s * w * 0.8, top - h * 0.12, 0], [s * w * 0.8, bottom + h * 0.1, 0], [s * w * 0.36, top - h * 0.12, 0], [s * w * 0.36, bottom + h * 0.1, 0]], [0, 0, -1], steel, B.chest, 0.0048);
  }
  groove(m, back, lineH(yc, -w, w, -0.1));
  return front;
}

/** Cloth panel hanging from a line, for tabards and coat skirts. */
export function drape(m: Model, top: V3, bottom: V3, halfWidth: number, thick: number, mat: Mat, bone: number, seed = 0): void {
  const axis = sub(bottom, top);
  const c = mix(top, bottom, 0.5);
  const L = len(axis);
  const fr = frameY(c, scale(axis, -1), [0, 0, 1]);
  // Pleats run the length of the cloth and open out toward the hem, where nothing holds them.
  const pleat = 2 * Math.PI * (2.2 / (halfWidth * 2)) * 0.5;
  const shape = at(fr, displace(
    rbox([0, 0, 0], [halfWidth, L / 2, thick], 0.003),
    (x, y, z) => {
      const hem = 0.3 + 0.7 * (0.5 - y / L);
      const wander = noise(x * 8 + seed, y * 2.2, seed) * 1.6;
      return Math.sin(x * pleat * 2 + wander) * 0.009 * hem + noise(x * 30, y * 9 + seed, z * 9) * 0.003;
    },
    0.014,
  ));
  m.add(shape, mat, bone);
}

