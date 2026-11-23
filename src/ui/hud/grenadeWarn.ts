/**
 * Directional live-grenade danger indicator & throwback prompt.
 *
 * Renders up to `THROWBACK.maxIndicators` pooled DOM markers for live enemy grenades within `THROWBACK.warnRange`.
 * On-screen grenades float directly over the live projectile with an animated SVG fuse countdown ring; off-screen
 * grenades pin onto an elliptical danger ring around the crosshair with a crisp directional chevron. When any
 * enemy grenade is within `THROWBACK.grabReach`, a prominent `[G] THROW BACK` pill pulses beneath the crosshair.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { clamp } from '../../core/math';
import { THROWBACK, makeIncomingPool, type IncomingGrenade } from '../../weapons/throwback';
import { Flag, Label, Shown, div, markup, span } from '../dom';

const RING_CIRCUMFERENCE = 2 * Math.PI * 16; // r = 16 in 40x40 viewBox
const OFF_SCREEN_X = 0.28;
const OFF_SCREEN_Y = 0.30;

const _proj = new THREE.Vector3();
const _to = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _eye = new THREE.Vector3();

interface MarkerSlot {
  readonly el: HTMLElement;
  readonly arrow: HTMLElement;
  readonly ring: SVGCircleElement;
  readonly dist: Label;
  readonly shown: Shown;
  readonly urgent: Flag;
  readonly flash: Flag;
  readonly offscreen: Flag;
  qx: number;
  qy: number;
  qRot: number;
  qDash: number;
}

export class GrenadeWarn {
  readonly el: HTMLElement;
  private readonly slots: MarkerSlot[] = [];
  private readonly promptEl: HTMLElement;
  private readonly promptText: Label;
  private readonly promptShown: Shown;
  private readonly pool: IncomingGrenade[] = makeIncomingPool(THROWBACK.maxIndicators);
  private width = 1280;
  private height = 720;

  constructor(private readonly ctx: Ctx) {
    this.el = div('gw-layer');
    for (let i = 0; i < THROWBACK.maxIndicators; i++) {
      const svg = markup(
        `<svg class="gw-svg" viewBox="0 0 40 40" aria-hidden="true">`
        + `<circle class="gw-bg" cx="20" cy="20" r="16"/>`
        + `<circle class="gw-fuse" cx="20" cy="20" r="16" stroke-dasharray="${RING_CIRCUMFERENCE.toFixed(1)}" stroke-dashoffset="0"/>`
        + `<path class="gw-icon" d="M18 11h4v3h-4zM15 15h10l2 3v7l-2 3H15l-2-3v-7z"/>`
        + `</svg>`,
      );
      const ring = svg.querySelector('.gw-fuse') as SVGCircleElement;
      const arrow = div('gw-arrow');
      const distEl = span('gw-dist');
      const el = div('gw-mark', arrow, svg, distEl);
      const shown = new Shown(el, 'flex');
      shown.set(false);
      this.el.append(el);
      this.slots.push({
        el,
        arrow,
        ring,
        dist: new Label(distEl),
        shown,
        urgent: new Flag(el, 'urgent'),
        flash: new Flag(el, 'flash'),
        offscreen: new Flag(el, 'off'),
        qx: NaN,
        qy: NaN,
        qRot: NaN,
        qDash: NaN,
      });
    }

    const promptText = span('gw-prompt-text');
    this.promptEl = div('gw-prompt', promptText);
    this.promptText = new Label(promptText);
    this.promptShown = new Shown(this.promptEl, 'flex');
    this.promptShown.set(false);
    this.el.append(this.promptEl);
    this.measure();
    if (typeof addEventListener === 'function') addEventListener('resize', this.measure);
  }

  private measure = (): void => {
    this.width = typeof innerWidth === 'number' && innerWidth > 0 ? innerWidth : 1280;
    this.height = typeof innerHeight === 'number' && innerHeight > 0 ? innerHeight : 720;
  };

  clear(): void {
    for (const s of this.slots) s.shown.set(false);
    this.promptShown.set(false);
  }

  update(playing: boolean): void {
    const { combat, input, player, render } = this.ctx;
    if (!playing || !player.alive || !combat.listIncomingGrenades) {
      this.clear();
      return;
    }
    const cam = render.camera;
    if (!(cam instanceof THREE.Camera)) {
      this.clear();
      return;
    }

    cam.getWorldPosition(_eye);
    const count = combat.listIncomingGrenades(_eye, THROWBACK.warnRange, this.pool);
    if (count === 0) {
      this.clear();
      return;
    }

    const hw = this.width * 0.5;
    const hh = this.height * 0.5;
    cam.getWorldDirection(_fwd);
    _right.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    _up.setFromMatrixColumn(cam.matrixWorld, 1).normalize();

    let bestInReach: IncomingGrenade | null = null;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      if (i >= count) {
        slot.shown.set(false);
        continue;
      }
      const g = this.pool[i]!;
      if (g.inReach && !bestInReach && !player.parked) bestInReach = g;

      _to.subVectors(g.position, _eye);
      const inFront = _to.dot(_fwd) > 0.1;
      let px = 0;
      let py = 0;
      let off = false;
      let angleRad = 0;

      if (inFront) {
        _proj.copy(g.position).project(cam);
        if (Math.abs(_proj.x) <= 0.88 && Math.abs(_proj.y) <= 0.84) {
          px = _proj.x * hw;
          py = -_proj.y * hh;
        } else {
          off = true;
        }
      } else {
        off = true;
      }

      if (off) {
        const rx = _to.dot(_right);
        const ry = _to.dot(_up);
        const len = Math.hypot(rx, ry) || 1;
        const nx = rx / len;
        const ny = -ry / len;
        px = nx * this.width * OFF_SCREEN_X;
        py = ny * this.height * OFF_SCREEN_Y;
        angleRad = Math.atan2(ny, nx);
      }

      slot.shown.set(true);
      slot.offscreen.set(off);
      slot.flash.set(g.flash);
      slot.urgent.set(g.fuse <= 1.0 || g.distance <= 5.5);

      const qx = Math.round(px);
      const qy = Math.round(py);
      if (qx !== slot.qx || qy !== slot.qy) {
        slot.qx = qx;
        slot.qy = qy;
        slot.el.style.transform = `translate3d(${qx}px,${qy}px,0)`;
      }
      if (off) {
        const qRot = Math.round((angleRad * 180) / Math.PI);
        if (qRot !== slot.qRot) {
          slot.qRot = qRot;
          slot.arrow.style.transform = `rotate(${qRot + 90}deg)`;
        }
      }

      const frac = clamp(g.fuse / Math.max(g.maxFuse, 0.2), 0, 1);
      const dash = Math.round(RING_CIRCUMFERENCE * (1 - frac) * 2) / 2;
      if (dash !== slot.qDash) {
        slot.qDash = dash;
        slot.ring.style.strokeDashoffset = `${dash}`;
      }
      slot.dist.set(`${Math.max(1, Math.round(g.distance))}m`);
    }

    if (bestInReach) {
      const key = input.labelFor?.('grenade') ?? 'G';
      const kind = bestInReach.flash ? 'FLASHBANG' : 'GRENADE';
      this.promptText.set(`[${key}] THROW BACK ${kind}`);
      this.promptShown.set(true);
    } else {
      this.promptShown.set(false);
    }
  }
}
