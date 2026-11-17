import { describe, expect, it } from 'vitest';
import { FLASH_SECONDS, ringFrame } from './holdRing';

describe('the hold ring', () => {
  it('shows what was asked this frame, and nothing on a frame nobody asks', () => {
    expect(ringFrame(0.4, 0, 1 / 60)).toEqual({ fill: 0.4, flash: 0 });
    expect(ringFrame(null, 0, 1 / 60)).toEqual({ fill: null, flash: 0 });
  });

  it('flashes full once a hold is done, then goes', () => {
    let f = ringFrame(1, 0, 1 / 60);
    expect(f).toEqual({ fill: 1, flash: FLASH_SECONDS });
    f = ringFrame(null, f.flash, FLASH_SECONDS / 2);
    expect(f.fill).toBe(1);
    f = ringFrame(null, f.flash, FLASH_SECONDS);
    f = ringFrame(null, f.flash, 1 / 60);
    expect(f).toEqual({ fill: null, flash: 0 });
  });
});
