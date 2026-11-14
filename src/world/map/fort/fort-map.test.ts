/**
 * The fort, built for real (Rapier, the nav sample, the walls going up after it) and held to what the mode needs of it: every catwalk
 * walkable from the core, each ring sealed by its walls and opened by its gates, posts and shops on floor in their rings, spawns out in
 * the field with a way to the outer gates, and the lanes and landing zones clear for vehicles.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CG, type Ctx, type Structure } from '../../../core/contracts';
import { WALL } from '../../structures';

type WorldT = import('../../World').World;
type Plan = typeof import('./plan');

let world: WorldT;
let plan: Plan;
let gates: Structure[];
let physics: Ctx['physics'];

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const P = (p: readonly number[]) => V(p[0]!, p[1]!, p[2]!);
const DOWN = V(0, -1, 0);

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
    expect(r.colliders as number).toBeLessThan(900);
    expect(r.lights as number).toBeLessThan(160);
    // Walls, gates and shacks are drawn a chunk at a time, not a group a piece.
    expect(world.objects.walls.root.children.length).toBeLessThan(40);
  });

  it('has three rings of walls with lift gates in each, and the guns on pads high enough to fire over them', () => {
    const walls = world.objects.walls.all;
    expect(walls.filter(p => p.kind === 'wall').length).toBeGreaterThan(150);
    for (const r of plan.RINGS) expect(r.gates.length).toBeGreaterThan(0);
    expect(gates.length).toBe(plan.RINGS.reduce((n, r) => n + r.gates.length, 0));
    expect(world.spec.emplacements.length).toBe(plan.FORT_GUNS.length);
    for (const e of world.spec.emplacements) {
      expect(e.pos.y + 1.2).toBeGreaterThan(WALL.height + 0.3);
      expect(onFloor(e.pos)).toBe(true);
    }
    expect(plan.LEVEL.deck).toBe(WALL.catwalk);
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
          // Gates and gun pads cut the deck; the pads are checked as guns.
          if (r.gates.some(g => g.side === i && Math.abs(u - g.u) < g.w / 2 + 0.4 + plan.STAIR.gate + 0.3)) continue;
          if (r.guns.some(g => g.side === i && Math.abs(u - g.u) < plan.GUN_PAD.half + plan.GUN_PAD.ramp + 0.3)) continue;
          // So do the stairs up to a bastion; its top is checked below.
          if ((r.bastions.includes(i) && u < a + plan.STAIR.tower + 0.3) || (r.bastions.includes((i + 1) & 3) && u > b - plan.STAIR.tower - 0.3)) continue;
          const p = V(x, plan.LEVEL.deck, z);
          tried++;
          if (!onFloor(p) || !(route(p, core) < 400)) lost.push(`${r.id} side ${i} at ${u.toFixed(1)}`);
        }
        if (r.bastions.includes(i)) {
          const [x, z] = plan.rot(i, -r.half + 2.2, -r.half + 2.2);
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

  it('opens a way in through a breach, over the rampart', () => {
    openRings([]);
    const walls = world.objects.walls;
    const north = walls.all.find(p => p.kind === 'wall' && walls.distance(p, V(-20, 1, -52)) < 0.6)!;
    walls.setStage(north, 2);
    expect(route(V(-20, 0, -70), V(-20, 0, -40))).toBeLessThan(80);
    walls.setStage(north, 0);
    expect(route(V(-20, 0, -70), V(-20, 0, -40))).toBe(Infinity);
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
