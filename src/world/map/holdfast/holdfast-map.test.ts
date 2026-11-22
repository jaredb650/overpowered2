/**
 * Holdfast, built for real (Rapier, the nav sample, the walls and shacks after it) and held to what Foreclosure needs of it: every mark
 * on a floor, the places reachable, battles with a firing line and cover on both sides, the gunship's targets in sight from its orbit,
 * roads clear for technicals, every Frame route clear at 3.6 m by a swept box, and the stacks' parkour route crossed by the real
 * player with climbs and a chimney while nobody walks it.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PARKOUR } from '../../../campaign/parkour';
import { type Action, CG, type Ctx, type Structure } from '../../../core/contracts';

type WorldT = import('../../World').World;
type Plan = typeof import('./plan');
type Places = typeof import('../../../campaign/missions/foreclosure.places');
type Game = Awaited<ReturnType<typeof import('../../../player/testkit/headless').createHeadlessGame>>;
type Rig = ReturnType<typeof import('../outpost/proof').rigOf>;

let world: WorldT;
let plan: Plan;
let places: Places;
let game: Game;
let rig: Rig;
let physics: Ctx['physics'];

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const P = (p: readonly number[]) => V(p[0]!, p[1]!, p[2]!);
const DOWN = V(0, -1, 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

beforeAll(async () => {
  // Which map a page runs is fixed at import, by its URL. Canvas painting only feeds textures, which nothing here looks at.
  vi.stubGlobal('location', { search: '?map=holdfast' });
  const paint: unknown = new Proxy({}, { get: (_, key) => (key === 'measureText' ? () => ({ width: 100 }) : () => undefined), set: () => true });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => paint, style: {}, width: 0, height: 0 }) });
  const { World } = await import('../../World');
  const { createHeadlessGame } = await import('../../../player/testkit/headless');
  const proof = await import('../outpost/proof');
  plan = await import('./plan');
  places = await import('../../../campaign/missions/foreclosure.places');
  game = await createHeadlessGame(() => {});
  (game.ctx as unknown as { weapons: unknown }).weapons = { occupy: () => {} };
  physics = game.ctx.physics;
  world = new World(game.ctx);
  (game.ctx as Ctx).world = world;
  await world.build();
  rig = proof.rigOf(game);
  (physics as unknown as { flushQueries(): void }).flushQueries();
}, 120000);

const nav = () => world.navGraph;
const gates = (): Structure[] => world.objects.walls.all.filter(p => p.kind === 'gate');
/** The main gate blown and the west gate up: the town as the mission walks it after the wall beat. */
const openTown = () => {
  for (const g of gates()) {
    if ((g as unknown as { spec: { opens?: boolean } }).spec.opens) world.objects.walls.setOpen(g, true);
    else world.objects.walls.setStage(g, 1);
  }
};
const route = (from: THREE.Vector3, to: THREE.Vector3): number => {
  nav().setBlocked(1e6, 1e6, 0, 1, 0, 0, 0, false);
  nav().setTarget(to);
  nav().settle();
  return nav().pathDistance(from);
};
const floorUnder = (x: number, y: number, z: number): number | null => physics.raycast(V(x, y + 1.2, z), DOWN, 2.4, CG.World)?.point.y ?? null;
const onNav = (p: THREE.Vector3, r = 1.2): boolean => {
  const out = V(0, 0, 0);
  return nav().nearest(V(p.x, p.y + 0.1, p.z), 3, out) && Math.hypot(out.x - p.x, out.z - p.z) < r && Math.abs(out.y - p.y) < 0.4;
};
const mark = (id: string) => P(places.PLACES[id]!.at);
/** Marks that are not walking ground on purpose: the parkour route's tops, the crane cab, the flak tower's guns. */
const UNWALKED = /^(stacksClimbed|stacksTop|craneCab|flakGun\d)$/;
/** Marks standing on the runtime physics-enabled FlakTower entity (not static map concrete). */
const DYNAMIC_TOWER = /^flakGun\d$/;

describe('Holdfast', () => {
  it('is inside its budget', () => {
    const r = world.report;
    expect(r.triangles as number).toBeLessThan(400000);
    expect(r.colliders as number).toBeLessThan(950);
    expect(r.lights as number).toBeLessThan(140);
    expect(world.objects.walls.root.children.length).toBeLessThan(40);
    console.info('holdfast', JSON.stringify({ triangles: r.triangles, colliders: r.colliders, lights: r.lights, nav: nav().nodeCount, structures: world.objects.walls.all.length, clusters: world.objects.destruction.allClusters().length, chunks: world.objects.walls.root.children.length }));
  });

  it('puts every mark on a floor, unburied, and every walking mark on the nav', () => {
    const bad: string[] = [];
    for (const [id, m] of Object.entries(places.PLACES)) {
      if (DYNAMIC_TOWER.test(id)) continue;
      const [x, y, z] = m.at;
      const f = floorUnder(x, y, z);
      if (f === null || Math.abs(f - y) > 0.12) { bad.push(`${id} floor ${f === null ? 'none' : r2(f)} at ${y}`); continue; }
      if (physics.overlapCapsule(V(x, y + 0.95, z), 0.35, 0.5, CG.World)) bad.push(`${id} buried`);
      if (!UNWALKED.test(id) && !onNav(V(x, y, z))) {
        const out = V(0, 0, 0);
        nav().nearest(V(x, y + 0.1, z), 3, out);
        bad.push(`${id} off the nav, nearest ${out.toArray().map(r2)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('lets a man walk from the LZ to every walking mark once the gate is blown', () => {
    openTown();
    const lz = mark('lz');
    const lost: string[] = [];
    for (const [id, m] of Object.entries(places.PLACES)) {
      if (UNWALKED.test(id)) continue;
      if (!(route(P(m.at), lz) < 900)) lost.push(id);
    }
    expect(lost).toEqual([]);
  });

  it('keeps the town shut until the gate goes: the Flats reach nothing inside the wall', () => {
    for (const g of gates()) {
      world.objects.walls.setStage(g, 0);
      if ((g as unknown as { spec: { opens?: boolean } }).spec.opens) world.objects.walls.setOpen(g, false);
    }
    expect(route(mark('square'), mark('lz'))).toBe(Infinity);
    expect(route(mark('pans'), mark('lz'))).toBe(Infinity);
    openTown();
    expect(route(mark('square'), mark('lz'))).toBeLessThan(200);
    expect(route(mark('pans'), mark('square'))).toBeLessThan(400);
  });

  it('spawns men on floors that reach the LZ, and flyers over the sea and the salt', () => {
    openTown();
    const bad: string[] = [];
    for (const s of world.spawnPoints) {
      if (s.kind === 'air') { if (s.position.y < 20) bad.push(`air ${s.position.toArray()}`); continue; }
      const p = s.position.clone().setY(s.position.y - 0.1);
      if (floorUnder(p.x, p.y, p.z) === null || !onNav(p)) bad.push(`ground ${p.toArray()} off`);
      else if (!(route(p, mark('lz')) < 900)) bad.push(`ground ${p.toArray()} cut off`);
    }
    expect(bad).toEqual([]);
    expect(world.spawnPoints.filter(s => s.kind === 'ground').length).toBe(plan.HOLDFAST_SPAWNS.foot.length);
  });

  it('has a war on every street: each battle a firing line between the two sides, cover for both, and a way between', () => {
    openTown();
    const eye = 1.6, crouch = 0.9;
    const bad: string[] = [];
    for (const [id, b] of Object.entries(places.BATTLES)) {
      const a = mark(b.at), t = mark(b.from);
      const d = Math.hypot(t.x - a.x, t.z - a.z);
      if (d < 15 || d > 60) bad.push(`${id} ${r2(d)} m apart`);
      if (!(route(a, t) < 250)) bad.push(`${id} no way between`);
      // A firing line: from somewhere near one side's mark to somewhere near the other's, eye to eye.
      const across = V(-(t.z - a.z) / d, 0, (t.x - a.x) / d);
      let line = false;
      for (const oa of [-1.2, 0, 1.2]) for (const ob of [-1.2, 0, 1.2]) {
        const from = a.clone().addScaledVector(across, oa).setY(a.y + eye), to = t.clone().addScaledVector(across, ob).setY(t.y + eye);
        const dir = to.clone().sub(from);
        if (!physics.raycast(from, dir.clone().normalize(), dir.length(), CG.World)) line = true;
      }
      if (!line) bad.push(`${id} no firing line`);
      // Cover: within 3 m of each mark, a floor where a crouching man has something solid between him and the other side.
      for (const [mine, theirs, name] of [[a, t, b.at], [t, a, b.from]] as const) {
        let covered = false;
        for (const r of [0, 0.9, 1.8, 2.7]) for (let k = 0; k < (r === 0 ? 1 : 12) && !covered; k++) {
          const x = mine.x + Math.cos((k / 12) * Math.PI * 2) * r, z = mine.z + Math.sin((k / 12) * Math.PI * 2) * r;
          const f = floorUnder(x, mine.y, z);
          if (f === null || Math.abs(f - mine.y) > 0.3) continue;
          const from = V(x, f + crouch, z), to = V(theirs.x, theirs.y + eye, theirs.z);
          const dir = to.sub(from);
          const hit = physics.raycast(from, dir.clone().normalize(), dir.length(), CG.World);
          if (hit && hit.distance < 3) covered = true;
        }
        if (!covered) bad.push(`${id}: no cover for ${name}`);
      }
    }
    expect(bad).toEqual([]);
    expect(Object.keys(places.BATTLES).length).toBeGreaterThanOrEqual(5);
  });

  it('shows the gunship a town full of targets from its orbit', () => {
    const { radius, altitude, targets } = places.OVERWATCH;
    const c = mark(places.OVERWATCH.over);
    const seen: Record<string, number> = {};
    for (const id of targets) {
      const t = mark(id).add(V(0, 1, 0));
      let n = 0;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const ship = V(c.x + Math.cos(a) * radius, altitude, c.z + Math.sin(a) * radius);
        const dir = t.clone().sub(ship);
        const hit = physics.raycast(ship, dir.clone().normalize(), dir.length() - 0.5, CG.World | CG.Air);
        if (!hit) n++;
      }
      seen[id] = r2(n / 24);
    }
    for (const [id, share] of Object.entries(seen)) expect(share, id).toBeGreaterThan(0.6);
  });

  it('keeps the roads clear for a technical, and the LZ clear for a landing', () => {
    const blocked: string[] = [];
    for (const road of plan.ROADS) {
      for (let i = 0; i + 1 < road.points.length; i++) {
        const [ax, az] = road.points[i]!, [bx, bz] = road.points[i + 1]!;
        const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
        for (let off = -road.width / 2 + 0.4; off <= road.width / 2 - 0.4 + 1e-6; off += 1.1) {
          for (const h of [0.5, 2.4]) {
            const hit = physics.raycast(V(ax - uz * off, h, az + ux * off), V(ux, 0, uz), len, CG.World);
            if (hit) blocked.push(`${road.id} ${i} off ${r2(off)} h ${h} at ${r2(hit.distance)}`);
          }
        }
      }
    }
    const { x, z, radius } = plan.LZ;
    for (let a = 0; a < 16; a++) for (const r of [0, radius / 2, radius - 1]) {
      const hit = physics.raycast(V(x + Math.cos(a) * r, 8, z + Math.sin(a) * r), DOWN, 10, CG.World);
      if (!hit || hit.point.y > 0.1) blocked.push(`lz at ${a},${r}`);
    }
    expect(blocked).toEqual([]);
  });

  it('clears every Frame route at 3.6 m by a swept box, past nothing that does not break', () => {
    openTown();
    const { width, step, height } = plan.FRAME;
    const shape = new physics.R.Cuboid(width / 2, (height - step - 0.05) / 2, 0.25);
    const q = new THREE.Quaternion();
    const blocked: string[] = [];
    const walls = world.objects.walls;
    const destructibles = new Set<number>();
    for (const cluster of world.objects.destruction.allClusters()) {
      for (const node of cluster.nodes) {
        if (node.staticCollider) destructibles.add(node.staticCollider.handle);
      }
    }
    for (const id of places.FRAME_ROUTES) {
      const marks = places.ROUTES[id]!;
      for (let i = 0; i + 1 < marks.length; i++) {
        const a = mark(marks[i]!), b = mark(marks[i + 1]!);
        const len = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
        q.setFromAxisAngle(V(0, 1, 0), Math.atan2(-uz, ux) + Math.PI / 2);
        let last = a.y;
        for (let s = 0; s <= len; s += 0.5) {
          const x = a.x + ux * s, z = a.z + uz * s;
          const f = physics.raycast(V(x, Math.max(a.y, b.y) + 2, z), DOWN, 12, CG.World)?.point.y ?? null;
          if (f === null) { blocked.push(`${id} ${marks[i]}->${marks[i + 1]} no floor at ${r2(s)}`); continue; }
          if (Math.abs(f - last) > step) blocked.push(`${id} ${marks[i]}->${marks[i + 1]} a step of ${r2(f - last)} at ${r2(s)}`);
          last = f;
          const c = { x, y: f + step + 0.05 + (height - step - 0.05) / 2, z };
          physics.world.intersectionsWithShape(c, { x: q.x, y: q.y, z: q.z, w: q.w }, shape, col => {
            if (!walls.pieceOf(col) && !destructibles.has(col.handle)) blocked.push(`${id} ${marks[i]}->${marks[i + 1]} at ${r2(s)} m (${r2(x)}, ${r2(z)})`);
            return true;
          }, undefined, ((0xffff << 16) | CG.World) >>> 0);
        }
      }
    }
    expect([...new Set(blocked)].slice(0, 30)).toEqual([]);
  });

  it('wires all Holdfast destruction clusters, enterable barracks spawns, and Tier-3 reinforced West Wall/Gate', () => {
    openTown();
    const d = world.objects.destruction;
    const expectedTags = [
      'barracks.flats', 'barracks.market', 'barracks.stacks', 'barracks.cannery', 'barracks.harbour',
      'marketHall.west', 'marketHall.east', 'emplacement.flats', 'emplacement.market',
      'catwalk.square', 'catwalk.eastMarket', 'cannery', 'quayCrane', 'gantryCrane',
    ];
    for (const tag of expectedTags) {
      expect(d.isClusterAlive(tag), tag).toBe(true);
    }
    for (const b of plan.BARRACKS) {
      const sp = P(b.spawn);
      expect(floorUnder(sp.x, sp.y, sp.z), `${b.tag} spawn floor`).not.toBeNull();
      expect(onNav(sp), `${b.tag} spawn on nav`).toBe(true);
      expect(route(sp, mark('lz')), `${b.tag} spawn reaches lz`).toBeLessThan(900);
    }
    const westPieces = world.objects.walls.all.filter(p => Math.abs(p.spec.x - plan.WEST_X) < 0.2);
    expect(westPieces.length).toBeGreaterThan(10);
    for (const p of westPieces) {
      expect(p.tier, `west ${p.kind} at z=${p.spec.z}`).toBe(3);
      if (p.kind === 'gate') expect(p.spec.opens).not.toBe(true);
    }
  });
});

// -------------------------------------------------------------------------------------------------
// The stacks, played: the real Player, keys pressed as a person would, on the map's own faces.
// -------------------------------------------------------------------------------------------------

const ALL: readonly Action[] = ['forward', 'back', 'left', 'right', 'jump', 'dash', 'slide'];
const NORTH = 0, EAST = -Math.PI / 2;
type Body = Rig['player'] & { climbing: boolean; clinging: boolean };
const body = () => rig.player as Body;
const frames = (n: number) => { for (let i = 0; i < n; i++) rig.step(); };
const hold = (a: Action, down = true) => rig.input.simulate(a, down);
const tap = (a: Action) => { hold(a); rig.step(); hold(a, false); };
const until = (done: () => boolean, seconds: number): boolean => {
  for (let t = 0; t < seconds; t += 1 / 60) {
    if (done()) return true;
    rig.step();
  }
  return done();
};
function place(x: number, y: number, z: number, yaw: number): void {
  for (const a of ALL) hold(a, false);
  rig.input.consumeLook();
  rig.player.reset();
  rig.player.teleport(V(x, y + 0.05, z), yaw);
  frames(4);
}
/** Runs at (x, z) with W held, steering, until within `near` of it or `seconds` run out. */
function runTo(x: number, z: number, seconds = 8, near = 0.6): boolean {
  hold('forward');
  const ok = until(() => {
    const p = body().position;
    body().yaw = Math.atan2(-(x - p.x), -(z - p.z));
    return Math.hypot(x - p.x, z - p.z) < near;
  }, seconds);
  hold('forward', false);
  return ok;
}
/** A jump at the wall in front, W held: the climb, and the mantle at its top if the ledge comes into reach. */
function climbAhead(): boolean {
  hold('forward');
  tap('jump');
  const climbed = until(() => body().climbing, 1);
  until(() => !body().climbing && !body().clinging && body().grounded, 2.5);
  hold('forward', false);
  return climbed;
}
/** Climbs wall to wall up a slot, a jump off each cling turning the view to the other wall, until `done`. Returns the climbs made. */
function chimney(done: () => boolean, most = 14): number {
  hold('forward');
  tap('jump');
  let climbs = 0;
  for (let i = 0; i < most && !done(); i++) {
    if (!until(() => body().climbing || done(), 1.2)) break;
    if (done()) break;
    climbs++;
    until(() => !body().climbing, 1);
    if (done()) break;
    tap('jump');
  }
  // On top: let go, or the run carries on off the far side.
  hold('forward', false);
  until(() => done() && body().grounded, 1.5);
  return climbs;
}

describe('the stacks', () => {
  let A: Plan['STACKS'][number], C1: Plan['STACKS'][number];
  beforeAll(() => {
    A = plan.stack('A');
    C1 = plan.stack('C1');
  });

  it('is built to PARKOUR.stacks', () => {
    const { climb, chimney, gap } = PARKOUR.stacks;
    expect(plan.stackTop(A)).toBeCloseTo(climb, 5);
    expect(plan.CHIMNEY.x1 - plan.CHIMNEY.x0).toBeCloseTo(chimney.width, 5);
    expect(plan.stackTop(plan.stack('Bw')) - plan.stackTop(A)).toBeCloseTo(chimney.rise, 5);
    expect(plan.stackTop(plan.stack('Be')) - plan.stackTop(A)).toBeCloseTo(chimney.rise, 5);
    expect(plan.stack('Bw').z0 - C1.z1).toBeCloseTo(gap, 5);
    expect(plan.stackTop(C1)).toBeCloseTo(plan.stackTop(plan.stack('Bw')), 5);
  });

  it('cannot be walked: no nav on any stack top west of the aisle, nor on the crane', () => {
    let tops = 0;
    for (let i = 0; i < nav().nodeCount; i++) {
      const x = nav().px[i]!, y = nav().py[i]!, z = nav().pz[i]!;
      if (y > 2 && x > plan.GANTRY.x0 - 1 && x < plan.AISLE.x0 + 0.5 && z > plan.AISLE.z0 - 0.5 && z < A.z1 + 0.5) tops++;
    }
    expect(tops).toBe(0);
  });

  it('cannot be walked onto: a walk at A from Crane Street stays on the street', () => {
    const foot = mark('stacksFoot');
    place(foot.x, 0, foot.z + 2, NORTH);
    hold('forward');
    frames(150);
    hold('forward', false);
    expect(body().position.y).toBeLessThan(0.5);
  });

  it('is climbed: a wall climb from Crane Street onto A', () => {
    const foot = mark('stacksFoot');
    place(foot.x, 0, foot.z + 1, NORTH);
    hold('forward');
    until(() => body().position.z < A.z1 + 1.3, 2);
    expect(climbAhead()).toBe(true);
    frames(10);
    expect(body().position.y).toBeGreaterThan(plan.stackTop(A) - 0.2);
  });

  it('shuts B to a climb from A: its faces refuse it, and a jump at it falls short', () => {
    const top = plan.stackTop(A), bw = plan.stack('Bw');
    place(26, top, A.z0 + 2.2, NORTH);
    hold('forward');
    until(() => body().position.z < A.z0 + 1.2, 2);
    tap('jump');
    let climbed = false;
    for (let t = 0; t < 1.6; t += 1 / 60) {
      if (t > 0.25 && t < 0.28) tap('jump');
      else rig.step();
      climbed ||= body().climbing;
    }
    hold('forward', false);
    frames(30);
    expect(climbed).toBe(false);
    expect(body().position.y).toBeLessThan(plan.stackTop(bw) - 1);
    // The chimney's liners, on the other hand, take a hand.
    const liner = physics.raycast(V(plan.CHIMNEY.x0 + 0.75, 4, (plan.CHIMNEY.z0 + plan.CHIMNEY.z1) / 2), V(-1, 0, 0), 2, CG.World);
    expect(liner && physics.climbable(liner.collider)).toBe(true);
    const face = physics.raycast(V(26, top + 3, A.z0 + 1), V(0, 0, -1), 2, CG.World);
    expect(face && physics.climbable(face.collider)).toBe(false);
  });

  it('is crossed over the top: the climb, the chimney up B, the gap to C, and down to the quay', () => {
    const steps: Record<string, boolean | number | string> = {};
    const foot = mark('stacksFoot'), end = mark('stacksEnd');
    place(plan.CHIMNEY.x0 + 0.75, 0, foot.z + 1, NORTH);
    hold('forward');
    until(() => body().position.z < A.z1 + 1.3, 2);
    steps.climb = climbAhead() && body().position.y > plan.stackTop(A) - 0.2;
    // Across A and into the chimney's mouth: it drops to the ground between B's halves.
    const cx = (plan.CHIMNEY.x0 + plan.CHIMNEY.x1) / 2;
    runTo(cx, A.z0 + 1.5, 4, 0.4);
    hold('forward');
    body().yaw = NORTH;
    until(() => body().position.y < 1 && body().grounded, 3);
    hold('forward', false);
    steps.inSlot = body().position.y < 1 && Math.abs(body().position.x - cx) < 0.6;
    body().yaw = EAST;
    frames(2);
    const top = plan.stackTop(plan.stack('Bw'));
    steps.climbs = chimney(() => body().position.y > top - 0.15);
    steps.onB = body().position.y > top - 0.15;
    // North over B, a run and a jump over the gap onto C1.
    const p = body().position;
    runTo(p.x < cx ? 30 : 44, plan.CHIMNEY.z0 + 3, 5);
    hold('forward');
    body().yaw = NORTH;
    until(() => body().position.z < plan.CHIMNEY.z0 + 0.6, 2);
    tap('jump');
    until(() => body().grounded && body().position.z < C1.z1 - 0.5, 2);
    hold('forward', false);
    steps.onC = body().position.y > plan.stackTop(C1) - 0.2;
    // Down: C1 to C2 to the apron.
    const there = runTo(end.x, end.z, 12, 1.2);
    until(() => body().grounded, 2);
    steps.down = there && body().position.y < 0.5;
    steps.at = body().position.toArray().map(r2).join(',');
    expect(steps).toMatchObject({ climb: true, inSlot: true, onB: true, onC: true, down: true });
    expect(steps.climbs as number).toBeGreaterThanOrEqual(2);
  });

  it('puts the Sabot in a cab only the chimney in the crane\'s leg reaches', () => {
    const { leg, deck } = plan.GANTRY, cab = mark('craneCab');
    const cx = (leg.gap0 + leg.gap1) / 2;
    place(cx, 0, plan.GANTRY.z1 + 1.5, NORTH);
    runTo(cx, (plan.GANTRY.z0 + plan.GANTRY.z1) / 2, 2, 0.3);
    body().yaw = EAST;
    frames(2);
    const climbs = chimney(() => body().position.y > deck - 0.15, 16);
    expect(body().position.y, `${climbs} climbs, at ${body().position.toArray().map(r2)}`).toBeGreaterThan(deck - 0.15);
    expect(runTo(cab.x, cab.z, 6, 1)).toBe(true);
    expect(body().position.y).toBeGreaterThan(deck - 0.2);
    // Nobody walks there.
    expect(onNav(cab)).toBe(false);
  });
});
