/**
 * Parameterised human figure. Bones give the joints; everything else is anatomy placed relative to them,
 * so the same code builds a gaunt husk and a 3 m juggernaut from proportions alone.
 */
import type { Mat, Model } from '../model';
import {
  blend, capsule, cone, cross, dot, ellipsoid, frameY, inter, mix, norm, rbox, scale, sphere, sub, at, add,
  type Frame, type Shape, type V3,
} from '../sdf';
import { B, type Side, type Sk } from './skeleton';

export type HandPose = 'fist' | 'grip' | 'claw' | 'open';

export interface BodyOptions {
  /** Soft-tissue mass. 1 is athletic, 0.72 gaunt, 1.4 heavily muscled. */
  mass?: number;
  skin: Mat;
  hands?: HandPose;
  handsL?: HandPose;
  /** Claw length for 'claw' hands. */
  nails?: number;
  nailMat?: Mat;
  /** Bare feet are for the unclothed. Everything else gets boots from gear.ts. */
  feet?: 'bare' | 'none';
  head?: boolean;
}

/** Ellipsoid aligned with the segment from `a` to `b`, centred `t` along it and pushed by `off`. */
export function muscleOn(a: V3, b: V3, t: number, off: V3, radii: V3): Shape {
  const c = add(mix(a, b, t), off);
  return at(frameY(c, sub(b, a)), ellipsoid([0, 0, 0], radii));
}

export const shoulderWidth = (sk: Sk) => sk.pos[B.upperArmL]![0] / 0.2;

export function torso(m: Model, sk: Sk, mat: Mat, q: number): void {
  const W = shoulderWidth(sk);
  const qd = 0.72 + 0.28 * q;
  m.add(ellipsoid([0, 0.975, -0.004], [0.158 * W, 0.118, 0.118 * qd]), mat, B.hips, { k: 0.05 });
  m.add(ellipsoid([0, 1.095, 0.006], [(0.112 + 0.026 * q) * W, 0.13, 0.098 * qd]), mat, B.spine, { k: 0.07 });
  m.add(ellipsoid([0, 1.325, 0], [0.165 * W, 0.215, 0.122 * qd]), mat, B.chest, { k: 0.08 });
  for (const s of [1, -1] as Side[]) {
    m.add(at(frameY([s * 0.086 * W, 1.385, 0.078 * qd], [s * 0.3, 1, 0.18]), ellipsoid([0, 0, 0], [0.092 * W, 0.074, 0.05 * q])), mat, B.chest, { k: 0.035 });
    m.add(ellipsoid([s * 0.145 * W, 1.3, -0.04], [0.05 * q, 0.135, 0.075]), mat, B.chest, { k: 0.05 });
    m.add(ellipsoid([s * 0.075 * W, 1.34, -0.09 * qd], [0.07 * W, 0.12, 0.05]), mat, B.chest, { k: 0.05 });
    m.add(cone([s * 0.03, 1.565, -0.03], [s * 0.165 * W, 1.49, -0.012], 0.044 * q, 0.04 * q), mat, B.chest, { k: 0.05 });
    m.add(ellipsoid([s * 0.088 * W, 0.915, -0.075], [0.09 * W, 0.098, 0.08 * qd]), mat, B.hips, { k: 0.04 });
  }
  m.add(cone([0, 1.5, 0], [0, 1.625, 0.018], 0.062 * (0.8 + 0.2 * q), 0.05), mat, B.neck, { k: 0.04 });
}

function arm(m: Model, sk: Sk, side: Side, mat: Mat, q: number): void {
  const { upper, fore, hand } = sk.armBones(side);
  const U = sk.pos[upper]!, F = sk.pos[fore]!, H = sk.pos[hand]!;
  const q1 = 0.7 + 0.3 * q;
  m.add(cone(U, F, 0.05 * q1, 0.037 * q1), mat, upper, { k: 0.03 });
  m.add(at(frameY(add(U, [side * 0.012, -0.012, 0]), sub(F, U)), ellipsoid([0, 0, 0], [0.064 * q, 0.086, 0.07 * q])), mat, upper, { k: 0.04 });
  m.add(muscleOn(U, F, 0.46, [0, 0, 0.022 * q], [0.042 * q, 0.092, 0.045 * q]), mat, upper, { k: 0.022 });
  m.add(muscleOn(U, F, 0.48, [side * 0.008, 0, -0.024 * q], [0.043 * q, 0.1, 0.044 * q]), mat, upper, { k: 0.022 });
  m.add(sphere(F, 0.04 * q1), mat, fore, { k: 0.025 });
  m.add(cone(F, H, 0.04 * q1, 0.026 * q1), mat, fore, { k: 0.02 });
  m.add(muscleOn(F, H, 0.26, [side * 0.006, 0, 0.008], [0.042 * q, 0.082, 0.04 * q]), mat, fore, { k: 0.02 });
}

function leg(m: Model, sk: Sk, side: Side, mat: Mat, q: number): void {
  const { thigh, shin, foot } = sk.legBones(side);
  const T = sk.pos[thigh]!, K = sk.pos[shin]!, A = sk.pos[foot]!;
  const q1 = 0.72 + 0.28 * q;
  const W = shoulderWidth(sk);
  m.add(cone(T, K, 0.09 * q1 * Math.sqrt(W), 0.056 * q1), mat, thigh, { k: 0.05 });
  const qt = Math.min(q, 1.18);
  m.add(muscleOn(T, K, 0.42, [side * 0.006, 0, 0.032 * qt], [0.066 * qt, 0.19, 0.064 * qt]), mat, thigh, { k: 0.03 });
  m.add(muscleOn(T, K, 0.46, [side * 0.008, 0, -0.036 * qt], [0.06 * qt, 0.19, 0.056 * qt]), mat, thigh, { k: 0.03 });
  m.add(muscleOn(T, K, 0.34, [-side * 0.04, 0, 0], [0.05 * qt, 0.15, 0.06 * qt]), mat, thigh, { k: 0.03 });
  m.add(sphere(sk.p(shin, 0, 0.004, 0.008), 0.056 * q1), mat, shin, { k: 0.025 });
  m.add(ellipsoid(sk.p(shin, 0, 0.004, 0.05 * q1), [0.03, 0.036, 0.018]), mat, shin, { k: 0.016 });
  m.add(cone(K, A, 0.052 * q1, 0.033 * q1), mat, shin, { k: 0.02 });
  m.add(muscleOn(K, A, 0.3, [side * 0.006, 0, -0.03 * q], [0.05 * q, 0.125, 0.05 * q]), mat, shin, { k: 0.025 });
  m.add(sphere(A, 0.036 * q1), mat, foot, { k: 0.016 });
}

/** Local frame of a hand: +y down the fingers, +x toward the palm, +z toward the thumb. */
export function handFrame(sk: Sk, side: Side): Frame {
  const { fore, hand } = sk.armBones(side);
  const o = sk.pos[hand]!;
  const y = norm(sub(o, sk.pos[fore]!));
  const fwd: V3 = [0, 0, 1];
  const z = norm(sub(fwd, scale(y, dot(fwd, y))));
  const c = cross(y, z);
  return { o, x: side > 0 ? c : scale(c, -1), y, z };
}

function fingerChain(fr: Frame, base: V3, lens: readonly number[], curl: readonly number[], r: number, splay: number): { pts: V3[]; dirs: V3[] } {
  const pts: V3[] = [base];
  const dirs: V3[] = [];
  let ang = 0;
  let cur = base;
  for (let i = 0; i < lens.length; i++) {
    ang += curl[i]!;
    const d: V3 = [Math.sin(ang), Math.cos(ang), splay];
    cur = add(cur, scale(norm(d), lens[i]!));
    pts.push(cur);
    dirs.push(d);
  }
  const toW = (p: V3): V3 => add(fr.o, add(add(scale(fr.x, p[0]), scale(fr.y, p[1])), scale(fr.z, p[2])));
  return { pts: pts.map(toW), dirs: dirs.map(d => norm(add(add(scale(fr.x, d[0]), scale(fr.y, d[1])), scale(fr.z, d[2])))) };
}

export function hand(m: Model, sk: Sk, side: Side, pose: HandPose, mat: Mat, nails = 0, nailMat?: Mat): void {
  const bone = sk.armBones(side).hand;
  const fr = handFrame(sk, side);
  const toW = (p: V3): V3 => add(fr.o, add(add(scale(fr.x, p[0]), scale(fr.y, p[1])), scale(fr.z, p[2])));
  // Palm: a soft slab with the thenar pad toward the thumb.
  m.add(at({ o: toW([0, 0.052, 0]), x: fr.x, y: fr.y, z: fr.z }, rbox([0, 0, 0], [0.017, 0.05, 0.043], 0.015)), mat, bone, { k: 0.016 });
  m.add(ellipsoid(toW([0.012, 0.04, 0.03]), [0.016, 0.022, 0.018]), mat, bone, { k: 0.01 });

  const curls: Record<HandPose, readonly number[]> = {
    fist: [1.45, 1.5, 1.2],
    grip: [1.1, 1.05, 0.95],
    claw: [0.5, 0.75, 0.75],
    open: [0.28, 0.32, 0.25],
  };
  const lensBase = pose === 'claw' ? 1.28 : 1;
  const zs = [0.031, 0.011, -0.01, -0.03];
  const scaleF = [0.98, 1.06, 1, 0.82];
  for (let f = 0; f < 4; f++) {
    const l = lensBase * scaleF[f]!;
    const { pts, dirs } = fingerChain(fr, [0.002, 0.098, zs[f]!], [0.04 * l, 0.028 * l, 0.022 * l], curls[pose], 0.01, (f - 1.5) * (pose === 'claw' ? 0.13 : 0.03));
    const r = 0.0098 * (f === 3 ? 0.88 : 1);
    for (let i = 0; i < 3; i++) m.add(cone(pts[i]!, pts[i + 1]!, r * (1 - i * 0.09), r * (0.9 - i * 0.09)), mat, bone, { k: 0.005 });
    if (nails > 0 && nailMat) {
      const tip = pts[3]!;
      const d = dirs[2]!;
      m.add(cone(tip, add(tip, scale(d, nails)), 0.0072, 0.0012), nailMat, bone, { k: 0.002 });
    }
  }
  const tc = pose === 'open' ? 0.2 : pose === 'claw' ? 0.35 : 0.8;
  const t0 = toW([0.01, 0.03, 0.04]);
  const t1 = add(t0, add(add(scale(fr.x, 0.012 * (1 + tc)), scale(fr.y, 0.03)), scale(fr.z, 0.026)));
  const t2 = add(t1, add(add(scale(fr.x, 0.016 * tc + 0.004), scale(fr.y, 0.028)), scale(fr.z, 0.008 - 0.012 * tc)));
  m.add(cone(t0, t1, 0.0145, 0.0115), mat, bone, { k: 0.008 });
  m.add(cone(t1, t2, 0.0112, 0.0095), mat, bone, { k: 0.004 });
  if (nails > 0 && nailMat) m.add(cone(t2, add(t2, scale(norm(sub(t2, t1)), nails)), 0.0066, 0.0012), nailMat, bone, { k: 0.002 });
}

export function bareFoot(m: Model, sk: Sk, side: Side, mat: Mat): void {
  const { foot } = sk.legBones(side);
  const x = sk.pos[foot]![0];
  const heel = ellipsoid([x, 0.036, -0.045], [0.036, 0.04, 0.05]);
  const ball = ellipsoid([x + side * 0.004, 0.03, 0.105], [0.046, 0.03, 0.06]);
  const arch = cone([x, 0.062, -0.01], [x + side * 0.002, 0.04, 0.1], 0.036, 0.03);
  const toes: Shape[] = [];
  for (let i = 0; i < 5; i++) {
    const tx = x + side * (0.03 - i * 0.017);
    toes.push(cone([tx, 0.024, 0.14], [tx + side * 0.002, 0.016, 0.178 - i * 0.008], 0.0118 - i * 0.0006, 0.0098 - i * 0.0005));
  }
  const body = blend(0.02, heel, arch, ball, blend(0.006, ...toes));
  const floor = rbox([x, 0.25, 0.05], [0.2, 0.25, 0.3], 0.001);
  m.add(inter(body, floor, 0.008), mat, foot, { k: 0.016 });
}

/** A bare human head. Masks and helmets replace or cover it. */
export function humanHead(m: Model, sk: Sk, mat: Mat, o: { gaunt?: number; eyeMat?: Mat } = {}): void {
  const g = o.gaunt ?? 0;
  const P = (x: number, y: number, z: number) => sk.p(B.head, x, y, z);
  const hb = B.head;
  m.add(ellipsoid(P(0, 0.106, -0.008), [0.082, 0.094, 0.098]), mat, hb, { k: 0.02 });
  m.add(ellipsoid(P(0, 0.058, 0.03), [0.066 - g * 0.008, 0.088, 0.07]), mat, hb, { k: 0.03 });
  for (const s of [1, -1]) {
    m.add(cone(P(s * 0.06, 0.05, 0.005), P(s * 0.03, -0.018, 0.068), 0.024, 0.017), mat, hb, { k: 0.018 });
    m.add(ellipsoid(P(s * 0.056, 0.078, 0.06), [0.022, 0.016, 0.022]), mat, hb, { k: 0.016 });
    m.add(ellipsoid(P(s * 0.084, 0.072, -0.004), [0.007, 0.03, 0.019]), mat, hb, { k: 0.008 });
  }
  m.add(ellipsoid(P(0, -0.016, 0.082), [0.028, 0.024, 0.022]), mat, hb, { k: 0.018 });
  m.add(capsule(P(-0.05, 0.116, 0.086), P(0.05, 0.116, 0.086), 0.0135), mat, hb, { k: 0.02 });
  m.add(cone(P(0, 0.108, 0.095), P(0, 0.062, 0.114), 0.0085, 0.0135), mat, hb, { k: 0.011 });
  if (g > 0) {
    for (const s of [1, -1]) m.cut(ellipsoid(P(s * 0.062, 0.03, 0.06), [0.017, 0.03, 0.03]), { k: 0.022 });
  }
  for (const s of [1, -1]) m.cut(ellipsoid(P(s * 0.036, 0.09, 0.101), [0.021, 0.015, 0.018]), { k: 0.012 });
  if (o.eyeMat) for (const s of [1, -1]) m.add(sphere(P(s * 0.035, 0.09, 0.08), 0.0145), o.eyeMat, hb);
}

/** Muscled figure from the neck down, plus the head unless disabled. */
export function buildBody(m: Model, sk: Sk, o: BodyOptions): void {
  const q = o.mass ?? 1;
  torso(m, sk, o.skin, q);
  for (const s of [1, -1] as Side[]) {
    arm(m, sk, s, o.skin, q);
    leg(m, sk, s, o.skin, q);
    const pose = (s > 0 ? o.handsL : undefined) ?? o.hands ?? 'open';
    hand(m, sk, s, pose, o.skin, o.nails, o.nailMat);
    if ((o.feet ?? 'bare') === 'bare') bareFoot(m, sk, s, o.skin);
  }
}

