/**
 * How much of the gore update a machine is asked to carry: one place that writes every cap, from three hands.
 *
 * - **The "Mess" setting** (`MESS` in mess.ts): what stays on the floor. Bodies, limbs, pieces, blood, and whether bodies
 *   at rest leave their capsules behind so the next ones heap on them (`HEAPS`).
 * - **Graphics quality** (`QualityPreset`, render/quality.ts): what the look costs a weaker machine. The decal sheet's
 *   size and the floor tiles are the renderer's own; here it sets how many of the big stains are kept, how many struck
 *   parts swing on physics at once and how many burning bodies light the floor.
 * - **The automatic step-down** (`LoadGovernor`, here; the caps themselves are written by `applyLoad` in ui/settings.ts): the game already steps its resolution down when frames are missed
 *   (render/DynamicResolution.ts). That answers a slow GPU. When frames are still missed with the resolution down, or
 *   resolution turned out not to be the cause, the cost is the processor's, and the parts of the update that cost
 *   processor time are eased, one step at a time, and given back when the frame rate has held for a while.
 *
 * Why these parts: measured with `tools/scripts/gore-cost.mjs` (docs/notes/gore.md, "The whole update: what it costs"),
 * the update's cost in a heavy fight is on the processor, not the GPU. The physics step goes from 1.6 to 5.0 ms a frame on
 * the development machine, nearly all of it live ragdolls landing in a heap of resting capsules, and `render()` gains
 * about a millisecond in draw calls. So the steps take the heap's capsules first, then drawn corpses and live ragdolls.
 *
 * Nothing here changes what a bullet or a player meets, and nothing is sent in co-op: each screen eases its own.
 */
import type { Ctx } from '../core/contracts';
import { MessTuning, type MessLevel } from './mess';

/**
 * Mess levels at which a body at rest leaves capsules for the next to land on. Not at Low: Low is "about what the game
 * kept before", which was bodies one deep, and the heap is the costly part of the mess on a slow processor.
 */
export const HEAPS: Readonly<Record<MessLevel, boolean>> = { low: false, break: true, standard: true, everything: true };

/** The automatic steps. 0 is the game as set. */
export const EASE_STEPS = 2;

export const LoadTuning = {
  /**
   * What each step leaves of the caps, [as set, step 1, step 2]. Only things that change out of sight or for what comes
   * next: nothing on the floor is taken away in front of the player (a baked corpse is swapped in past 11 m or out of
   * view, a body's shadow goes when it is not looked at, a decal ring is never shortened by a step).
   */
  /** Bodies at rest leave capsules, so the dead heap. Off from the first step: it is what the physics step pays for. */
  heaps: [true, false, false] as readonly boolean[],
  /** Resting bodies whose capsules are taken away each frame once heaps are off, oldest first. */
  shedPerFrame: 2,
  /** Corpses drawn as characters, and the newest of them drawn as in life (`MessBudget.drawn`, `full`). */
  drawn: [1, 0.6, 0.4] as readonly number[],
  full: [1, 0.75, 0.5] as readonly number[],
  /** Dead bodies simulating at once (`GoreTuning.maxRagdolls`), and bodies dying on their feet at once (`maxCollapses`). */
  ragdolls: [1, 1, 0.7] as readonly number[],
  collapses: [1, 1, 0.5] as readonly number[],
  /**
   * Enemies walking into the dead wake them (`MessTuning.enemyRange`, metres from the player inside which they do). Off at
   * the second step: the player's own push stays at every step, since walking through the dead is his to feel.
   */
  enemiesPush: [true, true, false] as readonly boolean[],
  /**
   * Seconds a loose piece lies still before it shrinks away, at most (`ChunkTuning.linger`; Standard keeps them until
   * their slot is needed). Pieces are a million triangles of a long fight's floor: shrinking the still ones is how they
   * leave at Mess Low too, and nothing pops.
   */
  pieceLinger: [Infinity, 30, 12] as readonly number[],
  /** Struck parts on physics at once, and burning bodies that light the floor. */
  sway: [1, 0.5, 0.25] as readonly number[],
  fireLights: [0, 1, 2] as readonly number[],

  /** Smoothed frame interval, ms, that counts as missing 60 and as holding it (the same marks as dynamic resolution's). */
  missMs: 18.4,
  holdMs: 17.4,
  /** Seconds of missing before a step is taken, and seconds between steps. */
  downAfter: 2,
  cooldown: 6,
  /** Resolution at or under this share and still missing: resolution is not answering it. */
  resolutionSpent: 0.8,
  /** Seconds of holding 60 before a step is given back. Doubled each time giving one back was followed by a miss, to `upMax`. */
  upAfter: 30,
  upMax: 240,
  /** A miss within this many seconds of giving a step back means it was given back too soon. */
  tooSoon: 20,
};

/**
 * What is in force. `quality` and `mess` are the player's settings, `ease` the governor's step. `changed` is called when
 * the step moves: the settings code (`applyLoad` in ui/settings.ts), which knows every system a cap is written to.
 */
export const GoreLoad = { quality: 2, mess: 'standard' as MessLevel, ease: 0, changed: null as (() => void) | null };

/** What the governor reads of dynamic resolution. */
export interface ResolutionState {
  /** It is adapting at all: off under automation, so a test's picture never depends on the machine's load. */
  enabled: boolean;
  /** Share of full resolution in use, 1 to 0.62. */
  scale: number;
  /** It went through its whole range and the frame rate did not answer: it has gone back to full size and is resting. */
  starved: boolean;
}

/**
 * Follows the frame interval and eases the processor's share of the gore update. It only ever acts when dynamic
 * resolution has already been spent or has given up, so on a machine that holds 60 it does nothing at all, and on one
 * whose GPU is the limit resolution answers first.
 */
export class LoadGovernor {
  /** 0 as set, to `EASE_STEPS`. */
  ease = 0;
  private smoothed = 16.7;
  private overFor = 0;
  private underFor = 0;
  private cooldown = 0;
  private upWait = LoadTuning.upAfter;
  private sinceUp = Infinity;

  /** `realDt` in seconds. Returns true when the step changed. */
  update(realDt: number, resolution: ResolutionState): boolean {
    if (!resolution.enabled || realDt <= 0) return false;
    const t = LoadTuning;
    this.smoothed += (realDt * 1000 - this.smoothed) * (1 - Math.exp(-realDt * 3));
    this.cooldown -= realDt;
    this.sinceUp += realDt;
    this.overFor = this.smoothed > t.missMs ? this.overFor + realDt : 0;
    this.underFor = this.smoothed < t.holdMs ? this.underFor + realDt : 0;
    if (this.cooldown > 0) return false;
    const spent = resolution.starved || resolution.scale <= t.resolutionSpent;
    if (this.overFor > t.downAfter && spent && this.ease < EASE_STEPS) {
      if (this.sinceUp < t.tooSoon) this.upWait = Math.min(this.upWait * 2, t.upMax);
      this.ease++;
      this.overFor = this.underFor = 0;
      this.cooldown = t.cooldown;
      return true;
    }
    if (this.underFor > this.upWait && this.ease > 0) {
      this.ease--;
      this.underFor = 0;
      this.cooldown = t.cooldown;
      this.sinceUp = 0;
      return true;
    }
    return false;
  }

  reset(): void {
    this.ease = 0;
    this.smoothed = 16.7;
    this.overFor = this.underFor = this.cooldown = 0;
    this.upWait = LoadTuning.upAfter;
    this.sinceUp = Infinity;
  }
}

interface Shedder {
  shed(count: number): number;
}

const governor = new LoadGovernor();

/**
 * Once a frame, from gore's update: runs the governor, and while heaps are off takes the capsules of bodies already at
 * rest away a few at a time (whatever lay on them falls, as when any body under another goes).
 */
export function stepLoad(ctx: Ctx, mess: Shedder): void {
  const resolution = (ctx.render as { dynamicResolution?: ResolutionState } | undefined)?.dynamicResolution;
  if (resolution && governor.update(ctx.time.realDt, resolution)) {
    GoreLoad.ease = governor.ease;
    GoreLoad.changed?.();
  }
  if (!MessTuning.heaps) mess.shed(LoadTuning.shedPerFrame);
}

/** A new run starts from the settings: the last fight's step is not this one's. */
export function resetLoad(): void {
  governor.reset();
  if (GoreLoad.ease !== 0) {
    GoreLoad.ease = 0;
    GoreLoad.changed?.();
  }
}
