/**
 * Map self-test: paths between every zone and level, ballistic checks on pads and gaps, and containment.
 * Runs in the sandbox against the real physics world, so it tests what the player will actually touch.
 */
import * as THREE from 'three';
import { CG, type PhysicsSystem } from '../core/contracts';
import type { World } from './World';
import { ballistic } from './map/spec';

export const ANCHORS: readonly [string, number, number, number][] = [
  ['core.floor', 38, -8, 12], ['core.plaza', 55, 0, 22], ['core.halo', 29, 8, 12], ['core.crown', 20, 30, 8], ['core.rimTop', 66, 8, 38],
  ['foundry.floor', 0, 0, -82], ['foundry.north', -44, 0, -128], ['foundry.gallery', 8, -7, -98], ['foundry.catwalk', -40, 8, -79], ['foundry.walkway', 36, 14, -135],
  ['slag', -110, 0, -96], ['tankfarm', 108, 0, -106],
  ['refinery.lane', 84, 0, -36], ['refinery.rack', 112, 8, 20], ['refinery.sump', 112, -7, 4], ['refinery.tanktop', 95, 15.4, -41], ['refinery.tower', 137, 14, -32], ['refinery.east', 123, 0, 18],
  ['scrap.road', 2, 0, 84], ['scrap.pit', 0, -7, 110], ['scrap.conveyor', 20, 8, 91], ['scrap.crane', 46, 14, 100], ['scrap.yardW', -45, 0, 118], ['scrap.yardE', 54, 0, 108], ['scrap.corner', 100, 0, 112],
  ['transit.platE', -95, -5.9, 6], ['transit.platW', -115, -5.9, -20], ['transit.tracks', -105, -7, 14], ['transit.concW', -128, 0, 8], ['transit.roof', -110, 8.4, 20], ['transit.hall', -80, 0, 4], ['railyard', -100, 0, 104],
  ['ring.N', 0, 14, -150], ['ring.E', 150, 14, 0], ['ring.S', 40, 14, 150], ['ring.W', -150, 14, 0], ['ring.NE', 129, 15, -129],
  ['viaduct', 90, 7.4, -90], ['tunnel.S', 0, -7.5, 70], ['tunnel.outer', 60, -7, 112], ['colonnade', 150, 0, 40],
];

export interface VerifyReport {
  anchors: number;
  offGraph: string[];
  unreachable: string[];
  worstPath: { from: string; to: string; meters: number } | null;
  usedLinks: Record<string, number>;
  pads: { ok: number; bad: string[] };
  gaps: string[];
  holes: number;
  escapes: number;
  /** Spawns by zone and kind. */
  spawns: Record<string, number>;
  /** Ground or gate pairs in one zone with a clear line of sight. */
  spawnSightlines: number;
  /** Pickup spots and player spawns with no floor under them. */
  stranded: string[];
  ms: number;
}

const GRAVITY = 28;
const RADIUS = 0.45;
const HALF = 0.45;

/** Flies a capsule along a parabola. Returns where it first touches something. */
function flight(physics: PhysicsSystem, from: THREE.Vector3, v: THREE.Vector3): { point: THREE.Vector3; time: number } | null {
  const p = from.clone();
  p.y += RADIUS + HALF + 0.3;
  const vel = v.clone();
  const step = new THREE.Vector3();
  const h = 1 / 60;
  for (let t = 0; t < 8; t += h) {
    vel.y -= GRAVITY * h;
    step.copy(vel).multiplyScalar(h);
    const hit = physics.sweepCapsule(p, RADIUS, HALF, step, CG.World);
    if (hit) {
      p.addScaledVector(step, hit.fraction);
      p.y -= RADIUS + HALF;
      return { point: p, time: t };
    }
    p.add(step);
  }
  return null;
}

export function verifyMap(world: World, physics: PhysicsSystem): VerifyReport {
  const t0 = performance.now();
  const nav = world.navGraph;
  const offGraph: string[] = [];
  const pts = ANCHORS.map(([name, x, y, z]) => {
    const p = new THREE.Vector3(x, y, z);
    const n = nav.locate(p, 4);
    if (n < 0 || Math.abs(nav.py[n]! - y) > 1.5) offGraph.push(`${name} (node y ${n < 0 ? 'none' : nav.py[n]!.toFixed(1)})`);
    return { name, p };
  });

  const unreachable: string[] = [];
  const usedLinks: Record<string, number> = { walk: 0, drop: 0, jump: 0, pad: 0 };
  let worst: VerifyReport['worstPath'] = null;
  for (const target of pts) {
    nav.setTarget(target.p);
    nav.settle();
    for (const source of pts) {
      if (source === target) continue;
      const tr = nav.trace(source.p);
      if (!tr.ok) { unreachable.push(`${source.name} -> ${target.name}`); continue; }
      for (const k of Object.keys(tr.kinds) as (keyof typeof tr.kinds)[]) usedLinks[k]! += tr.kinds[k];
      if (!worst || tr.length > worst.meters) worst = { from: source.name, to: target.name, meters: Math.round(tr.length) };
    }
  }

  // Pads: fly each one and see that the capsule comes down near where it was aimed.
  const badPads: string[] = [];
  let okPads = 0;
  const v = new THREE.Vector3();
  for (const pad of world.spec.pads) {
    ballistic(pad.pos, pad.target, pad.arc, GRAVITY, v);
    const end = flight(physics, pad.pos, v);
    const miss = end ? Math.hypot(end.point.x - pad.target.x, end.point.z - pad.target.z) : Infinity;
    const dy = end ? end.point.y - pad.target.y : Infinity;
    if (miss < 3.5 && Math.abs(dy) < 2) okPads++;
    else badPads.push(`[${pad.pos.toArray().map(n => n.toFixed(0))}] -> [${pad.target.toArray().map(n => n.toFixed(0))}] landed ${end ? end.point.toArray().map(n => n.toFixed(1)) : 'never'}`);
  }

  // Gaps: a running double jump at ground top speed must clear every designated jump link.
  const gaps: string[] = [];
  for (const link of world.spec.jumpLinks) {
    if (link.kind !== 'jump') continue;
    const dir = new THREE.Vector3().subVectors(link.b, link.a);
    const span = Math.hypot(dir.x, dir.z);
    dir.y = 0;
    dir.normalize();
    const speed = 17, jump = 10.5, second = 10;
    // Jump, second jump at the apex: time aloft to get back to launch height.
    const t1 = jump / GRAVITY;
    const rise = (jump * jump) / (2 * GRAVITY);
    const t2 = second / GRAVITY + Math.sqrt((2 * (rise + (second * second) / (2 * GRAVITY) - (link.b.y - link.a.y))) / GRAVITY);
    const reach = speed * (t1 + t2);
    gaps.push(`${span.toFixed(1)} m gap, reach ${reach.toFixed(1)} m: ${reach >= span ? 'ok' : 'TOO WIDE'}`);
  }

  // Containment: drop rays everywhere and shoot rays outward from the ring.
  let holes = 0;
  const down = new THREE.Vector3(0, -1, 0);
  const o = new THREE.Vector3();
  for (let x = -158; x <= 158; x += 3) {
    for (let z = -158; z <= 158; z += 3) {
      if (Math.max(Math.abs(x), Math.abs(z)) > 80 && Math.hypot(Math.abs(x) - 80, Math.abs(z) - 80) > 78 && Math.abs(x) > 80 && Math.abs(z) > 80) continue;
      o.set(x, 60, z);
      if (!physics.raycast(o, down, 90, CG.World)) holes++;
    }
  }
  let escapes = 0;
  const d = new THREE.Vector3();
  for (let i = 0; i < 720; i++) {
    const a = (i / 720) * Math.PI * 2;
    for (const y of [16, 26, 40, 70, 110]) {
      o.set(0, y, 0);
      o.x = Math.cos(a) * 30; o.z = Math.sin(a) * 30;
      d.set(Math.cos(a), 0, Math.sin(a));
      if (!physics.raycast(o, d, 400, CG.World)) escapes++;
    }
  }
  const spawns: Record<string, number> = {};
  let spawnSightlines = 0;
  const ground = world.spawnPoints.filter(s => s.kind !== 'air');
  for (const s of world.spawnPoints) spawns[`${s.zone}.${s.kind}`] = (spawns[`${s.zone}.${s.kind}`] ?? 0) + 1;
  for (let i = 0; i < ground.length; i++) {
    for (let j = i + 1; j < ground.length; j++) {
      const a = ground[i]!, b = ground[j]!;
      if (a.zone !== b.zone || a.kind === 'gate' && b.kind === 'gate') continue;
      o.copy(a.position); o.y += 1.5;
      d.copy(b.position); d.y += 1.5;
      d.sub(o);
      const len = d.length();
      d.divideScalar(len);
      if (!physics.raycast(o, d, len, CG.World)) spawnSightlines++;
    }
  }
  const stranded: string[] = [];
  const out = new THREE.Vector3();
  for (const p of world.pickupSpots) if (!nav.nearest(p, 3, out)) stranded.push(`pickup ${p.toArray().map(n => n.toFixed(0))}`);
  for (const s of world.playerSpawns) if (!nav.nearest(s.position, 3, out)) stranded.push(`spawn ${s.position.toArray().map(n => n.toFixed(0))}`);
  return {
    spawns, spawnSightlines, stranded,
    anchors: pts.length, offGraph, unreachable: unreachable.slice(0, 30), worstPath: worst, usedLinks,
    pads: { ok: okPads, bad: badPads }, gaps, holes, escapes, ms: Math.round(performance.now() - t0),
  };
}
