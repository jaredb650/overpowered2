/**
 * The Shiv: a fighting knife. A clip-point blade with a ground bevel and a false edge, a short steel guard, a stippled
 * slab grip with a lanyard hole through the pommel. Held edge down in the right hand only. Origin at the middle of the
 * grip, the blade along -Z with its edge on -Y.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import { Kind, type Finish, type Mesher } from '../kit/mesher';
import { circle, poly } from '../kit/shapes';
import type { ViewDef } from '../def';
import { HANDS } from '../poses';
import { meleeClip, type Pose } from './melee';

const GUARD_Z = -0.058;
const TIP_Z = -0.238;
const BLADE: Finish = { color: 0x9da2a8, rough: 0.28, metal: 1, wear: 0.3, kind: Kind.brushed };
const BEVEL: Finish = { color: 0xc4c8cd, rough: 0.16, metal: 1, wear: 0.1, kind: Kind.brushed };

function blade(m: Mesher): void {
  // Side view in (z, y): the spine runs flat, then the clip falls to the point; the belly rises to meet it.
  const flat: [number, number][] = [
    [GUARD_Z - 0.004, 0.0125], [-0.19, 0.0125], [TIP_Z, -0.002], [-0.214, -0.0105], [-0.17, -0.0145], [-0.09, -0.0145], [GUARD_Z - 0.004, -0.012],
  ];
  m.use(BLADE);
  m.side(poly(flat, 0.0012), 0.0036, { bevel: 0.0007 });
  // The ground bevel along the edge, a shade brighter and thinner, both faces.
  m.use(BEVEL);
  m.mirror(() => m.at([0.0015, 0, 0], null, () => m.side(poly([
    [-0.075, -0.0062], [-0.17, -0.0068], [-0.212, -0.0045], [TIP_Z + 0.004, -0.0018], [-0.214, -0.0102], [-0.17, -0.0142], [-0.09, -0.0142], [-0.075, -0.012],
  ], 0.0008), 0.0012, { bevel: 0.0003 })));
  // False edge on the clip.
  m.mirror(() => m.at([0.0013, 0, 0], null, () => m.side(poly([[-0.19, 0.0118], [-0.2, 0.0118], [TIP_Z + 0.006, -0.0005], [-0.226, 0.0004]], 0.0006), 0.001, { bevel: 0.0002 })));
  // Thumb ramp jimping on the spine.
  m.use(F.steelDark);
  for (let i = 0; i < 6; i++) m.at([0, 0.0132, GUARD_Z - 0.008 - i * 0.0042], null, () => m.box(0.0032, 0.0016, 0.0018, 0.0003));
}

function grip(m: Mesher): void {
  m.use(F.steelDark);
  // The guard: a short double quillon.
  m.at([0, -0.003, GUARD_Z], null, () => m.box(0.012, 0.046, 0.007, 0.0016, 0.004));
  // Slab handle with a finger groove, and a stippled panel each side.
  m.use(F.polymer);
  const outline: [number, number][] = [
    [GUARD_Z + 0.004, 0.013], [0.05, 0.0132], [0.064, 0.009], [0.066, -0.01], [0.052, -0.0165], [0.012, -0.015], [-0.008, -0.019], [-0.03, -0.0145], [GUARD_Z + 0.004, -0.016],
  ];
  m.side(poly(outline, 0.003), 0.024, { bevel: 0.003, smooth: 46 });
  m.use(F.polymerStipple);
  m.mirror(() => m.at([0.0117, 0, 0], null, () => m.side(poly([[-0.045, 0.009], [0.048, 0.009], [0.052, -0.011], [-0.045, -0.011]], 0.002), 0.0016, { bevel: 0.0005 })));
  // Pommel with a lanyard hole.
  m.use(F.steelDark);
  m.at([0, -0.002, 0.068], [0, Math.PI / 2, 0], () => m.prism(poly([[-0.006, 0.012], [0.006, 0.012], [0.008, -0.013], [-0.008, -0.013]], 0.002), 0.026, {
    bevel: 0.0012, holes: [circle(0, -0.003, 0.0032, 10)],
  }));
  m.use(F.fabricDark);
  m.tube([[0, -0.006, 0.07], [0.004, -0.03, 0.078], [0.002, -0.05, 0.072]], 0.0018, { seg: 6, samples: 10 });
}

function buildKnife(kit: Kit): Model {
  const m = kit.mesher();
  blade(m);
  grip(m);
  const model = new Model(m, kit.mats);
  model.socket('muzzle', [0, 0, TIP_Z]);
  model.hand('gripR', [0.0135, -0.002, 0.004], [0, 0, 1], [-0.32, -0.95, 0]);
  return model;
}

// Edge down and a little in, held low on the right, point toward the middle of the screen.
const REST: Pose = [0.15, -0.16, -0.34, 0.6, 0.3, -0.35];

export function knifeDef(kit: Kit): ViewDef {
  return {
    id: 'knife',
    model: buildKnife(kit),
    pos: [REST[0], REST[1], REST[2]],
    rot: [REST[3], REST[4], REST[5]],
    recoil: { back: 0, lift: 0, pitch: 0, yaw: 0, roll: 0, omega: 40, zeta: 0.7 },
    right: { socket: 'gripR', pose: HANDS.hilt },
    left: null,
    animate: meleeClip('knife', {
      rest: REST,
      moves: {
        // Right to left, edge leading, a little downward. Sweep (-1, -0.25).
        light1: [[0.3, -0.06, -0.38, 0.5, -1.1, -1.4], [0.05, -0.12, -0.48, 0.45, 0, -1.45], [-0.22, -0.16, -0.4, 0.3, 1.1, -1.5]],
        // Back the other way, the wrist turned over. Sweep (1, -0.15).
        light2: [[-0.2, -0.1, -0.4, 0.45, 1.1, -0.6], [0.06, -0.12, -0.48, 0.45, 0, -0.5], [0.3, -0.08, -0.4, 0.4, -1.1, -0.45]],
        // The thrust: drawn back, then straight out along the crosshair.
        heavy: [[0.17, -0.15, -0.3, 0.6, 0.15, -0.3], [0.11, -0.12, -0.42, 0.55, 0.08, -0.25], [0.1, -0.12, -0.47, 0.55, 0.06, -0.25]],
      },
      drawRoll: 2.2, drawDrop: 0.08,
    }),
  };
}
