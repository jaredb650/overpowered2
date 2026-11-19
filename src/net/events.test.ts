/** The lobby's batched event lane (lobby.ts `events`, batch.ts) and its backpressure (pressure.ts), over an in-memory room. */
import { describe, expect, it, vi } from 'vitest';
import { batchOf, unbatch } from './batch';
import { Lobby, type EventLane, type LobbyPlayer, type SeatEvent } from './lobby';
import { CLEAR_BYTES, SLOW_BYTES, STALLED_BYTES } from './pressure';
import type { NetRoom } from './room';

type Ev = { t: string; n?: number };
interface Packet { lane: string; data: unknown; from: string; to?: string }

class Relay {
  readonly rooms: Room[] = [];
  readonly queue: (() => void)[] = [];
  readonly packets: Packet[] = [];
  open(id: string): Room {
    const room = new Room(id, this);
    for (const peer of this.rooms) this.queue.push(() => { peer.join(id); room.join(peer.id); });
    this.rooms.push(room);
    return room;
  }
  flush(): void { while (this.queue.length) this.queue.shift()!(); }
}
/** A room whose backlog to each peer the test sets: bytes queued, and reliable messages lost. */
class Room implements NetRoom {
  readonly handlers = new Map<string, (data: unknown, from: string) => void>();
  readonly queued = new Map<string, number>();
  readonly lost = new Map<string, number>();
  join: (id: string) => void = () => {};
  constructor(readonly id: string, private readonly relay: Relay) {}
  channel<T>(lane: string) {
    return {
      on: (handler: (data: T, from: string) => void) => void this.handlers.set(lane, handler as (data: unknown, from: string) => void),
      send: (data: T, to?: string) => {
        this.relay.packets.push({ lane, data: structuredClone(data), from: this.id, to });
        for (const peer of this.relay.rooms) if (peer !== this && (!to || peer.id === to)) {
          const copied = structuredClone(data);
          this.relay.queue.push(() => peer.handlers.get(lane)?.(copied, this.id));
        }
      },
    };
  }
  buffered(peer: string): number { return this.queued.get(peer) ?? 0; }
  failed(peer: string): number { return this.lost.get(peer) ?? 0; }
  onPeerJoin(handler: (id: string) => void) { this.join = handler; }
  onPeerLeave() {}
  onError() {}
  leave() {}
}

function rig(guests = 2) {
  const relay = new Relay();
  const door = () => new Room('door', new Relay());
  const hostRoom = relay.open('host-peer');
  const host = new Lobby({ main: hostRoom, door }, true, 'HOST', 'test');
  const guestRooms = Array.from({ length: guests }, (_, i) => relay.open(`g${i + 1}`));
  const lobbies = guestRooms.map((room, i) => new Lobby({ main: room, door }, false, `GUEST${i + 1}`, 'test'));
  relay.flush(); host.startMatch('crucible', 'match-one'); relay.flush();
  const heard: Ev[][] = [[], ...lobbies.map(() => [])];
  const sizes: number[] = [];
  const lanes: EventLane<Ev>[] = [host, ...lobbies].map((lobby, i) => lobby.events<Ev>('action', (event, _from, bytes) => { heard[i]!.push(event); sizes.push(bytes); }));
  const seats: [string, SeatEvent][] = [];
  host.onSeat = (player: LobbyPlayer, event: SeatEvent) => seats.push([player.id, event]);
  /** What crossed the `action` lane since the last call: who to, and the events in each message. */
  let read = 0;
  const actions = () => {
    const fresh = relay.packets.slice(read).filter(p => p.lane === 'action').map(p => ({ from: p.from, to: p.to, events: unbatch<Ev>(p.data).map(e => e.t) }));
    read = relay.packets.length;
    return fresh;
  };
  actions();
  return { relay, host, hostRoom, lobbies, guestRooms, lanes, heard, sizes, seats, actions };
}

describe('the batched event lane', () => {
  it('sends each event as it is queued until batching is on, and says how many it went to and how big it was', () => {
    const g = rig();
    expect(g.lanes[0]!.send({ t: 'a' })).toBe(2);
    expect(g.lanes[0]!.bytes).toBe(2 + JSON.stringify({ t: 'a' }).length);
    expect(g.lanes[0]!.send({ t: 'b' }, 'g2')).toBe(1);
    expect(g.lanes[1]!.send({ t: 'up' })).toBe(1);
    expect(g.actions()).toEqual([{ from: 'host-peer', to: 'g1', events: ['a'] }, { from: 'host-peer', to: 'g2', events: ['a'] }, { from: 'host-peer', to: 'g2', events: ['b'] }, { from: 'g1', to: 'host-peer', events: ['up'] }]);
    g.relay.flush();
    expect(g.heard).toEqual([[{ t: 'up' }], [{ t: 'a' }], [{ t: 'a' }, { t: 'b' }]]);
    expect(g.sizes.every(size => size === 2 + JSON.stringify({ t: 'a' }).length || size === 2 + JSON.stringify({ t: 'up' }).length)).toBe(true);
  });

  it('with batching on, a frame\'s events are one message per peer, in order: to all, to one, to all but one', () => {
    const g = rig();
    const due: (() => void)[] = [];
    g.host.batching(run => due.push(run));
    g.lanes[0]!.send({ t: 'all', n: 1 });
    g.lanes[0]!.send({ t: 'one', n: 2 }, 'g1');
    g.lanes[0]!.send({ t: 'relay', n: 3 }, undefined, 'g1');
    g.lanes[0]!.send({ t: 'all', n: 4 });
    expect(g.actions()).toEqual([]);
    // One flush is asked for, however many events wait.
    expect(due).toHaveLength(1);
    due.shift()!();
    expect(g.actions()).toEqual([{ from: 'host-peer', to: 'g1', events: ['all', 'one', 'all'] }, { from: 'host-peer', to: 'g2', events: ['all', 'relay', 'all'] }]);
    g.relay.flush();
    expect(g.heard[1]!.map(e => e.n)).toEqual([1, 2, 4]);
    expect(g.heard[2]!.map(e => e.n)).toEqual([1, 3, 4]);
    // The next frame asks again.
    g.lanes[0]!.send({ t: 'next' });
    expect(due).toHaveLength(1);
    // Turning batching off sends what waits.
    g.host.batching(null);
    expect(g.actions().map(p => p.events)).toEqual([['next'], ['next']]);
  });

  it('what the lobby itself says keeps its place after the events queued before it, and a match\'s last events leave before its end', () => {
    const g = rig(1);
    g.host.batching(() => {});
    const from = g.relay.packets.length;
    g.lanes[0]!.send({ t: 'before' });
    g.host.notice('a line');
    // The event first, then the line and the list that follows it.
    expect(g.relay.packets.slice(from).filter(p => p.from === 'host-peer' && p.to === 'g1').map(p => p.lane)).toEqual(['action', 'lobby', 'lobby']);
    const ended = vi.fn();
    g.lobbies[0]!.onEnd = ended;
    g.lanes[0]!.send({ t: 'over' });
    g.host.endMatch();
    g.relay.flush();
    expect(g.heard[1]!.map(e => e.t)).toEqual(['before', 'over']);
    expect(ended).toHaveBeenCalledOnce();
    // No match: nothing is queued, and what arrives late for the old one is dropped.
    expect(g.lanes[0]!.send({ t: 'late' })).toBe(0);
    g.hostRoom.channel('action').send(batchOf('match-one', [{ t: 'stale' }])); g.relay.flush();
    expect(g.heard[1]!.map(e => e.t)).toEqual(['before', 'over']);
  });

  it('drops a batch of another match, anything that is not a batch, and a guest\'s word from anyone but the host', () => {
    const g = rig();
    const send = (room: Room, data: unknown, to?: string) => { room.channel('action').send(data, to); g.relay.flush(); };
    send(g.hostRoom, batchOf('another-match', [{ t: 'old' }]));
    send(g.hostRoom, { match: 'match-one', data: { t: 'old-form' } });
    send(g.hostRoom, 'text'); send(g.hostRoom, new Uint8Array([1, 2, 3])); send(g.hostRoom, null);
    send(g.guestRooms[0]!, batchOf('match-one', [{ t: 'from-a-guest' }]), 'g2');
    expect(g.heard[1]).toEqual([]); expect(g.heard[2]).toEqual([]);
    send(g.hostRoom, batchOf('match-one', [{ t: 'good' }, 7, null, 'x', { t: 'also' }]));
    expect(g.heard[1]).toEqual([{ t: 'good' }, 7, null, 'x', { t: 'also' }]);
  });

  it('a handler that throws loses that event only, and an event that ends the match stops the rest of its batch', () => {
    const relay = new Relay();
    const door = () => new Room('door', new Relay());
    const hostRoom = relay.open('host-peer');
    const host = new Lobby({ main: hostRoom, door }, true, 'HOST', 'test');
    const guest = new Lobby({ main: relay.open('g1'), door }, false, 'GUEST', 'test');
    relay.flush(); host.startMatch('crucible', 'match-one'); relay.flush();
    const got: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    guest.events<Ev>('action', event => {
      if (event.t === 'bad') throw new Error('junk');
      got.push(event.t);
      if (event.t === 'leave') guest.away(false);
    });
    hostRoom.channel('action').send(batchOf('match-one', [{ t: 'a' }, { t: 'bad' }, { t: 'b' }, { t: 'leave' }, { t: 'after' }])); relay.flush();
    expect(got).toEqual(['a', 'b', 'leave']);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('backpressure on the event lane', () => {
  it('a guest that is behind gets the facts and not the cosmetics; the others get everything', () => {
    const g = rig();
    g.hostRoom.queued.set('g1', SLOW_BYTES + 1);
    // The backlog is judged as a message is flushed to the peer.
    g.lanes[0]!.send({ t: 'fact' });
    expect(g.host.pressure.of('g1')).toBe('slow');
    expect(g.lanes[0]!.send({ t: 'tracer' }, undefined, undefined, true)).toBe(1);
    expect(g.lanes[0]!.send({ t: 'kill' })).toBe(2);
    expect(g.actions().filter(p => p.to === 'g1').map(p => p.events[0])).toEqual(['fact', 'kill']);
    expect(g.host.pressure.stats.dropped).toBe(1);
    // Still over the clear mark: still slow. Under it: everything again.
    g.hostRoom.queued.set('g1', CLEAR_BYTES + 1);
    g.lanes[0]!.send({ t: 'fact' });
    expect(g.lanes[0]!.send({ t: 'tracer' }, undefined, undefined, true)).toBe(1);
    g.hostRoom.queued.set('g1', 0);
    g.lanes[0]!.send({ t: 'fact' });
    expect(g.lanes[0]!.send({ t: 'tracer' }, undefined, undefined, true)).toBe(2);
    expect(g.seats).toEqual([]);
  });

  it('a stalled guest is cut, nothing more is queued for it, and it is handed the world again once its queue has drained', () => {
    const g = rig();
    const lines: string[] = [];
    g.host.onChange = () => { const last = g.host.chat.at(-1)?.text; if (last && lines.at(-1) !== last) lines.push(last); };
    g.hostRoom.queued.set('g1', STALLED_BYTES + 1);
    expect(g.lanes[0]!.send({ t: 'fact' })).toBe(2);
    // The event that found the stall is not sent to that guest: its stream stops here.
    expect(g.actions().map(p => p.to)).toEqual(['g2']);
    const seat = g.host.players.find(p => p.id === 'g1')!;
    expect([seat.state, seat.away]).toEqual(['lost', true]);
    expect(g.seats).toEqual([['g1', { kind: 'lost' }]]);
    expect(lines.at(-1)).toBe('GUEST1 fell behind (a slow connection).');
    for (let i = 0; i < 5; i++) expect(g.lanes[0]!.send({ t: 'fact' })).toBe(1);
    expect(g.actions().every(p => p.to === 'g2')).toBe(true);
    // The guest is heard (its page says where it is) while the queue is still full: it stays out.
    g.relay.flush();
    g.lobbies[0]!.setReady(true); g.relay.flush();
    expect(seat.state).toBe('lost');
    // The queue has drained: the next word from it brings it back, as a rejoin, so the world catches it up.
    g.hostRoom.queued.set('g1', 0);
    g.lobbies[0]!.setReady(true); g.relay.flush();
    expect([seat.state, seat.away]).toEqual([undefined, false]);
    expect(g.seats.at(-1)).toEqual(['g1', { kind: 'in', rejoin: true }]);
    expect(g.lanes[0]!.send({ t: 'fact' })).toBe(2);
    expect(g.host.pressure.stats.stalls).toBe(1);
  });

  it('a reliable message the transport lost cuts the guest at once: its stream has a hole', () => {
    const g = rig();
    g.lanes[0]!.send({ t: 'fact' });
    g.hostRoom.lost.set('g2', 1);
    g.lanes[0]!.send({ t: 'fact' });
    expect(g.host.players.find(p => p.id === 'g2')!.state).toBe('lost');
    expect(g.host.players.find(p => p.id === 'g1')!.state).toBeUndefined();
  });

  it('a guest whose own link to the host is behind leaves its cosmetics out and keeps sending its facts', () => {
    const g = rig(1);
    g.guestRooms[0]!.queued.set('host-peer', STALLED_BYTES + 1);
    expect(g.lanes[1]!.send({ t: 'hit' })).toBe(1);
    expect(g.lanes[1]!.send({ t: 'fire' }, undefined, undefined, true)).toBe(0);
    expect(g.lanes[1]!.send({ t: 'hit' })).toBe(1);
    g.relay.flush();
    expect(g.heard[0]!.map(e => e.t)).toEqual(['hit', 'hit']);
  });
});
