/**
 * Outpost Defense on the HUD, under the wave plate: the credits, the next wave's line during a break with the key that starts it
 * now, and the three shops, red while lost. The countdown itself is the plate's, as in The Crucible. `ring` is the progress ring
 * under the crosshair while the player boards up a wall (contracts/defense/repair.ts).
 */
import type { Ctx } from '../../core/contracts';
import { SHOPS, SHOP_ORDER } from '../../contracts/defense/data';
import { handPay } from '../../contracts/defense/repair';
import { Flag, Label, Shown, div, markup, span } from '../dom';

/** The ring's circumference, for its dash: r = 26 in a 64 box. */
const ARC = 2 * Math.PI * 26;

export class DefenseHud {
  readonly el: HTMLElement;
  readonly ring: HTMLElement;
  private ringShown: Shown;
  private arc: SVGCircleElement;
  private ringText: Label;
  private arcAt = -1;
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
    const svg = markup<SVGSVGElement>(
      `<svg class="df-fix-svg" viewBox="0 0 64 64" aria-hidden="true"><circle class="df-fix-bg" cx="32" cy="32" r="26"/><circle class="df-fix-arc" cx="32" cy="32" r="26" stroke-dasharray="${ARC.toFixed(1)}" stroke-dashoffset="${ARC.toFixed(1)}"/></svg>`,
    );
    const text = span('df-fix-t');
    this.ring = div('df-fix', svg as unknown as HTMLElement, text);
    this.arc = svg.querySelector('.df-fix-arc')!;
    this.ringText = new Label(text);
    this.ringShown = new Shown(this.ring, 'flex');
    this.ringShown.set(false);
  }

  update(): void {
    const d = this.ctx.contracts.defense;
    if (!d) return;
    this.credits.set(d.credits.toLocaleString('en-US'));
    const between = d.inBreak && !d.needLoadout;
    this.nextShown.set(between);
    if (between) {
      // The early start only means something once there is a wave to bring forward and more than its last seconds to save.
      const key = this.ctx.input.labelFor?.('nextWave') ?? 'L';
      const early = this.ctx.waves.nextWaveIn > 3 ? `  ·  ${key}: START NOW` : '';
      this.next.set(`Next: ${d.preview}${early}`);
    }
    for (const s of this.shops) {
      const shop = d.shops[s.id];
      s.lost.set(shop.lost);
      s.hurt.set(!shop.lost && shop.health < shop.max);
    }
    const r = d.repair;
    this.ringShown.set(r.working && r.piece !== null);
    if (r.working && r.piece) {
      const at = Math.round(r.progress * 100);
      if (at !== this.arcAt) {
        this.arcAt = at;
        this.arc.setAttribute('stroke-dashoffset', (ARC * (1 - at / 100)).toFixed(1));
      }
      this.ringText.set(r.blocked ? 'CLEAR THE GAP' : `BOARDING UP  +${handPay(r.piece)}`);
    }
  }
}
