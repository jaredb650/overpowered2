/**
 * Satchel Charge: canvas-olive demolition pack in the right hand, M57-style squeeze clacker detonator in the left.
 * Visible explosive bricks strapped tight under webbing bands, blasting-cap receiver with a blinking red armed LED,
 * and a clacker whose status lamp pulses urgently whenever charges are planted (`a.charge > 0`).
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Mesher } from '../kit/mesher';
import { poly } from '../kit/shapes';
import { rivet } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, seg } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';

const CANVAS = { color: 0x525d3e, rough: 0.78, metal: 0.04, wear: 0.9 } as const;
const CANVAS_DARK = { color: 0x3b442c, rough: 0.82, metal: 0.04, wear: 0.9 } as const;
const BLOCK = { color: 0x9b9278, rough: 0.68, metal: 0.04, wear: 0.5 } as const;

/** Canvas-olive demolition satchel pack held in the right hand. Origin at pack center. */
function buildPack(m: Mesher): void {
  m.part('pack', [0, 0, 0], () => {
    // Main heavy canvas body: slightly tapered demolition pouch.
    m.use(CANVAS);
    m.box(0.145, 0.095, 0.19, 0.006, 0.008);
    // Reinforced dark canvas bottom & side gussets.
    m.use(CANVAS_DARK);
    m.at([0, -0.044, 0], null, () => m.box(0.148, 0.016, 0.194, 0.004));
    m.at([0, 0.018, 0.088], null, () => m.box(0.142, 0.062, 0.022, 0.004));

    // Twin tan composition explosive bricks peeking out beneath the top canvas flap.
    m.use(BLOCK);
    m.mirror(() => {
      m.at([0.036, 0.044, -0.008], null, () => m.box(0.058, 0.032, 0.155, 0.003));
    });
    // Hazard bands wrapping the explosive bricks.
    m.use(F.yellow);
    m.mirror(() => {
      m.at([0.036, 0.045, -0.048], null, () => m.box(0.06, 0.034, 0.014, 0.001));
    });

    // Heavy webbing straps + steel cinch buckles securing the charge blocks.
    m.use(F.webbing);
    for (const z of [-0.056, 0.048]) {
      m.at([0, 0.006, z], null, () => m.box(0.156, 0.118, 0.024, 0.002));
      m.use(F.steelDark);
      m.at([0.078, 0.014, z], null, () => m.box(0.008, 0.028, 0.028, 0.0014));
      m.at([-0.078, 0.014, z], null, () => m.box(0.008, 0.028, 0.028, 0.0014));
      m.use(F.webbing);
    }
    // Carry handle webbing loop along the right flank for the throwing hand.
    m.at([0.082, -0.006, 0], null, () => m.box(0.012, 0.022, 0.11, 0.002));

    // Top-mounted RF blasting-cap receiver + stub antenna + blinking red armed LED.
    m.at([0, 0.064, -0.006], null, () => {
      m.use(F.anodized);
      m.box(0.052, 0.024, 0.068, 0.002);
      m.use(F.steelDark);
      m.at([0, 0.014, -0.008], [Math.PI / 2, 0, 0], () => m.cyl(0.016, 0.008, 12, 0.001));
      // Twin crimps & detonator lead wires into the explosive bricks.
      m.use(F.copper);
      m.mirror(() => {
        m.at([0.028, -0.004, -0.01], [0, 0, Math.PI / 2], () => m.cyl(0.003, 0.016, 8, 0.0004));
      });
      // Short RF receiver whip antenna.
      m.use(F.black);
      m.at([-0.016, 0.028, 0.022], [Math.PI / 2, 0, 0], () => m.cyl(0.0022, 0.042, 8, 0.0004));
      // Hazard stencil on the blasting-cap module.
      m.at([0, 0.0126, 0.018], [-Math.PI / 2, 0, 0], () => m.decal('hazard', 0.042, 0.012, 0xf0c428));
      // Blinking red armed beacon LED.
      m.glow('packLed', () => m.at([0, 0.019, -0.008], [Math.PI / 2, 0, 0], () => m.cyl(0.0085, 0.006, 12, 0)));
    });
  });
}

/** Left-hand M57-style squeeze clacker detonator. */
function buildClacker(m: Mesher): void {
  m.part('clacker', [-0.305, -0.025, 0.035], () => {
    // Olive-drab rugged clacker body.
    m.use(F.oliveDark);
    m.box(0.042, 0.092, 0.058, 0.004, 0.005);
    // Textured rubber grip panels.
    m.use(F.polymerStipple);
    m.at([0, -0.006, 0.006], null, () => m.box(0.045, 0.068, 0.042, 0.002));
    // Top cap & firing terminal block.
    m.use(F.steelDark);
    m.at([0, 0.052, 0], null, () => m.box(0.044, 0.014, 0.06, 0.002));
    m.at([-0.014, 0.064, 0.012], [Math.PI / 2, 0, 0], () => m.cyl(0.006, 0.012, 10, 0.0008));
    // RF clacker whip antenna.
    m.use(F.black);
    m.at([-0.014, 0.108, 0.012], [Math.PI / 2, 0, 0], () => m.cyl(0.002, 0.082, 8, 0.0004));
    // Red armed status lamp facing the player.
    m.use(F.red);
    m.at([0.008, 0.044, 0.031], null, () => m.box(0.018, 0.014, 0.004, 0.001));
    m.glow('clackerLed', () => m.at([0.008, 0.044, 0.034], null, () => m.box(0.013, 0.009, 0.003, 0)));
    // Rivets on the side plate.
    m.at([0.022, 0.028, -0.016], [0, Math.PI / 2, 0], () => rivet(m, 0.002));
    m.at([0.022, -0.028, -0.016], [0, Math.PI / 2, 0], () => rivet(m, 0.002));

    // Hinged squeeze firing bail / clacker lever (pivots inward when RMB detonates!).
    m.part('clackerLever', [0.021, 0.042, -0.01], () => {
      m.use(F.steel);
      m.side(
        poly([[0.006, 0.004], [0.018, -0.004], [0.024, -0.062], [0.014, -0.078], [0.004, -0.072], [0.012, -0.056], [0.006, -0.008]], 0.002),
        0.022,
        { bevel: 0.0012 },
      );
      m.use(F.red);
      m.at([0.009, -0.036, 0.01], null, () => m.box(0.024, 0.028, 0.006, 0.001));
    });
  });
}

function buildSatchel(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0014;
  buildPack(m);
  buildClacker(m);

  const model = new Model(m, kit.mats, {
    glows: {
      packLed: [0xff1e12, 7.5],
      clackerLed: [0xff2a14, 7.0],
    },
  });

  model.socket('muzzle', [0, 0.02, -0.14]);
  // Right hand grips the satchel pack's side & base; left hand holds the M57 clacker detonator.
  model.hand('gripR', [0.072, -0.026, 0.032], [-0.12, -0.96, 0.24], [-0.36, -0.18, -0.91], 'pack');
  model.hand('gripL', [-0.012, -0.016, 0.014], [0.16, -0.94, 0.28], [0.42, 0.04, -0.9], 'clacker');
  return model;
}

function clip(a: Anim): void {
  const P = a.parts;
  const pack = P.pack!;
  const clacker = P.clacker!;
  const lever = P.clackerLever!;

  // Blinking red armed LED on the satchel pack; urgent pulse on the clacker when charges are planted (`a.charge > 0`).
  const packPulse = 0.35 + 0.85 * (0.5 + 0.5 * Math.sin(a.time * 6.5));
  a.glow('packLed', packPulse);
  const armed = a.charge > 0.5;
  const clackerPulse = armed ? 0.65 + 0.85 * (0.5 + 0.5 * Math.sin(a.time * 12)) : 0.18;
  a.glow('clackerLed', clackerPulse);

  // Subtle breathing / carry tilt on the left-hand clacker.
  clacker.rotation.x += 0.14;
  clacker.rotation.y += 0.24;
  if (armed) {
    // Raise the clacker slightly into focus while charges are planted and ready to blow.
    clacker.position.y += 0.022;
    clacker.position.x += 0.018;
  }

  // Hide the right-hand satchel pack when empty (player still holds the clacker for planted charges).
  const emptyPack = a.mag <= 0 && a.reload < 0;
  if (emptyPack) {
    pack.visible = false;
    clacker.position.x += 0.03;
    clacker.position.y += 0.02;
  }

  const t = a.sinceFire;
  if (t < 0.72 && a.strength >= 0.5) {
    // LMB Toss: wind back, heave forward-upward, release, then lift a fresh satchel charge from the hip pouch.
    const wind = inOut(seg(t, 0, 0.1));
    const heave = outCubic(seg(t, 0.08, 0.24));
    const fresh = outCubic(seg(t, 0.44, 0.72));
    if (t < 0.24) {
      pack.position.z += wind * 0.05 - heave * 0.22;
      pack.position.y += -wind * 0.03 + heave * 0.12;
      pack.rotation.x += -wind * 0.28 + heave * 0.62;
      pack.rotation.z -= heave * 0.24;
    } else if (t < 0.44 || a.mag <= 0) {
      pack.visible = false;
    } else {
      const k = 1 - fresh;
      pack.position.y -= k * 0.24;
      pack.position.z += k * 0.08;
      pack.rotation.x -= k * 0.45;
    }
  } else if (t < 0.28 && a.strength < 0.5) {
    // RMB Clacker Detonate: sharp squeeze on the left-hand firing lever + bright LED flash.
    const squeeze = bump(t, 0, 0.26);
    lever.rotation.z += squeeze * 0.42;
    clacker.position.y += squeeze * 0.018;
    clacker.rotation.x += squeeze * 0.18;
    a.glow('clackerLed', 2.2);
  }

  // Draw: lift pack and clacker smoothly from the belt.
  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.14;
    a.gunR.x -= k * 0.36;
  }

  // Reload: right hand drops to the demolition pouch to pull fresh charges while the clacker stays up.
  const p = a.reload;
  if (p >= 0) {
    const dip = hold(p, 0.04, 0.22, 0.68, 0.92);
    pack.position.y -= dip * 0.26;
    pack.position.z += dip * 0.06;
    pack.rotation.x -= dip * 0.55;
    if (p > 0.24 && p < 0.56) pack.visible = false;
    clacker.position.y += inOut(seg(p, 0.08, 0.24)) * (1 - inQuad(seg(p, 0.72, 0.92))) * 0.015;
  }
}

export function satchelDef(kit: Kit): ViewDef {
  return {
    id: 'satchel',
    model: buildSatchel(kit),
    pos: [0.16, -0.17, -0.4],
    rot: [0.06, -0.14, 0.04],
    recoil: { back: 0.032, lift: 0.014, pitch: 0.07, yaw: 0.012, roll: 0.02, omega: 22, zeta: 0.62 },
    right: { socket: 'gripR', pose: HANDS.cup },
    left: { socket: 'gripL', pose: HANDS.radio },
    animate: clip,
  };
}
