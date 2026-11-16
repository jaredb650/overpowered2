/**
 * The Office, built for real (Rapier, the nav sample) and held to what both survival modes need of it: a budget, every entrance and
 * every room on one connected nav, the supply pod's spots under open sky, and the floors joined more than one way.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CG, type Ctx } from '../../../core/contracts';

type WorldT = import('../../World').World;
type Plan = typeof import('./plan');

let world: WorldT;
let plan: Plan;
let physics: Ctx['physics'];

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const DOWN = V(0, -1, 0);

beforeAll(async () => {
  vi.stubGlobal('location', { search: '?map=office' });
  const paint: unknown = new Proxy({}, { get: (_, key) => (key === 'measureText' ? () => ({ width: 100 }) : () => undefined), set: () => true });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => paint, style: {}, width: 0, height: 0 }) });
  const { World } = await import('../../World');
  const { createHeadlessGame } = await import('../../../player/testkit/headless');
  plan = await import('./plan');
  const game = await createHeadlessGame(() => {});
  (game.ctx as unknown as { weapons: unknown }).weapons = { occupy: () => {} };
  physics = game.ctx.physics;
  world = new World(game.ctx);
  (game.ctx as Ctx).world = world;
  await world.build();
  (physics as unknown as { flushQueries(): void }).flushQueries();
}, 180000);

const nav = () => world.navGraph;
const route = (from: THREE.Vector3, to: THREE.Vector3): number => {
  nav().setTarget(to);
  nav().settle();
  return nav().pathDistance(from);
};
const onNav = (p: THREE.Vector3, r = 1.5): boolean => {
  const out = V(0, 0, 0);
  return nav().nearest(V(p.x, p.y + 0.1, p.z), 3, out) && Math.hypot(out.x - p.x, out.z - p.z) < r && Math.abs(out.y - p.y) < 0.5;
};

describe('The Office', () => {
  it('is registered and inside the budget', () => {
    const r = world.report;
    expect(world.def.id).toBe('office');
    console.info('office', JSON.stringify({ triangles: r.triangles, colliders: r.colliders, lights: r.lights, meshes: r.meshes, nav: nav().nodeCount, links: r.navLinks }));
    expect(r.triangles as number).toBeLessThan(300000);
    expect(r.colliders as number).toBeLessThan(900);
    expect(r.lights as number).toBeLessThan(150);
  });

  it('puts every entrance and every room on one nav, reachable from the lobby both ways', () => {
    const hub = V(5, 0, 10);
    const lost: string[] = [];
    for (const s of world.spawnPoints.filter(p => p.kind === 'ground')) {
      if (!onNav(s.position)) lost.push(`entrance ${s.position.toArray()} off the nav`);
      else if (!(route(s.position, hub) < 400)) lost.push(`entrance ${s.position.toArray()} cannot reach the lobby`);
      else if (!(route(hub, s.position) < 400)) lost.push(`the lobby cannot reach entrance ${s.position.toArray()}`);
    }
    for (const r of plan.ROOMS) {
      const c = V((r.x0 + r.x1) / 2, plan.floorY(r.floor), (r.z0 + r.z1) / 2);
      const out = V(0, 0, 0);
      // The room's middle may hold furniture: any node in the room will do.
      if (!nav().nearest(V(c.x, c.y + 0.1, c.z), Math.min(r.x1 - r.x0, r.z1 - r.z0) / 2, out) || Math.abs(out.y - c.y) > 0.5) { lost.push(`${r.id} has no nav`); continue; }
      if (!(route(out, hub) < 400)) lost.push(`${r.id} cannot reach the lobby`);
    }
    expect(lost).toEqual([]);
  });

  it('keeps the flyers over open sky and the pickups on a floor', () => {
    for (const s of world.spawnPoints.filter(p => p.kind === 'air')) expect(physics.raycast(s.position, UP, 30, CG.World), s.position.toArray().join()).toBeNull();
    for (const p of world.pickupSpots) {
      const hit = physics.raycast(V(p.x, p.y + 1, p.z), DOWN, 2, CG.World);
      expect(hit, p.toArray().join()).not.toBeNull();
      expect(Math.abs(hit!.point.y - p.y), p.toArray().join()).toBeLessThan(0.1);
    }
  });

  it('gives the supply pod open sky over every outdoor spot, with one in reach of anywhere', () => {
    const open = world.pickupSpots.filter(p => physics.raycast(V(p.x, p.y + 1, p.z), UP, 60, CG.World) === null);
    expect(open.length).toBe(plan.PICKUPS_OUT.length);
    for (const p of plan.PICKUPS_OUT) expect(open.some(o => o.distanceTo(V(p[0], p[1], p[2])) < 0.01), p.join()).toBe(true);
    // Every room's middle is within a run of one: the pod's farthest is 110 m (SUPPLY.far).
    for (const r of plan.ROOMS) {
      const c = V((r.x0 + r.x1) / 2, plan.floorY(r.floor), (r.z0 + r.z1) / 2);
      expect(Math.min(...open.map(o => o.distanceTo(c))), r.id).toBeLessThan(60);
    }
  });

  it('joins the floors more than one way', () => {
    const up = V(11.5, plan.LV.f2, 8), roof = V(0, plan.LV.roof, 10), lobby = V(5, 0, 10);
    expect(onNav(up)).toBe(true);
    expect(onNav(roof)).toBe(true);
    expect(route(lobby, up)).toBeLessThan(120);
    expect(route(up, roof)).toBeLessThan(100);
    // The car park's deck reaches the open office over the skybridge.
    expect(route(V(47, plan.LV.f2, 0), up)).toBeLessThan(120);
    expect(route(V(60, plan.LV.roof, 4), lobby)).toBeLessThan(200);
  });
});
