/** Settings: one general page and one for keys. Values apply and save the moment they change. */
import type { Action, Ctx } from '../../core/contracts';
import { clamp } from '../../core/math';
import { labelForCode } from '../../input/bindings';
import { KEY_GROUPS } from '../data';
import { Label, Meter, div, h, span } from '../dom';
import type { Hud } from '../Hud';
import {
  DEFAULTS, FOV_RANGE, GORE_LEVELS, QUALITY_LEVELS, SENSITIVITY_RANGE, applyQuality, applySettings, saveSettings, type Settings,
} from '../settings';
import type { Nav, NavItem } from './nav';
import { menuButton } from './parts';
import type { Screen } from './Screens';

interface Rebinder {
  bindingsFor?: (a: Action) => readonly string[];
  labelFor?: (a: Action) => string;
  rebind?: (a: Action, codes: readonly string[]) => void;
  conflicts?: (code: string, except?: Action) => Action[];
  resetBindings?: () => void;
  captureNext?: (cb: (code: string | null) => void) => void;
}

const ACTION_NAMES = new Map<Action, string>(KEY_GROUPS.flatMap(g => g.rows));

/** Shared with the Crucible rules screen. */
export class Slider implements NavItem {
  readonly el: HTMLElement;
  private fill: Meter;
  private text: Label;
  private track: HTMLElement;

  constructor(
    label: string,
    private readonly min: number,
    private readonly max: number,
    private readonly step: number,
    private readonly read: () => number,
    private readonly write: (v: number) => void,
    private readonly format: (v: number) => string,
    private readonly tick: () => void,
  ) {
    const fill = div('sl-fill');
    const value = span('row-v');
    this.track = div('sl-track', fill);
    this.el = div('row', span('row-k', label), this.track, value);
    this.el.setAttribute('role', 'slider');
    this.el.setAttribute('aria-label', label);
    this.fill = new Meter(fill);
    this.text = new Label(value);
    this.track.addEventListener('pointerdown', e => {
      this.track.setPointerCapture(e.pointerId);
      this.fromPointer(e.clientX);
    });
    this.track.addEventListener('pointermove', e => {
      if (this.track.hasPointerCapture(e.pointerId)) this.fromPointer(e.clientX);
    });
    this.refresh();
  }

  private fromPointer(x: number): void {
    const r = this.track.getBoundingClientRect();
    this.set(this.min + clamp((x - r.left) / r.width) * (this.max - this.min));
  }

  private set(v: number): void {
    const stepped = Math.round(v / this.step) * this.step;
    const next = clamp(stepped, this.min, this.max);
    if (next === this.read()) return;
    this.write(next);
    this.refresh();
    this.tick();
  }

  refresh(): void {
    const v = this.read();
    this.fill.set((v - this.min) / (this.max - this.min));
    this.text.set(this.format(v));
    this.el.setAttribute('aria-valuenow', String(v));
  }

  adjust(dir: -1 | 1): boolean {
    this.set(this.read() + dir * this.step);
    return true;
  }
}

class Stepper implements NavItem {
  readonly el: HTMLElement;
  private text: Label;

  constructor(
    label: string,
    private readonly names: readonly string[],
    private readonly read: () => number,
    private readonly write: (v: number) => void,
    private readonly tick: () => void,
  ) {
    const value = span('st-val');
    const back = span('st-arrow', '<');
    this.el = div('row', span('row-k', label), div('stepper', back, value, span('st-arrow', '>')));
    this.text = new Label(value);
    back.addEventListener('click', e => {
      e.stopPropagation();
      this.adjust(-1);
    });
    this.refresh();
  }

  refresh(): void {
    this.text.set(this.names[this.read()] ?? '');
  }

  adjust(dir: -1 | 1): boolean {
    const n = this.names.length;
    this.write((this.read() + dir + n) % n);
    this.refresh();
    this.tick();
    return true;
  }

  activate(): void {
    this.adjust(1);
  }
}

export class SettingsScreen implements Screen {
  readonly el: HTMLElement;
  private tabs: NavItem[];
  private panels: { el: HTMLElement; rows: NavItem[] }[] = [];
  private backItem: NavItem;
  private host: HTMLElement;
  private active = 0;
  private nav: Nav | null = null;
  private note: Label;
  private refreshers: (() => void)[] = [];

  constructor(private readonly ctx: Ctx, private readonly hud: Hud, private readonly settings: Settings) {
    const changed = () => {
      applySettings(this.ctx, this.settings);
      saveSettings(this.settings);
    };
    const tick = () => {
      changed();
      this.ctx.audio.play?.('ui_slider');
    };
    const qualityTick = () => {
      changed();
      applyQuality(this.ctx, this.settings);
      this.ctx.audio.play?.('ui_toggle');
    };
    const s = settings;
    const pct = (v: number) => `${Math.round(v * 100)}`;
    const sensitivity = new Slider('Mouse sensitivity', ...SENSITIVITY_RANGE, 0.05, () => s.sensitivity, v => { s.sensitivity = v; }, v => v.toFixed(2), tick);
    const fov = new Slider('Field of view', ...FOV_RANGE, 1, () => s.fov, v => { s.fov = v; }, v => `${v}`, tick);
    const invert = new Stepper('Invert mouse', ['Off', 'On'], () => (s.invertY ? 1 : 0), v => { s.invertY = v === 1; }, tick);
    const hop = new Stepper('Hold jump to hop', ['Off', 'On'], () => (s.holdToHop ? 1 : 0), v => { s.holdToHop = v === 1; }, tick);
    const master = new Slider('Master volume', 0, 1, 0.05, () => s.master, v => { s.master = v; }, pct, tick);
    const sfx = new Slider('Effects volume', 0, 1, 0.05, () => s.sfx, v => { s.sfx = v; }, pct, tick);
    const music = new Slider('Music volume', 0, 1, 0.05, () => s.music, v => { s.music = v; }, pct, tick);
    const quality = new Stepper('Graphics quality', QUALITY_LEVELS, () => s.quality, v => { s.quality = v; }, qualityTick);
    const gore = new Stepper('Gore', GORE_LEVELS, () => s.gore, v => { s.gore = v; }, tick);
    const general = [sensitivity, fov, invert, hop, master, sfx, music, quality, gore];
    this.refreshers = general.map(r => () => r.refresh());
    const keys = this.keyRows();
    const resetKeys = menuButton('Reset keys', () => this.resetKeys());
    resetKeys.el.classList.add('mi-small');
    const keyRows = [...keys.rows, resetKeys];
    this.panels = [
      {
        el: div('gd-panel', div('set-list',
          span('gd-h', 'Controls and view'), sensitivity.el, fov.el, invert.el, hop.el,
          span('gd-h', 'Audio'), master.el, sfx.el, music.el,
          span('gd-h', 'Video'), quality.el, gore.el,
        )),
        rows: general,
      },
      { el: div('gd-panel', keys.el, resetKeys.el), rows: keyRows },
    ];

    this.tabs = ['General', 'Keys'].map((label, i) => {
      const el = h('button', 'tab', label);
      el.type = 'button';
      el.tabIndex = -1;
      return { el, focused: () => this.select(i), activate: () => this.select(i) };
    });
    this.backItem = menuButton('Back', () => this.hud.screens.back());
    this.backItem.el.classList.add('mi-small');
    const defaults = menuButton('Defaults', () => this.restore());
    defaults.el.classList.add('mi-small');
    const note = span('set-note');
    this.host = div('sh-body');
    this.el = div('scr scr-sheet scr-settings',
      div('sh-side',
        span('sh-title', 'Settings'),
        div('sh-tabs', ...this.tabs.map(t => t.el)),
        div('fill'),
        note,
        defaults.el,
        this.backItem.el,
      ),
      this.host,
    );
    this.note = new Label(note);
    this.defaultsItem = defaults;
  }

  private defaultsItem: NavItem;

  private keyLabel(action: Action): string {
    const r = this.ctx.input as unknown as Rebinder;
    const codes = typeof r.bindingsFor === 'function' ? r.bindingsFor(action) : undefined;
    return Array.isArray(codes) && codes.length ? codes.map(labelForCode).join(' / ') : 'Unbound';
  }

  private keyRows(): { el: HTMLElement; rows: NavItem[] } {
    const rows: NavItem[] = [];
    const cols = KEY_GROUPS.map(group => {
      const col = div('key-col', span('gd-h', group.title));
      for (const [action, name] of group.rows) {
        const value = span('key-v');
        const label = new Label(value);
        const el = div('row row-key', span('row-k', name), value);
        const refresh = () => label.set(this.keyLabel(action));
        refresh();
        this.keyRefreshers.push(refresh);
        rows.push({ el, activate: () => this.capture(action, label, refresh) });
        col.append(el);
      }
      return col;
    });
    return { el: div('key-cols', ...cols), rows };
  }

  private keyRefreshers: (() => void)[] = [];

  private capture(action: Action, label: Label, refresh: () => void): void {
    const r = this.ctx.input as unknown as Rebinder;
    const nav = this.nav;
    if (typeof r.captureNext !== 'function' || !nav) return;
    nav.suspended = true;
    label.set('Press a key');
    label.el.classList.add('wait');
    this.note.set('Esc cancels.');
    r.captureNext(code => {
      label.el.classList.remove('wait');
      // The input that ended the capture must not also drive the menu. A key is done with next frame, but a mouse
      // button still has a release and a click to come, and that click lands on the row that started all this.
      const free = () => requestAnimationFrame(() => { nav.suspended = false; });
      if (code?.startsWith('Mouse')) addEventListener('mouseup', free, { once: true });
      else free();
      if (code !== null) {
        const clashes = r.conflicts?.(code, action) ?? [];
        r.rebind?.(action, [code]);
        this.note.set(clashes.length ? `Also bound to ${ACTION_NAMES.get(clashes[0]!) ?? clashes[0]}.` : '');
        this.ctx.audio.play?.('ui_confirm');
      } else {
        this.note.set('');
        this.ctx.audio.play?.('ui_back');
      }
      refresh();
      for (const fn of this.keyRefreshers) fn();
    });
  }

  private resetKeys(): void {
    (this.ctx.input as unknown as Rebinder).resetBindings?.();
    for (const fn of this.keyRefreshers) fn();
    this.note.set('Keys reset.');
  }

  private restore(): void {
    Object.assign(this.settings, DEFAULTS);
    applySettings(this.ctx, this.settings);
    applyQuality(this.ctx, this.settings);
    saveSettings(this.settings);
    for (const fn of this.refreshers) fn();
    this.note.set('Defaults restored.');
  }

  private select(i: number): void {
    this.active = i;
    this.host.replaceChildren(this.panels[i]!.el);
    this.tabs.forEach((t, k) => t.el.classList.toggle('on', k === i));
    const nav = this.nav;
    if (!nav) return;
    const keep = nav.index;
    nav.set([...this.tabs, ...this.panels[i]!.rows, this.defaultsItem, this.backItem], keep);
  }

  open(nav: Nav): void {
    this.nav = nav;
    this.note.set('');
    nav.back = () => this.hud.screens.back();
    nav.left = () => {
      if (nav.index >= this.tabs.length) nav.focus(this.active);
    };
    nav.right = () => {
      if (nav.index < this.tabs.length) nav.focus(this.tabs.length);
    };
    nav.index = 0;
    this.select(0);
    for (const fn of this.keyRefreshers) fn();
  }
}
