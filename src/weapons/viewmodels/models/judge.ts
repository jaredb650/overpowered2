/**
 * The Judge: a heavy-frame revolver. Bright stainless, a vent rib and full underlug, walnut grips, and a real cylinder
 * on a crane: it indexes one chamber per shot, swings out, kicks its empties and takes a speedloader. Origin at the
 * top of the grip. Nothing on this gun hides what it is doing, which is the whole appeal.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Finish, Mesher } from '../kit/mesher';
import { curve, poly, slotRow, type V2 } from '../kit/shapes';
import { knurl, screwX } from '../kit/details';
import { bump, hold, inOut, inQuad, outCubic, seg, thud } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { pullTrigger, round } from './common';

const BORE = 0.05;
/** Cylinder axis sits below the bore by the chamber circle's radius. */
const CHAMBER_R = 0.0165;
const CYL_Y = BORE - CHAMBER_R;
const CYL_R = 0.0292;
const CYL_FRONT = -0.066;
const CYL_BACK = -0.002;
const STEP = Math.PI / 3;
const STAINLESS: Finish = { color: 0xa9adb3, rough: 0.27, metal: 1, wear: 0.05, kind: 3 };
const STAINLESS_DARK: Finish = { color: 0x70747a, rough: 0.34, metal: 1, wear: 0.1 };

function frame(m: Mesher): void {
  m.use(STAINLESS);
  // One forging: top strap, recoil shield, trigger housing. The window is where the cylinder lives.
  const outer = poly([
    [0.044, -0.012], [0.05, 0.03, 0.01], [0.04, 0.064, 0.006], [-0.078, 0.064, 0.002], [-0.082, 0.052], [-0.082, 0.0, 0.003], [-0.07, -0.006, 0.002], [-0.015, -0.012, 0.003],
  ], 0.002);
  const window: V2[] = poly([[0.002, 0.003], [0.002, 0.058, 0.002], [-0.07, 0.058, 0.002], [-0.07, 0.003, 0.002]], 0.001);
  m.side(outer, 0.036, { bevel: 0.002, holes: [window] });
  // Recoil shield disc behind the cylinder.
  m.use(STAINLESS_DARK);
  m.at([0, CYL_Y, 0.0025], null, () => m.cyl(0.027, 0.002, 28, 0.0004));
  // Top strap rib with slots you can see through.
  m.use(STAINLESS);
  m.at([0, 0.0695, -0.018], null, () => m.side(poly([[0.042, -0.006], [0.042, 0.002, 0.002], [-0.075, 0.002, 0.002], [-0.075, -0.006]], 0.001), 0.014, { bevel: 0.0008 }));
  // Rear sight: square notch, white outline.
  m.use(F.blued);
  m.at([0, 0.074, 0.028], null, () => {
    m.side(poly([[0.012, -0.002], [0.012, 0.0045, 0.001], [-0.012, 0.0085, 0.001], [-0.012, -0.002]], 0.0006), 0.016, { bevel: 0.0007 });
    m.use(F.black);
    m.at([0, 0.0052, -0.01], null, () => m.box(0.0045, 0.0052, 0.008, 0));
  });
  m.mirror(() => {
    screwX(m, 0.0186, 0.04, 0.03, 1, 0.0022, STAINLESS_DARK);
    screwX(m, 0.0186, -0.004, 0.012, 1, 0.0022, STAINLESS_DARK);
  });
  // Hammer channel at the back of the frame.
  m.use(F.black);
  m.at([0, 0.054, 0.046], null, () => m.box(0.0075, 0.016, 0.016, 0));
  // Latch thumb piece, left of the frame.
  m.part('latch', [-0.0195, 0.0355, 0.018], () => {
    m.use(STAINLESS_DARK);
    m.side(poly([[-0.01, -0.0052], [0.01, -0.0052], [0.0115, 0.0052], [-0.0115, 0.0052]], 0.0012), 0.0038, { bevel: 0.0008 });
    for (let i = 0; i < 6; i++) { m.use(F.steelDark); m.at([-0.0022, 0, -0.0075 + i * 0.003], null, () => m.box(0.0012, 0.0086, 0.0012, 0.0002)); }
  });
  m.at([-0.0185, 0.008, -0.03], [0, -Math.PI / 2, 0], () => m.decal('judge', 0.038, 0.0095, 0x303338));
  m.at([-0.0187, -0.002, -0.044], [0, -Math.PI / 2, 0], () => m.decal('cal50', 0.03, 0.0048, 0x303338));
}

function barrel(m: Mesher): void {
  const zf = -0.082;
  const zm = -0.31;
  // Round tube, slab-sided rib above, full underlug below: the outline that says heavy.
  m.at([0, BORE, 0], null, () => {
    m.use(STAINLESS);
    m.lathe([[0.0118, zf + 0.002, 0], [0.0145, zf], [0.0132, zf - 0.008], [0.0132, zm - 0.002, 0]], 22);
    m.use(F.black);
    m.lathe([[0.0074, zm + 0.002, 0], [0.0076, zm - 0.012, 0], [0, zm - 0.0125, 0]], 14);
    m.use(STAINLESS_DARK);
    m.lathe([[0.0132, zm, 0], [0.0132, zm - 0.002], [0.0118, zm - 0.0045], [0.0076, zm - 0.005], [0.0076, zm - 0.002, 0]], 22);
  });
  // Vent rib.
  m.use(STAINLESS);
  const rib: V2[] = poly([[zf, 0.056], [zf, 0.0725, 0.002], [zm + 0.002, 0.0725, 0.002], [zm, 0.056]], 0.001);
  m.side(rib, 0.012, { bevel: 0.0009, holes: slotRow(zf - 0.028, 0.0635, zm + 0.03, 0.0635, 7, 0.018, 0.0065, 0) });
  m.at([0, 0.0732, (zf + zm) / 2], null, () => {
    m.use(STAINLESS_DARK);
    m.box(0.0115, 0.0012, zf - zm, 0.0002);
  });
  // Front sight with a glowing insert.
  m.use(F.blued);
  m.at([0, 0.0735, zm + 0.03], null, () => m.side(poly([[0.016, 0], [-0.008, 0], [-0.011, 0.012, 0.0014], [-0.003, 0.012, 0.0014]], 0.0007), 0.0045, { bevel: 0.0005 }));
  m.glow('sight', () => m.at([0, 0.0825, zm + 0.0225], null, () => m.cyl(0.0014, 0.0015, 8, 0)));
  // Underlug: ejector shroud to the muzzle, weight where it stops the flip.
  m.use(STAINLESS);
  const lug: V2[] = poly([[zf, 0.042], [zf, 0.012, 0.003], [zf - 0.02, 0.008, 0.004], [zm + 0.012, 0.008, 0.006], [zm, 0.016, 0.004], [zm, 0.042]], 0.0015);
  m.side(lug, 0.022, { bevel: 0.0016 });
  m.use(STAINLESS_DARK);
  m.mirror(() => m.at([0.0116, 0, 0], null, () => m.side(poly([[zf - 0.028, 0.018], [zf - 0.028, 0.034, 0.002], [zm + 0.03, 0.034, 0.002], [zm + 0.03, 0.018, 0.002]], 0.0015), 0.0012, { bevel: 0.0004 })));
}

function grip(m: Mesher): void {
  const front = curve([[0.022, -0.012], [0.024, -0.034], [0.032, -0.052], [0.03, -0.072], [0.036, -0.094], [0.042, -0.122]], 5);
  const back = curve([[0.094, -0.122], [0.098, -0.09], [0.09, -0.05], [0.074, -0.018], [0.05, 0.03]], 5);
  const outline: V2[] = [...front, [0.048, -0.13], [0.09, -0.13], ...back];
  m.use(F.walnutDark);
  m.side(outline, 0.034, { bevel: 0.0048, smooth: 42 });
  m.use(F.walnut);
  m.mirror(() => m.at([0.0155, 0, 0], null, () => m.side(poly([[0.034, -0.02], [0.074, -0.018], [0.086, -0.052], [0.086, -0.112], [0.052, -0.116], [0.04, -0.08]], 0.005), 0.0046, { bevel: 0.0018 })));
  m.use({ ...F.walnutDark, kind: 2 });
  m.mirror(() => m.at([0.0178, 0, 0], null, () => m.side(poly([[0.042, -0.03], [0.07, -0.03], [0.08, -0.06], [0.08, -0.1], [0.056, -0.104], [0.046, -0.076]], 0.004), 0.002, { bevel: 0.0007 })));
  // Brass medallion and butt cap.
  m.mirror(() => m.at([0.0198, -0.016, 0.054], [0, Math.PI / 2, 0], () => { m.use(F.brass); m.cyl(0.0058, 0.0014, 16, 0.0004); }));
  m.use(STAINLESS);
  m.at([0, -0.131, 0.07], null, () => m.box(0.03, 0.004, 0.05, 0.0012, 0.003));
  // Trigger guard.
  m.use(STAINLESS);
  m.side(poly([[-0.024, -0.008], [-0.032, -0.02, 0.006], [-0.02, -0.036, 0.008], [0.015, -0.036, 0.008], [0.03, -0.012, 0.004], [0.03, -0.006]], 0.002), 0.0105, {
    bevel: 0.001,
    holes: [poly([[-0.021, -0.012], [-0.026, -0.019, 0.005], [-0.017, -0.031, 0.005], [0.011, -0.031, 0.005], [0.023, -0.012, 0.003]], 0.002)],
  });
}

function cylinder(m: Mesher): void {
  // The crane carries the cylinder out to the left, around a pin under the frame.
  m.part('crane', [-0.009, 0.0085, -0.05], () => {
    m.use(STAINLESS_DARK);
    m.at([0.0, 0.0, -0.012], null, () => m.box(0.012, 0.012, 0.018, 0.001));
    m.at([0, 0.0, 0], null, () => m.cyl(0.0052, 0.05, 12));
    const cx = 0.009;
    const cy = CYL_Y - 0.0085;
    const cz = 0.05 + CYL_FRONT + 0.0;
    // Ejector rod under the barrel.
    m.use(STAINLESS);
    m.at([cx, cy, cz - 0.034], null, () => m.cyl(0.0034, 0.07, 10));
    m.at([cx, cy, cz - 0.074], null, () => knurl(m, 0.0052, 0.011, STAINLESS_DARK, 14, 0.0004));
    m.part('cyl', [cx, cy, 0.05 + (CYL_FRONT + CYL_BACK) / 2], () => {
      const h = (CYL_BACK - CYL_FRONT) / 2;
      m.use(STAINLESS);
      m.lathe([[0.0058, h - 0.0005, 0], [CYL_R - 0.002, h - 0.0005], [CYL_R, h - 0.003], [CYL_R, -h + 0.002], [CYL_R - 0.003, -h], [0.0058, -h, 0]], 42, { chamfer: 0.0008, smooth: 20 });
      // Flutes between the chambers and a lock notch on each.
      m.use(STAINLESS_DARK);
      for (let i = 0; i < 6; i++) {
        const a = i * STEP + STEP / 2;
        m.at([Math.cos(a) * (CYL_R + 0.0028), Math.sin(a) * (CYL_R + 0.0028), -h * 0.28], [0, 0, a], () => m.lathe([[0.0, 0.021, 0], [0.0048, 0.018], [0.0052, 0.0], [0.0048, -0.018], [0, -0.021, 0]], 10, { chamfer: 0, smooth: 40 }));
        const b = i * STEP;
        m.at([Math.cos(b) * (CYL_R - 0.0002), Math.sin(b) * (CYL_R - 0.0002), h - 0.012], [0, 0, b], () => m.box(0.0012, 0.0052, 0.0074, 0.0003));
      }
      // Chamber mouths at the front.
      m.use(F.black);
      for (let i = 0; i < 6; i++) {
        const a = i * STEP;
        m.at([Math.cos(a) * CHAMBER_R, Math.sin(a) * CHAMBER_R, -h - 0.0001], null, () => m.cyl(0.0086, 0.0006, 14, 0));
      }
      m.part('cases', [0, 0, h], () => {
        // Six rounds on the extractor star: brass in the chamber, seen from behind when the crane swings out.
        m.use(STAINLESS_DARK);
        m.at([0, 0, 0.0008], null, () => m.prism(starPlate(), 0.0016, { bevel: 0.0004 }));
        for (let i = 0; i < 6; i++) {
          const a = i * STEP;
          m.at([Math.cos(a) * CHAMBER_R, Math.sin(a) * CHAMBER_R, 0.0022], null, () => round(m, 0.0078, 0.05, 0.018));
        }
      });
    });
    loader(m, cx, cy, 0.05 + CYL_BACK);
  });
}

function starPlate(): V2[] {
  const out: [number, number][] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = i % 4 === 2 ? 0.0145 : 0.0205;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

/** Speedloader: a knurled hub holding six fresh rounds. Rides the crane, with its origin on the back of the cylinder. */
function loader(m: Mesher, x: number, y: number, z: number): void {
  m.part('loader', [x, y, z], () => {
    m.at([0, 0, 0.011], null, () => knurl(m, 0.012, 0.016, F.steelDark, 22, 0.0006));
    m.use(F.anodized);
    m.at([0, 0, 0.002], null, () => m.cyl(0.0255, 0.004, 26, 0.0008));
    m.use(F.steelDark);
    m.at([0, 0, 0.021], null, () => m.cyl(0.0125, 0.003, 18));
    for (let i = 0; i < 6; i++) {
      const a = i * STEP;
      m.at([Math.cos(a) * CHAMBER_R, Math.sin(a) * CHAMBER_R, -0.001], null, () => round(m, 0.0078, 0.05, 0.018));
    }
  });
}

function buildJudge(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0012;
  frame(m);
  barrel(m);
  grip(m);
  cylinder(m);
  m.part('hammer', [0, 0.04, 0.05], () => {
    m.use(STAINLESS_DARK);
    m.side(poly([[-0.008, -0.004], [0.0, -0.008], [0.004, 0.004], [0.006, 0.02, 0.002], [0.016, 0.03, 0.003], [0.02, 0.026, 0.002], [0.01, 0.014, 0.002], [-0.002, 0.014]], 0.001), 0.0075, { bevel: 0.0007 });
    for (let i = 0; i < 4; i++) { m.use(F.steelDark); m.at([0, 0.0305 - i * 0.002, 0.0145 + i * 0.0018], null, () => m.box(0.0078, 0.0006, 0.0014, 0.0001)); }
  });
  m.part('trigger', [0, -0.006, -0.006], () => {
    m.use(STAINLESS_DARK);
    m.side(poly([[-0.0035, 0.002], [0.0035, 0.002], [0.002, -0.009, 0.002], [0.0038, -0.0195, 0.0015], [0.0005, -0.0205, 0.001], [-0.0035, -0.0095, 0.003]], 0.001), 0.0065, { bevel: 0.0007 });
  });
  const model = new Model(m, kit.mats, { glows: { sight: [0xff6a1a, 7] } });
  model.socket('muzzle', [0, BORE, -0.323]);
  model.socket('eject', [-0.03, 0.03, -0.01]);
  model.hand('gripR', [0.0205, -0.07, 0.066], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  // The off hand wraps under the shooting hand, thumbs forward along the frame.
  model.hand('gripL', [-0.024, -0.082, 0.06], [-0.05, 0.3, -0.95], [0.86, -0.42, -0.25]);
  model.hand('latchHold', [-0.03, 0.0, 0.0], [-0.5, -0.2, -0.8], [0.8, -0.3, -0.5], 'latch');
  model.hand('loaderHold', [0, -0.002, 0.038], [-0.2, 0.1, -0.97], [0.5, 0.8, -0.3], 'loader');
  model.hand('craneHold', [-0.06, 0.0, -0.01], [-0.1, 0.3, -0.95], [0.9, -0.3, -0.2], 'crane');
  return model;
}

/** The crane swings this far out, around its pin. */
const CRANE_OPEN = 1.25;

function clip(a: Anim): void {
  const P = a.parts;
  pullTrigger(a, 0.09, 0.4);
  a.glow('sight', 1);
  const t = a.sinceFire;
  // Hammer falls on the shot, and the thumb brings it back through the refire, indexing the cylinder as it rises.
  const cock = t < 0.42 ? inOut(seg(t, 0.17, 0.36)) : 1;
  P.hammer!.rotation.x += cock * 0.72 - 0.72;
  P.cyl!.rotation.z += (a.shots + (t < 0.42 ? cock - 1 : 0)) * STEP;
  a.gunR.z -= t < 0.36 ? bump(t, 0.15, 0.36) * 0.018 : 0;

  P.loader!.visible = false;
  if (a.draw < 1) {
    // A twirl onto the target: the wrist rolls it the last half turn.
    const k = 1 - outCubic(a.draw);
    a.gunR.x += k * 1.1;
    a.gunR.z += k * 0.5;
    P.cyl!.rotation.z += k * 5;
  }
  const p = a.reload;
  if (p < 0) return;

  const open = inOut(seg(p, 0.04, 0.12)) * (1 - inQuad(seg(p, 0.72, 0.76)));
  const shut = p >= 0.76 ? thud(seg(p, 0.76, 0.86)) : 0;
  P.crane!.rotation.z -= open * CRANE_OPEN + shut * 0.05;
  P.latch!.position.z -= hold(p, 0.0, 0.03, 0.08, 0.12) * 0.005;

  // Rod slammed: the empties jump out and fall away with the muzzle up.
  const eject = seg(p, 0.15, 0.2);
  const cases = P.cases!;
  cases.position.z += inQuad(eject) * 0.024;
  if (p >= 0.2 && p < 0.34) cases.visible = false;
  // The cylinder is thumbed round two chambers while it hangs open. Six-way symmetry keeps it lined up for the loader.
  P.cyl!.rotation.z += inOut(seg(p, 0.2, 0.3)) * STEP * 2;

  // Speedloader from the belt, home at the foley's 0.34, a twist, and away.
  const go = hold(p, 0.2, 0.34, 0.42, 0.52);
  if (p > 0.2 && p < 0.52) {
    const ld = P.loader!;
    ld.visible = true;
    ld.position.z += (1 - go) * 0.06;
    ld.position.x += (1 - go) * -0.22;
    ld.position.y += (1 - go) * -0.3;
    ld.rotation.x += (1 - go) * 1.1;
    ld.rotation.z += seg(p, 0.35, 0.42) * 0.5;
  }

  // Muzzle up to dump, muzzle down to load, flick to close.
  const up = hold(p, 0.08, 0.15, 0.2, 0.28);
  const dn = hold(p, 0.24, 0.32, 0.66, 0.74);
  const flick = bump(p, 0.7, 0.82);
  a.gunR.x += up * 0.95 - dn * 0.34 + flick * 0.16;
  a.gunR.z += hold(p, 0.03, 0.12, 0.72, 0.8) * 0.5;
  a.gunP.x -= hold(p, 0.03, 0.12, 0.74, 0.88) * 0.06;
  a.gunP.y += hold(p, 0.03, 0.12, 0.74, 0.88) * 0.025 + up * 0.045;
  a.gunP.z += hold(p, 0.03, 0.12, 0.74, 0.88) * 0.09;

  // Thumb cocks it to finish.
  const cockEnd = hold(p, 0.88, 0.93, 0.95, 1);
  P.hammer!.rotation.x += cockEnd * 0.1;

  const h = a.left;
  h.fingerRate = 40;
  h.to('latchHold', inOut(seg(p, 0.0, 0.05)));
  h.to('craneHold', inOut(seg(p, 0.08, 0.14)));
  h.to('loaderHold', inOut(seg(p, 0.2, 0.28)));
  h.to('craneHold', inOut(seg(p, 0.5, 0.6)));
  h.to('gripL', inOut(seg(p, 0.8, 0.95)));
  h.shape(HANDS.pinch, hold(p, 0.01, 0.05, 0.08, 0.12));
  h.shape(HANDS.cup, hold(p, 0.09, 0.14, 0.19, 0.22));
  h.shape(HANDS.cup, hold(p, 0.5, 0.6, 0.76, 0.82));
  h.shape(HANDS.pinch, hold(p, 0.22, 0.28, 0.46, 0.5));
}

export function judgeDef(kit: Kit): ViewDef {
  return {
    id: 'judge',
    model: buildJudge(kit),
    pos: [0.105, -0.118, -0.40],
    rot: [0.02, 0.06, 0],
    recoil: { back: 0.05, lift: 0.03, pitch: 0.27, yaw: 0.02, roll: 0.05, omega: 19, zeta: 0.56 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.support },
    heatPerShot: 0.05,
    animate: clip,
  };
}

