/** Call-in inventory above the health bar. Chips show the player's real key binding. */
import type { Ctx } from '../../core/contracts';
import type { CallInId } from '../../core/gameplay';
import { Label, SLAM, div, markup, span } from '../dom';
import { CALLIN_ORDER, CALLINS } from '../data';
import { callInIcon } from '../icons';
import type { HudState } from '../state';

class Chip {
  readonly el: HTMLElement;
  private key: Label;
  shown = false;
  constructor(readonly id: CallInId) {
    const info = CALLINS[id];
    const key = span('ci-key');
    this.el = div('ci', key, markup(callInIcon(id)), span('ci-name', info.name));
    this.el.style.setProperty('--c', info.color);
    this.el.style.display = 'none';
    this.key = new Label(key);
  }
  setKey(text: string): void {
    this.key.set(text);
  }
}

export class CallIns {
  readonly el: HTMLElement;
  private chips: Chip[];
  private clock = 0;

  constructor(private readonly ctx: Ctx) {
    this.chips = CALLIN_ORDER.map(id => new Chip(id));
    this.el = div('callins', ...this.chips.map(c => c.el));
  }

  private keyFor(id: CallInId): string {
    const input = this.ctx.input as unknown as { labelFor?: (a: string) => string };
    const label = typeof input.labelFor === 'function' ? input.labelFor(CALLINS[id].action) : undefined;
    return typeof label === 'string' ? label : '';
  }

  update(s: HudState, dt: number): void {
    this.clock -= dt;
    if (this.clock > 0) return;
    this.clock = 0.1;
    for (const chip of this.chips) {
      const has = s.hasCallIn(this.ctx, chip.id);
      if (has === chip.shown) continue;
      chip.shown = has;
      chip.el.style.display = has ? '' : 'none';
      if (has) {
        chip.setKey(this.keyFor(chip.id));
        chip.el.animate(SLAM as unknown as Keyframe[], 240);
      }
    }
  }

  /** Bindings can change in settings, so chips relabel on the way back into a run. */
  refreshKeys(): void {
    for (const chip of this.chips) chip.setKey(this.keyFor(chip.id));
  }
}
