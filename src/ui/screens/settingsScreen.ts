import { reporter } from '../../core/report';
/** Settings: general, keys and privacy. Values apply and save the moment they change. */
import type { Action, Ctx } from '../../core/contracts';
import { cheatsOn, isCheatPassword, setCheats } from '../../core/cheats';
import { clamp } from '../../core/math';
import { labelForCode } from '../../input/bindings';
import { HIT_TEXT_LEVELS } from '../../progression/data';
import { KEY_GROUPS } from '../data';
import { Label, Meter, div, h, span } from '../dom';
import type { Hud } from '../Hud';
import {
  AIM_SENSITIVITY_RANGE, BLOOD_PUFF_LABELS, CHATTER_LEVELS, DEFAULTS, FOV_RANGE, GORE_LEVELS, MESS_NAMES, QUALITY_LEVELS, SENSITIVITY_CURVE, SENSITIVITY_RANGE, applyQuality, applySettings,
  saveSettings, sliderToValue, valueToSlider,
  type Settings,
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
    /** Above 1, the track is bent so the low end gets more of it (ui/settings.ts). */
    private readonly curve = 1,
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
    this.set(sliderToValue((x - r.left) / r.width, this.min, this.max, this.curve));
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
    this.fill.set(valueToSlider(v, this.min, this.max, this.curve));
    this.text.set(this.format(v));
    this.el.setAttribute('aria-valuenow', String(v));
  }

  adjust(dir: -1 | 1): boolean {
    const v = this.read();
    // A bent track moves a 40th of its length a press; at the low end that rounds back to where it was, so it steps by `step`.
    const next = sliderToValue(valueToSlider(v, this.min, this.max, this.curve) + dir / 40, this.min, this.max, this.curve);
    const moved = this.curve === 1 || Math.round(next / this.step) === Math.round(v / this.step) ? v + dir * this.step : next;
    this.set(moved);
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

/** Enable cheats asks for the password in the row itself; once they are on, the same row turns them off (core/cheats.ts). */
export class CheatRow implements NavItem {
  readonly el: HTMLElement;
  private readonly input = h('input', 'co-input cheat-pass');
  private readonly state = span('st-val');
  private asking = false;

  constructor(private readonly say: (text: string) => void, private readonly play: (id: string) => void) {
    this.input.type = 'text';
    this.input.hidden = true;
    this.input.maxLength = 40;
    this.input.placeholder = 'Password';
    this.input.spellcheck = false;
    this.input.autocomplete = 'off';
    this.input.addEventListener('click', e => e.stopPropagation());
    this.input.addEventListener('keydown', e => {
      if (e.key === 'Enter') this.submit();
      else if (e.key === 'Escape') {
        e.stopPropagation();
        this.cancel();
      }
    });
    this.el = div('row', span('row-k', 'Cheats'), div('stepper', this.input, this.state));
    this.refresh();
  }

  refresh(): void {
    this.state.textContent = cheatsOn() ? 'Disable cheats' : this.asking ? 'Enter' : 'Enable cheats';
  }

  cancel(): void {
    this.asking = false;
    this.input.hidden = true;
    this.input.value = '';
    this.input.blur();
    this.refresh();
  }

  private submit(): void {
    if (!isCheatPassword(this.input.value)) {
      this.say('Wrong password.');
      this.play('ui_back');
      return;
    }
    this.cancel();
    setCheats(true);
    this.say('Cheats on. ` opens the panel in a run. Runs are unranked.');
    this.play('ui_confirm');
    this.refresh();
  }

  activate(): void {
    if (cheatsOn()) {
      setCheats(false);
      this.say('Cheats off.');
      this.refresh();
    } else if (this.asking) this.submit();
    else {
      this.asking = true;
      this.input.hidden = false;
      this.input.focus();
      this.refresh();
    }
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
    const sensitivity = new Slider('Mouse sensitivity', ...SENSITIVITY_RANGE, 0.05, () => s.sensitivity, v => { s.sensitivity = v; }, v => v.toFixed(2), tick, SENSITIVITY_CURVE);
    const fov = new Slider('Field of view', ...FOV_RANGE, 1, () => s.fov, v => { s.fov = v; }, v => `${v}`, tick);
    const invert = new Stepper('Invert mouse', ['Off', 'On'], () => (s.invertY ? 1 : 0), v => { s.invertY = v === 1; }, tick);
    const hop = new Stepper('Hold jump to hop', ['Off', 'On'], () => (s.holdToHop ? 1 : 0), v => { s.holdToHop = v === 1; }, tick);
    const aimMode = new Stepper('Aim down sights', ['Toggle', 'Hold'], () => (s.aimHold ? 1 : 0), v => { s.aimHold = v === 1; }, tick);
    const aimSens = new Slider('Aim sensitivity', ...AIM_SENSITIVITY_RANGE, 0.05, () => s.aimSensitivity, v => { s.aimSensitivity = v; }, v => v.toFixed(2), tick);
    const master = new Slider('Master volume', 0, 1, 0.05, () => s.master, v => { s.master = v; }, pct, tick);
    const sfx = new Slider('Effects volume', 0, 1, 0.05, () => s.sfx, v => { s.sfx = v; }, pct, tick);
    const music = new Slider('Music volume', 0, 1, 0.05, () => s.music, v => { s.music = v; }, pct, tick);
    const quality = new Stepper('Graphics quality', QUALITY_LEVELS, () => s.quality, v => { s.quality = v; }, qualityTick);
    const gore = new Stepper('Gore', GORE_LEVELS, () => s.gore, v => { s.gore = v; }, tick);
    const mess = new Stepper('Mess', MESS_NAMES, () => s.mess, v => { s.mess = v; }, tick);
    const puffAll = new Stepper('All blood puffs', BLOOD_PUFF_LABELS, () => s.bloodPuffScale, v => { s.bloodPuffScale = v; }, tick);
    const puffBullet = new Stepper('Regular bullets', BLOOD_PUFF_LABELS, () => s.bloodPuffBullet, v => { s.bloodPuffBullet = v; }, tick);
    const puffShotgun = new Stepper('Shotgun blasts', BLOOD_PUFF_LABELS, () => s.bloodPuffShotgun, v => { s.bloodPuffShotgun = v; }, tick);
    const puffHeadshot = new Stepper('Headshot hits', BLOOD_PUFF_LABELS, () => s.bloodPuffHeadshot, v => { s.bloodPuffHeadshot = v; }, tick);
    const puffHeadburst = new Stepper('Head bursts & decap', BLOOD_PUFF_LABELS, () => s.bloodPuffHeadburst, v => { s.bloodPuffHeadburst = v; }, tick);
    const puffLimb = new Stepper('Limb bursts', BLOOD_PUFF_LABELS, () => s.bloodPuffLimb, v => { s.bloodPuffLimb = v; }, tick);
    const puffBlowout = new Stepper('Torso blowouts', BLOOD_PUFF_LABELS, () => s.bloodPuffBlowout, v => { s.bloodPuffBlowout = v; }, tick);
    const puffGib = new Stepper('Full-body gibs', BLOOD_PUFF_LABELS, () => s.bloodPuffGib, v => { s.bloodPuffGib = v; }, tick);
    const suppression = new Stepper('Suppression effects', ['Off', 'On'], () => (s.suppression ? 1 : 0), v => { s.suppression = v === 1; }, tick);
    const hitText = new Stepper('Hit text', HIT_TEXT_LEVELS, () => s.hitText, v => { s.hitText = v; }, tick);
    const chatter = new Stepper('Enemy chatter', CHATTER_LEVELS, () => s.chatter, v => { s.chatter = v; }, tick);
    const voices = new Slider('Enemy voices', 0, 1, 0.05, () => s.voices, v => { s.voices = v; }, pct, tick);
    const hudAll = new Stepper('Show HUD', ['Off', 'On'], () => (s.hud ? 1 : 0), v => { s.hud = v === 1; }, tick);
    const hudCrosshair = new Stepper('Crosshair', ['Off', 'On'], () => (s.hudCrosshair ? 1 : 0), v => { s.hudCrosshair = v === 1; }, tick);
    const hudVitals = new Stepper('Vitals & armor', ['Off', 'On'], () => (s.hudVitals ? 1 : 0), v => { s.hudVitals = v === 1; }, tick);
    const hudWeapons = new Stepper('Weapons & ammo', ['Off', 'On'], () => (s.hudWeapons ? 1 : 0), v => { s.hudWeapons = v === 1; }, tick);
    const hudMinimap = new Stepper('Minimap & radar', ['Off', 'On'], () => (s.hudMinimap ? 1 : 0), v => { s.hudMinimap = v === 1; }, tick);
    const hudScore = new Stepper('Wave, score & combo', ['Off', 'On'], () => (s.hudScore ? 1 : 0), v => { s.hudScore = v === 1; }, tick);
    const hudFeeds = new Stepper('Kill & radio feeds', ['Off', 'On'], () => (s.hudFeeds ? 1 : 0), v => { s.hudFeeds = v === 1; }, tick);
    const hudMarkers = new Stepper('World markers', ['Off', 'On'], () => (s.hudMarkers ? 1 : 0), v => { s.hudMarkers = v === 1; }, tick);
    const reports = new Stepper('Anonymous error reports', ['Off', 'On'], () => reporter.enabled() ? 1 : 0, v => reporter.setEnabled(v === 1), () => {});
    this.cheatRow = new CheatRow(text => this.note.set(text), id => this.ctx.audio.play?.(id));
    const general = [sensitivity, fov, invert, hop, aimMode, aimSens, master, sfx, music, voices, quality, suppression, hitText, chatter];
    const goreRows = [gore, mess, puffAll, puffBullet, puffShotgun, puffHeadshot, puffHeadburst, puffLimb, puffBlowout, puffGib];
    const hudRows = [hudAll, hudCrosshair, hudVitals, hudWeapons, hudMinimap, hudScore, hudFeeds, hudMarkers];
    this.refreshers = [...general, ...goreRows, ...hudRows, reports].map(r => () => r.refresh());
    const keys = this.keyRows();
    const resetKeys = menuButton('Reset keys', () => this.resetKeys());
    resetKeys.el.classList.add('mi-small');
    const keyRows = [...keys.rows, resetKeys];
    this.panels = [
      {
        el: div('gd-panel', div('set-list',
          span('gd-h', 'Controls and view'), sensitivity.el, fov.el, invert.el, hop.el, aimMode.el, aimSens.el,
          span('gd-h', 'Audio'), master.el, sfx.el, music.el, voices.el,
          span('gd-h', 'Video'), quality.el, suppression.el, hitText.el, chatter.el,
          span('gd-h', 'Cheats'), this.cheatRow.el,
        )),
        rows: [...general, this.cheatRow],
      },
      {
        el: div('gd-panel', div('set-list',
          span('gd-h', 'Gore & mess'), gore.el, mess.el,
          span('gd-h', 'Blood puff sizes'), puffAll.el, puffBullet.el, puffShotgun.el, puffHeadshot.el, puffHeadburst.el, puffLimb.el, puffBlowout.el, puffGib.el,
        )),
        rows: goreRows,
      },
      {
        el: div('gd-panel', div('set-list',
          span('gd-h', 'HUD visibility'), hudAll.el,
          span('gd-h', 'HUD elements'), hudCrosshair.el, hudVitals.el, hudWeapons.el, hudMinimap.el, hudScore.el, hudFeeds.el, hudMarkers.el,
        )),
        rows: hudRows,
      },
      { el: div('gd-panel', keys.el, resetKeys.el), rows: keyRows },
      { el: div('gd-panel', span('gd-h', 'Privacy'), reports.el,
        h('p', 'nt-p', 'Anonymous error reports help fix crashes and connection problems. Reports contain game version, browser and OS families, anonymous session and lobby identifiers, error codes and technical details. No names, passwords or network addresses are sent. Central reports expire after 30 days. The last 50 reports stay on this device for copying; switching this off clears that history.'),
      ), rows: [reports] },
    ];

    this.tabs = ['General', 'Gore', 'HUD', 'Keys', 'Privacy'].map((label, i) => {
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
  private cheatRow: CheatRow;

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
    this.cheatRow.cancel();
    this.select(0);
    for (const fn of this.keyRefreshers) fn();
  }
}
