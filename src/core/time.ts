/**
 * Game clock. Three clocks run side by side:
 *  - realDt: wall time, clamped. UI, audio ducking and camera shake use it.
 *  - dt: world time. Enemies, projectiles, particles and physics use it. Slowed by slow-mo and hit-stop.
 *  - playerDt: player time. Slow-mo does not touch it (the player keeps full speed in SLOWMO, like the original),
 *    but hit-stop does, so the player feels the impact too.
 */
interface ScaleRequest {
  scale: number;
  fadeIn: number;
  fadeOut: number;
  /** 0..1 blend toward `scale`. */
  weight: number;
  releasing: boolean;
}

export class GameTime {
  realDt = 0;
  dt = 0;
  playerDt = 0;
  /** Combined world time scale after slow-mo and hit-stop. */
  scale = 1;
  /** Slow-mo factor alone, without hit-stop. The audio system follows this. */
  slowmo = 1;
  elapsed = 0;
  playerElapsed = 0;
  realElapsed = 0;
  frame = 0;
  paused = false;

  private hitStopLeft = 0;
  private hitStopScale = 1;
  private requests = new Map<string, ScaleRequest>();

  /** Freeze-frame. Stacks by taking the longer duration and the stronger scale. */
  hitStop(seconds: number, scale = 0.04): void {
    if (seconds <= 0) return;
    this.hitStopLeft = Math.max(this.hitStopLeft, seconds);
    this.hitStopScale = Math.min(this.hitStopLeft > 0 ? this.hitStopScale : 1, scale);
  }

  /** Requests a world time scale under a named key. The strongest active request wins. */
  pushScale(id: string, scale: number, fadeIn = 0.12, fadeOut = 0.25): void {
    const existing = this.requests.get(id);
    if (existing) {
      existing.scale = scale;
      existing.fadeIn = fadeIn;
      existing.fadeOut = fadeOut;
      existing.releasing = false;
      return;
    }
    this.requests.set(id, { scale, fadeIn, fadeOut, weight: 0, releasing: false });
  }

  popScale(id: string): void {
    const r = this.requests.get(id);
    if (r) r.releasing = true;
  }

  clearScales(): void {
    this.requests.clear();
    this.hitStopLeft = 0;
    this.hitStopScale = 1;
    this.scale = 1;
    this.slowmo = 1;
  }

  tick(rawSeconds: number): void {
    const real = Math.min(Math.max(rawSeconds, 0), 1 / 20);
    this.realDt = real;
    this.frame++;
    if (this.paused) {
      this.dt = 0;
      this.playerDt = 0;
      return;
    }
    this.realElapsed += real;

    let slow = 1;
    for (const [id, r] of this.requests) {
      if (r.releasing) {
        r.weight -= r.fadeOut > 0 ? real / r.fadeOut : 1;
        if (r.weight <= 0) {
          this.requests.delete(id);
          continue;
        }
      } else {
        r.weight = Math.min(1, r.weight + (r.fadeIn > 0 ? real / r.fadeIn : 1));
      }
      slow = Math.min(slow, 1 + (r.scale - 1) * r.weight);
    }
    this.slowmo = slow;

    let stop = 1;
    if (this.hitStopLeft > 0) {
      stop = this.hitStopScale;
      this.hitStopLeft -= real;
      if (this.hitStopLeft <= 0) this.hitStopScale = 1;
    }

    this.scale = slow * stop;
    this.dt = real * this.scale;
    this.playerDt = real * stop;
    this.elapsed += this.dt;
    this.playerElapsed += this.playerDt;
  }
}
