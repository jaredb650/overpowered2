/**
 * The case the single-player comparison found (office-waves, frame 334): in the Office the player starts pressed into the
 * reception desk and the monitor on it, both a cast's distance 0 away. Which of the two Rapier answered with was decided by
 * its search tree, which holds every body in the world, so a rocket kill 33 m off decided where he stood. Here the real
 * Office and the real gore: men blown apart, cut up and dropped far off and across the lobby while he stands at the start
 * and then runs, against the same with no gore at all. Bit for bit.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { HumanoidBone as B, humanoidRig } from '../characters/rig';
import type { Ctx, DamageInfo } from '../core/contracts';
import type { Gore } from '../gore/index';
import { TestDummy } from '../gore/testDummy';
import type { HeadlessGame } from './testkit/headless';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const FRAMES = 900;

beforeAll(() => {
  vi.stubGlobal('location', { search: '?map=office' });
  const paint: unknown = new Proxy({}, { get: (_, key) => (key === 'measureText' ? () => ({ width: 100 }) : () => undefined), set: () => true });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => paint, style: {}, width: 0, height: 0 }) });
});

/** Where the men die, script frame and place: far down the building as in the comparison, and in the lobby round him. */
const KILLS: [number, number, number, 'gib' | 'sever' | 'slice' | 'drop'][] = [
  [20, 36, 14, 'gib'], [40, 34, 9, 'gib'], [60, 30, 18, 'sever'], [80, 8, 8, 'gib'], [100, 1, 7, 'drop'],
  [130, 6, 2, 'slice'], [160, 2, 1, 'gib'], [200, 36, 12, 'gib'], [260, 5, 6, 'sever'], [320, 3, 2.5, 'drop'],
];

async function office(withGore: boolean): Promise<{ track: Float64Array; landedAt: number }> {
  const { World } = await import('../world/World');
  const { createHeadlessGame } = await import('./testkit/headless');
  const { createGoreSystem } = await import('../gore/index');
  const game: HeadlessGame = await createHeadlessGame(() => {});
  const ctx = game.ctx;
  (ctx as unknown as { weapons: unknown }).weapons = { occupy: () => {} };
  const scene = new THREE.Scene();
  Object.assign(ctx.render, { scene, decals: { add() {}, splat() {}, clear() {} } });
  ctx.characters = { spawn: () => new TestDummy(humanoidRig('test')) } as unknown as Ctx['characters'];
  const world = new World(ctx);
  (ctx as Ctx).world = world;
  await world.build();
  const physics = ctx.physics as unknown as { flushQueries(): void; step(dt: number): void };
  physics.flushQueries();
  let gore: Gore | null = null;
  if (withGore) {
    gore = createGoreSystem(ctx);
    ctx.gore = gore;
    gore.init();
  }
  const player = game.player;
  player.teleport(v(3.5, 0.1, 4), Math.PI);
  const spawn = (x: number, z: number): TestDummy => {
    const c = new TestDummy(humanoidRig('test'));
    c.root.position.set(x, 0, z);
    scene.add(c.root);
    c.root.updateMatrixWorld(true);
    return c;
  };
  const pos = (player as unknown as { pos: THREE.Vector3 }).pos;
  const vel = (player as unknown as { v: THREE.Vector3 }).v;
  const track = new Float64Array(FRAMES * 6);
  let landedAt = -1;
  for (let f = 0; f < FRAMES; f++) {
    if (gore) {
      for (const [at, x, z, how] of KILLS) {
        if (at !== f) continue;
        const c = spawn(x, z);
        const chest = v(0, 0, 0).setFromMatrixPosition(c.bones[B.spine]!.matrixWorld);
        if (how === 'gib') {
          const d = { amount: 9999, type: 'explosive', point: chest, dir: v(0.3, 0.6, 0.2).normalize(), force: 900, source: 'rocket', blastKind: 'rocket', gib: true, torso: 'crack' } as DamageInfo;
          gore.gib(c, chest.clone().add(v(0.4, -0.9, 0.3)), 900, d);
        } else if (how === 'sever') {
          gore.sever(c, 'legL', { amount: 200, type: 'slash', point: chest, dir: v(1, 0, 0), force: 60, source: 'sword', severMult: 4 } as DamageInfo, v(0, 2, 2));
        } else if (how === 'slice') {
          gore.slice(c, chest, v(0, 1, 0), { amount: 200, type: 'slash', point: chest, dir: v(1, 0, 0), force: 60, source: 'sword' } as DamageInfo);
        } else gore.ragdoll(c, { velocity: v(0, 0, -2) });
      }
    }
    // Stands still, as the bot did, then runs out of the lobby.
    game.input.simulate('forward', f >= 450 && f < 800);
    if (f === 520) game.input.simulate('dash', true);
    if (f === 521) game.input.simulate('dash', false);
    game.frame(1 / 60);
    if (gore) {
      physics.step(ctx.time.dt);
      gore.update();
    } else physics.step(ctx.time.dt);
    track.set([pos.x, pos.y, pos.z, vel.x, vel.y, vel.z], f * 6);
    if (landedAt < 0 && player.grounded) landedAt = f;
  }
  return { track, landedAt };
}

describe('in the Office, where the player starts pressed into the desk and its monitor', () => {
  it('pieces thrown about the building, near and 33 m off, do not move him: the same to the bit as with no gore', async () => {
    const without = await office(false);
    const withGore = await office(true);
    let parted = -1;
    for (let i = 0; i < without.track.length; i++) if (!Object.is(without.track[i], withGore.track[i])) { parted = Math.floor(i / 6); break; }
    expect(parted, 'first frame the tracks part').toBe(-1);
    // And he is out of the desk and on the floor at once, not hanging in it until something gives (6.7 s on the old game).
    expect(without.landedAt).toBeLessThan(30);
  }, 180000);
});
