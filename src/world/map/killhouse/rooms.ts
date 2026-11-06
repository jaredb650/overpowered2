/**
 * What makes each room itself. Cover is either flush against a wall or at least 3 m clear of everything, because a gap
 * in between is exactly the kind of nook this map exists to get rid of. Each piece of cover is one or two box colliders.
 *
 * Rooms are authored in quarter frames: corners as room 1 in the north-west, halls as room 2 in the north. See plan.ts.
 * In those frames a corner has doors at north x -19.5, west z -19.5, east z -23.5 and south x -23.5. Its centre cover stands
 * taller than an eye on purpose: the two doors to each neighbouring hall and their yard doors share one 45 degree line through
 * that spot, and without it you could see from gate to gate. A hall has its ramp along the north wall from x 10 up to the pier at
 * x -5, yard doors at x -12 and 12, ring doors at x -7.4 and 7.4, and end doors at z -23.5.
 */
import { FACE, type Mat } from '../../kit/geo';
import type { Kit, LampColor } from '../../kit/kit';
import { barrier, cable, machine, pipe, truck, tyres, wallLamp } from '../../kit/props';
import { floorStencil, stencil, type StencilName } from '../../kit/stencil';
import type { MapSpec } from '../spec';
import { FACES, KH, ROOMS, type Rgb, rot, rotRect, SKIN, YARD_IN, YARD_OUT } from './plan';
import { floorLine } from './shell';

const { out: OUT, ringOut: RO, ringIn: RI, courtOut: CO } = FACES;
/** Collider faces, for cover that has to sit flush. */
const SHELL = OUT - SKIN, CORNER = RO + SKIN, HALL = RI - SKIN;
/** North edge of a hall's walkable lane, along the open side of the ramp. */
const LANE = -OUT + KH.deckW;
/** Inner edge of the cover in the north-west corner, 3 m clear of the centre cover. */
const NOOK = -22.7;
/** Centre cover of a corner room. */
const MID = -19.3, MID_HALF = 1.2;
const PAINT = 0.056;
/** Yaw of a lamp mounted on the wall on that side, looking into the room. */
const N = 0, S = Math.PI, E = -Math.PI / 2, W = Math.PI / 2;
const WORD_Y = 3.2;

class Dresser {
  /** Quarter turns of the current frame, for anything recorded in world space. */
  private turn = 0;

  constructor(readonly k: Kit, readonly spec: MapSpec) {}

  quarter(i: number, fn: () => void): void {
    this.turn = i;
    this.k.push(0, 0, 0, (-i * Math.PI) / 2);
    fn();
    this.k.pop();
    this.turn = 0;
  }

  mark(x0: number, z0: number, x1: number, z1: number): void {
    this.spec.plan!.blocks.push(rotRect(this.turn, x0, z0, x1, z1));
  }

  /** The collider and map entry for a dressed shape. */
  solid(x0: number, z0: number, x1: number, z1: number, h: number): void {
    this.k.collide((x0 + x1) / 2, h / 2, (z0 + z1) / 2, (x1 - x0) / 2, h / 2, (z1 - z0) / 2, 'concrete');
    this.mark(x0, z0, x1, z1);
  }

  pickup(x: number, z: number, y = 0.3): void {
    const [wx, wz] = rot(this.turn, x, z);
    this.spec.pickup(wx, y, wz);
  }

  barrel(x: number, z: number): void {
    const [wx, wz] = rot(this.turn, x, z);
    this.spec.barrels(wx, 0, wz, 1);
  }

  /** Room light, well clear of the walls so nothing burns out next to a lamp. */
  fill(x: number, z: number, intensity: number, radius = 14, color: LampColor | number = 'white', y = 3.4): void {
    this.k.light(x, y, z, color, intensity, radius);
  }

  lamp(x: number, z: number, yaw: number, color: LampColor = 'white', y = 3.6): void {
    wallLamp(this.k, x, y, z, yaw, color, 0);
  }

  block(mat: Mat, x0: number, z0: number, x1: number, z1: number, h: number = KH.waist, tint: Rgb = [1, 1, 1]): void {
    const g = this.k.geo;
    g.use(mat).tint(tint[0], tint[1], tint[2]);
    g.bevel((x0 + x1) / 2, h / 2, (z0 + z1) / 2, (x1 - x0) / 2, h / 2, (z1 - z0) / 2, 0.07);
    g.tint(1);
    this.solid(x0, z0, x1, z1, h);
  }

  /** Tyres packed in a rectangle, wired together. One box for the whole wall. */
  tyreWall(x0: number, z0: number, x1: number, z1: number, n: number): void {
    const nx = Math.max(1, Math.round((x1 - x0) / 1.2)), nz = Math.max(1, Math.round((z1 - z0) / 1.2));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      tyres(this.k, x0 + ((i + 0.5) / nx) * (x1 - x0), 0, z0 + ((j + 0.5) / nz) * (z1 - z0), n, false);
    }
    this.solid(x0, z0, x1, z1, n * 0.3);
  }

  /** Staggered courses of bags around a rectangle, with no collider of their own. */
  private bags(x0: number, z0: number, x1: number, z1: number, h: number): void {
    const k = this.k, g = k.geo;
    const bagL = 0.62, bagW = 0.32;
    const courses = Math.round(h / 0.17);
    const ring: [number, number, number, number, number][] = [
      [x0, z0, x1, z0, 0], [x1, z0, x1, z1, Math.PI / 2], [x1, z1, x0, z1, 0], [x0, z1, x0, z0, Math.PI / 2],
    ];
    for (let c = 0; c < courses; c++) {
      const y = (c + 0.5) * (h / courses);
      for (const [ax, az, bx, bz, yaw] of ring) {
        const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / bagL));
        for (let i = 0; i < n; i++) {
          const f = (i + (c & 1 ? 0.25 : 0.75)) / n;
          const s = k.rand(0.72, 1);
          // Bags are pulled in from the box edge, so the wobble cannot put one outside the collider.
          const px = ax + (bx - ax) * f, pz = az + (bz - az) * f;
          const inX = px + Math.sign((x0 + x1) / 2 - px) * (yaw === 0 ? 0 : bagW / 2), inZ = pz + Math.sign((z0 + z1) / 2 - pz) * (yaw === 0 ? bagW / 2 : 0);
          k.push(inX, y, inZ, yaw + k.rand(-0.04, 0.04));
          g.use('dirt').tint(s, s * 0.94, s * 0.8);
          g.bevel(0, 0, 0, bagL * 0.5, (h / courses) * 0.56, bagW / 2, 0.07);
          k.pop();
        }
      }
    }
    g.use('dirt').tint(0.8, 0.75, 0.62);
    g.slab((x0 + x1) / 2, h - 0.02, (z0 + z1) / 2, (x1 - x0) / 2 - 0.02, 0.02, (z1 - z0) / 2 - 0.02, 1, FACE.py);
    g.tint(1);
  }

  sandbags(x0: number, z0: number, x1: number, z1: number, h: number = KH.waist): void {
    this.bags(x0, z0, x1, z1, h);
    this.solid(x0, z0, x1, z1, h);
  }

  /** Steel crate with corner bands. */
  crate(x0: number, z0: number, x1: number, z1: number, h: number, tint: Rgb, y = 0): void {
    const g = this.k.geo;
    g.use('panel').tint(tint[0], tint[1], tint[2]);
    g.bevel((x0 + x1) / 2, y + h / 2, (z0 + z1) / 2, (x1 - x0) / 2, h / 2, (z1 - z0) / 2, 0.05);
    g.tint(1).use('steelDark');
    for (const cx of [x0 + 0.09, x1 - 0.09]) for (const cz of [z0 + 0.09, z1 - 0.09]) g.bevel(cx, y + h / 2, cz, 0.09, h / 2, 0.09, 0.02);
    if (y === 0) this.solid(x0, z0, x1, z1, h);
    else this.k.collide((x0 + x1) / 2, y + h / 2, (z0 + z1) / 2, (x1 - x0) / 2, h / 2, (z1 - z0) / 2, 'metal');
  }

  /** Freestanding plywood flat with a steel cap. */
  flat(x0: number, z0: number, x1: number, z1: number, h = 3): void {
    const g = this.k.geo;
    const s = this.k.rand(0.9, 1.05);
    g.use('paintWhite').tint(0.5 * s, 0.45 * s, 0.37 * s);
    g.bevel((x0 + x1) / 2, h / 2, (z0 + z1) / 2, (x1 - x0) / 2, h / 2, (z1 - z0) / 2, 0.02);
    g.tint(1).use('steelDark');
    g.bevel((x0 + x1) / 2, h + 0.03, (z0 + z1) / 2, (x1 - x0) / 2, 0.04, (z1 - z0) / 2, 0.015);
    this.solid(x0, z0, x1, z1, h);
  }

  /** Paper silhouette on a steel stand. Paper stops nothing, so it has no collider. */
  target(x: number, z: number, yaw: number, h = 1.8): void {
    const k = this.k, g = k.geo;
    k.push(x, 0, z, yaw);
    g.use('steelDark');
    for (const s of [-0.42, 0.42]) g.box(s, 0.95, 0, 0.025, 0.95, 0.025, FACE.sides);
    g.box(0, 0.06, 0, 0.62, 0.05, 0.3, FACE.noBottom);
    g.use('paintWhite').tint(0.62, 0.65, 0.68).box(0, 1.1, 0, 0.44, h * 0.5, 0.006, FACE.pz | FACE.nz);
    g.tint(1);
    stencil(k, 'TARGET', 0, 1.1, 0.012, h * 0.98, [0.04, 0.05, 0.07]);
    k.push(0, 0, 0, Math.PI);
    stencil(k, 'TARGET', 0, 1.1, 0.012, h * 0.98, [0.04, 0.05, 0.07]);
    k.pop();
    k.pop();
  }

  /** Words on a wall that runs along X at `z`, facing `dir` (+1 is south). */
  wallWords(name: StencilName, x: number, z: number, h: number, dir: number, rgb: Rgb, y = WORD_Y): void {
    const k = this.k;
    k.push(x, 0, z, dir > 0 ? 0 : Math.PI);
    stencil(k, name, 0, y, 0, h, rgb);
    k.pop();
  }

  /** Words on a wall that runs along Z at `x`, facing `dir` (+1 is east). */
  sideWords(name: StencilName, x: number, z: number, h: number, dir: number, rgb: Rgb, y = WORD_Y): void {
    const k = this.k;
    k.push(x, 0, z, dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    stencil(k, name, 0, y, 0, h, rgb);
    k.pop();
  }

  /** The room's name on the solid wall facing its main door, and its number on the floor. */
  label(room: number, name: StencilName, wordX: number, wordZ: number, dir: number, numberX: number, numberZ: number): void {
    const paint = ROOMS[room - 1]!.paint;
    this.sideWords(name, wordX, wordZ, 1, dir, paint);
    floorStencil(this.k, String(room) as StencilName, numberX, numberZ, 0, 3, paint);
  }
}

/** Corner rooms read their name off the east wall, past the door flush with the shell. */
const cornerLabel = (d: Dresser, room: number, name: StencilName) => d.label(room, name, -RO - PAINT, -18.2, -1, -22.6, -17.3);
const hallLabel = (d: Dresser, room: number, name: StencilName) => d.label(room, name, -RI + PAINT, -18.2, 1, 9, -18.4);
/** On the way between doors, never tucked behind cover. */
const cornerPickups = (d: Dresser) => { d.pickup(-17, -23.2); d.pickup(-23.2, -17.6); };

function room1Tyres(d: Dresser): void {
  d.tyreWall(-SHELL, -SHELL, NOOK, NOOK, 8);
  d.tyreWall(MID - MID_HALF, MID - MID_HALF, MID + MID_HALF, MID + MID_HALF, 6);
  cornerLabel(d, 1, 'TYRES');
  cornerPickups(d);
  d.fill(-19.8, -23.6, 40, 13, 0xbfeadf);
  d.fill(-22.8, -17, 34, 12, 0xbfeadf);
  d.lamp(-17.5, -RO - 0.06, S);
  d.lamp(-OUT + 0.06, -17, W);
}

function room2Lanes(d: Dresser): void {
  const paint = ROOMS[1]!.paint;
  d.block('concrete', -3.4, -17.5, -2.6, -CORNER, KH.waist, [0.8, 0.84, 0.9]);
  d.block('concrete', 3.6, LANE, 4.4, -19.4, KH.waist, [0.8, 0.84, 0.9]);
  for (let i = 0; i < 5; i++) d.target(13.2, -20.6 + i * 1.2, -Math.PI / 2);
  for (let i = 0; i < 3; i++) d.target(-13.3, -24.4 + i * 1.3, Math.PI / 2);
  for (let i = 0; i <= 5; i++) {
    const z = LANE + (i / 5) * (-CORNER - LANE);
    floorLine(d.k, 4.6, z - 0.04, 12.4, z + 0.04, paint);
    if (i < 5) floorStencil(d.k, String(i + 1) as StencilName, 5.6, z + (-CORNER - LANE) / 10, Math.PI / 2, 0.9, paint);
  }
  d.wallWords('LIVE FIRE', -0.4, -RO - PAINT, 1, -1, [0.86, 0.14, 0.1]);
  hallLabel(d, 2, 'LANES');
  d.barrel(-5.56, -24.9);
  d.barrel(-5.56, -23.9);
  d.pickup(-10, -21);
  d.pickup(1, -19);
  d.fill(-9.5, -20.5, 34);
  d.fill(0, -18.4, 32);
  d.fill(10, -18.6, 32);
  d.lamp(-11.8, -RO - 0.06, S);
  d.lamp(12, -RO - 0.06, S);
  d.lamp(-13.3, -OUT + 0.06, N);
}

function room3Crates(d: Dresser): void {
  d.crate(MID - MID_HALF, MID - MID_HALF, MID + MID_HALF, MID + MID_HALF, 2.4, [0.46, 0.56, 0.64]);
  d.crate(MID - 0.7, MID - 0.7, MID + 0.7, MID + 0.7, 1.2, [0.34, 0.46, 0.56], 2.4);
  d.crate(-SHELL, -SHELL, NOOK, NOOK, 3, [0.36, 0.44, 0.5]);
  cornerLabel(d, 3, 'CRATES');
  cornerPickups(d);
  d.fill(-19.8, -23.6, 34, 13, 0x9fdcff);
  d.fill(-22.8, -17, 34, 12, 0x9fdcff);
  d.lamp(-17.2, -RO - 0.06, S, 'cyan');
  d.lamp(-OUT + 0.06, -23, W, 'cyan');
}

function room4Street(d: Dresser): void {
  const k = d.k, zc = -CORNER - 1.25;
  truck(k, 0.4, 0, zc, 0);
  d.mark(-4.7, zc - 1.25, 4.7, zc + 1.25);
  barrier(k, -8.5, 0, -19.5, 0, 4);
  d.mark(-10.5, -19.82, -6.5, -19.18);
  for (let x = -13; x <= 12; x += 3.6) floorLine(k, x, -19.55, x + 2, -19.4, [0.8, 0.82, 0.86]);
  floorLine(k, -13.6, LANE + 0.4, 9.6, LANE + 0.52, [0.72, 0.74, 0.78]);
  for (let i = 0; i < 7; i++) floorLine(k, 10.8, LANE + 0.6 + i * 0.84, 13.2, LANE + 1.04 + i * 0.84, [0.72, 0.74, 0.78]);
  hallLabel(d, 4, 'STREET');
  d.pickup(-11, -17);
  d.pickup(6.8, -19);
  d.fill(-9.5, -21.5, 34, 14, 0xb8c8ff);
  d.fill(0, -19.6, 34, 14, 0xb8c8ff);
  d.fill(10, -18.6, 34, 14, 0xb8c8ff);
  d.lamp(-11.8, -RO - 0.06, S);
  d.lamp(12, -RO - 0.06, S);
}

function room5Sandbags(d: Dresser): void {
  d.sandbags(MID - 1.3, MID - 0.5, MID + 1.3, MID + 0.5, 1.7);
  d.sandbags(MID - 0.5, MID - 1.3, MID + 0.5, MID + 1.3, 1.7);
  d.sandbags(-SHELL, -SHELL, NOOK, NOOK, 1.5);
  cornerLabel(d, 5, 'SANDBAGS');
  d.barrel(-15.56, -15.56);
  d.barrel(-16.56, -15.56);
  cornerPickups(d);
  d.fill(-22.8, -22.8, 34, 13, 0xe2ecc8);
  d.fill(-17, -17, 30, 12, 0xe2ecc8);
  d.lamp(-17.5, -RO - 0.06, S);
  d.lamp(-OUT + 0.06, -17, W);
}

function room6Plywood(d: Dresser): void {
  d.flat(-3.2, -17.5, -2.8, -CORNER);
  d.flat(3.8, LANE, 4.2, -19.4);
  d.flat(-11, -19.2, -7, -18.8);
  d.target(-1.2, -17, 0);
  d.target(6.6, -20.6, Math.PI);
  d.target(11.6, -17, 0);
  d.target(-9, -16.4, 0);
  d.target(-12.8, -24.4, Math.PI / 2);
  hallLabel(d, 6, 'PLYWOOD');
  d.barrel(-5.56, -24.9);
  d.barrel(-5.56, -23.9);
  d.pickup(-10, -22);
  d.pickup(1, -19);
  d.fill(-9.5, -21.5, 34, 14, 0xd8ccff);
  // The flat throws the strip along the ring wall into shadow, and that is where an enemy would vanish.
  d.fill(-9.5, -16.6, 30, 12, 0xd8ccff);
  d.fill(0, -18.6, 34, 14, 0xd8ccff);
  d.fill(10, -18.6, 34, 14, 0xd8ccff);
  d.lamp(-11.8, -RO - 0.06, S);
  d.lamp(12, -RO - 0.06, S);
}

function room7Tiles(d: Dresser): void {
  const g = d.k.geo;
  g.use('tile').bevel(MID, KH.wallH / 2, MID, MID_HALF, KH.wallH / 2, MID_HALF, 0.04);
  d.solid(MID - MID_HALF, MID - MID_HALF, MID + MID_HALF, MID + MID_HALF, KH.wallH);
  d.block('tile', -SHELL, -SHELL, NOOK, NOOK, 0.95);
  cornerLabel(d, 7, 'TILES');
  cornerPickups(d);
  d.fill(-19.8, -23.6, 22, 12);
  d.fill(-22.8, -17, 22, 12);
  d.lamp(-17.5, -RO - 0.06, S);
  d.lamp(-OUT + 0.06, -17, W);
}

function room8Plant(d: Dresser): void {
  const k = d.k;
  machine(k, 0, 0, -CORNER - 1.05, Math.PI, 6, 2.4, 2);
  d.mark(-3.05, -CORNER - 2.1, 3.05, -CORNER);
  d.block('panel', 12, -20, HALL, -CORNER, 2.6, [0.5, 0.56, 0.62]);
  floorLine(k, -13.6, LANE + 0.4, 9.8, LANE + 0.56, [0.72, 0.62, 0.1]);
  pipe(k, [-13.9, 3.5, -15.2, 13.9, 3.5, -15.2], 0.16, 'steel', 6);
  pipe(k, [-13.9, 3.1, -15.25, 13.9, 3.1, -15.25], 0.1, 'steelDark', 7);
  cable(k, -13.9, 3.7, -21, -6, 3.7, -21, 0.7);
  cable(k, 3, 3.6, -15.6, 11, 3.6, -21.2, 0.9);
  hallLabel(d, 8, 'PLANT');
  d.barrel(-5.56, -24.9);
  d.barrel(-5.56, -23.9);
  d.pickup(-10, -19);
  d.pickup(7, -19);
  d.fill(-9.5, -21.5, 34, 14, 0xf0c8f4);
  d.fill(0, -19.6, 34, 14, 0xf0c8f4);
  d.fill(9, -18.6, 32, 14, 0xf0c8f4);
  d.lamp(-11.8, -RO - 0.06, S, 'magenta');
  d.lamp(11.6, -RO - 0.06, S, 'magenta');
}

function court(d: Dresser): void {
  const k = d.k, g = k.geo;
  const o = 4.8, s = 0.68, top = 17, h = KH.wallH;
  for (const [x, z] of [[-o, -o], [o, -o], [o, o], [-o, o]] as const) d.block('concrete', x - s, z - s, x + s, z + s, KH.waist, [0.82, 0.86, 0.92]);
  // The tower is the compass of the map: the one thing that shows over the walls from every room. Its base is as wide as
  // it is so that no line runs through two court doors and out the far side.
  d.block('concrete', -2, -2, 2, 2, h, [0.74, 0.78, 0.84]);
  k.collide(0, (h + top) / 2, 0, 0.5, (top - h) / 2, 0.5, 'metal', false);
  g.use('steelDark');
  for (const [x, z] of [[-0.42, -0.42], [0.42, -0.42], [0.42, 0.42], [-0.42, 0.42]] as const) g.box(x, (h + top) / 2, z, 0.07, (top - h) / 2, 0.07, FACE.sides);
  for (let y = h + 0.4; y < top - 1; y += 2.2) {
    k.beam(-0.42, y, -0.42, 0.42, y + 1.1, -0.42, 0.03, 0.03);
    k.beam(0.42, y, -0.42, 0.42, y + 1.1, 0.42, 0.03, 0.03);
    k.beam(0.42, y, 0.42, -0.42, y + 1.1, 0.42, 0.03, 0.03);
    k.beam(-0.42, y, 0.42, -0.42, y + 1.1, -0.42, 0.03, 0.03);
    g.use('steelDark').bevel(0, y, 0, 0.5, 0.04, 0.5, 0.01);
  }
  g.bevel(0, top, 0, 1.3, 0.12, 1.3, 0.03);
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    k.push(0, top + 0.7, 0, a);
    g.use('steelDark').bevel(0, 0, 1.1, 1.1, 0.5, 0.14, 0.03);
    g.use('emissiveWhite').box(0, 0, 1.25, 0.95, 0.38, 0.015, FACE.pz);
    k.pop();
  }
  g.use('emissiveRed').cyl(0, top + 1.4, 0, 0, top + 1.8, 0, 0.14, 0.14, 8, true, true);
  k.light(0, top - 1, 0, 0xdfe9ff, 240, 30);
  for (const [x, z] of [[0, -6.4], [6.4, 0], [0, 6.4], [-6.4, 0]] as const) d.fill(x, z, 20, 11, 0xcfe2ff);
  // The bullseye: anyone who looks down from a catwalk knows where they are.
  floorStencil(k, 'BULLSEYE', 0, 0, 0, 13.4, [0.8, 0.84, 0.92]);
  floorStencil(k, 'COURT', 0, 7.5, 0, 1.1, [0.8, 0.84, 0.92]);
}

/** One quarter of the corridor, in the north frame: chevrons walk it clockwise, so no stretch is just a stretch. */
function corridor(d: Dresser, word: StencilName): void {
  const c = (RI + CO) / 2;
  const blue: Rgb = [0.34, 0.8, 1];
  for (const x of [-12, 0, 12]) floorStencil(d.k, 'CHEVRON', x, -c, -Math.PI / 2, 1.5, blue);
  d.wallWords(word, -4.2, -CO - PAINT, 0.7, -1, blue);
  for (const x of [-12, 0, 12]) d.lamp(x, -RI + 0.06, N, 'cyan', 3.5);
  d.fill(0, -c, 16, 10, 'cyan');
  d.fill(c, -c, 22, 10);
}

/** Floodlight head bolted to the top of the perimeter wall, aimed into the yard. */
function flood(k: Kit, x: number, z: number, intensity: number, radius: number): void {
  const g = k.geo;
  k.push(x, KH.perimeterH, z, 0);
  g.use('steelDark').bevel(0, 0.7, 0, 0.1, 0.7, 0.1, 0.02);
  g.bevel(0, 1.45, 0.1, 0.9, 0.34, 0.16, 0.03);
  g.use('emissiveWhite').box(0, 1.45, 0.27, 0.78, 0.26, 0.01, FACE.pz);
  k.light(0, -1.4, 4.2, 0xd4e4ff, intensity, radius);
  k.pop();
}

/** One side of the yard, in the north frame. Perimeter T-walls either side of the gate, and one off the shell in front of it. */
function yard(d: Dresser): void {
  const k = d.k;
  const P = YARD_OUT - SKIN, B = YARD_IN + SKIN, reach = (P - B) / 2 + 0.06, H = 3.6, t = 0.5;
  const concrete: Rgb = [0.74, 0.78, 0.84];
  for (const x of [-13, 13]) d.block('concrete', x - t, -P, x + t, -P + reach, H, concrete);
  // A straight line can thread two T-walls but never three, which caps how far you see down a side.
  d.block('concrete', -t, -B - reach, t, -B, H, concrete);
  d.wallWords('GATE', 0, -B - reach - 0.03, 0.42, -1, [0.84, 0.18, 0.14], 2.4);
  for (const x of [-20, 20]) flood(k, x, -KH.perimeter, 88, 22);
  d.fill(0, -31, 26, 12, 0xd4e4ff, 3.2);
  d.fill(28, -28, 34, 13, 0xd4e4ff, 4.6);
  d.pickup(-6, -28.6);
}

/**
 * The map items take every fourth spot in the list, alternating mega health and heavy armour, so spots 0, 8 and 16 hold
 * the megas. Those go on the catwalks, which is what makes the climb worth it under fire.
 */
function deckPickups(spec: MapSpec): void {
  const R = KH.ring, y = KH.deck + 0.3;
  [[-R, -R], [R, R], [-R, R]].forEach(([x, z], i) => {
    spec.pickup(x!, y, z!);
    spec.pickupSpots.splice(i * 8, 0, spec.pickupSpots.pop()!);
  });
}

export function authorRooms(k: Kit, spec: MapSpec): void {
  const d = new Dresser(k, spec);
  court(d);
  for (const [x, z] of [[-4, 7], [4, -7], [-7, -4], [7, 4]] as const) d.pickup(x, z);
  d.quarter(0, () => { room1Tyres(d); room2Lanes(d); corridor(d, 'CLEAR LEFT'); yard(d); });
  d.quarter(1, () => { room3Crates(d); room4Street(d); corridor(d, 'KEEP MOVING'); yard(d); });
  d.quarter(2, () => { room5Sandbags(d); room6Plywood(d); corridor(d, 'CLEAR RIGHT'); yard(d); });
  d.quarter(3, () => { room7Tiles(d); room8Plant(d); corridor(d, 'EYES UP'); yard(d); });
  deckPickups(spec);
}

