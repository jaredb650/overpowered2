/**
 * Game clock. Three clocks run side by side:
 *  - realDt: wall time, clamped. UI, audio ducking and camera shake use it.
 *  - dt: world time. Enemies, projectiles, particles and physics use it. Slowed by slow-mo and hit-stop.
 *  - playerDt: player time. Slow-mo does not touch it (the player keeps full speed in SLOWMO, like the original),
 *    but hit-stop does, so the player feels the impact too.
 *
 * Co-op (net/world/clock.ts) adds two things, both off in single player:
 *  - `gate`: slow-mo is the team's, so the game's own requests (pushScale, popScale, hitStop) go to the gate instead of the
 *    clock. The gate asks the host, and what the host grants comes back through `share`.
 *  - `hostSteps`: the host's world is everyone's, so a long frame on the host is cut into several world steps (`split`)
 *    instead of being clamped, which would run the world in slow motion on every screen.
 */
/** Co-op: where the game's slow-mo requests go while slow-mo is shared (net/world/clock.ts). */
export interface TimeGate {
  push(id: string, scale: number, fadeIn: number, fadeOut: number): void;
  pop(id: string): void;
}

/** The longest world step, seconds. A longer frame is clamped to it: below 20 fps a single-player world runs slow. */
export const MAX_STEP = 1 / 20;
/** Co-op host: the longest frame it still plays out in full, the most steps it is cut into, and the longest one step may be. */
export const HOST_FRAME = 0.25;
export const HOST_STEPS = 5;
export const HOST_STEP = 0.125;
/** Co-op host: the share of a frame the extra world steps may cost. Past it the steps get longer instead of more. */
const HOST_STEP_BUDGET = 0.5;

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
  /** Co-op only: set, every pushScale, popScale and hitStop goes to it and not to this clock. */
  gate: TimeGate | null = null;
  /** Co-op host only: long frames are cut into steps (`split`), each up to HOST_STEP long. */
  hostSteps = false;
  private lastSteps = 1;

  private hitStopLeft = 0;
  private hitStopScale = 1;
  private requests = new Map<string, ScaleRequest>();

  /** Freeze-frame. Stacks by taking the longer duration and the stronger scale. */
  hitStop(seconds: number, scale = 0.04): void {
    // Co-op: a freeze-frame would stop the world on every screen, and the player's own hands with it.
    if (seconds <= 0 || this.gate) return;
    this.hitStopLeft = Math.max(this.hitStopLeft, seconds);
    this.hitStopScale = Math.min(this.hitStopLeft > 0 ? this.hitStopScale : 1, scale);
  }

  /** Requests a world time scale under a named key. The strongest active request wins. */
  pushScale(id: string, scale: number, fadeIn = 0.12, fadeOut = 0.25): void {
    if (this.gate) return this.gate.push(id, scale, fadeIn, fadeOut);
    this.share(id, scale, fadeIn, fadeOut);
  }

  popScale(id: string): void {
    if (this.gate) return this.gate.pop(id);
    this.unshare(id);
  }

  /** The request itself, past the gate. Co-op's clock calls it with what the host granted. */
  share(id: string, scale: number, fadeIn: number, fadeOut: number): void {
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

  unshare(id: string): void {
    const r = this.requests.get(id);
    if (r) r.releasing = true;
  }

  /**
   * How many world steps this frame is. One, except on a co-op host whose frame ran longer than MAX_STEP: then enough steps of
   * at most MAX_STEP to cover it, so the world keeps real speed for everyone down to 4 fps. `frameMs` is what the last frame
   * cost to compute: when the steps themselves are what is slow, more of them would only make the next frame longer, so there
   * are fewer and each is longer (up to HOST_STEP), which still keeps real speed down to 8 fps.
   */
  split(rawSeconds: number, frameMs: number): number {
    if (!this.hostSteps) return 1;
    const raw = Math.min(Math.max(rawSeconds, 0), HOST_FRAME);
    const want = Math.min(HOST_STEPS, Math.max(1, Math.ceil(raw / MAX_STEP - 1e-6)));
    const stepMs = Math.max(0.01, frameMs / this.lastSteps);
    const afford = Math.max(1, Math.floor((raw * 1000 * HOST_STEP_BUDGET) / stepMs));
    this.lastSteps = Math.min(want, afford);
    return this.lastSteps;
  }

  clearScales(): void {
    this.requests.clear();
    this.hitStopLeft = 0;
    this.hitStopScale = 1;
    this.scale = 1;
    this.slowmo = 1;
  }

  tick(rawSeconds: number): void {
    // A co-op host's steps together never cover more than HOST_FRAME: after a stall the world does not leap.
    const real = Math.min(Math.max(rawSeconds, 0), this.hostSteps ? Math.min(HOST_STEP, HOST_FRAME / this.lastSteps) : MAX_STEP);
    this.realDt = real;
    this.frame++;
    if (this.paused) {
      this.dt = 0;
      this.playerDt = 0;
      return;
    }
    this.realElapsed += real;

    // Co-op: the team's slow-mo blends in and out in true wall time, so a screen with long frames is back at full speed when
    // the others are, not ten clamped frames later. Single player blends on the clamped step, as it always has.
    const blend = this.gate ? Math.min(Math.max(rawSeconds, 0), 1) : real;
    let slow = 1;
    for (const [id, r] of this.requests) {
      if (r.releasing) {
        r.weight -= r.fadeOut > 0 ? blend / r.fadeOut : 1;
        if (r.weight <= 0) {
          this.requests.delete(id);
          continue;
        }
      } else {
        r.weight = Math.min(1, r.weight + (r.fadeIn > 0 ? blend / r.fadeIn : 1));
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
