/** Health and armor. Bars are ingots: a slanted mask over plain scaled fills, so losing health is one transform. */
import { clamp, damp } from '../../core/math';
import { Flag, Meter, Num, Shown, div, span } from '../dom';
import type { HudState } from '../state';

const LOW = 0.35;
const CRITICAL = 0.18;
/** How long the white damage chunk holds before it falls, so the size of a hit stays readable. */
const LAG_HOLD = 0.28;

class Bar {
  readonly el: HTMLElement;
  private fill: Meter;
  private lag: Meter;
  private lagValue = 1;
  private lagWait = 0;

  constructor(cls: string, readonly over?: Meter) {
    const lag = div('bar-lag');
    const fill = div('bar-fill');
    this.el = div(`bar ${cls}`, div('bar-back'), lag, fill, over?.el);
    this.fill = new Meter(fill);
    this.lag = new Meter(lag);
  }

  update(value: number, dt: number): void {
    this.fill.set(value);
    if (value >= this.lagValue) {
      this.lagValue = value;
      this.lagWait = LAG_HOLD;
    } else if (this.lagWait > 0) {
      this.lagWait -= dt;
    } else {
      this.lagValue = damp(this.lagValue, value, 9, dt);
    }
    this.lag.set(this.lagValue);
  }

  reset(value: number): void {
    this.lagValue = value;
    this.lagWait = 0;
  }
}

export class Vitals {
  readonly el: HTMLElement;
  private hp: Num;
  private ap: Num;
  private hpBar: Bar;
  private apBar: Bar;
  private low: Flag;
  private critical: Flag;
  private overheal: Flag;
  private regen: Flag;
  private armored: Shown;
  private regenHold = 0;
  private lastHealth = 100;
  private hitPunch = 0;
  private numEl: HTMLElement;
  private punchQ = -1;

  constructor() {
    const hpNum = span('vit-hp');
    const apNum = span('vit-ap');
    const overFill = div('bar-over');
    this.hpBar = new Bar('bar-hp', new Meter(overFill));
    this.apBar = new Bar('bar-ap');
    const armorRow = div('vit-armor', apNum, this.apBar.el);
    const regen = span('vit-regen', 'regen');
    this.el = div('vitals',
      armorRow,
      div('vit-health',
        hpNum,
        div('vit-col', div('vit-sub', regen), this.hpBar.el),
      ),
    );
    this.numEl = hpNum;
    this.hp = new Num(hpNum);
    this.ap = new Num(apNum);
    this.low = new Flag(this.el, 'low');
    this.critical = new Flag(this.el, 'critical');
    this.overheal = new Flag(this.el, 'overheal');
    this.regen = new Flag(this.el, 'regen');
    this.armored = new Shown(armorRow, 'flex');
  }

  /** Called by the damage event so the number jolts on the frame of the hit. */
  hit(amount: number): void {
    this.hitPunch = clamp(amount / 40, 0.35, 1);
  }

  update(s: HudState, dt: number): void {
    const frac = s.health / s.maxHealth;
    this.hp.set(Math.ceil(Math.max(0, s.health)));
    this.hpBar.update(Math.min(1, frac), dt);
    this.hpBar.over?.set(frac - 1);
    this.ap.set(Math.ceil(s.armor));
    this.apBar.update(s.armor / s.maxArmor, dt);
    this.armored.set(s.armor > 0);

    this.low.set(frac < LOW);
    this.critical.set(frac < CRITICAL);
    this.overheal.set(frac > 1);

    // Pickups jump by 25 or more in one frame, so a small rise can only be the regen tick.
    const rise = s.health - this.lastHealth;
    this.lastHealth = s.health;
    if (rise > 0 && rise < 2) this.regenHold = 0.35;
    else this.regenHold -= dt;
    this.regen.set(this.regenHold > 0 && frac < 1);

    if (this.hitPunch > 0.001) {
      this.hitPunch = damp(this.hitPunch, 0, 16, dt);
      this.punch(this.hitPunch < 0.01 ? 0 : this.hitPunch);
    }
  }

  private punch(amount: number): void {
    const q = Math.round(amount * 50);
    if (q === this.punchQ) return;
    this.punchQ = q;
    this.numEl.style.transform = q === 0 ? '' : `scale(${1 + q / 170}) translateX(${(q / 50) * -0.35}rem)`;
  }

  reset(s: HudState): void {
    this.lastHealth = s.health;
    this.hpBar.reset(1);
    this.apBar.reset(0);
    this.hitPunch = 0;
    this.regenHold = 0;
    this.punch(0);
  }
}
