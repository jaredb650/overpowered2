/**
 * Jump Jet (a Move implant): with it fitted, jump pressed again in the air, or held, burns a jet pack in place of the double jump.
 * Real controller, real Rapier.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Physics } from '../physics/Physics';
import { createHeadlessGame, type HeadlessGame } from './testkit/headless';
import { MOVE } from './tuning';

/** A floor, and a corridor 5 m wide between faces at x = 37.5 and 42.5, for a wall run. */
function build(physics: Physics): void {
  const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number) =>
    physics.addStaticBox(new THREE.Vector3(x, y, z), new THREE.Vector3(hx, hy, hz), null, 'concrete');
  box(20, -0.5, -20, 60, 0.5, 60);
  box(37, 3, -40, 0.5, 3, 40);
  box(43, 3, -40, 0.5, 3, 40);
}

let game: HeadlessGame;
const seen = { doubles: 0, walls: 0 };

beforeAll(async () => {
  game = await createHeadlessGame(build);
  (game.ctx as unknown as { weapons: unknown }).weapons = { occupy: () => {} };
  game.ctx.events.on('player:jumped', e => {
    if (e.double) seen.doubles++;
    if (e.wall) seen.walls++;
  });
});

const DT = 1 / 120;
const step = (n = 1) => { for (let i = 0; i < n; i++) game.frame(DT); };
const stepFor = (seconds: number) => step(Math.round(seconds / DT));
const stepUntil = (test: () => boolean, seconds = 3) => {
  for (let t = 0; t < seconds && !test(); t += DT) step();
  return test();
};
const press = (a: 'jump' | 'dash') => {
  game.input.simulate(a, true);
  step();
  game.input.simulate(a, false);
};

function place(x: number, z: number, jet: boolean, y = 0): void {
  for (const a of ['forward', 'back', 'left', 'right', 'jump', 'dash', 'slide'] as const) game.input.simulate(a, false);
  game.input.consumeLook();
  game.player.reset();
  game.player.jumpJet = jet;
  game.player.teleport(new THREE.Vector3(x, y + 0.05, z), 0);
  step(6);
  seen.doubles = seen.walls = 0;
}

/** Jumps, and at the top of it presses again and holds. */
function jumpAndLight(): void {
  press('jump');
  stepUntil(() => game.player.velocity.y <= 0.5, 1);
  game.input.simulate('jump', true);
  step(2);
}

describe('Jump Jet', () => {
  it('is not there unfitted: the second press is the double jump', () => {
    place(0, 0, false);
    jumpAndLight();
    expect(seen.doubles).toBe(1);
    stepFor(0.5);
    expect(game.player.jetting).toBe(false);
    expect(game.player.jetFuel).toBe(MOVE.jetFuel);
  });

  it('fitted, the second press lights it instead: it climbs, then hovers, then runs dry and falls', () => {
    place(0, 0, true);
    const p = game.player;
    jumpAndLight();
    expect(seen.doubles).toBe(0);
    expect(p.jetting).toBe(true);
    const lit = p.position.y;
    stepFor(MOVE.jetClimbTime);
    // Climbed well past a double jump's 2.8 m, and is holding there.
    expect(p.position.y - lit).toBeGreaterThan(4);
    expect(p.position.y).toBeLessThan(10);
    const top = p.position.y;
    stepFor(0.4);
    expect(Math.abs(p.position.y - top)).toBeLessThan(0.15);
    expect(p.jetting).toBe(true);
    // Fuel drains one second a second, and the tank is about 3 s.
    expect(stepUntil(() => !p.jetting, MOVE.jetFuel)).toBe(true);
    expect(p.jetFuel).toBe(0);
    stepFor(0.3);
    expect(p.velocity.y).toBeLessThan(-5);
  });

  it('lights by itself when jump is held through the jump, but a tap is a plain jump', () => {
    place(0, 0, true);
    const p = game.player;
    press('jump');
    stepFor(0.4);
    expect(p.jetting).toBe(false);
    expect(stepUntil(() => p.grounded, 2)).toBe(true);
    stepFor(0.2);
    game.input.simulate('jump', true);
    step();
    expect(p.jetting).toBe(false);
    stepFor(MOVE.jetHoldDelay + 0.05);
    expect(p.jetting).toBe(true);
    // Let go and it coasts: gravity again.
    game.input.simulate('jump', false);
    step(2);
    expect(p.jetting).toBe(false);
    const vy = p.velocity.y;
    step(12);
    expect(p.velocity.y).toBeLessThan(vy - 2.5);
  });

  it('refills: not for 2 s in the air, then in about 3 s; on the ground after 0.5 s, in about 1.2 s', () => {
    // High up, so the fall lasts.
    place(0, 0, true, 400);
    const p = game.player;
    game.input.simulate('jump', true);
    stepFor(MOVE.jetHoldDelay + 1);
    game.input.simulate('jump', false);
    step();
    const left = p.jetFuel;
    expect(left).toBeLessThan(MOVE.jetFuel - 0.9);
    stepFor(MOVE.jetRechargeDelay - 0.1);
    expect(p.jetFuel).toBe(left);
    stepFor(0.1 + MOVE.jetRefill / 3);
    expect(p.jetFuel).toBeGreaterThan(left + MOVE.jetFuel / 3 - 0.1);

    // Burn it dry from the ground, land, and wait.
    place(0, 0, true);
    jumpAndLight();
    stepUntil(() => !p.jetting, MOVE.jetFuel + 0.5);
    game.input.simulate('jump', false);
    expect(stepUntil(() => p.grounded, 3)).toBe(true);
    // The delays run from the last burn, and the fall from a hover already outlasts the ground's: it fills as it lands.
    expect(p.jetFuel).toBeLessThan(MOVE.jetFuel * 0.4);
    stepFor(MOVE.jetGroundRefill + 0.05);
    expect(p.jetFuel).toBe(MOVE.jetFuel);
  });

  it('gives way to a dash and burns again after it, without spending fuel in it', () => {
    place(0, 0, true);
    const p = game.player;
    jumpAndLight();
    stepFor(0.3);
    game.input.simulate('forward', true);
    game.input.simulate('dash', true);
    step();
    game.input.simulate('dash', false);
    expect(p.dashing).toBe(true);
    step();
    const fuel = p.jetFuel;
    expect(p.jetting).toBe(false);
    stepUntil(() => !p.dashing, 0.5);
    expect(p.jetFuel).toBeCloseTo(fuel, 2);
    step(2);
    expect(p.jetting).toBe(true);
  });

  it('gives way to a wall run, and the kick off it is still a wall kick', () => {
    place(40 + 1.6, 0, true);
    const p = game.player;
    game.input.simulate('forward', true);
    stepFor(0.25);
    p.yaw -= 0.3;
    step(6);
    // Jump and hold: the jet lights, and the wall run takes it over when it starts.
    game.input.simulate('jump', true);
    expect(stepUntil(() => p.wallRunning, 1.5)).toBe(true);
    expect(p.jetting).toBe(false);
    const fuel = p.jetFuel;
    stepFor(0.2);
    expect(p.jetFuel).toBe(fuel);
    game.input.simulate('jump', false);
    step();
    press('jump');
    expect(seen.walls).toBe(1);
    expect(seen.doubles).toBe(0);
  });
});
