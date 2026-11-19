/**
 * The Crucible's shop menu (contracts/shop), over a paused run in a break, as Outpost Defense's shops are. Three pages, weapons,
 * mods and implants, on the left; the gun in focus turns in a lit studio drawn in place of the world (backdrop/gunstage.ts), with
 * its card under it: name, role, stats bars, the catalogue's line, and the price or why not. A mod shows fitted on its gun, its bars
 * showing what it adds. On the implants page the contractor stands in the studio instead (backdrop/bodystage.ts), wearing the
 * loadout with the implant in focus put on him, and the slots and the standard-issue core are listed over the rows. The brain
 * chips for key T (contracts/chips.ts) are sold under the implants on the same page: they are hardware in the head too.
 *
 * Keys: up and down pick a row, left and right turn the page, Enter or a click buys (or fits and takes off a mod bought), X or
 * Delete sells a gun owned back (twice: the first asks), Esc, E or Close goes back to the fight.
 */
import type { Ctx } from '../../core/contracts';
import type { ModId, WeaponId } from '../../core/gameplay';
import { ACTIVE } from '../../contracts/select';
import { SHOP_COPY, SUPPLY_WARES, lockWave, type SupplyId } from '../../contracts/shop/data';
import { issued, type ShopOffer } from '../../contracts/shop/rules';
import { WEAPONS as DEFS, type WeaponDef } from '../../weapons/data';
import { MODS, MOD_ORDER, moddedDef } from '../../weapons/mods';
import { EFFECTS, PICKUP_LOOK, implantColor, implantLabel } from '../../progression/data';
import { CLASS_NAMES, CLASS_REGION, CORE_COPY, IMPLANTS, SLOT_WARES, type ImplantId } from '../../progression/implants';
import { CHIPS, CHIP_SLOTS } from '../../contracts/chips';
import { BodyStage } from '../backdrop/bodystage';
import { GunStage } from '../backdrop/gunstage';
import { WEAPONS as INFO } from '../data';
import { Label, div, h, markup, span } from '../dom';
import type { Hud } from '../Hud';
import { weaponIcon } from '../icons';
import type { Nav, NavItem } from './nav';
import { menuButton } from './parts';
import type { Screen } from './Screens';

type Page = 'weapons' | 'mods' | 'implants';
const PAGES: readonly Page[] = ['weapons', 'mods', 'implants'];

/** "BERSERK!" to "Berserk", "CHAIN STORM" to "Chain Storm". */
const implantName = (id: ImplantId): string =>
  implantLabel(id).replace(/!$/, '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

const LOCK_ICON = '<svg class="pc-lock" viewBox="0 0 12 14" aria-hidden="true"><path d="M3 6V4a3 3 0 0 1 6 0v2h1.5v8h-9V6Zm1.6 0h2.8V4a1.4 1.4 0 0 0-2.8 0Z"/></svg>';

const credits = (n: number): string => n.toLocaleString('en-US');
/** A resupply row's tag and its colour: the pickups' own. */
const SUPPLY_TAG: Readonly<Record<SupplyId, [string, string]>> = {
  ammo: ['Ammo', PICKUP_LOOK.ammo.color], heal: ['Health', PICKUP_LOOK.health.color], armor: ['Armour', PICKUP_LOOK.armor.color],
};
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
  // Akimbo's two guns in turn: twice one gun's rate.
  { label: 'Rate', of: d => log01(60 / d.interval * (d.akimbo ? 2 : 1), 40, 1800), text: d => `${Math.round(60 / d.interval * (d.akimbo ? 2 : 1))} rpm` },
  { label: 'Magazine', of: d => log01(Math.max(1, d.magSize), 1, 200), text: d => String(d.magSize) },
  { label: 'Reload', of: d => Math.max(0.06, 1 - d.reloadTime / 2.6), text: d => `${d.reloadTime.toFixed(1)} s` },
];

export class ProcurementScreen implements Screen {
  readonly el: HTMLElement;
  private nav: Nav | null = null;
  private page: Page = 'weapons';
  private readonly stage: GunStage;
  private readonly body: BodyStage;
  private readonly list: HTMLElement;
  /** The implants page's head: the three slots, the two chip slots, and the core. */
  private readonly slotStrip: HTMLElement;
  private readonly chipStrip: HTMLElement;
  private readonly implantHead: HTMLElement;
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
  /** The row in focus, and the gun whose Sell has been pressed once and waits for the second press. */
  private focused: ShopOffer | null = null;
  private sellArmed: WeaponId | null = null;
  private readonly sellBtn: HTMLButtonElement;

  constructor(private readonly ctx: Ctx, private readonly hud: Hud) {
    this.stage = new GunStage(ctx);
    this.body = new BodyStage(ctx);
    const tab = (p: Page, label: string): HTMLElement => {
      const t = h('button', 'tab pc-tab', label);
      t.type = 'button';
      t.addEventListener('click', () => this.turn(p));
      return t;
    };
    this.tabs = { weapons: tab('weapons', 'Weapons'), mods: tab('mods', 'Mods'), implants: tab('implants', 'Implants') };
    this.slotStrip = div('pc-slots');
    this.chipStrip = div('pc-slots pc-chips');
    this.implantHead = div('pc-imp-head', this.slotStrip, this.chipStrip, span('pc-core', CORE_COPY));
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
    this.sellBtn = h('button', 'pc-sell');
    this.sellBtn.type = 'button';
    this.sellBtn.addEventListener('click', () => this.sellFocused());
    this.el = div('scr scr-proc',
      div('pc-side',
        span('pc-form', SHOP_COPY.form),
        span('pc-title', SHOP_COPY.title),
        div('pc-cr', span('pc-cr-t', 'Credits'), wallet),
        phase,
        div('pc-tabs', this.tabs.weapons, this.tabs.mods, this.tabs.implants),
        this.implantHead,
        this.list,
        note,
        span('pc-terms', SHOP_COPY.terms),
        this.close.el,
      ),
      div('pc-card', name, role, stats, lore, buy, this.sellBtn),
    );
    this.wallet = new Label(wallet);
    this.phase = new Label(phase);
    this.note = new Label(note);
    addEventListener('keydown', e => {
      if (this.hud.screens.name !== 'procurement' || e.repeat) return;
      // E opened it at the pod, so it shuts it too.
      if (e.code === 'KeyE') this.leave();
      if (e.code === 'KeyX' || e.code === 'Delete') this.sellFocused();
    });
  }

  /** Co-op: the wave started under the open shop and it has been told to shut. */
  private shut = false;

  open(nav: Nav): void {
    this.nav = nav;
    this.shut = false;
    this.note.set('');
    nav.back = () => this.leave();
    const step = (by: number) => () => this.turn(PAGES[(PAGES.indexOf(this.page) + by + PAGES.length) % PAGES.length]!);
    nav.left = step(-1);
    nav.right = step(1);
    this.studio(true);
    this.refresh(0);
  }

  closed(): void {
    this.studio(false);
  }

  /** The gun's studio or the contractor's, whichever the page wants, or neither. */
  private studio(on: boolean): void {
    // A resupply row shows the contractor, not a gun.
    const body = on && (this.page === 'implants' || this.focusAct?.kind === 'supply');
    const gun = on && !body;
    // Down first, so the one going up is the one the renderer keeps.
    if (!gun) this.stage.active = false;
    if (!body) this.body.active = false;
    this.stage.active = gun;
    this.body.active = body;
  }

  update(dt: number): void {
    this.stage.update(dt);
    this.body.update(dt);
    const waves = this.ctx.waves;
    const left = Math.max(0, Math.ceil(waves.nextWaveIn));
    const rest = this.ctx.coop?.world?.team.rest;
    if (!rest) {
      this.phase.set(`Break. Wave ${waves.wave + 1} in ${left} s, when you leave.`);
      return;
    }
    // Co-op: nothing waits under the shop. The clock is the team's and it is running; the key readies up from here too.
    const key = this.ctx.input.labelFor?.('nextWave') ?? 'L';
    const mine = this.ctx.coop?.lobby.me?.slot ?? -1;
    if (waves.phase === 'intermission') {
      this.phase.set(`Break. Wave ${waves.wave + 1} in ${left} s. The clock is running: ${rest.ready.length}/${rest.need} ready`
        + `${rest.ready.includes(mine) ? ', you among them.' : `. ${key}: ready up.`}`);
    } else if (!this.shut) {
      // The wave is in: the pod is gone, and nobody should be standing in a shop. Once: a browser that wants a click gets told.
      this.shut = true;
      this.phase.set(`Wave ${waves.wave} has started. The shop is shut.`);
      this.ctx.hud.callout?.(`WAVE ${waves.wave} · the shop is shut`);
      this.leave();
    }
  }

  private get shop() {
    return this.ctx.contracts.shop ?? null;
  }

  private turn(p: Page): void {
    if (p === this.page) return;
    this.page = p;
    this.ctx.audio.play?.('ui_hover');
    this.studio(true);
    this.refresh(0);
  }

  private refresh(keep: number): void {
    const shop = this.shop;
    if (!shop) return;
    for (const p of PAGES) this.tabs[p].classList.toggle('on', p === this.page);
    this.offers = this.page === 'weapons' ? [...shop.supplyOffers(), ...shop.weaponOffers()] : this.page === 'mods' ? shop.modOffers()
      : [...shop.implantOffers(), ...shop.chipOffers()];
    this.implantHead.style.display = this.page === 'implants' ? '' : 'none';
    if (this.page === 'implants') this.slots();
    const items: NavItem[] = this.offers.map(o => this.row(o));
    this.list.replaceChildren(...items.map(i => i.el));
    items.push(this.close);
    this.wallet.set(credits(shop.credits));
    const at = Math.min(keep, this.offers.length - 1);
    this.nav?.set(items, at);
    this.select(this.offers[at]!);
  }

  /** The three slots as boxes: what each holds, or what opening it costs, or the wave it waits for. */
  private slots(): void {
    const l = this.shop!.loadout;
    const fitted = [...l.fitted];
    const cleared = this.shop!.view().cleared;
    this.slotStrip.replaceChildren(...SLOT_WARES.map((w, i) => {
      const id = fitted[i];
      const open = i < l.slots;
      const wave = lockWave(ACTIVE.def.id, w.wave);
      const text = open ? (id ? implantName(id) : 'Empty') : wave > cleared ? `Wave ${wave}` : credits(w.price);
      const box = div('pc-slot', span('pc-slot-n', `Slot ${i + 1}`), span('pc-slot-v', text));
      box.classList.toggle('open', open);
      box.classList.toggle('worn', !!id);
      if (id) box.style.setProperty('--imp', implantColor(id));
      return box;
    }));
    const rack = this.shop!.chips;
    this.chipStrip.replaceChildren(...Array.from({ length: CHIP_SLOTS }, (_, i) => {
      const id = rack.fitted[i];
      const open = i < rack.slots;
      const text = open ? (id ? CHIPS[id].name : 'Empty') : 'For sale';
      const box = div('pc-slot', span('pc-slot-n', `Brain chip ${i + 1}`), span('pc-slot-v', text));
      box.classList.toggle('open', open);
      box.classList.toggle('worn', !!id);
      if (id) box.style.setProperty('--imp', CHIPS[id].color);
      return box;
    }));
  }

  /** A chip's row or the chip slot's, as an implant's. */
  private chipRow(o: ShopOffer): NavItem {
    const chip = o.act.kind === 'chip' ? o.act.id : null;
    const right = o.fitted ? 'Fitted' : o.locked ? `Wave ${o.ware.wave}`
      : o.replacesChip && o.why === null ? `Replaces ${CHIPS[o.replacesChip].name}`
        : o.owned ? (chip ? 'Fit' : 'Open') : credits(o.ware.price);
    const ico = span('pc-ico pc-cls', chip ? 'Brain chip' : 'Slot');
    if (chip) ico.style.color = CHIPS[chip].color;
    const label = chip ? `${CHIPS[chip].name} brain chip` : 'Brain chip slot 2';
    const el = div('pc-row', ico, span('pc-k', label), span('pc-v', o.locked ? markup(LOCK_ICON) : null, right));
    el.classList.toggle('locked', o.locked);
    el.classList.toggle('owned', o.owned && !o.fitted);
    el.classList.toggle('fitted', o.fitted);
    el.classList.toggle('poor', o.why?.startsWith('Need') === true);
    return { el, activate: () => this.buy(o), focused: () => this.select(o) };
  }

  /** A chip in focus: him as he is, and its card. */
  private selectChip(o: ShopOffer): void {
    const chip = o.act.kind === 'chip' ? o.act.id : null;
    this.body.show(this.shop!.loadout.fitted, null);
    const c = this.card;
    const line = (k: string, v: string) => div('pc-line', span('pc-stat-k', k), span('pc-line-v', v));
    c.name.set(chip ? `${CHIPS[chip].name} brain chip` : 'Brain chip slot 2');
    c.role.set(chip ? `Brain chip, key ${this.ctx.input.labelFor('sonar')}. Bought and fitted here, used whenever you like.`
      : `A second brain chip. Tap ${this.ctx.input.labelFor('sonar')} to use the one in hand, hold it to change.`);
    c.stats.replaceChildren(...(chip ? [line('Does', CHIPS[chip].does)] : []));
    c.lore.set(o.ware.lore);
    const verb = o.fitted ? 'Take out' : o.replacesChip ? `${o.owned ? 'Fit' : 'Buy'}, replacing ${CHIPS[o.replacesChip].name}`
      : o.owned ? 'Fit' : chip ? 'Buy and fit' : 'Buy';
    c.price.set(o.owned ? (issued(o.ware) ? 'Issued' : chip ? 'Bought' : 'Open') : credits(o.ware.price));
    c.state.set(o.why ?? `Enter: ${verb}`);
    c.buy.classList.toggle('locked', o.locked);
    c.buy.classList.toggle('ready', o.why === null);
    c.buy.classList.toggle('poor', o.why?.startsWith('Need') === true);
  }

  /** An implant's row or a slot's: its class in the icon's place, in the implant's colour. */
  private implantRow(o: ShopOffer): NavItem {
    const imp = o.act.kind === 'implant' ? o.act.id : null;
    const label = imp ? implantName(imp) : `Implant slot ${o.act.id}`;
    const right = o.fitted ? 'Fitted' : o.locked ? `Wave ${o.ware.wave}`
      : o.replaces && o.why === null ? `Replaces ${implantName(o.replaces)}`
        : o.owned ? (imp ? 'Fit' : 'Open') : credits(o.ware.price);
    const ico = span('pc-ico pc-cls', imp ? CLASS_NAMES[IMPLANTS[imp].class] : 'Slot');
    if (imp) ico.style.color = implantColor(imp);
    const el = div('pc-row', ico, span('pc-k', label), span('pc-v', o.locked ? markup(LOCK_ICON) : null, right));
    el.classList.toggle('locked', o.locked);
    el.classList.toggle('owned', o.owned && !o.fitted);
    el.classList.toggle('fitted', o.fitted);
    el.classList.toggle('poor', o.why?.startsWith('Need') === true);
    return { el, activate: () => this.buy(o), focused: () => this.select(o) };
  }

  /** A resupply row: its tag in the pickup's colour, and the price, or Full. */
  private supplyRow(id: SupplyId, o: ShopOffer): NavItem {
    const [tag, color] = SUPPLY_TAG[id];
    const ico = span('pc-ico pc-cls', tag);
    ico.style.color = color;
    const el = div('pc-row', ico, span('pc-k', SUPPLY_WARES[id].name), span('pc-v', o.why === 'Full' ? 'Full' : credits(o.ware.price)));
    el.classList.toggle('owned', o.why === 'Full');
    el.classList.toggle('poor', o.why?.startsWith('Need') === true);
    return { el, activate: () => this.buy(o), focused: () => this.select(o) };
  }

  /** A resupply in focus: the contractor, what it does, and where he stands now. */
  private selectSupply(id: SupplyId, o: ShopOffer): void {
    this.body.show(this.shop!.loadout.fitted, null);
    const p = this.ctx.player;
    const c = this.card;
    const line = (k: string, v: string) => div('pc-line', span('pc-stat-k', k), span('pc-line-v', v));
    const short = [...this.ctx.weapons.owned].filter(g => { const a = this.ctx.weapons.ammo(g); return a.reserve < a.maxReserve; }).length;
    const now = id === 'heal' ? `${Math.ceil(p.health)} of ${p.maxHealth} health` : id === 'armor' ? `${Math.ceil(p.armor)} armour`
      : short === 0 ? 'Every reserve full' : `${short} gun${short === 1 ? '' : 's'} short of a full reserve`;
    c.name.set(SUPPLY_WARES[id].name);
    c.role.set('Resupply. Bought as often as it is needed, between waves.');
    c.stats.replaceChildren(line('Does', SUPPLY_WARES[id].does), line('Now', now));
    c.lore.set(o.ware.lore);
    c.price.set(credits(o.ware.price));
    c.state.set(o.why ?? 'Enter: Buy');
    c.buy.classList.toggle('locked', false);
    c.buy.classList.toggle('ready', o.why === null);
    c.buy.classList.toggle('poor', o.why?.startsWith('Need') === true);
  }

  private row(o: ShopOffer): NavItem {
    if (o.act.kind === 'supply') return this.supplyRow(o.act.id, o);
    if (o.act.kind === 'implant' || o.act.kind === 'slot') return this.implantRow(o);
    if (o.act.kind === 'chip' || o.act.kind === 'chipSlot') return this.chipRow(o);
    const gun = o.act.kind === 'weapon' ? o.act.id : MODS[o.act.id].weapon;
    const label = o.act.kind === 'weapon' ? INFO[o.act.id].name : MODS[o.act.id].name;
    const right = o.fitted ? 'Fitted' : o.owned ? (o.act.kind === 'mod' ? 'Fit' : issued(o.ware) ? 'Issued' : 'Owned')
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

  /** An implant in focus: put on him in the studio, and its card. A slot: him as he is. */
  private selectImplant(o: ShopOffer): void {
    const imp = o.act.kind === 'implant' ? o.act.id : null;
    this.body.show(this.shop!.loadout.fitted, imp);
    const c = this.card;
    const line = (k: string, v: string) => div('pc-line', span('pc-stat-k', k), span('pc-line-v', v));
    if (imp) {
      const d = IMPLANTS[imp];
      c.name.set(implantName(imp));
      c.role.set(`${CLASS_NAMES[d.class]} implant, on the ${CLASS_REGION[d.class]}: ${d.part}. One of each class at a time.`);
      c.stats.replaceChildren(line('Trigger', d.trigger), line('Does', d.does), line('Rearms', '30 s after it ends'));
    } else {
      c.name.set(`Implant slot ${o.act.id}`);
      c.role.set('Holds one more implant, of a class you have not fitted.');
      c.stats.replaceChildren();
    }
    c.lore.set(o.ware.lore);
    const verb = o.fitted ? 'Take off' : o.replaces ? `${o.owned ? 'Fit' : 'Buy'}, replacing ${implantName(o.replaces)}` : o.owned ? 'Fit' : imp ? 'Buy and fit' : 'Buy';
    c.price.set(o.owned ? (issued(o.ware) ? 'Issued' : imp ? 'Bought' : 'Open') : credits(o.ware.price));
    c.state.set(o.why ?? `Enter: ${verb}`);
    c.buy.classList.toggle('locked', o.locked);
    c.buy.classList.toggle('ready', o.why === null);
    c.buy.classList.toggle('poor', o.why?.startsWith('Need') === true);
  }

  /** The row in focus: its gun on the turntable, and its card. */
  private select(o: ShopOffer): void {
    this.focusAct = o.act;
    this.focused = o;
    if (o.act.kind !== 'weapon' || o.act.id !== this.sellArmed) this.sellArmed = null;
    this.sellLine(o);
    this.studio(true);
    if (o.act.kind === 'supply') {
      this.selectSupply(o.act.id, o);
      return;
    }
    if (o.act.kind === 'implant' || o.act.kind === 'slot') {
      this.selectImplant(o);
      return;
    }
    if (o.act.kind === 'chip' || o.act.kind === 'chipSlot') {
      this.selectChip(o);
      return;
    }
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
    c.price.set(o.owned ? (issued(o.ware) ? 'Issued' : o.act.kind === 'mod' ? 'Bought' : 'Owned') : credits(o.ware.price));
    c.state.set(o.why ?? `Enter: ${verb}`);
    c.buy.classList.toggle('locked', o.locked);
    c.buy.classList.toggle('ready', o.why === null);
    c.buy.classList.toggle('poor', o.why?.startsWith('Need') === true);
  }

  /** The Sell button under a gun owned: what it pays, or why it cannot be sold. Hidden on any other row. */
  private sellLine(o: ShopOffer): void {
    const b = this.sellBtn;
    const show = o.act.kind === 'weapon' && o.owned;
    b.style.display = show ? '' : 'none';
    if (!show) return;
    const armed = this.sellArmed === o.act.id;
    const pay = credits(o.refund ?? 0);
    const held = (this.ctx.weapons as { mods?: ReadonlySet<ModId> }).mods;
    const mods = MOD_ORDER.filter(m => MODS[m].weapon === o.act.id && held?.has(m)).length;
    const with_ = mods ? ` with ${mods} mod${mods === 1 ? '' : 's'}` : '';
    b.textContent = o.sell ? `Cannot sell. ${o.sell}` : armed ? `Confirm: sell${with_} for ${pay}` : `X: Sell back${with_} for ${pay}`;
    b.disabled = !!o.sell;
    b.classList.toggle('armed', armed);
  }

  /** X, Delete or the button: the first press asks, the second sells the gun in focus back. */
  private sellFocused(): void {
    const o = this.focused;
    const shop = this.shop;
    if (!shop || !o || o.act.kind !== 'weapon' || !o.owned) return;
    const id = o.act.id;
    const name = INFO[id].name;
    if (o.sell) {
      this.note.set(o.sell);
      this.ctx.audio.play?.('ui_error');
      return;
    }
    const pay = credits(o.refund ?? 0);
    if (this.sellArmed !== id) {
      this.sellArmed = id;
      this.note.set(`Again to sell the ${name} for ${pay}.`);
      this.ctx.audio.play?.('ui_click');
      this.sellLine(o);
      return;
    }
    this.sellArmed = null;
    const why = shop.sell(id);
    this.note.set(why ?? `Sold: ${name}, +${pay}`);
    this.ctx.audio.play?.(why ? 'ui_error' : 'ui_confirm');
    const keep = this.offers.findIndex(x => x.act === this.focusAct);
    this.refresh(Math.max(0, keep));
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
    const act = o.act;
    const name = act.kind === 'supply' ? SUPPLY_WARES[act.id].name : act.kind === 'weapon' ? INFO[act.id].name : act.kind === 'mod' ? MODS[act.id].name
      : act.kind === 'implant' ? implantName(act.id) : act.kind === 'chip' ? `${CHIPS[act.id].name} brain chip`
        : act.kind === 'chipSlot' ? 'Brain chip slot 2' : `Implant slot ${act.id}`;
    if (why) {
      this.note.set(why);
      this.ctx.audio.play?.('ui_error');
    } else {
      const fitted = act.kind === 'mod' ? this.ctx.weapons.fitted?.has(act.id) : act.kind === 'chip' ? shop.chips.fitted.includes(act.id)
        : act.kind === 'implant' && shop.loadout.fitted.has(act.id);
      const bought = act.kind === 'supply' || act.kind === 'weapon' || act.kind === 'slot' || act.kind === 'chipSlot';
      this.note.set(bought ? `Bought: ${name}` : fitted ? `Fitted: ${name}` : `Taken off: ${name}`);
      this.ctx.audio.play?.('ui_confirm');
    }
    const keep = this.offers.findIndex(x => x.act === this.focusAct);
    this.refresh(Math.max(0, keep));
  }

  private leave(): void {
    this.studio(false);
    if (!this.hud.resume()) {
      this.studio(true);
      this.note.set('The browser wants a key or a click: press Enter on Back to the fight.');
    }
  }
}
