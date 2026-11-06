/**
 * The two counter shapes the ladder is built from.
 *
 * Sliding windows take timestamps from time.realElapsed: the first game's perk counters were wall-clock, so kills
 * in SLOWMO count at the speed the player makes them. realElapsed does not advance while paused, which is the
 * wall-clock bug the first game had.
 */

/** Timestamps within the last `span` seconds. Fixed capacity; the oldest entry is overwritten when full. */
export class TimeWindow {
  private readonly stamps: Float64Array;
  private head = 0;
  private size = 0;

  constructor(readonly span: number, capacity = 64) {
    this.stamps = new Float64Array(capacity);
  }

  /** Records an event and returns how many fall inside the window, this one included. */
  push(now: number): number {
    const cap = this.stamps.length;
    this.stamps[(this.head + this.size) % cap] = now;
    if (this.size < cap) this.size++;
    else this.head = (this.head + 1) % cap;
    return this.count(now);
  }

  count(now: number): number {
    const cap = this.stamps.length;
    while (this.size > 0 && now - this.stamps[this.head]! > this.span) {
      this.head = (this.head + 1) % cap;
      this.size--;
    }
    return this.size;
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
  }
}

/** Gap-based combo: the next kill must land within `window` seconds of the last one. */
export class Combo {
  count = 0;
  left = 0;

  constructor(readonly window: number) {}

  /** A kill landed. Returns the new count. */
  hit(): number {
    this.count = this.left > 0 ? this.count + 1 : 1;
    this.left = this.window;
    return this.count;
  }

  /** Runs the gap timer. Returns true on the frame the combo dies. */
  tick(dt: number): boolean {
    if (this.left <= 0) return false;
    this.left -= dt;
    if (this.left > 0) return false;
    this.left = 0;
    this.count = 0;
    return true;
  }

  clear(): void {
    this.count = 0;
    this.left = 0;
  }
}
