/**
 * Mission complete: the headline, the score, and the Council's reply, which is an invoice. Every figure on it is the player's own, and
 * the deductions are the jokes the mission has been setting up since the briefing.
 */
import { CONTRACTS, COUNCIL_OFFICE } from '../../contracts/data';
import { contractSearch } from '../../contracts/select';
import type { Ctx } from '../../core/contracts';
import { Label, Shown, div, h, span } from '../dom';
import type { Hud } from '../Hud';
import { Odometer } from '../hud/tally';
import { sourceName } from '../data';
import type { Nav, NavItem } from './nav';
import { menuButton } from './parts';
import type { Screen } from './Screens';
import { clock } from './stats';

const ENDLESS = CONTRACTS.find(c => c.locked)!;
const n = (v: number): string => Math.round(v).toLocaleString('en-US');

export class MissionComplete implements Screen {
  readonly el: HTMLElement;
  private readonly odo = new Odometer('odo-big');
  private readonly subject: Label;
  private readonly record: Shown;
  private readonly high: Label;
  private readonly bill = div('nt-terms mc-bill');
  private readonly stamp: Shown;
  private readonly endless: NavItem;
  private readonly items: NavItem[];

  constructor(private readonly ctx: Ctx, private readonly hud: Hud) {
    this.endless = menuButton(ENDLESS.name, () => {
      location.search = contractSearch(ENDLESS.id, location.search);
    });
    this.items = [
      menuButton('Menu', () => this.hud.quitToMenu()),
      menuButton('Play again', () => this.hud.startRun()),
    ];
    const subject = span('go-by');
    const record = span('go-record', 'New high score');
    const high = span('go-high');
    const stamp = div('mc-stamp', span('', `${ENDLESS.name} unlocked`), span('mc-stamp-s', 'The Kill House is open. He will be waiting.'));
    this.el = div('scr scr-gameover scr-complete',
      div('go-left',
        span('go-title mc-title', 'Mission complete'),
        subject,
        div('go-score', this.odo.el),
        div('go-marks', record, high),
        div('mm-list', this.endless.el, ...this.items.map(i => i.el)),
      ),
      div('mc-right',
        div('nt',
          span('nt-office', COUNCIL_OFFICE),
          div('nt-head', span('nt-title', 'Notice of Completion'), span('nt-ref', 'Form 7742-C')),
          div('nt-subject', 'The Outpost has been removed from the register.'),
          this.bill,
          h('p', 'nt-p', 'Your fee has been calculated. Balance: see reverse.'),
          div('nt-foot', 'Please retain this notice. It will not be issued again.'),
        ),
        stamp,
      ),
    );
    this.subject = new Label(subject);
    this.record = new Shown(record, 'inline-block');
    this.high = new Label(high);
    this.stamp = new Shown(stamp, 'block');
  }

  private rows(pairs: readonly (readonly [string, string])[]): HTMLElement[] {
    return pairs.flatMap(([key, value]) => [span('nt-k', key), span('nt-v', value)]);
  }

  open(nav: Nav): void {
    const { hud } = this;
    const r = hud.report;
    const result = this.ctx.campaign.result;
    const unlocked = result?.unlocked === true;
    const top = r.topWeapons(1)[0];
    this.subject.set(result ? `${result.title}, ${clock(result.seconds)}` : '');
    this.record.set(r.isHighScore);
    this.high.set(r.isHighScore ? `Old best ${n(r.highAtStart)}` : `High score ${n(r.highAtStart)}`);
    this.bill.replaceChildren(...this.rows([
      ['Personnel', `${n(r.kills)} removed`],
      ['Vehicles', `${n(result?.vehicles ?? 0)} written off`],
      ['Headshots', n(r.headshots)],
      ['Limbs', `${n(r.limbs)} left at the owner's risk`],
      ['Accuracy', `${Math.round(r.accuracy * 100)}%`],
      ['Best combo', n(r.bestCombo)],
      ['Preferred tool', top ? sourceName(top[0]) : 'None on record'],
      ['Time billed', result ? clock(result.seconds) : '0:00'],
      ['Replacements', `${n(result?.deaths ?? 0)}, at ten percent each`],
      ['Deductions', 'One helicopter. One gate. One previous contractor.'],
    ]));
    this.stamp.set(unlocked);
    this.endless.el.style.display = unlocked ? '' : 'none';
    nav.set(unlocked ? [this.endless, ...this.items] : this.items);
    nav.back = () => hud.quitToMenu();
    nav.left = nav.right = null;
    this.odo.snap(0);
    this.odo.set(r.score);
  }

  update(dt: number): void {
    this.odo.update(dt);
  }
}
