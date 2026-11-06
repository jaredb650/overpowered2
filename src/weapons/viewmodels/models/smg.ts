/**
 * The Vespid SMG. Wolf-grey anodized upper, black polymer lower, hex-vented shroud, reflex sight with a live ammo
 * readout on the left of the receiver. Origin sits at the top of the grip, where the web of the hand presses.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Mesher } from '../kit/mesher';
import { curve, honeycomb, poly, rect, slot, type V2 } from '../kit/shapes';
import { coil, knurl, rail, screwX } from '../kit/details';
import { clamp } from '../../../core/math';
import { bump, hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';

export const SMG_BORE_Y = 0.04;

function grip(m: Mesher): void {
  // Finger grooves on the front strap, palm swell at the back: the outline is the part you actually see.
  const front = curve([[0.02, 0.002], [0.0205, -0.02], [0.0255, -0.036], [0.027, -0.05], [0.034, -0.064], [0.036, -0.08], [0.043, -0.094], [0.046, -0.112]], 4);
  const back = curve([[0.1, -0.112], [0.095, -0.08], [0.086, -0.045], [0.082, -0.02], [0.074, 0.002]], 4);
  const outline: V2[] = [...front, [0.046, -0.118], [0.098, -0.118], ...back];
  m.use(F.polymer);
  m.side(outline, 0.03, { bevel: 0.0035, smooth: 50 });
  // Stippled panels stand slightly proud of the core.
  m.use(F.polymerStipple);
  m.mirror(() => {
    m.at([0.0155, 0, 0], null, () => {
      m.side(poly([[0.04, -0.012], [0.072, -0.012], [0.086, -0.104], [0.054, -0.104]], 0.004), 0.0022, { bevel: 0.0009 });
    });
  });
  m.use(F.anodized);
  m.at([0, -0.1215, 0.073], null, () => m.box(0.03, 0.0065, 0.058, 0.0014, 0.003));
}

function shroud(m: Mesher): void {
  const zf = -0.262;
  const zr = -0.122;
  // Honeycomb real through-cuts: the barrel and gas block show behind them.
  const keep = (z: number, y: number) => y > 0.024 && y < 0.056 && z < zr - 0.006 && z > zf + 0.012 + (0.062 - y) * 0.3;
  const plate = poly([[zr, 0.017], [zr, 0.064], [zf + 0.018, 0.064, 0.003], [zf, 0.038, 0.006], [zf + 0.006, 0.017, 0.002]], 0.0015);
  m.use(F.anodizedGrey);
  m.mirror(() => {
    m.at([0.0205, 0, 0], null, () => m.side(plate, 0.0032, { bevel: 0.0008, holes: honeycomb(zf, 0.02, zr, 0.06, 0.0048, 0.0021, keep) }));
  });
  m.at([0, 0.0652, 0], null, () => m.top(rect(-0.0215, zf + 0.018, 0.0215, zr, 0.002), 0.0028, { bevel: 0.0008 }));
  m.at([0, 0.0158, 0], null, () => m.top(rect(-0.0215, zf + 0.006, 0.0215, zr, 0.002), 0.003, { bevel: 0.0008 }));
  m.at([0, 0.0666, 0], null, () => rail(m, zr - 0.004, zf + 0.022, 0.0212, F.anodized));
  // End cap with the barrel passing through.
  m.use(F.anodized);
  m.at([0, 0.04, zf + 0.014], null, () => m.front(poly([[-0.0225, -0.024], [0.0225, -0.024], [0.0225, 0.012, 0.012], [0.012, 0.0245], [-0.012, 0.0245], [-0.0225, 0.012, 0.012]], 0.003), 0.006, { bevel: 0.001 }));
  m.mirror(() => {
    screwX(m, 0.0221, 0.022, zr - 0.006, 1);
    screwX(m, 0.0221, 0.022, zf + 0.03, 1);
    screwX(m, 0.0221, 0.059, zr - 0.006, 1);
  });
}

function barrel(m: Mesher): void {
  m.at([0, 0.04, 0], null, () => {
    m.use(F.barrel);
    m.lathe([[0.0098, -0.1, 0], [0.0098, -0.17], [0.0088, -0.175], [0.0088, -0.27], [0.0078, -0.272], [0.0078, -0.285, 0]], 20);
    // Gas block.
    m.use(F.steelDark);
    m.at([0, 0.003, -0.205], null, () => m.box(0.03, 0.03, 0.022, 0.0015));
    m.at([0, 0.0152, -0.165], null, () => { m.use(F.steel); m.cyl(0.0036, 0.085, 10); });
    // Three-prong flash hider.
    m.use(F.parkerized);
    m.lathe([[0.0078, -0.268, 0], [0.0128, -0.2705], [0.0128, -0.292], [0.0115, -0.295], [0.0052, -0.295, 0]], 22);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
      m.at([0, 0, -0.312], [0, 0, a], () => {
        const p: V2[] = [];
        const sweep = 0.72;
        for (let k = 0; k <= 7; k++) { const t = -sweep + (k / 7) * sweep * 2; p.push([Math.cos(t) * 0.0128, Math.sin(t) * 0.0128]); }
        for (let k = 7; k >= 0; k--) { const t = -sweep + (k / 7) * sweep * 2; p.push([Math.cos(t) * 0.0076, Math.sin(t) * 0.0076]); }
        m.prism(p, 0.036, { bevel: 0.0009, smooth: 30 });
      });
    }
    m.use(F.black);
    m.lathe([[0.0052, -0.295, 0], [0.0045, -0.33, 0], [0, -0.331, 0]], 14);
  });
}

function sight(m: Mesher): void {
  const y0 = 0.0737;
  m.at([0, y0, 0.012], null, () => {
    // Clamp base.
    m.use(F.anodized);
    m.at([0, 0.0035, 0], null, () => m.box(0.03, 0.007, 0.048, 0.0012, 0.0016));
    m.use(F.steelDark);
    m.at([0.0185, 0.0035, 0.002], [0, Math.PI / 2, 0], () => m.cyl(0.0048, 0.006, 12));
    // Hood: arched window extruded along the bore.
    const hood = poly([[-0.0165, 0.006], [0.0165, 0.006], [0.0165, 0.032, 0.008], [0.0095, 0.0425, 0.004], [-0.0095, 0.0425, 0.004], [-0.0165, 0.032, 0.008]], 0.002);
    const windowCut = poly([[-0.0125, 0.0095], [0.0125, 0.0095], [0.0125, 0.03, 0.006], [0.0075, 0.0385, 0.003], [-0.0075, 0.0385, 0.003], [-0.0125, 0.03, 0.006]], 0.002);
    m.use(F.anodized);
    m.at([0, 0, 0.0], null, () => m.front(hood, 0.04, { bevel: 0.0012, holes: [windowCut] }));
    // Rear ring is a slightly wider lip.
    m.use(F.rubber);
    m.at([0, 0, 0.0205], null, () => m.front(hood, 0.0035, { bevel: 0.0009, holes: [windowCut] }));
    m.use(F.anodizedGrey);
    m.at([0.0185, 0.022, 0.002], null, () => m.box(0.004, 0.018, 0.018, 0.0008));
    m.at([0.0, 0.0458, 0.002], null, () => m.box(0.012, 0.0045, 0.014, 0.0008));
    m.glass(() => m.at([0, 0.02, -0.012], null, () => m.front(windowCut, 0.0012, { bevel: 0 })));
    // The reticle floats on the glass, facing the shooter.
    m.glow('sight', () => {
      m.at([0, 0.0225, -0.0115], null, () => {
        m.prism(poly([[-0.0009, -0.0009], [0.0009, -0.0009], [0.0009, 0.0009], [-0.0009, 0.0009]], 0.0003), 0.0002, { bevel: 0 });
        for (let i = 0; i < 3; i++) {
          m.at([0, 0, 0], [0, 0, (i / 3) * Math.PI * 2 + Math.PI / 2], () => {
            m.prism(rect(0.0045, -0.00035, 0.0075, 0.00035, 0), 0.0002, { bevel: 0 });
          });
        }
      });
    });
  });
}

function upper(m: Mesher): void {
  m.use(F.anodized);
  const core = poly([[0.128, 0.017], [0.134, 0.05, 0.008], [0.12, 0.063, 0.006], [-0.122, 0.063, 0.002], [-0.122, 0.017]], 0.002);
  m.side(core, 0.031, { bevel: 0.0016 });

  // Side plates carry the personality: long angular lightening cuts over the dark core.
  const plate = poly([[0.122, 0.021], [0.126, 0.05, 0.006], [0.114, 0.0595, 0.004], [-0.118, 0.0595, 0.002], [-0.118, 0.021]], 0.0015);
  const cuts: V2[][] = [
    poly([[-0.012, 0.027], [-0.1, 0.027], [-0.104, 0.038], [-0.02, 0.038]], 0.002),
    poly([[0.112, 0.027], [0.092, 0.027], [0.096, 0.043], [0.116, 0.043]], 0.002),
  ];
  m.use(F.anodizedGrey);
  m.at([-0.0165, 0, 0], null, () => {
    m.side(plate, 0.0032, { bevel: 0.0009, holes: [...cuts, slot(0.082, 0.0505, -0.024, 0.0505, 0.0027, 3)] });
  });
  m.at([0.0165, 0, 0], null, () => {
    // Ejection port.
    m.side(plate, 0.0032, { bevel: 0.0009, holes: [cuts[1]!, poly([[-0.016, 0.029], [-0.1, 0.029], [-0.1, 0.038], [-0.016, 0.038]], 0.002), rect(0.016, 0.03, 0.074, 0.054, 0.0035)] });
  });
  m.mirror(() => {
    screwX(m, 0.0184, 0.024, 0.104, 1);
    screwX(m, 0.0184, 0.024, -0.112, 1);
    screwX(m, 0.0184, 0.054, -0.11, 1);
  });

  // Dust-cover hinge and the forward assist nub.
  m.use(F.steelDark);
  m.at([0, 0.0634, 0], null, () => rail(m, 0.118, -0.118, 0.0212, F.anodized));
  m.at([0.0175, 0.0292, 0.046], null, () => m.cyl(0.0014, 0.062, 8));
  m.at([0.0178, 0.0342, 0.045], null, () => { m.use(F.steelDark); m.box(0.0018, 0.0035, 0.056, 0.0005); });

  // Rear serrations on the left plate for the off-hand.
  m.use(F.anodized);
  for (let i = 0; i < 5; i++) {
    m.at([-0.0186, 0.0485, 0.102 + i * 0.0032], null, () => m.box(0.0012, 0.008, 0.0016, 0.0003));
  }
  // Readout bezel on the left of the receiver.
  m.at([-0.0188, 0.0442, 0.0], null, () => {
    m.use(F.polymer);
    m.at([0, -0.0012, -0.052], [0, -Math.PI / 2, 0], () => {
      m.prism(rect(-0.02, -0.0085, 0.02, 0.0085, 0.0018), 0.0026, { bevel: 0.0008, holes: [rect(-0.0172, -0.0065, 0.0172, 0.0065, 0.0006)] });
      m.use(F.black);
      m.at([0, 0, -0.0006], null, () => m.prism(rect(-0.0178, -0.0072, 0.0178, 0.0072, 0.0006), 0.0012, { bevel: 0 }));
      m.at([0, 0, 0.0002], null, () => m.screen('ammo', 0.0344, 0.013));
    });
  });
  m.at([-0.0185, 0.0312, 0.098], [0, -Math.PI / 2, 0], () => m.decal('op2', 0.022, 0.0055, 0xb9bec4));
  m.at([-0.0185, 0.0246, 0.042], [0, -Math.PI / 2, 0], () => m.decal('cal9', 0.038, 0.006, 0xb9bec4));
  m.at([-0.0185, 0.0246, -0.06], [0, -Math.PI / 2, 0], () => m.decal('serial', 0.04, 0.0045, 0x8f949a));
}

function lower(m: Mesher): void {
  m.use(F.polymer);
  m.side(poly([[0.095, 0.0175], [0.1, 0.006, 0.004], [0.082, -0.008, 0.004], [-0.04, -0.008, 0.003], [-0.046, 0.0175]], 0.002), 0.03, { bevel: 0.0016 });
  // Magwell, flared at the mouth so the reload has somewhere to aim.
  m.use(F.polymerGrey);
  const well = poly([[-0.038, 0.0175], [-0.098, 0.0175], [-0.098, -0.02, 0.002], [-0.104, -0.036, 0.003], [-0.03, -0.036, 0.003], [-0.036, -0.02, 0.002]], 0.002);
  m.side(well, 0.0315, { bevel: 0.0016 });
  m.use(F.polymer);
  m.at([0, -0.0345, -0.067], null, () => m.box(0.0335, 0.0045, 0.08, 0.0012, 0.002));
  // Trigger guard: one solid loop with a real opening.
  m.use(F.polymer);
  const guardOut = poly([[-0.036, -0.0065], [-0.04, -0.028, 0.006], [-0.024, -0.04, 0.008], [0.03, -0.04, 0.008], [0.05, -0.012, 0.004], [0.05, -0.006]], 0.002);
  const guardIn = poly([[-0.031, -0.0085], [-0.033, -0.026, 0.005], [-0.021, -0.0345, 0.005], [0.022, -0.0345, 0.005], [0.041, -0.0115, 0.003], [0.042, -0.0085]], 0.002);
  m.side(guardOut, 0.0125, { bevel: 0.0013, holes: [guardIn] });
  m.mirror(() => screwX(m, 0.0151, 0.006, 0.066, 1, 0.0019));
  // Selector and mag catch on the left.
  m.part('selector', [-0.0165, 0.0065, 0.066], () => {
    m.use(F.steelDark);
    m.at([0, 0, 0], [0, Math.PI / 2, 0], () => m.cyl(0.0052, 0.0028, 12));
    m.at([-0.0014, 0.0, -0.008], null, () => m.box(0.0024, 0.0042, 0.016, 0.0007));
  });
  m.at([-0.0166, 0.0022, 0.066], [0, -Math.PI / 2, 0], () => m.decal('fire', 0.022, 0.0042, 0xd8d8d8));
  m.use(F.steelDark);
  m.at([-0.016, -0.007, -0.03], [0, Math.PI / 2, 0], () => m.cyl(0.0042, 0.0032, 12));
  m.at([0.0, 0.0, 0.07], null, () => m.at([0.0165, 0.012, -0.112], null, () => { m.box(0.002, 0.012, 0.018, 0.0006); }));
}

function stock(m: Mesher): void {
  m.at([0, 0.039, 0], null, () => {
    m.use(F.anodized);
    m.lathe([[0, 0.195, 0], [0.0135, 0.195], [0.0135, 0.1445], [0.0165, 0.143], [0.0165, 0.1375], [0.0145, 0.136], [0.0145, 0.1215, 0]], 20);
  });
  m.use(F.polymer);
  m.mirror(() => {
    m.at([0.0125, 0.03, 0.165], null, () => m.cyl(0.0034, 0.1, 10));
  });
  m.at([0, 0.012, 0.218], null, () => m.side(poly([[-0.009, 0.042], [0.009, 0.04], [0.012, -0.062, 0.006], [-0.009, -0.058, 0.005]], 0.002), 0.03, { bevel: 0.002 }));
}

function magazine(m: Mesher): void {
  // Lives in part space: origin at the magwell mouth, feed lips up.
  m.part('mag', [0, -0.012, -0.068], () => {
    m.at([0, 0, 0], [0.07, 0, 0], () => {
      const body = poly([[-0.02, 0.03], [0.02, 0.03], [0.021, -0.135, 0.003], [-0.021, -0.135, 0.003]], 0.002);
      m.use(F.polymer);
      m.side(body, 0.0235, {
        bevel: 0.0012,
        holes: [],
      });
      // Reinforcing ribs along the spine.
      m.use(F.polymerGrey);
      m.mirror(() => {
        m.at([0.0122, 0, 0], null, () => {
          m.side(poly([[-0.0185, -0.008], [-0.0115, -0.008], [-0.012, -0.132], [-0.0195, -0.132]], 0.001), 0.0018, { bevel: 0.0005 });
          m.side(poly([[0.0115, -0.008], [0.0185, -0.008], [0.0195, -0.132], [0.012, -0.132]], 0.001), 0.0018, { bevel: 0.0005 });
        });
      });
      // Witness window: brass stack behind clear polymer, and the follower climbs as the mag empties.
      m.use(F.black);
      m.at([-0.0121, -0.07, 0], [0, -Math.PI / 2, 0], () => m.prism(rect(-0.0085, -0.056, 0.0085, 0.056, 0.002), 0.0012, { bevel: 0 }));
      m.use(F.brass);
      for (let i = 0; i < 15; i++) {
        m.at([-0.0108, -0.0135 - i * 0.0074, 0], null, () => m.cyl(0.0034, 0.015, 8));
      }
      m.part('follower', [-0.0122, -0.02, 0], () => {
        m.use(F.polymerGrey);
        m.box(0.0014, 0.0075, 0.015, 0.0005);
      });
      m.glass(() => m.at([-0.0132, -0.07, 0], [0, -Math.PI / 2, 0], () => m.prism(rect(-0.0085, -0.056, 0.0085, 0.056, 0.002), 0.0006, { bevel: 0 })));
      // Base pad with a pull tab.
      m.use(F.anodized);
      m.at([0, -0.1395, 0], null, () => m.box(0.0285, 0.009, 0.0475, 0.0016, 0.003));
      m.at([0, -0.145, -0.024], null, () => { m.use(F.rubber); m.box(0.012, 0.003, 0.008, 0.0009); });
      // Feed lips and the top round.
      m.use(F.steelDark);
      m.mirror(() => m.at([0.0098, 0.0295, 0], null, () => m.box(0.0024, 0.0065, 0.038, 0.0006)));
      m.use(F.brass);
      m.at([0.0, 0.031, -0.002], null, () => m.cyl(0.0042, 0.021, 10));
      m.use(F.copper);
      m.at([0.0, 0.031, -0.0145], null, () => m.lathe([[0.0042, 0.003], [0.0035, -0.002], [0.0018, -0.0055], [0, -0.0065, 0]], 10));
    });
  });
}

function buildSmg(kit: Kit): Model {
  const m = kit.mesher();
  upper(m);
  lower(m);
  grip(m);
  shroud(m);
  barrel(m);
  sight(m);
  stock(m);
  magazine(m);

  m.part('bolt', [0, 0.04, 0.046], () => {
    m.use(F.steel);
    m.box(0.024, 0.024, 0.11, 0.0015);
    m.use(F.steelDark);
    for (let i = 0; i < 6; i++) m.at([0.0125, 0, 0.012 + i * 0.0055], null, () => m.box(0.0012, 0.018, 0.0024, 0.0003));
    m.at([0, 0, -0.058], null, () => { m.use(F.steelDark); m.cyl(0.0085, 0.012, 12); });
    m.at([0, 0.0, 0.08], null, () => coil(m, 0.0055, 0.0009, 0.05, 9));
  });
  m.part('charge', [-0.0195, 0.0505, 0.07], () => {
    m.use(F.steelDark);
    m.at([0.002, 0, 0], null, () => m.box(0.004, 0.0044, 0.012, 0.0008));
    m.at([-0.0035, 0, 0], [0, Math.PI / 2, 0], () => { knurl(m, 0.0052, 0.01, F.steelDark, 14, 0.0005); });
    m.at([-0.0092, 0, 0], [0, Math.PI / 2, 0], () => { m.use(F.steelDark); m.cyl(0.0058, 0.0016, 14); });
  });
  m.part('trigger', [0, -0.0075, -0.002], () => {
    m.use(F.steelDark);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0038, -0.0205, 0.0015], [0.0005, -0.0215, 0.001], [-0.0035, -0.0095, 0.003]], 0.001), 0.0065, { bevel: 0.0007 });
  });

  const model = new Model(m, kit.mats, {
    glows: { sight: [0x35e8ff, 7] },
    screens: { ammo: [192, 72] },
  });
  model.socket('muzzle', [0, 0.04, -0.332]);
  model.socket('eject', [0.02, 0.043, 0.045]);
  model.hand('gripR', [0.018, -0.052, 0.07], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.hand('gripL', [-0.001, 0.0095, -0.19], [-0.55, 0.15, -0.8], [0.8, 0.05, -0.55]);
  model.hand('gripAk', [-0.018, -0.052, 0.07], [0, 0.96, -0.27], [0.3, -0.25, -0.92]);
  model.hand('magHold', [-0.018, -0.06, -0.006], [-0.3, 0.1, -0.95], [0.9, -0.1, -0.35], 'mag');
  model.hand('chargeHold', [-0.03, 0.05, 0.085], [-0.5, -0.2, -0.8], [0.8, -0.3, -0.5], 'charge');
  return model;
}

function drawReadout(a: Anim): void {
  const s = a.model!.screens.ammo;
  if (!s) return;
  const { g, canvas, texture } = s;
  const w = canvas.width;
  const h = canvas.height;
  const low = a.mag <= a.magSize * 0.25;
  g.fillStyle = '#031014';
  g.fillRect(0, 0, w, h);
  g.fillStyle = low ? '#ff3a2a' : '#35e8ff';
  g.font = '800 60px "Courier New", monospace';
  g.textBaseline = 'middle';
  g.fillText(String(a.mag).padStart(2, '0'), 10, h / 2 + 2);
  // Segmented bar: one tick per six rounds left.
  const bars = Math.ceil((a.mag / Math.max(a.magSize, 1)) * 5);
  for (let i = 0; i < 5; i++) {
    g.globalAlpha = i < bars ? 1 : 0.16;
    g.fillRect(96 + i * 18, 12, 13, h - 24);
  }
  g.globalAlpha = 1;
  texture.needsUpdate = true;
}

function clip(a: Anim, left: boolean): void {
  const parts = a.parts;
  const cycle = 0.05;
  const c = a.sinceFire < cycle ? a.sinceFire / cycle : 1;
  const boltTravel = Math.sin(c * Math.PI) * 0.042;
  parts.bolt!.position.z += boltTravel;
  parts.charge!.position.z += boltTravel * 0.25;
  const pull = a.sinceFire < 0.07 ? 1 : 0;
  parts.trigger!.rotation.x -= pull * 0.32;
  a.right.trigger = pull;
  parts.follower!.position.y += (1 - clamp(a.mag / Math.max(a.magSize, 1))) * 0.098;
  a.glow('sight', 0.9 + 0.1 * Math.sin(a.time * 17));

  // Draw flair: the off hand slaps the charging handle on the way up.
  if (a.draw < 1 && !left) {
    const d = a.draw;
    const pull2 = bump(d, 0.2, 0.9);
    parts.charge!.position.z += pull2 * 0.05;
    parts.bolt!.position.z += pull2 * 0.05;
    a.left.to('chargeHold', bump(d, 0.05, 0.95));
  }

  const p = a.reload;
  if (p < 0) return;
  // The first game's beats: drop to 0.3, insert to 0.7, rack to 1.0.
  const out = seg(p, 0.1, 0.3);
  const inn = seg(p, 0.42, 0.66);
  const mag = parts.mag!;
  const off = inQuad(out) * (1 - outCubic(inn));
  mag.position.y -= off * 0.34;
  mag.position.z -= off * 0.03;
  mag.rotation.x += off * 0.5;
  if (p > 0.3 && p < 0.42) mag.visible = false;
  // The empty mag is dropped, not carried: the hand peels off while it falls.
  const seat = thud(seg(p, 0.655, 0.78));
  const seated = p >= 0.655 ? seat : 0;
  const rack = bump(p, 0.74, 0.92);
  parts.charge!.position.z += rack * 0.062;
  parts.bolt!.position.z += rack * 0.062;

  // The gun rolls left to present the magwell, kicks up as the mag seats, then rocks with the rack.
  const present = hold(p, 0.0, 0.14, 0.86, 1);
  a.gunR.z += present * 0.42 + seated * 0.03;
  a.gunR.x += present * 0.2 + seated * 0.05 - rack * 0.05;
  a.gunR.y -= present * 0.18;
  a.gunP.x -= present * 0.05;
  a.gunP.y += present * 0.03 + seated * 0.012;
  a.gunP.z += present * 0.04 + rack * 0.012;

  const hand = left ? a.left : a.left;
  hand.fingerRate = 40;
  hand.to('magHold', inOut(seg(p, 0.02, 0.12)));
  hand.to('pouchL', inOut(seg(p, 0.22, 0.36)));
  hand.to('magHold', inOut(seg(p, 0.4, 0.5)));
  hand.to('chargeHold', inOut(seg(p, 0.68, 0.76)));
  hand.to('gripL', inOut(seg(p, 0.9, 1)));
  hand.shape(HANDS.cup, hold(p, 0.03, 0.1, 0.62, 0.68));
  hand.shape(HANDS.pinch, hold(p, 0.7, 0.75, 0.88, 0.93));
}

export function smgDefs(kit: Kit): { right: ViewDef; left: ViewDef } {
  const recoil = { back: 0.0145, lift: 0.0017, pitch: 0.0135, yaw: 0.0035, roll: 0.0055, omega: 62, zeta: 0.62 };
  const right: ViewDef = {
    id: 'smg',
    model: buildSmg(kit),
    pos: [0.135, -0.125, -0.43],
    rot: [0.025, 0.085, 0],
    recoil,
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.support },
    heatPerShot: 0.007,
    animate: a => clip(a, false),
    readout: drawReadout,
  };
  const left: ViewDef = {
    id: 'smgLeft',
    model: buildSmg(kit),
    pos: [-0.165, -0.125, -0.43],
    rot: [0.025, -0.085, 0],
    recoil,
    right: null,
    left: { socket: 'gripAk', pose: HANDS.grip },
    animate: a => clip(a, true),
    readout: drawReadout,
  };
  return { right, left };
}
