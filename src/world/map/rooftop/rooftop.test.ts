/**
 * Rooftop Skyline map & lethal fall kill-plane verification:
 * builds the real map (Rapier physics + NavGraph) and verifies bounds, LightVolume dims,
 * multi-skyscraper nav connectivity, stairwell doors, hover/paratrooper LZs, parkour surfaces,
 * and lethal fall kill-plane behavior for both player and enemies.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CG, type Ctx } from '../../../core/contracts';
import type { Enemy } from '../../../enemies/Enemy';
import type { AiWorld } from '../../../enemies/aiWorld';

type WorldT = import('../../World').World;
type Plan = typeof import('./plan');

let world: WorldT;
let plan: Plan;
let physics: Ctx['physics'];
let gameCtx: Ctx;

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const DOWN = V(0, -1, 0);

beforeAll(async () => {
  vi.stubGlobal('location', { search: '?map=rooftop' });
  const paint: unknown = new Proxy({}, { get: (_, key) => (key === 'measureText' ? () => ({ width: 100 }) : () => undefined), set: () => true });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => paint, style: {}, width: 0, height: 0 }) });
  const { World } = await import('../../World');
  const { createHeadlessGame } = await import('../../../player/testkit/headless');
  plan = await import('./plan');
  const game = await createHeadlessGame(() => {});
  (game.ctx as unknown as { weapons: unknown }).weapons = { occupy: () => {} };
  gameCtx = game.ctx;
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
const onNav = (p: THREE.Vector3, r = 1.6): boolean => {
  const out = V(0, 0, 0);
  return nav().nearest(V(p.x, p.y + 0.1, p.z), 3, out) && Math.hypot(out.x - p.x, out.z - p.z) < r && Math.abs(out.y - p.y) < 0.5;
};

describe('Rooftop Skyline map', () => {
  it('registers cleanly and stays inside geometry, NavGraph, and LightVolume limits', () => {
    const r = world.report;
    expect(world.def.id).toBe('rooftop');
    console.info('rooftop', JSON.stringify({
      triangles: r.triangles,
      colliders: r.colliders,
      lights: r.lights,
      meshes: r.meshes,
      navNodes: nav().nodeCount,
      navLinks: r.navLinks,
    }));

    expect(r.triangles as number).toBeLessThan(300000);
    expect(r.colliders as number).toBeLessThan(900);
    expect(r.lights as number).toBeLessThan(150);
    expect(nav().nodeCount).toBeGreaterThan(2500);

    // NavGraph hard limits: TOP_Y = 118, BOTTOM_Y = -19
    expect(world.bounds.max.y).toBeLessThanOrEqual(118);
    expect(world.bounds.min.y).toBeGreaterThanOrEqual(-19);

    // LightVolume hard limits: MAX_DIMS = [200, 48, 200]
    const lb = world.def.lightBounds;
    const size = new THREE.Vector3();
    lb.getSize(size);
    const cell = world.def.lightCell ?? 1.5;
    expect(Math.ceil(size.x / cell)).toBeLessThanOrEqual(200);
    expect(Math.ceil(size.y / cell)).toBeLessThanOrEqual(48);
    expect(Math.ceil(size.z / cell)).toBeLessThanOrEqual(200);
  });

  it('places killY cleanly below the lowest playable deck and above bounds.min.y', () => {
    const lowestDeck = Math.min(...plan.TOWERS.map(t => t.y));
    expect(world.spec.killY).toBe(plan.ROOFTOP_KILL_Y);
    expect(world.objects.killY).toBe(plan.ROOFTOP_KILL_Y);
    expect(plan.ROOFTOP_KILL_Y).toBeLessThan(lowestDeck - 10);
    expect(plan.ROOFTOP_KILL_Y).toBeGreaterThan(world.bounds.min.y + 5);

    // Hazard query reports lethal fall below killY and null on playable roofs.
    const low = world.objects.hazardAt(V(0, plan.ROOFTOP_KILL_Y - 0.5, 0));
    expect(low).not.toBeNull();
    expect(low!.kind).toBe('fall');
    expect(low!.lethal).toBe(true);
    expect(world.objects.hazardAt(V(0, lowestDeck, 0))).toBeNull();
  });

  it('mutually connects all 7 skyscrapers and walkable terraces to ROOFTOP_HUB', () => {
    const hub = plan.ROOFTOP_HUB;
    expect(onNav(hub)).toBe(true);

    const checkpoints: { label: string; p: THREE.Vector3 }[] = [
      ...plan.HOVER_DROP_ZONES.map(z => ({ label: z.id, p: V(z.x, z.y, z.z) })),
      { label: 'apex_penthouse', p: V(-13, plan.LV.helios, -6) },
      { label: 'helios_top', p: V(6, plan.LV.heliosTop, -58) },
      { label: 'meridian_terrace', p: V(-43, plan.LV.meridianTop, -7) },
      { label: 'bastion_water_deck', p: V(-16, plan.LV.vanguard, 52) },
      { label: 'citadel_mezz', p: V(63, plan.LV.apex, 40) },
    ];

    const broken: string[] = [];
    for (const c of checkpoints) {
      if (!onNav(c.p)) { broken.push(`${c.label} off nav`); continue; }
      const dTo = route(c.p, hub);
      const dFrom = route(hub, c.p);
      if (!(dTo < 500)) broken.push(`${c.label} cannot reach hub (${dTo})`);
      if (!(dFrom < 500)) broken.push(`hub cannot reach ${c.label} (${dFrom})`);
    }
    expect(broken).toEqual([]);
  });

  it('puts every stairwell door on a valid roof nav node with unit outward normal', () => {
    expect(plan.STAIRWELL_DOORS.length).toBeGreaterThanOrEqual(8);
    expect(world.spec.gates.length).toBe(plan.STAIRWELL_DOORS.length);
    for (const d of plan.STAIRWELL_DOORS) {
      expect(Math.hypot(d.nx, d.nz), d.id).toBeCloseTo(1, 5);
      const hit = physics.raycast(V(d.x, d.y + 1.2, d.z), DOWN, 2.5, CG.World);
      expect(hit, `${d.id} floor hit`).not.toBeNull();
      expect(Math.abs(hit!.point.y - d.y), `${d.id} floor y`).toBeLessThan(0.15);
      expect(onNav(V(d.x, d.y, d.z)), `${d.id} on nav`).toBe(true);
    }
  });

  it('keeps every hover drop zone, paratrooper LZ, and pickup spot on valid roofs under open sky', () => {
    for (const lz of plan.HOVER_DROP_ZONES) {
      const floor = physics.raycast(V(lz.x, lz.y + 1.2, lz.z), DOWN, 2.5, CG.World);
      expect(floor, `${lz.id} floor`).not.toBeNull();
      expect(Math.abs(floor!.point.y - lz.y), `${lz.id} floor y`).toBeLessThan(0.15);
      expect(physics.raycast(V(lz.x, lz.y + 1.0, lz.z), UP, 60, CG.World), `${lz.id} open sky`).toBeNull();
      expect(lz.hoverY, `${lz.id} hoverY`).toBeGreaterThan(lz.y + 8);
      expect(onNav(V(lz.x, lz.y, lz.z)), `${lz.id} on nav`).toBe(true);
    }
    for (const pz of plan.PARATROOPER_ZONES) {
      expect(physics.raycast(V(pz.x, pz.y + 1.0, pz.z), UP, 60, CG.World), `${pz.id} open sky`).toBeNull();
    }
    for (const p of world.pickupSpots) {
      const floor = physics.raycast(V(p.x, p.y + 1.2, p.z), DOWN, 2.5, CG.World);
      expect(floor, `pickup ${p.toArray()}`).not.toBeNull();
      expect(Math.abs(floor!.point.y - p.y), `pickup y ${p.toArray()}`).toBeLessThan(0.15);
      expect(physics.raycast(V(p.x, p.y + 1.0, p.z), UP, 60, CG.World), `pickup sky ${p.toArray()}`).toBeNull();
    }
  });

  it('provides solid parkour wall-run panels, chimney alleys, and high sniper perches', () => {
    // Wall-run panels have unbroken solid colliders at their midpoints.
    for (const p of plan.WALL_RUN_PANELS) {
      const cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2, cz = (p.z0 + p.z1) / 2;
      const alongX = (p.x1 - p.x0) > (p.z1 - p.z0);
      const hit = alongX
        ? physics.raycast(V(cx, cy, cz + 2), V(0, 0, -1), 4, CG.World)
        : physics.raycast(V(cx + 2, cy, cz), V(-1, 0, 0), 4, CG.World);
      expect(hit, `wall-run ${p.id}`).not.toBeNull();
    }

    // Meridian Chimney-Jump Alley (x = -50..-47, 3.0 m apart) has solid parallel faces on both sides.
    expect(physics.raycast(V(-48.5, 31, -6), V(-1, 0, 0), 2.2, CG.World)).not.toBeNull();
    expect(physics.raycast(V(-48.5, 31, -6), V(1, 0, 0), 2.2, CG.World)).not.toBeNull();

    // Vanguard Chimney-Jump Alley (z = -53..-50.2, 2.8 m apart) has solid parallel faces on both sides.
    expect(physics.raycast(V(-59, 34, -51.6), V(0, 0, -1), 2.2, CG.World)).not.toBeNull();
    expect(physics.raycast(V(-59, 34, -51.6), V(0, 0, 1), 2.2, CG.World)).not.toBeNull();

    // High sniper perches (Crane Boom y = 38.5 & Helios Comms Spire y = 44.5) have solid standable decks.
    const craneHit = physics.raycast(V(44, 40, -10), DOWN, 3, CG.World);
    expect(craneHit).not.toBeNull();
    expect(Math.abs(craneHit!.point.y - 38.5)).toBeLessThan(0.15);
    const spireHit = physics.raycast(V(-5, 46, -58), DOWN, 3, CG.World);
    expect(spireHit).not.toBeNull();
    expect(Math.abs(spireHit!.point.y - 44.5)).toBeLessThan(0.15);
  });

  it('triggers clean instant lethal fall death for player and falling enemies below killY', async () => {
    // 1. Player falling below killY dies cleanly without teleporting or getting stuck.
    const died: string[] = [];
    const off = gameCtx.events.on('player:died', e => died.push(e.source));
    gameCtx.player.teleport(V(0, plan.ROOFTOP_KILL_Y - 1, 0), 0);
    world.objects.update();
    off();
    expect(gameCtx.player.alive).toBe(false);
    expect(died).toEqual(['fell']);
    // Restore player state cleanly for any subsequent assertions.
    gameCtx.player.reset?.();
    expect(gameCtx.player.alive).toBe(true);

    // 2. Enemy falling below killY is killed via applyDamage('fell') instead of rescued/teleported.
    const { updateMovement } = await import('../../../enemies/movement');
    const applied: { source: string; type: string; amount: number }[] = [];
    const fakeEnemy = {
      alive: true,
      pinned: false,
      airborne: true,
      ballistic: false,
      flightLeft: 0,
      health: 120,
      verticalSpeed: -10,
      position: V(28, plan.ROOFTOP_KILL_Y - 0.5, 0),
      center: V(28, plan.ROOFTOP_KILL_Y + 0.4, 0),
      velocity: V(0, 0, 0),
      leapTarget: V(0, 0, 0),
      def: { id: 'trooper' },
    } as unknown as Enemy;
    const fakeAiWorld = {
      ctx: gameCtx,
      enemies: {
        applyDamage: (e: Enemy, dmg: { source: string; type: string; amount: number }) => {
          applied.push({ source: dmg.source, type: dmg.type, amount: dmg.amount });
          e.alive = false;
        },
        rescue: () => { throw new Error('enemy should die on killY, not be rescued'); },
      },
    } as unknown as AiWorld;

    updateMovement(fakeEnemy, fakeAiWorld, 1 / 60, []);
    expect(fakeEnemy.alive).toBe(false);
    expect(applied).toHaveLength(1);
    expect(applied[0]!.source).toBe('fell');
    expect(applied[0]!.type).toBe('true');
    expect(applied[0]!.amount).toBeGreaterThan(120);
  });
});
