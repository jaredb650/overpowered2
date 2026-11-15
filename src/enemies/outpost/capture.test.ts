import { describe, expect, it } from 'vitest';
import { BOUNTY } from '../../contracts/defense/data';
import { Capture, CUFFING_SECONDS, type Wallet } from './capture';
import type { Soldier } from './soldier';

const man = {} as Soldier;
const wallet = (): Wallet & { credits: number } => ({ credits: 0, earn(n) { this.credits += n; } });

/** Cuffed and waiting, with a drone on its way. */
function cuffed(): Capture {
  const c = new Capture(man);
  c.step(CUFFING_SECONDS + 0.01);
  c.drone = true;
  return c;
}

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

  it('puts a man shot off the hook back on the floor to wait for another drone', () => {
    const c = cuffed();
    c.hook();
    c.drop();
    expect(c.phase).toBe('cuffed');
    expect(c.waiting).toBe(true);
  });

  it('pays the bounty once, when his feet leave the floor', () => {
    const c = cuffed();
    const w = wallet();
    expect(c.secure(w, 60)).toBe(null);
    c.hook();
    expect(c.secure(w, 60)).toBe(60);
    expect(c.secure(w, 60)).toBe(null);
    // Dropped and lifted again by a second drone: still paid only the once.
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

  it('prices a prisoner by his rank', () => {
    expect(BOUNTY.conscript).toBeLessThan(BOUNTY.regular);
    expect(BOUNTY.regular).toBeLessThan(BOUNTY.veteran);
    expect(BOUNTY.veteran).toBeLessThan(BOUNTY.elite);
  });
});
