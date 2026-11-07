/**
 * The Outpost, held to what the mission needs of it. parkour.test.ts proves the numbers on bare boxes. This proves them on the map,
 * with real Rapier and the real Player, because a wall skin or a stair in the wrong place can break a lesson without changing a number.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../../../core/contracts';

type Proof = typeof import('./proof');
type Game = Awaited<ReturnType<typeof import('../../../player/testkit/headless').createHeadlessGame>>;
type WorldT = import('../../World').World;

let proof: Proof;
let game: Game;
let world: WorldT;
let rig: ReturnType<Proof['rigOf']>;
let parkour: ReturnType<Proof['provePark']>;

beforeAll(async () => {
  // Which map a page runs is fixed at import, by its URL. Canvas painting only feeds textures, which nothing here looks at.
  vi.stubGlobal('location', { search: '?map=outpost' });
  const paint: unknown = new Proxy({}, { get: (_, key) => (key === 'measureText' ? () => ({ width: 100 }) : () => undefined), set: () => true });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => paint, style: {}, width: 0, height: 0 }) });
  const { World } = await import('../../World');
  const { createHeadlessGame } = await import('../../../player/testkit/headless');
  proof = await import('./proof');
  game = await createHeadlessGame(() => {});
  world = new World(game.ctx);
  (game.ctx as Ctx).world = world;
  await world.build();
  rig = proof.rigOf(game);
}, 60000);

const allTrue = (checks: Record<string, unknown>): void => {
  for (const [name, passed] of Object.entries(checks)) expect(passed, name).toBe(true);
};

describe('the map', () => {
  it('is inside its budget, in boxes', () => {
    const report = proof.verifyOutpost(world, game.ctx.physics);
    expect(world.report.triangles as number).toBeLessThan(300000);
    expect(world.report.colliders as number).toBeLessThan(600);
    expect(Object.keys(report.colliders)).toEqual(['box']);
  });

  it('puts a floor and nav under every mark, and a real hole behind every door', () => {
    const { marks, flow, doors, zones } = proof.verifyOutpost(world, game.ctx.physics);
    expect(marks).toEqual({ noFloor: [], offNav: [], buried: [] });
    expect(flow.noRoute).toEqual([]);
    expect(zones.dead).toEqual([]);
    for (const [id, d] of Object.entries(doors)) {
      expect(Math.abs(d.width - d.want), id).toBeLessThan(0.1);
      expect(Math.abs(d.head - d.wantHead), id).toBeLessThan(0.05);
      expect(d.blocked, id).toBe(false);
      expect(d.navFront && d.navBack, id).toBe(true);
    }
  });

  it('keeps every road clear for a tank', () => {
    const { roads } = proof.verifyOutpost(world, game.ctx.physics);
    expect(roads.blocked).toEqual([]);
    expect(roads.roads).toEqual(['perimeter', 'gate']);
  });

  it('gives the men cover in every room', () => {
    const { cover } = proof.verifyOutpost(world, game.ctx.physics);
    for (const room of ['THE APRON', 'GATE YARD', 'SALLY HALL', 'SOUTH CORRIDOR', 'NORTH CORRIDOR', 'BUNK 1', 'BUNK 4', 'COOLANT HALL', 'MESS HALL', 'PLATE HALL', 'THE STACK', 'WAR ROOM', 'COMMS ROOF']) {
      expect(cover.byZone[room] ?? 0, room).toBeGreaterThan(10);
    }
  });
});

describe('the lessons, played on the map', () => {
  beforeAll(() => {
    parkour = proof.provePark(world, game.ctx.physics, rig);
  }, 600000);

  it('mantle out of the cut, and nothing else', () => allTrue(parkour.mantle));
  it('double jump to the wreck, never one', () => allTrue(parkour.doubleJump));
  it('mantle onto the two roofs', () => allTrue(parkour.roofs));
  it('the gate beats a run with both dashes', () => allTrue(parkour.gate));
  it('slide under the blast door', () => allTrue(parkour.slide));
  it('dash over the Coolant Hall, and back up from a fall', () => allTrue(parkour.dash));
  it('wall run down the gallery, and nothing else', () => allTrue(parkour.wallRun));
  it('kicks up the shaft', () => expect(parkour.shaft['kicks reach the top landing']).toBe(true));

  it('nobody gets out of the route', () => {
    const { bypasses, containment } = parkour;
    expect(containment.leaks).toBe(0);
    for (const name of ['pit, straight at the far wall', 'trench, straight at the far deck', 'apron over the south wall', 'apron through the shut gate', 'yard over the citadel front', 'yard through the shut blast door']) {
      expect((bypasses[name] as { over: boolean }).over, name).toBe(false);
    }
    expect((bypasses['apron, kicking up the pylon and the wall'] as { done: boolean }).done).toBe(false);
    expect((bypasses['trench, kicking between its walls to the far deck'] as { done: boolean }).done).toBe(false);
  });

  it('every stretch of the route can be walked by the real player', () => {
    for (const [leg, result] of Object.entries(parkour.walk)) expect(result, leg).toMatch(/ s$/);
  });
});

describe('at a run', () => {
  it('catches on no doorway and no seam', () => {
    const { doors, runs } = proof.sweepOutpost(world, game.ctx.physics, rig);
    expect(doors.tried).toBeGreaterThan(300);
    expect(doors.caught).toEqual([]);
    for (const [name, share] of Object.entries(runs)) expect(share, name).toBeGreaterThan(0.8);
  });

  it('random hands stay in the world', () => {
    const fuzz = proof.fuzzOutpost(rig, 6);
    expect(fuzz.inside).toBe(0);
    expect(fuzz.lost).toBe(0);
    expect(fuzz.escapes).toBe(0);
    expect(fuzz.wedged).toEqual([]);
  });
});
