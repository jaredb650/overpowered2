/**
 * The loading screen on its own, so it can show before anything heavy has been fetched. core/Game.ts imports this first
 * and keeps the rest of the game behind dynamic imports, which is what stops a 15 second boot opening on a black page.
 */
import '@fontsource/anton/latin-400.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './css/base.css';
import './css/boot.css';
import { div } from './dom';
import { LoadingScreen } from './screens/loading';

export const loadingScreen = new LoadingScreen();
const host = div('screens live', loadingScreen.el);

export function showLoading(): void {
  const root = document.getElementById('ui') ?? document.body;
  root.classList.add('op');
  root.append(host);
}

/** Screens takes the element over once the HUD exists, so the bar never restarts or blinks. */
export function adoptLoading(): LoadingScreen {
  host.remove();
  return loadingScreen;
}
