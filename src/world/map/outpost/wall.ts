/**
 * The wire: the south wall with its gate and two gun towers, the Gate Yard behind them, and the rest of the perimeter. Only the south
 * side is ever seen from the ground. The other three are for the fly-in, so they cost next to nothing.
 */
import { FACE } from '../../kit/geo';
import { container, fence, signPanel } from '../../kit/props';
import { signId } from '../../kit/signs';
import { GATE, rect, type Rgb, SKY, TOWER, WALL, YARD } from './plan';
import type { Site } from './site';

const Z0 = WALL.south - WALL.half, Z1 = WALL.south + WALL.half;
const WALK_N = Z0, WALK_S = Z1 - WALL.parapet;
const RED: Rgb = [0.84, 0.18, 0.14];
/** Where the wall-walk ends on each side of the yard: past here is the ring yard, which nobody gets down from. */
const WALK_GATE = YARD.x + 1.6;

/** A stretch of south wall, with its walkway and parapet. */
function span(s: Site, a: number, b: number): void {
  s.wall({ x0: a, z0: Z0, x1: b, z1: Z1, y1: WALL.walk, outside: 'poured', tone: 0.66 });
  s.wall({ x0: a, z0: WALK_S, x1: b, z1: Z1, y0: WALL.walk, y1: WALL.h, outside: 'poured', tone: 0.66 });
  s.paintFloor('concreteDark', rect(a, WALK_N, b, WALK_S), WALL.walk + 0.006, [0.7, 0.72, 0.76], 2.4);
  s.plan.decks.push({ x0: a, z0: WALK_N, x1: b, z1: WALK_S });
}

/** Razor wire on the parapet, for the outline against the sky. It has no collider: the barrier above it is what stops a player. */
function wire(s: Site, a: number, b: number): void {
  fence(s.k, [a, Z1 - 0.3, b, Z1 - 0.3], WALL.h, 1, false);
}

/** A gun tower astride the wall. The walkway runs through its base, and the deck is on its roof. */
function gunTower(s: Site, x: number, n: 1 | 2): void {
  const g = s.k.geo;
  const h = TOWER.half, x0 = x - h, x1 = x + h, z0 = WALL.south - h, z1 = WALL.south + h;
  const deck = TOWER.deck, slab = deck - 0.4;
  s.mass('concreteDark', x0, 0, z0, x1, WALL.walk, z1, 0.66, 2.5);
  const t = 0.4, top = slab;
  const walk = { at: (WALK_N + WALK_S) / 2, w: WALK_S - WALK_N, y1: 7.6 };
  s.wall({ x0, z0, x1, z1: z0 + t, y0: WALL.walk, y1: top, outside: 'poured', tone: 0.66 });
  // The gun slit runs the whole south face, because the men inside have to see the lane.
  s.wall({ x0, z0: z1 - t, x1, z1, y0: WALL.walk, y1: top, outside: 'poured', tone: 0.66, openings: [{ at: x, w: 3.6, y0: WALL.walk + 1, y1: WALL.walk + 2.3 }] });
  s.wall({ x0, z0: z0 + t, x1: x0 + t, z1: z1 - t, y0: WALL.walk, y1: top, outside: 'poured', tone: 0.66, openings: [walk] });
  s.wall({ x0: x1 - t, z0: z0 + t, x1, z1: z1 - t, y0: WALL.walk, y1: top, outside: 'poured', tone: 0.66, openings: [walk] });
  s.mass('concreteDark', x0, slab, z0, x1, deck, z1, 0.7, 2.5);
  // Breast-high on the three sides that matter, so he can be shot from the helicopter and from the ground.
  s.wall({ x0, z0: z1 - 0.4, x1, z1, y0: deck, y1: deck + 1.1, outside: 'poured', tone: 0.7 });
  s.wall({ x0, z0: z0 + 1.6, x1: x0 + 0.4, z1: z1 - 0.4, y0: deck, y1: deck + 1.1, outside: 'poured', tone: 0.7 });
  s.wall({ x0: x1 - 0.4, z0: z0 + 1.6, x1, z1: z1 - 0.4, y0: deck, y1: deck + 1.1, outside: 'poured', tone: 0.7 });
  g.use('steelDark');
  for (const cx of [x0 + 0.2, x1 - 0.2]) for (const cz of [z0 + 0.2, z1 - 0.2]) g.box(cx, (deck + TOWER.cap) / 2, cz, 0.07, (TOWER.cap - deck) / 2, 0.07, FACE.sides);
  s.mass('steelDark', x0 - 0.3, TOWER.cap, z0 - 0.3, x1 + 0.3, TOWER.cap + 0.18, z1 + 0.3, 0.8, 2.5);
  // The ladder is what the nav's link stands for.
  g.use('steelDark');
  for (let y = WALL.walk + 0.3; y < deck; y += 0.32) g.box(x, y, z0 + t + 0.08, 0.26, 0.016, 0.016, FACE.py | FACE.ny | FACE.pz | FACE.nz);
  s.spec.jump(x - 1.6, WALL.walk, WALK_N + 0.9, x - 1.2, deck, WALL.south - 1);
  // Big enough to read from the cut, so "Tower Two" means something when he says it.
  s.words(String(n) as '1' | '2', x, 3, z1 + 0.014, 2.6, 1, RED);
  // The searchlight points down the lane the tower owns.
  g.use('steelDark').bevel(x, deck + 1.75, z1 - 1, 0.42, 0.34, 0.42, 0.05);
  g.use('emissiveWhite').box(x, deck + 1.72, z1 - 0.56, 0.28, 0.24, 0.02, FACE.pz);
  s.fill(x, deck - 1, z1 + 5, 130, 30, 'white');
  s.fill(x, WALL.walk + 1.5, WALL.south, 10, 7, 'orange');
  s.plan.blocks.push({ x0, z0, x1, z1 });
}

function cornerTower(s: Site, x: number, z: number): void {
  const h = TOWER.half;
  s.mass('concreteDark', x - h, 0, z - h, x + h, TOWER.deck, z + h, 0.62, 4);
  s.mass('steelDark', x - h - 0.3, TOWER.deck + 2.2, z - h - 0.3, x + h + 0.3, TOWER.deck + 2.4, z + h + 0.3, 0.8, 5);
  const g = s.k.geo;
  g.use('steelDark');
  for (const a of [-1, 1]) for (const b of [-1, 1]) g.box(x + a * (h - 0.2), TOWER.deck + 1.1, z + b * (h - 0.2), 0.07, 1.1, 0.07, FACE.sides);
  g.use('emissiveRed').box(x, TOWER.deck + 2.5, z, 0.14, 0.08, 0.14, FACE.all);
}

function mainGate(s: Site): void {
  const k = s.k, g = k.geo;
  const a = GATE.half, b = GATE.half + GATE.pylon, H = GATE.pylonH;
  for (const n of [-1, 1]) {
    const x0 = Math.min(n * a, n * b), x1 = Math.max(n * a, n * b);
    s.mass('concreteDark', x0, 0, Z0 - 0.5, x1, H, Z1 + 0.5, 0.74, 1.6);
    g.use('hazard').box(n * a, GATE.h / 2, WALL.south, 0.002, GATE.h / 2, WALL.half + 0.5, n > 0 ? FACE.nx : FACE.px);
    g.use('emissiveRed').box((x0 + x1) / 2, GATE.h + 0.7, Z1 + 0.52, 1, 0.09, 0.02, FACE.pz);
    k.light(n * (a + 1.5), GATE.h + 0.4, Z1 + 3, 'red', 30, 12);
    s.lamp(n * (a + 1.5), 4.6, Z1 + 0.5, 0, 'white', 0);
  }
  // Over the leaves: the lintel, and the name of the place.
  s.mass('concreteDark', -a, GATE.h, Z0, a, H, Z1, 0.74, 1.6);
  s.words('GATE', 0, 7.05, Z1 + 0.012, 1.3, 1, RED);
  s.words('NO ENTRY', 0, 7.05, Z0 - 0.012, 1.2, -1, RED);
  // The track the leaves ride, which also marks the line the mission turns on.
  for (const z of [WALL.south - 0.22, WALL.south + 0.22]) s.line(-a, z - 0.05, a, z + 0.05, [0.3, 0.32, 0.36], 0.016);
  s.fill(0, 5, Z1 + 6, 90, 24, 'white');
  s.fill(0, 4.6, Z0 - 6, 60, 18, 'white');
  s.plan.gates.push({ x: 0, z: WALL.south, yaw: Math.PI / 2, w: GATE.half * 2, bay: true });
}

function southWall(s: Site): void {
  const b = GATE.half + GATE.pylon, x = WALL.x, h = TOWER.half;
  span(s, -x, -40 - h);
  span(s, -40 + h, -b);
  span(s, b, 40 - h);
  span(s, 40 + h, x);
  gunTower(s, -40, 1);
  gunTower(s, 40, 2);
  mainGate(s);
  wire(s, -x, -40 - h);
  wire(s, -40 + h, -b);
  wire(s, b, 40 - h);
  wire(s, 40 + h, x);
  // Bullets pass, players do not: the men up here fire out over this line. The Gate is the only way through it.
  s.barrier(-x - 2, WALL.h, WALK_S, x + 2, SKY, Z1);
  s.barrier(-x - 2, GATE.pylonH, Z0, x + 2, SKY, Z1);
  for (const n of [-1, 1]) {
    const c = n * WALK_GATE;
    s.barrier(c - 0.2, WALL.walk, Z0, c + 0.2, SKY, Z1);
    fence(s.k, [c, Z0, c, WALK_S], WALL.walk, 2.2, false);
  }
  for (const lx of [-62, -22, 22, 62]) s.lamp(lx, 4.4, Z1 + 0.06, 0, 'orange', 44, 18);
  signPanel(s.k, -20, 3.4, Z1 + 0.08, 0, 5, 1.25, signId('NO ENTRY'), true);
  signPanel(s.k, 20, 3.4, Z1 + 0.08, 0, 5, 1.25, signId('NO ENTRY'), true);
}

/** Plain for the air: nobody ever stands near these. */
function outerWalls(s: Site): void {
  const x = WALL.x, n = WALL.north, h = WALL.h, t = WALL.half;
  s.mass('concreteDark', -x - t, 0, n - t, x + t, h, n + t, 0.6, 6);
  s.mass('concreteDark', -x - t, 0, n + t, -x + t, h, Z0, 0.6, 6);
  s.mass('concreteDark', x - t, 0, n + t, x + t, h, Z0, 0.6, 6);
  const g = s.k.geo;
  // The two gates that never open, for the fly-by.
  for (const c of [-x, x]) {
    g.use('steelDark').tint(0.7).slab(c, 3, -30, t + 0.1, 3, 5, 2, c > 0 ? FACE.px : FACE.nx);
    g.tint(1).use('hazard').box(c + Math.sign(c) * (t + 0.12), 5.4, -30, 0.01, 0.2, 5, c > 0 ? FACE.px : FACE.nx);
    s.fill(c + Math.sign(c) * 4, 5, -30, 20, 14, 'red');
  }
  cornerTower(s, -x, n);
  cornerTower(s, x, n);
  cornerTower(s, -x, WALL.south);
  cornerTower(s, x, WALL.south);
  for (const [px, pz] of [[-x, n], [x, n], [-x, 12], [x, 12]] as const) s.fill(px + Math.sign(-px) * 6, 7, pz + (pz < 0 ? 6 : -6), 14, 14, 'white');
  for (const [a, b] of [[-x, n], [x, n]] as const) fence(s.k, [a, b, 0, b], h, 0.8, false);
}

/** The run from the gate to the blast door is 22 m of nothing, on purpose. Everything else in here stays out of the middle of it. */
function gateYard(s: Site): void {
  const g = s.k.geo;
  const { x, north, south, wallHalf: t, h } = YARD;
  s.paintFloor('concrete', rect(-x, north, x, Z0), 0.008, [0.72, 0.74, 0.78], 2.4);
  s.plan.fills.push({ x0: -x, z0: north, x1: x, z1: Z0, rgb: [0.7, 0.72, 0.5], label: '' });
  for (const n of [-1, 1]) {
    const x0 = n > 0 ? x - t : -x - t, x1 = x0 + t * 2;
    s.wall({ x0, z0: north, x1, z1: south, y1: h, outside: 'poured', tone: 0.66 });
    s.barrier(x0, h, north, x1, SKY, south);
    // Stairs to the wall-walk, up the inside of the south wall.
    const footX = n * 26, topX = n * 16, zc = Z0 - 1.25;
    s.stairs(footX, zc, 0, topX, zc, WALL.walk, 2.5, 'concrete', true);
    const px0 = Math.min(n * 12.5, n * 16), px1 = Math.max(n * 12.5, n * 16);
    s.mass('concreteDark', px0, 0, Z0 - 2.5, px1, WALL.walk, Z0, 0.7, 2);
    s.plan.blocks.push({ x0: Math.min(footX, topX), z0: Z0 - 2.5, x1: Math.max(footX, topX), z1: Z0 });
    // A nest either side of the lane: open behind, so the men in it can be flanked from the door.
    const m = n * 14;
    s.sandbags(m - 3.6, -3.7, m + 3.6, -3, 1.2);
    s.sandbags(m - 3.6, -6.4, m - 3, -3.7, 1.2);
    s.sandbags(m + 3, -6.4, m + 3.6, -3.7, 1.2);
    s.crate(n * 24 - 1.2, -8, n * 24 + 1.2, -6, 1.3, [0.46, 0.48, 0.42]);
    s.crate(n * 22 - 1, 1, n * 22 + 1, 3.4, 1.3, [0.5, 0.46, 0.42]);
    s.fill(n * 18, 4.6, -5, 70, 20, 'white');
    s.fill(n * 20, 3.6, 7, 26, 14, 'orange');
  }
  s.fill(0, 4.4, -7, 44, 14, 'white');
  // Painted down the middle to the door: a run in a straight line is what the place wants of you.
  for (let z = -8; z < 8; z += 4) s.floorWords('CHEVRON', 0, 0, z, 0, 2.2, [0.86, 0.72, 0.16]);
  for (const sx of [-1, 1]) s.line(sx * 3 - 0.09, -12, sx * 3 + 0.09, 10, [0.86, 0.72, 0.16], 0.016);
  // The line that starts the door closing. Nothing marks it for what it is, and the eye still reads it as a threshold.
  g.use('hazard').box(0, 0.014, 9.6, 6, 0.001, 0.14, FACE.py);
  s.spec.jump(-28, 0, 3, -33, 0, 3);
  s.spec.jump(28, 0, 3, 33, 0, 3);
  s.barrier(-x, WALL.h, north - 1, x, SKY, north);
}

/** Between the citadel and the wall: seen from the door gun and nowhere else. */
function ringYard(s: Site): void {
  const k = s.k;
  for (const [x, z, yaw] of [[68, -60, 0.1], [-68, -52, -0.1], [68, -20, 1.5], [-68, -8, 1.6], [-30, -86, 0], [28, -86, 0.1]] as const) container(k, x, 0, z, yaw);
  for (const [x, z, yaw] of [[68, -44, Math.PI / 2], [-68, -36, -Math.PI / 2], [0, -86, Math.PI]] as const) k.mast(x, z, 0, 8, yaw, 'white', 44, 24);
}

export function authorWall(s: Site): void {
  southWall(s);
  outerWalls(s);
  gateYard(s);
  ringYard(s);
}
