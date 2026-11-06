/** Loading: one line of molten metal pouring across the screen. */
import { Label, Meter, div, span } from '../dom';
import { wordmark } from './parts';
import type { Screen } from './Screens';

export class LoadingScreen implements Screen {
  readonly el: HTMLElement;
  private bar: Meter;
  private label: Label;
  private pct: Label;

  constructor() {
    const fill = div('ld-fill');
    const label = span('ld-label');
    const pct = span('ld-pct');
    this.el = div('scr scr-loading',
      wordmark(),
      div('ld-pour', fill),
      div('ld-row', label, pct),
    );
    this.bar = new Meter(fill);
    this.label = new Label(label);
    this.pct = new Label(pct);
    this.set(0, 'Loading');
  }

  open(): void {}

  set(fraction: number, label: string): void {
    this.bar.set(fraction);
    this.label.set(label);
    this.pct.set(`${Math.round(fraction * 100)}%`);
  }
}
