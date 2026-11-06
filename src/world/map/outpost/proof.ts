/**
 * Proof sheet for the Outpost, on the real physics world and the real Player. The static half measures what the mission needs of the
 * map: a floor under every mark, nav everywhere, clear roads, cover for the men. The bots then play every parkour lesson on the
 * geometry itself, because parkour.test.ts proves the numbers on bare boxes and a map can break a number without changing it.
 */
import * as THREE from 'three';
import { CG, type Action, type InputSystem, type PhysicsSystem, type PlayerSystem } from '../../../core/contracts';
import { DOORS, MARKS, ROUTES, ZONES } from '../../../campaign/missions/outpost.places';
import type { World } from '../../World';

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface Rig {
  player: PlayerSystem & { reset(): void; teleport(p: THREE.Vector3, yaw: number): void; grounded: boolean; wallRunning: boolean; sensitivity: number; dashCharges: number; dashing: boolean; isPenetrating(): boolean };
  input: InputSystem & { simulate(a: Action, down: boolean): void; simulateLook(dx: number, dy: number): void; consumeLook(): unknown };
  step(): void;
}

export const rigOf = (game: { player: unknown; input: unknown; frame(dt: number): void; ctx: { physics: unknown } }): Rig => ({
  player: game.player as Rig['player'],
  input: game.input as Rig['input'],
  step: () => {
    game.frame(1 / 60);
    (game.ctx.physics as { flushQueries?(): void }).flushQueries?.();
  },
});

/** Sky marks and what runs on rails or in the air have no floor. */
const AIRBORNE = /^(fly\d+|sky)/;

export function verifyOutpost(world: World, physics: PhysicsSystem) {
  const nav = world.navGraph;
  const out: Record<string, unknown> = {};

  const shapes: Record<string, number> = {};
  physics.world.forEachCollider(c => { const t = c.shapeType() === 1 ? 'box' : `other:${c.shapeType()}`; shapes[t] = (shapes[t] ?? 0) + 1; });
  out.colliders = shapes;
  const levels: Record<string, number> = {};
  for (let i = 0; i < nav.nodeCount; i++) {
    if (Math.abs(nav.slopeX[i]!) + Math.abs(nav.slopeZ[i]!) > 0.05) { levels.slope = (levels.slope ?? 0) + 1; continue; }
    const key = nav.py[i]!.toFixed(1);
    levels[key] = (levels[key] ?? 0) + 1;
  }
  out.nav = { nodes: nav.nodeCount, levels };

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
  out.marks = { noFloor, offNav, buried };

  // A door must stand in a real gap, or its collider and its route-graph entry mean nothing.
  const doors: Record<string, unknown> = {};
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
  out.doors = doors;

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
  out.roads = { roads: world.spec.roads.map(r => r.id), blocked };

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
  out.flow = { noRoute };

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
  out.zones = { dead };
  return out;
}
