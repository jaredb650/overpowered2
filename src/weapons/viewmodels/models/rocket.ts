/**
 * The Mule: a shoulder-fired launcher. Olive tube with a hinged breech you can see into, the warhead's nose proud of
 * the muzzle while it is loaded, a boxy optic on the left, and enough stencil paint to look issued rather than designed.
 * Origin sits at the top of the rear grip. The tube rides above it, on the shoulder.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Mesher, V3 } from '../kit/mesher';
import { curve, poly, rect, type V2 } from '../kit/shapes';
import { clampBand, knurl, rail, rivet, screwX } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { pullTrigger } from './common';

const AXIS = 0.082;
const R = 0.05;
const BREECH_Z0 = -0.015;
const BREECH_Z1 = -0.245;
/** How far the cover swings on its hinge. */
const BREECH_OPEN = 2.1;

function arcShell(m: Mesher, r: number, z0: number, z1: number, a0: number, a1: number, thick: number): void {
  // A curved plate with a real thickness. Lathe arcs have no end caps, so the two cut faces are added by hand.
  const zc = (z0 + z1) / 2;
  const n = 18;
  const pts: V2[] = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  for (let i = n; i >= 0; i--) { const a = a0 + ((a1 - a0) * i) / n; pts.push([Math.cos(a) * (r - thick), Math.sin(a) * (r - thick)]); }
  m.at([0, 0, zc], null, () => m.prism(pts, Math.abs(z1 - z0), { bevel: 0.0014, smooth: 30 }));
}

function tube(m: Mesher): void {
  m.at([0, AXIS, 0], null, () => {
    m.use(F.olive);
    // Rear section: everything behind the breech, ending in a flared venturi that passes the shooter's cheek.
    m.lathe([[R - 0.003, 0.36, 0], [0.066, 0.355], [0.0695, 0.33], [0.058, 0.27], [R + 0.0015, 0.24], [R + 0.0015, 0.2], [R + 0.004, 0.196], [R + 0.004, 0.172], [R + 0.0015, 0.168], [R + 0.0015, BREECH_Z0 + 0.012, 0]], 36, { chamfer: 0.0016, smooth: 24 });
    m.use(F.black);
    m.lathe([[R - 0.003, 0.36, 0], [0, 0.3, 0]], 24);
    // Forward section.
    m.use(F.olive);
    m.lathe([[R + 0.0015, BREECH_Z1 - 0.012, 0], [R + 0.0015, -0.3], [R + 0.0035, -0.304], [R + 0.0035, -0.335], [R + 0.0015, -0.339], [R + 0.0015, -0.52], [R + 0.0005, -0.585, 0]], 36, { chamfer: 0.0014 });
    // Ribbed blast sleeve at the muzzle, soft where it meets the world.
    m.use(F.rubber);
    const prof: [number, number, number?][] = [[R + 0.0005, -0.575, 0], [R + 0.0045, -0.58]];
    for (let i = 0; i < 6; i++) {
      const z = -0.588 - i * 0.0125;
      prof.push([R + 0.0066, z], [R + 0.0066, z - 0.006], [R + 0.0035, z - 0.0075], [R + 0.0035, z - 0.0115]);
    }
    prof.push([R + 0.009, -0.665], [R + 0.009, -0.685], [R + 0.0055, -0.69], [R - 0.0045, -0.69], [R - 0.0045, -0.64, 0]);
    m.lathe(prof, 36, { chamfer: 0.0009, smooth: 20 });
    m.use(F.black);
    m.lathe([[R - 0.0045, -0.64, 0], [R - 0.006, -0.2, 0]], 28);

    // Breech cradle: the lower half stays with the tube, and the rocket lies in it when the cover opens.
    m.use(F.steelDark);
    m.at([0, 0, 0], null, () => arcShell(m, R + 0.0015, BREECH_Z0 + 0.012, BREECH_Z1 - 0.012, Math.PI * 1.02, Math.PI * 1.98, 0.006));
    m.use(F.black);
    m.at([0, 0, 0], null, () => arcShell(m, R - 0.006, BREECH_Z0 + 0.01, BREECH_Z1 - 0.01, Math.PI * 1.0, Math.PI * 2.0, 0.002));
    // Rings either side of the opening are what the cover latches against.
    m.use(F.parkerized);
    for (const z of [BREECH_Z0 + 0.012, BREECH_Z1 - 0.012]) {
      m.at([0, 0, z], null, () => m.lathe([[R - 0.008, 0.008, 0], [R + 0.0055, 0.008], [R + 0.0055, -0.008], [R - 0.008, -0.008, 0]], 36, { chamfer: 0.0012 }));
    }
    // Straps and the markings along the top line, where the shooter reads them.
    for (const z of [0.11, -0.45]) m.at([0, 0, z], null, () => clampBand(m, R + 0.0015, 0.016, F.steelDark));
    m.at([-0.0002, R + 0.0024, -0.41], [-Math.PI / 2, 0, -Math.PI / 2], () => m.decal('hazard', 0.1, 0.018, 0xc9a227));
  });
  // Stencils on the camera's side of the tube, read from the left.
  const onLeft = (a: number, z: number, fn: () => void) => m.at([-Math.cos(a) * (R + 0.002), AXIS + Math.sin(a) * (R + 0.002), z], [0, -Math.PI / 2, 0], () => m.at([0, 0, 0], [a, 0, 0], fn));
  onLeft(0.5, -0.43, () => m.decal('he', 0.04, 0.015, 0xd8c35a));
  onLeft(0.5, -0.33, () => m.decal('arrow', 0.03, 0.02, 0xd8d0a0));
  onLeft(0.5, 0.05, () => m.decal('crucible', 0.09, 0.0125, 0xc8c4a0));
  onLeft(0.15, 0.09, () => m.decal('serial', 0.09, 0.01, 0xb0ad90));
  onLeft(0.15, -0.4, () => m.decal('warn', 0.022, 0.022, 0xd8c35a));
}

function optic(m: Mesher): void {
  m.at([-0.066, AXIS + 0.042, -0.08], null, () => {
    // Bracket reaching out from the tube.
    m.use(F.anodized);
    m.at([0.02, -0.03, 0.0], null, () => m.side(poly([[0.05, 0], [-0.05, 0], [-0.04, 0.02, 0.006], [0.04, 0.02, 0.006]], 0.002), 0.03, { bevel: 0.0014 }));
    m.at([0.03, -0.03, 0.0], null, () => { m.use(F.steelDark); m.box(0.024, 0.008, 0.1, 0.0012); });
    // Body.
    m.use(F.polymer);
    m.side(poly([[0.075, -0.018], [0.075, 0.02, 0.006], [0.058, 0.03, 0.006], [-0.062, 0.03, 0.006], [-0.075, 0.016, 0.006], [-0.075, -0.018, 0.005]], 0.003), 0.044, { bevel: 0.0024 });
    m.use(F.polymerGrey);
    m.mirror(() => m.at([0.0228, 0, 0], null, () => m.side(rect(-0.06, -0.012, 0.06, 0.022, 0.003), 0.0024, { bevel: 0.0008, holes: [rect(-0.05, -0.006, -0.012, 0.016, 0.0018), rect(0.0, -0.006, 0.05, 0.016, 0.0018)] })));
    m.mirror(() => {
      screwX(m, 0.0236, 0.018, 0.056, 1, 0.0018);
      screwX(m, 0.0236, -0.008, -0.056, 1, 0.0018);
    });
    // Objective forward, big rubber eyecup at the back.
    m.at([0, 0.006, -0.075], null, () => {
      m.use(F.rubber);
      m.lathe([[0.021, 0.004, 0], [0.024, 0.0], [0.0245, -0.018], [0.0225, -0.03], [0.0195, -0.031], [0.0185, -0.02, 0]], 26);
      m.use(F.black);
      m.at([0, 0, -0.012], null, () => m.cyl(0.0185, 0.001, 20, 0));
      m.glass(() => m.at([0, 0, -0.0125], null, () => m.cyl(0.0184, 0.0006, 20, 0)));
    });
    m.at([0, 0.006, 0.075], null, () => {
      m.use(F.rubber);
      m.lathe([[0.0185, 0.03, 0], [0.0225, 0.03], [0.0235, 0.012], [0.0205, 0.0], [0.0175, 0.0, 0]], 24);
      m.use(F.black);
      m.at([0, 0, 0.004], null, () => m.cyl(0.0172, 0.001, 18, 0));
      // A lit reticle in the eyepiece reads from the shooter's seat.
      m.glow('reticle', () => m.at([0, 0, 0.0052], null, () => {
        m.prism(rect(-0.0085, -0.0006, 0.0085, 0.0006, 0), 0.0002, { bevel: 0 });
        m.prism(rect(-0.0006, -0.0085, 0.0006, 0.0085, 0), 0.0002, { bevel: 0 });
      }));
    });
    // Range readout on the left flank, and a turret on top.
    m.at([-0.0236, 0.004, 0.02], [0, -Math.PI / 2, 0], () => {
      m.use(F.polymerGrey);
      m.prism(rect(-0.027, -0.0135, 0.027, 0.0135, 0.002), 0.0018, { bevel: 0.0006 });
      m.use(F.black);
      m.at([0, 0, 0.0008], null, () => m.prism(rect(-0.0248, -0.0115, 0.0248, 0.0115, 0.0012), 0.0008, { bevel: 0 }));
      m.at([0, 0, 0.0014], null, () => m.screen('lock', 0.047, 0.0215));
    });
    m.at([0, 0.03, -0.01], [Math.PI / 2, 0, 0], () => { knurl(m, 0.0095, 0.01, F.steelDark, 20, 0.0005); m.use(F.steelDark); m.at([0, 0, -0.0052], null, () => m.cyl(0.0098, 0.0014, 18)); });
  });
  // Armoured cable down to the grip.
  m.use(F.rubber);
  m.tube([[-0.05, AXIS + 0.02, 0.0], [-0.056, AXIS - 0.018, 0.02], [-0.05, AXIS - 0.06, 0.04], [-0.022, -0.002, 0.045], [-0.016, 0.002, 0.06]], 0.0024, { seg: 7, samples: 26 });
  m.use(F.steelDark);
  m.at([-0.016, 0.0, 0.06], [0.9, 0, 0], () => m.cyl(0.0042, 0.012, 10));
}

function grips(m: Mesher): void {
  // Rear grip and fire-control box under the tube.
  m.use(F.parkerized);
  m.side(poly([[0.1, 0.03], [0.1, 0.0, 0.006], [0.088, -0.012, 0.006], [-0.075, -0.012, 0.006], [-0.1, 0.03]], 0.003), 0.044, { bevel: 0.002 });
  m.use(F.polymerStipple);
  const front = curve([[0.02, -0.01], [0.021, -0.036], [0.028, -0.06], [0.036, -0.082], [0.044, -0.112]], 4);
  const back = curve([[0.098, -0.112], [0.094, -0.08], [0.086, -0.045], [0.08, -0.01]], 4);
  m.side([...front, [0.046, -0.118], [0.096, -0.118], ...back], 0.032, { bevel: 0.0036, smooth: 50 });
  m.use(F.anodized);
  m.at([0, -0.1205, 0.071], null, () => m.box(0.032, 0.006, 0.056, 0.0014, 0.003));
  m.use(F.polymer);
  m.side(poly([[-0.036, -0.012], [-0.04, -0.03, 0.006], [-0.024, -0.042, 0.008], [0.03, -0.042, 0.008], [0.05, -0.016, 0.004], [0.05, -0.012]], 0.002), 0.0125, {
    bevel: 0.0013,
    holes: [poly([[-0.031, -0.014], [-0.033, -0.028, 0.005], [-0.021, -0.0365, 0.005], [0.022, -0.0365, 0.005], [0.041, -0.0155, 0.003], [0.042, -0.014]], 0.002)],
  });
  m.at([0.0, 0.03, 0.0], null, () => { m.use(F.steelDark); m.box(0.05, 0.012, 0.21, 0.0014); });
  m.mirror(() => {
    screwX(m, 0.0225, 0.01, 0.075, 1, 0.0022);
    screwX(m, 0.0225, 0.01, -0.055, 1, 0.0022);
  });
  // Arming lever on the left.
  m.part('lever', [-0.0235, 0.012, 0.01], () => {
    m.use(F.red);
    m.at([0, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.006, 0.0032, 14));
    m.at([-0.0018, 0, -0.012], null, () => m.box(0.0028, 0.0052, 0.024, 0.0009));
  });

  // Forward grip with its own bracket around the tube.
  m.at([0, AXIS, -0.3], null, () => {
    m.use(F.parkerized);
    m.lathe([[R + 0.0015, 0.016, 0], [R + 0.006, 0.016], [R + 0.006, -0.016], [R + 0.0015, -0.016, 0]], 36, { chamfer: 0.0014 });
  });
  m.use(F.parkerized);
  m.at([0, AXIS - R - 0.012, -0.3], null, () => m.box(0.03, 0.016, 0.036, 0.002, 0.004));
  m.use(F.polymerStipple);
  m.at([0, AXIS - R - 0.02, -0.3], null, () => {
    m.side(curveGrip(), 0.03, { bevel: 0.0036, smooth: 50 });
  });
  m.use(F.anodized);
  m.at([0, AXIS - R - 0.126, -0.292], null, () => m.box(0.033, 0.006, 0.046, 0.0014, 0.003));

  // Shoulder rest on the rear tube.
  m.use(F.rubber);
  m.at([0.0, AXIS - R - 0.008, 0.125], null, () => m.side(poly([[0.09, 0.006], [0.09, -0.008, 0.006], [0.075, -0.022, 0.008], [-0.075, -0.022, 0.008], [-0.09, -0.008, 0.006], [-0.09, 0.006]], 0.002), 0.05, { bevel: 0.003 }));
}

function curveGrip(): V2[] {
  const f = curve([[-0.018, 0], [-0.021, -0.03], [-0.022, -0.06], [-0.018, -0.1]], 4);
  const b = curve([[0.022, -0.1], [0.024, -0.06], [0.022, -0.03], [0.018, 0]], 4);
  return [...f, ...b];
}

function carry(m: Mesher): void {
  m.use(F.steelDark);
  const path: V3[] = [[0.03, AXIS + R + 0.002, -0.27], [0.036, AXIS + R + 0.03, -0.25], [0.036, AXIS + R + 0.034, -0.175], [0.036, AXIS + R + 0.03, -0.09], [0.03, AXIS + R + 0.002, -0.06]];
  m.at([0, 0, 0], null, () => m.tube(path, 0.0048, { seg: 10, samples: 28, tension: 0.4 }));
  m.use(F.rubber);
  m.tube([[0.036, AXIS + R + 0.034, -0.215], [0.036, AXIS + R + 0.034, -0.13]], 0.0074, { seg: 12, samples: 4 });
  m.use(F.parkerized);
  for (const z of [-0.27, -0.06]) m.at([0.028, AXIS + R + 0.0005, z], null, () => m.box(0.022, 0.006, 0.022, 0.0014, 0.003));
  m.at([0, AXIS + R + 0.002, 0.14], null, () => rail(m, 0.05, -0.05, 0.0212, F.anodized));
}

function breech(m: Mesher): void {
  // Hinged on the right, so opening it swings the whole upper half out of the way of the view.
  m.part('breech', [R + 0.004, AXIS + 0.004, 0], () => {
    m.at([-(R + 0.004), -0.004, 0], null, () => {
      m.use(F.olive);
      arcShell(m, R + 0.0035, BREECH_Z0, BREECH_Z1, -0.04, Math.PI * 1.02, 0.0065);
      // Stiffening ribs give the flat run of cover some light and shadow.
      m.use(F.oliveDark);
      for (const z of [-0.055, -0.13, -0.205]) m.at([0, 0, z], null, () => m.lathe([[R + 0.003, 0.0072, 0], [R + 0.0062, 0.0072], [R + 0.0062, -0.0072], [R + 0.003, -0.0072, 0]], 30, { a0: 0, a1: Math.PI, chamfer: 0.0012 }));
      for (let i = 0; i < 5; i++) {
        const a = 0.62 + i * 0.47;
        m.at([Math.cos(a) * (R + 0.0037), Math.sin(a) * (R + 0.0037), -0.018], [0, Math.PI / 2, a], () => rivet(m, 0.0018));
        m.at([Math.cos(a) * (R + 0.0037), Math.sin(a) * (R + 0.0037), -0.242], [0, Math.PI / 2, a], () => rivet(m, 0.0018));
      }
      // Latch handle on the shooter's side.
      m.use(F.steelDark);
      m.at([-(R + 0.012), 0.012, -0.13], null, () => m.box(0.012, 0.012, 0.05, 0.0018, 0.003));
      m.use(F.red);
      m.at([-(R + 0.019), 0.012, -0.13], null, () => m.box(0.003, 0.0074, 0.036, 0.0009));
    });
    m.use(F.steel);
    m.at([0, 0, -0.13], null, () => m.cyl(0.004, 0.24, 12));
  });
}

function rocket(m: Mesher): void {
  // Origin at the base of the motor. The nose stands proud of the muzzle.
  m.part('rocket', [0, AXIS, -0.03], () => {
    m.use(F.anodizedGrey);
    m.lathe([[0.03, 0.002, 0], [0.038, 0.0], [0.038, -0.018], [0.036, -0.022], [0.036, -0.2], [0.042, -0.206], [0.042, -0.232, 0]], 28);
    for (let i = 0; i < 4; i++) {
      m.at([0, 0, -0.02], [0, 0, (i / 4) * Math.PI * 2 + Math.PI / 4], () => {
        m.use(F.steelDark);
        m.at([0.038, 0, -0.03], null, () => m.box(0.012, 0.0024, 0.06, 0.0007));
      });
    }
    m.use(F.polymerGrey);
    m.lathe([[0.042, -0.232, 0], [0.042, -0.26], [0.0442, -0.264], [0.0442, -0.5], [0.0418, -0.52], [0.04, -0.62, 0]], 28);
    m.use({ ...F.olive, color: 0x565a3a });
    const nose: [number, number, number?][] = [[0.04, -0.62, 0]];
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      nose.push([0.04 * Math.sqrt(1 - t * t * 0.985), -0.62 - t * 0.14, 0]);
    }
    m.lathe(nose, 28, { chamfer: 0, smooth: 40 });
    m.use(F.yellow);
    m.lathe([[0.0442, -0.45, 0], [0.0447, -0.45], [0.0447, -0.466], [0.0442, -0.466, 0]], 28, { chamfer: 0 });
    m.use(F.steelDark);
    m.lathe([[0.0042, -0.76, 0], [0.0042, -0.783], [0.003, -0.785], [0, -0.785, 0]], 12);
  });
}

function buildRocket(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0016;
  tube(m);
  grips(m);
  optic(m);
  carry(m);
  breech(m);
  rocket(m);
  m.part('trigger', [0, -0.0125, -0.002], () => {
    m.use(F.steelDark);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0038, -0.0205, 0.0015], [0.0005, -0.0215, 0.001], [-0.0035, -0.0095, 0.003]], 0.001), 0.0065, { bevel: 0.0007 });
  });
  const model = new Model(m, kit.mats, {
    glows: { reticle: [0xff3a22, 5] },
    screens: { lock: [168, 76] },
  });
  model.socket('muzzle', [0, AXIS, -0.71]);
  model.socket('eject', [0, AXIS + 0.05, 0.2]);
  model.hand('gripR', [0.018, -0.052, 0.07], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.hand('gripL', [-0.018, AXIS - R - 0.075, -0.3], [0.02, -0.98, 0.2], [0.34, -0.18, -0.92]);
  model.hand('latch', [-0.078, AXIS + 0.024, -0.13], [-0.1, 0.3, -0.95], [0.9, -0.3, -0.25], 'breech');
  model.hand('rocketHold', [-0.03, -0.04, -0.3], [-0.1, 0.1, -0.98], [0.75, 0.55, -0.1], 'rocket');
  model.hand('leverHold', [-0.034, 0.014, 0.0], [-0.5, -0.2, -0.8], [0.8, -0.3, -0.5], 'lever');
  return model;
}

function readout(a: Anim): void {
  const s = a.model!.screens.lock;
  if (!s) return;
  const { g, canvas, texture } = s;
  const w = canvas.width;
  const h = canvas.height;
  const ready = a.mag > 0;
  g.fillStyle = '#100604';
  g.fillRect(0, 0, w, h);
  g.fillStyle = ready ? '#ff5a2a' : '#6a2a1c';
  g.font = '800 34px "Courier New", monospace';
  g.textBaseline = 'top';
  g.fillText(ready ? 'ARMED' : 'EMPTY', 8, 6);
  g.font = '700 16px "Courier New", monospace';
  g.fillText(`RES ${String(a.reserve).padStart(2, '0')}`, 8, 48);
  for (let i = 0; i < 5; i++) {
    g.globalAlpha = ready ? 1 - i * 0.16 : 0.2;
    g.fillRect(96 + i * 13, 50, 9, 16);
  }
  g.globalAlpha = 1;
  texture.needsUpdate = true;
}

function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a, 0.09);
  const p = a.reload;
  // A launcher with nothing in it should look empty the moment the rocket leaves.
  const loaded = a.mag > 0;
  P.rocket!.visible = loaded;
  a.glow('reticle', loaded ? 0.95 + 0.05 * Math.sin(a.time * 11) : 0.25);

  // Blast rocks the whole tube on the shoulder a moment after the shot.
  const rock = a.sinceFire < 0.5 ? bump(a.sinceFire, 0.02, 0.5) : 0;
  a.gunR.z -= rock * 0.05;
  a.gunP.y -= rock * 0.01;

  if (a.draw < 1) {
    // Heaved up: it swings in from the shoulder, not out of a pocket.
    a.gunP.x += (1 - outCubic(a.draw)) * 0.06;
    a.gunR.y -= (1 - outCubic(a.draw)) * 0.3;
    P.lever!.rotation.x -= bump(a.draw, 0.5, 1) * 0.8;
  }
  if (p < 0) return;

  const open = inOut(seg(p, 0.05, 0.17)) * (1 - inQuad(seg(p, 0.72, 0.79)));
  const slam = p >= 0.79 ? thud(seg(p, 0.79, 0.9)) : 0;
  P.breech!.rotation.z -= (open + slam * 0.03) * BREECH_OPEN;

  // New rocket up from the waist, laid in the cradle, then shoved forward until the nose clears the muzzle.
  const rise = inOut(seg(p, 0.22, 0.5));
  const shove = inOut(seg(p, 0.52, 0.68));
  P.rocket!.visible = p > 0.22;
  const rk = P.rocket!;
  rk.position.y += (1 - rise) * -0.42 + (1 - shove) * 0.065;
  rk.position.x += (1 - rise) * -0.2;
  rk.position.z += (1 - shove) * 0.33 + (1 - rise) * 0.05;
  rk.rotation.x += (1 - rise) * 0.7;
  rk.rotation.z += (1 - rise) * 0.8;

  // The tube dips and rolls toward the left hand, and settles on the slam.
  const present = hold(p, 0, 0.14, 0.8, 0.96);
  a.gunR.z += present * 0.3;
  a.gunR.x += present * 0.06 + slam * 0.02;
  a.gunP.x -= present * 0.065;
  a.gunP.y -= present * 0.045 - slam * 0.012;
  a.gunP.z += present * 0.08;

  const lever = bump(p, 0.84, 0.97);
  P.lever!.rotation.x -= lever * 1.0;

  const h = a.left;
  h.fingerRate = 36;
  h.to('latch', inOut(seg(p, 0.0, 0.07)));
  h.to('rocketHold', inOut(seg(p, 0.19, 0.27)));
  h.to('latch', inOut(seg(p, 0.69, 0.74)));
  h.to('leverHold', inOut(seg(p, 0.8, 0.85)));
  h.to('gripL', inOut(seg(p, 0.92, 1)));
  h.shape(HANDS.cup, hold(p, 0.2, 0.27, 0.66, 0.7));
  h.shape(HANDS.foregrip, hold(p, 0.02, 0.07, 0.14, 0.2));
  h.shape(HANDS.foregrip, hold(p, 0.7, 0.74, 0.92, 0.97));
}

export function rocketDef(kit: Kit): ViewDef {
  return {
    id: 'rocket',
    model: buildRocket(kit),
    pos: [0.205, -0.205, -0.32],
    rot: [0.012, 0.065, 0],
    recoil: { back: 0.085, lift: 0.018, pitch: 0.075, yaw: 0.012, roll: 0.03, omega: 22, zeta: 0.56 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.foregrip },
    heatPerShot: 0.4,
    animate: clip,
    readout,
  };
}

