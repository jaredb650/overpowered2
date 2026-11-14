/**
 * The Crucible's rules, opened from the main menu. The settings sheet's rail, rows, sliders and steppers, on the same keys
 * and mouse. Every change is checked, saved and shown at once, and the next Crucible run plays it (contracts/crucible.ts).
 * Any rule off its default makes those runs unranked, and the rail says so.
 *
 * A change that would leave the first wave with no enemy type is refused with a note, not repaired behind the player's
 * back. The model's own repairs (enemies/rules.ts) are for a stored blob that is broken.
 */
import { loadRules, resetRules, saveRules } from '../../contracts/crucible';
import type { Ctx } from '../../core/contracts';
import {
  COUNT_LIMIT, DEFAULT_RULES, EVERY_LIMIT, RULE_LIMITS, SWARM_IDS, WAVE_LIMIT, bossesFor, cloneRules, firstEnemyWave, isCustom, rulesEqual,
  type BossRule, type CrucibleRules, type Limit, type NumberRule,
} from '../../enemies/rules';
import { ENEMY_NAMES } from '../data';
import { Flag, Label, Shown, div, span } from '../dom';
import type { Hud } from '../Hud';
import type { Nav, NavItem } from './nav';
import { menuButton } from './parts';
import type { Screen } from './Screens';
import { Slider } from './settingsScreen';

type Sound = 'ui_slider' | 'ui_toggle';

interface StepperSpec {
  limit: Limit;
  read(r: CrucibleRules): number;
  write(r: CrucibleRules, v: number): void;
  format(v: number): string;
  /** The row can be off. Enter turns it off and on, and Left or Right on an off row turns it back on where it was. */
  on?: { read(r: CrucibleRules): boolean; write(r: CrucibleRules, on: boolean): void };
  /** Shown dim, as a boss's cadence is while that boss is off. */
  dim?(r: CrucibleRules): boolean;
}

/** The settings Stepper's row, over a range rather than a list: it stops at the ends, and both arrows take a click. */
class RuleStepper implements NavItem {
  readonly el: HTMLElement;
  private text: Label;
  private off: Flag;
  private changed: Flag;

  constructor(label: string, private readonly spec: StepperSpec, private readonly screen: RulesScreen) {
    const value = span('st-val');
    const back = span('st-arrow', '<');
    const next = span('st-arrow', '>');
    this.el = div('row', span('row-k', label), div('stepper', back, value, next));
    this.text = new Label(value);
    this.off = new Flag(this.el, 'off');
    this.changed = new Flag(this.el, 'changed');
    back.addEventListener('click', e => {
      e.stopPropagation();
      this.adjust(-1);
    });
    next.addEventListener('click', e => {
      e.stopPropagation();
      this.adjust(1);
    });
  }

  private isOn(r: CrucibleRules): boolean {
    return this.spec.on?.read(r) ?? true;
  }

  refresh(r: CrucibleRules): void {
    const on = this.isOn(r);
    this.text.set(on ? this.spec.format(this.spec.read(r)) : 'Off');
    this.off.set(!on || this.spec.dim?.(r) === true);
    this.changed.set(on !== this.isOn(DEFAULT_RULES) || this.spec.read(r) !== this.spec.read(DEFAULT_RULES));
  }

  adjust(dir: -1 | 1): boolean {
    const r = this.screen.rules;
    const toggle = this.spec.on;
    if (toggle && !toggle.read(r)) {
      this.screen.edit(n => toggle.write(n, true), 'ui_toggle');
      return true;
    }
    const { min, max, step } = this.spec.limit;
    const v = this.spec.read(r);
    const next = Math.min(max, Math.max(min, v + dir * step));
    if (next !== v) this.screen.edit(n => this.spec.write(n, next), 'ui_slider');
    return true;
  }

  activate(): void {
    const toggle = this.spec.on;
    if (!toggle) {
      this.adjust(1);
      return;
    }
    const on = toggle.read(this.screen.rules);
    this.screen.edit(n => toggle.write(n, !on), 'ui_toggle');
  }
}

const wave = (v: number): string => `Wave ${v}`;
const every = (v: number): string => (v === 0 ? 'Once' : v === 1 ? 'Every wave' : `${v} waves`);
const pct = (v: number): string => `${v}%`;
const secs = (v: number): string => `${v} s`;

/** How far ahead the rail's boss plan looks, and how many of each it lists. */
const PLAN_WAVES = 100;
const PLAN_SHOWN = 5;

export class RulesScreen implements Screen {
  readonly el: HTMLElement;
  /** What is stored, as last checked. Never edited in place: every change works on a copy. */
  rules: CrucibleRules = DEFAULT_RULES;
  private steppers: RuleStepper[] = [];
  private sliders: { slider: Slider; key: NumberRule }[] = [];
  private items: NavItem[];
  private note: Label;
  private stateHead: Label;
  private stateBody: Label;
  private stateCustom: Flag;
  private planJuggernaut: Label;
  private planTitan: Label;
  private warn: Label;
  private warnShown: Shown;

  constructor(private readonly ctx: Ctx, private readonly hud: Hud) {
    const boss = (name: 'juggernaut' | 'titan', label: string): [RuleStepper, RuleStepper] => {
      const get = (r: CrucibleRules): BossRule => r[name];
      const off = (r: CrucibleRules) => !get(r).on;
      return [
        this.stepper(`${label} from`, {
          limit: WAVE_LIMIT, format: wave,
          read: r => get(r).first, write: (r, v) => { get(r).first = v; },
          on: { read: r => get(r).on, write: (r, on) => { get(r).on = on; } },
        }),
        this.stepper(`${label} every`, {
          limit: EVERY_LIMIT, format: every, dim: off,
          read: r => get(r).every, write: (r, v) => { get(r).every = v; },
        }),
      ];
    };
    const [jugFrom, jugEvery] = boss('juggernaut', 'Juggernaut');
    const jugCount = this.stepper('Juggernaut count', {
      limit: COUNT_LIMIT, format: v => (v === 0 ? 'Growing' : String(v)), dim: r => !r.juggernaut.on,
      read: r => r.juggernaut.count, write: (r, v) => { r.juggernaut.count = v; },
    });
    const [titanFrom, titanEvery] = boss('titan', 'Titan');
    const start = this.stepper('Start at wave', {
      limit: RULE_LIMITS.startWave, format: wave,
      read: r => r.startWave, write: (r, v) => { r.startWave = v; },
    });
    const size = this.slider('Wave size', 'sizePct', pct);
    const escort = this.slider('Escort on boss waves', 'escortPct', pct);
    const alive = this.slider('Most alive at once', 'maxAlive', v => String(v));
    const pause = this.slider('Break between waves', 'breakSeconds', secs);
    const bossPause = this.slider('Break after a boss', 'bossBreakSeconds', secs);
    const feed = this.slider('Spawn speed', 'feedPct', pct);
    const health = this.slider('Enemy health', 'healthPct', pct);
    const damage = this.slider('Enemy damage', 'damagePct', pct);
    const helmets = this.slider('Helmets on Gunners and Rocketeers', 'helmetsFrom', v => (v === 0 ? 'Never' : wave(v)));
    const types = SWARM_IDS.map(id => this.stepper(ENEMY_NAMES[id], {
      limit: WAVE_LIMIT, format: wave,
      read: r => r.types[id].from, write: (r, v) => { r.types[id].from = v; },
      on: { read: r => r.types[id].on, write: (r, on) => { r.types[id].on = on; } },
    }));

    const defaults = menuButton('Defaults', () => this.restore());
    defaults.el.classList.add('mi-small');
    const back = menuButton('Back', () => this.hud.screens.show('menu'));
    back.el.classList.add('mi-small');
    const left: NavItem[] = [jugFrom, jugEvery, jugCount, titanFrom, titanEvery, start, size, escort, alive, pause, bossPause, feed, health, damage, helmets];
    this.items = [...left, ...types, defaults, back];

    const note = span('set-note');
    const head = span('rl-state-k');
    const body = span('rl-state-v');
    const state = div('rl-state', head, body);
    const planJ = span('rl-plan-v');
    const planT = span('rl-plan-v');
    const warn = span('rl-warn');
    this.el = div('scr scr-sheet scr-rules',
      div('sh-side',
        span('sh-title', 'Rules'),
        span('rl-sub', 'The Crucible'),
        state,
        div('rl-plan', span('rl-plan-k', 'Juggernaut'), planJ, span('rl-plan-k', 'Titan'), planT),
        span('rl-hint', 'Growing is one Juggernaut, and one more every 15 waves. A wave both bosses share brings the Titan alone.'),
        warn,
        div('fill'),
        note,
        defaults.el,
        back.el,
      ),
      div('sh-body', div('gd-panel gd-cols',
        div('set-list rl-col',
          span('gd-h', 'Bosses'), jugFrom.el, jugEvery.el, jugCount.el, titanFrom.el, titanEvery.el,
          span('gd-h', 'Waves'), start.el, size.el, escort.el, alive.el, pause.el, bossPause.el, feed.el,
          span('gd-h', 'Toughness'), health.el, damage.el,
        ),
        div('set-list rl-col',
          span('gd-h', 'Enemies'),
          span('rl-col-note', 'The wave each type first comes in. Enter turns one off.'),
          ...types.map(t => t.el),
        ),
      )),
    );
    this.note = new Label(note);
    this.stateHead = new Label(head);
    this.stateBody = new Label(body);
    this.stateCustom = new Flag(state, 'custom');
    this.planJuggernaut = new Label(planJ);
    this.planTitan = new Label(planT);
    this.warn = new Label(warn);
    this.warnShown = new Shown(warn, 'block');
  }

  private stepper(label: string, spec: StepperSpec): RuleStepper {
    const s = new RuleStepper(label, spec, this);
    this.steppers.push(s);
    return s;
  }

  private slider(label: string, key: NumberRule, format: (v: number) => string): Slider {
    const { min, max, step } = RULE_LIMITS[key];
    const slider = new Slider(label, min, max, step, () => this.rules[key], v => this.edit(r => { r[key] = v; }, null), format,
      () => this.ctx.audio.play?.('ui_slider'));
    this.sliders.push({ slider, key });
    return slider;
  }

  /** Why `next` cannot be played, or null. */
  private refusal(next: CrucibleRules): string | null {
    if (!SWARM_IDS.some(id => next.types[id].on)) return 'One enemy type must stay on.';
    if (firstEnemyWave(next) > next.startWave) return `Wave ${next.startWave} would be empty. Bring a type in by then.`;
    return null;
  }

  /** One change, on a copy: refused with a note, or checked, saved and shown. `sound` null leaves it to a slider. */
  edit(change: (r: CrucibleRules) => void, sound: Sound | null): boolean {
    const next = cloneRules(this.rules);
    change(next);
    const refused = this.refusal(next);
    if (refused) {
      this.note.set(refused);
      this.ctx.audio.play?.('ui_error');
      this.refresh();
      return false;
    }
    if (rulesEqual(next, this.rules)) return false;
    this.rules = saveRules(next);
    this.note.set('');
    if (sound) this.ctx.audio.play?.(sound);
    this.refresh();
    return true;
  }

  private restore(): void {
    resetRules();
    this.rules = DEFAULT_RULES;
    this.refresh();
    this.note.set('Standard rules restored.');
    this.ctx.audio.play?.('ui_confirm');
  }

  private refresh(): void {
    const r = this.rules;
    for (const s of this.steppers) s.refresh(r);
    for (const { slider, key } of this.sliders) {
      slider.refresh();
      slider.el.classList.toggle('changed', r[key] !== DEFAULT_RULES[key]);
    }
    const custom = isCustom(r);
    this.stateCustom.set(custom);
    this.stateHead.set(custom ? 'Custom rules' : 'Standard rules');
    this.stateBody.set(custom ? 'Unranked. Runs on these never read or set the high score.' : 'Ranked. Runs count for the high score.');
    this.paintPlan(r);
    this.warnShown.set(r.startWave > 1);
    if (r.startWave > 1) {
      this.warn.set(`Enemies start as tough as wave ${r.startWave}, and you carry only the starting guns until the first supply drop.`);
    }
  }

  /** The next few boss waves from the start, as the run will meet them. */
  private paintPlan(r: CrucibleRules): void {
    const jugs: string[] = [];
    const titans: string[] = [];
    let moreJ = false;
    let moreT = false;
    for (let w = r.startWave; w < r.startWave + PLAN_WAVES; w++) {
      const bosses = bossesFor(w, r);
      if (bosses.length === 0) continue;
      if (bosses[0] === 'titan') {
        if (titans.length < PLAN_SHOWN) titans.push(String(w));
        else moreT = true;
      } else if (jugs.length < PLAN_SHOWN) jugs.push(bosses.length > 1 ? `${w} x${bosses.length}` : String(w));
      else moreJ = true;
    }
    const list = (waves: string[], more: boolean) => (waves.length ? waves.join(', ') + (more ? ' ...' : '') : 'None');
    this.planJuggernaut.set(list(jugs, moreJ));
    this.planTitan.set(list(titans, moreT));
  }

  open(nav: Nav): void {
    this.rules = loadRules();
    this.note.set('');
    this.refresh();
    nav.set(this.items, 0);
    nav.back = () => this.hud.screens.show('menu');
    // The menu's tab cycle must not stay live behind this screen.
    nav.left = nav.right = null;
  }
}
