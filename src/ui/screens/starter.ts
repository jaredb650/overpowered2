import { STARTERS, type StarterGun } from '../../contracts/starter';
import { WEAPONS } from '../../weapons/data';
import { div, h, span } from '../dom';
import { weaponIcon } from '../icons';
import type { NavItem } from './nav';
import '../css/starter.css';

/** Shared menu/lobby cards, with the same silhouette and live numbers as the arsenal. */
export function starterCards(selected: StarterGun | undefined, pick: (gun: StarterGun) => void): NavItem[] {
  const cards = STARTERS.map(gun => {
    const def = WEAPONS[gun];
    const icon = span('starter-icon');
    icon.innerHTML = weaponIcon(gun);
    const el = h('button', 'starter-card', icon, div('starter-copy',
      span('starter-name', def.name),
      span('starter-stats', `${def.damage} DMG · ${Math.round(60 / def.interval)} RPM · ${def.magSize} RDS${gun === 'gimlet' ? ' · 4× + suppressor' : gun === 'smg' ? ' · weapon light' : ''}`),
    ));
    el.type = 'button';
    el.setAttribute('aria-label', `Starter: ${def.name}`);
    const activate = () => { paint(gun); pick(gun); };
    return { el, activate };
  });
  const paint = (gun: StarterGun | undefined) => cards.forEach((card, i) => {
    const on = STARTERS[i] === gun;
    card.el.classList.toggle('selected', on);
    card.el.setAttribute('aria-pressed', String(on));
  });
  paint(selected);
  return cards;
}
