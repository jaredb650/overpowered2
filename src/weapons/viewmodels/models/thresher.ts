/**
 * The Thresher: a full-auto drum shotgun, the pump's loud brother on slot 2. A long slab-sided polymer receiver with the
 * stock in line behind it, a carry handle with the sights on it, a barrel under a slotted shroud ending in a fat ported
 * brake, and the drum: a twenty-shell steel can hung under the gun, which comes out on a latch and goes back in with a
 * slap. Grey and black where the pump is walnut and parkerized, so the two are told apart before the shape.
 * Origin at the top of the grip.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Mesher } from '../kit/mesher';
import { curve, poly, rect } from '../kit/shapes';
import { knurl, rivet, screwX } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { drawCount, fill, pullTrigger } from './common';

const BORE = 0.05;
const FRONT = -0.2;
const MUZZLE = -0.575;
/** The drum: where its axle sits under the gun, its radius and its width. */
const DRUM_Z = -0.135;
const DRUM_Y = -0.088;
const DRUM_R = 0.078;
const DRUM_W = 0.064;
const BOLT_TRAVEL = 0.07;

function receiver(m: Mesher): void {
  // One slab from the butt to the barrel, tall, with the stock moulded in line so the gun pushes straight back.
  m.use(F.polymerGrey);
  m.side(poly([[0.16, 0.014], [0.16, 0.086, 0.006], [FRONT, 0.086, 0.004], [FRONT, 0.012, 0.004], [-0.06, 0.008, 0.006], [0.07, 0.008]], 0.002), 0.046, { bevel: 0.0024 });
  // A darker spine and a channel down each flank.
  m.use(F.polymer);
  m.at([0, 0.088, -0.02], null, () => m.top(rect(-0.019, -0.18, 0.019, 0.18, 0.004), 0.006, { bevel: 0.0016 }));
  m.mirror(() => m.at([0.0236, 0.05, -0.02], null, () => m.side(rect(-0.16, -0.008, 0.16, 0.008, 0.004), 0.002, { bevel: 0.0007 })));
  // Ejection port on the right with the bolt in it.
  m.use(F.black);
  m.at([0.0236, 0.06, -0.06], null, () => m.box(0.0014, 0.022, 0.08, 0));
  m.mirror(() => {
    screwX(m, 0.024, 0.03, 0.12, 1, 0.0026);
    screwX(m, 0.024, 0.03, -0.17, 1, 0.0026);
    screwX(m, 0.024, 0.075, 0.12, 1, 0.0022);
  });
  m.at([-0.0237, 0.05, -0.08], [0, -Math.PI / 2, 0], () => m.decal('thresher', 0.1, 0.02, 0xc8ccd2));
  m.at([-0.0237, 0.032, 0.05], [0, -Math.PI / 2, 0], () => m.decal('drum20', 0.05, 0.008, 0xa8adb4));
  m.at([-0.0237, 0.074, 0.06], [0, -Math.PI / 2, 0], () => m.decal('serial', 0.05, 0.0056, 0x8f949a));
  // Shell count down the left flank where the shooter sees it.
  m.at([-0.0237, 0.02, -0.11], [0, -Math.PI / 2, 0], () => {
    m.use(F.black);
    m.prism(rect(-0.042, -0.0055, 0.042, 0.0055, 0.001), 0.0008, { bevel: 0 });
    m.at([0, 0, 0.0006], null, () => m.screen('ammo', 0.08, 0.0094));
  });

  // Trigger guard and the paddle that drops the drum.
  m.use(F.polymer);
  const out = poly([[-0.04, 0.008], [-0.044, -0.03, 0.006], [-0.026, -0.043, 0.008], [0.03, -0.043, 0.008], [0.052, -0.012, 0.004], [0.052, 0.008]], 0.002);
  const inner = poly([[-0.036, 0.004], [-0.039, -0.029, 0.005], [-0.024, -0.0395, 0.005], [0.027, -0.0395, 0.005], [0.047, -0.0115, 0.003], [0.047, 0.004]], 0.002);
  m.side(out, 0.014, { bevel: 0.0012, holes: [inner] });
  m.part('latch', [0, -0.002, -0.058], () => {
    m.use(F.steelDark);
    m.at([0, -0.008, 0], [0.3, 0, 0], () => m.box(0.016, 0.02, 0.005, 0.0009));
  });
  m.part('selector', [-0.0238, 0.022, 0.03], () => {
    m.use(F.steelDark);
    m.at([0, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.0058, 0.003, 12));
    m.at([-0.0016, 0.0, -0.011], null, () => m.box(0.0026, 0.005, 0.022, 0.0008));
  });
}

function furniture(m: Mesher): void {
  // Pistol grip, stippled polymer.
  const front = curve([[0.02, 0.006], [0.021, -0.022], [0.027, -0.044], [0.032, -0.064], [0.04, -0.088], [0.046, -0.112]], 4);
  const back = curve([[0.104, -0.112], [0.097, -0.078], [0.088, -0.044], [0.082, -0.016], [0.076, 0.006]], 4);
  m.use(F.polymerStipple);
  m.side([...front, [0.048, -0.12], [0.102, -0.12], ...back], 0.032, { bevel: 0.0045, smooth: 50 });
  m.use(F.polymer);
  m.at([0, -0.1225, 0.075], null, () => m.box(0.032, 0.005, 0.056, 0.0013, 0.003));
  // The stock: the slab carries on, then a thick rubber pad.
  m.use(F.polymerGrey);
  m.side(poly([[0.16, 0.086], [0.16, 0.014], [0.39, 0.0, 0.008], [0.4, 0.084, 0.01]], 0.004), 0.04, { bevel: 0.006, smooth: 50 });
  m.use(F.rubber);
  m.at([0, 0.042, 0.405], null, () => m.box(0.042, 0.092, 0.016, 0.004, 0.008));
  // Carry handle with the rear aperture on it and a front post on its own tower.
  m.use(F.polymer);
  m.side(poly([[0.11, 0.086], [0.1, 0.124, 0.01], [-0.12, 0.124, 0.01], [-0.13, 0.086], [-0.1, 0.086], [-0.09, 0.108, 0.006], [0.08, 0.108, 0.006], [0.09, 0.086]], 0.002), 0.018, { bevel: 0.002 });
  m.use(F.steelDark);
  m.at([0, 0.13, 0.085], null, () => {
    m.box(0.02, 0.012, 0.014, 0.0012);
    m.at([0, 0.008, 0], null, () => m.pipe(0.0064, 0.003, 0.004, 16));
  });
  // Front post on a tower clamped to the barrel, at the same height as the rear aperture.
  m.at([0, BORE + 0.016, -0.47], null, () => m.box(0.028, 0.014, 0.024, 0.002, 0.004));
  m.at([0, 0.106, -0.47], null, () => {
    m.side(poly([[0.012, -0.036], [0.007, 0.022, 0.002], [-0.007, 0.022, 0.002], [-0.012, -0.036]], 0.001), 0.008, { bevel: 0.0008 });
    m.mirror(() => m.at([0.009, 0.014, 0], null, () => m.box(0.0024, 0.02, 0.012, 0.0008)));
  });
  m.glow('sight', () => m.at([0, 0.13, -0.4645], null, () => m.box(0.0018, 0.006, 0.0006, 0)));
  // Handguard under the barrel, where the off hand holds the climb down.
  m.use(F.polymer);
  m.at([0, 0.02, -0.29], null, () => m.box(0.044, 0.04, 0.18, 0.004, 0.01));
  m.use(F.rubber);
  m.mirror(() => {
    for (let i = 0; i < 5; i++) m.at([0.0225, 0.02, -0.225 - i * 0.032], null, () => m.box(0.002, 0.03, 0.018, 0.0008));
  });
}

function barrel(m: Mesher): void {
  m.at([0, BORE, 0], null, () => {
    m.use(F.barrel);
    m.lathe([[0.0125, FRONT, 0], [0.0125, -0.52, 0]], 20);
    // A slotted shroud over the top half, the barrel showing through.
    m.use(F.steelDark);
    m.at([0, 0, -0.36], null, () => m.lathe([[0.019, 0.15, 0], [0.019, -0.15, 0]], 24, { a0: -0.15, a1: Math.PI + 0.15 }));
    m.use(F.black);
    m.mirror(() => {
      for (const [y, x] of [[0.012, 0.014], [0.0185, 0.004]] as const) {
        m.at([x, y, -0.36], [0, 0, 0], () => {
          for (let i = 0; i < 6; i++) m.at([0, 0, -0.12 + i * 0.048], null, () => m.box(0.004, 0.003, 0.03, 0));
        });
      }
    });
    // The brake: a square block with three big ports a side, wide enough to see the flash come out of them.
    m.use(F.barrelBlack);
    m.at([0, 0, -0.548], null, () => m.box(0.036, 0.034, 0.058, 0.003, 0.006));
    m.use(F.black);
    m.mirror(() => {
      for (let i = 0; i < 3; i++) m.at([0.0182, 0, -0.528 - i * 0.017], null, () => m.box(0.0012, 0.02, 0.01, 0));
    });
    m.lathe([[0.012, MUZZLE + 0.0005, 0], [0.011, MUZZLE + 0.03, 0], [0, MUZZLE + 0.031, 0]], 16);
  });
}

function drum(m: Mesher): void {
  // Part space: origin at the mouth of the well. The drum hangs below on a neck, its axle across the gun.
  m.part('drum', [0, 0.004, DRUM_Z], () => {
    m.use(F.steelDark);
    // The neck that feeds into the gun.
    m.at([0, -0.022, 0], null, () => m.box(0.03, 0.04, 0.05, 0.002, 0.004));
    m.at([0, DRUM_Y, 0], [0, Math.PI / 2, 0], () => {
      m.use(F.parkerized);
      m.lathe([[DRUM_R - 0.006, DRUM_W / 2, 0], [DRUM_R, DRUM_W / 2 - 0.004], [DRUM_R, -DRUM_W / 2 + 0.004], [DRUM_R - 0.006, -DRUM_W / 2, 0]], 40, { chamfer: 0.0016 });
      // Pressed rings on the face, and the winding key in its middle.
      m.use(F.steelDark);
      for (const side of [1, -1]) {
        m.at([0, 0, (side * DRUM_W) / 2], null, () => {
          m.lathe([[DRUM_R - 0.006, 0.001, 0], [DRUM_R - 0.006, -0.001], [0.03, -0.001], [0.03, 0.001, 0]], 36, { chamfer: 0.0005 });
          m.lathe([[0.026, side * 0.004, 0], [0.026, 0], [0.018, 0], [0.018, side * 0.004, 0]], 24, { chamfer: 0.0008 });
        });
      }
      m.at([0, 0, -DRUM_W / 2 - 0.006], null, () => knurl(m, 0.012, 0.008, F.steel, 18, 0.0006));
      m.use(F.steel);
      m.at([0, 0, -DRUM_W / 2 - 0.012], null, () => m.box(0.03, 0.006, 0.004, 0.0012));
      // Ribs around the rim.
      m.use(F.parkerized);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        m.at([Math.cos(a) * (DRUM_R + 0.001), Math.sin(a) * (DRUM_R + 0.001), 0], [0, 0, a], () => m.box(0.003, 0.006, DRUM_W - 0.012, 0.0008));
      }
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.2;
        m.at([Math.cos(a) * (DRUM_R - 0.012), Math.sin(a) * (DRUM_R - 0.012), -DRUM_W / 2 - 0.0006], [Math.PI, 0, 0], () => rivet(m, 0.0018));
      }
    });
    m.at([-DRUM_W / 2 - 0.0012, DRUM_Y + 0.04, 0], [0, -Math.PI / 2, 0], () => m.decal('drum20', 0.05, 0.008, 0xd8c35a));
  });
}

function buildThresher(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0016;
  receiver(m);
  furniture(m);
  barrel(m);
  drum(m);
  m.part('bolt', [0.0228, 0.06, -0.06], () => {
    m.use(F.steel);
    m.box(0.004, 0.018, 0.074, 0.0008);
  });
  m.part('charge', [-0.0256, 0.07, -0.12], () => {
    m.use(F.steelDark);
    m.at([0.002, 0, 0], null, () => m.box(0.004, 0.008, 0.018, 0.0008));
    m.at([-0.009, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.0048, 0.016, 10));
  });
  m.part('trigger', [0, -0.0075, -0.002], () => {
    m.use(F.steelDark);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0038, -0.0225, 0.0015], [0.0005, -0.0235, 0.001], [-0.0035, -0.0095, 0.003]], 0.001), 0.0068, { bevel: 0.0007 });
  });

  const model = new Model(m, kit.mats, { glows: { sight: [0xff6a2a, 6] }, screens: { ammo: [240, 28] } });
  model.socket('muzzle', [0, BORE, MUZZLE - 0.004]);
  model.socket('eject', [0.026, 0.062, -0.06]);
  model.hand('gripR', [0.018, -0.054, 0.072], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.hand('gripL', [-0.004, -0.004, -0.3], [-0.55, 0.15, -0.8], [0.8, 0.05, -0.55]);
  model.hand('drumHold', [-0.04, DRUM_Y, 0.0], [-0.95, 0.1, -0.2], [0.1, -0.2, -0.95], 'drum');
  model.hand('chargeHold', [-0.022, 0.0, 0.004], [-0.5, -0.2, -0.8], [0.8, -0.3, -0.5], 'charge');
  return model;
}

function clip(a: Anim): void {
  const P = a.parts;
  // The bolt runs on every shot and is home before the next, five a second.
  const cycle = 0.11;
  const c = a.sinceFire < cycle ? a.sinceFire / cycle : 1;
  const run = Math.sin(c * Math.PI) * BOLT_TRAVEL;
  P.bolt!.position.z += run;
  pullTrigger(a, 0.1, 0.3);
  a.glow('sight', 1);
  // The muzzle hops and twists a little on each shell, on top of the spring.
  if (a.sinceFire < 0.14) {
    const k = bump(a.sinceFire, 0, 0.14) * a.strength;
    a.gunR.x += k * 0.02;
    a.gunR.z -= k * (a.shots % 2 === 0 ? 0.012 : -0.008);
  }
  // A drum running low rides a little higher in the hand.
  a.gunP.y += (1 - fill(a)) * 0.003;

  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunP.y -= k * 0.07;
    a.gunR.x -= k * 0.5;
    a.gunR.z += k * 0.25;
  }

  const p = a.reload;
  if (p < 0) return;
  // Foley: drum_out at 0.04, drum_in at 0.52, bolt at 0.84.
  const out = seg(p, 0.06, 0.22);
  const inn = seg(p, 0.36, 0.52);
  const d = P.drum!;
  const away = inQuad(out) * (1 - outCubic(inn));
  // It tips forward off the catch, then drops; the new one comes up the same way.
  d.rotation.x -= Math.min(1, away * 3) * 0.4;
  d.position.y -= away * 0.4;
  d.position.z += away * 0.04;
  d.position.x -= away * 0.06;
  if (p > 0.24 && p < 0.34) d.visible = false;
  P.latch!.rotation.x -= bump(p, 0.02, 0.1) * 0.5;
  const seat = p >= 0.52 ? thud(seg(p, 0.52, 0.64)) : 0;
  const rack = bump(p, 0.74, 0.9);
  P.charge!.position.z += rack * BOLT_TRAVEL;
  P.bolt!.position.z += rack * BOLT_TRAVEL;

  // Rolled onto its right side so the drum is shown to the shooter.
  const present = hold(p, 0.0, 0.12, 0.88, 1);
  a.gunR.z -= present * 0.5 + seat * 0.05;
  a.gunR.x += present * 0.2 + seat * 0.06 - rack * 0.06;
  a.gunR.y += present * 0.08;
  a.gunP.x -= present * 0.05;
  a.gunP.y += present * 0.04 + seat * 0.016;
  a.gunP.z += present * 0.05 + rack * 0.02;

  const h = a.left;
  h.fingerRate = 36;
  h.to('drumHold', inOut(seg(p, 0.0, 0.06)));
  h.to('pouchL', inOut(seg(p, 0.2, 0.3)));
  h.to('drumHold', inOut(seg(p, 0.34, 0.44)));
  h.to('chargeHold', inOut(seg(p, 0.66, 0.74)));
  h.to('gripL', inOut(seg(p, 0.92, 1)));
  h.shape(HANDS.cup, hold(p, 0.0, 0.06, 0.56, 0.62));
  h.shape(HANDS.pinch, hold(p, 0.68, 0.74, 0.9, 0.94));
}

export function thresherDef(kit: Kit): ViewDef {
  return {
    id: 'thresher',
    model: buildThresher(kit),
    pos: [0.15, -0.14, -0.42],
    rot: [0.026, 0.08, 0],
    // ADS: the front post's tip through the carry handle's aperture.
    sight: [0, 0.133, -0.4645], rear: [0, 0.138, 0.085], relief: 0.65,
    recoil: { back: 0.052, lift: 0.01, pitch: 0.075, yaw: 0.014, roll: 0.03, omega: 34, zeta: 0.5 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.support },
    heatPerShot: 0.05,
    animate: clip,
    readout: a => drawCount(a, 'ammo', 2, 10, '#ffb020'),
  };
}
