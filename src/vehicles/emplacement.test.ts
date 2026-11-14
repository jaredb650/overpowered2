import { describe, expect, it } from 'vitest';
import { Heat, MOUNT_LEVELS } from './emplacement';

const [one, two, three] = MOUNT_LEVELS as [typeof MOUNT_LEVELS[0], typeof MOUNT_LEVELS[0], typeof MOUNT_LEVELS[0]];

/** Seconds of a held trigger until the lockout, at the gun's own rate. */
function secondsToOverheat(level = one): number {
  const heat = new Heat(level);
  const dt = 1 / level.roundsPerSecond;
  let t = 0;
  while (!heat.overheated && t < 60) {
    t += dt;
    heat.shot();
    heat.cool(dt, true);
  }
  return t;
}

describe('Mounted gun heat', () => {
  it('locks out after a long burst, and not a short one', () => {
    for (const level of MOUNT_LEVELS) {
      const s = secondsToOverheat(level);
      expect(s).toBeGreaterThan(4);
      expect(s).toBeLessThan(12);
    }
  });

  it('refuses rounds while locked out, and frees the trigger only once it is back to nothing', () => {
    const heat = new Heat(one);
    while (!heat.shot());
    expect(heat.overheated).toBe(true);
    expect(heat.shot()).toBe(false);
    expect(heat.value).toBe(1);
    heat.cool(1, false);
    expect(heat.overheated).toBe(true);
    heat.cool(10, false);
    expect(heat.overheated).toBe(false);
    expect(heat.value).toBe(0);
  });

  it('cools off the trigger and holds while firing', () => {
    const heat = new Heat(one);
    for (let i = 0; i < 20; i++) heat.shot();
    const hot = heat.value;
    heat.cool(0.5, true);
    expect(heat.value).toBe(hot);
    heat.cool(0.5, false);
    expect(heat.value).toBeCloseTo(hot - one.cool * 0.5);
  });
});

describe('Mounted gun ladder', () => {
  it('is three rungs, each a better gun than the last', () => {
    expect(MOUNT_LEVELS).toHaveLength(3);
    expect(two.roundsPerSecond).toBeGreaterThan(one.roundsPerSecond);
    expect(two.shield.width).toBeGreaterThan(one.shield.width);
    expect(two.shield.top).toBeGreaterThan(one.shield.top);
    expect(three.roundsPerSecond).toBeGreaterThan(2 * two.roundsPerSecond);
    expect(three.roundsPerSecond * three.damage).toBeGreaterThan(two.roundsPerSecond * two.damage);
  });

  it('spins up only at the top, which is heard as loops and not per round', () => {
    expect(one.spinUp).toBe(0);
    expect(two.spinUp).toBe(0);
    expect(three.spinUp).toBeGreaterThan(0);
    expect(three.shot).toBeNull();
    expect(one.shot).toBe('hmg_shot');
  });

  it('leaves the head above every shield', () => {
    // The player's eye stands at 1.62 m: the gunner is exposed whatever the rung.
    for (const level of MOUNT_LEVELS) expect(level.shield.top).toBeLessThan(1.45);
  });
});
