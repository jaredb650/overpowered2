/** HUD and menus. `createHud` is found by convention from core/Game.ts. */
import '@fontsource/anton/latin-400.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './css/base.css';
import './css/hud.css';
import './css/perks.css';
import './css/overlays.css';
import './css/screens.css';
import type { Ctx } from '../core/contracts';
import { Hud } from './Hud';

export { Hud } from './Hud';

export function createHud(ctx: Ctx): Hud {
  return new Hud(ctx);
}
