import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Lobby, TRANSPORT_MAX_USERS, inviteLink } from './lobby';
import { LaneRoom } from './lanes';
import { loopWire, type Bus, type BusFactory } from './loopback';
import { carryNet, loopbackOn } from './mode';
import { NetSim, simText } from './netsim';
import { encodePose, type Pose } from './pose';
import type { LobbyRooms, NetError } from './room';

/** A BroadcastChannel in memory: every bus of one name hears what the others post, as a copy, when `flush` runs. */
class Hub {
  private buses = new Map<string, Set<{ handler: (message: unknown) => void }>>();
  private queue: (() => void)[] = [];
  posted = 0;
  bus: BusFactory = name => {
    const me = { handler: (_: unknown) => {} };
    const set = this.buses.get(name) ?? new Set();
    this.buses.set(name, set);
    set.add(me);
    const bus: Bus = {
      post: message => {
        this.posted++;
        const copy = structuredClone(message);
        for (const other of set) if (other !== me) this.queue.push(() => other.handler(structuredClone(copy)));
      },
      listen: handler => { me.handler = handler; },
      close: () => void set.delete(me),
    };
    return bus;
  };
  flush(): void {
    for (let i = 0; i < 5000 && this.queue.length; i++) this.queue.shift()!();
  }
}

/** Lets the queued announcements (microtasks) run, then delivers. */
const settle = async (hub: Hub) => { for (let i = 0; i < 6; i++) { await Promise.resolve(); hub.flush(); } };

const wire = (hub: Hub, room: string, password: string, self: string) => loopWire(room, password, { bus: hub.bus, self, locks: null });
const room = (hub: Hub, code: string, password: string, self: string, sim?: NetSim) => new LaneRoom(wire(hub, code, password, self), { metrics: null, sim });
const rooms = (hub: Hub, code: string, password: string, self: string): LobbyRooms =>
  ({ main: room(hub, code, password, self), door: () => room(hub, `${code}-door`, code, self) });

const pose = (seq: number): Pose => ({ seq, position: [1, 2, 3], velocity: [0, 0, 0], yaw: 0, pitch: 0, move: 'walk', weapon: 'smg' });

describe('loopback transport', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('is on only with ?net=loop, and only on a dev build or a page served from this computer', () => {
    expect(loopbackOn('?net=loop', '127.0.0.1', false)).toBe(true);
    expect(loopbackOn('?join=ABC234&net=loop', 'localhost', false)).toBe(true);
    expect(loopbackOn('?net=loop', 'jaredb650.github.io', true)).toBe(true);
    // The public site: a production build on another host ignores the word.
    expect(loopbackOn('?net=loop', 'jaredb650.github.io', false)).toBe(false);
    expect(loopbackOn('', '127.0.0.1', true)).toBe(false);
    expect(loopbackOn('?net=rtc', '127.0.0.1', true)).toBe(false);
  });

  it('keeps an invite link on the loopback only when the lobby is on it', () => {
    expect(inviteLink('ABC234', { origin: 'http://127.0.0.1:5271', pathname: '/' }, true)).toBe('http://127.0.0.1:5271/?join=ABC234&net=loop');
    expect(inviteLink('ABC234', { origin: 'https://x.io', pathname: '/op2/' }, false)).toBe('https://x.io/op2/?join=ABC234');
    expect(inviteLink('ABC234', { origin: 'https://x.io', pathname: '/op2/' })).toBe('https://x.io/op2/?join=ABC234');
  });

  it('carries the transport and the simulator into another page\'s address', () => {
    const params = new URLSearchParams('contract=crucible');
    carryNet(params, 'lag:80');
    // Tests are not on the loopback: only the simulator is carried.
    expect(params.toString()).toBe('contract=crucible&netsim=lag%3A80');
    const sim = new NetSim();
    expect(simText(sim)).toBe('');
    sim.set('lag:80,jitter:30,loss:0.03');
    expect(simText(sim)).toBe('lag:80,jitter:30,loss:0.03,stall:300,kbps:0');
    const again = new NetSim();
    again.set(simText(sim));
    expect(again.get()).toEqual(sim.get());
  });

  it('joins peers of one room and password, tells both, and carries objects as JSON and bytes as Uint8Array', async () => {
    const hub = new Hub();
    const a = wire(hub, 'ROOM', 'pw', 'a'), b = wire(hub, 'ROOM', 'pw', 'b'), elsewhere = wire(hub, 'OTHER', 'pw', 'c');
    const seen: string[] = [];
    a.onPeerJoin(id => seen.push(`a+${id}`)); b.onPeerJoin(id => seen.push(`b+${id}`)); elsewhere.onPeerJoin(id => seen.push(`c+${id}`));
    const got: [unknown, string][] = [];
    b.reliable('lobby').on((data, from) => got.push([data, from]));
    await settle(hub);
    expect(seen.sort()).toEqual(['a+b', 'b+a']);
    a.reliable('lobby').send({ t: 'hello', gone: undefined, bad: NaN }, 'b');
    a.reliable('lobby').send(new Uint8Array([1, 2, 3]).buffer, 'b');
    a.reliable('lobby').send({ t: 'not for b' }, 'nobody');
    hub.flush();
    expect(got[0]).toEqual([{ t: 'hello', bad: null }, 'a']);
    expect(got[1]![0]).toBeInstanceOf(Uint8Array);
    expect([...(got[1]![0] as Uint8Array)]).toEqual([1, 2, 3]);
    expect(got.length).toBe(2);
  });

  it('offers both lane kinds, and the fast path is up as soon as a peer is in', async () => {
    const hub = new Hub();
    const a = wire(hub, 'ROOM', 'pw', 'a'), b = wire(hub, 'ROOM', 'pw', 'b');
    const frames: [number[], string][] = [];
    b.onFast((frame, from) => frames.push([[...frame], from]));
    expect(a.fastUp('b')).toBe(false);
    expect(a.fastSend('b', new Uint8Array([9]))).toBe(false);
    await settle(hub);
    expect(a.fastUp('b')).toBe(true);
    expect(a.fastSend('b', new Uint8Array([4, 5]))).toBe(true);
    hub.flush();
    expect(frames).toEqual([[[4, 5], 'a']]);
  });

  it('a wrong password tells only the peer already in the room, and nothing is delivered', async () => {
    const hub = new Hub();
    const a = wire(hub, 'ROOM', 'right', 'a');
    await settle(hub);
    const b = wire(hub, 'ROOM', 'wrong', 'b');
    const errors: [string, NetError, string | undefined][] = [];
    a.onError((e, id) => errors.push(['a', e, id])); b.onError((e, id) => errors.push(['b', e, id]));
    const joined: string[] = [];
    a.onPeerJoin(id => joined.push(id)); b.onPeerJoin(id => joined.push(id));
    const got: unknown[] = [];
    a.reliable('lobby').on(data => got.push(data));
    await settle(hub);
    b.reliable('lobby').send({ t: 'hello' }, 'a');
    hub.flush();
    expect(errors).toEqual([['a', 'password', 'b']]);
    expect(joined).toEqual([]);
    expect(got).toEqual([]);
  });

  it('takes both pages of four players at once, and refuses a peer past the transport cap as full', async () => {
    // Around a match start every player has a lobby page and a map page in the room: eight peers for four players. The
    // game's own four is the lobby's to enforce (lobby.ts `admit`); the transport's cap is well above it.
    const hub = new Hub();
    const eighth: string[] = [];
    for (let i = 0; i < TRANSPORT_MAX_USERS; i++) {
      const w = wire(hub, 'ROOM', 'pw', `p${i}`);
      if (i === 7) w.onPeerJoin(id => eighth.push(id));
      await settle(hub);
    }
    // The eighth page met the seven before it and the four after: nobody was refused below the cap.
    expect(eighth).toHaveLength(TRANSPORT_MAX_USERS - 1);
    const over = wire(hub, 'ROOM', 'pw', 'over');
    const errors: NetError[] = [];
    const joined: string[] = [];
    over.onError(e => errors.push(e)); over.onPeerJoin(id => joined.push(id));
    await settle(hub);
    expect(errors).toEqual(['full']);
    expect(joined).toEqual([]);
  });

  it('tells the others when a peer leaves, and a left room sends and hears nothing', async () => {
    const hub = new Hub();
    const a = wire(hub, 'ROOM', 'pw', 'a'), b = wire(hub, 'ROOM', 'pw', 'b');
    const left: string[] = [];
    a.onPeerLeave(id => left.push(id));
    const got: unknown[] = [];
    b.reliable('lobby').on(data => got.push(data));
    await settle(hub);
    b.leave();
    hub.flush();
    expect(left).toEqual(['b']);
    expect(a.fastUp('b')).toBe(false);
    a.reliable('lobby').send({ t: 'late' }, 'b');
    hub.flush();
    expect(got).toEqual([]);
  });

  it('notices a page that dies without saying goodbye, through its Web Lock', async () => {
    const hub = new Hub();
    // A stand-in for navigator.locks: a request waits until the holder lets go.
    const held = new Map<string, (() => void)[]>();
    const locks = {
      request: async (name: string, _options: unknown, callback: () => unknown) => {
        if (held.has(name)) await new Promise<void>(resolve => held.get(name)!.push(resolve));
        held.set(name, []);
        await callback();
        const waiting = held.get(name) ?? [];
        held.delete(name);
        waiting.shift()?.();
      },
    };
    const a = loopWire('ROOM', 'pw', { bus: hub.bus, self: 'a', locks });
    let crash: () => void = () => {};
    // b's page: holds its lock until `crash`, and never posts `bye`.
    const dying = { request: (name: string, _o: unknown, callback: () => unknown) => locks.request(name, _o, async () => { callback(); await new Promise<void>(resolve => { crash = resolve; }); }) };
    loopWire('ROOM', 'pw', { bus: hub.bus, self: 'b', locks: dying });
    const left: string[] = [];
    a.onPeerLeave(id => left.push(id));
    await settle(hub);
    expect(a.fastUp('b')).toBe(true);
    crash();
    await settle(hub);
    expect(left).toEqual(['b']);
  });

  it('runs the real Lobby: host and guests, the door for a wrong password, a match, and poses on the unreliable lane', async () => {
    const hub = new Hub();
    const host = new Lobby(rooms(hub, 'ABC234', 'pw', 'h'), true, 'HOSTY', 'b1');
    await settle(hub);
    const guest = new Lobby(rooms(hub, 'ABC234', 'pw', 'g1'), false, 'GUEST', 'b1');
    const other = new Lobby(rooms(hub, 'ABC234', 'pw', 'g2'), false, 'THIRD', 'b1');
    await settle(hub);
    expect(guest.phase).toBe('open');
    expect(host.players.map(p => p.name)).toEqual(['HOSTY', 'GUEST', 'THIRD']);
    expect(guest.players.length).toBe(3);

    const wrong = new Lobby(rooms(hub, 'ABC234', 'nope', 'g3'), false, 'WRONG', 'b1');
    await settle(hub);
    expect(wrong.phase).toBe('connecting');
    vi.advanceTimersByTime(5_100); // the guest knocks at the door, where the host tells it
    await settle(hub);
    expect(wrong.error).toBe('password');

    guest.setReady(true); other.setReady(true);
    await settle(hub);
    let started = '';
    guest.onMatch = match => { started = match.mode; };
    expect(host.startMatch('crucible', 'match-1')).toBe(true);
    await settle(hub);
    expect(started).toBe('crucible');

    const seen: [string, number][] = [];
    host.onPose = (id, p) => seen.push([id, p.seq]);
    other.onPose = (id, p) => seen.push([`relayed:${id}`, p.seq]);
    guest.sendPose(pose(7));
    await settle(hub);
    expect(seen).toEqual([['g1', 7], ['relayed:g1', 7]]);
    expect(host.behind('g1')).toBe(false);

    guest.leave();
    await settle(hub);
    expect(host.players.map(p => p.name)).toEqual(['HOSTY', 'THIRD']);
    host.leave(); other.leave(); wrong.leave();
  });

  it('with the simulator losing everything, poses stop and the lobby still works', async () => {
    const hub = new Hub();
    const sim = new NetSim(() => performance.now(), () => 0);
    const host = new Lobby({ main: room(hub, 'ABC234', 'pw', 'h'), door: () => room(hub, 'ABC234-door', 'ABC234', 'h') }, true, 'HOSTY', 'b1');
    await settle(hub);
    const guest = new Lobby({ main: room(hub, 'ABC234', 'pw', 'g', sim), door: () => room(hub, 'ABC234-door', 'ABC234', 'g') }, false, 'GUEST', 'b1');
    await settle(hub);
    host.startMatch('crucible', 'match-1');
    await settle(hub);
    sim.set({ loss: 0.9, stall: 50 }); // every roll is 0: each unreliable packet is lost, each reliable one resent 8 times
    const seen: number[] = [];
    host.onPose = (_id, p) => seen.push(p.seq);
    guest.sendPose(pose(1));
    guest.say('still here');
    await settle(hub);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1000);
    await settle(hub);
    expect(host.chat.at(-1)).toEqual({ from: 'GUEST', text: 'still here' });
    expect(encodePose(pose(1), 1).byteLength).toBeLessThan(100);
    host.leave(); guest.leave();
  });
});
