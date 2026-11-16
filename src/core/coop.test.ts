import { describe, expect, it, vi } from 'vitest';
vi.mock('../ui/boot', () => ({ loadingScreen: { set: vi.fn() }, showLoading: vi.fn() }));
import { Game } from './Game';
import type { Ctx } from './contracts';
import { GameTime } from './time';

function context(coop = false): Ctx {
  const ctx: Record<string, unknown> = { time: new GameTime(), events: { emit: vi.fn() } };
  for (const name of ['render', 'physics', 'input', 'player', 'weapons', 'viewmodel', 'enemies', 'allies', 'waves', 'combat',
    'world', 'gore', 'progression', 'contracts', 'campaign', 'camera', 'fx', 'audio', 'hud', 'characters']) {
    ctx[name] = { init: vi.fn(), reset: vi.fn(), update: vi.fn(), start: vi.fn(), render: vi.fn(), step: vi.fn(), endFrame: vi.fn(), load: vi.fn() };
  }
  if (coop) ctx.coop = { freeRoam: true, init: vi.fn(), update: vi.fn() };
  return ctx as unknown as Ctx;
}
const frame = (game: Game) => (game as unknown as { frame(): void }).frame();
async function init(game: Game) {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  try { await game.init(() => {}); } finally { vi.unstubAllGlobals(); }
}

describe('co-op flag and single-player lifecycle', () => {
  it('retains solo init, reset, wave start and actual pause semantics', async () => {
    const c = context(); const g = new Game(c); await init(g); g.newRun();
    expect(c.enemies.init).toHaveBeenCalledWith(c);
    expect(c.contracts.init).toHaveBeenCalledWith(c);
    expect(c.waves.start).toHaveBeenCalledOnce();
    g.setState('paused'); c.time.tick(0.05); frame(g);
    expect(c.time.paused).toBe(true); expect(c.time.dt).toBe(0);
    expect(c.world.update).not.toHaveBeenCalled();
    expect(c.physics.step).not.toHaveBeenCalled();
    expect(c.hud.update).toHaveBeenCalledOnce();
  });
  it('starts enemy-free and keeps the world, physics and network live under Esc while withholding local controls', async () => {
    const c = context(true); const g = new Game(c); await init(g); g.newRun();
    for (const sys of [c.enemies, c.allies!, c.waves, c.contracts, c.campaign]) {
      expect(sys.init).not.toHaveBeenCalled(); expect(sys.reset).not.toHaveBeenCalled();
    }
    expect(c.waves.start).not.toHaveBeenCalled();
    g.setState('paused'); c.time.tick(0.05); frame(g);
    expect(c.time.paused).toBe(false); expect(c.time.dt).toBe(0.05);
    expect(c.world.update).toHaveBeenCalledOnce();
    expect(c.physics.step).toHaveBeenCalledWith(0.05);
    expect(c.coop!.update).toHaveBeenCalledOnce();
    for (const sys of [c.player, c.weapons, c.viewmodel, c.combat, c.progression, c.enemies, c.waves, c.contracts]) expect(sys.update).not.toHaveBeenCalled();
  });
  it('initializes dormant systems exactly once when a later solo run starts', async () => {
    const c = context(true); const g = new Game(c); await init(g); g.newRun();
    g.clearRun(); c.coop = undefined; g.setState('menu'); g.newRun();
    for (const sys of [c.enemies, c.allies!, c.waves, c.contracts, c.campaign]) expect(sys.init).toHaveBeenCalledOnce();
    expect(c.waves.start).toHaveBeenCalledOnce();
    g.newRun(); expect(c.enemies.init).toHaveBeenCalledOnce(); expect(c.waves.start).toHaveBeenCalledTimes(2);
  });
});
