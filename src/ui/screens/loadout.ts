/**
 * Outpost Defense's loadout, before the first wave (contracts/defense): a budget, one primary and one secondary, no
 * explosives. What is left of the budget becomes credits. The run waits under it until Deploy.
 */
import type { Ctx } from '../../core/contracts';
import { DEFAULT_LOADOUT, ECONOMY, WEAPON_PRICES } from '../../contracts/defense/data';
import { checkLoadout, loadoutRefusal } from '../../contracts/defense/economy';
import type { WeaponId } from '../../core/gameplay';
import { WEAPON_ORDER } from '../../weapons/data';
import { WEAPONS } from '../data';
import { Label, div, span } from '../dom';
import type { Hud } from '../Hud';
import type { Nav, NavItem } from './nav';
import { menuButton } from './parts';
import type { Screen } from './Screens';

type Slot = 'primary' | 'secondary';
const credits = (n: number): string => n.toLocaleString('en-US');

interface Pick extends NavItem {
  id: WeaponId;
  slot: Slot | null;
}

export class LoadoutScreen implements Screen {
  readonly el: HTMLElement;
  private chosen: Record<Slot, WeaponId | null> = { primary: DEFAULT_LOADOUT[0], secondary: DEFAULT_LOADOUT[1] };
  private picks: Pick[] = [];
  private items: NavItem[];
  private cost: Label;
  private left: Label;
  private note: Label;
  private deployItem: NavItem;

  constructor(private readonly ctx: Ctx, private readonly hud: Hud) {
    const columns: Record<Slot | 'none', HTMLElement[]> = { primary: [], secondary: [], none: [] };
    for (const id of WEAPON_ORDER) {
      const p = WEAPON_PRICES[id];
      if (!p) continue;
      const slot = p.explosive ? null : p.loadout ?? null;
      const el = div('row sp-row', span('row-k', WEAPONS[id].name), span('sp-detail', slot ? WEAPONS[id].role : loadoutRefusal(id, 'primary') ?? ''),
        span('row-v', credits(p.price)));
      el.classList.toggle('off', slot === null);
      const pick: Pick = { el, id, slot, activate: () => this.choose(pick) };
      this.picks.push(pick);
      columns[slot ?? 'none'].push(el);
    }
    const cost = span('rl-state-v');
    const left = span('rl-state-k');
    const note = span('set-note');
    this.deployItem = menuButton('Deploy', () => this.deploy());
    const quit = menuButton('Quit to menu', () => this.hud.quitToMenu());
    quit.el.classList.add('mi-small');
    this.items = [...this.picks.filter(p => p.slot === 'primary'), ...this.picks.filter(p => p.slot === 'secondary'), this.deployItem, quit,
      ...this.picks.filter(p => p.slot === null)];
    this.el = div('scr scr-sheet scr-shop scr-loadout',
      div('sh-side',
        span('sh-title', 'Loadout'),
        span('rl-sub', 'Outpost Defense'),
        span('rl-hint', `One primary and one secondary, from a budget of ${credits(ECONOMY.budget)}. No explosives. What is left becomes credits for the shops. A Shiv comes free.`),
        div('rl-state sp-wallet', span('rl-plan-k', 'Left as credits'), left, cost),
        div('fill'),
        note,
        this.deployItem.el,
        quit.el,
      ),
      div('sh-body', div('gd-panel gd-cols',
        div('set-list rl-col', span('gd-h', 'Primary'), ...columns.primary),
        div('set-list rl-col', span('gd-h', 'Secondary'), ...columns.secondary,
          span('gd-h', 'Armoury only'), span('rl-col-note', 'Explosives are bought in a break.'), ...columns.none),
      )),
    );
    this.cost = new Label(cost);
    this.left = new Label(left);
    this.note = new Label(note);
  }

  private choose(pick: Pick): void {
    if (!pick.slot) {
      this.note.set('No explosives in the loadout. The Armoury sells them in a break.');
      this.ctx.audio.play?.('ui_error');
      return;
    }
    this.chosen[pick.slot] = pick.id;
    this.note.set('');
    this.refresh();
  }

  private refresh(): void {
    const { primary, secondary } = this.chosen;
    const check = checkLoadout(primary, secondary);
    for (const p of this.picks) p.el.classList.toggle('on', p.slot !== null && this.chosen[p.slot] === p.id);
    this.left.set(credits(check.left));
    this.cost.set(`Spent ${credits(check.cost)} of ${credits(ECONOMY.budget)}`);
    this.deployItem.el.classList.toggle('off', check.why !== null);
    if (check.why) this.note.set(check.why);
  }

  private deploy(): void {
    const defense = this.ctx.contracts.defense;
    if (!defense) return;
    const why = defense.deploy(this.chosen.primary, this.chosen.secondary);
    if (why) {
      this.note.set(why);
      this.ctx.audio.play?.('ui_error');
      return;
    }
    this.hud.resume();
  }

  open(nav: Nav): void {
    this.note.set('');
    this.refresh();
    nav.set(this.items, this.items.indexOf(this.deployItem));
    nav.back = null;
    nav.left = nav.right = null;
  }
}
