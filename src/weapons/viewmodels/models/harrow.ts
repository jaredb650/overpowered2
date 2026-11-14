/**
 * The Harrow: a battle rifle, and the SMG's older brother on slot 1. Parkerized steel and walnut where the SMG is
 * polymer and anodizing, so the two are told apart by colour before shape: a long slotted handguard, a gas block with
 * a hooded front post, a steel box magazine that rocks in, and a brake with real ports. Origin at the top of the grip.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Mesher } from '../kit/mesher';
import { curve, poly, rect, slotRow } from '../kit/shapes';
import { knurl, screwX, serrations } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import { fill, pullTrigger } from './common';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';

const BORE = 0.046;
const GUARD_REAR = -0.165;
const GUARD_FRONT = -0.4;
const MUZZLE = -0.628;

function receiver(m: Mesher): void {
  m.use(F.parkerized);
  // One stamped box, tall at the back where the bolt carrier lives.
  m.side(poly([[0.152, 0.014], [0.158, 0.056, 0.008], [0.142, 0.073, 0.006], [GUARD_REAR, 0.073, 0.002], [GUARD_REAR, 0.014]], 0.002), 0.037, { bevel: 0.0018 });
  // Ribbed dust cover: pressed steel, a shade lighter.
  m.use(F.steelDark);
  m.at([0, 0.0755, -0.012], null, () => m.top(rect(-0.0155, -0.14, 0.0155, 0.14, 0.004), 0.006, { bevel: 0.0014 }));
  for (let i = 0; i < 9; i++) m.at([0, 0.0792, -0.13 + i * 0.03], null, () => m.box(0.027, 0.0016, 0.008, 0.0005));
  // Ejection port on the right, with the carrier showing in it.
  m.use(F.black);
  m.at([0.0183, 0.052, -0.03], null, () => m.box(0.0012, 0.017, 0.07, 0));
  // Rivets and pins along the flank.
  m.mirror(() => {
    screwX(m, 0.0188, 0.026, 0.12, 1, 0.0024);
    screwX(m, 0.0188, 0.026, -0.14, 1, 0.0024);
    screwX(m, 0.0188, 0.062, 0.1, 1, 0.002);
  });
  m.at([-0.0187, 0.034, 0.05], [0, -Math.PI / 2, 0], () => m.decal('harrow', 0.07, 0.014, 0xb9bec4));
  m.at([-0.0187, 0.0225, -0.06], [0, -Math.PI / 2, 0], () => m.decal('cal68', 0.046, 0.0072, 0x9aa0a6));
  m.at([-0.0187, 0.064, -0.09], [0, -Math.PI / 2, 0], () => m.decal('serial', 0.044, 0.005, 0x8f949a));

  // Rear sight: an aperture on a windage block.
  m.use(F.blued);
  m.at([0, 0.0835, 0.118], null, () => {
    m.box(0.026, 0.01, 0.02, 0.0012);
    m.mirror(() => m.at([0.011, 0.01, 0], null, () => m.box(0.003, 0.016, 0.014, 0.0008)));
    m.at([0, 0.0105, 0], null, () => m.pipe(0.0068, 0.0032, 0.004, 16));
    m.at([0.0155, 0.001, 0], [0, Math.PI / 2, 0], () => knurl(m, 0.0052, 0.004, F.steelDark, 12, 0.0004));
  });

  // Fire control housing and magwell.
  m.use(F.parkerized);
  m.side(poly([[0.1, 0.0145], [0.102, 0.002, 0.004], [0.084, -0.008, 0.004], [-0.04, -0.008, 0.003], [-0.046, 0.0145]], 0.002), 0.033, { bevel: 0.0016 });
  m.side(poly([[-0.04, 0.0145], [-0.136, 0.0145], [-0.138, -0.012, 0.003], [-0.13, -0.03, 0.003], [-0.05, -0.03, 0.003], [-0.044, -0.012, 0.002]], 0.002), 0.035, { bevel: 0.0016 });
  // Paddle mag release behind the well.
  m.use(F.steelDark);
  m.at([0, -0.02, -0.036], [0.35, 0, 0], () => m.box(0.012, 0.024, 0.004, 0.0008));
  m.part('selector', [-0.0172, 0.0062, 0.064], () => {
    m.use(F.steelDark);
    m.at([0, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.0055, 0.003, 12));
    m.at([-0.0016, 0.0, -0.01], null, () => m.box(0.0026, 0.0046, 0.02, 0.0008));
  });
  m.at([-0.0172, 0.0015, 0.064], [0, -Math.PI / 2, 0], () => m.decal('fire', 0.024, 0.0045, 0xd8d8d8));
  // Trigger guard: bent strap.
  m.use(F.steelDark);
  const guardOut = poly([[-0.04, -0.0065], [-0.044, -0.03, 0.006], [-0.026, -0.043, 0.008], [0.03, -0.043, 0.008], [0.052, -0.012, 0.004], [0.052, -0.006]], 0.002);
  const guardIn = poly([[-0.036, -0.0085], [-0.039, -0.029, 0.005], [-0.024, -0.0395, 0.005], [0.027, -0.0395, 0.005], [0.047, -0.0115, 0.003], [0.047, -0.0085]], 0.002);
  m.side(guardOut, 0.013, { bevel: 0.0009, holes: [guardIn] });
}

function furniture(m: Mesher): void {
  // Pistol grip: oiled walnut with a steel cap.
  const front = curve([[0.02, 0.002], [0.021, -0.022], [0.027, -0.04], [0.03, -0.058], [0.037, -0.078], [0.044, -0.098], [0.047, -0.114]], 4);
  const back = curve([[0.103, -0.114], [0.097, -0.08], [0.088, -0.046], [0.083, -0.02], [0.076, 0.002]], 4);
  m.use(F.walnut);
  m.side([...front, [0.048, -0.12], [0.101, -0.12], ...back], 0.031, { bevel: 0.0045, smooth: 50 });
  m.use({ ...F.walnutDark, kind: 2 });
  m.mirror(() => m.at([0.0152, 0, 0], null, () => m.side(poly([[0.04, -0.016], [0.072, -0.016], [0.088, -0.104], [0.056, -0.104]], 0.005), 0.0022, { bevel: 0.0009 })));
  m.use(F.steelDark);
  m.at([0, -0.1225, 0.075], null, () => m.box(0.031, 0.005, 0.056, 0.0013, 0.003));

  // Handguard: two walnut cheeks with cooling slots you can see the barrel through.
  const cheek = poly([[GUARD_REAR, 0.02], [GUARD_REAR, 0.07, 0.004], [GUARD_FRONT, 0.064, 0.006], [GUARD_FRONT, 0.03, 0.01], [GUARD_REAR - 0.06, 0.016, 0.02]], 0.003);
  m.use(F.walnut);
  m.mirror(() => m.at([0.0165, 0, 0], null, () => m.side(cheek, 0.012, {
    bevel: 0.0042, smooth: 50, holes: slotRow(GUARD_REAR - 0.045, 0.052, GUARD_FRONT + 0.035, 0.05, 5, 0.026, 0.0075, 0),
  })));
  // Belly between the cheeks, and the steel ferrules that clamp them.
  m.use(F.walnutDark);
  m.at([0, 0.024, (GUARD_REAR + GUARD_FRONT) / 2 - 0.012], null, () => m.box(0.03, 0.012, GUARD_REAR - GUARD_FRONT - 0.04, 0.004, 0.005));
  m.use(F.steelDark);
  for (const z of [GUARD_REAR - 0.004, GUARD_FRONT + 0.004]) {
    m.at([0, 0.044, z], null, () => m.front(poly([[-0.0235, -0.027], [0.0235, -0.027], [0.0235, 0.022, 0.008], [0.012, 0.029], [-0.012, 0.029], [-0.0235, 0.022, 0.008]], 0.004), 0.009, { bevel: 0.0012 }));
  }
  // Heat shield under the top slot line.
  m.use(F.steel);
  m.at([0, 0.0685, (GUARD_REAR + GUARD_FRONT) / 2], null, () => m.top(rect(-0.0095, -0.105, 0.0095, 0.105, 0.003), 0.003, {
    bevel: 0.0008, holes: slotRow(0, -0.085, 0, 0.085, 7, 0.011, 0.0045, 0),
  }));

  // Stock: mostly behind the eye, but its comb is what the cheek of the screen sees on a reload.
  m.use(F.walnutDark);
  m.side(poly([[0.15, 0.068], [0.15, 0.022], [0.21, 0.0, 0.012], [0.4, -0.052, 0.008], [0.412, 0.046, 0.012], [0.3, 0.068, 0.03]], 0.004), 0.036, { bevel: 0.008, smooth: 50 });
  m.use(F.rubber);
  m.at([0, -0.003, 0.418], null, () => m.box(0.036, 0.104, 0.014, 0.004, 0.006));
}

function barrel(m: Mesher): void {
  m.at([0, BORE, 0], null, () => {
    m.use(F.barrel);
    m.lathe([[0.0118, -0.15, 0], [0.0118, -0.41], [0.0102, -0.415], [0.0102, -0.57, 0]], 20);
    // Gas tube rides above, into the block.
    m.use(F.steel);
    m.at([0, 0.0185, -0.3], null, () => m.cyl(0.0048, 0.25, 10));
    // Gas block and the front sight tower on it.
    m.use(F.steelDark);
    m.at([0, 0.006, -0.428], null, () => m.box(0.03, 0.04, 0.026, 0.002));
    m.at([0, 0.036, -0.428], null, () => {
      m.side(poly([[0.012, -0.012], [0.007, 0.012, 0.002], [-0.007, 0.012, 0.002], [-0.012, -0.012]], 0.001), 0.006, { bevel: 0.0008 });
      // Hood ears either side of the post.
      m.mirror(() => m.at([0.0085, 0.006, 0], null, () => m.box(0.0022, 0.02, 0.012, 0.0008)));
    });
    m.glow('sight', () => m.at([0, 0.052, -0.4215], null, () => m.box(0.0016, 0.006, 0.0006, 0)));
    // Bayonet lug, because of course it has one.
    m.at([0, -0.014, -0.48], null, () => m.box(0.008, 0.007, 0.018, 0.0012));

    // Brake: a fat sleeve with two rows of side ports and an open crown.
    m.use(F.barrelBlack);
    m.lathe([[0.0102, -0.556, 0], [0.0168, -0.56], [0.0168, MUZZLE + 0.006], [0.0145, MUZZLE], [0.0062, MUZZLE, 0]], 22);
    m.use(F.black);
    m.mirror(() => {
      for (let i = 0; i < 3; i++) m.at([0.0166, 0, -0.574 - i * 0.016], null, () => m.box(0.0012, 0.013, 0.008, 0));
    });
    for (let i = 0; i < 3; i++) m.at([0, 0.0166, -0.574 - i * 0.016], null, () => m.box(0.007, 0.0012, 0.006, 0));
    m.lathe([[0.0062, MUZZLE + 0.0005, 0], [0.0056, MUZZLE + 0.03, 0], [0, MUZZLE + 0.031, 0]], 14);
  });
}

function magazine(m: Mesher): void {
  // Part space: origin at the mouth of the well, feed lips up. It leans forward, so it rocks in.
  m.part('mag', [0, -0.012, -0.09], () => {
    m.at([0, 0, 0], [-0.1, 0, 0], () => {
      m.use(F.steelDark);
      m.side(poly([[-0.036, 0.03], [0.036, 0.03], [0.036, -0.13, 0.004], [-0.036, -0.13, 0.004]], 0.002), 0.027, { bevel: 0.0014 });
      // Pressed ribs: three stiffeners down each face.
      m.use(F.parkerized);
      m.mirror(() => {
        for (const z of [-0.022, 0, 0.022]) m.at([0.0138, -0.056, z], null, () => m.box(0.0016, 0.128, 0.007, 0.0006));
      });
      // Floor plate with a lip to pull on.
      m.use(F.steel);
      m.at([0, -0.133, 0], null, () => m.box(0.031, 0.006, 0.08, 0.0014, 0.003));
      m.at([0, -0.134, 0.042], null, () => m.box(0.02, 0.004, 0.008, 0.001));
      // Feed lips and the top round, a proper rifle cartridge.
      m.use(F.steel);
      m.mirror(() => m.at([0.0108, 0.0305, 0], null, () => m.box(0.0024, 0.0065, 0.062, 0.0006)));
      m.use(F.brass);
      m.at([0, 0.0325, 0.006], null, () => m.cyl(0.0056, 0.042, 12));
      m.at([0, 0.0325, -0.0195], null, () => m.lathe([[0.0056, 0.005, 0], [0.0036, -0.004], [0.0036, -0.012, 0]], 12, { chamfer: 0 }));
      m.use(F.copper);
      m.at([0, 0.0325, -0.031], null, () => m.lathe([[0.0036, 0.001, 0], [0.003, -0.006], [0.0012, -0.014], [0, -0.0155, 0]], 12, { chamfer: 0 }));
      m.part('follower', [0, 0.026, 0], () => {
        m.use(F.polymerGrey);
        m.box(0.02, 0.004, 0.06, 0.0008);
      });
    });
  });
}

function buildHarrow(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0014;
  receiver(m);
  furniture(m);
  barrel(m);
  magazine(m);

  // Carrier in the port, and the handle it throws back and forth on the left.
  m.part('bolt', [0.0178, 0.052, -0.03], () => {
    m.use(F.steel);
    m.box(0.004, 0.0145, 0.066, 0.0008);
    m.use(F.steelDark);
    m.at([0.0016, 0, 0.012], null, () => serrations(m, 5, 0.006, 0.0008, 0.011, 0.0012, F.steelDark));
  });
  m.part('charge', [-0.0198, 0.055, 0.02], () => {
    m.use(F.steelDark);
    m.at([0.002, 0, 0], null, () => m.box(0.004, 0.006, 0.016, 0.0008));
    m.at([-0.008, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.0042, 0.016, 10));
    m.at([-0.017, 0, 0], [0, Math.PI / 2, 0], () => knurl(m, 0.0066, 0.008, F.steel, 14, 0.0005));
  });
  m.part('trigger', [0, -0.0075, -0.002], () => {
    m.use(F.steelDark);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0038, -0.0225, 0.0015], [0.0005, -0.0235, 0.001], [-0.0035, -0.0095, 0.003]], 0.001), 0.0068, { bevel: 0.0007 });
  });

  const model = new Model(m, kit.mats, { glows: { sight: [0x7dff5a, 6] } });
  model.socket('muzzle', [0, BORE, MUZZLE - 0.004]);
  model.socket('eject', [0.021, 0.054, -0.03]);
  model.hand('gripR', [0.018, -0.054, 0.072], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.hand('gripL', [-0.001, 0.013, -0.3], [-0.55, 0.15, -0.8], [0.8, 0.05, -0.55]);
  model.hand('magHold', [-0.02, -0.07, -0.004], [-0.3, 0.1, -0.95], [0.9, -0.1, -0.35], 'mag');
  model.hand('chargeHold', [-0.022, 0.0, 0.004], [-0.5, -0.2, -0.8], [0.8, -0.3, -0.5], 'charge');
  return model;
}

/** How far the carrier and its handle run. */
const BOLT_TRAVEL = 0.06;

function clip(a: Anim): void {
  const P = a.parts;
  // A slower, heavier cycle than the SMG's: the handle is still coming home when the muzzle has settled.
  const cycle = 0.085;
  const c = a.sinceFire < cycle ? a.sinceFire / cycle : 1;
  const run = Math.sin(c * Math.PI) * BOLT_TRAVEL;
  P.bolt!.position.z += run;
  P.charge!.position.z += run;
  pullTrigger(a, 0.08, 0.3);
  P.follower!.position.y -= fill(a) * 0.1;
  a.glow('sight', 1);
  // The muzzle walks up and right over a burst, which the spring alone would not show.
  a.gunR.z -= a.sinceFire < 0.2 ? bump(a.sinceFire, 0, 0.2) * 0.012 : 0;

  if (a.draw < 1) {
    // Up from the low ready, and the off hand rides the handguard in from below.
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.06;
    a.gunR.x -= k * 0.5;
    a.gunR.z -= k * 0.2;
  }

  const p = a.reload;
  if (p < 0) return;
  // Foley: out at 0.05, in at 0.55, bolt at 0.82.
  const out = seg(p, 0.05, 0.22);
  const inn = seg(p, 0.4, 0.56);
  const mag = P.mag!;
  const away = inQuad(out) * (1 - outCubic(inn));
  // It rocks forward out of the catch before it drops, and comes back the same way.
  mag.rotation.x -= Math.min(1, away * 3) * 0.34;
  mag.position.y -= away * 0.36;
  mag.position.z -= away * 0.05;
  if (p > 0.24 && p < 0.38) mag.visible = false;
  const seat = p >= 0.555 ? thud(seg(p, 0.555, 0.68)) : 0;
  const rack = bump(p, 0.76, 0.93);
  P.charge!.position.z += rack * BOLT_TRAVEL;
  P.bolt!.position.z += rack * BOLT_TRAVEL;

  const present = hold(p, 0.0, 0.14, 0.88, 1);
  a.gunR.z -= present * 0.4 + seat * 0.04;
  a.gunR.x += present * 0.16 + seat * 0.06 - rack * 0.07;
  a.gunR.y += present * 0.05;
  a.gunP.x -= present * 0.04;
  a.gunP.y += present * 0.035 + seat * 0.014;
  a.gunP.z += present * 0.06 + rack * 0.02;

  const h = a.left;
  h.fingerRate = 38;
  h.to('magHold', inOut(seg(p, 0.0, 0.07)));
  h.to('pouchL', inOut(seg(p, 0.2, 0.32)));
  h.to('magHold', inOut(seg(p, 0.38, 0.48)));
  h.to('chargeHold', inOut(seg(p, 0.66, 0.75)));
  h.to('gripL', inOut(seg(p, 0.92, 1)));
  h.shape(HANDS.cup, hold(p, 0.01, 0.07, 0.6, 0.66));
  h.shape(HANDS.pinch, hold(p, 0.7, 0.75, 0.9, 0.94));
}

export function harrowDef(kit: Kit): ViewDef {
  return {
    id: 'harrow',
    model: buildHarrow(kit),
    pos: [0.14, -0.136, -0.43],
    rot: [0.022, 0.08, 0],
    // ADS: the hooded post's tip through the rear aperture.
    sight: [0, 0.101, -0.4215], rear: [0, 0.094, 0.118], relief: 0.64,
    // Back into the shoulder with a slight tip, not a muzzle flip (owner, 2026-11-13).
    recoil: { back: 0.042, lift: 0.003, pitch: 0.016, yaw: 0.008, roll: 0.014, omega: 40, zeta: 0.56 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.support },
    heatPerShot: 0.016,
    animate: clip,
  };
}
