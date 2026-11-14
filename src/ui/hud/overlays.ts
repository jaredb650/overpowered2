/** Full-screen modes: the scope, call-in targeting and the low-health frame. */
import type { Ctx } from '../../core/contracts';
import type { CallInId, WeaponId } from '../../core/gameplay';
import { CALLINS as CALLIN_DEFS } from '../../progression/data';
import { Flag, Label, Num, Shown, div, markup, span } from '../dom';
import { CALLINS } from '../data';
import { callInIcon } from '../icons';
import type { Settings } from '../settings';
import type { HudState } from '../state';

const RANGE_RATE = 1 / 10;

/**
 * A scoped gun with a reticle of its own; any other keeps the plain red cross. Drawn in a 600-unit box over the 60rem
 * port, so 10 units are 1rem.
 */
const RETICLES: Partial<Record<WeaponId, { tag: string; svg: string }>> = {
  // Heavy and simple for a lobbed shell: thick posts, a chevron to lay on the target, and a drop ladder under it.
  autocannon: {
    tag: 'shells',
    svg: `<svg class="sc-ret" viewBox="-300 -300 600 600" fill="none" stroke="currentColor">
      <path stroke-width="12" d="M-300 0H-70M70 0H300M0 300V238"/>
      <path stroke-width="5" stroke-linejoin="miter" d="M-34 34L0 0L34 34"/>
      <path stroke-width="2.5" d="M0 40V238M-22 60H22M-18 100H18M-14 150H14M-10 210H10"/>
      <g fill="currentColor" stroke="none" font-size="17" font-weight="700" font-family="monospace">
        <text x="30" y="66">2</text><text x="26" y="106">4</text><text x="22" y="156">6</text><text x="18" y="216">8</text>
      </g>
    </svg>`,
  },
  // A sniper's: hairline cross, mil dots out to five, a fine centre dot, thin posts at the rim.
  sabot: {
    tag: 'darts',
    svg: `<svg class="sc-ret" viewBox="-300 -300 600 600" fill="none" stroke="currentColor">
      <path stroke-width="1.2" d="M-200 0H-8M8 0H200M0 -200V-8M0 8V200"/>
      <path stroke-width="4" d="M-300 0H-200M200 0H300M0 -300V-200M0 200V300"/>
      <g fill="currentColor" stroke="none">${[1, 2, 3, 4, 5].flatMap(i => [[i, 0], [-i, 0], [0, i], [0, -i]])
        .map(([x, y]) => `<circle cx="${x! * 34}" cy="${y! * 34}" r="2.6"/>`).join('')}<circle r="1.8"/></g>
    </svg>`,
  },
};

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
  private zoom: Label;
  private tag: Label;
  private reticle: WeaponId | null = null;
  private reticles = new Map<WeaponId, HTMLElement>();
  private clock = 0;

  constructor(private readonly ctx: Ctx, private readonly settings: Settings) {
    const range = span('sc-val');
    const mag = span('sc-val');
    const zoom = span('sc-tag');
    const tag = span('sc-tag', 'shells');
    for (const [id, r] of Object.entries(RETICLES)) this.reticles.set(id as WeaponId, markup(r.svg));
    const rangeRow = div('sc-read sc-range', span('sc-tag', 'range'), range, span('sc-tag', 'm'));
    this.el = div('scope',
      div('sc-mask'),
      div('sc-line sc-h'),
      div('sc-line sc-v'),
      div('sc-dot'),
      div('sc-mils sc-mils-h'),
      div('sc-mils sc-mils-v'),
      ...this.reticles.values(),
      rangeRow,
      div('sc-read sc-mag', tag, mag),
      div('sc-read sc-zoom', zoom),
    );
    this.shown = new Shown(this.el, 'block');
    this.range = new Num(range);
    this.mag = new Num(mag);
    this.rangeShown = new Shown(rangeRow, 'flex');
    this.zoom = new Label(zoom);
    this.tag = new Label(tag);
    this.shown.set(false);
  }

  update(s: HudState, dt: number): void {
    this.shown.set(s.scoped);
    if (!s.scoped) return;
    if (s.weapon !== this.reticle) this.pickReticle(s.weapon);
    this.mag.set(s.mag);
    this.clock -= dt;
    if (this.clock > 0) return;
    this.clock = RANGE_RATE;
    const half = (deg: number) => Math.tan((deg * Math.PI) / 360);
    const fov = this.ctx.camera.fov;
    if (typeof fov === 'number') this.zoom.set(`x${(half(this.settings.fov) / half(fov)).toFixed(1)}`);
    const d = rangeTo(this.ctx, 500);
    this.rangeShown.set(d > 0);
    this.range.set(Math.round(d));
  }

  /** Shows the gun's own reticle, or the plain cross with `data-reticle` unset. */
  private pickReticle(id: WeaponId): void {
    this.reticle = id;
    const own = RETICLES[id];
    if (own) this.el.dataset.reticle = id;
    else delete this.el.dataset.reticle;
    for (const [rid, el] of this.reticles) el.style.display = rid === id ? 'block' : 'none';
    this.tag.set(own?.tag ?? 'shells');
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
  private danger: Flag;
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
      div('tg-danger', 'DANGER CLOSE'),
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
    this.danger = new Flag(this.el, 'danger');
    this.shown.set(false);
  }

  update(s: HudState, dt: number): void {
    this.shown.set(s.targeting !== null);
    this.danger.set(s.dangerClose);
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
      this.hint.set(CALLIN_DEFS[s.targeting].hint);
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
