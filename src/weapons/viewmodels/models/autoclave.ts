/**
 * The Autoclave: directed microwave emitter (Phase 0 placeholder; full hero model built in Lane I).
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import { poly } from '../kit/shapes';
import type { ViewDef } from '../def';
import { HANDS } from '../poses';

function buildAutoclave(kit: Kit): Model {
  const m = kit.mesher();
  m.bevel = 0.0014;
  m.use(F.steelDark);
  m.side(poly([[0.12, -0.03], [0.12, 0.06], [-0.26, 0.06], [-0.26, -0.03]], 0.004), 0.068, { bevel: 0.003 });
  m.use(F.copper);
  m.at([0, 0.02, 0], null, () => m.lathe([[0.024, -0.26, 0], [0.048, -0.44, 0], [0.048, -0.46, 0], [0.02, -0.44, 0]], 24));
  m.use(F.polymer);
  m.at([0, -0.06, 0.04], null, () => m.box(0.034, 0.1, 0.044, 0.004));

  const model = new Model(m, kit.mats);
  model.socket('muzzle', [0, 0.02, -0.47]);
  model.hand('gripR', [0.018, -0.06, 0.04], [0, -0.96, 0.27], [-0.3, -0.25, -0.92]);
  model.support('gripL', [-0.004, -0.035, -0.18]);
  return model;
}

export function autoclaveDef(kit: Kit): ViewDef {
  return {
    id: 'autoclave',
    model: buildAutoclave(kit),
    pos: [0.155, -0.13, -0.37],
    rot: [0.02, 0.07, 0],
    recoil: { back: 0.008, lift: 0.002, pitch: 0.008, yaw: 0.003, roll: 0.004, omega: 30, zeta: 0.75 },
    right: { socket: 'gripR', pose: HANDS.grip },
    left: { socket: 'gripL', pose: HANDS.support },
    heatPerShot: 0.03,
    animate: () => {},
  };
}
