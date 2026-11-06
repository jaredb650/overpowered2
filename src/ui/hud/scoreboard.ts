/** Held Tab: the live run report, in the same table the game-over screen uses. */
import { div } from '../dom';
import { statRows } from '../screens/stats';
import type { RunReport } from '../runreport';

const REFRESH = 0.5;

export class Scoreboard {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private held = false;
  private frames = 0;

  constructor(private readonly report: RunReport) {
    this.body = div('stats');
    this.el = div('scoreboard', this.body);
    this.el.style.display = 'none';
  }

  setHeld(on: boolean): void {
    if (on === this.held) return;
    this.held = on;
    this.el.style.display = on ? '' : 'none';
    if (on) {
      this.frames = 0;
      this.refresh();
    }
  }

  update(held: boolean): void {
    this.setHeld(held);
    if (!held) return;
    // Roughly twice a second; this only runs while the key is down and is not worth a clock.
    if (++this.frames > REFRESH * 60) {
      this.frames = 0;
      this.refresh();
    }
  }

  private refresh(): void {
    this.body.replaceChildren(...statRows(this.report));
  }
}
