/**
 * Pause. Esc resumes. After the player's own Esc the browser hands the mouse back only on a click or a key (Esc is not one), so
 * then the menu goes and a one-line prompt waits for the next click or key (Hud.ts `awaitTouch`); Esc there opens this again.
 */
import { MISSION_ID } from '../../campaign/select';
import { Label, Shown, div, span } from '../dom';
import type { Hud } from '../Hud';
import type { Nav } from './nav';
import { menuButton } from './parts';
import { statRows } from './stats';
import type { Screen } from './Screens';

/** How long "End match" stays armed after its first press. */
const CONFIRM_MS = 4000;

export class PauseScreen implements Screen {
  readonly el: HTMLElement;
  private stats: HTMLElement;
  private hintLabel: Label;
  private hintShown: Shown;
  private items;
  private restart;
  private title = span('pz-title', 'Paused');

  /** Co-op host: "End match" takes everyone out, so it asks first: the second press within `CONFIRM_MS` does it. */
  private armedAt = -Infinity;
  private checkpoint: ReturnType<typeof menuButton> | null = null;

  private quit = menuButton('Quit to menu', () => this.leave());

  constructor(private readonly hud: Hud, private readonly isCoop: () => boolean = () => false, private readonly isCoopHost: () => boolean = () => false) {
    this.restart = menuButton(MISSION_ID ? 'Restart mission' : 'Restart run', () => this.hud.startRun());
    this.items = [
      menuButton('Resume', () => this.hud.resume()),
      menuButton('Guide', () => this.hud.screens.show('guide')),
      menuButton('Settings', () => this.hud.screens.show('settings')),
      menuButton('Frame loadout', () => this.hud.screens.show('frame')),
      ...(MISSION_ID ? [this.checkpoint = menuButton('Restart from checkpoint', () => this.hud.restartCheckpoint())] : []),
      this.restart,
      this.quit,
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
    // A guest has no checkpoint to restart: the mission is the host's. The host's sends the whole team back.
    const guest = coop && !this.isCoopHost();
    if (this.checkpoint) {
      this.checkpoint.el.style.display = guest ? 'none' : '';
      this.checkpoint.el.querySelector('.mi-t')!.textContent = coop ? 'Checkpoint (whole team)' : 'Restart from checkpoint';
    }
    this.armedAt = -Infinity;
    this.label();
    nav.set(this.items.filter(i => (!coop || i !== this.restart) && !(guest && i === this.checkpoint)));
    nav.back = () => this.hud.resume();
    nav.left = nav.right = null;
    this.hintShown.set(false);
    this.stats.replaceChildren(...statRows(this.hud.report));
  }

  /** Co-op leaves for the lobby page, never the main menu. */
  private label(armed = false): void {
    const coop = this.isCoop();
    this.quit.el.querySelector('.mi-t')!.textContent = !coop ? 'Quit to menu' : !this.isCoopHost() ? 'Leave match (to lobby)'
      : armed ? 'End it for everyone? Press again' : 'End match (all to lobby)';
  }

  private leave(): void {
    if (this.isCoop() && this.isCoopHost() && performance.now() - this.armedAt > CONFIRM_MS) {
      this.armedAt = performance.now();
      this.label(true);
      this.hint('That ends the match for the whole team. Press End match again to confirm.');
      return;
    }
    this.hud.quitToMenu();
  }

  update(): void {
    // The question lapses on its own.
    if (this.armedAt > 0 && performance.now() - this.armedAt > CONFIRM_MS) {
      this.armedAt = -Infinity;
      this.label();
      this.hintShown.set(false);
    }
  }

  hint(text: string): void {
    this.hintLabel.set(text);
    this.hintShown.set(true);
  }
}
