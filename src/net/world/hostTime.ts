/**
 * How late a host-stamped event is. The host stamps an event with its own `performance.now()`; the two clocks do not agree and
 * the link has a usual delay, so a guest only learns one number: how much later than usual this one arrived. An event that
 * arrived late starts its timeline that far in, so what it leads up to (a shot, a blast) still lands when the host's `hurt` does.
 */
export class HostTime {
  /** The smallest (arrival - stamp) seen lately, in ms: the clocks' offset plus the link's usual delay. */
  private base = Infinity;
  private at = 0;

  /** Seconds this event took beyond the link's usual delay, from 0 to `cap`. */
  late(stamp: number, now: number, cap = 0.4): number {
    if (!Number.isFinite(stamp) || !Number.isFinite(now) || now < 0 || stamp < 0) return 0;
    const sample = now - stamp;
    const elapsed = Math.max(0, now - this.at);
    // A huge sudden jump in offset (>30 s, e.g. host page reload) resets the floor instead of poisoning all future events.
    if (Number.isFinite(this.base) && Math.abs(sample - this.base) > 30_000) {
      this.base = sample;
      this.at = now;
      return 0;
    }
    // The floor creeps up a millisecond a second, so a clock that drifts or a link that got slower is forgotten.
    this.base = Math.min(sample, this.base + elapsed * 0.001);
    this.at = now;
    return Math.max(0, Math.min(cap, (sample - this.base) / 1000));
  }
}

/** The host's stamp for an event. */
export const hostStamp = (): number => Math.round(performance.now());
