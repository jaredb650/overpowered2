import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../core/contracts';
import { createProgression } from '../progression';

describe('stage-two pickup authority', () => {
  it.each(['solo', 'host', 'guest'] as const)('only ticks the pickup economy on its authority: %s', role => {
    const ctx = {
      player: { grounded: true }, time: { dt: 0.016, playerDt: 0.016, realDt: 0.016 }, waves: { phase: 'intermission' },
      ...(role === 'solo' ? {} : { coop: { world: {}, hosting: role === 'host' } }),
    } as unknown as Ctx;
    const progression = createProgression(ctx);
    const pickups = { update: vi.fn() }, pods = { update: vi.fn() };
    Object.assign(progression, {
      perks: { update: vi.fn(), isActive: () => false }, scoreKeeper: { update: vi.fn() }, chains: { update: vi.fn() },
      callInsManager: { update: vi.fn() }, stimKit: { update: vi.fn() },
      frost: { update: vi.fn() }, pickupsManager: pickups, pods,
    });
    progression.update?.();
    expect(pickups.update).toHaveBeenCalledTimes(role === 'guest' ? 0 : 1);
    expect(pods.update).toHaveBeenCalledTimes(role === 'guest' ? 0 : 1);
  });
});
