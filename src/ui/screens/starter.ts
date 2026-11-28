import { MOD_WARES } from '../../contracts/shop/data';
import {
  STARTERS, saveStarterMods, selectedStarterMods, starterGunMods, toggleStarterMod,
  type StarterGun,
} from '../../contracts/starter';
import { MISSION_MOD_WINS } from '../../contracts/unlocks';
import type { ModId } from '../../core/gameplay';
import { WEAPONS } from '../../weapons/data';
import { MODS, moddedDef } from '../../weapons/mods';
import { div, h, span } from '../dom';
import { weaponIcon } from '../icons';
import type { NavItem } from './nav';
import '../css/starter.css';

const SLOT_LABEL: Record<string, string> = {
  sight: 'SIGHT',
  ammo: 'AMMO',
  barrel: 'BARREL',
  muzzle: 'MUZZLE',
  mag: 'MAG',
  loader: 'LOADER',
  length: 'LENGTH',
  trigger: 'TRIGGER',
  choke: 'CHOKE',
  hammer: 'HAMMER',
  grip: 'GRIP',
};

const slotLabel = (mod: ModId): string => {
  const slot = MODS[mod].slot;
  return slot ? (SLOT_LABEL[slot] ?? slot.toUpperCase()) : 'OPEN';
};

function statsLine(gun: StarterGun, mods: readonly ModId[]): string {
  const def = moddedDef(gun, new Set(mods));
  const parts = [
    `${Math.round(def.damage)} DMG`,
    `${Math.round(60 / def.interval)} RPM`,
    `${def.magSize} RDS`,
    `${def.reloadTime.toFixed(2)}s RLD`,
  ];
  if (def.muzzle === 'suppressed') parts.push('SUPPRESSED');
  if (def.akimbo) parts.push('AKIMBO');
  return parts.join(' · ');
}

function stockStatsLine(gun: StarterGun): string {
  const def = WEAPONS[gun];
  const suffix = gun === 'gimlet'
    ? ' · 4× + suppressor'
    : gun === 'smg'
      ? ' · weapon light'
      : gun === 'flail'
        ? ' · belt-fed LMG'
        : '';
  return `${def.damage} DMG · ${Math.round(60 / def.interval)} RPM · ${def.magSize} RDS${suffix}`;
}

export interface StarterCardOptions {
  /** Which starter guns to display. Defaults to the standard 3 (`STARTERS`). */
  guns?: readonly StarterGun[];
  /** True when free starter mods are unlocked for every listed gun, or a per-gun predicate. */
  modsUnlocked?: boolean | ((gun: StarterGun) => boolean);
}

const isModUnlocked = (opts: StarterCardOptions | undefined, gun: StarterGun): boolean =>
  typeof opts?.modsUnlocked === 'function' ? opts.modsUnlocked(gun) : Boolean(opts?.modsUnlocked);

/** Refreshes a starter card's mod count badge and live stats line after mods change. */
export function updateStarterCard(el: HTMLElement, gun: StarterGun, modsUnlocked: boolean): void {
  const saved = modsUnlocked ? selectedStarterMods(gun) : null;
  const statsEl = el.querySelector<HTMLElement>('.starter-stats');
  if (statsEl) statsEl.textContent = saved ? statsLine(gun, saved) : stockStatsLine(gun);
  const badgeEl = el.querySelector<HTMLElement>('.starter-card-mods');
  if (badgeEl && saved) badgeEl.textContent = saved.length ? `${saved.length} MOD${saved.length === 1 ? '' : 'S'}` : 'STOCK';
}

/** Shared menu/lobby cards, with the same silhouette and live numbers as the arsenal. */
export function starterCards(selected: StarterGun | undefined, pick: (gun: StarterGun) => void, opts?: StarterCardOptions): NavItem[] {
  const guns = opts?.guns ?? STARTERS;
  const cards = guns.map(gun => {
    const def = WEAPONS[gun];
    const icon = span('starter-icon');
    icon.innerHTML = weaponIcon(gun);
    const saved = isModUnlocked(opts, gun) ? selectedStarterMods(gun) : null;
    const stats = saved ? statsLine(gun, saved) : stockStatsLine(gun);
    const nameRow = saved
      ? div('starter-namerow', span('starter-name', def.name), span('starter-card-mods', saved.length ? `${saved.length} MOD${saved.length === 1 ? '' : 'S'}` : 'STOCK'))
      : span('starter-name', def.name);
    const el = h('button', 'starter-card', icon, div('starter-copy',
      nameRow,
      span('starter-stats', stats),
    ));
    el.type = 'button';
    el.dataset.starter = gun;
    el.setAttribute('aria-label', `Starter: ${def.name}`);
    const activate = () => { paint(gun); pick(gun); };
    return { el, activate };
  });
  const paint = (gun: StarterGun | undefined) => cards.forEach((card, i) => {
    const on = guns[i] === gun;
    card.el.classList.toggle('selected', on);
    card.el.setAttribute('aria-pressed', String(on));
  });
  paint(selected);
  return cards;
}

export interface StarterModConfig {
  /** Non-interactive summary banner placed above the mod grid. */
  header: HTMLElement;
  /** Toggle buttons for every mod belonging to the gun, wired for Nav. */
  items: NavItem[];
  /** Current fitted mod selection. */
  selected(): ModId[];
}

const DEFAULT_NOTE = 'Every attachment for this weapon is free with no point limit. Same-slot items replace one another.';

/** Step 2 on the starter screen once free mods are unlocked (2+ mission clears, or Flail on Desert Raid). */
export function starterModConfig(gun: StarterGun, wins: number, onChange?: (mods: ModId[]) => void): StarterModConfig {
  const all = starterGunMods(gun);
  let mods = selectedStarterMods(gun);

  const icon = span('starter-mod-icon');
  icon.innerHTML = weaponIcon(gun);
  const countEl = span('starter-mod-count');
  const statsEl = span('starter-mod-stats');
  const noteEl = div('starter-mod-note', DEFAULT_NOTE);
  const badgeEl = span(
    'starter-mod-badge',
    wins >= MISSION_MOD_WINS ? `CLEARED ${wins}× · FREE MODS · NO LIMIT` : 'DESERT RAID · FREE MODS · NO LIMIT',
  );

  const header = div('starter-mod-head',
    div('starter-mod-titlebar', icon, div('starter-mod-heading',
      div('starter-mod-namerow', span('starter-mod-gun', WEAPONS[gun].name), countEl),
      statsEl,
    ), badgeEl),
    noteEl,
  );

  const rows: { id: ModId; el: HTMLButtonElement; mark: HTMLElement; state: HTMLElement }[] = [];

  const setNote = (id: ModId) => {
    const lore = MOD_WARES[id]?.lore;
    noteEl.textContent = lore ? `${MODS[id].name}: ${lore}` : DEFAULT_NOTE;
  };

  const paint = () => {
    const fitted = new Set(mods);
    const bySlot = new Map<string, ModId>();
    for (const id of mods) {
      const slot = MODS[id].slot;
      if (slot) bySlot.set(slot, id);
    }
    countEl.textContent = mods.length ? `${mods.length} FITTED` : 'STOCK';
    statsEl.textContent = statsLine(gun, mods);
    for (const row of rows) {
      const on = fitted.has(row.id);
      const slot = MODS[row.id].slot;
      const occupant = !on && slot ? bySlot.get(slot) : undefined;
      row.el.classList.toggle('fitted', on);
      row.el.classList.toggle('conflict', Boolean(occupant));
      row.el.setAttribute('aria-pressed', String(on));
      row.mark.textContent = on ? '■' : '□';
      row.state.textContent = on
        ? 'FITTED · FREE'
        : occupant
          ? `REPLACES ${MODS[occupant].name.toUpperCase()}`
          : 'FREE';
    }
  };

  const items: NavItem[] = all.map(id => {
    const def = MODS[id];
    const mark = span('starter-mod-mark', '□');
    const state = span('starter-mod-state', 'FREE');
    const el = h('button', 'starter-mod-btn',
      div('starter-mod-top', mark, span('starter-mod-name', def.name), span('starter-mod-slot', slotLabel(id))),
      state,
    );
    el.type = 'button';
    el.dataset.mod = id;
    el.dataset.slot = def.slot ?? '';
    el.setAttribute('aria-label', `${def.name} (${slotLabel(id)})`);
    rows.push({ id, el, mark, state });
    el.addEventListener('pointermove', () => setNote(id));
    const activate = () => {
      mods = toggleStarterMod(mods, gun, id);
      saveStarterMods(gun, mods);
      paint();
      setNote(id);
      onChange?.(mods);
    };
    return { el, activate, focused: () => setNote(id) };
  });

  paint();
  return { header, items, selected: () => [...mods] };
}

/** Compact mod toggle strip for the co-op lobby when the picked mission has free mods unlocked on this browser. */
export function starterLobbyMods(gun: StarterGun, wins: number, onChange?: (mods: ModId[]) => void): HTMLElement {
  const all = starterGunMods(gun);
  let mods = selectedStarterMods(gun);
  const title = span(
    'nt-k',
    wins >= MISSION_MOD_WINS
      ? `${WEAPONS[gun].name} mods · cleared ${wins}× · all free, no limit`
      : `${WEAPONS[gun].name} mods · all free, no limit`,
  );
  const list = div('starter-lobby-grid');
  const buttons: { id: ModId; el: HTMLButtonElement }[] = [];

  const paint = () => {
    const fitted = new Set(mods);
    const bySlot = new Map<string, ModId>();
    for (const id of mods) {
      const slot = MODS[id].slot;
      if (slot) bySlot.set(slot, id);
    }
    for (const btn of buttons) {
      const on = fitted.has(btn.id);
      const slot = MODS[btn.id].slot;
      const conflict = !on && !!slot && bySlot.has(slot);
      btn.el.classList.toggle('fitted', on);
      btn.el.classList.toggle('conflict', conflict);
      btn.el.setAttribute('aria-pressed', String(on));
    }
  };

  for (const id of all) {
    const el = h('button', 'starter-lobby-pill', span('starter-pill-name', MODS[id].name), span('starter-pill-slot', slotLabel(id)));
    el.type = 'button';
    el.dataset.mod = id;
    el.addEventListener('click', () => {
      mods = toggleStarterMod(mods, gun, id);
      saveStarterMods(gun, mods);
      paint();
      onChange?.(mods);
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); });
    buttons.push({ id, el });
    list.append(el);
  }
  paint();
  return div('starter-lobby-mods', title, list);
}
