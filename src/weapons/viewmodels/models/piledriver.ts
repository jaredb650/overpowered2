/**
 * The Piledriver: a heavy machine gun, carried, and the second gun on key 8. A long slab of receiver under a hinged feed
 * cover, a fluted barrel as thick as the Trommel's whole spindle running out through a pierced jacket to a brake the size
 * of a fist, a steel belt box hung on the left with the belt climbing out of it into the feed, and a charging handle
 * that takes the whole hand. Parkerized steel and olive, nothing bright but the brass.
 *
 * The barrel is recoil operated, so it is a part and jumps back in the jacket on every round, and the belt steps a link
 * with it. Origin at the top of the grip.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Mesher } from '../kit/mesher';
import { curve, poly, rect, slotRow } from '../kit/shapes';
import { hexX, knurl, screwX, serrations } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import { pullTrigger, round } from './common';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';

const BORE = 0.056;
/** Half width of the receiver. */
const HALF = 0.029;
const RECEIVER_FRONT = -0.2;
const JACKET_FRONT = -0.4;
const MUZZLE = -0.78;
/** How far apart two rounds lie on the belt. */
const PITCH = 0.0185;
const BELT_ROUNDS = 7;

function receiver(m: Mesher): void {
  m.use(F.parkerized);
  // The box: riveted side plates as long as a forearm, square at the back where the buffer sits.
  m.side(poly([[0.17, 0.012], [0.174, 0.086, 0.006], [0.16, 0.096, 0.006], [RECEIVER_FRONT, 0.096, 0.004], [RECEIVER_FRONT, 0.012, 0.004]], 0.003), HALF * 2, { bevel: 0.0026 });
  // Trunnion block the barrel screws into, proud of the box on every side.
  m.use(F.steelDark);
  m.at([0, BORE, RECEIVER_FRONT - 0.012], null, () => m.box(HALF * 2 + 0.012, 0.094, 0.036, 0.003, 0.006));
  // Rivet lines along both flanks, and the big pivot pins.
  m.mirror(() => {
    for (let i = 0; i < 7; i++) screwX(m, HALF + 0.0004, 0.022, 0.15 - i * 0.052, 1, 0.0026);
    for (let i = 0; i < 7; i++) screwX(m, HALF + 0.0004, 0.088, 0.15 - i * 0.052, 1, 0.0022);
    hexX(m, HALF + 0.0004, 0.054, 0.13, 1, 0.0052);
    hexX(m, HALF + 0.0004, 0.054, -0.16, 1, 0.0052);
  });
  // Ejection port on the right, bolt showing in it.
  m.use(F.black);
  m.at([HALF + 0.0003, 0.05, -0.04], null, () => m.box(0.0012, 0.026, 0.1, 0));
  m.at([-(HALF + 0.0006), 0.07, 0.11], [0, -Math.PI / 2, 0], () => m.decal('piledriver', 0.09, 0.015, 0xb9bec4));
  m.at([-(HALF + 0.0006), 0.03, 0.1], [0, -Math.PI / 2, 0], () => m.decal('cal127', 0.062, 0.0096, 0x9aa0a6));
  m.at([-(HALF + 0.0006), 0.03, -0.15], [0, -Math.PI / 2, 0], () => m.decal('serial', 0.05, 0.0056, 0x8f949a));

  // Back plate with the buffer tube, and a pad to push against.
  m.use(F.steelDark);
  m.at([0, 0.054, 0.176], null, () => m.box(HALF * 2 + 0.006, 0.09, 0.012, 0.002, 0.004));
  m.at([0, 0.062, 0.21], null, () => m.cyl(0.021, 0.06, 18));
  m.use(F.rubber);
  m.at([0, 0.056, 0.248], null, () => m.box(0.052, 0.1, 0.02, 0.005, 0.008));

  // Feed tray under the cover: a ledge sticking out to the left that the belt climbs onto.
  m.use(F.steel);
  m.at([-(HALF + 0.014), 0.092, -0.09], null, () => m.box(0.03, 0.006, 0.074, 0.0012, 0.002));
  m.use(F.steelDark);
  m.mirror(() => m.at([HALF - 0.004, 0.099, -0.09], null, () => m.box(0.006, 0.008, 0.078, 0.001)));

  // Rear sight: a tall ladder, folded up, with a notch plate.
  m.use(F.blued);
  m.at([0, 0.099, 0.118], null, () => {
    m.box(0.036, 0.008, 0.026, 0.0012);
    m.mirror(() => m.at([0.013, 0.022, 0], null, () => m.box(0.0034, 0.04, 0.006, 0.0008)));
    m.at([0, 0.03, 0], null, () => m.box(0.03, 0.006, 0.004, 0.0008));
    m.at([0, 0.042, 0], null, () => m.box(0.03, 0.004, 0.004, 0.0008));
  });

  // Fire control housing, pistol grip and the guard.
  m.use(F.parkerized);
  m.side(poly([[0.11, 0.0125], [0.112, 0.0, 0.004], [0.092, -0.01, 0.004], [-0.05, -0.01, 0.003], [-0.056, 0.0125]], 0.002), 0.04, { bevel: 0.0018 });
  const front = curve([[0.02, 0.0], [0.021, -0.024], [0.027, -0.042], [0.03, -0.06], [0.037, -0.08], [0.044, -0.1], [0.047, -0.116]], 4);
  const back = curve([[0.105, -0.116], [0.099, -0.082], [0.09, -0.048], [0.085, -0.022], [0.078, 0.0]], 4);
  m.use(F.polymerStipple);
  m.side([...front, [0.048, -0.122], [0.103, -0.122], ...back], 0.035, { bevel: 0.0045, smooth: 50 });
  m.use(F.steelDark);
  m.at([0, -0.1245, 0.076], null, () => m.box(0.035, 0.005, 0.058, 0.0013, 0.003));
  const guardOut = poly([[-0.04, -0.0085], [-0.044, -0.032, 0.006], [-0.026, -0.046, 0.008], [0.03, -0.046, 0.008], [0.052, -0.014, 0.004], [0.052, -0.008]], 0.002);
  const guardIn = poly([[-0.036, -0.0105], [-0.039, -0.031, 0.005], [-0.024, -0.0425, 0.005], [0.027, -0.0425, 0.005], [0.047, -0.0135, 0.003], [0.047, -0.0105]], 0.002);
  m.side(guardOut, 0.014, { bevel: 0.0009, holes: [guardIn] });
}

function jacket(m: Mesher): void {
  m.at([0, BORE, 0], null, () => {
    // Barrel support: four slotted plates in a cage round the barrel, between two collars. The barrel is seen through it.
    m.use(F.parkerized);
    const rear = RECEIVER_FRONT - 0.03;
    const len = rear - JACKET_FRONT;
    m.at([0, 0, rear - 0.008], null, () => m.pipe(0.0345, 0.0225, 0.016, 24));
    for (let i = 0; i < 4; i++) {
      // Each plate's own Y is the way out from the bore, so its slots are cut through to the barrel.
      const a = (i / 4) * Math.PI * 2;
      m.at([Math.cos(a) * 0.03, Math.sin(a) * 0.03, rear - len / 2], [0, 0, a - Math.PI / 2], () => {
        m.top(rect(-0.0145, -len / 2, 0.0145, len / 2, 0.003), 0.007, { bevel: 0.0012, holes: slotRow(0, -len / 2 + 0.03, 0, len / 2 - 0.03, 5, 0.022, 0.011, Math.PI / 2) });
      });
    }
    m.use(F.steelDark);
    m.at([0, 0, JACKET_FRONT + 0.008], null, () => m.pipe(0.037, 0.0225, 0.016, 24));
    // Carry handle on the front collar, folded to the left.
    m.use(F.steelDark);
    m.tube([[-0.02, 0.03, JACKET_FRONT + 0.008], [-0.052, 0.056, JACKET_FRONT + 0.008], [-0.058, 0.058, JACKET_FRONT + 0.07], [-0.03, 0.036, JACKET_FRONT + 0.078]], 0.005, { seg: 8, samples: 16, tension: 0.4 });
    m.use(F.walnutDark);
    m.tube([[-0.0565, 0.058, JACKET_FRONT + 0.018], [-0.0585, 0.059, JACKET_FRONT + 0.062]], 0.0085, { seg: 10, samples: 4 });
  });
  // Front grip hung under the jacket, for the hand that holds the muzzle down.
  m.use(F.steelDark);
  m.at([0, BORE - 0.04, -0.31], null, () => m.box(0.036, 0.014, 0.06, 0.002, 0.004));
  m.use(F.polymerStipple);
  m.at([0, BORE - 0.047, -0.31], null, () => {
    const f = curve([[-0.02, 0], [-0.0235, -0.03], [-0.0245, -0.06], [-0.02, -0.098]], 4);
    const b = curve([[0.024, -0.098], [0.026, -0.06], [0.024, -0.03], [0.02, 0]], 4);
    m.side([...f, ...b], 0.033, { bevel: 0.0036, smooth: 50 });
  });
  m.use(F.steelDark);
  m.at([0, BORE - 0.148, -0.308], null, () => m.box(0.035, 0.006, 0.05, 0.0014, 0.003));
}

function barrel(m: Mesher): void {
  // The barrel is its own part: it runs back in the jacket on every round.
  m.part('barrel', [0, BORE, 0], () => {
    m.use(F.barrel);
    // Thick at the breech, fluted along the middle, stepping down to the brake's thread.
    m.lathe([[0.0215, RECEIVER_FRONT + 0.01, 0], [0.0215, JACKET_FRONT - 0.02], [0.0185, JACKET_FRONT - 0.03], [0.0185, MUZZLE + 0.07], [0.0158, MUZZLE + 0.064], [0.0158, MUZZLE + 0.05, 0]], 22);
    // Flutes, as dark strips let into it. A finish with no wear: on a part this thin every edge would chip bright.
    m.use(F.black);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      m.at([Math.cos(a) * 0.0186, Math.sin(a) * 0.0186, (JACKET_FRONT - 0.04 + MUZZLE + 0.08) / 2], [0, 0, a], () => m.box(0.0022, 0.005, JACKET_FRONT - 0.04 - (MUZZLE + 0.08), 0.0008));
    }
    // Front sight on a band.
    m.use(F.steelDark);
    m.at([0, 0, JACKET_FRONT - 0.07], null, () => {
      m.lathe([[0.0185, 0.012, 0], [0.0225, 0.012], [0.0225, -0.012], [0.0185, -0.012, 0]], 20);
      m.at([0, 0.036, 0], null, () => m.side(poly([[0.012, -0.014], [0.006, 0.014, 0.002], [-0.006, 0.014, 0.002], [-0.012, -0.014]], 0.001), 0.006, { bevel: 0.0008 }));
      m.glow('sight', () => m.at([0, 0.053, 0.0065], null, () => m.box(0.0022, 0.006, 0.0006, 0)));
    });
    // The brake: a block with three baffles a side, wider than the barrel is thick twice over.
    m.use(F.barrelBlack);
    m.at([0, 0, MUZZLE + 0.036], null, () => m.box(0.058, 0.04, 0.072, 0.003, 0.006));
    m.use(F.black);
    m.mirror(() => {
      for (let i = 0; i < 3; i++) m.at([0.0286, 0, MUZZLE + 0.058 - i * 0.021], null, () => m.box(0.002, 0.026, 0.012, 0));
    });
    for (let i = 0; i < 3; i++) m.at([0, 0.0196, MUZZLE + 0.058 - i * 0.021], null, () => m.box(0.03, 0.002, 0.009, 0));
    m.at([0, 0, MUZZLE - 0.0005], null, () => m.cyl(0.0074, 0.002, 14, 0));
  });
}

function feed(m: Mesher): void {
  // Feed cover: hinged at its front edge, thrown open to lay a belt.
  m.part('cover', [0, 0.098, -0.142], () => {
    m.use(F.parkerized);
    m.at([0, 0.008, 0.062], null, () => m.box(HALF * 2 + 0.004, 0.016, 0.13, 0.003, 0.005));
    m.use(F.steelDark);
    m.at([0, 0.0, 0.0], [0, Math.PI / 2, 0], () => m.cyl(0.006, HALF * 2 + 0.01, 12));
    for (let i = 0; i < 4; i++) m.at([0, 0.0172, 0.03 + i * 0.022], null, () => m.box(0.04, 0.0022, 0.009, 0.0006));
    // Latch at the back, the thing the thumb finds.
    m.use(F.steel);
    m.at([0, 0.01, 0.13], null, () => m.box(0.022, 0.008, 0.008, 0.0012));
  });

  // Belt box: olive steel, hung on the left on a bracket, with a lid and a strap.
  m.part('box', [-(HALF + 0.05), -0.02, -0.085], () => {
    m.use(F.olive);
    m.box(0.078, 0.134, 0.168, 0.003, 0.006);
    m.use(F.oliveDark);
    for (const z of [-0.06, 0, 0.06]) m.at([-0.04, 0, z], null, () => m.box(0.0036, 0.122, 0.014, 0.001));
    m.at([0, 0.069, 0], null, () => m.box(0.08, 0.006, 0.17, 0.0016, 0.003));
    m.at([-0.0405, 0.022, 0], [0, -Math.PI / 2, 0], () => m.decal('cal127', 0.1, 0.0156, 0xd8d0a0));
    m.use(F.webbing);
    m.at([0, 0.0735, 0.0], null, () => m.box(0.022, 0.003, 0.172, 0.001));
    m.use(F.steelDark);
    m.at([0.045, 0.03, 0], null, () => m.box(0.012, 0.05, 0.1, 0.0014));
  });

  // The belt: linked rounds climbing out of the box, over the lip and across the tray. One part, so it can step and rattle.
  m.part('belt', [-(HALF + 0.03), 0.094, -0.09], () => {
    for (let i = 0; i < BELT_ROUNDS; i++) {
      // The first few lie on the tray, the rest hang down into the box.
      const lie = i < 3;
      const x = lie ? 0.03 - i * PITCH : 0.03 - 2 * PITCH - 0.006;
      const y = lie ? 0.008 : 0.008 - (i - 2) * PITCH;
      m.at([x, y, 0.036], null, () => {
        m.at([0, 0, 0], null, () => round(m, 0.0064, 0.046, 0.03));
        m.use(F.steelDark);
        m.at([0, 0, -0.022], null, () => m.box(0.0146, 0.0146, 0.012, 0.002, 0.005));
      });
    }
  });
}

function buildPiledriver(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0016;
  receiver(m);
  jacket(m);
  barrel(m);
  feed(m);

  m.part('bolt', [HALF - 0.0005, 0.05, -0.04], () => {
    m.use(F.steel);
    m.box(0.004, 0.022, 0.094, 0.0008);
    m.at([0.0016, 0, 0.02], null, () => serrations(m, 5, 0.007, 0.0008, 0.016, 0.0012, F.steelDark));
  });
  // Charging handle on the left, low on the box: a bar the whole fist goes round.
  m.part('charge', [-(HALF + 0.0015), 0.036, 0.03], () => {
    m.use(F.steelDark);
    m.at([0.0, 0, 0], null, () => m.box(0.005, 0.01, 0.03, 0.001));
    m.at([-0.012, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.0056, 0.024, 10));
    m.at([-0.03, 0, 0], [0, Math.PI / 2, 0], () => knurl(m, 0.0092, 0.022, F.steel, 16, 0.0006));
  });
  m.part('trigger', [0, -0.0095, -0.002], () => {
    m.use(F.steelDark);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0038, -0.0225, 0.0015], [0.0005, -0.0235, 0.001], [-0.0035, -0.0095, 0.003]], 0.001), 0.0072, { bevel: 0.0007 });
  });

  const model = new Model(m, kit.mats, { glows: { sight: [0xffb43a, 5] } });
  model.socket('muzzle', [0, BORE, MUZZLE - 0.006]);
  model.socket('eject', [HALF + 0.004, 0.05, -0.04]);
  model.hand('gripR', [0.018, -0.056, 0.074], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.hand('gripL', [-0.018, BORE - 0.1, -0.31], [0.02, -0.98, 0.2], [0.34, -0.18, -0.92]);
  model.hand('boxHold', [-0.046, 0.0, 0.03], [-0.1, 0.1, -0.98], [0.9, 0.05, -0.2], 'box');
  model.hand('coverHold', [-0.02, 0.02, 0.12], [-0.3, 0.4, -0.86], [0.85, 0.3, -0.42], 'cover');
  model.hand('chargeHold', [-0.034, 0.0, 0.006], [-0.5, -0.2, -0.8], [0.8, -0.3, -0.5], 'charge');
  return model;
}

/** How far the barrel runs back in the jacket, and how far the bolt and the handle travel. */
const BARREL_RUN = 0.022;
const BOLT_TRAVEL = 0.07;

function clip(a: Anim): void {
  const P = a.parts;
  // A long, heavy cycle: the barrel and bolt come back together, the barrel stops, and the bolt is still on its way home
  // when the muzzle has finished climbing. The belt steps one link as the bolt goes forward.
  const cycle = 0.1;
  const c = a.sinceFire < cycle ? a.sinceFire / cycle : 1;
  const run = Math.sin(c * Math.PI);
  P.barrel!.position.z += Math.sin(Math.min(1, c * 1.6) * Math.PI) * BARREL_RUN;
  P.bolt!.position.z += run * BOLT_TRAVEL;
  pullTrigger(a, 0.09, 0.3);
  a.glow('sight', 1);
  const belt = P.belt!;
  belt.position.x -= (1 - Math.min(1, c * 1.4)) * PITCH;
  // Each round throws the box and the belt against the gun, and the gun across the shoulder.
  const jolt = a.sinceFire < 0.22 ? bump(a.sinceFire, 0, 0.22) : 0;
  P.box!.rotation.z += jolt * 0.035;
  belt.position.y += jolt * 0.003;
  a.gunR.z -= jolt * 0.03;
  a.gunP.x += jolt * 0.004;

  if (a.draw < 1) {
    // Swung up from under the arm by its front grip: muzzle last.
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.08;
    a.gunR.x -= k * 0.42;
    a.gunR.z -= k * 0.24;
  }

  const p = a.reload;
  if (p < 0) return;
  // Foley: box off at 0.05, new box on at 0.5, charging handle at 0.8. Cover up, box swapped, belt laid, cover down, rack.
  const open = hold(p, 0.03, 0.13, 0.64, 0.7);
  P.cover!.rotation.x -= open * 1.25;
  const out = inQuad(seg(p, 0.08, 0.26));
  const inn = outCubic(seg(p, 0.38, 0.52));
  const away = out * (1 - inn);
  const box = P.box!;
  box.position.y -= away * 0.4;
  box.position.x -= away * 0.08;
  box.rotation.z += away * 0.5;
  if (p > 0.27 && p < 0.38) box.visible = false;
  // The old belt goes with its box. The new one is drawn up onto the tray before the cover comes down.
  if (p > 0.08 && p < 0.5) belt.visible = false;
  belt.position.y -= (1 - outCubic(seg(p, 0.5, 0.6))) * (p >= 0.5 ? 0.03 : 0);
  const seat = p >= 0.515 ? thud(seg(p, 0.515, 0.62)) : 0;
  const slam = p >= 0.69 ? thud(seg(p, 0.69, 0.78)) : 0;
  const rack = bump(p, 0.78, 0.93);
  P.charge!.position.z += rack * BOLT_TRAVEL;
  P.bolt!.position.z += rack * BOLT_TRAVEL;

  const present = hold(p, 0.0, 0.12, 0.9, 1);
  a.gunR.z -= present * 0.42 + seat * 0.04;
  a.gunR.x += present * 0.14 + slam * 0.07 - rack * 0.06;
  a.gunR.y += present * 0.06;
  a.gunP.x -= present * 0.05;
  a.gunP.y += present * 0.04 - slam * 0.012 - seat * 0.008;
  a.gunP.z += present * 0.07 + rack * 0.025;

  const h = a.left;
  h.fingerRate = 34;
  h.to('coverHold', inOut(seg(p, 0.0, 0.06)));
  h.to('boxHold', inOut(seg(p, 0.12, 0.2)));
  h.to('pouchL', inOut(seg(p, 0.24, 0.33)));
  h.to('boxHold', inOut(seg(p, 0.36, 0.46)));
  h.to('coverHold', inOut(seg(p, 0.56, 0.64)));
  h.to('chargeHold', inOut(seg(p, 0.71, 0.78)));
  h.to('gripL', inOut(seg(p, 0.93, 1)));
  h.shape(HANDS.cup, hold(p, 0.12, 0.2, 0.5, 0.56));
  h.shape(HANDS.open, hold(p, 0.58, 0.64, 0.68, 0.72));
  h.shape(HANDS.foregrip, hold(p, 0.73, 0.78, 0.91, 0.95));
}

export function piledriverDef(kit: Kit): ViewDef {
  return {
    id: 'piledriver',
    model: buildPiledriver(kit),
    pos: [0.175, -0.168, -0.42],
    rot: [0.026, 0.075, 0],
    // The hardest kick of any automatic: half as far again as the Harrow's on a slower spring, so eight a second is eight blows.
    recoil: { back: 0.05, lift: 0.008, pitch: 0.052, yaw: 0.012, roll: 0.02, omega: 34, zeta: 0.5 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.foregrip },
    heatPerShot: 0.03,
    animate: clip,
  };
}
