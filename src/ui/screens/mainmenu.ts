/**
 * Main menu, over the live flythrough, with the contract select and the Council's notice for each contract. A contract that is still
 * shut can be read and not played. Someone new starts on the Campaign whatever the page behind it is running.
 */
import { CONTRACTS, COUNCIL_OFFICE, NOTICE_FOOTER, NOTICE_TITLE, type ContractDef } from '../../contracts/data';
import { readHighScore } from '../../contracts/scores';
import { ACTIVE, NAMED, contractSearch } from '../../contracts/select';
import { campaignBeaten, isLocked } from '../../contracts/unlocks';
import type { Ctx } from '../../core/contracts';
import { div, h, span } from '../dom';
import type { Hud } from '../Hud';
import type { Nav, NavItem } from './nav';
import { menuButton, wordmark } from './parts';
import type { Screen } from './Screens';

export class MainMenu implements Screen {
  readonly el: HTMLElement;
  private items: NavItem[];
  private tabs: NavItem[];
  private notice: HTMLElement;
  private selected = NAMED || campaignBeaten() ? CONTRACTS.indexOf(ACTIVE.def) : 0;

  constructor(private readonly ctx: Ctx, private readonly hud: Hud) {
    this.items = [
      menuButton('Play', () => this.play()),
      menuButton('Guide', () => this.hud.screens.show('guide')),
      menuButton('Settings', () => this.hud.screens.show('settings')),
    ];
    this.tabs = CONTRACTS.map((contract, i) => {
      const el = h('button', 'mm-tab', contract.name);
      el.classList.toggle('lock', isLocked(contract));
      el.type = 'button';
      el.tabIndex = -1;
      return { el, focused: () => this.select(i), activate: () => this.select(i) };
    });
    this.notice = div('nt');
    this.el = div('scr scr-menu',
      div('mm-list', ...this.items.map(i => i.el)),
      div('mm-brief', div('mm-tabs', ...this.tabs.map(t => t.el)), this.notice),
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
    if (isLocked(contract)) this.notice.append(div('nt-lock', 'Locked. Finish the Campaign to open this account.'));
    else if (contract !== ACTIVE.def) this.notice.append(div('nt-move', 'Play reloads the page to reach this site.'));
    this.items[0]!.el.classList.toggle('off', isLocked(contract));
  }

  private select(i: number): void {
    this.selected = i;
    this.tabs.forEach((t, k) => t.el.classList.toggle('on', k === i));
    this.paint(CONTRACTS[i]!);
  }

  private cycle(step: -1 | 1): void {
    const n = CONTRACTS.length;
    this.ctx.audio.play?.('ui_toggle');
    this.select((this.selected + step + n) % n);
  }

  /** A contract's map cannot be built under a running world, so another contract means another page load. */
  private play(): void {
    const contract = CONTRACTS[this.selected]!;
    if (isLocked(contract)) this.ctx.audio.play?.('ui_error');
    else if (contract === ACTIVE.def) this.hud.startRun();
    else location.search = contractSearch(contract.id, location.search);
  }

  open(nav: Nav): void {
    for (let i = 0; i < CONTRACTS.length; i++) this.tabs[i]!.el.classList.toggle('lock', isLocked(CONTRACTS[i]!));
    nav.set([...this.items, ...this.tabs]);
    nav.back = null;
    nav.left = () => this.cycle(-1);
    nav.right = () => this.cycle(1);
    this.select(this.selected);
  }
}
