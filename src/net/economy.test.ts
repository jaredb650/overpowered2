import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../core/contracts';
import { createProgression } from '../progression';

describe('per-player loot (stage 3)', () => {
  it.each(['solo', 'host', 'guest'] as const)('every player ticks their own pickups and supply pod: %s', role => {
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
    expect(pickups.update).toHaveBeenCalledTimes(1);
    expect(pods.update).toHaveBeenCalledTimes(1);
  });
});
