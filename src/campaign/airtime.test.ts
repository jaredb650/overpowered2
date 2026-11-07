/** How long a line holds the mission's radio, against a pretend voice. */
import { describe, expect, it } from 'vitest';
import { Airtime, GAP_SECONDS, readSeconds, type Mouth } from './airtime';

const FRAME = 1 / 60;

/** A take that runs for `seconds`, or none at all. */
class Take implements Mouth {
  speaking = false;
  voiced = false;
  stopped = false;
  private left = 0;
  constructor(private readonly seconds: number | null) {}
  begin(): void {
    if (this.seconds === null) return;
    this.speaking = true;
    this.voiced = true;
    this.left = this.seconds;
  }
  update(dt: number): void {
    if (!this.speaking) return;
    this.left -= dt;
    if (this.left <= 0) this.speaking = false;
  }
  stop(): void {
    this.stopped = true;
    this.speaking = false;
  }
}

/** Seconds the words stay up, seconds until `done`, and how long the face moved. */
function time(text: string, take: Take): { up: number; done: number; talking: number } {
  const air = new Airtime(take);
  let t = 0;
  let done = -1;
  let up = -1;
  let talking = 0;
  air.begin(text, () => {
    done = t;
  });
  take.begin();
  while (done < 0 && t < 60) {
    t += FRAME;
    take.update(FRAME);
    air.update(FRAME);
    if (air.talking) talking += FRAME;
    if (up < 0 && !air.up) up = t;
  }
  return { up, done, talking };
}

describe('a line on the radio', () => {
  it('reads at 2.6 words a second, and never in under 2 s', () => {
    expect(readSeconds('Now.')).toBe(2);
    expect(readSeconds('Two minutes to the wire. Door\'s yours, contractor. Anything on that compound is billable.')).toBeCloseTo(14 / 2.6, 5);
  });

  it('holds for its recording when the recording runs longer than the words, and not for both', () => {
    const text = 'Contractor. This is the Office of Societal Compliance. You are on a recorded line.';
    const { up, done } = time(text, new Take(6.43));
    expect(readSeconds(text)).toBeLessThan(6.43);
    expect(up).toBeCloseTo(6.43, 1);
    expect(done).toBeCloseTo(6.43 + GAP_SECONDS, 1);
  });

  it('keeps a quick take up for the reading time, with the face still once the voice stops', () => {
    const text = 'This is as far as the rental goes. Good luck with the paperwork.';
    const { up, done, talking } = time(text, new Take(3.55));
    expect(up).toBeCloseTo(readSeconds(text), 1);
    expect(done).toBeCloseTo(readSeconds(text) + GAP_SECONDS, 1);
    expect(talking).toBeCloseTo(3.55, 1);
  });

  it('keeps a line nobody recorded to its reading time, as before, talking throughout', () => {
    const text = 'Item recovered. Its previous owner\'s balance has been transferred to you.';
    const { up, done, talking } = time(text, new Take(null));
    expect(up).toBeCloseTo(readSeconds(text), 1);
    expect(done).toBeCloseTo(readSeconds(text) + GAP_SECONDS, 1);
    expect(talking).toBeCloseTo(readSeconds(text), 1);
  });

  it('lets go of a recording that runs far past its words', () => {
    const take = new Take(40);
    const { up } = time('Now.', take);
    expect(take.stopped).toBe(true);
    expect(up).toBeCloseTo(2 * 2 + 6, 1);
  });

  it('holds the radio through the breath, and through a run of lines begun from inside `done`', () => {
    const take = new Take(null);
    const air = new Airtime(take);
    let lines = 0;
    const next = (): void => {
      if (++lines < 3) air.begin('One two three.', next);
    };
    air.begin('One two three.', next);
    let held = 0;
    let t = 0;
    for (; t < 10; t += FRAME) {
      air.update(FRAME);
      if (!air.held) break;
      held += FRAME;
    }
    expect(lines).toBe(3);
    // Unbroken from the first word to the last breath, give or take a frame a line.
    expect(held).toBeGreaterThanOrEqual(3 * (2 + GAP_SECONDS));
    expect(held).toBeLessThan(3 * (2 + GAP_SECONDS) + 3 * 2 * FRAME);
    air.begin('One.', () => {});
    air.clear();
    expect(air.held).toBe(false);
    expect(air.up).toBe(false);
  });
});
