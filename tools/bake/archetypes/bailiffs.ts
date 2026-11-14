/**
 * The Bailiffs: the Office of Societal Compliance's own armed collectors, the player's allies (docs/proposals/mission-2-plan.md,
 * section 4). Spec-ops, not soldiers: a matte black suit, charcoal armour cut close, grey webbing, a hood over a smooth black helmet
 * with one red slit, and a red stripe down the left arm. Red is small and lit, never a coat, because red over a body is the crosshair's
 * word for "hostile". Nothing is baked in the hands: `allies/props.ts` fits the gun for his type. The helmet is part of the body, so it
 * never comes off, and a head that is shot apart bursts (there is no partial head for these).
 */
import type { ArchetypeDef } from '../../../src/characters/archetypes';
import type { Socket } from '../../../src/characters/format';
import type { Mat, Model } from '../model';
import { blend, capsule, cut, ellipsoid, frustum, cyl, rbox, add, type Shape } from '../sdf';
import { belt, bracer, cuirass, elbowPad, groove, headP, hood, kneePad, lineH, pauldron, pouch, shinGuard, surfaceHit, thighPlate } from '../parts/gear';
import { cloth, darkSteel, glow, leather, paintedMetal } from '../parts/materials';
import { B, type Side, type Sk } from '../parts/skeleton';
import { clothedBody } from './soldiers';

const BOTH: readonly Side[] = [1, -1];

const suitBlack = () => cloth(0x0d0e10, 0.12);
const armour = () => paintedMetal(0x24262b, 0.6, 0.05);
const webGrey = () => cloth(0x4c5056, 0.2);
/** The helmet: glossy black, a little metal, so the sky slides across it and the shape reads in the dark. */
const shellBlack: Mat = { albedo: [0.03, 0.032, 0.036], rough: 0.22, metal: 0.45, detail: 2 };
const red = (def: ArchetypeDef, s = 1) => glow([def.accent[0], def.accent[1], def.accent[2]], s);

/**
 * The head: a cloth hood over a smooth helmet whose front is one black faceplate with a single red slit across the eyes.
 * `q` scales the helmet for the heavy.
 */
/** Grey carrier straps over each shoulder, one capsule chain each (the harness from soldiers.ts shards at this body's neck). */
function straps(m: Model, under: Shape, mat: Mat, top: number): void {
  for (const s of BOTH) {
    const a = surfaceHit(under, [s * 0.11, top, 0.3], [0, 0, -1]);
    const c = surfaceHit(under, [s * 0.11, top, -0.3], [0, 0, 1]);
    const o = surfaceHit(under, [s * 0.125, 1.8, 0], [0, -1, 0]);
    m.add(blend(0.01, capsule(add(a, [0, 0, 0.012]), add(o, [0, 0.01, 0.03]), 0.016), capsule(add(o, [0, 0.01, 0.03]), add(o, [0, 0.01, -0.03]), 0.016),
      capsule(add(o, [0, 0.01, -0.03]), add(c, [0, 0, -0.012]), 0.016)), mat, B.chest, { k: 0.006 });
  }
}

function bureauHead(m: Model, sk: Sk, def: ArchetypeDef, q = 1): void {
  const P = headP(sk);
  // The hood with the face cut open, then the helmet inside it, so only the front of the helmet shows.
  hood(m, sk, suitBlack(), { size: 1.2 * q, folds: 0.5 });
  m.cut(ellipsoid(P(0, 0.07, 0.13 * q), [0.082 * q, 0.1 * q, 0.07]), { k: 0.012 });
  const shell = blend(0.03, ellipsoid(P(0, 0.104, 0.0), [0.1 * q, 0.108 * q, 0.116 * q]), ellipsoid(P(0, 0.05, 0.05), [0.084 * q, 0.098 * q, 0.09 * q]));
  m.add(shell, shellBlack, B.head, { rigid: true });
  // The slit: a dark recess with a thin lit core, flush with the faceplate.
  const z = 0.13 * q;
  m.add(ellipsoid(P(0, 0.094, z - 0.03), [0.07 * q, 0.016, 0.04]), darkSteel, B.head, { rigid: true });
  m.add(ellipsoid(P(0, 0.094, z - 0.026), [0.064 * q, 0.0075, 0.04]), red(def, 1), B.head, { rigid: true });
  // A seam down the faceplate, and the brow break.
  groove(m, shell, lineH(sk.pos[B.head]![1] + 0.13, -0.12, 0.12, sk.pos[B.head]![2] + 0.1, 0.0016, 0.1));
}

/** The red stripe down the outside of the left sleeve: shoulder to wrist, lit. */
function stripe(m: Model, sk: Sk, def: ArchetypeDef, out = 0.055): void {
  const { upper, fore, hand } = sk.armBones(1);
  m.paint(capsule(sk.on(upper, fore, 0.12, out, 0, 0), sk.on(upper, fore, 0.95, out * 0.96, 0, 0), 0.0085), { ...red(def), emissive: 0.55 }, 0.001);
  m.paint(capsule(sk.on(fore, hand, 0.05, out * 0.86, 0, 0), sk.on(fore, hand, 0.55, out * 0.72, 0, 0), 0.008), { ...red(def), emissive: 0.55 }, 0.001);
}

export function bailiff(m: Model, sk: Sk, def: ArchetypeDef): Record<string, Socket> {
  const black = suitBlack();
  const plates = armour();
  const web = webGrey();
  const { body, sockets } = clothedBody(m, sk, { suit: black, mass: 0.94, folds: 0.8, glove: leather(0x121214), bootMat: leather(0x0c0c0e) });
  const under = m.snapshot();
  // Soft armour cut close: a slim carrier, no pauldrons.
  cuirass(m, body, sk, plates, { off: 0.018, top: 1.46, bottom: 1.17, width: 0.15 });
  straps(m, under, web, 1.44);
  belt(m, sk, under, 1.03, web, darkSteel, { width: 0.024 });
  for (const s of BOTH) {
    pouch(m, surfaceHit(under, [s * 0.1, 1.1, 0.3], [0, 0, -1]), web, { bone: B.spine, size: [0.036, 0.046, 0.022] });
    pouch(m, surfaceHit(under, [s * 0.17, 0.97, 0.02], [-s, 0, 0]), web, { bone: B.hips, size: [0.026, 0.044, 0.032] });
    kneePad(m, body, sk, s, plates, 0.9);
    elbowPad(m, body, sk, s, plates);
    bracer(m, body, sk, s, plates);
  }
  // Holster on the right thigh, a grey strap round each.
  m.add(rbox(sk.on(B.thighR, B.shinR, 0.3, -0.086, 0, 0.01), [0.016, 0.075, 0.032], 0.012), plates, B.thighR, { rigid: true });
  for (const s of BOTH) {
    const { thigh, shin } = sk.legBones(s);
    m.add(cut(cyl(sk.on(thigh, shin, 0.4, 0, 0.012, 0), sk.on(thigh, shin, 0.4, 0, -0.012, 0), 0.094, 0.004), cyl(sk.on(thigh, shin, 0.4, 0, 0.03, 0), sk.on(thigh, shin, 0.4, 0, -0.03, 0), 0.084, 0.002)), web, thigh, { rigid: true });
  }
  // A collar that rises into the hood.
  m.add(cut(frustum(sk.p(B.neck, 0, -0.05, -0.005), sk.p(B.neck, 0, 0.06, -0.01), 0.11, 0.1, 0.008), cyl(sk.p(B.neck, 0, -0.1, 0), sk.p(B.neck, 0, 0.2, -0.01), 0.085, 0.003)), black, B.chest, { rigid: true });
  stripe(m, sk, def);
  bureauHead(m, sk, def);
  return sockets;
}

/** The same in heavy plate, broader: the machine gunner and the riot shield. */
export function bailiffHeavy(m: Model, sk: Sk, def: ArchetypeDef): Record<string, Socket> {
  const black = suitBlack();
  const plates = armour();
  const web = webGrey();
  const { body, sockets } = clothedBody(m, sk, { suit: black, mass: 1.18, folds: 0.7, glove: leather(0x121214), bootMat: leather(0x0c0c0e), handsL: 'grip' });
  const under = m.snapshot();
  const front = cuirass(m, body, sk, plates, { off: 0.028, top: 1.5, bottom: 1.1, width: 0.22 });
  for (let i = 0; i < 3; i++) groove(m, front, lineH(1.16 + i * 0.045, -0.16, 0.16, 0.1));
  straps(m, under, web, 1.48);
  belt(m, sk, under, 1.0, web, darkSteel, { width: 0.03, off: 0.026 });
  for (const s of BOTH) {
    pauldron(m, sk, s, plates, { size: 1.22, tiers: 1 });
    kneePad(m, body, sk, s, plates, 1.15);
    shinGuard(m, body, sk, s, plates);
    thighPlate(m, body, sk, s, plates);
    elbowPad(m, body, sk, s, plates);
    bracer(m, body, sk, s, plates);
    pouch(m, surfaceHit(under, [s * 0.12, 1.06, 0.3], [0, 0, -1]), web, { bone: B.spine, size: [0.042, 0.05, 0.028] });
  }
  // Gorget: the neck disappears into the plate.
  m.add(cut(frustum(sk.p(B.neck, 0, -0.06, -0.01), sk.p(B.neck, 0, 0.07, -0.005), 0.16, 0.115, 0.01), cyl(sk.p(B.neck, 0, -0.2, 0), sk.p(B.neck, 0, 0.2, 0), 0.088, 0.003)), plates, B.chest, { rigid: true });
  // The stripe runs down the left pauldron too.
  const { upper } = sk.armBones(1);
  m.paint(rbox(add(sk.pos[upper]!, [0.07, 0.06, 0]), [0.03, 0.04, 0.012], 0.004), { ...red(def), emissive: 0.55 }, 0.001);
  stripe(m, sk, def, 0.065);
  bureauHead(m, sk, def, 1.06);
  return sockets;
}
