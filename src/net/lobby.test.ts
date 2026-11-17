import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_S, DOOR_AFTER_MS, HOST_WAIT_MS, Lobby, PING_MS, RELAY_WAIT_MS, SILENCE_MS, cleanCode, inviteLink, newCode } from './lobby';
import { encodePose, type Pose } from './pose';
import type { NetError, NetRoom } from './room';

/**
 * An in-memory relay. Peers in one room with the same password connect. A wrong one fails the handshake on one end only,
 * as trystero does: the end that received the offer, which is down to how the peer ids compare. `failsAt` picks it.
 */
class Hub {
  private rooms: FakeRoom[] = [];
  private queue: (() => void)[] = [];
  failsAt: 'newcomer' | 'resident' = 'newcomer';

  open(roomId: string, password: string, peerId: string): FakeRoom {
    const room = new FakeRoom(peerId, roomId, password, this);
    for (const other of this.rooms) {
      if (other.roomId !== roomId) continue;
      if (other.password === password) {
        this.later(() => other.joined(room.id));
        this.later(() => room.joined(other.id));
      } else if (this.failsAt === 'newcomer') {
        this.later(() => room.fail('password', other.id));
      } else {
        this.later(() => other.fail('password', room.id));
      }
    }
    this.rooms.push(room);
    return room;
  }

  later(fn: () => void): void {
    this.queue.push(fn);
  }

  deliver(from: FakeRoom, name: string, data: unknown, to?: string): void {
    for (const r of this.rooms) {
      if (r === from || r.roomId !== from.roomId || r.password !== from.password || (to && r.id !== to)) continue;
      const copy = structuredClone(data);
      this.later(() => r.message(name, copy, from.id));
    }
  }

  gone(room: FakeRoom): void {
    this.rooms = this.rooms.filter(r => r !== room);
    for (const r of this.rooms) if (r.roomId === room.roomId && r.password === room.password) this.later(() => r.left(room.id));
  }

  flush(): void {
    for (let i = 0; i < 1000 && this.queue.length; i++) this.queue.shift()!();
  }
}

class FakeRoom implements NetRoom {
  private handlers: Record<string, ((data: unknown, from: string) => void)[]> = {};
  private joins: ((id: string) => void)[] = [];
  private leaves: ((id: string) => void)[] = [];
  private errors: ((e: NetError, peerId?: string) => void)[] = [];
  closed = false;

  constructor(readonly id: string, readonly roomId: string, readonly password: string, private readonly hub: Hub) {}

  channel<T>(name: string) {
    return {
      send: (data: T, to?: string) => {
        if (!this.closed) this.hub.deliver(this, name, data, to);
      },
      on: (handler: (data: T, from: string) => void) => {
        (this.handlers[name] ??= []).push(handler as (data: unknown, from: string) => void);
      },
    };
  }
  onPeerJoin(h: (id: string) => void) { this.joins.push(h); }
  onPeerLeave(h: (id: string) => void) { this.leaves.push(h); }
  onError(h: (e: NetError, peerId?: string) => void) { this.errors.push(h); }
  leave() {
    if (this.closed) return;
    this.closed = true;
    this.hub.gone(this);
  }
  joined(id: string) { if (!this.closed) for (const h of this.joins) h(id); }
  left(id: string) { if (!this.closed) for (const h of this.leaves) h(id); }
  fail(e: NetError, peerId: string) { if (!this.closed) for (const h of this.errors) h(e, peerId); }
  message(name: string, data: unknown, from: string) { if (!this.closed) for (const h of this.handlers[name] ?? []) h(data, from); }
}

describe('co-op lobby', () => {
  let hub: Hub;
  beforeEach(() => {
    vi.useFakeTimers();
    hub = new Hub();
  });
  afterEach(() => vi.useRealTimers());

  let pages = 0;
  const rooms = (password: string) => {
    const id = `p${pages++}`;
    return { main: hub.open('CODE', password, id), door: () => hub.open('CODE-door', 'CODE', id) };
  };
  const host = (password = 'pw', build = 'b1') => new Lobby(rooms(password), true, 'HOSTY', build);
  const guest = (password = 'pw', build = 'b1', name = 'GUEST') => new Lobby(rooms(password), false, name, build);

  it('carries independent starters through joining, changes and the match handoff', () => {
    const h = host();
    h.setStarter('gimlet');
    const g = guest();
    g.setStarter('harrow');
    hub.flush();
    expect(h.players.map(p => p.starter)).toEqual(['gimlet', 'harrow']);
    expect(g.players.map(p => p.starter)).toEqual(['gimlet', 'harrow']);
    g.setStarter('smg');
    hub.flush();
    const chosen: string[] = [];
    h.onMatch = () => chosen.push(h.me!.starter!);
    g.onMatch = () => chosen.push(g.me!.starter!);
    h.startMatch('outpost', 'starters');
    hub.flush();
    expect(chosen.sort()).toEqual(['gimlet', 'smg']);
  });

  it('uses the selected mode’s gun for players who leave the starter untouched', () => {
    const h = host(); const g = guest(); hub.flush();
    h.startMatch('outpost', 'defaults'); hub.flush();
    expect(h.players.map(p => p.starter)).toEqual(['harrow', 'harrow']);
    expect(g.me!.starter).toBe('harrow');
  });

  it('a guest joins, sees both players and the host marked, and chat goes both ways', () => {
    const h = host();
    const g = guest();
    expect(g.phase).toBe('connecting');
    hub.flush();
    expect(g.phase).toBe('open');
    expect(h.players.map(p => p.name)).toEqual(['HOSTY', 'GUEST']);
    expect(g.players.map(p => [p.name, p.host])).toEqual([['HOSTY', true], ['GUEST', false]]);
    expect(g.me?.name).toBe('GUEST');
    g.say('hello there');
    hub.flush();
    h.say('welcome');
    hub.flush();
    const lines = (l: Lobby) => l.chat.filter(c => c.from).map(c => `${c.from}: ${c.text}`);
    expect(lines(h)).toEqual(['GUEST: hello there', 'HOSTY: welcome']);
    expect(lines(g)).toEqual(['GUEST: hello there', 'HOSTY: welcome']);
    expect(g.chat[0]).toEqual({ from: null, text: 'GUEST joined.' });
  });

  it('ready and a new name reach everyone through the host', () => {
    const h = host();
    const g = guest();
    const g2 = guest('pw', 'b1', 'THIRD');
    hub.flush();
    g.setReady(true);
    g.setName('  NEWNAME\u0007 that is far too long ');
    hub.flush();
    const row = (l: Lobby) => l.players.find(p => p.id === g.you);
    expect(row(h)).toMatchObject({ name: 'NEWNAME that is', ready: true });
    expect(row(g2)).toMatchObject({ name: 'NEWNAME that is', ready: true });
    h.setReady(true);
    hub.flush();
    expect(g2.players.find(p => p.host)?.ready).toBe(true);
  });

  it('a guest that leaves is dropped from the list with a line', () => {
    const h = host();
    const g = guest();
    const g2 = guest('pw', 'b1', 'THIRD');
    hub.flush();
    g.leave();
    hub.flush();
    expect(h.players.map(p => p.name)).toEqual(['HOSTY', 'THIRD']);
    expect(g2.players.map(p => p.name)).toEqual(['HOSTY', 'THIRD']);
    expect(g2.chat.at(-1)).toEqual({ from: null, text: 'GUEST left.' });
    expect(g.phase).toBe('closed');
    expect(g.error).toBeNull();
  });

  it('a second tab of the same browser replaces its old seat, never takes another', () => {
    const h = host();
    const first = guest();
    first.browser = 'browser-1';
    const other = guest('pw', 'b1', 'OTHER');
    other.browser = 'browser-2';
    hub.flush();
    const second = guest('pw', 'b1', 'GUEST');
    second.browser = 'browser-1';
    hub.flush();
    expect(h.players.map(p => p.name)).toEqual(['HOSTY', 'OTHER', 'GUEST']);
    expect(h.players.filter(p => p.name === 'GUEST')).toHaveLength(1);
    expect(second.phase).toBe('open');
  });

  it('the host leaving closes every guest with host-left', () => {
    const h = host();
    const g = guest();
    hub.flush();
    h.leave();
    hub.flush();
    expect(g.phase).toBe('closed');
    expect(g.error).toBe('host-left');
  });

  it('a wrong password trystero reports to the guest stops it at once', () => {
    const h = host('right');
    const g = guest('wrong');
    hub.flush();
    expect(g.phase).toBe('closed');
    expect(g.error).toBe('password');
    expect(h.players).toHaveLength(1);
  });

  it('a wrong password trystero reports only to the host reaches the guest through the door, never silence', () => {
    hub.failsAt = 'resident';
    const h = host('right');
    const g = guest('wrong');
    hub.flush();
    expect(g.phase).toBe('connecting');
    expect(h.chat.at(-1)?.text).toMatch(/wrong password/);
    vi.advanceTimersByTime(DOOR_AFTER_MS);
    hub.flush();
    expect(g.phase).toBe('closed');
    expect(g.error).toBe('password');
    expect(h.players).toHaveLength(1);
  });

  it('a guest with the right password never opens the door', () => {
    host();
    const g = guest();
    hub.flush();
    vi.advanceTimersByTime(DOOR_AFTER_MS * 2);
    hub.flush();
    expect(g.phase).toBe('open');
    expect((g as unknown as { door: unknown }).door).toBeNull();
  });

  it("another guest's wrong password does not throw out a guest already in", () => {
    host();
    const g = guest();
    hub.flush();
    guest('wrong');
    hub.flush();
    expect(g.phase).toBe('open');
  });

  it('a build mismatch stops the guest with both versions known, and the host lists nobody', () => {
    const h = host('pw', 'aaa111');
    const g = guest('pw', 'bbb222');
    hub.flush();
    expect(g.error).toBe('version');
    expect(g.theirBuild).toBe('aaa111');
    expect(h.players).toHaveLength(1);
    expect(h.chat.at(-1)?.text).toMatch(/different game version/);
  });

  it('no host answering in time stops the guest with no-host', () => {
    const g = guest();
    hub.flush();
    vi.advanceTimersByTime(HOST_WAIT_MS + 1);
    expect(g.error).toBe('no-host');
  });

  it('measures each guest\'s ping and shows it to everyone', () => {
    const h = host(); const g = guest(); hub.flush();
    vi.advanceTimersByTime(PING_MS); hub.flush();
    vi.advanceTimersByTime(PING_MS); hub.flush();
    expect(h.players[1]!.ping).toBeTypeOf('number');
    expect(g.players[1]!.ping).toBe(h.players[1]!.ping);
  });

  it('drops a silent guest, and a guest stops with lost when the host goes silent', () => {
    const h = host(); const g = guest(); hub.flush();
    // The guest stops answering (a closed lid): nothing from it reaches the host.
    (g as unknown as { ch: { send(): void } }).ch.send = () => {};
    vi.advanceTimersByTime(SILENCE_MS + PING_MS * 2); hub.flush();
    expect(h.players).toHaveLength(1);
    expect(h.chat.at(-1)?.text).toBe('GUEST left.');
  });

  it('a guest stops with lost when the host goes silent', () => {
    const h = host(); const g = guest(); hub.flush();
    expect(g.phase).toBe('open');
    (h as unknown as { ch: { send(): void } }).ch.send = () => {};
    vi.advanceTimersByTime(SILENCE_MS + PING_MS * 2); hub.flush();
    expect(g.phase).toBe('closed'); expect(g.error).toBe('lost');
  });

  it('a fifth player is told the lobby is full, at once', () => {
    const h = host(); guest(); guest('pw', 'b1', 'G2'); guest('pw', 'b1', 'G3'); hub.flush();
    expect(h.players).toHaveLength(4);
    const fifth = guest('pw', 'b1', 'G4'); hub.flush();
    expect(fifth.phase).toBe('closed'); expect(fifth.error).toBe('full');
    expect(h.players).toHaveLength(4);
  });

  it('counts down for everyone before it starts, and a second press cancels', () => {
    const h = host(); const g = guest(); hub.flush();
    g.setReady(true); hub.flush();
    let started = 0; h.onMatch = () => started++;
    expect(h.countdown('crucible')).toBe(true); hub.flush();
    expect(g.count).toBe(COUNTDOWN_S);
    vi.advanceTimersByTime(2000); hub.flush();
    expect(g.count).toBe(COUNTDOWN_S - 2);
    h.countdown('crucible'); hub.flush();
    expect(h.count).toBe(0); expect(g.count).toBe(0);
    vi.advanceTimersByTime(10_000); hub.flush();
    expect(started).toBe(0);
    h.countdown('crucible'); vi.advanceTimersByTime(COUNTDOWN_S * 1000); hub.flush();
    expect(h.match?.mode).toBe('crucible');
  });

  it('never starts with a guest not ready: Start is refused with who, and going unready or a join stops the count', () => {
    const h = host(); const g = guest(); hub.flush();
    let started = 0; h.onMatch = () => started++;
    expect(h.countdown('crucible')).toBe(false); hub.flush();
    expect(h.count).toBe(0); expect(g.chat.at(-1)?.text).toBe('Waiting for GUEST to ready up.');
    g.setReady(true); hub.flush();
    expect(h.countdown('crucible')).toBe(true); hub.flush();
    // The guest goes back to picking a gun as the count runs: it stops for everyone, and nothing starts.
    vi.advanceTimersByTime(2000); g.setStarter('gimlet'); g.setReady(false); hub.flush();
    expect(h.count).toBe(0); expect(g.count).toBe(0);
    expect(g.chat.at(-1)?.text).toBe('Start cancelled: GUEST not ready.');
    vi.advanceTimersByTime(10_000); hub.flush();
    expect(started).toBe(0); expect(g.match).toBeNull();
    g.setReady(true); hub.flush();
    h.countdown('crucible'); hub.flush();
    guest('pw', 'b1', 'LATE'); hub.flush();
    expect(h.count).toBe(0); expect(h.chat.at(-1)?.text).toBe('Start cancelled: LATE not ready.');
  });

  it("an untouched starter follows the host's mode, which every guest sees before the start", () => {
    const h = host(); const g = guest(); hub.flush();
    expect(g.pick).toEqual({ mode: 'crucible' });
    h.setPick('outpost', 'office'); hub.flush();
    expect(g.pick).toEqual({ mode: 'outpost', map: 'office' });
    g.setReady(true); hub.flush();
    h.startMatch('outpost', 'picked', 'office'); hub.flush();
    expect(g.me!.starter).toBe('harrow');
  });

  it('force start pulls in a guest who is not ready, with the gun it picked or the mode default', () => {
    const h = host(); const picker = guest('pw', 'b1', 'PICKER'); const idle = guest('pw', 'b1', 'IDLE'); hub.flush();
    picker.setStarter('gimlet'); hub.flush();
    const started: string[] = [];
    for (const l of [h, picker, idle]) l.onMatch = m => started.push(m.id);
    expect(h.countdown('crucible')).toBe(false);
    expect(picker.forceStart('crucible')).toBe(false);
    expect(h.forceStart('crucible')).toBe(true); hub.flush();
    expect(started).toHaveLength(3);
    expect(idle.chat.at(-1)?.text).toBe('The host started without waiting for PICKER, IDLE.');
    expect([picker.match?.mode, idle.match?.mode]).toEqual(['crucible', 'crucible']);
    expect(picker.starter).toBe('gimlet');
    expect(idle.me!.starter).toBe('smg');
    expect(h.forceStart('crucible')).toBe(false);
  });

  it("a guest's own pick goes with it into the match even when the host's list has not caught up", () => {
    const h = host(); const g = guest(); hub.flush();
    g.setReady(true); g.setStarter('harrow'); hub.flush();
    h.startMatch('crucible', 'late-pick');
    // Picked as the count ran out, before the start reached the guest: the host's list keeps the old gun, the guest's own pick
    // is the new one, and deployMatch (starter.test.ts) hands that one on.
    g.setStarter('gimlet'); hub.flush();
    expect(g.me!.starter).toBe('harrow');
    expect(g.starter).toBe('gimlet');
  });

  it('names the stage a join stalled at: relays, the host connection, or no lobby', () => {
    const at = (status: { relays: boolean; trying: number }) => {
      const r = rooms('pw');
      (r.main as FakeRoom & { status(): typeof status }).status = () => status;
      return new Lobby(r, false, 'G', 'b1');
    };
    const noRelay = at({ relays: false, trying: 0 });
    const stuck = at({ relays: true, trying: 1 });
    const nobody = at({ relays: true, trying: 0 });
    expect([noRelay.stage, stuck.stage, nobody.stage]).toEqual(['relays', 'connecting', 'looking']);
    vi.advanceTimersByTime(RELAY_WAIT_MS + 1);
    expect(noRelay.error).toBe('relays'); expect(stuck.phase).toBe('connecting');
    vi.advanceTimersByTime(HOST_WAIT_MS);
    expect(stuck.error).toBe('connect'); expect(nobody.error).toBe('no-host');
  });

  it('a second host on the same code steps aside', () => {
    const first = host(); hub.flush();
    const second = host(); hub.flush();
    expect([first.phase, second.phase].filter(p => p === 'closed')).toHaveLength(1);
    expect([first.error, second.error]).toContain('code-taken');
  });

  it("drops a guest's forged lobby list and junk", () => {
    const h = host();
    const g = guest();
    const g2 = guest('pw', 'b1', 'THIRD');
    hub.flush();
    // g2 pretends to be the host to g: only the host's id is listened to.
    const forged = (hub as unknown as { deliver: Hub['deliver'] });
    const g2room = (g2 as unknown as { room: FakeRoom }).room;
    forged.deliver(g2room, 'lobby', { t: 'lobby', you: 'x', players: [] }, (g as unknown as { you: string }).you);
    forged.deliver(g2room, 'lobby', null);
    forged.deliver(g2room, 'lobby', { t: 'set', name: 42, ready: 'yes' });
    hub.flush();
    expect(g.players).toHaveLength(3);
    expect(h.players.find(p => p.name === 'THIRD')?.ready).toBe(false);
  });
});

describe('match start and live room', () => {
  let hub: Hub;
  let n = 0;
  const open = (host: boolean, name: string, deployed = false) => {
    const id = `m${n++}`;
    return new Lobby({ main: hub.open('MATCH', 'pw', id), door: () => hub.open('MATCH-door', 'MATCH', id) }, host, name, 'same', deployed);
  };
  beforeEach(() => { vi.useFakeTimers(); hub = new Hub(); });
  afterEach(() => vi.useRealTimers());
  it.each(['crucible', 'outpost', 'defense'] as const)('only the host starts %s, guests save before host deploys, duplicate starts do not reset', mode => {
    const h = open(true, 'HOST');
    const g = open(false, 'GUEST');
    const third = open(false, 'THIRD');
    hub.flush();
    const order: string[] = [];
    h.onMatch = () => order.push('host');
    g.onMatch = () => order.push('guest');
    third.onMatch = () => order.push('third');
    expect(g.startMatch(mode, 'match-1')).toBe(false);
    expect(h.startMatch(mode, 'match-1')).toBe(true);
    expect(order).toEqual([]);
    hub.flush();
    expect(order).toEqual(['guest', 'third', 'host']);
    expect(g.match).toEqual({ id: 'match-1', mode });
    expect(third.match).toEqual(h.match);
    expect(h.startMatch(mode, 'match-2')).toBe(false);
    const late = open(false, 'LATE');
    const lateStart = vi.fn();
    late.onMatch = lateStart;
    hub.flush();
    expect(lateStart).toHaveBeenCalledWith(h.match);
    expect(order).toEqual(['guest', 'third', 'host']);
  });
  it('relays host and guest poses, stamps guest identity and ignores unadmitted peers', () => {
    const h = open(true, 'HOST'), g = open(false, 'GUEST'), g2 = open(false, 'THIRD');
    hub.flush();
    h.startMatch('crucible', 'test'); hub.flush();
    const hp = vi.fn(), gp = vi.fn(), g2p = vi.fn();
    h.onPose = hp; g.onPose = gp; g2.onPose = g2p;
    const p: Pose = { seq: 1, position: [1, 2, 3], velocity: [4, 5, 6], yaw: 0, pitch: 0, move: 'slide', weapon: 'pistol' };
    g.sendPose(p); hub.flush();
    expect(hp).toHaveBeenCalledWith(g.you, p);
    expect(g2p).toHaveBeenCalledWith(g.you, p);
    expect(gp).not.toHaveBeenCalled();
    h.sendPose(p); hub.flush();
    expect(gp).toHaveBeenCalledWith('host', p);
    const room = (g as unknown as { room: FakeRoom }).room;
    hub.deliver(room, 'pose', encodePose({ ...p, seq: 2 }, 0)); hub.flush();
    expect(g2p).toHaveBeenLastCalledWith(g.you, { ...p, seq: 2 });
    expect(gp).toHaveBeenCalledTimes(1); // guest ignores direct packets from another guest
    const rogue = hub.open('MATCH', 'pw', 'unadmitted'); hub.flush();
    hub.deliver(rogue, 'pose', encodePose(p, 0)); hub.flush();
    expect(hp).toHaveBeenCalledTimes(2);
  });
  it('keeps a running match when a guest leaves, recycles its slot, and ends it when the host leaves', () => {
    const h = open(true, 'HOST'), g = open(false, 'GUEST'), g2 = open(false, 'THIRD');
    hub.flush(); h.startMatch('defense', 'test'); hub.flush();
    const slot = h.players.find(p => p.id === g.you)!.slot;
    g.leave(); hub.flush();
    expect(g2.match?.mode).toBe('defense');
    expect(g2.chat.at(-1)?.text).toBe('GUEST left.');
    expect(g2.players.some(p => p.id === g.you)).toBe(false);
    const replacement = open(false, 'REPLACEMENT'); hub.flush();
    expect(h.players.find(p => p.id === replacement.you)?.slot).toBe(slot);
    h.leave(); hub.flush();
    expect(g2.phase).toBe('closed');
    expect(replacement.error).toBe('host-left');
    const receive = vi.fn(); g2.onPose = receive;
    g2.sendPose({ seq: 2, position: [0, 0, 0], velocity: [0, 0, 0], yaw: 0, pitch: 0, move: 'walk', weapon: 'pistol' });
    hub.flush(); expect(receive).not.toHaveBeenCalled();
  });
  it('a reloading guest ignores the old host page and adopts only the deployed host', () => {
    const oldHost = open(true, 'HOST'), oldGuest = open(false, 'GUEST'); hub.flush();
    oldHost.startMatch('crucible', 'handoff'); hub.flush();
    oldGuest.leave(); hub.flush();
    const returning = open(false, 'GUEST', true); hub.flush();
    expect(returning.phase).toBe('connecting');
    expect(oldHost.players.map(p => p.name)).toEqual(['HOST']);
    oldHost.leave(); hub.flush();
    expect(returning.error).toBeNull();
    const deployedHost = open(true, 'HOST', true);
    deployedHost.startMatch('crucible', 'handoff'); hub.flush();
    expect(returning.phase).toBe('open');
    expect(returning.match).toEqual({ id: 'handoff', mode: 'crucible' });
    deployedHost.leave(); hub.flush();
    expect(returning.error).toBe('host-left');
  });
  it('ends a match back to the lobby for everyone, and a guest can step out and back in', () => {
    const h = open(true, 'HOSTY'); const g = open(false, 'GUEST'); hub.flush();
    h.startMatch('crucible', 'one'); hub.flush();
    expect(g.match?.id).toBe('one');
    // The guest steps out to the lobby page while the host plays on.
    g.away(false); hub.flush();
    expect(g.match).toBeNull(); expect(g.awayFrom?.id).toBe('one');
    expect(h.players[1]!.away).toBe(true); expect(g.players[1]!.away).toBe(true);
    let back = 0; g.onMatch = () => back++;
    g.away(true); hub.flush();
    expect(back).toBe(1); expect(g.match?.id).toBe('one'); expect(h.players[1]!.away).toBe(false);
    // The host ends it: everyone is back in the open lobby and a new match can start.
    let ended = 0; g.onEnd = () => ended++;
    h.endMatch(); hub.flush();
    expect(ended).toBe(1); expect(g.match).toBeNull(); expect(h.match).toBeNull();
    expect(h.startMatch('crucible', 'two')).toBe(true); hub.flush();
    expect(g.match?.id).toBe('two');
  });

  it('rejects guest-forged starts', () => {
    const h = open(true, 'HOST'), g = open(false, 'GUEST'), g2 = open(false, 'THIRD'); hub.flush();
    hub.deliver((g2 as unknown as { room: FakeRoom }).room, 'lobby', { t: 'start', match: { id: 'fake', mode: 'defense' } });
    hub.flush(); expect(h.match).toBeNull(); expect(g.match).toBeNull();
  });
});

describe('codes and links', () => {
  it('makes codes that read back, and rejects junk', () => {
    for (let i = 0; i < 50; i++) expect(cleanCode(newCode())).toHaveLength(6);
    expect(cleanCode(' abc-def ')).toBe('ABCDEF');
    expect(cleanCode('ABC1EF')).toBe('');
    expect(cleanCode('ABCD')).toBe('');
  });

  it('builds the invite link on this page', () => {
    expect(inviteLink('ABCDEF', { origin: 'https://x.github.io', pathname: '/overpowered-2/' })).toBe('https://x.github.io/overpowered-2/?join=ABCDEF');
  });
});
