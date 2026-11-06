/** Pieces shared by the screens. */
import { div, h, span } from '../dom';
import type { NavItem } from './nav';

export function wordmark(): HTMLElement {
  return div('wm', span('wm-t', 'OVERPOWERED'), span('wm-2', '2'));
}

export function menuButton(label: string, activate: () => void): NavItem {
  const el = h('button', 'mi', span('mi-t', label));
  el.type = 'button';
  el.tabIndex = -1;
  return { el, activate };
}
