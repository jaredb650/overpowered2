import { beforeEach, describe, expect, it, vi } from 'vitest';
const made = vi.hoisted(() => vi.fn());
vi.mock('./remote', () => ({ PROPS: ['smg'], RemotePlayer: class {
  dispose = vi.fn(); push = vi.fn(); update = vi.fn();
  constructor(_ctx: unknown, readonly player: unknown) { made(this); }
} }));
// The world (enemies, team) has its own tests; here it is a stand-in, so these cover the session's roster, tags and poses.
vi.mock('./world', () => ({ CoopWorld: class {
  team = { roster: () => [], reviving: false, onOver: () => {}, restore: vi.fn() };
  mission = { catchUp: vi.fn() };
  begin = vi.fn(); update = vi.fn(); dispose = vi.fn();
} }));
import type { Ctx } from '../core/contracts';
import { CoopSession } from './index';
import type { Lobby, LobbyPlayer } from './lobby';

const host: LobbyPlayer = { id: 'host', name: 'HOST', host: true, ready: true, slot: 0 };
const guest: LobbyPlayer = { id: 'guest', name: 'GUEST', host: false, ready: true, slot: 1 };
function setup() {
  const lobby = { players: [host, guest], you: 'host', hosting: true, match: { id: 'test', mode: 'outpost' },
    phase: 'open', error: null, onChange: () => {}, onPose: vi.fn(), leave: vi.fn(), sendPose: vi.fn(), heartbeat: vi.fn() } as unknown as Lobby;
  const ctx = { characters: { load: vi.fn(), prop: vi.fn() }, hud: { feed: vi.fn() }, time: { realDt: 0.016 },
    player: { position: { toArray: () => [1, 2, 3] }, velocity: { toArray: () => [4, 5, 6] }, yaw: 0, pitch: 0.2,
      speed: 9, grounded: true, crouched: false }, weapons: { current: 'smg' }, input: { isDown: () => false } } as unknown as Ctx;
  const session = new CoopSession(ctx, lobby, { id: 'test', mode: 'outpost' });
  return { session, lobby, ctx };
}
beforeEach(() => { made.mockClear(); vi.restoreAllMocks(); });
describe('remote match lifecycle', () => {
  it('creates tags/bodies after run startup, removes a departed guest and emits its callsign once', async () => {
    const { session, lobby, ctx } = setup(); await session.init();
    expect(made).not.toHaveBeenCalled();
    lobby.onChange(); expect(made).not.toHaveBeenCalled();
    session.begin(); expect(session.remotes.size).toBe(1);
    const remote = session.remotes.get('guest')!;
    lobby.players = [host]; lobby.onChange(); lobby.onChange();
    expect(remote.dispose).toHaveBeenCalledOnce(); expect(ctx.hud.feed).toHaveBeenCalledOnce();
    expect(ctx.hud.feed).toHaveBeenCalledWith('GUEST left.', '#ffb33d');
    expect(session.remotes.size).toBe(0);
  });
  it('cleans bodies/room and reports host loss once, even if it happened during loading', async () => {
    const { session, lobby } = setup(); lobby.phase = 'closed'; lobby.error = 'host-left';
    const ended = vi.fn(); session.onEnded = ended;
    await session.init(); session.begin(); lobby.onChange(); session.leave();
    expect(ended).toHaveBeenCalledOnce(); expect(ended.mock.calls[0]![0]).toContain('host left');
    expect(lobby.leave).toHaveBeenCalledOnce(); expect(made).not.toHaveBeenCalled();
  });
  it('sends at 20 Hz, with no backlog burst after a stall, and streams an idle pose under menus', async () => {
    const { session, lobby } = setup(); await session.init(); session.begin();
    const now = vi.spyOn(performance, 'now');
    for (let ms = 0; ms < 1000; ms += 10) { now.mockReturnValue(ms); session.update(); }
    expect(lobby.sendPose).toHaveBeenCalledTimes(20);
    now.mockReturnValue(10000); session.update(); session.update();
    expect(lobby.sendPose).toHaveBeenCalledTimes(21);
    session.localPaused = true; now.mockReturnValue(10050); session.update();
    expect(lobby.sendPose).toHaveBeenLastCalledWith(expect.objectContaining({ move: 'walk', velocity: [0, 0, 0], weapon: 'smg' }));
    session.leave(); now.mockReturnValue(11000); session.update();
    expect(lobby.sendPose).toHaveBeenCalledTimes(22);
  });
});
