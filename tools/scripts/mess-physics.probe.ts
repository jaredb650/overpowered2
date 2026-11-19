/**
 * M0 of the gore update, the physics part: what the step costs when ragdolls land on resting bodies' fixed colliders.
 *
 *   MESS_PROBE=1 nice npx vitest run tools/scripts/mess-physics.test.ts --testTimeout=600000
 *
 * Fourteen ragdolls (the budget, `GoreTuning.maxRagdolls`) are dropped onto a heap 3.5 m across made of fixed capsules in
 * the ragdolls' own collision group, three a resting body (trunk and thighs) or fifteen (every bone's capsule). Prints the
 * step's median, 90th percentile and worst over the 2 s of the landing, and writes them to tools/out/mess/physics.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { CG, type Ctx } from '../../src/core/contracts';
import { humanoidRig } from '../../src/characters/rig';
import { createGoreSystem } from '../../src/gore/index';
import { TestDummy } from '../../src/gore/testDummy';
import { groups, Physics } from '../../src/physics/Physics';
import { makeCtx } from '../../src/sandbox/harness';

const rig = humanoidRig('test');
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** Seeded, so every case drops the same bodies on the same heap. */
function dice(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function run(fixed: number, perBody: number, drops: number): Promise<Record<string, number>> {
  const physics = await Physics.create();
  const scene = new THREE.Scene();
  const ctx: Ctx = makeCtx({ physics, render: { scene, decals: { add() {}, splat() {}, clear() {} } } as unknown as Ctx['render'] });
  const gore = createGoreSystem(ctx);
  gore.init();
  physics.addStaticBox(v(0, -0.5, 0), v(40, 0.5, 40), null, 'concrete');
  const { R, world } = physics;
  const rand = dice(7);
  const filter = groups(CG.Ragdoll, CG.Ragdoll | CG.Gib);
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  // A resting body: capsules lying about on the floor and on each other, as a heap that grew one body at a time.
  for (let made = 0, body = 0; made < fixed; body++) {
    const r = 1.75 * Math.sqrt(rand());
    const a = rand() * Math.PI * 2;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    // Later bodies lie higher: 150 bodies on a 3.5 m disc is about five deep.
    const layer = Math.floor(body / 28);
    for (let k = 0; k < perBody && made < fixed; k++, made++) {
      const yaw = rand() * Math.PI * 2;
      const long = perBody > 3 ? 0.12 + rand() * 0.14 : k === 0 ? 0.28 : 0.2;
      const radius = perBody > 3 ? 0.05 + rand() * 0.06 : k === 0 ? 0.15 : 0.085;
      axis.set(Math.cos(yaw), (rand() - 0.5) * 0.3, Math.sin(yaw)).normalize();
      q.setFromUnitVectors(v(0, 1, 0), axis);
      world.createCollider(
        R.ColliderDesc.capsule(long, radius)
          .setTranslation(cx + (rand() - 0.5) * 0.9, radius + layer * 0.24 + rand() * 0.08, cz + (rand() - 0.5) * 0.9)
          .setRotation(q)
          .setFriction(0.72)
          .setCollisionGroups(filter),
      );
    }
  }
  physics.flushQueries();
  const times: number[] = [];
  const frame = (): void => {
    ctx.time.tick(1 / 60);
    physics.step(ctx.time.dt);
    gore.update();
  };
  // Warm the solver and the module before anything is timed.
  for (let i = 0; i < 20; i++) frame();
  const dummies: TestDummy[] = [];
  for (let i = 0; i < drops; i++) {
    const c = new TestDummy(rig);
    const r = 1.2 * Math.sqrt(rand());
    const a = rand() * Math.PI * 2;
    c.root.position.set(Math.cos(a) * r, 1.3 + rand() * 1.4, Math.sin(a) * r);
    c.root.rotation.y = rand() * Math.PI * 2;
    scene.add(c.root);
    c.root.updateMatrixWorld(true);
    dummies.push(c);
  }
  for (const c of dummies) gore.ragdoll(c, { velocity: v(0, -2, 0) });
  let peakChains = 0;
  for (let i = 0; i < 120; i++) {
    frame();
    times.push(physics.stepMs);
    peakChains = Math.max(peakChains, gore.stats().ragdolls);
  }
  times.sort((a, b) => a - b);
  const at = (p: number): number => +times[Math.min(times.length - 1, Math.floor(times.length * p))]!.toFixed(3);
  const hips = dummies.map(c => new THREE.Vector3().setFromMatrixPosition(c.bones[0]!.matrixWorld).y);
  hips.sort((a, b) => a - b);
  const out = {
    fixed, perBody, drops, colliders: world.colliders.len(), bodies: world.bodies.len(), peakChains,
    median: at(0.5), p90: at(0.9), max: at(1), hipsLow: +hips[0]!.toFixed(2), hipsHigh: +hips[hips.length - 1]!.toFixed(2),
  };
  gore.clear();
  world.free();
  return out;
}

const rows: Record<string, number>[] = [];
for (const [fixed, perBody] of [[0, 3], [100, 3], [200, 3], [450, 3], [600, 15], [1500, 15], [2250, 15], [4500, 15]] as const) {
  // Twice, the second kept: the first run of a size pays for WebAssembly growing its memory.
  await run(fixed, perBody, 14);
  rows.push(await run(fixed, perBody, 14));
  console.log(JSON.stringify(rows[rows.length - 1]));
}
mkdirSync('tools/out/mess', { recursive: true });
writeFileSync('tools/out/mess/physics.json', JSON.stringify(rows, null, 1));
