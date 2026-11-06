/** Weapon strip, magazine, reserve, reload, grenades. */
import type { Ctx } from '../../core/contracts';
import type { WeaponId } from '../../core/gameplay';
import { Flag, Label, Meter, Shown, SLAM, div, markup, span } from '../dom';
import { WEAPON_ORDER, WEAPONS } from '../data';
import { GRENADE_ICON, weaponIcon } from '../icons';
import type { HudState } from '../state';

const MAX_GRENADE_PIPS = 5;

class Slot {
  readonly el: HTMLElement;
  readonly owned: Flag;
  readonly active: Flag;
  readonly dry: Flag;
  constructor(readonly id: WeaponId) {
    this.el = div('slot', span('slot-key', WEAPONS[id].key), markup(weaponIcon(id)));
    this.owned = new Flag(this.el, 'owned');
    this.active = new Flag(this.el, 'active');
    this.dry = new Flag(this.el, 'dry');
  }
}

export class Arms {
  readonly el: HTMLElement;
  private slots: Slot[];
  private iconHost: HTMLElement;
  private name: Label;
  private mag: Label;
  private reserve: Label;
  private magEl: HTMLElement;
  private magBar: Meter;
  private reload: Meter;
  private reloadRow: Shown;
  private ammoBlock: HTMLElement;
  private lowAmmo: Flag;
  private empty: Flag;
  private infinite: Flag;
  private pips: Flag[] = [];
  private shownWeapon: WeaponId | null = null;
  private stripClock = 0;
  private shownCount = -1;

  constructor(private readonly ctx: Ctx) {
    this.slots = WEAPON_ORDER.map(id => new Slot(id));
    this.iconHost = div('arm-icon');
    const nameEl = span('arm-name');
    const magEl = span('arm-mag');
    const reserveEl = span('arm-reserve');
    const magFill = div('arm-magfill');
    const reloadFill = div('arm-reloadfill');
    const reloadRow = div('arm-reload', reloadFill, span('arm-reload-t', 'reloading'));
    const grenades = div('arm-gren');
    for (let i = 0; i < MAX_GRENADE_PIPS; i++) {
      const pip = markup(GRENADE_ICON);
      grenades.append(pip);
      this.pips.push(new Flag(pip, 'full'));
    }
    this.ammoBlock = div('arm-ammo',
      div('arm-count', magEl, reserveEl),
      div('arm-magbar', magFill),
      reloadRow,
    );
    this.el = div('arms',
      div('arm-strip', ...this.slots.map(s => s.el)),
      div('arm-main',
        div('arm-who', this.iconHost, div('arm-tag', grenades, nameEl)),
        this.ammoBlock,
      ),
    );
    this.name = new Label(nameEl);
    this.mag = new Label(magEl);
    this.reserve = new Label(reserveEl);
    this.magEl = magEl;
    this.magBar = new Meter(magFill);
    this.reload = new Meter(reloadFill);
    this.reloadRow = new Shown(reloadRow);
    this.lowAmmo = new Flag(this.ammoBlock, 'low');
    this.empty = new Flag(this.ammoBlock, 'empty');
    this.infinite = new Flag(this.ammoBlock, 'infinite');
  }

  /** A weapon just arrived in a cache: make its slot land. */
  unlocked(id: WeaponId): void {
    const slot = this.slots.find(s => s.id === id);
    slot?.el.animate(SLAM as unknown as Keyframe[], 260);
  }

  update(s: HudState, dt: number): void {
    if (s.weapon !== this.shownWeapon) {
      this.shownWeapon = s.weapon;
      this.iconHost.replaceChildren(markup(weaponIcon(s.weapon)));
      this.name.set(WEAPONS[s.weapon].name);
      this.magEl.animate(SLAM as unknown as Keyframe[], 140);
    }

    const melee = s.magSize === 0;
    const count = s.bottomless && !melee ? '∞' : melee ? '–' : String(s.mag);
    this.mag.set(count);
    this.reserve.set(melee ? '' : s.bottomless ? '∞' : String(s.reserve));
    this.magBar.set(melee || s.bottomless ? 1 : s.mag / s.magSize);

    const ratio = melee ? 1 : s.mag / s.magSize;
    this.infinite.set(s.bottomless && !melee);
    this.empty.set(!s.bottomless && !melee && s.mag === 0);
    this.lowAmmo.set(!s.bottomless && !melee && s.mag > 0 && ratio <= 0.33);

    this.reloadRow.set(s.reloading);
    if (s.reloading) this.reload.set(s.reloadProgress);

    if (s.grenades !== this.shownCount) {
      this.shownCount = s.grenades;
      for (let i = 0; i < this.pips.length; i++) this.pips[i]!.set(i < s.grenades);
    }

    // Ownership and other weapons' ammo change rarely, and reading ten of them each frame buys nothing.
    this.stripClock -= dt;
    if (this.stripClock > 0) {
      this.slots[WEAPON_ORDER.indexOf(s.weapon)]?.active.set(true);
      return;
    }
    this.stripClock = 0.1;
    for (const slot of this.slots) {
      slot.owned.set(s.owns(this.ctx, slot.id));
      slot.active.set(slot.id === s.weapon);
      slot.dry.set(!s.loaded(this.ctx, slot.id));
    }
  }

  /** Forces the next update to refresh the strip. */
  invalidate(): void {
    this.stripClock = 0;
  }
}
