/**
 * Splash. Its job is the first user gesture, which audio needs before it can start. That is why the first game
 * had it, and the reason it survives here.
 */
import type { Ctx } from '../../core/contracts';
import { div, span } from '../dom';
import type { Hud } from '../Hud';
import type { Nav } from './nav';
import { wordmark } from './parts';
import type { Screen } from './Screens';

export class SplashScreen implements Screen {
  readonly el: HTMLElement;

  constructor(private readonly ctx: Ctx, private readonly hud: Hud) {
    this.el = div('scr scr-splash', wordmark(), span('sp-sub', 'OVERDRIVE'), span('sp-go', 'Click to start'));
  }

  open(nav: Nav): void {
    const enter = () => {
      this.ctx.audio.unlock?.();
      this.ctx.audio.music?.('menu');
      this.hud.screens.show('menu');
    };
    nav.set([{ el: this.el, activate: enter }]);
    nav.back = null;
    nav.left = nav.right = null;
  }
}
