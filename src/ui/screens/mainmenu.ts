/**
 * Main menu, over the live flythrough, with the contract select and the Council's notice for each contract. A contract that is still
 * shut can be read and not played. Someone new starts on the Campaign whatever the page behind it is running.
 *
 * The Crucible's notice carries its rules: a button under it opens them, from any page, because they live in storage and Play
 * takes them to the Crucible's own page. Never from pause: a run keeps the rules it started with.
 */
import { storedRulesCustom } from '../../contracts/crucible';
import { CONTRACTS, COUNCIL_OFFICE, NOTICE_FOOTER, NOTICE_TITLE, type ContractDef } from '../../contracts/data';
import { readHighScore } from '../../contracts/scores';
import { ACTIVE, NAMED, contractSearch } from '../../contracts/select';
import { campaignBeaten, isShut } from '../../contracts/unlocks';
import type { Ctx } from '../../core/contracts';
import { div, h, span } from '../dom';
import type { Hud } from '../Hud';
import type { Nav, NavItem } from './nav';
import { menuButton, wordmark } from './parts';
import type { Screen } from './Screens';

const isCrucible = (contract: ContractDef): boolean => contract.id === 'crucible';

export class MainMenu implements Screen {
  readonly el: HTMLElement;
  private items: NavItem[];
  private tabs: NavItem[];
  private notice: HTMLElement;
  private rules: NavItem;
  private nav: Nav | null = null;
  /** Back from the rules screen, so focus lands where it left. */
  private fromRules = false;
  private selected = NAMED || campaignBeaten() ? CONTRACTS.indexOf(ACTIVE.def) : 0;

  constructor(private readonly ctx: Ctx, private readonly hud: Hud) {
    this.items = [
      menuButton('Play', () => this.play()),
      menuButton('Guide', () => this.hud.screens.show('guide')),
      menuButton('Settings', () => this.hud.screens.show('settings')),
    ];
    this.rules = menuButton('Crucible rules', () => {
      this.fromRules = true;
      this.hud.screens.show('rules');
    });
    this.rules.el.classList.add('mi-small');
    this.tabs = CONTRACTS.map((contract, i) => {
      const el = h('button', 'mm-tab', contract.name);
      el.classList.toggle('lock', isShut(contract));
      el.type = 'button';
      el.tabIndex = -1;
      return { el, focused: () => this.select(i), activate: () => this.select(i) };
    });
    this.notice = div('nt');
    this.el = div('scr scr-menu',
      div('mm-list', ...this.items.map(i => i.el)),
      div('mm-brief', div('mm-tabs', ...this.tabs.map(t => t.el)), this.notice, this.rules.el),
      span('mm-sub', 'OVERDRIVE'),
      wordmark(),
    );
  }

  /** The record of the contract on screen. The one in play may be ahead of what storage holds. */
  private highScore(contract: ContractDef): number {
    const live = this.ctx.progression.highScore;
    return contract === ACTIVE.def && typeof live === 'number' ? live : readHighScore(contract);
  }

  private paint(contract: ContractDef): void {
    const { briefing } = contract;
    const high = this.highScore(contract);
    this.notice.replaceChildren(
      span('nt-office', COUNCIL_OFFICE),
      div('nt-head', span('nt-title', NOTICE_TITLE), span('nt-ref', briefing.ref)),
      div('nt-subject', briefing.subject),
      ...briefing.body.map(text => h('p', 'nt-p', text)),
      div('nt-terms', ...briefing.terms.flatMap(([key, value]) => [span('nt-k', key), span('nt-v', value)])),
      div('nt-foot', NOTICE_FOOTER),
    );
    if (high > 0) this.notice.append(div('nt-high', span('nt-high-k', 'High score'), span('nt-high-v', high.toLocaleString('en-US'))));
    if (isCrucible(contract) && storedRulesCustom()) this.notice.append(div('nt-rules', 'Custom rules are on. Runs on them are unranked and set no record.'));
    if (isShut(contract)) this.notice.append(div('nt-lock', 'Locked. Finish the Campaign to open this account.'));
    else if (contract !== ACTIVE.def) this.notice.append(div('nt-move', 'Play reloads the page to reach this site.'));
    this.items[0]!.el.classList.toggle('off', isShut(contract));
  }

  private select(i: number): void {
    this.selected = i;
    this.tabs.forEach((t, k) => t.el.classList.toggle('on', k === i));
    this.paint(CONTRACTS[i]!);
    this.rules.el.style.display = isCrucible(CONTRACTS[i]!) ? '' : 'none';
    this.syncNav();
  }

  /**
   * Play, Guide, Settings, the tabs, and the rules button while the Crucible's notice is up. The button comes straight after the
   * Crucible's tab, so Down from that tab reaches it: focusing the next tab would select that contract and hide the button.
   */
  private navItems(): NavItem[] {
    const list = [...this.items, ...this.tabs];
    const at = CONTRACTS.findIndex(isCrucible);
    if (at >= 0 && at === this.selected) list.splice(this.items.length + at + 1, 0, this.rules);
    return list;
  }

  /** The rules button comes and goes with the Crucible's tab. Focus stays on what had it, or moves to the tab now selected. */
  private syncNav(): void {
    const nav = this.nav;
    if (!nav || this.hud.screens.name !== 'menu') return;
    const list = this.navItems();
    if (list.length === nav.items.length && list.every((item, k) => item === nav.items[k])) return;
    const kept = list.indexOf(nav.items[nav.index]!);
    nav.set(list, kept >= 0 ? kept : list.indexOf(this.tabs[this.selected]!));
  }

  private cycle(step: -1 | 1): void {
    const n = CONTRACTS.length;
    this.ctx.audio.play?.('ui_toggle');
    this.select((this.selected + step + n) % n);
  }

  /** A contract's map cannot be built under a running world, so another contract means another page load. */
  private play(): void {
    const contract = CONTRACTS[this.selected]!;
    if (isShut(contract)) this.ctx.audio.play?.('ui_error');
    else if (contract === ACTIVE.def) this.hud.startRun();
    else location.search = contractSearch(contract.id, location.search);
  }

  open(nav: Nav): void {
    for (let i = 0; i < CONTRACTS.length; i++) this.tabs[i]!.el.classList.toggle('lock', isShut(CONTRACTS[i]!));
    this.nav = nav;
    const list = this.navItems();
    nav.set(list, this.fromRules ? Math.max(0, list.indexOf(this.rules)) : 0);
    this.fromRules = false;
    nav.back = null;
    nav.left = () => this.cycle(-1);
    nav.right = () => this.cycle(1);
    this.select(this.selected);
  }
}
