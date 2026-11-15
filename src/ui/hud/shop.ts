/**
 * The Crucible's shop on the HUD (contracts/shop), under the wave plate as Outpost Defense's credits are, in their look: the
 * credits, and in a break the key that opens the shop.
 */
import type { Ctx } from '../../core/contracts';
import { Label, Shown, div, span } from '../dom';

export class ShopHud {
  readonly el: HTMLElement;
  private readonly credits: Label;
  private readonly hint: Label;
  private readonly hintShown: Shown;

  constructor(private readonly ctx: Ctx) {
    const n = span('df-cr-n');
    const hint = span('df-next');
    this.el = div('df', div('df-cr', span('df-cr-t', 'credits'), n), hint);
    this.credits = new Label(n);
    this.hint = new Label(hint);
    this.hintShown = new Shown(hint, 'block');
  }

  update(): void {
    const shop = this.ctx.contracts.shop;
    if (!shop) return;
    this.credits.set(shop.credits.toLocaleString('en-US'));
    this.hintShown.set(shop.inBreak);
    if (shop.inBreak) this.hint.set(`${this.ctx.input.labelFor?.('shop') ?? 'I'}: SHOP`);
  }
}
