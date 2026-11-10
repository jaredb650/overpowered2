/**
 * The Spade: a trenching shovel. A pointed steel blade, dished, with folded treads on its shoulders and a long socket
 * riveted to an ash shaft, a D grip at the top. Two hands: the right mid-shaft, the left on the D. Origin at the right
 * hand, the blade at -Z with its face up (+Y) and its edges to the sides.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import { Kind, type Finish, type Mesher } from '../kit/mesher';
import { poly } from '../kit/shapes';
import { rivet } from '../kit/details';
import type { ViewDef } from '../def';
import { HANDS } from '../poses';
import { meleeClip, type Pose } from './melee';

const SHAFT_R = 0.0165;
const SOCKET_Z = -0.5;
const BLADE_Z = -0.585;
const TIP_Z = -0.86;
const TOP_Z = 0.3;
const ASH: Finish = { color: 0x8a6a45, rough: 0.5, metal: 0, wear: 0.2, kind: Kind.wood };
const PAINT: Finish = { color: 0x2c3328, rough: 0.55, metal: 0.4, wear: 1 };
const EDGE: Finish = { color: 0x80858b, rough: 0.34, metal: 1, wear: 0.2, kind: Kind.brushed };

function shaft(m: Mesher): void {
  m.use(ASH);
  m.at([0, 0, (TOP_Z + SOCKET_Z) / 2], null, () => m.cyl(SHAFT_R, TOP_Z - SOCKET_Z, 14));
  // The D: two arms out from the shaft's top and a crossbar for the left hand.
  m.mirror(() => m.tube([[0.004, 0, TOP_Z - 0.01], [0.03, 0, TOP_Z + 0.04], [0.05, 0, TOP_Z + 0.1], [0.048, 0, TOP_Z + 0.13]], 0.0085, { seg: 8, samples: 12 }));
  m.at([0, 0, TOP_Z + 0.132], [0, Math.PI / 2, 0], () => m.cyl(0.0135, 0.1, 12));
  m.use(F.steelDark);
  m.at([0, 0, TOP_Z - 0.012], null, () => m.cyl(SHAFT_R + 0.002, 0.03, 14));
}

function head(m: Mesher): void {
  // Socket: a long steel taper riveted to the shaft.
  m.use(PAINT);
  m.lathe([[SHAFT_R + 0.0015, SOCKET_Z + 0.05, 0.002], [SHAFT_R + 0.003, SOCKET_Z - 0.03], [0.021, BLADE_Z + 0.012], [0.024, BLADE_Z, 0.002], [0, BLADE_Z, 0]], 14);
  m.mirror(() => m.at([SHAFT_R + 0.002, 0, SOCKET_Z + 0.02], [0, Math.PI / 2, 0], () => rivet(m, 0.003, F.steelDark)));
  // The blade from above, in (x, z): square shoulders, a long taper, a point.
  const outline: [number, number][] = [
    [-0.108, BLADE_Z + 0.004], [0.108, BLADE_Z + 0.004], [0.112, -0.74], [0.07, -0.82], [0, TIP_Z], [-0.07, -0.82], [-0.112, -0.74],
  ];
  // Dished: the edges rise a little above the middle, so a face catches the light as it turns.
  m.use(PAINT);
  m.at([0, 0.002, 0], null, () => m.top(poly(outline, 0.004), 0.0035, { bevel: 0.0008 }));
  m.mirror(() => m.at([0.074, 0.0055, 0], [0, 0, 0.18], () => m.top(poly([[-0.034, BLADE_Z + 0.004], [0.036, BLADE_Z + 0.004], [0.038, -0.74], [0.0, -0.8], [-0.034, -0.78]], 0.003), 0.003, { bevel: 0.0006 })));
  // Folded treads on the shoulders, for a boot.
  m.mirror(() => m.at([0.066, 0.006, BLADE_Z - 0.008], null, () => m.box(0.08, 0.008, 0.016, 0.0016)));
  // The working edge, ground bright all round the point.
  m.use(EDGE);
  m.at([0, 0.002, 0], null, () => m.top(poly([[0.112, -0.74], [0.07, -0.82], [0, TIP_Z], [-0.07, -0.82], [-0.112, -0.74], [-0.106, -0.742], [-0.066, -0.814], [0, -0.85], [0.066, -0.814], [0.106, -0.742]], 0.001), 0.0042, { bevel: 0.0005 }));
}

function buildShovel(kit: Kit): Model {
  const m = kit.mesher();
  shaft(m);
  head(m);
  const model = new Model(m, kit.mats);
  model.socket('muzzle', [0, 0, TIP_Z]);
  model.hand('gripR', [SHAFT_R + 0.0012, 0, 0], [0, 0, 1], [-0.32, -0.95, 0]);
  model.hand('gripL', [0, 0.0135, TOP_Z + 0.132], [1, 0, 0], [0, -0.3, -0.95]);
  return model;
}

// Carried across the body, blade up and to the left, the D low on the right.
const REST: Pose = [0.12, -0.24, -0.5, 0.55, 0.35, -0.25];

export function shovelDef(kit: Kit): ViewDef {
  return {
    id: 'shovel',
    model: buildShovel(kit),
    pos: [REST[0], REST[1], REST[2]],
    rot: [REST[3], REST[4], REST[5]],
    recoil: { back: 0, lift: 0, pitch: 0, yaw: 0, roll: 0, omega: 40, zeta: 0.7 },
    right: { socket: 'gripR', pose: HANDS.hilt },
    left: { socket: 'gripL', pose: HANDS.hilt },
    animate: meleeClip('shovel', {
      rest: REST,
      moves: {
        // The face, flat, right to left: drawn back over the right shoulder, then round. Sweep (-1, 0.05).
        light1: [[0.3, -0.14, -0.42, 0.45, -0.85, -1.5], [0.04, -0.18, -0.6, 0.45, 0, -1.55], [-0.28, -0.2, -0.46, 0.35, 0.85, -1.57]],
        // And back, left to right. Sweep (1, 0.05).
        light2: [[-0.26, -0.16, -0.44, 0.45, 0.85, -1.5], [0.04, -0.18, -0.6, 0.45, 0, -1.55], [0.3, -0.16, -0.44, 0.35, -0.85, -1.57]],
        // The edge: raised high, then chopped down through the crosshair, the blade turned edge on. Sweep (0.15, -1).
        heavy: [[0.12, -0.02, -0.42, 1.2, 0, -1.57], [0.08, -0.08, -0.55, 0.55, 0.05, -1.57], [0.06, -0.18, -0.52, 0.12, 0.1, -1.57]],
      },
      drawRoll: 0.8, drawDrop: 0.18,
    }),
  };
}
