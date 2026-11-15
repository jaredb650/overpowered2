/**
 * The Crucible's shop menu (contracts/shop), over a paused run in a break, as Outpost Defense's shops are. Two pages, weapons
 * and mods, on the left; the gun in focus turns in a lit studio drawn in place of the world (backdrop/gunstage.ts), with its card
 * under it: name, role, stats bars, the catalogue's line, and the price or why not. A mod shows fitted on its gun, its bars
 * showing what it adds.
 *
 * Keys: up and down pick a row, left and right turn the page, Enter or a click buys (or fits and takes off a mod bought), Esc,
 * E or Close goes back to the fight.
 */
import type { Ctx } from '../../core/contracts';
import type { ModId, WeaponId } from '../../core/gameplay';
import { SHOP_COPY } from '../../contracts/shop/data';
import type { ShopOffer } from '../../contracts/shop/rules';
import { WEAPONS as DEFS, type WeaponDef } from '../../weapons/data';
import { MODS, moddedDef } from '../../weapons/mods';
import { GunStage } from '../backdrop/gunstage';
import { WEAPONS as INFO } from '../data';
import { Label, div, h, markup, span } from '../dom';
import type { Hud } from '../Hud';
import { weaponIcon } from '../icons';
import type { Nav, NavItem } from './nav';
import { menuButton } from './parts';
import type { Screen } from './Screens';

type Page = 'weapons' | 'mods';

const LOCK_ICON = '<svg class="pc-lock" viewBox="0 0 12 14" aria-hidden="true"><path d="M3 6V4a3 3 0 0 1 6 0v2h1.5v8h-9V6Zm1.6 0h2.8V4a1.4 1.4 0 0 0-2.8 0Z"/></svg>';

const credits = (n: number): string => n.toLocaleString('en-US');
const log01 = (v: number, lo: number, hi: number): number => Math.min(1, Math.max(0.04, Math.log(v / lo) / Math.log(hi / lo)));

/** One bar: what it measures, how full, and the number on it. */
interface Stat {
  label: string;
  of(d: WeaponDef): number;
  text(d: WeaponDef): string;
}

const perPull = (d: WeaponDef): number => d.damage * Math.max(1, d.pellets);

const STATS: readonly Stat[] = [
  { label: 'Damage', of: d => log01(perPull(d), 8, 1200), text: d => `${Math.round(perPull(d))}${d.pellets > 1 ? ` (${d.pellets}x)` : ''}` },
  { label: 'Rate', of: d => log01(60 / d.interval, 40, 1800), text: d => `${Math.round(60 / d.interval)} rpm` },
  { label: 'Magazine', of: d => log01(Math.max(1, d.magSize), 1, 200), text: d => String(d.magSize) },
  { label: 'Reload', of: d => Math.max(0.06, 1 - d.reloadTime / 2.6), text: d => `${d.reloadTime.toFixed(1)} s` },
];

export class ProcurementScreen implements Screen {
  readonly el: HTMLElement;
  private nav: Nav | null = null;
  private page: Page = 'weapons';
  private readonly stage: GunStage;
  private readonly list: HTMLElement;
  private readonly tabs: Record<Page, HTMLElement>;
  private readonly wallet: Label;
  private readonly phase: Label;
  private readonly note: Label;
  private readonly close: NavItem;
  private readonly card: {
    name: Label; role: Label; lore: Label; price: Label; state: Label; stats: HTMLElement; buy: HTMLElement;
  };
  private offers: ShopOffer[] = [];
  private focusAct: ShopOffer['act'] | null = null;

  constructor(private readonly ctx: Ctx, private readonly hud: Hud) {
    this.stage = new GunStage(ctx);
    const tab = (p: Page, label: string): HTMLElement => {
      const t = h('button', 'tab pc-tab', label);
      t.type = 'button';
      t.addEventListener('click', () => this.turn(p));
      return t;
    };
    this.tabs = { weapons: tab('weapons', 'Weapons'), mods: tab('mods', 'Mods') };
    const wallet = span('pc-cr-n');
    const phase = span('pc-phase');
    const note = span('pc-note');
    this.close = menuButton('Back to the fight', () => this.leave());
    this.close.el.classList.add('mi-small');
    this.list = div('pc-list');
    const name = span('pc-name');
    const role = span('pc-role');
    const lore = h('p', 'pc-lore');
    const price = span('pc-price');
    const state = span('pc-state');
    const stats = div('pc-stats');
    const buy = div('pc-buy', price, state);
    this.card = { name: new Label(name), role: new Label(role), lore: new Label(lore), price: new Label(price), state: new Label(state), stats, buy };
    this.el = div('scr scr-proc',
      div('pc-side',
        span('pc-form', SHOP_COPY.form),
        span('pc-title', SHOP_COPY.title),
        div('pc-cr', span('pc-cr-t', 'Credits'), wallet),
        phase,
        div('pc-tabs', this.tabs.weapons, this.tabs.mods),
        this.list,
        note,
        span('pc-terms', SHOP_COPY.terms),
        this.close.el,
      ),
      div('pc-card', name, role, stats, lore, buy),
    );
    this.wallet = new Label(wallet);
    this.phase = new Label(phase);
    this.note = new Label(note);
    addEventListener('keydown', e => {
      if (this.hud.screens.name !== 'procurement' || e.repeat) return;
      // E opened it at the pod, so it shuts it too.
      if (e.code === 'KeyE') this.leave();
    });
  }

  open(nav: Nav): void {
    this.nav = nav;
    this.note.set('');
    nav.back = () => this.leave();
    nav.left = () => this.turn(this.page === 'weapons' ? 'mods' : 'weapons');
    nav.right = nav.left;
    this.stage.active = true;
    this.refresh(0);
  }

  closed(): void {
    this.stage.active = false;
  }

  update(dt: number): void {
    this.stage.update(dt);
    const waves = this.ctx.waves;
    this.phase.set(`Break. Wave ${waves.wave + 1} in ${Math.max(0, Math.ceil(waves.nextWaveIn))} s, when you leave.`);
  }

  private get shop() {
    return this.ctx.contracts.shop ?? null;
  }

  private turn(p: Page): void {
    if (p === this.page) return;
    this.page = p;
    this.ctx.audio.play?.('ui_hover');
    this.refresh(0);
  }

  private refresh(keep: number): void {
    const shop = this.shop;
    if (!shop) return;
    for (const p of ['weapons', 'mods'] as const) this.tabs[p].classList.toggle('on', p === this.page);
    this.offers = this.page === 'weapons' ? shop.weaponOffers() : shop.modOffers();
    const items: NavItem[] = this.offers.map(o => this.row(o));
    this.list.replaceChildren(...items.map(i => i.el));
    items.push(this.close);
    this.wallet.set(credits(shop.credits));
    const at = Math.min(keep, this.offers.length - 1);
    this.nav?.set(items, at);
    this.select(this.offers[at]!);
  }

  private row(o: ShopOffer): NavItem {
    const gun = o.act.kind === 'weapon' ? o.act.id : MODS[o.act.id].weapon;
    const label = o.act.kind === 'weapon' ? INFO[o.act.id].name : MODS[o.act.id].name;
    const right = o.fitted ? 'Fitted' : o.owned ? (o.act.kind === 'mod' ? 'Fit' : 'Owned')
      : o.locked ? `Wave ${o.ware.wave}` : credits(o.ware.price);
    const el = div('pc-row',
      span('pc-ico', markup(weaponIcon(gun))),
      span('pc-k', label),
      span('pc-v', o.locked ? markup(LOCK_ICON) : null, right),
    );
    el.classList.toggle('locked', o.locked);
    el.classList.toggle('owned', o.owned && !o.fitted);
    el.classList.toggle('fitted', o.fitted);
    el.classList.toggle('poor', o.why?.startsWith('Need') === true);
    return { el, activate: () => this.buy(o), focused: () => this.select(o) };
  }

  /** The row in focus: its gun on the turntable, and its card. */
  private select(o: ShopOffer): void {
    this.focusAct = o.act;
    const mod = o.act.kind === 'mod' ? o.act.id : null;
    const id: WeaponId = mod ? MODS[mod].weapon : (o.act.id as WeaponId);
    // A mod shows fitted on its gun; a gun shows as it would come to you, with what you have fitted on it.
    const fitted = new Set<ModId>(mod ? [mod] : [...(this.ctx.weapons.fitted ?? [])]);
    this.stage.show(id, fitted);
    const c = this.card;
    c.name.set(mod ? `${INFO[id].name}: ${MODS[mod].name}` : INFO[id].name);
    c.role.set(`Key ${DEFS[id].slot}. ${INFO[id].role}`);
    c.lore.set(o.ware.lore);
    this.bars(DEFS[id], mod ? moddedDef(id, new Set([mod])) : DEFS[id]);
    const verb = o.act.kind === 'mod' && o.owned ? (o.fitted ? 'Take off' : 'Fit') : 'Buy';
    c.price.set(o.owned ? (o.act.kind === 'mod' ? 'Bought' : 'Owned') : credits(o.ware.price));
    c.state.set(o.why ?? `Enter: ${verb}`);
    c.buy.classList.toggle('locked', o.locked);
    c.buy.classList.toggle('ready', o.why === null);
    c.buy.classList.toggle('poor', o.why?.startsWith('Need') === true);
  }

  /** The bars for `now`, with what it adds over `base` lit. */
  private bars(base: WeaponDef, now: WeaponDef): void {
    this.card.stats.replaceChildren(...STATS.map(s => {
      const from = s.of(base), to = s.of(now);
      const fill = span('pc-fill');
      fill.style.width = `${(Math.min(from, to) * 100).toFixed(1)}%`;
      const gain = span('pc-gain');
      gain.style.left = fill.style.width;
      gain.style.width = `${(Math.max(0, to - from) * 100).toFixed(1)}%`;
      return div('pc-stat', span('pc-stat-k', s.label), div('pc-bar', fill, gain), span('pc-stat-v', s.text(now)));
    }));
  }

  private buy(o: ShopOffer): void {
    const shop = this.shop;
    if (!shop) return;
    const why = shop.buy(o.act);
    const name = o.act.kind === 'weapon' ? INFO[o.act.id].name : MODS[o.act.id].name;
    if (why) {
      this.note.set(why);
      this.ctx.audio.play?.('ui_error');
    } else {
      const fitted = o.act.kind === 'mod' && this.ctx.weapons.fitted?.has(o.act.id);
      this.note.set(o.act.kind === 'weapon' ? `Bought: ${name}` : fitted ? `Fitted: ${name}` : `Taken off: ${name}`);
      this.ctx.audio.play?.('ui_confirm');
    }
    const keep = this.offers.findIndex(x => x.act === this.focusAct);
    this.refresh(Math.max(0, keep));
  }

  private leave(): void {
    this.stage.active = false;
    if (!this.hud.resume()) {
      this.stage.active = true;
      this.note.set('The browser wants a key or a click: press Enter on Back to the fight.');
    }
  }
}
