/** The seat's promises about the body and the view, on the real controller and the real rig. */
import * as THREE from 'three';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PlayerDamage, SeatView } from '../core/contracts';
import { createHeadlessGame, type HeadlessGame } from './testkit/headless';

let game: HeadlessGame;
const feet = new THREE.Vector3();
const hit: PlayerDamage = { amount: 500, type: 'true', source: 'test' };

beforeAll(async () => {
  game = await createHeadlessGame();
});

const frames = (n: number) => {
  for (let i = 0; i < n; i++) game.frame(1 / 60);
};

beforeEach(() => {
  for (const a of ['forward', 'jump', 'dash'] as const) game.input.simulate(a, false);
  game.input.consumeLook();
  game.player.reset();
  game.camera.reset();
  frames(30);
  feet.copy(game.player.position);
});

describe('a parked body', () => {
  it('ignores the keys and the mouse, and keeps the view it was left with', () => {
    game.player.pitch = -0.2;
    const { yaw } = game.player;
    game.player.park(feet);
    game.input.simulate('forward', true);
    game.input.simulate('jump', true);
    game.input.simulateLook(400, 200);
    frames(60);
    expect(game.player.position.distanceTo(feet)).toBeLessThan(1e-6);
    expect(game.player.yaw).toBe(yaw);
    expect(game.player.pitch).toBe(-0.2);
  });

  it('cannot be hurt or moved by anything', () => {
    game.player.park(feet);
    game.player.takeDamage(hit);
    game.player.launch(new THREE.Vector3(0, 30, 0));
    game.player.push(new THREE.Vector3(20, 0, 0));
    frames(30);
    expect(game.player.health).toBe(game.player.maxHealth);
    expect(game.player.alive).toBe(true);
    expect(game.player.position.distanceTo(feet)).toBeLessThan(1e-6);
  });

  it('counts as standing, so a kill from the seat is not an airborne one', () => {
    game.player.park(feet.clone().setY(feet.y + 3));
    expect(game.player.grounded).toBe(true);
  });

  it('walks again the moment it is given back', () => {
    game.player.park(feet);
    frames(10);
    game.player.unpark(0);
    game.input.simulate('forward', true);
    frames(30);
    expect(game.player.position.distanceTo(feet)).toBeGreaterThan(2);
  });

  it('stays untouchable for the grace and no longer', () => {
    game.player.park(feet);
    game.player.unpark(0.5);
    frames(15);
    game.player.takeDamage({ amount: 10, type: 'true', source: 'test' });
    expect(game.player.health).toBe(game.player.maxHealth);
    frames(25);
    game.player.takeDamage({ amount: 10, type: 'true', source: 'test' });
    expect(game.player.health).toBe(game.player.maxHealth - 10);
  });

  it('is released by a new run', () => {
    game.player.park(feet);
    game.player.reset();
    expect(game.player.parked).toBe(false);
  });
});

describe('the seat view', () => {
  const view = (): SeatView => ({ position: new THREE.Vector3(5, 30, -8), yaw: 1, pitch: -0.5, roll: 0.1, shake: 1 });

  it('takes the camera, and gives it back exactly where the player was', () => {
    const cam = game.ctx.render.camera;
    frames(2);
    const home = cam.position.clone();
    game.camera.setSeat(view());
    frames(1);
    expect(cam.position.toArray()).toEqual([5, 30, -8]);
    expect(cam.rotation.y).toBeCloseTo(1, 6);
    game.camera.setSeat(null);
    frames(1);
    expect(cam.position.distanceTo(home)).toBeLessThan(0.05);
  });

  it('can be placed before the rig has had its turn in the frame', () => {
    const cam = game.ctx.render.camera;
    const seat = view();
    game.camera.setSeat(seat);
    seat.position.set(1, 2, 3);
    game.camera.syncSeat();
    expect(cam.position.toArray()).toEqual([1, 2, 3]);
    expect(cam.matrixWorld.elements[12]).toBe(1);
  });

  it('turns shake down by what the seat asks for', () => {
    const quiet = view();
    quiet.shake = 0;
    game.camera.setSeat(quiet);
    game.camera.addTrauma(1);
    frames(6);
    expect(game.ctx.render.camera.rotation.x).toBeCloseTo(-0.5, 6);
  });

  it('does not outlive a reset', () => {
    game.camera.setSeat(view());
    game.camera.reset();
    frames(1);
    expect(game.ctx.render.camera.position.y).toBeLessThan(10);
  });
});
