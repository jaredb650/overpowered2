/**
 * The Gaff: shoulder-fired harpoon cannon (Phase 0 placeholder; full hero model built in Lane J).
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import { poly } from '../kit/shapes';
import type { ViewDef } from '../def';
import { HANDS } from '../poses';

function buildGaff(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0014;
  m.use(F.parkerized);
  m.side(poly([[0.18, -0.03], [0.18, 0.055], [-0.42, 0.05], [-0.42, -0.025]], 0.003), 0.054, { bevel: 0.003 });
  m.use(F.steel);
  m.at([0, 0.022, 0], null, () => m.lathe([[0.011, -0.35, 0], [0.011, -0.68, 0], [0.026, -0.71, 0], [0.002, -0.82, 0]], 16));
  m.use(F.brass);
  m.at([0, -0.05, -0.22], [0, 0, Math.PI / 2], () => m.cyl(0.032, 0.06, 18));
  m.use(F.polymer);
  m.at([0, -0.065, 0.02], null, () => m.box(0.034, 0.1, 0.044, 0.004));

  const model = new Model(m, kit.mats);
  model.socket('muzzle', [0, 0.022, -0.82]);
  model.hand('gripR', [0.018, -0.065, 0.02], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.support('gripL', [-0.004, -0.035, -0.34]);
  return model;
}

export function gaffDef(kit: Kit): ViewDef {
  return {
    id: 'gaff',
    model: buildGaff(kit),
    pos: [0.16, -0.125, -0.38],
    rot: [0.02, 0.07, 0],
    recoil: { back: 0.072, lift: 0.016, pitch: 0.11, yaw: 0.012, roll: 0.02, omega: 26, zeta: 0.52 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.support },
    heatPerShot: 0.06,
    animate: () => {},
  };
}
