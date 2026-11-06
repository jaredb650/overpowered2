/**
 * The camera, clock and marker side of landing a hit. Shared by everything that resolves a hit so
 * shake units and hit-stop pacing stay consistent across guns, blades and blasts.
 */
import type { Ctx } from '../core/contracts';
import { HIT_STOP } from './data';

/**
 * Trauma squares into amplitude, so a doc intensity maps through a square root. The first game's peak
 * was intensity / 2 radians and the rig's full-trauma pitch is 0.09, which puts full trauma here.
 */
const FULL_TRAUMA_INTENSITY = 0.18;

export class Feel {
  private nextStopAt = 0;

  constructor(private readonly ctx: Ctx) {}

  /** `intensity` is the first game's shake number: 0.004 for an SMG shot, 0.24 for a Hellfire rocket. */
  shake(intensity: number): void {
    if (intensity <= 0) return;
    this.ctx.camera.addTrauma(Math.sqrt(intensity / FULL_TRAUMA_INTENSITY));
  }

  /**
   * Freezes the world for a moment. Stops closer together than HIT_STOP.minGap are dropped unless
   * `force` is set, because a stream of small freezes reads as a frame-rate problem, not as impact.
   */
  stop(seconds: number, force = false, scale = 0.05): void {
    const time = this.ctx.time;
    if (!force && time.realElapsed < this.nextStopAt) return;
    time.hitStop(seconds, scale);
    this.nextStopAt = time.realElapsed + seconds + HIT_STOP.minGap;
  }

  reset(): void {
    this.nextStopAt = 0;
  }
}
