/**
 * The Prybar: a wrecking bar. Hexagonal steel, red enamel worn through at every edge, bare where hands and work have had it:
 * the chisel end, the claw and the bend. A wrap of cloth tape where the right hand holds it. The gooseneck rises from the
 * far end and turns back on itself into a split claw. Origin at the middle of the grip, the bar along -Z.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Finish, Mesher } from '../kit/mesher';
import { poly, type V2 } from '../kit/shapes';
import type { ViewDef } from '../def';
import { HANDS } from '../poses';
import { meleeClip, type Pose } from './melee';

const R = 0.0105;
const BEND_Z = -0.44;
const BAR_END = 0.16;
const RED: Finish = { color: 0x8c1c14, rough: 0.4, metal: 0.2, wear: 1 };
const BARE: Finish = { color: 0x6f747a, rough: 0.42, metal: 1, wear: 0.2, kind: 3 };

function hexagon(r: number): V2[] {
  const out: [number, number][] = [];
  for (let i = 0; i < 6; i++) out.push([Math.cos((i / 6) * Math.PI * 2 + Math.PI / 6) * r, Math.sin((i / 6) * Math.PI * 2 + Math.PI / 6) * r]);
  return out;
}

function bar(m: Mesher): void {
  // The straight hex stock, painted, with a little bevel so its edges catch the light and the paint wears there.
  m.use(RED);
  const len = BAR_END - BEND_Z;
  m.at([0, 0, (BAR_END + BEND_Z) / 2], null, () => m.front(hexagon(R), len, { bevel: 0.0016, smooth: 20 }));
  // Chisel end: flattened and ground to an edge, back past the hand.
  m.use(BARE);
  m.side(poly([[BAR_END - 0.004, R * 0.9], [BAR_END + 0.03, 0.004], [BAR_END + 0.05, -0.0035], [BAR_END + 0.032, -R * 0.95], [BAR_END - 0.004, -R * 0.9]], 0.0015), R * 1.9, { bevel: 0.0012 });
  // The gooseneck: up and back over itself, round where it bends, bare steel from the work.
  m.use(BARE);
  const neck: [number, number, number][] = [
    [0, 0, BEND_Z + 0.02], [0, 0.002, BEND_Z - 0.05], [0, 0.03, BEND_Z - 0.105], [0, 0.075, BEND_Z - 0.125], [0, 0.118, BEND_Z - 0.105], [0, 0.138, BEND_Z - 0.07],
  ];
  m.tube(neck, t => R * (1.02 - t * 0.1), { seg: 12, samples: 28, caps: true });
  // The claw: a flat split blade at the end of the hook, turned back toward the hand.
  m.at([0, 0.141, BEND_Z - 0.06], [-0.55, 0, 0], () => {
    m.side(poly([[0.004, 0.0075], [0.042, 0.003], [0.046, -0.002], [0.004, -0.0085]], 0.0012), 0.03, { bevel: 0.001 });
  });
  // The notch of the claw, dark so it reads as a gap.
  m.use(F.black);
  m.at([0, 0.153, BEND_Z - 0.03], [-0.55, 0, 0], () => m.box(0.0055, 0.006, 0.034, 0.0006));
}

function tape(m: Mesher): void {
  m.use(F.fabricDark);
  m.at([0, 0, 0.012], null, () => m.front(hexagon(R + 0.0022), 0.13, { bevel: 0.0022, smooth: 70 }));
  // The overlap of each turn, a thin ridge every 13 mm.
  for (let i = 0; i < 10; i++) m.at([0, 0, -0.05 + i * 0.0132], [0, 0, 0.35], () => m.front(hexagon(R + 0.0029), 0.0022, { bevel: 0.0006, smooth: 70 }));
}

function buildCrowbar(kit: Kit): Model {
  const m = kit.mesher();
  bar(m);
  tape(m);
  const model = new Model(m, kit.mats);
  model.socket('muzzle', [0, 0.14, BEND_Z - 0.03]);
  model.hand('gripR', [0.0125, 0, 0.002], [0, 0, 1], [-0.32, -0.95, 0]);
  return model;
}

// The bend up and ahead on the right, as a bar is carried.
const REST: Pose = [0.19, -0.2, -0.42, 0.75, 0.22, -0.5];

export function crowbarDef(kit: Kit): ViewDef {
  return {
    id: 'crowbar',
    model: buildCrowbar(kit),
    pos: [REST[0], REST[1], REST[2]],
    rot: [REST[3], REST[4], REST[5]],
    recoil: { back: 0, lift: 0, pitch: 0, yaw: 0, roll: 0, omega: 40, zeta: 0.7 },
    right: { socket: 'gripR', pose: HANDS.hilt },
    left: null,
    animate: meleeClip('crowbar', {
      rest: REST,
      moves: {
        // From high on the right, down across to the left. Sweep (-1, -0.35).
        light1: [[0.34, -0.06, -0.42, 0.55, -1.15, -1.35], [0.05, -0.15, -0.56, 0.5, 0, -1.45], [-0.26, -0.2, -0.46, 0.3, 1.15, -1.5]],
        // The backhand, left to right. Sweep (1, -0.25).
        light2: [[-0.24, -0.12, -0.46, 0.45, 1.15, -1.45], [0.06, -0.15, -0.56, 0.5, 0, -1.5], [0.32, -0.1, -0.44, 0.4, -1.1, -1.55]],
        // Over the top: raised behind the head, then straight down through the crosshair. Sweep (-0.15, -1).
        heavy: [[0.16, 0.02, -0.42, 1.3, -0.15, -0.2], [0.1, -0.05, -0.52, 0.6, 0.05, -0.25], [0.08, -0.14, -0.46, -0.2, 0.12, -0.3]],
      },
      drawRoll: 1.4, drawDrop: 0.12,
    }),
  };
}
