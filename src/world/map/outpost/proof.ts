/**
 * Proof sheet for the Outpost, on the real physics world and the real Player. The static half measures what the mission needs of the
 * map: a floor under every mark, nav everywhere, clear roads, cover for the men. The bots then play every parkour lesson on the
 * geometry itself, because parkour.test.ts proves the numbers on bare boxes and a map can break a number without changing it.
 */
import * as THREE from 'three';
import { CG, type Action, type Ctx, type InputSystem, type PhysicsSystem, type PlayerSystem } from '../../../core/contracts';
import { Doors } from '../../../campaign/doors';
import { DOORS, MARKS, ROUTES, ZONES } from '../../../campaign/missions/outpost.places';
import { PARKOUR } from '../../../campaign/parkour';
import { CoverMap } from '../../../enemies/outpost/cover';
import { Route, RouteFinder, type NavGrid } from '../../../enemies/outpost/routes';
import type { World } from '../../World';
import { COOLANT, GALLERY } from './plan';

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface Rig {
  player: PlayerSystem & { reset(): void; teleport(p: THREE.Vector3, yaw: number): void; grounded: boolean; wallRunning: boolean; sensitivity: number; yaw: number; speed: number; dashCharges: number; dashing: boolean; isPenetrating(): boolean };
  input: InputSystem & { simulate(a: Action, down: boolean): void; simulateLook(dx: number, dy: number): void; consumeLook(): unknown };
  ctx: Ctx;
  step(): void;
}

export const rigOf = (game: { player: unknown; input: unknown; frame(dt: number): void; ctx: Ctx }): Rig => ({
  player: game.player as Rig['player'],
  input: game.input as Rig['input'],
  ctx: game.ctx,
  step: () => {
    game.frame(1 / 60);
    (game.ctx.physics as unknown as { flushQueries?(): void }).flushQueries?.();
  },
});

/** Sky marks and what runs on rails or in the air have no floor. */
const AIRBORNE = /^(fly\d+|sky)/;

export function verifyOutpost(world: World, physics: PhysicsSystem) {
  const nav = world.navGraph;

  const shapes: Record<string, number> = {};
  physics.world.forEachCollider(c => { const t = c.shapeType() === 1 ? 'box' : `other:${c.shapeType()}`; shapes[t] = (shapes[t] ?? 0) + 1; });
  const levels: Record<string, number> = {};
  for (let i = 0; i < nav.nodeCount; i++) {
    if (Math.abs(nav.slopeX[i]!) + Math.abs(nav.slopeZ[i]!) > 0.05) { levels.slope = (levels.slope ?? 0) + 1; continue; }
    const key = nav.py[i]!.toFixed(1);
    levels[key] = (levels[key] ?? 0) + 1;
  }

  const noFloor: string[] = [], offNav: string[] = [], buried: string[] = [];
  const near = new THREE.Vector3();
  for (const [id, m] of Object.entries(MARKS)) {
    if (AIRBORNE.test(id)) continue;
    const [x, y, z] = m.at;
    _o.set(x, y + 1.2, z);
    const hit = physics.raycast(_o, DOWN, 2.4, CG.World);
    if (!hit) { noFloor.push(`${id} [${m.at}]`); continue; }
    if (Math.abs(hit.point.y - y) > 0.08) noFloor.push(`${id} floor at ${r2(hit.point.y)}, mark at ${y}`);
    _o.set(x, y + 0.9, z);
    if (physics.sweepCapsule(_o, 0.4, 0.45, _d.set(0, 0.01, 0), CG.World)) buried.push(id);
    // The wreck's deck and the pump roof are places to find things, not places men walk.
    if (!nav.nearest(_o.set(x, y + 0.1, z), 1.6, near) && !/rack|roof|wreck/i.test(id)) offNav.push(id);
  }

  // A door must stand in a real gap, or its collider and its route-graph entry mean nothing.
  const doors: Record<string, { width: number; want: number; head: number; wantHead: number; blocked: boolean; navFront: boolean; navBack: boolean }> = {};
  for (const [id, d] of Object.entries(DOORS)) {
    const across = new THREE.Vector3(Math.cos(d.yaw), 0, -Math.sin(d.yaw));
    const through = new THREE.Vector3(-Math.sin(d.yaw), 0, -Math.cos(d.yaw));
    const [x, y, z] = d.at;
    _o.set(x, y + 1, z);
    const a = physics.raycast(_o, across, 30, CG.World)?.distance ?? 30;
    const b = physics.raycast(_o, _d.copy(across).negate(), 30, CG.World)?.distance ?? 30;
    const up = physics.raycast(_o, _d.set(0, 1, 0), 30, CG.World)?.distance ?? 30;
    const f = physics.raycast(_o, through, 1.5, CG.World)?.distance ?? null;
    const g = physics.raycast(_o, _d.copy(through).negate(), 1.5, CG.World)?.distance ?? null;
    doors[id] = { width: r2(a + b), want: d.width, head: r2(up + 1), wantHead: d.height, blocked: [f, g].some(v => v !== null), navFront: !!nav.nearest(_o.set(x + through.x * 2, y + 0.1, z + through.z * 2), 1.5, near), navBack: !!nav.nearest(_o.set(x - through.x * 2, y + 0.1, z - through.z * 2), 1.5, near) };
  }

  // Every ground route, swept at a tank's width and height.
  const blocked: string[] = [];
  for (const [id, route] of Object.entries(ROUTES)) {
    if (id === 'insertion' || id === 'chopper') continue;
    for (let i = 0; i + 1 < route.length; i++) {
      const a = MARKS[route[i]!]!.at, b = MARKS[route[i + 1]!]!.at;
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const ux = (b[0] - a[0]) / len, uz = (b[2] - a[2]) / len;
      for (const off of [-1.9, 0, 1.9]) for (const h of [0.5, 2.4]) {
        _o.set(a[0] - uz * off, h, a[2] + ux * off);
        const hit = physics.raycast(_o, _d.set(ux, 0, uz), len, CG.World);
        if (hit) blocked.push(`${id} ${route[i]}->${route[i + 1]} off ${off} h ${h} at ${r2(hit.distance)}`);
      }
    }
  }

  // Each mark on one graph: the nav keeps a node only if it joins the hub both ways, so a mark on the graph is a mark that connects.
  const hub = new THREE.Vector3(0, 0.1, 50);
  nav.setTarget(hub);
  nav.settle();
  const noRoute: string[] = [];
  for (const [id, m] of Object.entries(MARKS)) {
    if (AIRBORNE.test(id) || /rack|roof|wreckDeck/i.test(id)) continue;
    const tr = nav.trace(_o.set(m.at[0], m.at[1] + 0.1, m.at[2]));
    if (!tr.ok) noRoute.push(id);
  }

  // The apron's lesson is that a man up there can see you. From each tower's mark, the share of its lane he can put a round into, by
  // how far out: a body at chest height, with cover in the way counted as cover.
  const lanes: Record<string, Record<string, number>> = {};
  for (const [name, tower, x0, x1] of [['Tower One, West Lane', 'towerOne', -60, -20], ['Tower Two, East Lane', 'towerTwo', 20, 60]] as const) {
    const [tx, ty, tz] = MARKS[tower]!.at;
    const bands: Record<string, number> = {};
    for (const [lo, hi] of [[14, 25], [25, 40], [40, 60], [60, 80]] as const) {
      let seen = 0, tried = 0;
      for (let z = tz + lo; z < tz + hi; z += 2) for (let x = x0; x <= x1; x += 4) {
        _o.set(tx, ty + 1.6, tz);
        _d.set(x - tx, 1.2 - _o.y, z - tz);
        const len = _d.length();
        _d.divideScalar(len);
        if (physics.raycast(_o.set(x, 1.2, z), _d.clone().negate(), 0.01, CG.World)) continue;
        tried++;
        _o.set(tx, ty + 1.6, tz);
        if (!physics.raycast(_o, _d, len, CG.World)) seen++;
      }
      bands[`${lo}-${hi} m`] = tried ? r2(seen / tried) : 0;
    }
    lanes[name] = bands;
  }

  // A trigger nobody can stand in never fires.
  const dead: string[] = [];
  for (const [id, z] of Object.entries(ZONES)) {
    let floors = 0;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      const x = z.min[0] + ((z.max[0] - z.min[0]) * (i + 0.5)) / 5, zz = z.min[2] + ((z.max[2] - z.min[2]) * (j + 0.5)) / 5;
      const hit = physics.raycast(_o.set(x, z.max[1], zz), DOWN, z.max[1] - z.min[1], CG.World);
      if (hit && hit.point.y > z.min[1]) floors++;
    }
    if (floors === 0) dead.push(id);
  }

  // Cover is derived from the map at load, so the census is the same thing the men will use.
  const cover = new CoverMap(physics);
  cover.build(nav as unknown as NavGrid);
  const byZone: Record<string, number> = {};
  for (const spot of cover.spots) {
    const id = world.zoneAt(spot.position)?.name ?? 'nowhere';
    byZone[id] = (byZone[id] ?? 0) + 1;
  }
  return {
    colliders: shapes,
    nav: { nodes: nav.nodeCount, levels },
    marks: { noFloor, offNav, buried },
    doors,
    roads: { roads: world.spec.roads.map(r => r.id), blocked },
    flow: { noRoute },
    zones: { dead },
    cover: { spots: cover.spots.length, byZone },
    lanes,
  };
}

// -------------------------------------------------------------------------------------------------
// The lessons, played. Each check holds forward and presses keys the way parkour.test.ts does, on the map itself.
// -------------------------------------------------------------------------------------------------

const DT = 1 / 60;
const ALL: readonly Action[] = ['forward', 'back', 'left', 'right', 'jump', 'dash', 'slide'];
const NORTH = 0, EAST = -Math.PI / 2, SOUTH = Math.PI, WEST = Math.PI / 2;
type Schedule = readonly (readonly [number, Action])[];

const times = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let t = from; t <= to + 1e-9; t += step) out.push(t);
  return out;
};
const DOUBLES: readonly Schedule[] = times(0.1, 0.62, 0.04).map(a => [[a, 'jump']] as const);
const ONE_DASH: readonly Schedule[] = times(0.1, 0.62, 0.08).flatMap(a => times(0, 0.7, 0.1).map(b => [[a, 'jump'], [a + b, 'dash']] as const));
const TWO_DASHES: readonly Schedule[] = times(0.1, 0.62, 0.08).flatMap(a => times(0, 0.7, 0.14).flatMap(b => times(0.13, 0.5, 0.12).map(c => [[a, 'jump'], [a + b, 'dash'], [a + b + c, 'dash']] as const)));
/** Everything a body can press at a wall: a kick, a double jump after it, and a dash on top. */
const CLIMBS: readonly Schedule[] = times(0.08, 0.6, 0.06).flatMap(a => times(0.05, 0.5, 0.09).flatMap(b => [
  [[a, 'jump'], [a + b, 'jump']] as const,
  [[a, 'jump'], [a + b, 'jump'], [a + b + 0.1, 'dash']] as const,
  [[a, 'dash'], [a + b, 'jump']] as const,
]));

class Bot {
  /** Called once a frame after the player, for anything that moves under them. */
  onFrame: (() => void) | null = null;

  constructor(readonly rig: Rig) {}

  get p() {
    return this.rig.player;
  }

  frame(): void {
    this.rig.step();
    this.onFrame?.();
  }

  frames(n: number): void {
    for (let i = 0; i < n; i++) this.frame();
  }

  place(x: number, y: number, z: number, yaw: number): void {
    const { input, player } = this.rig;
    for (const a of ALL) input.simulate(a, false);
    input.consumeLook();
    player.reset();
    player.teleport(new THREE.Vector3(x, y + 0.05, z), yaw);
    this.frames(4);
  }

  tap(a: Action): void {
    this.rig.input.simulate(a, true);
    this.frame();
    this.rig.input.simulate(a, false);
  }

  hold(a: Action, down = true): void {
    this.rig.input.simulate(a, down);
  }

  look(radians: number): void {
    this.rig.input.simulateLook(-radians / this.p.sensitivity, 0);
  }

  /** Frames until `done`, with a limit, because a body stopped by a wall would otherwise hold the run for ever. */
  until(done: () => boolean, seconds = 6): boolean {
    for (let t = 0; t < seconds; t += DT) {
      if (done()) return true;
      this.frame();
    }
    return done();
  }

  /** Runs in from (x, y, z) until `at()`, jumps, presses `schedule`, and waits to land. */
  fly(x: number, y: number, z: number, yaw: number, at: () => boolean, schedule: Schedule): void {
    this.place(x, y, z, yaw);
    this.hold('forward');
    this.until(at);
    this.tap('jump');
    const plan = [...schedule].sort((a, b) => a[0] - b[0]);
    for (let t = 0; t < 4; t += DT) {
      while (plan.length > 0 && plan[0]![0] <= t) this.tap(plan.shift()![1]);
      this.frame();
      if (this.p.grounded && t > 0.2) break;
    }
    this.until(() => this.p.grounded, 1.5);
    this.hold('forward', false);
  }

  anyTiming(test: () => boolean, x: number, y: number, z: number, yaw: number, at: () => boolean, sets: readonly Schedule[]): boolean {
    for (const set of sets) {
      this.fly(x, y, z, yaw, at, set);
      if (test()) return true;
    }
    return false;
  }
}

function mantleLesson(b: Bot) {
  const out: Record<string, boolean> = {};
  const p = () => b.p.position;
  const walls = [
    ['north', -32, 80, NORTH, () => p().z < 75, () => p().y > -0.3 && p().z < 73.5],
    ['south', -32, 92, SOUTH, () => p().z > 97, () => p().y > -0.3 && p().z > 98.5],
    ['west', -40, 86, WEST, () => p().x < -47, () => p().y > -0.3 && p().x < -48.5],
    ['east', -22, 95, EAST, () => p().x > -17, () => p().y > -0.3 && p().x > -15.5],
  ] as const;
  for (const [name, x, z, yaw, at, won] of walls) {
    b.fly(x, -3, z, yaw, at, []);
    b.hold('forward');
    b.frames(30);
    b.hold('forward', false);
    out[`climbs ${name} wall on one jump`] = won();
  }
  b.place(-32, -3, 80, NORTH);
  b.hold('forward');
  b.frames(120);
  b.hold('forward', false);
  out['running at it lifts nobody'] = p().y < -2.7;
  b.place(-20, -3, 86, EAST);
  b.hold('forward');
  b.frames(180);
  b.hold('forward', false);
  out['the blocked ramp stops a run'] = p().x < -9 && p().y < -0.2;
  return out;
}

function doubleJumpLesson(b: Bot) {
  const out: Record<string, boolean> = {};
  const p = () => b.p.position;
  const top = () => p().y > 3.9;
  const sides = [
    ['north', 84, 72, SOUTH, () => p().z > 72 + 2, 79.3],
    ['west', 66, 84, EAST, () => p().x > 66 + 2, 73.3],
  ] as const;
  let oneJump = false;
  for (const [, x, z, yaw] of sides) {
    for (const takeoff of [1.2, 2, 3, 4]) {
      const hull = yaw === SOUTH ? () => p().z > 80 - takeoff : () => p().x > 74 - takeoff;
      b.fly(x, 0, z, yaw, hull, []);
      b.hold('forward');
      b.frames(40);
      b.hold('forward', false);
      oneJump ||= top();
    }
  }
  out['one jump never reaches the deck'] = !oneJump;
  for (const [name, x, z, yaw, , stand] of sides) {
    let made = 0;
    for (const wait of [0.1, 0.2, 0.3, 0.4]) {
      if (yaw === SOUTH) b.place(x, 0, stand, yaw);
      else b.place(stand, 0, z, yaw);
      b.tap('jump');
      b.frames(Math.round(wait / DT));
      b.hold('forward');
      b.tap('jump');
      if (b.until(top, 1.2)) made++;
      b.hold('forward', false);
    }
    out[`two jumps from a stand at the ${name} side`] = made === 4;
  }
  return out;
}

function roofLessons(b: Bot) {
  const out: Record<string, boolean> = {};
  const p = () => b.p.position;
  b.fly(-60, 0, 62, NORTH, () => p().z < 57, []);
  b.hold('forward');
  b.frames(30);
  b.hold('forward', false);
  out['the pump house roof takes a mantle'] = p().y > 3.3;
  b.fly(21, 0, 38, NORTH, () => p().z < 30, []);
  b.hold('forward');
  b.frames(30);
  b.hold('forward', false);
  out['the guardhouse roof takes a mantle'] = p().y > 3.1;
  return out;
}

function dashLesson(b: Bot) {
  const out: Record<string, boolean> = {};
  const { farLip, nearLip } = COOLANT;
  const p = () => b.p.position;
  const across = () => p().y > -0.3 && p().z < farLip;
  const lip = () => p().z < nearLip + 0.15;
  for (const x of [-34, -35.4, -32.6]) {
    out[`double jump falls short from x ${x}`] = !b.anyTiming(across, x, 0, -41.6, NORTH, lip, DOUBLES);
    let made = 0;
    for (const set of ONE_DASH) {
      b.fly(x, 0, -41.6, NORTH, lip, set);
      if (across()) made++;
    }
    out[`double jump and a dash crosses from x ${x} (${made} of ${ONE_DASH.length} timings)`] = made > 0;
  }
  // The way back: a fall costs a walk.
  b.place(-54, COOLANT.pit, -59, SOUTH);
  b.hold('forward');
  b.until(() => p().z > -48.2, 4);
  b.rig.player.yaw = EAST;
  const up = b.until(() => p().y > -0.2, 6);
  b.hold('forward', false);
  out['the pit stairs lead back to the near platform'] = up;
  return out;
}

/** Runs in a little off the wall, turns into it, jumps `from` metres before the lip, and leaves the wall with a jump and a jump. */
function wallRun(b: Bot, from: number, turn: number, kickAfter: number | null, thenJump: boolean): boolean {
  const { nearLip, farLip, nearEnd, north, floor } = GALLERY;
  const p = b.p;
  b.place(nearEnd + 0.6, floor, north + 2.2, EAST);
  b.hold('forward');
  b.until(() => p.position.x > nearLip - from - 3);
  b.look(turn);
  b.until(() => p.position.x > nearLip - from);
  b.tap('jump');
  for (let t = 0; t < 1.5 && !p.wallRunning; t += DT) {
    b.frame();
    if (p.grounded && t > 0.2) break;
  }
  if (!p.wallRunning) { b.hold('forward', false); return false; }
  b.look(-turn);
  let kicked = false;
  for (let t = 0; t < 3 && !p.grounded; t += DT) {
    if (kickAfter !== null && !kicked && t >= kickAfter && p.wallRunning) {
      b.look(-0.35);
      b.frame();
      b.tap('jump');
      kicked = true;
      if (thenJump) {
        b.frames(15);
        b.tap('jump');
      }
    }
    b.frame();
  }
  b.until(() => p.grounded, 1);
  b.hold('forward', false);
  return p.position.x > farLip && p.position.y > floor - 0.3;
}

function wallRunLesson(b: Bot) {
  const out: Record<string, boolean> = {};
  const { nearLip, farLip, nearEnd, floor } = GALLERY;
  const p = () => b.p.position;
  const across = () => p().x > farLip && p().y > floor - 0.3;
  const lip = () => p().x > nearLip - 0.15;
  const z = -74.5;
  out['no jump crosses'] = !b.anyTiming(across, nearEnd + 0.6, floor, z, EAST, lip, DOUBLES);
  out['no jump and dash crosses'] = !b.anyTiming(across, nearEnd + 0.6, floor, z, EAST, lip, ONE_DASH);
  out['no jump and two dashes crosses'] = !b.anyTiming(across, nearEnd + 0.6, floor, z, EAST, lip, TWO_DASHES);
  let made = 0, tried = 0;
  for (const from of [0.5, 2, 4, 6, 8]) for (const turn of [0.3, 0.4]) {
    tried++;
    if (wallRun(b, from, turn, 1.3, true)) made++;
  }
  out[`wall run, jump, jump crosses (${made} of ${tried})`] = made === tried;
  let leaves = 0;
  for (const leave of [0.9, 1.1, 1.3, 1.5]) if (wallRun(b, 4, 0.3, leave, true)) leaves++;
  out[`forgives the moment of leaving (${leaves} of 4)`] = leaves >= 3;
  // From the bottom, the near stairs are the way out and the far deck is not.
  b.place(0, GALLERY.trench, -75, WEST);
  const up = b.until(() => {
    b.hold('forward');
    b.rig.player.yaw = p().x > 3.5 || p().z < -73.2 ? Math.atan2(-(-72.5 - p().z), 3 - p().x) + Math.PI / 2 + Math.PI : WEST;
    return p().y > floor - 0.2;
  }, 10);
  b.hold('forward', false);
  out['the trench stairs lead back to the near deck'] = up && p().x < nearLip + 1;
  return out;
}

/** What a very good player can do at a wall, from a run: the height reached, and whether they got over `past`. */
function climbTest(b: Bot, x: number, y: number, z: number, yaw: number, wall: () => boolean, past: () => boolean, sets = CLIMBS) {
  let top = -Infinity, over = false;
  for (const set of sets) {
    b.place(x, y, z, yaw);
    b.hold('forward');
    b.until(wall, 2);
    b.tap('jump');
    const plan = [...set].sort((a, c) => a[0] - c[0]);
    for (let t = 0; t < 1.6; t += DT) {
      while (plan.length > 0 && plan[0]![0] <= t) b.tap(plan.shift()![1]);
      b.frame();
      top = Math.max(top, b.p.position.y);
      if (past()) over = true;
    }
    b.hold('forward', false);
    if (over) break;
  }
  return { top: r2(top), over };
}

/**
 * Kicking from one wall to the next, with the double jump each kick gives back. `walls` are the wall to run at from each side, as a
 * heading, and `near()` says when the next wall is in reach. Returns the height reached and whether `done` came true.
 */
function kickChain(b: Bot, x: number, y: number, z: number, headings: readonly [number, number], near: (h: number) => boolean, done: () => boolean, midair = 0.26) {
  const p = b.p;
  b.place(x, y, z, headings[0]);
  b.hold('forward');
  b.frames(10);
  b.tap('jump');
  let top = p.position.y, side = 0;
  for (let kick = 0; kick < 12 && !done(); kick++) {
    if (!b.until(() => near(headings[side]!) || p.grounded, 1.4) || p.grounded) break;
    b.tap('jump');
    side = 1 - side;
    p.yaw = headings[side]!;
    b.frames(Math.round(midair / DT));
    b.tap('jump');
    top = Math.max(top, p.position.y);
  }
  for (let i = 0; i < 40 && !done(); i++) b.frame();
  top = Math.max(top, p.position.y);
  b.hold('forward', false);
  return { top: r2(top), done: done() };
}

function shaftLesson(b: Bot) {
  const p = () => b.p.position;
  let best = { top: -Infinity, done: false };
  for (const midair of [0.16, 0.2, 0.24, 0.28, 0.32, 0.36]) {
    const run = kickChain(b, 6, 0, -61.5, [EAST, WEST], h => (h === EAST ? p().x > 9 : p().x < 6), () => p().y > 9.7, midair);
    if (run.top > best.top) best = run;
  }
  return { 'kicks reach the top landing': best.done, reached: best.top };
}

function bypasses(b: Bot, doors: Doors) {
  const p = () => b.p.position;
  const out: Record<string, unknown> = {};
  const shut = (id: 'mainGate' | 'blastDoor', open: number) => doors.set(id, DOORS[id]!, open, 0, () => {});
  shut('mainGate', 0);
  shut('blastDoor', 0);
  out['pit, straight at the far wall'] = climbTest(b, -34, COOLANT.pit, -60, NORTH, () => p().z < COOLANT.farLip + 2.5, () => p().y > -0.5 && p().z < COOLANT.farLip);
  out['trench, straight at the far deck'] = climbTest(b, 2, GALLERY.trench, -76, EAST, () => p().x > GALLERY.farLip - 2.5, () => p().y > GALLERY.floor - 0.5 && p().x > GALLERY.farLip);
  out['apron over the south wall'] = climbTest(b, 14, 0, 26, NORTH, () => p().z < 15.5, () => p().z < 10);
  out['apron through the shut gate'] = climbTest(b, 0, 0, 26, NORTH, () => p().z < 15.5, () => p().z < 10);
  out['yard over the citadel front'] = climbTest(b, 20, 0, 4, NORTH, () => p().z < -9.5, () => p().z < -14);
  out['yard through the shut blast door'] = climbTest(b, 0, 0, 4, NORTH, () => p().z < -9.5, () => p().z < -14);
  // A corner gives two walls, so these are the runs a kick chain could make. They need the kick, which nothing has taught yet.
  const corner = (x: number, y: number, z: number, h: readonly [number, number], near: (h: number) => boolean, done: () => boolean) => {
    let best = { top: -Infinity, done: false };
    for (const m of [0.14, 0.2, 0.26, 0.32]) {
      const r = kickChain(b, x, y, z, h, near, done, m);
      if (r.done || r.top > best.top) best = r;
      if (r.done) break;
    }
    return best;
  };
  out['pit, kicking up the north-east corner'] = corner(-17, COOLANT.pit, -65, [NORTH, EAST],
    h => (h === NORTH ? p().z < COOLANT.farLip + 1 : p().x > -15), () => p().y > -0.4 && p().z < COOLANT.farLip);
  out['trench, kicking between its walls to the far deck'] = corner(GALLERY.farLip - 2, GALLERY.trench, -76, [SOUTH, NORTH],
    h => (h === SOUTH ? p().z > GALLERY.south - 1 : p().z < GALLERY.north + 1), () => p().y > GALLERY.floor - 0.4 && p().x > GALLERY.farLip);
  out['apron, kicking up the pylon and the wall'] = corner(8, 0, 16, [NORTH, WEST],
    h => (h === NORTH ? p().z < 14.5 : p().x < 11.5), () => p().z < 10);
  shut('mainGate', 1);
  shut('blastDoor', 1);
  return out;
}

function slideLesson(b: Bot, doors: Doors) {
  const { closeSeconds, triggerRange } = PARKOUR.slide;
  const door = DOORS.blastDoor!, doorZ = door.at[2];
  const p = b.p;
  const attempt = (press: (distance: number) => void): boolean => {
    doors.set('blastDoor', door, 1, 0, () => {});
    b.place(0, 0, doorZ + triggerRange + 8, NORTH);
    b.hold('forward');
    b.until(() => p.position.z <= doorZ + triggerRange);
    doors.set('blastDoor', door, 0, closeSeconds, () => {});
    let through = false;
    for (let t = 0; t < 4 && !through; t += DT) {
      press(p.position.z - doorZ);
      b.frame();
      through = p.position.z < doorZ - 1;
    }
    for (const a of ALL) b.hold(a, false);
    return through;
  };
  const out: Record<string, boolean> = {};
  out['a run is stopped'] = !attempt(() => {});
  let left = 2;
  out['a run with both dashes is stopped'] = !attempt(() => {
    if (left === 2 || (left === 1 && p.dashCharges >= 1 && !p.dashing)) { b.tap('dash'); left--; }
  });
  for (const at of [3, 6, 9]) {
    let pressed = false;
    out[`a slide in the last ${at} m goes under`] = attempt(d => {
      if (!pressed && d <= at) { pressed = true; b.hold('slide'); }
    });
  }
  doors.set('blastDoor', door, 1, 0, () => {});
  return out;
}

/** The gate has to win the race from the trigger, because the story needs them outside it. */
function gateLesson(b: Bot, doors: Doors) {
  const door = DOORS.mainGate!, p = b.p;
  doors.set('mainGate', door, 1, 0, () => {});
  b.place(0, 0, 44, NORTH);
  b.hold('forward');
  b.until(() => p.position.z <= 34);
  doors.set('mainGate', door, 0, 1, () => {});
  let left = 2;
  for (let t = 0; t < 3; t += DT) {
    if (left === 2 || (left === 1 && p.dashCharges >= 1 && !p.dashing)) { b.tap('dash'); left--; }
    b.frame();
  }
  b.hold('forward', false);
  const out = { 'both dashes reach the gate too late': p.position.z > 11 };
  doors.set('mainGate', door, 1, 0, () => {});
  return out;
}

/**
 * A man's route is pulled straight over the edge of a stairwell, because he has no capsule to catch on it. A player has, so the walk
 * stops at the top of those stairs first.
 */
const WAYPOINTS: Readonly<Record<string, readonly [number, number, number]>> = { kitchenTop: [35.5, 0, -74.5], westLanding: [-8.75, 5, -47], roofTop: [-13.7, 14, -65.8] };

/** Walks the real Player down the route a soldier would be given between two marks. A stair or a doorway a man cannot use stops this. */
function walkRoute(b: Bot, world: World, stages: readonly (readonly [string, string])[]) {
  const finder = new RouteFinder();
  finder.build(world.navGraph as unknown as NavGrid);
  const route = new Route();
  const p = b.p;
  const out: Record<string, string> = {};
  const at = new THREE.Vector3(), to = new THREE.Vector3();
  for (const [from, dest] of stages) {
    const a = (WAYPOINTS[from] ?? MARKS[from]!.at), c = (WAYPOINTS[dest] ?? MARKS[dest]!.at);
    b.place(a[0], a[1], a[2], 0);
    let t = 0, stuck = 0;
    const last = p.position.clone();
    const arrived = () => Math.hypot(c[0] - p.position.x, c[2] - p.position.z) < 2.5 && Math.abs(c[1] - p.position.y) < 1;
    let answered = true;
    // A long route comes back cut short, and the walker asks again on arrival, as a man does.
    while (t < 40 && !arrived() && stuck < 4 && answered) {
      answered = finder.find(at.copy(p.position).setY(p.position.y + 0.1), to.set(c[0], c[1] + 0.1, c[2]), route);
      if (!answered) break;
      b.hold('forward');
      for (let i = 1; i < route.count && t < 40 && stuck < 4; t += DT) {
        while (i < route.count && Math.hypot(route.x[i]! - p.position.x, route.z[i]! - p.position.z) < 1 && Math.abs(route.y[i]! - p.position.y) < 1.2) i++;
        if (i >= route.count) break;
        p.yaw = Math.atan2(-(route.x[i]! - p.position.x), -(route.z[i]! - p.position.z));
        b.frame();
        if (Math.round(t * 60) % 30 === 0) {
          stuck = p.position.distanceTo(last) < 0.3 ? stuck + 1 : 0;
          last.copy(p.position);
        }
      }
      b.hold('forward', false);
      if (route.count < 2) break;
    }
    out[`${from} to ${dest}`] = arrived() ? `${r2(t)} s` : !answered ? 'no route' : `stopped at ${p.position.toArray().map(r2)}`;
  }
  return out;
}

/** With the doors as each lesson finds them, no walker has a way round it. */
function noWayRound(world: World) {
  const finder = new RouteFinder();
  finder.build(world.navGraph as unknown as NavGrid);
  const route = new Route();
  const shut = (id: string, closed: boolean) => {
    const d = DOORS[id]!;
    finder.setClosed(d.at[0], d.at[2], -Math.sin(d.yaw), -Math.cos(d.yaw), d.width, closed);
  };
  const open = (from: string, to: string) => {
    const a = MARKS[from]!.at, b = MARKS[to]!.at;
    return finder.find(_o.set(a[0], a[1] + 0.1, a[2]), _d.set(b[0], b[1] + 0.1, b[2]), route);
  };
  for (const id of ['mainGate', 'blastDoor', 'sallyEast', 'armourySouth']) shut(id, true);
  const out = {
    'the apron has no way past the shut gate': !open('gateMouth', 'gateInside'),
    'the yard has no way past the shut blast door': !open('gateInside', 'sallyHall'),
    'the barracks have no way to the far platform': !open('coolantNear', 'coolantFar'),
    'the barracks have no way to the mess': !open('sallyHall', 'messFloor'),
    'the near deck has no way to the far deck': !open('galleryNear', 'galleryFar'),
  };
  for (const id of ['mainGate', 'blastDoor', 'sallyEast', 'armourySouth']) shut(id, false);
  return out;
}

/** Rays and sweeps that only a barrier or a wall can stop, from outside each line to inside it. */
function containment(physics: PhysicsSystem) {
  const mask = CG.World | CG.Barrier;
  const leaks: string[] = [];
  const ray = (x: number, y: number, z: number, dx: number, dz: number, len: number, name: string) => {
    if (!physics.raycast(_o.set(x, y, z), _d.set(dx, 0, dz), len, mask)) leaks.push(`${name} ${[x, y, z]}`);
  };
  const heights = [0.5, 2, 5, 6.5, 9, 14, 25, 50];
  for (const y of heights) {
    // The gate's own hole is the door's job: bypasses() tries it with the leaves shut.
    for (let x = -106; x <= 106; x += 4) if (y > 6 || Math.abs(x) > 7) ray(x, y, 30, 0, -1, 24, 'south wall');
    for (let z = 16; z <= 106; z += 6) {
      ray(100, y, z, 1, 0, 14, 'east edge');
      ray(-100, y, z, -1, 0, 14, 'west edge');
    }
    for (let x = -106; x <= 106; x += 6) ray(x, y, 100, 0, 1, 14, 'south edge');
    for (let z = -11; z <= 9; z += 4) {
      ray(26, y, z, 1, 0, 10, 'yard east');
      ray(-26, y, z, -1, 0, 10, 'yard west');
    }
    for (let x = -27; x <= 27; x += 6) ray(x, y, -4, 0, -1, 12, 'citadel front');
  }
  for (const y of [14.6, 15.6, 18, 30, 50]) {
    for (let x = -20; x <= 20; x += 5) {
      ray(x, y, -40, 0, 1, 20, 'roof south');
      ray(x, y, -60, 0, -1, 24, 'roof north');
    }
    for (let z = -74; z <= -30; z += 6) {
      ray(0, y, z, 1, 0, 30, 'roof east');
      ray(0, y, z, -1, 0, 30, 'roof west');
    }
  }
  return { leaks: leaks.length, sample: leaks.slice(0, 12) };
}

/** Straight lines at a full run across every seam the floors make. A snag shows as a low share of top speed. */
const RUNS: readonly (readonly [string, number, number, number, number, number])[] = [
  ['West Lane', 0, -51, 96, -51, 56], ['Gate Lane', 0, 3, 100, 3, 16], ['East Lane', 0, 34, 100, 34, 62], ['past the cut', 0, -60, 72, 0, 72],
  ['south of the cut', 0, -60, 101, 20, 101], ['the road', 0, -100, 34, 100, 34], ['yard', 0, -26, 6, 26, 6], ['the lane to the door', 0, 0, 9, 0, -10],
  ['through the door', 0, 0, -9, 0, -20], ['south corridor', 0, -12, -17.5, -50, -17.5], ['north corridor', 0, -54, -42.5, -14, -42.5],
  ['east corridor', 0, 14, -42.5, 54, -42.5], ['plate hall', 0, 14, -24, 54, -24], ['far platform', 0, -54, -72, -26, -72], ['near deck', -5, -23, -74.5, -12, -74.5],
  ['mess', 0, 16, -60, 54, -60], ['top landing', 10, -6, -60, 1, -60], ['y 5 gallery', 5, -6, -38, -6, -56], ['roof', 14, -20, -56, 20, -56], ['roof north', 14, -22, -30, -22, -76],
];

/** Runs through every doorway, both ways, at three offsets and three angles, and along every run of floor. */
export function sweepOutpost(world: World, physics: PhysicsSystem, rig: Rig) {
  const b = new Bot(rig), p = b.p;
  let tried = 0, stopped = 0, worstLoss = 0;
  const caught: string[] = [];
  for (const d of world.spec.plan!.doors) {
    const half = d.w / 2 - 0.65;
    for (const dir of [1, -1]) for (const off of [-half, 0, half]) for (const angle of [-0.26, 0, 0.26]) {
      const ux = d.dx * dir, uz = d.dz * dir;
      const rx = -uz, rz = ux;
      const c = Math.cos(angle), s = Math.sin(angle);
      const hx = ux * c - rx * s, hz = uz * c - rz * s;
      // As far back as the room allows, and on past the door by as much: a door off a corridor has 3 m of run-up, not 5.
      let back = 0, y = NaN, sx = 0, sz = 0;
      for (const m of [5, 3.4, 2.4]) {
        sx = d.x + rx * off - hx * m;
        sz = d.z + rz * off - hz * m;
        y = floorAt(physics, sx, sz, d.x, d.z);
        if (Number.isNaN(y)) continue;
        _o.set(sx, y + 0.9, sz);
        if (physics.sweepCapsule(_o, 0.45, 0.42, _d.set(hx * m * 2, 0, hz * m * 2), CG.World)) continue;
        back = m;
        break;
      }
      if (back === 0) continue;
      tried++;
      b.place(sx, y, sz, Math.atan2(-hx, -hz));
      b.hold('forward');
      const start = _o.set(sx, y, sz).clone();
      const t0 = (back * 2) / 12.5 + 0.2;
      let t = 0;
      const through = b.until(() => { t += DT; return p.position.distanceTo(start) > back * 2 - 0.3; }, t0 + 0.6);
      b.hold('forward', false);
      if (!through) { stopped++; caught.push(`door ${r2(d.x)},${r2(d.z)} dir ${dir} off ${r2(off)} angle ${angle}`); } else worstLoss = Math.max(worstLoss, t - t0);
    }
  }
  const runs: Record<string, number> = {};
  for (const [name, y, ax, az, bx, bz] of RUNS) {
    const len = Math.hypot(bx - ax, bz - az);
    b.place(ax, y, az, Math.atan2(-(bx - ax), -(bz - az)));
    b.hold('forward');
    b.frames(30);
    let slowest = Infinity, went = 0;
    const from = p.position.clone();
    b.until(() => {
      slowest = Math.min(slowest, p.speed);
      went = p.position.distanceTo(from);
      return went > len - 8;
    }, len / 8);
    b.hold('forward', false);
    runs[name] = went > len - 9 ? r2(slowest / 12.5) : -r2(went);
  }
  return { doors: { tried, stopped, worstLoss: r2(worstLoss), caught: caught.slice(0, 16) }, runs };
}

function floorAt(physics: PhysicsSystem, x: number, z: number, dx: number, dz: number): number {
  // From just above the level the door stands on: the room under it is not the room in question.
  for (const y of [0, -5, 5, 10, 14]) {
    const hit = physics.raycast(_o.set(dx, y + 1.5, dz), DOWN, 2, CG.World);
    if (hit && physics.raycast(_o.set(x, y + 1.5, z), DOWN, 2.2, CG.World)) return hit.point.y;
  }
  return NaN;
}

/** Random hands from a spread of places. Anything that ends a run here would end a playtest. */
export function fuzzOutpost(rig: Rig, secondsEach: number, seed = 7) {
  const b = new Bot(rig), p = b.p;
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const starts = ['apronRally', 'lz', 'wreckFoot', 'gateInside', 'sallyHall', 'corridorMg', 'bunkFour', 'coolantNear', 'coolantFar', 'galleryNear', 'galleryFar', 'messFloor', 'armoury', 'plateWest', 'stackFloor', 'stackUpper', 'warRoom', 'roofMast'];
  let inside = 0, escapes = 0, frames = 0, lost = 0, top = -Infinity;
  const wedged: string[] = [], where: string[] = [];
  const actions = ['forward', 'left', 'right', 'jump', 'dash', 'slide'] as const;
  for (const id of starts) {
    const m = MARKS[id]!.at;
    b.place(m[0], m[1], m[2], rnd() * 6.28);
    let next = 0, sample = 0;
    const last = p.position.clone();
    for (let t = 0; t < secondsEach; t += DT) {
      if (t >= next) {
        next = t + 0.15 + rnd() * 0.9;
        b.hold('forward', rnd() < 0.85);
        b.hold('left', rnd() < 0.25);
        b.hold('right', rnd() < 0.25);
        b.hold('jump', rnd() < 0.3);
        b.hold('dash', rnd() < 0.15);
        b.hold('slide', rnd() < 0.15);
        p.yaw += (rnd() - 0.5) * 2.2;
      }
      b.frame();
      frames++;
      const q = p.position;
      if (p.isPenetrating()) { if (inside++ % 8 === 0) where.push(`inside ${q.toArray().map(r2)} from ${id}`); }
      if (Math.abs(q.x) > 112 || Math.abs(q.z) > 112) escapes++;
      if (q.y < -14) { if (lost++ % 8 === 0) where.push(`lost ${q.toArray().map(r2)} from ${id}`); }
      top = Math.max(top, q.y);
      if (t >= sample) {
        if (sample > 0 && q.distanceTo(last) < 0.25) {
          const from = q.clone();
          for (const a of actions) b.hold(a, false);
          let free = false;
          for (let turn = 0; turn < 8 && !free; turn++) {
            p.yaw = (turn * Math.PI) / 4;
            b.hold('forward');
            b.frames(30);
            free = p.position.distanceTo(from) > 1;
          }
          if (!free) wedged.push(`${from.toArray().map(r2)} after ${id}`);
        }
        last.copy(q);
        sample = t + 3;
      }
    }
    for (const a of actions) b.hold(a, false);
  }
  return { seconds: Math.round(frames * DT), inside, escapes, lost, wedged: wedged.slice(0, 12), where: where.slice(0, 16), top: r2(top) };
}

/** The whole way through, in the order the mission takes it, with a teleport across each gap only a jump can cross. */
const ROUTE = [
  ['gateMouth', 'shotgunCrate'], ['shotgunCrate', 'apronEast'], ['apronEast', 'wreckFoot'], ['wreckFoot', 'gateMouth'],
  ['sandbagsEast', 'sallyHall'], ['sallyHall', 'corridorMg'], ['corridorMg', 'bunkFour'], ['bunkFour', 'northCorridorEast'], ['northCorridorEast', 'coolantNear'],
  ['coolantFar', 'galleryNear'], ['galleryFar', 'kitchenTop'], ['kitchenTop', 'messFloor'], ['messFloor', 'kilnRack'], ['messFloor', 'armoury'], ['armoury', 'plateWest'], ['plateWest', 'guardRoom'],
  ['plateWest', 'stackFloor'], ['stackFloor', 'westLanding'], ['westLanding', 'stackLower'], ['stackLower', 'stackUpper'], ['stackFloor', 'stackBase'], ['stackBase', 'warRoomDoor'], ['warRoomDoor', 'warRoom'], ['warRoom', 'roofTop'], ['roofTop', 'roofMast'], ['roofMast', 'roofWest'],
] as const;

/** Shut doors need real colliders, so this stands up what the host would. */
function doorsFor(rig: Rig): Doors {
  const render = rig.ctx.render as unknown as Record<string, unknown>;
  render.scene = new THREE.Scene();
  render.materials = { world: () => new THREE.MeshBasicMaterial() };
  (rig.ctx as unknown as { enemies: unknown }).enemies = { outpost: null, query: () => 0 };
  return new Doors(rig.ctx);
}

export function provePark(world: World, physics: PhysicsSystem, rig: Rig) {
  const b = new Bot(rig);
  const doors = doorsFor(rig);
  b.onFrame = () => doors.update(DT);
  return {
    mantle: mantleLesson(b),
    doubleJump: doubleJumpLesson(b),
    roofs: roofLessons(b),
    gate: gateLesson(b, doors),
    slide: slideLesson(b, doors),
    dash: dashLesson(b),
    wallRun: wallRunLesson(b),
    shaft: shaftLesson(b),
    bypasses: bypasses(b, doors),
    containment: containment(physics),
    noWayRound: noWayRound(world),
    walk: walkRoute(b, world, ROUTE),
  };
}
