import { describe, expect, it, vi } from 'vitest';
vi.mock('./gameplay', () => ({}));
vi.mock('../ui/boot', () => ({}));
vi.mock('./devflags', () => ({ DEV_TOOLS: false, ON_RANGE: false }));
vi.mock('../net/session', () => ({ reconnectMatch: vi.fn(), resumedLobby: null, resumedMatch: null, resumeFailed: '' }));
import { Game } from './Game';
import type { Ctx, GameSystem } from './contracts';

describe('Game frame isolation', () => {
  it('continues systems, rendering and later frames when one effect throws', () => {
    const good = { update: vi.fn() }; const bad = { update() { throw Error('effect failed'); } };
    const render = { render: vi.fn() }; const input = { endFrame: vi.fn() };
    const game = new Game({ render, input, time: { frame: 1 } } as unknown as Ctx);
    game.state = 'playing';
    const internals = game as unknown as { ordered: GameSystem[]; frame(): void };
    internals.ordered = [bad, good];
    for (let i = 0; i < 3; i++) internals.frame();
    expect(good.update).toHaveBeenCalledTimes(3);
    expect(render.render).toHaveBeenCalledTimes(3);
    expect(input.endFrame).toHaveBeenCalledTimes(3);
  });
});
