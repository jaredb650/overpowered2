/** The unarmoured, the altered and the machines. */
import type { ArchetypeDef } from '../../../src/characters/archetypes';
import { DroneBone, SkitterBone } from '../../../src/characters/rig';
import type { Socket } from '../../../src/characters/format';
import { DETAIL_SKIN, type Mat, type Model } from '../model';
import {
  add, at, blend, capsule, cone, cut, cyl, ellipsoid, fbm, frameE, frameY, frustum, hexBolt, mix, noise, norm, radial, rbox, ridged, scale, smax, sphere,
  spline, sstep, sub, torus, tube, type Fn, type Shape, type V3,
} from '../sdf';
import { buildBody, humanHead } from '../parts/body';
import {
  antenna, belt, boot, bracer, cuirass, drape, feet, handsAndHead, headP, hood, hosePath, kneePad, padOn, panelLine, pauldron, plate, rivets,
  shinGuard, suit, surfaceHit, torsoBand,
} from '../parts/gear';
import { bone, cloth, darkSteel, glow, hazard, leather, muscle, paintedMetal, rubber, rust, skin, steel } from '../parts/materials';
import { standardSockets } from '../parts/sockets';
import { B, type Side, type Sk } from '../parts/skeleton';
import { clothedBody } from './soldiers';

const accentOf = (def: ArchetypeDef, s = 1) => glow([def.accent[0], def.accent[1], def.accent[2]], s);
const BOTH: readonly Side[] = [1, -1];

/** Flayed tissue: fibres follow the limbs, and run across the torso the way pectorals and obliques do. */
const fibres: Fn = (x, y, z) => {
  const torsoish = sstep(0.28, 0.22, Math.abs(x)) * sstep(1.02, 1.1, y) * sstep(1.62, 1.54, y);
  const a = noise(x * 150, y * 15, z * 150);
  const b = noise(x * 16 + y * 22, y * 110, z * 110);
  return (a * (1 - torsoish) + b * torsoish) * 0.0016;
};

/** Grey skin stretched over raw muscle, torn open wherever `tear` is positive. */
function flayed(m: Model, body: Shape, skinMat: Mat, tear: Fn, thick = 0.0035): void {
  const f = body.f;
  m.add({
    f: (x, y, z) => {
      const d = f(x, y, z) - thick;
      if (d > 0.03 || d < -0.03) return d;
      const t = tear(x, y, z);
      // The skin ends in a curled lip where the tear starts.
      return smax(d - Math.max(0, 0.012 - Math.abs(t) * 0.1) * 0.12, t * 0.05, 0.003);
    },
    lo: body.lo,
    hi: body.hi,
  }, skinMat, -1);
}

function ribs(m: Model, side: Side, mat: Mat, o: { count: number; top: number; spread: number; r?: number; bone: number }): void {
  for (let i = 0; i < o.count; i++) {
    const y = o.top - i * 0.042;
    const w = o.spread * (1 - Math.abs(i - o.count * 0.4) * 0.06);
    const pts = spline([
      [side * 0.022, y - 0.03, 0.118],
      [side * w * 0.55, y + 0.004, 0.112],
      [side * w, y + 0.012, 0.05],
      [side * w * 1.04, y + 0.02, -0.03],
    ], 12);
    m.add(tube(pts, t => (o.r ?? 0.0085) * (1 - t * 0.3)), mat, o.bone, { k: 0.004 });
  }
}

export function husk(m: Model, sk: Sk, def: ArchetypeDef): Record<string, Socket> {
  const accent = accentOf(def);
  const raw = muscle([0, 1, 0]);
  const pale = skin([0.56, 0.54, 0.5]);
  const nail: Mat = { ...bone, albedo: [0.3, 0.26, 0.2], rough: 0.4 };
  buildBody(m, sk, { mass: 0.72, skin: raw, hands: 'claw', nails: 0.032, nailMat: nail });
  humanHead(m, sk, raw, { gaunt: 1 });
  const body = m.snapshot();
  const P = headP(sk);

  // Fibre detail on all exposed tissue, then the skin over it.
  m.add({ f: (x, y, z) => { const d = body.f(x, y, z); return d > 0.02 || d < -0.02 ? d : d - fibres(x, y, z); }, lo: body.lo, hi: body.hi }, raw, -1);
  const tears: Fn = (x, y, z) => {
    const big = fbm(x * 4.4 + 2, y * 3.1, z * 4.4, 3);
    const rip = ridged(x * 9, y * 4, z * 9, 2) - 0.52;
    // The chest is always open, and the skin holds together around the skull and hands.
    const chest = 0.34 - Math.hypot((x - 0.04) * 1.5, (y - 1.32) * 1.05, Math.min(0, z) * 3);
    const skull = Math.hypot(x, (y - 1.72) * 0.9, z) < 0.13 ? -0.1 : 0;
    return Math.max(big * 1.1 + rip * 0.24 - 0.05, chest * 0.9) + skull;
  };
  flayed(m, body, pale, tears);

  // Open ribcage on the left, with the glowing feed vial behind it: the husk's read at range.
  ribs(m, 1, bone, { count: 6, top: 1.47, spread: 0.13, bone: B.chest });
  ribs(m, -1, bone, { count: 4, top: 1.47, spread: 0.13, bone: B.chest });
  m.add(cone([0, 1.5, 0.116], [0, 1.2, 0.106], 0.011, 0.009), bone, B.chest, { k: 0.004 });
  m.add(capsule([0.035, 1.27, 0.055], [0.035, 1.39, 0.055], 0.024), accent, B.chest, { rigid: true });
  for (const y of [1.26, 1.4]) m.add(torus([0.035, y, 0.055], [0, 1, 0], 0.026, 0.006), rust, B.chest, { rigid: true });
  hosePath(m, [[0.035, 1.415, 0.055], [0.05, 1.53, 0.07], [0.04, 1.6, 0.095], [0.02, 1.625, 0.112]], B.chest, { r: 0.006, mat: rubber });

  // Spinal ridge and the feed lines bolted into it.
  for (let i = 0; i < 12; i++) {
    const y = 1.56 - i * 0.05;
    m.add(ellipsoid([0, y, -0.118 + Math.abs(i - 5) * 0.004], [0.015, 0.019, 0.016]), bone, i < 6 ? B.chest : B.spine, { k: 0.006 });
  }
  hosePath(m, [[0.02, 1.34, -0.118], [0.09, 1.46, -0.16], [0.075, 1.62, -0.1], [0.04, 1.7, -0.098]], B.chest, { r: 0.0095 });
  hosePath(m, [[-0.02, 1.22, -0.118], [-0.1, 1.38, -0.16], [-0.09, 1.6, -0.11], [-0.05, 1.68, -0.1]], B.chest, { r: 0.0095 });
  m.add(rbox([0, 1.34, -0.125], [0.05, 0.022, 0.014], 0.006), rust, B.chest, { rigid: true });
  m.add(rbox([0, 1.22, -0.125], [0.05, 0.022, 0.014], 0.006), rust, B.chest, { rigid: true });

  // Iron jaw: a hinged cage bolted through the cheeks. The mouth behind it never closes.
  m.cut(ellipsoid(P(0, 0.018, 0.1), [0.04, 0.024, 0.04]), { k: 0.008, mat: { albedo: [0.1, 0.012, 0.012], rough: 0.3, detail: DETAIL_SKIN } });
  m.add(tube(spline([P(-0.075, 0.056, 0.012), P(-0.066, -0.02, 0.07), P(0, -0.044, 0.108), P(0.066, -0.02, 0.07), P(0.075, 0.056, 0.012)], 26), 0.0068), rust, B.head, { rigid: true });
  for (let i = -2; i <= 2; i++) {
    m.add(cyl(P(i * 0.017, 0.042, 0.112 - Math.abs(i) * 0.008), P(i * 0.02, -0.04, 0.108 - Math.abs(i) * 0.012), 0.0034, 0.001), rust, B.head, { rigid: true });
  }
  m.add(tube(spline([P(-0.07, 0.046, 0.066), P(0, 0.05, 0.116), P(0.07, 0.046, 0.066)], 14), 0.0052), rust, B.head, { rigid: true });
  for (const s of BOTH) {
    m.add(hexBolt(P(s * 0.078, 0.056, 0.012), [s, 0, 0.1], 0.011, 0.008), steel, B.head, { rigid: true });
    m.add(sphere(P(s * 0.035, 0.09, 0.083), 0.0115), accent, B.head, { rigid: true });
  }
  // Surgical staples across a skull seam.
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const a = 0.6 + t * 1.5;
    const c = P(Math.cos(a) * 0.085, 0.112 + Math.sin(a) * 0.094, -0.02 + Math.sin(a * 1.3) * 0.02);
    m.add(rbox(c, [0.0024, 0.0024, 0.012], 0.001), steel, B.head, { detail: true, rigid: true });
  }

  // Iron collar and a snapped chain.
  m.add(torus(sk.p(B.neck, 0, 0.03, 0), [0, 1, 0.04], 0.067, 0.012), rust, B.neck, { rigid: true });
  for (let i = 0; i < 3; i++) {
    m.add(torus(sk.p(B.chest, 0.02 - i * 0.004, 0.245 - i * 0.046, 0.12), i % 2 ? [1, 0, 0] : [0, 0, 1], 0.016, 0.0048), rust, B.chest, { rigid: true });
  }

  // Bands biting into the limbs, and rags that used to be clothes.
  for (const s of BOTH) {
    const { fore, hand } = sk.armBones(s);
    m.add(at(frameY(sk.on(fore, hand, 0.72), sub(sk.pos[hand]!, sk.pos[fore]!)), rbox([0, 0, 0], [0.04, 0.012, 0.042], 0.005)), rust, fore, { rigid: true });
    const { thigh, shin } = sk.legBones(s);
    m.add(padOn(body, 0.006, ellipsoid(sk.on(thigh, shin, 0.62), [0.12, 0.05, 0.12])), cloth(0x3a3026, 1), thigh);
  }
  const rag = cloth(0x4a3e32, 1);
  m.add(padOn(body, 0.009, ellipsoid([0, 0.93, 0], [0.24, 0.1, 0.2])), rag, B.hips);
  for (const [x, z, L] of [[0.05, 0.13, 0.26], [-0.07, 0.12, 0.34], [0.12, -0.1, 0.22], [-0.1, -0.11, 0.3], [0.16, 0.03, 0.2]] as const) {
    drape(m, [x, 0.98, z], [x * 1.1, 0.98 - L, z * 1.15], 0.035, 0.0045, rag, B.hips, x * 13);
  }
  return standardSockets(sk);
}

export function leaper(m: Model, sk: Sk, def: ArchetypeDef): Record<string, Socket> {
  const accent = accentOf(def);
  const raw = muscle([0, 1, 0]);
  const hide = skin([0.4, 0.34, 0.38]);
  const claw: Mat = { ...bone, albedo: [0.2, 0.15, 0.16], rough: 0.32 };
  buildBody(m, sk, { mass: 0.8, skin: raw, hands: 'claw', nails: 0.11, nailMat: claw });
  const body = m.snapshot();
  m.add({ f: (x, y, z) => { const d = body.f(x, y, z); return d > 0.02 || d < -0.02 ? d : d - fibres(x, y, z); }, lo: body.lo, hi: body.hi }, raw, -1);
  // Hide survives in plates over the back and shoulders. The front is open sinew.
  flayed(m, body, hide, (x, y, z) => ridged(x * 8, y * 3.4, z * 8, 2) - 0.56 + z * 1.6 + fbm(x * 3, y * 3, z * 3, 2) * 0.5);

  // Long narrow skull with no eyes, split by a slit of light. Reads as a wedge from the front.
  const P = headP(sk);
  m.add(cone(P(0, 0.09, -0.08), P(0, 0.075, 0.16), 0.078, 0.035), hide, B.head, { k: 0.03 });
  m.add(ellipsoid(P(0, 0.09, -0.02), [0.08, 0.085, 0.11]), hide, B.head, { k: 0.03 });
  m.add(cone(P(0, 0.02, -0.02), P(0, -0.012, 0.15), 0.04, 0.022), hide, B.head, { k: 0.016 });
  m.cut(rbox(P(0, 0.048, 0.1), [0.05, 0.006, 0.09], 0.002), { k: 0.008, mat: { albedo: [0.1, 0.01, 0.02], rough: 0.3, detail: DETAIL_SKIN } });
  for (let i = 0; i < 7; i++) {
    const z = 0.05 + i * 0.018;
    for (const s of BOTH) {
      m.add(cone(P(s * (0.033 - i * 0.002), 0.056, z), P(s * (0.031 - i * 0.002), 0.03, z + 0.004), 0.0048, 0.0008), bone, B.head, { rigid: true });
      m.add(cone(P(s * (0.03 - i * 0.002), 0.03, z), P(s * (0.029 - i * 0.002), 0.056, z + 0.004), 0.0042, 0.0008), bone, B.head, { rigid: true });
    }
  }
  m.add(rbox(P(0, 0.112, 0.082), [0.046, 0.0032, 0.03], 0.002), accent, B.head, { rigid: true });

  // Dorsal spines: the arched back breaks into a saw edge at range.
  for (let i = 0; i < 11; i++) {
    const y = 1.56 - i * 0.056;
    const L = 0.06 + Math.sin((i / 10) * Math.PI) * 0.19;
    const a: V3 = [0, y, -0.1];
    const bone0 = i < 5 ? B.chest : i < 8 ? B.spine : B.hips;
    m.add(cone(a, add(a, [0, L * 0.5, -L * 1.25]), 0.028, 0.0035), claw, bone0, { k: 0.008 });
    if (i % 3 === 1) {
      for (const s of BOTH) {
        const g = add(a, [s * 0.06, 0.01, 0.006]);
        m.add(ellipsoid(g, [0.04, 0.032, 0.02]), accent, bone0, { rigid: true });
      }
    }
  }
  // Heel spurs and elbow hooks lengthen the limbs at both ends.
  for (const s of BOTH) {
    const { fore } = sk.armBones(s);
    const e = sk.pos[fore]!;
    m.add(cone(add(e, [s * 0.012, 0, -0.03]), add(e, [s * 0.05, 0.12, -0.11]), 0.016, 0.003), claw, fore, { k: 0.006 });
    const { foot } = sk.legBones(s);
    m.add(cone(sk.p(foot, 0, 0.02, -0.05), sk.p(foot, 0, 0.1, -0.14), 0.014, 0.003), claw, foot, { k: 0.006 });
  }
  return standardSockets(sk);
}

export function stalker(m: Model, sk: Sk, def: ArchetypeDef): Record<string, Socket> {
  const accent = accentOf(def);
  const P = headP(sk);
  const weave = cloth(0x201c2a, 0.3);
  const lacquer = paintedMetal(0x2a2436, 0.3, 0.9);
  const { body, sockets } = clothedBody(m, sk, { suit: weave, mass: 0.86, folds: 0.6, glove: rubber, handsL: 'grip' });
  // Angular chest plate: two blades of armour meeting at the sternum.
  for (const s of BOTH) {
    plate(m, body, 0.016, 0.01, at(frameE([s * 0.085, 1.36, 0.1], 0, 0, s * 0.4), rbox([0, 0, 0], [0.058, 0.17, 0.13], 0.01)), lacquer, B.chest);
    bracer(m, body, sk, s, lacquer);
    shinGuard(m, body, sk, s, lacquer);
    const { fore, hand } = sk.armBones(s);
    const e = sk.on(fore, hand, 0.5, s * 0.03, 0, 0);
    m.add(cone(add(e, [0, -0.06, -0.02]), add(e, [s * 0.05, 0.2, -0.1]), 0.012, 0.002), steel, fore, { rigid: true });
  }
  m.add(rbox([0, 1.33, 0.13], [0.003, 0.11, 0.002], 0.001), accent, B.chest, { rigid: true, detail: true });
  belt(m, sk, m.snapshot(), 1.05, cloth(0x121018), steel, { width: 0.02 });
  // Waist tails and a long scarf: the movement line behind a fast body.
  for (const [x, z, L] of [[0.09, -0.13, 0.6], [-0.09, -0.13, 0.52], [0.0, -0.14, 0.72], [0.15, 0.06, 0.34], [-0.15, 0.06, 0.34]] as const) {
    drape(m, [x, 1.05, z], [x * 1.15, 1.05 - L, z * 1.5], 0.045, 0.0045, weave, B.hips, x * 11 + 1);
  }
  m.add(torus(sk.p(B.neck, 0, 0.02, 0), [0, 1, 0.1], 0.085, 0.03), cloth(0x2c2638), B.chest);
  drape(m, sk.p(B.neck, 0.04, 0.0, -0.09), [0.2, 1.05, -0.24], 0.05, 0.005, cloth(0x4a2a7a, 0.2), B.chest, 4);
  drape(m, sk.p(B.neck, -0.03, 0.0, -0.1), [-0.14, 1.15, -0.26], 0.04, 0.005, cloth(0x4a2a7a, 0.2), B.chest, 9);
  // Deep hood over a blank faceplate with one cut of violet.
  m.add(ellipsoid(P(0, 0.1, -0.03), [0.104, 0.122, 0.134]), weave, B.head, { k: 0.02 });
  m.cut(ellipsoid(P(0, 0.075, 0.13), [0.08, 0.1, 0.09]), { k: 0.02 });
  m.add(ellipsoid(P(0, 0.075, 0.03), [0.072, 0.092, 0.082]), lacquer, B.head, { rigid: true });
  m.add(at(frameE(P(0, 0.09, 0.108), 0, 0, 0.0), rbox([0, 0, 0], [0.05, 0.006, 0.006], 0.003)), accent, B.head, { rigid: true });
  m.add(cone(P(0, 0.2, -0.07), P(0, 0.17, -0.24), 0.05, 0.005), weave, B.head, { k: 0.02 });
  return sockets;
}

export function bomber(m: Model, sk: Sk, def: ArchetypeDef): Record<string, Socket> {
  const accent = accentOf(def);
  const P = headP(sk);
  const sallow = skin([0.5, 0.46, 0.38]);
  const apron = leather(0x3a3226);
  buildBody(m, sk, { mass: 0.84, skin: sallow, hands: 'fist', feet: 'none' });
  humanHead(m, sk, sallow, { gaunt: 0.8 });
  const body = m.snapshot();
  const wrap = cloth(0x7a7262, 0.9);
  // Bandages: the head is wound shut with one eye left.
  m.add({
    f: (x, y, z) => {
      const d = sphereDist(sk, x, y, z);
      if (d > 0.03) return d;
      return body.f(x, y, z) - 0.008 - Math.abs(Math.sin((y + z * 0.4) * 130)) * 0.0035;
    },
    lo: sub(sk.p(B.head, 0, 0.09, 0), [0.17, 0.17, 0.17]), hi: add(sk.p(B.head, 0, 0.09, 0), [0.17, 0.17, 0.17]),
  }, wrap, -1);
  m.add(sphere(P(0.036, 0.092, 0.085), 0.012), accent, B.head, { rigid: true });
  m.cut(ellipsoid(P(0.036, 0.092, 0.105), [0.022, 0.012, 0.02]), { k: 0.004 });

  // Straitjacket: bound canvas with buckled straps. These people did not volunteer.
  suit(m, body, cloth(0x6e6450, 0.9), { off: 0.009, folds: 1.3, exclude: [...handsAndHead(sk), sphere(sk.p(B.hips, 0, -0.32, 0), 0.44)] });
  suit(m, body, cloth(0x2a2820, 0.9), { off: 0.006, folds: 1.3, exclude: [...handsAndHead(sk), ...feet(sk), sphere([0, 1.45, 0], 0.46)] });
  plate(m, body, 0.018, 0.012, rbox([0, 1.18, 0.1], [0.18, 0.28, 0.14], 0.03), apron, B.chest, { rigid: false });
  const worn = m.snapshot();
  for (const y of [1.42, 1.26, 1.1]) {
    m.add(padOn(worn, 0.006, torsoBand(sk, y, 0.018)), leather(0x1c1812), y > 1.2 ? B.chest : B.spine);
    const f = surfaceHit(worn, [0.05, y, 0.3], [0, 0, -1]);
    m.add(rbox(add(f, [0, 0, 0.008]), [0.02, 0.024, 0.006], 0.003), steel, y > 1.2 ? B.chest : B.spine, { rigid: true });
  }
  // Charge belt.
  belt(m, sk, worn, 1.0, leather(0x141210), steel, { width: 0.03, off: 0.012 });
  for (let i = 0; i < 9; i++) {
    const a = -1.2 + (i / 8) * 2.4;
    const h = surfaceHit(worn, [Math.sin(a) * 0.4, 1.0, Math.cos(a) * 0.4], [-Math.sin(a), 0, -Math.cos(a)]);
    const c = add(h, [Math.sin(a) * 0.02, 0, Math.cos(a) * 0.02]);
    m.add(cyl(add(c, [0, -0.05, 0]), add(c, [0, 0.05, 0]), 0.022, 0.003), hazard(0xd8b000, 0x141414, 0.03), B.hips, { rigid: true });
  }
  for (const s of BOTH) boot(m, sk, s, leather(0x1a1814));
  // Dead-man switch taped to the right fist, wired up to the tank.
  const fist = sk.on(B.foreArmR, B.handR, 1.22);
  m.add(rbox(fist, [0.024, 0.03, 0.03], 0.008), darkSteel, B.handR, { rigid: true });
  m.add(cyl(add(fist, [-0.02, 0.0, 0.03]), add(fist, [-0.02, 0.0, 0.05]), 0.009), accent, B.handR, { rigid: true });
  hosePath(m, [[-0.22, 1.3, -0.12], [-0.3, 1.2, -0.04], [-0.32, 1.08, 0.0]], B.chest, { r: 0.005, mat: rubber });
  hosePath(m, sk.armBones(-1).upper ? [sk.on(B.upperArmR, B.foreArmR, 0.5, -0.04, 0, 0), sk.on(B.foreArmR, B.handR, 0.1, -0.05, 0, 0), sk.on(B.foreArmR, B.handR, 0.8, -0.04, 0, 0)] : [], B.foreArmR, { r: 0.005, mat: rubber });
  const sockets = standardSockets(sk);
  sockets.back = { bone: B.chest, pos: [0, 0.12, -0.25], rot: [0, 0, 0, 1] };
  return sockets;
}

const sphereDist = (sk: Sk, x: number, y: number, z: number) => {
  const p = sk.p(B.head, 0, 0.08, 0.01);
  return Math.hypot(x - p[0], y - p[1], z - p[2]) - 0.16;
};

export function warden(m: Model, sk: Sk, def: ArchetypeDef): Record<string, Socket> {
  const accent = accentOf(def);
  const P = headP(sk);
  const robe = cloth(0x38343a, 0.5);
  const vest = cloth(0x8a7a58, 0.5);
  const gold: Mat = { albedo: [0.76, 0.6, 0.3], rough: 0.32, metal: 1, detail: 2, wear: 0.4 };
  const iron = paintedMetal(0x26221e, 0.5, 1);
  const { body, sockets } = clothedBody(m, sk, { suit: robe, mass: 0.96, folds: 1.5, glove: leather(0x2c2620) });
  // Layered vestments in long stiff panels reaching the floor.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.31;
    const x = Math.sin(a), z = Math.cos(a);
    const top = surfaceHit(body, [x * 0.4, 1.12, z * 0.4], [-x, 0, -z]);
    drape(m, add(top, [x * 0.012, 0, z * 0.012]), [x * 0.34, 0.1 + (i % 2) * 0.05, z * 0.27], 0.1, 0.008, robe, B.hips, i * 0.2);
  }
  // One long vestment down the front: the pale stripe that marks the warden in a crowd.
  drape(m, [0, 1.3, 0.13], [0, 0.16, 0.3], 0.085, 0.009, vest, B.hips, 3);
  drape(m, [0, 1.3, -0.14], [0, 0.2, -0.3], 0.085, 0.009, vest, B.hips, 8);
  belt(m, sk, m.snapshot(), 1.08, leather(0x1c1812), steel, { width: 0.04, off: 0.03 });
  // Shoulder mantle: a wide flat yoke with hanging cords.
  m.add(cut(ellipsoid([0, 1.5, -0.01], [0.36, 0.09, 0.22]), cyl([0, 1.3, 0], [0, 1.7, 0], 0.075, 0.004)), iron, B.chest, { rigid: true, k: 0.01 });
  m.add(torus([0, 1.47, -0.01], [0, 1, 0], 0.27, 0.012), gold, B.chest, { rigid: true });
  for (const s of BOTH) m.add(cone(sk.p(sk.armBones(s).upper, s * 0.06, 0.03, 0), sk.p(sk.armBones(s).upper, s * 0.12, -0.3, 0.02), 0.03, 0.015), vest, B.chest, { k: 0.004 });
  m.add(capsule([0, 1.28, 0.16], [0, 1.08, 0.18], 0.012), gold, B.chest, { rigid: true });
  m.add(sphere([0, 1.3, 0.16], 0.03), accent, B.chest, { rigid: true });
  // Tall mitre and a blank gilt mask: nothing human looks out.
  hood(m, sk, cloth(0x1c1a1e), { size: 1.02 });
  m.add(ellipsoid(P(0, 0.07, 0.052), [0.074, 0.098, 0.066]), gold, B.head, { rigid: true });
  for (const s of BOTH) m.add(rbox(P(s * 0.034, 0.098, 0.116), [0.018, 0.0034, 0.006], 0.002), accent, B.head, { rigid: true });
  m.add(rbox(P(0, 0.008, 0.116), [0.024, 0.0026, 0.005], 0.002), darkSteel, B.head, { rigid: true, detail: true });
  const mitre = frustum(P(0, 0.14, -0.015), P(0, 0.44, -0.015), 0.104, 0.024, 0.008);
  m.add(mitre, iron, B.head, { rigid: true });
  panelLine(m, P(-0.2, 0.2, 0.1), P(0.2, 0.2, 0.1), 0.004);
  // Halo mounted behind the head on a neck yoke. It rides the chest so it stays steady as the head turns.
  const hc = P(0, 0.12, -0.15);
  m.add(torus(hc, [0, 0, 1], 0.27, 0.012), gold, B.chest, { rigid: true });
  m.add(torus(hc, [0, 0, 1], 0.24, 0.006), accent, B.chest, { rigid: true });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r0 = 0.28, r1 = i % 2 ? 0.37 : 0.33;
    m.add(cone(add(hc, [Math.cos(a) * r0, Math.sin(a) * r0, 0]), add(hc, [Math.cos(a) * r1, Math.sin(a) * r1, 0]), 0.012, 0.002), gold, B.chest, { rigid: true });
  }
  m.add(cone(sk.p(B.chest, 0, 0.1, -0.11), add(hc, [0, -0.25, 0]), 0.03, 0.02), iron, B.chest, { rigid: true });
  return sockets;
}

export function juggernaut(m: Model, sk: Sk, def: ArchetypeDef): Record<string, Socket> {
  const accent = accentOf(def);
  const P = headP(sk);
  const slab = paintedMetal(0x34302c, 0.5, 1);
  const iron = paintedMetal(0x1e1e22, 0.55, 1);
  const { body, sockets } = clothedBody(m, sk, { suit: cloth(0x1c1c20), mass: 1.46, folds: 0.5, hands: 'fist', bootMat: iron });
  const front = cuirass(m, body, sk, slab, { off: 0.045, top: 1.54, bottom: 1.12, width: 0.31 });
  // Furnace grate in the breastplate.
  m.cut(rbox([0, 1.34, 0.22], [0.14, 0.09, 0.06], 0.016), { k: 0.004, mat: accent });
  for (let i = -3; i <= 3; i++) m.add(rbox([i * 0.04, 1.34, 0.17], [0.0085, 0.09, 0.012], 0.003), iron, B.chest, { rigid: true });
  rivets(m, front, [-0.26, -0.19, 0.19, 0.26].flatMap(x => [[x, 1.5, 0], [x, 1.4, 0], [x, 1.26, 0], [x, 1.17, 0]] as V3[]), [0, 0, -1], steel, B.chest, 0.011);
  for (let i = 0; i < 3; i++) plate(m, body, 0.04, 0.02, rbox([0, 1.08 - i * 0.056, 0.1], [0.2 - i * 0.012, 0.034, 0.16], 0.014), iron, i < 1 ? B.spine : B.hips);
  belt(m, sk, m.snapshot(), 0.94, leather(0x141210), steel, { width: 0.04, off: 0.04 });
  for (const s of BOTH) {
    pauldron(m, sk, s, slab, { size: 1.9, tiers: 2, flare: 0.3 });
    // Ram plates rise past the head: a wall of steel from the front.
    const { upper } = sk.armBones(s);
    const sh = sk.pos[upper]!;
    m.add(at(frameE(add(sh, [s * 0.02, 0.2, 0.0]), 0, 0, s * 0.3), rbox([0, 0, 0], [0.028, 0.17, 0.17], 0.018)), iron, upper, { rigid: true });
    for (let i = 0; i < 3; i++) m.add(cone(add(sh, [s * (0.0 - i * 0.04), 0.33 - i * 0.03, -0.1 + i * 0.1]), add(sh, [s * (0.02 - i * 0.05), 0.46 - i * 0.04, -0.1 + i * 0.1]), 0.022, 0.003), steel, upper, { rigid: true });
    kneePad(m, body, sk, s, slab, 1.4);
    pillarLeg(m, sk, s, slab, iron, 1.25);
    boot(m, sk, s, iron, { plated: slab, height: 0.34 });
    // Hammer fists.
    const { fore, hand } = sk.armBones(s);
    const w = sk.pos[hand]!;
    const dir = norm(sub(w, sk.pos[fore]!));
    const fist = add(w, scale(dir, 0.1));
    m.add(at(frameY(fist, dir), rbox([0, 0, 0], [0.098, 0.104, 0.1], 0.028)), slab, hand, { rigid: true });
    for (let i = -1; i <= 1; i++) m.add(at(frameY(add(fist, scale(dir, 0.1)), dir), rbox([i * 0.06, 0, 0], [0.024, 0.018, 0.09], 0.01)), steel, hand, { rigid: true });
    m.add(at(frameY(sk.on(fore, hand, 0.55), dir), rbox([0, 0, 0], [0.085, 0.17, 0.082], 0.022)), iron, fore, { rigid: true });
    // Piston along the forearm.
    m.add(cyl(sk.on(fore, hand, 0.1, s * 0.09, 0, 0), sk.on(fore, hand, 0.85, s * 0.09, 0, 0), 0.016, 0.003), steel, fore, { rigid: true });
    hosePath(m, [[s * 0.2, 1.4, -0.22], [s * 0.36, 1.52, -0.14], sk.on(upper, fore, 0.7, s * 0.1, 0, -0.03)], B.chest, { r: 0.016, mat: rubber });
  }
  // Gorget and a small iron head deep between the shoulders.
  m.add(cut(frustum(sk.p(B.neck, 0, -0.08, -0.01), sk.p(B.neck, 0, 0.13, 0.01), 0.24, 0.13, 0.014), cyl(sk.p(B.neck, 0, -0.2, 0), sk.p(B.neck, 0, 0.3, 0), 0.094, 0.003)), iron, B.chest, { rigid: true });
  hood(m, sk, rubber, { size: 0.9 });
  m.add(cut(rbox(P(0, 0.09, 0.014), [0.09, 0.1, 0.1], 0.03), rbox(P(0, 0.08, 0.12), [0.056, 0.008, 0.05], 0.002)), slab, B.head, { rigid: true });
  m.add(rbox(P(0, 0.08, 0.085), [0.052, 0.0065, 0.012], 0.002), accent, B.head, { rigid: true });
  // Exhaust stacks.
  for (const s of BOTH) {
    m.add(cyl([s * 0.16, 1.3, -0.25], [s * 0.2, 1.84, -0.28], 0.042, 0.006), darkSteel, B.chest, { rigid: true });
    m.add(cut(cyl([s * 0.2, 1.8, -0.28], [s * 0.205, 1.88, -0.283], 0.05, 0.004), cyl([s * 0.2, 1.82, -0.28], [s * 0.205, 1.92, -0.283], 0.034, 0.002)), rust, B.chest, { rigid: true });
    m.add(cyl([s * 0.2, 1.8, -0.28], [s * 0.2, 1.82, -0.28], 0.033), accent, B.chest, { rigid: true });
  }
  m.add(rbox([0, 1.34, -0.25], [0.2, 0.18, 0.08], 0.03), iron, B.chest, { rigid: true });
  return sockets;
}

export function titan(m: Model, sk: Sk, def: ArchetypeDef): Record<string, Socket> {
  const accent = accentOf(def);
  const P = headP(sk);
  const iron = paintedMetal(0x2a2826, 0.6, 1);
  const hull = paintedMetal(0x3a3632, 0.55, 1);
  const soot = paintedMetal(0x18181a, 0.7, 0.6);
  const magma: Mat = {
    albedo: [1, 0.34, 0.08], rough: 0.5, emissive: 1, detail: 2,
    paint: (x, y, z, o) => {
      const n = ridged(x * 12, y * 12, z * 12, 3);
      const crust = sstep(0.42, 0.62, n);
      o.r *= 1 - crust * 0.92; o.g *= 1 - crust * 0.96; o.b *= 1 - crust;
      o.emissive = 1 - crust;
      o.rough = 0.5 + crust * 0.4;
    },
  };
  buildBody(m, sk, { mass: 1.5, skin: iron, hands: 'fist', feet: 'none' });
  const body = m.snapshot();
  suit(m, body, soot, { off: 0.012, folds: 0.2, exclude: [] });
  const front = cuirass(m, body, sk, hull, { off: 0.042, top: 1.56, bottom: 1.14, width: 0.33 });
  // The reactor: the chest splits open on a sealed crucible of live metal.
  m.cut(ellipsoid([0, 1.33, 0.2], [0.13, 0.17, 0.12]), { k: 0.012, mat: magma });
  m.add(ellipsoid([0, 1.33, 0.1], [0.12, 0.16, 0.08]), magma, B.chest, { rigid: true });
  for (let i = 0; i < 5; i++) {
    const a = -0.9 + (i / 4) * 1.8;
    m.add(tube(spline([[Math.sin(a) * 0.17, 1.5, 0.2], [Math.sin(a) * 0.09, 1.33, 0.26], [Math.sin(a) * 0.17, 1.16, 0.2]], 12), 0.011), steel, B.chest, { rigid: true });
  }
  rivets(m, front, [-0.28, -0.2, 0.2, 0.28].flatMap(x => [[x, 1.5, 0], [x, 1.38, 0], [x, 1.26, 0], [x, 1.18, 0]] as V3[]), [0, 0, -1], steel, B.chest, 0.01);
  for (let i = 0; i < 4; i++) plate(m, body, 0.04, 0.022, rbox([0, 1.1 - i * 0.058, 0.1], [0.22 - i * 0.012, 0.036, 0.18], 0.014), i % 2 ? hull : iron, i < 1 ? B.spine : B.hips);
  for (const s of BOTH) {
    pauldron(m, sk, s, hull, { size: 2.2, tiers: 3, flare: 0.3, spike: darkSteel });
    const { upper, fore } = sk.armBones(s);
    kneePad(m, body, sk, s, hull, 1.6);
    pillarLeg(m, sk, s, hull, iron, 1.45);
    bracer(m, body, sk, s, hull);
    boot(m, sk, s, iron, { plated: hull, height: 0.4 });
    const { foot } = sk.legBones(s);
    m.add(rbox(sk.p(foot, 0, -0.03, 0.05), [0.12, 0.05, 0.22], 0.03), hull, foot, { rigid: true });
    hosePath(m, [[s * 0.2, 1.42, -0.2], [s * 0.42, 1.6, -0.12], sk.on(upper, fore, 0.8, s * 0.12, 0, -0.04)], B.chest, { r: 0.02, mat: rubber });
    hosePath(m, [[s * 0.12, 1.02, -0.14], [s * 0.22, 0.86, -0.15], sk.on(sk.legBones(s).thigh, sk.legBones(s).shin, 0.6, s * 0.09, 0, -0.08)], B.hips, { r: 0.018, mat: rubber });
  }
  // Left arm ends in a forge hammer.
  {
    const { fore, hand } = sk.armBones(1);
    const w = sk.pos[hand]!;
    const dir = norm(sub(w, sk.pos[fore]!));
    // Haft continues the forearm, then a double-faced head runs across it like a sledge.
    m.add(cyl(w, add(w, scale(dir, 0.34)), 0.06, 0.01), iron, hand, { rigid: true });
    const c = add(w, scale(dir, 0.42));
    const across: V3 = [0, 0, 1];
    m.add(cyl(add(c, scale(across, -0.3)), add(c, scale(across, 0.3)), 0.17, 0.02), hull, hand, { rigid: true });
    for (const t of [-1, 1]) {
      m.add(frustum(add(c, scale(across, t * 0.3)), add(c, scale(across, t * 0.4)), 0.17, 0.13, 0.012), steel, hand, { rigid: true });
      m.add(cyl(add(c, scale(across, t * 0.2 - 0.016)), add(c, scale(across, t * 0.2 + 0.016)), 0.18, 0.004), iron, hand, { rigid: true });
    }
  }
  // Right arm ends in a cannon whose bore is lit from inside.
  {
    const { fore, hand } = sk.armBones(-1);
    const w = sk.pos[hand]!, e = sk.pos[fore]!;
    const dir = norm(sub(w, e));
    const end = add(w, scale(dir, 0.46));
    m.add(cyl(e, end, 0.12, 0.012), hull, hand, { rigid: true });
    m.add(cyl(add(end, scale(dir, -0.06)), add(end, scale(dir, 0.04)), 0.145, 0.01), iron, hand, { rigid: true });
    m.cut(cyl(add(end, scale(dir, -0.24)), add(end, scale(dir, 0.1)), 0.082, 0.003), { mat: magma });
    for (const t of [0.15, 0.35, 0.55, 0.75]) m.add(cyl(add(mix(e, end, t), scale(dir, -0.012)), add(mix(e, end, t), scale(dir, 0.012)), 0.13, 0.004), iron, hand, { rigid: true });
  }
  // Crowned iron head with a bar of furnace light.
  m.add(cut(frustum(sk.p(B.neck, 0, -0.08, -0.01), sk.p(B.neck, 0, 0.12, 0.01), 0.26, 0.14, 0.016), cyl(sk.p(B.neck, 0, -0.2, 0), sk.p(B.neck, 0, 0.3, 0), 0.1, 0.003)), iron, B.chest, { rigid: true });
  m.add(cut(ellipsoid(P(0, 0.09, 0.012), [0.112, 0.128, 0.122]), rbox(P(0, 0.09, 0.13), [0.076, 0.009, 0.05], 0.002)), hull, B.head, { rigid: true });
  m.add(rbox(P(0, 0.09, 0.09), [0.072, 0.0075, 0.012], 0.002), accent, B.head, { rigid: true });
  for (let i = -2; i <= 2; i++) {
    const a = i * 0.34;
    const base = P(Math.sin(a) * 0.096, 0.18, Math.cos(a) * 0.096 * 0.3 - 0.01);
    m.add(cone(base, add(base, [Math.sin(a) * 0.13, 0.3 - Math.abs(i) * 0.05, -0.05]), 0.03, 0.004), darkSteel, B.head, { rigid: true });
  }
  for (const s of BOTH) m.add(cone(P(s * 0.1, 0.1, -0.02), P(s * 0.3, 0.34, -0.12), 0.034, 0.004), darkSteel, B.head, { rigid: true });
  // Back: a bank of smokestacks reads as a burning city skyline against the fog.
  m.add(rbox([0, 1.36, -0.26], [0.26, 0.22, 0.09], 0.03), iron, B.chest, { rigid: true });
  for (let i = 0; i < 5; i++) {
    const x = -0.22 + i * 0.11;
    const top = 1.86 + (i === 2 ? 0.24 : i % 2 ? 0.1 : 0.02);
    m.add(cyl([x, 1.4, -0.28], [x, top, -0.3], 0.044, 0.006), soot, B.chest, { rigid: true });
    m.add(cyl([x, top - 0.02, -0.3], [x, top + 0.002, -0.3], 0.036), accent, B.chest, { rigid: true });
    m.add(cyl([x, top - 0.1, -0.296], [x, top - 0.07, -0.298], 0.052, 0.004), rust, B.chest, { rigid: true });
  }
  // Chains from the belt.
  for (const s of BOTH) {
    for (let i = 0; i < 5; i++) m.add(torus([s * 0.3, 0.96 - i * 0.05, 0.08], i % 2 ? [1, 0, 0] : [0, 0, 1], 0.03, 0.009), rust, B.hips, { rigid: true });
  }
  const sockets = standardSockets(sk);
  sockets.muzzle = { bone: B.handR, pos: [0, -0.5, 0], rot: [0, 0, 0, 1] };
  return sockets;
}

/** Armour bulk added around a heavy leg, so it reads as a pillar holding up the torso. */
function pillarLeg(m: Model, sk: Sk, side: Side, plateMat: Mat, frame: Mat, q: number): void {
  const { thigh, shin, foot } = sk.legBones(side);
  const T = sk.pos[thigh]!, K = sk.pos[shin]!, A = sk.pos[foot]!;
  const tc = mix(T, K, 0.52);
  m.add(at(frameY(tc, sub(T, K)), rbox([0, 0, 0], [0.105 * q, 0.2, 0.115 * q], 0.03)), plateMat, thigh, { rigid: true });
  m.add(at(frameY(add(tc, [side * 0.02 * q, 0, 0]), sub(T, K)), rbox([0, 0, 0], [0.09 * q, 0.13, 0.13 * q], 0.02)), frame, thigh, { rigid: true });
  const sc = mix(K, A, 0.46);
  m.add(at(frameY(sc, sub(K, A)), rbox([0, 0, 0], [0.09 * q, 0.18, 0.1 * q], 0.03)), plateMat, shin, { rigid: true });
  m.add(at(frameY(add(sc, [0, 0.03, 0.01]), sub(K, A)), rbox([0, 0, 0], [0.074 * q, 0.1, 0.112 * q], 0.018)), frame, shin, { rigid: true });
  m.add(cyl(add(tc, [side * 0.1 * q, 0.12, -0.05]), add(sc, [side * 0.07 * q, 0.1, -0.06]), 0.016, 0.003), steel, shin, { rigid: true });
}

/** Machine: spider mine with a shaped charge on its back. */
export function skitter(m: Model, sk: Sk, def: ArchetypeDef): Record<string, Socket> {
  const S = SkitterBone;
  const accent = accentOf(def);
  const shell = paintedMetal(0x2a2c30, 0.45, 1);
  const c = sk.pos[S.body]!;
  const top = cut(ellipsoid(add(c, [0, 0.02, 0]), [0.25, 0.14, 0.3]), rbox(add(c, [0, -0.13, 0]), [0.4, 0.09, 0.4], 0.002));
  m.add(top, shell, S.body, { rigid: true });
  m.add(ellipsoid(add(c, [0, -0.045, 0]), [0.2, 0.07, 0.25]), darkSteel, S.body, { rigid: true });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    panelLine(m, add(c, [Math.cos(a) * 0.06, 0.2, Math.sin(a) * 0.06]), add(c, [Math.cos(a) * 0.3, -0.02, Math.sin(a) * 0.3]), 0.003);
  }
  // The charge: a hazard-striped drum. The one thing on it worth shooting.
  m.add(cyl(add(c, [0, 0.1, -0.02]), add(c, [0, 0.21, -0.02]), 0.1, 0.008), hazard(0xc8a000, 0x141414, 0.05), S.body, { rigid: true });
  m.add(cyl(add(c, [0, 0.21, -0.02]), add(c, [0, 0.235, -0.02]), 0.06, 0.006), darkSteel, S.body, { rigid: true });
  m.add(cyl(add(c, [0, 0.235, -0.02]), add(c, [0, 0.245, -0.02]), 0.03), accent, S.body, { rigid: true });
  for (const s of BOTH) m.add(tube(spline([add(c, [s * 0.08, 0.17, -0.02]), add(c, [s * 0.16, 0.14, -0.1]), add(c, [s * 0.12, 0.06, -0.2])], 10), 0.008), rubber, S.body, { rigid: true });
  // Sensor head: a cluster of red lenses under a brow.
  const h = sk.pos[S.head]!;
  m.add(ellipsoid(add(h, [0, 0, 0.0]), [0.1, 0.075, 0.1]), shell, S.head, { rigid: true });
  for (const [x, y, r] of [[0, 0.01, 0.034], [0.05, 0.03, 0.017], [-0.05, 0.03, 0.017], [0.058, -0.012, 0.014], [-0.058, -0.012, 0.014]] as const) {
    m.add(sphere(add(h, [x, y, 0.082 - Math.abs(x) * 0.3]), r), accent, S.head, { rigid: true });
  }
  for (const s of BOTH) m.add(cone(add(h, [s * 0.05, -0.03, 0.07]), add(h, [s * 0.03, -0.1, 0.13]), 0.015, 0.002), steel, S.head, { rigid: true });
  const legs = [S.hipFL, S.hipML, S.hipBL, S.hipFR, S.hipMR, S.hipBR];
  for (const hip of legs) {
    const a = sk.pos[hip]!, b = sk.pos[hip + 1]!, f = sk.pos[hip + 2]!;
    m.add(sphere(a, 0.045), darkSteel, hip, { rigid: true });
    m.add(cone(a, b, 0.038, 0.03), shell, hip, { rigid: true });
    m.add(sphere(b, 0.034), steel, hip + 1, { rigid: true });
    m.add(cone(b, mix(b, f, 0.7), 0.026, 0.016), shell, hip + 1, { rigid: true });
    m.add(cone(mix(b, f, 0.65), f, 0.012, 0.004), steel, hip + 1, { rigid: true });
    m.add(cyl(mix(a, b, 0.2), mix(b, f, 0.25), 0.0075, 0.002), steel, hip, { rigid: true });
  }
  return {};
}

/** Machine: four ducted fans and a gimballed gun. */
export function drone(m: Model, sk: Sk, def: ArchetypeDef): Record<string, Socket> {
  const D = DroneBone;
  const accent = accentOf(def);
  const hull = paintedMetal(0x363a42, 0.42, 1);
  m.add(blend(0.05, ellipsoid([0, 0, 0.02], [0.22, 0.12, 0.32]), rbox([0, 0.03, -0.1], [0.16, 0.1, 0.16], 0.04)), hull, D.body, { rigid: true });
  m.add(rbox([0, 0.14, -0.06], [0.1, 0.03, 0.14], 0.016), darkSteel, D.body, { rigid: true });
  panelLine(m, [-0.3, 0.02, 0.2], [0.3, 0.02, 0.2], 0.003);
  panelLine(m, [0, 0.2, -0.3], [0, 0.2, 0.3], 0.003);
  for (const s of BOTH) m.add(rbox([s * 0.1, 0.02, 0.27], [0.03, 0.006, 0.05], 0.003), accent, D.body, { rigid: true, detail: true });
  for (const r of [D.rotorFL, D.rotorFR, D.rotorBL, D.rotorBR]) {
    const c = sk.pos[r]!;
    m.add(cone([Math.sign(c[0]) * 0.14, 0.03, Math.sign(c[2]) * 0.14], [c[0] * 0.72, c[1] - 0.012, c[2] * 0.72], 0.042, 0.026), hull, D.body, { rigid: true });
    m.add(cut(cyl(add(c, [0, -0.05, 0]), add(c, [0, 0.05, 0]), 0.2, 0.012), cyl(add(c, [0, -0.1, 0]), add(c, [0, 0.1, 0]), 0.175, 0.004)), hull, D.body, { rigid: true });
    m.add(torus(add(c, [0, 0.053, 0]), [0, 1, 0], 0.19, 0.006), darkSteel, D.body, { rigid: true });
    // The fan is on the rotor bone, so losing a fan takes only the blades, and the shroud stays as wreckage.
    m.add(cyl(add(c, [0, -0.03, 0]), add(c, [0, 0.03, 0]), 0.034, 0.006), steel, r, { rigid: true });
    const blade = at(frameE([0.09, 0.0, 0], 0.32), rbox([0, 0, 0], [0.078, 0.004, 0.024], 0.003));
    m.add(at({ o: c, x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }, radial(blade, 5)), darkSteel, r, { rigid: true });
    m.add(cyl(add(c, [0, 0.04, 0]), add(c, [0, 0.045, 0]), 0.024), accent, r, { rigid: true, detail: true });
  }
  const g = sk.pos[D.gun]!;
  m.add(sphere(g, 0.075), darkSteel, D.gun, { rigid: true });
  m.add(rbox(add(g, [0, 0, 0.12]), [0.04, 0.04, 0.1], 0.012), hull, D.gun, { rigid: true });
  for (const s of BOTH) m.add(cyl(add(g, [s * 0.022, 0, 0.18]), add(g, [s * 0.022, 0, 0.36]), 0.0145, 0.003), steel, D.gun, { rigid: true });
  const e = sk.pos[D.sensor]!;
  m.add(sphere(e, 0.066), darkSteel, D.sensor, { rigid: true });
  m.add(torus(add(e, [0, 0, 0.052]), [0, 0, 1], 0.04, 0.008), steel, D.sensor, { rigid: true });
  m.add(ellipsoid(add(e, [0, 0, 0.052]), [0.036, 0.036, 0.016]), accent, D.sensor, { rigid: true });
  antenna(m, [0.07, 0.17, -0.14], [0.11, 0.36, -0.22], D.body, darkSteel, accent);
  return { muzzle: { bone: D.gun, pos: [0, 0, 0.37], rot: [0, 0, 0, 1] } };
}

