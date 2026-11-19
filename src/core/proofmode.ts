/**
 * Proof mode: switches for the browser proofs (tools/scripts/coop-kit.mjs, docs/notes/coop.md "Testing"), which run two to
 * four game pages per run and many runs at once on one machine. Measured there, drawing is 80 to 90% of a page's frame
 * (13 to 22 ms of main thread against 2.5 ms for the whole simulation), so a page whose picture nobody is watching draws only
 * a few frames a second and simulates every frame as before.
 *
 * **On only when both are true**, the same gate as the loopback transport (net/mode.ts): the page is a dev build or is served
 * from this computer, and the test harness put `__op2Proof` on the window before the game loaded. The public site ignores
 * it; nothing a real player can reach sets it.
 *
 *   window.__op2Proof = { draw: 0, clock: 60 }
 *     draw    drawn frames a second; 0 draws none; absent, every frame
 *     clock   the loop steps this many times a second on a worker's timer instead of the browser's animation frames,
 *             which a busy GPU process can hand out late to the second and third window of a browser; absent or 0,
 *             animation frames as a player has them (the kit's default)
 *   window.__op2.proof.show(3)          // the next 3 frames are drawn whatever the rate (a screenshot's fresh picture)
 *   window.__op2.proof.rate(60)         // changes the draw rate while running (a stretch that measures drawing)
 */
export interface ProofSwitches {
  /** Drawn frames a second. Absent: every frame. */
  draw?: number;
  /** Loop steps a second on a timer. Absent: the browser's animation frames. */
  clock?: number;
}

/** The switches the harness asked for, or null on a page where they are not allowed or not asked for. */
export function proofSwitches(
  given: unknown = (globalThis as { __op2Proof?: unknown }).__op2Proof,
  host: string = typeof location === 'undefined' ? '' : location.hostname,
  dev: boolean = import.meta.env?.DEV === true,
): ProofSwitches | null {
  if (!given || typeof given !== 'object') return null;
  if (!(dev || host === 'localhost' || host === '127.0.0.1' || host === '[::1]')) return null;
  const { draw, clock } = given as ProofSwitches;
  const out: ProofSwitches = {};
  if (typeof draw === 'number' && draw >= 0) out.draw = draw;
  if (typeof clock === 'number' && clock > 0) out.clock = Math.min(clock, 240);
  return out;
}

/**
 * True when a timer tick should step the loop: not a tick from a backlog (after a stalled main thread the queued ticks
 * arrive together, and playing them out would be a burst of zero-length frames).
 */
export function clockDue(now: number, last: number, hz: number): boolean {
  return now - last >= 500 / hz;
}

/** Decides, frame by frame, whether a proof page draws. Time is the page's real clock in seconds. */
export class DrawGate {
  private next = 0;
  private owed = 0;
  /** Frames drawn and frames skipped since the page loaded. */
  drawn = 0;
  skipped = 0;

  constructor(private hz: number) {}

  /** True when this frame is to be drawn. */
  due(now: number): boolean {
    let draw = false;
    if (this.owed > 0) {
      this.owed--;
      draw = true;
    } else if (this.hz > 0 && now >= this.next) draw = true;
    if (draw) {
      // From now, not from the last slot: after a long frame the page does not draw a burst to catch up.
      this.next = now + 1 / this.hz - 0.004;
      this.drawn++;
    } else this.skipped++;
    return draw;
  }

  /** The next `frames` frames are drawn whatever the rate. */
  show(frames = 2): void {
    this.owed = Math.max(this.owed, frames);
  }

  rate(hz: number): void {
    this.hz = hz;
    this.next = 0;
  }
}

/** This page's draw gate, or null where every frame is drawn (every real player's page). */
export function drawGate(switches: ProofSwitches | null = proofSwitches()): DrawGate | null {
  return switches && switches.draw !== undefined ? new DrawGate(switches.draw) : null;
}
