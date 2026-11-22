/**
 * The shops' "are you sure" (owner, 2026-11-22): a row that costs credits is never bought on the first press. `ask` puts a small
 * form over the screen naming the thing and its price; Enter or Space, or a click on Buy, goes ahead; Esc, Backspace, a click on
 * Cancel or a click anywhere outside the form drops it. While it is up it owns the keyboard: no key reaches the menu under it.
 */
import { div, h, span } from '../dom';

/** The small print under the question, one picked per ask. The Office's voice. */
const FINE_PRINT = [
  'Funds leave your account the moment you agree, which you are about to.',
  'The Office thanks you for your continued participation in the economy.',
  'This purchase will be noted in your file. Everything is.',
  'Requisitions approved within the break are delivered within the break.',
] as const;

export interface Ask {
  /** What is being bought, as the row names it. */
  what: string;
  /** Its price, already formatted. */
  price: string;
  yes(): void;
  /** Runs on Esc, Cancel or a click outside. */
  no?(): void;
}

export class ConfirmBox {
  readonly el: HTMLElement;
  private readonly text: HTMLElement;
  private readonly price: HTMLElement;
  private readonly small: HTMLElement;
  private current: Ask | null = null;
  private asked = 0;

  constructor(private readonly sound: (id: string) => void = () => undefined) {
    this.text = span('cf-q');
    this.price = span('cf-price');
    this.small = span('cf-small');
    const yesBtn = h('button', 'cf-btn cf-yes', 'Buy');
    yesBtn.type = 'button';
    const noBtn = h('button', 'cf-btn cf-no', 'Cancel');
    noBtn.type = 'button';
    yesBtn.addEventListener('click', e => { e.stopPropagation(); this.answer(true); });
    noBtn.addEventListener('click', e => { e.stopPropagation(); this.answer(false); });
    const box = div('cf-box', span('cf-form', 'Form 7742-C · Confirmation of intent'), this.text, this.price, this.small,
      div('cf-btns', noBtn, span('cf-keys', 'Enter: buy · Esc: cancel'), yesBtn));
    box.addEventListener('click', e => e.stopPropagation());
    this.el = div('cf', box);
    this.el.style.display = 'none';
    // Outside the form is a no.
    this.el.addEventListener('click', () => this.answer(false));
    // Capture, on the window: this runs before the menus' own key handlers, and stops them for every key while it is up.
    addEventListener('keydown', e => {
      if (!this.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') this.answer(true);
      else if (e.code === 'Escape' || e.code === 'Backspace') this.answer(false);
    }, true);
  }

  get open(): boolean {
    return this.current !== null;
  }

  ask(a: Ask): void {
    this.current = a;
    this.text.textContent = `Are you sure you'd like to buy ${a.what}?`;
    this.price.textContent = a.price;
    this.small.textContent = FINE_PRINT[this.asked++ % FINE_PRINT.length]!;
    this.el.style.display = '';
  }

  /** Drops the question without an answer, as a screen closes under it. */
  close(): void {
    this.current = null;
    this.el.style.display = 'none';
  }

  private answer(yes: boolean): void {
    const a = this.current;
    if (!a) return;
    this.close();
    if (yes) a.yes();
    else {
      this.sound('ui_back');
      a.no?.();
    }
  }
}
