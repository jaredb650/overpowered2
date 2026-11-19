import { afterEach, describe, expect, it } from 'vitest';
import { DevFlags } from '../core/devflags';
import { Physics } from './Physics';

/** How many world steps one frame of `dt` seconds takes, and the world time they cover. */
async function stepsFor(dt: number): Promise<{ steps: number; covered: number }> {
  const physics = await Physics.create();
  const world = physics.world;
  const step = world.step.bind(world);
  let steps = 0;
  let covered = 0;
  world.step = (...args: Parameters<typeof step>) => {
    steps++;
    covered += world.timestep;
    return step(...args);
  };
  physics.step(dt);
  return { steps, covered };
}

describe('the physics step', () => {
  afterEach(() => {
    DevFlags.oneStep = true;
  });

  it('takes a 60 Hz frame in one step, however the frame time wobbles', async () => {
    // What a 60 Hz screen's frames read: 16.6 to 16.8 ms, and now and then a little more.
    for (const ms of [16.6, 1000 / 60, 16.7, 16.8, 17.2, 17.6]) {
      const { steps, covered } = await stepsFor(ms / 1000);
      expect(steps, `${ms} ms`).toBe(1);
      // All of the frame's time is simulated (to the engine's 32-bit timestep): nothing is clamped away, so the world does not run slow.
      expect(covered).toBeCloseTo(ms / 1000, 6);
    }
  });

  it('still cuts a long frame into steps no longer than a 60 Hz frame and a bit', async () => {
    for (const [ms, want] of [[18, 2], [25, 2], [33.4, 2], [36, 3], [50, 3]] as const) {
      const { steps, covered } = await stepsFor(ms / 1000);
      expect(steps, `${ms} ms`).toBe(want);
      expect(covered).toBeCloseTo(ms / 1000, 6);
      expect(covered / steps).toBeLessThanOrEqual((1 / 60) * 1.06 + 1e-6);
    }
  });

  it('with the switch off, cuts every frame a hair over 1/60 s in two, as it did', async () => {
    DevFlags.oneStep = false;
    expect((await stepsFor(1 / 60)).steps).toBe(1);
    expect((await stepsFor(0.0168)).steps).toBe(2);
    expect((await stepsFor(0.0336)).steps).toBe(3);
  });
});
