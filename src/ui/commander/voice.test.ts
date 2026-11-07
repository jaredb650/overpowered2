/** The voice player against a pretend audio element and a list that arrives when the test says so. */
import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../../core/contracts';
import type { Settings } from '../settings';
import { Voice } from './voice';

/** The part of an HTMLAudioElement the voice uses, driven by hand. */
class FakeAudio extends EventTarget {
  volume = 1;
  currentTime = 0;
  paused = true;
  src: string | null;
  plays = 0;
  private settle: { go(): void; no(err: unknown): void } | null = null;

  constructor(readonly url: string) {
    super();
    this.src = url;
  }

  play(): Promise<void> {
    this.plays++;
    this.paused = false;
    return new Promise((go, no) => {
      this.settle = { go, no };
    });
  }

  pause(): void {
    this.paused = true;
    this.refuse(new DOMException('The play() request was interrupted by a call to pause().', 'AbortError'));
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.src = null;
  }

  load(): void {}

  /** Sound comes out. */
  begin(): void {
    this.settle?.go();
    this.settle = null;
    this.dispatchEvent(new Event('playing'));
  }

  advance(seconds: number): void {
    this.currentTime += seconds;
    this.dispatchEvent(new Event('timeupdate'));
  }

  end(): void {
    this.paused = true;
    this.dispatchEvent(new Event('ended'));
  }

  /** A file that will not play: the element says so, and so does the promise. */
  fail(): void {
    this.dispatchEvent(new Event('error'));
    this.refuse(new DOMException('no supported source', 'NotSupportedError'));
  }

  private refuse(err: DOMException): void {
    this.settle?.no(err);
    this.settle = null;
  }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

function rig(list: Promise<ReadonlySet<string>> = Promise.resolve(new Set(['a', 'b', 'c']))) {
  const made: FakeAudio[] = [];
  const duck = vi.fn();
  const ctx = { audio: { duck } } as unknown as Ctx;
  const settings = { master: 0.8, sfx: 0.5 } as Settings;
  const voice = new Voice(ctx, settings, {
    audio: url => {
      const a = new FakeAudio(url);
      made.push(a);
      return a as unknown as HTMLAudioElement;
    },
    list: () => list,
  });
  return { voice, made, duck, settings };
}

describe('the voice', () => {
  it('plays a line asked for before the list of recordings has arrived, once it does', async () => {
    let give!: (list: ReadonlySet<string>) => void;
    const { voice, made } = rig(new Promise(go => {
      give = go;
    }));
    voice.say(['mission.council.brief.line']);
    expect(voice.speaking).toBe(true);
    expect(made).toHaveLength(0);
    voice.update(1);
    give(new Set(['mission.council.brief.line']));
    await settle();
    expect(made).toHaveLength(1);
    expect(made[0]!.url).toBe('audio/voice/mission.council.brief.line.mp3');
    expect(made[0]!.plays).toBe(1);
    expect(made[0]!.volume).toBeCloseTo(0.4);
  });

  it('leaves a line as text when the list does not come in time, and never starts it late', async () => {
    let give!: (list: ReadonlySet<string>) => void;
    const { voice, made } = rig(new Promise(go => {
      give = go;
    }));
    voice.say(['a']);
    for (let i = 0; i < 45; i++) voice.update(0.1);
    expect(voice.speaking).toBe(true);
    voice.update(1);
    expect(voice.speaking).toBe(false);
    give(new Set(['a']));
    await settle();
    expect(made).toHaveLength(0);
  });

  it('waits for the list once, then lets later lines go as text until it comes, and voices them once it has', async () => {
    let give!: (list: ReadonlySet<string>) => void;
    const { voice, made } = rig(new Promise(go => {
      give = go;
    }));
    voice.say(['a']);
    for (let i = 0; i < 51; i++) voice.update(0.1);
    expect(voice.speaking).toBe(false);
    voice.say(['b']);
    expect(voice.speaking).toBe(false);
    give(new Set(['c']));
    await settle();
    voice.say(['c']);
    expect(made.map(a => a.url)).toEqual(['audio/voice/c.mp3']);
  });

  it('keeps a clip that was slow to load, rather than cutting it as it starts', async () => {
    const { voice, made } = rig();
    await settle();
    voice.say(['a']);
    for (let i = 0; i < 30; i++) voice.update(0.1);
    made[0]!.begin();
    voice.update(0.1);
    expect(voice.speaking).toBe(true);
    for (let i = 0; i < 10; i++) {
      made[0]!.advance(0.1);
      voice.update(0.1);
    }
    expect(voice.speaking).toBe(true);
    expect(made[0]!.src).not.toBeNull();
  });

  it('skips what nobody recorded, and is silent for a line with no recording', async () => {
    const { voice, made } = rig();
    await settle();
    voice.say(['nobody']);
    expect(voice.speaking).toBe(false);
    voice.say([null, 'b', 'nobody', 'c']);
    expect(made.map(a => a.url)).toEqual(['audio/voice/b.mp3']);
    made[0]!.begin();
    made[0]!.end();
    expect(made.map(a => a.url)).toEqual(['audio/voice/b.mp3', 'audio/voice/c.mp3']);
    made[1]!.begin();
    made[1]!.end();
    expect(voice.speaking).toBe(false);
    expect(voice.voiced).toBe(true);
  });

  it('drops a clip that never starts, and one that stops moving, as if they had failed', async () => {
    const { voice, made } = rig();
    await settle();
    voice.say(['a']);
    for (let i = 0; i < 35; i++) voice.update(0.1);
    expect(voice.speaking).toBe(true);
    voice.update(1);
    expect(voice.speaking).toBe(false);
    expect(made[0]!.src).toBeNull();

    voice.say(['b']);
    made[1]!.begin();
    for (let i = 0; i < 20; i++) {
      made[1]!.advance(0.1);
      voice.update(0.1);
    }
    for (let i = 0; i < 20; i++) voice.update(0.1);
    expect(voice.speaking).toBe(true);
    voice.update(1);
    expect(voice.speaking).toBe(false);
  });

  it('cannot be moved on by a clip it has already let go of', async () => {
    const { voice, made } = rig();
    await settle();
    voice.say(['a']);
    voice.say(['b', 'c']);
    // The first clip's play() is refused by the stop, and it reports an error after it has gone.
    made[0]!.fail();
    await settle();
    expect(voice.speaking).toBe(true);
    expect(made).toHaveLength(2);
    // A clip that fails both ways moves on once.
    made[1]!.fail();
    await settle();
    expect(made.map(a => a.url)).toEqual(['audio/voice/a.mp3', 'audio/voice/b.mp3', 'audio/voice/c.mp3']);
    expect(voice.speaking).toBe(true);
  });

  it('keeps a clip that is paused while it loads, and starts it on resume at the volume of the moment', async () => {
    const { voice, made, settings } = rig();
    await settle();
    voice.say(['a']);
    voice.setPaused(true);
    await settle();
    expect(voice.speaking).toBe(true);
    settings.master = 1;
    voice.setPaused(false);
    expect(made).toHaveLength(1);
    expect(made[0]!.plays).toBe(2);
    expect(made[0]!.volume).toBeCloseTo(0.5);
  });

  it('fades a clip it cuts off, rather than stopping it dead', async () => {
    const { voice, made } = rig();
    await settle();
    voice.say(['a']);
    made[0]!.begin();
    voice.stop();
    expect(voice.speaking).toBe(false);
    expect(made[0]!.paused).toBe(false);
    voice.update(0.05);
    expect(made[0]!.volume).toBeCloseTo(0.2);
    voice.update(0.06);
    expect(made[0]!.paused).toBe(true);
    expect(made[0]!.src).toBeNull();
  });

  it('ducks the music while a recording is really playing, and only then', async () => {
    const { voice, made, duck } = rig();
    await settle();
    voice.say(['a']);
    expect(duck).not.toHaveBeenCalled();
    made[0]!.begin();
    made[0]!.advance(0.25);
    expect(duck).toHaveBeenCalledTimes(2);
    expect(duck.mock.calls[0]![1]).toBeLessThan(1);
  });
});
