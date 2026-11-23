/**
 * The Crucible's shop on the HUD (contracts/shop), under the wave plate as Outpost Defense's credits are, in their look: the
 * credits, and in a break where the shop is (the supply pod, marked on the map) and the key that starts the next wave now.
 */
import type { Ctx } from '../../core/contracts';
import { Label, Shown, div, span } from '../dom';

export class ShopHud {
  readonly el: HTMLElement;
  private readonly credits: Label;
  private readonly hint: Label;
  private readonly hintShown: Shown;
  private lastCredits = -1;

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
    if (shop.credits !== this.lastCredits) {
      this.lastCredits = shop.credits;
      this.credits.set(shop.credits.toLocaleString('en-US'));
    }
    this.hintShown.set(shop.inBreak);
    if (shop.inBreak) {
      // Co-op: the key is a vote, and the co-op HUD shows the count (net/coopHud.ts).
      const early = this.ctx.coop?.world ? '' : this.ctx.waves.nextWaveIn > 3 ? `  ·  ${this.ctx.input.labelFor?.('nextWave') ?? 'L'}: START NOW` : '';
      this.hint.set(`Shop: the supply pod, ${this.ctx.input.labelFor?.('interact') ?? 'E'} at it${early}`);
    }
  }
}
