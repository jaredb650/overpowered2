/** Deployed public builds (GitHub Pages / OP2_DEMO_BUILD=1) wear the DEMO BUILD menu sticker and top HUD tag. */
import { div, span } from './dom';

declare const __DEMO__: boolean | undefined;

function detectDemo(): boolean {
  if (typeof __DEMO__ === 'boolean' && __DEMO__) return true;
  if (typeof location !== 'undefined') {
    const params = new URLSearchParams(location.search);
    if (params.get('demo') === '1') return true;
    const host = location.hostname;
    if (host === 'overpowered2.com' || host === 'www.overpowered2.com' || host.endsWith('.github.io')) return true;
  }
  return false;
}

export const IS_DEMO: boolean = detectDemo();

/** Slapped-on industrial sticker shown across every menu screen on deployed demo builds. */
export function makeDemoSticker(): HTMLElement | null {
  if (!IS_DEMO) return null;
  const sticker = div('demo-sticker', span('demo-sticker-text', 'DEMO BUILD'));
  sticker.setAttribute('aria-hidden', 'true');
  return sticker;
}
