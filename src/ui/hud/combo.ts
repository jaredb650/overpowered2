/**
 * Combo block, the HUD's one loud thing. Heat tiers run steel, amber, molten, blood, white-hot, and the block is
 * what gets hot: your violence raises the temperature of the panel.
 */
import { damp } from '../../core/math';
import { Flag, Label, Meter, Num, Shown, div, span } from '../dom';
import { LADDER } from '../data';
import type { HudState } from '../state';

/** Combo at which each heat tier starts. Tiers line up with the ladder's rewards. */
const HEAT = [2, 4, 8, 15, 30];

export const heatOf = (combo: number): number => {
  let tier = 0;
  for (let i = 0; i < HEAT.length; i++) if (combo >= HEAT[i]!) tier = i + 1;
  return tier;
};

export class Combo {
  readonly el: HTMLElement;
  private count: Num;
  private mult: Label;
  private bar: Meter;
  private next: Label;
  private nextRow: Shown;
  private visible: Shown;
  private urgent: Flag;
  private numEl: HTMLElement;
  private heat = -1;
  private lastCombo = 0;
  private punch = 0;
  private punchQ = -1;
  private lastMult = -1;
  private ladderIndex = -1;

  constructor() {
    const num = span('cb-num');
    const mult = span('cb-mult');
    const fill = div('cb-fill');
    const next = span('cb-next-t');
    const nextRow = div('cb-next', next);
    this.el = div('combo',
      div('cb-top', span('cb-tag', 'combo'), num, mult),
      div('cb-bar', fill),
      nextRow,
    );
    this.numEl = num;
    this.count = new Num(num);
    this.mult = new Label(mult);
    this.bar = new Meter(fill);
    this.next = new Label(next);
    this.nextRow = new Shown(nextRow);
    this.visible = new Shown(this.el, 'block');
    this.urgent = new Flag(this.el, 'urgent');
  }

  /** Heat tier for the crosshair's combo tick and anything else that wants to match. */
  get tier(): number {
    return Math.max(0, this.heat);
  }

  update(s: HudState, dt: number): void {
    const show = s.combo >= 2;
    this.visible.set(show);

    if (s.combo > this.lastCombo) this.punch = 1;
    this.lastCombo = s.combo;

    const tier = heatOf(s.combo);
    if (tier !== this.heat) {
      if (this.heat >= 0) this.el.classList.remove(`heat-${this.heat}`);
      this.el.classList.add(`heat-${tier}`);
      this.heat = tier;
    }
    if (!show) return;

    this.count.set(s.combo);
    const mq = Math.round(s.multiplier * 10);
    if (mq !== this.lastMult) {
      this.lastMult = mq;
      this.mult.set(`x${(mq / 10).toFixed(1)}`);
    }
    this.bar.set(s.comboTimer);
    this.urgent.set(s.comboTimer < 0.3);

    let index = LADDER.length;
    for (let i = LADDER.length - 1; i >= 0; i--) if (s.combo < LADDER[i]!.combo) index = i;
    if (index !== this.ladderIndex) {
      this.ladderIndex = index;
      const rung = LADDER[index];
      this.nextRow.set(rung !== undefined);
      if (rung) this.next.set(`${rung.combo} ${rung.name}`);
    }

    if (this.punch > 0.002) {
      this.punch = damp(this.punch, 0, 15, dt);
      const q = Math.round(this.punch * 40);
      if (q !== this.punchQ) {
        this.punchQ = q;
        this.numEl.style.transform = q === 0 ? '' : `scale(${1 + q / 80})`;
      }
    }
  }

  reset(): void {
    this.lastCombo = 0;
    this.punch = 0;
    this.ladderIndex = -1;
  }
}
