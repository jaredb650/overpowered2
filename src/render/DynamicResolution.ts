/** Resolution steps. Discrete, because every change reallocates the render targets. */
const STEPS = [1, 0.92, 0.85, 0.78, 0.7, 0.62] as const;
/** Smoothed frame interval, in milliseconds, that counts as missing 60 fps. */
const MISS_MS = 18.4;
/** Interval that counts as holding it. Vsync pins a healthy frame near 16.7 with no way to see the slack. */
const HOLD_MS = 17.4;
const DOWN_AFTER_S = 0.6;
const UP_AFTER_S = 4;
const COOLDOWN_S = 1.5;

/**
 * Follows the frame interval and steps internal resolution. It drops quickly and climbs slowly, and
 * because vsync hides headroom a climb is only ever a trial: each failed one doubles the wait before
 * the next, so it settles instead of hunting. The interval is used rather than GPU timer queries
 * because those are not trustworthy under ANGLE on Metal.
 */
export class DynamicResolution {
  /** Off under automation: screenshots should not depend on how busy the machine was. */
  enabled = !navigator.webdriver;
  private index = 0;
  private smoothed = 16.7;
  private overFor = 0;
  private underFor = 0;
  private cooldown = 0;
  private climbWait = UP_AFTER_S;
  private sinceClimb = Infinity;

  get scale(): number {
    return STEPS[this.index]!;
  }

  /** Returns true when the scale changed. */
  update(realDt: number): boolean {
    if (!this.enabled || realDt <= 0) return false;
    this.smoothed += (realDt * 1000 - this.smoothed) * (1 - Math.exp(-realDt * 6));
    this.cooldown -= realDt;
    this.sinceClimb += realDt;
    this.overFor = this.smoothed > MISS_MS ? this.overFor + realDt : 0;
    this.underFor = this.smoothed < HOLD_MS ? this.underFor + realDt : 0;
    if (this.cooldown > 0) return false;
    if (this.overFor > DOWN_AFTER_S && this.index < STEPS.length - 1) {
      if (this.sinceClimb < 3) this.climbWait = Math.min(this.climbWait * 2, 60);
      this.index++;
      this.overFor = this.underFor = 0;
      this.cooldown = COOLDOWN_S;
      return true;
    }
    if (this.underFor > this.climbWait && this.index > 0) {
      this.index--;
      this.underFor = 0;
      this.cooldown = COOLDOWN_S;
      this.sinceClimb = 0;
      return true;
    }
    return false;
  }
}
