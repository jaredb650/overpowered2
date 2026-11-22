/**
 * The Distraint Frame's loadout (src/frame/loadout.ts), as the implants page is the contractor's: the slots across the top, what
 * each takes listed under them, and the part in focus on the card. Enter or a click fits it, free: every part listed is standard
 * issue. The choice is kept in this browser and the next Frame called in is built from it; one already standing keeps its own.
 *
 * Reached from the main menu (Frame), the pause menu (Frame loadout) and Procurement's Frame tab; Esc or Back goes back to
 * whichever opened it. The mouse over a row selects it as the arrow keys do.
 */
import type { Ctx } from '../../core/contracts';
import {
  FRAME_PARTS, fitPart, loadFrameLoadout, partsFor, saveFrameLoadout, SINGLE_SLOTS, type FrameLoadout, type FramePart, type FrameSlot,
} from '../../frame/loadout';
import { Label, div, h, span } from '../dom';
import type { Hud } from '../Hud';
import type { Nav, NavItem } from './nav';
import { menuButton } from './parts';
import type { Screen } from './Screens';

/** The slots as the screen names them. */
const SLOT_NAMES: Readonly<Record<FrameSlot, string>> = {
  leftArm: 'Left arm', rightArm: 'Right arm', shoulder: 'Shoulder', legs: 'Legs', cockpit: 'Cockpit', engine: 'Engine',
};
/** What each slot is for, on the card. */
const SLOT_ROLE: Readonly<Record<FrameSlot, string>> = {
  leftArm: 'Left arm weapon. LMB fires; tap 1 to cycle ammo.',
  rightArm: 'Right arm weapon. RMB fires; tap 2 to cycle ammo.',
  shoulder: 'Shoulder weapon. Keys: G (slot 1), V (slot 2), B (slot 3); tap 3/4/5 to cycle shoulder rounds.',
  legs: 'Legs. Decide how it walks, jumps, stomps and handles recoil.',
  cockpit: 'Cockpit. Decides shoulder slots (1–3), canopy armour and sensors.',
  engine: 'Engine. Decides speed, flight/hover mode and Shift drive.',
};

/** One row: a part, for one slot (a shoulder part for one shoulder slot). */
interface Row {
  part: FramePart;
  slot: FrameSlot;
  /** Which shoulder slot, for a shoulder part. */
  at: number;
}

export class FrameLoadoutScreen implements Screen {
  readonly el: HTMLElement;
  private nav: Nav | null = null;
  private loadout: FrameLoadout = loadFrameLoadout();
  private readonly strip: HTMLElement;
  private readonly list: HTMLElement;
  private readonly back: NavItem;
  private readonly note: Label;
  private readonly card: { name: Label; role: Label; lore: Label; price: Label; state: Label; stats: HTMLElement; buy: HTMLElement };
  private rows: Row[] = [];

  constructor(private readonly ctx: Ctx, private readonly hud: Hud) {
    this.strip = div('pc-slots fl-slots');
    this.list = div('pc-list');
    const note = span('pc-note');
    this.note = new Label(note);
    this.back = menuButton('Back', () => this.hud.screens.back());
    this.back.el.classList.add('mi-small');
    const name = span('pc-name');
    const role = span('pc-role');
    const lore = h('p', 'pc-lore');
    const price = span('pc-price');
    const state = span('pc-state');
    const stats = div('pc-stats');
    const buy = div('pc-buy', price, state);
    this.card = { name: new Label(name), role: new Label(role), lore: new Label(lore), price: new Label(price), state: new Label(state), stats, buy };
    this.el = div('scr scr-proc scr-frame',
      div('pc-side',
        span('pc-form', 'Form 7742-F · Walker configuration'),
        span('pc-title', 'Distraint Frame'),
        span('pc-phase', 'Loadout. The next Frame called in is built to it; one already standing keeps its own.'),
        this.strip,
        this.list,
        note,
        span('pc-terms', 'All parts listed are standard issue. Non-standard parts are pending a procurement review that began some time ago.'),
        this.back.el,
      ),
      div('pc-card', name, role, stats, lore, buy),
    );
  }

  open(nav: Nav): void {
    this.nav = nav;
    this.loadout = loadFrameLoadout();
    this.note.set('');
    nav.back = () => this.hud.screens.back();
    nav.left = nav.right = null;
    this.refresh(0);
  }

  /** The slots across the top: what each holds now. */
  private slots(): void {
    const l = this.loadout;
    const box = (n: string, id: string) => div('pc-slot open worn', span('pc-slot-n', n), span('pc-slot-v', FRAME_PARTS[id as keyof typeof FRAME_PARTS].name));
    this.strip.replaceChildren(
      box('Left arm', l.leftArm), box('Right arm', l.rightArm),
      ...l.shoulders.map((id, i) => box(l.shoulders.length > 1 ? `Shoulder ${i + 1}` : 'Shoulder', id)),
      box('Legs', l.legs), box('Cockpit', l.cockpit), box('Engine', l.engine),
    );
  }

  private fitted(r: Row): boolean {
    const l = this.loadout;
    return r.slot === 'shoulder' ? l.shoulders[r.at] === r.part.id : l[r.slot as (typeof SINGLE_SLOTS)[number]] === r.part.id;
  }

  private refresh(keep: number): void {
    this.slots();
    this.rows = [];
    const kids: HTMLElement[] = [];
    const items: NavItem[] = [];
    const group = (title: string, slot: FrameSlot, at = 0): void => {
      kids.push(span('pc-group', title));
      for (const part of partsFor(slot)) {
        const r: Row = { part, slot, at };
        const on = this.fitted(r);
        const el = div('pc-row', span('pc-ico pc-cls', SLOT_NAMES[slot]), span('pc-k', part.name), span('pc-v', on ? 'Fitted' : 'Fit'));
        el.classList.toggle('fitted', on);
        el.classList.toggle('owned', !on);
        const item: NavItem = { el, hover: true, activate: () => this.fit(r), focused: () => this.select(r) };
        this.rows.push(r);
        items.push(item);
        kids.push(el);
      }
    };
    group(SLOT_NAMES.leftArm, 'leftArm');
    group(SLOT_NAMES.rightArm, 'rightArm');
    this.loadout.shoulders.forEach((_, i) => group(this.loadout.shoulders.length > 1 ? `Shoulder ${i + 1}` : 'Shoulder', 'shoulder', i));
    group(SLOT_NAMES.legs, 'legs');
    group(SLOT_NAMES.cockpit, 'cockpit');
    group(SLOT_NAMES.engine, 'engine');
    this.list.replaceChildren(...kids);
    items.push(this.back);
    const at = Math.min(keep, this.rows.length - 1);
    this.nav?.set(items, at);
    this.select(this.rows[at]!);
  }

  private select(r: Row): void {
    const c = this.card;
    const on = this.fitted(r);
    const line = (k: string, v: string) => div('pc-line', span('pc-stat-k', k), span('pc-line-v', v));
    c.name.set(r.part.name);
    c.role.set(SLOT_ROLE[r.slot]);
    c.stats.replaceChildren(line('Does', r.part.does), line('Fits', r.slot === 'shoulder' ? `Shoulder slot ${r.at + 1}` : SLOT_NAMES[r.slot]));
    c.lore.set(r.part.lore);
    c.price.set('Issued');
    c.state.set(on ? 'Fitted' : 'Enter: Fit');
    c.buy.classList.toggle('ready', !on);
    c.buy.classList.toggle('locked', false);
    c.buy.classList.toggle('poor', false);
  }

  /** Fits the part, free, keeps it, and stays on its row. */
  private fit(r: Row): void {
    const index = this.rows.indexOf(r);
    if (this.fitted(r)) {
      this.note.set(`${r.part.name} is already fitted.`);
      return;
    }
    this.loadout = fitPart(this.loadout, r.part.id, r.at);
    saveFrameLoadout(this.loadout);
    this.note.set(`Fitted: ${r.part.name}, ${r.slot === 'shoulder' ? `shoulder ${r.at + 1}` : SLOT_NAMES[r.slot].toLowerCase()}.`);
    this.ctx.audio.play?.('ui_confirm');
    this.refresh(Math.max(0, index));
  }
}
