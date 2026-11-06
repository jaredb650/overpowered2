/** Guide: movement, weapons, perks and enemies. Tabs cut instantly, and every panel fits without scrolling. */
import type { Ctx } from '../../core/contracts';
import type { CallInId, PerkId, PowerupId } from '../../core/gameplay';
import { div, h, markup, span } from '../dom';
import {
  CALLIN_ORDER, CALLINS, CONTROLS_NOTE, ENEMY_GUIDE, ENEMY_NAMES, MOVEMENT_GUIDE, PERKS, POWERUPS, WEAPON_ORDER, WEAPONS,
} from '../data';
import type { Hud } from '../Hud';
import { GRENADE_ICON, weaponIcon } from '../icons';
import type { Nav, NavItem } from './nav';
import { menuButton } from './parts';
import type { Screen } from './Screens';

function movementPanel(): HTMLElement {
  return div('gd-panel',
    div('gd-list gd-move', ...MOVEMENT_GUIDE.map(m =>
      div('gd-row', span('gd-key', m.keys), span('gd-name', m.name), span('gd-body', m.body)),
    )),
    span('gd-note', CONTROLS_NOTE),
  );
}

function weaponsPanel(): HTMLElement {
  return div('gd-panel',
    div('gd-list gd-weapons',
      ...WEAPON_ORDER.map(id => {
        const w = WEAPONS[id];
        return div('gd-wrow', span('gd-key', w.key), markup(weaponIcon(id)), span('gd-name', w.name), span('gd-body', `${w.role}. ${w.note}`));
      }),
      div('gd-wrow', span('gd-key', 'G'), div('gd-gren', markup(GRENADE_ICON)), span('gd-name', 'Frag'), span('gd-body', 'Three grenades, restocked by ammo pickups. Hold to cook. They can be shot out of the air.')),
    ),
    span('gd-note', 'Five weapons from the start. The other five arrive in weapon caches, marked on your HUD every second wave.'),
  );
}

const chip = (color: string, text: string) => {
  const el = span('gd-chip', text);
  el.style.setProperty('--c', color);
  return el;
};

function perksPanel(): HTMLElement {
  const perkIds = Object.keys(PERKS) as PerkId[];
  const powerIds = Object.keys(POWERUPS) as PowerupId[];
  return div('gd-panel gd-cols',
    div('gd-col',
      span('gd-h', 'Perks'),
      ...perkIds.map(id => div('gd-prow', chip(PERKS[id].color, PERKS[id].name), span('gd-trigger', PERKS[id].trigger), span('gd-body', PERKS[id].reward))),
    ),
    div('gd-col',
      span('gd-h', 'Call-ins'),
      ...CALLIN_ORDER.map((id: CallInId) => div('gd-prow gd-short', chip(CALLINS[id].color, CALLINS[id].name), span('gd-trigger', `Combo ${CALLINS[id].combo}`), span('gd-body', CALLINS[id].note))),
      span('gd-h', 'Powerups'),
      div('gd-powers', ...powerIds.map(id => div('gd-prow gd-pw', chip(POWERUPS[id].color, POWERUPS[id].name), span('gd-body', POWERUPS[id].note)))),
    ),
  );
}

function enemiesPanel(): HTMLElement {
  return div('gd-panel',
    div('gd-list gd-enemies', ...ENEMY_GUIDE.map(e =>
      div('gd-erow', span('gd-name', ENEMY_NAMES[e.id]), span('gd-trigger', e.role), span('gd-body', e.tip)),
    )),
  );
}

export class GuideScreen implements Screen {
  readonly el: HTMLElement;
  private tabs: NavItem[];
  private backItem: NavItem;
  private panels: HTMLElement[];
  private host: HTMLElement;
  private active = 0;

  constructor(private readonly ctx: Ctx, private readonly hud: Hud) {
    this.panels = [movementPanel(), weaponsPanel(), perksPanel(), enemiesPanel()];
    const names = ['Movement', 'Weapons', 'Perks', 'Enemies'];
    this.tabs = names.map((label, i) => {
      const el = h('button', 'tab', label);
      el.type = 'button';
      el.tabIndex = -1;
      return { el, focused: () => this.select(i), activate: () => this.select(i) };
    });
    this.backItem = menuButton('Back', () => this.hud.screens.back());
    this.backItem.el.classList.add('mi-small');
    this.host = div('sh-body');
    this.el = div('scr scr-sheet scr-guide',
      div('sh-side',
        span('sh-title', 'Guide'),
        div('sh-tabs', ...this.tabs.map(t => t.el)),
        div('fill'),
        this.backItem.el,
      ),
      this.host,
    );
  }

  private select(i: number): void {
    this.active = i;
    this.host.replaceChildren(this.panels[i]!);
    this.tabs.forEach((t, k) => t.el.classList.toggle('on', k === i));
  }

  open(nav: Nav): void {
    nav.set([...this.tabs, this.backItem]);
    nav.back = () => this.hud.screens.back();
    nav.left = nav.right = null;
    this.select(0);
  }
}
