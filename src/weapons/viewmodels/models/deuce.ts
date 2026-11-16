/**
 * The Deuce: a side-by-side double twelve-gauge, cut short. A boxlock action in parkerized steel, two fat barrels on a
 * monoblock with a flat rib between them, a walnut beavertail and the Breacher's stock. It breaks open on a hinge pin to
 * load: the top lever goes over, the barrels drop, the ejectors throw both empties and two shells go in by hand.
 * Origin at the top of the grip.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Mesher } from '../kit/mesher';
import { poly } from '../kit/shapes';
import { screwX } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { pullTrigger, shell12 } from './common';
import { stock } from './shotgun';

const BORE = 0.034;
/** Each barrel's axis sits this far either side of the middle: the two touch along the rib. */
const BX = 0.0168;
const R = 0.0165;
const BREECH = -0.012;
const MUZZLE = -0.46;
/** The hinge pin, at the front of the action under the barrels. Barrels-part space is measured from it. */
const HY = 0.004;
const HZ = -0.088;
/** Radians the barrels drop when it breaks open. */
const OPEN = 0.6;
/** Reload fractions the foley says each shell goes home: right barrel, then left. */
const SHELLS = [0.42, 0.58] as const;
/** Time to bring a shell from the belt to its chamber, as a fraction of the reload. */
const FETCH = 0.13;

function action(m: Mesher): void {
  m.use(F.parkerized);
  // Standing breech and the water table the barrels close down onto, one piece, rounded into the knuckle at the front.
  m.side(poly([
    [0.074, -0.02], [0.076, 0.03, 0.006], [0.06, 0.052, 0.008], [BREECH, 0.052, 0.003], [BREECH, 0.014],
    [HZ - 0.002, 0.014, 0.002], [HZ - 0.012, 0.004, 0.009], [HZ - 0.006, -0.018, 0.008], [0.02, -0.024, 0.004],
  ], 0.002), 0.064, { bevel: 0.0024 });
  // Fences: the shoulders round each breech, so the action reads as two guns joined.
  m.use(F.steelDark);
  m.mirror(() => m.at([BX, BORE, BREECH + 0.006], null, () => m.lathe([[R + 0.003, 0.006, 0], [R + 0.003, -0.002, 0.002], [R - 0.002, -0.006, 0]], 22, { a0: -0.4, a1: Math.PI + 0.4 })));
  // Side plates with a sunk panel, the hinge pin's head, and screws.
  m.mirror(() => {
    m.at([0.0322, 0, 0], null, () => m.side(poly([[0.06, -0.016], [0.062, 0.04, 0.006], [0.0, 0.046, 0.004], [-0.004, -0.018, 0.004]], 0.002), 0.0018, { bevel: 0.0005 }));
    m.at([0.0329, HY, HZ], [0, Math.PI / 2, 0], () => m.lathe([[0.0062, 0.0012, 0], [0.0062, -0.0006], [0.004, -0.0014, 0]], 18));
    screwX(m, 0.0329, 0.028, 0.038, 1, 0.0022);
    screwX(m, 0.0329, -0.006, 0.012, 1, 0.0022);
  });
  m.at([-0.0333, 0.02, 0.03], [0, -Math.PI / 2, 0], () => m.decal('deuce', 0.044, 0.011, 0xb9bec4));
  m.at([-0.0333, 0.004, 0.03], [0, -Math.PI / 2, 0], () => m.decal('cal12', 0.042, 0.0062, 0x9aa0a6));
  // Top tang, the safety on it, and the lever's well.
  m.use(F.steelDark);
  m.at([0, 0.053, 0.05], null, () => m.box(0.016, 0.004, 0.05, 0.0012));
  m.at([0, 0.056, 0.064], null, () => m.box(0.008, 0.004, 0.012, 0.0012));
  // Trigger guard, the Breacher's, and the rear trigger that fires the left barrel.
  m.use(F.steelDark);
  m.at([0, -0.006, 0], null, () => {
    const out = poly([[-0.03, -0.018], [-0.034, -0.03, 0.006], [-0.022, -0.046, 0.008], [0.028, -0.046, 0.008], [0.042, -0.02, 0.004], [0.042, -0.018]], 0.002);
    const inner = poly([[-0.026, -0.02], [-0.028, -0.029, 0.005], [-0.019, -0.0415, 0.005], [0.024, -0.0415, 0.005], [0.036, -0.021, 0.003], [0.036, -0.02]], 0.002);
    m.side(out, 0.0125, { bevel: 0.0012, holes: [inner] });
  });
  m.at([0, -0.024, 0.014], null, () => m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.008, 0.002], [0.0036, -0.017, 0.0015], [0.0005, -0.018, 0.001], [-0.0035, -0.008, 0.003]], 0.001), 0.006, { bevel: 0.0007 }));
}

/** One shell lying in a chamber, head flush with the breech: as a part, so the clip can throw it out or seat it. */
function chambered(m: Mesher, name: string, x: number): void {
  m.part(name, [x, BORE - HY, BREECH - HZ], () => m.at([0, 0, 0.0005], null, () => shell12(m, F.red)));
}

function barrels(m: Mesher): void {
  m.part('barrels', [0, HY, HZ], () => {
    const y = BORE - HY;
    const z = (v: number) => v - HZ;
    m.mirror(() => m.at([BX, y, 0], null, () => {
      m.use(F.barrel);
      m.lathe([[R, z(BREECH), 0], [R, z(-0.09)], [R - 0.0016, z(-0.13)], [R - 0.0022, z(MUZZLE + 0.012)], [R - 0.001, z(MUZZLE + 0.008)], [R - 0.001, z(MUZZLE), 0.0008], [0.0095, z(MUZZLE), 0]], 26);
      m.use(F.black);
      m.lathe([[0.0095, z(MUZZLE), 0], [0.0093, z(MUZZLE + 0.03), 0], [0, z(MUZZLE + 0.0305), 0]], 18);
      // The bore, seen from the breech end when it hangs open.
      m.lathe([[0.0098, z(BREECH) + 0.0004, 0], [0.0098, z(BREECH) - 0.004, 0], [0, z(BREECH) - 0.0045, 0]], 18);
    }));
    // Monoblock: the two breeches in one block, with the lump that locks into the water table.
    m.use(F.parkerized);
    m.at([0, y, z(BREECH - 0.034)], null, () => m.front(poly([[-BX - R - 0.001, -R + 0.002], [BX + R + 0.001, -R + 0.002], [BX + R + 0.001, 0.004, 0.006], [BX + 0.006, R - 0.001, 0.008], [-BX - 0.006, R - 0.001, 0.008], [-BX - R - 0.001, 0.004, 0.006]], 0.002), 0.068, { bevel: 0.0016 }));
    m.at([0, 0.0115 - HY, z(BREECH - 0.034)], null, () => m.box(0.034, 0.008, 0.064, 0.0014));
    // Rib on top between the barrels, bright so the two read apart, with a bead; the groove underneath filled.
    m.use(F.steel);
    m.at([0, y + R - 0.0012, z((BREECH + MUZZLE) / 2 - 0.03)], null, () => m.box(0.0075, 0.0038, BREECH - MUZZLE - 0.06, 0.0009));
    for (let i = 0; i < 18; i++) m.at([0, y + R + 0.0009, z(-0.09 - i * 0.022)], null, () => m.box(0.0064, 0.0005, 0.0012, 0));
    m.at([0, y - R + 0.004, z((BREECH + MUZZLE) / 2 - 0.03)], null, () => m.box(0.008, 0.006, BREECH - MUZZLE - 0.07, 0.0008));
    m.glow('sight', () => m.at([0, y + R + 0.0028, z(MUZZLE + 0.008)], null, () => m.lathe([[0, 0.0026, 0], [0.0022, 0.0018], [0.0024, 0], [0.0022, -0.0018], [0, -0.0026, 0]], 10)));
    // Muzzle band tying the two together.
    m.use(F.steelDark);
    m.at([0, y, z(MUZZLE + 0.016)], null, () => m.front(poly([[-BX - R - 0.0012, -R * 0.6], [BX + R + 0.0012, -R * 0.6], [BX + R + 0.0012, R * 0.6], [-BX - R - 0.0012, R * 0.6]], 0.006), 0.012, { bevel: 0.001 }));
    // Beavertail forend: walnut wrapping the barrels' bellies, checkered where the hand closes, an iron at its back.
    m.use(F.walnut);
    m.side(poly([[z(-0.115), y - 0.004], [z(-0.12), y - R - 0.014, 0.008], [z(-0.3), y - R - 0.012, 0.01], [z(-0.31), y - 0.004, 0.006]], 0.003), 0.072, { bevel: 0.005, smooth: 40 });
    m.use({ ...F.walnutDark, kind: 2 });
    m.mirror(() => m.at([0.0355, 0, 0], null, () => m.side(poly([[z(-0.15), y - 0.006], [z(-0.15), y - R - 0.008], [z(-0.28), y - R - 0.007], [z(-0.28), y - 0.006]], 0.003), 0.003, { bevel: 0.001 })));
    m.use(F.steelDark);
    m.at([0, y - R - 0.006, z(-0.106)], null, () => m.box(0.062, 0.016, 0.022, 0.0016, 0.004));
    m.at([0, y - R - 0.016, z(-0.2)], null, () => m.box(0.012, 0.003, 0.03, 0.0008));
    // Extractor between the chambers.
    m.at([0, y + 0.004, z(BREECH) - 0.002], null, () => m.box(0.008, 0.008, 0.004, 0.0006));
    chambered(m, 'shell0', BX);
    chambered(m, 'shell1', -BX);
    // The shell in the hand during a reload, in the barrels' frame so it lands in a chamber however far they hang.
    m.part('shellIn', [BX, BORE - HY, BREECH - HZ], () => shell12(m, F.red));
  });
}

function buildDeuce(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0014;
  action(m);
  stock(m);
  barrels(m);
  // Top lever: thumbed over to the right to break it open.
  m.part('lever', [0, 0.056, 0.006], () => {
    m.use(F.steel);
    m.top(poly([[-0.004, -0.008], [0.004, -0.008], [0.006, 0.02, 0.002], [0.016, 0.036, 0.004], [0.008, 0.04, 0.003], [-0.004, 0.022, 0.002]], 0.001), 0.004, { bevel: 0.0008 });
    m.at([0, 0.002, 0], null, () => m.cyl(0.004, 0.006, 12));
  });
  m.part('trigger', [0, -0.024, -0.004], () => {
    m.use(F.steelDark);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0038, -0.0205, 0.0015], [0.0005, -0.0215, 0.001], [-0.0035, -0.0095, 0.003]], 0.001), 0.0065, { bevel: 0.0007 });
  });

  const model = new Model(m, kit.mats, { glows: { sight: [0xffb43a, 5] } });
  // Right barrel first, on the front trigger; the left on the rear. Weapons asks for `muzzle1` on the second shot.
  model.socket('muzzle', [BX, BORE, MUZZLE - 0.002]);
  model.socket('muzzle1', [-BX, BORE, MUZZLE - 0.002]);
  model.socket('eject', [0, BORE + 0.01, BREECH]);
  model.hand('gripR', [0.019, -0.06, 0.07], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.support('foreL', [-0.004, BORE - R - 0.012 - HY, -0.21 - HZ], 'barrels');
  model.hand('shellHold', [-0.017, 0.0, -0.03], [-0.3, 0.1, -0.95], [0.9, -0.1, -0.35], 'shellIn');
  return model;
}

function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a);
  a.glow('sight', 1);
  // Both barrels at once rocks the whole gun up and back, past what the spring does with one.
  const t = a.sinceFire;
  if (a.strength > 1.5 && t < 0.32) {
    const k = bump(t, 0, 0.32);
    a.gunR.x += k * 0.07;
    a.gunP.z += k * 0.018;
  }
  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.08;
    a.gunR.x += k * 0.45;
    a.gunR.z += k * 0.3;
  }
  P.shellIn!.visible = false;
  const p = a.reload;
  if (p < 0) {
    P.shell0!.visible = P.shell1!.visible = false;
    return;
  }

  // Lever over, barrels down on the hinge, held open while it loads, then the stock swung up to shut it.
  P.lever!.rotation.y -= hold(p, 0, 0.06, 0.74, 0.8) * 0.6;
  const shut = p >= 0.76 ? thud(seg(p, 0.76, 0.88)) : 0;
  const drop = inOut(seg(p, 0.05, 0.15)) * (1 - inQuad(seg(p, 0.68, 0.76)));
  P.barrels!.rotation.x -= drop * OPEN - shut * 0.02;

  // The ejectors throw both empties up and back over the shoulder.
  const out = seg(p, 0.16, 0.26);
  for (let i = 0; i < 2; i++) {
    const s = P[i === 0 ? 'shell0' : 'shell1']!;
    if (p < 0.26) {
      s.visible = true;
      s.position.z += inQuad(out) * 0.16 + out * 0.03;
      s.position.y += out * 0.06;
      s.position.x += (i === 0 ? 1 : -1) * out * 0.03;
      s.rotation.x += out * 3.5;
    } else s.visible = p >= SHELLS[i]!;
  }

  // Two shells from the belt, each pushed home past the extractor.
  let hand = 0;
  let seat = 0;
  const sh = P.shellIn!;
  for (let i = 0; i < 2; i++) {
    const at = SHELLS[i]!;
    if (p > at - FETCH && p < at + 0.012) {
      sh.visible = p < at;
      const u = inOut(seg(p, at - FETCH, at - 0.04));
      if (i === 1) sh.position.x -= 2 * BX;
      // In the barrels' frame, which hangs open: this is down from the breech and a little ahead, not toward the eye.
      sh.position.x += (1 - u) * -0.05;
      sh.position.y += (1 - u) * -0.22;
      sh.position.z += (1 - u) * -0.12 + (1 - inOut(seg(p, at - 0.04, at))) * 0.064;
      sh.rotation.x += (1 - u) * 1.2;
      sh.rotation.y += (1 - u) * -0.5;
    }
    hand = Math.max(hand, hold(p, at - FETCH, at - FETCH + 0.05, at + 0.01, at + 0.05));
    seat = Math.max(seat, p >= at ? thud(seg(p, at, at + 0.08)) : 0);
  }

  // Brought in and rolled a little so the chambers face the eye; a flick up to dump, and a lift to close.
  const present = hold(p, 0.04, 0.16, 0.66, 0.82);
  const dump = bump(p, 0.15, 0.3);
  const lift = bump(p, 0.66, 0.8);
  a.gunR.x += dump * 0.18 + present * 0.05 + lift * 0.14 + shut * 0.03 + seat * 0.015;
  a.gunR.z -= present * 0.28;
  a.gunR.y -= present * 0.06;
  a.gunP.x -= present * 0.03;
  a.gunP.y += present * 0.012 + dump * 0.01 + seat * 0.004;
  a.gunP.z -= present * 0.02;

  const h = a.left;
  h.fingerRate = 42;
  h.to('pouchL', inOut(seg(p, 0.2, 0.27)));
  h.to('shellHold', hand);
  h.to('foreL', inOut(seg(p, 0.62, 0.7)));
  h.shape(HANDS.pinch, hand);
}

export function deuceDef(kit: Kit): ViewDef {
  return {
    id: 'deuce',
    model: buildDeuce(kit),
    pos: [0.14, -0.118, -0.39],
    rot: [0.03, 0.08, 0],
    recoil: { back: 0.07, lift: 0.016, pitch: 0.13, yaw: 0.014, roll: 0.035, omega: 26, zeta: 0.5 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'foreL', pose: HANDS.support },
    heatPerShot: 0.05,
    animate: clip,
  };
}
