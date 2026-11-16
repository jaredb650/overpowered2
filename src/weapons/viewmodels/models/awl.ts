import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import { poly, rect } from '../kit/shapes';
import { knurl, screwX } from '../kit/details';
import { hold, inOut, outCubic, seg } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { pullTrigger } from './common';
import { acog, acogShade, OPTIC_GLOWS } from './optics';

const BORE = 0.047;
const MUZZLE = -0.61;

export function boltPose(seconds: number): { lift: number; back: number; hand: number } {
  const lift = inOut(seg(seconds, 0.1, 0.24)) * (1 - inOut(seg(seconds, 0.78, 0.9)));
  const back = inOut(seg(seconds, 0.24, 0.4)) * (1 - inOut(seg(seconds, 0.56, 0.74)));
  return { lift, back, hand: hold(seconds, 0.04, 0.13, 0.9, 0.95) };
}

function build(kit: Kit): { model: Model; mods: ViewDef['mods'] } {
  const mesher = kit.mesher();
  mesher.use(F.olive);
  mesher.side(poly([[0.4, -0.025], [0.4, -0.12], [0.32, -0.12], [0.18, -0.062], [0.135, -0.024], [0.096, -0.026], [0.063, -0.076], [0.025, -0.066], [0.045, -0.014], [-0.39, -0.014], [-0.43, 0.004], [-0.42, 0.026], [0.14, 0.026], [0.24, -0.006]], 0.007), 0.044, { bevel: 0.003 });
  mesher.use(F.rubber);
  mesher.at([0, -0.07, 0.407], [-0.05, 0, 0], () => mesher.box(0.052, 0.108, 0.019, 0.003));
  for (let rib = 0; rib < 7; rib++) mesher.at([0, -0.108 + rib * 0.012, 0.418], null, () => mesher.box(0.047, 0.003, 0.002, 0));
  mesher.use(F.polymerGrey);
  mesher.at([0, -0.005, 0.274], [-0.1, 0, 0], () => mesher.box(0.047, 0.025, 0.155, 0.004));
  mesher.use(F.polymerStipple);
  mesher.mirror(() => mesher.at([0.022, -0.042, 0.081], [0, 0, 0.12], () => mesher.box(0.003, 0.037, 0.037, 0.002)));
  mesher.use(F.black);
  mesher.at([0, -0.061, 0.32], null, () => mesher.box(0.047, 0.031, 0.067, 0.003));
  mesher.use(F.polymerGrey);
  mesher.at([0, -0.064, 0.324], null, () => mesher.box(0.045, 0.022, 0.057, 0.002));
  mesher.use(F.anodized);
  mesher.at([0, BORE, -0.03], null, () => mesher.cyl(0.02, 0.25, 24));
  mesher.use(F.black);
  mesher.at([0.019, 0.049, -0.025], null, () => mesher.box(0.002, 0.021, 0.09, 0.001));
  mesher.use(F.steelDark);
  mesher.at([0, 0.069, -0.235], null, () => mesher.box(0.031, 0.009, 0.27, 0.001));
  for (let tooth = 0; tooth < 15; tooth++) mesher.at([0, 0.076, -0.36 + tooth * 0.018], null, () => mesher.box(0.034, 0.004, 0.007, 0.0005));
  mesher.use(F.barrel);
  const flutes = Array.from({ length: 48 }, (_, index) => {
    const angle = index * Math.PI / 24;
    const radius = index % 6 < 3 ? 0.0108 : 0.0085;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius] as const;
  });
  mesher.at([0, BORE, -0.367], null, () => mesher.front(flutes, 0.47, { bevel: 0.0004 }));
  mesher.at([0, BORE, MUZZLE + 0.012], null, () => mesher.pipe(0.012, 0.004, 0.024, 24));
  mesher.use(F.black);
  mesher.at([0, BORE, MUZZLE + 0.005], null, () => mesher.cyl(0.004, 0.001, 20));
  mesher.part('bolt', [0, BORE, 0.045], () => {
    mesher.use(F.steel);
    mesher.cyl(0.012, 0.115, 24);
    mesher.at([0.016, 0, 0.03], [0, Math.PI / 2, 0], () => mesher.cyl(0.005, 0.034, 14));
    mesher.at([0.035, -0.012, 0.03], [0, 0, -0.6], () => mesher.box(0.009, 0.033, 0.011, 0.002));
    mesher.use(F.polymerGrey);
    mesher.at([0.044, -0.026, 0.03], null, () => mesher.box(0.019, 0.016, 0.027, 0.004));
  });
  mesher.part('trigger', [0, -0.014, 0.039], () => {
    mesher.use(F.steelDark);
    mesher.at([0, -0.012, -0.003], [0.25, 0, 0], () => mesher.box(0.006, 0.025, 0.004, 0.001));
  });
  mesher.use(F.polymerGrey);
  mesher.side(rect(-0.025, -0.052, 0.077, -0.008, 0.01), 0.015, { bevel: 0.001, holes: [rect(-0.018, -0.046, 0.068, -0.012, 0.007)] });
  mesher.part('mag', [0, -0.012, -0.064], () => {
    mesher.use(F.polymer);
    mesher.box(0.033, 0.043, 0.064, 0.002);
    mesher.use(F.polymerGrey);
    mesher.at([0, -0.023, 0], null, () => mesher.box(0.038, 0.007, 0.071, 0.001));
  });
  mesher.mirror(() => {
    mesher.part('bipod', [0.024, 0.003, -0.37], () => {
      mesher.use(F.oliveDark);
      mesher.at([0.002, -0.003, 0.074], null, () => mesher.box(0.012, 0.02, 0.165, 0.003));
      mesher.use(F.steelDark);
      mesher.at([0.004, 0.0, 0], [0, Math.PI / 2, 0], () => mesher.cyl(0.009, 0.01, 16));
      mesher.use(F.rubber);
      mesher.at([0.002, -0.006, 0.158], null, () => mesher.box(0.015, 0.021, 0.02, 0.002));
    });
    for (const at of [-0.12, 0.11, 0.37]) screwX(mesher, 0.024, -0.009, at, 1, 0.002);
  });
  mesher.part('scoutScope', [0, 0.108, -0.255], () => {
    mesher.use(F.anodized);
    mesher.pipe(0.016, 0.0125, 0.17, 32);
    for (const at of [-0.048, 0.048]) {
      mesher.at([0, 0, at], null, () => mesher.pipe(0.019, 0.015, 0.012, 24));
      mesher.at([0, -0.023, at], null, () => mesher.box(0.018, 0.028, 0.018, 0.001));
    }
    mesher.at([0, 0, -0.093], null, () => mesher.pipe(0.023, 0.019, 0.03, 32));
    mesher.at([0, 0, 0.091], null, () => mesher.pipe(0.02, 0.016, 0.024, 32));
    mesher.glass(() => {
      mesher.at([0, 0, -0.101], null, () => mesher.cyl(0.0188, 0.001, 32));
      mesher.at([0, 0, 0.1], null, () => mesher.cyl(0.0158, 0.001, 32));
    });
    mesher.at([0, 0.021, 0.01], [Math.PI / 2, 0, 0], () => knurl(mesher, 0.008, 0.012, F.anodizedGrey, 18, 0.0006));
    mesher.at([0.021, 0, 0.01], [0, Math.PI / 2, 0], () => knurl(mesher, 0.008, 0.012, F.anodizedGrey, 18, 0.0006));
  });
  const optic = acog(mesher, [0, 0.078, -0.105]);
  mesher.part('can', [0, BORE, MUZZLE - 0.06], () => {
    mesher.use(F.anodized);
    mesher.pipe(0.023, 0.004, 0.15, 32);
    for (const at of [-0.05, 0.045]) mesher.at([0, 0, at], null, () => knurl(mesher, 0.024, 0.01, F.steelDark, 24, 0.0005));
  });
  const model = new Model(mesher, kit.mats, { glows: OPTIC_GLOWS });
  acogShade(model);
  model.socket('muzzle', [0, BORE, MUZZLE]);
  model.socket('muzzleCan', [0, BORE, MUZZLE - 0.136]);
  model.socket('eject', [0.027, 0.055, -0.009]);
  model.hand('gripR', [0.018, -0.034, 0.097], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.hand('gripL', [-0.012, -0.002, -0.25], [0, 0, -1], [0.94, -0.34, 0]);
  model.hand('boltHold', [0.058, -0.027, 0.031], [0, -1, 0], [0, 0, -1], 'bolt');
  model.hand('magHold', [-0.021, -0.01, 0], [-0.3, 0.1, -0.95], [0.9, -0.1, -0.35], 'mag');
  return { model, mods: { awlAcog: optic, awlCan: { part: 'can', muzzle: 'muzzleCan' } } };
}

function clip(anim: Anim): void {
  const bolt = boltPose(anim.sinceFire);
  anim.parts.bolt!.rotation.z += bolt.lift * 1.12;
  anim.parts.bolt!.position.z += bolt.back * 0.095;
  anim.parts.scoutScope!.visible = !anim.mods?.has('awlAcog');
  anim.right.to('boltHold', bolt.hand);
  anim.right.shape(HANDS.grip, bolt.hand);
  anim.gunR.z -= bolt.hand * 0.14;
  anim.gunP.x -= bolt.hand * 0.018;
  anim.gunP.z -= bolt.hand * 0.1;
  pullTrigger(anim, 0.09, 0.25);
  if (anim.draw < 1) {
    const down = 1 - outCubic(anim.draw);
    anim.gunP.y -= down * 0.07;
    anim.gunR.x -= down * 0.35;
  }
  const progress = anim.reload;
  if (progress < 0) return;
  const away = inOut(seg(progress, 0.05, 0.22)) * (1 - inOut(seg(progress, 0.4, 0.55)));
  anim.parts.mag!.position.y -= away * 0.28;
  anim.parts.mag!.visible = !(progress > 0.24 && progress < 0.37);
  const present = hold(progress, 0, 0.12, 0.86, 1);
  anim.gunR.z -= present * 0.32;
  anim.gunR.x += present * 0.12;
  anim.left.to('magHold', inOut(seg(progress, 0, 0.06)));
  anim.left.to('pouchL', inOut(seg(progress, 0.2, 0.3)));
  anim.left.to('magHold', inOut(seg(progress, 0.37, 0.48)));
  anim.left.to('gripL', inOut(seg(progress, 0.65, 0.9)));
}

export function awlDef(kit: Kit): ViewDef {
  const { model, mods } = build(kit);
  return {
    id: 'awl', model, mods,
    pos: [0.135, -0.13, -0.42], rot: [0.025, 0.08, 0],
    recoil: { back: 0.047, lift: 0.006, pitch: 0.035, yaw: 0.008, roll: 0.014, omega: 33, zeta: 0.6 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.support },
    heatPerShot: 0.03,
    animate: clip,
  };
}
