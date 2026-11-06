/**
 * Active perk stack. Each row is its own countdown: the colour plate drains away from the right and the label
 * inverts as the edge passes it, so the amount of colour left on screen is the time left. Rows are pooled and keyed
 * by id, and each id has its own motion in css/perks.css. Layout comes from a flex column, which fixes the first
 * game's overlapping labels.
 */
import { COLLAPSE, Flag, Label, Tenths, div, span } from '../dom';
import type { ActiveEffect } from '../../core/gameplay';
import type { HudState } from '../state';

const MAX_ROWS = 12;
/** Under this the row starts to look worried. */
const EXPIRING = 2;

class Row {
  readonly el: HTMLElement;
  id: string | null = null;
  seen = false;
  leaving = 0;
  private clip: HTMLElement;
  private front: HTMLElement;
  private timer: Tenths;
  private labels: Label[];
  private stacks: Label[];
  private expiring: Flag;
  private q = -1;
  private lastLabel = '';
  private lastStacks = -1;

  constructor() {
    const parts = () => {
      const label = span('pk-l');
      const stacks = span('pk-s');
      const time = span('pk-t');
      return { label, stacks, time, box: div('pk-face', label, stacks, time) };
    };
    const back = parts();
    const top = parts();
    top.box.classList.add('pk-front');
    this.front = top.box;
    this.clip = div('pk-clip', top.box);
    this.el = div('pk', back.box, this.clip);
    this.el.style.display = 'none';
    this.timer = new Tenths([back.time, top.time]);
    this.labels = [new Label(back.label), new Label(top.label)];
    this.stacks = [new Label(back.stacks), new Label(top.stacks)];
    this.expiring = new Flag(this.el, 'expiring');
  }

  assign(e: ActiveEffect): void {
    this.id = e.id;
    this.leaving = 0;
    this.el.dataset.id = e.id;
    this.el.style.setProperty('--c', e.color);
    this.el.style.display = '';
    this.lastLabel = '';
    this.lastStacks = -1;
    this.q = -1;
    // Peak on frame one: the row lands oversized and white-hot, then settles to its own motion.
    this.el.animate(
      [{ transform: 'scale(1.3)', filter: 'brightness(2.4)', easing: 'cubic-bezier(.1,.9,.2,1)' }, { transform: 'scale(1)', filter: 'brightness(1)' }],
      220,
    );
  }

  update(e: ActiveEffect): void {
    if (e.label !== this.lastLabel) {
      this.lastLabel = e.label;
      for (const l of this.labels) l.set(e.label);
    }
    if (e.stacks !== this.lastStacks) {
      this.lastStacks = e.stacks;
      const t = e.stacks > 1 ? `x${e.stacks}` : '';
      for (const l of this.stacks) l.set(t);
    }
    this.timer.set(e.remaining);
    this.expiring.set(e.remaining < EXPIRING);
    const frac = e.duration > 0 ? e.remaining / e.duration : 1;
    const q = Math.round((1 - frac) * 500);
    if (q !== this.q) {
      this.q = q;
      const p = q / 5;
      this.clip.style.transform = `translate3d(${-p}%,0,0)`;
      this.front.style.transform = `translate3d(${p}%,0,0)`;
    }
  }

  release(): void {
    this.id = null;
    this.el.style.display = 'none';
    this.el.removeAttribute('data-id');
  }
}

export class Perks {
  readonly el: HTMLElement;
  private rows: Row[] = [];

  constructor() {
    this.el = div('perks');
    for (let i = 0; i < MAX_ROWS; i++) {
      const row = new Row();
      this.rows.push(row);
      this.el.append(row.el);
    }
  }

  private find(id: string): Row | null {
    for (const row of this.rows) if (row.id === id) return row;
    return null;
  }

  update(s: HudState, dt: number): void {
    for (const row of this.rows) row.seen = false;
    for (const e of s.effects) {
      if (e.remaining <= 0 && e.duration > 0) continue;
      let row = this.find(e.id);
      if (!row) {
        row = this.rows.find(r => r.id === null) ?? null;
        if (!row) continue;
        // Keep rows in activation order on screen, whichever pool slot was free.
        this.el.append(row.el);
        row.assign(e);
      }
      row.seen = true;
      row.leaving = 0;
      row.update(e);
    }
    for (const row of this.rows) {
      if (row.id === null || row.seen) continue;
      if (row.leaving === 0) {
        row.leaving = 0.12;
        row.el.animate(COLLAPSE as unknown as Keyframe[], 120);
      } else {
        row.leaving -= dt;
        if (row.leaving <= 0) row.release();
      }
    }
  }

  reset(): void {
    for (const row of this.rows) if (row.id !== null) row.release();
  }
}
