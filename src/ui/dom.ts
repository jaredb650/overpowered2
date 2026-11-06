/**
 * DOM helpers for the HUD. Every helper here exists to keep per-frame updates cheap: a widget holds
 * one of these per value and calls set() each frame, and the DOM is touched only when the value changes.
 *
 * The loading screen uses this file, so it must stay free of imports that reach three.js.
 */
export type Kid = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const k of kids) if (k) el.append(k);
  return el;
}

export const div = (cls = '', ...kids: Kid[]) => h('div', cls, ...kids);
export const span = (cls = '', ...kids: Kid[]) => h('span', cls, ...kids);

/** Parses one element of markup. Only ever fed strings from this codebase. */
export function markup<T extends Element = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

export class Label {
  private last: string | null = null;
  constructor(readonly el: HTMLElement) {}
  set(text: string): void {
    if (text === this.last) return;
    this.last = text;
    this.el.textContent = text;
  }
}

/** Integer readout. The number-to-string conversion only happens when the integer changes. */
export class Num {
  private last = NaN;
  constructor(readonly el: HTMLElement) {}
  set(n: number): void {
    if (n === this.last) return;
    this.last = n;
    this.el.textContent = String(n);
  }
}

/** Tenths readout for countdowns, e.g. 4.9. */
export class Tenths {
  private last = -1;
  constructor(readonly els: readonly HTMLElement[]) {}
  set(seconds: number): void {
    const q = Math.ceil(seconds * 10);
    if (q === this.last) return;
    this.last = q;
    const text = (q / 10).toFixed(1);
    for (const el of this.els) el.textContent = text;
  }
}

export class Flag {
  private last: boolean | null = null;
  constructor(readonly el: Element, private readonly cls: string) {}
  set(on: boolean): void {
    if (on === this.last) return;
    this.last = on;
    this.el.classList.toggle(this.cls, on);
  }
}

/** Fill bar. A transform rather than a width, so a moving bar never touches layout. */
export class Meter {
  private q = -1;
  constructor(readonly el: HTMLElement, private readonly axis: 'X' | 'Y' = 'X') {}
  set(v: number): void {
    const q = Math.round(Math.min(1, Math.max(0, v)) * 1000);
    if (q === this.q) return;
    this.q = q;
    this.el.style.transform = `scale${this.axis}(${q / 1000})`;
  }
}

/** Show or hide with `display`, skipping the write when nothing changed. */
export class Shown {
  private last: boolean | null = null;
  constructor(readonly el: HTMLElement, private readonly on = '') {}
  set(show: boolean): void {
    if (show === this.last) return;
    this.last = show;
    this.el.style.display = show ? this.on : 'none';
  }
}

/** Zero attack, then decay: the shared envelope for anything that hits on the frame of its event. */
export const SLAM = [
  { transform: 'scale(1.32)', easing: 'cubic-bezier(.1,.9,.2,1)' },
  { transform: 'scale(1)' },
] as const;

/** Leaves by collapsing to a line, since nothing in this HUD fades out of a hard edge. */
export const COLLAPSE = [
  { transform: 'scaleY(1)', opacity: 1, easing: 'cubic-bezier(.7,0,1,.6)' },
  { transform: 'scaleY(0)', opacity: 1 },
] as const;
