/**
 * Downtown civilians and Press Corps NPCs for Mission: Deprecation (OpenMind HQ & Grand Boulevard).
 *
 * Distinct from combat soldiers and Bureau Bailiffs:
 *   - `civilian`: Unarmed downtown office commuter with sculpted face/hair, tailored camel/slate blazer,
 *     crisp light dress shirt & dark tie, charcoal slacks, belt, and leather shoes.
 *   - `press`: Broadcast journalist / field reporter with sculpted face/hair, dark urban jacket,
 *     high-visibility royal-blue PRESS flak vest with bright cyan/white PRESS patches, hanging chest
 *     press-pass lanyard badge, earpiece boom mic, and handheld ENG broadcast camera prop (`pressCam`).
 */
import type { ArchetypeDef } from '../../../src/characters/archetypes';
import type { Socket } from '../../../src/characters/format';
import type { Mat, Model } from '../model';
import { add, blend, capsule, cone, cut, cyl, ellipsoid, rbox, sphere, spline, strap, type V3 } from '../sdf';
import { buildBody, humanHead } from '../parts/body';
import { belt, boot, cuirass, feet, handsAndHead, headP, padOn, pouch, suit, surfaceHit } from '../parts/gear';
import { cloth, darkSteel, glow, leather, paintedMetal, rubber, skin, steel } from '../parts/materials';
import { standardSockets } from '../parts/sockets';
import { B, type Side, type Sk } from '../parts/skeleton';

const BOTH: readonly Side[] = [1, -1];

const warmSkin = (): Mat => ({ ...skin(), albedo: [0.56, 0.37, 0.27], rough: 0.72 });
const eyeDark: Mat = { albedo: [0.05, 0.05, 0.06], rough: 0.12, metal: 0.05, detail: 2 };
const hairDark = (hex = 0x261c15): Mat => cloth(hex, 0.18);
const dressShoe = () => leather(0x181513);

/** Sculpted modern short-cropped hair cap + eyebrows over a bare humanHead. */
function hairAndBrows(m: Model, sk: Sk, hairMat: Mat): void {
  const P = headP(sk);
  const hb = B.head;
  // Full hair volume over crown, back, and temples, trimmed cleanly off the face.
  const cap = blend(
    0.02,
    ellipsoid(P(0, 0.132, -0.022), [0.088, 0.088, 0.104]),
    ellipsoid(P(0, 0.158, 0.018), [0.078, 0.056, 0.082]),
    ellipsoid(P(0, 0.085, -0.055), [0.082, 0.072, 0.068]),
  );
  const faceCut = blend(
    0.02,
    ellipsoid(P(0, 0.055, 0.082), [0.095, 0.088, 0.085]),
    rbox(P(0, -0.04, 0.0), [0.14, 0.075, 0.14], 0.01),
  );
  m.add(cut(cap, faceCut, 0.012), hairMat, hb, { rigid: true });
  // Eyebrows
  for (const s of BOTH) {
    m.add(capsule(P(s * 0.018, 0.114, 0.098), P(s * 0.052, 0.112, 0.09), 0.0065), hairMat, hb, { rigid: true });
  }
}

/**
 * Unarmed downtown office commuter / bystander (`civilian`).
 * Tailored blazer & coat over light dress shirt and dark slacks — immediately readable as a non-combatant.
 */
export function civilian(m: Model, sk: Sk, _def: ArchetypeDef): Record<string, Socket> {
  const skinMat = warmSkin();
  const coatMat = cloth(0x7c7265, 0.16);
  const slacksMat = cloth(0x282d36, 0.14);
  const shirtMat = cloth(0xdce2ea, 0.08);
  const tieMat = cloth(0x253852, 0.12);

  buildBody(m, sk, { mass: 0.9, skin: skinMat, hands: 'open', handsL: 'open', feet: 'none' });
  humanHead(m, sk, skinMat, { eyeMat: eyeDark });
  hairAndBrows(m, sk, hairDark(0x2b2018));

  const body = m.snapshot();
  // Dark tailored slacks on lower body + blazer/coat on upper body.
  suit(m, body, slacksMat, { exclude: [...handsAndHead(sk), ...feet(sk)], folds: 0.65 });
  // Tailored blazer torso & sleeves (stops around mid-hip for clean jacket silhouette).
  const upperMask = rbox([0, 1.28, 0], [0.68, 0.36, 0.35], 0.02);
  m.add(padOn(body, 0.014, upperMask), coatMat, -1);

  const under = m.snapshot();
  // Open blazer V-neck showing crisp dress shirt + necktie on front chest.
  const vFront = cone([0, 1.32, 0.11], [0, 1.56, 0.11], 0.025, 0.082);
  m.paint(vFront, shirtMat, 0.004);
  m.add(rbox([0, 1.37, 0.115], [0.018, 0.115, 0.012], 0.005), tieMat, B.chest, { rigid: true });
  // Jacket collar & lapels framing the shirt.
  for (const s of BOTH) {
    m.add(
      capsule([s * 0.068, 1.53, 0.045], [s * 0.032, 1.33, 0.115], 0.018),
      coatMat,
      B.chest,
      { k: 0.008 },
    );
  }
  // Dress belt & buckle + low dress shoes.
  belt(m, sk, under, 1.0, leather(0x261d17), steel, { width: 0.02, off: 0.012 });
  for (const s of BOTH) {
    boot(m, sk, s, dressShoe());
  }

  return standardSockets(sk);
}

/**
 * Broadcast journalist / Press Corps member (`press`).
 * Royal-blue high-vis PRESS vest, bright white/cyan PRESS patches front & back, hanging press-pass lanyard,
 * headset boom mic, and rugged urban field-reporter gear.
 */
export function press(m: Model, sk: Sk, def: ArchetypeDef): Record<string, Socket> {
  const skinMat = warmSkin();
  const jacketMat = cloth(0x2c333e, 0.16);
  const cargoMat = cloth(0x3a3d42, 0.15);
  const pressBlue = cloth(0x1652c2, 0.14);
  const pressPatch = glow([def.accent[0], def.accent[1], def.accent[2]], 0.55);
  const badgeWhite: Mat = { albedo: [0.92, 0.95, 0.98], rough: 0.35, metal: 0.05, detail: 2 };
  const strapMat = cloth(0x1b1e24, 0.12);

  buildBody(m, sk, { mass: 0.94, skin: skinMat, hands: 'grip', handsL: 'open', feet: 'none' });
  humanHead(m, sk, skinMat, { eyeMat: eyeDark });
  hairAndBrows(m, sk, hairDark(0x1e1a18));

  // Broadcast headset earpiece & slim boom mic on left ear.
  const P = headP(sk);
  m.add(ellipsoid(P(0.088, 0.072, -0.002), [0.016, 0.026, 0.024]), darkSteel, B.head, { rigid: true });
  m.add(capsule(P(0.088, 0.062, 0.012), P(0.032, 0.018, 0.105), 0.0055), rubber, B.head, { rigid: true });
  m.add(sphere(P(0.028, 0.016, 0.108), 0.01), darkSteel, B.head, { rigid: true });

  const body = m.snapshot();
  suit(m, body, cargoMat, { exclude: [...handsAndHead(sk), ...feet(sk)], folds: 0.75 });
  m.add(padOn(body, 0.012, rbox([0, 1.32, 0], [0.68, 0.32, 0.35], 0.02)), jacketMat, -1);

  const under = m.snapshot();
  // Royal-blue PRESS flak/field vest over torso (unmistakable journalistic silhouette!).
  cuirass(m, body, sk, pressBlue, { off: 0.022, top: 1.48, bottom: 1.12, width: 0.165 });
  // Shoulder straps of the PRESS vest.
  for (const s of BOTH) {
    const a = surfaceHit(under, [s * 0.105, 1.47, 0.3], [0, 0, -1]);
    const c = surfaceHit(under, [s * 0.105, 1.47, -0.3], [0, 0, 1]);
    const top: V3 = [s * 0.115, 1.56, -0.008];
    m.add(
      strap(spline([add(a, [0, 0, 0.014]), top, add(c, [0, 0, -0.014])], 14), 0.044, 0.01, [0, 0, 1]),
      pressBlue,
      B.chest,
    );
  }

  // High-contrast bright cyan/white "PRESS" rectangular Velcro patches on BOTH front & back of vest!
  const frontPatch = surfaceHit(m.snapshot(), [0, 1.36, 0.3], [0, 0, -1]);
  const backPatch = surfaceHit(m.snapshot(), [0, 1.36, -0.3], [0, 0, 1]);
  m.add(rbox(add(frontPatch, [0, 0, 0.008]), [0.095, 0.032, 0.01], 0.004), pressPatch, B.chest, { rigid: true });
  m.add(rbox(add(backPatch, [0, 0, -0.008]), [0.115, 0.038, 0.01], 0.004), pressPatch, B.chest, { rigid: true });

  // Hanging press-pass credential badge on chest lanyard!
  const badgePos = surfaceHit(m.snapshot(), [0.04, 1.21, 0.3], [0, 0, -1]);
  m.add(rbox(add(badgePos, [0, 0, 0.012]), [0.036, 0.05, 0.007], 0.003), badgeWhite, B.chest, { rigid: true });
  m.paint(rbox(add(badgePos, [0, 0.025, 0.016]), [0.034, 0.014, 0.01], 0.001), pressPatch, 0.001);

  // Utility belt, audio recorder belt pack, and rugged field boots.
  belt(m, sk, under, 1.01, strapMat, paintedMetal(0x4a505a, 0.4, 0.6), { width: 0.024, off: 0.016 });
  pouch(m, surfaceHit(under, [-0.17, 1.0, 0.02], [1, 0, 0]), darkSteel, { bone: B.hips, size: [0.03, 0.048, 0.042] });
  pouch(m, surfaceHit(under, [0.17, 1.0, 0.02], [-1, 0, 0]), strapMat, { bone: B.hips, size: [0.032, 0.046, 0.036] });
  for (const s of BOTH) {
    boot(m, sk, s, leather(0x16171a));
  }

  return standardSockets(sk);
}
