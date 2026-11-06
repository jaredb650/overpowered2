/** Keyboard and mouse navigation for a list of menu items. One owner of focus, so both inputs agree. */
import type { Ctx } from '../../core/contracts';

export interface NavItem {
  el: HTMLElement;
  activate?(): void;
  /** Left or right on this item. Returns false to let the key fall through. */
  adjust?(dir: -1 | 1): boolean;
  /** Runs when the item gains focus, by keyboard or pointer. */
  focused?(): void;
}

export class Nav {
  items: NavItem[] = [];
  index = 0;
  /** Set while a row owns the keyboard, such as the key capture prompt. */
  suspended = false;
  /** Esc or Backspace. */
  back: (() => void) | null = null;
  /** Left on an item that does not take it. */
  left: (() => void) | null = null;
  /** Right on an item that does not take it. */
  right: (() => void) | null = null;
  /** Seconds left of ignoring every press, for a screen that can open under a player who is mid-button. */
  private held = 0;

  constructor(private readonly ctx: Ctx) {}

  hold(seconds: number): void {
    this.held = seconds;
  }

  update(dt: number): void {
    if (this.held > 0) this.held -= dt;
  }

  set(items: NavItem[], index = 0): void {
    for (const old of this.items) old.el.classList.remove('focus');
    this.items = items;
    this.index = Math.min(index, items.length - 1);
    for (const item of items) this.wire(item);
    this.paint();
  }

  private wire(item: NavItem): void {
    const el = item.el as HTMLElement & { navWired?: boolean };
    if (el.navWired) return;
    el.navWired = true;
    // pointermove, not pointerenter: a mouse resting under the keyboard's focus should not steal it back.
    el.addEventListener('pointermove', () => {
      const i = this.items.indexOf(item);
      if (i >= 0 && i !== this.index && !this.suspended) this.focus(i, false, true);
    });
    el.addEventListener('click', () => {
      if (this.suspended || this.held > 0 || !this.items.includes(item)) return;
      this.activate(item);
    });
  }

  private activate(item: NavItem): void {
    if (!item.activate) return;
    this.ctx.audio.play?.('menu_select');
    item.activate();
  }

  /** `pointer` skips `focused`: a tab should open on a click, not on the mouse passing over it. */
  focus(i: number, silent = false, pointer = false): void {
    if (i === this.index && !silent) return;
    this.index = i;
    this.paint();
    if (!silent) this.ctx.audio.play?.('ui_hover');
    if (!pointer) this.items[i]?.focused?.();
  }

  private paint(): void {
    this.items.forEach((item, i) => item.el.classList.toggle('focus', i === this.index));
  }

  private move(step: number): void {
    const n = this.items.length;
    if (n === 0) return;
    this.focus((this.index + step + n) % n);
    this.items[this.index]?.el.scrollIntoView({ block: 'nearest' });
  }

  /** Returns true when the key was used. */
  key(e: KeyboardEvent): boolean {
    if (this.suspended || this.held > 0) return false;
    const item = this.items[this.index];
    switch (e.code) {
      case 'ArrowUp': case 'KeyW': this.move(-1); return true;
      case 'ArrowDown': case 'KeyS': this.move(1); return true;
      case 'ArrowLeft': case 'KeyA':
        if (!item?.adjust?.(-1)) this.left?.();
        return true;
      case 'ArrowRight': case 'KeyD':
        if (!item?.adjust?.(1)) this.right?.();
        return true;
      case 'Enter': case 'Space':
        if (item) this.activate(item);
        return true;
      case 'Escape': case 'Backspace':
        if (this.back) {
          this.ctx.audio.play?.('ui_back');
          this.back();
          return true;
        }
        return false;
      default:
        return false;
    }
  }
}
