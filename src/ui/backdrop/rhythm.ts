/**
 * The menu background's clock, as plain numbers: when the contractor draws on the cigar, how bright the tip is, when he
 * breathes the smoke out, when he looks out of the door and when he shifts his weight. No three.js here, so the timing is
 * tested in Node and the scene only reads the result.
 */
import { clamp, smoothstep } from '../../core/math';

/** Which background the first menu screen gets. `map` is the old flythrough over the live map. */
export type BackdropMode = 'heli' | 'still' | 'map';

/**
 * `?menubg=map` brings back the flythrough, `?menubg=still` freezes the helicopter, `?menubg=heli` forces it to move.
 * Otherwise only a reduced-motion request gets a still frame of it. It moves at every graphics quality: the owner wants the
 * menu alive, and the scene costs a third of the flythrough it replaced. `flag` is the parameter's value.
 */
export function backdropMode(flag: string | null, reducedMotion: boolean, _quality: number): BackdropMode {
  if (flag === 'map' || flag === 'still' || flag === 'heli') return flag;
  return reducedMotion ? 'still' : 'heli';
}

/** Seconds. One drag: the hand comes up, he draws, the hand goes down, he holds it, he breathes out. */
export const DRAG = { raise: 1, draw: 1.5, lower: 0.95, hold: 0.55, exhale: 2.2 } as const;
/** Seconds from the start of one drag to the start of the next: one every ten to fifteen seconds. */
export const EVERY = { min: 10, max: 15 } as const;
/** The first drag comes soon, so someone arriving at the menu sees one. */
export const FIRST_DRAG = 3.2;
/** A look out of the door between drags: how likely, and how long. */
export const LOOK = { chance: 0.65, min: 2.8, max: 4.6 } as const;
/** A shift of weight every so often, eased over `blend` seconds. */
export const SHIFT = { min: 16, max: 26, blend: 1.8 } as const;
/** Tip brightness: at rest, at the peak of a draw, and how fast it cools afterwards (per second). */
export const EMBER = { rest: 0.32, peak: 1, cool: 0.55 } as const;

export const DRAG_SECONDS = DRAG.raise + DRAG.draw + DRAG.lower + DRAG.hold + DRAG.exhale;

/** What the scene reads each frame. Every value is 0..1. */
export interface SmokerPose {
  /** 0 with the hand on the knee, 1 with the cigar at the lips. */
  hand: number;
  /** How hard he is drawing right now. */
  draw: number;
  /** Tip brightness, with the slow cool-down after a draw. */
  ember: number;
  /** Flow of smoke out of the mouth. */
  exhale: number;
  /** 0 looking down the cabin, 1 looking out of the door. */
  look: number;
  /** Weight on the door post (0) or forward over the knee (1). */
  shift: number;
}

export class SmokeRhythm {
  readonly pose: SmokerPose = { hand: 0, draw: 0, ember: EMBER.rest, exhale: 0, look: 0, shift: 0 };
  /** Seconds since the menu opened. */
  time = 0;
  /** Drags started so far, for tests and the live check. */
  drags = 0;
  private dragAt = FIRST_DRAG;
  private lookAt = Infinity;
  private lookFor = 0;
  private shiftAt: number;
  private shiftTo = 0;
  private shiftFrom = 0;
  private shiftStart = -Infinity;
  private heat: number = EMBER.rest;

  /** `random` returns 0..1. Injected, so a test can run the same menu twice. */
  constructor(private readonly random: () => number = Math.random) {
    this.shiftAt = this.between(SHIFT.min, SHIFT.max);
  }

  private between(a: number, b: number): number {
    return a + (b - a) * this.random();
  }

  /** Seconds into the drag running now, or -1 between drags. */
  private inDrag(): number {
    const u = this.time - this.dragAt;
    return u >= 0 && u < DRAG_SECONDS ? u : -1;
  }

  update(dt: number): void {
    const step = clamp(dt, 0, 0.25);
    this.time += step;
    const t = this.time;
    const p = this.pose;

    // A drag ends: book the next one, and maybe a look out of the door in the gap before it.
    if (t >= this.dragAt + DRAG_SECONDS) {
      this.drags++;
      const ended = this.dragAt + DRAG_SECONDS;
      this.dragAt += this.between(EVERY.min, EVERY.max);
      const gap = this.dragAt - ended;
      this.lookAt = Infinity;
      this.lookFor = this.between(LOOK.min, LOOK.max);
      // Only when the gap has room for the whole look with a breath either side.
      if (gap > this.lookFor + 1 && this.random() < LOOK.chance) this.lookAt = ended + 0.5 + this.random() * (gap - this.lookFor - 1);
    }

    const u = this.inDrag();
    const { raise, draw, lower, hold, exhale } = DRAG;
    if (u < 0) {
      p.hand = 0;
      p.draw = 0;
      p.exhale = 0;
    } else {
      const up = smoothstep(0, raise, u);
      const down = 1 - smoothstep(raise + draw, raise + draw + lower, u);
      p.hand = Math.min(up, down);
      const d0 = raise - 0.15;
      p.draw = smoothstep(d0, d0 + 0.35, u) * (1 - smoothstep(raise + draw - 0.3, raise + draw, u));
      const e0 = raise + draw + lower + hold;
      p.exhale = smoothstep(e0, e0 + 0.25, u) * (1 - smoothstep(e0 + exhale * 0.45, e0 + exhale, u));
    }

    // The tip heats while he draws and cools slowly after, so it glows brighter on each drag and not at once.
    const target = EMBER.rest + (EMBER.peak - EMBER.rest) * p.draw;
    this.heat = target > this.heat ? this.heat + (target - this.heat) * (1 - Math.exp(-step * 6)) : Math.max(target, this.heat - EMBER.cool * step);
    p.ember = clamp(this.heat);

    // Looks never overlap a drag: the hand needs the head facing it.
    const l = t - this.lookAt;
    p.look = u >= 0 ? 0 : smoothstep(0, 0.9, l) * (1 - smoothstep(this.lookFor - 0.9, this.lookFor, l));

    if (t >= this.shiftAt) {
      this.shiftFrom = p.shift;
      this.shiftTo = this.shiftTo > 0.5 ? 0 : 1;
      this.shiftStart = t;
      this.shiftAt = t + this.between(SHIFT.min, SHIFT.max);
    }
    const s = smoothstep(0, SHIFT.blend, t - this.shiftStart);
    p.shift = this.shiftFrom + (this.shiftTo - this.shiftFrom) * s;
  }

  /** A moment that reads well as a still: hand down, the tip warm from a draw a few seconds ago. */
  freeze(): void {
    const p = this.pose;
    p.hand = 0;
    p.draw = 0;
    p.exhale = 0;
    p.look = 0.35;
    p.shift = 0;
    p.ember = 0.6;
  }
}
