/**
 * The Bodkin: bullpup flechette rifle (Phase 0 placeholder; full Steyr ACR-inspired hero model built in Lane H).
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import { poly } from '../kit/shapes';
import type { ViewDef } from '../def';
import { HANDS } from '../poses';
import { TORCH, weaponLight } from './light';

function buildBodkin(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0014;
  m.use(F.polymer);
  m.side(poly([[0.22, -0.02], [0.22, 0.055], [-0.36, 0.045], [-0.38, -0.015]], 0.004), 0.044, { bevel: 0.004 });
  m.use(F.barrel);
  m.at([0, 0.022, 0], null, () => m.lathe([[0.01, -0.36, 0], [0.009, -0.52, 0]], 18));
  m.use(F.steelDark);
  m.at([0, -0.055, -0.02], null, () => m.box(0.032, 0.095, 0.042, 0.004));
  m.at([0, -0.07, 0.14], null, () => m.box(0.028, 0.11, 0.052, 0.003));
  weaponLight(m, [-0.032, 0.015, -0.32], -Math.PI / 2);

  const model = new Model(m, kit.mats, { glows: { torch: TORCH } });
  model.socket('muzzle', [0, 0.022, -0.53]);
  model.socket('eject', [0, -0.024, 0.06]);
  model.hand('gripR', [0.018, -0.055, -0.02], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.support('gripL', [-0.002, -0.02, -0.26]);
  return model;
}

export function bodkinDef(kit: Kit): ViewDef {
  return {
    id: 'bodkin',
    model: buildBodkin(kit),
    pos: [0.14, -0.115, -0.36],
    rot: [0.02, 0.07, 0],
    sight: [0, 0.078, -0.28], rear: [0, 0.078, 0.02], relief: 0.75,
    recoil: { back: 0.028, lift: 0.006, pitch: 0.032, yaw: 0.004, roll: 0.008, omega: 42, zeta: 0.65 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.support },
    heatPerShot: 0.04,
    animate: () => {},
    mods: { bodkinLight: { part: 'light' } },
  };
}
