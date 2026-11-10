/**
 * Wave plate and the score. The score counts up on digit strips that move by transform, and a strip only ever rests on
 * a whole digit. A wheel caught between two digits is a real odometer's look, but at this size, and with the low
 * wheels always mid-turn while points pour in, it read as corrupted text. Motion comes from the digits changing.
 */
import { damp } from '../../core/math';
import { Flag, Label, Num, Shown, div, span } from '../dom';
import type { HudState } from '../state';

const WHEELS = 8;
const ROLL_RATE = 11;
/** What the record line holds while it reads 'custom rules'. No score is negative. */
const CUSTOM = -2;

export class Odometer {
  readonly el: HTMLElement;
  private wheels: HTMLElement[] = [];
  private cells: Flag[] = [];
  private shown: number[] = [];
  private value = 0;
  private target = 0;
  private lit = 0;
  private rolling: Flag;

  constructor(cls = '') {
    this.el = div(`odo ${cls}`);
    for (let i = WHEELS - 1; i >= 0; i--) {
      const strip = div('odo-strip');
      for (let d = 0; d < 10; d++) strip.append(span('', String(d)));
      const cell = div(i % 3 === 0 && i > 0 ? 'odo-cell sep' : 'odo-cell', strip);
      this.el.append(cell);
      this.wheels[i] = strip;
      this.cells[i] = new Flag(cell, 'dim');
      this.shown[i] = -1;
    }
    this.rolling = new Flag(this.el, 'rolling');
  }

  set(score: number): void {
    this.target = Math.max(0, Math.floor(score));
  }

  snap(score: number): void {
    this.target = this.value = Math.max(0, Math.floor(score));
    this.write();
  }

  update(dt: number): void {
    const moving = this.value !== this.target;
    if (moving) {
      this.value = damp(this.value, this.target, ROLL_RATE, dt);
      if (Math.abs(this.target - this.value) < 0.5) this.value = this.target;
      this.write();
    }
    this.lit = moving ? 0.22 : this.lit - dt;
    this.rolling.set(this.lit > 0);
  }

  private write(): void {
    const v = Math.floor(this.value);
    let place = 1;
    let significant = 1;
    for (let i = 0; i < WHEELS; i++) {
      const digit = Math.floor(v / place) % 10;
      if (digit !== this.shown[i]) {
        this.shown[i] = digit;
        this.wheels[i]!.style.transform = `translate3d(0,${-digit * 10}%,0)`;
      }
      if (v >= place) significant = i + 1;
      place *= 10;
    }
    for (let i = 0; i < WHEELS; i++) this.cells[i]!.set(i >= significant);
  }
}

export class Tally {
  readonly el: HTMLElement;
  private odo = new Odometer();
  private wave: Num;
  private left: Num;
  private leftTag: Label;
  private high: Label;
  private highShown = -1;
  private beat: Flag;
  private leftRow: Shown;
  private intermission: Flag;

  constructor() {
    const wave = span('tl-wave-n');
    const left = span('tl-left-n');
    const tag = span('tl-left-t');
    const high = span('tl-high');
    const leftRow = div('tl-left', left, tag);
    this.el = div('tally',
      div('tl-top',
        div('tl-wave', span('tl-wave-t', 'wave'), wave),
        leftRow,
      ),
      this.odo.el,
      high,
    );
    this.wave = new Num(wave);
    this.left = new Num(left);
    this.leftTag = new Label(tag);
    this.high = new Label(high);
    this.leftRow = new Shown(leftRow, 'flex');
    this.beat = new Flag(this.el, 'beat');
    this.intermission = new Flag(this.el, 'intermission');
    this.odo.snap(0);
  }

  update(s: HudState, dt: number): void {
    const between = s.phase === 'intermission';
    // Between waves the plate turns cold and shows what is coming, which also means no run ever reads wave 0.
    this.wave.set(between ? s.wave + 1 : s.wave);
    this.intermission.set(between);
    if (between) {
      const secs = Math.ceil(s.nextWaveIn);
      this.left.set(secs);
      this.leftTag.set('seconds');
      this.leftRow.set(secs > 0);
    } else {
      this.left.set(s.remaining);
      this.leftTag.set('left');
      this.leftRow.set(true);
    }

    this.odo.set(s.score);
    this.odo.update(dt);

    // A run on custom rules is unranked: it is never measured against the record.
    const beating = !s.customRules && s.highScore > 0 && s.score > s.highScore;
    this.beat.set(beating);
    const shown = s.customRules ? CUSTOM : beating ? s.score : s.highScore;
    if (shown !== this.highShown) {
      this.highShown = shown;
      this.high.set(s.customRules ? 'custom rules' : beating ? 'new high' : `high ${s.highScore.toLocaleString('en-US')}`);
    }
  }

  reset(): void {
    this.odo.snap(0);
    this.highShown = -1;
  }
}
