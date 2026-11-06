/** Guide: controls, movement, weapons, perks, call-ins, enemies and credits. Tabs cut instantly, and every panel fits without scrolling. */
import type { Action, Ctx } from '../../core/contracts';
import type { CallInId, PerkId, PowerupId } from '../../core/gameplay';
import { labelForCode } from '../../input/bindings';
import { div, h, markup, span } from '../dom';
import {
  CALLIN_NOTE, CALLIN_ORDER, CALLINS, CONTROLS_NOTE, CREDITS, CREDITS_NOTE, ENEMY_GUIDE, ENEMY_NAMES, ENEMY_NOTE, GRENADE_NOTE, KEY_GROUPS, MOVEMENT_GUIDE,
  PERK_NOTE, PERKS, PICKUP_GUIDE, POWERUP_NOTE, POWERUPS, SLIDE_NOTE, WEAPON_ORDER, WEAPONS, WEAPONS_NOTE,
} from '../data';
import type { Hud } from '../Hud';
import { GRENADE_ICON, weaponIcon } from '../icons';
import type { Nav, NavItem } from './nav';
import { menuButton } from './parts';
import type { Screen } from './Screens';

/** Keys that are not in the rebinding table, for the end of the controls panel. */
const FIXED_KEYS: readonly [string, string][] = [
  ['1 to 0', 'Pick a weapon'], ['Esc', 'Pause'], ['F3', 'Frame rate'], ['F4', 'Debug readout'],
];

/** Every key on an action, so the guide can never tell a player about a binding they changed. */
function keysFor(ctx: Ctx, action: Action): string {
  const codes = ctx.input.bindingsFor?.(action);
  return Array.isArray(codes) && codes.length ? codes.map(labelForCode).join(' / ') : 'Unbound';
}

function controlsPanel(ctx: Ctx): HTMLElement {
  const row = (key: string, name: string) => div('gd-krow', span('gd-key', key), span('gd-body', name));
  return div('gd-panel',
    div('gd-keys',
      ...KEY_GROUPS.map(group => div('gd-kcol',
        span('gd-h', group.title),
        ...group.rows.map(([action, name]) => row(keysFor(ctx, action), name)),
      )),
      div('gd-kcol', span('gd-h', 'Fixed'), ...FIXED_KEYS.map(([key, name]) => row(key, name))),
    ),
    span('gd-note', SLIDE_NOTE),
  );
}

function movementPanel(ctx: Ctx): HTMLElement {
  return div('gd-panel',
    div('gd-list gd-move', ...MOVEMENT_GUIDE.map(m =>
      div('gd-row', span('gd-key', m.action ? keysFor(ctx, m.action) : m.keys), span('gd-name', m.name), span('gd-body', m.body)),
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
      div('gd-wrow', span('gd-key', 'G'), div('gd-gren', markup(GRENADE_ICON)), span('gd-name', 'Frag'), span('gd-body', GRENADE_NOTE)),
    ),
    span('gd-note', WEAPONS_NOTE),
  );
}

const chip = (color: string, text: string) => {
  const el = span('gd-chip', text);
  el.style.setProperty('--c', color);
  return el;
};

function perksPanel(): HTMLElement {
  const perkIds = Object.keys(PERKS) as PerkId[];
  return div('gd-panel',
    div('gd-list', ...perkIds.map(id => div('gd-prow', chip(PERKS[id].color, PERKS[id].name), span('gd-trigger', PERKS[id].trigger), span('gd-body', PERKS[id].reward)))),
    span('gd-note', PERK_NOTE),
  );
}

function callInsPanel(ctx: Ctx): HTMLElement {
  const powerIds = Object.keys(POWERUPS) as PowerupId[];
  return div('gd-panel gd-cols',
    div('gd-col',
      span('gd-h', 'Call-ins'),
      ...CALLIN_ORDER.map((id: CallInId) => div('gd-crow',
        span('gd-key', keysFor(ctx, CALLINS[id].action)), chip(CALLINS[id].color, CALLINS[id].name), span('gd-trigger', `Combo ${CALLINS[id].combo}`), span('gd-body', CALLINS[id].note),
      )),
      span('gd-note', CALLIN_NOTE),
      span('gd-h', 'Pickups'),
      ...PICKUP_GUIDE.map(p => div('gd-prow gd-pw', span('gd-trigger', p.name), span('gd-body', p.note))),
    ),
    div('gd-col',
      span('gd-h', 'Powerups'),
      ...powerIds.map(id => div('gd-prow gd-pw', chip(POWERUPS[id].color, POWERUPS[id].name), span('gd-body', POWERUPS[id].note))),
      span('gd-note', POWERUP_NOTE),
    ),
  );
}

function enemiesPanel(): HTMLElement {
  return div('gd-panel',
    div('gd-list gd-enemies', ...ENEMY_GUIDE.map(e =>
      div('gd-erow', span('gd-key', `Wave ${e.wave}`), span('gd-name', ENEMY_NAMES[e.id]), span('gd-trigger', e.role), span('gd-body', e.tip)),
    )),
    span('gd-note', ENEMY_NOTE),
  );
}

function creditsPanel(): HTMLElement {
  return div('gd-panel',
    div('gd-list', ...CREDITS.map(c => div('gd-row gd-credit', span('gd-name', c.who), span('gd-body', c.what), span('gd-trigger', c.licence)))),
    span('gd-note', CREDITS_NOTE),
  );
}

export class GuideScreen implements Screen {
  readonly el: HTMLElement;
  private tabs: NavItem[];
  private backItem: NavItem;
  private panels: (() => HTMLElement)[];
  private host: HTMLElement;

  constructor(private readonly ctx: Ctx, private readonly hud: Hud) {
    // Built on selection, because three of them show the player's current key bindings.
    this.panels = [() => controlsPanel(ctx), () => movementPanel(ctx), weaponsPanel, perksPanel, () => callInsPanel(ctx), enemiesPanel, creditsPanel];
    const names = ['Controls', 'Movement', 'Weapons', 'Perks', 'Call-ins', 'Enemies', 'Credits'];
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
    this.host.replaceChildren(this.panels[i]!());
    this.tabs.forEach((t, k) => t.el.classList.toggle('on', k === i));
  }

  open(nav: Nav): void {
    nav.set([...this.tabs, this.backItem]);
    nav.back = () => this.hud.screens.back();
    nav.left = nav.right = null;
    this.select(0);
  }
}
