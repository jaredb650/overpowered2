/**
 * The player: the Council's contractor, seen from outside for the first time. Built from the first-person kit so the
 * two agree: a grey-blue combat sleeve, armoured bracers with the wrist computer on the left, leather gloves, a slim
 * plate carrier. An open-faced helmet with a smoked visor down over the eyes, so he has no face to read but a jaw and a
 * mouth: the main menu shows him smoking, and a full mask could not. His accent is the HUD's orange: warm colour belongs
 * to whatever the player does; the helmet's one cold light matches the wrist computer.
 */
import type { ArchetypeDef } from '../../../src/characters/archetypes';
import type { Socket } from '../../../src/characters/format';
import { DETAIL_CLOTH, DETAIL_SKIN, type Mat, type Model } from '../model';
import { blend, capsule, cone, cut, cyl, ellipsoid, fbm, inter, offset, rbox, sphere, spline, torus, tube, union, add, type Shape, type V3 } from '../sdf';
import { humanHead } from '../parts/body';
import { antenna, belt, bracer, groove, headP, kneePad, lineH, pouch, surfaceHit, cuirass, stencil, shinGuard } from '../parts/gear';
import { cloth, darkSteel, glow, leather, paintedMetal, rubber, steel } from '../parts/materials';
import { B, type Side, type Sk } from '../parts/skeleton';
import { clothedBody } from './soldiers';

const BOTH: readonly Side[] = [1, -1];

/** Weathered, not bruised: the enemies' skin has veins and bruising painted in, and this one is the hero. */
const face: Mat = {
  albedo: [0.62, 0.47, 0.39], rough: 0.52, detail: DETAIL_SKIN,
  paint: (x, y, z, o) => {
    const n = fbm(x * 9, y * 9, z * 9, 3);
    const f = 0.9 + n * 0.22;
    o.r *= f; o.g *= f; o.b *= f;
  },
};

/** A day's growth: the skin under it, darkened in a fine grain. */
const stubble: Mat = {
  albedo: [0.47, 0.37, 0.32], rough: 0.66, detail: DETAIL_SKIN,
  paint: (x, y, z, o) => {
    const g = fbm(x * 90, y * 90, z * 90, 2);
    const t = 0.8 + g * 0.35;
    o.r *= t; o.g *= t; o.b *= t;
  },
};

const eyes: Mat = { albedo: [0.06, 0.05, 0.05], rough: 0.15, detail: DETAIL_SKIN };

/** Smoked polycarbonate: near black, glossy, a little metal so the dusk sky slides across it. */
const smoked: Mat = { albedo: [0.018, 0.024, 0.034], rough: 0.06, metal: 0.55, detail: 2 };

/** The cold status light on the helmet, the wrist screen's colour. */
const COLD: V3 = [0.22, 0.85, 1.0];

export function contractor(m: Model, sk: Sk, def: ArchetypeDef): Record<string, Socket> {
  const sleeve = cloth(0x343b44, 0.35);
  const web = cloth(0x1d1f23, 0.2);
  const polymer = paintedMetal(0x40454c, 0.55, 0.5);
  const carbon = paintedMetal(0x26282c, 0.36, 0.3);
  const accent = glow([def.accent[0], def.accent[1], def.accent[2]], 0.9);
  const P = headP(sk);

  const { body, sockets } = clothedBody(m, sk, {
    suit: sleeve, mass: 1.06, folds: 1.1, glove: leather(0x25272b), bootMat: leather(0x18191c), hands: 'open', handsL: 'grip',
  });
  const under = m.snapshot();

  // Slim plate carrier, low profile: he does not expect to be shot much.
  cuirass(m, body, sk, polymer, { off: 0.02, top: 1.46, bottom: 1.2, width: 0.16 });
  stencil(m, [0.07, 1.27, 0.19], 0.07, 0.022, 41);
  m.paint(rbox([-0.075, 1.4, 0.2], [0.035, 0.0055, 0.08], 0.002), accent, 0.001);
  // Shoulder straps of the carrier, one capsule chain each over the top of the shoulder.
  for (const s of BOTH) {
    const a = surfaceHit(under, [s * 0.11, 1.44, 0.3], [0, 0, -1]);
    const c = surfaceHit(under, [s * 0.11, 1.44, -0.3], [0, 0, 1]);
    const top = surfaceHit(under, [s * 0.125, 1.8, 0], [0, -1, 0]);
    m.add(blend(0.01, capsule(add(a, [0, 0, 0.012]), add(top, [0, 0.01, 0.03]), 0.016), capsule(add(top, [0, 0.01, 0.03]), add(top, [0, 0.01, -0.03]), 0.016),
      capsule(add(top, [0, 0.01, -0.03]), add(c, [0, 0, -0.012]), 0.016)), web, B.chest, { k: 0.006 });
  }
  belt(m, sk, under, 1.02, web, steel, { width: 0.026 });
  for (const s of BOTH) {
    pouch(m, surfaceHit(under, [s * 0.09, 1.13, 0.3], [0, 0, -1]), web, { bone: B.spine, size: [0.036, 0.046, 0.022] });
    pouch(m, surfaceHit(under, [s * 0.18, 0.98, 0.02], [-s, 0, 0]), web, { bone: B.hips, size: [0.028, 0.044, 0.034] });
    kneePad(m, body, sk, s, carbon, 0.95);
    shinGuard(m, body, sk, s, polymer);
    bracer(m, body, sk, s, s > 0 ? carbon : polymer);
    // A stripe of the accent down the outside of each sleeve.
    const { upper, fore } = sk.armBones(s);
    m.paint(capsule(sk.on(upper, fore, 0.15, s * 0.055, 0, 0), sk.on(upper, fore, 0.6, s * 0.052, 0, 0), 0.008), { ...accent, emissive: 0.5 }, 0.001);
  }
  // The wrist computer on the left bracer, the one the first-person arm reads from. Cold, so it never reads as the cigar.
  const wrist = sk.on(B.foreArmL, B.handL, 0.62, 0.035, 0.0, 0.0);
  m.add(rbox(wrist, [0.012, 0.032, 0.026], 0.005), darkSteel, B.foreArmL, { rigid: true });
  m.add(rbox(add(wrist, [0.0125, 0, 0]), [0.002, 0.026, 0.02], 0.002), glow(COLD, 0.035), B.foreArmL, { rigid: true, detail: true });
  // Holster on the right thigh, knife on the left.
  m.add(rbox(sk.on(B.thighR, B.shinR, 0.3, -0.088, 0, 0.01), [0.018, 0.08, 0.036], 0.012), web, B.thighR, { rigid: true });
  m.add(rbox(sk.on(B.thighR, B.shinR, 0.18, -0.1, 0.03, 0.02), [0.016, 0.03, 0.03], 0.008), carbon, B.thighR, { rigid: true });
  m.add(rbox(sk.on(B.thighL, B.shinL, 0.35, 0.09, 0, 0.0), [0.012, 0.07, 0.02], 0.008), leather(0x1c1d20), B.thighL, { rigid: true });
  // A flat radio on the back with a stub antenna.
  m.add(rbox([0, 1.33, -0.16], [0.085, 0.11, 0.035], 0.016), polymer, B.chest, { rigid: true });
  antenna(m, [-0.06, 1.42, -0.17], [-0.08, 1.62, -0.22], B.chest, darkSteel);

  // Rolled collar.
  m.add(torus(sk.p(B.neck, 0, -0.03, -0.005), [0, 1, 0.12], 0.07, 0.018), sleeve, B.chest, { k: 0.01 });

  // The head under the helmet: only the jaw, the mouth and a day of stubble show below the visor.
  humanHead(m, sk, face, { eyeMat: eyes });
  // Mouth: a shallow line, and a fuller lower lip, so a cigar has somewhere to sit.
  m.cut(capsule(P(-0.02, 0.031, 0.1), P(0.02, 0.031, 0.1), 0.0032), { k: 0.003 });
  m.add(capsule(P(-0.013, 0.025, 0.09), P(0.013, 0.025, 0.09), 0.0062), face, B.head, { k: 0.008 });
  // A squarer jaw than the stock head: he is the hero, and below a visor the jaw is the face.
  for (const s of BOTH) m.add(ellipsoid(P(s * 0.042, -0.002, 0.058), [0.022, 0.02, 0.028]), face, B.head, { k: 0.026 });
  m.paint(inter(ellipsoid(P(0, 0.012, 0.06), [0.07, 0.05, 0.06]), rbox(P(0, -0.01, 0.08), [0.1, 0.045, 0.08], 0.01), 0.012), stubble, 0.006);
  // Keep the lips clean.
  m.paint(capsule(P(-0.016, 0.028, 0.1), P(0.016, 0.028, 0.1), 0.009), face, 0.002);
  helmetAndVisor(m, sk, polymer, carbon, accent);
  // Earpiece on the left ear, under the helmet's edge, with the accent lit.
  m.add(ellipsoid(P(0.088, 0.07, 0.0), [0.01, 0.018, 0.014]), darkSteel, B.head, { rigid: true });
  m.add(sphere(P(0.097, 0.074, 0.004), 0.0045), accent, B.head, { rigid: true });
  m.add(cone(P(0.088, 0.056, 0.012), P(0.06, 0.03, 0.08), 0.003, 0.0022), darkSteel, B.head, { rigid: true });
  // The half mask he wears on the job, unclipped and hung on the right shoulder strap of the carrier: off the mouth,
  // and on the side away from the cigar hand.
  halfMaskOnChest(m, under, carbon);

  // Bone-local, for the menu's cigar: between the lips, and in the left hand's grip.
  sockets.mouth = { bone: B.head, pos: [0.012, 0.027, 0.104], rot: [0, 0, 0, 1] };
  return sockets;
}

/**
 * A high-cut shell in the suit's grey-blue, cut away over the ears and open from the brow down, with a smoked visor
 * hinged at the temples and dropped over the eyes and the bridge of the nose. It stops above the upper lip, so the mouth
 * and jaw stay free for the cigar. A chin strap holds it on, an orange stripe runs back over the crown, and a small rail
 * box on the left carries the cold status light.
 */
function helmetAndVisor(m: Model, sk: Sk, shellMat: Mat, trim: Mat, accent: Mat): void {
  const P = headP(sk);
  const hy = sk.pos[B.head]![1], hz = sk.pos[B.head]![2];
  // Shell: a dome a finger's width off the skull, cut level above the ears, higher over them, and open at the face.
  const dome = ellipsoid(P(0, 0.118, -0.008), [0.106, 0.108, 0.122]);
  const below = rbox(P(0, 0.0, -0.02), [0.2, 0.072, 0.3], 0.002);
  const ears = union(...BOTH.map(s => ellipsoid(P(s * 0.1, 0.07, 0.004), [0.05, 0.038, 0.042])));
  const brow = rbox(P(0, 0.06, 0.15), [0.12, 0.072, 0.1], 0.004);
  const shell = cut(cut(cut(dome, below, 0.01), ears, 0.012), brow, 0.012);
  m.add(shell, shellMat, B.head, { rigid: true });
  // A darker band round the cut edge, which is what makes a shell read as a shell and not a cap of hair.
  const cuts = union(below, ears, brow);
  m.paint(cut(offset(cuts, 0.009), cuts), trim, 0.002);
  groove(m, shell, lineH(hy + 0.17, -0.14, 0.14, hz, 0.0016, 0.2));
  // The orange stripe: back over the crown, offset to his left of the centre line.
  m.paint(rbox(P(0.03, 0.2, -0.02), [0.006, 0.06, 0.16], 0.002), { ...accent, emissive: 0.12, rough: 0.5 }, 0.0015);
  // A brow guard the visor tucks under.
  const guard = inter(ellipsoid(P(0, 0.112, 0.0), [0.112, 0.112, 0.136]), rbox(P(0, 0.138, 0.1), [0.11, 0.009, 0.07], 0.004), 0.003);
  m.add(cut(guard, ellipsoid(P(0, 0.112, -0.004), [0.1, 0.1, 0.122])), trim, B.head, { rigid: true });
  // The visor: a slice of an ellipsoid shell, 14 mm thick so the bake keeps it whole, from the brow guard to just under
  // the nose. What it hides of the face does not matter.
  const outer = ellipsoid(P(0, 0.078, 0.0), [0.114, 0.112, 0.15]);
  const inner = ellipsoid(P(0, 0.078, 0.0), [0.1, 0.098, 0.136]);
  const band = rbox(P(0, 0.094, 0.11), [0.13, 0.04, 0.1], 0.008);
  // The lower edge sweeps up toward the temples, so it reads as a visor and not a band.
  const sweep = union(...BOTH.map(s => ellipsoid(P(s * 0.12, 0.03, 0.05), [0.075, 0.042, 0.1])));
  m.add(cut(inter(cut(outer, inner), band, 0.004), sweep, 0.006), smoked, B.head, { rigid: true });
  // Hinges at the temples.
  for (const s of BOTH) {
    m.add(cyl(P(s * 0.1, 0.112, 0.03), P(s * 0.118, 0.112, 0.03), 0.017, 0.004), trim, B.head, { rigid: true });
    m.add(cyl(P(s * 0.117, 0.112, 0.03), P(s * 0.121, 0.112, 0.03), 0.007, 0.002), steel, B.head, { rigid: true });
  }
  // Side rails, and on the left a small box with the cold light.
  for (const s of BOTH) m.add(rbox(P(s * 0.104, 0.112, -0.04), [0.008, 0.01, 0.05], 0.003), trim, B.head, { rigid: true });
  m.add(rbox(P(0.112, 0.112, -0.05), [0.008, 0.014, 0.02], 0.003), darkSteel, B.head, { rigid: true });
  m.add(rbox(P(0.12, 0.114, -0.044), [0.0015, 0.004, 0.006], 0.001), glow(COLD, 0.8), B.head, { rigid: true, detail: true });
  // Chin strap: from behind each ear, round under the jaw, clear of the mouth.
  for (const s of BOTH) {
    const pts = spline([P(s * 0.094, 0.08, -0.03), P(s * 0.084, 0.03, -0.012), P(s * 0.066, -0.014, 0.024), P(s * 0.03, -0.042, 0.052), P(0, -0.046, 0.058)], 14);
    m.add(tube(pts, 0.0045), web(), B.head, { rigid: true });
  }
  m.add(rbox(P(0, -0.046, 0.058), [0.012, 0.006, 0.008], 0.002), darkSteel, B.head, { rigid: true });
}

const web = () => cloth(0x1d1f23, 0.2);

/** A rubber half mask with one filter, hung by its strap from the carrier's right shoulder strap. */
function halfMaskOnChest(m: Model, under: Shape, mat: Mat): void {
  const at = surfaceHit(under, [-0.11, 1.4, 0.3], [0, 0, -1]);
  const c: V3 = add(at, [0, 0, 0.034]);
  const cup = cut(ellipsoid(c, [0.04, 0.034, 0.026]), ellipsoid(add(c, [0, 0, -0.02]), [0.034, 0.03, 0.026]));
  m.add(cup, rubber, B.chest, { rigid: true });
  m.add(cyl(add(c, [0, -0.008, 0.016]), add(c, [0, -0.012, 0.036]), 0.019, 0.004), mat, B.chest, { rigid: true });
  m.add(torus(add(c, [0, -0.012, 0.036]), [0, -0.2, 1], 0.019, 0.0025), darkSteel, B.chest, { rigid: true });
  m.add(capsule(add(c, [0.036, 0.012, -0.004]), add(at, [0.01, 0.07, 0.012]), 0.0035), rubber, B.chest, { rigid: true });
}
