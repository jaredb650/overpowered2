import { describe, expect, it } from 'vitest';
import { BOUNTY } from '../../contracts/defense/data';
import { Capture, CLICKS, CUFF_HOLD, CUFFING_SECONDS, gesture, rope, snatchTime, type Wallet } from './capture';
import type { Soldier } from './soldier';

const man = {} as Soldier;
const wallet = (): Wallet & { credits: number } => ({ credits: 0, earn(n) { this.credits += n; } });

/** Cuffed, with a drone on its way. */
function cuffed(): Capture {
  const c = new Capture(man);
  c.step(CUFFING_SECONDS + 0.01);
  c.drone = true;
  return c;
}

describe('the E key on a kneeling man', () => {
  it('cuffs him on a hold, without waiting for the key to come up', () => {
    expect(gesture(CUFF_HOLD - 0.05, true, false)).toBe(null);
    expect(gesture(CUFF_HOLD, true, false)).toBe('cuff');
    expect(gesture(CUFF_HOLD, true, true)).toBe('cuff');
  });

  it('questions him on a tap, and lets him go on a tap once questioned', () => {
    expect(gesture(0.1, false, false)).toBe('question');
    expect(gesture(0.1, false, true)).toBe('letGo');
  });
});

describe('the snatch', () => {
  it('takes him off the floor within 2 s of the cuffs clicking, in the open and dragged out from under a roof', () => {
    expect(snatchTime(0) - CLICKS[0]).toBeGreaterThanOrEqual(1);
    expect(snatchTime(0) - CLICKS[0]).toBeLessThanOrEqual(2);
    // The farthest drag the airlift asks for (a route of 18 m).
    expect(snatchTime(18) - CLICKS[0]).toBeLessThanOrEqual(2);
    // Never before the cuffs are on.
    expect(snatchTime(0)).toBeGreaterThan(CUFFING_SECONDS);
  });

  it('holds him on the line as a ragdoll: past its length he is pulled back and nothing carries him further out', () => {
    const anchor = { x: 0, y: 10, z: 0 };
    const p = { x: 0, y: 0, z: 0 };
    const v = { x: 3, y: -5, z: 0 };
    expect(rope(p, v, anchor, 9, 9)).toBe(true);
    // 1 m past the line, falling away from it: the fall is gone and he is pulled up.
    expect(v.y).toBeCloseTo(9);
    expect(v.x).toBe(3);
    // Slack, the line does nothing: he swings and flails as he likes.
    const w = { x: 1, y: -2, z: 0.5 };
    expect(rope({ x: 0, y: 5, z: 0 }, w, anchor, 9, 9)).toBe(false);
    expect(w).toEqual({ x: 1, y: -2, z: 0.5 });
  });
});

describe('capture', () => {
  it('goes surrendered, cuffed, hooked, gone, in that order only', () => {
    const c = new Capture(man);
    expect(c.phase).toBe('cuffing');
    expect(c.hook()).toBe(false);
    c.step(CUFFING_SECONDS / 2);
    expect(c.phase).toBe('cuffing');
    c.step(CUFFING_SECONDS / 2 + 0.01);
    expect(c.phase).toBe('cuffed');
    expect(c.waiting).toBe(true);
    // No drone, no hook; and it cannot leave before it is hooked.
    expect(c.hook()).toBe(false);
    expect(c.leave()).toBe(false);
    c.drone = true;
    expect(c.waiting).toBe(false);
    expect(c.hook()).toBe(true);
    expect(c.phase).toBe('hooked');
    expect(c.hook()).toBe(false);
    expect(c.leave()).toBe(true);
    expect(c.phase).toBe('gone');
    expect(c.leave()).toBe(false);
  });

  it('puts a man who comes off the line back on the floor to wait for another pass', () => {
    const c = cuffed();
    c.hook();
    c.drop();
    expect(c.phase).toBe('cuffed');
    expect(c.waiting).toBe(true);
  });

  it('pays the bounty once, as he is yanked off the floor', () => {
    const c = cuffed();
    const w = wallet();
    expect(c.secure(w, 60)).toBe(null);
    c.hook();
    expect(c.secure(w, 60)).toBe(60);
    expect(c.secure(w, 60)).toBe(null);
    // Off the line and snatched again by a second pass: still paid only the once.
    c.drop();
    c.drone = true;
    c.hook();
    expect(c.secure(w, 60)).toBe(null);
    expect(w.credits).toBe(60);
  });

  it('pays nothing in a mode without credits, and says so with 0', () => {
    const c = cuffed();
    c.hook();
    expect(c.secure(null, 60)).toBe(0);
    expect(c.secure(undefined, 60)).toBe(null);
  });

  it('prices a prisoner by his rank: 120, 180, 270, 450 (the owner tripled them)', () => {
    expect(BOUNTY).toEqual({ conscript: 250, regular: 300, veteran: 350, elite: 450 });
    expect(BOUNTY.conscript).toBeLessThan(BOUNTY.regular);
    expect(BOUNTY.regular).toBeLessThan(BOUNTY.veteran);
    expect(BOUNTY.veteran).toBeLessThan(BOUNTY.elite);
  });
});
