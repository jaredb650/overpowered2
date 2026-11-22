/** Screen stack: one visible at a time, hard cuts between them, and a return path for guide and settings. */
import type { Ctx } from '../../core/contracts';
import { adoptLoading } from '../boot';
import { div } from '../dom';
import type { Hud } from '../Hud';
import type { Regroup, Room } from '../../net';
import type { RoomNote } from '../../net/session';
import type { Settings } from '../settings';
import { Nav } from './nav';
import { GameOverScreen } from './gameover';
import { GuideScreen } from './guide';
import type { LoadingScreen } from './loading';
import { MainMenu } from './mainmenu';
import { MissionComplete } from './complete';
import { PauseScreen } from './pause';
import { RulesScreen } from './rules';
import { SettingsScreen } from './settingsScreen';
import { ShopScreen } from './shop';
import { ProcurementScreen } from './procurement';
import { LoadoutScreen } from './loadout';
import type { ShopId } from '../../contracts/defense/data';
import { SplashScreen } from './splash';
import { CoopScreen } from './coop';
import { FrameLoadoutScreen } from './frameLoadout';

/**
 * 'rules' is the Crucible's, reached only from the main menu, and its Back goes straight there. 'loadout' and 'shop' are
 * Outpost Defense's, over a paused run; 'procurement' is the Crucible's shop, the same way.
 */
export type ScreenName =
  | 'loading' | 'splash' | 'menu' | 'pause' | 'gameover' | 'complete' | 'guide' | 'settings' | 'rules' | 'loadout' | 'shop' | 'procurement' | 'coop'
  | 'frame' | 'none';

/** Screens opened over another that Back returns to: the guide, settings and the Frame's loadout. */
const ASIDE: readonly ScreenName[] = ['guide', 'settings', 'frame'];

export interface Screen {
  readonly el: HTMLElement;
  /** Sets up focus and fresh content each time the screen opens. */
  open(nav: Nav): void;
  update?(dt: number): void;
  /** Runs as another screen (or none) takes its place. */
  closed?(): void;
}

export class Screens {
  readonly el: HTMLElement;
  private screens: Record<Exclude<ScreenName, 'none'>, Screen>;
  private loadingScreen: LoadingScreen;
  private pauseScreen: PauseScreen;
  private shopScreen: ShopScreen;
  private nav: Nav;
  private current: ScreenName = 'none';
  private returnTo: ScreenName = 'menu';

  constructor(ctx: Ctx, hud: Hud, settings: Settings) {
    this.nav = new Nav(ctx);
    this.loadingScreen = adoptLoading();
    this.pauseScreen = new PauseScreen(hud, () => !!ctx.coop, () => !!ctx.coop?.hosting);
    this.shopScreen = new ShopScreen(ctx, hud);
    this.screens = {
      loading: this.loadingScreen,
      splash: new SplashScreen(ctx, hud),
      menu: new MainMenu(ctx, hud),
      pause: this.pauseScreen,
      gameover: new GameOverScreen(hud),
      complete: new MissionComplete(ctx, hud),
      guide: new GuideScreen(ctx, hud),
      settings: new SettingsScreen(ctx, hud, settings),
      rules: new RulesScreen(ctx, hud),
      loadout: new LoadoutScreen(ctx, hud),
      shop: this.shopScreen,
      procurement: new ProcurementScreen(ctx, hud),
      coop: new CoopScreen(ctx, hud),
      frame: new FrameLoadoutScreen(ctx, hud),
    };
    this.el = div('screens');
    for (const s of Object.values(this.screens)) {
      s.el.style.display = 'none';
      this.el.append(s.el);
    }
    addEventListener('keydown', e => {
      if (this.current === 'none' || this.current === 'loading' || e.repeat) return;
      // Typing in the lobby's fields must not drive the menu.
      if (e.target instanceof HTMLInputElement) return;
      if (this.nav.key(e)) e.preventDefault();
    });
  }

  get name(): ScreenName {
    return this.current;
  }

  show(name: ScreenName): void {
    if (ASIDE.includes(name)) {
      if (!ASIDE.includes(this.current)) this.returnTo = this.current === 'none' ? 'menu' : this.current;
    }
    if (this.current !== 'none') {
      this.screens[this.current].el.style.display = 'none';
      if (this.current !== name) this.screens[this.current].closed?.();
    }
    this.current = name;
    this.el.classList.toggle('live', name !== 'none');
    if (name === 'none') return;
    const screen = this.screens[name];
    screen.el.style.display = '';
    screen.open(this.nav);
  }

  playMenu(): void {
    (this.screens.menu as MainMenu).returnToPlay();
    this.show('menu');
  }

  /** Out of a co-op match: back on the lobby page of the same room when it is still open, else Multiplayer with why. */
  coopEnded(message: string, room: Room | null = null): void {
    this.show('coop');
    const screen = this.screens.coop as CoopScreen;
    if (room) screen.adopt(room.lobby, room.code, room.password, message, room.match);
    else screen.showMessage(message);
  }

  /** The host is gone for good: everyone who was in the room meets again in a new lobby on the same code. */
  coopRegroup(plan: Regroup): void {
    this.show('coop');
    (this.screens.coop as CoopScreen).regroup(plan);
  }

  /** This page was reloaded while in a lobby, between matches: it walks back into the same room (net/session.ts `roomToRejoin`). */
  coopRejoin(note: RoomNote): void {
    this.show('coop');
    (this.screens.coop as CoopScreen).rejoin(note);
  }

  /** Outpost Defense's buy menu for one shop. */
  shop(id: ShopId): void {
    this.shopScreen.shop = id;
    this.show('shop');
  }

  /** Back out of guide, settings or the Frame's loadout to whichever screen opened it. */
  back(): void {
    this.show(this.returnTo);
  }

  loading(fraction: number, label: string): void {
    this.loadingScreen.set(fraction, label);
  }

  pauseHint(text: string): void {
    this.pauseScreen.hint(text);
  }

  holdInput(seconds: number): void {
    this.nav.hold(seconds);
  }

  update(dt: number): void {
    if (this.current === 'none') return;
    this.nav.update(dt);
    this.screens[this.current].update?.(dt);
  }
}
