/**
 * Outpost Defense's buy menu (contracts/defense), on the settings sheet's rail and rows. One shop at a time, opened at its
 * counter with E. The run waits under it. Every row says its price, and a row that cannot be bought says why instead of
 * what it is. Enter or a click buys; Esc, E or Close goes back to the fight.
 */
import type { Ctx } from '../../core/contracts';
import { SHOPS, type ShopId } from '../../contracts/defense/data';
import type { Offer } from '../../contracts/defense/economy';
import { Label, div, span } from '../dom';
import type { Hud } from '../Hud';
import type { Nav, NavItem } from './nav';
import { menuButton } from './parts';
import type { Screen } from './Screens';

const credits = (n: number): string => n.toLocaleString('en-US');

/** A row: name, what it is or why not, price. */
function offerRow(o: Offer, buy: () => void): NavItem {
  const el = div('row sp-row', span('row-k', o.label), span('sp-detail', o.why ?? o.detail), span('row-v', o.price > 0 ? credits(o.price) : ''));
  el.classList.toggle('off', o.why !== null);
  el.classList.toggle('poor', o.why?.startsWith('Need') === true);
  return { el, activate: buy };
}

export class ShopScreen implements Screen {
  readonly el: HTMLElement;
  shop: ShopId = 'armoury';
  private nav: Nav | null = null;
  private body: HTMLElement;
  private title: Label;
  private blurb: Label;
  private wallet: Label;
  private phase: Label;
  private note: Label;
  private close: NavItem;

  constructor(private readonly ctx: Ctx, private readonly hud: Hud) {
    const title = span('sh-title');
    const blurb = span('rl-hint');
    const wallet = span('rl-state-k');
    const phase = span('rl-state-v');
    const note = span('set-note');
    this.close = menuButton('Close', () => this.leave());
    this.close.el.classList.add('mi-small');
    this.body = div('gd-panel sp-panel');
    this.el = div('scr scr-sheet scr-shop',
      div('sh-side', title, blurb, div('rl-state sp-wallet', span('rl-plan-k', 'Credits'), wallet, phase), div('fill'), note, this.close.el),
      div('sh-body', this.body),
    );
    this.title = new Label(title);
    this.blurb = new Label(blurb);
    this.wallet = new Label(wallet);
    this.phase = new Label(phase);
    this.note = new Label(note);
    // E is the counter's key, so it shuts the menu too.
    addEventListener('keydown', e => {
      if (this.hud.screens.name === 'shop' && e.code === 'KeyE' && !e.repeat) this.leave();
    });
  }

  private refresh(keep: number): void {
    const defense = this.ctx.contracts.defense;
    if (!defense) return;
    const list = defense.offers(this.shop);
    const items: NavItem[] = [];
    const kids: HTMLElement[] = [];
    let section = '';
    for (const o of list) {
      if (o.section !== section) {
        section = o.section;
        kids.push(span('gd-h', section));
      }
      const item = offerRow(o, () => this.buy(o));
      items.push(item);
      kids.push(item.el);
    }
    this.body.replaceChildren(div('set-list', ...kids));
    items.push(this.close);
    this.wallet.set(credits(defense.credits));
    const waves = defense.waves;
    this.phase.set(defense.inBreak
      ? `Break: wave ${waves.wave + 1} in ${Math.max(0, Math.ceil(waves.nextWaveIn))} s. Weapons on sale.`
      : `Wave ${waves.wave} under way. Weapons wait for the break.`);
    this.nav?.set(items, Math.min(keep, items.length - 1));
  }

  private buy(o: Offer): void {
    const defense = this.ctx.contracts.defense;
    if (!defense) return;
    const why = defense.buy(this.shop, o.act);
    if (why) {
      this.note.set(why);
      this.ctx.audio.play?.('ui_error');
    } else {
      this.note.set(`Bought: ${o.label}`);
      this.ctx.audio.play?.('ui_confirm');
    }
    this.refresh(this.nav?.index ?? 0);
  }

  private leave(): void {
    if (!this.hud.resume()) this.note.set('The browser wants a key or a click: press Enter on Close.');
  }

  open(nav: Nav): void {
    this.nav = nav;
    const def = SHOPS[this.shop];
    this.title.set(def.name);
    this.blurb.set(def.blurb);
    this.note.set('');
    nav.back = () => this.leave();
    nav.left = nav.right = null;
    this.refresh(0);
  }
}
