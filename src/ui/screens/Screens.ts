/** Screen stack: one visible at a time, hard cuts between them, and a return path for guide and settings. */
import type { Ctx } from '../../core/contracts';
import { div } from '../dom';
import type { Hud } from '../Hud';
import type { Settings } from '../settings';
import { Nav } from './nav';
import { GameOverScreen } from './gameover';
import { GuideScreen } from './guide';
import { LoadingScreen } from './loading';
import { MainMenu } from './mainmenu';
import { PauseScreen } from './pause';
import { SettingsScreen } from './settingsScreen';
import { SplashScreen } from './splash';

export type ScreenName = 'loading' | 'splash' | 'menu' | 'pause' | 'gameover' | 'guide' | 'settings' | 'none';

export interface Screen {
  readonly el: HTMLElement;
  /** Sets up focus and fresh content each time the screen opens. */
  open(nav: Nav): void;
  update?(dt: number): void;
}

export class Screens {
  readonly el: HTMLElement;
  private screens: Record<Exclude<ScreenName, 'none'>, Screen>;
  private loadingScreen: LoadingScreen;
  private pauseScreen: PauseScreen;
  private nav: Nav;
  private current: ScreenName = 'none';
  private returnTo: ScreenName = 'menu';

  constructor(ctx: Ctx, hud: Hud, settings: Settings) {
    this.nav = new Nav(ctx);
    this.loadingScreen = new LoadingScreen();
    this.pauseScreen = new PauseScreen(hud);
    this.screens = {
      loading: this.loadingScreen,
      splash: new SplashScreen(ctx, hud),
      menu: new MainMenu(ctx, hud),
      pause: this.pauseScreen,
      gameover: new GameOverScreen(hud),
      guide: new GuideScreen(ctx, hud),
      settings: new SettingsScreen(ctx, hud, settings),
    };
    this.el = div('screens');
    for (const s of Object.values(this.screens)) {
      s.el.style.display = 'none';
      this.el.append(s.el);
    }
    addEventListener('keydown', e => {
      if (this.current === 'none' || this.current === 'loading' || e.repeat) return;
      if (this.nav.key(e)) e.preventDefault();
    });
  }

  get name(): ScreenName {
    return this.current;
  }

  show(name: ScreenName): void {
    if (name === 'guide' || name === 'settings') {
      if (this.current !== 'guide' && this.current !== 'settings') this.returnTo = this.current === 'none' ? 'menu' : this.current;
    }
    if (this.current !== 'none') this.screens[this.current].el.style.display = 'none';
    this.current = name;
    this.el.classList.toggle('live', name !== 'none');
    if (name === 'none') return;
    const screen = this.screens[name];
    screen.el.style.display = '';
    screen.open(this.nav);
  }

  /** Back out of guide or settings to whichever screen opened it. */
  back(): void {
    this.show(this.returnTo);
  }

  loading(fraction: number, label: string): void {
    this.loadingScreen.set(fraction, label);
  }

  pauseHint(text: string): void {
    this.pauseScreen.hint(text);
  }

  update(dt: number): void {
    if (this.current === 'none') return;
    this.screens[this.current].update?.(dt);
  }
}
