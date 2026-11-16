/**
 * Key T's badge above the call-ins: the brain chip in hand (contracts/chips.ts) and its state. Solid when Sonar is ready, Thermal on,
 * or Focus has enough meter to start; otherwise a dark plate. The bar along the bottom is Sonar's cooldown filling back up, or the
 * focus meter. With two chips fitted, two pips say which is in hand.
 */
import type { Ctx } from '../../core/contracts';
import { Flag, Label, Meter, SLAM, div, span } from '../dom';
import type { HudState } from '../state';

export class SonarChip {
  readonly el: HTMLElement;
  private key: Label;
  private name: Label;
  private wait: Label;
  private refill: Meter;
  private cooling: Flag;
  private pips: HTMLElement;
  private pipKey = '';
  private wasReady = true;
  private color = '';
  private chipName = 'Sonar';

  constructor(private readonly ctx: Ctx) {
    const key = span('ci-key');
    const name = span('ci-name sn-name', 'BRAIN · SONAR');
    const wait = span('ci-wait');
    const refill = div('sn-fill');
    this.pips = div('sn-pips');
    this.el = div('ci sn', key, name, wait, this.pips, refill);
    this.setColor('var(--cold)');
    this.key = new Label(key);
    this.name = new Label(name);
    this.wait = new Label(wait);
    this.refill = new Meter(refill);
    this.cooling = new Flag(this.el, 'cooling');
  }

  private setColor(c: string): void {
    if (c === this.color) return;
    this.color = c;
    this.el.style.setProperty('--c', c);
  }

  update(s: HudState): void {
    const chip = s.chip;
    if (!chip) {
      const ready = s.sonarWait <= 0;
      this.show(ready, ready ? '' : String(Math.ceil(s.sonarWait)), ready ? 0 : 1 - s.sonarWait / s.sonarLimit, 'Sonar');
      return;
    }
    this.name.set(chip.name === 'No brain chip' ? 'NO BRAIN CHIP' : `BRAIN · ${chip.name.toUpperCase()}`);
    this.setColor(chip.color);
    const key = chip.count < 2 ? '' : `${chip.index}/${chip.count}`;
    if (key !== this.pipKey) {
      this.pipKey = key;
      this.pips.replaceChildren(...Array.from({ length: chip.count < 2 ? 0 : chip.count }, (_, i) =>
        span(i === chip.index ? 'sn-pip on' : 'sn-pip')));
    }
    this.show(chip.lit, chip.text, chip.fill, chip.name);
  }

  private show(ready: boolean, text: string, fill: number, name: string): void {
    this.cooling.set(!ready);
    this.wait.set(text);
    this.refill.set(fill);
    // A slam when it comes back, and when the hand moves to another chip.
    if (name !== this.chipName || (ready && !this.wasReady)) this.el.animate(SLAM as unknown as Keyframe[], 240);
    this.chipName = name;
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
