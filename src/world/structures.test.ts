/**
 * Walls, gates and shacks on real Rapier and a real nav graph: what wears them, what each stage stops, the way through a
 * breach opening and closing, and repairs.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Ctx, Structure } from '../core/contracts';
import { noop } from '../core/stubs';
import { Physics } from '../physics/Physics';
import { Route, RouteFinder } from '../enemies/outpost/routes';
import { MapSpec } from './map/spec';
import { NavGraph } from './nav';
import { DebrisTuning } from './debris';
import { HEALTH, REPAIR_SECONDS, SHACK_BULLET, Structures, WALL } from './structures';

let physics: Physics;
let nav: NavGraph;
let walls: Structures;
let player: { position: THREE.Vector3; alive: boolean };
/** The wall run cuts the floor in two along z = 0. Its middle segment is `mid`; then the gate, then a shack in the south half. */
let mid: Structure;
let gate: Structure;
let shack: Structure;
const routes = new RouteFinder();

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const flush = () => physics.flushQueries();
/** A level ray along +Z through the wall line at (x, y). */
const blocked = (x: number, y: number): boolean => physics.raycast(V(x, y, -3), V(0, 0, 1), 6) !== null;
const southToNorth = (): number => {
  nav.setTarget(V(0, 0, 7));
  nav.settle();
  return nav.pathDistance(V(0, 0, -7));
};
const reset = () => {
  walls.reset();
  flush();
};

beforeAll(async () => {
  physics = await Physics.create();
  physics.addStaticBox(V(0, -0.5, 0), V(14, 0.5, 14), null, 'concrete');
  physics.flushQueries();
  nav = new NavGraph(physics);
  await nav.build(new THREE.Box3(V(-14, -3, -14), V(14, 10, 14)), [], V(0, 0, 8), async () => {}, {});

  const spec = new MapSpec();
  // Wall, gate, wall: right across the floor, so the only ways through are the gate and a breach.
  spec.wall(-14.4, 0, -2, 0);
  spec.wall(-2, 0, 2, 0);
  spec.wallGate(2, 0, 6, 0);
  spec.wall(6, 0, 14.4, 0);
  spec.shack(-8, -8, 0.3, 'planks');
  player = { position: V(100, 0, 100), alive: true };
  const ctx = {
    physics, fx: noop('fx'), audio: noop('audio'), player, enemies: { query: () => 0 },
  } as unknown as Ctx;
  walls = new Structures(ctx, spec.structures, () => new THREE.MeshBasicMaterial());
  walls.attach(nav);
  flush();
  routes.build(nav);
  mid = walls.all.find(p => p.kind === 'wall' && Math.abs(walls.distance(p, V(0, 1, 0))) < 0.01)!;
  gate = walls.all.find(p => p.kind === 'gate')!;
  shack = walls.all.find(p => p.kind === 'shack')!;
}, 60000);

describe('placing', () => {
  it('cuts a run into segments about 4 m long, pillar to pillar', () => {
    const spec = new MapSpec();
    spec.wall(0, 0, 13, 0);
    expect(spec.structures).toHaveLength(3);
    for (const s of spec.structures) expect(s.length).toBeCloseTo(13 / 3);
    expect(spec.structures.every(s => s.kind === 'wall' && s.yaw === 0)).toBe(true);
  });

  it('is cover from the ground and a parapet from the catwalk', () => {
    expect(1.62).toBeLessThan(WALL.height);
    expect(WALL.catwalk + 1.62 - WALL.height).toBeGreaterThan(0.2);
    expect(WALL.catwalk + 1.62 - WALL.height).toBeLessThan(0.5);
  });
});

describe('what wears them', () => {
  it('walls and gates ignore small arms; shacks are chipped by them', () => {
    reset();
    const ray = physics.raycast(V(0, 1.5, -3), V(0, 0, 1), 6)!;
    for (let i = 0; i < 200; i++) walls.hit(ray.collider, 80);
    expect(mid.stage).toBe('intact');
    expect(mid.health).toBe(HEALTH.wall[0]);
    const onShack = physics.raycast(V(-8, 1, -14), V(0, 0, 1), 10)!;
    expect(walls.pieceOf(onShack.collider)).toBe(shack);
    walls.hit(onShack.collider, 40);
    expect(shack.health).toBeCloseTo(HEALTH.shack[0] - 40 * SHACK_BULLET);
    for (let i = 0; i < 20; i++) walls.hit(onShack.collider, 40);
    expect(shack.stage).toBe('breached');
  });

  it('takes a wall to damaged at its first threshold and breached at its second, with a blast carrying over', () => {
    reset();
    walls.damage(mid, HEALTH.wall[0] - 1);
    expect(mid.stage).toBe('intact');
    walls.damage(mid, 1);
    expect(mid.stage).toBe('damaged');
    expect(mid.health).toBe(HEALTH.wall[1]);
    walls.damage(mid, HEALTH.wall[1]);
    expect(mid.stage).toBe('breached');
    expect(mid.health).toBe(0);
    reset();
    walls.damage(mid, HEALTH.wall[0] + HEALTH.wall[1]);
    expect(mid.stage).toBe('breached');
  });

  it('wears by blast strength and distance: a rocket against the face is a third of a stage, nothing past its radius', () => {
    reset();
    const face = V(0, 1.2, -WALL.thick / 2 - 0.3);
    walls.blast(face, 8, 100, 'rocket');
    const one = HEALTH.wall[0] - mid.health;
    expect(one).toBeGreaterThan(90);
    expect(one).toBeLessThan(100);
    walls.blast(V(0, 1.2, -9), 8, 100, 'rocket');
    expect(HEALTH.wall[0] - mid.health).toBeCloseTo(one);
    for (let i = 0; i < 3; i++) walls.blast(face, 8, 100, 'rocket');
    expect(mid.stage).toBe('damaged');
    // A tank shell is made for this: two take an intact wall down a stage.
    reset();
    walls.blast(face, 6, 60, 'tank_cannon');
    expect(mid.stage).toBe('intact');
    walls.blast(face, 6, 60, 'tank_cannon');
    expect(mid.stage).toBe('damaged');
  });

  it('blows a gate open in one stage, and a rocket flattens a shack', () => {
    reset();
    walls.blast(V(4, 1.5, -0.6), 8, 100, 'rocket');
    expect(gate.stage).toBe('intact');
    for (let i = 0; i < 4; i++) walls.blast(V(4, 1.5, -0.6), 8, 100, 'rocket');
    expect(gate.stage).toBe('breached');
    walls.blast(V(-8, 0.5, -10), 8, 100, "rocket");
    expect(shack.stage).toBe('breached');
  });
});

describe('collision matches each stage', () => {
  it('intact stops everything up to the top', () => {
    reset();
    for (const y of [0.3, 1.5, 2.8]) expect(blocked(0, y), `y ${y}`).toBe(true);
    expect(blocked(0, 3.2)).toBe(false);
  });

  it('damaged has holes to shoot through and is lower, but still stops a body', () => {
    reset();
    walls.setStage(mid, 1);
    flush();
    const P = 4 - WALL.pillar;
    expect(blocked(-P * 0.3 + 0.27, 1.5)).toBe(false);
    expect(blocked(P * 0.12 + 0.22, 1.5)).toBe(false);
    expect(blocked(0, 0.5)).toBe(true);
    expect(blocked(1, 2.6)).toBe(false);
    expect(physics.overlapCapsule(V(-P * 0.3 + 0.27, 1, 0), 0.4, 0.5)).toBe(true);
  });

  it('breached leaves a gap a body fits through, over rubble it can step on', () => {
    reset();
    walls.setStage(mid, 2);
    flush();
    for (const x of [-1, 0, 1]) expect(blocked(x, 0.6), `x ${x}`).toBe(false);
    expect(blocked(0, 0.1)).toBe(true);
    expect(blocked(-1.5, 1)).toBe(true);
    expect(physics.overlapCapsule(V(0, 0.4 + 0.55 + 0.45, 0), 0.45, 0.55)).toBe(false);
  });

  it('a blown gate and a flat shack are open', () => {
    reset();
    walls.setStage(gate, 1);
    walls.setStage(shack, 1);
    flush();
    expect(blocked(4, 1)).toBe(false);
    expect(physics.raycast(V(-8, 0.6, -14), V(0, 0, 1), 10)).toBeNull();
  });
});

describe('nav', () => {
  it('routes through the gate only once it is blown, and through a breach only while it is open', () => {
    reset();
    expect(southToNorth()).toBe(Infinity);
    walls.setStage(gate, 1);
    const viaGate = southToNorth();
    expect(viaGate).toBeGreaterThan(14);
    expect(viaGate).toBeLessThan(24);
    walls.setStage(gate, 0);
    expect(southToNorth()).toBe(Infinity);

    walls.setStage(mid, 1);
    expect(southToNorth()).toBe(Infinity);
    walls.setStage(mid, 2);
    const viaBreach = southToNorth();
    expect(viaBreach).toBeGreaterThan(13);
    expect(viaBreach).toBeLessThan(18);
    walls.setStage(mid, 1);
    expect(southToNorth()).toBe(Infinity);
  });

  it('gives enemies no floor in a standing wall, and floor in the breach', () => {
    reset();
    flush();
    const ground = nav.groundHeight(0, 0.75 + 0.4, 0);
    expect(Number.isNaN(ground) || ground > 0.75).toBe(true);
    expect(nav.groundHeight(0, 1.15, 1.6)).toBeCloseTo(0);
    walls.setStage(mid, 2);
    flush();
    expect(nav.groundHeight(0, 1.15, 0)).toBeCloseTo(0);
  });

  it("closes soldiers' routes too", () => {
    reset();
    const route = new Route();
    expect(routes.find(V(0, 0, -7), V(0, 0, 7), route)).toBe(false);
    walls.setStage(mid, 2);
    expect(routes.find(V(0, 0, -7), V(0, 0, 7), route)).toBe(true);
    expect(route.length).toBeLessThan(16);
  });
});

describe('repair', () => {
  it('takes a breach up one stage over a few seconds, and tells whoever listens', () => {
    reset();
    walls.setStage(mid, 2);
    const heard: string[] = [];
    const off = mid.onStageChange((stage, from) => heard.push(`${from}>${stage}`));
    expect(mid.repair()).toBe(true);
    expect(mid.repair()).toBe(false);
    walls.update(REPAIR_SECONDS / 2);
    expect(mid.stage).toBe('breached');
    expect(mid.repairing).toBeCloseTo(0.5);
    walls.update(REPAIR_SECONDS / 2 + 0.01);
    expect(mid.stage).toBe('damaged');
    expect(mid.health).toBe(HEALTH.wall[1]);
    expect(mid.repairing).toBe(-1);
    expect(southToNorth()).toBe(Infinity);
    mid.repair(1);
    walls.update(1.01);
    expect(mid.stage).toBe('intact');
    expect(heard).toEqual(['breached>damaged', 'damaged>intact']);
    off();
    expect(mid.repair()).toBe(false);
  });

  it('tops up a chipped wall, and any hit stops a repair', () => {
    reset();
    walls.damage(mid, 50);
    expect(mid.repair(1)).toBe(true);
    walls.update(0.5);
    walls.damage(mid, 10);
    expect(mid.repairing).toBe(-1);
    mid.repair(1);
    walls.update(1.01);
    expect(mid.health).toBe(HEALTH.wall[0]);
  });

  it('waits for the gap to clear before walling anybody in', () => {
    reset();
    walls.setStage(mid, 2);
    player.position.set(0.3, 0.2, 0.1);
    mid.repair(1);
    walls.update(1.5);
    expect(mid.stage).toBe('breached');
    player.position.set(0, 0, 4);
    walls.update(0.02);
    expect(mid.stage).toBe('damaged');
    player.position.set(100, 0, 100);
  });
});

describe('lift gates', () => {
  let liftPhysics: Physics;
  let liftNav: NavGraph;
  let lifts: Structures;
  let lift: Structure;
  const friend = { position: V(100, 0, 100), alive: true };
  const inGap: { alive: boolean; position: THREE.Vector3 }[] = [];
  const through = (): number => {
    liftNav.setTarget(V(0, 0, 7));
    liftNav.settle();
    return liftNav.pathDistance(V(0, 0, -7));
  };
  const shut = (): boolean => liftPhysics.raycast(V(0, 1.2, -3), V(0, 0, 1), 6) !== null;

  beforeAll(async () => {
    liftPhysics = await Physics.create();
    liftPhysics.addStaticBox(V(0, -0.5, 0), V(14, 0.5, 14), null, 'concrete');
    liftPhysics.flushQueries();
    liftNav = new NavGraph(liftPhysics);
    await liftNav.build(new THREE.Box3(V(-14, -3, -14), V(14, 10, 14)), [], V(0, 0, 8), async () => {}, {});
    const spec = new MapSpec();
    spec.wall(-14.4, 0, -2, 0);
    spec.wallGate(-2, 0, 2, 0, 0, true);
    spec.wall(2, 0, 14.4, 0);
    const enemies = { query: (_p: THREE.Vector3, _r: number, out: unknown[]) => { out.push(...inGap); return inGap.length; } };
    const ctx = { physics: liftPhysics, fx: noop('fx'), audio: noop('audio'), player: friend, enemies } as unknown as Ctx;
    lifts = new Structures(ctx, spec.structures, () => new THREE.MeshBasicMaterial());
    lifts.attach(liftNav);
    liftPhysics.flushQueries();
    lift = lifts.all.find(p => p.kind === 'gate')!;
  }, 60000);

  const tick = () => {
    lifts.update(0.02);
    liftPhysics.flushQueries();
  };

  it('stays down with nobody near, and nothing gets through', () => {
    tick();
    expect(lifts.isOpen(lift)).toBe(false);
    expect(shut()).toBe(true);
    expect(through()).toBe(Infinity);
  });

  it('rises for a friend near it, opening the way, and drops once he has gone', () => {
    friend.position.set(0, 0, 3);
    tick();
    expect(lifts.isOpen(lift)).toBe(true);
    expect(shut()).toBe(false);
    expect(through()).toBeLessThan(20);
    friend.position.set(0, 0, 10);
    tick();
    expect(lifts.isOpen(lift)).toBe(false);
    expect(shut()).toBe(true);
    expect(through()).toBe(Infinity);
  });

  it('will not drop on someone standing in the gap', () => {
    friend.position.set(0, 0, 3);
    tick();
    friend.position.set(0, 0, 10);
    inGap.push({ alive: true, position: V(0, 0, 0.1) });
    tick();
    expect(lifts.isOpen(lift)).toBe(true);
    inGap.length = 0;
    tick();
    expect(lifts.isOpen(lift)).toBe(false);
  });

  it('blown while up is blown, and a reset puts it back down', () => {
    friend.position.set(0, 0, 3);
    tick();
    lifts.blast(V(0, 1, -1), 5, 2000, 'test');
    expect(lift.stage).toBe('breached');
    expect(lifts.isOpen(lift)).toBe(false);
    expect(through()).toBeLessThan(20);
    friend.position.set(100, 0, 100);
    lifts.reset();
    liftPhysics.flushQueries();
    expect(lift.stage).toBe('intact');
    expect(shut()).toBe(true);
    expect(through()).toBe(Infinity);
  });

  it('draws the whole run in one chunk of meshes, not a group a piece', () => {
    expect(lifts.root.children.length).toBeLessThanOrEqual(2);
  });
});

describe('debris', () => {
  const step = (n: number) => {
    for (let i = 0; i < n; i++) {
      physics.world.timestep = 1 / 60;
      physics.world.step();
      walls.update(1 / 60);
    }
  };

  it('throws a shack apart as real bodies away from the blast, which settle and lie there, then fade', () => {
    reset();
    const d = walls.debris;
    walls.blast(V(-8, 0.5, -10), 8, 100, 'rocket');
    expect(shack.stage).toBe('breached');
    expect(d.bodies).toBeGreaterThan(30);
    expect(d.bodies).toBeLessThanOrEqual(DebrisTuning.maxBodies);
    step(30);
    // Mostly away from the blast, which was on the shack's north side.
    const pieces = (d as unknown as { all: { alive: boolean; p: THREE.Vector3 }[] }).all.filter(c => c.alive);
    const south = pieces.filter(c => c.p.z > -8).length;
    expect(south / pieces.length).toBeGreaterThan(0.6);
    step(60 * DebrisTuning.maxFlight);
    expect(d.bodies).toBe(0);
    expect(d.pieces).toBeGreaterThan(30);
    // Nothing fell through the floor (this one is 28 m across: a piece thrown off its edge falls and is let go).
    const lying = pieces.filter(c => c.alive);
    expect(lying.length).toBeGreaterThan(30);
    for (const c of lying) expect(c.p.y).toBeGreaterThan(-0.3);
    step(60 * (DebrisTuning.linger + DebrisTuning.shrink + 0.5));
    expect(d.pieces).toBe(0);
  });

  it('caps the bodies in flight, and a blast throws resting wreckage again', () => {
    reset();
    const d = walls.debris;
    for (let i = 0; i < 4; i++) {
      walls.setStage(shack, 0);
      walls.blast(V(-8, 0.5, -10), 8, 100, 'rocket');
    }
    expect(d.bodies).toBe(DebrisTuning.maxBodies);
    step(60 * DebrisTuning.maxFlight);
    expect(d.bodies).toBe(0);
    physics.radialImpulse(V(-8, 0.3, -8), 6, 80);
    expect(d.bodies).toBeGreaterThan(5);
    reset();
    expect(d.pieces).toBe(0);
  });

  it('knocks lumps off a wall when it drops a stage', () => {
    reset();
    walls.damage(mid, HEALTH.wall[0]);
    expect(mid.stage).toBe('damaged');
    expect(walls.debris.bodies).toBeGreaterThan(4);
    reset();
  });
});
