/** Full-screen modes: the autocannon scope, call-in targeting and the low-health frame. */
import type { Ctx } from '../../core/contracts';
import type { CallInId } from '../../core/gameplay';
import { Flag, Label, Num, Shown, div, markup, span } from '../dom';
import { CALLINS } from '../data';
import { callInIcon } from '../icons';
import type { HudState } from '../state';

const RANGE_RATE = 1 / 10;

/** Distance to whatever the crosshair is on, refreshed a few times a second. */
function rangeTo(ctx: Ctx, maxDist: number): number {
  const { player, physics } = ctx;
  if (typeof physics.raycast !== 'function') return 0;
  const hit = physics.raycast(player.eye, player.forward, maxDist);
  return hit && typeof hit.distance === 'number' ? hit.distance : 0;
}

export class Scope {
  readonly el: HTMLElement;
  private shown: Shown;
  private range: Num;
  private mag: Num;
  private rangeShown: Shown;
  private clock = 0;

  constructor(private readonly ctx: Ctx) {
    const range = span('sc-val');
    const mag = span('sc-val');
    const rangeRow = div('sc-read sc-range', span('sc-tag', 'range'), range, span('sc-tag', 'm'));
    this.el = div('scope',
      div('sc-mask'),
      div('sc-line sc-h'),
      div('sc-line sc-v'),
      div('sc-dot'),
      div('sc-mils sc-mils-h'),
      div('sc-mils sc-mils-v'),
      rangeRow,
      div('sc-read sc-mag', span('sc-tag', 'shells'), mag),
      div('sc-read sc-zoom', span('sc-tag', 'x2.9')),
    );
    this.shown = new Shown(this.el, 'block');
    this.range = new Num(range);
    this.mag = new Num(mag);
    this.rangeShown = new Shown(rangeRow, 'flex');
    this.shown.set(false);
  }

  update(s: HudState, dt: number): void {
    this.shown.set(s.scoped);
    if (!s.scoped) return;
    this.mag.set(s.mag);
    this.clock -= dt;
    if (this.clock > 0) return;
    this.clock = RANGE_RATE;
    const d = rangeTo(this.ctx, 500);
    this.rangeShown.set(d > 0);
    this.range.set(Math.round(d));
  }
}

export class Targeting {
  readonly el: HTMLElement;
  private shown: Shown;
  private name: Label;
  private hint: Label;
  private range: Num;
  private radius: Num;
  private iconHost: HTMLElement;
  private rangeShown: Shown;
  private current: CallInId | null = null;
  private clock = 0;

  constructor(private readonly ctx: Ctx) {
    const name = span('tg-name');
    const hint = span('tg-hint');
    const range = span('tg-val');
    const radius = span('tg-val');
    this.iconHost = div('tg-icon');
    const rangeRow = div('tg-read', span('tg-tag', 'range'), range, span('tg-tag', 'm'));
    this.el = div('targeting',
      div('tg-frame tg-tl'), div('tg-frame tg-tr'), div('tg-frame tg-bl'), div('tg-frame tg-br'),
      div('tg-reticle',
        div('tg-ring'),
        div('tg-cross tg-ch'), div('tg-cross tg-cv'),
      ),
      div('tg-plate',
        this.iconHost,
        name,
      ),
      div('tg-readout',
        rangeRow,
        div('tg-read', span('tg-tag', 'blast'), radius, span('tg-tag', 'm')),
      ),
      div('tg-keys', hint),
    );
    this.shown = new Shown(this.el, 'block');
    this.name = new Label(name);
    this.hint = new Label(hint);
    this.range = new Num(range);
    this.radius = new Num(radius);
    this.rangeShown = new Shown(rangeRow, 'flex');
    this.shown.set(false);
  }

  update(s: HudState, dt: number): void {
    this.shown.set(s.targeting !== null);
    if (s.targeting === null) {
      this.current = null;
      return;
    }
    if (s.targeting !== this.current) {
      this.current = s.targeting;
      const info = CALLINS[s.targeting];
      this.el.style.setProperty('--c', info.color);
      this.iconHost.replaceChildren(markup(callInIcon(s.targeting)));
      this.name.set(info.name);
      this.radius.set(info.radius);
      this.hint.set('click to confirm, right click to cancel');
    }
    this.clock -= dt;
    if (this.clock > 0) return;
    this.clock = RANGE_RATE;
    const d = rangeTo(this.ctx, 600);
    this.rangeShown.set(d > 0);
    this.range.set(Math.round(d));
  }
}

/** Hard corner brackets on top of the renderer's soft vignette, because a vignette alone hides behind bright FX. */
export class LowFrame {
  readonly el: HTMLElement;
  private low: Flag;
  private critical: Flag;

  constructor() {
    this.el = div('lowframe', div('lf lf-tl'), div('lf lf-tr'), div('lf lf-bl'), div('lf lf-br'));
    this.low = new Flag(this.el, 'on');
    this.critical = new Flag(this.el, 'critical');
  }

  update(s: HudState): void {
    const frac = s.health / s.maxHealth;
    this.low.set(s.alive && frac < 0.35);
    this.critical.set(s.alive && frac < 0.18);
  }
}
