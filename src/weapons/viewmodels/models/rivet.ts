/**
 * The Rivet: a service pistol, and the Judge's opposite on slot 6. Black polymer frame, a grey slide with lightening
 * cuts that show the barrel, an orange front sight, a long magazine. The slide really runs: back on every shot, locked
 * open on the last one, dropped by the thumb at the end of a reload. Origin at the top of the grip.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Finish, Mesher } from '../kit/mesher';
import { curve, poly, slotRow, type V2 } from '../kit/shapes';
import { screwX } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { pullTrigger, round } from './common';

const BORE = 0.034;
const SLIDE_Z = -0.04;
const MUZZLE = -0.146;
const SLIDE_TRAVEL = 0.038;
const SLIDE_GREY: Finish = { color: 0x7c828a, rough: 0.38, metal: 0.85, wear: 0.5, kind: 3 };

function frame(m: Mesher): void {
  m.use(F.polymer);
  // Dust cover and rails: one moulding from the muzzle back to the beavertail.
  m.side(poly([[0.058, 0.004], [0.066, 0.02, 0.006], [0.05, 0.0215, 0.003], [-0.132, 0.0215, 0.002], [-0.134, 0.004, 0.004], [-0.112, -0.004, 0.003], [-0.03, -0.01, 0.003]], 0.002), 0.027, { bevel: 0.0014 });
  // Accessory rail cut into the dust cover.
  m.use(F.polymerGrey);
  for (let i = 0; i < 3; i++) m.at([0, -0.002, -0.066 - i * 0.02], null, () => m.box(0.0285, 0.006, 0.008, 0.0008));
  // Slide stop and takedown lever on the left.
  m.use(F.steelDark);
  m.at([-0.0142, 0.014, 0.018], null, () => m.box(0.0024, 0.006, 0.03, 0.0008));
  m.at([-0.0142, 0.012, -0.046], null, () => m.box(0.002, 0.007, 0.012, 0.0008));
  m.mirror(() => screwX(m, 0.0139, 0.009, 0.044, 1, 0.002));
  m.at([-0.0138, 0.012, -0.092], [0, -Math.PI / 2, 0], () => m.decal('cal10', 0.034, 0.0052, 0x9aa0a6));

  // Grip: stippled all round, with a flared well.
  const front = curve([[0.022, -0.01], [0.024, -0.034], [0.03, -0.054], [0.033, -0.074], [0.039, -0.096], [0.044, -0.118]], 5);
  const back = curve([[0.098, -0.118], [0.097, -0.088], [0.09, -0.05], [0.078, -0.016], [0.064, 0.016]], 5);
  const outline: V2[] = [...front, [0.046, -0.124], [0.096, -0.124], ...back];
  m.use(F.polymer);
  m.side(outline, 0.03, { bevel: 0.0042, smooth: 46 });
  m.use(F.polymerStipple);
  m.mirror(() => m.at([0.0148, 0, 0], null, () => m.side(poly([[0.036, -0.022], [0.074, -0.02], [0.09, -0.11], [0.05, -0.112]], 0.005), 0.0024, { bevel: 0.0009 })));
  m.use(F.polymerGrey);
  m.at([0, -0.1255, 0.071], null, () => m.box(0.034, 0.006, 0.058, 0.0016, 0.004));
  // Trigger guard, squared at the front for the off hand's finger.
  m.use(F.polymer);
  m.side(poly([[-0.03, -0.006], [-0.04, -0.012, 0.004], [-0.04, -0.036, 0.006], [0.016, -0.04, 0.008], [0.032, -0.014, 0.004], [0.032, -0.006]], 0.002), 0.0115, {
    bevel: 0.001,
    holes: [poly([[-0.03, -0.0115], [-0.035, -0.015, 0.003], [-0.035, -0.032, 0.005], [0.012, -0.035, 0.005], [0.025, -0.013, 0.003]], 0.002)],
  });
}

function barrel(m: Mesher): void {
  // Fixed to the frame, so the slide's cuts slide over it.
  m.at([0, BORE, 0], null, () => {
    m.use(F.steel);
    m.lathe([[0.0068, 0.016, 0], [0.0068, MUZZLE + 0.004], [0.0062, MUZZLE], [0.0046, MUZZLE, 0]], 16);
    m.use(F.black);
    m.lathe([[0.0046, MUZZLE + 0.0004, 0], [0.0042, MUZZLE + 0.02, 0], [0, MUZZLE + 0.021, 0]], 12);
    // Chamber hood, seen through the port.
    m.use(F.steelDark);
    m.at([0, 0.002, 0.008], null, () => m.box(0.016, 0.016, 0.03, 0.001));
  });
  // Recoil spring guide under it.
  m.use(F.steelDark);
  m.at([0, BORE - 0.0125, -0.07], null, () => m.cyl(0.0036, 0.13, 10));
}

function slide(m: Mesher): void {
  m.part('slide', [0, BORE, SLIDE_Z], () => {
    m.use(SLIDE_GREY);
    // Angled lightening cuts ahead of the port: the barrel shows through three windows.
    const body = poly([[0.102, -0.0115], [0.104, 0.012, 0.004], [0.096, 0.0205, 0.004], [-0.098, 0.0205, 0.004], [-0.106, 0.012, 0.004], [-0.106, -0.0115]], 0.0015);
    m.side(body, 0.0285, { bevel: 0.0022, holes: slotRow(-0.03, 0.0035, -0.082, 0.0035, 3, 0.013, 0.006, 1.05) });
    // Ejection port on the right and top.
    m.use(F.black);
    m.at([0.0136, 0.006, 0.02], null, () => m.box(0.0018, 0.012, 0.034, 0));
    m.at([0.005, 0.0202, 0.02], null, () => m.box(0.014, 0.0012, 0.034, 0));
    // Rear serrations, raked forward.
    m.use(F.steelDark);
    m.mirror(() => {
      for (let i = 0; i < 6; i++) m.at([0.0145, 0.003, 0.058 + i * 0.0065], [0.3, 0, 0], () => m.box(0.0012, 0.022, 0.003, 0.0004));
    });
    // Sights: a square notch, and a fibre post that glows.
    m.use(F.blued);
    m.at([0, 0.0245, 0.088], null, () => {
      m.mirror(() => m.at([0.0062, 0, 0], null, () => m.box(0.0052, 0.008, 0.012, 0.0009)));
      m.at([0, -0.0028, 0], null, () => m.box(0.0175, 0.0026, 0.012, 0.0006));
    });
    m.at([0, 0.0238, -0.092], null, () => m.side(poly([[0.008, -0.003], [0.004, 0.0045, 0.001], [-0.006, 0.0045, 0.001], [-0.008, -0.003]], 0.0006), 0.0042, { bevel: 0.0005 }));
    m.glow('sight', () => m.at([0, 0.0262, -0.0872], null, () => m.cyl(0.0012, 0.0012, 8, 0)));
    // Extractor and the stencil on the left flat.
    m.use(F.steelDark);
    m.at([0.0144, 0.003, 0.044], null, () => m.box(0.0012, 0.004, 0.02, 0.0004));
    m.at([-0.01445, 0.004, 0.012], [0, -Math.PI / 2, 0], () => m.decal('rivet', 0.046, 0.0115, 0x24272b));
  });
}

function magazine(m: Mesher): void {
  // Part space: origin at the mouth of the well. It follows the rake of the grip.
  m.part('mag', [0, -0.01, 0.052], () => {
    m.at([0, 0, 0], [-0.19, 0, 0], () => {
      m.use(F.steelDark);
      m.side(poly([[-0.017, 0.022], [0.017, 0.022], [0.017, -0.118, 0.003], [-0.017, -0.118, 0.003]], 0.0015), 0.021, { bevel: 0.0012 });
      // Witness holes down the back.
      m.use(F.black);
      for (let i = 0; i < 5; i++) m.at([0, -0.03 - i * 0.017, 0.0172], null, () => m.cyl(0.0022, 0.0012, 8, 0));
      // Extended pad: the three extra rounds live in it.
      m.use(F.polymerGrey);
      m.at([0, -0.126, 0.003], null, () => m.box(0.03, 0.018, 0.046, 0.003, 0.005));
      m.use(F.steel);
      m.mirror(() => m.at([0.0078, 0.0225, 0], null, () => m.box(0.0022, 0.005, 0.03, 0.0005)));
      m.at([0, 0.025, -0.004], [0.06, 0, 0], () => round(m, 0.0052, 0.018, 0.012));
    });
  });
}

function buildRivet(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0011;
  frame(m);
  barrel(m);
  slide(m);
  magazine(m);
  m.part('trigger', [0, -0.006, -0.008], () => {
    m.use(F.steelDark);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0038, -0.02, 0.0015], [0.0005, -0.021, 0.001], [-0.0035, -0.0095, 0.003]], 0.001), 0.0062, { bevel: 0.0007 });
  });
  const model = new Model(m, kit.mats, { glows: { sight: [0xff7a1a, 7] } });
  model.socket('muzzle', [0, BORE, MUZZLE - 0.006]);
  model.socket('eject', [0.018, BORE + 0.008, -0.02]);
  model.hand('gripR', [0.0195, -0.068, 0.066], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  // The off hand wraps the shooting hand, thumbs forward under the slide.
  model.hand('gripL', [-0.023, -0.08, 0.058], [-0.05, 0.3, -0.95], [0.86, -0.42, -0.25]);
  model.hand('magHold', [-0.014, -0.1, 0.012], [-0.3, 0.1, -0.95], [0.9, -0.1, -0.35], 'mag');
  return model;
}

function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a, 0.05, 0.36);
  a.glow('sight', 1);
  const t = a.sinceFire;
  const p = a.reload;
  // Out and back inside 70 ms, so ten shots a second never catch it half way.
  const cycle = t < 0.07 ? Math.sin((t / 0.07) * Math.PI) : 0;
  // Locked open on an empty magazine, until the reload's last beat drops it.
  let back = cycle;
  if (a.mag <= 0) back = p >= 0.8 ? 1 - seg(p, 0.8, 0.84) : 1;
  P.slide!.position.z += back * SLIDE_TRAVEL;
  // A light gun snaps in the wrist: the muzzle flips and rolls on every shot.
  a.gunR.z += t < 0.12 ? bump(t, 0, 0.12) * 0.05 : 0;

  if (a.draw < 1) {
    // Straight up out of the holster and punched out to the sights.
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.09;
    a.gunP.z += k * 0.07;
    a.gunR.x += k * 0.55;
  }
  if (p < 0) return;

  // Foley: out at 0.05, in at 0.5, slide at 0.82.
  const mag = P.mag!;
  const out = seg(p, 0.05, 0.2);
  const inn = seg(p, 0.36, 0.5);
  const away = inQuad(out) * (1 - outCubic(inn));
  mag.position.y -= away * 0.3;
  mag.position.z += away * 0.058;
  if (p > 0.22 && p < 0.34) mag.visible = false;
  const seat = p >= 0.5 ? thud(seg(p, 0.5, 0.62)) : 0;

  // Canted in to look at the well, bumped by the magazine going home, snapped level as the slide drops.
  const present = hold(p, 0.0, 0.12, 0.74, 0.88);
  const snap = bump(p, 0.8, 0.95);
  a.gunR.z -= present * 0.62;
  a.gunR.x += present * 0.42 + seat * 0.07 - snap * 0.06;
  a.gunR.y += present * 0.1;
  a.gunP.x -= present * 0.05;
  // Lifted well clear of the bottom of the screen: the magazine going in is the whole show on a gun this small.
  a.gunP.y += present * 0.105 + seat * 0.012;
  a.gunP.z += present * 0.07 + snap * 0.012;

  const h = a.left;
  h.fingerRate = 44;
  h.to('pouchL', inOut(seg(p, 0.04, 0.2)));
  h.to('magHold', inOut(seg(p, 0.3, 0.42)));
  h.to('gripL', inOut(seg(p, 0.64, 0.8)));
  h.shape(HANDS.cup, hold(p, 0.24, 0.36, 0.56, 0.64));
}

export function rivetDef(kit: Kit): ViewDef {
  return {
    id: 'rivet',
    model: buildRivet(kit),
    pos: [0.128, -0.126, -0.4],
    rot: [0.02, 0.06, 0],
    // ADS: the fibre post in the notch, at rest on the slide.
    sight: [0, 0.0602, -0.1272], rear: [0, 0.061, 0.048], relief: 0.3,
    recoil: { back: 0.024, lift: 0.01, pitch: 0.12, yaw: 0.014, roll: 0.03, omega: 38, zeta: 0.5 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.support },
    heatPerShot: 0.02,
    animate: clip,
  };
}
