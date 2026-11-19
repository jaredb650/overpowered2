/**
 * Backpressure for the reliable event lane. The unreliable lanes skip a peer that is behind by themselves (room.ts
 * `latest`); a reliable lane cannot skip, since what it carries are facts, so without a rule a slow or stalled peer's
 * queue grows for as long as the match runs, and the transport ends up losing messages on its own (trystero gives a
 * message up after ten seconds of a data channel that does not drain).
 *
 * The rule, judged per peer each time something is flushed to it, from the bytes queued for it that the network has not
 * taken (`NetRoom.buffered`, reliable path):
 *
 * - **ok**: everything is sent.
 * - **slow**, from `SLOW_BYTES` queued until the queue is back under `CLEAR_BYTES`: events classed `cosmetic` or `latest`
 *   are not queued for that peer (a tracer, a blood puff, a sound, a state the next send replaces: things whose loss
 *   leaves nothing wrong). Facts still are.
 * - **stalled**: `STALLED_BYTES` queued, or slow for `STALLED_MS` on end (facts alone are more than the link carries), or
 *   the transport reporting a reliable message lost (`NetRoom.failed`). The stream to that peer now has, or is about to
 *   have, a hole, so nothing more is queued: the host treats the seat as lost and the session brings the player back
 *   through its reconnect path, with the whole catch-up, once the queue has drained (lobby.ts `stall`).
 *
 * Every event type is classed in its own module's declaration (`…_WIRE` tables, gathered in worldProtocol.ts).
 */

/**
 * Whether an event may be left out for a peer that is behind. A `fact` never is. A `cosmetic` is a picture or a sound of
 * one moment (a tracer, a blood puff, a line said). A `latest` is a whole state sent again and again (the team's cards,
 * the vehicles' places): the next one replaces it.
 */
export type WireClass = 'fact' | 'cosmetic' | 'latest';
/** A module's table: every event type it declares, classed. */
export type WireClasses<E extends { t: string }> = { readonly [K in E['t']]: WireClass };

/** Queued bytes from which a peer is slow: about a second and a half of the heaviest fight's events for one guest. */
export const SLOW_BYTES = 32 * 1024;
/** A slow peer is fine again under this, and a stalled seat may come back. */
export const CLEAR_BYTES = 8 * 1024;
/** Queued bytes at which a peer is stalled, whatever the clock says. */
export const STALLED_BYTES = 256 * 1024;
/** A peer slow for this long without a break is stalled. */
export const STALLED_MS = 10_000;

export type Verdict = 'ok' | 'slow' | 'stalled';

interface PeerPressure { slowSince: number; failed: number; verdict: Verdict }

export class Pressure {
  private readonly peers = new Map<string, PeerPressure>();
  /** Cosmetic events left out for slow peers, and peers judged stalled. */
  readonly stats = { dropped: 0, stalls: 0 };

  private peer(id: string): PeerPressure {
    let peer = this.peers.get(id);
    if (!peer) this.peers.set(id, (peer = { slowSince: -1, failed: 0, verdict: 'ok' }));
    return peer;
  }

  /**
   * Judges a peer from what is queued for it now. `failed` is the transport's running count of reliable messages to it
   * that were lost; a rise since the last look is a hole in the stream.
   */
  judge(id: string, queued: number, failed: number, now: number): Verdict {
    const peer = this.peer(id);
    let verdict: Verdict;
    if (failed > peer.failed || queued > STALLED_BYTES) verdict = 'stalled';
    else if (peer.slowSince >= 0) verdict = queued < CLEAR_BYTES ? 'ok' : now - peer.slowSince > STALLED_MS ? 'stalled' : 'slow';
    else verdict = queued > SLOW_BYTES ? 'slow' : 'ok';
    peer.failed = Math.max(peer.failed, failed);
    if (verdict === 'ok') peer.slowSince = -1;
    else if (peer.slowSince < 0) peer.slowSince = now;
    if (verdict === 'stalled' && peer.verdict !== 'stalled') this.stats.stalls++;
    peer.verdict = verdict;
    return verdict;
  }

  /** The last verdict on a peer: 'ok' for one never judged. */
  of(id: string): Verdict { return this.peers.get(id)?.verdict ?? 'ok'; }

  /** Is a cosmetic event for this peer left out? Counts it if so. */
  drops(id: string): boolean {
    if (this.of(id) === 'ok') return false;
    this.stats.dropped++;
    return true;
  }

  /** A stalled peer whose queue has drained starts again from 'ok'. Returns false while it has not. */
  clear(id: string, queued: number): boolean {
    if (queued >= CLEAR_BYTES) return false;
    const peer = this.peers.get(id);
    if (peer) { peer.slowSince = -1; peer.verdict = 'ok'; }
    return true;
  }

  forget(id: string): void { this.peers.delete(id); }
}
