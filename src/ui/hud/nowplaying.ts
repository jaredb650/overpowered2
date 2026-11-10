/**
 * The name of the track that has just started, top centre, for a few seconds. It sits on the UI root and not in the
 * HUD, so it shows over the menu as well as in a run. `OST` marks the game's own soundtrack, `LOCAL` a placeholder song
 * that exists only on this machine.
 */
import { Label, div, span } from '../dom';
import '../css/nowplaying.css';

/** Seconds on screen, from the first frame of the slide in to the last of the fade. */
const SHOWN = 7;
const FRAMES: Keyframe[] = [
  { opacity: 0, transform: 'translateY(-110%)', offset: 0, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  { opacity: 1, transform: 'translateY(0)', offset: 0.04 },
  { opacity: 1, transform: 'translateY(0)', offset: 0.92 },
  { opacity: 0, transform: 'translateY(0)', offset: 1 },
];

export class NowPlaying {
  readonly el: HTMLElement;
  private readonly tag: Label;
  private readonly title: Label;
  private running: Animation | null = null;

  constructor() {
    const tag = span('np-tag');
    const title = span('np-title');
    this.el = div('np', div('np-bars', span(), span(), span()), tag, title);
    this.tag = new Label(tag);
    this.title = new Label(title);
  }

  show(title: string, original: boolean): void {
    this.tag.set(original ? 'OST' : 'LOCAL');
    this.title.set(title);
    this.el.classList.toggle('np-local', !original);
    this.running?.cancel();
    // The element rests invisible. The animation is the only thing that ever shows it, so nothing has to hide it again.
    this.running = this.el.animate(FRAMES, { duration: SHOWN * 1000 });
  }
}
