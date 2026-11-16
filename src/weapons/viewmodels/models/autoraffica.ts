/**
 * The Autoraffica: a machine pistol on a service-pistol frame, its barrel inside a deep square suppressor that is part of the
 * gun, long and slim. The can is a hollow box of plates: long slots and three round ports down the upper flanks show the
 * barrel inside, ribs run along its lower half, a vented top carries a ramp and post, and the bore sits high on its blunt
 * face over a red sensor eye (the smart aim's, lit while it is on). Behind it a slide with a notched rear blade cycles on
 * every round of the burst and locks open on an empty magazine. Three green dots, two on the blade and one on the post, line
 * up when it is aimed. An exposed hammer, a fire selector, a long magazine out of the grip, a cyan line down each flank and a
 * count on the left of the can. Origin at the top of the grip.
 *
 * Smart aim (weapons.smartAim, eased into `a.smart`, `a.lock`, `a.lockYaw`, `a.lockPitch` by the rig): on, the gun cants a
 * little; locked, it turns to the head, cants further and comes in toward the line of sight, as if aiming itself.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Finish, Mesher } from '../kit/mesher';
import { circle, curve, poly, rect, slotRow, type V2 } from '../kit/shapes';
import { screwX } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, outQuad, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { drawCount, pullTrigger, round } from './common';

const BORE = 0.036;
const SLIDE_Z = 0;
const SLIDE_TRAVEL = 0.03;
/** The can: from just ahead of the slide to its face, its top, foot and half width. Long and slim, its top under the slide's. */
const CAN_BACK = -0.05;
const CAN_FRONT = -0.305;
const CAN_TOP = 0.044;
const CAN_FOOT = -0.006;
const CAN_HALF = 0.0145;
const PLATE = 0.003;
const MUZZLE = CAN_FRONT - 0.012;
/**
 * The sight line, 1.6 cm over the can so nothing of it rises into the picture: the rear blade's top and the front post's
 * top both sit on it, so aimed the gun is level and the post stands in the notch, flush with the blade, the point of aim on
 * its top. The post stands at `FRONT_Z`, the blade at `REAR_Z` on the slide, 0.33 m apart.
 */
const SIGHT_Y = 0.06;
const FRONT_Z = CAN_FRONT + 0.016;
const REAR_Z = 0.05;
/** Gunmetal with a blue cast for the can and slide; the frame is black. */
const GUNMETAL: Finish = { color: 0x565c66, rough: 0.34, metal: 0.9, wear: 0.12, kind: 3 };
const GUNMETAL_DARK: Finish = { color: 0x2c3036, rough: 0.42, metal: 0.85, wear: 0.08 };

function frame(m: Mesher): void {
  m.use(F.polymer);
  // Dust cover into the can's back, and the beavertail.
  m.side(poly([
    [0.068, 0.002], [0.078, 0.018, 0.006], [0.06, 0.0185, 0.003], [-0.054, 0.0185, 0.002], [-0.056, -0.006, 0.002], [-0.03, -0.01, 0.003],
  ], 0.002), 0.024, { bevel: 0.0013 });
  // Slide stop, and the fire selector on the left over the grip: a lever with a red dot at its tip.
  m.use(GUNMETAL_DARK);
  m.at([-0.0128, 0.012, 0.012], null, () => m.box(0.0024, 0.005, 0.028, 0.0008));
  m.at([-0.0158, 0.004, 0.05], [0.5, 0, 0], () => m.box(0.003, 0.004, 0.022, 0.0009));
  m.use(F.bureauRed);
  m.at([-0.0172, 0.0, 0.041], null, () => m.box(0.0006, 0.0028, 0.0028, 0.0003));
  m.mirror(() => screwX(m, 0.0124, 0.007, 0.046, 1, 0.0019, GUNMETAL_DARK));

  // Grip: raked as a service pistol's, flat panels with two screws each.
  const front = curve([[0.022, -0.01], [0.024, -0.034], [0.029, -0.056], [0.033, -0.078], [0.038, -0.1], [0.042, -0.118]], 5);
  const back = curve([[0.098, -0.118], [0.097, -0.088], [0.091, -0.05], [0.079, -0.016], [0.066, 0.016]], 5);
  const outline: V2[] = [...front, [0.044, -0.124], [0.096, -0.124], ...back];
  m.use(F.polymer);
  m.side(outline, 0.03, { bevel: 0.0045, smooth: 46 });
  m.use(F.polymerStipple);
  m.mirror(() => {
    m.at([0.0153, 0, 0], null, () => m.side(poly([[0.035, -0.02], [0.074, -0.018], [0.09, -0.112], [0.048, -0.114]], 0.005), 0.0024, { bevel: 0.0009 }));
    screwX(m, 0.0167, -0.03, 0.06, 1, 0.0022, GUNMETAL_DARK);
    screwX(m, 0.0167, -0.1, 0.074, 1, 0.0022, GUNMETAL_DARK);
  });
  // Trigger guard, squared and hooked, its front under the can.
  m.use(F.polymer);
  m.side(poly([[-0.034, -0.006], [-0.046, -0.012, 0.004], [-0.048, -0.04, 0.004], [-0.042, -0.044, 0.003], [0.016, -0.044, 0.008], [0.032, -0.014, 0.004], [0.032, -0.006]], 0.002), 0.011, {
    bevel: 0.001,
    holes: [poly([[-0.034, -0.0115], [-0.041, -0.015, 0.003], [-0.042, -0.036, 0.004], [0.012, -0.038, 0.005], [0.025, -0.013, 0.003]], 0.002)],
  });
}

/** The suppressor: plates round a hollow, so the barrel shows through the slots. */
function can(m: Mesher): void {
  const zMid = (CAN_BACK + CAN_FRONT) / 2;
  const len = CAN_BACK - CAN_FRONT;
  const yMid = (CAN_TOP + CAN_FOOT) / 2;
  m.use(GUNMETAL);
  // The flanks: four long slots ahead of three round ports up top over the barrel, a chamfered nose and heel.
  const flank = poly([[CAN_BACK, CAN_TOP - 0.002], [CAN_FRONT + 0.004, CAN_TOP - 0.002], [CAN_FRONT, CAN_TOP - 0.006], [CAN_FRONT, CAN_FOOT + 0.004],
    [CAN_FRONT + 0.006, CAN_FOOT], [CAN_BACK - 0.008, CAN_FOOT], [CAN_BACK, CAN_FOOT + 0.008]], 0.002);
  const holes = [
    ...slotRow(-0.074, BORE, -0.2, BORE, 4, 0.03, 0.0056, 0),
    ...[0, 1, 2].map(i => circle(-0.228 - i * 0.02, BORE, 0.0038, 16)),
  ];
  m.mirror(() => m.at([CAN_HALF - PLATE / 2, 0, 0], null, () => m.side(flank, PLATE, { bevel: 0.0009, holes })));
  // Top plate with a row of short cross vents, foot plate, and the two ends.
  m.at([0, CAN_TOP - 0.0018, 0], null, () => m.top(rect(-CAN_HALF + 0.001, CAN_FRONT + 0.002, CAN_HALF - 0.001, CAN_BACK, 0.0025), 0.0036, {
    bevel: 0.001, holes: slotRow(0, -0.08, 0, -0.24, 7, 0.016, 0.0032, 0),
  }));
  m.at([0, CAN_FOOT + 0.0018, zMid - 0.002], null, () => m.box(CAN_HALF * 2 - 0.002, 0.0036, len - 0.01, 0.001));
  m.at([0, yMid, CAN_FRONT + 0.0024], null, () => m.box(CAN_HALF * 2 - 0.001, CAN_TOP - CAN_FOOT - 0.004, 0.0048, 0.0014));
  m.at([0, yMid + 0.002, CAN_BACK - 0.002], null, () => m.box(CAN_HALF * 2 - 0.002, CAN_TOP - CAN_FOOT - 0.01, 0.004, 0.001));
  // Inside: a dark baffle stack under the barrel, so the slots look into a gun and not into the far wall.
  m.use(F.black);
  m.at([0, 0.012, zMid], null, () => m.box(CAN_HALF * 2 - PLATE * 2 - 0.001, 0.026, len - 0.01, 0.001));
  // Three ribs down the lower flanks, ending short of the face.
  m.use(GUNMETAL_DARK);
  m.mirror(() => {
    for (let i = 0; i < 3; i++) {
      m.at([CAN_HALF + 0.001, 0.0135 - i * 0.0062, zMid - 0.004], null, () => m.box(0.0024, 0.0028, len - 0.03, 0.0007));
    }
  });
  // A thin cyan line between the slots and the ribs.
  m.glow('accent', () => m.mirror(() => m.at([CAN_HALF + 0.0002, 0.0236, zMid + 0.004], null, () => m.box(0.0008, 0.0011, len - 0.03, 0))));
  // The face: the muzzle high on it, the sensor eye under it in a dark bezel.
  m.at([0, BORE, CAN_FRONT], null, () => {
    m.use(GUNMETAL_DARK);
    m.lathe([[0.0094, 0.0005, 0], [0.0094, -0.01], [0.0082, -0.012], [0.0052, -0.012, 0]], 20);
    m.use(F.black);
    m.lathe([[0.0052, -0.0119, 0], [0.0046, -0.005, 0], [0, -0.0045, 0]], 16);
  });
  m.use(F.black);
  m.at([0, 0.009, CAN_FRONT - 0.0004], null, () => m.front(rect(-0.0075, -0.0042, 0.0075, 0.0042, 0.0018), 0.0018, { bevel: 0.0005 }));
  m.glow('eye', () => m.at([0, 0.009, CAN_FRONT - 0.0014], null, () => m.cyl(0.0026, 0.0012, 14, 0)));
  // The front sight: a ramp off the can's top up to a thin square post, its top on the sight line, a red dot under the top.
  m.use(GUNMETAL_DARK);
  m.side(poly([[FRONT_Z + 0.026, CAN_TOP], [FRONT_Z + 0.004, SIGHT_Y - 0.007, 0.002], [FRONT_Z - 0.005, SIGHT_Y - 0.007, 0.001], [FRONT_Z - 0.007, CAN_TOP]], 0.0006), 0.008, { bevel: 0.0008 });
  m.use(F.blued);
  m.side(poly([[FRONT_Z + 0.0016, SIGHT_Y - 0.008], [FRONT_Z + 0.0016, SIGHT_Y], [FRONT_Z - 0.003, SIGHT_Y], [FRONT_Z - 0.004, SIGHT_Y - 0.008]], 0.0002), 0.0032, { bevel: 0.0003 });
  m.glow('sight', () => m.at([0, SIGHT_Y - 0.0026, FRONT_Z + 0.0019], null, () => m.cyl(0.001, 0.0006, 10, 0)));
  // The count on the left flank, in a black bezel; the name stencilled ahead of it, between the line and the ribs.
  m.at([-CAN_HALF - 0.0004, 0.028, -0.072], [0, -Math.PI / 2, 0], () => {
    m.use(F.polymer);
    m.prism(rect(-0.016, -0.0052, 0.016, 0.0052, 0.0014), 0.0016, { bevel: 0.0005, holes: [rect(-0.0142, -0.0038, 0.0142, 0.0038, 0.0005)] });
    m.use(F.black);
    m.at([0, 0, -0.0004], null, () => m.prism(rect(-0.0146, -0.0042, 0.0146, 0.0042, 0.0005), 0.0008, { bevel: 0 }));
    m.at([0, 0, 0.0002], null, () => m.screen('count', 0.0282, 0.0078));
  });
  m.at([-CAN_HALF - 0.0003, 0.0195, -0.2], [0, -Math.PI / 2, 0], () => m.decal('autoraffica', 0.058, 0.0062, 0xaab1ba));
}

function barrel(m: Mesher): void {
  m.at([0, BORE, 0], null, () => {
    m.use(F.steel);
    m.lathe([[0.0062, 0.018, 0], [0.0062, CAN_FRONT + 0.004], [0.0055, CAN_FRONT + 0.002, 0]], 18);
    m.use(F.steelDark);
    m.at([0, 0.002, 0.008], null, () => m.box(0.016, 0.016, 0.036, 0.001));
  });
  // Recoil spring guide under it.
  m.use(GUNMETAL_DARK);
  m.at([0, BORE - 0.012, -0.03], null, () => m.cyl(0.0032, 0.05, 12));
}

function slide(m: Mesher): void {
  m.part('slide', [0, BORE, SLIDE_Z], () => {
    const top = SIGHT_Y - 0.0125 - BORE;
    m.use(GUNMETAL);
    // A long slim slide, its nose tucked into the can's back, chamfered along its top edges.
    m.side(poly([[0.068, -0.0175], [0.07, top - 0.006, 0.002], [0.064, top, 0.002], [-0.05, top, 0.002], [-0.052, -0.0175]], 0.0015), 0.024, { bevel: 0.0024 });
    // The rear sight: a low squared blade across the back, its top on the sight line, a clean notch the post shows in, and a
    // dot either side level with the post's.
    m.use(GUNMETAL_DARK);
    const y0 = top - 0.001;
    const y1 = SIGHT_Y - BORE;
    const ny = y1 - 0.0045;
    m.at([0, 0, REAR_Z - SLIDE_Z], null, () => m.front(poly([
      [-0.008, y0], [0.008, y0], [0.008, y1, 0.0008], [0.0022, y1], [0.0022, ny], [-0.0022, ny], [-0.0022, y1], [-0.008, y1, 0.0008],
    ], 0.0002), 0.007, { bevel: 0.0005 }));
    m.glow('sight', () => m.mirror(() => m.at([0.0052, y1 - 0.0026, REAR_Z - SLIDE_Z + 0.0037], null, () => m.cyl(0.0009, 0.0006, 10, 0))));
    m.use(F.black);
    // Ejection port on the right, serrations either side at the back.
    m.at([0.0119, 0.0, -0.012], null, () => m.box(0.0014, 0.011, 0.034, 0));
    m.use(GUNMETAL_DARK);
    m.mirror(() => {
      for (let i = 0; i < 6; i++) m.at([0.0122, -0.005, 0.03 + i * 0.0056], [0.26, 0, 0], () => m.box(0.0012, 0.018, 0.0024, 0.0004));
    });
    m.glow('accent', () => m.mirror(() => m.at([0.0121, -0.012, -0.004], null, () => m.box(0.0008, 0.001, 0.084, 0))));
  });
}

function magazine(m: Mesher): void {
  m.part('mag', [0, -0.01, 0.052], () => {
    m.at([0, 0, 0], [-0.19, 0, 0], () => {
      m.use(GUNMETAL_DARK);
      // A long magazine: half again out of the grip, as the burst pistols carry.
      m.side(poly([[-0.018, 0.022], [0.018, 0.022], [0.018, -0.152, 0.003], [-0.018, -0.152, 0.003]], 0.0015), 0.023, { bevel: 0.0012 });
      m.use(F.black);
      for (let i = 0; i < 5; i++) m.at([0, -0.04 - i * 0.022, 0.0182], null, () => m.cyl(0.0022, 0.0012, 8, 0));
      m.use(F.polymer);
      m.at([0, -0.156, 0.002], null, () => m.box(0.03, 0.01, 0.044, 0.003, 0.004));
      m.use(F.steel);
      m.at([0, 0.026, -0.004], [0.06, 0, 0], () => round(m, 0.0048, 0.019, 0.011));
    });
  });
}

function buildAutoraffica(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0011;
  frame(m);
  barrel(m);
  can(m);
  slide(m);
  magazine(m);
  // An exposed ring hammer behind the slide, rocked back by it on every round.
  m.part('hammer', [0, 0.024, 0.072], () => {
    m.use(GUNMETAL_DARK);
    m.side(poly([[-0.004, -0.004], [0.004, -0.006], [0.007, 0.01, 0.003], [0.012, 0.018, 0.004], [0.004, 0.02, 0.003], [-0.003, 0.008]], 0.001), 0.007, {
      bevel: 0.0007, holes: [circle(0.0055, 0.0142, 0.002, 10)],
    });
  });
  m.part('trigger', [0, -0.006, -0.012], () => {
    m.use(F.steelDark);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.0025, -0.008, 0.001], [0.004, -0.02, 0.001], [0.0, -0.021, 0.001], [-0.0035, -0.009, 0.002]], 0.001), 0.0064, { bevel: 0.0007 });
  });
  const model = new Model(m, kit.mats, {
    glows: { sight: [0x7dff6a, 6], accent: [0x36d6ff, 3], eye: [0xff2a3a, 6] },
    screens: { count: [192, 54] },
  });
  model.socket('muzzle', [0, BORE, MUZZLE]);
  model.socket('eject', [0.016, BORE + 0.006, 0.0]);
  model.hand('gripR', [0.0205, -0.068, 0.067], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.pistolSupport('gripL', [-0.031, -0.072, 0.062]);
  model.hand('magHold', [-0.016, -0.11, 0.012], [-0.3, 0.1, -0.95], [0.9, -0.1, -0.35], 'mag');
  return model;
}

function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a, 0.04, 0.36);
  a.glow('sight', 1);
  const t = a.sinceFire;
  const p = a.reload;
  // Back in 12 ms and home by 40, inside the 50 ms between the rounds of a burst.
  let back = t < 0.012 ? outQuad(t / 0.012) : t < 0.04 ? 1 - inOut(seg(t, 0.012, 0.04)) : 0;
  if (a.mag <= 0) back = p >= 0.82 ? 1 - seg(p, 0.82, 0.86) : 1;
  P.slide!.position.z += back * SLIDE_TRAVEL;
  P.hammer!.rotation.x += back * 0.35;
  a.glow('accent', 1 + (t < 0.15 ? (1 - t / 0.15) * 1.8 : 0));
  // The eye wakes with the smart aim, and burns while it holds a head.
  a.glow('eye', 0.12 + a.smart * 0.7 + a.lock * (1.6 + Math.sin(a.time * 30) * 0.4));
  // A light gun, a quick flip a round: three of them walk the muzzle up through a burst.
  if (t < 0.1) a.gunR.x += bump(t, 0, 0.1) * 0.025;

  // Smart aim: canted on, and turned to the head while it is locked, brought in toward the eye line.
  const cant = a.smart * 0.07 + a.lock * 0.16;
  a.gunR.z += cant;
  a.gunR.y += a.lock * a.lockYaw;
  a.gunR.x += a.lock * a.lockPitch;
  a.gunP.x -= a.lock * 0.014;
  a.gunP.y += a.lock * 0.008;

  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.1;
    a.gunP.z += k * 0.07;
    a.gunR.x += k * 0.6;
  }
  if (p < 0) return;

  // Foley: out at 0.05, in at 0.5, slide at 0.84.
  const mag = P.mag!;
  const out = seg(p, 0.05, 0.2);
  const inn = seg(p, 0.36, 0.5);
  const away = inQuad(out) * (1 - outCubic(inn));
  mag.position.y -= away * 0.34;
  mag.position.z += away * 0.06;
  if (p > 0.22 && p < 0.34) mag.visible = false;
  const seat = p >= 0.5 ? thud(seg(p, 0.5, 0.62)) : 0;

  const present = hold(p, 0.0, 0.12, 0.74, 0.88);
  const snap = bump(p, 0.82, 0.96);
  a.gunR.z -= present * 0.55;
  a.gunR.x += present * 0.24 + seat * 0.06 - snap * 0.06;
  a.gunR.y += present * 0.08;
  a.gunP.x -= present * 0.04;
  a.gunP.y += present * 0.06 + seat * 0.01;
  a.gunP.z += present * 0.05 + snap * 0.012;

  const h = a.left;
  h.fingerRate = 44;
  h.to('pouchL', inOut(seg(p, 0.04, 0.2)));
  h.to('magHold', inOut(seg(p, 0.3, 0.42)));
  h.to('gripL', inOut(seg(p, 0.66, 0.8)));
  h.shape(HANDS.cup, hold(p, 0.24, 0.36, 0.56, 0.66));
}

export function autorafficaDef(kit: Kit): ViewDef {
  return {
    id: 'autoraffica',
    model: buildAutoraffica(kit),
    pos: [0.13, -0.13, -0.38],
    rot: [0.02, 0.06, 0],
    // ADS: the post's top flush with the blade's in the notch, both on the sight line, so the gun sits level and the three
    // dots line up. The post is 0.62 m out and the blade 0.29 m: far enough that the blade hides little round the target.
    sight: [0, SIGHT_Y, FRONT_Z], rear: [0, SIGHT_Y, REAR_Z - 0.0035], relief: 0.62,
    recoil: { back: 0.022, lift: 0.008, pitch: 0.07, yaw: 0.012, roll: 0.016, omega: 36, zeta: 0.6 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.pistolSupport },
    heatPerShot: 0.015,
    animate: clip,
    readout: a => drawCount(a, 'count', 2, 7, '#36d6ff'),
  };
}
