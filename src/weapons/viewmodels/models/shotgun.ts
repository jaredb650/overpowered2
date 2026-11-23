/**
 * The Breacher: a pump twelve-gauge. Parkerized receiver, oiled walnut, a corn-cob forend on a real slide, a slatted
 * heat shield you can see the barrel through, and a toothed breaching choke. The side saddle carries spare shells.
 * Its mod (src/weapons/mods.ts) is a long choke tube in the breaching choke's place, for a tighter group.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Mesher } from '../kit/mesher';
import { curve, poly, rect, slot, type V2 } from '../kit/shapes';
import { knurl, rail, rivet, screwX } from '../kit/details';
import { bump, hold, inOut, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { GREASE } from '../../mods';
import { HANDS } from '../poses';
import { drawCount, pullTrigger, shell12 } from './common';
import { TORCH, weaponLight } from './light';

const BORE = 0.03;
const TUBE = 0.0;
const PUMP_TRAVEL = 0.088;

function receiver(m: Mesher): void {
  m.use(F.parkerized);
  m.side(poly([[0.062, -0.018], [0.07, 0.02, 0.01], [0.056, 0.052, 0.008], [-0.168, 0.052, 0.003], [-0.172, 0.03], [-0.172, -0.02, 0.003]], 0.002), 0.036, { bevel: 0.0018 });

  // Milled flank: a raised plate with a long lightening window, so the big flat side has a shadow line.
  const plate = poly([[0.052, -0.012], [0.058, 0.02, 0.008], [0.046, 0.046, 0.006], [-0.16, 0.046, 0.002], [-0.164, -0.012, 0.002]], 0.0015);
  m.use(F.steelDark);
  m.at([-0.0185, 0, 0], null, () => m.side(plate, 0.002, { bevel: 0.0006, holes: [poly([[-0.03, 0.03], [-0.15, 0.03], [-0.152, 0.04], [-0.034, 0.04]], 0.002)] }));
  m.at([0.0185, 0, 0], null, () => {
    // Ejection port on the right, cut through the plate.
    m.side(plate, 0.002, { bevel: 0.0006, holes: [rect(-0.11, 0.012, -0.02, 0.043, 0.003)] });
  });
  m.use(F.black);
  m.at([0.0165, 0.0275, -0.065], null, () => m.box(0.0018, 0.03, 0.09, 0));
  m.mirror(() => {
    screwX(m, 0.0196, 0.0, 0.03, 1, 0.0024);
    screwX(m, 0.0196, 0.0, -0.13, 1, 0.0024);
  });
  m.use(F.parkerized);
  m.at([0, 0.0535, -0.05], null, () => rail(m, 0.04, -0.15, 0.0212, F.anodized));
  // Ghost ring on two ears at the back of the rail.
  m.at([0, 0.0615, 0.04], null, () => {
    m.use(F.anodized);
    m.at([0, 0.0015, 0], null, () => m.box(0.028, 0.006, 0.03, 0.0012, 0.002));
    m.use(F.steelDark);
    m.mirror(() => m.at([0.0115, 0.009, 0], null, () => m.side(poly([[-0.01, -0.005], [0.01, -0.005], [0.004, 0.014, 0.002], [-0.004, 0.014, 0.002]], 0.001), 0.0035, { bevel: 0.0007 })));
    m.at([0, 0.018, 0], null, () => m.lathe([[0.0035, 0.002, 0], [0.0062, 0.002], [0.0062, -0.002], [0.0035, -0.002, 0], [0.0035, 0.002, 0]], 16, { chamfer: 0.0006 }));
    m.glow('sight', () => {
      for (const a of [Math.PI * 0.5, Math.PI * 1.15, Math.PI * 1.85]) m.at([Math.cos(a) * 0.0049, 0.018 + Math.sin(a) * 0.0049, 0.0021], null, () => m.cyl(0.0007, 0.0004, 6, 0));
    });
  });
  // Trigger guard.
  m.use(F.steelDark);
  const out = poly([[-0.03, -0.018], [-0.034, -0.03, 0.006], [-0.022, -0.046, 0.008], [0.028, -0.046, 0.008], [0.042, -0.02, 0.004], [0.042, -0.018]], 0.002);
  const inner = poly([[-0.026, -0.02], [-0.028, -0.029, 0.005], [-0.019, -0.0415, 0.005], [0.024, -0.0415, 0.005], [0.036, -0.021, 0.003], [0.036, -0.02]], 0.002);
  m.side(out, 0.0125, { bevel: 0.0012, holes: [inner] });
  // Slide release and safety.
  m.at([0.0, 0.052, 0.055], [0, Math.PI / 2, 0], () => { m.use(F.steelDark); m.cyl(0.0042, 0.012, 12); });
  m.at([-0.019, -0.009, -0.016], [0, Math.PI / 2, 0], () => { m.use(F.steelDark); knurl(m, 0.0052, 0.004, F.steelDark, 12, 0.0004); });
  m.at([-0.0197, 0.018, -0.1], [0, -Math.PI / 2, 0], () => m.decal('cal12', 0.05, 0.0075, 0xb9bec4));
  m.at([-0.0197, 0.003, 0.012], [0, -Math.PI / 2, 0], () => m.decal('op2', 0.022, 0.0055, 0xb9bec4));
  m.at([-0.0197, -0.0065, -0.1], [0, -Math.PI / 2, 0], () => m.decal('crucible', 0.058, 0.0062, 0x9aa0a6));
  // Shell-count strip on the flank, in the plate's window.
  m.at([-0.0196, 0.035, -0.09], [0, -Math.PI / 2, 0], () => {
    m.use(F.black);
    m.prism(rect(-0.05, -0.0048, 0.05, 0.0048, 0.001), 0.0008, { bevel: 0 });
    m.at([0, 0, 0.0006], null, () => m.screen('ammo', 0.094, 0.0082));
  });
}

export function stock(m: Mesher): void {
  const front = curve([[0.022, -0.017], [0.024, -0.052], [0.036, -0.088], [0.05, -0.12]], 5);
  const under = curve([[0.098, -0.12], [0.098, -0.09], [0.116, -0.062], [0.17, -0.056], [0.28, -0.08], [0.35, -0.112]], 6);
  const comb = curve([[0.35, 0.04], [0.26, 0.034], [0.15, 0.036], [0.092, 0.034], [0.072, 0.012]], 5);
  const outline: V2[] = [...front, [0.056, -0.126], [0.094, -0.126], ...under, ...comb];
  m.use(F.walnut);
  m.side(outline, 0.036, { bevel: 0.0055, smooth: 42 });
  // Hand-cut checkering where the palm sits.
  m.use({ ...F.walnutDark, kind: 2 });
  m.mirror(() => m.at([0.0165, 0, 0], null, () => m.side(poly([[0.04, -0.03], [0.086, -0.026], [0.09, -0.11], [0.058, -0.112]], 0.004), 0.004, { bevel: 0.0012 })));
  m.use(F.rubber);
  m.at([0, -0.036, 0.3555], [0, 0, 0], () => m.side(poly([[-0.0055, 0.081], [0.0075, 0.081, 0.004], [0.0075, -0.08, 0.004], [-0.0055, -0.08]], 0.002), 0.038, { bevel: 0.0026 }));
  m.use(F.steelDark);
  m.at([0, -0.127, 0.074], null, () => m.box(0.03, 0.0035, 0.04, 0.001, 0.002));
  // Sling stud.
  m.at([0, -0.076, 0.24], null, () => m.lathe([[0.0045, 0.0015, 0], [0.0045, -0.0015], [0, -0.0015, 0]], 10));
}

function barrel(m: Mesher): void {
  m.at([0, BORE, 0], null, () => {
    m.use(F.barrel);
    m.lathe([[0.0145, -0.17, 0], [0.0145, -0.205], [0.0118, -0.215], [0.0115, -0.635, 0]], 22);
    // Breaching choke: a fat ported sleeve that ends in four teeth.
    m.part('breacher', [0, 0, 0], () => {
      m.use(F.parkerized);
      m.lathe([[0.0115, -0.625, 0], [0.0145, -0.628], [0.0145, -0.668], [0.0138, -0.671], [0.0098, -0.671, 0]], 22);
      m.use(F.black);
      m.lathe([[0.0098, -0.671, 0], [0.009, -0.7, 0], [0, -0.7005, 0]], 16);
      m.use(F.parkerized);
      for (let i = 0; i < 4; i++) {
        m.at([0, 0, -0.681], [0, 0, (i / 4) * Math.PI * 2 + Math.PI / 4], () => {
          const p: V2[] = [];
          for (let k = 0; k <= 5; k++) { const t = -0.46 + (k / 5) * 0.92; p.push([Math.cos(t) * 0.0143, Math.sin(t) * 0.0143]); }
          for (let k = 5; k >= 0; k--) { const t = -0.46 + (k / 5) * 0.92; p.push([Math.cos(t) * 0.0104, Math.sin(t) * 0.0104]); }
          m.prism(p, 0.022, { bevel: 0.0008, smooth: 30 });
        });
      }
      m.use(F.black);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        m.at([Math.cos(a) * 0.0138, Math.sin(a) * 0.0138, -0.648], [0, 0, a], () => m.box(0.002, 0.0038, 0.022, 0.0003));
      }
    });
    // Heat shield: real slats, so the blued barrel shows through.
    m.use(F.parkerized);
    const a0 = -0.42;
    const a1 = Math.PI + 0.42;
    for (let i = 0; i < 12; i++) {
      const z = -0.222 - i * 0.0275;
      m.at([0, 0, z], null, () => m.lathe([[0.0162, 0.0065, 0], [0.0182, 0.0065], [0.0182, -0.0065], [0.0162, -0.0065, 0]], 14, { a0, a1, chamfer: 0.0005 }));
    }
    for (const a of [a0, Math.PI / 2, a1]) {
      m.at([Math.cos(a) * 0.0182, Math.sin(a) * 0.0182, -0.372], [0, 0, a], () => m.box(0.0022, 0.0058, 0.325, 0.0006));
    }
    m.at([0, 0.0192, -0.664], null, () => {
      m.use(F.steelDark);
      m.side(poly([[0.014, 0], [-0.008, 0], [-0.011, 0.0085, 0.002], [0.002, 0.0085, 0.002]], 0.001), 0.0036, { bevel: 0.0006 });
      m.glow('sight', () => m.at([0, 0.0088, -0.0045], null, () => m.cyl(0.0014, 0.007, 8, 0)));
    });
  });
}

/**
 * The choke mod: a long extended tube screwed in where the breaching choke was, in bright steel. A knurled collar to turn
 * it by, a brass ring that marks the constriction, ported over the top so the muzzle stays down, and a bore you can see
 * narrow at the crown. Placed at root on the bore axis so it never collides with `barrelFull`'s hide toggle.
 */
function choke(m: Mesher): void {
  m.at([0, BORE, 0], null, () => m.part('choke', [0, 0, 0], () => {
    m.use(F.steel);
    m.lathe([[0.0112, -0.622, 0], [0.0136, -0.624], [0.0138, -0.662], [0.0148, -0.664], [0.0148, -0.69], [0.0134, -0.694], [0.0134, -0.744], [0.0124, -0.752], [0.0092, -0.752, 0]], 26, { chamfer: 0.0006 });
    m.at([0, 0, -0.677], null, () => knurl(m, 0.0151, 0.022, F.steelDark, 26, 0.0007));
    m.use(F.brass);
    m.at([0, 0, -0.7], null, () => m.lathe([[0.0136, 0.0018, 0], [0.0137, 0], [0.0136, -0.0018, 0]], 26));
    // Bore: wide at the crown, then the step down where the choke squeezes the shot.
    m.use(F.black);
    m.lathe([[0.0092, -0.752, 0], [0.0088, -0.735], [0.0074, -0.722], [0.0072, -0.7], [0, -0.6995, 0]], 18);
    // Ports: three slots a side, angled up off the top.
    for (const a of [Math.PI / 2 - 0.5, Math.PI / 2 + 0.5]) {
      for (let i = 0; i < 3; i++) m.at([Math.cos(a) * 0.0131, Math.sin(a) * 0.0131, -0.712 - i * 0.012], [0, 0, a], () => m.box(0.0018, 0.0034, 0.0075, 0.0003));
    }
  }));
}

/**
 * Sawed-off 4-shell barrel (`shotgunSawedOff`): bare heavy blued barrel cut back right ahead of the walnut pump to a raw
 * bright-steel crown, compact 4-shell tube with knurled cap, close-coupled figure-8 clamp, and low ramped front bead.
 */
function sawedOff(m: Mesher): void {
  m.part('sawedOff', [0, 0, 0], () => {
    m.at([0, BORE, 0], null, () => {
      m.use(F.barrel);
      m.lathe([[0.0145, -0.17, 0], [0.0145, -0.205], [0.0126, -0.215], [0.0122, -0.45, 0]], 22);
      // Freshly sawn bright-steel crown ring and deep dark 12-gauge bore.
      m.use(F.steel);
      m.lathe([[0.0122, -0.45, 0], [0.0122, -0.456, 0.0005], [0.0096, -0.456, 0.0004], [0.0096, -0.45, 0]], 22);
      m.use(F.black);
      m.lathe([[0.0096, -0.456, 0], [0.0094, -0.486, 0], [0, -0.4865, 0]], 16);
      // Low steel front ramp and glowing sight bead just behind the sawn muzzle.
      m.at([0, 0.012, -0.44], null, () => {
        m.use(F.steelDark);
        m.side(poly([[0.014, 0], [-0.007, 0], [-0.009, 0.012, 0.002], [0.002, 0.012, 0.002]], 0.001), 0.004, { bevel: 0.0006 });
        m.glow('sight', () => m.at([0, 0.012, -0.004], null, () => m.cyl(0.0015, 0.006, 8, 0)));
      });
    });
    // Compact 4-shell magazine tube, ending flush under the cut barrel with a knurled cap.
    m.at([0, TUBE, 0], null, () => {
      m.use(F.blued);
      m.lathe([[0.0138, -0.17, 0], [0.0138, -0.436, 0]], 20);
      m.use(F.steelDark);
      m.at([0, 0, -0.444], null, () => knurl(m, 0.0162, 0.014, F.steelDark, 24, 0.0006));
      m.lathe([[0.0138, -0.436, 0], [0.0165, -0.437], [0.0165, -0.452, 0], [0.0142, -0.456], [0, -0.456, 0]], 20);
    });
    // Close-coupled barrel clamp right ahead of the pump's forward edge (-0.415).
    m.use(F.parkerized);
    m.at([0, 0, -0.428], null, () => {
      m.front(poly([[-0.0178, -0.0145], [0.0178, -0.0145], [0.0178, 0.012, 0.003], [0.0155, 0.0445, 0.008], [-0.0155, 0.0445, 0.008], [-0.0178, 0.012, 0.003]], 0.003), 0.018, { bevel: 0.0014 });
      m.mirror(() => screwX(m, 0.0182, 0.015, 0, 1, 0.0026));
    });
  });
}

function tube(m: Mesher): void {
  m.at([0, TUBE, 0], null, () => {
    m.use(F.blued);
    m.lathe([[0.0138, -0.17, 0], [0.0138, -0.578, 0]], 20);
    m.use(F.steelDark);
    m.at([0, 0, -0.588], null, () => knurl(m, 0.0165, 0.018, F.steelDark, 24, 0.0006));
    m.lathe([[0.0138, -0.578, 0], [0.0168, -0.579], [0.0168, -0.598, 0], [0.0145, -0.602], [0, -0.602, 0]], 20);
    m.lathe([[0.0138, -0.572, 0], [0.0152, -0.572], [0.0152, -0.579, 0]], 20);
  });
  // Barrel clamp, the piece that ties the tube to the barrel.
  m.use(F.parkerized);
  m.at([0, 0, -0.522], null, () => {
    m.front(poly([[-0.0178, -0.0145], [0.0178, -0.0145], [0.0178, 0.012, 0.003], [0.016, 0.0465, 0.008], [-0.016, 0.0465, 0.008], [-0.0178, 0.012, 0.003]], 0.003), 0.02, { bevel: 0.0014 });
    m.mirror(() => screwX(m, 0.0182, 0.015, 0, 1, 0.0026));
  });
  m.at([0.0195, 0.008, -0.522], null, () => {
    m.use(F.steelDark);
    m.lathe([[0.0, 0.0065, 0], [0.003, 0.0065], [0.003, -0.0065], [0, -0.0065, 0]], 8);
  });
}

function saddle(m: Mesher): void {
  // Four spare shells, heads up, where the shooter can see what is left.
  m.at([-0.0235, 0.012, -0.068], null, () => {
    m.use(F.anodized);
    m.at([0.0014, 0, 0], null, () => m.side(rect(-0.058, -0.018, 0.058, 0.02, 0.003), 0.0026, { bevel: 0.0008, holes: [slot(-0.044, 0, 0.044, 0, 0.0045, 3)] }));
    m.use(F.rubber);
    m.at([-0.0045, 0.002, 0], null, () => m.side(rect(-0.056, -0.0095, 0.056, 0.0095, 0.002), 0.004, { bevel: 0.0012 }));
    for (let i = 0; i < 4; i++) {
      m.at([-0.0086, 0.038, -0.043 + i * 0.0288], [-Math.PI / 2, 0, 0], () => shell12(m, F.red));
    }
    for (const z of [-0.051, 0.051]) m.at([-0.0002, 0.012, z], [0, -Math.PI / 2, 0], () => rivet(m, 0.002));
  });
}

function pump(m: Mesher): void {
  m.part('pump', [0, TUBE, -0.325], () => {
    const prof: [number, number, number?][] = [[0.0142, 0.082, 0], [0.0195, 0.082], [0.0232, 0.074]];
    // Cut grooves in a wooden sleeve: the silhouette you feel in the off hand.
    for (let i = 0; i < 8; i++) {
      const z = 0.062 - i * 0.0172;
      prof.push([0.0236, z + 0.0058], [0.0212, z + 0.0035, 0.0005], [0.0212, z - 0.0035, 0.0005], [0.0236, z - 0.0058]);
    }
    prof.push([0.0232, -0.082], [0.0195, -0.09], [0.0142, -0.09, 0]);
    m.use(F.walnut);
    m.lathe(prof, 28, { chamfer: 0.0009, smooth: 26 });
    m.use(F.steel);
    m.mirror(() => m.at([0.0152, 0.0, 0.135], null, () => m.box(0.002, 0.0075, 0.11, 0.0006)));
    m.use(F.steelDark);
    m.at([0, 0, 0.085], null, () => m.lathe([[0.0142, 0.004, 0], [0.0172, 0.004], [0.0172, -0.004], [0.0142, -0.004, 0]], 18));
    // Greased bolt mod: polished chrome twin action bars and brass slick collar riding with the forend.
    m.part('greaseBars', [0, 0, 0], () => {
      m.use(F.chrome);
      m.mirror(() => m.at([0.0157, 0.0, 0.135], null, () => m.box(0.0024, 0.0082, 0.112, 0.0006)));
      m.use(F.brass);
      m.at([0, 0, 0.085], null, () => m.lathe([[0.0146, 0.0044, 0], [0.0178, 0.0044], [0.0178, -0.0044], [0.0146, -0.0044, 0]], 18));
    });
  });
}

function buildShotgun(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0014;
  receiver(m);
  stock(m);
  m.part('barrelFull', [0, 0, 0], () => {
    barrel(m);
    tube(m);
  });
  choke(m);
  sawedOff(m);
  saddle(m);
  pump(m);

  m.part('bolt', [0.0, BORE - 0.002, -0.068], () => {
    m.use(F.steel);
    m.box(0.027, 0.024, 0.074, 0.0014);
    m.use(F.steelDark);
    for (let i = 0; i < 7; i++) m.at([0.0138, 0, -0.022 + i * 0.0072], null, () => m.box(0.0012, 0.018, 0.0034, 0.0003));
    // Greased bolt mod: mirror-polished chrome slick carrier face with gold-brass oil grooves & extractor.
    m.part('greaseBolt', [0, 0, 0], () => {
      m.use(F.chrome);
      m.at([0.0006, 0, 0], null, () => m.box(0.0276, 0.0246, 0.075, 0.0014));
      m.use(F.brass);
      for (let i = 0; i < 5; i++) m.at([0.0146, 0, -0.02 + i * 0.01], [0.35, 0, 0], () => m.box(0.0012, 0.018, 0.0032, 0.0003));
    });
  });
  m.part('trigger', [0, -0.018, -0.002], () => {
    m.use(F.steelDark);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0038, -0.0205, 0.0015], [0.0005, -0.0215, 0.001], [-0.0035, -0.0095, 0.003]], 0.001), 0.0065, { bevel: 0.0007 });
  });
  // The shell in the hand during a reload. Its part origin is the head of the shell.
  m.part('shell', [0, -0.03, -0.1], () => shell12(m, F.red));

  // The shop's weapon light (weapons/mods.ts LIGHT_GUNS), hidden until fitted. A barrel clamp on the left, ahead of the pump's travel.
  weaponLight(m, [-0.0315, 0.022, -0.5], -Math.PI / 2);

  const model = new Model(m, kit.mats, {
    glows: { sight: [0x9cff3a, 6], torch: TORCH },
    screens: { ammo: [240, 22] },
  });
  model.socket('muzzle', [0, BORE, -0.702]);
  model.socket('muzzleChoke', [0, BORE, -0.756]);
  model.socket('muzzleSawed', [0, BORE, -0.46]);
  model.socket('eject', [0.022, 0.03, -0.065]);
  model.hand('gripR', [0.019, -0.06, 0.07], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.support('pumpL', [-0.002, -0.0235, -0.012], 'pump');
  model.hand('shellHold', [-0.017, 0.0, -0.03], [-0.3, 0.1, -0.95], [0.9, -0.1, -0.35], 'shell');
  return model;
}

/** Time to get one shell from the pouch to the port, as a fraction of the reload. */
const FETCH = 0.13;
/** Reload fractions the foley says a shell goes home. */
const SHELLS = [0.12, 0.34, 0.56] as const;

function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a);
  // Hand-cycled: the off hand throws the pump between shots, deliberately. With Greased bolt (`shotgunBolt`), the whole
  // cycle and its foley (mods.ts) run at GREASE (75%): back at 0.20 s, home at 0.35 s, fitting inside the 0.4125 s refire.
  const cycle = a.mods?.has('shotgunBolt') ? GREASE : 1;
  const t = a.sinceFire / cycle;
  let rack = t < 0.48 ? hold(t, 0.13, 0.27, 0.31, 0.47) : 0;
  a.gunP.z += rack * 0.012;
  a.gunR.z -= rack * 0.035;
  a.gunR.x += rack * 0.012;
  a.glow('sight', 1);

  if (a.draw < 1) rack = Math.max(rack, hold(a.draw, 0.3, 0.58, 0.62, 0.95));

  P.shell!.visible = false;
  const p = a.reload;
  if (p >= 0) {
    // The gun rolls onto its right side to show the port, and rests on a slight rise as each shell goes in.
    const dynamic = a.reloadShells > 0;
    const count = dynamic ? a.reloadShells : SHELLS.length;
    const fetch = dynamic ? a.reloadStep * 0.72 : FETCH;
    const presentIn = dynamic ? Math.min(0.09, a.reloadStart * 0.85) : 0.09;
    const presentEnd = dynamic ? a.reloadStart + count * a.reloadStep : 0.68;
    const presentOut = dynamic ? Math.min(1, presentEnd + (a.reloadFromEmpty ? 0.06 : Math.max(0.04, 1 - presentEnd))) : 0.8;
    const present = hold(p, 0, presentIn, presentEnd, presentOut);
    const pushOut = dynamic ? a.reloadStep * 0.18 : 0.05;
    const seatDur = dynamic ? a.reloadStep * 0.35 : 0.09;
    let seat = 0;
    let hand = 0;
    for (let i = 0; i < count; i++) {
      const at = dynamic ? a.reloadStart + (i + 0.72) * a.reloadStep : SHELLS[i]!;
      const k = seg(p, at - fetch, at);
      if (p > at - fetch && p < at + pushOut) {
        const pushEnd = dynamic ? pushOut * 0.25 : 0.012;
        P.shell!.visible = p < at + pushEnd;
        const u = inOut(k);
        const sh = P.shell!;
        // Up from the belt, then pushed forward past the carrier.
        sh.position.x += (1 - u) * -0.16;
        sh.position.y += (1 - u) * -0.3 - 0.014 * u;
        sh.position.z += (1 - u) * 0.12 + (p > at ? seg(p, at, at + pushEnd) * -0.05 : 0);
        sh.rotation.x += (1 - u) * 1.3;
        sh.rotation.y += (1 - u) * -0.5;
        hand = Math.max(hand, hold(p, at - fetch, at - fetch + fetch * 0.38, at + pushOut * 0.6, at + pushOut * 1.4));
      }
      seat = Math.max(seat, p >= at ? thud(seg(p, at, at + seatDur)) : 0);
    }
    a.gunR.z -= present * 0.62;
    a.gunR.x += present * 0.2 + seat * 0.022;
    a.gunR.y -= present * 0.1;
    a.gunP.x -= present * 0.03;
    a.gunP.y += present * 0.05 + seat * 0.005;
    a.gunP.z += present * 0.05;

    if (!dynamic || a.reloadFromEmpty) {
      const rackStart = dynamic ? presentEnd : 0.8;
      const rackEnd = dynamic ? Math.min(0.98, rackStart + (1 - rackStart) * 0.92) : 0.98;
      const last = bump(p, rackStart, rackEnd);
      rack = Math.max(rack, last);
      a.gunR.x -= last * 0.04;
      a.gunP.z += last * 0.01;
    }

    a.left.fingerRate = 42;
    a.left.to('shellHold', hand);
    a.left.shape(HANDS.pinch, hand);
  }
  P.pump!.position.z += rack * PUMP_TRAVEL;
  P.bolt!.position.z += rack * PUMP_TRAVEL;
}

export function shotgunDef(kit: Kit): ViewDef {
  return {
    id: 'shotgun',
    model: buildShotgun(kit),
    pos: [0.142, -0.112, -0.395],
    rot: [0.03, 0.08, 0],
    // ADS: the bead through the ghost ring.
    sight: [0, 0.058, -0.6685], rear: [0, 0.0795, 0.0421], relief: 0.81,
    recoil: { back: 0.062, lift: 0.012, pitch: 0.1, yaw: 0.012, roll: 0.03, omega: 30, zeta: 0.52 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'pumpL', pose: HANDS.support },
    heatPerShot: 0.09,
    animate: clip,
    readout: a => drawCount(a, 'ammo', 0, a.magSize, '#9cff3a'),
    mods: {
      shotgunChoke: { part: 'choke', hides: 'breacher', muzzle: 'muzzleChoke' },
      shotgunSawedOff: {
        part: 'sawedOff', hides: 'barrelFull', muzzle: 'muzzleSawed',
        sight: [0, 0.054, -0.444], rear: [0, 0.0795, 0.0421], relief: 0.65,
        moves: { part: 'light', z: 0.072 },
      },
      shotgunBolt: { part: 'greaseBolt', also: 'greaseBars' },
      shotgunLight: { part: 'light' },
    },
  };
}

