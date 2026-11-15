/**
 * The Ultramag: a heavy-calibre long-slide pistol. A stainless slide faceted along its top, flat on top with a vented rib
 * the length of it, a raked nose and lightening cuts that show the barrel; a black frame with an under-lug, a squared guard
 * and a stippled grip; a thin cyan line down each flank. The slide really runs, far and slow enough to see: back on every
 * shot, locked open on the last, dropped at the end of a reload. Origin at the top of the grip.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Finish, Mesher } from '../kit/mesher';
import { curve, poly, slotRow, type V2 } from '../kit/shapes';
import { screwX } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, outQuad, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { pullTrigger, round } from './common';

const BORE = 0.04;
const SLIDE_Z = -0.07;
const MUZZLE = -0.214;
const SLIDE_TRAVEL = 0.05;
const STAINLESS: Finish = { color: 0xa9adb3, rough: 0.27, metal: 1, wear: 0.05, kind: 3 };
const STAINLESS_DARK: Finish = { color: 0x70747a, rough: 0.34, metal: 1, wear: 0.1 };

function frame(m: Mesher): void {
  m.use(F.polymer);
  // Dust cover, under-lug and beavertail in one moulding. The lug runs out under the barrel to the slide's nose.
  m.side(poly([
    [0.068, 0.002], [0.078, 0.02, 0.006], [0.06, 0.0215, 0.003], [-0.196, 0.0215, 0.002], [-0.2, 0.012, 0.002],
    [-0.19, -0.004, 0.004], [-0.12, -0.008, 0.003], [-0.03, -0.01, 0.003],
  ], 0.002), 0.03, { bevel: 0.0015 });
  m.use(F.polymerGrey);
  for (let i = 0; i < 4; i++) m.at([0, -0.007, -0.09 - i * 0.022], null, () => m.box(0.031, 0.006, 0.009, 0.0008));
  // Slide stop and takedown lever on the left, pins through the frame.
  m.use(STAINLESS_DARK);
  m.at([-0.0158, 0.014, 0.016], null, () => m.box(0.0026, 0.007, 0.034, 0.0008));
  m.at([-0.0156, 0.011, -0.05], null, () => m.box(0.0022, 0.008, 0.014, 0.0008));
  m.mirror(() => {
    screwX(m, 0.0154, 0.01, 0.046, 1, 0.0021, STAINLESS_DARK);
    screwX(m, 0.0154, 0.006, -0.16, 1, 0.0021, STAINLESS_DARK);
  });
  m.at([-0.0152, 0.006, -0.11], [0, -Math.PI / 2, 0], () => m.decal('cal50m', 0.04, 0.0062, 0x9aa0a6));

  // Grip: the Rivet's, a shade wider, stippled, with a flared well.
  const front = curve([[0.022, -0.01], [0.024, -0.034], [0.03, -0.054], [0.033, -0.074], [0.039, -0.096], [0.044, -0.118]], 5);
  const back = curve([[0.1, -0.118], [0.099, -0.088], [0.092, -0.05], [0.08, -0.016], [0.066, 0.016]], 5);
  const outline: V2[] = [...front, [0.046, -0.124], [0.098, -0.124], ...back];
  m.use(F.polymer);
  m.side(outline, 0.034, { bevel: 0.0045, smooth: 46 });
  m.use(F.polymerStipple);
  m.mirror(() => m.at([0.0168, 0, 0], null, () => m.side(poly([[0.036, -0.022], [0.076, -0.02], [0.092, -0.11], [0.05, -0.112]], 0.005), 0.0024, { bevel: 0.0009 })));
  m.use(STAINLESS_DARK);
  m.at([0, -0.1265, 0.072], null, () => m.box(0.038, 0.007, 0.06, 0.0016, 0.004));
  // Trigger guard, squared and hooked at the front for the off hand's finger.
  m.use(F.polymer);
  m.side(poly([[-0.032, -0.006], [-0.044, -0.012, 0.004], [-0.046, -0.04, 0.004], [-0.04, -0.044, 0.003], [0.016, -0.044, 0.008], [0.032, -0.014, 0.004], [0.032, -0.006]], 0.002), 0.012, {
    bevel: 0.001,
    holes: [poly([[-0.032, -0.0115], [-0.039, -0.015, 0.003], [-0.04, -0.036, 0.004], [0.012, -0.038, 0.005], [0.025, -0.013, 0.003]], 0.002)],
  });
}

function barrel(m: Mesher): void {
  // Fixed to the frame, so the slide's cuts run over it.
  m.at([0, BORE, 0], null, () => {
    m.use(F.steel);
    m.lathe([[0.0088, 0.02, 0], [0.0088, MUZZLE + 0.006], [0.008, MUZZLE], [0.0062, MUZZLE, 0]], 18);
    m.use(F.black);
    m.lathe([[0.0062, MUZZLE + 0.0004, 0], [0.0058, MUZZLE + 0.025, 0], [0, MUZZLE + 0.026, 0]], 14);
    m.use(F.steelDark);
    m.at([0, 0.002, 0.01], null, () => m.box(0.02, 0.02, 0.04, 0.001));
  });
  // Recoil spring guide, its end in the lug's nose.
  m.use(STAINLESS_DARK);
  m.at([0, BORE - 0.0145, -0.1], null, () => m.cyl(0.0042, 0.19, 12));
}

function slide(m: Mesher): void {
  m.part('slide', [0, BORE, SLIDE_Z], () => {
    m.use(STAINLESS);
    // The lower body, nose raked back at the top, with three angled windows over the barrel.
    const body = poly([[0.135, -0.0195], [0.138, 0.006, 0.002], [-0.13, 0.006], [-0.144, -0.0195, 0.003]], 0.0015);
    m.side(body, 0.032, { bevel: 0.0022, holes: slotRow(-0.04, -0.006, -0.11, -0.006, 3, 0.016, 0.0062, 1.1) });
    // The crown: facets either side of a flat top.
    m.at([0, 0, 0.0055], null, () => m.front(poly([[-0.016, 0.0045], [0.016, 0.0045], [0.016, 0.0095, 0.001], [0.0105, 0.0195, 0.001], [-0.0105, 0.0195, 0.001], [-0.016, 0.0095, 0.001]], 0.0008), 0.259, { bevel: 0.0018 }));
    // Vented rib: a bar on posts, light between them.
    m.use(STAINLESS_DARK);
    m.at([0, 0.0232, -0.006], null, () => m.box(0.0095, 0.003, 0.232, 0.0008));
    for (let i = 0; i < 10; i++) m.at([0, 0.0205, 0.104 - i * 0.0244], null, () => m.box(0.0075, 0.003, 0.012, 0.0005));
    m.use(F.black);
    m.at([0, 0.0196, -0.006], null, () => m.box(0.0058, 0.0008, 0.226, 0));
    // Ejection port on the right, cut down through the facet.
    m.at([0.0156, 0.004, 0.04], null, () => m.box(0.0018, 0.014, 0.04, 0));
    m.at([0.008, 0.0125, 0.04], [0, 0, -0.9], () => m.box(0.0016, 0.012, 0.04, 0));
    // Serrations, raked, at the back and the front.
    m.use(F.steelDark);
    m.mirror(() => {
      for (let i = 0; i < 7; i++) m.at([0.0162, -0.006, 0.092 + i * 0.0062], [0.32, 0, 0], () => m.box(0.0012, 0.022, 0.0028, 0.0004));
      for (let i = 0; i < 5; i++) m.at([0.0162, -0.006, -0.118 + i * 0.0062], [-0.32, 0, 0], () => m.box(0.0012, 0.02, 0.0028, 0.0004));
    });
    // Sights on the rib: a square notch at the back, a post with a fibre at the front.
    m.use(F.blued);
    m.at([0, 0.0281, 0.12], null, () => {
      m.mirror(() => m.at([0.0055, 0, 0], null, () => m.box(0.0055, 0.0072, 0.012, 0.0009)));
      m.at([0, -0.0022, 0], null, () => m.box(0.0165, 0.0028, 0.012, 0.0006));
    });
    m.at([0, 0.0269, -0.115], null, () => m.side(poly([[0.008, -0.0025], [0.004, 0.0027, 0.001], [-0.005, 0.0027, 0.001], [-0.008, -0.0025]], 0.0006), 0.0044, { bevel: 0.0005 }));
    m.glow('sight', () => m.at([0, 0.0289, -0.1135], null, () => m.cyl(0.0012, 0.0012, 8, 0)));
    // The line down each flank.
    m.glow('accent', () => m.mirror(() => m.at([0.01615, -0.0118, -0.03], null, () => m.box(0.0008, 0.0011, 0.17, 0))));
    m.use(F.steelDark);
    m.at([0.0162, 0.0, 0.062], null, () => m.box(0.0012, 0.004, 0.022, 0.0004));
    m.at([-0.01625, -0.0005, 0.03], [0, -Math.PI / 2, 0], () => m.decal('ultramag', 0.06, 0.01, 0x2a2d31));
  });
}

function magazine(m: Mesher): void {
  m.part('mag', [0, -0.01, 0.052], () => {
    m.at([0, 0, 0], [-0.19, 0, 0], () => {
      m.use(STAINLESS_DARK);
      m.side(poly([[-0.019, 0.022], [0.019, 0.022], [0.019, -0.118, 0.003], [-0.019, -0.118, 0.003]], 0.0015), 0.024, { bevel: 0.0012 });
      m.use(F.black);
      for (let i = 0; i < 4; i++) m.at([0, -0.03 - i * 0.02, 0.0192], null, () => m.cyl(0.0024, 0.0012, 8, 0));
      m.use(F.polymer);
      m.at([0, -0.122, 0.002], null, () => m.box(0.032, 0.012, 0.048, 0.003, 0.004));
      m.use(F.steel);
      m.mirror(() => m.at([0.009, 0.0225, 0], null, () => m.box(0.0024, 0.005, 0.034, 0.0005)));
      m.at([0, 0.026, -0.004], [0.06, 0, 0], () => round(m, 0.0064, 0.022, 0.016));
    });
  });
}

function buildUltramag(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0011;
  frame(m);
  barrel(m);
  slide(m);
  magazine(m);
  // An exposed spur hammer behind the slide, rocked back by it on every shot.
  m.part('hammer', [0, 0.024, 0.07], () => {
    m.use(STAINLESS_DARK);
    m.side(poly([[-0.004, -0.004], [0.004, -0.006], [0.006, 0.012, 0.002], [0.016, 0.02, 0.003], [0.014, 0.024, 0.002], [0.002, 0.016, 0.002], [-0.004, 0.006]], 0.001), 0.007, { bevel: 0.0007 });
  });
  m.part('trigger', [0, -0.006, -0.01], () => {
    m.use(F.steelDark);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.0025, -0.008, 0.001], [0.004, -0.02, 0.001], [0.0, -0.021, 0.001], [-0.0035, -0.009, 0.002]], 0.001), 0.0064, { bevel: 0.0007 });
  });
  const model = new Model(m, kit.mats, { glows: { sight: [0x5cff7a, 7], accent: [0x36d6ff, 3.5] } });
  model.socket('muzzle', [0, BORE, MUZZLE - 0.006]);
  model.socket('eject', [0.02, BORE + 0.012, -0.03]);
  model.hand('gripR', [0.0205, -0.068, 0.067], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  // The off hand wraps the shooting hand, thumbs forward along the frame.
  model.hand('gripL', [-0.025, -0.08, 0.058], [-0.05, 0.3, -0.95], [0.86, -0.42, -0.25]);
  model.hand('magHold', [-0.016, -0.1, 0.012], [-0.3, 0.1, -0.95], [0.9, -0.1, -0.35], 'mag');
  return model;
}

function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a, 0.06, 0.36);
  a.glow('sight', 1);
  const t = a.sinceFire;
  const p = a.reload;
  // Back hard in 35 ms, held a beat, run home by 0.15 s: slow enough to see, well inside the refire.
  let back = t < 0.035 ? outQuad(t / 0.035) : t < 0.05 ? 1 : t < 0.15 ? 1 - inOut(seg(t, 0.05, 0.15)) : 0;
  // Locked open on an empty magazine, until the reload's last beat drops it.
  if (a.mag <= 0) back = p >= 0.8 ? 1 - seg(p, 0.8, 0.84) : 1;
  P.slide!.position.z += back * SLIDE_TRAVEL;
  // The hammer falls on the shot and the slide rides it back to full cock.
  P.hammer!.rotation.x += (t < 0.02 ? -0.5 : 0) + back * 0.25;
  a.glow('accent', 1 + (t < 0.2 ? (1 - t / 0.2) * 2.5 : 0));
  // A heavy round lifts the wrist: a big flip and roll on top of the spring's.
  if (t < 0.22) {
    a.gunR.x += bump(t, 0, 0.22) * 0.04;
    a.gunR.z += bump(t, 0, 0.16) * 0.03;
    a.gunP.z += bump(t, 0, 0.14) * 0.012;
  }

  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.1;
    a.gunP.z += k * 0.07;
    a.gunR.x += k * 0.6;
  }
  if (p < 0) return;

  // Foley: out at 0.05, in at 0.55, slide at 0.82.
  const mag = P.mag!;
  const out = seg(p, 0.05, 0.2);
  const inn = seg(p, 0.4, 0.55);
  const away = inQuad(out) * (1 - outCubic(inn));
  mag.position.y -= away * 0.32;
  mag.position.z += away * 0.06;
  if (p > 0.22 && p < 0.38) mag.visible = false;
  const seat = p >= 0.55 ? thud(seg(p, 0.55, 0.66)) : 0;

  const present = hold(p, 0.0, 0.12, 0.74, 0.88);
  const snap = bump(p, 0.8, 0.95);
  // A long gun on a short grip: tipped less than the Rivet, or the muzzle climbs out of the top of the view.
  a.gunR.z -= present * 0.55;
  a.gunR.x += present * 0.2 + seat * 0.06 - snap * 0.06;
  a.gunR.y += present * 0.08;
  a.gunP.x -= present * 0.04;
  a.gunP.y += present * 0.05 + seat * 0.01;
  a.gunP.z += present * 0.05 + snap * 0.012;

  const h = a.left;
  h.fingerRate = 44;
  h.to('pouchL', inOut(seg(p, 0.04, 0.2)));
  h.to('magHold', inOut(seg(p, 0.32, 0.46)));
  h.to('gripL', inOut(seg(p, 0.68, 0.82)));
  h.shape(HANDS.cup, hold(p, 0.26, 0.4, 0.6, 0.68));
}

export function ultramagDef(kit: Kit): ViewDef {
  return {
    id: 'ultramag',
    model: buildUltramag(kit),
    pos: [0.13, -0.132, -0.41],
    rot: [0.02, 0.06, 0],
    // ADS: the fibre post in the notch, both on the rib, at rest on the slide.
    sight: [0, 0.0702, -0.1835], rear: [0, 0.0698, 0.05], relief: 0.48,
    recoil: { back: 0.042, lift: 0.02, pitch: 0.17, yaw: 0.016, roll: 0.035, omega: 24, zeta: 0.56 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.support },
    heatPerShot: 0.06,
    animate: clip,
  };
}
