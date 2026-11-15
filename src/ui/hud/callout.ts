/**
 * A move's name, called out small under the crosshair the moment it is done, as a fighting game does: the katana's combo
 * moves. One at a time; a new one cuts the last off.
 */
import { Label, div, span } from '../dom';
import '../css/callout.css';

const SHOWN_MS = 950;
const FRAMES: Keyframe[] = [
  { opacity: 0, transform: 'translateX(-1.2rem) skewX(-14deg) scale(1.35)', offset: 0, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)' },
  { opacity: 1, transform: 'translateX(0) skewX(-14deg) scale(1)', offset: 0.09 },
  { opacity: 1, transform: 'translateX(0.3rem) skewX(-14deg) scale(1)', offset: 0.72, easing: 'cubic-bezier(0.5, 0, 0.9, 0.4)' },
  { opacity: 0, transform: 'translateX(1.4rem) skewX(-14deg) scale(1)', offset: 1 },
];
const BAR: Keyframe[] = [
  { transform: 'scaleX(0)', offset: 0, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)' },
  { transform: 'scaleX(1)', offset: 0.16 },
  { transform: 'scaleX(1)', offset: 1 },
];

export class Callout {
  readonly el: HTMLElement;
  private readonly name: Label;
  private readonly bar: HTMLElement;
  private running: Animation[] = [];

  constructor() {
    const name = span('callout-name');
    this.bar = span('callout-bar');
    this.el = div('callout', name, this.bar);
    this.name = new Label(name);
  }

  show(text: string): void {
    this.name.set(text);
    for (const a of this.running) a.cancel();
    // The element rests invisible: the animation is the only thing that shows it, so nothing has to hide it again.
    this.running = [this.el.animate(FRAMES, { duration: SHOWN_MS }), this.bar.animate(BAR, { duration: SHOWN_MS })];
  }
}
