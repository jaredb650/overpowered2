/**
 * Loading: a line of hot metal running down a track, and a log of what it has got through.
 *
 * The boot has long stretches that report nothing and some that block the main thread. Everything that shows the page
 * is alive is a compositor transform, so it keeps moving through them: the stripes run forever, and after each report
 * the bar eases past it toward a limit it can only cross when the next report really arrives.
 */
import { Label, div, span } from '../dom';
import { wordmark } from './parts';
import type { Screen } from './Screens';

/** How far ahead of the last report the bar may ease. */
const CREEP = 0.03;
const LOG_LINES = 5;

/** A long silent step, with its best guess at how far it gets and how long that takes. */
export interface Crawl {
  to: number;
  seconds: number;
}

export class LoadingScreen implements Screen {
  readonly el: HTMLElement;
  private fill: HTMLElement;
  private label: Label;
  private pct: Label;
  private log: HTMLElement;
  private last = '';
  private peak = 0;
  private crawl: Crawl | null = null;
  private crawlFrom = 0;
  private crawlStart = 0;

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
    this.set(0, 'Starting');
  }

  open(): void {}

  set(fraction: number, label: string, crawl: Crawl | null = null): void {
    this.peak = Math.max(this.peak, Math.min(fraction, 1));
    const f = this.peak;
    // Both terms rise with f, so the bar's target never moves backward.
    const target = crawl ? crawl.to : fraction >= 1 ? 1 : f + Math.min(CREEP, (1 - f) * 0.5);
    const style = this.fill.style;
    style.transitionDuration = crawl ? `${crawl.seconds}s` : '';
    style.transitionTimingFunction = crawl ? 'linear' : '';
    style.transform = `translate3d(${((target - 1) * 100).toFixed(2)}%,0,0)`;
    this.showPercent(f);
    const crawlBegins = crawl !== null && this.crawl === null;
    this.crawl = crawl;
    if (crawlBegins) {
      this.crawlFrom = f;
      this.crawlStart = performance.now();
      requestAnimationFrame(this.tick);
    }
    if (label === this.last) return;
    if (this.last) this.logLine(this.last);
    this.last = label;
    this.label.set(label);
    performance.mark(`boot:${label}`);
  }

  private showPercent(f: number): void {
    this.pct.set(`${Math.round(f * 100)}%`);
  }

  /** The number has to be text, so it only keeps pace with the bar while the main thread is free. Crawls mostly are. */
  private tick = (now: number): void => {
    const crawl = this.crawl;
    if (!crawl) return;
    const t = Math.min((now - this.crawlStart) / (crawl.seconds * 1000), 1);
    this.showPercent(this.crawlFrom + (crawl.to - this.crawlFrom) * t);
    requestAnimationFrame(this.tick);
  };

  private logLine(text: string): void {
    this.log.append(span('ld-done', text));
    if (this.log.childElementCount > LOG_LINES) this.log.firstElementChild?.remove();
  }
}
