import type { NetError, NetRoom } from './room';

/**
 * For tests only. An in-memory relay. Peers in one room with the same password connect. A wrong one fails the handshake on one end only,
 * as trystero does: the end that received the offer, which is down to how the peer ids compare. `failsAt` picks it.
 */
export class Hub {
  private rooms: FakeRoom[] = [];
  private queue: (() => void)[] = [];
  failsAt: 'newcomer' | 'resident' = 'newcomer';
  /** Pairs of peer ids whose link is down: nothing passes between them. */
  private readonly cut = new Set<string>();
  private key(a: string, b: string): string { return a < b ? `${a}|${b}` : `${b}|${a}`; }

  /** The link between two peers goes quiet: nothing arrives either way, and neither is told (a closed lid, a dead Wi-Fi). */
  mute(a: string, b: string): void { this.cut.add(this.key(a, b)); }
  /** The same link works again; nothing sent meanwhile is delivered. */
  unmute(a: string, b: string): void { this.cut.delete(this.key(a, b)); }
  /** The transport gives the link up: both ends are told the other left, as WebRTC does some seconds into a drop. */
  sever(a: string, b: string): void {
    this.mute(a, b);
    for (const r of this.rooms) if (r.id === a || r.id === b) this.later(() => r.left(r.id === a ? b : a));
  }
  /** And finds it again: both ends are told the other joined, under the same ids. */
  mend(a: string, b: string): void {
    this.unmute(a, b);
    for (const r of this.rooms) if (r.id === a || r.id === b) this.later(() => r.joined(r.id === a ? b : a));
  }

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
      if (r === from || r.roomId !== from.roomId || r.password !== from.password || (to && r.id !== to) || this.cut.has(this.key(r.id, from.id))) continue;
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

export class FakeRoom implements NetRoom {
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

