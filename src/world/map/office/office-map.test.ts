/**
 * The Office, built for real (Rapier, the nav sample) and held to what both survival modes need of it: a budget, every entrance and
 * every room on one connected nav, the supply pod's spots under open sky, and the floors joined more than one way.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { type Action, CG, type Ctx } from '../../../core/contracts';

type WorldT = import('../../World').World;
type Plan = typeof import('./plan');
type Rig = ReturnType<typeof import('../outpost/proof').rigOf>;
type Parkour = typeof import('./parkour');

let world: WorldT;
let plan: Plan;
let physics: Ctx['physics'];
let rig: Rig;
let parkour: Parkour;

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
  parkour = await import('./parkour');
  const proof = await import('../outpost/proof');
  const game = await createHeadlessGame(() => {});
  (game.ctx as unknown as { weapons: unknown }).weapons = { occupy: () => {} };
  physics = game.ctx.physics;
  world = new World(game.ctx);
  (game.ctx as Ctx).world = world;
  await world.build();
  rig = proof.rigOf(game);
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

  describe('the breakables', () => {
    const props = () => world.objects.props;
    const step = (seconds: number) => { for (let t = 0; t < seconds; t += 1 / 60) props().update(1 / 60); };
    const of = (kind: string) => props().props.filter(p => p.kind === kind);
    const booms: { radius: number; damage: number }[] = [];

    it('places every kind, in a budget of draws', () => {
      const kinds = new Set(props().props.map(p => p.kind));
      for (const k of ['monitor', 'chair', 'plant', 'divider', 'pane', 'copier', 'rack', 'cooler', 'extinguisher', 'vending', 'microwave', 'generator', 'gasline']) {
        expect(kinds.has(k as never), k).toBe(true);
      }
      expect(props().count).toBeGreaterThan(300);
      let meshes = 0;
      props().root.traverse(o => { if ((o as THREE.InstancedMesh).isInstancedMesh && !o.name.startsWith('debris')) meshes++; });
      expect(meshes).toBeLessThan(45);
      console.info('breakables', JSON.stringify({ props: props().count, meshes, panes: of('pane').length, chairs: of('chair').length }));
    });

    it('breaks a monitor on a round: its collider goes, its wreck stays', () => {
      const m = of('monitor')[0]!;
      const collider = m.collider!;
      expect(world.objects.damageExplosive(collider, 5, 'test')).toBe(false);
      expect(m.alive).toBe(true);
      world.objects.damageExplosive(collider, 20, 'test');
      expect(m.alive).toBe(false);
      expect(m.collider).toBeNull();
    });

    it('shatters a storefront pane and opens the nav through it', () => {
      const pane = of('pane').find(p => Math.abs(p.spec.z - plan.B.z1) < 0.1 && p.spec.y < 2)!;
      const before = Array.from(nav().blocked).reduce((a, b) => a + b, 0);
      world.objects.damageExplosive(pane.collider!, 50, 'test');
      expect(pane.alive).toBe(false);
      expect(Array.from(nav().blocked).reduce((a, b) => a + b, 0)).toBeLessThan(before);
    });

    it('chains: one server rack takes the row with it, and every blast is a real one', () => {
      const off = (world as unknown as { ctx: Ctx }).ctx;
      const listener = (e: { radius: number; damage: number }) => booms.push(e);
      off.events.on('world:explosion', listener);
      const racks = of('rack').filter(p => p.spec.y === 0);
      const first = racks[0]!;
      world.objects.damageExplosivesInRadius(first.p.clone().setY(1), 1.5, 1000, 'test');
      step(4);
      const down = racks.filter(p => !p.alive).length;
      expect(down).toBeGreaterThan(racks.length * 0.8);
      expect(booms.length).toBeGreaterThanOrEqual(down);
      expect(booms.every(b => b.radius >= 2 && b.damage >= 20)).toBe(true);
      // The burnt racks still stand: their colliders and their nav blocks stay.
      expect(racks.every(p => p.alive || p.collider)).toBe(true);
    });

    it('sets off the gas line valve by valve, and not the server room through its wall', () => {
      world.objects.reset();
      const yard = of('gasline').filter(p => p.spec.x < -28);
      const racks = of('rack').filter(p => p.spec.y === 0);
      world.objects.damageExplosive(yard[0]!.collider!, 100, 'test');
      step(3);
      expect(yard.every(p => !p.alive)).toBe(true);
      expect(racks.every(p => p.alive)).toBe(true);
    });

    it('caps the chairs that tumble at once, and settles them', () => {
      const chairs = of('chair').filter(p => p.alive && p.collider);
      for (const c of chairs.slice(0, 40)) world.objects.damageExplosive(c.collider!, 5, 'test');
      const moving = (props() as unknown as { moving: unknown[] }).moving.length;
      expect(moving).toBeLessThanOrEqual(24);
      for (let t = 0; t < 8; t += 1 / 60) { physics.step(1 / 60); props().update(1 / 60); }
      expect((props() as unknown as { moving: unknown[] }).moving.length).toBe(0);
      expect(chairs.slice(0, 40).every(c => c.collider)).toBe(true);
    });

    it('puts everything back on a new run', () => {
      world.objects.reset();
      expect(props().props.every(p => p.alive && p.collider)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------------------------------
  // The parkour lines, played: the real Player, keys pressed as a person would.
  // -----------------------------------------------------------------------------------------------
  describe('the parkour lines', () => {
    const ALL: readonly Action[] = ['forward', 'back', 'left', 'right', 'jump', 'dash', 'slide'];
    type Body = Rig['player'] & { climbing: boolean; clinging: boolean; position: THREE.Vector3; yaw: number };
    const body = () => rig.player as Body;
    const frames = (n: number) => { for (let i = 0; i < n; i++) rig.step(); };
    const hold = (a: Action, down = true) => rig.input.simulate(a, down);
    const tap = (a: Action) => { hold(a); rig.step(); hold(a, false); };
    const until = (done: () => boolean, seconds: number): boolean => {
      for (let t = 0; t < seconds; t += 1 / 60) { if (done()) return true; rig.step(); }
      return done();
    };
    const face = (x: number, z: number) => { const p = body().position; body().yaw = Math.atan2(-(x - p.x), -(z - p.z)); };
    function place(x: number, y: number, z: number, lx: number, lz: number): void {
      for (const a of ALL) hold(a, false);
      rig.input.consumeLook();
      rig.player.reset();
      rig.player.teleport(V(x, y + 0.05, z), 0);
      face(lx, lz);
      frames(6);
    }
    /** Runs toward (x, z) with W held, steering, pressing jump once when `jumpAt` says so, until `done`. */
    function run(x: number, z: number, jumpAt: () => boolean, done: () => boolean, seconds = 4, second?: () => boolean): void {
      hold('forward');
      let jumped = false, again = false;
      until(() => {
        face(x, z);
        if (!jumped && jumpAt()) { tap('jump'); jumped = true; }
        else if (jumped && !again && second?.()) { tap('jump'); again = true; }
        return done();
      }, seconds);
      hold('forward', false);
    }
    /** A jump at the face ahead with W held: the climb, and the mantle at its top. */
    function climbAhead(seconds = 3): void {
      hold('forward');
      tap('jump');
      until(() => body().climbing, 1);
      until(() => !body().climbing && !body().clinging && body().grounded, seconds);
      hold('forward', false);
    }
    const on = (y: number) => Math.abs(body().position.y - y) < 0.25 && body().grounded;

    it('climbs the plaza: planter, canopy, gondola, in at the broken window', () => {
      // Off the planter, up the fin under the canopy's east end.
      place(12.2, 0.9, 20.3, 0, 20.3);
      climbAhead();
      expect(on(plan.CANOPY.top), `canopy, at ${body().position.toArray().map(v => v.toFixed(2))}`).toBe(true);
      // Along the canopy and over the 2 m gap onto the gondola.
      place(6, plan.CANOPY.top, 21.4, 20, 18.9);
      run(16, 18.9, () => body().position.x > 10.3, () => body().position.x > 14 && body().grounded, 4);
      expect(on(parkour.GONDOLA.y), `gondola, at ${body().position.toArray().map(v => v.toFixed(2))}`).toBe(true);
      // In over the sill.
      run(20, 15, () => body().position.z < 18.6, () => body().position.z < 17 && body().grounded, 4);
      expect(body().position.z < 17.4 && body().position.y < plan.LV.f2 + 1.3, `inside, at ${body().position.toArray().map(v => v.toFixed(2))}`).toBe(true);
    });

    it('climbs the scaffold to the Director\'s bay and to the roof', () => {
      const S = parkour.SCAFFOLD, x = (S.x0 + S.x1) / 2;
      place(S.x0 - 1.2, 0, 1, S.x1, 1);
      climbAhead();
      expect(on(2.2), `T1, at ${body().position.toArray().map(v => v.toFixed(2))}`).toBe(true);
      // Up the end of the third tier, a jump and a climb.
      place(x, 2.2, -1.2, x, -6);
      climbAhead(4);
      expect(on(6.6), `T3, at ${body().position.toArray().map(v => v.toFixed(2))}`).toBe(true);
      // Down to the first floor's run and in at the bay.
      place(x, 6.6, -6, x, -12);
      run(x, -12, () => false, () => body().position.z < -11 && body().grounded, 4);
      run(-26, -12, () => false, () => body().position.x > -26.5, 4);
      expect(on(plan.LV.f2), `bay, at ${body().position.toArray().map(v => v.toFixed(2))}`).toBe(true);
      // From the third tier up the wall to the roof.
      place(S.x1 - 0.5, 6.6, -5, S.x1 + 3, -5);
      climbAhead(4);
      expect(body().position.y, `roof, at ${body().position.toArray().map(v => v.toFixed(2))}`).toBeGreaterThan(plan.LV.roof - 0.1);
    });

    it('runs the sign across the gap to the car park roof, which a plain jump cannot cross', () => {
      const S = parkour.SIGN;
      // A run and one jump well away from the sign falls into the lane.
      place(18, plan.LV.roof, 2, 40, 2);
      run(46, 2, () => body().position.x > 26.6, () => body().grounded && body().position.x > 29.5, 4);
      expect(body().position.y, 'a plain jump falls').toBeLessThan(plan.LV.f2 + 0.5);
      // Along the sign's face: a jump over the parapet, then strafing into the wall as the run takes.
      place(18, plan.LV.roof, S.z + 0.7, 46, S.z + 0.7);
      let ran = false, jumped = false, again = false, f = 0;
      const trace: string[] = [];
      hold('forward');
      until(() => {
        const p = body().position;
        face(46, S.z + 0.7);
        if (!jumped && p.x > 26.6) { tap('jump'); jumped = true; hold('left'); }
        if (jumped && !again && p.x > 38) { tap('jump'); again = true; }
        if (f++ % 6 === 0) trace.push(`${p.toArray().map(v => v.toFixed(1)).join(',')} g${+body().grounded} w${+body().wallRunning}`);
        ran ||= body().wallRunning;
        return body().grounded && p.x > 30;
      }, 5);
      hold('forward', false);
      hold('left', false);
      expect(ran, `wall ran: ${trace.join(' | ')}`).toBe(true);
      expect(on(plan.LV.roof) && body().position.x > plan.PARK.x0, `car park roof, at ${body().position.toArray().map(v => v.toFixed(2))}`).toBe(true);
    });

    it('reaches the perch on the tower from the AC unit', () => {
      place(-17, 11, -4.2, -17, -9);
      climbAhead();
      expect(on(parkour.PERCH.y), `perch, at ${body().position.toArray().map(v => v.toFixed(2))}`).toBe(true);
    });
  });
});
