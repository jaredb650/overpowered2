/**
 * "No climb" surfaces: a collider a map marks with `markNoClimb` (or builds inside `Kit.noClimb`) never starts a wall climb.
 * Real controller, real Rapier: two identical tall walls, one of them marked.
 */
import * as THREE from 'three';
import { beforeAll, expect, it } from 'vitest';
import type { Physics } from '../physics/Physics';
import { createHeadlessGame, type HeadlessGame } from './testkit/headless';

const FACE = -10;
const PLAIN = 0;
const MARKED = 20;

let game: HeadlessGame;
beforeAll(async () => {
  game = await createHeadlessGame((physics: Physics) => {
    const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number) =>
      physics.addStaticBox(new THREE.Vector3(x, y, z), new THREE.Vector3(hx, hy, hz), null, 'concrete');
    box(10, -0.5, 0, 30, 0.5, 30);
    box(PLAIN, 15, FACE - 0.5, 4, 15, 0.5);
    physics.markNoClimb(box(MARKED, 15, FACE - 0.5, 4, 15, 0.5));
  });
  (game.ctx as unknown as { weapons: unknown }).weapons = { occupy: () => {} };
});

const DT = 1 / 120;

/** Stands 1.2 m off the wall at `x`, looking at it, W held, jumps, and reports whether a climb started within a second. */
function climbs(x: number): boolean {
  for (const a of ['forward', 'jump'] as const) game.input.simulate(a, false);
  game.player.reset();
  game.player.teleport(new THREE.Vector3(x, 0.05, FACE + 1.2), 0);
  for (let i = 0; i < 6; i++) game.frame(DT);
  game.input.simulate('forward', true);
  game.frame(DT);
  game.frame(DT);
  game.input.simulate('jump', true);
  game.frame(DT);
  game.input.simulate('jump', false);
  let climbed = false;
  for (let t = 0; t < 1 && !climbed; t += DT) {
    game.frame(DT);
    climbed = game.player.climbing;
  }
  game.input.simulate('forward', false);
  return climbed;
}

it('climbs an unmarked wall and refuses the same wall marked "no climb"', () => {
  expect(climbs(PLAIN)).toBe(true);
  expect(climbs(MARKED)).toBe(false);
});
