/**
 * Speedometer drawn as an engine tach: a static dial, one rotating needle and a peak-hold tick.
 * The dial never repaints. Motion is two transforms, and the readout only writes when the integer changes.
 */
import { clamp, damp } from '../../core/math';
import { MOVE } from '../../player/tuning';
import { OVERDRIVE_MIN_SPEED, SCORE } from '../../progression/data';
import { Flag, Label, Num, div, markup, span } from '../dom';
import { DASH_ICON } from '../icons';
import type { HudState } from '../state';

/** Past the top score tier the needle sits on the stop. Pads, blasts and Berserk get there; strafing tops out near 27. */
const MAX_SPEED = 40;
const SWEEP_START = -118;
const SWEEP = 236;
/** Marks that mean something: a flat-out run, the Overdrive floor, and the redline at the top score tier. */
const GROUND_TOP = MOVE.runSpeed;
const OVERDRIVE_FLOOR = OVERDRIVE_MIN_SPEED;
const REDLINE = SCORE.speedTiers[SCORE.speedTiers.length - 1]![0];
const PEAK_HOLD = 2.2;

const angleOf = (speed: number) => SWEEP_START + (clamp(speed, 0, MAX_SPEED) / MAX_SPEED) * SWEEP;

function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [100 + r * Math.cos(a), 100 + r * Math.sin(a)];
}

function dialSvg(): string {
  let keys = '';
  let ticks = '';
  let labels = '';
  for (let v = 0; v <= MAX_SPEED; v += 5) {
    const major = v % 10 === 0;
    const a = angleOf(v);
    const [x1, y1] = polar(major ? 78 : 86, a);
    const [x2, y2] = polar(94, a);
    const line = `x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"`;
    const size = major ? ' tk-big' : '';
    keys += `<line class="tk-key${size}" ${line}/>`;
    ticks += `<line class="tk${size}${v >= REDLINE ? ' tk-red' : ''}" ${line}/>`;
    if (major) {
      const [tx, ty] = polar(65, a);
      labels += `<text class="tn${v >= REDLINE ? ' tn-red' : ''}" x="${tx.toFixed(2)}" y="${(ty + 5).toFixed(2)}">${v}</text>`;
    }
  }
  const [rx1, ry1] = polar(95, angleOf(REDLINE));
  const [rx2, ry2] = polar(95, angleOf(MAX_SPEED));
  const arc = `M${rx1.toFixed(2)} ${ry1.toFixed(2)}A95 95 0 0 1 ${rx2.toFixed(2)} ${ry2.toFixed(2)}`;
  const mark = (speed: number, cls: string) => {
    const [x, y] = polar(84, angleOf(speed));
    const [a, b] = polar(73, angleOf(speed) - 3.2);
    const [c, d] = polar(73, angleOf(speed) + 3.2);
    return `<polygon class="${cls}" points="${x.toFixed(2)},${y.toFixed(2)} ${a.toFixed(2)},${b.toFixed(2)} ${c.toFixed(2)},${d.toFixed(2)}"/>`;
  };
  return `<svg class="tach-face" viewBox="0 0 200 200" aria-hidden="true">
    ${keys}<path class="tk-arc-key" d="${arc}"/>${ticks}<path class="tk-arc" d="${arc}"/>${labels}
    ${mark(GROUND_TOP, 'tk-ground')}${mark(OVERDRIVE_FLOOR, 'tk-od')}</svg>`;
}

export class Tach {
  readonly el: HTMLElement;
  private needle: HTMLElement;
  private peak: HTMLElement;
  private readout: Num;
  private state: Label;
  private over: Flag;
  private red: Flag;
  private dashes: Flag[] = [];
  private fill: HTMLElement[] = [];
  private shown = 0;
  private peakSpeed = 0;
  private peakAge = 0;
  private needleQ = NaN;
  private peakQ = NaN;
  private fillQ: number[] = [];
  private clock = 0;

  constructor() {
    this.needle = div('tach-needle');
    this.peak = div('tach-peak');
    const value = span('tach-val');
    const state = span('tach-state');
    const dash = div('tach-dash');
    for (let i = 0; i < 2; i++) {
      const refill = div('dash-fill');
      const pip = div('dash-pip', markup(DASH_ICON), refill);
      dash.append(pip);
      this.dashes.push(new Flag(pip, 'full'));
      this.fill.push(refill);
      this.fillQ.push(-1);
    }
    this.el = div('tach',
      markup(dialSvg()),
      this.peak,
      this.needle,
      div('tach-hub', state, value, span('tach-unit', 'm/s')),
      dash,
    );
    this.readout = new Num(value);
    this.state = new Label(state);
    this.over = new Flag(this.el, 'over');
    this.red = new Flag(this.el, 'red');
  }

  update(s: HudState, dt: number): void {
    this.clock += dt;
    // A needle has mass. It chases the real value hard enough to feel a dash land without looking digital.
    this.shown = damp(this.shown, s.speed, 22, dt);
    const redline = s.speed >= REDLINE;
    // Over the redline the needle shakes against the stop, the way a tach does on the limiter.
    const jitter = redline ? Math.sin(this.clock * 71) * 0.9 : 0;
    const q = Math.round((angleOf(this.shown) + jitter) * 4);
    if (q !== this.needleQ) {
      this.needleQ = q;
      this.needle.style.transform = `rotate(${q / 4}deg)`;
    }

    if (s.speed >= this.peakSpeed) {
      this.peakSpeed = s.speed;
      this.peakAge = 0;
    } else {
      this.peakAge += dt;
      if (this.peakAge > PEAK_HOLD) this.peakSpeed = damp(this.peakSpeed, s.speed, 3, dt);
    }
    const pq = Math.round(angleOf(this.peakSpeed) * 2);
    if (pq !== this.peakQ) {
      this.peakQ = pq;
      this.peak.style.transform = `rotate(${pq / 2}deg)`;
    }

    this.readout.set(Math.round(s.speed));
    this.over.set(s.speed >= OVERDRIVE_FLOOR);
    this.red.set(redline);
    this.state.set(
      s.dashing ? 'dash' : s.wallRunning ? 'wall' : s.sliding ? 'slide' : s.grounded ? '' : 'air',
    );

    for (let i = 0; i < this.dashes.length; i++) {
      const full = i < s.dashCharges;
      this.dashes[i]!.set(full);
      const refill = !full && i === Math.floor(s.dashCharges) ? s.dashRefill : 0;
      const fq = Math.round(refill * 100);
      if (fq !== this.fillQ[i]) {
        this.fillQ[i] = fq;
        this.fill[i]!.style.transform = `scaleX(${fq / 100})`;
      }
    }
  }

  reset(): void {
    this.shown = 0;
    this.peakSpeed = 0;
  }
}
