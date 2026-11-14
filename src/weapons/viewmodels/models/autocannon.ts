/**
 * Key 4's two guns. They share nothing on the outside any more (owner, 2026-11-14):
 *
 * - The autocannon is a shoulder-fired 20 mm-class cannon: a slab of a receiver, a clip of three big rounds standing in
 *   the top of it like a Bofors gun's, a sight off on the left flank, and a long-recoil barrel that slams back into the
 *   receiver through a coil spring and a buffer on every shot.
 * - The Sabot is a slim anti-armour sniper rifle: a narrow receiver, a long fluted barrel out of a free-float handguard,
 *   a long scope, and its fin-stabilised darts stacked in an open side magazine on the left.
 *
 * Origin at the top of the grip on both, so the right hand sits the same.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Finish, Mesher } from '../kit/mesher';
import { circle, curve, ngon, poly, rect, slot, slotRow, type V2 } from '../kit/shapes';
import { coil, hexX, knurl, rail, rivet, screwX } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { drawCount, pullTrigger } from './common';

const AP_BLUE: Finish = { color: 0x1d4f93, rough: 0.42, metal: 0.1, wear: 0.9 };

// --- Rounds ---------------------------------------------------------------------------------------

/** A fin-stabilised dart in its sabot, lying along Z with its head at +Z. */
function dart(m: Mesher): void {
  m.use(F.brass);
  m.lathe([[0, 0.1, 0], [0.0165, 0.1], [0.0165, 0.094], [0.0148, 0.092], [0.015, 0.088], [0.0152, -0.012], [0.0128, -0.028], [0.0118, -0.03, 0]], 18, { chamfer: 0.0006 });
  m.use(AP_BLUE);
  m.lathe([[0.0118, -0.03, 0], [0.0118, -0.05], [0.0126, -0.052], [0.0126, -0.062], [0.0106, -0.066], [0.0062, -0.07, 0]], 18, { chamfer: 0.0004 });
  m.use({ color: 0x565a60, rough: 0.3, metal: 1, wear: 0.1 });
  m.lathe([[0.0046, -0.07, 0], [0.0046, -0.1], [0.0026, -0.116], [0, -0.122, 0]], 12, { chamfer: 0 });
  // Fins at the tail of the rod, where the sabot petals end.
  m.use({ color: 0x565a60, rough: 0.3, metal: 1, wear: 0.1 });
  for (let i = 0; i < 4; i++) m.at([0, 0, -0.074], [0, 0, (i * Math.PI) / 2 + Math.PI / 4], () => m.at([0.0068, 0, 0], null, () => m.box(0.005, 0.0009, 0.009, 0.0002)));
}

/** A high-explosive cannon round lying along Z with its head at +Z. */
function shell(m: Mesher): void {
  m.use(F.brass);
  m.lathe([[0, 0.1, 0], [0.0165, 0.1], [0.0165, 0.094], [0.0148, 0.092], [0.015, 0.088], [0.0152, -0.012], [0.0128, -0.028], [0.0118, -0.03, 0]], 18, { chamfer: 0.0006 });
  m.use({ color: 0x2d2f33, rough: 0.5, metal: 0.4, wear: 0.4 });
  m.lathe([[0.0118, -0.03, 0], [0.0118, -0.042], [0.0124, -0.044], [0.0124, -0.052], [0.0118, -0.054], [0.0112, -0.08], [0.0085, -0.098, 0]], 18, { chamfer: 0.0004 });
  m.use(F.yellow);
  m.lathe([[0.0085, -0.098, 0], [0.0055, -0.11], [0.0022, -0.119], [0, -0.12, 0]], 18, { chamfer: 0 });
}

/** Pistol grip, trigger guard and the housing they hang from. Both guns, so the right hand sits the same on each. */
function lower(m: Mesher): void {
  m.use(F.parkerized);
  m.side(poly([[0.11, 0.006], [0.106, -0.012, 0.006], [0.088, -0.018, 0.006], [-0.05, -0.018, 0.006], [-0.056, 0.006]], 0.003), 0.052, { bevel: 0.002 });
  m.use(F.polymerStipple);
  const front = curve([[0.02, -0.016], [0.021, -0.04], [0.028, -0.062], [0.036, -0.084], [0.044, -0.116]], 4);
  const back = curve([[0.1, -0.116], [0.096, -0.082], [0.088, -0.048], [0.082, -0.016]], 4);
  m.side([...front, [0.046, -0.122], [0.098, -0.122], ...back], 0.033, { bevel: 0.0036, smooth: 50 });
  m.use(F.anodized);
  m.at([0, -0.1245, 0.073], null, () => m.box(0.034, 0.006, 0.058, 0.0014, 0.003));
  m.use(F.steelDark);
  m.side(poly([[-0.04, -0.016], [-0.044, -0.034, 0.006], [-0.026, -0.05, 0.008], [0.03, -0.05, 0.008], [0.05, -0.022, 0.004], [0.05, -0.016]], 0.002), 0.014, {
    bevel: 0.0013,
    holes: [poly([[-0.035, -0.018], [-0.037, -0.032, 0.005], [-0.023, -0.0445, 0.005], [0.022, -0.0445, 0.005], [0.041, -0.0215, 0.003], [0.042, -0.018]], 0.002)],
  });
  m.part('trigger', [0, -0.018, -0.002], () => {
    m.use(F.steelDark);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0038, -0.0205, 0.0015], [0.0005, -0.0215, 0.001], [-0.0035, -0.0095, 0.003]], 0.001), 0.0065, { bevel: 0.0007 });
  });
}

/** A readout angled up at the eye. */
function readout(m: Mesher, pos: readonly [number, number, number]): void {
  m.at(pos, [-Math.PI / 2 + 0.12, 0, 0], () => {
    m.use(F.polymer);
    m.prism(rect(-0.0185, -0.0345, 0.0185, 0.0345, 0.003), 0.003, { bevel: 0.0009 });
    m.use(F.black);
    m.at([0, 0, 0.0012], null, () => m.prism(rect(-0.016, -0.031, 0.016, 0.031, 0.0014), 0.001, { bevel: 0 }));
    m.at([0, 0, 0.002], [0, 0, Math.PI / 2], () => m.screen('ammo', 0.058, 0.029));
  });
}

// --- The autocannon -----------------------------------------------------------------------------

const C_BORE = 0.09;
/** Receiver top, front face and half width. */
const C_TOP = 0.168;
const C_FRONT = -0.3;
const C_HALF = 0.07;
const C_NOSE = C_BORE + 0.034;
/** The clip: rounds sit along Z, stacked upright, the bottom one half down in the well. */
const CLIP_Z = -0.07;
const CLIP_SCALE = 1.18;
const C_PITCH = 0.04;
const CLIP_ROUNDS = ['r0', 'r1', 'r2'] as const;
/** How far the barrel runs back into the receiver on a shot, and the spring it runs back through. */
const SLAM = 0.12;
const SPRING = 0.16;

function cannonReceiver(m: Mesher): void {
  m.use(F.parkerized);
  // The nose steps down ahead of the clip so the eye sees the spring and the barrel's run from the receiver face.
  m.side(poly([[0.23, 0.0], [0.236, 0.14, 0.01], [0.205, C_TOP, 0.012], [-0.208, C_TOP, 0.008], [-0.236, C_NOSE, 0.008], [C_FRONT, C_NOSE, 0.006], [C_FRONT, 0.012, 0.008], [-0.26, -0.004, 0.008]], 0.003), C_HALF * 2, { bevel: 0.0036 });

  // Stepped side armour, a slab of plate a side so the flank has depth.
  const armour = poly([[0.2, 0.02], [0.206, 0.13, 0.006], [0.182, 0.154, 0.008], [-0.2, 0.154, 0.006], [-0.226, C_NOSE - 0.01, 0.006], [-0.288, C_NOSE - 0.01, 0.006], [-0.288, 0.026, 0.006], [-0.25, 0.012, 0.006]], 0.0025);
  m.use(F.anodized);
  m.mirror(() => m.at([C_HALF + 0.002, 0, 0], null, () => m.side(armour, 0.005, {
    bevel: 0.0012,
    holes: [...slotRow(-0.25, 0.042, -0.15, 0.042, 5, 0.05, 0.01, Math.PI / 2), slot(0.17, 0.12, 0.02, 0.12, 0.006, 3)],
  })));
  m.use(F.black);
  m.mirror(() => m.at([C_HALF + 0.0005, 0.042, -0.2], null, () => m.box(0.0012, 0.055, 0.112, 0)));
  m.mirror(() => {
    for (const [y, z] of [[0.138, 0.19], [0.104, -0.27], [0.026, 0.19], [0.03, -0.27], [0.026, 0.0], [0.138, -0.04], [0.138, 0.08]] as const) {
      hexX(m, C_HALF + 0.0045, y, z, 1, 0.005);
    }
  });
  m.at([-C_HALF - 0.0046, 0.062, 0.13], [0, -Math.PI / 2, 0], () => m.decal('cal30', 0.088, 0.0135, 0xc4c8cc));
  m.at([-C_HALF - 0.0046, 0.036, 0.11], [0, -Math.PI / 2, 0], () => m.decal('crucible', 0.12, 0.0155, 0x9aa0a6));
  m.at([-C_HALF - 0.0046, 0.088, 0.15], [0, -Math.PI / 2, 0], () => m.decal('hazard', 0.1, 0.013, 0xc9a227));

  // The well the clip stands in: a dark mouth in the top plate with a lip either side.
  m.use(F.black);
  m.at([0, C_TOP + 0.0004, CLIP_Z + 0.006], null, () => m.box(0.044, 0.001, 0.27, 0));
  m.use(F.steelDark);
  for (const s of [-1, 1]) {
    m.at([s * 0.029, C_TOP + 0.006, CLIP_Z + 0.006], null, () => m.box(0.01, 0.012, 0.28, 0.0016, 0.003));
  }
  // Rear and front posts of the hopper that guide a clip in from above.
  for (const z of [CLIP_Z + 0.142, CLIP_Z - 0.13]) {
    m.mirror(() => m.at([0.026, C_TOP + 0.03, z], null, () => m.box(0.008, 0.06, 0.012, 0.0014, 0.003)));
  }
  m.use(F.anodizedGrey);
  m.at([0, C_TOP + 0.003, 0.17], null, () => m.top(rect(-0.05, -0.045, 0.05, 0.045, 0.006), 0.006, { bevel: 0.0016 }));
  readout(m, [0.022, C_TOP + 0.0065, 0.17]);

  lower(m);

  // Butt: a rubber pad on a buffer block, the thing that goes into the shoulder.
  m.use(F.anodized);
  m.at([0, 0.07, 0.25], null, () => m.front(poly([[-0.055, -0.07], [0.055, -0.07], [0.062, -0.055], [0.062, 0.06], [0.05, 0.075], [-0.05, 0.075], [-0.062, 0.06], [-0.062, -0.055]], 0.004), 0.04, { bevel: 0.0024 }));
  m.use(F.rubber);
  m.at([0, 0.07, 0.285], null, () => m.front(rect(-0.054, -0.07, 0.054, 0.07, 0.016), 0.034, { bevel: 0.005 }));

  // Fore grip on the receiver's belly.
  m.use(F.parkerized);
  m.at([0, -0.01, -0.24], null, () => m.box(0.05, 0.016, 0.1, 0.0022, 0.004));
  m.use(F.polymerStipple);
  m.at([0, -0.03, -0.24], null, () => {
    const f = curve([[-0.022, 0], [-0.026, -0.03], [-0.027, -0.06], [-0.022, -0.104]], 4);
    const b = curve([[0.026, -0.104], [0.028, -0.06], [0.026, -0.03], [0.022, 0]], 4);
    m.side([...f, ...b], 0.036, { bevel: 0.0036, smooth: 50 });
  });
  m.use(F.anodized);
  m.at([0, -0.137, -0.24], null, () => m.box(0.038, 0.006, 0.054, 0.0014, 0.003));

  // The cradle the barrel runs in: a buffer cylinder under it and a bearing ring at its front.
  const zr = C_FRONT;
  m.use(F.parkerized);
  m.at([0, C_BORE - 0.072, zr - 0.115], null, () => m.box(0.064, 0.022, 0.23, 0.003, 0.006));
  m.use(F.steelDark);
  m.at([0, C_BORE - 0.05, zr], null, () => m.lathe([[0.024, 0.0, 0], [0.024, -0.03], [0.02, -0.036], [0.0105, -0.036, 0]], 22));
  m.use(F.anodized);
  m.at([0, C_BORE, zr - 0.24], null, () => m.front(poly([[-0.05, -0.088], [0.05, -0.088], [0.05, 0.02, 0.012], [0.03, 0.045, 0.016], [-0.03, 0.045, 0.016], [-0.05, 0.02, 0.012]], 0.004), 0.028, { bevel: 0.0024, holes: [circle(0, 0, 0.034, 26)] }));
  m.use(F.chrome);
  m.at([0, C_BORE, zr - 0.24], null, () => m.lathe([[0.034, 0.015, 0], [0.0352, 0.0145], [0.0352, -0.0145], [0.034, -0.015, 0]], 26));
  m.mirror(() => m.at([0.05, C_BORE - 0.03, zr - 0.24], [0, Math.PI / 2, 0], () => rivet(m, 0.004)));
}

/** The barrel's own part: everything on it rides back into the receiver on a shot. */
function cannonBarrel(m: Mesher): void {
  m.part('barrel', [0, C_BORE, C_FRONT], () => {
    const zEnd = -0.66;
    m.use(F.barrel);
    m.lathe([[0.032, 0.12, 0], [0.032, -0.2], [0.0305, -0.22], [0.029, zEnd, 0]], 28);
    // Collar the spring bears on, with a lug down to the buffer rod.
    m.use(F.steelDark);
    m.at([0, 0, -SPRING - 0.01], null, () => {
      m.lathe([[0.0305, 0.012, 0], [0.046, 0.012], [0.048, 0.008], [0.048, -0.008], [0.046, -0.012], [0.0305, -0.012, 0]], 28, { chamfer: 0.001 });
      m.at([0, -0.04, 0], null, () => m.box(0.03, 0.036, 0.022, 0.002, 0.004));
    });
    m.use(F.chrome);
    m.at([0, -0.05, -0.095], null, () => m.cyl(0.0095, 0.15, 16));
    // Muzzle brake: a heavy block of three baffles.
    m.use(F.barrelBlack);
    m.lathe([[0.029, zEnd + 0.02, 0], [0.037, zEnd + 0.014], [0.037, zEnd - 0.016], [0.029, zEnd - 0.02, 0]], 26);
    const baffle = (w: number, h: number, depth: number) => {
      m.front(poly([[-w, -h * 0.55], [w, -h * 0.55], [w + 0.007, 0], [w, h * 0.55], [-w, h * 0.55], [-w - 0.007, 0]], 0.003), depth, { bevel: 0.0022, holes: [circle(0, 0, 0.026, 24)] });
    };
    for (let i = 0; i < 3; i++) m.at([0, 0, zEnd - 0.05 - i * 0.05], null, () => baffle(0.056 - i * 0.003, 0.066, 0.018));
    m.use(F.parkerized);
    for (const y of [-0.035, 0.035]) m.at([0, y, zEnd - 0.1], null, () => m.box(0.056, 0.013, 0.17, 0.002, 0.004));
    m.mirror(() => {
      for (let i = 0; i < 3; i++) m.at([0.02, 0.0418, zEnd - 0.05 - i * 0.05], [-Math.PI / 2, 0, 0], () => rivet(m, 0.003));
    });
    m.use(F.black);
    m.at([0, 0, zEnd - 0.1], null, () => m.lathe([[0.026, 0.09, 0], [0.026, -0.09, 0]], 20));
    m.use(F.barrelBlack);
    m.lathe([[0.032, zEnd - 0.18, 0], [0.036, zEnd - 0.184], [0.036, zEnd - 0.2], [0.032, zEnd - 0.204], [0.026, zEnd - 0.204, 0]], 26);
  });
  // The spring between the receiver and the collar. Its own part, so the clip can squash it as the barrel comes back.
  m.part('spring', [0, C_BORE, C_FRONT], () => m.at([0, 0, -SPRING / 2], null, () => coil(m, 0.039, 0.0036, SPRING, 9, F.steel)));
}

/** A heavy, short ranging sight on a bracket off the right flank, so the clip and the barrel's run stay in view. */
function cannonSight(m: Mesher): void {
  m.use(F.anodized);
  m.at([C_HALF + 0.017, 0.13, 0.06], null, () => m.box(0.034, 0.04, 0.09, 0.003, 0.006));
  m.at([0.12, 0.156, 0.04], null, () => {
    m.use(F.anodized);
    for (const z of [-0.035, 0.05]) m.at([0, 0, z], null, () => m.lathe([[0.031, 0.012, 0], [0.036, 0.012], [0.036, -0.012], [0.031, -0.012, 0]], 26));
    m.use(F.polymer);
    m.lathe([[0.024, 0.13, 0], [0.03, 0.124], [0.031, 0.096], [0.0285, 0.08], [0.0285, -0.06], [0.04, -0.08], [0.041, -0.11], [0.034, -0.112, 0]], 30, { chamfer: 0.0016, smooth: 24 });
    // A square sunshade on the objective.
    m.use(F.anodized);
    m.at([0, 0, -0.13], null, () => m.front(rect(-0.046, -0.046, 0.046, 0.046, 0.008), 0.04, { bevel: 0.002, holes: [rect(-0.04, -0.04, 0.04, 0.04, 0.006)] }));
    m.use(F.rubber);
    m.lathe([[0.03, 0.17, 0], [0.032, 0.17], [0.033, 0.15], [0.03, 0.128], [0.024, 0.128, 0]], 24);
    m.use(F.black);
    m.at([0, 0, 0.13], null, () => m.cyl(0.0232, 0.001, 22, 0));
    m.glass(() => m.at([0, 0, -0.111], null, () => m.cyl(0.0335, 0.0006, 24, 0)));
    // Its reticle in miniature: three thick posts and a chevron.
    m.glow('scope', () => m.at([0, 0, 0.1305], null, () => {
      m.prism(rect(-0.018, -0.0011, -0.006, 0.0011, 0), 0.0002, { bevel: 0 });
      m.prism(rect(0.006, -0.0011, 0.018, 0.0011, 0), 0.0002, { bevel: 0 });
      m.prism(rect(-0.0011, -0.018, 0.0011, -0.006, 0), 0.0002, { bevel: 0 });
      for (const s of [-1, 1]) m.at([s * 0.0026, -0.0026, 0], [0, 0, s * 0.8], () => m.prism(rect(-0.0036, -0.0006, 0.0036, 0.0006, 0), 0.0002, { bevel: 0 }));
    }));
    // A single big elevation drum: the gun lobs, so range is what gets set.
    m.at([0.0, 0.034, 0.0], [Math.PI / 2, 0, 0], () => { knurl(m, 0.016, 0.014, F.steelDark, 28, 0.0008); m.use(F.red); m.at([0, 0, -0.008], null, () => m.cyl(0.0165, 0.002, 22)); });
  });
}

function cannonClip(m: Mesher): void {
  m.part('clip', [0, C_TOP, CLIP_Z], () => {
    for (let i = 0; i < CLIP_ROUNDS.length; i++) {
      m.part(CLIP_ROUNDS[i]!, [0, i * C_PITCH, 0.012], () => m.scaled(CLIP_SCALE, () => shell(m)));
    }
    // Charger: a spine behind the case heads, sprung cheeks with windows either side, a bar to lift it by.
    const top = (CLIP_ROUNDS.length - 1) * C_PITCH + 0.026;
    m.use(F.steelDark);
    m.at([0, top / 2 - 0.004, 0.142], null, () => m.box(0.036, top + 0.012, 0.006, 0.0014, 0.003));
    const cheek = rect(0.02, -0.004, 0.135, top - 0.006, 0.006);
    const windows = [rect(0.035, 0.012, 0.12, top - 0.02, 0.005)];
    m.mirror(() => m.at([0.0215, 0, 0], null, () => m.side(cheek, 0.0024, { bevel: 0.0008, holes: windows })));
    m.use(F.red);
    m.at([0, top + 0.004, 0.09], null, () => m.box(0.046, 0.009, 0.1, 0.002, 0.004));
    m.use(F.steelDark);
    m.mirror(() => m.at([0.0215, top - 0.002, 0.09], null, () => m.box(0.003, 0.012, 0.06, 0.0008)));
  });
}

function cannonCharge(m: Mesher): void {
  m.part('charge', [-C_HALF - 0.004, 0.07, -0.16], () => {
    m.use(F.steelDark);
    m.at([0.002, 0, 0], null, () => m.box(0.01, 0.01, 0.03, 0.0014));
    m.at([-0.016, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.006, 0.026, 12));
    m.use(F.red);
    m.at([-0.034, 0, 0], null, () => m.box(0.014, 0.014, 0.05, 0.003, 0.005));
  });
}

function buildCannon(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0018;
  cannonReceiver(m);
  cannonBarrel(m);
  cannonSight(m);
  cannonClip(m);
  cannonCharge(m);
  const model = new Model(m, kit.mats, {
    glows: { scope: [0xff3a22, 2.4] },
    screens: { ammo: [176, 88] },
  });
  model.socket('muzzle', [0, C_BORE, C_FRONT - 0.87]);
  model.socket('eject', [C_HALF, 0.1, 0.0]);
  model.hand('gripR', [0.018, -0.056, 0.07], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.hand('gripL', [-0.02, -0.088, -0.24], [0.02, -0.98, 0.2], [0.34, -0.18, -0.92]);
  // Over the clip's bar from above, fingers down its far side.
  model.hand('clipHold', [-0.012, (CLIP_ROUNDS.length - 1) * C_PITCH + 0.04, 0.09], [-0.85, -0.33, -0.2], [0.35, -0.5, -0.8], 'clip');
  model.hand('chargeHold', [-0.04, 0, 0.012], [-0.5, -0.2, -0.8], [0.8, -0.3, -0.5], 'charge');
  return model;
}

/** Long recoil: the barrel is back in the receiver on the frame of the shot and the spring runs it home in 0.22 s. */
function cannonAnim(a: Anim): void {
  const P = a.parts;
  pullTrigger(a, 0.08);
  const t = a.sinceFire;
  const kick = t < 0.012 ? t / 0.012 : t < 0.04 ? 1 : 1 - inOut(seg(t, 0.04, 0.24));
  P.barrel!.position.z += kick * SLAM;
  P.spring!.scale.z *= (SPRING - kick * SLAM) / SPRING;
  P.charge!.position.z += (t < 0.14 ? bump(t, 0, 0.14) : 0) * 0.05;
  a.glow('scope', 1);

  // The clip strips from the bottom: the round that fed is gone at once and the ones above drop into its place.
  const p = a.reload;
  for (let i = 0; i < CLIP_ROUNDS.length; i++) P[CLIP_ROUNDS[i]!]!.visible = p >= 0.34 || i < a.mag;
  const spent = a.magSize - a.mag;
  if (p < 0 && spent > 0 && a.mag > 0) P.clip!.position.y += (1 - outCubic(seg(t, 0.07, 0.16))) * C_PITCH * (t < 0.16 ? 1 : 0);

  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.06;
    a.gunR.z -= k * 0.14;
    P.charge!.position.z += bump(a.draw, 0.3, 1) * 0.1;
  }
  if (p >= 0) {
    // Old clip up and out, a fresh one down from above and slapped home.
    const out = inOut(seg(p, 0.12, 0.3));
    const into = 1 - outCubic(seg(p, 0.36, 0.56));
    const lift = p < 0.33 ? out : into;
    const slam = p >= 0.56 ? thud(seg(p, 0.56, 0.68)) : 0;
    // Up and away to the right, so the arm never sweeps across the eye.
    P.clip!.position.y += lift * 0.1 - slam * 0.006;
    P.clip!.position.x += lift * 0.13;
    P.clip!.rotation.z -= lift * 0.45;

    const rack = hold(p, 0.72, 0.8, 0.82, 0.88);
    P.charge!.position.z += rack * 0.12;
    P.barrel!.position.z += rack * 0.03;

    // The top of the gun is rolled toward the eye, so the clip is seen going in.
    const present = hold(p, 0.0, 0.12, 0.86, 1);
    a.gunR.z += present * 0.2;
    a.gunR.x += present * 0.06 + slam * 0.03;
    a.gunR.y += present * 0.04;
    a.gunP.x -= present * 0.03;
    a.gunP.y -= present * 0.02 + hold(p, 0.08, 0.2, 0.5, 0.62) * 0.035;
    a.gunP.z += present * 0.04 + rack * 0.016;

    const h = a.left;
    h.fingerRate = 36;
    h.to('clipHold', inOut(seg(p, 0.02, 0.12)));
    h.to('chargeHold', inOut(seg(p, 0.64, 0.72)));
    h.to('gripL', inOut(seg(p, 0.88, 1)));
    h.shape(HANDS.pinch, hold(p, 0.04, 0.12, 0.6, 0.66));
    h.shape(HANDS.foregrip, hold(p, 0.66, 0.72, 0.9, 0.95));
  }
}

// --- The Sabot ----------------------------------------------------------------------------------

const S_BORE = 0.05;
const S_TOP = 0.085;
const S_FRONT = -0.2;
const S_HALF = 0.028;
/** The open side magazine on the left: five darts stacked upright, the top one level with the feed. */
const MAG_X = -S_HALF - 0.017;
const MAG_Z = -0.085;
const MAG_TOP = 0.056;
const DART_SCALE = 0.74;
const S_PITCH = 0.027;
const DARTS = ['r0', 'r1', 'r2', 'r3', 'r4'] as const;

function sabotReceiver(m: Mesher): void {
  m.use(F.parkerized);
  m.side(poly([[0.15, 0.0], [0.152, 0.07, 0.008], [0.134, S_TOP, 0.008], [-0.18, S_TOP, 0.006], [S_FRONT, 0.07, 0.006], [S_FRONT, 0.014, 0.006], [-0.17, -0.002, 0.006]], 0.0025), S_HALF * 2, { bevel: 0.0028 });
  m.use({ color: 0x2a3442, rough: 0.44, metal: 0.35, wear: 0.85 });
  m.mirror(() => m.at([S_HALF + 0.0015, 0, 0], null, () => m.side(poly([[0.13, 0.014], [0.132, 0.068, 0.005], [0.118, 0.076, 0.005], [-0.17, 0.076, 0.005], [-0.185, 0.062, 0.004], [-0.185, 0.02, 0.004], [-0.165, 0.012, 0.004]], 0.002), 0.003, {
    bevel: 0.0009,
    holes: slotRow(0.11, 0.044, 0.04, 0.044, 3, 0.03, 0.006, Math.PI / 2),
  })));
  m.mirror(() => {
    for (const [y, z] of [[0.066, 0.12], [0.022, 0.12], [0.066, -0.17], [0.022, -0.17]] as const) hexX(m, S_HALF + 0.003, y, z, 1, 0.0032);
  });
  m.at([-S_HALF - 0.0032, 0.068, 0.045], [0, -Math.PI / 2, 0], () => m.decal('cal30ap', 0.09, 0.0105, 0xc4c8cc));
  // The count on the left flank, where the eye sees it past the scope.
  m.at([-S_HALF - 0.0032, 0.029, 0.115], [0, -Math.PI / 2, 0], () => {
    m.use(F.polymer);
    m.prism(rect(-0.031, -0.0145, 0.031, 0.0145, 0.003), 0.003, { bevel: 0.0009 });
    m.use(F.black);
    m.at([0, 0, 0.0012], null, () => m.prism(rect(-0.028, -0.012, 0.028, 0.012, 0.0014), 0.001, { bevel: 0 }));
    m.at([0, 0, 0.002], null, () => m.screen('ammo', 0.05, 0.025));
  });
  m.at([0, S_TOP, -0.03], null, () => rail(m, 0.13, -0.19, 0.0212, F.anodized));

  lower(m);

  // A slim skeleton stock back to the shoulder.
  m.use(F.anodized);
  m.side(poly([[0.15, 0.072], [0.36, 0.06, 0.01], [0.37, -0.07, 0.01], [0.33, -0.075, 0.008], [0.21, -0.02, 0.012], [0.15, -0.002]], 0.004), 0.026, {
    bevel: 0.002, holes: [poly([[0.2, 0.04], [0.32, 0.034, 0.01], [0.33, -0.04, 0.01], [0.24, 0.0, 0.01]], 0.006)],
  });
  m.use(F.rubber);
  m.at([0, -0.004, 0.375], null, () => m.front(rect(-0.016, -0.072, 0.016, 0.064, 0.01), 0.014, { bevel: 0.003 }));
  m.use(F.polymer);
  m.at([0, 0.07, 0.27], null, () => m.box(0.03, 0.014, 0.12, 0.003, 0.006));

  // Free-float handguard: a slim octagonal tube with slots down its flanks, and a folded bipod under its nose.
  const zh = S_FRONT - 0.2;
  m.use(F.anodized);
  m.at([0, S_BORE, zh], null, () => m.front(ngon(0, 0, 0.028, 8, Math.PI / 8), 0.4, { bevel: 0.0018, holes: [circle(0, 0, 0.018, 18)] }));
  m.use(F.black);
  for (let i = 0; i < 5; i++) {
    m.mirror(() => m.at([0.0262, S_BORE + 0.0005, zh + 0.13 - i * 0.065], [0, 0, 0], () => m.box(0.001, 0.008, 0.04, 0.0004)));
  }
  m.use(F.anodized);
  m.at([0, S_BORE + 0.026, zh], null, () => rail(m, -0.18, 0.16, 0.016, F.anodized));
  m.use(F.steelDark);
  m.at([0, S_BORE - 0.034, zh - 0.175], null, () => m.box(0.03, 0.012, 0.024, 0.002, 0.004));
  m.mirror(() => m.at([0.009, S_BORE - 0.036, zh - 0.105], null, () => m.box(0.006, 0.007, 0.1, 0.0016, 0.002)));
}

function sabotBarrel(m: Mesher): void {
  m.part('barrel', [0, S_BORE, S_FRONT], () => {
    const zEnd = -0.98;
    m.use(F.barrel);
    m.lathe([[0.017, 0.06, 0], [0.017, -0.4], [0.0165, -0.42, 0]], 22);
    // Fluted from the handguard to the brake.
    const flutes = 6;
    m.surface(flutes * 6, 24, (u, v, out) => {
      const a = u * Math.PI * 2;
      const r = 0.0138 + 0.0022 * Math.cos(a * flutes) ** 2 - v * 0.0012;
      out.set(Math.cos(a) * r, Math.sin(a) * r, -0.42 + v * (zEnd + 0.42));
    }, { wrapU: true, flip: true });
    // A slim slotted brake.
    m.use(F.barrelBlack);
    m.lathe([[0.0145, zEnd + 0.006, 0], [0.019, zEnd], [0.019, zEnd - 0.07], [0.017, zEnd - 0.078], [0.009, zEnd - 0.078, 0]], 22, { chamfer: 0.001 });
    m.use(F.black);
    m.mirror(() => {
      for (let i = 0; i < 3; i++) m.at([0.0188, 0, zEnd - 0.016 - i * 0.02], null, () => m.box(0.0012, 0.009, 0.012, 0.0003));
    });
    m.use(AP_BLUE);
    m.at([0, 0, -0.44], null, () => m.lathe([[0.0162, 0.008, 0], [0.0168, 0.007], [0.0168, -0.007], [0.0162, -0.008, 0]], 22, { chamfer: 0.0004 }));
  });
}

/** A long sniper scope on two rings over the rail. */
function sabotScope(m: Mesher): void {
  m.at([0, S_TOP + 0.046, -0.085], null, () => {
    m.use(F.anodized);
    for (const z of [-0.07, 0.07]) {
      m.at([0, 0, z], null, () => {
        m.at([0, -0.024, 0], null, () => m.box(0.026, 0.026, 0.02, 0.0016, 0.003));
        m.lathe([[0.0205, 0.0105, 0], [0.025, 0.0105], [0.025, -0.0105], [0.0205, -0.0105, 0]], 26);
      });
    }
    m.use(F.polymer);
    m.lathe([[0.019, 0.18, 0], [0.026, 0.174], [0.0265, 0.12], [0.021, 0.1], [0.021, -0.12], [0.034, -0.16], [0.0355, -0.22], [0.0335, -0.224], [0.028, -0.224, 0]], 32, { chamfer: 0.0015, smooth: 24 });
    m.use(F.rubber);
    m.lathe([[0.025, 0.22, 0], [0.0262, 0.22], [0.0275, 0.2], [0.026, 0.176], [0.021, 0.176, 0]], 26);
    m.use(F.black);
    m.at([0, 0, 0.2], null, () => m.cyl(0.0232, 0.001, 22, 0));
    m.at([0, 0, -0.22], null, () => m.cyl(0.03, 0.001, 24, 0));
    m.glass(() => m.at([0, 0, -0.221], null, () => m.cyl(0.0298, 0.0006, 24, 0)));
    // A hairline cross and a dot, in miniature.
    m.glow('scope', () => m.at([0, 0, 0.2005], null, () => {
      m.prism(rect(-0.0175, -0.00018, 0.0175, 0.00018, 0), 0.0002, { bevel: 0 });
      m.prism(rect(-0.00018, -0.0175, 0.00018, 0.0175, 0), 0.0002, { bevel: 0 });
      m.cyl(0.0009, 0.0002, 10, 0);
    }));
    m.at([0, 0.026, 0], [Math.PI / 2, 0, 0], () => { knurl(m, 0.011, 0.016, F.steelDark, 24, 0.0006); m.use(F.anodized); m.at([0, 0, -0.009], null, () => m.cyl(0.0115, 0.002, 20)); });
    m.at([0.026, 0, 0], [0, -Math.PI / 2, 0], () => { knurl(m, 0.011, 0.016, F.steelDark, 24, 0.0006); m.use(F.anodized); m.at([0, 0, -0.009], null, () => m.cyl(0.0115, 0.002, 20)); });
    m.at([-0.026, 0, 0.02], [0, Math.PI / 2, 0], () => { knurl(m, 0.012, 0.012, F.steelDark, 24, 0.0006); m.use(AP_BLUE); m.at([0, 0, -0.007], null, () => m.cyl(0.0125, 0.002, 20)); });
  });
}

/** Darts stacked in an open frame on the left flank, so each tip shows. The stack climbs one round a shot. */
function sabotMagazine(m: Mesher): void {
  m.part('belt', [MAG_X, MAG_TOP, MAG_Z], () => {
    for (let i = 0; i < DARTS.length; i++) m.part(DARTS[i]!, [0, -i * S_PITCH, 0], () => m.scaled(DART_SCALE, () => dart(m)));
  });
  // The frame: a spine behind the case heads, a bottom plate, a front post and a rail along the outside.
  const h = (DARTS.length - 1) * S_PITCH + 0.03;
  m.use(F.anodized);
  m.at([MAG_X, MAG_TOP - h / 2 + 0.01, MAG_Z + 0.08], null, () => m.box(0.03, h + 0.01, 0.006, 0.0014, 0.003));
  m.at([MAG_X, MAG_TOP - h + 0.004, MAG_Z - 0.0], null, () => m.box(0.03, 0.006, 0.16, 0.0014, 0.003));
  m.use(F.steelDark);
  m.at([MAG_X - 0.0145, MAG_TOP - h / 2 + 0.008, MAG_Z + 0.04], null, () => m.box(0.003, h, 0.006, 0.0008));
  m.at([MAG_X - 0.0145, MAG_TOP - h + 0.04, MAG_Z + 0.0], null, () => m.box(0.003, 0.006, 0.15, 0.0008));
  m.at([-S_HALF - 0.004, MAG_TOP - h / 2 + 0.008, MAG_Z + 0.08], null, () => m.box(0.008, h, 0.016, 0.0014));
}

/** The gate over the top of the stack, hinged on the receiver's top edge. It is the door a fresh stack goes in through. */
function sabotCover(m: Mesher): void {
  m.part('cover', [-S_HALF, S_TOP, MAG_Z], () => {
    m.use(F.anodized);
    m.at([-0.016, -0.014, 0], null, () => {
      m.front(poly([[-0.017, -0.012], [0.014, -0.012], [0.014, 0.014, 0.003], [-0.006, 0.014, 0.005], [-0.017, 0.005, 0.005]], 0.002), 0.13, { bevel: 0.0016 });
      screwX(m, -0.0172, 0.0, 0.0, -1, 0.0022);
      m.use(AP_BLUE);
      m.at([-0.0185, -0.004, 0.03], null, () => m.box(0.004, 0.009, 0.03, 0.0012, 0.002));
    });
    m.use(F.steel);
    m.cyl(0.003, 0.14, 12);
  });
}

function sabotCharge(m: Mesher): void {
  m.part('charge', [-S_HALF - 0.002, 0.05, 0.06], () => {
    m.use(F.steelDark);
    m.at([0.002, 0, 0], null, () => m.box(0.006, 0.006, 0.02, 0.001));
    m.at([-0.01, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.0036, 0.018, 12));
    m.use(AP_BLUE);
    m.at([-0.02, 0, 0], null, () => m.lathe([[0, 0.009, 0], [0.006, 0.009], [0.0075, 0.0], [0.006, -0.009], [0, -0.009, 0]], 14));
  });
}

function buildSabot(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0014;
  sabotReceiver(m);
  sabotBarrel(m);
  sabotScope(m);
  sabotMagazine(m);
  sabotCover(m);
  sabotCharge(m);
  const model = new Model(m, kit.mats, {
    glows: { scope: [0x39b8ff, 2.4] },
    screens: { ammo: [176, 88] },
  });
  model.socket('muzzle', [0, S_BORE, S_FRONT - 1.06]);
  model.socket('eject', [S_HALF, 0.05, -0.02]);
  model.hand('gripR', [0.018, -0.056, 0.07], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.hand('gripL', [-0.002, S_BORE - 0.028, -0.36], [-0.55, 0.15, -0.8], [0.8, 0.05, -0.55]);
  model.hand('coverHold', [-0.04, -0.02, 0], [-0.1, 0.1, -0.98], [0.75, 0.6, -0.1], 'cover');
  model.hand('beltHold', [-0.016, -0.06, 0.01], [-0.1, 0.1, -0.98], [0.9, 0.1, -0.2], 'belt');
  model.hand('chargeHold', [-0.024, 0, 0.006], [-0.5, -0.2, -0.8], [0.8, -0.3, -0.5], 'charge');
  return model;
}

/** A short kick of the barrel and the charging handle thrown back; most of the shot is the body going into the shoulder. */
function sabotAnim(a: Anim): void {
  const P = a.parts;
  pullTrigger(a, 0.08);
  const t = a.sinceFire;
  P.barrel!.position.z += (t < 0.2 ? (1 - t / 0.2) ** 2 : 0) * 0.018;
  P.charge!.position.z += (t < 0.18 ? (1 - t / 0.18) ** 2 : 0) * 0.05;
  a.glow('scope', 1);

  const p = a.reload;
  const spent = Math.max(0, a.magSize - a.mag);
  // The stack climbs one dart on each shot.
  const lag = 1 - outCubic(seg(t, 0.02, 0.1));
  let lift = (spent - lag * (spent > 0 ? 1 : 0)) * S_PITCH;
  for (let i = 0; i < DARTS.length; i++) P[DARTS[i]!]!.visible = p >= 0.32 || i >= spent;

  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.05;
    a.gunR.z -= k * 0.14;
    P.charge!.position.z += bump(a.draw, 0.3, 1) * 0.07;
  }
  if (p >= 0) {
    const coverUp = inOut(seg(p, 0.1, 0.2)) * (1 - inQuad(seg(p, 0.6, 0.66)));
    const slam = p >= 0.66 ? thud(seg(p, 0.66, 0.78)) : 0;
    P.cover!.rotation.z -= coverUp * 1.2 + slam * 0.05;
    if (p < 0.32) lift -= inQuad(seg(p, 0.14, 0.3)) * 0.35;
    else lift = -(1 - outCubic(seg(p, 0.32, 0.56))) * 0.35;

    const rack = hold(p, 0.74, 0.84, 0.86, 0.9);
    P.charge!.position.z += rack * 0.08;

    const present = hold(p, 0.0, 0.12, 0.84, 1);
    a.gunR.z -= present * 0.32;
    a.gunR.x += present * 0.14 + slam * 0.03;
    a.gunR.y += present * 0.06;
    a.gunP.x -= present * 0.06;
    a.gunP.y += present * 0.03;
    a.gunP.z += present * 0.08 + rack * 0.012;

    const h = a.left;
    h.fingerRate = 36;
    h.to('coverHold', inOut(seg(p, 0.01, 0.09)));
    h.to('beltHold', inOut(seg(p, 0.14, 0.34)));
    h.to('coverHold', inOut(seg(p, 0.52, 0.59)));
    h.to('chargeHold', inOut(seg(p, 0.67, 0.74)));
    h.to('gripL', inOut(seg(p, 0.9, 1)));
    h.shape(HANDS.pinch, hold(p, 0.02, 0.08, 0.12, 0.17));
    h.shape(HANDS.cup, hold(p, 0.26, 0.34, 0.5, 0.55));
    h.shape(HANDS.foregrip, hold(p, 0.68, 0.74, 0.9, 0.95));
  }
  P.belt!.position.y += lift;
}

export function autocannonDef(kit: Kit): ViewDef {
  return {
    id: 'autocannon',
    model: buildCannon(kit),
    pos: [0.25, -0.31, -0.47],
    rot: [0.012, 0.05, 0],
    // Back into the shoulder with a slight tip, not a muzzle flip (owner, 2026-11-13).
    recoil: { back: 0.13, lift: 0.012, pitch: 0.045, yaw: 0.016, roll: 0.05, omega: 28, zeta: 0.5 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.foregrip },
    heatPerShot: 0.22,
    animate: cannonAnim,
    readout: a => drawCount(a, 'ammo', 1, 3, '#ffb43a'),
  };
}

/** Key 4's first member. */
export function sabotDef(kit: Kit): ViewDef {
  return {
    id: 'sabot',
    model: buildSabot(kit),
    pos: [0.2, -0.235, -0.44],
    rot: [0.014, 0.055, 0],
    // Back into the shoulder with a slight tip, not a muzzle flip (owner, 2026-11-13).
    recoil: { back: 0.15, lift: 0.01, pitch: 0.04, yaw: 0.012, roll: 0.04, omega: 30, zeta: 0.46 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.support },
    heatPerShot: 0.2,
    animate: sabotAnim,
    readout: a => drawCount(a, 'ammo', 1, 5, '#5ac8ff'),
  };
}
