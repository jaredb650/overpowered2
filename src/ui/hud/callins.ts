/** Call-in inventory above the health bar. Chips show the player's real key binding. */
import type { Ctx } from '../../core/contracts';
import type { CallInId } from '../../core/gameplay';
import { Flag, Label, SLAM, div, markup, span } from '../dom';
import { CALLIN_ORDER, CALLINS } from '../data';
import { callInIcon } from '../icons';
import type { HudState } from '../state';

class Chip {
  readonly el: HTMLElement;
  private key: Label;
  private wait: Label;
  private cooling: Flag;
  held = false;
  shown = false;
  constructor(readonly id: CallInId) {
    const info = CALLINS[id];
    const key = span('ci-key');
    const wait = span('ci-wait');
    this.el = div('ci', key, markup(callInIcon(id)), span('ci-name', info.name), wait);
    this.el.style.setProperty('--c', info.color);
    this.el.style.display = 'none';
    this.key = new Label(key);
    this.wait = new Label(wait);
    this.cooling = new Flag(this.el, 'cooling');
  }
  setKey(text: string): void {
    this.key.set(text);
  }
  /** `seconds` above 0 shows the wait until this strike can be earned again. */
  setCooldown(seconds: number): void {
    this.cooling.set(seconds > 0);
    this.wait.set(seconds > 0 ? String(Math.ceil(seconds)) : '');
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
    const progression = this.ctx.progression;
    for (const chip of this.chips) {
      const has = s.hasCallIn(this.ctx, chip.id);
      const left = !has && typeof progression.callInCooldown === 'function' ? progression.callInCooldown(chip.id) : 0;
      const wait = typeof left === 'number' ? left : 0;
      chip.setCooldown(wait);
      const show = has || wait > 0;
      if (show !== chip.shown) {
        chip.shown = show;
        chip.el.style.display = show ? '' : 'none';
      }
      if (has && !chip.held) {
        chip.setKey(this.keyFor(chip.id));
        chip.el.animate(SLAM as unknown as Keyframe[], 240);
      }
      chip.held = has;
    }
  }

  /** Bindings can change in settings, so chips relabel on the way back into a run. */
  reset(): void {
    for (const chip of this.chips) {
      chip.setKey(this.keyFor(chip.id));
      chip.setCooldown(0);
      chip.held = chip.shown = false;
      chip.el.style.display = 'none';
    }
  }
}
