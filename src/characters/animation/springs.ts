/** Damped 3-vector springs. Flinches, recoil and landings all ride on these. */
export class Spring3 {
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  constructor(readonly stiffness: number, readonly damping: number) {}

  kick(x: number, y: number, z: number): void {
    this.vx += x; this.vy += y; this.vz += z;
  }

  step(dt: number): void {
    // Semi-implicit Euler at a fixed ceiling step stays stable for any frame time.
    let left = dt;
    const k = this.stiffness, c = this.damping;
    while (left > 1e-5) {
      const h = left > 1 / 90 ? 1 / 90 : left;
      this.vx += (-k * this.x - c * this.vx) * h;
      this.vy += (-k * this.y - c * this.vy) * h;
      this.vz += (-k * this.z - c * this.vz) * h;
      this.x += this.vx * h;
      this.y += this.vy * h;
      this.z += this.vz * h;
      left -= h;
    }
  }

  get active(): boolean {
    return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z) + Math.abs(this.vx) + Math.abs(this.vy) + Math.abs(this.vz) > 1e-3;
  }

  clear(): void {
    this.x = this.y = this.z = this.vx = this.vy = this.vz = 0;
  }
}

/**
 * The spring a hit rides on. It goes out on one stiffness and comes back on a softer one with the same damping, so the way
 * out is quick (it peaks in four frames) and the way back is overdamped: it comes to rest from the side it went out on and
 * cannot cross it, whatever the kick. That is the shape of a body taking a round, and it is why this one may be large where
 * the plain spring had to be small: at half its damping the plain spring rang past rest by a seventh of its lean.
 */
export class HitSpring {
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  private readonly damping: number;
  /** Speed a kick must give for the spring to peak at 1 from rest. */
  private readonly perPeak: number;

  /** `out` and `back` are rates in rad/s (stiffness is their square); `ratio` is the damping ratio on the way out, under 1. */
  constructor(private readonly out: number, private readonly back: number, ratio: number) {
    this.damping = 2 * ratio * out;
    this.perPeak = 1 / peakOf(out, this.damping);
  }

  /**
   * A kick sized by the peak it should reach from rest, per axis, and held to `limit`: it asks for no more than would take
   * the spring from where it is to its limit, so one very hard round cannot fold a body in half and a stream of rounds leans
   * it to the limit and holds it there.
   */
  hit(x: number, y: number, z: number, limit: number): void {
    const k = this.perPeak;
    this.vx += room(this.x, x, limit) * k;
    this.vy += room(this.y, y, limit) * k;
    this.vz += room(this.z, z, limit) * k;
  }

  step(dt: number): void {
    let left = dt;
    const out = this.out * this.out, back = this.back * this.back, c = this.damping;
    while (left > 1e-5) {
      const h = left > 1 / 120 ? 1 / 120 : left;
      // Heading back to rest: the softer spring, on which this damping is past critical.
      this.vx += (-(this.x * this.vx < 0 ? back : out) * this.x - c * this.vx) * h;
      this.vy += (-(this.y * this.vy < 0 ? back : out) * this.y - c * this.vy) * h;
      this.vz += (-(this.z * this.vz < 0 ? back : out) * this.z - c * this.vz) * h;
      this.x += this.vx * h;
      this.y += this.vy * h;
      this.z += this.vz * h;
      left -= h;
    }
  }

  get active(): boolean {
    return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z) + Math.abs(this.vx) + Math.abs(this.vy) + Math.abs(this.vz) > 1e-3;
  }

  clear(): void {
    this.x = this.y = this.z = this.vx = this.vy = this.vz = 0;
  }
}

const peaks = new Map<string, number>();
/**
 * How far a spring of this rate and damping gets from a kick of 1 a second, measured on the stepper itself and kept: the
 * formula is 4% to 17% off what the stepper does at these rates, and a hit is sized by the peak it should reach.
 */
function peakOf(rate: number, damping: number): number {
  const key = `${rate}:${damping}`;
  let peak = peaks.get(key);
  if (peak !== undefined) return peak;
  const k = rate * rate, h = 1 / 120;
  let x = 0, v = 1;
  peak = 0;
  for (let i = 0; i < 240 && v > 0; i++) {
    v += (-k * x - damping * v) * h;
    x += v * h;
    if (x > peak) peak = x;
  }
  peaks.set(key, peak);
  return peak;
}

/** As much of `kick` as takes a spring at `at` no further than `limit` from rest. A kick back toward rest lands whole. */
function room(at: number, kick: number, limit: number): number {
  const to = at + kick;
  if (to > limit) return Math.max(0, limit - at);
  if (to < -limit) return Math.min(0, -limit - at);
  return kick;
}
