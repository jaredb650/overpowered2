/** Pause. Esc tries to resume, but only a click or Enter can take the mouse back, so the hint says so when needed. */
import { MISSION_ID } from '../../campaign/select';
import { Label, Shown, div, span } from '../dom';
import type { Hud } from '../Hud';
import type { Nav } from './nav';
import { menuButton } from './parts';
import { statRows } from './stats';
import type { Screen } from './Screens';

export class PauseScreen implements Screen {
  readonly el: HTMLElement;
  private stats: HTMLElement;
  private hintLabel: Label;
  private hintShown: Shown;
  private items;
  private restart;
  private title = span('pz-title', 'Paused');

  constructor(private readonly hud: Hud, private readonly isCoop: () => boolean = () => false) {
    this.restart = menuButton(MISSION_ID ? 'Restart mission' : 'Restart run', () => this.hud.startRun());
    this.items = [
      menuButton('Resume', () => this.hud.resume()),
      menuButton('Guide', () => this.hud.screens.show('guide')),
      menuButton('Settings', () => this.hud.screens.show('settings')),
      ...(MISSION_ID ? [menuButton('Restart from checkpoint', () => this.hud.restartCheckpoint())] : []),
      this.restart,
      menuButton('Quit to menu', () => this.hud.quitToMenu()),
    ];
    const hint = span('pz-hint');
    this.stats = div('stats');
    this.el = div('scr scr-pause',
      div('pz-left',
        this.title,
        div('mm-list', ...this.items.map(i => i.el)),
        hint,
      ),
      div('pz-right', this.stats),
    );
    this.hintLabel = new Label(hint);
    this.hintShown = new Shown(hint, 'block');
    this.hintShown.set(false);
  }

  open(nav: Nav): void {
    const coop = this.isCoop();
    this.title.textContent = coop ? 'Co-op menu · world live' : 'Paused';
    this.restart.el.style.display = coop ? 'none' : '';
    nav.set(this.items.filter(i => !coop || i !== this.restart));
    nav.back = () => this.hud.resume();
    nav.left = nav.right = null;
    this.hintShown.set(false);
    this.stats.replaceChildren(...statRows(this.hud.report));
  }

  hint(text: string): void {
    this.hintLabel.set(text);
    this.hintShown.set(true);
  }
}
