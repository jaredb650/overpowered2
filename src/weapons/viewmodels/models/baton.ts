/**
 * The Cosh: a telescopic baton. A ribbed rubber grip with a steel end cap, three blackened steel tubes, each narrower, and
 * a ball tip. It comes out closed and is flicked open on the draw: the two outer tubes are parts that slide out. Origin
 * at the middle of the grip, the shaft along -Z.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import type { Finish, Mesher } from '../kit/mesher';
import { seg } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';
import { meleeClip, type Pose } from './melee';

const GRIP_R = 0.0135;
const GRIP_FRONT = -0.062;
const GRIP_BACK = 0.09;
/** Each tube: radius and length. The next one is pulled out of the front of the one before. */
const TUBES: readonly (readonly [number, number])[] = [[0.0098, 0.16], [0.0081, 0.15], [0.0066, 0.13]];
const STEEL: Finish = { color: 0x2a2d31, rough: 0.3, metal: 1, wear: 0.4, kind: 3 };

function grip(m: Mesher): void {
  m.use(F.rubber);
  m.at([0, 0, (GRIP_FRONT + GRIP_BACK) / 2], null, () => m.cyl(GRIP_R, GRIP_BACK - GRIP_FRONT, 16, 0.002));
  // Rings moulded into the rubber.
  for (let i = 0; i < 9; i++) m.at([0, 0, GRIP_FRONT + 0.016 + i * 0.015], null, () => m.cyl(GRIP_R + 0.0012, 0.004, 16, 0.0012));
  m.use(F.steelDark);
  m.lathe([[0, GRIP_BACK + 0.016, 0], [0.011, GRIP_BACK + 0.015, 0.002], [GRIP_R + 0.001, GRIP_BACK + 0.004], [GRIP_R + 0.001, GRIP_BACK - 0.004], [0, GRIP_BACK - 0.004, 0]], 16);
  m.lathe([[0, GRIP_FRONT + 0.004, 0], [GRIP_R + 0.0008, GRIP_FRONT + 0.004], [GRIP_R - 0.001, GRIP_FRONT - 0.006, 0.002], [0, GRIP_FRONT - 0.006, 0]], 16);
}

/** Where each tube starts, open: the first out of the grip, each next one out of the front of the last. */
function tubeStart(i: number): number {
  let z = GRIP_FRONT - 0.006;
  for (let k = 0; k < i; k++) z -= TUBES[k]![1] - 0.012;
  return z;
}

function tubes(m: Mesher): void {
  m.use(STEEL);
  const [r0, l0] = TUBES[0]!;
  m.at([0, 0, tubeStart(0) - l0 / 2 + 0.03], null, () => m.cyl(r0, l0, 14));
  for (let i = 1; i < TUBES.length; i++) {
    const [r, l] = TUBES[i]!;
    const z = tubeStart(i);
    m.part(`tube${i}`, [0, 0, z], () => {
      m.use(STEEL);
      m.at([0, 0, -l / 2], null, () => m.cyl(r, l, 14));
      // A collar where it locks into the tube behind.
      m.use(F.steelDark);
      m.at([0, 0, -0.004], null, () => m.cyl(r + 0.0012, 0.006, 14));
      if (i === TUBES.length - 1) {
        m.use(F.steel);
        m.at([0, 0, -l - 0.004], null, () => m.lathe([[0, 0.006, 0], [0.007, 0.004], [0.0105, -0.004], [0.007, -0.012], [0, -0.014, 0]], 14));
      }
    });
  }
}

function buildBaton(kit: Kit): Model {
  const m = kit.mesher();
  grip(m);
  tubes(m);
  const model = new Model(m, kit.mats);
  model.socket('muzzle', [0, 0, tubeStart(TUBES.length - 1) - TUBES[TUBES.length - 1]![1]]);
  model.hand('gripR', [GRIP_R + 0.001, 0, 0.004], [0, 0, 1], [-0.32, -0.95, 0]);
  return model;
}

/** Closed, each moving tube sits inside the one before: back by its own run. */
function openTubes(a: Anim): void {
  // Flicked open in the first half of the draw, the last tube a beat after the second.
  const open1 = a.draw < 1 ? seg(a.draw, 0.15, 0.5) : 1;
  const open2 = a.draw < 1 ? seg(a.draw, 0.25, 0.6) : 1;
  const t1 = a.parts.tube1;
  const t2 = a.parts.tube2;
  const run1 = TUBES[0]![1] - 0.02;
  const run2 = run1 + TUBES[1]![1] - 0.02;
  if (t1) t1.position.z += (1 - open1) * run1;
  if (t2) t2.position.z += (1 - open2) * run2;
}

// Up and ahead on the right, as the bar is.
const REST: Pose = [0.19, -0.2, -0.42, 0.75, 0.22, -0.5];

export function batonDef(kit: Kit): ViewDef {
  return {
    id: 'baton',
    model: buildBaton(kit),
    pos: [REST[0], REST[1], REST[2]],
    rot: [REST[3], REST[4], REST[5]],
    recoil: { back: 0, lift: 0, pitch: 0, yaw: 0, roll: 0, omega: 40, zeta: 0.7 },
    right: { socket: 'gripR', pose: HANDS.hilt },
    left: null,
    animate: meleeClip('baton', {
      rest: REST,
      moves: {
        // Forehand, right to left and down. Sweep (-1, -0.45).
        light1: [[0.34, -0.06, -0.42, 0.55, -1.15, -1.35], [0.05, -0.15, -0.56, 0.5, 0, -1.45], [-0.26, -0.2, -0.46, 0.3, 1.15, -1.5]],
        // Backhand. Sweep (1, -0.35).
        light2: [[-0.24, -0.12, -0.46, 0.45, 1.15, -1.45], [0.06, -0.15, -0.56, 0.5, 0, -1.5], [0.32, -0.1, -0.44, 0.4, -1.1, -1.55]],
        // The third, straight down. Sweep (-0.2, -1).
        light3: [[0.16, 0.02, -0.42, 1.3, -0.15, -0.2], [0.1, -0.05, -0.52, 0.6, 0.05, -0.25], [0.08, -0.14, -0.46, -0.2, 0.12, -0.3]],
        // A jab with the tip.
        heavy: [[0.17, -0.16, -0.3, 0.45, 0.12, -0.3], [0.1, -0.12, -0.48, 0.3, 0.05, -0.2], [0.08, -0.11, -0.56, 0.25, 0.02, -0.2]],
      },
      drawRoll: 1.2, drawDrop: 0.1,
      after: openTubes,
    }),
  };
}
