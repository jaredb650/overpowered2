/**
 * Loading: a line of hot metal running down a track, and a log of what it has got through.
 *
 * The boot has long stretches that report nothing and block the main thread. Everything that shows the page is alive
 * is a compositor transform, so it keeps moving through them: the stripes run forever, and after each report the bar
 * eases past it toward a limit it can only cross when the next report really arrives.
 */
import { Label, div, span } from '../dom';
import { wordmark } from './parts';
import type { Screen } from './Screens';

/** How far ahead of the last report the bar may crawl. */
const CREEP = 0.06;
const LOG_LINES = 5;

export class LoadingScreen implements Screen {
  readonly el: HTMLElement;
  private fill: HTMLElement;
  private label: Label;
  private pct: Label;
  private log: HTMLElement;
  private last = '';
  private peak = 0;

  constructor() {
    this.fill = div('ld-fill', div('ld-run'));
    const label = span('ld-label');
    const pct = span('ld-pct');
    this.log = div('ld-log');
    this.el = div('scr scr-loading',
      wordmark(),
      div('ld-pour', this.fill),
      div('ld-row', label, pct),
      this.log,
    );
    this.label = new Label(label);
    this.pct = new Label(pct);
    this.set(0, 'Loading');
  }

  open(): void {}

  set(fraction: number, label: string): void {
    this.peak = Math.max(this.peak, Math.min(fraction, 1));
    const f = this.peak;
    // Both terms rise with f, so the bar's target never moves backward.
    const target = fraction >= 1 ? 1 : f + Math.min(CREEP, (1 - f) * 0.5);
    this.fill.style.transform = `translate3d(${((target - 1) * 100).toFixed(2)}%,0,0)`;
    this.pct.set(`${Math.round(f * 100)}%`);
    if (label === this.last) return;
    if (this.last) this.logLine(this.last);
    this.last = label;
    this.label.set(label);
  }

  private logLine(text: string): void {
    this.log.append(span('ld-done', text));
    if (this.log.childElementCount > LOG_LINES) this.log.firstElementChild?.remove();
  }
}
