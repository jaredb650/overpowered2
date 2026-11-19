import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRoom, Hub } from './fakeHub';
import {
  BYE_FLUSH_MS, CLICK_WAIT_MS, HOST_WAIT_MS, LOADING_SEAT_MS, LOAD_WAIT_MS, Lobby, MATCH_HOST_WAIT_MS, PENDING_ERROR_MS, PING_MS, QUIET_MS, RECONNECT_MS, SEAT_GRACE_MS, SILENCE_MS,
  START_ACK_MS, type LobbyOptions, type SeatEvent,
} from './lobby';

/**
 * The life of a session, over the fake transport: the page a match is played on, seats, the load barrier, the reconnect
 * grace on both sides, and every timer rule around them (docs/notes/coop-audit-life.md, the session lane's findings).
 */
describe('the life of a co-op session', () => {
  let hub: Hub;
  let pages = 0;
  beforeEach(() => { vi.useFakeTimers(); hub = new Hub(); pages = 0; vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  const page = (hosting: boolean, name: string, browser: string, options: LobbyOptions = {}, password = 'pw') => {
    const id = `p${pages++}`;
    const lobby = new Lobby({ main: hub.open('ROOM', password, id), door: () => hub.open('ROOM-door', 'ROOM', id) }, hosting, name, 'b1', options);
    lobby.browser = browser;
    return Object.assign(lobby, { peer: id });
  };
  const peer = (lobby: Lobby) => (lobby as unknown as { peer: string }).peer;
  const tick = (ms: number) => { for (let left = ms; left > 0; left -= 500) { vi.advanceTimersByTime(Math.min(500, left)); hub.flush(); } };
  const lines = (lobby: Lobby) => lobby.chat.map(c => c.text);
  /** A lobby of a host and guests, everyone in, nobody ready. */
  const lobbyOf = (...guests: string[]) => {
    const h = page(true, 'HOST', 'bh');
    const gs = guests.map(name => page(false, name, `b-${name}`));
    hub.flush();
    return { h, gs };
  };
  /** The host's map page for `match`, built from the lobby page's handoff, as session.ts does. */
  const hostMapPage = (from: Lobby, match: string) => {
    const records = from.seatRecords();
    const h = page(true, 'HOST', 'bh', { page: match, roster: records.roster, seats: records.seats });
    h.startMatch('crucible', match);
    return h;
  };

  // --- Which page is talking (S3) ---

  it('three matches in a row: every map page ignores the host page that is leaving and takes only its own', () => {
    const { h, gs } = lobbyOf('ANNA', 'BEN');
    let a: Lobby = gs[0]!, b: Lobby = gs[1]!;
    let host: Lobby = h;
    for (const match of ['m1', 'm2', 'm3']) {
      // BEN's acknowledgement is slow: the host's old page is still there when ANNA's map page arrives.
      hub.mute(peer(host), peer(b));
      expect(host.startMatch('crucible', match)).toBe(true); hub.flush();
      expect(a.match?.id).toBe(match);
      const a2 = page(false, 'ANNA', 'b-ANNA', { page: match }); hub.flush();
      // The old page must not admit it, and it must not adopt the old page.
      expect(a2.phase).toBe('connecting');
      expect(host.players.filter(p => p.name === 'ANNA')).toHaveLength(1);
      // The slow guest's acknowledgement never comes: the host goes after START_ACK_MS.
      let hostDeploys = 0; host.onMatch = () => hostDeploys++;
      tick(START_ACK_MS + 100);
      expect(hostDeploys).toBe(1);
      const h2 = hostMapPage(host, match);
      a.leave(); b.leave(); host.leave();
      const b2 = page(false, 'BEN', 'b-BEN', { page: match }); hub.flush();
      expect(a2.phase).toBe('open'); expect(b2.phase).toBe('open');
      expect(a2.match?.id).toBe(match); expect(b2.match?.id).toBe(match);
      expect(h2.players.map(p => p.name)).toEqual(['HOST', 'ANNA', 'BEN']);
      // Everyone plays, the match ends, and the same three objects are the lobby for the next one.
      for (const p of [h2, a2, b2]) { p.booted(); p.deployed(); }
      hub.flush();
      expect(h2.live).toBe(true);
      h2.endMatch(); hub.flush();
      expect(a2.match).toBeNull(); expect(a2.page).toBeNull(); expect(h2.page).toBeNull();
      host = h2; a = a2; b = b2;
    }
  });

  it('a host that is on its way out says so in its hello, and a lobby page says nothing of the kind', () => {
    const { h, gs } = lobbyOf('ANNA');
    hub.mute(peer(h), peer(gs[0]!));
    h.startMatch('crucible', 'm1');
    // A page built for another match than the host's own is not taken for one of its guests either.
    const stray = page(false, 'STRAY', 'b-STRAY', { page: 'm1' }); hub.flush();
    expect(stray.phase).toBe('connecting');
    // A newcomer by invite link (a lobby page) is admitted by the leaving host and sent on to the match.
    const late = page(false, 'LATE', 'b-LATE');
    const sent = vi.fn(); late.onMatch = sent; hub.flush();
    expect(late.phase).toBe('open');
    expect(sent).toHaveBeenCalledWith({ id: 'm1', mode: 'crucible' });
  });

  // --- Seats (L3, L4, P3) ---

  it('slots and seats are the same in the lobby and in the match, whoever loads first', () => {
    const { h, gs } = lobbyOf('ANNA', 'BEN', 'CARL');
    const lobbySlots = Object.fromEntries(h.players.map(p => [p.name, [p.slot, p.seat]]));
    h.startMatch('crucible', 'm1'); hub.flush();
    const h2 = hostMapPage(h, 'm1');
    for (const p of [...gs, h]) p.leave();
    // The map pages arrive in the opposite order.
    const arrivals = ['CARL', 'BEN', 'ANNA'].map(name => page(false, name, `b-${name}`, { page: 'm1' }));
    hub.flush();
    expect(Object.fromEntries(h2.players.map(p => [p.name, [p.slot, p.seat]]))).toEqual(lobbySlots);
    for (const g of arrivals) expect(g.me?.slot).toBe(lobbySlots[g.me!.name]![0]);
    // And the next match keeps them again.
    h2.booted(); h2.deployed(); for (const g of arrivals) { g.booted(); g.deployed(); }
    hub.flush(); h2.endMatch(); hub.flush();
    expect(Object.fromEntries(h2.players.map(p => [p.name, [p.slot, p.seat]]))).toEqual(lobbySlots);
  });

  it('two players never share a callsign: the second is numbered, and stays so when renamed into a clash', () => {
    const h = page(true, 'VIPER-27', 'bh');
    const a = page(false, 'VIPER-27', 'ba');
    const b = page(false, 'VIPER-27', 'bb');
    hub.flush();
    expect(h.players.map(p => p.name)).toEqual(['VIPER-27', 'VIPER-27 (2)', 'VIPER-27 (3)']);
    expect(a.me?.name).toBe('VIPER-27 (2)');
    b.setName('GHOST'); hub.flush();
    a.setName('GHOST'); hub.flush();
    expect(h.players.map(p => p.name)).toEqual(['VIPER-27', 'GHOST (2)', 'GHOST']);
    // A long name still fits in the sixteen characters.
    const c = page(false, 'ABCDEFGHIJKLMNOP', 'bc'); hub.flush();
    c.setName('ABCDEFGHIJKLMNOP'); h.setName('ABCDEFGHIJKLMNOP'); hub.flush();
    expect(new Set(h.players.map(p => p.name)).size).toBe(4);
    expect(h.players.every(p => p.name.length <= 16)).toBe(true);
  });

  // --- The load barrier (A1/E1, S1, S2) ---

  const startedMatch = (...guests: string[]) => {
    const { h, gs } = lobbyOf(...guests);
    h.startMatch('crucible', 'm1'); hub.flush();
    const h2 = hostMapPage(h, 'm1');
    for (const p of [...gs, h]) p.leave();
    hub.flush();
    const go = vi.fn(); h2.onGo = go;
    const seat = vi.fn<(name: string, event: SeatEvent) => void>(); h2.onSeat = (p, e) => seat(p.name, e);
    return { h: h2, go, seat };
  };
  const mapPage = (name: string) => page(false, name, `b-${name}`, { page: 'm1' });

  it('the host knows who is coming before they connect, and its world waits for every one of them', () => {
    const { h, go, seat } = startedMatch('ANNA', 'BEN');
    expect(h.waitingFor.map(p => [p.name, p.state])).toEqual([['HOST', 'loading'], ['ANNA', 'loading'], ['BEN', 'loading']]);
    h.booted(); h.deployed(); hub.flush();
    expect(h.live).toBe(false); expect(go).not.toHaveBeenCalled();
    expect(h.waitingFor.map(p => p.name)).toEqual(['ANNA', 'BEN']);
    const a = mapPage('ANNA'); hub.flush();
    a.booted(); hub.flush();
    expect(h.players.find(p => p.name === 'ANNA')?.state).toBe('ready');
    a.deployed(); hub.flush();
    expect(h.live).toBe(false);
    expect(a.live).toBe(false); expect(a.waitingFor.map(p => p.name)).toEqual(['BEN']);
    expect(a.holdLeft).toBeGreaterThan(0);
    const b = mapPage('BEN'); hub.flush();
    const guestGo = vi.fn(); a.onGo = guestGo;
    b.booted(); b.deployed(); hub.flush();
    expect(h.live).toBe(true); expect(go).toHaveBeenCalledOnce();
    expect(a.live).toBe(true); expect(guestGo).toHaveBeenCalledOnce();
    expect(seat.mock.calls).toEqual([['ANNA', { kind: 'in', rejoin: false }], ['BEN', { kind: 'in', rejoin: false }]]);
    // Nobody was "joined" or "left" on the way: the players who started the match are not news.
    expect(lines(h).filter(t => /joined|left|lost/.test(t))).toEqual([]);
  });

  it('a host alone starts at once, and nothing is live before the host itself has clicked', () => {
    const { h, go } = startedMatch();
    tick(LOAD_WAIT_MS * 2);
    expect(go).not.toHaveBeenCalled();
    h.booted(); expect(go).not.toHaveBeenCalled();
    h.deployed(); expect(go).toHaveBeenCalledOnce(); expect(h.live).toBe(true);
  });

  it('a guest that never arrives is given up on after LOAD_WAIT_MS, by name, and is a late joiner when it comes', () => {
    const { h, go, seat } = startedMatch('ANNA', 'BEN');
    const a = mapPage('ANNA'); hub.flush();
    h.booted(); h.deployed(); a.booted(); a.deployed(); hub.flush();
    tick(LOAD_WAIT_MS - 2000);
    expect(go).not.toHaveBeenCalled();
    expect(a.holdLeft).toBeGreaterThan(0); expect(a.holdLeft).toBeLessThanOrEqual(3);
    tick(3000);
    expect(go).toHaveBeenCalledOnce();
    expect(lines(a).at(-1)).toBe('Started without BEN: not in yet. They join when they arrive.');
    // BEN's page finally loads: the same seat, and now it is news.
    const b = mapPage('BEN'); hub.flush();
    expect(b.live).toBe(true);
    b.booted(); b.deployed(); hub.flush();
    expect(h.players.find(p => p.name === 'BEN')).toMatchObject({ slot: 2, away: false });
    expect(lines(a).at(-1)).toBe('BEN joined.');
    expect(seat).toHaveBeenLastCalledWith('BEN', { kind: 'in', rejoin: false });
  });

  it('a player sitting at "Click to deploy" holds the start for CLICK_WAIT_MS only', () => {
    const { h, go } = startedMatch('ANNA');
    const a = mapPage('ANNA'); hub.flush();
    h.booted(); h.deployed(); a.booted(); hub.flush();
    tick(CLICK_WAIT_MS - 2000);
    expect(go).not.toHaveBeenCalled();
    tick(3000);
    expect(go).toHaveBeenCalledOnce();
  });

  it('the barrier clock starts with the host: a booted guest is not timed out while the host has not clicked', () => {
    const second = startedMatch('ANNA');
    const a2 = mapPage('ANNA'); hub.flush();
    second.h.booted(); a2.booted(); hub.flush();
    tick(CLICK_WAIT_MS * 3);
    expect(second.go).not.toHaveBeenCalled();
    second.h.deployed(); hub.flush();
    tick(CLICK_WAIT_MS + 1000);
    expect(second.go).toHaveBeenCalledOnce();
  });

  it('a page busy loading its map is not judged by the liveness rules, on either side', () => {
    const { h } = startedMatch('ANNA');
    h.booted(); h.deployed();
    const a = mapPage('ANNA'); hub.flush();
    expect(a.phase).toBe('open');
    // ANNA's page is deep in its boot: nothing from it reaches the host, and it reads nothing, for longer than SILENCE_MS.
    hub.mute(peer(h), peer(a));
    tick(SILENCE_MS + QUIET_MS + RECONNECT_MS + 5000);
    expect(a.phase).toBe('open'); expect(a.reconnecting).toBeNull();
    expect(h.players.find(p => p.name === 'ANNA')).toMatchObject({ state: 'loading' });
    expect(lines(h).filter(t => /lost|left/.test(t))).toEqual([]);
    hub.unmute(peer(h), peer(a));
    a.booted(); a.deployed(); hub.flush();
    expect(h.players.find(p => p.name === 'ANNA')?.away).toBe(false);
  });

  it('a map page waits longer for its host than a lobby page does, and a booted guest forgives a host still loading', () => {
    const lone = page(false, 'ANNA', 'ba', { page: 'm1' });
    tick(HOST_WAIT_MS + 1000);
    expect(lone.phase).toBe('connecting');
    tick(MATCH_HOST_WAIT_MS - HOST_WAIT_MS);
    expect(lone.error).toBe('no-host');
    // The host's page is loading (its row says so): a guest already booted does not call that silence.
    const { h } = startedMatch('BEN');
    const b = mapPage('BEN'); hub.flush(); b.booted(); hub.flush();
    hub.mute(peer(h), peer(b));
    tick(QUIET_MS * 3);
    expect(b.reconnecting).toBeNull();
  });

  it('a seat nobody ever connected to is dropped after LOADING_SEAT_MS, and a lost one never holds the start', () => {
    const { h, go } = startedMatch('ANNA', 'BEN');
    const a = mapPage('ANNA'); hub.flush();
    h.booted(); h.deployed(); a.booted(); a.deployed(); hub.flush();
    // ANNA drops for good while everyone waits for BEN.
    hub.sever(peer(h), peer(a)); hub.flush();
    expect(h.players.find(p => p.name === 'ANNA')?.state).toBe('lost');
    tick(LOAD_WAIT_MS + 1000);
    expect(go).toHaveBeenCalledOnce();
    tick(LOADING_SEAT_MS);
    expect(h.players.map(p => p.name)).toEqual(['HOST']);
  });

  // --- Start acknowledgements (L6, S6, S7) ---

  it('a guest that never acknowledges the start holds the host for START_ACK_MS, not for ever, and is named meanwhile', () => {
    const { h, gs } = lobbyOf('ANNA', 'BEN');
    hub.mute(peer(h), peer(gs[1]!));
    const deploy = vi.fn(); h.onMatch = deploy;
    h.startMatch('crucible', 'm1'); hub.flush();
    expect(deploy).not.toHaveBeenCalled();
    expect(h.slowToStart.map(p => p.name)).toEqual(['BEN']);
    tick(START_ACK_MS - 500);
    expect(deploy).not.toHaveBeenCalled();
    tick(1000);
    expect(deploy).toHaveBeenCalledOnce();
    expect(h.slowToStart).toEqual([]);
    // BEN is still in the roster the map page waits for.
    expect(h.seatRecords().roster.map(r => r.name)).toEqual(['ANNA', 'BEN']);
  });

  it('a host that cannot carry the match over sends nobody off, and says why', () => {
    const { h, gs } = lobbyOf('ANNA');
    h.canStart = () => 'Co-op needs tab storage.';
    const sent = vi.fn(); gs[0]!.onMatch = sent;
    expect(h.startMatch('crucible', 'm1')).toBe(false); hub.flush();
    expect(h.match).toBeNull(); expect(sent).not.toHaveBeenCalled();
    expect(lines(gs[0]!).at(-1)).toBe('Co-op needs tab storage.');
  });

  // --- A match that ends or changes while a guest loads (S5) ---

  it('a guest still loading hears that the match ended, even when the end itself was missed, and follows a new match', () => {
    const { h } = startedMatch('ANNA');
    h.booted(); h.deployed();
    const a = mapPage('ANNA');
    const ended = vi.fn(); a.onEnd = ended;
    hub.flush();
    expect(a.match?.id).toBe('m1');
    h.endMatch(); hub.flush();
    expect(ended).toHaveBeenCalledOnce(); expect(a.match).toBeNull(); expect(a.page).toBeNull();
    // A page that reloads into a match already over: the host's list says there is none.
    const late = mapPage('BEN'); const lateEnded = vi.fn(); late.onEnd = lateEnded; hub.flush();
    expect(late.phase).toBe('open'); expect(lateEnded).toHaveBeenCalledOnce(); expect(late.page).toBeNull();
    // The host starts another: the guest's loader is told which, and it is not the one its page was built for.
    const next = vi.fn(); a.onMatch = next;
    h.startMatch('outpost', 'm2'); hub.flush();
    expect(next).toHaveBeenCalledWith({ id: 'm2', mode: 'outpost' });
    // The same start again changes nothing.
    hub.deliver((h as unknown as { room: FakeRoom }).room, 'lobby', { t: 'start', match: { id: 'm2', mode: 'outpost' } }, peer(a)); hub.flush();
    expect(next).toHaveBeenCalledOnce();
  });

  it('a host whose page reloaded opens a new match, and its guests are told to follow it', () => {
    const { h } = startedMatch('ANNA');
    const a = mapPage('ANNA'); hub.flush();
    h.booted(); h.deployed(); a.booted(); a.deployed(); hub.flush();
    const next = vi.fn(); a.onMatch = next;
    // The host's page goes (a reload): its guest waits instead of ending.
    const records = h.seatRecords();
    hub.sever(peer(h), peer(a)); hub.flush();
    expect(a.phase).toBe('open'); expect(a.reconnecting?.reason).toBe('host-left');
    const h2 = page(true, 'HOST', 'bh', { page: 'm1-again', roster: records.roster, seats: records.seats });
    h2.startMatch('crucible', 'm1-again'); hub.flush();
    expect(a.reconnecting).toBeNull();
    expect(next).toHaveBeenCalledWith({ id: 'm1-again', mode: 'crucible' });
    expect(h2.players.map(p => [p.name, p.slot])).toEqual([['HOST', 0], ['ANNA', 1]]);
  });

  // --- A network blip is not the end (M1, M6, M11) ---

  const playing = (...guests: string[]) => {
    const s = startedMatch(...guests);
    const gs = guests.map(mapPage); hub.flush();
    s.h.booted(); s.h.deployed();
    for (const g of gs) { g.booted(); g.deployed(); }
    hub.flush();
    s.seat.mockClear();
    return { ...s, gs };
  };

  it('a silent link: the guest shows "reconnecting" and both carry on when it comes back', () => {
    const { h, gs } = playing('ANNA');
    const [a] = gs as unknown as [Lobby, Lobby, Lobby];
    hub.mute(peer(h), peer(a));
    tick(QUIET_MS + PING_MS + 500);
    expect(a.reconnecting?.reason).toBe('lost'); expect(a.phase).toBe('open');
    expect(a.reconnectIn).toBeGreaterThan(20);
    // Eight seconds in all, well inside both graces: nobody is dropped.
    expect(h.players.find(p => p.name === 'ANNA')?.state).toBeUndefined();
    hub.unmute(peer(h), peer(a));
    tick(PING_MS + 500);
    expect(a.reconnecting).toBeNull(); expect(a.phase).toBe('open');
    expect(h.players.find(p => p.name === 'ANNA')).toMatchObject({ away: false });
    expect(lines(h).filter(t => /lost|left/.test(t))).toEqual([]);
  });

  it('a dropped link: the host keeps the seat, the guest waits, and the same page comes back in as a rejoin', () => {
    const { h, seat, gs } = playing('ANNA', 'BEN');
    const [a, b] = gs as unknown as [Lobby, Lobby, Lobby];
    const slot = a.me!.slot;
    hub.sever(peer(h), peer(a)); hub.flush();
    expect(a.phase).toBe('open'); expect(a.reconnecting?.reason).toBe('host-left');
    expect(h.players.find(p => p.name === 'ANNA')).toMatchObject({ state: 'lost', away: true, slot });
    expect(seat).toHaveBeenLastCalledWith('ANNA', { kind: 'lost' });
    expect(lines(b).at(-1)).toBe('ANNA lost connection.');
    // Twelve seconds later the transport finds the peer again, under the same id.
    tick(12_000);
    hub.mend(peer(h), peer(a)); hub.flush();
    tick(1500);
    expect(a.reconnecting).toBeNull();
    expect(h.players.find(p => p.name === 'ANNA')).toMatchObject({ away: false, slot });
    expect(h.players.find(p => p.name === 'ANNA')?.state).toBeUndefined();
    expect(seat).toHaveBeenLastCalledWith('ANNA', { kind: 'in', rejoin: true });
    expect(lines(b).at(-1)).toBe('ANNA is back.');
    expect(a.match?.id).toBe('m1');
  });

  it('a guest that reloads mid-match takes its own seat back on the new page', () => {
    const { h, seat, gs } = playing('ANNA', 'BEN');
    const [a] = gs as unknown as [Lobby, Lobby, Lobby];
    const before = h.players.find(p => p.name === 'ANNA')!;
    const kept = [before.slot, before.seat];
    // The old page goes without a word (a reload), the new one says hello with the same browser id.
    hub.sever(peer(h), peer(a)); (a as unknown as { room: FakeRoom }).room.leave(); hub.flush();
    const a2 = mapPage('ANNA'); hub.flush();
    expect(a2.match?.id).toBe('m1'); expect(a2.live).toBe(true);
    a2.booted(); a2.deployed(); hub.flush();
    const now = h.players.find(p => p.name === 'ANNA')!;
    expect([now.slot, now.seat]).toEqual(kept);
    expect(now).toMatchObject({ away: false, id: a2.you });
    expect(h.players).toHaveLength(3);
    expect(seat).toHaveBeenLastCalledWith('ANNA', { kind: 'in', rejoin: true });
    expect(lines(h).filter(t => /ANNA/.test(t))).toEqual(['ANNA lost connection.', 'ANNA is back.']);
  });

  it('the host gives a lost seat up after SEAT_GRACE_MS, and a guest gives the host up after RECONNECT_MS', () => {
    const { h, seat, gs } = playing('ANNA');
    const [a] = gs as unknown as [Lobby, Lobby, Lobby];
    hub.sever(peer(h), peer(a)); hub.flush();
    tick(RECONNECT_MS - 2000);
    expect(a.phase).toBe('open');
    tick(4000);
    expect(a.phase).toBe('closed'); expect(a.error).toBe('host-left');
    expect(h.players).toHaveLength(2);
    tick(SEAT_GRACE_MS - RECONNECT_MS);
    expect(h.players).toHaveLength(1);
    expect(seat).toHaveBeenLastCalledWith('ANNA', { kind: 'gone' });
    expect(lines(h).slice(-2)).toEqual(['ANNA lost connection.', 'ANNA left.']);
  });

  it('a link that is silent for longer than SILENCE_MS loses the seat, and the first word from it brings it back', () => {
    const { h, seat, gs } = playing('ANNA');
    const [a] = gs as unknown as [Lobby, Lobby, Lobby];
    hub.mute(peer(h), peer(a));
    tick(SILENCE_MS + PING_MS + 500);
    expect(h.players.find(p => p.name === 'ANNA')?.state).toBe('lost');
    expect(a.phase).toBe('open'); expect(a.reconnecting).not.toBeNull();
    hub.unmute(peer(h), peer(a));
    tick(PING_MS * 2 + 1500);
    expect(a.reconnecting).toBeNull();
    expect(h.players.find(p => p.name === 'ANNA')?.state).toBeUndefined();
    expect(seat).toHaveBeenLastCalledWith('ANNA', { kind: 'in', rejoin: true });
  });

  it('a deliberate quit reads "left" at once on both sides: no grace, no countdown', () => {
    const { h, seat, gs } = playing('ANNA', 'BEN');
    const [a, b] = gs as unknown as [Lobby, Lobby, Lobby];
    a.leave(); hub.flush();
    expect(h.players.map(p => p.name)).toEqual(['HOST', 'BEN']);
    expect(lines(b).at(-1)).toBe('ANNA left.');
    expect(seat).toHaveBeenLastCalledWith('ANNA', { kind: 'gone' });
    // The room itself stays up a moment so the goodbye gets out on a slow link, then closes; nothing more is said.
    expect((a as unknown as { room: FakeRoom }).room.closed).toBe(false);
    tick(BYE_FLUSH_MS + 100);
    expect((a as unknown as { room: FakeRoom }).room.closed).toBe(true);
    expect(lines(b).filter(t => /ANNA/.test(t))).toEqual(['ANNA left.']);
    h.leave(); hub.flush();
    expect(b.phase).toBe('closed'); expect(b.error).toBe('host-left');
  });

  it('a stalled page forgives the silence it caused itself', () => {
    const { h, gs } = playing('ANNA');
    const [a] = gs as unknown as [Lobby, Lobby, Lobby];
    // The guest's page stands still for 40 s (a closed lid): its timers do not run, and its first heartbeat after runs
    // before it has read the pings that queued up.
    vi.setSystemTime(Date.now() + 40_000);
    a.heartbeat(performance.now());
    expect(a.phase).toBe('open'); expect(a.reconnecting).toBeNull();
    // The same for the host's page.
    vi.setSystemTime(Date.now() + 40_000);
    h.heartbeat(performance.now());
    expect(h.players.find(p => p.name === 'ANNA')?.state).toBeUndefined();
    // And real silence after that is still noticed.
    hub.mute(peer(h), peer(a));
    tick(QUIET_MS + PING_MS + 500);
    expect(a.reconnecting).not.toBeNull();
  });

  it('a player who stepped out to the lobby page is not pulled back in by a reconnect, and returns as "is back"', () => {
    const { h, seat, gs } = playing('ANNA');
    const [a] = gs as unknown as [Lobby, Lobby, Lobby];
    a.away(false); hub.flush();
    const pulled = vi.fn(); a.onMatch = pulled;
    hub.sever(peer(h), peer(a)); hub.flush();
    tick(3000);
    hub.mend(peer(h), peer(a)); hub.flush(); tick(1500);
    expect(pulled).not.toHaveBeenCalled();
    expect(h.players.find(p => p.name === 'ANNA')).toMatchObject({ away: true });
    expect(h.players.find(p => p.name === 'ANNA')?.state).toBeUndefined();
    expect(a.awayFrom?.id).toBe('m1');
    // Rejoin match: a new page, the same seat.
    a.away(true); hub.flush();
    expect(pulled).toHaveBeenCalledOnce();
    expect(h.players.find(p => p.name === 'ANNA')?.state).toBe('loading');
    hub.sever(peer(h), peer(a)); (a as unknown as { room: FakeRoom }).room.leave(); hub.flush();
    const a2 = mapPage('ANNA'); hub.flush(); a2.booted(); a2.deployed(); hub.flush();
    expect(seat).toHaveBeenLastCalledWith('ANNA', { kind: 'in', rejoin: true });
    expect(lines(h).filter(t => /ANNA/.test(t))).toEqual(['ANNA went back to the lobby.', 'ANNA lost connection.', 'ANNA reconnected.', 'ANNA is back.']);
  });

  it('a late joiner is announced once as joining and once as joined, with nothing in between', () => {
    const { h, seat, gs } = playing('ANNA');
    const [a] = gs as unknown as [Lobby, Lobby, Lobby];
    const before = lines(a).length;
    // By invite link: a lobby page first, which the host sends on to the match.
    const lobbyPage = page(false, 'CARL', 'b-CARL');
    const sent = vi.fn(); lobbyPage.onMatch = sent; hub.flush();
    expect(sent).toHaveBeenCalledWith({ id: 'm1', mode: 'crucible' });
    hub.sever(peer(h), peer(lobbyPage)); (lobbyPage as unknown as { room: FakeRoom }).room.leave(); hub.flush();
    const c = mapPage('CARL'); hub.flush(); c.booted(); c.deployed(); hub.flush();
    expect(lines(a).slice(before)).toEqual(['CARL is joining…', 'CARL joined.']);
    expect(seat).toHaveBeenLastCalledWith('CARL', { kind: 'in', rejoin: false });
    expect(h.players.find(p => p.name === 'CARL')).toMatchObject({ slot: 2, away: false });
  });

  it("a lost player's seat never keeps a live one out of a full lobby", () => {
    const { h, gs } = lobbyOf('ANNA', 'BEN', 'CARL');
    hub.sever(peer(h), peer(gs[0]!)); hub.flush();
    expect(h.players).toHaveLength(4);
    const d = page(false, 'DORA', 'b-DORA'); hub.flush();
    expect(d.phase).toBe('open');
    expect(h.players.map(p => p.name)).toEqual(['HOST', 'BEN', 'CARL', 'DORA']);
    // With four really there, the fifth is still told at once.
    const e = page(false, 'ERIC', 'b-ERIC'); hub.flush();
    expect(e.error).toBe('full');
  });

  it('a player under a menu or in a hidden tab is listed so, for the tag over their body', () => {
    const { h, gs } = playing('ANNA', 'BEN');
    const [a, b] = gs as unknown as [Lobby, Lobby, Lobby];
    a.setIdle('menu'); hub.flush();
    expect(h.players.find(p => p.name === 'ANNA')?.idle).toBe('menu');
    expect(b.players.find(p => p.name === 'ANNA')?.idle).toBe('menu');
    a.setIdle(undefined); h.setIdle('hidden'); hub.flush();
    expect(b.players.map(p => p.idle)).toEqual(['hidden', undefined, undefined]);
    // Junk from a guest is not passed on.
    hub.deliver((a as unknown as { room: FakeRoom }).room, 'lobby', { t: 'set', name: 'ANNA', ready: false, idle: '<b>' }, peer(h)); hub.flush();
    expect(h.players.find(p => p.name === 'ANNA')?.idle).toBeUndefined();
  });

  // --- Other peers' errors (L2, L8) ---

  it("a joining guest is not closed by another peer's failed connection or wrong password", () => {
    const { h } = lobbyOf('ANNA');
    const typo = page(false, 'TYPO', 'b-TYPO', {}, 'wrong');
    const c = page(false, 'CARL', 'b-CARL');
    const room = (c as unknown as { room: FakeRoom }).room;
    // Before the host's hello arrives, the mesh reports two failures that are not about the host.
    room.fail('connect', 'p1');
    room.fail('password', peer(typo));
    expect(c.phase).toBe('connecting');
    hub.flush();
    expect(c.phase).toBe('open'); expect(c.error).toBeNull();
    expect(h.players.map(p => p.name)).toEqual(['HOST', 'ANNA', 'CARL']);
    // The player with the wrong password is told so, through the door.
    expect(typo.error).toBe('password');
  });

  it("the host's own failure closes a join at once; an unattributed one only when nothing else is still coming", () => {
    // Nobody else in the room, nobody at the door: the join waits a little, then gives the only reason it has.
    const g = page(false, 'ANNA', 'ba');
    (g as unknown as { room: FakeRoom }).room.fail('connect', 'someone');
    hub.flush();
    expect(g.phase).toBe('connecting');
    tick(PENDING_ERROR_MS + 500);
    expect(g.error).toBe('connect');
    // With a host at the door, the host's own failure is known for what it is, at once.
    page(true, 'HOST', 'bh');
    const g2 = page(false, 'BEN', 'bb', {}, 'wrong'); hub.flush();
    expect(g2.error).toBe('password');
  });

  it('a host that connects but never says hello is "not answering", not "lobby not found"', () => {
    const g = page(false, 'ANNA', 'ba');
    hub.later(() => (g as unknown as { room: FakeRoom }).room.joined('frozen-host'));
    hub.flush();
    tick(HOST_WAIT_MS + 500);
    expect(g.error).toBe('no-answer');
  });

  // --- Host loss (H1) ---

  it('after the host is gone the survivors agree who hosts next: the lowest slot still there', () => {
    const { h, gs } = playing('ANNA', 'BEN', 'CARL');
    const [a, b, c] = gs as unknown as [Lobby, Lobby, Lobby];
    // ANNA has already dropped: she is not in the line.
    hub.sever(peer(h), peer(a)); hub.flush();
    expect(b.successors()).toEqual({ rank: 0, names: ['BEN', 'CARL'] });
    expect(c.successors()).toEqual({ rank: 1, names: ['BEN', 'CARL'] });
    hub.sever(peer(h), peer(b)); hub.sever(peer(h), peer(c)); hub.flush();
    tick(RECONNECT_MS + PING_MS + 500);
    expect(b.error).toBe('host-left'); expect(c.error).toBe('host-left');
    // The list they agreed on is the last one the host sent, and it survives the close.
    expect(b.successors().names).toEqual(['BEN', 'CARL']);
  });

  // --- One room, one host (a host back after its guests gave it up) ---

  const roomOf = (lobby: Lobby) => (lobby as unknown as { room: FakeRoom }).room;
  /** The guests give the host up and regroup: ANNA hosts a new lobby on the code, the others join it. */
  const regrouped = (...joiners: string[]) => {
    const a = page(true, 'ANNA', 'b-ANNA');
    const rest = joiners.map(name => page(false, name, `b-${name}`));
    hub.flush();
    return { a, rest };
  };

  it('a host whose page reloaded for longer than its guests waited finds them regrouped, gives way, and is named who to join', () => {
    const { h, gs } = playing('ANNA', 'BEN');
    const records = h.seatRecords();
    // The host's page is gone for good as far as its guests can tell: they wait out the grace and close.
    for (const g of gs) hub.sever(peer(h), peer(g));
    hub.flush(); roomOf(h).leave();
    tick(RECONNECT_MS + PING_MS + 500);
    expect(gs.map(g => g.error)).toEqual(['host-left', 'host-left']);
    const { a, rest: [b] } = regrouped('BEN');
    expect(a.players.map(p => p.name)).toEqual(['ANNA', 'BEN']);
    // Now the old host's new map page comes up, hosting a new match of the same mode for a roster that has moved on.
    const h2 = page(true, 'HOST', 'bh', { page: 'm1-again', roster: records.roster, seats: records.seats });
    h2.startMatch('crucible', 'm1-again'); hub.flush();
    expect(h2.phase).toBe('closed'); expect(h2.error).toBe('code-taken'); expect(h2.yieldedTo).toBe('ANNA');
    // The regrouped lobby is untouched: one host, and nobody followed the old host's start.
    expect(a.phase).toBe('open'); expect(a.match).toBeNull();
    expect(b!.phase).toBe('open'); expect(b!.match).toBeNull();
    expect(b!.players.map(p => p.name)).toEqual(['ANNA', 'BEN']);
    // And it walks in as a guest of the room it used to host.
    const h3 = page(false, 'HOST', 'bh'); hub.flush();
    expect(h3.phase).toBe('open');
    expect(a.players.map(p => p.name)).toEqual(['ANNA', 'BEN', 'HOST']);
  });

  it('of two hosts with nobody connected the newer gives way, whichever of them is the returning one', () => {
    // The regrouped lobby is older: the returning host gives way.
    const a = page(true, 'ANNA', 'b-ANNA'); hub.flush();
    vi.advanceTimersByTime(50);
    const h2 = page(true, 'HOST', 'bh', { page: 'm2' }); h2.startMatch('crucible', 'm2'); hub.flush();
    expect(h2.error).toBe('code-taken'); expect(a.phase).toBe('open');
    a.leave(); hub.flush();
    // The returning host's page was up first (its guests were still looking at the board): the new, empty lobby gives way,
    // and its player joins the match the old host is starting.
    const h3 = page(true, 'HOST', 'bh', { page: 'm3' }); h3.startMatch('crucible', 'm3'); hub.flush();
    vi.advanceTimersByTime(50);
    const a2 = page(true, 'ANNA', 'b-ANNA'); hub.flush();
    expect(a2.error).toBe('code-taken'); expect(a2.yieldedTo).toBe('HOST');
    expect(h3.phase).toBe('open');
    const next = vi.fn();
    const a3 = page(false, 'ANNA', 'b-ANNA'); a3.onMatch = next; hub.flush();
    expect(next).toHaveBeenCalledWith({ id: 'm3', mode: 'crucible' });
  });

  it('a host with players never gives way: a new, empty lobby on the code of a match being played goes, and the match is not disturbed', () => {
    const { h, gs } = playing('CARL');
    vi.advanceTimersByTime(50);
    const stray = page(true, 'ANNA', 'b-ANNA'); hub.flush();
    expect(stray.error).toBe('code-taken'); expect(stray.yieldedTo).toBe('HOST');
    expect(h.phase).toBe('open'); expect(gs[0]!.phase).toBe('open'); expect(h.players).toHaveLength(2);
    expect(h.match?.id).toBe('m1'); expect(gs[0]!.match?.id).toBe('m1');
  });

  it('two hosts that both believe they are alone settle it on the next heartbeat, when each says again how many it has', () => {
    const old = page(true, 'HOST', 'bh', { page: 'm5' }); old.startMatch('crucible', 'm5');
    vi.advanceTimersByTime(50);
    const a = page(true, 'ANNA', 'b-ANNA');
    hub.mute(peer(old), peer(a));
    hub.flush();
    // ANNA's lobby gains a player the old host cannot see (BEN is connected to ANNA only).
    const players = (a as unknown as { players: { id: string; name: string; ready: boolean; host: boolean; slot: number; seat: string }[] }).players;
    players.push({ id: 'ben-peer', name: 'BEN', ready: false, host: false, slot: 1, seat: 's1' });
    hub.unmute(peer(old), peer(a));
    const born = (lobby: Lobby) => (lobby as unknown as { born: number }).born;
    // Hellos that crossed while ANNA was still alone: the old host is older, ANNA has a player now, so neither gives way.
    hub.deliver(roomOf(a), 'lobby', { t: 'hello', v: 'b1', name: 'ANNA', host: true, page: null, match: null, born: born(a), browser: 'b-ANNA', n: 0 }, peer(old));
    hub.deliver(roomOf(old), 'lobby', { t: 'hello', v: 'b1', name: 'HOST', host: true, page: 'm5', match: 'm5', born: born(old), browser: 'bh', n: 0 }, peer(a));
    hub.flush();
    expect(old.phase).toBe('open'); expect(a.phase).toBe('open');
    // The heartbeat says it again, with the count of now.
    tick(PING_MS + 200);
    expect(old.error).toBe('code-taken'); expect(old.yieldedTo).toBe('ANNA');
    expect(a.phase).toBe('open');
  });

  it('a guest whose link is in trouble takes back only the host it knew, by its browser, never whoever else says "host"', () => {
    const { h, gs } = playing('ANNA');
    const [a] = gs as unknown as [Lobby];
    const records = h.seatRecords();
    hub.sever(peer(h), peer(a)); hub.flush(); roomOf(h).leave(); hub.flush();
    expect(a.reconnecting?.reason).toBe('host-left');
    // Someone else opens a lobby on the code while ANNA waits: not her host.
    const stranger = page(true, 'MALLORY', 'bx'); hub.flush();
    expect(a.reconnecting).not.toBeNull();
    expect(stranger.players.map(p => p.name)).toContain('ANNA');
    expect(a.players.some(p => p.name === 'MALLORY')).toBe(false);
    stranger.leave(); hub.flush();
    // Her own host's new page: taken back at once.
    const next = vi.fn(); a.onMatch = next;
    const h2 = page(true, 'HOST', 'bh', { page: 'm1-again', roster: records.roster, seats: records.seats });
    h2.startMatch('crucible', 'm1-again'); hub.flush();
    expect(a.reconnecting).toBeNull();
    expect(next).toHaveBeenCalledWith({ id: 'm1-again', mode: 'crucible' });
  });

  // --- A reload on the lobby page, between matches ---

  it('a host that reloads its lobby page opens the room again with the same seats, and its guests take it back without leaving', () => {
    const { h, gs } = lobbyOf('ANNA', 'BEN');
    const [a, b] = gs as unknown as [Lobby, Lobby];
    a.setReady(true); hub.flush();
    const before = h.players.map(p => [p.name, p.slot, p.seat]);
    const { seats, slots } = h.seatRecords();
    // The page goes without a goodbye, as a reload does.
    roomOf(h).leave(); hub.flush();
    expect(a.phase).toBe('open'); expect(a.reconnecting?.reason).toBe('host-left');
    expect(b.reconnecting?.reason).toBe('host-left');
    tick(4000);
    // BEN's page reaches the host's new page before ANNA's does: he must not take her slot for it.
    hub.mute('p3', peer(a));
    const h2 = page(true, 'HOST', 'bh', { seats, slots }); hub.flush();
    expect(h2.players.map(p => p.name)).toEqual(['HOST', 'BEN']);
    hub.mend(peer(h2), peer(a)); hub.flush();
    tick(PING_MS + 200);
    for (const [name, slot] of before) expect(h2.players.find(p => p.name === name)?.slot).toBe(slot);
    expect(a.reconnecting).toBeNull(); expect(b.reconnecting).toBeNull();
    expect(a.phase).toBe('open'); expect(b.phase).toBe('open');
    // Everyone is listed again, each in the seat they had; who was ready still is.
    const seatOf = (name: string) => h2.players.find(p => p.name === name)?.seat;
    for (const [name, , seat] of before) expect(seatOf(name as string)).toBe(seat);
    expect(h2.players.find(p => p.name === 'ANNA')?.ready).toBe(true);
    expect(a.players.map(p => p.name).sort()).toEqual(['ANNA', 'BEN', 'HOST']);
    // And the room works: the host can start a match from it.
    for (const g of gs) g.setReady(true);
    hub.flush();
    const started = vi.fn(); a.onMatch = started;
    expect(h2.startMatch('crucible', 'm9')).toBe(true); hub.flush();
    expect(started).toHaveBeenCalledWith({ id: 'm9', mode: 'crucible' });
  });

  it('a player with cheats on is tagged in everyone\'s list, the host and a guest alike, and untagged when they go off', () => {
    const { h, gs } = lobbyOf('ANNA', 'BEN');
    const [a, b] = gs as unknown as [Lobby, Lobby];
    const tagged = (lobby: Lobby) => lobby.players.filter(p => p.cheats).map(p => p.name);
    a.setCheats(true); hub.flush();
    expect(tagged(h)).toEqual(['ANNA']); expect(tagged(b)).toEqual(['ANNA']); expect(tagged(a)).toEqual(['ANNA']);
    h.setCheats(true); hub.flush();
    expect(tagged(b)).toEqual(['HOST', 'ANNA']);
    a.setCheats(false); hub.flush();
    expect(tagged(b)).toEqual(['HOST']);
    // Junk from another browser is not a tag.
    hub.deliver(roomOf(b), 'lobby', { t: 'set', name: 'BEN', ready: false, cheats: 'yes' }, peer(h)); hub.flush();
    expect(tagged(a)).toEqual(['HOST']);
  });

  it('a host answers a guest\'s hello with its own, so a guest that missed the first one still finds its host', () => {
    const h = page(true, 'HOST', 'bh'); hub.flush();
    const g = page(false, 'ANNA', 'b-ANNA');
    // The host's hello at connection time never reaches the guest: only the guest's own hello gets through.
    const sent: { t?: string; host?: boolean }[] = [];
    const lost = roomOf(g).message.bind(roomOf(g));
    let drop = true;
    roomOf(g).message = (name: string, data: unknown, from: string) => {
      const msg = data as { t?: string; host?: boolean };
      if (name === 'lobby' && msg?.t === 'hello' && msg.host && drop) { drop = false; sent.push(msg); return; }
      lost(name, data, from);
    };
    hub.flush();
    expect(sent).toHaveLength(1);
    expect(g.phase).toBe('open');
    expect(g.players.map(p => p.name)).toEqual(['HOST', 'ANNA']);
    expect(h.players.map(p => p.name)).toEqual(['HOST', 'ANNA']);
  });

  it('a guest that reloads on the lobby page takes its own seat back, and nobody else is disturbed', () => {
    const { h, gs } = lobbyOf('ANNA', 'BEN');
    const [a, b] = gs as unknown as [Lobby, Lobby];
    const slot = a.me!.slot, seat = h.players.find(p => p.name === 'ANNA')!.seat;
    roomOf(a).leave(); hub.flush();
    expect(h.players.find(p => p.name === 'ANNA')).toMatchObject({ state: 'lost', slot });
    const a2 = page(false, 'ANNA', 'b-ANNA'); hub.flush();
    expect(a2.phase).toBe('open');
    expect(h.players.map(p => p.name)).toEqual(['HOST', 'ANNA', 'BEN']);
    expect(h.players.find(p => p.name === 'ANNA')).toMatchObject({ slot, seat });
    expect(h.players.find(p => p.name === 'ANNA')?.state).toBeUndefined();
    expect(lines(b).slice(-2)).toEqual(['ANNA lost connection.', 'ANNA reconnected.']);
  });

  it('a host back on its lobby page after its guests regrouped gives way to their lobby', () => {
    const { h, gs } = lobbyOf('ANNA', 'BEN');
    const seats = h.seatRecords().seats;
    roomOf(h).leave(); hub.flush();
    tick(RECONNECT_MS + PING_MS + 500);
    expect(gs.map(g => g.error)).toEqual(['host-left', 'host-left']);
    const { a } = regrouped('BEN');
    vi.advanceTimersByTime(50);
    const h2 = page(true, 'HOST', 'bh', { seats }); hub.flush();
    expect(h2.error).toBe('code-taken'); expect(h2.yieldedTo).toBe('ANNA');
    expect(a.phase).toBe('open'); expect(a.players.map(p => p.name)).toEqual(['ANNA', 'BEN']);
  });
});
