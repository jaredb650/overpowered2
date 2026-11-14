/**
 * The fort, built for real (Rapier, the nav sample, the walls going up after it) and held to what the mode needs of it: every catwalk
 * walkable from the core, each ring sealed by its walls and opened by its gates, posts and shops on floor in their rings, spawns out in
 * the field with a way to the outer gates, and the lanes and landing zones clear for vehicles.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CG, type Ctx, type Structure } from '../../../core/contracts';

type WorldT = import('../../World').World;
type Plan = typeof import('./plan');

let world: WorldT;
let plan: Plan;
let gates: Structure[];
let physics: Ctx['physics'];
let gameCtx: Ctx;

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const P = (p: readonly number[]) => V(p[0]!, p[1]!, p[2]!);
const DOWN = V(0, -1, 0);
const fakeChar = () => ({
  root: new THREE.Object3D(), bones: Array.from({ length: 40 }, () => new THREE.Bone()), rig: { height: 1.85 }, mesh: new THREE.Object3D(),
  anim: { play: vi.fn(), flinch: vi.fn(), setPosture: vi.fn(), setLocomotion: vi.fn(), update: vi.fn() },
  hitFlash: vi.fn(), release: vi.fn(), setLod: vi.fn(),
});

beforeAll(async () => {
  // Which map a page runs is fixed at import, by its URL. Canvas painting only feeds textures, which nothing here looks at.
  vi.stubGlobal('location', { search: '?map=fort' });
  const paint: unknown = new Proxy({}, { get: (_, key) => (key === 'measureText' ? () => ({ width: 100 }) : () => undefined), set: () => true });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => paint, style: {}, width: 0, height: 0 }) });
  const { World } = await import('../../World');
  const { createHeadlessGame } = await import('../../../player/testkit/headless');
  plan = await import('./plan');
  const game = await createHeadlessGame(() => {});
  physics = game.ctx.physics;
  gameCtx = game.ctx;
  world = new World(game.ctx);
  (game.ctx as Ctx).world = world;
  await world.build();
  gates = world.objects.walls.all.filter(p => p.kind === 'gate');
}, 120000);

const nav = () => world.navGraph;
/** Metres along the nav from `from` to `to`, Infinity when there is no way. */
const route = (from: THREE.Vector3, to: THREE.Vector3): number => {
  // A pass keeps the distances of nodes it cannot reach from the last one unless something changed; a change far off the grid forgets them.
  nav().setBlocked(1e6, 1e6, 0, 1, 0, 0, 0, false);
  nav().setTarget(to);
  nav().settle();
  return nav().pathDistance(from);
};
const openRings = (ids: readonly string[]) => {
  for (const g of gates) world.objects.walls.setOpen(g, false);
  for (const g of gates) {
    const s = (g as unknown as { spec: { x: number; z: number } }).spec;
    const r = plan.RINGS.find(r => Math.abs(Math.max(Math.abs(s.x), Math.abs(s.z)) - r.half) < 0.5)!;
    if (ids.includes(r.id)) world.objects.walls.setOpen(g, true);
  }
};
/** A nav node within `r` of the point on the same floor. */
const onFloor = (p: THREE.Vector3, r = 0.8): boolean => {
  const out = V(0, 0, 0);
  return nav().nearest(V(p.x, p.y + 0.1, p.z), 3, out) && Math.hypot(out.x - p.x, out.z - p.z) < r && Math.abs(out.y - p.y) < 0.35;
};

describe('the fort', () => {
  it('is inside its budget', () => {
    const r = world.report;
    expect(r.triangles as number).toBeLessThan(450000);
    // Static boxes are cheap in Rapier's tree; most of these are sandbags, crates and the catwalk's posts.
    expect(r.colliders as number).toBeLessThan(1300);
    expect(r.lights as number).toBeLessThan(160);
    // Walls, gates and shacks are drawn a chunk at a time, not a group a piece.
    expect(world.objects.walls.root.children.length).toBeLessThan(40);
  });

  it('has three rings of tall walls with lift gates in each, and the guns on pads high enough to fire over their ports', () => {
    const walls = world.objects.walls.all;
    expect(walls.filter(p => p.kind === 'wall').length).toBeGreaterThan(150);
    for (const r of plan.RINGS) expect(r.gates.length).toBeGreaterThan(0);
    expect(gates.length).toBe(plan.RINGS.reduce((n, r) => n + r.gates.length, 0));
    expect(world.spec.emplacements.length).toBe(plan.FORT_GUNS.length);
    for (const e of world.spec.emplacements) {
      expect(e.pos.y + 1.2).toBeGreaterThan(plan.FORT_PORT.height + 0.3);
      expect(onFloor(e.pos)).toBe(true);
    }
    // A real wall: over five metres from the field, and a breach still costs what a plain 4 m segment's does.
    expect(plan.FORT_WALL.height).toBeGreaterThan(5);
    const seg = walls.find(p => p.kind === 'wall')!;
    expect(seg.maxHealth / (seg as unknown as { spec: { length: number } }).spec.length).toBeCloseTo(300 / 4, 0);
  });

  it('fights from cover: a standing man fires through a crenel or a slit, a crouching one is under the sill, a merlon covers his head', () => {
    (physics as unknown as { flushQueries(): void }).flushQueries();
    const eye = 1.62, crouch = 0.86;
    const riflemen = plan.FORT_POSTS.filter(p => p.type === 'rifleman');
    expect(riflemen.length).toBeGreaterThan(15);
    const out = (p: (typeof riflemen)[number]) => V(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    for (const p of riflemen) {
      const at = P(p.pos), f = out(p);
      // Standing at his crenel, nothing within 4 m in front of his eye.
      expect(physics.raycast(V(at.x, at.y + eye, at.z), f, 4, CG.World), `${p.id} standing`).toBeNull();
      expect(physics.raycast(V(at.x, at.y + crouch, at.z), f, 3, CG.World), `${p.id} crouched`).not.toBeNull();
      // A step to the side, behind the merlon, his standing head is covered, but the slit in it is at his eye.
      const side = V(-f.z, 0, f.x).multiplyScalar(1);
      const behind = V(at.x + side.x, at.y + 1.78, at.z + side.z);
      expect(physics.raycast(behind, f, 3, CG.World), `${p.id} merlon`).not.toBeNull();
      expect(physics.raycast(V(behind.x, at.y + 1.5, behind.z), f, 4, CG.World), `${p.id} slit`).toBeNull();
    }
  });

  it('lets a man walk every catwalk and onto every bastion from the core', () => {
    openRings(['outer', 'middle', 'core']);
    const core = V(1, 0, 1);
    const lost: string[] = [];
    let tried = 0;
    for (const r of plan.RINGS) {
      for (let i = 0; i < 4; i++) {
        const [a, b] = plan.rampartSpan(r, i);
        for (let u = a + 0.6; u < b - 0.5; u += 2) {
          const [x, z] = plan.rot(i, u, -r.half + 2.2);
          // The deck runs on over the gates; the gun pads cut it, and are checked as guns.
          if (r.guns.some(g => g.side === i && Math.abs(u - g.u) < plan.GUN_PAD.half + plan.GUN_PAD.ramp + 0.3)) continue;
          // So do the stairs up to a bastion; its top is checked below.
          if ((r.bastions.includes(i) && u < a + plan.STAIR.tower + 0.3) || (r.bastions.includes((i + 1) & 3) && u > b - plan.STAIR.tower - 0.3)) continue;
          const p = V(x, plan.LEVEL.deck, z);
          tried++;
          if (!onFloor(p) || !(route(p, core) < 400)) lost.push(`${r.id} side ${i} at ${u.toFixed(1)}`);
        }
        if (r.bastions.includes(i)) {
          const [x, z] = plan.rot(i, -r.half + 2.4, -r.half + 2.4);
          const p = V(x, plan.LEVEL.tower, z);
          if (!onFloor(p) || !(route(p, core) < 400)) lost.push(`${r.id} bastion ${i}`);
        }
      }
    }
    expect(lost).toEqual([]);
    expect(tried).toBeGreaterThan(150);
  });

  it('is sealed by its walls, and each ring opens through its own gates', () => {
    const field = V(0, 0, -90), outer = V(40, 0, 40), middle = V(-20, 0, 20), core = V(1, 0, 1);
    openRings([]);
    expect(route(field, outer)).toBe(Infinity);
    openRings(['outer']);
    expect(route(field, outer)).toBeLessThan(250);
    expect(route(field, middle)).toBe(Infinity);
    openRings(['outer', 'middle']);
    expect(route(field, middle)).toBeLessThan(250);
    expect(route(field, core)).toBe(Infinity);
    openRings(['outer', 'middle', 'core']);
    expect(route(field, core)).toBeLessThan(250);
    openRings([]);
  });

  it('has no way down off a catwalk, a gun step or a tower but its stairs: no drop through the wall that stands there', () => {
    // The walls go up after the nav sample, so the sample has drops from the deck's outer edge over the wall line.
    const outside: Record<string, THREE.Vector3> = { outer: V(0, 0, -90), middle: V(40, 0, 40), core: V(-20, 0, 20) };
    const leaks: string[] = [];
    let tried = 0, open = 0;
    for (const shut of [true, false]) {
      openRings(shut ? [] : ['outer', 'middle', 'core']);
      for (const r of plan.RINGS) {
        nav().setBlocked(1e6, 1e6, 0, 1, 0, 0, 0, false);
        nav().setTarget(outside[r.id]!);
        nav().settle();
        for (let i = 0; i < 4; i++) {
          const [a, b] = plan.rampartSpan(r, i);
          for (let u = a + 0.6; u < b - 0.5; u += 1) {
            for (const v of [-r.half + 0.6, -r.half + 1.5, -r.half + 2.5]) {
              const [x, z] = plan.rot(i, u, v);
              for (const y of [plan.LEVEL.deck, plan.LEVEL.gun, plan.LEVEL.tower]) {
                const p = V(x, y, z);
                if (!onFloor(p, 0.6)) continue;
                const out = Number.isFinite(nav().pathDistance(p));
                if (!shut) open += out ? 1 : 0;
                else if (++tried && out) leaks.push(`${r.id} side ${i} at ${u.toFixed(1)},${v.toFixed(1)} y ${y}`);
              }
            }
          }
        }
      }
    }
    openRings([]);
    expect(leaks).toEqual([]);
    // Not for want of floor: with the gates up, the same men walk down the stairs and out.
    expect(tried).toBeGreaterThan(400);
    expect(open).toBe(tried);
  });

  it('walks a new hire from the rally point to every mounted gun and every post, through the shut gates, up the stairs', async () => {
    // The real allies on the real floor: their routes, their lift-gate waits, their steering. Nobody shoots; gates rise as they come.
    const { AllySystem } = await import('../../../allies/index');
    const away = V(0, -50, 0);
    const ctx = {
      time: { elapsed: 0, dt: 1 / 30, playerDt: 1 / 30 }, world, physics,
      player: { position: away, eye: away, forward: V(0, 0, -1), velocity: V(0, 0, 0), yaw: 0, alive: false, parked: false, takeDamage: vi.fn() },
      enemies: { raycast: () => null, applyDamage: vi.fn(), query: () => 0, outpost: null, vehicles: null },
      combat: new Proxy({}, { get: () => vi.fn() }), gore: { wound: vi.fn(), ragdoll: vi.fn(), raycastCharacter: () => null },
      fx: new Proxy({}, { get: () => vi.fn() }), audio: { play: vi.fn() }, hud: { floatText: vi.fn(), feed: vi.fn(), follow: () => () => {} },
      events: { on: vi.fn(), emit: vi.fn() }, render: { materials: { patch: (m: unknown) => m }, scene: new THREE.Scene() },
      characters: { spawn: fakeChar }, input: { pressed: () => false, isDown: () => false, labelFor: () => 'E' }, progression: {},
    };
    const sys = new AllySystem(ctx as unknown as Ctx);
    // The walls tend their gates for whoever is in the game's allies.
    (gameCtx as unknown as { allies?: unknown }).allies = sys;
    openRings([]);
    const rally = V(plan.FORT_RALLY[0], 1, plan.FORT_RALLY[2]);
    expect(nav().nearest(rally, 6, rally)).toBe(true);
    const goals: { id: string; to: THREE.Vector3; gun: boolean }[] = world.spec.emplacements.map((e, i) => ({
      // Where the gun's man stands (vehicles/emplacement.ts STAND_BACK): a step behind the tripod.
      id: `gun ${i}`, to: V(e.pos.x + Math.sin(e.yaw) * 0.95, e.pos.y, e.pos.z + Math.cos(e.yaw) * 0.95), gun: true,
    }));
    const posts = [...plan.FORT_POSTS.map(p => ({ id: p.id, pos: p.pos })), ...plan.FORT_BREACH_POINTS.map((b, i) => ({ id: `riot ${i}`, pos: b.pos }))];
    for (const p of posts) {
      const to = V(p.pos[0], p.pos[1] + 1, p.pos[2]);
      expect(nav().nearest(to, 3, to), p.id).toBe(true);
      goals.push({ id: p.id, to, gun: false });
    }
    const t = ctx.time;
    const stuck: string[] = [];
    for (const g of goals) {
      sys.reset();
      const a = sys.spawn('gunner', rally.clone(), g.to.clone(), 2, 0)!;
      if (g.gun) a.mount = { standAt: g.to, pivot: g.to, spec: { yaw: 0, arc: 1 }, occupant: null, occupy: () => true, vacate: () => {}, aimAt: () => {}, trigger: () => {} } as never;
      const e = a.body;
      let there = false;
      // The far corner of the fort is about 200 m of walking at a post's pace.
      for (let i = 0; i < 150 * 30 && !there; i++) {
        t.elapsed += t.dt;
        sys.update();
        world.objects.walls.update(t.dt);
        there = Math.hypot(e.position.x - g.to.x, e.position.z - g.to.z) < 0.8 && Math.abs(e.position.y - g.to.y) < 0.6;
      }
      if (!there) stuck.push(`${g.id}: at ${e.position.toArray().map(n => n.toFixed(1))}, for ${g.to.toArray().map(n => n.toFixed(1))}`);
    }
    sys.reset();
    (gameCtx as unknown as { allies?: unknown }).allies = undefined;
    world.objects.walls.update(0);
    expect(stuck).toEqual([]);
    expect(goals.length).toBe(plan.FORT_GUNS.length + posts.length);
  }, 120000);

  it('throws a man off a jump pad at a damaged wall over it, onto the catwalk', async () => {
    const { PAD, padSpots } = await import('../../../contracts/defense/siege');
    const { leapTo, updateMovement } = await import('../../../enemies/movement');
    const { Enemy } = await import('../../../enemies/Enemy');
    const walls = world.objects.walls;
    const w = { ctx: { world, physics }, director: { spendRay: () => false }, enemies: { rescue: vi.fn() }, player: { position: V(0, -50, 0) }, now: 0 };
    const bad: string[] = [];
    let lowest = Infinity;
    // A plain stretch of each ring, and a gun's port.
    for (const at of [V(-10, 1, -52), V(32, 1, 6), V(-6, 1, -14), V(52, 1, -26)]) {
      const piece = walls.all.find(p => p.kind === 'wall' && walls.distance(p, at) < 0.6)!;
      expect(piece, at.toArray().join()).toBeDefined();
      walls.setStage(piece, 1);
      const spec = (piece as unknown as { spec: { x: number; z: number } }).spec;
      const out = V(0, 0, 0), land = V(0, 0, 0);
      padSpots(spec, out, land);
      const n = V(Math.sign(out.x - spec.x), 0, Math.sign(out.z - spec.z));
      // From the pad's middle and anywhere at the edge of its reach.
      for (let k = 0; k <= 8; k++) {
        const e = new Enemy();
        e.char = fakeChar() as never;
        const r = k === 0 ? 0 : PAD.reach - 0.05, ang = (k / 8) * Math.PI * 2;
        e.position.set(out.x + Math.cos(ang) * r, 0, out.z + Math.sin(ang) * r);
        leapTo(e, land, PAD.flight, PAD.apex);
        for (let i = 0; i < 200 && e.airborne; i++) {
          updateMovement(e, w as never, 1 / 60, []);
          // Over the wall's thickness, and a body's width either side of it: feet over its top.
          const across = (e.position.x - spec.x) * n.x + (e.position.z - spec.z) * n.z;
          if (Math.abs(across) < plan.FORT_WALL.thick / 2 + 0.3) lowest = Math.min(lowest, e.position.y - plan.FORT_WALL.height);
        }
        const inward = -((e.position.x - spec.x) * n.x + (e.position.z - spec.z) * n.z);
        const deck = e.position.y > plan.LEVEL.deck - 0.05 && e.position.y < plan.LEVEL.gun + 0.05;
        if (e.airborne || !deck || inward < plan.RAMPART.from || inward > plan.RAMPART.to) {
          bad.push(`${at.toArray()} from ${k}: ${e.position.toArray().map(v => v.toFixed(2))}`);
        }
      }
      walls.setStage(piece, 0);
    }
    expect(bad).toEqual([]);
    expect(lowest).toBeGreaterThan(0.5);
  });

  it('opens a way in through a breach, under the catwalk', () => {
    openRings([]);
    const walls = world.objects.walls;
    const north = walls.all.find(p => p.kind === 'wall' && walls.distance(p, V(-10, 1, -52)) < 0.6)!;
    walls.setStage(north, 2);
    expect(route(V(-10, 0, -70), V(-10, 0, -40))).toBeLessThan(80);
    walls.setStage(north, 0);
    expect(route(V(-10, 0, -70), V(-10, 0, -40))).toBe(Infinity);
  });

  it('puts every shop in its ring, its counter on the floor inside its own building', () => {
    openRings(['outer', 'middle', 'core']);
    expect(plan.FORT_SHOPS.map(s => s.id)).toEqual(['barracks', 'armoury', 'infirmary']);
    for (const s of plan.FORT_SHOPS) {
      const a = P(s.anchor);
      expect(plan.ringAt(a.x, a.z), s.id).toBe(s.ring);
      expect(plan.ringAt(s.target.min[0], s.target.min[2]), s.id).toBe(s.ring);
      expect(plan.ringAt(s.target.max[0], s.target.max[2]), s.id).toBe(s.ring);
      expect(a.x > s.target.min[0] && a.x < s.target.max[0] && a.z > s.target.min[2] && a.z < s.target.max[2], s.id).toBe(true);
      expect(onFloor(a), s.id).toBe(true);
      expect(route(a, V(1, 0, 1)), s.id).toBeLessThan(200);
      // Something solid in front of the buyer: the counter.
      const f = V(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
      expect(physics.raycast(V(a.x, 0.8, a.z), f, 2, CG.World), s.id).not.toBeNull();
      // The keeper: on the floor inside, the counter between him and the buyer, facing the buyer, a way round to the core.
      const kp = P(s.keeper.pos);
      expect(kp.x > s.target.min[0] && kp.x < s.target.max[0] && kp.z > s.target.min[2] && kp.z < s.target.max[2], `${s.id} keeper`).toBe(true);
      expect(onFloor(kp), `${s.id} keeper`).toBe(true);
      const toBuyer = V(a.x - kp.x, 0, a.z - kp.z);
      const hit = physics.raycast(V(kp.x, 0.8, kp.z), toBuyer.clone().normalize(), toBuyer.length(), CG.World);
      expect(hit, `${s.id} counter`).not.toBeNull();
      expect(Math.abs(Math.cos(s.keeper.yaw - s.yaw - Math.PI) - 1), `${s.id} keeper yaw`).toBeLessThan(1e-6);
      expect(route(kp, V(1, 0, 1)), `${s.id} keeper`).toBeLessThan(200);
      // Standing room behind the counter: a body fits, nothing at chest height within his reach to the sides.
      expect(physics.overlapCapsule(V(kp.x, 0.95, kp.z), 0.3, 0.5, CG.World), `${s.id} keeper room`).toBe(false);
    }
  });

  it('puts every ally post on a floor in its ring that the core can reach', () => {
    openRings(['outer', 'middle', 'core']);
    const bad: string[] = [];
    for (const p of plan.FORT_POSTS) {
      const at = P(p.pos);
      if (!onFloor(at)) bad.push(`${p.id} off the floor`);
      else if (!(route(at, V(1, 0, 1)) < 300)) bad.push(`${p.id} cut off`);
      if (plan.ringAt(at.x, at.z) !== p.ring) bad.push(`${p.id} in ${plan.ringAt(at.x, at.z)}`);
    }
    if (!onFloor(P(plan.FORT_RALLY)) || plan.ringAt(plan.FORT_RALLY[0], plan.FORT_RALLY[2]) !== 'outer') bad.push('rally');
    for (const b of plan.FORT_BREACH_POINTS) if (!onFloor(P(b.pos)) || plan.ringAt(b.pos[0], b.pos[2]) !== b.ring) bad.push(`breach ${b.pos.join(',')}`);
    expect(bad).toEqual([]);
    const types = new Set(plan.FORT_POSTS.map(p => p.type));
    for (const t of ['rifleman', 'gunner', 'sniper', 'rocketeer', 'shotgunner', 'medic', 'mortar']) expect(types.has(t as never), t).toBe(true);
    expect(plan.FORT_POSTS.filter(p => p.type === 'sniper').every(p => p.pos[1] === plan.LEVEL.tower)).toBe(true);
  });

  it('spawns everyone outside the outer wall, with a way on foot to every outer gate', () => {
    openRings([]);
    const O = plan.ring('outer').half;
    const spawns = [...plan.FORT_SPAWNS.foot, ...plan.FORT_SPAWNS.vehicle];
    for (const s of spawns) {
      expect(Math.max(Math.abs(s.pos[0]), Math.abs(s.pos[2]))).toBeGreaterThan(O + 30);
      expect(onFloor(P(s.pos))).toBe(true);
    }
    for (const g of plan.ring('outer').gates) {
      const [x, z] = plan.rot(g.side, g.u, -O - 4);
      for (const s of spawns) expect(route(P(s.pos), V(x, 0, z)), `${s.pos} to gate ${g.side}`).toBeLessThan(400);
    }
    for (const m of plan.FORT_MORTARS) {
      const at = P(m.pos);
      expect(onFloor(at)).toBe(true);
      expect(Math.max(Math.abs(at.x), Math.abs(at.z))).toBeGreaterThan(O + 20);
      // Sandbags between the tube and the fort.
      expect(physics.raycast(V(at.x, 0.8, at.z), V(-Math.sin(m.yaw), 0, -Math.cos(m.yaw)), 5, CG.World)).not.toBeNull();
    }
    expect(world.spawnPoints.filter(s => s.kind === 'ground').length).toBe(plan.FORT_SPAWNS.foot.length);
  });

  it('keeps every lane, road and landing zone clear for vehicles', () => {
    const blocked: string[] = [];
    for (const lane of [...plan.FORT_LANES, ...plan.FORT_ROADS]) {
      for (let i = 0; i + 1 < lane.points.length; i++) {
        const [ax, az] = lane.points[i]!, [bx, bz] = lane.points[i + 1]!;
        const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
        for (let off = -lane.width / 2 + 0.4; off <= lane.width / 2 - 0.4; off += 1.2) {
          for (const h of [0.5, 2.4]) {
            if (physics.raycast(V(ax - uz * off, h, az + ux * off), V(ux, 0, uz), len, CG.World)) blocked.push(`${lane.id} ${i} off ${off.toFixed(1)} h ${h}`);
          }
        }
      }
    }
    for (const lz of plan.FORT_LZ) {
      for (let a = 0; a < 12; a++) for (const r of [0, lz.radius / 2, lz.radius]) {
        const hit = physics.raycast(V(lz.pos[0] + Math.cos(a) * r, 8, lz.pos[2] + Math.sin(a) * r), DOWN, 10, CG.World);
        if (!hit || hit.point.y > 0.05) blocked.push(`lz ${lz.pos} at ${a},${r}`);
      }
    }
    expect(blocked).toEqual([]);
  });
});
