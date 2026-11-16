/**
 * The Gimlet: a carbine on key 1 between the SMG and the Harrow. A flat-top upper on a lower with a curved thirty-round
 * magazine, a short skeleton handguard (see `handguard`) that bares the pencil barrel and its gas block, a collapsible stock on its buffer tube, an A2 birdcage. Black anodizing and
 * polymer, where the Harrow is parkerized and walnut. It is issued with an ACOG and a can (weapons/mods.ts), and can take a red dot
 * in the ACOG's place and an M203-style launcher under the handguard. Its flip-up irons show only with no optic on.
 * Origin at the top of the grip.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Finish, Mesher } from '../kit/mesher';
import { curve, poly, rect, type P2, type V2 } from '../kit/shapes';
import { hexX, knurl, screwX, serrations } from '../kit/details';
import { damp } from '../../../core/math';
import { bump, hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import { fill, pullTrigger } from './common';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { OPTIC_GLOWS, acog, acogShade, redDot } from './optics';

const BORE = 0.046;
/** The top of the rail, which runs from the back of the upper to the front of the handguard. */
const RAIL = 0.082;
const RAIL_BACK = 0.104;
const RAIL_FRONT = -0.31;
const GUARD_REAR = -0.15;
const GUARD_FRONT = -0.322;
/** The low gas block on the bare barrel ahead of the handguard. */
const GAS = -0.352;
/** The front post's clamp, at the end of the rail. */
const POST = RAIL_FRONT + 0.009;
const HIDER = -0.528;
const MUZZLE = -0.578;
/** The short barrel's: its muzzle level with the launcher's, so the two still fit together. */
const HIDER_S = -0.446;
const MUZZLE_S = -0.482;
/** The irons' line, front post to rear aperture: level. */
const IRONS = 0.106;
/** Where an optic clamps on the rail, over the port. */
const OPTIC_AT = [0, RAIL, -0.01] as const;
/** The launcher hangs under the handguard: its bore and muzzle. */
const GL_Y = -0.006;
const GL_MUZZLE = -0.476;

function upper(m: Mesher): void {
  m.use(F.anodized);
  m.side(poly([[RAIL_BACK, 0.03], [RAIL_BACK, 0.072, 0.003], [GUARD_REAR, 0.072], [GUARD_REAR, 0.03]], 0.002), 0.031, { bevel: 0.0016 });
  // The forward assist and the port's dust cover on the right, the case deflector behind it.
  m.at([0.019, 0.058, 0.07], [0, Math.PI / 2, 0], () => m.cyl(0.0058, 0.012, 14));
  m.at([0.0248, 0.058, 0.07], [0, Math.PI / 2, 0], () => knurl(m, 0.0062, 0.003, F.anodized, 16, 0.0005));
  m.use(F.steelDark);
  m.at([0.0158, 0.052, -0.012], null, () => m.box(0.0012, 0.018, 0.064, 0.0004));
  m.use(F.anodized);
  m.at([0.0168, 0.062, 0.03], null, () => m.box(0.004, 0.008, 0.014, 0.0012));
  m.at([-0.0158, 0.048, -0.02], [0, -Math.PI / 2, 0], () => m.decal('gimlet', 0.064, 0.0128, 0xb9bec4));
  m.at([-0.0158, 0.037, -0.09], [0, -Math.PI / 2, 0], () => m.decal('cal556', 0.044, 0.0068, 0x9aa0a6));

  // The rail, the length of the gun, with its cross slots.
  m.use(F.anodized);
  const mid = (RAIL_BACK + RAIL_FRONT) / 2;
  const half = (RAIL_BACK - RAIL_FRONT) / 2;
  m.at([0, RAIL - 0.008, mid], null, () => m.top(rect(-0.0105, -half, 0.0105, half, 0.0015), 0.008, { bevel: 0.0012 }));
  m.use(F.black);
  for (let z = RAIL_BACK - 0.008; z > RAIL_FRONT + 0.004; z -= 0.01) m.at([0, RAIL + 0.0001, z], null, () => m.box(0.021, 0.0012, 0.0042, 0));
}

function lower(m: Mesher): void {
  m.use(F.anodized);
  m.side(poly([[0.1, 0.03], [0.1, 0.006, 0.004], [0.07, -0.004, 0.004], [-0.038, -0.004], [-0.043, -0.03, 0.003], [-0.128, -0.03, 0.003], [-0.134, 0.004, 0.004], [-0.14, 0.03]], 0.002), 0.029, { bevel: 0.0016 });
  // The flared magwell lip and the mag release on the right.
  m.at([0, -0.03, -0.085], null, () => m.box(0.033, 0.004, 0.092, 0.0012, 0.002));
  m.use(F.steelDark);
  m.at([0.016, -0.012, -0.034], [0, Math.PI / 2, 0], () => m.cyl(0.0048, 0.004, 12));
  m.part('selector', [-0.0158, 0.012, 0.062], () => {
    m.use(F.steelDark);
    m.at([0, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.0052, 0.003, 12));
    m.at([-0.0016, 0.0, -0.009], null, () => m.box(0.0026, 0.0044, 0.018, 0.0008));
  });
  m.at([-0.0148, 0.0045, 0.062], [0, -Math.PI / 2, 0], () => m.decal('fire', 0.024, 0.0045, 0xd8d8d8));
  m.mirror(() => {
    screwX(m, 0.0146, 0.018, 0.088, 1, 0.0022);
    screwX(m, 0.0146, 0.018, -0.13, 1, 0.0022);
  });
  // The trigger guard.
  m.use(F.anodized);
  const guardOut = poly([[-0.036, -0.0035], [-0.04, -0.03, 0.006], [-0.024, -0.041, 0.008], [0.03, -0.041, 0.008], [0.05, -0.012, 0.004], [0.05, -0.004]], 0.002);
  const guardIn = poly([[-0.032, -0.0055], [-0.035, -0.028, 0.005], [-0.022, -0.0375, 0.005], [0.027, -0.0375, 0.005], [0.045, -0.0115, 0.003], [0.045, -0.0055]], 0.002);
  m.side(guardOut, 0.012, { bevel: 0.0009, holes: [guardIn] });
}

function furniture(m: Mesher): void {
  // A polymer pistol grip with a stippled face.
  const front = curve([[0.02, 0.002], [0.021, -0.022], [0.027, -0.04], [0.03, -0.058], [0.037, -0.078], [0.044, -0.098], [0.047, -0.114]], 4);
  const back = curve([[0.103, -0.114], [0.097, -0.08], [0.088, -0.046], [0.083, -0.02], [0.076, 0.002]], 4);
  m.use(F.polymerStipple);
  m.side([...front, [0.048, -0.12], [0.101, -0.12], ...back], 0.03, { bevel: 0.0045, smooth: 50 });
  m.use(F.polymer);
  m.at([0, -0.1225, 0.075], null, () => m.box(0.03, 0.005, 0.056, 0.0013, 0.003));

  handguard(m);
  // The barrel nut ring where the guard meets the upper.
  m.use(F.anodizedGrey);
  m.at([0, BORE, GUARD_REAR + 0.003], null, () => m.cyl(0.021, 0.006, 24));

  // The stock on its buffer tube: a polymer shell with a cheek riser and a rubber butt.
  m.use(F.anodized);
  m.at([0, 0.048, 0.2], null, () => m.cyl(0.0142, 0.2, 20));
  m.use(F.polymer);
  // Low at the front, where an eye behind a red dot looks over it.
  m.side(poly([[0.21, 0.062], [0.21, 0.026], [0.33, -0.002, 0.008], [0.352, -0.004, 0.006], [0.352, 0.074, 0.008], [0.27, 0.066, 0.02]], 0.004), 0.042, { bevel: 0.006, smooth: 50 });
  m.use(F.polymerGrey);
  m.at([0, 0.016, 0.27], null, () => m.box(0.012, 0.012, 0.03, 0.002, 0.003));
  m.use(F.rubber);
  m.at([0, 0.035, 0.358], null, () => m.box(0.042, 0.082, 0.012, 0.004, 0.006));
}

/** Burnt-orange hard anodizing on the handguard's armour, against the black gun. */
const ACCENT: Finish = { color: 0xc4561c, rough: 0.38, metal: 0.5, wear: 0.6 };

/**
 * A short skeleton handguard that stops well back of the muzzle, so the pencil barrel and its gas block show. Two side plates
 * in burnt-orange anodizing, with a raked nose and big forward-leaning cuts the barrel shows through, under a black faceted spine
 * and the rail. Asymmetric: the left (the side you see) carries a black armour plate and a cyan line inset the length of the
 * guard; the right a heat sink.
 */
function handguard(m: Mesher): void {
  const R = GUARD_REAR;
  const N = GUARD_FRONT;
  // Side profile (z, y): flat under the launcher's clamp, then raked up into a chisel nose.
  const plate = poly([[R, 0.06], [N + 0.02, 0.06, 0.003], [N, 0.05, 0.002], [N, 0.038, 0.002], [N + 0.03, 0.024, 0.004], [R, 0.024]], 0.0015);
  const lean = (z: number, len: number, y0 = 0.03, y1 = 0.053): P2[] => [[z, y0], [z - len, y0], [z - len - 0.008, y1], [z - 0.008, y1]];
  const cuts = [lean(-0.198, 0.03), lean(-0.238, 0.03), lean(-0.278, 0.012, 0.034)].map(c => poly(c, 0.0022));
  m.use(ACCENT);
  m.mirror(() => m.at([0.0215, 0, 0], null, () => m.side(plate, 0.004, { bevel: 0.0009, holes: cuts })));
  // The faceted spine under the rail, and the floor.
  m.use(F.anodized);
  const spine = poly([[-0.0125, 0.0745], [0.0125, 0.0745], [0.0236, 0.065], [0.0236, 0.0575], [-0.0236, 0.0575], [-0.0236, 0.065]], 0.0012);
  m.at([0, 0, (R + RAIL_FRONT) / 2], null, () => m.front(spine, R - RAIL_FRONT + 0.002, { bevel: 0.0018 }));
  m.at([0, 0.0255, 0], null, () => m.top(rect(-0.0196, N + 0.03, 0.0196, R, 0.002), 0.003, { bevel: 0.0008 }));

  // The nose: a faceted collar capping the plates round the barrel, bolted through them.
  const collar = poly([[-0.012, 0.033], [0.012, 0.033], [0.0228, 0.041], [0.0228, 0.053], [0.013, 0.061], [-0.013, 0.061], [-0.0228, 0.053], [-0.0228, 0.041]], 0.0015);
  m.use(F.anodized);
  m.at([0, 0, N - 0.001], null, () => m.front(collar, 0.008, { bevel: 0.0014, holes: [poly([[-0.0075, BORE - 0.0105], [0.0075, BORE - 0.0105], [0.0112, BORE], [0.0075, BORE + 0.0105], [-0.0075, BORE + 0.0105], [-0.0112, BORE]], 0.002)] }));
  m.mirror(() => hexX(m, 0.0235, 0.045, N + 0.012, 1, 0.0026));

  // Left: a black armour plate, its front raked like the cuts, held by four exposed screws.
  m.use(F.anodized);
  m.at([-0.0252, 0, 0], null, () => m.side(poly([[R - 0.003, 0.0275], [R - 0.003, 0.0535], [-0.198, 0.0535, 0.004], [-0.19, 0.0275, 0.003]], 0.002), 0.0034, { bevel: 0.0011 }));
  m.use(F.black);
  m.at([-0.0268, 0.0405, -0.174], [0, -Math.PI / 2, 0], () => m.decal('serial', 0.026, 0.0034, 0x8f949a));
  for (const [y, z] of [[0.031, -0.157], [0.05, -0.157], [0.031, -0.188], [0.05, -0.198]] as const) screwX(m, -0.0269, y, z, -1, 0.0017);
  // The line: a cyan strip in a black channel along the top of the plate, stepping down with the nose.
  const strip = (h: number): P2[] => [[R - 0.008, 0.0566 + h], [N + 0.026 - h, 0.0566 + h], [N + 0.012 - h, 0.0496 + h], [N + 0.012 + h, 0.0496 - h], [N + 0.026 + h, 0.0566 - h], [R - 0.008, 0.0566 - h]];
  m.use(F.black);
  m.at([-0.0236, 0, 0], null, () => m.side(poly(strip(0.0017), 0.0006), 0.0008, { bevel: 0.0002 }));
  m.glow('guard', () => m.at([-0.0241, 0, 0], null, () => m.side(poly(strip(0.0008), 0.0003), 0.0006, { bevel: 0 })));

  // Right: a heat sink of fins over a black pocket.
  m.use(F.black);
  m.at([0.0238, 0.0405, -0.174], null, () => m.box(0.0012, 0.024, 0.038, 0.0004));
  m.use(F.anodizedGrey);
  for (let i = 0; i < 7; i++) m.at([0.0252, 0.0405, -0.157 - i * 0.0055], null, () => m.box(0.0034, 0.022, 0.0018, 0.0005));
}

/** The gas block on the bare barrel, and its tube running back under the spine. */
function gasBlock(m: Mesher): void {
  m.use(F.barrelBlack);
  m.at([0, 0, GAS], null, () => m.front(poly([[-0.0118, BORE - 0.0128], [0.0118, BORE - 0.0128], [0.0128, BORE + 0.006], [0.0072, 0.067], [-0.0072, 0.067], [-0.0128, BORE + 0.006]], 0.002), 0.016, { bevel: 0.0014 }));
  m.mirror(() => m.at([0.0128, BORE - 0.004, GAS], [0, Math.PI / 2, 0], () => m.cyl(0.0022, 0.0016, 10)));
  m.use(F.steelDark);
  m.at([0, 0.0615, (GAS + GUARD_FRONT + 0.01) / 2], null, () => m.cyl(0.0024, GUARD_FRONT + 0.01 - GAS, 10));
}

function barrel(m: Mesher): void {
  m.at([0, BORE, 0], null, () => {
    m.use(F.barrel);
    // Breech to the gas block, which both barrels share; the rest is the long barrel's part or the short one's.
    m.lathe([[0.0102, GUARD_REAR, 0], [0.0102, GAS + 0.004], [0.0092, GAS], [0.0092, GAS - 0.01, 0]], 20);
  });
  m.part('barrel', [0, BORE, 0], () => {
    m.use(F.barrel);
    m.lathe([[0.0092, GAS - 0.006, 0], [0.0092, HIDER, 0]], 20);
    // The A2 birdcage: a sleeve with slots on the top and sides and a closed bottom, so the muzzle does not kick up dust.
    m.use(F.barrelBlack);
    m.lathe([[0.0092, HIDER + 0.002, 0], [0.0112, HIDER], [0.0112, MUZZLE + 0.004], [0.0098, MUZZLE], [0.0058, MUZZLE, 0]], 20);
    m.use(F.black);
    for (const a of [-1.1, -0.4, 0.4, 1.1]) {
      m.at([Math.sin(a) * 0.011, Math.cos(a) * 0.011, (HIDER + MUZZLE) / 2], [0, 0, -a], () => m.box(0.0028, 0.0012, 0.03, 0));
    }
    m.lathe([[0.0058, MUZZLE + 0.0005, 0], [0.0052, MUZZLE + 0.03, 0], [0, MUZZLE + 0.031, 0]], 14);
  });
}

/**
 * The shop's short barrel (`gimletShort`): cut back to the launcher's mouth, so a hand's width less pencil barrel shows ahead
 * of the gas block. A burnt-orange jam nut, the handguard's colour, then a stubby four-prong hider the can threads over.
 */
function shortBarrel(m: Mesher): void {
  m.part('shortBarrel', [0, BORE, 0], () => {
    m.use(F.barrel);
    m.lathe([[0.0092, GAS - 0.006, 0], [0.0092, HIDER_S, 0]], 20);
    m.use(ACCENT);
    m.lathe([[0.0092, HIDER_S + 0.008, 0], [0.0118, HIDER_S + 0.0075], [0.0122, HIDER_S + 0.004], [0.0122, HIDER_S + 0.001], [0.0092, HIDER_S, 0]], 6);
    m.use(F.barrelBlack);
    m.lathe([[0.0092, HIDER_S + 0.001, 0], [0.0108, HIDER_S], [0.0108, MUZZLE_S + 0.016], [0.0102, MUZZLE_S + 0.012]], 20);
    // Four prongs, the slots between them open to the muzzle.
    for (let i = 0; i < 4; i++) {
      m.at([0, 0, MUZZLE_S + 0.006], [0, 0, (i / 4) * Math.PI * 2 + Math.PI / 4], () => {
        const p: V2[] = [];
        const sweep = 0.55;
        for (let k = 0; k <= 6; k++) { const t = -sweep + (k / 6) * sweep * 2; p.push([Math.cos(t) * 0.0102, Math.sin(t) * 0.0102]); }
        for (let k = 6; k >= 0; k--) { const t = -sweep + (k / 6) * sweep * 2; p.push([Math.cos(t) * 0.0064, Math.sin(t) * 0.0064]); }
        m.prism(p, 0.012, { bevel: 0.0007, smooth: 30 });
      });
    }
    m.use(F.black);
    m.lathe([[0.0064, MUZZLE_S + 0.012, 0], [0.0052, MUZZLE_S + 0.03, 0], [0, MUZZLE_S + 0.031, 0]], 14);
  });
}

/** Flip-up irons on the rail, up: shown only with no optic fitted (`clip`). */
function irons(m: Mesher): void {
  m.part('irons', [0, RAIL, 0], () => {
    m.use(F.anodized);
    // Front: a hooded post on a clamp at the end of the rail.
    m.at([0, 0.004, POST], null, () => {
      m.box(0.02, 0.008, 0.016, 0.0012);
      m.mirror(() => m.at([0.0075, 0.012, 0], null, () => m.box(0.0028, 0.018, 0.01, 0.0008)));
      m.at([0, 0.0175, 0], null, () => m.box(0.0018, 0.008, 0.0016, 0.0004));
    });
    // Rear: an aperture on a clamp at the back.
    m.at([0, 0.004, 0.088], null, () => {
      m.box(0.02, 0.008, 0.016, 0.0012);
      m.at([0, 0.0095, 0], null, () => m.box(0.016, 0.012, 0.004, 0.001));
      m.at([0, IRONS - RAIL - 0.004, 0], null, () => m.pipe(0.0062, 0.0026, 0.004, 16));
    });
  });
}

/** The shop's suppressor: a long can over the birdcage, its mouth the muzzle while it is on. */
const CAN_END = -0.71;
const CAN_AT = HIDER + 0.012;

function suppressor(m: Mesher): void {
  m.part('can', [0, BORE, CAN_AT], () => {
    m.use(F.anodized);
    m.lathe([[0.0118, 0.004, 0], [0.0152, 0.004], [0.0152, -0.012], [0.0192, -0.019], [0.0195, -0.182], [0.0172, -0.19], [0.0064, -0.194, 0]], 26);
    m.at([0, 0, -0.004], null, () => knurl(m, 0.0155, 0.014, F.steelDark, 22, 0.0005));
    m.use(F.steelDark);
    for (const z of [-0.035, -0.11, -0.175]) m.at([0, 0, z], null, () => m.cyl(0.0198, 0.003, 26));
    m.use(F.black);
    m.lathe([[0.0064, -0.1935, 0], [0.005, -0.198, 0], [0, -0.1985, 0]], 14);
    m.at([-0.0195, 0, -0.1], [0, -Math.PI / 2, 0], () => m.decal('serial', 0.05, 0.0055, 0x8f949a));
  });
}

/**
 * The shop's under-barrel launcher, M203-style: a receiver clamped under the handguard with its own trigger and guard, and a
 * barrel that slides forward to take a round (`glTube`). The round the hand brings is `glRound`.
 */
function launcher(m: Mesher): void {
  m.part('gl', [0, GL_Y, GUARD_REAR - 0.03], () => {
    m.use(F.anodized);
    // Receiver, with the clamp up into the handguard.
    m.at([0, 0.002, -0.03], null, () => m.box(0.042, 0.034, 0.075, 0.003, 0.004));
    m.at([0, 0.022, -0.05], null, () => m.box(0.03, 0.01, 0.11, 0.0016, 0.002));
    // Its trigger and the strap guard round it.
    m.use(F.steelDark);
    m.at([0, -0.026, -0.008], [0.25, 0, 0], () => m.box(0.005, 0.016, 0.005, 0.0008));
    m.use(F.anodized);
    const out = poly([[0.016, -0.014], [0.016, -0.04, 0.004], [-0.03, -0.04, 0.006], [-0.03, -0.014]], 0.002);
    const inn = poly([[0.012, -0.016], [0.012, -0.036, 0.003], [-0.026, -0.036, 0.004], [-0.026, -0.016]], 0.002);
    m.side(out, 0.01, { bevel: 0.0008, holes: [inn] });
    m.part('glTube', [0, 0, -0.068], () => {
      m.use(F.anodized);
      m.lathe([[0.0205, 0.004, 0], [0.0232, 0.002], [0.0232, -0.2], [0.0245, -0.205], [0.0245, -0.222], [0.0205, -0.226], [0.0205, 0.004, 0]], 28);
      m.use(F.black);
      m.at([0, 0, -0.11], null, () => m.cyl(0.0206, 0.2, 20, 0));
      // Grip grooves along its belly, where the off hand holds it.
      m.use(F.anodizedGrey);
      for (let i = 0; i < 6; i++) m.at([0, -0.0234, -0.07 - i * 0.016], null, () => m.box(0.022, 0.0016, 0.006, 0.0006));
    });
  });
  // A 40 mm round: a short aluminium case and a gold nose. Shown in the hand on a reload.
  m.part('glRound', [0, GL_Y, GUARD_REAR - 0.1], () => {
    m.use(F.anodizedGrey);
    m.lathe([[0, 0.002, 0], [0.0205, 0.002], [0.0205, -0.04], [0, -0.04, 0]], 20);
    m.use(F.yellow);
    m.lathe([[0, -0.04, 0], [0.0195, -0.04], [0.0185, -0.055], [0.012, -0.068], [0, -0.072, 0]], 20);
  });
}

function magazine(m: Mesher): void {
  // A polymer thirty-rounder that curves forward. Part space: origin at the mouth of the well.
  m.part('mag', [0, -0.012, -0.086], () => {
    m.at([0, 0, 0], [-0.06, 0, 0], () => {
      m.use(F.polymer);
      const back = curve([[0.03, 0.026], [0.029, -0.06], [0.02, -0.12], [0.002, -0.175]], 4);
      const front = curve([[-0.064, -0.162], [-0.046, -0.11], [-0.035, -0.05], [-0.032, 0.026]], 4);
      m.side([...back, ...front], 0.022, { bevel: 0.0016, smooth: 40 });
      // Ribs across its back and the floor plate.
      m.use(F.polymerGrey);
      m.mirror(() => {
        for (let i = 0; i < 3; i++) m.at([0.0112, -0.08 - i * 0.022, 0.004 + i * 0.005], [0.2 + i * 0.07, 0, 0], () => m.box(0.0012, 0.004, 0.034, 0.0004));
      });
      m.use(F.polymer);
      m.at([0, -0.172, -0.031], [0.36, 0, 0], () => m.box(0.026, 0.006, 0.07, 0.0016, 0.003));
      // The top round.
      m.use(F.brass);
      m.at([0, 0.0285, 0.004], null, () => m.cyl(0.0048, 0.044, 12));
      m.use(F.copper);
      m.at([0, 0.0285, -0.024], null, () => m.lathe([[0.0029, 0.003, 0], [0.0025, -0.006], [0.001, -0.013], [0, -0.0145, 0]], 12, { chamfer: 0 }));
      m.part('follower', [0, 0.022, 0], () => {
        m.use(F.polymerGrey);
        m.box(0.018, 0.004, 0.058, 0.0008);
      });
    });
  });
}

interface Built { model: Model; mods: ViewDef['mods'] }

function buildGimlet(kit: Kit): Built {
  const m = kit.mesher();
  m.bevel = 0.0014;
  upper(m);
  lower(m);
  furniture(m);
  barrel(m);
  shortBarrel(m);
  gasBlock(m);
  irons(m);
  magazine(m);
  suppressor(m);
  launcher(m);
  const dot = redDot(m, OPTIC_AT);
  const scope = acog(m, OPTIC_AT);

  m.part('bolt', [0.0162, 0.052, -0.012], () => {
    m.use(F.steel);
    m.box(0.003, 0.014, 0.05, 0.0008);
  });
  // The T-handle at the back of the upper, which the hand racks on a reload from empty.
  m.part('charge', [0, 0.066, RAIL_BACK + 0.004], () => {
    m.use(F.anodized);
    m.box(0.012, 0.006, 0.016, 0.0012);
    m.at([0, 0, 0.008], null, () => m.box(0.036, 0.007, 0.007, 0.0016));
    m.use(F.steelDark);
    m.at([-0.016, 0.0, 0.009], null, () => serrations(m, 3, 0.004, 0.0006, 0.006, 0.0008, F.steelDark));
  });
  m.part('trigger', [0, -0.006, -0.002], () => {
    m.use(F.steelDark);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0038, -0.0225, 0.0015], [0.0005, -0.0235, 0.001], [-0.0035, -0.0095, 0.003]], 0.001), 0.0062, { bevel: 0.0007 });
  });

  const model = new Model(m, kit.mats, { glows: { sight: [0x7dff5a, 6], guard: [0x2ff0d0, 4], ...OPTIC_GLOWS } });
  acogShade(model);
  model.socket('muzzle', [0, BORE, MUZZLE - 0.004]);
  // On the can, so it goes back with it onto the short barrel.
  model.socket('muzzleCan', [0, 0, CAN_END - CAN_AT], [0, 0, 0], 'can');
  model.socket('muzzleShort', [0, BORE, MUZZLE_S - 0.004]);
  // The launcher's mouth: its shot is fired as barrel 1 (Weapons.shootGun).
  model.socket('muzzle1', [0, GL_Y, GL_MUZZLE]);
  model.socket('eject', [0.02, 0.054, -0.012]);
  model.hand('gripR', [0.018, -0.054, 0.072], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.support('gripL', [-0.001, 0.016, -0.25]);
  // With the launcher on, the off hand holds its barrel, its fingers under the belly.
  model.support('glHold', [-0.001, GL_Y - 0.03, -0.29]);
  model.hand('glBreech', [-0.022, GL_Y - 0.01, GUARD_REAR - 0.12], [-0.5, -0.2, -0.8], [0.8, -0.3, -0.5]);
  model.hand('magHold', [-0.02, -0.07, -0.004], [-0.3, 0.1, -0.95], [0.9, -0.1, -0.35], 'mag');
  model.hand('chargeHold', [-0.02, 0.0, 0.006], [-0.5, -0.2, -0.8], [0.8, -0.3, -0.5], 'charge');
  return { model, mods: { gimletAcog: scope, gimletDot: dot, gimletCan: { part: 'can', muzzle: 'muzzleCan' }, gimletGl: { part: 'gl' },
    // After the can, so with both on the flash leaves the can's mouth, and the can comes back onto the stub.
    gimletShort: { part: 'shortBarrel', hides: 'barrel', muzzle: 'muzzleShort', moves: { part: 'can', z: HIDER_S - HIDER } } } };
}

const BOLT_TRAVEL = 0.05;
/** How far the launcher's barrel slides forward to take a round. */
const GL_SLIDE = 0.085;
/** 0 rifle, 1 launcher up: eased, so the gun rolls over onto it. Module state, as there is one Gimlet in the hands. */
let raised = 0;

function clip(a: Anim): void {
  const P = a.parts;
  const mods = a.mods;
  const gl = mods?.has('gimletGl') === true;
  P.glRound!.visible = false;
  raised = damp(raised, a.alt ? 1 : 0, 12, a.dt);

  if (!a.alt) {
    const cycle = 0.06;
    const c = a.sinceFire < cycle ? a.sinceFire / cycle : 1;
    P.bolt!.position.z += Math.sin(c * Math.PI) * BOLT_TRAVEL;
    pullTrigger(a, 0.06, 0.3);
  }
  P.follower!.position.y -= fill(a) * 0.12;
  a.glow('sight', 1);

  // Up on the launcher: the gun rolls onto its right side toward the middle and its muzzle lifts, so the tube under it is seen
  // and the round arcs.
  a.gunR.x += raised * 0.12;
  a.gunR.z -= raised * 0.42;
  a.gunP.x -= raised * 0.04;
  a.gunP.y += raised * 0.012;
  if (gl) a.left.to('glHold', 1);

  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.06;
    a.gunR.x -= k * 0.5;
    a.gunR.z -= k * 0.2;
  }

  const p = a.reload;
  if (p < 0) return;
  if (a.alt) {
    launcherReload(a, p);
    return;
  }
  // Foley: out at 0.05, in at 0.55, bolt at 0.82.
  const out = seg(p, 0.05, 0.22);
  const inn = seg(p, 0.4, 0.56);
  const mag = P.mag!;
  const away = inQuad(out) * (1 - outCubic(inn));
  mag.rotation.x -= Math.min(1, away * 3) * 0.2;
  mag.position.y -= away * 0.36;
  mag.position.z -= away * 0.03;
  if (p > 0.24 && p < 0.38) mag.visible = false;
  const seat = p >= 0.555 ? thud(seg(p, 0.555, 0.68)) : 0;
  const rack = bump(p, 0.76, 0.9);
  P.charge!.position.z += rack * 0.07;
  P.bolt!.position.z += rack * BOLT_TRAVEL;

  const present = hold(p, 0.0, 0.14, 0.88, 1);
  a.gunR.z -= present * 0.38 + seat * 0.04;
  a.gunR.x += present * 0.14 + seat * 0.06 - rack * 0.05;
  a.gunR.y += present * 0.05;
  a.gunP.x -= present * 0.035;
  a.gunP.y += present * 0.03 + seat * 0.014;
  a.gunP.z += present * 0.05 + rack * 0.015;

  const h = a.left;
  h.fingerRate = 38;
  h.to('magHold', inOut(seg(p, 0.0, 0.07)));
  h.to('pouchL', inOut(seg(p, 0.2, 0.32)));
  h.to('magHold', inOut(seg(p, 0.38, 0.48)));
  h.to('chargeHold', inOut(seg(p, 0.66, 0.75)));
  h.to(gl ? 'glHold' : 'gripL', inOut(seg(p, 0.92, 1)));
  h.shape(HANDS.cup, hold(p, 0.01, 0.07, 0.6, 0.66));
  h.shape(HANDS.pinch, hold(p, 0.7, 0.75, 0.9, 0.94));
}

/** The launcher's: the barrel forward, the empty case out, a round from the pouch into the breech, the barrel home. */
function launcherReload(a: Anim, p: number): void {
  const P = a.parts;
  // Foley: open at 0.06, the round in at 0.5, shut at 0.8.
  const open = outCubic(seg(p, 0.06, 0.2)) * (1 - inQuad(seg(p, 0.74, 0.84)));
  P.glTube!.position.z -= open * GL_SLIDE;
  const round = P.glRound!;
  round.visible = p > 0.3 && p < 0.56;
  const push = seg(p, 0.38, 0.52);
  round.position.y -= (1 - push) * 0.05;
  round.position.z += (1 - push) * 0.03;
  a.gunR.z -= hold(p, 0, 0.12, 0.86, 1) * 0.2;
  a.gunR.x += hold(p, 0, 0.12, 0.86, 1) * 0.08;
  const h = a.left;
  h.fingerRate = 38;
  h.to('glHold', 1);
  h.to('pouchL', inOut(seg(p, 0.2, 0.3)));
  h.to('glBreech', inOut(seg(p, 0.34, 0.44)));
  h.to('glHold', inOut(seg(p, 0.66, 0.76)));
  h.shape(HANDS.pinch, hold(p, 0.28, 0.34, 0.52, 0.58));
}

export function gimletDef(kit: Kit): ViewDef {
  const { model, mods } = buildGimlet(kit);
  return {
    id: 'gimlet',
    model,
    pos: [0.135, -0.13, -0.42],
    rot: [0.022, 0.08, 0],
    // ADS with no optic: the post through the aperture, level. An optic brings its own (`mods`).
    sight: [0, IRONS, POST], rear: [0, IRONS, 0.088], relief: 0.6,
    recoil: { back: 0.028, lift: 0.002, pitch: 0.011, yaw: 0.006, roll: 0.009, omega: 46, zeta: 0.58 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.support },
    heatPerShot: 0.01,
    mods,
    irons: 'irons',
    animate: clip,
  };
}
