import { beforeEach, describe, expect, it, vi } from 'vitest';
const made = vi.hoisted(() => vi.fn());
vi.mock('./remote', () => ({ PROPS: ['smg'], friendTorches: () => [], RemotePlayer: class {
  dispose = vi.fn(); push = vi.fn(); update = vi.fn();
  constructor(_ctx: unknown, readonly player: unknown) { made(this); }
} }));
// The world (enemies, team) has its own tests; here it is a stand-in, so these cover the session's roster, tags and poses.
vi.mock('./world', () => ({ CoopWorld: class {
  team = { roster: () => [], reviving: false, onOver: () => {}, restore: vi.fn() };
  mission = { catchUp: vi.fn() };
  begin = vi.fn(); update = vi.fn(); dispose = vi.fn(); doing = () => 0;
} }));
import type { Ctx } from '../core/contracts';
import { CoopSession } from './index';
import type { Lobby, LobbyPlayer } from './lobby';

const host: LobbyPlayer = { id: 'host', name: 'HOST', host: true, ready: true, slot: 0 };
const guest: LobbyPlayer = { id: 'guest', name: 'GUEST', host: false, ready: true, slot: 1 };
function setup() {
  const lobby = { players: [host, guest], you: 'host', hosting: true, match: { id: 'test', mode: 'outpost' },
    phase: 'open', error: null, live: true, waitingFor: [], reconnecting: null, onChange: () => {}, onPose: vi.fn(), leave: vi.fn(), sendPose: vi.fn(),
    heartbeat: vi.fn(), deployed: vi.fn(), booted: vi.fn(), setIdle: vi.fn(), successors: () => ({ rank: 0, names: ['GUEST'] }) } as unknown as Lobby;
  const ctx = { characters: { load: vi.fn(), prop: vi.fn() }, hud: { feed: vi.fn() }, time: { realDt: 0.016 },
    player: { position: { toArray: () => [1, 2, 3] }, velocity: { toArray: () => [4, 5, 6] }, yaw: 0, pitch: 0.2,
      speed: 9, grounded: true, crouched: false }, weapons: { current: 'smg' }, input: { isDown: () => false } } as unknown as Ctx;
  const session = new CoopSession(ctx, lobby, { id: 'test', mode: 'outpost' });
  return { session, lobby, ctx };
}
beforeEach(() => { made.mockClear(); vi.restoreAllMocks(); });
describe('remote match lifecycle', () => {
  it('creates tags/bodies after run startup, removes a departed guest and says so once', async () => {
    const { session, lobby, ctx } = setup(); await session.init();
    expect(made).not.toHaveBeenCalled();
    lobby.onChange(); expect(made).not.toHaveBeenCalled();
    session.begin(); expect(session.remotes.size).toBe(1);
    const remote = session.remotes.get('guest')!;
    lobby.players = [host]; lobby.onChange(); lobby.onChange();
    expect(remote.dispose).toHaveBeenCalledOnce();
    // The news itself is the lobby's own line, once: the roster change says nothing more (no doubled "left").
    expect(ctx.hud.feed).not.toHaveBeenCalled();
    lobby.onLine({ from: null, text: 'GUEST left.' });
    expect(ctx.hud.feed).toHaveBeenCalledOnce();
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
describe('the deploy gate, real reasons and host loss', () => {
  const gated = (over: Record<string, unknown> = {}) => {
    const made = setup();
    Object.assign(made.lobby, { hosting: false, you: 'guest', me: guest, live: false, where: 'loading', ...over });
    const ended = vi.fn(); made.session.onEnded = ended;
    const start = vi.fn();
    return { ...made, ended, start };
  };
  it('nothing starts until the deploy click, and the click starts the run, the world and tells the host', async () => {
    const { session, lobby, start } = gated(); await session.init();
    session.gate(start);
    expect(lobby.booted).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled(); expect(session.remotes.size).toBe(0);
    // Not until this page has its host and its match.
    lobby.phase = 'connecting'; expect(session.deploy()).toBe(false);
    lobby.phase = 'open'; expect(session.deploy()).toBe(true);
    expect(start).toHaveBeenCalledOnce(); expect(lobby.deployed).toHaveBeenCalledOnce();
    expect(session.remotes.size).toBe(1);
    // A second click does nothing.
    expect(session.deploy()).toBe(false); expect(start).toHaveBeenCalledOnce();
  });
  it('holds the world until the host says the barrier is over, and the host is told to start it once', async () => {
    const { session, lobby } = setup(); Object.assign(lobby, { live: false });
    const go = vi.fn(); session.onGo = go;
    await session.init();
    expect(session.holding).toBe(true);
    lobby.onGo(); expect(go).not.toHaveBeenCalled(); // before this page has deployed there is no world to start
    session.gate(() => {}); session.deploy();
    Object.assign(lobby, { live: true }); lobby.onGo();
    expect(session.holding).toBe(false); expect(go).toHaveBeenCalledOnce();
  });
  it('a room that closed while the page was loading is told at the gate with its real reason', async () => {
    const { session, lobby, ended, start } = gated(); await session.init();
    lobby.phase = 'closed'; lobby.error = 'no-answer';
    session.gate(start);
    expect(start).not.toHaveBeenCalled();
    expect(ended).toHaveBeenCalledOnce();
    expect(ended.mock.calls[0]![0]).toMatch(/host is not answering/);
    expect(ended.mock.calls[0]![1]).toBeNull();
  });
  it('a match that ended while the page was loading lands on the lobby page, room kept', async () => {
    const { session, lobby, ended, start } = gated(); await session.init();
    lobby.onEnd();
    expect(ended).not.toHaveBeenCalled(); // not before the boot is over
    session.gate(start);
    expect(start).not.toHaveBeenCalled();
    expect(ended.mock.calls[0]![0]).toMatch(/ended while you were loading/);
  });
  it('feeds seat events to the hooks with the stable seat, and re-runs the catch-up for the same connection coming back', async () => {
    const { session, lobby } = setup(); await session.init(); session.begin();
    const arrived = vi.fn(), lost = vi.fn(), gone = vi.fn();
    session.onArrived.add(arrived); session.onLost.add(lost); const off = session.onGone.add(gone);
    const row: LobbyPlayer = { ...guest, seat: 's1' };
    const team = (session.world as unknown as { team: { onArrived: ReturnType<typeof vi.fn> } }).team;
    team.onArrived = vi.fn();
    lobby.onSeat(row, { kind: 'in', rejoin: false });
    expect(arrived).toHaveBeenCalledWith('guest', { seat: 's1', slot: 1, name: 'GUEST', rejoin: false });
    expect(team.onArrived).not.toHaveBeenCalled(); // a new connection: the team's own first card does it
    lobby.onSeat(row, { kind: 'lost' }); expect(lost).toHaveBeenCalledWith('guest', 's1');
    lobby.onSeat(row, { kind: 'in', rejoin: true });
    expect(team.onArrived).toHaveBeenCalledWith('guest');
    // A new page of the same player: a new connection id, so again the team's own.
    lobby.onSeat({ ...row, id: 'guest-new' }, { kind: 'in', rejoin: true });
    expect(team.onArrived).toHaveBeenCalledOnce();
    off(); lobby.onSeat(row, { kind: 'gone' }); expect(gone).not.toHaveBeenCalled();
  });
});
