/**
 * Host: a guest's event that needs that guest's body in the world (to draw a shot from it, to test a reach) and arrived
 * before the body did. A guest's first pose crosses on the unreliable lane and their first shot on the reliable one, so the
 * shot can win the race; so can anything sent in the moment a returning player's body is being rebuilt. Such an event used to
 * be dropped without a word. It is kept here for a moment, in order, and run when the body is there.
 *
 * Damage does not wait here at all: a `hit`, `status` or `vhit` claim is applied at once, body or no body (claims.ts).
 */
import type { RemotePlayer } from '../remote';
import type { WorldContext, WorldModule } from './context';

/** How long an event waits for its sender's body. A first pose is 50 ms away; a body being rebuilt a few frames. */
export const LATE_MS = 2000;
/** Events kept per sender: a held trigger for that long, not a flood. */
export const LATE_KEPT = 96;

interface Held { until: number; what: string; run: (remote: RemotePlayer, now: number) => void }

export class Late implements WorldModule {
  /** For the dev log and the proofs: events kept for a body, run once it came, and given up on (`dropped` should stay 0). */
  readonly books = { held: 0, run: 0, dropped: 0 };
  private readonly queues = new Map<string, Held[]>();

  constructor(private readonly w: WorldContext) {}

  /**
   * Runs `run` with the sender's body: now if it is in the world, else when it arrives, behind whatever of theirs is
   * already waiting. `what` names the event for the log.
   */
  with(from: string, now: number, what: string, run: (remote: RemotePlayer, now: number) => void): void {
    const queue = this.queues.get(from);
    const remote = this.w.sender(from, now);
    if (remote) {
      if (queue) this.flush(from, queue, remote, now);
      run(remote, now);
      return;
    }
    const list = queue ?? [];
    if (!queue) this.queues.set(from, list);
    if (list.length >= LATE_KEPT) this.drop(from, list.splice(0, 1));
    list.push({ until: now + LATE_MS, what, run });
    this.books.held++;
  }

  private flush(from: string, queue: Held[], remote: RemotePlayer, now: number): void {
    this.queues.delete(from);
    for (const held of queue) {
      this.books.run++;
      try { held.run(remote, now); } catch (error) { console.warn('[coop] A kept event could not be applied', held.what, error); }
    }
  }

  private drop(from: string, gone: Held[]): void {
    if (gone.length === 0) return;
    this.books.dropped += gone.length;
    const name = this.w.session.lobby.players.find(p => p.id === from)?.name ?? from;
    console.warn(`[coop] Dropped ${gone.length} event(s) from ${name} (${gone[0]!.what}): their body never came into the world; ${this.books.dropped} dropped so far`);
  }

  update(now: number): void {
    if (this.queues.size === 0) return;
    for (const [from, queue] of this.queues) {
      const remote = this.w.sender(from, now);
      if (remote) { this.flush(from, queue, remote, now); continue; }
      let stale = 0;
      while (stale < queue.length && queue[stale]!.until <= now) stale++;
      if (stale > 0) this.drop(from, queue.splice(0, stale));
      if (queue.length === 0) this.queues.delete(from);
    }
  }

  dispose(): void { this.queues.clear(); }
}
