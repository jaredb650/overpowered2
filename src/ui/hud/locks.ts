/**
 * Lock markers for weapons that paint targets (Quiver, Judge fan, Autoraffica smart aim). One corner-bracket box per
 * painted target, sat on it as it moves, with a count when more than one mark is on it, a line under the crosshair
 * saying how many are marked, and — while Autoraffica smart aim charges a head — a small radial loading progress ring
 * directly on the charging head. Pooled elements only; nothing is allocated while painting.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import type { MissileTarget, PaintView, SmartAimView } from '../../core/gameplay';
import { clamp, damp } from '../../core/math';
import { div, markup, span } from '../dom';

const MAX_LOCKS = 6;
/** Corner brackets on a 40 unit box, drawn once and scaled by CSS. */
const BRACKETS =
  '<svg class="lk-svg" viewBox="-20 -20 40 40" aria-hidden="true"><path d="' +
  'M-18 -9V-18H-9V-15H-15V-9Z M18 -9V-18H9V-15H15V-9Z M-18 9V18H-9V15H-15V9Z M18 9V18H9V15H15V9Z M-2.5 0L0 -2.5L2.5 0L0 2.5Z' +
  '"/></svg>';

/** Small radial loading ring rendered directly on the head currently charging in Autoraffica smart mode. */
const CHARGE_R = 11;
const CHARGE_CIRC = 2 * Math.PI * CHARGE_R;
const CHARGE_RING =
  '<svg class="lk-charge-svg" viewBox="-16 -16 32 32" aria-hidden="true">' +
  `<circle class="lk-charge-rim" r="${CHARGE_R}"/>` +
  `<circle class="lk-charge-track" r="${CHARGE_R}"/>` +
  `<circle class="lk-charge-arc" r="${CHARGE_R}" transform="rotate(-90)" stroke-dasharray="${CHARGE_CIRC.toFixed(2)}" stroke-dashoffset="${CHARGE_CIRC.toFixed(2)}"/>` +
  '<circle class="lk-charge-dot" r="1.8"/>' +
  '</svg>';

interface Lock {
  el: HTMLElement;
  count: HTMLElement;
  target: MissileTarget | null;
  /** Marks on it this frame. */
  n: number;
  /** What the count label last said, so the DOM is only written on a change. */
  shown: number;
  pop: number;
  visible: boolean;
}

const _p = new THREE.Vector3();

export class LockMarkers {
  readonly el: HTMLElement;
  private readonly locks: Lock[] = [];
  private readonly label: HTMLElement;
  private readonly chargeEl: HTMLElement;
  private readonly chargeArc: SVGCircleElement | null;
  private chargeVisible = false;
  private chargeOffsetQ = -1;
  private labelText = '';
  private full = false;

  constructor(private readonly ctx: Ctx) {
    this.label = span('lk-label');
    this.el = div('lk');
    for (let i = 0; i < MAX_LOCKS; i++) {
      const count = span('lk-n');
      const el = div('lk-box', markup(BRACKETS), count);
      el.style.display = 'none';
      this.el.append(el);
      this.locks.push({ el, count, target: null, n: 0, shown: 0, pop: 0, visible: false });
    }
    this.chargeEl = div('lk-charge', markup(CHARGE_RING));
    this.chargeEl.style.display = 'none';
    this.chargeArc = this.chargeEl.querySelector('.lk-charge-arc');
    this.el.append(this.chargeEl);
    this.el.append(this.label);
  }

  private paint(): PaintView | undefined {
    const w = this.ctx.weapons as { paint?: PaintView } | undefined;
    const p = w?.paint;
    return p && Array.isArray(p.marks) ? p : undefined;
  }

  private smartAim(): SmartAimView | undefined {
    return (this.ctx.weapons as { smartAim?: SmartAimView } | undefined)?.smartAim;
  }

  update(dt: number, hidden: boolean): void {
    const paint = this.paint();
    const smart = this.smartAim();
    const camera = this.ctx.render.camera;
    const smartFiring = smart?.on === true && smart.phase === 'firing';
    const live = !hidden && paint !== undefined && (paint.painting || (smartFiring && paint.marks.length > 0)) && camera instanceof THREE.Camera;
    const showLabel = !hidden && paint !== undefined && paint.painting && camera instanceof THREE.Camera;

    // Group the marks by target. A lock keeps its target while it stays marked, so its pop is its own.
    for (const l of this.locks) l.n = 0;
    if (live) {
      const marks = paint.marks;
      for (let i = 0; i < marks.length; i++) {
        const m = marks[i]!;
        let lock: Lock | null = null;
        for (const l of this.locks) if (l.target === m) lock = l;
        if (!lock) {
          for (const l of this.locks) {
            if (l.n === 0 && (l.target === null || !marks.includes(l.target))) {
              lock = l;
              break;
            }
          }
          if (!lock) continue;
          lock.target = m;
          lock.shown = 0;
        }
        lock.n++;
      }
    }
    const full = showLabel && paint.marks.length >= paint.max && paint.max > 0;
    if (full !== this.full) {
      this.full = full;
      this.el.classList.toggle('full', full);
    }
    const text = showLabel ? `LOCK ${paint.marks.length}/${paint.max}` : '';
    if (text !== this.labelText) {
      this.labelText = text;
      this.label.textContent = text;
    }

    const halfW = innerWidth / 2;
    const halfH = innerHeight / 2;
    for (const l of this.locks) {
      if (l.n === 0 || !l.target) {
        if (l.visible) {
          l.visible = false;
          l.el.style.display = 'none';
        }
        l.target = null;
        l.shown = 0;
        continue;
      }
      if (l.n > l.shown) {
        l.pop = 1;
        l.shown = l.n;
        l.count.textContent = l.n > 1 ? `x${l.n}` : '';
      }
      _p.copy(l.target.center);
      _p.y += l.target.aimLift ?? 0;
      _p.project(camera as THREE.Camera);
      // Behind the eye, project() mirrors the point onto the screen.
      if (_p.z > 1) {
        if (l.visible) {
          l.visible = false;
          l.el.style.display = 'none';
        }
        continue;
      }
      if (!l.visible) {
        l.visible = true;
        l.el.style.display = '';
      }
      l.pop = damp(l.pop, 0, 14, dt);
      const x = Math.max(-halfW + 24, Math.min(halfW - 24, _p.x * halfW));
      const y = Math.max(-halfH + 24, Math.min(halfH - 24, -_p.y * halfH));
      l.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(${(1 + l.pop * 0.7).toFixed(3)})`;
    }

    // Small radial loading indicator directly on the charging head during Autoraffica smart-gun head painting.
    const chargingAt = !hidden && smart?.on === true && smart.phase === 'painting' && camera instanceof THREE.Camera
      ? (smart.chargingAt ?? null)
      : null;
    const progress = chargingAt ? clamp(smart?.charge ?? 0, 0, 1) : 0;
    if (chargingAt && progress > 0) {
      _p.copy(chargingAt).project(camera as THREE.Camera);
      if (_p.z <= 1) {
        if (!this.chargeVisible) {
          this.chargeVisible = true;
          this.chargeEl.style.display = '';
        }
        const x = Math.max(-halfW + 24, Math.min(halfW - 24, _p.x * halfW));
        const y = Math.max(-halfH + 24, Math.min(halfH - 24, -_p.y * halfH));
        this.chargeEl.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
        const q = Math.round(progress * 200);
        if (q !== this.chargeOffsetQ && this.chargeArc) {
          this.chargeOffsetQ = q;
          this.chargeArc.style.strokeDashoffset = (CHARGE_CIRC * (1 - q / 200)).toFixed(2);
        }
        return;
      }
    }
    if (this.chargeVisible) {
      this.chargeVisible = false;
      this.chargeOffsetQ = -1;
      this.chargeEl.style.display = 'none';
    }
  }

  reset(): void {
    for (const l of this.locks) {
      l.target = null;
      l.n = l.shown = 0;
      l.visible = false;
      l.el.style.display = 'none';
    }
    this.chargeVisible = false;
    this.chargeOffsetQ = -1;
    this.chargeEl.style.display = 'none';
    this.labelText = '';
    this.label.textContent = '';
  }
}
