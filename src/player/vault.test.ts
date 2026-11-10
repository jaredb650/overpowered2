/**
 * The vault, the end of a mantle, and what the body layer does to the view while they play. Real controller, real Rapier,
 * on a small course built for the purpose: cover of three kinds down one line, each far enough from the last to be alone.
 */
import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Physics } from '../physics/Physics';
import { createHeadlessGame, type HeadlessGame } from './testkit/headless';
import { ANIM } from './moveAnim';
import { MOVE, VIEW } from './tuning';

/** Lanes along +X, each running down -Z from z = 0 to its obstacle at z = -20. */
const LANE = { cover: 0, crate: 20, platform: 40, tall: 60, pit: 80, ledge: 100, thin: 120, low: 140, drop: 160, short: 180 } as const;
/** Top of the deck in the drop lane. */
const DECK = 1.4;
const FRONT = -20;

function build(physics: Physics): void {
  const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number) =>
    physics.addStaticBox(new THREE.Vector3(x, y, z), new THREE.Vector3(hx, hy, hz), null, 'concrete');
  box(70, -0.5, -20, 120, 0.5, 60);
  // 1.1 m high and 0.5 m deep: the range's cover wall.
  box(LANE.cover, 0.55, FRONT - 0.25, 4, 0.55, 0.25);
  // 1.2 m high and 2 m deep: the crate from the brush lane.
  box(LANE.crate, 0.6, FRONT - 1, 4, 0.6, 1);
  // The same height and 8 m deep: a platform.
  box(LANE.platform, 0.6, FRONT - 4, 4, 0.6, 4);
  // 2.4 m high: a wall.
  box(LANE.tall, 1.2, FRONT - 0.25, 4, 1.2, 0.25);
  // Cover with something standing right behind it.
  box(LANE.pit, 0.55, FRONT - 0.25, 4, 0.55, 0.25);
  box(LANE.pit, 2, FRONT - 1.2, 4, 2, 0.25);
  // A 2 m ledge to climb.
  box(LANE.ledge, 1, FRONT - 4, 4, 1, 4);
  // A 2 m wall only 12 cm thick, with open floor behind.
  box(LANE.thin, 1, FRONT - 0.06, 4, 1, 0.06);
  // Cover under a 2.3 m ceiling.
  box(LANE.low, 0.55, FRONT - 0.25, 4, 0.55, 0.25);
  box(LANE.low, 2.8, FRONT, 4, 0.5, 6);
  // A deck with cover along its far edge: the far side of the cover is the floor, 1.4 m lower.
  box(LANE.drop, DECK / 2, FRONT + 7, 4, DECK / 2, 7);
  box(LANE.drop, DECK + 0.55, FRONT + 0.25, 4, 0.55, 0.25);
  // Cover with a wall 1.5 m behind it: room to come down, but not for a fifth of a second of running.
  box(LANE.short, 0.55, FRONT - 0.25, 4, 0.55, 0.25);
  box(LANE.short, 2, FRONT - 2.25, 4, 2, 0.25);
}

let game: HeadlessGame;
const seen = { vaults: 0, jumps: 0, doubles: 0, mantles: 0, landings: [] as number[] };
/** Every sound the body asks for. The headless game's audio is a stand-in, so the test puts this in its place. */
const heard: string[] = [];

beforeAll(async () => {
  game = await createHeadlessGame(build);
  game.ctx.events.on('player:vault', () => { seen.vaults++; });
  game.ctx.events.on('player:mantle', () => { seen.mantles++; });
  game.ctx.events.on('player:jumped', e => {
    seen.jumps++;
    if (e.double) seen.doubles++;
  });
  const silent = game.ctx.audio;
  game.ctx.audio = new Proxy(silent, {
    get: (target, key) => (key === 'play' ? (id: string) => { heard.push(id); } : Reflect.get(target, key)),
  });
  game.ctx.events.on('player:landed', e => { seen.landings.push(e.impact); });
});

afterEach(() => {
  MOVE.mantleCarry = 0;
  MOVE.vault = true;
  MOVE.vaultAuto = false;
  MOVE.mantleTopJump = 0.1;
  ANIM.enabled = true;
  ANIM.camera = 1;
});

const FPS = 120;
const step = (n = 1) => { for (let i = 0; i < n; i++) game.frame(1 / FPS); };

function place(x: number, z: number, y = 0): void {
  for (const a of ['forward', 'back', 'left', 'right', 'jump', 'dash', 'slide'] as const) game.input.simulate(a, false);
  game.input.consumeLook();
  game.player.reset();
  game.player.teleport(new THREE.Vector3(x, y + 0.05, z), 0);
  step(6);
  seen.vaults = seen.jumps = seen.doubles = seen.mantles = 0;
  seen.landings.length = 0;
  heard.length = 0;
}

/** Runs down the lane with W held and returns when the body centre is `gap` metres from the obstacle's face. */
function runTo(x: number, gap: number, from = 12, y = 0): void {
  place(x, FRONT + from, y);
  game.input.simulate('forward', true);
  for (let i = 0; i < FPS * 4 && game.player.position.z > FRONT + gap; i++) step();
}

function tapJump(): void {
  game.input.simulate('jump', true);
  step();
  game.input.simulate('jump', false);
}

/**
 * Presses jump and follows the vault to its end, measuring the ground the body really covers. `player.speed` cannot say:
 * the vault holds velocity at the entry speed whatever the path does.
 */
function vaultThrough(): { seconds: number; metres: number; slowest: number } {
  const p = game.player;
  const z0 = p.position.z;
  tapJump();
  let frames = 1;
  let last = p.position.z;
  let slowest = (z0 - last) * FPS;
  while (p.vaulting && frames < FPS * 2) {
    step();
    frames++;
    slowest = Math.min(slowest, (last - p.position.z) * FPS);
    last = p.position.z;
  }
  return { seconds: frames / FPS, metres: z0 - last, slowest };
}

interface Trace { minSpeed: number; maxY: number; maxEyeStep: number; maxRoll: number; maxPitchOff: number; maxYawOff: number; frames: number; }

/** Steps until `done`, recording what a player would feel. */
function trace(done: () => boolean, maxSeconds = 2): Trace {
  const p = game.player;
  const cam = game.ctx.render.camera;
  const t: Trace = { minSpeed: Infinity, maxY: -Infinity, maxEyeStep: 0, maxRoll: 0, maxPitchOff: 0, maxYawOff: 0, frames: 0 };
  let eye = p.eye.y;
  for (let i = 0; i < FPS * maxSeconds && !done(); i++) {
    step();
    t.frames++;
    t.minSpeed = Math.min(t.minSpeed, p.speed);
    t.maxY = Math.max(t.maxY, p.position.y);
    t.maxEyeStep = Math.max(t.maxEyeStep, Math.abs(p.eye.y - eye));
    eye = p.eye.y;
    t.maxRoll = Math.max(t.maxRoll, Math.abs(cam.rotation.z));
    t.maxPitchOff = Math.max(t.maxPitchOff, Math.abs(cam.rotation.x - p.pitch));
    t.maxYawOff = Math.max(t.maxYawOff, Math.abs(cam.rotation.y - p.yaw));
  }
  return t;
}

describe('vault', () => {
  it('carries a running player over waist-high cover on a jump press, without losing speed', () => {
    const p = game.player;
    runTo(LANE.cover, 1.4);
    const entry = p.speed;
    tapJump();
    expect(p.vaulting).toBe(true);
    expect(p.state).toBe('vault');
    const t = trace(() => !p.vaulting);
    expect(seen.vaults).toBe(1);
    expect(seen.jumps).toBe(0);
    // Past the cover, on the floor, still running.
    expect(p.position.z).toBeLessThan(FRONT - 0.5 - MOVE.radius);
    expect(t.minSpeed).toBeGreaterThanOrEqual(entry - 0.01);
    expect(t.maxY).toBeLessThan(1.1 + MOVE.vaultClear + 0.05);
    step(4);
    expect(p.grounded).toBe(true);
    expect(p.isPenetrating()).toBe(false);
    step(30);
    expect(p.speed).toBeGreaterThan(MOVE.runSpeed - 0.3);
    expect(p.crouched).toBe(false);
    // The landing is part of the move: no thud, no stumble.
    expect(Math.max(0, ...seen.landings)).toBeLessThan(2);
  });

  it('covers ground at the speed it arrived with, in every frame, wherever the jump is pressed', () => {
    const p = game.player;
    for (const gap of [0.6, 0.8, 1, 1.4, 1.8]) {
      runTo(LANE.cover, gap);
      const entry = p.speed;
      const v = vaultThrough();
      expect(seen.vaults, `gap ${gap}`).toBe(1);
      expect(v.metres / v.seconds, `gap ${gap}`).toBeGreaterThan(entry - 0.02);
      expect(v.slowest, `gap ${gap}`).toBeGreaterThan(entry - 0.02);
      // The hand has its fifth of a second: the path is made longer for it, the body never slower.
      expect(v.seconds, `gap ${gap}`).toBeGreaterThanOrEqual(MOVE.vaultMinTime - 1e-9);
      expect(p.position.z).toBeLessThan(FRONT - 0.5 - MOVE.radius);
    }
    // And with a speed pickup, where a fixed fifth of a second used to cost more than half the speed.
    place(LANE.cover, FRONT + 20);
    p.modifiers.speed = 1.6;
    game.input.simulate('forward', true);
    for (let i = 0; i < FPS * 4 && p.position.z > FRONT + 1; i++) step();
    const entry = p.speed;
    expect(entry).toBeGreaterThan(19);
    const v = vaultThrough();
    expect(seen.vaults).toBe(1);
    expect(v.metres / v.seconds).toBeGreaterThan(entry - 0.02);
    expect(v.slowest).toBeGreaterThan(entry - 0.02);
  });

  it('goes over a 2 m deep crate at the speed of running the same ground', () => {
    const p = game.player;
    runTo(LANE.crate, 1.2);
    const entry = p.speed;
    const v = vaultThrough();
    expect(seen.vaults).toBe(1);
    expect(v.metres / v.seconds).toBeGreaterThan(entry - 0.02);
    expect(p.position.z).toBeLessThan(FRONT - 2 - MOVE.radius);
  });

  it('is a shorter vault, not a slower one, where the far side has no room for a long one', () => {
    const p = game.player;
    runTo(LANE.short, 0.6);
    const entry = p.speed;
    const v = vaultThrough();
    expect(seen.vaults).toBe(1);
    expect(v.seconds).toBeLessThan(MOVE.vaultMinTime - 0.02);
    expect(v.metres / v.seconds).toBeGreaterThan(entry - 0.02);
    expect(v.slowest).toBeGreaterThan(entry - 0.02);
    step(4);
    expect(p.isPenetrating()).toBe(false);
    expect(p.position.z).toBeLessThan(FRONT - 0.5 - MOVE.radius);
    expect(p.position.z).toBeGreaterThan(FRONT - 2 + MOVE.radius);
  });

  it('keeps a jump pressed on the way over for the far side: a jump off the ground, with the double jump still to come', () => {
    const p = game.player;
    for (const at of [3, 10, 18]) {
      runTo(LANE.cover, 1.4);
      tapJump();
      step(at);
      expect(p.vaulting, `press ${at}`).toBe(true);
      tapJump();
      trace(() => !p.vaulting);
      // Nothing fired inside the vault, and what fires after it is not the air jump.
      step(3);
      expect(seen.jumps, `press ${at}`).toBe(1);
      expect(seen.doubles, `press ${at}`).toBe(0);
      expect(p.velocity.y).toBeGreaterThan(MOVE.jumpSpeed - 1.5);
      step(20);
      tapJump();
      step(2);
      expect(seen.doubles, `press ${at}`).toBe(1);
    }
    // No second press, no jump.
    runTo(LANE.cover, 1.4);
    tapJump();
    trace(() => !p.vaulting);
    step(30);
    expect(seen.jumps).toBe(0);
    expect(p.grounded).toBe(true);
  });

  it('leaves the fall to the player where the far side is lower: the head crosses level and nothing snaps it down', () => {
    const p = game.player;
    runTo(LANE.drop, 0.5 + 1.2, 10, DECK);
    expect(p.grounded).toBe(true);
    const eye0 = p.eye.y;
    tapJump();
    expect(p.vaulting).toBe(true);
    const t = trace(() => !p.vaulting);
    expect(t.maxEyeStep).toBeLessThan(0.06);
    // Off the path level with the deck it left, past the cover, in the air.
    expect(Math.abs(p.eye.y - eye0)).toBeLessThan(0.05);
    expect(p.position.z).toBeLessThan(FRONT - MOVE.radius);
    expect(p.grounded).toBe(false);
    expect(seen.landings.length).toBe(0);
    // Then an ordinary fall and an ordinary landing. 1.4 m is 9.5 m/s, 8 cm in a 120 Hz frame.
    const fall = trace(() => p.grounded, 1);
    expect(fall.maxEyeStep).toBeLessThan(0.09);
    expect(p.position.y).toBeLessThan(0.1);
    expect(Math.max(0, ...seen.landings)).toBeGreaterThan(8);
    expect(p.isPenetrating()).toBe(false);
  });

  it('keeps the head nearly level: the eye never jumps, and rises far less than the feet', () => {
    const p = game.player;
    runTo(LANE.cover, 1.4);
    const eye0 = p.eye.y;
    tapJump();
    let top = 0;
    const t = trace(() => {
      top = Math.max(top, p.eye.y - eye0);
      return !p.vaulting;
    });
    // 6 cm in a 120 Hz frame is 7 m/s, the rise speed of a mantle.
    expect(t.maxEyeStep).toBeLessThan(0.06);
    expect(top).toBeLessThan(0.45);
    const after = trace(() => false, 0.5);
    expect(after.maxEyeStep).toBeLessThan(0.06);
  });

  it('leaves a jump a jump everywhere else', () => {
    const p = game.player;
    // Too far out.
    runTo(LANE.cover, MOVE.vaultReach + 1);
    tapJump();
    expect(p.vaulting).toBe(false);
    expect(seen.jumps).toBe(1);
    // A platform is for landing on.
    runTo(LANE.platform, 1.2);
    tapJump();
    expect(p.vaulting).toBe(false);
    expect(seen.jumps).toBe(1);
    // A wall is a wall.
    runTo(LANE.tall, 1.2);
    tapJump();
    expect(p.vaulting).toBe(false);
    // Nowhere to land.
    runTo(LANE.pit, 1.2);
    tapJump();
    expect(p.vaulting).toBe(false);
    // Walking up to cover and hopping.
    place(LANE.cover, FRONT + 1.2);
    tapJump();
    expect(p.vaulting).toBe(false);
    expect(seen.jumps).toBe(1);
    // Switched off.
    MOVE.vault = false;
    runTo(LANE.cover, 1.4);
    tapJump();
    expect(p.vaulting).toBe(false);
    expect(seen.jumps).toBe(1);
  });

  it('never vaults without a key unless asked to, and then only from a run', () => {
    const p = game.player;
    runTo(LANE.cover, 0.2, 12);
    step(60);
    expect(seen.vaults).toBe(0);
    expect(p.position.z).toBeGreaterThan(FRONT);

    MOVE.vaultAuto = true;
    place(LANE.cover, FRONT + 12);
    game.input.simulate('forward', true);
    trace(() => p.position.z < FRONT - 3, 3);
    expect(seen.vaults).toBe(1);
    expect(p.position.z).toBeLessThan(FRONT - 3);
    // Crouch-walking into it is not a run.
    place(LANE.cover, FRONT + 4);
    game.input.simulate('slide', true);
    game.input.simulate('forward', true);
    step(FPS * 2);
    expect(seen.vaults).toBe(0);
    expect(p.position.z).toBeGreaterThan(FRONT);
  });

  it('vaults under a low ceiling, tucked', () => {
    const p = game.player;
    runTo(LANE.low, 1.4);
    tapJump();
    expect(p.vaulting).toBe(true);
    trace(() => !p.vaulting);
    step(4);
    expect(p.isPenetrating()).toBe(false);
    expect(p.position.z).toBeLessThan(FRONT - 0.5 - MOVE.radius);
  });

  it('gives the body back cleanly when something throws the player mid-vault', () => {
    const p = game.player;
    runTo(LANE.crate, 1.2);
    tapJump();
    step(8);
    expect(p.vaulting).toBe(true);
    p.launch(new THREE.Vector3(0, 12, 0));
    expect(p.vaulting).toBe(false);
    step(10);
    expect(p.isPenetrating()).toBe(false);
    expect(p.velocity.y).toBeGreaterThan(5);
  });
});

describe('mantle', () => {
  it('ends standing on the ledge, not beside it, when the carry is asked for', () => {
    const p = game.player;
    MOVE.mantleCarry = MOVE.radius + 0.12;
    runTo(LANE.ledge, 2.5);
    tapJump();
    trace(() => p.mantling, 1);
    expect(p.mantling).toBe(true);
    const t = trace(() => !p.mantling, 1);
    expect(seen.mantles).toBe(1);
    // Over the lip by the time the climb ends, and standing within two ticks.
    expect(p.position.z).toBeLessThan(FRONT - 0.05);
    expect(p.position.y).toBeGreaterThan(1.99);
    step(2);
    expect(p.grounded).toBe(true);
    expect(t.maxEyeStep).toBeLessThan(0.1);
    // No drop and bump at the top.
    const after = trace(() => false, 0.3);
    expect(after.maxEyeStep).toBeLessThan(0.02);
    expect(p.speed).toBeGreaterThan(MOVE.mantleExitSpeed - 0.5);
  });

  it('leaves the body where it always has by default: beside the ledge, on it a few ticks later', () => {
    const p = game.player;
    runTo(LANE.ledge, 2.5);
    tapJump();
    trace(() => p.mantling, 1);
    trace(() => !p.mantling, 1);
    expect(p.position.z).toBeGreaterThan(FRONT + MOVE.radius - 0.01);
    step(12);
    expect(p.grounded).toBe(true);
    expect(p.position.z).toBeLessThan(FRONT);
  });

  it('makes a jump pressed during the climb a jump off the top, and keeps the double jump', () => {
    const p = game.player;
    const climb = (at: number) => {
      runTo(LANE.ledge, 2.5);
      tapJump();
      trace(() => p.mantling, 1);
      expect(p.mantling).toBe(true);
      seen.jumps = seen.doubles = 0;
      step(at);
      tapJump();
      trace(() => !p.mantling, 1);
      step(4);
    };
    for (const at of [2, 12]) {
      climb(at);
      expect(seen.jumps, `press ${at}`).toBe(1);
      expect(seen.doubles, `press ${at}`).toBe(0);
      step(30);
      tapJump();
      step(2);
      expect(seen.doubles, `press ${at}`).toBe(1);
    }
    // Switched off, it is the old top: the press spends the double jump the moment the climb ends.
    MOVE.mantleTopJump = 0;
    climb(12);
    expect(seen.doubles).toBe(1);
  });

  it('gets a hand on the top of a thin wall', () => {
    const p = game.player;
    runTo(LANE.thin, 2.5);
    tapJump();
    trace(() => p.mantling, 1);
    expect(seen.mantles).toBe(1);
  });
});

describe('the body layer on the real player', () => {
  it('adds no pitch or yaw to the view through a vault and a mantle, and only modest roll', () => {
    const p = game.player;
    let worst = { maxPitchOff: 0, maxYawOff: 0, maxRoll: 0 };
    const fold = (t: Trace) => {
      worst = {
        maxPitchOff: Math.max(worst.maxPitchOff, t.maxPitchOff), maxYawOff: Math.max(worst.maxYawOff, t.maxYawOff), maxRoll: Math.max(worst.maxRoll, t.maxRoll),
      };
    };
    runTo(LANE.cover, 1.4);
    tapJump();
    fold(trace(() => !p.vaulting));
    runTo(LANE.ledge, 2.5);
    tapJump();
    trace(() => p.mantling, 1);
    fold(trace(() => !p.mantling, 1));
    fold(trace(() => false, 0.4));
    // What is left is the camera rig's own landing nod for stepping onto the ledge, a twentieth of a degree.
    expect(worst.maxPitchOff).toBeLessThan(VIEW.landNod);
    expect(worst.maxYawOff).toBe(0);
    expect(worst.maxRoll).toBeGreaterThan(0.02);
    expect(worst.maxRoll).toBeLessThanOrEqual(ANIM.maxRoll + 1e-9);
  });

  it('returns the view to exactly level, and the layer to rest, a second after any of it', () => {
    const p = game.player;
    const cam = game.ctx.render.camera;
    runTo(LANE.cover, 1.4);
    tapJump();
    trace(() => !p.vaulting);
    game.input.simulate('forward', false);
    step(FPS * 1.2);
    expect(cam.rotation.z).toBe(0);
    expect(p.moveAnim.idle).toBe(true);

    runTo(LANE.ledge, 2.5);
    tapJump();
    trace(() => p.mantling, 1);
    trace(() => !p.mantling, 1);
    game.input.simulate('forward', false);
    step(FPS * 1.2);
    expect(cam.rotation.z).toBe(0);
    expect(p.moveAnim.idle).toBe(true);
  });

  it('is cleared by a seat, so nothing of a move is left to play when the player is handed back', () => {
    const p = game.player;
    runTo(LANE.crate, 6, 20);
    game.input.simulate('slide', true);
    step(20);
    expect(p.sliding).toBe(true);
    expect(p.moveAnim.legsW).toBeGreaterThan(0.5);
    p.park(p.position.clone());
    expect(p.moveAnim.idle).toBe(true);
    game.input.simulate('slide', false);
    game.input.simulate('forward', false);
    step(FPS);
    p.unpark(0);
    let shown = 0;
    for (let i = 0; i < FPS; i++) {
      step();
      if (!p.moveAnim.idle) shown++;
    }
    expect(shown).toBe(0);
  });

  it('plays its hands and boots only while it is on', () => {
    const p = game.player;
    const body = () => heard.filter(id => id === 'hand_plant' || id === 'boot_scuff' || id === 'gear_rustle');
    runTo(LANE.ledge, 2.5);
    tapJump();
    trace(() => p.mantling, 1);
    trace(() => !p.mantling, 1);
    step(4);
    expect(body()).toEqual(['hand_plant', 'boot_scuff']);

    ANIM.enabled = false;
    runTo(LANE.ledge, 2.5);
    tapJump();
    trace(() => p.mantling, 1);
    trace(() => !p.mantling, 1);
    step(4);
    expect(seen.mantles).toBe(1);
    expect(body()).toEqual([]);
    // The vault keeps its own sound: it is a move with its own switch.
    runTo(LANE.cover, 1.4);
    tapJump();
    trace(() => !p.vaulting);
    step(4);
    expect(body()).toEqual([]);
  });

  it('is gone with the switch off, and the camera part alone with its own', () => {
    const p = game.player;
    const cam = game.ctx.render.camera;
    ANIM.camera = 0;
    runTo(LANE.cover, 1.4);
    tapJump();
    let hand = 0;
    const t = trace(() => {
      hand = Math.max(hand, p.moveAnim.handW);
      return !p.vaulting;
    });
    expect(t.maxRoll).toBe(0);
    expect(hand).toBeGreaterThan(0.8);

    ANIM.enabled = false;
    runTo(LANE.cover, 1.4);
    tapJump();
    expect(p.vaulting).toBe(true);
    hand = 0;
    trace(() => {
      hand = Math.max(hand, p.moveAnim.handW);
      return !p.vaulting;
    });
    expect(hand).toBe(0);
    expect(cam.rotation.z).toBe(0);
    expect(p.moveAnim.idle).toBe(true);
  });
});
