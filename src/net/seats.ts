/**
 * What happens to a seat, as hooks for the game (host only). The lobby says a player came into the world, lost their
 * connection or is gone for good (`Lobby.onSeat`); this turns that into the four things the co-op world acts on. One
 * listener each is the rule: `CoopWorld` subscribes once and drives every module from there (world.ts).
 */
import type { LobbyPlayer, SeatEvent } from './lobby';

/** A list of listeners. `add` returns the way to take one off again. */
export class Hook<A extends unknown[]> {
  private readonly list: ((...args: A) => void)[] = [];
  add(fn: (...args: A) => void): () => void {
    this.list.push(fn);
    return () => { const i = this.list.indexOf(fn); if (i >= 0) this.list.splice(i, 1); };
  }
  emit(...args: A): void { for (const fn of [...this.list]) fn(...args); }
}

/**
 * `seat` is the player's stable key in this room (LobbyPlayer.seat); `id` only their current connection.
 * `rejoin`: this seat has been in this match's world before. `same`: and it is the same page as then (its connection dropped
 * and came back), so it still holds its own kit, purse and world; a new page (a reload, back from the lobby page) holds nothing.
 */
export interface Arrival { seat: string; slot: number; name: string; rejoin: boolean; same: boolean }

export class SeatHooks {
  /**
   * A player is in the world. Their first time in this match, or again (`rejoin`: a reload, a reconnect after a drop, back
   * from the lobby page). The moment to hand them everything they missed; key anything kept for them by `seat`.
   */
  readonly onArrived = new Hook<[id: string, info: Arrival]>();
  /** A player's connection dropped. Their seat is kept (SEAT_GRACE_MS): hold their state, let go of what they held in the world. */
  readonly onLost = new Hook<[id: string, seat: string]>();
  /** A seat is given up for good (the grace ran out, or they quit). */
  readonly onGone = new Hook<[seat: string]>();
  /**
   * A connection id that will never be heard from again: the seat came back on a new page (its old id), or is gone.
   * Whatever is kept by connection id (rate counters, relay budgets) is dropped here.
   */
  readonly onForget = new Hook<[id: string]>();
  /** Each seat's connection the last time it came in, to tell a new page from the same one back after a blip. */
  private readonly lastId = new Map<string, string>();

  /** What the lobby says about a seat (`Lobby.onSeat`). */
  feed(player: LobbyPlayer, event: SeatEvent): void {
    const seat = player.seat ?? player.id;
    if (event.kind === 'lost') {
      // The connection that dropped is the one a return is measured against (a seat that was in from the start has no other).
      this.lastId.set(seat, player.id);
      return this.onLost.emit(player.id, seat);
    }
    const last = this.lastId.get(seat);
    if (event.kind === 'gone') {
      this.lastId.delete(seat);
      this.onGone.emit(seat);
      for (const id of new Set([last, player.id])) if (id) this.onForget.emit(id);
      return;
    }
    this.lastId.set(seat, player.id);
    if (last && last !== player.id) this.onForget.emit(last);
    this.onArrived.emit(player.id, { seat, slot: player.slot, name: player.name, rejoin: event.rejoin, same: event.rejoin && last === player.id });
  }
}
