/**
 * Splash. Its job is the first user gesture, which audio needs before it can start. That is why the first game
 * had it, and the reason it survives here. After a contract switch the same click also takes the mouse and starts the
 * run, since the page load that changed the map cost the player their gesture.
 */
import { ACTIVE, takeDeploy } from '../../contracts/select';
import type { Ctx } from '../../core/contracts';
import { div, span } from '../dom';
import type { Hud } from '../Hud';
import type { Nav } from './nav';
import { wordmark } from './parts';
import type { Screen } from './Screens';

export class SplashScreen implements Screen {
  readonly el: HTMLElement;
  private go: HTMLElement;

  constructor(private readonly ctx: Ctx, private readonly hud: Hud) {
    this.go = span('sp-go', 'Click to start');
    this.el = div('scr scr-splash', wordmark(), span('sp-sub', 'OVERDRIVE'), this.go);
  }

  open(nav: Nav): void {
    const deploy = takeDeploy();
    if (deploy) this.go.textContent = `Click to deploy: ${ACTIVE.def.name}`;
    const enter = () => {
      this.ctx.audio.unlock?.();
      if (deploy) {
        this.hud.startRun();
        return;
      }
      this.ctx.audio.music?.('menu');
      this.hud.screens.show('menu');
    };
    nav.set([{ el: this.el, activate: enter }]);
    nav.back = null;
    nav.left = nav.right = null;
  }
}
