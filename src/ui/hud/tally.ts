/** Wave plate and the score, which is a real odometer: digit wheels that move by transform, with carry. */
import { damp } from '../../core/math';
import { Flag, Label, Num, Shown, div, span } from '../dom';
import type { HudState } from '../state';

const WHEELS = 8;
const ROLL_RATE = 11;

export class Odometer {
  readonly el: HTMLElement;
  private wheels: HTMLElement[] = [];
  private cells: Flag[] = [];
  private q: number[] = [];
  private value = 0;
  private target = 0;
  private lit = 0;
  private rolling: Flag;

  constructor(cls = '') {
    this.el = div(`odo ${cls}`);
    for (let i = WHEELS - 1; i >= 0; i--) {
      const strip = div('odo-strip');
      for (let d = 0; d <= 10; d++) strip.append(span('', String(d % 10)));
      const cell = div(i % 3 === 0 && i > 0 ? 'odo-cell sep' : 'odo-cell', strip);
      this.el.append(cell);
      this.wheels[i] = strip;
      this.cells[i] = new Flag(cell, 'dim');
      this.q[i] = -1;
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
    const v = this.value;
    let place = 1;
    let significant = 1;
    for (let i = 0; i < WHEELS; i++) {
      const digit = Math.floor(v / place) % 10;
      // Odometers only turn a wheel during the last tenth of the wheel below it.
      const below = (v % place) / place;
      const carry = i === 0 ? v - Math.floor(v) : below > 0.9 ? (below - 0.9) * 10 : 0;
      const pos = digit + carry;
      const q = Math.round(pos * 50);
      if (q !== this.q[i]) {
        this.q[i] = q;
        this.wheels[i]!.style.transform = `translate3d(0,${-(q / 50) * (100 / 11)}%,0)`;
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
  private tick = -1;

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
    this.wave.set(s.wave);
    const between = s.phase === 'intermission';
    this.intermission.set(between);
    if (between) {
      const secs = Math.ceil(s.nextWaveIn);
      this.left.set(secs);
      this.leftTag.set('next wave');
      this.leftRow.set(secs > 0);
      this.tick = secs;
    } else {
      this.left.set(s.remaining);
      this.leftTag.set('left');
      this.leftRow.set(true);
    }

    this.odo.set(s.score);
    this.odo.update(dt);

    const beating = s.highScore > 0 && s.score > s.highScore;
    this.beat.set(beating);
    const shown = beating ? s.score : s.highScore;
    if (shown !== this.highShown) {
      this.highShown = shown;
      this.high.set(beating ? 'new high' : `high ${s.highScore.toLocaleString('en-US')}`);
    }
  }

  reset(): void {
    this.odo.snap(0);
    this.highShown = -1;
  }
}
