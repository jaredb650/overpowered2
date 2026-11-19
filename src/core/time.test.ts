import { describe, expect, it, vi } from 'vitest';
import { GameTime, HOST_FRAME, HOST_STEP, HOST_STEPS, MAX_STEP } from './time';

/** Runs `seconds` of real time at `fps`, the way Game.run does: split the frame, tick each step. Returns the world steps taken. */
function play(time: GameTime, fps: number, seconds: number, frameMs = 4): number {
  let steps = 0;
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    const n = time.split(1 / fps, frameMs);
    for (let s = 0; s < n; s++) { time.tick(1 / fps / n); steps++; }
  }
  return steps;
}

describe('the game clock', () => {
  it('single player: slow-mo slows the world and never the player; hit-stop slows both', () => {
    const time = new GameTime();
    time.pushScale('slowmo', 0.25, 0, 0);
    time.tick(1 / 60);
    expect(time.dt).toBeCloseTo(0.25 / 60, 8);
    expect(time.playerDt).toBeCloseTo(1 / 60, 8);
    expect(time.slowmo).toBe(0.25);
    time.popScale('slowmo');
    time.tick(1 / 60);
    expect(time.slowmo).toBe(1);
    time.hitStop(0.1, 0.04);
    time.tick(1 / 60);
    expect(time.dt).toBeCloseTo(0.04 / 60, 8);
    expect(time.playerDt).toBeCloseTo(0.04 / 60, 8);
  });

  it('single player below 20 fps is unchanged: one step a frame, clamped, so the world runs slow', () => {
    const time = new GameTime();
    expect(time.split(0.1, 4)).toBe(1);
    expect(time.split(1, 4)).toBe(1);
    expect(play(time, 10, 10)).toBe(100);
    expect(time.elapsed).toBeCloseTo(100 * MAX_STEP, 6);
    expect(time.playerElapsed).toBeCloseTo(5, 6);
  });

  it('co-op: the game\'s own requests go to the gate, and only `share` reaches the clock', () => {
    const time = new GameTime();
    const gate = { push: vi.fn(), pop: vi.fn() };
    time.gate = gate;
    time.pushScale('focus', 0.35, 0.12, 0.25);
    time.hitStop(0.2, 0.02);
    time.tick(0.05);
    expect(gate.push).toHaveBeenCalledWith('focus', 0.35, 0.12, 0.25);
    expect(time.scale).toBe(1);
    expect(time.playerDt).toBe(0.05);
    time.share('coop:1:focus', 0.35, 0, 0.5);
    time.tick(0.05);
    expect(time.slowmo).toBe(0.35);
    expect(time.dt).toBeCloseTo(0.05 * 0.35, 8);
    expect(time.playerDt).toBe(0.05);
    time.popScale('focus');
    expect(gate.pop).toHaveBeenCalledWith('focus');
    time.tick(0.05);
    expect(time.slowmo).toBe(0.35);
    time.unshare('coop:1:focus');
    for (let i = 0; i < 9; i++) time.tick(0.05);
    expect(time.slowmo).toBeGreaterThan(0.35);
    expect(time.slowmo).toBeLessThan(1);
    time.tick(0.05);
    time.tick(0.05);
    expect(time.slowmo).toBe(1);
  });

  it('co-op: the blend back to full speed takes its half second of wall time on a screen with long frames; alone it is unchanged', () => {
    // A guest at 4 fps: frames of a quarter second, each clamped to 1/20 s of world.
    const guest = new GameTime();
    guest.gate = { push: () => {}, pop: () => {} };
    guest.share('coop:0:focus', 0.35, 0.12, 0.5);
    guest.tick(0.25);
    expect(guest.slowmo).toBeCloseTo(0.35, 6);
    guest.unshare('coop:0:focus');
    guest.tick(0.25);
    expect(guest.slowmo).toBeCloseTo(0.675, 6);
    guest.tick(0.25);
    expect(guest.slowmo).toBe(1);
    expect(guest.dt).toBe(MAX_STEP);
    // Single player at the same 4 fps: ten clamped frames, as before this change.
    const solo = new GameTime();
    solo.pushScale('focus', 0.35, 0, 0.5);
    solo.tick(0.25);
    solo.popScale('focus');
    for (let i = 0; i < 9; i++) solo.tick(0.25);
    expect(solo.slowmo).toBeLessThan(1);
    solo.tick(0.25); solo.tick(0.25);
    expect(solo.slowmo).toBe(1);
  });

  it('T1: a co-op host at 15, 10, 8 and 5 fps keeps the world at real speed', () => {
    for (const fps of [15, 10, 8, 5]) {
      const time = new GameTime();
      time.hostSteps = true;
      const steps = play(time, fps, 10);
      expect(time.elapsed).toBeCloseTo(10, 5);
      expect(time.playerElapsed).toBeCloseTo(10, 5);
      // Each step is no longer than single player's longest, so the simulation sees nothing it does not see alone at 20 fps.
      expect(steps).toBe(10 * fps * Math.ceil(1 / fps / MAX_STEP - 1e-6));
    }
  });

  it('T1: at 20 fps and above the host takes one step a frame, as before', () => {
    for (const fps of [20, 30, 60, 144]) {
      const time = new GameTime();
      time.hostSteps = true;
      expect(play(time, fps, 2)).toBe(2 * fps);
      expect(time.elapsed).toBeCloseTo(2, 5);
    }
  });

  it('T1: when the steps themselves are what is slow, the host takes fewer, longer ones and still keeps real speed down to 8 fps', () => {
    const time = new GameTime();
    time.hostSteps = true;
    // 10 fps because the simulation costs 70 ms a step: a second step would cost another 70.
    expect(play(time, 10, 10, 70)).toBe(100);
    expect(time.elapsed).toBeCloseTo(10, 5);
    const slow = new GameTime();
    slow.hostSteps = true;
    play(slow, 8, 10, 110);
    expect(slow.elapsed).toBeCloseTo(10, 5);
  });

  it(`T1: a stall never plays out more than ${HOST_FRAME} s of world, in at most ${HOST_STEPS} steps`, () => {
    const time = new GameTime();
    time.hostSteps = true;
    const n = time.split(3, 4);
    expect(n).toBe(HOST_STEPS);
    for (let s = 0; s < n; s++) time.tick(3 / n);
    expect(time.elapsed).toBeCloseTo(HOST_FRAME, 6);
    // Below 4 fps the world does slow: 2 fps plays a quarter second of each half.
    const crawl = new GameTime();
    crawl.hostSteps = true;
    play(crawl, 2, 10);
    expect(crawl.elapsed).toBeCloseTo(5, 5);
    expect(HOST_STEP).toBeGreaterThan(MAX_STEP);
  });

  it('T1: shared slow-mo on a slow host is still the same slow-mo', () => {
    const time = new GameTime();
    time.hostSteps = true;
    time.share('coop:0:focus', 0.35, 0, 0);
    play(time, 10, 4);
    expect(time.elapsed).toBeCloseTo(4 * 0.35, 5);
    expect(time.playerElapsed).toBeCloseTo(4, 5);
  });
});
