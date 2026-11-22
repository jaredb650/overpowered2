/**
 * The Billhook: semi-auto combat shotgun (Phase 0 placeholder; full SPAS-12-inspired hero model built in Lane B).
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import { poly } from '../kit/shapes';
import type { ViewDef } from '../def';
import { HANDS } from '../poses';
import { TORCH, weaponLight } from './light';

function buildBillhook(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0014;
  m.use(F.parkerized);
  m.side(poly([[0.06, -0.02], [0.06, 0.05], [-0.18, 0.05], [-0.18, -0.02]], 0.002), 0.038, { bevel: 0.0018 });
  m.use(F.barrel);
  m.at([0, 0.03, 0], null, () => m.lathe([[0.014, -0.18, 0], [0.012, -0.68, 0]], 20));
  m.use(F.steelDark);
  m.at([0, 0.0, 0], null, () => m.lathe([[0.015, -0.18, 0], [0.015, -0.64, 0]], 18));
  m.use(F.polymer);
  m.at([0, -0.055, 0.06], null, () => m.box(0.032, 0.1, 0.045, 0.004));
  m.at([0, -0.005, -0.34], null, () => m.box(0.044, 0.042, 0.22, 0.005));
  weaponLight(m, [-0.032, 0.02, -0.52], -Math.PI / 2);

  const model = new Model(m, kit.mats, { glows: { torch: TORCH } });
  model.socket('muzzle', [0, 0.03, -0.69]);
  model.socket('eject', [0.024, 0.03, -0.07]);
  model.hand('gripR', [0.018, -0.06, 0.06], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.support('gripL', [-0.002, -0.026, -0.34]);
  return model;
}

export function billhookDef(kit: Kit): ViewDef {
  return {
    id: 'billhook',
    model: buildBillhook(kit),
    pos: [0.145, -0.115, -0.39],
    rot: [0.03, 0.08, 0],
    sight: [0, 0.062, -0.65], rear: [0, 0.072, 0.04], relief: 0.78,
    recoil: { back: 0.058, lift: 0.012, pitch: 0.095, yaw: 0.012, roll: 0.025, omega: 32, zeta: 0.55 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.support },
    heatPerShot: 0.08,
    animate: () => {},
    mods: { billhookLight: { part: 'light' } },
  };
}
