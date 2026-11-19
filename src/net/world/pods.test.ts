/**
 * The supply pod in co-op. The race that deleted a guest's pod (audit A5): a guest replayed `wave:clear` while its copy of the
 * waves still said `spawning`, so the pod it had just called was retired on the next frame.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WavePhase } from '../../core/gameplay';
import { party } from './sharedkit';

describe('the break reaches a guest with the wave event, not a snapshot later', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it("a guest hears `wave:clear` already in the break, with the host's clock", () => {
    const game = party(1);
    game.build();
    const guest = game.guests[0]!;
    const heard: { phase: WavePhase; next: number; wave: number }[] = [];
    guest.ctx.events.on('wave:clear', () => heard.push({ phase: guest.ctx.waves.phase, next: guest.ctx.waves.nextWaveIn, wave: guest.ctx.waves.wave }));
    // The host's director is in the break by the time it announces the clear (enemies/waves.ts).
    Object.assign(game.host.ctx.waves, { wave: 3, phase: 'intermission', nextWaveIn: 8 });
    game.host.ctx.events.emit('wave:clear', { wave: 3, bonus: 950 });
    game.relay.flush();
    expect(heard).toEqual([{ phase: 'intermission', next: 8, wave: 3 }]);
    game.dispose();
  });

  it('a clear is the break even from a director that announces first (Outpost Defense), and a start ends it', () => {
    const game = party(1);
    game.build();
    const guest = game.guests[0]!;
    Object.assign(game.host.ctx.waves, { wave: 2, phase: 'clearing', nextWaveIn: 0 });
    game.host.ctx.events.emit('wave:clear', { wave: 2, bonus: 0 });
    game.relay.flush();
    expect(guest.ctx.waves.phase).toBe('intermission');
    Object.assign(game.host.ctx.waves, { wave: 3, phase: 'boss' });
    game.host.ctx.events.emit('wave:start', { wave: 3, total: 9, boss: true });
    game.relay.flush();
    expect(guest.ctx.waves.phase).toBe('boss');
    expect(guest.ctx.waves.wave).toBe(3);
    game.dispose();
  });

  it('junk in the phase or the clock changes nothing it should not', () => {
    const game = party(1);
    game.build();
    const guest = game.guests[0]!;
    Object.assign(guest.ctx.waves, { nextWaveIn: 5 });
    game.host.room.channel('action').send({ match: 'shared-test', data: { t: 'wave', kind: 'start', wave: 4, total: 1, boss: false, bonus: 0, phase: 'intermission', next: -1 } });
    game.relay.flush();
    expect(guest.ctx.waves.phase).toBe('spawning');
    expect(guest.ctx.waves.nextWaveIn).toBe(5);
    game.host.room.channel('action').send({ match: 'shared-test', data: { t: 'wave', kind: 'clear', wave: 4, total: 0, boss: false, bonus: 0, phase: 7, next: 'soon' } });
    game.relay.flush();
    expect(guest.ctx.waves.phase).toBe('intermission');
    expect(guest.ctx.waves.nextWaveIn).toBe(5);
    game.dispose();
  });
});
