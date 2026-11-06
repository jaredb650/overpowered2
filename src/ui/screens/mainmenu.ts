/** Main menu, over the live flythrough. */
import type { Ctx } from '../../core/contracts';
import { Label, Shown, div, span } from '../dom';
import type { Hud } from '../Hud';
import type { Nav } from './nav';
import { menuButton, wordmark } from './parts';
import type { Screen } from './Screens';

export class MainMenu implements Screen {
  readonly el: HTMLElement;
  private high: Label;
  private highShown: Shown;
  private items;

  constructor(private readonly ctx: Ctx, private readonly hud: Hud) {
    this.items = [
      menuButton('Play', () => this.hud.startRun()),
      menuButton('Guide', () => this.hud.screens.show('guide')),
      menuButton('Settings', () => this.hud.screens.show('settings')),
    ];
    const high = span('mm-high-v');
    const highRow = div('mm-high', span('mm-high-k', 'high score'), high);
    this.el = div('scr scr-menu',
      div('mm-list', ...this.items.map(i => i.el)),
      highRow,
      span('mm-sub', 'OVERDRIVE'),
      wordmark(),
    );
    this.high = new Label(high);
    this.highShown = new Shown(highRow, 'flex');
  }

  open(nav: Nav): void {
    nav.set(this.items);
    nav.back = null;
    nav.left = nav.right = null;
    const score = this.ctx.progression.highScore;
    const has = typeof score === 'number' && score > 0;
    this.highShown.set(has);
    if (has) this.high.set(score.toLocaleString('en-US'));
  }
}
