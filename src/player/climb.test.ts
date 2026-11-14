/**
 * The parkour update, part 1: the big slam, the wall climb, the cling, the 180 wall jump, chimneys, wall run to wall run and
 * the double jump that only the ground gives back. Real controller, real Rapier, on a course built for it.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Physics } from '../physics/Physics';
import { createHeadlessGame, type HeadlessGame } from './testkit/headless';
import { MOVE } from './tuning';

/** Each lane runs down -Z toward its walls, far enough from the next to be alone. */
const LANE = { wall: 0, ledge: 20, chimney: 40, corridor: 70, open: 100 } as const;
/** Face of the tall wall and of the ledge, both facing +Z. */
const FACE = -10;
const LEDGE = 4;
/** The chimney: faces at z = -20 (facing +Z) and z = -17.6 (facing -Z). */
const CHIMNEY_A = -20;
const CHIMNEY_B = -17.6;

function build(physics: Physics): void {
  const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number) =>
    physics.addStaticBox(new THREE.Vector3(x, y, z), new THREE.Vector3(hx, hy, hz), null, 'concrete');
  box(60, -0.5, -20, 80, 0.5, 60);
  // A wall far too tall to mantle or climb over.
  box(LANE.wall, 15, FACE - 0.5, 4, 15, 0.5);
  // A 4 m ledge, 8 m deep: out of a jump's reach, inside a climb's.
  box(LANE.ledge, LEDGE / 2, FACE - 4, 4, LEDGE / 2, 4);
  // Two tall walls 2.4 m apart.
  box(LANE.chimney, 20, CHIMNEY_A - 0.5, 3, 20, 0.5);
  box(LANE.chimney, 20, CHIMNEY_B + 0.5, 3, 20, 0.5);
  // A corridor 5 m wide and 120 m long, between faces at x = 67.5 and 72.5.
  box(LANE.corridor - 3, 3, -60, 0.5, 3, 60);
  box(LANE.corridor + 3, 3, -60, 0.5, 3, 60);
}

let game: HeadlessGame;
const occupied: number[] = [];
const seen = { doubles: 0, walls: 0, slams: [] as { impact: number; radius: number; big: boolean }[] };

beforeAll(async () => {
  game = await createHeadlessGame(build);
  // The weapon system is not in the headless game: a stand-in records what the body asks of the hands.
  (game.ctx as unknown as { weapons: unknown }).weapons = { occupy: (s: number) => { occupied.push(s); } };
  game.ctx.events.on('player:jumped', e => {
    if (e.double) seen.doubles++;
    if (e.wall) seen.walls++;
  });
  game.ctx.events.on('player:slam', e => { seen.slams.push({ impact: e.impact, radius: e.radius, big: e.big === true }); });
});

const FPS = 120;
const DT = 1 / FPS;
const step = (n = 1) => { for (let i = 0; i < n; i++) game.frame(DT); };
const stepUntil = (test: () => boolean, seconds = 3) => {
  for (let t = 0; t < seconds && !test(); t += DT) step();
  return test();
};
const press = (a: 'jump' | 'dash' | 'slide') => {
  game.input.simulate(a, true);
  step();
  game.input.simulate(a, false);
};

function place(x: number, z: number, y = 0, yaw = 0): void {
  for (const a of ['forward', 'back', 'left', 'right', 'jump', 'dash', 'slide'] as const) game.input.simulate(a, false);
  game.input.consumeLook();
  game.player.reset();
  game.player.teleport(new THREE.Vector3(x, y + 0.05, z), yaw);
  step(6);
  occupied.length = 0;
  seen.doubles = seen.walls = 0;
  seen.slams.length = 0;
}

/** Stands 1.2 m off the tall wall, looking at it, W held, and jumps. Returns once the hands are on it. */
function climbTallWall(): void {
  place(LANE.wall, FACE + 1.2);
  game.input.simulate('forward', true);
  step(2);
  press('jump');
  expect(stepUntil(() => game.player.climbing, 1)).toBe(true);
}

describe('big slam', () => {
  /** Slams from `height` above the floor and returns the frame it lands on. */
  function slamFrom(height: number): void {
    place(LANE.open, 0, height);
    press('slide');
    expect(game.player.slamming).toBe(true);
    expect(stepUntil(() => game.player.grounded, 3)).toBe(true);
  }

  it('starts at 6 m of fall: below it the slam is the small one, bounce and all', () => {
    slamFrom(5.5);
    expect(seen.slams[0]!.big).toBe(false);
    expect(game.player.recovering).toBe(0);
    slamFrom(MOVE.bigSlamHeight + 0.5);
    expect(seen.slams[0]!.big).toBe(true);
    expect(game.player.recovering).toBeGreaterThan(0);
    expect(game.player.state).toBe('ground');
  });

  it('hits wider than a small slam from the same height', () => {
    slamFrom(MOVE.bigSlamHeight + 1);
    const { impact, radius } = seen.slams[0]!;
    const small = THREE.MathUtils.lerp(MOVE.slamRadiusMin, MOVE.slamRadiusMax, Math.min(1, impact / MOVE.slamRadiusFall));
    expect(radius).toBeCloseTo(small * MOVE.bigSlamReach, 5);
  });

  it('kills all momentum and holds the player down for the stand-up: no moving, jumping, sliding or shooting', () => {
    place(LANE.open, 0, 9);
    game.input.simulate('forward', true);
    step(10);
    game.player.velocity.set(0, 0, -15);
    press('slide');
    expect(stepUntil(() => game.player.grounded, 3)).toBe(true);
    expect(game.player.speed).toBe(0);
    expect(occupied.length).toBe(1);
    expect(occupied[0]).toBeGreaterThan(MOVE.bigSlamRecover);
    // `position` is drawn between the last two ticks, and the landing tick still moved.
    step();
    const at = game.player.position.clone();
    game.input.simulate('slide', true);
    let t = DT;
    let jumped = false;
    while (game.player.recovering > 0) {
      if (t > 0.1 && t < 0.15) press('jump');
      else step();
      t += DT;
      jumped ||= !game.player.grounded;
    }
    game.input.simulate('slide', false);
    expect(t).toBeGreaterThan(MOVE.bigSlamRecover - 0.03);
    expect(t).toBeLessThan(MOVE.bigSlamRecover + 0.03);
    expect(jumped).toBe(false);
    expect(game.player.sliding).toBe(false);
    expect(game.player.position.distanceTo(at)).toBeLessThan(1e-6);
    // The hands come back on the tick the stand-up ends, not on the weapon's own count.
    expect(occupied.at(-1)).toBe(0);
    // No bounce out of it either: the press during the stand-up is gone, not kept for after.
    step(30);
    expect(game.player.grounded).toBe(true);
    expect(game.player.speed).toBeGreaterThan(5);
  });

  it('is cut short by a dash, which spends its charge and gives the hands back', () => {
    slamFrom(MOVE.bigSlamHeight + 2);
    step(12);
    expect(game.player.recovering).toBeGreaterThan(0);
    const charges = game.player.dashCharges;
    press('dash');
    expect(game.player.recovering).toBe(0);
    expect(game.player.dashing).toBe(true);
    expect(game.player.speed).toBeGreaterThan(MOVE.runSpeed);
    expect(charges - game.player.dashCharges).toBeGreaterThan(0.99);
    expect(occupied.at(-1)).toBe(0);
  });

  it('keeps the small slam whole: a bounce, and a slide out of it', () => {
    slamFrom(4);
    game.input.simulate('jump', true);
    step();
    game.input.simulate('jump', false);
    expect(game.player.velocity.y).toBeGreaterThan(MOVE.slamBounceMin - 0.01);
  });
});

describe('wall climb', () => {
  it('goes up a wall looked at straight on with W held: three steps, 2.4 m over 0.45 s on top of the jump, gun away', () => {
    climbTallWall();
    const p = game.player;
    const y0 = p.position.y;
    const carry = p.velocity.y;
    expect(occupied[0]).toBeGreaterThan(MOVE.climbTime);
    let t = 0;
    while (p.climbing && t < 2) {
      step();
      t += DT;
    }
    expect(t).toBeCloseTo(MOVE.climbTime, 1);
    // What the jump still carried rides on top of the steps and fades under gravity.
    const rise = p.position.y - y0;
    expect(rise).toBeGreaterThan(MOVE.climbHeight - 0.05);
    expect(rise).toBeLessThan(MOVE.climbHeight + (carry * carry) / (2 * MOVE.gravity) + 0.1);
    expect(occupied.at(-1)).toBe(0);
  });

  it('clings with W still held and slides down from 1.5 m/s building to 4, and drops when W is let go', () => {
    climbTallWall();
    const p = game.player;
    expect(stepUntil(() => p.clinging, 1)).toBe(true);
    expect(p.state).toBe('cling');
    step(2);
    expect(-p.velocity.y).toBeCloseTo(MOVE.clingSlideStart, 0);
    expect(-p.velocity.y).toBeLessThan(MOVE.clingSlideStart + 0.2);
    step(Math.round(MOVE.clingSlideBuild * FPS) + 2);
    expect(p.clinging).toBe(true);
    expect(-p.velocity.y).toBeCloseTo(MOVE.clingSlideMax, 3);
    game.input.simulate('forward', false);
    step();
    expect(p.clinging).toBe(false);
    expect(p.state).toBe('air');
    // Off and falling, and the same wall will not take the hands again before the ground.
    game.input.simulate('forward', true);
    step(10);
    expect(p.climbing || p.clinging).toBe(false);
  });

  it('turns into the mantle when a ledge comes into reach', () => {
    place(LANE.ledge, FACE + 1.2);
    const p = game.player;
    game.input.simulate('forward', true);
    step(2);
    press('jump');
    expect(stepUntil(() => p.climbing, 1)).toBe(true);
    expect(stepUntil(() => p.mantling, 1)).toBe(true);
    expect(p.climbing).toBe(false);
    expect(occupied.at(-1)).toBe(0);
    expect(stepUntil(() => p.grounded, 2)).toBe(true);
    expect(p.position.y).toBeGreaterThan(LEDGE - 0.05);
  });

  it('only on purpose: not from a run with no jump, not looking 45 degrees off, not without W, not falling past', () => {
    const p = game.player;
    // A run at the wall with no jump stops at it.
    place(LANE.wall, FACE + 6);
    game.input.simulate('forward', true);
    step(90);
    expect(p.climbing).toBe(false);
    expect(p.position.y).toBeLessThan(0.1);
    // Looking 45 degrees off the wall: a jump, not a climb.
    place(LANE.wall, FACE + 1.2, 0, Math.PI / 4);
    game.input.simulate('forward', true);
    step(2);
    press('jump');
    for (let i = 0; i < 90; i++) {
      step();
      expect(p.climbing).toBe(false);
    }
    // No W: a jump up beside the wall.
    place(LANE.wall, FACE + 0.6);
    press('jump');
    for (let i = 0; i < 60; i++) {
      step();
      expect(p.climbing).toBe(false);
    }
    // Falling past it fast, W held and looking at it.
    place(LANE.wall, FACE + 0.6, 12);
    game.player.velocity.y = -12;
    game.input.simulate('forward', true);
    for (let i = 0; i < 40; i++) {
      step();
      expect(p.climbing).toBe(false);
    }
  });
});

describe('fighting from the wall', () => {
  it('has the hands back while clinging, with the view free anywhere but into the wall, eased at the edge', () => {
    climbTallWall();
    const p = game.player;
    expect(stepUntil(() => p.clinging, 1)).toBe(true);
    expect(occupied.at(-1)).toBe(0);
    const n = p.climbNormal.clone();
    const off = () => Math.acos(-Math.sin(p.yaw) * n.x - Math.cos(p.yaw) * n.z);
    // Facing the wall: no snap, and turning away is free.
    expect(off()).toBeGreaterThan(Math.PI * 0.9);
    const turn = (rad: number) => {
      game.input.simulateLook(-rad / p.sensitivity, 0);
      step();
    };
    const yaw0 = p.yaw;
    turn(0.6);
    expect(p.yaw - yaw0).toBeCloseTo(0.6, 9);
    // Round to straight out and past it, all free: that is a full 180 from the wall.
    for (let i = 0; i < 6; i++) turn(0.4);
    expect(off()).toBeLessThan(0.6);
    // Back toward the wall: it slows into the wall's plane and stops there.
    const before: number[] = [];
    for (let i = 0; i < 40; i++) {
      const y = p.yaw;
      turn(0.1);
      before.push(Math.abs(p.yaw - y));
      expect(off()).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    }
    expect(before[0]).toBeCloseTo(0.1, 9);
    expect(before.at(-1)!).toBeLessThan(0.01);
    expect(off()).toBeGreaterThan(Math.PI / 2 - 0.1);
    // And away again at once, at full speed.
    const y = p.yaw;
    turn(-0.2);
    expect(Math.abs(p.yaw - y)).toBeCloseTo(0.2, 9);
  });
});

describe('wall jumps', () => {
  it('turns the view half way round over 0.22 s, eased, with the mouse added on top', () => {
    climbTallWall();
    const p = game.player;
    expect(stepUntil(() => p.clinging, 1)).toBe(true);
    const yaw0 = p.yaw;
    const n = p.climbNormal.clone();
    press('jump');
    expect(p.clinging).toBe(false);
    // W is still held and still points at the wall for a moment, so the air takes a little of the push back.
    expect(p.velocity.x * n.x + p.velocity.z * n.z).toBeGreaterThan(MOVE.wallJumpOut - 0.5);
    expect(p.velocity.y).toBeGreaterThan(MOVE.wallJumpUp - 0.5);
    const steps: number[] = [];
    let last = p.yaw;
    for (let i = 0; i < Math.ceil(MOVE.wallJumpTurn * FPS) + 4; i++) {
      // Mouse look throughout, a steady 0.002 rad a frame.
      game.input.simulateLook(-0.002 / p.sensitivity, 0);
      step();
      steps.push(p.yaw - last);
      last = p.yaw;
    }
    const turned = p.yaw - yaw0 - 0.002 * steps.length;
    expect(Math.abs(turned)).toBeCloseTo(Math.PI, 6);
    // Eased: slow out of the wall, fastest in the middle, and only the mouse once it is done.
    const mid = Math.abs(steps[13]! - 0.002);
    expect(Math.abs(steps[0]! - 0.002)).toBeLessThan(mid * 0.2);
    expect(steps.at(-1)!).toBeCloseTo(0.002, 9);
    // Facing out of the wall now.
    expect(-Math.sin(p.yaw - 0.002 * steps.length) * n.x - Math.cos(p.yaw - 0.002 * steps.length) * n.z).toBeCloseTo(1, 6);
  });

  it('climbs a chimney all the way up, wall to wall, with no limit', () => {
    place(LANE.chimney, (CHIMNEY_A + CHIMNEY_B) / 2);
    const p = game.player;
    game.input.simulate('forward', true);
    step(2);
    press('jump');
    let climbs = 0;
    for (let i = 0; i < 8; i++) {
      if (!stepUntil(() => p.climbing, 1)) break;
      climbs++;
      // Jump from the cling, as soon as the climb is over.
      stepUntil(() => !p.climbing, 1);
      press('jump');
    }
    expect(climbs).toBe(8);
    expect(p.position.y).toBeGreaterThan(20);
    expect(seen.doubles).toBe(0);
  });
});

describe('the double jump comes back only on the ground', () => {
  /** Runs down the corridor by its right wall and jumps into a wall run on it. */
  function wallRunRight(): void {
    place(LANE.corridor + 0.9, 0);
    game.input.simulate('forward', true);
    step(30);
    game.player.yaw -= 0.3;
    step(6);
    press('jump');
  }

  it('passes the gun to the left hand on a wall run on the right, not the left, and never stops the shooting', () => {
    wallRunRight();
    const p = game.player;
    expect(stepUntil(() => p.wallRunning, 1.5)).toBe(true);
    expect(p.wallSide).toBe(1);
    // Mid-way through the hand-off, then all the way. Nothing asks the weapons to stop for it.
    const half = stepUntil(() => p.moveAnim.swap > 0.3, 0.2);
    expect(half && p.moveAnim.swap < 0.9).toBe(true);
    expect(stepUntil(() => p.moveAnim.swap === 1, 0.2)).toBe(true);
    expect(p.moveAnim.handSide).toBe(1);
    expect(occupied.filter(s => s > 0)).toEqual([]);
    // Across to the left wall: the gun goes back, and stays in the right hand there.
    p.yaw = 0;
    step(18);
    p.yaw += 0.5;
    step();
    press('jump');
    expect(stepUntil(() => p.wallRunning, 1.5)).toBe(true);
    expect(p.wallSide).toBe(-1);
    expect(p.moveAnim.swap).toBe(0);
    let most = 0;
    for (let i = 0; i < 30 && p.wallRunning; i++) {
      step();
      most = Math.max(most, p.moveAnim.swap);
    }
    expect(most).toBe(0);
    expect(p.moveAnim.handSide).toBe(-1);
    expect(occupied.filter(s => s > 0)).toEqual([]);
  });

  it('runs wall to wall between different walls, kicking across', () => {
    wallRunRight();
    const p = game.player;
    expect(stepUntil(() => p.wallRunning, 1.5)).toBe(true);
    let runs = 1;
    let side = p.wallSide;
    for (let i = 0; i < 4; i++) {
      p.yaw = 0;
      step(18);
      // Look across at the far wall, then kick: the kick steers toward where the player is going.
      p.yaw += 0.5 * side;
      step();
      press('jump');
      if (!stepUntil(() => p.wallRunning, 1.5)) break;
      expect(p.wallSide).toBe(-side);
      side = p.wallSide;
      runs++;
    }
    expect(runs).toBe(5);
  });

  it('is not given back by a wall run or a kick', () => {
    wallRunRight();
    const p = game.player;
    // Spend it on the way in.
    step(6);
    press('jump');
    expect(seen.doubles).toBe(1);
    expect(stepUntil(() => p.wallRunning, 1.5)).toBe(true);
    step(12);
    press('jump');
    expect(seen.walls).toBe(1);
    // In the middle of the corridor, nowhere near a wall: nothing.
    step(12);
    press('jump');
    expect(seen.doubles).toBe(1);
    expect(seen.walls).toBe(1);
    // The ground gives it back. Stopped first, so the press is not a kick off the wall beside.
    expect(stepUntil(() => p.grounded, 3)).toBe(true);
    game.input.simulate('forward', false);
    step(60);
    press('jump');
    step(20);
    press('jump');
    expect(seen.doubles).toBe(2);
  });

  it('is separate from the wall jump: a double jump and then a wall jump off a climb both work', () => {
    place(LANE.wall, FACE + 3);
    const p = game.player;
    game.input.simulate('forward', true);
    step(2);
    press('jump');
    step(30);
    press('jump');
    expect(seen.doubles).toBe(1);
    expect(stepUntil(() => p.climbing, 1)).toBe(true);
    stepUntil(() => !p.climbing, 1);
    press('jump');
    expect(seen.walls).toBe(1);
    // And off the wall, the double jump is still spent.
    step(30);
    press('jump');
    expect(seen.doubles).toBe(1);
  });
});
