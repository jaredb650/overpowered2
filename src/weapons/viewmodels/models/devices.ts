/** Off-hand items: the frag grenade, the walkie-talkie and the laser designator. Origin sits in the palm. */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { V3 } from '../kit/mesher';
import { poly, rect } from '../kit/shapes';
import { knurl, screwX } from '../kit/details';

const BODY_R = 0.0305;
const BODY_H = 0.037;

export function buildGrenade(kit: Kit): Model {
  const m = kit.mesher();
  // Cast iron pineapple: an egg cut by a grid of grooves, so it reads as a grenade from any angle and in any light.
  m.use({ color: 0x4a5a3c, rough: 0.58, metal: 0.15, wear: 1 });
  m.surface(56, 34, (u, v, o) => {
    const a = u * Math.PI * 2;
    const t = (v - 0.5) * Math.PI;
    const gu = Math.abs(Math.sin(a * 4)) ** 0.5;
    const gv = Math.abs(Math.sin(t * 3.5 + 0.4)) ** 0.5;
    const cut = 1 - 0.09 * (1 - Math.min(gu, gv));
    const r = Math.cos(t) * BODY_R * cut;
    o.set(Math.cos(a) * r, -Math.sin(t) * BODY_H * cut, Math.sin(a) * r);
  }, { wrapU: true, flip: false, edge: (u, v) => (Math.abs(Math.sin(u * Math.PI * 8)) > 0.5 && Math.abs(Math.sin((v - 0.5) * Math.PI * 3.5 + 0.4)) > 0.5 ? 0.5 : 0) });
  // Fuze well, and the body of the fuze standing proud of it.
  m.at([0, 0, 0], [Math.PI / 2, 0, 0], () => {
    m.use(F.steelDark);
    m.lathe([[0.0, -0.05, 0], [0.0088, -0.05], [0.0102, -0.0475], [0.0102, -0.039], [0.0125, -0.0375], [0.0125, -0.033, 0]], 16);
    m.use(F.yellow);
    m.lathe([[0.0126, -0.0345, 0], [0.0132, -0.0345], [0.0132, -0.0365], [0.0126, -0.0365, 0]], 16, { chamfer: 0 });
  });
  m.part('spoon', [0, 0.046, 0], () => {
    // A strap that follows the body down its back, the way the real lever hugs the casing.
    m.use(F.steel);
    const out: [number, number][] = [[-0.0085, 0.0015], [-0.0085, 0.0052], [0.006, 0.0052]];
    const inner: [number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const a = 0.28 + (i / 12) * 1.32;
      const z = Math.sin(a);
      const y = Math.cos(a);
      out.push([z * 0.0352, y * 0.0422 - 0.046]);
      inner.unshift([z * 0.0332, y * 0.0402 - 0.046]);
    }
    m.side([...out, ...inner], 0.0115, { bevel: 0.0005, smooth: 30 });
    m.use(F.steelDark);
    m.at([0, 0.0032, -0.0055], [0, Math.PI / 2, 0], () => m.cyl(0.0022, 0.0135, 8));
  });
  m.part('pin', [-0.0105, 0.0435, 0], () => {
    m.use(F.steel);
    m.at([0, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.0012, 0.02, 6));
    const ring: V3[] = [];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      ring.push([-0.022 + Math.cos(a) * 0.0115, Math.sin(a) * 0.0115, 0]);
    }
    m.tube(ring, 0.0011, { seg: 6, closed: true, samples: 28 });
  });
  const model = new Model(m, kit.mats);
  model.hand('hold', [0.018, -0.012, 0.008], [0.1, -0.96, 0.25], [-0.55, -0.1, -0.85]);
  return model;
}

export function buildWalkie(kit: Kit): Model {
  const m = kit.mesher();
  // Stands upright: face toward +Z, antenna up.
  m.use(F.polymer);
  m.front(poly([[-0.031, -0.075], [0.031, -0.075], [0.033, 0.06, 0.006], [0.024, 0.07, 0.004], [-0.024, 0.07, 0.004], [-0.033, 0.06, 0.006]], 0.004), 0.036, { bevel: 0.0026 });
  m.use(F.rubber);
  m.at([0, -0.003, 0], null, () => {
    m.mirror(() => m.at([0.0342, 0, 0], null, () => m.box(0.003, 0.11, 0.028, 0.0012, 0.003)));
  });
  m.use(F.polymerGrey);
  m.at([0, 0.0145, 0.0185], null, () => m.front(rect(-0.0265, -0.031, 0.0265, 0.031, 0.003), 0.0032, { bevel: 0.0011, holes: [rect(-0.0215, -0.0035, 0.0215, 0.025, 0.0014)] }));
  m.at([0, 0.0255, 0.0192], null, () => m.screen('lcd', 0.042, 0.027));
  // Speaker grille and keypad.
  m.use(F.black);
  for (let i = 0; i < 6; i++) m.at([0, -0.009 - i * 0.0031, 0.0202], null, () => m.box(0.038, 0.0012, 0.001, 0.0002));
  m.use(F.polymerGrey);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m.at([-0.0125 + c * 0.0125, -0.0335 - r * 0.0105, 0.0192], null, () => m.box(0.0095, 0.0075, 0.0028, 0.0009));
  // Battery latch and belt clip.
  m.use(F.steelDark);
  m.at([0, -0.015, -0.0202], null, () => m.box(0.022, 0.09, 0.0022, 0.0008));
  m.at([0, 0.03, -0.022], null, () => m.box(0.024, 0.008, 0.005, 0.0012));
  // Antenna: stiff rubber, kinked base, a little whip.
  m.use(F.steelDark);
  m.at([0.019, 0.0725, 0], [Math.PI / 2, 0, 0], () => m.cyl(0.0058, 0.011, 12));
  m.use(F.rubber);
  m.at([0.019, 0.086, 0], [Math.PI / 2, 0, 0], () => knurl(m, 0.0052, 0.018, F.rubber, 10, 0.0004));
  m.tube([[0.019, 0.094, 0], [0.019, 0.13, 0.001], [0.0192, 0.165, 0.003], [0.0195, 0.195, 0.007]], t => 0.0036 - t * 0.0016, { seg: 8 });
  m.at([0.0195, 0.196, 0.0072], null, () => { m.use(F.polymerGrey); m.cyl(0.0024, 0.004, 8); });
  // Channel knob and status lamp.
  m.use(F.steelDark);
  m.at([-0.018, 0.076, 0], [Math.PI / 2, 0, 0], () => knurl(m, 0.0075, 0.012, F.steelDark, 18, 0.0005));
  m.part('ptt', [-0.034, 0.012, 0.0], () => {
    m.use(F.rubber);
    m.box(0.004, 0.03, 0.018, 0.0012, 0.003);
  });
  m.glow('lamp', () => m.at([0.002, 0.0732, 0], [Math.PI / 2, 0, 0], () => m.cyl(0.0024, 0.0028, 10)));
  const model = new Model(m, kit.mats, { glows: { lamp: [0xff3324, 6] }, screens: { lcd: [168, 108] } });
  model.hand('hold', [0.033, -0.012, -0.01], [0.15, -0.95, 0.3], [-0.45, 0.0, -0.9]);
  return model;
}

export function buildDesignator(kit: Kit): Model {
  const m = kit.mesher();
  // A chunky pistol-grip laser marker: dual lenses forward (-Z), viewer at the back, grip below.
  m.use(F.anodized);
  m.side(poly([[0.075, -0.012], [0.075, 0.036, 0.008], [0.062, 0.05, 0.006], [-0.078, 0.05, 0.006], [-0.09, 0.034, 0.006], [-0.09, -0.012, 0.005]], 0.003), 0.056, { bevel: 0.0024 });
  m.use(F.anodizedGrey);
  m.mirror(() => {
    m.at([0.0295, 0.016, -0.006], null, () => m.side(poly([[0.055, -0.006], [0.055, 0.024], [-0.062, 0.024], [-0.072, 0.012], [-0.072, -0.006]], 0.003), 0.003, { bevel: 0.0009, holes: [rect(-0.05, 0.002, -0.02, 0.016, 0.0016), rect(-0.01, 0.002, 0.02, 0.016, 0.0016)] }));
    screwX(m, 0.0312, 0.034, 0.05, 1);
    screwX(m, 0.0312, 0.034, -0.06, 1);
    screwX(m, 0.0312, -0.0, 0.05, 1);
  });
  // Objective lenses with deep rubber hoods.
  m.at([0.0, 0.036, -0.09], null, () => {
    m.use(F.rubber);
    m.lathe([[0.0205, 0.012, 0], [0.0225, 0.01], [0.0225, -0.03], [0.0195, -0.032], [0.0178, -0.03], [0.0178, -0.004, 0]], 24);
    m.use(F.black);
    m.at([0, 0, -0.004], null, () => m.cyl(0.0178, 0.001, 18));
    m.glass(() => m.at([0, 0, -0.0048], null, () => m.cyl(0.0176, 0.0006, 18, 0)));
  });
  m.at([0.0, 0.005, -0.082], null, () => {
    m.use(F.steelDark);
    m.lathe([[0.0115, 0.006, 0], [0.0125, 0.004], [0.0125, -0.018], [0.0095, -0.02], [0.0088, -0.016, 0]], 18);
    m.glow('laser', () => m.at([0, 0, -0.012], null, () => m.cyl(0.0086, 0.0012, 14, 0)));
  });
  // Viewer screen on the back, angled to the eye.
  m.at([0, 0.02, 0.0772], null, () => {
    m.use(F.polymer);
    m.front(rect(-0.024, -0.024, 0.024, 0.026, 0.004), 0.006, { bevel: 0.0016 });
    m.at([0, 0.001, 0.0034], null, () => m.screen('view', 0.04, 0.04));
  });
  // Top rail, switches and the pistol grip.
  m.use(F.steelDark);
  m.at([0.0, 0.0515, -0.01], null, () => m.box(0.03, 0.003, 0.11, 0.0009));
  m.use(F.polymerStipple);
  m.side(poly([[0.038, -0.01], [-0.004, -0.01], [-0.002, -0.022], [0.006, -0.1, 0.006], [0.044, -0.104, 0.006], [0.046, -0.04]], 0.005), 0.032, { bevel: 0.0026 });
  m.part('trigger', [0, -0.02, -0.012], () => {
    m.use(F.steelDark);
    m.side(poly([[-0.003, 0.002], [0.003, 0.002], [0.002, -0.016, 0.002], [-0.003, -0.018]], 0.001), 0.009, { bevel: 0.0007 });
  });
  m.at([0.0, -0.004, -0.012], null, () => { m.use(F.polymer); m.side(poly([[-0.02, -0.008], [-0.024, -0.03, 0.005], [-0.012, -0.036, 0.004], [0.004, -0.036], [0.002, -0.032], [-0.011, -0.032, 0.002], [-0.019, -0.027, 0.002], [-0.016, -0.008]], 0.001), 0.009, { bevel: 0.0008 }); });
  const model = new Model(m, kit.mats, { glows: { laser: [0xff2415, 14] }, screens: { view: [128, 128] } });
  model.hand('hold', [-0.018, -0.05, 0.026], [0.02, -0.96, 0.25], [0.32, -0.2, -0.92]);
  return model;
}

/** Stim autoinjector, standing on its end: safety cap up (+Y), needle down. A green window shows the dose until it goes in. */
export function buildStim(kit: Kit): Model {
  const m = kit.mesher();
  const up = (y: number, fn: () => void) => m.at([0, y, 0], [Math.PI / 2, 0, 0], fn);
  // The fist covers the top half, so the dose window sits below it where the eye can see it drain.
  m.use(F.oliveDark);
  up(-0.005, () => m.cyl(0.0115, 0.13, 18));
  m.use(F.yellow);
  up(0.05, () => m.cyl(0.0118, 0.012, 18, 0.0004));
  m.glow('dose', () => up(-0.045, () => m.cyl(0.0119, 0.026, 18, 0.0004)));
  m.use(F.polymerGrey);
  up(-0.074, () => m.cyl(0.0095, 0.014, 16));
  m.part('cap', [0, 0.068, 0], () => {
    m.use(F.enamelRed);
    m.at([0, 0, 0], [Math.PI / 2, 0, 0], () => m.cyl(0.0108, 0.016, 16));
  });
  m.part('needle', [0, -0.081, 0], () => {
    m.use(F.chrome);
    m.at([0, -0.009, 0], [Math.PI / 2, 0, 0], () => m.cyl(0.0008, 0.018, 6, 0));
  });
  const model = new Model(m, kit.mats, { glows: { dose: [0x33ff66, 3] } });
  model.hand('hold', [-0.012, 0.022, 0], [0.02, -0.98, 0.2], [0.34, -0.18, -0.92]);
  return model;
}
