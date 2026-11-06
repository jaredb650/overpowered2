/**
 * The promise in parkour.ts, kept: every lesson on real Rapier under the real Player, driven through input.simulate like a keyboard.
 * For each one, the move it teaches gets across and everything less does not, across a sweep of timings no person could beat.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Action, Ctx, PhysicsSystem } from '../core/contracts';
import { noop } from '../core/stubs';
import { createHeadlessGame, type HeadlessGame } from '../player/testkit/headless';
import { Doors } from './doors';
import { PARKOUR } from './parkour';
import type { DoorDef } from './types';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const DT = 1 / 60;
const FALL_FLOOR = -30;
const HALF_WIDTH = 3.5;
const RUN_UP = 28;
/** Long enough to reach full speed and square up. */
const START_Z = 24;
/** Metres short of a wall to jump from, for the lanes that end in one. */
const WALL_TAKEOFF = 2;
/** Frames between leaving a wall and the second jump: about a quarter of a second. */
const SECOND_JUMP_FRAMES = 15;

/** Lanes run north along -z from a lip at z = 0, each with its own x. */
const LANE = { mantle: 0, double: 40, dash: 80, wall: 120, slide: 160 } as const;

function box(ph: PhysicsSystem, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  ph.addStaticBox(V((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), V((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2), null, 'concrete');
}

function deck(ph: PhysicsSystem, x: number): void {
  box(ph, x - HALF_WIDTH, -2, 0, x + HALF_WIDTH, 0, RUN_UP + 4);
}

function build(ph: PhysicsSystem): void {
  box(ph, -100, FALL_FLOOR - 1, -100, 400, FALL_FLOOR, 100);

  // A wall to climb, straight off the run-up.
  for (const [x, ledge] of [[LANE.mantle, PARKOUR.mantle.ledge], [LANE.double, PARKOUR.doubleJump.ledge]] as const) {
    deck(ph, x);
    box(ph, x - HALF_WIDTH, -2, -14, x + HALF_WIDTH, ledge, 0);
  }

  // An open gap.
  deck(ph, LANE.dash);
  box(ph, LANE.dash - HALF_WIDTH, -2, -PARKOUR.dash.gap - 20, LANE.dash + HALF_WIDTH, 0, -PARKOUR.dash.gap);

  // The gallery: a low ceiling over all of it, and one long wall down the east side.
  const { gap, headroom, wallPast, width } = PARKOUR.wallRun;
  const x = LANE.wall;
  const half = width / 2;
  box(ph, x - half, -2, 0, x + half, 0, RUN_UP + 4);
  box(ph, x - half, -2, -gap - 20, x + half, 0, -gap);
  box(ph, x + half, -2, -gap - wallPast, x + half + 1, headroom + 1, RUN_UP + 4);
  box(ph, x - half - 1, -2, -gap - 20, x - half, headroom + 1, RUN_UP + 4);
  box(ph, x - half - 1, headroom, -gap - 20, x + half + 1, headroom + 1, RUN_UP + 4);

  // The yard before the blast door, with a wall either side so nobody goes round.
  const s = LANE.slide;
  box(ph, s - HALF_WIDTH, -2, -20, s + HALF_WIDTH, 0, RUN_UP + 4);
  box(ph, s - HALF_WIDTH - 1, -2, -0.15, s - 3, PARKOUR.slide.doorHeight + 1, 0.15);
  box(ph, s + 3, -2, -0.15, s + HALF_WIDTH + 1, PARKOUR.slide.doorHeight + 1, 0.15);
  box(ph, s - HALF_WIDTH, PARKOUR.slide.doorHeight, -0.15, s + HALF_WIDTH, PARKOUR.slide.doorHeight + 1, 0.15);
}

let game: HeadlessGame;
let doors: Doors;
beforeAll(async () => {
  game = await createHeadlessGame(build);
  const { ctx } = game;
  (ctx.render as unknown as Record<string, unknown>).scene = new THREE.Scene();
  (ctx.render as unknown as Record<string, unknown>).materials = { world: () => new THREE.MeshBasicMaterial() };
  ctx.enemies = noop<Ctx['enemies']>('enemies');
  doors = new Doors(ctx);
});

const frame = (): void => {
  game.frame(DT);
  doors.update(DT);
  (game.ctx.physics as unknown as { flushQueries(): void }).flushQueries();
};

const ALL: readonly Action[] = ['forward', 'back', 'left', 'right', 'jump', 'dash', 'slide'];

function place(x: number, z: number, yaw = 0): void {
  for (const a of ALL) game.input.simulate(a, false);
  game.input.consumeLook();
  game.player.reset();
  game.player.teleport(V(x, 0.05, z), yaw);
  for (let i = 0; i < 4; i++) frame();
}

function tap(action: Action): void {
  game.input.simulate(action, true);
  frame();
  game.input.simulate(action, false);
}

const look = (radians: number): void => game.input.simulateLook(-radians / game.player.sensitivity, 0);

/**
 * Holds forward from the run-up and jumps at `takeoff` metres from the lip, pressing `schedule` at seconds after that, until the player
 * stops or falls. Every wait here is bounded, because a body stopped by a wall would otherwise hold the test for ever.
 */
function fly(x: number, schedule: readonly (readonly [number, Action])[], takeoff = 0.15): void {
  place(x, START_Z);
  game.input.simulate('forward', true);
  runTo(takeoff);
  tap('jump');
  const plan = [...schedule].sort((a, b) => a[0] - b[0]);
  for (let t = 0; t < 4 && game.player.position.y > -8; t += DT) {
    while (plan.length > 0 && plan[0]![0] <= t) tap(plan.shift()![1]);
    frame();
    if (game.player.grounded && t > 0.2) break;
  }
  for (let i = 0; i < 40 && !game.player.grounded; i++) frame();
}

function runTo(z: number): void {
  for (let i = 0; i < 600 && game.player.position.z > z; i++) frame();
}

const onTop = (ledge: number): boolean => game.player.position.y > ledge - 0.3 && game.player.position.z < -0.2;
const across = (gap: number): boolean => game.player.position.y > -0.3 && game.player.position.z < -gap;

function anyTiming(test: () => boolean, x: number, sets: readonly (readonly (readonly [number, Action])[])[], takeoff?: number): boolean {
  for (const set of sets) {
    fly(x, set, takeoff);
    if (test()) return true;
  }
  return false;
}

const times = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let t = from; t <= to + 1e-9; t += step) out.push(t);
  return out;
};

const doubles = times(0.1, 0.62, 0.04).map(a => [[a, 'jump']] as const);
const oneDash = times(0.1, 0.62, 0.08).flatMap(a => times(0, 0.7, 0.1).map(b => [[a, 'jump'], [a + b, 'dash']] as const));
const twoDashes = times(0.1, 0.62, 0.08).flatMap(a => times(0, 0.7, 0.14).flatMap(b => times(0.13, 0.5, 0.12).map(c => [[a, 'jump'], [a + b, 'dash'], [a + b + c, 'dash']] as const)));

describe('mantle, the LZ cut', () => {
  it('climbs on one jump with forward held', () => {
    fly(LANE.mantle, [], WALL_TAKEOFF);
    expect(onTop(PARKOUR.mantle.ledge)).toBe(true);
  });

  it('does not lift a player who only runs at it', () => {
    place(LANE.mantle, 8);
    game.input.simulate('forward', true);
    for (let i = 0; i < 120; i++) frame();
    expect(game.player.position.y).toBeLessThan(0.2);
  });
});

describe('double jump, the wreck', () => {
  it('is out of reach of one jump', () => {
    for (const takeoff of [1.2, WALL_TAKEOFF, 3]) {
      fly(LANE.double, [], takeoff);
      expect(onTop(PARKOUR.doubleJump.ledge)).toBe(false);
    }
  });

  it('is reached from a stand at the hull', () => {
    for (const wait of [0.1, 0.2, 0.3, 0.4]) {
      place(LANE.double, 1);
      tap('jump');
      for (let t = 0; t < wait; t += DT) frame();
      game.input.simulate('forward', true);
      tap('jump');
      for (let i = 0; i < 90; i++) frame();
      expect(onTop(PARKOUR.doubleJump.ledge)).toBe(true);
    }
  });

  it('is reached from a run, with the second press well short of the hull', () => {
    for (const takeoff of [6, 7, 8]) expect(anyTiming(() => onTop(PARKOUR.doubleJump.ledge), LANE.double, doubles, takeoff)).toBe(true);
  });

  it('kicks a runner off the hull if the second press comes at it', () => {
    expect(anyTiming(() => onTop(PARKOUR.doubleJump.ledge), LANE.double, doubles, 3)).toBe(false);
  });
});

describe('dash, the Coolant Hall', () => {
  const gap = PARKOUR.dash.gap;

  it('is too far for a double jump at any timing', () => {
    expect(anyTiming(() => across(gap), LANE.dash, doubles)).toBe(false);
  });

  it('is crossed with a double jump and one dash', () => {
    expect(anyTiming(() => across(gap), LANE.dash, oneDash)).toBe(true);
  });
});

describe('wall run, the cable gallery', () => {
  const { gap, width } = PARKOUR.wallRun;

  it('cannot be crossed on foot, with every jump and both dashes, at any timing', () => {
    expect(anyTiming(() => across(gap), LANE.wall, doubles)).toBe(false);
    expect(anyTiming(() => across(gap), LANE.wall, oneDash)).toBe(false);
    expect(anyTiming(() => across(gap), LANE.wall, twoDashes)).toBe(false);
  });

  /** Runs in a little off the wall, turns into it, and jumps `from` metres before the lip. Forward stays held. */
  function run(from: number, turn: number, kickAfter: number | null, thenJump = false): boolean {
    const p = game.player;
    place(LANE.wall + width / 2 - 2.2, START_Z);
    game.input.simulate('forward', true);
    runTo(from + 3);
    look(-turn);
    runTo(from);
    tap('jump');
    for (let t = 0; t < 1.5 && !p.wallRunning; t += DT) {
      frame();
      if (p.grounded && t > 0.2) break;
    }
    if (!p.wallRunning) return false;
    look(turn);
    let kicked = false;
    for (let t = 0; t < 3 && p.position.y > -8 && !p.grounded; t += DT) {
      if (kickAfter !== null && !kicked && t >= kickAfter && p.wallRunning) {
        look(0.35);
        frame();
        tap('jump');
        kicked = true;
        if (thenJump) {
          for (let i = 0; i < SECOND_JUMP_FRAMES; i++) frame();
          tap('jump');
        }
      }
      frame();
    }
    for (let i = 0; i < 40 && !p.grounded; i++) frame();
    return across(gap);
  }

  it('is crossed by a wall run alone only from the very lip', () => {
    for (const turn of [0.22, 0.3, 0.4]) expect(run(0.5, turn, null)).toBe(true);
    expect(run(4, 0.3, null)).toBe(false);
  });

  it('is crossed by leaving the wall with a jump and jumping again, from anywhere in the last 8 m', () => {
    for (const from of [0.5, 2, 4, 6, 8]) for (const turn of [0.3, 0.4]) expect(run(from, turn, 1.3, true)).toBe(true);
  });

  it('forgives the moment of leaving by about half a second', () => {
    let made = 0;
    for (const leave of [0.9, 1.1, 1.3, 1.5]) if (run(4, 0.3, leave, true)) made++;
    expect(made).toBeGreaterThanOrEqual(3);
  });
});

describe('slide, the blast door', () => {
  const { closeSeconds, doorHeight, triggerRange } = PARKOUR.slide;
  const DOOR: DoorDef = { at: [LANE.slide, 0, 0], yaw: 0, width: 6, height: doorHeight, kind: 'shutter', seconds: closeSeconds, start: 1 };

  /** From a full run at the trigger line: `press` says what to do at how far from the door. */
  function attempt(press: (distance: number) => void): boolean {
    const p = game.player;
    doors.set('blast', DOOR, 1, 0, () => {});
    place(LANE.slide, triggerRange + 8);
    game.input.simulate('forward', true);
    runTo(triggerRange);
    doors.set('blast', DOOR, 0, closeSeconds, () => {});
    for (let t = 0; t < 4; t += DT) {
      press(p.position.z);
      frame();
      if (p.position.z < -1) return true;
    }
    return false;
  }

  it('stops a player who just runs at it', () => {
    expect(attempt(() => {})).toBe(false);
  });

  it('stops a run with both dashes, still standing', () => {
    let left = 2;
    const burst = (): void => {
      if (left === 2 || (left === 1 && game.player.dashCharges >= 1 && !game.player.dashing)) {
        tap('dash');
        left--;
      }
    };
    expect(attempt(burst)).toBe(false);
  });

  it('lets a slide under from anywhere in the last few metres', () => {
    for (const at of [3, 6, 9]) {
      let pressed = false;
      expect(attempt(z => {
        if (!pressed && z <= at) {
          pressed = true;
          game.input.simulate('slide', true);
        }
      })).toBe(true);
      game.input.simulate('slide', false);
    }
  });

  it('never buries a body already under it', () => {
    const p = game.player;
    doors.set('blast', DOOR, 1, 0, () => {});
    place(LANE.slide, 0);
    doors.set('blast', DOOR, 0, 0.5, () => {});
    for (let i = 0; i < 90; i++) frame();
    expect(game.player.isPenetrating()).toBe(false);
    expect(p.position.y).toBeGreaterThan(-0.2);
  });
});
