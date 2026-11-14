/**
 * Outpost Defense on the HUD, under the wave plate: the credits, the next wave's line during a break, and the three shops,
 * red while lost. The countdown itself is the plate's, as in The Crucible.
 */
import type { Ctx } from '../../core/contracts';
import { SHOPS, SHOP_ORDER } from '../../contracts/defense/data';
import { Flag, Label, Shown, div, span } from '../dom';

export class DefenseHud {
  readonly el: HTMLElement;
  private credits: Label;
  private next: Label;
  private nextShown: Shown;
  private shops: { id: (typeof SHOP_ORDER)[number]; lost: Flag; hurt: Flag }[];

  constructor(private readonly ctx: Ctx) {
    const n = span('df-cr-n');
    const next = span('df-next');
    const chips = SHOP_ORDER.map(id => ({ id, el: span('df-shop', SHOPS[id].name) }));
    this.el = div('df', div('df-cr', span('df-cr-t', 'credits'), n), next, div('df-shops', ...chips.map(c => c.el)));
    this.credits = new Label(n);
    this.next = new Label(next);
    this.nextShown = new Shown(next, 'block');
    this.shops = chips.map(c => ({ id: c.id, lost: new Flag(c.el, 'lost'), hurt: new Flag(c.el, 'hurt') }));
  }

  update(): void {
    const d = this.ctx.contracts.defense;
    if (!d) return;
    this.credits.set(d.credits.toLocaleString('en-US'));
    const between = d.inBreak && !d.needLoadout;
    this.nextShown.set(between);
    if (between) this.next.set(`Next: ${d.preview}`);
    for (const s of this.shops) {
      const shop = d.shops[s.id];
      s.lost.set(shop.lost);
      s.hurt.set(!shop.lost && shop.health < shop.max);
    }
  }
}
