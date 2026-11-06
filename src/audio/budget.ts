/**
 * How much the mix may cost. Everything here is a plain number so a test can read it.
 *
 * Chrome renders a context's whole graph on one thread, with one buffer's length to do it in. When a buffer takes
 * longer than that, the player hears a crackle and the context's clock falls behind the wall clock. The voices then
 * last longer in real time while the game keeps asking for sounds at the same rate, which adds more voices to a
 * thread that is already late. So the budget has to be small enough that this never starts, and something has to
 * step in when another tab or a hot laptop takes the headroom away.
 */
import { clamp } from '../core/math';

/** Voices the 3D and 2D pools may use together, by load step. Step 0 is normal, and fits on the thread with room. */
export const VOICE_BUDGETS = [40, 28, 18] as const;

/** A sound below this level is not worth a voice even in an empty room. */
const CULL_LEVEL = 0.004;
/** Thinning starts here, as a share of the budget, so a normal fight never touches it. */
const THIN_FROM = 0.6;
/** The level a sound must reach to start in a full mix: about -28 dB. Masked anyway, under that much noise. */
const FULL_FLOOR = 0.04;
/** Shortest gap between two sounds of one family in a full mix. Below this, a family reads as one texture anyway. */
const FULL_REPEAT_GAP = 0.09;

const crowding = (pressure: number) => clamp((pressure - THIN_FROM) / (1 - THIN_FROM));

/** The level a non-critical sound must reach to start, as the mix fills. */
export function quietFloor(pressure: number): number {
  const p = crowding(pressure);
  return CULL_LEVEL + (FULL_FLOOR - CULL_LEVEL) * p * p;
}

/** Seconds a family must wait between sounds, as the mix fills. Zero when there is room. */
export function repeatGap(pressure: number): number {
  return FULL_REPEAT_GAP * crowding(pressure);
}

/** Below this share of real time the render thread is not keeping up, for browsers that cannot report underruns. */
const CLOCK_FLOOR = 0.95;
/** Share of a window's audio that may be lost to underruns before it counts as overload. */
const UNDERRUN_CEILING = 0.03;
/** Clean windows in a row before a step comes back, so the budget does not hunt. */
const CALM_WINDOWS = 6;

/** Sheds voices when the render thread falls behind, and gives them back once it has been clean for a while. */
export class LoadGovernor {
  step = 0;
  /** Audio seconds per wall second over the last window. */
  clockRate = 1;
  /** Share of the last window's audio lost to underruns. */
  underrunShare = 0;
  private calm = 0;

  get budget(): number { return VOICE_BUDGETS[this.step]!; }

  /** One window of measurement. `underrunShare` is null where the browser cannot report it. */
  sample(audioSeconds: number, wallSeconds: number, underrunShare: number | null): void {
    if (wallSeconds <= 0) return;
    this.clockRate = audioSeconds / wallSeconds;
    this.underrunShare = underrunShare ?? 0;
    // Underruns are counted, where the clock is only compared, and a long frame can make a healthy one read late.
    const overloaded = underrunShare === null ? this.clockRate < CLOCK_FLOOR : underrunShare > UNDERRUN_CEILING;
    if (overloaded) {
      this.calm = 0;
      if (this.step < VOICE_BUDGETS.length - 1) this.step++;
    } else if (this.step > 0 && ++this.calm >= CALM_WINDOWS) {
      this.calm = 0;
      this.step--;
    }
  }
}
