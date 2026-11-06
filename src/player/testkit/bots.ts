/**
 * Scripted players. A bot is a generator: every `yield` lets one frame pass. The same bots run headless under
 * vitest and in the browser through tools/scripts/movement-bot.mjs, and they only touch the game through
 * input.simulate and simulateLook, so they exercise exactly what a keyboard and mouse would.
 */
import * as THREE from 'three';
import type { Action, Ctx, InputSystem } from '../../core/contracts';
import { mulberry32 } from '../../core/math';
import type { Player } from '../Player';
import { MOVE } from '../tuning';
import { LANES } from './course';

export interface BotApi {
  ctx: Ctx;
  player: Player;
  input: InputSystem;
  /** Seconds per frame of the current run. */
  frameDt(): number;
  metric(name: string, value: number | string | boolean): void;
}

export type BotStep = Generator<void, void, void>;
export type Bot = (b: BotApi) => BotStep;

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

function* wait(b: BotApi, seconds: number): BotStep {
  let t = 0;
  while (t < seconds) {
    yield;
    t += b.frameDt();
  }
}

function* waitUntil(b: BotApi, test: () => boolean, maxSeconds = 8): BotStep {
  let t = 0;
  while (t < maxSeconds && !test()) {
    yield;
    t += b.frameDt();
  }
}

function releaseAll(b: BotApi): void {
  for (const a of ['forward', 'back', 'left', 'right', 'jump', 'dash', 'slide'] as Action[]) b.input.simulate(a, false);
}

function* place(b: BotApi, x: number, y: number, z: number, yaw = 0): BotStep {
  releaseAll(b);
  b.input.consumeLook();
  // A clean slate: cooldowns from the last test must not leak into this one.
  b.player.reset();
  b.player.teleport(v3(x, y, z), yaw);
  // Let the ground check run so each test starts grounded and at rest.
  yield;
  yield;
  yield;
}

function* tap(b: BotApi, action: Action): BotStep {
  b.input.simulate(action, true);
  yield;
  b.input.simulate(action, false);
}

/** Turns the view by radians through simulateLook, as a mouse would. */
function look(b: BotApi, yawDelta: number, pitchDelta = 0): void {
  const p = b.player.sensitivity * b.player.lookScale;
  b.input.simulateLook(-yawDelta / p, -pitchDelta / p);
}

function velAngle(p: Player): number {
  // Yaw that points along horizontal velocity: forward is (-sin yaw, -cos yaw).
  return Math.atan2(-p.velocity.x, -p.velocity.z);
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Ground acceleration and stopping. */
export const groundBot: Bot = function* (b) {
  const p = b.player;
  yield* place(b, LANES.strafe, 0.1, 0);
  b.input.simulate('forward', true);
  let t = 0;
  let t90 = -1;
  let t100 = -1;
  while (t < 0.6) {
    yield;
    t += b.frameDt();
    if (t90 < 0 && p.speed >= MOVE.runSpeed * 0.9) t90 = t;
    if (t100 < 0 && p.speed >= MOVE.runSpeed * 0.995) t100 = t;
  }
  b.metric('accel_t90_s', round(t90, 3));
  b.metric('accel_t100_s', round(t100, 3));
  b.metric('top_speed', round(p.speed));
  b.input.simulate('forward', false);
  t = 0;
  while (p.speed > 0.2 && t < 1) {
    yield;
    t += b.frameDt();
  }
  b.metric('stop_s', round(t, 3));
};

/** Fresh Space presses timed for the landing, as a skilled hand does it. Call once per frame. `lead` is how early. */
function hopTiming(b: BotApi, lead = 0.05): void {
  const p = b.player;
  const landing = p.velocity.y < 0 && p.position.y < -p.velocity.y * lead;
  b.input.simulate('jump', p.grounded || landing);
}

/** Counts landings through the event, because a timed hop spends a single tick on the ground. */
function landingCounter(b: BotApi): { count: number; speeds: number[]; stop: () => void } {
  const c = { count: 0, speeds: [] as number[], stop: () => {} };
  c.stop = b.ctx.events.on('player:landed', () => {
    c.count++;
    c.speeds.push(round(b.player.speed));
  });
  return c;
}

/**
 * Near-perfect strafe-jumping. The bot holds W and one strafe key and turns the view so the wish direction sits
 * at the ideal angle to velocity, alternating sides each hop so the path stays roughly straight.
 */
function* strafeHops(b: BotApi, hops: number, sideOnly: boolean): BotStep {
  const p = b.player;
  yield* place(b, LANES.strafe, 0.1, 0);
  b.input.simulate('forward', true);
  yield* wait(b, 0.3);
  const landings = landingCounter(b);
  const speeds: number[] = [round(p.speed)];
  const h = 1 / MOVE.hz;
  let side = 1;
  let counted = 0;
  while (landings.count < hops) {
    hopTiming(b);
    if (landings.count !== counted) {
      counted = landings.count;
      side = -side;
    }
    b.input.simulate('forward', !sideOnly);
    b.input.simulate('left', side > 0);
    b.input.simulate('right', side < 0);
    const speed = Math.max(p.speed, 1);
    const wish = sideOnly ? MOVE.sideWishSpeed : MOVE.airWishSpeed;
    const accel = sideOnly ? MOVE.sideAccel : MOVE.airAccel;
    const add = accel * wish * h;
    const ideal = Math.acos(Math.max(-1, Math.min(1, (wish - add) / speed)));
    // With W+A the wish is 45 degrees left of the view. With A alone it is 90.
    const offset = sideOnly ? Math.PI / 2 : Math.PI / 4;
    // Velocity keeps turning toward the wish during the frame. A human's steady sweep leads it for free; a bot
    // aiming at where velocity is now would fall behind and gain less at low frame rates.
    const lead = ((accel * wish * Math.sin(ideal)) / speed) * b.frameDt() * (sideOnly ? 0.5 : 1);
    const targetYaw = velAngle(p) + side * (ideal - offset + lead);
    look(b, wrap(targetYaw - p.yaw));
    yield;
  }
  landings.stop();
  speeds.push(...landings.speeds);
  b.metric(sideOnly ? 'side_strafe_speeds' : 'strafe_speeds', speeds.join(' '));
  b.metric(sideOnly ? 'side_strafe_final' : 'strafe_final', speeds[speeds.length - 1]!);
  releaseAll(b);
}

/** What a hand does: W plus a strafe key and one steady mouse sweep per hop, swapping sides on each landing. */
function* sweepHops(b: BotApi, hops: number, degPerSecond: number): BotStep {
  const p = b.player;
  yield* place(b, LANES.strafe, 0.1, 0);
  b.input.simulate('forward', true);
  yield* wait(b, 0.3);
  const landings = landingCounter(b);
  const speeds: number[] = [round(p.speed)];
  let side = 1;
  let counted = 0;
  while (landings.count < hops) {
    hopTiming(b);
    if (landings.count !== counted) {
      counted = landings.count;
      side = -side;
    }
    b.input.simulate('left', side > 0);
    b.input.simulate('right', side < 0);
    look(b, side * ((degPerSecond * Math.PI) / 180) * b.frameDt());
    yield;
  }
  landings.stop();
  speeds.push(...landings.speeds);
  b.metric(`sweep${degPerSecond}_speeds`, speeds.join(' '));
  releaseAll(b);
}

export const strafeBot: Bot = b => strafeHops(b, 10, false);
export const sideStrafeBot: Bot = b => strafeHops(b, 10, true);
export const sweepBot: Bot = function* (b) {
  yield* sweepHops(b, 10, 0);
  yield* sweepHops(b, 10, 30);
  yield* sweepHops(b, 10, 60);
  yield* sweepHops(b, 10, 100);
};

/** W alone, hops in time: speed holds exactly, proving a hop costs nothing. Then what a hop costs when it is late. */
export const bhopBot: Bot = function* (b) {
  const p = b.player;
  yield* place(b, LANES.strafe, 0.1, 0);
  b.input.simulate('forward', true);
  yield* wait(b, 0.3);
  const start = p.speed;
  const landings = landingCounter(b);
  let min = Infinity;
  const startZ = p.position.z;
  let t = 0;
  while (t < 6) {
    hopTiming(b);
    yield;
    t += b.frameDt();
    min = Math.min(min, p.speed);
  }
  landings.stop();
  b.metric('timed_hops', landings.count);
  b.metric('timed_min_speed', round(min));
  b.metric('timed_end_speed', round(p.speed));
  b.metric('timed_loss', round(start - min, 3));
  b.metric('timed_distance', round(startZ - p.position.z));
  releaseAll(b);

  // Landing at 24 m/s and pressing Space this long after touchdown: speed carried into the next hop.
  for (const late of [0.03, 0.05, 0.1, 0.2]) {
    yield* place(b, LANES.strafe, 1, 0);
    b.input.simulate('forward', true);
    p.velocity.set(0, -5, -24);
    yield* waitUntil(b, () => p.grounded, 1);
    yield* wait(b, late);
    yield* tap(b, 'jump');
    yield* waitUntil(b, () => !p.grounded, 0.1);
    b.metric(`hop_late_${late * 1000}ms`, round(p.speed));
    releaseAll(b);
  }
};

export const jumpBot: Bot = function* (b) {
  const p = b.player;
  yield* place(b, LANES.strafe, 0.1, 0);
  yield* tap(b, 'jump');
  let top = 0;
  let t = 0;
  yield;
  while (!p.grounded && t < 3) {
    top = Math.max(top, p.position.y);
    yield;
    t += b.frameDt();
  }
  b.metric('jump_height', round(top));
  b.metric('jump_air_time', round(t));

  yield* place(b, LANES.strafe, 0.1, 0);
  yield* tap(b, 'jump');
  yield* wait(b, 0.35);
  yield* tap(b, 'jump');
  top = 0;
  t = 0;
  yield;
  while (!p.grounded && t < 4) {
    top = Math.max(top, p.position.y);
    yield;
    t += b.frameDt();
  }
  b.metric('double_jump_height', round(top));

  // Redirect: run forward, jump, double jump to the right.
  yield* place(b, LANES.strafe, 0.1, 0);
  b.input.simulate('forward', true);
  yield* wait(b, 0.3);
  yield* tap(b, 'jump');
  yield* wait(b, 0.2);
  b.input.simulate('forward', false);
  b.input.simulate('right', true);
  yield;
  yield* tap(b, 'jump');
  yield;
  yield;
  b.metric('double_redirect_deg', round((Math.atan2(p.velocity.x, -p.velocity.z) * 180) / Math.PI, 1));
  b.metric('double_redirect_speed', round(p.speed));
  releaseAll(b);
};

export const dashBot: Bot = function* (b) {
  const p = b.player;
  yield* place(b, LANES.strafe, 0.1, 0);
  const z0 = p.position.z;
  yield* tap(b, 'dash');
  let peak = 0;
  let t = 0;
  while (p.dashing || t < 0.02) {
    peak = Math.max(peak, p.speed);
    yield;
    t += b.frameDt();
  }
  b.metric('dash_time', round(t, 3));
  b.metric('dash_peak', round(peak));
  b.metric('dash_distance', round(z0 - p.position.z));
  b.metric('dash_exit', round(p.speed));
  b.metric('dash_charges_after', round(p.dashCharges));

  // In the air, falling: a dash zeroes the fall.
  yield* place(b, LANES.strafe, 8, 0);
  yield* wait(b, 0.4);
  const fall = p.velocity.y;
  yield* tap(b, 'dash');
  yield;
  yield;
  b.metric('dash_fall_before', round(fall));
  b.metric('dash_fall_during', round(p.velocity.y));

  // Momentum: dash sideways at speed keeps all of it.
  yield* place(b, LANES.strafe, 0.1, 0);
  b.input.simulate('forward', true);
  yield* wait(b, 0.3);
  yield* tap(b, 'jump');
  yield* wait(b, 0.1);
  p.velocity.multiplyScalar(1.8);
  p.velocity.y = 4;
  const fast = p.speed;
  b.input.simulate('forward', false);
  b.input.simulate('right', true);
  yield;
  yield* tap(b, 'dash');
  yield* waitUntil(b, () => !p.dashing, 0.5);
  b.metric('dash_momentum_in', round(fast));
  b.metric('dash_momentum_out', round(p.speed));
  releaseAll(b);
};

export const slideBot: Bot = function* (b) {
  const p = b.player;
  yield* place(b, LANES.strafe, 0.1, 0);
  b.input.simulate('forward', true);
  yield* wait(b, 0.35);
  const entry = p.speed;
  const z0 = p.position.z;
  b.input.simulate('slide', true);
  yield;
  yield;
  const boosted = p.speed;
  let t = 0;
  while (p.sliding && t < 8) {
    yield;
    t += b.frameDt();
  }
  b.metric('slide_entry', round(entry));
  b.metric('slide_boosted', round(boosted));
  b.metric('slide_time', round(t));
  b.metric('slide_distance', round(z0 - p.position.z));
  releaseAll(b);
  yield* wait(b, 0.3);

  // Boost cooldown: an immediate second slide gets no boost.
  yield* place(b, LANES.strafe, 0.1, 0);
  b.input.simulate('forward', true);
  yield* wait(b, MOVE.slideBoostCooldown);
  b.input.simulate('slide', true);
  yield* wait(b, 0.1);
  b.input.simulate('slide', false);
  yield* wait(b, 0.05);
  const before = p.speed;
  b.input.simulate('slide', true);
  yield;
  yield;
  b.metric('slide_retap_ratio', round(p.speed / before, 3));
  releaseAll(b);

  // Slide-jump keeps everything.
  yield* place(b, LANES.strafe, 0.1, 0);
  b.input.simulate('forward', true);
  yield* wait(b, MOVE.slideBoostCooldown);
  b.input.simulate('slide', true);
  yield* wait(b, 0.3);
  const atJump = p.speed;
  b.input.simulate('slide', false);
  yield* tap(b, 'jump');
  yield;
  b.metric('slide_jump_in', round(atJump));
  b.metric('slide_jump_out', round(p.speed));
  releaseAll(b);

  // Downhill: the 20 degree descent of the ramp lane.
  const x = LANES.ramp;
  // Start at the top flat, sliding down the far side.
  yield* place(b, x, 13.7 + 0.2, -60);
  b.input.simulate('forward', true);
  yield* waitUntil(b, () => p.position.y < 13.5, 3);
  const topSpeed = p.speed;
  b.input.simulate('slide', true);
  let peak = 0;
  yield* waitUntil(b, () => {
    peak = Math.max(peak, p.velocity.length());
    return p.position.y < 0.6;
  }, 5);
  b.metric('slide_downhill_in', round(topSpeed));
  b.metric('slide_downhill_peak', round(peak));
  releaseAll(b);
};

export const slamBot: Bot = function* (b) {
  const p = b.player;
  const { events } = b.ctx;
  let impact = 0;
  let radius = 0;
  const off = events.on('player:slam', e => { impact = e.impact; radius = e.radius; });
  yield* place(b, LANES.strafe, 12, 0);
  yield;
  yield* tap(b, 'slide');
  yield;
  b.metric('slam_v', round(p.velocity.y));
  yield* waitUntil(b, () => p.grounded, 3);
  b.metric('slam_impact_12m', round(impact));
  b.metric('slam_radius_12m', round(radius));

  // Bounce: jump held at impact.
  yield* place(b, LANES.strafe, 15, 0);
  yield;
  yield* tap(b, 'slide');
  yield* waitUntil(b, () => p.position.y < 3.2, 3);
  b.input.simulate('jump', true);
  yield* waitUntil(b, () => p.velocity.y > 1, 2);
  b.input.simulate('jump', false);
  const bounce = p.velocity.y;
  let top = 0;
  yield* waitUntil(b, () => {
    top = Math.max(top, p.position.y);
    return p.velocity.y <= 0;
  }, 3);
  b.metric('slam_bounce_v', round(bounce));
  b.metric('slam_bounce_height', round(top));
  releaseAll(b);
  off();
};

export const wallBot: Bot = function* (b) {
  const p = b.player;
  const x = LANES.wall;
  // Start beside the right wall, turn toward it, then jump into it at a shallow angle.
  yield* place(b, x + 2.5, 0.1, -30, 0);
  b.input.simulate('forward', true);
  yield* wait(b, 0.2);
  const yawOff = -0.3;
  look(b, yawOff);
  yield* wait(b, 0.1);
  b.input.simulate('jump', true);
  yield;
  b.input.simulate('jump', false);
  yield* waitUntil(b, () => p.wallRunning, 1.5);
  b.metric('wallrun_started', p.wallRunning);
  look(b, -yawOff);
  const startZ = p.position.z;
  const startY = p.position.y;
  const entry = p.speed;
  let t = 0;
  let gravityFree = -1;
  while (p.wallRunning && t < 5) {
    yield;
    t += b.frameDt();
    // An entry can arrive still falling, which the first few tenths damp out.
    if (gravityFree < 0 && t > 0.3 && p.velocity.y < -0.2) gravityFree = t;
  }
  b.metric('wallrun_entry_speed', round(entry));
  b.metric('wallrun_time', round(t));
  b.metric('wallrun_hold', round(gravityFree));
  b.metric('wallrun_distance', round(startZ - p.position.z));
  b.metric('wallrun_y_lost', round(startY - p.position.y));
  b.metric('wallrun_exit_speed', round(p.speed));
  releaseAll(b);

  // Zig-zag down a 5 m corridor: kick between the two walls and count how speed grows.
  yield* place(b, LANES.brush + 31, 0.1, -10, 0);
  b.input.simulate('forward', true);
  yield* wait(b, 0.2);
  look(b, -0.3);
  yield* wait(b, 0.1);
  yield* tap(b, 'jump');
  yield* waitUntil(b, () => p.wallRunning, 1.5);
  look(b, 0.3);
  const speeds: number[] = [round(p.speed)];
  let kicks = 0;
  for (let i = 0; i < 6; i++) {
    yield* wait(b, 0.15);
    if (!p.wallRunning) break;
    // Look across at the far wall first, because the kick steers toward where the player is heading. The angle
    // is shallow enough for the far wall to take a wall run.
    const toFar = (i % 2 === 0 ? 1 : -1) * 0.5;
    look(b, toFar);
    yield;
    yield* tap(b, 'jump');
    kicks++;
    speeds.push(round(p.speed));
    yield* waitUntil(b, () => p.wallRunning || p.grounded, 2);
    look(b, -toFar);
    if (p.grounded) break;
  }
  b.metric('wall_zigzag_speeds', speeds.join(' '));
  b.metric('wall_zigzag_kicks', kicks);
  releaseAll(b);
};

/** The headline chain: slide, jump, wall run, kick, dash, slam. Reports speed at every link. */
export const chainBot: Bot = function* (b) {
  const p = b.player;
  const x = LANES.wall;
  const log: string[] = [];
  const mark = (s: string) => log.push(`${s}:${round(p.speed, 1)}`);
  yield* place(b, x + 2.5, 0.1, -20, 0);
  b.input.simulate('forward', true);
  yield* wait(b, 0.35);
  mark('run');
  b.input.simulate('slide', true);
  yield* wait(b, 0.1);
  look(b, -0.3);
  yield* wait(b, 0.1);
  mark('slide');
  yield* tap(b, 'jump');
  b.input.simulate('slide', false);
  yield* wait(b, 0.03);
  mark('jump');
  yield* waitUntil(b, () => p.wallRunning, 1.5);
  mark(p.wallRunning ? 'wallrun' : 'NO_WALLRUN');
  look(b, 0.3);
  yield* wait(b, 0.5);
  mark('wallrun+0.5');
  yield* tap(b, 'jump');
  yield;
  mark('kick');
  yield* wait(b, 0.15);
  yield* tap(b, 'dash');
  yield* wait(b, 0.06);
  mark('dash');
  yield* waitUntil(b, () => !p.dashing, 0.4);
  mark('dash_end');
  yield* wait(b, 0.08);
  const y = p.position.y;
  yield* tap(b, 'slide');
  b.input.simulate('slide', true);
  yield* wait(b, 0.02);
  mark(`slam@${round(y, 1)}m`);
  yield* waitUntil(b, () => p.grounded, 2);
  mark('slam_land');
  yield* wait(b, 0.1);
  mark(`post:${p.state}`);
  b.metric('chain', log.join(' > '));
  releaseAll(b);
};

export const mantleBot: Bot = function* (b) {
  const p = b.player;
  const x = LANES.mantle;
  const results: string[] = [];
  const heights = [0.8, 1.2, 1.6, 2.0, 2.4, 2.8, 3.2, 4.0];
  for (let i = 0; i < heights.length; i++) {
    const front = -14 - 26 * i;
    // Run at it, jumping just before the wall.
    yield* place(b, x, 0.1, front + 12);
    b.input.simulate('forward', true);
    yield* waitUntil(b, () => p.position.z < front + 2.5, 2);
    const entry = p.speed;
    b.input.simulate('jump', true);
    yield;
    b.input.simulate('jump', false);
    let cleared = false;
    let t = 0;
    while (t < 2) {
      yield;
      t += b.frameDt();
      if (p.grounded && p.position.y > heights[i]! - 0.3) {
        cleared = true;
        break;
      }
    }
    results.push(`${heights[i]}m:${cleared ? 'ok' : 'no'}@${round(p.speed, 1)}/${round(entry, 1)}`);
    releaseAll(b);
  }
  b.metric('mantle_results', results.join(' '));

  // Without a jump nothing lifts the player, running or sliding.
  const ground: string[] = [];
  for (let i = 0; i < 4; i++) {
    const front = -14 - 26 * i;
    yield* place(b, x, 0.1, front + 12);
    b.input.simulate('forward', true);
    let t = 0;
    let top = 0;
    while (t < 1.4) {
      yield;
      t += b.frameDt();
      top = Math.max(top, p.position.y);
    }
    ground.push(`${heights[i]}m:${round(top, 2)}`);
    releaseAll(b);
  }
  b.metric('mantle_ground_top_y', ground.join(' '));
  yield* place(b, x, 0.1, -14 + 14);
  b.input.simulate('forward', true);
  yield* wait(b, 0.3);
  b.input.simulate('slide', true);
  yield* wait(b, 1.5);
  b.metric('mantle_from_slide_y', round(p.position.y));
  releaseAll(b);

  // A fast mantle keeps the speed.
  yield* place(b, x, 3, -40 - 26 + 12);
  b.input.simulate('forward', true);
  yield;
  p.velocity.set(0, 0, -30);
  yield* waitUntil(b, () => p.mantling, 1);
  yield* waitUntil(b, () => !p.mantling, 1);
  b.metric('mantle_fast_exit', round(p.speed));
  releaseAll(b);
};

export const stairsBot: Bot = function* (b) {
  const p = b.player;
  const x = LANES.stairs;
  yield* place(b, x, 0.1, 4);
  b.input.simulate('forward', true);
  yield* waitUntil(b, () => p.position.z < -5.5, 2);
  const inSpeed = p.speed;
  let min = Infinity;
  let air = 0;
  yield* waitUntil(b, () => {
    min = Math.min(min, p.speed);
    if (!p.grounded) air++;
    return p.position.z < -16;
  }, 3);
  b.metric('stairs_up_in', round(inSpeed));
  b.metric('stairs_up_min', round(min));
  b.metric('stairs_up_y', round(p.position.y));
  b.metric('stairs_up_airframes', air);
  yield* waitUntil(b, () => p.position.z < -38, 3);
  min = Infinity;
  air = 0;
  yield* waitUntil(b, () => {
    min = Math.min(min, p.speed);
    if (!p.grounded) air++;
    return p.position.z < -47;
  }, 3);
  b.metric('stairs_down_min', round(min));
  b.metric('stairs_down_airframes', air);
  releaseAll(b);

  // Fast: 40 m/s straight up the stairs, then back down the far side.
  yield* place(b, x, 0.1, -2);
  b.input.simulate('forward', true);
  yield* wait(b, 0.05);
  p.velocity.z = -40;
  yield* waitUntil(b, () => p.position.z < -5.5, 1);
  const fastIn = p.speed;
  let peakVy = 0;
  let touched = 0;
  yield* waitUntil(b, () => {
    peakVy = Math.max(peakVy, p.velocity.y);
    if (p.grounded) touched++;
    return p.position.z < -15.5;
  }, 2);
  b.metric('stairs_fast_in', round(fastIn));
  b.metric('stairs_fast_out', round(p.speed));
  b.metric('stairs_fast_y', round(p.position.y));
  b.metric('stairs_fast_peak_vy', round(peakVy));
  b.metric('stairs_fast_ground_frames', touched);
  releaseAll(b);
};

export const rampBot: Bot = function* (b) {
  const p = b.player;
  const x = LANES.ramp;
  yield* place(b, x, 0.1, 5);
  b.input.simulate('forward', true);
  yield* waitUntil(b, () => p.position.z < -12, 2);
  const inSpeed = p.speed;
  yield* waitUntil(b, () => p.position.y > 5, 3);
  b.metric('ramp_run_in', round(inSpeed));
  b.metric('ramp_run_speed3d', round(p.velocity.length()));
  b.metric('ramp_run_grounded', p.grounded);
  releaseAll(b);

  // Launch ramp at 30 m/s.
  yield* place(b, x + 20, 0.1, 30);
  b.input.simulate('forward', true);
  yield* waitUntil(b, () => {
    p.velocity.z = -30;
    return p.position.z < -14;
  }, 3);
  yield* waitUntil(b, () => p.position.z < -20 || p.position.y > 2, 3);
  let top = 0;
  let far = 0;
  yield* waitUntil(b, () => {
    top = Math.max(top, p.position.y);
    far = p.position.z;
    return p.grounded && p.position.y < 1;
  }, 6);
  b.metric('launch_ramp_top', round(top));
  b.metric('launch_ramp_land_z', round(far));
  releaseAll(b);

  // Ramp at speed: 45 m/s up the 20 degree ramp keeps 3D speed and launches from the crest.
  yield* place(b, x, 0.1, -2);
  b.input.simulate('forward', true);
  yield* wait(b, 0.05);
  yield* waitUntil(b, () => {
    p.velocity.z = Math.min(p.velocity.z, -42);
    return p.position.y > 3;
  }, 1);
  b.metric('ramp_fast_speed3d', round(p.velocity.length()));
  yield* waitUntil(b, () => !p.grounded, 2);
  b.metric('ramp_fast_launch_vy', round(p.velocity.y));
  let topY = 0;
  yield* waitUntil(b, () => {
    topY = Math.max(topY, p.position.y);
    return p.grounded;
  }, 5);
  b.metric('ramp_fast_top_y', round(topY));
  releaseAll(b);

  // Down the far ramp at speed: stays on the ground and keeps every m/s.
  yield* place(b, x, 13.9, -68);
  b.input.simulate('forward', true);
  yield* wait(b, 0.05);
  let lift = 0;
  yield* waitUntil(b, () => {
    p.velocity.z = Math.min(p.velocity.z, -38);
    if (!p.grounded) lift++;
    return p.position.y < 2;
  }, 3);
  b.metric('ramp_down_fast_speed3d', round(p.velocity.length()));
  b.metric('ramp_down_fast_airframes', lift);
  releaseAll(b);

  // Steep slope cannot be walked: 62 degrees.
  yield* place(b, x - 20, 0.1, 0);
  b.input.simulate('forward', true);
  yield* wait(b, 1.5);
  b.metric('steep_y', round(p.position.y));
  b.metric('steep_grounded', p.grounded);
  releaseAll(b);
};

export const curbBot: Bot = function* (b) {
  const p = b.player;
  const x = LANES.curbs;
  for (const speed of [MOVE.runSpeed, 40]) {
    yield* place(b, x, 0.1, 30);
    b.input.simulate('forward', true);
    yield* wait(b, 0.3);
    let min = Infinity;
    let top = 0;
    let t = 0;
    yield* waitUntil(b, () => {
      t += b.frameDt();
      // Nobody can run at 40, but a landing can arrive at it, and a curb must not throw that into the air.
      if (speed > MOVE.runSpeed) p.velocity.z = -speed;
      if (t > 0.1) min = Math.min(min, p.speed);
      top = Math.max(top, p.velocity.y);
      return p.position.z < -190;
    }, 24);
    const label = speed === 40 ? 'fast' : 'run';
    b.metric(`curbs_${label}_min`, round(min));
    b.metric(`curbs_${label}_max_vy`, round(top));
    b.metric(`curbs_${label}_reached`, p.position.z < -189);
    releaseAll(b);
  }
};

export const edgeBot: Bot = function* (b) {
  const p = b.player;

  // No tunnelling: fire the player at a wall at 60 m/s and at 150 m/s.
  const wx = LANES.wall - 4.5;
  for (const speed of [60, 150]) {
    yield* place(b, wx + 30, 1, -100, 0);
    p.launch(v3(-speed, 2, 0));
    yield* wait(b, 1);
    b.metric(`tunnel_${speed}_side`, p.position.x > wx - 0.5 ? 'safe' : 'THROUGH');
  }
  releaseAll(b);

  // Ceiling: jump under the 2.6 m hall. Upward speed dies, horizontal speed does not.
  const lx = LANES.low;
  yield* place(b, lx, 0.1, -85);
  b.input.simulate('forward', true);
  yield* wait(b, 0.3);
  const run = p.speed;
  yield* tap(b, 'jump');
  let maxY = 0;
  let airSpeed = run;
  yield* waitUntil(b, () => {
    maxY = Math.max(maxY, p.position.y);
    if (!p.grounded) airSpeed = Math.min(airSpeed, p.speed);
    return p.grounded && maxY > 0.1;
  }, 2);
  b.metric('ceiling_max_feet_y', round(maxY));
  b.metric('ceiling_speed_in', round(run));
  b.metric('ceiling_speed_out', round(airSpeed));
  releaseAll(b);

  // Crouch tunnel: slide in, release inside, stay crouched, stand after leaving.
  yield* place(b, lx, 0.1, -4);
  b.input.simulate('forward', true);
  yield* wait(b, 0.3);
  b.input.simulate('slide', true);
  yield* waitUntil(b, () => p.position.z < -30, 2);
  b.input.simulate('slide', false);
  yield* wait(b, 0.2);
  b.metric('tunnel_crouched_inside', p.crouched);
  yield* waitUntil(b, () => p.position.z < -63, 9);
  yield* wait(b, 0.1);
  b.metric('tunnel_stood_after', !p.crouched);
  b.metric('tunnel_exit_speed', round(p.speed));
  releaseAll(b);

  // Slide into a wall head-on, then along one at an angle.
  yield* place(b, LANES.wall, 0.1, -40, Math.PI / 2);
  b.input.simulate('forward', true);
  yield* wait(b, 0.25);
  b.input.simulate('slide', true);
  yield* wait(b, 1.2);
  b.metric('slide_wall_x_ok', p.position.x > LANES.wall - 4.5);
  b.metric('slide_wall_state', p.state);
  releaseAll(b);

  // Corner: run into the L and press into it.
  const cx = LANES.corner;
  yield* place(b, cx - 3, 0.1, -70, 0.6);
  b.input.simulate('forward', true);
  yield* wait(b, 1.5);
  b.metric('corner_stuck_speed', round(p.speed));
  b.metric('corner_safe', p.position.x > cx - 6 && p.position.z > -80);
  yield* tap(b, 'jump');
  yield* wait(b, 0.7);
  b.metric('corner_can_jump', p.position.y > -1);
  releaseAll(b);

  // Wall run into the L: inside corner, speed carries round.
  yield* place(b, cx - 4.4, 0.1, -62, 0);
  b.input.simulate('forward', true);
  yield* wait(b, 0.15);
  look(b, 0.3);
  yield* wait(b, 0.1);
  yield* tap(b, 'jump');
  yield* waitUntil(b, () => p.wallRunning, 1.5);
  look(b, -0.3);
  b.metric('corner_wr_started', p.wallRunning);
  const inSpeed = p.speed;
  yield* waitUntil(b, () => p.position.z < -79 || !p.wallRunning, 3);
  yield* wait(b, 0.1);
  b.metric('corner_wr_in', round(inSpeed));
  b.metric('corner_wr_after', round(p.speed));
  b.metric('corner_wr_state', p.state);
  releaseAll(b);

  // Round column: run around the curve.
  const rx = LANES.round;
  yield* place(b, rx + 14.5, 0.1, -40, 0);
  b.input.simulate('forward', true);
  yield* wait(b, 0.2);
  look(b, 0.25);
  yield* wait(b, 0.1);
  yield* tap(b, 'jump');
  yield* waitUntil(b, () => p.wallRunning, 1.5);
  b.metric('round_started', p.wallRunning);
  let t = 0;
  let turn = 0;
  let last = velAngle(p);
  while (p.wallRunning && t < 3) {
    yield;
    t += b.frameDt();
    const now = velAngle(p);
    turn += Math.abs(wrap(now - last));
    last = now;
  }
  b.metric('round_time', round(t));
  b.metric('round_turn_deg', round((turn * 180) / Math.PI));
  releaseAll(b);
};

/** How far each tool carries from a full run, on flat ground. These are the numbers level design builds gaps from. */
export const reachBot: Bot = function* (b) {
  const p = b.player;
  const sequence = function* (name: string, steps: [number, Action][]): BotStep {
    yield* place(b, LANES.strafe, 0.1, 0);
    b.input.simulate('forward', true);
    yield* wait(b, 0.3);
    const z0 = p.position.z;
    let t = 0;
    let i = 0;
    let top = 0;
    let wasAir = false;
    while (t < 6) {
      while (i < steps.length && t >= steps[i]![0]) {
        const action = steps[i]![1];
        i++;
        b.input.simulate(action, true);
        yield;
        b.input.simulate(action, false);
        t += b.frameDt();
      }
      yield;
      t += b.frameDt();
      top = Math.max(top, p.position.y);
      if (!p.grounded) wasAir = true;
      else if (wasAir) break;
    }
    b.metric(`reach_${name}`, `${round(z0 - p.position.z, 1)}m high ${round(top, 1)}m`);
    releaseAll(b);
  };
  yield* sequence('jump', [[0, 'jump']]);
  yield* sequence('jump_double', [[0, 'jump'], [0.45, 'jump']]);
  yield* sequence('jump_double_dash', [[0, 'jump'], [0.45, 'jump'], [0.95, 'dash']]);
  yield* sequence('jump_double_dash_dash', [[0, 'jump'], [0.45, 'jump'], [0.95, 'dash'], [1.25, 'dash']]);
};

/** Speed exploits that must stay closed: flat-ground loops that gain without strafing. */
export const exploitBot: Bot = function* (b) {
  const p = b.player;

  // Jump, slam at the first legal moment, land in a slide, repeat.
  yield* place(b, LANES.strafe, 0.1, 0);
  b.input.simulate('forward', true);
  yield* wait(b, 0.3);
  let t = 0;
  while (t < 8) {
    yield* tap(b, 'jump');
    yield* wait(b, 0.3);
    b.input.simulate('slide', true);
    yield* waitUntil(b, () => p.grounded, 1);
    yield* wait(b, 0.05);
    b.input.simulate('slide', false);
    t += 0.45;
  }
  b.metric('slam_slide_loop_speed', round(p.speed));
  releaseAll(b);

  // Dash-jump on every charge.
  yield* place(b, LANES.strafe, 0.1, 0);
  b.input.simulate('forward', true);
  yield* wait(b, 0.3);
  t = 0;
  let peak = 0;
  while (t < 10) {
    if (p.grounded && p.dashCharges >= 1) {
      yield* tap(b, 'dash');
      yield* wait(b, 0.06);
      yield* tap(b, 'jump');
    }
    yield;
    t += b.frameDt();
    peak = Math.max(peak, p.speed);
  }
  b.metric('dash_jump_loop_peak', round(peak));
  releaseAll(b);

  // Slide-hop on every boost.
  yield* place(b, LANES.strafe, 0.1, 0);
  b.input.simulate('forward', true);
  yield* wait(b, 0.3);
  t = 0;
  peak = 0;
  while (t < 10) {
    if (p.grounded) {
      b.input.simulate('slide', true);
      yield* wait(b, 0.04);
      b.input.simulate('slide', false);
      yield* tap(b, 'jump');
      yield* wait(b, 0.04);
      t += 0.1;
    }
    yield;
    t += b.frameDt();
    peak = Math.max(peak, p.speed);
  }
  b.metric('slide_hop_loop_peak', round(peak));
  releaseAll(b);
};

/**
 * Random hands on the keys for a long stretch: every key and a wandering view, re-rolled every few tenths of a
 * second. Catches what scripted bots cannot: NaN, falling through floors, wedging in geometry.
 */
export function stressBot(seconds: number, seed: number, respawn: (b: BotApi) => void, killY = -40): Bot {
  return function* (b) {
    const p = b.player;
    const rng = mulberry32(seed);
    respawn(b);
    yield;
    let t = 0;
    let nextRoll = 0;
    let turnRate = 0;
    let nan = 0;
    let falls = 0;
    let wedged = 0;
    let stillT = 0;
    let lastX = p.position.x;
    let lastY = p.position.y;
    let lastZ = p.position.z;
    let peak = 0;
    let insideFrames = 0;
    const states: Record<string, number> = {};
    const insideBy: Record<string, number> = {};
    const fellFrom: string[] = [];
    let groundX = 0;
    let groundY = 0;
    let groundZ = 0;
    while (t < seconds) {
      if (t >= nextRoll) {
        nextRoll = t + 0.15 + rng() * 1.2;
        b.input.simulate('forward', rng() < 0.85);
        b.input.simulate('back', rng() < 0.05);
        const strafe = rng();
        b.input.simulate('left', strafe < 0.3);
        b.input.simulate('right', strafe > 0.7);
        b.input.simulate('jump', rng() < 0.55);
        b.input.simulate('dash', rng() < 0.3);
        b.input.simulate('slide', rng() < 0.2);
        turnRate = (rng() - 0.5) * 7;
      }
      look(b, turnRate * b.frameDt(), (0.2 - p.pitch) * 0.1);
      yield;
      t += b.frameDt();

      const q = p.position;
      if (!Number.isFinite(q.x + q.y + q.z + p.velocity.x + p.velocity.y + p.velocity.z)) {
        nan++;
        respawn(b);
      }
      if (q.y < killY) {
        falls++;
        fellFrom.push(`${round(groundX, 0)},${round(groundY, 0)},${round(groundZ, 0)}`);
        respawn(b);
      }
      if (p.grounded) {
        groundX = q.x;
        groundY = q.y;
        groundZ = q.z;
      }
      peak = Math.max(peak, p.speed);
      states[p.state] = (states[p.state] ?? 0) + 1;
      if (p.isPenetrating()) {
        insideFrames++;
        b.metric('stress_inside_last', `${p.state} ${round(q.x)},${round(q.y)},${round(q.z)} v ${round(p.velocity.x)},${round(p.velocity.y)},${round(p.velocity.z)}`);
        insideBy[p.state] = (insideBy[p.state] ?? 0) + 1;
      }
      const moved = Math.hypot(q.x - lastX, q.y - lastY, q.z - lastZ);
      lastX = q.x;
      lastY = q.y;
      lastZ = q.z;
      stillT = moved < 0.002 ? stillT + b.frameDt() : 0;
      if (stillT > 3) {
        wedged++;
        b.metric('stress_wedged_at', `${round(q.x)},${round(q.y)},${round(q.z)} ${p.state}`);
        stillT = 0;
        respawn(b);
      }
    }
    releaseAll(b);
    b.metric('stress_seconds', seconds);
    b.metric('stress_nan', nan);
    b.metric('stress_falls', falls);
    b.metric('stress_fell_from', fellFrom.join(' '));
    b.metric('stress_wedged', wedged);
    b.metric('stress_inside_frames', insideFrames);
    b.metric('stress_inside_by_state', Object.entries(insideBy).map(([k, v]) => `${k}:${v}`).join(' '));
    b.metric('stress_peak_speed', round(peak));
    b.metric('stress_states', Object.entries(states).map(([k, v]) => `${k}:${v}`).join(' '));
  };
}

export const courseStressBot: Bot = stressBot(240, 7, b => {
  const lanes = Object.values(LANES);
  const lane = lanes[Math.floor(Math.random() * lanes.length)]!;
  b.input.consumeLook();
  b.player.teleport(v3(lane, 0.2, 0), 0);
});

export const healthBot: Bot = function* (b) {
  const p = b.player;
  yield* place(b, LANES.strafe, 0.1, 0);
  p.reset();
  yield* place(b, LANES.strafe, 0.1, 0);
  p.addArmor(30);
  p.takeDamage({ amount: 30, type: 'bullet', source: 'test' });
  b.metric('hp_after_30_with_armor', round(p.health));
  b.metric('armor_after_30', round(p.armor));
  yield* wait(b, 2.9);
  b.metric('hp_before_regen', round(p.health));
  yield* wait(b, 1.1);
  b.metric('hp_after_regen_1s', round(p.health));
  p.takeDamage({ amount: 500, type: 'true', source: 'test' });
  b.metric('alive_after_lethal', p.alive);
  yield* wait(b, 0.2);
  p.reset();
  b.metric('alive_after_reset', p.alive);
  b.metric('hp_after_reset', p.health);
};

/** Holds a key from a standing start until speed settles, for the planted-feet numbers below. */
function* runUp(b: BotApi, x: number, z: number, key: Action = 'forward', yaw = 0): BotStep {
  yield* place(b, x, 0.1, z, yaw);
  b.input.simulate(key, true);
  yield* wait(b, 0.5);
}

/** Runs until `done` and returns seconds, plus the metres travelled along (dirX, dirZ). */
function* track(b: BotApi, dirX: number, dirZ: number, done: () => boolean, out: { t: number; d: number }, maxSeconds = 2): BotStep {
  const p = b.player;
  out.t = 0;
  out.d = 0;
  let x = p.position.x;
  let z = p.position.z;
  while (!done() && out.t < maxSeconds) {
    yield;
    out.t += b.frameDt();
    out.d += (p.position.x - x) * dirX + (p.position.z - z) * dirZ;
    x = p.position.x;
    z = p.position.z;
  }
}

/** The numbers behind "planted": what the feet do when the keys change. Run it at a high frame rate for resolution. */
export const feelBot: Bot = function* (b) {
  const p = b.player;
  const run = MOVE.runSpeed;
  const m = { t: 0, d: 0 };

  yield* runUp(b, LANES.strafe, 0);
  b.input.simulate('forward', false);
  yield* track(b, 0, -1, () => p.speed < 0.05, m);
  b.metric('stop_time_s', round(m.t, 3));
  b.metric('stop_distance_m', round(m.d, 2));

  // W to S: how long the old direction lasts and when the new one is at speed.
  yield* runUp(b, LANES.strafe, 0);
  b.input.simulate('forward', false);
  b.input.simulate('back', true);
  yield* track(b, 0, -1, () => p.velocity.z >= 0, m);
  b.metric('reverse_overrun_m', round(m.d, 2));
  const brake = m.t;
  yield* track(b, 0, -1, () => p.velocity.z >= run * 0.98, m);
  b.metric('reverse_time_s', round(brake + m.t, 3));
  releaseAll(b);

  // A to D, the shoot-house dodge.
  yield* runUp(b, LANES.strafe, 0, 'left');
  b.input.simulate('left', false);
  b.input.simulate('right', true);
  yield* track(b, -1, 0, () => p.velocity.x >= 0, m);
  b.metric('strafe_flip_overrun_m', round(m.d, 2));
  const flip = m.t;
  yield* track(b, -1, 0, () => p.velocity.x >= run * 0.98, m);
  b.metric('strafe_flip_time_s', round(flip + m.t, 3));
  releaseAll(b);

  // 90 degree key change: drift is how far the body keeps going the old way.
  yield* runUp(b, LANES.strafe, 0);
  b.input.simulate('forward', false);
  b.input.simulate('right', true);
  yield* track(b, 0, -1, () => Math.abs(p.velocity.z) < 0.05, m);
  b.metric('turn90_keys_drift_m', round(m.d, 2));
  b.metric('turn90_keys_time_s', round(m.t, 3));
  releaseAll(b);

  // 90 degree mouse flick with W held.
  yield* runUp(b, LANES.strafe, 0);
  look(b, -Math.PI / 2);
  yield* track(b, 0, -1, () => Math.abs(p.velocity.z) < 0.05, m);
  b.metric('turn90_mouse_drift_m', round(m.d, 2));
  b.metric('turn90_mouse_time_s', round(m.t, 3));
  releaseAll(b);

  // Back on the ground at 28 m/s with W held and no hop.
  for (const held of [true, false]) {
    yield* place(b, LANES.strafe, 1.2, 0);
    b.input.simulate('forward', held);
    p.velocity.set(0, -5, -28);
    yield* waitUntil(b, () => p.grounded, 1);
    yield* track(b, 0, -1, () => p.speed <= (held ? run * 1.02 : 0.05), m);
    b.metric(held ? 'overspeed_28_recover_s' : 'overspeed_28_stop_s', round(m.t, 3));
    b.metric(held ? 'overspeed_28_recover_m' : 'overspeed_28_stop_m', round(m.d, 2));
    releaseAll(b);
  }

  // Landing a plain run-jump with no keys: how far the body skates.
  yield* runUp(b, LANES.strafe, 0);
  yield* tap(b, 'jump');
  b.input.simulate('forward', false);
  yield;
  yield* waitUntil(b, () => p.grounded, 2);
  yield* track(b, 0, -1, () => p.speed < 0.05, m);
  b.metric('land_no_keys_skate_m', round(m.d, 2));
  b.metric('land_no_keys_stop_s', round(m.t, 3));

  // Dash exit on the ground, W held: how long until the player is running again.
  yield* runUp(b, LANES.strafe, 0);
  yield* tap(b, 'dash');
  yield* waitUntil(b, () => p.dashing, 0.1);
  yield* waitUntil(b, () => !p.dashing, 0.5);
  const exit = p.speed;
  yield* track(b, 0, -1, () => p.speed <= run * 1.02, m);
  b.metric('dash_exit_speed', round(exit));
  b.metric('dash_recover_s', round(m.t, 3));
  releaseAll(b);

  // Dash with nothing held: distance from the press to a dead stop.
  yield* place(b, LANES.strafe, 0.1, 0);
  yield* waitUntil(b, () => p.grounded, 0.3);
  const z0 = p.position.z;
  yield* tap(b, 'dash');
  yield* waitUntil(b, () => p.dashing, 0.1);
  yield* waitUntil(b, () => !p.dashing, 0.5);
  yield* waitUntil(b, () => p.speed < 0.05, 2);
  b.metric('dash_total_m', round(z0 - p.position.z, 2));
};

/** Reads what the screen shows: camera roll through everything that may leave the crosshair tilted. */
export const rollBot: Bot = function* (b) {
  const p = b.player;
  const cam = b.ctx.render.camera;
  const deg = (r: number) => round((r * 180) / Math.PI, 3);
  yield* place(b, LANES.strafe, 0.1, 0);
  yield* wait(b, 0.5);
  b.metric('roll_rest', cam.rotation.z);

  for (const key of ['left', 'right'] as Action[]) {
    b.input.simulate(key, true);
    let peak = 0;
    yield* waitUntil(b, () => {
      peak = Math.abs(cam.rotation.z) > Math.abs(peak) ? cam.rotation.z : peak;
      return false;
    }, 1);
    b.input.simulate(key, false);
    b.metric(`roll_strafe_${key}_peak_deg`, deg(peak));
    yield* wait(b, 0.5);
    b.metric(`roll_after_strafe_${key}`, cam.rotation.z);
  }

  // Running flat out while the mouse sweeps: velocity lags the view, which is what fed the old lean.
  b.input.simulate('forward', true);
  let peak = 0;
  for (let t = 0; t < 1.5; t += b.frameDt()) {
    look(b, 3 * b.frameDt());
    yield;
    peak = Math.max(peak, Math.abs(cam.rotation.z));
  }
  b.input.simulate('forward', false);
  b.metric('roll_run_turn_peak_deg', deg(peak));
  yield* wait(b, 0.5);
  b.metric('roll_after_run_turn', cam.rotation.z);

  b.ctx.camera.kick(0.02, 0.01, 0.03);
  yield* wait(b, 1);
  b.metric('roll_after_kick', cam.rotation.z);
  b.ctx.camera.addTrauma(1);
  yield* wait(b, 1);
  b.metric('roll_after_shake', cam.rotation.z);

  // Slide, then stand.
  b.input.simulate('forward', true);
  yield* wait(b, 0.4);
  b.input.simulate('right', true);
  b.input.simulate('slide', true);
  yield* waitUntil(b, () => p.sliding, 0.1);
  let slidePeak = 0;
  yield* waitUntil(b, () => {
    slidePeak = Math.max(slidePeak, Math.abs(cam.rotation.z));
    return !p.sliding;
  }, 5);
  releaseAll(b);
  b.metric('roll_slide_peak_deg', deg(slidePeak));
  yield* wait(b, 1);
  b.metric('roll_after_slide', cam.rotation.z);

  // Wall run, then land.
  yield* place(b, LANES.wall + 2.5, 0.1, -30, 0);
  b.input.simulate('forward', true);
  yield* wait(b, 0.2);
  look(b, -0.3);
  yield* wait(b, 0.1);
  yield* tap(b, 'jump');
  let wallPeak = 0;
  yield* waitUntil(b, () => p.wallRunning, 1.5);
  yield* waitUntil(b, () => {
    wallPeak = Math.max(wallPeak, Math.abs(cam.rotation.z));
    return !p.wallRunning;
  }, 4);
  releaseAll(b);
  look(b, 0.3);
  yield* waitUntil(b, () => p.grounded, 2);
  b.metric('roll_wall_peak_deg', deg(wallPeak));
  yield* wait(b, 1);
  b.metric('roll_after_wall', cam.rotation.z);
};

/** What must not happen by accident, and what must still happen on purpose. */
export const intentBot: Bot = function* (b) {
  const p = b.player;
  const { events } = b.ctx;
  let wallRuns = 0;
  let kicks = 0;
  let doubles = 0;
  let mantles = 0;
  let jumps = 0;
  const offs = [
    events.on('player:wallrun', e => { if (e.active) wallRuns++; }),
    events.on('player:mantle', () => { mantles++; }),
    events.on('player:jumped', e => {
      if (e.wall) kicks++;
      else if (e.double) doubles++;
      else jumps++;
    }),
  ];
  const clear = () => { wallRuns = kicks = doubles = mantles = jumps = 0; };
  const wx = LANES.wall - 4.5;

  // Hug a wall with W, jump, keep W held. The view stays parallel.
  yield* runUp(b, wx + 0.6, -20);
  clear();
  yield* tap(b, 'jump');
  yield* wait(b, 0.8);
  b.metric('hug_jump_wallruns', wallRuns);
  releaseAll(b);

  // The same with nothing but a strafe key pushing into it.
  yield* runUp(b, wx + 1.5, -20);
  b.input.simulate('forward', false);
  b.input.simulate('left', true);
  clear();
  yield* tap(b, 'jump');
  yield* wait(b, 0.8);
  b.metric('strafe_into_wallruns', wallRuns);
  releaseAll(b);

  // Drifting into a wall with the view parallel to it: the body touches, the player never asked.
  yield* runUp(b, wx + 1, -20);
  look(b, 0.14);
  yield* wait(b, 0.1);
  clear();
  yield* tap(b, 'jump');
  look(b, -0.14);
  yield* wait(b, 0.8);
  b.metric('view_parallel_wallruns', wallRuns);
  releaseAll(b);

  // On purpose: hugging the wall with W and the strafe key into it, then jumping.
  yield* runUp(b, wx + 0.6, -20);
  b.input.simulate('left', true);
  yield* wait(b, 0.1);
  clear();
  yield* tap(b, 'jump');
  yield* wait(b, 0.4);
  b.metric('steer_jump_wallruns', wallRuns);
  releaseAll(b);

  // On purpose: running at a shallow angle, then jumping into it.
  yield* place(b, wx + 2, 0.1, -20, 0.3);
  b.input.simulate('forward', true);
  yield* wait(b, 0.25);
  clear();
  yield* tap(b, 'jump');
  yield* wait(b, 0.7);
  b.metric('angled_jump_wallruns', wallRuns);
  releaseAll(b);

  // Door jambs: jump past a post and clip it with the shoulder, turned slightly into it.
  const jamb = LANES.brush - 2;
  yield* runUp(b, jamb + 0.7, 8);
  yield* waitUntil(b, () => p.position.z < -15, 2);
  clear();
  yield* tap(b, 'jump');
  look(b, 0.12);
  yield* wait(b, 0.8);
  b.metric('door_jamb_wallruns', wallRuns);
  releaseAll(b);

  // Run straight at a 1.2 m crate with W held and no jump.
  const crate = LANES.brush + 12;
  yield* place(b, crate, 0.1, -10);
  b.input.simulate('forward', true);
  clear();
  yield* wait(b, 1.8);
  b.metric('crate_no_jump_mantles', mantles);
  b.metric('crate_no_jump_y', round(p.position.y));
  releaseAll(b);

  // Walking past it, strafing into its end.
  yield* place(b, crate + 7, 0.1, -30, -Math.PI / 2);
  b.input.simulate('forward', false);
  b.input.simulate('right', true);
  clear();
  yield* wait(b, 1);
  b.metric('crate_strafe_mantles', mantles);
  releaseAll(b);

  // On purpose: jump at a 2.4 m block with W held. It climbs, and the climb takes visible time.
  const block = -14 - 26 * 4;
  yield* place(b, LANES.mantle, 0.1, block + 12);
  b.input.simulate('forward', true);
  yield* waitUntil(b, () => p.position.z < block + 3, 2);
  clear();
  yield* tap(b, 'jump');
  yield* waitUntil(b, () => p.mantling, 1);
  let climb = 0;
  let peakVy = 0;
  const startY = p.position.y;
  while (p.mantling && climb < 1) {
    peakVy = Math.max(peakVy, p.velocity.y);
    yield;
    climb += b.frameDt();
  }
  b.metric('ledge_jump_mantles', mantles);
  b.metric('ledge_jump_rise_m', round(p.position.y - startY));
  b.metric('ledge_jump_climb_s', round(climb, 3));
  b.metric('ledge_jump_vy', round(peakVy));
  releaseAll(b);

  // A double jump close to a wall stays a double jump.
  yield* runUp(b, wx + 1.1, -20);
  clear();
  yield* tap(b, 'jump');
  yield* wait(b, 0.25);
  yield* tap(b, 'jump');
  yield* wait(b, 0.1);
  b.metric('corridor_double_jumps', doubles);
  b.metric('corridor_wall_kicks', kicks);
  releaseAll(b);

  // Holding Space does one jump.
  yield* runUp(b, LANES.strafe, 0);
  clear();
  b.input.simulate('jump', true);
  yield* wait(b, 3);
  b.metric('space_held_3s_jumps', jumps);
  releaseAll(b);

  // Crouch held from the ground through a jump: landing fast must not start a slide nobody pressed for.
  yield* place(b, LANES.strafe, 0.1, 0);
  let slides = 0;
  const off = events.on('player:slide', e => { if (e.active) slides++; });
  b.input.simulate('slide', true);
  yield* wait(b, 0.1);
  yield* tap(b, 'jump');
  yield* wait(b, 0.05);
  p.velocity.x = 0;
  p.velocity.z = -14;
  yield* waitUntil(b, () => p.grounded, 1);
  yield* wait(b, 0.3);
  b.metric('held_crouch_landing_slides', slides);
  releaseAll(b);
  off();

  // Pressed in the air, too low to slam: that one was asked for.
  yield* runUp(b, LANES.strafe, 0);
  slides = 0;
  const on = events.on('player:slide', e => { if (e.active) slides++; });
  yield* tap(b, 'jump');
  yield* waitUntil(b, () => p.velocity.y < 0 && p.position.y < 1, 1);
  b.input.simulate('slide', true);
  yield* waitUntil(b, () => p.grounded, 1);
  yield* wait(b, 0.1);
  b.metric('air_press_landing_slides', slides);
  releaseAll(b);
  on();
  for (const o of offs) o();
};

/** Metres per second actually covered over `seconds`, next to what player.speed claimed on average. */
function* realSpeed(b: BotApi, seconds: number, out: { real: number; reported: number }): BotStep {
  const p = b.player;
  const x = p.position.x;
  const z = p.position.z;
  let t = 0;
  let reported = 0;
  let frames = 0;
  while (t < seconds) {
    yield;
    t += b.frameDt();
    reported += p.speed;
    frames++;
  }
  out.real = Math.hypot(p.position.x - x, p.position.z - z) / t;
  out.reported = reported / frames;
}

/** Running with the view leaned into a wall: the feet should cover run speed times cos(lean), and say so. */
export const wallSlideBot: Bot = function* (b) {
  const p = b.player;
  const face = LANES.wall - 4.5;
  const m = { real: 0, reported: 0 };
  for (const lean of [1, 3, 6, 10, 15, 20, 30, 45, 60, 75]) {
    const rad = (lean * Math.PI) / 180;
    yield* place(b, face + MOVE.radius + 0.02, 0.1, -20, rad);
    b.input.simulate('forward', true);
    yield* wait(b, 0.5);
    yield* realSpeed(b, 0.5, m);
    b.metric(`lean_${lean}_real`, round(m.real));
    b.metric(`lean_${lean}_reported`, round(m.reported));
    b.metric(`lean_${lean}_ideal`, round(MOVE.runSpeed * Math.cos(rad)));
    releaseAll(b);
  }

  // Head-on, and into an inside corner: nothing moves, so nothing may claim to.
  yield* place(b, face + MOVE.radius + 0.5, 0.1, -20, Math.PI / 2);
  b.input.simulate('forward', true);
  yield* wait(b, 0.4);
  yield* realSpeed(b, 0.5, m);
  b.metric('head_on_real', round(m.real));
  b.metric('head_on_reported', round(m.reported));
  releaseAll(b);
  yield* place(b, LANES.corner - 3, 0.1, -70, 0.6);
  b.input.simulate('forward', true);
  yield* wait(b, 1.5);
  yield* realSpeed(b, 0.5, m);
  b.metric('corner_real', round(m.real));
  b.metric('corner_reported', round(m.reported));
  releaseAll(b);

  // Off the end of a wall: the lean carries on the moment nothing is in the way.
  const post = LANES.brush - 12;
  yield* place(b, post + 0.25 + MOVE.radius + 0.02, 0.1, -100, 0.5);
  b.input.simulate('forward', true);
  yield* waitUntil(b, () => p.position.z < -121, 3);
  yield* wait(b, 0.25);
  b.metric('wall_end_speed', round(p.speed));
  releaseAll(b);
};

export const BOTS: Record<string, Bot> = {
  feel: feelBot,
  wallslide: wallSlideBot,
  roll: rollBot,
  intent: intentBot,
  ground: groundBot,
  jump: jumpBot,
  bhop: bhopBot,
  strafe: strafeBot,
  sweep: sweepBot,
  side: sideStrafeBot,
  dash: dashBot,
  slide: slideBot,
  slam: slamBot,
  wall: wallBot,
  chain: chainBot,
  mantle: mantleBot,
  stairs: stairsBot,
  ramp: rampBot,
  curbs: curbBot,
  edge: edgeBot,
  reach: reachBot,
  exploit: exploitBot,
  stress: courseStressBot,
  health: healthBot,
};
