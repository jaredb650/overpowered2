/** Armed humanoids. Each one starts from the same clothed body and gets its own outline and accent. */
import type { ArchetypeDef } from '../../../src/characters/archetypes';
import type { Socket } from '../../../src/characters/format';
import type { Mat, Model } from '../model';
import { blend, capsule, cone, cut, cyl, ellipsoid, frustum, rbox, sphere, spline, strap, torus, add, noise, type Shape, type V3 } from '../sdf';
import { buildBody, type HandPose } from '../parts/body';
import {
  antenna, belt, boot, bracer, cuirass, drape, elbowPad, feet, groove, handsAndHead, headP, helmet, hood, hosePath, kneePad, lineH, lineV, padOn,
  panelLine, pauldron, plate, pouch, respirator, rivets, shinGuard, stencil, suit, surfaceHit, thighPlate, visorSlit,
} from '../parts/gear';
import { cloth, darkSteel, glow, hazard, leather, paintedMetal, rubber, skin, steel } from '../parts/materials';
import { standardSockets } from '../parts/sockets';
import { B, type Side, type Sk } from '../parts/skeleton';

const accentOf = (def: ArchetypeDef, s = 1) => glow([def.accent[0], def.accent[1], def.accent[2]], s);
const BOTH: readonly Side[] = [1, -1];
const hazardInk: Mat = { albedo: [0.72, 0.56, 0.1], rough: 0.6, detail: 2, wear: 0.4 };

export interface Clothed {
  body: Shape;
  sockets: Record<string, Socket>;
}

interface BaseOptions {
  suit: Mat;
  glove?: Mat;
  bootMat?: Mat;
  mass?: number;
  hands?: HandPose;
  handsL?: HandPose;
  folds?: number;
}

/** Skin, suit, gloves and boots. */
export function clothedBody(m: Model, sk: Sk, o: BaseOptions): Clothed {
  buildBody(m, sk, { mass: o.mass ?? 1, skin: skin(), hands: o.hands ?? 'grip', handsL: o.handsL, feet: 'none' });
  const body = m.snapshot();
  suit(m, body, o.suit, { exclude: [...handsAndHead(sk), ...feet(sk)], folds: o.folds ?? 1 });
  const glove = o.glove ?? leather(0x1a1818);
  for (const s of BOTH) {
    const { hand } = sk.armBones(s);
    m.add(padOn(body, 0.003, sphere(sk.p(hand, s * 0.02, -0.0, 0), 0.17)), glove, -1);
    boot(m, sk, s, o.bootMat ?? leather(0x16161a));
  }
  return { body, sockets: standardSockets(sk) };
}

/** Webbing straps over the shoulders, conforming to whatever is underneath. */
function harness(m: Model, base: Shape, sk: Sk, mat: Mat): void {
  for (const s of BOTH) {
    const a = surfaceHit(base, [s * 0.1, 1.53, 0.3], [0, 0, -1]);
    const b = surfaceHit(base, [s * 0.13, 1.14, 0.3], [0, 0, -1]);
    const c = surfaceHit(base, [s * 0.1, 1.53, -0.3], [0, 0, 1]);
    const d = surfaceHit(base, [s * 0.13, 1.14, -0.3], [0, 0, 1]);
    const top: V3 = [s * 0.112, 1.575, -0.01];
    m.add(strap(spline([add(b, [0, 0, 0.012]), add(a, [0, 0, 0.012]), top, add(c, [0, 0, -0.012]), add(d, [0, 0, -0.012])], 22), 0.04, 0.008, [0, 0, 1]), mat, B.chest);
  }
}

function trooperHead(m: Model, sk: Sk, def: ArchetypeDef, shellMat: Mat): void {
  const P = headP(sk);
  hood(m, sk, rubber);
  helmet(m, sk, { mat: shellMat, ears: true, neckGuard: true });
  visorSlit(m, sk, accentOf(def));
  m.add(blend(0.016, ellipsoid(P(0, 0.028, 0.09), [0.066, 0.046, 0.044]), cone(P(0, 0.018, 0.1), P(0, 0.006, 0.136), 0.032, 0.024)), darkSteel, B.head, { rigid: true });
  for (const s of BOTH) m.add(cyl(P(s * 0.046, 0.012, 0.098), P(s * 0.074, 0.0, 0.112), 0.02, 0.004), rubber, B.head, { rigid: true });
  // Rear fin: the trooper's read at range.
  m.add(blend(0.01, rbox(P(0, 0.2, -0.04), [0.008, 0.024, 0.09], 0.006), rbox(P(0, 0.17, -0.1), [0.008, 0.05, 0.05], 0.006)), shellMat, B.head, { rigid: true, k: 0.01 });
  antenna(m, P(-0.11, 0.12, -0.03), P(-0.15, 0.42, -0.1), B.head, darkSteel, accentOf(def));
}

export function trooper(m: Model, sk: Sk, def: ArchetypeDef): Record<string, Socket> {
  const fatigue = cloth(0x2a3442, 0.6);
  const shell = paintedMetal(0x3c4a5c, 0.5, 1);
  const web = cloth(0x14171c, 0.2);
  const { body, sockets } = clothedBody(m, sk, { suit: fatigue, mass: 1 });
  const torsoLayer = m.snapshot();
  cuirass(m, body, sk, shell, { off: 0.024, top: 1.47, bottom: 1.17, width: 0.165 });
  stencil(m, [-0.075, 1.25, 0.2], 0.08, 0.026, 3);
  m.paint(rbox([0.085, 1.385, 0.2], [0.042, 0.0065, 0.08], 0.002), accentOf(def, 0.9), 0.001);
  harness(m, m.snapshot(), sk, web);
  belt(m, sk, torsoLayer, 1.03, web, steel);
  for (const s of BOTH) {
    pouch(m, surfaceHit(torsoLayer, [s * 0.1, 1.09, 0.3], [0, 0, -1]), web, { bone: B.spine, size: [0.042, 0.052, 0.026] });
    pouch(m, surfaceHit(torsoLayer, [s * 0.17, 0.96, 0.02], [-s, 0, 0]), web, { bone: B.hips, size: [0.03, 0.05, 0.036] });
    pauldron(m, sk, s, shell, { tiers: 1 });
    kneePad(m, body, sk, s, shell);
    elbowPad(m, body, sk, s, shell);
    shinGuard(m, body, sk, s, shell);
    bracer(m, body, sk, s, shell);
    // Unit stripe and number on the shoulder.
    const sh = sk.pos[sk.armBones(s).upper]!;
    m.paint(rbox(add(sh, [s * 0.09, 0.0, 0]), [0.1, 0.012, 0.2], 0.001), { albedo: [def.accent[0] * 0.62, def.accent[1] * 0.62, def.accent[2] * 0.62], rough: 0.5, metal: 0.1, detail: 2, wear: 0.9 }, 0.0012);
    stencil(m, add(sh, [s * 0.2, -0.05, 0]), 0.07, 0.026, 11 + s, undefined, 'x');
  }
  // Thigh holster on the right, drop pouch on the left.
  m.add(rbox(sk.on(B.thighR, B.shinR, 0.34, -0.086, 0, 0.012), [0.016, 0.075, 0.032], 0.012), web, B.thighR, { rigid: true });
  // Radio pack with antenna.
  m.add(rbox([0, 1.34, -0.17], [0.1, 0.13, 0.05], 0.018), paintedMetal(0x20262e, 0.5, 1), B.chest, { rigid: true });
  m.add(rbox([0, 1.34, -0.222], [0.066, 0.09, 0.004], 0.003), darkSteel, B.chest, { rigid: true, detail: true });
  m.add(rbox([-0.05, 1.42, -0.225], [0.01, 0.006, 0.002], 0.001), accentOf(def), B.chest, { rigid: true, detail: true });
  antenna(m, [0.08, 1.46, -0.18], [0.1, 1.98, -0.28], B.chest, darkSteel);
  hosePath(m, [[-0.07, 1.46, -0.17], [-0.1, 1.56, -0.1], [-0.08, 1.63, -0.02], [-0.06, 1.625, 0.06]], B.chest, { r: 0.008 });
  trooperHead(m, sk, def, shell);
  return sockets;
}

export function gunner(m: Model, sk: Sk, def: ArchetypeDef): Record<string, Socket> {
  const coat = cloth(0x3a3026, 0.8);
  const iron = paintedMetal(0x2e2a26, 0.55, 1);
  const P = headP(sk);
  const { body, sockets } = clothedBody(m, sk, { suit: cloth(0x24211e), mass: 1.12 });
  // Long stiff coat in panels: bulk at the shoulders, skirts to the knee.
  suit(m, m.snapshot(), coat, { off: 0.016, folds: 1.5, seed: 3, exclude: [...handsAndHead(sk), sphere(sk.on(B.thighL, B.shinL, 1.1), 0.34), sphere(sk.on(B.thighR, B.shinR, 1.1), 0.34)] });
  for (const [x, z, w] of [[0.1, 0.13, 0.095], [-0.1, 0.13, 0.095], [0.1, -0.15, 0.1], [-0.1, -0.15, 0.1], [0.19, -0.01, 0.07], [-0.19, -0.01, 0.07]] as const) {
    drape(m, [x, 1.02, z * 0.86], [x * 1.4, 0.5, z * 1.3], w, 0.009, coat, B.hips, x * 9 + z);
  }
  belt(m, sk, m.snapshot(), 1.05, leather(0x1a1410), steel, { width: 0.03, off: 0.02 });
  const coatLayer = m.snapshot();
  // Shell bandolier across the chest.
  const a = surfaceHit(coatLayer, [0.13, 1.5, 0.3], [0, 0, -1]);
  const b = surfaceHit(coatLayer, [-0.1, 1.12, 0.3], [0, 0, -1]);
  m.add(strap(spline([add(a, [0, 0, 0.006]), add(surfaceHit(coatLayer, [0.015, 1.32, 0.3], [0, 0, -1]), [0, 0, 0.008]), add(b, [0, 0, 0.006])], 16), 0.05, 0.008, [0, 0, 1]), leather(0x2a2018), B.chest);
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const p: V3 = [0.115 - t * 0.2, 1.47 - t * 0.31, 0];
    const h = surfaceHit(coatLayer, [p[0], p[1], 0.3], [0, 0, -1]);
    m.add(capsule(add(h, [0.016, 0.012, 0.016]), add(h, [-0.016, -0.012, 0.016]), 0.0085), hazard(0xb03010, 0xb03010), B.chest, { rigid: true });
  }
  for (const s of BOTH) {
    pauldron(m, sk, s, iron, { size: 1.12, tiers: 2 });
    kneePad(m, body, sk, s, iron);
    pouch(m, surfaceHit(coatLayer, [s * 0.15, 1.0, 0.3], [0, 0, -1]), leather(0x2a2018), { bone: B.hips, size: [0.05, 0.05, 0.03] });
  }
  // High collar rising to the ears, then the bucket helm: a flat-topped wide block at range.
  m.add(cut(frustum(sk.p(B.neck, 0, -0.05, -0.005), sk.p(B.neck, 0, 0.1, -0.015), 0.13, 0.15, 0.008), cyl(sk.p(B.neck, 0, -0.1, -0.005), sk.p(B.neck, 0, 0.2, -0.015), 0.105, 0.003)), iron, B.chest, { rigid: true });
  m.cut(rbox(sk.p(B.neck, 0, 0.09, 0.14), [0.07, 0.08, 0.05], 0.02), { k: 0.012 });
  hood(m, sk, rubber);
  const bucket = cut(rbox(P(0, 0.1, 0.008), [0.102, 0.112, 0.116], 0.03), rbox(P(0, 0.09, 0.14), [0.07, 0.0115, 0.04], 0.003));
  m.add(bucket, iron, B.head, { rigid: true });
  m.add(rbox(P(0, 0.09, 0.104), [0.066, 0.0085, 0.012], 0.003), accentOf(def), B.head, { rigid: true });
  rivets(m, bucket, [[-0.085, 0.17, 0], [-0.03, 0.17, 0], [0.03, 0.17, 0], [0.085, 0.17, 0], [-0.085, 0.03, 0], [0.085, 0.03, 0]].map(([x, y, z]) => P(x!, y!, z!)), [0, 0, -1], steel, B.head);
  m.add(rbox(P(0, 0.222, 0), [0.04, 0.012, 0.09], 0.01), darkSteel, B.head, { rigid: true });
  for (let i = -2; i <= 2; i++) panelLine(m, P(i * 0.026, 0.005, 0.13), P(i * 0.026, 0.06, 0.13), 0.0035);
  return sockets;
}

export function brute(m: Model, sk: Sk, def: ArchetypeDef): Record<string, Socket> {
  const plateMat = paintedMetal(0x4a2420, 0.5, 1);
  const iron = paintedMetal(0x24262a, 0.55, 1);
  const P = headP(sk);
  const { body, sockets } = clothedBody(m, sk, { suit: cloth(0x262a30), mass: 1.45, folds: 0.7, bootMat: iron });
  const front = cuirass(m, body, sk, plateMat, { off: 0.03, top: 1.52, bottom: 1.12, width: 0.27 });
  rivets(m, front, [-0.2, -0.1, 0, 0.1, 0.2].flatMap(x => [[x, 1.48, 0], [x, 1.16, 0]] as V3[]), [0, 0, -1], steel, B.chest, 0.0075);
  stencil(m, [0.12, 1.4, 0.24], 0.1, 0.03, 5, hazardInk);
  for (let i = -3; i <= 3; i++) groove(m, front, lineV(i * 0.05, 1.2, 1.3, 0.1, 0.002));
  // Stacked abdomen lames: these are the plates the gunfire strips.
  for (let i = 0; i < 3; i++) {
    plate(m, body, 0.026, 0.014, rbox([0, 1.1 - i * 0.052, 0.1], [0.16 - i * 0.014, 0.03, 0.14], 0.012), iron, i < 1 ? B.spine : B.hips);
  }
  belt(m, sk, m.snapshot(), 0.96, leather(0x141210), steel, { width: 0.032, off: 0.03 });
  for (const s of BOTH) {
    pauldron(m, sk, s, plateMat, { size: 1.5, tiers: 2, spike: darkSteel, flare: 0.2 });
    kneePad(m, body, sk, s, plateMat, 1.2);
    shinGuard(m, body, sk, s, plateMat);
    thighPlate(m, body, sk, s, iron);
    bracer(m, body, sk, s, iron);
    boot(m, sk, s, iron, { plated: plateMat, height: 0.3 });
  }
  // Gorget swallows the neck, so the head reads tiny between the shoulders.
  m.add(cut(frustum(sk.p(B.neck, 0, -0.07, -0.01), sk.p(B.neck, 0, 0.1, 0.0), 0.2, 0.125, 0.012), cyl(sk.p(B.neck, 0, -0.2, 0), sk.p(B.neck, 0, 0.2, 0), 0.09, 0.003)), iron, B.chest, { rigid: true });
  hood(m, sk, rubber, { size: 0.92 });
  m.add(cut(ellipsoid(P(0, 0.1, 0.02), [0.098, 0.1, 0.11]), rbox(P(0, 0.082, 0.12), [0.06, 0.009, 0.05], 0.002)), iron, B.head, { rigid: true });
  m.add(ellipsoid(P(0, 0.082, 0.056), [0.056, 0.0085, 0.062]), accentOf(def), B.head, { rigid: true });
  // Ammo drum pack on the back.
  m.add(rbox([0, 1.34, -0.24], [0.17, 0.2, 0.08], 0.03), iron, B.chest, { rigid: true });
  m.add(cyl([0, 1.34, -0.32], [0, 1.34, -0.335], 0.09), accentOf(def, 0.6), B.chest, { rigid: true, detail: true });
  hosePath(m, [[0.12, 1.45, -0.2], [0.26, 1.58, -0.14], [0.36, 1.46, 0.02], [0.4, 1.28, 0.06]], B.chest, { r: 0.02, mat: steel });
  return sockets;
}

export function rocketeer(m: Model, sk: Sk, def: ArchetypeDef): Record<string, Socket> {
  const fatigue = cloth(0x2c3430, 0.7);
  const shell = paintedMetal(0x394a42, 0.5, 1);
  const web = cloth(0x141814, 0.2);
  const P = headP(sk);
  const { body, sockets } = clothedBody(m, sk, { suit: fatigue, mass: 1.04 });
  const layer = m.snapshot();
  cuirass(m, body, sk, shell, { off: 0.022, top: 1.46, bottom: 1.2, width: 0.17 });
  harness(m, m.snapshot(), sk, web);
  belt(m, sk, layer, 1.03, web, steel);
  for (const s of BOTH) {
    pauldron(m, sk, s, shell, { size: 1.1 });
    kneePad(m, body, sk, s, shell);
    pouch(m, surfaceHit(layer, [s * 0.11, 1.08, 0.3], [0, 0, -1]), web, { bone: B.spine, size: [0.05, 0.06, 0.034] });
  }
  hood(m, sk, rubber);
  helmet(m, sk, { mat: shell, ears: true });
  respirator(m, sk, darkSteel, { filter: shell });
  // Targeting monocle swung over the right eye.
  m.add(cyl(P(-0.12, 0.13, 0), P(-0.12, 0.098, 0.03), 0.012), darkSteel, B.head, { rigid: true });
  m.add(capsule(P(-0.12, 0.098, 0.03), P(-0.05, 0.094, 0.13), 0.009), darkSteel, B.head, { rigid: true });
  m.add(torus(P(-0.042, 0.092, 0.132), [0, 0, 1], 0.03, 0.007), darkSteel, B.head, { rigid: true });
  m.add(ellipsoid(P(-0.042, 0.092, 0.13), [0.028, 0.028, 0.012]), accentOf(def), B.head, { rigid: true });
  m.add(ellipsoid(P(0.04, 0.09, 0.108), [0.02, 0.016, 0.008]), accentOf(def, 0.4), B.head, { rigid: true });
  sockets.back = { bone: B.chest, pos: [0, 0.1, -0.2], rot: [0, 0, 0, 1] };
  return sockets;
}

export function sniper(m: Model, sk: Sk, def: ArchetypeDef): Record<string, Socket> {
  const P = headP(sk);
  const drab = cloth(0x2b3028, 0.8);
  const strip = cloth(0x3a3e30, 0.9);
  const { body, sockets } = clothedBody(m, sk, { suit: drab, mass: 0.84, folds: 1.3 });
  for (const s of BOTH) {
    kneePad(m, body, sk, s, leather(0x1e2018));
    bracer(m, body, sk, s, leather(0x1e2018));
  }
  // Tattered ghillie: strips hang from shoulders and back, breaking up the body line at range.
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const layer = m.snapshot();
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const x = Math.cos(a) * 0.17, z = Math.sin(a) * 0.13;
    const top = surfaceHit(layer, [x * 3, 1.46 - rnd() * 0.05, z * 3], [-x, 0, -z]);
    const L = 0.28 + rnd() * 0.42;
    const bone = z > 0.06 || Math.abs(x) < 0.08 ? B.chest : B.chest;
    drape(m, add(top, [0, 0.02, 0]), add(top, [x * 0.35, -L, z * 0.45]), 0.012 + rnd() * 0.02, 0.004, strip, bone, i);
  }
  belt(m, sk, layer, 1.02, cloth(0x14160f), steel);
  // Single huge lens on a smooth hood. Reads as one bright point on a tall thin body.
  hood(m, sk, cloth(0x1c1e18), { folds: 2, size: 1.06 });
  m.add(cone(P(0, 0.09, 0.09), P(0, 0.09, 0.17), 0.05, 0.042), darkSteel, B.head, { rigid: true });
  m.add(torus(P(0, 0.09, 0.172), [0, 0, 1], 0.04, 0.007), steel, B.head, { rigid: true });
  m.add(ellipsoid(P(0, 0.09, 0.165), [0.037, 0.037, 0.014]), accentOf(def), B.head, { rigid: true });
  m.add(cyl(P(0.092, 0.11, 0.0), P(0.106, 0.11, 0.0), 0.03), darkSteel, B.head, { rigid: true });
  m.add(capsule(P(0.1, 0.11, 0.01), P(0.05, 0.13, 0.11), 0.007), darkSteel, B.head, { rigid: true });
  return sockets;
}

export function riot(m: Model, sk: Sk, def: ArchetypeDef): Record<string, Socket> {
  const P = headP(sk);
  const navy = paintedMetal(0x1e2a44, 0.45, 1);
  const pad = rubber;
  const { body, sockets } = clothedBody(m, sk, { suit: cloth(0x171d2a), mass: 1.2, folds: 0.8, handsL: 'grip' });
  const front = cuirass(m, body, sk, navy, { off: 0.03, top: 1.5, bottom: 1.1, width: 0.21 });
  for (let i = 0; i < 3; i++) groove(m, front, lineH(1.17 + i * 0.05, -0.17, 0.17, 0.1));
  m.paint(rbox([0, 1.415, 0.2], [0.075, 0.007, 0.08], 0.002), accentOf(def, 0.8), 0.001);
  stencil(m, [0, 1.36, 0.24], 0.14, 0.03, 9);
  belt(m, sk, m.snapshot(), 1.02, rubber, steel, { width: 0.03, off: 0.024 });
  for (const s of BOTH) {
    pauldron(m, sk, s, navy, { size: 1.26, tiers: 1 });
    kneePad(m, body, sk, s, navy, 1.2);
    shinGuard(m, body, sk, s, navy);
    thighPlate(m, body, sk, s, pad);
    elbowPad(m, body, sk, s, navy);
    bracer(m, body, sk, s, navy);
  }
  hood(m, sk, rubber);
  helmet(m, sk, { mat: navy, size: 1.12, neckGuard: true, ears: false });
  // Full dome visor with a blue reflection: the head reads as a big round bubble.
  m.add(cut(ellipsoid(P(0, 0.078, 0.042), [0.102, 0.104, 0.1]), rbox(P(0, 0.082, -0.1), [0.2, 0.2, 0.14], 0.002)), {
    albedo: [0.02, 0.05, 0.11], rough: 0.08, metal: 0.8, detail: 2,
  }, B.head, { rigid: true });
  m.add(rbox(P(0, 0.14, 0.135), [0.05, 0.003, 0.002], 0.001), accentOf(def), B.head, { rigid: true, detail: true });
  m.add(capsule(P(-0.1, 0.13, 0.03), P(0.1, 0.13, 0.03), 0.012), navy, B.head, { rigid: true });
  return sockets;
}

export function burner(m: Model, sk: Sk, def: ArchetypeDef): Record<string, Socket> {
  const P = headP(sk);
  const quilt: Mat = {
    albedo: [0.33, 0.3, 0.24], rough: 0.8, detail: 1,
    paint: (x, y, z, o) => {
      const n = noise(x * 6, y * 6, z * 6);
      const f = 0.82 + n * 0.32;
      o.r *= f; o.g *= f; o.b *= f;
      const scorch = Math.max(0, noise(x * 3 + 3, y * 2, z * 3) * 2 - 0.1);
      const k = 1 - Math.min(0.8, scorch);
      o.r *= k; o.g *= k; o.b *= k;
    },
  };
  const { body, sockets } = clothedBody(m, sk, { suit: quilt, mass: 1.2, folds: 2, glove: leather(0x302418) });
  // Quilted firesuit swells over the body in horizontal ribs.
  m.add({
    f: (x, y, z) => {
      const d = body.f(x, y, z) - 0.024 - Math.abs(Math.sin(y * 44)) * 0.012;
      const exclude = Math.min(sk_h(sk, x, y, z), sk_f(sk, x, y, z));
      return Math.max(d, -exclude);
    },
    lo: body.lo,
    hi: body.hi,
  }, quilt, -1);
  const iron = paintedMetal(0x38302a, 0.55, 1);
  belt(m, sk, m.snapshot(), 1.03, leather(0x1c1610), steel, { width: 0.03, off: 0.012 });
  for (const s of BOTH) {
    pauldron(m, sk, s, iron, { size: 1.2 });
    kneePad(m, body, sk, s, iron, 1.15);
  }
  // Bulbous helmet with a round faceplate: a diver in a furnace.
  m.add(ellipsoid(P(0, 0.09, 0.0), [0.135, 0.145, 0.14]), iron, B.head, { rigid: true });
  m.add(torus(P(0, 0.09, 0.128), [0, 0, 1], 0.082, 0.014), steel, B.head, { rigid: true });
  m.add(ellipsoid(P(0, 0.09, 0.118), [0.075, 0.075, 0.026]), accentOf(def, 0.75), B.head, { rigid: true });
  for (let i = -1; i <= 1; i++) m.add(rbox(P(i * 0.03, 0.09, 0.145), [0.003, 0.074, 0.003], 0.002), darkSteel, B.head, { rigid: true });
  m.add(torus(P(0, -0.04, 0), [0, 1, 0], 0.13, 0.024), steel, B.chest, { rigid: true });
  hosePath(m, [[0.1, 1.5, -0.17], [0.2, 1.58, -0.06], [0.14, 1.66, 0.0], [0.13, 1.7, 0.04]], B.chest, { r: 0.014 });
  hosePath(m, [[-0.1, 1.2, -0.2], [-0.26, 1.1, -0.14], [-0.34, 1.02, 0.02], [-0.36, 0.98, 0.06]], B.chest, { r: 0.015 });
  sockets.back = { bone: B.chest, pos: [0, 0.1, -0.21], rot: [0, 0, 0, 1] };
  return sockets;
}

const sk_h = (sk: Sk, x: number, y: number, z: number) => {
  let d = 1e3;
  for (const b of [B.handL, B.handR]) {
    const p = sk.pos[b]!;
    d = Math.min(d, Math.hypot(x - p[0], y - p[1] + 0.03, z - p[2]) - 0.14);
  }
  const h = sk.pos[B.head]!;
  return Math.min(d, Math.hypot(x - h[0], y - h[1] - 0.09, z - h[2]) - 0.16);
};
const sk_f = (sk: Sk, x: number, y: number, z: number) => {
  let d = 1e3;
  for (const b of [B.footL, B.footR]) {
    const p = sk.pos[b]!;
    d = Math.min(d, Math.hypot(x - p[0], y - p[1] + 0.03, z - p[2] - 0.03) - 0.14);
  }
  return d;
};

