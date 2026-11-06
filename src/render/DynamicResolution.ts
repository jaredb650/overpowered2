/**
 * Resolution steps. A step only moves the viewport inside targets allocated at full size, so it is free. They
 * stay discrete because the frame interval is too coarse a signal to steer anything finer.
 */
const STEPS = [1, 0.92, 0.85, 0.78, 0.7, 0.62] as const;
/** Smoothed frame interval, in milliseconds, that counts as missing 60 fps. */
const MISS_MS = 18.4;
/** Interval that counts as holding it. Vsync pins a healthy frame near 16.7 with no way to see the slack. */
const HOLD_MS = 17.4;
/** Interval of a game fallen to half rate. One step will not get it back, so this takes two. */
const HALF_RATE_MS = 24;
const DOWN_AFTER_S = 0.25;
const UP_AFTER_S = 4;
/** Long enough for the smoothed interval to show what the last step did. */
const COOLDOWN_S = 0.45;
/** The floor has to beat the interval the descent started from by this much, or resolution was not the problem. */
const FLOOR_GAIN_MS = 1;
/** Rest after a fruitless descent. The cause, such as a browser capping rAF on battery, rarely clears sooner. */
const GIVE_UP_S = 30;

function drsFlag(): boolean | null {
  const flag = new URLSearchParams(location.search).get('drs');
  return flag === null ? null : flag === '1';
}

/**
 * Follows the frame interval and steps internal resolution. It drops quickly and climbs slowly, and
 * because vsync hides headroom a climb is only ever a trial: each failed one doubles the wait before
 * the next, so it settles instead of hunting. The interval is used rather than GPU timer queries
 * because those are not trustworthy under ANGLE on Metal.
 */
export class DynamicResolution {
  /** Off under automation, so screenshots do not depend on how busy the machine was. `?drs=1` forces it on, `?drs=0` off. */
  enabled = drsFlag() ?? !navigator.webdriver;
  private index = 0;
  private smoothed = 16.7;
  private overFor = 0;
  private underFor = 0;
  private cooldown = 0;
  private climbWait = UP_AFTER_S;
  private sinceClimb = Infinity;
  private descentFrom = 0;
  private giveUp = 0;

  get scale(): number {
    return STEPS[this.index]!;
  }

  /** Returns true when the scale changed. */
  update(realDt: number): boolean {
    if (!this.enabled || realDt <= 0) return false;
    this.smoothed += (realDt * 1000 - this.smoothed) * (1 - Math.exp(-realDt * 6));
    this.cooldown -= realDt;
    this.giveUp -= realDt;
    this.sinceClimb += realDt;
    this.overFor = this.smoothed > MISS_MS ? this.overFor + realDt : 0;
    this.underFor = this.smoothed < HOLD_MS ? this.underFor + realDt : 0;
    if (this.cooldown > 0 || this.giveUp > 0) return false;
    if (this.overFor > DOWN_AFTER_S && this.index === STEPS.length - 1) {
      if (this.smoothed < this.descentFrom - FLOOR_GAIN_MS) return false;
      // A CPU-bound frame or a capped frame rate looks like a slow GPU until the whole range has been tried.
      this.index = 0;
      this.giveUp = GIVE_UP_S;
      return true;
    }
    if (this.overFor > DOWN_AFTER_S) {
      if (this.index === 0) this.descentFrom = this.smoothed;
      if (this.sinceClimb < 3) this.climbWait = Math.min(this.climbWait * 2, 60);
      this.index = Math.min(this.index + (this.smoothed > HALF_RATE_MS ? 2 : 1), STEPS.length - 1);
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
