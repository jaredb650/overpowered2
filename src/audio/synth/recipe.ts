/** A recipe is one catalogue id rendered by a build function, plus what the render must measure like. */
import type { MixClass, MixProfile } from '../mix';
import type { Synth } from './dsl';

export interface Expect {
  /** Average spectral centroid range in Hz. */
  centroid?: readonly [number, number];
  /** Milliseconds to reach 90% of peak level. */
  attackMs?: readonly [number, number];
  /** Minimum share of energy below 120 Hz. */
  minSub?: number;
  /** Centroid must rise (+1) or fall (-1) from the first third to the last. */
  trend?: 1 | -1;
}

export interface Recipe {
  id: string;
  /** Length in seconds. For loops, the loop length. */
  dur: number;
  /** Rendered variants. */
  n: number;
  mix: MixClass;
  stereo: boolean;
  loop: boolean;
  /** Seconds of crossfade at the loop seam. 0 means the sound is built to loop as it stands. */
  seam: number;
  /** Peak level after normalizing. */
  peak: number;
  /** Render sample rate, when the sound has nothing up high to justify full rate. */
  rate?: number;
  expect?: Expect;
  over?: Partial<MixProfile>;
  build: (s: Synth) => void;
}

export type RecipeOptions = Pick<Recipe, 'dur' | 'mix'> & Partial<Omit<Recipe, 'id' | 'dur' | 'mix' | 'build'>>;

export function r(id: string, options: RecipeOptions, build: (s: Synth) => void): Recipe {
  const loop = options.loop ?? false;
  return {
    id,
    n: 1,
    stereo: false,
    peak: 0.89,
    seam: loop ? Math.min(0.5, options.dur * 0.25) : 0,
    ...options,
    loop,
    build,
  };
}
