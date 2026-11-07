/**
 * How long a line holds the mission's radio. A recorded line holds it for as long as the recording runs or as long as the words take
 * to read, whichever is longer, and then for a breath. A line nobody has recorded holds it for the reading time. The words stay up
 * while either is still going, so a quick take does not hurry a slow reader and the clock never cuts a slow take.
 *
 * Nothing here touches the page, so a test can time a line.
 */

/** Words a second, for reading. */
const WORDS_PER_SECOND = 2.6;
const LEAST_SECONDS = 2;
/** Between one line and the next, so a speech has breaths in it. */
export const GAP_SECONDS = 0.35;
/** However long a recording turns out to be, it lets go of the radio by twice the reading time and this. */
const OVERRUN_SECONDS = 6;

/** Seconds the words of a line take to read. */
export function readSeconds(text: string): number {
  return Math.max(LEAST_SECONDS, text.split(' ').length / WORDS_PER_SECOND);
}

/** The voice, as far as the clock cares. */
export interface Mouth {
  /** A recording is playing, or may yet. */
  readonly speaking: boolean;
  /** A recording of this line has been heard. */
  readonly voiced: boolean;
  stop(): void;
}

export class Airtime {
  /** The words are on screen. */
  up = false;
  private age = 0;
  private read = 0;
  private gap = 0;
  private done: (() => void) | null = null;

  constructor(private readonly voice: Mouth) {}

  /**
   * A line has the radio, or the breath after one does. The runner begins the next line from inside `done`, so through a run of lines
   * this never goes false between them.
   */
  get held(): boolean {
    return this.done !== null;
  }

  /** The face moves while there is a voice, or for the reading time when there is none. */
  get talking(): boolean {
    return this.up && (this.voice.speaking || (!this.voice.voiced && this.age < this.read));
  }

  begin(text: string, done: () => void): void {
    this.read = readSeconds(text);
    this.age = this.gap = 0;
    this.done = done;
    this.up = true;
  }

  clear(): void {
    this.done = null;
    this.up = false;
    this.age = this.gap = 0;
  }

  update(dt: number): void {
    if (!this.done) return;
    if (!this.up) {
      this.gap -= dt;
      if (this.gap > 0) return;
      const done = this.done;
      this.done = null;
      done();
      return;
    }
    this.age += dt;
    const speaking = this.voice.speaking;
    if (speaking && this.age < this.read * 2 + OVERRUN_SECONDS) return;
    if (speaking) this.voice.stop();
    if (this.age < this.read) return;
    this.up = false;
    this.gap = GAP_SECONDS;
  }
}
