/**
 * Hit reactions on the living, on real Rapier ragdolls and the real animator. A body that pops, slides, or stands up
 * through the floor fails here.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { archetypeById, rigFor } from '../characters/archetypes';
import { HumanoidAnimator } from '../characters/animation/HumanoidAnimator';
import { HumanoidBone as B } from '../characters/rig';
import { Physics } from '../physics/Physics';
import { makeCtx } from '../sandbox/harness';
import type { Ctx } from '../core/contracts';
import { createGoreSystem, type Gore } from './index';
import { TestDummy } from './testDummy';

const trooper = archetypeById('trooper');
const rig = rigFor(trooper);
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const at = (c: TestDummy, bone: number) => new THREE.Vector3().setFromMatrixPosition(c.bones[bone]!.matrixWorld);

let physics: Physics;
let ctx: Ctx;
let gore: Gore;
const scene = new THREE.Scene();

function spawnLiving(x = 0, z = 0): TestDummy {
  const c = new TestDummy(rig);
  c.root.position.set(x, 0, z);
  scene.add(c.root);
  c.root.updateMatrixWorld(true);
  const anim = new HumanoidAnimator(c.bones, rig, trooper, c.root, c.severed, b => (c as unknown as { hidden: Uint8Array }).hidden[b] === 1);
  (c as { anim: unknown }).anim = anim;
  for (let i = 0; i < 20; i++) stand(c);
  c.root.updateMatrixWorld(true);
  return c;
}

function stand(c: TestDummy): void {
  c.anim.setLocomotion({ speed: 0, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true });
  c.anim.update(1 / 60, 0);
}

/** One frame of the game: the owner animates what it still has, then physics, then gore. */
function frame(c: TestDummy | null): void {
  ctx.time.tick(1 / 60);
  if (c && !gore.downed(c)) stand(c);
  physics.step(ctx.time.dt);
  gore.update();
  c?.root.updateMatrixWorld(true);
}

beforeAll(async () => {
  physics = await Physics.create();
  ctx = makeCtx({
    physics,
    render: { scene, decals: { add() {}, splat() {}, clear() {} } } as unknown as Ctx['render'],
  });
  gore = createGoreSystem(ctx);
  gore.init();
  physics.addStaticBox(v(0, -0.5, 0), v(60, 0.5, 60), null, 'concrete');
  physics.flushQueries();
});

describe('explore', () => {
  it('log', () => {
    for (const [dx, dz] of [[0, 1.4], [0, 2.2], [0, -1.6], [1.6, 0]]) {
      gore.clear();
      const c = spawnLiving();
      gore.knockdown(c, { topple: v(dx!, 0, dz!), lie: 0.6, rise: 2, hurt: 0.6 });
      let last = c.bones.map((_, i) => at(c, i));
      let worst = 0, worstF = -1, lowest = 9, lowF = -1, lowB = -1, backF = -1, backJump = 0;
      const r3 = (p: THREE.Vector3) => p.toArray().map(n => +n.toFixed(2)).join(',');
      for (let f = 0; f < 60 * 6; f++) {
        frame(c);
        const now = c.bones.map((_, i) => at(c, i));
        let jump = 0;
        now.forEach((p, i) => { jump = Math.max(jump, p.distanceTo(last[i]!)); if (p.y < lowest) { lowest = p.y; lowF = f; lowB = i; } });
        if (jump > worst) { worst = jump; worstF = f; }
        if (backF >= 0 && f <= backF + 2) backJump = Math.max(backJump, jump);
        last = now;
        if (backF < 0 && !gore.downed(c)) { backF = f; backJump = jump; console.log('  handback f', f, 'root', r3(c.root.position), 'yaw', c.root.rotation.y.toFixed(2)); }
        if (backF < 0 && f % 12 === 0) {
          const r = (gore as unknown as { owned: Map<unknown, { rag: { muscle: { reflex: { phase: string; kind: string } | null } } | null }> }).owned.get(c)?.rag?.muscle?.reflex;
          console.log(' ', f, r?.phase, 'hips', r3(at(c, B.hips)), 'chest', r3(at(c, B.chest)), 'head', r3(at(c, B.head)), 'hL', r3(at(c, B.handL)), 'fL', r3(at(c, B.footL)));
        }
      }
      console.log('CASE', dx, dz, 'worst jump', worst.toFixed(3), '@', worstF, 'lowest', lowest.toFixed(3), '@', lowF, 'bone', lowB, 'jump at handback', backJump.toFixed(3));
    }
  }, 60000);
});
