/** Sonar chip above the call-ins. Solid when a ping is ready, otherwise a dark plate that fills back up to it. */
import type { Ctx } from '../../core/contracts';
import { Flag, Label, Meter, SLAM, div, span } from '../dom';
import type { HudState } from '../state';

export class SonarChip {
  readonly el: HTMLElement;
  private key: Label;
  private wait: Label;
  private refill: Meter;
  private cooling: Flag;
  private wasReady = true;

  constructor(private readonly ctx: Ctx) {
    const key = span('ci-key');
    const wait = span('ci-wait');
    const refill = div('sn-fill');
    this.el = div('ci sn', key, span('ci-name sn-name', 'Sonar'), wait, refill);
    this.el.style.setProperty('--c', 'var(--cold)');
    this.key = new Label(key);
    this.wait = new Label(wait);
    this.refill = new Meter(refill);
    this.cooling = new Flag(this.el, 'cooling');
  }

  update(s: HudState): void {
    const ready = s.sonarWait <= 0;
    this.cooling.set(!ready);
    this.wait.set(ready ? '' : String(Math.ceil(s.sonarWait)));
    this.refill.set(ready ? 0 : 1 - s.sonarWait / s.sonarLimit);
    if (ready && !this.wasReady) this.el.animate(SLAM as unknown as Keyframe[], 240);
    this.wasReady = ready;
  }

  /** Bindings can change in settings, so the chip relabels on the way back into a run. */
  reset(): void {
    const input = this.ctx.input as unknown as { labelFor?: (a: string) => unknown };
    const label = typeof input.labelFor === 'function' ? input.labelFor('sonar') : '';
    this.key.set(typeof label === 'string' ? label : '');
    this.wasReady = true;
  }
}
