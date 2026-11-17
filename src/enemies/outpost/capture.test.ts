import { describe, expect, it } from 'vitest';
import { BOUNTY } from '../../contracts/defense/data';
import { Capture, CLICKS, CUFF_HOLD, CUFFING_SECONDS, gesture, holdFill, rope, snatchTime, TAP_MAX, type Wallet } from './capture';
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
  /** Walks a press of `seconds` frame by frame at 60 fps, then lets it up: every gesture it came to. */
  function press(seconds: number, questioned = false): string[] {
    const out: string[] = [];
    let held = 0;
    for (; held < seconds; held += 1 / 60) {
      const g = gesture(held, true, questioned);
      if (g) return [...out, g];
    }
    const g = gesture(held, false, questioned);
    return g ? [...out, g] : out;
  }

  it('questions him on a quick tap, and never starts a capture', () => {
    expect(press(0.1)).toEqual(['question']);
    expect(press(TAP_MAX - 0.03)).toEqual(['question']);
    expect(holdFill(TAP_MAX - 0.01)).toBe(0);
  });

  it('cuffs him on a hold of about a second, without waiting for the key to come up, and never questions him', () => {
    expect(CUFF_HOLD).toBeGreaterThanOrEqual(1);
    expect(CUFF_HOLD).toBeLessThanOrEqual(1.5);
    expect(press(CUFF_HOLD + 1)).toEqual(['cuff']);
    expect(press(CUFF_HOLD + 1, true)).toEqual(['cuff']);
  });

  it('does nothing for a hold let go before the cuffs: not a question, not a capture', () => {
    expect(press(TAP_MAX + 0.05)).toEqual(['cancel']);
    expect(press(CUFF_HOLD - 0.1)).toEqual(['cancel']);
  });

  it('a man already questioned has nothing more to say: a tap does nothing', () => {
    expect(press(0.1, true)).toEqual(['cancel']);
  });

  it('fills the ring from the end of a tap to the cuffs', () => {
    expect(holdFill(TAP_MAX)).toBe(0);
    expect(holdFill((TAP_MAX + CUFF_HOLD) / 2)).toBeCloseTo(0.5);
    expect(holdFill(CUFF_HOLD)).toBe(1);
    expect(holdFill(CUFF_HOLD + 5)).toBe(1);
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
