/**
 * The Kiln: a flamethrower from a pipe fitter's nightmare. Enamelled fuel tanks, brass unions, a braided feed, a dial
 * that actually reads the tank, and a pilot flame that never goes out. Origin at the top of the rear grip.
 */
import * as THREE from 'three';
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Mesher } from '../kit/mesher';
import { circle, curve, poly, rect, type V2 } from '../kit/shapes';
import { clampBand, hexX, hose, knurl, rivet } from '../kit/details';
import { hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { fill, pullTrigger } from './common';

const WAND_Y = 0.05;
const TANK_Y = -0.005;
const TANK_X = -0.056;
const TANK_Z = -0.15;
const GAUGE_SWEEP = 4.2;
/** The dial leans back toward the eye, and the needle turns about that lean. */
const DIAL_TILT = -Math.PI / 2 + 0.34;
const DIAL_AXIS = new THREE.Vector3(0, -Math.sin(DIAL_TILT), Math.cos(DIAL_TILT));

function wand(m: Mesher): void {
  m.at([0, WAND_Y, 0], null, () => {
    m.use(F.steelDark);
    m.lathe([[0.0, 0.11, 0], [0.018, 0.11], [0.018, -0.02], [0.0155, -0.03], [0.0155, -0.46], [0.0165, -0.465, 0]], 20);
    // Regulator block where the feed joins the wand.
    m.use(F.anodized);
    m.at([0, 0, 0.045], null, () => m.box(0.05, 0.048, 0.086, 0.0024, 0.005));
    m.use(F.brass);
    for (const z of [-0.055, -0.235]) m.at([0, 0, z], null, () => m.lathe([[0.0155, 0.012, 0], [0.0195, 0.012], [0.0195, -0.012], [0.0155, -0.012, 0]], 8, { chamfer: 0.0012 }));
    // Heat jacket: spun fins near the business end.
    m.use(F.steelDark);
    for (let i = 0; i < 14; i++) m.at([0, 0, -0.31 - i * 0.0102], null, () => m.lathe([[0.0165, 0.0022, 0], [0.024, 0.0022], [0.024, -0.0022], [0.0165, -0.0022, 0]], 22, { chamfer: 0.0007 }));
    // Nozzle: a flared bell with the bore glowing inside it.
    m.use(F.barrelBlack);
    m.lathe([[0.0165, -0.455, 0], [0.0215, -0.462], [0.0215, -0.5], [0.031, -0.548], [0.0345, -0.552], [0.034, -0.558], [0.028, -0.556], [0.0165, -0.5], [0.009, -0.47, 0]], 26, { chamfer: 0.0012, smooth: 22 });
    m.use(F.black);
    m.lathe([[0.009, -0.47, 0], [0, -0.47, 0]], 14);
    // Pilot: a small brass spur under the bell, and the flame it holds.
    m.at([0.0, -0.03, -0.52], null, () => {
      m.use(F.brass);
      m.lathe([[0.0, 0.05, 0], [0.0045, 0.05], [0.0045, 0.004], [0.0032, 0.0, 0]], 12);
      m.at([0, 0, 0.026], null, () => m.box(0.012, 0.03, 0.016, 0.001));
    });
  });
  m.part('pilot', [0, WAND_Y - 0.03, -0.522], () => {
    m.glow('pilotBlue', () => m.lathe([[0.0, 0.002, 0], [0.0036, -0.002], [0.0028, -0.012], [0, -0.024, 0]], 10, { chamfer: 0, smooth: 60 }));
    m.glow('pilotHot', () => m.lathe([[0, -0.006, 0], [0.0026, -0.012], [0.0018, -0.026], [0, -0.05, 0]], 10, { chamfer: 0, smooth: 60 }));
  });
  m.use(F.steelDark);
  m.tube([[0, WAND_Y - 0.016, -0.2], [0, WAND_Y - 0.03, -0.3], [0, WAND_Y - 0.03, -0.47]], 0.0028, { seg: 7, samples: 10 });
}

function tanks(m: Mesher): void {
  const body = (x: number, y: number, r: number, len: number) => m.at([x, y, 0], null, () => {
    const h = len / 2;
    const prof: [number, number, number?][] = [[0, h + r * 0.55, 0]];
    for (let i = 1; i <= 8; i++) {
      const a = (i / 8) * Math.PI / 2;
      prof.push([Math.sin(a) * r, h + Math.cos(a) * r * 0.55, 0]);
    }
    for (let i = 8; i >= 0; i--) {
      const a = (i / 8) * Math.PI / 2;
      prof.push([Math.sin(a) * r, -h - Math.cos(a) * r * 0.55, 0]);
    }
    m.lathe(prof, 30, { chamfer: 0, smooth: 40 });
  });
  // The removable tank sits on the camera's side, so the swap happens where it can be seen.
  m.part('tank', [TANK_X, TANK_Y, TANK_Z], () => {
    m.use(F.enamelRed);
    body(0, 0, 0.042, 0.17);
    m.use(F.steelDark);
    for (const z of [-0.075, 0.075]) m.at([0, 0, z], null, () => clampBand(m, 0.0425, 0.012, F.steelDark));
    m.at([-0.0416, 0.012, 0.0], [0, -Math.PI / 2, 0], () => m.at([0, 0, 0], [0.28, 0, 0], () => m.decal('flam', 0.092, 0.0134, 0xe8e0c8)));
    m.at([-0.0408, -0.012, 0.0], [0, -Math.PI / 2, 0], () => m.at([0, 0, 0], [-0.3, 0, 0], () => m.decal('press', 0.072, 0.0105, 0xe8e0c8)));
    m.at([0, 0.0425, -0.02], [-Math.PI / 2, 0, -Math.PI / 2], () => m.decal('kiln', 0.05, 0.0125, 0xe8e0c8));
    // Fill plug.
    m.at([0.0, 0.0432, 0.058], [Math.PI / 2, 0, 0], () => { m.use(F.brass); m.lathe([[0.0, -0.008, 0], [0.0072, -0.008], [0.0072, 0.002], [0.0102, 0.002], [0.0102, 0.006, 0]], 6, { chamfer: 0.0007 }); });
    // Coupling at the back of the tank, where it hands over to the fixed side.
    m.at([0, 0, 0.116], null, () => { m.use(F.brass); m.lathe([[0.006, 0.014, 0], [0.012, 0.014], [0.012, -0.012], [0.006, -0.012, 0]], 10); });
  });
  // Second tank, fixed, right of the wand.
  m.use(F.enamelRed);
  body(0.052, TANK_Y + 0.006, 0.036, 0.17);
  m.at([0.052, TANK_Y + 0.006, 0], null, () => {
    m.use(F.steelDark);
    for (const z of [-0.075, 0.075]) m.at([0, 0, z - 0.0], null, () => clampBand(m, 0.0365, 0.012, F.steelDark));
  });
  // Saddle the tanks ride in, slung off the wand.
  m.use(F.anodized);
  for (const z of [TANK_Z - 0.075, TANK_Z + 0.075]) {
    m.at([0, 0, z], null, () => {
      const out: V2[] = poly([[-0.014, WAND_Y + 0.02], [0.014, WAND_Y + 0.02], [0.022, TANK_Y + 0.046, 0.008], [0.012, TANK_Y - 0.03, 0.006], [-0.012, TANK_Y - 0.03, 0.006], [-0.022, TANK_Y + 0.046, 0.008]], 0.003);
      m.front(out, 0.014, { bevel: 0.0014, holes: [circle(0, WAND_Y, 0.0166, 18)] });
      m.mirror(() => hexX(m, 0.0225, TANK_Y + 0.02, 0, 1, 0.0032));
    });
  }
}

function plumbing(m: Mesher): void {
  // Feed from the tank up to the regulator, and the braided line along the wand.
  m.use(F.copper);
  m.tube([[TANK_X, TANK_Y, TANK_Z + 0.128], [TANK_X, TANK_Y + 0.008, TANK_Z + 0.17], [TANK_X + 0.012, WAND_Y - 0.02, TANK_Z + 0.196], [-0.022, WAND_Y - 0.004, 0.03]], 0.0042, { seg: 9, samples: 22 });
  m.use(F.brass);
  m.at([-0.026, WAND_Y - 0.003, 0.03], [0, Math.PI / 2, 0], () => m.lathe([[0.0, 0.006, 0], [0.0072, 0.006], [0.0072, -0.006], [0.0, -0.006, 0]], 6, { chamfer: 0.0008 }));
  hose(m, [[0.022, WAND_Y + 0.014, 0.06], [0.05, WAND_Y + 0.028, 0.04], [0.058, WAND_Y + 0.012, -0.04], [0.052, WAND_Y - 0.002, -0.12]], 0.0052, 22, F.rubber);
  m.use(F.steel);
  m.at([0.02, WAND_Y + 0.014, 0.062], [0, Math.PI / 2, 0], () => m.cyl(0.0064, 0.01, 10));

  // Dial on top of the regulator: glass, bezel, needle.
  m.at([0, WAND_Y + 0.041, 0.056], [DIAL_TILT, 0, 0], () => {
    m.use(F.brass);
    m.lathe([[0.0225, 0.0025, 0], [0.0255, 0.002], [0.0255, -0.008], [0.0225, -0.008, 0]], 26);
    m.use(F.white);
    m.at([0, 0, 0.0], null, () => m.cyl(0.0224, 0.002, 26, 0));
    m.at([0, 0, 0.0012], null, () => m.decal('dial', 0.04, 0.04, 0x25282c));
    m.glass(() => m.at([0, 0, 0.0034], null, () => m.cyl(0.0224, 0.0004, 26, 0)));
  });
  m.use(F.steelDark);
  m.at([0, WAND_Y + 0.024, 0.052], null, () => m.box(0.03, 0.012, 0.03, 0.0012));

  // Valve wheel on the left of the regulator.
  m.part('valve', [-0.03, WAND_Y + 0.012, 0.022], () => {
    m.at([0, 0, 0], [0, Math.PI / 2, 0], () => {
      m.use(F.brass);
      m.cyl(0.0048, 0.018, 10);
      m.use(F.red);
      m.at([0, 0, -0.01], null, () => {
        const ring: [number, number, number?][] = [[0.0125, 0.0028, 0], [0.0165, 0.0028], [0.0165, -0.0028], [0.0125, -0.0028, 0], [0.0125, 0.0028, 0]];
        m.lathe(ring, 24, { chamfer: 0.0009 });
        for (let i = 0; i < 4; i++) m.at([0, 0, 0], [0, 0, (i / 4) * Math.PI * 2], () => m.at([0.0075, 0, 0], null, () => m.box(0.012, 0.0036, 0.0036, 0.0007)));
      });
    });
  });
}

function grips(m: Mesher): void {
  m.use(F.polymerStipple);
  const front = curve([[0.02, 0.028], [0.021, -0.014], [0.028, -0.05], [0.036, -0.078], [0.044, -0.104]], 4);
  const back = curve([[0.1, -0.104], [0.096, -0.074], [0.088, -0.04], [0.082, 0.028]], 4);
  m.side([...front, [0.046, -0.11], [0.098, -0.11], ...back], 0.033, { bevel: 0.0036, smooth: 50 });
  m.use(F.anodized);
  m.at([0, -0.1125, 0.073], null, () => m.box(0.034, 0.006, 0.058, 0.0014, 0.003));
  m.use(F.steelDark);
  m.side(poly([[-0.03, 0.028], [-0.04, -0.008, 0.006], [-0.024, -0.024, 0.008], [0.03, -0.024, 0.008], [0.05, 0.004, 0.004], [0.05, 0.028]], 0.002), 0.013, {
    bevel: 0.0012,
    holes: [poly([[-0.028, 0.024], [-0.034, -0.008, 0.005], [-0.021, -0.0185, 0.005], [0.022, -0.0185, 0.005], [0.041, 0.004, 0.003], [0.042, 0.024]], 0.002)],
  });
  // Stock strut: a plain folding brace is all a two-handed fire hose needs.
  m.use(F.parkerized);
  m.side(poly([[0.11, 0.075], [0.3, 0.07, 0.006], [0.3, 0.052, 0.006], [0.11, 0.038]], 0.003), 0.022, { bevel: 0.0016, holes: [poly([[0.14, 0.066], [0.27, 0.062], [0.27, 0.052], [0.14, 0.048]], 0.003)] });
  m.use(F.rubber);
  m.at([0, 0.03, 0.312], null, () => m.side(rect(-0.012, -0.06, 0.012, 0.06, 0.009), 0.032, { bevel: 0.0034 }));

  // Forward handle on the wand: a knurled sleeve with a guard ring, gripped from below.
  m.at([0, WAND_Y, -0.265], null, () => {
    knurl(m, 0.0172, 0.076, F.steelDark, 26, 0.0006);
    m.use(F.anodized);
    for (const z of [-0.04, 0.04]) m.at([0, 0, z], null, () => m.lathe([[0.0155, 0.004, 0], [0.0215, 0.004], [0.0215, -0.004], [0.0155, -0.004, 0]], 22));
  });
}

function buildKiln(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0014;
  wand(m);
  tanks(m);
  plumbing(m);
  grips(m);
  m.at([0.0, WAND_Y + 0.017, -0.16], null, () => { m.use(F.steelDark); m.box(0.01, 0.003, 0.2, 0.0007); for (let i = 0; i < 6; i++) m.at([0, 0.0018, -0.08 + i * 0.032], [-Math.PI / 2, 0, 0], () => rivet(m, 0.0016)); });
  m.part('needle', [0, WAND_Y + 0.0426, 0.0555], () => {
    m.at([0, 0, 0], [DIAL_TILT, 0, 0], () => {
      m.use(F.red);
      m.at([0, 0.0078, 0.0026], null, () => m.box(0.0012, 0.018, 0.0006, 0));
      m.use(F.steelDark);
      m.at([0, 0, 0.0026], null, () => m.cyl(0.0022, 0.001, 10, 0));
    });
  });
  m.part('trigger', [0, 0.02, -0.002], () => {
    m.use(F.steelDark);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0038, -0.0205, 0.0015], [0.0005, -0.0215, 0.001], [-0.0035, -0.0095, 0.003]], 0.001), 0.0065, { bevel: 0.0007 });
  });
  const model = new Model(m, kit.mats, { glows: { pilotBlue: [0x3a7dff, 4], pilotHot: [0xffa030, 5] } });
  model.socket('muzzle', [0, WAND_Y, -0.56]);
  model.socket('eject', [0, WAND_Y, 0]);
  model.hand('gripR', [0.018, -0.042, 0.07], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.hand('gripL', [-0.002, WAND_Y - 0.0185, -0.265], [-0.55, 0.15, -0.8], [0.8, 0.05, -0.55]);
  model.hand('tankHold', [-0.044, -0.024, -0.02], [-0.3, 0.1, -0.95], [0.9, 0.3, -0.2], 'tank');
  model.hand('valveHold', [-0.022, 0, 0], [0.1, 0.9, -0.4], [0.7, -0.1, -0.7], 'valve');
  return model;
}

function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a, 0.09, 0.26);
  // Needle sweeps from full round to empty, with a shiver from the pump while it flows.
  const flowing = a.sinceFire < 0.08 ? 1 : 0;
  const needle = P.needle!;
  needle.rotateOnAxis(DIAL_AXIS, (0.5 - fill(a)) * GAUGE_SWEEP + Math.sin(a.time * 61) * 0.03 * flowing);

  // Pilot flame: a bit of a wander, and it flattens forward at speed.
  const f = 1 + Math.sin(a.time * 23) * 0.12 + Math.sin(a.time * 37 + 1) * 0.08;
  const pilot = P.pilot!;
  pilot.scale.set(1 - flowing * 0.25, 1 - flowing * 0.25, f * (1 + flowing * 0.8));
  pilot.position.y += Math.sin(a.time * 19) * 0.0003;
  a.glow('pilotBlue', 0.85 + 0.2 * Math.sin(a.time * 29));
  a.glow('pilotHot', 0.75 + 0.3 * Math.sin(a.time * 41) + flowing * 0.5);

  // Hose pressure pushes the wand around while it burns.
  a.gunP.x += Math.sin(a.time * 13) * 0.0012 * flowing;
  a.gunP.y += Math.sin(a.time * 17) * 0.0012 * flowing;

  if (a.draw < 1) {
    const k = 1 - outCubic(a.draw);
    a.gunR.z += k * 0.2;
    P.valve!.rotation.x += k * 3;
  }
  const p = a.reload;
  if (p < 0) return;

  // Close the valve, drop the tank, bring a full one up, seat it, open the valve.
  const closeV = inOut(seg(p, 0.02, 0.12));
  const openV = inOut(seg(p, 0.74, 0.92));
  P.valve!.rotation.x += (closeV - openV) * Math.PI * 1.5;
  const drop = inQuad(seg(p, 0.14, 0.32));
  const rise = 1 - outCubic(seg(p, 0.38, 0.6));
  const off = p < 0.35 ? drop : rise;
  const tank = P.tank!;
  tank.position.y -= off * 0.34;
  tank.position.x -= off * 0.14;
  tank.rotation.z += off * 0.5;
  tank.rotation.x -= off * 0.3;
  if (p > 0.32 && p < 0.39) tank.visible = false;
  const seat = p >= 0.595 ? thud(seg(p, 0.595, 0.72)) : 0;

  const present = hold(p, 0, 0.12, 0.88, 1);
  a.gunR.z -= present * 0.3;
  a.gunR.x += present * 0.12 + seat * 0.03;
  a.gunP.x -= present * 0.05;
  a.gunP.y += present * 0.03;
  a.gunP.z += present * 0.07;

  const h = a.left;
  h.fingerRate = 34;
  h.to('valveHold', inOut(seg(p, 0.0, 0.05)));
  h.to('tankHold', inOut(seg(p, 0.1, 0.15)));
  h.to('pouchL', inOut(seg(p, 0.27, 0.36)));
  h.to('tankHold', inOut(seg(p, 0.38, 0.46)));
  h.to('valveHold', inOut(seg(p, 0.64, 0.74)));
  h.to('gripL', inOut(seg(p, 0.9, 1)));
  h.shape(HANDS.pinch, hold(p, 0.01, 0.05, 0.1, 0.14));
  h.shape(HANDS.cup, hold(p, 0.12, 0.17, 0.6, 0.64));
  h.shape(HANDS.pinch, hold(p, 0.66, 0.74, 0.9, 0.95));
}

export function kilnDef(kit: Kit): ViewDef {
  return {
    id: 'kiln',
    model: buildKiln(kit),
    pos: [0.205, -0.19, -0.44],
    rot: [0.02, 0.07, 0],
    recoil: { back: 0.016, lift: 0.002, pitch: 0.009, yaw: 0.004, roll: 0.006, omega: 42, zeta: 0.6 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.support },
    heatPerShot: 0.0045,
    animate: clip,
  };
}

