/**
 * A guest whose world has stopped being fed, on its own screen. The host skips a guest that is behind for everything
 * latest-wins (enemy snapshots, poses) and, past the stalled mark, cuts it out of the match until its queue has drained
 * (lobby.ts `stall`, "The wire"). The cut guest cannot be *told*: every word from the host, reliable or not, is behind the
 * very backlog it was cut for, and arrives as the queue empties, which is when it is over. So the guest reads it off what it
 * can see: the host's latest-wins data has stopped while the line itself is still up (a line that is down says
 * "Reconnecting to host…" instead). The session's status line then says its connection is too slow, and clears on the first
 * packet that arrives, which is the catch-up landing.
 *
 * Time is counted in frames of this page, each for at most `FRAME_MOST_MS`: a page that stood still itself (a hidden tab, a
 * long hitch) was not starved, and must not say so for the frame it wakes on.
 */

/** With nothing fresh from the host for this long, the guest is starved. Healthy, the host's pose alone arrives 20 times a second. */
export const STARVED_MS = 1000;
/** The most of one frame that counts toward the drought. */
export const FRAME_MOST_MS = 100;

export class Starved {
  private fed = 0;
  private dry = 0;
  private last = 0;

  /**
   * Once a frame. `fedAt`: when the host's latest-wins data last arrived on this page (0: none yet, so nothing can have
   * stopped). True while the page is starved.
   */
  update(now: number, fedAt: number): boolean {
    const frame = this.last > 0 ? Math.max(0, Math.min(now - this.last, FRAME_MOST_MS)) : 0;
    this.last = now;
    if (fedAt <= 0 || fedAt !== this.fed) {
      this.fed = fedAt;
      this.dry = 0;
      return false;
    }
    this.dry += frame;
    return this.dry >= STARVED_MS;
  }

  /** A new world, or a state in which silence is expected (the host's tab hidden, the run over): start again. */
  reset(): void {
    this.dry = 0;
    this.last = 0;
  }
}
