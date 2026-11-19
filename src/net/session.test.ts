import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
// The session's own layer (the gate, the status line, the host-lost board) and the co-op HUD are DOM: stand-ins that record.
const view = vi.hoisted(() => ({ showLost: vi.fn(), setLostFoot: vi.fn(), setLine: vi.fn(), showGate: vi.fn(), hideGate: vi.fn(), paintGate: vi.fn(), dispose: vi.fn() }));
vi.mock('./sessionHud', () => ({ SessionHud: class { showLost = view.showLost; setLostFoot = view.setLostFoot; setLine = view.setLine; showGate = view.showGate; hideGate = view.hideGate; paintGate = view.paintGate; dispose = view.dispose; } }));
vi.mock('./coopHud', () => ({ CoopHud: class { update = vi.fn(); dispose = vi.fn(); showEnd = vi.fn(); } }));
import type { Ctx } from '../core/contracts';
import { CoopSession, LOST_BOARD_MS, TOO_SLOW } from './index';
import type { Lobby, LobbyPlayer } from './lobby';

const host: LobbyPlayer = { id: 'host', name: 'HOST', host: true, ready: true, slot: 0 };
const guest: LobbyPlayer = { id: 'guest', name: 'GUEST', host: false, ready: true, slot: 1 };
function setup() {
  const lobby = { players: [host, guest], you: 'host', hosting: true, match: { id: 'test', mode: 'outpost' },
    phase: 'open', error: null, live: true, waitingFor: [], reconnecting: null, onChange: () => {}, onPose: vi.fn(), leave: vi.fn(), sendPose: vi.fn(),
    heartbeat: vi.fn(), deployed: vi.fn(), booted: vi.fn(), setIdle: vi.fn(), batching: vi.fn(), successors: () => ({ rank: 0, names: ['GUEST'] }) } as unknown as Lobby;
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
describe('a guest the host has stopped feeding is told so on its own screen', () => {
  /** A guest in a running match, with the host's body in the world and its world data arriving (`fed`). */
  afterEach(() => vi.unstubAllGlobals());
  /** A page (the status line is DOM, and only a page has one), through the gate as a player goes. */
  const page = () => vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const playing = async () => {
    page();
    const made = setup();
    Object.assign(made.lobby, { hosting: false, you: 'guest', me: guest });
    await made.session.init(); made.session.gate(vi.fn()); made.session.deploy();
    const world = made.session.world as unknown as { fedAt: number; team: { final: unknown } };
    world.fedAt = 0;
    const now = vi.spyOn(performance, 'now');
    /** Frames from `from` to `to`, 60 a second; while `fed` the host's pose and a snapshot arrive on each. */
    const frames = (from: number, to: number, fed: boolean) => {
      for (let ms = from; ms < to; ms += 1000 / 60) {
        now.mockReturnValue(ms);
        if (fed) { world.fedAt = ms; made.lobby.onPose('host', {} as never); }
        made.session.update();
      }
    };
    view.setLine.mockClear();
    const lines = () => view.setLine.mock.calls.map(c => c[0] as string);
    return { ...made, world, frames, lines, now };
  };

  it('fed, it says nothing; a second after the feed stops it says its connection is too slow; the first packet back clears it', async () => {
    const g = await playing();
    g.frames(1000, 4000, true);
    expect(g.lines().every(text => text === '')).toBe(true);
    // The host cuts it (or it is merely behind): snapshots and poses stop, the line itself still trickles.
    g.frames(4000, 4900, false);
    expect(g.lines()).not.toContain(TOO_SLOW);
    g.frames(4900, 17_000, false);
    expect(view.setLine).toHaveBeenLastCalledWith(TOO_SLOW, true);
    // The catch-up lands: the very next frame the line is gone.
    g.frames(17_000, 17_020, true);
    expect(view.setLine).toHaveBeenLastCalledWith('');
  });

  it('the host\'s list saying it is cut shows the same line (it arrives late, as the cut ends)', async () => {
    const g = await playing();
    g.lobby.me!.state = 'lost';
    g.frames(1000, 1100, true);
    expect(view.setLine).toHaveBeenLastCalledWith(TOO_SLOW, true);
    delete g.lobby.me!.state;
    g.frames(1100, 1200, true);
    expect(view.setLine).toHaveBeenLastCalledWith('');
  });

  it('a line that is down says Reconnecting, and silence that is no drought says nothing', async () => {
    const g = await playing();
    g.frames(1000, 2000, true);
    // The line is down: that is its own notice, with its countdown.
    Object.assign(g.lobby, { reconnecting: { until: 0 }, reconnectIn: 30 });
    g.frames(2000, 5000, false);
    expect(g.lines()).not.toContain(TOO_SLOW);
    expect(view.setLine).toHaveBeenLastCalledWith('Reconnecting to host… 30', true);
    Object.assign(g.lobby, { reconnecting: null });
    // The host's tab is hidden (the lobby says so in its own line, and the world runs coarser).
    g.frames(5000, 5100, true);
    host.idle = 'hidden';
    g.frames(5100, 9000, false);
    expect(g.lines()).not.toContain(TOO_SLOW);
    delete host.idle;
    // The host's page is loading its map (a reload): that is "Waiting for HOST", not this page's link.
    g.frames(9000, 9050, true);
    host.state = 'loading';
    g.frames(9050, 9060, false);
    g.frames(9060, 12_000, false);
    expect(g.lines()).not.toContain(TOO_SLOW);
    delete host.state;
    // The run is over: the board is up and the world may rest.
    g.frames(12_000, 12_100, true);
    g.world.team.final = [];
    g.frames(12_100, 16_000, false);
    expect(g.lines()).not.toContain(TOO_SLOW);
    g.world.team.final = null;
  });

  it('the host never says it of itself, and a guest whose own page stood still does not say it as it wakes', async () => {
    page();
    const h = setup(); await h.session.init(); h.session.gate(vi.fn()); h.session.deploy();
    const now = vi.spyOn(performance, 'now');
    view.setLine.mockClear();
    for (let ms = 1000; ms < 6000; ms += 16) { now.mockReturnValue(ms); h.session.update(); }
    expect(view.setLine.mock.calls.map(c => c[0])).not.toContain(TOO_SLOW);
    const g = await playing();
    g.frames(1000, 2000, true);
    // A minute with no frame at all (a hidden tab, a sleeping laptop), then one frame before anything new is read.
    g.now.mockReturnValue(62_000); g.session.update();
    expect(g.lines()).not.toContain(TOO_SLOW);
    g.frames(62_016, 62_200, true);
    expect(g.lines()).not.toContain(TOO_SLOW);
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
  it('a guest whose host is gone puts the board up from the cards it has, then regroups on the same code', async () => {
    // A page with a screen: the board is the session's own layer (sessionHud.ts).
    vi.stubGlobal('document', { hidden: false, addEventListener: () => {}, removeEventListener: () => {} });
    try {
      const { session, lobby, ended } = gated();
      const s = session as unknown as { code: string; password: string; world: { team: { roster(): unknown[] } } };
      s.code = 'ABC234'; s.password = 'pw';
      Object.assign(lobby, { away: vi.fn() });
      (session as unknown as { ctx: { waves: { wave: number } } }).ctx.waves = { wave: 4 };
      s.world.team.roster = () => [
        { name: 'HOST', color: '#fff', me: false, card: { kills: 9, score: 4000, credits: 300 } },
        { name: 'GUEST', color: '#0ff', me: true, card: { kills: 5, score: 2500, credits: 120 } },
      ];
      await session.init(); session.gate(() => {}); session.deploy();
      view.showLost.mockClear();
      const now = vi.spyOn(performance, 'now').mockReturnValue(50_000);
      // The grace ran out: the room closes under the match with the host gone.
      lobby.phase = 'closed'; lobby.error = 'host-left'; lobby.onChange();
      expect(view.showLost).toHaveBeenCalledOnce();
      const [headline, sub, rows] = view.showLost.mock.calls[0]!;
      expect(headline).toBe('HOST LOST');
      expect(sub).toMatch(/The host left\. The match ended on wave 4/);
      expect(rows).toEqual([
        { name: 'HOST', color: '#fff', me: false, kills: 9, score: 4000, credits: 300 },
        { name: 'GUEST', color: '#0ff', me: true, kills: 5, score: 2500, credits: 120 },
      ]);
      // The board stays for LOST_BOARD_MS with its countdown; nothing ends before then, and a second word changes nothing.
      expect(ended).not.toHaveBeenCalled();
      lobby.onChange();
      expect(view.showLost).toHaveBeenCalledOnce();
      now.mockReturnValue(50_000 + LOST_BOARD_MS - 1000); session.update();
      expect(view.setLostFoot).toHaveBeenLastCalledWith('You host the new lobby in 1');
      expect(ended).not.toHaveBeenCalled();
      now.mockReturnValue(50_000 + LOST_BOARD_MS + 10); session.update();
      // Then everyone meets again on the same code: this guest, the lowest slot left, hosts.
      expect(ended).toHaveBeenCalledOnce();
      expect(ended.mock.calls[0]![1]).toBeNull();
      expect(ended.mock.calls[0]![2]).toMatchObject({ code: 'ABC234', password: 'pw', rank: 0, names: ['GUEST'] });
      expect(ended.mock.calls[0]![0]).toMatch(/You are hosting this lobby now/);
    } finally { vi.unstubAllGlobals(); }
  });
  it('a lost connection to the host reads so on the board; before the deploy click there is no board, only the regroup', async () => {
    vi.stubGlobal('document', { hidden: false, addEventListener: () => {}, removeEventListener: () => {} });
    try {
      const { session, lobby, ended } = gated();
      const s = session as unknown as { code: string; password: string };
      s.code = 'ABC234'; s.password = 'pw';
      await session.init(); session.gate(() => {});
      view.showLost.mockClear();
      lobby.phase = 'closed'; lobby.error = 'lost'; lobby.onChange();
      expect(view.showLost).not.toHaveBeenCalled();
      expect(ended).toHaveBeenCalledOnce();
      expect(ended.mock.calls[0]![0]).toMatch(/Lost the connection to the host/);
      expect(ended.mock.calls[0]![2]).toMatchObject({ rank: 0 });
    } finally { vi.unstubAllGlobals(); }
  });
  it('a host that gave way to its regrouped team is sent to join their lobby, not to an error page', async () => {
    const { session, lobby } = setup();
    const s = session as unknown as { code: string; password: string };
    s.code = 'ABC234'; s.password = 'pw';
    Object.assign(lobby, { me: host, yieldedTo: 'ANNA' });
    const ended = vi.fn(); session.onEnded = ended;
    await session.init(); session.begin();
    lobby.phase = 'closed'; lobby.error = 'code-taken'; lobby.onChange();
    expect(ended).toHaveBeenCalledOnce();
    expect(ended.mock.calls[0]![1]).toBeNull();
    expect(ended.mock.calls[0]![2]).toMatchObject({ code: 'ABC234', password: 'pw', rank: 1, names: ['ANNA'], name: 'HOST' });
    expect(ended.mock.calls[0]![2].note).toMatch(/ANNA is hosting now/);
  });
  it('feeds seat events to the hooks with the stable seat, tells the same page back from a new one, and names the connections that are gone', async () => {
    const { session, lobby } = setup(); await session.init(); session.begin();
    const arrived = vi.fn(), lost = vi.fn(), gone = vi.fn(), forget = vi.fn();
    session.onArrived.add(arrived); session.onLost.add(lost); const off = session.onGone.add(gone); session.onForget.add(forget);
    const row: LobbyPlayer = { ...guest, seat: 's1' };
    lobby.onSeat(row, { kind: 'in', rejoin: false });
    expect(arrived).toHaveBeenLastCalledWith('guest', { seat: 's1', slot: 1, name: 'GUEST', rejoin: false, same: false });
    lobby.onSeat(row, { kind: 'lost' }); expect(lost).toHaveBeenCalledWith('guest', 's1');
    // The same connection back after a drop: the same page, which still holds its own world.
    lobby.onSeat(row, { kind: 'in', rejoin: true });
    expect(arrived).toHaveBeenLastCalledWith('guest', expect.objectContaining({ rejoin: true, same: true }));
    expect(forget).not.toHaveBeenCalled();
    // A new page of the same player: a new connection id, and the old one will never be heard again.
    lobby.onSeat({ ...row, id: 'guest-new' }, { kind: 'in', rejoin: true });
    expect(arrived).toHaveBeenLastCalledWith('guest-new', expect.objectContaining({ seat: 's1', rejoin: true, same: false }));
    expect(forget).toHaveBeenCalledExactlyOnceWith('guest');
    off(); lobby.onSeat({ ...row, id: 'guest-new' }, { kind: 'gone' });
    expect(gone).not.toHaveBeenCalled();
    expect(forget).toHaveBeenLastCalledWith('guest-new');
  });
});
