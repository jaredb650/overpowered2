/** Weapon strip, magazine, reserve, reload, grenades. */
import type { Ctx } from '../../core/contracts';
import type { WeaponId } from '../../core/gameplay';
import { Flag, Label, Meter, Shown, SLAM, div, markup, span } from '../dom';
import { WEAPONS } from '../data';
import { GRENADE_ICON, weaponIcon } from '../icons';
import type { HudState } from '../state';
import { TUNING, WEAPONS as WEAPON_DEFS } from '../../weapons/data';
import { SLOT_ORDER, familyOf, familyOfSlot } from '../../weapons/families';

const MAX_GRENADE_PIPS = TUNING.grenade.max;

/**
 * One cell per number key. It shows the member the key draws now, and a family with more than one member carries a row
 * of pips under the key: one per member, lit for the one in the cell, hollow for one not owned yet.
 */
class Slot {
  readonly el: HTMLElement;
  readonly owned: Flag;
  readonly active: Flag;
  readonly dry: Flag;
  readonly family: readonly WeaponId[];
  private readonly icons = new Map<WeaponId, Element>();
  private readonly pipOn: Flag[] = [];
  private readonly pipOwned: Flag[] = [];
  private shown: WeaponId;
  constructor(readonly slot: number) {
    this.family = familyOfSlot(slot);
    this.shown = this.family[0]!;
    for (const id of this.family) this.icons.set(id, markup(weaponIcon(id)));
    this.el = div('slot', span('slot-key', WEAPONS[this.shown].key), this.icons.get(this.shown)!);
    if (this.family.length > 1) {
      const pips = this.family.map(() => div('slot-pip'));
      this.el.append(div('slot-fam', ...pips));
      for (const pip of pips) {
        this.pipOn.push(new Flag(pip, 'on'));
        this.pipOwned.push(new Flag(pip, 'owned'));
      }
    }
    this.owned = new Flag(this.el, 'owned');
    this.active = new Flag(this.el, 'active');
    this.dry = new Flag(this.el, 'dry');
  }

  /** Puts `id` in the cell. */
  show(id: WeaponId): void {
    if (id !== this.shown && this.icons.has(id)) {
      this.icons.get(this.shown)!.replaceWith(this.icons.get(id)!);
      this.shown = id;
    }
    for (let i = 0; i < this.pipOn.length; i++) this.pipOn[i]!.set(this.family[i] === id);
  }

  get member(): WeaponId {
    return this.shown;
  }

  ownedPips(owns: (id: WeaponId) => boolean): void {
    for (let i = 0; i < this.pipOwned.length; i++) this.pipOwned[i]!.set(owns(this.family[i]!));
  }
}

export class Arms {
  readonly el: HTMLElement;
  private slots: Slot[];
  private iconHost: HTMLElement;
  private name: Label;
  private familyEl: HTMLElement;
  private familyShown = '';
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
    this.slots = SLOT_ORDER.map(slot => new Slot(slot));
    this.iconHost = div('arm-icon');
    const nameEl = span('arm-name');
    this.familyEl = div('arm-family');
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
        div('arm-who', this.iconHost, div('arm-tag', grenades, nameEl), this.familyEl),
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
    const slot = this.slots.find(s => s.family.includes(id));
    slot?.el.animate(SLAM as unknown as Keyframe[], 260);
  }

  /**
   * The line under the weapon's name: every owned member of its family, the one in hand lit, and the key that steps
   * through them. Empty for a weapon that is alone on its key.
   */
  private drawFamily(s: HudState): void {
    const family = familyOf(s.weapon).filter(id => id === s.weapon || s.owns(this.ctx, id));
    const sign = family.length > 1 ? `${s.weapon}:${family.join()}` : '';
    if (sign === this.familyShown) return;
    this.familyShown = sign;
    if (!sign) {
      this.familyEl.replaceChildren();
      return;
    }
    const names = family.map(id => span(id === s.weapon ? 'arm-fam on' : 'arm-fam', WEAPONS[id].name.toUpperCase()));
    this.familyEl.replaceChildren(span('arm-fam-key', WEAPONS[s.weapon].key), ...names);
  }

  update(s: HudState, dt: number): void {
    if (s.weapon !== this.shownWeapon) {
      // A switch redraws the strip and the family line on this frame, not on the next tick of the strip's clock.
      this.stripClock = 0;
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

    // Ownership and other weapons' ammo change rarely, and reading them all each frame buys nothing.
    this.stripClock -= dt;
    if (this.stripClock > 0) {
      const held = this.slots[SLOT_ORDER.indexOf(WEAPON_DEFS[s.weapon].slot)];
      if (held) {
        held.show(s.weapon);
        held.active.set(true);
      }
      return;
    }
    this.stripClock = 0.1;
    const owns = (id: WeaponId) => s.owns(this.ctx, id);
    for (const slot of this.slots) {
      const held = slot.family.includes(s.weapon);
      slot.show(held ? s.weapon : s.member(this.ctx, slot.slot) ?? slot.member);
      slot.ownedPips(owns);
      slot.owned.set(slot.family.some(owns));
      slot.active.set(held);
      slot.dry.set(!s.loaded(this.ctx, slot.member));
    }
    this.drawFamily(s);
  }

  /** Forces the next update to refresh the strip. */
  invalidate(): void {
    this.stripClock = 0;
  }
}
